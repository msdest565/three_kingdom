import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadDesignData, validateDesignData } from '../scripts/validate-v1-design.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const baseline = await loadDesignData(root);
const copy = () => ({ balance: structuredClone(baseline.balance), campaign: structuredClone(baseline.campaign) });
const rejects = (mutate, expectedPath) => {
  const data = copy(); mutate(data);
  const result = validateDesignData(data.balance, data.campaign);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some(error => error.includes(expectedPath)), `Expected ${expectedPath}; got ${result.errors.join('; ')}`);
};

test('the actual V1 JSON files resolve every reference and planned campaign structure', () => {
  const result = validateDesignData(baseline.balance, baseline.campaign);
  assert.equal(result.ok, true, result.errors.join('\n'));
  assert.equal(result.summary.waves, 516);
  assert.equal(result.summary.bossEncounters, 15);
  assert.equal(result.summary.combatSimulationPerformed, false);
  assert.equal(result.summary.runtimeImplementationVerified, false);
  assert.equal(result.economy.stages.length, 12);
  const currencyIds = Object.keys(baseline.balance.v1Baseline.metaProgression.currencies);
  const firstClears = Object.fromEntries(currencyIds.map(id => [id, baseline.campaign.levels.reduce((total, level) => total + level.firstClearReward[id], 0)]));
  const threeStars = Object.fromEntries(currencyIds.map(id => [id, baseline.campaign.levels.reduce((total, level) => total + level.firstClearReward[id] + 2 * Math.floor(level.firstClearReward[id] * 0.1), 0)]));
  assert.deepEqual(baseline.balance.derivedExamples.training.campaignFirstClearRewards, firstClears, 'Campaign totals must include the act-end reward before summation.');
  assert.deepEqual(baseline.balance.derivedExamples.training.campaignAllThreeStarRewards, threeStars, 'Each star bonus rounds after the act-end reward and before summation.');
});

test('battle speed preserves a shared combat clock and density cannot be baked twice', () => {
  rejects(({ balance }) => { balance.v1Baseline.battleSpeed.allowedMultipliers.push(3); }, 'battleSpeed: legal speeds');
  rejects(({ balance }) => { balance.v1Baseline.battleSpeed.dropAccumulatedCombatTime = true; }, 'battleSpeed: fixed substeps');
  rejects(({ balance }) => { balance.v1Baseline.battleSpeed.appliesTo = ['enemy_motion']; }, 'battleSpeed: all battle timers');
  rejects(({ balance }) => { balance.v1Baseline.battleSpeed.audioPlaybackRate = 2; }, 'battleSpeed: all battle timers');
  rejects(({ balance }) => { balance.v1Baseline.enemyDensity.runtimeMultiplier = 1.6; }, 'enemyDensity: real-enemy density');
  rejects(({ campaign }) => { campaign.levels[0].countsAlreadyIncludeDensity = false; }, 'wei_001: density is already resolved');
  rejects(({ campaign }) => { campaign.generationFacts.densityMultiplier = 2; }, 'campaign.generationFacts');
  rejects(({ campaign }) => { campaign.levels[0].waves[0].spawnWindowSec *= 1.6; }, 'wei_001.wave1: count/duration');
  rejects(({ balance }) => { balance.v1Baseline.tactics.archer_volley.effects.extraProjectileCanPierce = true; }, 'archer: volley');
  rejects(({ balance }) => { balance.v1Baseline.camps.shield.minimumSpeedFactor = 0; }, 'shield: gathering aura');
  rejects(({ balance }) => { balance.v1Baseline.camps.catapult.damageTargetCap = 30; }, 'catapult: six-target damage cap');
  rejects(({ balance }) => { balance.v1Baseline.camps.catapult.controlTargetCap = 6; }, 'catapult: six-target damage cap');
});

