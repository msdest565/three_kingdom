import test from 'node:test';
import assert from 'node:assert/strict';
import { Game, CAMP_TYPES } from '../game-engine.js';

const FRAME = 1 / 30;
const finished = game => ['won', 'lost'].includes(game.state);
const makeGame = onEvent => new Game({ rng: () => 0.42, onEvent });
const seededRandom = seed => () => {
  let value = seed += 0x6D2B79F5;
  value = Math.imul(value ^ value >>> 15, value | 1);
  value ^= value + Math.imul(value ^ value >>> 7, value | 61);
  return ((value ^ value >>> 14) >>> 0) / 4294967296;
};

function tickFor(game, seconds) {
  const frames = Math.round(seconds / FRAME);
  for (let frame = 0; frame < frames; frame++) game.update(FRAME);
}

function runUntil(game, predicate, act = () => {}, maxSeconds = 360) {
  for (let frame = 0; frame < maxSeconds / FRAME; frame++) {
    if (predicate(game)) return;
    if (finished(game)) break;
    act(game);
    game.update(FRAME);
  }
  assert.ok(predicate(game), `Condition not reached: ${JSON.stringify({ state: game.state, wave: game.wave, time: game.time, hp: game.hp })}`);
}

function sensiblePlay(game, { choose = true, ultimate = true } = {}) {
  if (game.state === 'choosing' && choose) {
    const preferred = ['archer_volley', 'archer_hunt', 'catapult_siege', 'shield_grasp'];
    const pick = preferred.map(id => game.upgradeChoices.find(choice => choice.id === id)).find(Boolean) || game.upgradeChoices[0];
    assert.ok(game.selectUpgrade(pick.id).ok);
  }
  if (game.state !== 'playing') return;
  for (const [slot, type] of [[3, 'archer'], [5, 'catapult'], [0, 'archer'], [1, 'catapult']]) {
    if (!game.camps[slot]) {
      game.build(slot, type);
      break;
    }
  }
  for (const slot of [5, 3, 2, 4, 0, 1]) {
    if (game.camps[slot] && game.getUpgradeCost(slot) !== null) {
      game.upgrade(slot);
      break;
    }
  }
  if (ultimate && game.rage >= 100 && (game.ultimateTarget.count >= 22 || game.enemies.some(enemy => enemy.progress > 490))) game.castUltimate();
}

function stationaryEnemy(id, type = 'infantry', hp = 28, progress = 360) {
  return { id, type, hp, maxHp: hp, progress, pathSide: 0, speed: 0, laneOffset: 0, x: 210, y: 309, radius: type === 'boss' ? 21 : type === 'armor' ? 11 : 7, rewarded: false, escaped: false };
}

function isolateArmy(game) {
  game.camps.fill(null);
  game.heroCooldown = 1e9;
}

function frozenSnapshot(game) {
  return JSON.stringify({ time: game.time, rage: game.rage, rageRecovery: game.rageRecovery, food: game.food, hp: game.hp, wave: game.wave, enemies: game.enemies, projectiles: game.projectiles, effects: game.effects });
}

test('reset restores a fresh playable army and clears previous battle results', () => {
  const game = makeGame();
  const initial = frozenSnapshot(game);
  const initialCamps = JSON.stringify(game.camps);
  game.start();
  game.build(3, 'archer');
  game.rage = 100;
  game.castUltimate();
  tickFor(game, 2);
  assert.ok(game.time > 0);
  assert.ok(game.stats.casts > 0);
  assert.ok(game.reset().ok);
  assert.equal(game.state, 'ready');
  assert.equal(frozenSnapshot(game), initial);
  assert.equal(JSON.stringify(game.camps), initialCamps);
  assert.equal(game.kills, 0);
  assert.equal(game.bestBurst, 0);
  assert.deepEqual(game.selectedUpgrades, []);
  assert.equal(game.stats.foodSpent, 0);
  assert.ok(game.start().ok);
  assert.equal(game.start().ok, false);
});

