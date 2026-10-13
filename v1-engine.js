import { BALANCE as B, CONTENT } from './runtime-data.js';
import { maximumCircleCoverage, maximumDirectionalCoverage } from './skill-targeting.js';

// All rules below use combat seconds. Rendering and audio never decide a hit.
const EPS = 1e-8;
const STEP = 1 / 60;
const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const okay = (extra = {}) => ({ ok: true, ...extra });
const no = reason => ({ ok: false, reason });
const alive = e => e.hp > 0 && !e.escaped;
const classOf = e => e.class || B.enemies[e.type]?.class || 'ordinary';
const priority = (a, b) => b.progress / b.pathLength - a.progress / a.pathLength || a.id - b.id;
export function seededRandom(seed = 1) {
  let state = seed >>> 0;
  return () => { state = (Math.imul(1664525, state) + 1013904223) >>> 0; return state / 4294967296; };
}

export class V1Game {
  constructor(options = {}) {
    this.options = options;
    this.onEvent = typeof options.onEvent === 'function' ? options.onEvent : () => {};
    this.reset(options);
  }

  reset(options = {}) {
    this.options = { ...this.options, ...options };
    this.level = CONTENT.levels.find(l => l.id === (this.options.levelId || 'wei_001'));
    if (!this.level) throw new Error('Unknown level: ' + this.options.levelId);
    this.map = CONTENT.maps.find(m => m.id === this.level.mapId);
    this.tier = B.stageGrowthTiers.find(t => t.id === this.level.growthTierId);
    this.difficulty = B.difficultyProfiles[this.level.difficultyProfileId] || B.difficultyProfiles.normal;
    this.rng = this.options.rng || seededRandom(this.level.seed);
    this.paths = this.map.paths.map((points, i) => {
      const lengths = points.slice(1).map((p, j) => dist(p, points[j]));
      return { id: 'route_' + i, points, lengths, length: lengths.reduce((a, b) => a + b, 0) };
    });
    this.unlockedCamps = [...new Set(this.options.unlockedCamps || CONTENT.initialCampTypes)].filter(id => B.camps[id]);
    this.availableCamps = this.unlockedCamps;
    const technology = B.technology;
    this.campTech = Object.freeze(Object.fromEntries(Object.keys(B.camps).map(id => {
      const value = Number(this.options.campTech?.[id]);
      return [id, clamp(Number.isFinite(value) ? Math.floor(value) : 0, 0, technology?.camps[id]?.levelMax || 10)];
    })));
    this._campStatTable = Object.fromEntries(Object.entries(B.camps).map(([id, definition]) => {
      const bonuses = technology?.camps[id]?.perLevelBonuses || {};
      const level = this.campTech[id];
      const damageBonus = Math.min(technology?.damageBonusCap ?? .25, level * (bonuses.damage || 0));
      const rangeBonus = Math.min(technology?.rangeBonusCap ?? 15, level * (bonuses.range || 0));
      return [id, definition.levels.map(base => ({ ...base, range: base.range + rangeBonus,
        ...(base.damage !== undefined ? { damage: base.damage * (1 + damageBonus) } : {}),
        ...(base.tickDamage !== undefined ? { tickDamage: base.tickDamage * (1 + damageBonus) } : {}),
        auraDamage: (base.auraDamage || 0) + level * (bonuses.auraDamage || 0) }))];
    }));
    const requested = this.options.party || [{ heroId: 'guan_yu', level: 1, skillLevel: 1 }];
    const seen = new Set();
    this.heroes = requested.filter(p => B.heroes[p.heroId] && !seen.has(p.heroId) && seen.add(p.heroId))
      .slice(0, this.level.maxPartySize).map((p, i) => {
        const definition = B.heroes[p.heroId];
        const position = this.map.heroSlots[i] || B.party.heroPositions[i ? (i === 1 ? 'supportLeft' : 'supportRight') : 'lead'];
        const level = clamp(Math.floor(p.level || 1), 1, 30);
        const maximumSkill = B.metaProgression.skillLevel.requiredHeroLevelBySkillLevel.filter(n => n <= level).length;
        const equipment = {};
        for (const slot of B.metaProgression.equipment.slots) {
          const entry = p.equipment?.[slot] || {};
          const templateId = typeof entry.templateId === 'string' ? entry.templateId : null;
          const templates = B.metaProgression.equipment.templates || {};
          const template = Object.hasOwn(templates, templateId) ? templates[templateId] : null;
          const goldAllowed = slot === 'weapon' && template?.slot === 'weapon' && template.quality === 'gold';
          const quality = B.metaProgression.equipment.qualityIds.includes(entry.quality) && (entry.quality !== 'gold' || goldAllowed) ? entry.quality : 'white';
          equipment[slot] = { level: clamp(Math.floor(entry.level || 0), 0, 10), quality,
            templateId, signatureActive: false };
        }
        const signatureBonuses = this._resolveSignatureBonuses(p.heroId, equipment);
        return { id: p.heroId, heroId: p.heroId, name: definition.name, role: i ? 'support' : 'lead', definition,
          x: position.x, y: position.y, level, skillLevel: clamp(Math.floor(p.skillLevel || 1), 1, maximumSkill), equipment, signatureBonuses,
          auto: i > 0 && Boolean(p.auto), rage: i ? 0 : B.rage.initial, rageRecovery: 0, reserved: false,
          attackCooldown: 0, attackFlash: 0, casting: false, castingRemaining: 0, target: null };
      });
    if (!this.heroes.length) throw new Error('At least one valid hero is required');
    const gearRules = B.metaProgression.equipment;
    this.teamSignatureArmor = Math.min(gearRules.teamSignatureGateBonusCap || 0, this.heroes.reduce((v, h) => v + h.signatureBonuses.teamGateHpAdd, 0));
    this.teamSignatureCommand = Math.min(gearRules.teamSignatureCampBonusCap || 0, this.heroes.reduce((v, h) => v + h.signatureBonuses.campDamageAdd, 0));
    this.teamArmor = Math.min(gearRules.teamArmorDefenseBonusCap, this.heroes.reduce((v, h) => v + this._gear(h, 'armor', 'armorDefense'), 0)) + this.teamSignatureArmor;
    this.teamCommand = Math.min(gearRules.teamCommandCampDamageBonusCap, this.heroes.reduce((v, h) => v + this._gear(h, 'command_token', 'commandCampDamage'), 0)) + this.teamSignatureCommand;
    this.maxHp = Math.round(B.world.gateHp * (1 + this.teamArmor));
    this.hp = this.maxHp;
    this.food = this.level.startingFood;
    this.state = 'ready'; this.time = 0; this.wave = 0; this.waveCount = this.level.waves.length;
    this.kills = 0; this.bestBurst = 0; this.camps = []; this.enemies = []; this.projectiles = []; this.effects = [];
    this.upgrades = []; this.tactics = new Set(); this.skillQueue = []; this._casts = []; this._buffs = [];
    this._spawnQueue = []; this._spawnIndex = 0; this._waveTime = 0; this._between = 0;
    this._enemySerial = 0; this._castSerial = 0; this._lastSkillTime = -Infinity; this._previewTimer = 0;
    this._selectedWave = 0; this._clearedWave = 0; this._lastEnemyWave = 0; // presentation-event guards only
    this.stats = { spawned: 0, scheduledEnemies: 0, escaped: 0, maxAlive: 0, maxPendingSpawns: 0,
      ultimateCasts: 0, ultimateKills: 0, sourceStats: {}, perHero: {}, queuedSkills: 0, cancelledAuto: 0,
      summoned: 0, damageToGate: 0, totalFoodEarned: 0, killsByType: {}, escapesByType: {} };
    for (const free of this.level.freeCamps) this._addCamp(free.slot, free.type, 1);
    this._refreshTargets();
    return this;
  }

