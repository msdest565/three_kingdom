import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { BALANCE as B } from '../runtime-data.js';
import { loadDesignData, validateDesignData } from '../scripts/validate-v1-design.mjs';

const cards = B.synergyUpgrades;
const byId = Object.fromEntries(cards.map(card => [card.id, card]));
const heroCards = Object.values(B.heroUpgrades).flatMap(group => group.upgrades);
const campCards = Object.values(B.campUpgrades).flatMap(group => group.upgrades);

test('P3 source contains four synergies, eight cards and eight combos; the complete catalog has 136 cards', async () => {
  const source = JSON.parse(await readFile(new URL('../docs/v1/data/balance.json', import.meta.url), 'utf8'));
  for (const field of ['synergies', 'synergyUpgrades', 'heroCombos', 'comboRuntimeRules']) assert.deepEqual(B[field], source.v1Baseline[field]);
  assert.equal(Object.keys(B.synergies).length, 4);
  assert.equal(cards.length, 8);
  assert.equal(B.heroCombos.length, 8);
  const p1 = { ...B.tactics, ...Object.fromEntries(heroCards.map(card => [card.id, card])) };
  const p2 = { ...p1, ...Object.fromEntries(campCards.map(card => [card.id, card])) };
  const p3 = { ...p2, ...byId };
  assert.equal(Object.keys(B.tactics).length, 48);
  assert.equal(Object.keys(p1).length, 104);
  assert.equal(Object.keys(p2).length, 128);
  assert.equal(Object.keys(p3).length, 136);
  assert.deepEqual(Object.values(p3).reduce((counts, card) => ({ ...counts, [card.category]: (counts[card.category] || 0) + 1 }), {}), { camp: 42, hero: 60, attribute: 26, synergy: 8 });
});

test('corrected synergy names and roster conditions match the approved party rules', () => {
  assert.deepEqual(Object.keys(B.synergies).sort(), ['taoyuan', 'weiwu_xiongfeng', 'jiangdong_huchen', 'wolong_zhonghu'].sort());
  assert.deepEqual(B.synergies.taoyuan.members, ['liu_bei', 'guan_yu', 'zhang_fei']);
  assert.equal(B.synergies.taoyuan.requireAll, true);
  assert.equal(B.synergies.weiwu_xiongfeng.name, '魏武雄风');
  assert.equal(B.synergies.weiwu_xiongfeng.minMembers, 3);
  assert.equal(B.synergies.weiwu_xiongfeng.requireAll, false);
  assert.deepEqual([...B.synergies.weiwu_xiongfeng.members].sort(), Object.keys(B.heroes).filter(id => B.heroes[id].faction === 'wei').sort());
  assert.equal(B.synergies.jiangdong_huchen.name, '江东虎臣');
  assert.equal(B.synergies.jiangdong_huchen.minMembers, 2);
  assert.equal(B.synergies.jiangdong_huchen.requireAll, false);
  assert.deepEqual([...B.synergies.jiangdong_huchen.members].sort(), Object.keys(B.heroes).filter(id => B.heroes[id].faction === 'wu').sort());
  assert.equal(B.synergies.wolong_zhonghu.name, '卧龙冢虎');
  assert.deepEqual(B.synergies.wolong_zhonghu.members, ['zhuge_liang', 'sima_yi']);
  assert.equal(B.synergies.wolong_zhonghu.requireAll, true);
});

test('all synergy cards are conditional, unique and nonrepeatable with the prescribed rarity mix', () => {
  assert.equal(new Set(cards.map(card => card.id)).size, 8);
  assert.deepEqual(cards.map(card => card.rarity).sort(), ['epic', 'epic', 'epic', 'epic', 'legendary', 'rare', 'rare', 'rare']);
  for (const card of cards) {
    assert.equal(card.category, 'synergy');
    assert.equal(card.repeatable, false); assert.equal(card.decay, 1); assert.equal(card.endlessOnly, true);
    assert.equal(card.hero, null); assert.equal(card.camp, null);
    assert.ok(card.description && card.runtimeNotes && Object.keys(card.effects).length);
  }
  for (const [id, synergy] of Object.entries(B.synergies)) assert.equal(byId[synergy.bonusUpgradeId].requiredSynergy, id);
  assert.deepEqual(byId.synergy_jiangdong_huchen.requiredHeroes, ['zhou_yu', 'gan_ning']);
  assert.equal(byId.synergy_three_hearts.requiredPartySize, 3);
  assert.equal(byId.synergy_comrades.requiredSameFactionCount, 2);
  assert.equal(byId.synergy_four_corners.requiredPartySize, 3);
  assert.equal(byId.synergy_four_corners.requiredDistinctFactions, 3);
  for (const field of ['requiredSynergy', 'requiredHeroes', 'requiredPartySize', 'requiredSameFactionCount', 'requiredDistinctFactions']) assert.equal(byId.synergy_combo_mastery[field], undefined, 'combo mastery remains eligible for any party');
  assert.equal(B.endless.categoryWeights.synergy, 6);
});

