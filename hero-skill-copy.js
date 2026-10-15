// 文案待审：按 BALANCE.heroes 的真实技能形状、命中限制与效果编写。
import { BALANCE } from './runtime-data.js';

export const HERO_SKILL_COPY = {
  cao_cao: { role: '军令增益', description: '震击周围敌军，并使友军攻速提高 25%，持续 6 秒。', tags: ['圆形震击', '攻速增益'] },
  xiahou_dun: { role: '近身震退', description: '震击身边圆区，斩杀普通步兵，重创并击退精锐与敌将。', tags: ['圆形震击', '斩杀步兵', '击退'] },
  zhang_liao: { role: '沿路破阵', description: '沿一路向前突击，斩杀普通步兵，击退强敌并眩晕精锐 1 秒。', tags: ['沿路冲锋', '斩杀步兵', '眩晕'] },
  xu_chu: { role: '扇区重击', description: '重击前方 70° 扇区，斩杀普通步兵，对精锐与敌将造成重创。', tags: ['扇区震击', '斩杀步兵'] },
  sima_yi: { role: '雷阵控敌', description: '锁定圆区，1 秒后落雷斩杀普通步兵，并减速命中敌军 3 秒。', tags: ['延迟落雷', '斩杀步兵', '减速'] },
  liu_bei: { role: '援军护城', description: '震击周围敌军、恢复城关耐久，并使军营伤害提高 20%，持续 6 秒。', tags: ['圆形震击', '修复城关', '军营增伤'] },
  guan_yu: { role: '定向清线', description: '向前扫出矩形刀波，斩杀普通步兵，击退强敌并短暂减速。', tags: ['定向横扫', '斩杀步兵', '击退'] },
  zhang_fei: { role: '宽阵控场', description: '震击前方宽幅区域，斩杀普通步兵，击退强敌并眩晕精锐 1 秒。', tags: ['宽幅震击', '斩杀步兵', '眩晕'] },
  zhao_yun: { role: '三穿破敌', description: '沿狭长区域连续穿击三次，斩杀普通步兵，强敌最多承受三次伤害。', tags: ['直线三穿', '斩杀步兵', '三次命中'] },
  zhuge_liang: { role: '风牢牵制', description: '风牢持续伤敌 3 秒，牵退普通敌军与精锐，并使受伤提高 20%。', tags: ['圆形牵制', '持续伤害', '易伤'] },
  sun_quan: { role: '铁壁护城', description: '震击周围敌军，并使城关承受的伤害降低 20%，持续 6 秒。', tags: ['圆形震击', '城关减伤'] },
  zhou_yu: { role: '火场压制', description: '在锁定圆区点燃 4 秒火场，持续灼烧留在其中的敌军。', tags: ['圆形火场', '持续伤害', '最多十六跳'] },
  lv_meng: { role: '沿路设伏', description: '在最多两路各布两枚伏兵雷，斩杀普通步兵，每名强敌最多受击两次。', tags: ['沿路伏雷', '斩杀步兵', '持续八秒'] },
  gan_ning: { role: '箭雨压阵', description: '向锁定圆区倾泻 2 秒箭雨，并使命中敌军受伤提高 20%，持续 4 秒。', tags: ['圆形箭雨', '持续伤害', '易伤'] },
  taishi_ci: { role: '三矢点杀', description: '优先瞄准敌将与精锐，射击最多三个不同目标，每个目标只中一箭。', tags: ['三点狙击', '优先强敌', '斩杀步兵'] },
};

