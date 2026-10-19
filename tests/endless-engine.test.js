import test from 'node:test';
import assert from 'node:assert/strict';
import { V1Game, seededRandom } from '../v1-engine.js';
import { BALANCE as B, CONTENT } from '../runtime-data.js';
import { bossCount, bossHp, hpMultiplierTable, waveFood } from '../docs/data/endless-curve.mjs';

const close = (actual, expected, message = '') => assert.ok(Math.abs(actual - expected) < 1e-7, `${message}: ${actual} versus ${expected}`);
const makeGame = (ids = ['guan_yu'], options = {}) => new V1Game({ mode: 'endless', rng: seededRandom(19),
  unlockedCamps: Object.keys(B.camps), party: ids.map(heroId => ({ heroId, level: 1, skillLevel: 1 })), ...options });
function acquire(game, id, count = 1) {
  for (let n = 0; n < count; n++) {
    game.state = 'choosing'; game.upgrades = [{ id, ...B.tactics[id] }];
    assert.equal(game.selectUpgrade(id).ok, true, id);
  }
}
function heldGame(ids, options) {
  const game = makeGame(ids, options); game.start();
  game._between = 0; game._spawnQueue = [{ at: 1e9 }]; game._spawnIndex = 0;
  return game;
}
function enemy(game, type = 'cavalry', options = {}) {
  const value = game._spawn({ type, lane: 0, wave: game._waveConfig(Math.max(1, game.wave)), progress: 300 });
  return Object.assign(value, { speed: 0, hp: 100000, maxHp: 100000 }, options);
}
function projectile(game, camp, target, damage = game._campStats(camp).damage) {
  game.projectiles.push({ type: camp.type, campType: camp.type, camp, x: target.x, y: target.y,
    targetId: target.id, targetX: target.x, targetY: target.y, speed: 1000, damage, life: 4 });
}

test('endless owns its session without mutating sixty campaign levels or global mode defaults', () => {
  const before = JSON.stringify(CONTENT.levels), camps = Object.keys(B.camps);
  const endless = makeGame(['guan_yu', 'cao_cao', 'zhou_yu']);
  assert.equal(endless.mode, 'endless'); assert.equal(endless.heroes.length, 3);
  assert.equal(endless.maxCampLevel, 5); assert.equal(endless.waveCount, 80);
  assert.equal(endless.food, 120); assert.equal(endless.maxHp, 100);
  assert.equal(endless.level.mapId, 'wei_gate'); assert.equal(endless.tier.hpMultiplier, 1);
  const campaign = new V1Game({ party: ['guan_yu', 'cao_cao'].map(heroId => ({ heroId })), unlockedCamps: camps });
  assert.equal(campaign.mode, 'campaign'); assert.equal(campaign.maxCampLevel, 3);
  assert.equal(campaign.heroes.length, 1); assert.equal(campaign.waveCount, campaign.level.waves.length);
  assert.equal(JSON.stringify(CONTENT.levels), before);
});

test('all six camps reach level five only in endless, with technology on each level base', () => {
  for (const type of Object.keys(B.camps)) {
    const game = makeGame(['guan_yu'], { campTech: { [type]: 10 } }); game.food = 10000;
    assert.equal(game.build(0, type).ok, true);
    for (let level = 2; level <= 5; level++) {
      assert.equal(game.getUpgradeCost(0), B.camps[type].levels[level - 1].upgradeCost);
      assert.equal(game.upgrade(0).ok, true);
    }
    const camp = game.camps[0], base = B.camps[type].levels[4], bonuses = B.technology.camps[type].perLevelBonuses;
    assert.equal(game.getUpgradeCost(0), null); assert.equal(game.upgrade(0).ok, false);
    close(camp.range, base.range + Math.min(15, 10 * (bonuses.range || 0)));
    if (base.damage) close(game._campStats(camp).damage, base.damage * (1 + Math.min(.25, 10 * (bonuses.damage || 0))));
    const story = new V1Game({ unlockedCamps: [type] }); story.camps = []; story.food = 10000; story.build(0, type);
    story.upgrade(0); story.upgrade(0); assert.equal(story.getUpgradeCost(0), null);
    assert.equal(story.upgrade(0).ok, false); assert.equal(story.camps[0].level, 3);
  }
});

