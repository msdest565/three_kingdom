import { BALANCE as B, CONTENT } from './runtime-data.js';
import { maximumCircleCoverage, maximumDirectionalCoverage, maximumSeparatedCircleCoverage } from './skill-targeting.js';
import { createEndlessLevel, generateEndlessWave } from './endless-rules.js';
import { aggregateAttributeEffects, calculateTacticEffects, drawTacticOffer } from './roguelike-system.js';
import { mergeHeroTactics, effectiveHeroUltimate, heroUpgradeEffects, heroUpgradeState } from './hero-upgrade-rules.js';
import { beginHeroUpgradeCast, heroCampRange, consumeHeroCampAttack, updateHeroUpgradeEffects, heroMovementLimit,
  heroIncomingMultiplier, heroGateLeak, afterHeroGateDamage, afterHeroEnemyDeath, beforeHeroHit, afterHeroHit,
  tickHeroUpgradeCast, finishHeroUpgradeCast } from './hero-upgrade-effects.js';
import { mergeCampTactics, campUpgradeEffects, campUpgradeState, drumAuraMultiplier, drumAttackSpeed } from './camp-upgrade-rules.js';
import { campWaveStarted, campUltimateStarted, campKilledEnemy, consumeCampAttackBonus, campIncomingMultiplier,
  campShieldControl, oilFields, createOilField, createCatapultFire, updateCampFireFields } from './camp-upgrade-effects.js';
import { mergeSynergyTactics, detectSynergies, eligibleSynergyCards, synergyRageCycle, synergyRageGainBonus,
  synergyArmyDamageBonus, synergyArmyMultiplier, synergyTargetMultiplier, applySynergyUltimate, synergyCanExecute,
  synergyVulnerability, heroComboStatus as readHeroComboStatus } from './synergy-rules.js';