test('invalid construction, duplicate construction and unaffordable upgrades never spend food', () => {
  const game = makeGame();
  assert.equal(game.build(0, 'archer').ok, false);
  game.start();
  const food = game.food;
  for (const slot of [-1, 6, 0.5, NaN, '0', null]) {
    assert.equal(game.build(slot, 'archer').ok, false);
    assert.equal(game.upgrade(slot).ok, false);
  }
  assert.equal(game.build(0, '__proto__').ok, false);
  assert.equal(game.build(2, 'archer').ok, false);
  assert.equal(game.selectUpgrade('archer_volley').ok, false);
  assert.equal(game.food, food);
  assert.ok(game.build(0, 'archer').ok);
  assert.equal(game.food, food - CAMP_TYPES.archer.cost);
  const afterBuild = game.food;
  assert.equal(game.build(0, 'catapult').ok, false);
  assert.equal(game.food, afterBuild);
  game.food = 59;
  assert.equal(game.upgrade(0).ok, false);
  assert.equal(game.food, 59);
  assert.equal(game.camps[0].level, 1);
  game.food = 210;
  assert.equal(game.getUpgradeCost(0), 80);
  assert.ok(game.upgrade(0).ok);
  assert.equal(game.getUpgradeCost(0), 130);
  assert.ok(game.upgrade(0).ok);
  assert.equal(game.food, 0);
  assert.equal(game.camps[0].level, 3);
  assert.equal(game.upgrade(0).ok, false);
  assert.equal(game.build(1, 'shield').ok, false);
  assert.equal(game.food, 0);
});

test('ready, paused and real tactic selection freeze combat and reject inappropriate actions', () => {
  const game = makeGame();
  let before = frozenSnapshot(game);
  game.update(10);
  assert.equal(frozenSnapshot(game), before);
  game.start();
  game.rage = 100;
  game.castUltimate();
  tickFor(game, 0.1);
  assert.ok(game.pause().ok);
  before = frozenSnapshot(game);
  game.update(30);
  assert.equal(frozenSnapshot(game), before);
  assert.equal(game.castUltimate().ok, false);
  assert.equal(game.build(0, 'archer').ok, false);
  assert.equal(game.upgrade(2).ok, false);
  assert.ok(game.resume().ok);
  game.reset();
  game.start();
  runUntil(game, current => current.state === 'choosing', current => sensiblePlay(current, { choose: false }));
  assert.equal(game.wave, 2);
  assert.equal(game.upgradeChoices.length, 3);
  assert.equal(new Set(game.upgradeChoices.map(choice => choice.id)).size, 3);
  assert.ok(game.upgradeChoices.every(choice => game.camps.some(camp => camp?.type === choice.camp)));
  before = frozenSnapshot(game);
  game.update(30);
  assert.equal(frozenSnapshot(game), before);
  assert.equal(game.selectUpgrade('not-offered').ok, false);
  assert.equal(game.state, 'choosing');
  assert.equal(game.resume().ok, false);
  const choice = game.upgradeChoices[0].id;
  assert.ok(game.selectUpgrade(choice).ok);
  assert.equal(game.state, 'playing');
  assert.equal(game.selectUpgrade(choice).ok, false);
});

test('rage accrues once per second of combat regardless of army size', () => {
  const sparse = makeGame();
  const dense = makeGame();
  for (const game of [sparse, dense]) {
    game.start();
    game.enemies = [stationaryEnemy(10000, 'armor', 1e6)];
    game.heroCooldown = 1e9;
  }
  sparse.camps[4] = null;
  dense.food = 1000;
  for (const slot of [0, 1, 3, 5]) dense.build(slot, 'archer');
  tickFor(sparse, 2);
  tickFor(dense, 2);
  assert.ok(Math.abs(sparse.rage - 48) < 1e-8);
  assert.ok(Math.abs(dense.rage - sparse.rage) < 1e-8);
});