  get activeEnemyCount() { return this.enemies.filter(alive).length; }
  get pendingEnemyCount() { return this._spawnQueue.length - this._spawnIndex; }
  get rage() { return this.heroes[0].rage; }
  get maxRage() { return B.rage.max; }
  get rageRecovery() { return this.heroes[0].rageRecovery; }
  get ultimateTarget() { return this.heroes[0].target; }
  get currentBurst() { return this._casts.find(c => c.heroId === this.heroes[0].id) || null; }
  get stars() { return this.state === 'won' ? (this.hp / this.maxHp >= 0.85 ? 3 : this.hp / this.maxHp >= 0.6 ? 2 : 1) : 0; }

  _emit(type, data = {}) { this.onEvent({ type, time: this.time, ...data }); }
  start() { if (this.state !== 'ready') return no('战斗已开始'); this.state = 'playing'; this._startWave(1); this._emit('start'); return okay(); }
  pause() { if (this.state !== 'playing') return no('当前不能暂停'); this.state = 'paused'; this._emit('pause'); return okay(); }
  resume() { if (this.state !== 'paused') return no('当前不能继续'); this.state = 'playing'; this._emit('resume'); return okay(); }

  _gear(hero, slot, property) {
    const item = hero.equipment[slot];
    return item.level * B.metaProgression.equipment.perLevelBonuses[property] + B.metaProgression.equipment.qualityFixedBonuses[item.quality][property];
  }
  _resolveSignatureBonuses(heroId, equipment) {
    const rules = B.metaProgression.equipment;
    const result = { basicDamageAdd: 0, ultimateDamageAdd: 0, basicRangeAdd: 0,
      ultimateWidthAdd: 0, teamGateHpAdd: 0, campDamageAdd: 0 };
    for (const slot of rules.slots) {
      const item = equipment[slot]; const templates = rules.templates || {};
      const template = Object.hasOwn(templates, item.templateId) ? templates[item.templateId] : null;
      if (!template || template.slot !== slot || template.quality !== item.quality || template.exclusiveHeroId !== heroId) continue;
      item.signatureActive = true;
      for (const property of Object.keys(result)) {
        const bonus = template.signatureBonuses?.[property];
        if (Number.isFinite(bonus) && bonus > 0) result[property] += bonus;
      }
    }
    return Object.freeze(result);
  }
  heroDamageMultiplier(hero, skill = false) {
    return (1 + 0.01 * (hero.level - 1)) * (1 + this._gear(hero, 'weapon', 'weaponDamage')) *
      (1 + hero.signatureBonuses[skill ? 'ultimateDamageAdd' : 'basicDamageAdd']) *
      (skill ? B.metaProgression.skillLevel.numericDamageMultipliers[hero.skillLevel - 1] : hero.role === 'support' ? B.party.supportBasicDamageMultiplier : 1);
  }
  heroBasicRange(hero) { return hero.definition.attack.range + this._gear(hero, 'horse', 'horseBasicRange') + hero.signatureBonuses.basicRangeAdd; }

  _addCamp(slot, type, level) {
    const position = this.map.campSlots.find(s => s.slot === slot);
    if (!position || !B.camps[type]) return null;
    const camp = { slot, type, name: B.camps[type].name, x: position.x, y: position.y, level,
      cooldown: 0, attackCooldown: 0, disruptions: [], range: 0, field: null };
    this.camps.push(camp); this._updateCamp(camp); return camp;
  }
  _campStats(camp) { return this._campStatTable[camp.type][camp.level - 1]; }
  _updateCamp(camp) {
    const base = this._campStats(camp); let range = base.range;
    if (this.tactics.has(camp.type + '_range')) range += 25;
    if (camp.type === 'shield' && this.tactics.has('shield_reach')) range += 25;
    if (camp.type === 'war_drum' && this.tactics.has('war_drum_reach')) range += 30;
    const mod = this.map.rule.campModifier;
    if (mod?.slot === camp.slot && mod.projectileRangeMultiplier && !['shield', 'war_drum'].includes(camp.type)) range *= mod.projectileRangeMultiplier;
    camp.range = range;
  }
  build(slot, type) {
    if (!['ready', 'playing', 'paused'].includes(this.state)) return no('当前不能布阵');
    if (!this.unlockedCamps.includes(type)) return no('军营尚未解锁');
    if (!this.map.campSlots.some(s => s.slot === slot)) return no('无效营位');
    if (this.camps.some(c => c.slot === slot)) return no('营位已占用');
    const cost = B.camps[type].buildCost; if (this.food < cost) return no('军粮不足');
    this.food -= cost; const camp = this._addCamp(slot, type, 1); this._emit('build', { slot, camp, cost }); return okay({ camp, cost });
  }
  getUpgradeCost(slot) {
    const camp = this.camps.find(c => c.slot === slot);
    return camp && camp.level < 3 ? B.camps[camp.type].levels[camp.level].upgradeCost : null;
  }
  upgrade(slot) {
    if (!['ready', 'playing', 'paused'].includes(this.state)) return no('当前不能升级');
    const camp = this.camps.find(c => c.slot === slot); if (!camp) return no('营位未建造');
    const cost = this.getUpgradeCost(slot); if (cost === null) return no('已满级');
    if (this.food < cost) return no('军粮不足'); this.food -= cost; camp.level++; this._updateCamp(camp);
    this._emit('upgrade', { slot, camp, cost }); return okay({ camp, cost });
  }
  _offerTactics() {
    const eligible = Object.entries(B.tactics).filter(([id, t]) => !this.tactics.has(id) &&
      (t.hero ? this.heroes.some(h => h.id === t.hero) : this.camps.some(c => c.type === t.camp)))
      .map(([id, t]) => ({ id, ...t, description: this._tacticCopy(id) }));
    for (let i = eligible.length - 1; i > 0; i--) { const j = Math.floor(this.rng() * (i + 1)); [eligible[i], eligible[j]] = [eligible[j], eligible[i]]; }
    this.upgrades = eligible.slice(0, 3);
    if (!this.upgrades.length) { this._beginIntermission(); return; }
    this.state = 'choosing'; this._emit('choice', { choices: this.upgrades });
  }
  _tacticCopy(id) {
    const text = { archer_pierce: '主箭贯穿一名敌军，造成35%伤害', archer_volley: '追加一箭，造成25%伤害', archer_hunt: '对骑兵、重甲与首领伤害增加25%',
      shield_grasp: '盾营减速强化，仍受抗性影响', shield_reach: '盾营控制范围增加25', shield_break: '盾营每击最多命中5人',
      catapult_blast: '爆炸半径增加12，伤害仍最多6人', catapult_shock: '碎石减速35%，持续2.5秒', catapult_siege: '对重甲与首领伤害增加25%',
      guan_yu_width: '青龙横扫宽度增加24', guan_yu_press: '精锐后退距离增加16', zhou_yu_radius: '赤壁烈焰半径增加16', zhou_yu_duration: '火场持续增加1秒，命中次数上限保持',
      crossbow_precision: '对精锐与首领额外增伤25%', crossbow_pierce: '贯穿一名敌军，造成35%伤害', crossbow_range: '弩营射程增加25',
      fire_oil_spread: '火油范围增加16', fire_oil_heat: '对精锐与首领灼烧伤害增加15%', fire_oil_slow: '火油命中附加25%减速1秒',
      war_drum_reach: '鼓声范围增加30', war_drum_vigor: '鼓声攻速增益增加5%', war_drum_ward: '鼓声范围军营获得25%扰阵抗性' };
    return text[id] || B.tactics[id].name;
  }
  selectUpgrade(id) {
    if (this.state !== 'choosing') return no('当前没有战术选择');
    const choice = this.upgrades.find(t => t.id === id); if (!choice) return no('无效战术');
    this.tactics.add(id); this.upgrades = []; for (const c of this.camps) this._updateCamp(c);
    this.state = 'playing'; this._beginIntermission(); this._emit('tactic', { upgrade: choice }); return okay({ upgrade: choice });
  }

