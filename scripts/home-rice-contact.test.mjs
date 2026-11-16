#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import test from 'node:test';
import vm from 'node:vm';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(join(root, 'index.html'), 'utf8');
const helperStart = html.indexOf('let homeRiceAudit=()=>({});');
const helperEnd = html.indexOf('/* 엽전 무더기 */', helperStart);
assert.ok(helperStart >= 0 && helperEnd > helperStart,
  'production home-rice triangle sampler and mesh-support helper must be present');
const helperCode = html.slice(helperStart, helperEnd);
const homeStart = html.indexOf('/* 쌀 무더기 */');
const homeEnd = html.indexOf('/* 오방기 화면 */', homeStart);
assert.ok(homeStart >= 0 && homeEnd > homeStart,
  'the first-screen home rice pile must be present');
const home = html.slice(homeStart, homeEnd);

const context = vm.createContext({
  surfaceVertices: new Float64Array([
    -0.02, 0.2986, -0.02,
     0.02, 0.3046, -0.02,
    -0.02, 0.2954,  0.02,
     0.02, 0.3014,  0.02,
  ]),
  surfaceIndices: new Uint16Array([0, 1, 2, 1, 3, 2]),
});
vm.runInContext(`${helperCode}
` +
  'globalThis.surface=makeHomeRiceSurfaceSampler(surfaceVertices,surfaceIndices,0.004);\n' +
  'globalThis.ground=homeRiceGroundCenterY;', context);
const sample = (x, z) => vm.runInContext(`surface(${x},${z})`, context);

function rotate(q, [x, y, z]) {
  const { x: qx, y: qy, z: qz, w: qw } = q;
  const m00 = 1 - 2 * (qy * qy + qz * qz), m01 = 2 * (qx * qy - qz * qw), m02 = 2 * (qx * qz + qy * qw);
  const m10 = 2 * (qx * qy + qz * qw), m11 = 1 - 2 * (qx * qx + qz * qz), m12 = 2 * (qy * qz - qx * qw);
  const m20 = 2 * (qx * qz - qy * qw), m21 = 2 * (qy * qz + qx * qw), m22 = 1 - 2 * (qx * qx + qy * qy);
  return [m00 * x + m01 * y + m02 * z,
    m10 * x + m11 * y + m12 * z,
    m20 * x + m21 * y + m22 * z];
}

function minClearance(vertices, q, center, surfaceAt) {
  let min = Infinity;
  for (let i = 0; i < vertices.length; i += 3) {
    const [dx, dy, dz] = rotate(q, [vertices[i], vertices[i + 1], vertices[i + 2]]);
    min = Math.min(min, center.y + dy - surfaceAt(center.x + dx, center.z + dz));
  }
  return min;
}

const homeKernelVertices = new Float64Array([
  -0.0032175, 0, 0,  0.0032175, 0, 0,
  0, -0.001089, 0,  0, 0.001089, 0,
  0, 0, -0.001518,  0, 0, 0.001518,
  -0.0022, 0.00077, 0.0007,  0.0022, -0.00077, -0.0007,
  0.0013, 0.00054, 0.0010, -0.0013, -0.00054, -0.0010,
]);
const q = { x: 0.181, y: -0.092, z: 0.143, w: 0.964 };
const qLength = Math.hypot(q.x, q.y, q.z, q.w);
for (const k of Object.keys(q)) q[k] /= qLength;

test('home mound geometry and the tray share the same visible contact plane', () => {
  assert.match(html, /geo\.translate\(0,-geo\.boundingBox\.max\.y,0\)/,
    'the tray top is translated to y=0');
  assert.match(home, /mound\.position\.set\(0,0,0\)/,
    'the home mound base must be on the tray plane, not 0.5 mm above it');
  assert.match(home, /makeHomeRiceSurfaceSampler\(g\.attributes\.position\.array,g\.index\.array,0\.004\)/,
    'home grains must sample the rendered, wavy mound triangles');
});

test('transformed whole-kernel vertices meet the triangulated mound and tray surfaces', () => {
  const baseY = sample(0, 0);
  assert.ok(Math.abs(baseY - 0.3) < 1e-10, `expected plane height 0.3 m, got ${baseY}`);
  assert.equal(sample(0.1, 0.1), 0, 'outside the mound, support falls back to tray top y=0');

  context.vertices = homeKernelVertices;
  context.rotation = q;
  context.x = 0;
  context.z = 0;
  context.baseY = baseY + 0.003;
  const groundedOnMound = vm.runInContext(
    'ground(vertices,rotation,x,z,baseY,surface,0.00002)', context);
  assert.ok(Math.abs(minClearance(homeKernelVertices, q,
    { x: 0, y: groundedOnMound, z: 0 }, sample) + 0.00002) < 2e-9,
  'the lowest transformed vertex must be inset by only 0.02 mm into the actual mound triangle');

  const trayOnly = () => 0;
  const groundedOnTray = vm.runInContext(
    'ground(vertices,rotation,x,z,0,trayOnly,0.00002)',
    Object.assign(context, { trayOnly }));
  assert.ok(Math.abs(minClearance(homeKernelVertices, q,
    { x: 0.07, y: groundedOnTray, z: 0.03 }, trayOnly) + 0.00002) < 2e-9,
  'spilled grains must sit on the tray using their rotated mesh vertices');
});

test('home pile placement uses its actual radius, preserves grain size, and grounds both populations', () => {
  assert.match(home, /const MOUND_R=R-0\.0035/,
    'surface sampling uses the same radius as the rendered mound core');
  assert.match(home, /gg\.scale\(1\.95,0\.66,0\.92\)/,
    'the established kernel dimensions stay unchanged');
  assert.match(home, /new THREE\.SphereGeometry\(0\.00165,7,5\)/,
    'the home kernel base geometry stays unchanged');
  assert.equal((home.match(/homeRiceGroundCenterY\(/g) || []).length, 2,
    'both mound kernels and spilled kernels must be placed from their transformed vertices');
  assert.doesNotMatch(home, /nx\/nl\*0\.0016|ny\/nl\*0\.0016/,
    'the old outward normal lift that separated kernels from the pile must be gone');
  assert.match(html, /silkThread,silkGrains,gMound,homeRiceAudit,riceXZ:/,
    'the normal-view geometry exposes a debug audit for actual mesh-to-surface contact');
});
