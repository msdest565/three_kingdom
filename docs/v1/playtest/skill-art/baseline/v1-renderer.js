/**
 * V1Renderer: canvas presentation layer for 无双守关 battles. It reads the engine state and never writes it.
 *
 * DOM integration: `renderer.consumeUiEvents()` returns the queued UI cues in order and clears the queue.
 * Each fact is reported at most once. It may come from a forwarded engine event (`handleEvent`) or from the
 * per-frame diff that `draw()` runs on the game state, so cues still arrive when the caller forwards only some
 * engine events. The queue is bounded (UI_EVENT_LIMIT, oldest dropped). After a long gap (hidden tab) or a new
 * game object, the diff rebaselines silently, so cues are never replayed in a burst. Coordinates are world units (420 × 600).
 *   { type: 'gateHit', amount, hp, maxHp, ratio, x, y }    gate lost HP (enemy leak)
 *   { type: 'gateStage', stage, previous, ratio }          gate damage state changed: 0 intact, 1 ≤70%, 2 ≤40%, 3 ≤15%
 *   { type: 'build', slot, campType, level, x, y }         a camp was placed
 *   { type: 'upgrade', slot, campType, level, x, y }       a camp gained a level
 *   { type: 'waveClear', wave, final }                     every enemy of the wave is gone
 *   { type: 'lastEnemy', wave, enemyId, x, y }             one enemy left and nothing pending
 *   { type: 'shake', strength, duration, source }          source 'ultimate' (6px / 0.38s) or 'gate' (3px / 0.2s);
 *                                                           never queued with reduced motion
 * Reduced motion removes shake, zoom punch, flashes, pop scaling and drop/bounce. It keeps ranges, numbers,
 * cracks and ink blots.
 */
import { Renderer, CAMP_SLOTS, WORLD_WIDTH, WORLD_HEIGHT } from './renderer.js';
import { HERO_ART } from './hero-portraits.js';

const TAU = Math.PI * 2;
const CAMP_NAMES = { shield: '盾营', archer: '弓营', crossbow: '弩营', catapult: '投石营', fire_oil: '火油营', war_drum: '战鼓营' };
const ENVIRONMENTS = {
  wei_gate: { ground: '#96916e', dark: '#747653', road: '#cebf94', prop: 'fence' },
  wei_river: { ground: '#949782', dark: '#697c73', road: '#d1c7a0', prop: 'warehouse', water: true },
  wei_pass: { ground: '#8d9690', dark: '#687974', road: '#c3c4b0', prop: 'snow' },
  wei_fort: { ground: '#85908b', dark: '#586e65', road: '#bdbba0', prop: 'fort' },
  shu_village: { ground: '#91a174', dark: '#638058', road: '#d3c89a', prop: 'farm' },
  shu_valley: { ground: '#7e9878', dark: '#4f755b', road: '#c7bc91', prop: 'bamboo' },
  shu_mountain: { ground: '#78908a', dark: '#4e716b', road: '#bcba99', prop: 'cliff' },
  shu_river: { ground: '#829c86', dark: '#547e77', road: '#c9c29b', prop: 'bridge', water: true },
  wu_dock: { ground: '#89a3a0', dark: '#527c7b', road: '#c8b691', prop: 'dock', water: true },
  wu_reeds: { ground: '#93a187', dark: '#5f827c', road: '#c9c3a1', prop: 'reeds', water: true },
  wu_fire: { ground: '#a39879', dark: '#776f59', road: '#d5bf94', prop: 'charred' },
  wu_fort: { ground: '#8f9a8c', dark: '#5b8078', road: '#c4bca0', prop: 'water-fort', water: true },
};
const DEFAULT_MAP = { id: 'wei_gate', name: '演武沙盘', campSlots: CAMP_SLOTS,
  paths: [[{ x: 100, y: -20 }, { x: 110, y: 160 }, { x: 210, y: 310 }, { x: 210, y: 530 }],
    [{ x: 320, y: -20 }, { x: 310, y: 160 }, { x: 210, y: 310 }, { x: 210, y: 530 }]] };
const clamp = (n, min = 0, max = 1) => Math.min(max, Math.max(min, n));
const nowSeconds = () => (globalThis.performance?.now?.() ?? Date.now()) / 1000;
const FEEDBACK_LIMIT = 48;
const PARTICLE_LIMIT = 160;
const UI_EVENT_LIMIT = 64;
const TRACK_LIMIT = 400;
const SHAKE = { ultimate: { strength: 6, duration: 0.38 }, gate: { strength: 3, duration: 0.2 } };
const PUNCH = { scale: 1.03, duration: 0.22 };
const GATE_STAGES = [0.7, 0.4, 0.15];
const BUILD_ANIM = 0.32, UPGRADE_ANIM = 0.45, RANGE_RING = 1, SPAWN_ANIM = 0.35, HIT_FLASH = 0.08, GATE_FLASH = 0.5;
const DEATH_LIFE = 1.2, CORPSE_LIFE = 0.72, SPATTER_LIFE = 0.6, EDGE_FLASH = 0.35, GATE_LABEL_LIFE = 0.9;
const gateStage = ratio => GATE_STAGES.filter(t => ratio <= t).length;
const easeOutBack = t => { const c = 1.70158; return 1 + (c + 1) * (t - 1) ** 3 + c * (t - 1) ** 2; };
const easeOutCubic = t => 1 - (1 - t) ** 3;
const round1 = n => Math.round(n * 10) / 10;
function oval(ctx, x, y, rx, ry, color) {
  ctx.fillStyle = color; ctx.beginPath(); ctx.ellipse(x, y, rx, ry, 0, 0, TAU); ctx.fill();
}
function polygon(ctx, points, fill, stroke = null) {
  ctx.beginPath(); points.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)); ctx.closePath();
  if (fill) { ctx.fillStyle = fill; ctx.fill(); } if (stroke) { ctx.strokeStyle = stroke; ctx.stroke(); }
}
function line(ctx, points, color, width = 1.5) {
  ctx.strokeStyle = color; ctx.lineWidth = width; ctx.beginPath();
  points.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)); ctx.stroke();
}
function text(ctx, value, x, y, size = 11, color = '#eedfb3') {
  ctx.font = `600 ${size}px "Microsoft YaHei", "PingFang SC", sans-serif`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  const w = ctx.measureText(value).width + 10;
  ctx.fillStyle = '#193d32ed'; ctx.fillRect(x - w / 2, y - size / 2 - 3, w, size + 6);
  ctx.fillStyle = color; ctx.fillText(value, x, y);
}
function roadPath(ctx, path) {
  ctx.beginPath(); path.forEach((p, i) => i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y));
}
function distanceToSegment(x, y, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const t = clamp(((x - a.x) * dx + (y - a.y) * dy) / (dx * dx + dy * dy || 1));
  return Math.hypot(x - a.x - t * dx, y - a.y - t * dy);
}
function partialPath(path, fraction) {
  const total = path.slice(1).reduce((n, p, i) => n + Math.hypot(p.x - path[i].x, p.y - path[i].y), 0);
  let remaining = total * clamp(fraction);
  const points = [path[0]];
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1], b = path[i], distance = Math.hypot(b.x - a.x, b.y - a.y);
    if (remaining >= distance) { points.push(b); remaining -= distance; }
    else { points.push({ x: a.x + (b.x - a.x) * remaining / (distance || 1), y: a.y + (b.y - a.y) * remaining / (distance || 1) }); break; }
  }
  return points;
}

/** V1 visual layer only. Gameplay, clocks and hit outcomes belong to the engine. */
export class V1Renderer extends Renderer {
  constructor(canvas, { reducedMotion = false } = {}) {
    super(canvas, { reducedMotion });
    this.map = DEFAULT_MAP;
    this.visualTime = 0;
    this.cssIso = 1;
    this.spriteScaleX = this.spriteScaleY = 1;
    this.damageLabels = [];
    this.deathSnapshots = [];
    this.particlesRemaining = PARTICLE_LIMIT;
    this.impactStarted = -Infinity;
    // 'low' halves decorative particles and drops ambient motion; units, threat rings and hit shapes are untouched.
    this.quality = 'high';
    // The DOM #field-hint shows the map name and rule, so the canvas no longer draws a second label at the top.
    this.mapLabel = false;
    this.initFeedbackState();
    this.setMap(DEFAULT_MAP);
  }

  initFeedbackState() {
    this.uiEvents = [];
    this.campAnims = new Map();   // slot -> { kind: 'build' | 'upgrade', started, level }
    this.spawnAnims = new Map();  // enemyId -> { started, x, y }
    this.hitFlashes = new Map();  // enemyId -> started
    this.shakes = [];
    this.punchStarted = -Infinity;
    this.edgeFlashStarted = -Infinity;
    this.gateFx = { flashStarted: -Infinity, labels: [], stage: 0, lastShake: -Infinity };
    this.lastEnemy = null;
    this.tracked = null;
    this.lastDrawAt = -Infinity;
  }

  /** Returns and clears the queued DOM cues. See the comment at the top of this file. */
  consumeUiEvents() {
    const events = this.uiEvents; this.uiEvents = []; return events;
  }

  pushUi(cue) {
    if (this.destroyed) return;
    this.uiEvents.push(cue);
    if (this.uiEvents.length > UI_EVENT_LIMIT) this.uiEvents.splice(0, this.uiEvents.length - UI_EVENT_LIMIT);
  }

  shake(source, now = nowSeconds()) {
    if (this.reducedMotion) return;
    const spec = SHAKE[source]; if (!spec) return;
    this.shakes.push({ ...spec, source, started: now });
    if (this.shakes.length > 4) this.shakes.shift();
    this.pushUi({ type: 'shake', strength: spec.strength, duration: spec.duration, source });
  }

  setMap(map) {
    this.map = map?.paths?.length ? map : DEFAULT_MAP;
    const ctx = this.background.getContext('2d');
    ctx.setTransform(2, 0, 0, 2, 0, 0);
    this.drawBackground(ctx);
  }

  hitTest(clientX, clientY) {
    const rect = this.canvas.getBoundingClientRect();
    const right = rect.right ?? rect.left + rect.width, bottom = rect.bottom ?? rect.top + rect.height;
    if (!rect.width || !rect.height || clientX < rect.left || clientX > right || clientY < rect.top || clientY > bottom) return -1;
    const sx = rect.width / WORLD_WIDTH, sy = rect.height / WORLD_HEIGHT;
    // Work in CSS pixels so short screens still have a 44px touch diameter.
    const radius = Math.max(22, Math.min(sx, sy) * 34);
    let best = -1, nearest = Infinity;
    (this.map?.campSlots ?? CAMP_SLOTS).forEach((slot, index) => {
      const distance = Math.hypot(clientX - rect.left - slot.x * sx, clientY - rect.top - slot.y * sy);
      if (distance <= radius && distance < nearest) { nearest = distance; best = slot.slot ?? index; }
    });
    return best;
  }

  flashUltimate(event = {}) {
    if (event.type === 'burst' || event.type === 'ultimate_result') {
      if (this.flash && (!event.heroId || event.heroId === this.flash.heroId)) { this.flash.kills = event.kills ?? event.count ?? 0; this.flash.resultAt = nowSeconds(); }
      return;
    }
    this.flash = { started: nowSeconds(), heroId: event.heroId ?? event.hero?.heroId ?? event.hero?.id,
      name: event.skillName ?? event.name, kills: event.kills ?? 0, resultAt: null };
    this.impactStarted = this.flash.started;
    // "无双震屏请大胆优先": 6px shake decaying over 0.38s, a 1.03 zoom punch and a chromatic edge flash.
    // The DOM cut-in owns the hero/skill title, so the canvas adds no second title here.
    if (!this.reducedMotion && !this.destroyed) {
      this.shake('ultimate', this.flash.started);
      this.punchStarted = this.edgeFlashStarted = this.flash.started;
    }
  }

  pruneFeedback(now = nowSeconds()) {
    this.damageLabels = this.damageLabels.filter(label => now - label.started < label.life);
    this.deathSnapshots = this.deathSnapshots.filter(death => now - death.started < death.life);
    this.gateFx.labels = this.gateFx.labels.filter(label => now - label.started < GATE_LABEL_LIFE);
    this.shakes = this.shakes.filter(s => now - s.started < s.duration);
    for (const [id, started] of this.hitFlashes) if (now - started > HIT_FLASH) this.hitFlashes.delete(id);
  }

