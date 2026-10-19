/** Original, asset-free Web Audio score and combat sounds. No scheduler timers are used. */
const SCENES = new Set(['menu', 'battle', 'boss', 'pause', 'choosing', 'result']);
const MAX_VOICES = 18;
const TAU = Math.PI * 2;
const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
const audioFactory = () => {
  const Audio = globalThis.AudioContext || globalThis.webkitAudioContext;
  return Audio ? new Audio({ latencyHint: 'interactive' }) : null;
};

const note = (frequency, duration, volume, delay = 0, endFrequency = frequency, type = 'sine') => Object.freeze({ frequency, endFrequency, duration, volume, delay, type });
const noise = (duration, volume, cutoff, delay = 0, endCutoff = cutoff) => Object.freeze({ duration, volume, cutoff, endCutoff, delay });
const cue = (interval, priority, tones = [], noises = []) => Object.freeze({ interval, priority, tones:Object.freeze(tones), noises:Object.freeze(noises) });
// Long envelopes use short, cancellable pulses rather than exceeding the shared
// per-voice budget. Noise filter cutoffs describe colour, not oscillator pitch.
export const ROGUELIKE_AUDIO_TIMBRES = Object.freeze({
  tacticOffer:cue(.30, 3, [note(520,.07,.035,0,520,'triangle'),note(660,.07,.035,.07,660,'triangle'),note(780,.07,.035,.14,780,'triangle')]),
  tacticPick:cue(.15, 3, [note(740,.12,.06,0,420,'triangle')], [noise(.05,.025,2600)]),
  cardEpic:cue(.30, 4, [note(660,.22,.07),note(990,.22,.07)]),
  cardLegendary:cue(.30, 5, [523,659,784,1047].map((frequency,index) => note(frequency,.09,.08,index*.09)).concat([note(131,.17,.045,.36),note(131,.17,.03,.53),note(131,.16,.018,.70)])),
  reroll:cue(.20, 2, [], [noise(.14,.045,800,0,3200)]),
  skip:cue(.30, 2, [note(180,.18,.05,0,90,'triangle')]),
  gateRepair:cue(.30, 3, [note(330,.14,.05,0,412),note(412,.14,.035,.14,494)]),
  campLevel5:cue(.30, 5, [note(90,.15,.10,0,65,'triangle'),note(65,.15,.07,.15,47,'triangle')], [noise(.18,.055,800,0,3200)]),
  synergy:cue(.30, 5, [0,.18,.36].flatMap((delay,index) => [392,494,587].map(frequency => note(frequency,.19,[.075,.045,.025][index],delay)))),
  endlessBoss:cue(.30, 5, [0,.42,.84].flatMap(delay => [note(70,.15,.11,delay,55,'triangle'),note(55,.15,.07,delay+.15,47,'triangle')]), [0,.42,.84].map(delay => noise(.15,.04,480,delay))),
  waveMilestone:cue(.30, 5, [0,.18,.36,.54,.72].flatMap((delay,index) => [261,392].map(frequency => note(frequency,.18,[.08,.06,.04,.025,.018][index],delay))))
});
export const ROGUELIKE_COMBO_PAIRS = Object.freeze({
  combo_east_wind:Object.freeze(['zhuge_liang','zhou_yu']), combo_righteous_sky:Object.freeze(['liu_bei','guan_yu']),
  combo_changban_guard:Object.freeze(['zhang_fei','zhao_yun']), combo_thunder_rain:Object.freeze(['sima_yi','gan_ning']),
  combo_tiger_command:Object.freeze(['xu_chu','cao_cao']), combo_divine_cavalry:Object.freeze(['taishi_ci','zhang_liao']),
  combo_chibi_fire:Object.freeze(['sun_quan','zhou_yu']), combo_one_eye_tiger:Object.freeze(['xiahou_dun','xu_chu'])
});

