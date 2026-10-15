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
  const observed = script.replace(/\n\}\)\(\);\s*$/, '\nglobalThis.__integration = { store, tutorial, sound, renderer, combatClock, get game() { return game; }, get mode() { return mode; }, get selectedLevelId() { return selectedLevelId; } };\n})();');
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

function openWeaponPicker(env) {
  env.click('hero-gear-weapon');
  env.clickText('换装', env.get('hero-gear-popover'));
}

function selectIdleInventoryItem(env) {
  const card = env.get('inventory-list').querySelectorAll('.equipment-card').find(node => /闲置未穿戴/.test(node.getAttribute('aria-label')));
  assert.ok(card, 'bag contains an idle item'); card.click(); return card;
}

test('default portable entry opens the campaign; every chapter and locked level supports honest preview', () => {
  const env = boot();
  assert.equal(env.api.mode, 'lobby'); assert.equal(env.api.game, null);
  assert.equal(env.audioContexts.length, 0, 'no autoplay before a gesture');
  // The home shows only the selected level and next stop; the full route stays one tap away.
  assert.equal(env.get('route-sheet').hidden, true);
  assert.equal(env.get('focus-nodes').querySelectorAll('.focus-node').length, 2);
  assert.equal(env.get('focus-nodes').querySelectorAll('.focus-node.is-selected').length, 1);
  assert.equal(env.get('focus-nodes').querySelectorAll('.focus-node.is-next').length, 1);
  assert.equal(env.get('focus-route').querySelectorAll('path').length, 2);
  env.click('route-button'); assert.equal(env.get('route-sheet').hidden, false);
  assert.equal(env.get('chapter-body').hidden, false);
  assert.equal(env.get('level-grid').querySelectorAll('button').length, 20);
  assert.equal(env.get('march-route').querySelectorAll('path').length, 2, 'cleared route and remaining route');
  assert.equal(env.get('level-grid').querySelectorAll('button').filter(b => b.classList.contains('is-current')).length, 1);
  env.click('route-close');
  // Pre-battle intel opens as a sheet (long-press on touch; the hidden 情报 button keeps it keyboard reachable).
  assert.equal(env.get('level-intel').hidden, true); env.click('intel-button');
  assert.equal(env.get('level-intel').hidden, false); assert.match(env.get('intel-title').textContent, /乡野初阵/);
  env.click('intel-close'); assert.equal(env.get('level-intel').hidden, true);
  assert.equal(env.get('chapter-tabs').querySelectorAll('button').length, 3);
  assert.equal(env.get('hero-roster').querySelectorAll('button').length, 15);
  assert.match(env.get('campaign-progress').textContent, /0 \/ 60/);
  env.click('route-button');
  env.clickText('蜀篇', env.get('chapter-tabs'));
  assert.equal(env.api.selectedLevelId, 'shu_001'); assert.equal(env.get('campaign-start').disabled, true);
  assert.equal(env.get('map-preview').querySelectorAll('path').length, 2);
  env.get('level-grid').querySelectorAll('button').at(-1).click();
  assert.equal(env.api.selectedLevelId, 'shu_020'); assert.equal(env.get('campaign-start').disabled, true);
  assert.equal(env.get('route-sheet').hidden, true, 'choosing a full-route node returns to the campaign home');
  assert.match(env.get('selected-level-name').textContent, new RegExp(env.api.store.getLevel('shu_020').name));
  assert.equal(env.get('focus-nodes').querySelectorAll('.focus-node').length, 1, 'the final level has no invented next node');
  env.click('campaign-start'); assert.equal(env.api.game, null, 'locked preview cannot enter a battle');
  env.click('route-button');
  env.clickText('吴篇', env.get('chapter-tabs')); assert.equal(env.api.selectedLevelId, 'wu_001');
  env.clickText('魏篇', env.get('chapter-tabs')); assert.equal(env.api.selectedLevelId, 'wei_001');
  assert.equal(env.get('campaign-start').disabled, false);
  env.click('route-close');
  env.click('heroes-tab'); assert.equal(env.get('heroes-screen').hidden, false); assert.equal(env.get('campaign-screen').hidden, true);
  env.clickText('太史慈', env.get('hero-roster'));
  assert.match(env.get('toast').textContent, /解锁/); assert.equal(env.get('lobby-modal').hidden, true);
  env.destroy();
});

test('hero detail uses owned equipment and resource gates; the party picker changes the actual lead and reloads', () => {
  const storage = new Map(), env = boot({ storage });
  env.click('heroes-tab'); env.clickText('关羽', env.get('hero-roster'));
  assert.match(env.get('modal-title').textContent, /关羽/);
  assert.equal(env.get('lobby-modal').classList.contains('is-page'), true, 'hero detail reuses the modal as a full page');
  assert.equal(env.get('modal-body').querySelectorAll('.gear-row').length, 4);
  assert.match(env.get('modal-body').textContent, /城关最大耐久/);
  const training = env.get('modal-body').querySelectorAll('.training-action');
  assert.equal(training.length, 2); assert.ok(training.every(b => b.disabled), 'zero starting resources cannot buy training');
  const before = env.api.store.exportSave(); training[0].click(); assert.equal(env.api.store.exportSave(), before);
  env.click('modal-close'); env.click('campaign-tab');
  env.get('party-slots').querySelectorAll('button')[0].click();
  assert.match(env.get('modal-title').textContent, /选择领衔/);
  env.clickText('曹操', env.get('modal-body'));
  assert.equal(env.api.store.state.party.lead, 'cao_cao'); assert.equal(env.get('lobby-modal').hidden, true);
  assert.match(env.get('party-slots').textContent, /曹操/);
  assert.equal(env.saved().party.lead, 'cao_cao');
  env.destroy();
  const restored = boot({ storage }); assert.equal(restored.api.store.state.party.lead, 'cao_cao'); restored.destroy();
});

