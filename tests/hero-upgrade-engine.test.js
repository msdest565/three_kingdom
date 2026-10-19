import test from 'node:test';
import assert from 'node:assert/strict';
import { V1Game, seededRandom } from '../v1-engine.js';
import { BALANCE as B } from '../runtime-data.js';

const close = (actual, expected, message = '') => assert.ok(Math.abs(actual - expected) < 1e-6, `${message}: ${actual} vs ${expected}`);
function game(heroId, otherIds = []) {
  const g = new V1Game({ mode: 'endless', rng: seededRandom(7), unlockedCamps: Object.keys(B.camps), party: [heroId, ...otherIds].map(heroId => ({ heroId })) });
  g.start(); g._spawnQueue = [{ at: 1e9 }]; g._spawnIndex = 0; g.food = 10000; return g;
}
function cards(g, ...ids) {
  for (const id of ids) { const card = g.tacticDefinition(id); assert.ok(card, id); g.state = 'choosing'; g.upgrades = [{ id, ...card }]; assert.equal(g.selectUpgrade(id).ok, true); }
  g._between = 0; return g;
}
function enemy(g, type = 'armor', values = {}) {
  return Object.assign(g._spawn({ type, lane: 0, progress: 400, wave: g._waveConfig(1) }), { hp: 100000, maxHp: 100000, speed: 0 }, values);
}
function release(g, target = null) {
  const hero = g.heroes[0]; hero.rage = g.heroRageCost(hero); hero.rageRecovery = 0; g._lastSkillTime = -Infinity;
  if (target) { hero.rage = 0; hero.rageRecovery = 6 * g._heroRageCycle(hero); g._beginCast(hero, target); }
  else assert.equal(g.castUltimate().ok, true);
  return g._casts.at(-1);
}
const circle = (hero, radius = 150) => ({ shape: 'circle_shock', x: hero.x, y: hero.y - 100, radius, targetIds: [] });

test('all sixty cards are owned by one hero and effective skill reads never mutate baseline or run state', () => {
  const baseline = JSON.stringify(B.heroes);
  for (const id of Object.keys(B.heroes)) {
    const g = game(id); cards(g, ...B.heroUpgrades[id].upgrades.map(card => card.id));
    const before = JSON.stringify(g.heroes[0]); const a = g.heroUltimate(g.heroes[0]), b = g.heroUltimate(g.heroes[0]);
    assert.notEqual(a, b); assert.equal(JSON.stringify(g.heroes[0]), before);
    a.radius = 1; assert.notEqual(g.heroUltimate(g.heroes[0]).radius, 1);
  }
  assert.equal(JSON.stringify(B.heroes), baseline);
});

test('Cao Cao cards heal at the landed banner, extend command, buff local range and cap permanent rage growth', () => {
  const g = game('cao_cao'); cards(g, 'cao_cao_banner_heal','cao_cao_command_echo','cao_cao_imperial_order','cao_cao_unify');
  const hero = g.heroes[0], target = circle(hero, 165); g.build(0, 'archer'); const camp = g.camps[0]; Object.assign(camp, { x: target.x, y: target.y });
  g.hp = 50; const cast = release(g, target);
  assert.equal(cast.ultimate.bannerLingerSec, 8); assert.equal(cast.ultimate.allyAttackSpeedBonus, .2); assert.equal(cast.ultimate.buffDurationSec, 9);
  g.update(1.43); close(g.hp, 53); close(camp.range, 205 * 1.25);
  for (let i = 0; i < 110; i++) g._damage(enemy(g, 'cavalry', { x: target.x, y: target.y, hp: 1 }), 100, 'test');
  close(hero.upgradeState.permanentRageGain, .5);
  g.update(6); close(camp.range, 205, 'range bonus expires after its own six seconds');
});

