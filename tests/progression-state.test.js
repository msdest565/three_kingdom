import test from 'node:test';
import assert from 'node:assert/strict';
import { CampaignStore, CAMPAIGN_SAVE_KEY, CAMPAIGN_BACKUP_KEY, SAVE_SCHEMA_VERSION, EQUIPMENT_SLOTS } from '../campaign-state.js';
import { BALANCE, CONTENT } from '../runtime-data.js';

const EQUIPMENT = BALANCE.metaProgression.equipment;
function memoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return { values, getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, String(value)), removeItem: key => values.delete(key) };
}
function fixture(rng = () => 0, storage = memoryStorage()) {
  return { store: new CampaignStore({ rng, storage, now: () => new Date(2026, 9, 11, 12) }), storage };
}
function clear(store, levelId = 'wei_001', overrides = {}) {
  return store.settleBattle({ battleId: overrides.battleId || store.createBattleId(), levelId, won: true, hp: 50, maxHp: 100, kills: 100, bestBurst: 30, time: 120, casts: 5, ...overrides });
}
function clearThrough(store, index) {
  for (const level of CONTENT.levels.filter(level => level.globalIndex <= index)) assert.equal(clear(store, level.id).ok, true, level.id);
}
function fund(store) { store.state.resources = { experience_book: 10000, copper_coin: 1_000_000, refined_iron: 10000 }; }

test('each winning receipt stores exactly one weapon, including repeats after daily material allowance; defeat and replay never roll', () => {
  let rolls = 0;
  const { store, storage } = fixture(() => { rolls++; return 0; });
  const battleId = store.createBattleId();
  const first = clear(store, 'wei_001', { battleId });
  assert.equal(first.ok, true);
  assert.equal(first.loot.item.slot, 'weapon');
  assert.equal(first.loot.item.equippedHeroId, null);
  assert.deepEqual(store.state.rewardLedger.transactions.at(-1).loot, first.loot);
  assert.equal(store.state.inventory.length, 9);
  const raw = store.exportSave();
  assert.equal(clear(store, 'wei_001', { battleId }).reason, 'already_settled');
  assert.equal(store.exportSave(), raw);
  assert.equal(rolls, 1);
  const restored = fixture(() => { throw new Error('replayed RNG'); }, storage).store;
  assert.equal(clear(restored, 'wei_001', { battleId }).reason, 'already_settled');
  for (let i = 0; i < 4; i++) assert.equal(clear(store).loot.quality, 'white');
  assert.equal(store.state.progress.dailyRepeat.count, 3);
  assert.deepEqual(store.state.rewardLedger.transactions.at(-1).rewards, { experience_book: 0, copper_coin: 0, refined_iron: 0 });
  assert.equal(store.state.inventory.length, 13);
  const defeat = clear(store, 'wei_002', { won: false, hp: 0 });
  assert.equal(defeat.loot, null);
  assert.equal(rolls, 5);
  assert.equal(store.state.inventory.length, 13);
});

test('public chest boundaries implement white 45%, blue 30%, purple 17.5%, red 5%, gold 2.5% and retain unowned signatures', () => {
  const cases = [[0, 'white'], [0.449999999, 'white'], [0.45, 'blue'], [0.749999999, 'blue'],
    [0.75, 'purple'], [0.924999999, 'purple'], [0.925, 'red'], [0.974999999, 'red'], [0.975, 'gold'], [0.999999999, 'gold']];
  for (const [value, quality] of cases) {
    let calls = 0;
    const { store } = fixture(() => ++calls === 1 ? value : 0.999999999);
    const result = clear(store);
    assert.equal(result.ok, true, value);
    assert.equal(result.loot.quality, quality, value);
    assert.equal(calls, quality === 'gold' ? 2 : 1);
    assert.equal(store.state.inventory.filter(item => item.itemInstanceId === result.loot.item.itemInstanceId).length, 1);
    if (quality === 'gold') {
      assert.equal(result.loot.templateId, BALANCE.loot.goldTemplateIds.at(-1));
      assert.equal(EQUIPMENT.templates[result.loot.templateId].quality, 'gold');
      assert.equal(store.getHero(EQUIPMENT.templates[result.loot.templateId].exclusiveHeroId), null);
    } else assert.equal(result.loot.templateId, 'basic_weapon');
  }
});

