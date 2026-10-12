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

test('damage labels use actual event amounts, merge only tower hits in a short window, and stay bounded', t => {
  let clock = 1000; t.mock.method(globalThis.performance, 'now', () => clock);
  const { renderer, canvas } = makeRenderer();
  const first = { type: 'damage', enemyId: 7, x: 120, y: 160, source: 'camp_archer', amount: 4.25 };
  const before = structuredClone(first); renderer.handleEvent(first);
  clock += 80; renderer.handleEvent({ ...first, amount: 6.25 });
  assert.deepEqual(first, before);
  assert.equal(renderer.damageLabels.length, 1);
  assert.equal(renderer.damageLabels[0].amount, 10.5);
  assert.equal(renderer.damageLabels[0].hits, 2);
  renderer.handleEvent({ ...first, source: 'hero_guan_yu', amount: 17 });
  renderer.handleEvent({ ...first, heroId: 'guan_yu', source: 'ultimate_guan_yu', castId: 2, amount: 28, executed: true });
  assert.equal(renderer.damageLabels.length, 3);
  assert.ok(renderer.damageLabels.slice(1).every(label => label.prominent));
  renderer.drawDamageLabels(canvas.context, clock / 1000);
  const labels = canvas.context.operations.filter(op => op[0] === 'fillText').map(op => op[1]);
  assert.deepEqual(labels, ['10.5 ·2击', '17', '击破 28']);
  clock += 60; renderer.handleEvent({ ...first, amount: 8 });
  assert.equal(renderer.damageLabels.length, 4, 'merging window does not stretch indefinitely');
  for (const amount of [0, -1, NaN, Infinity]) renderer.handleEvent({ ...first, amount });
  assert.equal(renderer.damageLabels.length, 4);
  for (let i = 0; i < 80; i++) renderer.handleEvent({ ...first, enemyId: i + 100, amount: i + 1 });
  assert.equal(renderer.damageLabels.length, 48);
  assert.equal(renderer.damageLabels.at(-1).amount, 80);
  assert.equal(renderer.damageLabels.at(-1).hits, 1);
});

test('death snapshots draw separately from living units and never affect engine counts or stats', t => {
  t.mock.method(globalThis.performance, 'now', () => 1000);
  const { renderer } = makeRenderer();
  const game = { map: content.maps[0], enemies: [{ id: 2, type: 'infantry', x: 170, y: 300, hp: 40, maxHp: 40 }],
    heroes: [], camps: [], effects: [], kills: 1, stats: { ultimateKills: 1 }, hp: 100 };
  const snapshot = structuredClone(game), live = [];
  renderer.drawV1Enemy = (_ctx, enemy) => live.push(enemy.id);
  const event = { type: 'kill', enemyId: 1, enemyType: 'armor', x: 150, y: 280, radius: 12, facing: Math.PI / 2 };
  renderer.handleEvent(event); event.x = 999;
  assert.equal(renderer.deathSnapshots[0].x, 150);
  renderer.draw(game);
  assert.deepEqual(live, [2]); assert.deepEqual(game, snapshot);
  for (let i = 0; i < 100; i++) renderer.handleEvent({ ...event, enemyId: i + 3 });
  assert.equal(renderer.deathSnapshots.length, 48);
});

test('feedback expires by wall time without catch-up playback and ignores hidden or destroyed scenes', t => {
  let clock = 1000; t.mock.method(globalThis.performance, 'now', () => clock);
  const { renderer } = makeRenderer();
  const hit = { type: 'damage', enemyId: 1, x: 100, y: 150, amount: 25, heroId: 'guan_yu' };
  renderer.handleEvent(hit); renderer.handleEvent({ ...hit, type: 'kill' });
  clock += 5000;
  renderer.draw({ heroes: [], enemies: [], camps: [], hp: 100 }, { realDt: 0 });
  assert.equal(renderer.damageLabels.length, 0); assert.equal(renderer.deathSnapshots.length, 0);
  globalThis.document.hidden = true; renderer.handleEvent(hit); assert.equal(renderer.damageLabels.length, 0);
  globalThis.document.hidden = false; renderer.handleEvent(hit); renderer.flashUltimate({ heroId: 'guan_yu' });
  renderer.resetFeedback(); assert.equal(renderer.damageLabels.length, 0); assert.equal(renderer.flash, null);
  renderer.handleEvent(hit); renderer.destroy(); renderer.handleEvent(hit);
  assert.equal(renderer.damageLabels.length, 0); assert.equal(renderer.deathSnapshots.length, 0);
});

