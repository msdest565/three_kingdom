import test from 'node:test';
import assert from 'node:assert/strict';
import { AudioSystem, AUDIO_TIMBRES } from '../audio-system.js';
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


test('hero combo sound waits for unlock, ducks music, rate limits, and respects mute preferences',async t=>{
  const {audio,context}=makeAudio();t.after(()=>audio.destroy());audio.handleEvent({type:'heroCombo'});assert.equal(audio.context,null);
  await audio.unlock();audio.setScene('battle');const before=context.started;
  audio.handleEvent({type:'heroCombo',comboId:'combo_righteous_sky'});
  assert.ok(context.started>before);assert.ok(audio._musicGain.gain.values.some(value=>Math.abs(value-audio._sceneVolume()*.3)<1e-8));
  const first=context.started;audio.handleEvent({type:'heroCombo'});assert.equal(context.started,first,'duplicate cue is rate limited');
  context.advance(1);audio.setPreferences({sfxEnabled:false});audio.handleEvent({type:'heroCombo'});assert.equal(context.started,first);
  audio.setPreferences({sfxEnabled:true});audio.handleEvent({type:'heroCombo'});assert.ok(context.started>first);
});

test('hero combo synthesis stays within the existing parameter scale and reserves voices under battle saturation',async t=>{
  const {audio,context}=makeAudio();t.after(()=>audio.destroy());await audio.unlock();audio.setScene('battle');
  const spec=AUDIO_TIMBRES.heroCombo;
  assert.ok(spec.frequency>=47&&spec.frequency<=1100&&spec.endFrequency>=47&&spec.endFrequency<=1100);
  assert.ok(spec.duration>=.05&&spec.duration<=.23&&spec.volume>=.018&&spec.volume<=.13);
  assert.ok(spec.noiseDuration>=.05&&spec.noiseDuration<=.23&&spec.noiseVolume>=.018&&spec.noiseVolume<=.13);
  assert.ok(spec.interval>=.1&&spec.interval<=.3);
  for(let i=0;i<24;i++)audio._tone(180,.2,.02,90,'triangle',{priority:0});
  audio.handleEvent({type:'heroCombo'});
  assert.ok(audio._voices.size<=18);assert.ok([...audio._voices].some(voice=>voice.priority===3));
  assert.ok(context.nodes.every(node=>node.type!=='oscillator'||Number.isFinite(node.frequency.value)));
});