test('unknown hero/map/tier/camp references and broken progression are rejected with locations', () => {
  rejects(({ campaign }) => { campaign.levels[3].storyGuest.heroId = 'missing_hero'; }, 'wei_004: guest hero');
  rejects(({ campaign }) => { campaign.levels[0].mapId = 'missing_map'; }, 'wei_001: missing/cross-chapter map');
  rejects(({ campaign }) => { campaign.levels[0].growthTierId = 'missing_tier'; }, 'wei_001: unknown/wrong growth tier');
  rejects(({ campaign }) => { campaign.levels[0].freeCamps[0].type = 'fire_oil'; }, 'wei_001: free camp fire_oil');
  rejects(({ campaign }) => { campaign.levels[20].prerequisite = 'shu_020'; }, 'shu_001: prerequisite');
  rejects(({ campaign }) => { campaign.levels[2].unlockHeroId = 'cao_cao'; }, 'wei_003: duplicate/unknown hero unlock');
});

test('spawns must conserve per-species counts, cover routes, and use legal scheduled rewards', () => {
  rejects(({ campaign }) => { campaign.levels[0].waves[0].packs[0].units.infantry++; }, 'wei_001.wave1: spawn pack totals');
  rejects(({ campaign }) => { campaign.levels[0].waves[0].units.infantry--; }, 'wei_001.wave1: unit total');
  rejects(({ campaign }) => { campaign.levels[0].waves[0].laneDistribution = [0.6, 0.6]; }, 'wei_001.wave1: lane distribution');
  rejects(({ campaign }) => { campaign.levels[0].waves[0].packs[0].startSec = 500; }, 'wei_001.wave1: pack outside spawn window');
  rejects(({ campaign }) => { campaign.levels[0].firstClearReward.copper_coin = -1; }, 'wei_001.firstClearReward.copper_coin');
  rejects(({ campaign }) => { campaign.levels[0].maxPartySize = 4; }, 'wei_001: invalid/unavailable party size');
});

test('geometry and boss resolution catch overlapping controls, invalid paths and double-scaling markers', () => {
  rejects(({ campaign }) => { campaign.maps[0].campSlots[1].x = campaign.maps[0].campSlots[0].x; }, 'wei_gate: duplicate camp coordinates');
  rejects(({ campaign }) => { campaign.maps[0].paths[0][1].x = 600; }, 'wei_gate.path0[1]');
  rejects(({ campaign }) => { campaign.maps[0].paths[1] = structuredClone(campaign.maps[0].paths[0]); }, 'wei_gate: duplicate complete paths');
  rejects(({ campaign }) => { campaign.levels[3].waves.at(-1).bossSpawn.templateId = 'missing_boss'; }, 'wei_004.wave10: invalid boss template');
  rejects(({ campaign }) => { campaign.levels[3].waves.at(-1).bossSpawn.ignoreWaveHpMultiplier = false; }, 'wei_004.wave10: boss must exclude wave HP');
  rejects(({ campaign }) => { campaign.levels[3].waves.at(-1).bossSpawn.hpMultiplier *= 0.75; }, 'wei_004.wave10: boss HP does not contain');
  rejects(({ campaign }) => { campaign.levels[3].waves[0].bossSpawn = structuredClone(campaign.levels[3].waves.at(-1).bossSpawn); }, 'wei_004: act end must have exactly one boss');
  rejects(({ campaign }) => { campaign.maps[0].heroSlots[0].x = 200; }, 'wei_gate.heroSlots: positions differ');
});

