import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { BALANCE as B, CONTENT } from '../runtime-data.js';
import * as reference from '../docs/data/endless-curve.mjs';
import * as endless from '../endless-rules.js';

const legacyCampLevels = {
  shield: [{ level: 1, upgradeCost: 0, damage: 4, intervalSec: 1.8, range: 145, maxTargets: 3, speedFactor: .46 }, { level: 2, upgradeCost: 90, damage: 5, intervalSec: 1.7, range: 154, maxTargets: 3, speedFactor: .42 }, { level: 3, upgradeCost: 150, damage: 6, intervalSec: 1.6, range: 163, maxTargets: 3, speedFactor: .38 }],
  archer: [{ level: 1, upgradeCost: 0, damage: 12, intervalSec: .9, range: 205, maxTargets: 1 }, { level: 2, upgradeCost: 90, damage: 18, intervalSec: .81, range: 214, maxTargets: 1 }, { level: 3, upgradeCost: 150, damage: 26, intervalSec: .72, range: 223, maxTargets: 1 }],
  catapult: [{ level: 1, upgradeCost: 0, damage: 14, intervalSec: 3, range: 205, blastRadius: 48 }, { level: 2, upgradeCost: 120, damage: 18, intervalSec: 2.85, range: 214, blastRadius: 48 }, { level: 3, upgradeCost: 180, damage: 23, intervalSec: 2.7, range: 223, blastRadius: 48 }],
  crossbow: [{ level: 1, upgradeCost: 0, damage: 20, intervalSec: 1.3, range: 205, maxTargets: 1 }, { level: 2, upgradeCost: 110, damage: 30, intervalSec: 1.17, range: 214, maxTargets: 1 }, { level: 3, upgradeCost: 170, damage: 44, intervalSec: 1.04, range: 223, maxTargets: 1 }],
  fire_oil: [{ level: 1, upgradeCost: 0, tickDamage: 3, intervalSec: 3.6, range: 175, fieldRadius: 58 }, { level: 2, upgradeCost: 120, tickDamage: 4, intervalSec: 3.4, range: 184, fieldRadius: 58 }, { level: 3, upgradeCost: 180, tickDamage: 5, intervalSec: 3.2, range: 193, fieldRadius: 58 }],
  war_drum: [{ level: 1, upgradeCost: 0, range: 180, attackSpeedBonus: .1 }, { level: 2, upgradeCost: 110, range: 190, attackSpeedBonus: .15 }, { level: 3, upgradeCost: 170, range: 200, attackSpeedBonus: .2 }]
};
const legacyTactics = {
  archer_pierce: '穿云箭', archer_volley: '连珠齐射', archer_hunt: '破骑劲弩',
  shield_grasp: '坚壁铁阵', shield_reach: '连营拒马', shield_break: '破阵反击',
  catapult_blast: '霹雳巨石', catapult_shock: '碎石封路', catapult_siege: '摧城破甲',
  guan_yu_width: '青龙展刃', guan_yu_press: '偃月破阵', zhou_yu_radius: '连营火势', zhou_yu_duration: '烈焰余势',
  crossbow_precision: '贯甲强弩', crossbow_pierce: '穿阵劲矢', crossbow_range: '瞭望校射',
  fire_oil_spread: '泼油成阵', fire_oil_heat: '烈火炙甲', fire_oil_slow: '泥油阻路',
  war_drum_reach: '鼓声远传', war_drum_vigor: '振军奋勇', war_drum_ward: '整军固守'
};
const close = (actual, expected, label) => assert.ok(Math.abs(actual - expected) <= Math.max(1, Math.abs(expected)) * 1e-12, `${label}: ${actual} != ${expected}`);

