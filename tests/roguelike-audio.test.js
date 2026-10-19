import test from 'node:test';
import assert from 'node:assert/strict';
import { AudioSystem, AUDIO_TIMBRES, ROGUELIKE_AUDIO_TIMBRES, ROGUELIKE_COMBO_PAIRS } from '../audio-system.js';

class Param {
  constructor(value = 0) { this.value = value; this.changes = []; }
  setValueAtTime(value, at) { this.value = value; this.changes.push({ value, at }); }
  linearRampToValueAtTime(value, at) { this.value = value; this.changes.push({ value, at }); }
  exponentialRampToValueAtTime(value, at) { this.value = value; this.changes.push({ value, at }); }
  cancelScheduledValues() {}
}
class Node {
  constructor(context, kind) {
    this.context = context; this.kind = kind; this.links = new Set(); this.gain = new Param(1); this.frequency = new Param(440); this.pan = new Param(); this.Q = new Param(); this.startAt = Infinity; this.stopAt = Infinity;
    context.nodes.push(this);
  }
  connect(node) { this.links.add(node); return node; }
  disconnect() { this.links.clear(); }
  start(at = this.context.currentTime) { this.startAt = at; this.context.sources.add(this); this.context.started++; }
  stop(at = this.context.currentTime) { this.stopAt = at; if (at <= this.context.currentTime) this.finish(); }
  finish() { this.context.sources.delete(this); this.onended?.(); }
}
class Context {
  constructor() { this.currentTime = 0; this.state = 'suspended'; this.sampleRate = 2000; this.nodes = []; this.sources = new Set(); this.started = 0; this.destination = {}; }
  createGain() { return new Node(this, 'gain'); }
  createOscillator() { return new Node(this, 'tone'); }
  createBufferSource() { return new Node(this, 'buffer'); }
  createBiquadFilter() { return new Node(this, 'filter'); }
  createStereoPanner() { return new Node(this, 'pan'); }
  createDynamicsCompressor() { const node = new Node(this, 'compressor'); for (const key of ['threshold','knee','ratio','attack','release']) node[key] = new Param(); return node; }
  createBuffer(channels, length, sampleRate) { const arrays = Array.from({ length:channels }, () => new Float32Array(length)); return { sampleRate, getChannelData:index => arrays[index] }; }
  resume() { this.state = 'running'; return Promise.resolve(); }
  suspend() { this.state = 'suspended'; return Promise.resolve(); }
  close() { this.state = 'closed'; return Promise.resolve(); }
  advance(seconds) { this.currentTime += seconds; for (const source of [...this.sources]) if (source.stopAt <= this.currentTime) source.finish(); }
}
async function fixture(options = {}, scene = 'battle') {
  const context = new Context(), audio = new AudioSystem({ musicEnabled:false, ...options, contextFactory:() => context });
  audio.setScene(scene); await audio.unlock();
  return { context, audio };
}
const near = (actual, expected, message) => assert.ok(Math.abs(actual - expected) < 1e-8, `${message}: ${actual} versus ${expected}`);
const frequency = voice => voice.source.frequency.changes[0]?.value;
const tones = audio => [...audio._voices].filter(voice => voice.source.kind === 'tone');

test('all eleven roguelike cue profiles keep every pulse in the shared synthesis budget', () => {
  assert.deepEqual(Object.keys(ROGUELIKE_AUDIO_TIMBRES), ['tacticOffer','tacticPick','cardEpic','cardLegendary','reroll','skip','gateRepair','campLevel5','synergy','endlessBoss','waveMilestone']);
  assert.equal(AUDIO_TIMBRES.roguelike, ROGUELIKE_AUDIO_TIMBRES);
  for (const [id, profile] of Object.entries(ROGUELIKE_AUDIO_TIMBRES)) {
    assert.ok(profile.interval >= .10 && profile.interval <= .30, id + ' interval');
    assert.ok(profile.tones.length + profile.noises.length <= 18, id + ' bounded scheduled polyphony');
    for (const pulse of [...profile.tones, ...profile.noises]) {
      assert.ok(pulse.duration >= .05 && pulse.duration <= .23, id + ' duration');
      assert.ok(pulse.volume >= .018 && pulse.volume <= .13, id + ' volume');
      assert.ok(Number.isFinite(pulse.delay) && pulse.delay >= 0, id + ' delay');
      if ('frequency' in pulse) assert.ok([pulse.frequency,pulse.endFrequency].every(value => value >= 47 && value <= 1100), id + ' pitch');
    }
  }
});

