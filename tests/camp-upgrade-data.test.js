import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { BALANCE as B } from '../runtime-data.js';
import { loadDesignData, validateDesignData } from '../scripts/validate-v1-design.mjs';

const cards = Object.values(B.campUpgrades).flatMap(group => group.upgrades);
const added = cards.filter(card => !B.tactics[card.id]);
const byId = Object.fromEntries(cards.map(card => [card.id, card]));
const legacyIds = ['archer_pierce', 'archer_volley', 'archer_hunt', 'shield_grasp', 'shield_reach', 'shield_break',
  'catapult_blast', 'catapult_shock', 'catapult_siege', 'crossbow_precision', 'crossbow_pierce', 'crossbow_range',
  'fire_oil_spread', 'fire_oil_heat', 'fire_oil_slow', 'war_drum_reach', 'war_drum_vigor', 'war_drum_ward'];

test('P2 source contains six seven-card specializations, 24 additions and 128 distinct P0–P2 cards', async () => {
  const source = JSON.parse(await readFile(new URL('../docs/v1/data/balance.json', import.meta.url), 'utf8'));
  assert.deepEqual(B.campUpgrades, source.v1Baseline.campUpgrades);
  assert.deepEqual(Object.keys(B.campUpgrades).sort(), Object.keys(B.camps).sort());
  assert.equal(cards.length, 42);
  assert.equal(new Set(cards.map(card => card.id)).size, 42);
  assert.equal(added.length, 24);
  const p1 = Object.fromEntries([...Object.entries(B.tactics), ...Object.values(B.heroUpgrades).flatMap(group => group.upgrades).map(card => [card.id, card])]);
  const p2 = Object.fromEntries([...Object.entries(p1), ...cards.map(card => [card.id, card])]);
  assert.equal(Object.keys(B.tactics).length, 48);
  assert.equal(Object.keys(p1).length, 104);
  assert.equal(Object.keys(p2).length, 128);
  assert.equal(Object.values(p2).filter(card => card.category === 'camp').length, 42);
});

test('each camp preserves its three original cards and adds two rare, one epic and one legendary', () => {
  for (const [campId, group] of Object.entries(B.campUpgrades)) {
    assert.equal(group.upgrades.length, 7);
    const additions = group.upgrades.filter(card => !B.tactics[card.id]);
    assert.deepEqual(additions.map(card => card.rarity).sort(), ['epic', 'legendary', 'rare', 'rare']);
    for (const card of group.upgrades) {
      assert.equal(card.camp, campId);
      assert.equal(card.category, 'camp');
      assert.equal(card.repeatable, false);
      assert.equal(card.decay, 1);
      assert.equal(typeof card.description, 'string');
      assert.ok(card.description.length);
      assert.ok(Object.keys(card.effects).length);
      if (!B.tactics[card.id]) { assert.equal(card.endlessOnly, true); assert.equal(card.hero, null); }
    }
  }
  assert.deepEqual(cards.filter(card => B.tactics[card.id]).map(card => card.id).sort(), [...legacyIds].sort());
  for (const id of legacyIds) {
    assert.equal(byId[id].id, id);
    for (const key of Object.keys(B.tactics[id])) assert.deepEqual(byId[id][key], B.tactics[id][key]);
    assert.equal(B.tactics[id].description, undefined, 'readable copy belongs to the specialization index');
    assert.equal(B.tactics[id].endlessOnly, undefined);
  }
});

test('all new camp card names use the appendix corrections', () => {
  assert.equal(byId.catapult_thunder_cart.name, '霹雳连车');
  assert.equal(byId.crossbow_divine.name, '蹶张神射');
  assert.equal(byId.fire_oil_fierce.name, '膏油猛火');
  assert.equal(byId.fire_oil_embers.name, '余烬燎原');
  assert.equal(byId.war_drum_resound.name, '鼓角齐鸣');
  for (const card of added) assert.doesNotMatch(card.name, /辕门射戟|襄阳炮|破阵乐|猛火油柜|赤壁余烬/);
});

