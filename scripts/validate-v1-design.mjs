import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const values = value => Object.values(value || {});
const keys = value => Object.keys(value || {});
const array = value => Array.isArray(value) ? value : [];
const sum = items => items.reduce((total, value) => total + value, 0);
const sameSet = (a, b) => a.length === b.length && new Set(a).size === a.length && a.every(id => b.includes(id));
const integer = value => Number.isInteger(value) && value >= 0;
const positive = value => Number.isFinite(value) && value > 0;
const coordinateKey = point => `${point?.x}/${point?.y}`;

/** Structural/reference validation and explicit budget arithmetic, never a combat simulation. */
export function validateDesignData(balance, campaign) {
  const errors = [];
  const warnings = [];
  const check = (condition, message) => { if (!condition) errors.push(message); };
  const v = balance?.v1Baseline || {};
  const scope = balance?.scope || {};
  const heroes = v.heroes || {}, camps = v.camps || {}, enemies = v.enemies || {}, bosses = v.bossTemplates || {};
  const profiles = v.difficultyProfiles || {}, meta = v.metaProgression || {}, world = v.world || {};
  const levels = array(campaign?.levels), maps = array(campaign?.maps), chapters = array(campaign?.chapters), tiers = array(v.stageGrowthTiers);
  const levelById = new Map(levels.map(level => [level.id, level]));
  const mapById = new Map(maps.map(map => [map.id, map]));
  const tierById = new Map(tiers.map(tier => [tier.id, tier]));
  const chapterOrder = array(campaign?.campaignOrder);
  const currencies = keys(meta.currencies);
  const uniqueIds = (items, label) => check(new Set(items.map(item => item.id)).size === items.length, `${label}: duplicate ID`);
  const reward = (data, label) => {
    check(data && typeof data === 'object', `${label}: missing rewards`);
    for (const [id, count] of Object.entries(data || {})) {
      check(currencies.includes(id), `${label}: unknown meta currency ${id}`);
      check(integer(count), `${label}.${id}: expected nonnegative integer`);
    }
  };
  const inWorld = (point, width, height, label, entry = false) => {
    check(Number.isFinite(point?.x) && Number.isFinite(point?.y) && point.x >= 0 && point.x <= width && point.y >= (entry ? -32 : 0) && point.y <= height, `${label}: coordinates outside world/entry margin`);
  };

  check(keys(heroes).length === 15 && scope.heroCount === 15, 'V1 requires 15 heroes');
  check(keys(camps).length === 6, 'V1 requires six camps');
  check(keys(enemies).length === 7, 'V1 requires six nonboss enemies plus boss');
  check(keys(bosses).length === 5, 'V1 requires five boss templates');
  check(chapters.length === 3 && levels.length === 60 && maps.length === 12, 'V1 requires 3 chapters, 60 levels and 12 map templates');
  check(sameSet(chapterOrder, ['wei', 'shu', 'wu']) && chapterOrder.join('/') === array(v.chapterOrder).join('/'), 'Chapter order must agree between balance and campaign');
  check(scope.levelCount === levels.length && scope.mapTemplateCount === maps.length && campaign?.scope?.levels === levels.length, 'Declared content counts do not match data');
  check(sameSet(keys(heroes), array(scope.heroIds)), 'Confirmed hero roster IDs do not match hero dictionary');
  uniqueIds(levels, 'levels'); uniqueIds(maps, 'maps'); uniqueIds(tiers, 'stage tiers'); uniqueIds(chapters, 'chapters');
  check(tiers.length === 12, 'V1 requires twelve five-level growth tiers');
  check(sameSet(array(balance?.levelContract?.mapIds), maps.map(map => map.id)), 'Balance map reference list differs from campaign maps');
  for (const [field, dictionary] of [['heroId', heroes], ['campId', camps], ['enemyId', enemies], ['bossTemplateId', bosses], ['difficultyProfileId', profiles]]) {
    check(sameSet(array(balance?.levelReferenceSchema?.properties?.[field]?.enum), keys(dictionary)), `Reference schema ${field} enum is stale`);
  }
  for (const chapter of chapters) {
    const roster = keys(heroes).filter(id => heroes[id].faction === chapter.id);
    check(roster.length === 5 && sameSet(roster, array(chapter.heroIds)), `${chapter.id}: faction roster must contain five matching heroes`);
    const chapterLevels = levels.filter(level => level.chapterId === chapter.id);
    check(chapterLevels.length === 20 && array(chapter.acts).length === 5, `${chapter.id}: requires twenty levels in five acts`);
    check(sameSet(array(chapter.levelIds), chapterLevels.map(level => level.id)), `${chapter.id}: chapter level references are stale`);
    check(maps.filter(map => map.id.startsWith(`${chapter.id}_`)).length === 4, `${chapter.id}: requires four map templates`);
  }
  for (const [id, camp] of Object.entries(camps)) {
    check(integer(camp.buildCost) && camp.buildCost > 0, `${id}: invalid camp build cost`);
    check(array(camp.levels).map(level => level.level).join('/') === '1/2/3', `${id}: camp levels must be 1/2/3`);
    for (const level of array(camp.levels)) check(integer(level.upgradeCost) && positive(level.range), `${id} Lv${level.level}: invalid upgrade cost/range`);
  }
  for (const [id, enemy] of Object.entries(enemies)) check(positive(enemy.hp) && positive(enemy.speed) && integer(enemy.reward), `${id}: invalid enemy HP/speed/reward`);
  for (const [id, boss] of Object.entries(bosses)) check(enemies[boss.enemyBaseId]?.class === 'boss', `${id}: unknown boss enemy base`);
  const party = v.party || {};
  check(party.maxHeroes === 3 && party.leadCount === 1 && party.supportCountMax === 2, 'Party must be one lead and up to two supports');
  check(sameSet(keys(party.enemyHpMultipliersByPartySize), ['1', '2', '3']), 'Party HP profiles must cover sizes 1/2/3');
  for (const size of [1, 2, 3]) check(positive(party.enemyHpMultipliersByPartySize?.[size]), `Party ${size}: invalid HP multiplier`);
  check(v.enemyScaling?.automaticHpAddPerWave === 0 && v.enemyScaling?.automaticSpeedGrowthPerWave === 0, 'Formal levels must not inherit prototype automatic wave growth');
  const speed = v.battleSpeed || {}, density = v.enemyDensity || {}, generation = campaign?.generationFacts || {};
  check(array(speed.allowedMultipliers).join('/') === '1/1.5/2' && speed.defaultMultiplier === 1 && speed.firstGuideMultiplier === 1 && speed.forceFirstGuideNormalSpeed === true, 'v1Baseline.battleSpeed: legal speeds and first guide must be 1/1.5/2 and normal');
  check(speed.fixedStepSec > 0 && speed.fixedStepSec <= 1 / 60 && speed.maximumStepSec <= 1 / 60 && speed.dropAccumulatedCombatTime === false && speed.hiddenStateAdvancesCombat === false && speed.pausedStatesAdvanceCombat === false, 'v1Baseline.battleSpeed: fixed substeps must preserve combat time and freeze hidden/paused states');
  check(speed.audioPlaybackRate === 1 && array(speed.wallClockOnly).includes('audio_pitch_and_tempo') && ['spawn_schedule', 'personal_rage', 'rage_recovery', 'skill_queue', 'skill_damage_ticks'].every(id => array(speed.appliesTo).includes(id)), 'v1Baseline.battleSpeed: all battle timers share combat time while audio stays at normal tempo');
  check(positive(density.densityMultiplier) && density.runtimeMultiplier === 1 && density.spawnWindowMultiplier === 1 && density.realEnemiesOnly === true && density.countsAlreadyIncludeDensity === true, 'v1Baseline.enemyDensity: real-enemy density is baked once and must not extend spawn windows');
  check(density.maximumAliveEnemies === 160 && density.overflowPolicy?.includes('never discard'), 'v1Baseline.enemyDensity: retain overflow enemies in the pending spawn queue');
  check(generation.densityMultiplier === density.densityMultiplier && generation.runtimeCountMultiplier === 1 && generation.realEnemiesOnly === true && generation.countRounding === density.countRounding && array(generation.baseWaveCounts).length >= 10 && array(generation.spawnWindowSec).length >= 10, 'campaign.generationFacts: density generation contract is stale');
  check(v.enemies?.infantry?.reward === 1, 'infantry: dense army must retain a readable one-food reward');
  check(v.camps?.shield?.slowApplication?.includes('continuous aura') && v.camps?.shield?.minimumSpeedFactor === 0.3 && v.modifierRules?.slowMinimumSpeedFactor === 0.3, 'shield: gathering aura must remain independent of attack cadence and respect the speed floor');
  check(v.tactics?.archer_volley?.effects?.extraProjectileCanPierce === false && v.modifierRules?.campAttackHitBudgets?.archer?.maxSecondaryPierceHitsPerCycle === 1, 'archer: volley must not multiply secondary area hits');
  check(v.camps?.catapult?.damageTargetCap === 6 && v.camps?.catapult?.controlTargetCap === null && v.modifierRules?.campAttackHitBudgets?.catapult?.tacticsNeverIncreaseDamageCap === true, 'catapult: six-target damage cap must preserve uncapped in-radius control coverage');

  const gear = meta.equipment || {}, stars = meta.starsReward || {};
  reward(meta.initialResources, 'v1Baseline.metaProgression.initialResources');
  check(sameSet(keys(meta.initialResources), currencies), 'v1Baseline.metaProgression.initialResources: every currency must be explicit');
  check(sameSet(array(meta.minimumClearanceBudgetSlots), ['weapon']), 'v1Baseline.metaProgression.minimumClearanceBudgetSlots: minimum budget must cover the main weapon');
  check(stars.minStarsOnWin === 1 && stars.maxStars === 3 && array(stars.bonusStars).join('/') === '2/3', 'v1Baseline.metaProgression.starsReward: reward tiers must be 1/2/3');
  check(Number.isFinite(stars.bonusFractionOfBasePerNewStar) && stars.bonusFractionOfBasePerNewStar >= 0 && stars.rounding === 'floor_per_currency_per_new_star', 'v1Baseline.metaProgression.starsReward: invalid bonus fraction/rounding');
  check(stars.baseFirstClearRewardOnce === true && stars.trackHighestStarsPerLevel === true && stars.payOnlyNewHighestStarDifference === true && stars.repeatedHeroDoesNotResetProgress === true, 'v1Baseline.metaProgression.starsReward: base/star rewards must not be paid repeatedly');
  check(sameSet(array(meta.heroStarterGear?.items).map(item => item.slot), array(gear.slots)) && array(meta.heroStarterGear?.items).every(item => item.quality === 'white' && item.level === 0), 'v1Baseline.metaProgression.heroStarterGear.items: each hero needs four white Lv0 starter items');
  check(meta.heroStarterGear?.oncePerHero === true && meta.heroStarterGear?.ownership === 'transferable_inventory' && currencies.every(id => meta.heroStarterGear?.resourceCost?.[id] === 0), 'v1Baseline.metaProgression.heroStarterGear: starter items must be free and granted once independently per hero');
  check(meta.newHeroCatchUp?.enabled === true && meta.newHeroCatchUp?.freeHeroLevel === true && meta.newHeroCatchUp?.freeXpAndCoinCostForGrantedLevels === true && meta.newHeroCatchUp?.doesNotGrantSkillLevels === true && meta.newHeroCatchUp?.doesNotGrantEquipment === true, 'v1Baseline.metaProgression.newHeroCatchUp: granted hero levels must be free and exclude skill/equipment upgrades');
  check(positive(meta.currencies?.experience_book?.xpPerBook), 'v1Baseline.metaProgression.currencies.experience_book.xpPerBook: invalid XP value');
  for (const [field, coefficients] of Object.entries({ 'heroLevel.xpNextLevelCoefficients': meta.heroLevel?.xpNextLevelCoefficients, 'heroLevel.coinNextLevelCoefficients': meta.heroLevel?.coinNextLevelCoefficients, 'equipment.upgradeCoinCoefficients': gear.upgradeCoinCoefficients, 'equipment.upgradeIronCoefficients': gear.upgradeIronCoefficients })) {
    check(positive(coefficients?.base) && integer(coefficients?.perPriorLevel ?? coefficients?.perPriorDestinationLevel), `v1Baseline.metaProgression.${field}: invalid cost coefficients`);
  }
  check(gear.levelMin === 0 && gear.levelMax === 10 && array(gear.qualityIds).join('/') === 'white/blue/purple/red/gold', 'v1Baseline.metaProgression.equipment: invalid level/quality progression');
  check(gear.qualityUpgradeCosts?.length === 3 && gear.promotionMaxQuality === 'red' && gear.goldWeaponSource === 'victory_chest_only', 'equipment: gold may not be promoted or forged');
  for (const [index, upgrade] of array(gear.qualityUpgradeCosts).entries()) {
    check(upgrade.from === gear.qualityIds[index] && upgrade.to === gear.qualityIds[index + 1] && tierById.has(upgrade.unlockTier), `v1Baseline.metaProgression.equipment.qualityUpgradeCosts[${index}]: invalid quality/unlock chain`);
    reward({ copper_coin: upgrade.copper_coin, refined_iron: upgrade.refined_iron }, `v1Baseline.metaProgression.equipment.qualityUpgradeCosts[${index}]`);
  }

  const tech = v.technology || {}, loot = v.loot || {}, templates = gear.templates || {};
  check(sameSet(keys(tech.camps), keys(camps)) && tech.levelMax === 10 && tech.initialLevel === 0 && tech.battleSnapshot === true, 'technology: all six camps require capped independent battle snapshots');
  check(array(tech.requiredGlobalIndexByDestinationLevel).length === tech.levelMax && array(tech.requiredGlobalIndexByDestinationLevel).every((n,i,a) => Number.isInteger(n) && n >= 1 && n <= levels.length && (!i || n > a[i-1])), 'technology: invalid progression gates');
  check(positive(tech.coinCostCoefficients?.base) && integer(tech.coinCostCoefficients?.perPriorDestinationLevel) && positive(tech.ironCostCoefficients?.base) && integer(tech.ironCostCoefficients?.perTwoPriorDestinationLevels), 'technology: invalid costs');
  for (const [id, entry] of Object.entries(tech.camps || {})) {
    const bonuses = entry.perLevelBonuses || {};
    check(entry.levelMax === 10 && bonuses.range === 1.5 && bonuses.damage === (id === 'war_drum' ? 0 : .025) && bonuses.auraDamage === (id === 'war_drum' ? .002 : 0), `technology.${id}: modifiers exceed the capped hero-focused design`);
  }
  check(loot.chestPerVictory === 1 && loot.itemsPerChest === 1 && loot.repeatsGrantChest === true && loot.defeatsGrantChest === false && loot.itemSlot === 'weapon', 'loot: one weapon chest per victory including repeats');
  check(sameSet(keys(loot.qualityWeights), array(gear.qualityIds)) && values(loot.qualityWeights).every(integer) && sum(values(loot.qualityWeights)) === loot.weightScale && loot.weightScale === 10000, 'loot: quality weights must conserve 10000');
  check(loot.qualityWeights?.gold === 250 && loot.goldProbability === .025 && loot.pityEnabled === false, 'loot: gold chance must remain exactly 2.5%');
  check(loot.rollAt === 'unique_winning_settlement_transaction' && loot.revealDoesNotRoll === true && loot.randomSource === 'independent_from_combat_seed', 'loot: reward must be atomic and independent from combat randomness');
  check(array(loot.goldTemplateIds).length === 15 && new Set(loot.goldTemplateIds).size === 15, 'loot: fifteen unique signature weapons required');
  const signatureHeroes = [];
  for (const [id, entry] of Object.entries(templates)) {
    check(entry.id === id && typeof entry.name === 'string' && array(gear.slots).includes(entry.slot), `equipment.templates.${id}: invalid identity or slot`);
    check(array(entry.forgeQualities).every(q => array(gear.qualityIds).includes(q) && q !== 'gold'), `equipment.templates.${id}: gold cannot be forged`);
    if (entry.exclusiveHeroId) {
      check(!!heroes[entry.exclusiveHeroId] && keys(entry.signatureBonuses).length > 0, `equipment.templates.${id}: invalid signature hero or effect`);
      check(values(entry.signatureBonuses).every(n => Number.isFinite(n) && n >= 0), `equipment.templates.${id}: invalid signature bonus`);
    }
    if (entry.quality === 'gold') {
      check(entry.slot === 'weapon' && entry.source === 'victory_chest_only' && array(entry.forgeQualities).length === 0 && array(loot.goldTemplateIds).includes(id), `equipment.templates.${id}: gold weapon must be chest-only`);
      signatureHeroes.push(entry.exclusiveHeroId);
    }
  }
  check(sameSet(signatureHeroes, keys(heroes)), 'equipment: each hero needs exactly one signature gold weapon');
  check(templates.signature_guan_yu_weapon?.name === '青龙偃月刀' && templates.signature_guan_yu_horse?.name === '赤兔', 'equipment: Guan Yu signature weapon and horse required');
  check(gear.forging?.noGoldForging === true && sameSet(keys(gear.forging?.ordinaryCosts), ['white','blue','purple','red']), 'equipment.forging: ordinary forge qualities must stop at red');
  for (const [quality, cost] of Object.entries(gear.forging?.ordinaryCosts || {})) { reward({copper_coin:cost.copper_coin,refined_iron:cost.refined_iron}, `equipment.forging.${quality}`); check(tierById.has(cost.unlockTier), `equipment.forging.${quality}: invalid unlock tier`); }

  for (const [index, tier] of tiers.entries()) {
    check(tier.id === `S${String(index + 1).padStart(2, '0')}` && array(tier.globalCampaignLevelRange).join('/') === `${index * 5 + 1}/${index * 5 + 5}`, `${tier.id}: tier must cover its five consecutive campaign levels`);
    check(tier.chapterId === chapterOrder[Math.floor(index / 4)], `${tier.id}: growth tier assigned to wrong chapter`);
    check(tier.automaticWaveHpGrowth === false, `${tier.id}: automatic wave HP growth forbidden`);
    for (const name of ['hpMultiplier', 'countMultiplier', 'speedMultiplier', 'rewardMultiplier']) check(positive(tier[name]), `${tier.id}: invalid ${name}`);
    check(integer(tier.startingFood), `${tier.id}: invalid starting food`);
    reward(tier.firstClearReward, `${tier.id}.firstClearReward`);
    for (const [field, min, max] of [['recommendedHeroLevelRange', meta.heroLevel?.min, meta.heroLevel?.max], ['recommendedSkillLevelRange', meta.skillLevel?.min, meta.skillLevel?.max], ['recommendedMainWeaponLevelRange', gear.levelMin, gear.levelMax]]) {
      const range = array(tier[field]);
      check(range.length === 2 && range.every(integer) && range[0] >= min && range[1] <= max && range[0] <= range[1], `${tier.id}.${field}: invalid recommended range`);
    }
    check(tier.recommendedHeroLevelRange?.[0] >= meta.skillLevel?.requiredHeroLevelBySkillLevel?.[tier.recommendedSkillLevelRange?.[0] - 1], `${tier.id}.recommendedSkillLevelRange: minimum hero level cannot unlock minimum recommended skill`);
    check(tier.recommendedHeroLevelRange?.[1] >= meta.skillLevel?.requiredHeroLevelBySkillLevel?.[tier.recommendedSkillLevelRange?.[1] - 1], `${tier.id}.recommendedSkillLevelRange: upper hero recommendation cannot unlock upper recommended skill`);
    check(sameSet(array(tier.recommendedEquipmentSlots), ['weapon']) && tier.recommendedGearScope === 'main_weapon_only' && tier.otherEquipmentMinimumRequired?.quality === 'white' && tier.otherEquipmentMinimumRequired?.level === 0, `${tier.id}.recommendedEquipmentSlots: optional equipment must remain white Lv0 for minimum budget`);
    check(array(gear.qualityIds).includes(tier.recommendedMainWeaponQuality), `${tier.id}.recommendedMainWeaponQuality: unknown quality`);
    const qualityIndex = array(gear.qualityIds).indexOf(tier.recommendedMainWeaponQuality);
    check(array(gear.qualityUpgradeCosts).slice(0, qualityIndex).every(upgrade => tiers.findIndex(item => item.id === upgrade.unlockTier) <= index), `${tier.id}.recommendedMainWeaponQuality: quality forging is locked at tier entry`);
  }

  for (const map of maps) {
    const [width, height] = array(map.world);
    check(width === world.width && height === world.height, `${map.id}: world dimensions differ from battle coordinates`);
    const slots = array(map.campSlots), paths = array(map.paths), heroSlots = array(map.heroSlots);
    check(slots.length >= 6 && slots.length <= 8 && paths.length >= 2 && paths.length <= 3, `${map.id}: invalid slot/path count`);
    check(slots.map(slot => slot.slot).sort((a, b) => a - b).join('/') === Array.from({ length: slots.length }, (_, i) => i).join('/'), `${map.id}: camp slot indexes must be unique and consecutive`);
    check(new Set(slots.map(coordinateKey)).size === slots.length, `${map.id}: duplicate camp coordinates`);
    for (const slot of slots) inWorld(slot, width, height, `${map.id}.campSlots[${slot.slot}]`);
    for (let i = 0; i < slots.length; i++) for (let j = i + 1; j < slots.length; j++) {
      check(Math.hypot(slots[i].x - slots[j].x, slots[i].y - slots[j].y) >= 68, `${map.id}: 34-unit camp touch areas overlap at slots ${slots[i].slot}/${slots[j].slot}`);
    }
    check(new Set(paths.map(route => JSON.stringify(route))).size === paths.length, `${map.id}: duplicate complete paths`);
    paths.forEach((route, routeIndex) => {
      check(Array.isArray(route) && route.length >= 2, `${map.id} route ${routeIndex}: missing path points`);
      array(route).forEach((point, pointIndex) => {
        inWorld(point, width, height, `${map.id}.path${routeIndex}[${pointIndex}]`, pointIndex === 0);
        if (pointIndex > 0) check(coordinateKey(point) !== coordinateKey(route[pointIndex - 1]), `${map.id} route ${routeIndex}: zero-length segment`);
      });
      check(coordinateKey(array(route).at(-1)) === coordinateKey(array(paths[0]).at(-1)), `${map.id}: lanes do not reach the same gate`);
    });
    check(heroSlots.length === 3 && heroSlots.filter(slot => slot.role === 'lead').length === 1 && heroSlots.filter(slot => slot.role === 'support').length === 2, `${map.id}: invalid lead/support positions`);
    check(new Set(heroSlots.map(coordinateKey)).size === heroSlots.length, `${map.id}: duplicate hero positions`);
    for (const slot of heroSlots) inWorld(slot, width, height, `${map.id}.heroSlots`);
    check(sameSet(heroSlots.map(coordinateKey), values(party.heroPositions).map(coordinateKey)) && coordinateKey(heroSlots.find(slot => slot.role === 'lead')) === coordinateKey(party.heroPositions?.lead), `${map.id}.heroSlots: positions differ from shared party layout`);
    if (map.rule?.campModifier?.slot !== undefined) check(slots.some(slot => slot.slot === map.rule.campModifier.slot), `${map.id}: map bonus refers to missing camp slot`);
    check(levels.some(level => level.mapId === map.id), `${map.id}: unused map template`);
  }

  const initialHeroes = array(campaign?.initialHeroIds), initialCamps = array(campaign?.initialCampTypes);
  check(sameSet(initialHeroes, array(meta.initialHeroIds)), 'Initial hero IDs disagree between JSON files');
  check(sameSet(initialCamps, array(v.chapterTowerUnlock?.initial)), 'Initial camps disagree between JSON files');
  for (const id of initialHeroes) check(Boolean(heroes[id]), `Unknown initial hero ${id}`);
  for (const id of initialCamps) check(Boolean(camps[id]), `Unknown initial camp ${id}`);
  check(initialHeroes.includes(meta.defaultParty?.lead) && array(meta.defaultParty?.support).every(id => initialHeroes.includes(id)) && new Set([meta.defaultParty?.lead, ...array(meta.defaultParty?.support)]).size === 1 + array(meta.defaultParty?.support).length && array(meta.defaultParty?.support).length <= 2, 'v1Baseline.metaProgression.defaultParty: invalid initial hero selection');
  const heroUnlocks = array(meta.heroUnlocks);
  check(sameSet(heroUnlocks.map(unlock => unlock.heroId), keys(heroes)), 'Every hero must have exactly one unlock entry');
  const campUnlocks = chapterOrder.flatMap(chapter => array(v.chapterTowerUnlock?.[chapter]));
  check(sameSet([...initialCamps, ...campUnlocks.map(unlock => unlock.campId)], keys(camps)), 'Every camp must be initial or unlocked exactly once');
  for (const unlock of heroUnlocks) {
    check(Boolean(heroes[unlock.heroId]), `Unlock references unknown hero ${unlock.heroId}`);
    check(unlock.levelId === null ? initialHeroes.includes(unlock.heroId) : levelById.get(unlock.levelId)?.unlockHeroId === unlock.heroId, `${unlock.heroId}: hero unlock does not match campaign clear reward`);
  }
  for (const unlock of campUnlocks) check(levelById.get(unlock.levelId)?.unlockCampType === unlock.campId, `${unlock.campId}: camp unlock does not match campaign clear reward`);
  const availableHeroes = new Set(initialHeroes), availableCamps = new Set(initialCamps);
  const sorted = [...levels].sort((a, b) => a.globalIndex - b.globalIndex);
  let waveCount = 0, bossEncounters = 0;
  const encounterNames = new Set(), enemyFirstIndex = new Map(), battleBudgets = [];
  for (const [index, level] of sorted.entries()) {
    const label = level.id;
    const expectedChapter = chapterOrder[Math.floor(index / 20)];
    check(level.globalIndex === index + 1 && level.order === index % 20 + 1 && level.chapterId === expectedChapter, `${label}: global/chapter order is not linear`);
    check(label === `${expectedChapter}_${String(level.order).padStart(3, '0')}`, `${label}: inconsistent stable level ID`);
    check(level.prerequisite === (index === 0 ? 'tutorial_available' : sorted[index - 1].id), `${label}: prerequisite must be previous formal level`);
    const map = mapById.get(level.mapId), tier = tierById.get(level.growthTierId), profile = profiles[level.difficultyProfileId];
    check(Boolean(map) && level.mapId.startsWith(`${level.chapterId}_`), `${label}: missing/cross-chapter map`);
    check(Boolean(tier) && tier?.chapterId === level.chapterId, `${label}: unknown/wrong growth tier`);
    check(Boolean(profile), `${label}: unknown difficulty profile`);
    if (tier) {
      check(level.globalIndex >= tier.globalCampaignLevelRange[0] && level.globalIndex <= tier.globalCampaignLevelRange[1], `${label}: growth tier outside assigned range`);
      check(array(level.recommendedHeroLevelRange).join('/') === array(tier.recommendedHeroLevelRange).join('/'), `${label}: hero recommendation differs from growth tier`);
    }
    check(Number.isInteger(level.maxPartySize) && level.maxPartySize >= 1 && level.maxPartySize <= 3 && availableHeroes.size >= level.maxPartySize, `${label}: invalid/unavailable party size`);
    check(level.countsAlreadyIncludeTier === true && level.hpMultipliersExcludeTier === true, `${label}: explicit count/HP scaling markers are missing`);
    check(level.countsAlreadyIncludeDensity === true && level.generationFacts?.densityMultiplier === density.densityMultiplier && level.generationFacts?.spawnWindowMultiplier === 1, `${label}: density is already resolved; runtime must not multiply it again`);
    check(integer(level.startingFood), `${label}: invalid starting food`);
    reward(level.firstClearReward, `${label}.firstClearReward`); reward(level.repeatReward, `${label}.repeatReward`);
    check(level.stars?.bonusRewardFractionPerNewStar === stars.bonusFractionOfBasePerNewStar && array(level.stars?.bonusStars).join('/') === array(stars.bonusStars).join('/') && level.stars?.rewardRounding === stars.rounding && level.stars?.rewardTracking === 'highest_rewarded_stars_per_level', `${label}.stars: reward strategy differs from account star policy`);
    const free = array(level.freeCamps);
    check(new Set(free.map(camp => camp.slot)).size === free.length, `${label}: multiple free camps occupy one slot`);
    for (const camp of free) {
      check(Boolean(camps[camp.type]) && availableCamps.has(camp.type), `${label}: free camp ${camp.type} is unknown/locked`);
      check(array(map?.campSlots).some(slot => slot.slot === camp.slot), `${label}: free camp has nonexistent slot ${camp.slot}`);
    }
    if (level.storyGuest) {
      check(Boolean(heroes[level.storyGuest.heroId]) && availableHeroes.has(level.storyGuest.heroId), `${label}: guest hero is unknown/not yet unlocked`);
      check(integer(level.storyGuest.level) && level.storyGuest.level >= 1 && level.storyGuest.level <= meta.heroLevel?.max, `${label}: invalid guest hero level`);
      check(level.storyGuest.occupiesPartySlot === true, `${label}: guest must occupy a party slot`);
      const guest = level.storyGuest;
      const guestPreset = campaign?.guestPresets?.[guest.equipmentPresetId];
      check(Boolean(guestPreset), `${label}.storyGuest.equipmentPresetId: unknown guest preset`);
      check(guestPreset?.persistToInventory === false && guestPreset?.occupiesPartySlot === true && guestPreset?.otherEquipment?.quality === 'white' && guestPreset?.otherEquipment?.level === 0, `${label}.storyGuest.equipmentPresetId: guest preset must remain temporary and occupy a party slot`);
      check(Number.isInteger(guest.skillLevel) && guest.skillLevel >= meta.skillLevel?.min && guest.skillLevel <= meta.skillLevel?.max && guest.level >= meta.skillLevel?.requiredHeroLevelBySkillLevel?.[guest.skillLevel - 1], `${label}.storyGuest.skillLevel: invalid or locked skill level`);
      check(sameSet(keys(guest.equipment), array(gear.slots)), `${label}.storyGuest.equipment: explicit guest loadout must cover four slots`);
      for (const [slot, equipment] of Object.entries(guest.equipment || {})) {
        check(array(gear.qualityIds).includes(equipment.quality) && integer(equipment.level) && equipment.level >= gear.levelMin && equipment.level <= gear.levelMax, `${label}.storyGuest.equipment.${slot}: invalid equipment quality/level`);
        if (slot !== 'weapon') check(equipment.quality === 'white' && equipment.level === 0, `${label}.storyGuest.equipment.${slot}: optional guest equipment must be white Lv0`);
      }
      if (tier) check(guest.level === tier.recommendedHeroLevelRange?.[0] && guest.skillLevel === tier.recommendedSkillLevelRange?.[0] && guest.equipment?.weapon?.quality === tier.recommendedMainWeaponQuality && guest.equipment?.weapon?.level === tier.recommendedMainWeaponLevelRange?.[0], `${label}.storyGuest: guest level/skill/weapon differs from chapter tier minimum`);
    }
    const waves = array(level.waves), choices = array(level.choiceAfterWaves);
    check(waves.length >= 1, `${label}: no waves`);
    check(new Set(choices).size === choices.length && choices.every(wave => Number.isInteger(wave) && wave > 0 && wave < waves.length), `${label}: invalid choice checkpoints`);
    let rewardUpperBound = 0, levelBosses = 0;
    for (const [waveIndex, wave] of waves.entries()) {
      const prefix = `${label}.wave${wave.index}`;
      waveCount++;
      check(wave.index === waveIndex + 1, `${prefix}: wave indexes must be consecutive`);
      check(integer(wave.count) && wave.count > 0 && sum(values(wave.units)) === wave.count, `${prefix}: unit total differs from count`);
      const expectedCount = Math.round((generation.baseWaveCounts?.[waveIndex] || 0) * (tier?.countMultiplier || 0) * (level.generationFacts?.inActCountMultiplier || 0) * density.densityMultiplier);
      check(wave.count === expectedCount && wave.spawnWindowSec === generation.spawnWindowSec?.[waveIndex], `${prefix}: count/duration differs from density baked once into the fixed spawn window`);
      for (const [enemyId, count] of Object.entries(wave.units || {})) {
        check(Boolean(enemies[enemyId]) && enemyId !== 'boss' && integer(count), `${prefix}: invalid ordinary group ${enemyId}`);
        if (count > 0 && !enemyFirstIndex.has(enemyId)) enemyFirstIndex.set(enemyId, level.globalIndex);
      }
      const packs = array(wave.packs), packCounts = {};
      check(packs.length > 0 && positive(wave.spawnWindowSec), `${prefix}: missing timed spawn packs`);
      for (const pack of packs) {
        check(Number.isFinite(pack.startSec) && pack.startSec >= 0 && positive(pack.durationSec) && pack.startSec + pack.durationSec <= wave.spawnWindowSec + 0.02, `${prefix}: pack outside spawn window`);
        for (const [enemyId, count] of Object.entries(pack.units || {})) {
          check(Boolean(enemies[enemyId]) && enemyId !== 'boss' && integer(count), `${prefix}: invalid pack units ${enemyId}`);
          packCounts[enemyId] = (packCounts[enemyId] || 0) + count;
        }
      }
      check(sum(values(packCounts)) === wave.count && keys({ ...wave.units, ...packCounts }).every(id => (packCounts[id] || 0) === (wave.units?.[id] || 0)), `${prefix}: spawn pack totals differ from wave units/count`);
      const lanes = array(wave.laneDistribution);
      check(lanes.length === array(map?.paths).length && lanes.every(value => Number.isFinite(value) && value >= 0) && Math.abs(sum(lanes) - 1) < 1e-6, `${prefix}: lane distribution must cover each route and sum to one`);
      for (const name of ['hpMultiplier', 'speedMultiplier', 'rewardMultiplier']) check(positive(wave[name]), `${prefix}: invalid explicit ${name}`);
      for (const [enemyId, count] of Object.entries(wave.units || {})) {
        const baseReward = enemies[enemyId]?.reward ?? 0;
        rewardUpperBound += count * Math.max(0, Math.round(baseReward * (tier?.rewardMultiplier ?? 1) * (profile?.rewardMultiplier ?? 1) * wave.rewardMultiplier));
      }
      if (wave.bossSpawn) {
        const spawn = wave.bossSpawn;
        levelBosses++; bossEncounters++;
        if (!enemyFirstIndex.has('boss')) enemyFirstIndex.set('boss', level.globalIndex);
        check(Boolean(bosses[spawn.templateId]) && positive(spawn.hpMultiplier), `${prefix}: invalid boss template/multiplier`);
        check(waveIndex === waves.length - 1, `${prefix}: act boss must be on the final wave`);
        check(spawn.ignoreWaveHpMultiplier === true, `${prefix}: boss must exclude wave HP multiplier to prevent double scaling`);
        const actFactor = array(v.bossActHpMultipliers)[level.act - 1];
        check(positive(actFactor) && Math.abs(spawn.hpMultiplier - actFactor * (spawn.variantHpMultiplier ?? 1)) < 1e-6, `${prefix}: boss HP does not contain the act factor exactly once`);
        // A boss has its own scheduled arrival and may follow the ordinary spawn window.
        check(Number.isFinite(spawn.spawnAtSec) && spawn.spawnAtSec >= 0 && Number.isFinite(spawn.warningSec) && spawn.warningSec >= 0 && spawn.warningSec <= spawn.spawnAtSec, `${prefix}: invalid boss warning/spawn timing`);
        check(Boolean(spawn.name) && !encounterNames.has(spawn.name), `${prefix}: missing/repeated named boss variant`); encounterNames.add(spawn.name);
        const baseId = bosses[spawn.templateId]?.enemyBaseId;
        rewardUpperBound += Math.round((enemies[baseId]?.reward ?? 0) * (tier?.rewardMultiplier ?? 1) * (profile?.rewardMultiplier ?? 1) * wave.rewardMultiplier);
      }
    }
    check(level.act === Math.ceil(level.order / 4), `${label}: act numbering differs from four-level structure`);
    check(levelBosses === (level.order % 4 === 0 ? 1 : 0), `${label}: act end must have exactly one boss, other levels none`);
    check(level.rewardsExcludeSummons === true, `${label}: summoned reinforcements must not inflate reward budgets`);
    const cheapestBuild = Math.min(...[...availableCamps].map(id => camps[id]?.buildCost ?? Infinity));
    const basicBuildCost = (array(map?.campSlots).length - free.length) * cheapestBuild;
    const cheapestUpgradeCost = Math.min(...[...availableCamps].map(id => sum(array(camps[id]?.levels).map(item => item.upgradeCost))));
    const cheapestFullLevelThreeFieldCost = basicBuildCost + array(map?.campSlots).length * cheapestUpgradeCost;
    battleBudgets.push({ levelId: label, tierId: level.growthTierId, startingFood: level.startingFood, foodIfAllScheduledEnemiesKilled: level.startingFood + rewardUpperBound, cheapestFillEmptySlotsCost: basicBuildCost, cheapestFullLevelThreeFieldCost, allKillMarginAfterCheapestFullMax: level.startingFood + rewardUpperBound - cheapestFullLevelThreeFieldCost, startingBuildMargin: level.startingFood - basicBuildCost, basicBuildMargin: level.startingFood + rewardUpperBound - basicBuildCost, startingAdditionalCampsAffordable: Math.floor(level.startingFood / cheapestBuild) });
    if (level.unlockHeroId) { check(Boolean(heroes[level.unlockHeroId]) && !availableHeroes.has(level.unlockHeroId), `${label}: duplicate/unknown hero unlock`); availableHeroes.add(level.unlockHeroId); }
    if (level.unlockCampType) { check(Boolean(camps[level.unlockCampType]) && !availableCamps.has(level.unlockCampType), `${label}: duplicate/unknown camp unlock`); availableCamps.add(level.unlockCampType); }
  }
  check(sameSet(keys(v.enemyIntroductions), keys(enemies)), 'v1Baseline.enemyIntroductions: every enemy needs an introduction reference');
  for (const [enemyId, levelId] of Object.entries(v.enemyIntroductions || {})) check(levelById.get(levelId)?.globalIndex === enemyFirstIndex.get(enemyId), `${enemyId}: introduction reference does not match first scheduled appearance`);
  check(bossEncounters === 15, 'V1 must contain fifteen act-end boss encounters');
  check(sameSet([...availableHeroes], keys(heroes)) && sameSet([...availableCamps], keys(camps)), 'Campaign does not unlock the complete hero/camp roster');

  const training = calculateTrainingBudgets(v, sorted);
  const stages = tiers.map(tier => {
    const rows = battleBudgets.filter(row => row.tierId === tier.id);
    return { id: tier.id, levels: rows.length, startingFoodRange: [Math.min(...rows.map(row => row.startingFood)), Math.max(...rows.map(row => row.startingFood))], startingCampsAffordableRange: [Math.min(...rows.map(row => row.startingAdditionalCampsAffordable)), Math.max(...rows.map(row => row.startingAdditionalCampsAffordable))], allKillFoodRange: [Math.min(...rows.map(row => row.foodIfAllScheduledEnemiesKilled)), Math.max(...rows.map(row => row.foodIfAllScheduledEnemiesKilled))], allKillFullMaxMarginRange: [Math.min(...rows.map(row => row.allKillMarginAfterCheapestFullMax)), Math.max(...rows.map(row => row.allKillMarginAfterCheapestFullMax))], minimumStartingBuildMargin: Math.min(...rows.map(row => row.startingBuildMargin)), minimumBasicBuildMargin: Math.min(...rows.map(row => row.basicBuildMargin)) };
  });
  for (const stage of stages) if (stage.minimumBasicBuildMargin < 0) warnings.push(`${stage.id}: even all-kill food cannot fill empty slots with cheapest unlocked camps (gap ${-stage.minimumBasicBuildMargin})`);
  for (const row of training) {
    for (const budget of row.starScenarios) if (budget.experienceBookGap > 0 || budget.copperGap > 0 || budget.ironGap > 0) warnings.push(`${row.id}: prior ${budget.stars}-star first clears leave minimum three-core main-weapon pre-entry book/copper/iron gaps ${budget.experienceBookGap}/${budget.copperGap}/${budget.ironGap}; repeat rewards excluded`);
  }
  return { ok: errors.length === 0, errors, warnings, summary: { heroes: keys(heroes).length, levels: levels.length, maps: maps.length, camps: keys(camps).length, enemiesIncludingBoss: keys(enemies).length, bossTemplates: keys(bosses).length, waves: waveCount, bossEncounters, combatSimulationPerformed: false, runtimeImplementationVerified: false }, economy: { basis: 'Static arithmetic only, no combat win-rate claim. Food assumes all scheduled enemies killed, no leaks/summon rewards and cheapest unlocked camps. Basic construction margins exclude upgrades; full-level-three margins include the cheapest upgrade path at every slot. Neither proves funds arrive in time or that this composition wins. Training counts initial resources and prior first-clear rewards BEFORE entry, a fixed early three-hero core, minimum hero/skill/main-weapon requirements, other slots free white Lv0 and free unlock catch-up levels. Separate 1/2/3-star scenarios include only each new highest-star bonus once; repeat rewards excluded. Books are indivisible with persistent residual XP assumed. Catch-up models sequential first unlock, excluding patch-added heroes on advanced accounts.', sequentialUnlockGrants: resolveHeroUnlockGrants(v, sorted), stages, training, levels: battleBudgets } };
}

