import test from 'node:test';
import assert from 'node:assert/strict';
import { BALANCE as B, CONTENT } from '../runtime-data.js';
import { V1Game, seededRandom } from '../v1-engine.js';
import { generateEndlessWave, getEndlessAnchor } from '../endless-rules.js';
import * as curve from '../docs/data/endless-curve.mjs';

const anchorWaves = [10, 20, 25, 30, 35, 40, 45, 50, 60, 70, 80];
const sum = values => values.reduce((total, value) => total + value, 0);
const near = (actual, expected, message) => assert.ok(Math.abs(actual - expected) < 1e-7, `${message}: ${actual} versus ${expected}`);
function fixture(wave, options = {}) {
  const events = [], game = new V1Game({ mode:'endless', rng:seededRandom(73), onEvent:event => events.push(event), ...options });
  game.start(); game._startWave(wave);
  for (const hero of game.heroes) hero.attackCooldown = 1e9;
  return { game, events, config:game._waveConfig(wave) };
}

test('eleven data-driven anchors keep every independent curve, exact elite slot total, boss HP and food budget', () => {
  const baseline = JSON.stringify(B.endless), content = JSON.stringify(CONTENT.levels), table = curve.hpMultiplierTable(150);
  assert.deepEqual(Object.keys(B.endlessAnchors).map(Number), anchorWaves);
  for (let number = 1; number <= 150; number++) {
    const actual = generateEndlessWave(number), ordinary = generateEndlessWave(number, B.endless, { anchors:{} }), expected = curve.waveStats(number, table);
    assert.equal(actual.count, expected.count);
    assert.equal(sum(Object.values(actual.units)), expected.count);
    assert.equal(sum(Object.entries(actual.units).filter(([type]) => B.enemies[type].class === 'elite').map(([, count]) => count)), Math.round(expected.count * expected.eliteFraction));
    for (const key of ['hpMultiplier', 'speedMultiplier', 'spawnWindowSec', 'eliteFraction', 'foodRewardTotal', 'completionFoodReward', 'killFoodReward']) assert.equal(actual[key], ordinary[key], `${key} wave ${number}`);
    assert.equal(actual.spawnWindowSec, expected.duration);
    assert.equal(actual.hpMultiplier, expected.hpMultiplier); assert.equal(actual.speedMultiplier, curve.speedMultiplier(number));
    assert.equal(actual.foodRewardTotal, curve.waveFood(number));
    assert.equal(actual.bossSpawns.length, expected.bosses);
    for (const boss of actual.bossSpawns) assert.equal(boss.maxHp, expected.bossHp);
    const packed = {};
    for (const pack of actual.packs) {
      assert.ok(pack.startSec >= 0 && pack.startSec + pack.durationSec <= expected.duration);
      for (const [type, count] of Object.entries(pack.units)) packed[type] = (packed[type] || 0) + count;
    }
    assert.deepEqual(packed, actual.units);
    assert.equal(Boolean(actual.anchor), anchorWaves.includes(number));
  }
  assert.equal(JSON.stringify(B.endless), baseline); assert.equal(JSON.stringify(CONTENT.levels), content);
  const isolated = getEndlessAnchor(40); isolated.bossTemplates[0] = 'rammer';
  assert.deepEqual(getEndlessAnchor(40).bossTemplates, ['guardian', 'guardian'], 'anchor callers cannot mutate the source catalog');
  assert.equal(getEndlessAnchor(41), null);
});

