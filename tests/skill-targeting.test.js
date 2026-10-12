import test from 'node:test';
import assert from 'node:assert/strict';
import { maximumCircleCoverage } from '../skill-targeting.js';
import { V1Game, seededRandom } from '../v1-engine.js';
import { BALANCE, CONTENT } from '../runtime-data.js';

const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-7, `${a} != ${b}`);
function fixture(id) {
  const events = [];
  const game = new V1Game({ levelId: 'wu_020', party: [{ heroId: id, level: 20, skillLevel: 4 }], onEvent: e => events.push(e) });
  game.start(); game.camps = []; game.enemies = []; game._spawnQueue = [{ at: 1e6 }];
  const unit = (x, y, type = 'infantry', extra = {}) => {
    const e = game._spawn({ type, lane: 0, progress: 300, wave: game.level.waves[0] });
    return Object.assign(e, { x, y, speed: 0 }, extra);
  };
  return { game, hero: game.heroes[0], unit, events };
}

test('all four directional heroes keep equal-coverage central armies centered and use the same locked shape', () => {
  for (const id of ['guan_yu', 'zhang_fei', 'zhao_yun', 'xu_chu']) {
    const { game, hero, unit } = fixture(id);
    for (const [x, y] of [[200, 410], [220, 410], [210, 350]]) unit(x, y);
    game._refreshTargets(); const target = hero.target;
    close(target.angle, -Math.PI / 2); assert.equal(target.count, 3, id);
    hero.rage = 100; assert.equal(game.castUltimate(id).ok, true);
    assert.deepEqual(game._casts[0].target, target);
  }
});

test('directional aim prefers two valid soldiers over one higher-weight isolated boss', () => {
  const { game, hero, unit } = fixture('guan_yu');
  const soldiers = [unit(20, 30), unit(20, 50)]; unit(400, 30, 'boss');
  const target = game._target(hero);
  assert.equal(target.count, 2); assert.ok(target.angle < -Math.PI / 2);
  assert.deepEqual(target.targetIds, soldiers.map(e => e.id));
});

test('directional interval search is at least as good as a dense independent angular grid', () => {
  const rng = seededRandom(12027);
  for (const id of ['guan_yu', 'zhang_fei', 'zhao_yun', 'xu_chu']) {
    for (let layout = 0; layout < 16; layout++) {
      const { game, hero, unit } = fixture(id);
      for (let i = 0; i < 12; i++) unit(rng() * 420, rng() * 540, i % 4 ? 'infantry' : 'armor');
      const target = game._target(hero), u = hero.definition.ultimate;
      const min = u.angleMinRad ?? -Math.PI * .7, max = u.angleMaxRad ?? -Math.PI * .3;
      let gridBest = 0;
      for (let sample = 0; sample <= 1280; sample++) {
        const angle = min + (max - min) * sample / 1280;
        gridBest = Math.max(gridBest, game.enemies.filter(e => game._inShape(e, { ...target, angle }, u)).length);
      }
      assert.ok(target.count >= gridBest, `${id} layout${layout}: ${target.count} < ${gridBest}`);
    }
  }
});

test('traveling Guan Yu blade anticipates current path motion without mutating units or locking to a grazing edge', () => {
  for (const offset of [0, 15, 30]) {
    const game = new V1Game({ levelId: 'wei_001', party: [{ heroId: 'guan_yu' }] });
    game.start(); game.camps = []; game._spawnQueue = [{ at: 1e6 }]; game._spawnIndex = 0;
    for (let i = 0; i < 24; i++) game._spawn({ type: 'infantry', lane: i % 2,
      progress: 90 + i % 12 * 25 + offset, wave: game.level.waves[0] });
    const before = structuredClone(game.enemies), hero = game.heroes[0];
    const target = game._target(hero); assert.deepEqual(game.enemies, before, 'forecasting is a read-only aim calculation');
    hero.rage = 100; game.castUltimate(); const cast = game._casts[0];
    game.update(hero.definition.ultimate.frontTravelSec);
    assert.equal(cast.kills, target.count, 'moving troops remain inside the arriving blade');
    assert.ok(cast.kills >= 20); assert.ok(cast.kills < 24, 'the aim does not invent full-field kills');
  }
});

test('all movable circular heroes cover triangle clusters whose optimal center is between enemies', () => {
  for (const id of ['sima_yi', 'zhuge_liang', 'zhou_yu', 'gan_ning']) {
    const { game, hero, unit } = fixture(id);
    for (const [x, y] of [[120, 148], [300, 148], [210, 304]]) unit(x, y);
    const target = game._target(hero);
    assert.equal(target.count, 3, id); assert.ok(game.enemies.every(e => game._inShape(e, target, hero.definition.ultimate)));
  }
});

test('circle aiming favors maximum population, skips unattackable units and is stable without RNG', () => {
  for (const id of ['sima_yi', 'zhuge_liang', 'zhou_yu', 'gan_ning']) {
    const { game, hero, unit } = fixture(id);
    const good = [unit(80, 50), unit(85, 55)]; unit(400, 480, 'boss');
    for (let i = 0; i < 12; i++) unit(400, 480, 'infantry', { invulnerable: true });
    let calls = 0; game.rng = () => { calls++; return .5; };
    const target = game._target(hero);
    assert.equal(target.count, 2, id); assert.deepEqual(target.targetIds, good.map(e => e.id));
    assert.deepEqual(game._target(hero), target); assert.equal(calls, 0);
  }
});