  gateHit(amount, { hp, maxHp, x, y } = {}, now = nowSeconds()) {
    if (!(amount > 0) || !Number.isFinite(amount)) return;
    const max = maxHp > 0 ? maxHp : this.tracked?.maxHp ?? 100;
    const current = Number.isFinite(hp) ? hp : Math.max(0, (this.tracked?.hp ?? max) - amount);
    if (this.tracked) this.tracked.hp = current;
    this.gateFx.flashStarted = now;
    const labelX = Number.isFinite(x) ? clamp(x, 175, 245) : 210;
    this.gateFx.labels.push({ amount: round1(amount), x: labelX, started: now });
    if (this.gateFx.labels.length > 6) this.gateFx.labels.shift();
    this.pushUi({ type: 'gateHit', amount: round1(amount), hp: current, maxHp: max, ratio: clamp(current / max), x: labelX, y: 530 });
    // Leaks can arrive in clusters; one 3px shake per 0.15s keeps it readable.
    if (now - this.gateFx.lastShake > 0.15) { this.gateFx.lastShake = now; this.shake('gate', now); }
    this.updateGateStage(current / max);
  }

  updateGateStage(ratio) {
    const stage = gateStage(clamp(ratio));
    if (stage !== this.gateFx.stage) {
      this.pushUi({ type: 'gateStage', stage, previous: this.gateFx.stage, ratio: clamp(ratio) });
      this.gateFx.stage = stage;
    }
  }

  campCue(kind, slot, camp, now = nowSeconds()) {
    if (!Number.isFinite(slot)) return;
    const level = clamp(camp?.level ?? 1, 1, 3), position = (this.map?.campSlots ?? CAMP_SLOTS).find((s, i) => (s.slot ?? i) === slot);
    this.campAnims.set(slot, { kind, started: now, level });
    if (this.tracked) this.tracked.camps.set(slot, `${camp?.type}:${level}`);
    this.pushUi({ type: kind, slot, campType: camp?.type, level, x: camp?.x ?? position?.x, y: camp?.y ?? position?.y });
  }

  spawnCue(enemy, now = nowSeconds()) {
    if (enemy?.id == null || this.tracked?.seen.has(enemy.id)) return;
    this.tracked?.seen.add(enemy.id);
    if (!Number.isFinite(enemy.x) || !Number.isFinite(enemy.y)) return;
    this.spawnAnims.set(enemy.id, { started: now, x: enemy.x, y: enemy.y });
    if (this.spawnAnims.size > TRACK_LIMIT) this.spawnAnims.delete(this.spawnAnims.keys().next().value);
  }

  waveClearCue(wave, final = false) {
    if (this.tracked) { if (this.tracked.clearedWave === wave) return; this.tracked.clearedWave = wave; }
    this.lastEnemy = null;
    this.pushUi({ type: 'waveClear', wave, final: Boolean(final) });
  }

  lastEnemyCue(wave, enemy, now = nowSeconds()) {
    if (this.tracked) { if (this.tracked.lastEnemyWave === wave) return; this.tracked.lastEnemyWave = wave; }
    this.lastEnemy = { enemyId: enemy?.id ?? enemy?.enemyId, started: now };
    this.pushUi({ type: 'lastEnemy', wave, enemyId: this.lastEnemy.enemyId, x: enemy?.x, y: enemy?.y });
  }

  handleEvent(event = {}) {
    if (this.destroyed || globalThis.document?.hidden) return;
    const now = nowSeconds();
    this.pruneFeedback(now);
    if (['ultimate', 'burst', 'ultimate_result'].includes(event.type)) { this.flashUltimate(event); return; }
    if (event.type === 'leak') { this.gateHit(Number(event.damage ?? event.amount), event, now); return; }
    if (event.type === 'heal') { if (this.tracked && Number.isFinite(event.heal)) this.tracked.hp = Math.min(this.tracked.maxHp, this.tracked.hp + event.heal); return; }
    if (event.type === 'build' || event.type === 'upgrade') { this.campCue(event.type, event.slot, event.camp, now); return; }
    if (event.type === 'spawn') { this.spawnCue(event.enemy, now); return; }
    if (event.type === 'waveClear') { this.waveClearCue(event.wave, event.final); return; }
    if (event.type === 'lastEnemy') { this.lastEnemyCue(event.wave, { id: event.enemyId, x: event.x, y: event.y }, now); return; }
    if (!Number.isFinite(event.x) || !Number.isFinite(event.y)) return;
    if (event.type === 'damage' && event.enemyId != null && Number.isFinite(event.amount) && event.amount > 0) {
      this.hitFlashes.set(event.enemyId, now);
      if (this.hitFlashes.size > TRACK_LIMIT) this.hitFlashes.delete(this.hitFlashes.keys().next().value);
    }
    if (event.type === 'damage' && Number.isFinite(event.amount) && event.amount > 0) {
      const skill = event.castId != null || /^ultimate_/.test(event.source ?? '');
      const heavy = ['elite', 'boss'].includes(event.enemyClass) || ['armor', 'siege', 'boss', 'banner'].includes(event.enemyType);
      // A Peerless crowd clear reads through death snapshots and the single burst count. Per-soldier skill
      // numbers stacked into an unreadable pile (40+ labels), so only elites/bosses keep a skill label.
      if (skill && !heavy) return;
      const prominent = Boolean(event.heroId) || /^(hero|ultimate)_/.test(event.source ?? '');
      const survivor = skill && heavy && Number.isFinite(event.hpAfter) && event.hpAfter > 0 && event.maxHp > 0 ? Math.max(1, Math.round(event.hpAfter / event.maxHp * 100)) : null;
      const merged = !prominent && this.damageLabels.find(label => !label.prominent && label.enemyId === event.enemyId
        && event.enemyId != null && now - label.started <= 0.12);
      if (merged) { merged.amount += event.amount; merged.hits++; }
      else {
        this.damageLabels.push({ enemyId: event.enemyId, x: event.x, y: event.y, amount: event.amount,
          heroId: event.heroId, source: event.source, castId: event.castId, executed: Boolean(event.executed),
          prominent, survivor, hits: 1, started: now, life: survivor ? 1.15 : prominent ? 0.95 : 0.7 });
        if (this.damageLabels.length > FEEDBACK_LIMIT) this.damageLabels.shift();
      }
    } else if (event.type === 'kill') {
      this.deathSnapshots.push({ enemyId: event.enemyId, type: event.enemyType ?? 'infantry', x: event.x, y: event.y,
        radius: clamp(Number(event.radius) || 10, 5, 28), facing: Number.isFinite(event.facing) ? event.facing : Math.PI / 2,
        heroId: event.heroId, source: event.source, castId: event.castId, started: now, life: DEATH_LIFE });
      if (this.deathSnapshots.length > FEEDBACK_LIMIT) this.deathSnapshots.shift();
      this.hitFlashes.delete(event.enemyId); this.spawnAnims.delete(event.enemyId);
    }
  }

  resetFeedback() {
    this.damageLabels = []; this.deathSnapshots = []; this.flash = null;
    this.impactStarted = -Infinity; this.visualTime = 0;
    this.initFeedbackState();
  }

  /**
   * Diffs the engine state against the last frame so build/upgrade/leak/spawn/wave cues work even when the
   * caller forwards only some engine events. Read-only: game objects are never written.
   */
  observe(game, now = nowSeconds()) {
    const max = game.maxHp ?? game.maxGateHp ?? 100, hp = game.hp ?? game.gateHp ?? max;
    const enemies = game.enemies ?? [], living = enemies.filter(e => e.hp > 0 && !e.escaped);
    const pending = Number.isFinite(game.pendingEnemyCount) ? game.pendingEnemyCount : null;
    const camps = new Map((game.camps ?? []).map(c => [c.slot, c]));
    const gap = now - this.lastDrawAt; this.lastDrawAt = now;
    // New game objects and long gaps (hidden tab, resume) rebaseline silently, without catch-up playback.
    if (!this.tracked || this.tracked.game !== game || gap > 0.5) {
      const seen = this.tracked?.game === game ? this.tracked.seen : new Set();
      for (const e of enemies) seen.add(e.id);
      this.tracked = { game, hp, maxHp: max, seen, living: living.length,
        camps: new Map([...camps].map(([slot, c]) => [slot, `${c.type}:${clamp(c.level ?? 1, 1, 3)}`])),
        clearedWave: this.tracked?.game === game ? this.tracked.clearedWave : null,
        lastEnemyWave: this.tracked?.game === game ? this.tracked.lastEnemyWave : null };
      this.gateFx.stage = gateStage(clamp(hp / max));
      return;
    }
    const t = this.tracked; t.maxHp = max;
    if (hp < t.hp - 1e-6) this.gateHit(t.hp - hp, { hp, maxHp: max }, now);
    else if (hp > t.hp) { t.hp = hp; this.updateGateStage(hp / max); }
    for (const [slot, camp] of camps) {
      const key = `${camp.type}:${clamp(camp.level ?? 1, 1, 3)}`, known = t.camps.get(slot);
      if (known === key) continue;
      this.campCue(known && known.split(':')[0] === camp.type ? 'upgrade' : 'build', slot, camp, now);
    }
    for (const slot of [...t.camps.keys()]) if (!camps.has(slot)) { t.camps.delete(slot); this.campAnims.delete(slot); }
    for (const e of living) if (!t.seen.has(e.id)) this.spawnCue(e, now);
    // Bounded: only ids still present in the engine list are remembered.
    if (t.seen.size > enemies.length) { const ids = new Set(enemies.map(e => e.id)); for (const id of t.seen) if (!ids.has(id)) t.seen.delete(id); }
    for (const id of this.spawnAnims.keys()) if (now - this.spawnAnims.get(id).started > SPAWN_ANIM) this.spawnAnims.delete(id);
    for (const [slot, anim] of this.campAnims) if (now - anim.started > RANGE_RING) this.campAnims.delete(slot);
    if (pending === 0 && Number.isFinite(game.wave) && game.wave > 0) {
      if (living.length === 1 && t.living > 1) this.lastEnemyCue(game.wave, living[0], now);
      if (living.length === 0 && t.living > 0) this.waveClearCue(game.wave, game.wave === game.waveCount);
    }
    t.living = living.length;
  }

  destroy() {
    this.resetFeedback(); this.destroyed = true; super.destroy();
  }

  // Fixed-size procedural particles share one per-frame budget across all effects.
  sparks(ctx, count, radius, color, phase = 0) {
    const permitted = Math.min(count, this.particlesRemaining);
    this.particlesRemaining -= permitted;
    for (let i = 0; i < permitted; i++) {
      const angle = i * 2.39996, r = radius * (0.3 + (i % 7) / 10);
      const drift = this.reducedMotion ? 0 : phase * 6;
      const x = Math.cos(angle) * (r + drift), y = Math.sin(angle) * (r + drift);
      polygon(ctx, [[x, y - 2], [x + 1.5, y], [x, y + 2], [x - 1.5, y]], color);
    }
  }

  takeParticles(count) {
    const permitted = Math.max(0, Math.min(count, this.particlesRemaining));
    this.particlesRemaining -= permitted; return permitted;
  }

  // Ink-splash death: a deterministic dark blot that fades over DEATH_LIFE, plus spatter that flies out for 0.6s.
  drawInk(ctx, death, age) {
    const id = Number(death.enemyId) || 0, r = death.radius;
    const heavy = ['armor', 'siege', 'boss'].includes(death.type);
    ctx.save(); ctx.globalAlpha = 0.55 * (1 - clamp(age / death.life));
    oval(ctx, 0, 3, r * 1.15, r * 0.55, '#141c18');
    for (let i = 0; i < 3; i++) {
      const a = (id * 1.7 + i * 2.1) % TAU;
      oval(ctx, Math.cos(a) * r * 1.2, 3 + Math.sin(a) * r * 0.5, r * 0.32, r * 0.2, '#141c18');
    }
    ctx.restore();
    if (this.reducedMotion || age >= SPATTER_LIFE) return;
    const t = age / SPATTER_LIFE, wanted = (heavy ? 10 : 4) * (this.quality === 'low' ? 0.5 : 1);
    const count = this.takeParticles(Math.round(wanted));
    ctx.save(); ctx.globalAlpha = 0.8 * (1 - t);
    for (let i = 0; i < count; i++) {
      const a = (id * 0.9 + i * 2.39996) % TAU, d = r * (0.6 + easeOutCubic(t) * (1.4 + (i % 3) * 0.5));
      const size = (2.4 - (i % 3) * 0.5) * (1 - t * 0.5);
      oval(ctx, Math.cos(a) * d, 2 + Math.sin(a) * d * 0.6 - Math.sin(t * Math.PI) * 6, size, size, '#1b2520');
    }
    ctx.restore();
  }

