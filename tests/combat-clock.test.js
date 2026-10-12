import test from 'node:test';
import assert from 'node:assert/strict';
import { CombatClock, SPEEDS, SPEED_STORAGE_KEY, normalizeSpeed, nextSpeed, readSpeedPreference, saveSpeedPreference } from '../combat-clock.js';
import { Game } from '../game-engine.js';

function simulate(speed, realSeconds) {
  const game = new Game({ rng: () => 0.5 });
  const clock = new CombatClock();
  game.start();
  for (let real = 0; real < realSeconds - 1e-8; real += 0.05) {
    clock.advance(Math.min(0.05, realSeconds - real), speed, () => game.state === 'playing', dt => game.update(dt));
  }
  return game;
}

test('1×, 1.5× and 2× execute identical rules for equal battle time', () => {
  const snapshots = SPEEDS.map(speed => {
    const game = simulate(speed, 12 / speed);
    return { time: game.time, wave: game.wave, rage: game.rage, hp: game.hp, food: game.food, kills: game.kills,
      pending: game.pendingEnemyCount, enemies: game.enemies.map(enemy => ({ id: enemy.id, progress: enemy.progress, hp: enemy.hp })) };
  });
  assert.deepEqual(snapshots[1], snapshots[0]);
  assert.deepEqual(snapshots[2], snapshots[0]);
  assert.ok(Math.abs(snapshots[0].time - 12) < 1e-8);
});

test('real catapult hits, overlapping slow and ultimate recovery are identical at all speeds', () => {
  const snapshots = SPEEDS.map(speed => {
    const impacts = { catapult: 0, ultimate: 0, kills: 0, bursts: 0 };
    const hitCounts = {};
    const game = new Game({ rng: () => 0.5, onEvent: event => {
      if (event.type === 'projectileImpact' && event.campType === 'catapult') impacts.catapult++;
      if (event.type === 'ultimate') impacts.ultimate++;
      if (event.type === 'kill') impacts.kills++;
      if (event.type === 'burst') impacts.bursts++;
    } });
    const clock = new CombatClock();
    game.start();
    assert.equal(game.build(3, 'catapult').ok, true);
    // A compact rules fixture places ordinary engine-spawned units within artillery range.
    // Wave schedules, movement, projectile collision, damage and rewards still run normally.
    for (const [index, type] of ['infantry', 'cavalry', 'armor', 'armor', 'armor', 'armor', 'boss'].entries()) {
      game._spawnEnemy(type, index % 2);
      const enemy = game.enemies.at(-1);
      enemy.progress = 300 + index * 3;
      game._positionEnemy(enemy);
    }
    const damage = game._damage.bind(game);
    game._damage = (enemy, amount, source) => {
      if (enemy.hp > 0 && !enemy.escaped && amount > 0) hitCounts[source] = (hitCounts[source] || 0) + 1;
      return damage(enemy, amount, source);
    };
    let frame = 0;
    const checkpoints = [];
    const checkpointFrames = new Set([60, 108, 240, 432, 480]);
    for (let real = 0; real < 8 / speed - 1e-8; real += 0.05) {
      clock.advance(Math.min(0.05, 8 / speed - real), speed, () => game.state === 'playing', dt => {
        game.update(dt);
        frame++;
        if (frame === 72) {
          game.rage = game.maxRage;
          assert.equal(game.castUltimate().ok, true);
        }
        if (checkpointFrames.has(frame)) checkpoints.push(JSON.parse(JSON.stringify({
          time: game.time, rage: game.rage, rageRecovery: game.rageRecovery,
          hp: game.hp, food: game.food, kills: game.kills, earned: game.stats.foodEarned,
          sourceStats: game.stats.sourceStats, hitCounts, impacts,
          enemies: game.enemies.map(enemy => ({ id: enemy.id, hp: enemy.hp, progress: enemy.progress,
            slow: enemy.slow, slowEffects: enemy.slowEffects, rewarded: enemy.rewarded })),
        })));
      });
    }
    assert.equal(frame, 480);
    assert.equal(checkpoints.length, 5);
    assert.ok(checkpoints[0].hitCounts.catapult > 0, 'real stones must hit before the ultimate');
    assert.ok(checkpoints[0].enemies.some(enemy => enemy.slowEffects.catapult), 'stone hit must apply timed slow');
    assert.ok(checkpoints[1].hitCounts.ultimate > 0, 'real advancing blade must hit enemies');
    assert.ok(checkpoints[1].enemies.some(enemy => enemy.slowEffects.ultimate), 'surviving heavy units receive ultimate slow');
    assert.ok(checkpoints[1].enemies.some(enemy => enemy.slowEffects.ultimate && enemy.slowEffects.catapult),
      'different control sources must coexist during the real skill sequence');
    assert.ok(checkpoints.at(-1).earned > 0, 'actual kills must grant resources');
    assert.equal(checkpoints.at(-1).rageRecovery, 0);
    assert.ok(checkpoints.at(-1).rage > 0, 'passive recovery resumes after its six battle seconds');
    assert.equal(checkpoints.at(-1).impacts.ultimate, 1);
    assert.equal(checkpoints.at(-1).impacts.bursts, 1);
    return checkpoints;
  });
  assert.deepEqual(snapshots[1], snapshots[0]);
  assert.deepEqual(snapshots[2], snapshots[0]);
});

