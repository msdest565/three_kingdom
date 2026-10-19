import test from 'node:test';
import assert from 'node:assert/strict';
import { BALANCE as B } from '../runtime-data.js';
import { CampaignStore, CAMPAIGN_SAVE_KEY, SAVE_SCHEMA_VERSION } from '../campaign-state.js';
import { planEndlessMilestones, milestoneQualityWeights } from '../endless-milestones.js';

function storage() {
  const values = new Map();
  return { values, getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, String(value)), removeItem: key => values.delete(key) };
}
function fixture(rng = () => 0, memory = storage()) {
  return { memory, store: new CampaignStore({ storage: memory, now: () => new Date('2026-10-20T03:00:00Z'), rng }) };
}

test('milestone source rewards total 32000 copper, 312 iron, four books and seven chests', () => {
  assert.deepEqual(B.endless.milestones.map(row => row.wave), [10, 20, 30, 40, 50, 60, 70, 80]);
  assert.deepEqual(B.endless.milestones.reduce((total, row) => ({
    copper: total.copper + row.rewards.copper_coin, iron: total.iron + row.rewards.refined_iron,
    books: total.books + row.rewards.experience_book, chests: total.chests + row.chests
  }), { copper: 0, iron: 0, books: 0, chests: 0 }), { copper: 32000, iron: 312, books: 4, chests: 7 });
});

test('schema-3 accounts and waves below ten remain byte-identical with no RNG or revision change', () => {
  let rolls = 0;
  const { store, memory } = fixture(() => { rolls++; throw new Error('unexpected roll'); });
  const before = store.exportSave();
  assert.equal(SAVE_SCHEMA_VERSION, 3);
  assert.equal(store.state.endlessMilestones, undefined);
  assert.deepEqual(store.getEndlessProgress(), { claimedWaves: [], highestMilestoneWave: 0, highestBreakthroughWave: 0, highestClaimedWave: 0 });
  for (const wave of [1, 2, 9]) assert.deepEqual(store.claimEndlessMilestones(wave).claims, []);
  for (const wave of [0, -1, 1.2, NaN, Infinity, '80', 1_000_001, null, undefined]) assert.equal(store.claimEndlessMilestones(wave).reason, 'invalid_endless_wave');
  assert.equal(store.exportSave(), before);
  assert.equal(memory.values.size, 0);
  assert.equal(rolls, 0);
});

test('a jump to wave 80 atomically awards each fixed milestone and its quality-floor chests once', () => {
  let rolls = 0;
  const { store } = fixture(() => { rolls++; return 0; });
  const result = store.claimEndlessMilestones(80);
  assert.equal(result.ok, true); assert.equal(result.persisted, true);
  assert.deepEqual(result.claims.map(claim => claim.wave), [10, 20, 30, 40, 50, 60, 70, 80]);
  assert.deepEqual(store.state.resources, { experience_book: 4, copper_coin: 32000, refined_iron: 312 });
  const loot = result.claims.flatMap(claim => claim.loot);
  assert.deepEqual(loot.map(item => item.quality), ['white', 'blue', 'purple', 'purple', 'red', 'white', 'white']);
  assert.equal(new Set(loot.map(item => item.item.itemInstanceId)).size, 7);
  assert.equal(store.state.inventory.length, 15);
  assert.equal(rolls, 7);
  assert.equal(store.state.revision, 1);
  assert.equal(store.getEndlessProgress().highestClaimedWave, 80);
  const before = store.exportSave();
  assert.deepEqual(store.claimEndlessMilestones(80).claims, []);
  assert.deepEqual(store.claimEndlessMilestones(79).claims, []);
  assert.equal(store.exportSave(), before);
  assert.equal(rolls, 7);
});

test('per-box 80-wave gold odds are at least five percent while the campaign loot table is unchanged', () => {
  const original = structuredClone(B.loot.qualityWeights);
  assert.deepEqual(milestoneQualityWeights('white'), original);
  const weights = milestoneQualityWeights('white', .05);
  assert.equal(Object.values(weights).reduce((sum, value) => sum + value, 0), B.loot.weightScale);
  assert.ok(weights.gold / B.loot.weightScale >= .05);
  for (const minimum of ['blue', 'purple', 'red']) {
    const table = milestoneQualityWeights(minimum);
    assert.equal(Object.values(table).reduce((sum, value) => sum + value, 0), 10000);
    for (const quality of Object.keys(table)) assert.ok(B.metaProgression.equipment.qualityIds.indexOf(quality) >= B.metaProgression.equipment.qualityIds.indexOf(minimum));
  }
  const { store } = fixture(); store.claimEndlessMilestones(70);
  const samples = [.9499, .95, 0]; let index = 0;
  store.rng = () => samples[index++];
  const result = store.claimEndlessMilestones(80);
  assert.deepEqual(result.claims[0].loot.map(loot => loot.quality), ['red', 'gold']);
  assert.equal(result.claims[0].loot[1].templateId, B.loot.goldTemplateIds[0]);
  assert.equal(index, 3);
  assert.deepEqual(B.loot.qualityWeights, original);
  assert.equal(B.loot.goldProbability, .025);
});

