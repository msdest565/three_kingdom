import test from 'node:test';
import assert from 'node:assert/strict';
import { CampaignStore, CAMPAIGN_SAVE_KEY, CAMPAIGN_BACKUP_KEY, EQUIPMENT_SLOTS } from '../campaign-state.js';
import { BALANCE, CONTENT } from '../runtime-data.js';

function memoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return { values, getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, String(value)), removeItem: key => values.delete(key) };
}
function fixture(storage = memoryStorage()) {
  let day = new Date(2026, 9, 11, 12, 0, 0);
  const store = new CampaignStore({ storage, now: () => day });
  return { store, storage, setDay: date => { day = date; } };
}
function clear(store, levelId, options = {}) {
  const battleId = options.battleId || store.createBattleId();
  return store.settleBattle({ battleId, levelId, won: true, hp: 50, maxHp: 100, kills: 100, bestBurst: 30, time: 120, casts: 5, ...options });
}
function clearThrough(store, globalIndex) {
  for (const level of CONTENT.levels.filter(level => level.globalIndex <= globalIndex)) if (!store.state.levels[level.id]?.cleared) assert.equal(clear(store, level.id).ok, true, level.id);
}
function fund(store) { store.state.resources = { experience_book: 10000, copper_coin: 1_000_000, refined_iron: 10000 }; }

test('new account has exact two heroes, zero resources, unique white starter equipment and no invented campaign progress', () => {
  const { store } = fixture();
  assert.deepEqual(Object.keys(store.state.heroes).sort(), ['cao_cao', 'guan_yu']);
  assert.deepEqual(store.state.resources, { experience_book: 0, copper_coin: 0, refined_iron: 0 });
  assert.deepEqual(store.state.unlockedCamps, ['shield', 'archer']);
  assert.equal(store.state.inventory.length, 8);
  assert.equal(new Set(store.state.inventory.map(item => item.itemInstanceId)).size, 8);
  for (const item of store.state.inventory) assert.deepEqual([item.quality, item.level], ['white', 0]);
  assert.deepEqual(store.getPartyForLevel('wei_001').map(hero => hero.heroId), ['guan_yu']);
  assert.equal(store.isLevelUnlocked('wei_001'), true);
  assert.equal(store.isLevelUnlocked('wei_002'), false);
  assert.equal(store.isLevelUnlocked('wu_020'), false);
  assert.equal(store.getMaxPartySize(), 1);
});

test('first clear, floor-per-star bonus, repeated settlement and defeat are separate atomic transactions', () => {
  const { store } = fixture();
  const id = store.createBattleId();
  const first = clear(store, 'wei_001', { battleId: id, hp: 85 });
  assert.equal(first.stars, 3);
  assert.deepEqual(first.rewards, { experience_book: 4, copper_coin: 720, refined_iron: 12 });
  assert.equal(store.state.progress.dailyRepeat.count, 0);
  const before = store.exportSave();
  assert.equal(clear(store, 'wei_001', { battleId: id }).reason, 'already_settled');
  assert.equal(store.exportSave(), before);
  const lossId = store.createBattleId();
  const defeat = store.settleBattle({ battleId: lossId, levelId: 'wei_002', won: false, hp: 0, maxHp: 100 });
  assert.equal(defeat.ok, true);
  assert.equal(defeat.stars, 0);
  assert.equal(store.isLevelUnlocked('wei_003'), false);
  assert.equal(store.settleBattle({ battleId: lossId, levelId: 'wei_002', won: true, hp: 100, maxHp: 100 }).reason, 'already_settled');
});

