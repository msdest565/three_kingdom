export function mergeCampTactics(baseTactics, balance) {
  const catalog = { ...baseTactics };
  for (const group of Object.values(balance.campUpgrades || {})) for (const card of group.upgrades || []) catalog[card.id] = { ...card };
  return catalog;
}

export function campUpgradeEffects(game, type) {
  if (game.mode !== 'endless') return {};
  const effects = {};
  // The eighteen legacy effects already have their original engine paths.
  for (const [id, card] of Object.entries(game.tacticCatalog || {})) if (card.endlessOnly && card.camp === type && (game.tacticCounts[id] || game.tactics.has(id))) Object.assign(effects, card.effects || {});
  return effects;
}

export function campUpgradeState(camp) {
  return camp.upgradeState ||= { waveKills: 0, nextAttackStacks: 0, empoweredUntil: 0 };
}

export function drumAuraMultiplier(game, drum) {
  const e = game._campEffects(drum);
  return e.ultimateAuraMultiplier && campUpgradeState(drum).empoweredUntil > game.time ? e.ultimateAuraMultiplier : 1;
}

export function drumAttackSpeed(game, drum) {
  const e = game._campEffects(drum), count = game.camps.filter(c => Math.hypot(c.x-drum.x,c.y-drum.y) <= drum.range).length;
  const extra = Math.min(e.auraAttackSpeedExtraCap || 0, count * (e.auraAttackSpeedPerCamp || 0));
  return (game._campStats(drum).attackSpeedBonus + (game.tactics.has('war_drum_vigor') ? .05 : 0) + extra) * drumAuraMultiplier(game, drum);
}
