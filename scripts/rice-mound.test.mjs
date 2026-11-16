#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import test from 'node:test';
import vm from 'node:vm';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(join(root, 'index.html'), 'utf8');
const heap = JSON.parse(readFileSync(join(root, 'assets/rice_heap_h.json'), 'utf8'));
const grains = JSON.parse(readFileSync(join(root, 'assets/rice_grains.json'), 'utf8'));
const samplerStart = html.indexOf('const heapStepX=');
const samplerEnd = html.indexOf('const heapGrainMat=', samplerStart);
assert.ok(samplerStart >= 0 && samplerEnd > samplerStart,
  'production height, normal and transformed-grain contact helpers must be present');
const placement = html.slice(samplerStart, samplerEnd);
const trayTopMatch = html.match(/const RICE_TRAY_TOP_Y=([^;]+);/);
assert.ok(trayTopMatch, 'the mound must use the explicit tray-top datum');
const trayTop = Number(trayTopMatch[1]);
const context = {
  nx: heap.nx, nz: heap.nz, x0: heap.x0, x1: heap.x1,
  z0: heap.z0, z1: heap.z1, h: heap.h, RICE_TRAY_TOP_Y: trayTop,
};
vm.createContext(context);
vm.runInContext(`${placement}
globalThis.sampleHeap=(x,z)=>heapHeightAt(x,z);
globalThis.normalAt=(x,z)=>heapNormalAt(x,z);
globalThis.contactShift=(...args)=>heapContactShift(...args);
globalThis.contactInset=HEAP_CONTACT_INSET;
globalThis.trayContactShift=(...args)=>heapTrayContactShift(...args);`, context);
const sampleHeap = (x, z) => vm.runInContext(`sampleHeap(${x},${z})`, context);
const normalAt = (x, z) => JSON.parse(vm.runInContext(`JSON.stringify(normalAt(${x},${z}))`, context));
const contactShift = (...args) => vm.runInContext(`contactShift(...__args)`, Object.assign(context, { __args: args }));
const trayContactShift = (...args) => vm.runInContext(`trayContactShift(...__args)`, Object.assign(context, { __args: args }));
const stepX = (heap.x1 - heap.x0) / (heap.nx - 1);
const stepZ = (heap.z1 - heap.z0) / (heap.nz - 1);
const vertex = (ix, iz) => heap.h[iz * heap.nx + ix];

function expectedTriangleHeight(ix, iz, fx, fz) {
  const a = vertex(ix, iz), b = vertex(ix + 1, iz);
  const c = vertex(ix, iz + 1), d = vertex(ix + 1, iz + 1);
  return trayTop + (fx + fz <= 1
    ? a * (1 - fx - fz) + c * fz + b * fx
    : b * (1 - fz) + c * (1 - fx) + d * (fx + fz - 1));
}

function normalized(v) {
  const n = Math.hypot(...v);
  return v.map(x => x / n);
}

function quaternionFromUp(n, twist = 0) {
  const align = normalized([-n.z, 0, n.x, 1 + n.y]);
  const spin = [0, Math.sin(twist / 2), 0, Math.cos(twist / 2)];
  const [ax, ay, az, aw] = align, [bx, by, bz, bw] = spin;
  return {
    x: aw * bx + ax * bw + ay * bz - az * by,
    y: aw * by - ax * bz + ay * bw + az * bx,
    z: aw * bz + ax * by - ay * bx + az * bw,
    w: aw * bw - ax * bx - ay * by - az * bz,
  };
}

function rotate(q, v) {
  const [x, y, z] = v, { x: qx, y: qy, z: qz, w: qw } = q;
  const m11 = 1 - 2 * (qy * qy + qz * qz), m12 = 2 * (qx * qy - qz * qw), m13 = 2 * (qx * qz + qy * qw);
  const m21 = 2 * (qx * qy + qz * qw), m22 = 1 - 2 * (qx * qx + qz * qz), m23 = 2 * (qy * qz - qx * qw);
  const m31 = 2 * (qx * qz - qy * qw), m32 = 2 * (qy * qz + qx * qw), m33 = 1 - 2 * (qx * qx + qy * qy);
  return [m11 * x + m12 * y + m13 * z, m21 * x + m22 * y + m23 * z, m31 * x + m32 * y + m33 * z];
}

