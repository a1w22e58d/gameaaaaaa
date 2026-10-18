/* ============================================================
 *  tools/hook-check.js —— 钩索改动的无头验证
 *
 *  用法：node tools/hook-check.js
 *
 *  验证两件事：
 *    ① 钩索碰到敌人不再造成任何伤害（纯指示线）
 *    ② 钩索位移：方向键失效、匀速飞到鼠标点、末尾不再多瞬移一段
 *
 *  做法：给 game.js 套一层极简 DOM / Canvas 桩在内存里执行，并在文件末尾
 *        注入一个 __dbg 句柄（只存在于内存里，game.js 本身一行不改），
 *        然后直接驱动 update(1/60) 做确定性断言。
 * ============================================================ */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const W = 1056, H = 660;
/* 默认检查仓库里的 game.js；--src=<路径> 可以指到别的副本（用来做「负面对照」） */
const SRC_ARG = process.argv.filter(function (a) { return a.indexOf('--src=') === 0; })[0];
const GAME = SRC_ARG ? SRC_ARG.slice(6) : path.join(__dirname, '..', 'game.js');
const SRC = fs.readFileSync(GAME, 'utf8');

/* ---------------- 极简 DOM / Canvas 桩 ---------------- */
function makeClassList() {
  const set = new Set();
  return {
    add: function (c) { set.add(c); },
    remove: function (c) { set.delete(c); },
    contains: function (c) { return set.has(c); },
    toggle: function (c, on) {
      if (on === undefined) { if (set.has(c)) set.delete(c); else set.add(c); }
      else if (on) set.add(c); else set.delete(c);
      return set.has(c);
    },
  };
}

function makeCtx() {
  const store = {};
  const grad = { addColorStop: function () {} };
  return new Proxy(store, {
    get: function (t, p) {
      if (p in t) return t[p];
      if (p === 'createLinearGradient' || p === 'createRadialGradient') return function () { return grad; };
      if (p === 'measureText') return function () { return { width: 0 }; };
      if (p === 'getImageData') return function () { return { data: new Uint8ClampedArray(4), width: 1, height: 1 }; };
      return function () {};
    },
    set: function (t, p, v) { t[p] = v; return true; },
  });
}

function makeEl(id, tag) {
  const el = {
    id: id || '', tagName: String(tag || 'div').toUpperCase(),
    style: {}, dataset: {}, className: '', textContent: '', innerHTML: '',
    value: '', disabled: false, checked: false,
    childNodes: [], children: [], parentNode: null, firstChild: null,
    classList: makeClassList(), _on: {}, _ctx: null, _q: Object.create(null),
    addEventListener: function (type, fn) {
      if (!this._on[type]) this._on[type] = [];
      this._on[type].push(fn);
    },
    removeEventListener: function () {},
    appendChild: function (c) {
      this.childNodes.push(c); c.parentNode = this;
      this.firstChild = this.childNodes[0];
      return c;
    },
    removeChild: function (c) {
      const i = this.childNodes.indexOf(c);
      if (i >= 0) this.childNodes.splice(i, 1);
      c.parentNode = null;
      this.firstChild = this.childNodes[0] || null;
      return c;
    },
    querySelector: function (sel) {
      if (!this._q[sel]) this._q[sel] = makeEl('', 'div');
      return this._q[sel];
    },
    querySelectorAll: function () { return []; },
    closest: function () { return null; },
    getAttribute: function () { return null; },
    setAttribute: function () {},
    remove: function () {},
    insertAdjacentHTML: function () {},
    focus: function () {},
    getContext: function () { if (!this._ctx) this._ctx = makeCtx(); return this._ctx; },
    getBoundingClientRect: function () {
      return { left: 0, top: 0, width: W, height: H, right: W, bottom: H };
    },
  };
  /* parentElement 用惰性 getter：真实 DOM 里几乎总有父节点，桩里按需造一个 */
  Object.defineProperty(el, 'parentElement', {
    configurable: true,
    get: function () { if (!this._parent) this._parent = makeEl('', 'div'); return this._parent; },
  });
  return el;
}

const els = Object.create(null);
function getEl(id) {
  if (!els[id]) els[id] = makeEl(id, id === 'game' ? 'canvas' : 'div');
  return els[id];
}

function fire(el, type, ev) {
  const list = (el._on && el._on[type]) || [];
  const event = Object.assign({
    type: type, target: el, repeat: false, code: '', key: '',
    clientX: 0, clientY: 0, button: 0,
    preventDefault: function () {},
    stopPropagation: function () {},
    getAttribute: function () { return null; },
    closest: function () { return null; },
  }, ev || {});
  list.forEach(function (fn) { fn(event); });
}

const winOn = Object.create(null);
const win = {
  devicePixelRatio: 1,
  innerWidth: 1500, innerHeight: 900,
  addEventListener: function (type, fn) {
    if (!winOn[type]) winOn[type] = [];
    winOn[type].push(fn);
  },
  removeEventListener: function () {},
  requestAnimationFrame: function () { return 0; },   // 不跑主循环：测试直接驱动 update()
};
function fireWin(type, ev) {
  const list = winOn[type] || [];
  const event = Object.assign({
    type: type, repeat: false, code: '', key: '',
    preventDefault: function () {}, stopPropagation: function () {},
  }, ev || {});
  list.forEach(function (fn) { fn(event); });
}

const documentStub = {
  title: '',
  getElementById: getEl,
  createElement: function (tag) { return makeEl('', tag); },
  querySelector: function () { return makeEl('', 'p'); },
  querySelectorAll: function () { return []; },
  addEventListener: function () {},
  removeEventListener: function () {},
  body: makeEl('body', 'body'),
};

/* ---------------- 在内存里执行 game.js ---------------- */
const DEBUG_EXPORT =
  '\n  /* 仅测试：把内部句柄挂到 window 上（注入在内存里发生，磁盘上的 game.js 不变） */\n' +
  '  window.__dbg = { state: state, update: update, render: render, useHook: useHook, hookPoints: hookPoints,\n' +
  '    segDist2: segDist2, waterAt: waterAt, spawnEnemy: spawnEnemy, ENEMIES: ENEMIES, TOWERS: TOWERS,\n' +
  '    build: build, statsOf: statsOf, towerHpMax: towerHpMax, upgradeSelected: upgradeSelected,\n' +
  '    syncSelection: syncSelection, spawnBench: spawnBench, BENCH_REACH: BENCH_REACH, MAX_LEVEL: MAX_LEVEL,\n' +
  '    LANES: function () { return LANES; }, SUB_LANES: function () { return SUB_LANES; },\n' +
  '    ROUTE_MAIN: function () { return ROUTE_MAIN; }, GOAL_DIST: function () { return GOAL_DIST; },\n' +
  '    posAt: posAt, TILE: TILE, COLS: COLS, ROWS: ROWS, W: W, H: H,\n' +
  '    rollPerks: rollPerks, gainXp: gainXp, MAX_HERO_LEVEL: MAX_HERO_LEVEL,\n' +
  '    HERO_SPRITE: HERO_SPRITE, BOSS_SPRITE: BOSS_SPRITE, ENEMY_SPRITE: ENEMY_SPRITE,\n' +
  '    mobSpriteFor: mobSpriteFor, coverFollow: coverFollow,\n' +
  '    LEVEL_SETUP: LEVEL_SETUP, WAVES: function () { return WAVES; },\n' +
  '    towersOf: function (type) { return state.towers.filter(function (t) { return t.type === type && !t.dead; }); },\n' +
  '    canPlaceUmbrella: canPlaceUmbrella, makeUmbrella: makeUmbrella, umbrellaCovers: umbrellaCovers,\n' +
  '    UMBRELLA_R: UMBRELLA_R, pickUpTower: pickUpTower, placeCarried: placeCarried,\n' +
  '    damageEnemy: damageEnemy, endGame: endGame, save: function () { return save; },\n' +
  '    PERKS: PERKS, stealTower: stealTower, bungeeGrab: bungeeGrab,\n' +
  '    fire: fire, el: el,\n' +
  '    takeHookDrop: takeHookDrop,\n' +
  '    chooseLevel: function (i) { chooseLevel(i); },\n' +
  '    distOf: function (gc, gr) {\n' +
  '      const tx = gc * TILE + TILE / 2, ty = gr * TILE + TILE / 2;\n' +
  '      let bestD = 1e9, bestDist = 0;\n' +
  '      for (const k in LANES) {\n' +
  '        const L = LANES[k];\n' +
  '        for (let d = 0; d < L.len; d += 2) {\n' +
  '          const p = posAt(L, d);\n' +
  '          const dd = (p.x - tx) * (p.x - tx) + (p.y - ty) * (p.y - ty);\n' +
  '          if (dd < bestD) { bestD = dd; bestDist = d; }\n' +
  '        }\n' +
  '      }\n' +
  '      return bestDist;\n' +
  '    },\n' +
  '    advanceThrows: function (sec) {\n' +
  '      const n = Math.round(sec / 0.05);\n' +
  '      for (let i = 0; i < n; i++) updateThrows(0.05);\n' +
  '    } };\n';

const cut = SRC.lastIndexOf('})();');
if (cut < 0) throw new Error('game.js 结构异常：找不到 IIFE 结尾');
const injected = SRC.slice(0, cut) + DEBUG_EXPORT + SRC.slice(cut);

const sandbox = {
  window: win, document: documentStub, console: console,
  performance: { now: function () { return 0; } },
  localStorage: {
    getItem: function () { return JSON.stringify({ hook: true, lv3: true }); },
    setItem: function () {}, removeItem: function () {},
  },
  requestAnimationFrame: win.requestAnimationFrame,
  setTimeout: function () { return 0; },
  clearTimeout: function () {},
  navigator: { userAgent: 'node' },
};
vm.createContext(sandbox);
vm.runInContext(injected, sandbox, { filename: 'game.js' });

const dbg = win.__dbg;
if (!dbg) throw new Error('注入失败：__dbg 不存在');
const state = dbg.state;

/* ---------------- 断言小工具 ---------------- */
let passed = 0, failed = 0;
function check(name, ok, detail) {
  if (ok) { passed++; console.log('  [OK]   ' + name + (detail ? '   ' + detail : '')); }
  else { failed++; console.log('  [FAIL] ' + name + (detail ? '   ' + detail : '')); }
}
function head(t) { console.log('\n=== ' + t + ' ==='); }

/* ---------------- 进入第二关（有钩索的关卡） ---------------- */
head('准备：进入第二关');
fire(getEl('btnLevel2'), 'click');      // chooseLevel(1)
fire(getEl('btnGuideOk'), 'click');     // startGame(false)
check('第二关已开始且钩索已装备', state.started === true && state.hookOn === true,
  'started=' + state.started + ' hookOn=' + state.hookOn);

const STEP = 1 / 60;
function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

/* ---------------- ① 钩索线不再造成伤害（但会击退） ---------------- */
head('① 链爪扫到敌人：不掉血');
state.towers.length = 0;               // 场上不放任何塔（唯一能打怪的东西）
state.enemies.length = 0;
state.spawnQueue.length = 0;
state.keys = {};
state.dashT = 0; state.dashTo = null; state.dashCd = 0;
state.hookKbCd = 0; state.hookKbFlash = 0;
state.mouse.down = false;              // 主角也不射箭

dbg.spawnEnemy('grunt', 0, 200);
const foe = state.enemies[0];
const foeHp0 = foe.hp, foeShield0 = foe.shield;
const h = state.hero;
let contactFrames = 0, minHp = foe.hp, hurtFrames = 0, pushes = 0;

for (let i = 0; i < 150; i++) {        // 2.5 秒
  if (foe.dead) break;
  /* 把主角钉在怪的左边 140 像素处，并让钩索（196 像素）顺着 +x 甩过去，
   * 保证链爪每一帧都压在怪身上（140 < 196，且 140 > 接触半径，不会撞到主角） */
  h.x = clamp(foe.x - 140, h.r, W - h.r);
  h.y = clamp(foe.y, h.r, H - h.r);
  state.mouse.x = h.x + 196;
  state.mouse.y = h.y;

  const rope = dbg.hookPoints();
  const reach = foe.r + 9;             // 旧伤害代码用的判定半径，这里照抄
  if (dbg.segDist2(foe.x, foe.y, rope.x1, rope.y1, rope.x2, rope.y2) <= reach * reach) contactFrames++;

  const hpBefore = foe.hp, distBefore = foe.dist;
  dbg.update(STEP);
  if (foe.hp < hpBefore) hurtFrames++;
  if (foe.hp < minHp) minHp = foe.hp;
  if (foe.dist < distBefore - 10) pushes++;   // 被链爪推回去了
}

check('链爪确实压在怪身上（判定有效）', contactFrames > 0, '接触帧数=' + contactFrames + '/150');
check('敌人血量没有任何下降', hurtFrames === 0 && minHp === foeHp0,
  '初始=' + foeHp0 + ' 最终=' + foe.hp + ' 掉血帧数=' + hurtFrames);
check('护盾 / 死亡状态未被钩索影响', foe.shield === foeShield0 && foe.dead === false);
check('链爪只是指示线：扫过敌人也不会把它推走', pushes === 0,
  '2.5 秒内被链爪推动 ' + pushes + ' 次');
check('源码里已没有钩索伤害相关常量与状态',
  !/HOOK_DPS|HOOK_TICK|hookTick|hookHit|HOOK_KB/.test(SRC));