test('Xiahou Dun cards execute protected wounded infantry, enlarge/push, double leap and consume one leak counter', () => {
  const gaze = game('xiahou_dun'); cards(gaze, 'xiahou_dun_gaze'); const target = circle(gaze.heroes[0]);
  const victim = enemy(gaze, 'infantry', { x: target.x, y: target.y, hp: 40, maxHp: 100, invulnerable: true });
  const immune = enemy(gaze, 'infantry', { x: target.x, y: target.y, hp: 40, maxHp: 100, invulnerable: true, executeImmune: true });
  release(gaze, target); gaze._skillDamage(.36); assert.equal(victim.hp, 0); assert.equal(immune.hp, 40);
  const g = game('xiahou_dun'); cards(g, 'xiahou_dun_eye','xiahou_dun_double_leap','xiahou_dun_blood_counter');
  g._escape(enemy(g, 'infantry', { leak: 1 })); const hero = g.heroes[0]; const point = g.pathPoint(0, 400);
  const elite = enemy(g, 'armor', point), cast = release(g, { shape: 'circle_shock', ...point, radius: 225, targetIds: [elite.id] });
  assert.equal(cast.ultimate.radius, 225); assert.equal(cast.ultimate.pushbackByClass.elite, 45);
  assert.equal(hero.upgradeState.counterReady, false); g._skillDamage(.36); close(100000 - elite.hp, 90 * 1.6);
  g._skillDamage(.3); close(100000 - elite.hp, 90 * 1.6 * 1.6); assert.equal(cast.secondLeapDone, true);
  assert.equal(g.heroUltimate(hero).radius, 195);
});

test('Zhang Liao cards charge both routes with stun, knockback, mist and permanent banner-proof slowing', () => {
  const g = game('zhang_liao'); cards(g, 'zhang_liao_mist','zhang_liao_vanguard','zhang_liao_double_lane','zhang_liao_silence');
  const targets = g.paths.map((path, lane) => enemy(g, 'armor', { laneId: path.id, pathSide: lane, progress: 400, ...g.pathPoint(lane, 400) }));
  const cast = release(g); assert.equal(cast.target.laneIds.length, 2); assert.equal(cast.target.width, 150); g._skillDamage(.81);
  for (const e of targets) { assert.ok(e.hp < 100000); close(e.stunRemaining, 2); close(e.permanentSpeedFactor, .8); assert.equal(e.noBannerHaste, true); }
  assert.ok(g._heroZones.some(zone => zone.type === 'chargeMist'));
  assert.equal(cast.ultimate.pushbackByClass.elite, 55);
});

test('Xu Chu cards widen the cone, slow armor, splash from bosses and protect all leaks for three seconds', () => {
  const g = game('xu_chu'); cards(g, 'xu_chu_crush','xu_chu_bare','xu_chu_chain','xu_chu_guard'); const hero = g.heroes[0];
  const armor = enemy(g, 'armor', { x: hero.x, y: hero.y - 100 }), boss = enemy(g, 'boss', { x: hero.x + 10, y: hero.y - 100 });
  const cast = release(g); close(cast.ultimate.range, 420); close(cast.ultimate.angleDegrees, 110);
  close(100000 - armor.hp, 150 + 390 * .5); close(100000 - boss.hp, 390);
  close(armor.slowEffects[0].factor, .72); assert.equal(armor.slowEffects[0].remaining, 2);
  const hp = g.hp; g._escape(enemy(g, 'boss', { leak: 45 })); close(g.hp, hp);
  g._buffs.forEach(buff => { buff.remaining = 0; }); g._escape(enemy(g, 'boss', { leak: 45 })); close(g.hp, hp - 45);
});

test('Sima Yi cards speed and enlarge the locked thunder, strengthen existing slows and propagate death explosions', () => {
  const g = game('sima_yi'); cards(g, 'sima_yi_chain','sima_yi_punishment','sima_yi_scheme','sima_yi_chain_death');
  const hero = g.heroes[0], target = circle(hero, 120);
  const victim = enemy(g, 'cavalry', { x: target.x, y: target.y, hp: 10000, maxHp: 10000 }); g._slow(victim, .8, 1, 'prior');
  const cast = release(g, target); assert.equal(cast.ultimate.radius, 120); assert.equal(cast.hitAt, .6); g._skillDamage(.6);
  assert.ok(victim.slowEffects.some(s => s.factor === .5 && s.remaining === 5));
  const chained = enemy(g, 'cavalry', { x: target.x + 50, y: target.y, hp: 70 });
  const farther = enemy(g, 'cavalry', { x: target.x + 110, y: target.y, hp: 70 });
  g._damage(victim, 20000, 'test'); assert.equal(chained.hp, 0); assert.equal(farther.hp, 0);
  assert.ok(chained.deathThunderTriggered); assert.ok(farther.deathThunderTriggered);
  assert.equal(cast.ultimate.upgradeEffects.retargetFarCircleIfClustered, true);
});