  drawDeaths(ctx, now) {
    for (const death of this.deathSnapshots) {
      const age = now - death.started, progress = clamp(age / CORPSE_LIFE);
      this.sprite(ctx, death.x, death.y, () => {
        this.drawInk(ctx, death, age);
        if (progress >= 1) return;
        ctx.globalAlpha = 1 - progress;
        if (!this.reducedMotion) {
          const recoil = Math.sin(clamp(progress / 0.5) * Math.PI / 2) * 8;
          ctx.translate(-Math.cos(death.facing) * recoil, -Math.sin(death.facing) * recoil);
          ctx.rotate(Math.min(1, progress / 0.4) * 1.1);
          ctx.scale(1, 1 - progress * 0.28);
          oval(ctx, 0, 4, death.radius * 1.2, 4, '#26382d55');
          const heavy = ['armor', 'siege', 'boss'].includes(death.type);
          polygon(ctx, [[-death.radius * 0.65, 1], [-death.radius * 0.75, -13], [0, -19], [death.radius * 0.75, -13], [death.radius * 0.65, 1]], heavy ? '#81755b' : '#a38769', '#c8ac78');
          oval(ctx, 0, -22, 4, 5, '#c7a37a');
          if (death.type === 'cavalry') oval(ctx, 0, 0, death.radius * 1.6, 5, '#8a7153');
          if (death.type === 'banner') line(ctx, [[8, 0], [8, -35], [20, -30]], '#d2a474', 2);
        }
        this.sparks(ctx, this.reducedMotion ? 3 : 7, death.radius * 1.2, '#ffe4a8', progress);
      });
    }
  }

  drawDamageLabels(ctx, now) {
    for (const label of this.damageLabels) {
      const progress = clamp((now - label.started) / label.life);
      const amount = Number(label.amount.toFixed(1));
      // Elites that survive a Peerless show their real remaining health, so "why is it still alive" is answered.
      const value = label.survivor ? `${amount} · 余${label.survivor}%` : `${label.executed ? '击破 ' : ''}${amount}${label.hits > 1 ? ` ·${label.hits}击` : ''}`;
      const age = now - label.started;
      this.sprite(ctx, label.x, label.y - 27 - (this.reducedMotion ? 0 : easeOutCubic(progress) * 22), () => {
        ctx.globalAlpha = clamp((1 - progress) / 0.3);
        // Hero hits pop 1.6 → 1 over 120ms (crit-style gold); tower hits pop gently 1.3 → 1. Reduced motion: no pop.
        if (!this.reducedMotion && age < 0.12) {
          const pop = 1 + ((label.prominent ? 1.6 : 1.3) - 1) * (1 - easeOutCubic(age / 0.12));
          ctx.scale(pop, pop);
        }
        ctx.font = `${label.prominent ? 900 : 800} ${Math.max(label.prominent ? 19 : 12, (label.prominent ? 17 : 11) / this.cssIso)}px "Microsoft YaHei", sans-serif`;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.lineWidth = label.prominent ? 4 : 3;
        ctx.strokeStyle = label.prominent ? '#3a2208' : '#1b302c'; ctx.strokeText(value, 0, 0);
        ctx.fillStyle = label.survivor ? '#ffc58a' : label.prominent ? '#ffd257' : '#e7e4cd'; ctx.fillText(value, 0, 0);
      });
    }
  }

  drawBackground(ctx) {
    const map = this.map ?? DEFAULT_MAP;
    const env = ENVIRONMENTS[map.id] ?? ENVIRONMENTS.wei_gate;
    const gradient = ctx.createLinearGradient(0, 0, 0, 600);
    gradient.addColorStop(0, env.dark); gradient.addColorStop(0.45, env.ground); gradient.addColorStop(1, env.dark);
    ctx.fillStyle = gradient; ctx.fillRect(0, 0, 420, 600);
    // Deterministic low contrast paper grain. Map differences come from real geometry.
    let seed = Array.from(map.id ?? '').reduce((s, c) => s * 31 + c.charCodeAt(0), 7) >>> 0;
    const random = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
    for (let i = 0; i < 450; i++) {
      ctx.fillStyle = i % 3 ? '#ead5a420' : '#1e463223';
      ctx.fillRect(random() * 420, random() * 530, 1 + random() * 3, 1);
    }
    if (env.water) {
      ctx.fillStyle = '#4c858c70';
      for (const x of [0, 365]) {
        ctx.fillRect(x, 20, 55, 485);
        for (let y = 30; y < 510; y += 26) line(ctx, [[x + 4, y], [x + 37, y + 2]], '#afd2c83d');
      }
    }
    const safeProp = (x, y) => (map.campSlots ?? CAMP_SLOTS).every(p => Math.hypot(x - p.x, y - p.y) > 45)
      && map.paths.every(path => path.slice(1).every((p, i) => distanceToSegment(x, y, path[i], p) > 42));
    for (let i = 0; i < 38; i++) {
      const x = 12 + random() * 396, y = 50 + random() * 428;
      if (safeProp(x, y)) this.drawEnvironmentProp(ctx, x, y, env.prop, random());
    }
    // All lanes are drawn from exactly the engine map's piecewise linear paths.
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    for (const path of map.paths) {
      for (const [width, color] of [[64, '#263d3438'], [57, '#908d6f'], [51, env.road], [36, '#eadfb02b']]) {
        roadPath(ctx, path); ctx.lineWidth = width; ctx.strokeStyle = color; ctx.stroke();
      }
      ctx.setLineDash([2, 16]); roadPath(ctx, path); ctx.lineWidth = 1; ctx.strokeStyle = '#736d5148'; ctx.stroke(); ctx.setLineDash([]);
      const entry = path[0];
      this.drawStandard(ctx, clamp(entry.x - 24, 8, 412), 17, '#963e37', -1, true);
    }
    if (['dock', 'bridge', 'cliff'].includes(env.prop)) {
      for (const path of map.paths) for (let i = 1; i < path.length; i++) {
        const a = path[i - 1], b = path[i];
        if (a.y < 80 || b.y > 480) continue;
        ctx.save(); ctx.translate((a.x + b.x) / 2, (a.y + b.y) / 2); ctx.rotate(Math.atan2(b.y - a.y, b.x - a.x));
        line(ctx, [[-16, -22], [16, -22]], '#796849', 3);
        line(ctx, [[-16, 22], [16, 22]], '#796849', 3);
        for (let x = -14; x <= 14; x += 7) line(ctx, [[x, -20], [x, 20]], '#786a453f');
        ctx.restore();
      }
    }
    this.drawCastle(ctx);
    // Environment-specific gate fixtures stay behind every live unit.
    if (map.id?.startsWith('wei')) {
      ctx.fillStyle = '#485761'; ctx.fillRect(3, 548, 28, 42); ctx.fillRect(389, 548, 28, 42);
    } else if (map.id?.startsWith('wu')) {
      line(ctx, [[12, 558], [120, 558]], '#b39b6c', 4); line(ctx, [[300, 558], [408, 558]], '#b39b6c', 4);
    }
  }

  drawEnvironmentProp(ctx, x, y, type, variation) {
    ctx.save(); ctx.translate(x, y);
    if (['fence', 'fort', 'water-fort'].includes(type)) {
      for (let i = -1; i <= 1; i++) {
        polygon(ctx, [[i * 8 - 2, 8], [i * 8 - 2, -9], [i * 8, -14], [i * 8 + 2, -9], [i * 8 + 2, 8]], type === 'fence' ? '#625843' : '#53645d');
      }
      line(ctx, [[-11, 0], [11, 0]], '#a49772', 2);
    } else if (['warehouse', 'farm'].includes(type)) {
      ctx.fillStyle = '#a29469'; ctx.fillRect(-12, -9, 24, 17);
      polygon(ctx, [[-17, -9], [0, -22], [17, -9]], type === 'farm' ? '#66714b' : '#796847');
      ctx.fillStyle = '#4c5b3d'; ctx.fillRect(-3, -3, 6, 11);
      if (type === 'farm') for (let i = 0; i < 4; i++) line(ctx, [[-18, 14 + i * 5], [18, 14 + i * 5]], '#c8bc7055');
    } else if (['bamboo', 'reeds'].includes(type)) {
      const height = type === 'bamboo' ? 37 : 19;
      for (let i = -1; i <= 1; i++) {
        line(ctx, [[i * 5, 8], [i * 5 + 1, -height]], '#416a49', 2);
        for (let j = 0; j < 3; j++) line(ctx, [[i * 5, -j * 10], [i * 5 + (j % 2 ? -8 : 8), -j * 10 - 6]], '#6d8d55', 2);
      }
    } else if (type === 'dock' || type === 'bridge') {
      ctx.fillStyle = '#6e6751'; ctx.fillRect(-17, -12, 34, 22);
      for (let i = -12; i < 17; i += 7) line(ctx, [[i, -11], [i, 9]], '#b09b70', 2);
    } else if (type === 'charred') {
      line(ctx, [[0, 10], [0, -21], [8, -27]], '#4f4b3e', 4);
      line(ctx, [[0, -9], [-10, -17]], '#615443', 3);
      oval(ctx, 1, 9, 14, 5, '#634e3845');
    } else {
      this.drawRock(ctx, 0, 0, 10 + variation * 14, 8 + variation * 5);
      if (type === 'snow') polygon(ctx, [[-11, -5], [0, -12], [10, -4], [1, -1]], '#d4ded0');
    }
    ctx.restore();
  }

  sprite(ctx, x, y, callback) {
    ctx.save(); ctx.translate(x, y); ctx.scale(this.spriteScaleX, this.spriteScaleY); callback(); ctx.restore();
  }

  /**
   * Subtle environment motion (wind dust, water glints, snow, embers). Decorative only: the first layer dropped
   * under the low-quality budget and frozen with reduced motion, so it never competes with threat cues.
   */
  drawAmbient(ctx, time) {
    if (this.reducedMotion || this.quality === 'low') return;
    const env = ENVIRONMENTS[this.map?.id] ?? ENVIRONMENTS.wei_gate;
    const kind = env.prop === 'snow' ? 'snow' : ['charred'].includes(env.prop) ? 'ember' : env.water ? 'glint' : 'dust';
    ctx.save();
    for (let i = 0; i < 14; i++) {
      const seed = i * 97.31, speed = kind === 'snow' ? 18 : kind === 'ember' ? -14 : 9;
      const x = (seed * 7.7 + time * (kind === 'dust' ? 16 : 5) + Math.sin(time * 0.7 + i) * 8) % 420;
      const y = kind === 'glint' ? 40 + (i * 37) % 460 : ((seed * 3.1 + time * speed) % 520 + 520) % 520;
      if (kind === 'glint') { if (x > 55 && x < 365) continue; ctx.globalAlpha = 0.25 + 0.25 * Math.sin(time * 2 + i); line(ctx, [[x, y], [x + 7, y]], '#e3f4ec', 1); }
      else if (kind === 'snow') { ctx.globalAlpha = 0.55; oval(ctx, x, y, 1.6, 1.6, '#f3f6ee'); }
      else if (kind === 'ember') { ctx.globalAlpha = 0.5 + 0.3 * Math.sin(time * 4 + i); oval(ctx, x, y, 1.4, 1.4, '#ffb36b'); }
      else { ctx.globalAlpha = 0.18; oval(ctx, x, y, 2.4, 1, '#efe2bb'); }
    }
    ctx.restore();
  }

