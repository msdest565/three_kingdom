import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { BALANCE } from '../runtime-data.js';
import { EQUIPMENT_ART_IDS, QUALITY_STYLE, TACTIC_ART_IDS, TACTIC_ART, TACTIC_SYMBOL_IDS, TACTIC_RARITY_QUALITY, equipmentIcon, tacticArtMetadata } from '../equipment-art.js';
import { composeTacticIcon } from '../tactic-art.js';

const decode = uri => {
  assert.ok(uri.startsWith('data:image/svg+xml;charset=utf-8,'));
  return decodeURIComponent(uri.slice(uri.indexOf(',') + 1));
};
const symbolLayer = svg => svg.slice(svg.indexOf('<g data-card-symbol='), svg.indexOf('<g data-card-frame=')).replace(/<g data-card-symbol="[^"]+">/, '');
const catalogue = new Map(Object.entries(BALANCE.tactics).map(([id, card]) => [id, { ...card, id }]));
for (const table of [BALANCE.heroUpgrades, BALANCE.campUpgrades]) for (const group of Object.values(table)) for (const card of group.upgrades) catalogue.set(card.id, card);
for (const card of BALANCE.synergyUpgrades) catalogue.set(card.id, card);

test('all 136 real catalogue cards have frozen art metadata and a local, authored SVG', () => {
  assert.equal(catalogue.size, 136);
  assert.deepEqual([...TACTIC_ART_IDS].sort(), [...catalogue.keys()].sort());
  assert.ok(Object.isFrozen(TACTIC_ART) && Object.isFrozen(TACTIC_ART_IDS));
  const counts = { attribute: 0, camp: 0, hero: 0, synergy: 0 };
  for (const [id, card] of catalogue) {
    const meta = tacticArtMetadata(id), svg = decode(equipmentIcon(id));
    assert.ok(Object.isFrozen(meta), id);
    assert.equal(meta.id, id); assert.equal(meta.name, card.name);
    assert.equal(meta.category, card.category); assert.equal(meta.rarity, card.rarity);
    assert.equal(meta.quality, TACTIC_RARITY_QUALITY[card.rarity]);
    counts[meta.category]++;
    assert.ok(svg.includes('viewBox="0 0 96 96"'), id);
    assert.ok(svg.includes(`data-tactic-id="${id}"`), id);
    assert.ok(svg.includes(`data-card-symbol="${meta.symbolId}"`), id);
    assert.notEqual(equipmentIcon(id), equipmentIcon('unknown-card-id'), id);
    assert.equal(equipmentIcon(id), equipmentIcon(id), 'cached exact URI');
  }
  assert.deepEqual(counts, { attribute: 26, camp: 42, hero: 60, synergy: 8 });
});

test('61 non-text theme symbols are all used: 26 attributes, 12 camps, 15 heroes and 8 synergies', () => {
  assert.ok(Object.isFrozen(TACTIC_SYMBOL_IDS));
  assert.equal(TACTIC_SYMBOL_IDS.length, 61);
  const groups = { attribute: new Set(), camp: new Set(), hero: new Set(), synergy: new Set() };
  const drawings = new Map();
  for (const id of TACTIC_ART_IDS) {
    const meta = TACTIC_ART[id], svg = decode(equipmentIcon(id)), layer = symbolLayer(svg);
    groups[meta.category].add(meta.symbolId);
    if (drawings.has(meta.symbolId)) assert.equal(layer, drawings.get(meta.symbolId), meta.symbolId);
    else drawings.set(meta.symbolId, layer);
    assert.ok(layer.includes('<path'), id);
    assert.ok(!/<text\b|font-family|foreignObject/i.test(layer), id);
  }
  assert.deepEqual(Object.fromEntries(Object.entries(groups).map(([key, value]) => [key, value.size])), { attribute: 26, camp: 12, hero: 15, synergy: 8 });
  assert.equal(new Set(drawings.values()).size, 61, 'symbols differ in actual geometry, not only their ids');
});

test('hero cards retain their exact signature silhouettes and use four vector rank badges', () => {
  const ranks = ['', 'I', 'II', 'III', 'IV'];
  for (const [heroId, group] of Object.entries(BALANCE.heroUpgrades)) {
    const layers = new Set(), badges = new Set();
    for (const card of group.upgrades) {
      const meta = TACTIC_ART[card.id], svg = decode(equipmentIcon(card.id));
      const weapon = decode(equipmentIcon(`signature_${heroId}_weapon`));
      const drawing = weapon.slice(weapon.indexOf('<g transform="translate(2 2) scale(.96)">') + '<g transform="translate(2 2) scale(.96)">'.length, weapon.lastIndexOf('</g>'));
      assert.equal(meta.heroId, heroId); assert.equal(meta.signatureWeaponId, `signature_${heroId}_weapon`);
      assert.ok(svg.includes(drawing), `${heroId} reuses actual weapon contours`);
      assert.equal(meta.tier, card.tier);
      assert.ok(svg.includes(`data-hero-tier="${ranks[card.tier]}"`));
      layers.add(symbolLayer(svg));
      badges.add(svg.slice(svg.indexOf('<g data-hero-tier=')));
    }
    assert.equal(layers.size, 1, `${heroId}: shared four-card emblem`);
    assert.equal(badges.size, 4, `${heroId}: readable four distinct tiers`);
  }
});