test('Sima Yi scheme retargets the farthest legal enemy cluster without breaking circle spacing', () => {
  const g = game('sima_yi'); cards(g, 'sima_yi_punishment');
  const points = [[157,313],[95,115],[54,365],[284,104],[384,424],[77,122],[259,300],[377,472]];
  for (const [x,y] of points) enemy(g, 'armor', { x, y });
  const original = g._target(g.heroes[0]); cards(g, 'sima_yi_scheme'); const target = g._target(g.heroes[0]);
  assert.equal(target.retargetedCircle, true); assert.deepEqual(target.circles.slice(0, 2), original.circles.slice(0, 2));
  assert.deepEqual(target.circles[2], { x:54, y:365, radius:120 });
  for (let a = 0; a < 3; a++) for (let b = a + 1; b < 3; b++) assert.ok(Math.hypot(target.circles[a].x-target.circles[b].x,target.circles[a].y-target.circles[b].y) >= 140);
});

test('Liu Bei cards grow width to 48, leave route barriers, improve base heal and replace it with missing-health healing', () => {
  const g = game('liu_bei'); cards(g, 'liu_bei_recruits','liu_bei_ferry','liu_bei_shield_wall'); g.hp = 20;
  let cast = release(g); close(g.hp, 32); assert.equal(cast.ultimate.healFractionCap, .18); assert.equal(cast.target.width, 118);
  g._skillDamage(.6); assert.equal(g._heroZones.filter(zone => zone.type === 'barrier').length, g.paths.length);
  const barrier = g._heroZones.find(zone => zone.type === 'barrier');
  const stopped = enemy(g, 'cavalry', { laneId: barrier.laneId, progress: barrier.progress - .1, speed: 100 }); g.update(.1); assert.ok(stopped.progress < barrier.progress);
  for (let i = 0; i < 8; i++) cast = release(g); assert.equal(g.heroes[0].upgradeState.rallyWidthAdd, 48); assert.equal(cast.target.width, 158);
  cards(g, 'liu_bei_virtue'); g.hp = 20; release(g); close(g.hp, 40, 'lost health replaces the maximum-HP heal');
});

test('Guan Yu preserves both legacy cards, creates overlap wind, and solo legend changes damage and the complete rage cycle', () => {
  const g = game('guan_yu'); cards(g, 'guan_yu_width','guan_yu_press','guan_yu_blade_wind','guan_yu_solo');
  const hero = g.heroes[0], target = { shape: 'directional_swept_rectangle', x: hero.x, y: hero.y, angle: -Math.PI / 2, width: 208, length: 610, targetIds: [] };
  const first = release(g, target); close(first.ultimate.damageMultiplier, 1.8); assert.equal(first.ultimate.pushbackByClass.elite, 38); close(hero.rageRecovery, 4.2);
  release(g, structuredClone(target)); assert.equal(g._heroZones.filter(zone => zone.type === 'bladeWind').length, 1);
  const victim = enemy(g, 'armor', { x: hero.x, y: hero.y - 100 }); const before = victim.hp; g._damage(victim, 100, 'test'); close(before - victim.hp, 115);
  g._casts = []; hero.rageRecovery = 0; hero.rage = 0; g.update(.1); close(hero.rage, .1 / .7, 'solo reduces the idle rage period by 30%');
  const team = game('guan_yu', ['cao_cao']); cards(team, 'guan_yu_solo'); close(team.heroUltimate(team.heroes[0]).damageMultiplier, 1);
});

test('Zhang Fei cards extend the single-hit window, expose a persistent area, span the screen and suppress elite haste', () => {
  const g = game('zhang_fei'); cards(g, 'zhang_fei_echo','zhang_fei_rearguard','zhang_fei_bridge','zhang_fei_roar');
  const hero = g.heroes[0], target = enemy(g, 'armor', { x: hero.x, y: hero.y - 100 }); const cast = release(g);
  close(cast.life, 1.5); close(cast.target.width, 520 * 1.15); close(cast.target.length, 340 * 1.15); close(target.stunRemaining, 1.5);
  assert.equal(target.bannerBlockRemaining, 4); assert.ok(target.slowEffects.some(s => Math.abs(s.factor - .58) < 1e-8));
  const hp = target.hp; g._skillDamage(1); close(target.hp, hp, 'long window cannot hit one enemy twice');
  assert.ok(g._heroZones.some(zone => zone.type === 'rearguard'));
});