// Lightweight, local SVG diagrams. Geometry is selected by the balance shape,
// never by a shared generic circle, and its dimensions are scaled from that data.
export function skillPreviewSvg(heroId) {
  const u = BALANCE.heroes[heroId].ultimate;
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 110 92'); svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('data-shape', u.shape);
  const add = (tag, attrs, parent = svg) => {
    const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
    for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value));
    parent.append(node); return node;
  };
  add('path', { d: 'M32 0 Q25 28 42 52 L55 84 M85 0 Q85 28 68 52 L55 84', fill: 'none', stroke: '#d5c59525', 'stroke-width': 12 });
  add('rect', { x: 40, y: 81, width: 30, height: 8, rx: 2, fill: '#3a2a18', stroke: '#f2c46b' });
  for (const [x,y] of [[32,17],[39,37],[44,58],[84,17],[76,39],[66,60]]) {
    add('circle', { cx: x, cy: y, r: 3, fill: '#e2493b', class: 'preview-enemy' });
  }
  const effect = add('g', { class: 'preview-effect', fill: '#7ff0c432', stroke: '#7ff0c4', 'stroke-width': 1.5 });
  const scale = 70 / 610, radius = Math.min(31, (u.radius || 145) * .19);
  const circle = () => add('circle', { cx: 55, cy: 40, r: radius }, effect);
  const bolt = (d, cls = 'preview-strike') => add('path', { d, fill: 'none', stroke: '#ffe7a6', 'stroke-width': 2, class: cls }, effect);
  switch (u.shape) {
    case 'directional_swept_rectangle': {
      const width = u.width * scale, length = u.length * scale;
      add('rect', { x: 55 - width / 2, y: 77 - length, width, height: length, rx: 1 }, effect);
      bolt(`M${55-width/2} 25 Q55 33 ${55+width/2} 25`, 'preview-strike preview-sweep'); break;
    }
    case 'wide_short_rectangle': {
      const width = u.width * .19, length = u.length * .16;
      add('rect', { x: 55-width/2, y: 77-length, width, height: length }, effect);
      for (const y of [35,48,61]) bolt(`M34 ${y} Q55 ${y-8} 76 ${y}`); break;
    }
    case 'frontal_cone': {
      const r = u.range * .22, half = u.angleDegrees * Math.PI / 360;
      const x = Math.sin(half)*r, y = 77-Math.cos(half)*r;
      add('path', { d: `M55 77 L${55-x} ${y} A${r} ${r} 0 0 1 ${55+x} ${y} Z` }, effect); break;
    }
    case 'lane_following_charge':
      add('path', { d: 'M55 77 L42 52 Q25 28 32 5', fill: 'none', 'stroke-width': u.width * scale, class: 'preview-charge' }, effect);
      bolt('M55 77 L42 52 Q25 28 32 5'); break;
    case 'three_narrow_passes':
      add('rect', { x: 55-u.width*scale/2, y: 7, width: u.width*scale, height: u.length*scale }, effect);
      u.passAtSec.forEach((at,i) => { const ray = bolt(`M${51+i*4} 77 L${51+i*4} 7`, 'preview-strike preview-pass'); ray.style.setProperty('--strike-delay', `${at}s`); }); break;
    case 'delayed_locked_circle':
      circle().setAttribute('stroke-dasharray', '3 3');
      const thunder = bolt('M62 9 L47 36 H59 L48 66', 'preview-strike preview-thunder'); thunder.style.setProperty('--strike-delay', `${u.delaySec}s`); break;
    case 'pulling_locked_circle':
      circle();
      for (const d of ['M25 40 H44 L38 35 M44 40 L38 45','M85 40 H66 L72 35 M66 40 L72 45','M55 10 V29 L50 23 M55 29 L60 23']) bolt(d, 'preview-strike preview-pull');
      add('circle', { cx: 55, cy: 40, r: radius*.5, 'stroke-dasharray': '4 4' }, effect); break;
    case 'lane_mines':
      for (const [x,y] of [[31,24],[42,52],[83,24],[68,52]].slice(0,u.mineCount)) {
        add('circle', { cx:x, cy:y, r:u.blastRadius*.15, 'stroke-dasharray':'2 2', class:'preview-mine' }, effect);
        add('path', { d:`M${x} ${y-4} L${x+4} ${y} L${x} ${y+4} L${x-4} ${y} Z`, fill:'#ffe7a6' }, effect);
      } break;
    case 'volley_locked_circle':
      circle();
      for (const [x,y] of [[42,25],[59,24],[69,34],[44,46],[58,52],[64,42]]) bolt(`M${x-5} ${y-11} L${x} ${y} l-4 -2 M${x} ${y} l1 -5`, 'preview-strike preview-arrow'); break;
    case 'three_distinct_target_snipes':
      [[32,17],[76,39],[44,58]].slice(0,u.maxDistinctTargets).forEach(([x,y],i) => {
        add('circle', { cx:x, cy:y, r:8, fill:'none', class:'preview-target' }, effect);
        const ray=bolt(`M55 77 L${x} ${y}`, 'preview-strike preview-pass'); ray.style.setProperty('--strike-delay',`${i*.2}s`);
      }); break;
    case 'locked_circle':
      circle();
      for (const [x,y] of [[43,40],[55,27],[65,44],[54,52]]) add('path', { d:`M${x-4} ${y+5} Q${x-7} ${y-1} ${x} ${y-10} Q${x+7} ${y} ${x+4} ${y+5} Z`, fill:'#ffb66f', stroke:'#ffe7a6', class:'preview-flame' }, effect); break;
    case 'allied_command_with_local_shock':
      circle(); bolt('M55 24 V54 M56 24 H70 L66 30 L70 35 H56'); break;
    case 'recovery_with_circle_shock':
      circle(); bolt('M55 29 V51 M44 40 H66'); add('path', { d:'M36 85 H74', stroke:'#7ff0c4', 'stroke-width':4 },effect); break;
    case 'barrier_with_circle_shock':
      circle(); add('path', { d:'M43 26 H67 V42 L55 56 L43 42 Z', fill:'#f2c46b55', stroke:'#ffe7a6' },effect); break;
    case 'circle_shock':
      circle(); add('circle', { cx:55, cy:40, r:radius*.63, class:'preview-shock', fill:'none' },effect); break;
  }
  const selfCentered = ['circle_shock','allied_command_with_local_shock','recovery_with_circle_shock','barrier_with_circle_shock'].includes(u.shape);
  add('circle', { cx:55, cy:selfCentered ? 40 : 77, r:5, fill:'#4fd68f', stroke:'#0b1712', 'stroke-width':2 });
  return svg;
}
