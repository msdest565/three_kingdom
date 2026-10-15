import test from 'node:test';
import assert from 'node:assert/strict';
import { CampaignStore, EQUIPMENT_SLOTS } from '../campaign-state.js';
import { BALANCE } from '../runtime-data.js';
import { V1Game } from '../v1-engine.js';
import { displayHeroPower, heroCombatStats, equipmentPreparation, runEquipmentPreparation } from '../hero-presentation.js';

function fixture(levels = [0, 0, 0, 0]) {
  const memory = new Map();
  const store = new CampaignStore({ storage: { getItem: key => memory.get(key) ?? null, setItem: (key, value) => memory.set(key, String(value)) } });
  store.state.resources = { experience_book: 100, copper_coin: 100000, refined_iron: 10000 };
  for (const [index, slot] of EQUIPMENT_SLOTS.entries()) store.state.inventory.find(item => item.itemInstanceId === store.state.heroes.guan_yu.equipmentIds[slot]).level = levels[index];
  return store;
}

test('display power responds to level, skill and every equipment slot without entering the save', () => {
  const store = fixture();
  const hero = store.getHero('guan_yu'), before = store.exportSave(), baseline = displayHeroPower(hero);
  assert.ok(displayHeroPower({ ...hero, level: hero.level + 1 }) > baseline);
  assert.ok(displayHeroPower({ ...hero, skillLevel: hero.skillLevel + 1 }) > baseline);
  for (const slot of EQUIPMENT_SLOTS) {
    const higher = structuredClone(hero); higher.equipment[slot].level++;
    assert.ok(displayHeroPower(higher) > baseline, `${slot} strengthening contributes to power`);
    const absent = structuredClone(hero); absent.equipment[slot] = null;
    assert.ok(displayHeroPower(absent) < baseline, `${slot} equipment contributes to power`);
  }
  assert.equal(store.exportSave(), before, 'display statistics never mutate the saved account');
});

test('detail combat attributes match the engine for all fifteen heroes with ordinary and signature equipment', () => {
  const templates = BALANCE.metaProgression.equipment.templates;
  for (const heroId of Object.keys(BALANCE.heroes)) {
    const hero = { heroId, level: 20, skillLevel: 4, equipment: {} };
    for (const slot of EQUIPMENT_SLOTS) {
      const exclusive = Object.values(templates).find(item => item.exclusiveHeroId === heroId && item.slot === slot);
      hero.equipment[slot] = { slot, templateId: exclusive?.id || `basic_${slot}`, quality: exclusive?.quality || (exclusive ? 'red' : 'purple'), level: 7 };
    }
    const before = JSON.stringify(hero), game = new V1Game({ party: [hero] }), unit = game.heroes[0];
    assert.deepEqual(heroCombatStats(hero), {
      attack: unit.definition.attack.damage * game.heroDamageMultiplier(unit),
      range: game.heroBasicRange(unit), interval: unit.definition.attack.intervalSec, gate: game.teamArmor, camp: game.teamCommand,
    }, heroId);
    assert.equal(JSON.stringify(hero), before, `${heroId} preview does not change input equipment`);
  }
});

test('one-click preparation quotes existing costs, upgrades each eligible slot once, and charges their exact sum', () => {
  const store = fixture([3, 0, 2, 1]), before = structuredClone(store.state), plan = equipmentPreparation(store, 'guan_yu');
  const quotes = EQUIPMENT_SLOTS.map(slot => ({ slot, quote: store.getEquipmentUpgradeCost('guan_yu', slot) })).sort((a, b) => a.quote.cost.copper_coin - b.quote.cost.copper_coin);
  assert.deepEqual(plan.steps.map(step => step.slot), quotes.map(step => step.slot), 'cheapest slots go first');
  assert.equal(plan.count, 4);
  for (const key of Object.keys(before.resources)) assert.equal(plan.cost[key], quotes.reduce((sum, step) => sum + step.quote.cost[key], 0));
  assert.deepEqual(store.state, before, 'quoting never changes inventory, resources or revision');
  const result = runEquipmentPreparation(store, 'guan_yu');
  assert.deepEqual(result.upgraded, quotes.map(step => step.slot));
  for (const slot of EQUIPMENT_SLOTS) {
    const id = before.heroes.guan_yu.equipmentIds[slot], old = before.inventory.find(item => item.itemInstanceId === id);
    assert.equal(store.getHero('guan_yu').equipment[slot].level, old.level + 1);
  }
  for (const key of Object.keys(before.resources)) assert.equal(store.state.resources[key], before.resources[key] - plan.cost[key]);
});

test('one-click preparation stops at the first unaffordable slot without partially charging copper or iron', () => {
  for (const constrained of ['copper_coin', 'refined_iron']) {
    const store = fixture([3, 0, 2, 1]), plan = equipmentPreparation(store, 'guan_yu');
    store.state.resources[constrained] = plan.steps[0].quote.cost[constrained] + plan.steps[1].quote.cost[constrained] - 1;
    const before = structuredClone(store.state), result = runEquipmentPreparation(store, 'guan_yu');
    assert.equal(result.count, 4); assert.deepEqual(result.upgraded, [plan.steps[0].slot]);
    for (const key of Object.keys(before.resources)) assert.equal(store.state.resources[key], before.resources[key] - plan.steps[0].quote.cost[key]);
    for (const step of plan.steps.slice(1)) {
      const old = before.inventory.find(item => item.itemInstanceId === before.heroes.guan_yu.equipmentIds[step.slot]);
      assert.equal(store.getHero('guan_yu').equipment[step.slot].level, old.level, `${constrained}: later ${step.slot} unchanged`);
    }
  }
});

test('one-click preparation skips maxed slots, and a fully maxed loadout is a non-mutating empty plan', () => {
  const maximum = BALANCE.metaProgression.equipment.levelMax, store = fixture([maximum, 0, maximum, maximum]);
  const plan = equipmentPreparation(store, 'guan_yu');
  assert.equal(plan.count, 1); assert.deepEqual(plan.steps.map(step => step.slot), ['armor']);
  assert.deepEqual(runEquipmentPreparation(store, 'guan_yu').upgraded, ['armor']);
  for (const item of store.state.inventory.filter(item => item.equippedHeroId === 'guan_yu')) item.level = maximum;
  const before = store.exportSave();
  assert.equal(equipmentPreparation(store, 'guan_yu').count, 0);
  assert.deepEqual(runEquipmentPreparation(store, 'guan_yu').upgraded, []);
  assert.equal(store.exportSave(), before);
});

test('smart preparation equips a matching idle signature and leaves another hero’s equipment in place', () => {
  const store = fixture();
  store.state.inventory.push({ itemInstanceId: 'idle-signature', templateId: 'signature_guan_yu_weapon', slot: 'weapon', quality: 'gold', level: 0, equippedHeroId: null });
  const otherId = store.state.heroes.cao_cao.equipmentIds.weapon;
  const other = store.state.inventory.find(item => item.itemInstanceId === otherId); other.quality = 'red'; other.level = 10;
  const plan = equipmentPreparation(store, 'guan_yu');
  assert.equal(plan.moves.find(move => move.slot === 'weapon').item.itemInstanceId, 'idle-signature');
  const result = runEquipmentPreparation(store, 'guan_yu');
  assert.equal(result.equipped, 1);
  assert.equal(store.getHero('guan_yu').equipment.weapon.itemInstanceId, 'idle-signature');
  assert.equal(store.getHero('guan_yu').equipment.weapon.level, 1);
  assert.equal(store.getHero('cao_cao').equipment.weapon.itemInstanceId, otherId);
});