test('ultimate needs full rage, spends 100, awards each kill once and blocks rage for six seconds', () => {
  const kills = [];
  const game = makeGame(event => { if (event.type === 'kill') kills.push(event); });
  game.start();
  isolateArmy(game);
  assert.equal(game.castUltimate().ok, false);
  game.rage = 99.99;
  assert.equal(game.castUltimate().ok, false);
  game.enemies = Array.from({ length: 20 }, (_, index) => stationaryEnemy(10000 + index));
  game.rage = 100;
  const food = game.food;
  assert.ok(game.castUltimate().ok);
  assert.equal(game.rage, 0);
  assert.equal(game.rageRecovery, 6);
  assert.equal(game.castUltimate().ok, false);
  tickFor(game, 0.8);
  assert.equal(game.kills, 20);
  assert.equal(game.stats.ultimateKills, 20);
  assert.equal(game.stats.sourceStats.ultimate.kills, 20);
  assert.equal(game.bestBurst, 20);
  assert.equal(game.food, food + 20);
  assert.equal(new Set(kills.map(event => event.enemyId)).size, 20);
  assert.equal(game.rage, 0);
  tickFor(game, 5.2);
  assert.ok(game.rage < 1e-8);
  assert.ok(game.rageRecovery < 1e-8);
  assert.equal(game.kills, 20);
  assert.equal(game.food, food + 20);
  tickFor(game, 0.5);
  assert.ok(game.rage > 0);
  assert.ok(game.rage < 3);
});

test('one ultimate clears ordinary infantry but damages armored soldiers and boss only once', () => {
  const game = makeGame();
  game.start();
  isolateArmy(game);
  const ordinary = stationaryEnemy(10000);
  const armor = stationaryEnemy(10001, 'armor', 110);
  const boss = stationaryEnemy(10002, 'boss', 1900);
  game.enemies = [ordinary, armor, boss];
  game.rage = 100;
  game.castUltimate();
  tickFor(game, 0.8);
  assert.equal(ordinary.hp, 0);
  assert.equal(armor.hp, 25);
  assert.equal(boss.hp, 1590);
  assert.equal(game.kills, 1);
  assert.equal(game.stats.ultimateKills, 1);
});

test('a lethal breakthrough loses once, grants no kill reward and freezes the result', () => {
  const endings = [];
  const game = makeGame(event => { if (event.type === 'lose') endings.push(event); });
  game.start();
  isolateArmy(game);
  game.hp = 3;
  game.enemies = [stationaryEnemy(10000, 'infantry', 28, 10000)];
  const food = game.food;
  game.update(FRAME);
  assert.equal(game.state, 'lost');
  assert.equal(game.hp, 0);
  assert.equal(game.kills, 0);
  assert.equal(game.food, food);
  assert.equal(game.stats.escaped, 1);
  const before = frozenSnapshot(game);
  game.update(30);
  assert.equal(frozenSnapshot(game), before);
  assert.equal(endings.length, 1);
  assert.equal(game.castUltimate().ok, false);
});

test('the final boss death cannot award victory while its surviving escort remains', () => {
  const game = makeGame();
  game.start();
  runUntil(game, current => current.wave === 8 && current.enemies.some(enemy => enemy.type === 'boss'), sensiblePlay);
  isolateArmy(game);
  const boss = game.enemies.find(enemy => enemy.type === 'boss');
  Object.assign(boss, { hp: 1, speed: 0, progress: 360, x: 210, y: 309, laneOffset: 0 });
  const escort = stationaryEnemy(10000, 'armor', 1e6, 370);
  game.enemies.push(escort);
  game.rage = 100;
  assert.ok(game.castUltimate().ok);
  tickFor(game, 0.8);
  assert.equal(boss.hp, 0);
  assert.ok(escort.hp > 0);
  assert.ok(game.enemies.includes(escort));
  assert.equal(game.state, 'playing');
});

test('a basic actual strategy wins the denser eight-wave army; doing nothing loses', () => {
  const waves = [];
  const choices = [];
  const casts = [];
  const game = makeGame(event => {
    if (event.type === 'wave') waves.push(event.wave);
    if (event.type === 'choice') choices.push(event.wave);
    if (event.type === 'ultimate') casts.push(event.time);
  });
  game.start();
  runUntil(game, finished, sensiblePlay);
  assert.equal(game.state, 'won');
  assert.deepEqual(waves, [1, 2, 3, 4, 5, 6, 7, 8]);
  assert.deepEqual(choices, [2, 4, 6]);
  assert.equal(game.selectedUpgrades.length, 3);
  assert.ok(game.hp > 0);
  assert.equal(game.enemies.length, 0);
  assert.ok(game.food >= 0);
  assert.ok(game.time >= 260 && game.time <= 360, `Combat lasted ${game.time}s`);
  assert.ok(casts[0] <= 20, `First ultimate at ${casts[0]}s`);
  assert.ok(game.bestBurst >= 40, `Largest burst cleared ${game.bestBurst}`);
  assert.ok(game.stats.ultimates >= 5);
  assert.equal(game.stats.scheduledEnemies, 999);
  assert.equal(game.stats.spawned, 999);
  assert.equal(game.kills + game.stats.escaped, 999);
  assert.ok(game.stats.maxEnemies >= 100 && game.stats.maxEnemies <= 160);
  const idle = makeGame();
  idle.start();
  runUntil(idle, finished, current => {
    if (current.state === 'choosing') current.selectUpgrade(current.upgradeChoices[0].id);
  });
  assert.equal(idle.state, 'lost');
  assert.equal(idle.hp, 0);
});

