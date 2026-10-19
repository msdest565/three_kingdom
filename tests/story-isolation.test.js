import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { V1Game, seededRandom } from '../v1-engine.js';
import { BALANCE } from '../runtime-data.js';

test('scripted Wei 1 preserves the pre-P0 campaign simulation and complete gameplay event trace', () => {
  // Captured from git HEAD's engine before P0, with the same fixed seed and actions.
  const digest = createHash('sha256');
  const game = new V1Game({ levelId: 'wei_001', party: [{ heroId: 'guan_yu', level: 10, skillLevel: 3 }],
    unlockedCamps: Object.keys(BALANCE.camps), rng: seededRandom(712),
    onEvent: e => digest.update(JSON.stringify([e.type, e.time, e.wave, e.upgrade?.id, e.enemyId, e.damage, e.amount, e.hp, e.source]) + '\n') });
  game.start();
  for (let step = 0; step < 3200 && !['won', 'lost'].includes(game.state); step++) {
    if (game.state === 'choosing') { game.selectUpgrade(game.upgrades[0].id); continue; }
    for (const slot of game.map.campSlots) {
      const camp = game.camps.find(c => c.slot === slot.slot);
      if (!camp) game.build(slot.slot, ['archer', 'crossbow', 'catapult', 'archer', 'shield', 'war_drum'][slot.slot % 6]);
      else if (game.getUpgradeCost(slot.slot) !== null) game.upgrade(slot.slot);
    }
    for (const hero of game.heroes) if (hero.rage >= 100 && game.activeEnemyCount > 0) game.castUltimate(hero.id);
    game.update(.25);
  }
  assert.deepEqual({ state: game.state, time: game.time, wave: game.wave, hp: game.hp, food: game.food,
    kills: game.kills, casts: game.stats.ultimateCasts, tactics: [...game.tactics], spawned: game.stats.spawned, escaped: game.stats.escaped },
  { state: 'won', time: 171.55000000002866, wave: 6, hp: 100, food: 136, kills: 486, casts: 6,
    tactics: ['shield_grasp', 'archer_volley'], spawned: 486, escaped: 0 });
  assert.equal(digest.digest('hex'), '76fc94b2f44f3ce78905598a319938cae38fd6fe765f21100f2abadf3f3125ac');
});