test('each camp uses its base emblem and its enhanced variant across the seven-card group', () => {
  for (const [campId, group] of Object.entries(BALANCE.campUpgrades)) {
    const variants = new Set();
    for (const card of group.upgrades) {
      const meta = TACTIC_ART[card.id], svg = decode(equipmentIcon(card.id));
      assert.equal(meta.campId, campId);
      variants.add(meta.variant);
      assert.equal(svg.includes('data-camp-enhanced="true"'), meta.variant === 'advanced');
      assert.equal(meta.variant, ['epic', 'legendary'].includes(card.rarity) ? 'advanced' : 'base');
    }
    assert.deepEqual([...variants].sort(), ['advanced', 'base']);
  }
});

test('four category textures and four rarity frames preserve colour, geometry and 0/1/2/4 pips', () => {
  const textures = new Map(), frames = new Map();
  for (const id of TACTIC_ART_IDS) {
    const meta = TACTIC_ART[id], svg = decode(equipmentIcon(id, 'red'));
    assert.ok(svg.includes(`data-card-texture="${meta.category}"`));
    assert.ok(svg.includes(`data-quality="${meta.quality}"`));
    assert.ok(!svg.includes('data-quality="red"'));
    const q = QUALITY_STYLE[meta.quality];
    assert.equal((svg.match(/data-quality-pip=/g) || []).length, q.pips);
    const frame = svg.slice(svg.indexOf('<g data-card-frame='), svg.indexOf('<g data-hero-tier=') < 0 ? -6 : svg.indexOf('<g data-hero-tier='));
    assert.ok(frame.includes(q.frame));
    if (q.pips >= 2) assert.ok(frame.includes('stroke-width="1.2"'), 'epic and legendary double border');
    frames.set(meta.quality, frame);
    textures.set(meta.category, svg.match(/<g data-card-texture="[^"]+"[^>]*>(.*?)<\/g>/s)[1]);
    assert.equal(equipmentIcon(id, 'red'), equipmentIcon(id), 'rarity belongs to the card definition');
  }
  assert.equal(textures.size, 4); assert.equal(new Set(textures.values()).size, 4);
  assert.equal(frames.size, 4); assert.equal(new Set(frames.values()).size, 4);
  assert.deepEqual([...frames.keys()].sort(), ['blue', 'gold', 'purple', 'white']);
});

test('card SVGs remain static and self-contained, with no external resources or executable content', () => {
  for (const id of TACTIC_ART_IDS) {
    const svg = decode(equipmentIcon(id));
    assert.ok(!/<script\b|<image\b|\bhref\s*=|\bon[a-z]+\s*=|javascript:|<foreignObject\b|<animate\b|<animateTransform\b|<set\b|@import|\bNaN\b|\bInfinity\b|undefined/i.test(svg), id);
    assert.ok(!/url\((?!#)/i.test(svg), id);
    assert.equal((svg.match(/<svg\b/g) || []).length, 1);
    assert.ok(svg.endsWith('</svg>'));
  }
  assert.equal(tacticArtMetadata('<img onerror="alert(1)">'), null);
  assert.equal(tacticArtMetadata('__proto__'), null);
  assert.equal(composeTacticIcon('not-a-tactic', QUALITY_STYLE), null);
  assert.equal(equipmentIcon('<svg onload="x">', 'red', 'armor'), equipmentIcon('basic_armor', 'red'));
});

test('all 34 existing equipment drawings in all five qualities stay byte-for-byte unchanged', () => {
  assert.equal(EQUIPMENT_ART_IDS.length, 34);
  assert.ok(Object.isFrozen(EQUIPMENT_ART_IDS));
  assert.ok(!EQUIPMENT_ART_IDS.some(id => TACTIC_ART_IDS.includes(id)));
  const hash = createHash('sha256');
  for (const id of EQUIPMENT_ART_IDS) for (const quality of Object.keys(QUALITY_STYLE)) hash.update(id + '|' + quality + '|' + equipmentIcon(id, quality) + '\n');
  assert.equal(hash.digest('hex'), 'a9c00af6877ed1e7d8ec3f19cf95a8589db32644525ffba59989282269a847fe');
  for (const [slot, fallback] of Object.entries({ weapon: 'basic_weapon', armor: 'basic_armor', command_token: 'basic_command_token', horse: 'basic_horse' })) assert.equal(equipmentIcon('missing', 'purple', slot), equipmentIcon(fallback, 'purple'));
  assert.equal(equipmentIcon('unmapped_horse'), equipmentIcon('basic_horse'));
  assert.equal(equipmentIcon('unmapped_armor'), equipmentIcon('basic_armor'));
  assert.equal(equipmentIcon('unmapped_command'), equipmentIcon('basic_command_token'));
});

test('rendering the full catalogue never changes game data or authored metadata', () => {
  const before = JSON.stringify(BALANCE), art = JSON.stringify(TACTIC_ART);
  for (const id of TACTIC_ART_IDS) for (const quality of ['white', 'blue', 'purple', 'red', 'gold', 'missing']) equipmentIcon(id, quality, 'weapon');
  assert.equal(JSON.stringify(BALANCE), before);
  assert.equal(JSON.stringify(TACTIC_ART), art);
});