test('eleven cues sound in menu or choosing, share SFX preferences, and reject duplicate event bursts', async t => {
  for (const [index, [type, profile]] of Object.entries(ROGUELIKE_AUDIO_TIMBRES).entries()) {
    const { audio, context } = await fixture({}, index % 2 ? 'menu' : 'choosing'); t.after(() => audio.destroy());
    audio.handleEvent({ type, mode:'endless', wave:20 });
    const starts = context.started;
    assert.equal(starts, profile.tones.length + profile.noises.length, type + ' plays its complete cue');
    assert.ok([...audio._voices].every(voice => voice.roguelike && voice.role === type));
    audio.handleEvent({ type }); assert.equal(context.started, starts, type + ' same-time duplicates stay silent');
    audio.setPreferences({ sfxEnabled:false }); assert.equal(audio._voices.size, 0);
    context.advance(2); audio.handleEvent({ type }); assert.equal(context.started, starts);
    audio.setPreferences({ sfxEnabled:true }); audio.handleEvent({ type }); assert.ok(context.started > starts);
  }
});

test('card reveal and long reward tails preserve their score offsets with short cancellable sources', async t => {
  const { audio, context } = await fixture({}, 'choosing'); t.after(() => audio.destroy());
  audio.handleEvent({ type:'tacticOffer' });
  assert.deepEqual(tones(audio).map(frequency), [520,660,780]);
  assert.deepEqual(tones(audio).map(voice => voice.source.startAt), [0,.07,.14]);
  context.advance(1); audio.handleEvent({ type:'cardLegendary' });
  const arpeggio = tones(audio); assert.deepEqual(arpeggio.slice(0,4).map(frequency), [523,659,784,1047]);
  assert.deepEqual(arpeggio.slice(0,4).map(voice => +(voice.source.startAt - 1).toFixed(2)), [0,.09,.18,.27]);
  assert.equal(arpeggio.filter(voice => frequency(voice) === 131).length, 3, 'the half-second bass tail is three valid short pulses');
  context.advance(1); audio.handleEvent({ type:'waveMilestone' });
  near(Math.max(...tones(audio).map(voice => voice.end)) - context.currentTime - .015, .9, 'five bell pulses retain the .9-second reward tail');
});

test('all eight combos use an octave-down initiator, its responding hero, title and 47-Hz final impact at the authored offsets', async t => {
  for (const [comboId, [fromHeroId,toHeroId]] of Object.entries(ROGUELIKE_COMBO_PAIRS)) {
    const { audio, context } = await fixture({ musicEnabled:true, timbres:{ heroes:{ [fromHeroId]:{frequency:400,endFrequency:180}, [toHeroId]:{frequency:700,endFrequency:230} } } }); t.after(() => audio.destroy());
    audio.handleEvent({ type:'heroCombo', presentation:'roguelike', comboId });
    assert.equal(audio._voices.size, 12, comboId + ' uses a bounded twelve-voice template');
    const all = tones(audio), a = all.find(voice => Math.abs(voice.source.startAt - .25) < 1e-8), b = all.find(voice => Math.abs(voice.source.startAt - .33) < 1e-8);
    assert.equal(frequency(a), 200); assert.equal(frequency(b), 700);
    assert.ok(all.some(voice => voice.source.startAt === .6 && frequency(voice) === 880));
    assert.deepEqual(all.filter(voice => frequency(voice) === 47).map(voice => voice.source.startAt), [1.1,1.3]);
    assert.ok([...audio._voices].every(voice => voice.priority === 6 && voice.roguelike));
    assert.ok(all.every(voice => voice.end - voice.source.startAt - .015 <= .23 + 1e-8));
    assert.ok(audio._musicGain.gain.changes.some(change => Math.abs(change.value - audio._sceneVolume() * .3) < 1e-8));
    near(audio._roguelikeQuietUntil - context.currentTime, 1.5, 'the entire presentation owns the SFX mix');
  }
});