test('every one of the 10,000 equally spaced RNG bins matches the exact configured loot weights', () => {
  const { store } = fixture();
  const observed = Object.fromEntries(Object.keys(BALANCE.loot.qualityWeights).map(key => [key, 0]));
  for (let point = 0; point < BALANCE.loot.weightScale; point++) {
    let calls = 0;
    store.rng = () => ++calls === 1 ? (point + 0.5) / BALANCE.loot.weightScale : 0.5;
    const next = { accountId: 'audit-account', nextEquipmentSequence: 1, inventory: [], resources: { experience_book: 0, copper_coin: 0, refined_iron: 0 } };
    const loot = store._rollVictoryLoot(next);
    observed[loot.quality]++;
    assert.equal(next.inventory.length, 1);
  }
  assert.deepEqual(observed, BALANCE.loot.qualityWeights);
  assert.equal(observed.gold / BALANCE.loot.weightScale, 0.025);
});

test('loot RNG failures do not charge, consume the receipt, grant items or alter progress', () => {
  for (const value of [NaN, -0.01, 1, Infinity]) {
    const { store } = fixture(() => value);
    const battleId = store.createBattleId();
    const before = store.exportSave();
    assert.equal(clear(store, 'wei_001', { battleId }).reason, 'invalid_loot_rng');
    assert.equal(store.exportSave(), before);
    store.rng = () => 0;
    assert.equal(clear(store, 'wei_001', { battleId }).ok, true);
  }
});

test('technology uses earned stage gates and exact copper/iron costs, with independent battle snapshots', () => {
  const { store } = fixture();
  assert.equal(store.getTechnologyCost('fire_oil').reason, 'camp_locked');
  assert.equal(store.getTechnologyCost('unknown').reason, 'invalid_camp');
  assert.deepEqual(store.getTechnologyCost('archer').cost, { experience_book: 0, copper_coin: 120, refined_iron: 1 });
  const initial = store.exportSave();
  assert.equal(store.researchTechnology('archer').reason, 'insufficient_resources');
  assert.equal(store.exportSave(), initial);
  fund(store);
  const battle = store.getBattleTechnology();
  assert.equal(store.researchTechnology('archer').ok, true);
  assert.equal(store.state.technology.archer, 1);
  assert.equal(battle.archer, 0);
  battle.shield = 99;
  assert.equal(store.state.technology.shield, 0);
  assert.equal(store.getTechnologyCost('archer').requiredGlobalIndex, 6);
  const gated = store.exportSave();
  assert.equal(store.researchTechnology('archer').reason, 'level_required');
  assert.equal(store.exportSave(), gated);
  clearThrough(store, 45);
  const resources = { ...store.state.resources };
  for (let target = 2; target <= 10; target++) {
    const quote = store.getTechnologyCost('archer');
    assert.equal(quote.cost.copper_coin, 120 + 60 * (target - 1));
    assert.equal(quote.cost.refined_iron, 1 + Math.floor((target - 1) / 2));
    assert.equal(store.researchTechnology('archer').ok, true);
  }
  assert.equal(resources.copper_coin - store.state.resources.copper_coin, 3780);
  assert.equal(resources.refined_iron - store.state.resources.refined_iron, 29);
  assert.equal(store.researchTechnology('archer').reason, 'max_technology_level');
  assert.equal(store.state.technology.shield, 0);
});

