/** Pure, deterministic-friendly combat simulation. Coordinates use a 420 × 600 field. */
export const CAMP_TYPES = Object.freeze({
  shield: { name: '盾营', cost: 60, description: '拦截减速，聚敌成阵', range: 145, damage: 8, interval: 1.1 },
  archer: { name: '弓营', cost: 60, description: '远程齐射，持续杀伤', range: 205, damage: 12, interval: 0.9 },
  catapult: { name: '投石营', cost: 60, description: '投石爆破，打击密集敌群', range: 205, damage: 24, interval: 1.9 },
});

export const UPGRADES = Object.freeze([
  { id: 'archer_pierce', camp: 'archer', name: '穿云箭', description: '弓箭命中后贯穿前方最多 2 名敌军。' },
  { id: 'archer_volley', camp: 'archer', name: '连珠齐射', description: '弓营每轮额外射出一支箭。' },
  { id: 'archer_hunt', camp: 'archer', name: '破骑劲弩', description: '弓营对骑兵、重甲及首领伤害提高 65%。' },
  { id: 'shield_grasp', camp: 'shield', name: '坚壁铁阵', description: '盾营减速效果加强，更容易聚集敌潮。' },
  { id: 'shield_reach', camp: 'shield', name: '连营拒马', description: '盾营拦截与攻击范围扩大 35。' },
  { id: 'shield_break', camp: 'shield', name: '破阵反击', description: '盾营每次攻击最多 5 人，伤害提高 35%。' },
  { id: 'catapult_blast', camp: 'catapult', name: '霹雳巨石', description: '投石爆炸半径扩大 22，伤害提高 15%。' },
  { id: 'catapult_shock', camp: 'catapult', name: '碎石封路', description: '投石命中的敌军减速 3 秒。' },
  { id: 'catapult_siege', camp: 'catapult', name: '摧城破甲', description: '投石对重甲及首领的伤害提高 70%。' },
]);

export const SLOT_POSITIONS = Object.freeze([
  { x: 53, y: 142 }, { x: 367, y: 142 },
  { x: 67, y: 290 }, { x: 353, y: 290 },
  { x: 88, y: 420 }, { x: 332, y: 420 },
]);

const PATHS = [
  [{ x: 105, y: -16 }, { x: 100, y: 145 }, { x: 210, y: 300 }, { x: 210, y: 530 }],
  [{ x: 315, y: -16 }, { x: 320, y: 145 }, { x: 210, y: 300 }, { x: 210, y: 530 }],
];
const SEGMENTS = PATHS.map(path => path.slice(1).map((point, i) => Math.hypot(point.x - path[i].x, point.y - path[i].y)));
const PATH_LENGTH = SEGMENTS[0].reduce((a, b) => a + b, 0);
const HERO = { x: 210, y: 550, range: 152 };
const WAVE_COUNTS = [38, 48, 62, 74, 82, 94, 106, 114];
const WAVE_DURATIONS = [11, 13, 15, 17, 18, 19, 21, 24];
const ENEMY_BASE = {
  infantry: { hp: 28, speed: 30, radius: 7, reward: 1, leak: 3 },
  cavalry: { hp: 43, speed: 46, radius: 9, reward: 3, leak: 5 },
  armor: { hp: 110, speed: 23, radius: 11, reward: 6, leak: 8 },
  boss: { hp: 1900, speed: 11, radius: 21, reward: 80, leak: 45 },
};
const dist2 = (a, b) => (a.x - b.x) ** 2 + (a.y - b.y) ** 2;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

export class Game {
  constructor({ onEvent = () => {}, rng = Math.random } = {}) {
    this.onEvent = typeof onEvent === 'function' ? onEvent : () => {};
    this.rng = typeof rng === 'function' ? rng : Math.random;
    this.reset();
  }