test('Zhao Yun cards execute five timed passes, enlarge only second/third passes and bank three empty-cast bonuses', () => {
  const g = game('zhao_yun'); cards(g, 'zhao_yun_haste','zhao_yun_connect','zhao_yun_five_passes','zhao_yun_courage');
  const hero = g.heroes[0], target = enemy(g, 'boss', { x: hero.x, y: hero.y - 100 }); const cast = release(g);
  assert.deepEqual(cast.ultimate.passAtSec, [0,.15,.3,.44999999999999996,.6]); assert.equal(cast.ultimate.maxHitsPerEnemyPerCast, 5);
  g._skillDamage(.61); close(100000 - target.hp, 500); assert.equal(cast.hits.get(target.id), 5);
  g._skillDamage(.2); close(hero.rage, 35); assert.equal(hero.upgradeState.failedCasts, 1);
  for (let i = 0; i < 3; i++) { release(g); g._skillDamage(1); }
  assert.equal(hero.upgradeState.failedCasts, 3); close(g.heroUltimate(hero).damageMultiplier, 1.75);
});

test('Zhao Yun continuity really reaches new lateral targets on passes two and three, with no extension on four and five', () => {
  const g = game('zhao_yun'); cards(g, 'zhao_yun_connect','zhao_yun_five_passes'); const hero = g.heroes[0];
  const victim = enemy(g, 'cavalry', { x:hero.x + 44, y:hero.y - 100, radius:0 });
  const cast = release(g, { shape:'three_narrow_passes', x:hero.x, y:hero.y, angle:-Math.PI / 2, width:85, length:610, targetIds:[] });
  close(victim.hp, 100000); g._skillDamage(1.01); close(100000 - victim.hp, 80); assert.equal(cast.hits.get(victim.id), 2);
});

test('Zhuge Liang cards add resistant control, scale incoming damage with slow, double bounded push and expose at 1.5 for five seconds', () => {
  const g = game('zhuge_liang'); cards(g, 'zhuge_liang_wind','zhuge_liang_mind','zhuge_liang_empty_city','zhuge_liang_memorial');
  const hero = g.heroes[0], target = circle(hero, 150), victim = enemy(g, 'cavalry', { x: target.x, y: target.y, slow: .5 });
  const cast = release(g, target); assert.equal(cast.life, 5); close(cast.ultimate.damageMultiplier, .9);
  assert.equal(cast.ultimate.backwardProgressPerSecByClass.ordinary, 24); assert.equal(cast.ultimate.totalBackwardProgressCapByClass.ordinary, 72);
  g._skillDamage(.25); assert.ok(victim.vulnerability.some(v => v.factor === 1.5)); assert.ok(victim.slowEffects.some(v => v.factor === .5));
  const before = victim.hp; g._damage(victim, 100, 'test'); close(before - victim.hp, 150 * 1.25);
  assert.ok(victim.bannerBlockRemaining > 0);
});

test('Sun Quan cards speed/widen the wave, grant next-attack range, honor 55% gate factor and refund first-leak food per wave', () => {
  const g = game('sun_quan'); cards(g, 'sun_quan_command','sun_quan_tide','sun_quan_fort','sun_quan_ambition'); g.build(0, 'archer'); const camp = g.camps[0];
  const target = { shape: 'gate_half_wave', ...g._gateCenter(), radius: 400, targetIds: [] }; Object.assign(camp, { x: target.x, y: target.y - 20 });
  const cast = release(g, target); close(cast.ultimate.waveSec, .4 * 1.8 / 2.2); assert.equal(cast.ultimate.radius, 400); g._skillDamage(.1); close(camp.range, 246);
  const food = g.food, hp = g.hp; g._escape(enemy(g, 'boss', { leak: 10 })); close(g.hp, hp); close(g.food, food + 30);
  g._escape(enemy(g, 'boss', { leak: 10 })); close(g.hp, hp - 5.5);
  g._startWave(2); const secondHp = g.hp; g._escape(enemy(g, 'boss', { leak: 10 })); close(g.hp, secondHp); close(g.food, food + 60);
  assert.equal(cast.ultimate.buffDurationSec, 10);
});

