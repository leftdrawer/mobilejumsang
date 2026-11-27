// 잎전이 처음 멈춘 뒤의 프레임 이동을 잰다.
// 물리 보조 단계는 index.html 의 COIN_PHYS 블록을 그대로 떼어 쓰고,
// 그린 자리는 앱과 같이 보간한다. syncCoins 가 아직 자리를 고치면 그 보정까지 포함한다.
// 통과 기준: 멈춘 뒤, 다른 닢에 맞지 않은 프레임의 이동 < 0.005mm, 회전 < 0.02°.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(join(root, 'index.html'), 'utf8');
const N = Number(process.env.TOSSES || 200);
const SEED0 = Number(process.env.SEED || 1);
const ASSERT = process.env.ASSERT !== '0';
const POS_MM = 0.005;
const ROT_DEG = 0.02;

const rapierStart = html.indexOf('<script>(()=>{var C,s=new Array(128)');
const rapierEnd = html.indexOf('</script>', rapierStart);
const rapierCode = html.slice(rapierStart + '<script>'.length, rapierEnd);
const origInstantiate = WebAssembly.instantiate;
WebAssembly.instantiate = async function (buf, imports) {
  return origInstantiate.call(this, buf, imports);
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

const syncStart = html.indexOf('function syncCoins(alpha){');
const tiltStart = html.indexOf('const tiltOf=q=>', syncStart);
const syncSrc = syncStart >= 0 && tiltStart > syncStart ? html.slice(syncStart, tiltStart) : '';
const LEGACY_VISUAL = syncSrc.includes('const STACK');

function mulberry32(a) {
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
const nyOf = q => Math.abs(1 - 2 * (q.x * q.x + q.z * q.z));
const tiltDeg = q => Math.acos(Math.min(1, nyOf(q))) * 180 / Math.PI;
function quatAngle(a, b) {
  const d = Math.min(1, Math.abs(a.x * b.x + a.y * b.y + a.z * b.z + a.w * b.w));
  return 2 * Math.acos(d);
}
function slerpQ(a, b, t) {
  let ax = a.x, ay = a.y, az = a.z, aw = a.w;
  let bx = b.x, by = b.y, bz = b.z, bw = b.w;
  let d = ax * bx + ay * by + az * bz + aw * bw;
  if (d < 0) { bx = -bx; by = -by; bz = -bz; bw = -bw; d = -d; }
  if (d > 0.9995) {
    const x = ax + (bx - ax) * t, y = ay + (by - ay) * t, z = az + (bz - az) * t, w = aw + (bw - aw) * t;
    const L = Math.hypot(x, y, z, w) || 1;
    return { x: x / L, y: y / L, z: z / L, w: w / L };
  }
  const th = Math.acos(Math.min(1, d)), s = Math.sin(th);
  const w1 = Math.sin((1 - t) * th) / s, w2 = Math.sin(t * th) / s;
  return { x: ax * w1 + bx * w2, y: ay * w1 + by * w2, z: az * w1 + bz * w2, w: aw * w1 + bw * w2 };
}
function clonePose(list) {
  return list.map(b => {
    const p = b.translation(), q = b.rotation();
    return { x: p.x, y: p.y, z: p.z, qx: q.x, qy: q.y, qz: q.z, qw: q.w };
  });
}
function poseAt(prev, curr, alpha) {
  const n = curr.length;
  const out = new Array(n);
  for (let i = 0; i < n; i++) {
    const p = prev[i] || curr[i], c = curr[i], a = alpha;
    const q = slerpQ(
      { x: p.qx, y: p.qy, z: p.qz, w: p.qw },
      { x: c.qx, y: c.qy, z: c.qz, w: c.qw },
      a,
    );
    out[i] = {
      x: p.x + (c.x - p.x) * a,
      y: p.y + (c.y - p.y) * a,
      z: p.z + (c.z - p.z) * a,
      q,
    };
  }
  return out;
}
function legacyVisual(poses) {
  const n = poses.length;
  const X = poses.map(p => p.x), Y = poses.map(p => p.y), Z = poses.map(p => p.z);
  const P = poses.map(p => {
    const q = p.q;
    const c = Math.abs(1 - 2 * (q.x * q.x + q.z * q.z));
    const s = Math.sqrt(Math.max(0, 1 - Math.min(1, c * c)));
    return { c, s };
  });
  const lift = i => {
    const half = H_C * P[i].c + R_C * P[i].s;
    if (Y[i] < half) Y[i] = half;
  };
  for (let i = 0; i < n; i++) lift(i);
  const STACK = 1.94 * R_C;
  for (let it = 0; it < 6; it++) {
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
      const dx = X[i] - X[j], dz = Z[i] - Z[j], dh = Math.hypot(dx, dz);
      if (dh >= 2 * R_C - 1e-5) continue;
      const flat = P[i].c > 0.75 && P[j].c > 0.75;
      const need = flat ? (2 * H_C + 0.00002)
        : Math.min(2 * H_C + 0.00002 + (2 - P[i].c - P[j].c) * R_C * 0.16, 2 * H_C + R_C * 0.42);
      const dy = Y[i] - Y[j];
      if (Math.abs(dy) >= need - 1e-6) continue;
      if (dh < STACK) {
        const gap = need - Math.abs(dy);
        if (dy > 0 || (Math.abs(dy) < 1e-7 && i > j)) Y[i] += gap; else Y[j] += gap;
      } else {
        const push = (2 * R_C + 0.00002 - dh) * 0.5, inv = 1 / Math.max(dh, 1e-6);
        X[i] += dx * inv * push; Z[i] += dz * inv * push;
        X[j] -= dx * inv * push; Z[j] -= dz * inv * push;
      }
    }
    for (let i = 0; i < n; i++) lift(i);
  }
  return poses.map((p, i) => ({ x: X[i], y: Y[i], z: Z[i], q: p.q }));
}
function renderPose(prev, curr, alpha) {
  const poses = poseAt(prev, curr, alpha);
  return LEGACY_VISUAL ? legacyVisual(poses) : poses;
}

function makeWorld() {
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  configureCoinWorld(world);
  const floorBody = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
  world.createCollider(
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
  for (let i = 0; i < 7; i++) bodies.push(makeCoinBody(world, { x: 0, y: 0.05, z: 0 }, { x: 0, y: 0, z: 0, w: 1 }));
  return { world, bodies };
}

function speedOf(b) {
  const v = b.linvel(), w = b.angvel();
  return { lin: Math.hypot(v.x, v.y, v.z), ang: Math.hypot(w.x, w.y, w.z) };
}

// 낮은 속도가 이 시간 이어지면 "처음 멈춤". 그 뒤 프레임만 잔떨림으로 센다.
const REST_HOLD = 0.12;
const REST_LIN = 0.003;
const REST_ANG = 0.05;
const HIT_SPEED = 0.05;

function runToss(kind, seed) {
  const rnd = mulberry32(seed);
  const { world, bodies } = makeWorld();
  const pokeMm = new Array(7).fill(0);
  const lowSteps = new Array(7).fill(0);
  bodies.forEach((b, i) => {
    const orig = b.setTranslation.bind(b);
    b.setTranslation = (p, wake) => {
      const c = b.translation();
      const dp = Math.hypot((p.x || 0) - c.x, (p.y || 0) - c.y, (p.z || 0) - c.z);
      if (lowSteps[i] > 8) pokeMm[i] = Math.max(pokeMm[i], dp * 1000);
      return orig(p, wake);
    };
  });
  if (kind === 'toss') {
    const toss = planCoinToss(rnd);
    bodies.forEach((b, i) => {
      const p = toss[i];
      b.setGravityScale(1, true);
      b.setTranslation({ x: p.x, y: p.y, z: p.z }, true);
      b.setRotation(p.q, true);
      b.setLinvel(p.v, true);
      b.setAngvel(p.w, true);
    });
  } else if (kind === 'stack') {
    bodies.forEach((b, i) => {
      b.setGravityScale(1, true);
      b.setTranslation({
        x: (i - 3) * 0.00005 + (rnd() - 0.5) * 0.00004,
        y: 0.004 + i * 0.004,
        z: (rnd() - 0.5) * 0.00004,
      }, true);
      b.setRotation({ x: 0, y: 0, z: 0, w: 1 }, true);
      b.setLinvel({ x: 0, y: 0, z: 0 }, true);
      b.setAngvel({ x: 0, y: (rnd() - 0.5) * 0.4, z: 0 }, true);
    });
  } else {
    // 바닥에 놓인 닢의 테에 다른 닢을 기대 둔다. 나머지는 근처로 떨어뜨린다.
    const lean = 42 * Math.PI / 180;
    bodies.forEach((b, i) => {
      b.setGravityScale(1, true);
      if (i === 0) {
        b.setTranslation({ x: -0.006, y: H_C, z: 0 }, true);
        b.setRotation({ x: 0, y: 0, z: 0, w: 1 }, true);
        b.setLinvel({ x: 0, y: 0, z: 0 }, true);
        b.setAngvel({ x: 0, y: 0, z: 0 }, true);
      } else if (i === 1) {
        const h = -lean / 2;
        b.setRotation({ x: 0, y: 0, z: Math.sin(h), w: Math.cos(h) }, true);
        const ny = Math.abs(Math.cos(lean));
        const half = H_C * ny + R_C * Math.sqrt(Math.max(0, 1 - ny * ny));
        b.setTranslation({ x: 0.008, y: half, z: (rnd() - 0.5) * 0.0002 }, true);
        b.setLinvel({ x: 0, y: 0, z: 0 }, true);
        b.setAngvel({ x: 0, y: 0, z: 0 }, true);
      } else {
        const a = rnd() * Math.PI * 2;
        b.setTranslation({
          x: Math.cos(a) * (0.03 + rnd() * 0.012),
          y: 0.03 + i * 0.004,
          z: Math.sin(a) * (0.018 + rnd() * 0.008),
        }, true);
        b.setRotation({ x: rnd(), y: rnd(), z: rnd(), w: rnd() }, true);
        const L = Math.hypot(b.rotation().x, b.rotation().y, b.rotation().z, b.rotation().w) || 1;
        const q = b.rotation();
        b.setRotation({ x: q.x / L, y: q.y / L, z: q.z / L, w: q.w / L }, true);
        b.setLinvel({ x: (rnd() - 0.5) * 0.12, y: 0.1 + rnd() * 0.15, z: (rnd() - 0.5) * 0.12 }, true);
        b.setAngvel({ x: (rnd() - 0.5) * 20, y: (rnd() - 0.5) * 8, z: (rnd() - 0.5) * 20 }, true);
      }
    });
  }

  let coinPrev = clonePose(bodies);
  let rendered = null;
  const trY = bodies.map(() => []);
  const trT = bodies.map(() => []);
  const trV = bodies.map(() => []);
  const nearFloor = new Array(7).fill(0);
  const contactAt = new Array(7).fill(-1);
  const sleepAt = new Array(7).fill(-1);
  const restFor = new Array(7).fill(0);
  const atRest = new Array(7).fill(false);
  const restFramesSeen = new Array(7).fill(0);
  const maxPos = new Array(7).fill(0);
  const maxRot = new Array(7).fill(0);
  const maxPosAll = new Array(7).fill(0);
  let frames = 0;
  let restFrames = 0;
  let badFrames = 0;
  let hitFrames = 0;
  const maxT = 10;
  let t = 0;
  let settledClock = null;
  while (t < maxT) {
    const dt = (1 / 60) * (0.86 + 0.28 * ((frames * 3 + seed) % 7) / 6);
    let acc = dt;
    if (acc > 0.05) acc = 0.05;
    const prevSpeed = bodies.map(speedOf);
    let guard = 0;
    while (acc >= COIN_DT && guard++ < 12) {
      for (let i = 0; i < bodies.length; i++) {
        const s = speedOf(bodies[i]);
        lowSteps[i] = (s.lin < REST_LIN && s.ang < REST_ANG) ? lowSteps[i] + 1 : 0;
      }
      coinPrev = clonePose(bodies);
      world.step();
      for (const b of bodies) dissipateCoinBody(b);
      projectCoinBodies(bodies);
      for (let i = 0; i < bodies.length; i++) {
        const p = bodies[i].translation(), q = bodies[i].rotation(), v = bodies[i].linvel();
        const ny = Math.abs(1 - 2 * (q.x * q.x + q.z * q.z));
        const tilt = Math.acos(Math.min(1, ny));
        const half = H_C * ny + R_C * Math.sqrt(Math.max(0, 1 - ny * ny));
        const gap = p.y - half;
        trY[i].push(p.y);
        trT[i].push(tilt);
        trV[i].push(v.y);
        const asleep = bodies[i].gravityScale() < 0.5 || bodies[i].isSleeping();
        if (gap < 0.001) nearFloor[i]++;
        else nearFloor[i] = 0;
        if (contactAt[i] < 0 && nearFloor[i] >= 8) contactAt[i] = trY[i].length - 1;
        if (asleep && sleepAt[i] < 0) sleepAt[i] = trY[i].length;
      }
      acc -= COIN_DT;
      t += COIN_DT;
    }
    // 앱 루프와 같이, 8초가 지나도 남으면 프레임마다 한 번 살며시 제동한다.
    if (t > 8) {
      for (const b of bodies) {
        if (b.gravityScale() < 0.5) continue;
        const v = b.linvel(), w = b.angvel();
        b.setLinvel({ x: v.x * 0.94, y: v.y, z: v.z * 0.94 }, false);
        b.setAngvel({ x: w.x * 0.92, y: w.y * 0.92, z: w.z * 0.92 }, false);
      }
    }
    const coinCurr = clonePose(bodies);
    const alpha = Math.min(1, Math.max(0, acc / Math.max(COIN_DT, 1e-8)));
    const draw = renderPose(coinPrev, coinCurr, alpha);
    const nowSpeed = bodies.map(speedOf);
    if (rendered) {
      let anyAwake = false;
      for (let i = 0; i < bodies.length; i++) {
        const dp = Math.hypot(draw[i].x - rendered[i].x, draw[i].y - rendered[i].y, draw[i].z - rendered[i].z);
        const da = quatAngle(draw[i].q, rendered[i].q);
        const wasRest = atRest[i];
        const asleep = bodies[i].gravityScale() < 0.5 || bodies[i].isSleeping();
        if (!asleep) {
          if (atRest[i]) {
            let hit = false;
            for (let j = 0; j < bodies.length; j++) if (j !== i) {
              const p = bodies[i].translation(), q = bodies[j].translation();
              const near = Math.hypot(p.x - q.x, p.y - q.y, p.z - q.z) < R_C * 2 + 0.004;
              if (near && (prevSpeed[j].lin > HIT_SPEED || nowSpeed[j].lin > HIT_SPEED)) hit = true;
            }
            if (hit) hitFrames++;
          }
          atRest[i] = false;
          anyAwake = true;
          restFramesSeen[i] = 0;
        } else {
          atRest[i] = true;
          restFramesSeen[i]++;
        }
        if (wasRest && atRest[i] && restFramesSeen[i] > 3) {
          const mm = dp * 1000;
          const deg = da * 180 / Math.PI;
          maxPos[i] = Math.max(maxPos[i], mm);
          maxRot[i] = Math.max(maxRot[i], deg);
          maxPosAll[i] = Math.max(maxPosAll[i], mm);
          restFrames++;
          if (mm > POS_MM || deg > ROT_DEG) badFrames++;
        } else anyAwake = true;
      }
      if (!anyAwake) {
        if (settledClock == null) settledClock = t;
        if (t - settledClock > 1.05) break;
      } else settledClock = null;
    }
    rendered = draw;
    frames++;
  }
  const pose = bodies.map(b => ({ p: b.translation(), q: b.rotation(), ti: tiltDeg(b.rotation()), sp: speedOf(b), asleep: b.gravityScale() < 0.5 || b.isSleeping() }));
  let stacked = 0, leaning = 0, heads = 0;
  for (let i = 0; i < pose.length; i++) {
    if ((1 - 2 * (pose[i].q.x ** 2 + pose[i].q.z ** 2)) > 0) heads++;
    let group = 1, y0 = pose[i].p.y, y1 = pose[i].p.y;
    for (let j = 0; j < pose.length; j++) if (j !== i) {
      const dx = pose[i].p.x - pose[j].p.x, dy = pose[i].p.y - pose[j].p.y, dz = pose[i].p.z - pose[j].p.z;
      if (Math.hypot(dx, dz) < 0.016 && pose[i].ti < 25 && pose[j].ti < 25) {
        group++;
        y0 = Math.min(y0, pose[j].p.y);
        y1 = Math.max(y1, pose[j].p.y);
      }
      if (pose[i].ti > 12 && pose[i].ti < 75 && Math.hypot(dx, dy, dz) < R_C * 2.3) leaning++;
    }
    if (group >= 2 && y1 - y0 > 0.0012) stacked++;
  }
  // 평평하게 포개진 쌍의 면 간격이 0.4mm 안이면 겹침 사슬. 일곱이 한 사슬이면 7(홀).
  const parent = pose.map((_, i) => i);
  const find = x => parent[x] === x ? x : (parent[x] = find(parent[x]));
  for (let i = 0; i < pose.length; i++) for (let j = i + 1; j < pose.length; j++) {
    if (pose[i].ti > 20 || pose[j].ti > 20) continue;
    const dx = pose[i].p.x - pose[j].p.x, dy = pose[i].p.y - pose[j].p.y, dz = pose[i].p.z - pose[j].p.z;
    if (Math.hypot(dx, dz) >= 2 * R_C) continue;
    if (Math.abs(dy) - 2 * H_C <= 0.0004) parent[find(i)] = find(j);
  }
  const comp = {};
  for (let i = 0; i < pose.length; i++) {
    const r = find(i);
    comp[r] = (comp[r] || 0) + 1;
  }
  const allSevenOdd = Math.max(...Object.values(comp)) === pose.length;
  const supOf = (q, dx, dy, dz) => {
    const L = Math.hypot(dx, dy, dz) || 1;
    const nx = dx / L, ny = dy / L, nz = dz / L;
    const ax = 2 * (q.x * q.y - q.w * q.z), ay = 1 - 2 * (q.x * q.x + q.z * q.z), az = 2 * (q.y * q.z + q.w * q.x);
    const c = Math.abs(nx * ax + ny * ay + nz * az);
    const s = Math.sqrt(Math.max(0, 1 - Math.min(1, c * c)));
    return H_C * c + R_C * s;
  };
  let maxTrayPen = 0, maxCoinPen = 0, tilt15 = 0, tilt15ok = 0, tilt15bad = 0;
  for (let i = 0; i < pose.length; i++) {
    if (!pose[i].asleep) continue;
    const ny = nyOf(pose[i].q);
    const half = H_C * ny + R_C * Math.sqrt(Math.max(0, 1 - Math.min(1, ny * ny)));
    const trayPen = half - pose[i].p.y;
    if (trayPen > maxTrayPen) maxTrayPen = trayPen;
    let bestGap = -Infinity, worstPen = 0;
    for (let j = 0; j < pose.length; j++) if (j !== i && pose[j].asleep) {
      const dx = pose[i].p.x - pose[j].p.x, dy = pose[i].p.y - pose[j].p.y, dz = pose[i].p.z - pose[j].p.z;
      let pen = supOf(pose[i].q, dx, dy, dz) + supOf(pose[j].q, -dx, -dy, -dz) - (Math.hypot(dx, dy, dz) || 1e-9);
      // 둘 다 거의 누웠고 그림자가 포개지면 면 사이 간격이 실제 파고듦이다.
      // 중심을 잇는 대각선 지지점은 포개진 닢을 수 mm 박힌 것으로 오인한다.
      if (pose[i].ti < 8 && pose[j].ti < 8 && Math.hypot(dx, dz) < 2 * R_C) {
        pen = 2 * H_C - Math.abs(dy);
      }
      if (pen > worstPen) worstPen = pen;
      if (pen > bestGap) bestGap = pen;
    }
    if (worstPen > maxCoinPen) maxCoinPen = worstPen;
    if (pose[i].ti > 15) {
      tilt15++;
      const supported = trayPen <= 0.00005 && worstPen <= 0.00005 && bestGap >= -0.0004;
      if (supported) tilt15ok++;
      else tilt15bad++;
    }
  }
  const flipsOf = (arr) => {
    let f = 0, prev = 0;
    for (const v of arr) {
      if (Math.abs(v) < 1e-5) continue;
      const s = Math.sign(v);
      if (prev && s !== prev) f++;
      prev = s;
    }
    return f;
  };
  const hfRms = (arr) => {
    if (arr.length < 24) return 0;
    const w = 16;
    let sum = 0, acc = 0, n = 0;
    for (let i = 0; i < arr.length; i++) {
      sum += arr[i];
      if (i >= w) sum -= arr[i - w];
      if (i >= w - 1) {
        const d = arr[i] - sum / w;
        acc += d * d;
        n++;
      }
    }
    return Math.sqrt(acc / Math.max(1, n));
  };
  let vyFlips = 0, tiltFlips = 0, hfY = 0, hfT = 0, chatterN = 0;
  for (let i = 0; i < bodies.length; i++) {
    const a = contactAt[i], b = sleepAt[i] < 0 ? trY[i].length : sleepAt[i];
    if (a < 0 || b - a < 24) continue;
    const ys = trY[i].slice(a, b);
    const ts = trT[i].slice(a, b);
    const vs = trV[i].slice(a, b);
    const dT = [];
    for (let k = 1; k < ts.length; k++) dT.push(ts[k] - ts[k - 1]);
    vyFlips = Math.max(vyFlips, flipsOf(vs));
    tiltFlips = Math.max(tiltFlips, flipsOf(dT));
    hfY = Math.max(hfY, hfRms(ys));
    hfT = Math.max(hfT, hfRms(ts));
    chatterN++;
  }
  let escaped = 0, minLow = Infinity;
  for (const o of pose) {
    const low = o.p.y - (H_C * nyOf(o.q) + R_C * Math.sqrt(Math.max(0, 1 - Math.min(1, nyOf(o.q) ** 2))));
    if (low < minLow) minLow = low;
    if (low < -0.002 || Math.abs(o.p.x) > TRAY_W / 2 + 0.01 || Math.abs(o.p.z) > TRAY_D / 2 + 0.01 || o.p.y > 0.45) escaped = 1;
  }
  const slept = bodies.filter(b => b.isSleeping() || b.gravityScale() < 0.5).length;
  world.free();
  return {
    kind, seed,
    maxPos: Math.max(...maxPos),
    maxRot: Math.max(...maxRot),
    maxPoke: Math.max(...pokeMm),
    badFrames,
    restFrames,
    hitFrames,
    stacked,
    leaning,
    allSevenOdd,
    maxTrayPen,
    maxCoinPen,
    tilt15,
    tilt15ok,
    tilt15bad,
    vyFlips,
    tiltFlips,
    hfY,
    hfT,
    heads,
    escaped,
    minLow,
    slept,
    frames,
    timedOut: settledClock == null,
    stillMoving: pose.filter(o => o.sp.lin > REST_LIN || o.sp.ang > REST_ANG).length,
    maxTilt: Math.max(...pose.map(o => o.ti)),
  };
}

const kinds = [];
for (let i = 0; i < N; i++) {
  const slot = i % 10;
  kinds.push(slot === 0 ? 'stack' : slot === 1 ? 'lean' : 'toss');
}
const rows = [];
const t0 = performance.now();
for (let i = 0; i < N; i++) rows.push(runToss(kinds[i], SEED0 + i * 997));
for (const r of rows) {
  if (r.maxPos > POS_MM || r.maxRot > ROT_DEG) {
    console.error('OUT', JSON.stringify({ kind: r.kind, seed: r.seed, maxPos: r.maxPos, maxRot: r.maxRot, timedOut: r.timedOut, still: r.stillMoving }));
  }
}
const wall = (performance.now() - t0) / 1000;

const num = k => rows.map(r => r[k]).sort((a, b) => a - b);
const q = (arr, p) => arr[Math.min(arr.length - 1, Math.max(0, Math.floor(p * (arr.length - 1))))];
const sum = k => rows.reduce((s, r) => s + r[k], 0);
const pos = num('maxPos');
const rot = num('maxRot');
const poke = num('maxPoke');
const report = {
  tosses: N,
  legacyVisual: LEGACY_VISUAL,
  rapier: RAPIER.version(),
  byKind: ['toss', 'stack', 'lean'].map(kind => {
    const sub = rows.filter(r => r.kind === kind);
    const mp = sub.map(r => r.maxPos).sort((a, b) => a - b);
    const mr = sub.map(r => r.maxRot).sort((a, b) => a - b);
    return {
      kind,
      n: sub.length,
      stackedThrows: sub.filter(r => r.stacked > 0).length,
      leaningThrows: sub.filter(r => r.leaning > 0).length,
      maxPos_mm: { p50: q(mp, 0.5), p90: q(mp, 0.9), max: mp[mp.length - 1] || 0 },
      maxRot_deg: { p50: q(mr, 0.5), p90: q(mr, 0.9), max: mr[mr.length - 1] || 0 },
      escaped: sub.reduce((s, r) => s + r.escaped, 0),
      timedOut: sub.filter(r => r.timedOut).length,
      stillMoving: sub.reduce((s, r) => s + r.stillMoving, 0),
    };
  }),
  rendered_pos_mm: { p50: q(pos, 0.5), p90: q(pos, 0.9), max: pos[pos.length - 1] },
  rendered_rot_deg: { p50: q(rot, 0.5), p90: q(rot, 0.9), max: rot[rot.length - 1] },
  position_poke_mm: { p50: q(poke, 0.5), p90: q(poke, 0.9), max: poke[poke.length - 1] },
  badFrames: sum('badFrames'),
  restFrames: sum('restFrames'),
  hitFrames: sum('hitFrames'),
  escaped: sum('escaped'),
  timedOut: rows.filter(r => r.timedOut).length,
  stackedThrows: rows.filter(r => r.stacked > 0).length,
  leaningThrows: rows.filter(r => r.leaning > 0).length,
  stackAllSevenOdd: rows.filter(r => r.kind === 'stack' && r.allSevenOdd).length,
  stackThrows: rows.filter(r => r.kind === 'stack').length,
  maxTrayPen_mm: Math.max(...rows.map(r => r.maxTrayPen)) * 1000,
  maxCoinPen_mm: Math.max(...rows.map(r => r.maxCoinPen)) * 1000,
  tilt15: sum('tilt15'),
  tilt15ok: sum('tilt15ok'),
  tilt15bad: sum('tilt15bad'),
  vyFlips: { p50: q(num('vyFlips'), 0.5), max: num('vyFlips').at(-1) },
  tiltFlips: { p50: q(num('tiltFlips'), 0.5), max: num('tiltFlips').at(-1) },
  hfY_mm: { p50: q(num('hfY'), 0.5) * 1000, max: num('hfY').at(-1) * 1000 },
  hfTilt_deg: { p50: q(num('hfT'), 0.5) * 180 / Math.PI, max: num('hfT').at(-1) * 180 / Math.PI },
  slept_avg: sum('slept') / N,
  heads: sum('heads') / (N * 7),
  lowest_mm: Math.min(...rows.map(r => r.minLow)) * 1000,
  wall_s: wall,
};
console.log(JSON.stringify(report, null, 2));

const fail = [];
if (report.rendered_pos_mm.max >= POS_MM) fail.push(`그린 자리 이동 최대 ${report.rendered_pos_mm.max.toFixed(4)}mm`);
if (report.rendered_rot_deg.max >= ROT_DEG) fail.push(`그린 회전 최대 ${report.rendered_rot_deg.max.toFixed(4)}°`);
if (report.escaped) fail.push(`상 밖 ${report.escaped}`);
if (report.stackedThrows < 1) fail.push('쌓인 결과가 없습니다');
if (report.leaningThrows < 1) fail.push('기댄 결과가 없습니다');
const stackRows = rows.filter(r => r.kind === 'stack');
const stackOdd = stackRows.filter(r => r.allSevenOdd).length;
report.stackAllSevenOdd = stackOdd;
if (stackRows.length && stackOdd < stackRows.length) fail.push(`일곱 포개 홀 ${stackOdd}/${stackRows.length}`);
if (report.maxTrayPen_mm > 0.05) fail.push(`상판 파고듦 ${report.maxTrayPen_mm.toFixed(3)}mm`);
if (report.maxCoinPen_mm > 0.05) fail.push(`닢 파고듦 ${report.maxCoinPen_mm.toFixed(3)}mm`);
if (report.tilt15bad) fail.push(`받침 없는 기울기 ${report.tilt15bad}`);
if (ASSERT && fail.length) {
  console.error('FAIL ' + fail.join('; '));
  process.exit(1);
}
if (!ASSERT && fail.length) console.error('MEASURE ' + fail.join('; '));