test('roguelike combo silence rejects ordinary sounds, protects its voices, and still admits critical priority-five cues', async t => {
  const { audio, context } = await fixture(); t.after(() => audio.destroy());
  for (let index = 0; index < 30; index++) audio._tone(160,.2,.025,90,'triangle');
  assert.equal(audio._voices.size, 18);
  audio.handleEvent({ type:'heroCombo', presentation:'roguelike', comboId:'combo_righteous_sky' });
  assert.equal(audio._voices.size, 12, 'the freeze stops pre-existing ordinary layers');
  const starts = context.started;
  for (const event of [{type:'attack',campType:'shield'},{type:'damage',amount:100,enemyId:1},{type:'ultimate'},{type:'kill',enemyId:1,enemyType:'boss'},{type:'tacticPick'},{type:'heroCombo',presentation:'roguelike'}]) audio.handleEvent(event);
  audio.click(); assert.equal(context.started, starts);
  audio.handleEvent({ type:'waveMilestone' }); assert.ok(context.started > starts); assert.ok(audio._voices.size <= 18);
  assert.equal([...audio._voices].filter(voice => voice.role === 'heroCombo').length, 12, 'lower priority critical bells cannot steal the combo');
  context.advance(1.6); audio.handleEvent({ type:'attack',campType:'shield' }); assert.ok([...audio._voices].some(voice => !voice.roguelike));
});

test('battle-to-boss transition preserves the sequence, while scene exit, background, mute and destruction cancel every future pulse', async t => {
  const exits = [audio => audio.setScene('pause'),audio => audio.setScene('choosing'),audio => audio.setScene('menu'),audio => audio.setScene('result'),audio => audio.setActive(false),audio => audio.setPreferences({sfxEnabled:false}),audio => audio.setPreferences({sfxVolume:0}),audio => audio.destroy()];
  for (const exit of exits) {
    const { audio, context } = await fixture(); t.after(() => audio.destroy());
    audio.handleEvent({ type:'heroCombo',presentation:'roguelike' });
    const voices = [...audio._voices]; audio.setScene('boss'); assert.equal(audio._voices.size,voices.length); assert.ok(voices.every(voice => audio._voices.has(voice)));
    audio.setScene('battle'); assert.equal(audio._voices.size,voices.length); assert.ok(voices.every(voice => audio._voices.has(voice)));
    exit(audio); assert.equal(audio._voices.size, 0); assert.equal(audio._roguelikeQuietUntil, 0);
    assert.equal(context.sources.size, 0); assert.ok(voices.every(voice => voice.nodes.every(node => node.links.size === 0)));
    const starts = context.started; context.advance(5); audio.update(); assert.equal(context.started, starts, 'cancelled future sources never reappear');
  }
});

test('switching battle music to the boss loop preserves the current combo duck until its original endpoint', async t => {
  const { audio, context } = await fixture({musicEnabled:true}); t.after(() => audio.destroy());
  audio.handleEvent({type:'heroCombo',presentation:'roguelike'});
  const music = audio.musicSource;
  context.advance(.2); const voices = [...audio._voices]; audio.setScene('boss');
  assert.ok(audio.musicSource !== music); assert.equal(audio._voices.size,voices.length); assert.ok(voices.every(voice => audio._voices.has(voice)));
  near(audio._musicGain.gain.changes.filter(change => change.at === context.currentTime).at(-1).value,audio._sceneVolume() * .3,'the replacement music starts under the existing duck');
  near(audio._musicGain.gain.changes.at(-1).at,1.5,'music restoration remains at the original presentation endpoint');
  context.advance(1.2); audio.setScene('battle');
  near(audio._musicGain.gain.changes.at(-1).at,1.5,'a late loop replacement cannot extend the duck or invert its gain timeline');
});

