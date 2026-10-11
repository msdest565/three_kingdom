import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';

const file = new URL('./balance.json', import.meta.url);
const data = JSON.parse(await readFile(file, 'utf8'));
const v = data.v1Baseline;
const round = value => Math.round(value * 10000) / 10000;
const sum = values => values.reduce((total, value) => total + value, 0);
const expectedHeroes = ['cao_cao','xiahou_dun','zhang_liao','xu_chu','sima_yi','liu_bei','guan_yu','zhang_fei','zhao_yun','zhuge_liang','sun_quan','zhou_yu','lv_meng','gan_ning','taishi_ci'];
const expectedCamps = ['shield','archer','crossbow','catapult','fire_oil','war_drum'];
const expectedEnemies = ['infantry','cavalry','armor','ranged','banner','siege','boss'];

assert.deepEqual(Object.keys(v.heroes).sort(), expectedHeroes.sort());
assert.deepEqual(Object.keys(v.camps).sort(), expectedCamps.sort());
assert.deepEqual(Object.keys(v.enemies).sort(), expectedEnemies.sort());
assert.equal(data.scope.levelCount, data.scope.chapterCount * data.scope.levelsPerChapter);
assert.equal(v.metaProgression.heroLevel.max, 30);
assert.equal(v.metaProgression.skillLevel.max, 5);
assert.equal(v.metaProgression.equipment.levelMax, 10);
assert.equal(v.metaProgression.equipment.slots.length, 4);
assert.equal(v.metaProgression.equipment.qualityIds.length, 5);
assert.equal(v.metaProgression.heroUnlocks.length, data.scope.heroCount);
assert.deepEqual(v.metaProgression.defaultParty.support, []);
assert.deepEqual(v.metaProgression.initialResources, { experience_book: 0, copper_coin: 0, refined_iron: 0 });
assert.equal(v.metaProgression.starsReward.bonusFractionOfBasePerNewStar, 0.1);
assert.deepEqual(v.metaProgression.starsReward.bonusStars, [2, 3]);
assert.equal(v.stageGrowthTiers.length, 12);
assert.equal(v.party.maxHeroes, 3);
assert.deepEqual(v.party.enemyHpMultipliersByPartySize, { '1': 1, '2': 1.5, '3': 1.9 });
assert.equal(v.rage.max, 100);
assert.equal(v.rage.cost, 100);
assert.equal(v.rage.recoverySec, 6);
assert.deepEqual(v.rage.roles.lead, { initial: 40, engagedPerSec: 4, idlePerSec: 1 });
assert.deepEqual(v.rage.roles.support, { initial: 0, engagedPerSec: 2, idlePerSec: 0.5 });
assert.equal(v.rage.scalesWithCampCount, false);
assert.equal(v.rage.killRageReward, 0);
assert.deepEqual(v.battleSpeed.allowedMultipliers, [1, 1.5, 2]);
assert.equal(v.battleSpeed.defaultMultiplier, 1);
assert.equal(v.battleSpeed.firstGuideMultiplier, 1);
assert.equal(v.battleSpeed.dropAccumulatedCombatTime, false);
assert.equal(v.battleSpeed.audioPlaybackRate, 1);
assert.equal(v.battleSpeed.fixedStepSec, 1 / 60);
assert.equal(v.enemyDensity.densityMultiplier, 1.6);
assert.equal(v.enemyDensity.runtimeMultiplier, 1);
assert.equal(v.enemyDensity.spawnWindowMultiplier, 1);
assert.equal(v.enemyDensity.realEnemiesOnly, true);
assert.equal(v.enemyDensity.maximumAliveEnemies, 160);
assert.equal(v.modifierRules.slowMinimumSpeedFactor, 0.3);
assert.equal(v.camps.catapult.damageTargetCap, 6);
assert.equal(v.camps.catapult.controlTargetCap, null);
assert.equal(v.modifierRules.campAttackHitBudgets.catapult.tacticsNeverIncreaseDamageCap, true);
assert.equal(v.enemyScaling.automaticHpAddPerWave, 0);
assert.equal(v.enemyScaling.automaticSpeedGrowthPerWave, 0);
assert.ok(v.waveGrowthReference.hpMultipliers.every(value => value === 1));
assert.equal(v.metaProgression.equipment.armorDoesNotAffectLeakDamage, true);

