// Procedural ink sprites adapted from the local battle art design. No engine writes or remote assets.
import { PORTRAIT } from './hero-portraits.js';

const INK = '#100c09', TAU = Math.PI * 2;
const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v)), lerp = (a, b, t) => a + (b - a) * t;
const easeIO = t => t < .5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
function path(g, pts, close) { g.beginPath(); pts.forEach(([x, y], i) => i ? g.lineTo(x, y) : g.moveTo(x, y)); if (close) g.closePath(); }
function ink(g, fill, w = 2) { if (fill) { g.fillStyle = fill; g.fill(); } g.strokeStyle = INK; g.lineWidth = w; g.lineJoin = 'round'; g.lineCap = 'round'; g.stroke(); }
function ell(g, x, y, rx, ry, fill, w = 2) { g.beginPath(); g.ellipse(x, y, rx, ry, 0, 0, TAU); ink(g, fill, w); }

function weapon(g, p, wa, glow, draw = 0) {
  const m = glow ? '#ffe7a6' : p.metal, wood = '#4a2f18';
  g.save(); g.rotate(wa);
  // White feathers and dark fans also need the same readable ready-state gold edge.
  if (glow) { g.shadowColor = '#f5cc70'; g.shadowBlur = 2; }
  const pole = (len, c = wood) => { path(g, [[-1.6, 8], [-1.6, -len], [1.6, -len], [1.6, 8]], true); ink(g, c, 1.6); };
  switch (p.weapon) {
    case 'sword': path(g, [[-2, 2], [-2, -30], [0, -35], [2, -30], [2, 2]], true); ink(g, m); path(g, [[-6, 2], [6, 2], [6, 5], [-6, 5]], true); ink(g, '#f2c46b', 1.4); break;
    case 'saber': path(g, [[-2, 4], [-3, -14], [1, -32], [8, -36], [5, -20], [3, 4]], true); ink(g, m); path(g, [[-6, 4], [7, 4], [7, 7], [-6, 7]], true); ink(g, '#c9a35a', 1.4); break;
    case 'hook': pole(40); g.beginPath(); g.moveTo(0, -40); g.quadraticCurveTo(16, -48, 13, -30); g.quadraticCurveTo(9, -38, 0, -34); ink(g, m); break;
    case 'hammer': pole(30); path(g, [[-9, -44], [9, -44], [9, -28], [-9, -28]], true); ink(g, m); g.strokeStyle = INK; g.lineWidth = 1; g.beginPath(); g.moveTo(-9, -36); g.lineTo(9, -36); g.stroke(); break;
    case 'glaive': pole(48, '#3a2414'); g.beginPath(); g.moveTo(0, -48); g.quadraticCurveTo(20, -44, 15, -20); g.quadraticCurveTo(10, -34, -1, -34); ink(g, m); path(g, [[-1, -33], [-6, -26], [-1, -24]], true); ink(g, '#c8322a', 1.2); break;
    case 'serpent': pole(42, '#2a1d14'); g.beginPath(); g.moveTo(0, -42); g.bezierCurveTo(6, -46, -6, -50, 0, -54); g.bezierCurveTo(5, -57, -2, -60, 1, -62); g.lineTo(-2, -60); g.bezierCurveTo(-5, -56, 3, -54, -3, -50); g.bezierCurveTo(-8, -46, 0, -44, -3, -42); g.closePath(); ink(g, m, 1.6); break;
    case 'spear': pole(46, '#e8e8e8'); path(g, [[0, -58], [-5, -46], [0, -48], [5, -46]], true); ink(g, m, 1.6); path(g, [[-2, -45], [-7, -36], [-1, -38]], true); ink(g, '#c8322a', 1.2); break;
    case 'fan': case 'feather': case 'firefan': {
      const fill = p.weapon === 'firefan' ? (glow ? '#ffd36a' : '#ff7a3c') : p.weapon === 'feather' ? '#ffffff' : (glow ? '#e6d4ff' : p.metal);
      path(g, [[-1.2, 4], [-1.2, -8], [1.2, -8], [1.2, 4]], true); ink(g, '#6a4a24', 1.2);
      g.beginPath(); g.moveTo(0, -8); g.quadraticCurveTo(-14, -16, -10, -30); g.quadraticCurveTo(0, -36, 10, -30); g.quadraticCurveTo(14, -16, 0, -8); ink(g, fill);
      g.strokeStyle = '#0006'; g.lineWidth = 1; for (const x of [-6, 0, 6]) { g.beginPath(); g.moveTo(0, -9); g.lineTo(x, -30); g.stroke(); } break; }
    case 'twin': for (const s of [-1, 1]) { g.save(); g.translate(s === -1 ? -20 : 0, 0); g.rotate(s * .12); path(g, [[-1.8, 2], [-1.8, -26], [0, -30], [1.8, -26], [1.8, 2]], true); ink(g, m, 1.6); path(g, [[-5, 2], [5, 2], [5, 4.5], [-5, 4.5]], true); ink(g, '#f2c46b', 1.2); g.restore(); } break;
    case 'bow': g.beginPath(); g.moveTo(-2, -32); g.quadraticCurveTo(16, -14, -2, 4); g.strokeStyle = INK; g.lineWidth = 5; g.stroke(); g.strokeStyle = m; g.lineWidth = 2.4; g.stroke();
      g.strokeStyle = '#f1e4c3'; g.lineWidth = 1; g.beginPath(); g.moveTo(-2, -32); g.lineTo(-2 - draw * 7, -14); g.lineTo(-2, 4); g.stroke();
      if (draw > .3) { g.strokeStyle = '#e5d2a2'; g.lineWidth = 1.3; g.beginPath(); g.moveTo(-6 - draw * 7, -14); g.lineTo(15, -14); g.stroke(); path(g, [[15, -14], [11, -16], [11, -12]], true); ink(g, '#e8eef2', .8); } break;
    case 'book': path(g, [[-7, -14], [7, -16], [8, 2], [-6, 4]], true); ink(g, '#2a4a6a', 1.6); g.strokeStyle = m; g.lineWidth = 1.4; g.beginPath(); g.moveTo(-5, -10); g.lineTo(6, -12); g.stroke(); break;
  }
  g.restore();
}
function headwear(g, p, glow) {
  const hair = p.hair || '#15110d';
  const cap = () => { g.beginPath(); g.moveTo(-9, -35); g.quadraticCurveTo(-9, -45, 0, -45); g.quadraticCurveTo(9, -45, 9, -35); g.quadraticCurveTo(4, -40, 0, -40); g.quadraticCurveTo(-4, -40, -9, -35); ink(g, hair, 1.6); };
  switch (p.head) {
    case 'guan': cap(); path(g, [[-4, -44], [4, -44], [4, -52], [-4, -52]], true); ink(g, '#1a1a1a', 1.6); g.strokeStyle = p.trim; g.lineWidth = 1.6; g.beginPath(); g.moveTo(-7, -46); g.lineTo(7, -46); g.stroke(); break;
    case 'crown': cap(); path(g, [[-7, -42], [-6, -50], [-3, -46], [0, -53], [3, -46], [6, -50], [7, -42]], true); ink(g, '#ffc940', 1.6); ell(g, 0, -46, 1.4, 1.4, '#c8322a', .8); break;
    case 'helmet': g.beginPath(); g.moveTo(-10, -33); g.quadraticCurveTo(-11, -47, 0, -48); g.quadraticCurveTo(11, -47, 10, -33); g.quadraticCurveTo(0, -39, -10, -33); ink(g, p.helm); path(g, [[-1, -48], [-2, -58], [4, -60], [2, -48]], true); ink(g, p.plume, 1.4); break;
    case 'winged': for (const s of [-1, 1]) { path(g, [[s * 9, -40], [s * 19, -50], [s * 15, -36]], true); ink(g, p.plume, 1.4); } g.beginPath(); g.moveTo(-10, -33); g.quadraticCurveTo(-11, -47, 0, -48); g.quadraticCurveTo(11, -47, 10, -33); g.quadraticCurveTo(0, -39, -10, -33); ink(g, p.helm); break;
    case 'silver': g.beginPath(); g.moveTo(1, -46); g.quadraticCurveTo(12, -56, 22, -50); g.quadraticCurveTo(12, -50, 4, -42); ink(g, p.plume, 1.4); g.beginPath(); g.moveTo(-10, -30); g.quadraticCurveTo(-11, -48, 0, -48); g.quadraticCurveTo(11, -48, 10, -30); g.lineTo(8, -36); g.quadraticCurveTo(0, -40, -8, -36); g.closePath(); ink(g, p.helm); break;
    case 'hood': g.beginPath(); g.moveTo(-11, -28); g.quadraticCurveTo(-13, -48, 0, -48); g.quadraticCurveTo(13, -48, 11, -28); g.lineTo(8, -34); g.quadraticCurveTo(0, -42, -8, -34); g.closePath(); ink(g, p.hood); break;
    case 'whitehood': g.beginPath(); g.moveTo(-11, -26); g.quadraticCurveTo(-12, -48, 0, -48); g.quadraticCurveTo(12, -48, 11, -26); g.lineTo(8, -34); g.quadraticCurveTo(0, -41, -8, -34); g.closePath(); ink(g, p.hood); break;
    case 'lunjin': cap(); path(g, [[-8, -40], [-6, -51], [6, -51], [8, -40]], true); ink(g, p.hood, 1.6); break;
    case 'scholar': cap(); path(g, [[-5, -42], [-5, -56], [5, -56], [5, -42]], true); ink(g, '#141016', 1.6); break;
    case 'bald': g.fillStyle = '#ffffff40'; g.beginPath(); g.ellipse(-3, -42, 4, 2, -.3, 0, TAU); g.fill(); break;
    case 'wild': path(g, [[-10, -34], [-14, -44], [-7, -42], [-6, -51], [-1, -44], [3, -53], [5, -44], [11, -50], [10, -40], [14, -38], [10, -34]], true); ink(g, hair, 1.6);
      g.strokeStyle = p.band; g.lineWidth = 2.6; g.beginPath(); g.moveTo(-10, -37); g.quadraticCurveTo(0, -41, 10, -37); g.stroke(); break;
    case 'topknot': cap(); path(g, [[-3, -44], [3, -44], [3, -50], [-3, -50]], true); ink(g, hair, 1.4);
      g.beginPath(); g.moveTo(2, -49); g.quadraticCurveTo(14, -62, 20, -58); g.quadraticCurveTo(12, -56, 4, -46); ink(g, '#ff6b57', 1.2); break;
    case 'young': cap(); path(g, [[-3, -45], [3, -45], [3, -49], [-3, -49]], true); ink(g, '#ffc940', 1.2); break;
  }
}
function beard(g, p) {
  const hair = p.hair || '#15110d', stache = c => { g.beginPath(); g.moveTo(-5, -27.5); g.quadraticCurveTo(0, -30, 5, -27.5); g.quadraticCurveTo(0, -28, -5, -27.5); g.strokeStyle = c; g.lineWidth = 1.8; g.stroke(); };
  switch (p.beard) {
    case 'long': g.beginPath(); g.moveTo(-6, -28); g.quadraticCurveTo(-8, -14, 0, -6); g.quadraticCurveTo(8, -14, 6, -28); g.quadraticCurveTo(0, -25, -6, -28); ink(g, '#120e0b', 1.4); stache('#120e0b'); break;
    case 'wild': path(g, [[-9, -31], [-10, -22], [-6, -24], [-4, -18], [0, -22], [4, -18], [6, -24], [10, -22], [9, -31], [0, -26]], true); ink(g, '#0f0c0a', 1.4); break;
    case 'wide': g.beginPath(); g.moveTo(-8, -30); g.quadraticCurveTo(-8, -20, 0, -19); g.quadraticCurveTo(8, -20, 8, -30); g.quadraticCurveTo(0, -26, -8, -30); ink(g, hair, 1.4); break;
    case 'purple': g.beginPath(); g.moveTo(-7, -29); g.quadraticCurveTo(-7, -18, 0, -16); g.quadraticCurveTo(7, -18, 7, -29); g.quadraticCurveTo(0, -26, -7, -29); ink(g, '#5d2a72', 1.4); break;
    case 'goatee': stache(hair); path(g, [[-1.6, -26], [0, -20], [1.6, -26]], true); ink(g, hair, 1); break;
    case 'thin': stache(hair); path(g, [[-1, -26], [0, -16], [1, -26]], true); ink(g, hair, .8); break;
    case 'short': g.beginPath(); g.moveTo(-6, -29); g.quadraticCurveTo(0, -21, 6, -29); g.quadraticCurveTo(0, -26, -6, -29); ink(g, hair, 1.2); break;
    case 'mustache': stache('#1a130e'); break;
    case 'stubble': g.fillStyle = '#1a141055'; g.beginPath(); g.moveTo(-7, -30); g.quadraticCurveTo(0, -22, 7, -30); g.quadraticCurveTo(0, -26, -7, -30); g.fill(); stache('#1a1410'); break;
  }
}
function face(g, p) {
  const e = p.eyes;
  g.fillStyle = INK;
  if (e === 'round') { for (const x of [-3.6, 3.6]) { ell(g, x, -33, 2, 2, '#f8efd8', .8); g.fillStyle = INK; g.beginPath(); g.arc(x, -33, 1.1, 0, TAU); g.fill(); } }
  else if (e === 'patch') { path(g, [[-6, -35.5], [-1.5, -35.5], [-1.5, -31], [-6, -31]], true); g.fillStyle = '#0b0b0b'; g.fill(); g.strokeStyle = '#0b0b0b'; g.lineWidth = 1; g.beginPath(); g.moveTo(-9, -38); g.lineTo(9, -31); g.stroke(); g.fillStyle = INK; g.fillRect(2.6, -34, 2, 2); }
  else if (e === 'phoenix') { g.lineWidth = 1.6; g.strokeStyle = INK; for (const s of [-1, 1]) { g.beginPath(); g.moveTo(s * 1.6, -33); g.lineTo(s * 6, -34.5); g.stroke(); } }
  else { const c = e === 'jade' ? '#21a35e' : e === 'narrow' ? '#6b3fa0' : INK; g.fillStyle = c; g.fillRect(-4.6, -34, 2, e === 'narrow' ? 1.2 : 2); g.fillRect(2.6, -34, 2, e === 'narrow' ? 1.2 : 2); }
  g.strokeStyle = INK; g.lineWidth = 1.4; for (const s of [-1, 1]) { g.beginPath(); g.moveTo(s * 1.6, -36.6); g.lineTo(s * 6.4, -38); g.stroke(); }
}
function drawChibi(g, p, pose = {}) {
  const { wa = 0, arm = 0, dy = 0, sq = 0, glow = false, lean = 0, sway = 0, chin = 0, strokeBeard = false, roar = false, bowDraw = arm } = pose;
  const broad = p.body === 'broad', robe = p.body === 'robe' || p.body === 'crane', w = broad ? 13 : 10;
  g.save(); g.translate(0, dy); g.scale(1 + sq * .12, 1 - sq * .12); g.rotate(lean);
  // 兵器在身后侧的先画（长柄），短兵器在前面画
  const long = ['hook', 'hammer', 'glaive', 'serpent', 'spear'].includes(p.weapon);
  const hand = { x: w + 1, y: -14 - arm * 8 };
  if (long) { g.save(); g.translate(hand.x, hand.y); weapon(g, p, wa, glow); g.restore(); }
  if (p.cape) { path(g, [[-w + 1, -24], [w - 1, -24], [w + 5 + sway * 2, 0], [-w - 5 + sway * 2, 0]], true); ink(g, p.cape, 1.6); }
  // 腿
  for (const s of [-1, 1]) { path(g, [[s * 2, -6], [s * 6, -6], [s * 6, 0], [s * 2, 0]], true); ink(g, '#2a2a24', 1.4); }
  // 身体
  if (robe) { path(g, [[-w + 2, -24], [w - 2, -24], [w + 3, -2], [-w - 3, -2]], true); ink(g, p.cloth); g.strokeStyle = p.trim; g.lineWidth = 2; g.beginPath(); g.moveTo(-4, -24); g.lineTo(3, -12); g.moveTo(4, -24); g.lineTo(-1, -16); g.stroke();
    if (p.body === 'crane') { g.fillStyle = '#2a2a2a'; g.fillRect(-w - 2, -7, w * 2 + 4, 4); } }
  else { path(g, [[-w, -24], [w, -24], [w + 1, -4], [-w - 1, -4]], true); ink(g, p.cloth); g.strokeStyle = '#0005'; g.lineWidth = 1; for (const y of [-16, -10]) { g.beginPath(); g.moveTo(-w + 2, y); g.lineTo(w - 2, y); g.stroke(); }
    for (const s of [-1, 1]) ell(g, s * (w - 1), -22, broad ? 6 : 5, 3.6, p.cloth, 1.6); g.strokeStyle = p.trim; g.lineWidth = 1.8; g.beginPath(); g.moveTo(-4, -24); g.lineTo(0, -19); g.lineTo(4, -24); g.stroke(); }
  g.fillStyle = p.trim; g.fillRect(-w + 1, -6.5, (w - 1) * 2, 2.4);
  // 手臂（持兵手随 arm 抬起）
  g.strokeStyle = INK; g.lineWidth = 5.4; g.lineCap = 'round'; g.beginPath(); g.moveTo(w - 2, -21); g.lineTo(hand.x, hand.y); g.stroke();
  g.strokeStyle = robe ? p.cloth : p.cloth; g.lineWidth = 3.4; g.beginPath(); g.moveTo(w - 2, -21); g.lineTo(hand.x, hand.y); g.stroke();
  ell(g, hand.x, hand.y, 2.4, 2.4, p.skin, 1.2);
  // 头（半径 9.5，头高约占 37%）
  if (p.head === 'young' || p.head === 'whitehood') { /* 后发 */ g.beginPath(); g.moveTo(-9, -34); g.lineTo(-10, -24); g.lineTo(-6, -27); g.closePath(); ink(g, p.head === 'young' ? p.hair : p.hood, 1.2); }
  g.save(); g.translate(0, chin); ell(g, 0, -33, 9.5, 10, p.skin);
  face(g, p); beard(g, p); headwear(g, p, glow);
  if (roar) ell(g, 0, -27.5, 3, 2.6, '#29100c', 1);
  g.restore();
  if (!long) { g.save(); g.translate(hand.x, hand.y); weapon(g, p, wa, glow, bowDraw); g.restore(); }
  if (strokeBeard) { g.strokeStyle = p.cloth; g.lineWidth = 4; g.beginPath(); g.moveTo(-9, -20); g.lineTo(-3, -14); g.stroke(); ell(g, -3, -14, 2.2, 2.2, p.skin, 1.2); }
  if (p.feathers) for (const x of [-7, -3, 1]) { ell(g, x + sway * .4, -4.5, 1.5, 2, '#f2c46b', .8); g.strokeStyle = INK; g.lineWidth = .7; g.beginPath(); g.moveTo(x - .7, -4); g.lineTo(x + .7, -4); g.stroke(); }
  if (p.quiver) { path(g, [[-w - 4, -26], [-w, -28], [-w + 2, -10], [-w - 2, -8]], true); ink(g, '#6a4320', 1.2); for (let i = 0; i < 3; i++) { const x = -w - 4 + i * 2; g.strokeStyle = '#eedcc0'; g.lineWidth = 1; g.beginPath(); g.moveTo(x + 2, -24); g.lineTo(x, -37); g.stroke(); path(g, [[x, -37], [x - 2, -40], [x + 1, -39], [x + 2, -35]], true); ink(g, '#e8eee3', .6); } }
  g.restore();
}
const K = (t, o) => [t, o];
const MOTION = {
  guan_yu: { atk: { dur: .7, fire: .32, fx: 'arc', k: [K(0, {}), K(.22, { wa: .9, arm: .6, lean: .1 }), K(.32, { wa: -1.2, arm: .2, lean: -.12 }), K(.7, {})] },
    ult: { release: 0, hit: 0, hitMode: 'advancing-front', fx: 'wave', k: [K(0, { wa: -1.6, arm: .4, lean: -.2, dy: -3 }), K(.18, { wa: -1.6, arm: .4, lean: -.2 }), K(.6, { wa: -1.4, arm: .3 }), K(.9, {})] },
    idle: '刀尖垂地，长髯随呼吸微摆；每 4 秒抚髯一次（第 5 帧）', atkTxt: '右上举刀 → 斜劈，刀光半月弧', ultTxt: '双手举刀过顶蓄力 → 正面横扫，刀波随前锋推进；收刀立正', frames: '6 · 5 · 10' },
  zhang_fei: { atk: { dur: .75, fire: .3, fx: 'thrust', k: [K(0, {}), K(.18, { wa: -.2, arm: .2, lean: .14 }), K(.3, { wa: 0, arm: .8, lean: -.1, y: -5 }), K(.75, {})] },
    ult: { release: 0, hit: 0, hitMode: 'instant', fx: 'roar', k: [K(0, { arm: 1, wa: .2, dy: -2, sq: -.3 }), K(.25, { arm: .9, wa: .2, sq: -.2 }), K(.7, { arm: .8, sq: -.2 }), K(.9, {})] },
    idle: '矛杆杵地，肩膀起伏较大；胡须外张', atkTxt: '回拉 → 前刺，蛇矛矛尖抖动', ultTxt: '弓身吸气 → 仰头怒吼（张嘴两帧），赭金声浪；矛横举', frames: '6 · 5 · 9' },
  zhao_yun: { atk: { dur: .45, fire: .18, fx: 'thrust', k: [K(0, {}), K(.1, { wa: -.1, arm: .1, lean: .1 }), K(.18, { wa: 0, arm: .9, y: -6, lean: -.1 }), K(.45, {})] },
    ult: { release: 0, hit: 0, hitMode: 'passes', fx: 'pierce3', k: [K(0, { arm: .9, wa: 0 }), K(.12, { arm: .2 }), K(.25, { arm: .9 }), K(.37, { arm: .2 }), K(.5, { arm: .9 }), K(.7, { arm: .2 }), K(.9, {})] },
    idle: '枪斜指前方，白披风两帧飘动', atkTxt: '快速短刺，枪尖银光一点（攻速最快，4 帧）', ultTxt: '原地连刺三次，对齐 0 / 0.25 / 0.5 秒三道枪影，武将本体不前移', frames: '6 · 4 · 10' },
  liu_bei: { atk: { dur: .55, fire: .22, fx: 'cross', k: [K(0, {}), K(.14, { wa: .5, arm: .5 }), K(.22, { wa: -.5, arm: .3 }), K(.55, {})] },
    ult: { release: 0, hit: 0, hitMode: 'advancing-front', fx: 'gate', k: [K(0, { arm: 1, wa: -.2, dy: -2 }), K(.1, { arm: 1, wa: -.2 }), K(.7, { arm: .9, wa: -.15 }), K(.9, {})] },
    idle: '双剑交叉于身前，飘带轻摆', atkTxt: '双剑交错一斩，十字剑光', ultTxt: '双剑高举向前 → 城门开（城门两帧），援军冲出时保持举剑；收剑抱拳', frames: '6 · 4 · 8' },
  zhuge_liang: { atk: { dur: .6, fire: .26, fx: 'wind', k: [K(0, {}), K(.16, { wa: .4, arm: .7 }), K(.26, { wa: -.6, arm: .5 }), K(.6, {})] },
    ult: { release: .25, hit: .25, hitMode: 'ticks', fx: 'trigram', k: [K(0, {}), K(.15, { arm: 1, wa: .3, dy: -1 }), K(.25, { arm: .8, wa: -.8 }), K(.9, { arm: .3 })] },
    idle: '羽扇轻摇，鹤氅下摆两帧摆动', atkTxt: '羽扇一挥，玉色风刃', ultTxt: '举扇画圈（八卦虚影）→ 扇指落点；持续 3 秒期间扇子保持前指', frames: '6 · 4 · 8' },
  cao_cao: { atk: { dur: .6, fire: .24, fx: 'arc', k: [K(0, {}), K(.14, { wa: .7, arm: .5 }), K(.24, { wa: -.8, arm: .3 }), K(.6, {})] },
    ult: { release: .2, hit: .42, hitMode: 'delayed', fx: 'banner', k: [K(0, {}), K(.1, { arm: 1, wa: -.6, lean: -.08 }), K(.2, { arm: .4, wa: .8, lean: .12 }), K(.42, { arm: .6, wa: -.3 }), K(.9, {})] },
    idle: '剑立身前，披风垂地；偶尔扬下巴', atkTxt: '短促直斩，剑光细直', ultTxt: '拔剑指敌 → 侧身甩臂掷出令旗（0.2 秒出手）→ 剑指落点等旗插地', frames: '6 · 4 · 8' },
  xiahou_dun: { atk: { dur: .8, fire: .34, fx: 'arc', k: [K(0, {}), K(.24, { wa: 1, arm: .7, lean: .12 }), K(.34, { wa: -1.3, arm: .2, lean: -.1 }), K(.8, {})] },
    ult: { release: .36, hit: .36, hitMode: 'delayed', fx: 'leap', move: 'leap', k: [K(0, {}), K(.12, { dy: 4, sq: .6, wa: .8 }), K(.24, { arm: 1, wa: 1.4, sq: -.3 }), K(.36, { wa: -1.6, dy: 2, sq: .4 }), K(.6, { wa: -1.4 }), K(.75, { sq: -.2 }), K(.9, {})] },
    idle: '厚刀横在肩上，独眼方向朝前；头盔红缨两帧', atkTxt: '大开大合斜劈，比关羽慢、刀光更厚', ultTxt: '下蹲 → 起跳（空中举刀）→ 落地劈砸（命中帧）→ 旋斩 → 跳回；新增“跳起、空中、落地”3 帧', frames: '6 · 5 · 12' },
  zhang_liao: { atk: { dur: .55, fire: .24, fx: 'hook', k: [K(0, {}), K(.14, { wa: .6, arm: .4 }), K(.24, { wa: -.9, arm: .6, y: -3 }), K(.55, {})] },
    ult: { release: 0, hit: 0, hitMode: 'advancing-front', fx: 'charge', move: 'charge', k: [K(0, { lean: .25, wa: -.4, arm: .9 }), K(.1, { lean: .25, wa: -.4, arm: .9 }), K(.75, { lean: .2, wa: -.4, arm: .9 }), K(.9, {})] },
    idle: '钩刃斜背，肩甲两翼醒目', atkTxt: '钩刃横拉，金色钩形刀光', ultTxt: '前倾冲出化成金白残影沿路突进（本体淡出），0.75 秒后从城门回位；新增“冲锋”2 帧', frames: '6 · 4 · 10' },
  xu_chu: { atk: { dur: .9, fire: .42, fx: 'smash', k: [K(0, {}), K(.3, { wa: 1.2, arm: 1, dy: -2 }), K(.42, { wa: -.4, arm: .1, dy: 3, sq: .5 }), K(.9, {})] },
    ult: { release: 0, hit: 0, hitMode: 'instant', fx: 'quake', move: 'lunge', k: [K(0, { wa: 1.85, arm: .8, dy: 4, sq: .7 }), K(.22, { wa: 1.85, arm: .8, dy: 2, sq: .5 }), K(.5, { wa: .65, arm: .35, sq: .15 }), K(.9, {})] },
    idle: '锤头杵地，双手扶柄，光头反光', atkTxt: '抡锤过顶 → 砸地，落点尘土（最慢普攻，6 帧）', ultTxt: '举锤 → 前扑 40 砸地（命中帧，身体压扁）→ 裂缝推进时保持蹲姿 → 退回；新增“前扑”2 帧', frames: '6 · 6 · 10' },
  sima_yi: { atk: { dur: .55, fire: .22, fx: 'bolt', k: [K(0, {}), K(.14, { arm: .9, wa: .2 }), K(.22, { arm: .7, wa: -.4 }), K(.55, {})] },
    ult: { release: .3, hit: 1, hitMode: 'delayed', fx: 'thunder', k: [K(0, {}), K(.15, { arm: 1, wa: .3, dy: -2 }), K(.3, { arm: .9, wa: -.6 }), K(.9, { arm: .6, wa: -.5 })] },
    idle: '羽扇半掩面，眼神斜视；袍角不动（阴冷感）', atkTxt: '扇尖一点，紫色细电', ultTxt: '举扇过顶 → 三点指画（三处预警同时出现）→ 定姿等待 1 秒落雷', frames: '6 · 4 · 8' },
  sun_quan: { atk: { dur: .6, fire: .24, fx: 'arc', k: [K(0, {}), K(.14, { wa: .7, arm: .5 }), K(.24, { wa: -.8, arm: .3 }), K(.6, {})] },
    ult: { release: 0, hit: 0, hitMode: 'advancing-front', fx: 'tide', k: [K(0, { arm: .2, wa: 1.2, dy: 2, sq: .3 }), K(.15, { arm: .2, wa: 1.1, sq: .1 }), K(.9, { wa: .9 })] },
    idle: '剑尖朝下，冠冕金光；紫须清楚', atkTxt: '平斩一剑，紫金剑光', ultTxt: '举剑 → 一剑劈地（潮浪起点）→ 保持劈姿到退潮', frames: '6 · 4 · 8' },
  zhou_yu: { atk: { dur: .5, fire: .2, fx: 'flame', k: [K(0, {}), K(.12, { arm: .8, wa: .5 }), K(.2, { arm: .6, wa: -.6 }), K(.5, {})] },
    ult: { release: .25, hit: .25, hitMode: 'ticks', fx: 'ship', k: [K(0, {}), K(.05, { arm: 1, wa: .6 }), K(.25, { arm: .7, wa: -1.1, lean: -.08 }), K(.9, { arm: .4 })] },
    idle: '火扇半开，衣摆轻扬；年轻、站姿挺', atkTxt: '扇出一团火星', ultTxt: '大幅挥扇（火船出现）→ 扇指路口目送火船冲下', frames: '6 · 4 · 8' },
  lv_meng: { atk: { dur: .6, fire: .26, fx: 'scroll', k: [K(0, {}), K(.16, { arm: .8, wa: -.2 }), K(.26, { arm: .5, wa: .3 }), K(.6, {})] },
    ult: { release: 0, hit: null, hitMode: 'proximity-trigger', fx: 'mine', k: [K(0, { arm: .3, wa: .5, dy: 2 }), K(.4, { arm: .3, wa: .5 }), K(.9, {})] },
    idle: '捧书卷，白衣兜帽遮半脸', atkTxt: '书卷一挥，射出白羽', ultTxt: '展卷 → 合卷下指（伏兵标记出现在路上）→ 收卷', frames: '6 · 4 · 8' },
  gan_ning: { atk: { dur: .5, fire: .24, fx: 'arrow', k: [K(0, {}), K(.16, { arm: .7, wa: -.1, lean: -.06 }), K(.24, { arm: .5, wa: .05 }), K(.5, {})] },
    ult: { release: .25, hit: .25, hitMode: 'ticks', fx: 'volley', k: [K(0, {}), K(.1, { arm: .2, wa: .4, dy: -2 }), K(.25, { arm: 1, wa: -.3 }), K(.9, { arm: .9, wa: -.3 })] },
    idle: '弓斜挂，腰间铜铃随步伐响（两帧）', atkTxt: '速射一箭，箭羽红黄', ultTxt: '摇铃（铃铛闪光）→ 举弓向天发号箭 → 保持举弓到箭雨结束', frames: '6 · 4 · 8' },
  taishi_ci: { atk: { dur: .7, fire: .4, fx: 'arrow', k: [K(0, {}), K(.3, { arm: .8, wa: -.1, lean: -.08 }), K(.4, { arm: .5 }), K(.7, {})] },
    ult: { release: 0, hit: 0, hitMode: 'instant', fx: 'snipe', k: [K(0, { arm: .5 }), K(.3, { arm: .4 }), K(.6, { arm: .2 }), K(.9, {})] },
    idle: '背弓直立，箭囊露出三支箭羽', atkTxt: '满弓长瞄（停顿）→ 放箭，金白直线', ultTxt: '连拉三次满弓，每次对准一个目标标记', frames: '6 · 5 · 10' },
};
function poseAt(keys, t) {
  let a = keys[0], b = keys[keys.length - 1];
  for (let i = 0; i < keys.length - 1; i++) if (t >= keys[i][0] && t <= keys[i + 1][0]) { a = keys[i]; b = keys[i + 1]; break; }
  const span = b[0] - a[0] || 1, k = easeIO(clamp((t - a[0]) / span)), out = {};
  for (const f of ['wa', 'arm', 'dy', 'sq', 'lean', 'x', 'y']) out[f] = lerp(a[1][f] || 0, b[1][f] || 0, k);
  return out;
}
const ENEMY = {
  infantry: { n: '步兵', cls: '普通', sz: '基准 1.0', mark: '尖顶红盔 + 斜举短矛，矛尖高过头顶', body: '#b8402f' },
  cavalry: { n: '骑兵', cls: '普通', sz: '横向 1.6 倍', mark: '马头朝前伸出身体轮廓；骑手红缨飘向后方', body: '#a5402f' },
  armor: { n: '重甲兵', cls: '精锐', sz: '1.25 倍、更宽', mark: '铁灰方肩 + 身前一面竖长塔盾（盾面占身体 70%）', body: '#59605a' },
  ranged: { n: '扰阵弓手', cls: '精锐', sz: '1.0', mark: '头戴宽檐斗笠（顶部平），背后弓弧露出头侧', body: '#7c4a3a' },
  banner: { n: '军旗手', cls: '精锐', sz: '1.05，旗高 2 倍身高', mark: '背插高旗，旗面在敌潮之上，谁都挡不住', body: '#9a3a32' },
  siege: { n: '攻城车', cls: '精锐', sz: '2 倍宽', mark: '木屋顶 + 前伸撞木 + 四轮', body: '#765b43' },
  boss: { n: '敌将', cls: '首领', sz: '1.6 倍', mark: '高冠 / 披风 + 母型兵器；脚下红色威胁环', body: '#7a1f1a' },
};
function drawEnemy(g, x, y, type, s = 1, ph = 0, hit = false, reduce = false, variant = '') {
  const step = reduce ? 0 : Math.sin(ph) * 1.2, body = hit ? '#f6dcc0' : ENEMY[type].body;
  g.save(); g.translate(x, y); g.scale(s, s);
  const edge = ['infantry', 'cavalry'].includes(type) ? 1 : 1.4;
  g.fillStyle = '#0005'; g.beginPath(); g.ellipse(0, 1, type === 'cavalry' ? 10 : type === 'siege' ? 16 : 6, 2.4, 0, 0, TAU); g.fill();
  if (type === 'siege') {
    for (const xx of [-11, 11]) for (const yy of [-2, -9]) ell(g, xx, yy, 3.6, 3.6, '#333d35', 1.2);
    path(g, [[-13, -4], [13, -4], [13, -18], [-13, -18]], true); ink(g, hit ? '#e7c69c' : '#765b43', 1.4);
    path(g, [[-15, -18], [0, -27], [15, -18]], true); ink(g, '#924738', 1.4); path(g, [[-2, -30], [2, -30], [2, -14], [-2, -14]], true); ink(g, '#a6a086', 1.2);
    g.restore(); return;
  }
  if (type === 'cavalry') { path(g, [[-9, -4], [7, -4], [9, -10], [-9, -10]], true); ink(g, '#72503e', edge); path(g, [[6, -9], [9, -19], [11, -17], [16, -15], [14, -11], [11, -11], [11, -8]], true); ink(g, '#825c43', edge); g.fillStyle = INK; g.fillRect(11, -16, 1.2, 1.2);
    for (const xx of [-7, -3, 3, 7]) { g.strokeStyle = INK; g.lineWidth = 1.6; g.beginPath(); g.moveTo(xx, -4); g.lineTo(xx + (xx > 0 ? step : -step) * .6, 0); g.stroke(); } g.translate(-1, -8); }
  else for (const sx of [-1, 1]) { g.strokeStyle = INK; g.lineWidth = 2.4; g.beginPath(); g.moveTo(sx * 2, -5); g.lineTo(sx * 2 + sx * step * .5, 0); g.stroke(); }
  const wide = type === 'armor' ? 6.5 : type === 'boss' ? 7 : 4.6;
  if (type === 'boss') { path(g, [[-6, -16], [6, -16], [11, -2], [-11, -2]], true); ink(g, '#451c1a', edge); }
  path(g, [[-wide, -13], [wide, -13], [wide + .6, -4], [-wide - .6, -4]], true); ink(g, body, edge);
  ell(g, 0, -17, 4, 4, '#d2ac83', edge);
  if (type === 'infantry' || type === 'cavalry' || type === 'banner') { path(g, [[-4.6, -18], [0, -25], [4.6, -18]], true); ink(g, '#b8402f', 1.1); if (type === 'cavalry') { g.strokeStyle = '#e2493b'; g.lineWidth = 1.6; g.beginPath(); g.moveTo(0, -25); g.quadraticCurveTo(-6, -28, -10, -24); g.stroke(); } }
  if (type === 'infantry') { g.strokeStyle = '#675242'; g.lineWidth = 1.2; g.beginPath(); g.moveTo(5, -6); g.lineTo(9, -26); g.stroke(); path(g, [[9, -30], [7.4, -25], [10.6, -25]], true); ink(g, '#e6e0c8', .8); }
  if (type === 'armor') { path(g, [[-7, -20], [7, -20], [6, -15], [-6, -15]], true); ink(g, '#4e5049', 1.1); path(g, [[-9, -16], [-1, -16], [-1, -1], [-9, -1]], true); ink(g, hit ? '#f6dcc0' : '#6c7061', 1.3); g.strokeStyle = '#d3c69c'; g.lineWidth = .8; g.beginPath(); g.moveTo(-5, -14); g.lineTo(-5, -3); g.stroke(); }
  if (type === 'ranged') { path(g, [[-8, -19], [8, -19], [4, -23], [-4, -23]], true); ink(g, '#c9a96a', 1.1); g.strokeStyle = '#dec398'; g.lineWidth = 1.6; g.beginPath(); g.arc(-3, -12, 9, -2.2, -.9); g.stroke(); }
  if (type === 'banner') { g.strokeStyle = '#d2b582'; g.lineWidth = 1.4; g.beginPath(); g.moveTo(-4, -4); g.lineTo(-4, -46); g.stroke(); const w = reduce ? 0 : Math.sin(ph * 1.3) * 1.5; path(g, [[-4, -46], [10, -43 + w], [6, -38], [10, -33 + w], [-4, -35]], true); ink(g, '#c23a2c', 1.1); }
  if (type === 'boss') drawBossVariant(g, variant || 'siege_lord', hit);
  g.restore();
}

