import test from 'node:test';
import assert from 'node:assert/strict';
import { V1Game, seededRandom } from '../v1-engine.js';
import { BALANCE as B } from '../runtime-data.js';
import { CombatClock } from '../combat-clock.js';

const close = (actual, expected, message) => assert.ok(Math.abs(actual - expected) < 1e-7, message || `${actual} != ${expected}`);
const signature = (heroId, slot = 'weapon', quality = slot === 'weapon' ? 'gold' : 'red', level = 0) => ({ templateId: `signature_${heroId}_${slot}`, quality, level });
function fixture({ heroId = 'guan_yu', campTech = {}, equipment = {}, party, levelId = 'shu_011' } = {}) {
  const game = new V1Game({ levelId, campTech, party: party || [{ heroId, level: 20, skillLevel: 4, equipment }],
    unlockedCamps: Object.keys(B.camps), rng: seededRandom(7) });
  game.start(); game.camps = []; game.food = 10000; game._spawnQueue = [{ at: 1e6 }]; game._spawnIndex = 0;
  return game;
}
function enemy(game, type = 'armor', point = {}, extra = {}) {
  const e = game._spawn({ type, lane: 0, progress: 400, wave: game.level.waves[0] });
  Object.assign(e, { hp: 100000, maxHp: 100000, speed: 0 }, point, extra); return e;
}

test('military technology is an immutable clamped snapshot and buffs free camps too', () => {
  const requested = { shield: 10, archer: 2.9, catapult: 99, crossbow: -3, fire_oil: Infinity, war_drum: '4', unknown: 10 };
  const game = new V1Game({ levelId: 'wei_001', campTech: requested });
  requested.shield = 0;
  assert.deepEqual(game.campTech, { shield: 10, archer: 2, catapult: 10, crossbow: 0, fire_oil: 0, war_drum: 4 });
  assert.ok(Object.isFrozen(game.campTech)); assert.throws(() => { game.campTech.shield = 0; }, TypeError);
  const free = game.camps.find(c => c.type === 'shield');
  close(free.range, B.camps.shield.levels[0].range + 15);
  close(game._campStats(free).damage, B.camps.shield.levels[0].damage * 1.25);
  const plain = new V1Game(); assert.ok(Object.values(plain.campTech).every(level => level === 0));
});

test('technology changes actual attacks for all five damaging camps without extra cadence or target budgets', () => {
  for (const type of ['shield', 'archer', 'catapult', 'crossbow', 'fire_oil']) {
    const game = fixture({ campTech: { [type]: 10 } });
    assert.ok(game.build(game.map.campSlots[0].slot, type).ok);
    const camp = game.camps[0]; const victim = enemy(game, 'infantry', { x: camp.x, y: camp.y - 10 });
    const base = B.camps[type].levels[0];
    close(game._campInterval(camp), base.intervalSec, type + ' interval');
    game._attackCamps(0); game._projectiles(1);
    if (type === 'fire_oil') game._oilField(camp, .75);
    close(100000 - victim.hp, (base.damage || base.tickDamage) * 1.25, type + ' real attack');
    if (base.maxTargets) assert.equal(game._campStats(camp).maxTargets, base.maxTargets);
    if (base.speedFactor) assert.equal(game._campStats(camp).speedFactor, base.speedFactor);
    if (base.blastRadius) assert.equal(game._campStats(camp).blastRadius, base.blastRadius);
    if (base.fieldRadius) assert.equal(game._campStats(camp).fieldRadius, base.fieldRadius);
    assert.equal(victim.slowEffects[0]?.remaining, type === 'catapult' ? 1.5 : undefined);
  }
});