  draw(game, { selectedSlot = -1, guideSlot = -1, realDt = 1 / 60 } = {}) {
    if (!game || !this.ctx || this.destroyed) return;
    const now = nowSeconds();
    this.pruneFeedback(now); this.particlesRemaining = this.quality === 'low' ? PARTICLE_LIMIT / 2 : PARTICLE_LIMIT;
    if (game.map && game.map !== this.map) this.setMap(game.map);
    this.resize();
    this.visualTime += clamp(Number(realDt) || 0, 0, 0.1);
    const rect = this.canvas.getBoundingClientRect();
    const sx = this.width / 420, sy = this.height / 600, iso = Math.min(sx, sy);
    this.cssIso = Math.max(0.1, Math.min(rect.width / 420, rect.height / 600));
    this.spriteScaleX = iso / sx; this.spriteScaleY = iso / sy;
    const ctx = this.ctx, time = this.reducedMotion ? 0 : this.visualTime;
    this.observe(game, now);
    ctx.setTransform(sx, 0, 0, sy, 0, 0);
    // Edges exposed by shake/zoom read as dark ink rather than stale pixels.
    ctx.globalAlpha = 1; ctx.fillStyle = '#0d1b16'; ctx.fillRect(0, 0, 420, 600);
    this.applyCamera(ctx, now);
    ctx.drawImage(this.background, 0, 0, 420, 600);
    this.drawGate(ctx, game, now, time);
    this.drawDeaths(ctx, now);
    this.drawSpawnDust(ctx, now);
    const slots = this.map.campSlots ?? CAMP_SLOTS, camps = game.camps ?? [];
    const selected = slots.find((slot, index) => (slot.slot ?? index) === selectedSlot);
    if (selected) {
      const camp = camps.find(c => c.slot === selectedSlot);
      ctx.save(); ctx.setLineDash([5, 5]); ctx.strokeStyle = '#e9d7a38c'; ctx.fillStyle = '#9ddb9415';
      ctx.beginPath(); ctx.arc(selected.x, selected.y, camp?.range ?? 44, 0, TAU); ctx.fill(); ctx.stroke(); ctx.restore();
    }
    this.drawCampGround(ctx, camps, slots, now);
    for (const hero of game.heroes ?? []) {
      if ((hero.role === 'lead' || hero === game.heroes[0]) && hero.rage >= 100 && hero.target) this.drawSkillShape(ctx, { ...hero.target, heroId: hero.heroId ?? hero.id }, { preview: true, game });
    }
    for (const effect of game.effects ?? []) if (['field', 'mine', 'telegraph', 'oil'].includes(effect.type)) this.drawSkillShape(ctx, effect, { ground: true, game });
    slots.forEach((slot, index) => {
      if (!camps.some(c => c.slot === (slot.slot ?? index))) this.sprite(ctx, slot.x, slot.y, () => this.drawEmptyCamp(ctx, { x: 0, y: 0 }, (slot.slot ?? index) === selectedSlot, time));
    });
    // Tutorial pointer at a real, tappable slot (never a decorative location).
    const guide = slots.find((slot, index) => (slot.slot ?? index) === guideSlot);
    if (guide && selectedSlot < 0) this.sprite(ctx, guide.x, guide.y, () => {
      const pulse = this.reducedMotion ? 0.5 : (Math.sin(this.visualTime * 5) + 1) / 2;
      ctx.strokeStyle = '#ffe08f'; ctx.lineWidth = 3; ctx.beginPath(); ctx.ellipse(0, 2, 30 + pulse * 6, 22 + pulse * 4, 0, 0, TAU); ctx.stroke();
      ctx.strokeStyle = '#ffe08f66'; ctx.lineWidth = 7; ctx.beginPath(); ctx.ellipse(0, 2, 36 + pulse * 6, 27 + pulse * 4, 0, 0, TAU); ctx.stroke();
      const bob = this.reducedMotion ? 0 : pulse * 6;
      polygon(ctx, [[-11, -50 - bob], [11, -50 - bob], [0, -34 - bob]], '#ffe08f', '#5a3c17');
      text(ctx, '点这里', 0, -62 - bob, Math.max(12, 12 / this.cssIso), '#ffe9b0');
    });
    this.drawAmbient(ctx, time);
    const units = [
      ...camps.map(c => { const slot = slots.find((s, i) => (s.slot ?? i) === c.slot); return { ...c, kind: 'camp', x: c.x ?? slot?.x, y: c.y ?? slot?.y }; }),
      ...(game.enemies ?? []).filter(e => e.hp > 0 && !e.escaped).map(e => ({ ...e, kind: 'enemy' })),
      ...(game.heroes ?? []).map((h, index) => ({ ...h, kind: 'hero', x: h.x ?? [210, 140, 280][index], y: h.y ?? 550 })),
    ].sort((a, b) => a.y - b.y);
    for (const unit of units) {
      if (!Number.isFinite(unit.x) || !Number.isFinite(unit.y)) continue;
      this.sprite(ctx, unit.x, unit.y, () => {
        if (unit.kind === 'camp') { this.applyCampAnim(ctx, unit.slot, now); this.drawV1Camp(ctx, unit, selectedSlot === unit.slot, time); }
        else if (unit.kind === 'hero') this.drawV1Hero(ctx, unit, time);
        else {
          this.applySpawnAnim(ctx, unit.id, now);
          this.drawV1Enemy(ctx, unit, time);
          this.drawHitFlash(ctx, unit, now);
          if (this.lastEnemy && this.lastEnemy.enemyId === unit.id) this.drawLastEnemyMark(ctx, now);
        }
      });
    }
    this.drawCampBursts(ctx, camps, slots, now);
    for (const projectile of game.projectiles ?? []) this.sprite(ctx, projectile.x, projectile.y, () => {
      if (projectile.type === 'fire_oil') {
        oval(ctx, 0, 0, 4, 5, '#ae7649'); line(ctx, [[-2, -6], [1, -6]], '#dfbd74', 2);
      } else this.drawProjectile(ctx, { ...projectile, type: projectile.type === 'catapult' ? 'stone' : projectile.type,
        x: 0, y: 0, targetX: (projectile.targetX ?? projectile.x) - projectile.x, targetY: (projectile.targetY ?? projectile.y) - projectile.y });
    });
    for (const effect of game.effects ?? []) {
      if (effect.type === 'ultimate' && (game.effects ?? []).some(other => other.type === 'field' && other.heroId === effect.heroId)) continue;
      if (['ultimate', 'field', 'mine', 'telegraph', 'oil'].includes(effect.type)) this.drawSkillShape(ctx, effect, { game });
      else super.drawEffect(ctx, { ...effect, maxLife: effect.life, life: Math.max(0, effect.life - (effect.age ?? 0)) });
    }
    this.drawDamageLabels(ctx, now);
    this.drawGateLabels(ctx, now);
    if ((game.hp ?? game.gateHp) < (game.maxHp ?? game.maxGateHp ?? 100) * 0.3) this.drawDanger(ctx, time);
    // World positions scale independently; text and actors use an isotropic transform.
    // The DOM #field-hint owns the map name; `mapLabel = true` restores the canvas label for standalone pages.
    if (this.mapLabel) this.sprite(ctx, 210, 20, () => text(ctx, this.map.name ?? '演武沙盘', 0, 0, Math.max(11, 11 / this.cssIso), '#ead5a0'));
    ctx.setTransform(sx, 0, 0, sy, 0, 0);
    this.drawEdgeFlash(ctx, now);
    if (this.flash) {
      const age = nowSeconds() - this.flash.started;
      if (age > 1.6) this.flash = null;
      else if (this.flash.resultAt == null && this.releaseLabel !== false) this.sprite(ctx, 210, 55, () => {
        ctx.globalAlpha = clamp((1.6 - age) / 0.3);
        const art = HERO_ART[this.flash.heroId];
        // The DOM result popup owns final kill counts; this label is release-only.
        text(ctx, `${art?.name ?? '无双'} · ${this.flash.name ?? art?.skill ?? '无双发动'}`, 0, 0, Math.max(12, 12 / this.cssIso), '#d6ffdf');
      });
    }
  }

  // Camera: decaying shake (max of active sources) and a short zoom punch around the field centre.
  applyCamera(ctx, now) {
    if (this.reducedMotion) return;
    let strength = 0, source = null;
    for (const s of this.shakes) {
      const age = now - s.started;
      if (age >= 0 && age < s.duration) { const v = s.strength * (1 - age / s.duration) ** 1.6; if (v > strength) { strength = v; source = s; } }
    }
    const punchAge = now - this.punchStarted;
    if (punchAge >= 0 && punchAge < PUNCH.duration) {
      const k = punchAge < 0.06 ? punchAge / 0.06 : 1 - (punchAge - 0.06) / (PUNCH.duration - 0.06);
      const zoom = 1 + (PUNCH.scale - 1) * clamp(k);
      ctx.translate(210, 300); ctx.scale(zoom, zoom); ctx.translate(-210, -300);
    }
    if (strength > 0.05) {
      const age = now - source.started;
      ctx.translate(Math.sin(age * 118) * strength, Math.cos(age * 91) * strength * 0.7);
    }
  }

  // Brief jade/cinnabar chromatic rim on Peerless release; screen-space, edge only (no full-screen white).
  drawEdgeFlash(ctx, now) {
    const age = now - this.edgeFlashStarted;
    if (this.reducedMotion || !(age >= 0 && age < EDGE_FLASH)) return;
    const a = 1 - age / EDGE_FLASH;
    ctx.save();
    const glow = ctx.createRadialGradient(210, 300, 170, 210, 300, 390);
    glow.addColorStop(0, 'rgba(255, 231, 166, 0)'); glow.addColorStop(1, `rgba(255, 231, 166, ${0.42 * a})`);
    ctx.fillStyle = glow; ctx.fillRect(0, 0, 420, 600);
    for (const [color, offset] of [['#7ff0c4', -3 * a], ['#e2493b', 3 * a]]) {
      ctx.globalAlpha = 0.3 * a; ctx.fillStyle = color;
      ctx.fillRect(offset, 0, 12, 600); ctx.fillRect(408 + offset, 0, 12, 600);
      ctx.fillRect(0, offset, 420, 8); ctx.fillRect(0, 592 + offset, 420, 8);
    }
    ctx.restore();
  }

  // Gate damage states follow real HP: cracks at ≤70%, split door and chipped merlons at ≤40%, breach at ≤15%.
  drawGate(ctx, game, now, time) {
    const max = game.maxHp ?? game.maxGateHp ?? 100, hp = game.hp ?? game.gateHp ?? max;
    const stage = gateStage(clamp(hp / max));
    ctx.save();
    if (stage >= 1) {
      line(ctx, [[176, 556], [183, 548], [181, 538], [188, 530]], '#1d2a24', 1.4);
      line(ctx, [[244, 560], [238, 551], [242, 543]], '#1d2a24', 1.2);
      line(ctx, [[96, 552], [104, 562], [99, 572]], '#2a3a33', 1);
    }
    if (stage >= 2) {
      line(ctx, [[201, 513], [206, 522], [202, 532], [209, 540]], '#1d2a24', 1.6);
      line(ctx, [[188, 566], [196, 578], [192, 592]], '#1f1912', 1.8);
      line(ctx, [[318, 548], [326, 557], [321, 569], [330, 578]], '#2a3a33', 1.2);
      polygon(ctx, [[150, 524], [158, 524], [154, 531]], '#2c3e36'); polygon(ctx, [[275, 524], [284, 524], [281, 532]], '#2c3e36');
    }
    if (stage >= 3) {
      polygon(ctx, [[214, 563], [227, 563], [223, 586], [211, 581]], '#16110c');
      line(ctx, [[170, 552], [160, 566], [166, 580], [158, 596]], '#1a2620', 2);
      line(ctx, [[250, 552], [262, 568], [256, 584]], '#1a2620', 2);
      oval(ctx, 196, 597, 12, 3, '#6d6a5a'); oval(ctx, 233, 596, 9, 3, '#6d6a5a');
      if (!this.reducedMotion && this.quality !== 'low') for (let i = 0; i < 3; i++) {
        const rise = (time * 0.5 + i / 3) % 1;
        ctx.globalAlpha = 0.35 * (1 - rise);
        oval(ctx, 196 + i * 14 + Math.sin(time + i) * 4, 540 - rise * 40, 6 + rise * 8, 4 + rise * 5, '#3b3a35');
      }
      ctx.globalAlpha = 1;
    }
    const age = now - this.gateFx.flashStarted;
    if (age >= 0 && age < GATE_FLASH) {
      const k = 1 - age / GATE_FLASH, white = !this.reducedMotion && age < HIT_FLASH;
      ctx.globalAlpha = this.reducedMotion ? 0.3 * k : white ? 0.7 : 0.5 * k;
      ctx.fillStyle = white ? '#fff4dc' : '#e2493b';
      ctx.beginPath(); ctx.moveTo(170, 600); ctx.lineTo(170, 552); ctx.arc(210, 552, 40, Math.PI, 0); ctx.lineTo(250, 600); ctx.closePath(); ctx.fill();
      ctx.globalAlpha *= 0.5; ctx.fillRect(0, 536, 420, 7);
    }
    ctx.restore();
  }