test('forge quotes require real tier/materials and create distinct transferrable items with no gold recipe', () => {
  const { store } = fixture();
  const before = store.exportSave();
  assert.equal(store.forgeEquipment('basic_weapon', 'white').reason, 'insufficient_resources');
  assert.equal(store.forgeEquipment('basic_weapon', 'blue').reason, 'tier_required');
  assert.equal(store.forgeEquipment('basic_weapon', 'gold').reason, 'gold_chest_only');
  assert.equal(store.forgeEquipment('signature_guan_yu_weapon', 'gold').reason, 'gold_chest_only');
  assert.equal(store.forgeEquipment('signature_guan_yu_horse', 'white').reason, 'invalid_forge_quality');
  assert.equal(store.exportSave(), before);
  fund(store);
  const oldResources = { ...store.state.resources };
  const a = store.forgeEquipment('basic_armor', 'white');
  const b = store.forgeEquipment('basic_armor', 'white');
  assert.equal(a.ok, true);
  assert.equal(b.ok, true);
  assert.notEqual(a.item.itemInstanceId, b.item.itemInstanceId);
  assert.equal(a.item.equippedHeroId, null);
  assert.equal(a.item.level, 0);
  assert.equal(oldResources.copper_coin - store.state.resources.copper_coin, 240);
  assert.equal(oldResources.refined_iron - store.state.resources.refined_iron, 4);
  const detached = store.getInventory({ slot: 'armor' });
  detached[0].level = 10;
  assert.equal(store.getHero('cao_cao').equipment.armor.level, 0);
});

test('ordinary gear promotes white through red only and each of fifteen signature horses is a red forge recipe', () => {
  const { store } = fixture();
  clearThrough(store, 50);
  fund(store);
  assert.equal(store.promoteEquipment('guan_yu', 'weapon').ok, true);
  assert.equal(store.promoteEquipment('guan_yu', 'weapon').ok, true);
  assert.equal(store.promoteEquipment('guan_yu', 'weapon').ok, true);
  assert.equal(store.getHero('guan_yu').equipment.weapon.quality, 'red');
  assert.equal(store.promoteEquipment('guan_yu', 'weapon').reason, 'max_equipment_quality');
  const horses = Object.values(EQUIPMENT.templates).filter(template => template.exclusiveHeroId && template.slot === 'horse');
  assert.equal(horses.length, 15);
  for (const template of horses) {
    const result = store.forgeEquipment(template.id, 'red');
    assert.equal(result.ok, true, template.id);
    assert.equal(result.item.quality, 'red');
    assert.equal(result.item.exclusiveHeroId, template.exclusiveHeroId);
  }
  assert.equal(EQUIPMENT.templates.signature_guan_yu_horse.name, '赤兔');
});

test('equipping transfers one physical item, empties the old owner slot and retains the target replaced item in the bag', () => {
  const { store, storage } = fixture();
  fund(store);
  const forged = store.forgeEquipment('basic_weapon', 'white').item;
  const oldGuan = store.getHero('guan_yu').equipment.weapon.itemInstanceId;
  const oldCao = store.getHero('cao_cao').equipment.weapon.itemInstanceId;
  assert.equal(store.equipEquipment('guan_yu', forged.itemInstanceId).ok, true);
  assert.equal(store.state.inventory.find(item => item.itemInstanceId === oldGuan).equippedHeroId, null);
  assert.equal(store.equipEquipment('cao_cao', forged.itemInstanceId).ok, true);
  assert.equal(store.getHero('guan_yu').equipment.weapon, null);
  assert.equal(store.getHero('guan_yu').equipmentIds.weapon, null);
  assert.equal(store.getHero('cao_cao').equipment.weapon.itemInstanceId, forged.itemInstanceId);
  assert.equal(store.state.inventory.find(item => item.itemInstanceId === oldCao).equippedHeroId, null);
  assert.equal(store.state.inventory.filter(item => item.itemInstanceId === forged.itemInstanceId).length, 1);
  const restored = fixture(() => 0, storage).store;
  assert.equal(restored.getHero('guan_yu').equipment.weapon, null);
  assert.equal(restored.getHero('cao_cao').equipment.weapon.itemInstanceId, forged.itemInstanceId);
  const before = restored.exportSave();
  assert.equal(restored.equipEquipment('zhou_yu', oldGuan).reason, 'hero_not_owned');
  assert.equal(restored.equipEquipment('guan_yu', 'nonexistent').reason, 'invalid_equipment');
  assert.equal(restored.exportSave(), before);
});

