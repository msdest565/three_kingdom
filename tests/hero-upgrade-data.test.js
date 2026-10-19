import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { BALANCE as B } from '../runtime-data.js';
import { loadDesignData, validateDesignData } from '../scripts/validate-v1-design.mjs';

const cards = Object.values(B.heroUpgrades).flatMap(group => group.upgrades);
const byId = Object.fromEntries(cards.map(card => [card.id, card]));
const preserved = ['guan_yu_width', 'guan_yu_press', 'zhou_yu_radius', 'zhou_yu_duration'];
const merged = Object.fromEntries([...Object.entries(B.tactics), ...cards.map(card => [card.id, card])]);

test('P1 stores all sixty hero cards in source data while preserving the existing 48-card table', async () => {
  const source = JSON.parse(await readFile(new URL('../docs/v1/data/balance.json', import.meta.url), 'utf8'));
  assert.deepEqual(B.heroUpgrades, source.v1Baseline.heroUpgrades);
  assert.deepEqual(Object.keys(B.heroUpgrades).sort(), Object.keys(B.heroes).sort());
  assert.equal(Object.keys(B.tactics).length, 48);
  assert.equal(cards.length, 60);
  assert.equal(new Set(cards.map(card => card.id)).size, 60);
  assert.equal(cards.filter(card => !B.tactics[card.id]).length, 56);
  assert.equal(Object.keys(merged).length, 104);
  assert.equal(Object.values(merged).filter(card => card.category === 'hero').length, 60);
  assert.equal(Object.values(merged).filter(card => card.category === 'attribute').length, 26);
  assert.equal(Object.values(merged).filter(card => card.category === 'camp').length, 18);
});

test('each hero has one card per progression tier, two rares, one epic and one legendary', () => {
  for (const [heroId, group] of Object.entries(B.heroUpgrades)) {
    assert.equal(group.baseStrength, 100);
    assert.equal(group.upgrades.length, 4);
    assert.deepEqual(group.upgrades.map(card => card.tier).sort(), [1, 2, 3, 4]);
    assert.deepEqual(group.upgrades.map(card => card.rarity).sort(), ['epic', 'legendary', 'rare', 'rare']);
    for (const card of group.upgrades) {
      assert.equal(card.hero, heroId);
      assert.equal(card.category, 'hero');
      assert.equal(card.repeatable, false);
      assert.equal(card.decay, 1);
      assert.equal(typeof card.description, 'string');
      assert.ok(card.description.length > 8);
      assert.ok(Object.keys(card.effects).length > 0);
      if (!preserved.includes(card.id)) {
        assert.equal(card.endlessOnly, true);
        assert.equal(card.camp, null);
        assert.equal(B.tactics[card.id], undefined);
      }
    }
  }
});

test('the four existing hero tactics preserve their names, IDs and exact effects', () => {
  const expected = {
    guan_yu_width: { name: '青龙展刃', effects: { sweepWidthAdd: 24 } },
    guan_yu_press: { name: '偃月破阵', effects: { elitePushbackAdd: 16, bossPushbackAdd: 0 } },
    zhou_yu_radius: { name: '连营火势', effects: { fireWidthAdd: 24 } },
    zhou_yu_duration: { name: '烈焰余势', effects: { fireDurationSecAdd: 1, preserveMaxTicksPerEnemy: true } }
  };
  for (const id of preserved) {
    assert.equal(byId[id].id, id);
    assert.equal(byId[id].name, expected[id].name);
    assert.deepEqual(byId[id].effects, expected[id].effects);
    assert.equal(B.tactics[id].tier, undefined, 'tier belongs to the exclusive-card index, not the preserved tactic');
    assert.equal(B.tactics[id].endlessOnly, undefined);
    for (const key of Object.keys(B.tactics[id])) assert.deepEqual(byId[id][key], B.tactics[id][key]);
  }
  assert.equal(byId.guan_yu_width.tier, 2);
  assert.equal(byId.guan_yu_press.tier, 1);
  assert.equal(byId.zhou_yu_radius.tier, 2);
  assert.equal(byId.zhou_yu_duration.tier, 1);
});