  drawGateLabels(ctx, now) {
    this.gateFx.labels.forEach((label, index) => {
      const age = now - label.started, p = clamp(age / GATE_LABEL_LIFE);
      const y = this.reducedMotion ? 500 - index * 16 : 500 - easeOutCubic(p) * 26;
      this.sprite(ctx, label.x, y, () => {
        ctx.globalAlpha = clamp((1 - p) / 0.35);
        if (!this.reducedMotion && age < 0.12) { const pop = 1 + 0.5 * (1 - age / 0.12); ctx.scale(pop, pop); }
        ctx.font = `900 ${Math.max(16, 15 / this.cssIso)}px "Microsoft YaHei", sans-serif`;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.lineWidth = 4;
        const value = `-${label.amount}`;
        ctx.strokeStyle = '#2a0d09'; ctx.strokeText(value, 0, 0); ctx.fillStyle = '#ff6a55'; ctx.fillText(value, 0, 0);
      });
    });
  }

  // Enemies fade and rise in at their entry point instead of popping.
  applySpawnAnim(ctx, id, now) {
    const anim = this.spawnAnims.get(id); if (!anim) return;
    const p = easeOutCubic(clamp((now - anim.started) / SPAWN_ANIM));
    ctx.globalAlpha = 0.15 + 0.85 * p;
    if (!this.reducedMotion) ctx.translate(0, (1 - p) * 8);
  }

  drawSpawnDust(ctx, now) {
    if (this.reducedMotion) return;
    for (const anim of this.spawnAnims.values()) {
      const p = clamp((now - anim.started) / SPAWN_ANIM); if (p >= 1) continue;
      const count = this.takeParticles(this.quality === 'low' ? 2 : 3); if (!count) break;
      this.sprite(ctx, anim.x, anim.y, () => {
        ctx.globalAlpha = 0.45 * (1 - p);
        for (let i = 0; i < count; i++) oval(ctx, (i - (count - 1) / 2) * (6 + p * 10), 4 - p * 3, 4 + p * 6, 2 + p * 2, '#e3d6ad');
      });
    }
  }

  // 80ms white silhouette on every real hit (engine hitFlash or a forwarded damage event).
  drawHitFlash(ctx, enemy, now) {
    const started = this.hitFlashes.get(enemy.id), age = started == null ? Infinity : now - started;
    const k = Math.max(age < HIT_FLASH ? 1 - age / HIT_FLASH : 0, clamp((Number(enemy.hitFlash) || 0) / 0.1) * 0.8);
    if (!(k > 0)) return;
    const boss = enemy.type === 'boss' || enemy.class === 'boss', s = boss ? 1.5 : enemy.type === 'armor' ? 1.13 : 1;
    ctx.save(); ctx.globalAlpha = 0.7 * k; ctx.fillStyle = '#ffffff';
    if (enemy.type === 'siege') ctx.fillRect(-17, -29, 34, 34);
    else {
      ctx.beginPath(); ctx.ellipse(0, -6 * s, 6.5 * s, 8 * s, 0, 0, TAU); ctx.fill();
      oval(ctx, 0, -15 * s, 4.5 * s, 4.5 * s, '#ffffff');
      if (enemy.type === 'cavalry') oval(ctx, 0, 0, 10, 5, '#ffffff');
    }
    ctx.restore();
  }

  drawLastEnemyMark(ctx, now) {
    const pulse = this.reducedMotion ? 0.5 : (Math.sin((now - this.lastEnemy.started) * 6) + 1) / 2;
    ctx.save(); ctx.strokeStyle = '#ffe7a6'; ctx.lineWidth = 1.5; ctx.setLineDash([4, 3]);
    ctx.beginPath(); ctx.ellipse(0, 5, 20 + pulse * 4, 8 + pulse * 1.5, 0, 0, TAU); ctx.stroke(); ctx.setLineDash([]);
    polygon(ctx, [[-5, -48 - pulse * 3], [5, -48 - pulse * 3], [0, -40 - pulse * 3]], '#ffe7a6', '#5a3c17');
    ctx.restore();
  }

  // Build-in: drop from above, squash on landing, spring back (0.32s). Reduced motion: plain fade-in.
  applyCampAnim(ctx, slot, now) {
    const anim = this.campAnims.get(slot); if (!anim || anim.kind !== 'build') return;
    const p = clamp((now - anim.started) / BUILD_ANIM); if (p >= 1) return;
    if (this.reducedMotion) { ctx.globalAlpha = 0.2 + 0.8 * p; return; }
    const fall = clamp(p / 0.55), settle = clamp((p - 0.55) / 0.45), spring = easeOutBack(settle);
    const scaleX = fall < 1 ? 0.92 : 1.12 - 0.12 * spring, scaleY = fall < 1 ? 1.08 : 0.86 + 0.14 * spring;
    ctx.translate(0, -60 * (1 - fall * fall)); ctx.scale(scaleX, scaleY);
  }

  campPosition(camps, slots, slot) {
    const camp = camps.find(c => c.slot === slot); if (!camp) return null;
    const pos = slots.find((s, i) => (s.slot ?? i) === slot), x = camp.x ?? pos?.x, y = camp.y ?? pos?.y;
    return Number.isFinite(x) && Number.isFinite(y) ? { camp, x, y } : null;
  }

  // Under units: 1s range ring after placing/upgrading, and the landing dust ring.
  drawCampGround(ctx, camps, slots, now) {
    for (const [slot, anim] of this.campAnims) {
      const found = this.campPosition(camps, slots, slot); if (!found) continue;
      const { camp, x, y } = found, age = now - anim.started, range = camp.range > 0 ? camp.range : 44;
      if (age >= 0 && age < RANGE_RING) {
        ctx.save(); ctx.globalAlpha = 0.6 * clamp((RANGE_RING - age) / 0.3);
        ctx.setLineDash([5, 5]); ctx.strokeStyle = '#e9d7a3'; ctx.fillStyle = '#9ddb9412'; ctx.lineWidth = 1.5;
        const grow = this.reducedMotion ? 1 : 0.85 + 0.15 * easeOutCubic(clamp(age / 0.25));
        ctx.beginPath(); ctx.arc(x, y, range * grow, 0, TAU); ctx.fill(); ctx.stroke(); ctx.restore();
      }
      if (anim.kind !== 'build' || this.reducedMotion) continue;
      const t = (age - BUILD_ANIM * 0.55) / 0.4;
      if (t >= 0 && t < 1) this.sprite(ctx, x, y, () => {
        ctx.globalAlpha = 0.55 * (1 - t); ctx.strokeStyle = '#e8dcb4'; ctx.lineWidth = 3 * (1 - t) + 0.5;
        ctx.beginPath(); ctx.ellipse(0, 8, 20 + t * 26, 8 + t * 10, 0, 0, TAU); ctx.stroke();
        const count = this.takeParticles(this.quality === 'low' ? 3 : 6);
        for (let i = 0; i < count; i++) {
          const a = i / count * TAU;
          oval(ctx, Math.cos(a) * (22 + t * 24), 8 + Math.sin(a) * (9 + t * 9) - t * 4, 3 * (1 - t) + 1, 2 * (1 - t) + 0.6, '#d9caa0');
        }
      });
    }
  }

  // Above units: upgrade ring burst and rising level chevrons.
  drawCampBursts(ctx, camps, slots, now) {
    for (const [slot, anim] of this.campAnims) {
      if (anim.kind !== 'upgrade') continue;
      const found = this.campPosition(camps, slots, slot); if (!found) continue;
      const t = (now - anim.started) / UPGRADE_ANIM; if (t < 0 || t >= 1.6) continue;
      this.sprite(ctx, found.x, found.y, () => {
        if (t < 1) {
          const r = this.reducedMotion ? 30 : 18 + easeOutCubic(t) * 26;
          ctx.globalAlpha = (this.reducedMotion ? 0.5 : 0.9) * (1 - t);
          ctx.strokeStyle = '#ffe7a6'; ctx.lineWidth = this.reducedMotion ? 2 : 4 * (1 - t) + 1;
          ctx.beginPath(); ctx.ellipse(0, 2, r, r * 0.74, 0, 0, TAU); ctx.stroke();
          if (!this.reducedMotion) { ctx.save(); ctx.translate(0, -6); this.sparks(ctx, 8, r * 0.8, '#ffe7a6', t); ctx.restore(); }
        }
        ctx.globalAlpha = clamp((1.6 - t) / 0.5);
        for (let i = 0; i < anim.level; i++) {
          const rise = this.reducedMotion ? 0 : easeOutCubic(clamp(t / 1.2 - i * 0.12)) * 18, y = -44 - i * 6 - rise;
          line(ctx, [[-7, y], [0, y - 6], [7, y]], '#ffd257', 2.5);
        }
      });
    }
  }

  // Five boss archetypes (balance bossTemplates) get their own headgear and weapon over the shared boss body.
  drawBossGear(ctx, template) {
    if (template === 'rammer') {
      polygon(ctx, [[-5, -17], [-11, -26], [-6, -18]], '#d8cfae'); polygon(ctx, [[5, -17], [11, -26], [6, -18]], '#d8cfae');
      line(ctx, [[9, 4], [9, -18]], '#6b5236', 2.2);
      ctx.fillStyle = '#5d5f58'; ctx.fillRect(5, -25, 9, 8); line(ctx, [[5, -21], [14, -21]], '#c9b37a', 1);
    } else if (template === 'charger') {
      line(ctx, [[-2, -19], [-8, -30], [-16, -36]], '#e8c46c', 1.2); line(ctx, [[2, -19], [6, -31], [2, -40]], '#e8c46c', 1.2);
      line(ctx, [[10, 5], [10, -30]], '#b89a64', 1.4); polygon(ctx, [[10, -37], [8, -30], [12, -30]], '#e6eee0');
      oval(ctx, 10, -28, 2.2, 1.6, '#c8402f');
    } else if (template === 'banner_lord') {
      ctx.fillStyle = '#3b2f2a'; ctx.fillRect(-4, -27, 8, 8); line(ctx, [[-5, -27], [5, -27]], '#d6b062', 1.2);
      for (const x of [-7, -3]) { line(ctx, [[x, -6], [x, -33]], '#cdb27a', 1); polygon(ctx, [[x, -33], [x - 6, -31], [x - 6, -26], [x, -27]], '#b8382d'); }
      line(ctx, [[8, 0], [12, -12]], '#d8b56a', 1.6);
    } else if (template === 'guardian') {
      polygon(ctx, [[-9, -17], [9, -17], [5, -21], [-5, -21]], '#585e57', '#c2b393');
      ctx.fillStyle = '#6d7464'; ctx.fillRect(-13, -14, 7, 17);
      ctx.strokeStyle = '#d6c79c'; ctx.lineWidth = 0.8; ctx.strokeRect(-13, -14, 7, 17); oval(ctx, -9.5, -5.5, 1.5, 1.5, '#d6c79c');
      line(ctx, [[8, 2], [8, -12]], '#c9e4d1', 1.6);
    } else if (template === 'siege_lord') {
      polygon(ctx, [[-1.5, -19], [0, -34], [2, -19]], '#c8402f'); line(ctx, [[-4, -18], [4, -18]], '#d5b367', 1.2);
      line(ctx, [[10, 5], [10, -26]], '#6b5236', 1.8); polygon(ctx, [[10, -25], [18, -29], [19, -17], [10, -20]], '#c8c3a6', '#8e866a');
    }
  }