test('technology increases real targeting range, retains map modifiers and all battle upgrade levels', () => {
  const normal = fixture(); const trained = fixture({ campTech: { archer: 10 } });
  for (const game of [normal, trained]) {
    game.build(game.map.campSlots[0].slot, 'archer');
    const camp = game.camps[0]; enemy(game, 'infantry', { x: camp.x + B.camps.archer.levels[0].range + 12, y: camp.y }, { radius: 0 });
    game._attackCamps(0);
  }
  assert.equal(normal.projectiles.length, 0); assert.equal(trained.projectiles.length, 1);
  const camp = trained.camps[0];
  for (let level = 1; level <= 3; level++) {
    close(trained._campStats(camp).damage, B.camps.archer.levels[level - 1].damage * 1.25);
    close(camp.range, B.camps.archer.levels[level - 1].range + 15);
    if (level < 3) assert.ok(trained.upgrade(camp.slot).ok);
  }
  const mod = fixture({ campTech: { archer: 10 }, levelId: 'wei_006' }); mod.build(6, 'archer');
  close(mod.camps[0].range, (B.camps.archer.levels[0].range + 15) * 1.1);
});

test('maximum catapult technology still damages at most six units and keeps its independent slow', () => {
  const game = fixture({ campTech: { catapult: 10 } }); game.build(game.map.campSlots[0].slot, 'catapult');
  const camp = game.camps[0]; const victims = Array.from({ length: 12 }, () => enemy(game, 'armor', { x: 200, y: 350 }));
  game.projectiles.push({ type: 'catapult', camp, x: 200, y: 350, targetX: 200, targetY: 350,
    damage: game._campStats(camp).damage, speed: 225, life: 1 });
  game._projectiles(1 / 60);
  assert.equal(victims.filter(e => e.hp < 100000).length, 6);
  assert.ok(victims.every(e => e.slowEffects.length === 1 && e.slowEffects[0].remaining === 1.5));
  assert.ok(victims.every(e => Math.abs(e.slowEffects[0].factor - .86) < 1e-7));
  assert.equal(game._campInterval(camp), 3);
});

test('drum technology adds only the strongest local camp damage aura and never adds hero damage or rage', () => {
  const game = fixture({ campTech: { war_drum: 10 } });
  const slots = game.map.campSlots.map(s => s.slot);
  game._addCamp(slots[0], 'archer', 1); game._addCamp(slots[1], 'war_drum', 3); game._addCamp(slots[2], 'war_drum', 3);
  for (const camp of game.camps) Object.assign(camp, { x: 200, y: 400 });
  const receiver = game.camps[0]; const victim = enemy(game, 'infantry');
  close(game._campDamage(receiver, victim, 100), 102);
  close(game._friendlySpeed(receiver), .2);
  close(game.heroDamageMultiplier(game.heroes[0]), 1.19);
  receiver.x = 1000; close(game._campDamage(receiver, victim, 100), 100);
  const before = game.rage; game.update(1); close(game.rage - before, 1);
});

test('all fifteen signature weapons and horses require matching owner, slot, quality and known template', () => {
  for (const heroId of Object.keys(B.heroes)) {
    for (const slot of ['weapon', 'horse']) {
      const template = B.metaProgression.equipment.templates[`signature_${heroId}_${slot}`]; assert.ok(template, heroId);
      const matching = fixture({ heroId, equipment: { [slot]: signature(heroId, slot) } });
      assert.equal(matching.heroes[0].equipment[slot].templateId, template.id);
      for (const [property, bonus] of Object.entries(template.signatureBonuses)) close(matching.heroes[0].signatureBonuses[property], bonus);
      const foreignId = heroId === 'guan_yu' ? 'xiahou_dun' : 'guan_yu';
      const foreign = fixture({ heroId: foreignId, equipment: { [slot]: signature(heroId, slot) } });
      assert.ok(Object.values(foreign.heroes[0].signatureBonuses).every(v => v === 0), heroId + ' foreign gear');
      const wrongQuality = fixture({ heroId, equipment: { [slot]: signature(heroId, slot, 'white') } });
      assert.ok(Object.values(wrongQuality.heroes[0].signatureBonuses).every(v => v === 0));
      const wrongSlot = fixture({ heroId, equipment: { armor: signature(heroId, slot) } });
      assert.ok(Object.values(wrongSlot.heroes[0].signatureBonuses).every(v => v === 0));
    }
  }
  const unknown = fixture({ equipment: { weapon: { templateId: 'signature_unknown_weapon', quality: 'gold', level: 10 } } });
  close(unknown.heroDamageMultiplier(unknown.heroes[0]), 1.19 * 1.05);
  assert.ok(Object.values(unknown.heroes[0].signatureBonuses).every(v => v === 0));
});

