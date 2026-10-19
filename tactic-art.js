import { BALANCE } from './runtime-data.js';

// Static, local SVG layers for the 136-card catalogue. Symbols carry meaning without text.
// Four hero tiers deliberately share one signature-weapon silhouette; only the corner rank changes.
const INK = '#101c1b', PAPER = '#f0dfb4', SHADE = '#aa8554', STEEL = '#dce9e4';
const JADE = '#70bba0', RED = '#d96a4f', WATER = '#70b6d0', GOLD = '#edbd62';
export const TACTIC_RARITY_QUALITY = Object.freeze({ common: 'white', rare: 'blue', epic: 'purple', legendary: 'gold' });

const path = (d, fill = PAPER, extra = '') => `<path d="${d}" fill="${fill}" stroke="${INK}" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round" ${extra}/>`;
const line = (d, color = PAPER, width = 3) => `<path d="${d}" fill="none" stroke="${color}" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round"/>`;
const circle = (x, y, r, fill = PAPER) => `<circle cx="${x}" cy="${y}" r="${r}" fill="${fill}" stroke="${INK}" stroke-width="2.5"/>`;
const rect = (x, y, w, h, fill = PAPER, rx = 2) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${rx}" fill="${fill}" stroke="${INK}" stroke-width="2.5"/>`;
const shine = d => line(d, '#fff6da', 1.7);
const spark = (x, y, r = 6) => path(`M${x} ${y-r}l2 ${r-2} ${r-2} 2-${r-2} 2-2 ${r-2}-2-${r-2}-${r-2}-2 ${r-2}-2Z`, GOLD);
const flame = (x = 48, y = 46, size = 1) => `<g transform="translate(${x} ${y}) scale(${size})">${path('M0 19C-25 14-22-1-11-11c-2 10 5 11 7 1L1-26c6 12 18 16 17 30C18 14 11 20 0 19Z', RED)}${path('M0 14c-11-5-8-12-2-20C0 3 8 1 9 7c0 6-4 8-9 7Z', GOLD)}</g>`;
const shield = (x = 48, y = 45, size = 1, fill = STEEL) => `<g transform="translate(${x} ${y}) scale(${size})">${path('M-23-24 0-31 23-24v22C23 16 9 27 0 32-9 27-23 16-23-2Z', fill)}${line('M-15-19 0-23 15-19', '#fff6da', 2)}${line('M0-20v40', SHADE, 3)}</g>`;
const sword = () => path('M68 14 78 22 40 61 31 54Z', STEEL) + line('M35 59 23 73', SHADE, 7) + line('M26 50 45 67', INK, 8) + line('M26 50 45 67', GOLD, 4) + shine('M68 20 36 53');
const arrow = (x = 48, y = 48, rotation = -35) => `<g transform="translate(${x} ${y}) rotate(${rotation})">${line('M0 25V-23', SHADE, 4)}${path('M0-32 8-17 0-20-8-17Z', STEEL)}${path('M0 14-7 22v9l7-7 7 7v-9Z', RED)}</g>`;
const flag = (x = 40, y = 22, fill = RED) => line(`M${x} ${y-2}v55`, SHADE, 4) + path(`M${x+1} ${y}h27l-5 10 5 11h-27Z`, fill) + shine(`M${x+5} ${y+4}h15`);
const bow = (color = JADE) => line('M29 14Q77 47 29 80', INK, 10) + line('M29 14Q77 47 29 80', color, 6) + line('M29 14 37 47 29 80', PAPER, 2) + arrow(48, 47, 90);
const gate = (x = 23, y = 28, w = 50, h = 45) => path(`M${x} ${y}v${h}h${w}V${y}h-10v9H${x+10}v-9Z`, SHADE) + path(`M${x+16} ${y+h}V${y+30}a9 9 0 0 1 18 0v${h-30}Z`, INK) + shine(`M${x+3} ${y+13}h${w-6}`);
const drum = () => path('M24 30q24-16 48 0v30q-24 16-48 0Z', RED) + `<ellipse cx="48" cy="30" rx="24" ry="11" fill="${PAPER}" stroke="${INK}" stroke-width="2.5"/>` + line('M25 41 34 58 42 43 50 62 58 43 70 57', GOLD, 2.5) + line('M31 66 25 78M65 67 72 78', SHADE, 5) + line('M26 16 45 33M70 14 54 32', STEEL, 4);

