import { TACTIC_ART_IDS, TACTIC_ART, TACTIC_SYMBOL_IDS, TACTIC_RARITY_QUALITY, tacticArtMetadata, composeTacticIcon } from './tactic-art.js';

// Original procedural equipment icons. Local SVG data URIs only: no remote assets, scripts or image refs.
// Each signature item has its own drawing that follows its name (倚天剑, 赤兔, 白衣兵书 …); ordinary gear has one
// drawing per slot. Quality is shown three ways, not by colour alone: frame colour, corner pips and the frame shape.

export const QUALITY_STYLE = Object.freeze({
  white: { frame: '#d9d6c3', glow: '#d9d6c3', pips: 0, name: '白' },
  blue: { frame: '#5fb2ff', glow: '#5fb2ff', pips: 1, name: '蓝' },
  purple: { frame: '#b98cff', glow: '#b98cff', pips: 2, name: '紫' },
  red: { frame: '#ff6b57', glow: '#ff6b57', pips: 3, name: '红' },
  gold: { frame: '#ffc940', glow: '#ffe7a6', pips: 4, name: '金' },
});

const STEEL = '#dfe8e4', STEEL_D = '#7d8c88', WOOD = '#6b4426', GOLD = '#f2c46b', GOLD_D = '#a8702a', INK = '#0d1b16';

// ---------- Weapon drawings (96×96, light from upper-left) ----------
const blade = (d, fill = STEEL, edge = '#ffffff') => `<path d="${d}" fill="${fill}" stroke="${INK}" stroke-width="2.4" stroke-linejoin="round"/><path d="${d}" fill="none" stroke="${edge}" stroke-width=".9" opacity=".55" transform="translate(-1 -1)"/>`;
const shaft = (x1, y1, x2, y2, color = WOOD, w = 5) => `<path d="M${x1} ${y1}L${x2} ${y2}" stroke="${INK}" stroke-width="${w + 3}" stroke-linecap="round"/><path d="M${x1} ${y1}L${x2} ${y2}" stroke="${color}" stroke-width="${w}" stroke-linecap="round"/>`;
const tassel = (x, y, color = '#e2493b') => `<path d="M${x} ${y}q-6 8-3 16M${x} ${y}q0 9 3 16M${x} ${y}q5 7 6 14" stroke="${color}" stroke-width="2.6" fill="none" stroke-linecap="round"/><circle cx="${x}" cy="${y}" r="3" fill="${GOLD}" stroke="${INK}" stroke-width="1.5"/>`;

const straightSword = (bladeFill, guard, gem) => blade('M70 12 78 18 34 62 28 56Z', bladeFill) + `<path d="M74 15 31 59" stroke="${STEEL_D}" stroke-width="1.2"/>`
  + `<path d="M22 50 40 68" stroke="${INK}" stroke-width="9" stroke-linecap="round"/><path d="M22 50 40 68" stroke="${guard}" stroke-width="5.5" stroke-linecap="round"/>`
  + shaft(29, 63, 17, 75, '#3b2b18', 6) + `<circle cx="15" cy="77" r="4.5" fill="${guard}" stroke="${INK}" stroke-width="2"/>` + (gem ? `<circle cx="31" cy="59" r="3.2" fill="${gem}" stroke="${INK}" stroke-width="1.4"/>` : '');

