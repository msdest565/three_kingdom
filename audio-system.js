/** Original, asset-free Web Audio score and combat sounds. No scheduler timers are used. */
const SCENES = new Set(['menu', 'battle', 'boss', 'pause', 'choosing', 'result']);
const MAX_VOICES = 18;
const TAU = Math.PI * 2;
const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
const audioFactory = () => {
  const Audio = globalThis.AudioContext || globalThis.webkitAudioContext;
  return Audio ? new Audio({ latencyHint: 'interactive' }) : null;
};

// Future heroes/camps can override these timbres without changing the combat engine.
export const AUDIO_TIMBRES = Object.freeze({
  camps: Object.freeze({
    shield: { frequency: 155, endFrequency: 76, duration: 0.10, volume: 0.057, noiseDuration: 0.055, noiseVolume: 0.025, cutoff: 1350, interval: 0.10 },
    archer: { frequency: 1100, endFrequency: 510, duration: 0.055, volume: 0.026, noiseDuration: 0.045, noiseVolume: 0.018, cutoff: 3500, interval: 0.10 },
    catapult: { frequency: 110, endFrequency: 47, duration: 0.17, volume: 0.067, noiseDuration: 0, noiseVolume: 0, cutoff: 1050, interval: 0.22 },
  }),
  heroes: Object.freeze({
    guan_yu: { frequency: 310, endFrequency: 90, duration: 0.105, volume: 0.04, noiseDuration: 0.11, noiseVolume: 0.06, cutoff: 1900 },
  }),
});

export class AudioSystem {
  constructor({ musicEnabled = true, sfxEnabled = true, heroId = 'guan_yu', timbres = {}, contextFactory = audioFactory } = {}) {
    this.musicEnabled = Boolean(musicEnabled);
    this.sfxEnabled = Boolean(sfxEnabled);
    this.heroId = heroId;
    this.timbres = timbres && typeof timbres === 'object' ? timbres : {};
    this.scene = 'menu';
    this.active = true;
    this.unlocked = false;
    this.destroyed = false;
    this.context = null;
    this.musicSource = null;
    this._contextFactory = contextFactory;
    this._voices = new Set();
    this._buffers = new Map();
    this._lastSound = new Map();
    this._musicKey = null;
    this._lastMusicalScene = 'menu';
    this._resumePromise = null;
    this._musicVolume = 0.36;
    this._noiseBuffer = null;
  }

  /** Call from a user gesture. Rejected autoplay permissions simply leave the game silent. */
  async unlock() {
    if (this.destroyed) return false;
    this.unlocked = true;
    return this._activate();
  }

  setPreferences({ musicEnabled, sfxEnabled } = {}) {
    if (typeof musicEnabled === 'boolean') this.musicEnabled = musicEnabled;
    if (typeof sfxEnabled === 'boolean') this.sfxEnabled = sfxEnabled;
    if (!this.sfxEnabled) this._stopVoices();
    if (!this.musicEnabled) this._stopMusic();
    this._applyChannelLevels();
    if (this.musicEnabled) this._syncMusic();
    return { musicEnabled: this.musicEnabled, sfxEnabled: this.sfxEnabled };
  }

  setScene(scene) {
    const aliases = { ready: 'menu', playing: 'battle', paused: 'pause', won: 'result', lost: 'result' };
    const next = aliases[scene] || scene;
    if (!SCENES.has(next) || this.destroyed) return;
    if (this.scene === next) return;
    this.scene = next;
    if (['menu', 'battle', 'boss', 'result'].includes(next)) this._lastMusicalScene = next;
    if (next === 'pause' || next === 'choosing') this._stopVoices();
    this._syncMusic();
  }

  /** Hidden documents must call false; all sound sources stop, and the context is suspended. */
  setActive(active) {
    if (this.destroyed) return;
    this.active = Boolean(active);
    if (!this.active) {
      this._stopMusic();
      this._stopVoices();
      this._applyChannelLevels();
      this._suspend();
    } else if (this.unlocked) {
      this._applyChannelLevels();
      void this._activate();
    }
  }

  click() {
    if (!this._canSound() || !this._allow([['click', 0.055]])) return;
    this._tone(650, 0.07, 0.034, 420, 'triangle');
  }

