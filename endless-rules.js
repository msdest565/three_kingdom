import { BALANCE } from './runtime-data.js';

// Browser-safe, parameterized counterparts of docs/data/endless-curve.mjs.
// The design script remains the independent numerical reference used by tests.
const rules = config => config || BALANCE.endless;
const sum = items => items.reduce((total, value) => total + value, 0);
const positiveWave = wave => {
  if (!Number.isInteger(wave) || wave < 1) throw new RangeError('Wave must be a positive integer');
  return wave;
};
const segmentAt = (wave, segments) => segments.find(segment => wave >= segment.fromWave && (segment.toWave == null || wave <= segment.toWave)) || segments.at(-1);
const linearSegment = (wave, segments) => {
  const segment = segmentAt(wave, segments);
  return segment.startValue + segment.perWaveAdd * (wave - segment.fromWave);
};

export function enemyCount(wave, config) {
  const c = rules(config);
  return Math.min(c.enemyCountCap, linearSegment(wave, c.countSegments));
}
export function eliteFraction(wave, config) {
  const c = rules(config);
  return Math.min(c.eliteFractionCap, linearSegment(wave, c.eliteFractionSegments));
}
export function waveDuration(wave, config) {
  const c = rules(config);
  return Math.min(c.waveDurationCapSec, c.waveDurationBaseSec + c.waveDurationGrowthSec * (wave - 1));
}
export function bossCount(wave, config) {
  const c = rules(config);
  if (wave % c.bossEveryWaves !== 0) return 0;
  return Object.entries(c.bossCountByWave).reduce((count, [fromWave, value]) => wave >= Number(fromWave) ? value : count, 0);
}
export function bossHp(wave, config) {
  const c = rules(config);
  return wave < c.bossEveryWaves ? 0 : Math.round(c.bossBaseHp * Math.pow(1 + c.bossHpGrowthPerWave, wave - c.bossEveryWaves));
}
export function hpGrowthPerWave(wave, config) {
  return segmentAt(wave, rules(config).hpGrowthSegments).perWaveGrowth;
}
export function hpMultiplierTable(maxWave = 130, config) {
  const table = { 1: 1 };
  let multiplier = 1;
  for (let wave = 2; wave <= maxWave; wave++) {
    multiplier *= 1 + hpGrowthPerWave(wave, config);
    table[wave] = multiplier;
  }
  return table;
}
export function speedMultiplier(wave, config) {
  const c = rules(config);
  return Math.min(c.speedMultiplierCap, 1 + c.speedGrowthPerWave * (wave - 1));
}
export function campFieldDPS(level, config) {
  const model = rules(config).referenceOutput;
  return sum(model.camps.map(({ type, count }) => {
    const camp = BALANCE.camps[type], stats = camp.levels[level - 1];
    // The design model values oil as four damage ticks per attack, then applies
    // its movement coverage expectation; it is not a stationary-target simulator.
    let dps = type === 'fire_oil' ? stats.tickDamage * model.oilTicksPerAttack / stats.intervalSec : (stats.damage || 0) / (stats.intervalSec || 1);
    if (type === 'catapult') dps *= model.catapultExpectedTargets;
    if (type === 'fire_oil') dps *= model.oilCoverageFraction;
    return dps * count;
  }));
}
export function playerDPS(wave, config) {
  const c = rules(config), model = c.referenceOutput;
  const camp = campFieldDPS(3, c) * Math.min(model.campGrowthCap, 1 + model.campGrowthAdd * Math.min(1, wave / model.campGrowthEndWave));
  const ultimate = Math.min(model.ultimateCap, model.ultimateBase + model.ultimatePerWave * wave);
  return camp * ultimate * (1 + model.additivePerWave * (wave - 1)) * Math.pow(1 + model.multiplicativePerWave, wave - 1);
}
export function waveStats(wave, hpTable, config) {
  const c = rules(config), table = hpTable || hpMultiplierTable(Math.max(130, wave), c);
  const count = Math.round(enemyCount(wave, c)), elite = eliteFraction(wave, c), duration = waveDuration(wave, c), bosses = bossCount(wave, c);
  const hpMultiplier = table[wave];
  const infantryHp = Math.round(BALANCE.enemies.infantry.hp * hpMultiplier);
  const eliteBase = sum(Object.entries(c.eliteComposition).map(([id, weight]) => BALANCE.enemies[id].hp * weight)) / sum(Object.values(c.eliteComposition));
  const eliteHp = Math.round(eliteBase * hpMultiplier), bossHpEach = bossHp(wave, c);
  const totalHp = count * ((1 - elite) * infantryHp + elite * eliteHp) + bosses * bossHpEach;
  const requiredDPS = totalHp / duration, availableDPS = playerDPS(wave, c);
  return { wave, count, eliteFraction: elite, duration, bosses, hpMultiplier, infantryHp, eliteHp, bossHp: bossHpEach, totalHp, requiredDPS, availableDPS, pressureRatio: requiredDPS / availableDPS };
}
export const pressureLabel = ratio => ratio < .6 ? '轻松' : ratio < .85 ? '正常' : ratio < 1 ? '吃紧' : ratio < 1.15 ? '极限' : '崩盘';
export function collapseWave(maxWave = 130, config) {
  const table = hpMultiplierTable(maxWave, config);
  for (let wave = 1; wave <= maxWave; wave++) if (waveStats(wave, table, config).pressureRatio > 1) return wave;
  return null;
}
export function waveFood(wave, config) {
  const c = rules(config), count = Math.round(enemyCount(wave, c)), elite = eliteFraction(wave, c), food = c.food;
  return Math.round(count * (1 - elite) * food.ordinaryAverageReward + count * elite * food.eliteAverageReward + bossCount(wave, c) * food.bossReward + count * food.completionPerEnemy);
}
export function foodTable(maxWave = 80, config) {
  let cumulative = 0;
  return Array.from({ length: maxWave }, (_, index) => {
    const wave = index + 1, food = waveFood(wave, config);
    cumulative += food;
    return { wave, food, cumulative };
  });
}
export function campUpgradeTotals() {
  const build = sum(Object.values(BALANCE.camps).map(camp => camp.buildCost));
  const totals = { build, cumulative: build, byLevel: {} };
  for (let level = 2; level <= 5; level++) {
    const step = sum(Object.values(BALANCE.camps).map(camp => camp.levels[level - 1].upgradeCost));
    totals.cumulative += step;
    totals.byLevel[level] = { step, cumulative: totals.cumulative };
  }
  return totals;
}

