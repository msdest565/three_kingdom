// Pure rules: the engine owns the run, its clock, resources and emitted events.
const RARITY_WEIGHTS = Object.freeze({ common: 5000, rare: 3000, epic: 1650, legendary: 350 });
const CATEGORY_WEIGHTS = Object.freeze({ attribute: 1, camp: 4, hero: 3, synergy: 6 });
// These describe where/when an effect applies, rather than its stackable strength.
const EFFECT_SETTINGS = new Set(['gateSlowRange', 'lowHpThreshold', 'overlapMaxStacks',
  'postUltimateRageDurationSec', 'ultimateVulnerabilityDurationSec']);
const categoryOf = card => card.category || (card.hero ? 'hero' : 'camp');
const copies = value => Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
const isEpic = card => card.rarity === 'epic' || card.rarity === 'legendary';

/** Actual incremental benefit of the next copy, before it is added to the run. */
export function calculateTacticEffects(card, previousCopies = 0) {
  const decay = card.decay ?? 1;
  const scale = Math.pow(decay, copies(previousCopies));
  return Object.fromEntries(Object.entries(card.effects || {}).map(([key, value]) =>
    [key, typeof value === 'number' && !EFFECT_SETTINGS.has(key) ? value * scale : value]));
}

/** Rebuild the additive pool from acquisition counts, without rounding each copy. */
export function aggregateAttributeEffects(tactics, counts = {}) {
  const result = {};
  for (const [id, card] of Object.entries(tactics)) {
    const count = copies(counts[id]);
    if (categoryOf(card) !== 'attribute' || !count) continue;
    const decay = card.decay ?? 1;
    const scale = decay === 1 ? count : (1 - Math.pow(decay, count)) / (1 - decay);
    for (const [key, value] of Object.entries(card.effects || {})) {
      if (typeof value === 'number' && Number.isFinite(value)) result[key] = EFFECT_SETTINGS.has(key) ? value : (result[key] || 0) + value * scale;
    }
  }
  return result;
}

/** Three distinct weighted candidates. Pity observes offers, including rerolls. */
export function drawTacticOffer({ tactics, counts = {}, heroIds = [], campTypes = [], wave = 1,
  rng = Math.random, counters = {}, lockedId = null, config = {}, maxStacksPerTactic = 1 }) {
  const heroes = new Set(heroIds), camps = new Set(campTypes);
  const pool = Object.entries(tactics).filter(([id, card]) => {
    const category = categoryOf(card), count = copies(counts[id]);
    const limit = card.repeatable ? Math.max(1, maxStacksPerTactic) : 1;
    if (!(category === 'attribute' && card.repeatable) && count >= limit) return false;
    if (card.hero && !heroes.has(card.hero)) return false;
    if (card.camp && !camps.has(card.camp)) return false;
    if (card.requiredPartySize && heroes.size !== card.requiredPartySize) return false;
    // Synergy conditions are supplied explicitly when that system is introduced.
    if (category === 'synergy' && !config.eligibleSynergyIds?.includes(id)) return false;
    return true;
  }).map(([id, card]) => ({ id, ...card, category: categoryOf(card) }));
  const misses = {
    epicMisses: copies(counters.epicMisses), legendaryMisses: copies(counters.legendaryMisses), heroMisses: copies(counters.heroMisses),
  };
  const pity = {
    epic: misses.epicMisses >= (config.pity?.epicEvery ?? 4) - 1 && pool.some(isEpic),
    legendary: misses.legendaryMisses >= (config.pity?.legendaryEvery ?? 12) - 1 && pool.some(c => c.rarity === 'legendary'),
    hero: misses.heroMisses >= (config.pity?.heroUpgradeEvery ?? 3) - 1 && pool.some(c => c.category === 'hero'),
  };
  const rarityWeights = { ...RARITY_WEIGHTS, ...config.rarityWeights };
  const categoryWeights = { ...CATEGORY_WEIGHTS, ...config.categoryWeights };
  const weight = card => {
    let value = (rarityWeights[card.rarity || 'rare'] ?? 1) * (categoryWeights[card.category] ?? 1);
    if (card.category === 'attribute' && wave > (config.lateAttributeWeightWave ?? 40)) value *= config.lateAttributeWeightMultiplier ?? 1.5;
    if (pity.legendary && card.rarity === 'legendary') value *= 3;
    return Math.max(0, value);
  };
  const chosen = [];
  const take = card => { if (card && !chosen.some(c => c.id === card.id)) chosen.push(card); };
  const pick = predicate => {
    const candidates = pool.filter(card => !chosen.some(c => c.id === card.id) && predicate(card));
    if (!candidates.length) return null;
    const total = candidates.reduce((sum, card) => sum + weight(card), 0);
    const sample = Math.min(1 - Number.EPSILON, Math.max(0, Number(rng()) || 0));
    if (!total) return candidates[Math.floor(sample * candidates.length)];
    let remaining = sample * total;
    for (const card of candidates) { remaining -= weight(card); if (remaining < 0) return card; }
    return candidates.at(-1);
  };
  take(pool.find(card => card.id === lockedId));
  // One card can discharge both guarantees; a lock still leaves room for both.
  if (pity.hero && pity.epic && !chosen.some(c => c.category === 'hero') && !chosen.some(isEpic)) {
    take(pick(card => card.category === 'hero' && isEpic(card)));
  }
  if (pity.hero && !chosen.some(c => c.category === 'hero')) take(pick(card => card.category === 'hero'));
  if (pity.epic && !chosen.some(isEpic)) take(pick(isEpic));
  while (chosen.length < 3) { const next = pick(() => true); if (!next) break; take(next); }
  const updated = {
    epicMisses: chosen.some(isEpic) ? 0 : misses.epicMisses + 1,
    legendaryMisses: chosen.some(c => c.rarity === 'legendary') ? 0 : misses.legendaryMisses + 1,
    heroMisses: chosen.some(c => c.category === 'hero') ? 0 : misses.heroMisses + 1,
  };
  return { choices: chosen.map(card => ({ ...card, stacks: copies(counts[card.id]), nextEffects: calculateTacticEffects(card, counts[card.id]) })),
    counters: updated, pity };
}