function drawBossVariant(g, variant, hit) {
  const metal = hit ? '#fff0d4' : '#c8c3a6';
  const staff = (x, top) => { path(g, [[x - 1, -2], [x + 1, -2], [x + 1, top], [x - 1, top]], true); ink(g, '#765536', 1.4); };
  if (variant === 'rammer') {
    path(g, [[-6, -20], [-11, -29], [-8, -24], [-3, -21], [3, -21], [8, -24], [11, -29], [6, -20]], true); ink(g, '#d8cfae', 1.4);
    staff(9, -25); path(g, [[4, -30], [15, -30], [15, -22], [4, -22]], true); ink(g, '#787c72', 1.4);
    g.strokeStyle = '#d3b66d'; g.lineWidth = 1.2; g.beginPath(); g.moveTo(4, -26); g.lineTo(15, -26); g.stroke();
  } else if (variant === 'charger') {
    path(g, [[-5, -20], [0, -28], [5, -20]], true); ink(g, '#9f4632', 1.4);
    for (const x of [-2, 2]) { g.strokeStyle = '#e8c46c'; g.lineWidth = 1.4; g.beginPath(); g.moveTo(x, -26); g.quadraticCurveTo(x * 4, -37, x * 6, -39); g.stroke(); }
    staff(9, -33); path(g, [[9, -40], [6, -32], [9, -34], [12, -32]], true); ink(g, metal, 1.4);
    path(g, [[7, -31], [4, -25], [8, -27]], true); ink(g, '#c8402f', 1);
  } else if (variant === 'banner_lord') {
    path(g, [[-5, -21], [-4, -31], [4, -31], [5, -21]], true); ink(g, '#30251e', 1.4);
    for (const x of [-8, -3]) { staff(x, -37); path(g, [[x, -37], [x - 7, -35], [x - 7, -28], [x, -30]], true); ink(g, '#b8382d', 1.4); }
    path(g, [[7, -3], [13, -19], [16, -21], [16, -17], [9, -2]], true); ink(g, metal, 1.4);
  } else if (variant === 'guardian') {
    path(g, [[-7, -20], [-4, -27], [0, -30], [4, -27], [7, -20]], true); ink(g, '#585e57', 1.4);
    path(g, [[-13, -17], [-5, -18], [-4, -3], [-9, 1], [-14, -3]], true); ink(g, '#6d7464', 1.4);
    g.strokeStyle = '#d6c79c'; g.lineWidth = 1; g.beginPath(); g.moveTo(-9, -15); g.lineTo(-9, -2); g.stroke(); ell(g, -9, -9, 1.8, 1.8, '#d6c79c', .8);
    staff(8, -14); path(g, [[6, -15], [8, -25], [10, -15]], true); ink(g, metal, 1.4);
  } else {
    path(g, [[-3, -20], [0, -34], [3, -20]], true); ink(g, '#c8402f', 1.4);
    staff(8, -26); path(g, [[8, -26], [15, -29], [16, -18], [8, -21]], true); ink(g, metal, 1.4);
  }
  path(g, [[-6, -20], [6, -20], [5, -23], [-5, -23]], true); ink(g, '#d5b367', 1.4);
}
// —— 军营：底座轮廓、主色、兵、动作各不相同。level 1..3
const CAMP = {
  shield: { n: '盾营', c: '#4f7f95', base: '方形木栅（四角桩）', color: '钢青', troop: '2–4 名盾兵并排，人高塔盾连成盾墙；盾墙前一排拒马', atk: '盾墙前推一步 + 地面青色减速环', lv: '盾兵 2 → 3 → 4，Ⅲ 级加拒马' },
  archer: { n: '弓营', c: '#4fa36b', base: '圆形土台（草垛边）', color: '青绿', troop: '弓手站成弧形，长弓高过头顶', atk: '齐拉弓（满弓 2 帧）→ 箭矢抛物线', lv: '弓手 2 → 3 → 4，Ⅲ 级加箭垛' },
  crossbow: { n: '弩营', c: '#a88a4a', base: '六边形石台', color: '铜褐', troop: '一架床弩横置，两名弩手装填', atk: '弩臂回弹 + 直线金白粗箭（不抛物线）', lv: '弩架 1 → 1（加双弦）→ 2' },
  catapult: { n: '投石营', c: '#8a7a5a', base: '长方形夯土台', color: '土黄', troop: '高臂投石机，一名力士装石', atk: '长臂甩起 → 石块高抛，落点尘圈', lv: '臂长加长，Ⅲ 级双机' },
  fire_oil: { n: '火油营', c: '#c4583a', base: '圆形石圈（焦黑地面）', color: '赤橙', troop: '两只陶油罐 + 火盆，一名投掷手', atk: '火盆冒焰 → 抛罐，落地火区', lv: '油罐 2 → 3 → 4，火盆变大' },
  war_drum: { n: '战鼓营', c: '#b0453a', base: '圆形高台（四面旗）', color: '朱红', troop: '一面大鼓 + 鼓手，台角插旗', atk: '鼓手双槌落下，鼓面波纹向外扩（光环范围）', lv: '旗 2 → 3 → 4，鼓更大' },
};
function campTroop(g, x, y, color, kind, t, i, reduce = false) {
  // 军营兵：同样的大头比例，帽子统一青玉色（己方识别），身体用营色
  const bob = reduce ? 0 : Math.sin(t * 3 + i) * .4;
  g.save(); g.translate(x, y + bob);
  for (const s of [-1, 1]) { g.strokeStyle = INK; g.lineWidth = 2; g.beginPath(); g.moveTo(s * 1.6, -4); g.lineTo(s * 1.6, 0); g.stroke(); }
  path(g, [[-4, -11], [4, -11], [4.6, -3], [-4.6, -3]], true); ink(g, color, 1.1);
  ell(g, 0, -14.5, 3.6, 3.6, '#e2c09c', 1); path(g, [[-4, -15.5], [0, -20], [4, -15.5]], true); ink(g, '#2f8a6e', 1);
  g.restore();
}
function drawCampNew(g, type, level, t, atk, reduce = false) {
  const C = CAMP[type], col = C.c;
  g.save();
  g.fillStyle = '#0006'; g.beginPath(); g.ellipse(0, 10, 30, 10, 0, 0, TAU); g.fill();
  // 1 底座轮廓
  if (type === 'shield') { path(g, [[-24, -6], [24, -6], [26, 14], [-26, 14]], true); ink(g, '#6b5a3c', 1.6); for (const xx of [-24, 24]) for (const yy of [-6, 14]) { path(g, [[xx - 2, yy], [xx + 2, yy], [xx + 2, yy - 10], [xx - 2, yy - 10]], true); ink(g, '#8a7450', 1); } }
  else if (type === 'archer') { ell(g, 0, 4, 27, 13, '#6f7a43', 1.6); g.strokeStyle = '#a7a35a'; g.lineWidth = 1; for (let a = 0; a < TAU; a += .5) { g.beginPath(); g.moveTo(Math.cos(a) * 27, 4 + Math.sin(a) * 13); g.lineTo(Math.cos(a) * 30, 2 + Math.sin(a) * 15); g.stroke(); } }
  else if (type === 'crossbow') { path(g, [...Array(6)].map((_, i) => [Math.cos(i / 6 * TAU) * 27, 4 + Math.sin(i / 6 * TAU) * 13]), true); ink(g, '#77746a', 1.6); }
  else if (type === 'catapult') { path(g, [[-28, -2], [28, -2], [28, 14], [-28, 14]], true); ink(g, '#8f7a52', 1.6); }
  else if (type === 'fire_oil') { ell(g, 0, 4, 26, 12, '#3a2a22', 1.6); g.strokeStyle = '#8a7a6a'; g.lineWidth = 3; g.setLineDash([4, 3]); g.beginPath(); g.ellipse(0, 4, 26, 12, 0, 0, TAU); g.stroke(); g.setLineDash([]); }
  else if (type === 'war_drum') { ell(g, 0, 8, 26, 10, '#6b3b2c', 1.6); path(g, [[-22, 8], [-22, -2], [22, -2], [22, 8]], true); ink(g, '#8a4a34', 1.4); ell(g, 0, -2, 22, 8, '#9a5a3c', 1.4); }
  // 2 等级旗（数量 = 等级，旗色 = 营色）
  for (let i = 0; i < level; i++) { const fx = -26 + i * 6, w = reduce ? 0 : Math.sin(t * 3 + i) * 1.2; g.strokeStyle = '#d2b582'; g.lineWidth = 1.2; g.beginPath(); g.moveTo(fx, 8); g.lineTo(fx, -26); g.stroke(); path(g, [[fx, -26], [fx + 9, -24 + w], [fx, -19]], true); ink(g, col, 1); }
  // 3 兵与器械
  const n = level + 1, kick = atk > 0 ? clamp(1 - atk / .35) : 0;
  if (type === 'shield') {
    for (let i = 0; i < n; i++) { const x = -15 + i * (30 / Math.max(1, n - 1)); campTroop(g, x, -1 - kick * 3, col, 'shield', t, i, reduce);
      path(g, [[x - 5, -14 - kick * 3], [x + 5, -14 - kick * 3], [x + 5, 3 - kick * 3], [x - 5, 3 - kick * 3]], true); ink(g, '#7ea4b4', 1.4); g.strokeStyle = '#d5e2e6'; g.lineWidth = 1.2; g.beginPath(); g.moveTo(x, -11 - kick * 3); g.lineTo(x, 0 - kick * 3); g.stroke(); }
    if (level === 3) for (const x of [-18, -6, 6, 18]) { g.strokeStyle = '#bcaa7a'; g.lineWidth = 2; g.beginPath(); g.moveTo(x - 4, 10); g.lineTo(x + 4, 4); g.moveTo(x + 4, 10); g.lineTo(x - 4, 4); g.stroke(); }
    if (atk > 0) { g.strokeStyle = `rgba(126,164,180,${.7 * (1 - kick)})`; g.lineWidth = 2; g.beginPath(); g.ellipse(0, -4, 34 + kick * 20, 12 + kick * 6, 0, Math.PI, TAU); g.stroke(); }
  } else if (type === 'archer') {
    for (let i = 0; i < n; i++) { const a = Math.PI + (i + .5) / n * Math.PI, x = Math.cos(a) * 17, y = 6 + Math.sin(a) * 9; campTroop(g, x, y, col, 'archer', t, i, reduce);
      g.strokeStyle = INK; g.lineWidth = 3.4; g.beginPath(); g.arc(x + 5, y - 13, 9, -1.9, 1.3 - kick * .3); g.stroke(); g.strokeStyle = '#e2c98a'; g.lineWidth = 1.8; g.stroke();
      g.strokeStyle = '#f1e4c3'; g.lineWidth = .8; g.beginPath(); g.moveTo(x + 2, y - 21); g.lineTo(x + 5 - kick * 4, y - 13); g.lineTo(x + 2, y - 4); g.stroke(); }
  } else if (type === 'crossbow') {
    const arm = 14 - kick * 4; for (let r = 0; r < (level === 3 ? 2 : 1); r++) { const yy = -6 + r * 10;
      path(g, [[-3, yy + 6], [3, yy + 6], [3, yy - 14], [-3, yy - 14]], true); ink(g, '#8a6a3a', 1.2);
      g.strokeStyle = INK; g.lineWidth = 3.6; g.beginPath(); g.moveTo(-arm - 4, yy - 2); g.quadraticCurveTo(0, yy - 12, arm + 4, yy - 2); g.stroke(); g.strokeStyle = '#c9a35a'; g.lineWidth = 2; g.stroke();
      g.strokeStyle = '#f1e4c3'; g.lineWidth = 1; g.beginPath(); g.moveTo(-arm - 4, yy - 2); g.lineTo(0, yy + 2 - kick * 4); g.lineTo(arm + 4, yy - 2); g.stroke(); }
    campTroop(g, -18, 10, col, 'x', t, 0, reduce); campTroop(g, 18, 10, col, 'x', t, 1, reduce);
  } else if (type === 'catapult') {
    const ang = -.8 + kick * 1.3, L = 20 + level * 2;
    const machine = (offset, scale) => { g.save(); g.translate(offset, 0); g.scale(scale, scale);
    for (const xx of [-14, 14]) ell(g, xx, 10, 5, 5, '#3f4437', 1.2);
    path(g, [[-14, 8], [0, -12], [14, 8]], false); g.strokeStyle = INK; g.lineWidth = 5; g.stroke(); g.strokeStyle = '#7a6040'; g.lineWidth = 3; g.stroke();
    g.save(); g.translate(0, -12); g.rotate(ang); g.strokeStyle = INK; g.lineWidth = 5; g.beginPath(); g.moveTo(-10, 0); g.lineTo(L, 0); g.stroke(); g.strokeStyle = '#c9b781'; g.lineWidth = 3; g.stroke(); if (kick < .5) ell(g, L, -3, 5, 4, '#9ea08a', 1.2); g.restore();
    g.restore(); };
    if (level === 3) { machine(-12, .7); machine(12, .7); } else machine(0, 1);
    campTroop(g, -20, 6, col, 'x', t, 0, reduce);
  } else if (type === 'fire_oil') {
    for (let i = 0; i < n; i++) { const x = -16 + i * 9, y = 2 + (i % 2) * 5; ell(g, x, y - 5, 4.5, 6, '#8a6440', 1.2); ell(g, x, y - 11, 2.4, 1.4, '#3a2a20', .8); }
    path(g, [[8, 6], [20, 6], [18, 0], [10, 0]], true); ink(g, '#5d503a', 1.2);
    const fl = reduce ? 1 : 1 + Math.sin(t * 12) * .2 + kick; g.fillStyle = '#ff9a3a'; g.beginPath(); g.moveTo(9, 0); g.quadraticCurveTo(14, -16 * fl, 19, 0); g.fill(); g.fillStyle = '#ffe07a'; g.beginPath(); g.moveTo(11.5, 0); g.quadraticCurveTo(14, -9 * fl, 16.5, 0); g.fill();
    campTroop(g, 22, 10, col, 'x', t, 0, reduce);
  } else if (type === 'war_drum') {
    ell(g, 0, -12, 13, 5, '#e8d4a0', 1.4); path(g, [[-13, -12], [13, -12], [13, -2], [-13, -2]], true); ink(g, '#b0453a', 1.4); ell(g, 0, -12, 13, 5, '#e8d4a0', 1.4);
    const beat = atk > 0 ? 1 - kick : reduce ? 1 : .85 + Math.sin(t * 3) * .15; campTroop(g, 0, 10, col, 'x', t, 0, reduce);
    for (const s of [-1, 1]) { g.strokeStyle = INK; g.lineWidth = 2.4; g.beginPath(); g.moveTo(s * 3, -2); g.lineTo(s * 7, -14 - beat * 5); g.stroke(); ell(g, s * 7, -14 - beat * 5, 2, 2, '#e2493b', .8); }
    if (!reduce && atk > 0) { g.strokeStyle = `rgba(226,73,59,${.5 * kick})`; g.lineWidth = 2; g.beginPath(); g.ellipse(0, -12, 13 + (1 - kick) * 22, 5 + (1 - kick) * 8, 0, 0, TAU); g.stroke(); }
  }
  g.restore();
}