test('scaled frames use fixed steps no greater than 1/60 and do not hit the engine clamp', () => {
  const clock = new CombatClock(); const calls = [];
  assert.equal(clock.advance(0.1, 2, () => true, dt => calls.push(dt)), 12);
  assert.equal(calls.length, 12);
  assert.ok(calls.every(dt => dt <= 1 / 60));
  assert.ok(Math.abs(calls.reduce((sum, dt) => sum + dt, 0) - 0.2) < 1e-10);
});

test('pause, choice, construction and tutorial freeze discard partial accumulated steps', () => {
  for (const state of ['paused', 'choosing', 'construction', 'tutorial']) {
    const clock = new CombatClock(); let active = true; let ticks = 0;
    clock.advance(0.01, 1, () => active, () => ticks++);
    assert.ok(clock.accumulator > 0);
    active = false;
    clock.advance(30, 2, () => active, () => ticks++);
    assert.equal(clock.accumulator, 0, state);
    active = true;
    clock.advance(0.01, 1, () => active, () => ticks++);
    assert.equal(ticks, 0, `${state}: no stale time leaks on resume`);
  }
});

test('a tutorial or wave-choice transition stops remaining substeps in the same frame', () => {
  const clock = new CombatClock(); let running = true; let ticks = 0;
  clock.advance(0.1, 2, () => running, () => { ticks++; running = false; });
  assert.equal(ticks, 1); assert.equal(clock.accumulator, 0);
});

test('long background gaps leave no queued catch-up; reset forgets fractions', () => {
  const clock = new CombatClock(); let battleTime = 0;
  clock.advance(60, 2, () => true, dt => battleTime += dt);
  assert.ok(Math.abs(battleTime - 0.2) < 1e-10);
  assert.ok(clock.accumulator < 1e-8);
  clock.reset(); clock.advance(0.01, 1, () => true, dt => battleTime += dt);
  clock.reset(); clock.advance(0.01, 1, () => true, dt => battleTime += dt);
  assert.ok(Math.abs(battleTime - 0.2) < 1e-10);
});

test('impact slows battle simulation in wall time while preserving the selected speed', () => {
  const clock = new CombatClock(); let battleSeconds = 0;
  clock.triggerImpact(0.35, 0.25);
  for (let i = 0; i < 4; i++) clock.advance(0.1, 2, () => true, dt => battleSeconds += dt);
  assert.ok(battleSeconds >= 0.25 && battleSeconds < 0.3, `0.35s impact at 2× then normal 2× advances about 0.28 battle seconds, got ${battleSeconds}`);
  clock.clearImpact();
  const before = battleSeconds; clock.advance(0.1, 2, () => true, dt => battleSeconds += dt);
  assert.ok(Math.abs(battleSeconds - before - 0.2) < 1 / 60, 'clearing impact restores the existing 2× preference');
});

test('an automatic impact stops old-speed substeps in the frame that triggers it', () => {
  const clock = new CombatClock(); let ticks = 0;
  clock.advance(0.1, 2, () => true, () => { ticks++; clock.triggerImpact(0.35, 0.25); });
  assert.equal(ticks, 1);
  assert.equal(clock.accumulator, 0);
  clock.advance(0.1, 2, () => true, () => ticks++);
  assert.equal(ticks, 4, 'the next 0.1 real seconds add three 1/60 battle steps at 2× × 0.25');
});

test('speed preference is independent, cycles predictably, and rejects invalid or unavailable storage', () => {
  const values = new Map([['wushuang-guard-v1', JSON.stringify({ bestBurst: 52 })]]);
  const storage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
  assert.equal(readSpeedPreference(storage), 1);
  assert.equal(nextSpeed(1), 1.5); assert.equal(nextSpeed(1.5), 2); assert.equal(nextSpeed(2), 1);
  for (const speed of SPEEDS) {
    saveSpeedPreference(speed, storage); assert.equal(readSpeedPreference(storage), speed);
  }
  assert.deepEqual(JSON.parse(values.get('wushuang-guard-v1')), { bestBurst: 52 });
  for (const invalid of ['{broken', '3', '0', 'true', '"2"', '{}', 'null']) {
    values.set(SPEED_STORAGE_KEY, invalid); assert.equal(readSpeedPreference(storage), 1);
  }
  for (const invalid of [undefined, NaN, Infinity, '2', 0, 3]) assert.equal(normalizeSpeed(invalid), 1);
  const denied = { getItem() { throw new Error('Denied'); }, setItem() { throw new Error('Denied'); } };
  assert.equal(readSpeedPreference(denied), 1); assert.equal(saveSpeedPreference(2, denied), 2);
});
