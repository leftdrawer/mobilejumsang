import { writeFileSync, readFileSync } from 'node:fs';
// 요미산 더미를 낱알로 쏟아 가라앉힌다. 앱의 명주실·화상점 물리와는 따로다.
// 사용: node tools/heap_pour.mjs [개수] [안식각]
// 저폴리 알 메시는 /tmp/grain_lod.json (블렌더 데시메이트 결과).


const N = Number(process.argv[2] || 4600);
const REPOSE = Number(process.argv[3] || 33) * Math.PI / 180;
const COSR = Math.cos(REPOSE);
const R = 0.00148;
const DT = 1 / 90;
const G = 9.81;
const CELL = R * 2.05;

const px = new Float32Array(N), py = new Float32Array(N), pz = new Float32Array(N);
const vx = new Float32Array(N), vy = new Float32Array(N), vz = new Float32Array(N);
const BASE = 0.058;
const TAN = Math.tan(36 * Math.PI / 180);
const H = BASE * TAN;
const GAP = R * 2.15;
let filled = 0;
for (let y = R; filled < N - 180 && y < H; y += GAP * 0.92) {
  const rad = Math.max(0, (H - y) / TAN);
  for (let rr = 0; rr <= rad + GAP * 0.2 && filled < N - 180; rr += GAP) {
    const nRing = rr < GAP * 0.5 ? 1 : Math.max(1, Math.floor((2 * Math.PI * rr) / GAP));
    for (let k = 0; k < nRing && filled < N - 180; k++) {
      const a = (k / nRing) * Math.PI * 2 + y * 17;
      const jag = 1 + Math.sin(a * 2.0 + 0.6) * 0.06 + Math.sin(a * 5.0) * 0.03;
      const rHere = Math.min(rr, rad * jag);
      px[filled] = Math.cos(a) * rHere + (Math.random() - 0.5) * R * 0.15;
      pz[filled] = Math.sin(a) * rHere + (Math.random() - 0.5) * R * 0.15;
      py[filled] = y;
      filled++;
    }
  }
}
console.log('cone grains', filled, 'height', H.toFixed(4));
const coneN = filled;
for (let s = 0; s < 140 && filled < N; s++, filled++) {
  const a = Math.random() * Math.PI * 2;
  const rr = BASE * (0.92 + Math.random() * 0.45);
  px[filled] = Math.cos(a) * rr;
  pz[filled] = Math.sin(a) * rr;
  py[filled] = R;
}
const n = filled;
console.log('placed', n, 'cone', coneN);

const min2 = (R * 2) * (R * 2);
const grid = new Map();
function key(ix, iy, iz) { return ix * 73856093 + iy * 19349663 + iz * 83492791; }
function rebuild() {
  grid.clear();
  for (let i = 0; i < n; i++) {
    const k = key(Math.floor(px[i] / CELL), Math.floor(py[i] / CELL), Math.floor(pz[i] / CELL));
    let b = grid.get(k);
    if (!b) { b = []; grid.set(k, b); }
    b.push(i);
  }
}

const t0 = Date.now();
const STEPS = 48;
for (let step = 0; step < STEPS; step++) {
  for (let i = 0; i < n; i++) {
    py[i] -= 0.00015;
    px[i] += vx[i];
    pz[i] += vz[i];
    vx[i] = 0; vz[i] = 0;
  }
  for (let iter = 0; iter < 6; iter++) {
    for (let i = 0; i < n; i++) if (py[i] < R) py[i] = R;
    rebuild();
    for (let i = 0; i < n; i++) {
      const ix = Math.floor(px[i] / CELL), iy = Math.floor(py[i] / CELL), iz = Math.floor(pz[i] / CELL);
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
        const nb = grid.get(key(ix + dx, iy + dy, iz + dz));
        if (!nb) continue;
        for (const j of nb) {
          if (j <= i) continue;
          let ex = px[j] - px[i], ey = py[j] - py[i], ez = pz[j] - pz[i];
          let d2 = ex * ex + ey * ey + ez * ez;
          if (d2 >= min2) continue;
          if (d2 < 1e-12) { py[j] += R * 2; continue; }
          const d = Math.sqrt(d2);
          const nx = ex / d, ny = ey / d, nz = ez / d;
          const push = R * 2 - d;
          const iLock = py[i] <= R + 1e-6;
          const jLock = py[j] <= R + 1e-6;
          if (iLock && !jLock) { px[j] += nx * push; py[j] += ny * push; pz[j] += nz * push; }
          else if (jLock && !iLock) { px[i] -= nx * push; py[i] -= ny * push; pz[i] -= nz * push; }
          else {
            px[i] -= nx * push * 0.5; py[i] -= ny * push * 0.5; pz[i] -= nz * push * 0.5;
            px[j] += nx * push * 0.5; py[j] += ny * push * 0.5; pz[j] += nz * push * 0.5;
          }
        }
      }
    }
  }
  rebuild();
  for (let i = 0; i < n; i++) {
    let nx = 0, ny = 0, nz = 0, c = 0;
    const ix = Math.floor(px[i] / CELL), iy = Math.floor(py[i] / CELL), iz = Math.floor(pz[i] / CELL);
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
      const nb = grid.get(key(ix + dx, iy + dy, iz + dz));
      if (!nb) continue;
      for (const j of nb) {
        if (j === i || py[j] > py[i] + R * 0.2) continue;
        const ex = px[i] - px[j], ey = py[i] - py[j], ez = pz[i] - pz[j];
        const d = Math.hypot(ex, ey, ez);
        if (d > R * 2.4 || d < 1e-6) continue;
        nx += ex / d; ny += ey / d; nz += ez / d; c++;
      }
    }
    const onGround = py[i] < R * 1.8;
    if (onGround) ny += 1;
    if (c < 1 && !onGround) continue;
    const l = Math.hypot(nx, ny, nz) || 1;
    nx /= l; ny /= l; nz /= l;
    if (c < 5 && ny < COSR && py[i] < R * 4) {
      const dh = Math.hypot(nx, nz) || 1;
      px[i] += (-nx / dh) * R * 0.12;
      pz[i] += (-nz / dh) * R * 0.12;
    }
  }
  if (step % 40 === 0) {
    let top = 0, high = 0, stuck = 0;
    for (let i = 0; i < n; i++) {
      if (py[i] > top) top = py[i];
      if (py[i] > R * 3) high++;
      if (Math.hypot(vx[i], vz[i]) < 0.01) stuck++;
    }
    console.log('step', step, 'top', top.toFixed(4), 'high', high, 'stuck', stuck);
  }
}