test('Guan Yu blade front, preview origin, angle, and width match the locked engine geometry', () => {
  const { renderer, canvas } = makeRenderer();
  const hero = { heroId: 'guan_yu', definition: { ultimate: { frontTravelSec: 0.64 } } };
  const effect = { heroId: 'guan_yu', shape: 'directional_swept_rectangle', x: 190, y: 480,
    originX: 999, originY: 999, angle: -1.2, width: 208, length: 610, age: 0.32, life: 0.9 };
  const before = structuredClone(effect);
  canvas.context.operations.length = 0; renderer.drawSkillShape(canvas.context, effect, { game: { heroes: [hero] } });
  const ops = canvas.context.operations;
  assert.ok(ops.some(op => op[0] === 'translate' && op[1] === 190 && op[2] === 480));
  assert.ok(ops.some(op => op[0] === 'rotate' && op[1] === -1.2));
  assert.ok(ops.some(op => op[0] === 'rect' && op[1] === 0 && op[2] === -104 && op[3] === 610 && op[4] === 208));
  assert.ok(ops.some(op => op[0] === 'quadraticCurveTo' && op[3] === 305 && op[4] === 104), 'front is halfway at .32/.64 seconds');
  canvas.context.operations.length = 0; renderer.drawSkillShape(canvas.context, effect, { preview: true, game: { heroes: [hero] } });
  assert.ok(canvas.context.operations.some(op => op[0] === 'rect' && op[2] === -104 && op[3] === 610 && op[4] === 208));
  assert.deepEqual(effect, before);
});

test('reduced motion keeps skill markings and feedback positions static, without shake or moving corpses', t => {
  let clock = 1000; t.mock.method(globalThis.performance, 'now', () => clock);
  const { renderer, canvas } = makeRenderer(); renderer.reducedMotion = true;
  const effect = { heroId: 'guan_yu', shape: 'directional_swept_rectangle', x: 210, y: 550, angle: -Math.PI / 2, width: 184, length: 610 };
  const renderSkill = age => { canvas.context.operations.length = 0; renderer.drawSkillShape(canvas.context, { ...effect, age }); return structuredClone(canvas.context.operations); };
  assert.deepEqual(renderSkill(0.05), renderSkill(0.65));
  renderer.handleEvent({ type: 'damage', enemyId: 1, amount: 12, x: 120, y: 200 });
  renderer.handleEvent({ type: 'kill', enemyId: 1, x: 120, y: 200 });
  const renderFeedback = () => {
    canvas.context.operations.length = 0; renderer.drawDeaths(canvas.context, clock / 1000); renderer.drawDamageLabels(canvas.context, clock / 1000);
    return canvas.context.operations.filter(op => ['translate', 'rotate', 'scale'].includes(op[0]));
  };
  const first = structuredClone(renderFeedback()); clock += 250;
  assert.deepEqual(renderFeedback(), first);
  assert.ok(!first.some(op => op[0] === 'rotate'));
  renderer.flashUltimate({ heroId: 'guan_yu' });
  canvas.context.operations.length = 0; renderer.draw({ heroes: [], enemies: [], camps: [], hp: 100 });
  const backgroundIndex = canvas.context.operations.findIndex(op => op[0] === 'drawImage');
  assert.ok(!canvas.context.operations.slice(0, backgroundIndex).some(op => op[0] === 'translate'), 'no camera translation before the background');
});

test('fifteen skill geometries stay distinct and share a finite particle budget under dense casts', () => {
  const { renderer, canvas } = makeRenderer();
  const fingerprints = [];
  for (const [id, definition] of Object.entries(balance.heroes)) {
    const hero = { heroId: id, definition };
    const effect = { ...definition.ultimate, heroId: id, type: id === 'lv_meng' ? 'mine' : 'ultimate', x: 210, y: 350,
      angle: -Math.PI / 2, age: 1.1, life: 3, laneId: 'route_0', targets: [{ id: 1, x: 180, y: 220 }] };
    canvas.context.operations.length = 0; renderer.particlesRemaining = 160;
    renderer.drawSkillShape(canvas.context, effect, { game: { heroes: [hero] } });
    fingerprints.push(JSON.stringify(canvas.context.operations));
    for (let i = 0; i < 30; i++) renderer.drawSkillShape(canvas.context, effect, { game: { heroes: [hero] } });
    assert.ok(renderer.particlesRemaining >= 0 && renderer.particlesRemaining <= 160);
  }
  assert.equal(new Set(fingerprints).size, 15);
});
