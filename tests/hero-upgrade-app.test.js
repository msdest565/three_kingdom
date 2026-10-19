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

function startHeroRun(env){env.click('endless-start');env.click('story-start');env.advance(.1);}
function showHeroChoice(env,id){
  const game=env.api.game,card=game.tacticDefinition(id);assert.ok(card,id);
  game.state='choosing';game.upgrades=[card,...['attr_gate_build','attr_camp_temper'].map(key=>game.tacticDefinition(key))];
  game._emit('choice',{choices:game.upgrades});env.advance(1.2);
  return env.get('upgrade-choices').querySelector('.upgrade-choice');
}

test('hero cards expose four distinct tiers, real descriptions and acquired counts through the public choice UI',()=>{
  const env=boot(),before=env.api.store.exportSave();startHeroRun(env);
  const ids=['guan_yu_press','guan_yu_width','guan_yu_blade_wind','guan_yu_solo'];
  const tiers=['Ⅰ','Ⅱ','Ⅲ','Ⅳ'];
  for(let index=0;index<ids.length;index++){
    const pick=showHeroChoice(env,ids[index]);
    assert.match(pick.textContent,new RegExp(tiers[index]));
    assert.match(pick.textContent,/每局限获一次/);
    assert.match(env.get('choice-copy').textContent,new RegExp('关羽专属 '+index+'/4'));
    pick.click();assert.equal(env.api.game.tacticCounts[ids[index]],1);
  }
  showHeroChoice(env,'attr_gate_earth');
  assert.ok(env.get('choice-copy').textContent.includes('关羽专属 4/4'));
  assert.equal(env.api.store.exportSave(),before);
  assert.equal(env.errors.length,0);env.destroy();
});

test('new legendary solo card carries its live condition and four rarity corners while calm mode keeps the information',()=>{
  const env=boot();env.click('settings-tab');env.click('setting-motion');env.click('campaign-tab');
  startHeroRun(env);showHeroChoice(env,'guan_yu_solo');
  const card=env.get('upgrade-choices').querySelector('.tactic-card');
  assert.equal(card.querySelectorAll('.tactic-corner').length,4);
  assert.match(card.textContent,/单将构筑/);assert.match(card.textContent,/玩法重塑/);
  assert.equal(env.api.renderer.reducedMotion,true);
  assert.equal(env.errors.length,0);env.destroy();
});
