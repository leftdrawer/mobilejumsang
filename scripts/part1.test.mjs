// v1.3.12 버그 수정 확인.
// 주역 64괘는 앱의 yjLookup 을 그대로 떼어 전부 대조한다.
// 월드를 놓는 일은 묶인 Rapier 로 실제로 여러 번 만들고 놓아 WASM 힙이 선형으로 늘지 않는지 본다.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(join(root, 'index.html'), 'utf8');
const sw = readFileSync(join(root, 'sw.js'), 'utf8');

const grab = (start, endTok) => {
  const a = html.indexOf(start);
  assert.ok(a >= 0, `missing ${start}`);
  const b = html.indexOf(endTok, a);
  assert.ok(b > a, `missing end ${endTok} after ${start}`);
  return html.slice(a, b + endTok.length);
};

const code = [
  grab('const YJ_TEXT={', '\n};'),
  grab('const YJ_TRIGRAM=', '];'),
  grab('const YJ64 = (()=>{', '})();'),
  grab('function yjLookup(lines){', '\n}'),
].join('\n');
const { yjLookup, YJ64, YJ_TRIGRAM } = new Function(code + ';return {yjLookup,YJ64,YJ_TRIGRAM};')();

const TRI = {
  건: [1, 1, 1], 태: [1, 1, 0], 리: [1, 0, 1], 진: [1, 0, 0],
  손: [0, 1, 1], 감: [0, 1, 0], 간: [0, 0, 1], 곤: [0, 0, 0],
};
const nameTri = { 천: '건', 택: '태', 화: '리', 뢰: '진', 뇌: '진', 풍: '손', 수: '감', 산: '간', 지: '곤' };
const byLines = {};
for (const k in YJ64) {
  const [n, name] = YJ64[k];
  const up = name[0] === '중' ? nameTri[name[1]] : nameTri[name[0]];
  const lo = name[0] === '중' ? up : nameTri[name[1]];
  assert.ok(up && lo, `괘 이름에서 상하괘를 읽지 못함: ${name}`);
  byLines[[...TRI[lo], ...TRI[up]].join('')] = [n, name];
}
assert.equal(Object.keys(byLines).length, 64);

let wrong = 0;
const examples = [];
for (let v = 0; v < 64; v++) {
  const lines = [0, 1, 2, 3, 4, 5].map(i => (v >> i) & 1);
  const app = yjLookup(lines);
  const truth = byLines[lines.join('')];
  if (app.num !== truth[0] || app.name !== truth[1]) {
    wrong++;
    if (examples.length < 8) examples.push(`효(초→상) ${lines.join('')}: 앱=${app.num} ${app.name}, 실제=${truth[0]} ${truth[1]}`);
  }
}
assert.equal(wrong, 0, `틀린 괘 ${wrong}\n${examples.join('\n')}`);

// 점검 메모의 두 예. 화면은 위→아래, 배열은 아래→위.
const huan = yjLookup([0, 1, 0, 0, 1, 1]); // 위→아래 ⚊⚊⚋⚋⚊⚋ = 風水渙
assert.equal(huan.num, 59);
assert.equal(huan.name, '풍수환');
assert.equal(huan.hanja, '渙');
const cui = yjLookup([0, 0, 0, 1, 1, 0]); // 澤地萃. 하괘 곤, 상괘 태
assert.equal(cui.num, 45);
assert.equal(cui.name, '택지췌');
assert.equal(cui.hanja, '萃');
assert.equal(YJ_TRIGRAM[7], '건');
assert.equal(YJ_TRIGRAM[0], '곤');

