// Builds an authentic "returning player" save: plays the first N stages through the real engine with the
// public fixed bot policy, settles each through CampaignStore, and trains only with earned resources.
import { CampaignStore } from '../../campaign-state.js';
import { V1Game, seededRandom } from '../../v1-engine.js';
import { CONTENT } from '../../runtime-data.js';
import { driveBattle } from '../simulate-campaign.mjs';

function memoryStorage() { const map = new Map(); return { getItem: k => map.get(k) ?? null, setItem: (k, v) => map.set(k, String(v)), removeItem: k => map.delete(k) }; }

export async function buildReturningSave(stages = 8, { train = true } = {}) {
  const store = new CampaignStore({ storage: memoryStorage(), rng: seededRandom(77) });
  store.setSetting('tutorialVersion', 1); store.setSetting('tutorialCompleted', true);
  for (const level of CONTENT.levels.slice(0, stages)) {
    const battleId = store.createBattleId();
    const game = new V1Game({ levelId: level.id, party: store.getPartyForLevel(level.id), unlockedCamps: store.state.unlockedCamps, campTech: store.getBattleTechnology(), rng: seededRandom(level.seed) });
    game.start();
    while (['playing', 'choosing'].includes(game.state) && game.time < 1600) {
      if (game.state === 'choosing') game.selectUpgrade(game.upgrades[0].id);
      driveBattle(game); game.update(1 / 30);
    }
    store.settleBattle({ battleId, levelId: level.id, won: game.state === 'won', hp: Math.max(0, game.hp), maxHp: game.maxHp, kills: game.kills, bestBurst: game.bestBurst, time: game.time, casts: game.stats.ultimateCasts });
    // Fill newly opened party slots with owned heroes, like a player would.
    const owned = Object.keys(store.state.heroes); const max = store.getMaxPartySize();
    const ids = [store.state.party.lead, ...store.state.party.supports]; for (const id of owned) if (ids.length < max && !ids.includes(id)) ids.push(id);
    store.setParty(ids);
    if (train) for (const id of ids) { store.trainHero(id); store.trainSkill(id); }
  }
  return store.exportSave();
}