test('all 80 generated queues conserve the reference counts, bosses and economy', () => {
  const game = makeGame(), hp = hpMultiplierTable(80);
  for (let wave = 1; wave <= 80; wave++) {
    game._startWave(wave); const config = game._waveConfig(wave);
    assert.equal(game._spawnQueue.length, config.count + bossCount(wave), `wave ${wave} count`);
    assert.equal(game._spawnQueue.filter(spec => spec.boss).length, bossCount(wave));
    close(config.hpMultiplier, hp[wave]);
    assert.equal(game._spawnQueue.reduce((sum, spec) => sum + spec.reward, 0) + config.completionFoodReward, waveFood(wave));
    assert.ok(game._spawnQueue.every(spec => Number.isInteger(spec.reward) && spec.reward >= 0));
  }
});

test('endless spawns use one HP scaling pass and party factors only for elite and bosses', () => {
  const game = makeGame(['guan_yu', 'cao_cao', 'zhou_yu']); game._startWave(80);
  const wave = game._waveConfig(80);
  const infantry = game._spawn({ type: 'infantry', wave });
  const armor = game._spawn({ type: 'armor', wave });
  const boss = game._spawn(game._spawnQueue.find(spec => spec.boss));
  assert.equal(infantry.hp, Math.ceil(28 * wave.hpMultiplier));
  assert.equal(armor.hp, Math.ceil(55 * wave.hpMultiplier * 1.9));
  assert.equal(boss.hp, Math.ceil(bossHp(80) * 1.9));
  close(infantry.speed, 30 * 1.25);
});

test('clearing wave 80 grants its food and a choice, then continues to wave 81', () => {
  const game = makeGame(); game.state = 'playing'; game._startWave(80);
  const config = game._waveConfig(80), initial = game.food;
  for (const spec of game._spawnQueue) game._damage(game._spawn(spec), 1e12, 'test');
  game._spawnQueue = []; game._spawnIndex = 0; game._step(1 / 60);
  assert.equal(game.state, 'choosing'); assert.equal(game.upgrades.length, 3);
  assert.equal(game.food - initial, waveFood(80));
  game.update(10); assert.equal(game.state, 'choosing');
  assert.equal(game.skipTactics().ok, true); game.update(B.referencePacing.betweenWavesSec + .01);
  assert.equal(game.wave, 81); assert.equal(game.state, 'playing');
  assert.equal(game._waveConfig(80), config, 'a generated wave is stable for the run');
});

test('26 attribute cards can repeat without exhausting the pool, and benefits geometrically decay', () => {
  const game = makeGame(), attributes = Object.entries(B.tactics).filter(([, card]) => card.category === 'attribute');
  assert.equal(attributes.length, 26);
  for (const [id] of attributes) acquire(game, id, 2);
  acquire(game, 'attr_camp_temper', 8);
  close(game.attributeEffects.campDamageBonus, .1 * (1 - .85 ** 10) / .15 + .07 * 1.85);
  close(game.attributeEffects.gateHpAdd, 24);
  assert.equal(game.tacticCounts.attr_camp_temper, 10);
  assert.equal(game.tactics.has('attr_camp_temper'), true);
  for (let offer = 0; offer < 100; offer++) {
    game._offerTactics(); assert.equal(game.upgrades.length, 3); assert.equal(new Set(game.upgrades.map(c => c.id)).size, 3);
  }
});

test('refresh, skip and cross-wave locking spend exact resources and preserve the paused clock', () => {
  const game = heldGame(); game._offerTactics(); game.food = 1000;
  const locked = game.upgrades[0].id; assert.equal(game.lockTactic(locked).ok, true);
  assert.equal(game.locksRemaining, 2); assert.equal(game.lockTactic(locked).ok, false);
  assert.equal(game.getRerollCost(), 40); assert.equal(game.rerollTactics().ok, true);
  assert.equal(game.food, 960); assert.equal(game.getRerollCost(), 80);
  assert.ok(game.upgrades.some(card => card.id === locked));
  const before = game.time; game.update(5); assert.equal(game.time, before);
  game.selectUpgrade(game.upgrades.find(card => card.id !== locked).id);
  game._offerTactics(); assert.ok(game.upgrades.some(card => card.id === locked));
  game.selectUpgrade(locked); assert.equal(game.lockedTacticId, null);
  game._offerTactics(); const food = game.food; game.skipTactics(); assert.equal(game.food, food + 25);
  const story = new V1Game(); assert.equal(story.rerollTactics().ok, false); assert.equal(story.getRerollCost(), null);
});

