import test from 'node:test';
import assert from 'node:assert/strict';
import {Telemetry,TELEMETRY_KEY,TELEMETRY_LIMIT} from '../experience.js';
import {EndlessRunTelemetry,ENDLESS_TELEMETRY_KEY,ENDLESS_TELEMETRY_RUN_LIMIT} from '../endless-telemetry.js';
import {V1Game} from '../v1-engine.js';

const memory = () => { const map = new Map(); return {map,getItem:key => map.get(key) ?? null,setItem:(key,value) => map.set(key,value)}; };
const cards = [
  {id:'attr_gate_build',category:'attribute',rarity:'common'},
  {id:'archer_pierce',category:'camp',rarity:'rare'},
  {id:'guan_yu_width',category:'hero',rarity:'epic'},
];
function fixture({storage = memory()} = {}) {
  let clock = 0,now = 1_000_000;
  const telemetry = new Telemetry({storage,clock:() => clock,now:() => now}),tracker = new EndlessRunTelemetry({telemetry});
  const game = {mode:'endless',wave:1,time:30,state:'playing',heroes:[{id:'guan_yu'}],upgrades:cards};
  return {storage,telemetry,tracker,game,at(value) { clock = value; now = 1_000_000 + value; }};
}

test('visible decision time excludes reveal, background and obscuring pauses while rerolls retain one six-second decision', () => {
  const {tracker,telemetry,game,at} = fixture(); tracker.onBattleStart(game);
  tracker.handleEvent({type:'choice',choices:cards,time:42},game); at(1000); tracker.setChoiceVisible(true); at(3000);
  tracker.handleEvent({type:'choice',choices:[...cards].reverse(),time:42},game); tracker.handleEvent({type:'tacticReroll',cost:40,time:42},game);
  at(4000); tracker.setChoiceVisible(true); at(4500); tracker.setChoiceVisible(true); at(6000); tracker.setChoiceVisible(false);
  at(20000); tracker.setChoiceVisible(true); at(22000); tracker.handleEvent({type:'tactic',upgrade:cards[0],time:42},game);
  const summary = tracker.summary(); assert.equal(summary.choices.selected,1); assert.equal(summary.choices.hesitationSamples,1); assert.equal(summary.choices.averageHesitationSec,6); assert.equal(summary.choices.rerolls,1);
  const entry = telemetry.events.find(event => event.type === 'endless_tactic_pick'); assert.equal(entry.visibleChoiceSec,6); assert.equal(entry.wallChoiceSec,22); assert.equal(entry.rerolls,1); assert.equal(game.time,30,'the paused combat clock never determines choice timing');
});

test('wall-card acquisition uses selected cards as its denominator and keeps offers and skips separate', () => {
  const {tracker,game,at} = fixture(); tracker.onBattleStart(game);
  tracker.handleEvent({type:'choice',choices:cards},game); tracker.setChoiceVisible(true); at(8000); tracker.handleEvent({type:'tacticSkip',food:20},game);
  assert.equal(tracker.summary().choices.averageHesitationSec,null,'a skipped decision contributes no chosen-card hesitation sample');
  for (let i = 0; i < 4; i++) { tracker.handleEvent({type:'choice',choices:cards},game); tracker.setChoiceVisible(true); at(14000 + i * 6000); tracker.handleEvent({type:'tactic',upgrade:cards[i === 0 ? 0 : 1]},game); }
  const summary = tracker.summary(); assert.equal(summary.choices.selected,4); assert.equal(summary.choices.gateSelected,1); assert.equal(summary.choices.gateAcquisitionRate,.25); assert.equal(summary.choices.skipped,1); assert.equal(summary.choices.averageHesitationSec,6);
  assert.equal(summary.offers.count,5); assert.equal(summary.offers.cards,15); assert.equal(summary.offers.gateCards,5); assert.equal(summary.offers.gateRate,1 / 3); assert.equal(summary.choices.categories.attribute,1); assert.equal(summary.choices.categories.camp,3);
});

test('death-wave averages count actual losses and use ordinal first, learning and practiced cohorts without touching campaign data', () => {
  const {tracker,storage,game} = fixture(); storage.map.set('campaign-save','unchanged'); tracker.onBattleStart(game); game.wave = 30;
  tracker.handleEvent({type:'lose',time:500},game); tracker.finish(game,{outcome:'lost'}); assert.equal(tracker.summary().runs.deaths,1,'result rendering cannot duplicate an already handled loss');
  for (let i = 2; i <= 9; i++) { const next = {...game,wave:80}; tracker.onBattleStart(next); tracker.finish(next,{outcome:i === 2 ? 'won' : 'abandoned'}); }
  const experienced = {...game,wave:60}; tracker.onBattleStart(experienced); tracker.finish(experienced,{outcome:'lost'});
  const summary = tracker.summary(); assert.deepEqual(summary.runs,{started:10,finished:10,deaths:2,abandoned:7,won:1,averageDeathWave:45}); assert.equal(summary.cohorts.first.averageDeathWave,30); assert.equal(summary.cohorts.learning.averageDeathWave,null); assert.equal(summary.cohorts.practiced.averageDeathWave,60);
  assert.equal(summary.cohorts.learning.started,8); assert.equal(summary.anchorDeaths['30'],1); assert.equal(summary.anchorDeaths['60'],1); assert.equal(storage.map.get('campaign-save'),'unchanged');
  assert.deepEqual([...storage.map.keys()].sort(),['campaign-save',ENDLESS_TELEMETRY_KEY,TELEMETRY_KEY].sort());
});