const ATTRIBUTE_SYMBOLS = {
  attr_gate_build: () => rect(17, 58, 31, 16) + rect(49, 58, 30, 16, SHADE) + rect(32, 40, 31, 16) + rect(17, 22, 31, 16, SHADE) + rect(49, 22, 30, 16) + shine('M20 25h24M35 43h24M20 61h24'),
  attr_gate_earth: () => path('M15 62h66v17H15Z', SHADE) + line('M18 67h60M23 74h49', PAPER, 2) + rect(28, 36, 43, 17, STEEL) + line('M49 16v20', SHADE, 7) + line('M32 57v-1M66 57v-1', GOLD, 3) + shine('M31 39h35'),
  attr_gate_repair: () => rect(19, 46, 58, 29, SHADE) + line('M19 61h58M38 46v15M58 61v14', PAPER, 2) + path('M27 40 53 18 65 44Z', STEEL) + line('M51 39 69 24', SHADE, 7) + shine('M32 37 52 22'),
  attr_gate_outer: () => path('M17 20h62v58H56V66h11V32H29v34h11v12H17Z', SHADE) + path('M36 39h24v19h-9V48h-6v10h-9Z', PAPER) + line('M40 78h16M44 57v15M52 57v15', JADE, 3) + shine('M21 25h53'),
  attr_gate_moat: () => gate(24, 15, 48, 39) + line('M14 65q9-9 18 0t18 0t18 0t18 0M14 77q9-9 18 0t18 0t18 0t18 0', WATER, 5),
  attr_gate_parapet: () => path('M16 28h14v15h11V28h14v15h11V28h14v47H16Z', PAPER) + rect(42, 51, 11, 17, INK, 4) + line('M16 73h64M29 46v23M66 46v23', SHADE, 2) + shine('M19 32h8M44 32h8M69 32h8'),
  attr_gate_iron: () => gate(25, 38, 47, 39) + path('M18 19 44 15l3 15-25 5Z', STEEL) + path('M39 29q15 1 16 13l-6 14-6-15q-1-6-8-6Z', RED) + circle(55, 60, 3, GOLD) + spark(67, 34, 5),
  attr_gate_laststand: () => flag(57, 21, '#a75f52') + path('M58 25h22l-9 6 9 8-22-4Z', RED) + path('M21 76 37 59 44 63 55 51 45 45 49 32 26 53 31 61 15 70Z', STEEL) + line('M24 66 36 77', GOLD, 5) + line('M68 48 75 66M65 61 72 77', SHADE, 2),
  attr_camp_temper: () => path('M15 44h64v11H66l-9 12H35L29 55H15Z', STEEL) + rect(36, 66, 25, 12, SHADE) + path('M31 22 48 15 60 29 43 37Z', STEEL) + line('M45 31 59 45', SHADE, 6) + spark(69, 22) + spark(20, 29, 4),
  attr_camp_steel: () => path('M22 25h52v54H22Z', SHADE) + path('M33 70V48a15 15 0 0 1 30 0v22Z', INK) + flame(48, 59, .55) + path('M29 27 38 15h25l9 12Z', STEEL) + shine('M36 24h27') + line('M20 80h56', PAPER, 3),
  attr_camp_haste: () => bow(PAPER) + line('M16 30h12M12 43h14M16 57h11', JADE, 3),
  attr_camp_drill: () => [25, 45, 65].map((y, r) => [26, 48, 70].map(x => path(`M${x-6} ${y-8}h12v15l-6 5-6-5Z`, r === 1 ? JADE : PAPER)).join('')).join(''),
  attr_camp_sight: () => path('M14 41q33-32 66 0-33 33-66 0Z', PAPER) + circle(47, 41, 12, JADE) + circle(47, 41, 5, INK) + line('M24 73h52M34 61v17M48 58v20M62 61v17', SHADE, 3) + shine('M24 36q18-14 34-7'),
  attr_camp_elite: () => shield(42, 51, .78) + arrow(56, 43, 25) + line('M27 50 39 47 35 57 48 53 44 67', INK, 3) + spark(64, 20, 5),
  attr_camp_boss: () => line('M28 76 59 38', SHADE, 8) + path('M46 17 77 29 65 51 34 39Z', STEEL) + line('M62 18 51 44', GOLD, 4) + line('M51 65 56 72 49 77 57 83M68 60 73 67 80 65M27 55 18 58 22 64', PAPER, 2),
  attr_camp_overlap: () => `<g fill="none" stroke="${INK}" stroke-width="10"><circle cx="35" cy="37" r="18"/><circle cx="61" cy="37" r="18"/><circle cx="48" cy="61" r="18"/></g><g fill="none" stroke="${GOLD}" stroke-width="6"><circle cx="35" cy="37" r="18"/><circle cx="61" cy="37" r="18"/><circle cx="48" cy="61" r="18"/></g>` + shine('M21 35q3-13 14-13M49 26q8-7 17-2M33 61q0-11 9-15'),
  attr_dot_formula: () => path('M34 24h27v9q15 8 13 28-1 16-26 16S20 69 21 59q0-18 13-26Z', SHADE) + rect(33, 20, 29, 9, STEEL) + flame(48, 55, .66) + shine('M30 39q-6 7-5 15'),
  attr_food_levy: () => path('M18 33 62 30 58 71 27 77Z', PAPER) + line('M21 42 59 40M31 47l4 21M44 46l2 22M55 45l-1 20', SHADE, 2.5) + path('M24 31q5-14 12-7 2-15 10-6 6-8 11 8Z', GOLD) + circle(69, 65, 15, GOLD) + rect(65, 61, 8, 8, INK, 0),
  attr_hero_martial: () => sword() + `<g transform="translate(96 0) scale(-1 1)">${sword()}</g>`,
  attr_hero_guard: () => shield(27, 54, .54, JADE) + shield(69, 54, .54, JADE) + shield(48, 42, .64),
  attr_rage_flow: () => path('M47 80C15 73 18 58 37 52 59 44 59 36 44 30 25 22 40 13 57 15c-10 5-16 9-7 12 36 13 29 29 4 36-18 5-20 11-7 17Z', RED) + line('M32 61q-3 11 12 14M51 46q17-7 9-15', GOLD, 3) + spark(70, 16, 4),
  attr_rage_recovery: () => path('M26 26q-17 23 0 44 20 21 42 1l-8-8Q42 78 32 61 23 46 36 32l8 6V16L22 20Z', JADE) + flame(59, 47, .62),
  attr_ultimate_temper: () => path('M21 57h52l-9 12H35l-5-6H21Z', STEEL) + rect(36, 69, 25, 10, SHADE) + path('M26 23 47 16 61 31 41 40Z', STEEL) + line('M47 34 61 50', SHADE, 6) + spark(72, 34, 10) + spark(20, 45, 5),
  attr_ultimate_break: () => line('M30 17v62', SHADE, 5) + path('M33 20h44l-9 12 10 11-24-4-7 8-14-6Z', RED) + line('M50 19 45 28 55 33 49 43', INK, 3) + arrow(61, 61, -47),
  attr_hero_dread: () => `<ellipse cx="48" cy="66" rx="31" ry="12" fill="none" stroke="${WATER}" stroke-width="4"/>` + path('M43 17h10v29h11L48 63 32 46h11Z', STEEL) + line('M23 28v14M73 28v14M14 49v6M82 49v6', JADE, 3),
  attr_army_resolve: () => `<g transform="translate(2 2) rotate(22 29 48)">${flag(25, 22, JADE)}</g><g transform="translate(-2 2) rotate(-22 68 48)">${flag(66, 22, RED)}</g>` + flag(47, 13, GOLD) + circle(48, 72, 6, PAPER),
};