  reset() {
    this.state = 'ready';
    this.time = 0;
    this.wave = 1;
    this.waveCount = 8;
    this.maxHp = 100;
    this.hp = this.maxHp;
    this.maxRage = 100;
    this.rage = 40;
    this.rageRecovery = 0;
    this.food = 120;
    this.kills = 0;
    this.bestBurst = 0;
    this.enemies = [];
    this.camps = Array(6).fill(null);
    this.projectiles = [];
    this.effects = [];
    this.upgradeChoices = [];
    this.selectedUpgrades = [];
    this.currentBurst = null;
    this.ultimateTarget = { x: 210, y: 275, angle: -Math.PI / 2, width: 184, length: 610, count: 0 };
    this.heroCooldown = 0;
    this.stats = { casts: 0, ultimates: 0, ultimateKills: 0, damage: 0, damageTaken: 0, foodEarned: 0, foodSpent: 0, escaped: 0, maxEnemies: 0 };
    this._nextId = 1;
    this._modifiers = new Set();
    this._spawnQueue = [];
    this._waveTime = 0;
    this._waveSpawned = 0;
    this._waveCompleted = false;
    this._betweenWaves = 0;
    this._makeCamp(4, 'shield');
    this._makeCamp(2, 'archer');
    return { ok: true };
  }

  start() {
    if (this.state !== 'ready') return { ok: false, reason: '战斗已经开始' };
    this.state = 'playing';
    this._beginWave(1);
    this._emit('start');
    return { ok: true };
  }

  pause() {
    if (this.state !== 'playing') return { ok: false, reason: '当前无法暂停' };
    this.state = 'paused';
    this._emit('pause');
    return { ok: true };
  }

  resume() {
    if (this.state !== 'paused') return { ok: false, reason: '当前没有暂停' };
    this.state = 'playing';
    this._emit('resume');
    return { ok: true };
  }

  build(slot, type) {
    if (this.state !== 'playing') return { ok: false, reason: '战斗中才能建造' };
    if (!Number.isInteger(slot) || slot < 0 || slot >= this.camps.length) return { ok: false, reason: '无效营位' };
    if (!Object.hasOwn(CAMP_TYPES, type)) return { ok: false, reason: '无效军阵' };
    if (this.camps[slot]) return { ok: false, reason: '营位已有军阵' };
    const cost = CAMP_TYPES[type].cost;
    if (this.food < cost) return { ok: false, reason: `需要 ${cost} 军粮` };
    this.food -= cost;
    this.stats.foodSpent += cost;
    const camp = this._makeCamp(slot, type);
    this._emit('build', { slot, camp, cost });
    return { ok: true, camp };
  }

  getUpgradeCost(slot) {
    const camp = this.camps[slot];
    return camp && camp.level < 3 ? (camp.level === 1 ? 60 : 100) : null;
  }

  upgrade(slot) {
    if (this.state !== 'playing') return { ok: false, reason: '战斗中才能升级' };
    if (!Number.isInteger(slot) || !this.camps[slot]) return { ok: false, reason: '请先建造军阵' };
    const camp = this.camps[slot];
    const cost = this.getUpgradeCost(slot);
    if (cost === null) return { ok: false, reason: '军阵已满级' };
    if (this.food < cost) return { ok: false, reason: `需要 ${cost} 军粮` };
    this.food -= cost;
    this.stats.foodSpent += cost;
    camp.level += 1;
    camp.range = this._campRange(camp);
    camp.cooldown = Math.min(camp.cooldown, 0.15);
    this._addEffect('upgrade', { x: camp.x, y: camp.y, life: 0.7, level: camp.level });
    this._emit('upgrade', { slot, camp, cost });
    return { ok: true, camp };
  }

  selectUpgrade(id) {
    if (this.state !== 'choosing') return { ok: false, reason: '当前没有战术选择' };
    const choice = this.upgradeChoices.find(item => item.id === id);
    if (!choice) return { ok: false, reason: '请选择当前提供的战术' };
    this._modifiers.add(id);
    this.selectedUpgrades.push({ ...choice });
    for (const camp of this.camps) if (camp) camp.range = this._campRange(camp);
    this.upgradeChoices = [];
    this.state = 'playing';
    this._betweenWaves = 1.8;
    this._emit('tactic', { upgrade: choice });
    return { ok: true };
  }