test('lifelong counters survive rolling event eviction and bounded recent-run history across reloads', () => {
  const {tracker,storage,telemetry,game} = fixture();
  for (let i = 1; i <= 40; i++) { const run = {...game,wave:i}; tracker.onBattleStart(run); tracker.finish(run,{outcome:'lost'}); }
  for (let i = 0; i < TELEMETRY_LIMIT + 20; i++) telemetry.log('other_local_event');
  assert.equal(telemetry.events.length,TELEMETRY_LIMIT); assert.equal(tracker.summary().recentRuns.length,ENDLESS_TELEMETRY_RUN_LIMIT);
  const reloaded = new EndlessRunTelemetry({telemetry:new Telemetry({storage})}),summary = reloaded.summary(); assert.equal(summary.runs.deaths,40); assert.equal(summary.runs.averageDeathWave,20.5); assert.equal(summary.recentRuns[0].ordinal,11); assert.equal(summary.recentRuns.at(-1).ordinal,40);
  const next = {...game}; assert.equal(reloaded.onBattleStart(next).ordinal,41); assert.equal(reloaded.summary().cohorts.practiced.started,32); assert.ok(JSON.stringify(summary).length < 20000,'summary storage stays bounded');
});

test('starts, picks and finishes are idempotent, while unresolved abandoned choices create no hesitation samples', () => {
  const {tracker,game,at} = fixture(); tracker.onBattleStart(game); tracker.onBattleStart(game); tracker.handleEvent({type:'choice',choices:cards},game); tracker.setChoiceVisible(true); at(6000);
  tracker.handleEvent({type:'tactic',upgrade:cards[1]},game); tracker.handleEvent({type:'tactic',upgrade:cards[1]},game); assert.equal(tracker.summary().choices.selected,1);
  tracker.handleEvent({type:'choice',choices:cards},game); tracker.setChoiceVisible(true); at(12000); const result = tracker.finish(game,{outcome:'abandoned'}); tracker.finish(game,{outcome:'lost'}); tracker.onBattleStart(game);
  assert.equal(result.selected,1); assert.equal(result.averageHesitationSec,6); assert.equal(tracker.summary().runs.started,1); assert.equal(tracker.summary().runs.deaths,0); assert.equal(tracker.summary().choices.hesitationSamples,1);
});

test('the existing telemetry clear action clears the local tuning summary without changing the export array contract', () => {
  const {tracker,telemetry,storage,game} = fixture(); telemetry.log('first_interactive'); tracker.onBattleStart(game); tracker.finish(game,{outcome:'lost'});
  assert.ok(Array.isArray(JSON.parse(storage.map.get(TELEMETRY_KEY)))); telemetry.clear();
  assert.deepEqual(telemetry.events,[]); assert.equal(tracker.summary().runs.started,0); assert.equal(tracker.summary().runs.averageDeathWave,null); assert.equal(JSON.parse(storage.map.get(ENDLESS_TELEMETRY_KEY)).ordinal,0);
  assert.equal(telemetry.summary().battles,0); tracker.destroy();
});

test('campaign battles never enter the counters and malformed or denied local storage cannot interrupt play', () => {
  const {tracker,game} = fixture(); tracker.onBattleStart({...game,mode:'campaign'}); tracker.handleEvent({type:'choice',choices:cards},game); assert.equal(tracker.summary().runs.started,0);
  const denied = new EndlessRunTelemetry({storage:{getItem(){throw Error('denied');},setItem(){throw Error('denied');}},clock:() => NaN,now:() => NaN});
  assert.doesNotThrow(() => { denied.onBattleStart(game); denied.handleEvent({type:'choice',choices:cards},game); denied.setChoiceVisible(true); denied.handleEvent({type:'tactic',upgrade:cards[0]},game); denied.finish(game,{outcome:'lost'}); }); assert.equal(denied.summary().runs.deaths,1);
  const storage = memory(); storage.map.set(ENDLESS_TELEMETRY_KEY,'{broken'); assert.equal(new EndlessRunTelemetry({storage}).summary().runs.started,0);
});

test('summary snapshots cannot mutate counters, and the original target ranges remain explicitly inspectable', () => {
  const {tracker,game} = fixture(); tracker.onBattleStart(game); tracker.finish(game,{outcome:'lost'}); const view = tracker.summary(); view.runs.started = 999; view.recentRuns[0].wave = 999; view.targets.hesitationSec[0] = 999;
  const summary = tracker.summary(); assert.equal(summary.runs.started,1); assert.equal(summary.recentRuns[0].wave,1); assert.deepEqual(summary.targets.hesitationSec,[4,8]); assert.deepEqual(summary.targets.gateAcquisitionRate,[.15,.25]);
});

test('real engine offer, reroll, acquisition and lose events populate one bounded local run', () => {
  const {tracker,at} = fixture(); let game;
  game = new V1Game({mode:'endless',rng:() => .5,onEvent:event => tracker.handleEvent(event,game)}); tracker.onBattleStart(game); game.start(); game.food = 1000;
  game.lockedTacticId = 'attr_gate_earth'; game._offerTactics(); const combat = game.time;
  at(1000); tracker.setChoiceVisible(true); at(4000); assert.equal(game.rerollTactics().ok,true); at(5000); tracker.setChoiceVisible(true); at(8000); assert.equal(game.selectUpgrade('attr_gate_earth').ok,true);
  game._finish('lost'); tracker.finish(game,{outcome:'lost'});
  const summary = tracker.summary(); assert.equal(game.time,combat); assert.equal(summary.choices.averageHesitationSec,6); assert.equal(summary.choices.selected,1); assert.equal(summary.choices.gateSelected,1); assert.equal(summary.choices.rerolls,1); assert.equal(summary.runs.deaths,1); assert.equal(summary.runs.averageDeathWave,1);
});