function quietBattle(enemies) {
  const game = makeGame();
  game.start();
  isolateArmy(game);
  game._spawnQueue = [];
  game.enemies = enemies;
  for (const enemy of enemies) game._positionEnemy(enemy);
  return game;
}

function impactStone(game, damage = CAMP_TYPES.catapult.damage) {
  const target = game.enemies[0];
  game.projectiles.push({ id: 900000, type: 'stone', x: target.x, y: target.y, targetX: target.x, targetY: target.y, targetId: target.id, damage, speed: 225, life: 2.8, campType: 'catapult' });
  game.update(FRAME);
}

test('catapult shots remain low-frequency and low-damage at both base and maximum level', () => {
  for (const [level, damage, interval] of [[1, 14, 3], [3, 23.1, 2.7]]) {
    const enemy = stationaryEnemy(10000, 'infantry', 1e6, 230);
    const game = quietBattle([enemy]);
    const attacks = [];
    game.onEvent = event => { if (event.type === 'attack') attacks.push(event.time); };
    assert.ok(game.build(2, 'catapult').ok);
    game.camps[2].level = level;
    tickFor(game, 4);
    assert.equal(attacks.length, 2);
    assert.ok(Math.abs(attacks[1] - attacks[0] - interval) < FRAME + 1e-8);
    assert.ok(Math.abs(1e6 - enemy.hp - damage * 2) < 1e-7);
    assert.equal(game.stats.sourceStats.catapult.kills, 0);
  }
});

test('stone damage is capped at six soldiers while its weak timed slow covers the whole impact area', () => {
  const enemies = Array.from({ length: 12 }, (_, index) => stationaryEnemy(10000 + index, 'infantry', 1000));
  const game = quietBattle(enemies);
  impactStone(game);
  assert.equal(enemies.filter(enemy => enemy.hp === 986).length, 6);
  assert.equal(enemies.filter(enemy => enemy.hp === 1000).length, 6);
  assert.equal(game.stats.sourceStats.catapult.damage, 84);
  for (const enemy of enemies) {
    assert.equal(enemy.slowFactor, 0.8);
    assert.equal(enemy.slowEffects.catapult.remaining, 1.5);
    enemy.speed = 10;
  }
  const start = enemies[0].progress;
  tickFor(game, 1.5);
  assert.ok(Math.abs(enemies[0].progress - start - 12) < 1e-8);
  assert.equal(enemies[0].slowTime, 0);
  assert.equal(enemies[0].slow, 1);
  tickFor(game, 0.5);
  assert.ok(Math.abs(enemies[0].progress - start - 17) < 1e-8);
});

test('shock increases slow strength and duration without increasing stone damage or multiplying controls', () => {
  const baseEnemy = stationaryEnemy(10000, 'infantry', 1000);
  const shockEnemy = stationaryEnemy(10000, 'infantry', 1000);
  const base = quietBattle([baseEnemy]), shock = quietBattle([shockEnemy]);
  shock._modifiers.add('catapult_shock');
  impactStone(base); impactStone(shock);
  assert.equal(baseEnemy.hp, shockEnemy.hp);
  assert.equal(shockEnemy.slowFactor, 0.65);
  assert.equal(shockEnemy.slowEffects.catapult.remaining, 2.5);
  tickFor(base, 1.6); tickFor(shock, 1.6);
  assert.equal(baseEnemy.slow, 1);
  assert.equal(shockEnemy.slow, 0.65);
  tickFor(shock, 0.9);
  assert.equal(shockEnemy.slow, 1);
  assert.deepEqual(shockEnemy.slowEffects, {});
});