  _beginIntermission() {
    this._between = B.referencePacing.betweenWavesSec;
    const next = this.level.waves[this.wave]; if (!next) return;
    const cavalryPack = next.packs.find(pack => (pack.units.cavalry || 0) > 0);
    if (!cavalryPack) return;
    // A pack's shuffled cavalry can be its first real unit; warn against that earliest valid time.
    const earliest = cavalryPack.startSec + .3;
    if (this.map.rule.id === 'reed_warning') {
      this._between = Math.max(this._between, 5 - earliest);
      this._emit('reinforcementWarning', { wave: next.index, enemyType: 'cavalry', name: '芦苇骑兵增援', seconds: this._between + earliest, mapRuleId: this.map.rule.id });
    } else if (this.map.rule.id === 'cold_front' && next.index === 4) {
      this._emit('reinforcementWarning', { wave: 4, enemyType: 'cavalry', name: '雪骑来袭', seconds: this._between + earliest, mapRuleId: this.map.rule.id });
    }
  }

  _lane(distribution, index, count) {
    // Stratified allocation keeps the configured route proportions stable even in small packs.
    const value = (index + 0.5) / count; let cumulative = 0;
    for (let i = 0; i < distribution.length; i++) { cumulative += distribution[i]; if (value <= cumulative + EPS) return i; }
    return distribution.length - 1;
  }
  _startWave(number) {
    this.wave = number; this._waveTime = 0; this._between = 0; this._spawnQueue = []; this._spawnIndex = 0;
    const wave = this.level.waves[number - 1];
    for (const pack of wave.packs) {
      const types = Object.entries(pack.units).flatMap(([type, count]) => Array(count).fill(type));
      // Mix species rather than batching all cavalry at the end of a pack.
      for (let i = types.length - 1; i > 0; i--) { const j = Math.floor(this.rng() * (i + 1)); [types[i], types[j]] = [types[j], types[i]]; }
      for (let i = 0; i < types.length; i++) this._spawnQueue.push({ type: types[i], at: pack.startSec + 0.3 + pack.durationSec * i / Math.max(1, types.length - 1), lane: this._lane(wave.laneDistribution, i, types.length), wave });
    }
    if (wave.bossSpawn) this._spawnQueue.push({ type: 'boss', at: wave.bossSpawn.spawnAtSec, lane: 0, boss: wave.bossSpawn, wave, warned: false });
    this._spawnQueue.sort((a, b) => a.at - b.at || a.lane - b.lane);
    this.stats.scheduledEnemies += this._spawnQueue.length;
    this._emit('wave', { wave: number, total: this.waveCount, count: this._spawnQueue.length, boss: Boolean(wave.bossSpawn) });
  }
  pathPoint(lane, progress) {
    const path = typeof lane === 'number' ? this.paths[lane] : this.paths.find(p => p.id === lane) || this.paths[0];
    let remaining = clamp(progress, 0, path.length);
    for (let i = 0; i < path.lengths.length; i++) {
      if (remaining <= path.lengths[i]) {
        const t = remaining / path.lengths[i]; const a = path.points[i]; const b = path.points[i + 1];
        return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
      }
      remaining -= path.lengths[i];
    }
    return { ...path.points.at(-1) };
  }
  _pathProjection(laneId, point) {
    const path = this.paths.find(p => p.id === laneId) || this.paths[0];
    let best = { distance: Infinity, progress: 0 }; let offset = 0;
    for (let i = 0; i < path.lengths.length; i++) {
      const a = path.points[i]; const b = path.points[i + 1]; const dx = b.x - a.x; const dy = b.y - a.y;
      const t = clamp(((point.x - a.x) * dx + (point.y - a.y) * dy) / (dx * dx + dy * dy), 0, 1);
      const distance = Math.hypot(point.x - a.x - t * dx, point.y - a.y - t * dy);
      if (distance < best.distance - EPS) best = { distance, progress: offset + t * path.lengths[i] };
      offset += path.lengths[i];
    }
    return best;
  }
  _spawn(spec) {
    const base = B.enemies[spec.type]; const partyFactor = base.class === 'ordinary' ? 1 : B.party.enemyHpMultipliersByPartySize[this.heroes.length];
    const wave = spec.wave || this.level.waves[this.wave - 1];
    const hp = Math.ceil(base.hp * this.tier.hpMultiplier * this.difficulty.hpMultiplier * partyFactor *
      (spec.boss ? spec.boss.hpMultiplier * (spec.boss.ignoreWaveHpMultiplier ? 1 : wave.hpMultiplier) : wave.hpMultiplier));
    const path = this.paths[spec.lane || 0]; const point = this.pathPoint(path.id, spec.progress || 0);
    const enemy = { id: ++this._enemySerial, type: spec.type, class: base.class, name: spec.boss?.name || base.name,
      laneId: path.id, pathSide: spec.lane || 0, progress: spec.progress || 0, pathLength: path.length, ...point,
      hp, maxHp: hp, radius: base.radius, speed: base.speed * this.tier.speedMultiplier * this.difficulty.speedMultiplier * wave.speedMultiplier,
      reward: spec.reward ?? Math.round(base.reward * this.tier.rewardMultiplier * this.difficulty.rewardMultiplier * wave.rewardMultiplier),
      leak: base.leak, executeImmune: base.executeImmune, slow: 1, slowEffects: [], hitFlash: 0, stunRemaining: 0,
      vulnerability: [], abilityTimer: 0, abilityCount: 0, bossTemplateId: spec.boss?.templateId || null,
      bossAbilityRemaining: 0, damageTakenMultiplier: 1, invulnerable: false, escapeDamageMultiplier: 1 };
    this.enemies.push(enemy); this.stats.spawned++; if (spec.summoned) this.stats.summoned++;
    this._emit('spawn', { enemy }); return enemy;
  }

