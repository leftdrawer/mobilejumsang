// 엽전 던지기를 헤드리스로 여러 번 굴려 침투·탈출·멈춤·앞뒤·겹침을 센다.
// 물리 상수와 보조 함수는 index.html 의 COIN_PHYS 블록을 그대로 떼어 쓴다.
// 블록이 없으면(튜닝 중) 이 파일 안의 기본값을 쓴다.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(join(root, 'index.html'), 'utf8');
const N = Number(process.env.TOSSES || 40);
const SEED0 = Number(process.env.SEED || 1);

const rapierStart = html.indexOf('<script>(()=>{var C,s=new Array(128)');
const rapierEnd = html.indexOf('</script>', rapierStart);
const rapierCode = html.slice(rapierStart + '<script>'.length, rapierEnd);
const origInstantiate = WebAssembly.instantiate;
WebAssembly.instantiate = async function (buf, imports) {
  const result = await origInstantiate.call(this, buf, imports);
  return result;
};
const sandbox = {
  window: {}, console, WebAssembly, TextDecoder, TextEncoder,
  URL, queueMicrotask, performance, setTimeout, clearTimeout,
};
sandbox.globalThis = sandbox;
sandbox.window = sandbox;
vm.createContext(sandbox);
vm.runInContext(rapierCode, sandbox);
const RAPIER = sandbox.RAPIER;
await RAPIER.init();
WebAssembly.instantiate = origInstantiate;

const blockA = html.indexOf('/* COIN_PHYS_BEGIN */');
const blockB = html.indexOf('/* COIN_PHYS_END */');
if (blockA < 0 || blockB < blockA) {
  console.error('index.html 에 COIN_PHYS 블록이 없습니다.');
  process.exit(1);
}
const block = html.slice(blockA + '/* COIN_PHYS_BEGIN */'.length, blockB);
const api = new Function('RAPIER', block + '\nreturn {R_C,H_C,TRAY_W,TRAY_D,COIN_DT,planCoinToss,dissipateCoinBody,projectCoinBodies,configureCoinWorld,makeCoinBody};')(RAPIER);
const { R_C, H_C, TRAY_W, TRAY_D, COIN_DT, planCoinToss, dissipateCoinBody, projectCoinBodies, configureCoinWorld, makeCoinBody } = api;

