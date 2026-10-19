import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateTacticEffects, aggregateAttributeEffects, drawTacticOffer } from '../roguelike-system.js';

const attribute = (rarity = 'common', effects = { campDamageBonus: .1 }, decay = .85) =>
  ({ category: 'attribute', rarity, repeatable: true, decay, effects });
const pool = () => Object.fromEntries(Array.from({ length: 26 }, (_, i) => ['attr_' + i, attribute()]));

test('same-name benefits use unrounded geometric decay; all wall copies retain full value', () => {
  const card = attribute();
  assert.equal(calculateTacticEffects(card).campDamageBonus, .1);
  assert.equal(calculateTacticEffects(card, 1).campDamageBonus, .085);
  assert.ok(Math.abs(calculateTacticEffects(card, 9).campDamageBonus - .1 * .85 ** 9) < 1e-14);
  const cards = { weapon: card, wall: attribute('common', { gateHpAdd: 12 }, 1) };
  const effects = aggregateAttributeEffects(cards, { weapon: 10, wall: 100 });
  const tenCopies = Array.from({ length: 10 }, (_, i) => .1 * .85 ** i).reduce((sum, value) => sum + value, 0);
  assert.ok(Math.abs(effects.campDamageBonus - tenCopies) < 1e-12);
  assert.equal(effects.gateHpAdd, 1200);
  assert.ok(aggregateAttributeEffects(cards, { weapon: 100000 }).campDamageBonus <= 2 / 3 + 1e-12);
});

test('stackable strength decays while effect duration, radius, threshold and target caps remain settings', () => {
  const card = attribute('rare', { postUltimateRageBonus: .6, postUltimateRageDurationSec: 4,
    gateSlowRange: 100, lowHpThreshold: .35, overlapMaxStacks: 5, ultimateVulnerabilityDurationSec: 5 });
  const next = calculateTacticEffects(card, 2), total = aggregateAttributeEffects({ card }, { card: 3 });
  assert.equal(next.postUltimateRageBonus, .6 * .85 ** 2);
  for (const key of ['postUltimateRageDurationSec', 'gateSlowRange', 'lowHpThreshold', 'overlapMaxStacks', 'ultimateVulnerabilityDurationSec']) {
    assert.equal(next[key], card.effects[key]); assert.equal(total[key], card.effects[key]);
  }
});

test('the attribute pool stays available beyond global mechanism stack limits and offers never duplicate IDs', () => {
  const tactics = pool(), counts = Object.fromEntries(Object.keys(tactics).map(id => [id, 999]));
  tactics.camp = { camp: 'archer', category: 'camp', rarity: 'rare', repeatable: false };
  counts.camp = 1;
  for (let i = 0; i < 80; i++) {
    const result = drawTacticOffer({ tactics, counts, campTypes: ['archer'], wave: i + 1, rng: () => .123 });
    assert.equal(result.choices.length, 3);
    assert.equal(new Set(result.choices.map(c => c.id)).size, 3);
    assert.ok(result.choices.every(c => c.category === 'attribute' && c.stacks === counts[c.id]));
    counts[result.choices[0].id]++;
  }
});

test('rarity boundaries follow the documented single-card weights', () => {
  const tactics = { common: attribute(), rare: attribute('rare'), epic: attribute('epic'), legendary: attribute('legendary') };
  for (const [sample, expected] of [[.4999, 'common'], [.5, 'rare'], [.8, 'epic'], [.965, 'legendary']]) {
    assert.equal(drawTacticOffer({ tactics, rng: () => sample }).choices[0].id, expected);
  }
});

test('built camps receive category weight and wave 41 increases attribute weight', () => {
  const tactics = { attribute: attribute(), camp: { category: 'camp', camp: 'archer', rarity: 'common' }, extra: attribute() };
  // With two attributes and one camp: 1:4:1, then 1.5:4:1.5 after wave 40.
  const first = wave => drawTacticOffer({ tactics, campTypes: ['archer'], wave, rng: () => .2 }).choices[0].id;
  assert.equal(first(40), 'camp');
  assert.equal(first(41), 'attribute');
  assert.ok(drawTacticOffer({ tactics, rng: () => .2 }).choices.every(c => c.id !== 'camp'));
});

test('fourth missed offer includes epic or better, including when a different card is locked', () => {
  const tactics = { ...pool(), epic: attribute('epic') };
  let counters;
  for (let i = 1; i <= 4; i++) {
    const result = drawTacticOffer({ tactics, counters, lockedId: 'attr_9', rng: () => 0 });
    assert.ok(result.choices.some(c => c.id === 'attr_9'));
    assert.equal(result.choices.some(c => c.rarity === 'epic'), i === 4);
    counters = result.counters;
  }
  assert.equal(counters.epicMisses, 0);
});

test('hero and epic guarantees coexist with a lock and respect equipped hero eligibility', () => {
  const tactics = { ...pool(), hero: { category: 'hero', hero: 'guan_yu', rarity: 'rare' }, epic: attribute('epic'),
    absentHero: { category: 'hero', hero: 'zhou_yu', rarity: 'legendary' } };
  const result = drawTacticOffer({ tactics, heroIds: ['guan_yu'], lockedId: 'attr_5',
    counters: { heroMisses: 2, epicMisses: 3 }, rng: () => 0 });
  assert.deepEqual(new Set(result.choices.map(c => c.id)), new Set(['attr_5', 'hero', 'epic']));
  assert.equal(result.counters.heroMisses, 0);
  const exhausted = drawTacticOffer({ tactics, counts: { hero: 1, epic: 2 }, heroIds: ['guan_yu'],
    counters: { heroMisses: 20 }, rng: () => 0 });
  assert.ok(exhausted.choices.every(c => c.category !== 'hero'));
});

test('twelfth legendary pity triples its weight without guaranteeing a legendary', () => {
  const tactics = { common: attribute(), rare: attribute('rare'), epic: attribute('epic'), legendary: attribute('legendary') };
  assert.equal(drawTacticOffer({ tactics, rng: () => .92 }).choices[0].id, 'epic');
  const soft = drawTacticOffer({ tactics, counters: { legendaryMisses: 11 }, rng: () => .92 });
  assert.equal(soft.choices[0].id, 'legendary');
  assert.equal(soft.counters.legendaryMisses, 0);
  assert.equal(drawTacticOffer({ tactics, counters: { legendaryMisses: 11 }, rng: () => 0 }).choices[0].id, 'common');
});

test('drawing leaves definitions and caller counters immutable and a shared hero epic satisfies both guarantees', () => {
  const tactics = { ...pool(), hero: { category: 'hero', hero: 'guan_yu', rarity: 'epic', effects: { widthAdd: 24 } } };
  const counters = { epicMisses: 3, legendaryMisses: 0, heroMisses: 2 };
  const before = JSON.stringify({ tactics, counters });
  const result = drawTacticOffer({ tactics, counters, heroIds: ['guan_yu'], rng: () => 0 });
  assert.equal(result.choices[0].id, 'hero');
  assert.equal(result.choices.length, 3);
  assert.equal(JSON.stringify({ tactics, counters }), before);
});
