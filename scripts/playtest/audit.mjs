// Real-browser playtest audit (headless Chrome over CDP). Usage:
//   node scripts/playtest/audit.mjs <label> [--full] [--dist] [--ui-only]
// Writes screenshots + report.json to docs/v1/playtest/<label>/. Primary taps are real touch events; the in-page
// "average player" bot clicks visible DOM buttons only. Engine state is read (never written) through ?debug.
import { spawn } from 'node:child_process';
import { writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { launch, sleep } from './cdp.mjs';
import { buildReturningSave } from './returning-save.mjs';
import { encodeChallenge } from '../../experience.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const label = process.argv[2] || 'run';
const full = process.argv.includes('--full'), useDist = process.argv.includes('--dist'), uiOnly = process.argv.includes('--ui-only');
const out = path.join(root, 'docs', 'v1', 'playtest', label);
await mkdir(out, { recursive: true });
const report = { label, startedAt: new Date().toISOString(), build: useDist ? 'dist/index.html (file://)' : 'dev server', steps: [], layout: [], perf: [], errors: [] };
const shot = (page, name) => page.screenshot(path.join(out, name + '.png'));
const step = (name, data = {}) => { report.steps.push({ name, ...data }); console.log('·', name, JSON.stringify(data)); };

let server = null, base;
if (useDist) base = pathToFileURL(path.join(root, 'dist', 'index.html')).href;
else {
  const port = 4300 + Math.floor(Math.random() * 400);
  server = spawn(process.execPath, [path.join(root, 'scripts', 'serve.mjs')], { env: { ...process.env, PORT: String(port) }, stdio: 'ignore' });
  base = `http://127.0.0.1:${port}/index.html`; await sleep(600);
}
const debugUrl = base + '?debug';
const blank = useDist ? pathToFileURL(path.join(root, 'dist', 'favicon.svg')).href : base.replace('index.html', 'favicon.svg');
const page = await launch(); report.browser = page.browserExe;

const DOM_AUDIT = `(() => {
  const activeDialog = ['level-intel','lobby-modal','route-sheet'].map(id => document.getElementById(id)).find(n => n && !n.hidden && n.getBoundingClientRect().height > 0);
  const vis = n => { const r = n.getBoundingClientRect(); const s = getComputedStyle(n); return (!activeDialog || activeDialog.contains(n)) && r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none' && s.opacity !== '0' && s.clipPath !== 'inset(50%)' && s.clip !== 'rect(0px, 0px, 0px, 0px)' && r.bottom > 0 && r.top < innerHeight && !n.closest('[hidden]'); };
  const small = [], targets = [];
  for (const n of document.querySelectorAll('body *')) {
    if (!vis(n) || n.closest('.sr-only')) continue;
    const own = [...n.childNodes].some(c => c.nodeType === 3 && c.textContent.trim());
    const fs = parseFloat(getComputedStyle(n).fontSize);
    // Only numeric corner badges are exempt from the 12px copy requirement.
    if (n.matches('.gear-tile-level, .filter-count, .lv-badge, .level-badge, .upgrade-count, #inventory-count') && /^[+\\d\\s]+$/.test(n.textContent.trim())) continue;
    if (own && fs < 12) small.push({ text: n.textContent.trim().slice(0, 24), fs });
  }
  for (const n of document.querySelectorAll('button, a[href], select, input, summary')) {
    if (!vis(n) || n.disabled) continue; const r = n.getBoundingClientRect();
    if (r.width < 44 || r.height < 44) targets.push({ id: n.id || String(n.className).slice(0, 30), text: n.textContent.trim().slice(0, 16), w: Math.round(r.width), h: Math.round(r.height) });
  }
  const dimensions = id => { const n = document.getElementById(id); return n ? { clientHeight: n.clientHeight, scrollHeight: n.scrollHeight, verticalOverflow: n.scrollHeight > n.clientHeight + 1, clientWidth: n.clientWidth, scrollWidth: n.scrollWidth, horizontalOverflow: n.scrollWidth > n.clientWidth + 1 } : null; };
  return { smallCount: small.length, small: small.slice(0, 12), targetCount: targets.length, targets: targets.slice(0, 12), horizontalOverflow: document.documentElement.scrollWidth > innerWidth + 1, lobbyScroll: dimensions('lobby-scroll'), modalBody: dimensions('modal-body'), vw: innerWidth, vh: innerHeight };
})()`;

async function auditV2Screens(prefix) {
  for (const [w, h] of [[360, 740], [390, 844]]) {
    await page.viewport(w, h); await page.tap('#campaign-tab'); await sleep(420);
    await shot(page, `${prefix}-campaign-${w}x${h}`);
    report.layout.push({ screen: `v2-campaign-${w}x${h}`, ...(await page.eval(DOM_AUDIT)) });
    await page.tap('#route-button'); await sleep(450);
    await shot(page, `${prefix}-level-detail-${w}x${h}`);
    report.layout.push({ screen: `v2-level-detail-${w}x${h}`, ...(await page.eval(DOM_AUDIT)) });
    await page.tap('#route-close'); await sleep(220);
    await page.tap('#heroes-tab'); await sleep(200); await page.tap('#hero-roster .hero-card:not(.is-locked)');
    await page.waitFor(`!document.getElementById('lobby-modal').hidden && document.getElementById('lobby-modal').classList.contains('is-page')`); await sleep(700);
    await shot(page, `${prefix}-hero-detail-${w}x${h}`);
    report.layout.push({ screen: `v2-hero-detail-${w}x${h}`, ...(await page.eval(DOM_AUDIT)) });
    await page.tap('#hero-gear-weapon'); await sleep(220);
    await shot(page, `${prefix}-hero-equipment-${w}x${h}`);
    report.layout.push({ screen: `v2-hero-equipment-${w}x${h}`, ...(await page.eval(DOM_AUDIT)) });
    await page.tap('#hero-gear-popover .gear-equip'); await sleep(220);
    await shot(page, `${prefix}-equipment-picker-${w}x${h}`);
    report.layout.push({ screen: `v2-equipment-picker-${w}x${h}`, ...(await page.eval(DOM_AUDIT)) });
    await page.tap('#modal-close'); await page.tap('#workshop-tab'); await page.tap('#ws-tab-bag'); await sleep(250);
    await shot(page, `${prefix}-inventory-${w}x${h}`);
    report.layout.push({ screen: `v2-inventory-${w}x${h}`, ...(await page.eval(DOM_AUDIT)) });
  }
  await page.viewport(390, 844); await page.tap('#campaign-tab'); await sleep(200);
}
const BOT = `window.__bot = setInterval(() => {
  const q = s => document.querySelector(s);
  if (!q('#lobby-modal').hidden) return;
  if (!q('#choice-overlay').hidden) { if (!window.__holdChoice) q('.upgrade-choice')?.click(); return; }
  if (!q('#result-overlay').hidden || !q('#story-overlay').hidden) return;
  if (!window.__noCast) for (const b of document.querySelectorAll('#lead-command .hero-command, #hero-commands .hero-command')) if (!b.disabled) { b.click(); return; }
  if (window.__noBuild) return;
  const food = +q('#food-value').textContent;
  if (food >= 60 && q('#camp-panel').hidden && !q('#formation-button').disabled) { q('#formation-button').click(); return; }
  if (!q('#camp-panel').hidden) { const b = [...document.querySelectorAll('#camp-options button')].find(b => !b.disabled); if (b) b.click(); else q('#close-camp').click(); }
}, 350); true`;
const fpsProbe = `(() => { window.__frames = []; let last = performance.now(); const tick = now => { window.__frames.push(now - last); last = now; requestAnimationFrame(tick); }; requestAnimationFrame(tick); return true; })()`;
const readFps = `(() => { const f = (window.__frames || []).splice(0).filter(x => x > 0 && x < 500); if (!f.length) return null; const avg = f.reduce((a,b)=>a+b,0)/f.length; const sorted = [...f].sort((a,b)=>a-b); return { frames: f.length, avgFps: +(1000/avg).toFixed(1), p95FrameMs: +sorted[Math.floor(f.length*.95)].toFixed(1), worstMs: +sorted.at(-1).toFixed(1), quality: window.__wushuang?.diagnostics?.quality, peakAlive: window.__wushuang?.game?.stats?.maxAlive }; })()`;
const waitResult = async (ms = 600000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await page.eval(`!document.getElementById('result-overlay').hidden`)) return true; await sleep(500); } return false; };
const readGuide = `({ step: document.getElementById('tutorial-card').dataset.step, hidden: document.getElementById('tutorial-card').hidden, title: document.getElementById('tutorial-title').textContent, camp: !document.getElementById('camp-panel').hidden, time: +window.__wushuang.game.time.toFixed(2), off: !document.getElementById('tutorial-card').dataset.step || (document.getElementById('tutorial-card').hidden && !document.querySelector('#lead-command .is-tutorial-target') && window.__wushuang.game.time > 0 && document.getElementById('speed-button').disabled === false) })`;

