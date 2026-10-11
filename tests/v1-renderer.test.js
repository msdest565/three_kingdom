import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { V1Renderer } from '../v1-renderer.js';
import { HERO_ART, heroPortrait } from '../hero-portraits.js';

const content = JSON.parse(readFileSync(new URL('../docs/v1/data/levels.json', import.meta.url), 'utf8'));
const balance = JSON.parse(readFileSync(new URL('../docs/v1/data/balance.json', import.meta.url), 'utf8')).v1Baseline;

function canvasMock(rect = { left: 10, top: 20, width: 390, height: 600 }) {
  const operations = [];
  const gradient = { addColorStop() {} };
  const context = new Proxy({ operations, measureText: value => ({ width: Array.from(value).length * 8 }),
    createLinearGradient: () => gradient, createRadialGradient: () => gradient }, {
    get(target, key) {
      if (key in target) return target[key];
      return (...args) => {
        for (const value of args) if (typeof value === 'number') assert.ok(Number.isFinite(value), `Non-finite ${String(key)} argument`);
        if (key === 'arc') assert.ok(args[2] >= 0, 'Negative circle radius');
        operations.push([key, ...args]);
      };
    },
    set(target, key, value) { target[key] = value; return true; },
  });
  return { width: 0, height: 0, getContext: () => context, getBoundingClientRect: () => ({ ...rect, right: rect.left + rect.width, bottom: rect.top + rect.height }), context };
}

function makeRenderer(rect) {
  globalThis.window = { devicePixelRatio: 2 };
  globalThis.document = { createElement: () => canvasMock() };
  const canvas = canvasMock(rect);
  return { renderer: new V1Renderer(canvas), canvas };
}

test('all fifteen portraits are unique local SVGs with character equipment, without external assets', () => {
  const portraits = Object.keys(HERO_ART).map(heroPortrait);
  assert.equal(portraits.length, 15);
  assert.equal(new Set(portraits).size, 15);
  for (const [id, art] of Object.entries(HERO_ART)) {
    const svg = decodeURIComponent(heroPortrait(id).split(',')[1]);
    assert.ok(svg.includes(`<title>${art.name}</title>`));
    assert.ok(svg.includes('<path'));
    assert.ok(!/(?:href=|<script|onload=|<image)/i.test(svg));
  }
  assert.equal(heroPortrait('<script>'), heroPortrait('guan_yu'));
});

test('all twelve maps draw their actual route coordinates and additional camp slots can be selected', () => {
  const { renderer, canvas } = makeRenderer();
  assert.equal(content.maps.length, 12);
  assert.equal(new Set(content.maps.map(m => JSON.stringify(m.paths))).size, 12);
  for (const map of content.maps) {
    renderer.background.context.operations.length = 0;
    renderer.setMap(map);
    const ops = renderer.background.context.operations;
    for (const path of map.paths) for (const [index, p] of path.entries()) {
      assert.ok(ops.some(op => op[0] === (index ? 'lineTo' : 'moveTo') && op[1] === p.x && op[2] === p.y), `${map.id} route coordinate`);
    }
    const rect = canvas.getBoundingClientRect();
    for (const [index, slot] of map.campSlots.entries()) {
      assert.equal(renderer.hitTest(rect.left + slot.x * rect.width / 420, rect.top + slot.y * rect.height / 600), slot.slot ?? index);
    }
  }
  assert.equal(renderer.hitTest(-1, -1), -1);
  renderer.destroy();
});

test('short-screen hit targets have at least 44 CSS pixels and sprites retain equal scale', () => {
  const { renderer, canvas } = makeRenderer({ left: 0, top: 0, width: 320, height: 260 });
  renderer.setMap(content.maps[0]);
  const slot = content.maps[0].campSlots[0];
  assert.equal(renderer.hitTest(slot.x * 320 / 420 + 21, slot.y * 260 / 600), 0);
  renderer.draw({ map: content.maps[0], heroes: [], enemies: [], camps: [], hp: 100 });
  assert.ok(Math.abs(renderer.spriteScaleX * canvas.width / 420 - renderer.spriteScaleY * canvas.height / 600) < 1e-9);
});

test('draw renders every living engine enemy once, zero invented enemies, and never changes engine objects', () => {
  const { renderer } = makeRenderer();
  const original = renderer.drawV1Enemy.bind(renderer), drawn = [];
  renderer.drawV1Enemy = (ctx, unit, time) => { drawn.push(unit.id); original(ctx, unit, time); };
  const game = { map: content.maps[0], enemies: [], heroes: [], camps: [], effects: [], hp: 100, maxHp: 100 };
  renderer.draw(game);
  assert.equal(drawn.length, 0);
  game.enemies = ['infantry', 'cavalry', 'armor', 'ranged', 'banner', 'siege', 'boss'].map((type, index) =>
    ({ id: index + 1, type, x: 150 + index * 15, y: 250 + index * 20, hp: 80, maxHp: 100, hitFlash: 0, slow: 1 }));
  game.enemies.push({ id: 99, type: 'infantry', x: 190, y: 260, hp: 0 });
  const before = structuredClone(game);
  renderer.draw(game);
  assert.deepEqual(drawn, [1, 2, 3, 4, 5, 6, 7]);
  assert.deepEqual(game, before);
});

test('six camps, fifteen hero silhouettes and skills use finite Canvas geometry', () => {
  const { renderer } = makeRenderer();
  const camps = Object.keys({ shield: 1, archer: 1, crossbow: 1, catapult: 1, fire_oil: 1, war_drum: 1 }).map((type, slot) => ({ slot, type, level: 3 }));
  for (const [id, art] of Object.entries(HERO_ART)) {
    const u = balance.heroes[id].ultimate;
    const hero = { id, heroId: id, name: art.name, role: 'lead', x: 210, y: 550, rage: 100,
      target: { ...u, shape: u.shape, x: 210, y: 360, angle: -Math.PI / 2, laneId: 'route_0', targetIds: [1] } };
    const effects = [{ ...hero.target, type: 'ultimate', heroId: id, age: 0.4, life: 2 }];
    if (id === 'lv_meng') effects.push({ type: 'mine', heroId: id, x: 120, y: 160, radius: 45, age: 0.4, life: 8 });
    if (id === 'sima_yi') effects.push({ ...hero.target, type: 'ultimate', heroId: id, age: 1.1, life: 1.4 });
    renderer.draw({ map: content.maps[0], heroes: [hero], camps, effects,
      enemies: [{ id: 1, type: 'armor', x: 200, y: 350, hp: 100, maxHp: 120 }], hp: 25, maxHp: 100 }, { selectedSlot: 4, realDt: 1 / 30 });
    renderer.flashUltimate({ heroId: id, skillName: art.skill });
    renderer.draw({ map: content.maps[0], heroes: [hero], camps, effects, enemies: [], hp: 100 });
  }
  renderer.destroy();
  assert.equal(renderer.flash, null);
});