const finite = (value, fallback = 0) => Number.isFinite(value) ? value : fallback;
const immutable = value => {
  if (value && typeof value === 'object') { Object.values(value).forEach(immutable); Object.freeze(value); }
  return value;
};

// Preserve every authored contact pose; fill the gaps with evenly spaced recovery poses.
function frameTimes(keys, count, end) {
  const times = [...new Set([0, ...keys.map(([time]) => time), end])].sort((a, b) => a - b);
  while (times.length < count) {
    let gap = 0;
    for (let i = 1; i < times.length - 1; i++) if (times[i + 1] - times[i] > times[gap + 1] - times[gap]) gap = i;
    times.splice(gap + 1, 0, (times[gap] + times[gap + 1]) / 2);
  }
  return times;
}

// The body lock lasts .9 s. Release is the authored gesture; hit is the earliest
// engine damage opportunity, not a promise that an enemy is at that position.
// Advancing fronts start at 0 and contact enemies as they travel. Sima Yi points
// at .3 but lightning resolves at 1, after the body lock. Lü Meng places mines at
// 0; hit is null because proximity, rather than a fixed timestamp, detonates them.
const ULTIMATE_KEYS = Object.fromEntries(Object.entries(MOTION).map(([id, motion]) => [id, motion.ult.k]));

