import test from 'node:test';
import assert from 'node:assert/strict';
import { AudioSystem } from '../audio-system.js';
import { Game } from '../game-engine.js';

class FakeParam {
  constructor(value = 0) { this.value = value; this.values = []; }
  setValueAtTime(value) { this.value = value; this.values.push(value); }
  linearRampToValueAtTime(value) { this.value = value; }
  exponentialRampToValueAtTime(value) { this.value = value; }
  cancelScheduledValues() {}
}

class FakeNode {
  constructor(context, type) {
    this.context = context;
    this.type = type;
    this.connections = new Set();
    this.gain = new FakeParam(1);
    this.frequency = new FakeParam(440);
    this.pan = new FakeParam();
    this.Q = new FakeParam();
    this.onended = null;
    this.started = false;
    this.stopAt = Infinity;
    context.nodes.push(this);
  }
  connect(node) { this.connections.add(node); return node; }
  disconnect() { this.connections.clear(); }
  start() {
    this.started = true;
    this.context.started++;
    this.context.sources.add(this);
  }
  stop(at = this.context.currentTime) {
    this.stopAt = at;
    if (at <= this.context.currentTime) this.finish();
  }
  finish() {
    this.context.sources.delete(this);
    this.started = false;
    this.onended?.();
  }
}

class FakeAudioContext {
  constructor({ rejectResume = false, deferredResume = false } = {}) {
    this.sampleRate = 2000;
    this.currentTime = 0;
    this.state = 'suspended';
    this.nodes = [];
    this.sources = new Set();
    this.started = 0;
    this.suspends = 0;
    this.closes = 0;
    this.rejectResume = rejectResume;
    this.deferredResume = deferredResume;
    this.destination = {};
  }
  createGain() { return new FakeNode(this, 'gain'); }
  createOscillator() { return new FakeNode(this, 'oscillator'); }
  createBufferSource() { return new FakeNode(this, 'buffer'); }
  createBiquadFilter() { return new FakeNode(this, 'filter'); }
  createStereoPanner() { return new FakeNode(this, 'panner'); }
  createDynamicsCompressor() {
    const node = new FakeNode(this, 'compressor');
    for (const key of ['threshold', 'knee', 'ratio', 'attack', 'release']) node[key] = new FakeParam();
    return node;
  }
  createBuffer(channels, length, sampleRate) {
    const data = Array.from({ length: channels }, () => new Float32Array(length));
    return { length, sampleRate, duration: length / sampleRate, getChannelData: channel => data[channel] };
  }
  resume() {
    if (this.rejectResume) return Promise.reject(new Error('Autoplay denied'));
    if (this.deferredResume) return new Promise(resolve => { this.resolveResume = () => { this.state = 'running'; resolve(); }; });
    this.state = 'running';
    return Promise.resolve();
  }
  suspend() { this.suspends++; this.state = 'suspended'; return Promise.resolve(); }
  close() { this.closes++; this.state = 'closed'; return Promise.resolve(); }
  advance(seconds) {
    this.currentTime += seconds;
    for (const source of [...this.sources]) if (source.stopAt <= this.currentTime) source.finish();
  }
}

const makeAudio = (options = {}, context = new FakeAudioContext()) => ({ context, audio: new AudioSystem({ ...options, contextFactory: () => context }) });

test('does not create a context or sound before a user gesture unlock', async () => {
  let calls = 0;
  const context = new FakeAudioContext();
  const audio = new AudioSystem({ contextFactory: () => { calls++; return context; } });
  audio.setScene('battle');
  audio.handleEvent({ type: 'ultimate' });
  audio.click();
  audio.setPreferences({ musicEnabled: true, sfxEnabled: true });
  audio.setActive(false);
  audio.setActive(true);
  assert.equal(calls, 0);
  assert.equal(context.started, 0);
  assert.equal(await audio.unlock(), true);
  assert.equal(calls, 1);
  assert.ok(audio.musicSource?.loop);
  assert.ok(audio.musicSource.buffer.getChannelData(0).some(sample => sample !== 0));
  audio.destroy();
});

test('music and effects mute independently and changing preferences stops the muted channel', async () => {
  const { audio, context } = makeAudio({ musicEnabled: false });
  await audio.unlock();
  assert.equal(audio.musicSource, null);
  audio.click();
  assert.equal(audio._voices.size, 1);
  audio.setPreferences({ sfxEnabled: false, musicEnabled: true });
  const music = audio.musicSource;
  assert.ok(music);
  assert.equal(audio._voices.size, 0);
  const starts = context.started;
  audio.click();
  audio.handleEvent({ type: 'ultimate' });
  assert.equal(context.started, starts);
  assert.equal(audio.musicSource, music);
  audio.setPreferences({ musicEnabled: false, sfxEnabled: true });
  assert.equal(audio.musicSource, null);
  context.advance(0.1);
  audio.click();
  assert.equal(audio._voices.size, 1);
  audio.destroy();
});