test('new higher stars receive only the difference, and global daily repeats allow three victories then reset by local day', () => {
  const { store, setDay } = fixture();
  clear(store, 'wei_001');
  clear(store, 'wei_002');
  const two = clear(store, 'wei_001', { hp: 60 });
  assert.deepEqual(two.rewards, { experience_book: 1, copper_coin: 140, refined_iron: 2 });
  const three = clear(store, 'wei_001', { hp: 85 });
  assert.deepEqual(three.rewards, { experience_book: 1, copper_coin: 140, refined_iron: 2 });
  const thirdDaily = clear(store, 'wei_002');
  assert.deepEqual(thirdDaily.rewards, CONTENT.levels[1].repeatReward);
  assert.equal(store.state.progress.dailyRepeat.count, 3);
  assert.deepEqual(clear(store, 'wei_001', { hp: 100 }).rewards, { experience_book: 0, copper_coin: 0, refined_iron: 0 });
  setDay(new Date(2026, 9, 12, 0, 0, 1));
  assert.deepEqual(clear(store, 'wei_002').rewards, CONTENT.levels[1].repeatReward);
  assert.equal(store.state.progress.dailyRepeat.count, 1);
});

test('progression opens real slots, heroes and camps through Wei, Shu and Wu without allowing skipped levels', () => {
  const { store } = fixture();
  assert.equal(clear(store, 'shu_001').reason, 'level_locked');
  clearThrough(store, 2);
  assert.equal(store.getMaxPartySize(), 2);
  assert.equal(store.setParty(['guan_yu', 'cao_cao'], { cao_cao: true }).ok, true);
  assert.equal(store.getPartyForLevel('wei_001').length, 1);
  assert.equal(store.getPartyForLevel('wei_003').length, 2);
  const third = clear(store, 'wei_003');
  assert.deepEqual(third.unlockedHeroes, ['xiahou_dun']);
  assert.deepEqual(third.unlockedCamps, ['catapult']);
  clearThrough(store, 8);
  assert.equal(store.getMaxPartySize(), 3);
  assert.equal(store.state.unlockedCamps.includes('crossbow'), true);
  assert.equal(store.setParty(['guan_yu', 'cao_cao', 'xu_chu']).ok, true);
  clearThrough(store, 21);
  assert.equal(store.state.unlockedCamps.includes('war_drum'), true);
  assert.equal(store.getHero('liu_bei').level, 11);
  clearThrough(store, 41);
  assert.equal(store.state.unlockedCamps.includes('fire_oil'), true);
  assert.equal(store.getHero('sun_quan').level, 21);
});

test('hero catch-up and starter gear happen once, retain investments on replay and catch patch-added eligible heroes up to reached tier', () => {
  const { store, storage } = fixture();
  clearThrough(store, 12);
  assert.equal(store.getHero('zhang_liao').level, 6);
  assert.equal(store.getHero('zhang_liao').skillLevel, 1);
  assert.equal(store.getHero('zhang_liao').equipment.weapon.quality, 'white');
  const inventoryCount = store.state.inventory.length;
  fund(store);
  store.trainHero('zhang_liao');
  clear(store, 'wei_012');
  assert.equal(store.getHero('zhang_liao').level, 7);
  assert.equal(store.state.inventory.length, inventoryCount + 1); // Every repeated victory adds its own chest weapon.
  clearThrough(store, 32);
  const patchSave = JSON.parse(store.exportSave());
  delete patchSave.heroes.zhang_liao;
  patchSave.inventory = patchSave.inventory.filter(item => item.equippedHeroId !== 'zhang_liao');
  patchSave.rewardLedger.heroCatchUps = patchSave.rewardLedger.heroCatchUps.filter(id => id !== 'zhang_liao');
  patchSave.rewardLedger.starterGear = patchSave.rewardLedger.starterGear.filter(id => id !== 'zhang_liao');
  storage.setItem(CAMPAIGN_SAVE_KEY, JSON.stringify(patchSave));
  const restored = new CampaignStore({ storage });
  assert.equal(restored.getHero('zhang_liao').level, 16);
  assert.equal(restored.getHero('zhang_liao').skillLevel, 1);
  assert.equal(restored.state.inventory.filter(item => item.equippedHeroId === 'zhang_liao').length, 4);
});