function mulberry32(a) {
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
const nyOf = q => Math.abs(1 - 2 * (q.x * q.x + q.z * q.z));
const faceUp = q => (1 - 2 * (q.x * q.x + q.z * q.z)) > 0;
const tiltDeg = q => Math.acos(Math.min(1, nyOf(q))) * 180 / Math.PI;

function minContact(world, h1, h2) {
  let d = Infinity, n = 0;
  world.narrowPhase.contactPair(h1, h2, m => {
    const k = m.numSolverContacts();
    n += k;
    for (let i = 0; i < k; i++) d = Math.min(d, m.solverContactDist(i));
  });
  return { d, n };
}

function supportHalf(q) {
  const ny = nyOf(q);
  const s = Math.sqrt(Math.max(0, 1 - Math.min(1, ny * ny)));
  return H_C * ny + R_C * s;
}

function runToss(seed) {
  const rnd = mulberry32(seed);
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  configureCoinWorld(world);
  const floorBody = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
  const floor = world.createCollider(
    RAPIER.ColliderDesc.cuboid(TRAY_W / 2 + 0.02, 0.01, TRAY_D / 2 + 0.02)
      .setTranslation(0, -0.01, 0).setFriction(0.50).setRestitution(0.22),
    floorBody);
  const walls = [
    [TRAY_W / 2 + 0.01, 0.08, 0, 0.01, 0.08, TRAY_D / 2],
    [-TRAY_W / 2 - 0.01, 0.08, 0, 0.01, 0.08, TRAY_D / 2],
    [0, 0.08, TRAY_D / 2 + 0.01, TRAY_W / 2, 0.08, 0.01],
    [0, 0.08, -TRAY_D / 2 - 0.01, TRAY_W / 2, 0.08, 0.01],
  ];
  for (const [x, y, z, hx, hy, hz] of walls) {
    const b = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
    world.createCollider(RAPIER.ColliderDesc.cuboid(hx, hy, hz).setTranslation(x, y, z).setFriction(0.40).setRestitution(0.18), b);
  }
  const bodies = [];
  const handles = [];
  for (let i = 0; i < 7; i++) {
    const b = makeCoinBody(world, { x: 0, y: 0.05, z: 0 }, { x: 0, y: 0, z: 0, w: 1 });
    bodies.push(b);
    const hs = [];
    for (let c = 0; c < b.numColliders(); c++) hs.push(b.collider(c).handle);
    handles.push(hs);
  }
  const mass = bodies[0].mass();
  const toss = planCoinToss(rnd);
  bodies.forEach((b, i) => {
    const p = toss[i];
    b.setGravityScale(1, true);
    b.setTranslation({ x: p.x, y: p.y, z: p.z }, true);
    b.setRotation(p.q, true);
    b.setLinvel(p.v, true);
    b.setAngvel(p.w, true);
  });
  let minLow = Infinity, maxFlatOverlap = 0, escaped = 0, steps = 0, flips = 0;
  let face = bodies.map(b => faceUp(b.rotation()));
  const hist = [];
  const tPhys0 = performance.now();
  const maxSteps = Math.ceil(8 / COIN_DT);
  let settledAt = null;
  for (let s = 0; s < maxSteps; s++) {
    world.step();
    for (const b of bodies) dissipateCoinBody(b);
    projectCoinBodies(bodies);
    steps++;
    const t = s * COIN_DT;
    if (s % 8 === 0) {
      const ps = bodies.map(b => b.translation());
      const qs = bodies.map(b => b.rotation());
      const nowFace = qs.map(faceUp);
      for (let i = 0; i < nowFace.length; i++) if (nowFace[i] !== face[i]) flips++;
      face = nowFace;
      for (let i = 0; i < bodies.length; i++) {
        const low = ps[i].y - supportHalf(qs[i]);
        if (low < minLow) minLow = low;
        if (low < -0.001 || Math.abs(ps[i].x) > TRAY_W / 2 + 0.01 || Math.abs(ps[i].z) > TRAY_D / 2 + 0.01 || ps[i].y > 0.45) escaped = 1;
        const ni = Math.abs(1 - 2 * (qs[i].x * qs[i].x + qs[i].z * qs[i].z));
        for (let j = i + 1; j < bodies.length; j++) {
          const nj = Math.abs(1 - 2 * (qs[j].x * qs[j].x + qs[j].z * qs[j].z));
          if (ni < 0.92 || nj < 0.92) continue;
          const dh = Math.hypot(ps[i].x - ps[j].x, ps[i].z - ps[j].z);
          if (Math.abs(ps[i].y - ps[j].y) < H_C * 2 - 0.00025) maxFlatOverlap = Math.max(maxFlatOverlap, R_C * 2 - dh);
        }
      }
    }
    if (t > 0.4 && s % 8 === 0) {
      const stamp = bodies.map(b => {
        const p = b.translation(), q = b.rotation();
        return { x: p.x, y: p.y, z: p.z, qx: q.x, qy: q.y, qz: q.z, qw: q.w };
      });
      hist.push({ t, stamp });
      while (hist.length && t - hist[0].t > 0.5) hist.shift();
      if (hist.length && t - hist[0].t >= 0.45) {
        let maxM = 0, maxA = 0;
        const a = hist[0].stamp;
        for (let i = 0; i < a.length; i++) {
          maxM = Math.max(maxM, Math.hypot(stamp[i].x - a[i].x, stamp[i].y - a[i].y, stamp[i].z - a[i].z));
          const d = Math.abs(a[i].qx * stamp[i].qx + a[i].qy * stamp[i].qy + a[i].qz * stamp[i].qz + a[i].qw * stamp[i].qw);
          maxA = Math.max(maxA, 2 * Math.acos(Math.min(1, d)));
        }
        if (maxM < 0.00012 && maxA < 0.004) { settledAt = t; break; }
      }
    }
  }
  const stepMs = (performance.now() - tPhys0) / steps;
  // 판정과 같은 기하: 원기둥 간격 0.4mm, 15° 혼자.
  const pose = bodies.map(b => ({ p: b.translation(), q: b.rotation(), f: faceUp(b.rotation()), ti: tiltDeg(b.rotation()) }));
  // 추가 1초를 더 굴려 잔떨림을 본다. 이미 재운 뒤가 아니라 판정 직전 속도 그대로.
  const rest0 = pose.map(o => ({ x: o.p.x, y: o.p.y, z: o.p.z }));
  for (let s = 0; s < Math.ceil(1 / COIN_DT); s++) {
    world.step();
    for (const b of bodies) dissipateCoinBody(b);
    projectCoinBodies(bodies);
  }
  let restDrift = 0;
  bodies.forEach((b, i) => {
    const p = b.translation();
    restDrift = Math.max(restDrift, Math.hypot(p.x - rest0[i].x, p.y - rest0[i].y, p.z - rest0[i].z));
  });
  let edgeStuck = 0, heads = 0, maxTilt = 0;
  for (const o of pose) {
    if (o.f) heads++;
    if (o.ti > 70) edgeStuck++;
    if (o.ti > maxTilt) maxTilt = o.ti;
  }
  world.free();
  return {
    mass, settledAt: settledAt ?? 8, minLow, maxFlatOverlap, escaped, stepMs, restDrift, edgeStuck, heads, flips, maxTilt,
    timedOut: settledAt == null,
  };
}

const rows = [];
const t0 = performance.now();
for (let i = 0; i < N; i++) rows.push(runToss(SEED0 + i * 997));
const wall = (performance.now() - t0) / 1000;
const num = k => rows.map(r => r[k]).sort((a, b) => a - b);
const q = (arr, p) => arr[Math.min(arr.length - 1, Math.floor(p * (arr.length - 1)))];
const sum = k => rows.reduce((s, r) => s + r[k], 0);
const settle = num('settledAt');
const drift = num('restDrift');
const lows = num('minLow');
const flats = num('maxFlatOverlap');
const tilts = num('maxTilt');
const heads = sum('heads');
const coins = N * 7;
console.log(JSON.stringify({
  tosses: N,
  rapier: RAPIER.version(),
  mass_g: rows[0].mass * 1000,
  settle_s: { min: settle[0], p50: q(settle, 0.5), p90: q(settle, 0.9), max: settle[settle.length - 1] },
  timeout: rows.filter(r => r.timedOut).length,
  escaped: sum('escaped'),
  lowest_point_mm: lows[0] * 1000,
  flat_overlap_mm: { p50: q(flats, 0.5) * 1000, max: flats[flats.length - 1] * 1000 },
  rest_drift_mm: { p50: q(drift, 0.5) * 1000, p90: q(drift, 0.9) * 1000, max: drift[drift.length - 1] * 1000 },
  edge_over_70: sum('edgeStuck'),
  max_tilt_deg: { p50: q(tilts, 0.5), max: tilts[tilts.length - 1] },
  heads: heads / coins,
  flips_per_coin: sum('flips') / coins,
  step_ms: sum('stepMs') / N,
  frame_ms_at_60: (sum('stepMs') / N) * (1 / 60) / COIN_DT,
  wall_s: wall,
}, null, 2));
