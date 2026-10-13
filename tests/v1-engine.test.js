import test from 'node:test';
import assert from 'node:assert/strict';
import { V1Game, seededRandom } from '../v1-engine.js';
import { BALANCE as B, CONTENT } from '../runtime-data.js';
import { CombatClock } from '../combat-clock.js';
import { simulateCampaign, simulateLevel } from '../scripts/simulate-campaign.mjs';

const white = { quality: 'white', level: 0 };
function fixture(heroIds = ['guan_yu'], levelId = 'shu_011') {
  const game = new V1Game({ levelId, party: heroIds.map(heroId => ({ heroId, level: 20, skillLevel: 4 })), unlockedCamps: Object.keys(B.camps), rng: seededRandom(7) });
  game.start(); game.camps = []; game._spawnQueue = [{ at: 1e6 }]; game._spawnIndex = 0;
  return game;
}
function enemy(game, type = 'infantry', progress = 400, lane = 0, extra = {}) {
  const e = game._spawn({ type, lane, progress, wave: game.level.waves[0] }); Object.assign(e, extra); return e;
}
function filled(hero) { hero.rage = 100; hero.rageRecovery = 0; }

test('sixty stages use exact configured packs, routes and one HP scaling pass', () => {
  for (const level of CONTENT.levels) {
    const game = new V1Game({ levelId: level.id, party: [{ heroId: 'guan_yu' }] });
    assert.equal(game.map.id, level.mapId);
    for (const wave of level.waves) {
      game._startWave(wave.index);
      const counts = {};
      for (const spec of game._spawnQueue) counts[spec.type] = (counts[spec.type] || 0) + 1;
      for (const [type, count] of Object.entries(wave.units)) assert.equal(counts[type], count, `${level.id} wave${wave.index} ${type}`);
      assert.equal(game.pendingEnemyCount, wave.count + (wave.bossSpawn ? 1 : 0));
      assert.ok(game._spawnQueue.every(s => s.lane < game.paths.length));
    }
    const wave = level.waves[0]; const e = game._spawn({ type: 'armor', lane: 0, wave });
    assert.equal(e.hp, Math.ceil(B.enemies.armor.hp * game.tier.hpMultiplier * wave.hpMultiplier));
  }
});

test('equipment modifies numeric damage, gate max HP and basic range exactly once', () => {
  const equipment = { weapon: { quality: 'purple', level: 7 }, armor: { quality: 'red', level: 10 }, command_token: { quality: 'purple', level: 8 }, horse: { quality: 'blue', level: 4 } };
  const g = new V1Game({ levelId: 'wu_020', party: ['guan_yu', 'cao_cao', 'xiahou_dun'].map(heroId => ({ heroId, level: 28, skillLevel: 5, equipment })) });
  assert.equal(g.maxHp, Math.round(100 * (1 + Math.min(.15, 3 * (.003 * 10 + .015)))));
  assert.ok(Math.abs(g.teamCommand - 3 * (.003 * 8 + .01)) < 1e-8);
  assert.ok(Math.abs(g.heroDamageMultiplier(g.heroes[0], true) - 1.27 * 1.055 * 1.2) < 1e-8);
  assert.ok(Math.abs(g.heroDamageMultiplier(g.heroes[1]) - 1.27 * 1.055 * .7) < 1e-8);
  assert.equal(g.heroBasicRange(g.heroes[0]), B.heroes.guan_yu.attack.range + 4 + 8);
  assert.equal(g.heroes[1].rage, 0); assert.equal(g.heroes[0].rage, 40);
});

test('party limit, support elite factor and hero uniqueness are enforced', () => {
  const party = ['guan_yu', 'guan_yu', 'cao_cao', 'xiahou_dun'].map(heroId => ({ heroId }));
  const g = new V1Game({ levelId: 'wei_001', party }); assert.equal(g.heroes.length, 1);
  const three = fixture(['guan_yu', 'cao_cao', 'xiahou_dun']);
  const e = enemy(three, 'armor'); const inf = enemy(three, 'infantry');
  const base = B.enemies.armor.hp * three.tier.hpMultiplier * B.party.enemyHpMultipliersByPartySize[3];
  assert.equal(e.hp, Math.ceil(base)); assert.equal(inf.hp, Math.ceil(B.enemies.infantry.hp * three.tier.hpMultiplier));
});