const CAMP_SYMBOLS = {
  archer: () => bow(JADE),
  shield: () => shield(48, 46, .95, '#a5baac') + path('M48 26 59 39 48 59 37 39Z', GOLD),
  catapult: () => path('M21 68h54l7 10H14Z', SHADE) + path('M28 67 47 30 67 67H55L47 47 40 67Z', PAPER) + line('M28 21 69 58', SHADE, 8) + path('M18 15q14-8 24 7l-6 7-15-6Z', STEEL) + circle(24, 77, 7, INK) + circle(70, 77, 7, INK) + circle(68, 22, 8, STEEL),
  crossbow: () => path('M16 28q32-24 64 0l-5 7q-27-15-54 0Z', STEEL) + line('M18 30 48 47 78 30', PAPER, 2) + path('M44 28h9v49H40l5-22Z', SHADE) + arrow(48, 40, 0) + line('M40 65h17', GOLD, 3),
  fire_oil: () => path('M28 27h40l-5 48H33Z', SHADE) + `<ellipse cx="48" cy="28" rx="20" ry="8" fill="${INK}" stroke="${PAPER}" stroke-width="2"/>` + flame(48, 46, .95) + line('M30 67h35', GOLD, 3),
  war_drum: drum,
};

const SYNERGY_SYMBOLS = {
  synergy_taoyuan: () => [28, 48, 68].map((x, i) => `<g transform="translate(${x} ${i === 1 ? 33 : 47})">${Array.from({length:5},(_,j)=>`<ellipse cx="0" cy="-7" rx="5" ry="8" transform="rotate(${j*72})" fill="#edabb1" stroke="${INK}" stroke-width="1.5"/>`).join('')}${circle(0, 0, 4, GOLD)}</g>`).join('') + line('M27 63q21 22 42 0', JADE, 4),
  synergy_weiwu_xiongfeng: () => shield(48, 46, 1.02, '#6b91ad') + path('M27 28 35 17 41 29 55 29 62 17 69 28 65 51 56 65H40L31 51Z', PAPER) + path('M35 35 43 39 38 44M61 35 53 39 58 44M43 52h10l-5 7Z', INK) + line('M34 52h-9M62 52h9', GOLD, 3),
  synergy_jiangdong_huchen: () => flame(37, 52, 1) + `<g transform="translate(25 -2) scale(.8)">${bow(PAPER)}</g>` + line('M19 77q10-8 20 0t20 0t20 0', WATER, 3),
  synergy_wolong_zhonghu: () => path('M18 24q14-12 30 0 16-12 30 0-2 23-30 34Q20 47 18 24Z', PAPER) + line('M48 25v31M25 28 44 52M70 28 52 52', SHADE, 2) + path('M51 30 42 46h9l-7 18 17-23h-9l7-11Z', '#b8a3dd') + path('M25 70q8-12 19-5l5 12H29Z', JADE) + path('M55 70q8-12 19-5l5 12H59Z', '#8e79b1'),
  synergy_three_hearts: () => [28, 48, 68].map((x, i) => circle(x, i === 1 ? 25 : 37, 7, PAPER)).join('') + path('M18 52q10-13 20 0v19H18ZM38 40q10-13 20 0v31H38ZM58 52q10-13 20 0v19H58Z', JADE) + line('M27 76h42', GOLD, 4),
  synergy_combo_mastery: () => `<g transform="translate(-8 3) scale(.92)">${sword()}</g><g transform="translate(104 3) scale(-.92 .92)">${sword()}</g>` + spark(48, 42, 12) + line('M19 20 27 28M77 20 69 28M17 48h9M79 48h-9', GOLD, 3),
  synergy_comrades: () => shield(31, 42, .68, JADE) + shield(64, 42, .68, '#779fbc') + path('M20 67 32 56 47 63 62 56 77 67 65 77 48 70 32 77Z', PAPER) + line('M38 64 47 72 58 64', SHADE, 2),
  synergy_four_corners: () => `<g transform="translate(-2 0) scale(.7)">${flag(25, 25, JADE)}</g><g transform="translate(24 -6) scale(.7)">${flag(25, 25, '#789dc6')}</g><g transform="translate(47 0) scale(.7)">${flag(25, 25, RED)}</g>` + path('M25 65 37 62 48 47 59 62 72 65 63 76H34Z', GOLD) + spark(48, 26, 7),
};

