// Original procedural portrait resources. No remote assets, fonts or image requests.
// HERO_ART drives the battlefield sprites (v1-renderer.js); PORTRAIT drives the high-contrast lobby busts below.
export const HERO_ART = Object.freeze({
  cao_cao: { name: '曹操', faction: 'wei', accent: '#365668', glyph: '令', gear: 'sword', silhouette: 'cloak', skill: '魏武号令' },
  xiahou_dun: { name: '夏侯惇', faction: 'wei', accent: '#5b6472', glyph: '破', gear: 'saber', silhouette: 'headband', skill: '独眼破军' },
  zhang_liao: { name: '张辽', faction: 'wei', accent: '#4c6b8a', glyph: '突', gear: 'hook', silhouette: 'shoulders', skill: '合肥突阵' },
  xu_chu: { name: '许褚', faction: 'wei', accent: '#9e8556', glyph: '撼', gear: 'axe', silhouette: 'broad', skill: '虎痴撼地' },
  sima_yi: { name: '司马懿', faction: 'wei', accent: '#68537c', glyph: '雷', gear: 'curved-fan', silhouette: 'tall', skill: '幽雷诡阵' },
  liu_bei: { name: '刘备', faction: 'shu', accent: '#6c8850', glyph: '仁', gear: 'swords', silhouette: 'ribbon', skill: '仁德援军' },
  guan_yu: { name: '关羽', faction: 'shu', accent: '#276b57', glyph: '龙', gear: 'crescent', silhouette: 'beard', skill: '青龙横扫' },
  zhang_fei: { name: '张飞', faction: 'shu', accent: '#46504c', glyph: '吼', gear: 'serpent', silhouette: 'wide-beard', skill: '长坂怒吼' },
  zhao_yun: { name: '赵云', faction: 'shu', accent: '#8bafc4', glyph: '胆', gear: 'spear', silhouette: 'silver', skill: '龙胆三穿' },
  zhuge_liang: { name: '诸葛亮', faction: 'shu', accent: '#81a899', glyph: '阵', gear: 'fan', silhouette: 'sleeves', skill: '八阵风牢' },
  sun_quan: { name: '孙权', faction: 'wu', accent: '#805b74', glyph: '壁', gear: 'seal', silhouette: 'crown', skill: '江东铁壁' },
  zhou_yu: { name: '周瑜', faction: 'wu', accent: '#bb6245', glyph: '焰', gear: 'fire-fan', silhouette: 'slim', skill: '赤壁烈焰' },
  lv_meng: { name: '吕蒙', faction: 'wu', accent: '#5e8481', glyph: '伏', gear: 'knives', silhouette: 'short', skill: '白衣伏兵' },
  gan_ning: { name: '甘宁', faction: 'wu', accent: '#279292', glyph: '帆', gear: 'halberds', silhouette: 'topknot', skill: '锦帆箭雨' },
  taishi_ci: { name: '太史慈', faction: 'wu', accent: '#af8f5f', glyph: '矢', gear: 'bow', silhouette: 'quiver', skill: '笃烈三矢' },
});

const INK = '#100c09';
const FACTION_BG = { wei: ['#6f9cff', '#1b3566'], shu: ['#62e0a0', '#14513a'], wu: ['#ff9f61', '#7a2a14'] };

