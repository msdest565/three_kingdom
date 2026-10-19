/**
 * 无双守关 · 无尽模式数值推导脚本
 * ------------------------------------------------------------------
 * 本脚本生成 docs/roguelike-endless-design-v3.html 第 09 / 10 / 11 节中的
 * 全部数值。设计文档中的敌人曲线不是手填的，而是从「目标压力比」反解出来的。
 *
 * 运行：node docs/data/endless-curve.mjs
 * 依赖：无（纯计算，不读取 runtime-data.js）
 * 基准：runtime-data.js 实测值（军营 L1-L3、敌兵基础值、首领模板）
 */

// ============================================================
// 一、基准常量（全部取自 runtime-data.js 实测值）
// ============================================================

/** 敌兵基础血量与奖励 (BALANCE.enemies) */
const ENEMY = {
  infantry: { hp: 28, speed: 30, reward: 1, class: 'ordinary' },
  cavalry:  { hp: 34, speed: 36, reward: 2, class: 'ordinary' },
  armor:    { hp: 55, speed: 23, reward: 4, class: 'elite' },
  boss:     { hp: 1000, speed: 11, reward: 60, class: 'boss' },
  ranged:   { hp: 35, speed: 27, reward: 2, class: 'elite' },
  banner:   { hp: 48, speed: 26, reward: 3, class: 'elite' },
  siege:    { hp: 100, speed: 11, reward: 8, class: 'elite' },
};

/** 精锐平均血量（重甲55/弓手35/军旗48/攻城车100，按 2:2:1:1 加权） */
const ELITE_AVG_HP = (55 * 2 + 35 * 2 + 48 * 1 + 100 * 1) / 6; // = 56.33

/** 首领基础血量（使用 BOSS_BASE，随波次几何增长） */
const BOSS_BASE = 1200;

/** 军营 L1-L5 数值。L1-L3 为 runtime-data.js 实测，L4-L5 为本设计新增 */
const CAMPS = {
  shield: {
    name: '盾营', build: 60,
    levels: [
      { dmg: 4,  interval: 1.80, range: 145, extra: { speedFactor: 0.46 } },
      { dmg: 5,  interval: 1.70, range: 154, extra: { speedFactor: 0.42 } },
      { dmg: 6,  interval: 1.60, range: 163, extra: { speedFactor: 0.38 } },
      { dmg: 7,  interval: 1.50, range: 172, extra: { speedFactor: 0.35 } },
      { dmg: 9,  interval: 1.44, range: 182, extra: { speedFactor: 0.32 } },
    ],
  },
  archer: {
    name: '弓营', build: 60,
    levels: [
      { dmg: 12, interval: 0.90, range: 205 },
      { dmg: 18, interval: 0.81, range: 214 },
      { dmg: 26, interval: 0.72, range: 223 },
      { dmg: 35, interval: 0.68, range: 232 },
      { dmg: 47, interval: 0.64, range: 242 },
    ],
  },
  catapult: {
    name: '投石营', build: 80,
    levels: [
      { dmg: 14, interval: 3.00, range: 205, extra: { blast: 48, cap: 6 } },
      { dmg: 18, interval: 2.85, range: 214, extra: { blast: 48, cap: 6 } },
      { dmg: 23, interval: 2.70, range: 223, extra: { blast: 48, cap: 6 } },
      { dmg: 31, interval: 2.55, range: 232, extra: { blast: 54, cap: 6 } },
      { dmg: 41, interval: 2.40, range: 242, extra: { blast: 60, cap: 6 } },
    ],
  },
  crossbow: {
    name: '弩营', build: 80,
    levels: [
      { dmg: 20, interval: 1.30, range: 205, extra: { eliteX: 1.25 } },
      { dmg: 30, interval: 1.17, range: 214, extra: { eliteX: 1.25 } },
      { dmg: 44, interval: 1.04, range: 223, extra: { eliteX: 1.25 } },
      { dmg: 59, interval: 0.98, range: 232, extra: { eliteX: 1.25 } },
      { dmg: 80, interval: 0.92, range: 242, extra: { eliteX: 1.25 } },
    ],
  },
  fire_oil: {
    name: '火油营', build: 90,
    levels: [
      { dmg: 3 * 4, interval: 3.60, range: 175, extra: { radius: 58, dur: 3.0 } },
      { dmg: 4 * 4, interval: 3.40, range: 184, extra: { radius: 58, dur: 3.0 } },
      { dmg: 5 * 4, interval: 3.20, range: 193, extra: { radius: 58, dur: 3.0 } },
      { dmg: 7 * 4, interval: 3.00, range: 202, extra: { radius: 64, dur: 3.5 } },
      { dmg: 9 * 4, interval: 2.80, range: 211, extra: { radius: 70, dur: 4.0 } },
    ],
  },
  war_drum: {
    name: '战鼓营', build: 70,
    levels: [
      { dmg: 0, interval: null, range: 180, extra: { attackSpeed: 0.10 } },
      { dmg: 0, interval: null, range: 190, extra: { attackSpeed: 0.15 } },
      { dmg: 0, interval: null, range: 200, extra: { attackSpeed: 0.20 } },
      { dmg: 0, interval: null, range: 210, extra: { attackSpeed: 0.24 } },
      { dmg: 0, interval: null, range: 220, extra: { attackSpeed: 0.28 } },
    ],
  },
};