const WEAPONS = {
  basic_weapon: () => blade('M72 10Q84 26 70 44L36 70 28 62 62 34Q72 24 72 10Z') + shaft(31, 66, 16, 81, '#3b2b18', 6) + `<path d="M24 56 40 72" stroke="${INK}" stroke-width="8" stroke-linecap="round"/><path d="M24 56 40 72" stroke="${STEEL_D}" stroke-width="4.5" stroke-linecap="round"/>`,
  // 倚天剑: long imperial jian, gold guard, dragon-pearl gem.
  signature_cao_cao_weapon: () => straightSword('#eef4f2', GOLD, '#e2493b') + `<path d="M64 20q4-2 6 1" stroke="${GOLD}" stroke-width="1.6" fill="none"/>`,
  // 麒麟牙: heavy broad saber with a qilin tooth notch.
  signature_xiahou_dun_weapon: () => blade('M80 8Q88 30 66 48L36 72 26 62 58 36Q62 30 66 30L70 22Q76 16 80 8Z') + `<path d="M62 38l6 2-4 4" fill="${GOLD}" stroke="${INK}" stroke-width="1.4"/>` + shaft(30, 68, 14, 84, '#3b2b18', 6) + `<rect x="21" y="58" width="22" height="7" rx="2" transform="rotate(45 32 61)" fill="${GOLD_D}" stroke="${INK}" stroke-width="2"/>`,
  // 黄龙钩镰刀: hooked sickle blade on a pole.
  signature_zhang_liao_weapon: () => shaft(20, 84, 62, 22) + blade('M60 24Q66 6 84 10Q74 14 72 22L82 30Q70 34 60 24Z', '#f4e2a2') + `<path d="M58 30 70 18" stroke="${GOLD}" stroke-width="3"/>` + tassel(56, 32),
  // 虎痴碎岳锤: huge spiked war hammer.
  signature_xu_chu_weapon: () => shaft(22, 84, 58, 34, WOOD, 6) + `<g transform="rotate(-36 64 26)"><rect x="46" y="12" width="36" height="28" rx="6" fill="#9aa39e" stroke="${INK}" stroke-width="2.6"/><path d="M46 20h36M46 32h36" stroke="${GOLD}" stroke-width="2.4"/><path d="M44 18l-8 8 8 8M84 18l8 8-8 8" fill="#c7cfca" stroke="${INK}" stroke-width="2"/></g>`,
  // 幽雷羽扇: dark crane feather fan with lightning.
  signature_sima_yi_weapon: () => `<path d="M48 82 52 54" stroke="${INK}" stroke-width="7" stroke-linecap="round"/><path d="M48 82 52 54" stroke="#3b2b18" stroke-width="4" stroke-linecap="round"/>` + `<path d="M52 56Q22 44 22 20Q40 8 52 14Q64 8 82 20Q82 44 52 56Z" fill="#4c3a66" stroke="${INK}" stroke-width="2.6"/>` + `<path d="M52 54V16M52 54 30 24M52 54 74 24M52 54 24 36M52 54 80 36" stroke="#8f7ab8" stroke-width="1.4"/>` + `<path d="M56 18 46 34h8l-8 16" stroke="#c9b8ff" stroke-width="3" fill="none" stroke-linejoin="round"/>`,
  // 双股剑: two crossed swords.
  signature_liu_bei_weapon: () => `<g transform="translate(96 0) scale(-1 1)">${straightSword('#e8f0ec', '#4fd68f')}</g>` + straightSword('#e8f0ec', GOLD),
  // 青龙偃月刀: crescent glaive with a dragon spine and green tassel.
  signature_guan_yu_weapon: () => shaft(18, 86, 60, 30, '#2a5544', 5.5) + blade('M58 32Q60 8 84 6Q80 18 86 30Q76 44 58 32Z', '#e4fff1', '#ffffff') + `<path d="M62 28Q66 14 80 10" stroke="#277a5a" stroke-width="2.4" fill="none"/><path d="M66 22l3-3m2 5 3-3m-9 7 3-3" stroke="#277a5a" stroke-width="1.6"/>` + tassel(56, 36, '#4fd68f'),
  // 丈八蛇矛: long spear with a wavy serpent head.
  signature_zhang_fei_weapon: () => shaft(14, 88, 62, 34, '#2c2c2c', 5) + blade('M60 36Q64 30 60 26Q58 20 66 18Q70 12 68 6Q78 8 76 18Q72 24 76 28Q72 36 66 38Z') + tassel(58, 38, '#e2493b'),
  // 龙胆亮银枪: bright silver spear with a white tassel.
  signature_zhao_yun_weapon: () => shaft(14, 86, 64, 32, '#c7d3d6', 5) + blade('M62 34 80 8 84 14 70 40Z', '#ffffff') + `<path d="M64 32 80 12" stroke="#9fb3b8" stroke-width="1.2"/>` + tassel(62, 36, '#f1e4c3'),
  // 卧龙羽扇: white crane feather fan.
  signature_zhuge_liang_weapon: () => `<path d="M48 84 52 56" stroke="${INK}" stroke-width="7" stroke-linecap="round"/><path d="M48 84 52 56" stroke="#a8702a" stroke-width="4" stroke-linecap="round"/>` + `<path d="M52 58Q20 46 20 20Q38 6 52 12Q66 6 84 20Q84 46 52 58Z" fill="#f4f7ee" stroke="${INK}" stroke-width="2.6"/>` + `<path d="M52 56V14M52 56 30 22M52 56 74 22M52 56 24 36M52 56 80 36" stroke="#a9c3b2" stroke-width="1.4"/><circle cx="52" cy="56" r="4" fill="${GOLD}" stroke="${INK}" stroke-width="1.6"/>`,
  // 紫电剑: violet blade with lightning edge.
  signature_sun_quan_weapon: () => straightSword('#cbb6ff', GOLD, '#7a4cff') + `<path d="M68 20 60 26 64 30 52 40" stroke="#ffffff" stroke-width="1.8" fill="none" stroke-linejoin="round"/>`,
  // 赤霄火羽扇: flaming red fan.
  signature_zhou_yu_weapon: () => `<path d="M48 84 52 56" stroke="${INK}" stroke-width="7" stroke-linecap="round"/><path d="M48 84 52 56" stroke="#3b2b18" stroke-width="4" stroke-linecap="round"/>` + `<path d="M52 58Q20 46 20 20Q38 6 52 12Q66 6 84 20Q84 46 52 58Z" fill="#d9472f" stroke="${INK}" stroke-width="2.6"/>` + `<path d="M36 34Q40 22 46 28Q48 16 56 22Q62 14 66 28Q72 24 70 36Q60 46 46 44Q36 42 36 34Z" fill="#ffb347"/><path d="M46 38Q50 30 54 34Q58 28 60 38Q54 42 46 38Z" fill="#fff1a8"/>`,
  // 白衣兵书: bound bamboo strategy book.
  signature_lv_meng_weapon: () => `<g transform="rotate(-12 48 48)"><rect x="18" y="22" width="60" height="52" rx="4" fill="#e9dcb6" stroke="${INK}" stroke-width="2.6"/>${[26, 34, 42, 50, 58, 66].map(x => `<path d="M${x} 24v48" stroke="#b39c66" stroke-width="1.4"/>`).join('')}<path d="M18 36h60M18 60h60" stroke="#8a3b2e" stroke-width="3"/><rect x="40" y="40" width="16" height="16" rx="2" fill="#8a3b2e" stroke="${INK}" stroke-width="1.6"/><path d="M44 48h8M48 44v8" stroke="#f1e4c3" stroke-width="1.6"/></g>`,
  // 锦帆百翎弓: recurve bow with brocade feathers.
  signature_gan_ning_weapon: () => `<path d="M30 12Q72 24 70 48Q72 72 30 84" stroke="${INK}" stroke-width="8" fill="none" stroke-linecap="round"/><path d="M30 12Q72 24 70 48Q72 72 30 84" stroke="#279292" stroke-width="5" fill="none" stroke-linecap="round"/><path d="M30 12 30 84" stroke="#f1e4c3" stroke-width="1.4"/><rect x="64" y="42" width="10" height="12" rx="2" fill="${GOLD}" stroke="${INK}" stroke-width="1.6"/>` + `<path d="M74 30l10-6-2 10ZM76 62l10 4-8 6Z" fill="#e2493b" stroke="${INK}" stroke-width="1.2"/>`,
  // 神臂银弦弓: silver longbow, arrow nocked.
  signature_taishi_ci_weapon: () => `<path d="M26 10Q74 20 72 48Q74 76 26 86" stroke="${INK}" stroke-width="8" fill="none" stroke-linecap="round"/><path d="M26 10Q74 20 72 48Q74 76 26 86" stroke="#dfe8e4" stroke-width="5" fill="none" stroke-linecap="round"/><path d="M26 10 34 48 26 86" stroke="#ffffff" stroke-width="1.4" fill="none"/>` + shaft(34, 48, 84, 48, '#a8702a', 2.5) + blade('M84 43 94 48 84 53Z') + `<path d="M34 44l-6-4M34 52l-6 4" stroke="#e2493b" stroke-width="2.4"/>`,
};

