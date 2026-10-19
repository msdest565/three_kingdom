import test from 'node:test';
import assert from 'node:assert/strict';
import { V1Game } from '../v1-engine.js';
import { BALANCE as B } from '../runtime-data.js';
import { aggregateAttributeEffects } from '../roguelike-system.js';
import { createOilField } from '../camp-upgrade-effects.js';
import { effectiveSynergyTarget } from '../synergy-effects.js';

const near = (actual, expected, message) => assert.ok(Math.abs(actual - expected) < 1e-6, `${message}: ${actual} versus ${expected}`);
function fixture(ids, cards = []) {
  const events = [], game = new V1Game({ mode:'endless', party:ids.map(heroId => ({ heroId })), unlockedCamps:Object.keys(B.camps), onEvent:event => events.push(event) });
  for (const id of cards) { assert.ok(game.tacticDefinition(id), id); game.tactics.add(id); game.tacticCounts[id] = 1; }
  game.attributeEffects = aggregateAttributeEffects(B.tactics, game.tacticCounts);
  game.start(); game._between = 0; game._spawnQueue = [{ at:1e9 }]; game._spawnIndex = 0;
  for (const hero of game.heroes) hero.attackCooldown = 1e9;
  const spawn = (type = 'armor', extra = {}) => Object.assign(game._spawn({ type, progress:game.paths[0].length - 130, lane:0, wave:game._waveConfig(1) }), { hp:1e7, maxHp:1e7, speed:0 }, extra);
  const cast = id => { const hero = game.heroes.find(value => value.id === id); game._beginCast(hero, game._target(hero)); return game._casts.at(-1); };
  const hits = (release, enemy) => events.filter(event => event.type === 'damage' && event.castId === release.id && (!enemy || event.enemyId === enemy.id));
  return { game, events, spawn, cast, hits };
}
const combos = events => events.filter(event => event.type === 'heroCombo');
const total = events => events.reduce((sum, event) => sum + event.amount, 0);

test('settled rally compensation consumes its original actual damage once across vulnerability and guardian reduction', () => {
  const { game, events, spawn, cast, hits } = fixture(['liu_bei', 'guan_yu']);
  const enemy = spawn('boss', { bossTemplateId:'guardian', bossAbilityRemaining:20, damageTakenMultiplier:.75 });
  game._vulnerable(enemy, 1.2, 20, 'interaction_vulnerability');
  const rally = cast('liu_bei'); game.update(.7);
  const settled = total(hits(rally, enemy));
  near(settled, rally.ultimate.damageByClass.boss * 1.2 * .75, 'the settled segment includes incoming vulnerability and damage reduction');
  const blade = cast('guan_yu'); game.update(.8);
  assert.equal(combos(events).length, 1);
  near(total(hits(rally, enemy)), settled * 1.4, 'the asynchronous top-up adds forty percent of actual damage without applying either enemy multiplier twice');
  near(total(hits(blade, enemy)), blade.ultimate.damageByClass.boss * 1.4 * 1.2 * .75, 'the responding first hit receives its multiplier before reduction');
  game.update(2);
  near(total(hits(rally, enemy)), settled * 1.4, 'later updates never settle the source twice');
  assert.equal(combos(events).length, 1);
});

test('a protected earlier victim is excluded from delayed compensation while another real responder hit can commit the combo', () => {
  const { game, events, spawn, cast, hits } = fixture(['liu_bei', 'guan_yu']);
  const protectedEnemy = spawn(), other = spawn('armor', { progress:game.paths[0].length - 150 });
  Object.assign(other, game.pathPoint(other.laneId, other.progress));
  const rally = cast('liu_bei'); game.update(.7);
  const first = total(hits(rally, protectedEnemy)), second = total(hits(rally, other));
  assert.ok(first > 0 && second > 0);
  protectedEnemy.invulnerable = true;
  cast('guan_yu'); game.update(.8);
  assert.equal(combos(events).length, 1);
  near(total(hits(rally, protectedEnemy)), first, 'a source top-up cannot penetrate newly acquired invulnerability');
  near(total(hits(rally, other)), second * 1.4, 'an unprotected settled victim receives exactly one source top-up');
  protectedEnemy.invulnerable = false; game.update(.5);
  near(total(hits(rally, protectedEnemy)), first, 'removing protection cannot replay a completed compensation job');
});