test('wall capacity, first-leak mitigation, minimum damage and start-wave healing form an ordered chain', () => {
  const game = makeGame(); acquire(game, 'attr_gate_build'); acquire(game, 'attr_gate_earth');
  assert.equal(game.maxHp, 122); assert.equal(game.hp, 122);
  acquire(game, 'attr_gate_repair'); acquire(game, 'attr_gate_outer'); acquire(game, 'attr_gate_parapet');
  game.hp = 90; game._buffs.push({ kind: 'gate', factor: .7, remaining: 99 }); game._startWave(1);
  assert.equal(game.hp, 94);
  game._escape(enemy(game, 'boss', { leak: 10, escapeDamageMultiplier: 1 })); close(game.hp, 93);
  game._escape(enemy(game, 'boss', { leak: 10, escapeDamageMultiplier: 1 })); close(game.hp, 88);
  game._startWave(2); close(game.hp, 92);
  game._escape(enemy(game, 'boss', { leak: 10, escapeDamageMultiplier: 1 })); close(game.hp, 91);
  acquire(game, 'attr_gate_outer'); game._startWave(3); const before = game.hp;
  game._escape(enemy(game, 'boss', { leak: 100, escapeDamageMultiplier: 1 })); close(game.hp, before, 'stacked first-leak reduction can fully absorb');
  game._gateImmunitiesRemaining = 1; game._escape(enemy(game, 'boss', { leak: 100 })); close(game.hp, before);
});

test('iron casting raises capacity but pays current health immediately and cannot be rescued after death', () => {
  const game = makeGame(); game.hp = 60; acquire(game, 'attr_gate_iron');
  assert.equal(game.maxHp, 125); assert.equal(game.hp, 40);
  const dying = makeGame(); acquire(dying, 'attr_gate_repair'); dying.hp = 19;
  acquire(dying, 'attr_gate_iron'); assert.equal(dying.hp, 0); assert.equal(dying.state, 'lost');
});

test('moat slows enemies only near the gate and repeated copies retain their 100-unit boundary', () => {
  const game = heldGame(); acquire(game, 'attr_gate_moat', 2); game._between = 0;
  const near = enemy(game, 'cavalry', { speed: 36, progress: game.paths[0].length - 40 });
  const far = enemy(game, 'cavalry', { speed: 36, progress: game.paths[0].length - 200 });
  Object.assign(near, game.pathPoint(0, near.progress)); Object.assign(far, game.pathPoint(0, far.progress));
  const nearBefore = near.progress, farBefore = far.progress; game._step(.01);
  close(near.progress - nearBefore, 36 * .7 * .01); close(far.progress - farBefore, 36 * .01);
});

test('army cards affect real camp damage by armor, elite and boss class; speed and range keep separate axes', () => {
  const game = makeGame(); game.food = 10000; game.build(0, 'archer'); const camp = game.camps[0];
  for (const id of ['attr_camp_temper','attr_camp_steel','attr_camp_elite','attr_camp_boss','attr_camp_haste','attr_camp_drill','attr_camp_sight']) acquire(game, id);
  close(game._campDamage(camp, enemy(game, 'infantry'), 100), 117);
  close(game._campDamage(camp, enemy(game, 'armor'), 100), 140);
  close(game._campDamage(camp, enemy(game, 'boss'), 100), 142);
  close(camp.range, B.camps.archer.levels[0].range + 14);
  close(game._campInterval(camp), .9 * .93 / 1.06);
  game.food = 10000; game.build(1, 'war_drum'); const drum = game.camps[1]; drum.x = camp.x; drum.y = camp.y;
  drum.level = 5; game._updateCamp(drum);
  close(game._friendlySpeed(camp), .3, 'drum and drill share the existing cap');
  close(game._campInterval(camp), .9 * .93 / 1.3);
});

test('overlap caps at five camps and low-wall and party bonuses reach both heroes and camps', () => {
  const game = makeGame(['guan_yu', 'cao_cao', 'zhou_yu']); game.food = 10000;
  const target = enemy(game); for (let slot = 0; slot < 6; slot++) { game.build(slot, 'archer'); Object.assign(game.camps.at(-1), { x: target.x, y: target.y }); }
  acquire(game, 'attr_camp_overlap'); acquire(game, 'attr_army_resolve'); acquire(game, 'attr_gate_laststand', 2);
  game.hp = 20; close(game.heroDamageMultiplier(game.heroes[0]), 1.78);
  close(game._campDamage(game.camps[0], target, 100), 178);
  const hp = target.hp; game._damage(target, 100, 'test'); close(hp - target.hp, 120);
  game.hp = 40; close(game.heroDamageMultiplier(game.heroes[0]), 1.18, 'repeated last-stand cards never widen the 35% threshold');
});