// Independent small-army oracle enumerates all feasible-disk intersections and
// verifies the optimized sweep's population against the exact candidate set.
function bruteCircleCount(units, radius) {
  const candidates = [...units];
  for (let i = 0; i < units.length; i++) for (let j = i + 1; j < units.length; j++) {
    const a = units[i], b = units[j], r = radius + a.radius, s = radius + b.radius;
    const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy);
    if (d < 1e-9 || d > r + s || d < Math.abs(r - s)) continue;
    const along = (r * r - s * s + d * d) / (2 * d), height = Math.sqrt(Math.max(0, r * r - along * along));
    const x = a.x + along * dx / d, y = a.y + along * dy / d;
    candidates.push({ x: x - height * dy / d, y: y + height * dx / d }, { x: x + height * dy / d, y: y - height * dx / d });
  }
  return Math.max(...candidates.map(p => units.filter(e => Math.hypot(p.x - e.x, p.y - e.y) <= radius + e.radius + 1e-7).length));
}

test('circle sweep matches independent maximum-cover oracle with variable collision sizes', () => {
  const rng = seededRandom(12026);
  for (let layout = 0; layout < 50; layout++) {
    const units = Array.from({ length: 12 }, (_, id) => ({ id, x: rng() * 420, y: rng() * 530, radius: [7, 9, 11, 21][id % 4] }));
    const radius = [98, 125, 135, 150][layout % 4];
    const target = maximumCircleCoverage(units, radius, { x: 210, y: 400 }, () => 1);
    const actual = units.filter(e => Math.hypot(target.x - e.x, target.y - e.y) <= radius + e.radius + 1e-7).length;
    assert.equal(actual, bruteCircleCount(units, radius), `layout ${layout}`); assert.equal(target.count, actual);
  }
});

test('circular optimizer handles full capacity, coincident and tangential targets without subsampling', () => {
  const units = Array.from({ length: 160 }, (_, id) => ({ id, x: id % 2 ? 105 : 315, y: 200, radius: 7 }));
  const target = maximumCircleCoverage(units, 98, { x: 210, y: 405 }, () => 1);
  assert.equal(target.count, 160); close(target.x, 210); close(target.y, 200);
  const same = maximumCircleCoverage(units.map(e => ({ ...e, x: 200 })), 98, { x: 210, y: 405 }, () => 1);
  assert.equal(same.count, 160); close(same.x, 200); close(same.y, 200);
});

test('command/rescue heroes retain their own fixed circles and snipes retain three distinct targets', () => {
  for (const id of ['cao_cao', 'xiahou_dun', 'liu_bei', 'sun_quan']) {
    const { game, hero, unit } = fixture(id); for (let i = 0; i < 20; i++) unit(100, 100);
    const target = game._target(hero); assert.equal(target.count, 0); assert.equal(target.x, hero.x); assert.equal(target.y, hero.y);
  }
  const { game, hero, unit } = fixture('taishi_ci'); for (let i = 0; i < 8; i++) unit(210, 300);
  const target = game._target(hero); assert.equal(target.count, 3); assert.equal(new Set(target.targetIds).size, 3);
});

test('route heroes prioritize legal troop coverage over one isolated high-weight boss', () => {
  const mines = fixture('lv_meng');
  mines.unit(100, 100, 'boss', { laneId: 'route_0' });
  for (let i = 0; i < 2; i++) mines.unit(210, 100, 'infantry', { laneId: 'route_1' });
  for (let i = 0; i < 3; i++) mines.unit(320, 100, 'infantry', { laneId: 'route_2' });
  const mineTarget = mines.game._target(mines.hero);
  assert.deepEqual(mineTarget.laneIds, ['route_2', 'route_1']); assert.equal(mineTarget.count, 5);
  const charge = fixture('zhang_liao');
  const left = charge.game.pathPoint('route_0', 100), right = charge.game.pathPoint('route_2', 100);
  charge.unit(left.x, left.y, 'boss', { laneId: 'route_0' });
  for (let i = 0; i < 3; i++) charge.unit(right.x, right.y, 'infantry', { laneId: 'route_2' });
  const target = charge.game._target(charge.hero);
  assert.equal(target.laneId, 'route_2'); assert.equal(target.count, 3);
});

test('damage and death feedback reports actual capped damage once and never double-rewards a corpse', () => {
  const { game, unit, events } = fixture('guan_yu'); const e = unit(210, 300, 'armor', { hp: 11, maxHp: 11 });
  const initialFood = game.food;
  assert.equal(game._damage(e, 5, 'hero_guan_yu'), false);
  assert.equal(game._damage(e, 100, 'hero_guan_yu'), true);
  assert.equal(game._damage(e, 100, 'hero_guan_yu'), false);
  assert.deepEqual(events.filter(v => v.type === 'damage').map(v => v.amount), [5, 6]);
  const kills = events.filter(v => v.type === 'kill'); assert.equal(kills.length, 1); assert.equal(kills[0].amount, 6);
  assert.equal(kills[0].heroId, 'guan_yu'); assert.equal(game.food - initialFood, e.reward);
  assert.equal(game.kills, 1); assert.equal(game.stats.sourceStats.hero_guan_yu.damage, 11);
});