test('specialization overrides remain local data and leave campaign caps unchanged', () => {
  assert.equal(B.camps.catapult.damageTargetCap, 6);
  assert.equal(B.camps.catapult.controlTargetCap, null);
  assert.equal(B.modifierRules.campAttackHitBudgets.catapult.tacticsNeverIncreaseDamageCap, true);
  assert.equal(byId.catapult_collapse.effects.damageTargetCapOverride, 10);
  assert.equal(B.camps.shield.minimumSpeedFactor, .3);
  assert.equal(B.modifierRules.slowMinimumSpeedFactor, .3);
  assert.equal(byId.shield_iron_order.effects.shieldMinimumSpeedFactor, .22);
  assert.equal(B.camps.war_drum.globalAttackSpeedBonusCap, .3);
  assert.equal(byId.war_drum_first.effects.globalAttackSpeedBonusCapOverride, .45);
  assert.equal(B.camps.fire_oil.maxFieldsPerCamp, 1);
  assert.equal(byId.fire_oil_embers.effects.maxFieldsPerCampOverride, 2);
});

test('multi-target, percentage, root and aura specifications carry their numerical contracts', () => {
  assert.deepEqual(byId.archer_multishot.effects, { extraAttackTargets: 2, extraAttackTargetDamageMultiplier: .6, attackUniqueTargetCap: 3 });
  assert.match(byId.archer_multishot.runtimeNotes, /三个唯一/);
  assert.deepEqual(byId.crossbow_armor_cone.effects, { maxHpBonusDamageFraction: .03, maxHpBonusEnemyTypes: ['siege', 'boss'] });
  assert.match(byId.crossbow_armor_cone.runtimeNotes, /不被/);
  assert.match(byId.crossbow_armor_cone.runtimeNotes, /35%/);
  assert.deepEqual(byId.shield_eight_gates.effects, { rootDurationSec: 1, rootCooldownPerEnemySec: 6 });
  assert.deepEqual(byId.catapult_oil_shell.effects, { impactFireDamagePerSec: 12, impactFireDurationSec: 3, impactFireTickSec: 1 });
  assert.deepEqual(byId.fire_oil_scorch.effects, { exitBurnDurationSec: 2, exitBurnTickSec: 1, exitBurnTickDamageMultiplier: .5 });
  assert.equal(byId.war_drum_resound.effects.ultimateAuraMultiplier, 2);
  assert.equal(byId.war_drum_resound.effects.ultimateAuraDurationSec, 5);
  assert.match(byId.war_drum_resound.runtimeNotes, /鼓源/);
  assert.match(byId.war_drum_resound.runtimeNotes, /30%或45%/);
});

test('camp data validation rejects missing groups, bad references, duplicate IDs and changed legacy effects', async () => {
  const baseline = await loadDesignData();
  assert.equal(validateDesignData(baseline.balance, baseline.campaign).ok, true);
  const cases = [
    data => { delete data.v1Baseline.campUpgrades.archer; },
    data => { data.v1Baseline.campUpgrades.archer.upgrades[3].camp = 'missing_camp'; },
    data => { data.v1Baseline.campUpgrades.archer.upgrades[4].id = data.v1Baseline.campUpgrades.archer.upgrades[3].id; },
    data => { data.v1Baseline.campUpgrades.archer.upgrades[0].effects.extraTargets = 99; },
    data => { data.v1Baseline.campUpgrades.archer.upgrades[3].endlessOnly = false; },
    data => { data.v1Baseline.campUpgrades.archer.upgrades[3].rarity = 'common'; }
  ];
  for (const mutate of cases) {
    const balance = structuredClone(baseline.balance); mutate(balance);
    const result = validateDesignData(balance, baseline.campaign);
    assert.equal(result.ok, false);
    assert.ok(result.errors.some(message => message.startsWith('campUpgrades')));
  }
});
