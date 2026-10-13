import { BALANCE, CONTENT } from './runtime-data.js';

export const CAMPAIGN_SAVE_KEY = 'wushuang-guard-campaign-v2';
export const CAMPAIGN_BACKUP_KEY = `${CAMPAIGN_SAVE_KEY}-backup`;
export const SAVE_SCHEMA_VERSION = 3;
export const EQUIPMENT_SLOTS = BALANCE.metaProgression.equipment.slots;
const META = BALANCE.metaProgression;
const CURRENCIES = Object.keys(META.initialResources);
const LEVELS = new Map(CONTENT.levels.map(level => [level.id, level]));
const TIERS = new Map(BALANCE.stageGrowthTiers.map(tier => [tier.id, tier]));
const RECEIPT_LIMIT = 1024;
const TRANSACTION_LIMIT = 128;
const MAX_RESOURCE = 1_000_000_000;
const MAX_IMPORT_BYTES = 2_000_000;
const INVENTORY_MAX = META.equipment.inventoryMax;
const TEMPLATES = META.equipment.templates;
const TECHNOLOGY = BALANCE.technology;
const clone = value => JSON.parse(JSON.stringify(value));
const zeroResources = () => Object.fromEntries(CURRENCIES.map(key => [key, 0]));
const error = reason => ({ ok: false, reason });
const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
const object = value => !!value && typeof value === 'object' && !Array.isArray(value);
const integer = (value, min, max) => Number.isInteger(value) && value >= min && value <= max;
const volumeLevel = value => Number.isFinite(value) && value >= 0 && value <= 1;
const addResources = (a, b) => { for (const key of CURRENCIES) a[key] += b[key] || 0; };
const equipmentId = (heroId, slot) => `starter:${heroId}:${slot}`;
const templateFor = item => item && TEMPLATES[item.templateId];
const cappedCredit = (resources, rewards) => {
  const credited = zeroResources();
  for (const key of CURRENCIES) {
    credited[key] = Math.min(MAX_RESOURCE - resources[key], rewards[key] || 0);
    resources[key] += credited[key];
  }
  return credited;
};
const tierReached = (state, tierId) => BALANCE.stageGrowthTiers.findIndex(tier => tier.id === state.progress.highestReachedTierId) >= BALANCE.stageGrowthTiers.findIndex(tier => tier.id === tierId);

function nextEquipmentId(state) {
  let id;
  do { id = `gear:${state.accountId}:${state.nextEquipmentSequence++}`; }
  while (state.inventory.some(item => item.itemInstanceId === id));
  return id;
}

function describeEquipment(item, heroId = null) {
  if (!item) return null;
  const template = templateFor(item);
  const signatureActive = !!template.exclusiveHeroId && template.exclusiveHeroId === heroId;
  return { ...clone(item), name: template.name, exclusiveHeroId: template.exclusiveHeroId || null,
    signatureActive, signatureBonuses: signatureActive ? clone(template.signatureBonuses || {}) : {},
    effectDescription: template.effectDescription || '' };
}

/** Schema 2 used the old white/green/blue/purple ladder and bound starter gear. */
function migrateSnapshot(input) {
  if (!object(input) || input.schemaVersion !== 2) return input;
  const migrated = clone(input);
  migrated.schemaVersion = SAVE_SCHEMA_VERSION;
  migrated.technology = Object.fromEntries(Object.keys(TECHNOLOGY.camps).map(id => [id, 0]));
  migrated.nextEquipmentSequence = 1;
  const qualities = { white: 'white', green: 'blue', blue: 'purple', purple: 'red' };
  if (Array.isArray(migrated.inventory)) for (const item of migrated.inventory) {
    if (object(item)) {
      if (!own(qualities, item.quality)) throw new Error('invalid_legacy_equipment_quality');
      item.quality = qualities[item.quality];
    }
  }
  return migrated;
}