test('pause/choice lower the same music loop; background stops all sources until active again', async () => {
  const { audio, context } = makeAudio();
  audio.setScene('battle');
  await audio.unlock();
  const source = audio.musicSource;
  const volume = audio._musicGain.gain.value;
  audio.setScene('pause');
  assert.equal(audio.musicSource, source);
  assert.ok(audio._musicGain.gain.value < volume);
  const starts = context.started;
  audio.handleEvent({ type: 'attack', campType: 'archer', slot: 2 });
  assert.equal(context.started, starts);
  audio.setScene('choosing');
  assert.ok(audio._musicGain.gain.value < volume);
  audio.click();
  audio.setActive(false);
  assert.equal(context.sources.size, 0);
  assert.equal(audio._voices.size, 0);
  assert.equal(audio.musicSource, null);
  assert.equal(context.state, 'suspended');
  assert.equal(audio._masterGain.gain.value, 0);
  const hiddenStarts = context.started;
  audio.handleEvent({ type: 'win' });
  audio.click();
  assert.equal(context.started, hiddenStarts);
  audio.setActive(true);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(context.state, 'running');
  assert.ok(audio.musicSource?.loop);
  audio.destroy();
});

test('dense attacks are throttled, polyphony is bounded, and ended voices disconnect', async () => {
  const { audio, context } = makeAudio({ musicEnabled: false });
  audio.setScene('battle');
  await audio.unlock();
  for (let i = 0; i < 200; i++) audio.handleEvent({ type: 'attack', campType: 'archer', slot: 2 });
  assert.equal(context.started, 2, 'one bow tone and one noise voice for a same-time burst');
  context.advance(0.11);
  audio.handleEvent({ type: 'attack', campType: 'archer', slot: 2 });
  assert.equal(context.started, 2, 'per-camp cooldown is stronger than the global bow cooldown');
  context.advance(0.20);
  audio.handleEvent({ type: 'attack', campType: 'archer', slot: 2 });
  assert.equal(context.started, 4);
  context.advance(1);
  for (let i = 0; i < 100; i++) audio._tone(440, 1, 0.02);
  assert.equal(audio._voices.size, 18);
  audio.handleEvent({ type: 'ultimate' });
  assert.equal(audio._voices.size, 18, 'important slash voices replace lower priority attacks');
  context.advance(2);
  assert.equal(audio._voices.size, 0);
  assert.equal(context.sources.size, 0);
  assert.ok(context.nodes.filter(node => node.type === 'oscillator' || node.type === 'buffer').every(node => node.connections.size === 0));
  audio.destroy();
});

test('unavailable/rejected audio and a backgrounding race degrade to silence without rejecting', async () => {
  const unavailable = new AudioSystem({ contextFactory: () => { throw new Error('No device'); } });
  assert.equal(await unavailable.unlock(), false);
  assert.doesNotThrow(() => unavailable.handleEvent({ type: 'ultimate' }));
  unavailable.destroy();
  const rejected = makeAudio({}, new FakeAudioContext({ rejectResume: true }));
  assert.equal(await rejected.audio.unlock(), false);
  assert.equal(rejected.context.started, 0);
  rejected.audio.destroy();
  const pending = makeAudio({}, new FakeAudioContext({ deferredResume: true }));
  const unlocking = pending.audio.unlock();
  pending.audio.setActive(false);
  pending.context.resolveResume();
  assert.equal(await unlocking, false);
  assert.equal(pending.context.started, 0);
  assert.equal(pending.context.state, 'suspended');
  pending.audio.destroy();
});

test('dense real hits and deaths are globally throttled with bounded deduplication and spatial voices', async () => {
  const { audio, context } = makeAudio({ musicEnabled: false });
  audio.setScene('battle');
  await audio.unlock();
  for (let id = 0; id < 160; id++) {
    audio.handleEvent({ type: 'damage', enemyId: id, enemyType: 'infantry', amount: 20, source: 'ultimate_guan_yu', castId: 1, x: 0 });
    audio.handleEvent({ type: 'kill', enemyId: id, enemyType: 'infantry', source: 'ultimate_guan_yu', castId: 1, x: 0 });
  }
  assert.equal(context.started, 4, 'one hit layer and one death layer for a simultaneous 160-enemy clear');
  assert.ok(context.nodes.filter(n => n.type === 'panner').every(n => n.pan.value < 0));
  context.advance(0.4);
  const before = context.started;
  audio.handleEvent({ type: 'kill', enemyId: 0, enemyType: 'infantry', x: 420 });
  assert.equal(context.started, before, 'replayed death cannot ring again');
  audio.handleEvent({ type: 'kill', enemyId: 160, enemyType: 'infantry', x: 420 });
  assert.equal(context.started, before + 2);
  assert.ok(context.nodes.filter(n => n.type === 'panner').slice(-2).every(n => n.pan.value > 0));
  for (let id = 161; id < 1500; id++) audio.handleEvent({ type: 'kill', enemyId: id, enemyType: 'infantry' });
  assert.ok(audio._combatEvents.size <= 512);
  audio.destroy();
});