const between = (a, b) => {
  const i = html.indexOf(a);
  const j = html.indexOf(b, i);
  assert.ok(i >= 0 && j > i, `${a} .. ${b}`);
  return html.slice(i, j);
};
const touch = between('function syncTouchLine(){', 'function toggleTouchDebug(){');
assert.ok(touch.includes('gCoin.add(touchGrp)'), '겹침 줄이 gCoin 에 들어가야 한다');
const build = between('function buildWorld(){', 'function spawnCoins(){');
assert.match(build, /const old=world; world=null; freeRapierWorld\(old\);/);
const rice = between('function riceWorld(){', 'function spawnRice(){');
assert.match(rice, /const old=rWorld; rWorld=null; freeRapierWorld\(old\);/);
const ui = between('function buildUI(){', 'function draw(){');
assert.match(ui, /if\(screen!=='santong'\)\{[\s\S]*if\(stMode==='shake'\)\{ stMode='idle'/);
// 흔드는 중에 들어온 buildUI(화면은 산통)는 shake 를 지우면 안 된다. 조건이 화면을 떠날 때뿐인지 확인.
assert.ok(ui.indexOf("if(screen!=='santong')") < ui.indexOf("if(stMode==='shake'){ stMode='idle'"));

// 은호당님이 확인한 법식은 이 수정에서 그대로다.
const flags = between('async function drawFlags(n){', 'function resetFlags(){');
assert.match(flags, /const bag=SET\.map\(f=>f\[0\]\)/);
const judge = between('function judge(){', 'function syncTouchLine(){');
assert.match(judge, /parityCount=allCoinsOverlapped\?P\.length:cleanCount/);

assert.match(html, /const APP_VERSION='1\.3\.12'/);
assert.match(html, /<div class="ver">v1\.3\.12<\/div>/);
assert.match(sw, /const CACHE = 'hyudae-jeomsang-1\.3\.12'/);

const scriptTags = html.match(/<script/g) || [];
const scriptEnds = html.match(/<\/script>/g) || [];
assert.equal(scriptTags.length, 5);
assert.equal(scriptEnds.length, 5);

const appStart = html.lastIndexOf('(async function main()');
const appEnd = html.indexOf('</script>', appStart);
const app = html.slice(appStart, appEnd);
new vm.Script(app, { filename: 'app-main.mjs' });

// Rapier 를 실제로 여러 번 만들고 놓는다. free 가 없으면 WASM 힙이 던지기마다 늘고,
// free 가 있으면 같은 자리를 다시 쓴다.
const rapierStart = html.indexOf('<script>(()=>{var C,s=new Array(128)');
const rapierEnd = html.indexOf('</script>', rapierStart);
const rapierCode = html.slice(rapierStart + '<script>'.length, rapierEnd);
let wasmMemory = null;
const origInstantiate = WebAssembly.instantiate;
WebAssembly.instantiate = async function (buf, imports) {
  const result = await origInstantiate.call(this, buf, imports);
  const inst = result.instance || result;
  if (inst.exports && inst.exports.memory) wasmMemory = inst.exports.memory;
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
assert.equal(typeof RAPIER.init, 'function');
await RAPIER.init();
WebAssembly.instantiate = origInstantiate;
assert.ok(wasmMemory, 'Rapier WASM 힙을 못 찾았다');
const bytes = () => wasmMemory.buffer.byteLength;

function makeCoinWorld() {
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  world.timestep = 1 / 180;
  const floor = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
  world.createCollider(RAPIER.ColliderDesc.cuboid(0.08, 0.01, 0.06).setTranslation(0, -0.01, 0), floor);
  const bodies = [];
  for (let i = 0; i < 7; i++) {
    const b = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation((i - 3) * 0.004, 0.04, 0));
    world.createCollider(RAPIER.ColliderDesc.cylinder(0.00075, 0.012).setDensity(8700), b);
    bodies.push(b);
  }
  for (let s = 0; s < 20; s++) world.step();
  return { world, bodies };
}

const N = 80;
const beforeLeak = bytes();
const kept = [];
for (let i = 0; i < N; i++) kept.push(makeCoinWorld().world);
const afterLeak = bytes();
for (const w of kept) w.free();

const beforeFree = bytes();
for (let i = 0; i < N; i++) makeCoinWorld().world.free();
const afterFree = bytes();
console.log(`wasm bytes: init-relative leak ${beforeLeak}→${afterLeak} (+${afterLeak - beforeLeak}), free-each ${beforeFree}→${afterFree} (+${afterFree - beforeFree})`);
assert.ok(afterLeak - beforeLeak > 0, 'free 없이 쌓으면 WASM 힙이 늘어야 이 시험이 의미 있다');
assert.equal(afterFree - beforeFree, 0, '월드를 놓고 다시 만들면 WASM 힙이 더 늘면 안 된다');

const { world, bodies } = makeCoinWorld();
world.free();
let threw = false;
try { bodies[0].translation(); } catch { threw = true; }
assert.equal(threw, true);

console.log('part1: 64괘 0개 틀림, 노란 줄·월드 free·산통 상태·버전 확인');