test('focus and full-route long presses reveal the requested intel and suppress their trailing click', () => {
  const env = boot();
  const current = env.get('focus-nodes').querySelector('.focus-node.is-selected');
  env.get('focus-map').dispatch('pointerdown', { target: current, button: 0, clientX: 60, clientY: 80 });
  env.advance(.44); assert.equal(env.get('level-intel').hidden, true);
  env.advance(.02); assert.equal(env.get('level-intel').hidden, false);
  assert.match(env.get('intel-title').textContent, /乡野初阵/);
  env.click('intel-close'); current.click();
  assert.equal(env.get('level-intel').hidden, true, 'the click produced after a long press is suppressed');
  env.advance(.75); env.click('route-button');
  const target = env.get('level-grid').querySelectorAll('button')[2];
  env.get('level-grid').dispatch('pointerdown', { target, button: 0, clientX: 100, clientY: 100 });
  env.advance(.2); env.get('level-grid').dispatch('pointermove', { target, clientX: 130, clientY: 100 });
  env.advance(.3); assert.equal(env.get('level-intel').hidden, true, 'scrolling a route cancels the pending long press');
  env.get('level-grid').dispatch('pointerdown', { target, button: 0, clientX: 100, clientY: 100 });
  env.advance(.46); assert.equal(env.get('level-intel').hidden, false);
  assert.match(env.get('intel-title').textContent, new RegExp(env.api.store.getLevel('wei_003').name));
  assert.equal(env.api.selectedLevelId, 'wei_003');
  assert.equal(env.get('campaign-start').disabled, true, 'a locked level remains a preview after opening its intel');
  assert.equal(env.errors.length, 0); env.destroy();
});

test('inventory filter badges count the full bag and every equipment tile announces its quality, level and owner', () => {
  const env = boot();
  const supplied = JSON.parse(env.api.store.exportSave());
  supplied.inventory.push({ itemInstanceId: 'test-idle-blue', templateId: 'basic_weapon', slot: 'weapon', quality: 'blue', level: 2, equippedHeroId: null });
  assert.equal(env.api.store.importSave(JSON.stringify(supplied)).ok, true);
  env.click('workshop-tab'); env.click('ws-tab-bag');
  const expected = { all: 9, weapon: 3, armor: 2, command_token: 2, horse: 2 };
  for (const [slot, count] of Object.entries(expected)) {
    const filter = env.get('inventory-filters').querySelector(`[data-slot="${slot}"]`);
    assert.ok(filter, `filter for ${slot}`);
    assert.equal(filter.querySelector('.filter-count').textContent, String(count));
    filter.click();
    assert.equal(env.get('inventory-list').querySelectorAll('.equipment-card').length, count);
    assert.equal(env.get('inventory-filters').querySelector(`[data-slot="${slot}"]`).getAttribute('aria-pressed'), 'true');
  }
  env.get('inventory-filters').querySelector('[data-slot="all"]').click();
  for (const tile of env.get('inventory-list').querySelectorAll('.gear-tile')) {
    assert.equal(tile.getAttribute('role'), 'img');
    assert.match(tile.getAttribute('aria-label'), /百炼兵刃|精工战甲|军令兵符|军府良驹/);
    assert.match(tile.getAttribute('aria-label'), /白色|蓝色/);
    assert.match(tile.getAttribute('aria-label'), /强化等级 [02]/);
    assert.match(tile.getAttribute('aria-label'), /关羽穿戴中|曹操穿戴中|闲置未穿戴/);
  }
  assert.match(env.get('inventory-meta').textContent, /9 件.*闲置 1/);
  const idle = env.get('inventory-list').querySelectorAll('.equipment-card').find(card => /闲置未穿戴/.test(card.querySelector('.gear-tile').getAttribute('aria-label')));
  idle.click();
  assert.equal(env.get('inventory-detail').querySelectorAll('.salvage-button').length, 1);
  assert.equal(env.get('inventory-detail').querySelector('.gear-tile').classList.contains('gear-tile-56'), true);
  env.click('loot-rates-button');
  assert.match(env.get('modal-body').textContent, /白 45%.*蓝 30%.*紫 17.5%.*红 5%.*金 2.5%/);
  assert.equal(env.errors.length, 0); env.destroy();
});

test('one-click equipment UI reports partial strengthening and disables only when every slot is maxed', () => {
  const env = boot(), supplied = JSON.parse(env.api.store.exportSave());
  supplied.settings.reducedMotion = true;
  supplied.resources = { experience_book: 0, copper_coin: 100000, refined_iron: 10000 };
  const levels = { weapon: 3, armor: 0, command_token: 2, horse: 1 };
  for (const item of supplied.inventory.filter(item => item.equippedHeroId === 'guan_yu')) item.level = levels[item.slot];
  assert.equal(env.api.store.importSave(JSON.stringify(supplied)).ok, true);
  const slots = Object.keys(levels), costs = slots.map(slot => ({ slot, ...env.api.store.getEquipmentUpgradeCost('guan_yu', slot) })).sort((a, b) => a.cost.copper_coin - b.cost.copper_coin);
  env.api.store.state.resources.copper_coin = costs[0].cost.copper_coin + costs[1].cost.copper_coin - 1;
  env.click('heroes-tab'); env.clickText('关羽', env.get('hero-roster'));
  const coins = env.api.store.state.resources.copper_coin, iron = env.api.store.state.resources.refined_iron, power = Number(env.get('hero-power').textContent.replace(/\D/g, ''));
  assert.match(env.get('hero-upgrade-all').getAttribute('aria-label'), /可强化 4 格/);
  env.click('hero-upgrade-all');
  assert.match(env.get('toast').textContent, /已强化 1 \/ 4 格/);
  assert.equal(env.api.store.state.resources.copper_coin, coins - costs[0].cost.copper_coin);
  assert.equal(env.api.store.state.resources.refined_iron, iron - costs[0].cost.refined_iron);
  for (const slot of slots) assert.equal(env.api.store.getHero('guan_yu').equipment[slot].level, levels[slot] + (slot === costs[0].slot ? 1 : 0));
  assert.ok(Number(env.get('hero-power').textContent.replace(/\D/g, '')) > power);
  env.click('modal-close'); env.click('campaign-tab');
  const homePower = Number(env.get('party-power').textContent.replace(/\D/g, ''));
  env.click('heroes-tab'); env.clickText('关羽', env.get('hero-roster'));
  assert.equal(Number(env.get('hero-power').textContent.replace(/\D/g, '')), homePower, 'home and detail share the same display power at the one-hero stage');
  env.click('modal-close');
  const maxed = JSON.parse(env.api.store.exportSave());
  for (const item of maxed.inventory.filter(item => item.equippedHeroId === 'guan_yu')) item.level = 10;
  assert.equal(env.api.store.importSave(JSON.stringify(maxed)).ok, true);
  env.clickText('关羽', env.get('hero-roster'));
  assert.equal(env.get('hero-upgrade-all').disabled, true);
  assert.match(env.get('hero-upgrade-all').textContent, /已满级/);
  const before = env.api.store.exportSave(); env.get('hero-upgrade-all').click();
  assert.equal(env.api.store.exportSave(), before); assert.equal(env.errors.length, 0); env.destroy();
});