test('manual queue locks targets, reserves without double click and spaces execution', () => {
  const g = fixture(['guan_yu', 'xiahou_dun', 'cao_cao']); enemy(g, 'armor', 420);
  for (const h of g.heroes) filled(h);
  assert.equal(g.castUltimate('guan_yu').ok, true); assert.equal(g.rage, 0);
  assert.equal(g.castUltimate('xiahou_dun').ok, true); assert.equal(g.heroes[1].rage, 100); assert.equal(g.heroes[1].reserved, true);
  assert.equal(g.castUltimate('xiahou_dun').ok, false);
  assert.equal(g.castUltimate('cao_cao').ok, true); assert.equal(g.skillQueue.length, 2);
  const locked = structuredClone(g.skillQueue[0].target); g.enemies[0].x += 100;
  assert.deepEqual(g.skillQueue[0].target, locked);
  g.update(.9); assert.equal(g.stats.ultimateCasts, 1);
  g.update(.1); assert.equal(g.stats.ultimateCasts, 2);
  g.update(1); assert.equal(g.stats.ultimateCasts, 3); assert.equal(g.skillQueue.length, 0);
});

test('auto request is revalidated and cancelled without spending rage or recovery', () => {
  const g = fixture(['guan_yu', 'xiahou_dun']); const e = enemy(g, 'boss', 400);
  filled(g.heroes[0]); filled(g.heroes[1]); g.castUltimate();
  g._enqueue(g.heroes[1], true, g._target(g.heroes[1])); e.invulnerable = true;
  g.update(1); assert.equal(g.stats.cancelledAuto, 1); assert.equal(g.heroes[1].rage, 100);
  assert.equal(g.heroes[1].rageRecovery, 0); assert.equal(g.heroes[1].reserved, false);
});

test('Liu Bei auto saves healing at healthy gates but never bypasses target thresholds', () => {
  const g = fixture(['guan_yu', 'liu_bei']); const h = g.heroes[1];
  const targets = Array.from({ length: 8 }, () => enemy(g, 'infantry', g.paths[0].length - 130));
  const target = g._target(h); assert.equal(target.ordinaryCount, 8); assert.equal(g._canAuto(h, target), false);
  g.hp = 70; assert.equal(g._canAuto(h, target), true);
  for (const e of targets) e.hp = 0;
  assert.equal(g._canAuto(h, g._target(h)), false);
});

test('ordinary auto thresholds include cavalry while execution count remains infantry-only', () => {
  const g = fixture(['guan_yu', 'taishi_ci']); const h = g.heroes[1];
  for (let i = 0; i < 3; i++) enemy(g, 'cavalry', g.paths[0].length - 130);
  const target = g._target(h); assert.equal(target.ordinaryCount, 3); assert.equal(target.infantryCount, 0);
  assert.equal(g._canAuto(h, target), true);
});

test('pause and choice freeze movement, queues, rage recovery, fields and simulation time', () => {
  const g = fixture(['guan_yu', 'zhou_yu']); const e = enemy(g, 'armor', 400); filled(g.heroes[1]); g.castUltimate('zhou_yu');
  g.pause(); const snapshot = [g.time, e.progress, g.heroes[1].rageRecovery, g._casts[0].age]; g.update(4);
  assert.deepEqual([g.time, e.progress, g.heroes[1].rageRecovery, g._casts[0].age], snapshot);
  g.resume(); g._offerTactics(); assert.equal(g.state, 'choosing'); const before = g.time; g.update(4); assert.equal(g.time, before);
});