test('elite and boss deaths differ and cannot replace ultimate or result voices', async () => {
  const { audio, context } = makeAudio({ musicEnabled: false });
  audio.setScene('battle');
  await audio.unlock();
  audio.handleEvent({ type: 'kill', enemyId: 1, enemyType: 'elite' });
  const elite = [...audio._voices];
  assert.equal(elite.length, 2);
  assert.ok(elite.every(v => v.priority === 1));
  audio.handleEvent({ type: 'kill', enemyId: 2, enemyType: 'boss' });
  const boss = [...audio._voices].slice(2);
  assert.equal(boss.length, 3);
  assert.ok(boss[0].end > elite[0].end);
  assert.ok(boss[0].source.frequency.values[0] < elite[0].source.frequency.values[0]);
  audio._stopVoices();
  for (let i = 0; i < 18; i++) audio._tone(160, 1, 0.02, 32, 'triangle', { priority: 2 });
  context.advance(0.3);
  const protectedVoices = [...audio._voices];
  const starts = context.started;
  audio.handleEvent({ type: 'kill', enemyId: 3, enemyType: 'boss' });
  audio.handleEvent({ type: 'damage', enemyId: 4, amount: 100, source: 'ultimate_guan_yu' });
  assert.equal(context.started, starts);
  assert.deepEqual([...audio._voices], protectedVoices);
  audio.handleEvent({ type: 'win' });
  assert.equal(audio._voices.size, 4);
  assert.ok([...audio._voices].every(v => v.priority === 2));
  audio.destroy();
});

test('paused retry start resets death deduplication for reused enemy IDs', async () => {
  const { audio, context } = makeAudio();
  audio.setScene('battle');
  await audio.unlock();
  const music = audio.musicSource;
  audio.handleEvent({ type: 'kill', enemyId: 1, enemyType: 'infantry' });
  audio.setScene('pause');
  context.advance(0.3);
  audio.handleEvent({ type: 'start' });
  audio.setScene('battle');
  const starts = context.started;
  audio.handleEvent({ type: 'kill', enemyId: 1, enemyType: 'infantry' });
  assert.equal(context.started, starts + 2);
  assert.equal(audio.musicSource, music);
  assert.equal(audio.musicEnabled, true);
  assert.equal(audio.sfxEnabled, true);
  audio.destroy();
});

test('hit and death layers respect mute, pause, choices and background and use audio wall time', async () => {
  const { audio, context } = makeAudio({ musicEnabled: false });
  audio.setScene('battle');
  await audio.unlock();
  const play = id => {
    audio.handleEvent({ type: 'damage', enemyId: id, amount: 50, source: 'hero_guan_yu', x: 210, speed: 2, slowMotion: true });
    audio.handleEvent({ type: 'kill', enemyId: id, enemyType: 'infantry', x: 210, speed: 2, slowMotion: true });
  };
  play(1);
  const tones = context.nodes.filter(n => n.frequency.values.length);
  assert.deepEqual(tones.map(n => n.frequency.values[0]), [195, 148]);
  audio.setPreferences({ sfxEnabled: false });
  const starts = context.started;
  play(2);
  audio.setPreferences({ sfxEnabled: true });
  audio.setScene('pause'); play(3);
  audio.setScene('choosing'); play(4);
  audio.setScene('battle'); audio.setActive(false); play(5);
  assert.equal(context.started, starts);
  assert.equal(audio._voices.size, 0);
  audio.destroy();
});

test('destroy is idempotent, clears all node graphs, and cannot restart later', async () => {
  const { audio, context } = makeAudio();
  audio.setScene('boss');
  await audio.unlock();
  audio.handleEvent({ type: 'ultimate' });
  audio.destroy();
  audio.destroy();
  assert.equal(audio._voices.size, 0);
  assert.equal(audio._buffers.size, 0);
  assert.equal(context.sources.size, 0);
  assert.equal(context.closes, 1);
  assert.equal(await audio.unlock(), false);
  const starts = context.started;
  audio.setActive(true);
  audio.setPreferences({ musicEnabled: true, sfxEnabled: true });
  audio.handleEvent({ type: 'win' });
  assert.equal(context.started, starts);
  assert.ok(context.nodes.every(node => node.connections.size === 0));
});

test('engine reports distinct military attacks and impact positions without audio coupling', () => {
  const events = [];
  const game = new Game({ rng: () => 0.5, onEvent: event => events.push(event) });
  game.start();
  game.build(5, 'catapult');
  game.update(28);
  assert.ok(events.some(event => event.type === 'attack' && event.campType === 'shield' && event.slot === 4));
  assert.ok(events.some(event => event.type === 'attack' && event.campType === 'archer' && event.slot === 2));
  assert.ok(events.some(event => event.type === 'attack' && event.campType === 'catapult' && event.slot === 5));
  assert.ok(events.some(event => event.type === 'projectileImpact' && Number.isFinite(event.x) && Number.isFinite(event.y)));
  const heroGame = new Game({ rng: () => 0.5, onEvent: event => events.push(event) });
  heroGame.start();
  heroGame.camps.fill(null); // Let an actual march reach the hero instead of dying at the shield line.
  heroGame.update(20);
  assert.ok(events.some(event => event.type === 'heroAttack'));
});