// ---------- Armor / command token ----------
const ARMOR = () => `<path d="M30 20Q48 12 66 20L76 30 70 40V78Q48 88 26 78V40L20 30Z" fill="#6f7c78" stroke="${INK}" stroke-width="2.6" stroke-linejoin="round"/>`
  + Array.from({ length: 5 }, (_, r) => Array.from({ length: 5 }, (_, c) => `<rect x="${30 + c * 7.5}" y="${36 + r * 8}" width="6.5" height="7" rx="1.4" fill="${(r + c) % 2 ? '#9aa6a2' : '#b9c3bf'}" stroke="${INK}" stroke-width=".8"/>`).join('')).join('')
  + `<path d="M36 22Q48 30 60 22" stroke="${GOLD}" stroke-width="3" fill="none"/><circle cx="48" cy="34" r="5" fill="${GOLD}" stroke="${INK}" stroke-width="1.6"/>`;
const TOKEN = () => `<path d="M18 52Q18 32 36 28Q44 20 58 24Q78 26 80 44Q82 58 70 64L72 76H58L56 66H40L38 76H24L26 64Q18 60 18 52Z" fill="${GOLD}" stroke="${INK}" stroke-width="2.6" stroke-linejoin="round"/>`
  + `<path d="M48 26V66" stroke="${GOLD_D}" stroke-width="2" stroke-dasharray="4 3"/><path d="M28 44q4-4 8 0M60 40q6-4 10 2" stroke="${INK}" stroke-width="2.2" fill="none"/><circle cx="32" cy="38" r="2.4" fill="${INK}"/><path d="M38 52h20" stroke="#8a3b2e" stroke-width="3"/>`;