test('hero attack speed, attack power, ultimate power, DoT and dread bonuses are consumed by combat', () => {
  const game = heldGame(['zhou_yu']); const hero = game.heroes[0], target = enemy(game, 'cavalry', { x: hero.x, y: hero.y });
  for (const id of ['attr_hero_martial','attr_hero_guard','attr_ultimate_temper','attr_ultimate_break','attr_dot_formula','attr_hero_dread']) acquire(game, id);
  game._between = 0; const before = target.hp; game._attackHeroes(.01);
  close(before - target.hp, hero.definition.attack.damage * 1.12);
  close(hero.attackCooldown, hero.definition.attack.intervalSec / 1.1);
  const cast = { id: 1, hero, heroId: hero.id, hits: new Map(), kills: 0, target: { shape: 'circle_shock', x: target.x, y: target.y, radius: 100 } };
  game.stats.perHero[hero.id] = { casts: 0, kills: 0 }; const hp = target.hp; game._hitCast(cast);
  close(hp - target.hp, hero.definition.ultimate.tickDamageByClass.ordinary * 1.67 * 1.1);
  assert.equal(target.vulnerability.find(v => v.source === 'attribute_dread').remaining, 5);
  game._vulnerable(target, 1.2, 5, 'existing_skill'); const second = target.hp; game._damage(target, 100, 'test');
  close(second - target.hp, 132, 'dread multiplies existing skill vulnerability');
  game.food = 10000; game.build(0, 'fire_oil'); close(game._campDamage(game.camps[0], target, 10), 13);
});

test('damage cards share one additive pool across oil, class bonuses, army bonuses and persistent ultimates', () => {
  const game = makeGame(['zhou_yu', 'cao_cao', 'guan_yu']); game.food = 10000; game.build(0, 'fire_oil'); const oil = game.camps[0];
  for (const id of ['attr_camp_temper','attr_camp_steel','attr_camp_elite','attr_camp_boss','attr_dot_formula','attr_army_resolve','attr_gate_laststand','attr_ultimate_temper']) acquire(game, id);
  game.hp = 20;
  // Oil versus armor: 10% camp + 7% steel + 5% armor + 18% elite + 30% DoT + 18% party + 30% low-wall.
  close(game._campDamage(oil, enemy(game, 'armor'), 100), 218);
  // Boss swaps the armor/elite conditions for its 25% condition.
  close(game._campDamage(oil, enemy(game, 'boss'), 100), 220);
  const hero = game.heroes[0]; close(game.heroDamageMultiplier(hero, true, true), 1 + .15 + .3 + .18 + .3);
  close(game.heroDamageMultiplier(hero, true), 1 + .15 + .18 + .3);
  const plain = makeGame(); plain.food = 10000; plain.build(0, 'fire_oil'); acquire(plain, 'attr_camp_temper'); acquire(plain, 'attr_dot_formula');
  close(plain._campDamage(plain.camps[0], enemy(plain), 100), 140);
});

test('rage cards raise storage and cost together, and only card recovery gains rage in the six-second lockout', () => {
  const game = heldGame(); acquire(game, 'attr_rage_flow'); acquire(game, 'attr_rage_recovery'); acquire(game, 'attr_ultimate_break');
  game._between = 0; const hero = game.heroes[0]; hero.rage = 100;
  close(game.heroRageCost(hero), 108); close(game.maxRage, 108); assert.equal(game.castUltimate().ok, false);
  hero.rage = 108; assert.equal(game.castUltimate().ok, true); close(hero.rage, 0);
  game.update(4); close(hero.rage, 4 * .6 * 1.12); close(hero.rageRecovery, 2);
  game.update(2); close(hero.rage, 4 * .6 * 1.12); close(hero.rageRecovery, 0);
  game.update(1); close(hero.rage, 4 * .6 * 1.12 + 1.12);
  game.update(200); close(hero.rage, 108);
  const plain = heldGame(); plain.heroes[0].rage = 100; plain.castUltimate(); plain.update(4); assert.equal(plain.rage, 0);
});

test('levy pays its decayed bonus exactly once per cleared wave', () => {
  const game = heldGame(); acquire(game, 'attr_food_levy', 3); game._between = 0;
  game._spawnQueue = []; const before = game.food; game._step(.01);
  close(game.food - before, game._waveConfig(1).completionFoodReward + 18 * (1 + .85 + .85 ** 2));
  const after = game.food; game._step(.01); close(game.food, after);
});