test('weapon upgrades, rarity, role, skill and exclusive damage multiply once for real attacks', () => {
  for (const heroId of ['xiahou_dun', 'zhang_liao', 'zhou_yu', 'lv_meng']) {
    const game = fixture({ heroId, equipment: { weapon: signature(heroId, 'weapon', 'gold', 10) } });
    const hero = game.heroes[0]; const template = B.metaProgression.equipment.templates[`signature_${heroId}_weapon`];
    const ordinary = enemy(game, 'cavalry', { x: hero.x, y: hero.y - 10 });
    const basic = B.heroes[heroId].attack.damage * 1.19 * 1.11 * (1 + (template.signatureBonuses.basicDamageAdd || 0));
    game._attackHeroes(0); close(100000 - ordinary.hp, basic, heroId + ' real basic');
    const elite = enemy(game, 'armor', { x: hero.x, y: hero.y - 10 });
    const target = game._target(hero);
    game._hitCast({ hero, heroId, target, hits: new Map(), kills: 0 });
    const u = B.heroes[heroId].ultimate;
    const table = u.tickDamageByClass || u.damagePerPassByClass || u.damagePerMineByClass || u.damageByClass;
    close(100000 - elite.hp, table.elite * 1.19 * 1.11 * 1.15 * (1 + (template.signatureBonuses.ultimateDamageAdd || 0)), heroId + ' real active');
  }
  const foreign = fixture({ equipment: { weapon: signature('xiahou_dun', 'weapon', 'gold', 10) } });
  close(foreign.heroDamageMultiplier(foreign.heroes[0], true), 1.19 * 1.11 * 1.15);
});

test('Guan Yu and Zhang Fei preview widths match real exclusive damage coverage without extra execute rules', () => {
  for (const heroId of ['guan_yu', 'zhang_fei']) {
    const game = fixture({ heroId, equipment: { weapon: signature(heroId) } }); const hero = game.heroes[0];
    if (heroId === 'guan_yu') game.tactics.add('guan_yu_width');
    const target = game._target(hero); const expected = hero.definition.ultimate.width + hero.signatureBonuses.ultimateWidthAdd + (heroId === 'guan_yu' ? 24 : 0);
    assert.equal(target.width, expected);
    const forward = 100; const side = expected / 2 - 1;
    const x = target.x + forward * Math.cos(target.angle) - side * Math.sin(target.angle);
    const y = target.y + forward * Math.sin(target.angle) + side * Math.cos(target.angle);
    const inside = enemy(game, 'armor', { x, y }, { radius: 0 });
    const outside = enemy(game, 'armor', { x: x - 3 * Math.sin(target.angle), y: y + 3 * Math.cos(target.angle) }, { radius: 0 });
    const infantry = enemy(game, 'infantry', { x, y }, { radius: 0 });
    game.stats.perHero[heroId] = { casts: 1, kills: 0 };
    const cast = { hero, heroId, target, hits: new Map(), kills: 0 }; game._hitCast(cast);
    assert.ok(inside.hp > 0 && inside.hp < 100000); assert.equal(outside.hp, 100000); assert.equal(infantry.hp, 0);
    assert.equal(cast.hits.get(inside.id), 1);
  }
});

test('exclusive horse range and weapon range stack with ordinary rarity only for the corresponding hero', () => {
  const guan = fixture({ equipment: { horse: signature('guan_yu', 'horse', 'red', 4) } });
  assert.equal(guan.heroBasicRange(guan.heroes[0]), B.heroes.guan_yu.attack.range + 8 + 12 + 12);
  const sima = fixture({ heroId: 'sima_yi', equipment: { weapon: signature('sima_yi'), horse: signature('sima_yi', 'horse', 'red', 4) } });
  assert.equal(sima.heroBasicRange(sima.heroes[0]), B.heroes.sima_yi.attack.range + 8 + 12 + 8 + 16);
  const wrong = fixture({ equipment: { horse: signature('sima_yi', 'horse', 'red', 4) } });
  assert.equal(wrong.heroBasicRange(wrong.heroes[0]), B.heroes.guan_yu.attack.range + 8 + 12);
});

