// Hero cards describe changes to a cast; baseline hero definitions stay immutable.
export function mergeHeroTactics(balance) {
  const cards = { ...balance.tactics };
  for (const group of Object.values(balance.heroUpgrades || {})) {
    for (const card of group.upgrades || []) cards[card.id] = { ...card };
  }
  return cards;
}

export function heroUpgradeEffects(game, heroId) {
  if (game.mode !== 'endless') return {};
  const effects = {};
  for (const [id, card] of Object.entries(game.tacticDefinitions || {})) {
    if (card.hero !== heroId || !(game.tacticCounts[id] || game.tactics.has(id))) continue;
    Object.assign(effects, card.effects || {});
  }
  return effects;
}

export function heroUpgradeState(hero) {
  return hero.upgradeState ||= { permanentRageGain: 0, rallyWidthAdd: 0, counterReady: false, failedCasts: 0 };
}

export function effectiveHeroUltimate(game, hero) {
  if (game.mode !== 'endless') return hero.definition.ultimate;
  const u = structuredClone(hero.definition.ultimate), e = heroUpgradeEffects(game, hero.id), state = hero.upgradeState || { rallyWidthAdd: 0, failedCasts: 0, counterReady: false };
  u.upgradeEffects = e;
  for (const [key, field] of [['ultimateRadiusOverride','radius'], ['ultimateWidthOverride','width'],
    ['eliteStunSecOverride','eliteStunSec'], ['hitSpeedFactorOverride','hitSpeedFactor'], ['hitSlowSecOverride','hitSlowSec'],
    ['coneAngleDegreesOverride','angleDegrees'], ['coneRangeOverride','range'], ['ultimateDelaySecOverride','delaySec'],
    ['commandAttackSpeedBonusOverride','allyAttackSpeedBonus'], ['commandBuffDurationSecOverride','buffDurationSec'],
    ['healMaxGateHpFractionOverride','healMaxGateHpFraction'], ['healFractionCapOverride','healFractionCap'],
    ['incomingDamageMultiplierOverride','incomingDamageMultiplier'], ['vulnerabilityDurationSecOverride','vulnerabilityDurationSec'],
    ['gateIncomingDamageFactorOverride','gateIncomingDamageFactor'], ['gateBuffDurationSecOverride','buffDurationSec'],
    ['minesPerLaneOverride','minesPerLane'], ['mineCountOverride','mineCount'], ['mineBlastRadiusOverride','blastRadius']]) {
    if (e[key] !== undefined) u[field] = e[key];
  }
  if (e.elitePushbackOverride !== undefined) (u.pushbackByClass ||= {}).elite = e.elitePushbackOverride;
  u.damageMultiplier = e.ultimateDamageMultiplier ?? 1;
  if (e.bannerLingerSecAdd) u.bannerLingerSec += e.bannerLingerSecAdd;
  if (e.leakCounterDamageBonus && state.counterReady) { u.damageMultiplier *= 1 + e.leakCounterDamageBonus; u.radius += e.leakCounterRadiusAdd; u.counterEmpowered = true; }
  if (e.chargeLaneCount) u.laneCount = e.chargeLaneCount;
  if (e.surgeWidthPerCastAdd) u.width += state.rallyWidthAdd;
  if (e.soloUltimateDamageMultiplier && game.heroes.length === 1) u.damageMultiplier *= e.soloUltimateDamageMultiplier;
  if (e.roarDurationSec) { u.durationSec = e.roarDurationSec; u.roarWindow = true; u.eliteStunSec = Math.max(u.eliteStunSec || 0, e.roarDurationSec); }
  if (e.ultimateRangeMultiplier) { if (u.width) u.width *= e.ultimateRangeMultiplier; if (u.length) u.length *= e.ultimateRangeMultiplier; if (u.radius) u.radius *= e.ultimateRangeMultiplier; }
  if (e.passCountOverride || e.passIntervalSecOverride) {
    const count = e.passCountOverride || u.passAtSec.length, gap = e.passIntervalSecOverride || u.passAtSec[1];
    u.passAtSec = Array.from({ length: count }, (_, index) => gap * index);
    u.maxHitsPerEnemyPerCast = count; u.durationSec = Math.max(u.durationSec, u.passAtSec.at(-1) + .1);
  }
  if (e.emptyCastDamageBonus) u.damageMultiplier *= 1 + state.failedCasts * e.emptyCastDamageBonus;
  if (e.backwardProgressMultiplier) {
    for (const field of ['backwardProgressPerSecByClass','totalBackwardProgressCapByClass']) {
      u[field] = Object.fromEntries(Object.entries(u[field]).map(([klass, value]) => [klass, value * e.backwardProgressMultiplier]));
    }
  }
  if (e.vulnerabilityDurationSecOverride && u.tickIntervalSec) { u.durationSec = e.vulnerabilityDurationSecOverride; u.maxTicksPerEnemyPerCast = Math.round(u.durationSec / u.tickIntervalSec); }
  if (e.ultimateRadiusMultiplier) u.radius *= e.ultimateRadiusMultiplier;
  if (e.waveDurationMultiplier) u.waveSec *= e.waveDurationMultiplier;
  if (e.fireTickDamageMultiplier) { u.damageMultiplier *= e.fireTickDamageMultiplier; u.width = e.fireBaseWidthOverride; }
  if (e.sweepWidthAdd) u.width += e.sweepWidthAdd;
  if (e.fireWidthAdd) u.width += e.fireWidthAdd;
  if (e.elitePushbackAdd) u.pushbackByClass.elite += e.elitePushbackAdd;
  if (e.fireDurationSecAdd) u.durationSec += e.fireDurationSecAdd;
  if (e.minesPerLaneOverride) u.laneProgressFractions = Array.from({ length: u.minesPerLane }, (_, i) => .15 + .6 * i / Math.max(1, u.minesPerLane - 1));
  if (e.mineChargeIntervalSec) u.durationSec = Math.max(u.durationSec, e.durationMinSec || 24);
  if (e.volleyAllLanes) { u.allLanes = true; u.width = e.volleyLaneWidthOverride; }
  if (hero.id === 'taishi_ci') {
    u.snipeCount = e.snipeCountOverride || 3; u.snipeIntervalSec = e.snipeIntervalSecOverride || game.endless.heroUpgradeRuntime?.taishiCiBaseShotIntervalSec || .15;
    u.maxHitsPerEnemyPerCast = e.snipeCanRepeatTargets ? u.snipeCount : 1;
    u.durationSec = u.snipeIntervalSec * (u.snipeCount - 1) + .1;
  }
  return u;
}
