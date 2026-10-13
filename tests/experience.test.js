import test from 'node:test';
import assert from 'node:assert/strict';
import { Telemetry, ComboTracker, battleHighlight, defeatAdvice, nextObjective, shareText, encodeChallenge, decodeChallenge, challengeSetup, publicChallengeUrl, TELEMETRY_KEY, TELEMETRY_LIMIT, BUILD_ID } from '../experience.js';
import { V1Game, seededRandom } from '../v1-engine.js';
import { CONTENT, BALANCE } from '../runtime-data.js';

const memory = () => { const map = new Map(); return { map, getItem: k => map.get(k) ?? null, setItem: (k, v) => map.set(k, String(v)) }; };

test('kill streak uses combat seconds: pauses do not break it, speed does not change it, a gap resets it', () => {
  const combo = new ComboTracker(2.5);
  for (const t of [1, 1.5, 2, 4.4]) combo.kill(t);
  assert.equal(combo.count, 4, 'kills within 2.5 combat-seconds chain');
  // A long pause or tactic choice adds wall time but no combat time, so the next kill still chains.
  combo.kill(4.9); assert.equal(combo.count, 5);
  assert.equal(combo.current(7.3), 5); assert.equal(combo.current(7.5), 0, 'the live counter lapses after the window');
  combo.kill(8); assert.equal(combo.count, 1, 'a gap starts a new streak'); assert.equal(combo.best, 5, 'best survives the reset');
  const milestones = []; const fresh = new ComboTracker();
  for (let i = 0; i < 100; i++) { const r = fresh.kill(i * 0.1); if (r.milestone) milestones.push(r.milestone); }
  assert.deepEqual(milestones, [20, 50, 100]);
  fresh.reset(); assert.equal(fresh.best, 0); assert.equal(fresh.count, 0, 'retry/exit clears the streak');
  // The same kill timeline yields the same streak regardless of how fast wall time passes.
  const a = new ComboTracker(), b = new ComboTracker(); const times = [0.2, 1, 3.6, 3.7, 7];
  times.forEach(t => a.kill(t)); times.forEach(t => b.kill(t));
  assert.deepEqual([a.count, a.best], [b.count, b.best]);
});

test('telemetry is local, bounded, distinguishes share click from completion and survives broken storage', () => {
  const storage = memory(); let now = 1_000_000;
  const log = new Telemetry({ storage, now: () => now, clock: () => now });
  log.log('first_interactive'); now += 4000; log.log('battle_entry'); now += 3000; log.log('first_deploy'); now += 15000; log.log('first_ultimate');
  log.log('share_click'); log.log('share_cancel');
  const summary = log.summary();
  assert.equal(summary.toBattleEntryMs, 4000); assert.equal(summary.toFirstDeployMs, 7000); assert.equal(summary.toFirstUltimateMs, 22000);
  assert.equal(summary.shareClicks, 1); assert.equal(summary.shareCompleted, 0, 'a cancelled share is not a completed share');
  for (let i = 0; i < TELEMETRY_LIMIT + 20; i++) log.log('kill_noise');
  assert.equal(JSON.parse(storage.map.get(TELEMETRY_KEY)).length, TELEMETRY_LIMIT);
  const broken = new Telemetry({ storage: { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); } } });
  assert.doesNotThrow(() => broken.log('first_interactive'));
  assert.equal(log.log('first_deploy', {}, { once: true }) !== null, true); assert.equal(log.log('first_deploy', {}, { once: true }), null);
});

function playedGame(levelId, { skills = true } = {}) {
  const level = CONTENT.levels.find(l => l.id === levelId);
  const game = new V1Game({ levelId, party: [{ heroId: 'guan_yu', level: 1, skillLevel: 1 }], unlockedCamps: [...CONTENT.initialCampTypes], rng: seededRandom(level.seed) });
  game.start();
  while (['playing', 'choosing'].includes(game.state) && game.time < 900) {
    if (game.state === 'choosing') game.selectUpgrade(game.upgrades[0].id);
    if (skills && game.heroes[0].rage >= 100 && game.activeEnemyCount > 15) game.castUltimate();
    game.update(1 / 30);
  }
  return game;
}

test('highlight and defeat advice are derived from the actual battle, and advice differs by cause', () => {
  const won = playedGame('wei_001');
  assert.equal(won.state, 'won');
  const highlight = battleHighlight(won, { bestCombo: 30, previous: { bestBurst: 1 } });
  assert.equal(highlight.id, 'burst'); assert.equal(highlight.value, won.bestBurst); assert.equal(highlight.record, true);
  assert.equal(battleHighlight(won, { previous: { bestBurst: won.bestBurst } }).record, false, 'equal is not a record');
  const lost = playedGame('wei_001', { skills: false });
  assert.equal(lost.state, 'lost');
  const level = CONTENT.levels[0];
  const idle = defeatAdvice(lost, { level, unusedRageSec: 40 });
  assert.equal(idle.id, 'rage'); assert.match(idle.text, /40 秒/, 'quotes the measured idle rage time');
  const unspent = defeatAdvice({ ...lost, food: 200, stats: { ...lost.stats, escapesByType: {} }, camps: lost.camps }, { level, unusedRageSec: 0 });
  assert.notEqual(unspent.id, idle.id, 'a different cause gives different advice');
  const boss = defeatAdvice({ ...lost, stats: { ...lost.stats, escapesByType: { boss: 1 } } }, { level });
  assert.equal(boss.id, 'boss');
});

