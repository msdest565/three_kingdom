import { maximumCircleCoverage } from './skill-targeting.js';
import { heroUpgradeEffects, heroUpgradeState } from './hero-upgrade-rules.js';

const EPS = 1e-8;
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const alive = enemy => enemy.hp > 0 && !enemy.escaped;
const klass = enemy => enemy.class || 'ordinary';
const zoneEffect = (game, zone) => game.effects.push({ type: 'heroZone', heroId: zone.heroId, shape: zone.shape || 'circle_shock',
  x: zone.x, y: zone.y, radius: zone.radius, width: zone.width, length: zone.length, angle: zone.angle,
  laneId: zone.laneId, laneIds: zone.laneIds, s0: zone.s0, s1: zone.s1, life: zone.expiresAt - game.time, age: 0, time: 0, ultimate: zone.ultimate,
  zoneKind: zone.type, target: zone.target, previousTarget: zone.previousTarget, progress: zone.progress, startsAt: zone.startsAt });
function addZone(game, zone) { game._heroZones.push(zone); zoneEffect(game, zone); return zone; }

export function beginHeroUpgradeCast(game, cast) {
  const h = cast.hero, u = cast.ultimate, e = u.upgradeEffects, state = heroUpgradeState(h), target = cast.target;
  if (u.counterEmpowered) state.counterReady = false;
  if (e.surgeWidthPerCastAdd) {
    const next = Math.min(e.surgeWidthGrowthCap, state.rallyWidthAdd + e.surgeWidthPerCastAdd);
    u.width += next - state.rallyWidthAdd; target.width += next - state.rallyWidthAdd; state.rallyWidthAdd = next;
  }
  if (e.bannerHealPerSec || e.bannerCampRangeBonus || e.bannerKillRageGainAdd) {
    addZone(game, { type: 'banner', heroId: h.id, hero: h, ...target, ultimate: u,
      startsAt: game.time + u.flightSec, expiresAt: game.time + u.flightSec + u.bannerLingerSec,
      rangeExpiresAt: game.time + u.flightSec + (e.bannerCampRangeDurationSec || 0),
      nextHealAt: game.time + u.flightSec + 1, healPerSec: e.bannerHealPerSec || 0,
      rangeBonus: e.bannerCampRangeBonus || 0, killRageGain: e.bannerKillRageGainAdd || 0, killRageCap: e.bannerKillRageGainCap || 0 });
  }
  if (e.gateInvulnerabilitySec) game._buffs.push({ kind: 'heroGateImmunity', remaining: e.gateInvulnerabilitySec });
  if (e.betweenCastDamageBonus && state.lastSweepTarget) {
    addZone(game, { type: 'bladeWind', heroId: h.id, ...target, target: structuredClone(target), previousTarget: state.lastSweepTarget,
      ultimate: u, bonus: e.betweenCastDamageBonus, startsAt: game.time, expiresAt: game.time + e.betweenCastDurationSec });
  }
  if (e.betweenCastDamageBonus) state.lastSweepTarget = structuredClone(target);
  if (e.afterHitVulnerabilityBonus) addZone(game, { type: 'rearguard', heroId: h.id, ...target, target: structuredClone(target), ultimate: u,
    bonus: e.afterHitVulnerabilityBonus, startsAt: game.time, expiresAt: game.time + (u.durationSec || .9) + e.afterHitVulnerabilitySec });
}

export function heroCampRange(game, camp, base) {
  let bonus = camp.nextAttackRangeExpiresAt > game.time ? camp.nextAttackRangeBonus || 0 : 0;
  for (const zone of game._heroZones) if (zone.type === 'banner' && game.time >= zone.startsAt && game.time < zone.rangeExpiresAt && dist(camp, zone) <= zone.radius) bonus = Math.max(bonus, zone.rangeBonus);
  return base * (1 + bonus);
}

export function consumeHeroCampAttack(game, camp) {
  if (camp.nextAttackRangeBonus) { camp.nextAttackRangeBonus = 0; camp.nextAttackRangeExpiresAt = 0; game._updateCamp(camp); }
}

export function updateHeroUpgradeEffects(game, dt) {
  for (const enemy of game.enemies) {
    enemy.blindRemaining = Math.max(0, (enemy.blindRemaining || 0) - dt);
    enemy.bannerBlockRemaining = Math.max(0, (enemy.bannerBlockRemaining || 0) - dt);
  }
  for (const zone of game._heroZones) {
    if (zone.type === 'chargeMist' && game.time >= zone.startsAt && game.time < zone.expiresAt) {
      for (const enemy of game.enemies) if (alive(enemy) && dist(enemy, zone) <= zone.radius + enemy.radius) game._slow(enemy, zone.slowFactor, zone.expiresAt - game.time, 'mist_' + zone.heroId + '_' + zone.startsAt);
    }
    if (zone.type !== 'banner' || !zone.healPerSec) continue;
    while (zone.nextHealAt <= Math.min(game.time, zone.expiresAt) + EPS) {
      const heal = Math.min(game.maxHp - game.hp, zone.healPerSec); game.hp += heal;
      if (heal > 0) game._emit('heal', { heroId: zone.heroId, source: 'banner', heal });
      zone.nextHealAt += 1;
    }
  }
  game._heroZones = game._heroZones.filter(zone => zone.expiresAt > game.time + EPS);
  for (const camp of game.camps) game._updateCamp(camp);
}