test('settings affect real audio, speed and motion and remain after reloading the campaign save', async () => {
  const storage = new Map(), env = boot({ storage });
  env.click('settings-tab'); env.click('setting-music'); env.click('setting-sfx');
  env.click('setting-speed'); env.click('setting-speed'); env.click('setting-motion'); await env.flush();
  assert.equal(env.api.store.state.settings.speed, 2); assert.equal(env.api.sound.musicEnabled, false); assert.equal(env.api.sound.sfxEnabled, false);
  assert.equal(env.api.renderer.reducedMotion, true); assert.match(env.get('setting-speed').textContent, /2×/);
  assert.equal(env.get('setting-music').getAttribute('aria-pressed'), 'false');
  assert.equal(env.saved().settings.speed, 2); env.destroy();
  const restored = boot({ storage });
  assert.equal(restored.api.store.state.settings.speed, 2); assert.equal(restored.api.sound.musicEnabled, false);
  assert.equal(restored.api.sound.sfxEnabled, false); assert.equal(restored.api.renderer.reducedMotion, true); restored.destroy();
});

test('export is usable JSON; invalid imports do not overwrite and valid preview requires explicit unchanged-text confirmation', async () => {
  const env = boot(); env.click('settings-tab'); env.click('setting-music'); env.click('save-export');
  const exported = env.get('modal-body').querySelector('textarea').value;
  assert.equal(JSON.parse(exported).schemaVersion, SAVE_SCHEMA_VERSION); assert.equal(JSON.parse(exported).settings.musicEnabled, false);
  env.clickText('下载存档', env.get('modal-body'));
  assert.equal(env.downloads.length, 1); assert.equal(await env.downloads[0].text(), exported);
  env.click('modal-close'); env.click('setting-music'); env.click('save-import');
  const body = env.get('modal-body'), input = body.querySelector('textarea');
  const confirm = body.querySelectorAll('button').find(b => b.textContent.includes('确认替换'));
  const before = env.api.store.exportSave();
  for (const bad of ['{broken', JSON.stringify({ schemaVersion: 999 })]) {
    input.value = bad; input.dispatch('input'); env.clickText('检查存档内容', body);
    assert.equal(confirm.disabled, true); assert.equal(env.api.store.exportSave(), before);
    confirm.click(); assert.equal(env.api.store.exportSave(), before);
  }
  input.value = exported; input.dispatch('input'); env.clickText('检查存档内容', body);
  assert.equal(confirm.disabled, false); assert.equal(env.api.store.state.settings.musicEnabled, true, 'preview does not import');
  assert.match(body.querySelector('.import-preview').textContent, /2 名武将/);
  input.value += ' '; input.dispatch('input'); assert.equal(confirm.disabled, true, 'editing invalidates checked preview');
  env.clickText('检查存档内容', body); confirm.click();
  assert.equal(env.get('lobby-modal').hidden, true); assert.equal(env.api.store.state.settings.musicEnabled, false);
  assert.match(env.get('toast').textContent, /存档已导入/); env.destroy();
});