test('wave upgrades wait for the current release and queued skills to finish their opening', () => {
  for (const ids of [['guan_yu'], ['guan_yu', 'cao_cao']]) {
    const g = fixture(ids); g.wave = g.level.choiceAfterWaves[0]; g._between = 0; g._spawnQueue = []; g._spawnIndex = 0;
    enemy(g, 'infantry', g.paths[0].length - 40);
    for (const h of g.heroes) filled(h);
    for (const id of ids) assert.equal(g.castUltimate(id).ok, true);
    g.update(.2); assert.equal(g.activeEnemyCount, 0); assert.equal(g.state, 'playing', 'clearing enemies does not freeze a blade mid-release');
    if (ids.length === 1) {
      g.update(.69); assert.equal(g.state, 'playing'); g.update(.03);
    } else {
      g.update(.81); assert.equal(g.stats.ultimateCasts, 2); assert.equal(g.state, 'playing');
      g.update(.85); assert.equal(g.state, 'playing'); g.update(.08);
    }
    assert.equal(g.state, 'choosing'); assert.equal(g.skillQueue.length, 0);
    assert.ok(g.heroes.every(h => !h.casting)); assert.equal(g.wave, g.level.choiceAfterWaves[0]);
  }
});

test('Guan Yu executes only infantry inside the locked sweep and cannot mint kill rage', () => {
  const g = fixture(); const inf = enemy(g, 'infantry', 420, 0, { hp: 10000 });
  const cavalry = enemy(g, 'cavalry', 420, 0, { hp: 10000, maxHp: 10000 });
  const outside = enemy(g, 'infantry', 0, 0, { x: 800, y: 200, hp: 10000 });
  // Prevent path motion rewriting the intentionally outside fixture.
  outside.progress = 0; outside.speed = 0; inf.speed = 0; cavalry.speed = 0;
  filled(g.heroes[0]); g.castUltimate();
  const cast = g._casts[0]; g._skillDamage(.76);
  assert.equal(inf.hp, 0); assert.ok(cavalry.hp > 0 && cavalry.hp < 10000); assert.equal(outside.hp, 10000);
  assert.equal(cast.hits.get(cavalry.id), 1); assert.equal(g.rage, 0); assert.equal(g.stats.ultimateKills, 1);
});

test('all fifteen active skills resolve as distinct handlers with real damage and capped hits', () => {
  const shapes = new Set();
  for (const id of Object.keys(B.heroes)) {
    const g = fixture([id]); const e = enemy(g, 'armor', g.paths[0].length - 30, 0, { hp: 100000, maxHp: 100000, speed: 0 });
    filled(g.heroes[0]); const result = g.castUltimate(id); assert.equal(result.ok, true, id);
    const cast = g._casts[0]; shapes.add(cast.target.shape);
    // Mine fixtures stand on the exact configured route placement instead of inventing an off-route trigger.
    if (id === 'lv_meng') { const mine = cast.mines[0]; Object.assign(e, { x: mine.x, y: mine.y, laneId: mine.laneId }); }
    for (let i = 0; i < 540; i++) g._skillDamage(1 / 60);
    assert.ok(e.hp < 100000, id + ' has real active damage');
    const maximum = B.heroes[id].ultimate.maxTicksPerEnemyPerCast || B.heroes[id].ultimate.maxHitsPerEnemyPerCast;
    assert.ok((cast.hits.get(e.id) || 0) <= maximum, id + ' hit limit');
  }
  assert.ok(shapes.size >= 12);
});

test('delayed lock, three passes and late arrivals obey combat clock and per-enemy caps', () => {
  const g = fixture(['sima_yi']); const e = enemy(g, 'armor', 400, 0, { hp: 10000 }); filled(g.heroes[0]); g.castUltimate();
  g._skillDamage(.99); assert.equal(e.hp, 10000); g._skillDamage(.01); assert.ok(e.hp < 10000);
  const z = fixture(['zhao_yun']); const target = enemy(z, 'armor', 400, 0, { hp: 10000 }); filled(z.heroes[0]); z.castUltimate();
  const cast = z._casts[0]; z._skillDamage(.8); assert.equal(cast.hits.get(target.id), 3);
  const fire = fixture(['zhou_yu']); const first = enemy(fire, 'armor', 400, 0, { hp: 10000 }); filled(fire.heroes[0]); fire.castUltimate();
  fire._skillDamage(.5); const arriving = enemy(fire, 'armor', 400, 0, { hp: 10000 }); fire._skillDamage(4);
  assert.ok(first.hp < arriving.hp && arriving.hp < 10000); assert.equal(fire._casts.length, 0);
});