  castUltimate() {
    if (this.state !== 'playing') return { ok: false, reason: '战斗中才能释放无双' };
    if (this.rage < this.maxRage) return { ok: false, reason: '怒气尚未蓄满' };
    if (this.currentBurst?.life > 0) return { ok: false, reason: '无双正在释放' };
    const target = this._findUltimateTarget();
    const id = this._nextId++;
    this.rage = 0;
    this.rageRecovery = 6;
    this.stats.casts += 1;
    this.stats.ultimates += 1;
    this.currentBurst = { id, kills: 0, count: 0, life: 0.76, duration: 0.76, angle: target.angle, width: target.width, length: target.length, targetX: target.x, targetY: target.y };
    this._addEffect('ultimate', { x: HERO.x, y: HERO.y, originX: HERO.x, originY: HERO.y, angle: target.angle, width: target.width, length: target.length, front: 0, life: 0.76, burstId: id });
    this._emit('ultimate', { burstId: id, x: target.x, y: target.y, angle: target.angle, width: target.width, length: target.length, kills: 0, count: 0 });
    return { ok: true, target };
  }

  /** Fixed internal steps preserve collisions, spawn order and resource rates for large dt. */
  update(dt) {
    if (!Number.isFinite(dt) || dt < 0) return { ok: false, reason: '无效时间步长' };
    if (this.state !== 'playing' || dt === 0) return { ok: true };
    let remaining = dt;
    while (remaining > 1e-8 && this.state === 'playing') {
      const step = Math.min(remaining, 0.05);
      this._step(step);
      remaining -= step;
    }
    return { ok: true };
  }

  _step(dt) {
    this.time += dt;
    this._tickSpawns(dt);
    if (this.state !== 'playing') return;
    this.heroCooldown = Math.max(0, this.heroCooldown - dt);
    for (const enemy of this.enemies) {
      enemy.hitFlash = Math.max(0, (enemy.hitFlash || 0) - dt);
      enemy.slowTime = Math.max(0, (enemy.slowTime || 0) - dt);
      let slow = enemy.slowTime > 0 ? 0.55 : 1;
      for (const camp of this.camps) {
        if (!camp || camp.type !== 'shield' || dist2(camp, enemy) > camp.range ** 2) continue;
        let factor = this._modifiers.has('shield_grasp') ? 0.38 : 0.56;
        if (enemy.type === 'armor') factor = 1 - (1 - factor) * 0.7;
        if (enemy.type === 'boss') factor = 1 - (1 - factor) * 0.4;
        slow = Math.min(slow, factor);
      }
      enemy.slow = slow;
      enemy.progress += enemy.speed * slow * dt;
      this._positionEnemy(enemy);
      if (enemy.progress >= PATH_LENGTH && enemy.hp > 0) this._escape(enemy);
    }
    this.enemies = this.enemies.filter(enemy => enemy.hp > 0 && !enemy.escaped);
    if (this.hp <= 0) {
      this._finish('lost');
      return;
    }

    let engaged = false;
    for (const camp of this.camps) {
      if (!camp) continue;
      camp.cooldown = Math.max(0, camp.cooldown - dt);
      const targets = this.enemies.filter(enemy => enemy.hp > 0 && dist2(camp, enemy) <= camp.range ** 2).sort((a, b) => b.progress - a.progress);
      if (!targets.length) continue;
      engaged = true;
      if (camp.cooldown > 0) continue;
      this._attackCamp(camp, targets);
    }
    const heroTargets = this.enemies.filter(enemy => enemy.hp > 0 && dist2(HERO, enemy) <= HERO.range ** 2).sort((a, b) => b.progress - a.progress);
    if (heroTargets.length) {
      engaged = true;
      if (this.heroCooldown <= 0) {
        this.heroCooldown = 1.05;
        for (const enemy of heroTargets.slice(0, 2)) this._damage(enemy, 17, 'hero');
        this._addEffect('heroSlash', { x: HERO.x, y: HERO.y - 42, life: 0.24, angle: -Math.PI / 2, radius: HERO.range });
      }
    }

    this._tickProjectiles(dt);
    this._tickUltimate(dt);
    this.enemies = this.enemies.filter(enemy => enemy.hp > 0 && !enemy.escaped);
    this._tickEffects(dt);
    if (this.rageRecovery > 0) {
      const blocked = Math.min(dt, this.rageRecovery);
      this.rageRecovery = Math.max(0, this.rageRecovery - dt);
      this.rage = Math.min(this.maxRage, this.rage + (dt - blocked) * (engaged ? 4 : 1));
    } else this.rage = Math.min(this.maxRage, this.rage + dt * (engaged ? 4 : 1));
    this.ultimateTarget = this._findUltimateTarget();
    this.stats.maxEnemies = Math.max(this.stats.maxEnemies, this.enemies.length);
    this._checkWaveComplete();
  }