test('team exclusive bonuses retain independent command and gate caps and affect actual camps', () => {
  const party = ['cao_cao', 'sun_quan', 'liu_bei'].map(heroId => ({ heroId, equipment: {
    weapon: signature(heroId), armor: { quality: 'red', level: 10 }, command_token: { quality: 'red', level: 10 } } }));
  const game = fixture({ party });
  close(game.teamSignatureCommand, .03); close(game.teamCommand, .15);
  close(game.teamSignatureArmor, .05); close(game.teamArmor, .185); assert.equal(game.maxHp, 119);
  game.build(game.map.campSlots[0].slot, 'shield'); const camp = game.camps[0];
  const target = enemy(game, 'infantry', { x: camp.x, y: camp.y }); game._attackCamps(0);
  close(100000 - target.hp, B.camps.shield.levels[0].damage * 1.15);
});

test('gold rarity belongs only to known gold weapon templates, including on a different hero', () => {
  for (const slot of ['weapon', 'armor', 'command_token', 'horse']) {
    const entries = [
      { templateId: 'unknown', quality: 'gold', level: 5 },
      { templateId: `basic_${slot}`, quality: 'gold', level: 5 },
      ...(slot !== 'weapon' ? [signature('guan_yu', 'weapon', 'gold', 5)] : [signature('guan_yu', 'horse', 'gold', 5)])
    ];
    for (const entry of entries) {
      const game = fixture({ equipment: { [slot]: entry } });
      assert.equal(game.heroes[0].equipment[slot].quality, 'white');
      assert.equal(game.heroes[0].equipment[slot].level, 5);
      assert.equal(game.heroes[0].equipment[slot].signatureActive, false);
      assert.ok(Object.values(game.heroes[0].signatureBonuses).every(v => v === 0));
    }
  }
  const wrongHero = fixture({ equipment: { weapon: signature('xiahou_dun', 'weapon', 'gold', 5) } });
  assert.equal(wrongHero.heroes[0].equipment.weapon.quality, 'gold');
  assert.equal(wrongHero.heroes[0].equipment.weapon.signatureActive, false);
  close(wrongHero.heroDamageMultiplier(wrongHero.heroes[0]), 1.19 * 1.085);
  const empty = fixture({ equipment: { weapon: null, armor: null, horse: null, command_token: null } });
  close(empty.heroDamageMultiplier(empty.heroes[0]), 1.19);
  close(empty.heroBasicRange(empty.heroes[0]), B.heroes.guan_yu.attack.range);
});

test('technology and signature gear retain queue, pause and identical one/one-and-half/two speed timing', () => {
  const results = [1, 1.5, 2].map(speed => {
    const game = fixture({ campTech: { shield: 10, catapult: 10, war_drum: 10 }, party: ['guan_yu', 'zhou_yu', 'xiahou_dun'].map(heroId => ({ heroId, level: 20, skillLevel: 4,
      equipment: { weapon: signature(heroId), horse: signature(heroId, 'horse') } })) });
    game._addCamp(game.map.campSlots[0].slot, 'catapult', 1);
    for (let i = 0; i < 12; i++) enemy(game, i < 8 ? 'infantry' : 'armor', {}, { progress: game.paths[0].length - 100 + i * 2 });
    for (const h of game.heroes) { h.rage = 100; h.rageRecovery = 0; game.castUltimate(h.id); }
    const paused = [game.time, game.heroes.map(h => h.rage), game.skillQueue.length]; game.pause(); game.update(10);
    assert.deepEqual([game.time, game.heroes.map(h => h.rage), game.skillQueue.length], paused); game.resume();
    const clock = new CombatClock();
    for (let frame = 0; frame < 480 / speed; frame++) clock.advance(1 / 60, speed, () => game.state === 'playing', dt => game.update(dt));
    return { time: game.time, hp: game.hp, food: game.food, casts: game.stats.ultimateCasts,
      kills: game.kills, rage: game.heroes.map(h => [h.rage, h.rageRecovery]),
      enemies: game.enemies.map(e => [e.id, e.hp, e.progress, e.slowEffects]) };
  });
  assert.deepEqual(results[0], results[1]); assert.deepEqual(results[0], results[2]); assert.equal(results[0].casts, 3);
});