test('current story guest uses the owned cultivated version, replaces one support and keeps permanent inventory unchanged', () => {
  const { store } = fixture();
  clearThrough(store, 11);
  store.setParty(['guan_yu', 'cao_cao', 'xiahou_dun']);
  const guestLevel = CONTENT.levels.find(level => level.id === 'wei_012');
  assert.equal(guestLevel.storyGuest.heroId, 'xu_chu');
  const before = store.state.inventory.length;
  assert.equal(store.setGuest('wei_012', true).ok, true);
  const party = store.getPartyForLevel('wei_012');
  assert.equal(party.length, 3);
  assert.equal(party[2].heroId, 'xu_chu');
  assert.equal(party[2].guest, false);
  assert.equal(party[2].level, store.getHero('xu_chu').level);
  assert.equal(store.state.inventory.length, before);
  assert.equal(store.getPartyForLevel('wei_012', { includeGuest: false })[2].heroId, 'xiahou_dun');
  fund(store);
  store.trainHero('xu_chu');
  assert.equal(store.getPartyForLevel('wei_012')[2].guest, false);
  assert.equal(store.getPartyForLevel('wei_012')[2].level, 4);
});

test('future unowned guest preset never grants permanent ownership or disposable equipment', () => {
  const { store } = fixture();
  clearThrough(store, 11);
  store.setParty(['guan_yu', 'cao_cao', 'xiahou_dun']);
  const level = CONTENT.levels.find(level => level.id === 'wei_012');
  const savedGuest = level.storyGuest;
  try {
    level.storyGuest = { ...savedGuest, heroId: 'zhang_liao' };
    const count = store.state.inventory.length;
    const party = store.getPartyForLevel('wei_012', { includeGuest: true });
    assert.equal(party.length, 3);
    assert.equal(party[2].guest, true);
    assert.equal(party[2].level, savedGuest.level);
    assert.equal(store.getHero('zhang_liao'), null);
    assert.equal(store.state.inventory.length, count);
  } finally { level.storyGuest = savedGuest; }
});

test('training carries unused book XP and exactly matches cumulative level costs; insufficient materials never partially charge', () => {
  const { store } = fixture();
  const before = store.exportSave();
  assert.equal(store.trainHero('guan_yu').reason, 'insufficient_resources');
  assert.equal(store.exportSave(), before);
  fund(store);
  const starting = { ...store.state.resources };
  assert.deepEqual(store.getTrainingCost('guan_yu').cost, { experience_book: 1, copper_coin: 80, refined_iron: 0 });
  assert.equal(store.trainHero('guan_yu').ok, true);
  assert.equal(store.getHero('guan_yu').xp, 10);
  while (store.getHero('guan_yu').level < 30) assert.equal(store.trainHero('guan_yu').ok, true);
  assert.equal(starting.experience_book - store.state.resources.experience_book, 105);
  assert.equal(starting.copper_coin - store.state.resources.copper_coin, 10440);
  assert.equal(store.getHero('guan_yu').xp, 30);
  assert.equal(store.trainHero('guan_yu').reason, 'max_level');
});

test('skill gates require real hero levels and every upgrade uses the documented copper cost', () => {
  const { store } = fixture();
  fund(store);
  const before = store.state.resources.copper_coin;
  assert.equal(store.trainSkill('guan_yu').reason, 'hero_level_required');
  assert.equal(store.getSkillCost('guan_yu').requiredHeroLevel, 7);
  assert.equal(store.state.resources.copper_coin, before);
  for (const required of [7, 13, 19, 25]) {
    while (store.getHero('guan_yu').level < required) store.trainHero('guan_yu');
    const quote = store.getSkillCost('guan_yu');
    const coins = store.state.resources.copper_coin;
    assert.equal(store.trainSkill('guan_yu').ok, true);
    assert.equal(coins - store.state.resources.copper_coin, quote.cost.copper_coin);
  }
  assert.equal(store.getHero('guan_yu').skillLevel, 5);
  assert.equal(store.trainSkill('guan_yu').reason, 'max_skill_level');
});