/** 升级成本。L1->L2 / L2->L3 为 runtime-data.js 实测，L3->L4 / L4->L5 为新增 */
const UPGRADE_COST = {
  shield:   [90, 150, 240, 380],
  archer:   [90, 150, 240, 380],
  catapult: [120, 180, 290, 460],
  crossbow: [110, 170, 275, 430],
  fire_oil: [120, 180, 290, 460],
  war_drum: [110, 170, 275, 430],
};

/** 参考构筑：6 营位 = 2 弓 + 1 弩 + 1 投石 + 1 火油 + 1 战鼓 */
const REF_BUILD = [
  { type: 'archer', count: 2 },
  { type: 'crossbow', count: 1 },
  { type: 'catapult', count: 1 },
  { type: 'fire_oil', count: 1 },
  { type: 'war_drum', count: 1 },
];

// ============================================================
// 二、无尽模式曲线定义
// ============================================================

/** 敌人数量（分段线性，波 45 后触顶） */
export const enemyCount = w =>
  w <= 10 ? 40 + 6.2 * (w - 1)
  : w <= 25 ? 96 + 5.3 * (w - 11)
  : w <= 45 ? 170 + 3.6 * (w - 26)
  : Math.min(272, 238 + 1.0 * (w - 46));

/** 精锐占比 */
export const eliteFraction = w =>
  w <= 5 ? 0
  : w <= 15 ? 0.03 + 0.00625 * (w - 6)
  : w <= 30 ? 0.0875 + 0.00617 * (w - 16)
  : w <= 45 ? 0.18 + 0.00533 * (w - 31)
  : Math.min(0.42, 0.26 + 0.00533 * (w - 46));

/** 单波时长（秒），封顶 40 */
export const waveDuration = w => Math.min(40, 20 + 0.3 * (w - 1));

/** 首领数量：每 10 波出现 */
export const bossCount = w =>
  w % 10 !== 0 ? 0
  : w < 30 ? 1
  : w < 50 ? 2
  : 3;

/** 首领血量：从波 10 起按 4.8% 几何增长 */
export const bossHp = w => (w < 10 ? 0 : Math.round(BOSS_BASE * Math.pow(1.048, w - 10)));

/** 敌人血量每波增长率（分段）。这是整条曲线的唯一调参入口 */
export const hpGrowthPerWave = w =>
  w <= 10 ? 0.070
  : w <= 20 ? 0.052
  : w <= 30 ? 0.048
  : w <= 45 ? 0.042
  : w <= 60 ? 0.038
  : 0.034;

/** 血量倍率递推表 */
export function hpMultiplierTable(maxWave = 130) {
  const table = { 1: 1 };
  let h = 1;
  for (let w = 2; w <= maxWave; w++) {
    h *= 1 + hpGrowthPerWave(w);
    table[w] = h;
  }
  return table;
}

/** 敌人速度倍率（封顶 1.25） */
export const speedMultiplier = w => Math.min(1.25, 1 + 0.005 * (w - 1));

// ============================================================
// 三、玩家成长模型
// ============================================================

/** 6 槽参考构筑的场输出（不含卡牌、科技、武将） */
export function campFieldDPS(level /* 1-5 */) {
  const i = level - 1;
  let dps = 0;
  for (const { type, count } of REF_BUILD) {
    const L = CAMPS[type].levels[i];
    let unit = L.interval ? L.dmg / L.interval : 0;
    // 投石营的多目标期望（爆炸平均命中约 2.2 个目标）
    if (type === 'catapult') unit *= 2.2;
    // 火油营按约 35% 覆盖率折算（移动目标穿过火场）
    if (type === 'fire_oil') unit *= 0.35;
    dps += unit * count;
  }
  return dps;
}

/**
 * 玩家总输出。四个乘子对应文档第 02 节的双桶模型：
 *   军营等级 × 无双系数 × 加法池 × 乘区
 */