test('star rewards, temporary guest loadouts and minimum gear scope share account contracts', () => {
  rejects(({ campaign }) => { campaign.levels[0].stars.bonusRewardFractionPerNewStar = 0.5; }, 'wei_001.stars');
  rejects(({ balance }) => { balance.v1Baseline.metaProgression.starsReward.payOnlyNewHighestStarDifference = false; }, 'metaProgression.starsReward');
  rejects(({ campaign }) => { delete campaign.guestPresets.chapter_guest_standard; }, 'wei_004.storyGuest.equipmentPresetId');
  rejects(({ campaign }) => { campaign.levels[3].storyGuest.equipment.weapon.level = 10; }, 'wei_004.storyGuest: guest');
  rejects(({ campaign }) => { campaign.levels[3].storyGuest.equipment.armor.quality = 'blue'; }, 'wei_004.storyGuest.equipment.armor');
  rejects(({ campaign }) => { campaign.guestPresets.chapter_guest_standard.persistToInventory = true; }, 'wei_004.storyGuest.equipmentPresetId');
  rejects(({ balance }) => { balance.v1Baseline.stageGrowthTiers[0].recommendedEquipmentSlots.push('armor'); }, 'S01.recommendedEquipmentSlots');
  rejects(({ balance }) => { balance.v1Baseline.stageGrowthTiers[1].recommendedMainWeaponQuality = 'blue'; }, 'S02.recommendedMainWeaponQuality: quality forging is locked');
  rejects(({ balance }) => { balance.v1Baseline.metaProgression.initialResources.copper_coin = -1; }, 'metaProgression.initialResources.copper_coin');
  rejects(({ balance }) => { balance.v1Baseline.metaProgression.heroStarterGear.items.pop(); }, 'metaProgression.heroStarterGear.items');
});

test('pre-entry budget uses target-level fees and each per-level new star bonus only once', () => {
  const result = validateDesignData(baseline.balance, baseline.campaign);
  const [s01, s02, s03] = result.economy.training;
  assert.equal(s01.ownedCoreHeroes, 2); // The third member unlocks after wei_003.
  assert.deepEqual(s03.fixedCoreHeroIds, ['cao_cao', 'guan_yu', 'xiahou_dun']);
  assert.equal(s02.requiredXp, 270); // 3 * (40 + 50), not destination-indexed XP.
  assert.equal(s02.requiredHeroCopper, 540); // 3 * (80 + 100).
  assert.equal(s02.requiredBooks, 6); // Each hero receives whole 50-XP books.
  assert.equal(s03.requiredWeaponCopper, 2250); // 3 * (100 + 150 + 500 blue promotion).
  assert.equal(s03.requiredWeaponIron, 75); // 3 * (2 + 3 + 20).
  assert.equal(s03.requiredCopper, 4050);
  assert.deepEqual(s03.starScenarios.map(row => row.availableBeforeEntry.copper_coin), [7350, 8085, 8820]);
  assert.equal(s03.starScenarios[1].newHighestStarBonuses.experience_book, 0); // floor occurs per clear, not after total summation.
  for (const row of result.economy.training) for (const budget of row.starScenarios) {
    assert.equal(budget.experienceBookGap, 0, `${row.id}, ${budget.stars} stars: books`);
    assert.equal(budget.copperGap, 0, `${row.id}, ${budget.stars} stars: copper`);
    assert.equal(budget.ironGap, 0, `${row.id}, ${budget.stars} stars: iron`);
  }
  const grant = result.economy.sequentialUnlockGrants.find(row => row.heroId === 'zhou_yu');
  assert.deepEqual(grant, { heroId: 'zhou_yu', unlockIndex: 52, freeGrantedHeroLevel: 26 });
});

test('economy reports insufficient resources without rescuing them with repeats or current-tier rewards', () => {
  const data = copy();
  const before = validateDesignData(data.balance, data.campaign).economy.training;
  for (const level of data.campaign.levels) level.repeatReward = { experience_book: 999999, copper_coin: 999999, refined_iron: 999999 };
  const withRepeats = validateDesignData(data.balance, data.campaign).economy.training;
  assert.deepEqual(withRepeats, before);
  data.campaign.levels[10].firstClearReward.copper_coin = 999999;
  assert.deepEqual(validateDesignData(data.balance, data.campaign).economy.training[2], before[2]); // No wei_011 income before entering S03.
  for (const level of data.campaign.levels) level.firstClearReward = { experience_book: 0, copper_coin: 0, refined_iron: 0 };
  const shortfall = validateDesignData(data.balance, data.campaign);
  assert.equal(shortfall.ok, true); // Legal data, budget notes are distinct from schema/reference errors.
  assert.equal(shortfall.economy.training[2].starScenarios[0].copperGap, 4050);
  assert.equal(shortfall.economy.training[2].starScenarios[2].ironGap, 75);
  assert.ok(shortfall.warnings.some(warning => warning.includes('S03') && warning.includes('repeat rewards excluded')));
  assert.equal(shortfall.summary.combatSimulationPerformed, false);
  data.balance.v1Baseline.metaProgression.initialResources = { experience_book: 18, copper_coin: 4050, refined_iron: 75 };
  const initialFunded = validateDesignData(data.balance, data.campaign).economy.training[2].starScenarios[0];
  assert.equal(initialFunded.experienceBookGap, 0);
  assert.equal(initialFunded.copperGap, 0);
  assert.equal(initialFunded.ironGap, 0);
});