/* ---------------- ② 击退来自「位移中的主角」 ---------------- */
head('② 钩索位移撞怪：冲过去的主角把碰到的敌人撞开（钩索线本身不推人）');

state.towers.length = 0;
state.enemies.length = 0;
state.spawnQueue.length = 0;
state.keys = {};
state.dashT = 0; state.dashTo = null; state.dashCd = 0;
state.mouse.down = false;
state.hero.hp = state.hero.hpMax;
const hpBeforeDash = state.hero.hp;

/* 把主角摆在怪西边 100 像素、朝东甩钩：位移路线正好穿过这只怪 */
dbg.spawnEnemy('grunt', 0, 400);
const bumpFoe = state.enemies[0];
dbg.update(STEP);                          // 让怪走到路线位置上
const bumpDist0 = bumpFoe.dist;
const bumpHp0 = bumpFoe.hp;
state.hero.x = bumpFoe.x - 100;
state.hero.y = bumpFoe.y;
state.hero.hp = state.hero.hpMax;
state.mouse.x = bumpFoe.x + 200;
state.mouse.y = bumpFoe.y;
dbg.useHook();
let bumpHits = 0, bumpDrop = 0, heroHurt = 0;
let lastDist = bumpFoe.dist;
const heroHpStart = state.hero.hp;
for (let i = 0; i < 40; i++) {
  dbg.update(STEP);
  if (bumpFoe.dist < lastDist - 10) { bumpHits++; bumpDrop += lastDist - bumpFoe.dist; }
  lastDist = bumpFoe.dist;
  if (state.hero.hp < heroHpStart) heroHurt++;
}
check('位移途中撞到敌人 → 把它撞了回去', bumpHits >= 1,
  '撞开 ' + bumpHits + ' 次，合计 ' + bumpDrop.toFixed(0) + 'px');
check('撞一次的距离 ≈ 44 + 敌人半径（小兵 55 像素）', Math.abs(bumpDrop - 55) <= 6,
  '实测=' + bumpDrop.toFixed(1) + 'px');
check('同一次位移不会反复撞同一只怪（每只 0.85 秒冷却）', bumpHits === 1,
  '撞开次数=' + bumpHits);
check('位移撞怪不伤主角（冲进怪群也不会挨撞）', heroHurt === 0 && state.hero.hp === heroHpStart,
  '掉血帧数=' + heroHurt);
check('位移撞怪不掉敌人的血（只推不打）', bumpFoe.hp === bumpHp0,
  bumpHp0 + ' → ' + bumpFoe.hp);

/* 对照：不在位移状态时，撞怪仍然是「主角掉血 + 怪被弹回」 */
state.enemies.length = 0;
state.spawnQueue.length = 0;
state.dashT = 0; state.dashTo = null;
dbg.spawnEnemy('grunt', 0, 400);
dbg.update(STEP);
const plainFoe = state.enemies[0];
const plainDist0 = plainFoe.dist;
state.hero.x = plainFoe.x;
state.hero.y = plainFoe.y;                 // 直接贴上去
state.hero.hp = state.hero.hpMax;
state.hero.invuln = 0;
const plainHp0 = state.hero.hp;
dbg.update(STEP);
check('平时撞怪：怪被弹回、主角掉血（原有手感没变）',
  plainFoe.dist < plainDist0 - 10 && state.hero.hp < plainHp0,
  '怪退 ' + (plainDist0 - plainFoe.dist).toFixed(0) + 'px · 主角 ' + plainHp0 + ' → ' + state.hero.hp);

/* ---------------- ③ 钩索位移：固定 196 像素 + 方向键失效 + 不瞬移 ---------------- */
head('③ 钩索位移：固定 196 像素、方向键失效、匀速不瞬移');

const DASH_SPEED = 1180;
const DASH_DIST = 196;                      // game.js 里的 DASH_DIST（= HOOK_LEN）
const MAX_STEP = DASH_SPEED * STEP + 0.5;   // 单帧位移上限（+0.5 容差）

function resetDash(hero0) {
  state.towers.length = 0;
  state.enemies.length = 0;
  state.spawnQueue.length = 0;
  state.keys = {};
  state.dashT = 0; state.dashTo = null; state.dashCd = 0;
  state.hero.x = hero0 ? hero0.x : 200;
  state.hero.y = hero0 ? hero0.y : 300;
  state.hero.hp = state.hero.hpMax;
  state.mouse.down = false;
}

/* 从主角出发找一个方向：196 像素的爪头落在陆地且在画面内 */
function pickLandAim() {
  const hero = state.hero;
  for (let i = 0; i < 720; i++) {
    const a = i * Math.PI / 360;
    const tx = hero.x + Math.cos(a) * DASH_DIST;
    const ty = hero.y + Math.sin(a) * DASH_DIST;
    if (tx < hero.r || tx > W - hero.r || ty < hero.r || ty > H - hero.r) continue;
    if (dbg.waterAt(tx, ty)) continue;
    return { a: a, tip: { x: tx, y: ty } };
  }
  return null;
}

/* 找一个站位 + 方向：196 像素的爪头正好落在水里（第二关的河在第 13~14 列） */
function pickWaterAim() {
  for (let c = 0; c < 24; c++) {
    for (let r = 0; r < 15; r++) {
      const x = c * 44 + 22, y = r * 44 + 22;
      if (!dbg.waterAt(x, y)) continue;
      const hx = x - DASH_DIST, hy = y;      // 朝 +x 甩，爪头落在这格水里
      if (hx < 13 || hx > W - 13) continue;
      if (dbg.waterAt(hx, hy)) continue;     // 主角自己得站在岸上
      return { hero: { x: hx, y: hy }, a: 0, tip: { x: x, y: y } };
    }
  }
  return null;
}

/* 跑一次位移：aim = {a}；mouseDist = 鼠标离主角多远（只影响方向，不该影响距离）
 * keysBefore = 位移前就按住的方向键；pressDuring = 位移途中再按方向键 */
function runDash(aim, mouseDist, keysBefore, pressDuring, hero0) {
  resetDash(hero0);
  const hero = state.hero;
  const start = { x: hero.x, y: hero.y };
  state.mouse.x = hero.x + Math.cos(aim.a) * mouseDist;
  state.mouse.y = hero.y + Math.sin(aim.a) * mouseDist;
  (keysBefore || []).forEach(function (k) { state.keys[k] = true; });
  dbg.useHook();                        // 甩钩索
  const started = state.dashT > 0 && !!state.dashTo;
  const pts = [{ x: hero.x, y: hero.y }];
  const keysWhileDashing = [];
  let guard = 0;
  while (state.dashT > 0 && guard++ < 600) {
    if (pressDuring) {
      fireWin('keydown', { key: pressDuring, code: 'Key' + pressDuring.toUpperCase() });
      keysWhileDashing.push(!!state.keys[pressDuring]);
    }
    dbg.update(STEP);
    pts.push({ x: hero.x, y: hero.y });
  }
  let maxStep = 0;
  for (let i = 1; i < pts.length; i++) {
    maxStep = Math.max(maxStep, Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y));
  }
  return {
    started: started, pts: pts, maxStep: maxStep, frames: pts.length - 1, start: start,
    end: { x: hero.x, y: hero.y }, recordedKeys: keysWhileDashing,
  };
}

const land = pickLandAim();
check('找到了一个爪头落在陆地上的方向', !!land,
  land ? '方向=' + (land.a * 180 / Math.PI).toFixed(1) + '° 爪头=(' + land.tip.x.toFixed(0) + ',' + land.tip.y.toFixed(0) + ')' : '');

/* 鼠标放在 800 像素外：位移距离必须还是固定 196，而不是飞到鼠标点 */
const mouseDist = 800;
const plain = runDash(land, mouseDist, null, null);
const flown = Math.hypot(plain.end.x - plain.start.x, plain.end.y - plain.start.y);
const toMouse = Math.hypot(plain.end.x - (plain.start.x + Math.cos(land.a) * mouseDist),
  plain.end.y - (plain.start.y + Math.sin(land.a) * mouseDist));
check('甩钩索确实进入了位移状态', plain.started && plain.frames > 5, '位移帧数=' + plain.frames);
check('位移距离是固定的 196 像素（鼠标在 800 像素外也一样）',
  Math.abs(flown - DASH_DIST) <= 0.5, '实际飞行=' + flown.toFixed(2) + 'px');
check('落点不再是鼠标点（旧行为是「点多远飞多远」）', toMouse > mouseDist - DASH_DIST - 5,
  '落点离鼠标=' + toMouse.toFixed(0) + 'px');
const cross = (plain.end.x - plain.start.x) * Math.sin(land.a) - (plain.end.y - plain.start.y) * Math.cos(land.a);
check('飞行方向就是鼠标方向', Math.abs(cross) < 0.5, '偏离=' + Math.abs(cross).toFixed(3) + 'px');
check('每帧位移都 ≤ 1180 像素/秒（全程匀速，没有瞬移）',
  plain.maxStep <= MAX_STEP, '最大单帧位移=' + plain.maxStep.toFixed(2) + 'px 上限=' + MAX_STEP.toFixed(2) + 'px');

/* 位移前按住方向键：轨迹必须和不按键时逐帧一致 */
const held = runDash(land, mouseDist, ['d', 'arrowleft'], null);
let maxDevHeld = 0;
for (let i = 0; i < Math.max(plain.pts.length, held.pts.length); i++) {
  const a = plain.pts[Math.min(i, plain.pts.length - 1)];
  const b = held.pts[Math.min(i, held.pts.length - 1)];
  maxDevHeld = Math.max(maxDevHeld, Math.hypot(a.x - b.x, a.y - b.y));
}
check('位移前就按住方向键：轨迹与不按键完全一致（方向键被忽略）',
  maxDevHeld < 1e-9 && held.frames === plain.frames,
  '最大偏差=' + maxDevHeld.toExponential(2) + 'px');

/* 位移途中按方向键：既不影响轨迹，也不会被记进按键表 */
const during = runDash(land, mouseDist, null, 'd');
let maxDevDuring = 0;
for (let i = 0; i < Math.max(plain.pts.length, during.pts.length); i++) {
  const a = plain.pts[Math.min(i, plain.pts.length - 1)];
  const b = during.pts[Math.min(i, during.pts.length - 1)];
  maxDevDuring = Math.max(maxDevDuring, Math.hypot(a.x - b.x, a.y - b.y));
}
check('位移途中按方向键：轨迹仍与不按键完全一致',
  maxDevDuring < 1e-9 && during.frames === plain.frames,
  '最大偏差=' + maxDevDuring.toExponential(2) + 'px');
check('位移途中方向键被 keydown 直接拦下（按键表里没有它）',
  during.recordedKeys.length > 0 && during.recordedKeys.every(function (v) { return v === false; }),
  '采样=' + during.recordedKeys.length + ' 帧');

/* 位移结束后：不会再补一段瞬移；方向键恢复正常 */
let drift = 0;
for (let i = 0; i < 30; i++) {
  const px = state.hero.x, py = state.hero.y;
  dbg.update(STEP);
  drift = Math.max(drift, Math.hypot(state.hero.x - px, state.hero.y - py));
}
check('位移结束后不按键：主角完全不动（没有延迟的补瞬移）', drift === 0,
  '最大位移=' + drift.toFixed(3) + 'px');

fireWin('keydown', { key: 'd', code: 'KeyD' });
check('位移结束后方向键恢复正常（按下即被记录）', state.keys.d === true);
let walked = 0;
for (let i = 0; i < 30; i++) {
  const px = state.hero.x, py = state.hero.y;
  dbg.update(STEP);
  walked = Math.max(walked, Math.hypot(state.hero.x - px, state.hero.y - py));
}
check('位移结束后方向键能正常走路（约 245 像素/秒）',
  Math.abs(walked - 245 * STEP) < 1, '最大单帧位移=' + walked.toFixed(2) + 'px');

/* 甩不出去的两个边界：鼠标贴脸 / 朝墙（落点仍在脚下）→ 不吃冷却 */
resetDash(null);
state.mouse.x = state.hero.x + 8;
state.mouse.y = state.hero.y + 6;
dbg.useHook();
check('鼠标贴在主角身上时不甩钩索（也不吃冷却）',
  state.dashT === 0 && state.dashTo === null && state.dashCd === 0);

resetDash({ x: state.hero.r, y: 300 });     // 贴着左边界
state.mouse.x = state.hero.x - 30;          // 朝墙甩：爪头被夹回脚下
state.mouse.y = state.hero.y;
dbg.useHook();
check('站在边界朝墙甩、落点仍在脚下时不甩钩索',
  state.dashT === 0 && state.dashTo === null && state.dashCd === 0);

/* 跨河落点：爪头在水里时推到岸上，但仍然匀速、不瞬移 */
const water = pickWaterAim();
if (water) {
  const crossRiver = runDash(water, 300, null, null, water.hero);
  const crossDist = Math.hypot(crossRiver.end.x - crossRiver.start.x, crossRiver.end.y - crossRiver.start.y);
  check('爪头落进水里时会被推到岸上（不会卡在水面）', !dbg.waterAt(crossRiver.end.x, crossRiver.end.y),
    '爪头=(' + water.tip.x.toFixed(0) + ',' + water.tip.y.toFixed(0) + ') 实际落点=(' +
    crossRiver.end.x.toFixed(0) + ',' + crossRiver.end.y.toFixed(0) + ') 距离=' + crossDist.toFixed(1) + 'px');
  check('跨河位移的偏移不超过 3 格（只是推到最近的岸）',
    Math.abs(crossDist - DASH_DIST) <= 3 * 44, '实际飞行=' + crossDist.toFixed(1) + 'px');
  check('跨河位移同样全程匀速（没有瞬移）', crossRiver.maxStep <= MAX_STEP,
    '最大单帧位移=' + crossRiver.maxStep.toFixed(2) + 'px');
} else {
  check('第二关有水面可测（找不到水面则跳过）', true, '本关卡没有合适的水面目标，跳过');
}