test('rage cycles, additive army damage and independent legendary/target multipliers have explicit contracts', () => {
  assert.equal(B.synergies.taoyuan.effects.ultimateCooldownMultiplier, .85);
  assert.match(B.synergies.taoyuan.runtimeNotes, /恢复期乘0.85/);
  assert.match(B.synergies.taoyuan.runtimeNotes, /怒气获取率除0.85/);
  assert.equal(byId.synergy_taoyuan.effects.allyRageOnUltimate, 15);
  assert.equal(B.synergies.weiwu_xiongfeng.effects.eliteAndBossDamageBonus, .15);
  assert.deepEqual(B.synergies.jiangdong_huchen.effects.affectedHeroIds, ['zhou_yu', 'gan_ning', 'taishi_ci']);
  assert.equal(B.synergies.jiangdong_huchen.effects.fireArrowUltimateRangeMultiplier, 1.12);
  assert.equal(byId.synergy_three_hearts.effects.armyDamageBonus, .12);
  assert.match(byId.synergy_three_hearts.runtimeNotes, /加法池/);
  assert.equal(byId.synergy_four_corners.effects.armyDamageBonusPerFaction, .15);
  assert.match(byId.synergy_four_corners.runtimeNotes, /独立乘区/);
  assert.match(byId.synergy_four_corners.runtimeNotes, /1.45/);
  assert.equal(new Set(['zhuge_liang', 'sima_yi', 'zhou_yu'].map(id => B.heroes[id].faction)).size, 3);
  assert.match(byId.synergy_four_corners.runtimeNotes, /卧龙冢虎并存/);
  assert.equal(B.synergies.wolong_zhonghu.effects.slowedEnemyIncomingDamageBonus, .2);
  assert.deepEqual(byId.synergy_wolong_zhonghu.effects, { thunderVulnerabilityMultiplier: 1.2, thunderVulnerabilityDurationSec: 3, stackWindThunderVulnerability: true });
  assert.match(byId.synergy_wolong_zhonghu.runtimeNotes, /1.44/);
  assert.match(byId.synergy_wolong_zhonghu.runtimeNotes, /1.8/);
});

test('all eight directed combo pairs use corrected names and share combat-clock 2/4-second, 3/5-use limits', () => {
  const expected = [
    ['combo_east_wind', '借东风', 'zhuge_liang', 'zhou_yu'],
    ['combo_righteous_sky', '义薄云天', 'liu_bei', 'guan_yu'],
    ['combo_changban_guard', '长坂坡守卫', 'zhang_fei', 'zhao_yun'],
    ['combo_thunder_rain', '雷海箭雨', 'sima_yi', 'gan_ning'],
    ['combo_tiger_command', '虎卫号令', 'xu_chu', 'cao_cao'],
    ['combo_divine_cavalry', '神箭突骑', 'taishi_ci', 'zhang_liao'],
    ['combo_chibi_fire', '火烧赤壁', 'sun_quan', 'zhou_yu'],
    ['combo_one_eye_tiger', '独眼虎痴', 'xiahou_dun', 'xu_chu']
  ];
  assert.deepEqual(B.heroCombos.map(combo => [combo.id, combo.name, combo.from, combo.to]), expected);
  for (const combo of B.heroCombos) assert.ok(B.heroes[combo.from] && B.heroes[combo.to] && combo.from !== combo.to);
  assert.deepEqual([B.comboRuntimeRules.windowSec, B.comboRuntimeRules.maxPerRun, B.comboRuntimeRules.masterWindowSec, B.comboRuntimeRules.masterMaxPerRun], [2, 3, 4, 5]);
  assert.equal(B.comboRuntimeRules.clock, 'combat');
  assert.deepEqual(byId.synergy_combo_mastery.effects, { comboWindowSecOverride: 4, comboMaxPerRunOverride: 5 });
  assert.match(B.comboRuntimeRules.runtimeNotes, /真实命中/);
  assert.match(B.comboRuntimeRules.runtimeNotes, /全部八组共享/);
});