export function heroMovementLimit(game, enemy, proposed) {
  for (const zone of game._heroZones) if (zone.type === 'barrier' && game.time >= zone.startsAt && zone.laneId === enemy.laneId && enemy.progress <= zone.progress && proposed >= zone.progress) proposed = Math.min(proposed, zone.progress - EPS);
  return proposed;
}

export function heroIncomingMultiplier(game, enemy) {
  let multiplier = 1;
  if (enemy.slowExposeRemaining > game.time) multiplier *= 1 + Math.min(enemy.slowExposeMaximum || 0, Math.max(0, 1 - enemy.slow));
  for (const zone of game._heroZones) if (zone.type === 'bladeWind' && game._inShape(enemy, zone.target, zone.ultimate) && game._inShape(enemy, zone.previousTarget, zone.ultimate)) multiplier *= 1 + zone.bonus;
  for (const zone of game._heroZones) if (zone.type === 'rearguard' && game.time >= zone.startsAt && game._inShape(enemy, zone.target, zone.ultimate)) multiplier *= 1 + zone.bonus;
  return multiplier;
}

export function heroGateLeak(game, enemy, damage) {
  const immune = game._buffs.some(buff => buff.kind === 'heroGateImmunity' && buff.remaining > EPS);
  const protector = game.heroes.find(hero => heroUpgradeEffects(game, hero.id).firstLeakImmune);
  if (protector && !game._heroFirstLeakUsed) {
    game._heroFirstLeakUsed = true; const food = heroUpgradeEffects(game, protector.id).firstLeakFoodRefund || 0;
    game.food += food; game.stats.totalFoodEarned += food;
    game._emit('heroProtection', { heroId: protector.id, enemyId: enemy.id, food, damagePrevented: damage }); return 0;
  }
  return immune ? 0 : damage;
}

export function afterHeroGateDamage(game, damage) {
  if (!(damage > 0)) return;
  for (const hero of game.heroes) if (heroUpgradeEffects(game, hero.id).leakCounterDamageBonus) heroUpgradeState(hero).counterReady = true;
}

export function afterHeroEnemyDeath(game, enemy, cast) {
  const rewarded = new Set();
  for (const zone of game._heroZones) if (zone.type === 'banner' && zone.killRageGain && game.time >= zone.startsAt && game.time < zone.expiresAt && dist(enemy, zone) <= zone.radius) {
    if (rewarded.has(zone.heroId)) continue; rewarded.add(zone.heroId);
    const state = heroUpgradeState(zone.hero); state.permanentRageGain = Math.min(zone.killRageCap, state.permanentRageGain + zone.killRageGain);
  }
  const chain = enemy.deathThunder;
  if (!chain || enemy.deathThunderTriggered) return;
  enemy.deathThunderTriggered = true;
  game.effects.push({ type: 'explosion', heroId: chain.heroId, x: enemy.x, y: enemy.y, radius: chain.radius, life: .35, age: 0, time: 0 });
  for (const target of game.enemies) if (alive(target) && !target.invulnerable && target.id !== enemy.id && dist(target, enemy) <= chain.radius + target.radius) {
    if (chain.propagates) target.deathThunder ||= chain;
    game._damage(target, chain.damage * game.heroDamageMultiplier(chain.hero, true), 'ultimate_' + chain.heroId, chain.cast || cast);
  }
}

export function beforeHeroHit(game, cast, enemy) {
  const e = cast.ultimate.upgradeEffects, wasSlowed = enemy.slow < 1 || enemy.slowEffects.some(s => s.remaining > EPS), wasVulnerable = enemy.vulnerability.length || enemy.permanentVulnerability;
  if (e.deathChainDamage) enemy.deathThunder = { heroId: cast.heroId, hero: cast.hero, cast, radius: e.deathChainRadius, damage: e.deathChainDamage, propagates: e.deathChainPropagates };
  if (e.vulnerableTargetBlindSec && wasVulnerable) enemy.blindRemaining = Math.max(enemy.blindRemaining || 0, e.vulnerableTargetBlindSec);
  if (e.permanentVulnerability) {
    const key = String(cast.id);
    const applications = enemy.permanentVulnerabilityCasts ||= new Set();
    if (!applications.has(key)) { applications.add(key); enemy.permanentVulnerabilityStacks = Math.min(e.vulnerabilityMaxStacks, (enemy.permanentVulnerabilityStacks || 0) + 1); }
    enemy.permanentVulnerability = Math.pow(cast.ultimate.incomingDamageMultiplier, enemy.permanentVulnerabilityStacks);
  }
  if (e.slowVulnerabilityMaximumBonus) { enemy.slowExposeMaximum = e.slowVulnerabilityMaximumBonus; enemy.slowExposeRemaining = game.time + cast.ultimate.tickIntervalSec + .01; }
  if (e.repeatedSlowFactor && wasSlowed) game._slow(enemy, e.repeatedSlowFactor, cast.ultimate.hitSlowSec + e.repeatedSlowDurationSecAdd, 'hero_repeat_' + cast.id);
}