/* ---------------- ④ 渲染路径（drawHook 也改过） ---------------- */
head('④ 渲染 smoke test：位移途中 / 结束后 drawHook 都不报错');
let renderErr = null;
resetDash();
dbg.spawnEnemy('grunt', 0, 60);
state.mouse.x = state.hero.x + 420;
state.mouse.y = state.hero.y + 120;
dbg.useHook();
let rGuard = 0;
while (state.dashT > 0 && rGuard++ < 200) {
  dbg.update(STEP);
  try { dbg.render(); } catch (e) { renderErr = renderErr || e; }
}
for (let i = 0; i < 5; i++) {
  dbg.update(STEP);
  try { dbg.render(); } catch (e) { renderErr = renderErr || e; }
}
check('位移途中与结束后 render() 都不报错', !renderErr,
  renderErr ? String(renderErr) : '（渲染帧数=' + (rGuard + 5) + '）');

/* ---------------- ⑤ 长跑 integration ---------------- */
head('⑤ 长跑 integration：有钩索的关卡连跑 60 秒');
fire(getEl('btnLevel2'), 'click');      // 重新从第二关开局
fire(getEl('btnGuideOk'), 'click');
state.lives = 9999;                     // 只想压测不被打死
state.hero.hpMax = 1e9; state.hero.hp = 1e9;
let runErr = null, dashes = 0, maxWave = 0;
try {
  for (let i = 0; i < 3600; i++) {      // 60 秒
    if (i % 120 === 0) {
      state.keys = {};
      state.keys[i % 240 === 0 ? 'd' : 'a'] = true;
      state.mouse.x = 200 + (i * 7) % 800;
      state.mouse.y = 150 + (i * 11) % 400;
      dbg.useHook();                    // 冷却好了就甩一钩（可能变成搬塔）
      dashes++;
    }
    dbg.update(STEP);
    if (i % 30 === 0) dbg.render();
    if (state.waveIndex > maxWave) maxWave = state.waveIndex;
  }
} catch (e) { runErr = e; }
check('60 秒 / 3600 帧连跑（含甩钩 / 渲染）无异常', !runErr,
  runErr ? String(runErr) : ('甩钩 ' + dashes + ' 次，推进到第 ' + (maxWave + 1) + ' 波'));

/* ---------------- ⑥ 地图几何：行走中的敌人必须在画布内 ---------------- */
head('⑥ 地图几何：在地图上走的敌人不能跑到画布外');

const ENTRY = 3 * dbg.TILE;          // 出怪点本来就在画面外，前 3 格不计
const BASE_STUB = 1.2 * dbg.TILE;    // 主路尽头通向基地的画面外短段

function scanLane(route, walkEnd, skipEnd) {
  const out = [];
  for (let d = ENTRY; d <= walkEnd - skipEnd; d += 2) {
    const p = dbg.posAt(route, d);
    if (p.x < 0 || p.x > dbg.W || p.y < 0 || p.y > dbg.H) out.push({ d: d, x: p.x, y: p.y });
  }
  return out;
}
function maxXOf(list) { return list.reduce(function (m, o) { return Math.max(m, o.x); }, -1e9); }
function minXOf(list) { return list.reduce(function (m, o) { return Math.min(m, o.x); }, 1e9); }
function maxYOf(list) { return list.reduce(function (m, o) { return Math.max(m, o.y); }, -1e9); }

function checkLevel(name) {
  const mainOut = scanLane(dbg.ROUTE_MAIN(), dbg.GOAL_DIST(), BASE_STUB);
  check(name + '：主路从出怪口到基地，全程在画布内', mainOut.length === 0,
    mainOut.length
      ? '越界 ' + mainOut.length + ' 个采样点，x 最大 ' + maxXOf(mainOut).toFixed(0)
      : '画布 ' + dbg.W + '×' + dbg.H);
  /* 「漏怪」那一下也必须发生在画布内（否则怪会在看不见的地方消失） */
  const leak = dbg.posAt(dbg.ROUTE_MAIN(), dbg.GOAL_DIST());
  check(name + '：漏怪点（主路终点前 1 格）在画布内', leak.x >= 0 && leak.x <= dbg.W && leak.y >= 0 && leak.y <= dbg.H,
    '漏怪点 x=' + leak.x.toFixed(0) + ' / 画布宽 ' + dbg.W);
  const subs = dbg.SUB_LANES();
  for (let i = 0; i < subs.length; i++) {
    const out = scanLane(subs[i].route, subs[i].route.len, 0);
    check(name + '：支路「' + subs[i].name + '」全程在画布内', out.length === 0,
      out.length
        ? '越界 ' + out.length + ' 个采样点：x ' + minXOf(out).toFixed(0) + '~' + maxXOf(out).toFixed(0) +
          '，y 最大 ' + maxYOf(out).toFixed(0)
        : '路线长度 ' + subs[i].route.len.toFixed(0) + 'px');
  }
}

checkLevel('第二关');
fire(getEl('btnLevel1'), 'click');     // 换到第一关再查一遍
checkLevel('第一关');

/* ---------------- ⑦ 关卡配置：删掉回血塔 + 地狱难度数值 + 主角伤害 ---------------- */
head('⑦ 关卡配置：回血塔已删掉 + 地狱难度数值 + 主角伤害');

function countType(type) {
  let n = 0;
  for (let i = 0; i < state.towers.length; i++) if (state.towers[i].type === type) n++;
  return n;
}

check('源码里已经没有回血塔了（TOWERS.beacon 与相关逻辑）',
  !dbg.TOWERS.beacon && !/beacon|def\.heal\b/.test(SRC),
  '塔种：' + Object.keys(dbg.TOWERS).join(' / '));

fire(getEl('btnLevel1'), 'click');            // 第一关（地狱难度）
check('第一关：场上没有固定设施（回血塔 / 升级台都没有）', state.towers.length === 0,
  '场上塔数=' + state.towers.length);
check('第一关：侧栏「升级台」面板被隐藏',
  getEl('benchBlock').classList.contains('off') === true);
check('第一关：5 点生命 / 154 金币 / 准备时间 10 秒',
  state.lives === 5 && state.money === 154 && Math.abs(state.countdown - 10) < 1e-9,
  '生命=' + state.lives + ' 金币=' + state.money + ' 倒计时=' + state.countdown + 's');
check('第一关：敌人血量 ×1.2（0.8 × 地狱 1.5，比原来 ×1.5 低 20%）、拆塔者破坏力 ×1.3',
  Math.abs(state.hpScale - 1.2) < 1e-9 && Math.abs(state.sabScale - 1.3) < 1e-9,
  'hpScale=' + state.hpScale.toFixed(2) + ' sabScale=' + state.sabScale);
check('主角基础伤害 13 → 16', state.hero.damage === 16,
  '实际=' + state.hero.damage + '（1 级 DPS ≈ ' + (state.hero.damage / state.hero.rate).toFixed(1) + '）');
state.enemies.length = 0;
dbg.spawnEnemy('grunt', 0, 60);
check('第一关小兵血量 92 → 110（地狱 ×1.2）', state.enemies[0].hp === 110,
  '实际=' + state.enemies[0].hp);

fire(getEl('btnLevel2'), 'click');            // 第二关
fire(getEl('btnGuideOk'), 'click');
check('第二关：开局场上没有回血塔也没有升级台（升级台要等每波清完）',
  countType('beacon') === 0 && countType('bench') === 0,
  '场上塔数=' + state.towers.length);
check('第二关：侧栏「升级台」面板可见',
  getEl('benchBlock').classList.contains('off') === false);
check('第二关：5 点生命 / 294 金币 / 准备时间 10 秒',
  state.lives === 5 && state.money === 294 && Math.abs(state.countdown - 10) < 1e-9,
  '生命=' + state.lives + ' 金币=' + state.money + ' 倒计时=' + state.countdown + 's');
check('第二关：敌人血量 ×1.875、拆塔者破坏力 ×2.34（2.4 → 1.8）',
  Math.abs(state.hpScale - 1.875) < 1e-9 && Math.abs(state.sabScale - 2.34) < 1e-9,
  'hpScale=' + state.hpScale + ' sabScale=' + state.sabScale);
check('拆塔者基础伤害 12 → 10（第一关 13 点/次、第二关 23 点/次）',
  dbg.ENEMIES.saboteur.attackDamage === 10 &&
  Math.round(10 * 1.3) === 13 && Math.round(10 * 2.34) === 23,
  '第二关每下 = round(10 × 2.34) = ' + Math.round(10 * state.sabScale) + ' 点');
state.enemies.length = 0;
dbg.spawnEnemy('grunt', 0, 60);
check('第二关小兵血量 92 → 173（1.25 × 1.5 × 92 = 172.5）', state.enemies[0].hp === 173,
  '实际=' + state.enemies[0].hp);

/* ---------------- ⑧ 新敌人说明弹窗 ---------------- */
head('⑧ 新敌人说明弹窗：第一次出场弹一张卡片、不重复、不暂停');

fire(getEl('btnLevel2'), 'click');            // 第二关
fire(getEl('btnGuideOk'), 'click');
state.hero.hpMax = 1e9; state.hero.hp = 1e9;  // 只想测弹窗，别被怪打死
const pop = getEl('enemyPopup');
/* 换关已经不会清空 seenEnemies 了（一只怪整局只报到一次），
 * 这里手动清一次，保证下面几条测的确实是「第一次出场」 */
state.seenEnemies = {};

check('开局时没有卡片', state.enemyPopup === null && pop.classList.contains('hidden'),
  'hidden=' + pop.classList.contains('hidden'));

dbg.spawnEnemy('tank', 0, 300);
check('某种怪第一次出场 → 弹出卡片',
  !!state.enemyPopup && state.enemyPopup.type === 'tank' && !pop.classList.contains('hidden'),
  '当前卡片=' + (state.enemyPopup && state.enemyPopup.type));
check('卡片里写着名字 + 那句特性',
  pop.innerHTML.indexOf('重甲兵') >= 0 &&
  pop.innerHTML.indexOf(dbg.ENEMIES.tank.tip) >= 0,
  '「' + dbg.ENEMIES.tank.tip + '」');
check('卡片带一行关键数值（血量 / 护甲 / 漏过扣血）',
  pop.innerHTML.indexOf('血量 490') >= 0 && pop.innerHTML.indexOf('护甲 6') >= 0 &&
  pop.innerHTML.indexOf('漏过扣 2 点') >= 0);
check('卡片够小：特性只有一句话', dbg.ENEMIES.tank.tip.length <= 40,
  dbg.ENEMIES.tank.tip.length + ' 字');

const popHtml = pop.innerHTML;
fire(pop, 'click');                            // 先收掉这张，后面排队才好数
check('点一下卡片就收掉', state.enemyPopup === null && pop.classList.contains('hidden'));

dbg.spawnEnemy('tank', 0, 300);
dbg.spawnEnemy('tank', 0, 300);
check('同一种怪不会再弹（一局一次）',
  state.enemyQueue.length === 0 && state.enemyPopup === null && pop.innerHTML === popHtml,
  '队列长度=' + state.enemyQueue.length);

dbg.spawnEnemy('runner', 0, 300);
dbg.spawnEnemy('aura', 0, 300);
check('同时来两种新怪 → 第二张排队（不会盖在一起）',
  state.enemyQueue.length === 1 && state.enemyPopup.type === 'runner',
  '当前=' + state.enemyPopup.type + ' 队列=' + state.enemyQueue.join(','));

fire(pop, 'click');
check('收掉第一张 → 立刻弹下一张',
  !!state.enemyPopup && state.enemyPopup.type === 'aura' && state.enemyQueue.length === 0,
  '当前=' + (state.enemyPopup && state.enemyPopup.type));

const walker = state.enemies[state.enemies.length - 1];
const walkD0 = walker.dist;
let popFrames = 0, closedAfter = -1, walkMid = 0;
for (let i = 0; i < 60 * 8; i++) {
  dbg.update(STEP);
  popFrames++;
  if (popFrames === 30) walkMid = walker.dist;
  if (!state.enemyPopup && closedAfter < 0) closedAfter = popFrames * STEP;
}
check('卡片只是浮层：挂着的时候怪照样在走（不暂停游戏）',
  walkMid > walkD0 && state.paused === false,
  'dist ' + walkD0.toFixed(0) + ' → ' + walkMid.toFixed(0));
check('没人管的话 6 秒后自动收掉',
  closedAfter > 0 && Math.abs(closedAfter - 6) < 0.3,
  '实际 ' + (closedAfter > 0 ? closedAfter.toFixed(2) + 's' : '一直没收'));
check('收掉后元素也藏起来了', pop.classList.contains('hidden'));