test('endless extends camp data without changing campaign L1–L3, costs or shared caps', () => {
  for (const [id, levels] of Object.entries(legacyCampLevels)) {
    assert.deepEqual(B.camps[id].levels.slice(0, 3), levels, id);
    assert.deepEqual(B.camps[id].levels.map(level => level.level), [1, 2, 3, 4, 5]);
    assert.ok(B.camps[id].levels[4].range > levels[2].range);
  }
  assert.equal(B.camps.fire_oil.fieldDurationSec, 3);
  assert.deepEqual(B.camps.fire_oil.levels.slice(3).map(level => [level.tickDamage, level.intervalSec, level.range, level.fieldRadius, level.fieldDurationSec]), [[7, 3, 202, 64, 3.5], [9, 2.8, 211, 70, 4]]);
  assert.equal(B.camps.catapult.damageTargetCap, 6);
  assert.equal(B.camps.war_drum.globalAttackSpeedBonusCap, .3);
  assert.equal(B.world.gateHp, 100);
  assert.equal(B.tacticSelection.maxStacksPerTactic, 1);
  assert.deepEqual(B.party.enemyHpMultipliersByPartySize, { 1: 1, 2: 1.5, 3: 1.9 });
  assert.deepEqual(B.battleSpeed.allowedMultipliers, [1, 1.5, 2]);
  assert.equal(CONTENT.levels.length, 60);
});

test('all 22 legacy tactic IDs and names survive with metadata only; 26 new attributes repeat', () => {
  const attributes = Object.entries(B.tactics).filter(([, tactic]) => tactic.category === 'attribute');
  assert.equal(attributes.length, 26);
  assert.deepEqual(attributes.reduce((counts, [, tactic]) => ({ ...counts, [tactic.attributeGroup]: (counts[tactic.attributeGroup] || 0) + 1 }), {}), { gate: 8, camp: 10, hero: 8 });
  for (const [id, name] of Object.entries(legacyTactics)) {
    const tactic = B.tactics[id];
    assert.equal(tactic.name, name);
    assert.equal(tactic.repeatable, false);
    assert.equal(tactic.decay, 1);
    assert.equal(tactic.category, tactic.camp ? 'camp' : 'hero');
    assert.deepEqual(Object.keys(tactic).filter(key => !['category', 'rarity', 'repeatable', 'decay'].includes(key)).sort(), ['name', tactic.camp ? 'camp' : 'hero', 'effects'].sort());
  }
  for (const [id, tactic] of attributes) {
    assert.ok(id.startsWith('attr_'));
    assert.equal(tactic.repeatable, true);
    assert.equal(tactic.decay, tactic.attributeGroup === 'gate' ? 1 : .85);
    assert.ok(['common', 'rare', 'epic', 'legendary'].includes(tactic.rarity));
    assert.equal(tactic.camp, null); assert.equal(tactic.hero, null);
  }
  assert.equal(Object.keys(B.tactics).length, 48);
  assert.equal(B.tactics.attr_gate_earth.name, '夯土加厚');
  assert.equal(B.tactics.attr_gate_moat.decay, 1, 'all gate cards follow the explicit no-decay requirement');
});

test('browser curves match the independent numerical reference through and beyond wave 80', () => {
  const functions = ['enemyCount', 'eliteFraction', 'waveDuration', 'bossCount', 'bossHp', 'hpGrowthPerWave', 'speedMultiplier', 'playerDPS', 'waveFood'];
  assert.deepEqual(endless.hpMultiplierTable(150), reference.hpMultiplierTable(150));
  for (let wave = 1; wave <= 150; wave++) {
    for (const name of functions) close(endless[name](wave), reference[name](wave), `${name} wave ${wave}`);
    for (const [key, expected] of Object.entries(reference.waveStats(wave, reference.hpMultiplierTable(150)))) close(endless.waveStats(wave)[key], expected, `${key} wave ${wave}`);
  }
  for (let level = 1; level <= 5; level++) close(endless.campFieldDPS(level), reference.campFieldDPS(level), `camp field DPS Lv${level}`);
  assert.deepEqual(endless.foodTable(80), reference.foodTable(80));
  assert.deepEqual(endless.campUpgradeTotals(), reference.campUpgradeTotals());
  assert.equal(endless.collapseWave(), 80);
  assert.equal(endless.bossCount(20), 1, 'the curve script takes precedence over the old double-boss anchor');
  assert.equal(endless.speedMultiplier(50), 1.245);
  assert.equal(endless.speedMultiplier(51), 1.25);
  assert.equal(endless.campUpgradeTotals().cumulative, 6230);
  assert.equal(endless.foodTable(26).at(-1).cumulative, 6421);
});