// Each hero: face, eyes, headgear, beard, garment and signature weapon, chosen from the novel's iconography.
const PORTRAIT = {
  cao_cao:     { skin: '#e8bc92', eyes: 'stern', head: 'guan', hair: '#191410', beard: 'goatee', body: 'armor', cloth: '#2b4269', trim: '#f2c46b', cape: '#8a1f22', weapon: 'sword', metal: '#dbe8ff' },
  xiahou_dun:  { skin: '#d9a77d', eyes: 'patch', head: 'helmet', helm: '#6f7a86', plume: '#c8322a', beard: 'stubble', body: 'armor', cloth: '#454e5c', trim: '#c9a35a', weapon: 'saber', metal: '#e4ecf2' },
  zhang_liao:  { skin: '#e0b088', eyes: 'stern', head: 'winged', helm: '#5c7896', plume: '#f2c46b', beard: 'mustache', body: 'armor', cloth: '#30506f', trim: '#e2c27a', weapon: 'hook', metal: '#ffd36a' },
  xu_chu:      { skin: '#c98a5e', eyes: 'round', head: 'bald', beard: 'wide', hair: '#1b130e', body: 'broad', cloth: '#7b5a2c', trim: '#d7a54e', weapon: 'hammer', metal: '#a9b0b8' },
  sima_yi:     { skin: '#e2c09c', eyes: 'narrow', head: 'scholar', hair: '#141016', beard: 'thin', body: 'robe', cloth: '#3d2a58', trim: '#b98cff', weapon: 'fan', metal: '#9c7ad6' },
  liu_bei:     { skin: '#ecc59d', eyes: 'gentle', head: 'guan', hair: '#1c1611', beard: 'short', ears: 'long', body: 'robe', cloth: '#3f6b33', trim: '#f2c46b', weapon: 'twin', metal: '#e8f0e0' },
  guan_yu:     { skin: '#b9402c', eyes: 'phoenix', head: 'hood', hood: '#1e6e4c', beard: 'long', body: 'armor', cloth: '#1c573f', trim: '#f2c46b', weapon: 'glaive', metal: '#c8f5df' },
  zhang_fei:   { skin: '#8d5a3a', eyes: 'round', head: 'wild', hair: '#0f0c0a', band: '#c8322a', beard: 'wild', body: 'broad', cloth: '#2c3430', trim: '#b88c4a', weapon: 'serpent', metal: '#d9e2e6' },
  zhao_yun:    { skin: '#f0cfa8', eyes: 'stern', head: 'silver', helm: '#e3ecf0', plume: '#ffffff', beard: 'none', body: 'armor', cloth: '#b9c9d2', trim: '#7fb6ff', weapon: 'spear', metal: '#f4fbff' },
  zhuge_liang: { skin: '#eccaa4', eyes: 'gentle', head: 'lunjin', hood: '#26475a', beard: 'thin', body: 'crane', cloth: '#ece6d6', trim: '#2a5544', weapon: 'feather', metal: '#ffffff' },
  sun_quan:    { skin: '#e6bb8f', eyes: 'jade', head: 'crown', hair: '#2a1530', beard: 'purple', body: 'armor', cloth: '#5a2f4f', trim: '#ffc940', weapon: 'sword', metal: '#d8b8ff' },
  zhou_yu:     { skin: '#f2d2ae', eyes: 'gentle', head: 'young', hair: '#120e0c', beard: 'none', body: 'robe', cloth: '#a33a24', trim: '#ffc27a', weapon: 'firefan', metal: '#ff8a4c' },
  lv_meng:     { skin: '#ddb088', eyes: 'stern', head: 'whitehood', hood: '#ece8dc', beard: 'mustache', body: 'robe', cloth: '#dcd6c6', trim: '#5f8a86', weapon: 'book', metal: '#c9a35a' },
  gan_ning:    { skin: '#c99068', eyes: 'round', head: 'topknot', hair: '#120d0b', beard: 'stubble', body: 'armor', cloth: '#16706e', trim: '#ffc940', weapon: 'bow', metal: '#e1b46a', feathers: true },
  taishi_ci:   { skin: '#dcaa80', eyes: 'stern', head: 'helmet', helm: '#8a6a3a', plume: '#2c8a5a', beard: 'mustache', body: 'armor', cloth: '#6e5230', trim: '#e2c27a', weapon: 'bow', metal: '#e8eef2', quiver: true },
};

const outline = (inner, width = 2.4) => `<g stroke="${INK}" stroke-width="${width}" stroke-linejoin="round" stroke-linecap="round">${inner}</g>`;