function resolveHeroUnlockGrants(v, levels) {
  const meta = v.metaProgression || {}, tiers = array(v.stageGrowthTiers);
  const tierAt = index => tiers.find(tier => index >= tier.globalCampaignLevelRange?.[0] && index <= tier.globalCampaignLevelRange?.[1]);
  const levelById = new Map(levels.map(level => [level.id, level]));
  return array(meta.heroUnlocks).map(unlock => {
    const unlockLevel = levelById.get(unlock.levelId);
    const unlockIndex = unlockLevel?.globalIndex ?? 0;
    // Normal sequential first clears; patch-added/current-account catch-up is outside this audit.
    const grantLevel = unlockIndex === 0 || !meta.newHeroCatchUp?.enabled ? meta.heroLevel?.min || 1 : tierAt(unlockIndex)?.recommendedHeroLevelRange?.[0] || 1;
    return { heroId: unlock.heroId, unlockIndex, freeGrantedHeroLevel: grantLevel };
  }).sort((a, b) => a.unlockIndex - b.unlockIndex);
}

function calculateTrainingBudgets(v, levels) {
  const meta = v.metaProgression || {}, hero = meta.heroLevel || {}, skill = meta.skillLevel || {}, gear = meta.equipment || {};
  const xp = hero.xpNextLevelCoefficients || {}, coins = hero.coinNextLevelCoefficients || {};
  const gearCoins = gear.upgradeCoinCoefficients || {}, gearIron = gear.upgradeIronCoefficients || {};
  const xpPerBook = meta.currencies?.experience_book?.xpPerBook || 1;
  const currencies = keys(meta.currencies), stars = meta.starsReward || {};
  const core = resolveHeroUnlockGrants(v, levels).slice(0, 3);
  const totalBetween = (start, target, coefficients) => sum(Array.from({ length: Math.max(0, target - start) }, (_, i) => (coefficients.base || 0) + (coefficients.perPriorLevel || 0) * (start + i - 1)));
  const gearTotal = (target, coefficients) => sum(Array.from({ length: Math.max(0, target) }, (_, i) => (coefficients.base || 0) + (coefficients.perPriorDestinationLevel || 0) * i));
  return array(v.stageGrowthTiers).map(tier => {
    const firstIndex = tier.globalCampaignLevelRange[0];
    const prior = levels.filter(level => level.globalIndex < firstIndex);
    const heroLevel = tier.recommendedHeroLevelRange?.[0] || 1, skillLevel = tier.recommendedSkillLevelRange?.[0] || 1, gearLevel = tier.recommendedMainWeaponLevelRange?.[0] || 0;
    const ownedCore = core.filter(item => item.unlockIndex < firstIndex);
    const heroCosts = ownedCore.map(item => {
      const requiredXp = totalBetween(item.freeGrantedHeroLevel, heroLevel, xp);
      return { ...item, requiredXp, requiredBooks: Math.ceil(requiredXp / xpPerBook), requiredHeroCopper: totalBetween(item.freeGrantedHeroLevel, heroLevel, coins) };
    });
    const requiredXp = sum(heroCosts.map(item => item.requiredXp));
    const requiredBooks = sum(heroCosts.map(item => item.requiredBooks));
    const requiredHeroCopper = sum(heroCosts.map(item => item.requiredHeroCopper));
    const requiredSkillCopper = ownedCore.length * sum(Object.entries(skill.upgradeCoinCostsByDestinationLevel || {}).filter(([destination]) => Number(destination) <= skillLevel).map(([, cost]) => cost));
    const qualityIndex = array(gear.qualityIds).indexOf(tier.recommendedMainWeaponQuality);
    const qualityUpgrades = array(gear.qualityUpgradeCosts).slice(0, Math.max(0, qualityIndex));
    const requiredWeaponCopper = ownedCore.length * (gearTotal(gearLevel, gearCoins) + sum(qualityUpgrades.map(upgrade => upgrade.copper_coin)));
    const requiredWeaponIron = ownedCore.length * (gearTotal(gearLevel, gearIron) + sum(qualityUpgrades.map(upgrade => upgrade.refined_iron)));
    const requiredCopper = requiredHeroCopper + requiredSkillCopper + requiredWeaponCopper;
    const starScenarios = [1, 2, 3].map(starCount => {
      const extraStars = array(stars.bonusStars).filter(star => star <= starCount).length;
      const initial = Object.fromEntries(currencies.map(id => [id, meta.initialResources?.[id] || 0]));
      const base = Object.fromEntries(currencies.map(id => [id, sum(prior.map(level => level.firstClearReward?.[id] || 0))]));
      const bonus = Object.fromEntries(currencies.map(id => [id, extraStars * sum(prior.map(level => Math.floor((level.firstClearReward?.[id] || 0) * (stars.bonusFractionOfBasePerNewStar || 0))))]));
      const available = Object.fromEntries(currencies.map(id => [id, initial[id] + base[id] + bonus[id]]));
      return { stars: starCount, initialResources: initial, baseFirstClearRewards: base, newHighestStarBonuses: bonus, availableBeforeEntry: available, availableXpBeforeEntry: available.experience_book * xpPerBook, experienceBookGap: Math.max(0, requiredBooks - available.experience_book), xpGap: Math.max(0, requiredXp - available.experience_book * xpPerBook), copperGap: Math.max(0, requiredCopper - available.copper_coin), ironGap: Math.max(0, requiredWeaponIron - available.refined_iron) };
    });
    return { id: tier.id, entryLevelIndex: firstIndex, fixedCoreHeroIds: core.map(item => item.heroId), ownedCoreHeroes: ownedCore.length, heroCosts, recommendedHeroLevel: heroLevel, recommendedSkillLevel: skillLevel, recommendedMainWeaponLevel: gearLevel, recommendedMainWeaponQuality: tier.recommendedMainWeaponQuality, requiredXp, requiredBooks, requiredHeroCopper, requiredSkillCopper, requiredWeaponCopper, requiredWeaponIron, requiredCopper, starScenarios };
  });
}