  _makeCamp(slot, type) {
    const camp = { id: this._nextId++, slot, type, level: 1, cooldown: 0.15, ...SLOT_POSITIONS[slot], range: CAMP_TYPES[type].range };
    this.camps[slot] = camp;
    return camp;
  }

  _campRange(camp) {
    return CAMP_TYPES[camp.type].range + (camp.level - 1) * 9 + (camp.type === 'shield' && this._modifiers.has('shield_reach') ? 35 : 0);
  }

  _beginWave(number) {
    this.wave = number;
    this._waveTime = 0;
    this._waveSpawned = 0;
    this._waveCompleted = false;
    this._spawnQueue = [];
    const count = WAVE_COUNTS[number - 1];
    const duration = WAVE_DURATIONS[number - 1];
    for (let i = 0; i < count; i++) {
      let type = 'infantry';
      if (number >= 3 && i % 11 === 7) type = 'cavalry';
      if (number >= 4 && i % 15 === 10) type = 'armor';
      this._spawnQueue.push({ at: 0.3 + duration * i / Math.max(1, count - 1), type, side: (i + Math.floor(i / 7) + number) % 2 });
    }
    if (number === this.waveCount) {
      this._spawnQueue.push({ at: 3.5, type: 'boss', side: 0 });
      this._spawnQueue.sort((a, b) => a.at - b.at);
    }
    this._emit('wave', { wave: number, total: this.waveCount, count: this._spawnQueue.length, boss: number === this.waveCount });
  }

  _tickSpawns(dt) {
    if (this._waveCompleted) {
      this._betweenWaves = Math.max(0, this._betweenWaves - dt);
      if (this._betweenWaves <= 0) this._beginWave(this.wave + 1);
      return;
    }
    this._waveTime += dt;
    while (this._spawnQueue.length && this._spawnQueue[0].at <= this._waveTime) {
      const spawn = this._spawnQueue.shift();
      this._spawnEnemy(spawn.type, spawn.side);
      this._waveSpawned += 1;
    }
  }

  _spawnEnemy(type, pathSide) {
    const base = ENEMY_BASE[type];
    const hp = type === 'boss' ? base.hp : base.hp + (this.wave - 1) * (type === 'armor' ? 9 : 3);
    const enemy = { id: this._nextId++, type, x: PATHS[pathSide][0].x, y: -16, hp, maxHp: hp, speed: base.speed * (1 + (this.wave - 1) * 0.008), progress: 0, pathSide, radius: base.radius, laneOffset: (this.rng() - 0.5) * (type === 'boss' ? 4 : 34), slow: 1, slowTime: 0, hitFlash: 0, reward: base.reward, leak: base.leak, rewarded: false, escaped: false };
    this._positionEnemy(enemy);
    this.enemies.push(enemy);
    this._emit('spawn', { enemy });
  }

  _positionEnemy(enemy) {
    const side = enemy.pathSide === 1 ? 1 : 0;
    const path = PATHS[side];
    let progress = Math.max(0, enemy.progress);
    let segment = 0;
    while (segment < SEGMENTS[side].length - 1 && progress > SEGMENTS[side][segment]) {
      progress -= SEGMENTS[side][segment];
      segment += 1;
    }
    const length = SEGMENTS[side][segment];
    const t = clamp(progress / length, 0, 1);
    const start = path[segment];
    const end = path[segment + 1];
    const offset = enemy.laneOffset || 0;
    enemy.x = start.x + (end.x - start.x) * t + (end.y - start.y) / length * offset;
    enemy.y = start.y + (end.y - start.y) * t - (end.x - start.x) / length * offset;
    enemy.facing = Math.atan2(end.y - start.y, end.x - start.x);
  }