test('next objective names the real next stage and its real unlocks', () => {
  const wei2 = CONTENT.levels.find(l => l.id === 'wei_002');
  const goal = nextObjective({ level: wei2, stars: 3, won: true });
  assert.match(goal.text, /夏侯拒马/); assert.match(goal.text, new RegExp(BALANCE.heroes.xiahou_dun.name));
  assert.equal(nextObjective({ level: wei2, stars: 2, won: true }).kind, 'stars');
  assert.equal(nextObjective({ level: CONTENT.levels.at(-1), stars: 3, won: true }).kind, 'done');
});

test('challenge codes fix stage, seed, build and roster, reject tampering and other builds, and normalise progression', () => {
  const code = encodeChallenge({ levelId: 'wei_003', heroes: ['guan_yu', 'cao_cao'], target: { burst: 40, kills: 700, hp: 92.4 } });
  const decoded = decodeChallenge(code);
  assert.equal(decoded.ok, true); assert.equal(decoded.levelId, 'wei_003'); assert.deepEqual(decoded.heroes, ['guan_yu', 'cao_cao']);
  assert.deepEqual(decoded.target, { burst: 40, kills: 700, hp: 92 });
  assert.equal(decodeChallenge(`https://example.org/game/#challenge=${code}`).ok, true, 'a full link decodes');
  assert.equal(decodeChallenge(code.slice(0, -1) + (code.at(-1) === 'a' ? 'b' : 'a')).reason, 'corrupt');
  assert.equal(decodeChallenge(code.replace(/^./, c => c === 'e' ? 'f' : 'e')).reason, 'corrupt');
  assert.equal(decodeChallenge(code, { build: 'other-build' }).reason, 'build');
  assert.equal(decodeChallenge('').reason, 'corrupt');
  assert.equal(decodeChallenge(encodeChallenge({ levelId: 'wei_001', heroes: ['guan_yu', 'cao_cao', 'xu_chu'] })).heroes.length, 1, 'roster is capped at the stage party size');
  const setup = challengeSetup('wei_003', ['guan_yu', 'cao_cao']);
  const tier = BALANCE.stageGrowthTiers.find(t => t.id === setup.level.growthTierId);
  assert.ok(setup.party.every(h => h.level === tier.recommendedHeroLevelRange[0] && h.equipment.weapon.quality === tier.recommendedMainWeaponQuality));
  assert.deepEqual(setup.campTech, {}); assert.ok(!setup.unlockedCamps.includes('catapult'), 'camps unlocked by Wei 3 are not available inside Wei 3');
  // Identical setup → identical battle for every player who opens the code.
  const run = () => { const g = new V1Game({ levelId: 'wei_003', party: setup.party, unlockedCamps: setup.unlockedCamps, campTech: {} }); g.start(); for (let i = 0; i < 600; i++) g.update(1 / 30); return [g.kills, g.hp, g.food, g.stats.spawned]; };
  assert.deepEqual(run(), run());
});

test('share text uses real values, never invents rankings, and links only on public origins', () => {
  const level = CONTENT.levels[0];
  const text = shareText({ level, heroId: 'guan_yu', highlight: { label: '一记无双击破', value: 63, unit: '人' }, stars: 3, won: true, challengeCode: 'abc.1234' });
  assert.match(text, /一记无双击破 63人/); assert.match(text, /abc\.1234/); assert.doesNotMatch(text, /排名|第\d+名|万人|全服/);
  assert.equal(publicChallengeUrl('x.y', { protocol: 'file:', hostname: '', origin: 'null', pathname: '/' }), null);
  assert.equal(publicChallengeUrl('x.y', { protocol: 'http:', hostname: '127.0.0.1', origin: 'http://127.0.0.1:4173', pathname: '/' }), null);
  assert.equal(publicChallengeUrl('x.y', { protocol: 'http:', hostname: 'localhost', origin: 'http://localhost', pathname: '/' }), null);
  assert.equal(publicChallengeUrl('x.y', { protocol: 'https:', hostname: 'game.example.org', origin: 'https://game.example.org', pathname: '/wushuang/' }), 'https://game.example.org/wushuang/#challenge=x.y');
  assert.equal(typeof BUILD_ID, 'string');
});