function minTerrainClearance(positions, q, scale, x, y, z) {
  let min = Infinity;
  for (let i = 0; i < positions.length; i += 3) {
    const [px, py, pz] = rotate(q, [positions[i] * scale.x, positions[i + 1] * scale.y, positions[i + 2] * scale.z]);
    min = Math.min(min, y + py - sampleHeap(x + px, z + pz));
  }
  return min;
}

function minPlaneClearance(positions, q, scale, y, planeY) {
  let min = Infinity;
  for (let i = 0; i < positions.length; i += 3) {
    const [, py] = rotate(q, [positions[i] * scale.x, positions[i + 1] * scale.y, positions[i + 2] * scale.z]);
    min = Math.min(min, y + py - planeY);
  }
  return min;
}

test('mound sampling follows the rendered triangles on both sides of their diagonal', () => {
  const ix = 17, iz = 5;
  for (const [fx, fz] of [[0.25, 0.25], [0.75, 0.75], [0.2, 0.7], [0.7, 0.2]]) {
    const x = heap.x0 + (ix + fx) * stepX;
    const z = heap.z0 + (iz + fz) * stepZ;
    assert.ok(Math.abs(sampleHeap(x, z) - expectedTriangleHeight(ix, iz, fx, fz)) < 1e-10);
  }
});

test('the grain orientation uses the exact normal of the rendered height-map triangle', () => {
  for (const [x, z] of [[0.031, -0.030], [-0.018, -0.021], [0.026, -0.037]]) {
    const n = normalAt(x, z);
    const eps = 1e-7;
    const dhx = (sampleHeap(x + eps, z) - sampleHeap(x - eps, z)) / (2 * eps);
    const dhz = (sampleHeap(x, z + eps) - sampleHeap(x, z - eps)) / (2 * eps);
    const expected = normalized([-dhx, 1, -dhz]);
    assert.ok(Math.abs(n.x - expected[0]) < 0.04, `normal x mismatch at ${x},${z}`);
    assert.ok(Math.abs(n.y - expected[1]) < 0.04, `normal y mismatch at ${x},${z}`);
    assert.ok(Math.abs(n.z - expected[2]) < 0.04, `normal z mismatch at ${x},${z}`);
  }
});

test('whole and broken kernels are grounded from their transformed mesh vertices, not a guessed half-thickness', () => {
  const cases = [
    { x: 0.031, z: -0.030, size: 0.70, twist: 0.3 },
    { x: -0.018, z: -0.021, size: 0.66, twist: 1.4 },
    { x: 0.026, z: -0.037, size: 0.73, twist: 2.2 },
  ];
  for (const geometry of [grains.whole, grains.broken]) {
    for (const c of cases) {
      const n = normalAt(c.x, c.z);
      const q = quaternionFromUp(n, c.twist);
      const scale = { x: c.size, y: c.size * 0.98, z: c.size * 1.01 };
      const y = sampleHeap(c.x, c.z);
      const shift = contactShift(geometry.position, q, scale, c.x, y, c.z);
      const clearance = minTerrainClearance(geometry.position, q, scale, c.x, y + shift, c.z);
      assert.ok(Math.abs(clearance + 0.00018) < 2e-8,
        `${geometry === grains.whole ? 'whole' : 'broken'} grain contact ${clearance}m should be inset by 0.18mm`);
    }
  }
});

test('base-contact whole and broken kernels touch the tray using their transformed lowest vertices', () => {
  const q = { x: 0, y: Math.sin(0.4), z: 0, w: Math.cos(0.4) };
  for (const geometry of [grains.whole, grains.broken]) {
    const scale = { x: 0.70, y: 0.70 * 0.98, z: 0.70 * 1.01 };
    const shift = trayContactShift(geometry.position, q, scale, trayTop);
    const clearance = minPlaneClearance(geometry.position, q, scale, trayTop + shift, trayTop);
    assert.ok(Math.abs(clearance) < 1e-10,
      `${geometry === grains.whole ? 'whole' : 'broken'} kernel must meet tray plane exactly; got ${clearance}m`);
  }
});