  handleEvent(event = {}) {
    if (!this._canSound()) return;
    const inBattle = this.scene === 'battle' || this.scene === 'boss';
    const pan = Number.isFinite(event.x) ? clamp((event.x - 210) / 250, -0.7, 0.7) : 0;
    switch (event.type) {
      case 'attack': {
        if (!inBattle) return;
        const kind = event.campType;
        const base = AUDIO_TIMBRES.camps[kind];
        const custom = this.timbres.camps?.[kind];
        if (!base && !custom) return;
        const profile = { ...AUDIO_TIMBRES.camps.shield, ...base, ...custom };
        if (!this._allow([[`attack:${kind}`, profile.interval], [`camp:${kind}:${event.slot ?? 0}`, 0.30]])) return;
        this._tone(profile.frequency, profile.duration, profile.volume, profile.endFrequency, 'triangle', { pan });
        if (profile.noiseDuration > 0) this._noise(profile.noiseDuration, profile.noiseVolume, profile.cutoff, { pan });
        break;
      }
      case 'projectileImpact':
        if (!inBattle || !this._allow([['impact', 0.13]])) return;
        this._tone(92, 0.23, 0.13, 34, 'sine', { pan });
        this._noise(0.18, 0.076, 1050, { pan });
        break;
      case 'heroAttack':
        if (!inBattle || !this._allow([['hero', 0.25]])) return;
        {
          const heroId = event.heroId || this.heroId;
          const profile = { ...AUDIO_TIMBRES.heroes.guan_yu, ...AUDIO_TIMBRES.heroes[heroId], ...this.timbres.heroes?.[heroId] };
          this._noise(profile.noiseDuration, profile.noiseVolume, profile.cutoff);
          this._tone(profile.frequency, profile.duration, profile.volume, profile.endFrequency, 'triangle');
        }
        break;
      case 'ultimate':
        if (!this._allow([['ultimate', 0.35]])) return;
        this._duckMusic();
        this._noise(0.32, 0.22, 2400, { priority: 2 });
        this._tone(160, 0.48, 0.22, 32, 'triangle', { priority: 2 });
        this._tone(740, 0.22, 0.074, 170, 'sawtooth', { priority: 2 });
        break;
      case 'burst':
        if ((event.kills ?? event.count ?? 0) < 12 || !this._allow([['burst', 0.4]])) return;
        this._tone(587.33, 0.32, 0.045, 587.33, 'sine', { priority: 1 });
        this._tone(880, 0.3, 0.028, 880, 'sine', { delay: 0.05, priority: 1 });
        break;
      case 'build':
        if (!this._allow([['build', 0.12]])) return;
        this._tone(175, 0.12, 0.065, 90, 'triangle');
        this._tone(440, 0.17, 0.042, 440, 'sine', { delay: 0.06 });
        break;
      case 'upgrade':
      case 'tactic':
        if (!this._allow([['upgrade', 0.12]])) return;
        [440, 587.33, 880].forEach((frequency, index) => this._tone(frequency, 0.20, 0.042, frequency, 'sine', { delay: index * 0.075, priority: 1 }));
        break;
      case 'hit':
        if (!this._allow([['gateHit', 0.15]])) return;
        this._tone(72, 0.24, 0.13, 31, 'triangle', { priority: 1 });
        this._noise(0.11, 0.04, 720, { priority: 1 });
        break;
      case 'wave':
        if (!this._allow([['wave', 0.8]])) return;
        this._tone(event.boss ? 93 : 146.83, 0.38, 0.075, event.boss ? 42 : 73.42, 'triangle', { priority: 1 });
        if (event.boss) this._tone(123.47, 0.6, 0.055, 55, 'sawtooth', { delay: 0.10, priority: 1 });
        break;
      case 'win':
        this._stopVoices();
        [293.66, 392, 440, 587.33].forEach((frequency, index) => this._tone(frequency, 0.52, 0.065, frequency, 'triangle', { delay: index * 0.13, priority: 2 }));
        break;
      case 'lose':
        this._stopVoices();
        this._tone(196, 0.85, 0.065, 73.42, 'triangle', { priority: 2 });
        this._tone(146.83, 0.72, 0.044, 55, 'sine', { delay: 0.12, priority: 2 });
        break;
      default: break; // Per-enemy hits/kills deliberately do not add voices to dense battles.
    }
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.active = false;
    this._stopMusic();
    this._stopVoices();
    for (const node of [this._musicGain, this._sfxGain, this._masterGain, this._compressor]) {
      try { node?.disconnect(); } catch { /* Optional audio is best effort. */ }
    }
    this._buffers.clear();
    this._lastSound.clear();
    this._noiseBuffer = null;
    try { Promise.resolve(this.context?.close()).catch(() => {}); } catch { /* Context may already be closed. */ }
  }

