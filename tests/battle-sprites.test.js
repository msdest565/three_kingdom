import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { HERO_ART, PORTRAIT, heroPortrait } from '../hero-portraits.js';
import { HERO_MOTION, CAMP_IDS, ENEMY_IDS, createBattleSpriteCache, drawHeroSprite, drawCampSprite, drawEnemySprite, heroSpritePose } from '../battle-sprites.js';

function surface(width = 1, height = 1) {
  const operations = [], props = {};
  const context = new Proxy({ operations }, {
    get(target, key) {
      if (key in target) return target[key];
      if (key in props) return props[key];
      return (...args) => {
        for (const value of args) if (typeof value === 'number') assert.ok(Number.isFinite(value), `finite ${String(key)}`);
        if (key === 'arc') assert.ok(args[2] >= 0);
        if (key === 'ellipse') assert.ok(args[2] >= 0 && args[3] >= 0);
        operations.push([key, ...args]);
      };
    },
    set(target, key, value) { props[key] = value; operations.push(['set', key, value]); return true; },
  });
  return { width, height, getContext: () => context, context };
}

test('all fifteen battlefield appearances share the frozen portrait source, with metadata kept separate', () => {
  assert.equal(Object.keys(PORTRAIT).length, 15);
  assert.deepEqual(Object.keys(HERO_ART).sort(), Object.keys(PORTRAIT).sort());
  const cache = createBattleSpriteCache({ createCanvas: surface });
  for (const [id, p] of Object.entries(PORTRAIT)) {
    assert.deepEqual(Object.keys(HERO_ART[id]).sort(), ['faction', 'glyph', 'name', 'skill']);
    assert.ok(Object.isFrozen(p));
    const sprite = cache.get('hero', id);
    assert.equal(sprite.appearance, p, 'sprite exposes the actual shared appearance object');
    const fills = sprite.canvas.context.operations.filter(op => op[0] === 'set' && op[1] === 'fillStyle').map(op => op[2]);
    for (const color of [p.skin, p.cloth]) assert.ok(fills.includes(color), `${id} renders portrait ${color}`);
    const svg = decodeURIComponent(heroPortrait(id).split(',')[1]);
    assert.ok(svg.includes(p.skin) && svg.includes(p.cloth));
    assert.ok(!/(?:href=|<script|onload=|<image)/i.test(svg));
  }
  assert.equal(PORTRAIT.xu_chu.weapon, 'hammer'); assert.equal(PORTRAIT.gan_ning.weapon, 'bow');
  assert.equal(PORTRAIT.lv_meng.weapon, 'book'); assert.equal(PORTRAIT.sun_quan.weapon, 'sword');
  assert.equal(PORTRAIT.xiahou_dun.head, 'helmet'); assert.equal(PORTRAIT.xiahou_dun.plume, '#c8322a');
  assert.equal(HERO_ART.xiahou_dun.skill, '拔矢破军'); assert.equal(HERO_ART.sima_yi.skill, '三才幽雷');
});

test('all authored hero states render finite geometry without nameplates or mutation', () => {
  const before = JSON.stringify(PORTRAIT), appearances = new Set();
  for (const id of Object.keys(PORTRAIT)) {
    const idle = surface(); drawHeroSprite(idle.context, id); appearances.add(JSON.stringify(idle.context.operations));
    for (const [state, clip] of Object.entries(HERO_MOTION[id])) {
      for (let frame = 0; frame < clip.frames; frame++) {
        const canvas = surface(), options = Object.freeze({ state, frame });
        drawHeroSprite(canvas.context, id, options);
        assert.ok(!canvas.context.operations.some(op => ['fillText', 'strokeText'].includes(op[0])));
      }
    }
  }
  assert.equal(appearances.size, 15);
  assert.equal(JSON.stringify(PORTRAIT), before);
});

test('six camp mechanisms have distinct silhouettes, three level flags and visible release poses', () => {
  const signatures = new Set();
  assert.equal(CAMP_IDS.length, 6);
  for (const id of CAMP_IDS) {
    for (const level of [1, 2, 3]) {
      const canvas = surface(); drawCampSprite(canvas.context, id, { level });
      const ops = canvas.context.operations;
      const flags = ops.filter((op, i) => op[0] === 'moveTo' && op[2] === 8 && ops[i + 1]?.[0] === 'lineTo' && ops[i + 1]?.[1] === op[1] && ops[i + 1]?.[2] === -26);
      assert.equal(flags.length, level, `${id} grade ${level} flags`);
      assert.ok(!ops.some(op => ['fillText', 'strokeText'].includes(op[0])));
      if (level === 1) signatures.add(JSON.stringify(ops));
      const release = surface(); drawCampSprite(release.context, id, { state: 'attack', frame: 0, level });
      assert.notDeepEqual(release.context.operations, ops, `${id} attack changes its mechanism`);
      assert.ok(ops.some(op => op[0] === 'set' && op[1] === 'fillStyle' && op[2] === '#2f8a6e'), `${id} allied jade hats`);
    }
  }
  assert.equal(signatures.size, 6);
});