  update(dt) {
    if (this.state !== 'playing' || !Number.isFinite(dt) || dt <= 0) return;
    // Callers may pass larger chunks for headless simulation; never discard combat time.
    let remaining = dt;
    while (remaining > EPS && this.state === 'playing') { const part = Math.min(STEP, remaining); this._step(part); remaining -= part; }
  }
  _step(dt) {
    this.time += dt;
    this.effects.forEach(e => { e.age += dt; e.time = e.age; }); this.effects = this.effects.filter(e => e.age < e.life);
    this._buffs.forEach(b => { b.remaining -= dt; }); this._buffs = this._buffs.filter(b => b.remaining > EPS);
    for (const c of this.camps) { c.disruptions.forEach(d => { d.remaining -= dt; }); c.disruptions = c.disruptions.filter(d => d.remaining > EPS); c.attackFlash = Math.max(0, (c.attackFlash || 0) - dt); }
    for (const h of this.heroes) { h.attackFlash = Math.max(0, h.attackFlash - dt); h.castingRemaining = Math.max(0, h.castingRemaining - dt); h.casting = h.castingRemaining > 0; }
    if (this._between > 0) { this._between -= dt; if (this._between <= EPS) this._startWave(this.wave + 1); }
    else {
      this._waveTime += dt;
      for (const s of this._spawnQueue.slice(this._spawnIndex)) {
        if (s.boss && !s.warned && this._waveTime >= s.at - s.boss.warningSec) { s.warned = true; this._emit('bossWarning', { name: s.boss.name, laneId: this.paths[s.lane].id, seconds: s.boss.warningSec }); }
      }
      while (this._spawnIndex < this._spawnQueue.length && this._spawnQueue[this._spawnIndex].at <= this._waveTime + EPS && this.activeEnemyCount < B.enemyDensity.maximumAliveEnemies) this._spawn(this._spawnQueue[this._spawnIndex++]);
    }
    const living = this.enemies.filter(alive);
    this.stats.maxAlive = Math.max(this.stats.maxAlive, living.length);
    this.stats.maxPendingSpawns = Math.max(this.stats.maxPendingSpawns, this.pendingEnemyCount);
    this._enemyAbilities(living, dt);
    const banners = living.filter(e => e.type === 'banner');
    for (const e of living) {
      e.hitFlash = Math.max(0, e.hitFlash - dt);
      e.vulnerability.forEach(s => { s.remaining -= dt; }); e.vulnerability = e.vulnerability.filter(s => s.remaining > EPS);
      let shieldFactor = 1;
      for (const c of this.camps) if (c.type === 'shield' && dist(c, e) <= c.range + e.radius) {
        const raw = this.tactics.has('shield_grasp') ? 0.32 : this._campStats(c).speedFactor;
        shieldFactor = Math.min(shieldFactor, this._resistedSlow(e, raw));
      }
      // Integrate boundaries of independent statuses rather than extending a stronger slow with a weak hit.
      const boundaries = [...new Set([0, dt, ...e.slowEffects.map(s => clamp(s.remaining, 0, dt)), clamp(e.stunRemaining, 0, dt)])].sort((a, b) => a - b);
      let motion = 0; let factor = shieldFactor;
      for (let i = 1; i < boundaries.length; i++) {
        const midpoint = (boundaries[i - 1] + boundaries[i]) / 2;
        factor = Math.min(shieldFactor, ...e.slowEffects.filter(s => s.remaining > midpoint).map(s => s.factor), 1);
        if (e.stunRemaining <= midpoint) motion += (boundaries[i] - boundaries[i - 1]) * factor;
      }
      e.slow = factor;
      e.slowEffects.forEach(s => { s.remaining -= dt; }); e.slowEffects = e.slowEffects.filter(s => s.remaining > EPS);
      e.stunRemaining = Math.max(0, e.stunRemaining - dt);
      const banner = e.type === 'infantry' && banners.some(b => alive(b) && dist(b, e) <= 50) ? 1.15 : 1;
      const haste = e.bossTemplateId === 'charger' && e.bossAbilityRemaining > 0 ? 1.4 : 1;
      e.progress += e.speed * motion * banner * haste; Object.assign(e, this.pathPoint(e.laneId, e.progress));
      if (e.progress >= e.pathLength - EPS) this._escape(e);
    }
    if (this.hp <= 0) { this._finish('lost'); return; }
    this._attackCamps(dt); this._attackHeroes(dt); this._projectiles(dt); this._skillDamage(dt);
    const engaged = this.enemies.some(e => alive(e) && !e.invulnerable &&
      (this.camps.some(c => c.type !== 'war_drum' && dist(c, e) <= c.range + e.radius) || this.heroes.some(h => dist(h, e) <= this.heroBasicRange(h) + e.radius)));
    for (const h of this.heroes) {
      const blocked = Math.min(dt, h.rageRecovery); h.rageRecovery = Math.max(0, h.rageRecovery - dt);
      const rate = B.rage.roles[h.role][engaged ? 'engagedPerSec' : 'idlePerSec'];
      h.rage = Math.min(100, h.rage + (dt - blocked) * rate);
    }
    this._previewTimer -= dt;
    if (this._previewTimer <= 0) { this._refreshTargets(); this._previewTimer = 0.2; }
    for (const h of this.heroes) if (h.auto && h.rage >= 100 - EPS && !h.reserved) {
      const target = this._target(h); if (this._canAuto(h, target)) this._enqueue(h, true, target);
    }
    this._executeQueue();
    this.enemies = this.enemies.filter(alive);
    // Presentation cues: read-only observations of state the simulation already decided this step.
    if (this._between <= 0 && !this.pendingEnemyCount && this.enemies.length === 1 && this._lastEnemyWave !== this.wave) {
      this._lastEnemyWave = this.wave; const last = this.enemies[0];
      this._emit('lastEnemy', { wave: this.wave, enemyId: last.id, enemyType: last.type, x: last.x, y: last.y });
    }
    if (this._between <= 0 && !this.pendingEnemyCount && !this.enemies.length && !this._casts.some(c => c.kind === 'delayed')) {
      if (this._clearedWave !== this.wave) { this._clearedWave = this.wave; this._emit('waveClear', { wave: this.wave, total: this.waveCount, final: this.wave === this.waveCount }); }
      if (this.wave === this.waveCount) this._finish('won');
      else if (this.level.choiceAfterWaves.includes(this.wave) && this._selectedWave !== this.wave) {
        // Let current releases and already-requested skills finish their opening
        // before freezing combat for an upgrade choice. Long ground fields persist.
        if (this.heroes.some(h => h.casting) || this.skillQueue.length) return;
        this._selectedWave = this.wave; this._offerTactics();
      }
      else this._beginIntermission();
    }
  }