try {
  // ===== 1. New player, Stage 1 =====
  await page.viewport(390, 844);
  await page.goto(blank); await page.eval('localStorage.clear(); true').catch(() => {});
  const t0 = Date.now(); await page.goto(debugUrl);
  await page.waitFor(`document.getElementById('campaign-start')?.getBoundingClientRect().height > 0 && !document.getElementById('campaign-start').disabled`, 15000, 30);
  const nav = await page.eval(`(() => { const n = performance.getEntriesByType('navigation')[0]; return { domContentLoadedMs: Math.round(n.domContentLoadedEventEnd), loadMs: Math.round(n.loadEventEnd), interactiveMs: Math.round(performance.now()) }; })()`);
  step('first_screen_interactive', { ...nav, wallMs: Date.now() - t0 });
  await shot(page, '01-first-screen-new'); report.layout.push({ screen: 'lobby-new-390', ...(await page.eval(DOM_AUDIT)) });
  if (!uiOnly) {
  const tEntry = Date.now(); await page.tap('#campaign-start'); await sleep(450);
  step('battle_entry', { taps: 1, msFromTap: Date.now() - tEntry });
  await shot(page, '02-story-sheet');
  await page.tap('#story-start'); const tCombat = Date.now(); await sleep(400);
  await shot(page, '03-tutorial-deploy'); report.layout.push({ screen: 'battle-tutorial-390', ...(await page.eval(DOM_AUDIT)) });
  const tutorial = []; let taps = 2, completeShot = false;
  for (let i = 0; i < 600; i++) {
    const t = await page.eval(readGuide);
    const prev = tutorial.at(-1);
    if (!prev || prev.title !== t.title || prev.camp !== t.camp || prev.hidden !== t.hidden || prev.step !== t.step) { tutorial.push({ ...t, wallMs: Date.now() - tCombat }); console.log('  ', JSON.stringify(t)); }
    if (t.camp) {
      const opt = await page.eval(`(() => { const all = [...document.querySelectorAll('#camp-options button')].filter(b => !b.disabled); const b = all.find(b => /弓营/.test(b.textContent)) || all[0]; if (!b) return null; const r = b.getBoundingClientRect(); return {x:r.x+r.width/2,y:r.y+r.height/2}; })()`);
      await shot(page, '04-camp-panel'); await page.tap(opt); taps++; step('first_deploy', { taps, wallMsFromCombat: Date.now() - tCombat, combatSec: t.time }); await sleep(250); continue;
    }
    if (t.step === 'deploy' && !t.hidden) {
      // Tap the real highlighted slot on the canvas, as a player would.
      const p = await page.eval(`(() => { const g = window.__wushuang.game; const c = document.getElementById('battle-canvas').getBoundingClientRect(); const open = g.map.campSlots.filter(s => !g.camps.some(k => k.slot === s.slot)); const merge = g.map.paths[0].at(-2); const s = open.reduce((b, s) => Math.hypot(s.x-merge.x,s.y-merge.y) < Math.hypot(b.x-merge.x,b.y-merge.y) ? s : b); return { x: c.left + s.x / 420 * c.width, y: c.top + s.y / 600 * c.height }; })()`);
      await page.tap(p); taps++; await sleep(250); continue;
    }
    if (t.step === 'ultimate' && !t.hidden) {
      await shot(page, '05-ultimate-ready'); const tCast = Date.now();
      await page.tap('#lead-command .hero-command'); taps++;
      step('first_ultimate_cast', { taps, wallMsFromCombat: tCast - tCombat, combatSec: t.time });
      await sleep(120); await shot(page, '06-ultimate-windup');
      await sleep(380); await shot(page, '07-ultimate-climax');
      await sleep(650); await shot(page, '08-ultimate-result'); continue;
    }
    if (t.step === 'complete' && !t.hidden && !completeShot) { completeShot = true; await shot(page, '08b-tutorial-complete'); }
    if (t.step === 'complete' && t.hidden) break;
    await sleep(150);
  }
  report.tutorial = tutorial;
  step('tutorial_end', { wallMsFromCombat: Date.now() - tCombat, combatSec: await page.eval('+window.__wushuang.game.time.toFixed(1)') });
  await sleep(1500); await shot(page, '09-regular-combat');

  // Layout matrix mid-battle, including landscape and back to portrait.
  await page.eval(`document.getElementById('pause-button').click(); true`); await sleep(150);
  for (const [w, h] of [[320, 568], [360, 640], [390, 844], [430, 932], [844, 390], [390, 844]]) {
    await page.viewport(w, h); await sleep(400);
    await page.eval(`document.getElementById('resume-button')?.click(); true`); await sleep(350);
    await shot(page, `layout-battle-${w}x${h}`); report.layout.push({ screen: `battle-${w}x${h}`, state: await page.eval('window.__wushuang.game.state'), ...(await page.eval(DOM_AUDIT)) });
    await page.eval(`if (window.__wushuang.game.state === 'playing') document.getElementById('pause-button').click(); true`); await sleep(100);
  }
  await page.eval(`document.getElementById('resume-button')?.click(); true`);

  if (full) {
    await page.eval(fpsProbe); await page.eval('window.__holdChoice = true; true'); await page.eval(BOT);
    let shotChoice = false; const tBot = Date.now(), end = Date.now() + 600000;
    while (Date.now() < end) {
      await sleep(500);
      const s = await page.eval(`({ choice: !document.getElementById('choice-overlay').hidden, result: !document.getElementById('result-overlay').hidden })`);
      if (s.choice && !shotChoice) { await sleep(300); await shot(page, '10-tactical-choice'); shotChoice = true; await page.eval('window.__holdChoice = false; true'); }
      if (s.result) break;
    }
    report.perf.push({ scenario: 'Stage 1 regular combat (new player, 1×)', ...(await page.eval(readFps)) });
    await sleep(700); await shot(page, '11-victory');
    report.layout.push({ screen: 'victory-390', ...(await page.eval(DOM_AUDIT)) });
    report.result = await page.eval(`({ title: document.getElementById('result-title').textContent, highlight: document.getElementById('result-highlight').textContent, stats: document.querySelector('.result-stats').textContent, combo: document.getElementById('result-combo').textContent, next: document.getElementById('result-next').textContent, rewards: document.getElementById('result-rewards').textContent })`);
    step('battle_result', { wallMsFromBot: Date.now() - tBot, ...report.result });
    if ((await page.box('#result-open-box'))?.visible) { await page.tap('#result-open-box'); await sleep(500); await shot(page, '12-victory-loot'); }
    // Share flow (download/copy fallbacks; headless has no native share sheet).
    await page.tap('#result-share'); await sleep(1800); await shot(page, '13-share-modal');
    const card = await page.eval(`document.querySelector('.share-image')?.src || null`);
    if (card) await writeFile(path.join(out, '14-share-card.png'), Buffer.from(card.split(',')[1], 'base64'));
    await page.send('Browser.grantPermissions', { permissions: ['clipboardReadWrite', 'clipboardSanitizedWrite'] }).catch(() => {});
    await page.eval(`[...document.querySelectorAll('.share-actions button')].find(b => b.textContent === '复制文字')?.click(); true`); await sleep(400);
    report.shareStatus = await page.eval(`document.querySelector('#modal-body .modal-feedback')?.textContent`);
    report.shareText = await page.eval(`document.querySelector('.share-text')?.value`);
    await page.eval(`document.getElementById('modal-close').click(); true`);
    report.telemetry = await page.eval(`JSON.parse(localStorage.getItem('wushuang-guard-telemetry-v1') || '[]').map(e => ({ type: e.type, ms: e.ms, combatSec: e.combatSec, wallMs: e.wallMs, wallSec: e.wallSec, frozenSec: e.frozenSec, method: e.method }))`);

    // ===== 2. Stage 2 via "next", then a deliberate defeat (no building, no casting) =====
    await page.tap('#next-level'); await sleep(500);
    await page.eval(`document.getElementById('story-start').click(); true`); await sleep(300);
    await page.eval(`window.__noBuild = true; window.__noCast = true; document.getElementById('speed-button').click(); document.getElementById('speed-button').click(); true`);
    await waitResult(300000); await sleep(600); await shot(page, '15-defeat');
    report.defeat = await page.eval(`({ advice: document.getElementById('result-advice').textContent, primary: document.getElementById('next-level').textContent })`);
    step('defeat', report.defeat);
    await page.eval('clearInterval(window.__bot); window.__noBuild = false; window.__noCast = false; true');
  }

  }
  // ===== 3. Returning player (save created through real battles and settlements) =====
  const save = await buildReturningSave(8);
  await page.viewport(390, 844); await page.goto(blank);
  await page.eval(`localStorage.clear(); localStorage.setItem('wushuang-guard-campaign-v2', ${JSON.stringify(save)}); true`);
  await page.goto(debugUrl); await sleep(700);
  report.returning = await page.eval(`({ progress: document.getElementById('campaign-progress').textContent, start: document.getElementById('start-label').textContent, sub: document.getElementById('start-sub').textContent, gridVisible: !document.getElementById('chapter-body').hidden })`);
  step('returning_lobby', report.returning);
  await shot(page, '20-first-screen-returning'); report.layout.push({ screen: 'lobby-returning-390', ...(await page.eval(DOM_AUDIT)) });
  for (const [w, h] of [[320, 568], [430, 932]]) { await page.viewport(w, h); await sleep(300); await shot(page, `layout-lobby-${w}x${h}`); report.layout.push({ screen: `lobby-${w}x${h}`, ...(await page.eval(DOM_AUDIT)) }); }
  await page.viewport(390, 844); await sleep(200);
  await page.tap('#heroes-tab'); await sleep(250); await shot(page, '21-heroes'); report.layout.push({ screen: 'heroes-390', ...(await page.eval(DOM_AUDIT)) });
  await page.tap('#workshop-tab'); await sleep(250); await shot(page, '22-workshop'); report.layout.push({ screen: 'workshop-390', ...(await page.eval(DOM_AUDIT)) });
  await page.tap('#settings-tab'); await sleep(250); await shot(page, '23-settings'); report.layout.push({ screen: 'settings-390', ...(await page.eval(DOM_AUDIT)) });
  await page.tap('#campaign-tab'); await sleep(200);
  await page.tap('#prepare-button'); await sleep(300); await shot(page, '24-prepare-modal'); await page.eval(`document.getElementById('modal-close').click(); true`);
  await auditV2Screens('25');

  if (full) {
    // ===== 4. Boss + stress via a friend challenge link (Wei 8 boss, 3 heroes, 2×, every skill cast) =====
    const transactions = JSON.parse(save).rewardLedger.transactions.length;
    const code = encodeChallenge({ levelId: 'wei_008', heroes: ['guan_yu', 'cao_cao', 'xiahou_dun'], target: { burst: 60, kills: 900, hp: 80 } });
    await page.goto(blank); await page.goto(debugUrl + '#challenge=' + code); await sleep(800);
    await shot(page, '30-challenge-invite');
    await page.eval(`[...document.querySelectorAll('#modal-body button')].at(-1).click(); true`); await sleep(400);
    await shot(page, '31-challenge-rules'); await page.tap('#story-start'); await sleep(300);
    await page.eval(`document.getElementById('speed-button').click(); document.getElementById('speed-button').click(); true`);
    await page.eval(fpsProbe); await page.eval('window.__holdChoice = false; ' + BOT);
    let bossShot = false; const end = Date.now() + 600000;
    while (Date.now() < end) {
      await sleep(400);
      const s = await page.eval(`({ boss: (window.__wushuang.game?.enemies || []).some(e => e.type === 'boss' && e.hp > 0), result: !document.getElementById('result-overlay').hidden })`);
      if (s.boss && !bossShot) { report.perf.push({ scenario: 'Wei 8 waves before boss, 3 heroes, 2×, every skill cast', ...(await page.eval(readFps)) }); await sleep(2500); await shot(page, '32-boss-fight'); bossShot = true; }
      if (s.result) break;
    }
    report.perf.push({ scenario: 'Wei 8 boss phase to end, 3 heroes, 2×', ...(await page.eval(readFps)) });
    await sleep(600); await shot(page, '33-challenge-result');
    report.challenge = await page.eval(`({ comparison: document.getElementById('result-challenge').textContent, rewards: document.getElementById('result-rewards').textContent, title: document.getElementById('result-title').textContent })`);
    report.challengeSaveUnchanged = await page.eval(`JSON.parse(localStorage.getItem('wushuang-guard-campaign-v2')).rewardLedger.transactions.length === ${transactions}`);
    step('challenge_result', { ...report.challenge, saveUnchanged: report.challengeSaveUnchanged });
    await page.eval('clearInterval(window.__bot); true');
  }
  report.errors = page.errors; report.console = page.console.slice(-20);
} catch (error) {
  report.fatal = String(error?.stack || error); console.error(error);
  await shot(page, 'zz-fatal').catch(() => {});
} finally {
  report.errors = page.errors;
  report.violations = report.layout.flatMap(layout => {
    const failures = [];
    if (layout.horizontalOverflow) failures.push('horizontal overflow');
    if (layout.screen.startsWith('v2-')) {
      if (layout.smallCount) failures.push('visible copy below 12px');
      if (layout.targetCount) failures.push('click targets below 44px');
      if (/^v2-(campaign|hero-detail)-/.test(layout.screen) && layout.lobbyScroll?.verticalOverflow) failures.push('lobby scrolls vertically');
      if (layout.screen.startsWith('v2-hero-detail-') && layout.modalBody?.verticalOverflow) failures.push('hero page scrolls vertically');
    }
    return failures.map(reason => ({ screen: layout.screen, reason }));
  });
  await writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
  await page.close(); server?.kill();
}
console.log('report:', path.join(out, 'report.json'), 'errors:', report.errors.length, report.fatal ? 'FATAL' : '');
if (report.fatal || report.errors.length || report.violations.length) process.exitCode = 1;