  _attackCamp(camp, targets) {
    const base = CAMP_TYPES[camp.type];
    camp.cooldown = base.interval * [1, 0.83, 0.69][camp.level - 1];
    const damage = base.damage * [1, 1.7, 2.65][camp.level - 1];
    camp.attackFlash = 0.12;
    if (camp.type === 'shield') {
      const improved = this._modifiers.has('shield_break');
      for (const target of targets.slice(0, improved ? 5 : 3)) this._damage(target, damage * (improved ? 1.35 : 1), 'shield');
      this._addEffect('shield', { x: camp.x, y: camp.y, radius: camp.range, life: 0.2 });
      return;
    }
    const volleys = camp.type === 'archer' && this._modifiers.has('archer_volley') ? 2 : 1;
    for (let i = 0; i < volleys; i++) {
      const target = targets[i % targets.length];
      this.projectiles.push({ id: this._nextId++, type: camp.type === 'archer' ? 'arrow' : 'stone', x: camp.x, y: camp.y, fromX: camp.x, fromY: camp.y, targetId: target.id, targetX: target.x, targetY: target.y, damage, speed: camp.type === 'archer' ? 390 : 225, radius: camp.type === 'archer' ? 2 : 6, campType: camp.type, life: 2.8, pierce: camp.type === 'archer' && this._modifiers.has('archer_pierce') });
    }
  }

  _tickProjectiles(dt) {
    const remaining = [];
    for (const projectile of this.projectiles) {
      projectile.life -= dt;
      const target = this.enemies.find(enemy => enemy.id === projectile.targetId && enemy.hp > 0);
      if (target) {
        projectile.targetX = target.x;
        projectile.targetY = target.y;
      }
      const dx = projectile.targetX - projectile.x;
      const dy = projectile.targetY - projectile.y;
      const distance = Math.hypot(dx, dy);
      if (distance <= projectile.speed * dt + 2) {
        if (projectile.type === 'stone') {
          const blast = 48 + (this._modifiers.has('catapult_blast') ? 22 : 0);
          this._addEffect('explosion', { x: projectile.targetX, y: projectile.targetY, radius: blast, life: 0.42 });
          for (const enemy of this.enemies) {
            if (enemy.hp <= 0 || (enemy.x - projectile.targetX) ** 2 + (enemy.y - projectile.targetY) ** 2 > blast ** 2) continue;
            let amount = projectile.damage * (this._modifiers.has('catapult_blast') ? 1.15 : 1);
            if (this._modifiers.has('catapult_siege') && (enemy.type === 'armor' || enemy.type === 'boss')) amount *= 1.7;
            if (this._modifiers.has('catapult_shock')) enemy.slowTime = Math.max(enemy.slowTime || 0, 3);
            this._damage(enemy, amount, 'catapult');
          }
        } else if (target) {
          this._damage(target, this._arrowDamage(projectile.damage, target), 'archer');
          if (projectile.pierce) {
            const aimX = projectile.targetX - projectile.fromX;
            const aimY = projectile.targetY - projectile.fromY;
            const aimLength = Math.hypot(aimX, aimY) || 1;
            const ux = aimX / aimLength;
            const uy = aimY / aimLength;
            const pierced = this.enemies.filter(enemy => {
              if (enemy.id === target.id || enemy.hp <= 0) return false;
              const ex = enemy.x - projectile.targetX;
              const ey = enemy.y - projectile.targetY;
              const along = ex * ux + ey * uy;
              return along >= -14 && along <= 125 && Math.abs(ex * uy - ey * ux) <= 25;
            }).sort((a, b) => dist2(a, target) - dist2(b, target)).slice(0, 2);
            for (const enemy of pierced) this._damage(enemy, this._arrowDamage(projectile.damage * 0.8, enemy), 'archer');
            this._addEffect('pierce', { x: projectile.targetX, y: projectile.targetY, angle: Math.atan2(uy, ux), life: 0.2 });
          }
        }
      } else if (projectile.life > 0) {
        projectile.x += dx / distance * projectile.speed * dt;
        projectile.y += dy / distance * projectile.speed * dt;
        remaining.push(projectile);
      }
    }
    this.projectiles = remaining;
  }