test('seven enemy silhouettes and five boss archetypes remain identifiable after caching', () => {
  const cache = createBattleSpriteCache({ createCanvas: surface });
  const prints = ENEMY_IDS.map(id => JSON.stringify(cache.get('enemy', id).canvas.context.operations));
  assert.equal(new Set(prints).size, 7);
  const bosses = ['rammer', 'charger', 'banner_lord', 'guardian', 'siege_lord'].map(variant => cache.get('enemy', 'boss', { variant }));
  assert.equal(new Set(bosses.map(sprite => JSON.stringify(sprite.canvas.context.operations))).size, 5);
  for (const id of ENEMY_IDS) {
    const walk = surface(), hit = surface();
    drawEnemySprite(walk.context, id); drawEnemySprite(hit.context, id, { state: 'hit' });
    assert.notDeepEqual(walk.context.operations, hit.context.operations, `${id} hit flash remains visible`);
  }
});

test('attack starts on release and casting clips preserve exact authored contact times', () => {
  for (const [id, motion] of Object.entries(HERO_MOTION)) {
    assert.equal(motion.idle.frames, 6); assert.equal(motion.ready.frames, 6);
    assert.equal(motion.ready.duration, motion.idle.duration / 1.3);
    assert.equal(motion.attack.release, 0); assert.equal(motion.attack.times[0], 0);
    assert.equal(motion.ultimate.times[0], 0); assert.equal(motion.ultimate.times.at(-1), .9);
    assert.notDeepEqual(heroSpritePose(id, { state: 'attack' }), heroSpritePose(id, { state: 'attack', frame: motion.attack.frames - 1 }));
    for (let i = 1; i < motion.ultimate.times.length; i++) assert.ok(motion.ultimate.times[i] > motion.ultimate.times[i - 1]);
  }
  assert.ok(HERO_MOTION.xiahou_dun.ultimate.times.includes(.36));
  assert.ok(HERO_MOTION.cao_cao.ultimate.times.includes(.42));
  assert.ok(HERO_MOTION.zhao_yun.ultimate.times.includes(.25) && HERO_MOTION.zhao_yun.ultimate.times.includes(.5));
  assert.equal(HERO_MOTION.xu_chu.ultimate.hit, 0);
  assert.ok(heroSpritePose('xu_chu', { state: 'ultimate' }).sq > .5, 'instant hit already has impact compression');
});

test('all ultimate contact metadata follows engine timing while keeping release and delayed hits separate', () => {
  const heroes = JSON.parse(readFileSync(new URL('../docs/v1/data/balance.json', import.meta.url), 'utf8')).v1Baseline.heroes;
  for (const [id, hero] of Object.entries(heroes)) {
    const u = hero.ultimate, clip = HERO_MOTION[id].ultimate;
    const firstHit = u.shape === 'lane_mines' ? null : u.landAtSec ?? u.flightSec ?? u.delaySec ?? u.firstTickAtSec ?? u.passAtSec?.[0] ?? 0;
    assert.equal(clip.hit, firstHit, `${id} uses actual first damage opportunity`);
    assert.equal(clip.duration, u.presentationLockSec, `${id} keeps the .9 s body lock`);
    assert.ok(clip.times.includes(clip.release), `${id} release has an exact body pose`);
    if (clip.hit != null && clip.hit <= clip.duration) assert.ok(clip.times.includes(clip.hit), `${id} first contact has an exact body pose`);
  }
  const thunder = HERO_MOTION.sima_yi.ultimate;
  assert.equal(thunder.release, .3); assert.equal(thunder.hit, 1); assert.equal(thunder.hitMode, 'delayed');
  assert.ok(thunder.hit > thunder.duration, 'lightning is an engine effect after the body animation has ended');
  const mine = HERO_MOTION.lv_meng.ultimate;
  assert.equal(mine.release, 0); assert.equal(mine.hit, null); assert.equal(mine.hitMode, 'proximity-trigger');
  for (const id of ['guan_yu', 'zhang_liao', 'liu_bei', 'sun_quan']) {
    assert.equal(HERO_MOTION[id].ultimate.hitMode, 'advancing-front');
    assert.equal(HERO_MOTION[id].ultimate.release, 0);
  }
});