export const HERO_MOTION = immutable(Object.fromEntries(Object.entries(MOTION).map(([id, motion]) => {
  const [idleFrames, attackFrames, ultimateFrames] = motion.frames.split('·').map(Number);
  const duration = motion.atk.dur - motion.atk.fire;
  const attackTimes = Array.from({ length: attackFrames }, (_, i) => i * duration / (attackFrames - 1));
  const times = frameTimes(ULTIMATE_KEYS[id], ultimateFrames, .9);
  return [id, {
    idle: { frames: idleFrames, duration: 2.4 },
    ready: { frames: idleFrames, duration: 2.4 / 1.3 },
    attack: { frames: attackFrames, duration, release: 0, times: attackTimes },
    ultimate: { frames: times.length, duration: .9, release: motion.ult.release, hit: motion.ult.hit, hitMode: motion.ult.hitMode, times },
  }];
})));
export const CAMP_IDS = Object.freeze(Object.keys(CAMP));
export const ENEMY_IDS = Object.freeze(Object.keys(ENEMY));

function heroId(id) { return Object.hasOwn(PORTRAIT, id) ? id : 'guan_yu'; }
function frameIndex(frame, count) { return ((Math.floor(finite(frame)) % count) + count) % count; }

export function heroSpritePose(id, { state = 'idle', frame = 0, reducedMotion = false } = {}) {
  id = heroId(id);
  if (!Object.hasOwn(HERO_MOTION[id], state)) state = 'idle';
  const spec = HERO_MOTION[id][state], index = frameIndex(frame, spec.frames);
  let pose;
  if (state === 'attack') {
    const key = reducedMotion ? (index < spec.frames / 2 ? 0 : spec.frames - 1) : index;
    pose = poseAt(MOTION[id].atk.k, MOTION[id].atk.fire + spec.times[key]);
    pose.bowDraw = 0;
  } else if (state === 'ultimate') {
    const key = reducedMotion ? (index < spec.frames / 2 ? 0 : spec.frames - 1) : index;
    pose = poseAt(ULTIMATE_KEYS[id], spec.times[key]);
    pose.roar = id === 'zhang_fei' && spec.times[key] < .7;
    if (id === 'taishi_ci') pose.bowDraw = 0; // Three targets resolve together; the body only recovers after release.
  } else {
    const phase = reducedMotion ? 0 : index / spec.frames * TAU;
    const breath = Math.sin(phase);
    const p = PORTRAIT[id];
    pose = { dy: breath * (p.body === 'broad' ? .8 : .4), sq: breath * .06,
      wa: ['fan', 'feather', 'firefan'].includes(p.weapon) ? .12 + breath * .14 : breath * .025,
      arm: id === 'sima_yi' ? .6 : id === 'lv_meng' ? .35 : .05 + breath * .025,
      sway: breath, chin: id === 'cao_cao' && index === 5 ? -.7 : 0,
      strokeBeard: id === 'guan_yu' && index === 5 };
  }
  // x/y movement belongs to the renderer; cache entries never depend on a live actor.
  delete pose.x; delete pose.y;
  if (reducedMotion) { pose.dy = 0; pose.lean = 0; pose.sq = 0; pose.sway = 0; }
  pose.glow = state === 'ready';
  return pose;
}

