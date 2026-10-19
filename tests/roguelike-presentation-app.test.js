/** Real portable V1 entry tested through mocked DOM events; this is not browser/device QA. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import vm from 'node:vm';
import { SAVE_SCHEMA_VERSION } from '../campaign-state.js';
import { BALANCE as B, CONTENT } from '../runtime-data.js';
import { generateEndlessWave } from '../endless-rules.js';

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
  const observed = script.replace(/\n\}\)\(\);\s*$/, '\nglobalThis.__integration = { store, tutorial, sound, renderer, combatClock, heroNameCards, endlessTelemetry, telemetry, get game() { return game; }, get mode() { return mode; }, get selectedLevelId() { return selectedLevelId; } };\n})();');
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

function offer(env,cards) {
  const game = env.api.game;
  game.state = 'choosing'; game.upgrades = cards; game._emit('choice',{choices:cards}); env.advance(1.1);
}
function cardFor(game,predicate) { return Object.entries(game.tacticCatalog).map(([id,card]) => ({id,...card})).find(predicate); }
function soundLog(env) {
  const calls = [], original = env.api.sound.handleEvent.bind(env.api.sound);
  env.api.sound.handleEvent = event => { calls.push({...event}); original(event); };
  return calls;
}
function idleRun(env) {
  startEndless(env); const game = env.api.game;
  game._spawnQueue = [{at:1e9}]; game._spawnIndex = 0; game.enemies = [];
  for (const hero of game.heroes) hero.attackCooldown = 1e9;
  return game;
}
function rosterStorage(ids) {
  const storage = new Map(),env = boot({storage});
  for (const level of CONTENT.levels) assert.equal(env.api.store.settleBattle({battleId:env.api.store.createBattleId(),levelId:level.id,won:true,hp:100,maxHp:100,kills:0,bestBurst:0,time:1,casts:0}).ok,true);
  assert.equal(env.api.store.setParty(ids).ok,true); env.api.store.setSetting('tutorialVersion',1); env.destroy(); return storage;
}

test('the actual draft renders category icons, four quality marks and one reveal sound per offer', () => {
  const env = boot(),calls = soundLog(env); startEndless(env); const game = env.api.game;
  const cards = [cardFor(game,c => c.category === 'attribute' && c.rarity === 'epic'),cardFor(game,c => c.category === 'camp' && c.rarity === 'legendary'),cardFor(game,c => c.category === 'hero')];
  offer(env,cards);
  assert.equal(env.get('choice-overlay').parentElement,env.get('battle-view'),'endless choices escape the clipped battlefield');
  const images = env.get('upgrade-choices').querySelectorAll('.tactic-icon'); assert.equal(images.length,3);
  for (const image of images) { assert.match(image.src,/^data:image\/svg\+xml/); assert.ok(image.alt.length > 4); }
  const legendary = env.get('upgrade-choices').querySelector('.rarity-legendary');
  assert.ok(legendary.classList.contains('quality-gold')); assert.equal(legendary.querySelectorAll('.tactic-corner').length,4);
  assert.equal(calls.filter(e => e.type === 'tacticOffer').length,1); assert.equal(calls.filter(e => e.type === 'cardLegendary').length,1);
  env.get('upgrade-choices').querySelector('.tactic-lock').click();
  assert.equal(calls.filter(e => e.type === 'tacticOffer').length,1);
  assert.equal(env.get('upgrade-choices').querySelector('.tactic-card').classList.contains('is-entering'),false);
  env.get('upgrade-choices').querySelector('.upgrade-choice').click();
  assert.equal(game.state,'playing'); assert.equal(env.get('tactic-total').textContent,'1');
  assert.equal(calls.filter(e => e.type === 'tacticPick').length,1);
  assert.equal(env.document.querySelectorAll('.roguelike-pick-cue').length,1);
  env.advance(.6); assert.equal(env.document.querySelectorAll('.roguelike-pick-cue').length,0);
  assert.equal(env.errors.length,0); env.destroy();
});

test('reroll, skip, epic, actual wall repair, level-five and milestone events reach their dedicated sound branches', () => {
  const env = boot(),calls = soundLog(env); startEndless(env); const game = env.api.game;
  game.food = 1e6;
  offer(env,[cardFor(game,c => c.rarity === 'epic'),cardFor(game,c => c.rarity === 'common'),cardFor(game,c => c.rarity === 'rare')]);
  assert.ok(calls.some(e => e.type === 'cardEpic'));
  env.click('choice-reroll'); env.advance(1.1); env.click('choice-skip');
  assert.ok(calls.some(e => e.type === 'reroll')); assert.ok(calls.some(e => e.type === 'skip'));
  offer(env,[{id:'attr_gate_repair',...game.tacticDefinition('attr_gate_repair')}]);
  env.get('upgrade-choices').querySelector('.upgrade-choice').click();
  game.hp -= 15; game._startWave(10);
  assert.ok(calls.some(e => e.type === 'gateRepair' && e.heal > 0)); assert.ok(calls.some(e => e.type === 'waveMilestone'));
  assert.equal(game.build(0,'archer').ok,true); for (let i = 0; i < 4; i++) assert.equal(game.upgrade(0).ok,true);
  assert.equal(calls.filter(e => e.type === 'campLevel5').length,1);
  assert.match(env.get('roguelike-notice').textContent,/五级/);
  game._startWave(60); const boss = game._spawnQueue.find(spec => spec.boss);
  game._spawnQueue = [boss]; game._spawnIndex = 0; game.enemies = []; game._waveTime = boss.at - 3;
  game.update(1 / 60); game.update(1 / 60);
  const warnings = calls.filter(e => e.type === 'endlessBoss'); assert.equal(warnings.length,1); assert.equal(warnings[0].seconds,3);
  assert.equal(env.errors.length,0); env.destroy();
});

test('the combo hold freezes every combat subsystem for a quarter real second at all three speeds, including reduced motion', () => {
  for (const speed of [1,1.5,2]) {
    const env = boot(),game = idleRun(env); env.api.store.setSetting('speed',speed); env.api.renderer.reducedMotion = true;
    const enemy = game._spawn({type:'infantry',lane:0,progress:40,wave:game._waveConfig(1)});
    game._emit('heroCombo',{comboId:'combo_east_wind',name:'借东风',fromHeroId:'zhuge_liang',toHeroId:'zhou_yu',count:1,limit:3,remaining:2,target:{x:210,y:300,radius:80},fromTarget:{x:210,y:300,radius:80}});
    const time = game.time,progress = enemy.progress,rage = game.heroes[0].rage;
    env.advance(.2);
    assert.equal(game.time,time); assert.equal(enemy.progress,progress); assert.equal(game.heroes[0].rage,rage);
    assert.equal(env.api.combatClock.impactRemaining,0); assert.match(env.get('hero-combo-name').textContent,/借东风/);
    assert.ok(env.api.renderer.presentationHoldRemaining > 0);
    env.advance(.15); assert.ok(game.time > time); assert.equal(env.api.renderer.presentationHoldRemaining,0);
    env.advance(1.2); assert.equal(env.get('hero-combo-cue').hidden,true);
    assert.equal(env.errors.length,0); env.destroy();
  }
});

test('background and pause preserve the informative combo hold without building combat-time debt', () => {
  const env = boot(),game = idleRun(env);
  game._emit('heroCombo',{comboId:'combo_tiger_command',name:'虎卫号令',fromHeroId:'xu_chu',toHeroId:'cao_cao',count:1,limit:3,remaining:2});
  env.advance(.1); const hold = env.api.renderer.presentationHoldRemaining,time = game.time;
  env.document.hidden = true; env.document.dispatch('visibilitychange'); env.advance(1);
  assert.equal(env.api.renderer.presentationHoldRemaining,hold); assert.equal(game.time,time);
  env.document.hidden = false; env.document.dispatch('visibilitychange'); env.click('resume-button'); env.advance(.1);
  assert.equal(game.time,time); env.advance(.2); assert.ok(game.time > time && game.time - time < .25);
  assert.equal(env.errors.length,0); env.destroy();
});

test('all four prebattle bonds expose distinct permanent marks, including a strategy stamp after resource rerenders', () => {
  const cases = [['taoyuan',['liu_bei','guan_yu','zhang_fei']],['weiwu_xiongfeng',['cao_cao','xiahou_dun','xu_chu']],['jiangdong_huchen',['zhou_yu','gan_ning']],['wolong_zhonghu',['zhuge_liang','sima_yi']]];
  for (const [id,ids] of cases) {
    const env = boot({storage:rosterStorage(ids)});
    assert.ok(env.get('party-section').classList.contains('bond-' + id));
    assert.ok(env.get('endless-bond-marks').querySelector('.bond-' + id));
    if (id === 'wolong_zhonghu') {
      assert.equal(env.get('party-slots').querySelector('.bond-strategy-stamp').textContent,'谋');
      env.click('endless-start'); env.click('story-start'); env.advance(.1); env.api.game._finish('lost'); env.advance(.1); env.click('result-home');
      assert.equal(env.get('party-slots').querySelector('.bond-strategy-stamp').textContent,'谋');
    }
    assert.equal(env.errors.length,0); env.destroy();
  }
});

test('reduced-motion gate hits retain the 120ms red signal and retry clears all new transient cues', () => {
  const env = boot(),game = idleRun(env); env.api.renderer.reducedMotion = true;
  const enemy = game._spawn({type:'infantry',lane:0,progress:game.paths[0].length - 1,wave:game._waveConfig(1)}); game._escape(enemy);
  env.advance(.05); assert.ok(env.get('gate-flash').classList.contains('is-on'));
  env.advance(.05); assert.ok(env.get('gate-flash').classList.contains('is-on'));
  env.advance(.15); assert.equal(env.get('gate-flash').classList.contains('is-on'),false);
  game.food = 1e5; game.build(0,'archer'); for (let i = 0; i < 4; i++) game.upgrade(0);
  assert.equal(env.get('roguelike-notice').hidden,false);
  game._finish('lost'); env.advance(.1); env.advance(2); env.click('next-level');
  assert.equal(env.get('roguelike-notice').hidden,true); assert.equal(env.get('hero-combo-cue').hidden,true);
  assert.equal(env.api.renderer.presentationHoldRemaining,0); assert.equal(env.document.querySelectorAll('.roguelike-pick-cue').length,0);
  assert.equal(env.errors.length,0); env.destroy();
});

test('campaign keeps its original tactic rendering and has no roguelike cinematic or audio context', () => {
  const env = boot(),calls = soundLog(env); env.click('campaign-start'); if (!env.get('story-overlay').hidden) env.click('story-start'); env.advance(.1);
  const game = env.api.game; game.state = 'choosing'; game.upgrades = [{id:'archer_volley',...B.tactics.archer_volley}]; game._emit('choice',{choices:game.upgrades}); env.advance(1.1);
  assert.equal(env.get('upgrade-choices').querySelectorAll('.tactic-icon').length,0);
  assert.notEqual(env.get('choice-overlay').parentElement,env.get('battle-view'),'campaign retains its original field overlay');
  assert.equal(env.get('synergy-status').hidden,true); assert.equal(env.api.renderer.presentationHoldRemaining,0);
  assert.equal(calls.some(e => e.presentation === 'roguelike'),false);
  assert.equal(env.errors.length,0); env.destroy();
});

test('retry inside the red-flash window clears the old gate signal immediately', () => {
  const env = boot(),game = idleRun(env); env.api.renderer.reducedMotion = true;
  const enemy = game._spawn({type:'infantry',lane:0,progress:game.paths[0].length - 1,wave:game._waveConfig(1)}); game._escape(enemy);
  env.advance(.02); assert.ok(env.get('gate-flash').classList.contains('is-on'));
  env.click('pause-button'); env.click('restart-paused');
  assert.equal(env.get('gate-flash').classList.contains('is-on'),false);
  assert.equal(env.api.renderer.presentationHoldRemaining,0); assert.equal(env.errors.length,0); env.destroy();
});

test('only late endless boss warning lead time changes; birth times, counts, HP and food stay identical', () => {
  for (const wave of [10,20,30,40,50,60,70,80,90]) {
    const generated = generateEndlessWave(wave),first = generated.bossSpawns[0];
    assert.equal(first.warningSec,wave >= 51 ? 3 : B.endless.bossWarningSec);
    assert.equal(first.spawnAtSec,generated.spawnWindowSec * B.endless.bossSpawnFraction);
    assert.equal(generated.foodRewardTotal,generated.completionFoodReward + generated.killFoodReward);
  }
  assert.equal(B.endless.bossWarningSec,2); assert.equal(CONTENT.levels.length,60);
});