test('immediate skills, advancing fronts and mine placement start with the real release pose', () => {
  const start = id => heroSpritePose(id, { state: 'ultimate', frame: 0 });
  assert.ok(start('liu_bei').arm >= .9, 'Liu Bei already commands the gate surge at 0');
  assert.ok(start('sun_quan').wa >= 1.1, 'Sun Quan already strikes down when the wave starts');
  assert.ok(start('zhang_fei').roar && start('zhang_fei').arm >= .9, 'Zhang Fei roars on the instant hit');
  assert.equal(start('taishi_ci').bowDraw, 0, 'Taishi Ci has released all three simultaneous target arrows');
  assert.ok(start('taishi_ci').arm >= .45);
  assert.ok(start('guan_yu').wa < -1, 'Guan Yu has swept before the front advances');
  assert.ok(start('zhang_liao').lean > .2 && start('zhang_liao').arm >= .8, 'Zhang Liao starts in the charging stance');
  assert.ok(start('lv_meng').wa > .4 && start('lv_meng').arm > 0, 'Lü Meng has placed mines at 0');
  assert.ok(start('xu_chu').sq > .5);
  assert.ok(start('zhao_yun').arm >= .8);
  const thunder = HERO_MOTION.sima_yi.ultimate;
  const gesture = heroSpritePose('sima_yi', { state: 'ultimate', frame: thunder.times.indexOf(thunder.release) });
  assert.ok(gesture.arm >= .9 && gesture.wa < 0, 'Sima Yi points at .3 without claiming lightning damage at .3');
});

test('Xu Chu holds the hammer against the ground in front on impact, then recovers upright', () => {
  const clip = HERO_MOTION.xu_chu.ultimate;
  for (const time of [0, .22]) {
    const pose = heroSpritePose('xu_chu', { state: 'ultimate', frame: clip.times.indexOf(time) });
    // Hammer-head corners occupy x ±9, y -44..-28 relative to the wielding hand.
    // Check their transformed ground contact, not only a named animation state.
    const handY = -14 - pose.arm * 8;
    const bottom = handY + 9 * Math.abs(Math.sin(pose.wa)) + Math.max(-44 * Math.cos(pose.wa), -28 * Math.cos(pose.wa));
    const centerX = 14 + 36 * Math.sin(pose.wa);
    assert.ok(centerX > 35, 'head lies in front of the body');
    assert.ok(Math.abs(bottom) < 2, 'head reaches the same ground plane as the feet');
    assert.ok(pose.sq >= .5, 'body keeps the impact compression');
  }
  const recovery = heroSpritePose('xu_chu', { state: 'ultimate', frame: clip.frames - 1 });
  assert.equal(recovery.wa, 0); assert.equal(recovery.arm, 0); assert.equal(recovery.sq, 0);
  assert.equal(clip.release, 0); assert.equal(clip.hit, 0);
});

test('DPR cache reuses frames, bounds its pixels, normalizes inputs and reduces motion to two poses', () => {
  let allocations = 0;
  const cache = createBattleSpriteCache({ createCanvas: (w, h) => { allocations++; return surface(w, h); }, maxPixels: 90_000 });
  const a = cache.get('hero', 'guan_yu', { dpr: 2 });
  assert.equal(a.canvas.width, a.width * 2); assert.equal(a.canvas.height, a.height * 2);
  assert.equal(cache.get('hero', 'guan_yu', { dpr: 2 }), a); assert.equal(allocations, 1);
  const different = cache.get('hero', 'guan_yu', { state: 'ready', dpr: 2 }); assert.notEqual(different, a);
  assert.ok(cache.stats().pixels <= 90_000);
  for (const id of Object.keys(PORTRAIT)) {
    const frames = HERO_MOTION[id].ultimate.frames;
    const first = cache.get('hero', id, { state: 'ultimate', frame: 0, reducedMotion: true });
    assert.equal(cache.get('hero', id, { state: 'ultimate', frame: 1, reducedMotion: true }), first);
    const pose = heroSpritePose(id, { state: 'ultimate', frame: 2, reducedMotion: true });
    assert.equal(pose.dy, 0); assert.equal(pose.lean, 0); assert.equal(pose.sq, 0);
    assert.ok(!('x' in pose) && !('y' in pose));
    const last = cache.get('hero', id, { state: 'ultimate', frame: frames - 1, reducedMotion: true });
    assert.notEqual(first, last);
  }
  const fallback = cache.get('hero', '__proto__', { frame: NaN, dpr: Infinity });
  assert.equal(fallback.id, 'guan_yu'); assert.equal(fallback.dpr, 1);
  assert.throws(() => cache.get('constructor', 'guan_yu'), RangeError);
});