test('all exclusive cards use the corrected Three Kingdoms names', () => {
  const corrected = {
    xiahou_dun_double_leap: '独眼·连跃', xiahou_dun_blood_counter: '独眼·残躯血战',
    zhuge_liang_mind: '八阵·攻心', sun_quan_command: '江东·统御', sun_quan_ambition: '江东·仲谋之志',
    zhou_yu_inferno: '赤壁·火势滔天', lv_meng_feign: '白衣·示弱', lv_meng_mine_array: '白衣·连雷阵',
    gan_ning_bells: '锦帆·铃震三军'
  };
  for (const [id, name] of Object.entries(corrected)) assert.equal(byId[id].name, name);
  for (const card of cards) assert.doesNotMatch(card.name, /火烧连营|心理战|白衣·增灶|白衣·更新|铃响铃响|生子当如|江东·领导|二段跳|拔矢无双/);
});

test('live-frame adaptations remain explicit and confined to the new exclusive cards', () => {
  assert.equal(byId.guan_yu_solo.requiredPartySize, 1);
  assert.deepEqual(byId.guan_yu_solo.effects, { soloUltimateDamageMultiplier: 1.8, soloRageCycleReduction: .3 });
  assert.equal(byId.xiahou_dun_gaze.effects.infantryExecuteBelowHpFraction, .5);
  assert.equal(byId.xiahou_dun_gaze.effects.infantryExecuteIgnoresInvulnerability, true);
  assert.equal(B.heroes.sun_quan.ultimate.waveSec, .4);
  assert.equal(byId.sun_quan_tide.effects.waveDurationMultiplier, 1.8 / 2.2);
  assert.equal(byId.sun_quan_tide.effects.ultimateRadiusMultiplier, 1.25);
  assert.equal(B.endless.heroUpgradeRuntime.taishiCiBaseShotIntervalSec, .15);
  assert.equal(byId.taishi_ci_rapid.effects.snipeIntervalSecOverride, .1);
  assert.equal(B.heroes.taishi_ci.ultimate.snipeIntervalSecOverride, undefined);
  assert.equal(byId.lv_meng_feign.effects.mineFirstTriggerRecoveryReductionSec, 2);
  assert.equal(B.heroes.lv_meng.ultimate.durationSec, 8);
  assert.deepEqual(byId.lv_meng_three_days.effects, { mineChargeIntervalSec: 4, mineChargeDamageBonus: .3, mineChargeDamageCap: 1.5, durationMinSec: 24 });
  assert.equal(byId.zhuge_liang_wind.effects.hitSpeedFactorOverride, .5);
  assert.equal(byId.zhuge_liang_wind.effects.ultimateDamageMultiplier, .9);
  for (const id of ['xiahou_dun_gaze', 'sun_quan_tide', 'taishi_ci_rapid', 'lv_meng_feign', 'lv_meng_three_days', 'zhuge_liang_wind', 'guan_yu_solo']) assert.ok(byId[id].runtimeNotes);
});

test('new hero data validation rejects missing rosters, bad references, duplicate tiers and changed legacy effects', async () => {
  const baseline = await loadDesignData();
  assert.equal(validateDesignData(baseline.balance, baseline.campaign).ok, true);
  const cases = [
    data => { delete data.v1Baseline.heroUpgrades.cao_cao; },
    data => { data.v1Baseline.heroUpgrades.cao_cao.upgrades[0].hero = 'missing_hero'; },
    data => { data.v1Baseline.heroUpgrades.cao_cao.upgrades[1].tier = 1; },
    data => { data.v1Baseline.heroUpgrades.cao_cao.upgrades[0].rarity = 'legendary'; },
    data => { data.v1Baseline.heroUpgrades.guan_yu.upgrades.find(card => card.id === 'guan_yu_width').effects.sweepWidthAdd = 999; },
    data => { data.v1Baseline.heroUpgrades.cao_cao.upgrades[0].endlessOnly = false; }
  ];
  for (const mutate of cases) {
    const balance = structuredClone(baseline.balance); mutate(balance);
    const result = validateDesignData(balance, baseline.campaign);
    assert.equal(result.ok, false);
    assert.ok(result.errors.some(message => message.startsWith('heroUpgrades')));
  }
});