test('85+ permanent high-water marks grant 1500 times the increasing step, including skipped thresholds', () => {
  const { store } = fixture(); store.claimEndlessMilestones(80);
  const a = store.claimEndlessMilestones(85);
  assert.equal(a.claims[0].rewards.copper_coin, 1500);
  assert.equal(a.claims[0].kind, 'breakthrough');
  const b = store.claimEndlessMilestones(95);
  assert.deepEqual([b.claims[0].fromWave, b.claims[0].toWave, b.claims[0].claimCount, b.claims[0].rewards.copper_coin], [90, 95, 2, 7500]);
  assert.equal(store.state.resources.copper_coin, 41000);
  assert.equal(store.getEndlessProgress().highestBreakthroughWave, 95);
  assert.equal(store.state.endlessMilestones.receipts.length, 8, 'unbounded breakthroughs do not create an unbounded ledger');
  const before = store.exportSave();
  assert.deepEqual(store.claimEndlessMilestones(94).claims, []);
  assert.equal(store.exportSave(), before);
  const plan = planEndlessMilestones(100, store.state.endlessMilestones);
  assert.equal(plan.breakthrough.copper, 6000);
});

test('large breakthrough jumps use bounded arithmetic and capped resource credit', () => {
  const { store } = fixture();
  const result = store.claimEndlessMilestones(1_000_000);
  assert.equal(result.ok, true);
  assert.equal(result.claims.length, 9);
  assert.equal(store.state.resources.copper_coin, 1_000_000_000);
  assert.equal(store.getEndlessProgress().highestBreakthroughWave, 1_000_000);
  const before = store.exportSave();
  assert.deepEqual(store.claimEndlessMilestones(1_000_000).claims, []);
  assert.equal(store.exportSave(), before);
});

test('refresh and import preserve paid watermarks without rerolling or replaying rewards', () => {
  const { store, memory } = fixture();
  const oldSave = store.exportSave();
  store.claimEndlessMilestones(95);
  const reloaded = fixture(() => { throw new Error('no reroll'); }, memory).store;
  assert.equal(reloaded.getEndlessProgress().highestClaimedWave, 95);
  assert.deepEqual(reloaded.claimEndlessMilestones(95).claims, []);
  assert.equal(reloaded.importSave(oldSave).ok, true);
  assert.equal(reloaded.getEndlessProgress().highestClaimedWave, 95);
  assert.deepEqual(reloaded.state.resources, { experience_book: 0, copper_coin: 0, refined_iron: 0 });
  assert.deepEqual(reloaded.claimEndlessMilestones(95).claims, []);
  const next = reloaded.claimEndlessMilestones(100);
  assert.equal(next.claims[0].rewards.copper_coin, 6000);
  assert.equal(reloaded.state.resources.copper_coin, 6000);
});

test('importing an earlier prefix cannot erase prior chest IDs or cause the next milestone to reuse them', () => {
  const { store } = fixture(); const earlier = store.exportSave();
  const first = store.claimEndlessMilestones(30);
  const firstId = first.claims.at(-1).loot[0].item.itemInstanceId;
  assert.equal(store.importSave(earlier).ok, true);
  assert.equal(store.getEndlessProgress().highestMilestoneWave, 30);
  const next = store.claimEndlessMilestones(40);
  assert.equal(next.ok, true);
  assert.notEqual(next.claims[0].loot[0].item.itemInstanceId, firstId);
  assert.equal(store.state.endlessMilestones.receipts.length, 4);
});

test('a full inventory salvages only the newly rolled item and stores its permanent receipt', () => {
  const { store } = fixture();
  while (store.state.inventory.length < B.metaProgression.equipment.inventoryMax) store.state.inventory.push({ itemInstanceId: `full:${store.state.inventory.length}`, templateId: 'basic_weapon', slot: 'weapon', quality: 'white', level: 0, equippedHeroId: null });
  const result = store.claimEndlessMilestones(30);
  assert.equal(result.ok, true);
  assert.equal(store.state.inventory.length, B.metaProgression.equipment.inventoryMax);
  const loot = result.claims.at(-1).loot[0];
  assert.equal(loot.salvaged, true);
  assert.deepEqual(loot.salvageResources, { experience_book: 0, copper_coin: 24, refined_iron: 1 });
  assert.deepEqual(store.state.resources, { experience_book: 4, copper_coin: 3824, refined_iron: 31 });
  assert.equal(store.state.inventory.some(item => item.itemInstanceId === loot.item.itemInstanceId), false);
  const before = store.exportSave(); assert.deepEqual(store.claimEndlessMilestones(30).claims, []); assert.equal(store.exportSave(), before);
});