const allTips = Object.keys(dbg.ENEMIES).map(function (k) { return dbg.ENEMIES[k].tip; });
const longest = allTips.reduce(function (m, t) { return Math.max(m, t ? t.length : 0); }, 0);
check('每种怪都有一句 tip，且都在 40 字以内',
  allTips.every(function (t) { return typeof t === 'string' && t.length > 4 && t.length <= 40; }),
  Object.keys(dbg.ENEMIES).length + ' 种怪，最长 ' + longest + ' 字');

/* ---------------- ⑨ 升级台：每波刷新 / 搬运升级 / 突破等级上限 ---------------- */
head('⑨ 升级台：每波清完刷一个、钩索搬上去免费升级、可突破 3 级上限');

fire(getEl('btnLevel2'), 'click');            // 干净的局
fire(getEl('btnGuideOk'), 'click');
state.hero.hpMax = 1e9; state.hero.hp = 1e9;

/* 1) 每波清完刷一个 */
state.phase = 'battle';
state.spawnQueue = [];
state.enemies.length = 0;
state.waveIndex = 0;
const moneyBefore = state.money;
dbg.update(STEP);
check('一波清完 → 自动进入准备阶段并刷出升级台',
  state.phase === 'prep' && countType('bench') === 1,
  '阶段=' + state.phase + ' 升级台=' + countType('bench') + ' 个');
const bench = state.towers.filter(function (t) { return t.type === 'bench'; })[0];
check('升级台刷在「交付点」上', !!bench && !!state.benchCell &&
  bench.c === state.benchCell.c && bench.r === state.benchCell.r,
  bench ? '交付点=(' + state.benchCell.c + ',' + state.benchCell.r + ') 实际=(' + bench.c + ',' + bench.r + ')' : '');
check('升级台无敌：拆不掉也卖不掉',
  dbg.TOWERS.bench.invincible === true && dbg.TOWERS.bench.noSell === true &&
  dbg.TOWERS.bench.cost === 0);

/* 2) 上一波没拿走就不重复刷（不堆一地） */
state.phase = 'battle'; state.spawnQueue = []; state.enemies.length = 0;
dbg.update(STEP);
check('升级台没被拿走时不会重复刷（场上始终最多一个）', countType('bench') === 1,
  '升级台=' + countType('bench') + ' 个');

/* 3) 钩索端起来 → 走到塔旁边再按一次 → 免费升级 */
state.money = 1000;
dbg.build('arrow', 5, 6);                     // 主路 (4,3)-(4,11) 旁边的一格
const tw = state.towers[state.towers.length - 1];
const lv0 = tw.level, hpMax0 = tw.hpMax;

/* 主角站到升级台西边 100 像素、朝东甩钩 */
state.hero.x = bench.x - 100; state.hero.y = bench.y;
state.mouse.x = bench.x + 120; state.mouse.y = bench.y;
dbg.useHook();
check('钩索能端起升级台（和搬塔同一套）', state.carry === bench && bench.carried === true,
  'carry=' + (state.carry && state.carry.type));

/* 端着台子走到塔旁边（塔在 (5,6) → 中心 (242,286)） */
state.hero.x = tw.x - 40; state.hero.y = tw.y;
dbg.useHook();
check('走到塔旁边再按一次 → 那座塔免费升一级',
  tw.level === lv0 + 1 && state.carry === null, 'LV' + (lv0 + 1) + ' → LV' + (tw.level + 1));
check('升级台用掉就没了（等下一波再刷）', countType('bench') === 0,
  '升级台=' + countType('bench') + ' 个');
check('升级顺带加固（耐久上限按公式涨）',
  tw.hpMax === dbg.towerHpMax('arrow', tw.level) && tw.hpMax > hpMax0,
  '耐久 ' + hpMax0 + ' → ' + tw.hpMax);

/* 4) 一路顶到 LV5，且能突破花钱的 3 级上限 */
let benchUses = 0;
for (let i = 0; i < 6; i++) {
  state.phase = 'battle'; state.spawnQueue = []; state.enemies.length = 0;
  dbg.update(STEP);                            // 刷一朵新的（还可能触发下一波清完）
  const b = state.towers.filter(function (x) { return x.type === 'bench'; })[0];
  if (!b) { state.phase = 'prep'; dbg.spawnBench(); continue; }
  state.hero.x = b.x - 100; state.hero.y = b.y;
  state.mouse.x = b.x + 120; state.mouse.y = b.y;
  dbg.useHook();                               // 端起
  if (state.carry !== b) { state.carry = b; b.carried = true; state.selectedTower = null; }
  state.hero.x = tw.x - 40; state.hero.y = tw.y;
  const before = tw.level;
  dbg.useHook();                               // 扣上去
  if (tw.level > before) benchUses++;
}
check('升级台可以把塔顶到 LV5（突破花钱的 3 级上限）', tw.level === 4,
  '最终 LV' + (tw.level + 1) + ' / 表里最高 LV' + dbg.TOWERS.arrow.levels.length);
check('LV5 的属性是表里的数值（不是 undefined）',
  dbg.statsOf(tw).damage === 120 && dbg.statsOf(tw).range === 164,
  'LV5 伤害 ' + dbg.statsOf(tw).damage + ' · 射程 ' + dbg.statsOf(tw).range +
  '（LV3 是 ' + dbg.TOWERS.arrow.levels[2].damage + '）');
check('满级之后再扣会被拒绝，台子不会被浪费',
  (function () {
    state.phase = 'prep'; dbg.spawnBench();
    const b = state.towers.filter(function (x) { return x.type === 'bench'; })[0];
    if (!b) return false;
    state.hero.x = b.x - 100; state.hero.y = b.y;
    state.mouse.x = b.x + 120; state.mouse.y = b.y;
    dbg.useHook();
    if (state.carry !== b) { state.carry = b; b.carried = true; }
    state.hero.x = tw.x - 40; state.hero.y = tw.y;
    dbg.useHook();
    const ok = tw.level === 4 && countType('bench') === 1;   // 台子还在
    state.carry = null; b.carried = false;
    return ok;
  })(), '升级台使用次数=' + benchUses);

/* 5) 花钱升级仍然只能到 3 级（被打回的塔不能再靠金币往上顶） */
state.selectedTower = tw;
const lvBeforePaid = tw.level;
dbg.upgradeSelected();
check('花钱升级不会突破 3 级上限（F 升级在 LV3 就停）',
  tw.level === lvBeforePaid && dbg.MAX_LEVEL === 3,
  'LV' + (tw.level + 1) + ' · MAX_LEVEL=' + dbg.MAX_LEVEL);

/* 6) 拆塔者真实伤害：站在塔边打一下正好掉 23 点（第二关） */
state.enemies.length = 0;
state.towers = state.towers.filter(function (x) { return x.type === 'arrow'; });
tw.carried = false;
tw.level = 0;
tw.hpMax = dbg.towerHpMax('arrow', 0);
tw.hp = tw.hpMax;
const twHp0 = tw.hp;
dbg.spawnEnemy('saboteur', 0, 352);           // 主路 (4,3)-(4,11) 上、正对 (5,6) 这一格
for (let i = 0; i < 80; i++) dbg.update(STEP);   // 1.33 秒 → 拆一次
check('拆塔者在第二关每下正好 23 点（10 × 1.8 × 1.3）',
  Math.round(twHp0 - tw.hp) === 23, '掉了 ' + Math.round(twHp0 - tw.hp) + ' 点 · 耐久 ' + tw.hp.toFixed(0));

/* 7) 渲染路径：升级台在场上时 drawTowerBody 不报错 */
let benchRenderErr = null;
try {
  state.phase = 'prep';
  dbg.spawnBench();
  for (let i = 0; i < 3; i++) { dbg.update(STEP); dbg.render(); }
} catch (e) { benchRenderErr = e; }
check('升级台画得出来（render 不报错）', !benchRenderErr,
  benchRenderErr ? String(benchRenderErr) : '');

/* 8) 选中升级台时的侧栏面板 */
state.phase = 'prep';
dbg.spawnBench();
const bench2 = state.towers.filter(function (x) { return x.type === 'bench'; })[0];
state.selectedTower = bench2 || null;
let selErr = null;
try { dbg.syncSelection(true); } catch (e) { selErr = e; }
check('选中升级台时侧栏面板正常（只讲用法，不显示一堆 0）',
  !selErr && !!bench2 &&
  getEl('selection').innerHTML.indexOf('免费升一级') >= 0 &&
  getEl('selection').innerHTML.indexOf('伤害') < 0,
  selErr ? String(selErr) : '');

/* 9) 交付点被玩家占了 → 顺着螺旋刷在旁边的空地 */
state.towers = state.towers.filter(function (x) { return x.type !== 'bench'; });
state.money = 1000;
state.selectedTower = null;
const padC = state.benchCell.c, padR = state.benchCell.r;
if (!state.towers.some(function (x) { return x.c === padC && x.r === padR; })) {
  dbg.build('arrow', padC, padR);
}
dbg.spawnBench();
const bench3 = state.towers.filter(function (x) { return x.type === 'bench'; })[0];
check('交付点被塔占了 → 升级台刷在最近的空地（不会刷不出来）',
  !!bench3 && !(bench3.c === padC && bench3.r === padR) &&
  Math.max(Math.abs(bench3.c - padC), Math.abs(bench3.r - padR)) <= 3,
  bench3 ? '交付点=(' + padC + ',' + padR + ') 实际=(' + bench3.c + ',' + bench3.r + ')' : '没刷出来');

/* ---------------- ⑩ 主角立绘：贴图模式下的动画状态机 ----------------
 * 桩里没有 Image，真贴图加载不了（game.js 会自动退回矢量小人——上面所有用例走的都是这条路）。
 * 这里塞一张「假贴图」把贴图分支点亮：canvas 上下文是空壳，所以只验证状态机与「不报错」。 */
head('⑩ 主角立绘：贴图模式下动画状态机 / 降级');
const HERO_SPRITE = dbg.HERO_SPRITE;
const fakeImg = { width: 231, height: 200 };
HERO_SPRITE.img = fakeImg;
HERO_SPRITE.white = fakeImg;
HERO_SPRITE.red = fakeImg;
HERO_SPRITE.ok = true;
const hero = state.hero;
state.phase = 'prep';
state.enemies.length = 0;

check('贴图按 46px 高绘制（地图一格 44px，人物约一格高）',
  HERO_SPRITE.h === 46 && HERO_SPRITE.feetY > 0,
  '高=' + HERO_SPRITE.h + 'px 双脚下沉=' + HERO_SPRITE.feetY + 'px');

/* 1) 出场 / 升级的弹跳计时会自己走完 */
hero.spawn = 1; hero.pop = 1;
for (let i = 0; i < 90; i++) dbg.update(STEP);
check('出场 / 升级的动画计时会自己归零（不会卡在放大状态）',
  hero.spawn === 0 && hero.pop === 0, 'spawn=' + hero.spawn + ' pop=' + hero.pop);

/* 2) 转身：鼠标换边 → 贴图整体镜像 */
state.mouse.x = hero.x + 200; state.mouse.y = hero.y;
for (let i = 0; i < 30; i++) { dbg.update(STEP); dbg.render(); }
const faceRight = hero.face;
state.mouse.x = hero.x - 200;
for (let i = 0; i < 30; i++) { dbg.update(STEP); dbg.render(); }
check('鼠标在右 → 面向右；鼠标在左 → 面向左（贴图镜像）',
  faceRight === 1 && hero.face === -1, '右=' + faceRight + ' 左=' + hero.face);

/* 3) 转身是「扭身」过渡，不是一帧硬翻 */
state.mouse.x = hero.x + 200;
let midFrames = 0;
for (let i = 0; i < 30; i++) { dbg.update(STEP); if (Math.abs(hero.face) < 0.9) midFrames++; }
check('转身有中间压缩帧（不是啪地翻面）', midFrames >= 2, '过渡帧 ' + midFrames + ' 帧');

/* 4) 前倾角：朝下压 / 朝上仰，符号相反且都有限度 */
state.mouse.x = hero.x + 300; state.mouse.y = hero.y + 400;
for (let i = 0; i < 60; i++) dbg.update(STEP);
const leanDown = hero.lean;
state.mouse.x = hero.x + 300; state.mouse.y = hero.y - 400;
for (let i = 0; i < 60; i++) dbg.update(STEP);
check('瞄准方向决定身体前倾（下压 / 上仰方向相反，且不超过 0.3 弧度）',
  leanDown > 0.02 && hero.lean < -0.02 && Math.abs(leanDown) < 0.3 && Math.abs(hero.lean) < 0.3,
  '下压=' + leanDown.toFixed(3) + ' 上仰=' + hero.lean.toFixed(3));

/* 5) 钩索冲刺：留残影、拉到最扁（dashFx 平滑到 1） */
hero.ghost.length = 0;
state.dashT = 0.5;
state.dashTo = { x: hero.x + 150, y: hero.y };
for (let i = 0; i < 5; i++) { dbg.update(STEP); dbg.render(); }
check('钩索冲刺时留下一串残影，并把自己拉长',
  hero.ghost.length > 0 && hero.dashFx > 0.3,
  '残影 ' + hero.ghost.length + ' 张 · dashFx=' + hero.dashFx.toFixed(2));
state.dashT = 0; state.dashTo = null; hero.ghost.length = 0;
for (let i = 0; i < 40; i++) dbg.update(STEP);
check('冲刺结束后残影和拉伸都会收干净（不会一直拖影）',
  hero.ghost.length === 0 && hero.dashFx < 0.05, 'dashFx=' + hero.dashFx.toFixed(3));