test('rescue and command circles stay on their heroes while ranged circles lock world positions', () => {
  for (const id of ['cao_cao', 'xiahou_dun', 'liu_bei', 'sun_quan']) {
    const g = fixture([id]); enemy(g, 'infantry', 100);
    const target = g._target(g.heroes[0]); assert.equal(target.x, g.heroes[0].x); assert.equal(target.y, g.heroes[0].y);
    assert.equal(target.count, 0, id + ' cannot remotely shock the entry');
  }
  const ranged = fixture(['sima_yi']); const e = enemy(ranged, 'armor', 150);
  const target = ranged._target(ranged.heroes[0]); assert.equal(target.x, e.x); assert.equal(target.y, e.y);
});

test('extended Zhou Yu fire admits late arrivals without extending an existing enemy hit budget', () => {
  const g = fixture(['zhou_yu']); g.tactics.add('zhou_yu_duration');
  const e = enemy(g, 'armor', 150, 0, { hp: 10000, maxHp: 10000, speed: 0 }); filled(g.heroes[0]); g.castUltimate();
  const cast = g._casts[0]; g._skillDamage(4.1); assert.equal(cast.hits.get(e.id), 16);
  const oldHp = e.hp; const arriving = enemy(g, 'armor', 150, 0, { hp: 10000, maxHp: 10000, speed: 0 });
  g._skillDamage(.5); assert.equal(e.hp, oldHp); assert.ok(arriving.hp < 10000); assert.equal(cast.hits.get(arriving.id), 2);
});

test('map reinforcements are warned before the actual cavalry pack in combat seconds', () => {
  for (const [mapId, name] of [['wu_reeds', '芦苇骑兵增援'], ['wei_pass', '雪骑来袭']]) {
    const level = CONTENT.levels.find(l => l.mapId === mapId && l.waves[3]?.units.cavalry > 0);
    const events = []; const g = new V1Game({ levelId: level.id, onEvent: e => events.push(e) });
    g.start(); g.wave = 3; g.enemies = []; g._spawnQueue = []; g._spawnIndex = 0; g._beginIntermission();
    const warning = events.find(e => e.type === 'reinforcementWarning'); assert.equal(warning.name, name);
    if (mapId === 'wu_reeds') assert.ok(warning.seconds >= 5 - 1e-8);
    else assert.equal(warning.wave, 4);
    for (let i = 0; i < 900 && !events.some(e => e.type === 'spawn' && e.enemy.type === 'cavalry'); i++) g.update(1 / 60);
    const spawn = events.find(e => e.type === 'spawn' && e.enemy.type === 'cavalry'); assert.ok(spawn);
    assert.ok(spawn.time - warning.time + 1e-8 >= warning.seconds);
  }
});

test('catapult slows the entire blast while damaging at most six actual units', () => {
  const g = fixture(); g.food = 1000; g.build(5, 'catapult'); const camp = g.camps[0];
  const enemies = Array.from({ length: 12 }, () => enemy(g, 'armor', 400, 0, { x: 200, y: 350, hp: 1000 }));
  g.projectiles.push({ type: 'catapult', camp, x: 200, y: 350, targetX: 200, targetY: 350, damage: 14, speed: 225, life: 1 });
  g._projectiles(1 / 60); assert.equal(enemies.filter(e => e.hp < 1000).length, 6);
  assert.ok(enemies.every(e => e.slowEffects.length === 1));
  assert.ok(enemies.every(e => Math.abs(e.slowEffects[0].factor - .86) < 1e-8));
});

test('independent weak slow cannot prolong stronger control; siege resistance applies once', () => {
  const g = fixture(); const e = enemy(g, 'siege', 300);
  g._slow(e, .5, .1, 'hero'); g._slow(e, .8, 2, 'stone');
  assert.ok(Math.abs(e.slowEffects[0].factor - (1 - .5 * .7 * .35)) < 1e-8);
  g.update(.1); assert.equal(e.slowEffects.length, 1); assert.equal(e.slowEffects[0].source, 'stone');
});

