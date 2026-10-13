/** Battle-result share card. 1080×1350 portrait, readable as a chat thumbnail; local procedural art only. */
import { heroPortrait, HERO_ART } from './hero-portraits.js';

export const CARD_WIDTH = 1080, CARD_HEIGHT = 1350;
const FACTION_TINT = { wei: '#4f6f8f', shu: '#3f7a5c', wu: '#a3523c' };
const SERIF = '"Noto Serif SC","Songti SC","STSong",SimSun,serif';
const SANS = '"Microsoft YaHei","PingFang SC",system-ui,sans-serif';

export function loadImage(src, timeout = 1500) {
  return new Promise(resolve => {
    if (typeof Image === 'undefined') { resolve(null); return; }
    const image = new Image(); let done = false;
    const finish = value => { if (!done) { done = true; resolve(value); } };
    image.onload = () => finish(image); image.onerror = () => finish(null);
    setTimeout(() => finish(null), timeout); image.src = src;
  });
}

function frame(ctx, x, y, w, h, color, width) { ctx.strokeStyle = color; ctx.lineWidth = width; ctx.strokeRect(x, y, w, h); }
function corner(ctx, x, y, sx, sy) {
  ctx.beginPath(); ctx.moveTo(x, y + sy * 70); ctx.lineTo(x, y); ctx.lineTo(x + sx * 70, y);
  ctx.moveTo(x + sx * 18, y + sy * 40); ctx.lineTo(x + sx * 18, y + sy * 18); ctx.lineTo(x + sx * 40, y + sy * 18); ctx.stroke();
}