// Future heroes/camps can override these timbres without changing the combat engine.
export const AUDIO_TIMBRES = Object.freeze({
  roguelike:ROGUELIKE_AUDIO_TIMBRES,
  heroCombo: Object.freeze({frequency:82,endFrequency:52,duration:.20,volume:.09,noiseDuration:.12,noiseVolume:.035,cutoff:1100,interval:.30}),
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
  constructor({ musicEnabled = true, sfxEnabled = true, musicVolume = 0.8, sfxVolume = 0.8, heroId = 'guan_yu', timbres = {}, contextFactory = audioFactory } = {}) {
    this.musicEnabled = Boolean(musicEnabled);
    this.sfxEnabled = Boolean(sfxEnabled);
    this.musicLevel = Number.isFinite(musicVolume) ? clamp(musicVolume, 0, 1) : 0.8;
    this.sfxLevel = Number.isFinite(sfxVolume) ? clamp(sfxVolume, 0, 1) : 0.8;
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
    this._combatEvents = new Map();
    this._musicKey = null;
    this._lastMusicalScene = 'menu';
    this._resumePromise = null;
    this._musicVolume = 0.36;
    this._noiseBuffer = null;
    this._battleAudioContext = { mode:'campaign', wave:0 };
    this._roguelikeQuietUntil = 0;
    this._ambientCursor = null;
    this._attackDetuneIndex = 0;
  }

  /** Call from a user gesture. Rejected autoplay permissions simply leave the game silent. */
  async unlock() {
    if (this.destroyed) return false;
    this.unlocked = true;
    return this._activate();
  }

  setPreferences({ musicEnabled, sfxEnabled, musicVolume, sfxVolume } = {}) {
    if (typeof musicEnabled === 'boolean') this.musicEnabled = musicEnabled;
    if (typeof sfxEnabled === 'boolean') this.sfxEnabled = sfxEnabled;
    if (Number.isFinite(musicVolume)) this.musicLevel = clamp(musicVolume, 0, 1);
    if (Number.isFinite(sfxVolume)) this.sfxLevel = clamp(sfxVolume, 0, 1);
    if (!this.sfxEnabled) this._stopVoices();
    else if (this.sfxLevel === 0) this._cancelRoguelikeAudio();
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
    if (!(this._isCombatScene(this.scene) && this._isCombatScene(next))) this._cancelRoguelikeAudio();
    this.scene = next;
    if (next === 'menu' || (next === 'battle' && ['menu', 'result'].includes(this._lastMusicalScene))) this._combatEvents.clear();
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
    // A soft wooden tick with three alternating pitches avoids a machine-gun feel in menus.
    this._clickIndex = ((this._clickIndex ?? 0) + 1) % 3;
    this._tone(600 + this._clickIndex * 28, 0.06, 0.024, 380, 'triangle');
  }

  _isCombatScene(scene = this.scene) { return scene === 'battle' || scene === 'boss'; }

  /** Optional explicit reset; ordinary engine events also carry this context. */
  setBattleContext({ mode = 'campaign', wave } = {}) {
    const previous = this._battleAudioContext, nextMode = mode === 'endless' ? 'endless' : 'campaign';
    const nextWave = Number.isInteger(wave) && wave >= 0 ? wave : previous.wave;
    if (nextMode !== previous.mode) this._cancelRoguelikeAudio();
    else if ((previous.wave >= 51 ? 2 : previous.wave >= 26 ? 1 : 0) !== (nextWave >= 51 ? 2 : nextWave >= 26 ? 1 : 0)) this._cancelAmbient();
    this._battleAudioContext = { mode:nextMode, wave:nextMode === 'endless' ? nextWave : 0 };
  }

  /** Called by the UI frame loop; AudioContext wall time schedules a tiny horizon. */
  update() {
    const { mode,wave } = this._battleAudioContext;
    if (mode !== 'endless' || wave < 26 || !this._isCombatScene() || !this._canSound() || !this.sfxLevel || this.context.currentTime < this._roguelikeQuietUntil) {
      this._cancelAmbient(); return;
    }
    const now = this.context.currentTime;
    this._ambientCursor = Math.max(now,this._ambientCursor ?? now);
    while (this._ambientCursor < now + .35) {
      this._noise(.20,wave >= 51 ? .026 : .018,wave >= 51 ? 180 : 120,{delay:this._ambientCursor - now,priority:-1,roguelike:true,role:'ambient'});
      this._ambientCursor += .20;
    }
  }

  _playRoguelikeCue(type) {
    const sound = ROGUELIKE_AUDIO_TIMBRES[type];
    if (!sound || !this.sfxLevel || this.scene === 'pause' || this.context.currentTime < this._roguelikeQuietUntil && sound.priority < 5 || !this._allow([['roguelike:' + type,sound.interval]])) return;
    const options = { priority:sound.priority,roguelike:true,role:type };
    for (const tone of sound.tones) this._tone(tone.frequency,tone.duration,tone.volume,tone.endFrequency,tone.type,{...options,delay:tone.delay});
    for (const layer of sound.noises) this._noise(layer.duration,layer.volume,layer.cutoff,{...options,delay:layer.delay,endCutoff:layer.endCutoff});
  }

  _playRoguelikeCombo(event) {
    const now = this.context.currentTime;
    if (!this.sfxLevel || now < this._roguelikeQuietUntil || !this._allow([['roguelike:heroCombo',.30]])) return;
    this._cancelAmbient();
    for (const voice of this._voices) if (voice.priority < 5) this._releaseVoice(voice,true);
    this._roguelikeQuietUntil = now + 1.5;
    this._duckMusic(1.5);
    const options = { priority:6,roguelike:true,role:'heroCombo' };
    // The freeze pad spans 0–.25; the two voices enter at .25/.33, the
    // metallic title at .60, and the final impact at 1.10 (47 Hz floor).
    this._tone(60,.13,.055,60,'sine',options);
    this._tone(60,.13,.035,60,'sine',{...options,delay:.12});
    const pair = ROGUELIKE_COMBO_PAIRS[event.comboId] || [event.fromHeroId,event.toHeroId];
    for (const [index,id] of [event.fromHeroId || pair[0],event.toHeroId || pair[1]].entries()) {
      const hero = { ...AUDIO_TIMBRES.heroes.guan_yu,...AUDIO_TIMBRES.heroes[id],...this.timbres.heroes?.[id] };
      const divisor = index ? 1 : 2;
      this._tone(clamp(hero.frequency / divisor,47,1100),.20,.075,clamp(hero.endFrequency / divisor,47,1100),'triangle',{...options,delay:.25 + index * .08});
    }
    for (const [index,delay] of [.60,.80,1.00].entries()) {
      this._noise(index === 2 ? .10 : .20,[.09,.055,.03][index],4200,{...options,delay});
      this._tone(880 - index * 146,.20,[.06,.04,.025][index],734 - index * 147,'sine',{...options,delay});
    }
    this._tone(47,.20,.12,47,'triangle',{...options,delay:1.10});
    this._tone(47,.20,.075,47,'triangle',{...options,delay:1.30});
  }

  _cancelAmbient() {
    for (const voice of this._voices) if (voice.role === 'ambient') this._releaseVoice(voice,true);
    this._ambientCursor = null;
  }

  _cancelRoguelikeAudio() {
    const restore = this._roguelikeQuietUntil > 0;
    for (const voice of this._voices) if (voice.roguelike) this._releaseVoice(voice,true);
    this._ambientCursor = null; this._roguelikeQuietUntil = 0;
    if (restore && this.context) try { this._setGain(this._musicGain,this.musicEnabled && this.active ? this._sceneVolume() : 0); } catch { /* Optional automation. */ }
  }

  handleEvent(event = {}) {
    // Enemy IDs restart in each battle, including retries requested while paused or muted.
    if (event.type === 'start') {
      this._combatEvents.clear(); this._cancelRoguelikeAudio(); this._attackDetuneIndex = 0;
      for (const key of this._lastSound.keys()) if (key.startsWith('roguelike:')) this._lastSound.delete(key);
      this.setBattleContext({ mode:event.mode, wave:event.wave || 1 });
    } else if (event.mode === 'endless') this.setBattleContext({ mode:'endless', wave:event.wave });
    if (!this._canSound()) return;
    if (Object.hasOwn(ROGUELIKE_AUDIO_TIMBRES,event.type)) { this._playRoguelikeCue(event.type); return; }
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
        const endless = event.mode === 'endless', late = endless && this._battleAudioContext.wave >= 51;
        const globalGap = endless && this._battleAudioContext.wave >= 26 ? clamp(profile.interval * (late ? .8 : 1),.10,.30) : profile.interval;
        if (!this._allow([[`attack:${kind}`, globalGap], [`camp:${kind}:${event.slot ?? 0}`, late ? .20 : .30]])) return;
        if (endless) {
          const detune = this._battleAudioContext.wave >= 26 ? (++this._attackDetuneIndex % 2 ? -6 : 6) : 0;
          this._tone(clamp(profile.frequency + detune,47,1100),clamp(profile.duration,.05,.23),clamp(profile.volume,.018,.13),clamp(profile.endFrequency + detune,47,1100),'triangle',{pan,roguelike:true});
          if (profile.noiseDuration > 0) this._noise(clamp(profile.noiseDuration,.05,.23),clamp(profile.noiseVolume,.018,.13),profile.cutoff,{pan,roguelike:true});
        } else {
          this._tone(profile.frequency, profile.duration, profile.volume, profile.endFrequency, 'triangle', { pan });
          if (profile.noiseDuration > 0) this._noise(profile.noiseDuration, profile.noiseVolume, profile.cutoff, { pan });
        }
        break;
      }
      case 'projectileImpact':
        if (!inBattle || !this._allow([['impact', 0.13]])) return;
        this._tone(92, 0.23, 0.13, 34, 'sine', { pan });
        this._noise(0.18, 0.076, 1050, { pan });
        break;
      case 'damage': {
        if (!inBattle || !(event.amount > 0) || !this._freshCombatEvent(event, false)) return;
        const skill = String(event.source || '').startsWith('ultimate_') || event.castId != null;
        if (!this._allow([['enemyDamage', skill ? 0.10 : 0.075]])) return;
        this._tone(skill ? 118 : 195, skill ? 0.12 : 0.065, skill ? 0.055 : 0.025, skill ? 43 : 88, 'triangle', { pan });
        this._noise(skill ? 0.065 : 0.035, skill ? 0.026 : 0.016, skill ? 1500 : 2100, { pan });
        break;
      }
      case 'kill': {
        if (!inBattle || !this._freshCombatEvent(event, true)) return;
        const boss = event.enemyType === 'boss';
        const heavy = boss || ['elite', 'armor', 'ranged', 'banner', 'siege'].includes(event.enemyType);
        // Global buckets preserve a heavy death arriving after a soldier crowd, without one voice per enemy.
        if (!this._allow([[boss ? 'death:boss' : heavy ? 'death:heavy' : 'death:soldier', boss ? 0.28 : heavy ? 0.18 : 0.12]])) return;
        const options = { pan, priority: heavy ? 1 : 0 };
        this._tone(boss ? 82 : heavy ? 108 : 148, boss ? 0.27 : heavy ? 0.18 : 0.105, boss ? 0.095 : heavy ? 0.064 : 0.036, boss ? 26 : heavy ? 35 : 54, 'triangle', options);
        this._noise(boss ? 0.15 : heavy ? 0.11 : 0.065, boss ? 0.048 : heavy ? 0.034 : 0.022, boss ? 580 : heavy ? 870 : 1250, options);
        if (boss) this._tone(245, 0.11, 0.026, 93, 'sine', { ...options, delay: 0.025 });
        break;
      }
      case 'heroAttack':
        if (!inBattle || !this._allow([['hero', 0.25]])) return;
        {
          const heroId = event.heroId || this.heroId;
          const profile = { ...AUDIO_TIMBRES.heroes.guan_yu, ...AUDIO_TIMBRES.heroes[heroId], ...this.timbres.heroes?.[heroId] };
          this._noise(profile.noiseDuration, profile.noiseVolume, profile.cutoff);
          this._tone(profile.frequency, profile.duration, profile.volume, profile.endFrequency, 'triangle');
        }
        break;
      case 'skillQueued': {
        // Tap acknowledgement / windup: a short rising draw so the press is heard even if the queue waits.
        if (!this._allow([['skillQueued', 0.12]])) return;
        this._tone(220, 0.14, 0.05, 520, 'triangle', { priority: 2 });
        this._noise(0.09, 0.03, 3200, { priority: 1 });
        break;
      }
      case 'rageReady': {
        // Ready cue: a two-stroke bronze gong, quiet enough to repeat across a long battle.
        if (!this._allow([['rageReady', 2.5]])) return;
        this._tone(392, 0.42, 0.034, 392, 'sine', { priority: 1 });
        this._tone(587.33, 0.5, 0.028, 587.33, 'sine', { delay: 0.11, priority: 1 });
        break;
      }
      case 'leak': {
        // Gate damage: low wooden thud, panned to the gate; merged so a breaching crowd is one alarm, not a drumroll.
        if (!inBattle || !this._allow([['gateHit', 0.22]])) return;
        this._tone(68, 0.26, 0.11, 30, 'triangle', { priority: 1 });
        this._noise(0.12, 0.045, 640, { priority: 1 });
        break;
      }
      case 'ultimate': {
        if (!this._allow([['ultimate', 0.35]])) return;
        this._duckMusic();
        // Shared weight (noise + low body) plus a per-hero signature pitch, so each general's ultimate sounds distinct.
        const hero = { ...AUDIO_TIMBRES.heroes.guan_yu, ...AUDIO_TIMBRES.heroes[event.heroId], ...this.timbres.heroes?.[event.heroId] };
        const lift = hero.frequency / AUDIO_TIMBRES.heroes.guan_yu.frequency;
        this._noise(0.32, 0.2, clamp(hero.cutoff * 1.25, 1400, 3600), { priority: 2 });
        this._tone(160, 0.48, 0.2, 32, 'triangle', { priority: 2 });
        this._tone(740 * lift, 0.24, 0.066, 170 * lift, 'sawtooth', { priority: 2 });
        break;
      }
      case 'burst':
        if ((event.kills ?? event.count ?? 0) < 12 || !this._allow([['burst', 0.4]])) return;
        this._tone(587.33, 0.32, 0.045, 587.33, 'sine', { priority: 1 });
        this._tone(880, 0.3, 0.028, 880, 'sine', { delay: 0.05, priority: 1 });
        // A large clear earns a third, higher stroke; ordinary bursts stay two-note so the peak stays special.
        if ((event.kills ?? event.count ?? 0) >= 40) this._tone(1174.66, 0.42, 0.024, 1174.66, 'sine', { delay: 0.12, priority: 1 });
        break;
      case 'combo': {
        // Milestones only (20/50/100): a low drum plus a rising bell, brighter for longer streaks.
        if (!this._allow([['combo', 0.6]])) return;
        const tier = event.count >= 100 ? 2 : event.count >= 50 ? 1 : 0;
        this._tone(110, 0.2, 0.06, 55, 'triangle', { priority: 1 });
        [523.25, 659.25, 783.99].slice(0, tier + 2).forEach((frequency, index) => this._tone(frequency * (1 + tier * 0.06), 0.22, 0.032, frequency, 'sine', { delay: 0.04 + index * 0.06, priority: 1 }));
        break;
      }
      case 'heroCombo': {
        if (event.presentation === 'roguelike') { if (inBattle) this._playRoguelikeCombo(event); break; }
        const sound = AUDIO_TIMBRES.heroCombo;
        if (!inBattle || !this._allow([['heroCombo',sound.interval]])) return;
        this._duckMusic();
        this._tone(sound.frequency,sound.duration,sound.volume,sound.endFrequency,'triangle',{priority:3});
        this._tone(660,.18,.035,880,'sine',{delay:.05,priority:3});
        this._noise(sound.noiseDuration,sound.noiseVolume,sound.cutoff,{priority:3});
        break;
      }
      case 'build':
        if (!this._allow([['build', 0.12]])) return;
        this._tone(175, 0.12, 0.065, 90, 'triangle');
        this._tone(440, 0.17, 0.042, 440, 'sine', { delay: 0.06 });
        break;
      case 'upgrade':
        if (!this._allow([['upgrade', 0.12]])) return;
        [440, 587.33, 880].forEach((frequency, index) => this._tone(frequency, 0.20, 0.042, frequency, 'sine', { delay: index * 0.075, priority: 1 }));
        break;
      case 'tactic':
        if (event.presentation === 'roguelike') { this._playRoguelikeCue('tacticPick'); break; }
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
        this._battleAudioContext = { mode:'campaign', wave:0 };
        this._stopVoices();
        [293.66, 392, 440, 587.33].forEach((frequency, index) => this._tone(frequency, 0.52, 0.065, frequency, 'triangle', { delay: index * 0.13, priority: 2 }));
        break;
      case 'lose':
        this._battleAudioContext = { mode:'campaign', wave:0 };
        this._stopVoices();
        this._tone(196, 0.85, 0.065, 73.42, 'triangle', { priority: 2 });
        this._tone(146.83, 0.72, 0.044, 55, 'sine', { delay: 0.12, priority: 2 });
        break;
      default: break;
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
    this._combatEvents.clear();
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
      this._setGain(this._sfxGain, this.sfxEnabled && this.active ? 0.80 * this.sfxLevel : 0);
      this._setGain(this._musicGain, this.musicEnabled && this.active ? this._sceneVolume() : 0);
    } catch { /* Unsupported automation must never interrupt the game. */ }
  }

  _sceneVolume() {
    // Menu sits well under battle so the camp feels calm; pause and choice duck further.
    return this._musicVolume * (this.musicLevel ?? 1) * (this.scene === 'pause' ? 0.22 : this.scene === 'choosing' ? 0.38 : this.scene === 'menu' ? 0.55 : 1);
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
      if (this.context.currentTime < this._roguelikeQuietUntil) this._duckMusic(this._roguelikeQuietUntil - this.context.currentTime);
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
      if (this.context.currentTime < this._roguelikeQuietUntil) this._duckMusic(this._roguelikeQuietUntil - this.context.currentTime);
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

  _freshCombatEvent(event, death) {
    if (event.enemyId == null) return true;
    const key = `${death ? 'kill' : 'damage'}:${event.enemyId}`;
    const now = this.context.currentTime;
    const previous = this._combatEvents.get(key);
    if (previous != null && (death || now - previous < 0.06)) return false;
    this._combatEvents.delete(key);
    this._combatEvents.set(key, now);
    // Bounded history exceeds the simultaneous enemy budget and never schedules delayed crowd sounds.
    if (this._combatEvents.size > 512) this._combatEvents.delete(this._combatEvents.keys().next().value);
    return true;
  }

  _duckMusic(duration = 1.2) {
    if (!this.musicEnabled || !this._musicGain) return;
    try {
      const now = this.context.currentTime;
      const volume = this._sceneVolume();
      this._musicGain.gain.cancelScheduledValues(now);
      // Peerless owns the mix for ~1 s: drop to 30% under the windup and impact, then breathe back in.
      this._musicGain.gain.setValueAtTime(volume * 0.3, now);
      this._musicGain.gain.linearRampToValueAtTime(volume * 0.3, now + Math.min(.45,duration / 2));
      this._musicGain.gain.linearRampToValueAtTime(volume, now + duration);
    } catch { /* Gain automation is optional. */ }
  }

  _reserveVoice(priority) {
    const now = this.context.currentTime;
    if (now < this._roguelikeQuietUntil && priority < 5) return false;
    for (const voice of this._voices) if (voice.end <= now) this._releaseVoice(voice);
    if (this._voices.size < MAX_VOICES) return true;
    const steal = [...this._voices].find(voice => voice.priority < priority);
    if (!steal) return false;
    this._releaseVoice(steal, true);
    return true;
  }

  _startVoice(source, extraNodes, gain, duration, volume, { delay = 0, priority = 0, pan = 0, roguelike = false, role = null } = {}) {
    if (!this._canSound() || !this._reserveVoice(priority)) {
      for (const node of [source, ...extraNodes, gain]) { try { node.disconnect(); } catch { /* Unused graph. */ } }
      return;
    }
    const now = this.context.currentTime;
    const start = now + delay;
    const end = start + duration + 0.015;
    const nodes = [source, ...extraNodes, gain];
    const voice = { source, nodes, end, priority, released: false, ...(roguelike ? {roguelike,role} : {}) };
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
      if (Number.isFinite(options.endCutoff) && options.endCutoff !== cutoff) {
        const start = this.context.currentTime + (options.delay || 0);
        filter.frequency.setValueAtTime(cutoff,start); filter.frequency.linearRampToValueAtTime(options.endCutoff,start + duration);
      }
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
    this._cancelRoguelikeAudio();
  }

  /** Eight-bar pentatonic motifs, plucked harmonics and hand-drum synthesis, authored here. */
  _renderScore(scene) {
    const rate = this.context.sampleRate;
    const tempo = scene === 'boss' ? 132 : scene === 'battle' ? 116 : scene === 'result' ? 92 : 72;
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
        // Menu: sparse plucks on every other step, no drums. Battle keeps the driving pulse.
        if (offset !== null && (scene !== 'menu' || step % 2 === 0)) addTone(at + step * beat / 2 + 0.018, root + 12 + offset, beat * (scene === 'menu' ? 1.4 : 0.85), scene === 'menu' ? 0.07 : 0.11);
        if (scene === 'battle' || scene === 'boss') {
          addTone(at + step * beat / 2, root + (step % 2 ? 7 : 0), beat * 0.40, 0.033);
          if (step % 2 === 0 || scene === 'boss') drum(at + step * beat / 2, step === 0 || step === 4, step === 0 ? 0.19 : 0.105);
        } else if (scene === 'pause' && step % 4 === 0) drum(at + step * beat / 2, true, 0.045);
      }
    }
    let peak = 0;
    for (const sample of out) peak = Math.max(peak, Math.abs(sample));
    if (peak > 0.65) for (let i = 0; i < out.length; i++) out[i] *= 0.65 / peak;
    return buffer;
  }
}