test('capacity queues real units and cannot grant an early wave victory', () => {
  const g = fixture(); for (let i = 0; i < 160; i++) enemy(g, 'armor', 0, 0, { speed: 0, hp: 1e6 });
  g._spawnQueue = [{ type: 'infantry', lane: 0, at: 0, wave: g.level.waves[0] }]; g._spawnIndex = 0; const spawned = g.stats.spawned;
  g.update(1 / 60); assert.equal(g.stats.spawned, spawned); assert.equal(g.pendingEnemyCount, 1); assert.equal(g.activeEnemyCount, 160);
  g.enemies[0].hp = 0; g.update(1 / 60); assert.equal(g.pendingEnemyCount, 0); assert.equal(g.stats.spawned, spawned + 1); assert.equal(g.state, 'playing');
});

test('boss variants warn and activate real haste, summons, guard and disruption', () => {
  for (const id of Object.keys(B.bossTemplates)) {
    const g = fixture(); g.food = 1000; g.build(5, 'archer');
    const e = g._spawn({ type: 'boss', lane: 0, progress: g.paths[0].length * .8, wave: g.level.waves[0], boss: { templateId: id, name: id, hpMultiplier: 1, ignoreWaveHpMultiplier: true } });
    g._enemyAbilities([e], 18); assert.equal(e.abilityCount, 1, id);
    if (id === 'rammer') assert.equal(e.escapeDamageMultiplier, 1.25);
    if (id === 'charger') assert.equal(e.bossAbilityRemaining, 4);
    if (id === 'guardian') assert.equal(e.damageTakenMultiplier, .75);
    if (id === 'siege_lord') assert.equal(g.camps[0].disruptions[0].bonus, .15);
    if (id === 'banner_lord') {
      assert.equal(g.pendingEnemyCount, 7); g.update(1 / 60); const summoned = g.enemies.filter(e => e.type === 'infantry');
      assert.equal(summoned.length, 6); assert.ok(summoned.every(e => e.reward === 0));
      const food = g.food; for (const s of summoned) g._damage(s, 1e6, 'test'); assert.equal(g.food, food);
    }
  }
});

test('presentation events: leak carries position and max HP; lastEnemy and waveClear fire once per wave', () => {
  const g = fixture(); const events = []; g.onEvent = e => events.push(e);
  g._spawnQueue = []; g._spawnIndex = 0;
  const a = enemy(g, 'infantry', 100, 0, { speed: 0 }), b = enemy(g, 'infantry', 120, 0, { speed: 0 });
  g.update(1 / 60); assert.equal(events.filter(e => ['lastEnemy', 'waveClear'].includes(e.type)).length, 0);
  g._damage(a, 1e6, 'test'); g.update(1 / 60); g.update(1 / 60);
  assert.deepEqual(events.filter(e => e.type === 'lastEnemy').map(e => [e.wave, e.enemyId]), [[g.wave, b.id]]);
  const leaker = enemy(g, 'infantry', g.paths[0].length - 0.01, 0);
  const hp = g.hp; g._damage(b, 1e6, 'test'); g.update(1 / 60);
  const leak = events.find(e => e.type === 'leak');
  assert.equal(leak.enemyId, leaker.id); assert.ok(Number.isFinite(leak.x) && Number.isFinite(leak.y));
  assert.equal(leak.maxHp, g.maxHp); assert.equal(leak.amount, leak.damage); assert.ok(Math.abs(hp - leak.damage - g.hp) < 1e-9);
  for (let i = 0; i < 5; i++) g.update(1 / 60);
  assert.equal(events.filter(e => e.type === 'waveClear' && e.wave === g.wave).length, 1);
  assert.equal(events.filter(e => e.type === 'lastEnemy').length, 1);
});

test('fire-oil fields are one per camp, refresh without resetting ticks; drum overlap does not stack rage', () => {
  const g = fixture(); g.food = 1000; g.build(5, 'fire_oil'); const c = g.camps[0];
  c.field = { x: 200, y: 400, radius: 58, remaining: 1, tick: .5 };
  g.projectiles = [{ type: 'fire_oil', camp: c, x: 200, y: 400, targetX: 200, targetY: 400, speed: 200, life: 1 }];
  g._projectiles(.01); assert.equal(c.field.remaining, 3); assert.equal(c.field.tick, .5);
  g.camps = []; g._addCamp(4, 'war_drum', 3); g._addCamp(5, 'war_drum', 3);
  assert.equal(g._friendlySpeed({ x: 210, y: 420 }), .2);
  const before = g.rage; g.update(1); assert.ok(Math.abs(g.rage - before - 1) < 1e-8);
});