test('art production references use the actual named content and local linked artifacts exist', async () => {
  const artPath = path.join(root, 'docs/v1/art-design.md');
  const art = await readFile(artPath, 'utf8');
  for (const map of baseline.campaign.maps) assert.ok(art.includes(map.id), `Art brief does not name ${map.id}`);
  for (const hero of Object.values(baseline.balance.v1Baseline.heroes)) assert.ok(art.includes(hero.name), `Art brief does not cover hero ${hero.name}`);
  for (const bossId of Object.keys(baseline.balance.v1Baseline.bossTemplates)) assert.ok(art.includes(bossId), `Art brief does not cover boss ${bossId}`);
  for (const link of art.matchAll(/\]\(([^)]+)\)/g)) {
    if (/^(https?:|#)/.test(link[1])) continue;
    await assert.doesNotReject(readFile(path.resolve(path.dirname(artPath), link[1].split('#')[0])), `Missing art brief link ${link[1]}`);
  }
  assert.match(art, /H=15/); assert.match(art, /E=6/); assert.match(art, /B=5/); assert.match(art, /M=60/);
});


test('loot conserves one weapon per victory with fixed 2.5% gold and no forge shortcut', () => {
  rejects(({balance}) => { balance.v1Baseline.loot.qualityWeights.gold = 251; }, 'loot: quality weights must conserve');
  rejects(({balance}) => { balance.v1Baseline.loot.goldProbability = .03; }, 'loot: gold chance must remain exactly 2.5%');
  rejects(({balance}) => { balance.v1Baseline.loot.chestPerVictory = 2; }, 'loot: one weapon chest per victory');
  rejects(({balance}) => { balance.v1Baseline.metaProgression.equipment.templates.signature_guan_yu_weapon.forgeQualities = ['gold']; }, 'gold cannot be forged');
  rejects(({balance}) => { balance.v1Baseline.metaProgression.equipment.qualityUpgradeCosts.push({from:'red',to:'gold',copper_coin:5000,refined_iron:200,unlockTier:'S12'}); }, 'gold may not be promoted or forged');
});

test('technology growth preserves frequency and capped hero-focused tower modifiers', () => {
  rejects(({balance}) => { balance.v1Baseline.technology.camps.catapult.perLevelBonuses.damage = .1; }, 'technology.catapult: modifiers exceed');
  rejects(({balance}) => { balance.v1Baseline.technology.requiredGlobalIndexByDestinationLevel[1] = 1; }, 'technology: invalid progression gates');
  rejects(({balance}) => { delete balance.v1Baseline.technology.camps.shield; }, 'technology: all six camps');
});

test('all fifteen heroes have a unique gold weapon and Guan Yu also has Red Hare', () => {
  rejects(({balance}) => { balance.v1Baseline.metaProgression.equipment.templates.signature_cao_cao_weapon.exclusiveHeroId = 'guan_yu'; }, 'equipment: each hero needs exactly one');
  rejects(({balance}) => { balance.v1Baseline.metaProgression.equipment.templates.signature_guan_yu_horse.name = 'ordinary mount'; }, 'Guan Yu signature weapon and horse required');
});