/** data: { heroId, stageLabel, levelName, highlight:{value,label,unit,record}, stars, won, stats:[[label,value]...], challenge, footer } */
export function drawShareCard(canvas, data, portrait = null) {
  canvas.width = CARD_WIDTH; canvas.height = CARD_HEIGHT;
  const ctx = canvas.getContext('2d'); const art = HERO_ART[data.heroId] || HERO_ART.guan_yu;
  const tint = FACTION_TINT[art.faction] || '#3f7a5c';
  // Ink-green ground with a faction wash and deterministic paper grain.
  const ground = ctx.createLinearGradient(0, 0, 0, CARD_HEIGHT);
  ground.addColorStop(0, '#1b332a'); ground.addColorStop(0.55, '#203b2e'); ground.addColorStop(1, '#10221b');
  ctx.fillStyle = ground; ctx.fillRect(0, 0, CARD_WIDTH, CARD_HEIGHT);
  const wash = ctx.createRadialGradient(540, 470, 40, 540, 470, 620);
  wash.addColorStop(0, tint + 'aa'); wash.addColorStop(1, tint + '00');
  ctx.fillStyle = wash; ctx.fillRect(0, 0, CARD_WIDTH, CARD_HEIGHT);
  let seed = 20261012; const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  for (let i = 0; i < 1400; i++) { ctx.fillStyle = i % 3 ? '#ead5a412' : '#0b1a1418'; ctx.fillRect(rnd() * CARD_WIDTH, rnd() * CARD_HEIGHT, 1 + rnd() * 4, 1.5); }
  // Brush sweep behind the hero: the same arc language as the in-game Peerless wave.
  ctx.save(); ctx.translate(540, 520); ctx.rotate(-0.32);
  const sweep = ctx.createLinearGradient(-460, 0, 460, 0);
  sweep.addColorStop(0, '#e9cf8a00'); sweep.addColorStop(0.5, '#f3dc9c55'); sweep.addColorStop(1, '#e9cf8a00');
  ctx.fillStyle = sweep; ctx.beginPath(); ctx.ellipse(0, 0, 470, 120, 0, Math.PI * 1.05, Math.PI * 1.95); ctx.ellipse(0, 26, 430, 80, 0, Math.PI * 1.95, Math.PI * 1.05, true); ctx.fill();
  ctx.restore();
  // Gold scroll frame.
  frame(ctx, 34, 34, CARD_WIDTH - 68, CARD_HEIGHT - 68, '#d9bd7c', 4); frame(ctx, 52, 52, CARD_WIDTH - 104, CARD_HEIGHT - 104, '#d9bd7c55', 2);
  ctx.strokeStyle = '#e8cd8a'; ctx.lineWidth = 5;
  corner(ctx, 70, 70, 1, 1); corner(ctx, CARD_WIDTH - 70, 70, -1, 1); corner(ctx, 70, CARD_HEIGHT - 70, 1, -1); corner(ctx, CARD_WIDTH - 70, CARD_HEIGHT - 70, -1, -1);
  // Title seal and stage.
  ctx.save(); ctx.translate(132, 150); ctx.rotate(-0.06); ctx.fillStyle = '#8a3b2e'; ctx.fillRect(-46, -50, 92, 100);
  ctx.strokeStyle = '#d49862'; ctx.lineWidth = 3; ctx.strokeRect(-46, -50, 92, 100);
  ctx.fillStyle = '#ffe2b0'; ctx.font = `700 64px ${SERIF}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('双', 0, 4); ctx.restore();
  ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = '#f4e3b2'; ctx.font = `700 60px ${SERIF}`; ctx.fillText('无双守关', 210, 150);
  ctx.fillStyle = '#d6c592'; ctx.font = `500 34px ${SANS}`; ctx.fillText(data.stageLabel, 212, 200);
  // Hero portrait, large and centred: the character is the hook.
  if (portrait) {
    ctx.save(); ctx.shadowColor = '#000a'; ctx.shadowBlur = 40; ctx.shadowOffsetY = 18;
    ctx.drawImage(portrait, 250, 250, 580, 580); ctx.restore();
  } else {
    ctx.fillStyle = tint; ctx.beginPath(); ctx.arc(540, 540, 250, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#f4e3b2'; ctx.font = `700 260px ${SERIF}`; ctx.textAlign = 'center'; ctx.fillText(art.glyph, 540, 630); ctx.textAlign = 'left';
  }
  // Vertical skill name in gold, right side.
  ctx.save(); ctx.fillStyle = '#f3d58f'; ctx.font = `700 74px ${SERIF}`; ctx.textAlign = 'center'; ctx.shadowColor = '#000c'; ctx.shadowBlur = 12;
  [...art.skill].forEach((ch, i) => ctx.fillText(ch, 930, 330 + i * 88)); ctx.restore();
  ctx.save(); ctx.fillStyle = '#efe1b8'; ctx.font = `700 54px ${SERIF}`; ctx.textAlign = 'center'; ctx.shadowColor = '#000c'; ctx.shadowBlur = 10;
  [...art.name].forEach((ch, i) => ctx.fillText(ch, 150, 360 + i * 66)); ctx.restore();
  // Headline: one authentic number, very large.
  const value = String(data.highlight.value);
  ctx.textAlign = 'center';
  ctx.fillStyle = '#e6d39f'; ctx.font = `600 44px ${SANS}`; ctx.fillText(data.highlight.label, 540, 900);
  ctx.save(); ctx.font = `800 210px ${SERIF}`; ctx.lineWidth = 14; ctx.strokeStyle = '#3d2913'; ctx.strokeText(value, 520, 1090);
  const gold = ctx.createLinearGradient(0, 940, 0, 1100); gold.addColorStop(0, '#fff3c6'); gold.addColorStop(1, '#e6b45c');
  ctx.fillStyle = gold; ctx.fillText(value, 520, 1090); ctx.restore();
  const width = (() => { ctx.font = `800 210px ${SERIF}`; return ctx.measureText(value).width; })();
  ctx.fillStyle = '#f0d898'; ctx.font = `700 60px ${SERIF}`; ctx.textAlign = 'left'; ctx.fillText(data.highlight.unit, 520 + width / 2 + 12, 1086);
  if (data.highlight.record) { ctx.save(); ctx.translate(820, 960); ctx.rotate(0.12); ctx.fillStyle = '#a8412f'; ctx.fillRect(-80, -34, 160, 64); ctx.fillStyle = '#ffe6bd'; ctx.font = `700 36px ${SERIF}`; ctx.textAlign = 'center'; ctx.fillText('新纪录', 0, 12); ctx.restore(); }
  // Stars and supporting real stats.
  ctx.textAlign = 'center';
  if (data.won) { ctx.fillStyle = '#f3cc79'; ctx.font = `700 54px ${SANS}`; ctx.fillText('★'.repeat(data.stars) + '☆'.repeat(3 - data.stars), 540, 1160); }
  ctx.fillStyle = '#cfc6a4'; ctx.font = `500 34px ${SANS}`;
  ctx.fillText(data.stats.map(([k, v]) => `${k} ${v}`).join('   ·   '), 540, 1215);
  ctx.fillStyle = '#efd48f'; ctx.font = `700 40px ${SERIF}`; ctx.fillText(data.challenge, 540, 1268);
  ctx.fillStyle = '#93a088'; ctx.font = `400 22px ${SANS}`; ctx.fillText(data.footer, 540, 1300);
  return canvas;
}

export async function renderShareCard(data, doc = globalThis.document) {
  const canvas = doc.createElement('canvas');
  const portrait = await loadImage(heroPortrait(data.heroId));
  return drawShareCard(canvas, data, portrait);
}

export function canvasBlob(canvas) {
  return new Promise(resolve => { try { canvas.toBlob(blob => resolve(blob), 'image/png'); } catch { resolve(null); } });
}
