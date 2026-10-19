// Pure roster, card and damage-bucket rules; the engine supplies the combat clock.
const EPS = 1e-8;
const idsOf = heroes => heroes.map(hero => typeof hero === 'string' ? hero : hero.id || hero.heroId);
export function mergeSynergyTactics(tactics, balance) {
  const result = { ...tactics };
  for (const card of balance.synergyUpgrades || []) result[card.id] = { ...card };
  return result;
}
export function detectSynergies(balance,heroes) {
  const ids = new Set(idsOf(heroes));
  return Object.entries(balance.synergies || {}).filter(([,definition]) => {
    const count = definition.members.filter(id => ids.has(id)).length;
    return definition.requireAll ? count === definition.members.length : count >= (definition.minMembers || definition.members.length);
  }).map(([id,definition]) => ({ id, ...definition }));
}
export function eligibleSynergyCards(balance, heroes) {
  const ids = idsOf(heroes), present = new Set(ids);
  const active = new Set(detectSynergies(balance,ids).map(synergy => synergy.id));
  const factions = ids.map(id => balance.heroes[id]?.faction).filter(Boolean);
  const sameFaction = Math.max(0,...factions.map(faction => factions.filter(value => value === faction).length));
  return (balance.synergyUpgrades || []).filter(card =>
    (!card.requiredSynergy || active.has(card.requiredSynergy)) &&
    (!card.requiredHeroes || card.requiredHeroes.every(id => present.has(id))) &&
    (!card.requiredPartySize || ids.length === card.requiredPartySize) &&
    (!card.requiredSameFactionCount || sameFaction >= card.requiredSameFactionCount) &&
    (!card.requiredDistinctFactions || new Set(factions).size >= card.requiredDistinctFactions)
  ).map(card => card.id);
}
export function synergyUpgradeEffects(game) {
  if (!game.endless) return {};
  const cached = game._synergyEffectCache;
  if (cached?.size === game.tactics.size) return cached.effects;
  const eligible = new Set(eligibleSynergyCards(game._synergyBalance,game.heroes)), effects = {};
  for (const [id,card] of Object.entries(game.tacticCatalog)) if (card.category === 'synergy' && eligible.has(id) && (game.tacticCounts[id] || game.tactics.has(id))) Object.assign(effects,card.effects || {});
  game._synergyEffectCache = { size:game.tactics.size,effects }; return effects;
}
export function synergyRageCycle(game) {
  return game.activeSynergies.reduce((value,synergy) => value * (synergy.effects.ultimateCooldownMultiplier || 1),1);
}
export function synergyRageGainBonus(game, hero) {
  const bonus = synergyUpgradeEffects(game).sameFactionRageGainBonus || 0;
  return bonus && game.heroes.some(ally => ally.id !== hero.id && ally.definition.faction === hero.definition.faction) ? bonus : 0;
}
export function synergyArmyDamageBonus(game) { return synergyUpgradeEffects(game).armyDamageBonus || 0; }
export function synergyArmyMultiplier(game) {
  const perFaction = synergyUpgradeEffects(game).armyDamageBonusPerFaction || 0;
  return 1 + perFaction * new Set(game.heroes.map(hero => hero.definition.faction)).size;
}
export function synergyTargetMultiplier(game, enemy) {
  if (!game.endless) return 1;
  const type = enemy.class || game._synergyBalance.enemies[enemy.type]?.class || 'ordinary';
  const slowed = Math.min(enemy.slow ?? 1,enemy.permanentSpeedFactor || 1,...enemy.slowEffects.filter(effect => effect.remaining > EPS).map(effect => effect.factor)) < 1 - EPS;
  return game.activeSynergies.reduce((value,synergy) => value *
    (type !== 'ordinary' ? 1 + (synergy.effects.eliteAndBossDamageBonus || 0) : 1) *
    (slowed ? 1 + (synergy.effects.slowedEnemyIncomingDamageBonus || 0) : 1),1);
}
export function applySynergyUltimate(game, hero, ultimate) {
  if (!game.endless) return ultimate;
  for (const synergy of game.activeSynergies) {
    const e = synergy.effects;
    if (!e.fireArrowUltimateRangeMultiplier || !e.affectedHeroIds?.includes(hero.id)) continue;
    for (const field of ['width','length','range','radius']) if (ultimate[field]) ultimate[field] *= e.fireArrowUltimateRangeMultiplier;
  }
  return ultimate;
}
export function synergyCanExecute(game, cast, enemy) {
  const limit = synergyUpgradeEffects(game).infantryExecuteBelowHpFraction;
  return Boolean(limit && cast.hero.definition.faction === 'wei' && enemy.type === 'infantry' && !enemy.executeImmune && enemy.hp / enemy.maxHp < limit);
}
export function synergyVulnerability(game, enemy) {
  const values = enemy.vulnerability.filter(value => value.source !== 'attribute_dread');
  const permanent = enemy.permanentVulnerability || 1;
  if (!synergyUpgradeEffects(game).stackWindThunderVulnerability) return Math.max(1,permanent,...values.map(value => value.factor));
  const wind = Math.max(1,...values.filter(value => value.heroId === 'zhuge_liang').map(value => value.factor));
  const thunder = Math.max(1,...values.filter(value => value.heroId === 'sima_yi').map(value => value.factor));
  const other = Math.max(1,permanent,...values.filter(value => !['zhuge_liang','sima_yi'].includes(value.heroId)).map(value => value.factor));
  return Math.max(other,wind * thunder);
}
export function heroComboStatus(game) {
  const effects = synergyUpgradeEffects(game), rules = game._synergyBalance.comboRuntimeRules || {};
  const count = game._synergyRuntime?.count || 0,limit = effects.comboMaxPerRunOverride || rules.maxPerRun || 3;
  return { count,limit,windowSec:effects.comboWindowSecOverride || rules.windowSec || 2,remaining:Math.max(0,limit - count) };
}