function weaponSvg(p) {
  const m = p.metal;
  switch (p.weapon) {
    case 'sword': return outline(`<path d="M101 122 L107 26 L111 16 L114 26 L108 122Z" fill="${m}"/><path d="M96 104 H122 V110 H96Z" fill="#f2c46b"/>`);
    case 'saber': return outline(`<path d="M96 124 Q98 64 122 16 Q114 70 106 124Z" fill="${m}"/><path d="M92 106 H114 V112 H92Z" fill="#c9a35a"/>`);
    case 'hook': return outline(`<path d="M100 128 L106 18 L110 18 L106 128Z" fill="#5a3b1e"/><path d="M106 20 Q128 10 124 44 Q118 28 105 30Z" fill="${m}"/>`);
    case 'hammer': return outline(`<path d="M98 128 L106 44 L111 44 L104 128Z" fill="#4a2f18"/><path d="M90 18 H124 V48 H90Z" rx="4" fill="${m}"/><path d="M90 28 H124 M90 38 H124" stroke-width="1.6"/>`);
    case 'fan': case 'feather': case 'firefan': {
      const fill = p.weapon === 'firefan' ? '#ff7a3c' : p.weapon === 'feather' ? '#ffffff' : m;
      const tip = p.weapon === 'firefan' ? '#ffd36a' : p.weapon === 'feather' ? '#cfe8dc' : '#3a2650';
      return outline(`<path d="M100 126 L104 92 L108 92 L106 126Z" fill="#6a4a24"/><path d="M106 94 Q80 74 86 42 Q104 30 122 42 Q128 74 106 94Z" fill="${fill}"/><path d="M106 94 Q86 66 92 44 M106 94 L104 38 M106 94 Q122 66 118 42" stroke="${tip}" stroke-width="1.6" fill="none"/>`);
    }
    case 'twin': return outline(`<path d="M96 124 L104 30 L108 22 L110 30 L100 124Z" fill="${m}"/><path d="M118 124 L116 34 L119 24 L122 34 L122 124Z" fill="${m}"/><path d="M92 106 H128 V111 H92Z" fill="#f2c46b"/>`);
    case 'glaive': return outline(`<path d="M104 128 L110 8 L114 8 L108 128Z" fill="#3a2414"/><path d="M110 10 Q134 18 126 60 Q118 36 107 34Z" fill="${m}"/><path d="M118 22 Q124 30 122 42" stroke="#1e6e4c" stroke-width="2" fill="none"/><path d="M106 36 Q98 46 102 54 Q108 46 108 38Z" fill="#c8322a"/>`);
    case 'serpent': return outline(`<path d="M104 128 L110 26 L114 26 L108 128Z" fill="#2a1d14"/><path d="M112 4 Q120 10 113 16 Q106 22 113 28 L109 28 Q102 22 109 16 Q116 10 110 4Z" fill="${m}"/><path d="M104 28 H120 V32 H104Z" fill="#c8322a"/>`);
    case 'spear': return outline(`<path d="M104 128 L110 24 L114 24 L108 128Z" fill="#e8e8e8"/><path d="M112 2 L104 24 L112 20 L120 24Z" fill="${m}"/><path d="M106 26 Q98 38 104 46 Q110 38 110 28Z" fill="#c8322a"/>`);
    case 'bow': return outline(`<path d="M98 18 Q132 66 98 114" fill="none" stroke-width="5"/><path d="M98 18 Q132 66 98 114" fill="none" stroke="${m}" stroke-width="2.4"/><path d="M98 18 L98 114" stroke-width="1"/>${p.quiver ? '<path d="M14 82 L26 50 L34 54 L24 86Z" fill="#6a4320"/><path d="M26 50 L22 38 M30 52 L28 40 M34 54 L34 42" stroke="#f1e4c3" stroke-width="2"/>' : ''}`);
    case 'book': return outline(`<path d="M90 92 L120 86 L124 116 L94 122Z" fill="#2a4a6a"/><path d="M92 96 L120 91" stroke="${m}" stroke-width="2"/><path d="M16 120 L30 90 L36 93 L24 124Z" fill="#cfd8d0"/>`);
    default: return '';
  }
}