// ---------- Horses: one profile head, coats and marks follow each horse's name ----------
const HORSE_HEAD = 'M60 12 68 8 70 20Q84 32 82 58L80 86H44L48 64Q40 60 30 64Q16 66 14 56Q12 46 26 38Q42 22 60 12Z';
const HORSE_MANE = 'M62 14Q84 28 82 62L90 56Q94 28 72 10Z';
const horse = ({ coat, mane, shade = '#0006', mark = '', extra = '', bridle = GOLD }) =>
  `<path d="${HORSE_MANE}" fill="${mane}" stroke="${INK}" stroke-width="2.4" stroke-linejoin="round"/>`
  + `<path d="${HORSE_HEAD}" fill="${coat}" stroke="${INK}" stroke-width="2.6" stroke-linejoin="round"/>`
  + `<path d="M48 64Q60 56 70 66L80 86H58Z" fill="${shade}"/>` + mark
  + `<circle cx="40" cy="38" r="3.4" fill="${INK}"/><circle cx="39" cy="37" r="1" fill="#fff"/><path d="M20 54q3 2 5 0" stroke="${INK}" stroke-width="2" fill="none"/>`
  + `<path d="M24 46Q38 50 52 40M44 28 52 40 62 62" stroke="${bridle}" stroke-width="2.6" fill="none" stroke-linejoin="round"/>` + extra;