// Largest-remainder rounding preserves the exact head count at every boundary.
function distribute(count, weightedEntries) {
  if (!count || !weightedEntries.length) return {};
  const total = sum(weightedEntries.map(([, weight]) => weight));
  const rows = weightedEntries.map(([id, weight], index) => ({ id, index, exact: count * weight / total, count: Math.floor(count * weight / total) }));
  let remaining = count - sum(rows.map(row => row.count));
  const remainderOrder = [...rows].sort((a, b) => (b.exact - b.count) - (a.exact - a.count) || a.index - b.index);
  for (let index = 0; index < remaining; index++) remainderOrder[index].count++;
  return Object.fromEntries(rows.filter(row => row.count).map(row => [row.id, row.count]));
}

export function getEndlessAnchor(number, anchors = BALANCE.endlessAnchors) {
  positiveWave(number);
  const definition = anchors?.[number];
  return definition ? { ...structuredClone(definition), wave:number } : null;
}

// Anchor formations spend the curve's existing elite slots. Per-unit HP curves,
// head counts, food and boss counts stay on the independent numerical model.
function anchorEliteUnits(count, eliteCount, eligible, anchor) {
  if (!anchor) return distribute(eliteCount, eligible);
  const available = new Set(eligible.map(([id]) => id)), requested = {};
  for (const [id, fraction] of Object.entries(anchor.eliteUnitFractions || {})) {
    if (available.has(id) && Number.isFinite(fraction) && fraction >= 0) requested[id] = Math.round(count * fraction);
  }
  for (const [id, amount] of Object.entries(anchor.eliteUnitCounts || {})) {
    if (available.has(id) && Number.isInteger(amount) && amount >= 0) requested[id] = amount;
  }
  const requestedTotal = sum(Object.values(requested));
  if (requestedTotal > eliteCount) return distribute(eliteCount, Object.entries(requested));
  const remaining = eligible.filter(([id]) => !Object.hasOwn(requested, id));
  // Custom configurations may reserve every eligible type. Preserve the exact
  // elite total even when there is no unreserved type left to receive it.
  if (!remaining.length && requestedTotal < eliteCount) return distribute(eliteCount, eligible);
  return Object.fromEntries(Object.entries({ ...requested, ...distribute(eliteCount - requestedTotal, remaining) }).filter(([, amount]) => amount > 0));
}

