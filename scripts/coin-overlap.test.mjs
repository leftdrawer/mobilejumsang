#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import test from 'node:test';
import vm from 'node:vm';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(join(root, 'index.html'), 'utf8');
const syncStart = html.indexOf('function syncCoins(alpha){');
const tiltStart = html.indexOf('const tiltOf=q=>');
const geometryStart = html.indexOf('const axisOf = q => {');
const judgeStart = html.indexOf('function judge(){');
const judgeEnd = html.indexOf('function syncTouchLine(){', judgeStart);
assert.ok(syncStart >= 0 && tiltStart > syncStart && geometryStart > tiltStart
  && judgeStart > geometryStart && judgeEnd > judgeStart,
  'production coin display adjustment, geometry and judge code must be present');

const syncCoins = html.slice(syncStart, tiltStart);
const tilt = html.slice(tiltStart, geometryStart);
const geometry = html.slice(geometryStart, judgeStart);
const judge = html.slice(judgeStart, judgeEnd);
const IDENTITY = Object.freeze({ x: 0, y: 0, z: 0, w: 1 });
const EDGE_ON = Object.freeze({ x: 0, y: 0, z: Math.SQRT1_2, w: Math.SQRT1_2 });

function judgeCoins(coins, { syncDisplay = false, padToSeven = true } = {}) {
  const all = coins.slice();
  while (padToSeven && all.length < 7) all.push({ p: { x: 0.2 + all.length * 0.04, y: 0.001, z: 0 }, q: IDENTITY });
  const context = {
    R_C: 0.012,
    H_C: 0.001,
    TOUCH: 0.0004,
    bodies: all.map(c => ({ rotation: () => c.q, translation: () => c.p })),
    meshes: all.map(c => {
      const position = { ...c.p, set(x, y, z) { Object.assign(this, { x, y, z }); } };
      const quaternion = { set(x, y, z, w) { Object.assign(this, { x, y, z, w }); } };
      return { position, quaternion, material: null };
    }),
    coinDead: 'dead',
    coinMat: 'clean',
    buildUI() {},
    syncTouchLine() {},
  };
  vm.createContext(context);
  vm.runInContext(`${syncCoins}\n${tilt}\n${geometry}\n${judge}\nglobalThis.__result=()=>({links:touchLinks,materials:meshes.map(m=>m.material),cleanCount,parityCount,allCoinsOverlapped,faceAll,faceClean,mode});`, context);
  if (syncDisplay) vm.runInContext('syncCoins()', context);
  vm.runInContext('judge()', context);
  return JSON.parse(vm.runInContext('JSON.stringify(__result())', context));
}
const coin = (x, y = 0.001, q = IDENTITY, z = 0) => ({ p: { x, y, z }, q });

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
  const result = judgeCoins([coin(0, 0.012, EDGE_ON), coin(0.020, 0.012, EDGE_ON)]);
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

test('display correction keeps the close lower pair separate: five singles are counted and odd', () => {
  const result = judgeCoins([
    coin(0), coin(0.010),
    coin(0.060), coin(0.080, 0.00875),
    coin(0.130), coin(0.170), coin(0.210),
  ], { syncDisplay: true });
  assert.deepEqual(result.links, [[0, 1]]);
  assert.equal(result.cleanCount, 5);
  assert.equal(result.parityCount, 5);
  assert.equal(result.parityCount % 2 ? '홀' : '짝', '홀');
  assert.equal(result.faceClean, 5);
});

test('when exactly five actual coins all overlap, each is counted once and the verdict is odd', () => {
  const result = judgeCoins(Array.from({ length: 5 }, () => coin(0)), { syncDisplay: true, padToSeven: false });
  assert.equal(result.allCoinsOverlapped, true);
  assert.equal(result.cleanCount, 0);
  assert.equal(result.parityCount, 5);
  assert.equal(result.parityCount % 2 ? '홀' : '짝', '홀');
});

test('when every coin overlaps, parity falls back to the actual seven-coin count', () => {
  const result = judgeCoins(Array.from({ length: 7 }, () => coin(0)), { syncDisplay: true });
  assert.equal(result.allCoinsOverlapped, true);
  assert.equal(result.cleanCount, 0);
  assert.equal(result.parityCount, 7);
  assert.equal(result.parityCount % 2 ? '홀' : '짝', '홀');
  assert.match(html, /\$\{parityCount%2\?'홀':'짝'\}/,
    'the displayed verdict must be derived from the computed coin count');
});