const HORSES = {
  basic_horse: () => horse({ coat: '#9a6a3f', mane: '#3b2b18', bridle: '#c9b37c' }),
  signature_cao_cao_horse: () => horse({ coat: '#2a2e33', mane: '#111', mark: `<path d="M70 30Q76 46 74 70" stroke="#6fa8ff" stroke-width="2" fill="none" opacity=".7"/>`, extra: `<path d="M86 30h8M84 44h10M84 58h8" stroke="#6fa8ff" stroke-width="2.4" stroke-linecap="round" opacity=".8"/>` }), // 绝影: speed shadow
  signature_xiahou_dun_horse: () => horse({ coat: '#23262a', mane: '#0d0d0d', mark: `<path d="M32 34 48 40" stroke="#111" stroke-width="7" stroke-linecap="round"/><path d="M30 30l26 12" stroke="#3b2b18" stroke-width="2"/>` }), // 独眼乌骓: eye patch
  signature_zhang_liao_horse: () => horse({ coat: '#8d949a', mane: '#e4e7ea', extra: `<path d="M8 30h16M4 42h14M8 54h10" stroke="#e4e7ea" stroke-width="2.4" stroke-linecap="round" opacity=".7"/>` }), // 逍遥疾影
  signature_xu_chu_horse: () => horse({ coat: '#5d646a', mane: '#2b2f33', bridle: '#c7cfca', mark: `<path d="M44 16Q56 10 66 18L60 34Q50 24 40 28Z" fill="#9aa39e" stroke="${INK}" stroke-width="2"/>` }), // 镇岳铁骠: chamfron
  signature_sima_yi_horse: () => horse({ coat: '#3a2e4a', mane: '#1a1424', mark: `<circle cx="40" cy="38" r="6" fill="none" stroke="#b98cff" stroke-width="1.6" opacity=".9"/>`, extra: `<path d="M86 14l2 5 5 1-5 2-2 5-2-5-5-2 5-1Z" fill="#c9b8ff"/>` }), // 玄策夜行
  signature_liu_bei_horse: () => horse({ coat: '#e9e4d8', mane: '#c7bfae', shade: '#0002', mark: `<path d="M34 30q4 6 10 4l-6 6Z" fill="#8a3b2e"/>` }), // 的卢: forehead mark
  signature_guan_yu_horse: () => horse({ coat: '#c83a24', mane: '#6e1a10', mark: `<path d="M28 44Q40 40 50 30" stroke="#ff8a6a" stroke-width="2" fill="none"/>` }), // 赤兔
  signature_zhang_fei_horse: () => horse({ coat: '#1d2124', mane: '#000', mark: `<path d="M30 32Q44 22 58 22" stroke="#5a6066" stroke-width="2" fill="none"/>` }), // 乌骓
  signature_zhao_yun_horse: () => horse({ coat: '#f6f6f2', mane: '#ffffff', shade: '#8bafc422', bridle: '#8bafc4', extra: `<circle cx="48" cy="48" r="40" fill="none" stroke="#ffffff" stroke-width="1.4" opacity=".35"/>` }), // 照夜玉狮子
  signature_zhuge_liang_horse: () => horse({ coat: '#7e9aa0', mane: '#3e5a5e', mark: `<path d="M56 30h12M54 40h14M54 50h14" stroke="#a9c3c6" stroke-width="2" stroke-linecap="round"/>` }), // 卧龙青骢: dappled blue-grey
  signature_sun_quan_horse: () => horse({ coat: '#8a5a34', mane: '#3b2412', extra: `<path d="M44 90q6-6 12 0t12 0t12 0" stroke="#5fb2ff" stroke-width="3" fill="none"/>` }), // 江东踏浪
  signature_zhou_yu_horse: () => horse({ coat: '#2a1d1a', mane: '#ff6a2a', mark: `<path d="M74 16q10 8 8 18q8-4 6-14q6 10 2 22" stroke="#ffd36a" stroke-width="2" fill="none"/>` }), // 赤壁火骊: flame mane
  signature_lv_meng_horse: () => horse({ coat: '#efece4', mane: '#d6d1c4', shade: '#0002', extra: `<path d="M20 70q10 6 20 0" stroke="#8fb5e0" stroke-width="3" fill="none"/>` }), // 白衣渡江
  signature_gan_ning_horse: () => horse({ coat: '#a0522d', mane: '#4a2410', extra: `<circle cx="56" cy="66" r="3.4" fill="${GOLD}" stroke="${INK}" stroke-width="1.4"/><circle cx="64" cy="70" r="3.4" fill="${GOLD}" stroke="${INK}" stroke-width="1.4"/>` }), // 锦帆破浪: bells
  signature_taishi_ci_horse: () => horse({ coat: '#7a4a2a', mane: '#2e1a0e', extra: `<path d="M86 22q4 14 0 30" stroke="#f1e4c3" stroke-width="2.4" fill="none" stroke-linecap="round" opacity=".7"/>` }), // 笃烈追风
};