test('anchor formations spend existing elite slots and the wave-20 boss count follows the curve rather than the obsolete two-boss text', () => {
  assert.deepEqual(generateEndlessWave(10).bossSpawns.map(boss => boss.templateId), ['siege_lord']);
  assert.deepEqual(generateEndlessWave(20).bossSpawns.map(boss => boss.templateId), ['charger']);
  const banner = generateEndlessWave(25), siege = generateEndlessWave(30), ranged = generateEndlessWave(35);
  assert.equal(banner.units.banner, Math.round(banner.count * .06));
  assert.equal(siege.units.siege, 8); assert.equal(siege.bossSpawns.length, 2);
  assert.equal(ranged.units.ranged, Math.round(ranged.count * .1));
  assert.deepEqual(generateEndlessWave(40).bossSpawns.map(boss => [boss.templateId, boss.damageTakenMultiplier]), [['guardian', .75], ['guardian', .75]]);
  assert.deepEqual(generateEndlessWave(50).bossSpawns.map(boss => boss.templateId), ['banner_lord', 'guardian', 'siege_lord']);
  for (const number of [60, 80]) {
    assert.deepEqual(Object.keys(generateEndlessWave(number).units).sort(), ['armor', 'banner', 'cavalry', 'infantry', 'ranged', 'siege']);
    assert.equal(generateEndlessWave(number).bossSpawns.length, 3);
  }
  const elite = generateEndlessWave(70);
  assert.equal(elite.eliteFraction, curve.eliteFraction(70));
  assert.equal(elite.anchor.eliteCount, Math.round(elite.count * curve.eliteFraction(70)));
  assert.notEqual(elite.eliteFraction, .39, 'the old rounded anchor percentage does not replace the reference fraction');
  assert.equal(generateEndlessWave(81).anchor, undefined, 'wave eighty remains a soft target rather than repeating the final anchor');
});

test('anchor events announce each configured wave exactly once with the resolved composition and capacity limit', () => {
  for (const number of anchorWaves) {
    const { game, events, config } = fixture(number), announced = events.filter(event => event.type === 'endlessAnchor');
    assert.equal(announced.length, 1);
    const event = announced[0];
    assert.equal(event.wave, number); assert.equal(event.id, B.endlessAnchors[number].id); assert.equal(event.name, B.endlessAnchors[number].name);
    assert.equal(event.count, config.count); assert.equal(event.eliteCount, Math.round(config.count * config.eliteFraction));
    assert.equal(event.bossCount, config.bossSpawns.length); assert.deepEqual(event.bossTemplates, config.bossSpawns.map(boss => boss.templateId));
    assert.equal(event.maximumAliveEnemies, B.enemyDensity.maximumAliveEnemies);
    game.update(.1); assert.equal(events.filter(value => value.type === 'endlessAnchor').length, 1);
    assert.equal(game._spawnQueue.length, config.count + curve.bossCount(number));
    assert.equal(sum(game._spawnQueue.map(spec => spec.reward)) + config.completionFoodReward, curve.waveFood(number));
  }
});

test('the mass-arrival anchor queues all 238 units at once while admitting at most 160 living enemies', () => {
  const { game, config } = fixture(45);
  assert.equal(config.count, 238); assert.equal(config.spawnWindowSec, curve.waveDuration(45));
  assert.ok(game._spawnQueue.every(spec => spec.at === .3));
  game.update(.29); assert.equal(game.activeEnemyCount, 0);
  game.update(.02); assert.equal(game.activeEnemyCount, 160); assert.equal(game.pendingEnemyCount, 78);
  assert.equal(game.stats.maxAlive, 160);
  const firstBatch = [...game.enemies]; for (const enemy of firstBatch) game._damage(enemy, 1e12, 'anchor_clear_first_batch');
  game.update(1 / 60); assert.equal(game.activeEnemyCount, 78); assert.equal(game.pendingEnemyCount, 0);
  assert.equal(game.stats.spawned, 238); assert.equal(game.stats.maxAlive, 160);
  assert.ok(game.enemies.every(enemy => !firstBatch.includes(enemy)), 'the queued remainder really spawns after capacity becomes free');
});

test('both guardian anchors preserve exact party-scaled boss HP and one permanent 25-percent reduction through ability cycles', () => {
  const { game, config } = fixture(40, { party:['guan_yu', 'cao_cao', 'zhou_yu'].map(heroId => ({ heroId })) });
  for (const spec of game._spawnQueue.filter(value => value.boss)) {
    const enemy = game._spawn(spec);
    assert.equal(enemy.maxHp, Math.ceil(curve.bossHp(40) * B.party.enemyHpMultipliersByPartySize[3]));
    assert.equal(enemy.anchorDamageTakenMultiplier, .75);
    for (const dt of [0, 16, 4.1, 16, 4.1]) {
      game._enemyAbilities([enemy], dt); const before = enemy.hp;
      game._damage(enemy, 100, 'anchor_guard_probe'); near(before - enemy.hp, 75, 'normal and active guardian protection use the stronger factor once');
    }
  }
  assert.ok(config.bossSpawns.every(boss => boss.maxHp === curve.bossHp(40)));
  const normal = fixture(39).game, ordinaryGuardian = normal._spawn({ type:'boss', lane:0, boss:{ templateId:'guardian', maxHp:10000, name:'ordinary guardian' }, wave:normal._waveConfig(39) });
  normal._enemyAbilities([ordinaryGuardian], 1); assert.equal(ordinaryGuardian.damageTakenMultiplier, 1, 'the permanent modifier stays local to the anchored bosses');
});