function geometryEnvelope(operations) {
  let matrix = [1, 0, 0, 1, 0, 0], lineWidth = 1;
  const stack = [], bounds = [Infinity, Infinity, -Infinity, -Infinity];
  const point = (x, y, padding = lineWidth / 2) => {
    const [a, b, c, d, e, f] = matrix;
    const xx = a * x + c * y + e, yy = b * x + d * y + f;
    const px = Math.hypot(a, c) * padding, py = Math.hypot(b, d) * padding;
    bounds[0] = Math.min(bounds[0], xx - px); bounds[1] = Math.min(bounds[1], yy - py);
    bounds[2] = Math.max(bounds[2], xx + px); bounds[3] = Math.max(bounds[3], yy + py);
  };
  for (const [method, ...args] of operations) {
    const [a, b, c, d, e, f] = matrix;
    if (method === 'save') stack.push([matrix.slice(), lineWidth]);
    else if (method === 'restore') [matrix, lineWidth] = stack.pop();
    else if (method === 'set' && args[0] === 'lineWidth') lineWidth = args[1];
    else if (method === 'translate') matrix = [a, b, c, d, e + a * args[0] + c * args[1], f + b * args[0] + d * args[1]];
    else if (method === 'scale') matrix = [a * args[0], b * args[0], c * args[1], d * args[1], e, f];
    else if (method === 'rotate') {
      const cos = Math.cos(args[0]), sin = Math.sin(args[0]);
      matrix = [a * cos + c * sin, b * cos + d * sin, c * cos - a * sin, d * cos - b * sin, e, f];
    } else if (['moveTo', 'lineTo', 'quadraticCurveTo', 'bezierCurveTo'].includes(method)) {
      // Bézier paths stay inside their control-point hull, making this a conservative bound.
      for (let i = 0; i < args.length; i += 2) point(args[i], args[i + 1]);
    } else if (method === 'fillRect' || method === 'strokeRect') {
      for (const x of [args[0], args[0] + args[2]]) for (const y of [args[1], args[1] + args[3]]) point(x, y);
    } else if (method === 'arc' || method === 'ellipse') {
      const [x, y, rx] = args, ry = method === 'arc' ? rx : args[3];
      const rotation = method === 'arc' ? 0 : args[4];
      for (let i = 0; i < 64; i++) {
        const angle = i / 64 * Math.PI * 2, xx = rx * Math.cos(angle), yy = ry * Math.sin(angle);
        point(x + xx * Math.cos(rotation) - yy * Math.sin(rotation), y + xx * Math.sin(rotation) + yy * Math.cos(rotation));
      }
    }
  }
  assert.equal(stack.length, 0, 'canvas save/restore remains balanced');
  return bounds;
}

test('every cached pose fits its transparent surface, including rotated long weapons and flags', () => {
  const cache = createBattleSpriteCache({ createCanvas: surface });
  const check = (kind, id, options) => {
    const sprite = cache.get(kind, id, { ...options, dpr: 2 });
    const [left, top, right, bottom] = geometryEnvelope(sprite.canvas.context.operations);
    assert.ok(left > 0 && top > 0 && right < sprite.canvas.width && bottom < sprite.canvas.height,
      `${kind}/${id}/${JSON.stringify(options)} stays inside the bitmap: ${[left, top, right, bottom]}`);
  };
  for (const id of Object.keys(PORTRAIT)) for (const [state, clip] of Object.entries(HERO_MOTION[id])) {
    for (let frame = 0; frame < clip.frames; frame++) check('hero', id, { state, frame });
  }
  for (const id of CAMP_IDS) for (const level of [1, 2, 3]) for (const state of ['idle', 'attack']) {
    for (let frame = 0; frame < 5; frame++) check('camp', id, { state, level, frame });
  }
  for (const id of ENEMY_IDS) for (const state of ['walk', 'hit']) for (let frame = 0; frame < 6; frame++) check('enemy', id, { state, frame });
  for (const variant of ['rammer', 'charger', 'banner_lord', 'guardian', 'siege_lord']) check('enemy', 'boss', { variant });
});
