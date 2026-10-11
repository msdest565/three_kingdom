import { V1Game, seededRandom } from '../v1-engine.js';
import { BALANCE, CONTENT } from '../runtime-data.js';
import { pathToFileURL } from 'node:url';

export function minimumParty(level) {
  const tier = BALANCE.stageGrowthTiers.find(t => t.id === level.growthTierId);
  const owned = id => !BALANCE.metaProgression.heroUnlocks.find(u => u.heroId === id)?.levelId ||
    CONTENT.levels.find(l => l.id === BALANCE.metaProgression.heroUnlocks.find(u => u.heroId === id).levelId).globalIndex < level.globalIndex;
  const candidates = ['guan_yu', 'xiahou_dun', 'cao_cao'].filter(owned);
  return candidates.slice(0, level.maxPartySize).map(heroId => ({ heroId, level: tier.recommendedHeroLevelRange[0],
    skillLevel: tier.recommendedSkillLevelRange[0], auto: false, equipment: { weapon: {
      level: tier.recommendedMainWeaponLevelRange[0], quality: tier.recommendedMainWeaponQuality } } }));
}
export function unlockedCampsFor(level) {
  return [...BALANCE.chapterTowerUnlock.initial, ...['wei', 'shu', 'wu'].flatMap(chapter => BALANCE.chapterTowerUnlock[chapter])
    .filter(u => CONTENT.levels.find(l => l.id === u.levelId).globalIndex < level.globalIndex).map(u => u.campId)];
}
export function driveBattle(game, { skills = true, mode = 6 } = {}) {
  // Spend only earned battle food. This fixed, public policy is evidence of solvability, not a human win rate.
  const open = game.map.campSlots.filter(s => !game.camps.some(c => c.slot === s.slot))
    .sort((a, b) => [4,5,6].includes(mode) ? (b.slot >= 6 && b.y > 300) - (a.slot >= 6 && a.y > 300) || b.y - a.y || a.slot - b.slot : b.y - a.y || a.slot - b.slot);
  for (const position of open) {
    if (mode === 5 && game.camps.length >= 4 && game.camps.filter(c => c.type !== 'shield').some(c => c.level < 3)) break;
    const desired = [3, 4,5,6].includes(mode) && game.camps.filter(c => c.type === 'shield').length < 2 ? 'shield' : mode === 1 ? 'archer' : mode === 2 && game.unlockedCamps.includes('crossbow') ? 'crossbow' : (position.y > 370 && !game.camps.some(c => c.type === 'crossbow') && game.unlockedCamps.includes('crossbow') ? 'crossbow' : 'archer');
    if (!game.build(position.slot, desired).ok) break;
  }
  const upgradeOrder = [...game.camps].filter(c => c.type !== 'war_drum').sort((a, b) =>
    (mode === 6 ? (b.slot === 4) - (a.slot === 4) : 0) || (a.type === 'shield') - (b.type === 'shield') || b.y - a.y || a.slot - b.slot);
  for (const camp of upgradeOrder) if (camp.level < 3) { if (!game.upgrade(camp.slot).ok) break; }
  if (skills) for (const h of game.heroes) {
    const target = h.target;
    const urgent = game.enemies.some(e => e.hp > 0 && e.progress / e.pathLength > 0.82 && target?.targetIds.includes(e.id));
    const boss = game.enemies.some(e => e.hp > 0 && e.type === 'boss' && target?.targetIds.includes(e.id));
    if (h.rage >= 100 - 1e-8 && (target?.infantryCount >= 10 || urgent || boss)) game.castUltimate(h.id);
  }
}
export function simulateLevel(level, { skills = true, seed = level.seed, mode = 6, party = minimumParty(level), campTech = {}, maximumTime = 1600 } = {}) {
  const game = new V1Game({ levelId: level.id, party, campTech, unlockedCamps: unlockedCampsFor(level), rng: seededRandom(seed) });
  game.start();
  const preference = ['guan_yu_width', 'archer_hunt', 'archer_pierce', 'crossbow_precision', 'shield_grasp', 'archer_volley', 'shield_reach'];
  while (['playing', 'choosing'].includes(game.state) && game.time < maximumTime) {
    if (game.state === 'choosing') {
      const choice = preference.map(id => game.upgrades.find(u => u.id === id)).find(Boolean) || game.upgrades[0];
      game.selectUpgrade(choice.id);
    }
    driveBattle(game, { skills, mode }); game.update(1 / 30);
  }
  return { levelId: level.id, state: game.state, wave: game.wave, time: +game.time.toFixed(2), hp: +game.hp.toFixed(2),
    maxHp: game.maxHp, bestBurst: game.bestBurst, food: game.food,
    stars: game.stars, spawned: game.stats.spawned, scheduled: game.stats.scheduledEnemies, kills: game.kills,
    escaped: game.stats.escaped, peak: game.stats.maxAlive, casts: game.stats.ultimateCasts, ultimateKills: game.stats.ultimateKills,
    party: party.map(h => h.heroId), campTech:{...game.campTech}, mode, seed, bossKills: game.stats.killsByType.boss || 0, bossEscapes: game.stats.escapesByType.boss || 0,
    ultimateShare: +(game.stats.ultimateKills / Math.max(1, game.kills)).toFixed(3) };
}
export function simulateCampaign(options = {}) { return CONTENT.levels.map(level => simulateLevel(level, options)); }
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const results = simulateCampaign();
  const noUltimate = ['wei_001', 'wei_020', 'shu_020', 'wu_020'].map(id => simulateLevel(CONTENT.levels.find(l => l.id === id), { skills: false }));
  console.log(JSON.stringify({ schemaVersion: 1, contentVersion: CONTENT.contentVersion, generatedAt: new Date().toISOString(),
    policy: 'minimum_recommendations_weapon_only_earned_food_two_shields_one_crossbow_bows_shield_first',
    party: { lead: 'guan_yu', supportLeft: 'xiahou_dun', supportRight: 'cao_cao', onlyUnlockedHeroes: true, slotLimitsRespected: true },
    combatStep: 1 / 60, inputDecisionStep: 1 / 30, sourceEnemyBaseline: BForReport(),
    summary: { won: results.filter(r => r.state === 'won').length, stages: results.length,
      timeRange: [Math.min(...results.map(r => r.time)), Math.max(...results.map(r => r.time))],
      ultimateShareRange: [Math.min(...results.map(r => r.ultimateShare)), Math.max(...results.map(r => r.ultimateShare))],
      bossKilled: results.reduce((n, r) => n + r.bossKills, 0), bossEscaped: results.reduce((n, r) => n + r.bossEscapes, 0),
      minimumRemainingGateHp: Math.min(...results.map(r => r.hp)) }, results, noUltimate }, null, 2));
  if (results.some(r => r.state !== 'won')) process.exitCode = 1;
}
function BForReport() { return Object.fromEntries(Object.entries(BALANCE.enemies).map(([id, enemy]) => [id, { hp: enemy.hp, speed: enemy.speed, leak: enemy.leak, reward: enemy.reward }])); }