  _escape(enemy) {
    enemy.escaped = true; this.stats.escaped++; this.stats.escapesByType[enemy.type] = (this.stats.escapesByType[enemy.type] || 0) + 1;
    const factor = Math.max(0.7, Math.min(1, ...this._buffs.filter(b => b.kind === 'gate').map(b => b.factor)));
    const damage = enemy.leak * enemy.escapeDamageMultiplier * factor;
    this.hp = Math.max(0, this.hp - damage); this.stats.damageToGate += damage;
    // Presentation fields only (position, type, max HP) so the renderer/DOM can place gate feedback.
    this._emit('leak', { enemyId: enemy.id, enemyType: enemy.type, x: enemy.x, y: enemy.y, damage, amount: damage, hp: this.hp, maxHp: this.maxHp });
  }
  _finish(state) {
    this.state = state; this.skillQueue = []; for (const h of this.heroes) h.reserved = false;
    this._emit(state === 'won' ? 'win' : 'lose', { hp: this.hp, stars: this.stars, kills: this.kills, bestBurst: this.bestBurst });
  }
  _resistedSlow(e, raw) {
    const fraction = B.controlAndDisruption.slowDefaultEffectFractionByClass[classOf(e)] * (B.enemies[e.type].controlEffectFraction || 1);
    return Math.max(0.3, 1 - (1 - raw) * fraction);
  }
  _slow(e, raw, seconds, source) {
    const factor = this._resistedSlow(e, raw); const existing = e.slowEffects.find(s => s.source === source);
    if (existing) { existing.factor = factor; existing.remaining = Math.max(existing.remaining, seconds); }
    else e.slowEffects.push({ factor, remaining: seconds, source });
  }
  _push(e, amount) { e.progress = Math.max(0, e.progress - amount * (B.enemies[e.type].controlEffectFraction || 1)); Object.assign(e, this.pathPoint(e.laneId, e.progress)); }
  _vulnerable(e, factor, seconds, source) {
    const found = e.vulnerability.find(v => v.source === source);
    if (found) { found.factor = factor; found.remaining = seconds; }
    else e.vulnerability.push({ factor, remaining: seconds, source });
  }
  _damage(e, amount, source, cast = null, execute = false) {
    if (!alive(e) || e.invulnerable) return false;
    const vulnerability = Math.min(1.25, Math.max(1, ...e.vulnerability.map(v => v.factor)));
    const executed = Boolean(execute && e.type === 'infantry' && !e.executeImmune);
    const inflicted = executed ? e.hp : amount * vulnerability * (e.damageTakenMultiplier || 1);
    if (!Number.isFinite(inflicted) || inflicted <= 0) return false;
    const actual = Math.min(e.hp, inflicted); e.hp -= actual; e.hitFlash = 0.1;
    const stats = this.stats.sourceStats[source] ||= { damage: 0, kills: 0 }; stats.damage += actual;
    const heroId = cast?.heroId || (source.startsWith('hero_') ? source.slice(5) : undefined);
    this._emit('damage', { enemyId: e.id, enemyType: e.type, enemyClass: e.class, x: e.x, y: e.y, amount: actual, hpAfter: Math.max(0, e.hp), maxHp: e.maxHp, source, heroId, castId: cast?.id, executed });
    if (e.hp > EPS) return false;
    e.hp = 0; this.kills++; stats.kills++; this.stats.killsByType[e.type] = (this.stats.killsByType[e.type] || 0) + 1;
    this.food += e.reward; this.stats.totalFoodEarned += e.reward;
    if (cast) { cast.kills++; this.stats.ultimateKills++; this.stats.perHero[cast.heroId].kills++; this.bestBurst = Math.max(this.bestBurst, cast.kills); }
    this._emit('kill', { enemyId: e.id, enemyType: e.type, x: e.x, y: e.y, source, reward: e.reward, heroId,
      amount: actual, radius: e.radius, facing: e.facing, castId: cast?.id, burstKills: cast?.kills, executed }); return true;
  }

  _friendlySpeed(unit) {
    let bonus = Math.max(0, ...this._buffs.filter(b => b.kind === 'speed').map(b => b.bonus));
    for (const c of this.camps) if (c.type === 'war_drum' && dist(c, unit) <= c.range) bonus = Math.max(bonus, this._campStats(c).attackSpeedBonus + (this.tactics.has('war_drum_vigor') ? 0.05 : 0));
    return Math.min(0.3, bonus);
  }
  _resilience(camp) {
    return this.tactics.has('war_drum_ward') && this.camps.some(c => c.type === 'war_drum' && dist(c, camp) <= c.range) ? 0.25 : 0;
  }
  _campInterval(camp) {
    const hostile = Math.min(0.15, Math.max(0, ...camp.disruptions.map(d => d.bonus))) * (1 - this._resilience(camp));
    return this._campStats(camp).intervalSec * (1 + hostile) / (1 + this._friendlySpeed(camp));
  }
  _campDamage(camp, enemy, baseDamage) {
    const drumDamage = Math.max(0, ...this.camps.filter(c => c.type === 'war_drum' && dist(c, camp) <= c.range).map(c => this._campStats(c).auraDamage));
    let multiplier = (1 + this.teamCommand) * (1 + drumDamage) * (1 + Math.min(0.35, Math.max(0, ...this._buffs.filter(b => b.kind === 'campDamage').map(b => b.bonus))));
    if (camp.type === 'archer' && this.tactics.has('archer_hunt') && ['cavalry', 'armor', 'boss'].includes(enemy.type)) multiplier *= 1.25;
    if (camp.type === 'catapult' && this.tactics.has('catapult_siege') && ['armor', 'boss'].includes(enemy.type)) multiplier *= 1.25;
    if (camp.type === 'crossbow' && classOf(enemy) !== 'ordinary') { multiplier *= 1.25; if (this.tactics.has('crossbow_precision')) multiplier *= 1.25; }
    if (camp.type === 'fire_oil') { if (classOf(enemy) !== 'ordinary' && this.tactics.has('fire_oil_heat')) multiplier *= 1.15; multiplier *= this.map.rule.campModifier?.fireOilDotMultiplier || 1; }
    return baseDamage * multiplier;
  }
  _attackCamps(dt) {
    for (const camp of this.camps) {
      if (camp.type === 'war_drum') continue;
      this._oilField(camp, dt);
      camp.cooldown = Math.max(0, camp.cooldown - dt); camp.attackCooldown = camp.cooldown;
      if (camp.cooldown > EPS) continue;
      const targets = this.enemies.filter(e => alive(e) && !e.invulnerable && dist(camp, e) <= camp.range + e.radius).sort((a, b) =>
        (camp.type === 'crossbow' ? (classOf(b) !== 'ordinary') - (classOf(a) !== 'ordinary') : 0) || priority(a, b));
      if (!targets.length) continue;
      const s = this._campStats(camp); camp.cooldown = this._campInterval(camp);
      camp.attackFlash = .12;
      this._emit('attack', { campType: camp.type, slot: camp.slot, x: camp.x, y: camp.y });
      if (camp.type === 'shield') {
        for (const e of targets.slice(0, this.tactics.has('shield_break') ? 5 : s.maxTargets)) this._damage(e, this._campDamage(camp, e, s.damage), 'shield');
      } else {
        const e = targets[0];
        this.projectiles.push({ type: camp.type, campType: camp.type, camp, x: camp.x, y: camp.y, targetId: e.id, targetX: e.x, targetY: e.y,
          speed: B.camps[camp.type].projectileSpeed, damage: s.damage || 0, radius: 3, life: 4 });
      }
    }
  }
  _oilField(camp, dt) {
    const f = camp.field; if (!f) return;
    f.remaining -= dt; f.tick -= dt;
    if (f.tick <= EPS) {
      f.tick += 0.75;
      for (const e of this.enemies) if (alive(e) && dist(e, f) <= f.radius + e.radius) {
        this._damage(e, this._campDamage(camp, e, this._campStats(camp).tickDamage), 'fire_oil');
        if (alive(e) && this.tactics.has('fire_oil_slow')) this._slow(e, 0.75, 1, 'oil_' + camp.slot);
      }
    }
    if (f.remaining <= EPS) camp.field = null;
  }
  _projectiles(dt) {
    for (const p of this.projectiles) {
      p.life -= dt; const e = this.enemies.find(e => e.id === p.targetId && alive(e));
      if (e && !['catapult', 'fire_oil'].includes(p.type)) { p.targetX = e.x; p.targetY = e.y; }
      const distance = Math.hypot(p.targetX - p.x, p.targetY - p.y);
      if (distance > p.speed * dt) { p.x += (p.targetX - p.x) / distance * p.speed * dt; p.y += (p.targetY - p.y) / distance * p.speed * dt; continue; }
      p.life = 0; this._emit('projectileImpact', { campType: p.type, x: p.targetX, y: p.targetY });
      if (p.type === 'catapult') {
        let radius = this._campStats(p.camp).blastRadius + (this.tactics.has('catapult_blast') ? 12 : 0);
        const mod = this.map.rule.campModifier; if (mod?.slot === p.camp.slot && mod.catapultRadiusMultiplier) radius *= mod.catapultRadiusMultiplier;
        const point = { x: p.targetX, y: p.targetY };
        const affected = this.enemies.filter(e => alive(e) && dist(e, point) <= radius + e.radius).sort((a, b) => dist(a, point) - dist(b, point) || priority(a, b));
        for (const victim of affected) this._slow(victim, this.tactics.has('catapult_shock') ? 0.65 : 0.8, this.tactics.has('catapult_shock') ? 2.5 : 1.5, 'stone_' + p.camp.slot);
        for (const victim of affected.slice(0, 6)) this._damage(victim, this._campDamage(p.camp, victim, p.damage), 'catapult');
        this.effects.push({ type: 'explosion', x: point.x, y: point.y, radius, life: 0.3, age: 0, time: 0 });
      } else if (p.type === 'fire_oil') {
        const radius = this._campStats(p.camp).fieldRadius + (this.tactics.has('fire_oil_spread') ? 16 : 0);
        if (p.camp.field) { Object.assign(p.camp.field, { x: p.targetX, y: p.targetY, radius, remaining: 3 }); }
        else p.camp.field = { x: p.targetX, y: p.targetY, radius, remaining: 3, tick: 0.75 };
        const visual = this.effects.find(effect => effect.type === 'oil' && effect.campSlot === p.camp.slot);
        const values = { type: 'oil', campSlot: p.camp.slot, x: p.targetX, y: p.targetY, radius, life: 3, age: 0, time: 0 };
        if (visual) Object.assign(visual, values); else this.effects.push(values);
      } else if (e) {
        this._damage(e, this._campDamage(p.camp, e, p.damage), p.type);
        // The volley may hit the same main target, but never creates another pierce chain.
        if (p.type === 'archer' && this.tactics.has('archer_volley') && alive(e)) this._damage(e, this._campDamage(p.camp, e, p.damage) * 0.25, p.type);
        if (this.tactics.has(p.type + '_pierce')) {
          const direction = { x: p.targetX - p.camp.x, y: p.targetY - p.camp.y }; const norm = Math.hypot(direction.x, direction.y) || 1;
          const next = this.enemies.filter(v => alive(v) && v.id !== p.targetId).map(v => ({ v, forward: (v.x - p.targetX) * direction.x / norm + (v.y - p.targetY) * direction.y / norm,
            side: Math.abs((v.x - p.targetX) * direction.y / norm - (v.y - p.targetY) * direction.x / norm) }))
            .filter(a => a.forward >= 0 && a.forward <= 125 && a.side <= 25 + a.v.radius).sort((a, b) => a.forward - b.forward || a.v.id - b.v.id)[0];
          if (next) this._damage(next.v, this._campDamage(p.camp, next.v, p.damage) * 0.35, p.type);
        }
      }
    }
    this.projectiles = this.projectiles.filter(p => p.life > 0);
  }
  _attackHeroes(dt) {
    for (const h of this.heroes) {
      h.attackCooldown = Math.max(0, h.attackCooldown - dt); if (h.attackCooldown > EPS) continue;
      const targets = this.enemies.filter(e => alive(e) && !e.invulnerable && dist(h, e) <= this.heroBasicRange(h) + e.radius).sort(priority);
      if (!targets.length) continue; h.attackCooldown = h.definition.attack.intervalSec / (1 + this._friendlySpeed(h));
      h.attackFlash = .12;
      for (const e of targets.slice(0, h.definition.attack.maxTargets)) this._damage(e, h.definition.attack.damage * this.heroDamageMultiplier(h), 'hero_' + h.id);
      this._emit('heroAttack', { heroId: h.id, x: h.x, y: h.y });
    }
  }