test('Wei 1 story, real camp deployment and first ultimate complete the event-driven guide and restore preferred speed', async () => {
  const env = boot(); env.click('settings-tab'); env.click('setting-speed'); env.click('setting-speed'); env.click('campaign-tab');
  env.click('campaign-start'); await env.flush();
  assert.equal(env.api.mode, 'battle'); assert.equal(env.api.game.level.id, 'wei_001'); assert.equal(env.api.game.state, 'ready');
  assert.equal(env.get('story-overlay').hidden, false); assert.ok(env.get('story-lines').querySelectorAll('p').length > 0);
  env.advance(1); assert.equal(env.api.game.time, 0);
  // First run: the story sheet carries the goal, so one tap lands on the deploy step (no separate intro card).
  assert.match(env.get('story-lines').textContent, /守住下方城关/); assert.equal(env.get('story-start').textContent, '布阵迎敌');
  env.click('story-start'); assert.equal(env.api.tutorial.step, 'deploy'); assert.equal(env.get('speed-button').textContent, '1×');
  assert.equal(env.get('speed-button').disabled, true); env.advance(1); assert.equal(env.api.game.time, 0);
  assert.equal(env.get('tutorial-card').dataset.step, 'deploy', 'coach is anchored at the bottom, away from enemy entries');
  env.click('tutorial-action');
  assert.equal(env.get('camp-panel').hidden, false); assert.equal(env.get('tutorial-card').hidden, true);
  const initialFood = env.api.game.food, initialCamps = env.api.game.camps.length;
  assert.equal(env.get('camp-options').querySelectorAll('button').length, 2, 'only unlocked shield and archer camps appear');
  env.clickText('弓营', env.get('camp-options'));
  assert.equal(env.api.game.camps.length, initialCamps + 1); assert.equal(env.api.game.food, initialFood - 60);
  assert.equal(env.api.tutorial.step, 'gather'); assert.equal(env.get('camp-panel').hidden, true);
  for (let i = 0; i < 500 && env.api.tutorial.step === 'gather'; i++) env.advance(0.1);
  assert.equal(env.api.tutorial.step, 'ultimate'); assert.ok(env.api.game.enemies.length > 0);
  const readyTime = env.api.game.time; env.advance(2); assert.equal(env.api.game.time, readyTime);
  env.clickText('关羽', env.get('lead-command')); assert.equal(env.api.tutorial.step, 'burst'); assert.equal(env.api.game.stats.ultimateCasts, 1);
  assert.equal(env.get('tutorial-card').hidden, true, 'nothing covers the sweep while it plays');
  env.advance(1.2); assert.equal(env.api.tutorial.step, 'complete'); assert.ok(env.api.tutorial.burstKills > 0);
  assert.match(env.get('burst-number').textContent, /关羽.*击破/);
  // Design change: the completion line no longer freezes combat (it was a third consecutive pause).
  const finishTime = env.api.game.time; env.advance(1); assert.ok(env.api.game.time > finishTime, 'combat continues under the completion line');
  env.click('tutorial-action'); assert.equal(env.api.tutorial.step, 'off');
  assert.equal(env.saved().settings.tutorialCompleted, true); assert.equal(env.saved().settings.tutorialVersion, 1);
  assert.equal(env.get('speed-button').textContent, '2×'); assert.equal(env.get('speed-button').disabled, false);
  const afterGuide = env.api.game.time; env.advance(0.5); assert.ok(Math.abs(env.api.game.time - afterGuide - 1) < 1 / 60, 'preferred 2× restored');
  const events = JSON.parse(env.storage.get('wushuang-guard-telemetry-v1'));
  for (const type of ['first_interactive','battle_entry','first_deploy','first_ultimate','tutorial_complete']) assert.ok(events.some(e => e.type === type), `telemetry records ${type}`);
  assert.equal(env.errors.length, 0); env.destroy();
});

test('compact support avatars stay separate from the lead row and burst feedback reports only real kills', () => {
  const env = boot(); startUnguided(env);
  assert.equal(env.get('hero-commands').children.length, Math.max(0, env.api.game.heroes.length - 1));
  assert.equal(env.get('lead-command').children.length, 1);
  assert.equal(env.get('hero-commands').parentElement.classList.contains('field-stage'), true, 'avatars overlay the full-width stage');
  const lead = env.api.game.heroes[0], leadButton = env.get('lead-command').querySelector('button');
  lead.rage = 50; env.advance(0.05);
  assert.equal(leadButton.disabled, true); assert.equal(leadButton.classList.contains('is-ready'), false);
  env.api.renderer.reducedMotion = true;
  env.api.game.onEvent({ type:'ultimate',heroId:lead.id });
  assert.equal(env.api.combatClock.impactRemaining, 0, 'reduced motion disables gameplay slow motion too');
  env.api.renderer.reducedMotion = false;
  env.api.game.onEvent({ type:'ultimate',heroId:lead.id });
  assert.equal(env.api.combatClock.impactRemaining, 0.35, 'an actual skill execution begins the slow motion');
  env.api.combatClock.clearImpact();
  env.api.game.onEvent({ type:'burst',heroId:lead.id,burstKills:0 });
  assert.equal(env.get('burst-number').textContent, lead.definition.ultimate.name);
  assert.doesNotMatch(env.get('burst-number').textContent, /击破\s*0/);
  assert.equal(env.get('burst-kills').hidden, true);
  env.api.game.onEvent({ type:'burst',heroId:lead.id,burstKills:3 });
  assert.match(env.get('burst-number').textContent, /击破 3/);
  assert.equal(env.get('burst-kills').textContent, '3'); assert.equal(env.get('burst-kills').hidden, false);
  assert.equal(env.api.combatClock.impactRemaining, 0, 'burst result emphasis does not start a second slow motion');
  env.destroy();
});

test('two-hero battle keeps Cao Cao in the corner avatar group and queued clicks preserve rage', () => {
  const storage = new Map(); let env = boot({ storage });
  for (const levelId of ['wei_001','wei_002','wei_003']) {
    const result = env.api.store.settleBattle({ battleId:env.api.store.createBattleId(),levelId,won:true,hp:100,maxHp:100,kills:0,bestBurst:0,time:1,casts:0 });
    assert.equal(result.ok, true, `settle ${levelId}`);
  }
  assert.ok(env.api.store.getHero('cao_cao'));
  assert.equal(env.api.store.setParty(['guan_yu','cao_cao']).ok, true);
  env.destroy(); env = boot({ storage }); startUnguided(env);
  const game = env.api.game, lead = game.heroes[0], support = game.heroes[1];
  assert.equal(support.id, 'cao_cao');
  const leadButton = env.get('lead-command').querySelector('button');
  const supportButton = env.get('hero-commands').querySelector('button');
  assert.equal(leadButton.parentElement.id, 'lead-command');
  assert.equal(supportButton.parentElement.id, 'hero-commands');
  assert.match(supportButton.getAttribute('aria-label'), /曹操/);
  assert.equal(supportButton.parentElement.parentElement.classList.contains('field-stage'), true);
  lead.rage = 100; support.rage = 100; env.advance(0.1);
  assert.equal(leadButton.disabled, false, JSON.stringify({state:game.state,rage:lead.rage,recovery:lead.rageRecovery,reserved:lead.reserved})); assert.equal(leadButton.classList.contains('is-ready'), true);
  assert.equal(supportButton.disabled, false, JSON.stringify({state:game.state,rage:support.rage,recovery:support.rageRecovery,reserved:support.reserved})); assert.equal(supportButton.classList.contains('is-ready'), true);
  leadButton.click();
  assert.equal(game.heroes[0].rage, 0); assert.equal(env.api.combatClock.impactRemaining, 0.35, 'a real player cast starts wall-clock slow motion');
  env.api.combatClock.clearImpact(); supportButton.click();
  assert.equal(support.reserved, true); assert.equal(support.rage, 100); assert.equal(game.stats.queuedSkills, 2);
  supportButton.click();
  assert.equal(support.rage, 100); assert.equal(game.stats.queuedSkills, 2, 'disabled queued skill cannot consume rage twice');
  assert.equal(env.api.combatClock.impactRemaining, 0, 'waiting in the queue does not trigger slow motion');
  env.destroy();
});