test('equipment strengthening and quality promotion preserve ownership/level and respect reached-stage gates', () => {
  const { store } = fixture();
  fund(store);
  assert.equal(store.promoteEquipment('guan_yu', 'weapon').reason, 'tier_required');
  assert.deepEqual(store.getEquipmentUpgradeCost('guan_yu', 'weapon').cost, { experience_book: 0, copper_coin: 100, refined_iron: 2 });
  store.upgradeEquipment('guan_yu', 'weapon');
  const id = store.getHero('guan_yu').equipment.weapon.itemInstanceId;
  clearThrough(store, 10);
  assert.equal(store.getEquipmentPromotionCost('guan_yu', 'weapon').requiredTier, 'S03');
  assert.equal(store.promoteEquipment('guan_yu', 'weapon').ok, true);
  assert.equal(store.getHero('guan_yu').equipment.weapon.quality, 'blue');
  assert.equal(store.getHero('guan_yu').equipment.weapon.level, 1);
  assert.equal(store.getHero('guan_yu').equipment.weapon.itemInstanceId, id);
  while (store.getHero('guan_yu').equipment.weapon.level < 10) assert.equal(store.upgradeEquipment('guan_yu', 'weapon').ok, true);
  assert.equal(store.upgradeEquipment('guan_yu', 'weapon').reason, 'max_equipment_level');
  clearThrough(store, 50);
  assert.equal(store.promoteEquipment('guan_yu', 'weapon').ok, true);
  assert.equal(store.promoteEquipment('guan_yu', 'weapon').ok, true);
  assert.equal(store.getHero('guan_yu').equipment.weapon.quality, 'red');
  assert.equal(store.getHero('guan_yu').equipment.weapon.level, 10);
  assert.equal(store.promoteEquipment('guan_yu', 'weapon').reason, 'max_equipment_quality');
  assert.equal(store.getHero('cao_cao').equipment.weapon.quality, 'white');
});

test('sixty actual one-star first clears match the reward source including fifteen act-end multipliers', () => {
  const { store } = fixture();
  clearThrough(store, 60);
  assert.deepEqual(store.state.resources, { experience_book: 600, copper_coin: 108600, refined_iron: 1338 });
  assert.equal(Object.keys(store.state.heroes).length, 15);
  assert.equal(store.state.inventory.length, 120); // Sixty starter items plus sixty one-item victory chests.
  assert.equal(store.state.progress.dailyRepeat.count, 0);
  assert.equal(store.state.rewardLedger.firstClears.length, 60);
});

test('three-star full campaign reward matches floor-per-resource derived total', () => {
  const { store } = fixture();
  for (const level of CONTENT.levels) assert.equal(clear(store, level.id, { hp: 100 }).ok, true);
  assert.deepEqual(store.state.resources, { experience_book: 664, copper_coin: 130320, refined_iron: 1566 });
});

test('party rejects duplicate, locked heroes and too many slots without changing the snapshot', () => {
  const { store } = fixture();
  const initial = store.exportSave();
  for (const ids of [[], ['guan_yu', 'guan_yu'], ['guan_yu', 'cao_cao'], ['zhou_yu']]) assert.equal(store.setParty(ids).ok, false);
  assert.equal(store.setParty(['guan_yu'], { guan_yu: 1 }).ok, false);
  assert.equal(store.exportSave(), initial);
  clearThrough(store, 2);
  store.setParty(['cao_cao', 'guan_yu'], { guan_yu: true });
  const party = store.getPartyForLevel('wei_003');
  assert.equal(party[1].auto, true);
  party[0].equipment.weapon.level = 10;
  assert.equal(store.getHero('cao_cao').equipment.weapon.level, 0);
});