export function drawHeroSprite(ctx, id, options = {}) {
  id = heroId(id);
  ctx.save(); ctx.scale(.86, .86);
  drawChibi(ctx, PORTRAIT[id], heroSpritePose(id, options));
  ctx.restore();
}

export function drawCampSprite(ctx, id, { state = 'idle', frame = 0, level = 1, reducedMotion = false } = {}) {
  id = Object.hasOwn(CAMP, id) ? id : 'shield';
  level = Math.round(clamp(finite(level, 1), 1, 3));
  const index = reducedMotion ? 0 : frameIndex(frame, state === 'attack' ? 5 : 4);
  // The release frame is strongest, then the mechanism visibly settles.
  const attack = state === 'attack' ? .35 * (index / 5) + .001 : 0;
  drawCampNew(ctx, id, level, reducedMotion ? 0 : index / 3, attack, reducedMotion);
}

export function drawEnemySprite(ctx, id, { state = 'walk', frame = 0, variant = '', reducedMotion = false } = {}) {
  id = Object.hasOwn(ENEMY, id) ? id : 'infantry';
  const size = id === 'boss' ? 1.6 : id === 'armor' ? 1.15 : 1;
  drawEnemy(ctx, 0, 0, id, size, (reducedMotion ? 0 : frameIndex(frame, 6)) / 6 * TAU, state === 'hit', reducedMotion, variant);
}