import { initializeSynergies, beginSynergyCast, ensureSynergyCast, effectiveSynergyTarget, synergyCampRange, prepareHeroCombo,
  synergyHitMultiplier, synergyOverlapMultiplier, beforeSynergyHit, recordSynergyHit, recordSynergyPush, finishSynergyHitBatch,
  updateSynergyEffects } from './synergy-effects.js';

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
// Shared by combat and its read-only lobby presentation; no alternate equipment formula.
export function equipmentBonus(item, property) {
  const rules = B.metaProgression.equipment;
  return (item?.level || 0) * rules.perLevelBonuses[property] + rules.qualityFixedBonuses[item?.quality || 'white'][property];
}
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
    this.mode = this.options.mode === 'endless' ? 'endless' : 'campaign';
    this.tacticDefinitions = this.mode === 'endless' ? mergeHeroTactics(B) : B.tactics;
    this.tacticCatalog = this.mode === 'endless' ? mergeSynergyTactics(mergeCampTactics(this.tacticDefinitions, B),B) : this.tacticDefinitions;
    this._campEffectCache = {};
    this.endless = this.mode === 'endless' ? B.endless : null;
    this.level = this.endless ? createEndlessLevel(this.endless) : CONTENT.levels.find(l => l.id === (this.options.levelId || 'wei_001'));
    if (!this.level) throw new Error('Unknown level: ' + this.options.levelId);
    this.map = CONTENT.maps.find(m => m.id === this.level.mapId);
    this.tier = this.endless ? { hpMultiplier: 1, speedMultiplier: 1, rewardMultiplier: 1 } : B.stageGrowthTiers.find(t => t.id === this.level.growthTierId);
    this.difficulty = this.endless ? { hpMultiplier: 1, speedMultiplier: 1, rewardMultiplier: 1 } : B.difficultyProfiles[this.level.difficultyProfileId] || B.difficultyProfiles.normal;
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
    if (this.endless) for (const hero of this.heroes) heroUpgradeState(hero);
    const gearRules = B.metaProgression.equipment;
    this.teamSignatureArmor = Math.min(gearRules.teamSignatureGateBonusCap || 0, this.heroes.reduce((v, h) => v + h.signatureBonuses.teamGateHpAdd, 0));
    this.teamSignatureCommand = Math.min(gearRules.teamSignatureCampBonusCap || 0, this.heroes.reduce((v, h) => v + h.signatureBonuses.campDamageAdd, 0));
    this.teamArmor = Math.min(gearRules.teamArmorDefenseBonusCap, this.heroes.reduce((v, h) => v + this._gear(h, 'armor', 'armorDefense'), 0)) + this.teamSignatureArmor;
    this.teamCommand = Math.min(gearRules.teamCommandCampDamageBonusCap, this.heroes.reduce((v, h) => v + this._gear(h, 'command_token', 'commandCampDamage'), 0)) + this.teamSignatureCommand;
    this.maxHp = Math.round(B.world.gateHp * (1 + this.teamArmor));
    this.hp = this.maxHp;
    this.food = this.endless ? this.endless.startingFood : this.level.startingFood;
    this.state = 'ready'; this.time = 0; this.wave = 0; this.waveCount = this.endless ? this.endless.targetWaveCount : this.level.waves.length;
    this.kills = 0; this.bestBurst = 0; this.camps = []; this.enemies = []; this.projectiles = []; this.effects = [];
    this.upgrades = []; this.tactics = new Set(); this.skillQueue = []; this._casts = []; this._buffs = [];
    this.tacticCounts = {}; this.attributeEffects = {}; this.rerollCount = 0;
    this.locksRemaining = this.endless?.lockCountPerRun || 0; this.lockedTacticId = null;
    this.pityCounters = { epicMisses: 0, legendaryMisses: 0, heroMisses: 0 };
    this._endlessWaves = new Map(); this._firstLeakThisWave = false;
    this._heroZones = []; this._heroFirstLeakUsed = false;
    this._campFireFields = []; this._campFieldSerial = 0;
    initializeSynergies(this,B);
    this.activeSynergies = this.endless ? detectSynergies(B,this.heroes) : [];
    this._baseMaxHp = this.maxHp;
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
  get maxRage() { return this.heroMaxRage(this.heroes[0]); }
  get rageRecovery() { return this.heroes[0].rageRecovery; }
  get ultimateTarget() { return this.heroes[0].target; }
  get currentBurst() { return this._casts.find(c => c.heroId === this.heroes[0].id) || null; }
  get stars() { return this.state === 'won' ? (this.hp / this.maxHp >= 0.85 ? 3 : this.hp / this.maxHp >= 0.6 ? 2 : 1) : 0; }
  get maxCampLevel() { return this.endless ? this.endless.campLevelMax : 3; }
  _attribute(key) { return this.endless ? this.attributeEffects[key] || 0 : 0; }
  _attributeSetting(id, key, fallback) { return B.tactics[id]?.effects?.[key] ?? fallback; }
  _armyDamageBonus() {
    const low = this.hp / this.maxHp < this._attributeSetting('attr_gate_laststand', 'lowHpThreshold', .35) ? this._attribute('lowHpDamageBonus') : 0;
    return this._attribute('partyDamageBonus') * this.heroes.length + low + (this.endless ? synergyArmyDamageBonus(this) : 0);
  }
  _levelFive(camp) { return Boolean(this.endless && camp.level >= 5); }
  _campPassive(camp, key) { return this._levelFive(camp) ? this.endless.level5Effects[camp.type]?.[key] || 0 : 0; }
  heroRageCost(hero) { return B.rage.cost * (1 + this._attribute('rageCostBonus')); }
  heroMaxRage(hero) { return this.endless ? this.heroRageCost(hero) : B.rage.max; }
  heroUltimate(hero) { return applySynergyUltimate(this,hero,effectiveHeroUltimate(this,hero)); }
  heroComboStatus() { return this.endless ? readHeroComboStatus(this) : {count:0,limit:0,remaining:0,windowSec:0}; }
  tacticDefinition(id) { return this.tacticCatalog[id]; }
  _campEffects(camp) {
    const type = typeof camp === 'string' ? camp : camp.type;
    if (!this.endless) return {};
    const cached = this._campEffectCache[type];
    if (cached?.size === this.tactics.size) return cached.effects;
    const effects = campUpgradeEffects(this,type); this._campEffectCache[type] = { size:this.tactics.size, effects }; return effects;
  }
  enemyControlFraction(enemy) { return B.enemies[enemy.type].controlEffectFraction || 1; }
  _heroRageCycle(hero) {
    const effects = heroUpgradeEffects(this, hero.id);
    const solo = this.heroes.length === 1 ? 1 - (effects.soloRageCycleReduction || 0) : 1;
    return this.endless ? solo * synergyRageCycle(this) : solo;
  }
  _waveConfig(number) {
    if (!this.endless) return this.level.waves[number - 1];
    if (!this._endlessWaves.has(number)) this._endlessWaves.set(number, generateEndlessWave(number, this.endless, { laneCount: this.paths.length }));
    return this._endlessWaves.get(number);
  }

  _emit(type, data = {}) { this.onEvent({ type, time: this.time, ...data }); }
  start() { if (this.state !== 'ready') return no('战斗已开始'); this.state = 'playing'; this._startWave(1); this._emit('start'); return okay(); }
  pause() { if (this.state !== 'playing') return no('当前不能暂停'); this.state = 'paused'; this._emit('pause'); return okay(); }
  resume() { if (this.state !== 'paused') return no('当前不能继续'); this.state = 'playing'; this._emit('resume'); return okay(); }

  _gear(hero, slot, property) {
    return equipmentBonus(hero.equipment[slot], property);
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
  heroDamageMultiplier(hero, skill = false, dot = false) {
    const multiplier = (1 + 0.01 * (hero.level - 1)) * (1 + this._gear(hero, 'weapon', 'weaponDamage')) *
      (1 + hero.signatureBonuses[skill ? 'ultimateDamageAdd' : 'basicDamageAdd']) *
      (skill ? B.metaProgression.skillLevel.numericDamageMultipliers[hero.skillLevel - 1] : hero.role === 'support' ? B.party.supportBasicDamageMultiplier : 1);
    return this.endless ? multiplier * (1 + this._attribute(skill ? 'ultimateDamageBonus' : 'heroBasicDamageBonus') + this._armyDamageBonus() + (dot ? this._attribute('dotDamageBonus') : 0)) * synergyArmyMultiplier(this) : multiplier;
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
    if (this.endless) range += this._attribute('campRangeAdd') + (this._campEffects(camp).rangeAdd || 0);
    if (this.tactics.has(camp.type + '_range')) range += 25;
    if (camp.type === 'shield' && this.tactics.has('shield_reach')) range += 25;
    if (camp.type === 'war_drum' && this.tactics.has('war_drum_reach')) range += 30;
    const mod = this.map.rule.campModifier;
    if (mod?.slot === camp.slot && mod.projectileRangeMultiplier && !['shield', 'war_drum'].includes(camp.type)) range *= mod.projectileRangeMultiplier;
    camp.range = this.endless ? synergyCampRange(this,camp,range,heroCampRange(this, camp, range)) : range;
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
    return camp && camp.level < this.maxCampLevel ? B.camps[camp.type].levels[camp.level].upgradeCost : null;
  }
  upgrade(slot) {
    if (!['ready', 'playing', 'paused'].includes(this.state)) return no('当前不能升级');
    const camp = this.camps.find(c => c.slot === slot); if (!camp) return no('营位未建造');
    const cost = this.getUpgradeCost(slot); if (cost === null) return no('已满级');
    if (this.food < cost) return no('军粮不足'); this.food -= cost; camp.level++; this._updateCamp(camp);
    this._emit('upgrade', { slot, camp, cost }); return okay({ camp, cost });
  }
  _offerTactics() {
    if (this.endless) {
      const offer = drawTacticOffer({ tactics: this.tacticCatalog, counts: this.tacticCounts, heroIds: this.heroes.map(h => h.id),
        campTypes: this.camps.map(c => c.type), wave: this.wave, rng: this.rng, counters: this.pityCounters,
        lockedId: this.lockedTacticId, config: {...this.endless,eligibleSynergyIds:eligibleSynergyCards(B,this.heroes)}, maxStacksPerTactic: B.tacticSelection.maxStacksPerTactic });
      this.pityCounters = offer.counters; this.lastOfferPity = offer.pity;
      this.upgrades = offer.choices.map(t => ({ ...t, description: this._tacticCopy(t.id) }));
      this.state = 'choosing'; this._emit('choice', { choices: this.upgrades, pity: offer.pity }); return;
    }
    const eligible = Object.entries(B.tactics).filter(([id, t]) => !t.endlessOnly && !this.tactics.has(id) &&
      (t.hero ? this.heroes.some(h => h.id === t.hero) : this.camps.some(c => c.type === t.camp)))
      .map(([id, t]) => ({ id, ...t, description: this._tacticCopy(id) }));
    for (let i = eligible.length - 1; i > 0; i--) { const j = Math.floor(this.rng() * (i + 1)); [eligible[i], eligible[j]] = [eligible[j], eligible[i]]; }
    this.upgrades = eligible.slice(0, 3);
    if (!this.upgrades.length) { this._beginIntermission(); return; }
    this.state = 'choosing'; this._emit('choice', { choices: this.upgrades });
  }
  _tacticCopy(id) {
    if (this.tacticCatalog[id]?.endlessOnly) return this.tacticCatalog[id].description || this.tacticCatalog[id].name;
    if (B.tactics[id]?.category === 'attribute') return B.tactics[id].description || B.tactics[id].name;
    const text = { archer_pierce: '主箭贯穿一名敌军，造成35%伤害', archer_volley: '追加一箭，造成25%伤害', archer_hunt: '对骑兵、重甲与首领伤害增加25%',
      shield_grasp: '盾营减速强化，仍受抗性影响', shield_reach: '盾营控制范围增加25', shield_break: '盾营每击最多命中5人',
      catapult_blast: '爆炸半径增加12，伤害仍最多6人', catapult_shock: '碎石减速35%，持续2.5秒', catapult_siege: '对重甲与首领伤害增加25%',
      guan_yu_width: '青龙横扫宽度增加24', guan_yu_press: '精锐后退距离增加16', zhou_yu_radius: '赤壁火船火带宽度增加24', zhou_yu_duration: '火场持续增加1秒，命中次数上限保持',
      crossbow_precision: '对精锐与首领额外增伤25%', crossbow_pierce: '贯穿一名敌军，造成35%伤害', crossbow_range: '弩营射程增加25',
      fire_oil_spread: '火油范围增加16', fire_oil_heat: '对精锐与首领灼烧伤害增加15%', fire_oil_slow: '火油命中附加25%减速1秒',
      war_drum_reach: '鼓声范围增加30', war_drum_vigor: '鼓声攻速增益增加5%', war_drum_ward: '鼓声范围军营获得25%扰阵抗性' };
    return text[id] || B.tactics[id].name;
  }
  selectUpgrade(id) {
    if (this.state !== 'choosing') return no('当前没有战术选择');
    const choice = this.upgrades.find(t => t.id === id); if (!choice) return no('无效战术');
    const copies = this.tacticCounts[id] || 0;
    this.tacticCounts[id] = copies + 1; this.tactics.add(id);
    if (this.endless) {
      const gained = calculateTacticEffects(choice, copies);
      this.attributeEffects = aggregateAttributeEffects(B.tactics, this.tacticCounts);
      const previousMax = this.maxHp;
      this.maxHp = Math.round((this._baseMaxHp + this._attribute('gateHpAdd')) * (1 + this._attribute('gateHpPercentAdd') + this._attribute('gateHpRiskPercentAdd')));
      // Ordinary fortification fills new capacity; iron casting pays its health risk immediately.
      const capacityHeal = gained.gateImmediateHpLoss ? 0 : this.maxHp - previousMax;
      this.hp = clamp(this.hp + capacityHeal - (gained.gateImmediateHpLoss || 0), 0, this.maxHp);
      if (id === this.lockedTacticId) this.lockedTacticId = null;
    }
    this.upgrades = []; for (const c of this.camps) this._updateCamp(c);
    this.state = 'playing'; this._beginIntermission(); this._emit('tactic', { upgrade: choice });
    if (this.endless && this.hp <= 0) this._finish('lost');
    return okay({ upgrade: choice });
  }
  getRerollCost() { return this.endless ? this.endless.rerollCostBase * (1 + this.rerollCount) : null; }
  rerollTactics() {
    if (!this.endless || this.state !== 'choosing') return no('当前不能刷新战术');
    const cost = this.getRerollCost(); if (this.food < cost) return no('军粮不足');
    this.food -= cost; this.rerollCount++; this._offerTactics(); this._emit('tacticReroll', { cost, rerollCount: this.rerollCount });
    return okay({ cost, choices: this.upgrades });
  }
  skipTactics() {
    if (!this.endless || this.state !== 'choosing') return no('当前不能跳过战术');
    const food = this.endless.skipCompensationFood; this.food += food; this.stats.totalFoodEarned += food;
    this.upgrades = []; this.state = 'playing'; this._beginIntermission(); this._emit('tacticSkip', { food }); return okay({ food });
  }
  lockTactic(id) {
    if (!this.endless || this.state !== 'choosing') return no('当前不能锁定战术');
    if (this.lockedTacticId === id) return no('此战术已锁定');
    if (!this.upgrades.some(t => t.id === id)) return no('无效战术');
    if (!this.locksRemaining) return no('锁定次数已用完');
    this.lockedTacticId = id; this.locksRemaining--; this._emit('tacticLock', { id, remaining: this.locksRemaining }); return okay();
  }

  _beginIntermission() {
    this._between = B.referencePacing.betweenWavesSec;
    const next = this._waveConfig(this.wave + 1); if (!next) return;
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
    const wave = this._waveConfig(number);
    if (this.endless) {
      this.waveCount = Math.max(this.endless.targetWaveCount, number); this._firstLeakThisWave = false;
      this._heroFirstLeakUsed = false;
      campWaveStarted(this);
      this._gateImmunitiesRemaining = Math.floor(this._attribute('gateImmunityPerWave'));
      const heal = Math.min(this.maxHp - this.hp, this._attribute('gateHealPerWave'));
      if (heal > 0) { this.hp += heal; this._emit('heal', { source: 'wall', heal }); }
    }
    for (const pack of wave.packs) {
      const types = Object.entries(pack.units).flatMap(([type, count]) => Array(count).fill(type));
      // Mix species rather than batching all cavalry at the end of a pack.
      for (let i = types.length - 1; i > 0; i--) { const j = Math.floor(this.rng() * (i + 1)); [types[i], types[j]] = [types[j], types[i]]; }
      for (let i = 0; i < types.length; i++) this._spawnQueue.push({ type: types[i], at: this.endless && wave.anchor?.massArrival ? .3 : pack.startSec + 0.3 + pack.durationSec * i / Math.max(1, types.length - 1), lane: this._lane(wave.laneDistribution, i, types.length), wave });
    }
    if (wave.bossSpawn) this._spawnQueue.push({ type: 'boss', at: wave.bossSpawn.spawnAtSec, lane: 0, boss: wave.bossSpawn, wave, warned: false });
    if (this.endless) {
      for (const [index, boss] of (wave.bossSpawns || []).entries()) this._spawnQueue.push({ type: 'boss', at: boss.spawnAtSec, lane: index % this.paths.length, boss, wave, warned: false });
      this._assignEndlessRewards(wave);
    }
    this._spawnQueue.sort((a, b) => a.at - b.at || a.lane - b.lane);
    this.stats.scheduledEnemies += this._spawnQueue.length;
    this._emit('wave', { wave: number, total: this.waveCount, count: this._spawnQueue.length, boss: Boolean(wave.bossSpawn || wave.bossSpawns?.length) });
    if (this.endless && wave.anchor) this._emit('endlessAnchor', { ...wave.anchor, maximumAliveEnemies:B.enemyDensity.maximumAliveEnemies });
  }
  _assignEndlessRewards(wave) {
    const bosses = this._spawnQueue.filter(spec => spec.boss);
    const ordinary = this._spawnQueue.filter(spec => !spec.boss);
    const perBoss = wave.foodBudget?.bossPerEnemy ?? 60;
    for (const spec of bosses) spec.reward = perBoss;
    const budget = Math.max(0, wave.killFoodReward - bosses.length * perBoss);
    const weights = ordinary.map(spec => B.enemies[spec.type].class === 'ordinary' ? wave.foodBudget?.ordinaryWeight ?? 1.55 : wave.foodBudget?.eliteWeight ?? 4.5);
    const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
    const fractions = ordinary.map((spec, index) => {
      const exact = totalWeight ? budget * weights[index] / totalWeight : 0;
      spec.reward = Math.floor(exact); return { spec, index, remainder: exact - spec.reward };
    });
    let remaining = budget - ordinary.reduce((sum, spec) => sum + spec.reward, 0);
    fractions.sort((a, b) => b.remainder - a.remainder || a.index - b.index);
    for (const { spec } of fractions) { if (remaining <= 0) break; spec.reward++; remaining--; }
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
    const wave = spec.wave || this._waveConfig(this.wave);
    const hp = this.endless && spec.boss ? Math.ceil(spec.boss.maxHp * partyFactor) : Math.ceil(base.hp * this.tier.hpMultiplier * this.difficulty.hpMultiplier * partyFactor *
      (spec.boss ? spec.boss.hpMultiplier * (spec.boss.ignoreWaveHpMultiplier ? 1 : wave.hpMultiplier) : wave.hpMultiplier));
    const path = this.paths[spec.lane || 0]; const point = this.pathPoint(path.id, spec.progress || 0);
    const enemy = { id: ++this._enemySerial, type: spec.type, class: base.class, name: spec.boss?.name || base.name,
      laneId: path.id, pathSide: spec.lane || 0, progress: spec.progress || 0, pathLength: path.length, ...point,
      hp, maxHp: hp, radius: base.radius, speed: base.speed * this.tier.speedMultiplier * this.difficulty.speedMultiplier * wave.speedMultiplier,
      reward: spec.reward ?? Math.round(base.reward * this.tier.rewardMultiplier * this.difficulty.rewardMultiplier * wave.rewardMultiplier),
      leak: base.leak, executeImmune: base.executeImmune, slow: 1, slowEffects: [], hitFlash: 0, stunRemaining: 0,
      vulnerability: [], abilityTimer: 0, abilityCount: 0, bossTemplateId: spec.boss?.templateId || null,
      bossAbilityRemaining: 0, damageTakenMultiplier: 1, invulnerable: false, escapeDamageMultiplier: 1 };
    if (this.endless && spec.boss?.damageTakenMultiplier > 0 && spec.boss.damageTakenMultiplier <= 1) {
      enemy.anchorDamageTakenMultiplier = spec.boss.damageTakenMultiplier; enemy.damageTakenMultiplier = enemy.anchorDamageTakenMultiplier;
    }
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
    if (this.endless) updateHeroUpgradeEffects(this, dt);
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
        if (this.endless) {
          const effects = this._campEffects(c);
          shieldFactor = Math.min(shieldFactor, this._resistedSlow(e, raw, effects.shieldMinimumSpeedFactor || .3, classOf(e) === 'elite' ? effects.eliteSlowEffectBonus || 0 : 0));
          campShieldControl(this,c,e);
        } else shieldFactor = Math.min(shieldFactor, this._resistedSlow(e, raw));
      }
      if (this.endless && e.campRootRemaining) e.campRootRemaining = Math.max(0,e.campRootRemaining - dt);
      if (this.endless && this._attribute('gateSlowFraction') && dist(this._gateCenter(), e) <= this._attributeSetting('attr_gate_moat', 'gateSlowRange', 100) + e.radius) {
        shieldFactor = Math.min(shieldFactor, this._resistedSlow(e, Math.max(.3, 1 - this._attribute('gateSlowFraction'))));
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
      const banner = e.type === 'infantry' && !(this.endless && (e.noBannerHaste || e.bannerBlockRemaining > 0)) && banners.some(b => alive(b) && dist(b, e) <= 50) ? 1.15 : 1;
      const haste = e.bossTemplateId === 'charger' && e.bossAbilityRemaining > 0 ? 1.4 : 1;
      const proposed = e.progress + e.speed * motion * banner * haste * (this.endless ? e.permanentSpeedFactor || 1 : 1);
      e.progress = this.endless ? heroMovementLimit(this, e, proposed) : proposed; Object.assign(e, this.pathPoint(e.laneId, e.progress));
      if (e.progress >= e.pathLength - EPS) this._escape(e);
    }
    if (this.hp <= 0) { this._finish('lost'); return; }
    if (this.endless) updateSynergyEffects(this);
    this._attackCamps(dt); this._oilBurns(dt); if (this.endless) updateCampFireFields(this,dt); this._attackHeroes(dt); this._projectiles(dt); this._skillDamage(dt);
    const engaged = this.enemies.some(e => alive(e) && !e.invulnerable &&
      (this.camps.some(c => c.type !== 'war_drum' && dist(c, e) <= c.range + e.radius) || this.heroes.some(h => dist(h, e) <= this.heroBasicRange(h) + e.radius)));
    for (const h of this.heroes) {
      const blocked = Math.min(dt, h.rageRecovery); h.rageRecovery = Math.max(0, h.rageRecovery - dt);
      const rate = B.rage.roles[h.role][engaged ? 'engagedPerSec' : 'idlePerSec'];
      if (this.endless) {
        const recoveryWindow = Math.min(dt, Math.max(0, h.postUltimateRageRemaining || 0));
        h.postUltimateRageRemaining = Math.max(0, (h.postUltimateRageRemaining || 0) - dt);
        // The card supplies extra recovery during the fixed six-second normal-rage lockout.
        const gain = ((dt - blocked) + recoveryWindow * this._attribute('postUltimateRageBonus')) * rate * (1 + this._attribute('rageGainBonus') + heroUpgradeState(h).permanentRageGain + synergyRageGainBonus(this,h)) / this._heroRageCycle(h);
        h.rage = Math.min(this.heroMaxRage(h), h.rage + gain);
      } else h.rage = Math.min(100, h.rage + (dt - blocked) * rate);
    }
    this._previewTimer -= dt;
    if (this._previewTimer <= 0) { this._refreshTargets(); this._previewTimer = 0.2; }
    for (const h of this.heroes) if (h.auto && h.rage >= this.heroRageCost(h) - EPS && (!this.endless || h.rageRecovery <= EPS) && !h.reserved) {
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
      if (this._clearedWave !== this.wave) {
        this._clearedWave = this.wave;
        if (this.endless) {
          const food = this._waveConfig(this.wave).completionFoodReward + this._attribute('foodPerWave');
          this.food += food; this.stats.totalFoodEarned += food;
          this._emit('waveFood', { wave: this.wave, food });
        }
        this._emit('waveClear', { wave: this.wave, total: this.waveCount, final: !this.endless && this.wave === this.waveCount });
      }
      if (!this.endless && this.wave === this.waveCount) this._finish('won');
      else if ((this.endless?.choiceEveryWave || this.level.choiceAfterWaves.includes(this.wave)) && this._selectedWave !== this.wave) {
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
    const factor = Math.max(this.endless ? 0 : 0.7, Math.min(1, ...this._buffs.filter(b => b.kind === 'gate').map(b => b.factor)));
    let damage = enemy.leak * enemy.escapeDamageMultiplier * factor;
    if (this.endless) {
      const firstReduction = this._firstLeakThisWave ? 0 : Math.min(1, this._attribute('firstLeakReduction'));
      this._firstLeakThisWave = true;
      damage = Math.max(1, damage * (1 - firstReduction) - this._attribute('gateLeakReduction'));
      if (firstReduction >= 1 || this._gateImmunitiesRemaining > 0) {
        damage = 0; if (this._gateImmunitiesRemaining > 0) this._gateImmunitiesRemaining--;
      }
      damage = heroGateLeak(this, enemy, damage);
    }
    this.hp = Math.max(0, this.hp - damage); this.stats.damageToGate += damage;
    if (this.endless) afterHeroGateDamage(this, damage);
    // Presentation fields only (position, type, max HP) so the renderer/DOM can place gate feedback.
    this._emit('leak', { enemyId: enemy.id, enemyType: enemy.type, x: enemy.x, y: enemy.y, damage, amount: damage, hp: this.hp, maxHp: this.maxHp });
  }
  _finish(state) {
    this.state = state; this.skillQueue = []; for (const h of this.heroes) h.reserved = false;
    this._emit(state === 'won' ? 'win' : 'lose', { hp: this.hp, stars: this.stars, kills: this.kills, bestBurst: this.bestBurst });
  }
  _resistedSlow(e, raw, minimum = .3, bonus = 0) {
    const fraction = B.controlAndDisruption.slowDefaultEffectFractionByClass[classOf(e)] * (B.enemies[e.type].controlEffectFraction || 1) * (1 + bonus);
    return Math.max(minimum, 1 - (1 - raw) * fraction);
  }
  _slow(e, raw, seconds, source) {
    const factor = this._resistedSlow(e, raw); const existing = e.slowEffects.find(s => s.source === source);
    if (existing) { existing.factor = factor; existing.remaining = Math.max(existing.remaining, seconds); }
    else e.slowEffects.push({ factor, remaining: seconds, source });
  }
  _push(e, amount) { e.progress = Math.max(0, e.progress - amount * (B.enemies[e.type].controlEffectFraction || 1)); Object.assign(e, this.pathPoint(e.laneId, e.progress)); }
  _vulnerable(e, factor, seconds, source, heroId = null) {
    const found = e.vulnerability.find(v => v.source === source);
    if (found) { found.factor = factor; found.remaining = seconds; }
    else e.vulnerability.push({ factor, remaining: seconds, source, ...(heroId ? {heroId} : {}) });
  }
  _damage(e, amount, source, cast = null, execute = false, options = {}) {
    if (!alive(e) || e.invulnerable && !options.ignoreInvulnerability) return false;
    const baseVulnerability = Math.max(1, ...e.vulnerability.filter(v => !this.endless || v.source !== 'attribute_dread').map(v => v.factor), this.endless ? e.permanentVulnerability || 1 : 1);
    let vulnerability = this.endless ? synergyVulnerability(this,e) : Math.min(1.25, baseVulnerability);
    if (this.endless && !options.skipIncomingMultipliers) {
      vulnerability *= Math.max(1, ...e.vulnerability.filter(v => v.source === 'attribute_dread').map(v => v.factor));
      const shieldBonus = Math.max(0, ...this.camps.filter(c => c.type === 'shield' && dist(c, e) <= c.range + e.radius).map(c => this._campPassive(c, 'incomingDamageBonus')));
      vulnerability *= 1 + shieldBonus;
      const overlap = this._attribute('overlapDamageBonus');
      if (overlap) vulnerability *= 1 + overlap * Math.min(this._attributeSetting('attr_camp_overlap', 'overlapMaxStacks', 5), this.camps.filter(c => dist(c, e) <= c.range + e.radius).length);
      vulnerability *= heroIncomingMultiplier(this, e);
      vulnerability *= campIncomingMultiplier(this,e,options.camp);
      vulnerability *= synergyTargetMultiplier(this,e);
    }
    if (options.skipIncomingMultipliers) vulnerability = 1;
    const executed = Boolean(execute && e.type === 'infantry' && !e.executeImmune);
    const splashMultiplier = this.endless && options.heroSplash ? synergyOverlapMultiplier(this,cast,e) : 1;
    const inflicted = executed ? e.hp : amount * splashMultiplier * vulnerability * (options.ignoreDamageReduction ? 1 : e.damageTakenMultiplier || 1);
    if (!Number.isFinite(inflicted) || inflicted <= 0) return false;
    const actual = Math.min(e.hp, inflicted); e.hp -= actual; e.hitFlash = 0.1;
    options.onActualDamage?.(actual,executed);
    const stats = this.stats.sourceStats[source] ||= { damage: 0, kills: 0 }; stats.damage += actual;
    const heroId = cast?.heroId || (source.startsWith('hero_') ? source.slice(5) : undefined);
    this._emit('damage', { enemyId: e.id, enemyType: e.type, enemyClass: e.class, x: e.x, y: e.y, amount: actual, hpAfter: Math.max(0, e.hp), maxHp: e.maxHp, source, heroId, castId: cast?.id, executed });
    if (e.hp > EPS) return false;
    e.hp = 0; this.kills++; stats.kills++; this.stats.killsByType[e.type] = (this.stats.killsByType[e.type] || 0) + 1;
    this.food += e.reward; this.stats.totalFoodEarned += e.reward;
    if (cast) { cast.kills++; this.stats.ultimateKills++; this.stats.perHero[cast.heroId].kills++; this.bestBurst = Math.max(this.bestBurst, cast.kills); }
    this._emit('kill', { enemyId: e.id, enemyType: e.type, x: e.x, y: e.y, source, reward: e.reward, heroId,
      amount: actual, radius: e.radius, facing: e.facing, castId: cast?.id, burstKills: cast?.kills, executed });
    if (this.endless) afterHeroEnemyDeath(this, e, cast);
    return true;
  }

  _friendlySpeed(unit) {
    let bonus = Math.max(0, ...this._buffs.filter(b => b.kind === 'speed').map(b => b.bonus));
    for (const c of this.camps) if (c.type === 'war_drum' && dist(c, unit) <= c.range) {
      const drum = this.endless ? drumAttackSpeed(this,c) + (this.heroes.includes(unit) ? (this._campEffects(c).heroBasicAttackSpeedAuraBonus || 0) * drumAuraMultiplier(this,c) : 0) : this._campStats(c).attackSpeedBonus + (this.tactics.has('war_drum_vigor') ? 0.05 : 0);
      bonus = Math.max(bonus,drum);
    }
    if (this.endless && this.camps.includes(unit)) bonus += this._attribute('campAttackSpeedBonus');
    return Math.min(this.endless ? this._campEffects('war_drum').globalAttackSpeedBonusCapOverride || B.camps.war_drum.globalAttackSpeedBonusCap : B.camps.war_drum.globalAttackSpeedBonusCap, bonus);
  }
  _resilience(camp) {
    return this.tactics.has('war_drum_ward') && this.camps.some(c => c.type === 'war_drum' && dist(c, camp) <= c.range) ? 0.25 : 0;
  }
  _campInterval(camp) {
    const hostile = Math.min(0.15, Math.max(0, ...camp.disruptions.map(d => d.bonus))) * (1 - this._resilience(camp));
    const interval = this._campStats(camp).intervalSec * (1 + hostile) / (1 + this._friendlySpeed(camp));
    if (!this.endless) return interval;
    const e = this._campEffects(camp), reduction = (e.intervalReduction || 0) + (camp.level >= 5 ? e.level5IntervalReduction || 0 : 0);
    return interval * Math.max(.01, 1 - this._attribute('campIntervalReduction')) * (1 - reduction);
  }
  _campDamage(camp, enemy, baseDamage, options = {}) {
    const drumDamage = Math.max(0, ...this.camps.filter(c => c.type === 'war_drum' && dist(c, camp) <= c.range).map(c => this._campStats(c).auraDamage * (this.endless ? drumAuraMultiplier(this,c) : 1)));
    let multiplier = (1 + this.teamCommand) * (1 + drumDamage) * (1 + Math.min(0.35, Math.max(0, ...this._buffs.filter(b => b.kind === 'campDamage').map(b => b.bonus))));
    if (camp.type === 'archer' && this.tactics.has('archer_hunt') && ['cavalry', 'armor', 'boss'].includes(enemy.type)) multiplier *= 1.25;
    if (camp.type === 'catapult' && this.tactics.has('catapult_siege') && ['armor', 'boss'].includes(enemy.type)) multiplier *= 1.25;
    if (camp.type === 'crossbow' && classOf(enemy) !== 'ordinary') { multiplier *= 1.25; if (this.tactics.has('crossbow_precision')) multiplier *= 1.25; }
    if (camp.type === 'fire_oil') { if (classOf(enemy) !== 'ordinary' && this.tactics.has('fire_oil_heat')) multiplier *= 1.15; multiplier *= this.map.rule.campModifier?.fireOilDotMultiplier || 1; }
    if (this.endless) {
      const e = this._campEffects(camp), state = campUpgradeState(camp);
      let bonus = this._attribute('campDamageBonus') + this._armyDamageBonus() + (options.attackDamageBonus || 0);
      if (enemy.type === 'armor') bonus += this._attribute('campArmorDamageBonus');
      if (classOf(enemy) === 'elite') bonus += this._attribute('campEliteDamageBonus');
      if (classOf(enemy) === 'boss') bonus += this._attribute('campBossDamageBonus');
      if (camp.type === 'fire_oil' || options.dot) bonus += this._attribute('dotDamageBonus');
      if (e.crowdDamageBonus) bonus += Math.min(e.crowdDamageCap,Math.floor(this.enemies.filter(target => alive(target) && dist(camp,target) <= camp.range + target.radius).length / e.crowdDamagePerEnemies) * e.crowdDamageBonus);
      multiplier *= 1 + bonus;
      if (e.killWaveDamageBonus) multiplier *= 1 + Math.min(e.killWaveDamageCap,state.waveKills * e.killWaveDamageBonus);
      if (camp.type === 'fire_oil') multiplier *= 1 + (e.tickDamageBonus || 0);
      const drumBonus = Math.max(0, ...this.camps.filter(c => c.type === 'war_drum' && dist(c, camp) <= c.range).map(c => (this._campPassive(c, 'campDamageBonus') + (this._campEffects(c).campDamageAuraBonus || 0)) * drumAuraMultiplier(this,c)));
      multiplier *= 1 + drumBonus;
      multiplier *= synergyArmyMultiplier(this);
    }
    return baseDamage * multiplier;
  }
  _attackCamps(dt) {
    for (const camp of this.camps) {
      if (camp.type === 'war_drum') continue;
      this._oilField(camp, dt);
      camp.cooldown = Math.max(0, camp.cooldown - dt); camp.attackCooldown = camp.cooldown;
      if (camp.cooldown > EPS) continue;
      const targets = this.enemies.filter(e => alive(e) && !e.invulnerable && dist(camp, e) <= camp.range + e.radius).sort((a, b) =>
        (this.endless && this._campEffects(camp).targetHighestCurrentHp ? b.hp - a.hp : camp.type === 'crossbow' ? (classOf(b) !== 'ordinary') - (classOf(a) !== 'ordinary') : 0) || priority(a, b));
      if (!targets.length) continue;
      const s = this._campStats(camp); camp.cooldown = this._campInterval(camp);
      if (this.endless) consumeHeroCampAttack(this, camp);
      camp.attackFlash = .12;
      this._emit('attack', { campType: camp.type, slot: camp.slot, x: camp.x, y: camp.y });
      if (camp.type === 'shield') {
        for (const e of targets.slice(0, this.tactics.has('shield_break') ? 5 : s.maxTargets)) this._campHit(camp,e,this._campDamage(camp, e, s.damage), 'shield');
      } else {
        const e = targets[0], effects = this.endless ? this._campEffects(camp) : {}, attackDamageBonus = this.endless ? consumeCampAttackBonus(this,camp) : 0;
        const ledger = effects.extraAttackTargets ? { ids:new Set(targets.slice(0,effects.attackUniqueTargetCap).map(target => target.id)), cap:effects.attackUniqueTargetCap } : null;
        this.projectiles.push({ type: camp.type, campType: camp.type, camp, x: camp.x, y: camp.y, targetId: e.id, targetX: e.x, targetY: e.y,
          speed: B.camps[camp.type].projectileSpeed, damage: s.damage || 0, radius: 3, life: 4, ...(this.endless ? { attackLedger:ledger, attackDamageBonus } : {}) });
        if (this.endless && effects.extraAttackTargets) for (const target of targets.slice(1,1 + effects.extraAttackTargets)) {
          this.projectiles.push({ type:camp.type,campType:camp.type,camp,x:camp.x,y:camp.y,targetId:target.id,targetX:target.x,targetY:target.y,
            speed:B.camps[camp.type].projectileSpeed,damage:s.damage * effects.extraAttackTargetDamageMultiplier,radius:3,life:4,bonusShot:true,attackLedger:ledger });
        }
        if (this.endless && effects.extraProjectiles && targets.length > 1) {
          const candidates = targets.slice(1), target = candidates[Math.floor(this.rng() * candidates.length)];
          this.projectiles.push({ type:camp.type,campType:camp.type,camp,x:camp.x,y:camp.y,targetId:target.id,targetX:target.x,targetY:target.y,
            speed:B.camps[camp.type].projectileSpeed,damage:s.damage * effects.extraProjectileDamageMultiplier,radius:3,life:4,bonusShot:true });
        }
        if (camp.type === 'archer' && this._levelFive(camp) && this.rng() < this._campPassive(camp, 'extraArrowChance')) {
          this.projectiles.push({ type: camp.type, campType: camp.type, camp, x: camp.x, y: camp.y, targetId: e.id, targetX: e.x, targetY: e.y,
            speed: B.camps.archer.projectileSpeed, damage: s.damage * this._campPassive(camp, 'extraArrowDamageMultiplier'), radius: 3, life: 4, bonusShot: true, attackLedger:ledger });
          this._emit('campPassive', { campType: camp.type, slot: camp.slot, passive: 'extraArrow' });
        }
      }
    }
  }
  _oilField(camp, dt) {
    if (this.endless) { if (camp.type === 'fire_oil') this._endlessOilField(camp,dt); return; }
    const f = camp.field; if (!f) return;
    f.remaining -= dt; f.tick -= dt;
    if (f.tick <= EPS) {
      f.tick += 0.75;
      for (const e of this.enemies) if (alive(e) && dist(e, f) <= f.radius + e.radius) {
        this._damage(e, this._campDamage(camp, e, this._campStats(camp).tickDamage), 'fire_oil');
        if (alive(e) && this.tactics.has('fire_oil_slow')) this._slow(e, 0.75, 1, 'oil_' + camp.slot);
      }
    }
    if (this._levelFive(camp)) {
      // The narrow outer ring ignites once per second while a unit grazes the field.
      const duration = this._campPassive(camp, 'edgeBurnDurationSec');
      for (const e of this.enemies) if (alive(e) && dist(e, f) > f.radius + e.radius && dist(e, f) <= f.radius + this._campPassive(camp, 'edgeRadiusAdd') + e.radius) {
        const burn = (e.oilBurns ||= []).find(b => b.slot === camp.slot);
        if (burn) burn.remaining = duration;
        else e.oilBurns.push({ slot: camp.slot, camp, remaining: duration, tick: .75 });
      }
    }
    if (f.remaining <= EPS) camp.field = null;
  }
  _endlessOilField(camp,dt) {
    const fields = oilFields(camp), effects = this._campEffects(camp), damaged = new Set();
    for (const enemy of this.enemies) if (alive(enemy)) {
      const inside = fields.some(field => dist(enemy,field) <= field.radius + enemy.radius);
      const coverage = enemy.oilCoverageSlots ||= new Set();
      if (coverage.has(camp.slot) && !inside && effects.exitBurnDurationSec) {
        const burn = (enemy.oilBurns ||= []).find(b => b.slot === camp.slot);
        const values = { kind:'exit',slot:camp.slot,camp,remaining:effects.exitBurnDurationSec,tick:effects.exitBurnTickSec,tickSec:effects.exitBurnTickSec,damageMultiplier:effects.exitBurnTickDamageMultiplier };
        const onEdge = this._levelFive(camp) && fields.some(field => dist(enemy,field) > field.radius + enemy.radius && dist(enemy,field) <= field.radius + this._campPassive(camp,'edgeRadiusAdd') + enemy.radius);
        if (onEdge && (!burn || burn.kind === 'exit')) {
          const edge = { slot:camp.slot,camp,remaining:this._campPassive(camp,'edgeBurnDurationSec'),tick:.75,exitTail:values };
          if (burn) { delete burn.kind; delete burn.tickSec; delete burn.damageMultiplier; Object.assign(burn,edge); } else enemy.oilBurns.push(edge);
        }
        else if (burn && burn.kind !== 'exit' && burn.remaining > 0) { burn.exitTail = values; }
        else if (burn) Object.assign(burn,values); else enemy.oilBurns.push(values);
      }
      if (inside) coverage.add(camp.slot); else coverage.delete(camp.slot);
    }
    for (const field of fields) {
      field.remaining -= dt; field.tick -= dt;
      if (field.tick <= EPS) {
        field.tick += .75;
        for (const enemy of this.enemies) if (alive(enemy) && !damaged.has(enemy.id) && dist(enemy,field) <= field.radius + enemy.radius) {
          damaged.add(enemy.id); this._campHit(camp,enemy,this._campDamage(camp,enemy,this._campStats(camp).tickDamage),'fire_oil');
          if (alive(enemy) && this.tactics.has('fire_oil_slow')) this._slow(enemy,.75,1,'oil_' + camp.slot);
        }
      }
      if (this._levelFive(camp)) for (const enemy of this.enemies) if (alive(enemy) && dist(enemy,field) > field.radius + enemy.radius && dist(enemy,field) <= field.radius + this._campPassive(camp,'edgeRadiusAdd') + enemy.radius) {
        const burn = (enemy.oilBurns ||= []).find(b => b.slot === camp.slot);
        if (burn?.kind === 'exit' || burn?.exitTail) continue;
        if (burn) burn.remaining = this._campPassive(camp,'edgeBurnDurationSec');
        else enemy.oilBurns.push({ slot:camp.slot,camp,remaining:this._campPassive(camp,'edgeBurnDurationSec'),tick:.75 });
      }
    }
    if (camp.fields) { camp.fields = fields.filter(field => field.remaining > EPS); camp.field = camp.fields.at(-1) || null; }
    else if (camp.field?.remaining <= EPS) camp.field = null;
  }
  _oilBurns(dt) {
    if (!this.endless) return;
    for (const e of this.enemies) {
      for (const burn of e.oilBurns || []) {
        const active = Math.min(dt, burn.remaining); burn.remaining -= dt; burn.tick -= active;
        if (burn.exitTail) burn.exitTail.remaining = Math.max(0,burn.exitTail.remaining - dt);
        const insideField = oilFields(burn.camp).some(field => dist(e, field) <= field.radius + e.radius);
        if (burn.tick <= EPS && alive(e)) {
          burn.tick += burn.tickSec || .75;
          if (!insideField) this._campHit(burn.camp,e,this._campDamage(burn.camp,e,this._campStats(burn.camp).tickDamage) * (burn.damageMultiplier ?? 1),'fire_oil');
        }
        if (burn.remaining <= EPS && burn.exitTail?.remaining > EPS) {
          const tail = burn.exitTail; tail.tick = Math.min(tail.tick,tail.remaining); delete burn.exitTail; Object.assign(burn,tail);
        }
      }
      if (e.oilBurns) e.oilBurns = e.oilBurns.filter(b => b.remaining > EPS);
    }
  }
  _campHit(camp, enemy, amount, source, options = {}) {
    if (this.endless && alive(enemy) && !enemy.invulnerable) {
      const e = this._campEffects(camp);
      if (e.hitIncomingDamageBonus) this._vulnerable(enemy,1 + e.hitIncomingDamageBonus,Infinity,'camp_mark_' + camp.slot);
      if (e.maxHpBonusDamageFraction && e.maxHpBonusEnemyTypes.includes(enemy.type) && !options.dot) amount += enemy.maxHp * e.maxHpBonusDamageFraction * (options.branchScale ?? 1);
      if (e.hitSlowFactor && alive(enemy)) this._slow(enemy,e.hitSlowFactor,e.hitSlowDurationSec,'camp_hit_' + camp.slot);
    }
    const killed = this._damage(enemy, amount, source,null,false,{camp});
    if (killed && this.endless) campKilledEnemy(this,camp);
    if (killed && this._campPassive(camp, 'resetCooldownOnEliteOrBossKill') && classOf(enemy) !== 'ordinary') {
      camp.cooldown = 0; camp.attackCooldown = 0;
      this._emit('campPassive', { campType: camp.type, slot: camp.slot, passive: 'killReset' });
    }
    return killed;
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
        if (this.endless) radius += this._campEffects(p.camp).blastRadiusAdd || 0;
        const mod = this.map.rule.campModifier; if (mod?.slot === p.camp.slot && mod.catapultRadiusMultiplier) radius *= mod.catapultRadiusMultiplier;
        const point = { x: p.targetX, y: p.targetY };
        const affected = this.enemies.filter(e => alive(e) && dist(e, point) <= radius + e.radius).sort((a, b) => dist(a, point) - dist(b, point) || priority(a, b));
        for (const victim of affected) this._slow(victim, this.tactics.has('catapult_shock') ? 0.65 : this._campPassive(p.camp, 'impactSpeedFactor') || 0.8,
          this.tactics.has('catapult_shock') ? 2.5 : this._campPassive(p.camp, 'impactSlowDurationSec') || 1.5, 'stone_' + p.camp.slot);
        const cap = this.endless ? this._campEffects(p.camp).damageTargetCapOverride || 6 : 6;
        for (const victim of affected.slice(0,cap)) this._campHit(p.camp,victim,this._campDamage(p.camp,victim,p.damage),'catapult');
        if (this.endless) createCatapultFire(this,p.camp,point,radius);
        this.effects.push({ type: 'explosion', x: point.x, y: point.y, radius, life: 0.3, age: 0, time: 0 });
      } else if (p.type === 'fire_oil') {
        const extras = this.endless ? this._campEffects(p.camp) : {};
        const radius = this._campStats(p.camp).fieldRadius + (this.tactics.has('fire_oil_spread') ? 16 : 0) + (extras.fieldRadiusAdd || 0);
        const duration = this.endless ? (this._campStats(p.camp).fieldDurationSec ?? B.camps.fire_oil.fieldDurationSec) + (extras.fieldDurationSecAdd || 0) : 3;
        if (this.endless) { createOilField(this,p.camp,{x:p.targetX,y:p.targetY},radius,duration); continue; }
        if (p.camp.field) { Object.assign(p.camp.field, { x: p.targetX, y: p.targetY, radius, remaining: duration }); }
        else p.camp.field = { x: p.targetX, y: p.targetY, radius, remaining: duration, tick: 0.75 };
        const visual = this.effects.find(effect => effect.type === 'oil' && effect.campSlot === p.camp.slot);
        const values = { type: 'oil', campSlot: p.camp.slot, x: p.targetX, y: p.targetY, radius, life: duration, age: 0, time: 0 };
        if (visual) Object.assign(visual, values); else this.effects.push(values);
      } else if (e) {
        this._campHit(p.camp,e,this._campDamage(p.camp,e,p.damage,{attackDamageBonus:p.attackDamageBonus || 0}),p.type);
        // The volley may hit the same main target, but never creates another pierce chain.
        if (!p.bonusShot && p.type === 'archer' && this.tactics.has('archer_volley') && alive(e)) this._campHit(p.camp,e,this._campDamage(p.camp,e,p.damage) * .25,p.type,{branchScale:.25});
        if (!p.bonusShot && this.tactics.has(p.type + '_pierce')) {
          const direction = { x: p.targetX - p.camp.x, y: p.targetY - p.camp.y }; const norm = Math.hypot(direction.x, direction.y) || 1;
          const next = this.enemies.filter(v => alive(v) && v.id !== p.targetId).map(v => ({ v, forward: (v.x - p.targetX) * direction.x / norm + (v.y - p.targetY) * direction.y / norm,
            side: Math.abs((v.x - p.targetX) * direction.y / norm - (v.y - p.targetY) * direction.x / norm) }))
            .filter(a => a.forward >= 0 && a.forward <= 125 && a.side <= 25 + a.v.radius && (!p.attackLedger || p.attackLedger.ids.has(a.v.id) || p.attackLedger.ids.size < p.attackLedger.cap)).sort((a, b) => a.forward - b.forward || a.v.id - b.v.id)[0];
          if (next) { p.attackLedger?.ids.add(next.v.id); this._campHit(p.camp,next.v,this._campDamage(p.camp,next.v,p.damage,{attackDamageBonus:p.attackDamageBonus || 0}) * .35,p.type,{branchScale:.35}); }
        }
      }
    }
    this.projectiles = this.projectiles.filter(p => p.life > 0);
  }
  _attackHeroes(dt) {
    for (const h of this.heroes) {
      h.attackCooldown = Math.max(0, h.attackCooldown - dt); if (h.attackCooldown > EPS) continue;
      // Leap is visual only, but this hero cannot attack from the wall until back.
      if (h.id === 'xiahou_dun' && h.castingRemaining > EPS) continue;
      const targets = this.enemies.filter(e => alive(e) && !e.invulnerable && dist(h, e) <= this.heroBasicRange(h) + e.radius).sort(priority);
      if (!targets.length) continue; h.attackCooldown = h.definition.attack.intervalSec / (1 + this._friendlySpeed(h));
      if (this.endless) h.attackCooldown /= 1 + this._attribute('heroAttackSpeedBonus');
      h.attackFlash = .12;
      for (const e of targets.slice(0, h.definition.attack.maxTargets)) this._damage(e, h.definition.attack.damage * this.heroDamageMultiplier(h), 'hero_' + h.id);
      this._emit('heroAttack', { heroId: h.id, x: h.x, y: h.y });
    }
  }

  _enemyAbilities(living, dt) {
    for (const e of living) {
      e.abilityTimer += dt; e.bossAbilityRemaining = Math.max(0, e.bossAbilityRemaining - dt);
      e.damageTakenMultiplier = e.bossTemplateId === 'guardian' && e.bossAbilityRemaining > EPS ? 0.75 : 1;
      if (this.endless && e.anchorDamageTakenMultiplier) e.damageTakenMultiplier = Math.min(e.damageTakenMultiplier, e.anchorDamageTakenMultiplier);
      if (this.endless && e.blindRemaining > 0) continue;
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
          const wave = this._waveConfig(this.wave);
          const summons = Array.from({ length: 6 }, () => ({ type: 'infantry', lane: e.pathSide, at: this._waveTime, wave, progress: e.progress, reward: 0, summoned: true }));
          this._spawnQueue.splice(this._spawnIndex, 0, ...summons); this.stats.scheduledEnemies += 6;
        } else if (e.bossTemplateId === 'siege_lord') {
          for (const camp of this.camps.filter(c => c.type !== 'war_drum').sort((x, y) => dist(e, x) - dist(e, y) || x.slot - y.slot).slice(0, 2)) camp.disruptions.push({ source: 'boss_' + e.id, bonus: 0.15, remaining: 3 });
        } else { e.bossAbilityRemaining = 4; if (e.bossTemplateId === 'guardian') e.damageTakenMultiplier = 0.75; }
      }
    }
  }

  _score(e) { return (classOf(e) === 'boss' ? 2.5 : classOf(e) === 'elite' ? 1.25 : 1) * (1 + 0.15 * e.progress / e.pathLength); }
  _gateCenter() {
    return this.paths.reduce((point,path) => ({x:point.x+path.points.at(-1).x/this.paths.length,y:point.y+path.points.at(-1).y/this.paths.length}),{x:0,y:0});
  }
  _bestLaneStrip(path, enemies, width, length) {
    const projected=enemies.map(enemy => ({enemy,...this._pathProjection(path.id,enemy)}))
      .filter(entry => entry.distance <= width/2+entry.enemy.radius+EPS);
    const maxStart=Math.max(0,path.length-length), center=projected.length ? projected.reduce((sum,entry)=>sum+entry.progress/projected.length,0) : path.length/2;
    // In one dimension membership changes only at an expanded unit's two edges.
    // Include the natural cluster center so equal-coverage casts are not grazes.
    const starts=[0,maxStart,clamp(center-length/2,0,maxStart)];
    for (const entry of projected) starts.push(clamp(entry.progress-entry.enemy.radius-length,0,maxStart),clamp(entry.progress+entry.enemy.radius,0,maxStart));
    let best=null;
    for (const s0 of starts) {
      const s1=Math.min(path.length,s0+length);
      const hits=projected.filter(entry=>entry.progress>=s0-entry.enemy.radius-EPS && entry.progress<=s1+entry.enemy.radius+EPS);
      const count=hits.length, score=hits.reduce((sum,entry)=>sum+this._score(entry.enemy),0), distance=Math.abs((s0+s1)/2-center);
      if (!best || count>best.count || count===best.count && (score>best.score+EPS || Math.abs(score-best.score)<=EPS && distance<best.distance-EPS)) best={laneId:path.id,s0,s1,count,score,distance};
    }
    return best;
  }
  _target(h) {
    const u = this.heroUltimate(h); const extra = u.upgradeEffects || {};
    const enemies = this.enemies.filter(e => alive(e) && (!e.invulnerable || extra.ignoreDamageReduction || extra.infantryExecuteIgnoresInvulnerability && e.type === 'infantry' && !e.executeImmune && e.hp / e.maxHp < extra.infantryExecuteBelowHpFraction));
    const base = { shape: u.shape, x: h.x, y: h.y, originX:h.x, originY:h.y, angle: -Math.PI / 2, width: u.width || 0, length: u.length || u.surgeLength || u.range || 0,
      radius: u.radius || 0, laneId: null, count: 0, ordinaryCount: 0, infantryCount: 0, bossCount: 0, targetIds: [] };
    if (!this.endless && h.id === 'guan_yu' && this.tactics.has('guan_yu_width')) base.width += 24;
    if (['guan_yu', 'zhang_fei'].includes(h.id)) base.width += h.signatureBonuses.ultimateWidthAdd;
    if (!this.endless && h.id === 'zhou_yu' && this.tactics.has('zhou_yu_radius')) base.width += B.tactics.zhou_yu_radius.effects.fireWidthAdd;
    if (u.shape === 'gate_lane_surge') {
      Object.assign(base,this._gateCenter()); base.laneIds=this.paths.map(path=>path.id);
      base.targetIds=enemies.filter(e=>this._inShape(e,base,u)).map(e=>e.id);
    } else if (u.shape === 'gate_half_wave') {
      Object.assign(base,this._gateCenter()); base.arcDegrees=u.arcDegrees;
      base.targetIds=enemies.filter(e=>this._inShape(e,base,u)).map(e=>e.id);
    } else if (['lane_fire_strip','lane_volley_strip'].includes(u.shape)) {
      let paths=this.paths;
      if (u.shape === 'lane_fire_strip') paths=[...paths].sort((a,b)=>
        enemies.filter(e=>e.laneId===b.id).reduce((sum,e)=>sum+this._score(e),0)-enemies.filter(e=>e.laneId===a.id).reduce((sum,e)=>sum+this._score(e),0) || a.id.localeCompare(b.id)).slice(0,1);
      const strip=paths.map(path=>this._bestLaneStrip(path,enemies,base.width,base.length))
        .sort((a,b)=>b.count-a.count || b.score-a.score || a.distance-b.distance || a.laneId.localeCompare(b.laneId))[0];
      Object.assign(base,{laneId:strip.laneId,s0:strip.s0,s1:strip.s1},this.pathPoint(strip.laneId,(strip.s0+strip.s1)/2));
      if (u.allLanes) {
        base.strips = this.paths.map(path => ({ ...this._bestLaneStrip(path, enemies, base.width, base.length), width: base.width }));
        base.laneIds = base.strips.map(item => item.laneId);
      }
      if (extra.fireRangeBonusPerCamp) {
        const camps = this.camps.filter(camp => this._inShape({ ...camp, radius: 0 }, base, u)).length;
        const bonus = Math.min(extra.fireRangeBonusCap, camps * extra.fireRangeBonusPerCamp);
        base.width *= 1 + bonus; base.length *= 1 + bonus;
        const expanded = this._bestLaneStrip(this.paths.find(path => path.id === base.laneId), enemies, base.width, base.length);
        Object.assign(base, { s0: expanded.s0, s1: expanded.s1 }, this.pathPoint(base.laneId, (expanded.s0 + expanded.s1) / 2));
      }
      base.targetIds=enemies.filter(e=>this._inShape(e,base,u)).map(e=>e.id);
    } else if (u.shape === 'delayed_multi_circle') {
      base.circles=maximumSeparatedCircleCoverage(enemies,base.radius,u.count,u.minGap,{x:h.x,y:Math.max(100,h.y-145)},e=>this._score(e));
      if (extra.retargetFarCircleIfClustered && base.circles.length >= 3) {
        const first = enemies.filter(e => dist(e, base.circles[0]) <= base.radius + e.radius);
        const second = enemies.filter(e => dist(e, base.circles[1]) <= base.radius + e.radius);
        if (first.some(a => second.some(b => a.id !== b.id && dist(a, b) < extra.retargetClusterDistance))) {
          const far = enemies.filter(e => base.circles.slice(0, 2).every(circle => dist(e, circle) >= u.minGap))
            .sort((a, b) => Math.min(...base.circles.slice(0, 2).map(circle => dist(b, circle))) - Math.min(...base.circles.slice(0, 2).map(circle => dist(a, circle))) || a.id - b.id)[0];
          if (far) { base.circles[2] = { x: far.x, y: far.y, radius: base.radius }; base.retargetedCircle = true; }
        }
      }
      base.x=base.circles[0].x; base.y=base.circles[0].y;
      base.targetIds=enemies.filter(e=>this._inShape(e,base,u)).map(e=>e.id);
    } else if (u.shape === 'leap_strike_circle') {
      const point=maximumCircleCoverage(enemies,base.radius,{x:h.x,y:Math.max(100,h.y-145)},e=>this._score(e),{origin:h,maxDistance:u.leapReach});
      base.x=base.landX=point.x; base.y=base.landY=point.y;
      base.targetIds=enemies.filter(e=>this._inShape(e,base,u)).map(e=>e.id);
    } else if (u.shape === 'lane_mines') {
      const routes = this.paths.map(p => { const hit = enemies.filter(e => e.laneId === p.id); return { id: p.id, count: hit.length, score: hit.reduce((n, e) => n + this._score(e), 0), offset: Math.abs(this.pathPoint(p.id, p.length * .55).x - h.x) }; })
        .sort((a, b) => b.count - a.count || b.score - a.score || a.offset - b.offset || a.id.localeCompare(b.id));
      base.laneIds = routes.slice(0, 2).map(p => p.id); base.targetIds = enemies.filter(e => base.laneIds.includes(e.laneId)).map(e => e.id);
    } else if (u.shape === 'three_distinct_target_snipes') {
      const candidates = enemies.filter(e => dist(h, e) <= u.range + e.radius).sort((a, b) => (classOf(b) === 'boss') - (classOf(a) === 'boss') || (classOf(b) === 'elite') - (classOf(a) === 'elite') || priority(a, b));
      base.targetIds = candidates.slice(0, 3).map(e => e.id);
      if (this.endless) {
        base.snipeCandidateIds = candidates.map(e => e.id);
        base.shotTargetIds = extra.snipeCanRepeatTargets && base.targetIds.length ? Array(u.snipeCount).fill(base.targetIds[0]) : base.targetIds.slice(0, u.snipeCount);
        base.targetIds = [...new Set(base.shotTargetIds)];
      }
    } else if (u.shape === 'lane_following_charge') {
      const route = this.paths.map(p => { const hit = enemies.filter(e => this._inShape(e, { ...base, laneId: p.id }, u)); return { id: p.id, count: hit.length, score: hit.reduce((n, e) => n + this._score(e), 0), offset: Math.abs(this.pathPoint(p.id, p.length * .55).x - h.x) }; })
        .sort((a, b) => b.count - a.count || b.score - a.score || a.offset - b.offset || a.id.localeCompare(b.id))[0];
      base.laneId = route.id; base.targetIds = enemies.filter(e => this._inShape(e, base, u)).map(e => e.id);
      if (u.laneCount) {
        base.laneIds = this.paths.map(path => ({ id: path.id, score: enemies.filter(e => this._inShape(e, { ...base, laneId: path.id }, u)).reduce((total, e) => total + this._score(e), 0) }))
          .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id)).slice(0, u.laneCount).map(path => path.id);
        base.targetIds = enemies.filter(e => this._inShape(e, base, u)).map(e => e.id);
      }
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
    if (target.shape === 'delayed_multi_circle') return target.circles.some(circle=>dist(e,circle)<=circle.radius+e.radius+EPS);
    if (target.shape === 'delayed_multi_cross') return target.crosses.some(cross =>
      Math.abs(e.x - cross.x) <= cross.length / 2 + e.radius + EPS && Math.abs(e.y - cross.y) <= cross.width / 2 + e.radius + EPS ||
      Math.abs(e.x - cross.x) <= cross.width / 2 + e.radius + EPS && Math.abs(e.y - cross.y) <= cross.length / 2 + e.radius + EPS);
    if (target.shape === 'gate_half_wave') return e.y<=target.y+e.radius+EPS && dist(e,target)<=target.radius+e.radius+EPS;
    if (['lane_fire_strip','lane_volley_strip'].includes(target.shape)) {
      if (target.strips) return target.strips.some(strip => this._inShape(e, { ...target, ...strip, strips: null }, u));
      const projection=this._pathProjection(target.laneId,e);
      return projection.distance<=target.width/2+e.radius+EPS && projection.progress>=target.s0-e.radius-EPS && projection.progress<=target.s1+e.radius+EPS;
    }
    if (target.shape === 'gate_lane_surge') return target.laneIds.some(laneId=>{
      const projection=this._pathProjection(laneId,e), path=this.paths.find(p=>p.id===laneId);
      return projection.distance<=target.width/2+e.radius+EPS && projection.progress>=Math.max(0,path.length-target.length)-e.radius-EPS;
    });
    if (target.shape === 'lane_following_charge') {
      if (target.laneIds) return target.laneIds.some(laneId => this._inShape(e, { ...target, laneId, laneIds: null }, u));
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
    if (h.rage < this.heroRageCost(h) - EPS || h.rageRecovery > EPS) return no('无双尚未蓄满');
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
    const nextHero = this.heroes.find(h => h.id === this.skillQueue[0].heroId);
    if (this.endless && (nextHero.rageRecovery > EPS || nextHero.rage < this.heroRageCost(nextHero) - EPS)) return;
    const request = this.skillQueue.shift(); const h = this.heroes.find(h => h.id === request.heroId);
    h.reserved = false;
    if (request.auto) { request.target = this._target(h); if (!this._canAuto(h, request.target)) { this.stats.cancelledAuto++; this._emit('skillCancelled', { heroId: h.id }); return; } }
    h.rage = 0; h.rageRecovery = this.endless ? 6 * this._heroRageCycle(h) : 6; this._lastSkillTime = this.time; this._beginCast(h, request.target);
    if (this.endless) h.postUltimateRageRemaining = this._attributeSetting('attr_rage_recovery', 'postUltimateRageDurationSec', 4);
  }
  _beginCast(h, target) {
    h.casting = true; h.castingRemaining = .9;
    if (this.endless) campUltimateStarted(this);
    const u = this.heroUltimate(h); const cast = { id: ++this._castSerial, heroId: h.id, hero: h, target, ultimate: u, age: 0, kills: 0,
      hits: new Map(), finished: false, nextTick: u.firstTickAtSec || 0, life: u.durationSec || 0.9, kind: 'instant', tickCount: 0 };
    if (this.endless) beginHeroUpgradeCast(this, cast);
    if (this.endless) beginSynergyCast(this,cast);
    this.stats.ultimateCasts++; const heroStats = this.stats.perHero[h.id] ||= { casts: 0, kills: 0 }; heroStats.casts++;
    this._casts.push(cast);
    const visualLife = u.delaySec ? u.delaySec + 0.35 : Math.max(0.9, u.durationSec || 0, u.bannerLingerSec || 0, u.shape==='gate_half_wave' ? u.buffDurationSec : 0);
    this.effects.push({ type: 'ultimate', heroId: h.id, ...target, targets: this.enemies.filter(e => target.targetIds.includes(e.id)).map(e => ({ id: e.id, x: e.x, y: e.y })),
      x: target.x, y: target.y, age: 0, time: 0, started:this.time, life: visualLife, ...(this.endless ? { ultimate: u } : {}) });
    this._emit('ultimate', { heroId: h.id, name: h.name, skillName: u.name, burstId: cast.id, ...target, kills: 0 });
    if (u.allyAttackSpeedBonus) this._buffs.push({ kind: 'speed', bonus: u.allyAttackSpeedBonus, remaining: u.buffDurationSec });
    if (u.allyCampDamageBonus) this._buffs.push({ kind: 'campDamage', bonus: u.allyCampDamageBonus, remaining: u.buffDurationSec });
    if (u.healMaxGateHpFraction) {
      const fraction = Math.min(u.healFractionCap, u.healMaxGateHpFraction * B.metaProgression.skillLevel.numericDamageMultipliers[h.skillLevel - 1]);
      const heal = Math.min(this.maxHp - this.hp, u.upgradeEffects?.healLostHpFraction ? (this.maxHp - this.hp) * u.upgradeEffects.healLostHpFraction : this.maxHp * fraction); this.hp += heal; this._emit('heal', { heroId: h.id, heal });
    }
    if (u.gateIncomingDamageFactor) this._buffs.push({ kind: 'gate', factor: u.gateIncomingDamageFactor, remaining: u.buffDurationSec });
    if (['delayed_locked_circle','delayed_multi_circle','leap_strike_circle','thrown_banner_circle'].includes(u.shape)) {
      cast.kind = 'delayed'; cast.hitAt=u.landAtSec ?? u.flightSec ?? u.delaySec; cast.life=Math.max(u.presentationLockSec,cast.hitAt+0.1);
    }
    else if (u.shape === 'gate_lane_surge') { cast.kind='surge'; cast.life=u.surgeSec; }
    else if (u.shape === 'gate_half_wave') { cast.kind='wave'; cast.life=u.waveSec; }
    else if (u.tickIntervalSec) { cast.kind = 'field'; if (!this.endless && h.id === 'zhou_yu' && this.tactics.has('zhou_yu_duration')) cast.life += 1; this.effects.push({ type: 'field', heroId: h.id, ...target, life: cast.life, age: 0, time: 0, ...(this.endless ? { ultimate: u } : {}) }); }
    else if (u.passAtSec) { cast.kind = 'passes'; cast.pass = 0; this._hitCast(cast); cast.pass++; }
    else if (u.shape === 'lane_mines') {
      cast.kind = 'mines'; cast.mines = target.laneIds.flatMap(laneId => u.laneProgressFractions.map(fraction => ({ ...this.pathPoint(laneId, this.paths.find(p => p.id === laneId).length * fraction), laneId, triggered: false })));
      for (const mine of cast.mines) this.effects.push({ type: 'mine', heroId: h.id, ...mine, radius: u.triggerRadius, life: cast.life, age: 0, time: 0, castId: cast.id, ...(this.endless ? { ultimate: u } : {}) });
    } else if (this.endless && u.snipeIntervalSec) {
      cast.kind = 'snipes'; cast.shot = 0; cast.nextShotAt = 0; this._fireSnipe(cast); cast.nextShotAt = u.snipeIntervalSec;
    } else if (u.roarWindow) { cast.kind = 'roar'; this._hitCast(cast);
    } else if (u.frontTravelSec) cast.kind = 'sweep';
    else this._hitCast(cast);
  }
  _hitCast(cast, override = null, hitOptions = {}) {
    const h = cast.hero; const u = cast.ultimate || (this.endless ? this.heroUltimate(h) : h.definition.ultimate);
    const target = this.endless ? effectiveSynergyTarget(this,cast,override || cast.target) : override || cast.target;
    if (this.endless && !cast.ultimate) cast.ultimate = u;
    if (this.endless) ensureSynergyCast(cast);
    const extras = u.upgradeEffects || {};
    for (const e of this.enemies) {
      const specialExecute = extras.infantryExecuteIgnoresInvulnerability && e.type === 'infantry' && !e.executeImmune && e.hp / e.maxHp < extras.infantryExecuteBelowHpFraction;
      if (!alive(e) || e.invulnerable && !specialExecute && !extras.ignoreDamageReduction) continue;
      const forced = this.endless && (hitOptions.forceIds?.has(e.id) || cast.synergyForcedPassIds?.has(e.id));
      if (!forced && !this._inShape(e,target,u) || hitOptions.onlyIds && !hitOptions.onlyIds.has(e.id) || hitOptions.excludeShape && this._inShape(e,hitOptions.excludeShape.target,hitOptions.excludeShape.ultimate)) continue;
      const oldHits = cast.hits.get(e.id) || 0; const maximum = u.maxTicksPerEnemyPerCast || u.maxHitsPerEnemyPerCast || 1;
      if (oldHits >= maximum && !hitOptions.extraHit) continue;
      const klass = classOf(e);
      const damageTable = u.tickDamageByClass || u.damagePerPassByClass || u.damagePerMineByClass || u.damageByClass;
      const baseAmount = (damageTable?.[klass] || 0) * this.heroDamageMultiplier(h, true, Boolean(u.tickIntervalSec)) * (u.damageMultiplier || 1) * (hitOptions.damageMultiplier ?? 1) * (klass === 'boss' ? 1 + (extras.bossUltimateDamageBonus || 0) : 1);
      const candidate = this.endless && !hitOptions.noCombo ? prepareHeroCombo(this,cast,e) : null;
      const comboMultiplier = this.endless ? synergyHitMultiplier(this,cast,e,candidate) : 1;
      const amount = this.endless ? baseAmount * comboMultiplier : baseAmount;
      cast.hits.set(e.id, oldHits + 1);
      if (this.endless) beforeHeroHit(this, cast, e);
      if (this.endless) beforeSynergyHit(this,cast,e);
      if (u.incomingDamageMultiplier && !extras.permanentVulnerability) this._vulnerable(e, u.incomingDamageMultiplier, u.vulnerabilityDurationSec, 'skill_' + cast.id,this.endless ? h.id : null);
      if (this.endless && this._attribute('ultimateVulnerabilityBonus')) this._vulnerable(e, 1 + this._attribute('ultimateVulnerabilityBonus'), this._attributeSetting('attr_hero_dread', 'ultimateVulnerabilityDurationSec', 5), 'attribute_dread');
      this._damage(e, amount, 'ultimate_' + h.id, cast, u.ordinaryExecute || specialExecute || this.endless && synergyCanExecute(this,cast,e), {
        ignoreInvulnerability: specialExecute || extras.ignoreDamageReduction, ignoreDamageReduction: extras.ignoreDamageReduction,
        ...(this.endless ? {onActualDamage:(actual,executed) => recordSynergyHit(this,cast,e,actual,executed,comboMultiplier,candidate,!hitOptions.noCombo)} : {}) });
      if (this.endless) afterHeroHit(this, cast, e, baseAmount * synergyHitMultiplier(this,cast,e,candidate,true));
      if (!alive(e)) continue;
      if (u.pushbackByClass?.[klass]) {
        const push = u.pushbackByClass[klass] + (!this.endless && h.id === 'guan_yu' && klass === 'elite' && this.tactics.has('guan_yu_press') ? 16 : 0);
        this._push(e,push * (this.endless ? cast.synergyPushMultiplier || 1 : 1)); if (this.endless) recordSynergyPush(cast,e,push);
      }
      if (u.hitSlowSec) this._slow(e, u.hitSpeedFactor || 0.65, u.hitSlowSec, 'skill_' + cast.id);
      if (u.eliteStunSec && klass === 'elite') e.stunRemaining = Math.max(e.stunRemaining, u.eliteStunSec * (B.enemies[e.type].controlEffectFraction || 1));
      if (u.backwardProgressPerSecByClass) {
        let push = (u.backwardProgressPerSecByClass[klass] || 0) * u.tickIntervalSec;
        if (this.endless) {
          const totals = cast.pushTotals ||= new Map(), used = totals.get(e.id) || 0;
          push = Math.min(push, Math.max(0, (u.totalBackwardProgressCapByClass[klass] || 0) - used)); totals.set(e.id, used + push);
        }
        this._push(e, push);
      }
    }
    if (this.endless) finishSynergyHitBatch(this);
  }
  _skillDamage(dt) {
    for (const cast of this._casts) {
      const before = cast.age; cast.age += dt; const u = cast.ultimate || cast.hero.definition.ultimate;
      if (cast.kind === 'sweep') {
        // The front advances toward the entry and may catch arriving units once.
        const target = { ...cast.target, length: cast.target.length * Math.min(1, cast.age / u.frontTravelSec) };
        if (u.shape === 'lane_following_charge') {
          this._hitCast(cast, target);
        } else this._hitCast(cast, target);
      } else if (cast.kind === 'surge') this._hitCast(cast,{...cast.target,length:cast.target.length*Math.min(1,cast.age/u.surgeSec)});
      else if (cast.kind === 'wave') this._hitCast(cast,{...cast.target,radius:cast.target.radius*Math.min(1,cast.age/u.waveSec)});
      else if (cast.kind === 'delayed' && before < cast.hitAt && cast.age + EPS >= cast.hitAt) this._hitCast(cast);
      else if (cast.kind === 'passes') {
        while (cast.pass < u.passAtSec.length && cast.age + EPS >= u.passAtSec[cast.pass]) {
          const extra = u.upgradeEffects || {}, enlarge = extra.laterPassRangeMultiplier && [1, 2].includes(cast.pass) ? extra.laterPassRangeMultiplier : 1;
          this._hitCast(cast, enlarge !== 1 ? { ...cast.target, width: cast.target.width * enlarge, length: cast.target.length * enlarge } : null); cast.pass++;
        }
      } else if (cast.kind === 'field') {
        while (cast.nextTick <= Math.min(cast.age, cast.life) + EPS) {
          this._hitCast(cast); cast.nextTick += u.tickIntervalSec; cast.tickCount++;
        }
      } else if (cast.kind === 'mines') {
        for (const mine of cast.mines) if (!mine.triggered && this.enemies.some(e => alive(e) && e.laneId === mine.laneId && dist(e, mine) <= u.triggerRadius + e.radius)) {
          mine.triggered = true;
          const extra = u.upgradeEffects || {}, charge = extra.mineChargeIntervalSec ? Math.min(extra.mineChargeDamageCap, Math.floor(cast.age / extra.mineChargeIntervalSec) * extra.mineChargeDamageBonus) : 0;
          this._hitCast(cast, { ...mine, shape: 'circle_shock', radius: u.blastRadius }, { damageMultiplier: 1 + charge });
          if (this.endless && extra.mineTriggerSlowRadius) for (const enemy of this.enemies) if (alive(enemy) && dist(enemy, mine) <= extra.mineTriggerSlowRadius + enemy.radius) this._slow(enemy, extra.mineTriggerSlowFactor, extra.mineTriggerSlowSec, 'mine_slow_' + cast.id);
          if (this.endless && extra.mineFirstTriggerRecoveryReductionSec && !cast.mineRecoveryTriggered) { cast.mineRecoveryTriggered = true; cast.hero.rageRecovery = Math.max(0, cast.hero.rageRecovery - extra.mineFirstTriggerRecoveryReductionSec); }
          this.effects.push({ type: 'explosion', heroId: cast.heroId, ...mine, radius: u.blastRadius, life: 0.35, age: 0, time: 0 });
          this.effects = this.effects.filter(e => !(e.type === 'mine' && e.castId === cast.id && e.laneId === mine.laneId && e.x === mine.x && e.y === mine.y));
        }
      } else if (cast.kind === 'snipes') {
        while (cast.shot < cast.target.shotTargetIds.length && cast.nextShotAt <= Math.min(cast.age, cast.life) + EPS) { this._fireSnipe(cast); cast.nextShotAt += u.snipeIntervalSec; }
      } else if (cast.kind === 'roar') {
        this._hitCast(cast);
      }
      if (this.endless) tickHeroUpgradeCast(this, cast, before);
      if (cast.age + EPS >= cast.life) { cast.finished = true;
        if (this.endless) finishHeroUpgradeCast(this, cast);
        this.bestBurst = Math.max(this.bestBurst, cast.kills); this._emit('burst', { heroId: cast.heroId, name: cast.hero.name, burstId: cast.id, kills: cast.kills, count: cast.kills, x: cast.target.x, y: cast.target.y }); }
    }
    this._casts = this._casts.filter(c => !c.finished);
  }
  _fireSnipe(cast) {
    const ids = cast.target.shotTargetIds, id = ids[cast.shot++], u = cast.ultimate;
    let target = this.enemies.find(enemy => enemy.id === id && alive(enemy));
    if (!target && u.upgradeEffects.snipeCanRepeatTargets) target = cast.target.snipeCandidateIds.map(id => this.enemies.find(enemy => enemy.id === id && alive(enemy))).find(Boolean);
    if (!target) return;
    this._hitCast(cast, { ...cast.target, targetIds: [target.id] }, { damageMultiplier: cast.snipeHitBoss ? 1 + (u.upgradeEffects.bossHitOtherArrowsDamageBonus || 0) : 1 });
    if (classOf(target) === 'boss') cast.snipeHitBoss = true;
  }
}