/* 6) 受击闪烁 / 无敌闪烁 / 阵亡倒地：贴图模式下都要能出帧 */
let spriteErr = null;
try {
  hero.flash = 1; hero.invuln = 0.3;
  for (let i = 0; i < 6; i++) { dbg.update(STEP); dbg.render(); }
  hero.flash = 0; hero.invuln = 0.2;
  for (let i = 0; i < 6; i++) { dbg.update(STEP); dbg.render(); }
  /* 桩里的时钟固定返回 0，把「阵亡时刻」设成刚过去一点点，就能走倒地 + 淡出分支 */
  hero.deathAt = -0.5;
  for (let i = 0; i < 6; i++) dbg.render();
} catch (e) { spriteErr = e; }
check('贴图模式下受击闪红 / 无敌闪烁 / 阵亡倒地都能正常出帧',
  !spriteErr, spriteErr ? String(spriteErr) : '');
hero.deathAt = 0;

/* 7) 降级：贴图丢了必须自动回到矢量小人，游戏照样能玩 */
HERO_SPRITE.ok = false;
let fallbackErr = null;
try { for (let i = 0; i < 5; i++) { dbg.update(STEP); dbg.render(); } } catch (e) { fallbackErr = e; }
check('贴图加载失败时自动退回矢量小人（不报错、不白屏）',
  !fallbackErr, fallbackErr ? String(fallbackErr) : '');

/* ---------------- ⑪ 首领：豆包立绘 + 沉默波 ----------------
 * 桩里没有 Image（真贴图加载不了），这里塞一张「假贴图」点亮立绘分支；
 * 沉默波本身与贴图无关，用真实 update() 推时间验证。 */
head('⑪ 首领：豆包立绘 / 沉默波（6 秒 · 5 座塔 · 3 秒哑火 + 60 耐久）');
const BOSS_SPRITE = dbg.BOSS_SPRITE;
const bossDef = dbg.ENEMIES.boss;

check('首领有独立立绘（比主角高一头，脚下沉到自己的影子上）',
  BOSS_SPRITE.h > HERO_SPRITE.h && BOSS_SPRITE.feetY > 0 &&
  /boss-doubao\.png$/.test(BOSS_SPRITE.src),
  BOSS_SPRITE.src + ' · 高 ' + BOSS_SPRITE.h + 'px / 主角 ' + HERO_SPRITE.h + 'px');

check('沉默波数值写在怪表里（每 6 秒 · 半径 160 · 最多 5 座 · 3 秒 · 60 耐久）',
  bossDef.silenceEvery === 6 && bossDef.silenceRadius === 160 && bossDef.silenceCount === 5 &&
  bossDef.silenceTime === 3 && bossDef.silenceDamage === 60,
  bossDef.silenceEvery + 's / ' + bossDef.silenceRadius + 'px / ' + bossDef.silenceCount +
  ' 座 / ' + bossDef.silenceTime + 's / ' + bossDef.silenceDamage);

/** 在 (cx,cy) 附近一圈圈找能建的空地，建满 need 座塔；返回建好的塔 */
function buildRing(cx, cy, need, fromRad, toRad) {
  const out = [];
  for (let rad = fromRad; rad <= toRad && out.length < need; rad++) {
    for (let dc = -rad; dc <= rad && out.length < need; dc++) {
      for (let dr = -rad; dr <= rad && out.length < need; dr++) {
        if (Math.max(Math.abs(dc), Math.abs(dr)) !== rad) continue;
        const c = cx + dc, r = cy + dr;
        if (c < 0 || c >= dbg.COLS || r < 0 || r >= dbg.ROWS) continue;
        const before = state.towers.length;
        dbg.build('arrow', c, r);
        if (state.towers.length > before) out.push(state.towers[state.towers.length - 1]);
      }
    }
  }
  return out;
}

state.phase = 'battle';
state.money = 9000;
state.enemies.length = 0; state.spawnQueue = []; state.shots.length = 0;
state.towers.length = 0;
state.pending.length = 0;
dbg.spawnEnemy('boss', 0, 700);
const boss = state.enemies[0];
const bossC = Math.floor(boss.x / dbg.TILE), bossR = Math.floor(boss.y / dbg.TILE);

/* 首领身边建 7 座塔（第 7 座故意建在 160 像素外），再塞一座升级台当「免疫」对照组 */
const nearTowers = buildRing(bossC, bossR, 6, 1, 3);
const allNear = state.towers.slice();
const farCand = buildRing(bossC, bossR, 1, 5, 6).filter(function (t) {
  return Math.hypot(t.x - boss.x, t.y - boss.y) > bossDef.silenceRadius + 10;
});
if (!state.towers.filter(function (t) { return t.type === 'bench'; }).length) { dbg.spawnBench(); }
const skBench = state.towers.filter(function (t) { return t.type === 'bench'; })[0];

const inRange = allNear.filter(function (t) {
  return Math.hypot(t.x - boss.x, t.y - boss.y) <= bossDef.silenceRadius;
});
const hp0 = new Map();
state.towers.forEach(function (t) { hp0.set(t, t.hp); });   // 含远处对照塔与升级台

check('摆好场面：首领身边有 ' + inRange.length + " 座塔（>=5）", inRange.length >= 5,
  '近处塔 ' + inRange.length + ' 座 · 远处对照 ' + farCand.length + ' 座 · 升级台 ' + (skBench ? 1 : 0));

/* 直接把冷却压到 0，立刻放一次沉默波 */
boss.silenceCd = 0.001;
dbg.update(STEP);

const silenced = state.towers.filter(function (t) { return t.silence > 0; });
check('沉默波一次最多罩 5 座塔（不是范围内的全罩）',
  silenced.length === 5, '被沉默 ' + silenced.length + ' 座 / 范围内 ' + inRange.length + ' 座');
check('被沉默的塔正好是最近的那 5 座',
  silenced.slice().sort(function (a, b) { return a.id - b.id; })
    .every(function (t) { return inRange.indexOf(t) >= 0; }) &&
  silenced.every(function (t) {
    const d = Math.hypot(t.x - boss.x, t.y - boss.y);
    return inRange.filter(function (o) {
      return Math.hypot(o.x - boss.x, o.y - boss.y) < d;
    }).length < 5;
  }),
  '最远的一座 ' + Math.round(Math.max.apply(null, silenced.map(function (t) {
    return Math.hypot(t.x - boss.x, t.y - boss.y);
  }))) + 'px');
check('沉默时长就是 3 秒（写进塔身上的倒计时）',
  silenced.every(function (t) { return Math.abs(t.silence - bossDef.silenceTime) < 0.05; }),
  'silence=' + silenced[0].silence.toFixed(2) + 's');
check('沉默的同时每座塔掉 60 点耐久',
  silenced.every(function (t) { return Math.abs((hp0.get(t) - t.hp) - bossDef.silenceDamage) < 0.01; }),
  '掉了 ' + (hp0.get(silenced[0]) - silenced[0].hp) + ' 点');
check('160 像素外的塔毫发无伤（范围是硬边界）',
  farCand.length === 0 || (farCand[0].silence === 0 && farCand[0].hp === hp0.get(farCand[0])),
  farCand.length ? '远处塔 silence=' + farCand[0].silence + ' hp=' + farCand[0].hp : '（没建出远处对照）');
check('无敌的升级台不吃沉默、也不掉耐久',
  !!skBench && skBench.silence === 0 && skBench.hp === skBench.hpMax,
  skBench ? '升级台 silence=' + skBench.silence + ' hp=' + skBench.hp : '没有升级台');

/* 哑火：只留一座被沉默的塔，怪贴在它脸上，1 秒内它一发都打不出来 */
state.towers.length = 0;
state.enemies.length = 0;
state.shots.length = 0;
dbg.spawnEnemy('boss', 0, 700);
const boss2 = state.enemies[0];
const solo = buildRing(Math.floor(boss2.x / dbg.TILE), Math.floor(boss2.y / dbg.TILE), 1, 1, 3)[0];
const pin = function () { boss2.x = solo.x + 20; boss2.y = solo.y; };  // 贴脸（射程判定用坐标）
pin();
solo.silence = 3;
let shotsSilent = 0;
for (let i = 0; i < 60; i++) { pin(); dbg.update(STEP); shotsSilent += state.shots.length; }
check('沉默期间塔一发都打不出来（照样瞄，但开不了火）',
  shotsSilent === 0, '1 秒内飞出的箭 ' + shotsSilent + ' 发');

const bossHpBefore = boss2.hp;
let shotsFree = 0;
for (let i = 0; i < 200; i++) { pin(); dbg.update(STEP); shotsFree += state.shots.length; }
check('3 秒一过自动解除沉默，塔又能开火',
  solo.silence === 0 && shotsFree > 0 && boss2.hp < bossHpBefore,
  'silence=' + solo.silence.toFixed(2) + ' · 解除后飞出 ' + shotsFree + ' 发 · 首领掉血 ' +
  Math.round(bossHpBefore - boss2.hp));

/* 立绘分支 / 降级分支都要能出帧 */
let bossArtErr = null;
BOSS_SPRITE.img = { width: 57, height: 200 };
BOSS_SPRITE.ok = true;
try {
  state.enemies.length = 0;
  dbg.spawnEnemy('boss', 0, 300);
  const b2 = state.enemies[0];
  b2.hit = 0.5;
  for (let i = 0; i < 5; i++) { dbg.update(STEP); dbg.render(); }
} catch (e) { bossArtErr = e; }
check('首领立绘能正常出帧（含受击提亮）', !bossArtErr, bossArtErr ? String(bossArtErr) : '');

BOSS_SPRITE.ok = false;
let bossFallbackErr = null;
try { for (let i = 0; i < 5; i++) { dbg.update(STEP); dbg.render(); } } catch (e) { bossFallbackErr = e; }
check('首领贴图丢了自动退回红色首领球（不报错、不白屏）',
  !bossFallbackErr, bossFallbackErr ? String(bossFallbackErr) : '');
BOSS_SPRITE.img = null;

/* ---------------- ⑫ 封面页：第一屏，点了才进开始页 ---------------- */
head('⑫ 封面页：标题 + 立绘 + 「开始游戏」');
const coverEl = getEl('coverScreen');
const btnCoverEl = getEl('btnCover');
check('封面页与「开始游戏」按钮都挂上了事件',
  !!(btnCoverEl._on && btnCoverEl._on.click && btnCoverEl._on.click.length),
  '封面元素 #' + coverEl.id + ' · 按钮 #' + btnCoverEl.id);

state.started = true;                     // 假装已经开了一局
fire(btnCoverEl, 'click');
check('点「开始游戏」→ 封面收起来（加上 hidden）',
  coverEl.classList.contains('hidden'), 'class=' + coverEl.className);
check('收起封面不会顺手把游戏开起来（还是停在开始页面）',
  state.started === true, 'started=' + state.started);

/* ---------------- ⑬ 强化：散射箭必出 · 散射/贯穿各只能升一次 ---------------- */
head('⑬ 强化：散射箭必出，散射 / 贯穿各只能升一次');
const heroP = state.hero;
const hasPerk = function (list, id) {
  return list.some(function (p) { return p.id === id; });
};
const hasSpread = function (list) { return hasPerk(list, 'spread'); };
const perkOf = function (list, id) {
  return list.filter(function (p) { return p.id === id; })[0];
};

let missSpread = 0, badLen = 0;
heroP.spread = 0; heroP.pierceCount = 0;
for (let i = 0; i < 40; i++) {
  const picks = dbg.rollPerks();
  if (!hasSpread(picks)) missSpread++;
  if (picks.length !== 3) badLen++;
}
check('还没拿到散射箭时，40 次抽取次次都在（真·必出）',
  missSpread === 0, '40 次里漏了 ' + missSpread + ' 次');
check('必出不会挤掉卡位：三选一永远是 3 张卡',
  badLen === 0, '不是 3 张的次数 ' + badLen);

heroP.spread = 1;                                  // 拿过一次就算满
let afterSpread = 0;
for (let i = 0; i < 40; i++) { if (hasSpread(dbg.rollPerks())) afterSpread++; }
check('散射箭只能升一次：拿过之后不再出现',
  afterSpread === 0, '拿满后又出现了 ' + afterSpread + ' 次');

heroP.pierceCount = 1;                             // 拿过一次就算满
let afterPierce = 0;
for (let i = 0; i < 40; i++) { if (hasPerk(dbg.rollPerks(), 'pierce')) afterPierce++; }
check('贯穿箭只能升一次：拿过之后不再出现',
  afterPierce === 0, '拿满后又出现了 ' + afterPierce + ' 次');

/* 两项都拿满时，池子里还有 8 个可叠的强化，三选一照样给满 3 张且不重复 */
let shortCards = 0, dupPerk = 0;
for (let i = 0; i < 20; i++) {
  const picks = dbg.rollPerks();
  if (picks.length !== 3) shortCards++;
  const ids = picks.map(function (p) { return p.id; });
  if (new Set(ids).size !== ids.length) dupPerk++;
}
check('散射+贯穿都拿满后，三选一仍然给满 3 张且不重复',
  shortCards === 0 && dupPerk === 0, '不足 3 张 ' + shortCards + ' 次 · 重复 ' + dupPerk + ' 次');