test('weak stones cannot refresh a real ultimate slow; both sources expire independently with armor resistance', () => {
  const armor = stationaryEnemy(10000, 'armor', 1000);
  const game = quietBattle([armor]);
  game.rage = 100;
  assert.ok(game.castUltimate().ok);
  tickFor(game, 0.3);
  assert.equal(armor.hp, 915);
  assert.ok(Math.abs(armor.slowEffects.ultimate.factor - 0.685) < 1e-8);
  const before = armor.slowEffects.ultimate.remaining;
  impactStone(game);
  assert.ok(Math.abs(armor.slowEffects.ultimate.remaining - (before - FRAME)) < 1e-8);
  assert.ok(Math.abs(armor.slowEffects.catapult.factor - 0.86) < 1e-8);
  for (let hit = 0; hit < 4; hit++) { tickFor(game, 0.2); impactStone(game); }
  assert.equal(armor.slowEffects.ultimate, undefined);
  assert.ok(Math.abs(armor.slowFactor - 0.86) < 1e-8);
  tickFor(game, 1.5);
  assert.deepEqual(armor.slowEffects, {});
  assert.equal(armor.slow, 1);
});

test('shield slows are visible spatial auras, respect resistance and never stack into immobilization', () => {
  const enemies = ['infantry', 'armor', 'boss'].map((type, index) => stationaryEnemy(10000 + index, type, 1e6, 420));
  const game = quietBattle(enemies);
  assert.ok(game.build(4, 'shield').ok);
  game.camps[4].cooldown = 1e9;
  game.update(FRAME);
  for (const [index, factor] of [0.5, 0.65, 0.8].entries()) assert.ok(Math.abs(enemies[index].slow - factor) < 1e-8);
  game._modifiers.add('shield_grasp');
  assert.ok(game.build(5, 'shield').ok);
  game.camps[5].cooldown = 1e9;
  game.update(FRAME);
  for (const [index, factor] of [0.35, 0.545, 0.74].entries()) assert.ok(Math.abs(enemies[index].slow - factor) < 1e-8);
  for (const enemy of enemies) assert.ok(enemy.slow > 0.3);
  game.camps.fill(null);
  game.update(FRAME);
  for (const enemy of enemies) assert.equal(enemy.slow, 1);
});

test('bow tactics add only one reduced-damage pierce and one weaker extra arrow', () => {
  const target = stationaryEnemy(10000, 'infantry', 1000);
  const game = quietBattle([target]);
  assert.ok(game.build(2, 'archer').ok);
  game._modifiers.add('archer_volley');
  game._modifiers.add('archer_pierce');
  game._attackCamp(game.camps[2], [target]);
  assert.equal(game.projectiles.length, 2);
  assert.equal(game.projectiles[0].damage, 12);
  assert.ok(Math.abs(game.projectiles[1].damage - 7.2) < 1e-8);
  const arrow = game.projectiles[0];
  const aimX = target.x - arrow.fromX, aimY = target.y - arrow.fromY, length = Math.hypot(aimX, aimY);
  const others = [20, 40, 60].map((distance, index) => ({ ...stationaryEnemy(10001 + index, 'infantry', 1000), x: target.x + aimX / length * distance, y: target.y + aimY / length * distance }));
  game.enemies.push(...others);
  game.projectiles = [{ ...arrow, x: target.x, y: target.y }];
  game._tickProjectiles(FRAME);
  assert.equal(target.hp, 988);
  assert.ok(Math.abs(others[0].hp - 994.6) < 1e-8);
  assert.equal(others[1].hp, 1000);
  assert.equal(others[2].hp, 1000);
});