test('map modifiers apply to one explicit camp and never to hero spells', () => {
  const g = fixture(['zhou_yu'], 'wei_006'); g.food = 1000; g._addCamp(6, 'archer', 1); g._addCamp(5, 'archer', 1);
  assert.equal(g.camps[0].range, B.camps.archer.levels[0].range * 1.1); assert.equal(g.camps[1].range, B.camps.archer.levels[0].range);
  const fire = fixture(['zhou_yu'], 'wu_011'); assert.equal(fire._target(fire.heroes[0]).radius, B.heroes.zhou_yu.ultimate.radius);
});

test('whole-army engagement grants one role rate per hero regardless of camp count', () => {
  const results = [1, 5].map(count => {
    const g = fixture(['guan_yu', 'cao_cao', 'xiahou_dun']);
    for (let slot = 0; slot < count; slot++) g._addCamp(slot, 'archer', 1);
    enemy(g, 'armor', g.paths[0].length - 100, 0, { hp: 1e6, maxHp: 1e6, speed: 0 });
    g.update(1); return g.heroes.map(h => h.rage);
  });
  assert.deepEqual(results[0], results[1]);
  assert.ok(Math.abs(results[0][0] - 44) < 1e-8); assert.ok(Math.abs(results[0][1] - 2) < 1e-8);
});

test('one, one-and-half and two speed produce identical V1 skills, control, queue and rage', () => {
  const results = [1, 1.5, 2].map(speed => {
    const g = fixture(['guan_yu', 'zhou_yu', 'sima_yi']); g.food = 1000; g._addCamp(5, 'catapult', 1);
    for (let i = 0; i < 12; i++) enemy(g, i < 8 ? 'infantry' : 'armor', g.paths[0].length - 100 + i * 2);
    for (const h of g.heroes) filled(h);
    for (const h of g.heroes) g.castUltimate(h.id);
    const clock = new CombatClock(); let ticks = 0;
    for (let frame = 0; frame < 480 / speed; frame++) clock.advance(1 / 60, speed, () => g.state === 'playing', dt => { ticks++; g.update(dt); });
    assert.equal(ticks, 480);
    return { time: g.time, hp: g.hp, food: g.food, kills: g.kills, enemies: g.enemies.map(e => ({ id: e.id, hp: e.hp, progress: e.progress, slowEffects: e.slowEffects })),
      heroes: g.heroes.map(h => ({ rage: h.rage, recovery: h.rageRecovery, reserved: h.reserved })), casts: g.stats.ultimateCasts, ultimateKills: g.stats.ultimateKills };
  });
  assert.deepEqual(results[0], results[1]); assert.deepEqual(results[0], results[2]); assert.ok(results[0].kills > 0);
});

test('all sixty stages clear with legal minimum training, earned battle food and actual bosses', { timeout: 120000 }, () => {
  const results = simulateCampaign();
  assert.deepEqual(results.filter(r => r.state !== 'won'), [], 'minimum training must not block normal campaign');
  assert.equal(results.length, 60); assert.equal(results.reduce((n, r) => n + r.bossKills, 0), 15);
  assert.equal(results.reduce((n, r) => n + r.bossEscapes, 0), 0);
  assert.ok(results.every(r => r.spawned === r.scheduled));
  assert.ok(results.every(r => r.peak <= 160));
  assert.ok(results.every(r => r.ultimateShare > .3));
  for (const id of ['wei_001', 'wei_020', 'shu_020', 'wu_020']) {
    const passive = simulateLevel(CONTENT.levels.find(l => l.id === id), { skills: false });
    assert.equal(passive.state, 'lost', id + ' must still need hero skills'); assert.equal(passive.casts, 0);
  }
});
