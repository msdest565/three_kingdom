import { BALANCE } from './runtime-data.js';
import { V1Game, equipmentBonus } from './v1-engine.js';

const GEAR_RULES = BALANCE.metaProgression.equipment;

// A display-only index. It is never stored and never used to resolve combat.
export function displayHeroPower(hero) {
  if (!hero) return 0;
  return hero.level * 120 + hero.skillLevel * 260 + GEAR_RULES.slots.reduce((total, slot) => {
    const item = hero.equipment[slot];
    return total + (item ? (GEAR_RULES.qualityIds.indexOf(item.quality) + 1) * 300 + item.level * 60 : 0);
  }, 0);
}

// Let the engine normalize equipment and apply level, quality and signature bonuses.
// A solo lead reports the hero's own attack and contribution to team defenses.
export function heroCombatStats(hero) {
  const preview = new V1Game({ party: [hero] });
  const unit = preview.heroes[0];
  return {
    attack: unit.definition.attack.damage * preview.heroDamageMultiplier(unit),
    range: preview.heroBasicRange(unit),
    interval: unit.definition.attack.intervalSec,
    gate: preview.teamArmor,
    camp: preview.teamCommand,
  };
}

// Prefer actual bonus strength over rarity: a trained white item can beat a fresh
// purple one. Matching signatures add their real benefit; foreign signatures do not.
// Scores only choose equipment for this action; they never alter battle or save rules.
function equipmentSuitability(item, heroId) {
  if (!item) return -Infinity;
  const property = { weapon: 'weaponDamage', armor: 'armorDefense', command_token: 'commandCampDamage', horse: 'horseBasicRange' }[item.slot];
  const template = GEAR_RULES.templates[item.templateId];
  const signature = template?.exclusiveHeroId === heroId ? template.signatureBonuses || {} : {};
  const definition = BALANCE.heroes[heroId];
  const basic = signature.basicDamageAdd || 0, ultimate = signature.ultimateDamageAdd || 0;
  const bonus = equipmentBonus(item, property);
  return (item.slot === 'horse' ? bonus / definition.attack.range : bonus) +
    (1 + (item.slot === 'weapon' ? bonus : 0)) * (basic + ultimate) +
    (signature.basicRangeAdd || 0) / definition.attack.range +
    (signature.ultimateWidthAdd || 0) / (definition.ultimate.width || 610) +
    (signature.teamGateHpAdd || 0) + (signature.campDamageAdd || 0);
}

export function equipmentPreparation(store, heroId) {
  const hero = store.getHero(heroId);
  if (!hero) return { moves: [], steps: [], cost: {}, count: 0 };
  const equipmentIds = { ...store.state.heroes[heroId].equipmentIds }, moves = [];
  for (const slot of GEAR_RULES.slots) {
    let best = hero.equipment[slot], score = equipmentSuitability(best, heroId);
    for (const item of store.getInventory({ slot })) {
      if (item.equippedHeroId && item.equippedHeroId !== heroId) continue;
      const candidate = equipmentSuitability(item, heroId);
      if (candidate > score + 1e-8) { best = item; score = candidate; }
    }
    if (best && best.itemInstanceId !== equipmentIds[slot]) {
      equipmentIds[slot] = best.itemInstanceId;
      moves.push({ slot, item: best });
    }
  }
  // Read-only view of the proposed loadout reuses the store's quote method verbatim.
  const preview = Object.create(store);
  preview.state = { ...store.state, heroes: { ...store.state.heroes, [heroId]: { ...store.state.heroes[heroId], equipmentIds } } };
  const steps = GEAR_RULES.slots.map(slot => ({ slot, quote: preview.getEquipmentUpgradeCost(heroId, slot) }))
    .filter(step => step.quote.ok)
    .sort((a, b) => a.quote.cost.copper_coin - b.quote.cost.copper_coin || a.quote.cost.refined_iron - b.quote.cost.refined_iron);
  const cost = { experience_book: 0, copper_coin: 0, refined_iron: 0 };
  for (const step of steps) for (const key of Object.keys(cost)) cost[key] += step.quote.cost[key] || 0;
  return { moves, steps, cost, count: steps.length };
}

export function runEquipmentPreparation(store, heroId) {
  const plan = equipmentPreparation(store, heroId), upgraded = [];
  let equipped = 0;
  if (store.readOnly) return { upgraded, equipped, count: plan.count };
  for (const move of plan.moves) if (store.equipEquipment(heroId, move.item.itemInstanceId).ok) equipped++;
  for (const step of plan.steps) {
    const result = store.upgradeEquipment(heroId, step.slot);
    if (!result.ok) break;
    upgraded.push(step.slot);
  }
  return { upgraded, equipped, count: plan.count };
}