const kept = [];
let off = 0;
for (let i = 0; i < n; i++) {
  if (Math.abs(px[i]) > 0.09 || Math.abs(pz[i]) > 0.064 || py[i] < 0) { off++; continue; }
  kept.push(i);
}
const base = kept.filter(i => py[i] < R * 3);
const baseR = base.map(i => Math.hypot(px[i], pz[i])).sort((a, b) => a - b);
const r90 = baseR[Math.floor(baseR.length * 0.82)] || 0.04;
let top = 0;
for (const i of kept) if (py[i] > top) top = py[i];
const slope = Math.atan2(top - R, r90) * 180 / Math.PI;
console.log(JSON.stringify({ kept: kept.length, off, repose: +(REPOSE * 180 / Math.PI).toFixed(1), top: +top.toFixed(4), r90: +r90.toFixed(4), slope: +slope.toFixed(1) }));

function normAt(i) {
  let nx = 0, ny = 0.35, nz = 0, c = 0;
  const ix = Math.floor(px[i] / CELL), iy = Math.floor(py[i] / CELL), iz = Math.floor(pz[i] / CELL);
  for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
    const nb = grid.get(key(ix + dx, iy + dy, iz + dz));
    if (!nb) continue;
    for (const j of nb) {
      if (j === i) continue;
      const ex = px[i] - px[j], ey = py[i] - py[j], ez = pz[i] - pz[j];
      const d = Math.hypot(ex, ey, ez);
      if (d > R * 3.2 || d < 1e-6) continue;
      nx += ex / d; ny += ey / d; nz += ez / d; c++;
    }
  }
  if (py[i] < R * 2.2) ny += 1.4;
  const l = Math.hypot(nx, ny, nz) || 1;
  return { x: nx / l, y: ny / l, z: nz / l };
}
function quat(n, yaw) {
  const yx = 0, yy = 1, yz = 0;
  let x = yx, y = yy, z = yz, w = 1;
  const dot = y * n.y;
  if (dot < -0.999) { x = 1; y = 0; z = 0; w = 0; }
  else {
    x = yz * n.z - 0 * n.y;
    y = 0;
    z = 0 * n.x - yx * n.z;
    // cross(Y, n) = (yz*nz - yz wait) cross((0,1,0), n) = (n.z, 0, -n.x)? 
    // i  j  k
    // 0  1  0
    // nx ny nz
    // = (1*nz - 0*ny, 0*nx - 0*nz, 0*ny - 1*nx) = (nz, 0, -nx)
    x = n.z; y = 0; z = -n.x;
    w = 1 + n.y;
    const l = Math.hypot(x, y, z, w) || 1;
    x /= l; y /= l; z /= l; w /= l;
  }
  const hy = Math.sin(yaw * 0.5), hw = Math.cos(yaw * 0.5);
  // twist around n, then apply align: q = twist * align? We want yaw around the normal after alignment.
  // q = align * twistLocal, twist local is around Y: (0, sin, 0, cos)
  const tx = 0, ty = hy, tz = 0, tw = hw;
  return {
    x: w * tx + x * tw + y * tz - z * ty,
    y: w * ty - x * tz + y * tw + z * tx,
    z: w * tz + x * ty - y * tx + z * tw,
    w: w * tw - x * tx - y * ty - z * tz,
  };
}

const mesh = JSON.parse(readFileSync('/tmp/grain_lod.json', 'utf8'));
const p = new Int16Array(kept.length * 3);
const q = new Int16Array(kept.length * 4);
const sc = new Uint8Array(kept.length);
kept.forEach((i, n) => {
  const nn = normAt(i);
  const qq = quat(nn, Math.random() * Math.PI * 2);
  p[n * 3] = Math.round(px[i] * 100000);
  p[n * 3 + 1] = Math.round(py[i] * 100000);
  p[n * 3 + 2] = Math.round(pz[i] * 100000);
  q[n * 4] = Math.round(qq.x * 32767);
  q[n * 4 + 1] = Math.round(qq.y * 32767);
  q[n * 4 + 2] = Math.round(qq.z * 32767);
  q[n * 4 + 3] = Math.round(qq.w * 32767);
  sc[n] = Math.floor(Math.random() * 256);
});
const b64 = (buf) => Buffer.from(buf).toString('base64');
const out = { n: kept.length, unit: 1e-5, mesh, p: b64(Buffer.from(p.buffer)), q: b64(Buffer.from(q.buffer)), sc: b64(Buffer.from(sc.buffer)) };
writeFileSync(new URL('../assets/heap_pile.json', import.meta.url), JSON.stringify(out));
console.log('bytes', Buffer.byteLength(JSON.stringify(out)));