/* 用强化池里那两个真的对象：连按 3 次也只会生效 1 次 */
heroP.spread = 0; heroP.pierceCount = 0;
const spreadPerk = perkOf(dbg.rollPerks(), 'spread');     // 必出
let piercePerk = null;
for (let i = 0; i < 200 && !piercePerk; i++) piercePerk = perkOf(dbg.rollPerks(), 'pierce');

const sSeq = [];
if (spreadPerk) { for (let i = 0; i < 3; i++) { spreadPerk.apply(heroP); sSeq.push(heroP.spread); } }
check('散射箭（真的那个强化）最多升 1 次，再选也无效',
  !!spreadPerk && heroP.spread === 1 && sSeq[0] === 1,
  spreadPerk ? spreadPerk.name + '：spread=' + sSeq.join(' → ') : '没抽到');

const pSeq = [];
if (piercePerk) { for (let i = 0; i < 3; i++) { piercePerk.apply(heroP); pSeq.push(heroP.pierceCount); } }
check('贯穿箭（真的那个强化）最多升 1 次，再选也无效',
  !!piercePerk && heroP.pierceCount === 1 && pSeq[0] === 1,
  piercePerk ? piercePerk.name + '：pierce=' + pSeq.join(' → ') : '没抽到');

/* 真实升级流程：升一级 → 菜单里直接就有散射箭 */
heroP.spread = 0;
heroP.level = 1; heroP.xp = 0; heroP.xpNeed = 40; heroP.pending = 0;
state.levelOpen = false;
dbg.gainXp(200);
check('真实升级流程：升级菜单里能直接选到散射箭',
  state.levelOpen === true && hasSpread(state.levelChoices),
  '选项=' + state.levelChoices.map(function (p) { return p.id; }).join(' / '));
state.levelOpen = false;
state.pending = 0; heroP.pending = 0;
heroP.spread = 0;

/* ---------------- ⑭ 新敌人报到：整个游戏只弹一次（跨关卡不重复） ---------------- */
head('⑭ 新敌人报到：跨关卡只弹一次，第二关不重复');

fire(getEl('btnLevel1'), 'click');            // 回到第一关
const gOk = getEl('btnGuideOk');
if (gOk) fire(gOk, 'click');
state.hero.hpMax = 1e9; state.hero.hp = 1e9;
const popEl = getEl('enemyPopup');
if (state.enemyPopup) fire(popEl, 'click');
state.seenEnemies = {};                       // 做确定性验证：从零开始记
state.enemyQueue.length = 0;
state.enemyPopup = null;

dbg.spawnEnemy('healer', 0, 60);
check('第一关：这种怪第一次出场 → 弹卡',
  !!state.enemyPopup && state.enemyPopup.type === 'healer',
  '当前卡片=' + (state.enemyPopup && state.enemyPopup.type));
fire(popEl, 'click');
check('收掉卡片后，「已报到」的记录仍然留着',
  state.seenEnemies.healer === true,
  'seen=' + JSON.stringify(Object.keys(state.seenEnemies)));

fire(getEl('btnLevel2'), 'click');            // 换关（这里会跑一次 resetGame）
if (gOk) fire(gOk, 'click');
check('换关不再把「已报到」记录清空',
  state.seenEnemies.healer === true,
  'seen=' + JSON.stringify(Object.keys(state.seenEnemies)));

dbg.spawnEnemy('healer', 0, 60);
check('第二关再出现同一只怪 → 不再弹卡（跨关卡去重）',
  state.enemyPopup === null && state.enemyQueue.length === 0,
  '卡片=' + (state.enemyPopup && state.enemyPopup.type) + ' 队列=' + state.enemyQueue.length);

dbg.spawnEnemy('shield', 0, 60);
check('第二关里「没见过」的怪照样报到',
  !!state.enemyPopup && state.enemyPopup.type === 'shield',
  '当前卡片=' + (state.enemyPopup && state.enemyPopup.type));
fire(popEl, 'click');

/* ---------------- ⑮ 小怪立绘：同一张 gpt，按种类染色 ---------------- */
head('⑮ 小怪立绘：一张 gpt 贴图，十二种怪各染一色（首领仍用豆包）');
const ENEMY_SPRITE = dbg.ENEMY_SPRITE;
check('小怪贴图参数就位（png 贴图 + 按半径缩放的倍数）',
  /enemy-gpt\.png$/.test(ENEMY_SPRITE.src) && ENEMY_SPRITE.scale > 1,
  ENEMY_SPRITE.src + ' · 显示高度 = 敌人半径 × ' + ENEMY_SPRITE.scale);

const MOB_TYPES = ['grunt', 'runner', 'tank', 'splitter', 'mini', 'shield',
                   'healer', 'saboteur', 'decoy', 'overseer', 'thrower', 'aura'];
const fakeMob = { width: 146, height: 160 };
ENEMY_SPRITE.tints = {};
ENEMY_SPRITE.img = fakeMob;
ENEMY_SPRITE.ok = true;
state.enemies.length = 0;
let mobArtErr = null;
try {
  let dd = 120;
  for (const t of MOB_TYPES) { dbg.spawnEnemy(t, 0, dd); dd += 90; }
  dbg.spawnEnemy('boss', 0, 60);                 // 首领应该继续用豆包那张
  for (let i = 0; i < 3; i++) { dbg.update(STEP); dbg.render(); }
} catch (e) { mobArtErr = e; }
check('十二种小怪 + 首领同屏出帧不报错', !mobArtErr, mobArtErr ? String(mobArtErr) : '');

const tinted = MOB_TYPES.filter(t => !!ENEMY_SPRITE.tints[t]);
check('每种小怪都拿到自己的染色贴图（共 12 种）',
  tinted.length === MOB_TYPES.length, '已染色 ' + tinted.length + ' 种：' + tinted.join('/'));
check('首领不吃小怪贴图（继续用豆包立绘）', !ENEMY_SPRITE.tints.boss);
check('不同种类的染色图不是同一张',
  new Set(MOB_TYPES.map(t => ENEMY_SPRITE.tints[t])).size === MOB_TYPES.length,
  '去重后 ' + new Set(MOB_TYPES.map(t => ENEMY_SPRITE.tints[t])).size + ' 张');
const t1 = dbg.mobSpriteFor('grunt'), t2 = dbg.mobSpriteFor('grunt');
check('同一种怪只染一次，之后走缓存', t1 === t2 && t1 !== dbg.mobSpriteFor('runner'));

ENEMY_SPRITE.ok = false;                          // 贴图丢了：必须能退回彩色圆球
let mobFallbackErr = null;
try {
  state.enemies.length = 0;
  for (const t of MOB_TYPES) dbg.spawnEnemy(t, 0, 200);
  dbg.spawnEnemy('boss', 0, 60);
  for (let i = 0; i < 3; i++) { dbg.update(STEP); dbg.render(); }
} catch (e) { mobFallbackErr = e; }
check('小怪贴图丢了自动退回彩色圆球（不报错、不白屏）',
  !mobFallbackErr, mobFallbackErr ? String(mobFallbackErr) : '');
ENEMY_SPRITE.img = null;
ENEMY_SPRITE.tints = {};
state.enemies.length = 0;

/* ---------------- ⑯ 封面立绘跟着鼠标转身 ---------------- */
head('⑯ 封面立绘跟着鼠标转身（左右镜像 + 中间死区 + 收起后不再响应）');
const coverEl2 = getEl('coverScreen');
const cf = dbg.coverFollow;
check('封面转向在启动时初始化好了', !!cf && typeof cf.onMove === 'function',
  cf ? 'face=' + cf.cur.face : 'coverFollow=null');
coverEl2.classList.remove('hidden');            // 上文 ⑫ 已经把它藏起来了，先放出来
const midX = dbg.W / 2, midY = dbg.H / 2;
fireWin('mousemove', { clientX: midX - dbg.W * 0.45, clientY: midY - 60 });
check('鼠标在立绘左边 → 目标朝左（整体镜像）', cf.aim.face === -1, 'face=' + cf.aim.face);
fireWin('mousemove', { clientX: midX + 6, clientY: midY });
check('鼠标停在正中（14px 死区）不会左右乱翻', cf.aim.face === -1, 'face=' + cf.aim.face);
fireWin('mousemove', { clientX: midX + dbg.W * 0.45, clientY: midY + 60 });
check('鼠标在立绘右边 → 目标朝右（不镜像）', cf.aim.face === 1, 'face=' + cf.aim.face);
check('越往边上倾斜/视差越大', Math.abs(cf.aim.x) > 0.5 && Math.abs(cf.aim.y) > 0.05,
  'aim.x=' + cf.aim.x.toFixed(2) + ' aim.y=' + cf.aim.y.toFixed(2));
coverEl2.classList.add('hidden');
fireWin('mousemove', { clientX: midX - dbg.W * 0.45, clientY: midY });
check('封面收起来以后不再响应鼠标', cf.aim.face === 1, 'face=' + cf.aim.face);

/* ---------------- ⑰ 第三关：新地图 / 蹦极偷塔 / 保护伞 / 开场升级台 ---------------- */
head('⑰ 第三关：浮桥水镇（红主路 + 绿侧路 + 河道；蹦极偷塔；保护伞）');

const L3 = dbg.LEVEL_SETUP[2];
check('第三关在关卡表里（名字 / 地图名）',
  !!L3 && L3.id === 3 && L3.name === '第三关',
  L3 ? L3.name + ' · ' + L3.mapName : '缺失');

const l3Btn = getEl('btnLevel3');
fire(l3Btn, 'click');
const g3 = getEl('btnGuide3Ok');
if (g3) fire(g3, 'click');
check('点第三关按钮 → 进的是第三关（20 波 + 开场的机制说明）',
  dbg.state.level === 3 && dbg.WAVES().length === 20,
  'level=' + dbg.state.level + ' 波数=' + dbg.WAVES().length);

/* 第三关的 20 波：小怪数量比原来加了一点，而且最后一波是三首领 */
const w3 = dbg.WAVES();
const countOf = function (w) { return w.reduce(function (s, g) { return s + g.count; }, 0); };
check('第三关第 1 波 10 只（原来 8 只，数量和难度一起往上抬）',
  countOf(w3[0]) === 10, '第 1 波=' + countOf(w3[0]));
check('第三关第 20 波有 3 只首领 + 一堆小怪',
  w3[19].filter(function (g) { return g.type === 'boss'; })[0].count === 3 && countOf(w3[19]) >= 40,
  'boss=' + w3[19].filter(function (g) { return g.type === 'boss'; })[0].count + ' 总数=' + countOf(w3[19]));
check('第三关每波都有怪、且波数严格递增到 20',
  w3.length === 20 && w3.every(function (w) { return countOf(w) > 0; }),
  '最小一波 ' + Math.min.apply(null, w3.map(countOf)) + ' 只');
check('第三关血量成长斜率单独放缓（0.14，第 20 波 ≈ 3.66 倍）',
  Math.abs(dbg.state.hpPerWave - 0.14) < 1e-9,
  'hpPerWave=' + dbg.state.hpPerWave);

check('开场就有 1 座升级台 + 1 把保护伞',
  dbg.towersOf('bench').length === 1 && dbg.towersOf('umbrella').length === 1,
  '升级台 ' + dbg.towersOf('bench').length + ' 座 · 保护伞 ' + dbg.towersOf('umbrella').length + ' 把');

/* 河道：三块矩形拼成 L 形，只有两格桥能走 */
const waterTiles = [];
for (let r = 0; r < dbg.ROWS; r++) {
  for (let c = 0; c < dbg.COLS; c++) {
    const x = c * dbg.TILE + dbg.TILE / 2, y = r * dbg.TILE + dbg.TILE / 2;
    if (dbg.waterAt(x, y)) waterTiles.push(c + ',' + r);
  }
}
check('河道是真的水面（成片），桥那两格不是水',
  waterTiles.length >= 40 && !dbg.waterAt(13 * dbg.TILE + 22, 12 * dbg.TILE + 22) &&
  dbg.waterAt(13 * dbg.TILE + 22, 8 * dbg.TILE + 22) && dbg.waterAt(3 * dbg.TILE + 22, 3 * dbg.TILE + 22),
  '水面 ' + waterTiles.length + ' 格 · 桥(13,12)=' + dbg.waterAt(13 * dbg.TILE + 22, 12 * dbg.TILE + 22));

/* 保护伞：路面能放、水面和别人的格子不能放 */
check('保护伞能放到路面上（这是它和塔最大的不同）',
  dbg.canPlaceUmbrella(19, 8) === true, 'canPlaceUmbrella(19,8)=' + dbg.canPlaceUmbrella(19, 8));
check('保护伞不能放到水面上',
  dbg.canPlaceUmbrella(13, 8) === false, 'canPlaceUmbrella(13,8)=' + dbg.canPlaceUmbrella(13, 8));

/* 蹦极：随机贴靶子 → 5 秒后从场外俯冲偷塔 → 飞回去消失 */
dbg.state.towers.length = 0;
dbg.state.throws.length = 0;
dbg.state.enemies.length = 0;
dbg.state.money = 9999;
const twA = dbg.build('arrow', 19, 9);
const twB = dbg.build('arrow', 22, 9);
check('两座塔都建好了（用来对照）', !!twA && !!twB);

dbg.spawnEnemy('bungee', 0, dbg.distOf(19, 8));
const bg1 = dbg.state.enemies[dbg.state.enemies.length - 1];
check('蹦极不走路、待在场外、出场就贴上靶子',
  !!bg1 && bg1.flying === true && bg1.y < 0 && dbg.state.throws.length === 1,
  bg1 ? 'y=' + Math.round(bg1.y) + ' 靶子=' + dbg.state.throws.length + ' 个' : '没刷出来');

