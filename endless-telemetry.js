import {BALANCE} from './runtime-data.js';

/** Local tuning counters are independent of both the campaign save and the rolling event log. */
export const ENDLESS_TELEMETRY_KEY = 'wushuang-guard-endless-telemetry-v1';
export const ENDLESS_TELEMETRY_RUN_LIMIT = 30;
export const ENDLESS_TELEMETRY_TARGETS = Object.freeze({
  firstDeathWave:Object.freeze([25,35]),practicedDeathWave:Object.freeze([50,65]),topDeathWave:75,
  hesitationSec:Object.freeze([4,8]),gateAcquisitionRate:Object.freeze([.15,.25]),practicedFromRun:10,
});
const COHORTS = ['first','learning','practiced'];
const CATEGORIES = ['attribute','camp','hero','synergy','unknown'];
const RARITIES = ['common','rare','epic','legendary','unknown'];
const ANCHORS = [10,20,25,30,35,40,45,50,60,70,80];
const finite = (value,fallback = 0) => Number.isFinite(value) ? Math.max(0,Math.min(Number.MAX_SAFE_INTEGER,value)) : fallback;
const count = value => Math.floor(finite(value));
const waveOf = (game,fallback = 0) => count(game?.wave ?? fallback);
const mean = (total,samples) => samples ? total / samples : null;
const cohortFor = ordinal => ordinal === 1 ? 'first' : ordinal < 10 ? 'learning' : 'practiced';
const histogram = keys => Object.fromEntries(keys.map(key => [key,0]));
function freshState() {
  return {version:1,ordinal:0,runs:{finished:0,deaths:0,abandoned:0,won:0,deathWaveTotal:0},
    cohorts:Object.fromEntries(COHORTS.map(key => [key,{started:0,deaths:0,deathWaveTotal:0}])),
    choices:{selected:0,gateSelected:0,hesitationSamples:0,hesitationMs:0,skipped:0,rerolls:0,categories:histogram(CATEGORIES),rarities:histogram(RARITIES)},
    offers:{count:0,cards:0,gateCards:0},anchorDeaths:histogram(ANCHORS.map(String)),recentRuns:[]};
}
function readCounters(target,source) {
  for (const key of Object.keys(target)) if (typeof target[key] === 'number') target[key] = finite(source?.[key]);
  return target;
}
function readState(storage) {
  const state = freshState();
  try {
    const data = JSON.parse(storage?.getItem(ENDLESS_TELEMETRY_KEY) || 'null'); if (data?.version !== 1) return state;
    state.ordinal = count(data.ordinal); readCounters(state.runs,data.runs); readCounters(state.choices,data.choices); readCounters(state.offers,data.offers);
    for (const key of COHORTS) readCounters(state.cohorts[key],data.cohorts?.[key]);
    readCounters(state.choices.categories,data.choices?.categories); readCounters(state.choices.rarities,data.choices?.rarities); readCounters(state.anchorDeaths,data.anchorDeaths);
    if (Array.isArray(data.recentRuns)) state.recentRuns = data.recentRuns.slice(-ENDLESS_TELEMETRY_RUN_LIMIT).filter(run => run && COHORTS.includes(run.cohort) && ['lost','won','abandoned'].includes(run.outcome)).map(run => ({
      runId:String(run.runId || '').slice(0,80),ordinal:count(run.ordinal),cohort:run.cohort,outcome:run.outcome,wave:count(run.wave),combatSec:finite(run.combatSec),
      selected:count(run.selected),gateSelected:count(run.gateSelected),hesitationSamples:count(run.hesitationSamples),totalHesitationSec:finite(run.totalHesitationSec),
      averageHesitationSec:count(run.hesitationSamples) ? finite(run.totalHesitationSec) / count(run.hesitationSamples) : null,skipped:count(run.skipped),rerolls:count(run.rerolls),
    }));
  } catch { /* Optional local observation must survive corrupt or unavailable storage. */ }
  return state;
}
function cardInfo(game,value) {
  const card = typeof value === 'string' ? {id:value} : value || {},definition = game?.tacticDefinition?.(card.id) || BALANCE.tactics[card.id] || {};
  const entry = {...definition,...card},category = entry.category || (entry.hero ? 'hero' : entry.camp ? 'camp' : 'unknown');
  return {id:typeof entry.id === 'string' ? entry.id.slice(0,100) : null,category:CATEGORIES.includes(category) ? category : 'unknown',rarity:RARITIES.includes(entry.rarity) ? entry.rarity : 'unknown',gate:typeof entry.id === 'string' && entry.id.startsWith('attr_gate_')};
}