test('Chibi uses the complete responding fire snapshot and attributes all sixteen burn ticks to the initiating wave', () => {
  const { game, events, spawn, cast, hits } = fixture(['sun_quan', 'zhou_yu'], ['zhou_yu_flame', 'zhou_yu_duration', 'attr_ultimate_temper', 'attr_dot_formula', 'fire_oil_embers']);
  const enemy = spawn('boss'), oil = game._addCamp(0, 'fire_oil', 5);
  Object.assign(oil, { x:enemy.x, y:enemy.y, cooldown:1e9 }); createOilField(game, oil, enemy, 80, 8);
  const wave = cast('sun_quan'); game.update(.7);
  const direct = total(hits(wave, enemy));
  near(direct, wave.ultimate.damageByClass.boss * game.heroDamageMultiplier(wave.hero, true) * 1.2, 'the original wave includes the active camp incoming field');
  const fire = cast('zhou_yu'); game.update(.26);
  assert.equal(combos(events).length, 1);
  near(total(hits(wave, enemy)), direct * 2, 'the settled wave doubles before the first extra burn');
  const expectedBurn = fire.ultimate.tickDamageByClass.boss * fire.ultimate.damageMultiplier * game.heroDamageMultiplier(fire.hero, true, true) * 1.2;
  game.update(4.1);
  const allWaveHits = hits(wave, enemy);
  near(total(allWaveHits), direct * 2 + expectedBurn * 16, 'the burn uses fire upgrade, ultimate and DOT bonuses plus target incoming exactly once');
  assert.equal(allWaveHits.length, 18, 'one original hit, one top-up and sixteen source-attributed burns');
  assert.equal(fire.hits.get(enemy.id), 16, 'the responding field retains its original sixteen-hit cap despite its duration card');
  assert.equal(combos(events).length, 1, 'extra burns cannot create another response');
});

test('independent crossbow max-HP damage accepts target synergies while excluding army attribute and faction multipliers', () => {
  for (const [ids, cards, targetFactor] of [
    [['zhuge_liang', 'sima_yi', 'sun_quan'], ['synergy_three_hearts', 'synergy_four_corners'], 1.2],
    [['cao_cao', 'xu_chu', 'sima_yi'], ['synergy_three_hearts'], 1.15]
  ]) {
    const { game, spawn } = fixture(ids, ['crossbow_armor_cone', 'attr_camp_temper', ...cards]);
    const enemy = spawn('boss', { hp:10000, maxHp:10000 }), camp = game._addCamp(0, 'crossbow', 1);
    if (targetFactor === 1.2) game._slow(enemy, .5, 3, 'interaction_slow');
    const body = game._campDamage(camp, enemy, 20), before = enemy.hp;
    game._campHit(camp, enemy, body, 'crossbow');
    near(before - enemy.hp, (body + 300) * targetFactor, 'the independent three percent receives only the applicable enemy-condition multiplier');
    const army = cards.includes('synergy_four_corners') ? 1.45 : 1;
    near(body, 20 * 1.25 * (1 + .1 + .12) * army, 'the projectile body keeps the crossbow class multiplier, additive army pool and independent faction multiplier');
  }
});

test('failed protected responder hits neither consume the combo nor override infantry execution immunity', () => {
  const { game, events, spawn, cast } = fixture(['xu_chu', 'cao_cao', 'sima_yi'], ['synergy_weiwu_xiongfeng']);
  const enemy = spawn('infantry', { hp:500, maxHp:1000, executeImmune:true });
  cast('xu_chu'); assert.ok(enemy.hp > 0 && enemy.hp < 500, 'execution immunity preserves a living actual source hit');
  enemy.invulnerable = true; cast('cao_cao'); game.update(.45);
  assert.equal(combos(events).length, 0); assert.equal(game.heroComboStatus().remaining, 3);
  const hp = enemy.hp; enemy.invulnerable = false;
  cast('cao_cao'); game.update(.45);
  assert.equal(combos(events).length, 1); assert.ok(enemy.hp > 0 && enemy.hp < hp, 'a later successful hit commits once and still respects execute immunity');
});