function localDay(now) {
  const date = new Date(now());
  if (!Number.isFinite(date.getTime())) throw new Error('invalid_clock');
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function newAccountId() {
  // Account IDs only distinguish offline receipt namespaces; they are not authentication.
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

function createInitialState(now) {
  return {
    schemaVersion: SAVE_SCHEMA_VERSION, revision: 0, lastContentVersion: CONTENT.contentVersion,
    accountId: newAccountId(), resources: clone(META.initialResources), heroes: {}, inventory: [],
    technology: Object.fromEntries(Object.keys(TECHNOLOGY.camps).map(id => [id, 0])), nextEquipmentSequence: 1,
    party: { lead: META.defaultParty.lead, supports: [], autoSkills: {} },
    levels: {}, progress: { highestReachedGlobalIndex: 1, highestReachedTierId: CONTENT.levels[0].growthTierId, dailyRepeat: { date: localDay(now), count: 0 } },
    unlockedCamps: [...CONTENT.initialCampTypes], guestSelections: {}, guides: {},
    settings: { musicEnabled: true, sfxEnabled: true, reducedMotion: false, tutorialCompleted: false, tutorialVersion: 0, speed: 1, musicVolume: 0.8, sfxVolume: 0.8 },
    legacyRecords: { bestBurst: 0, bestKills: 0, wins: 0 },
    rewardLedger: { firstClears: [], heroCatchUps: [], starterGear: [], processedBattleIds: [], issuedBattleSequence: 0, minimumAcceptedBattleSequence: 1, transactions: [] },
  };
}

function reachedLevels(state) {
  return CONTENT.levels.filter(level => !LEVELS.has(level.prerequisite) || state.levels[level.prerequisite]?.cleared);
}

function refreshProgress(state) {
  const reached = reachedLevels(state);
  const latest = reached.reduce((a, b) => a.globalIndex > b.globalIndex ? a : b, CONTENT.levels[0]);
  state.progress.highestReachedGlobalIndex = latest.globalIndex;
  state.progress.highestReachedTierId = latest.growthTierId;
}

function unlockHero(state, heroId, unlockLevelId = null) {
  if (state.heroes[heroId]) return false;
  const reachedTier = TIERS.get(state.progress.highestReachedTierId);
  const unlockTier = TIERS.get(LEVELS.get(unlockLevelId)?.growthTierId);
  const level = unlockLevelId ? Math.min(META.heroLevel.max, Math.max(unlockTier?.recommendedHeroLevelRange[0] || 1, reachedTier?.recommendedHeroLevelRange[0] || 1)) : 1;
  const hero = { level, xp: 0, skillLevel: 1, equipmentIds: {} };
  for (const starter of META.heroStarterGear.items) {
    if (state.inventory.length >= INVENTORY_MAX) { hero.equipmentIds[starter.slot] = null; continue; }
    const itemInstanceId = equipmentId(heroId, starter.slot);
    hero.equipmentIds[starter.slot] = itemInstanceId;
    state.inventory.push({ itemInstanceId, templateId: `basic_${starter.slot}`, slot: starter.slot, quality: starter.quality, level: starter.level, equippedHeroId: heroId });
  }
  state.heroes[heroId] = hero;
  state.rewardLedger.starterGear.push(heroId);
  state.rewardLedger.heroCatchUps.push(heroId);
  return true;
}

function reconcileUnlocks(state) {
  refreshProgress(state);
  const unlockedHeroes = [];
  for (const unlock of META.heroUnlocks) {
    if ((!unlock.levelId || state.levels[unlock.levelId]?.cleared) && unlockHero(state, unlock.heroId, unlock.levelId)) unlockedHeroes.push(unlock.heroId);
  }
  const camps = new Set(CONTENT.initialCampTypes);
  for (const level of CONTENT.levels) if (state.levels[level.id]?.cleared && level.unlockCampType) camps.add(level.unlockCampType);
  const unlockedCamps = [...camps].filter(id => !state.unlockedCamps.includes(id));
  state.unlockedCamps = [...camps];
  return { unlockedHeroes, unlockedCamps };
}

function stringList(value, max, predicate = () => true) {
  if (!Array.isArray(value) || value.length > max || value.some(item => typeof item !== 'string' || item.length > 180)) throw new Error('invalid_ledger');
  return [...new Set(value.filter(predicate))];
}

/** Validate a complete snapshot. Loading may filter retired IDs; imports are stricter. */
function validateSnapshot(input, now, { filterUnknown = false } = {}) {
  input = migrateSnapshot(input);
  if (!object(input)) throw new Error('invalid_structure');
  if (input.schemaVersion !== SAVE_SCHEMA_VERSION) throw new Error(input.schemaVersion > SAVE_SCHEMA_VERSION ? 'future_schema' : 'unsupported_schema');
  const state = createInitialState(now);
  if (!integer(input.revision, 0, Number.MAX_SAFE_INTEGER)) throw new Error('invalid_revision');
  if (typeof input.accountId !== 'string' || !/^[a-zA-Z0-9-]{5,80}$/.test(input.accountId)) throw new Error('invalid_account_id');
  state.revision = input.revision;
  state.accountId = input.accountId;
  if (typeof input.lastContentVersion !== 'string' || !input.lastContentVersion.length || input.lastContentVersion.length > 180) throw new Error('invalid_content_version');
  state.lastContentVersion = input.lastContentVersion;
  if (!object(input.resources)) throw new Error('invalid_resources');
  for (const key of CURRENCIES) {
    if (!integer(input.resources[key], 0, MAX_RESOURCE)) throw new Error('invalid_resources');
    state.resources[key] = input.resources[key];
  }
  if (!integer(input.nextEquipmentSequence, 1, Number.MAX_SAFE_INTEGER - INVENTORY_MAX)) throw new Error('invalid_equipment_sequence');
  state.nextEquipmentSequence = input.nextEquipmentSequence;
  if (!object(input.levels) || Object.keys(input.levels).length > CONTENT.levels.length + 1000) throw new Error('invalid_levels');
  for (const [id, entry] of Object.entries(input.levels)) {
    if (!LEVELS.has(id)) { if (filterUnknown) continue; throw new Error('unknown_level'); }
    if (!object(entry) || typeof entry.cleared !== 'boolean' || !integer(entry.highestRewardedStars, 0, 3) || entry.cleared !== (entry.highestRewardedStars > 0)) throw new Error('invalid_level_progress');
    if (!Number.isFinite(entry.bestHpFraction) || entry.bestHpFraction < 0 || entry.bestHpFraction > 1 || !integer(entry.bestKills, 0, 1_000_000) || !integer(entry.bestBurst, 0, 1_000_000) || !Number.isFinite(entry.bestTime) || entry.bestTime < 0 || entry.bestTime > 86_400 || !integer(entry.clears, 0, 1_000_000)) throw new Error('invalid_level_record');
    state.levels[id] = clone(entry);
  }
  for (const level of CONTENT.levels) if (state.levels[level.id]?.cleared && LEVELS.has(level.prerequisite) && !state.levels[level.prerequisite]?.cleared) throw new Error('broken_progression_chain');
  const ledger = input.rewardLedger;
  if (!object(ledger)) throw new Error('invalid_ledger');
  for (const key of ['firstClears', 'heroCatchUps', 'starterGear']) state.rewardLedger[key] = stringList(ledger[key], 1000, id => key === 'firstClears' ? LEVELS.has(id) : !!BALANCE.heroes[id]);
  const expectedFirstClears = CONTENT.levels.filter(level => state.levels[level.id]?.cleared).map(level => level.id);
  if (expectedFirstClears.some(id => !state.rewardLedger.firstClears.includes(id)) || state.rewardLedger.firstClears.some(id => !state.levels[id]?.cleared)) throw new Error('invalid_first_clear_ledger');
  if (!integer(ledger.issuedBattleSequence, 0, Number.MAX_SAFE_INTEGER) || !integer(ledger.minimumAcceptedBattleSequence, 1, ledger.issuedBattleSequence + 1)) throw new Error('invalid_battle_sequence');
  state.rewardLedger.issuedBattleSequence = ledger.issuedBattleSequence;
  state.rewardLedger.minimumAcceptedBattleSequence = ledger.minimumAcceptedBattleSequence;
  state.rewardLedger.processedBattleIds = stringList(ledger.processedBattleIds, RECEIPT_LIMIT);
  if (!Array.isArray(ledger.transactions) || ledger.transactions.length > TRANSACTION_LIMIT || ledger.transactions.some(tx => !object(tx) || typeof tx.battleId !== 'string' || tx.battleId.length > 180 || !LEVELS.has(tx.levelId) || typeof tx.won !== 'boolean' || typeof tx.firstClear !== 'boolean' || typeof tx.dailyRewarded !== 'boolean' || !integer(tx.stars, 0, 3) || !Number.isFinite(tx.time) || tx.time < 0 || tx.time > 86_400 || !integer(tx.casts, 0, 1_000_000) || !object(tx.rewards) || CURRENCIES.some(key => !integer(tx.rewards[key], 0, MAX_RESOURCE)))) throw new Error('invalid_transactions');
  state.rewardLedger.transactions = clone(ledger.transactions);
  for (const transaction of state.rewardLedger.transactions) {
    if (transaction.loot == null) continue; // Migrated victories retain their original receipt; no retroactive roll.
    const loot = transaction.loot;
    const item = loot.item;
    const template = templateFor(item);
    if (!transaction.won || !object(loot) || !object(item) || !template || template.slot !== 'weapon' || item.slot !== 'weapon' || typeof item.itemInstanceId !== 'string' || !item.itemInstanceId.length || item.itemInstanceId.length > 180 || item.equippedHeroId !== null || item.level !== 0 || !META.equipment.qualityIds.includes(item.quality) || (template.quality && item.quality !== template.quality) || (!template.quality && item.quality === 'gold') || loot.quality !== item.quality || loot.templateId !== item.templateId || typeof loot.name !== 'string' || typeof loot.salvaged !== 'boolean') throw new Error('invalid_loot_receipt');
    if (loot.salvaged && (!object(loot.salvageResources) || CURRENCIES.some(key => !integer(loot.salvageResources[key], 0, MAX_RESOURCE)))) throw new Error('invalid_loot_receipt');
  }
  if (!object(input.progress) || !object(input.progress.dailyRepeat) || !/^\d{4}-\d{2}-\d{2}$/.test(input.progress.dailyRepeat.date) || !integer(input.progress.dailyRepeat.count, 0, META.dailyRepeatPolicy.limit)) throw new Error('invalid_daily_progress');
  state.progress.dailyRepeat = clone(input.progress.dailyRepeat);
  refreshProgress(state);
  if (!object(input.heroes) || Object.keys(input.heroes).length > 1000 || !Array.isArray(input.inventory) || input.inventory.length > INVENTORY_MAX) throw new Error('invalid_heroes');
  const eligibleHeroes = new Set(META.heroUnlocks.filter(unlock => !unlock.levelId || state.levels[unlock.levelId]?.cleared).map(unlock => unlock.heroId));
  for (const [id, hero] of Object.entries(input.heroes)) {
    if (!BALANCE.heroes[id]) { if (filterUnknown) continue; throw new Error('unknown_hero'); }
    if (!eligibleHeroes.has(id)) throw new Error('hero_not_unlocked');
    if (!object(hero) || !integer(hero.level, 1, META.heroLevel.max) || !integer(hero.xp, 0, META.currencies.experience_book.xpPerBook - 1) || !integer(hero.skillLevel, 1, META.skillLevel.max) || hero.level < META.skillLevel.requiredHeroLevelBySkillLevel[hero.skillLevel - 1] || !object(hero.equipmentIds) || EQUIPMENT_SLOTS.some(slot => hero.equipmentIds[slot] !== null && typeof hero.equipmentIds[slot] !== 'string')) throw new Error('invalid_hero');
    state.heroes[id] = clone(hero);
  }
  const itemIds = new Set();
  const heroSlots = new Set();
  for (const item of input.inventory) {
    if (!object(item)) throw new Error('invalid_equipment');
    const template = templateFor(item);
    if (!template || template.slot !== item.slot || (template.quality && template.quality !== item.quality) || (!template.quality && item.quality === 'gold')) throw new Error('invalid_equipment_template');
    if (item.equippedHeroId !== null && !state.heroes[item.equippedHeroId]) { if (filterUnknown && !BALANCE.heroes[item.equippedHeroId]) continue; throw new Error('invalid_equipment_owner'); }
    const heroSlot = item.equippedHeroId === null ? null : `${item.equippedHeroId}:${item.slot}`;
    if (typeof item.itemInstanceId !== 'string' || !item.itemInstanceId.length || item.itemInstanceId.length > 180 || itemIds.has(item.itemInstanceId) || (heroSlot && heroSlots.has(heroSlot)) || !EQUIPMENT_SLOTS.includes(item.slot) || !META.equipment.qualityIds.includes(item.quality) || !integer(item.level, 0, META.equipment.levelMax) || (heroSlot && state.heroes[item.equippedHeroId].equipmentIds[item.slot] !== item.itemInstanceId)) throw new Error('invalid_equipment_ownership');
    itemIds.add(item.itemInstanceId);
    if (heroSlot) heroSlots.add(heroSlot);
    state.inventory.push(clone(item));
  }
  for (const [id, hero] of Object.entries(state.heroes)) if (EQUIPMENT_SLOTS.some(slot => hero.equipmentIds[slot] !== null && (!itemIds.has(hero.equipmentIds[slot]) || !heroSlots.has(`${id}:${slot}`)))) throw new Error('missing_equipment');
  if (!object(input.technology) || Object.keys(input.technology).some(id => !TECHNOLOGY.camps[id])) throw new Error('invalid_technology');
  const eligibleCamps = new Set(CONTENT.initialCampTypes);
  for (const level of CONTENT.levels) if (state.levels[level.id]?.cleared && level.unlockCampType) eligibleCamps.add(level.unlockCampType);
  for (const [id, definition] of Object.entries(TECHNOLOGY.camps)) {
    const rank = input.technology[id];
    if (!integer(rank, 0, definition.levelMax) || (rank > 0 && (!eligibleCamps.has(id) || state.progress.highestReachedGlobalIndex < TECHNOLOGY.requiredGlobalIndexByDestinationLevel[rank - 1]))) throw new Error('invalid_technology');
    state.technology[id] = rank;
  }
  if (!object(input.party) || typeof input.party.lead !== 'string' || !Array.isArray(input.party.supports) || !object(input.party.autoSkills)) throw new Error('invalid_party');
  const partyIds = [input.party.lead, ...input.party.supports].filter(id => !!state.heroes[id]);
  if ((!filterUnknown && partyIds.length !== input.party.supports.length + 1) || new Set(partyIds).size !== partyIds.length || partyIds.length > Math.max(...reachedLevels(state).map(level => level.maxPartySize))) throw new Error('invalid_party');
  state.party = { lead: partyIds[0] || META.defaultParty.lead, supports: partyIds.slice(1), autoSkills: {} };
  for (const [id, value] of Object.entries(input.party.autoSkills)) if (state.heroes[id]) { if (typeof value !== 'boolean') throw new Error('invalid_auto_skill'); state.party.autoSkills[id] = value; }
  if (!object(input.settings)) throw new Error('invalid_settings');
  for (const key of ['musicEnabled', 'sfxEnabled', 'reducedMotion', 'tutorialCompleted']) { if (typeof input.settings[key] !== 'boolean') throw new Error('invalid_settings'); state.settings[key] = input.settings[key]; }
  if (![1, 1.5, 2].includes(input.settings.speed) || !integer(input.settings.tutorialVersion, 0, 100)) throw new Error('invalid_settings');
  state.settings.speed = input.settings.speed;
  state.settings.tutorialVersion = input.settings.tutorialVersion;
  // Volume levels were added without a schema change: absent keeps the default, present must be a 0–1 number.
  for (const key of ['musicVolume', 'sfxVolume']) if (input.settings[key] !== undefined) { if (!volumeLevel(input.settings[key])) throw new Error('invalid_settings'); state.settings[key] = input.settings[key]; }
  if (!object(input.guestSelections) || !object(input.guides)) throw new Error('invalid_guides');
  for (const [id, enabled] of Object.entries(input.guestSelections)) if (LEVELS.get(id)?.storyGuest) { if (typeof enabled !== 'boolean') throw new Error('invalid_guest'); state.guestSelections[id] = enabled; }
  if (Object.keys(input.guides).length > 1000 || JSON.stringify(input.guides).length > 100_000) throw new Error('invalid_guides');
  state.guides = clone(input.guides);
  if (object(input.legacyRecords)) for (const key of Object.keys(state.legacyRecords)) { if (!integer(input.legacyRecords[key], 0, MAX_RESOURCE)) throw new Error('invalid_records'); state.legacyRecords[key] = input.legacyRecords[key]; }
  state.unlockedCamps = [...CONTENT.initialCampTypes];
  reconcileUnlocks(state);
  return state;
}

export class CampaignStore {
  constructor({ storage, now = () => new Date(), rng = Math.random } = {}) {
    this.now = now;
    this.rng = rng;
    this.persistenceWarning = '';
    this.readOnly = false;
    this.preserveUnreadableSave = false;
    this.originalSaveRaw = null;
    try { this.storage = storage === undefined ? globalThis.localStorage : storage; } catch { this.storage = null; }
    this.state = createInitialState(now);
    let raw = null;
    try { raw = this.storage?.getItem(CAMPAIGN_SAVE_KEY); this.originalSaveRaw = typeof raw === 'string' ? raw : null; } catch { this.persistenceWarning = '存档读取失败，本次进度仅保留在当前页面。'; this.preserveUnreadableSave = true; }
    if (raw) {
      try { this.state = validateSnapshot(JSON.parse(raw), now, { filterUnknown: true }); }
      catch (failure) {
        if (failure.message === 'future_schema') { this.readOnly = true; this.persistenceWarning = '存档来自较新版本，请更新游戏；原存档保持不变。'; }
        else {
          try { this.state = validateSnapshot(JSON.parse(this.storage?.getItem(CAMPAIGN_BACKUP_KEY) || 'null'), now, { filterUnknown: true }); this.persistenceWarning = '主存档损坏，已读取上一份有效备份。'; }
          catch { this.persistenceWarning = '存档无法读取，已开启临时新进度；原存档保持不变，请先导出或恢复备份。'; this.preserveUnreadableSave = true; }
        }
      }
    } else if (!this.preserveUnreadableSave) this._migrateLegacy();
    reconcileUnlocks(this.state);
  }

  _migrateLegacy() {
    try {
      const raw = this.storage?.getItem('wushuang-guard-v1');
      const legacy = JSON.parse(raw || 'null');
      if (object(legacy)) {
        if (raw) this.storage?.setItem(`${CAMPAIGN_SAVE_KEY}-prototype-backup`, raw);
        if (typeof legacy.sound === 'boolean') this.state.settings.musicEnabled = this.state.settings.sfxEnabled = legacy.sound;
        for (const key of ['musicEnabled', 'sfxEnabled', 'tutorialCompleted']) if (typeof legacy[key] === 'boolean') this.state.settings[key] = legacy[key];
        if (legacy.tutorialVersion === 1) this.state.settings.tutorialVersion = 1;
        for (const key of Object.keys(this.state.legacyRecords)) if (integer(legacy[key], 0, MAX_RESOURCE)) this.state.legacyRecords[key] = legacy[key];
      }
      const speed = Number(this.storage?.getItem('wushuang-guard-combat-speed'));
      if ([1, 1.5, 2].includes(speed)) this.state.settings.speed = speed;
    } catch { this.persistenceWarning = '旧纪录无法迁移，本次使用默认设置。'; }
  }

  getLevel(id) { return LEVELS.get(id) || null; }
  isLevelUnlocked(id) { const level = this.getLevel(id); return !!level && (!LEVELS.has(level.prerequisite) || !!this.state.levels[level.prerequisite]?.cleared); }
  getMaxPartySize() { return Math.min(BALANCE.party.maxHeroes, Math.max(...reachedLevels(this.state).map(level => level.maxPartySize))); }

  getHero(heroId) {
    const hero = this.state.heroes[heroId];
    if (!hero) return null;
    const equipment = Object.fromEntries(EQUIPMENT_SLOTS.map(slot => [slot, describeEquipment(this.state.inventory.find(item => item.itemInstanceId === hero.equipmentIds[slot]), heroId)]));
    return { heroId, ...clone(hero), equipment };
  }

  getInventory({ slot } = {}) {
    return this.state.inventory.filter(item => !slot || item.slot === slot).map(item => describeEquipment(item, item.equippedHeroId));
  }

  getTechnologyCost(campId) {
    const definition = TECHNOLOGY.camps[campId];
    if (!definition) return error('invalid_camp');
    if (!this.state.unlockedCamps.includes(campId)) return error('camp_locked');
    const targetLevel = this.state.technology[campId] + 1;
    if (targetLevel > definition.levelMax) return error('max_technology_level');
    const requiredGlobalIndex = TECHNOLOGY.requiredGlobalIndexByDestinationLevel[targetLevel - 1];
    return { ok: this.state.progress.highestReachedGlobalIndex >= requiredGlobalIndex,
      reason: this.state.progress.highestReachedGlobalIndex < requiredGlobalIndex ? 'level_required' : null,
      targetLevel, requiredGlobalIndex, perLevelBonuses: clone(definition.perLevelBonuses),
      cost: { experience_book: 0, copper_coin: TECHNOLOGY.coinCostCoefficients.base + TECHNOLOGY.coinCostCoefficients.perPriorDestinationLevel * (targetLevel - 1), refined_iron: TECHNOLOGY.ironCostCoefficients.base + TECHNOLOGY.ironCostCoefficients.perTwoPriorDestinationLevels * Math.floor((targetLevel - 1) / 2) } };
  }

  researchTechnology(campId) {
    const quote = this.getTechnologyCost(campId);
    return this._buy(quote, next => { next.technology[campId] = quote.targetLevel; });
  }

  /** Every battle receives its own levels snapshot; research cannot alter a running battle. */
  getBattleTechnology() { return clone(this.state.technology); }

  getForgeCost(templateId, quality) {
    const template = TEMPLATES[templateId];
    if (!template) return error('invalid_equipment_template');
    if (quality === 'gold' || template.quality === 'gold') return error('gold_chest_only');
    if (!META.equipment.qualityIds.includes(quality) || !template.forgeQualities.includes(quality)) return error('invalid_forge_quality');
    if (this.state.inventory.length >= INVENTORY_MAX) return error('inventory_full');
    const rule = template.exclusiveHeroId ? META.equipment.forging.signatureHorseCost : META.equipment.forging.ordinaryCosts[quality];
    if (!rule) return error('invalid_forge_quality');
    const unlocked = tierReached(this.state, rule.unlockTier);
    return { ok: unlocked, reason: unlocked ? null : 'tier_required', templateId, quality, requiredTier: rule.unlockTier,
      cost: { experience_book: 0, copper_coin: rule.copper_coin, refined_iron: rule.refined_iron } };
  }

  forgeEquipment(templateId, quality) {
    const quote = this.getForgeCost(templateId, quality);
    let itemId = null;
    const result = this._buy(quote, next => {
      itemId = nextEquipmentId(next);
      next.inventory.push({ itemInstanceId: itemId, templateId, slot: TEMPLATES[templateId].slot,
        quality, level: META.equipment.forging.levelAtForge, equippedHeroId: null });
    });
    return result.ok ? { ...result, item: describeEquipment(this.state.inventory.find(item => item.itemInstanceId === itemId)) } : result;
  }

  equipEquipment(heroId, itemInstanceId) {
    if (this.readOnly) return error('save_read_only');
    const hero = this.state.heroes[heroId];
    const item = this.state.inventory.find(gear => gear.itemInstanceId === itemInstanceId);
    if (!hero) return error('hero_not_owned');
    if (!item) return error('invalid_equipment');
    if (hero.equipmentIds[item.slot] === itemInstanceId) return { ok: true, reason: null, unchanged: true };
    const next = clone(this.state);
    const moved = next.inventory.find(gear => gear.itemInstanceId === itemInstanceId);
    if (moved.equippedHeroId) next.heroes[moved.equippedHeroId].equipmentIds[moved.slot] = null;
    const old = next.inventory.find(gear => gear.itemInstanceId === next.heroes[heroId].equipmentIds[moved.slot]);
    if (old) old.equippedHeroId = null;
    next.heroes[heroId].equipmentIds[moved.slot] = itemInstanceId;
    moved.equippedHeroId = heroId;
    return this._commit(next, { item: describeEquipment(moved, heroId), unequippedItemId: old?.itemInstanceId || null });
  }

  salvageEquipment(itemId) {
    const item = this.state.inventory.find(gear => gear.itemInstanceId === itemId);
    if (!item) return error('invalid_equipment');
    if (item.equippedHeroId) return error('equipment_is_equipped');
    const next = clone(this.state);
    next.inventory = next.inventory.filter(gear => gear.itemInstanceId !== itemId);
    const rewards = cappedCredit(next.resources, META.equipment.salvage.byQuality[item.quality]);
    return this._commit(next, { rewards, itemInstanceId: itemId });
  }

  getPartyForLevel(id, { includeGuest } = {}) {
    const level = this.getLevel(id);
    if (!level || !this.isLevelUnlocked(id)) return [];
    const ids = [this.state.party.lead, ...this.state.party.supports].slice(0, level.maxPartySize);
    const party = ids.map(heroId => ({ ...this.getHero(heroId), auto: !!this.state.party.autoSkills[heroId], guest: false }));
    const guest = level.storyGuest;
    if ((includeGuest ?? this.state.guestSelections[id]) && guest && !ids.includes(guest.heroId)) {
      const owned = this.getHero(guest.heroId);
      const descriptor = owned ? { ...owned, auto: !!this.state.party.autoSkills[guest.heroId], guest: false } : { heroId: guest.heroId, level: guest.level, skillLevel: guest.skillLevel, equipment: clone(guest.equipment), auto: false, guest: true };
      if (party.length >= level.maxPartySize) party.pop();
      party.push(descriptor);
    }
    return party;
  }

  _commit(next, result = {}) {
    if (this.readOnly) return error('save_read_only');
    next.revision = this.state.revision + 1;
    next.lastContentVersion = CONTENT.contentVersion;
    try { next = validateSnapshot(next, this.now); } catch (failure) { return error(failure.message); }
    this.state = next;
    const saved = this.save();
    return { ok: true, reason: null, ...result, persisted: saved.ok, persistenceWarning: this.persistenceWarning };
  }

  save() {
    if (this.readOnly) return error('save_read_only');
    if (this.preserveUnreadableSave) return error('unreadable_save_preserved');
    if (!this.storage) { this.persistenceWarning = '浏览器未提供存档空间，本次进度仅保留在当前页面。'; return error('storage_unavailable'); }
    const snapshot = JSON.stringify(this.state);
    let previous = null;
    let previousRead = false;
    try {
      validateSnapshot(this.state, this.now);
      previous = this.storage.getItem(CAMPAIGN_SAVE_KEY);
      previousRead = true;
      if (previous) {
        let previousValid = false;
        try { validateSnapshot(JSON.parse(previous), this.now, { filterUnknown: true }); previousValid = true; } catch { /* Never overwrite a valid backup with corrupt data. */ }
        if (previousValid) this.storage.setItem(CAMPAIGN_BACKUP_KEY, previous);
      }
      this.storage.setItem(CAMPAIGN_SAVE_KEY, snapshot);
      if (this.storage.getItem(CAMPAIGN_SAVE_KEY) !== snapshot) throw new Error('storage_verification_failed');
      this.persistenceWarning = '';
      return { ok: true, reason: null };
    } catch {
      if (previousRead) try { if (previous === null) this.storage.removeItem?.(CAMPAIGN_SAVE_KEY); else this.storage.setItem(CAMPAIGN_SAVE_KEY, previous); } catch { /* The previous valid backup remains available. */ }
      this.persistenceWarning = '存档写入失败，本次变化仅保留在当前页面；请导出备份后再关闭。';
      return error('storage_write_failed');
    }
  }

  setParty(heroIds, autoFlags = {}) {
    if (!Array.isArray(heroIds) || !heroIds.length || heroIds.length > this.getMaxPartySize() || new Set(heroIds).size !== heroIds.length || heroIds.some(id => !this.state.heroes[id])) return error('invalid_party');
    if (!object(autoFlags) || Object.values(autoFlags).some(value => typeof value !== 'boolean')) return error('invalid_auto_skill');
    const next = clone(this.state);
    next.party = { lead: heroIds[0], supports: heroIds.slice(1), autoSkills: { ...next.party.autoSkills } };
    for (const id of heroIds) if (own(autoFlags, id)) next.party.autoSkills[id] = autoFlags[id];
    return this._commit(next);
  }

  setGuest(levelId, enabled) {
    if (!this.isLevelUnlocked(levelId) || !this.getLevel(levelId)?.storyGuest || typeof enabled !== 'boolean') return error('invalid_guest');
    const next = clone(this.state);
    next.guestSelections[levelId] = enabled;
    return this._commit(next);
  }

  getTrainingCost(heroId) {
    const hero = this.state.heroes[heroId];
    if (!hero) return error('hero_not_owned');
    if (hero.level >= META.heroLevel.max) return error('max_level');
    const xpCoefficients = META.heroLevel.xpNextLevelCoefficients;
    const coinCoefficients = META.heroLevel.coinNextLevelCoefficients;
    const xpNeeded = xpCoefficients.base + xpCoefficients.perPriorLevel * (hero.level - 1);
    const books = Math.ceil(Math.max(0, xpNeeded - hero.xp) / META.currencies.experience_book.xpPerBook);
    return { ok: true, reason: null, targetLevel: hero.level + 1, xpNeeded, cost: { experience_book: books, copper_coin: coinCoefficients.base + coinCoefficients.perPriorLevel * (hero.level - 1), refined_iron: 0 } };
  }

  getSkillCost(heroId) {
    const hero = this.state.heroes[heroId];
    if (!hero) return error('hero_not_owned');
    if (hero.skillLevel >= META.skillLevel.max) return error('max_skill_level');
    const targetLevel = hero.skillLevel + 1;
    const requiredHeroLevel = META.skillLevel.requiredHeroLevelBySkillLevel[targetLevel - 1];
    return { ok: hero.level >= requiredHeroLevel, reason: hero.level < requiredHeroLevel ? 'hero_level_required' : null, targetLevel, requiredHeroLevel, cost: { experience_book: 0, copper_coin: META.skillLevel.upgradeCoinCostsByDestinationLevel[targetLevel], refined_iron: 0 } };
  }

  getEquipmentUpgradeCost(heroId, slot) {
    const gear = this.getHero(heroId)?.equipment[slot];
    if (!gear) return error('invalid_equipment');
    if (gear.level >= META.equipment.levelMax) return error('max_equipment_level');
    const targetLevel = gear.level + 1;
    const coins = META.equipment.upgradeCoinCoefficients;
    const iron = META.equipment.upgradeIronCoefficients;
    return { ok: true, reason: null, targetLevel, cost: { experience_book: 0, copper_coin: coins.base + coins.perPriorDestinationLevel * (targetLevel - 1), refined_iron: iron.base + iron.perPriorDestinationLevel * (targetLevel - 1) } };
  }

  getEquipmentPromotionCost(heroId, slot) {
    const gear = this.getHero(heroId)?.equipment[slot];
    if (!gear) return error('invalid_equipment');
    if (gear.quality === 'gold') return error('gold_quality_fixed');
    const promotion = META.equipment.qualityUpgradeCosts.find(cost => cost.from === gear.quality);
    if (!promotion) return error('max_equipment_quality');
    const requiredIndex = BALANCE.stageGrowthTiers.findIndex(tier => tier.id === promotion.unlockTier);
    const reachedIndex = BALANCE.stageGrowthTiers.findIndex(tier => tier.id === this.state.progress.highestReachedTierId);
    return { ok: reachedIndex >= requiredIndex, reason: reachedIndex < requiredIndex ? 'tier_required' : null, requiredTier: promotion.unlockTier, targetQuality: promotion.to, cost: { experience_book: 0, copper_coin: promotion.copper_coin, refined_iron: promotion.refined_iron } };
  }

  _buy(quote, mutate) {
    if (!quote.ok) return quote;
    const missing = Object.fromEntries(CURRENCIES.map(key => [key, Math.max(0, quote.cost[key] - this.state.resources[key])]));
    if (Object.values(missing).some(value => value > 0)) return { ...error('insufficient_resources'), cost: quote.cost, missing };
    const next = clone(this.state);
    for (const key of CURRENCIES) next.resources[key] -= quote.cost[key];
    mutate(next);
    return this._commit(next, { cost: quote.cost });
  }

  trainHero(heroId) {
    const quote = this.getTrainingCost(heroId);
    return this._buy(quote, next => {
      const hero = next.heroes[heroId];
      hero.xp = hero.xp + quote.cost.experience_book * META.currencies.experience_book.xpPerBook - quote.xpNeeded;
      hero.level = quote.targetLevel;
    });
  }

  trainSkill(heroId) { const quote = this.getSkillCost(heroId); return this._buy(quote, next => { next.heroes[heroId].skillLevel = quote.targetLevel; }); }
  upgradeEquipment(heroId, slot) { const quote = this.getEquipmentUpgradeCost(heroId, slot); return this._buy(quote, next => { next.inventory.find(item => item.itemInstanceId === next.heroes[heroId].equipmentIds[slot]).level = quote.targetLevel; }); }
  promoteEquipment(heroId, slot) { const quote = this.getEquipmentPromotionCost(heroId, slot); return this._buy(quote, next => { next.inventory.find(item => item.itemInstanceId === next.heroes[heroId].equipmentIds[slot]).quality = quote.targetQuality; }); }

  setSetting(key, value) {
    const valid = ['musicEnabled', 'sfxEnabled', 'reducedMotion', 'tutorialCompleted'].includes(key) ? typeof value === 'boolean' : key === 'speed' ? [1, 1.5, 2].includes(value) : ['musicVolume', 'sfxVolume'].includes(key) ? volumeLevel(value) : key === 'tutorialVersion' && integer(value, 0, 100);
    if (!valid) return error('invalid_setting');
    const next = clone(this.state);
    next.settings[key] = value;
    return this._commit(next);
  }

  /** The oldest issued IDs expire safely: expired receipts cannot be paid again. */
  createBattleId() {
    if (this.readOnly || this.state.rewardLedger.issuedBattleSequence >= Number.MAX_SAFE_INTEGER - 1) return null;
    const next = clone(this.state);
    const sequence = ++next.rewardLedger.issuedBattleSequence;
    const prefix = `battle:${next.accountId}:`;
    const externalCount = next.rewardLedger.processedBattleIds.filter(id => !id.startsWith(prefix)).length;
    if (externalCount >= RECEIPT_LIMIT) return null;
    next.rewardLedger.minimumAcceptedBattleSequence = Math.max(1, sequence - (RECEIPT_LIMIT - externalCount) + 1);
    next.rewardLedger.processedBattleIds = next.rewardLedger.processedBattleIds.filter(id => !id.startsWith(prefix) || Number(id.slice(prefix.length)) >= next.rewardLedger.minimumAcceptedBattleSequence);
    const result = this._commit(next);
    return result.ok ? `${prefix}${sequence}` : null;
  }

  _rollVictoryLoot(next) {
    const sample = () => {
      const value = this.rng();
      if (!Number.isFinite(value) || value < 0 || value >= 1) throw new Error('invalid_loot_rng');
      return value;
    };
    const point = Math.floor(sample() * BALANCE.loot.weightScale);
    let cumulative = 0;
    let quality = null;
    for (const [id, weight] of Object.entries(BALANCE.loot.qualityWeights)) {
      cumulative += weight;
      if (point < cumulative) { quality = id; break; }
    }
    if (!quality) throw new Error('invalid_loot_table');
    const templateId = quality === 'gold' ? BALANCE.loot.goldTemplateIds[Math.floor(sample() * BALANCE.loot.goldTemplateIds.length)] : BALANCE.loot.ordinaryTemplateId;
    const item = { itemInstanceId: nextEquipmentId(next), templateId, slot: 'weapon', quality, level: 0, equippedHeroId: null };
    const salvaged = next.inventory.length >= INVENTORY_MAX;
    const loot = { item: clone(item), quality, templateId, name: TEMPLATES[templateId].name, salvaged };
    if (salvaged) loot.salvageResources = cappedCredit(next.resources, META.equipment.salvage.byQuality[quality]);
    else next.inventory.push(item);
    return loot;
  }

  settleBattle({ battleId, levelId, won, hp, maxHp, kills = 0, bestBurst = 0, time = 0, casts = 0 } = {}) {
    if (this.readOnly) return error('save_read_only');
    const level = this.getLevel(levelId);
    if (!level || !this.isLevelUnlocked(levelId)) return error('level_locked');
    if (typeof battleId !== 'string' || !battleId.length || battleId.length > 180 || typeof won !== 'boolean' || !Number.isFinite(hp) || !Number.isFinite(maxHp) || maxHp <= 0 || hp < 0 || hp > maxHp || maxHp > 10_000 || (won && hp <= 0) || !integer(kills, 0, 1_000_000) || !integer(bestBurst, 0, kills) || !Number.isFinite(time) || time < 0 || time > 86_400 || !integer(casts, 0, 1_000_000)) return error('invalid_battle_result');
    const ledger = this.state.rewardLedger;
    if (ledger.processedBattleIds.includes(battleId)) return error('already_settled');
    const prefix = `battle:${this.state.accountId}:`;
    const generated = battleId.startsWith(prefix);
    if (battleId.startsWith('battle:') && !generated) return error('foreign_battle_id');
    if (generated) {
      const sequence = Number(battleId.slice(prefix.length));
      if (!integer(sequence, ledger.minimumAcceptedBattleSequence, ledger.issuedBattleSequence)) return error('expired_or_unissued_battle');
    } else if (ledger.processedBattleIds.length >= RECEIPT_LIMIT) return error('receipt_capacity_use_generated_id');
    const next = clone(this.state);
    next.rewardLedger.processedBattleIds.push(battleId);
    const rewards = zeroResources();
    let stars = 0;
    let firstClear = false;
    let dailyRewarded = false;
    let loot = null;
    let unlocked = { unlockedHeroes: [], unlockedCamps: [] };
    if (won) {
      const fraction = hp / maxHp;
      stars = fraction >= 0.85 ? 3 : fraction >= 0.6 ? 2 : 1;
      const prior = next.levels[levelId] || { cleared: false, highestRewardedStars: 0, bestHpFraction: 0, bestKills: 0, bestBurst: 0, bestTime: 0, clears: 0 };
      firstClear = !prior.cleared;
      if (firstClear) {
        addResources(rewards, level.firstClearReward);
        next.rewardLedger.firstClears.push(levelId);
      }
      for (let star = 2; star <= stars; star++) if (star > prior.highestRewardedStars) for (const key of CURRENCIES) rewards[key] += Math.floor(level.firstClearReward[key] * META.starsReward.bonusFractionOfBasePerNewStar);
      const day = localDay(this.now);
      if (next.progress.dailyRepeat.date !== day) next.progress.dailyRepeat = { date: day, count: 0 };
      if (!firstClear && next.progress.dailyRepeat.count < META.dailyRepeatPolicy.limit) {
        addResources(rewards, level.repeatReward);
        next.progress.dailyRepeat.count++;
        dailyRewarded = true;
      }
      next.levels[levelId] = { cleared: true, highestRewardedStars: Math.max(prior.highestRewardedStars, stars), bestHpFraction: Math.max(prior.bestHpFraction, fraction), bestKills: Math.max(prior.bestKills, kills), bestBurst: Math.max(prior.bestBurst, bestBurst), bestTime: prior.bestTime > 0 ? Math.min(prior.bestTime, time) : time, clears: prior.clears + 1 };
      const credited = cappedCredit(next.resources, rewards);
      for (const key of CURRENCIES) rewards[key] = credited[key];
      unlocked = reconcileUnlocks(next);
      try { loot = this._rollVictoryLoot(next); }
      catch (failure) { return error(failure.message === 'invalid_loot_rng' ? 'invalid_loot_rng' : 'loot_generation_failed'); }
    }
    next.rewardLedger.transactions.push({ battleId, levelId, won, stars, firstClear, dailyRewarded, rewards: clone(rewards), time, casts, loot: clone(loot) });
    next.rewardLedger.transactions = next.rewardLedger.transactions.slice(-TRANSACTION_LIMIT);
    return this._commit(next, { rewards, stars, firstClear, dailyRewarded, loot, ...unlocked });
  }

  exportSave() { return JSON.stringify(this.state, null, 2); }

  /** Export preserved source bytes, distinct from the valid in-session snapshot. */
  exportRecoverySave() {
    if (this.originalSaveRaw !== null) return this.originalSaveRaw;
    try {
      const raw = this.storage?.getItem(CAMPAIGN_SAVE_KEY);
      return typeof raw === 'string' ? raw : null;
    } catch { return null; }
  }

  previewImport(text) {
    try {
      if (typeof text !== 'string' || text.length > MAX_IMPORT_BYTES || new TextEncoder().encode(text).byteLength > MAX_IMPORT_BYTES) return error('import_too_large');
      const state = validateSnapshot(JSON.parse(text), this.now);
      const summary = { schemaVersion: state.schemaVersion, contentVersion: state.lastContentVersion, resources: clone(state.resources), ownedHeroes: Object.keys(state.heroes).length, clearedLevels: Object.values(state.levels).filter(level => level.cleared).length, highestReachedGlobalIndex: state.progress.highestReachedGlobalIndex };
      return { ok: true, reason: null, summary, preview: summary };
    } catch (failure) { return error(failure instanceof SyntaxError ? 'invalid_json' : failure.message); }
  }

  importSave(text) {
    const preview = this.previewImport(text);
    if (!preview.ok) return preview;
    // Import is a user-reviewed replacement. A future-version local save is preserved as a backup.
    const next = validateSnapshot(JSON.parse(text), this.now);
    if (this.readOnly || this.preserveUnreadableSave) {
      try {
        const prior = this.storage?.getItem(CAMPAIGN_SAVE_KEY);
        if (prior) this.storage.setItem(`${CAMPAIGN_SAVE_KEY}-import-previous`, prior);
      } catch { return error('storage_backup_failed'); }
    }
    this.readOnly = false;
    this.preserveUnreadableSave = false;
    return this._commit(next, { preview: preview.preview });
  }
}