test('the 160-soldier capacity retains due spawns in order and prevents premature wave completion', () => {
  const game = makeGame();
  game.start(); isolateArmy(game);
  game.enemies = Array.from({ length: 160 }, (_, index) => stationaryEnemy(10000 + index, 'armor', 1e6));
  const queued = structuredClone(game._spawnQueue);
  game._waveTime = 30;
  game.update(FRAME);
  assert.equal(game.activeEnemyCount, 160);
  assert.equal(game.pendingEnemyCount, 70);
  assert.deepEqual(game._spawnQueue, queued);
  assert.equal(game._waveSpawned, 0);
  assert.equal(game.stats.maxPendingSpawns, 70);
  assert.equal(game.state, 'playing');
  game.enemies.splice(0, 10);
  game.update(FRAME);
  assert.equal(game.activeEnemyCount, 160);
  assert.equal(game.pendingEnemyCount, 60);
  assert.deepEqual(game.enemies.slice(-10).map(enemy => enemy.pathSide), queued.slice(0, 10).map(spawn => spawn.side));
  game.enemies = game.enemies.slice(-10);
  game.update(FRAME);
  assert.equal(game.activeEnemyCount, 70);
  assert.equal(game.pendingEnemyCount, 0);
  assert.equal(game._waveSpawned, 70);
  assert.equal(game.stats.spawned, 70);
  assert.equal(game.wave, 1);
  assert.equal(game.state, 'playing');
});

test('ultimate targeting scales with a fixed direction set and never consumes enemy spawn randomness', () => {
  let randomCalls = 0;
  const game = new Game({ rng: () => { randomCalls++; return 0.42; } });
  game.start(); isolateArmy(game);
  let reads = 0;
  game.enemies = Array.from({ length: 160 }, (_, index) => {
    const enemy = stationaryEnemy(10000 + index);
    Object.defineProperty(enemy, 'x', { get: () => { reads++; return 210; } });
    return enemy;
  });
  const before = randomCalls;
  const first = game._findUltimateTarget();
  assert.equal(first.count, 160);
  assert.ok(reads <= 160 * 50, `Targeting performed ${reads} x reads`);
  assert.deepEqual(game._findUltimateTarget(), first);
  assert.equal(randomCalls, before);
});

test('fixed-seed active sweeps win with a real dense army; the same construction policy without sweeps loses', () => {
  for (const seed of [7, 42, 20261011]) {
    let firstBurst = null;
    const active = new Game({ rng: seededRandom(seed), onEvent: event => {
      if (event.type === 'burst' && !firstBurst) firstBurst = { kills: event.kills, active: active.activeEnemyCount, pending: active.pendingEnemyCount };
    } });
    const passive = new Game({ rng: seededRandom(seed) });
    active.start(); passive.start();
    runUntil(active, finished, current => sensiblePlay(current));
    runUntil(passive, finished, current => sensiblePlay(current, { ultimate: false }));
    assert.equal(active.state, 'won', `Seed ${seed}`);
    assert.ok(active.hp >= 50, `Seed ${seed}: active clear has ${active.hp} gate HP`);
    assert.equal(active.stats.spawned, 999);
    assert.ok(active.stats.maxEnemies >= 100 && active.stats.maxEnemies <= 160);
    assert.ok(active.stats.ultimateKills > active.kills * 0.45);
    assert.ok(firstBurst.kills >= 30 && firstBurst.active >= 5 && firstBurst.pending >= 5, JSON.stringify(firstBurst));
    assert.equal(passive.state, 'lost');
    assert.equal(passive.hp, 0);
    assert.ok(passive.wave <= 4);
    assert.equal(passive.stats.ultimates, 0);
    assert.ok(active.stats.sourceStats.ultimate.kills === active.stats.ultimateKills);
    const summedDamage = Object.values(active.stats.sourceStats).reduce((total, source) => total + source.damage, 0);
    assert.ok(Math.abs(summedDamage - active.stats.damage) < 1e-6);
  }
});

test('even a fully upgraded mixed army granted before wave one cannot automatically clear without the hero', () => {
  const game = new Game({ rng: seededRandom(42) });
  game.start(); game.food = 5000; // Deliberately stronger than any legal early-game economy.
  for (const [slot, type] of [[3, 'archer'], [5, 'catapult'], [0, 'archer'], [1, 'catapult']]) assert.ok(game.build(slot, type).ok);
  for (let slot = 0; slot < 6; slot++) { assert.ok(game.upgrade(slot).ok); assert.ok(game.upgrade(slot).ok); }
  game.food = 0;
  assert.ok(game.camps.every(camp => camp.level === 3));
  runUntil(game, finished, current => sensiblePlay(current, { ultimate: false }));
  assert.equal(game.state, 'lost');
  assert.ok(game.wave >= 4 && game.wave < 8);
  assert.equal(game.stats.ultimateKills, 0);
});