test('charger, banners, ranged disruption, siege resistance and zero-food commander summons reuse existing enemy mechanics', () => {
  const charged = fixture(20), charger = charged.game._spawn(charged.game._spawnQueue.find(spec => spec.boss));
  assert.equal(charger.speed, B.enemies.boss.speed * curve.speedMultiplier(20));
  charged.game._spawnQueue = [{ at:1e9 }]; charged.game._spawnIndex = 0;
  charger.abilityTimer = B.bossTemplates.charger.ability.intervalSec - .5;
  charged.game.update(.5); const before = charger.progress; charged.game.update(1);
  near(charger.progress - before, charger.speed * 1.4, 'the anchored charger uses the original timed haste');

  const flags = fixture(25), flag = flags.game._spawn({ type:'banner', lane:0, progress:300, wave:flags.config }), infantry = flags.game._spawn({ type:'infantry', lane:0, progress:300, wave:flags.config });
  flag.speed = 0; flags.game._spawnQueue = [{ at:1e9 }]; flags.game._spawnIndex = 0;
  const start = infantry.progress; flags.game.update(1); near(infantry.progress - start, infantry.speed * 1.15, 'the higher banner quota supplies the existing local infantry haste');

  const archers = fixture(35), ranged = archers.game._spawn({ type:'ranged', lane:0, progress:300, wave:archers.config }), camp = archers.game._addCamp(0, 'archer', 1);
  Object.assign(camp, { x:ranged.x, y:ranged.y }); archers.game._enemyAbilities([ranged], 8);
  assert.equal(camp.disruptions.length, 1); near(archers.game._campInterval(camp), B.camps.archer.levels[0].intervalSec * 1.1, 'the ranged anchor uses the current camp-interval disruption');

  const engines = fixture(30), siege = engines.game._spawn({ type:'siege', lane:0, progress:300, wave:engines.config }), progress = siege.progress;
  engines.game._push(siege, 100); near(progress - siege.progress, 100 * B.enemies.siege.controlEffectFraction, 'siege push control retains the existing 0.35 effectiveness');

  const commanders = fixture(50), commander = commanders.game._spawn(commanders.game._spawnQueue.find(spec => spec.boss?.templateId === 'banner_lord'));
  const scheduled = commanders.game.stats.scheduledEnemies;
  commanders.game._enemyAbilities([commander], B.bossTemplates.banner_lord.ability.intervalSec);
  const summons = commanders.game._spawnQueue.filter(spec => spec.summoned);
  assert.equal(summons.length, 6); assert.ok(summons.every(spec => spec.type === 'infantry' && spec.reward === 0));
  assert.equal(commanders.game.stats.scheduledEnemies - scheduled, 6); assert.ok(commanders.game.pendingEnemyCount >= 6);
});

test('campaign waves, enemy abilities and RNG stay outside the anchor path', () => {
  const level = CONTENT.levels.find(value => value.id === 'wei_001'), events = [], random = seededRandom(517);
  let draws = 0; const game = new V1Game({ onEvent:event => events.push(event), rng:() => { draws++; return random(); } });
  assert.equal(game._waveConfig(1), level.waves[0]);
  game.start();
  assert.equal(draws, level.waves[0].packs.reduce((count, pack) => count + Math.max(0, sum(Object.values(pack.units)) - 1), 0), 'only the original pack shuffle consumes random values');
  assert.ok(game._spawnQueue.some(spec => spec.at > .3), 'campaign packs retain their normal spacing');
  assert.ok(events.every(event => event.type !== 'endlessAnchor'));
  const guardian = game._spawn({ type:'boss', lane:0, boss:{ templateId:'guardian', hpMultiplier:1, name:'campaign guardian' }, wave:level.waves[0] });
  assert.equal(guardian.anchorDamageTakenMultiplier, undefined); game._enemyAbilities([guardian], 1); assert.equal(guardian.damageTakenMultiplier, 1);
});