test('queued heroes and source windows remain frozen across both pause and card-choice time', () => {
  const { game, events, spawn } = fixture(['liu_bei', 'guan_yu', 'zhang_fei'], ['synergy_taoyuan', 'attr_ultimate_break']);
  spawn();
  for (const hero of game.heroes) { hero.rage = game.heroMaxRage(hero); hero.rageRecovery = 0; }
  assert.equal(game.castUltimate('liu_bei').ok, true);
  assert.equal(game.castUltimate('guan_yu').ok, true);
  assert.equal(game.heroes[1].reserved, true);
  near(game.heroes[1].rage, game.heroMaxRage(game.heroes[1]), 'the release gift clamps at the dynamic 108-rage maximum without consuming the queued ally');
  game.update(.7);
  const snapshot = () => JSON.stringify({ time:game.time, casts:game._casts.map(cast => [cast.id, cast.age]), queue:game.skillQueue, count:game.heroComboStatus().count });
  game.pause(); const paused = snapshot(); game.update(60); assert.equal(snapshot(), paused);
  game.resume(); game.state = 'choosing'; const choosing = snapshot(); game.update(60); assert.equal(snapshot(), choosing);
  game.state = 'playing'; game.update(1);
  assert.equal(combos(events).length, 1, 'the queued response still uses the original two-combat-second source window');
  assert.equal(game.skillQueue.length, 0); assert.equal(game.heroes[1].reserved, false);
  assert.ok(game.heroes[1].rageRecovery > 0, 'the queued responder starts its Taoyuan-adjusted personal recovery only when it actually releases');
});

test('a 160-enemy synthetic death-thunder cascade rewards once without refreshing an expired real-hit combo window', () => {
  const { game, events, spawn, cast } = fixture(['sima_yi', 'gan_ning'], ['sima_yi_chain_death']);
  const first = spawn('armor', { progress:400, hp:10000 }); Object.assign(first, game.pathPoint(first.laneId, first.progress));
  const hero = game.heroes[0];
  game._beginCast(hero, { shape:'delayed_multi_circle', x:first.x, y:first.y, circles:[{ x:first.x, y:first.y, radius:1 }], targetIds:[first.id] });
  game.update(1.05); assert.ok(first.deathThunder);
  game.update(2.1);
  const victims = Array.from({ length:158 }, () => spawn('armor', { progress:400, x:first.x + 50, y:first.y, hp:60 }));
  const protectedEnemy = spawn('armor', { progress:400, x:first.x + 50, y:first.y, hp:60, invulnerable:true });
  assert.equal(game.enemies.filter(enemy => enemy.hp > 0).length, 160);
  const rewards = first.reward + victims.reduce((sum, enemy) => sum + enemy.reward, 0), food = game.food;
  game._damage(first, 1e8, 'interaction_chain_trigger');
  assert.equal(game.kills, 159); assert.equal(game.food - food, rewards);
  assert.equal(protectedEnemy.deathThunder, undefined);
  assert.equal(game.stats.perHero.sima_yi.kills, 158, 'propagated death thunder retains the original hero attribution');
  protectedEnemy.invulnerable = false; protectedEnemy.hp = protectedEnemy.maxHp = 100000;
  Object.assign(protectedEnemy, game.pathPoint(protectedEnemy.laneId, protectedEnemy.progress));
  const rain = cast('gan_ning'); game.update(.3);
  assert.ok(rain.hits.get(protectedEnemy.id) > 0, 'the responder actually hits inside the original thunder area');
  assert.equal(combos(events).length, 0, 'synthetic chain damage cannot stand in for a new initiating ultimate hit');
  for (const enemy of victims) game._damage(enemy, 1e8, 'interaction_duplicate');
  assert.equal(game.kills, 159); assert.equal(game.food - food, rewards, 'already dead cascade targets never grant another reward');
});

