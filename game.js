/* ============================================================
 *  绿野防线 · 简易网页塔防（单关）
 *  纯 Canvas 2D + 原生 JS，无任何依赖
 * ============================================================ */
(function () {
  'use strict';

  /* ============================================================
   * 1. 常量与配置
   * ============================================================ */
  const TILE = 44, COLS = 24, ROWS = 15;
  const W = COLS * TILE, H = ROWS * TILE;

  /* 主角基础伤害（原来 11；升级每级再加 0.6，「锋利箭镞」强化再加 3） */
  const HERO_DAMAGE = 16;

  /* ---------- 难度：地狱难度（温和档）----------
   * 想调难度只改这一块：倍率会**叠在关卡自身的数值上**（第二关本来就更硬）。
   * 把敌人血量 / 拆塔破坏力 / 金币倍率改回 1、生命改回 10（第二关原来是 9）、
   * 准备时间改回 14，就是改动前的手感。 */
  const HELL = {
    enemyHp: 1.5,      // 敌人血量倍率
    saboteur: 1.3,     // 拆塔者破坏力倍率
    money: 0.7,        // 初始金币倍率
    lives: 5,          // 初始基地生命（两关统一）
    prep: 10,          // 每波准备时间（秒）
  };

  const START_MONEY = 220;   // 基准值（实际每关用 LEVEL_SETUP 的金币 × HELL.money）
  const START_LIVES = HELL.lives;
  const PREP_TIME = HELL.prep;   // 每波之间的准备时间（秒）
  const HP_PER_WAVE = 0.17;  // 每波敌人血量成长（第 15 波为 3.4 倍）
  const MAX_LEVEL = 3;       // 花钱能升到的最高级；再往上只能靠第二关的「升级台」（见 TOWERS.bench）
  const SELL_RATE = 0.6;     // 出售返还比例
  const ROCK_GAP = 1.5;      // 落石全局节流：任意两块石头至少间隔这么多秒
  /* 一次性炸弹：以主角为中心引爆，秒杀范围内血量最高的若干个敌人 */
  const BOMB_RADIUS = 168;
  const BOMB_KILLS = 5;
  const BOMB_COST = 150;     // 额外购买一颗的价格
  const START_BOMBS = 1;
  const BOMB_MAX = 3;
  const BOMB_COOLDOWN = 20;  // 引爆后的冷却（秒）

  /* ---------- 第一关：三条路 ----------
   * 设计原则：
   *  1) 三条路尽量分居不同区域，避免「一条直线平行贴在一起」——
   *     那样一座塔能同时打到两条路，防线效率会翻倍；
   *  2) 汇合之后共用的一段刻意拉成**笔直的长直线**，
   *     敌人快速穿过火力圈，同样的塔数打出的总伤害会明显下降。 */
  const PATH_GRID = [
    [-1, 2], [3, 2], [3, 11], [6, 11], [6, 2], [9, 2],
    [9, 11],                               // 紧凑三折蛇形：三趟竖路只隔 3 格，塔能一次覆盖两趟
    [24, 11],                              // 汇合后的笔直终点大道（终点留在 col 24，
                                           //  让「漏怪」发生在画布内、就在基地上）
  ];
  /* 第二条：从画面右侧上方进场，横向插入蛇形区顶部——
   * 之后要和主路共用整条蛇形区 + 终点大道，塔才有足够时间打 */
  const SIDE_GRID = [[25, 2], [9, 2]];
  /* 第三条：南侧地道（画面正下方）进场，沿最左侧上行，插入蛇形区西侧 */
  const EAST_GRID = [[1, 15], [1, 7], [3, 7]];
  const SIDE_OPEN_WAVE = 3;   // 第 4 波开启东北侧路
  const EAST_OPEN_WAVE = 5;   // 第 6 波开启南侧地道

  /* ---------- 第二关：两条路（双路统一出怪）----------
   * 主路是一条四折长蛇形（四趟竖路只隔 4 格），第二条从右下角插进蛇形区底部，
   * 汇合之后共用一条笔直的中路大道。两路的怪是「轮流对半出」的，
   * 所以两条路的压力始终一样大——想守就得把塔在两条路之间搬，
   * 这正是本关新道具「钩索」的用武之地。 */
  const L2_MAIN_GRID = [
    [-1, 3], [4, 3], [4, 11], [8, 11], [8, 3], [12, 3],
    [12, 11], [16, 11], [16, 7],           // 四折蛇形
    [24, 7],                               // 笔直的中路大道（终点留在 col 24，
                                           //  这样「漏怪」那一下发生在画布内、就在基地上）
  ];
  /* 第二条：从画面右上方进场，沿最右侧一路下行，**直接插到终点大道上**——
   * 它和主路的四折蛇形始终保持 4 格以上的距离，只在最后 6 格与主路共用。
   * 注意：拐点的列号必须 ≤ COLS-1（23），否则这一段路会伸到画布外，
   * 怪会在看不见的地方走一大截（原来写的就是 24，已经改回来）。 */
  const L2_SIDE_GRID = [[25, 0], [17, 0], [17, 2], [23, 2], [23, 4], [17, 4], [17, 7]];
  const L2_SIDE_OPEN_WAVE = 3;               // 第 4 波起第二条路才开始出怪，给玩家布防时间

  /* ---------- 第三关：红主路 + 绿侧路 + 蓝河（照 图3.png 的草图描出来的）----------
   * 图3 是手绘的规划图：红线＝主路（从画面上方进场，两次折返后从右侧冲进基地），
   * 绿线＝侧路（从左上进场，绕一大圈从下方汇入主路的终点大道），蓝线＝河。
   * 网格是 24×15，描的时候按「离哪条格线近就贴哪条」对齐，误差不超过半格。 */
  const L3_MAIN_GRID = [
    [8, -1], [8, 4], [14, 4], [14, 2], [18, 2], [18, 4], [23, 4], [23, 7],
    [24, 7],                               // 终点留在 col 24：漏怪那一下发生在画布内、就在基地上
  ];
  const L3_SIDE_GRID = [
    [1, -1], [1, 14], [6, 14], [6, 12], [16, 12], [16, 13], [20, 13], [20, 11],
    [23, 11], [23, 7],                     // 沿最右列往北爬，正好在主路拐向终点的 (23,7) 汇入
  ];
  /* 河：三段矩形拼成一个 Z 形水带（左竖 → 中横 → 右竖）。
   * 侧路在 (13,12)(14,12) 那两格压在水面上，会自动变成桥；主路一路都在岸上。 */
  const L3_WATER = [
    { c1: 3, c2: 4, r1: 0, r2: 7 },
    { c1: 3, c2: 14, r1: 6, r2: 7 },
    { c1: 13, c2: 14, r1: 6, r2: 15 },
  ];
  const L3_SIDE_OPEN_WAVE = 2;               // 第 3 波起绿侧路开始出怪

  /** 把格子坐标折线变成带累计长度的路线对象 */
  function buildRoute(gridPts) {
    const pts = gridPts.map(function (g) {
      return { x: g[0] * TILE + TILE / 2, y: g[1] * TILE + TILE / 2 };
    });
    const segs = [];
    let len = 0;
    for (let i = 1; i < pts.length; i++) {
      const l = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
      segs.push(l);
      len += l;
    }
    return { pts: pts, segs: segs, len: len, progressOffset: 0 };
  }

  /** 按路程取某条路线上的坐标与朝向 */
  function posAt(route, d) {
    const pts = route.pts, segs = route.segs;
    if (d <= 0) {
      return { x: pts[0].x, y: pts[0].y, angle: Math.atan2(pts[1].y - pts[0].y, pts[1].x - pts[0].x) };
    }
    let acc = 0;
    for (let i = 0; i < segs.length; i++) {
      if (acc + segs[i] >= d) {
        const t = (d - acc) / segs[i];
        const a = pts[i], b = pts[i + 1];
        return {
          x: a.x + (b.x - a.x) * t,
          y: a.y + (b.y - a.y) * t,
          angle: Math.atan2(b.y - a.y, b.x - a.x),
        };
      }
      acc += segs[i];
    }
    const last = pts[pts.length - 1], prev = pts[pts.length - 2];
    return { x: last.x, y: last.y, angle: Math.atan2(last.y - prev.y, last.x - prev.x) };
  }

  /** 支路都会并入主路：算出并线里程，并让「推进程度」在并线前后保持连续 */
  function linkRoute(route, mainRoute) {
    const tip = route.pts[route.pts.length - 1];
    let best = 0, bestD = Infinity;
    for (let d = 0; d <= mainRoute.len; d += 4) {
      const p = posAt(mainRoute, d);
      const dd = Math.hypot(p.x - tip.x, p.y - tip.y);
      if (dd < bestD) { bestD = dd; best = d; }
    }
    route.mergeDist = best;
    route.progressOffset = best - route.len;
  }

  /** 路径占用的格子（不可建造） */
  function buildBlocked(grids) {
    const set = new Set();
    for (let g = 0; g < grids.length; g++) {
      const grid = grids[g];
      if (!grid) continue;
      for (let i = 1; i < grid.length; i++) {
        const x1 = grid[i - 1][0], y1 = grid[i - 1][1];
        const x2 = grid[i][0], y2 = grid[i][1];
        const sx = Math.sign(x2 - x1), sy = Math.sign(y2 - y1);
        let cx = x1, cy = y1;
        for (let guard = 0; guard < 200; guard++) {
          /* 只在网格内的格子才计入——路径起点/终点本来就在画面外，
           * 直接压成 r*COLS+c 会和别的行发生索引碰撞 */
          if (cx >= 0 && cx < COLS && cy >= 0 && cy < ROWS) set.add(cy * COLS + cx);
          if (cx === x2 && cy === y2) break;
          cx += sx; cy += sy;
        }
      }
    }
    return set;
  }

  /** 一套关卡地图：主路 + 若干支路 */
  function makeLaneSet(mainGrid, subs) {
    const main = buildRoute(mainGrid);
    const sub = [], grids = [mainGrid];
    for (let i = 0; i < subs.length; i++) {
      const s = subs[i];
      if (!s.grid) continue;
      const r = buildRoute(s.grid);
      linkRoute(r, main);
      sub.push({ key: s.key, route: r, openWave: s.openWave, name: s.name });
      grids.push(s.grid);
    }
    const lanes = { main: main };
    for (let i = 0; i < sub.length; i++) lanes[sub[i].key] = sub[i].route;
    return { main: main, sub: sub, lanes: lanes, blocked: buildBlocked(grids) };
  }

  /* ---------- 关卡表 ---------- */
  const LEVEL_SETUP = [
    {
      id: 1, name: '第一关', mapName: '蜿蜒小径',
      lanes: makeLaneSet(PATH_GRID, [
        { key: 'side', grid: SIDE_GRID, openWave: SIDE_OPEN_WAVE, name: '东北侧路' },
        { key: 'east', grid: EAST_GRID, openWave: EAST_OPEN_WAVE, name: '南侧地道' },
      ]),
      hook: false,        // 本关没有钩索
      twin: false,        // 不启用「双路轮流对半出怪」
      /* 第一关小怪血量：0.8 × HELL.enemyHp(1.5) = **×1.2**（原来是 ×1.5）——
       * 第一关只有 154 开局金币、又要同时铺三条路的防守，所以单独给它松一点；
       * 想再调就改这个 0.8（1 = 回到和地狱倍率一致的 ×1.5） */
      money: 220, hpScale: 0.8, sabScale: 1,   // 基准值，实际还要 × HELL 倍率
      bench: null,                      // 升级台只有第二关有（第一关没有）
      river: null,                      // 本关没有河
      info: '三条路 · 折返蛇形 · 终点大道',
    },
    {
      id: 2, name: '第二关', mapName: '双子回廊',
      lanes: makeLaneSet(L2_MAIN_GRID, [
        { key: 'side', grid: L2_SIDE_GRID, openWave: L2_SIDE_OPEN_WAVE, name: '南侧支线' },
      ]),
      hook: true,         // 本关有钩索
      twin: true,         // 两条路统一出怪：每批怪对半轮流走两路
      /* 拆塔者倍率从 2.4 降到 1.8：删掉回血塔的 -40% 光环后重新配平 */
      money: 420, hpScale: 1.25, sabScale: 1.8,   // 基准值，实际还要 × HELL 倍率
      bench: { c: 7, r: 9 },           // 升级台的交付点（每波清完在这儿刷一个）
      river: { c1: 13, c2: 14 },       // 一条南北向的河，靠两座桥过河
      info: '两条路 · 四折蛇形 · 河与桥 · 钩索搬运 · 升级台',
    },
    {
      id: 3, name: '第三关', mapName: '浮桥水镇',
      lanes: makeLaneSet(L3_MAIN_GRID, [
        { key: 'side', grid: L3_SIDE_GRID, openWave: L3_SIDE_OPEN_WAVE, name: '西侧绿道' },
      ]),
      hook: true,
      twin: false,
      /* 第三关的数值：怪更肉（1.6 × 地狱 1.5 = ×2.4）、拆塔者也更狠，
       * 但开局金币给得多，而且开场就送一把保护伞 + 一座升级台 */
      money: 480, hpScale: 1.6, sabScale: 2.0,
      hpPerWave: 0.14,                 // 20 波，斜率比别的关缓（第 20 波 3.66 倍）
      bench: { c: 10, r: 10 },         // 升级台交付点
      startBench: true,                // 开场就有（不等清波）
      water: L3_WATER,                 // L 形河道
      startUmbrellas: [{ c: 5, r: 9 }],   // 开场白送的一把保护伞
      heroStart: { c: 9, r: 10 },
      info: '红主路 · 绿侧路 · 河道与桥 · 蹦极偷塔 · 保护伞',
    },
  ];

  /* 当前生效的关卡数据（下面这些在 activateLevel 里被整体替换） */
  let ROUTE_MAIN = null, ROUTE_SIDE = null, ROUTE_EAST = null;
  let LANES = {}, SUB_LANES = [], BLOCKED = new Set();
  let PATH = [], PATH_LEN = 0, GOAL = { x: 0, y: 0 }, GOAL_DIST = 0;
  let WAVES = [];
  let TWIN_SPAWN = false;
  let DECOR = [];
  let WATER = new Set();                 // 河面（不能建造、主角不能走）
  let BRIDGE = [];                       // 桥（= 河面上的路面格），只用于绘制
  let RIVER = null;                      // 当前关卡的河道范围

  /** 切换关卡：重建路线引用、阻挡格、河、装饰与波次表 */
  function activateLevel(idx) {
    const lv = LEVEL_SETUP[idx];
    state.level = lv.id;
    state.levelIdx = idx;
    ROUTE_MAIN = lv.lanes.main;
    ROUTE_SIDE = lv.lanes.side || null;
    ROUTE_EAST = lv.lanes.east || null;
    LANES = lv.lanes.lanes;
    SUB_LANES = lv.lanes.sub;
    BLOCKED = lv.lanes.blocked;
    PATH = ROUTE_MAIN.pts;
    PATH_LEN = ROUTE_MAIN.len;
    GOAL_DIST = PATH_LEN - TILE * 1.0;
    GOAL = { x: W - 30, y: PATH[PATH.length - 1].y };
    WAVES = lv.id === 2 ? WAVES_2 : (lv.id === 3 ? WAVES_3 : WAVES_1);
    TWIN_SPAWN = lv.twin;
    /* 地狱难度：关卡自身倍率 × HELL 倍率 */
    state.hpScale = (lv.hpScale || 1) * HELL.enemyHp;
    /* 每波血量成长：第三关有 20 波，用更缓的斜率，免得第 20 波血量飞到天上 */
    state.hpPerWave = lv.hpPerWave || HP_PER_WAVE;
    state.sabScale = (lv.sabScale || 1) * HELL.saboteur;
    state.hookOn = lv.hook;
    state.benchCell = lv.bench || null;
    /* 河：一个或多个矩形水带（第一关没有、第二关一条南北向、第三关三段拼成 Z 形）。
     * 路压在水面上的那几格自动变成「桥」 */
    WATER = new Set();
    BRIDGE = [];
    RIVER = lv.water || (lv.river ? [{ c1: lv.river.c1, c2: lv.river.c2, r1: 0, r2: ROWS - 1 }] : null);
    if (RIVER) {
      const bridgeSeen = new Set();
      for (let i = 0; i < RIVER.length; i++) {
        const w = RIVER[i];
        for (let r = w.r1; r <= w.r2; r++) {
          for (let c = w.c1; c <= w.c2; c++) {
            if (c < 0 || c >= COLS || r < 0 || r >= ROWS) continue;
            const key = r * COLS + c;
            if (isPath(c, r)) {
              if (!bridgeSeen.has(key)) { bridgeSeen.add(key); BRIDGE.push({ c: c, r: r }); }
            } else {
              WATER.add(key);
            }
          }
        }
      }
    }
    state.laneOpen = {};
    state.laneFlash = {};
    for (let i = 0; i < SUB_LANES.length; i++) {
      state.laneOpen[SUB_LANES[i].key] = false;
      state.laneFlash[SUB_LANES[i].key] = 0;
    }
    /* 装饰按当前地图重新撒一遍 */
    DECOR = [];
    seed = 20240607;
    for (let c = 0; c < COLS; c++) {
      for (let r = 0; r < ROWS; r++) {
        if (isPath(c, r) || isWater(c, r)) continue;
        if (rnd() < 0.05) DECOR.push({ c: c, r: r, kind: rnd() < 0.68 ? 'bush' : 'rock', s: 0.75 + rnd() * 0.5 });
      }
    }
    /* 顶栏与标签页也跟着关卡走 */
    const sub = document.querySelector('.brand p');
    if (sub) sub.textContent = lv.name + ' · ' + lv.mapName;
    if (document.title !== undefined) document.title = '绿野防线 · ' + lv.name + ' ' + lv.mapName;
    bgDirty = true;
  }

  /** 敌人在「离基地的推进程度」上的进度（各条路统一可比） */
  function progressOf(e) { return e.dist + e.route.progressOffset; }

  function isPath(c, r) { return BLOCKED.has(r * COLS + c); }

  /* ---------- 防御塔数据 ----------
   * hp        基础耐久（每升一级 +35%，被打坏就没了）
   * taunted   是否会被「诱饵」吸引火力（只有炮塔会）
   * splash    溅射半径，中心全额、边缘 65%
   * levels    等级表：**花钱只能升到 MAX_LEVEL 级**，再往上要靠第二关的「升级台」（见 bench）
   */
  const TOWERS = {
    arrow: {
      key: 'arrow', name: '箭塔', icon: '🏹', cost: 50, hp: 170,
      body: '#4ade80', trim: '#166534', proj: 'arrow', projSpeed: 470,
      desc: '攻速快，单体输出，不怕诱饵',
      levels: [
        { damage: 15, range: 112, rate: 1.4 },
        { damage: 26, range: 124, rate: 1.65 },
        { damage: 46, range: 140, rate: 1.95 },
        { damage: 76, range: 152, rate: 2.2 },     // 4 级起只能靠升级台
        { damage: 120, range: 164, rate: 2.45 },
      ],
      upgrade: [55, 120],
    },
    cannon: {
      key: 'cannon', name: '炮塔', icon: '💥', cost: 90, hp: 245, taunted: true,
      body: '#fb923c', trim: '#7c2d12', proj: 'shell', projSpeed: 280,
      desc: '大范围溅射，怕近身，会被诱饵吸引',
      levels: [
        { damage: 30, range: 134, rate: 0.58, splash: 64 },
        { damage: 50, range: 146, rate: 0.66, splash: 74 },
        { damage: 80, range: 160, rate: 0.76, splash: 86 },
        { damage: 118, range: 172, rate: 0.86, splash: 96 },
        { damage: 165, range: 184, rate: 0.96, splash: 106 },
      ],
      upgrade: [90, 190],
    },
    frost: {
      key: 'frost', name: '冰塔', icon: '❄️', cost: 70, hp: 195,
      body: '#60a5fa', trim: '#1e3a8a', proj: 'shard', projSpeed: 410,
      desc: '单体冰冻：命中的敌人直接定住，首领免疫',
      /* 冰冻＝彻底停住：不走路、不拆塔、不推人、不扔石头、不治疗、不召唤。
       * 只冻一个目标，伤害依旧很低，所以它是控制塔而不是输出塔。
       * LV5 射速 0.69 秒一发、冻 1.35 秒，同一只怪会被一直锁住——首领免疫就是这个原因。 */
      levels: [
        { damage: 9, range: 108, rate: 0.95, freeze: 0.75 },
        { damage: 16, range: 120, rate: 1.05, freeze: 0.90 },
        { damage: 26, range: 134, rate: 1.15, freeze: 1.05 },
        { damage: 40, range: 148, rate: 1.30, freeze: 1.20 },
        { damage: 58, range: 162, rate: 1.45, freeze: 1.35 },
      ],
      upgrade: [70, 150],
    },
    /* 升级台：**只有第二关有**，不是玩家造的，而是每波清完后在「交付台」刷新一个。
     * 它无敌、不攻击、拆不掉，唯一的用法是被钩索端起（和搬塔一样），
     * 走到自己的防御塔旁边再按一次左 Shift，直接把那座塔**免费升一级**——
     * 而且能突破 MAX_LEVEL（花钱最多 3 级），一路升到 levels 表里的最高级。 */
    bench: {
      key: 'bench', name: '升级台', icon: '⬆️', cost: 0, hp: 1,
      body: '#fbbf24', trim: '#78350f', proj: null, projSpeed: 0,
      desc: '无敌固定设施：用钩索搬到塔上 → 免费升一级（可突破 3 级上限）',
      invincible: true, noSell: true, isBench: true,
      levels: [{ damage: 0, range: 0, rate: 1 }],
      upgrade: [0],
    },
    /* 保护伞：**只有第三关有**，开场就白送一把。它是无敌固定设施，不攻击、拆不掉，
     * 用钩索端起就能搬到任何地方（连路面都能放）。作用是「弹飞落下来的蹦极」：
     * 只要蹦极要偷的塔在伞的覆盖半径内，蹦极落地那一刻直接被弹没，塔保住。
     * 对扔在塔上的靶子本身没有任何影响。 */
    umbrella: {
      key: 'umbrella', name: '保护伞', icon: '☂️', cost: 0, hp: 1,
      body: '#22c55e', trim: '#14532d', proj: null, projSpeed: 0,
      desc: '无敌固定设施：钩索搬到哪里，哪里半径 96 内的塔就不会被蹦极偷走',
      invincible: true, noSell: true, isUmbrella: true,
      levels: [{ damage: 0, range: 0, rate: 1 }],
      upgrade: [0],
    },
  };
  const TOWER_KEYS = ['arrow', 'cannon', 'frost'];   // 玩家能建造的塔

  /* ---------- 敌人数据 ----------
   * leak     突破防线扣的生命值
   * touch    撞到主角时主角掉的血（撞完会被弹回去）
   * xp       击杀后主角获得的经验（主角亲手击杀全额，塔在主角附近击杀 40%）
   * shield   护盾值（先于血量承受伤害，脱战后自动回充）
   * heal*    周期性治疗周围友军
   * split    死亡时分裂出的小怪数量
   * summon*  首领周期性召唤援军
   * tip      首次出场时弹窗里的那一句「特性」——一句话就够，别写成说明书
   */
  const ENEMIES = {
    grunt: {
      name: '小兵', hp: 92, speed: 70, reward: 8, r: 11,
      color: '#f472b6', dark: '#9d174d', armor: 0, leak: 1, touch: 6, xp: 5,
      tip: '最普通的杂兵：单体很弱，靠数量磨你的防线',
    },
    runner: {
      name: '疾行者', hp: 72, speed: 138, reward: 9, r: 9,
      color: '#facc15', dark: '#854d0e', armor: 0, leak: 1, touch: 5, xp: 5,
      tip: '移速最快（138），血很少 —— 一不留神就溜过防线',
    },
    tank: {
      name: '重甲兵', hp: 490, speed: 41, reward: 22, r: 14,
      color: '#a78bfa', dark: '#4c1d95', armor: 6, leak: 2, touch: 14, xp: 14,
      tip: '血厚 + 6 点护甲，走得慢但很抗打（主角的箭无视护甲）',
    },
    splitter: {
      name: '分裂史莱姆', hp: 186, speed: 60, reward: 13, r: 13,
      color: '#34d399', dark: '#065f46', armor: 1, leak: 1, split: 2, touch: 8, xp: 7,
      tip: '被打死会分裂成 2 只小史莱姆，最好在离基地远的地方解决',
    },
    mini: {
      name: '小史莱姆', hp: 58, speed: 112, reward: 3, r: 8,
      color: '#6ee7b7', dark: '#047857', armor: 0, leak: 1, touch: 4, xp: 1,
      tip: '大史莱姆分裂出来的小家伙：血少、跑得快',
    },
    shield: {
      name: '护盾兵', hp: 292, speed: 57, reward: 24, r: 13,
      color: '#38bdf8', dark: '#0c4a6e', armor: 3, leak: 2, touch: 10, xp: 12,
      shield: 280, shieldRegen: 58, shieldDelay: 3.5,
      tip: '自带 280 点护盾，脱战 3.5 秒后会自动回充 —— 别打打停停',
    },
    healer: {
      name: '战地医师', hp: 244, speed: 55, reward: 28, r: 12,
      color: '#f9a8d4', dark: '#9d174d', armor: 2, leak: 2, touch: 7, xp: 12,
      healRadius: 105, healAmount: 35, healEvery: 1.7,
      tip: '给半径 105 内的敌人持续回血 —— 优先集火它',
    },
    boss: {
      name: '首领', hp: 1870, speed: 47, reward: 125, r: 19,
      color: '#ef4444', dark: '#7f1d1d', armor: 8, leak: 5, touch: 25, xp: 70,
      summonEvery: 7, summonType: 'runner', summonCount: 2,
      /* 沉默波：每 6 秒把身边（160 像素内）最近的 5 座塔**哑火 3 秒**，
       * 同时各砸掉 60 点耐久。升级台与无敌设施不吃这一套。 */
      silenceEvery: 6, silenceRadius: 160, silenceCount: 5,
      silenceTime: 3, silenceDamage: 60,
      tip: '每 6 秒沉默身边 5 座塔 3 秒；每 7 秒召唤 2 只疾行者',
    },
    /* 小怪 1：拆塔者——边走边拆，一次锁定 174 像素内所有防御塔。
     * 伤害从 12 降到 10（叠上关卡倍率与地狱 ×1.3 后：第一关 13 点/次、第二关 23 点/次），
     * 因为「回血塔」的 -40% 减伤光环已经删掉了，这里必须先降下来。 */
    saboteur: {
      name: '拆塔者', hp: 210, speed: 76, reward: 20, r: 11,
      color: '#a3e635', dark: '#3f6212', armor: 1, leak: 2, touch: 9, xp: 9,
      attackRange: 174, attackDamage: 10, attackEvery: 1.2,
      tip: '边走边拆塔：一次锁定 174 像素内的所有防御塔，塔别挤成一片',
    },
    /* 小怪 2：诱饵——不走小路，直线抄近路冲向基地；血厚、完全不造成伤害，
     * 但会把附近的炮塔火力吸引到自己身上 */
    decoy: {
      name: '诱饵', hp: 525, speed: 44, reward: 32, r: 16,
      color: '#fde047', dark: '#a16207', armor: 0, leak: 1, touch: 0, xp: 14,
      free: true, taunt: true, tauntRadius: 110,
      tip: '不走小路，从地图边缘直线冲向基地；不掉血，但会吸走炮塔的火力',
    },
    /* 小怪 3：督军——移速很高，跟在大部队后面，周期性把前方两个敌人往前推。
     * 前方没人时会放慢速度等队伍跟上来 */
    overseer: {
      name: '督军', hp: 162, speed: 108, reward: 16, r: 11,
      color: '#14b8a6', dark: '#134e4a', armor: 1, leak: 2, touch: 6, xp: 10,
      pushEvery: 2.1, pushRange: 215, pushCount: 2, pushAmount: 64,
      tip: '跟在大部队后面，周期把前面的怪往前推 —— 相当于给全队加速',
    },
    /* 小怪 4：投石者——朝主角当前位置扔石头，落点有醒目预警，砸中很疼但可以躲开。
     * throwRatio 是「主角最大生命的比例」，所以主角血量不会再随升级变厚 */
    thrower: {
      name: '投石者', hp: 259, speed: 48, reward: 26, r: 13,
      color: '#f97316', dark: '#7c2d12', armor: 2, leak: 2, touch: 8, xp: 16,
      throwEvery: 5.5, throwRange: 400, throwDelay: 1.125, throwRatio: 0.5, throwRadius: 36,
      tip: '朝主角扔石头：砸中掉一半最大生命，落点有约 1.1 秒预警',
    },
    /* 小怪 5：屠戮者——走路时一直开着杀戮光环，站在光环里的主角持续掉血。
     * 光环对防御塔完全没有伤害 */
    aura: {
      name: '屠戮者', hp: 281, speed: 46, reward: 24, r: 14,
      color: '#e11d48', dark: '#4c0519', armor: 2, leak: 2, touch: 8, xp: 14,
      auraRadius: 96, auraDps: 16,
      /* 血剑：隔一段时间从附近小怪身上凝出一把剑，蓄力 1 秒后沿轨迹高速直刺，
       * 途中撞到主角才掉血，飞出屏幕就消失。伤害按「主角最大生命的比例」算，
       * 所以主角升级变厚之后它也跟着变疼 */
      swordEvery: 2, swordRange: 560, swordDelay: 1, swordRatio: 0.25, swordSpeed: 980,
      tip: '半径 96 杀戮光环，每 2 秒朝主角掷一把血剑',
    },
    /* 小怪 6（第三关专属）：蹦极——**不走小路、全程无敌**，平时待在屏幕外。
     * 出场时随机挑一座防御塔贴一张「靶子」当落点预告，bungeeDrop 秒后从屏幕上方
     * 俯冲下来把整座塔偷走，再抓着塔飞回屏幕外消失。
     * 靶子本身无害；塔只要被保护伞罩着，落下来那一刻蹦极就被弹飞、直接消失。 */
    bungee: {
      name: '蹦极', hp: 1, speed: 0, reward: 0, r: 13,
      color: '#8b5cf6', dark: '#4c1d95', armor: 0, leak: 0, touch: 0, xp: 0,
      bungeeDrop: 5,                     // 靶子挂上去之后，隔几秒俯冲下来偷
      tip: '只在屏幕外跳来跳去：贴靶子 5 秒后俯冲偷塔，全程无敌',
    },
  };

  /* ---------- 波次配置（15 波，第 10 / 15 波为首领）
   * 第 6 波起出现拆塔者，第 8 波起出现诱饵，之后逐渐加量
   */
  const WAVES_1 = [
    [{ type: 'grunt', count: 6, interval: 0.85 }],
    [{ type: 'grunt', count: 12, interval: 0.6 }],
    [{ type: 'runner', count: 10, interval: 0.5 }],
    [{ type: 'grunt', count: 12, interval: 0.55 }, { type: 'splitter', count: 3, interval: 2.2, delay: 4 }],
    [{ type: 'tank', count: 4, interval: 1.3 }, { type: 'runner', count: 10, interval: 0.4, delay: 2 }],
    [
      { type: 'splitter', count: 6, interval: 1.6 },
      { type: 'grunt', count: 12, interval: 0.5, delay: 3 },
      { type: 'saboteur', count: 2, interval: 2.4, delay: 6 },
      { type: 'thrower', count: 1, interval: 1, delay: 7 },
      { type: 'runner', count: 5, interval: 0.6, delay: 8, from: 'side' },
      { type: 'overseer', count: 2, interval: 3.0, delay: 9, from: 'side' },
    ],
    [
      { type: 'shield', count: 4, interval: 1.8 },
      { type: 'runner', count: 12, interval: 0.38, delay: 4, from: 'east' },
      { type: 'saboteur', count: 3, interval: 2.2, delay: 4 },
      { type: 'thrower', count: 1, interval: 1, delay: 6 },
      { type: 'aura', count: 1, interval: 1, delay: 9 },
      { type: 'grunt', count: 5, interval: 0.5, delay: 6, from: 'side' },
      { type: 'splitter', count: 2, interval: 1.8, delay: 9, from: 'side' },
      { type: 'overseer', count: 2, interval: 3.0, delay: 7, from: 'side' },
    ],
    [
      { type: 'healer', count: 2, interval: 2.5 },
      { type: 'tank', count: 4, interval: 1.2, delay: 1 },
      { type: 'grunt', count: 10, interval: 0.5, delay: 6, from: 'east' },
      { type: 'decoy', count: 1, interval: 1, delay: 4 },
      { type: 'thrower', count: 2, interval: 3.5, delay: 6 },
      { type: 'aura', count: 1, interval: 1, delay: 8 },
      { type: 'shield', count: 2, interval: 1.5, delay: 7, from: 'side' },
      { type: 'runner', count: 5, interval: 0.5, delay: 10, from: 'side' },
      { type: 'aura', count: 1, interval: 1, delay: 12, from: 'side' },
      { type: 'overseer', count: 3, interval: 2.8, delay: 8, from: 'side' },
    ],
    [
      { type: 'runner', count: 18, interval: 0.32 },
      { type: 'splitter', count: 5, interval: 1.5, delay: 4 },
      { type: 'saboteur', count: 4, interval: 2.0, delay: 5 },
      { type: 'thrower', count: 2, interval: 3.2, delay: 5 },
      { type: 'aura', count: 2, interval: 3.0, delay: 6 },
      { type: 'grunt', count: 8, interval: 0.45, delay: 5, from: 'side' },
      { type: 'splitter', count: 4, interval: 1.6, delay: 8, from: 'side' },
      { type: 'overseer', count: 3, interval: 2.8, delay: 7, from: 'side' },
    ],
    [
      { type: 'boss', count: 1, interval: 1 },
      { type: 'tank', count: 4, interval: 1.2, delay: 3 },
      { type: 'shield', count: 3, interval: 1.6, delay: 8, from: 'east' },
      { type: 'decoy', count: 1, interval: 1, delay: 8 },
      { type: 'saboteur', count: 3, interval: 2.2, delay: 5 },
      { type: 'thrower', count: 2, interval: 3.2, delay: 7 },
      { type: 'aura', count: 2, interval: 3.0, delay: 6 },
      { type: 'runner', count: 8, interval: 0.45, delay: 8, from: 'side' },
      { type: 'saboteur', count: 2, interval: 2.4, delay: 12, from: 'side' },
      { type: 'overseer', count: 4, interval: 2.6, delay: 10, from: 'side' },
    ],
    [
      { type: 'shield', count: 5, interval: 1.5 },
      { type: 'healer', count: 2, interval: 2.4, delay: 2 },
      { type: 'runner', count: 12, interval: 0.35, delay: 6, from: 'east' },
      { type: 'saboteur', count: 4, interval: 2.0, delay: 4 },
      { type: 'decoy', count: 1, interval: 1, delay: 7 },
      { type: 'thrower', count: 2, interval: 3.0, delay: 6 },
      { type: 'aura', count: 2, interval: 3.0, delay: 5 },
      { type: 'healer', count: 1, interval: 1, delay: 9, from: 'side' },
      { type: 'grunt', count: 10, interval: 0.4, delay: 6, from: 'side' },
      { type: 'shield', count: 2, interval: 2.0, delay: 12, from: 'side' },
      { type: 'thrower', count: 1, interval: 1, delay: 13, from: 'side' },
      { type: 'aura', count: 1, interval: 1, delay: 15, from: 'side' },
      { type: 'overseer', count: 4, interval: 2.6, delay: 8, from: 'side' },
    ],
    [
      { type: 'tank', count: 7, interval: 1.1 },
      { type: 'splitter', count: 7, interval: 1.3, delay: 5, from: 'east' },
      { type: 'saboteur', count: 5, interval: 1.9, delay: 4 },
      { type: 'decoy', count: 1, interval: 1, delay: 8 },
      { type: 'thrower', count: 3, interval: 2.8, delay: 5 },
      { type: 'aura', count: 2, interval: 2.8, delay: 7 },
      { type: 'tank', count: 3, interval: 1.4, delay: 6, from: 'side' },
      { type: 'runner', count: 10, interval: 0.4, delay: 5, from: 'side' },
      { type: 'saboteur', count: 2, interval: 2.2, delay: 11, from: 'side' },
      { type: 'aura', count: 1, interval: 1, delay: 13, from: 'side' },
      { type: 'overseer', count: 5, interval: 2.4, delay: 8, from: 'side' },
    ],
    [
      { type: 'healer', count: 3, interval: 2.0 },
      { type: 'shield', count: 5, interval: 1.3, delay: 5, from: 'east' },
      { type: 'runner', count: 16, interval: 0.3, delay: 5 },
      { type: 'saboteur', count: 5, interval: 1.8, delay: 6 },
      { type: 'decoy', count: 2, interval: 6, delay: 9 },
      { type: 'thrower', count: 3, interval: 2.6, delay: 4 },
      { type: 'aura', count: 3, interval: 2.6, delay: 7 },
      { type: 'splitter', count: 5, interval: 1.5, delay: 6, from: 'side' },
      { type: 'shield', count: 3, interval: 1.8, delay: 9, from: 'side' },
      { type: 'healer', count: 2, interval: 2.6, delay: 12, from: 'side' },
      { type: 'thrower', count: 1, interval: 1, delay: 14, from: 'side' },
      { type: 'aura', count: 1, interval: 1, delay: 16, from: 'side' },
      { type: 'overseer', count: 5, interval: 2.4, delay: 7, from: 'side' },
    ],
    [
      { type: 'tank', count: 7, interval: 1.0 },
      { type: 'runner', count: 18, interval: 0.3, delay: 4, from: 'east' },
      { type: 'splitter', count: 7, interval: 1.2, delay: 4 },
      { type: 'saboteur', count: 6, interval: 1.8, delay: 6 },
      { type: 'decoy', count: 2, interval: 6, delay: 10 },
      { type: 'thrower', count: 3, interval: 2.4, delay: 5 },
      { type: 'aura', count: 3, interval: 2.4, delay: 7 },
      { type: 'tank', count: 4, interval: 1.3, delay: 5, from: 'side' },
      { type: 'decoy', count: 1, interval: 1, delay: 13, from: 'side' },
      { type: 'saboteur', count: 3, interval: 2.0, delay: 8, from: 'side' },
      { type: 'thrower', count: 1, interval: 3.0, delay: 10, from: 'side' },
      { type: 'aura', count: 1, interval: 1, delay: 15, from: 'side' },
      { type: 'overseer', count: 6, interval: 2.2, delay: 6, from: 'side' },
    ],
    [
      { type: 'boss', count: 1, interval: 1 },
      { type: 'tank', count: 6, interval: 1.1, delay: 4 },
      { type: 'shield', count: 4, interval: 1.4, delay: 9, from: 'east' },
      { type: 'runner', count: 14, interval: 0.3, delay: 10 },
      { type: 'saboteur', count: 6, interval: 1.7, delay: 6 },
      { type: 'decoy', count: 3, interval: 5.5, delay: 12 },
      { type: 'thrower', count: 3, interval: 2.4, delay: 5 },
      { type: 'aura', count: 3, interval: 2.2, delay: 7 },
      { type: 'boss', count: 1, interval: 1, delay: 6, from: 'side' },
      { type: 'healer', count: 2, interval: 2.4, delay: 10, from: 'side' },
      { type: 'shield', count: 4, interval: 1.5, delay: 13, from: 'side' },
      { type: 'runner', count: 12, interval: 0.35, delay: 16, from: 'side' },
      { type: 'thrower', count: 1, interval: 2.8, delay: 9, from: 'side' },
      { type: 'aura', count: 2, interval: 2.6, delay: 18, from: 'side' },
      { type: 'overseer', count: 7, interval: 2.0, delay: 8, from: 'side' },
    ],
  ];

  /* ---------- 第二关波次（15 波，两路统一出怪）----------
   * 这里**不写 from 字段**：每条波的所有怪会被「对半轮流」分到两条路上，
   * 保证两条路的压力始终一致（第一关那种「侧路单独出一批」的写法不再使用）。 */
  const WAVES_2 = [
    [{ type: 'grunt', count: 6, interval: 0.85 }],
    [{ type: 'grunt', count: 12, interval: 0.6 }],
    [{ type: 'runner', count: 10, interval: 0.5 }, { type: 'grunt', count: 6, interval: 0.6, delay: 2 }],
    [{ type: 'grunt', count: 12, interval: 0.55 }, { type: 'splitter', count: 4, interval: 2.0, delay: 4 }],
    [{ type: 'tank', count: 4, interval: 1.3 }, { type: 'runner', count: 12, interval: 0.4, delay: 2 }],
    [
      { type: 'shield', count: 4, interval: 1.8 },
      { type: 'runner', count: 12, interval: 0.38, delay: 2 },
      { type: 'saboteur', count: 2, interval: 2.4, delay: 6 },
    ],
    [
      { type: 'splitter', count: 6, interval: 1.6 },
      { type: 'grunt', count: 12, interval: 0.5, delay: 3 },
      { type: 'thrower', count: 1, interval: 1, delay: 7 },
      { type: 'aura', count: 1, interval: 1, delay: 9 },
    ],
    [
      { type: 'healer', count: 2, interval: 2.5 },
      { type: 'tank', count: 4, interval: 1.2, delay: 1 },
      { type: 'grunt', count: 12, interval: 0.5, delay: 5 },
      { type: 'saboteur', count: 3, interval: 2.2, delay: 4 },
      { type: 'thrower', count: 1, interval: 1, delay: 6 },
    ],
    [
      { type: 'runner', count: 18, interval: 0.32 },
      { type: 'splitter', count: 6, interval: 1.5, delay: 4 },
      { type: 'aura', count: 2, interval: 3.0, delay: 6 },
      { type: 'overseer', count: 3, interval: 2.8, delay: 7 },
    ],
    [
      { type: 'boss', count: 1, interval: 1 },
      { type: 'tank', count: 4, interval: 1.2, delay: 3 },
      { type: 'shield', count: 4, interval: 1.6, delay: 6 },
      { type: 'saboteur', count: 3, interval: 2.2, delay: 5 },
      { type: 'thrower', count: 2, interval: 3.2, delay: 7 },
      { type: 'decoy', count: 1, interval: 1, delay: 8 },
    ],
    [
      { type: 'shield', count: 5, interval: 1.5 },
      { type: 'healer', count: 2, interval: 2.4, delay: 2 },
      { type: 'runner', count: 14, interval: 0.35, delay: 5 },
      { type: 'saboteur', count: 4, interval: 2.0, delay: 4 },
      { type: 'aura', count: 2, interval: 3.0, delay: 5 },
    ],
    [
      { type: 'tank', count: 7, interval: 1.1 },
      { type: 'splitter', count: 7, interval: 1.3, delay: 3 },
      { type: 'thrower', count: 3, interval: 2.8, delay: 5 },
      { type: 'decoy', count: 1, interval: 1, delay: 8 },
      { type: 'overseer', count: 4, interval: 2.6, delay: 8 },
    ],
    [
      { type: 'healer', count: 3, interval: 2.0 },
      { type: 'shield', count: 5, interval: 1.3, delay: 2 },
      { type: 'runner', count: 16, interval: 0.3, delay: 5 },
      { type: 'saboteur', count: 5, interval: 1.8, delay: 6 },
      { type: 'aura', count: 2, interval: 2.6, delay: 7 },
    ],
    [
      { type: 'tank', count: 7, interval: 1.0 },
      { type: 'runner', count: 18, interval: 0.3, delay: 2 },
      { type: 'splitter', count: 7, interval: 1.2, delay: 4 },
      { type: 'thrower', count: 3, interval: 2.4, delay: 5 },
      { type: 'decoy', count: 2, interval: 6, delay: 10 },
      { type: 'overseer', count: 5, interval: 2.4, delay: 6 },
    ],
    [
      { type: 'boss', count: 2, interval: 6 },
      { type: 'tank', count: 6, interval: 1.1, delay: 4 },
      { type: 'shield', count: 5, interval: 1.4, delay: 8 },
      { type: 'saboteur', count: 6, interval: 1.7, delay: 6 },
      { type: 'decoy', count: 2, interval: 5.5, delay: 12 },
      { type: 'thrower', count: 3, interval: 2.4, delay: 5 },
      { type: 'aura', count: 3, interval: 2.2, delay: 7 },
      { type: 'overseer', count: 6, interval: 2.0, delay: 8 },
    ],
  ];

  /* ---------- 第三关的 15 波 ----------
   * 主角是新怪「蹦极」：它不走小路、全程无敌，只在屏幕外随机挑一座塔贴靶子，
   * 5 秒后俯冲下来把塔偷走 —— 所以这一关的压力来自「塔在持续变少」，
   * 而不是「怪一波比一波肉」。开场只有一把保护伞，罩在哪儿就是本关的核心决策。
   * 带 `from: 'side'` 的组走西侧绿道，逼你把塔往两边搬。 */
  const WAVES_3 = [
    [{ type: 'grunt', count: 10, interval: 0.75 }],
    [{ type: 'grunt', count: 14, interval: 0.6 }, { type: 'runner', count: 6, interval: 0.5, delay: 4 }],
    [{ type: 'runner', count: 10, interval: 0.45 }, { type: 'bungee', count: 1, interval: 1, delay: 3 }],
    [
      { type: 'grunt', count: 14, interval: 0.5 },
      { type: 'bungee', count: 1, interval: 1, delay: 5 },
      { type: 'runner', count: 8, interval: 0.45, delay: 6, from: 'side' },
    ],
    [
      { type: 'tank', count: 4, interval: 1.4 },
      { type: 'bungee', count: 2, interval: 2.5, delay: 4 },
      { type: 'grunt', count: 10, interval: 0.6, delay: 3, from: 'side' },
    ],
    [
      { type: 'splitter', count: 6, interval: 1.6 },
      { type: 'bungee', count: 2, interval: 2.4, delay: 5 },
      { type: 'saboteur', count: 2, interval: 2.4, delay: 7 },
      { type: 'runner', count: 10, interval: 0.4, delay: 6, from: 'side' },
    ],
    [
      { type: 'shield', count: 5, interval: 1.8 },
      { type: 'bungee', count: 2, interval: 2.2, delay: 4 },
      { type: 'thrower', count: 2, interval: 2.0, delay: 6 },
      { type: 'grunt', count: 12, interval: 0.5, delay: 5, from: 'side' },
    ],
    [
      { type: 'healer', count: 2, interval: 2.5 },
      { type: 'tank', count: 5, interval: 1.2, delay: 2 },
      { type: 'bungee', count: 2, interval: 2.2, delay: 6 },
      { type: 'splitter', count: 4, interval: 1.6, delay: 7, from: 'side' },
    ],
    [
      { type: 'runner', count: 18, interval: 0.32 },
      { type: 'aura', count: 1, interval: 1, delay: 5 },
      { type: 'bungee', count: 2, interval: 2.0, delay: 6 },
      { type: 'overseer', count: 2, interval: 3.0, delay: 7, from: 'side' },
    ],
    [
      { type: 'boss', count: 1, interval: 1 },
      { type: 'tank', count: 4, interval: 1.2, delay: 4 },
      { type: 'bungee', count: 2, interval: 2.4, delay: 8 },
      { type: 'saboteur', count: 3, interval: 2.2, delay: 6 },
      { type: 'runner', count: 12, interval: 0.4, delay: 9, from: 'side' },
    ],
    [
      { type: 'shield', count: 6, interval: 1.5 },
      { type: 'healer', count: 2, interval: 2.4, delay: 2 },
      { type: 'bungee', count: 3, interval: 2.0, delay: 5 },
      { type: 'grunt', count: 14, interval: 0.5, delay: 4, from: 'side' },
    ],
    [
      { type: 'tank', count: 7, interval: 1.1 },
      { type: 'splitter', count: 7, interval: 1.3, delay: 3 },
      { type: 'bungee', count: 3, interval: 2.0, delay: 6 },
      { type: 'decoy', count: 1, interval: 1, delay: 9 },
    ],
    [
      { type: 'thrower', count: 2, interval: 3.0 },
      { type: 'aura', count: 2, interval: 3.0, delay: 2 },
      { type: 'bungee', count: 3, interval: 1.8, delay: 6 },
      { type: 'runner', count: 16, interval: 0.3, delay: 5, from: 'side' },
    ],
    [
      { type: 'shield', count: 6, interval: 1.3 },
      { type: 'healer', count: 3, interval: 2.0, delay: 2 },
      { type: 'bungee', count: 3, interval: 1.8, delay: 5 },
      { type: 'saboteur', count: 5, interval: 1.8, delay: 6 },
      { type: 'splitter', count: 7, interval: 1.4, delay: 6, from: 'side' },
    ],
    [
      { type: 'boss', count: 2, interval: 6 },
      { type: 'tank', count: 6, interval: 1.1, delay: 4 },
      { type: 'bungee', count: 3, interval: 2.0, delay: 7 },
      { type: 'decoy', count: 2, interval: 6, delay: 11 },
      { type: 'thrower', count: 2, interval: 3.2, delay: 5 },
      { type: 'runner', count: 18, interval: 0.3, delay: 9, from: 'side' },
    ],
    /* ---- 16~20 波：第三关独有的「加时赛」 ---- */
    [
      { type: 'tank', count: 8, interval: 1.0 },
      { type: 'healer', count: 3, interval: 2.2, delay: 2 },
      { type: 'bungee', count: 3, interval: 1.9, delay: 5 },
      { type: 'shield', count: 6, interval: 1.4, delay: 4 },
      { type: 'splitter', count: 8, interval: 1.3, delay: 7, from: 'side' },
    ],
    [
      { type: 'runner', count: 20, interval: 0.28 },
      { type: 'aura', count: 2, interval: 3.0, delay: 3 },
      { type: 'bungee', count: 4, interval: 1.8, delay: 6 },
      { type: 'overseer', count: 3, interval: 2.6, delay: 8 },
      { type: 'saboteur', count: 4, interval: 2.0, delay: 5, from: 'side' },
    ],
    [
      { type: 'shield', count: 7, interval: 1.2 },
      { type: 'healer', count: 4, interval: 1.9, delay: 2 },
      { type: 'tank', count: 8, interval: 1.0, delay: 3 },
      { type: 'bungee', count: 4, interval: 1.7, delay: 5 },
      { type: 'thrower', count: 3, interval: 2.8, delay: 6, from: 'side' },
    ],
    [
      { type: 'splitter', count: 9, interval: 1.2 },
      { type: 'decoy', count: 2, interval: 5.0, delay: 6 },
      { type: 'aura', count: 3, interval: 2.8, delay: 2 },
      { type: 'bungee', count: 4, interval: 1.6, delay: 7 },
      { type: 'grunt', count: 18, interval: 0.4, delay: 8, from: 'side' },
    ],
    [
      { type: 'boss', count: 3, interval: 7 },
      { type: 'tank', count: 8, interval: 1.0, delay: 5 },
      { type: 'bungee', count: 4, interval: 1.7, delay: 8 },
      { type: 'decoy', count: 3, interval: 5.0, delay: 12 },
      { type: 'thrower', count: 3, interval: 2.8, delay: 6 },
      { type: 'healer', count: 3, interval: 2.2, delay: 10 },
      { type: 'runner', count: 20, interval: 0.3, delay: 10, from: 'side' },
    ],
  ];

  /* ============================================================
   * 2. 音效（WebAudio 合成，极轻量）
   * ============================================================ */
  const SFX = (function () {
    let actx = null, on = true, last = 0;
    function ctxAudio() {
      if (!actx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (AC) actx = new AC();
      }
      if (actx && actx.state === 'suspended') actx.resume();
      return actx;
    }
    function blip(freq, dur, type, vol) {
      if (!on) return;
      const now = performance.now();
      if (now - last < 45) return;      // 防止塔多时噪音堆积
      last = now;
      const a = ctxAudio();
      if (!a) return;
      const o = a.createOscillator(), g = a.createGain();
      o.type = type;
      o.frequency.value = freq;
      o.connect(g); g.connect(a.destination);
      const t = a.currentTime;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(vol, t + 0.008);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.start(t); o.stop(t + dur + 0.03);
    }
    /* ---------- 射箭：换成真实录音，不再是合成音 ----------
     * 素材：音效/arrow-whizz.wav（来源与许可见 音效/来源与许可.txt）
     * 用 <audio> 而不是 fetch + decodeAudioData：双击 index.html 时页面跑在 file:// 下，
     * 那里 XHR / fetch 会被浏览器拦掉，而 <audio> 加载同目录的音频文件是允许的。
     * 预建 3 个轮着放：射速快、又开了 x2 变速时不会互相打断。 */
    const ARROW_SRC = '音效/arrow-whizz.wav';
    const ARROW_VOL = 0.5;                        // 音量（0~1），嫌吵或听不清就改这里
    let arrowPool = null, arrowAt = 0;
    function arrow() {
      if (!on) return;                            // 跟着右侧面板的「音效」开关走
      if (typeof Audio === 'undefined') return;   // 无头测试的 DOM 桩里没有 Audio
      if (!arrowPool) {
        arrowPool = [];
        for (let i = 0; i < 3; i++) {
          const a = new Audio(ARROW_SRC);
          a.preload = 'auto';
          a.volume = ARROW_VOL;
          arrowPool.push(a);
        }
      }
      arrowAt = (arrowAt + 1) % arrowPool.length;
      const a = arrowPool[arrowAt];
      try {
        a.currentTime = 0;
        const p = a.play();
        if (p && p.catch) p.catch(function () {});
      } catch (e) { /* 播放被拦（例如还没交互过）就算了，不影响游戏 */ }
    }
    /* ---------- 背景音乐 ----------
     * 素材：音效/bgm.wav（CC0，来源与许可见 音效/来源与许可.txt）
     * 浏览器不允许「用户交互之前」自动放声音，所以由封面上那个「开始游戏」按钮起播；
     * 之后进入关卡、暂停、重新开始都不打断它（它是循环的底噪，不是关卡音效）。 */
    const BGM_SRC = '音效/bgm.wav';
    const BGM_VOL = 0.22;                         // 背景音乐音量（0~1），嫌吵就调小
    let bgm = null, bgmWanted = false;
    function bgmEl() {
      if (bgm) return bgm;
      if (typeof Audio === 'undefined') return null;   // 无头测试的 DOM 桩里没有 Audio
      bgm = new Audio(BGM_SRC);
      bgm.loop = true;
      bgm.preload = 'auto';
      bgm.volume = BGM_VOL;
      return bgm;
    }
    function musicStart() {
      bgmWanted = true;
      if (!on) return;                            // 静音状态下只记住「想放」，不真放
      const a = bgmEl();
      if (!a) return;
      try {
        const p = a.play();
        if (p && p.catch) p.catch(function () {});
      } catch (e) { /* 播放被拦就算了 */ }
    }
    function musicStop() {
      bgmWanted = false;
      if (bgm) { try { bgm.pause(); } catch (e) {} }
    }
    /** 音效开关切换后同步一次：关了就把音乐停住，开着且本该在放就接着放 */
    function musicSync() {
      if (!on) { if (bgm && !bgm.paused) { try { bgm.pause(); } catch (e) {} } return; }
      if (bgmWanted) musicStart();
    }
    return {
      toggle: function () { on = !on; musicSync(); return on; },
      isOn: function () { return on; },
      arrow: arrow,
      musicStart: musicStart,
      musicStop: musicStop,
      musicSync: musicSync,
      shoot: function () { blip(700, 0.05, 'square', 0.018); },
      boom: function () { blip(140, 0.16, 'sawtooth', 0.05); },
      ice: function () { blip(1150, 0.07, 'sine', 0.028); },
      build: function () { blip(430, 0.09, 'triangle', 0.06); setTimeout(function () { blip(660, 0.11, 'triangle', 0.05); }, 80); },
      kill: function () { blip(230, 0.07, 'triangle', 0.03); },
      hurt: function () { blip(110, 0.32, 'sawtooth', 0.07); },
      win: function () { [523, 659, 784, 1046].forEach(function (f, i) { setTimeout(function () { blip(f, 0.18, 'triangle', 0.07); }, i * 130); }); },
      lose: function () { [400, 320, 240, 160].forEach(function (f, i) { setTimeout(function () { blip(f, 0.3, 'sawtooth', 0.07); }, i * 170); }); },
    };
  })();

  /* ============================================================
   * 3. 画布与状态
   * ============================================================ */
  const cv = document.getElementById('game');
  let ctx = cv.getContext('2d');
  /* 设备像素比封顶 1.5：画布放大到 1056×660 后，DPR=2 意味着每帧要写 279 万像素，
   * 在核显笔记本上会直接掉帧甚至卡住 */
  const DPR = Math.min(1.5, window.devicePixelRatio || 1);
  cv.width = W * DPR;
  cv.height = H * DPR;
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);

  /* ---------- 静态图层缓存 ----------
   * 地面 / 三条路 / 装饰这些东西一整局几乎不变，没必要每帧重画。
   * 先画到离屏画布，之后每帧只做一次 drawImage。 */
  const bgCv = document.createElement('canvas');
  bgCv.width = W * DPR;
  bgCv.height = H * DPR;
  const bgCtx = bgCv.getContext('2d');
  let bgDirty = true;

  /* ---------- 主角贴图 ----------
   * 立绘由一张黑底原图用 tools/make-hero-sprite.py 抠底 + 裁成「底部中点＝双脚」的贴图
   * （原图已清理，脚本仍保留生成规则）：主角/hero-deepseek.png
   * 游戏里只按「底部中点」定位，所以转身 / 压缩 / 旋转全都绕双脚，
   * 和旧矢量小人的脚（y+9 附近）对齐。
   * 贴图没加载上（文件被删 / 被策略拦）就自动退回原来的矢量小人，游戏照常能玩。 */
  const HERO_SPRITE = {
    src: '主角/hero-deepseek.png',
    h: 46,            // 游戏里画多高（逻辑像素，一格 TILE=44）
    feetY: 11,        // 双脚在贴图底部，往下沉一点，正好踩在影子（y+13）上
    img: null,
    ok: false,
    white: null,      // 纯白剪影：冲刺残影 / 升级闪光
    red: null,        // 纯红剪影：受击闪红
  };

  /** 用离屏画布把贴图压成单色剪影（source-in 只保留贴图的不透明区域） */
  function heroSilhouette(img, color) {
    const c = document.createElement('canvas');
    c.width = img.width; c.height = img.height;
    const g = c.getContext('2d');
    if (!g) return null;
    g.drawImage(img, 0, 0);
    g.globalCompositeOperation = 'source-in';
    g.fillStyle = color;
    g.fillRect(0, 0, c.width, c.height);
    return c;
  }

  function loadHeroSprite() {
    /* 无头环境（tools/hook-check.js 的 DOM 桩）里没有 Image，直接留在矢量小人模式 */
    if (typeof Image === 'undefined') return;
    const img = new Image();
    img.onload = function () {
      HERO_SPRITE.white = heroSilhouette(img, '#ffffff');
      HERO_SPRITE.red = heroSilhouette(img, '#ff6b6b');
      HERO_SPRITE.img = img;
      HERO_SPRITE.ok = true;
      state.hero.spawn = 1;            // 贴图是异步来的，到了补一次「出场」动画
    };
    img.onerror = function () {
      HERO_SPRITE.ok = false;
      console.warn('[绿野防线] 主角贴图没加载上（' + HERO_SPRITE.src + '），继续用矢量小人。');
    };
    img.src = HERO_SPRITE.src;
  }

  /* 首领贴图：主角/豆包.jpg 抠底后的一张「站着的人」立绘（tools/make-boss-sprite.py）。
   * 同样按「底部中点＝双脚」定位；没加载上就退回原来的红色圆球 + 王冠。 */
  const BOSS_SPRITE = {
    src: '主角/boss-doubao.png',
    h: 68,            // 比主角（46）高一头，一眼看得出是首领
    feetY: 15,        // 踩在首领自己的影子上（y + r*0.85 ≈ y+16）
    img: null,
    ok: false,
  };

  function loadBossSprite() {
    if (typeof Image === 'undefined') return;       // 无头测试环境没有 Image
    const img = new Image();
    img.onload = function () {
      BOSS_SPRITE.img = img;
      BOSS_SPRITE.ok = true;
    };
    img.onerror = function () {
      BOSS_SPRITE.ok = false;
      console.warn('[绿野防线] 首领贴图没加载上（' + BOSS_SPRITE.src + '），继续用红色首领球。');
    };
    img.src = BOSS_SPRITE.src;
  }

  /* 小怪贴图：一张白底立绘抠底后的成品（生成规则在 tools/make-enemy-sprite.py，原图已清理）。
   * **所有小怪共用这一张**，靠各自的 ENEMIES[type].color 实时染色区分（见 mobSpriteFor）；
   * 首领不吃这张（它有自己那张豆包立绘）。没加载上就退回原来的彩色圆球。 */
  const ENEMY_SPRITE = {
    src: '主角/enemy-gpt.png',
    scale: 2.9,       // 显示高度 = 敌人半径 × 2.9（小兵 ≈32px，诱饵 ≈46px）
    tints: {},        // type -> 已染色的 canvas（每种只染一次，懒加载）
    img: null,
    ok: false,
  };

  function loadEnemySprite() {
    if (typeof Image === 'undefined') return;       // 无头测试环境没有 Image
    const img = new Image();
    img.onload = function () {
      ENEMY_SPRITE.img = img;
      ENEMY_SPRITE.ok = true;
    };
    img.onerror = function () {
      ENEMY_SPRITE.ok = false;
      console.warn('[绿野防线] 小怪贴图没加载上（' + ENEMY_SPRITE.src + '），继续用彩色圆球。');
    };
    img.src = ENEMY_SPRITE.src;
  }

  /* 第三关的三张素材（tools/make-l3-sprites.py 从 主角/ 里的原图抠出来的）：
   *   蹦极僵尸：吊着绳子落下来偷塔的怪，底部中点＝脚
   *   靶子：蹦极扔在塔上的标记，底部中点＝图心
   *   保护伞：能搬来搬去的固定设施，底部中点＝叶柄
   * 三张都是可选装饰：没加载上就退回矢量画法，游戏照常能玩。 */
  const BUNGEE_SPRITE = { src: '主角/sprite-bungee.png', h: 58, feetY: 9, img: null, ok: false };
  const TARGET_SPRITE = { src: '主角/sprite-target.png', h: 46, img: null, ok: false };
  const UMBRELLA_SPRITE = { src: '主角/sprite-umbrella.png', h: 44, img: null, ok: false };

  function loadL3Sprites() {
    if (typeof Image === 'undefined') return;       // 无头测试环境没有 Image
    const jobs = [
      [BUNGEE_SPRITE, '蹦极'],
      [TARGET_SPRITE, '靶子'],
      [UMBRELLA_SPRITE, '保护伞'],
    ];
    for (let i = 0; i < jobs.length; i++) {
      (function (slot, cn) {
        const img = new Image();
        img.onload = function () {
          slot.img = img;
          slot.ok = true;
        };
        img.onerror = function () {
          slot.ok = false;
          console.warn('[绿野防线] ' + cn + '贴图没加载上（' + slot.src + '），继续用矢量画法。');
        };
        img.src = slot.src;
      })(jobs[i][0], jobs[i][1]);
    }
  }

  /* 染色：`source-atop` 只在「已经有像素」的地方刷一层半透明色，底下的明暗
   * （白发、裙褶、翅膀阴影）全都保留 —— 于是十二种怪色相各不相同，但都还是同一只角色。
   * 结果按种类缓存在 ENEMY_SPRITE.tints 里，每种只做一次。 */
  function mobSpriteFor(type) {
    const cached = ENEMY_SPRITE.tints[type];
    if (cached) return cached;
    if (cached === false) return null;              // 这个环境造不出画布，别再试了
    const def = ENEMIES[type];
    const img = ENEMY_SPRITE.img;
    if (!ENEMY_SPRITE.ok || !img || !def || !def.color) return null;   // 还没加载好：不写缓存，下次再试
    let out = null;
    if (typeof document !== 'undefined' && document.createElement) {
      const cv = document.createElement('canvas');
      cv.width = img.width;
      cv.height = img.height;
      const g = cv.getContext && cv.getContext('2d');
      if (g) {
        g.drawImage(img, 0, 0);
        g.globalCompositeOperation = 'source-atop';
        g.globalAlpha = 0.45;          // 浅上色：一层淡淡的色，够分清种类就行
        g.fillStyle = def.color;
        g.fillRect(0, 0, cv.width, cv.height);
        g.globalAlpha = 1;
        g.globalCompositeOperation = 'source-over';
        out = cv;
      }
    }
    ENEMY_SPRITE.tints[type] = out || false;
    return out;
  }

  const state = {
    started: false,       // 是否已经点过「开始游戏」（false 时停在开始页面，游戏不推进）
    everStarted: false,   // 是否玩过（决定开始页按钮文案）
    hintT: 0,             // 新手提示计时
    phase: 'prep',        // prep | battle | won | lost
    money: START_MONEY,
    lives: START_LIVES,
    waveIndex: 0,
    countdown: PREP_TIME,
    speed: 1,
    paused: false,
    battleTime: 0,
    kills: 0,
    flash: 0,

    towers: [], enemies: [], shots: [], bits: [], texts: [], spawnQueue: [], pending: [],
    rocks: [],             // 投石者扔出的落石
    swords: [],            // 屠戮者掷出的血剑（蓄力 → 直刺）
    throws: [],            // 蹦极扔在塔上的靶子（倒计时到了就落地）
    hookDrop: null,        // 第一关最后一只怪掉的钩爪 { x, y, spin }
    lastKill: null,        // 最后一只被击杀的怪的位置（决定钩爪掉在哪）
    hookTaken: 0,          // 捡到钩爪后倒计时切到第二关
    waveTotal: 0,
    selectedTower: null,
    marked: null,          // 被 Z 标记的空地 {c, r}
    buildOpen: false,      // 建造弹窗是否打开
    levelOpen: false,      // 升级三选一弹窗是否打开
    levelChoices: [],
    laneOpen: { side: false, east: false },   // 各支路是否已开通
    laneFlash: { side: 0, east: 0 },          // 支路开通的高亮计时
    keys: {},
    mouse: { x: W / 2, y: H / 2, down: false },
    auraTick: 0,           // 杀戮光环的持续伤害节拍
    heroInAura: false,     // 主角当前是否站在杀戮光环里
    rockCd: 0,             // 落石全局节流
    bombs: 1,              // 剩余炸弹数（一次性工具）
    bombCd: 0,             // 炸弹冷却剩余秒数
    /* ---- 关卡与钩索 ---- */
    level: 1,              // 当前关卡 id
    levelIdx: 0,           // 关卡在 LEVEL_SETUP 里的下标
    hookOn: false,         // 本关是否装备钩索
    benchCell: null,       // 本关升级台的交付点（null = 本关没有升级台）
    hpScale: 1,            // 本关敌人血量倍率
    hpPerWave: HP_PER_WAVE, // 本关每波血量成长（第三关用更缓的斜率）
    hookUnlocked: false,   // 钩索是否已解锁（通关第一关后掉落）
    lv3Unlocked: false,    // 第三关是否已解锁（通关第二关后）
    carry: null,           // 钩索挑在手上的防御塔
    dashT: 0,              // 冲刺剩余时间（按「距离 ÷ 速度」算好，不会提前结束）
    dashCd: 0,             // 冲刺冷却
    dashTo: null,          // 冲刺目标点
    /* ---- 新敌人说明（每种怪整个游戏只弹一次，跨关卡也不重复）---- */
    enemyPopup: null,      // 正在展示的卡片 { type, t }
    enemyQueue: [],        // 排队等待展示的敌人类型
    seenEnemies: {},       // 本次打开页面已经报到过的敌人类型（只有刷新页面才重置）
    /** 主角：代替鼠标去选中、建造、升级、拆除，并能远程攻击
     *  被怪撞到会掉血并把怪弹回去；主角阵亡同样算失败
     *  击杀敌人获得经验，升级会自动成长（生命上限固定 60，只有强化能加），每次升级三选一强化 */
    hero: {
      x: TILE * 7, y: TILE * 8, r: 13, speed: 245,
      dir: -Math.PI / 2, aim: -Math.PI / 2, step: 0, moving: false,
      cd: 0, rate: 0.35, damage: HERO_DAMAGE, range: 320, shotSpeed: 660, recoil: 0, flash: 0,
      hp: 60, hpMax: 60, hurtT: 99, invuln: 0, reach: 112, regen: 8,
      level: 1, xp: 0, xpNeed: 40, pending: 0, perks: [],
      knockMul: 1, pierceCount: 0, spread: 0,
      /* ---- 贴图动画状态（没有贴图时这些值不会被用到，见 drawHeroSprite）---- */
      look: -Math.PI / 2,   // 贴图的视线方向：一直盯着鼠标（h.aim 只管射箭，别搞混）
      face: 1,          // 朝向：1 面向右 / -1 面向左，转身时在中间平滑过渡（会短暂压扁）
      lean: 0,          // 身体前倾角（朝鼠标 / 冲刺方向平滑跟随）
      pop: 0,           // 升级「弹一下」计时（1 → 0）
      spawn: 0,         // 出场缩放计时（1 → 0）
      dashFx: 0,        // 钩索冲刺的拉伸强度（0 → 1 平滑）
      ghost: [],        // 冲刺残影 [{ x, y, a, face }]，a 是剩余透明度
      ghostT: 0,        // 残影节流
      deathAt: 0,       // 阵亡动画的起始时刻（performance.now()，0 = 还活着）
    },
    nextId: 1,
    selKey: '',
  };

  /* ---------- 存档：记住「钩索是否已解锁」 ---------- */
  const SAVE_KEY = 'lvdefense_save_v1';
  const save = (function () {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      return raw ? (JSON.parse(raw) || {}) : {};
    } catch (e) { return {}; }
  })();
  function writeSave(o) {
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(o)); } catch (e) { /* file:// 下可能被禁 */ }
  }
  state.hookUnlocked = !!save.hook;
  state.lv3Unlocked = !!save.lv3;

  /* 静态装饰（树丛 / 石头）——种子固定，每次进同一张图布局一致；
   * 真正的内容由 activateLevel 按当前关卡生成 */
  let seed = 20240607;
  function rnd() { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; }

  function towerAt(c, r) {
    for (let i = 0; i < state.towers.length; i++) {
      const t = state.towers[i];
      if (t.carried) continue;              // 被钩索端在手上的塔不占格子
      if (t.c === c && t.r === r) return t;
    }
    return null;
  }
  function statsOf(t) { return TOWERS[t.type].levels[t.level]; }
  function canBuild(c, r) {
    return c >= 0 && c < COLS && r >= 0 && r < ROWS && !isPath(c, r) && !isWater(c, r) && !towerAt(c, r);
  }
  function isWater(c, r) { return WATER.has(r * COLS + c); }
  /** 某个坐标是不是踩在水里（桥面＝路面，不算水） */
  function waterAt(x, y) {
    if (!WATER.size) return false;
    const c = Math.floor(x / TILE), r = Math.floor(y / TILE);
    if (c < 0 || c >= COLS || r < 0 || r >= ROWS) return false;
    return isWater(c, r);
  }
  /** 把落在水里的点推到最近的岸上（钩索飞过河时用） */
  function pushToShore(x, y) {
    if (!waterAt(x, y)) return { x: x, y: y };
    for (let rad = 1; rad <= 4; rad++) {
      for (let dc = -rad; dc <= rad; dc++) {
        for (let dr = -rad; dr <= rad; dr++) {
          if (Math.max(Math.abs(dc), Math.abs(dr)) !== rad) continue;
          const c = Math.floor(x / TILE) + dc, r = Math.floor(y / TILE) + dr;
          if (c < 0 || c >= COLS || r < 0 || r >= ROWS) continue;
          if (isWater(c, r)) continue;
          return { x: c * TILE + TILE / 2, y: r * TILE + TILE / 2 };
        }
      }
    }
    return { x: x, y: y };
  }

  /* ---------- 保护伞（只有第三关有）----------
   * 一座无敌的固定设施，用钩索搬来搬去。它自己不打人，只在**蹦极落地那一刻**做判定：
   * 要偷的那座塔如果落在伞的覆盖半径内，蹦极当场被弹没（塔保住，靶子消失）。
   * 它对靶子本身没有任何影响 —— 靶子只是「预告落点」。 */
  const UMBRELLA_R = 96;                       // 覆盖半径

  /** 某个坐标是否在一把保护伞的覆盖范围内（返回那一把，没有就返回 null） */
  function umbrellaCovers(x, y) {
    for (let i = 0; i < state.towers.length; i++) {
      const t = state.towers[i];
      if (t.dead || t.carried) continue;
      if (!TOWERS[t.type].isUmbrella) continue;
      if (dist2(t.x, t.y, x, y) <= UMBRELLA_R * UMBRELLA_R) return t;
    }
    return null;
  }

  /** 保护伞的落点比塔宽松：空地、路面都行，只要不是水面、不和别的建筑重叠 */
  function canPlaceUmbrella(c, r) {
    return c >= 0 && c < COLS && r >= 0 && r < ROWS && !isWater(c, r) && !towerAt(c, r);
  }

  function makeUmbrella(c, r) {
    const t = {
      id: state.nextId++, type: 'umbrella', c: c, r: r, level: 0,
      x: c * TILE + TILE / 2, y: r * TILE + TILE / 2,
      cd: 0, angle: -Math.PI / 2, recoil: 0, spent: 0, kills: 0,
      hp: 1, hpMax: 1, hurtT: 99, shake: 0, dead: false,
      silence: 0, silenceFlash: 0, pop: 0,
    };
    state.towers.push(t);
    bgDirty = true;
    ring(t.x, t.y, 34, '#22c55e', 0.45);
    return t;
  }

  /* ============================================================
   * 4. 特效小工具
   * ============================================================ */
  function burst(x, y, n, color, spread, size) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, sp = (0.3 + Math.random() * 0.7) * spread;
      state.bits.push({
        kind: 'dot', x: x, y: y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
        life: 0.4 + Math.random() * 0.4, max: 0.8, color: color, r: size || (1.5 + Math.random() * 2),
      });
    }
  }
  function ring(x, y, max, color, dur) {
    state.bits.push({ kind: 'ring', x: x, y: y, r: max * 0.25, max: max, color: color, life: dur, maxLife: dur });
  }
  function floatText(x, y, text, color) {
    state.texts.push({ x: x, y: y, text: text, color: color, life: 0.9, max: 0.9 });
  }

  function toast(msg, kind) {
    const box = document.getElementById('toasts');
    const d = document.createElement('div');
    d.className = 'toast' + (kind ? ' ' + kind : '');
    d.textContent = msg;
    box.appendChild(d);
    setTimeout(function () { if (d.parentNode) d.parentNode.removeChild(d); }, 2400);
    if (box.childNodes.length > 4) box.removeChild(box.firstChild);
  }

  /* ============================================================
   * 5.4 新敌人说明弹窗
   *   · 某种怪**一局里第一次出场**时，在画布下方弹一张小卡片说清它的特性；
   *   · 不暂停游戏（和升级三选一一样只是浮层），点一下或 6 秒后自动收掉；
   *   · 同时只显示一张，一次来好几种新技术就排队依次弹。
   * ============================================================ */
  const ENEMY_POPUP_TIME = 6;      // 一张卡片停留多久（秒）

  function announceEnemy(type) {
    if (!ENEMIES[type] || state.seenEnemies[type]) return;
    state.seenEnemies[type] = true;
    state.enemyQueue.push(type);
    pumpEnemyPopup();
  }

  /** 队列里有待展示的、且当前没有卡片时，弹下一张 */
  function pumpEnemyPopup() {
    if (state.enemyPopup || !state.enemyQueue.length || !el.enemyPopup) return;
    const type = state.enemyQueue.shift();
    const d = ENEMIES[type];
    state.enemyPopup = { type: type, t: ENEMY_POPUP_TIME };
    /* 蹦极没有血量 / 护甲这些概念，别拿 0 去糊弄人 */
    const stats = type === 'bungee'
      ? '全程无敌（打不掉）· 不走路 · 5 秒后俯冲偷塔'
      : [
        '血量 ' + d.hp,
        '速度 ' + d.speed,
        d.armor ? '护甲 ' + d.armor : '无护甲',
        '漏过扣 ' + (d.leak || 1) + ' 点',
      ].join(' · ');
    el.enemyPopup.innerHTML =
      '<div class="ep-head"><i class="ep-dot" style="background:' + d.color +
      ';box-shadow:0 0 8px ' + d.color + '"></i><b>' + d.name + '</b>' +
      '<span class="ep-tag">新敌人</span></div>' +
      '<p class="ep-tip">' + (d.tip || '') + '</p>' +
      '<p class="ep-stats">' + stats + '</p>' +
      '<div class="ep-hint">点击卡片关闭 · ' + ENEMY_POPUP_TIME + ' 秒后自动收掉</div>';
    el.enemyPopup.classList.remove('hidden');
  }

  function closeEnemyPopup() {
    if (!state.enemyPopup) return;
    state.enemyPopup = null;
    if (el.enemyPopup) el.enemyPopup.classList.add('hidden');
    pumpEnemyPopup();                 // 后面还排着队就接着弹
  }

  function updateEnemyPopup(dt) {
    if (!state.enemyPopup) return;
    state.enemyPopup.t -= dt;
    if (state.enemyPopup.t <= 0) closeEnemyPopup();
  }

  /* ============================================================
   * 5. 建造 / 升级 / 出售
   * ============================================================ */
  function towerHpMax(type, level) {
    return Math.round(TOWERS[type].hp * (1 + level * 0.35));
  }

  /** 升级台能扣上去的距离（比 Z 选塔的 112 稍微紧一点，得走到跟前） */
  const BENCH_REACH = 96;

  /** 第二关：每波清完后在「交付台」刷一个升级台（场上还剩一个就不刷，免得堆一地） */
  function spawnBench() {
    if (!state.benchCell) return;                 // 第一关没有升级台
    for (let i = 0; i < state.towers.length; i++) {
      if (TOWERS[state.towers[i].type].isBench && !state.towers[i].dead) {
        /* 场上那个还没用掉：不重复刷，但每波提醒一次怎么用 */
        toast('⬆️ 升级台还在场上：用钩索端起它，走到要升级的塔旁边按 Shift', 'gold');
        return;
      }
    }
    /* 交付点被玩家占了就顺着螺旋找一格空地，尽量还是刷在交付点附近 */
    let cell = null;
    const pc = state.benchCell.c, pr = state.benchCell.r;
    for (let rad = 0; rad <= 3 && !cell; rad++) {
      for (let dc = -rad; dc <= rad && !cell; dc++) {
        for (let dr = -rad; dr <= rad && !cell; dr++) {
          if (rad > 0 && Math.max(Math.abs(dc), Math.abs(dr)) !== rad) continue;
          const c = pc + dc, r = pr + dr;
          if (c < 0 || c >= COLS || r < 0 || r >= ROWS) continue;
          if (!canBuild(c, r)) continue;
          cell = { c: c, r: r };
        }
      }
    }
    if (!cell) return;
    const def = TOWERS.bench;
    const t = {
      id: state.nextId++, type: 'bench', c: cell.c, r: cell.r, level: 0,
      x: cell.c * TILE + TILE / 2, y: cell.r * TILE + TILE / 2,
      cd: 0, angle: -Math.PI / 2, recoil: 0, spent: 0, kills: 0,
      hp: 1, hpMax: 1, hurtT: 99, shake: 0, dead: false,
      silence: 0, silenceFlash: 0,
    };
    state.towers.push(t);
    bgDirty = true;
    ring(t.x, t.y, 46, '#fbbf24', 0.6);
    burst(t.x, t.y, 16, '#fbbf24', 100, 2.4);
    toast('⬆️ 升级台已就位：用钩索（左 Shift）端起它，走到要升级的塔旁边再按一次', 'gold');
  }

  /** 免费给一座塔加一级：不看金币、不受 MAX_LEVEL 限制（升级台专用） */
  function applyFreeLevel(t) {
    t.level++;
    const before = t.hpMax;
    t.hpMax = towerHpMax(t.type, t.level);
    t.hp = Math.min(t.hpMax, t.hp + (t.hpMax - before));   // 升级顺带加固
  }

  /** 主角身边最近的、可以吃升级台的自家塔 */
  function benchTarget() {
    const h = state.hero;
    let best = null, bd = BENCH_REACH * BENCH_REACH;
    for (let i = 0; i < state.towers.length; i++) {
      const t = state.towers[i];
      if (t.dead || t.carried || t === state.carry) continue;
      if (TOWERS[t.type].invincible) continue;              // 固定设施不吃升级台
      const d = dist2(t.x, t.y, h.x, h.y);
      if (d <= bd) { bd = d; best = t; }
    }
    return best;
  }

  /** 端着升级台时按 Shift：把台子扣到身边的塔上，立刻升一级（突破 3 级上限） */
  function useBench() {
    const bench = state.carry;
    const t = benchTarget();
    if (!t) {
      toast('身边没有能升级的塔（升级台会放在地上）', 'warn');
      placeCarried();
      return;
    }
    const maxLv = TOWERS[t.type].levels.length;
    if (t.level + 1 >= maxLv) {
      toast(TOWERS[t.type].name + ' 已经是最高级 LV' + maxLv + '，换一座塔用', 'warn');
      return;                                        // 台子留着，别浪费
    }
    applyFreeLevel(t);
    /* 台子用完就没了（这一波的已经消耗掉，等下一波刷新的） */
    state.towers = state.towers.filter(function (x) { return x !== bench; });
    state.carry = null;
    bgDirty = true;
    burst(t.x, t.y, 22, '#fbbf24', 130, 2.6);
    ring(t.x, t.y, 40, '#fbbf24', 0.5);
    floatText(t.x, t.y - 24, 'LV ' + (t.level + 1) + '!', '#fbbf24');
    SFX.build();
    toast('⬆️ 升级台把 ' + TOWERS[t.type].name + ' 升到了 LV' + (t.level + 1), 'gold');
    syncSelection(true);
  }

  /** 手上端着东西时按 Shift：升级台 → 扣到塔上；普通塔 → 放在脚下 */
  function useCarried() {
    if (TOWERS[state.carry.type].isBench) { useBench(); return; }
    placeCarried();
  }

  function build(type, c, r) {
    const def = TOWERS[type];
    if (!canBuild(c, r)) { toast('这里不能建造', 'warn'); return; }
    if (state.money < def.cost) { toast('金币不足', 'warn'); return; }
    state.money -= def.cost;
    bgDirty = true;                     // 塔会盖住装饰，重建一次静态图层
    const hp = towerHpMax(type, 0);
    const t = {
      id: state.nextId++,
      type: type, c: c, r: r, level: 0,
      x: c * TILE + TILE / 2, y: r * TILE + TILE / 2,
      cd: 0, angle: -Math.PI / 2, recoil: 0, spent: def.cost, kills: 0,
      hp: hp, hpMax: hp, hurtT: 99, shake: 0, dead: false,
      silence: 0, silenceFlash: 0,          // 被首领沉默：哑火计时（秒）
    };
    state.towers.push(t);
    burst(t.x, t.y, 10, def.body, 80, 2);
    SFX.build();
    state.selectedTower = t;
    syncSelection(true);
    return t;
  }

  function upgradeSelected() {
    const t = state.selectedTower;
    if (!t || t.level >= MAX_LEVEL - 1) return;
    if (TOWERS[t.type].invincible) { toast('升级台是固定设施，不用升级——用钩索把它搬到要升的塔上', 'warn'); return; }
    const cost = TOWERS[t.type].upgrade[t.level];
    if (state.money < cost) { toast('金币不足，无法升级', 'warn'); return; }
    state.money -= cost;
    t.spent += cost;
    t.level++;
    const before = t.hpMax;
    t.hpMax = towerHpMax(t.type, t.level);
    t.hp = Math.min(t.hpMax, t.hp + (t.hpMax - before));   // 升级顺带加固
    burst(t.x, t.y, 14, '#fbbf24', 90, 2.2);
    floatText(t.x, t.y - 22, 'LV ' + (t.level + 1), '#fbbf24');
    SFX.build();
    syncSelection(true);
  }

  function sellSelected() {
    const t = state.selectedTower;
    if (!t) return;
    if (TOWERS[t.type].noSell) { toast('升级台是场上的固定设施，拆不掉也不能卖', 'warn'); return; }
    const back = Math.floor(t.spent * SELL_RATE);
    state.money += back;
    state.towers = state.towers.filter(function (x) { return x !== t; });
    burst(t.x, t.y, 12, '#94a3b8', 70, 2);
    floatText(t.x, t.y - 18, '+' + back, '#fbbf24');
    state.selectedTower = null;
    bgDirty = true;                     // 装饰要露出来，重建静态图层
    syncSelection(true);
  }

  /* 防御塔被拆塔者攻击（升级台无敌，拆不掉） */
  function damageTower(t, dmg) {
    if (t.dead) return;
    if (TOWERS[t.type].invincible) {
      t.hurtT = 0;
      t.shake = Math.max(t.shake, 0.5);
      return;
    }
    t.hp -= dmg;
    t.hurtT = 0;
    t.shake = 1;
    if (t.hp <= 0) destroyTower(t);
  }

  function destroyTower(t) {
    t.dead = true;
    t.hp = 0;
    /* 残骸回收：返还 40% 投入，避免一次失误就雪崩 */
    const salvage = Math.floor(t.spent * 0.4);
    state.money += salvage;
    burst(t.x, t.y, 24, '#f97316', 150, 3);
    burst(t.x, t.y, 14, '#94a3b8', 110, 2.4);
    ring(t.x, t.y, 46, '#f97316', 0.4);
    floatText(t.x, t.y - 20, '被拆毁！+' + salvage, '#f87171');
    toast(TOWERS[t.type].name + '被拆塔者摧毁了！（回收 ' + salvage + ' 金币）', 'warn');
    SFX.boom();
    if (state.selectedTower === t) {
      state.selectedTower = null;
      syncSelection(true);
    }
  }

  /* ============================================================
   * 5.6 主角升级：击杀获得经验 → 升级自动成长 → 三选一强化
   * ============================================================ */
  const MAX_HERO_LEVEL = 12;

  function xpNeedFor(level) { return 46 + (level - 1) * 36; }

  /* 强化池：每次升级随机抽 3 个给玩家选 */
  const PERKS = [
    { id: 'dmg', name: '锋利箭镞', desc: '攻击 +3', apply: function (h) { h.damage += 3; } },
    { id: 'rate', name: '疾风射击', desc: '攻速 +12%', apply: function (h) { h.rate = Math.max(0.14, h.rate * 0.88); } },
    { id: 'range', name: '鹰眼', desc: '射程 +40', apply: function (h) { h.range += 40; } },
    { id: 'hp', name: '强健体魄', desc: '生命上限 +25 并立即回复', apply: function (h) { h.hpMax += 25; h.hp = Math.min(h.hpMax, h.hp + 25); } },
    { id: 'regen', name: '坚韧回复', desc: '回血速度 +3/秒', apply: function (h) { h.regen += 3; } },
    { id: 'knock', name: '重击', desc: '被撞时把怪弹得更远（+60%，只能升一次）', apply: function (h) { h.knockMul = Math.min(1.6, h.knockMul + 0.6); } },
    { id: 'speed', name: '疾行靴', desc: '移动速度 +15%', apply: function (h) { h.speed = Math.round(h.speed * 1.15); } },
    /* 这两项**只能升一次**：拿到之后就不会再出现在三选一里（见 rollPerks） */
    { id: 'pierce', name: '贯穿箭', desc: '箭矢可以多穿透 1 个敌人', apply: function (h) { h.pierceCount = Math.min(1, h.pierceCount + 1); } },
    { id: 'spread', name: '散射箭', desc: '每次射击额外射出 2 支散射箭', apply: function (h) { h.spread = Math.min(1, (h.spread || 0) + 1); } },
    { id: 'reach', name: '指挥官视野', desc: '交互半径 +30', apply: function (h) { h.reach += 30; } },
  ];

  function gainXp(n) {
    const h = state.hero;
    if (!n || h.level >= MAX_HERO_LEVEL) return;
    h.xp += n;
    let guard = 0;
    while (h.xp >= h.xpNeed && h.level < MAX_HERO_LEVEL && guard++ < 20) {
      h.xp -= h.xpNeed;
      h.level++;
      h.xpNeed = xpNeedFor(h.level);
      /* 自动成长（生命上限不随等级增长，只有「强健体魄」能加） */
      h.damage += 0.6;
      h.rate = Math.max(0.14, h.rate - 0.006);
      h.range += 4;
      h.hp = h.hpMax;                        // 升级直接回满血
      h.pending++;
      h.pop = 1;                             // 贴图：升级时弹一下
      burst(h.x, h.y, 26, '#fde68a', 150, 3);
      ring(h.x, h.y, 60, '#fde68a', 0.5);
      floatText(h.x, h.y - 30, 'LV ' + h.level + '!', '#fde68a');
      SFX.build();
      toast('主角升到 ' + h.level + ' 级！选择一项强化');
    }
    if (h.xp >= h.xpNeed && h.level >= MAX_HERO_LEVEL) h.xp = h.xpNeed;
    if (h.pending > 0 && !state.levelOpen) openLevelMenu();
  }

  function rollPerks() {
    const h = state.hero;
    /* 已经升满的强化不再出现在选项里（散射箭、贯穿箭、重击都只能升一次） */
    const pool = PERKS.filter(function (p) {
      if (p.id === 'spread') return (h.spread || 0) < 1;
      if (p.id === 'pierce') return h.pierceCount < 1;
      if (p.id === 'knock') return h.knockMul < 1.6;
      return true;
    });
    const out = [];
    /* 「散射箭」在拿到之前必定出现在选项里（不会被随机抽掉） */
    const spread = pool.filter(function (p) { return p.id === 'spread'; })[0];
    if (spread) pool.splice(pool.indexOf(spread), 1);
    for (let i = 0; i < (spread ? 2 : 3) && pool.length; i++) {
      out.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);
    }
    if (spread) {
      /* 插进随机位置，免得每次都是第一张卡 */
      out.splice(Math.floor(Math.random() * (out.length + 1)), 0, spread);
    }
    return out;
  }

  function refreshLevelMenu() {
    if (!el.levelMenu) return;
    el.levelMenu.querySelector('.lv-title').textContent =
      '主角升到 ' + state.hero.level + ' 级！选择一项强化' + (state.hero.pending > 1 ? '（还有 ' + (state.hero.pending - 1) + ' 次）' : '');
    const box = el.levelMenu.querySelector('.lv-options');
    box.innerHTML = state.levelChoices.map(function (p, i) {
      return '<button class="lv-opt" data-perk="' + p.id + '">' +
        '<span class="nm">' + p.name + ' <small>(' + (i + 1) + ')</small></span>' +
        '<span class="ds">' + p.desc + '</span>' +
        '</button>';
    }).join('');
  }

  function openLevelMenu() {
    state.levelOpen = true;
    state.levelChoices = rollPerks();
    closeBuild();
    refreshLevelMenu();
    el.levelMenu.classList.remove('hidden');
  }

  function closeLevelMenu() {
    state.levelOpen = false;
    if (el.levelMenu) el.levelMenu.classList.add('hidden');
  }

  function choosePerk(id) {
    if (!state.levelOpen) return;
    const perk = state.levelChoices.filter(function (p) { return p.id === id; })[0];
    if (!perk) return;
    const h = state.hero;
    perk.apply(h);
    h.perks.push(perk.name);
    h.pending--;
    floatText(h.x, h.y - 24, perk.name, '#4ade80');
    burst(h.x, h.y, 14, '#4ade80', 110, 2.4);
    SFX.build();
    if (h.pending > 0) {
      state.levelChoices = rollPerks();
      refreshLevelMenu();
    } else {
      closeLevelMenu();
    }
  }

  /* ============================================================
   * 5.7 一次性工具：炸弹
   *   以主角为中心引爆，秒杀范围内「当前血量最高的 5 个」敌人（含首领取）
   * ============================================================ */
  function useBomb() {
    if (!state.started || state.phase === 'won' || state.phase === 'lost') return;
    const h = state.hero;
    if (state.bombs <= 0) { toast('没有炸弹了——可以在右侧面板用 ' + BOMB_COST + ' 金币买一颗', 'warn'); return; }
    if (state.bombCd > 0) { toast('炸弹冷却中，还剩 ' + Math.ceil(state.bombCd) + ' 秒', 'warn'); return; }

    const r2 = BOMB_RADIUS * BOMB_RADIUS;
    const inRange = [];
    for (let i = 0; i < state.enemies.length; i++) {
      const e = state.enemies[i];
      if (e.dead) continue;
      if (dist2(e.x, e.y, h.x, h.y) <= r2) inRange.push(e);
    }
    if (!inRange.length) { toast('炸弹范围内没有敌人', 'warn'); return; }

    /* 按当前血量从高到低，取前 5 个直接秒杀 */
    inRange.sort(function (a, b) { return b.hp - a.hp; });
    const targets = inRange.slice(0, BOMB_KILLS);

    state.bombs--;
    state.bombCd = BOMB_COOLDOWN;
    state.flash = Math.min(0.9, 0.5);
    state.hero.invuln = Math.max(state.hero.invuln, 0.6);

    /* 冲击波特效 */
    ring(h.x, h.y, BOMB_RADIUS, '#fde68a', 0.5);
    ring(h.x, h.y, BOMB_RADIUS * 0.7, '#fb923c', 0.42);
    ring(h.x, h.y, BOMB_RADIUS * 0.4, 'rgba(255,255,255,0.95)', 0.32);
    burst(h.x, h.y, 40, '#fbbf24', 300, 3.6);
    burst(h.x, h.y, 20, '#ffffff', 200, 2.6);
    SFX.boom(); SFX.boom();

    for (let i = 0; i < targets.length; i++) {
      const e = targets[i];
      burst(e.x, e.y, 14, e.color, 170, 3);
      ring(e.x, e.y, e.r + 22, '#fff7ed', 0.3);
      killEnemy(e, null);                    // 直接秒杀（赏金与经验照常结算）
    }
    floatText(h.x, h.y - 40, '秒杀 ×' + targets.length, '#fde68a');
    if (state.bombs > 0) toast('💣 炸弹引爆！秒杀了范围内血量最高的 ' + targets.length + ' 个敌人（冷却 ' + BOMB_COOLDOWN + ' 秒）', 'gold');
    else toast('💣 炸弹引爆！秒杀了范围内血量最高的 ' + targets.length + ' 个敌人（没弹药了）', 'gold');
  }

  function buyBomb() {
    if (state.bombs >= BOMB_MAX) { toast('炸弹最多带 ' + BOMB_MAX + ' 颗', 'warn'); return; }
    if (state.money < BOMB_COST) { toast('金币不足，买不起炸弹', 'warn'); return; }
    state.money -= BOMB_COST;
    state.bombs++;
    SFX.build();
    toast('买了一个炸弹（剩 ' + state.bombs + ' 颗）', 'gold');
    syncHUD();
  }

  /* ============================================================
   * 5.8 钩索（通关第一关后掉落的道具）
   *   · 钩索始终朝「鼠标方向」甩出去，长度固定
   *   · 左 Shift：
   *       手上没东西、钩索搭在塔/升级台上 → 把它挑起来
   *       手上端着普通塔                      → 在脚下这格放下（不能放就继续端着）
   *       手上端着升级台                      → 扣到身边的塔上，免费升一级（可突破 3 级上限）
   *       其它情况                            → 朝鼠标方向**飞出固定距离**（快速位移）
   *   · 链爪本身是**纯指示线**：碰到敌人不掉血、不推人、不减速
   *   · 能撞开敌人的是**位移中的主角**：冲过去的那一段里碰到谁就把谁撞回去
   *     （见 enemyTouchHero 的 dashing 分支；不掉血、也不会被撞伤）
   *   · 位移期间方向键被禁用（见 updateHero）：整段轨迹只由钩索决定，
   *     否则 WASD 会和钩索抢方向，位移会被带偏、末尾还会多瞬移一段
   * ============================================================ */
  const HOOK_LEN = 196;      // 钩索固定长度
  const DASH_DIST = HOOK_LEN;  // 位移距离：**固定值**，朝鼠标方向正好飞这么远（和绳索等长）
  const DASH_SPEED = 1180;   // 冲刺速度（像素/秒）
  const DASH_CD = 1.5;       // 冲刺冷却
  const DASH_KNOCK = 44;     // 位移途中撞到敌人时的击退距离（比平时撞怪更有冲量）
  const KNOCK_BASE = 26;     // 平时撞怪的击退距离（都要再叠上敌人半径与主角的 knockMul）

  /** 钩索的朝向：**由鼠标决定**（主角身体仍然朝着移动方向） */
  function hookAngle() {
    const h = state.hero;
    const dx = state.mouse.x - h.x, dy = state.mouse.y - h.y;
    if (Math.abs(dx) < 0.001 && Math.abs(dy) < 0.001) return h.dir;
    return Math.atan2(dy, dx);
  }

  /** 钩索当前的两个端点 */
  function hookPoints() {
    const h = state.hero;
    const a = hookAngle();
    return {
      x1: h.x, y1: h.y,
      x2: h.x + Math.cos(a) * HOOK_LEN,
      y2: h.y + Math.sin(a) * HOOK_LEN,
      a: a,
    };
  }

  /** 钩索位移是否正在进行（位移途中：方向键失效、主角无敌并会撞开敌人） */
  function hookMoving() {
    return state.dashT > 0 && !!state.dashTo;
  }

  /** 点到线段的距离平方 */
  function segDist2(px, py, x1, y1, x2, y2) {
    const dx = x2 - x1, dy = y2 - y1;
    const len2 = dx * dx + dy * dy;
    let t = len2 > 0 ? ((px - x1) * dx + (py - y1) * dy) / len2 : 0;
    t = Math.max(0, Math.min(1, t));
    const qx = x1 + dx * t, qy = y1 + dy * t;
    return (px - qx) * (px - qx) + (py - qy) * (py - qy);
  }

  /** 钩索够得着的那座塔（取最近的一座） */
  function hookTower() {
    if (state.carry) return null;
    const s = hookPoints();
    let best = null, bd = Infinity;
    for (let i = 0; i < state.towers.length; i++) {
      const t = state.towers[i];
      if (t.carried || t.dead) continue;
      const d = segDist2(t.x, t.y, s.x1, s.y1, s.x2, s.y2);
      const reach = (t.r || 18) + 14;
      if (d <= reach * reach && d < bd) { bd = d; best = t; }
    }
    return best;
  }

  function pickUpTower(t) {
    state.carry = t;
    t.carried = true;
    state.selectedTower = null;
    state.marked = null;
    syncSelection(true);
    bgDirty = true;
    burst(t.x, t.y, 12, '#fde68a', 120, 2.2);
    SFX.build();
    toast(TOWERS[t.type].isBench
      ? '🪝 端起升级台——走到要升级的塔旁边，再按一次左 Shift 扣上去'
      : '🪝 钩住了 ' + TOWERS[t.type].name + '——走到别处再按一次左 Shift 放下', 'gold');
  }

  function placeCarried() {
    const t = state.carry;
    const cell = heroCell();
    /* 保护伞是「随意放置」的：路面也能放，只要不是水面、不和别的建筑重叠 */
    const ok = cell && (TOWERS[t.type].isUmbrella ? canPlaceUmbrella(cell.c, cell.r) : canBuild(cell.c, cell.r));
    if (!ok) {
      toast(TOWERS[t.type].isUmbrella
        ? '这里放不下（不能是水面、也不能和别的建筑重叠）'
        : '这里放不下（不能是路面、也不能和别的塔重叠）', 'warn');
      return;
    }
    t.carried = false;
    t.c = cell.c; t.r = cell.r;
    t.x = cell.c * TILE + TILE / 2;
    t.y = cell.r * TILE + TILE / 2;
    state.carry = null;
    bgDirty = true;
    burst(t.x, t.y, 14, '#86efac', 130, 2.4);
    floatText(t.x, t.y - 22, '放置完成', '#86efac');
    SFX.build();
  }

  function useHook() {
    if (!state.hookOn || !state.started) return;
    if (state.phase === 'won' || state.phase === 'lost') return;
    const h = state.hero;

    if (state.carry) { useCarried(); return; }

    const t = hookTower();
    if (t) { pickUpTower(t); return; }

    if (state.dashCd > 0) { toast('钩索冷却中，还剩 ' + state.dashCd.toFixed(1) + ' 秒', 'warn'); return; }
    /* 鼠标贴着主角时方向不可靠，直接不甩 */
    if (Math.hypot(state.mouse.x - h.x, state.mouse.y - h.y) < 20) {
      toast('钩索目标就是自己脚下', 'warn');
      return;
    }
    /* 位移距离是**固定值**：朝鼠标方向正好飞出 DASH_DIST 像素，不再是「点多远飞多远」 */
    const a = hookAngle();
    const tipX = Math.max(h.r, Math.min(W - h.r, h.x + Math.cos(a) * DASH_DIST));
    const tipY = Math.max(h.r, Math.min(H - h.r, h.y + Math.sin(a) * DASH_DIST));
    /* 落点在水里就推到岸上（过河就靠这一下） */
    const land = pushToShore(tipX, tipY);
    const dist = Math.hypot(land.x - h.x, land.y - h.y);
    if (dist < 20) { toast('钩索甩不出去：落点就在脚下', 'warn'); return; }
    state.dashTo = { x: land.x, y: land.y };
    /* 位移时长＝距离 ÷ 速度：匀速把自己拉到落点，
     * 不会再出现「时间到了、剩下的一段靠瞬移补上」 */
    state.dashT = Math.max(1 / 60, dist / DASH_SPEED);
    state.dashCd = DASH_CD;
    burst(h.x, h.y, 10, '#fde68a', 160, 2);
    SFX.shoot();
  }

  /** 每帧：钩索把自己匀速拽向落点（链爪本身不结算任何东西，撞怪在 enemyTouchHero 里） */
  function updateHook(dt) {
    const h = state.hero;
    if (state.dashCd > 0) state.dashCd = Math.max(0, state.dashCd - dt);

    /* --- 冲刺（钩索无视河面，直接飞过对岸） ---
     * 位移期间方向键被忽略（见 updateHero），轨迹完全由钩索决定 */
    if (hookMoving()) {
      state.dashT -= dt;
      const dx = state.dashTo.x - h.x, dy = state.dashTo.y - h.y;
      const d = Math.hypot(dx, dy);
      const step = DASH_SPEED * dt;
      if (d <= step) {
        /* 到达落点（落点已在水面外，这里直接落定） */
        h.x = state.dashTo.x; h.y = state.dashTo.y;
        state.dashT = 0;
        state.dashTo = null;
        burst(h.x, h.y, 12, '#fde68a', 150, 2.2);
      } else {
        h.x += dx / d * step;
        h.y += dy / d * step;
        h.dir = Math.atan2(dy, dx);
        state.bits.push({ x: h.x, y: h.y, vx: 0, vy: 0, life: 0.25, max: 0.25, color: '#fde68a', r: 4 });
      }
      /* 兜底：万一被边界 / 地形卡住没飞到目标，到点就地停下，绝不再瞬移一段 */
      if (state.dashT <= 0 && state.dashTo) {
        state.dashT = 0;
        state.dashTo = null;
        burst(h.x, h.y, 8, '#fde68a', 120, 1.8);
      }
      h.invuln = Math.max(h.invuln, 0.06);   // 冲刺途中短暂无敌，别被路上怪白撞
    }
  }

  /** 把一只怪沿它的来路推回去一段（主角撞击 / 钩索位移撞击共用）
   *  诱饵是直线冲锋的，没有路线可言，就沿它自己的朝向推 */
  function knockEnemyBack(e, base) {
    const knock = (base + e.r) * state.hero.knockMul;
    if (ENEMIES[e.type].free) {
      e.x -= Math.cos(e.angle) * knock;
      e.y -= Math.sin(e.angle) * knock;
      e.dist = Math.max(0, e.dist - knock);
    } else {
      e.dist = Math.max(0, e.dist - knock);
      const p = posAt(e.route, e.dist);
      e.x = p.x; e.y = p.y; e.angle = p.angle;
    }
    return knock;
  }

  /* ============================================================
   * 5.5 主角：移动、选中 / 建造 / 升级 / 拆除、远程攻击、被撞受伤
   * ============================================================ */
  function heroCell() {
    const h = state.hero;
    const c = Math.floor(h.x / TILE), r = Math.floor(h.y / TILE);
    if (c < 0 || c >= COLS || r < 0 || r >= ROWS) return null;
    return { c: c, r: r };
  }

  /** Z：脚下有塔就选中塔，是空地就标记为待建位置 */
  function heroSelect() {
    const cell = heroCell();
    if (!cell) return;
    const t = towerAt(cell.c, cell.r);
    if (t) {
      state.selectedTower = t;
      state.marked = null;
      closeBuild();
      syncSelection(true);
      toast('已选中 ' + TOWERS[t.type].name + '（LV' + (t.level + 1) + '）：F 升级 · C 拆除');
      return;
    }
    if (canBuild(cell.c, cell.r)) {
      state.marked = cell;
      state.selectedTower = null;
      syncSelection(true);
      toast('已标记这块空地：按 B 选择要建造的塔');
      return;
    }
    toast('路面上不能建造', 'warn');
  }

  /** B：在标记的空地上打开三选一建造菜单 */
  function openBuild() {
    if (!state.marked || !canBuild(state.marked.c, state.marked.r)) {
      toast('先站到空地上按 Z 标记位置', 'warn');
      return;
    }
    state.buildOpen = true;
    positionBuildMenu();
    el.buildMenu.classList.remove('hidden');
    refreshBuildMenu();
  }

  function closeBuild() {
    state.buildOpen = false;
    if (el.buildMenu) el.buildMenu.classList.add('hidden');
  }

  /** 把弹窗摆到目标格附近（画布可能被 CSS 缩放过） */
  function positionBuildMenu() {
    if (!state.marked || !el.buildMenu) return;
    const stage = el.buildMenu.parentElement;
    const cr = cv.getBoundingClientRect();
    const sr = stage.getBoundingClientRect();
    const scale = cr.width / W;
    const x = (state.marked.c * TILE + TILE / 2) * scale + (cr.left - sr.left);
    const y = (state.marked.r * TILE + TILE) * scale + (cr.top - sr.top);
    const mw = el.buildMenu.offsetWidth || 250;
    const mh = el.buildMenu.offsetHeight || 170;
    el.buildMenu.style.left = Math.max(6, Math.min(sr.width - mw - 6, x - mw / 2)) + 'px';
    el.buildMenu.style.top = Math.max(6, Math.min(sr.height - mh - 6, y + 6)) + 'px';
  }

  function refreshBuildMenu() {
    if (!el.buildMenu) return;
    const items = el.buildMenu.querySelectorAll('[data-tower]');
    for (let i = 0; i < items.length; i++) {
      const k = items[i].getAttribute('data-tower');
      const poor = state.money < TOWERS[k].cost;
      items[i].classList.toggle('poor', poor);
      items[i].disabled = poor;
    }
  }

  /** 建造菜单里选定一种塔 */
  function chooseTower(key) {
    if (!state.buildOpen || !state.marked) return;
    const cell = state.marked;
    if (!canBuild(cell.c, cell.r)) { closeBuild(); state.marked = null; toast('这块地已经不能建造了', 'warn'); return; }
    const before = state.towers.length;
    build(key, cell.c, cell.r);
    if (state.towers.length > before) { state.marked = null; closeBuild(); }
  }

  /** 鼠标左键：主角射出一发直线弹道（伤害低但射速快、无视护甲）
   *  学了「散射箭」后一次射出多支，呈扇形散开 */
  function heroFire(tx, ty) {
    const h = state.hero;
    if (h.cd > 0) return;
    const base = Math.atan2(ty - h.y, tx - h.x);
    h.aim = base;
    h.cd = h.rate;
    h.recoil = 1;
    const count = 1 + (h.spread || 0) * 2;
    const stepA = 0.15;
    for (let i = 0; i < count; i++) {
      const ang = base + (i - (count - 1) / 2) * stepA;
      state.shots.push({
        kind: 'bolt', x: h.x + Math.cos(ang) * 15, y: h.y + Math.sin(ang) * 15,
        vx: Math.cos(ang) * h.shotSpeed, vy: Math.sin(ang) * h.shotSpeed,
        travel: 0, range: h.range, damage: h.damage, pierce: true,
        pierceLeft: h.pierceCount, hitSet: null,
        color: '#fde68a', angle: ang, life: 2,
      });
    }
    burst(h.x + Math.cos(base) * 16, h.y + Math.sin(base) * 16, 2, '#fde68a', 60, 1.2);
    /* 弓口的一圈小爆闪：贴图和矢量小人都用得上 */
    ring(h.x + Math.cos(base) * 18, h.y + Math.sin(base) * 18, 15, '#fde68a', 0.18);
    SFX.arrow();
  }

  /** 主角受伤：掉血 + 红屏 + 短暂无敌
   *  silent = true 时用于光环这类持续伤害：不闪红屏、不响音效，只掉血和飘字 */
  function hurtHero(dmg, silent) {
    const h = state.hero;
    if (h.invuln > 0 || state.phase === 'won' || state.phase === 'lost') return;
    h.hp -= dmg;
    h.hurtT = 0;
    h.invuln = silent ? 0.12 : 0.35;
    h.flash = silent ? 0.55 : 1;
    if (silent) {
      floatText(h.x, h.y - 26, '-' + dmg, '#fb7185');
      burst(h.x, h.y, 4, '#e11d48', 80, 1.8);
    } else {
      state.flash = Math.min(0.9, 0.35 + dmg * 0.02);
      floatText(h.x, h.y - 26, '-' + dmg, '#f87171');
      burst(h.x, h.y, 8, '#f87171', 110, 2);
      SFX.hurt();
    }
    if (h.hp <= 0) {
      h.hp = 0;
      /* 贴图：记下阵亡时刻，主循环会为这 1.8 秒继续出帧，播完倒下的动画 */
      if (!h.deathAt) h.deathAt = performance.now();
      endGame(false, 'hero');
    }
  }

  function updateHero(dt) {
    const h = state.hero;
    const k = state.keys;
    /* 钩索位移中：方向键一律不生效——位移完全交给钩索，
     * 否则 WASD 会和钩索抢方向，把轨迹带偏、末尾还容易多瞬移一段 */
    const hooked = hookMoving();
    let dx = 0, dy = 0;
    if (!hooked) {
      if (k.a || k.arrowleft) dx -= 1;
      if (k.d || k.arrowright) dx += 1;
      if (k.w || k.arrowup) dy -= 1;
      if (k.s || k.arrowdown) dy += 1;
    }
    if (dx || dy) {
      const len = Math.hypot(dx, dy);
      dx /= len; dy /= len;
      /* 分轴移动：撞到河面只停下那一个方向，沿岸还能滑 */
      const nx = h.x + dx * h.speed * dt;
      if (!waterAt(nx, h.y)) h.x = nx;
      const ny = h.y + dy * h.speed * dt;
      if (!waterAt(h.x, ny)) h.y = ny;
      h.dir = Math.atan2(dy, dx);
      const prevStep = h.step;
      h.step += dt * 13;
      h.moving = true;
      /* 每迈出一步，脚下扬一点灰（只在用贴图时有，纯装饰） */
      if (HERO_SPRITE.ok && Math.floor(prevStep / Math.PI) !== Math.floor(h.step / Math.PI)) {
        burst(h.x, h.y + HERO_SPRITE.feetY, 2, '#d9e8c8', 32, 1.1);
      }
    } else {
      h.moving = false;
      h.step = 0;
    }
    h.x = Math.max(h.r, Math.min(W - h.r, h.x));
    h.y = Math.max(h.r, Math.min(H - h.r, h.y));

    if (h.cd > 0) h.cd -= dt;
    if (h.recoil > 0) h.recoil = Math.max(0, h.recoil - dt * 5);
    if (h.invuln > 0) h.invuln -= dt;
    if (h.flash > 0) h.flash = Math.max(0, h.flash - dt * 2.4);
    /* 脱离危险 3.5 秒后回血 */
    h.hurtT += dt;
    if (h.hurtT > 3.5 && h.hp < h.hpMax) h.hp = Math.min(h.hpMax, h.hp + h.regen * dt);

    /* ---- 贴图动画的计时器（没有贴图时算着玩，不影响任何玩法数值）---- */
    if (h.pop > 0) h.pop = Math.max(0, h.pop - dt * 1.6);
    if (h.spawn > 0) h.spawn = Math.max(0, h.spawn - dt * 1.4);
    /* 贴图视线：一直盯着鼠标（平时慢慢转过去，按住左键 / 有敌人时瞬间对齐，
     * 免得箭都飞出去了人物还在慢慢转身）——和只管射箭方向的 h.aim 分开，
     * 这样矢量小人「只有瞄准时才转弓」的老手感一点没变 */
    const lookTarget = Math.atan2(state.mouse.y - h.y, state.mouse.x - h.x);
    let lookD = lookTarget - h.look;
    while (lookD > Math.PI) lookD -= Math.PI * 2;
    while (lookD < -Math.PI) lookD += Math.PI * 2;
    h.look += lookD * Math.min(1, dt * ((state.mouse.down || state.enemies.length) ? 30 : 7));
    /* 转身：鼠标在左半边就镜像，中间用 0 过渡（看起来是「扭身」而不是硬翻） */
    const wantFace = Math.cos(h.look) < 0 ? -1 : 1;
    if (h.face !== wantFace) {
      h.face += (wantFace > h.face ? 1 : -1) * dt * 11;
      if ((wantFace > 0 && h.face > wantFace) || (wantFace < 0 && h.face < wantFace)) h.face = wantFace;
    }
    /* 前倾角：平时朝鼠标，钩索冲刺时改成朝位移方向，平滑跟随免得抽搐 */
    const leanTarget = hookMoving()
      ? Math.sin(h.dir) * 0.42 * (h.face < 0 ? -1 : 1)
      : Math.sin(h.look) * 0.16 * (h.face < 0 ? -1 : 1);
    h.lean += (leanTarget - h.lean) * Math.min(1, dt * 9);
    h.dashFx += ((hookMoving() ? 1 : 0) - h.dashFx) * Math.min(1, dt * 12);
    /* 冲刺残影：每 0.035 秒留一张，0.14 秒内淡掉 */
    for (let i = h.ghost.length - 1; i >= 0; i--) {
      h.ghost[i].a -= dt * 3.6;
      if (h.ghost[i].a <= 0) h.ghost.splice(i, 1);
    }
    if (hookMoving() && HERO_SPRITE.ok) {
      h.ghostT -= dt;
      if (h.ghostT <= 0) {
        h.ghostT = 0.035;
        h.ghost.push({ x: h.x, y: h.y, a: 0.5, face: h.face });
        if (h.ghost.length > 8) h.ghost.shift();
      }
    }

    /* 按住左键持续射击 */
    if (state.mouse.down && !state.buildOpen) heroFire(state.mouse.x, state.mouse.y);
  }

  /** 怪撞到主角：
   *   · 平时 —— 主角掉血，怪被弹回去；
   *   · 钩索位移途中 —— 主角是「撞上去」的那一方：不掉血，但把碰到的一路撞回去 */
  function enemyTouchHero() {
    const h = state.hero;
    if (state.phase !== 'battle' && state.phase !== 'prep') return;
    const dashing = hookMoving();
    for (let i = 0; i < state.enemies.length; i++) {
      const e = state.enemies[i];
      if (e.dead) continue;
      if (e.touchCd > 0) continue;
      const def = ENEMIES[e.type];
      const touch = def.touch || 0;
      const rr2 = (e.r + h.r) * (e.r + h.r);
      if (dist2(e.x, e.y, h.x, h.y) > rr2) continue;

      e.touchCd = 0.85;
      if (dashing) {
        /* 位移撞击：冲量更大，而且主角不掉血（不然冲进怪群里就是自杀） */
        knockEnemyBack(e, DASH_KNOCK);
        burst(e.x, e.y, 10, '#fde68a', 130, 2.4);
        floatText(e.x, e.y - e.r - 6, '撞开', '#fde68a');
        continue;
      }
      if (touch <= 0) continue;               // 诱饵没有伤害，只是穿过去

      /* 把怪沿来路弹回去一段（「重击」强化会加大距离） */
      knockEnemyBack(e, KNOCK_BASE);
      burst(e.x, e.y, 8, '#fbbf24', 120, 2.2);
      floatText(e.x, e.y - e.r - 6, '击退', '#fbbf24');
      hurtHero(touch);
    }
  }

  /* 找射程内所有的防御塔（拆塔者用：一次拆一圈）——无敌的固定设施不算目标 */
  function towersInRange(e, range) {
    const out = [];
    const r2 = range * range;
    for (let i = 0; i < state.towers.length; i++) {
      const t = state.towers[i];
      if (t.dead || t.carried) continue;    // 端在手上的塔不会被打
      if (TOWERS[t.type].invincible) continue;   // 升级台拆不掉，别浪费它的拆塔节拍
      if (dist2(e.x, e.y, t.x, t.y) <= r2) out.push(t);
    }
    return out;
  }

  /* ============================================================
   * 6. 波次流程
   * ============================================================ */
  function waveLabel(wave) {
    function part(list) {
      return list.map(function (g) { return ENEMIES[g.type].name + '×' + g.count; }).join('、');
    }
    const main = wave.filter(function (g) { return !g.from; });
    const side = wave.filter(function (g) { return g.from === 'side'; });
    const east = wave.filter(function (g) { return g.from === 'east'; });
    let s = part(main);
    if (s.length > 30) s = s.slice(0, 28) + '…';
    if (side.length) s += ' ｜ 侧路：' + part(side);
    if (east.length) s += ' ｜ 地道：' + part(east);
    return s;
  }

  function startWave(early) {
    if (!state.started || state.phase !== 'prep') return;
    if (early && state.countdown > 0.5) {
      const bonus = Math.max(1, Math.floor(state.countdown));
      state.money += bonus;
      toast('提前开波 +' + bonus + ' 金币', 'gold');
    }
    const wave = WAVES[state.waveIndex];
    /* 到点就开启支路出怪点 */
    for (let i = 0; i < SUB_LANES.length; i++) {
      const L = SUB_LANES[i];
      if (!state.laneOpen[L.key] && state.waveIndex >= L.openWave) {
        state.laneOpen[L.key] = true;
        state.laneFlash[L.key] = 4;
        bgDirty = true;                 // 土道变成正常路面，静态图层要重建
        toast('⚠️ ' + L.name + '出现新的出怪点！', 'warn');
      }
    }
    state.spawnQueue = [];
    /* 第二关的「双路统一出怪」：同一批怪对半轮流走两条路，
     * 两条路的压力因此始终一致，不存在「某条路这波没怪」的情况 */
    const twinKey = TWIN_SPAWN && SUB_LANES.length ? SUB_LANES[0].key : null;
    let twinIdx = state.waveIndex % 2;    // 每波把起始边翻转一次：奇数个的那组会轮流偏袒两路
    for (let g = 0; g < wave.length; g++) {
      const group = wave[g];
      const base = group.delay || 0;
      const lane = (group.from && state.laneOpen[group.from]) ? group.from : 'main';
      for (let i = 0; i < group.count; i++) {
        let useLane = lane;
        if (twinKey && state.laneOpen[twinKey]) useLane = (twinIdx++ % 2 === 0) ? 'main' : twinKey;
        state.spawnQueue.push({ t: base + i * group.interval, type: group.type, lane: useLane });
      }
    }
    state.spawnQueue.sort(function (a, b) { return a.t - b.t; });
    state.waveTotal = state.spawnQueue.length;
    state.battleTime = 0;
    state.phase = 'battle';
    toast('第 ' + (state.waveIndex + 1) + ' 波来袭：' + waveLabel(wave));
  }

  /** 诱饵的随机出场点：地图四边随机，远离基地和主角 */
  function randomDecoySpawn() {
    for (let i = 0; i < 40; i++) {
      const edge = Math.floor(Math.random() * 3);
      let x, y;
      if (edge === 0) { x = 50 + Math.random() * (W - 220); y = -20; }
      else if (edge === 1) { x = 50 + Math.random() * (W - 220); y = H + 20; }
      else { x = Math.random() < 0.5 ? -20 : W + 20; y = 30 + Math.random() * (H - 60); }
      if (Math.hypot(x - GOAL.x, y - GOAL.y) < 330) continue;       // 别贴着基地冒出来
      if (Math.hypot(x - state.hero.x, y - state.hero.y) < 190) continue;  // 也别贴脸
      return { x: x, y: y };
    }
    return { x: -20, y: PATH[0].y };
  }

  function spawnEnemy(type, waveIdx, dist, lane) {
    const def = ENEMIES[type];
    announceEnemy(type);                   // 这种怪第一次出场 → 弹一张说明卡
    const hp = Math.round(def.hp * (1 + waveIdx * (state.hpPerWave || HP_PER_WAVE)) * (state.hpScale || 1));
    const key = LANES[lane] ? lane : 'main';
    const route = LANES[key];
    const d = dist === undefined ? -Math.random() * 16 : dist;
    let p = posAt(route, d);
    /* 诱饵不受出怪点限制：从地图任意一边随机冒出来 */
    if (def.free) p = randomDecoySpawn();
    const frozen = {
      type: type, hp: hp, maxHp: hp, speed: def.speed, reward: def.reward, r: def.r,
      color: def.color, dark: def.dark, armor: def.armor, leakCost: def.leak || 1,
      route: route, lane: key, dist: def.free ? 0 : d,
      off: def.free ? 0 : (Math.random() - 0.5) * 15, x: p.x, y: p.y, angle: 0,
      slow: 0, slowT: 0, freezeT: 0, hit: 0, dead: false, pulse: 0,
      shield: def.shield || 0, shieldMax: def.shield || 0, shieldTimer: 0,
      healCd: def.healEvery || 0, summonCd: def.summonEvery || 0,
      silenceCd: def.silenceEvery || 0, silencePulse: 0,          // 首领沉默波
      atkCd: def.attackEvery || 0, targets: null, atkFlash: 0,   // 拆塔者
      pushCd: def.pushEvery || 0, pushFlash: 0,                  // 督军
      throwCd: def.throwEvery || 0, throwFlash: 0,               // 投石者
      swordCd: def.swordEvery || 0, swordFlash: 0,               // 屠戮者的血剑
      goalX: GOAL.x, goalY: GOAL.y,                              // 诱饵的直线目标
      touchCd: 0,                                                // 撞击主角的冷却
      bungeeFlash: 0,                                            // 蹦极
      noHit: false, dropping: 0, dropX: 0, dropY: 0, dropTowerId: 0, popped: false,
      flying: false, diveT: -1, grabbed: false, giveUp: BUNGEE_GIVEUP,
    };
    /* 蹦极：不走小路、全程无敌，出场就先给自己挑一座塔贴靶子 */
    if (type === 'bungee') {
      frozen.flying = true;
      frozen.noHit = true;
      frozen.y = BUNGEE_SKY;
      frozen.x = W / 2;
      const tw = randomStealTarget();
      if (tw) throwBungeeTarget(frozen, tw, def);
    }
    state.enemies.push(frozen);
  }

  function damageEnemy(e, dmg, owner, pierce) {
    if (e.dead) return;
    if (e.noHit) return;                       // 蹦极吊下来那一段无敌，打不动
    const eff = pierce ? dmg : Math.max(dmg * 0.2, dmg - e.armor);
    let left = eff;
    if (e.shield > 0) {
      const absorbed = Math.min(e.shield, left);
      e.shield -= absorbed;
      left -= absorbed;
      e.shieldTimer = ENEMIES[e.type].shieldDelay || 3.5;
    }
    if (left > 0) e.hp -= left;
    e.hit = 0.12;
    if (e.hp <= 0) killEnemy(e, owner);
  }

  function killEnemy(e, owner) {
    e.dead = true;
    state.lastKill = { x: e.x, y: e.y };   // 第一关最后一只怪倒在哪儿，钩爪就掉在哪儿
    state.kills++;
    if (owner) owner.kills++;
    state.money += e.reward;
    /* 主角经验：亲手击杀全额，塔在主角附近击杀给 30% */
    const xp = ENEMIES[e.type].xp || 0;
    const h = state.hero;
    if (!owner) gainXp(xp);
    else if (dist2(e.x, e.y, h.x, h.y) <= 260 * 260) gainXp(xp * 0.3);
    floatText(e.x, e.y - e.r - 6, '+' + e.reward, '#fbbf24');
    burst(e.x, e.y, e.type === 'boss' ? 26 : 10, e.color, e.type === 'boss' ? 170 : 100, 2.4);
    SFX.kill();

    /* 分裂史莱姆：留下一堆小史莱姆继续前进 */
    const def = ENEMIES[e.type];
    if (def.split) {
      for (let i = 0; i < def.split; i++) {
        state.pending.push({ type: 'mini', wave: state.waveIndex, dist: Math.max(0, e.dist - i * 14), lane: e.lane });
      }
    }
  }

  /* 战地医师：治疗范围内的友军（一次最多治疗 3 个，避免抱团无敌） */
  function healAllies(e, def) {
    let healed = 0;
    for (let i = 0; i < state.enemies.length && healed < 3; i++) {
      const o = state.enemies[i];
      if (o.dead || o.hp >= o.maxHp) continue;
      if (dist2(e.x, e.y, o.x, o.y) > def.healRadius * def.healRadius) continue;
      o.hp = Math.min(o.maxHp, o.hp + def.healAmount);
      healed++;
    }
    e.pulse = 0.5;
    if (healed) {
      ring(e.x, e.y, def.healRadius, '#4ade80', 0.45);
      floatText(e.x, e.y - e.r - 12, '+' + healed, '#4ade80');
    }
  }

  /* 首领：周期性召唤援军 */
  function summonMinions(e, def) {
    e.pulse = 0.6;
    for (let i = 0; i < def.summonCount; i++) {
      state.pending.push({ type: def.summonType, wave: state.waveIndex, dist: Math.max(0, e.dist - 24 - i * 20), lane: e.lane });
    }
    ring(e.x, e.y, 70, '#ef4444', 0.5);
    toast('⚠️ 首领召唤了援军！', 'warn');
  }

  /* 首领：沉默波——把身边最近的最多 5 座防御塔震哑 3 秒，并各自砸掉一截耐久。
   * 被沉默的塔：不射击（照常瞄人、照常自修），塔身上会浮一层紫色「🔇」罩子。 */
  function bossSilence(e, def) {
    e.silencePulse = 0.65;
    const cands = [];
    for (let i = 0; i < state.towers.length; i++) {
      const t = state.towers[i];
      if (t.dead || t.carried) continue;             // 端在手上的塔不参与
      const td = TOWERS[t.type];
      if (td.isBench || td.invincible) continue;      // 升级台 / 无敌设施免疫
      const dx = t.x - e.x, dy = t.y - e.y;
      const d2 = dx * dx + dy * dy;
      if (d2 > def.silenceRadius * def.silenceRadius) continue;
      cands.push({ t: t, d: d2 });
    }
    ring(e.x, e.y, def.silenceRadius, '#a855f7', 0.65);
    if (!cands.length) {
      toast('🔇 首领放了个沉默波，但身边没有塔', 'warn');
      SFX.shoot();
      return;
    }
    cands.sort(function (a, b) { return a.d - b.d; });
    const n = Math.min(def.silenceCount, cands.length);
    for (let i = 0; i < n; i++) {
      const t = cands[i].t;
      t.silence = Math.max(t.silence || 0, def.silenceTime);
      t.silenceFlash = 0.55;
      damageTower(t, def.silenceDamage);
      burst(t.x, t.y, 6, '#c084fc', 90, 2);
      if (!t.dead) floatText(t.x, t.y - 24, '🔇 ' + def.silenceTime + 's', '#c084fc');
    }
    burst(e.x, e.y, 18, '#a855f7', 170, 2.4);
    toast('🔇 首领沉默了 ' + n + ' 座防御塔（3 秒哑火 + ' + def.silenceDamage + ' 耐久）！', 'warn');
    SFX.boom();
  }

  /* ---------- 蹦极（第三关专属）----------
   * 它**不走小路、也不会被打**，平时就待在屏幕外跳来跳去：
   *  1) 出场时随机挑一座防御塔，把靶子贴上去（靶子只是**预告落点**，没别的用）；
   *  2) bungeeDrop 秒后，从屏幕上方俯冲下来，落到那座塔身上；
   *  3) 触底那一瞬间：塔在保护伞罩子里 → 蹦极被弹飞、直接消失，塔保住；
   *     否则**整座塔被偷走**（没有返还），蹦极抓着塔再飞回屏幕外消失。 */
  const BUNGEE_IN = 0.5;                 // 俯冲下落时长（秒）
  const BUNGEE_OUT = 0.55;               // 抓着塔飞回屏幕外的时长
  const BUNGEE_SKY = -70;                // 停在场外的「空中」高度
  const BUNGEE_GIVEUP = 3;               // 场上没塔可偷时，在屏幕外等多久自己飞走

  function towerById(id) {
    for (let i = 0; i < state.towers.length; i++) {
      if (state.towers[i].id === id) return state.towers[i];
    }
    return null;
  }

  function throwAt(towerId) {
    for (let i = 0; i < state.throws.length; i++) {
      if (state.throws[i].towerId === towerId) return state.throws[i];
    }
    return null;
  }

  /** 随机挑一座能偷的塔：不是无敌设施、也没被别的蹦极盯上 */
  function randomStealTarget() {
    const pool = [];
    for (let i = 0; i < state.towers.length; i++) {
      const t = state.towers[i];
      if (t.dead || t.carried) continue;
      const td = TOWERS[t.type];
      if (td.invincible || td.isBench || td.isUmbrella) continue;   // 升级台 / 保护伞：偷不走
      if (throwAt(t.id)) continue;                                  // 已经有人盯上了
      pool.push(t);
    }
    if (!pool.length) return null;
    return pool[(Math.random() * pool.length) | 0];
  }

  function throwBungeeTarget(e, t, def) {
    e.throwFlash = 0.4;
    e.dropTowerId = t.id;
    e.dropX = t.x;
    e.dropY = t.y;
    e.x = t.x;                                  // 就从这座塔的正上方下来
    state.throws.push({
      towerId: t.id, c: t.c, r: t.r, x: t.x, y: t.y,
      t: def.bungeeDrop, total: def.bungeeDrop, from: e,
    });
    ring(t.x, t.y, 42, '#f43f5e', 0.5);
    floatText(t.x, t.y - 42, '靶子！', '#fda4af');
    SFX.shoot();
  }

  /** 保护伞弹飞：蹦极直接消失，塔保住 */
  function repelBungee(carrier, tw, um) {
    ring(tw.x, tw.y, 58, '#22c55e', 0.55);
    if (um) ring(um.x, um.y, 44, '#86efac', 0.45);
    floatText(tw.x, tw.y - 34, '弹飞！', '#86efac');
    burst(tw.x, tw.y, 14, '#86efac', 140, 2.2);
    if (carrier) { carrier.dead = true; carrier.popped = true; }
    toast('☂️ 保护伞把蹦极弹飞了！', 'good');
    SFX.build();
  }

  /** 俯冲到底的那一刻：塔在伞下就弹飞，否则整座偷走 */
  function bungeeGrab(carrier) {
    if (carrier.grabbed) return;
    carrier.grabbed = true;
    const tw = towerById(carrier.dropTowerId);
    if (!tw || tw.dead) { burst(carrier.dropX, carrier.dropY, 8, '#c084fc', 80, 2); return; }
    const um = umbrellaCovers(tw.x, tw.y);
    if (um) { repelBungee(carrier, tw, um); return; }
    stealTower(tw);
  }

  /** 把塔整座偷走（不给返还）——蹦极自己继续飞回天上去 */
  function stealTower(tw) {
    if (!tw || tw.dead) return;
    tw.dead = true;
    tw.hp = 0;
    /* 正被主角端在手上时也要一起松手，否则手上会剩一张打不动的塔贴图 */
    if (state.carry === tw) {
      tw.carried = false;
      state.carry = null;
      syncSelection(true);
    }
    const n = TOWERS[tw.type].name;
    burst(tw.x, tw.y, 22, '#c084fc', 160, 2.8);
    burst(tw.x, tw.y, 10, '#fda4af', 110, 2);
    ring(tw.x, tw.y, 54, '#a855f7', 0.6);
    floatText(tw.x, tw.y - 26, n + '被偷走！', '#fca5a5');
    toast('🪤 蹦极把一座' + n + '偷走了！', 'warn');
    SFX.boom();
    if (state.selectedTower === tw) {
      state.selectedTower = null;
      syncSelection(true);
    }
    bgDirty = true;
  }

  /** 每帧推进靶子倒计时：到点就让蹦极开始俯冲 */
  function updateThrows(dt) {
    if (!state.throws.length) return;
    for (let i = state.throws.length - 1; i >= 0; i--) {
      const th = state.throws[i];
      const carrier = th.from;
      if (!carrier || carrier.dead) { state.throws.splice(i, 1); continue; }
      const tw = towerById(th.towerId);
      if (!tw || tw.dead) { state.throws.splice(i, 1); continue; }   // 塔先没了，靶子作废
      th.t -= dt;
      if (th.t > 0) continue;
      state.throws.splice(i, 1);
      carrier.diveT = 0;                       // 开始往下冲
      carrier.grabbed = false;
      ring(tw.x, tw.y, 46, '#c084fc', 0.5);
    }
  }

  /** 蹦极在场外的悬停 / 俯冲 / 飞走，全部由这里推进（不走路） */
  function updateBungee(e, dt) {
    e.x = e.dropX || e.x;
    if (e.diveT < 0) {                          // 还在天上等着
      if (!e.dropTowerId) {
        const tw = randomStealTarget();
        if (tw) throwBungeeTarget(e, tw, ENEMIES[e.type]);
        else { e.giveUp -= dt; if (e.giveUp <= 0) e.dead = true; }
        return;
      }
      if (!towerById(e.dropTowerId)) { e.dead = true; return; }   // 靶子作废，白跑一趟
      return;
    }
    /* 俯冲：先落到塔上，抓一下，再飞回去 */
    e.diveT += dt;
    const baseY = e.dropY - 10;
    if (e.diveT < BUNGEE_IN) {
      e.y = BUNGEE_SKY + (baseY - BUNGEE_SKY) * (e.diveT / BUNGEE_IN);
    } else {
      if (!e.grabbed) bungeeGrab(e);
      if (e.dead) return;                       // 被伞弹飞：当场消失
      const k = Math.min(1, (e.diveT - BUNGEE_IN) / BUNGEE_OUT);
      e.y = baseY + (BUNGEE_SKY - baseY) * k;
      if (k >= 1) e.dead = true;                // 飞回屏幕外，收工
    }
  }

  /* 督军：把前方最近的两个敌人往前推 */
  function alliesAhead(e, range) {
    let hasAlly = false, hasAhead = false;
    for (let i = 0; i < state.enemies.length; i++) {
      const o = state.enemies[i];
      if (o === e || o.dead || o.route !== e.route) continue;
      hasAlly = true;
      const d = o.dist - e.dist;
      if (d > 0 && d <= range) hasAhead = true;
    }
    return { hasAlly: hasAlly, hasAhead: hasAhead };
  }

  function pushAllies(e, def) {
    const cands = [];
    for (let i = 0; i < state.enemies.length; i++) {
      const o = state.enemies[i];
      if (o === e || o.dead || o.route !== e.route) continue;
      const ahead = o.dist - e.dist;
      if (ahead <= 0 || ahead > def.pushRange) continue;
      cands.push(o);
    }
    if (!cands.length) return;
    cands.sort(function (a, b) { return a.dist - b.dist; });
    let n = 0;
    for (let i = 0; i < cands.length && n < def.pushCount; i++) {
      const o = cands[i];
      const cap = (o.route === ROUTE_MAIN ? GOAL_DIST : o.route.len) - 6;
      if (o.dist >= cap) continue;
      o.dist = Math.min(cap, o.dist + def.pushAmount);
      o.hit = 0.12;
      burst(o.x, o.y, 7, '#14b8a6', 110, 2.2);
      floatText(o.x, o.y - o.r - 8, '推进 +' + def.pushAmount, '#5eead4');
      n++;
    }
    if (n) {
      e.pushFlash = 0.4;
      ring(e.x, e.y, def.pushRange * 0.45, '#14b8a6', 0.4);
    }
  }

  function leak(e) {
    e.dead = true;
    const cost = e.leakCost || 1;
    state.lives -= cost;
    state.flash = Math.min(0.9, 0.4 + cost * 0.12);
    SFX.hurt();
    toast('敌人突破防线！ -' + cost + ' ❤️', 'warn');
    if (state.lives <= 0) {
      state.lives = 0;
      endGame(false, 'base');
    }
  }

  function endGame(win, reason) {
    state.phase = win ? 'won' : 'lost';
    state.selectedTower = null;
    state.marked = null;
    state.mouse.down = false;
    state.carry = null;
    closeBuild();
    closeLevelMenu();
    syncSelection(true);
    if (win) SFX.win(); else SFX.lose();

    let extra = '';
    if (win && state.level === 1) {
      /* 通关第一关：掉落钩索 */
      const first = !save.hook;
      save.hook = true;
      writeSave(save);
      state.hookUnlocked = true;
      extra = first
        ? ' 🪝 通关奖励：钩索掉落！它已装进你的行囊，第二关可以用。'
        : ' 🪝 钩索已装备，随时可以进入第二关。';
    } else if (win && state.level === 2) {
      /* 通关第二关：解锁第三关 */
      const first = !save.lv3;
      save.lv3 = true;
      writeSave(save);
      extra = first
        ? ' 🏆 第三关解锁！下一关有会偷塔的蹦极，记得带上保护伞。'
        : ' 🏆 第三关已解锁，随时可以继续。';
    } else if (win && state.level === 3) {
      extra = ' 🏆 三关全通，绿野彻底安宁了。';
    }

    const ov = document.getElementById('overlay');
    const title = document.getElementById('ovTitle');
    title.textContent = win ? '🎉 防线守住了！' : (reason === 'hero' ? '💀 主角倒下了' : '💀 防线崩溃');
    title.className = win ? 'win' : 'lose';
    document.getElementById('ovText').textContent = (win
      ? '你击退了' + LEVEL_SETUP[state.levelIdx].name + '的全部 ' + WAVES.length + ' 波敌人。'
      : (reason === 'hero'
        ? '主角被怪撞倒了。别站在小路上硬扛——被撞会掉血，但也别怕，怪会被弹回去一段。'
        : '基地被攻破了。再试一次吧——别忘了冰塔可以拖住敌人。')) + extra;
    document.getElementById('ovStats').innerHTML =
      '<div><b>' + state.waveIndex + '/' + WAVES.length + '</b><span>通过波次</span></div>' +
      '<div><b>' + state.kills + '</b><span>击杀数</span></div>' +
      '<div><b>' + state.lives + '</b><span>剩余生命</span></div>' +
      '<div><b>' + Math.ceil(state.hero.hp) + '/' + state.hero.hpMax + '</b><span>主角血量</span></div>';
    /* 通关时，结算面板上多一个「进入下一关」按钮 */
    const nextBtn = document.getElementById('btnNextLevel');
    if (nextBtn) {
      const canNext = win && state.level < 3;
      nextBtn.classList.toggle('hidden', !canNext);
      if (canNext) {
        nextBtn.textContent = state.level === 1
          ? '🪝 带着钩索进入第二关'
          : '🪤 进入第三关 · 浮桥水镇';
      }
    }
    ov.classList.remove('hidden');
  }

  /* ============================================================
   * 7. 更新逻辑
   * ============================================================ */
  function dist2(ax, ay, bx, by) {
    const dx = ax - bx, dy = ay - by;
    return dx * dx + dy * dy;
  }

  /* 选目标：默认打「走得最远」的敌人；
   * 炮塔会被附近的诱饵吸引（只在诱饵的嘲讽半径内生效），从而浪费炮弹 */
  function findTarget(t, range) {
    const r2 = range * range;
    const taunted = TOWERS[t.type].taunted;
    let best = null, bestD = -1;
    let lure = null, lureD = -1;
    for (let i = 0; i < state.enemies.length; i++) {
      const e = state.enemies[i];
      if (e.dead) continue;
      if (e.noHit) continue;              // 蹦极吊下来那段无敌，塔别把火力浪费在它身上
      const d2 = dist2(t.x, t.y, e.x, e.y);
      if (d2 > r2) continue;
      const def = ENEMIES[e.type];
      const prog = progressOf(e);
      if (def.taunt) {
        /* 只在「附近」才吸走火力 */
        if (taunted && d2 <= def.tauntRadius * def.tauntRadius && prog > lureD) {
          lureD = prog; lure = e;
        }
        if (prog > bestD) { bestD = prog; best = e; }
        continue;
      }
      if (prog > bestD) { bestD = prog; best = e; }
    }
    return lure || best;
  }

  function turnTo(cur, want, step) {
    let d = want - cur;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    if (Math.abs(d) <= step) return want;
    return cur + Math.sign(d) * step;
  }

  function fire(t, st, target) {
    const def = TOWERS[t.type];
    const mx = t.x + Math.cos(t.angle) * 15;
    const my = t.y + Math.sin(t.angle) * 15;
    state.shots.push({
      kind: def.proj, x: mx, y: my, tx: target.x, ty: target.y, target: target,
      speed: def.projSpeed, damage: st.damage, splash: st.splash || 0,
      slow: st.slow || 0, slowTime: st.slowTime || 0, freeze: st.freeze || 0, owner: t,
      color: def.body, angle: t.angle, life: 4,
    });
    t.recoil = 1;
    burst(mx, my, 3, def.body, 70, 1.6);
    if (def.proj === 'arrow') SFX.shoot();
    else if (def.proj === 'shell') SFX.boom();
    else SFX.ice();
  }

  /* 屠戮者的血剑：从附近某只小怪身上凝出，方向在生成瞬间锁死（提示线画的就是这条） */
  function launchSword(e, def) {
    const h = state.hero;
    let ax = e.x, ay = e.y;
    for (let i = 0; i < 6; i++) {
      const o = state.enemies[(Math.random() * state.enemies.length) | 0];
      if (!o || o.dead || o.noHit) continue;
      if (dist2(o.x, o.y, h.x, h.y) > 460 * 460) continue;
      ax = o.x; ay = o.y;
      break;
    }
    const dx = h.x - ax, dy = h.y - ay;
    const d = Math.hypot(dx, dy) || 1;
    state.swords.push({
      x: ax, y: ay, ux: dx / d, uy: dy / d,
      t: 0, delay: def.swordDelay, speed: def.swordSpeed,
      damage: Math.max(1, Math.round(h.hpMax * (def.swordRatio || 0.25))), hit: false,
    });
    e.swordFlash = 0.45;
    ring(ax, ay, 26, '#f43f5e', 0.4);
    floatText(ax, ay - 32, '血剑！', '#fda4af');
    SFX.shoot();
  }

  /* ---- 第一关通关的钩爪：从最后一只怪身上掉下来，玩家捡走才切第二关 ---- */
  let hookGoPending = false;

  function takeHookDrop() {
    const d = state.hookDrop;
    if (!d) return;
    state.hookDrop = null;
    save.hook = true;
    writeSave(save);
    state.hookUnlocked = true;
    state.hookTaken = 1.9;                 // 横幅停留一会儿再切关
    ring(d.x, d.y, 46, '#fbbf24', 0.5);
    burst(d.x, d.y, 28, '#fbbf24', 160, 2.8);
    floatText(d.x, d.y - 26, '获得 钩锁', '#fde68a');
    SFX.win();
    toast('🪝 获得 钩锁！第二关「双子回廊」已解锁', 'gold');
  }

  function updateHookDrop(dt) {
    if (hookGoPending) {
      hookGoPending = false;
      chooseLevel(1);                      // 下一帧开头切关，别在 update 中途换掉整局状态
      return true;
    }
    const d = state.hookDrop;
    if (d) {
      d.spin += dt;
      if (dist2(state.hero.x, state.hero.y, d.x, d.y) < 34 * 34) takeHookDrop();
    }
    if (state.hookTaken > 0) {
      state.hookTaken -= dt;
      if (state.hookTaken <= 0) { state.hookTaken = 0; hookGoPending = true; }
    }
    return false;
  }

  function update(dt) {
    /* --- 第一关掉在地上的钩爪（捡到后这一帧就切到第二关） --- */
    if (updateHookDrop(dt)) return;
    /* --- 新手提示 / 新敌人说明卡片 --- */
    updateHints(dt);
    updateEnemyPopup(dt);

    /* --- 主角 --- */
    updateHero(dt);

    /* --- 钩索：冲刺位移 + 勾住敌人持续伤害 --- */
    updateHook(dt);

    /* --- 准备阶段：倒计时自动开波 --- */
    if (state.phase === 'prep') {
      state.countdown -= dt;
      if (state.countdown <= 0) {
        state.countdown = 0;
        startWave(false);
      }
    }

    /* 炸弹冷却 */
    if (state.bombCd > 0) {
      state.bombCd = Math.max(0, state.bombCd - dt);
      if (state.bombCd === 0) {
        floatText(state.hero.x, state.hero.y - 38, '炸弹就绪', '#fde68a');
        ring(state.hero.x, state.hero.y, 30, '#fde68a', 0.35);
      }
    }

    /* --- 出怪 --- */
    if (state.phase === 'battle') {
      state.battleTime += dt;
      while (state.spawnQueue.length && state.spawnQueue[0].t <= state.battleTime) {
        const sp = state.spawnQueue.shift();
        spawnEnemy(sp.type, state.waveIndex, undefined, sp.lane);
      }
    }

    /* --- 敌人移动与特殊能力 --- */
    for (let i = 0; i < state.enemies.length; i++) {
      const e = state.enemies[i];
      if (e.dead) continue;
      const def = ENEMIES[e.type];
      /* 冰冻：slowK=0 → 一步也不走，普攻/推人/扔石头/治疗/召唤/沉默全部停表。
       * （减速的老逻辑保留在这里，冰塔现在已经不用减速了） */
      if (e.freezeT > 0) e.freezeT -= dt;
      const slowK = e.freezeT > 0 ? 0 : (e.slowT > 0 ? (1 - e.slow) : 1);
      if (e.slowT > 0) e.slowT -= dt;
      if (e.hit > 0) e.hit -= dt;
      if (e.pulse > 0) e.pulse -= dt;
      if (e.touchCd > 0) e.touchCd -= dt;

      /* 护盾脱战回充 */
      if (e.shieldMax > 0 && e.shield < e.shieldMax) {
        if (e.shieldTimer > 0) e.shieldTimer -= dt;
        else e.shield = Math.min(e.shieldMax, e.shield + def.shieldRegen * dt);
      }
      /* 战地医师治疗 */
      if (def.healRadius) {
        e.healCd -= dt * slowK;
        if (e.healCd <= 0) { e.healCd = def.healEvery; healAllies(e, def); }
      }
      /* 首领召唤 */
      if (def.summonEvery) {
        e.summonCd -= dt * slowK;
        if (e.summonCd <= 0) { e.summonCd = def.summonEvery; summonMinions(e, def); }
      }
      /* 首领沉默波 */
      if (def.silenceEvery) {
        e.silenceCd -= dt * slowK;
        if (e.silenceCd <= 0) { e.silenceCd = def.silenceEvery; bossSilence(e, def); }
      }
      if (e.silencePulse > 0) e.silencePulse -= dt;

      /* 蹦极：不走路、只在场外悬停 / 俯冲 / 飞走 */
      if (e.flying) {
        if (e.bungeeFlash > 0) e.bungeeFlash -= dt;
        updateBungee(e, dt);
        continue;
      }

      /* 拆塔者：边走边拆，同时攻击范围内所有的防御塔 */
      if (def.attackRange) {
        e.targets = towersInRange(e, def.attackRange);
        if (e.atkFlash > 0) e.atkFlash -= dt;
        if (e.targets.length) {
          e.atkCd -= dt * slowK;                 // 被减速时拆得也慢
          if (e.atkCd <= 0) {
            e.atkCd = def.attackEvery;
            e.atkFlash = 0.22;
            for (let ti = 0; ti < e.targets.length; ti++) {
              const tw = e.targets[ti];
              damageTower(tw, Math.round(def.attackDamage * (state.sabScale || 1)));
              burst(tw.x, tw.y, 4, '#f97316', 90, 2);
            }
          }
        } else if (e.atkCd > 0.25) {
          e.atkCd = 0.25;                        // 没目标时快速就绪，进入射程立刻开拆
        }
        /* 注意：这里不再 continue —— 拆塔的同时继续前进 */
      }

      /* 督军：推前面的怪；前方没人时放慢等队伍 */
      let speedK = 1;
      if (def.pushEvery) {
        if (e.pushFlash > 0) e.pushFlash -= dt;
        e.pushCd -= dt * slowK;
        if (e.pushCd <= 0) {
          e.pushCd = def.pushEvery;
          pushAllies(e, def);
        }
        const around = alliesAhead(e, def.pushRange * 1.3);
        if (around.hasAlly && !around.hasAhead) speedK = 0.42;
      }

      /* 投石者：朝主角当前位置扔石头（只砸主角，不伤塔）
       * 全局节流：任意两块石头之间至少隔 ROCK_GAP 秒，避免多个投石者叠成「落石雨」 */
      if (def.throwEvery) {
        if (e.throwFlash > 0) e.throwFlash -= dt;
        if (e.throwCd > 0) e.throwCd -= dt * slowK;
        if (e.throwCd <= 0 && state.rockCd <= 0 && state.rocks.length < 3 &&
            dist2(e.x, e.y, state.hero.x, state.hero.y) <= def.throwRange * def.throwRange) {
          e.throwCd = def.throwEvery;
          state.rockCd = ROCK_GAP;
          e.throwFlash = 0.35;
          state.rocks.push({
            x: state.hero.x, y: state.hero.y, t: 0, delay: def.throwDelay,
            r: def.throwRadius,
            damage: Math.max(1, Math.round(state.hero.hpMax * def.throwRatio)),
            from: e,
          });
        }
      }

      /* 屠戮者：隔一段时间在小怪身上凝出一把血剑，蓄力 1 秒后朝主角方向直刺出去 */
      if (def.swordEvery) {
        if (e.swordFlash > 0) e.swordFlash -= dt;
        if (e.swordCd > 0) e.swordCd -= dt * slowK;
        if (e.swordCd <= 0 &&
            dist2(e.x, e.y, state.hero.x, state.hero.y) <= def.swordRange * def.swordRange) {
          e.swordCd = def.swordEvery;
          launchSword(e, def);
        }
      }

      /* 诱饵：不走小路，直线抄近路冲向基地 */
      if (def.free) {
        const dx = e.goalX - e.x, dy = e.goalY - e.y;
        const d = Math.hypot(dx, dy);
        const move = e.speed * slowK * dt;
        if (d <= Math.max(move, 18)) { leak(e); continue; }
        e.x += dx / d * move;
        e.y += dy / d * move;
        e.angle = Math.atan2(dy, dx);
        e.dist += move;
        continue;
      }

      e.dist += e.speed * speedK * slowK * dt;
      /* 支路走完就并入主路，进度保持连续 */
      if (e.route !== ROUTE_MAIN && e.dist >= e.route.len) {
        const r = e.route;
        e.dist = r.mergeDist + (e.dist - r.len);
        e.route = ROUTE_MAIN;
        e.lane = 'main';
      }
      const p = posAt(e.route, e.dist);
      e.angle = p.angle;
      e.x = p.x;
      e.y = p.y;
      if (e.route === ROUTE_MAIN && e.dist >= GOAL_DIST) leak(e);
    }

    /* --- 怪撞主角：主角掉血，怪被弹回去 --- */
    enemyTouchHero();

    /* --- 杀戮光环：站在光环里的主角持续掉血（对防御塔零伤害） --- */
    let inAura = false, auraDef = null;
    for (let i = 0; i < state.enemies.length; i++) {
      const e = state.enemies[i];
      if (e.dead) continue;
      const d = ENEMIES[e.type];
      if (!d.auraRadius) continue;
      if (dist2(e.x, e.y, state.hero.x, state.hero.y) <= d.auraRadius * d.auraRadius) {
        inAura = true; auraDef = d; break;
      }
    }
    state.heroInAura = inAura;
    if (inAura) {
      state.auraTick -= dt;
      if (state.auraTick <= 0) {
        state.auraTick = 0.5;
        hurtHero(Math.max(1, Math.round(auraDef.auraDps * 0.5)), true);
      }
    } else {
      state.auraTick = 0;
    }

    /* --- 处理本帧新增的分裂怪 / 召唤物 --- */
    if (state.pending.length) {
      for (let i = 0; i < state.pending.length; i++) {
        const s = state.pending[i];
        spawnEnemy(s.type, s.wave, s.dist, s.lane);
      }
      state.pending.length = 0;
    }

    /* --- 防御塔开火 --- */
    for (let i = 0; i < state.towers.length; i++) {
      const t = state.towers[i];
      if (t.dead) continue;
      if (t.carried) {                      // 被端在手上：跟着主角走，不攻击也不自修
        t.x = state.hero.x;
        t.y = state.hero.y - 30;
        t.angle += dt * 2;
        continue;
      }
      const st = statsOf(t);
      if (t.cd > 0) t.cd -= dt;
      if (t.silence > 0) t.silence = Math.max(0, t.silence - dt);   // 被首领沉默：倒计时结束才能再开火
      if (t.silenceFlash > 0) t.silenceFlash -= dt;
      if (t.recoil > 0) t.recoil = Math.max(0, t.recoil - dt * 5);
      if (t.shake > 0) t.shake = Math.max(0, t.shake - dt * 2.5);

      /* --- 升级台：不攻击、不自修，只等钩索来端 --- */
      const bdef = TOWERS[t.type];
      if (bdef.isBench) {
        t.hurtT += dt;
        continue;
      }

      /* 脱离火力 5 秒后自行修复 */
      t.hurtT += dt;
      if (t.hurtT > 5 && t.hp < t.hpMax) {
        t.hp = Math.min(t.hpMax, t.hp + 14 * dt);
      }
      const target = findTarget(t, st.range);
      if (!target) continue;
      t.angle = turnTo(t.angle, Math.atan2(target.y - t.y, target.x - t.x), dt * 9);
      if (t.cd <= 0 && !(t.silence > 0)) {          // 沉默期间照样瞄准，但打不出来
        fire(t, st, target);
        t.cd = 1 / st.rate;
      }
    }

    /* --- 子弹 --- */
    for (let i = state.shots.length - 1; i >= 0; i--) {
      const s = state.shots[i];
      s.life -= dt;

      /* 主角的直线弹道：命中第一个敌人，不追踪；学会「贯穿箭」后可以继续穿透 */
      if (s.kind === 'bolt') {
        s.x += s.vx * dt;
        s.y += s.vy * dt;
        s.travel += Math.hypot(s.vx, s.vy) * dt;
        let hit = null;
        for (let j = 0; j < state.enemies.length; j++) {
          const e = state.enemies[j];
          if (e.dead || e.noHit) continue;      // 吊下来的蹦极无敌，箭直接穿过去
          if (s.hitSet && s.hitSet.indexOf(e) >= 0) continue;
          const rr2 = (e.r + 5) * (e.r + 5);
          if (dist2(s.x, s.y, e.x, e.y) <= rr2) { hit = e; break; }
        }
        if (hit) {
          damageEnemy(hit, s.damage, null, s.pierce);
          burst(s.x, s.y, 6, '#fde68a', 90, 2);
          if (s.pierceLeft > 0) {
            s.pierceLeft--;
            if (!s.hitSet) s.hitSet = [];
            s.hitSet.push(hit);
          } else {
            state.shots.splice(i, 1);
            continue;
          }
        }
        if (s.travel >= s.range || s.life <= 0 || s.x < -20 || s.x > W + 20 || s.y < -20 || s.y > H + 20) {
          state.shots.splice(i, 1);
        }
        continue;
      }

      if (s.target && !s.target.dead) {
        s.tx = s.target.x + Math.cos(s.target.angle + Math.PI / 2) * s.target.off;
        s.ty = s.target.y + Math.sin(s.target.angle + Math.PI / 2) * s.target.off;
      }
      const dx = s.tx - s.x, dy = s.ty - s.y;
      const d = Math.hypot(dx, dy);
      const move = s.speed * dt;
      if (d <= move || s.life <= 0) {
        s.x = s.tx; s.y = s.ty;
        onHit(s);
        state.shots.splice(i, 1);
        continue;
      }
      s.x += dx / d * move;
      s.y += dy / d * move;
      s.angle = Math.atan2(dy, dx);
    }

    /* --- 落石：只砸主角，不伤防御塔 --- */
    for (let i = state.rocks.length - 1; i >= 0; i--) {
      const rk = state.rocks[i];
      rk.t += dt;
      if (rk.t >= rk.delay) {
        const hh = state.hero;
        const hitHero = dist2(rk.x, rk.y, hh.x, hh.y) <= (rk.r + hh.r) * (rk.r + hh.r);
        if (hitHero) hurtHero(rk.damage);
        burst(rk.x, rk.y, 22, '#d6d3d1', 190, 3.4);
        burst(rk.x, rk.y, 12, '#f97316', 140, 2.6);
        ring(rk.x, rk.y, rk.r + 28, '#f97316', 0.45);
        ring(rk.x, rk.y, rk.r + 10, 'rgba(255,255,255,0.9)', 0.3);
        floatText(rk.x, rk.y - 20, hitHero ? '被砸中！' : '落空', hitHero ? '#f87171' : '#94a3b8');
        state.flash = Math.min(0.7, hitHero ? 0.38 : 0.14);
        SFX.boom();
        state.rocks.splice(i, 1);
      }
    }

    /* --- 血剑：蓄力 1 秒（画轨迹提示）→ 沿轨迹高速直刺 → 飞出屏幕消失 --- */
    for (let i = state.swords.length - 1; i >= 0; i--) {
      const sw = state.swords[i];
      sw.t += dt;
      if (sw.t < sw.delay) continue;                 // 还在蓄力：只画提示
      const step = sw.speed * dt;
      sw.x += sw.ux * step;
      sw.y += sw.uy * step;
      if (!sw.hit) {
        const hh = state.hero;
        /* 位移途中（钩索冲刺）不挨这一剑，和撞怪的口径保持一致 */
        if (!hookMoving() && dist2(sw.x, sw.y, hh.x, hh.y) <= (14 + hh.r) * (14 + hh.r)) {
          sw.hit = true;
          hurtHero(sw.damage);
          burst(sw.x, sw.y, 12, '#fda4af', 160, 2.6);
        }
      }
      if (sw.x < -60 || sw.x > W + 60 || sw.y < -60 || sw.y > H + 60) state.swords.splice(i, 1);
    }

    /* --- 粒子与飘字 --- */
    for (let i = state.bits.length - 1; i >= 0; i--) {
      const b = state.bits[i];
      b.life -= dt;
      if (b.kind === 'dot') {
        b.x += b.vx * dt; b.y += b.vy * dt;
        b.vx *= 0.94; b.vy *= 0.94;
      } else {
        b.r += (b.max - b.r) * Math.min(1, dt * 8);
      }
      if (b.life <= 0) state.bits.splice(i, 1);
    }
    for (let i = state.texts.length - 1; i >= 0; i--) {
      const ft = state.texts[i];
      ft.life -= dt;
      ft.y -= dt * 26;
      if (ft.life <= 0) state.texts.splice(i, 1);
    }

    /* --- 蹦极扔在塔上的靶子：倒计时到了就落地判一次 --- */
    updateThrows(dt);

    /* --- 清理死亡敌人与被拆毁的塔 --- */
    if (state.enemies.some(function (e) { return e.dead; })) {
      state.enemies = state.enemies.filter(function (e) { return !e.dead; });
    }
    if (state.towers.some(function (t) { return t.dead; })) {
      state.towers = state.towers.filter(function (t) { return !t.dead; });
    }

    if (state.flash > 0) state.flash = Math.max(0, state.flash - dt * 1.6);
    for (let i = 0; i < SUB_LANES.length; i++) {
      const k = SUB_LANES[i].key;
      if (state.laneFlash[k] > 0) state.laneFlash[k] = Math.max(0, state.laneFlash[k] - dt);
    }
    if (state.rockCd > 0) state.rockCd = Math.max(0, state.rockCd - dt);

    /* --- 本波结束判定 --- */
    if (state.phase === 'battle' && state.spawnQueue.length === 0 && state.enemies.length === 0) {
      /* 第一关的最后一波清完：先不弹结算，从最后一只怪身上掉一把钩爪；
         玩家用左键（或走过去）把它捡起来，才解锁第二关并自动切过去。 */
      if (state.level === 1 && state.waveIndex + 1 >= WAVES.length) {
        const at = state.lastKill || { x: GOAL.x - 30, y: GOAL.y - 30 };
        state.hookDrop = { x: at.x, y: at.y, spin: 0 };
        state.phase = 'pickup';
        state.mouse.down = false;
        SFX.win();
        toast('🪝 最后一只怪掉了一把钩爪——左键点它捡起来', 'gold');
        return;
      }
      const reward = 34 + (state.waveIndex + 1) * 10;
      state.money += reward;
      const cleared = state.waveIndex + 1;
      state.waveIndex++;
      /* 首领波额外奖励一颗炸弹（哪一波有首领就给，第三关 20 波共 3 个首领波） */
      const clearedWave = WAVES[cleared - 1] || [];
      const hadBoss = clearedWave.some(function (g) { return g.type === 'boss'; });
      if (hadBoss) {
        if (state.bombs < BOMB_MAX) { state.bombs++; toast('首领波奖励：+1 颗炸弹', 'gold'); }
        else { state.money += 100; toast('炸弹已满，折算 +100 金币', 'gold'); }
      }
      if (state.waveIndex >= WAVES.length) {
        endGame(true);
      } else {
        state.phase = 'prep';
        state.countdown = PREP_TIME;
        toast('第 ' + cleared + ' 波清除！+' + reward + ' 金币', 'gold');
        spawnBench();                     // 第二关：每波清完在交付台刷一个升级台
      }
    }
  }

  function onHit(s) {
    if (s.splash > 0) {
      for (let i = 0; i < state.enemies.length; i++) {
        const e = state.enemies[i];
        if (e.dead) continue;
        const d = Math.hypot(e.x - s.tx, e.y - s.ty);
        if (d <= s.splash) damageEnemy(e, s.damage * (1 - 0.35 * (d / s.splash)), s.owner);
      }
      ring(s.tx, s.ty, s.splash, '#fb923c', 0.34);
      burst(s.tx, s.ty, 12, '#fb923c', 130, 2.4);
      SFX.boom();
    } else if (s.target && !s.target.dead) {
      damageEnemy(s.target, s.damage, s.owner);
      /* 冰冻：单体定身。首领免疫（不然 LV5 冰塔能把首领永久锁死） */
      if (s.freeze > 0 && s.target.type !== 'boss') {
        s.target.freezeT = Math.max(s.target.freezeT || 0, s.freeze);
      }
      if (s.slow > 0) {
        s.target.slow = Math.max(s.target.slow, s.slow);
        s.target.slowT = Math.max(s.target.slowT, s.slowTime);
      }
      burst(s.tx, s.ty, 4, s.color, 70, 1.6);
    }
  }

  /* ============================================================
   * 8. 绘制
   * ============================================================ */
  function rr(x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function drawGround() {
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#37704a');
    g.addColorStop(1, '#28563a');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    ctx.fillStyle = 'rgba(255,255,255,0.028)';
    for (let c = 0; c < COLS; c++) {
      for (let r = 0; r < ROWS; r++) {
        if ((c + r) % 2 === 0) ctx.fillRect(c * TILE, r * TILE, TILE, TILE);
      }
    }
  }

  function pathStroke(route, width, color, dash) {
    const pts = route.pts;
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
    ctx.lineWidth = width;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = color;
    if (dash) ctx.setLineDash(dash);
    ctx.stroke();
    if (dash) ctx.setLineDash([]);
  }

  /* 支路入口标记：进场点在画面外，所以把标记挪到画面边缘。
   * 会闪烁，所以每帧重画，不进静态缓存 */
  function drawLaneMarkers() {
    for (let i = 0; i < SUB_LANES.length; i++) {
      const L = SUB_LANES[i], open = state.laneOpen[L.key];
      const p0 = L.route.pts[0];
      const sx = Math.max(26, Math.min(W - 26, p0.x));
      const sy = p0.y < 0 ? 30 : (p0.y > H ? H - 30 : p0.y);
      ctx.save();
      ctx.strokeStyle = open ? 'rgba(248,113,113,0.95)' : 'rgba(248,113,113,0.4)';
      ctx.lineWidth = 2;
      ctx.setLineDash([5, 5]);
      ctx.beginPath(); ctx.arc(sx, sy, 17, 0, Math.PI * 2); ctx.stroke();
      ctx.restore();
      ctx.save();
      ctx.textAlign = 'center';
      ctx.font = 'bold 11px system-ui, "PingFang SC", sans-serif';
      const above = sy < H / 2;
      const ty = above ? sy + 44 : sy - 44;
      if (open) {
        ctx.fillStyle = 'rgba(248,113,113,' + (0.7 + 0.3 * Math.sin(performance.now() / 200)) + ')';
        ctx.fillText('新出怪点', sx, ty);
        ctx.fillStyle = 'rgba(255,255,255,0.8)';
        const dir = above ? 1 : -1;
        ctx.beginPath();
        ctx.moveTo(sx - 7, sy + dir * 22); ctx.lineTo(sx + 7, sy + dir * 22); ctx.lineTo(sx, sy + dir * 34);
        ctx.closePath(); ctx.fill();
      } else {
        ctx.fillStyle = 'rgba(255,255,255,0.35)';
        ctx.fillText('未通', sx, ty);
        ctx.font = 'bold 14px system-ui, sans-serif';
        ctx.fillText('?', sx, sy + 5);
      }
      ctx.restore();
    }
  }

  /** 河：一条南北向的水带（静态层，画在道路下面） */
  function drawRiver() {
    if (!RIVER || !RIVER.length) return;
    ctx.save();
    /* 水面：按矩形整块填渐变（块与块之间不留缝，第三关的 Z 形河才连得上） */
    for (let i = 0; i < RIVER.length; i++) {
      const w = RIVER[i];
      const x1 = w.c1 * TILE, x2 = (w.c2 + 1) * TILE;
      const y1 = w.r1 * TILE, y2 = (w.r2 + 1) * TILE;
      const g = ctx.createLinearGradient(x1, y1, x2, y2);
      g.addColorStop(0, '#16465f');
      g.addColorStop(0.5, '#2a7196');
      g.addColorStop(1, '#16465f');
      ctx.fillStyle = g;
      ctx.fillRect(x1, y1, x2 - x1, y2 - y1);
    }
    /* 水波：一格两道小弧，网格化了也看不出接缝 */
    ctx.strokeStyle = 'rgba(255,255,255,0.14)';
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        if (!isWater(c, r)) continue;
        const cx = c * TILE + TILE / 2, cy = r * TILE + TILE / 2;
        ctx.beginPath();
        ctx.moveTo(cx - 14, cy - 7);
        ctx.quadraticCurveTo(cx - 7, cy - 12, cx, cy - 7);
        ctx.quadraticCurveTo(cx + 7, cy - 2, cx + 14, cy - 7);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(cx - 12, cy + 10);
        ctx.quadraticCurveTo(cx - 6, cy + 5, cx, cy + 10);
        ctx.quadraticCurveTo(cx + 6, cy + 15, cx + 12, cy + 10);
        ctx.stroke();
      }
    }
    /* 岸线：只压在水与陆地交界的那一条边 */
    ctx.fillStyle = 'rgba(0,0,0,0.22)';
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        if (!isWater(c, r)) continue;
        const x = c * TILE, y = r * TILE;
        if (!isWater(c, r - 1)) ctx.fillRect(x, y, TILE, 3);
        if (!isWater(c, r + 1)) ctx.fillRect(x, y + TILE - 3, TILE, 3);
        if (!isWater(c - 1, r)) ctx.fillRect(x, y, 3, TILE);
        if (!isWater(c + 1, r)) ctx.fillRect(x + TILE - 3, y, 3, TILE);
      }
    }
    ctx.restore();
  }


  /** 桥：路压在水面上的那几格，画成木板桥面 + 栏杆 */
  function drawBridges() {
    if (!BRIDGE.length) return;
    for (let i = 0; i < BRIDGE.length; i++) {
      const b = BRIDGE[i];
      const x = b.c * TILE, y = b.r * TILE;
      ctx.save();
      ctx.fillStyle = '#7c4a21';
      ctx.fillRect(x + 1, y, TILE - 2, TILE);
      ctx.fillStyle = '#a9713a';
      ctx.fillRect(x + 4, y + 2, TILE - 8, TILE - 4);
      ctx.strokeStyle = 'rgba(0,0,0,0.24)';
      ctx.lineWidth = 1.5;
      for (let k = 1; k <= 3; k++) {
        const yy = y + k * TILE / 4;
        ctx.beginPath(); ctx.moveTo(x + 4, yy); ctx.lineTo(x + TILE - 4, yy); ctx.stroke();
      }
      /* 栏杆：只画在水那一侧 */
      ctx.fillStyle = '#5b3617';
      if (!isWater(b.c - 1, b.r)) ctx.fillRect(x + 1, y, 3, TILE);
      if (!isWater(b.c + 1, b.r)) ctx.fillRect(x + TILE - 4, y, 3, TILE);
      ctx.restore();
    }
  }

  function drawPath() {
    /* --- 支路：先画「未通」的土道，开通后变成正常路面 --- */
    for (let i = 0; i < SUB_LANES.length; i++) {
      const L = SUB_LANES[i], route = L.route, open = state.laneOpen[L.key];
      pathStroke(route, TILE * 0.9, open ? '#1f3a2a' : 'rgba(20,40,29,0.5)');
      pathStroke(route, TILE * 0.8, open ? '#6b4f30' : 'rgba(107,79,48,0.5)');
      pathStroke(route, TILE * 0.64, open ? '#c8a473' : 'rgba(200,164,115,0.42)');
      if (open) {
        pathStroke(route, TILE * 0.48, '#d8b98c');
        pathStroke(route, 3, 'rgba(255,255,255,0.22)', [9, 12]);
      } else {
        pathStroke(route, 2.5, 'rgba(255,255,255,0.3)', [6, 10]);
      }
    }

    /* --- 主路 --- */
    pathStroke(ROUTE_MAIN, TILE * 0.94, '#1f3a2a');
    pathStroke(ROUTE_MAIN, TILE * 0.86, '#6b4f30');
    pathStroke(ROUTE_MAIN, TILE * 0.7, '#c8a473');
    pathStroke(ROUTE_MAIN, TILE * 0.52, '#d8b98c');
    /* 路径中央虚线 */
    pathStroke(ROUTE_MAIN, 3, 'rgba(255,255,255,0.22)', [9, 12]);

    /* --- 主入口箭头 --- */
    const e0 = posAt(ROUTE_MAIN, 76);
    ctx.save();
    ctx.translate(e0.x - 26, e0.y);
    ctx.fillStyle = 'rgba(255,255,255,0.75)';
    ctx.beginPath();
    ctx.moveTo(0, -9); ctx.lineTo(13, 0); ctx.lineTo(0, 9);
    ctx.closePath(); ctx.fill();
    ctx.restore();

    /* --- 支路入口标记会闪，放到动态层（见 drawLaneMarkers） --- */

    /* --- 终点基地 --- */
    const gx = GOAL.x, gy = GOAL.y;
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.beginPath(); ctx.ellipse(gx, gy + 17, 22, 7, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#3f4a55';
    rr(gx - 17, gy - 24, 34, 48, 8); ctx.fill();
    ctx.fillStyle = '#59656f';
    rr(gx - 13, gy - 20, 26, 40, 6); ctx.fill();
    ctx.fillStyle = '#f87171';
    ctx.beginPath();
    ctx.moveTo(gx + 22, gy - 26); ctx.lineTo(gx + 22, gy - 6); ctx.lineTo(gx + 4, gy - 16);
    ctx.closePath(); ctx.fill();
    ctx.strokeStyle = '#cbd5e1'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(gx + 22, gy - 28); ctx.lineTo(gx + 22, gy + 12); ctx.stroke();
    ctx.restore();
  }

  function drawDecor() {
    for (let i = 0; i < DECOR.length; i++) {
      const d = DECOR[i];
      const x = d.c * TILE + TILE / 2, y = d.r * TILE + TILE / 2;
      if (towerAt(d.c, d.r)) continue;
      if (d.kind === 'bush') {
        ctx.fillStyle = 'rgba(0,0,0,0.16)';
        ctx.beginPath(); ctx.ellipse(x, y + 7, 11 * d.s, 4 * d.s, 0, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#2b5c39';
        ctx.beginPath();
        ctx.arc(x - 5 * d.s, y + 1, 6 * d.s, 0, Math.PI * 2);
        ctx.arc(x + 4 * d.s, y + 2, 5 * d.s, 0, Math.PI * 2);
        ctx.arc(x, y - 4 * d.s, 6.5 * d.s, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.08)';
        ctx.beginPath(); ctx.arc(x - 1, y - 6 * d.s, 3 * d.s, 0, Math.PI * 2); ctx.fill();
      } else {
        ctx.fillStyle = 'rgba(0,0,0,0.16)';
        ctx.beginPath(); ctx.ellipse(x, y + 5, 9 * d.s, 3.5 * d.s, 0, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#7d8a80';
        ctx.beginPath(); ctx.ellipse(x, y, 8 * d.s, 6 * d.s, 0.4, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.14)';
        ctx.beginPath(); ctx.ellipse(x - 2, y - 2, 3.5 * d.s, 2.4 * d.s, 0.4, 0, Math.PI * 2); ctx.fill();
      }
    }
  }

  function rangeCircle(x, y, r, color, fill) {
    ctx.save();
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    if (fill) { ctx.fillStyle = fill; ctx.fill(); }
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 6]);
    ctx.stroke();
    ctx.restore();
  }

  function drawTowerBody(t, ghost) {
    const def = TOWERS[t.type];
    ctx.save();
    if (!ghost && t.shake > 0) {
      const w = t.shake * 2.2;
      ctx.translate((Math.random() - 0.5) * w, (Math.random() - 0.5) * w);
    }
    if (ghost) ctx.globalAlpha = 0.72;

    /* 升级台：金色圆台 + 向上箭头 + 呼吸光圈，一眼就能认出「这是拿来升级的」 */
    if (def.isBench) {
      const pul = 0.5 + 0.5 * Math.sin(performance.now() / 320);
      ctx.save();
      const gl = ctx.createRadialGradient(t.x, t.y, 2, t.x, t.y, 34);
      gl.addColorStop(0, 'rgba(251,191,36,' + (0.42 + 0.25 * pul) + ')');
      gl.addColorStop(1, 'rgba(251,191,36,0)');
      ctx.fillStyle = gl;
      ctx.beginPath(); ctx.arc(t.x, t.y, 34, 0, Math.PI * 2); ctx.fill();
      ctx.restore();

      ctx.fillStyle = 'rgba(0,0,0,0.3)';
      ctx.beginPath(); ctx.ellipse(t.x, t.y + 13, 16, 6, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#78350f';
      ctx.beginPath(); ctx.arc(t.x, t.y, 16, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#b45309';
      ctx.beginPath(); ctx.arc(t.x, t.y, 13, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#fbbf24';
      ctx.beginPath(); ctx.arc(t.x, t.y, 10, 0, Math.PI * 2); ctx.fill();
      /* 向上的双箭头：示意「升一级」 */
      ctx.fillStyle = '#3b2408';
      ctx.beginPath();
      ctx.moveTo(t.x, t.y - 7); ctx.lineTo(t.x + 6.5, t.y + 0.5); ctx.lineTo(t.x, t.y + 0.5);
      ctx.closePath(); ctx.fill();
      ctx.beginPath();
      ctx.moveTo(t.x, t.y + 0.5); ctx.lineTo(t.x + 6.5, t.y + 8); ctx.lineTo(t.x, t.y + 8);
      ctx.closePath(); ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,' + (0.25 + 0.5 * pul) + ')';
      ctx.lineWidth = 1.6;
      ctx.beginPath(); ctx.arc(t.x, t.y, 19, 0, Math.PI * 2); ctx.stroke();
      if (state.selectedTower === t) {
        ctx.strokeStyle = 'rgba(255,255,255,0.9)';
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(t.x, t.y, 23, 0, Math.PI * 2); ctx.stroke();
      }
      ctx.restore();
      return;
    }

    /* 保护伞：一片绿叶撑在地上 + 一圈绿色覆盖范围（就是「被弹飞」的范围） */
    if (def.isUmbrella) {
      const now = performance.now();
      const pul = 0.5 + 0.5 * Math.sin(now / 360);
      /* 覆盖范围：淡绿填充 + 缓慢转的虚线圆 */
      ctx.save();
      ctx.fillStyle = 'rgba(34,197,94,0.07)';
      ctx.beginPath(); ctx.arc(t.x, t.y, UMBRELLA_R, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = 'rgba(74,222,128,' + (0.22 + 0.16 * pul) + ')';
      ctx.lineWidth = 1.6;
      ctx.setLineDash([10, 8]);
      ctx.lineDashOffset = -now / 90;
      ctx.beginPath(); ctx.arc(t.x, t.y, UMBRELLA_R, 0, Math.PI * 2); ctx.stroke();
      ctx.setLineDash([]);
      ctx.lineDashOffset = 0;
      ctx.restore();

      ctx.fillStyle = 'rgba(0,0,0,0.3)';
      ctx.beginPath(); ctx.ellipse(t.x, t.y + 13, 16, 6, 0, 0, Math.PI * 2); ctx.fill();

      if (UMBRELLA_SPRITE.ok && UMBRELLA_SPRITE.img) {
        const h = UMBRELLA_SPRITE.h;
        const w = h * (UMBRELLA_SPRITE.img.width / UMBRELLA_SPRITE.img.height);
        /* 轻轻「撑开」的呼吸：上下 1px + 轻微缩放 */
        const k = 1 + 0.03 * Math.sin(now / 380);
        ctx.save();
        ctx.translate(t.x, t.y + 9);
        ctx.scale(k, k);
        ctx.drawImage(UMBRELLA_SPRITE.img, -w / 2, -h + 9, w, h);
        ctx.restore();
      } else {
        /* 没贴图就画一把简笔伞 */
        ctx.fillStyle = '#16a34a';
        ctx.beginPath();
        ctx.arc(t.x, t.y - 2, 15, Math.PI, 0);
        ctx.closePath(); ctx.fill();
        ctx.fillStyle = '#65a30d';
        ctx.fillRect(t.x - 1.6, t.y - 2, 3.2, 12);
      }
      if (state.selectedTower === t) {
        ctx.strokeStyle = 'rgba(255,255,255,0.9)';
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(t.x, t.y, 23, 0, Math.PI * 2); ctx.stroke();
      }
      return;
    }

    ctx.fillStyle = 'rgba(0,0,0,0.28)';
    ctx.beginPath(); ctx.ellipse(t.x, t.y + 13, 16, 6, 0, 0, Math.PI * 2); ctx.fill();

    if (state.selectedTower === t) {
      ctx.strokeStyle = 'rgba(255,255,255,0.85)';
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(t.x, t.y, 19, 0, Math.PI * 2); ctx.stroke();
    }

    ctx.fillStyle = '#3d4a44';
    rr(t.x - 16, t.y - 16, 32, 32, 10); ctx.fill();
    ctx.fillStyle = '#5a6b62';
    rr(t.x - 13.5, t.y - 13.5, 27, 27, 8); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.1)';
    rr(t.x - 13.5, t.y - 13.5, 27, 10, 8); ctx.fill();

    ctx.save();
    ctx.translate(t.x, t.y);
    ctx.rotate(t.angle);
    const back = -t.recoil * 3;
    if (t.type === 'arrow') {
      ctx.fillStyle = def.body;
      rr(-7 + back, -4.5, 21, 9, 4.5); ctx.fill();
      ctx.fillStyle = '#0f2a1b';
      rr(7 + back, -2.5, 8, 5, 2.5); ctx.fill();
    } else if (t.type === 'cannon') {
      ctx.fillStyle = def.body;
      rr(-8 + back, -6, 20, 12, 5); ctx.fill();
      ctx.fillStyle = '#4a2508';
      ctx.beginPath(); ctx.arc(11 + back, 0, 6, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#20140a';
      ctx.beginPath(); ctx.arc(12 + back, 0, 3.4, 0, Math.PI * 2); ctx.fill();
    } else {
      ctx.fillStyle = def.body;
      rr(-7 + back, -5, 17, 10, 5); ctx.fill();
      ctx.fillStyle = '#dbeafe';
      ctx.beginPath();
      ctx.moveTo(10 + back, -7); ctx.lineTo(20 + back, 0); ctx.lineTo(10 + back, 7);
      ctx.closePath(); ctx.fill();
    }
    ctx.restore();

    /* 中心轴 */
    ctx.fillStyle = def.trim;
    ctx.beginPath(); ctx.arc(t.x, t.y, 7.5, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = def.body;
    ctx.beginPath(); ctx.arc(t.x, t.y, 4.6, 0, Math.PI * 2); ctx.fill();

    /* 等级圆点：格数按等级表长度来（升级台能把塔顶到 4、5 级） */
    const pips = def.levels.length;
    for (let i = 0; i < pips; i++) {
      ctx.beginPath();
      ctx.arc(t.x - (pips - 1) * 3 + i * 6, t.y + 20, 2.4, 0, Math.PI * 2);
      ctx.fillStyle = i <= t.level ? '#fbbf24' : 'rgba(255,255,255,0.25)';
      ctx.fill();
    }
    /* 被首领沉默：塔身上罩一层紫光 + 一圈虚线，头顶飘「🔇」 */
    if (t.silence > 0) {
      const pul = 0.5 + 0.5 * Math.sin(performance.now() / 90);
      ctx.save();
      ctx.globalAlpha = 0.28 + 0.18 * pul;
      ctx.fillStyle = '#7e22ce';
      ctx.beginPath(); ctx.arc(t.x, t.y, 17, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 0.85;
      ctx.strokeStyle = '#c084fc';
      ctx.lineWidth = 2;
      ctx.setLineDash([5, 4]);
      ctx.lineDashOffset = -performance.now() / 60;
      ctx.beginPath(); ctx.arc(t.x, t.y, 20, 0, Math.PI * 2); ctx.stroke();
      ctx.setLineDash([]);
      ctx.lineDashOffset = 0;
      if (t.silenceFlash > 0) {                     // 刚被打中的一下：亮环炸开
        ctx.globalAlpha = Math.min(1, t.silenceFlash * 1.6);
        ctx.strokeStyle = '#f3e8ff';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(t.x, t.y, 22 + (0.55 - t.silenceFlash) * 30, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.globalAlpha = 0.95;
      ctx.font = 'bold 12px system-ui, "Segoe UI", sans-serif';
      ctx.textAlign = 'center';
      ctx.fillStyle = '#e9d5ff';
      ctx.fillText('🔇', t.x, t.y - 22);
      ctx.textAlign = 'start';
      ctx.restore();
    }

    ctx.globalAlpha = 1;
    ctx.restore();
  }

  function drawTowers() {
    /* 被拆塔者锁定的塔画一圈红色警戒 */
    const threatened = new Set();
    for (let i = 0; i < state.enemies.length; i++) {
      const e = state.enemies[i];
      if (!e.targets) continue;
      for (let j = 0; j < e.targets.length; j++) threatened.add(e.targets[j]);
    }
    for (let i = 0; i < state.towers.length; i++) {
      const t = state.towers[i];
      if (t.carried) continue;                 // 手上的塔在 drawHook 里单独画
      if (threatened.has(t)) {
        ctx.save();
        ctx.strokeStyle = 'rgba(248,113,113,' + (0.55 + 0.35 * Math.sin(performance.now() / 120)) + ')';
        ctx.lineWidth = 2.5;
        ctx.setLineDash([5, 4]);
        ctx.beginPath(); ctx.arc(t.x, t.y, 23, 0, Math.PI * 2); ctx.stroke();
        ctx.restore();
      }
      drawTowerBody(t, false);
      /* 耐久条：受损时才显示 */
      if (t.hp < t.hpMax) {
        const ratio = Math.max(0, t.hp / t.hpMax);
        const bw = 30, bx = t.x - bw / 2, by = t.y + 25;
        ctx.fillStyle = 'rgba(0,0,0,0.6)';
        rr(bx - 1, by - 1, bw + 2, 5.5, 3); ctx.fill();
        ctx.fillStyle = ratio > 0.5 ? '#4ade80' : ratio > 0.25 ? '#fbbf24' : '#f87171';
        rr(bx, by, bw * ratio, 3.5, 2); ctx.fill();
      }
    }
  }

  /** 主角脚下的格子 + 已标记空地的九宫格高光 */
  function drawTileMarks(t) {
    const pulse = 0.55 + 0.45 * Math.sin(t / 180);

    /* 脚下的格子：淡白框 */
    const cell = heroCell();
    if (cell) {
      ctx.save();
      ctx.strokeStyle = 'rgba(255,255,255,0.35)';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([5, 4]);
      rr(cell.c * TILE + 3, cell.r * TILE + 3, TILE - 6, TILE - 6, 6);
      ctx.stroke();
      ctx.restore();
    }

    /* 已标记的空地：亮黄高光 + 建造范围提示 */
    if (state.marked) {
      const { c, r } = state.marked;
      const x = c * TILE + TILE / 2, y = r * TILE + TILE / 2;
      ctx.save();
      ctx.fillStyle = 'rgba(253,224,71,' + (0.14 + 0.12 * pulse) + ')';
      rr(c * TILE + 1.5, r * TILE + 1.5, TILE - 3, TILE - 3, 7);
      ctx.fill();
      ctx.strokeStyle = 'rgba(253,224,71,' + (0.7 + 0.3 * pulse) + ')';
      ctx.lineWidth = 2.5;
      ctx.stroke();
      /* 四角描边，做出“选中框”的感觉 */
      ctx.strokeStyle = '#fde047';
      ctx.lineWidth = 3;
      const L = 9, s = 1.5;
      const x0 = c * TILE + s, y0 = r * TILE + s, x1 = (c + 1) * TILE - s, y1 = (r + 1) * TILE - s;
      ctx.beginPath();
      ctx.moveTo(x0, y0 + L); ctx.lineTo(x0, y0); ctx.lineTo(x0 + L, y0);
      ctx.moveTo(x1 - L, y0); ctx.lineTo(x1, y0); ctx.lineTo(x1, y0 + L);
      ctx.moveTo(x1, y1 - L); ctx.lineTo(x1, y1); ctx.lineTo(x1 - L, y1);
      ctx.moveTo(x0 + L, y1); ctx.lineTo(x0, y1); ctx.lineTo(x0, y1 - L);
      ctx.stroke();
      ctx.restore();
      if (!state.buildOpen) {
        ctx.fillStyle = 'rgba(253,224,71,0.95)';
        ctx.font = 'bold 12px system-ui, "PingFang SC", sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('按 B 建造', x, r * TILE - 6);
      }
    }
  }

  function drawHero() {
    const h = state.hero;
    const t = performance.now();
    const sprite = HERO_SPRITE.ok;
    /* 有贴图时主角高了一截，血条 / 等级牌要跟着上移、冷却条下移，别糊在头上 */
    const barY = sprite ? -46 : -34;
    const badgeY = sprite ? -34 : -22;
    const cdY = sprite ? 20 : 16;
    /* 走路时上下颠 / 静止时呼吸：血条、等级牌都跟着一起动 */
    const bob = h.moving
      ? (sprite ? -Math.abs(Math.sin(h.step)) * 2.2 : Math.sin(h.step) * 1.6)
      : (sprite ? Math.sin(t / 900) * 1.1 : Math.sin(t / 520) * 0.9);

    /* 可交互范围（选塔 / 拆塔的有效半径） */
    ctx.save();
    ctx.strokeStyle = 'rgba(253,224,71,0.18)';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([3, 7]);
    ctx.beginPath(); ctx.arc(h.x, h.y, h.reach, 0, Math.PI * 2); ctx.stroke();
    ctx.restore();

    /* 瞄准方向：鼠标按下或场上有敌人时朝鼠标，否则维持上一次的朝向 */
    const aiming = state.mouse.down || state.enemies.length > 0;
    if (aiming) h.aim = Math.atan2(state.mouse.y - h.y, state.mouse.x - h.x);
    if (aiming) {
      const a = h.aim;
      ctx.save();
      ctx.globalAlpha = 0.35;
      ctx.strokeStyle = '#fde68a';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 6]);
      ctx.beginPath();
      ctx.moveTo(h.x + Math.cos(a) * 18, h.y + Math.sin(a) * 18);
      ctx.lineTo(h.x + Math.cos(a) * Math.min(h.range, 150), h.y + Math.sin(a) * Math.min(h.range, 150));
      ctx.stroke();
      ctx.restore();
    }

    /* 阴影 */
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.beginPath(); ctx.ellipse(h.x, h.y + 13, 12, 5, 0, 0, Math.PI * 2); ctx.fill();

    /* 选中光环 */
    ctx.strokeStyle = 'rgba(253,224,71,0.75)';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(h.x, h.y + 8, 14, 0, Math.PI * 2); ctx.stroke();

    const y = h.y + bob;

    if (sprite) drawHeroSprite(t, y);
    else drawHeroVector(y);

    /* 射击冷却条 */
    if (h.cd > 0) {
      const k = 1 - h.cd / h.rate;
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      rr(h.x - 12, y + cdY, 24, 4, 2); ctx.fill();
      ctx.fillStyle = '#fde68a';
      rr(h.x - 12, y + cdY, 24 * k, 4, 2); ctx.fill();
    }

    /* 血条 */
    const hr = Math.max(0, h.hp / h.hpMax);
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    rr(h.x - 15, y + barY, 30, 6, 3); ctx.fill();
    ctx.fillStyle = hr > 0.55 ? '#4ade80' : hr > 0.28 ? '#fbbf24' : '#f87171';
    rr(h.x - 14, y + barY + 1, 28 * hr, 4, 2); ctx.fill();

    /* 等级徽章 */
    ctx.fillStyle = 'rgba(15,23,20,0.85)';
    rr(h.x + 14, y + badgeY, 24, 13, 5); ctx.fill();
    ctx.strokeStyle = 'rgba(253,224,71,0.8)';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillStyle = '#fde047';
    ctx.font = 'bold 9px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Lv' + h.level, h.x + 26, y + badgeY + 10);

    /* 受击闪红（矢量小人用红圈糊一下；贴图用红色剪影盖在人物上，更贴形） */
    if (h.flash > 0 && !sprite) {
      ctx.save();
      ctx.globalAlpha = h.flash * 0.75;
      ctx.fillStyle = '#f87171';
      ctx.beginPath(); ctx.arc(h.x, y - 4, 17, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    }

    /* 站在杀戮光环里：主角身上套一圈刺目的红环 + 提示 */
    if (state.heroInAura) {
      const pul = 0.5 + 0.5 * Math.sin(performance.now() / 130);
      ctx.save();
      ctx.strokeStyle = 'rgba(244,63,94,' + (0.65 + 0.35 * pul) + ')';
      ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(h.x, y + 2, 24 + 3 * pul, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = 'rgba(244,63,94,0.95)';
      ctx.font = 'bold 11px system-ui, "PingFang SC", sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('光环中！快离开', h.x, y - 44);
      ctx.restore();
    }
  }

  /** 主角贴图 + 动画（主角/hero-deepseek.png）
   *  贴图的**底部中点就是双脚**，所有变换都绕这个点做，所以看起来像站在地上：
   *    · 待机 —— 缓慢呼吸（上下浮 + 轻微缩放 + 摆身）
   *    · 走路 —— 按步频颠步、左右摆、脚下扬灰
   *    · 转身 —— 鼠标换边时整体镜像，中间压扁过渡，不是「啪」地翻面
   *    · 瞄准 —— 朝鼠标方向上仰 / 下压（前倾角 h.lean 平滑跟随）
   *    · 射击 —— 沿弹道反方向后坐 + 压扁，配合弓口爆闪
   *    · 冲刺 —— 钩索位移时朝位移方向前倾、整体拉长，并留一串纯白残影
   *    · 受击 —— 全身抖一下 + 红色剪影闪一下 + 短暂无敌闪烁
   *    · 升级 —— 弹跳放大一下
   *    · 阵亡 —— 绕双脚倒下并淡出（主循环会为这 1.8 秒继续出帧） */
  function drawHeroSprite(now, y) {
    const h = state.hero;
    const S = HERO_SPRITE;
    const img = S.img;
    const s = now / 1000;
    const feetX = h.x, feetY = y + S.feetY;          // 双脚（贴图底部中点）落在哪
    const sc = S.h / img.height;
    const dw = img.width * sc, dh = img.height * sc;
    const dashing = h.dashFx > 0.02;

    /* ---- 残影：先用纯白剪影铺底，再画本体 ---- */
    if (S.white && h.ghost.length) {
      for (let i = 0; i < h.ghost.length; i++) {
        const g = h.ghost[i];
        ctx.save();
        ctx.globalAlpha = Math.max(0, g.a) * 0.55;
        ctx.translate(g.x, g.y + S.feetY);
        ctx.scale(g.face < 0 ? -1 : 1, 1);
        ctx.drawImage(S.white, -dw / 2, -dh, dw, dh);
        ctx.restore();
      }
    }

    /* ---- 姿态参数 ---- */
    /* 转身过渡到最扁的那一帧别整幅消失，留 0.06 的宽度 */
    const flip = Math.abs(h.face) < 0.06 ? 0.06 * (h.face < 0 ? -1 : 1) : h.face;
    const sway = h.moving ? Math.sin(h.step) * 0.05 : Math.sin(s * 1.3) * 0.015;
    const kick = (h.recoil || 0) * 5;                 // 后坐：往弹道反方向推
    const breathe = 1 + (h.moving ? 0 : Math.sin(s * 1.9) * 0.012);
    let pop = 1 + Math.sin(Math.min(1, h.pop) * Math.PI) * 0.15;   // 升级弹跳
    let spawn = 1;
    if (h.spawn > 0) spawn = 0.5 + 0.5 * (1 - h.spawn) + Math.sin((1 - h.spawn) * Math.PI) * 0.16;
    let death = 0;
    if (h.deathAt > 0) death = Math.min(1.35, (now - h.deathAt) / 1000);

    /* 受击抖动 / 无敌闪烁 / 阵亡淡出 */
    let alpha = 1;
    if (death > 0) alpha = Math.max(0, 1 - Math.max(0, death - 0.45) * 1.5);
    else if (h.flash > 0) alpha = 0.72 + 0.28 * Math.sin(now / 38);
    else if (h.invuln > 0.06) alpha = 0.6 + 0.4 * Math.abs(Math.sin(now / 70));
    const shake = death > 0 ? 0 : h.flash * 2.6;

    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.translate(
      feetX + (Math.random() - 0.5) * shake,
      feetY + (Math.random() - 0.5) * shake + death * 5
    );
    if (death > 0) ctx.rotate(death * 1.15);          // 倒下：绕双脚转
    ctx.rotate(h.lean + sway);                        // 前倾 + 摆身
    /* 镜像（转身）× 升级弹跳 × 出场缩放；后坐压扁、冲刺拉长 */
    ctx.scale(
      flip * pop * spawn * (1 + 0.16 * h.dashFx) * (1 + 0.05 * (h.recoil || 0)),
      pop * spawn * breathe * (1 - 0.10 * h.dashFx) * (1 - 0.06 * (h.recoil || 0))
    );
    /* 后坐位移：沿弹道反方向（本地坐标里「右」＝贴图朝向） */
    ctx.translate(-kick * (h.face < 0 ? -1 : 1) * Math.cos(h.aim), -kick * Math.sin(h.aim));

    ctx.drawImage(img, -dw / 2, -dh, dw, dh);

    /* 受击闪红：红色剪影正好盖在人物身上（留一点本色，别糊成一团红） */
    if (h.flash > 0 && S.red && death <= 0) {
      ctx.save();
      ctx.globalAlpha = Math.min(0.62, h.flash * 0.55);
      ctx.drawImage(S.red, -dw / 2, -dh, dw, dh);
      ctx.restore();
    }
    ctx.restore();

    /* 冲刺时的速度线：身后几道金色拉丝 */
    if (dashing) {
      const a = h.dir, back = a + Math.PI;
      ctx.save();
      ctx.strokeStyle = 'rgba(253,224,71,' + (0.5 * h.dashFx).toFixed(3) + ')';
      ctx.lineWidth = 2;
      for (let i = -1; i <= 1; i++) {
        const off = i * 9;
        const ox = feetX + Math.cos(back + Math.PI / 2) * off;
        const oy = feetY - 16 + Math.sin(back + Math.PI / 2) * off;
        ctx.beginPath();
        ctx.moveTo(ox, oy);
        ctx.lineTo(ox + Math.cos(back) * (14 + 10 * h.dashFx), oy + Math.sin(back) * (14 + 10 * h.dashFx));
        ctx.stroke();
      }
      ctx.restore();
    }
  }

  /** 没有贴图时的老矢量小人（一行都没改，保证「贴图丢了也能玩」） */
  function drawHeroVector(y) {
    const h = state.hero;

    /* 披风 */
    ctx.fillStyle = '#1d4ed8';
    ctx.beginPath();
    ctx.moveTo(h.x - 8, y - 6);
    ctx.lineTo(h.x + 8, y - 6);
    ctx.lineTo(h.x + 5, y + 9);
    ctx.lineTo(h.x - 5, y + 9);
    ctx.closePath(); ctx.fill();

    /* 身体 */
    ctx.fillStyle = '#38bdf8';
    rr(h.x - 7.5, y - 7, 15, 16, 5); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.28)';
    rr(h.x - 7.5, y - 7, 15, 6, 5); ctx.fill();

    /* 头 */
    ctx.fillStyle = '#fde9c8';
    ctx.beginPath(); ctx.arc(h.x, y - 13, 7.5, 0, Math.PI * 2); ctx.fill();
    /* 帽子 */
    ctx.fillStyle = '#f97316';
    ctx.beginPath();
    ctx.moveTo(h.x - 9, y - 16);
    ctx.lineTo(h.x + 9, y - 16);
    ctx.lineTo(h.x + 1, y - 24);
    ctx.closePath(); ctx.fill();
    ctx.beginPath(); ctx.ellipse(h.x, y - 16, 10, 2.6, 0, 0, Math.PI * 2); ctx.fill();

    /* 眼睛：朝移动方向偏移 */
    const lx = Math.cos(h.dir) * 2.2, ly = Math.sin(h.dir) * 1.2;
    ctx.fillStyle = '#0f172a';
    ctx.beginPath();
    ctx.arc(h.x - 2.6 + lx, y - 13 + ly, 1.5, 0, Math.PI * 2);
    ctx.arc(h.x + 2.6 + lx, y - 13 + ly, 1.5, 0, Math.PI * 2);
    ctx.fill();

    /* 弓：朝瞄准方向 */
    const aim = h.aim;
    ctx.save();
    ctx.translate(h.x, y - 1);
    ctx.rotate(aim + (h.recoil > 0 ? -0.25 * h.recoil : 0));
    ctx.strokeStyle = '#fbbf24';
    ctx.lineWidth = 2.2;
    ctx.beginPath(); ctx.arc(9, 0, 8, -Math.PI / 2.2, Math.PI / 2.2); ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,0.75)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(9 + Math.cos(-Math.PI / 2.2) * 8, Math.sin(-Math.PI / 2.2) * 8);
    ctx.lineTo(9 + Math.cos(Math.PI / 2.2) * 8, Math.sin(Math.PI / 2.2) * 8);
    ctx.stroke();
    ctx.restore();
  }

  /** 钩索：朝主角朝向甩出去的一条固定长度的链爪；勾住塔时变成抓取状态 */
  /* 第一关通关掉在地上的钩爪：光柱 + 地面虚线圈 + 一只钩爪 + 「左键拾取」 */
  function drawHookDrop(now) {
    const d = state.hookDrop;
    if (!d) return;
    const bob = Math.sin(now / 260) * 3.2;
    const pulse = 0.5 + 0.5 * Math.sin(now / 210);
    const g = ctx.createRadialGradient(d.x, d.y, 2, d.x, d.y, 46);
    g.addColorStop(0, 'rgba(253,230,138,' + (0.45 + 0.25 * pulse) + ')');
    g.addColorStop(1, 'rgba(253,230,138,0)');
    ctx.save();
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(d.x, d.y, 46, 0, Math.PI * 2); ctx.fill();

    ctx.strokeStyle = 'rgba(253,230,138,' + (0.55 + 0.35 * pulse) + ')';
    ctx.lineWidth = 2;
    ctx.setLineDash([5, 4]);
    ctx.lineDashOffset = -now / 70;
    ctx.beginPath(); ctx.ellipse(d.x, d.y + 12, 19, 7.5, 0, 0, Math.PI * 2); ctx.stroke();
    ctx.setLineDash([]);

    /* 钩爪：和钩索爪头同一个画法，放大一点、上下浮动、慢慢摇 */
    ctx.translate(d.x, d.y - 5 + bob);
    ctx.rotate(-0.55 + Math.sin(now / 520) * 0.14);
    ctx.fillStyle = '#fbbf24';
    ctx.strokeStyle = '#fbbf24';
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(9, 0); ctx.lineTo(0, -10); ctx.lineTo(-4, 0); ctx.lineTo(0, 10);
    ctx.closePath(); ctx.fill();
    ctx.lineWidth = 3;
    for (let i = -1; i <= 1; i++) {
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(-19, i * 15); ctx.stroke();
    }
    ctx.strokeStyle = 'rgba(255,255,255,0.8)';
    ctx.lineWidth = 1.4;
    ctx.beginPath(); ctx.moveTo(8, 0); ctx.lineTo(-2, -6); ctx.stroke();
    ctx.restore();

    /* 「左键拾取」小标签 */
    ctx.save();
    ctx.textAlign = 'center';
    ctx.font = 'bold 12px system-ui, "PingFang SC", sans-serif';
    const tw = ctx.measureText('左键拾取').width + 16;
    ctx.fillStyle = 'rgba(4,12,8,0.66)';
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(d.x - tw / 2, d.y + 26, tw, 20, 8);
    else ctx.rect(d.x - tw / 2, d.y + 26, tw, 20);
    ctx.fill();
    ctx.strokeStyle = 'rgba(253,230,138,' + (0.5 + 0.4 * pulse) + ')';
    ctx.lineWidth = 1.2;
    ctx.stroke();
    ctx.fillStyle = '#fde68a';
    ctx.fillText('左键拾取', d.x, d.y + 41);
    ctx.restore();
  }

  /* 捡到钩爪之后的大横幅：「🪝 获得 钩锁」 */
  function drawHookBanner() {
    if (state.hookTaken <= 0) return;
    const t = 1.9 - state.hookTaken;
    const pop = Math.min(1, t / 0.16);            // 弹入
    const fade = Math.min(1, state.hookTaken / 0.45);  // 末尾淡出
    ctx.save();
    ctx.globalAlpha = Math.min(1, fade);
    ctx.translate(W / 2, H / 2 - 46);
    ctx.scale(0.72 + 0.28 * pop, 0.72 + 0.28 * pop);
    ctx.fillStyle = 'rgba(6,16,11,0.86)';
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(-168, -46, 336, 96, 18);
    else ctx.rect(-168, -46, 336, 96);
    ctx.fill();
    ctx.strokeStyle = 'rgba(253,230,138,0.85)';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.textAlign = 'center';
    ctx.fillStyle = '#fde68a';
    ctx.font = 'bold 30px system-ui, "PingFang SC", sans-serif';
    ctx.fillText('🪝 获得 钩锁', 0, -2);
    ctx.fillStyle = '#cfe6d8';
    ctx.font = '14px system-ui, "PingFang SC", sans-serif';
    ctx.fillText('解锁第二关 · 双子回廊', 0, 28);
    ctx.restore();
  }

  function drawHook() {
    if (!state.hookOn) return;
    const h = state.hero;
    const s = hookPoints();
    const carrying = !!state.carry;
    const latched = carrying || !!hookTower();
    const t = performance.now();
    const rope = latched ? '#fbbf24' : '#d6b98c';

    /* 链索：一条笔直的索，从主角直连爪头 */
    ctx.save();
    ctx.strokeStyle = rope;
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(h.x, h.y);
    ctx.lineTo(s.x2, s.y2);
    ctx.stroke();
    /* 冷光描边，让它在地图上更醒目（同一条路径再描一次） */
    ctx.strokeStyle = 'rgba(255,255,255,' + (latched ? 0.5 : 0.22) + ')';
    ctx.lineWidth = 1.2;
    ctx.stroke();
    ctx.restore();

    /* 爪头 */
    const ang = s.a;
    const tipR = latched ? 9 : 6.5;
    ctx.save();
    ctx.translate(s.x2, s.y2);
    ctx.rotate(ang);
    ctx.fillStyle = rope;
    ctx.beginPath();
    ctx.moveTo(4, 0); ctx.lineTo(0, -tipR); ctx.lineTo(-2, 0); ctx.lineTo(0, tipR);
    ctx.closePath(); ctx.fill();
    /* 三根爪齿 */
    ctx.strokeStyle = rope;
    ctx.lineWidth = 2.4;
    for (let i = -1; i <= 1; i++) {
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(-9, i * 8);
      ctx.stroke();
    }
    ctx.restore();

    /* 端在手上的塔 */
    if (carrying) {
      const c = state.carry;
      ctx.save();
      ctx.globalAlpha = 0.95;
      ctx.fillStyle = 'rgba(0,0,0,0.25)';
      ctx.beginPath(); ctx.ellipse(c.x, c.y + 18, 16, 5, 0, 0, Math.PI * 2); ctx.fill();
      drawTowerBody(c, true);
      ctx.restore();
      /* 手上的塔该往哪放：脚下格子给个提示框 */
      const cell = heroCell();
      if (cell) {
        const ok = canBuild(cell.c, cell.r);
        ctx.save();
        ctx.strokeStyle = ok ? 'rgba(134,239,172,0.95)' : 'rgba(248,113,113,0.9)';
        ctx.lineWidth = 2.5;
        ctx.setLineDash([6, 5]);
        ctx.lineDashOffset = -t / 60;
        ctx.strokeRect(cell.c * TILE + 3, cell.r * TILE + 3, TILE - 6, TILE - 6);
        ctx.setLineDash([]);
        ctx.fillStyle = ok ? 'rgba(134,239,172,0.95)' : 'rgba(248,113,113,0.95)';
        ctx.font = 'bold 12px system-ui, "PingFang SC", sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(ok ? '按 Shift 放在这里' : '这里放不下', cell.c * TILE + TILE / 2, cell.r * TILE - 6);
        ctx.restore();
      }
    }
  }

  /* 蹦极扔在塔上的靶子：靶心贴图 + 倒计时环 + 一条连到蹦极的虚线。
   * 靶子只是「预告落点」——不掉血、不挡路，塔只要在保护伞范围内就没事。 */
  function drawThrows() {
    if (!state.throws.length) return;
    const now = performance.now();
    for (let i = 0; i < state.throws.length; i++) {
      const th = state.throws[i];
      const p = Math.max(0, Math.min(1, th.t / th.total));    // 1 → 0（快到 0 就是快落地）
      ctx.save();
      /* 连到蹦极的虚线 */
      const c = th.from;
      if (c && !c.dead && !(c.dropping > 0)) {
        ctx.strokeStyle = 'rgba(244,63,94,0.42)';
        ctx.lineWidth = 2;
        ctx.setLineDash([6, 6]);
        ctx.lineDashOffset = -now / 60;
        ctx.beginPath();
        ctx.moveTo(c.x, c.y - 14);
        ctx.lineTo(th.x, th.y - 12);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.lineDashOffset = 0;
      }
      /* 落点警示圈：越接近落地闪得越快 */
      ctx.strokeStyle = 'rgba(244,63,94,' + (0.45 + 0.4 * Math.abs(Math.sin(now / (110 + p * 240)))) + ')';
      ctx.lineWidth = 3;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.arc(th.x, th.y, 23, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * p);
      ctx.stroke();
      /* 靶心 */
      const thH = TARGET_SPRITE.h;
      const thW = TARGET_SPRITE.ok && TARGET_SPRITE.img
        ? thH * (TARGET_SPRITE.img.width / TARGET_SPRITE.img.height) : 30;
      const bob = Math.sin(now / 220) * 1.5;
      if (TARGET_SPRITE.ok && TARGET_SPRITE.img) {
        ctx.shadowColor = 'rgba(244,63,94,0.75)';
        ctx.shadowBlur = 10;
        ctx.drawImage(TARGET_SPRITE.img, th.x - thW / 2, th.y - thH + 12 + bob, thW, thH);
        ctx.shadowBlur = 0;
      } else {
        ctx.fillStyle = '#fecdd3';
        ctx.beginPath(); ctx.arc(th.x, th.y - 6, 12, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#e11d48';
        ctx.beginPath(); ctx.arc(th.x, th.y - 6, 8, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#fecdd3';
        ctx.beginPath(); ctx.arc(th.x, th.y - 6, 4.5, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#e11d48';
        ctx.beginPath(); ctx.arc(th.x, th.y - 6, 1.8, 0, Math.PI * 2); ctx.fill();
      }
      /* 剩余秒数 */
      ctx.font = 'bold 11px system-ui, "PingFang SC", sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'alphabetic';
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.fillText(Math.ceil(th.t) + 's', th.x + 1, th.y - thH + 3);
      ctx.fillStyle = '#fecdd3';
      ctx.fillText(Math.ceil(th.t) + 's', th.x, th.y - thH + 2);
      ctx.textAlign = 'start';
      ctx.restore();
    }
  }

  function drawEnemies() {
    for (let i = 0; i < state.enemies.length; i++) {
      const e = state.enemies[i];
      const ox = Math.cos(e.angle + Math.PI / 2) * e.off;
      const oy = Math.sin(e.angle + Math.PI / 2) * e.off;
      let x = e.x + ox, y = e.y + oy;
      const def = ENEMIES[e.type];

      /* 蹦极的 x/y 已经在 updateBungee 里算好了（从屏幕外俯冲下来），这里不用再挪 */

      /* 诱饵：画出它的嘲讽范围，说明炮塔为什么被吸走了 */
      if (def.taunt) {
        ctx.save();
        ctx.fillStyle = 'rgba(253,224,71,0.06)';
        ctx.beginPath(); ctx.arc(x, y, def.tauntRadius, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = 'rgba(253,224,71,0.4)';
        ctx.lineWidth = 1.5;
        ctx.setLineDash([7, 7]);
        ctx.beginPath(); ctx.arc(x, y, def.tauntRadius, 0, Math.PI * 2); ctx.stroke();
        ctx.restore();
      }

      /* 拆塔者：画出它的拆塔范围，并连到范围内每一座塔 */
      if (def.attackRange) {
        const hot = e.atkFlash > 0;
        ctx.save();
        ctx.fillStyle = 'rgba(163,230,53,' + (hot ? 0.09 : 0.05) + ')';
        ctx.beginPath(); ctx.arc(x, y, def.attackRange, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = 'rgba(163,230,53,' + (hot ? 0.55 : 0.28) + ')';
        ctx.lineWidth = hot ? 2 : 1.2;
        ctx.setLineDash([7, 7]);
        ctx.beginPath(); ctx.arc(x, y, def.attackRange, 0, Math.PI * 2); ctx.stroke();
        ctx.restore();
        if (e.targets && e.targets.length) {
          ctx.save();
          ctx.strokeStyle = 'rgba(163,230,53,' + (hot ? 0.95 : 0.6) + ')';
          ctx.lineWidth = hot ? 3 : 2;
          ctx.setLineDash([4, 3]);
          /* 目标太多时只画最近的 6 条，避免糊成一片（伤害仍然作用于全部） */
          const show = e.targets.length > 6 ? e.targets.slice(0, 6) : e.targets;
          for (let j = 0; j < show.length; j++) {
            ctx.beginPath();
            ctx.moveTo(x, y);
            ctx.lineTo(show[j].x, show[j].y);
            ctx.stroke();
          }
          ctx.restore();
        }
      }

      /* 督军：画出它的推进范围与「推」的指示 */
      if (def.pushEvery) {
        const hot = e.pushFlash > 0;
        ctx.save();
        ctx.strokeStyle = 'rgba(20,184,166,' + (hot ? 0.6 : 0.22) + ')';
        ctx.lineWidth = hot ? 2 : 1.2;
        ctx.setLineDash([6, 8]);
        ctx.beginPath(); ctx.arc(x, y, def.pushRange, 0, Math.PI * 2); ctx.stroke();
        ctx.restore();
        /* 朝向前方的双箭头 */
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(e.angle);
        ctx.fillStyle = hot ? 'rgba(94,234,212,0.95)' : 'rgba(94,234,212,0.5)';
        for (let k = 0; k < 2; k++) {
          const ox = e.r + 4 + k * 6;
          ctx.beginPath();
          ctx.moveTo(ox, -4); ctx.lineTo(ox + 5, 0); ctx.lineTo(ox, 4);
          ctx.closePath(); ctx.fill();
        }
        ctx.restore();
      }

      /* 屠戮者：杀戮光环——对塔没有任何伤害，只烧主角 */
      if (def.auraRadius) {
        const inside = dist2(x, y, state.hero.x, state.hero.y) <= def.auraRadius * def.auraRadius;
        const pul = 0.5 + 0.5 * Math.sin(performance.now() / 210);
        ctx.save();
        ctx.fillStyle = 'rgba(225,29,72,' + (inside ? 0.2 + 0.08 * pul : 0.1 + 0.05 * pul) + ')';
        ctx.beginPath(); ctx.arc(x, y, def.auraRadius, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = 'rgba(244,63,94,' + (inside ? 0.85 : 0.5) + ')';
        ctx.lineWidth = inside ? 3 : 2;
        ctx.setLineDash([10, 8]);
        ctx.lineDashOffset = -performance.now() / 45;
        ctx.beginPath(); ctx.arc(x, y, def.auraRadius, 0, Math.PI * 2); ctx.stroke();
        ctx.setLineDash([]);
        ctx.lineDashOffset = 0;
        /* 光环内的杀意尖刺 */
        ctx.strokeStyle = 'rgba(244,63,94,' + (inside ? 0.5 : 0.28) + ')';
        ctx.lineWidth = 2;
        for (let k = 0; k < 8; k++) {
          const a = performance.now() / 900 + k * Math.PI / 4;
          const r0 = def.auraRadius - 16, r1 = def.auraRadius - 4;
          ctx.beginPath();
          ctx.moveTo(x + Math.cos(a) * r0, y + Math.sin(a) * r0);
          ctx.lineTo(x + Math.cos(a) * r1, y + Math.sin(a) * r1);
          ctx.stroke();
        }
        ctx.restore();
      }

      /* 治疗 / 召唤脉冲 */
      if (e.pulse > 0) {
        ctx.save();
        ctx.globalAlpha = Math.min(1, e.pulse * 1.6);
        ctx.strokeStyle = def.healRadius ? '#4ade80' : '#ef4444';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(x, y, (def.healRadius || 70) * (1.1 - e.pulse), 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }

      /* 沉默波：一圈紫环从首领身上扫出去，最远到沉默半径 */
      if (e.silencePulse > 0) {
        const sk = 1 - e.silencePulse / 0.65;
        ctx.save();
        ctx.globalAlpha = Math.max(0, 1 - sk) * 0.9;
        ctx.strokeStyle = '#a855f7';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(x, y, 10 + (def.silenceRadius - 10) * sk, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }

      ctx.fillStyle = 'rgba(0,0,0,0.25)';
      ctx.beginPath(); ctx.ellipse(x, y + e.r * 0.85, e.r * 1.05, e.r * 0.42, 0, 0, Math.PI * 2); ctx.fill();

      /* 立绘：首领用豆包，其他小怪用同一张 gpt 立绘、按各自颜色染色。
       * 底部中点＝双脚（y + 半径×0.85，正好踩在自己的影子上），头顶＝脚底 - 贴图高；
       * 没贴图时退回「彩色圆球」（首领则是红色圆球 + 王冠），血条/王冠都比着 headY 放。 */
      const useBossArt = e.type === 'boss' && BOSS_SPRITE.ok && BOSS_SPRITE.img;
      const useBungee = e.type === 'bungee' && BUNGEE_SPRITE.ok && BUNGEE_SPRITE.img;
      const mobArt = (e.type === 'boss' || e.type === 'bungee') ? null : mobSpriteFor(e.type);
      const artImg = useBossArt ? BOSS_SPRITE.img : (useBungee ? BUNGEE_SPRITE.img : mobArt);
      const artH = useBossArt ? BOSS_SPRITE.h
        : (useBungee ? BUNGEE_SPRITE.h : (mobArt ? e.r * ENEMY_SPRITE.scale : 0));
      const artW = artH ? artH * (artImg.width / artImg.height) : 0;
      const feetY = useBossArt ? BOSS_SPRITE.feetY : (useBungee ? BUNGEE_SPRITE.feetY : e.r * 0.85);
      const headY = artH ? y + feetY - artH : y - e.r;
      const barTop = headY - (e.type === 'boss' ? 17 : 9);

      const frozenNow = e.freezeT > 0;
      if (frozenNow) {
        /* 冰壳外圈：一层冷色光晕，先垫在身体下面 */
        ctx.save();
        ctx.fillStyle = 'rgba(147,197,253,0.30)';
        ctx.beginPath(); ctx.arc(x, y - (artH ? artH * 0.35 : 0), (artH ? Math.max(artW, artH) * 0.42 : e.r) + 5, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      } else if (e.slowT > 0) {
        ctx.strokeStyle = 'rgba(96,165,250,0.85)';
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(x, y, e.r + 4, 0, Math.PI * 2); ctx.stroke();
      }

      const g = ctx.createRadialGradient(x - e.r * 0.35, y - e.r * 0.4, e.r * 0.2, x, y, e.r);
      g.addColorStop(0, '#ffffff');
      g.addColorStop(0.35, e.hit > 0 ? '#ffffff' : e.color);
      g.addColorStop(1, e.dark);
      if (artH) {
        /* 立绘：底部中点＝双脚，直接贴在地上；蹦极吊着时会左右轻摆 */
        const bx = x - artW / 2, by = y + feetY - artH;
        const swing = useBungee ? Math.sin(performance.now() / 430) * (e.diveT >= 0 ? 0.04 : 0.1) : 0;
        ctx.save();
        if (swing) {
          ctx.translate(x, y + feetY);
          ctx.rotate(swing);
          ctx.translate(-x, -(y + feetY));
        }
        ctx.drawImage(artImg, bx, by, artW, artH);
        if (e.hit > 0) {                       // 受击泛白：叠一层亮的（lighter 只提亮，不会糊掉细节）
          ctx.globalCompositeOperation = 'lighter';
          ctx.globalAlpha = Math.min(0.5, e.hit * 1.1);
          ctx.drawImage(artImg, bx, by, artW, artH);
        }
        ctx.restore();
      } else {
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(x, y, e.r, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = 'rgba(0,0,0,0.35)';
        ctx.lineWidth = 2;
        ctx.stroke();
      }

      /* 冻住的时候盖上冰壳 + 几根冰棱，一眼看出它动不了了 */
      if (frozenNow) {
        const ix = artH ? x - artW / 2 : x - e.r;
        const iy = artH ? y + feetY - artH : y - e.r;
        const iw = artH ? artW : e.r * 2;
        const ih = artH ? artH : e.r * 2;
        ctx.save();
        rr(ix - 2, iy - 2, iw + 4, ih + 4, Math.min(8, iw * 0.2));
        ctx.fillStyle = 'rgba(186,230,253,0.40)';
        ctx.fill();
        ctx.strokeStyle = 'rgba(224,242,254,0.95)';
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.strokeStyle = 'rgba(125,211,252,0.95)';
        ctx.lineWidth = 1.4;
        const cx0 = ix + iw / 2, cy0 = iy + ih / 2;
        for (let k = 0; k < 3; k++) {
          const a0 = -Math.PI / 2 + k * 2.1 + Math.sin(performance.now() / 900 + k) * 0.12;
          const r0 = Math.min(iw, ih) * 0.28;
          const r1 = Math.min(iw, ih) * 0.52;
          ctx.beginPath();
          ctx.moveTo(cx0 + Math.cos(a0) * r0, cy0 + Math.sin(a0) * r0);
          ctx.lineTo(cx0 + Math.cos(a0 + 0.35) * r1, cy0 + Math.sin(a0 + 0.35) * r1);
          ctx.stroke();
        }
        ctx.restore();
      }

      /* 护盾环：剩余护盾比例 */
      if (e.shieldMax > 0) {
        const sr = e.shield / e.shieldMax;
        if (sr > 0) {
          ctx.strokeStyle = 'rgba(125,211,252,' + (0.5 + 0.45 * sr) + ')';
          ctx.lineWidth = 3;
          ctx.beginPath();
          ctx.arc(x, y, e.r + 3.5, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * sr);
          ctx.stroke();
        }
      }

      /* 眼睛（朝向行进方向）；有立绘的怪都有自己的脸，不画 */
      if (!artH) {
        const ex = x + Math.cos(e.angle) * e.r * 0.4;
        const ey = y + Math.sin(e.angle) * e.r * 0.4;
        ctx.fillStyle = 'rgba(15,23,20,0.85)';
        ctx.beginPath(); ctx.arc(ex, ey, Math.max(1.6, e.r * 0.2), 0, Math.PI * 2); ctx.fill();
      }

      /* 战地医师的十字标记 */
      if (def.healRadius) {
        ctx.fillStyle = '#4ade80';
        ctx.fillRect(x - 5, barTop - 12, 10, 3.4);
        ctx.fillRect(x - 1.7, barTop - 15.3, 3.4, 10);
      }

      /* 分裂史莱姆：体内的小气泡 */
      if (def.split) {
        ctx.fillStyle = 'rgba(255,255,255,0.45)';
        ctx.beginPath();
        ctx.arc(x - 3.5, y + 1.5, 2.6, 0, Math.PI * 2);
        ctx.arc(x + 3.5, y - 2, 2.1, 0, Math.PI * 2);
        ctx.fill();
      }

      /* 诱饵：靶心花纹 */
      if (def.taunt) {
        ctx.strokeStyle = 'rgba(120,53,15,0.75)';
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(x, y, e.r * 0.62, 0, Math.PI * 2); ctx.stroke();
        ctx.beginPath(); ctx.arc(x, y, e.r * 0.28, 0, Math.PI * 2); ctx.stroke();
      }

      /* 拆塔者：爪子 */
      if (def.attackRange) {
        const ax = x + Math.cos(e.angle) * e.r * 0.7;
        const ay = y + Math.sin(e.angle) * e.r * 0.7;
        ctx.strokeStyle = '#1a2e05';
        ctx.lineWidth = 2.2;
        ctx.beginPath();
        ctx.moveTo(ax - 3, ay - 3); ctx.lineTo(ax + 2, ay + 2);
        ctx.moveTo(ax + 3, ay - 3); ctx.lineTo(ax - 2, ay + 2);
        ctx.stroke();
      }

      if (e.type === 'boss') {
        ctx.fillStyle = '#fbbf24';
        ctx.beginPath();
        ctx.moveTo(x - 10, headY - 3);
        ctx.lineTo(x - 5, headY - 11);
        ctx.lineTo(x, headY - 4);
        ctx.lineTo(x + 5, headY - 11);
        ctx.lineTo(x + 10, headY - 3);
        ctx.closePath(); ctx.fill();
      }

      /* 血条（无敌的蹦极不画：打不掉，画了反而误导） */
      if (!e.noHit) {
      const ratio = Math.max(0, e.hp / e.maxHp);
      const bw = Math.max(20, e.r * 2.3);
      const bx = x - bw / 2, by = barTop;
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      rr(bx - 1, by - 1, bw + 2, 5.5, 3); ctx.fill();
      ctx.fillStyle = 'hsl(' + (ratio * 115) + ',72%,52%)';
      rr(bx, by, bw * ratio, 3.5, 2); ctx.fill();
      }
    }
  }

  function drawShots() {
    for (let i = 0; i < state.shots.length; i++) {
      const s = state.shots[i];
      ctx.save();
      ctx.translate(s.x, s.y);
      ctx.rotate(s.angle);
      if (s.kind === 'bolt') {
        ctx.fillStyle = 'rgba(253,230,138,0.35)';
        ctx.beginPath(); ctx.ellipse(-10, 0, 13, 3.4, 0, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#fffbeb';
        ctx.fillRect(-8, -1.4, 16, 2.8);
        ctx.fillStyle = '#fbbf24';
        ctx.beginPath();
        ctx.moveTo(8, -4); ctx.lineTo(15, 0); ctx.lineTo(8, 4);
        ctx.closePath(); ctx.fill();
      } else if (s.kind === 'arrow') {
        ctx.fillStyle = '#d1fae5';
        ctx.fillRect(-7, -1.1, 14, 2.2);
        ctx.fillStyle = '#4ade80';
        ctx.beginPath();
        ctx.moveTo(8, -3.2); ctx.lineTo(13, 0); ctx.lineTo(8, 3.2);
        ctx.closePath(); ctx.fill();
      } else if (s.kind === 'shell') {
        ctx.fillStyle = 'rgba(251,146,60,0.35)';
        ctx.beginPath(); ctx.ellipse(-6, 0, 8, 3.5, 0, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#1f2937';
        ctx.beginPath(); ctx.arc(0, 0, 4.6, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#fb923c';
        ctx.beginPath(); ctx.arc(-1, -1, 2.2, 0, Math.PI * 2); ctx.fill();
      } else {
        ctx.fillStyle = '#bfdbfe';
        ctx.beginPath();
        ctx.moveTo(6, 0); ctx.lineTo(0, -4); ctx.lineTo(-6, 0); ctx.lineTo(0, 4);
        ctx.closePath(); ctx.fill();
        ctx.fillStyle = 'rgba(147,197,253,0.5)';
        ctx.beginPath(); ctx.arc(0, 0, 5.5, 0, Math.PI * 2); ctx.fill();
      }
      ctx.restore();
    }
  }

  function drawBits() {
    for (let i = 0; i < state.bits.length; i++) {
      const b = state.bits[i];
      const a = Math.max(0, b.life / (b.kind === 'ring' ? b.maxLife : b.max));
      ctx.globalAlpha = a;
      if (b.kind === 'dot') {
        ctx.fillStyle = b.color;
        ctx.beginPath(); ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2); ctx.fill();
      } else {
        ctx.strokeStyle = b.color;
        ctx.lineWidth = 3 * a;
        ctx.beginPath(); ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2); ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;
  }

  function drawTexts() {
    ctx.textAlign = 'center';
    ctx.font = 'bold 13px system-ui, "PingFang SC", sans-serif';
    for (let i = 0; i < state.texts.length; i++) {
      const t = state.texts[i];
      ctx.globalAlpha = Math.max(0, t.life / t.max);
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(0,0,0,0.55)';
      ctx.strokeText(t.text, t.x, t.y);
      ctx.fillStyle = t.color;
      ctx.fillText(t.text, t.x, t.y);
    }
    ctx.globalAlpha = 1;
  }

  function drawEffects() {
    if (state.flash > 0) {
      const g = ctx.createRadialGradient(W / 2, H / 2, H * 0.2, W / 2, H / 2, H * 0.85);
      g.addColorStop(0, 'rgba(248,113,113,0)');
      g.addColorStop(1, 'rgba(248,113,113,' + (0.55 * state.flash) + ')');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
    }
  }

  /* 血剑本体：白钢剑身 + 血红剑尖，蓄力时悬浮发亮，飞出去留三道拖尾 */
  function drawSwordBody(x, y, ang, sc, alpha) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(ang);
    ctx.scale(sc, sc);
    ctx.globalAlpha = alpha;
    ctx.shadowColor = 'rgba(244,63,94,0.9)';
    ctx.shadowBlur = 14;
    ctx.fillStyle = '#e2e8f0';
    ctx.beginPath();
    ctx.moveTo(24, 0); ctx.lineTo(8, -4.4); ctx.lineTo(-9, -4.4);
    ctx.lineTo(-9, 4.4); ctx.lineTo(8, 4.4);
    ctx.closePath(); ctx.fill();
    ctx.shadowBlur = 0;
    ctx.fillStyle = 'rgba(244,63,94,0.8)';
    ctx.beginPath();
    ctx.moveTo(24, 0); ctx.lineTo(6, -3.4); ctx.lineTo(6, 3.4);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#b91c1c';
    ctx.fillRect(-12.5, -8, 4.5, 16);
    ctx.fillStyle = '#7f1d1d';
    ctx.fillRect(-19.5, -2.4, 7, 4.8);
    ctx.fillStyle = '#fda4af';
    ctx.beginPath(); ctx.arc(-20.5, 0, 2.6, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }

  function drawSwords(now) {
    for (let i = 0; i < state.swords.length; i++) {
      const sw = state.swords[i];
      const ang = Math.atan2(sw.uy, sw.ux);
      if (sw.t < sw.delay) {
        /* 蓄力：一条越来亮越粗的虚线轨迹 + 收缩的蓄力圈 */
        const k = Math.min(1, sw.t / sw.delay);
        ctx.save();
        ctx.strokeStyle = 'rgba(244,63,94,' + (0.3 + 0.55 * k) + ')';
        ctx.lineWidth = 2 + 2.4 * k;
        ctx.setLineDash([16, 12]);
        ctx.lineDashOffset = -now / 26;
        ctx.beginPath();
        ctx.moveTo(sw.x, sw.y);
        ctx.lineTo(sw.x + sw.ux * 1400, sw.y + sw.uy * 1400);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.strokeStyle = 'rgba(253,164,175,' + (0.45 + 0.55 * k) + ')';
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.arc(sw.x, sw.y, 26 - 16 * k, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
        drawSwordBody(sw.x, sw.y, ang, 1 + 0.12 * Math.sin(now / 80), 1);
      } else {
        for (let t = 3; t >= 1; t--) {
          drawSwordBody(sw.x - sw.ux * 12 * t, sw.y - sw.uy * 12 * t, ang, 1.15, 0.2 / t);
        }
        drawSwordBody(sw.x, sw.y, ang, 1.15, 1);
      }
    }
  }

  /** 落石：非常显眼的地面预警（时钟进度 + 粗圈 + 旋转外环 + 四角角标 + 感叹号）
   *  以及一道从天而降的光柱和石头 */
  function drawRocks() {
    const now = performance.now();
    for (let i = 0; i < state.rocks.length; i++) {
      const rk = state.rocks[i];
      const k = Math.min(1, rk.t / rk.delay);
      const pulse = 0.5 + 0.5 * Math.sin(now / 70);
      const cr = Math.round(249 - 20 * k);
      const cg = Math.round(140 - 92 * k);
      const cb = Math.round(22 + 20 * k);
      const rgb = cr + ',' + cg + ',' + cb;
      const R = rk.r;

      /* --- 地面预警 --- */
      ctx.save();
      /* 1. 染色底盘 */
      ctx.fillStyle = 'rgba(' + rgb + ',' + (0.12 + 0.3 * k) + ')';
      ctx.beginPath(); ctx.arc(rk.x, rk.y, R, 0, Math.PI * 2); ctx.fill();
      /* 2. 时钟式扇形进度 */
      ctx.fillStyle = 'rgba(' + rgb + ',' + (0.28 + 0.3 * k) + ')';
      ctx.beginPath();
      ctx.moveTo(rk.x, rk.y);
      ctx.arc(rk.x, rk.y, R, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * k);
      ctx.closePath();
      ctx.fill();
      /* 3. 粗主圈（最后 0.3 秒开始闪） */
      const flash = k > 0.7 ? (0.6 + 0.4 * pulse) : 1;
      ctx.strokeStyle = 'rgba(' + rgb + ',' + (0.92 * flash) + ')';
      ctx.lineWidth = 4;
      ctx.beginPath(); ctx.arc(rk.x, rk.y, R, 0, Math.PI * 2); ctx.stroke();
      /* 4. 旋转虚线外环 */
      ctx.strokeStyle = 'rgba(255,255,255,' + (0.45 + 0.4 * pulse) + ')';
      ctx.lineWidth = 2;
      ctx.setLineDash([9, 9]);
      ctx.lineDashOffset = -now / 35;
      ctx.beginPath(); ctx.arc(rk.x, rk.y, R + 10, 0, Math.PI * 2); ctx.stroke();
      ctx.setLineDash([]);
      ctx.lineDashOffset = 0;
      /* 5. 四角角标 */
      ctx.strokeStyle = 'rgb(' + rgb + ')';
      ctx.lineWidth = 3;
      const L = 11, o = R + 4;
      ctx.beginPath();
      ctx.moveTo(rk.x - o, rk.y - o + L); ctx.lineTo(rk.x - o, rk.y - o); ctx.lineTo(rk.x - o + L, rk.y - o);
      ctx.moveTo(rk.x + o - L, rk.y - o); ctx.lineTo(rk.x + o, rk.y - o); ctx.lineTo(rk.x + o, rk.y - o + L);
      ctx.moveTo(rk.x + o, rk.y + o - L); ctx.lineTo(rk.x + o, rk.y + o); ctx.lineTo(rk.x + o - L, rk.y + o);
      ctx.moveTo(rk.x - o + L, rk.y + o); ctx.lineTo(rk.x - o, rk.y + o); ctx.lineTo(rk.x - o, rk.y + o - L);
      ctx.stroke();
      /* 6. 头顶感叹号 */
      const by = rk.y - R - 28 - 5 * pulse;
      ctx.fillStyle = 'rgba(255,255,255,0.95)';
      ctx.beginPath(); ctx.arc(rk.x, by, 12, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = 'rgb(' + rgb + ')';
      ctx.beginPath(); ctx.arc(rk.x, by, 10, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 15px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('!', rk.x, by + 5.5);
      ctx.restore();

      /* --- 从天而降的石头 --- */
      const hgt = 330 * (1 - k) * (1 - k);
      const sx = rk.x - 52 * (1 - k);
      const sy = rk.y - hgt;
      ctx.save();
      /* 光柱：把落点和天上的石头连起来 */
      const beam = ctx.createLinearGradient(sx, sy, rk.x, rk.y);
      beam.addColorStop(0, 'rgba(' + rgb + ',0)');
      beam.addColorStop(1, 'rgba(' + rgb + ',' + (0.35 + 0.35 * k) + ')');
      ctx.strokeStyle = beam;
      ctx.lineWidth = 10 + 12 * k;
      ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(rk.x, rk.y); ctx.stroke();
      /* 地面影子 */
      ctx.fillStyle = 'rgba(0,0,0,' + (0.32 * k) + ')';
      ctx.beginPath();
      ctx.ellipse(rk.x + 8, rk.y + 4, R * 0.62 * k, R * 0.26 * k, 0, 0, Math.PI * 2);
      ctx.fill();
      /* 石头：用径向渐变做光晕。不用 shadowBlur —— 它在每帧重绘时非常贵 */
      const glow = ctx.createRadialGradient(sx, sy, 4, sx, sy, 34);
      glow.addColorStop(0, 'rgba(' + rgb + ',0.85)');
      glow.addColorStop(1, 'rgba(' + rgb + ',0)');
      ctx.fillStyle = glow;
      ctx.beginPath(); ctx.arc(sx, sy, 34, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#57534e';
      ctx.beginPath(); ctx.arc(sx, sy, 19, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#a8a29e';
      ctx.beginPath(); ctx.arc(sx - 6, sy - 6, 9, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#78716c';
      ctx.beginPath(); ctx.arc(sx + 8, sy + 7, 5.5, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.8)';
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(sx, sy, 19, 0, Math.PI * 2); ctx.stroke();
      ctx.restore();
    }
  }

  /** 静态图层：地面 + 三条路 + 装饰 + 基地，只在需要时重建 */
  /** 升级台的交付点：地面上画个虚框，让玩家知道「每波清完这儿会刷升级台」 */
  function drawBenchPad() {
    const cell = state.benchCell;
    if (!cell) return;
    const x = cell.c * TILE + TILE / 2, y = cell.r * TILE + TILE / 2;
    ctx.save();
    ctx.strokeStyle = 'rgba(251,191,36,0.5)';
    ctx.lineWidth = 1.6;
    ctx.setLineDash([6, 5]);
    rr(x - 19, y - 19, 38, 38, 10);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = 'rgba(251,191,36,0.13)';
    rr(x - 19, y - 19, 38, 38, 10);
    ctx.fill();
    ctx.fillStyle = 'rgba(251,191,36,0.55)';
    ctx.font = 'bold 15px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('⬆', x, y + 5.5);
    ctx.restore();
  }

  function rebuildBg() {
    const real = ctx;
    ctx = bgCtx;
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    ctx.clearRect(0, 0, W, H);
    drawGround();
    drawRiver();
    drawPath();
    drawBenchPad();
    drawBridges();
    drawDecor();
    ctx = real;
    bgDirty = false;
  }

  function render() {
    const now = performance.now();
    if (bgDirty) rebuildBg();
    ctx.drawImage(bgCv, 0, 0, W, H);
    drawLaneMarkers();
    drawTileMarks(now);
    drawTowers();
    drawEnemies();
    drawThrows();
    drawHookDrop(now);
    drawHero();
    drawHook();
    drawShots();
    drawRocks();
    drawSwords(now);
    drawBits();
    drawTexts();
    drawEffects();
    drawHookBanner();

    if (state.selectedTower) {
      const t = state.selectedTower;
      rangeCircle(t.x, t.y, statsOf(t).range, 'rgba(255,255,255,0.6)', 'rgba(255,255,255,0.07)');
    }
    if (state.paused) {
      ctx.fillStyle = 'rgba(5,12,9,0.45)';
      ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = '#e6f2ea';
      ctx.textAlign = 'center';
      ctx.font = 'bold 30px system-ui, "PingFang SC", sans-serif';
      ctx.fillText('已 暂 停', W / 2, H / 2 - 4);
      ctx.font = '14px system-ui, sans-serif';
      ctx.fillStyle = '#8fa89b';
      ctx.fillText('按空格继续', W / 2, H / 2 + 24);
    }
  }

  /* ============================================================
   * 9. 界面同步
   * ============================================================ */
  const el = {
    lives: document.getElementById('uiLives'),
    money: document.getElementById('uiMoney'),
    wave: document.getElementById('uiWave'),
    next: document.getElementById('uiNextWave'),
    bar: document.getElementById('uiBar'),
    shop: document.getElementById('shop'),
    selection: document.getElementById('selection'),
    buildMenu: document.getElementById('buildMenu'),
    levelMenu: document.getElementById('levelMenu'),
    enemyPopup: document.getElementById('enemyPopup'),
    startScreen: document.getElementById('startScreen'),
    coverScreen: document.getElementById('coverScreen'),
    btnCover: document.getElementById('btnCover'),
    btnStart: document.getElementById('btnStart'),
    btnHelp: document.getElementById('btnHelp'),
    btnLevel1: document.getElementById('btnLevel1'),
    btnLevel2: document.getElementById('btnLevel2'),
    btnLevel3: document.getElementById('btnLevel3'),
    itemGuide: document.getElementById('itemGuide'),
    itemGuide3: document.getElementById('itemGuide3'),
    btnGuideOk: document.getElementById('btnGuideOk'),
    btnGuide3Ok: document.getElementById('btnGuide3Ok'),
    startTip: document.getElementById('startTip'),
    startUnlock: document.getElementById('startUnlock'),
    hookBlock: document.getElementById('hookBlock'),
    benchBlock: document.getElementById('benchBlock'),
    hookState: document.getElementById('hookState'),
    hookCd: document.getElementById('hookCd'),
    hookCdWrap: document.getElementById('hookCdWrap'),
    btnNextLevel: document.getElementById('btnNextLevel'),
    bombCount: document.getElementById('bombCount'),
    bombCd: document.getElementById('bombCd'),
    btnBuyBomb: document.getElementById('btnBuyBomb'),
    heroStatus: document.getElementById('heroStatus'),
    heroCd: document.getElementById('heroCd'),
    heroHp: document.getElementById('heroHp'),
    heroLevel: document.getElementById('heroLevel'),
    heroXp: document.getElementById('heroXp'),
    heroStats: document.getElementById('heroStats'),
    heroPerks: document.getElementById('heroPerks'),
    btnWave: document.getElementById('btnWave'),
    btnPause: document.getElementById('btnPause'),
    btnSpeed: document.getElementById('btnSpeed'),
    btnSound: document.getElementById('btnSound'),
    overlay: document.getElementById('overlay'),
  };

  /* 侧栏的塔图鉴（建造改成“走到空地 → Z → B → 弹窗鼠标选”的流程） */
  function buildShop() {
    el.shop.innerHTML = TOWER_KEYS.map(function (k) {
      const d = TOWERS[k];
      const l1 = d.levels[0];
      return '<div class="shop-item" data-build="' + k + '">' +
        '<span class="ic">' + d.icon + '</span>' +
        '<span><span class="nm">' + d.name + '</span>' +
        '<div class="ds">' + d.desc + '</div>' +
        '<div class="ds">伤害 ' + l1.damage + ' · 射程 ' + l1.range +
        (l1.splash ? ' · 溅射 ' + l1.splash : '') +
        (l1.freeze ? ' · 冰冻 ' + l1.freeze.toFixed(1) + 's' : '') + '</div></span>' +
        '<span class="cost">🪙 ' + d.cost + '</span>' +
        '</div>';
    }).join('');
  }

  /* 建造弹窗里的三种塔 */
  function buildBuildMenu() {
    if (!el.buildMenu) return;
    const box = el.buildMenu.querySelector('.build-options');
    box.innerHTML = TOWER_KEYS.map(function (k, i) {
      const d = TOWERS[k];
      return '<button class="build-opt" data-tower="' + k + '">' +
        '<span class="ic">' + d.icon + '</span>' +
        '<span class="nm">' + d.name + ' <small>(' + (i + 1) + ')</small></span>' +
        '<span class="cost">🪙 ' + d.cost + '</span>' +
        '<span class="ds">' + d.desc + '</span>' +
        '</button>';
    }).join('');
  }

  function syncHUD() {
    el.lives.textContent = state.lives;
    el.money.textContent = state.money;
    el.wave.textContent = (state.phase === 'battle' ? state.waveIndex + 1 : state.waveIndex) + '/' + WAVES.length;

    /* 商店按钮状态 */
    const items = el.shop.children;
    for (let i = 0; i < items.length; i++) {
      const k = items[i].getAttribute('data-build');
      items[i].classList.toggle('poor', state.money < TOWERS[k].cost);
    }

    /* 主角状态 */
    const h = state.hero;
    if (el.heroCd) el.heroCd.style.width = ((1 - h.cd / h.rate) * 100).toFixed(0) + '%';
    if (el.heroHp) {
      const hpTxt = Math.ceil(h.hp) + ' / ' + h.hpMax;
      if (el.heroHp.textContent !== hpTxt) el.heroHp.textContent = hpTxt;
      el.heroHp.className = h.hp > h.hpMax * 0.5 ? '' : h.hp > h.hpMax * 0.25 ? 'warn' : 'danger';
    }
    if (el.heroLevel) {
      el.heroLevel.textContent = 'Lv.' + h.level + (h.level >= MAX_HERO_LEVEL ? ' MAX' : '');
    }
    if (el.heroXp) {
      const need = h.level >= MAX_HERO_LEVEL ? 1 : h.xpNeed;
      el.heroXp.style.width = Math.min(100, (h.xp / need) * 100).toFixed(0) + '%';
    }
    if (el.heroStats) {
      const statsTxt = '伤害 ' + h.damage.toFixed(1) + ' · 攻速 ' + (1 / h.rate).toFixed(1) +
        '/秒 · 射程 ' + Math.round(h.range) + ' · 回血 ' + h.regen + '/秒' +
        (h.spread ? ' · 散射 ' + (1 + h.spread * 2) + ' 支' : '') +
        (h.pierceCount ? ' · 穿透 ' + h.pierceCount : '');
      if (el.heroStats.textContent !== statsTxt) el.heroStats.textContent = statsTxt;
    }
    if (el.heroPerks) {
      const perksTxt = h.perks.length ? h.perks.join(' · ') : '还没有强化，击杀敌人升级后可以三选一';
      if (el.heroPerks.textContent !== perksTxt) el.heroPerks.textContent = perksTxt;
    }
    if (el.heroStatus) {
      let s;
      if (state.buildOpen) s = '正在选择要建造的塔…';
      else if (state.selectedTower) {
        s = '已选中 ' + TOWERS[state.selectedTower.type].name +
          '（LV' + (state.selectedTower.level + 1) + '）· F 升级 · 右键快速拆除';
      } else if (state.marked) s = '已标记空地（' + state.marked.c + ',' + state.marked.r + '）· 按 B 选择塔';
      else s = 'WASD 移动 · 左键点旁边的塔可直接选中 · 左键空处射击 · B 建造';
      if (el.heroStatus.textContent !== s) el.heroStatus.textContent = s;
    }

    /* 炸弹 */
    if (el.bombCount) {
      const bt = state.bombs + ' / ' + BOMB_MAX;
      if (el.bombCount.textContent !== bt) el.bombCount.textContent = bt;
    }
    if (el.bombCd) {
      const ready = state.bombCd <= 0;
      const txt = ready
        ? (state.bombs > 0 ? '就绪' : '无弹药')
        : '冷却 ' + state.bombCd.toFixed(1) + 's';
      if (el.bombCd.textContent !== txt) el.bombCd.textContent = txt;
      el.bombCd.classList.toggle('busy', !ready);
      el.bombCd.classList.toggle('ready', ready && state.bombs > 0);
    }
    if (el.btnBuyBomb) {
      el.btnBuyBomb.disabled = state.money < BOMB_COST || state.bombs >= BOMB_MAX;
      const label = state.bombs >= BOMB_MAX ? '💣 已满 (' + BOMB_MAX + ')' : '买一颗 🪙' + BOMB_COST;
      if (el.btnBuyBomb.textContent !== label) el.btnBuyBomb.textContent = label;
    }

    /* 升级台面板：只有会刷升级台的关卡才显示（第一关没有） */
    if (el.benchBlock) el.benchBlock.classList.toggle('off', !state.benchCell);
    /* 钩索面板：只有带钩索的关卡才显示 */
    if (el.hookBlock) el.hookBlock.classList.toggle('off', !state.hookOn);
    if (state.hookOn && el.hookState) {
      let txt, cdTxt, busy;
      const latch = state.carry ? null : hookTower();
      if (state.carry) {
        const cd = TOWERS[state.carry.type];
        if (cd.isBench) { txt = '端着升级台'; cdTxt = 'Shift 扣到塔上'; }
        else { txt = '搬运中 · ' + cd.name; cdTxt = 'Shift 放下'; }
        busy = false;
      } else if (latch) {
        txt = '已搭到' + (TOWERS[latch.type].isBench ? '升级台' : '防御塔');
        cdTxt = 'Shift 端起';
        busy = false;
      } else if (state.dashCd > 0) { txt = '冷却中'; cdTxt = state.dashCd.toFixed(1) + 's'; busy = true; }
      else { txt = '就绪'; cdTxt = 'Shift 位移'; busy = false; }
      if (el.hookState.textContent !== txt) el.hookState.textContent = txt;
      if (el.hookCd && el.hookCd.textContent !== cdTxt) el.hookCd.textContent = cdTxt;
      if (el.hookCd) el.hookCd.classList.toggle('busy', busy);
      if (el.hookCd) el.hookCd.classList.toggle('ready', !busy);
    }

    /* 波次信息与进度条 */
    const bar = el.bar.parentElement;
    if (state.phase === 'prep') {
      bar.classList.remove('battle');
      const next = WAVES[state.waveIndex];
      el.next.textContent = next ? '下一波：' + waveLabel(next) : '已是最后一波';
      el.bar.style.width = (100 - (state.countdown / PREP_TIME) * 100).toFixed(1) + '%';
      el.btnWave.disabled = false;
      el.btnWave.textContent = '▶ 立即开始第 ' + (state.waveIndex + 1) + ' 波（' + Math.ceil(state.countdown) + 's）';
    } else if (state.phase === 'battle') {
      bar.classList.add('battle');
      const total = state.waveTotal || 1;
      const left = state.enemies.length + state.spawnQueue.length;
      el.next.textContent = '第 ' + (state.waveIndex + 1) + ' 波进行中 · 剩余 ' + left + ' 个敌人';
      el.bar.style.width = (100 - (left / total) * 100).toFixed(1) + '%';
      el.btnWave.disabled = true;
      el.btnWave.textContent = '⚔ 战斗中…';
    } else if (state.phase === 'pickup') {
      bar.classList.remove('battle');
      el.bar.style.width = '100%';
      el.next.textContent = state.hookDrop ? '最后一只怪掉了一把钩爪，左键点它捡起来' : '钩爪已到手，正在前往第二关…';
      el.btnWave.disabled = true;
      el.btnWave.textContent = '🪝 捡起钩爪…';
    } else {
      bar.classList.remove('battle');
      el.btnWave.disabled = true;
      el.next.textContent = state.phase === 'won' ? '全部波次已清除' : '防线已被攻破';
    }

    /* 选中塔面板中的动态按钮 */
    const up = el.selection.querySelector('[data-action="upgrade"]');
    if (up && state.selectedTower) {
      const t = state.selectedTower;
      const cost = t.level < MAX_LEVEL - 1 ? TOWERS[t.type].upgrade[t.level] : null;
      up.disabled = cost === null || state.money < cost;
    }
  }

  function syncSelection(force) {
    const t = state.selectedTower;
    const key = t ? t.id + ':' + t.level : 'none';
    if (!force && key === state.selKey) return;
    state.selKey = key;

    if (!t) {
      el.selection.className = 'selection empty';
      el.selection.innerHTML = '<p class="muted">点击地图上的防御塔，可以查看、升级或出售它。</p>';
      return;
    }
    const def = TOWERS[t.type];
    const st = statsOf(t);
    const next = def.levels[t.level + 1];
    const upCost = t.level < MAX_LEVEL - 1 ? def.upgrade[t.level] : null;
    const sell = Math.floor(t.spent * SELL_RATE);
    const maxLv = def.levels.length;               // 升级台能把塔顶到这一级

    /* 升级台：它没有伤害/射程，单独给一块说明面板，别显示一堆 0 */
    if (def.isBench) {
      el.selection.className = 'selection';
      el.selection.innerHTML =
        '<div class="sel-head"><span class="ic">' + def.icon + '</span>' +
        '<span><span class="nm">' + def.name + '</span> <span class="lv">固定设施</span></span></div>' +
        '<dl class="kv">' +
        '<dt>特性</dt><dd style="color:#fbbf24">无敌 · 拆不掉也卖不掉 · 每波清完刷一个</dd>' +
        '<dt>用法</dt><dd>用钩索端起它，走到自己的塔旁边（96 像素内）再按一次 <b>左 Shift</b>：' +
        '那座塔<b>免费升一级</b>，而且能突破 3 级上限、一路顶到 LV' +
        TOWERS.arrow.levels.length + '</dd>' +
        '</dl><div class="row"><button class="btn" disabled>🪝 用钩索端起它</button></div>';
      return;
    }

    /* 保护伞：固定设施，没有伤害，单独给一块说明面板 */
    if (def.isUmbrella) {
      el.selection.className = 'selection';
      el.selection.innerHTML =
        '<div class="sel-head"><span class="ic">' + def.icon + '</span>' +
        '<span><span class="nm">' + def.name + '</span> <span class="lv">固定设施</span></span></div>' +
        '<dl class="kv">' +
        '<dt>特性</dt><dd style="color:#86efac">无敌 · 拆不掉也卖不掉 · 蹦极偷不走它</dd>' +
        '<dt>作用</dt><dd>半径 <b>' + UMBRELLA_R + '</b> 像素内的防御塔，在蹦极落地那一刻会被<b>弹飞</b>——' +
        '蹦极直接消失，塔保住；<b>对靶子本身没有任何影响</b></dd>' +
        '<dt>搬动</dt><dd>用 <b>左 Shift</b> 甩钩索端起它，走到想要的位置再按一次：<b>连路面都能放</b></dd>' +
        '<dt>数量</dt><dd>开场给 <b>2</b> 把，不补发 · 罩哪儿要自己权衡</dd>' +
        '</dl><div class="row"><button class="btn" disabled>☂️ 用左 Shift 搬动它</button></div>';
      return;
    }

    function diff(cur, nxt, unit) {
      unit = unit || '';
      if (nxt === undefined || nxt === null) return '<dd>' + cur + unit + '</dd>';
      return '<dd>' + cur + unit + ' <span class="up">→ ' + nxt + unit + '</span></dd>';
    }

    let html = '<div class="sel-head">' +
      '<span class="ic">' + def.icon + '</span>' +
      '<span><span class="nm">' + def.name + '</span> ' +
      '<span class="lv">LV ' + (t.level + 1) + ' / ' + maxLv + '</span></span>' +
      '</div><dl class="kv">' +
      '<dt>伤害</dt>' + diff(st.damage, next && next.damage) +
      '<dt>射程</dt>' + diff(st.range, next && next.range) +
      '<dt>攻速</dt>' + diff(st.rate.toFixed(2), next && next.rate.toFixed(2), '/秒') +
      '<dt>耐久</dt><dd>' + Math.ceil(t.hp) + ' / ' + t.hpMax +
      (next ? ' <span class="up">→ ' + towerHpMax(t.type, t.level + 1) + '</span>' : '') + '</dd>' +
      '<dt>击杀</dt><dd>' + t.kills + '</dd>';

    if (t.type === 'cannon') {
      html += '<dt>溅射</dt>' + diff(st.splash, next && next.splash) +
        '<dt>弱点</dt><dd style="color:#fbbf24">会被诱饵吸引火力</dd>';
    }
    if (t.type === 'frost') {
      html += '<dt>冰冻</dt><dd>' + st.freeze.toFixed(2) + 's' +
        (next ? ' <span class="up">→ ' + next.freeze.toFixed(2) + 's</span>' : '') + '</dd>' +
        '<dt>说明</dt><dd style="color:#93c5fd">命中的怪彻底定住（不走路、不拆塔、不施法）· 首领免疫</dd>';
    }
    if (def.invincible) {
      html += '<dt>特性</dt><dd style="color:#86efac">无敌 · 拆不掉，也拆不卖</dd>';
    }
    html += '</dl><div class="row">';

    if (def.invincible) {
      html += '<button class="btn" disabled>免维护设施</button>' +
        '<button class="btn" disabled>🪝 用钩索搬走</button></div>';
      el.selection.className = 'selection';
      el.selection.innerHTML = html;
      return;
    }

    if (upCost === null) {
      const canBench = t.level + 1 < maxLv;
      html += '<button class="btn" disabled>' +
        (canBench ? '已到 3 级上限 · 要用升级台' : '已满级 LV' + maxLv) + '</button>';
    } else {
      html += '<button class="btn gold" data-action="upgrade">⬆ 升级 (F) 🪙' + upCost + '</button>';
    }
    html += '<button class="btn danger" data-action="sell">💰 拆除 (C) +' + sell + '</button></div>';

    el.selection.className = 'selection';
    el.selection.innerHTML = html;
  }

  /* ============================================================
   * 10. 输入
   * ============================================================ */
  function toCanvas(ev) {
    const rect = cv.getBoundingClientRect();
    return {
      x: (ev.clientX - rect.left) * (W / rect.width),
      y: (ev.clientY - rect.top) * (H / rect.height),
    };
  }

  function updateMouse(ev) {
    const p = toCanvas(ev);
    state.mouse.x = Math.max(0, Math.min(W, p.x));
    state.mouse.y = Math.max(0, Math.min(H, p.y));
  }

  function cellOf(ev) {
    const p = toCanvas(ev);
    const c = Math.floor(p.x / TILE), r = Math.floor(p.y / TILE);
    if (c < 0 || c >= COLS || r < 0 || r >= ROWS) return null;
    return { c: c, r: r };
  }

  /** 鼠标位置上的塔是否在主角够得着的范围内 */
  function towerUnderMouse(ev) {
    const cell = cellOf(ev);
    if (!cell) return null;
    const t = towerAt(cell.c, cell.r);
    if (!t) return null;
    const h = state.hero;
    if (dist2(t.x, t.y, h.x, h.y) > h.reach * h.reach) return null;
    return t;
  }

  cv.addEventListener('mousemove', updateMouse);
  cv.addEventListener('mouseleave', function () { state.mouse.down = false; });

  /* 鼠标左键：点到主角附近的防御塔 = 直接选中它；否则主角射箭 */
  cv.addEventListener('mousedown', function (ev) {
    if (ev.button !== 0) return;
    updateMouse(ev);
    if (!state.started) return;
    if (state.buildOpen) { closeBuild(); return; }

    /* 第一关掉在地上的钩爪：左键点它就直接捡起来 */
    if (state.hookDrop) {
      const dd = state.hookDrop;
      if (dist2(state.mouse.x, state.mouse.y, dd.x, dd.y) <= 70 * 70) {
        state.mouse.down = false;
        takeHookDrop();
        return;
      }
    }

    const t = towerUnderMouse(ev);
    if (t) {
      state.selectedTower = t;
      state.marked = null;
      state.mouse.down = false;
      syncSelection(true);
      toast('已选中 ' + TOWERS[t.type].name + '（LV' + (t.level + 1) + '）：F 升级 · 右键拆除');
      return;
    }
    state.mouse.down = true;
    heroFire(state.mouse.x, state.mouse.y);
  });
  window.addEventListener('mouseup', function () { state.mouse.down = false; });

  /* 鼠标右键：点到主角附近的防御塔 = 直接拆除；否则取消选中 */
  cv.addEventListener('contextmenu', function (ev) {
    ev.preventDefault();
    state.mouse.down = false;
    if (!state.started) return;
    if (state.buildOpen) { closeBuild(); return; }

    const t = towerUnderMouse(ev);
    if (t) {
      state.selectedTower = t;
      sellSelected();
      toast('已快速拆除');
      return;
    }
    state.marked = null;
    state.selectedTower = null;
    syncSelection(true);
  });

  /* 升级菜单：鼠标选择强化 */
  if (el.levelMenu) {
    el.levelMenu.addEventListener('click', function (ev) {
      const btn = ev.target.closest('[data-perk]');
      if (!btn) return;
      choosePerk(btn.getAttribute('data-perk'));
    });
  }

  /* 新敌人说明卡片：点一下收掉（不暂停游戏） */
  if (el.enemyPopup) {
    el.enemyPopup.addEventListener('click', function (ev) {
      ev.stopPropagation();
      closeEnemyPopup();
    });
  }

  /* 建造菜单：鼠标选择三种塔 */
  if (el.buildMenu) {
    el.buildMenu.addEventListener('click', function (ev) {
      const btn = ev.target.closest('[data-tower]');
      if (!btn || btn.disabled) return;
      chooseTower(btn.getAttribute('data-tower'));
    });
    el.buildMenu.addEventListener('contextmenu', function (ev) { ev.preventDefault(); closeBuild(); });
  }

  /* 选中面板：升级 / 拆除 */
  el.selection.addEventListener('click', function (ev) {
    const btn = ev.target.closest('[data-action]');
    if (!btn || btn.disabled) return;
    const act = btn.getAttribute('data-action');
    if (act === 'upgrade') upgradeSelected();
    else if (act === 'sell') sellSelected();
  });

  /* 重新开始 / 回关卡选择 / 操作说明 */
  document.addEventListener('click', function (ev) {
    const btn = ev.target.closest('[data-action]');
    if (!btn) return;
    const act = btn.getAttribute('data-action');
    if (act === 'restart') resetGame(false);
    else if (act === 'menu') { resetGame(false); openStartScreen(); }
  });
  if (el.btnLevel1) el.btnLevel1.addEventListener('click', function () { chooseLevel(0); });
  if (el.btnLevel2) el.btnLevel2.addEventListener('click', function () { chooseLevel(1); });
  if (el.btnLevel3) el.btnLevel3.addEventListener('click', function () { chooseLevel(2); });
  /* 封面页：点「开始游戏」收起封面，露出后面的新手教学 / 选关（游戏仍然是暂停的） */
  if (el.btnCover) el.btnCover.addEventListener('click', function () {
    hideCover();
    SFX.build();
    SFX.musicStart();      // 背景音乐在这里起播：浏览器要求先有用户交互
  });
  if (el.btnGuideOk) el.btnGuideOk.addEventListener('click', function () { startGame(false); });
  if (el.btnGuide3Ok) el.btnGuide3Ok.addEventListener('click', function () { startGame(false); });
  if (el.btnNextLevel) el.btnNextLevel.addEventListener('click', function () { chooseLevel(state.levelIdx + 1); });
  if (el.btnHelp) el.btnHelp.addEventListener('click', function () {
    /* 第三关看蹦极/保护伞说明，第二关看道具说明，否则看开始页 */
    if (state.levelIdx === 2 && el.itemGuide3) {
      state.started = false;
      el.itemGuide3.classList.remove('hidden');
      if (el.overlay) el.overlay.classList.add('hidden');
    } else if (state.hookOn && el.itemGuide) {
      state.started = false;
      el.itemGuide.classList.remove('hidden');
      if (el.overlay) el.overlay.classList.add('hidden');
    } else {
      openStartScreen();
    }
  });
  if (el.btnBuyBomb) el.btnBuyBomb.addEventListener('click', function () { buyBomb(); });

  /* 键盘 */
  const MOVE_KEYS = {
    w: 'w', a: 'a', s: 's', d: 'd',
    arrowup: 'arrowup', arrowdown: 'arrowdown', arrowleft: 'arrowleft', arrowright: 'arrowright',
  };

  window.addEventListener('keydown', function (ev) {
    const k = (ev.key || '').toLowerCase();

    /* 还没开始：只响应「开始游戏」 */
    if (!state.started) {
      if (k === 'enter' || ev.code === 'Space') { ev.preventDefault(); startGame(); }
      return;
    }
    /* 钩索位移途中方向键被禁用：整段位移只听钩索的 */
    if (MOVE_KEYS[k]) {
      ev.preventDefault();
      if (hookMoving()) return;
      state.keys[k] = true;
      return;
    }

    if (ev.code === 'Space') { ev.preventDefault(); togglePause(); return; }
    if (k === 'z') { ev.preventDefault(); heroSelect(); return; }
    if (k === 'b') { ev.preventDefault(); if (state.buildOpen) closeBuild(); else openBuild(); return; }
    if (k === 'f') { ev.preventDefault(); upgradeSelected(); return; }
    if (k === 'c') { ev.preventDefault(); sellSelected(); return; }
    if (k === 'x') { ev.preventDefault(); useBomb(); return; }
    /* ? ：再看一次道具说明（有钩索的关卡）或操作说明 */
    if (k === '?' || k === '/') {
      ev.preventDefault();
      if (state.levelIdx === 2 && el.itemGuide3) {
        state.started = false;
        el.itemGuide3.classList.remove('hidden');
        if (el.overlay) el.overlay.classList.add('hidden');
      } else if (state.hookOn && el.itemGuide) {
        state.started = false;
        el.itemGuide.classList.remove('hidden');
        if (el.overlay) el.overlay.classList.add('hidden');
      } else {
        openStartScreen();
      }
      return;
    }
    /* 左 Shift：钩索（冲刺 / 勾塔 / 放塔） */
    if (ev.code === 'ShiftLeft' || ev.code === 'ShiftRight' || k === 'shift') {
      ev.preventDefault();
      if (!ev.repeat) useHook();
      return;
    }
    if (k === 'escape') {
      if (state.enemyPopup) { closeEnemyPopup(); return; }   // 先收掉新敌人卡片
      if (state.buildOpen) { closeBuild(); return; }
      state.marked = null;
      state.selectedTower = null;
      syncSelection(true);
      return;
    }
    /* 建造 / 升级菜单打开时可以用 1/2/3 快速选择 */
    if (state.levelOpen && (k === '1' || k === '2' || k === '3')) {
      const p = state.levelChoices[Number(k) - 1];
      if (p) choosePerk(p.id);
      return;
    }
    if (state.buildOpen && (k === '1' || k === '2' || k === '3')) {
      chooseTower(TOWER_KEYS[Number(k) - 1]);
    }
  });

  window.addEventListener('keyup', function (ev) {
    const k = (ev.key || '').toLowerCase();
    if (MOVE_KEYS[k]) state.keys[k] = false;
  });
  window.addEventListener('blur', function () { state.keys = {}; state.mouse.down = false; });

  function togglePause() {
    if (state.phase === 'won' || state.phase === 'lost') return;
    state.paused = !state.paused;
    el.btnPause.textContent = state.paused ? '▶ 继续' : '⏸ 暂停';
  }

  el.btnWave.addEventListener('click', function () { startWave(true); });
  el.btnPause.addEventListener('click', togglePause);
  el.btnSpeed.addEventListener('click', function () {
    state.speed = state.speed === 1 ? 2 : 1;
    el.btnSpeed.textContent = '⏩ x' + state.speed;
  });
  el.btnSound.addEventListener('click', function () {
    const on = SFX.toggle();
    el.btnSound.textContent = on ? '🔊 音效' : '🔇 静音';
  });

  /* ============================================================
   * 11.5 开始页面 / 新手引导
   * ============================================================ */
  /* 开局阶段的引导提示（只在整个页面第一次玩时出现） */
  const HINTS = [
    { t: 12, text: '① 用 WASD 移动主角：走到空地上按 Z 标记，再按 B 建塔' },
    { t: 18, text: '② 鼠标左键让主角射箭（按住可连发）；左键点身边的塔可以直接选中' },
    { t: 36, text: '③ 选中塔后按 F 升级、按 C 拆除；右键点塔是快速拆除' },
    { t: 54, text: '④ 击杀敌人主角会升级，升级时用鼠标从三个强化里选一个' },
  ];
  const hintShown = HINTS.map(function () { return false; });

  /** 收起封面页（只由封面上的「开始游戏」触发；回关卡选择时不会再弹回来） */
  function hideCover() {
    if (el.coverScreen) el.coverScreen.classList.add('hidden');
  }

  /* 封面立绘「跟着鼠标转身」：鼠标在左边就整体镜像朝左、在右边就朝右，
     同时按远近轻微倾斜 + 一点点视差；停手后会自己缓缓回正。
     变换写在 CSS 变量上（--face / --tilt / --px / --py），由 coverFloat 关键帧带进 transform，
     这样和原来的上下浮动可以叠加。只有封面可见时才跑，动画停下就熄火。 */
  let coverFollow = null;   // 仅供调试/测试查看当前缓动值
  function initCoverFollow() {
    const cover = el.coverScreen;
    if (!cover || typeof cover.querySelector !== 'function') return;
    const img = cover.querySelector('.cover-art img');
    if (!img || typeof img.getBoundingClientRect !== 'function') return;
    const cur = { x: 0, y: 0, face: 1 };   // 已经平滑过的值
    const aim = { x: 0, y: 0, face: 1 };   // 鼠标给出的目标值
    let raf = 0;
    const setVar = function (name, value) {
      if (img.style && typeof img.style.setProperty === 'function') img.style.setProperty(name, value);
    };
    function paint() {
      setVar('--face', cur.face.toFixed(3));
      setVar('--tilt', (cur.x * 7).toFixed(2) + 'deg');
      setVar('--px', (cur.x * 9).toFixed(2) + 'px');
      setVar('--py', (cur.y * 5).toFixed(2) + 'px');
    }
    function tick() {
      const k = 0.18;                       // 每帧追 18%，大约 0.2 秒追上
      cur.x += (aim.x - cur.x) * k;
      cur.y += (aim.y - cur.y) * k;
      cur.face += (aim.face - cur.face) * k;
      paint();
      const miss = Math.abs(aim.x - cur.x) + Math.abs(aim.y - cur.y) + Math.abs(aim.face - cur.face);
      if (miss > 0.004) {
        raf = requestAnimationFrame(tick);
      } else {
        raf = 0;
        cur.x = aim.x; cur.y = aim.y; cur.face = aim.face;
        paint();
      }
    }
    function kick() { if (!raf) raf = requestAnimationFrame(tick); }

    function onMove(ev) {
      if (cover.classList.contains('hidden')) return;
      const r = img.getBoundingClientRect();
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      const spanX = Math.max(120, r.width * 0.7);
      const spanY = Math.max(120, r.height * 0.7);
      aim.x = Math.max(-1, Math.min(1, (ev.clientX - cx) / spanX));
      aim.y = Math.max(-1, Math.min(1, (ev.clientY - cy) / spanY));
      /* 中间留 14px 死区，免得鼠标停在正中时左右乱翻 */
      if (Math.abs(ev.clientX - cx) > 14) aim.face = ev.clientX < cx ? -1 : 1;
      kick();
    }
    function rest() { aim.x = 0; aim.y = 0; aim.face = 1; kick(); }

    window.addEventListener('mousemove', onMove, { passive: true });
    window.addEventListener('mouseleave', rest);
    window.addEventListener('blur', rest);
    coverFollow = { cur: cur, aim: aim, onMove: onMove, rest: rest, paint: paint };
  }

  function openStartScreen() {
    state.started = false;
    state.keys = {};
    state.mouse.down = false;
    closeBuild();
    closeLevelMenu();
    if (el.itemGuide) el.itemGuide.classList.add('hidden');
    if (el.itemGuide3) el.itemGuide3.classList.add('hidden');
    if (el.startScreen) el.startScreen.classList.remove('hidden');
    refreshLevelButtons();
  }

  /** 刷新开始页上的关卡按钮（第二关要通关第一关才解锁，第三关要通关第二关） */
  function refreshLevelButtons() {
    if (!el.btnLevel2) return;
    const unlocked = !!save.hook;
    const unlocked3 = !!save.lv3;
    el.btnLevel2.classList.toggle('locked', !unlocked);
    el.btnLevel2.textContent = unlocked ? '▶ 第二关 · 双子回廊' : '🔒 第二关 · 双子回廊';
    el.btnLevel2.disabled = !unlocked;
    if (el.btnLevel3) {
      el.btnLevel3.classList.toggle('locked', !unlocked3);
      el.btnLevel3.textContent = unlocked3 ? '▶ 第三关 · 浮桥水镇' : '🔒 第三关 · 浮桥水镇';
      el.btnLevel3.disabled = !unlocked3;
    }
    if (el.startTip) {
      el.startTip.innerHTML = unlocked3
        ? '提示：第三关是 <b>红主路 + 绿侧路 + 河道</b>，蹦极会往塔上扔靶子偷塔——记得用<b>保护伞</b>罩住塔。'
        : unlocked
          ? '提示：第二关是 <b>两条路统一出怪</b>——每批怪对半轮流走两条路，两边的压力永远一样大。'
          : '提示：第一关有 <b>三条路</b>——第 4 波开右上方的侧路、第 6 波开左下方的地道，记得提前分兵。';
    }
    if (el.startUnlock) {
      el.startUnlock.innerHTML = unlocked3
        ? '🏆 三关全部解锁：第三关有<b>蹦极</b>与<b>保护伞</b>，开场会有一份机制说明。'
        : unlocked
          ? '🪝 钩索已解锁：第二关开场会有一份<b>道具使用说明</b>；通关第二关解锁第三关。'
          : '通关第一关会掉落新道具 <b>🪝 钩索</b>，并解锁第二关；通关第二关解锁 <b>第三关</b>。';
    }
  }

  /** 选好关卡：第二 / 第三关先说明，读完再开打 */
  function chooseLevel(idx) {
    if (idx === 1 && !save.hook) { toast('先通关第一关才能解锁第二关', 'warn'); return; }
    if (idx === 2 && !save.lv3) { toast('先通关第二关才能解锁第三关', 'warn'); return; }
    state.levelIdx = idx;
    resetGame(false);                       // 直接进关卡，不显示开始页
    if (el.startScreen) el.startScreen.classList.add('hidden');
    if (idx === 1 && el.itemGuide) {
      /* 第二关：开场道具说明，点「开始第二关」才真正开始 */
      state.started = false;
      el.itemGuide.classList.remove('hidden');
      return;
    }
    if (idx === 2 && el.itemGuide3) {
      /* 第三关：开场机制说明（蹦极 / 保护伞 / 升级台） */
      state.started = false;
      el.itemGuide3.classList.remove('hidden');
      return;
    }
    startGame(false);
  }

  function startGame(noToast) {
    if (state.started) return;
    state.started = true;
    state.everStarted = true;
    state.hintT = 0;
    if (el.startScreen) el.startScreen.classList.add('hidden');
    if (el.itemGuide) el.itemGuide.classList.add('hidden');
    if (el.itemGuide3) el.itemGuide3.classList.add('hidden');
    if (state.phase === 'prep') state.countdown = PREP_TIME;
    if (state.phase === 'prep' && !noToast) {
      toast(state.hookOn
        ? '左 Shift 甩钩索：没搭到东西就冲过去，搭到塔就能把它搬走'
        : '用 WASD 移动主角，走到空地上按 Z 标记、按 B 建塔');
    }
  }

  function updateHints(dt) {
    state.hintT += dt;
    for (let i = 0; i < HINTS.length; i++) {
      if (!hintShown[i] && state.hintT >= HINTS[i].t) {
        hintShown[i] = true;
        toast(HINTS[i].text);
      }
    }
  }

  /* ============================================================
   * 11. 重置与主循环
   * ============================================================ */
  function resetGame(showStart) {
    const lv = LEVEL_SETUP[state.levelIdx];
    activateLevel(state.levelIdx);         // 重建地图、路线、装饰、波次
    state.phase = 'prep';
    state.money = Math.round(lv.money * HELL.money);   // 地狱难度：开局金币 ×0.7
    state.lives = HELL.lives;                          // 地狱难度：两关统一 5 点
    state.waveIndex = 0;
    state.countdown = PREP_TIME;
    state.battleTime = 0;
    state.kills = 0;
    state.flash = 0;
    state.paused = false;
    state.towers = [];
    state.enemies = [];
    state.shots = [];
    state.bits = [];
    state.texts = [];
    state.spawnQueue = [];
    state.pending = [];
    state.rocks = [];
    state.swords = [];
    state.throws = [];
    state.hookDrop = null;
    state.lastKill = null;
    state.hookTaken = 0;
    hookGoPending = false;
    state.selectedTower = null;
    state.marked = null;
    state.carry = null;
    state.dashT = 0;
    state.dashCd = 0;
    state.dashTo = null;
    state.enemyPopup = null;
    state.enemyQueue = [];
    /* seenEnemies 故意不在这里清空：某种怪整个游戏只「报到」一次，
     * 换关、重新开局都不再重复弹卡（重新打开页面才重置） */
    if (el.enemyPopup) el.enemyPopup.classList.add('hidden');
    bgDirty = true;
    state.bombs = START_BOMBS;
    state.bombCd = 0;
    state.nextId = 1;
    state.waveTotal = 0;
    state.keys = {};
    state.mouse.down = false;
    state.hero.x = TILE * 6;
    state.hero.y = TILE * 11;
    if (lv.heroStart) {
      state.hero.x = lv.heroStart.c * TILE + TILE / 2;
      state.hero.y = lv.heroStart.r * TILE + TILE / 2;
    }
    /* 升级台：第二关每波清完后由 spawnBench() 刷在交付台上；第三关开场就送一座。
     * 保护伞同理：第三关开场的那把也是这里摆的（之后全靠钩索搬）。 */
    if (lv.startUmbrellas) {
      for (let i = 0; i < lv.startUmbrellas.length; i++) {
        const p = lv.startUmbrellas[i];
        makeUmbrella(p.c, p.r);
      }
    }
    if (lv.startBench) spawnBench();
    state.hero.cd = 0;
    state.hero.recoil = 0;
    state.hero.hpMax = 60;
    state.hero.hp = 60;
    state.hero.damage = HERO_DAMAGE;
    state.hero.rate = 0.35;
    state.hero.range = 320;
    state.hero.speed = 245;
    state.hero.reach = 112;
    state.hero.regen = 8;
    state.hero.level = 1;
    state.hero.xp = 0;
    state.hero.xpNeed = xpNeedFor(1);
    state.hero.pending = 0;
    state.hero.perks = [];
    state.hero.knockMul = 1;
    state.hero.pierceCount = 0;
    state.hero.spread = 0;
    state.hero.hurtT = 99;
    state.hero.invuln = 0;
    state.hero.flash = 0;
    state.hero.dir = -Math.PI / 2;
    state.hero.aim = -Math.PI / 2;
    /* 贴图动画状态复位；spawn 留到贴图真的加载好那一刻再播（见 loadHeroSprite） */
    state.hero.look = -Math.PI / 2;
    state.hero.face = 1;
    state.hero.lean = 0;
    state.hero.pop = 0;
    state.hero.spawn = HERO_SPRITE.ok ? 1 : 0;
    state.hero.dashFx = 0;
    state.hero.ghost = [];
    state.hero.ghostT = 0;
    state.hero.deathAt = 0;
    closeLevelMenu();
    closeBuild();
    el.overlay.classList.add('hidden');
    el.btnPause.textContent = '⏸ 暂停';
    document.getElementById('toasts').innerHTML = '';
    if (showStart) openStartScreen();
    else { state.started = true; if (el.startScreen) el.startScreen.classList.add('hidden'); }
    syncSelection(true);
    syncHUD();
  }

  let last = performance.now();
  let loopErrs = 0;
  let stillFrames = 3;      // 静止状态（未开始/暂停/结束）还需要重绘几帧，之后就完全停手
  let wasRunning = false;
  function frame(now) {
    let dt = (now - last) / 1000;
    last = now;
    /* 单帧最多补 0.12 秒，而且一帧最多追 8 个子步：
     * 万一某帧特别慢（切标签页、系统卡顿），宁可让游戏慢一点，
     * 也不要为了「追上时间」在一帧里跑几十次 update —— 那会越追越卡 */
    if (dt > 0.12) dt = 0.12;

    try {
      const running = state.started && !state.paused && state.phase !== 'won' && state.phase !== 'lost';
      /* 主角阵亡的 1.8 秒里即使已经判定失败，也要继续出帧把倒下的动画放完 */
      const dying = state.hero.deathAt > 0 && (now - state.hero.deathAt) < 1800;
      if (running) {
        let left = dt * state.speed;
        let guard = 0;
        while (left > 0 && guard++ < 8) {
          const step = Math.min(left, 1 / 60);
          update(step);
          left -= step;
        }
        stillFrames = 2;
      } else if (wasRunning || dying) {
        stillFrames = 2;                  // 刚停下：补画两帧（暂停字样 / 结算画面）
      }
      wasRunning = running;

      if (bgDirty) { rebuildBg(); stillFrames = 2; }
      /* 画面完全静止时没必要每帧重画 —— 这是之前「卡顿」的一大来源 */
      if (stillFrames > 0) {
        render();
        if (stillFrames > 0) stillFrames--;
      }
      syncHUD();
    } catch (err) {
      /* 任何一帧出错都不能让循环停掉——否则游戏会彻底卡死 */
      loopErrs++;
      if (loopErrs <= 3) {
        console.error('[绿野防线] 主循环异常（已跳过本帧）：', err);
        if (loopErrs === 1) toast('捕获到一个内部错误，已跳过本帧继续运行', 'warn');
      }
      stillFrames = 2;
    }

    requestAnimationFrame(frame);
  }

  buildShop();
  buildBuildMenu();
  loadHeroSprite();         // 主角立绘（异步；没加载上就继续用矢量小人）
  loadBossSprite();         // 首领立绘（异步；没加载上就继续用红色首领球）
  loadEnemySprite();        // 小怪立绘（异步；没加载上就继续用彩色圆球）
  loadL3Sprites();          // 第三关：蹦极 / 靶子 / 保护伞立绘（异步，没加载上就退回简笔）
  initCoverFollow();        // 封面立绘跟着鼠标转身
  resetGame(true);          // 首次进入停在开始页面 / 关卡选择
  refreshLevelButtons();
  requestAnimationFrame(frame);
})();
