import test from 'node:test';
import assert from 'node:assert/strict';
import { V1Game } from '../v1-engine.js';
import { BALANCE } from '../runtime-data.js';

const forward = -Math.PI / 2;
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-8, `${a} != ${b}`);
function fixture(party = ['guan_yu'], equipment = {}) {
  const events = [];
  const game = new V1Game({ levelId: 'shu_011', onEvent: event => events.push(event),
    party: party.map(heroId => ({ heroId, level: 20, skillLevel: 4, equipment: heroId === 'guan_yu' ? equipment : {} })) });
  const hero = game.heroes.find(h => h.id === 'guan_yu');
  game.start(); game.enemies = []; game.camps = []; game._spawnQueue = [{ at: 1e6 }];
  const unit = (x, y, extra = {}) => {
    const enemy = game._spawn({ type: 'infantry', lane: 0, progress: 300, wave: game.level.waves[0] });
    Object.assign(enemy, { x, y, speed: 0 }, extra); return enemy;
  };
  return { game, hero, unit, events };
}

test('Guan Yu keeps centered empty, single-unit and centered-cluster targets', () => {
  const { game, hero, unit } = fixture();
  const layouts = [[], [[210, 450]], [[195, 400], [225, 400], [210, 300]]];
  for (const layout of layouts) {
    game.enemies = []; for (const [x, y] of layout) unit(x, y);
    const target = game._target(hero);
    close(target.angle, forward);
    assert.equal(target.count, layout.length);
    assert.deepEqual(target.targetIds, game.enemies.map(e => e.id));
  }
});

test('Guan Yu still turns toward a genuinely stronger left or right army', () => {
  const angles = [];
  for (const x of [100, 320]) {
    const { game, hero, unit } = fixture();
    unit(210, 450);
    for (const y of [60, 80, 100]) unit(x, y);
    const target = game._target(hero);
    assert.equal(target.count, 4, 'Directional coverage must not be sacrificed for centering');
    assert.ok(x < 210 ? target.angle < forward : target.angle > forward);
    angles.push(target.angle - forward);
  }
  close(angles[0], -angles[1]);
});

test('unattackable left units cannot pull a centered Guan Yu preview off-axis', () => {
  const { game, hero, unit } = fixture();
  unit(100, 60, { hp: 0 }); unit(100, 80, { escaped: true }); unit(100, 100, { invulnerable: true });
  const center = unit(210, 450);
  const target = game._target(hero);
  close(target.angle, forward);
  assert.deepEqual(target.targetIds, [center.id]);
});

test('center preference uses Guan Yu own support position and retains extra sweep width', () => {
  const rules = BALANCE.metaProgression.equipment.templates.signature_guan_yu_weapon;
  const { game, hero, unit } = fixture(['cao_cao', 'guan_yu'], {
    weapon: { templateId: rules.id, quality: 'gold', level: 0 }
  });
  game.tactics.add('guan_yu_width');
  unit(hero.x, hero.y - 100);
  const target = game._target(hero);
  close(target.angle, forward); assert.equal(target.x, hero.x); assert.equal(target.y, hero.y);
  assert.equal(target.width, hero.definition.ultimate.width + 24 + rules.signatureBonuses.ultimateWidthAdd);
});

test('centered aim is shared by preview, locked cast, effect and actual hit geometry', () => {
  const { game, hero, unit, events } = fixture();
  const centered = [unit(195, 400), unit(225, 400), unit(210, 300)];
  const outside = unit(0, 540);
  game._refreshTargets(); close(hero.target.angle, forward);
  hero.rage = 100; assert.equal(game.castUltimate(hero.id).ok, true);
  const cast = game._casts[0], effect = game.effects.find(e => e.type === 'ultimate');
  close(cast.target.angle, forward); close(effect.angle, forward);
  close(events.find(e => e.type === 'ultimate').angle, forward);
  game._skillDamage(hero.definition.ultimate.frontTravelSec);
  assert.ok(centered.every(e => e.hp === 0)); assert.ok(outside.hp > 0);
  assert.deepEqual(centered.map(e => cast.hits.get(e.id)), [1, 1, 1]);
  assert.equal(cast.hits.has(outside.id), false);
});

test('repeated center decisions preserve stable targets without consuming battle RNG', () => {
  const { game, hero, unit } = fixture();
  unit(195, 400); unit(225, 400); unit(210, 300);
  let randomCalls = 0; game.rng = () => { randomCalls++; return .5; };
  const expected = game._target(hero);
  for (let i = 0; i < 30; i++) assert.deepEqual(game._target(hero), expected);
  assert.equal(randomCalls, 0);
});