test('One-Eyed Tiger evaluates each P1 boss-splash recipient against the original landing intersection', () => {
  const { game, events, spawn, hits } = fixture(['xiahou_dun', 'xu_chu'], ['xu_chu_chain']);
  const boss = spawn('boss', { x:200, y:0 }), inside = spawn('cavalry', { x:230, y:0 }), outside = spawn('cavalry', { x:270, y:0 });
  const sourceHero = game.heroes[0], coneHero = game.heroes[1];
  game._beginCast(sourceHero, { shape:'leap_strike_circle', x:200, y:0, radius:40, targetIds:[boss.id, inside.id] });
  const landing = game._casts.at(-1); game._hitCast(landing);
  // Keep the intentionally locked geometric fixture after the source's ordinary push.
  Object.assign(boss, { x:200, y:0 }); Object.assign(inside, { x:230, y:0 }); Object.assign(outside, { x:270, y:0 });
  assert.ok(game._inShape(inside, landing.synergyOriginal.target, landing.ultimate));
  assert.ok(!game._inShape(outside, landing.synergyOriginal.target, landing.ultimate));
  game._beginCast(coneHero, { shape:'frontal_cone', x:0, y:0, angle:0, targetIds:[boss.id, inside.id, outside.id] });
  const cone = game._casts.at(-1);
  assert.equal(combos(events).length, 1);
  near(total(hits(cone, boss)), 390 * 1.5, 'the boss primary hit receives the overlap multiplier');
  near(total(hits(cone, inside)), 150 * 1.5 + 390 * .5 * 1.5, 'both the primary and splash components are amplified for a recipient inside the intersection');
  near(total(hits(cone, outside)), 150 + 390 * .5, 'an outside recipient receives neither inherited primary nor inherited splash amplification');
  assert.equal(combos(events).length, 1, 'splash recipients cannot commit extra combos');
});

test('Changban preserves P1 fast five-pass timing and applies siege push resistance only once alongside P2 roots', () => {
  const { game, events, spawn, cast } = fixture(['zhang_fei', 'zhao_yun'], ['zhao_yun_haste', 'zhao_yun_connect', 'zhao_yun_five_passes', 'shield_eight_gates']);
  const enemy = spawn('siege'), progress = enemy.progress, shield = game._addCamp(0, 'shield', 1);
  Object.assign(shield, { x:enemy.x, y:enemy.y, cooldown:1e9 });
  const roar = cast('zhang_fei');
  near(progress - enemy.progress, 45 * B.enemies.siege.controlEffectFraction, 'the initiating roar applies siege resistance once');
  game.update(.3); const passes = cast('zhao_yun');
  assert.equal(combos(events).length, 1);
  assert.deepEqual(passes.ultimate.passAtSec, [0, .15, .3, .44999999999999996, .6]);
  game.update(.65);
  assert.equal(passes.hits.get(enemy.id), 5, 'the shared living target receives all five P1-speed passes');
  near(progress - enemy.progress, 45 * B.enemies.siege.controlEffectFraction * 1.8, 'the asynchronous eighty-percent push supplement does not square the resistance');
  assert.equal(roar.synergyPushMultiplier, 1.8);
  assert.equal(events.filter(event => event.type === 'campRoot' && event.enemyId === enemy.id).length, 1, 'the P2 shared six-second root lock remains independent of combo hits');
  assert.ok(enemy.nextCampRootAt > game.time);
});

test('Wolong wind-thunder multiplication competes with Gan Ning permanent layers before its separate slow multiplier', () => {
  const { game, spawn, cast } = fixture(['zhuge_liang', 'sima_yi', 'gan_ning'], ['zhuge_liang_memorial', 'synergy_wolong_zhonghu', 'gan_ning_rain', 'gan_ning_bells']);
  const enemy = spawn('boss');
  cast('zhuge_liang'); game.update(1.05); cast('sima_yi'); game.update(1.05);
  const probe = () => { const before = enemy.hp; game._damage(enemy, 100, 'interaction_vulnerability_probe'); return before - enemy.hp; };
  near(probe(), 100 * 1.5 * 1.2 * 1.2, 'P1 wind and synergy thunder multiply before the independent slowed-target effect');
  cast('gan_ning'); game.update(.26);
  assert.equal(enemy.permanentVulnerabilityStacks, 1);
  near(probe(), 100 * 1.5 * 1.2 * 1.2, 'one Gan Ning layer does not additionally multiply the stronger wind-thunder product');
  cast('gan_ning'); game.update(.26);
  assert.equal(enemy.permanentVulnerabilityStacks, 2);
  near(probe(), 100 * 1.35 ** 2 * 1.2, 'two permanent layers can win the strongest-source comparison while Wolong slow stays independent');
});