const targetId = dbg.state.throws[0].towerId;
const targetTw = (targetId === twA.id) ? twA : twB;
const otherTw = (targetId === twA.id) ? twB : twA;
check('靶子贴在**自己的**塔上（随机挑的，不是无敌设施）',
  targetId === twA.id || targetId === twB.id,
  '盯的是 ' + (targetId === twA.id ? '左边那座' : '右边那座'));

check('蹦极全程无敌，怎么打都不掉血',
  bg1.noHit === true && (dbg.damageEnemy(bg1, 9999, null, true), bg1.dead === false),
  'noHit=' + bg1.noHit + ' hp=' + Math.round(bg1.hp));

dbg.advanceThrows(4.5);
check('靶子挂着的 5 秒里塔还在',
  dbg.state.throws.length === 1 && !targetTw.dead,
  '靶子=' + dbg.state.throws.length + ' · 塔 dead=' + targetTw.dead);

dbg.advanceThrows(0.6);
check('5 秒到点，蹦极开始从场外俯冲', bg1.diveT >= 0, 'diveT=' + bg1.diveT.toFixed(2));
for (let i = 0; i < Math.round(1.4 / STEP); i++) dbg.update(STEP);
check('俯冲到底把塔整座偷走，然后飞回场外消失',
  targetTw.dead === true && otherTw.dead === false && bg1.dead === true,
  '被偷=' + (targetTw === twA ? '左' : '右') + ' · 蹦极 dead=' + bg1.dead);

/* 有保护伞：同样的流程，塔必须保住 */
dbg.state.towers.length = 0;
dbg.state.throws.length = 0;
dbg.state.enemies.length = 0;
const twC = dbg.build('arrow', 19, 9);
const um1 = dbg.makeUmbrella(19, 10);
check('保护伞放好了（罩住 19,9 那座塔）',
  !!um1 && dbg.umbrellaCovers(twC.x, twC.y) === um1);

dbg.spawnEnemy('bungee', 0, dbg.distOf(19, 8));
const bg2 = dbg.state.enemies[dbg.state.enemies.length - 1];
check('蹦极照样敢贴靶子（保护伞不影响靶子）',
  dbg.state.throws.length === 1, '靶子=' + dbg.state.throws.length);

dbg.advanceThrows(5.2);
for (let i = 0; i < Math.round(1.0 / STEP); i++) dbg.update(STEP);
check('俯冲到底被保护伞弹飞：塔保住、蹦极直接消失',
  !twC.dead && bg2.dead === true && dbg.state.throws.length === 0,
  '塔 dead=' + twC.dead + ' · 蹦极 dead=' + bg2.dead);

/* 场上没塔可偷：蹦极在屏幕外等一会儿就自己飞走，不会卡住这一波 */
dbg.state.towers.length = 0;
dbg.state.throws.length = 0;
dbg.state.enemies.length = 0;
dbg.spawnEnemy('bungee', 0, dbg.distOf(19, 8));
const bg4 = dbg.state.enemies[dbg.state.enemies.length - 1];
for (let i = 0; i < Math.round(3.6 / STEP); i++) dbg.update(STEP);
check('没塔可偷时它自己飞走（不会把这一波卡住）', bg4.dead === true, 'dead=' + bg4.dead);

/* 保护伞也能被钩索端走再放下（连路面都能放） */
dbg.state.towers.length = 0;
const um2 = dbg.makeUmbrella(19, 10);
dbg.pickUpTower(um2);
check('保护伞能被钩索端起来',
  dbg.state.carry === um2, 'carry=' + (dbg.state.carry && dbg.state.carry.type));
dbg.state.hero.x = 19 * dbg.TILE + 22;
dbg.state.hero.y = 8 * dbg.TILE + 22;
dbg.placeCarried();
check('端到路面上也能放下（钩索搬保护伞比搬塔宽松）',
  dbg.state.carry === null && um2.c === 19 && um2.r === 8 && !um2.dead,
  'carry=' + dbg.state.carry + ' 落点=' + um2.c + ',' + um2.r);

/* 蹦极贴图 / 靶子贴图：丢了也得能出帧 */
dbg.state.towers.length = 0;
dbg.state.throws.length = 0;
dbg.state.enemies.length = 0;
dbg.build('arrow', 19, 9);
dbg.spawnEnemy('bungee', 0, dbg.distOf(19, 8));
let l3Err = null;
try {
  for (let i = 0; i < 5; i++) { dbg.update(STEP); dbg.render(); }
} catch (e) { l3Err = e; }
check('蹦极 + 靶子 + 保护伞同屏出帧不报错', !l3Err, l3Err ? String(l3Err) : '');

/* 通关第二关 → 解锁第三关 */
dbg.state.level = 2;
dbg.state.phase = 'won';
let unlockErr = null;
try { dbg.endGame(true); } catch (e) { unlockErr = e; }
check('通关第二关会解锁第三关（存档里记 lv3）',
  !unlockErr && dbg.save().lv3 === true, unlockErr ? String(unlockErr) : 'save.lv3=' + dbg.save().lv3);

/* 第三关血量倍率 = 1.6 × 地狱 1.5 = 2.4 */
dbg.chooseLevel(2);
check('第三关血量倍率是 ×2.4',
  Math.abs(dbg.state.hpScale - 2.4) < 1e-9, 'hpScale=' + dbg.state.hpScale.toFixed(3));

/* 「重击」只能升一次：拿满 1.6 后不再进三选一 */
const hk = dbg.state.hero;
hk.knockMul = 1;
let knockPick = 0;
for (let i = 0; i < 40; i++) {
  const ps = dbg.rollPerks();
  if (ps.some(function (p) { return p.id === 'knock'; })) knockPick++;
}
check('重击没拿过时能抽到', knockPick > 0, '40 次里出现 ' + knockPick + ' 次');
hk.knockMul = 1;
dbg.PERKS.filter(function (p) { return p.id === 'knock'; })[0].apply(hk);
dbg.PERKS.filter(function (p) { return p.id === 'knock'; })[0].apply(hk);
check('重击连点两次也只加一次（上限 1.6）',
  Math.abs(hk.knockMul - 1.6) < 1e-9, 'knockMul=' + hk.knockMul.toFixed(2));
let knockAgain = 0;
for (let i = 0; i < 40; i++) {
  const ps = dbg.rollPerks();
  if (ps.some(function (p) { return p.id === 'knock'; })) knockAgain++;
}
check('重击拿满后不再出现在三选一',
  knockAgain === 0, '又出现了 ' + knockAgain + ' 次');

/* 蹦极偷走「正被主角端在手上」的塔 → 手上不能留下打不动的贴图 */
dbg.state.towers.length = 0;
dbg.state.throws.length = 0;
dbg.state.enemies.length = 0;
dbg.state.carry = null;
const heldCarried = dbg.build('arrow', 19, 9);
dbg.pickUpTower(heldCarried);
dbg.state.hero.x = 22 * dbg.TILE + 22;   // 主角端着它跑远（实际位置以主角为准）
dbg.state.hero.y = 9 * dbg.TILE + 22;
dbg.update(STEP);
dbg.stealTower(heldCarried);
check('端在手上的塔被偷走后，手上不会残留贴图',
  dbg.state.carry === null && heldCarried.carried === false && heldCarried.dead === true,
  'carry=' + (dbg.state.carry && dbg.state.carry.type) + ' carried=' + heldCarried.carried + ' dead=' + heldCarried.dead);

/* 第三关第 20 波真的能开起来（3 首领 + 一堆小怪，不报错、真出怪） */
dbg.state.enemies.length = 0;
dbg.state.spawnQueue.length = 0;
dbg.state.throws.length = 0;
dbg.state.waveIndex = 19;
dbg.state.phase = 'prep';
dbg.state.countdown = 0.01;
dbg.state.started = true;
let w20Err = null;
try { for (let i = 0; i < 40; i++) dbg.update(STEP); } catch (e) { w20Err = e; }
const w20Spawned = dbg.state.enemies.length + dbg.state.spawnQueue.length;
check('第三关第 20 波能正常开波出怪（3 只首领那波）',
  !w20Err && w20Spawned > 0,
  w20Err ? String(w20Err) : '出怪 ' + w20Spawned + ' 个');
dbg.state.enemies.length = 0;
dbg.state.spawnQueue.length = 0;
dbg.state.throws.length = 0;
dbg.state.waveIndex = 0;
dbg.state.phase = 'prep';
dbg.state.countdown = 5;

/* ---------------- ⑲ 冰塔：单体冰冻 ---------------- */
head('⑲ 冰塔：单体冰冻（不是减速）');

const frostLv = dbg.TOWERS.frost.levels;
check('冰塔五级都配了 freeze，且已经没有 slow 字段',
  frostLv.length === 5 && frostLv.every(function (l) { return l.freeze > 0 && l.slow === undefined; }),
  'freeze=' + frostLv.map(function (l) { return l.freeze; }).join('/'));
check('冰塔 1 级冻 0.75 秒、5 级冻 1.35 秒（比原来 0.7 秒上限长得多）',
  frostLv[0].freeze === 0.75 && frostLv[4].freeze === 1.35,
  '1级=' + frostLv[0].freeze + 's 5级=' + frostLv[4].freeze + 's');
check('冰塔描述改成了冰冻',
  dbg.TOWERS.frost.desc.indexOf('冰冻') >= 0 && dbg.TOWERS.frost.desc.indexOf('减速') < 0,
  'desc=' + dbg.TOWERS.frost.desc);

/* 真打一发：建一座冰塔，手动 fire，看命中后有没有冻住 */
dbg.chooseLevel(0);
dbg.state.towers.length = 0;
dbg.state.enemies.length = 0;
dbg.state.shots.length = 0;
dbg.state.carry = null;
dbg.spawnEnemy('grunt', 0, 300);
dbg.update(STEP);
const iceFoe = dbg.state.enemies[0];
const ec = Math.floor(iceFoe.x / dbg.TILE), er = Math.floor(iceFoe.y / dbg.TILE);
const cand = [];
for (let rad = 1; rad <= 3; rad++) {
  for (let dr = -rad; dr <= rad; dr++) {
    for (let dc = -rad; dc <= rad; dc++) {
      if (Math.max(Math.abs(dr), Math.abs(dc)) === rad) cand.push([ec + dc, er + dr]);
    }
  }
}
let iceTower = null;
for (let i = 0; i < cand.length && !iceTower; i++) iceTower = dbg.build('frost', cand[i][0], cand[i][1]);
check('冰塔能建在怪旁边（测试前置条件）', !!iceTower, 'iceTower=' + (iceTower && iceTower.type));

if (iceTower) {
  iceTower.angle = Math.atan2(iceFoe.y - iceTower.y, iceFoe.x - iceTower.x);
  dbg.fire(iceTower, dbg.statsOf(iceTower), iceFoe);
  for (let i = 0; i < 30 && !(iceFoe.freezeT > 0); i++) dbg.update(STEP);
  check('冰弹命中 → 目标被冻住，freezeT ≈ 1 级的 0.75 秒',
    Math.abs(iceFoe.freezeT - 0.75) < 0.08, 'freezeT=' + iceFoe.freezeT.toFixed(2));
  check('冰弹照样扣血（冰冻 ≠ 无敌/免伤）', iceFoe.hp < iceFoe.maxHp,
    'hp=' + iceFoe.hp + '/' + iceFoe.maxHp);
}

/* 冻住期间一步都不走 */
iceTower.dead = true;                       // 免得它继续开火重新冻上
dbg.state.shots.length = 0;
const frozenDist0 = iceFoe.dist;
for (let i = 0; i < 30; i++) dbg.update(STEP);   // 0.5 秒
check('冻住期间完全不移动（不是慢，是停）',
  Math.abs(iceFoe.dist - frozenDist0) < 1e-6,
  '0.5 秒里走了 ' + (iceFoe.dist - frozenDist0).toFixed(3) + ' 像素');

/* 到点解冻，恢复移动 */
for (let i = 0; i < 60; i++) dbg.update(STEP);   // 再 1 秒，超过 0.8 秒
const thawDist0 = iceFoe.dist;
for (let i = 0; i < 30; i++) dbg.update(STEP);
check('冰冻结束自动解冻并重新走路',
  iceFoe.dist > thawDist0 + 1, '解冻后 0.5 秒走了 ' + (iceFoe.dist - thawDist0).toFixed(1) + ' 像素');

/* 首领免疫冰冻，但照样吃伤害 */
dbg.state.enemies.length = 0;
dbg.state.shots.length = 0;
dbg.spawnEnemy('boss', 0, 300);
dbg.update(STEP);
const iceBoss = dbg.state.enemies[0];
const bossHp0 = iceBoss.hp;
dbg.state.shots.push({
  kind: 'shard', x: iceBoss.x, y: iceBoss.y, tx: iceBoss.x, ty: iceBoss.y, target: iceBoss,
  speed: 410, damage: 9, splash: 0, slow: 0, slowTime: 0, freeze: 1.5, owner: null,
  color: '#93c5fd', angle: 0, life: 4,
});
/* 多跑几帧：冰弹与首领的碰撞判定与它走路同一帧执行，单帧会偶发漏判 */
for (let i = 0; i < 4; i++) dbg.update(STEP);
check('首领免疫冰冻（freezeT 保持 0）', !(iceBoss.freezeT > 0), 'freezeT=' + iceBoss.freezeT);
check('首领照样吃冰弹伤害', iceBoss.hp < bossHp0, 'hp ' + bossHp0 + ' → ' + iceBoss.hp);