test('gold signatures activate only for the matching general, transfer safely and strengthen but cannot promote', () => {
  let calls = 0;
  const index = BALANCE.loot.goldTemplateIds.indexOf('signature_guan_yu_weapon');
  const { store } = fixture(() => ++calls === 1 ? 0.975 : (index + 0.5) / BALANCE.loot.goldTemplateIds.length);
  const gold = clear(store).loot.item;
  fund(store);
  store.equipEquipment('cao_cao', gold.itemInstanceId);
  assert.equal(store.getHero('cao_cao').equipment.weapon.signatureActive, false);
  assert.deepEqual(store.getHero('cao_cao').equipment.weapon.signatureBonuses, {});
  store.equipEquipment('guan_yu', gold.itemInstanceId);
  const matched = store.getHero('guan_yu').equipment.weapon;
  assert.equal(matched.signatureActive, true);
  assert.deepEqual(matched.signatureBonuses, EQUIPMENT.templates.signature_guan_yu_weapon.signatureBonuses);
  assert.equal(store.upgradeEquipment('guan_yu', 'weapon').ok, true);
  assert.equal(store.getHero('guan_yu').equipment.weapon.level, 1);
  const before = store.exportSave();
  assert.equal(store.promoteEquipment('guan_yu', 'weapon').reason, 'gold_quality_fixed');
  assert.equal(store.exportSave(), before);
});

test('salvage only accepts unworn objects and grants the fixed material value once without refunding upgrades', () => {
  const { store } = fixture();
  const equipped = store.getHero('guan_yu').equipment.weapon.itemInstanceId;
  const initial = store.exportSave();
  assert.equal(store.salvageEquipment(equipped).reason, 'equipment_is_equipped');
  assert.equal(store.exportSave(), initial);
  const item = clear(store).loot.item;
  store.state.inventory.find(gear => gear.itemInstanceId === item.itemInstanceId).level = 10;
  const result = store.salvageEquipment(item.itemInstanceId);
  assert.equal(result.ok, true);
  assert.deepEqual(result.rewards, { experience_book: 0, copper_coin: 24, refined_iron: 1 });
  assert.equal(store.salvageEquipment(item.itemInstanceId).reason, 'invalid_equipment');
});

test('a full 4,000-item bag auto-salvages only the rolled item, preserves exact gold odds and cannot block a capped-resource victory', () => {
  let calls = 0;
  const { store } = fixture(() => ++calls === 1 ? 0.975 : 0);
  while (store.state.inventory.length < EQUIPMENT.inventoryMax) store.state.inventory.push({ itemInstanceId: `bag:${store.state.inventory.length}`, templateId: 'basic_weapon', slot: 'weapon', quality: 'white', level: 0, equippedHeroId: null });
  const inventory = JSON.stringify(store.state.inventory);
  store.state.resources = { experience_book: 1_000_000_000, copper_coin: 1_000_000_000, refined_iron: 1_000_000_000 };
  const battleId = store.createBattleId();
  const result = clear(store, 'wei_001', { battleId });
  assert.equal(result.ok, true);
  assert.equal(result.loot.quality, 'gold');
  assert.equal(result.loot.salvaged, true);
  assert.deepEqual(result.loot.salvageResources, { experience_book: 0, copper_coin: 0, refined_iron: 0 });
  assert.equal(JSON.stringify(store.state.inventory), inventory);
  assert.equal(store.state.levels.wei_001.cleared, true);
  assert.equal(store.forgeEquipment('basic_weapon', 'white').reason, 'inventory_full');
  assert.equal(clear(store, 'wei_001', { battleId }).reason, 'already_settled');
  assert.equal(calls, 2);
});

test('full-bag hero unlock keeps pre-existing equipment untouched and creates legal empty zero-bonus slots', () => {
  const { store } = fixture();
  clearThrough(store, 2);
  while (store.state.inventory.length < EQUIPMENT.inventoryMax) store.state.inventory.push({ itemInstanceId: `bag:${store.state.inventory.length}`, templateId: 'basic_weapon', slot: 'weapon', quality: 'white', level: 0, equippedHeroId: null });
  const inventory = JSON.stringify(store.state.inventory);
  const result = clear(store, 'wei_003');
  assert.equal(result.ok, true);
  assert.deepEqual(result.unlockedHeroes, ['xiahou_dun']);
  assert.equal(JSON.stringify(store.state.inventory), inventory);
  assert.equal(store.state.inventory.length, EQUIPMENT.inventoryMax);
  assert.equal(result.loot.salvaged, true);
  for (const slot of EQUIPMENT_SLOTS) assert.equal(store.getHero('xiahou_dun').equipment[slot], null);
});