test('Zhou Yu keeps both old upgrades and combines narrow stronger flames with camp-driven width and length growth', () => {
  const g = game('zhou_yu'); cards(g, 'zhou_yu_radius','zhou_yu_duration','zhou_yu_flame','zhou_yu_inferno');
  const h = g.heroes[0], point = g.pathPoint(0, 400); enemy(g, 'cavalry', point);
  const bare = g.heroUltimate(h); assert.equal(bare.width, 114); assert.equal(bare.durationSec, 5); close(bare.damageMultiplier, 1.2);
  for (let slot = 0; slot < 4; slot++) { g.build(slot, 'archer'); Object.assign(g.camps.at(-1), point); }
  const target = g._target(h); close(target.width, 114 * 1.45); close(target.length, 320 * 1.45);
  const cast = release(g, target); assert.equal(cast.life, 5); assert.equal(cast.ultimate.maxTicksPerEnemyPerCast, 16);
});

test('Lv Meng cards place eight large mines, slow nearby entrants, shorten recovery once and charge to 150% over 20 seconds', () => {
  const g = game('lv_meng'); cards(g, 'lv_meng_setup','lv_meng_feign','lv_meng_mine_array','lv_meng_three_days'); const cast = release(g);
  assert.equal(cast.mines.length, 8); assert.equal(cast.life, 24); assert.equal(cast.ultimate.blastRadius, 85);
  const mine = cast.mines[0], target = enemy(g, 'boss', { ...mine, progress: 100, hp: 100000 });
  g._skillDamage(20); close(100000 - target.hp, 75 * 2.5); assert.equal(g.heroes[0].rageRecovery, 4);
  assert.ok(target.slowEffects.some(s => s.remaining === 2));
  const next = cast.mines.find(m => !m.triggered); Object.assign(target, next); g._skillDamage(.1); assert.equal(g.heroes[0].rageRecovery, 4);
});

test('Gan Ning cards cover all routes, blind already-vulnerable ranged attackers and stack permanent exposure once per cast', () => {
  const g = game('gan_ning'); cards(g, 'gan_ning_rain','gan_ning_raid','gan_ning_hundred_riders','gan_ning_bells');
  const point = g.pathPoint(0, 400), victim = enemy(g, 'ranged', { ...point, abilityTimer: 8 }); g._vulnerable(victim, 1.1, 5, 'prior');
  const cast = release(g); assert.equal(cast.target.strips.length, g.paths.length); assert.equal(cast.target.width, 120); g._skillDamage(.25);
  close(victim.permanentVulnerability, 1.35); assert.equal(victim.blindRemaining, 1.5); g._skillDamage(.25); close(victim.permanentVulnerability, 1.35);
  release(g); g._skillDamage(.25); close(victim.permanentVulnerability, 1.35 ** 2);
  const before = victim.hp; g._damage(victim, 100, 'test'); close(before - victim.hp, 100 * 1.35 ** 2);
});

test('Taishi Ci cards fire five real timed arrows at one boss, boost later arrows and ignore damage reduction', () => {
  const g = game('taishi_ci'); cards(g, 'taishi_ci_pierce','taishi_ci_rapid','taishi_ci_shenting','taishi_ci_faith');
  const hero = g.heroes[0], boss = enemy(g, 'boss', { x: hero.x, y: hero.y - 100, damageTakenMultiplier: .75 }); const cast = release(g);
  close(100000 - boss.hp, 400 * 1.5); assert.equal(cast.ultimate.snipeIntervalSec, .1); assert.equal(cast.target.shotTargetIds.length, 5);
  g._skillDamage(.4); close(100000 - boss.hp, 400 * 1.5 * (1 + 1.3 * 4)); assert.equal(cast.hits.get(boss.id), 5);
});

test('an in-flight hero cast retains its private snapshot when a later offer changes that hero', () => {
  const g = game('zhou_yu'); const cast = release(g), effect = g.effects.find(effect => effect.type === 'field');
  assert.equal(cast.ultimate.width, 110); assert.equal(effect.ultimate, cast.ultimate);
  cards(g, 'zhou_yu_flame'); assert.equal(g.heroUltimate(g.heroes[0]).width, 90);
  assert.equal(cast.ultimate.width, 110); assert.equal(cast.ultimate.damageMultiplier, 1);
  assert.equal(B.heroes.zhou_yu.ultimate.width, 110);
});