const BOUNDS = Object.freeze({
  hero: { width: 148, height: 126, anchorX: 74, anchorY: 90 },
  camp: { width: 116, height: 78, anchorX: 58, anchorY: 49 },
  enemy: { width: 80, height: 90, anchorX: 40, anchorY: 82 },
});
function canvasFactory(width, height) {
  if (typeof globalThis.OffscreenCanvas === 'function') return new OffscreenCanvas(width, height);
  const canvas = globalThis.document?.createElement?.('canvas');
  if (!canvas) throw new Error('Battle sprites require a Canvas 2D surface');
  canvas.width = width; canvas.height = height;
  return canvas;
}

// A bounded DPR-aware LRU keeps high-DPI late-game crowds from retaining unlimited surfaces.
export function createBattleSpriteCache({ createCanvas = canvasFactory, maxPixels = 12_000_000 } = {}) {
  const entries = new Map(); let pixels = 0, draws = 0, hits = 0;
  function get(kind, id, options = {}) {
    if (!Object.hasOwn(BOUNDS, kind)) throw new RangeError(`Unknown sprite kind: ${kind}`);
    id = kind === 'hero' ? heroId(id) : Object.hasOwn(kind === 'camp' ? CAMP : ENEMY, id) ? id : kind === 'camp' ? 'shield' : 'infantry';
    const reducedMotion = Boolean(options.reducedMotion), dpr = Math.round(clamp(finite(options.dpr, 1), 1, 3) * 4) / 4;
    const allowed = kind === 'hero' ? HERO_MOTION[id] : kind === 'camp' ? { idle: 1, attack: 1 } : { walk: 1, hit: 1 };
    const state = Object.hasOwn(allowed, options.state) ? options.state : kind === 'enemy' ? 'walk' : 'idle';
    const count = kind === 'hero' ? HERO_MOTION[id][state].frames : kind === 'camp' ? state === 'attack' ? 5 : 4 : 6;
    let frame = frameIndex(options.frame, count);
    if (reducedMotion) frame = kind === 'hero' && ['attack', 'ultimate'].includes(state) ? frame < count / 2 ? 0 : count - 1 : 0;
    const level = kind === 'camp' ? Math.round(clamp(finite(options.level, 1), 1, 3)) : 1;
    const variant = kind === 'enemy' && id === 'boss' && ['rammer', 'charger', 'banner_lord', 'guardian', 'siege_lord'].includes(options.variant) ? options.variant : '';
    const key = [kind, id, state, frame, level, dpr, variant, +reducedMotion].join('|');
    if (entries.has(key)) { const entry = entries.get(key); entries.delete(key); entries.set(key, entry); hits++; return entry; }
    const bounds = BOUNDS[kind], canvas = createCanvas(Math.ceil(bounds.width * dpr), Math.ceil(bounds.height * dpr));
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr); ctx.translate(bounds.anchorX, bounds.anchorY);
    const resolved = { state, frame, level, variant, reducedMotion };
    ({ hero: drawHeroSprite, camp: drawCampSprite, enemy: drawEnemySprite })[kind](ctx, id, resolved);
    const entry = Object.freeze({ canvas, ...bounds, dpr, kind, id, ...resolved, appearance: kind === 'hero' ? PORTRAIT[id] : undefined });
    const area = canvas.width * canvas.height;
    while (entries.size && pixels + area > maxPixels) { const first = entries.keys().next().value, old = entries.get(first); pixels -= old.canvas.width * old.canvas.height; entries.delete(first); }
    entries.set(key, entry); pixels += area; draws++;
    return entry;
  }
  return Object.freeze({ get, clear() { entries.clear(); pixels = 0; draws = 0; hits = 0; }, stats() { return { entries: entries.size, pixels, draws, hits }; } });
}
const cache = createBattleSpriteCache();
export const getBattleSprite = (kind, id, options) => cache.get(kind, id, options);
export const clearBattleSpriteCache = () => cache.clear();
export const battleSpriteCacheStats = () => cache.stats();