test('legacy migration preserves audio, tutorial, speed and records but does not exchange prototype wins for campaign rewards', () => {
  const raw = JSON.stringify({ sound: false, musicEnabled: true, bestBurst: 120, bestKills: 999, wins: 8, tutorialVersion: 1, tutorialCompleted: true });
  const storage = memoryStorage({ 'wushuang-guard-v1': raw, 'wushuang-guard-combat-speed': '1.5' });
  const { store } = fixture(storage);
  assert.deepEqual(store.state.legacyRecords, { bestBurst: 120, bestKills: 999, wins: 8 });
  assert.equal(store.state.settings.musicEnabled, true);
  assert.equal(store.state.settings.sfxEnabled, false);
  assert.equal(store.state.settings.speed, 1.5);
  assert.equal(store.state.settings.tutorialVersion, 1);
  assert.equal(store.state.settings.tutorialCompleted, true);
  assert.equal(store.state.rewardLedger.firstClears.length, 0);
  assert.deepEqual(store.state.resources, BALANCE.metaProgression.initialResources);
  assert.equal(storage.getItem(`${CAMPAIGN_SAVE_KEY}-prototype-backup`), raw);
  assert.equal(storage.getItem('wushuang-guard-v1'), raw);
});

test('saved snapshot restores settings, rewards and idempotency and keeps a previous valid backup', () => {
  const { store, storage } = fixture();
  const id = store.createBattleId();
  clear(store, 'wei_001', { battleId: id });
  const beforeSetting = storage.getItem(CAMPAIGN_SAVE_KEY);
  store.setSetting('speed', 2);
  assert.equal(storage.getItem(CAMPAIGN_BACKUP_KEY), beforeSetting);
  const restored = new CampaignStore({ storage });
  assert.equal(restored.state.settings.speed, 2);
  assert.equal(restored.isLevelUnlocked('wei_002'), true);
  assert.equal(clear(restored, 'wei_001', { battleId: id }).reason, 'already_settled');
  assert.equal(restored.getHero('guan_yu').equipment.weapon.level, 0);
});

test('preview import is non-mutating; invalid integers, progression, foreign gear and newer versions retain the old snapshot', () => {
  const { store } = fixture();
  clear(store, 'wei_001');
  const before = store.exportSave();
  const preview = store.previewImport(before);
  assert.equal(preview.ok, true);
  assert.equal(preview.summary.ownedHeroes, 2);
  assert.equal(preview.summary.clearedLevels, 1);
  assert.equal(store.exportSave(), before);
  const tamperCases = [
    save => { save.resources.copper_coin = -1; },
    save => { save.resources.experience_book = 1.1; },
    save => { save.resources.refined_iron = 1_000_000_001; },
    save => { save.schemaVersion = 99; },
    save => { save.heroes.guan_yu.skillLevel = 5; },
    save => { save.inventory[0].equippedHeroId = 'guan_yu'; },
    save => { save.inventory.push({ ...save.inventory[0] }); },
    save => { save.levels.wei_002 = { ...save.levels.wei_001 }; delete save.levels.wei_001; save.rewardLedger.firstClears = ['wei_002']; },
    save => { save.heroes.guan_yu.equipmentIds.weapon = save.heroes.cao_cao.equipmentIds.weapon; },
    save => { save.heroes.guan_yu.level = 31; },
  ];
  for (const tamper of tamperCases) {
    const save = JSON.parse(before);
    tamper(save);
    assert.equal(store.importSave(JSON.stringify(save)).ok, false);
    assert.equal(store.exportSave(), before);
  }
  assert.equal(store.importSave('{').reason, 'invalid_json');
  assert.equal(store.importSave('x'.repeat(2_000_001)).reason, 'import_too_large');
});

test('valid reviewed import replaces progress without auto-unlocking nonexistent content', () => {
  const source = fixture().store;
  clearThrough(source, 3);
  source.setSetting('musicEnabled', false);
  const { store } = fixture();
  assert.equal(store.importSave(source.exportSave()).ok, true);
  assert.equal(store.isLevelUnlocked('wei_004'), true);
  assert.equal(store.isLevelUnlocked('wei_005'), false);
  assert.equal(store.getHero('xiahou_dun').level, 1);
  assert.equal(store.state.settings.musicEnabled, false);
});