  async _activate() {
    if (!this.unlocked || !this.active || this.destroyed) return false;
    try {
      if (!this.context && !this._createContext()) return false;
      if (this.context.state === 'suspended' || this.context.state === 'interrupted') {
        if (!this._resumePromise) {
          this._resumePromise = Promise.resolve(this.context.resume()).then(() => true, () => false).finally(() => { this._resumePromise = null; });
        }
        if (!await this._resumePromise) return false;
      }
      if (!this.active || this.destroyed) {
        this._suspend();
        return false;
      }
      if (this.context.state !== 'running') return false;
      this._applyChannelLevels();
      this._syncMusic();
      return true;
    } catch { return false; }
  }

  _createContext() {
    let context;
    const nodes = [];
    try {
      context = this._contextFactory();
      if (!context) return false;
      const master = context.createGain(); nodes.push(master);
      const music = context.createGain(); nodes.push(music);
      const sfx = context.createGain(); nodes.push(sfx);
      music.connect(master);
      sfx.connect(master);
      if (context.createDynamicsCompressor) {
        const compressor = context.createDynamicsCompressor(); nodes.push(compressor);
        compressor.threshold.value = -14;
        compressor.knee.value = 18;
        compressor.ratio.value = 5;
        compressor.attack.value = 0.003;
        compressor.release.value = 0.15;
        master.connect(compressor);
        compressor.connect(context.destination);
        this._compressor = compressor;
      } else master.connect(context.destination);
      this.context = context;
      this._masterGain = master;
      this._musicGain = music;
      this._sfxGain = sfx;
      this._applyChannelLevels();
      return true;
    } catch {
      for (const node of nodes) { try { node.disconnect(); } catch { /* Partial graph cleanup. */ } }
      try { Promise.resolve(context?.close()).catch(() => {}); } catch { /* Silent fallback. */ }
      return false;
    }
  }

  _suspend() {
    try { Promise.resolve(this.context?.suspend()).catch(() => {}); } catch { /* Mobile contexts can be interrupted. */ }
  }

  _applyChannelLevels() {
    if (!this.context) return;
    try {
      this._setGain(this._masterGain, this.active && !this.destroyed ? 0.8 : 0);
      this._setGain(this._sfxGain, this.sfxEnabled && this.active ? 0.80 : 0);
      this._setGain(this._musicGain, this.musicEnabled && this.active ? this._sceneVolume() : 0);
    } catch { /* Unsupported automation must never interrupt the game. */ }
  }

  _sceneVolume() {
    return this._musicVolume * (this.scene === 'pause' ? 0.22 : this.scene === 'choosing' ? 0.38 : this.scene === 'menu' ? 0.8 : 1);
  }

  _setGain(node, value) {
    if (!node) return;
    const now = this.context.currentTime;
    node.gain.cancelScheduledValues(now);
    node.gain.setValueAtTime(value, now);
  }

  _syncMusic() {
    if (!this.unlocked || !this.active || this.destroyed || !this.musicEnabled || this.context?.state !== 'running') return;
    const key = this.scene === 'pause' || this.scene === 'choosing' ? this._lastMusicalScene : this.scene;
    if (this.musicSource && this._musicKey === key) {
      try { this._setGain(this._musicGain, this._sceneVolume()); } catch { /* Silent fallback. */ }
      return;
    }
    this._stopMusic();
    let source;
    try {
      let buffer = this._buffers.get(key);
      if (!buffer) {
        buffer = this._renderScore(key);
        this._buffers.set(key, buffer);
      }
      source = this.context.createBufferSource();
      source.buffer = buffer;
      source.loop = true;
      source.connect(this._musicGain);
      source.onended = () => {
        try { source.disconnect(); } catch { /* Already disconnected. */ }
        if (this.musicSource === source) { this.musicSource = null; this._musicKey = null; }
      };
      this.musicSource = source;
      this._musicKey = key;
      this._setGain(this._musicGain, this._sceneVolume());
      source.start();
    } catch {
      try { source?.disconnect(); } catch { /* Partially initialized source. */ }
      if (this.musicSource === source) this.musicSource = null;
      this._musicKey = null;
    }
  }