function startUnguided(env) {
  env.click('campaign-start'); env.click('story-skip'); if (env.api.tutorial.active) env.click('tutorial-skip');
}

function finishChoiceWave(env) {
  const game = env.api.game;
  game.wave = game.level.choiceAfterWaves[0]; game._between = 0;
  game.enemies = []; game._spawnQueue = []; game._spawnIndex = 0;
  game.update(1 / 60);
  assert.equal(game.state, 'choosing');
}

test('upgrade choice waits one visible real second at every player speed while combat remains frozen', () => {
  for (const speed of [1, 1.5, 2]) {
    const env = boot(); startUnguided(env); env.api.store.setSetting('speed', speed);
    finishChoiceWave(env); const before = env.api.game.time;
    env.advance(.9);
    assert.equal(env.get('choice-overlay').hidden, true, `${speed}x cannot reveal early`);
    assert.equal(env.get('upgrade-choices').children.length, 0, 'no hidden interactive upgrade cards during the viewing interval');
    assert.equal(env.api.game.time, before); assert.equal(env.api.game.wave, env.api.game.level.choiceAfterWaves[0]);
    env.advance(.15);
    assert.equal(env.get('choice-overlay').hidden, false); assert.equal(env.get('upgrade-choices').children.length, 3);
    assert.equal(env.api.game.time, before);
    env.clickText(env.api.game.upgrades[0].name, env.get('upgrade-choices'));
    assert.equal(env.api.game.state, 'playing'); assert.equal(env.get('choice-overlay').hidden, true);
    assert.equal(env.errors.length, 0); env.destroy();
  }
});

test('backgrounding during upgrade reveal preserves the remaining viewing time without catch-up', () => {
  for (const lifecycle of ['visibility', 'page']) {
    const env = boot(); startUnguided(env); finishChoiceWave(env); env.advance(.4);
    const before = env.api.game.time;
    if (lifecycle === 'visibility') { env.document.hidden = true; env.document.dispatch('visibilitychange'); }
    else env.window.dispatch('pagehide');
    env.advance(30, 30); assert.equal(env.get('choice-overlay').hidden, true); assert.equal(env.api.game.time, before);
    if (lifecycle === 'visibility') { env.document.hidden = false; env.document.dispatch('visibilitychange'); }
    else env.window.dispatch('pageshow');
    env.advance(.5); assert.equal(env.get('choice-overlay').hidden, true, 'still has viewing time left after foregrounding');
    env.advance(.15); assert.equal(env.get('choice-overlay').hidden, false);
    assert.equal(env.api.game.time, before); assert.equal(env.errors.length, 0); env.destroy();
  }
});

test('2× uses battle time; camp panels, pause and background lifecycle freeze without deferred simulation or automatic resume', async () => {
  const env = boot(); startUnguided(env); env.click('speed-button'); env.click('speed-button'); await env.flush();
  env.advance(1); assert.ok(Math.abs(env.api.game.time - 2) < 1 / 60);
  assert.ok(Math.abs(env.audioContexts[0].currentTime - 1) < 1e-8, 'audio clock advances in real seconds');
  env.click('formation-button'); const buildTime = env.api.game.time; env.advance(4);
  assert.equal(env.api.game.time, buildTime); assert.equal(env.api.combatClock.accumulator, 0);
  env.click('close-camp'); env.advance(0.01); assert.ok(env.api.game.time - buildTime <= 1 / 30 + 1e-9);
  env.click('pause-button'); assert.equal(env.api.game.state, 'paused'); assert.equal(env.get('pause-overlay').hidden, false);
  const paused = env.api.game.time; env.advance(4); assert.equal(env.api.game.time, paused); assert.equal(env.api.combatClock.accumulator, 0);
  env.click('resume-button'); env.advance(0.1);
  env.document.hidden = true; env.document.dispatch('visibilitychange'); await env.flush();
  assert.equal(env.api.game.state, 'paused'); assert.equal(env.api.sound.active, false);
  assert.equal(env.audioContexts[0].sources.size, 0);
  const hidden = env.api.game.time; env.advance(60, 60); assert.equal(env.api.game.time, hidden);
  env.document.hidden = false; env.document.dispatch('visibilitychange'); await env.flush();
  assert.equal(env.api.game.state, 'paused', 'returning requires explicit resume'); env.advance(1); assert.equal(env.api.game.time, hidden);
  env.click('resume-button'); env.advance(0.01); assert.ok(env.api.game.time - hidden <= 1 / 30 + 1e-9);
  env.window.dispatch('pagehide'); assert.equal(env.api.game.state, 'paused'); assert.equal(env.api.sound.active, false);
  env.window.dispatch('pageshow'); assert.equal(env.api.game.state, 'paused'); assert.equal(env.audioContexts.length, 1);
  env.destroy();
});