test('invalid RNG leaves resources, chests, IDs and every receipt completely unchanged', () => {
  const { store } = fixture(); store.claimEndlessMilestones(20);
  const before = store.exportSave(); store.rng = () => NaN;
  assert.equal(store.claimEndlessMilestones(80).reason, 'invalid_loot_rng');
  assert.equal(store.exportSave(), before);
  const samples = [0, NaN]; let index = 0; store.rng = () => samples[index++];
  assert.equal(store.claimEndlessMilestones(50).reason, 'invalid_loot_rng');
  assert.equal(store.exportSave(), before);
});

test('malformed optional milestone progress is rejected without changing the current save', () => {
  const { store } = fixture(); store.claimEndlessMilestones(80);
  const before = store.exportSave();
  const corruptions = [
    value => { value.endlessMilestones = null; },
    value => { value.endlessMilestones.claimedWaves = []; },
    value => { value.endlessMilestones.claimedWaves[0] = 20; },
    value => { value.endlessMilestones.highestBreakthroughWave = 81; },
    value => { value.endlessMilestones.receipts.pop(); },
    value => { value.endlessMilestones.receipts[0].rewards.copper_coin = 801; },
    value => { value.endlessMilestones.receipts[3].loot[0].item.quality = 'white'; value.endlessMilestones.receipts[3].loot[0].quality = 'white'; },
    value => { value.endlessMilestones.receipts[4].loot[0].item.itemInstanceId = value.endlessMilestones.receipts[2].loot[0].item.itemInstanceId; }
  ];
  for (const corrupt of corruptions) {
    const value = JSON.parse(before); corrupt(value);
    assert.equal(store.previewImport(JSON.stringify(value)).ok, false);
    assert.equal(store.importSave(JSON.stringify(value)).ok, false);
    assert.equal(store.exportSave(), before);
  }
});

test('stale tabs cannot roll or pay an achievement already committed by another tab', () => {
  const { store, memory } = fixture(); store.save();
  let rolls = 0; const stale = fixture(() => { rolls++; return 0; }, memory).store;
  assert.equal(store.claimEndlessMilestones(30).ok, true);
  const before = stale.exportSave(), persisted = memory.getItem(CAMPAIGN_SAVE_KEY);
  assert.equal(stale.claimEndlessMilestones(30).reason, 'stale_save_revision');
  assert.equal(stale.exportSave(), before);
  assert.equal(memory.getItem(CAMPAIGN_SAVE_KEY), persisted);
  assert.equal(rolls, 0);
});

test('a competing transaction during loot generation aborts the new claim before commit', () => {
  const { store, memory } = fixture(); store.save();
  const competitor = fixture(() => 0, memory).store;
  let invoked = false;
  store.rng = () => { if (!invoked) { invoked = true; assert.equal(competitor.claimEndlessMilestones(30).ok, true); } return 0; };
  const before = store.exportSave();
  assert.equal(store.claimEndlessMilestones(30).reason, 'stale_save_revision');
  assert.equal(store.exportSave(), before);
  assert.equal(JSON.parse(memory.getItem(CAMPAIGN_SAVE_KEY)).resources.copper_coin, 3800);
});

test('a reviewed import that lowers a persisted revision still invalidates another tab', () => {
  const { store, memory } = fixture(); store.save();
  const earlier = store.exportSave(), high = JSON.parse(earlier); high.revision = 200;
  memory.setItem(CAMPAIGN_SAVE_KEY, JSON.stringify(high));
  let rolls = 0; const stale = fixture(() => { rolls++; return 0; }, memory).store;
  assert.equal(store.importSave(earlier).ok, true);
  assert.equal(stale.claimEndlessMilestones(30).reason, 'stale_save_revision');
  assert.equal(rolls, 0);
});

test('failed persistence retains the in-session receipt and future-schema saves remain read-only', () => {
  const { store, memory } = fixture();
  memory.setItem = () => { throw new Error('full'); };
  const result = store.claimEndlessMilestones(10);
  assert.equal(result.ok, true); assert.equal(result.persisted, false);
  assert.equal(store.getEndlessProgress().highestMilestoneWave, 10);
  assert.deepEqual(store.claimEndlessMilestones(10).claims, []);
  const future = storage(); const raw = JSON.stringify({ schemaVersion: 99, untouched: true }); future.setItem(CAMPAIGN_SAVE_KEY, raw);
  const protectedStore = fixture(() => 0, future).store;
  assert.equal(protectedStore.claimEndlessMilestones(80).reason, 'save_read_only');
  assert.equal(future.getItem(CAMPAIGN_SAVE_KEY), raw);
});