test('East Wind catches only the real one-and-a-half-length extension on its triggering tick', () => {
  const { game, events, spawn, cast } = fixture(['zhuge_liang', 'zhou_yu']);
  spawn(); cast('zhuge_liang'); game.update(1.05);
  const fire = cast('zhou_yu'), length = fire.target.length, edge = fire.target.s1;
  const late = spawn('armor', { progress:edge - length * 1.25 }), outside = spawn('armor', { progress:edge - length * 1.8 });
  for (const enemy of [late, outside]) Object.assign(enemy, game.pathPoint(enemy.laneId, enemy.progress));
  assert.ok(!game._inShape(late, fire.target, fire.ultimate));
  game.update(.26);
  assert.equal(combos(events).length, 1);
  near(effectiveSynergyTarget(game, fire).length, length * 1.5, 'the public effective target is extended exactly once');
  assert.equal(fire.hits.get(late.id), 1, 'the triggering tick immediately catches a real target in the extra half-length');
  assert.equal(fire.hits.get(outside.id), undefined, 'passing an already expanded target through the hit hook cannot expand the supplemental hit to 2.25 lengths');
  game.update(2.1); const settled = fire.hits.get(late.id); game.update(1.5);
  assert.equal(fire.hits.get(late.id), settled, 'an extension-only target stops taking field hits after the two-second boost expires');
  assert.equal(fire.hits.get(outside.id), undefined);
});

test('the newest eligible source cast owns a single response even when two settled source windows overlap', () => {
  const { game, events, spawn, cast, hits } = fixture(['liu_bei', 'guan_yu']);
  const enemy = spawn('boss'), first = cast('liu_bei'); game.update(.65);
  const second = cast('liu_bei'); game.update(.65);
  const firstDamage = total(hits(first, enemy)), secondDamage = total(hits(second, enemy));
  assert.ok(firstDamage > 0 && secondDamage > 0);
  cast('guan_yu'); game.update(.8);
  assert.equal(combos(events).length, 1);
  near(total(hits(first, enemy)), firstDamage, 'an older eligible cast is not compensated alongside the chosen source');
  near(total(hits(second, enemy)), secondDamage * 1.4, 'the latest actual-hit source alone receives the completed response');
  assert.equal(game._synergyRuntime.responders.size, 1);
});

test('a surviving original area can trigger on a replacement enemy without resurrecting or re-rewarding its dead source victim', () => {
  const { game, events, spawn, cast, hits } = fixture(['liu_bei', 'guan_yu']);
  const original = spawn('armor', { hp:100, maxHp:100 }), rally = cast('liu_bei'); game.update(.7);
  assert.ok(original.hp > 0); game._damage(original, 1e8, 'interaction_remove_original');
  const sourceDamage = total(hits(rally, original)), food = game.food, replacement = spawn('armor', { hp:1000, maxHp:1000, progress:original.progress });
  Object.assign(replacement, game.pathPoint(replacement.laneId, replacement.progress));
  const blade = cast('guan_yu'); game.update(.8);
  assert.equal(combos(events).length, 1, 'the response is based on a valid actual-hit source area rather than the old victim still being alive');
  near(total(hits(blade, replacement)), blade.ultimate.damageByClass.elite * 1.4, 'a replacement target receives the triggering strike bonus');
  near(total(hits(rally, original)), sourceDamage, 'dead source victims cannot receive a synthetic top-up');
  assert.equal(original.hp, 0); assert.equal(game.kills, 1); assert.equal(game.food, food, 'source compensation grants no duplicate kill or reward');
});