test('generated waves preserve exact integer counts, packs, lanes, boss HP and food budgets', () => {
  for (let wave = 1; wave <= 130; wave++) {
    const actual = endless.generateEndlessWave(wave, B.endless, { laneCount: 3 });
    const expected = reference.waveStats(wave);
    assert.equal(actual.count, expected.count);
    assert.equal(Object.values(actual.units).reduce((a, b) => a + b, 0), expected.count);
    const packed = {};
    for (const pack of actual.packs) {
      assert.ok(pack.startSec >= 0 && pack.startSec + pack.durationSec <= actual.spawnWindowSec);
      for (const [type, count] of Object.entries(pack.units)) {
        assert.ok(Number.isInteger(count) && count > 0);
        assert.ok(wave >= B.endless.enemyIntroductionWaves[type]);
        packed[type] = (packed[type] || 0) + count;
      }
    }
    assert.deepEqual(packed, actual.units);
    assert.deepEqual(actual.laneDistribution, [1 / 3, 1 / 3, 1 / 3]);
    assert.equal(actual.hpMultiplier, expected.hpMultiplier);
    assert.equal(actual.bossSpawns.length, expected.bosses);
    for (const boss of actual.bossSpawns) {
      assert.equal(boss.maxHp, expected.bossHp);
      assert.equal(boss.hpMultiplier * B.enemies.boss.hp, expected.bossHp);
      assert.equal(boss.ignoreWaveHpMultiplier, true);
      assert.ok(B.bossTemplates[boss.templateId]);
      assert.ok(boss.lane < 3);
    }
    assert.equal(actual.foodBudget.total, reference.waveFood(wave));
    assert.equal(actual.foodBudget.kills + actual.foodBudget.completion, actual.foodBudget.total);
    assert.ok(Number.isInteger(actual.foodBudget.kills));
    assert.ok(actual.foodBudget.kills >= expected.bosses * 60);
  }
  assert.ok(endless.generateEndlessWave(25).units.siege > 0);
  assert.equal(endless.generateEndlessWave(80).bossSpawns.length, 3);
  assert.equal(endless.generateEndlessWave(90).count, 272);
});

test('endless parameters drive curves and session levels without mutating campaign content', () => {
  const c = structuredClone(B.endless);
  c.hpGrowthSegments[0].perWaveGrowth = .2;
  c.countSegments[0].startValue = 10;
  c.startingFood = 300;
  c.targetWaveCount = 42;
  close(endless.generateEndlessWave(3, c).hpMultiplier, 1.44, 'configured HP growth');
  assert.equal(endless.generateEndlessWave(1, c).count, 10);
  const level = endless.createEndlessLevel(c);
  assert.equal(level.startingFood, 300); assert.equal(level.targetWaveCount, 42);
  assert.equal(level.maxPartySize, 3); assert.equal(level.mapId, 'wei_gate');
  assert.deepEqual(level.waves, []); assert.deepEqual(level.choiceAfterWaves, []);
  assert.ok(CONTENT.maps.some(map => map.id === level.mapId));
  assert.equal(B.endless.startingFood, 120);
  assert.equal(B.endless.targetWaveCount, 80);
  assert.throws(() => endless.generateEndlessWave(0), RangeError);
  assert.throws(() => endless.generateEndlessWave(1.5), RangeError);
  assert.throws(() => endless.generateEndlessWave(1, undefined, { laneCount: 0 }), RangeError);
});

test('the source JSON and generated module agree and legacy derived examples retain Lv3 scope', async () => {
  const source = JSON.parse(await readFile(new URL('../docs/v1/data/balance.json', import.meta.url), 'utf8'));
  assert.deepEqual(B, source.v1Baseline);
  for (const values of Object.values(source.derivedExamples.campDps)) assert.equal(values.length, 3);
  assert.deepEqual(source.derivedExamples.referenceBattleEconomy, { enemyRewardUpperBound: 1259, startingFood: 120, totalFoodUpperBound: 1379, remainingFourBuildCost: 320, sixCampUpgradeCost: 1640, sixCampFullMaxCost: 1960, sixCampFullMaxBudgetDeficit: 581, oneEachPlusMainThreeMaxCost: 1140, remainingFoodAfterMainThreeMax: 239 });
});
