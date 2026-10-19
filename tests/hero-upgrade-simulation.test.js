import test from 'node:test';
import assert from 'node:assert/strict';
import { BALANCE as B } from '../runtime-data.js';
import { V1Game, seededRandom } from '../v1-engine.js';

test('every complete hero build runs its real timed effects without invalid geometry or mutating shared balance', () => {
  const before = JSON.stringify(B);
  for (const heroId of Object.keys(B.heroes)) {
    const game = new V1Game({ mode: 'endless', party: [{ heroId }], unlockedCamps: Object.keys(B.camps), rng: seededRandom(901) });
    game.start();
    for (const card of B.heroUpgrades[heroId].upgrades) {
      game.state = 'choosing'; game.upgrades = [{ ...game.tacticDefinition(card.id) }];
      assert.equal(game.selectUpgrade(card.id).ok, true, card.id);
    }
    game._between = 0; game._spawnQueue = [{ at: 1e9 }]; game._spawnIndex = 0;
    game.food = 10000;
    for (const [index, type] of Object.keys(B.camps).entries()) game.build(index, type);
    for (let index = 0; index < 24; index++) {
      const type = ['infantry','armor','ranged','siege','cavalry','boss'][index % 6];
      const enemy = game._spawn({ type, lane: index % 2, progress: 320 + index * 5, wave: game._waveConfig(1) });
      Object.assign(enemy, { speed: 0, hp: 1e6, maxHp: 1e6 });
    }
    const hero = game.heroes[0]; hero.rage = game.heroMaxRage(hero); hero.rageRecovery = 0;
    assert.equal(game.castUltimate(heroId).ok, true, heroId);
    game.update(25);
    assert.equal(game.stats.ultimateCasts, 1, heroId);
    assert.equal(game._casts.length, 0, `${heroId} finishes delayed, repeated and persistent casts`);
    assert.ok(Number.isFinite(game.hp) && Number.isFinite(game.food) && Number.isFinite(hero.rage), heroId);
    for (const enemy of game.enemies) assert.ok([enemy.hp, enemy.x, enemy.y, enemy.progress, enemy.slow].every(Number.isFinite), `${heroId}: finite enemy state`);
    for (const effect of game.effects) {
      for (const key of ['x','y','radius','width','length','life','age']) if (effect[key] !== undefined) assert.ok(Number.isFinite(effect[key]), `${heroId}: finite ${key}`);
    }
  }
  assert.equal(JSON.stringify(B), before, 'hero snapshots and card combinations never edit shared definitions');
});