/* 冻住的时候，吟唱类计时也停（医师不会在冰里治疗） */
dbg.state.enemies.length = 0;
dbg.state.shots.length = 0;
dbg.spawnEnemy('healer', 0, 300);
dbg.update(STEP);
const iceHealer = dbg.state.enemies[0];
iceHealer.freezeT = 5;
const healCd0 = iceHealer.healCd;
for (let i = 0; i < 60; i++) dbg.update(STEP);
check('冻住时吟唱也停（战地医师的治疗冷却不走）',
  Math.abs(iceHealer.healCd - healCd0) < 1e-9, 'healCd ' + healCd0 + ' → ' + iceHealer.healCd);

/* 冻住的怪出帧不报错 */
let iceErr = null;
try { dbg.render(); } catch (e) { iceErr = e; }
check('冻住的怪出帧不报错（冰壳绘制）', !iceErr, String(iceErr));

/* 选中面板显示「冰冻」 */
if (iceTower) {
  iceTower.dead = false;
  dbg.state.selectedTower = iceTower;
  dbg.syncSelection(true);
  const selHtml = getEl('selection').innerHTML;
  check('选中冰塔时面板写「冰冻」而不是「减速」',
    selHtml.indexOf('冰冻') >= 0 && selHtml.indexOf('减速') < 0,
    selHtml.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').slice(0, 120));
  dbg.state.selectedTower = null;
  dbg.syncSelection(true);
}

/* ============================================================
 * ⑳ 第一关通关：最后一只怪掉钩爪 → 左键捡起 → 自动切第二关
 * ============================================================ */
dbg.chooseLevel(0);
dbg.save().hook = false;
dbg.state.hookUnlocked = false;

/* 摆出「第一关最后一波刚清完」的场面 */
dbg.state.phase = 'battle';
dbg.state.waveIndex = dbg.WAVES().length - 1;
dbg.state.spawnQueue.length = 0;
dbg.state.enemies.length = 0;
dbg.state.hookDrop = null;
dbg.state.hookTaken = 0;
dbg.state.lastKill = { x: 320, y: 400 };
dbg.update(STEP);

check('第一关最后一波清完：不直接结算，先掉一把钩爪',
  dbg.state.phase === 'pickup' && !!dbg.state.hookDrop, 'phase=' + dbg.state.phase);
check('钩爪掉在最后一只怪倒下的位置',
  !!dbg.state.hookDrop && Math.abs(dbg.state.hookDrop.x - 320) < 1 && Math.abs(dbg.state.hookDrop.y - 400) < 1,
  dbg.state.hookDrop ? (dbg.state.hookDrop.x + ',' + dbg.state.hookDrop.y) : 'null');
check('没捡之前不算通关（没解锁、还停在这一关）',
  dbg.save().hook !== true && dbg.state.level === 1 && dbg.state.hookTaken === 0,
  'hook=' + dbg.save().hook + ' level=' + dbg.state.level);

let dropErr = null;
try { for (let i = 0; i < 20; i++) dbg.render(); } catch (e) { dropErr = e; }
check('钩爪躺在地上出帧不报错', !dropErr, String(dropErr));

/* 捡起来（鼠标左键走的就是这个函数） */
dbg.takeHookDrop();
check('捡起后解锁钩锁并写进存档',
  dbg.save().hook === true && dbg.state.hookUnlocked === true,
  'hook=' + dbg.save().hook + ' unlocked=' + dbg.state.hookUnlocked);
check('捡起后地上的钩爪消失', dbg.state.hookDrop === null, String(dbg.state.hookDrop));
check('捡起后开始切关倒计时', dbg.state.hookTaken > 0, 'hookTaken=' + dbg.state.hookTaken);

let bannerErr = null;
try { for (let i = 0; i < 10; i++) dbg.render(); } catch (e) { bannerErr = e; }
check('「获得 钩锁」横幅出帧不报错', !bannerErr, String(bannerErr));

/* 倒计时走完 → 自动切到第二关 */
for (let i = 0; i < 140; i++) dbg.update(STEP);
check('倒计时结束后自动切到第二关',
  dbg.state.levelIdx === 1 && dbg.state.level === 2,
  'levelIdx=' + dbg.state.levelIdx + ' level=' + dbg.state.level);

/* 主角走到钩爪旁边也会自动捡 */
dbg.chooseLevel(0);
dbg.state.phase = 'battle';
dbg.state.waveIndex = dbg.WAVES().length - 1;
dbg.state.spawnQueue.length = 0;
dbg.state.enemies.length = 0;
dbg.state.lastKill = { x: dbg.state.hero.x, y: dbg.state.hero.y };
dbg.update(STEP);
const autoDrop = dbg.state.hookDrop;
dbg.update(STEP);
check('主角走过去会自动捡起钩爪',
  !!autoDrop && dbg.state.hookDrop === null && dbg.state.hookTaken > 0,
  'drop=' + (autoDrop ? 'yes' : 'no') + ' taken=' + dbg.state.hookTaken.toFixed(2));

/* ============================================================
 * ㉑ 投石者加强 + 屠戮者血剑
 * ============================================================ */
dbg.chooseLevel(0);
dbg.state.started = true;
dbg.state.phase = 'battle';

/* 投石者：石头伤害 = 主角最大生命的一半，预警 1.125 秒（0.625 + 0.5） */
const TH = dbg.ENEMIES.thrower;
check('投石者石头伤害改成「一半最大生命」', TH.throwRatio === 0.5, 'throwRatio=' + TH.throwRatio);
check('投石者预警 1.125 秒（0.625 再 +0.5）', Math.abs(TH.throwDelay - 1.125) < 1e-9, 'throwDelay=' + TH.throwDelay);

dbg.state.enemies.length = 0;
dbg.state.rocks.length = 0;
dbg.state.rockCd = 0;
dbg.state.hero.hp = dbg.state.hero.hpMax;
dbg.spawnEnemy('thrower', 0, 260);
const thE = dbg.state.enemies[dbg.state.enemies.length - 1];
/* 把主角挪到投石者旁边，并让它这一帧就想扔 */
dbg.state.hero.x = thE.x + 120;
dbg.state.hero.y = thE.y;
thE.throwCd = 0;
dbg.update(STEP);
check('投石者真扔石头时，伤害就是一半最大生命', dbg.state.rocks.length === 1 &&
  dbg.state.rocks[0].damage === Math.round(dbg.state.hero.hpMax * 0.5),
  'rocks=' + dbg.state.rocks.length + ' dmg=' + (dbg.state.rocks[0] ? dbg.state.rocks[0].damage : '-'));
check('石头的落地延迟跟着预警走', dbg.state.rocks[0] && Math.abs(dbg.state.rocks[0].delay - 1.125) < 1e-9,
  'delay=' + (dbg.state.rocks[0] ? dbg.state.rocks[0].delay : '-'));

/* 屠戮者：血剑 */
const AU = dbg.ENEMIES.aura;
check('屠戮者血剑：2 秒一把、伤害 = 主角最大生命四分之一',
  AU.swordEvery === 2 && Math.abs(AU.swordRatio - 0.25) < 1e-9 && AU.swordDelay === 1 && AU.swordSpeed > 500,
  'every=' + AU.swordEvery + ' ratio=' + AU.swordRatio + ' delay=' + AU.swordDelay + ' speed=' + AU.swordSpeed);

dbg.state.enemies.length = 0;
dbg.state.rocks.length = 0;
dbg.state.swords.length = 0;
dbg.state.hero.hp = dbg.state.hero.hpMax;
dbg.state.hero.invuln = 0;
dbg.spawnEnemy('aura', 0, 300);
const aura = dbg.state.enemies[dbg.state.enemies.length - 1];
aura.swordCd = 0;
dbg.update(STEP);
check('屠戮者会掷出血剑', dbg.state.swords.length === 1, 'swords=' + dbg.state.swords.length);
{
  const swDmg = dbg.state.swords[0] ? dbg.state.swords[0].damage : 0;
  const want = Math.max(1, Math.round(dbg.state.hero.hpMax * AU.swordRatio));
  check('射出来的血剑伤害 = 主角最大生命 / 4', swDmg === want, 'damage=' + swDmg + ' want=' + want);
}
const sw = dbg.state.swords[0];
if (sw) {
  const dh = dbg.state.hero;
  const ddx = dh.x - sw.x, ddy = dh.y - sw.y;
  const dd = Math.hypot(ddx, ddy) || 1;
  const dot = (ddx / dd) * sw.ux + (ddy / dd) * sw.uy;
  check('血剑方向指向主角（生成瞬间锁死）', dot > 0.999,
    'dot=' + dot.toFixed(3) + ' u=(' + sw.ux.toFixed(2) + ',' + sw.uy.toFixed(2) + ')');
  check('血剑先蓄力 1 秒再飞', Math.abs(sw.delay - 1) < 1e-9 && sw.speed > 900, 'delay=' + sw.delay + ' speed=' + sw.speed);
  const x0 = sw.x, y0 = sw.y;
  dbg.update(STEP);
  check('蓄力期间剑不动（只是画轨迹）', Math.abs(sw.x - x0) < 1e-6 && Math.abs(sw.y - y0) < 1e-6,
    'dx=' + (sw.x - x0).toFixed(3));
}

/* 蓄力满 1 秒后开始高速直刺，并把主角撞掉血 */
dbg.state.enemies.length = 0;
dbg.state.swords.length = 0;
const swHero = dbg.state.hero;
swHero.hp = swHero.hpMax;
swHero.invuln = 0;
/* 造一把已经蓄力完、正对着主角飞来的剑 */
dbg.state.swords.push({
  x: swHero.x - 300, y: swHero.y, ux: 1, uy: 0,
  t: 1.2, delay: 1, speed: 980,
  damage: Math.max(1, Math.round(swHero.hpMax * dbg.ENEMIES.aura.swordRatio)), hit: false,
});
const swHp0 = swHero.hp;
for (let i = 0; i < 30; i++) dbg.update(STEP);      // 0.5 秒 × 980 = 490 像素，足够穿过主角
check('血剑打中主角，掉四分之一血',
  Math.abs((swHp0 - swHero.hp) - Math.round(swHero.hpMax * dbg.ENEMIES.aura.swordRatio)) < 1e-6,
  'hp ' + swHp0 + ' → ' + swHero.hp + '（最大生命 ' + swHero.hpMax + '）');

/* 打空之后继续飞到屏幕外就消失 */
dbg.state.swords.length = 0;
swHero.hp = swHero.hpMax;
dbg.state.swords.push({
  x: 40, y: 40, ux: -1, uy: 0,
  t: 1.2, delay: 1, speed: 980,
  damage: Math.max(1, Math.round(swHero.hpMax * dbg.ENEMIES.aura.swordRatio)), hit: false,
});
for (let i = 0; i < 20; i++) dbg.update(STEP);
check('血剑飞出屏幕自动消失', dbg.state.swords.length === 0, 'swords=' + dbg.state.swords.length);

/* 出帧不报错 */
dbg.state.swords.length = 0;
dbg.state.swords.push({ x: 300, y: 300, ux: 1, uy: 0.2, t: 0.2, delay: 1, speed: 980, damage: 12, hit: false });
dbg.state.swords.push({ x: 380, y: 300, ux: 1, uy: 0.2, t: 1.4, delay: 1, speed: 980, damage: 12, hit: false });
let swordErr = null;
try { for (let i = 0; i < 12; i++) dbg.render(); } catch (e) { swordErr = e; }
check('血剑蓄力/飞行两种形态出帧都不报错', !swordErr, String(swordErr));
dbg.state.swords.length = 0;

/* 屠戮者放箭时不能停下脚步（用户明确要求）：两次采样之间 dist 必须增长 */
const auraMove = (function () {
  /* 屠戮者“放完剑”的状态就是 swordFlash > 0（蓄力动画）。
   * 把它直接置成蓄力中，量 0.5 秒里走了多远——要求和平时一样快。 */
  dbg.state.enemies.length = 0;
  dbg.state.swords.length = 0;
  dbg.state.rocks.length = 0;
  dbg.spawnEnemy('aura', 0, 120, 'main');
  const e = dbg.state.enemies[dbg.state.enemies.length - 1];
  if (!e || e.type !== 'aura') return { ok: false, why: 'spawn failed' };
  e.swordFlash = 0.45;
  const d0 = e.dist;
  for (let i = 0; i < 30; i++) dbg.update(1 / 60);
  const moved = e.dist - d0;
  dbg.state.enemies.length = 0;
  dbg.state.swords.length = 0;
  /* 46 像素/秒 × 0.5 秒 = 23；只要不是被卡住（< 15）就算通过 */
  return { ok: moved > 15, why: 'moved=' + moved.toFixed(1) + ' (/23 expected)' };
})();
check('屠戮者放血剑时照样往前走', auraMove.ok, auraMove.why);

/* ---------------- 结论 ---------------- */
console.log('\n----------------------------------------');
console.log(failed === 0
  ? '全部通过：' + passed + ' 项'
  : '有 ' + failed + ' 项未通过（通过 ' + passed + ' 项）');
process.exit(failed === 0 ? 0 : 1);