export function afterHeroHit(game, cast, enemy, amount) {
  const u = cast.ultimate, e = u.upgradeEffects;
  if (e.chargeMistSpeedFactor) {
    game._slow(enemy, e.chargeMistSpeedFactor, e.chargeMistDurationSec, 'charge_mist_' + cast.id);
    addZone(game, { type: 'chargeMist', heroId: cast.heroId, x: enemy.x, y: enemy.y, radius: Math.max(35, u.width / 2),
      startsAt: game.time, expiresAt: game.time + e.chargeMistDurationSec, slowFactor: e.chargeMistSpeedFactor, ultimate: u });
  }
  if (e.permanentHitSpeedFactor) { enemy.permanentSpeedFactor = Math.min(enemy.permanentSpeedFactor || 1, e.permanentHitSpeedFactor); enemy.noBannerHaste = true; }
  if (e.disableBannerHaste && (!e.eliteBossHitSpeedFactor || klass(enemy) !== 'ordinary')) {
    if (e.permanentHitSpeedFactor) enemy.noBannerHaste = true;
    else enemy.bannerBlockRemaining = Math.max(enemy.bannerBlockRemaining || 0, e.eliteBossSlowSec || u.tickIntervalSec + .01);
  }
  if (e.eliteBossHitSpeedFactor && klass(enemy) !== 'ordinary') game._slow(enemy, e.eliteBossHitSpeedFactor, e.eliteBossSlowSec, 'roar_' + cast.id);
  if (e.armorHitSpeedFactor && enemy.type === 'armor') game._slow(enemy, e.armorHitSpeedFactor, e.armorHitSlowSec, 'armor_crush_' + cast.id);
  if (e.bossSplashRadius && klass(enemy) === 'boss') {
    for (const victim of game.enemies) if (alive(victim) && victim.id !== enemy.id && dist(victim, enemy) <= e.bossSplashRadius + victim.radius) game._damage(victim, amount * e.bossSplashDamageMultiplier, 'ultimate_' + cast.heroId, cast,false,{heroSplash:true});
  }
}

export function tickHeroUpgradeCast(game, cast, before) {
  const u = cast.ultimate, e = u.upgradeEffects;
  if (e.secondLeapDelaySec && !cast.secondLeapDone && cast.age + EPS >= u.landAtSec + e.secondLeapDelaySec) {
    cast.secondLeapDone = true;
    const point = maximumCircleCoverage(game.enemies.filter(alive), e.secondLeapRadius, cast.target, enemy => game._score(enemy), { origin: cast.target, maxDistance: u.leapReach });
    const target = { shape: 'circle_shock', ...point, radius: e.secondLeapRadius };
    game._hitCast(cast, target, { damageMultiplier: e.secondLeapDamageMultiplier, extraHit: true });
    game.effects.push({ type: 'heroZone', heroId: cast.heroId, ...target, life: .3, age: 0, time: 0, ultimate: u });
  }
  if (e.surgeBarrierDurationSec && !cast.barrierCreated && cast.age + EPS >= u.surgeSec) {
    cast.barrierCreated = true;
    for (const laneId of cast.target.laneIds) {
      const path = game.paths.find(route => route.id === laneId), progress = Math.max(0, path.length - cast.target.length);
      addZone(game, { type: 'barrier', heroId: cast.heroId, laneId, progress, ...game.pathPoint(laneId, progress), width: cast.target.width, radius: cast.target.width / 2,
        startsAt: game.time, expiresAt: game.time + e.surgeBarrierDurationSec, ultimate: u });
    }
  }
  if (e.campNextAttackRangeBonus) {
    const reached = Math.min(1, cast.age / u.waveSec) * cast.target.radius;
    for (const camp of game.camps) if (!(cast.rangeBoostedCamps ||= new Set()).has(camp.slot) && dist(camp, cast.target) <= reached) {
      cast.rangeBoostedCamps.add(camp.slot); camp.nextAttackRangeBonus = e.campNextAttackRangeBonus; camp.nextAttackRangeExpiresAt = game.time + e.campRangeBuffDurationSec; game._updateCamp(camp);
    }
  }
}

export function finishHeroUpgradeCast(game, cast) {
  const e = cast.ultimate.upgradeEffects;
  if (e.emptyCastRageRefundFraction) {
    const state = heroUpgradeState(cast.hero);
    if (cast.kills === 0) {
      state.failedCasts = Math.min(e.emptyCastMaxStacks, state.failedCasts + 1);
      const rage = game.heroRageCost(cast.hero) * e.emptyCastRageRefundFraction;
      cast.hero.rage = Math.min(game.heroMaxRage(cast.hero), cast.hero.rage + rage);
      game._emit('rageRefund', { heroId: cast.heroId, rage, stacks: state.failedCasts });
    } else state.failedCasts = 0;
  }
}
