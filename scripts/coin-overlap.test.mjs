#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import test from 'node:test';
import vm from 'node:vm';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(join(root, 'index.html'), 'utf8');
const geometryStart = html.indexOf('const axisOf = q => {');
const judgeStart = html.indexOf('function judge(){');
const judgeEnd = html.indexOf('function syncTouchLine(){', judgeStart);
assert.ok(geometryStart >= 0 && judgeStart > geometryStart && judgeEnd > judgeStart,
  'production coin geometry and judge code must be present');

const geometry = html.slice(geometryStart, judgeStart);
const judge = html.slice(judgeStart, judgeEnd);
const tilt = 'const tiltOf=q=>Math.acos(Math.min(1,Math.abs(1-2*(q.x*q.x+q.z*q.z))))*180/Math.PI;';
const IDENTITY = Object.freeze({ x: 0, y: 0, z: 0, w: 1 });
const EDGE_ON = Object.freeze({ x: 0, y: 0, z: Math.SQRT1_2, w: Math.SQRT1_2 });

function judgeCoins(coins) {
  const all = coins.slice();
  while (all.length < 7) all.push({ p: { x: 0.2 + all.length * 0.04, y: 0.00075, z: 0 }, q: IDENTITY });
  const context = {
    R_C: 0.012,
    H_C: 0.00075,
    TOUCH: 0.0004,
    bodies: all.map(c => ({ rotation: () => c.q })),
    meshes: all.map(c => ({ position: c.p, material: null })),
    coinDead: 'dead',
    coinMat: 'clean',
    buildUI() {},
    syncTouchLine() {},
  };
  vm.createContext(context);
  vm.runInContext(`${geometry}\n${tilt}\n${judge}\nglobalThis.__result=()=>({links:touchLinks,materials:meshes.map(m=>m.material),cleanCount,mode});`, context);
  vm.runInContext('judge()', context);
  return JSON.parse(vm.runInContext('JSON.stringify(__result())', context));
}
const coin = (x, y = 0.00075, q = IDENTITY, z = 0) => ({ p: { x, y, z }, q });

test('close horizontal centers separated in height are not classified as overlap', () => {
  const result = judgeCoins([coin(0), coin(0.020, 0.008)]);
  assert.deepEqual(result.links, []);
  assert.equal(result.materials[0], 'clean');
  assert.equal(result.materials[1], 'clean');
});

test('actual flat-cylinder overlap is caught even just beyond the former 1.94R cutoff', () => {
  const result = judgeCoins([coin(0), coin(0.0235)]);
  assert.deepEqual(result.links, [[0, 1]]);
  assert.equal(result.materials[0], 'dead');
  assert.equal(result.materials[1], 'dead');
});

test('nearby edge-on coins are not classified by their horizontal centers alone', () => {
  const result = judgeCoins([coin(0, 0.00075, EDGE_ON), coin(0.020, 0.00075, EDGE_ON)]);
  assert.deepEqual(result.links, []);
});

test('the documented 0.4 mm surface-contact tolerance is preserved', () => {
  const withinTolerance = judgeCoins([coin(0), coin(0.0242)]);
  const outsideTolerance = judgeCoins([coin(0), coin(0.0246)]);
  assert.deepEqual(withinTolerance.links, [[0, 1]]);
  assert.deepEqual(outsideTolerance.links, []);
});

test('only directly touching links are recorded in a three-coin chain', () => {
  const result = judgeCoins([coin(0), coin(0.0238), coin(0.0476)]);
  assert.deepEqual(result.links, [[0, 1], [1, 2]]);
});
