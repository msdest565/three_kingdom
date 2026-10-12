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
    this.setMap(DEFAULT_MAP);
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
  }

  pruneFeedback(now = nowSeconds()) {
    this.damageLabels = this.damageLabels.filter(label => now - label.started < label.life);
    this.deathSnapshots = this.deathSnapshots.filter(death => now - death.started < death.life);
  }

  handleEvent(event = {}) {
    if (this.destroyed || globalThis.document?.hidden) return;
    const now = nowSeconds();
    this.pruneFeedback(now);
    if (['ultimate', 'burst', 'ultimate_result'].includes(event.type)) { this.flashUltimate(event); return; }
    if (!Number.isFinite(event.x) || !Number.isFinite(event.y)) return;
    if (event.type === 'damage' && Number.isFinite(event.amount) && event.amount > 0) {
      const prominent = Boolean(event.heroId) || /^(hero|ultimate)_/.test(event.source ?? '');
      const merged = !prominent && this.damageLabels.find(label => !label.prominent && label.enemyId === event.enemyId
        && event.enemyId != null && now - label.started <= 0.12);
      if (merged) { merged.amount += event.amount; merged.hits++; }
      else {
        this.damageLabels.push({ enemyId: event.enemyId, x: event.x, y: event.y, amount: event.amount,
          heroId: event.heroId, source: event.source, castId: event.castId, executed: Boolean(event.executed),
          prominent, hits: 1, started: now, life: prominent ? 0.85 : 0.62 });
        if (this.damageLabels.length > FEEDBACK_LIMIT) this.damageLabels.shift();
      }
    } else if (event.type === 'kill') {
      this.deathSnapshots.push({ enemyId: event.enemyId, type: event.enemyType ?? 'infantry', x: event.x, y: event.y,
        radius: clamp(Number(event.radius) || 10, 5, 28), facing: Number.isFinite(event.facing) ? event.facing : Math.PI / 2,
        heroId: event.heroId, source: event.source, castId: event.castId, started: now, life: 0.72 });
      if (this.deathSnapshots.length > FEEDBACK_LIMIT) this.deathSnapshots.shift();
    }
  }

  resetFeedback() {
    this.damageLabels = []; this.deathSnapshots = []; this.flash = null;
    this.impactStarted = -Infinity; this.visualTime = 0;
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

  drawDeaths(ctx, now) {
    for (const death of this.deathSnapshots) {
      const progress = clamp((now - death.started) / death.life);
      this.sprite(ctx, death.x, death.y, () => {
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
      const value = `${label.executed ? '击破 ' : ''}${amount}${label.hits > 1 ? ` ·${label.hits}击` : ''}`;
      this.sprite(ctx, label.x, label.y - 27 - (this.reducedMotion ? 0 : progress * 22), () => {
        ctx.globalAlpha = clamp((1 - progress) / 0.3);
        ctx.font = `800 ${Math.max(label.prominent ? 17 : 12, (label.prominent ? 15 : 11) / this.cssIso)}px "Microsoft YaHei", sans-serif`;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.lineWidth = 3;
        ctx.strokeStyle = '#1b302c'; ctx.strokeText(value, 0, 0);
        ctx.fillStyle = label.prominent ? '#fff0a8' : '#e7e4cd'; ctx.fillText(value, 0, 0);
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

  draw(game, { selectedSlot = -1, realDt = 1 / 60 } = {}) {
    if (!game || !this.ctx || this.destroyed) return;
    const now = nowSeconds();
    this.pruneFeedback(now); this.particlesRemaining = PARTICLE_LIMIT;
    if (game.map && game.map !== this.map) this.setMap(game.map);
    this.resize();
    this.visualTime += clamp(Number(realDt) || 0, 0, 0.1);
    const rect = this.canvas.getBoundingClientRect();
    const sx = this.width / 420, sy = this.height / 600, iso = Math.min(sx, sy);
    this.cssIso = Math.max(0.1, Math.min(rect.width / 420, rect.height / 600));
    this.spriteScaleX = iso / sx; this.spriteScaleY = iso / sy;
    const ctx = this.ctx, time = this.reducedMotion ? 0 : this.visualTime;
    ctx.setTransform(sx, 0, 0, sy, 0, 0);
    const impactAge = now - this.impactStarted;
    if (!this.reducedMotion && impactAge >= 0 && impactAge < 0.18) {
      const strength = (1 - impactAge / 0.18) * 1.5;
      ctx.translate(Math.sin(impactAge * 120) * strength, Math.cos(impactAge * 90) * strength * 0.5);
    }
    ctx.globalAlpha = 1; ctx.drawImage(this.background, 0, 0, 420, 600);
    this.drawDeaths(ctx, now);
    const slots = this.map.campSlots ?? CAMP_SLOTS, camps = game.camps ?? [];
    const selected = slots.find((slot, index) => (slot.slot ?? index) === selectedSlot);
    if (selected) {
      const camp = camps.find(c => c.slot === selectedSlot);
      ctx.save(); ctx.setLineDash([5, 5]); ctx.strokeStyle = '#e9d7a38c'; ctx.fillStyle = '#9ddb9415';
      ctx.beginPath(); ctx.arc(selected.x, selected.y, camp?.range ?? 44, 0, TAU); ctx.fill(); ctx.stroke(); ctx.restore();
    }
    for (const hero of game.heroes ?? []) {
      if ((hero.role === 'lead' || hero === game.heroes[0]) && hero.rage >= 100 && hero.target) this.drawSkillShape(ctx, { ...hero.target, heroId: hero.heroId ?? hero.id }, { preview: true, game });
    }
    for (const effect of game.effects ?? []) if (['field', 'mine', 'telegraph', 'oil'].includes(effect.type)) this.drawSkillShape(ctx, effect, { ground: true, game });
    slots.forEach((slot, index) => {
      if (!camps.some(c => c.slot === (slot.slot ?? index))) this.sprite(ctx, slot.x, slot.y, () => this.drawEmptyCamp(ctx, { x: 0, y: 0 }, (slot.slot ?? index) === selectedSlot, time));
    });
    const units = [
      ...camps.map(c => { const slot = slots.find((s, i) => (s.slot ?? i) === c.slot); return { ...c, kind: 'camp', x: c.x ?? slot?.x, y: c.y ?? slot?.y }; }),
      ...(game.enemies ?? []).filter(e => e.hp > 0 && !e.escaped).map(e => ({ ...e, kind: 'enemy' })),
      ...(game.heroes ?? []).map((h, index) => ({ ...h, kind: 'hero', x: h.x ?? [210, 140, 280][index], y: h.y ?? 550 })),
    ].sort((a, b) => a.y - b.y);
    for (const unit of units) {
      if (!Number.isFinite(unit.x) || !Number.isFinite(unit.y)) continue;
      this.sprite(ctx, unit.x, unit.y, () => {
        if (unit.kind === 'camp') this.drawV1Camp(ctx, unit, selectedSlot === unit.slot, time);
        else if (unit.kind === 'hero') this.drawV1Hero(ctx, unit, time);
        else this.drawV1Enemy(ctx, unit, time);
      });
    }
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
    if ((game.hp ?? game.gateHp) < (game.maxHp ?? game.maxGateHp ?? 100) * 0.3) this.drawDanger(ctx, time);
    // World positions scale independently; text and actors use an isotropic transform.
    this.sprite(ctx, 210, 20, () => text(ctx, this.map.name ?? '演武沙盘', 0, 0, Math.max(11, 11 / this.cssIso), '#ead5a0'));
    if (this.flash) {
      const age = nowSeconds() - this.flash.started;
      if (age > 1.6) this.flash = null;
      else if (this.flash.resultAt == null) this.sprite(ctx, 210, 55, () => {
        ctx.globalAlpha = clamp((1.6 - age) / 0.3);
        const art = HERO_ART[this.flash.heroId];
        // The DOM result popup owns final kill counts; this label is release-only.
        text(ctx, `${art?.name ?? '无双'} · ${this.flash.name ?? art?.skill ?? '无双发动'}`, 0, 0, Math.max(12, 12 / this.cssIso), '#d6ffdf');
      });
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
    ctx.save(); ctx.scale(support ? 0.9 : 1, support ? 0.9 : 1);
    oval(ctx, 0, 6, 16, 6, '#142b2760');
    ctx.strokeStyle = ready ? '#ccf6c6' : '#77c5a1'; ctx.lineWidth = ready ? 2.3 : 1;
    ctx.beginPath(); ctx.ellipse(0, 4, 20, 9, 0, 0, TAU); ctx.stroke();
    // Jade ownership chevrons remain common even for red/purple-clad allies.
    polygon(ctx, [[-3, 9], [0, 13], [3, 9]], '#82c9a9');
    if (!this.reducedMotion) ctx.translate(0, Math.sin(time * 2.5) * 0.35);
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
    this.drawHeroGear(ctx, art.gear, Boolean(hero.attackFlash > 0 || hero.casting));
    ctx.restore();
    text(ctx, art.name, 0, 25, Math.max(11, 11 / this.cssIso), '#f0d99a');
  }

  drawHeroGear(ctx, gear, attacking) {
    ctx.save(); if (attacking && !this.reducedMotion) ctx.rotate(-0.12);
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
    if (!['ranged', 'banner', 'siege'].includes(enemy.type)) {
      super.drawEnemy(ctx, local, time);
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