export async function loadDesignData(projectRoot = root) {
  const [balance, campaign] = await Promise.all(['balance.json', 'levels.json'].map(name => readFile(path.join(projectRoot, 'docs/v1/data', name), 'utf8').then(JSON.parse)));
  return { balance, campaign };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const { balance, campaign } = await loadDesignData();
    const result = validateDesignData(balance, campaign);
    if (process.argv.includes('--json')) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    else {
      const s = result.summary;
      process.stdout.write(`V1 design data ${result.ok ? 'PASS' : 'FAIL'}: ${s.heroes} heroes / ${s.levels} levels / ${s.maps} maps / ${s.waves} waves / ${s.bossEncounters} boss encounters. Static audit; no V1 combat simulation or implementation verification.\n`);
      for (const stage of result.economy.stages) process.stdout.write(`${stage.id}: all-kill food ${stage.allKillFoodRange.join('–')}; cheapest full-field construction margin >= ${stage.minimumBasicBuildMargin}; full-Lv3 all-kill margin ${stage.allKillFullMaxMarginRange.join('–')}.\n`);
      for (const row of result.economy.training) process.stdout.write(`${row.id}: core Lv${row.recommendedHeroLevel}/skill${row.recommendedSkillLevel}/${row.recommendedMainWeaponQuality} weapon${row.recommendedMainWeaponLevel}; required books/copper/iron ${row.requiredBooks}/${row.requiredCopper}/${row.requiredWeaponIron}; prior 1/2/3-star copper ${row.starScenarios.map(item => item.availableBeforeEntry.copper_coin).join('/')}.\n`);
      for (const warning of result.warnings) process.stdout.write(`Budget note: ${warning}\n`);
      for (const error of result.errors) process.stderr.write(`ERROR: ${error}\n`);
    }
    if (!result.ok) process.exitCode = 1;
  } catch (error) { process.stderr.write(`Design validation failed: ${error.message}\n`); process.exitCode = 1; }
}