for (const faction of v.chapterOrder) assert.equal(Object.values(v.heroes).filter(hero => hero.faction === faction).length, 5);
for (const hero of Object.values(v.heroes)) {
  assert.ok(hero.attack.damage > 0 && hero.attack.intervalSec > 0 && hero.attack.range > 0);
  assert.ok(hero.auto.minOrdinaryTargets > 0 && hero.auto.skipInvulnerable);
  assert.equal(hero.hpEnabled, false);
  assert.equal(hero.movementEnabled, false);
  if (hero.ultimate.ordinaryExecute) assert.deepEqual(hero.ultimate.executeEnemyTypes, ['infantry']);
}
for (const [id, camp] of Object.entries(v.camps)) {
  assert.equal(camp.levels.length, 3);
  assert.ok(Number.isInteger(camp.buildCost) && camp.buildCost > 0);
  assert.deepEqual(camp.levels.map(level => level.level), [1, 2, 3]);
  for (const level of camp.levels) {
    assert.ok(level.range > 0);
    assert.ok(Number.isInteger(level.upgradeCost) && level.upgradeCost >= 0);
    if (id !== 'war_drum') assert.ok(level.intervalSec > 0);
  }
}
for (const [id, enemy] of Object.entries(v.enemies)) {
  assert.ok(enemy.hp > 0 && enemy.speed > 0 && enemy.reward >= 0 && enemy.leak > 0);
  assert.equal(enemy.ultimateInstantKill, id === 'infantry');
  assert.equal(enemy.executeImmune, id !== 'infantry');
}
for (const tactic of Object.values(v.tactics)) {
  if (tactic.camp) assert.ok(v.camps[tactic.camp]);
  if (tactic.hero) assert.ok(v.heroes[tactic.hero]);
}
for (const [i, tier] of v.stageGrowthTiers.entries()) {
  assert.equal(tier.id, `S${String(i + 1).padStart(2, '0')}`);
  assert.deepEqual(tier.globalCampaignLevelRange, [i * 5 + 1, i * 5 + 5]);
  assert.ok(tier.name && tier.hpMultiplier > 0 && tier.rewardMultiplier === 1);
  assert.deepEqual(tier.recommendedEquipmentSlots, ['weapon']);
  assert.equal(tier.automaticWaveHpGrowth, false);
}
assert.deepEqual(Object.keys(v.bossTemplates).sort(), ['rammer','charger','banner_lord','guardian','siege_lord'].sort());
for (const template of Object.values(v.bossTemplates)) {
  assert.equal(template.enemyBaseId, 'boss');
  assert.equal(template.ability.instantGateDamage, 0);
  assert.equal(template.ability.directHeroDamage, 0);
}
for (const chapter of v.chapterOrder) for (const item of v.chapterTowerUnlock[chapter]) assert.ok(v.camps[item.campId]);
assert.ok(v.chapterTowerUnlock.initial.every(id => v.camps[id]));