  drawV1Camp(ctx, camp, selected, time) {
    oval(ctx, 0, 11, 28, 12, '#15382e50');
    oval(ctx, 0, 2, 27, 20, selected ? '#3f674f' : '#557059');
    ctx.strokeStyle = selected ? '#efd698' : '#c0c8a1'; ctx.lineWidth = selected ? 2.5 : 1.3;
    ctx.beginPath(); ctx.ellipse(0, 2, 27, 20, 0, 0, TAU); ctx.stroke();
    this.drawStandard(ctx, -21, -14, '#276b57', -1, true);
    const level = clamp(camp.level ?? 1, 1, 3);
    const count = level + 1;
    if (camp.type === 'shield' || camp.type === 'archer') {
      for (let i = 0; i < count; i++) this.drawDefender(ctx, (i % 2 ? 1 : -1) * 8, -7 + Math.floor(i / 2) * 13, camp.type, time, i);
      if (level === 3 && camp.type === 'shield') {
        line(ctx, [[-18, 7], [18, 7]], '#d0b181', 3);
        for (const x of [-13, 0, 13]) line(ctx, [[x - 4, 2], [x + 4, 12]], '#bcaa7a', 2);
      }
    } else if (camp.type === 'crossbow') {
      for (let i = 0; i < level; i++) {
        const y = -8 + i * 9;
        line(ctx, [[0, y + 8], [0, y - 13]], '#c8b582', 3);
        line(ctx, [[-15, y + 1], [-12, y - 5], [12, y - 5], [15, y + 1]], '#b2c1a8', 2);
        line(ctx, [[-15, y + 1], [0, y + 8], [15, y + 1]], '#ebe3bb', 0.8);
      }
      ctx.fillStyle = '#514a36'; ctx.fillRect(-7, 7, 14, 6);
    } else if (camp.type === 'catapult') {
      line(ctx, [[-13, 10], [0, -15], [13, 10]], '#5b5038', 4);
      line(ctx, [[0, 2], [11, -27 - level * 2]], '#c9b781', 4);
      oval(ctx, 11, -27 - level * 2, 7 + level, 4, '#728069');
      for (const x of [-11, 11]) oval(ctx, x, 10, 5, 5, '#343f33');
      for (let i = 0; i < level; i++) oval(ctx, -16 + i * 5, -5, 3, 3, '#c4c2a3');
    } else if (camp.type === 'fire_oil') {
      for (let i = 0; i < count; i++) {
        const x = (i % 2 ? 1 : -1) * 8, y = Math.floor(i / 2) * 11 - 8;
        oval(ctx, x, y, 6, 8, '#766441'); oval(ctx, x, y - 7, 3, 2, '#383d31');
      }
      ctx.fillStyle = '#5d503a'; ctx.fillRect(-7, 4, 14, 5);
      polygon(ctx, [[-6, 4], [-2, -5], [0, -1], [3, -10], [6, 4]], '#d89853');
    } else if (camp.type === 'war_drum') {
      line(ctx, [[-12, 12], [-9, -17], [9, -17], [12, 12]], '#674f38', 3);
      ctx.fillStyle = '#ac6450'; ctx.fillRect(-12, -15, 24, 17);
      oval(ctx, 0, -15, 12, 6, '#ddc58b'); oval(ctx, 0, 1, 12, 5, '#a45f43');
      for (let i = 1; i < level; i++) this.drawStandard(ctx, 13 + i * 3, -15, '#7b8960', 1, true);
    }
    if (camp.attackFlash > 0) {
      ctx.strokeStyle = '#b7e1ae'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(0, 0, 23, Math.PI, TAU); ctx.stroke();
    }
    text(ctx, `${CAMP_NAMES[camp.type] ?? '军营'} ${'ⅠⅡⅢ'[level - 1]}`, 0, 31, Math.max(10.5, 11 / this.cssIso), selected ? '#ffe3a1' : '#ecdeb7');
  }

  drawV1Hero(ctx, hero, time) {
    const id = hero.heroId ?? hero.id, art = HERO_ART[id] ?? HERO_ART.guan_yu;
    const ready = hero.rage >= 100, support = hero.role === 'support';
    // Animation states read from real engine fields: casting 0.9 s → windup (first 0.25 s), cast, then recovery.
    const castT = hero.casting ? clamp(1 - (hero.castingRemaining ?? 0) / 0.9) : -1;
    const phase = castT < 0 ? (hero.rageRecovery > 0 ? 'recovery' : ready ? 'ready' : 'idle') : castT < 0.28 ? 'windup' : 'cast';
    const aura = { wei: '#8fb5e0', shu: '#9ff2bd', wu: '#ffb08a' }[art.faction] ?? '#d8dfa6';
    ctx.save(); ctx.scale(support ? 0.9 : 1, support ? 0.9 : 1);
    oval(ctx, 0, 6, 16, 6, '#142b2760');
    if (phase === 'windup' || phase === 'cast') {
      const grow = phase === 'windup' ? castT / 0.28 : 1 - (castT - 0.28) / 0.72;
      ctx.save(); ctx.globalAlpha = 0.25 + grow * 0.45; oval(ctx, 0, 4, 22 + grow * 12, 9 + grow * 4, aura + '66');
      ctx.strokeStyle = aura; ctx.lineWidth = 2.5; ctx.beginPath(); ctx.ellipse(0, 4, 24 + grow * 12, 10 + grow * 4, 0, 0, TAU); ctx.stroke(); ctx.restore();
    }
    ctx.strokeStyle = ready ? '#ccf6c6' : phase === 'recovery' ? '#5d8b78' : '#77c5a1'; ctx.lineWidth = ready ? 2.3 : 1;
    ctx.beginPath(); ctx.ellipse(0, 4, 20, 9, 0, 0, TAU); ctx.stroke();
    // Rage arc on the ground ring: the gauge lives on the hero as well as the button.
    if (!ready && phase !== 'recovery' && hero.rage > 0) {
      ctx.strokeStyle = '#e8cf8a'; ctx.lineWidth = 2; ctx.beginPath(); ctx.ellipse(0, 4, 20, 9, 0, Math.PI / 2, Math.PI / 2 + TAU * clamp(hero.rage / 100)); ctx.stroke();
    }
    // Jade ownership chevrons remain common even for red/purple-clad allies.
    polygon(ctx, [[-3, 9], [0, 13], [3, 9]], '#82c9a9');
    if (!this.reducedMotion) {
      if (phase === 'windup') ctx.translate(0, 2 * (castT / 0.28));
      else if (phase === 'cast') ctx.translate(0, -4 * Math.sin(Math.min(1, (castT - 0.28) / 0.25) * Math.PI / 2) + 2);
      else if (phase === 'ready') ctx.translate(0, Math.sin(time * 5) * 0.8);
      else ctx.translate(0, Math.sin(time * 2.5) * 0.35);
    }
    const wide = ['broad', 'wide-beard', 'sleeves', 'crown'].includes(art.silhouette), half = wide ? 13 : 8;
    if (['cloak', 'silver'].includes(art.silhouette)) polygon(ctx, [[-9, -17], [10, -17], [18, 9], [-16, 9]], art.silhouette === 'silver' ? '#d8e5de' : '#263b43');
    polygon(ctx, [[-half, -15], [half, -15], [half + 4, 6], [-half - 3, 6]], art.accent, '#17382e');
    line(ctx, [[-half + 1, -10], [half - 1, -10]], '#bbae77', 2);
    line(ctx, [[-half, 0], [half + 1, 0]], '#dbc58a', 2);
    if (art.silhouette === 'shoulders') {
      polygon(ctx, [[-8, -15], [-20, -18], [-14, -4]], '#9fb5b1');
      polygon(ctx, [[8, -15], [20, -18], [14, -4]], '#9fb5b1');
    }
    if (art.silhouette === 'sleeves') {
      polygon(ctx, [[-12, -14], [-23, -3], [-12, 3]], '#acc1a6'); polygon(ctx, [[12, -14], [23, -3], [12, 3]], '#acc1a6');
    }
    if (art.silhouette === 'ribbon') {
      line(ctx, [[-8, -10], [-18, 1], [-22, 0]], '#d7cb9d', 2);
      line(ctx, [[8, -10], [18, 1], [22, 0]], '#d7cb9d', 2);
    }
    oval(ctx, 0, -23, 6, 7, id === 'guan_yu' ? '#ae5740' : '#dab58a');
    if (art.silhouette === 'headband') {
      ctx.fillStyle = '#c9b787'; ctx.fillRect(-7, -27, 14, 3);
      line(ctx, [[-7, -26], [-14, -18]], '#c9b787', 2); ctx.fillStyle = '#20342d'; ctx.fillRect(-5, -24, 5, 2);
    } else if (art.silhouette === 'topknot') {
      ctx.fillStyle = '#25372f'; ctx.fillRect(-4, -33, 8, 7); line(ctx, [[3, -31], [11, -36]], '#d4bb79', 2);
      for (let x = -9; x < 12; x += 5) oval(ctx, x, 0, 1.6, 2, '#e2c071');
    } else if (art.silhouette === 'silver') {
      polygon(ctx, [[-7, -26], [-4, -35], [2, -40], [8, -26]], '#c5dcd8'); line(ctx, [[2, -36], [10, -43]], '#e9e8cf', 3);
    } else {
      polygon(ctx, [[-7, -27], [-4, -33], [5, -33], [7, -27]], art.accent); line(ctx, [[-7, -27], [7, -27]], '#ddc88a');
    }
    if (art.silhouette === 'beard') polygon(ctx, [[-5, -20], [5, -20], [4, -9], [0, -3], [-4, -10]], '#233129');
    if (art.silhouette === 'wide-beard') polygon(ctx, [[-7, -21], [-11, -17], [-5, -9], [0, -10], [8, -12], [11, -18], [6, -21]], '#25352d');
    if (art.silhouette === 'crown') polygon(ctx, [[-5, -20], [5, -20], [3, -11], [-2, -12]], '#5b3d55');
    this.drawHeroGear(ctx, art.gear, Boolean(hero.attackFlash > 0 || hero.casting), phase, castT);
    ctx.restore();
    text(ctx, art.name, 0, 25, Math.max(11, 11 / this.cssIso), ready ? '#fff2bd' : '#f0d99a');
  }

  drawHeroGear(ctx, gear, attacking, phase = 'idle', castT = -1) {
    ctx.save();
    if (!this.reducedMotion) {
      // Windup draws the weapon back, the cast swings it through, recovery lets it hang low.
      if (phase === 'windup') ctx.rotate(0.35 * (castT / 0.28));
      else if (phase === 'cast') ctx.rotate(0.35 - 0.95 * Math.min(1, (castT - 0.28) / 0.22));
      else if (phase === 'recovery') ctx.rotate(0.12);
      else if (attacking) ctx.rotate(-0.12);
    }
    const shaft = '#d4c190', blade = '#c9e4d1';
    if (['crescent', 'spear', 'hook', 'serpent', 'axe'].includes(gear)) {
      line(ctx, [[15, 10], [15, -44]], shaft, 2.6);
      if (gear === 'crescent') polygon(ctx, [[15, -45], [28, -47], [33, -41], [30, -28], [25, -36], [15, -36]], blade, '#e9ffe0');
      if (gear === 'spear') polygon(ctx, [[15, -49], [11, -38], [15, -40], [19, -38]], '#e6eee0');
      if (gear === 'hook') line(ctx, [[15, -44], [26, -40], [25, -33], [19, -35]], blade, 3);
      if (gear === 'serpent') line(ctx, [[15, -44], [12, -48], [18, -53], [15, -57]], blade, 2);
      if (gear === 'axe') polygon(ctx, [[15, -40], [4, -35], [4, -23], [15, -28], [26, -22], [28, -34]], '#d4d1ac', '#e8d599');
    } else if (['fan', 'curved-fan', 'fire-fan'].includes(gear)) {
      line(ctx, [[11, 1], [16, -14]], shaft, 2);
      polygon(ctx, [[16, -12], [6, -23], [10, -32], [16, -27], [23, -33], [28, -24]], gear === 'fire-fan' ? '#e0b17b' : '#d3e8cc', '#b6c7ac');
      for (const x of [10, 17, 24]) line(ctx, [[16, -13], [x, -27]], '#61765c', 0.8);
      if (gear === 'curved-fan') line(ctx, [[11, 1], [6, -5], [16, -14]], '#baa4c0', 2);
    } else if (gear === 'bow') {
      ctx.strokeStyle = '#d9c296'; ctx.lineWidth = 2.5; ctx.beginPath(); ctx.arc(10, -15, 17, -Math.PI / 2, Math.PI / 2); ctx.stroke();
      line(ctx, [[10, -32], [10, 2]], '#f0deb5', 1); line(ctx, [[4, -14], [30, -14]], blade);
      line(ctx, [[-10, -29], [-6, -8]], '#cdbe86', 3);
    } else if (gear === 'seal') {
      line(ctx, [[-13, 5], [-13, -27]], blade, 2); line(ctx, [[-18, -8], [-8, -8]], shaft, 2);
      ctx.fillStyle = '#d7b877'; ctx.fillRect(10, -12, 10, 14); ctx.fillStyle = '#805b74'; ctx.fillRect(13, -9, 4, 6);
    } else if (gear === 'halberds') {
      for (const x of [-18, 17]) { line(ctx, [[x, 9], [x, -27]], shaft, 2); polygon(ctx, [[x, -33], [x - 6, -21], [x, -25], [x + 5, -20]], blade); }
    } else if (gear === 'knives') {
      line(ctx, [[-12, 1], [-21, -14]], blade, 3); line(ctx, [[12, 1], [21, -14]], blade, 3);
    } else if (gear === 'swords') {
      for (const x of [-15, 15]) { line(ctx, [[x, 7], [x, -30]], blade, 2); line(ctx, [[x - 5, -6], [x + 5, -6]], shaft, 2); }
    } else if (gear === 'saber') {
      polygon(ctx, [[-15, -3], [20, -28], [25, -21], [-11, 2]], blade); line(ctx, [[-21, 5], [-12, -1]], shaft, 3);
    } else {
      line(ctx, [[14, 8], [14, -36]], blade, 2.5); line(ctx, [[9, -9], [19, -9]], shaft, 2);
    }
    ctx.restore();
  }