test('corrupt save recovers a valid backup; without one, session play is usable while unreadable bytes remain untouched', () => {
  const { store, storage } = fixture();
  clear(store, 'wei_001');
  store.setSetting('speed', 2);
  storage.setItem(CAMPAIGN_SAVE_KEY, '{corrupt');
  const restored = new CampaignStore({ storage });
  assert.equal(restored.isLevelUnlocked('wei_002'), true);
  assert.match(restored.persistenceWarning, /备份/);
  const bad = memoryStorage({ [CAMPAIGN_SAVE_KEY]: '{broken' });
  const session = new CampaignStore({ storage: bad });
  assert.equal(session.readOnly, false);
  assert.equal(clear(session, 'wei_001').ok, true);
  assert.equal(session.isLevelUnlocked('wei_002'), true);
  assert.equal(bad.getItem(CAMPAIGN_SAVE_KEY), '{broken');
  assert.match(session.persistenceWarning, /临时新进度/);
});

test('future save is read-only and never silently downgraded or overwritten', () => {
  const future = JSON.parse(fixture().store.exportSave());
  future.schemaVersion = 4;
  const raw = JSON.stringify(future);
  const storage = memoryStorage({ [CAMPAIGN_SAVE_KEY]: raw });
  const { store } = fixture(storage);
  assert.equal(store.readOnly, true);
  assert.equal(store.createBattleId(), null);
  assert.equal(store.setSetting('speed', 2).reason, 'save_read_only');
  assert.equal(store.save().reason, 'save_read_only');
  assert.equal(storage.getItem(CAMPAIGN_SAVE_KEY), raw);
});

test('recovery export preserves original corrupt or future bytes even if subsequent storage reads fail', () => {
  for (const raw of ['{broken', JSON.stringify({ schemaVersion: 77, futureOnly: { untouched: true } })]) {
    const storage = memoryStorage({ [CAMPAIGN_SAVE_KEY]: raw });
    const { store } = fixture(storage);
    const initial = store.exportSave();
    storage.getItem = () => { throw new Error('disabled after loading'); };
    assert.equal(store.exportRecoverySave(), raw);
    assert.equal(store.exportSave(), initial);
    assert.notEqual(store.exportRecoverySave(), store.exportSave());
  }
  const empty = fixture().store;
  assert.equal(empty.exportRecoverySave(), null);
});

test('reviewed import replaces a preserved future or corrupt save and archives its exact original bytes', () => {
  const source = fixture().store;
  clear(source, 'wei_001');
  for (const raw of ['{broken', JSON.stringify({ schemaVersion: 77, futureOnly: { untouched: true } })]) {
    const storage = memoryStorage({ [CAMPAIGN_SAVE_KEY]: raw });
    const { store } = fixture(storage);
    const before = store.exportSave();
    assert.equal(store.previewImport(source.exportSave()).ok, true);
    assert.equal(store.exportSave(), before);
    assert.equal(storage.getItem(CAMPAIGN_SAVE_KEY), raw);
    assert.equal(store.importSave(source.exportSave()).ok, true);
    assert.equal(store.readOnly, false);
    assert.equal(store.preserveUnreadableSave, false);
    assert.equal(store.isLevelUnlocked('wei_002'), true);
    assert.equal(storage.getItem(`${CAMPAIGN_SAVE_KEY}-import-previous`), raw);
    assert.equal(store.exportRecoverySave(), raw);
  }
});

test('failed recovery archive rejects import without altering the readonly snapshot or original stored bytes', () => {
  const raw = JSON.stringify({ schemaVersion: 77, futureOnly: true });
  const storage = memoryStorage({ [CAMPAIGN_SAVE_KEY]: raw });
  const { store } = fixture(storage);
  const before = store.exportSave();
  storage.setItem = () => { throw new Error('quota'); };
  assert.equal(store.importSave(fixture().store.exportSave()).reason, 'storage_backup_failed');
  assert.equal(store.readOnly, true);
  assert.equal(store.exportSave(), before);
  assert.equal(storage.getItem(CAMPAIGN_SAVE_KEY), raw);
  assert.equal(store.exportRecoverySave(), raw);
});