  _stopMusic() {
    const source = this.musicSource;
    this.musicSource = null;
    this._musicKey = null;
    if (!source) return;
    source.onended = null;
    try { source.stop(); } catch { /* A stopped source cannot stop twice. */ }
    try { source.disconnect(); } catch { /* Optional audio cleanup. */ }
  }

  _canSound() {
    return !this.destroyed && this.unlocked && this.active && this.sfxEnabled && this.context?.state === 'running';
  }

  _allow(keys) {
    const now = this.context.currentTime;
    if (keys.some(([key, gap]) => now - (this._lastSound.get(key) ?? -Infinity) < gap)) return false;
    for (const [key] of keys) this._lastSound.set(key, now);
    return true;
  }

  _duckMusic() {
    if (!this.musicEnabled || !this._musicGain) return;
    try {
      const now = this.context.currentTime;
      const volume = this._sceneVolume();
      this._musicGain.gain.cancelScheduledValues(now);
      this._musicGain.gain.setValueAtTime(volume * 0.38, now);
      this._musicGain.gain.linearRampToValueAtTime(volume, now + 0.85);
    } catch { /* Gain automation is optional. */ }
  }

  _reserveVoice(priority) {
    const now = this.context.currentTime;
    for (const voice of this._voices) if (voice.end <= now) this._releaseVoice(voice);
    if (this._voices.size < MAX_VOICES) return true;
    const steal = [...this._voices].find(voice => voice.priority < priority);
    if (!steal) return false;
    this._releaseVoice(steal, true);
    return true;
  }

  _startVoice(source, extraNodes, gain, duration, volume, { delay = 0, priority = 0, pan = 0 } = {}) {
    if (!this._canSound() || !this._reserveVoice(priority)) {
      for (const node of [source, ...extraNodes, gain]) { try { node.disconnect(); } catch { /* Unused graph. */ } }
      return;
    }
    const now = this.context.currentTime;
    const start = now + delay;
    const end = start + duration + 0.015;
    const nodes = [source, ...extraNodes, gain];
    const voice = { source, nodes, end, priority, released: false };
    try {
      let output = gain;
      if (this.context.createStereoPanner) {
        const panner = this.context.createStereoPanner();
        panner.pan.value = pan;
        gain.connect(panner);
        output = panner;
        nodes.push(panner);
      }
      output.connect(this._sfxGain);
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.linearRampToValueAtTime(volume, start + Math.min(0.008, duration / 5));
      gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
      source.onended = () => this._releaseVoice(voice);
      this._voices.add(voice);
      source.start(start);
      source.stop(end);
    } catch { this._releaseVoice(voice, true); }
  }

  _tone(frequency, duration, volume, endFrequency = frequency, type = 'sine', options = {}) {
    if (!this._canSound()) return;
    let source, gain;
    try {
      source = this.context.createOscillator();
      gain = this.context.createGain();
      source.type = type;
      const start = this.context.currentTime + (options.delay || 0);
      source.frequency.setValueAtTime(Math.max(20, frequency), start);
      source.frequency.exponentialRampToValueAtTime(Math.max(20, endFrequency), start + duration);
      source.connect(gain);
      this._startVoice(source, [], gain, duration, volume, options);
    } catch {
      try { source?.disconnect(); gain?.disconnect(); } catch { /* Audio-node creation may be unavailable. */ }
    }
  }

  _noise(duration, volume, cutoff, options = {}) {
    if (!this._canSound()) return;
    let source, filter, gain;
    try {
      if (!this._noiseBuffer) {
        this._noiseBuffer = this.context.createBuffer(1, Math.ceil(this.context.sampleRate * 0.5), this.context.sampleRate);
        const samples = this._noiseBuffer.getChannelData(0);
        let seed = 918273;
        for (let i = 0; i < samples.length; i++) {
          seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
          samples[i] = seed / 2147483648 - 1;
        }
      }
      source = this.context.createBufferSource();
      source.buffer = this._noiseBuffer;
      filter = this.context.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.value = cutoff;
      filter.Q.value = 0.7;
      gain = this.context.createGain();
      source.connect(filter);
      filter.connect(gain);
      this._startVoice(source, [filter], gain, duration, volume, options);
    } catch {
      for (const node of [source, filter, gain]) { try { node?.disconnect(); } catch { /* Partial graph cleanup. */ } }
    }
  }