function bodySvg(p) {
  const broad = p.body === 'broad';
  const shape = broad ? 'M2 128 C4 96 22 80 46 77 L82 77 C106 80 124 96 126 128Z' : 'M12 128 C15 100 30 86 50 80 L78 80 C98 86 113 100 116 128Z';
  let out = p.cape ? outline(`<path d="M4 128 Q8 88 40 78 L88 78 Q120 88 124 128Z" fill="${p.cape}"/>`) : '';
  out += outline(`<path d="${shape}" fill="${p.cloth}"/>`);
  if (p.body === 'armor' || broad) {
    // Lamellar rows and pauldrons give armored heroes weight; trim colour carries the faction gold.
    out += `<g stroke="${INK}" stroke-opacity=".45" stroke-width="1.2" fill="none"><path d="M30 104 H98 M24 114 H104 M20 124 H108"/></g>`;
    out += outline(`<ellipse cx="${broad ? 26 : 32}" cy="94" rx="${broad ? 20 : 16}" ry="11" fill="${p.cloth}"/><ellipse cx="${broad ? 102 : 96}" cy="94" rx="${broad ? 20 : 16}" ry="11" fill="${p.cloth}"/>`, 2);
    out += `<path d="M${broad ? 8 : 17} 93 Q${broad ? 26 : 32} 82 ${broad ? 44 : 47} 93 M${broad ? 84 : 81} 93 Q${broad ? 102 : 96} 82 ${broad ? 120 : 111} 93" stroke="${p.trim}" stroke-width="2.4" fill="none"/>`;
    out += `<path d="M50 80 L64 100 L78 80" stroke="${p.trim}" stroke-width="3" fill="none"/><circle cx="64" cy="108" r="5" fill="${p.trim}" stroke="${INK}" stroke-width="1.6"/>`;
  } else {
    // Robes: crossed collar, wide sleeves and a sash.
    out += `<path d="M48 80 L72 120 M80 80 L58 108" stroke="${p.trim}" stroke-width="4" fill="none"/><path d="M28 116 H100" stroke="${INK}" stroke-opacity=".35" stroke-width="5"/>`;
    if (p.body === 'crane') out += `<path d="M12 128 C15 108 22 98 32 92 L36 128Z M116 128 C113 108 106 98 96 92 L92 128Z" fill="#2a2a2a" opacity=".85"/>`;
  }
  return out;
}

function headBack(p) {
  if (p.head === 'hood') return outline(`<path d="M40 50 Q34 76 30 92 L44 80Z M88 50 Q94 76 98 92 L84 80Z" fill="${p.hood}"/>`);
  if (p.head === 'whitehood') return outline(`<path d="M40 48 Q36 26 64 18 Q92 26 88 48 L92 84 L76 78 L52 78 L36 84Z" fill="${p.hood}"/>`);
  if (p.head === 'young') return outline(`<path d="M46 46 Q40 70 42 86 L50 78 Z M82 46 Q88 70 86 86 L78 78Z" fill="${p.hair}"/>`);
  return '';
}

function faceSvg(p) {
  const ears = p.ears === 'long' ? 'ry="9" cy="57"' : 'ry="6" cy="53"';
  return outline(`<path d="M58 66 H70 V84 H58Z" fill="${p.skin}"/><ellipse cx="46" rx="4" ${ears} fill="${p.skin}"/><ellipse cx="82" rx="4" ${ears} fill="${p.skin}"/><path d="M47 50 Q47 30 64 30 Q81 30 81 50 Q81 66 64 74 Q47 66 47 50Z" fill="${p.skin}"/>`, 2.2)
    + `<path d="M64 30 Q81 30 81 50 Q81 66 64 74 Q72 58 70 40Z" fill="#000" opacity=".16"/><path d="M58 84 H70 V78 Q64 82 58 78Z" fill="#000" opacity=".25"/>`;
}

