// Real browser keyboard checks for the v2 modal, nested equipment card and route sheets.
// Usage: node scripts/playtest/keyboard-audit.mjs [label] [--dist]
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { launch, sleep } from './cdp.mjs';
import { writeAtomic } from '../write-atomic.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const label = process.argv.slice(2).find(value => !value.startsWith('--')) || 'v2-keyboard';
const useDist = process.argv.includes('--dist'), out = path.join(root, 'docs/v1/playtest', label);
await mkdir(out, { recursive: true });
let server, base;
if (useDist) base = pathToFileURL(path.join(root, 'dist/index.html')).href;
else {
  const port = 4700 + Math.floor(Math.random() * 250);
  server = spawn(process.execPath, [path.join(root, 'scripts/serve.mjs')], { env: { ...process.env, PORT: String(port) }, stdio: 'ignore' });
  base = `http://127.0.0.1:${port}/index.html`; await sleep(600);
}
const page = await launch(), report = { label, build: useDist ? 'dist/index.html (file://)' : 'dev server', checks: [], errors: [] };
const focus = selector => page.eval(`(() => { const n = document.querySelector(${JSON.stringify(selector)}); if (!n || n.disabled || !n.getClientRects().length) throw new Error('Cannot focus: ' + ${JSON.stringify(selector)}); n.focus(); return document.activeElement === n; })()`);
const key = async (name, shift = false) => {
  const code = { Tab: 9, Enter: 13, Escape: 27 }[name];
  const event = { key: name, code: name, windowsVirtualKeyCode: code, nativeVirtualKeyCode: code, modifiers: shift ? 8 : 0 };
  await page.send('Input.dispatchKeyEvent', { type: 'keyDown', ...event, ...(name === 'Enter' ? { text: '\r', unmodifiedText: '\r' } : {}) });
  await page.send('Input.dispatchKeyEvent', { type: 'keyUp', ...event });
  await sleep(50);
};
const focused = selector => page.eval(`document.activeElement?.matches(${JSON.stringify(selector)}) === true`);
const check = (name, data = {}) => { report.checks.push({ name, ...data }); console.log('✓', name); };

async function cycle(scope) {
  const controls = `(() => { const root = document.querySelector(${JSON.stringify(scope)}); return [...root.querySelectorAll('button,a[href],input,select,textarea,[tabindex]')].filter(n => !n.disabled && n.tabIndex >= 0 && n.getClientRects().length && getComputedStyle(n).visibility !== 'hidden' && !n.closest('[hidden]')); })()`;
  const total = await page.eval(`(${controls}).length`);
  assert.ok(total > 0, `${scope} has keyboard controls`);
  await page.eval(`(${controls})[0].focus(); true`); await key('Tab', true);
  assert.equal(await page.eval(`document.activeElement === (${controls}).at(-1)`), true, `${scope} Shift+Tab wraps to its last visible enabled control`);
  await key('Tab');
  assert.equal(await page.eval(`document.activeElement === (${controls})[0]`), true, `${scope} Tab wraps to its first visible enabled control`);
  check(`${scope}: Tab and Shift+Tab stay within the active dialog`, { controls: total });
}

try {
  await page.viewport(360, 740);
  await page.goto(base); await page.eval('localStorage.clear(); true'); await page.goto(base);
  await page.waitFor(`document.getElementById('campaign-start') && !document.getElementById('campaign-start').disabled`);
  await focus('#route-button'); await key('Enter');
  assert.equal(await focused('#route-close'), true);
  await cycle('#route-sheet'); await key('Escape');
  assert.equal(await focused('#route-button'), true);
  check('route Escape returns keyboard focus to its entry button');

  await focus('#intel-button'); await sleep(70);
  const intelButton = await page.box('#intel-button');
  assert.ok(intelButton.w >= 44 && intelButton.h >= 44, 'focused keyboard intel entry becomes a full click target');
  await page.screenshot(path.join(out, 'keyboard-intel-entry.png'));
  await key('Enter'); assert.equal(await focused('#intel-close'), true);
  await cycle('#level-intel'); await key('Escape');
  assert.equal(await focused('#intel-button'), true);
  check('focus-visible intel entry opens, traps focus and restores keyboard focus');

  await focus('#heroes-tab'); await key('Enter');
  await focus('#hero-roster .hero-card:not(.is-locked)'); await key('Enter');
  await page.waitFor(`!document.getElementById('lobby-modal').hidden && document.getElementById('lobby-modal').classList.contains('is-page')`);
  assert.equal(await focused('#modal-close'), true);
  await cycle('#lobby-modal');
  await focus('#hero-gear-weapon'); await key('Enter');
  assert.equal(await focused('.hero-gear-popover-close'), true);
  await cycle('#hero-gear-popover');
  await key('Escape');
  assert.equal(await page.eval(`document.getElementById('hero-gear-popover').hidden && !document.getElementById('lobby-modal').hidden`), true);
  assert.equal(await focused('#hero-gear-weapon'), true);
  check('first Escape closes only the equipment card and returns focus to its slot');

  // Even a resource-gated preparation rerenders the roster: the old entry becomes detached.
  await focus('#hero-upgrade-all'); await key('Enter');
  await page.waitFor(`document.getElementById('toast').textContent.includes('已强化 0 / 4 格')`);
  await key('Escape');
  assert.equal(await page.eval(`document.getElementById('lobby-modal').hidden`), true);
  assert.equal(await page.eval(`document.activeElement?.isConnected && document.activeElement?.matches('#hero-roster .hero-card, #heroes-tab')`), true);
  check('closing after a roster rerender restores a connected hero entry or its navigation fallback');

  await focus('#hero-roster .hero-card:not(.is-locked)'); await key('Enter'); await page.waitFor(`!document.getElementById('lobby-modal').hidden`);
  await focus('#hero-gear-weapon'); await key('Enter');
  await focus('#hero-gear-popover .gear-equip'); await key('Enter');
  await page.waitFor(`!document.getElementById('lobby-modal').classList.contains('is-page')`);
  await cycle('#lobby-modal'); await key('Escape');
  assert.equal(await page.eval(`document.getElementById('lobby-modal').hidden && document.activeElement?.isConnected && document.activeElement?.matches('#hero-roster .hero-card')`), true);
  check('equipment picker keeps the shared modal focus trap and restores the hero entry');
  assert.deepEqual(page.errors, []);
} catch (error) {
  report.fatal = String(error?.stack || error); console.error(report.fatal); process.exitCode = 1;
  await page.screenshot(path.join(out, 'keyboard-failure.png')).catch(() => {});
} finally {
  report.errors = page.errors;
  await writeAtomic(path.join(out, 'keyboard-report.json'), JSON.stringify(report, null, 2));
  await page.close(); server?.kill();
}
console.log('keyboard report:', path.join(out, 'keyboard-report.json'));