const definitions = new Map(Object.entries(BALANCE.tactics).map(([id, card]) => [id, { ...card, id }]));
for (const table of [BALANCE.heroUpgrades, BALANCE.campUpgrades]) for (const group of Object.values(table)) for (const card of group.upgrades) definitions.set(card.id, card);
for (const card of BALANCE.synergyUpgrades) definitions.set(card.id, card);

export const TACTIC_ART = Object.freeze(Object.fromEntries([...definitions.values()].map(card => {
  const category = card.category;
  const variant = category === 'camp' && ['epic', 'legendary'].includes(card.rarity) ? 'advanced' : 'base';
  const symbolId = category === 'hero' ? `hero_${card.hero}` : category === 'camp' ? `camp_${card.camp}_${variant}` : card.id;
  return [card.id, Object.freeze({
    id: card.id, name: card.name, category, rarity: card.rarity,
    quality: TACTIC_RARITY_QUALITY[card.rarity], symbolId,
    heroId: card.hero || null, tier: card.tier || null, campId: card.camp || null,
    variant: category === 'camp' ? variant : null,
    signatureWeaponId: category === 'hero' ? `signature_${card.hero}_weapon` : null,
  })];
})));
export const TACTIC_ART_IDS = Object.freeze(Object.keys(TACTIC_ART));
export const TACTIC_SYMBOL_IDS = Object.freeze([...new Set(Object.values(TACTIC_ART).map(card => card.symbolId))]);