function eyesSvg(p) {
  const pupil = p.eyes === 'jade' ? '#21a35e' : INK;
  const brow = (l, r, w = 3.2) => `<path d="${l} ${r}" stroke="${INK}" stroke-width="${w}" stroke-linecap="round" fill="none"/>`;
  const almond = `<path d="M51 50 Q56 46.5 61 49.5 Q56 52.5 51 50Z M77 50 Q72 46.5 67 49.5 Q72 52.5 77 50Z" fill="#f8efd8"/>`;
  const pupils = `<circle cx="56.5" cy="49.6" r="1.8" fill="${pupil}"/><circle cx="71.5" cy="49.6" r="1.8" fill="${pupil}"/>`;
  switch (p.eyes) {
    case 'phoenix': return `<path d="M49 51 Q56 45 63 48.5 Q57 52 49 51Z M79 51 Q72 45 65 48.5 Q71 52 79 51Z" fill="#f8efd8"/><circle cx="57" cy="49" r="1.5" fill="${INK}"/><circle cx="71" cy="49" r="1.5" fill="${INK}"/>${brow('M46 42 L62 46', 'M82 42 L66 46', 3.6)}`;
    case 'round': return `<circle cx="56" cy="49.5" r="3.6" fill="#f8efd8" stroke="${INK}" stroke-width="1.2"/><circle cx="72" cy="49.5" r="3.6" fill="#f8efd8" stroke="${INK}" stroke-width="1.2"/><circle cx="56" cy="49.5" r="2" fill="${INK}"/><circle cx="72" cy="49.5" r="2" fill="${INK}"/>${brow('M48 41 Q55 38 62 44', 'M80 41 Q73 38 66 44', 4.2)}`;
    case 'gentle': return `<path d="M51 50 Q56 47 61 50 M67 50 Q72 47 77 50" stroke="${INK}" stroke-width="2.2" fill="none" stroke-linecap="round"/><circle cx="56" cy="50" r="1.3" fill="${INK}"/><circle cx="72" cy="50" r="1.3" fill="${INK}"/>${brow('M50 44 Q56 41.5 61 43.5', 'M78 44 Q72 41.5 67 43.5', 2.2)}`;
    case 'narrow': return `<path d="M51 50 Q56 48 61 49 Q56 51 51 50Z M77 50 Q72 48 67 49 Q72 51 77 50Z" fill="#f2e2c2"/><circle cx="57" cy="49.5" r="1.2" fill="#6b3fa0"/><circle cx="71" cy="49.5" r="1.2" fill="#6b3fa0"/>${brow('M48 43 L62 46.5', 'M80 43 L66 46.5', 2.4)}`;
    case 'patch': return `${almond}<circle cx="71.5" cy="49.6" r="1.8" fill="${INK}"/><path d="M50 45 H62 V54 Q56 56 50 54Z" fill="#0b0b0b"/><path d="M44 40 L84 58" stroke="#0b0b0b" stroke-width="2"/>${brow('M48 42 L62 46', 'M80 42 L66 46')}<path d="M73 54 L77 62" stroke="#8a3a2a" stroke-width="1.4"/>`;
    default: return `${almond}${pupils}${brow('M48 42.5 L62 46', 'M80 42.5 L66 46')}`;
  }
}

function mouthSvg(p) {
  const fierce = ['round'].includes(p.eyes);
  return `<path d="M64 50 L61.5 60 H66.5" stroke="${INK}" stroke-opacity=".55" stroke-width="1.6" fill="none"/>`
    + (fierce ? `<path d="M57 66 Q64 70 71 66 Q64 64 57 66Z" fill="#5a1410" stroke="${INK}" stroke-width="1.2"/>` : `<path d="M59 66 Q64 67.5 69 66" stroke="${INK}" stroke-width="1.8" fill="none" stroke-linecap="round"/>`);
}

function beardSvg(p) {
  const hair = p.hair || '#15110d';
  const mustache = (c = hair) => `<path d="M55 64.5 Q60 61 64 63 Q68 61 73 64.5 Q68 64.5 64 65.5 Q60 64.5 55 64.5Z" fill="${c}"/>`;
  switch (p.beard) {
    case 'long': return outline(`<path d="M50 60 Q53 74 59 69 L64 71 L69 69 Q75 74 78 60 Q82 92 64 118 Q46 92 50 60Z" fill="#120e0b"/>`, 1.6) + `<path d="M58 80 Q60 98 63 110 M70 80 Q68 98 65 110 M64 78 V112" stroke="#3a3430" stroke-width="1" fill="none"/>` + mustache('#120e0b');
    case 'wild': return outline(`<path d="M44 54 Q40 80 50 90 L54 84 L58 94 L64 86 L70 94 L74 84 L78 90 Q88 80 84 54 Q80 70 64 73 Q48 70 44 54Z" fill="#0f0c0a"/>`, 1.6) + mustache('#0f0c0a');
    case 'wide': return outline(`<path d="M46 56 Q44 80 64 86 Q84 80 82 56 Q78 70 64 72 Q50 70 46 56Z" fill="${hair}"/>`, 1.6) + mustache();
    case 'purple': return outline(`<path d="M47 58 Q46 82 64 92 Q82 82 81 58 Q77 70 64 72 Q51 70 47 58Z" fill="#5d2a72"/>`, 1.6) + mustache('#5d2a72');
    case 'goatee': return mustache() + `<path d="M60 70 Q64 86 68 70 Q64 72 60 70Z" fill="${hair}" stroke="${INK}" stroke-width="1"/>`;
    case 'thin': return mustache() + `<path d="M61 70 Q64 100 67 70 Q64 72 61 70Z" fill="${hair}"/>`;
    case 'short': return outline(`<path d="M50 62 Q64 82 78 62 Q74 72 64 74 Q54 72 50 62Z" fill="${hair}"/>`, 1.2) + mustache();
    case 'mustache': return mustache('#1a130e');
    case 'stubble': return `<path d="M50 60 Q64 78 78 60 Q74 72 64 74 Q54 72 50 60Z" fill="#1a1410" opacity=".32"/>` + mustache('#1a1410');
    default: return '';
  }
}