function chooseCamp(env, slot) {
  const position = env.api.game.map.campSlots.find(s => s.slot === slot), rect = env.get('battle-canvas').getBoundingClientRect();
  env.get('battle-canvas').dispatch('pointerup', { clientX: rect.left + position.x * rect.width / 420, clientY: rect.top + position.y * rect.height / 600 });
  assert.equal(env.get('camp-panel').hidden, false); assert.match(env.get('camp-index-label').textContent, new RegExp(String(slot + 1)));
}
function playPublicUi(env) {
  const preference = ['guan_yu_width', 'archer_hunt', 'archer_pierce', 'shield_grasp', 'archer_volley', 'shield_reach'];
  let iterations = 0;
  while (!['won', 'lost'].includes(env.api.game.state) && iterations++ < 1500) {
    const game = env.api.game;
    if (game.state === 'choosing') {
      if (env.get('choice-overlay').hidden) { env.advance(.1); continue; }
      const choice = preference.map(id => game.upgrades.find(c => c.id === id)).find(Boolean) ?? game.upgrades[0];
      env.clickText(choice.name, env.get('upgrade-choices'));
    }
    if (game.state === 'playing') {
      const open = game.map.campSlots.filter(s => !game.camps.some(c => c.slot === s.slot)).sort((a, b) => b.y - a.y || a.slot - b.slot);
      for (const position of open) if (game.food >= 60) { chooseCamp(env, position.slot); env.clickText('弓营', env.get('camp-options')); }
      const upgradeOrder = [...game.camps].sort((a, b) => (a.type === 'shield') - (b.type === 'shield') || b.y - a.y || a.slot - b.slot);
      for (const camp of upgradeOrder) {
        const cost = game.getUpgradeCost(camp.slot);
        if (cost != null && game.food >= cost) { chooseCamp(env, camp.slot); env.clickText('升级至', env.get('camp-options')); }
      }
      const hero = game.heroes[0], target = hero.target;
      const urgent = game.enemies.some(e => e.hp > 0 && e.progress / e.pathLength > 0.82 && target?.targetIds.includes(e.id));
      const boss = game.enemies.some(e => e.hp > 0 && e.type === 'boss' && target?.targetIds.includes(e.id));
      if (hero.rage >= 100 && (target?.ordinaryCount >= 10 || urgent || boss)) env.clickText(hero.name, env.get(hero.role === 'lead' ? 'lead-command' : 'hero-commands'));
    }
    env.advance(0.3, 0.1);
  }
  assert.equal(env.api.game.state, 'won', JSON.stringify({ time: env.api.game.time, hp: env.api.game.hp, casts: env.api.game.stats.ultimateCasts, wave: env.api.game.wave }));
}

test('a real Wei 1 victory via public UI credits first-clear rewards once, unlocks the next level and persists after returning', () => {
  const env = boot(); startUnguided(env); env.click('speed-button'); env.click('speed-button');
  const initialResources = JSON.parse(JSON.stringify(env.api.store.state.resources));
  playPublicUi(env);
  assert.equal(env.get('result-overlay').hidden, false); assert.ok(env.api.game.stats.ultimateCasts > 0);
  assert.equal(env.get('result-casts').textContent, String(env.api.game.stats.ultimateCasts));
  assert.equal(env.api.store.isLevelUnlocked('wei_002'), true); assert.equal(env.api.store.state.levels.wei_001.clears, 1);
  const expectedResources = Object.fromEntries(Object.entries(env.api.game.level.firstClearReward).map(([key, base]) =>
    [key, initialResources[key] + base + Math.max(0, env.api.game.stars - 1) * Math.floor(base * 0.1)]));
  assert.deepEqual(JSON.parse(JSON.stringify(env.api.store.state.resources)), expectedResources, 'first clear plus each earned star bonus is credited exactly');
  assert.equal(env.api.store.state.rewardLedger.transactions.filter(tx => tx.levelId === 'wei_001' && tx.won).length, 1);
  assert.equal(env.api.store.state.rewardLedger.firstClears.filter(id => id === 'wei_001').length, 1);
  const finishedSave = env.api.store.exportSave();
  assert.equal(env.get('result-loot').hidden, false);
  assert.equal(env.get('result-loot-item').hidden, true);
  assert.match(env.get('result-loot-rates').textContent, /金 2.5%/);
  const dropped = JSON.parse(finishedSave).rewardLedger.transactions.find(tx => tx.levelId === 'wei_001' && tx.won).loot;
  env.click('result-open-box'); assert.equal(env.get('result-loot-item').hidden, false);
  assert.ok(env.get('result-loot-item').textContent.includes(dropped.name));
  assert.equal(env.api.store.exportSave(), finishedSave, 'revealing a saved drop does not roll or grant another item');
  env.advance(3); assert.equal(env.api.store.exportSave(), finishedSave, 'rendering result repeatedly cannot award another receipt');
  env.click('result-home'); assert.equal(env.api.mode, 'lobby'); assert.equal(env.api.store.exportSave(), finishedSave);
  assert.match(env.get('campaign-progress').textContent, /1 \/ 60/);
  const storage = env.storage; env.destroy();
  const restored = boot({ storage }); assert.equal(restored.api.selectedLevelId, 'wei_002'); assert.equal(restored.api.store.state.levels.wei_001.clears, 1); restored.destroy();
});

test('unavailable browser storage shows a persistence warning while deployment and gameplay remain available', () => {
  const env = boot({ unavailableStorage: true });
  env.click('settings-tab'); assert.ok(env.get('storage-status').textContent.length > 0);
  env.click('setting-speed'); assert.equal(env.api.store.state.settings.speed, 1.5);
  assert.match(env.get('storage-status').textContent, /保存|存储|存档/, 'failed save identifies the persistence problem');
  env.click('campaign-tab'); startUnguided(env); env.advance(0.2); assert.ok(env.api.game.time > 0);
  env.click('formation-button'); env.clickText('弓营', env.get('camp-options'));
  assert.ok(env.api.game.camps.some(c => c.type === 'archer' && c.slot === 0));
  assert.equal(env.errors.length, 0); env.destroy();
});