export function tacticArtMetadata(id) {
  return Object.hasOwn(TACTIC_ART, id) ? TACTIC_ART[id] : null;
}

const TEXTURES = {
  attribute: { color: '#283d3c', drawing: line('M0 20 21 17 36 25 58 19 76 25 96 18M0 61 27 55 46 65 65 56 96 62M21 17 27 55M58 19 65 56M46 65 40 96', '#84958a', 1.4) + '<path d="M9 33h2m33 7h2m34-4h2M19 80h2m45-6h2" stroke="#c3bbaa" stroke-width="2"/>' },
  camp: { color: '#433a2d', drawing: Array.from({length:12},(_,i)=>line(`M${i*8+3} 0v96M0 ${i*8+3}h96`, '#aa9572', .8)).join('') },
  hero: { color: '#42313e', drawing: Array.from({length:5},(_,r)=>Array.from({length:5},(_,c)=>`<path d="M${c*24-12} ${r*24}l12-12 12 12-12 12Z" fill="none" stroke="#bc909c" stroke-width="1"/>`).join('')).join('') },
  synergy: { color: '#293c49', drawing: Array.from({length:3},(_,r)=>Array.from({length:3},(_,c)=>line(`M${c*35+3} ${r*34+18}v-12h23v18H${c*35+10}v-10h8`, '#9bb5bb', 1.3)).join('')).join('') },
};