test('Yomisan places a fixed real-grain rim on the tray beside the mound and preserves size and population', () => {
  assert.match(html, /const heapWholeCount=420, heapBrokenCount=22/);
  assert.match(html, /const heapBaseWholeCount=24, heapBaseBrokenCount=2/);
  assert.match(html, /const moundScreenScale=0\.70/);
  assert.match(html, /heapTrayContactShift\(geometry\.attributes\.position\.array,hq,hs,y\)/);
  assert.match(html, /needsBaseContact\?\(y>RICE_TRAY_TOP_Y\+1e-9\|\|!heapNearFoot\(x,z\)\)/);
  let footCandidates = 0;
  for (let iz = 1; iz < heap.nz - 1; iz++) {
    for (let ix = 1; ix < heap.nx - 1; ix++) {
      if (vertex(ix, iz) !== 0) continue;
      const touchesMound = [-1, 0, 1].some(dz => [-1, 0, 1].some(dx =>
        (dx || dz) && vertex(ix + dx, iz + dz) > 0.0015));
      if (touchesMound) footCandidates++;
    }
  }
  assert.ok(footCandidates >= 26,
    `the actual heightmap should provide at least 26 adjacent tray-level rim samples, got ${footCandidates}`);
});

test('the complete heightmap meets the tray at its zero-height boundary without a pedestal or broad shadow', () => {
  assert.equal(trayTop, 0);
  assert.match(html, /geo\.translate\(0,-geo\.boundingBox\.max\.y,0\)/,
    'the board geometry top must be translated to y=0');
  assert.match(html, /gMound\.position\.y=RICE_TRAY_TOP_Y/,
    'the mound transform must use the board-top datum');
  assert.match(html, /hgeo\.setAttribute\('position', new THREE\.Float32BufferAttribute\(hpos,3\)\)/,
    'the rendered mound must use the complete heightmap rather than a clipped shell');
  assert.match(html, /hgeo\.setIndex\(hidx\)/,
    'the rendered mound must keep the original heightmap triangles');
  assert.match(html, /heapCatch\.castShadow=false; heapCatch\.receiveShadow=true/,
    'the pile surface may receive grain contact but must not cast a broad black silhouette');
  assert.match(html, /riceBoard\.receiveShadow=true/,
    'the wooden board must still receive fine shadows from real rice grains');
  assert.doesNotMatch(html, /HEAP_SKIRT_START|buildHeapBoundarySkirt|heapSkirt|catchShadow/,
    'no projected sidewall, pedestal skirt, or duplicate shadow receiver may remain');

  const positions = [];
  for (let iz = 0; iz < heap.nz; iz++) {
    for (let ix = 0; ix < heap.nx; ix++) {
      positions.push(
        heap.x0 + (heap.x1 - heap.x0) * ix / (heap.nx - 1),
        trayTop + vertex(ix, iz),
        heap.z0 + (heap.z1 - heap.z0) * iz / (heap.nz - 1));
    }
  }
  const indices = [];
  for (let iz = 0; iz < heap.nz - 1; iz++) {
    for (let ix = 0; ix < heap.nx - 1; ix++) {
      const a = iz * heap.nx + ix, b = a + 1, c = a + heap.nx, d = c + 1;
      if ([vertex(ix, iz), vertex(ix + 1, iz), vertex(ix, iz + 1), vertex(ix + 1, iz + 1)]
        .every(h => h === 0)) continue;
      indices.push(a, c, b, b, c, d);
    }
  }
  const edges = new Map();
  for (let t = 0; t < indices.length; t += 3) {
    for (const [a, b] of [[indices[t], indices[t + 1]],
      [indices[t + 1], indices[t + 2]], [indices[t + 2], indices[t]]]) {
      const key = a < b ? `${a}:${b}` : `${b}:${a}`;
      edges.set(key, (edges.get(key) || 0) + 1);
    }
  }
  const boundary = [...edges].filter(([, count]) => count === 1)
    .map(([key]) => key.split(':').map(Number));
  assert.ok(boundary.length >= 20, `expected a substantial open mound edge, got ${boundary.length}`);
  for (const [a, b] of boundary) {
    assert.equal(positions[a * 3 + 1], trayTop,
      `open boundary vertex ${a} must meet the tray exactly`);
    assert.equal(positions[b * 3 + 1], trayTop,
      `open boundary vertex ${b} must meet the tray exactly`);
  }
  for (let ix = 0; ix < heap.nx; ix++) {
    assert.equal(vertex(ix, 0), 0);
    assert.equal(vertex(ix, heap.nz - 1), 0);
  }
  for (let iz = 0; iz < heap.nz; iz++) {
    assert.equal(heap.h[iz * heap.nx], 0);
    assert.equal(heap.h[iz * heap.nx + heap.nx - 1], 0);
  }
});
