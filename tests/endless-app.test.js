/** Real portable V1 entry tested through mocked DOM events; this is not browser/device QA. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import vm from 'node:vm';
import { SAVE_SCHEMA_VERSION } from '../campaign-state.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SAVE_KEY = 'wushuang-guard-campaign-v2';
let compiled;
let sourceHtml;
function compileCurrentBuild() {
  if (compiled) return;
  execFileSync(process.execPath, ['scripts/build.mjs'], { cwd: root, stdio: 'pipe' });
  const portable = readFileSync(path.join(root, 'dist/index.html'), 'utf8');
  sourceHtml = readFileSync(path.join(root, 'index.html'), 'utf8');
  const script = [...portable.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].at(-1)?.[1];
  assert.ok(script?.includes('class CampaignStore') && script.includes('class V1Game'), 'default portable entry contains the real V1 campaign');
  const observed = script.replace(/\n\}\)\(\);\s*$/, '\nglobalThis.__integration = { store, tutorial, sound, renderer, combatClock, heroNameCards, get game() { return game; }, get mode() { return mode; }, get selectedLevelId() { return selectedLevelId; } };\n})();');
  assert.notEqual(observed, script, 'observation is injected only into the test closure');
  compiled = new vm.Script(observed, { filename: 'portable-campaign.integration.js' });
}

class Events {
  constructor() { this.listeners = new Map(); }
  addEventListener(type, callback) { const list = this.listeners.get(type) ?? []; list.push(callback); this.listeners.set(type, list); }
  removeEventListener(type, callback) { this.listeners.set(type, (this.listeners.get(type) ?? []).filter(fn => fn !== callback)); }
  dispatch(type, event = {}) {
    const payload = { type, target: this, preventDefault() {}, stopPropagation() { this.stopped = true; }, ...event };
    for (const callback of this.listeners.get(type) ?? []) callback(payload);
    return payload;
  }
}

const canvasContext = () => new Proxy({}, {
  get(target, key) {
    if (key in target) return target[key];
    if (key === 'measureText') return text => ({ width: String(text).length * 7 });
    if (key === 'createLinearGradient' || key === 'createRadialGradient') return () => ({ addColorStop() {} });
    return () => {};
  },
  set(target, key, value) { target[key] = value; return true; },
});
const decodeEntities = value => value.replace(/&(?:amp|lt|gt|quot|apos|nbsp);/g, m => ({ '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'", '&nbsp;': ' ' })[m]);
class Element extends Events {
  constructor(tag, attrs = {}) {
    super(); this.tagName = tag.toUpperCase(); this.attrs = { ...attrs }; this.children = []; this.parentElement = null;
    this.hidden = Object.hasOwn(attrs, 'hidden'); this.disabled = Object.hasOwn(attrs, 'disabled');
    this.value = attrs.value ?? ''; this.checked = Object.hasOwn(attrs, 'checked'); this.files = [];
    this.dataset = Object.fromEntries(Object.entries(attrs).filter(([k]) => k.startsWith('data-')).map(([k, v]) => [k.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase()), v]));
    this.style = { setProperty(key, value) { this[key] = value; }, getPropertyValue(key) { return this[key] ?? ''; }, removeProperty(key) { delete this[key]; } };
    this._text = ''; this.tokens = new Set((attrs.class ?? '').split(/\s+/).filter(Boolean));
    this.classList = { add: (...names) => names.forEach(n => this.tokens.add(n)), remove: (...names) => names.forEach(n => this.tokens.delete(n)), contains: name => this.tokens.has(name),
      toggle: (name, force) => { const enabled = force === undefined ? !this.tokens.has(name) : Boolean(force); if (enabled) this.tokens.add(name); else this.tokens.delete(name); return enabled; } };
    if (tag === 'canvas') this._context = canvasContext();
  }
  get id() { return this.attrs.id ?? ''; } set id(value) { this.attrs.id = String(value); }
  get type() { return this.attrs.type ?? ''; } set type(value) { this.attrs.type = String(value); }
  get textContent() { return this._text + this.children.map(c => c.textContent).join(''); }
  set textContent(value) { this.replaceChildren(); this._text = String(value); }
  get innerHTML() { return this.textContent; }
  set innerHTML(value) { this.replaceChildren(); parseInto(this, String(value)); }
  get className() { return [...this.tokens].join(' '); } set className(value) { this.tokens = new Set(String(value).split(/\s+/).filter(Boolean)); }
  setAttribute(key, value) { this.attrs[key] = String(value); if (key === 'class') this.className = value; }
  getAttribute(key) { return this.attrs[key] ?? null; }
  removeAttribute(key) { delete this.attrs[key]; }
  append(...children) { for (let child of children) { if (typeof child === 'string') { const node = new Element('#text'); node._text = child; child = node; } child.parentElement = this; this.children.push(child); } }
  appendChild(child) { this.append(child); return child; }
  replaceChildren(...children) { for (const old of this.children) old.parentElement = null; this.children = []; this._text = ''; this.append(...children); }
  remove() { if (this.parentElement) this.parentElement.children = this.parentElement.children.filter(child => child !== this); this.parentElement = null; }
  contains(node) { return node === this || this.children.some(child => child.contains(node)); }
  matches(selector) {
    const attribute = selector.match(/\[([\w-]+)(?:=['"]?([^'"\]]+)['"]?)?\]/);
    if (attribute) {
      const value = this.getAttribute(attribute[1]) ?? (attribute[1] === 'type' ? this.type : null);
      if (value === null || attribute[2] && value !== attribute[2]) return false;
      selector = selector.replace(attribute[0], '');
    }
    const id = selector.match(/#([\w-]+)/), classes = [...selector.matchAll(/\.([\w-]+)/g)].map(m => m[1]);
    const tag = selector.match(/^[\w-]+/)?.[0];
    return (!tag || this.tagName.toLowerCase() === tag) && (!id || this.id === id[1]) && classes.every(c => this.tokens.has(c));
  }
  querySelectorAll(selector) {
    const selectors = selector.split(',').map(s => s.trim().split(/\s+/).at(-1));
    const all = [];
    for (const child of this.children) { if (selectors.some(s => child.matches(s))) all.push(child); all.push(...child.querySelectorAll(selector)); }
    return all;
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] ?? null; }
  closest(selector) { for (let node = this; node; node = node.parentElement) if (node.matches(selector)) return node; return null; }
  click() {
    if (this.disabled || !visible(this)) return;
    if (this.type === 'checkbox') this.checked = !this.checked;
    const event = { target: this };
    for (let node = this; node; node = node.parentElement) if (node.dispatch('click', event).stopped) break;
  }
  focus() {} select() {} scrollIntoView() {} scrollTo() {}
  getContext() { return this._context; }
  getBoundingClientRect() { return { width: 390, height: 480, left: 0, top: 100, right: 390, bottom: 580 }; }
}
function parseInto(top, html) {
  const stack = [top], voidTags = new Set(['meta', 'link', 'br', 'hr', 'img', 'input']);
  for (const token of html.matchAll(/<!--[\s\S]*?-->|<\/?[a-zA-Z][^>]*>|[^<]+/g)) {
    const raw = token[0];
    if (raw.startsWith('<!--') || raw.startsWith('<!')) continue;
    if (!raw.startsWith('<')) { const text = new Element('#text'); text._text = decodeEntities(raw); stack.at(-1).append(text); continue; }
    const tag = raw.match(/^<\/?([\w-]+)/)?.[1].toLowerCase(); if (!tag) continue;
    if (raw.startsWith('</')) { while (stack.length > 1) if (stack.pop().tagName.toLowerCase() === tag) break; continue; }
    const attrs = {};
    for (const attr of raw.slice(tag.length + 1, -1).matchAll(/([\w:-]+)(?:=(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g)) attrs[attr[1]] = decodeEntities(attr[2] ?? attr[3] ?? attr[4] ?? '');
    const element = new Element(tag, attrs); stack.at(-1).append(element);
    if (!voidTags.has(tag) && !raw.endsWith('/>')) stack.push(element);
  }
}
function visible(element) { for (let node = element; node; node = node.parentElement) if (node.hidden) return false; return true; }
function createDocument() {
  const document = new Events(), top = new Element('document'); parseInto(top, sourceHtml);
  document.hidden = false; document.body = top.querySelector('body');
  document.getElementById = id => top.querySelector('#' + id);
  document.querySelector = selector => top.querySelector(selector); document.querySelectorAll = selector => top.querySelectorAll(selector);
  document.createElement = tag => new Element(tag); document.createElementNS = (_, tag) => new Element(tag);
  document.createTextNode = text => { const element = new Element('#text'); element._text = String(text); return element; };
  return { document, top };
}

class Param {
  constructor(value = 0) { this.value = value; }
  setValueAtTime(value) { this.value = value; } linearRampToValueAtTime(value) { this.value = value; }
  exponentialRampToValueAtTime(value) { this.value = value; } cancelScheduledValues() {}
}
class AudioNode {
  constructor(context) {
    this.context = context; this.links = new Set(); this.gain = new Param(1); this.frequency = new Param(440);
    this.pan = new Param(); this.Q = new Param(); this.stopAt = Infinity;
    for (const key of ['threshold', 'knee', 'ratio', 'attack', 'release']) this[key] = new Param();
  }
  connect(node) { this.links.add(node); } disconnect() { this.links.clear(); }
  start() { this.context.sources.add(this); }
  stop(at = this.context.currentTime) { this.stopAt = at; if (at <= this.context.currentTime) this.end(); }
  end() { this.context.sources.delete(this); this.onended?.(); }
}
class MockAudioContext {
  constructor() { this.state = 'suspended'; this.currentTime = 0; this.sampleRate = 2000; this.sources = new Set(); this.destination = {}; }
  createGain() { return new AudioNode(this); } createOscillator() { return new AudioNode(this); }
  createBufferSource() { return new AudioNode(this); } createBiquadFilter() { return new AudioNode(this); }
  createStereoPanner() { return new AudioNode(this); } createDynamicsCompressor() { return new AudioNode(this); }
  createBuffer(channels, length) { const data = Array.from({ length: channels }, () => new Float32Array(length)); return { getChannelData: channel => data[channel] }; }
  resume() { this.state = 'running'; return Promise.resolve(); } suspend() { this.state = 'suspended'; return Promise.resolve(); }
  close() { this.state = 'closed'; return Promise.resolve(); }
  advance(seconds) { if (this.state !== 'running') return; this.currentTime += seconds; for (const source of [...this.sources]) if (source.stopAt <= this.currentTime) source.end(); }
}

function boot({ storage = new Map(), unavailableStorage = false } = {}) {
  compileCurrentBuild();
  const { document, top } = createDocument(), window = new Events();
  window.devicePixelRatio = 1; window.matchMedia = () => Object.assign(new Events(), { matches: false });
  let now = 0, nextTimer = 1; const timers = new Map(), rafs = [], errors = [], audioContexts = [], downloads = [];
  const localStorage = { getItem: key => { if (unavailableStorage) throw new Error('Storage denied'); return storage.get(key) ?? null; },
    setItem: (key, value) => { if (unavailableStorage) throw new Error('Storage denied'); storage.set(key, String(value)); },
    removeItem: key => { if (unavailableStorage) throw new Error('Storage denied'); storage.delete(key); } };
  const context = vm.createContext({ document, window, localStorage,
    AudioContext: class extends MockAudioContext { constructor() { super(); audioContexts.push(this); } },
    performance: { now: () => now }, structuredClone, Blob, TextEncoder, URL: { createObjectURL: blob => { downloads.push(blob); return `blob:mock-${downloads.length}`; }, revokeObjectURL() {} },
    navigator: { clipboard: { writeText: async () => {} } }, console: { error: error => errors.push(error), log() {}, warn() {} },
    requestAnimationFrame: callback => { rafs.push(callback); return rafs.length; }, cancelAnimationFrame() {},
    setTimeout: (callback, ms) => { const id = nextTimer++; timers.set(id, { callback, at: now + ms }); return id; }, clearTimeout: id => timers.delete(id),
  });
  compiled.runInContext(context, { timeout: 5000 });
  const api = context.__integration;
  const get = id => { const element = document.getElementById(id); assert.ok(element, `DOM contains #${id}`); return element; };
  const click = id => { const element = get(id); assert.ok(visible(element), `#${id} is visible`); element.click(); };
  const clickText = (text, scope = top) => {
    const buttons = scope.querySelectorAll('button').filter(b => visible(b) && (typeof text === 'string' ? b.textContent.includes(text) : text.test(b.textContent)));
    assert.ok(buttons.length, `Visible button matching ${String(text)}; available: ${scope.querySelectorAll('button').filter(visible).map(b => b.textContent.trim()).join(' | ')}`);
    const button = buttons.find(b => !b.disabled) ?? buttons[0]; button.click(); return button;
  };
  const advance = (seconds, step = 0.05) => {
    for (let remaining = seconds; remaining > 1e-8;) {
      const delta = Math.min(step, remaining); remaining -= delta; now += delta * 1000;
      for (const audio of audioContexts) audio.advance(delta);
      for (const [id, timer] of [...timers]) if (timer.at <= now) { timers.delete(id); timer.callback(); }
      const callbacks = rafs.splice(0); assert.equal(callbacks.length, 1, 'one RAF chain'); callbacks[0](now);
      assert.equal(get('fatal-message').hidden, true, errors.map(e => e?.stack ?? String(e)).join('\n'));
    }
  };
  const flush = () => new Promise(resolve => setImmediate(resolve));
  return { api, get, document, top, window, storage, errors, audioContexts, downloads, click, clickText, advance, flush,
    saved: () => JSON.parse(storage.get(SAVE_KEY) ?? 'null'), destroy: () => api.sound.destroy() };
}

// The portable-app harness above is copied so existing tests and assertions stay untouched.
function startEndless(env) {
  env.click('endless-start');
  if (!env.get('story-overlay').hidden) env.click('story-start');
  env.advance(.1);
  assert.equal(env.api.game.mode, 'endless');
}
function clearWave(env) {
  const game = env.api.game;
  game.enemies = []; game._spawnQueue = []; game._spawnIndex = 0; game._casts = []; game.skillQueue = [];
  for (const hero of game.heroes) { hero.casting = false; hero.castingRemaining = 0; }
  env.advance(.1); env.advance(1.1);
  assert.equal(game.state, 'choosing');
}

test('public endless entry uses the actual party and leaves campaign progress, resources and reward ledgers unchanged', () => {
  const env=boot();
  const before=env.api.store.exportSave();
  startEndless(env);
  assert.equal(env.api.game.map.id,'wei_gate');
  assert.equal(env.api.game.waveCount,80);
  assert.equal(env.api.game.heroes[0].id,env.api.store.state.party.lead);
  assert.equal(env.api.store.exportSave(),before);
  clearWave(env);
  assert.equal(env.get('upgrade-choices').querySelectorAll('.upgrade-choice').length,3);
  assert.match(env.get('choice-reroll').textContent,/40/);
  assert.equal(env.api.store.exportSave(),before);
  env.destroy();
});

test('public draft controls lock across a reroll, spend local food, skip for 25 and freeze battle time', () => {
  const env=boot(); startEndless(env); clearWave(env);
  const game=env.api.game; game.food=1000;
  const time=game.time;
  env.advance(.1);
  const lock=env.get('upgrade-choices').querySelector('.tactic-lock');
  assert.ok(lock); lock.click();
  const locked=game.lockedTacticId;
  assert.ok(locked); assert.equal(game.locksRemaining,2);
  env.click('choice-reroll'); env.advance(1.2);
  assert.equal(game.rerollCount,1); assert.equal(game.food,960);
  assert.ok(game.upgrades.some(card=>card.id===locked));
  assert.equal(game.time,time);
  env.click('choice-skip');
  assert.equal(game.food,985); assert.equal(game.state,'playing');
  assert.equal(game.lockedTacticId,locked);
  env.destroy();
});

test('endless defeat and retry never settle a story reward or create a campaign battle receipt', () => {
  const env=boot(); const before=env.api.store.exportSave(); startEndless(env);
  env.api.game._finish('lost'); env.advance(.1);
  assert.match(env.get('result-title').textContent,/城破|结束|守|挑战/);
  assert.equal(env.api.store.exportSave(),before);
  env.advance(2);
  assert.equal(env.get('next-level').dataset.action,'endless-retry');
  env.click('next-level'); env.click('story-start'); env.advance(.1);
  assert.equal(env.api.game.mode,'endless');
  assert.equal(env.api.game.wave,1);
  assert.equal(env.api.store.exportSave(),before);
  assert.equal(env.errors.length,0);
  env.destroy();
});

test('a future-schema read-only account cannot enter endless or overwrite the original save', () => {
  const raw=JSON.stringify({schemaVersion:SAVE_SCHEMA_VERSION+1,future:true});
  const storage=new Map([[SAVE_KEY,raw]]),env=boot({storage});
  assert.equal(env.api.store.readOnly,true);
  assert.equal(env.get('endless-start').disabled,true);
  env.get('endless-start').click();
  assert.equal(env.api.game,null); assert.equal(storage.get(SAVE_KEY),raw);
  env.destroy();
});