  _enemyAbilities(living, dt) {
    for (const e of living) {
      e.abilityTimer += dt; e.bossAbilityRemaining = Math.max(0, e.bossAbilityRemaining - dt);
      e.damageTakenMultiplier = e.bossTemplateId === 'guardian' && e.bossAbilityRemaining > EPS ? 0.75 : 1;
      if (e.type === 'ranged' && e.abilityTimer >= 8) {
        e.abilityTimer = 0; const camp = this.camps.filter(c => c.type !== 'war_drum' && dist(e, c) <= 160).sort((a, b) => dist(e, a) - dist(e, b) || a.slot - b.slot)[0];
        if (camp) camp.disruptions.push({ source: 'ranged_' + e.id, bonus: 0.1, remaining: 2 });
      }
      if (!e.bossTemplateId) continue;
      const template = B.bossTemplates[e.bossTemplateId]; const a = template.ability;
      if (e.bossTemplateId === 'rammer') {
        if (!e.abilityCount && e.progress / e.pathLength >= 0.75) { e.abilityCount++; e.escapeDamageMultiplier = 1.25; this._emit('bossAbility', { enemyId: e.id, name: template.name, skillId: template.skillId }); }
      } else if (e.abilityTimer >= a.intervalSec && (!a.maxActivations || e.abilityCount < a.maxActivations)) {
        e.abilityTimer = 0; e.abilityCount++; this._emit('bossAbility', { enemyId: e.id, name: template.name, skillId: template.skillId });
        if (e.bossTemplateId === 'banner_lord') {
          // Summons share the capacity queue and block victory, but never mint food.
          const wave = this.level.waves[this.wave - 1];
          const summons = Array.from({ length: 6 }, () => ({ type: 'infantry', lane: e.pathSide, at: this._waveTime, wave, progress: e.progress, reward: 0, summoned: true }));
          this._spawnQueue.splice(this._spawnIndex, 0, ...summons); this.stats.scheduledEnemies += 6;
        } else if (e.bossTemplateId === 'siege_lord') {
          for (const camp of this.camps.filter(c => c.type !== 'war_drum').sort((x, y) => dist(e, x) - dist(e, y) || x.slot - y.slot).slice(0, 2)) camp.disruptions.push({ source: 'boss_' + e.id, bonus: 0.15, remaining: 3 });
        } else { e.bossAbilityRemaining = 4; if (e.bossTemplateId === 'guardian') e.damageTakenMultiplier = 0.75; }
      }
    }
  }