function cardFrame(q) {
  const shape = q.name === '白' ? 'M4 4H92V92H4Z' : q.name === '蓝' ? 'M15 4H81Q92 4 92 15V81Q92 92 81 92H15Q4 92 4 81V15Q4 4 15 4Z' : 'M15 4H81L92 15V81L81 92H15L4 81V15Z';
  const double = q.pips >= 2 ? `<path d="M17 10H79L86 17V79L79 86H17L10 79V17Z" fill="none" stroke="${q.frame}" stroke-width="1.2" opacity=".8"/>` : '';
  const glint = q.pips === 4 ? '<path d="M17 6H45M6 17V39M18 11H34" stroke="#fff2be" stroke-width="2.3" fill="none" stroke-linecap="round"/>' : '';
  const pips = Array.from({length:q.pips},(_,i)=>`<path data-quality-pip="${i+1}" d="M${84-i*8} 82l3 4-3 4-3-4Z" fill="${q.frame}" stroke="${INK}" stroke-width="1"/>`).join('');
  return `<g data-card-frame="${q.pips}" fill="none"><path d="${shape}" stroke="${INK}" stroke-width="7"/><path d="${shape}" stroke="${q.frame}" stroke-width="${q.pips === 4 ? 3.8 : 2.8}"/>${double}${glint}</g>${pips}`;
}

function tierBadge(tier) {
  if (!tier) return '';
  const roman = ['','I','II','III','IV'][tier];
  const stems = tier <= 3 ? Array.from({length:tier},(_,i)=>line(`M${18+i*5} 76v11`, PAPER, 2)).join('') : line('M17 76v11M23 76l4 11 4-11', PAPER, 2);
  return `<g data-hero-tier="${roman}">${path('M11 71h25v21H11Z', '#1b2425')}${stems}</g>`;
}

const escapeXml = value => String(value).replace(/[&<>"']/g, character => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&apos;' }[character]));

/** Returns SVG markup only for registered cards. The caller supplies the existing weapon silhouette and quality style. */
export function composeTacticIcon(id, qualityStyles, signatureDrawing = '') {
  const card = tacticArtMetadata(id);
  if (!card) return null;
  const texture = TEXTURES[card.category], q = qualityStyles[card.quality];
  let drawing;
  if (card.category === 'hero') {
    if (!signatureDrawing) throw new Error(`Missing signature silhouette: ${card.heroId}`);
    drawing = `<circle cx="48" cy="44" r="32" fill="#1b232a" fill-opacity=".55" stroke="#a98c76" stroke-width="1.4"/><g transform="translate(10 6) scale(.79)">${signatureDrawing}</g>`;
  } else if (card.category === 'camp') {
    drawing = CAMP_SYMBOLS[card.campId]();
    if (card.variant === 'advanced') drawing += `<g data-camp-enhanced="true">${path('M20 68 27 62l7 6-7 6ZM62 68l7-6 7 6-7 6Z', GOLD)}${line('M28 82h40', GOLD, 2.5)}${spark(77, 17, 5)}</g>`;
  } else drawing = (card.category === 'attribute' ? ATTRIBUTE_SYMBOLS : SYNERGY_SYMBOLS)[card.id]();
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96" role="img" data-tactic-id="${card.id}" data-category="${card.category}" data-symbol-id="${card.symbolId}" data-quality="${card.quality}"><title>${escapeXml(card.name)}</title><defs><linearGradient id="card-light" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#fff4ca" stop-opacity=".17"/><stop offset=".65" stop-color="#101a1a" stop-opacity="0"/><stop offset="1" stop-color="#060b0d" stop-opacity=".5"/></linearGradient><clipPath id="card-clip"><rect x="5" y="5" width="86" height="86" rx="6"/></clipPath></defs><rect x="4" y="4" width="88" height="88" rx="7" fill="${texture.color}"/><g clip-path="url(#card-clip)"><g data-card-texture="${card.category}" opacity=".19">${texture.drawing}</g><rect x="5" y="5" width="86" height="86" fill="url(#card-light)"/><g data-card-symbol="${card.symbolId}"><g transform="translate(1 2)" opacity=".65" fill="#05090a">${drawing}</g>${drawing}</g></g>${cardFrame(q)}${tierBadge(card.tier)}</svg>`;
}