test('workshop research, forging, same-slot transfer and manual salvage use real saved account operations', () => {
  const storage = new Map(), env = boot({storage});
  const supplied = JSON.parse(env.api.store.exportSave());
  supplied.resources = {experience_book:100,copper_coin:20000,refined_iron:1000};
  assert.equal(env.api.store.importSave(JSON.stringify(supplied)).ok, true);
  env.click('workshop-tab');
  assert.equal(env.get('workshop-screen').hidden, false); assert.equal(env.get('campaign-screen').hidden, true);
  assert.equal(env.get('technology-list').querySelectorAll('.technology-card').length, 6);
  env.click('ws-tab-bag'); env.click('loot-rates-button');
  assert.match(env.get('workshop-loot-rates').textContent, /白 45%.*蓝 30%.*紫 17.5%.*红 5%.*金 2.5%/);
  env.click('modal-close'); env.click('ws-tab-tech');
  const research = env.get('technology-list').querySelectorAll('button')[0];
  assert.equal(research.disabled, false); research.click();
  assert.equal(env.api.store.state.technology.shield, 1); assert.equal(env.saved().technology.shield, 1);
  assert.match(env.get('technology-list').textContent, /主线第 6 阵开放/);
  const beforeForge = env.api.store.state.inventory.length;
  env.click('ws-tab-forge'); env.clickText('锻造白色',env.get('forge-list'));
  assert.equal(env.api.store.state.inventory.length, beforeForge + 1);
  const forged = env.api.store.state.inventory.find(item => !item.equippedHeroId && item.templateId === 'basic_weapon');
  assert.ok(forged);
  env.click('ws-tab-bag');
  assert.equal(env.get('inventory-detail').querySelectorAll('.salvage-button').length, 0, 'equipped items do not offer salvage');
  selectIdleInventoryItem(env);
  assert.equal(env.get('inventory-detail').querySelectorAll('.salvage-button').length, 1, 'selected idle item offers salvage in the persistent detail bar');
  const select = env.get('forge-template');
  assert.equal(select.querySelectorAll('option').length, 19); assert.equal(select.querySelectorAll('option').some(option => /倚天剑|青龙偃月刀/.test(option.textContent)), false, 'gold weapons cannot be forged');
  env.click('heroes-tab'); env.clickText('关羽',env.get('hero-roster')); openWeaponPicker(env);
  assert.ok(env.get('modal-body').querySelectorAll('.equipment-card').every(card => /百炼兵刃/.test(card.textContent)), 'weapon picker only shows weapon instances');
  env.clickText('换装',env.get('modal-body'));
  assert.equal(env.api.store.getHero('guan_yu').equipment.weapon.itemInstanceId, forged.itemInstanceId);
  assert.equal(env.api.store.state.inventory.length, beforeForge + 1, 'swapped equipment remains in the inventory');
  openWeaponPicker(env); env.clickText('转移给关羽',env.get('modal-body'));
  assert.equal(env.api.store.getHero('cao_cao').equipment.weapon, null);
  assert.equal(env.api.store.state.inventory.length, beforeForge + 1, 'transfer never creates a replacement starter item');
  env.click('modal-close'); env.clickText('曹操',env.get('hero-roster'));
  assert.match(env.get('hero-gear-weapon').getAttribute('aria-label'), /武器.*未装备/);
  assert.match(env.get('hero-gear-weapon').querySelector('.gear-tile').getAttribute('aria-label'), /未装备/);
  env.click('hero-gear-weapon');
  assert.equal(env.get('hero-gear-popover').querySelectorAll('.gear-equip').length, 1, 'empty slot offers one equipment picker');
  assert.equal(env.get('hero-gear-popover').querySelectorAll('button').filter(node => /强化|升品/.test(node.textContent) && !node.disabled).length, 0, 'empty slot cannot strengthen or promote');
  env.click('modal-close'); env.click('workshop-tab'); env.click('ws-tab-bag');
  const idle = env.api.store.state.inventory.filter(item => !item.equippedHeroId);
  selectIdleInventoryItem(env); env.clickText('分解',env.get('inventory-detail'));
  assert.equal(env.api.store.state.inventory.length, beforeForge + 1, 'opening manual salvage does not remove an item');
  env.clickText('保留装备',env.get('modal-body'));
  assert.equal(env.api.store.state.inventory.length, beforeForge + 1);
  env.clickText('分解',env.get('inventory-detail')); env.clickText('确认分解',env.get('modal-body'));
  assert.equal(env.api.store.state.inventory.length, beforeForge);
  assert.ok(idle.some(item => !env.api.store.state.inventory.some(current => current.itemInstanceId === item.itemInstanceId)));
  assert.equal(env.errors.length, 0); env.destroy();
  const restored = boot({storage}); assert.equal(restored.api.store.state.technology.shield, 1); assert.equal(restored.api.store.getHero('cao_cao').equipment.weapon, null); restored.destroy();
});

test('gold signatures show real item names and wearer activation; they strengthen without a promotion or forge path', () => {
  const env = boot(); const supplied = JSON.parse(env.api.store.exportSave());
  supplied.inventory.push({itemInstanceId:'test-gold-signature',templateId:'signature_guan_yu_weapon',slot:'weapon',quality:'gold',level:0,equippedHeroId:null});
  supplied.resources = {experience_book:100,copper_coin:20000,refined_iron:1000};
  assert.equal(env.api.store.importSave(JSON.stringify(supplied)).ok,true);
  env.click('heroes-tab'); env.clickText('关羽',env.get('hero-roster')); openWeaponPicker(env);
  const gold = env.get('modal-body').querySelectorAll('.equipment-card').find(card => /青龙偃月刀/.test(card.textContent));
  assert.ok(gold); assert.match(gold.textContent,/本人效果已激活/); gold.querySelector('button').click();
  env.click('hero-gear-weapon');
  const row = env.get('hero-gear-popover'); assert.match(row.textContent,/青龙偃月刀.*金色.*强化 Lv\s*0/);
  const promotion = row.querySelectorAll('button').find(node => node.textContent.includes('升品'));
  assert.ok(promotion?.disabled, 'gold shows a disabled promotion action');
  env.clickText('强化',row); assert.equal(env.api.store.getHero('guan_yu').equipment.weapon.level,1);
  env.click('modal-close'); env.clickText('曹操',env.get('hero-roster')); openWeaponPicker(env);
  const transfer = env.get('modal-body').querySelectorAll('.equipment-card').find(card => /青龙偃月刀/.test(card.textContent));
  assert.match(transfer.textContent,/本人效果未激活/); transfer.querySelector('button').click();
  assert.equal(env.api.store.getHero('cao_cao').equipment.weapon.templateId,'signature_guan_yu_weapon');
  env.click('hero-gear-weapon'); assert.match(env.get('hero-gear-popover').textContent,/本人效果未激活/);
  env.click('modal-close'); env.click('workshop-tab'); env.click('ws-tab-bag');
  const original = env.api.store.exportSave();
  env.get('inventory-list').querySelectorAll('.equipment-card').find(card => /青龙偃月刀/.test(card.textContent)).click();
  assert.equal(env.get('inventory-detail').querySelectorAll('.salvage-button').length,0);
  env.click('campaign-tab'); env.click('campaign-start');
  assert.equal(env.api.game.campTech.shield,env.api.store.state.technology.shield);
  assert.equal(env.api.store.state.inventory.length,JSON.parse(original).inventory.length);
  assert.equal(env.errors.length,0); env.destroy();
});