  _score(e) { return (classOf(e) === 'boss' ? 2.5 : classOf(e) === 'elite' ? 1.25 : 1) * (1 + 0.15 * e.progress / e.pathLength); }
  _target(h) {
    const u = h.definition.ultimate; const enemies = this.enemies.filter(e => alive(e) && !e.invulnerable);
    const base = { shape: u.shape, x: h.x, y: h.y, angle: -Math.PI / 2, width: u.width || 0, length: u.length || u.range || 0,
      radius: u.radius || 0, laneId: null, count: 0, ordinaryCount: 0, infantryCount: 0, bossCount: 0, targetIds: [] };
    if (h.id === 'guan_yu' && this.tactics.has('guan_yu_width')) base.width += 24;
    if (['guan_yu', 'zhang_fei'].includes(h.id)) base.width += h.signatureBonuses.ultimateWidthAdd;
    if (h.id === 'zhou_yu' && this.tactics.has('zhou_yu_radius')) base.radius += 16;
    if (u.shape === 'lane_mines') {
      const routes = this.paths.map(p => { const hit = enemies.filter(e => e.laneId === p.id); return { id: p.id, count: hit.length, score: hit.reduce((n, e) => n + this._score(e), 0), offset: Math.abs(this.pathPoint(p.id, p.length * .55).x - h.x) }; })
        .sort((a, b) => b.count - a.count || b.score - a.score || a.offset - b.offset || a.id.localeCompare(b.id));
      base.laneIds = routes.slice(0, 2).map(p => p.id); base.targetIds = enemies.filter(e => base.laneIds.includes(e.laneId)).map(e => e.id);
    } else if (u.shape === 'three_distinct_target_snipes') {
      base.targetIds = enemies.filter(e => dist(h, e) <= u.range + e.radius).sort((a, b) => (classOf(b) === 'boss') - (classOf(a) === 'boss') || (classOf(b) === 'elite') - (classOf(a) === 'elite') || priority(a, b)).slice(0, 3).map(e => e.id);
    } else if (u.shape === 'lane_following_charge') {
      const route = this.paths.map(p => { const hit = enemies.filter(e => this._inShape(e, { ...base, laneId: p.id }, u)); return { id: p.id, count: hit.length, score: hit.reduce((n, e) => n + this._score(e), 0), offset: Math.abs(this.pathPoint(p.id, p.length * .55).x - h.x) }; })
        .sort((a, b) => b.count - a.count || b.score - a.score || a.offset - b.offset || a.id.localeCompare(b.id))[0];
      base.laneId = route.id; base.targetIds = enemies.filter(e => this._inShape(e, base, u)).map(e => e.id);
    } else if (base.radius && ['allied_command_with_local_shock', 'circle_shock', 'recovery_with_circle_shock', 'barrier_with_circle_shock'].includes(u.shape)) {
      base.targetIds = enemies.filter(e => dist(h, e) <= base.radius + e.radius).map(e => e.id);
    } else if (base.radius) {
      const point = maximumCircleCoverage(enemies, base.radius, { x: h.x, y: Math.max(100, h.y - 145) }, e => this._score(e));
      base.x = point.x; base.y = point.y;
      base.targetIds = enemies.filter(e => this._inShape(e, base, u)).map(e => e.id);
    } else {
      const aimUnits = u.shape === 'directional_swept_rectangle' && u.frontTravelSec ? enemies.map(e => {
        // A traveling blade must cover where a unit can be when its front arrives,
        // rather than grazing the unit's current collision edge and missing it later.
        const arrival = Math.min(u.frontTravelSec, dist(h, e) / (base.length / u.frontTravelSec));
        const banner = e.type === 'infantry' && enemies.some(v => v.type === 'banner' && dist(e, v) <= 50) ? 1.15 : 1;
        const haste = e.bossTemplateId === 'charger' && e.bossAbilityRemaining > 0 ? 1.4 : 1;
        const movement = e.speed * (e.slow || 1) * banner * haste * Math.max(0, arrival - e.stunRemaining);
        if (!movement) return e;
        return { ...e, ...this.pathPoint(e.laneId, Math.min(e.pathLength, e.progress + movement)) };
      }) : enemies;
      const choice = maximumDirectionalCoverage(aimUnits, h, u, base, e => this._score(e), (e, target) => this._inShape(e, target, u));
      base.angle = choice.angle; base.targetIds = aimUnits.filter(e => this._inShape(e, base, u)).map(e => e.id);
    }
    const selected = enemies.filter(e => base.targetIds.includes(e.id)); base.count = selected.length;
    base.ordinaryCount = selected.filter(e => classOf(e) === 'ordinary').length;
    base.infantryCount = selected.filter(e => e.type === 'infantry' && !e.executeImmune).length;
    base.bossCount = selected.filter(e => classOf(e) === 'boss').length;
    return base;
  }
  _refreshTargets() { for (const h of this.heroes) h.target = this._target(h); }
  _inShape(e, target, u) {
    if (target.shape === 'three_distinct_target_snipes') return target.targetIds.includes(e.id);
    if (target.shape === 'lane_following_charge') {
      const projection = this._pathProjection(target.laneId, e); const path = this.paths.find(p => p.id === target.laneId);
      return projection.distance <= target.width / 2 + e.radius && projection.progress >= Math.max(0, path.length - target.length) - e.radius;
    }
    if (target.radius) return dist(e, target) <= target.radius + e.radius + EPS;
    const dx = e.x - target.x; const dy = e.y - target.y;
    const forward = dx * Math.cos(target.angle) + dy * Math.sin(target.angle);
    const side = Math.abs(-dx * Math.sin(target.angle) + dy * Math.cos(target.angle));
    if (u.shape === 'frontal_cone') return forward >= -e.radius - EPS && Math.hypot(dx, dy) <= u.range + e.radius + EPS && side <= Math.max(0, forward) * Math.tan(u.angleDegrees * Math.PI / 360) + e.radius + EPS;
    return forward >= -e.radius - EPS && forward <= target.length + e.radius + EPS && side <= target.width / 2 + e.radius + EPS;
  }
  _canAuto(h, target) {
    if (!target || !target.count) return false;
    const config = h.definition.auto;
    if (config.minimumBenefitingCamps && this.camps.filter(c => c.type !== 'war_drum').length < config.minimumBenefitingCamps) return false;
    if (config.preferWhenGateHpFractionAtMost && this.hp / this.maxHp > config.preferWhenGateHpFractionAtMost && !target.bossCount &&
        !this.enemies.some(e => alive(e) && target.targetIds.includes(e.id) && e.progress / e.pathLength >= .9)) return false;
    if (target.ordinaryCount >= config.minOrdinaryTargets) return true;
    if (!config.bossException || !target.bossCount) return false;
    return this.enemies.some(e => alive(e) && classOf(e) === 'boss' && target.targetIds.includes(e.id) && !e.invulnerable && e.damageTakenMultiplier >= 1);
  }
  castUltimate(heroId = this.heroes[0].id) {
    if (this.state !== 'playing') return no('战斗未进行');
    const h = this.heroes.find(h => h.id === heroId); if (!h) return no('该武将未上阵');
    if (h.rage < 100 - EPS || h.rageRecovery > EPS) return no('无双尚未蓄满');
    if (h.reserved) return no('武将已在技能队列');
    return this._enqueue(h, false, this._target(h));
  }
  _enqueue(hero, auto, target) {
    if (this.skillQueue.length >= 3) return no('技能队列已满');
    hero.reserved = true; this.skillQueue.push({ heroId: hero.id, auto, target: structuredClone(target) }); this.stats.queuedSkills++;
    this._emit('skillQueued', { heroId: hero.id, name: hero.name, queuePosition: this.skillQueue.length }); this._executeQueue(); return okay({ queued: hero.reserved });
  }
  _executeQueue() {
    if (!this.skillQueue.length || this.time - this._lastSkillTime < 1 - EPS) return;
    const request = this.skillQueue.shift(); const h = this.heroes.find(h => h.id === request.heroId);
    h.reserved = false;
    if (request.auto) { request.target = this._target(h); if (!this._canAuto(h, request.target)) { this.stats.cancelledAuto++; this._emit('skillCancelled', { heroId: h.id }); return; } }
    h.rage = 0; h.rageRecovery = 6; this._lastSkillTime = this.time; this._beginCast(h, request.target);
  }
  _beginCast(h, target) {
    h.casting = true; h.castingRemaining = .9;
    const u = h.definition.ultimate; const cast = { id: ++this._castSerial, heroId: h.id, hero: h, target, age: 0, kills: 0,
      hits: new Map(), finished: false, nextTick: u.firstTickAtSec || 0, life: u.durationSec || 0.9, kind: 'instant', tickCount: 0 };
    this.stats.ultimateCasts++; const heroStats = this.stats.perHero[h.id] ||= { casts: 0, kills: 0 }; heroStats.casts++;
    this._casts.push(cast);
    const visualLife = u.delaySec ? u.delaySec + 0.35 : Math.max(0.9, u.durationSec || 0);
    this.effects.push({ type: 'ultimate', heroId: h.id, ...target, targets: this.enemies.filter(e => target.targetIds.includes(e.id)).map(e => ({ id: e.id, x: e.x, y: e.y })),
      x: target.x, y: target.y, age: 0, time: 0, life: visualLife });
    this._emit('ultimate', { heroId: h.id, name: h.name, skillName: u.name, burstId: cast.id, ...target, kills: 0 });
    if (u.allyAttackSpeedBonus) this._buffs.push({ kind: 'speed', bonus: u.allyAttackSpeedBonus, remaining: u.buffDurationSec });
    if (u.allyCampDamageBonus) this._buffs.push({ kind: 'campDamage', bonus: u.allyCampDamageBonus, remaining: u.buffDurationSec });
    if (u.healMaxGateHpFraction) {
      const fraction = Math.min(u.healFractionCap, u.healMaxGateHpFraction * B.metaProgression.skillLevel.numericDamageMultipliers[h.skillLevel - 1]);
      const heal = Math.min(this.maxHp - this.hp, this.maxHp * fraction); this.hp += heal; this._emit('heal', { heroId: h.id, heal });
    }
    if (u.gateIncomingDamageFactor) this._buffs.push({ kind: 'gate', factor: u.gateIncomingDamageFactor, remaining: u.buffDurationSec });
    if (u.shape === 'delayed_locked_circle') { cast.kind = 'delayed'; cast.life = u.delaySec + 0.1; }
    else if (u.tickIntervalSec) { cast.kind = 'field'; if (h.id === 'zhou_yu' && this.tactics.has('zhou_yu_duration')) cast.life += 1; this.effects.push({ type: 'field', heroId: h.id, ...target, life: cast.life, age: 0, time: 0 }); }
    else if (u.passAtSec) { cast.kind = 'passes'; cast.pass = 0; this._hitCast(cast); cast.pass++; }
    else if (u.shape === 'lane_mines') {
      cast.kind = 'mines'; cast.mines = target.laneIds.flatMap(laneId => u.laneProgressFractions.map(fraction => ({ ...this.pathPoint(laneId, this.paths.find(p => p.id === laneId).length * fraction), laneId, triggered: false })));
      for (const mine of cast.mines) this.effects.push({ type: 'mine', heroId: h.id, ...mine, radius: u.triggerRadius, life: cast.life, age: 0, time: 0, castId: cast.id });
    } else if (u.frontTravelSec) cast.kind = 'sweep';
    else this._hitCast(cast);
  }
  _hitCast(cast, override = null) {
    const h = cast.hero; const u = h.definition.ultimate; const target = override || cast.target;
    for (const e of this.enemies) {
      if (!alive(e) || e.invulnerable || !this._inShape(e, target, u)) continue;
      const oldHits = cast.hits.get(e.id) || 0; const maximum = u.maxTicksPerEnemyPerCast || u.maxHitsPerEnemyPerCast || 1;
      if (oldHits >= maximum) continue;
      const klass = classOf(e);
      const damageTable = u.tickDamageByClass || u.damagePerPassByClass || u.damagePerMineByClass || u.damageByClass;
      const amount = (damageTable?.[klass] || 0) * this.heroDamageMultiplier(h, true);
      cast.hits.set(e.id, oldHits + 1);
      if (u.incomingDamageMultiplier) this._vulnerable(e, u.incomingDamageMultiplier, u.vulnerabilityDurationSec, 'skill_' + cast.id);
      this._damage(e, amount, 'ultimate_' + h.id, cast, u.ordinaryExecute);
      if (!alive(e)) continue;
      if (u.pushbackByClass?.[klass]) this._push(e, u.pushbackByClass[klass] + (h.id === 'guan_yu' && klass === 'elite' && this.tactics.has('guan_yu_press') ? 16 : 0));
      if (u.hitSlowSec) this._slow(e, u.hitSpeedFactor || 0.65, u.hitSlowSec, 'skill_' + cast.id);
      if (u.eliteStunSec && klass === 'elite') e.stunRemaining = Math.max(e.stunRemaining, u.eliteStunSec * (B.enemies[e.type].controlEffectFraction || 1));
      if (u.backwardProgressPerSecByClass) this._push(e, (u.backwardProgressPerSecByClass[klass] || 0) * u.tickIntervalSec);
    }
  }
  _skillDamage(dt) {
    for (const cast of this._casts) {
      const before = cast.age; cast.age += dt; const u = cast.hero.definition.ultimate;
      if (cast.kind === 'sweep') {
        // The front advances toward the entry and may catch arriving units once.
        const target = { ...cast.target, length: cast.target.length * Math.min(1, cast.age / u.frontTravelSec) };
        if (u.shape === 'lane_following_charge') {
          this._hitCast(cast, target);
        } else this._hitCast(cast, target);
      } else if (cast.kind === 'delayed' && before < u.delaySec && cast.age + EPS >= u.delaySec) this._hitCast(cast);
      else if (cast.kind === 'passes') {
        while (cast.pass < u.passAtSec.length && cast.age + EPS >= u.passAtSec[cast.pass]) { this._hitCast(cast); cast.pass++; }
      } else if (cast.kind === 'field') {
        while (cast.nextTick <= Math.min(cast.age, cast.life) + EPS) {
          this._hitCast(cast); cast.nextTick += u.tickIntervalSec; cast.tickCount++;
        }
      } else if (cast.kind === 'mines') {
        for (const mine of cast.mines) if (!mine.triggered && this.enemies.some(e => alive(e) && e.laneId === mine.laneId && dist(e, mine) <= u.triggerRadius + e.radius)) {
          mine.triggered = true; this._hitCast(cast, { ...mine, shape: 'circle_shock', radius: u.blastRadius });
          this.effects.push({ type: 'explosion', heroId: cast.heroId, ...mine, radius: u.blastRadius, life: 0.35, age: 0, time: 0 });
          this.effects = this.effects.filter(e => !(e.type === 'mine' && e.castId === cast.id && e.laneId === mine.laneId && e.x === mine.x && e.y === mine.y));
        }
      }
      if (cast.age + EPS >= cast.life) { cast.finished = true; this.bestBurst = Math.max(this.bestBurst, cast.kills); this._emit('burst', { heroId: cast.heroId, name: cast.hero.name, burstId: cast.id, kills: cast.kills, count: cast.kills, x: cast.target.x, y: cast.target.y }); }
    }
    this._casts = this._casts.filter(c => !c.finished);
  }
}