function headSvg(p) {
  const hair = p.hair || '#15110d';
  const cap = `<path d="M47 46 Q46 27 64 27 Q82 27 81 46 Q73 36 64 36 Q55 36 47 46Z" fill="${hair}"/>`;
  switch (p.head) {
    case 'guan': return outline(`${cap}<path d="M55 14 H73 V30 H55Z" fill="#1a1a1a"/><path d="M48 22 H80" stroke="${p.trim}" stroke-width="3"/>`, 2) + `<path d="M57 18 H71" stroke="${p.trim}" stroke-width="1.6"/>`;
    case 'crown': return outline(`${cap}<path d="M50 32 L53 16 L59 23 L64 11 L69 23 L75 16 L78 32Z" fill="#ffc940"/>`, 2) + `<circle cx="64" cy="24" r="2.6" fill="#c8322a"/>`;
    case 'helmet': return outline(`<path d="M44 48 Q43 22 64 19 Q85 22 84 48 L80 45 Q64 36 48 45Z" fill="${p.helm}"/><path d="M62 19 Q60 6 70 2 Q66 10 66 19Z" fill="${p.plume}"/>`, 2.2) + `<path d="M46 44 Q64 34 82 44" stroke="${p.trim || '#f2c46b'}" stroke-width="2.4" fill="none"/>`;
    case 'winged': return outline(`<path d="M44 34 L24 16 L32 38Z M84 34 L104 16 L96 38Z" fill="${p.plume}"/><path d="M44 48 Q43 22 64 19 Q85 22 84 48 L80 45 Q64 36 48 45Z" fill="${p.helm}"/>`, 2.2) + `<path d="M46 44 Q64 34 82 44" stroke="#f2c46b" stroke-width="2.4" fill="none"/>`;
    case 'silver': return outline(`<path d="M64 20 Q86 4 112 12 Q92 14 74 26Z" fill="${p.plume}"/><path d="M43 52 Q42 21 64 18 Q86 21 85 52 L80 60 L79 44 Q64 36 49 44 L48 60Z" fill="${p.helm}"/>`, 2.2) + `<path d="M48 43 Q64 33 80 43" stroke="#7fb6ff" stroke-width="2.6" fill="none"/><path d="M64 20 V36" stroke="#7fb6ff" stroke-width="2"/>`;
    case 'hood': return outline(`<path d="M44 48 Q40 20 64 18 Q88 20 84 48 Q76 34 64 34 Q52 34 44 48Z" fill="${p.hood}"/>`, 2.2) + `<path d="M48 40 Q64 28 80 40" stroke="#f2c46b" stroke-width="2" fill="none"/>`;
    case 'whitehood': return outline(`<path d="M44 48 Q42 22 64 20 Q86 22 84 48 Q76 36 64 36 Q52 36 44 48Z" fill="${p.hood}"/>`, 2) + `<path d="M46 44 Q64 34 82 44" stroke="${p.trim}" stroke-width="2" fill="none"/>`;
    case 'lunjin': return outline(`${cap}<path d="M48 36 L52 14 Q64 8 76 14 L80 36 Q64 31 48 36Z" fill="${p.hood}"/>`, 2) + `<path d="M50 30 Q64 25 78 30" stroke="#ece6d6" stroke-width="3" fill="none"/>`;
    case 'scholar': return outline(`${cap}<path d="M52 32 L54 6 L74 6 L76 32Z" fill="#141016"/>`, 2) + `<path d="M53 26 H75" stroke="${p.trim}" stroke-width="2"/>`;
    case 'bald': return `<path d="M48 42 Q48 28 64 28 Q80 28 80 42" fill="#000" opacity=".18"/><path d="M56 32 Q62 29 68 31" stroke="#fff" stroke-opacity=".45" stroke-width="2.4" fill="none"/>`;
    case 'wild': return outline(`<path d="M44 46 L38 26 L49 32 L52 15 L61 27 L67 12 L72 27 L82 17 L81 33 L90 34 L84 46 Q64 32 44 46Z" fill="${hair}"/>`, 2) + `<path d="M46 40 Q64 30 82 40" stroke="${p.band}" stroke-width="4" fill="none"/>`;
    case 'topknot': return outline(`${cap}<path d="M57 14 H71 V30 H57Z" fill="${hair}"/><path d="M70 18 Q92 -2 100 6 Q86 10 73 24Z" fill="#ff6b57"/><path d="M68 16 Q80 0 92 0 Q80 8 70 20Z" fill="#ffc940"/>`, 1.8) + `<circle cx="58" cy="32" r="2.4" fill="#ffc940" stroke="${INK}"/><circle cx="70" cy="32" r="2.4" fill="#ffc940" stroke="${INK}"/><path d="M47 40 Q64 32 81 40" stroke="#16706e" stroke-width="3" fill="none"/>`;
    case 'young': return outline(`${cap}<path d="M57 18 H71 V28 H57Z" fill="#ffc940"/>`, 2) + `<path d="M60 22 H68" stroke="#7ff0c4" stroke-width="2"/>`;
    default: return outline(cap, 2);
  }
}