export class EndlessRunTelemetry {
  constructor({telemetry = null,storage = telemetry?.storage ?? null,clock = telemetry?.clock ?? (() => globalThis.performance?.now?.() ?? Date.now()),now = telemetry?.now ?? (() => Date.now())} = {}) {
    this.telemetry = telemetry; this.storage = storage; this.clock = clock; this.now = now;
    this.state = readState(storage); this.current = null; this.games = new WeakMap(); this.lastClock = 0;
    this.unsubscribe = telemetry?.onClear?.(() => this.clear());
  }
  _time() { let value; try { value = this.clock(); } catch { value = this.lastClock; } this.lastClock = Math.max(this.lastClock,finite(value,this.lastClock)); return this.lastClock; }
  _write() { try { this.storage?.setItem(ENDLESS_TELEMETRY_KEY,JSON.stringify(this.state)); } catch { /* Local telemetry never blocks play. */ } }
  _log(type,data) { try { this.telemetry?.log(type,{mode:'endless',...data}); } catch { /* The event log is optional as well. */ } }
  _identity(run = this.current) { return {runId:run.id,ordinal:run.ordinal,cohort:run.cohort}; }
  onBattleStart(game) {
    if (!game || typeof game !== 'object') return null;
    const previous = this.games.get(game); if (previous) return previous.result ? structuredClone(previous.result) : this._identity(previous);
    if (this.current) this.finish(this.current.game,{outcome:'abandoned'});
    if (game.mode !== 'endless') return null;
    const ordinal = ++this.state.ordinal,cohort = cohortFor(ordinal); let timestamp; try { timestamp = finite(this.now()); } catch { timestamp = 0; }
    const run = {id:'endless-' + ordinal + '-' + Math.floor(timestamp).toString(36),ordinal,cohort,game,wave:waveOf(game),selected:0,gateSelected:0,hesitationSamples:0,hesitationMs:0,skipped:0,rerolls:0,pending:null,result:null};
    this.current = run; this.games.set(game,run); this.state.cohorts[cohort].started++;
    this._log('endless_run_start',{...this._identity(),party:(game.heroes || []).slice(0,3).map(hero => hero.id || hero.heroId)}); this._write(); return this._identity();
  }
  /** Call with the actual unobscured choice-panel visibility, after reveal delay and page/modal gates. */
  setChoiceVisible(visible) {
    const pending = this.current?.pending; if (!pending) return;
    const show = Boolean(visible); if (show === (pending.visibleSince !== null)) return;
    const time = this._time();
    if (show) pending.visibleSince = time;
    else { pending.elapsedMs += time - pending.visibleSince; pending.visibleSince = null; }
  }
  _choiceMs(pending) { return pending.elapsedMs + (pending.visibleSince !== null ? this._time() - pending.visibleSince : 0); }
  handleEvent(event,game = this.current?.game) {
    const run = this.current; if (!run || game !== run.game || run.result || !event || typeof event !== 'object') return null;
    run.wave = waveOf(game,event.wave ?? run.wave);
    if (event.type === 'choice') {
      // Rerolls reopen the panel but preserve the same decision's accumulated visible time.
      this.setChoiceVisible(false);
      run.pending ||= {startedAt:this._time(),elapsedMs:0,visibleSince:null,rerolls:0,wave:run.wave};
      const choices = (event.choices || game.upgrades || []).slice(0,3).map(card => cardInfo(game,card));
      this.state.offers.count++; this.state.offers.cards += choices.length; this.state.offers.gateCards += choices.filter(card => card.gate).length;
      this._log('endless_tactic_offer',{...this._identity(),wave:run.wave,decisionWave:run.pending.wave,cards:choices}); this._write();
    } else if (event.type === 'tacticReroll') {
      run.rerolls++; this.state.choices.rerolls++; if (run.pending) run.pending.rerolls++;
      this._log('endless_tactic_reroll',{...this._identity(),wave:run.wave,cost:finite(event.cost)}); this._write();
    } else if (event.type === 'tactic' && run.pending) {
      const card = cardInfo(game,event.upgrade || event.card || {id:event.id}); if (!card.id) return null;
      const pending = run.pending,ms = this._choiceMs(pending); run.pending = null;
      run.selected++; run.gateSelected += Number(card.gate); run.hesitationSamples++; run.hesitationMs += ms;
      const choices = this.state.choices; choices.selected++; choices.gateSelected += Number(card.gate); choices.hesitationSamples++; choices.hesitationMs += ms; choices.categories[card.category]++; choices.rarities[card.rarity]++;
      this._log('endless_tactic_pick',{...this._identity(),wave:run.wave,...card,visibleChoiceSec:ms / 1000,wallChoiceSec:(this._time() - pending.startedAt) / 1000,rerolls:pending.rerolls}); this._write();
    } else if (event.type === 'tacticSkip' && run.pending) {
      const ms = this._choiceMs(run.pending); run.pending = null; run.skipped++; this.state.choices.skipped++;
      this._log('endless_tactic_skip',{...this._identity(),wave:run.wave,visibleChoiceSec:ms / 1000,food:finite(event.food)}); this._write();
    } else if (event.type === 'lose' || event.type === 'win') return this.finish(game,{outcome:event.type === 'lose' ? 'lost' : 'won'});
    return null;
  }
  finish(game = this.current?.game,{outcome = game?.state} = {}) {
    const run = game && typeof game === 'object' ? this.games.get(game) : null; if (!run) return null; if (run.result) return structuredClone(run.result); if (run !== this.current) return null;
    const result = {runId:run.id,ordinal:run.ordinal,cohort:run.cohort,outcome:outcome === 'lose' || outcome === 'lost' ? 'lost' : outcome === 'win' || outcome === 'won' ? 'won' : 'abandoned',wave:waveOf(game,run.wave),combatSec:finite(game.time),selected:run.selected,gateSelected:run.gateSelected,
      hesitationSamples:run.hesitationSamples,totalHesitationSec:run.hesitationMs / 1000,averageHesitationSec:mean(run.hesitationMs / 1000,run.hesitationSamples),skipped:run.skipped,rerolls:run.rerolls};
    run.result = result; run.pending = null; this.current = null;
    this.state.runs.finished++; this.state.runs[result.outcome === 'lost' ? 'deaths' : result.outcome]++;
    if (result.outcome === 'lost') {
      this.state.runs.deathWaveTotal += result.wave; this.state.cohorts[run.cohort].deaths++; this.state.cohorts[run.cohort].deathWaveTotal += result.wave;
      if (Object.hasOwn(this.state.anchorDeaths,String(result.wave))) this.state.anchorDeaths[String(result.wave)]++;
    }
    this.state.recentRuns.push(result); if (this.state.recentRuns.length > ENDLESS_TELEMETRY_RUN_LIMIT) this.state.recentRuns.shift();
    this._log('endless_run_result',result); this._write(); return structuredClone(result);
  }
  summary() {
    const state = this.state,choices = state.choices,run = this.current;
    return structuredClone({runs:{started:state.ordinal,finished:state.runs.finished,deaths:state.runs.deaths,abandoned:state.runs.abandoned,won:state.runs.won,averageDeathWave:mean(state.runs.deathWaveTotal,state.runs.deaths)},
      cohorts:Object.fromEntries(COHORTS.map(key => [key,{started:state.cohorts[key].started,deaths:state.cohorts[key].deaths,averageDeathWave:mean(state.cohorts[key].deathWaveTotal,state.cohorts[key].deaths)}])),
      choices:{selected:choices.selected,gateSelected:choices.gateSelected,gateAcquisitionRate:mean(choices.gateSelected,choices.selected),averageHesitationSec:mean(choices.hesitationMs / 1000,choices.hesitationSamples),hesitationSamples:choices.hesitationSamples,totalHesitationSec:choices.hesitationMs / 1000,skipped:choices.skipped,rerolls:choices.rerolls,categories:choices.categories,rarities:choices.rarities},
      offers:{...state.offers,gateRate:mean(state.offers.gateCards,state.offers.cards)},anchorDeaths:state.anchorDeaths,recentRuns:state.recentRuns,
      current:run ? {...this._identity(),wave:waveOf(run.game,run.wave),selected:run.selected,gateSelected:run.gateSelected,pendingChoice:Boolean(run.pending),visibleChoiceSec:run.pending ? this._choiceMs(run.pending) / 1000 : null} : null,
      targets:ENDLESS_TELEMETRY_TARGETS});
  }
  clear() { this.state = freshState(); this.current = null; this.games = new WeakMap(); this._write(); }
  destroy() { this.unsubscribe?.(); this.unsubscribe = null; }
}