  _arrowDamage(damage, enemy) {
    return damage * (this._modifiers.has('archer_hunt') && enemy.type !== 'infantry' ? 1.65 : 1);
  }

  _findUltimateTarget() {
    const width = 184;
    const length = 610;
    let best = { x: 210, y: 260, angle: -Math.PI / 2, width, length, count: 0 };
    let bestScore = -1;
    const candidates = [{ x: 210, y: 260 }, ...this.enemies.filter(enemy => enemy.hp > 0).map(enemy => ({ x: enemy.x, y: enemy.y }))];
    for (const point of candidates) {
      // Keep the sweep aimed upward; the two entry roads still require a deliberate direction.
      const angle = clamp(Math.atan2(point.y - HERO.y, point.x - HERO.x), -Math.PI * 0.7, -Math.PI * 0.3);
      const ux = Math.cos(angle);
      const uy = Math.sin(angle);
      let count = 0;
      let score = 0;
      for (const enemy of this.enemies) {
        if (enemy.hp <= 0) continue;
        const dx = enemy.x - HERO.x;
        const dy = enemy.y - HERO.y;
        const along = dx * ux + dy * uy;
        if (along < -10 || along > length || Math.abs(dx * uy - dy * ux) > width / 2 + enemy.radius) continue;
        count += 1;
        score += enemy.type === 'boss' ? 2.5 : enemy.type === 'armor' ? 1.25 : 1;
        score += enemy.progress / PATH_LENGTH * 0.15;
      }
      if (score > bestScore) {
        bestScore = score;
        best = { x: point.x, y: point.y, angle, width, length, count };
      }
    }
    return best;
  }

  _tickUltimate(dt) {
    const burst = this.currentBurst;
    if (!burst || burst.life <= 0) return;
    burst.life = Math.max(0, burst.life - dt);
    const elapsed = burst.duration - burst.life;
    const front = clamp(elapsed / 0.64, 0, 1) * burst.length;
    const ux = Math.cos(burst.angle);
    const uy = Math.sin(burst.angle);
    for (const effect of this.effects) if (effect.type === 'ultimate' && effect.burstId === burst.id) effect.front = front;
    for (const enemy of this.enemies) {
      if (enemy.hp <= 0 || enemy.lastBurstId === burst.id) continue;
      const dx = enemy.x - HERO.x;
      const dy = enemy.y - HERO.y;
      const along = dx * ux + dy * uy;
      if (along < -12 || along > front || Math.abs(dx * uy - dy * ux) > burst.width / 2 + enemy.radius) continue;
      enemy.lastBurstId = burst.id;
      let damage = enemy.type === 'boss' ? 310 : enemy.type === 'armor' ? 85 : enemy.hp + 1;
      this._damage(enemy, damage, 'ultimate');
      if (enemy.hp > 0) {
        enemy.progress = Math.max(0, enemy.progress - (enemy.type === 'boss' ? 6 : 22));
        this._positionEnemy(enemy);
        enemy.slowTime = Math.max(enemy.slowTime || 0, 0.65);
      }
    }
    if (burst.life <= 0) {
      this.bestBurst = Math.max(this.bestBurst, burst.kills);
      this._emit('burst', { burstId: burst.id, kills: burst.kills, count: burst.kills, x: burst.targetX, y: burst.targetY });
    }
  }