function figure(p) {
  return weaponSvg(p) + bodySvg(p) + headBack(p) + faceSvg(p) + mouthSvg(p) + beardSvg(p) + eyesSvg(p) + headSvg(p);
}

function portraitSvg(id, locked) {
  const art = HERO_ART[id], p = PORTRAIT[id], [light, deep] = FACTION_BG[art.faction];
  const bg = locked ? ['#3a4440', '#121a17'] : [light, deep];
  const rays = locked ? '' : `<g fill="#fff" opacity=".08"><path d="M64 50 L-10 0 H18Z"/><path d="M64 50 L40 -10 H74Z"/><path d="M64 50 L104 -10 H138Z"/><path d="M64 50 L138 30 V64Z"/><path d="M64 50 L-10 40 V74Z"/></g>`;
  const glyph = `<text x="18" y="38" font-size="34" font-family="serif" font-weight="900" fill="#fff" opacity="${locked ? .06 : .14}">${art.glyph}</text>`;
  const body = locked
    ? `<g filter="url(#sil)">${figure(p)}</g><text x="64" y="70" text-anchor="middle" font-size="40" font-family="serif" font-weight="900" fill="#f2c46b" opacity=".55">?</text>`
    : `${figure(p)}<path d="M14 127 C16 100 30 86 50 80" stroke="${light}" stroke-width="2" fill="none" opacity=".9"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128"><title>${art.name}</title><defs><radialGradient id="bg" cx=".5" cy=".36" r=".78"><stop offset="0" stop-color="${bg[0]}"/><stop offset=".55" stop-color="${bg[1]}"/><stop offset="1" stop-color="#070d0a"/></radialGradient><filter id="sil"><feColorMatrix type="matrix" values="0 0 0 0 .03 0 0 0 0 .05 0 0 0 0 .045 0 0 0 1 0"/></filter><clipPath id="c"><rect width="128" height="128" rx="16"/></clipPath></defs><g clip-path="url(#c)"><rect width="128" height="128" fill="url(#bg)"/>${rays}${glyph}${body}<rect x="0" y="108" width="128" height="20" fill="#000" opacity=".22"/></g><rect x="1.5" y="1.5" width="125" height="125" rx="15" fill="none" stroke="${locked ? '#5a6460' : '#f2c46b'}" stroke-width="3"/></svg>`;
}

const portraitCache = new Map();
const safeId = heroId => Object.hasOwn(HERO_ART, heroId) ? heroId : 'guan_yu';
function cached(key, build) {
  if (!portraitCache.has(key)) portraitCache.set(key, `data:image/svg+xml;charset=utf-8,${encodeURIComponent(build())}`);
  return portraitCache.get(key);
}

/** Safe local image source suitable for <img src={heroPortrait(id)}> . */
export function heroPortrait(heroId) { const id = safeId(heroId); return cached(id, () => portraitSvg(id, false)); }
/** Dark silhouette of the same bust for heroes the player has not unlocked yet. */
export function heroSilhouette(heroId) { const id = safeId(heroId); return cached(id + ':locked', () => portraitSvg(id, true)); }
