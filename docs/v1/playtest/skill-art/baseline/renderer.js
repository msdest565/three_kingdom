const WORLD_WIDTH = 420;
const WORLD_HEIGHT = 600;
const CAMP_SLOTS = [
  { x: 53, y: 142 }, { x: 367, y: 142 },
  { x: 67, y: 290 }, { x: 353, y: 290 },
  { x: 88, y: 420 }, { x: 332, y: 420 },
];

const COLORS = {
  ink: '#203933', jade: '#276b57', jadeLight: '#77ceb0',
  gold: '#e4c27a', paper: '#eedfb3', enemy: '#a23d37',
};

function roundedRect(ctx, x, y, width, height, radius = 5) {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + width - r, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + r);
  ctx.lineTo(x + width, y + height - r);
  ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
  ctx.lineTo(x + r, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function ellipse(ctx, x, y, rx, ry, color) {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
  ctx.fill();
}

function label(ctx, text, x, y, { size = 11, color = COLORS.paper, background = '#203933e8', padding = 6 } = {}) {
  ctx.save();
  ctx.font = `600 ${size}px "Microsoft YaHei", "PingFang SC", sans-serif`;
  const width = ctx.measureText(text).width + padding * 2;
  if (background) {
    ctx.fillStyle = background;
    roundedRect(ctx, x - width / 2, y - size - 3, width, size + 8, 4);
    ctx.fill();
  }
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = color;
  ctx.fillText(text, x, y);
  ctx.restore();
}

function seededRandom(seed) {
  let value = seed >>> 0;
  return () => {
    value = (value * 1664525 + 1013904223) >>> 0;
    return value / 4294967296;
  };
}

export class Renderer {
  constructor(canvas, { reducedMotion = false } = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false });
    this.reducedMotion = reducedMotion;
    this.flash = null;
    this.bladeTrails = [];
    this.width = 0;
    this.height = 0;
    this.background = document.createElement('canvas');
    this.background.width = WORLD_WIDTH * 2;
    this.background.height = WORLD_HEIGHT * 2;
    const backgroundCtx = this.background.getContext('2d');
    backgroundCtx.scale(2, 2);
    this.drawBackground(backgroundCtx);
    this.resize();
    this.resizeObserver = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => this.resize()) : null;
    this.resizeObserver?.observe(canvas);
  }

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const width = Math.max(1, Math.round(rect.width * dpr));
    const height = Math.max(1, Math.round(rect.height * dpr));
    if (width !== this.width || height !== this.height) {
      this.canvas.width = width;
      this.canvas.height = height;
      this.width = width;
      this.height = height;
    }
  }

  hitTest(clientX, clientY) {
    const rect = this.canvas.getBoundingClientRect();
    if (!rect.width || !rect.height || clientX < rect.left || clientX > rect.right || clientY < rect.top || clientY > rect.bottom) return -1;
    const x = (clientX - rect.left) * WORLD_WIDTH / rect.width;
    const y = (clientY - rect.top) * WORLD_HEIGHT / rect.height;
    return CAMP_SLOTS.findIndex(slot => Math.hypot(x - slot.x, y - slot.y) <= 34);
  }

  flashUltimate(event = {}) {
    const now = performance.now() / 1000;
    if (event.type === 'burst') {
      if (this.flash) {
        this.flash.kills = event.kills ?? event.count ?? 0;
        this.flash.resultAt = now;
      }
      return;
    }
    this.flash = {
      started: now, resultAt: null, kills: event.kills ?? event.count ?? 0,
      burstId: event.burstId, angle: event.angle ?? -Math.PI / 2,
    };
    this.bladeTrails = [];
  }

  destroy() {
    this.resizeObserver?.disconnect();
    this.flash = null;
    this.bladeTrails = [];
  }

  drawBackground(ctx) {
    const random = seededRandom(2713);
    const ground = ctx.createLinearGradient(0, 0, 0, WORLD_HEIGHT);
    ground.addColorStop(0, '#758664');
    ground.addColorStop(0.48, '#909b71');
    ground.addColorStop(1, '#697d62');
    ctx.fillStyle = ground;
    ctx.fillRect(0, 0, WORLD_WIDTH, WORLD_HEIGHT);

    for (let i = 0; i < 1200; i++) {
      const x = random() * WORLD_WIDTH;
      const y = random() * 540;
      const radius = 0.5 + random() * 2;
      ellipse(ctx, x, y, radius * 1.8, radius, i % 3 === 0 ? '#425d4920' : '#e0d2a326');
    }
    // Broad, pale roads keep silhouettes legible when the enemy wave becomes dense.
    for (const side of [-1, 1]) {
      const road = () => {
        ctx.beginPath();
        ctx.moveTo(210 + side * 105, -25);
        ctx.bezierCurveTo(210 + side * 116, 75, 210 + side * 119, 145, 210 + side * 89, 195);
        ctx.bezierCurveTo(210 + side * 65, 238, 215 + side * 23, 267, 210, 303);
        ctx.lineTo(210, 557);
      };
      ctx.lineCap = 'round';
      road(); ctx.strokeStyle = '#485b3a44'; ctx.lineWidth = 62; ctx.stroke();
      road(); ctx.strokeStyle = '#b7a87e'; ctx.lineWidth = 57; ctx.stroke();
      road(); ctx.strokeStyle = '#caba92'; ctx.lineWidth = 49; ctx.stroke();
      road(); ctx.strokeStyle = '#deceaa55'; ctx.lineWidth = 35; ctx.stroke();
    }
    for (let i = 0; i < 90; i++) {
      const y = random() * 490;
      const x = y < 175 ? (i % 2 ? 104 : 316) : y < 303 ? 210 + (i % 2 ? -1 : 1) * (303 - y) * 0.7 : 210;
      const offset = (random() - 0.5) * 35;
      ctx.fillStyle = '#82795f44';
      roundedRect(ctx, x + offset, y, 1.5, 3, 1);
      ctx.fill();
    }

    // A central rocky rise and edge foliage establish a small mountain pass.
    this.drawRock(ctx, 211, 74, 34, 17);
    this.drawRock(ctx, 200, 94, 24, 12);
    this.drawRock(ctx, 226, 102, 20, 10);
    this.drawTree(ctx, 206, 36, 1.15);
    this.drawTree(ctx, 239, 65, 0.72);
    [[13, 63, 1.0], [405, 66, 1.1], [14, 205, 0.85], [408, 236, 1], [13, 372, 1.1], [411, 392, 0.9], [150, 186, 0.65], [267, 161, 0.6]].forEach(args => this.drawTree(ctx, ...args));
    [[14, 140, 18, 10], [408, 158, 23, 12], [18, 304, 18, 12], [404, 339, 19, 11], [32, 470, 24, 13], [387, 471, 27, 16], [167, 111, 12, 7], [277, 86, 14, 7]].forEach(args => this.drawRock(ctx, ...args));

    // Enemy standards frame the two entrances, away from the six camp touch targets.
    this.drawStandard(ctx, 67, 19, '#924138', -1, true);
    this.drawStandard(ctx, 353, 19, '#924138', 1, true);
    label(ctx, '敌军入口', 210, 15, { size: 11, color: '#f5e8c5', background: '#30483cdc' });
    this.drawCastle(ctx);

    const edge = ctx.createLinearGradient(0, 0, WORLD_WIDTH, 0);
    edge.addColorStop(0, '#233e342c');
    edge.addColorStop(0.12, '#233e3400');
    edge.addColorStop(0.88, '#233e3400');
    edge.addColorStop(1, '#233e342c');
    ctx.fillStyle = edge;
    ctx.fillRect(0, 0, WORLD_WIDTH, WORLD_HEIGHT);
  }

  drawTree(ctx, x, y, scale = 1) {
    ctx.save(); ctx.translate(x, y); ctx.scale(scale, scale);
    ellipse(ctx, 3, 17, 22, 6, '#263e332b');
    ctx.strokeStyle = '#615847'; ctx.lineWidth = 4;
    ctx.beginPath(); ctx.moveTo(0, 20); ctx.lineTo(-2, -18); ctx.stroke();
    for (let i = 0; i < 3; i++) {
      const top = -42 + i * 14;
      ctx.fillStyle = ['#324e40', '#3c5945', '#4b674b'][i];
      ctx.beginPath(); ctx.moveTo(-2, top); ctx.lineTo(20 - i * 2, top + 25); ctx.quadraticCurveTo(0, top + 19, -23 + i * 2, top + 25); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = '#9baf7545'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(-2, top + 4); ctx.lineTo(-15, top + 22); ctx.stroke();
    }
    ctx.restore();
  }

  drawRock(ctx, x, y, width, height) {
    ctx.save(); ctx.translate(x, y);
    ellipse(ctx, 2, height / 2, width * 0.75, height * 0.4, '#354b3230');
    ctx.fillStyle = '#767b64';
    ctx.beginPath(); ctx.moveTo(-width, height * 0.25); ctx.lineTo(-width * 0.5, -height * 0.7); ctx.lineTo(width * 0.3, -height); ctx.lineTo(width, height * 0.1); ctx.lineTo(width * 0.65, height * 0.6); ctx.lineTo(-width * 0.6, height * 0.6); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#a6a68a';
    ctx.beginPath(); ctx.moveTo(-width * 0.5, -height * 0.7); ctx.lineTo(width * 0.3, -height); ctx.lineTo(width * 0.1, height * 0.3); ctx.lineTo(-width, height * 0.25); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = '#505b49'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(width * 0.3, -height); ctx.lineTo(width * 0.1, height * 0.3); ctx.lineTo(width * 0.65, height * 0.6); ctx.stroke();
    ctx.restore();
  }

  drawStandard(ctx, x, y, color, direction = 1, small = false) {
    ctx.save(); ctx.translate(x, y); ctx.scale(small ? 0.75 : 1, small ? 0.75 : 1);
    ctx.strokeStyle = '#5a4837'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(0, 29); ctx.lineTo(0, -10); ctx.stroke();
    ctx.fillStyle = color;
    ctx.beginPath(); ctx.moveTo(0, -8); ctx.lineTo(direction * 23, -5); ctx.lineTo(direction * 18, 6); ctx.lineTo(direction * 23, 13); ctx.lineTo(0, 10); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = '#e0c08b'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(direction * 5, -5); ctx.lineTo(direction * 5, 7); ctx.stroke();
    ctx.restore();
  }

  drawCastle(ctx) {
    ellipse(ctx, 210, 546, 234, 25, '#263d3554');
    const stone = ctx.createLinearGradient(0, 533, 0, 600);
    stone.addColorStop(0, '#687365'); stone.addColorStop(1, '#354c45');
    ctx.fillStyle = stone; ctx.fillRect(0, 541, 420, 59);
    ctx.strokeStyle = '#2c423a66'; ctx.lineWidth = 1;
    for (let row = 0; row < 4; row++) {
      const y = 550 + row * 15;
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(420, y); ctx.stroke();
      for (let col = -1; col < 13; col++) {
        const x = col * 38 + (row % 2 ? 19 : 0);
        ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y + 15); ctx.stroke();
      }
    }
    ctx.fillStyle = '#93947a'; ctx.fillRect(0, 536, 420, 7);
    ctx.fillStyle = '#73816b';
    for (let x = 0; x < 420; x += 25) {
      if (x > 169 && x < 248) continue;
      ctx.fillRect(x, 524, 16, 17);
      ctx.fillStyle = '#a2a086'; ctx.fillRect(x, 524, 16, 3); ctx.fillStyle = '#73816b';
    }
    // The gate's arch and dark timber make Guan Yu's green silhouette easy to find.
    ctx.fillStyle = '#9b987c';
    ctx.beginPath(); ctx.moveTo(170, 600); ctx.lineTo(170, 552); ctx.arc(210, 552, 40, Math.PI, 0); ctx.lineTo(250, 600); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#283c34';
    ctx.beginPath(); ctx.moveTo(179, 600); ctx.lineTo(179, 553); ctx.arc(210, 553, 31, Math.PI, 0); ctx.lineTo(241, 600); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#564b3b'; ctx.fillRect(184, 561, 52, 39);
    ctx.strokeStyle = '#9e8657'; ctx.lineWidth = 1.5;
    for (let x = 191; x < 237; x += 10) { ctx.beginPath(); ctx.moveTo(x, 563); ctx.lineTo(x, 600); ctx.stroke(); }
    ctx.fillStyle = '#c2b88f'; ctx.fillRect(164, 516, 92, 8);
    ctx.fillStyle = '#344f43';
    ctx.beginPath(); ctx.moveTo(157, 517); ctx.lineTo(171, 502); ctx.lineTo(249, 502); ctx.lineTo(263, 517); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = '#ab9b6d'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(157, 517); ctx.lineTo(263, 517); ctx.stroke();
    this.drawStandard(ctx, 146, 521, '#1f6255', -1, true);
    this.drawStandard(ctx, 273, 521, '#1f6255', 1, true);
    label(ctx, '关', 210, 515, { size: 11, padding: 5, color: '#e6cc84', background: '#243d32' });
  }

  render(game, { selectedSlot = -1 } = {}) {
    if (!game || !this.ctx) return;
    const ctx = this.ctx;
    const now = performance.now() / 1000;
    const time = now;
    const flashAge = this.flash ? now - this.flash.started : Infinity;
    if (flashAge > 1.65 && (!this.flash?.resultAt || now - this.flash.resultAt > 1.05)) this.flash = null;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.width, this.height);
    ctx.scale(this.width / WORLD_WIDTH, this.height / WORLD_HEIGHT);
    ctx.save();
    if (this.flash && !this.reducedMotion && flashAge < 0.26) {
      const strength = (1 - flashAge / 0.26) * 3.3;
      ctx.translate(Math.sin(flashAge * 115) * strength, Math.cos(flashAge * 93) * strength * 0.6);
    }
    ctx.drawImage(this.background, 0, 0, WORLD_WIDTH, WORLD_HEIGHT);

    const camps = game.camps || [];
    if (selectedSlot >= 0 && selectedSlot < CAMP_SLOTS.length) this.drawSelection(ctx, camps[selectedSlot], selectedSlot, time);
    const isPlaying = game.state === 'playing' || game.state === 'paused' || game.state === 'running';
    if (isPlaying && (game.rage || 0) >= 100 && game.ultimateTarget) this.drawTarget(ctx, game.ultimateTarget, time);

    // Empty sites sit below all combatants; soldiers and camps then use ground depth.
    CAMP_SLOTS.forEach((slot, index) => {
      if (!camps[index]) this.drawEmptyCamp(ctx, slot, index === selectedSlot, time);
    });
    const enemies = game.enemies || [];
    // Small stable offsets reveal the actual troop silhouettes without changing hitboxes or RNG.
    const entities = enemies.map(enemy => {
      const id = Number(enemy.id) || 0;
      const amount = enemy.type === 'boss' ? 0 : enemy.type === 'armor' ? 0.65 : 1;
      const dx = ((id % 7) - 3) * 1.55 * amount;
      const dy = ((Math.floor(id / 7) % 3) - 1) * 1.6 * amount;
      const visualEnemy = { ...enemy, x: enemy.x + dx, y: enemy.y + dy };
      return { kind: 'enemy', entity: visualEnemy, y: visualEnemy.y };
    });
    camps.forEach((camp, slot) => {
      if (camp) entities.push({ kind: 'camp', entity: { ...camp, slot }, y: CAMP_SLOTS[slot].y });
    });
    entities.sort((a, b) => a.y - b.y);
    for (const item of entities) {
      if (item.kind === 'enemy') this.drawEnemy(ctx, item.entity, time);
      else this.drawCamp(ctx, item.entity, item.entity.slot === selectedSlot, time);
    }
    for (const projectile of game.projectiles || []) this.drawProjectile(ctx, projectile);
    this.drawHero(ctx, time, (game.rage || 0) >= 100, this.flash && flashAge < 0.4);
    // The damage wave stays on battle time. Its faint sampled trail lasts in wall time at 2×.
    for (const effect of game.effects || []) {
      if (effect.type !== 'ultimate') continue;
      const latest = this.bladeTrails.at(-1);
      if (!latest || latest.effect.burstId !== effect.burstId || Math.abs(latest.effect.front - effect.front) >= 15) {
        this.bladeTrails.push({ effect: { ...effect }, at: now });
      }
    }
    this.bladeTrails = this.bladeTrails.filter(trail => now - trail.at <= 0.3).slice(-8);
    if (!this.reducedMotion) {
      for (const trail of this.bladeTrails) {
        const age = now - trail.at;
        if (age < 0.025) continue;
        this.drawBladeWave(ctx, trail.effect, 0.3, { opacity: 0.18 * (1 - age / 0.3), trailOnly: true });
      }
    }
    for (const effect of game.effects || []) this.drawEffect(ctx, effect, time);
    if (game.hp <= (game.maxHp || 100) * 0.3 && isPlaying) this.drawDanger(ctx, time);
    ctx.restore();

    if (this.flash) {
      this.drawUltimateFeedback(ctx, now - this.flash.started);
    }
  }

  drawSelection(ctx, camp, index, time) {
    const slot = CAMP_SLOTS[index];
    const radius = camp?.range || 50;
    ctx.save();
    ctx.fillStyle = '#8bdfba16'; ctx.strokeStyle = '#b9f1cb77'; ctx.lineWidth = 1.4;
    ctx.setLineDash([5, 5]); ctx.lineDashOffset = this.reducedMotion ? 0 : -time * 8;
    ctx.beginPath(); ctx.arc(slot.x, slot.y, radius, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.restore();
  }

  drawTarget(ctx, target, time) {
    const angle = target.angle ?? -Math.PI / 2;
    const width = target.width || 180;
    const length = Math.min(target.length || 600, 570);
    ctx.save(); ctx.translate(210, 550); ctx.rotate(angle);
    const gradient = ctx.createLinearGradient(0, 0, length, 0);
    gradient.addColorStop(0, '#82f1c300'); gradient.addColorStop(0.2, '#82f1c31d'); gradient.addColorStop(1, '#82f1c300');
    ctx.fillStyle = gradient; ctx.fillRect(0, -width / 2, length, width);
    ctx.strokeStyle = '#c6f5cf4d'; ctx.lineWidth = 1;
    ctx.setLineDash([6, 9]); ctx.lineDashOffset = this.reducedMotion ? 0 : -time * 10;
    ctx.beginPath(); ctx.moveTo(25, -width / 2); ctx.lineTo(length, -width / 2); ctx.moveTo(25, width / 2); ctx.lineTo(length, width / 2); ctx.stroke();
    ctx.setLineDash([]);
    const pulse = this.reducedMotion ? 0.6 : 0.55 + Math.sin(time * 3) * 0.18;
    ctx.globalAlpha = pulse; ctx.strokeStyle = '#d2f9d2'; ctx.lineWidth = 2;
    for (const distance of [130, 235]) { ctx.beginPath(); ctx.moveTo(distance - 7, -5); ctx.lineTo(distance, 0); ctx.lineTo(distance - 7, 5); ctx.stroke(); }
    ctx.restore();
  }

  drawEmptyCamp(ctx, slot, selected, time) {
    ctx.save(); ctx.translate(slot.x, slot.y);
    ellipse(ctx, 1, 9, 30, 13, '#253c352d');
    ctx.fillStyle = selected ? '#405f49' : '#5f735556';
    ctx.strokeStyle = selected ? '#e6cc81' : '#d5cfaa9e'; ctx.lineWidth = selected ? 2.4 : 1.7;
    ctx.beginPath(); ctx.ellipse(0, 2, 28, 22, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.strokeStyle = '#334f404b'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.ellipse(0, 2, 23, 17, 0, 0, Math.PI * 2); ctx.stroke();
    ctx.strokeStyle = selected ? '#ffe3a1' : '#ece2bd'; ctx.lineCap = 'round'; ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.moveTo(-6, 1); ctx.lineTo(6, 1); ctx.moveTo(0, -5); ctx.lineTo(0, 7); ctx.stroke();
    if (selected && !this.reducedMotion) {
      ctx.strokeStyle = `rgba(233, 216, 153, ${0.3 + Math.sin(time * 4) * 0.15})`; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.ellipse(0, 2, 32, 26, 0, 0, Math.PI * 2); ctx.stroke();
    }
    ctx.restore();
  }

  drawCamp(ctx, camp, selected, time) {
    const slot = CAMP_SLOTS[camp.slot];
    if (!slot) return;
    ctx.save(); ctx.translate(slot.x, slot.y);
    ellipse(ctx, 0, 10, 30, 13, '#183b3238');
    ctx.fillStyle = '#556c51'; ctx.strokeStyle = selected ? COLORS.gold : '#b3b897'; ctx.lineWidth = selected ? 2.5 : 1.5;
    ctx.beginPath(); ctx.ellipse(0, 3, 28, 22, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    if (camp.attackFlash > 0) {
      ctx.fillStyle = `rgba(203, 239, 175, ${Math.min(0.35, camp.attackFlash * 2)})`;
      ctx.beginPath(); ctx.ellipse(0, 3, 24, 18, 0, 0, Math.PI * 2); ctx.fill();
    }
    ctx.fillStyle = '#7f8760';
    for (let i = 0; i < 5; i++) {
      const angle = Math.PI + i * Math.PI / 4;
      const x = Math.cos(angle) * 25; const y = Math.sin(angle) * 18 + 6;
      ctx.fillRect(x - 2, y - 4, 4, 7);
    }
    this.drawStandard(ctx, -20, -15, '#235e56', -1, true);
    if (camp.type === 'shield') {
      [[-8, -5], [8, -5], [0, 9]].forEach(([x, y], index) => this.drawDefender(ctx, x, y, 'shield', time, index));
    } else if (camp.type === 'catapult') {
      ctx.strokeStyle = '#544637'; ctx.lineWidth = 4; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(-11, 8); ctx.lineTo(0, -11); ctx.lineTo(11, 8); ctx.moveTo(0, -11); ctx.lineTo(11, -25); ctx.stroke();
      ctx.strokeStyle = '#cab17a'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(-12, 9); ctx.lineTo(12, 9); ctx.stroke();
      ellipse(ctx, -10, 10, 5, 5, '#3f4437'); ellipse(ctx, 10, 10, 5, 5, '#3f4437');
      ellipse(ctx, 11, -25, 7, 4, '#6e725c'); ellipse(ctx, 12, -27, 4, 3, '#c7c4a5');
      this.drawDefender(ctx, -13, -1, 'archer', time, 0);
    } else {
      [[-8, -7], [8, -7], [0, 7]].forEach(([x, y], index) => this.drawDefender(ctx, x, y, 'archer', time, index));
    }
    const campName = { shield: '盾阵', archer: '弓营', catapult: '投石' }[camp.type] || '军阵';
    label(ctx, `${campName} ${camp.level || 1}`, 0, 34, { size: 11, padding: 5, background: selected ? '#254f40f5' : '#284438ed', color: selected ? '#ffe1a0' : '#ecdeb7' });
    ctx.restore();
  }

  drawDefender(ctx, x, y, type, time, index) {
    ctx.save(); ctx.translate(x, y);
    const bob = this.reducedMotion ? 0 : Math.sin(time * 3 + index) * 0.35;
    ctx.translate(0, bob);
    ellipse(ctx, 0, 4, 5, 2.5, '#14312d55');
    ctx.fillStyle = '#286c61'; roundedRect(ctx, -4, -9, 8, 12, 2); ctx.fill();
    ellipse(ctx, 0, -11, 3.5, 3.5, '#d6b78e');
    ctx.fillStyle = '#354d46'; ctx.fillRect(-4, -15, 8, 4);
    ctx.strokeStyle = '#d5c583'; ctx.lineWidth = 1.3;
    if (type === 'shield') {
      ctx.fillStyle = '#335f61'; roundedRect(ctx, -5, -6, 10, 11, 2); ctx.fill();
      ctx.strokeStyle = '#b1bea4'; ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, -4); ctx.lineTo(0, 3); ctx.stroke();
      ctx.strokeStyle = '#bbbca2'; ctx.beginPath(); ctx.moveTo(7, -15); ctx.lineTo(7, 4); ctx.stroke();
    } else {
      ctx.beginPath(); ctx.arc(5, -4, 6, -Math.PI / 2, Math.PI / 2); ctx.stroke();
      ctx.strokeStyle = '#ddd1a5'; ctx.lineWidth = 0.8; ctx.beginPath(); ctx.moveTo(5, -10); ctx.lineTo(5, 2); ctx.stroke();
    }
    ctx.restore();
  }

  drawEnemy(ctx, enemy, time) {
    if (enemy.hp <= 0) return;
    const boss = enemy.type === 'boss';
    const armor = enemy.type === 'armor' || enemy.type === 'heavy';
    const cavalry = enemy.type === 'cavalry' || enemy.type === 'runner';
    const scale = boss ? 1.5 : armor ? 1.13 : 1;
    const bob = this.reducedMotion ? 0 : Math.sin(time * (cavalry ? 14 : 9) * (enemy.slow ?? 1) + Number(enemy.id || 0) * 1.7) * 0.65;
    ctx.save(); ctx.translate(enemy.x, enemy.y);
    ellipse(ctx, 0, 4, cavalry ? 10 : 6.5 * scale, 3.5 * scale, '#403c343b');
    if (enemy.slowTime > 0) {
      ctx.strokeStyle = '#b0d7c38c'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.ellipse(0, 4, 9 * scale, 4 * scale, 0, 0, Math.PI * 2); ctx.stroke();
    }
    ctx.scale(scale, scale); ctx.translate(0, bob);
    if (cavalry) {
      ctx.fillStyle = '#72503e'; roundedRect(ctx, -9, -4, 18, 8, 3); ctx.fill();
      ellipse(ctx, 6, -5, 4, 4, '#825c43');
      ctx.strokeStyle = '#4b3930'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(-6, 2); ctx.lineTo(-7, 6); ctx.moveTo(6, 2); ctx.lineTo(6, 6); ctx.stroke();
    }
    const body = enemy.hitFlash > 0 ? '#eac49c' : armor ? '#535951' : '#9b4438';
    ctx.fillStyle = '#343c34'; ctx.fillRect(-4, -1, 3, 5); ctx.fillRect(1, -1, 3, 5);
    ctx.fillStyle = body; roundedRect(ctx, -5, -11, 10, 12, 2); ctx.fill();
    if (armor || boss) {
      ctx.strokeStyle = '#c2b393'; ctx.lineWidth = 0.7;
      for (let y = -8; y < 0; y += 3) { ctx.beginPath(); ctx.moveTo(-4, y); ctx.lineTo(4, y); ctx.stroke(); }
      ctx.fillStyle = '#9b4438'; ctx.fillRect(-5, -10, 10, 3);
    }
    ellipse(ctx, 0, -14, 4, 3.7, '#d2ac83');
    ctx.fillStyle = armor || boss ? '#4e5049' : '#934237';
    ctx.beginPath(); ctx.moveTo(-5, -15); ctx.quadraticCurveTo(-4, -22, 0, -19); ctx.quadraticCurveTo(4, -22, 5, -15); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = '#cca46e'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(-5, -15); ctx.lineTo(5, -15); ctx.stroke();
    ctx.fillStyle = '#3d3931'; ctx.fillRect(-1, -14, 2, 1);
    if (boss) {
      ctx.fillStyle = '#b94637'; ctx.beginPath(); ctx.moveTo(0, -19); ctx.quadraticCurveTo(10, -30, 9, -22); ctx.quadraticCurveTo(3, -24, 2, -19); ctx.fill();
      ctx.strokeStyle = '#d5b367'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(10, -22); ctx.lineTo(10, 5); ctx.stroke();
      ctx.fillStyle = '#b8bea6'; ctx.beginPath(); ctx.moveTo(10, -22); ctx.lineTo(19, -18); ctx.lineTo(10, -14); ctx.fill();
    } else if (armor) {
      ctx.fillStyle = '#6c7061'; roundedRect(ctx, -8, -7, 7, 11, 1); ctx.fill(); ctx.strokeStyle = '#d3c69c'; ctx.stroke();
    } else {
      ctx.strokeStyle = '#675242'; ctx.lineWidth = 1.3; ctx.beginPath(); ctx.moveTo(7, -20); ctx.lineTo(7, 3); ctx.stroke();
      ctx.fillStyle = '#d7d1b6'; ctx.beginPath(); ctx.moveTo(7, -24); ctx.lineTo(5, -19); ctx.lineTo(9, -19); ctx.closePath(); ctx.fill();
      if ((Number(enemy.id) || 0) % 4 === 0) {
        ctx.fillStyle = '#b34d3d'; ctx.beginPath(); ctx.moveTo(7, -19); ctx.lineTo(16, -17); ctx.lineTo(7, -12); ctx.closePath(); ctx.fill();
      }
    }
    ctx.restore();
    if (boss || armor && enemy.hp < enemy.maxHp || enemy.hitFlash > 0) {
      const width = boss ? 40 : 19;
      const y = enemy.y - (boss ? 40 : armor ? 29 : 25);
      ctx.fillStyle = '#283a32de'; roundedRect(ctx, enemy.x - width / 2 - 1, y - 1, width + 2, boss ? 6 : 4, 2); ctx.fill();
      ctx.fillStyle = boss ? '#e2ac5c' : '#ce755a'; roundedRect(ctx, enemy.x - width / 2, y, Math.max(0.1, width * enemy.hp / enemy.maxHp), boss ? 4 : 2, 1); ctx.fill();
      if (boss) label(ctx, '敌将', enemy.x, y - 5, { size: 11, padding: 4, color: '#f2d6a0', background: '#5e342ced' });
    }
  }

  drawPreview(ctx) {
    ctx.save(); ctx.globalAlpha = 0.7;
    for (let i = 0; i < 10; i++) {
      const side = i % 2 ? 1 : -1;
      this.drawEnemy(ctx, { id: i, x: 210 + side * 106 + (i % 3 - 1) * 9, y: 34 + Math.floor(i / 2) * 28, hp: 1, maxHp: 1, type: 'infantry' }, 0);
    }
    ctx.restore();
  }

  drawHero(ctx, time, ready, casting) {
    ctx.save(); ctx.translate(210, 552);
    if (ready || casting) {
      const glow = this.reducedMotion ? 0.3 : 0.28 + Math.sin(time * 4) * 0.08;
      ellipse(ctx, 0, -1, 31, 16, `rgba(135, 237, 180, ${glow})`);
      ctx.strokeStyle = '#b6f6cdb3'; ctx.lineWidth = 1.4;
      ctx.beginPath(); ctx.ellipse(0, -1, 27, 13, 0, 0, Math.PI * 2); ctx.stroke();
    }
    ellipse(ctx, 0, 7, 15, 6, '#152d2b85');
    // Guan Yu: green robe, red face, long beard, and a crescent blade.
    ctx.fillStyle = '#164d42';
    ctx.beginPath(); ctx.moveTo(-9, -14); ctx.lineTo(8, -14); ctx.lineTo(13, 7); ctx.lineTo(-14, 7); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#3e9873'; ctx.beginPath(); ctx.moveTo(-7, -13); ctx.lineTo(5, -13); ctx.lineTo(7, 5); ctx.lineTo(-10, 5); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = '#d5bc78'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(-7, -8); ctx.lineTo(7, -8); ctx.moveTo(-8, 0); ctx.lineTo(9, 0); ctx.stroke();
    ellipse(ctx, 0, -20, 6, 7, '#a84f3c');
    ctx.fillStyle = '#246049'; ctx.beginPath(); ctx.moveTo(-7, -23); ctx.lineTo(-4, -30); ctx.lineTo(6, -28); ctx.lineTo(7, -22); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#d2bb74'; ctx.fillRect(-6, -23, 12, 2);
    ctx.strokeStyle = '#252e27'; ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.moveTo(-4, -19); ctx.lineTo(-1, -20); ctx.moveTo(1, -20); ctx.lineTo(4, -19); ctx.stroke();
    ctx.fillStyle = '#202e27'; ctx.beginPath(); ctx.moveTo(-5, -16); ctx.lineTo(5, -16); ctx.quadraticCurveTo(6, -7, 1, -1); ctx.quadraticCurveTo(-5, -6, -5, -16); ctx.fill();
    ctx.strokeStyle = '#5f7160'; ctx.lineWidth = 0.7; ctx.beginPath(); ctx.moveTo(0, -14); ctx.lineTo(1, -5); ctx.stroke();
    ctx.save(); ctx.translate(13, -5); ctx.rotate(casting && !this.reducedMotion ? -0.7 : 0.18);
    ctx.strokeStyle = '#785c39'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(0, 17); ctx.lineTo(0, -34); ctx.stroke();
    ctx.strokeStyle = '#dcc985'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(-1, 16); ctx.lineTo(-1, -33); ctx.stroke();
    ctx.fillStyle = '#b4e1cd'; ctx.beginPath(); ctx.moveTo(0, -35); ctx.quadraticCurveTo(20, -40, 16, -21); ctx.quadraticCurveTo(9, -30, 0, -27); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = '#efffe7'; ctx.lineWidth = 1.3; ctx.beginPath(); ctx.moveTo(0, -35); ctx.quadraticCurveTo(20, -40, 16, -21); ctx.stroke();
    ctx.fillStyle = '#b34136'; ctx.beginPath(); ctx.moveTo(0, -24); ctx.lineTo(8, -19); ctx.lineTo(6, -8); ctx.lineTo(2, -18); ctx.closePath(); ctx.fill();
    ctx.restore();
    label(ctx, '关羽', 0, 36, { size: 11, color: '#f0d99a', background: '#153d34ed', padding: 9 });
    ctx.restore();
  }

  drawProjectile(ctx, projectile) {
    const angle = Math.atan2((projectile.targetY ?? projectile.y) - projectile.y, (projectile.targetX ?? projectile.x) - projectile.x);
    ctx.save(); ctx.translate(projectile.x, projectile.y); ctx.rotate(angle);
    if (projectile.type === 'stone') {
      ellipse(ctx, -3, 6, 5, 2, '#2d392936');
      ellipse(ctx, 0, 0, projectile.radius || 4, projectile.radius || 4, '#ddd3b0');
      ellipse(ctx, -1, -1, 2, 2, '#9c9d83');
    } else if (projectile.type === 'hero') {
      ctx.strokeStyle = '#bffad4'; ctx.lineWidth = 3; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(-11, -7); ctx.quadraticCurveTo(8, 0, -11, 7); ctx.stroke();
      ctx.strokeStyle = '#5dcbaa77'; ctx.lineWidth = 7; ctx.stroke();
    } else {
      ctx.strokeStyle = '#594937'; ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.moveTo(-8, 0); ctx.lineTo(3, 0); ctx.stroke();
      ctx.fillStyle = '#f7e7bd'; ctx.beginPath(); ctx.moveTo(5, 0); ctx.lineTo(0, -2); ctx.lineTo(0, 2); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = '#efdcaa'; ctx.beginPath(); ctx.moveTo(-7, -2); ctx.lineTo(-5, 0); ctx.lineTo(-7, 2); ctx.stroke();
    }
    ctx.restore();
  }

  drawEffect(ctx, effect) {
    const ratio = Math.max(0, Math.min(1, effect.life / (effect.maxLife || effect.duration || 0.5)));
    if (effect.type === 'ultimate') {
      this.drawBladeWave(ctx, effect, ratio); return;
    }
    ctx.save(); ctx.translate(effect.x || 0, effect.y || 0); ctx.globalAlpha = ratio;
    if (effect.type === 'shield') {
      ctx.strokeStyle = '#a2d4b947'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(0, 0, (effect.radius || 80) * (0.9 + (1 - ratio) * 0.1), 0, Math.PI * 2); ctx.stroke();
      ctx.strokeStyle = '#e0dda19c'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(0, 0, 20 + (1 - ratio) * 12, -Math.PI / 3, Math.PI / 3); ctx.stroke();
    } else if (effect.type === 'upgrade') {
      const rise = this.reducedMotion ? 0 : (1 - ratio) * 20;
      ctx.strokeStyle = '#e7d99f'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.ellipse(0, 0, 22 + (1 - ratio) * 15, 14 + (1 - ratio) * 10, 0, 0, Math.PI * 2); ctx.stroke();
      label(ctx, '军阵强化', 0, -32 - rise, { size: 11, color: '#ffe5a4', background: '#274638ef' });
    } else if (effect.type === 'gateHit') {
      ctx.strokeStyle = '#e5916b'; ctx.lineWidth = 4 * ratio;
      ctx.beginPath(); ctx.arc(0, 0, 15 + (1 - ratio) * (effect.radius || 52), Math.PI, Math.PI * 2); ctx.stroke();
    } else if (effect.type === 'pierce') {
      ctx.rotate(effect.angle || -Math.PI / 2); ctx.strokeStyle = '#f3e7b2'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(-12, 0); ctx.lineTo(18, 0); ctx.stroke();
    } else if (effect.type === 'explosion') {
      const radius = 8 + (1 - ratio) * (effect.radius || 28);
      ctx.strokeStyle = '#f4cd86'; ctx.lineWidth = 2 * ratio;
      ctx.beginPath(); ctx.arc(0, 0, radius, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = '#e7b56244'; ctx.beginPath(); ctx.arc(0, 0, radius * 0.7, 0, Math.PI * 2); ctx.fill();
      for (let i = 0; i < 6; i++) { const a = i * Math.PI / 3; ellipse(ctx, Math.cos(a) * radius, Math.sin(a) * radius * 0.7, 2, 2, '#ece3bd'); }
    } else if (effect.type === 'death') {
      const spread = (1 - ratio) * 18;
      ctx.fillStyle = '#b36c50';
      for (let i = 0; i < 4; i++) { const a = i * 1.7 + (effect.id || 0); ctx.fillRect(Math.cos(a) * spread, Math.sin(a) * spread - 5, 3, 3); }
      ctx.strokeStyle = '#c9d8a4'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(-spread, 0); ctx.lineTo(spread, -8); ctx.stroke();
    } else if (effect.type === 'heroSlash') {
      ctx.rotate(effect.angle || -Math.PI / 2); ctx.strokeStyle = '#bdf4cc'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(-8, -18); ctx.quadraticCurveTo(19, 0, -8, 18); ctx.stroke();
    } else {
      ctx.strokeStyle = '#f4df9f'; ctx.lineWidth = 1.5;
      for (let i = 0; i < 4; i++) { const angle = Math.PI * i / 2 + 0.4; ctx.beginPath(); ctx.moveTo(Math.cos(angle) * 2, Math.sin(angle) * 2 - 7); ctx.lineTo(Math.cos(angle) * 8, Math.sin(angle) * 8 - 7); ctx.stroke(); }
    }
    ctx.restore();
  }

  drawBladeWave(ctx, effect, ratio, { opacity = 1, trailOnly = false } = {}) {
    const width = effect.width || 180;
    const front = effect.front || 0;
    ctx.save(); ctx.translate(effect.originX ?? 210, effect.originY ?? 550); ctx.rotate(effect.angle ?? -Math.PI / 2);
    ctx.globalAlpha *= Math.min(0.9, 0.5 + ratio * 0.5) * opacity;
    const trail = ctx.createLinearGradient(front - 100, 0, front + 10, 0);
    trail.addColorStop(0, '#71e2bd00'); trail.addColorStop(0.8, '#71e2bd70'); trail.addColorStop(1, '#daffdeb3');
    ctx.fillStyle = trail;
    ctx.beginPath(); ctx.moveTo(front - 100, -width * 0.42); ctx.quadraticCurveTo(front + 42, -width * 0.7, front + 31, 0); ctx.quadraticCurveTo(front + 42, width * 0.7, front - 100, width * 0.42); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = '#55c9a782'; ctx.lineWidth = 12;
    ctx.beginPath(); ctx.moveTo(front - 24, -width / 2); ctx.quadraticCurveTo(front + 70, 0, front - 24, width / 2); ctx.stroke();
    ctx.strokeStyle = '#d6ffdf'; ctx.lineWidth = 4;
    ctx.beginPath(); ctx.moveTo(front - 24, -width / 2); ctx.quadraticCurveTo(front + 70, 0, front - 24, width / 2); ctx.stroke();
    if (!trailOnly) { ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 1.2; ctx.stroke(); }
    if (!this.reducedMotion && !trailOnly) {
      ctx.strokeStyle = '#aef0c5a8'; ctx.lineWidth = 1.5;
      for (let i = 0; i < 6; i++) { const y = (i / 5 - 0.5) * width * 0.9; ctx.beginPath(); ctx.moveTo(front - 85 + i % 2 * 20, y); ctx.lineTo(front - 35, y); ctx.stroke(); }
    }
    ctx.restore();
  }

  drawDanger(ctx, time) {
    ctx.save();
    const alpha = this.reducedMotion ? 0.14 : 0.1 + Math.sin(time * 4) * 0.06;
    const gradient = ctx.createLinearGradient(0, 440, 0, 600);
    gradient.addColorStop(0, '#b5453200'); gradient.addColorStop(1, `rgba(160, 38, 30, ${alpha})`);
    ctx.fillStyle = gradient; ctx.fillRect(0, 440, 420, 160);
    ctx.restore();
  }

  drawUltimateFeedback(ctx, age) {
    ctx.save();
    if (age < 0.14 && !this.reducedMotion) {
      ctx.globalAlpha = (1 - age / 0.14) * 0.18; ctx.fillStyle = '#e6ffe0'; ctx.fillRect(0, 0, 420, 600);
    }
    ctx.globalAlpha = Math.min(1, Math.max(0, (1.7 - age) / 0.45));
    if (age < 0.7) {
      ctx.font = '700 30px "KaiTi", "STKaiti", serif'; ctx.textAlign = 'center';
      ctx.shadowColor = '#153c30'; ctx.shadowBlur = 7; ctx.shadowOffsetY = 2;
      ctx.fillStyle = '#e6f8c4'; ctx.fillText('青龙偃月', 210, 235);
      ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;
    }
    ctx.restore();
  }
}

export { CAMP_SLOTS, WORLD_WIDTH, WORLD_HEIGHT };