test('schema 2 migration maps the old quality ladder and retains investment, party, progress, receipt history and the original backup bytes', () => {
  const { store } = fixture();
  clearThrough(store, 32);
  fund(store);
  store.setParty(['guan_yu', 'cao_cao', 'xiahou_dun'], { cao_cao: true });
  const legacy = JSON.parse(store.exportSave());
  legacy.schemaVersion = 2;
  delete legacy.technology;
  delete legacy.nextEquipmentSequence;
  legacy.inventory = legacy.inventory.filter(item => item.itemInstanceId.startsWith('starter:'));
  const qualities = ['white', 'green', 'blue', 'purple'];
  legacy.inventory.forEach((item, index) => { item.quality = qualities[index % 4]; item.level = index % 11; });
  legacy.rewardLedger.transactions.forEach(transaction => { delete transaction.loot; });
  const raw = JSON.stringify(legacy);
  const storage = memoryStorage({ [CAMPAIGN_SAVE_KEY]: raw });
  const migrated = fixture(() => 0, storage).store;
  assert.equal(migrated.readOnly, false);
  assert.equal(migrated.state.schemaVersion, SAVE_SCHEMA_VERSION);
  assert.equal(storage.getItem(CAMPAIGN_SAVE_KEY), raw);
  assert.equal(migrated.exportRecoverySave(), raw);
  assert.deepEqual(migrated.state.resources, legacy.resources);
  assert.deepEqual(migrated.state.party, legacy.party);
  assert.deepEqual(migrated.state.levels, legacy.levels);
  assert.deepEqual(migrated.state.rewardLedger, legacy.rewardLedger);
  assert.deepEqual(migrated.state.heroes, legacy.heroes);
  assert.deepEqual(migrated.state.technology, Object.fromEntries(Object.keys(BALANCE.technology.camps).map(id => [id, 0])));
  const expected = { white: 'white', green: 'blue', blue: 'purple', purple: 'red' };
  for (let i = 0; i < legacy.inventory.length; i++) {
    const before = legacy.inventory[i];
    const after = migrated.state.inventory[i];
    assert.deepEqual(after, { ...before, quality: expected[before.quality] });
  }
  assert.equal(migrated.save().ok, true);
  assert.equal(storage.getItem(CAMPAIGN_BACKUP_KEY), raw);
  assert.equal(JSON.parse(storage.getItem(CAMPAIGN_SAVE_KEY)).schemaVersion, 3);
  assert.equal(migrated.previewImport(raw).ok, true);
  assert.equal(migrated.importSave(raw).ok, true);
  const oldReceipt = legacy.rewardLedger.processedBattleIds.at(-1);
  assert.equal(clear(migrated, 'shu_012', { battleId: oldReceipt }).reason, 'already_settled');
});

test('schema 3 validates technology, unique ownership, nullable slots, fixed signature qualities and loot receipts before importing', () => {
  const { store } = fixture();
  clear(store);
  const before = store.exportSave();
  const corruptions = [
    save => { save.technology.archer = 2; },
    save => { save.technology.fire_oil = 1; },
    save => { save.technology.archer = 0.5; },
    save => { save.nextEquipmentSequence = 0; },
    save => { save.inventory.at(-1).quality = 'gold'; },
    save => { save.inventory.at(-1).templateId = 'signature_guan_yu_weapon'; },
    save => { save.inventory.at(-1).equippedHeroId = 'guan_yu'; },
    save => { save.heroes.guan_yu.equipmentIds.weapon = save.inventory.at(-1).itemInstanceId; },
    save => { save.rewardLedger.transactions.at(-1).loot.quality = 'gold'; },
    save => { save.rewardLedger.transactions.at(-1).loot.item.equippedHeroId = 'guan_yu'; },
  ];
  for (const corrupt of corruptions) {
    const invalid = JSON.parse(before);
    corrupt(invalid);
    assert.equal(store.importSave(JSON.stringify(invalid)).ok, false);
    assert.equal(store.exportSave(), before);
  }
});