export function createEndlessLevel(config) {
  const c = rules(config);
  return {
    id: 'endless', name: '无尽守关', mode: 'endless', mapId: c.mapId, seed: c.seed,
    maxPartySize: 3, startingFood: c.startingFood, freeCamps: structuredClone(c.freeCamps),
    waves: [], choiceAfterWaves: [], targetWaveCount: c.targetWaveCount,
    countsAlreadyIncludeDensity: true, countsAlreadyIncludeTier: true, hpMultipliersExcludeTier: true,
    storyGuest: null, firstClearReward: {}, repeatReward: {}
  };
}

export function generateEndlessWave(number, config, { laneCount = 2, anchors = BALANCE.endlessAnchors } = {}) {
  positiveWave(number);
  if (!Number.isInteger(laneCount) || laneCount < 1) throw new RangeError('Lane count must be a positive integer');
  const c = rules(config), count = Math.round(enemyCount(number, c)), elite = eliteFraction(number, c), anchor = getEndlessAnchor(number, anchors);
  const eliteCount = Math.round(count * elite);
  const eligible = Object.entries(c.eliteComposition).filter(([id]) => number >= c.enemyIntroductionWaves[id]);
  const eliteUnits = anchorEliteUnits(count, eliteCount, eligible, anchor);
  const ordinaryCount = count - sum(Object.values(eliteUnits));
  const cavalryFraction = number >= c.enemyIntroductionWaves.cavalry ? c.cavalryFraction : 0;
  const cavalry = Math.round(ordinaryCount * cavalryFraction);
  const units = { infantry: ordinaryCount - cavalry, ...(cavalry ? { cavalry } : {}), ...eliteUnits };
  const duration = waveDuration(number, c), laneDistribution = Array.from({ length: laneCount }, () => 1 / laneCount);
  const packUnits = Array.from({ length: c.packsPerWave }, () => ({}));
  for (const [type, amount] of Object.entries(units)) {
    const portions = distribute(amount, c.packFractions.map((fraction, index) => [index, fraction]));
    for (const [index, portion] of Object.entries(portions)) packUnits[Number(index)][type] = portion;
  }
  const packs = packUnits.map((pack, index) => ({ startSec: duration * index / c.packsPerWave, durationSec: duration / c.packsPerWave * c.packWindowFraction, units: pack }));
  const bossSpawns = Array.from({ length: bossCount(number, c) }, (_, index) => {
    const originalTemplate = c.bossTemplateOrder[(Math.floor(number / c.bossEveryWaves) - 1 + index) % c.bossTemplateOrder.length];
    const templateId = Object.hasOwn(BALANCE.bossTemplates, anchor?.bossTemplates?.[index]) ? anchor.bossTemplates[index] : originalTemplate;
    return {
      templateId, name: BALANCE.bossTemplates[templateId].name,
      maxHp: bossHp(number, c), hpMultiplier: bossHp(number, c) / BALANCE.enemies.boss.hp,
      ignoreWaveHpMultiplier: true, spawnAtSec: duration * c.bossSpawnFraction + index * c.bossSpawnGapSec,
      warningSec: number >= 51 ? Math.max(3,c.bossWarningSec) : c.bossWarningSec, lane: index % laneCount,
      ...(anchor?.bossDamageTakenMultiplier > 0 && anchor.bossDamageTakenMultiplier <= 1 ? { damageTakenMultiplier:anchor.bossDamageTakenMultiplier } : {})
    };
  });
  const total = waveFood(number, c), completion = Math.round(count * c.food.completionPerEnemy);
  return {
    index: number, count, units, spawnWindowSec: duration, packs, laneDistribution,
    hpMultiplier: hpMultiplierTable(number, c)[number], speedMultiplier: speedMultiplier(number, c), rewardMultiplier: 1,
    eliteFraction: elite, bossSpawn: null, bossSpawns,
    ...(anchor ? { anchor:{ ...anchor, count, eliteCount:sum(Object.values(eliteUnits)), eliteFraction:elite, bossCount:bossSpawns.length, bossTemplates:bossSpawns.map(boss => boss.templateId), arrivalMode:anchor.massArrival ? 'mass' : 'packs' } } : {}),
    foodRewardTotal: total, completionFoodReward: completion, killFoodReward: total - completion,
    foodBudget: { total, kills: total - completion, completion, bossPerEnemy: c.food.bossReward, ordinaryWeight: c.food.ordinaryAverageReward, eliteWeight: c.food.eliteAverageReward }
  };
}
