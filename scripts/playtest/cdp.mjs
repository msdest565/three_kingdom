// Minimal Chrome DevTools Protocol driver for local playtests (no third-party dependencies).
// Launches a local Chrome/Edge in headless mode, emulates a phone viewport and dispatches real touch/mouse input.
import { spawn } from 'node:child_process';
import { mkdtemp, rm, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { writeAtomic } from '../write-atomic.mjs';

const CANDIDATES = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/google-chrome', '/usr/bin/chromium', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].filter(Boolean);

export function findBrowser() { return CANDIDATES.find(p => existsSync(p)) || null; }
const sleep = ms => new Promise(r => setTimeout(r, ms));

export async function launch({ headless = true } = {}) {
  const exe = findBrowser(); if (!exe) throw new Error('No Chrome/Edge found; set CHROME_PATH');
  const profile = await mkdtemp(path.join(os.tmpdir(), 'wushuang-cdp-'));
  const port = 9300 + Math.floor(Math.random() * 500);
  const args = [`--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check',
    '--autoplay-policy=no-user-gesture-required', '--disable-background-timer-throttling', '--disable-renderer-backgrounding',
    '--disable-backgrounding-occluded-windows', '--hide-scrollbars', '--mute-audio'];
  if (headless) args.push('--headless=new');
  const child = spawn(exe, [...args, 'about:blank'], { stdio: 'ignore' });
  let target;
  for (let i = 0; i < 80 && !target; i++) {
    await sleep(150);
    try { const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json(); target = list.find(t => t.type === 'page'); } catch {}
  }
  if (!target) { child.kill(); throw new Error('Browser did not expose a page target'); }
  const page = await Page.connect(target.webSocketDebuggerUrl);
  page.close = async () => { try { page.ws.close(); } catch {} child.kill(); await sleep(300); await rm(profile, { recursive: true, force: true }).catch(() => {}); };
  page.browserExe = exe;
  return page;
}

export class Page {
  static async connect(url) {
    const ws = new WebSocket(url); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
    const page = new Page(ws); await page.send('Page.enable'); await page.send('Runtime.enable'); await page.send('Log.enable');
    return page;
  }
  constructor(ws) {
    this.ws = ws; this.id = 0; this.pending = new Map(); this.console = []; this.errors = [];
    ws.onmessage = ({ data }) => {
      const msg = JSON.parse(data);
      if (msg.id && this.pending.has(msg.id)) { const { res, rej } = this.pending.get(msg.id); this.pending.delete(msg.id); msg.error ? rej(new Error(msg.error.message)) : res(msg.result); }
      else if (msg.method === 'Runtime.consoleAPICalled') this.console.push(msg.params.args.map(a => a.value ?? a.description).join(' '));
      else if (msg.method === 'Runtime.exceptionThrown') this.errors.push(msg.params.exceptionDetails.exception?.description || msg.params.exceptionDetails.text);
    };
  }
  send(method, params = {}) { const id = ++this.id; this.ws.send(JSON.stringify({ id, method, params })); return new Promise((res, rej) => this.pending.set(id, { res, rej })); }
  async viewport(width, height, { mobile = true, scale = 2 } = {}) {
    await this.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: scale, mobile, screenOrientation: width > height ? { type: 'landscapePrimary', angle: 90 } : { type: 'portraitPrimary', angle: 0 } });
    await this.send('Emulation.setTouchEmulationEnabled', { enabled: mobile, maxTouchPoints: 5 });
  }
  async goto(url) { await this.send('Page.navigate', { url }); await this.waitFor('document.readyState === "complete"', 15000); }
  async eval(expression) {
    const r = await this.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result.value;
  }
  async waitFor(expression, timeout = 10000, interval = 100) {
    const end = Date.now() + timeout;
    while (Date.now() < end) { try { if (await this.eval(expression)) return true; } catch {} await sleep(interval); }
    throw new Error('Timed out waiting for: ' + expression);
  }
  async box(selector) {
    return this.eval(`(() => { const n = document.querySelector(${JSON.stringify(selector)}); if (!n) return null; const r = n.getBoundingClientRect(); return {x:r.x,y:r.y,w:r.width,h:r.height,visible: r.width>0 && r.height>0 && getComputedStyle(n).visibility!=='hidden'}; })()`);
  }
  /** Real touch tap at the centre of a selector (or an explicit point). */
  async tap(selectorOrPoint) {
    let x, y;
    if (typeof selectorOrPoint === 'string') { const b = await this.box(selectorOrPoint); if (!b?.visible) throw new Error('Not tappable: ' + selectorOrPoint); x = b.x + b.w / 2; y = b.y + b.h / 2; }
    else ({ x, y } = selectorOrPoint);
    await this.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
    await this.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await sleep(60);
  }
  async screenshot(file) {
    const { data } = await this.send('Page.captureScreenshot', { format: 'png' });
    await mkdir(path.dirname(file), { recursive: true }); await writeAtomic(file, Buffer.from(data, 'base64'));
    return file;
  }
}
export { sleep };
