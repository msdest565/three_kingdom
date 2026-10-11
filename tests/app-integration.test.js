/** Node VM integration checks. DOM/Canvas/audio are mocks, not browser or device QA. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import vm from 'node:vm';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// Exercise the real current build script rather than a possibly stale dist file or a test bundler.
execFileSync(process.execPath, ['scripts/build.mjs'], { cwd: root, stdio: 'pipe' });
const portable = readFileSync(path.join(root, 'dist/prototype.html'), 'utf8');
const sourceHtml = readFileSync(path.join(root, 'prototype.html'), 'utf8');
const script = [...portable.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].at(-1)?.[1];
assert.ok(script?.includes('class AudioSystem') && script.includes('class TutorialController'));
// Only expose existing closure objects for observation; user actions still go through DOM events.
const observedScript = script.replace(/\n\}\)\(\);$/, '\nglobalThis.__integration = { game, tutorial, sound, record, renderer, combatClock, get preferredSpeed() { return preferredSpeed; } };\n})();');
assert.notEqual(observedScript, script);
const compiled = new vm.Script(observedScript, { filename: 'portable-game.integration.js' });
const RECORD_KEY = 'wushuang-guard-v1';
const SPEED_KEY = 'wushuang-guard-combat-speed';

class Events {
  constructor() { this.listeners = new Map(); }
  addEventListener(type, callback) {
    const callbacks = this.listeners.get(type) || [];
    callbacks.push(callback); this.listeners.set(type, callbacks);
  }
  dispatch(type, event = {}) {
    const payload = { type, target: this, preventDefault() {}, ...event };
    for (const callback of this.listeners.get(type) || []) callback(payload);
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

class Element extends Events {
  constructor(tag, attrs = {}) {
    super(); this.tagName = tag.toUpperCase(); this.attrs = { ...attrs }; this.children = [];
    this.parentElement = null; this.hidden = Object.hasOwn(attrs, 'hidden'); this.disabled = Object.hasOwn(attrs, 'disabled');
    this.style = {}; this.dataset = {}; this._text = ''; this.tokens = new Set((attrs.class || '').split(/\s+/).filter(Boolean));
    this.classList = {
      add: (...names) => names.forEach(name => this.tokens.add(name)),
      remove: (...names) => names.forEach(name => this.tokens.delete(name)),
      contains: name => this.tokens.has(name),
      toggle: (name, force) => {
        const enabled = force === undefined ? !this.tokens.has(name) : Boolean(force);
        if (enabled) this.tokens.add(name); else this.tokens.delete(name);
        return enabled;
      },
    };
    if (tag === 'canvas') this._context = canvasContext();
  }
  get textContent() { return this._text + this.children.map(child => child.textContent).join(''); }
  set textContent(value) { this._text = String(value); this.children = []; }
  get className() { return [...this.tokens].join(' '); }
  set className(value) { this.tokens = new Set(String(value).split(/\s+/).filter(Boolean)); }
  setAttribute(key, value) { this.attrs[key] = String(value); }
  getAttribute(key) { return this.attrs[key] ?? null; }
  append(...children) { for (const child of children) { child.parentElement = this; this.children.push(child); } }
  replaceChildren(...children) { this.children = []; this._text = ''; this.append(...children); }
  querySelector(selector) {
    for (const child of this.children) {
      if (selector.startsWith('.') ? child.tokens.has(selector.slice(1)) : child.tagName.toLowerCase() === selector) return child;
      const nested = child.querySelector(selector); if (nested) return nested;
    }
    return null;
  }
  click() {
    if (this.disabled) return;
    for (let node = this; node; node = node.parentElement) if (node.hidden) return;
    this.dispatch('click');
  }
  focus() {}
  getContext() { return this._context; }
  getBoundingClientRect() { return { width: 320, height: 379, left: 0, top: 95, right: 320, bottom: 474 }; }
}

function createDocument() {
  const document = new Events();
  document.hidden = false;
  const ids = new Map(); const top = new Element('document'); const stack = [top];
  const voidTags = new Set(['meta', 'link', 'br', 'hr', 'img', 'input']);
  for (const match of sourceHtml.matchAll(/<\/?([a-zA-Z][\w-]*)\b([^>]*)>/g)) {
    const tag = match[1].toLowerCase();
    if (match[0].startsWith('</')) {
      while (stack.length > 1) if (stack.pop().tagName.toLowerCase() === tag) break;
      continue;
    }
    const attrs = {};
    for (const attr of match[2].matchAll(/([\w:-]+)(?:=(?:"([^"]*)"|'([^']*)'))?/g)) attrs[attr[1]] = attr[2] ?? attr[3] ?? '';
    const element = new Element(tag, attrs); stack.at(-1).append(element);
    if (attrs.id) ids.set(attrs.id, element);
    if (tag === 'body') document.body = element;
    if (!voidTags.has(tag) && !match[0].endsWith('/>')) stack.push(element);
  }
  document.getElementById = id => ids.get(id) || null;
  document.querySelector = selector => top.querySelector(selector);
  document.createElement = tag => new Element(tag);
  return { document, ids };
}

class Param {
  constructor(value = 0) { this.value = value; }
  setValueAtTime(value) { this.value = value; }
  linearRampToValueAtTime(value) { this.value = value; }
  exponentialRampToValueAtTime(value) { this.value = value; }
  cancelScheduledValues() {}
}
class AudioNode {
  constructor(context) {
    this.context = context; this.links = new Set(); this.gain = new Param(1); this.frequency = new Param(440);
    this.pan = new Param(); this.Q = new Param(); this.stopAt = Infinity; this.onended = null;
    for (const key of ['threshold', 'knee', 'ratio', 'attack', 'release']) this[key] = new Param();
  }
  connect(node) { this.links.add(node); }
  disconnect() { this.links.clear(); }
  start() { this.context.sources.add(this); }
  stop(at = this.context.currentTime) { this.stopAt = at; if (at <= this.context.currentTime) this.end(); }
  end() { this.context.sources.delete(this); this.onended?.(); }
}
class MockAudioContext {
  constructor() { this.state = 'suspended'; this.currentTime = 0; this.sampleRate = 2000; this.sources = new Set(); this.destination = {}; }
  createGain() { return new AudioNode(this); }
  createOscillator() { return new AudioNode(this); }
  createBufferSource() { return new AudioNode(this); }
  createBiquadFilter() { return new AudioNode(this); }
  createStereoPanner() { return new AudioNode(this); }
  createDynamicsCompressor() { return new AudioNode(this); }
  createBuffer(channels, length) { const data = Array.from({ length: channels }, () => new Float32Array(length)); return { getChannelData: channel => data[channel] }; }
  resume() { this.state = 'running'; return Promise.resolve(); }
  suspend() { this.state = 'suspended'; return Promise.resolve(); }
  close() { this.state = 'closed'; return Promise.resolve(); }
  advance(seconds) {
    if (this.state !== 'running') return;
    this.currentTime += seconds;
    for (const source of [...this.sources]) if (source.stopAt <= this.currentTime) source.end();
  }
}

function boot({ storage = new Map(), unavailableStorage = false } = {}) {
  const { document, ids } = createDocument();
  const window = new Events(); window.devicePixelRatio = 1;
  window.matchMedia = () => Object.assign(new Events(), { matches: false });
  let now = 0; let nextTimer = 1;
  const timers = new Map(); const rafs = []; const errors = []; const audioContexts = [];
  const context = vm.createContext({
    document, window,
    AudioContext: class extends MockAudioContext { constructor() { super(); audioContexts.push(this); } },
    performance: { now: () => now },
    localStorage: {
      getItem: key => { if (unavailableStorage) throw new Error('Storage denied'); return storage.get(key) ?? null; },
      setItem: (key, value) => { if (unavailableStorage) throw new Error('Storage denied'); storage.set(key, String(value)); },
    },
    console: { error: error => errors.push(error), log() {} },
    requestAnimationFrame: callback => { rafs.push(callback); return rafs.length; },
    setTimeout: (callback, ms) => { const id = nextTimer++; timers.set(id, { callback, at: now + ms }); return id; },
    clearTimeout: id => timers.delete(id),
  });
  compiled.runInContext(context, { timeout: 5000 });
  const api = context.__integration;
  const advance = (seconds, step = 0.05) => {
    let remaining = seconds;
    while (remaining > 1e-8) {
      const delta = Math.min(step, remaining); remaining -= delta; now += delta * 1000;
      for (const audio of audioContexts) audio.advance(delta);
      for (const [id, timer] of [...timers]) if (timer.at <= now) { timers.delete(id); timer.callback(); }
      const callbacks = rafs.splice(0);
      assert.equal(callbacks.length, 1, 'the app maintains one animation-frame chain');
      for (const callback of callbacks) callback(now);
      assert.equal(ids.get('fatal-message').hidden, true, errors.map(error => error?.stack || error).join('\n'));
    }
  };
  const flushAudio = () => new Promise(resolve => setImmediate(resolve));
  const click = id => { assert.ok(ids.has(id), `DOM contains ${id}`); ids.get(id).click(); };
  const saved = () => JSON.parse(storage.get(RECORD_KEY) || 'null');
  return { api, ids, document, window, audioContexts, errors, storage, advance, click, saved, flushAudio };
}

test('portable current bundle initializes and a new player completes the real guided combat event chain', async () => {
  const env = boot();
  assert.equal(env.api.game.state, 'ready');
  assert.equal(env.audioContexts.length, 0, 'initialization does not autoplay');
  env.click('start-button'); await env.flushAudio();
  assert.equal(env.api.tutorial.step, 'intro');
  assert.equal(env.ids.get('tutorial-card').hidden, false);
  env.advance(2); assert.equal(env.api.game.time, 0);
  env.click('tutorial-action'); assert.equal(env.api.tutorial.step, 'deploy');
  env.click('tutorial-action');
  assert.equal(env.ids.get('camp-panel').hidden, false);
  assert.equal(env.ids.get('tutorial-card').hidden, true, 'camp controls are unobscured by the tutorial card');
  env.advance(1); assert.equal(env.api.game.time, 0);
  const options = env.ids.get('camp-options').children;
  assert.equal(options.length, 3);
  options[1].click();
  assert.equal(env.api.game.camps[3].type, 'archer');
  assert.equal(env.api.game.food, 60);
  assert.equal(env.api.tutorial.step, 'gather');
  assert.equal(env.ids.get('camp-panel').hidden, true);
  env.advance(30);
  assert.equal(env.api.tutorial.step, 'ultimate');
  assert.ok(env.api.game.time >= 15 && env.api.game.time <= 21);
  assert.ok(env.api.game.enemies.length > 0);
  const readyTime = env.api.game.time; env.advance(1); assert.equal(env.api.game.time, readyTime);
  env.click('tutorial-action');
  assert.equal(env.api.tutorial.step, 'burst'); assert.equal(env.api.game.stats.casts, 1);
  env.advance(1);
  assert.equal(env.api.tutorial.step, 'complete'); assert.ok(env.api.tutorial.burstKills > 0);
  assert.equal(env.api.tutorial.burstKills, env.api.game.currentBurst.kills);
  assert.ok(env.ids.get('burst-number').textContent.startsWith('横扫'));
  const completedTime = env.api.game.time; env.advance(1); assert.equal(env.api.game.time, completedTime);
  env.click('tutorial-action');
  assert.equal(env.api.tutorial.step, 'off'); assert.equal(env.ids.get('tutorial-card').hidden, true);
  assert.equal(env.saved().tutorialVersion, 1); assert.equal(env.saved().tutorialCompleted, true);
  env.advance(0.25); assert.ok(env.api.game.time > completedTime);
  assert.equal(env.errors.length, 0); env.api.sound.destroy();
});

test('skip is persisted, a returning player is not forced into guidance, and relearn starts a fresh guide', async () => {
  const storage = new Map(); const first = boot({ storage });
  first.click('start-button'); first.click('tutorial-skip');
  assert.equal(first.api.tutorial.active, false);
  assert.equal(first.saved().tutorialVersion, 1); assert.equal(first.saved().tutorialCompleted, false);
  first.api.sound.destroy();
  const returning = boot({ storage }); returning.click('start-button'); await returning.flushAudio();
  assert.equal(returning.api.tutorial.active, false); returning.advance(1);
  assert.ok(returning.api.game.time > 0);
  returning.click('pause-button'); assert.equal(returning.api.game.state, 'paused');
  returning.click('relearn-button'); assert.equal(returning.api.game.state, 'playing');
  assert.equal(returning.api.game.time, 0); assert.equal(returning.api.tutorial.step, 'intro');
  returning.advance(1); assert.equal(returning.api.game.time, 0);
  returning.api.sound.destroy();
});

test('separate UI preferences persist and legacy sound values migrate with modern-field precedence', async () => {
  const storage = new Map([[RECORD_KEY, JSON.stringify({ sound: false, bestBurst: 19 })]]);
  const env = boot({ storage });
  assert.equal(env.api.sound.musicEnabled, false); assert.equal(env.api.sound.sfxEnabled, false);
  assert.equal(env.ids.get('music-button').getAttribute('aria-pressed'), 'false');
  assert.equal(env.ids.get('sound-button').getAttribute('aria-pressed'), 'false');
  env.click('music-button'); await env.flushAudio();
  assert.equal(env.api.sound.musicEnabled, true); assert.equal(env.api.sound.sfxEnabled, false);
  assert.equal(env.saved().musicEnabled, true); assert.equal(env.saved().sfxEnabled, false);
  assert.equal(env.saved().bestBurst, 19); assert.equal(Object.hasOwn(env.saved(), 'sound'), false);
  env.click('sound-button'); assert.equal(env.api.sound.sfxEnabled, true);
  env.click('music-button'); assert.equal(env.api.sound.musicEnabled, false); assert.equal(env.api.sound.sfxEnabled, true);
  env.api.sound.destroy();
  const reloaded = boot({ storage });
  assert.equal(reloaded.api.sound.musicEnabled, false); assert.equal(reloaded.api.sound.sfxEnabled, true);
  reloaded.api.sound.destroy();
  const modern = boot({ storage: new Map([[RECORD_KEY, JSON.stringify({ sound: false, musicEnabled: true })]]) });
  assert.equal(modern.api.sound.musicEnabled, true); assert.equal(modern.api.sound.sfxEnabled, false);
  modern.api.sound.destroy();
});

test('UI pause, visibility and page lifecycle stop audio; returning waits for an explicit resume', async () => {
  const env = boot({ storage: new Map([[RECORD_KEY, JSON.stringify({ tutorialVersion: 1 })]]) });
  env.click('start-button'); await env.flushAudio(); env.advance(0.2);
  const audio = env.audioContexts[0]; assert.ok(audio.sources.size > 0);
  env.click('pause-button');
  assert.equal(env.api.game.state, 'paused'); assert.equal(env.api.sound.active, false); assert.equal(audio.sources.size, 0);
  const pauseTime = env.api.game.time; env.advance(2); assert.equal(env.api.game.time, pauseTime);
  env.click('resume-button'); await env.flushAudio(); assert.equal(env.api.sound.active, true); assert.ok(audio.sources.size > 0);
  env.advance(0.2); env.document.hidden = true; env.document.dispatch('visibilitychange');
  assert.equal(env.api.game.state, 'paused'); assert.equal(audio.sources.size, 0);
  const hiddenTime = env.api.game.time; env.advance(2); assert.equal(env.api.game.time, hiddenTime);
  env.document.hidden = false; env.document.dispatch('visibilitychange'); await env.flushAudio();
  assert.equal(env.api.game.state, 'paused'); assert.equal(env.api.sound.active, false); assert.equal(audio.sources.size, 0);
  env.click('resume-button'); await env.flushAudio(); assert.ok(audio.sources.size > 0);
  env.window.dispatch('pagehide'); assert.equal(audio.sources.size, 0); assert.equal(env.api.sound.active, false);
  env.window.dispatch('pageshow'); await env.flushAudio(); assert.equal(env.api.sound.active, true);
  assert.equal(env.audioContexts.length, 1, 'all resumes reuse the unlocked context');
  assert.ok(audio.sources.size <= 19); assert.equal(env.errors.length, 0); env.api.sound.destroy();
});

test('malformed or unavailable localStorage leaves gameplay and preference controls usable', () => {
  for (const config of [{ storage: new Map([[RECORD_KEY, '{invalid json']]) }, { unavailableStorage: true }]) {
    const env = boot(config);
    assert.equal(env.api.sound.musicEnabled, true); assert.equal(env.api.sound.sfxEnabled, true);
    env.click('start-button'); env.click('tutorial-skip'); env.advance(0.3);
    assert.ok(env.api.game.time > 0); assert.equal(env.api.tutorial.active, false);
    env.click('music-button'); env.click('sound-button');
    assert.equal(env.api.sound.musicEnabled, false); assert.equal(env.api.sound.sfxEnabled, false);
    assert.equal(env.errors.length, 0); env.api.sound.destroy();
  }
});

test('speed control cycles 1× → 1.5× → 2× and persists independently from records and audio', async () => {
  const storage = new Map([[RECORD_KEY, JSON.stringify({ tutorialVersion: 1, bestBurst: 27 })]]);
  const env = boot({ storage });
  assert.equal(env.ids.get('speed-button').textContent, '1×');
  env.click('speed-button'); assert.equal(env.ids.get('speed-button').textContent, '1.5×');
  assert.equal(JSON.parse(storage.get(SPEED_KEY)), 1.5);
  env.click('speed-button'); assert.equal(env.ids.get('speed-button').textContent, '2×');
  env.click('speed-button'); assert.equal(env.ids.get('speed-button').textContent, '1×');
  env.click('speed-button'); env.click('start-button'); await env.flushAudio(); env.advance(2);
  assert.ok(Math.abs(env.api.game.time - 3) < 1 / 60);
  assert.ok(Math.abs(env.audioContexts[0].currentTime - 2) < 1e-8, 'audio uses elapsed real time, not battle time');
  env.click('music-button'); env.click('sound-button');
  assert.equal(env.saved().bestBurst, 27); assert.equal(JSON.parse(storage.get(SPEED_KEY)), 1.5);
  env.api.sound.destroy();
  const reloaded = boot({ storage }); assert.equal(reloaded.ids.get('speed-button').textContent, '1.5×');
  assert.equal(reloaded.api.sound.musicEnabled, false); assert.equal(reloaded.api.sound.sfxEnabled, false);
  reloaded.api.sound.destroy();
});

test('first-time teaching is locked to 1× and completion restores the saved preference', async () => {
  const storage = new Map([[SPEED_KEY, '2']]); const env = boot({ storage });
  assert.equal(env.ids.get('speed-button').textContent, '2×');
  env.click('start-button'); await env.flushAudio();
  assert.equal(env.ids.get('speed-button').textContent, '1×'); assert.equal(env.ids.get('speed-button').disabled, true);
  assert.equal(env.ids.get('speed-button').getAttribute('title'), '引导固定 1× · 结束恢复 2×');
  env.click('speed-button'); assert.equal(JSON.parse(storage.get(SPEED_KEY)), 2);
  env.advance(2); assert.equal(env.api.game.time, 0);
  env.click('tutorial-action'); env.click('tutorial-action'); env.ids.get('camp-options').children[1].click();
  env.advance(1); assert.ok(Math.abs(env.api.game.time - 1) < 1 / 60, 'active teaching combat progresses at 1×');
  env.advance(30); assert.equal(env.api.tutorial.step, 'ultimate');
  const beforeCast = env.api.game.time; env.advance(2); assert.equal(env.api.game.time, beforeCast);
  env.click('tutorial-action'); env.advance(1); assert.equal(env.api.tutorial.step, 'complete');
  env.click('tutorial-action'); assert.equal(env.ids.get('speed-button').textContent, '2×');
  assert.equal(env.ids.get('speed-button').disabled, false); assert.ok(env.ids.get('toast').textContent.includes('已恢复 2×'));
  const restoredTime = env.api.game.time; env.advance(0.5);
  assert.ok(Math.abs(env.api.game.time - restoredTime - 1) < 1 / 60);
  env.click('pause-button'); env.click('relearn-button');
  assert.equal(env.ids.get('speed-button').textContent, '1×'); env.click('tutorial-skip');
  assert.equal(env.ids.get('speed-button').textContent, '2×'); env.api.sound.destroy();
});

test('2× freezes while paused, choosing or building and resumes without accumulated battle debt', () => {
  const env = boot({ storage: new Map([[RECORD_KEY, JSON.stringify({ tutorialVersion: 1 })], [SPEED_KEY, '2']]) });
  env.click('start-button'); env.advance(0.01);
  env.click('formation-button');
  const buildTime = env.api.game.time; env.advance(4); assert.equal(env.api.game.time, buildTime);
  assert.equal(env.api.combatClock.accumulator, 0);
  env.click('close-camp'); env.advance(0.01); assert.ok(env.api.game.time - buildTime <= 1 / 60 + 1e-9);
  env.click('pause-button'); const pausedTime = env.api.game.time;
  env.advance(4); assert.equal(env.api.game.time, pausedTime); assert.equal(env.api.combatClock.accumulator, 0);
  env.click('resume-button'); env.advance(0.01); assert.ok(env.api.game.time - pausedTime <= 1 / 60 + 1e-9);
  // A fixture enters the real engine/UI choice state without depending on balance or a full run.
  env.api.game.state = 'choosing';
  env.api.game.upgradeChoices = [{ id: 'archer_volley', name: '连珠齐射', description: '弓营追加齐射。' }];
  const choiceTime = env.api.game.time; env.advance(0.1); assert.equal(env.ids.get('choice-overlay').hidden, false);
  env.advance(4); assert.equal(env.api.game.time, choiceTime); assert.equal(env.api.combatClock.accumulator, 0);
  env.ids.get('upgrade-choices').children[0].click(); env.advance(0.01);
  assert.ok(env.api.game.time - choiceTime <= 1 / 60 + 1e-9);
  env.document.hidden = true; env.document.dispatch('visibilitychange');
  const hiddenTime = env.api.game.time; env.advance(60, 60); assert.equal(env.api.game.time, hiddenTime);
  env.document.hidden = false; env.document.dispatch('visibilitychange');
  assert.equal(env.api.game.state, 'paused'); env.click('resume-button'); env.advance(0.01);
  assert.ok(env.api.game.time - hiddenTime <= 1 / 60 + 1e-9);
  env.api.sound.destroy();
});

test('bad speed saves fall back to 1× and disabled storage still allows live speed changes', () => {
  for (const savedSpeed of ['{broken', '0', '3', 'true', '"2"', '{}', 'null']) {
    const storage = new Map([[RECORD_KEY, JSON.stringify({ tutorialVersion: 1 })], [SPEED_KEY, savedSpeed]]);
    const env = boot({ storage }); assert.equal(env.ids.get('speed-button').textContent, '1×');
    env.click('speed-button'); assert.equal(env.ids.get('speed-button').textContent, '1.5×');
    assert.equal(JSON.parse(storage.get(SPEED_KEY)), 1.5); env.api.sound.destroy();
  }
  const denied = boot({ unavailableStorage: true }); denied.click('start-button'); denied.click('tutorial-skip');
  denied.click('speed-button'); assert.equal(denied.ids.get('speed-button').textContent, '1.5×');
  denied.advance(0.2); assert.ok(Math.abs(denied.api.game.time - 0.3) < 1 / 60); denied.api.sound.destroy();
});

test('enemy HUD counts real units and renderer offsets never mutate simulation coordinates', () => {
  const env = boot({ storage: new Map([[RECORD_KEY, JSON.stringify({ tutorialVersion: 1 })]]) });
  env.click('start-button'); env.advance(6); env.click('speed-button');
  const alive = env.api.game.enemies.filter(enemy => enemy.hp > 0 && !enemy.escaped);
  assert.equal(Number(env.ids.get('enemy-count').textContent), alive.length);
  assert.equal(env.ids.get('pending-count').textContent, `本波待入场 ${env.api.game.pendingEnemyCount ?? env.api.game._spawnQueue.length}`);
  const coordinates = alive.map(enemy => [enemy.id, enemy.x, enemy.y]); const drawn = [];
  env.api.renderer.drawEnemy = (ctx, enemy) => drawn.push([enemy.id, enemy.x, enemy.y]);
  env.api.renderer.render(env.api.game);
  assert.equal(drawn.length, alive.length, 'one silhouette per real enemy; no decoration army');
  assert.deepEqual(alive.map(enemy => [enemy.id, enemy.x, enemy.y]), coordinates);
  assert.ok(drawn.some((enemy, i) => enemy[1] !== coordinates[i][1] || enemy[2] !== coordinates[i][2]), 'stable offsets separate overlapping silhouettes');
  env.api.sound.destroy();
});