  _releaseVoice(voice, stop = false) {
    if (voice.released) return;
    voice.released = true;
    voice.source.onended = null;
    if (stop) { try { voice.source.stop(); } catch { /* Already finished. */ } }
    for (const node of voice.nodes) { try { node.disconnect(); } catch { /* Already disconnected. */ } }
    this._voices.delete(voice);
  }

  _stopVoices() {
    for (const voice of this._voices) this._releaseVoice(voice, true);
  }

  /** Eight-bar pentatonic motifs, plucked harmonics and hand-drum synthesis, authored here. */
  _renderScore(scene) {
    const rate = this.context.sampleRate;
    const tempo = scene === 'boss' ? 132 : scene === 'battle' ? 116 : scene === 'result' ? 92 : 86;
    const beat = 60 / tempo;
    const length = Math.ceil(32 * beat * rate);
    const buffer = this.context.createBuffer(1, length, rate);
    const out = buffer.getChannelData(0);
    const midi = note => 440 * 2 ** ((note - 69) / 12);
    let seed = 13579;
    const noise = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 2147483648 - 1; };
    const addTone = (at, note, duration, volume, pluck = true) => {
      const start = Math.floor(at * rate);
      const count = Math.ceil(duration * rate);
      const frequency = midi(note);
      for (let i = 0; i < count; i++) {
        const t = i / rate;
        const envelope = pluck ? Math.min(1, t / 0.004) * Math.exp(-t / (duration * 0.19)) : Math.sin(Math.PI * t / duration) ** 2;
        const sound = Math.sin(TAU * frequency * t) + (pluck ? 0.26 : 0.08) * Math.sin(TAU * frequency * t * 2) + (pluck ? 0.08 : 0) * Math.sin(TAU * frequency * t * 3);
        out[(start + i) % length] += sound * envelope * volume;
      }
    };
    const drum = (at, strong, volume) => {
      const start = Math.floor(at * rate);
      const duration = strong ? 0.23 : 0.095;
      for (let i = 0; i < Math.ceil(duration * rate); i++) {
        const t = i / rate;
        const phase = TAU * (48 * t + (strong ? 82 : 155) * (1 - Math.exp(-22 * t)) / 22);
        const envelope = Math.exp(-t * (strong ? 21 : 45)) * Math.min(1, t / 0.002);
        out[(start + i) % length] += (Math.sin(phase) + noise() * (strong ? 0.14 : 0.40)) * envelope * volume;
      }
    };
    const melody = scene === 'boss'
      ? [0, 7, 10, 7, 5, 3, 0, 3, 5, 7, 10, 12, 10, 7, 5, 3]
      : scene === 'result'
        ? [0, null, 5, 7, 12, null, 10, 7, 5, null, 7, 10, 12, null, 7, 5]
        : [0, null, 7, 5, 3, null, 0, 3, 5, 7, 10, null, 7, 5, 3, null];
    const roots = [50, 50, 48, 48, 53, 53, 50, 50];
    for (let bar = 0; bar < 8; bar++) {
      const root = roots[bar];
      const at = bar * 4 * beat;
      addTone(at, root - 12, 3.8 * beat, 0.027, false);
      addTone(at, root - 5, 3.8 * beat, 0.016, false);
      for (let step = 0; step < 8; step++) {
        const offset = melody[(bar * 8 + step) % melody.length];
        if (offset !== null) addTone(at + step * beat / 2 + 0.018, root + 12 + offset, beat * 0.85, scene === 'menu' ? 0.095 : 0.11);
        if (scene === 'battle' || scene === 'boss') {
          addTone(at + step * beat / 2, root + (step % 2 ? 7 : 0), beat * 0.40, 0.033);
          if (step % 2 === 0 || scene === 'boss') drum(at + step * beat / 2, step === 0 || step === 4, step === 0 ? 0.19 : 0.105);
        } else if (scene !== 'result' && step % 4 === 0) drum(at + step * beat / 2, true, 0.045);
      }
    }
    let peak = 0;
    for (const sample of out) peak = Math.max(peak, Math.abs(sample));
    if (peak > 0.65) for (let i = 0; i < out.length; i++) out[i] *= 0.65 / peak;
    return buffer;
  }
}