const DRAWINGS = { ...WEAPONS, ...HORSES, basic_armor: ARMOR, basic_command_token: TOKEN };
const SLOT_FALLBACK = { weapon: 'basic_weapon', armor: 'basic_armor', command_token: 'basic_command_token', horse: 'basic_horse' };

function frame(quality) {
  const q = QUALITY_STYLE[quality] || QUALITY_STYLE.white;
  const corner = quality === 'gold' ? 'M8 20V8h12M76 8h12v12M8 76v12h12M88 76v12H76' : quality === 'red' || quality === 'purple' ? 'M8 18V8h10M78 8h10v10M8 78v10h10M88 78v10H78' : '';
  const pips = Array.from({ length: q.pips }, (_, i) => `<path d="M${86 - i * 8} 84l3 3-3 3-3-3Z" fill="${q.frame}" stroke="${INK}" stroke-width=".8"/>`).join('');
  return {
    back: `<defs><radialGradient id="g" cx=".5" cy=".42" r=".62"><stop stop-color="${q.glow}" stop-opacity="${quality === 'white' ? '.18' : '.42'}"/><stop offset="1" stop-color="${INK}" stop-opacity="0"/></radialGradient></defs>`
      + `<rect x="2" y="2" width="92" height="92" rx="16" fill="#13261f"/><rect x="2" y="2" width="92" height="92" rx="16" fill="url(#g)"/>`,
    front: `<rect x="3" y="3" width="90" height="90" rx="15" fill="none" stroke="${q.frame}" stroke-width="${quality === 'gold' ? 4 : 3}"/>`
      + (corner ? `<path d="${corner}" stroke="${q.frame}" stroke-width="2.4" fill="none" stroke-linecap="round"/>` : '') + pips,
  };
}

const cache = new Map();
/** Safe local image source: equipmentIcon(templateId, quality) → data:image/svg+xml URI. Unknown ids fall back per slot. */
export function equipmentIcon(templateId, quality = 'white', slot = null) {
  const card = tacticArtMetadata(templateId);
  if (card) {
    const key = 'tactic|' + card.id;
    if (cache.has(key)) return cache.get(key);
    const svg = composeTacticIcon(card.id, QUALITY_STYLE, card.signatureWeaponId ? WEAPONS[card.signatureWeaponId]() : '');
    const uri = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
    cache.set(key, uri);
    return uri;
  }
  const id = Object.hasOwn(DRAWINGS, templateId) ? templateId : SLOT_FALLBACK[slot] || (/_horse$/.test(String(templateId)) ? 'basic_horse' : /_armor$/.test(String(templateId)) ? 'basic_armor' : /command/.test(String(templateId)) ? 'basic_command_token' : 'basic_weapon');
  const q = Object.hasOwn(QUALITY_STYLE, quality) ? quality : 'white';
  const key = id + '|' + q;
  if (cache.has(key)) return cache.get(key);
  const f = frame(q);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96">${f.back}<g transform="translate(2 2) scale(.96)">${DRAWINGS[id]()}</g>${f.front}</svg>`;
  const uri = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  cache.set(key, uri);
  return uri;
}

export const EQUIPMENT_ART_IDS = Object.freeze(Object.keys(DRAWINGS));
export { TACTIC_ART_IDS, TACTIC_ART, TACTIC_SYMBOL_IDS, TACTIC_RARITY_QUALITY, tacticArtMetadata };