test('combo effects specify length-only wind, bounded extra hits and snapshot compensation', () => {
  const byCombo = Object.fromEntries(B.heroCombos.map(combo => [combo.id, combo]));
  assert.deepEqual(byCombo.combo_east_wind.effects, { responderLengthMultiplier: 1.5, rangeBoostDurationSec: 2 });
  assert.match(byCombo.combo_east_wind.runtimeNotes, /不同时放大宽度/);
  assert.equal(byCombo.combo_righteous_sky.effects.combinedDamageMultiplier, 1.4);
  assert.match(byCombo.combo_righteous_sky.runtimeNotes, /0.4倍实际伤害快照/);
  assert.deepEqual(byCombo.combo_changban_guard.effects, { initiatorPushbackMultiplier: 1.8, responderPassCount: 5, guaranteeAllPassesHit: true });
  assert.deepEqual(byCombo.combo_thunder_rain.effects, { thunderCrossShape: true, coverageMultiplier: 1.4 });
  assert.match(byCombo.combo_thunder_rain.runtimeNotes, /最多一次/);
  assert.deepEqual(byCombo.combo_tiger_command.effects, { campRangeMultiplier: 1.5, campRangeDurationSec: 2 });
  assert.deepEqual(byCombo.combo_divine_cavalry.effects, { responderDamageMultiplier: 1.6, guaranteeMarkedBossHit: true });
  assert.deepEqual(byCombo.combo_chibi_fire.effects, { initiatorDamageMultiplier: 2, burnDurationSec: 4 });
  assert.match(byCombo.combo_chibi_fire.runtimeNotes, /周瑜本次P1快照/);
  assert.match(byCombo.combo_chibi_fire.runtimeNotes, /伤害归属发起孙权/);
  assert.equal(byCombo.combo_one_eye_tiger.effects.overlapDamageMultiplier, 1.5);
  assert.match(B.comboRuntimeRules.runtimeNotes, /不重吃/);
  assert.match(B.comboRuntimeRules.runtimeNotes, /不补伤已死亡目标/);
  assert.match(B.comboRuntimeRules.runtimeNotes, /不穿透当前无敌/);
});

test('production validation rejects invalid P3 references, duplicate pairs and changed runtime limits', async () => {
  const baseline = await loadDesignData();
  assert.equal(validateDesignData(baseline.balance, baseline.campaign).ok, true);
  const cases = [
    [data => { delete data.v1Baseline.synergies.wolong_zhonghu; }, 'synergies'],
    [data => { data.v1Baseline.synergies.taoyuan.members[0] = 'missing_hero'; }, 'synergies'],
    [data => { data.v1Baseline.synergies.taoyuan.bonusUpgradeId = 'missing_card'; }, 'synergies'],
    [data => { data.v1Baseline.synergyUpgrades[0].requiredSynergy = 'missing_synergy'; }, 'synergyUpgrades'],
    [data => { data.v1Baseline.synergyUpgrades[2].requiredHeroes[0] = 'missing_hero'; }, 'synergyUpgrades'],
    [data => { data.v1Baseline.synergyUpgrades[0].repeatable = true; }, 'synergyUpgrades'],
    [data => { data.v1Baseline.heroCombos[1].from = data.v1Baseline.heroCombos[0].from; data.v1Baseline.heroCombos[1].to = data.v1Baseline.heroCombos[0].to; }, 'heroCombos'],
    [data => { data.v1Baseline.heroCombos[0].to = 'missing_hero'; }, 'heroCombos'],
    [data => { data.v1Baseline.comboRuntimeRules.windowSec = 9; }, 'comboRuntimeRules']
  ];
  for (const [mutate, label] of cases) {
    const balance = structuredClone(baseline.balance); mutate(balance);
    const result = validateDesignData(balance, baseline.campaign);
    assert.equal(result.ok, false);
    assert.ok(result.errors.some(message => message.startsWith(label)));
  }
});