test('recovery export of a future-schema save preserves exact original bytes and blocks battle entry and temporary export', async () => {
  const raw = `  \n{\n  "schemaVersion": ${SAVE_SCHEMA_VERSION + 1},\n  "futureOnly": "未来军帐 · 不得改写",\n  "unrecognized": [1, 2, 3]\n}\n  `;
  const storage = new Map([[SAVE_KEY, raw]]), env = boot({ storage });
  assert.equal(env.api.store.readOnly, true); assert.equal(env.get('campaign-start').disabled, true);
  env.click('workshop-tab');
  assert.ok(env.get('technology-list').querySelectorAll('button').every(button => button.disabled));
  assert.ok(env.get('forge-list').querySelectorAll('button').every(button => button.disabled));
  assert.equal(storage.get(SAVE_KEY),raw,'viewing a future save in the workshop preserves its exact original bytes');
  env.click('campaign-tab');
  env.click('campaign-start'); assert.equal(env.api.game, null); assert.equal(env.api.mode, 'lobby');
  env.click('settings-tab'); const speed = env.api.store.state.settings.speed;
  env.click('setting-speed'); assert.equal(env.api.store.state.settings.speed, speed, 'readonly setting changes are rejected');
  env.click('setting-guide'); assert.equal(env.api.game, null, 'the guide entry also respects the readonly battle gate');
  env.click('save-export');
  const body = env.get('modal-body'), input = body.querySelector('textarea');
  assert.equal(input.value, raw, 'the original whitespace, unknown fields and bytes are preserved');
  assert.equal(input.getAttribute('aria-label'), '保留的原始存档文本');
  assert.match(body.querySelector('.modal-note').textContent, /原始存档/);
  assert.equal(body.querySelectorAll('button').some(b => b.textContent.includes('改为导出本次临时进度')), false, 'future saves cannot be replaced with temporary-account exports');
  env.clickText('下载存档', body); assert.equal(await env.downloads[0].text(), raw, 'download uses the same exact recovery text');
  env.window.dispatch('pagehide'); assert.equal(storage.get(SAVE_KEY), raw, 'lifecycle save attempts do not overwrite a future save');
  assert.equal(env.errors.length, 0); env.destroy();
});

test('recovery export of a corrupt save defaults to original bytes, while an explicit switch exports valid temporary progress after real play', async () => {
  const raw = ' \n{ unreadable: "原始破损卷宗", keepTheseBytes: [1,2, }\n ';
  const storage = new Map([[SAVE_KEY, raw]]), env = boot({ storage });
  assert.equal(env.api.store.readOnly, false); assert.equal(env.api.store.preserveUnreadableSave, true);
  env.click('settings-tab'); env.click('setting-speed');
  assert.equal(env.api.store.state.settings.speed, 1.5); assert.equal(storage.get(SAVE_KEY), raw, 'temporary preferences cannot overwrite corrupt bytes');
  env.click('campaign-tab'); startUnguided(env); env.advance(0.4);
  assert.ok(env.api.game.time > 0); assert.equal(storage.get(SAVE_KEY), raw, 'real play and guide-skipping commits preserve the original');
  env.click('pause-button'); env.click('leave-battle'); env.clickText('返回军帐', env.get('modal-body'));
  assert.equal(env.api.mode, 'lobby'); env.click('settings-tab'); env.click('save-export');
  const body = env.get('modal-body'), input = body.querySelector('textarea');
  assert.equal(input.value, raw); assert.match(body.querySelector('.modal-note').textContent, /原始存档/);
  env.clickText('下载存档', body); assert.equal(await env.downloads[0].text(), raw);
  env.clickText('改为导出本次临时进度', body);
  const temporary = JSON.parse(input.value);
  assert.equal(temporary.schemaVersion, SAVE_SCHEMA_VERSION); assert.equal(temporary.settings.speed, 1.5);
  assert.equal(temporary.settings.tutorialVersion, 1); assert.deepEqual(Object.keys(temporary.heroes).sort(), ['cao_cao', 'guan_yu']);
  assert.equal(temporary.rewardLedger.issuedBattleSequence, 1, 'the export contains the temporary account used in the actual battle');
  assert.equal(input.value, env.api.store.exportSave());
  assert.match(body.querySelector('.modal-note').textContent, /临时进度.*原始存档仍保留/);
  env.clickText('下载存档', body); assert.equal(await env.downloads[1].text(), input.value);
  env.click('modal-close'); env.click('save-export');
  assert.equal(env.get('modal-body').querySelector('textarea').value, raw, 'reopening the export returns to the safe original-file default');
  env.window.dispatch('pagehide'); assert.equal(storage.get(SAVE_KEY), raw);
  assert.equal(env.errors.length, 0); env.destroy();
});