test('early rage recovery never bypasses automatic casts or consumes a queued request during lockout', () => {
  const game = heldGame(); acquire(game, 'attr_rage_flow', 30); acquire(game, 'attr_rage_recovery', 30);
  game._between = 0; const hero = game.heroes[0];
  const target = enemy(game, 'cavalry', { progress: game.paths[0].length - 50, hp: 1e9, maxHp: 1e9 });
  Object.assign(target, game.pathPoint(0, target.progress));
  hero.auto = true; hero.rage = 100; hero.rageRecovery = 0;
  game.castUltimate(); const casts = game.stats.ultimateCasts;
  game._canAuto = () => true; game.update(4);
  close(hero.rage, 100); close(hero.rageRecovery, 2);
  assert.equal(game.stats.ultimateCasts, casts); assert.equal(game.skillQueue.length, 0);
  game._enqueue(hero, false, game._target(hero));
  assert.equal(game.skillQueue.length, 1); assert.equal(hero.reserved, true);
  game.update(1.9); assert.equal(game.stats.ultimateCasts, casts); assert.equal(game.skillQueue.length, 1);
  game.update(.11); assert.equal(game.stats.ultimateCasts, casts + 1); assert.equal(game.skillQueue.length, 0);
  assert.ok(target.hp > 0);
});

test('level-five archer adds a real half-damage arrow and crossbow resets only after an elite kill', () => {
  const game = makeGame(['guan_yu'], { rng: () => 0 }); game.food = 10000; game.build(0, 'archer');
  const archer = game.camps[0]; archer.level = 5; game._updateCamp(archer);
  const target = enemy(game, 'armor', { x: archer.x, y: archer.y }); game._attackCamps(.01);
  assert.equal(game.projectiles.length, 2); close(game.projectiles[1].damage, 47 * .5);
  const before = target.hp; game._projectiles(1); close(before - target.hp, 47 * 1.5);
  game.camps = []; game.build(0, 'crossbow'); const crossbow = game.camps[0]; crossbow.level = 5; game._updateCamp(crossbow);
  const elite = enemy(game, 'armor', { hp: 1, x: crossbow.x, y: crossbow.y }); crossbow.cooldown = 1;
  projectile(game, crossbow, elite); game._projectiles(.01); assert.equal(crossbow.cooldown, 0);
  const ordinary = enemy(game, 'infantry', { hp: 1, x: crossbow.x, y: crossbow.y }); crossbow.cooldown = 1;
  projectile(game, crossbow, ordinary); game._projectiles(.01); assert.equal(crossbow.cooldown, 1);
});

test('level-five catapult keeps the six-hit budget while applying its stronger slow to every target', () => {
  const game = makeGame(); game.food = 10000; game.build(0, 'catapult'); const camp = game.camps[0]; camp.level = 5; game._updateCamp(camp);
  const targets = Array.from({ length: 9 }, () => enemy(game, 'cavalry', { x: camp.x, y: camp.y }));
  projectile(game, camp, targets[0]); game._projectiles(.01);
  assert.equal(targets.filter(e => e.hp < 100000).length, 6);
  assert.ok(targets.every(e => e.slowEffects[0].factor === .75 && e.slowEffects[0].remaining === 1.5));
});

test('level-five shield amplifies every damage source and drum amplifies only nearby camps', () => {
  const game = makeGame(); game.food = 10000; game.build(0, 'shield'); const shield = game.camps[0]; shield.level = 5; game._updateCamp(shield);
  const target = enemy(game, 'cavalry', { x: shield.x, y: shield.y }); const before = target.hp;
  game._damage(target, 100, 'hero_guan_yu'); close(before - target.hp, 108);
  game.camps = []; game.build(0, 'archer'); game.build(1, 'war_drum'); const [archer, drum] = game.camps;
  Object.assign(drum, { x: archer.x, y: archer.y, level: 5 }); game._updateCamp(drum);
  close(game._campDamage(archer, target, 100), 108); close(game.heroDamageMultiplier(game.heroes[0]), 1);
});

test('level-five oil uses its four-second field and gives edge grazes one second of real burn without a duplicate inner tick', () => {
  const game = makeGame(); game.food = 10000; game.build(0, 'fire_oil'); const camp = game.camps[0]; camp.level = 5; game._updateCamp(camp);
  const center = enemy(game, 'cavalry', { x: camp.x, y: camp.y }); projectile(game, camp, center, 0); game._projectiles(.01);
  assert.equal(camp.field.remaining, 4); assert.equal(camp.field.radius, 70); assert.equal(game.effects.find(e => e.type === 'oil').life, 4);
  const edge = enemy(game, 'cavalry', { x: camp.x + 70 + center.radius + 6, y: camp.y }); game._oilField(camp, .01);
  assert.equal(edge.oilBurns[0].remaining, 1); const before = edge.hp;
  game._oilBurns(.75); close(before - edge.hp, 9);
  edge.x = camp.x; edge.oilBurns[0].tick = 0; const inner = edge.hp; game._oilBurns(.01); close(edge.hp, inner);
});