test('endless audio progresses from the standard attack to detuning and shorter attack buckets without changing campaign attacks', async t => {
  for (const wave of [25,26,51]) {
    const { audio, context } = await fixture(); t.after(() => audio.destroy());
    const attack = { type:'attack',mode:'endless',wave,campType:'shield',slot:0 };
    audio.handleEvent(attack); near(frequency(tones(audio)[0]), wave >= 26 ? 149 : 155, 'first late attack detunes down six hertz');
    const before = context.started; context.advance(.21); audio.handleEvent(attack);
    assert.equal(context.started > before, wave >= 51, 'only the last phase accepts this camp again after .21 seconds');
    if (wave === 26) { context.advance(.1); audio.handleEvent(attack); near(frequency(tones(audio).at(-1)),161,'the next middle-phase strike alternates six hertz above the base'); }
  }
  const { audio, context } = await fixture(); t.after(() => audio.destroy());
  audio.handleEvent({type:'attack',campType:'archer',slot:0});
  near(tones(audio)[0].end - tones(audio)[0].source.startAt - .015, .055, 'the campaign bow duration is unchanged');
  const before = context.started; context.advance(.21); audio.handleEvent({type:'attack',campType:'archer',slot:0}); assert.equal(context.started,before);
});

test('bounded battlefield noise follows SFX rather than music and cannot leak across phase, pause, retry or campaign resets', async t => {
  const { audio, context } = await fixture(); t.after(() => audio.destroy());
  audio.setBattleContext({mode:'endless',wave:25}); audio.update(); assert.equal(audio._voices.size,0);
  audio.setBattleContext({mode:'endless',wave:26}); audio.update();
  let ambience = [...audio._voices].filter(voice => voice.role === 'ambient'); assert.equal(ambience.length,2); assert.equal(audio.musicSource,null);
  assert.ok(ambience.every(voice => voice.priority === -1 && voice.nodes.find(node => node.kind === 'filter').frequency.value === 120));
  const middleGain = ambience[0].nodes.find(node => node.kind === 'gain').gain.changes.find(change => change.value > .001).value;
  audio.setPreferences({musicEnabled:true}); assert.ok(audio.musicSource); assert.ok(ambience.every(voice => audio._voices.has(voice)));
  audio.setBattleContext({mode:'endless',wave:51}); audio.update(); ambience = [...audio._voices].filter(voice => voice.role === 'ambient');
  const lateGain = ambience[0].nodes.find(node => node.kind === 'gain').gain.changes.find(change => change.value > .001).value;
  assert.ok(lateGain > middleGain); assert.ok(ambience.every(voice => voice.nodes.find(node => node.kind === 'filter').frequency.value === 180));
  for (let index = 0; index < 200; index++) { context.advance(.05); audio.update(); assert.ok(audio._voices.size <= 3, 'only a short ambient horizon stays scheduled'); }
  audio.setPreferences({sfxEnabled:false}); assert.equal(audio._voices.size,0); assert.ok(audio.musicSource);
  audio.setPreferences({sfxEnabled:true}); audio.update(); assert.ok(audio._voices.size > 0);
  audio.handleEvent({type:'start',mode:'endless',wave:1}); audio.update(); assert.equal(audio._voices.size,0,'retry starts again at the quiet first phase');
  audio.setBattleContext({mode:'endless',wave:80}); audio.update(); assert.ok(audio._voices.size > 0);
  audio.setBattleContext({mode:'campaign',wave:0}); audio.update(); assert.equal(audio._voices.size,0);
});

test('separated legacy tactic and upgrade cases preserve their original shared acknowledgement bucket', async t => {
  const { audio, context } = await fixture({}, 'choosing'); t.after(() => audio.destroy());
  audio.handleEvent({type:'tactic'}); assert.deepEqual(tones(audio).map(frequency),[440,587.33,880]);
  const starts = context.started; audio.handleEvent({type:'upgrade'}); assert.equal(context.started,starts);
  context.advance(.3); audio.handleEvent({type:'upgrade'}); assert.equal(context.started,starts+3);
});
