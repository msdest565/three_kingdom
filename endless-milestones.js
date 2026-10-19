import { BALANCE } from './runtime-data.js';

/** No state is created for an unopened milestone. All arithmetic uses permanent high-water marks. */
export function planEndlessMilestones(reachedWave, progress = {}, config = BALANCE.endless) {
  const rule = config.milestoneBreakthrough;
  if (!Number.isInteger(reachedWave) || reachedWave < 1 || reachedWave > rule.maxReachedWave) throw new Error('invalid_endless_wave');
  const claimed = new Set(progress.claimedWaves || []);
  const milestones = config.milestones.filter(row => row.wave <= reachedWave && !claimed.has(row.wave));
  const previous = progress.highestBreakthroughWave || 0;
  const priorSteps = previous >= rule.fromWave ? Math.floor((previous - rule.fromWave) / rule.everyWaves) + 1 : 0;
  const steps = reachedWave >= rule.fromWave ? Math.floor((reachedWave - rule.fromWave) / rule.everyWaves) + 1 : 0;
  let breakthrough = null;
  if (steps > priorSteps) {
    const fromWave = rule.fromWave + priorSteps * rule.everyWaves, toWave = rule.fromWave + (steps - 1) * rule.everyWaves;
    const copper = rule.copperPerStep * (steps * (steps + 1) - priorSteps * (priorSteps + 1)) / 2;
    breakthrough = { fromWave, toWave, claimCount: steps - priorSteps, copper };
  }
  return { milestones, breakthrough };
}

/** Preserve the campaign table while reweighting eligible milestone qualities to an integer table. */
export function milestoneQualityWeights(minimumQuality = 'white', goldProbability = 0, loot = BALANCE.loot) {
  const qualities = BALANCE.metaProgression.equipment.qualityIds;
  const floor = qualities.indexOf(minimumQuality);
  if (floor < 0 || !Number.isFinite(goldProbability) || goldProbability < 0 || goldProbability > 1) throw new Error('invalid_milestone_loot');
  const eligible = Object.entries(loot.qualityWeights).filter(([quality]) => qualities.indexOf(quality) >= floor);
  const total = eligible.reduce((sum, [, weight]) => sum + weight, 0), gold = eligible.find(([quality]) => quality === 'gold')?.[1] || 0;
  if (!(total > 0)) throw new Error('invalid_milestone_loot');
  const goldWeight = Math.ceil(Math.max(goldProbability, gold / total) * loot.weightScale);
  const ordinary = eligible.filter(([quality]) => quality !== 'gold');
  const ordinaryTotal = ordinary.reduce((sum, [, weight]) => sum + weight, 0);
  const remaining = loot.weightScale - goldWeight;
  const rows = ordinary.map(([quality, weight], index) => {
    const exact = ordinaryTotal ? remaining * weight / ordinaryTotal : 0;
    return { quality, count: Math.floor(exact), fraction: exact - Math.floor(exact), index };
  });
  let remainder = remaining - rows.reduce((sum, row) => sum + row.count, 0);
  for (const row of [...rows].sort((a, b) => b.fraction - a.fraction || a.index - b.index)) {
    if (!remainder) break;
    row.count++; remainder--;
  }
  return Object.fromEntries([...rows.map(row => [row.quality, row.count]), ['gold', goldWeight]]);
}

export function summarizeEndlessMilestones(progress = {}) {
  const claimedWaves = [...(progress.claimedWaves || [])];
  const highestMilestoneWave = claimedWaves.at(-1) || 0, highestBreakthroughWave = progress.highestBreakthroughWave || 0;
  return { claimedWaves, highestMilestoneWave, highestBreakthroughWave, highestClaimedWave: Math.max(highestMilestoneWave, highestBreakthroughWave) };
}
