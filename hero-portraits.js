// Original procedural portrait resources. No remote assets, fonts or image requests.
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

const portraitCache = new Map();
const svgWeapon = {
  sword: '<path d="M83 94V24l5-13 5 13v70M78 72h20"/>',
  saber: '<path d="M20 86 87 29 99 39 36 91Z" fill="#c7d9c6"/><path d="m21 87-9 8"/>',
  hook: '<path d="M88 103V17q23 2 13 21l-13-9M76 26l12 7"/>',
  axe: '<path d="M90 103V20M89 21l-19 7v17l20-7 17 7V28Z" fill="#c8c2a0"/>',
  'curved-fan': '<path d="M88 96q-20-15 1-29M78 66l-3-23 14 3 17-13 5 28Z" fill="#b0a1bd"/>',
  swords: '<path d="M18 98V36l5-12 5 12v62M88 97V32l5-12 5 12v65M12 78h22M82 74h22"/>',
  crescent: '<path d="M91 105V16"/><path d="M91 17q30-9 20 26-9-14-20-13Z" fill="#b7e5cb"/>',
  serpent: '<path d="M92 105V37q-10-8 0-15t0-14"/>',
  spear: '<path d="M91 106V27M91 9l-7 20 7-3 7 3Z" fill="#d2e9e5"/>',
  fan: '<path d="m88 99-4-26M84 77 66 58l8-19 13 5 13-5 9 20Z" fill="#d6ead3"/><path d="m84 74-10-26m10 26 3-29m-3 29 15-26"/>',
  seal: '<path d="M22 102V32l4-11 4 11v70M15 81h22"/><path d="M82 69h21v27H82Z" fill="#d9bd78"/>',
  'fire-fan': '<path d="m89 102-4-26M85 79 67 62l7-19 15 9 13-8 7 20Z" fill="#dbab79"/>',
  knives: '<path d="m18 100 13-26 9 6-15 25M93 104 81 80l8-7 13 25" fill="#d4e0cf"/>',
  halberds: '<path d="M21 106V48M90 106V43M21 46l-12 9 12-23 9 16M90 42l12 10-12-24-8 15"/>',
  bow: '<path d="M87 31q38 34 0 69M87 31v69M68 69h38M21 36l6 52M16 36l6 52M26 36l6 52"/>',
};

/** Safe local image source suitable for <img src={heroPortrait(id)}> . */
export function heroPortrait(heroId) {
  const id = Object.hasOwn(HERO_ART, heroId) ? heroId : 'guan_yu';
  if (portraitCache.has(id)) return portraitCache.get(id);
  const art = HERO_ART[id];
  const wide = ['broad', 'wide-beard', 'sleeves', 'crown'].includes(art.silhouette);
  const skin = id === 'guan_yu' ? '#af5843' : '#dab18b';
  const body = wide ? 'M24 126V82l16-20h46l17 20v44Z' : 'M33 126l6-47 12-17h25l13 17 8 47Z';
  const hat = art.silhouette === 'headband' ? '<path d="M46 42h33v8H46Z" fill="#d2be94"/><path d="m46 45-12 22" stroke="#d2be94"/>'
    : art.silhouette === 'topknot' ? '<path d="M56 35V21h13v14" fill="#263530"/><path d="m70 28 17-9" stroke="#c7bc79"/>'
    : art.silhouette === 'silver' ? '<path d="m43 48 8-24 13-9 17 33Z" fill="#c7dce0"/><path d="M65 23q17-12 18-4" stroke="#eee5cf"/>'
    : '<path d="M43 46 50 29l13-6 14 6 7 17Z" fill="' + art.accent + '"/><path d="M46 43h35" stroke="#d9bd78"/>';
  const beard = art.silhouette === 'beard' ? '<path d="M49 62h29q1 28-12 40Q50 90 49 62Z" fill="#24332c"/>'
    : art.silhouette === 'wide-beard' ? '<path d="m43 59 8 8 14 10 18-14 7-6-1 20-14 12-20-6Z" fill="#26342d"/>'
    : art.silhouette === 'crown' ? '<path d="m51 64 14 13 13-14-4 23H55Z" fill="#604355"/>' : '';
  const eyes = id === 'xiahou_dun' ? '<path d="M48 55h12" stroke="#25362e" stroke-width="5"/><path d="M68 55h8"/>' : '<path d="M50 55h9m10 0h8"/>';
  const detail = art.silhouette === 'shoulders' ? '<path d="m37 74-16 2 12 17 15-10m40-9 18 2-14 17-12-10" fill="#9facaa"/>'
    : art.silhouette === 'ribbon' ? '<path d="m42 77-20 29m60-29 20 29" stroke="#dbcf9d" stroke-width="5"/>'
    : art.silhouette === 'topknot' ? '<g fill="#ddc27a"><circle cx="43" cy="111" r="3"/><circle cx="53" cy="111" r="3"/><circle cx="63" cy="111" r="3"/><circle cx="73" cy="111" r="3"/><circle cx="83" cy="111" r="3"/></g>' : '';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128"><title>${art.name}</title><defs><linearGradient id="b" x2="0" y2="1"><stop stop-color="#385a4e"/><stop offset="1" stop-color="#142f29"/></linearGradient></defs><rect width="128" height="128" rx="18" fill="url(#b)"/><path d="M6 23V7h16m84 0h15v16M6 105v16h16m84 0h15v-16" stroke="#d7bb75" fill="none" opacity=".8"/><circle cx="64" cy="67" r="45" fill="${art.accent}" opacity=".17"/><path d="${body}" fill="${art.accent}" stroke="#142d29" stroke-width="4"/><path d="M44 83h39M42 103h43" stroke="#ccb575" stroke-width="3"/>${detail}<ellipse cx="64" cy="54" rx="18" ry="22" fill="${skin}"/>${hat}<g stroke="#26362c" stroke-width="2" fill="none">${eyes}<path d="m61 60 4 3 4-3M58 69h13"/></g>${beard}<g stroke="#e0d3a7" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" fill="none">${svgWeapon[art.gear]}</g><path d="M1 123h126" stroke="#8bc5a7" stroke-width="6"/></svg>`;
  const uri = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  portraitCache.set(id, uri);
  return uri;
}