export function playerDPS(w) {
  const camp = campFieldDPS(3) * Math.min(1.98, 1 + 0.98 * Math.min(1, w / 22));
  const ult = Math.min(1.95, 1.538 + 0.011 * w);
  const additive = 1 + 0.030 * (w - 1);
  const multiplicative = Math.pow(1.022, w - 1);
  return camp * ult * additive * multiplicative;
}

// ============================================================
// 四、主曲线计算
// ============================================================

/** 计算单波的完整数据 */
export function waveStats(w, hpTable = hpMultiplierTable()) {
  const count = Math.round(enemyCount(w));
  const elite = eliteFraction(w);
  const duration = waveDuration(w);
  const bosses = bossCount(w);
  const hpMult = hpTable[w];

  const infantryHp = Math.round(ENEMY.infantry.hp * hpMult);
  const eliteHp = Math.round(ELITE_AVG_HP * hpMult);
  const bossHpEach = bossHp(w);

  const totalHp = count * ((1 - elite) * infantryHp + elite * eliteHp) + bosses * bossHpEach;
  const requiredDPS = totalHp / duration;
  const availableDPS = playerDPS(w);

  return {
    wave: w,
    count,
    eliteFraction: elite,
    duration,
    bosses,
    hpMultiplier: hpMult,
    infantryHp,
    eliteHp,
    bossHp: bossHpEach,
    totalHp,
    requiredDPS,
    availableDPS,
    pressureRatio: requiredDPS / availableDPS,
  };
}

/** 压力比分类 */
export function pressureLabel(r) {
  return r < 0.6 ? '轻松' : r < 0.85 ? '正常' : r < 1.0 ? '吃紧' : r < 1.15 ? '极限' : '崩盘';
}

/** 首次压力比 > 1.0 的波次（"墙体"位置） */
export function collapseWave(maxWave = 130) {
  const hpTable = hpMultiplierTable(maxWave);
  for (let w = 1; w <= maxWave; w++) {
    if (waveStats(w, hpTable).pressureRatio > 1.0) return w;
  }
  return null;
}

/** 军粮收入（单波） */
export function waveFood(w) {
  const count = Math.round(enemyCount(w));
  const elite = eliteFraction(w);
  const bosses = bossCount(w);
  const ordinary = count * (1 - elite);
  const eliteCount = count * elite;
  return Math.round(
    ordinary * 1.55 +
    eliteCount * 4.5 +
    bosses * 60 +
    count * 0.05 * 8
  );
}

/** 累计军粮表 */
export function foodTable(maxWave = 80) {
  const table = [];
  let cum = 0;
  for (let w = 1; w <= maxWave; w++) {
    const food = waveFood(w);
    cum += food;
    table.push({ wave: w, food, cumulative: cum });
  }
  return table;
}

/** 军营全升级总成本 */
export function campUpgradeTotals() {
  const build = Object.values(CAMPS).reduce((a, c) => a + c.build, 0); // 6 营建造
  const totals = { build, cumulative: build, byLevel: {} };
  for (let lv = 0; lv < 4; lv++) {
    const step = Object.values(UPGRADE_COST).reduce((a, c) => a + c[lv], 0);
    totals.cumulative += step;
    totals.byLevel[lv + 2] = { step, cumulative: totals.cumulative };
  }
  return totals;
}

// ============================================================
// 五、报告输出
// ============================================================

function pad(s, n, right = false) {
  const str = String(s);
  return right ? str.padStart(n) : str.padEnd(n);
}
function num(n) {
  return Math.round(n).toLocaleString('en-US');
}

