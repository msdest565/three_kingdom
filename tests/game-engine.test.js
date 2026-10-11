import test from 'node:test';
import assert from 'node:assert/strict';
import { Game, CAMP_TYPES } from '../game-engine.js';

const FRAME = 1 / 30;
const finished = game => ['won', 'lost'].includes(game.state);
const makeGame = onEvent => new Game({ rng: () => 0.42, onEvent });

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

function sensiblePlay(game, { choose = true } = {}) {
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
  if (game.rage >= 100 && (game.ultimateTarget.count >= 15 || game.enemies.some(enemy => enemy.progress > 490))) game.castUltimate();
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
  game.food = 160;
  assert.ok(game.upgrade(0).ok);
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

test('a basic actual strategy wins all eight waves around four minutes; doing nothing loses', () => {
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
  assert.ok(game.time >= 200 && game.time <= 300, `Combat lasted ${game.time}s`);
  assert.ok(casts[0] <= 20, `First ultimate at ${casts[0]}s`);
  assert.ok(game.bestBurst >= 20, `Largest burst cleared ${game.bestBurst}`);
  assert.ok(game.stats.ultimates >= 5);
  const idle = makeGame();
  idle.start();
  runUntil(idle, finished, current => {
    if (current.state === 'choosing') current.selectUpgrade(current.upgradeChoices[0].id);
  });
  assert.equal(idle.state, 'lost');
  assert.equal(idle.hp, 0);
});