  drawV1Enemy(ctx, enemy, time) {
    const local = { ...enemy, x: 0, y: 0 };
    // Threat ground rings: bosses red and pulsing, elites amber, anything about to breach the gate gets a red rim.
    const boss = enemy.type === 'boss' || enemy.class === 'boss';
    const elite = !boss && (enemy.class === 'elite' || ['armor', 'siege', 'banner'].includes(enemy.type));
    const breaching = enemy.pathLength > 0 && enemy.progress / enemy.pathLength > 0.85;
    if (boss || elite || breaching) {
      const pulse = this.reducedMotion ? 0 : (Math.sin(time * 5) + 1) / 2;
      ctx.strokeStyle = boss ? `rgba(232, 92, 70, ${0.55 + pulse * 0.35})` : elite ? '#e8b25fb0' : '#e05a46a0';
      ctx.lineWidth = boss ? 2.5 : 1.6;
      ctx.beginPath(); ctx.ellipse(0, 5, boss ? 26 + pulse * 3 : 15, boss ? 9 + pulse : 6, 0, 0, TAU); ctx.stroke();
    }
    if (!['ranged', 'banner', 'siege'].includes(enemy.type)) {
      super.drawEnemy(ctx, local, time);
      if (boss && enemy.bossTemplateId) { ctx.save(); ctx.scale(1.5, 1.5); this.drawBossGear(ctx, enemy.bossTemplateId); ctx.restore(); }
    } else if (enemy.type === 'siege') {
      oval(ctx, 0, 5, 22, 7, '#323a3040');
      for (const x of [-16, 16]) for (const y of [-2, 8]) oval(ctx, x, y, 5, 5, '#333d35');
      ctx.fillStyle = enemy.hitFlash > 0 ? '#e7c69c' : '#765b43'; ctx.fillRect(-17, -15, 34, 20);
      polygon(ctx, [[-20, -14], [-12, -29], [12, -29], [20, -14]], '#924738', '#c9ad79');
      line(ctx, [[0, -18], [0, 18]], '#a6a086', 8); line(ctx, [[-15, -5], [15, -5]], '#c7ab78', 2);
      this.drawEnemyHealth(ctx, enemy, 35, -35);
    } else {
      super.drawEnemy(ctx, { ...local, type: 'infantry' }, time);
      // A bow/quiver or full-height banner distinguishes the specialist silhouettes.
      if (enemy.type === 'ranged') {
        ctx.strokeStyle = '#dec398'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(-6, -8, 9, Math.PI / 2, Math.PI * 1.5); ctx.stroke();
        line(ctx, [[-6, -17], [-6, 1]], '#e8ddb8', 0.8); line(ctx, [[2, -24], [5, -5]], '#433f32', 3);
      } else {
        line(ctx, [[9, 4], [9, -42]], '#d2b582', 2);
        polygon(ctx, [[9, -42], [28, -37], [23, -29], [28, -22], [9, -25]], '#9f3e37', '#edc98a');
        line(ctx, [[14, -37], [14, -28]], '#e8cf91', 1.5);
        ctx.strokeStyle = '#d3ac6a80'; ctx.lineWidth = 1; ctx.beginPath(); ctx.ellipse(0, 5, 12, 5, 0, 0, TAU); ctx.stroke();
      }
    }
    if (enemy.invulnerable || enemy.bossPhase === 'invulnerable') {
      ctx.strokeStyle = '#c4d3d3'; ctx.setLineDash([3, 2]); ctx.beginPath(); ctx.ellipse(0, -12, 23, 33, 0, 0, TAU); ctx.stroke(); ctx.setLineDash([]);
    }
    if (enemy.vulnerabilityTime > 0 || enemy.vulnerableTime > 0) polygon(ctx, [[-4, -28], [0, -24], [4, -28]], '#e4c27a');
  }

  drawEnemyHealth(ctx, enemy, width, y) {
    if (enemy.hp >= enemy.maxHp && !enemy.hitFlash) return;
    ctx.fillStyle = '#233b30'; ctx.fillRect(-width / 2, y, width, 4);
    ctx.fillStyle = '#d18a66'; ctx.fillRect(-width / 2, y + 1, width * clamp(enemy.hp / enemy.maxHp), 2);
  }

  drawSkillLayers(ctx, id, { age, radius = 125, width = 180, length = 400, definition = {} }) {
    const pulse = clamp(age / 0.65), ring = (r, color, thickness = 2) => {
      ctx.strokeStyle = color; ctx.lineWidth = thickness; ctx.beginPath(); ctx.arc(0, 0, r, 0, TAU); ctx.stroke();
    };
    if (id === 'guan_yu') {
      const front = clamp(age / (definition.frontTravelSec ?? 0.64)) * length;
      // The dragon and all blade layers trail the actual hit front, inside its locked rectangle.
      ctx.fillStyle = '#21b69422'; ctx.fillRect(0, -width / 2, front, width);
      for (const [offset, tint, thickness] of [[0, '#2bd9aa44', 18], [-5, '#68edb8', 7], [-9, '#e0ffe1', 2]]) {
        ctx.strokeStyle = tint; ctx.lineWidth = thickness;
        ctx.beginPath(); ctx.moveTo(front + offset, -width / 2);
        ctx.quadraticCurveTo(Math.max(0, front - 34 + offset), 0, front + offset, width / 2); ctx.stroke();
      }
      const dragon = Array.from({ length: 13 }, (_, i) => [Math.max(0, front - i * 11), Math.sin(i * 0.9) * width * 0.15]);
      line(ctx, dragon, '#87e5b8', 4); line(ctx, dragon, '#e2ffc4', 1);
      polygon(ctx, [[front - 8, -8], [front - 30, -18], [front - 24, 0], [front - 32, 13], [front - 8, 7]], '#9ff2bd');
      ctx.save(); ctx.translate(Math.max(0, front - 20), 0); this.sparks(ctx, 14, width * 0.42, '#bcffd4', pulse); ctx.restore();
    } else if (id === 'zhang_fei') {
      for (let i = 0; i < 4; i++) {
        const x = length * clamp(pulse - i * 0.16);
        line(ctx, [[x - 12, -width / 2], [x + 12, 0], [x - 12, width / 2]], i ? '#dab56e70' : '#ffe0a2', 6 - i);
      }
      polygon(ctx, [[0, -16], [length, -3], [length, 3], [0, 16]], '#e5bc6435');
    } else if (id === 'zhao_yun') {
      for (let i = 0; i < 3; i++) if (age >= (definition.passAtSec?.[i] ?? i * 0.25)) {
        const y = (i - 1) * width / 4;
        polygon(ctx, [[0, y - 6], [length, y], [0, y + 6]], ['#92ddef55', '#e6ffff70', '#9bc8ff55'][i]);
        line(ctx, [[8, y], [length, y]], '#edffff', 1.5);
      }
    } else if (id === 'xu_chu') {
      for (let i = 0; i < 3; i++) {
        const r = length * clamp(pulse - i * 0.18);
        ctx.strokeStyle = i ? '#c386465c' : '#f4c57f'; ctx.lineWidth = 8 - i * 2;
        ctx.beginPath(); ctx.arc(0, 0, r, -(definition.angleDegrees ?? 70) * Math.PI / 360, (definition.angleDegrees ?? 70) * Math.PI / 360); ctx.stroke();
      }
      line(ctx, [[30, 0], [length * 0.45, -12], [length * 0.63, 11], [length, 0]], '#ffe0a7', 3);
    } else if (id === 'sima_yi') {
      ring(radius * 0.85, '#b08de955', 6); ring(radius * 0.63, '#d2bcec', 1);
      if (age >= (definition.delaySec ?? 1)) {
        for (let i = -1; i <= 1; i++) {
          const x = i * radius * 0.4;
          const bolt = [[x, -radius], [x - 13, -radius * 0.35], [x + 9, -radius * 0.4], [x - 5, radius * 0.25]];
          line(ctx, bolt, '#9672d275', 10); line(ctx, bolt, '#f1e6ff', 3);
        }
        this.sparks(ctx, 12, radius * 0.7, '#d1baff', pulse);
      }
    } else if (id === 'zhou_yu') {
      ring(radius * 0.92, '#b4493555', 9); ring(radius * 0.65, '#ffce8370', 3);
      for (let i = 0; i < 12; i++) {
        const angle = i * 2.39996, r = radius * (0.25 + i % 3 * 0.22);
        const x = Math.cos(angle) * r, y = Math.sin(angle) * r, height = 15 + Math.sin(age * 9 + i) * 5;
        polygon(ctx, [[x - 6, y + 4], [x - 3, y - height * 0.6], [x, y - height], [x + 6, y + 4]], '#e8773d');
        polygon(ctx, [[x - 3, y + 3], [x + 1, y - height * 0.6], [x + 3, y + 3]], '#ffe1a2');
      }
      this.sparks(ctx, 12, radius * 0.6, '#ffbd6d', age % 1);
    } else if (id === 'zhuge_liang') {
      ring(radius * 0.88, '#8ddccf70', 3); ring(radius * 0.55, '#c7ebc780', 1);
      ctx.save(); ctx.rotate(age * 0.4);
      for (let i = 0; i < 8; i++) {
        ctx.save(); ctx.rotate(i * Math.PI / 4);
        for (let j = 0; j < 3; j++) line(ctx, [[radius * 0.7 + j * 4, -7], [radius * 0.7 + j * 4, 7]], '#d4f1c6', 1.5);
        ctx.restore();
      }
      ctx.restore(); this.sparks(ctx, 8, radius * 0.5, '#b9edda', age % 1);
    } else if (id === 'gan_ning') {
      ring(radius * 0.9, '#7fd4d570', 2);
      for (let i = 0; i < 12; i++) {
        const angle = i * 2.39996, r = radius * Math.sqrt((i + 0.5) / 12) * 0.86;
        const x = Math.cos(angle) * r, y = Math.sin(angle) * r;
        const flight = (age * 3 + i / 12) % 1;
        line(ctx, [[x - 8, y - 35 * (1 - flight)], [x, y]], '#d1ebe784', 2);
        if (flight > 0.6) { ctx.save(); ctx.translate(x, y); ring(4 + flight * 4, '#abdcd355', 1); ctx.restore(); }
      }
    } else if (id === 'lv_meng') {
      ring(Math.min(radius, 20), '#ebefda', 2);
      for (let i = 0; i < 4; i++) { ctx.save(); ctx.rotate(i * Math.PI / 2); line(ctx, [[8, -8], [15, -15], [23, -15]], '#dae5bc', 2); ctx.restore(); }
      this.sparks(ctx, 6, radius * 0.5, '#eaf3cf', pulse);
    } else if (id === 'xiahou_dun') {
      ring(radius * pulse, '#eeb17a66', 11); ring(radius * pulse * 0.9, '#ffdc9c', 2);
      for (let i = 0; i < 8; i++) {
        ctx.save(); ctx.rotate(i * TAU / 8);
        line(ctx, [[radius * 0.3, 0], [radius * 0.5, 6], [radius * 0.6, -4], [radius * 0.83, 0]], '#dbad72', 2); ctx.restore();
      }
    } else if (['cao_cao', 'liu_bei', 'sun_quan'].includes(id)) {
      const tint = id === 'liu_bei' ? '#c5efb6' : id === 'sun_quan' ? '#f2da8f' : '#e1c080';
      ring(radius * 0.87, `${tint}55`, 5); ring(radius * (0.35 + pulse * 0.45), `${tint}90`, 2);
      for (let i = 0; i < 6; i++) {
        ctx.save(); ctx.rotate(i * TAU / 6); ctx.translate(radius * 0.64, 0);
        if (id === 'cao_cao') { polygon(ctx, [[-5, 9], [-5, -13], [9, -10], [5, -3], [-5, -3]], '#dfc582'); }
        else if (id === 'liu_bei') { line(ctx, [[-5, 0], [5, 0]], tint, 2); line(ctx, [[0, -5], [0, 5]], tint, 2); }
        else polygon(ctx, [[-6, -8], [6, -8], [5, 3], [0, 8], [-5, 3]], '#cfaa4944', tint);
        ctx.restore();
      }
      this.sparks(ctx, 8, radius * 0.5, tint, pulse);
    }
  }