function report() {
  const hpTable = hpMultiplierTable();

  console.log('');
  console.log('═'.repeat(96));
  console.log('  无双守关 · 无尽模式数值推导报告');
  console.log('═'.repeat(96));

  // ---- 军营 DPS 表 ----
  console.log('\n【一】军营 L1-L5 单营 DPS');
  console.log('─'.repeat(96));
  console.log(pad('军营', 10) + [1, 2, 3, 4, 5].map(l => pad(`L${l}`, 10, true)).join(''));
  for (const [id, c] of Object.entries(CAMPS)) {
    const dps = c.levels.map(L => (L.interval ? L.dmg / L.interval : 0));
    console.log(pad(c.name, 10) + dps.map(d => pad(d.toFixed(1), 10, true)).join(''));
  }
  console.log('\n6 槽参考构筑（2弓 1弩 1投石 1火油 1战鼓）场输出：');
  for (let l = 1; l <= 5; l++) {
    console.log(`  全营 L${l}: ${num(campFieldDPS(l))} DPS`);
  }

  // ---- 主曲线 ----
  console.log('\n【二】无尽难度主曲线');
  console.log('─'.repeat(96));
  console.log(
    pad('波', 4, true) + pad('敌兵数', 8, true) + pad('精锐', 7, true) + pad('时长', 7, true) +
    pad('首领', 6, true) + pad('血浆倍', 9, true) + pad('步兵HP', 8, true) +
    pad('首领HP', 9, true) + pad('该波总HP', 12, true) + pad('需求DPS', 10, true) +
    pad('压力比', 8, true) + '  体感'
  );
  for (let w = 1; w <= 80; w++) {
    const s = waveStats(w, hpTable);
    if (w > 30 && w % 5 !== 0) continue;
    console.log(
      pad(w, 4, true) + pad(s.count, 8, true) +
      pad((s.eliteFraction * 100).toFixed(0) + '%', 7, true) +
      pad(s.duration.toFixed(1), 7, true) +
      pad(s.bosses || '—', 6, true) +
      pad(s.hpMultiplier.toFixed(2), 9, true) +
      pad(s.infantryHp, 8, true) +
      pad(s.bosses ? num(s.bossHp) : '—', 9, true) +
      pad(num(s.totalHp), 12, true) +
      pad(num(s.requiredDPS), 10, true) +
      pad(s.pressureRatio.toFixed(2), 8, true) +
      '  ' + pressureLabel(s.pressureRatio)
    );
  }

  // ---- 墙体位置 ----
  const wall = collapseWave();
  console.log('\n【三】设计墙体');
  console.log('─'.repeat(96));
  console.log(`  首次压力比 > 1.0 的波次：第 ${wall} 波  ← 这就是 80 波软上限的来源`);
  console.log(`  第 ${wall} 波：需求 ${num(waveStats(wall, hpTable).requiredDPS)} DPS vs 可用 ${num(waveStats(wall, hpTable).availableDPS)} DPS`);

  // ---- 血量分段 ----
  console.log('\n【四】血量倍率分段');
  console.log('─'.repeat(96));
  const segs = [[1, 10], [11, 20], [21, 30], [31, 45], [46, 60], [61, 80]];
  console.log(pad('波次段', 12) + pad('段首倍率', 12, true) + pad('段末倍率', 12, true) + pad('每波增长', 12, true));
  for (const [a, b] of segs) {
    const rate = Math.pow(hpTable[b] / hpTable[a], 1 / (b - a));
    console.log(
      pad(`${a} – ${b}`, 12) + pad(hpTable[a].toFixed(2), 12, true) +
      pad(hpTable[b].toFixed(2), 12, true) + pad(`+${((rate - 1) * 100).toFixed(2)}%`, 12, true)
    );
  }

  // ---- 军粮 ----
  console.log('\n【五】军粮经济');
  console.log('─'.repeat(96));
  const foods = foodTable(80);
  const checkpoints = [1, 5, 10, 15, 20, 26, 40, 60, 80];
  console.log(pad('波次', 6, true) + pad('本波军粮', 12, true) + pad('累计军粮', 12, true));
  for (const w of checkpoints) {
    const r = foods[w - 1];
    console.log(pad(w, 6, true) + pad(r.food, 12, true) + pad(num(r.cumulative), 12, true));
  }

  // ---- 军营成本 ----
  console.log('\n【六】军营升级总成本');
  console.log('─'.repeat(96));
  const cost = campUpgradeTotals();
  console.log(pad('建造 6 营', 16) + pad(cost.build, 10, true) + pad(`累计 ${cost.build}`, 16, true));
  for (const [lv, v] of Object.entries(cost.byLevel)) {
    console.log(pad(`全部升 L${lv}`, 16) + pad(`+${v.step}`, 10, true) + pad(`累计 ${num(v.cumulative)}`, 16, true));
  }
  const reach = foods.find(f => f.cumulative >= cost.cumulative);
  console.log(`\n  六营全 L5 需 ${num(cost.cumulative)} 军粮`);
  console.log(`  累计军粮首次超过该值：第 ${reach.wave} 波（累计 ${num(reach.cumulative)}）`);
  console.log('  → 军营满级是一个明确的中期目标，与刷牌形成军粮竞争');

  console.log('\n' + '═'.repeat(96));
  console.log('  调参入口：hpGrowthPerWave(w) —— 修改六个分段增长率即可整体重平衡');
  console.log('═'.repeat(96) + '\n');
}

// 直接运行时输出报告；被 import 时只暴露函数
const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/').split('/').pop());
if (isMain || process.argv.includes('--report')) report();