const prototypeCounts = Object.fromEntries(['infantry','cavalry','armor','boss'].map(id => [id, 0]));
for (const [index, count] of data.prototypeSnapshot.waveEnemyCountsExcludingBoss.entries()) {
  const wave = index + 1;
  for (let enemyIndex = 0; enemyIndex < count; enemyIndex++) {
    let type = 'infantry';
    for (const id of data.prototypeSnapshot.enemyComposition.priorityOrder) {
      const rule = data.prototypeSnapshot.enemyComposition[id];
      if (wave >= rule.minimumWave && enemyIndex % rule.modulus === rule.remainder) type = id;
    }
    prototypeCounts[type]++;
  }
}
prototypeCounts.boss = 1;
const referenceBeforeDensity = v.economy.referenceEnemyCompositionBeforeDensity;
const referenceCounts = Object.fromEntries(Object.entries(referenceBeforeDensity).map(([id, count]) => [id, id === 'boss' ? count : Math.round(count * v.economy.referenceCountMultiplier)]));
const referenceReward = sum(Object.entries(referenceCounts).map(([id, count]) => count * v.enemies[id].reward));
const campDps = Object.fromEntries(Object.entries(v.camps).map(([id, camp]) => [id, camp.levels.map(level => {
  let singleTarget = 0;
  if (id === 'fire_oil') singleTarget = level.tickDamage / camp.tickIntervalSec * Math.min(1, camp.fieldDurationSec / level.intervalSec);
  else if (id !== 'war_drum') singleTarget = level.damage / level.intervalSec;
  const row = { level: level.level, singleTargetDps: round(singleTarget), eliteDpsBeforeTactics: round(singleTarget * (camp.eliteAndBossDamageMultiplier || 1)) };
  if (id === 'catapult') Object.assign(row, { maximumCappedGroupDps: round(singleTarget * camp.damageTargetCap), maximumCappedBlastDamage: level.damage * camp.damageTargetCap });
  return row;
})]));
const freeCampIds = v.economy.referenceFreeCamps.map(camp => camp.type);
const buildCostForOneEach = sum(Object.entries(v.camps).filter(([id]) => !freeCampIds.includes(id)).map(([, camp]) => camp.buildCost));
const upgradeCostForOneEach = sum(Object.values(v.camps).map(camp => sum(camp.levels.map(level => level.upgradeCost))));
const mainThreeCosts = ['archer', 'catapult', 'crossbow'].map(id => sum(v.camps[id].levels.map(level => level.upgradeCost)));
const referenceBudget = v.economy.startingFood + referenceReward;
const xpFormula = v.metaProgression.heroLevel.xpNextLevelCoefficients;
const coinFormula = v.metaProgression.heroLevel.coinNextLevelCoefficients;
const heroXp = sum(Array.from({ length: v.metaProgression.heroLevel.max - 1 }, (_, i) => xpFormula.base + xpFormula.perPriorLevel * i));
const heroLevelCoins = sum(Array.from({ length: v.metaProgression.heroLevel.max - 1 }, (_, i) => coinFormula.base + coinFormula.perPriorLevel * i));
const skillCoins = sum(Object.values(v.metaProgression.skillLevel.upgradeCoinCostsByDestinationLevel));
const equipmentCost = level => ({ copper_coin: sum(Array.from({ length: level }, (_, i) => v.metaProgression.equipment.upgradeCoinCoefficients.base + v.metaProgression.equipment.upgradeCoinCoefficients.perPriorDestinationLevel * i)), refined_iron: sum(Array.from({ length: level }, (_, i) => v.metaProgression.equipment.upgradeIronCoefficients.base + v.metaProgression.equipment.upgradeIronCoefficients.perPriorDestinationLevel * i)) });
const qualityCost = target => {
  const q = v.metaProgression.equipment.qualityIds;
  const upgrades = v.metaProgression.equipment.qualityUpgradeCosts.slice(0, q.indexOf(target));
  return { copper_coin: sum(upgrades.map(item => item.copper_coin)), refined_iron: sum(upgrades.map(item => item.refined_iron)) };
};
const teamCost = (gearLevel, quality) => {
  const gear = equipmentCost(gearLevel); const q = qualityCost(quality); const heroes = v.party.maxHeroes; const slots = v.metaProgression.equipment.slots.length;
  return { experience_book: heroes * Math.ceil(heroXp / v.metaProgression.currencies.experience_book.xpPerBook), copper_coin: heroes * (heroLevelCoins + skillCoins + slots * (gear.copper_coin + q.copper_coin)), refined_iron: heroes * slots * (gear.refined_iron + q.refined_iron) };
};
// The current sixty-level campaign uses one act-end encounter every fourth chapter level.
// Resolve its reward boost before each per-currency star bonus; never boost after summation.
const plannedCampaignFirstClears = v.stageGrowthTiers.flatMap(tier => Array.from({ length: tier.globalCampaignLevelRange[1] - tier.globalCampaignLevelRange[0] + 1 }, (_, i) => {
  const globalIndex = tier.globalCampaignLevelRange[0] + i;
  const chapterLevel = (globalIndex - 1) % data.scope.levelsPerChapter + 1;
  const multiplier = chapterLevel % 4 === 0 ? v.metaProgression.actEndFirstClearRewardMultiplier : 1;
  return Object.fromEntries(Object.entries(tier.firstClearReward).map(([id, reward]) => [id, Math.floor(reward * multiplier)]));
}));
const campaignRewards = Object.fromEntries(Object.keys(v.metaProgression.currencies).map(id => [id, sum(plannedCampaignFirstClears.map(reward => reward[id]))]));
const campaignAllThreeStarRewards = Object.fromEntries(Object.keys(v.metaProgression.currencies).map(id => [id, sum(plannedCampaignFirstClears.map(reward => reward[id] + v.metaProgression.starsReward.bonusStars.length * Math.floor(reward[id] * v.metaProgression.starsReward.bonusFractionOfBasePerNewStar)))]));
const primaryWeaponTeamCost = (gearLevel, quality) => {
  const gear = equipmentCost(gearLevel); const q = qualityCost(quality); const heroes = v.party.maxHeroes;
  return { experience_book: heroes * Math.ceil(heroXp / v.metaProgression.currencies.experience_book.xpPerBook), copper_coin: heroes * (heroLevelCoins + skillCoins + gear.copper_coin + q.copper_coin), refined_iron: heroes * (gear.refined_iron + q.refined_iron) };
};
const firstReady = role => {
  const rate = v.rage.roles[role]; const contact = v.rage.firstAttackContactTargetMaxSec;
  return round(contact + (v.rage.max - rate.initial - contact * rate.idlePerSec) / rate.engagedPerSec);
};
const maxEquip = v.metaProgression.equipment;
const purple = maxEquip.qualityFixedBonuses.red;
const maxSignatureDamage = Math.max(...Object.values(maxEquip.templates).map(x=>x.signatureBonuses?.ultimateDamageAdd||0));
const technologyCosts = Array.from({length:v.technology.levelMax},(_,i)=>({copper: v.technology.coinCostCoefficients.base+v.technology.coinCostCoefficients.perPriorDestinationLevel*i,iron:v.technology.ironCostCoefficients.base+v.technology.ironCostCoefficients.perTwoPriorDestinationLevels*Math.floor(i/2)}));
const heroMaxActiveDamageMultiplier = v.metaProgression.heroLevel.damageMultiplierAtMax * (1 + maxEquip.perLevelBonuses.weaponDamage * maxEquip.levelMax + maxEquip.qualityFixedBonuses.gold.weaponDamage) * (1+maxSignatureDamage) * v.metaProgression.skillLevel.numericDamageMultipliers.at(-1);
const tierLast = v.stageGrowthTiers.at(-1);
const finalBossThreeParty = Math.ceil(v.enemies.boss.hp * tierLast.hpMultiplier * v.party.enemyHpMultipliersByPartySize['3'] * v.bossActHpMultipliers.at(-1));
const analysis = {
  technologyExamples: { oneCampTo10Copper: sum(technologyCosts.map(x=>x.copper)), oneCampTo10Iron: sum(technologyCosts.map(x=>x.iron)), sixCampsTo10Copper: 6*sum(technologyCosts.map(x=>x.copper)), sixCampsTo10Iron: 6*sum(technologyCosts.map(x=>x.iron)), maximumDamageMultiplier: 1.25, maximumRangeAdd: 15, maximumDrumDamageAura: .02 },
  lootExamples: { goldPercent: 2.5, meanBoxesToAnyGold: 40, chanceAtLeastOneGoldIn60: round(1-Math.pow(.975,60)), specificSignaturePercent: round(2.5/15) },
  calculationStatus: 'static_arithmetic_not_combat_simulation',
  campDps,
  prototypeEnemyCounts: prototypeCounts,
  referenceEnemyCountsBeforeDensity: referenceBeforeDensity,
  referenceEnemyCounts: referenceCounts,
  referenceBattleEconomy: { enemyRewardUpperBound: referenceReward, startingFood: v.economy.startingFood, totalFoodUpperBound: referenceBudget, remainingFourBuildCost: buildCostForOneEach, sixCampUpgradeCost: upgradeCostForOneEach, sixCampFullMaxCost: buildCostForOneEach + upgradeCostForOneEach, sixCampFullMaxBudgetDeficit: buildCostForOneEach + upgradeCostForOneEach - referenceBudget, oneEachPlusMainThreeMaxCost: buildCostForOneEach + sum(mainThreeCosts), remainingFoodAfterMainThreeMax: referenceBudget - buildCostForOneEach - sum(mainThreeCosts) },
  combatClockExamples: v.battleSpeed.allowedMultipliers.map(multiplier => ({ multiplier, leadReadyCombatSec: firstReady('lead'), leadReadyWallSec: round(firstReady('lead') / multiplier), leadRepeatCombatSec: v.rage.max / v.rage.roles.lead.engagedPerSec + v.rage.recoverySec, leadRepeatWallSec: round((v.rage.max / v.rage.roles.lead.engagedPerSec + v.rage.recoverySec) / multiplier), reference240CombatSecWallDurationSec: 240 / multiplier, audioPlaybackRate: v.battleSpeed.audioPlaybackRate })),
  rage: { leadEarliestFullCombatReadySec: (v.rage.max - v.rage.roles.lead.initial) / v.rage.roles.lead.engagedPerSec, supportEarliestFullCombatReadySec: (v.rage.max - v.rage.roles.support.initial) / v.rage.roles.support.engagedPerSec, leadReadyWithMaxContactSec: firstReady('lead'), supportReadyWithMaxContactSec: firstReady('support'), leadMinimumRepeatSec: v.rage.max / v.rage.roles.lead.engagedPerSec + v.rage.recoverySec, supportMinimumRepeatSec: v.rage.max / v.rage.roles.support.engagedPerSec + v.rage.recoverySec },
  training: { heroXpTo30: heroXp, heroBooksTo30: Math.ceil(heroXp / v.metaProgression.currencies.experience_book.xpPerBook), heroLevelCoinsTo30: heroLevelCoins, skillCoinsTo5: skillCoins, campaignFirstClearRewards: campaignRewards, campaignAllThreeStarRewards, threeHero30Skill5PurpleMainWeapon8Cost: primaryWeaponTeamCost(8, 'purple'), threeHero30Skill5RedMainWeapon10Cost: primaryWeaponTeamCost(10, 'red'), threeHero30Skill5PurpleGear8Cost: teamCost(8, 'purple'), threeHero30Skill5RedGear10Cost: teamCost(10, 'red'), maxHeroActiveDamageMultiplier: round(heroMaxActiveDamageMultiplier), maxThreeHeroArmorGateHp: Math.round(v.world.gateHp * (1 + Math.min(maxEquip.teamArmorDefenseBonusCap, 3 * (maxEquip.perLevelBonuses.armorDefense * maxEquip.levelMax + purple.armorDefense)))), maxThreeHeroCommandDamageMultiplier: 1 + Math.min(maxEquip.teamCommandCampDamageBonusCap, 3 * (maxEquip.perLevelBonuses.commandCampDamage * maxEquip.levelMax + purple.commandCampDamage)) },
  targetExamples: { archerLevel1InfantryContinuousTtkSec: round(v.enemies.infantry.hp / campDps.archer[0].singleTargetDps), archerLevel3ArmorContinuousTtkSec: round(v.enemies.armor.hp / campDps.archer[2].singleTargetDps), armorAfterLevel1GuanUltimateSoloHp: Math.max(0, v.enemies.armor.hp - v.heroes.guan_yu.ultimate.damageByClass.elite), armorAfterLevel1GuanUltimateThreePartyHp: Math.max(0, Math.ceil(v.enemies.armor.hp * v.party.enemyHpMultipliersByPartySize['3']) - v.heroes.guan_yu.ultimate.damageByClass.elite), bossAfterLevel1GuanUltimateSoloHp: Math.max(0, v.enemies.boss.hp - v.heroes.guan_yu.ultimate.damageByClass.boss), zhouInfantryStationaryClearSec: Math.ceil(v.enemies.infantry.hp / v.heroes.zhou_yu.ultimate.tickDamageByClass.ordinary) * v.heroes.zhou_yu.ultimate.tickIntervalSec, zhouCavalryStationaryClearSec: Math.ceil(v.enemies.cavalry.hp / v.heroes.zhou_yu.ultimate.tickDamageByClass.ordinary) * v.heroes.zhou_yu.ultimate.tickIntervalSec, zhouFullFieldArmorDamage: v.heroes.zhou_yu.ultimate.tickDamageByClass.elite * v.heroes.zhou_yu.ultimate.maxTicksPerEnemyPerCast, zhouFullFieldBossDamage: v.heroes.zhou_yu.ultimate.tickDamageByClass.boss * v.heroes.zhou_yu.ultimate.maxTicksPerEnemyPerCast, finalBossHpThreePartyNormal: finalBossThreeParty }
};

if (process.argv.includes('--write-derived')) {
  data.derivedExamples = analysis;
  await writeFile(file, JSON.stringify(data, null, 2) + '\n', 'utf8');
} else if (data.derivedExamples) assert.deepEqual(data.derivedExamples, analysis, 'Derived examples are stale; regenerate explicitly after changing the baseline.');
process.stdout.write(JSON.stringify({ validation: 'passed', combatSimulationPerformed: false, heroes: Object.keys(v.heroes).length, camps: Object.keys(v.camps).length, enemies: Object.keys(v.enemies).length, stageTiers: v.stageGrowthTiers.length, ...analysis }, null, 2) + '\n');