  _damage(enemy, amount, source) {
    if (enemy.hp <= 0 || enemy.escaped || !Number.isFinite(amount) || amount <= 0) return;
    const actual = Math.min(enemy.hp, amount);
    enemy.hp = Math.max(0, enemy.hp - amount);
    enemy.hitFlash = 0.12;
    this.stats.damage += actual;
    this._addEffect('hit', { x: enemy.x, y: enemy.y, life: source === 'ultimate' ? 0.25 : 0.13, source, radius: enemy.radius });
    if (enemy.hp > 0) return;
    if (enemy.rewarded) return;
    enemy.rewarded = true;
    const reward = enemy.reward ?? ENEMY_BASE[enemy.type]?.reward ?? 1;
    this.food += reward;
    this.kills += 1;
    this.stats.foodEarned += reward;
    if (source === 'ultimate' && this.currentBurst) {
      this.currentBurst.kills += 1;
      this.currentBurst.count = this.currentBurst.kills;
      this.stats.ultimateKills += 1;
      this.bestBurst = Math.max(this.bestBurst, this.currentBurst.kills);
    }
    this._addEffect('death', { x: enemy.x, y: enemy.y, radius: enemy.radius, enemyType: enemy.type, life: 0.38, source });
    this._emit('kill', { enemyId: enemy.id, enemyType: enemy.type, x: enemy.x, y: enemy.y, source, reward });
  }

  _escape(enemy) {
    if (enemy.escaped || enemy.hp <= 0) return;
    enemy.escaped = true;
    const damage = enemy.leak ?? ENEMY_BASE[enemy.type]?.leak ?? 3;
    this.hp = Math.max(0, this.hp - damage);
    this.stats.damageTaken += damage;
    this.stats.escaped += 1;
    this._addEffect('gateHit', { x: 210, y: 535, life: 0.35, radius: 52 });
    this._emit('hit', { damage, hp: this.hp, enemyType: enemy.type, x: 210, y: 535 });
  }

  _tickEffects(dt) {
    for (const effect of this.effects) effect.life -= dt;
    this.effects = this.effects.filter(effect => effect.life > 0);
    for (const camp of this.camps) if (camp) camp.attackFlash = Math.max(0, (camp.attackFlash || 0) - dt);
  }

  _addEffect(type, data) {
    this.effects.push({ id: this._nextId++, type, maxLife: data.life, ...data });
  }

  _checkWaveComplete() {
    // Finish the sweep and its burst feedback before opening a blocking choice/result panel.
    if (this._waveCompleted || this._spawnQueue.length || this.enemies.length || this.currentBurst?.life > 0) return;
    this._waveCompleted = true;
    this._emit('waveClear', { wave: this.wave });
    if (this.wave === this.waveCount) {
      this._finish('won');
      return;
    }
    if ([2, 4, 6].includes(this.wave)) {
      const campTypes = new Set(this.camps.filter(Boolean).map(camp => camp.type));
      let pool = UPGRADES.filter(upgrade => campTypes.has(upgrade.camp) && !this._modifiers.has(upgrade.id));
      // An empty army is not available through the UI; keep injected test games recoverable.
      if (!pool.length) pool = UPGRADES.filter(upgrade => !this._modifiers.has(upgrade.id));
      for (let i = pool.length - 1; i > 0; i--) {
        const j = Math.floor(clamp(this.rng(), 0, 0.999999) * (i + 1));
        [pool[i], pool[j]] = [pool[j], pool[i]];
      }
      this.upgradeChoices = pool.slice(0, 3).map(upgrade => ({ ...upgrade }));
      if (this.upgradeChoices.length) {
        this.state = 'choosing';
        this._emit('choice', { wave: this.wave, choices: this.upgradeChoices });
        return;
      }
    }
    this._betweenWaves = 1.8;
  }

  _finish(state) {
    if (this.state === 'won' || this.state === 'lost') return;
    if (this.currentBurst?.life > 0) {
      this.currentBurst.life = 0;
      this.bestBurst = Math.max(this.bestBurst, this.currentBurst.kills);
      this._emit('burst', { burstId: this.currentBurst.id, kills: this.currentBurst.kills, count: this.currentBurst.kills, x: this.currentBurst.targetX, y: this.currentBurst.targetY });
    }
    this.state = state;
    this._emit(state === 'won' ? 'win' : 'lose', { time: this.time, kills: this.kills, bestBurst: this.bestBurst, hp: this.hp, stats: { ...this.stats } });
  }

  _emit(type, data = {}) {
    this.onEvent({ type, time: this.time, ...data });
  }
}