test('storage failure keeps the atomic in-session result and reports failure; repeats cannot pay again', () => {
  const storage = memoryStorage();
  const { store } = fixture(storage);
  const id = store.createBattleId();
  const raw = storage.getItem(CAMPAIGN_SAVE_KEY);
  storage.setItem = () => { throw new Error('quota'); };
  const result = clear(store, 'wei_001', { battleId: id });
  assert.equal(result.ok, true);
  assert.equal(result.persisted, false);
  assert.equal(store.isLevelUnlocked('wei_002'), true);
  assert.equal(clear(store, 'wei_001', { battleId: id }).reason, 'already_settled');
  assert.equal(storage.getItem(CAMPAIGN_SAVE_KEY), raw);
  assert.match(store.persistenceWarning, /写入失败/);
});

test('initial unreadable storage cannot later be overwritten by a temporary new account without reviewed import', () => {
  const raw = JSON.stringify({ schemaVersion: 77, futureOnly: true });
  const storage = memoryStorage({ [CAMPAIGN_SAVE_KEY]: raw });
  const read = storage.getItem;
  storage.getItem = () => { throw new Error('initial access denied'); };
  const { store } = fixture(storage);
  assert.equal(store.preserveUnreadableSave, true);
  storage.getItem = read;
  assert.equal(store.exportRecoverySave(), raw);
  assert.equal(clear(store, 'wei_001').ok, true);
  assert.equal(storage.getItem(CAMPAIGN_SAVE_KEY), raw);
});

test('a failed read during save never deletes an existing snapshot as a mistaken rollback', () => {
  const { store, storage } = fixture();
  store.save();
  const raw = storage.getItem(CAMPAIGN_SAVE_KEY);
  storage.getItem = () => { throw new Error('read denied'); };
  assert.equal(store.setSetting('speed', 2).persisted, false);
  assert.equal(storage.values.get(CAMPAIGN_SAVE_KEY), raw);
  assert.equal(store.state.settings.speed, 2);
});

test('bounded receipts retain current duplicate protection and reject expired IDs instead of repaying old battles', () => {
  const { store } = fixture();
  const oldId = store.createBattleId();
  clear(store, 'wei_001', { battleId: oldId });
  for (let i = 0; i < 1030; i++) {
    const id = store.createBattleId();
    assert.equal(store.settleBattle({ battleId: id, levelId: 'wei_001', won: false, hp: 0, maxHp: 100 }).ok, true);
  }
  assert.equal(store.state.rewardLedger.processedBattleIds.length, 1024);
  assert.equal(store.state.rewardLedger.transactions.length, 128);
  assert.equal(clear(store, 'wei_001', { battleId: oldId }).reason, 'expired_or_unissued_battle');
  const current = store.state.rewardLedger.processedBattleIds.at(-1);
  assert.equal(clear(store, 'wei_001', { battleId: current }).reason, 'already_settled');
  const before = store.state.resources.copper_coin;
  const restored = new CampaignStore({ storage: memoryStorage({ [CAMPAIGN_SAVE_KEY]: store.exportSave() }) });
  assert.equal(clear(restored, 'wei_001', { battleId: oldId }).ok, false);
  assert.equal(restored.state.resources.copper_coin, before);
});

test('unknown retired IDs are filtered on loading, while import rejects unknown active heroes and invalid auto flags', () => {
  const source = fixture().store;
  const retired = JSON.parse(source.exportSave());
  retired.heroes.retired_hero = { ...retired.heroes.cao_cao };
  retired.levels.retired_level = { cleared: false, highestRewardedStars: 0 };
  const storage = memoryStorage({ [CAMPAIGN_SAVE_KEY]: JSON.stringify(retired) });
  const loaded = new CampaignStore({ storage });
  assert.equal(loaded.readOnly, false);
  assert.equal(loaded.getHero('retired_hero'), null);
  assert.equal(loaded.state.levels.retired_level, undefined);
  assert.equal(source.importSave(JSON.stringify(retired)).ok, false);
  assert.equal(source.setSetting('speed', 3).reason, 'invalid_setting');
  assert.equal(source.setSetting('musicEnabled', 'true').reason, 'invalid_setting');
  assert.equal(source.setSetting('tutorialVersion', 1).ok, true);
  assert.equal(EQUIPMENT_SLOTS.length, 4);
});