  drawSkillShape(ctx, effect, { preview = false, ground = false, game } = {}) {
    const id = effect.heroId, shape = effect.shape ?? (effect.type === 'mine' ? 'lane_mines' : 'circle');
    const definition = game?.heroes?.find(h => (h.heroId ?? h.id) === id)?.definition?.ultimate ?? {};
    const art = HERO_ART[id], age = effect.age ?? effect.time ?? 0;
    const lifeRatio = effect.life == null ? 1 : clamp(1 - age / (effect.life || 1));
    const x = effect.x ?? effect.originX ?? 210, y = effect.y ?? effect.originY ?? 550;
    const radius = effect.radius ?? effect.range ?? 125;
    const color = id === 'zhou_yu' || effect.type === 'oil' ? '#efb066' : id === 'sima_yi' ? '#c6b5de' : id === 'gan_ning' ? '#90d7d0' : '#d8dfa6';
    // Mine placement is represented only at real map positions, never at the hero.
    if (id === 'lv_meng' && effect.type === 'ultimate') return;
    if (this.reducedMotion && !preview && !ground) {
      this.drawSkillShape(ctx, effect, { preview: true, game });
      this.sprite(ctx, x, y - 24, () => text(ctx, art?.skill ?? '技能范围', 0, 0, Math.max(11, 11 / this.cssIso), color));
      return;
    }
    ctx.save(); ctx.globalAlpha = preview ? 0.2 : ground ? 0.17 : Math.min(0.75, 0.35 + lifeRatio * 0.4);
    ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineWidth = preview ? 1 : 2;
    if (preview || effect.type === 'telegraph' || id === 'sima_yi' && age < (definition.delaySec ?? 1)) ctx.setLineDash([5, 7]);
    const lane = shape.includes('lane_following') || id === 'zhang_liao';
    const rect = shape.includes('rectangle') || shape.includes('rect') || ['guan_yu', 'zhang_fei', 'zhao_yun'].includes(id);
    const cone = shape.includes('cone') || id === 'xu_chu';
    const snipe = shape.includes('snipes') || id === 'taishi_ci';
    if (shape === 'lane_mines' && preview && effect.type !== 'mine') {
      for (const laneId of effect.laneIds ?? ['route_0', 'route_1']) {
        const index = Number(String(laneId).replace('route_', '')) || 0, path = this.map.paths[index];
        if (!path) continue;
        const hero = game?.heroes?.find(h => (h.heroId ?? h.id) === id);
        for (const fraction of hero?.definition?.ultimate?.laneProgressFractions ?? [0.25, 0.55]) {
          const points = partialPath(path, fraction), point = points[points.length - 1];
          ctx.beginPath(); ctx.arc(point.x, point.y, hero?.definition?.ultimate?.triggerRadius ?? 45, 0, TAU); ctx.stroke();
        }
      }
    } else if (lane) {
      const index = Number(String(effect.laneId ?? '0').replace('route_', '')) || 0;
      const path = this.map.paths[index] ?? this.map.paths[0];
      const total = path.slice(1).reduce((sum, p, i) => sum + Math.hypot(p.x - path[i].x, p.y - path[i].y), 0);
      const coverage = partialPath([...path].reverse(), Math.min(1, (effect.length ?? definition.length ?? total) / total));
      roadPath(ctx, coverage); ctx.lineWidth = preview ? effect.width ?? definition.width ?? 100 : 2; ctx.stroke();
      if (!preview) {
        const trail = partialPath(coverage, age / (definition.frontTravelSec ?? 0.8));
        for (const [width, tint] of [[14, '#d8ba6245'], [7, '#e6d39c'], [2, '#fff7c8']]) {
          roadPath(ctx, trail); ctx.lineWidth = width; ctx.strokeStyle = tint; ctx.stroke();
        }
        const front = trail[trail.length - 1]; oval(ctx, front.x, front.y, 6, 6, '#fff2ba');
        ctx.save(); ctx.translate(front.x, front.y); this.sparks(ctx, 8, 13, '#f5d587', age); ctx.restore();
      }
    } else if (snipe) {
      for (const enemy of effect.targets ?? (game?.enemies ?? []).filter(e => (effect.targetIds ?? []).includes(e.id))) {
        ctx.beginPath(); ctx.arc(enemy.x, enemy.y - 5, 14, 0, TAU); ctx.stroke();
        line(ctx, [[enemy.x, enemy.y - 28], [enemy.x, enemy.y - 7]], '#f6e6b4', 2);
        if (!preview) polygon(ctx, [[enemy.x, enemy.y], [enemy.x - 4, enemy.y - 8], [enemy.x + 4, enemy.y - 8]], '#f6e6b4');
        if (!preview) {
          line(ctx, [[x, y - 15], [enemy.x, enemy.y - 5]], '#eacd8055', 5);
          line(ctx, [[enemy.x - 18, enemy.y - 5], [enemy.x + 18, enemy.y - 5]], '#fff0bf', 1);
          ctx.save(); ctx.translate(enemy.x, enemy.y); this.sparks(ctx, 6, 12, '#fff0bf', age); ctx.restore();
        }
      }
    } else if (rect || cone) {
      const width = effect.width ?? (id === 'zhao_yun' ? 110 : 180), length = effect.length ?? effect.range ?? 400;
      ctx.translate(x, y); ctx.rotate(effect.angle ?? -Math.PI / 2);
      if (cone) {
        const half = (effect.angleDegrees ?? 70) * Math.PI / 360;
        ctx.beginPath(); ctx.moveTo(0, 0); ctx.arc(0, 0, length, -half, half); ctx.closePath();
      } else { ctx.beginPath(); ctx.rect(0, -width / 2, length, width); }
      ctx.stroke();
      if (preview || ground) { ctx.globalAlpha *= 0.24; ctx.fill(); }
      if (!preview && !ground) {
        ctx.save(); ctx.clip(); this.drawSkillLayers(ctx, id, { age, width, length, definition, cone }); ctx.restore();
      }
      if (!preview && !ground && id === 'guan_yu') {
        const front = clamp(age / (definition.frontTravelSec ?? 0.64)) * length;
        ctx.strokeStyle = '#d6ffdf'; ctx.lineWidth = 4;
        ctx.beginPath(); ctx.moveTo(front, -width / 2); ctx.quadraticCurveTo(front - 20, 0, front, width / 2); ctx.stroke();
      } else if (!preview && !ground && id === 'zhao_yun') {
        for (let i = 0; i < 3; i++) if (age >= (definition.passAtSec?.[i] ?? i * 0.25)) line(ctx, [[8, (i - 1) * width / 4], [length, (i - 1) * width / 4]], '#c4edf2', 3 - i * 0.5);
      } else if (!preview && !ground && id === 'zhang_fei') {
        for (let i = 0; i < 3; i++) line(ctx, [[length * (0.3 + i * 0.25), -width * 0.42], [length * (0.3 + i * 0.25) + 15, 0], [length * (0.3 + i * 0.25), width * 0.42]], '#ecd093', 2);
      } else if (!preview && !ground && cone) {
        for (let i = -2; i <= 2; i++) line(ctx, [[25, i * 8], [length * 0.75, i * length * 0.13]], '#e3c68b', 2);
      }
    } else {
      ctx.translate(x, y);
      ctx.beginPath(); ctx.arc(0, 0, radius, 0, TAU); ctx.stroke();
      if (ground || preview) { ctx.globalAlpha *= 0.25; ctx.fill(); }
      if (!ground && !preview) {
        ctx.setLineDash([]);
        ctx.save(); ctx.clip(); this.drawSkillLayers(ctx, id, { age, radius, definition }); ctx.restore();
        if (effect.type === 'mine' || id === 'lv_meng') {
          line(ctx, [[-9, -9], [9, 9]], '#d8e5cf', 3); line(ctx, [[9, -9], [-9, 9]], '#d8e5cf', 3);
          ctx.strokeStyle = '#d8e5cf'; ctx.beginPath(); ctx.arc(0, 0, 16, 0, TAU); ctx.stroke();
        } else if (id === 'sima_yi') {
          const delayed = age < (definition.delaySec ?? 1);
          if (delayed) {
            ctx.beginPath(); ctx.arc(0, 0, radius * 0.7, -Math.PI / 2, -Math.PI / 2 + TAU * clamp(age / (definition.delaySec ?? 1))); ctx.stroke();
            text(ctx, '落雷预告', 0, -radius - 12, 11, '#e1d4ed');
          } else for (const offset of [-radius / 3, radius / 3]) line(ctx, [[offset, -radius * 0.8], [offset - 8, -20], [offset + 9, -27], [offset, 5]], '#ded2f3', 3);
        } else if (id === 'zhou_yu' || effect.type === 'oil') {
          for (let i = 0; i < 7; i++) {
            const a = i / 7 * TAU, fx = Math.cos(a) * radius * 0.72, fy = Math.sin(a) * radius * 0.72;
            polygon(ctx, [[fx - 4, fy], [fx, fy - 12], [fx + 4, fy]], '#efb066');
          }
        } else if (id === 'zhuge_liang') {
          for (let i = 0; i < 4; i++) {
            const a = i * Math.PI / 2 + (this.reducedMotion ? 0 : this.visualTime * 0.4);
            ctx.save(); ctx.rotate(a); line(ctx, [[radius * 0.75, -6], [radius * 0.55, 0], [radius * 0.75, 6]], '#b8eed2', 2); ctx.restore();
          }
        } else if (id === 'gan_ning') {
          for (let i = 0; i < 10; i++) {
            const a = i * 2.4, r = Math.sqrt((i + 0.5) / 10) * radius * 0.9;
            const ax = Math.cos(a) * r, ay = Math.sin(a) * r;
            line(ctx, [[ax - 5, ay - 12], [ax, ay]], '#e4d4a1', 1.5);
            polygon(ctx, [[ax, ay + 3], [ax - 4, ay - 3], [ax + 1, ay - 4]], '#e4d4a1');
          }
        } else if (id === 'cao_cao') {
          polygon(ctx, [[-16, -16], [16, -16], [16, 16], [-16, 16]], '#e4c27a24', '#ead38b');
          line(ctx, [[-8, -7], [8, -7], [0, 0], [0, 9]], '#ead38b', 2);
        } else if (id === 'liu_bei') {
          line(ctx, [[-9, 0], [9, 0]], '#d5e2a2', 3); line(ctx, [[0, -9], [0, 9]], '#d5e2a2', 3);
        } else if (id === 'sun_quan') {
          polygon(ctx, [[-16, -15], [16, -15], [14, 7], [0, 19], [-14, 7]], '#e4c27a18', '#ead38b');
          line(ctx, [[0, -9], [0, 9]], '#ead38b', 2);
        } else if (id === 'xiahou_dun') {
          ctx.strokeStyle = '#e7a77b'; ctx.lineWidth = 3;
          ctx.beginPath(); ctx.arc(0, 0, radius * (0.5 + 0.5 * clamp(age / 0.6)), 0, TAU); ctx.stroke();
          for (let i = 0; i < 6; i++) {
            const a = i * Math.PI / 3; line(ctx, [[Math.cos(a) * radius * 0.5, Math.sin(a) * radius * 0.5], [Math.cos(a) * radius * 0.8, Math.sin(a) * radius * 0.8]], '#e7a77b', 2);
          }
        }
      }
    }
    ctx.restore();
    // These support effects explicitly identify the gate or affected camps.
    if (!ground && !preview && ['liu_bei', 'sun_quan'].includes(id)) {
      ctx.save(); ctx.globalAlpha = 0.55; ctx.strokeStyle = id === 'liu_bei' ? '#c8eda4' : '#edd08d'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(210, 560, 39, Math.PI, TAU); ctx.stroke(); ctx.restore();
    }
    if (!ground && !preview && id === 'cao_cao') for (const camp of game?.camps ?? []) {
      const slot = this.map.campSlots.find((s, i) => (s.slot ?? i) === camp.slot); if (!slot) continue;
      line(ctx, [[slot.x - 8, slot.y - 34], [slot.x, slot.y - 40], [slot.x + 8, slot.y - 34]], '#e4c27a90', 2);
    }
  }
}

export { WORLD_WIDTH, WORLD_HEIGHT };
