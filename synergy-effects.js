import { heroComboStatus, synergyUpgradeEffects } from './synergy-rules.js';

const EPS = 1e-8;
const alive = enemy => enemy.hp > 0 && !enemy.escaped;
const dist = (a,b) => Math.hypot(a.x - b.x,a.y - b.y);
const klass = enemy => enemy.class || 'ordinary';
const clone = value => structuredClone(value);
function zone(game,kind,target,life,extra = {}) {
  game.effects.push({type:'synergyZone',kind,target:clone(target),...target,life,age:0,time:0,...extra});
}

export function initializeSynergies(game,balance) {
  game._synergyBalance = balance; game._synergyEffectCache = null;
  game._synergyRuntime = {count:0,history:new Map(),responders:new Set(),pairs:new Set(),jobs:[],burns:[],rangeZones:[]};
}
export function ensureSynergyCast(cast) {
  cast.synergyOriginal ||= {target:clone(cast.target),ultimate:clone(cast.ultimate)};
  cast.synergyLedger ||= new Map();
}
export function beginSynergyCast(game,cast) {
  ensureSynergyCast(cast);
  const rage = synergyUpgradeEffects(game).allyRageOnUltimate || 0;
  if (rage) for (const hero of game.heroes) if (hero.id !== cast.heroId) hero.rage = Math.min(game.heroMaxRage(hero),hero.rage + rage);
}
export function effectiveSynergyTarget(game,cast,target = cast.target) {
  if (cast.synergyWindUntil > game.time + EPS) {
    const scale = cast.synergyWindMultiplier,targetLength = target.length * scale;
    const expand = strip => ({...strip,length:strip.length * scale,s0:Math.max(0,strip.s1 - strip.length * scale)});
    return {...target,length:targetLength,...(target.strips ? {strips:target.strips.map(expand)} : target.s1 !== undefined ? {s0:Math.max(0,target.s1 - targetLength)} : {})};
  }
  return target;
}
export function synergyCampRange(game,camp,base,current) {
  let range = current;
  for (const area of game._synergyRuntime.rangeZones) if (game.time < area.expiresAt - EPS && dist(camp,area.target) <= area.target.radius + EPS) range = Math.max(range,base * area.multiplier);
  return range;
}
export function prepareHeroCombo(game,cast,enemy) {
  const state = game._synergyRuntime,status = heroComboStatus(game);
  if (state.responders.has(cast.id) || status.remaining <= 0) return null;
  const candidates = [];
  for (const definition of game._synergyBalance.heroCombos || []) {
    if (definition.to !== cast.heroId) continue;
    for (const record of state.history.values()) {
      const source = record.cast,key = definition.id + ':' + source.id + ':' + cast.id;
      if (source.heroId !== definition.from || source.id === cast.id || game.time - record.at > status.windowSec + EPS || state.pairs.has(key)) continue;
      if (game._inShape(enemy,source.synergyOriginal.target,source.synergyOriginal.ultimate)) candidates.push({definition,source,key,at:record.at});
    }
  }
  return candidates.sort((a,b) => b.at - a.at || b.source.id - a.source.id || a.definition.id.localeCompare(b.definition.id))[0] || null;
}
function sourceContains(game,cast,enemy) { return game._inShape(enemy,cast.synergyOriginal.target,cast.synergyOriginal.ultimate); }
export function synergyOverlapMultiplier(game,cast,enemy) {
  let multiplier = 1;
  if (!cast?.synergyOriginal || !sourceContains(game,cast,enemy)) return multiplier;
  for (const area of cast.synergyOverlap || []) if (game._inShape(enemy,area.target,area.ultimate)) multiplier = Math.max(multiplier,area.multiplier);
  return multiplier;
}
export function synergyHitMultiplier(game,cast,enemy,candidate = null,forSplash = false) {
  let multiplier = cast.synergyDamageMultiplier || 1;
  const e = candidate?.definition.effects;
  if (e?.combinedDamageMultiplier) multiplier = Math.max(multiplier,e.combinedDamageMultiplier);
  if (e?.responderDamageMultiplier) multiplier = Math.max(multiplier,e.responderDamageMultiplier);
  if (!forSplash) {
    multiplier = Math.max(multiplier,synergyOverlapMultiplier(game,cast,enemy));
    if (e?.overlapDamageMultiplier && sourceContains(game,cast,enemy) && sourceContains(game,candidate.source,enemy)) multiplier = Math.max(multiplier,e.overlapDamageMultiplier);
  }
  const fireBonus = synergyUpgradeEffects(game).arrowRainInFireDamageBonus;
  if (fireBonus && cast.heroId === 'gan_ning' && game._casts.some(source => source.heroId === 'zhou_yu' && !source.finished && source.age <= source.life + EPS && game._inShape(enemy,effectiveSynergyTarget(game,source),source.ultimate))) multiplier *= 1 + fireBonus;
  return multiplier;
}
export function beforeSynergyHit(game,cast,enemy) {
  const e = synergyUpgradeEffects(game);
  if (cast.heroId === 'sima_yi' && e.thunderVulnerabilityMultiplier) game._vulnerable(enemy,e.thunderVulnerabilityMultiplier,e.thunderVulnerabilityDurationSec,'synergy_thunder_' + cast.id,'sima_yi');
}
function compensateDamage(game,source,multiplier,predicate = () => true) {
  for (const [id,segments] of source.synergyLedger) {
    const enemy = game.enemies.find(item => item.id === id);
    if (!enemy || !alive(enemy) || enemy.invulnerable || !predicate(enemy)) continue;
    for (const segment of segments) {
      if (segment.executed || segment.multiplier >= multiplier - EPS) continue;
      const amount = segment.actual * (multiplier / segment.multiplier - 1);
      game._damage(enemy,amount,'ultimate_' + source.heroId,source,false,{skipIncomingMultipliers:true,ignoreDamageReduction:true});
      segment.multiplier = multiplier;
      if (!alive(enemy)) break;
    }
  }
}
function attachChibiBurn(game,source,enemy) {
  const profile = source.synergyChibi;
  if (!profile || !alive(enemy) || profile.applied.has(enemy.id)) return;
  profile.applied.add(enemy.id);
  game._synergyRuntime.burns.push({enemyId:enemy.id,cast:source,damage:profile.damage[klass(enemy)] || 0,nextAt:game.time + profile.interval,remaining:profile.ticks,interval:profile.interval});
  zone(game,'chibiBurn',{x:enemy.x,y:enemy.y,radius:enemy.radius + 7},profile.interval * profile.ticks,{enemyId:enemy.id,heroId:source.heroId});
}
function applyCombo(game,cast,candidate) {
  const state = game._synergyRuntime,source = candidate.source,definition = candidate.definition,e = definition.effects;
  state.responders.add(cast.id); state.pairs.add(candidate.key); state.count++;
  if (e.combinedDamageMultiplier) {
    source.synergyDamageMultiplier = Math.max(source.synergyDamageMultiplier || 1,e.combinedDamageMultiplier);
    cast.synergyDamageMultiplier = Math.max(cast.synergyDamageMultiplier || 1,e.combinedDamageMultiplier);
    state.jobs.push(() => compensateDamage(game,source,e.combinedDamageMultiplier));
  }
  if (e.responderDamageMultiplier) cast.synergyDamageMultiplier = Math.max(cast.synergyDamageMultiplier || 1,e.responderDamageMultiplier);
  if (e.responderLengthMultiplier) {
    cast.synergyWindMultiplier = e.responderLengthMultiplier; cast.synergyWindUntil = game.time + e.rangeBoostDurationSec;
    const expanded = effectiveSynergyTarget(game,cast),base = clone(cast.target);
    zone(game,'eastWind',expanded,e.rangeBoostDurationSec,{heroId:cast.heroId,ultimate:cast.ultimate});
    state.jobs.push(() => game._hitCast(cast,base,{noCombo:true,excludeShape:{target:base,ultimate:cast.ultimate}}));
  }
  if (e.initiatorPushbackMultiplier) {
    source.synergyPushMultiplier = Math.max(source.synergyPushMultiplier || 1,e.initiatorPushbackMultiplier);
    const count = Math.max(e.responderPassCount,cast.ultimate.passAtSec.length),gap = cast.ultimate.passAtSec[1] || .25;
    cast.ultimate.passAtSec = Array.from({length:count},(_,i) => i * gap); cast.ultimate.maxHitsPerEnemyPerCast = count;
    cast.life = Math.max(cast.life,cast.ultimate.passAtSec.at(-1) + .1);
    cast.synergyForcedPassIds = new Set(game.enemies.filter(enemy => alive(enemy) && sourceContains(game,source,enemy) && sourceContains(game,cast,enemy)).map(enemy => enemy.id));
    state.jobs.push(() => {
      for (const [id,record] of source.synergyPushLedger || []) {
        const enemy = game.enemies.find(item => item.id === id);
        if (!enemy || !alive(enemy) || enemy.invulnerable || record.multiplier >= e.initiatorPushbackMultiplier) continue;
        game._push(enemy,record.raw * (e.initiatorPushbackMultiplier - record.multiplier)); record.multiplier = e.initiatorPushbackMultiplier;
      }
    });
  }
  if (e.thunderCrossShape) {
    const widthRatio = (4.8 - Math.sqrt(4.8 ** 2 - 4 * Math.PI * e.coverageMultiplier)) / 2;
    const circles = source.synergyOriginal.target.circles;
    const target = {...source.target,shape:'delayed_multi_cross',crosses:circles.map(circle => ({...circle,length:circle.radius * 2.4,width:circle.radius * widthRatio}))};
    source.target = target;
    zone(game,'thunderCross',target,.65,{heroId:source.heroId,ultimate:source.ultimate});
    state.jobs.push(() => game._hitCast(source,target,{noCombo:true}));
  }
  if (e.campRangeMultiplier) {
    const area = {target:clone(cast.target),multiplier:e.campRangeMultiplier,expiresAt:game.time + e.campRangeDurationSec}; state.rangeZones.push(area);
    zone(game,'tigerCommand',area.target,e.campRangeDurationSec,{heroId:cast.heroId});
    for (const camp of game.camps) game._updateCamp(camp);
  }
  if (e.guaranteeMarkedBossHit) {
    const ids = new Set([...source.synergyLedger.keys()].filter(id => game.enemies.some(enemy => enemy.id === id && alive(enemy) && klass(enemy) === 'boss')));
    state.jobs.push(() => game._hitCast(cast,null,{noCombo:true,forceIds:ids,onlyIds:ids}));
  }
  if (e.initiatorDamageMultiplier) {
    source.synergyDamageMultiplier = Math.max(source.synergyDamageMultiplier || 1,e.initiatorDamageMultiplier);
    const interval = cast.ultimate.tickIntervalSec || .25;
    const factor = (cast.ultimate.damageMultiplier || 1) * game.heroDamageMultiplier(cast.hero,true,true);
    source.synergyChibi = {damage:Object.fromEntries(Object.entries(cast.ultimate.tickDamageByClass).map(([key,value]) => [key,value * factor])),interval,ticks:Math.round(e.burnDurationSec / interval),applied:new Set()};
    state.jobs.push(() => {
      compensateDamage(game,source,e.initiatorDamageMultiplier);
      for (const id of source.synergyLedger.keys()) { const enemy = game.enemies.find(item => item.id === id); if (enemy) attachChibiBurn(game,source,enemy); }
    });
  }
  if (e.overlapDamageMultiplier) {
    (cast.synergyOverlap ||= []).push({...source.synergyOriginal,multiplier:e.overlapDamageMultiplier});
    (source.synergyOverlap ||= []).push({...cast.synergyOriginal,multiplier:e.overlapDamageMultiplier});
    state.jobs.push(() => compensateDamage(game,source,e.overlapDamageMultiplier,enemy => sourceContains(game,source,enemy) && sourceContains(game,cast,enemy)));
  }
  const status = heroComboStatus(game);
  state.jobs.push(() => game._emit('heroCombo',{comboId:definition.id,name:definition.name,fromHeroId:source.heroId,toHeroId:cast.heroId,...status,x:cast.target.x,y:cast.target.y,target:clone(cast.target),fromTarget:clone(source.synergyOriginal.target)}));
}
export function recordSynergyHit(game,cast,enemy,actual,executed,multiplier,candidate,eligible = true) {
  const segments = cast.synergyLedger.get(enemy.id) || [];
  segments.push({actual,executed,multiplier}); cast.synergyLedger.set(enemy.id,segments);
  if (eligible) {
    game._synergyRuntime.history.set(cast.id,{cast,at:game.time});
    if (candidate && !game._synergyRuntime.responders.has(cast.id) && heroComboStatus(game).remaining > 0) applyCombo(game,cast,candidate);
  }
  if (cast.synergyChibi) attachChibiBurn(game,cast,enemy);
}
export function recordSynergyPush(cast,enemy,raw) {
  if (!raw) return;
  const ledger = cast.synergyPushLedger ||= new Map(),record = ledger.get(enemy.id) || {raw:0,multiplier:cast.synergyPushMultiplier || 1}; record.raw += raw; ledger.set(enemy.id,record);
}
export function finishSynergyHitBatch(game) {
  const state = game._synergyRuntime;
  if (state.flushing) return;
  state.flushing = true;
  try { while (state.jobs.length) state.jobs.shift()(); } finally { state.flushing = false; }
}
export function updateSynergyEffects(game) {
  const state = game._synergyRuntime,window = heroComboStatus(game).windowSec;
  for (const [id,record] of state.history) if (game.time - record.at > window + EPS) state.history.delete(id);
  state.rangeZones = state.rangeZones.filter(area => area.expiresAt > game.time + EPS);
  for (const burn of state.burns) {
    const enemy = game.enemies.find(item => item.id === burn.enemyId);
    if (!enemy || !alive(enemy)) { burn.remaining = 0; continue; }
    while (burn.remaining > 0 && burn.nextAt <= game.time + EPS) {
      burn.remaining--; burn.nextAt += burn.interval;
      game._damage(enemy,burn.damage,'ultimate_' + burn.cast.heroId,burn.cast);
      if (!alive(enemy)) { burn.remaining = 0; break; }
    }
  }
  state.burns = state.burns.filter(burn => burn.remaining > 0);
}
