import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { V1Game } from '../v1-engine.js';
import { V1Game as BaselineGame } from '../docs/v1/playtest/skill-art/baseline/v1-engine.js';
import { BALANCE as B } from '../runtime-data.js';

const OLD=JSON.parse(readFileSync(new URL('../docs/v1/playtest/skill-art/balance-before.json',import.meta.url),'utf8')).v1Baseline;
const IDS=['xiahou_dun','cao_cao','liu_bei','sun_quan','zhou_yu','sima_yi','xu_chu','gan_ning'];
const near=(a,b,message='')=>assert.ok(Math.abs(a-b)<1e-7,`${message}: ${a} != ${b}`);
function fixture(id,Engine=V1Game) {
  const events=[], game=new Engine({levelId:'wu_020',party:[{heroId:id,level:20,skillLevel:4}],onEvent:e=>events.push(e)});
  game.start(); game.camps=[]; game.enemies=[]; game._spawnQueue=[{at:1e6}]; game._spawnIndex=0;
  const hero=game.heroes[0];
  const enemy=(type='armor',progress=game.paths[0].length-160,lane=0,extra={})=>Object.assign(game._spawn({type,progress,lane,wave:game.level.waves[0]}),{hp:1e6,maxHp:1e6,speed:0},extra);
  const cast=()=>{hero.rage=100;hero.rageRecovery=0;assert.equal(game.castUltimate(id).ok,true);return game._casts.at(-1);};
  return {game,hero,enemy,cast,events};
}

test('eight redesigns change only approved names, dimensions, shapes and placement/timing fields',()=>{
  const placement=new Set(['name','shape','radius','range','angleDegrees','length','width','leapReach','landAtSec','returnAtSec','flightSec','bannerLingerSec','surgeLength','surgeSec','arcDegrees','waveSec','count','minGap']);
  const protectedPart=u=>Object.fromEntries(Object.entries(u).filter(([key])=>!placement.has(key)));
  for(const id of Object.keys(B.heroes)) {
    assert.deepEqual(protectedPart(B.heroes[id].ultimate),protectedPart(OLD.heroes[id].ultimate),id+' damage/control/buffs/hit budgets unchanged');
    for(const key of ['attack','auto','hpEnabled','movementEnabled']) assert.deepEqual(B.heroes[id][key],OLD.heroes[id][key],id+' '+key);
    if(!IDS.includes(id)) assert.deepEqual(B.heroes[id].ultimate,OLD.heroes[id].ultimate,id+' unchanged skill');
  }
  assert.deepEqual(B.rage,OLD.rage); assert.deepEqual(B.party,OLD.party);
  assert.deepEqual(B.tactics.zhou_yu_radius.effects,{fireWidthAdd:24});
});

test('each redesigned shape hits its locked area, excludes outside enemies and keeps its exact hit cap',()=>{
  for(const id of IDS) {
    const {game,hero,enemy,cast}=fixture(id), inside=enemy(), release=cast();
    assert.equal(game._inShape(inside,release.target,hero.definition.ultimate),true,id+' selected target inside');
    const outside=enemy('armor',0,0,{x:2000,y:2000});
    for(let n=0;n<360;n++)game._skillDamage(1/60);
    const cap=hero.definition.ultimate.maxTicksPerEnemyPerCast||hero.definition.ultimate.maxHitsPerEnemyPerCast;
    assert.ok(inside.hp<1e6,id+' hits inside');assert.equal(outside.hp,1e6,id+' never damages outside');
    assert.equal(release.hits.get(inside.id),cap,id+' exact hit budget');
    assert.equal(release.hits.has(outside.id),false,id+' outside gets no hit record');
  }
});

test('leap and banner lock positions but deal no damage before landing/insertion',()=>{
  for(const [id,at] of [['xiahou_dun',.36],['cao_cao',.42]]) {
    const {game,hero,enemy,cast}=fixture(id), e=enemy(), origin={x:hero.x,y:hero.y}, release=cast(), locked=structuredClone(release.target);
    assert.equal(e.hp,1e6); game._skillDamage(at-.001);assert.equal(e.hp,1e6,id+' wind-up');
    game._skillDamage(.001);assert.ok(e.hp<1e6,id+' exact impact');
    const hp=e.hp;game._skillDamage(.5);assert.equal(e.hp,hp,id+' no repeated impact');
    assert.deepEqual(release.target,locked);assert.deepEqual({x:hero.x,y:hero.y},origin,'render movement never changes engine position');
    if(id==='xiahou_dun')assert.ok(Math.hypot(locked.x-hero.x,locked.y-hero.y)<=430+1e-7);
    else {assert.equal(game._buffs[0].bonus,.25);assert.equal(game._buffs[0].remaining,6);assert.equal(game.effects.find(v=>v.type==='ultimate').life,6);}
  }
});

test('Xiahou Dun pauses basic attacks for the .9 second leap without moving or changing other heroes',()=>{
  for(const id of ['xiahou_dun','cao_cao']) {
    const {game,hero,enemy,cast,events}=fixture(id);enemy('armor',game.paths[0].length-40);const origin={x:hero.x,y:hero.y};cast();
    game.update(.89);
    assert.equal(events.some(e=>e.type==='heroAttack'),id==='cao_cao');
    game.update(.02);assert.equal(events.some(e=>e.type==='heroAttack'),true);
    assert.deepEqual({x:hero.x,y:hero.y},origin);near(hero.rageRecovery,5.09);
  }
});

test('Liu Bei advances along every real route, hits once and stops at .6 seconds',()=>{
  const {game,hero,enemy,cast}=fixture('liu_bei'); game.hp=50;
  const far=game.paths.map((p,i)=>enemy('armor',p.length-260,i)), release=cast();
  assert.deepEqual(release.target.laneIds,game.paths.map(p=>p.id));
  assert.ok(game.hp>50,'healing remains immediate');assert.equal(game._buffs[0].bonus,.2);
  game._skillDamage(.1);assert.ok(far.every(e=>e.hp===1e6),'front has not reached distant enemies');
  game._skillDamage(.5);assert.ok(far.every(e=>e.hp<1e6));assert.ok(far.every(e=>release.hits.get(e.id)===1));
  const arrival=enemy('armor',game.paths[0].length-100);game._skillDamage(.2);assert.equal(arrival.hp,1e6,'no lingering damage after surge ends');
  assert.equal(hero.castingRemaining,.9,'visual/queue lock is independent of the .6 second damage front');
});

test('Sun Quan expands the front half-wave from the gate and stops at .4 seconds',()=>{
  const {game,hero,enemy,cast}=fixture('sun_quan'), center=game._gateCenter();
  const nearEnemy=enemy('armor',100,0,{x:center.x,y:center.y-80}),farEnemy=enemy('armor',100,0,{x:center.x,y:center.y-260}),behind=enemy('armor',100,0,{x:center.x,y:center.y+50});
  const release=cast(); near(release.target.x,center.x);near(release.target.y,center.y);
  assert.equal(game._buffs[0].factor,.8);game._skillDamage(.05);assert.equal(nearEnemy.hp,1e6);
  game._skillDamage(.1);assert.ok(nearEnemy.hp<1e6);assert.equal(farEnemy.hp,1e6);
  game._skillDamage(.25);assert.ok(farEnemy.hp<1e6);assert.equal(behind.hp,1e6);
  const arrival=enemy('armor',100,0,{x:center.x,y:center.y-90});game._skillDamage(.2);assert.equal(arrival.hp,1e6);
  assert.equal(release.hits.get(nearEnemy.id),1);assert.equal(hero.castingRemaining,.9);
});

test('command flag and gate barrier visuals end with their six-second buffs, independently of damage windows',()=>{
  for(const id of ['cao_cao','sun_quan']) {
    const {game,enemy,cast}=fixture(id);enemy();const release=cast();
    const visual=game.effects.find(e=>e.type==='ultimate');assert.equal(visual.life,6);
    game.update(1);assert.equal(game._casts.includes(release),false,id+' damage is finished');
    assert.equal(game.effects.includes(visual),true);assert.ok(game._buffs.length);
    game.update(4.99);assert.equal(game.effects.includes(visual),true);assert.ok(game._buffs.length);
    game.update(.02);assert.equal(game.effects.includes(visual),false);assert.equal(game._buffs.length,0);
  }
});

test('three thunder circles are separated, locked, simultaneous and cannot double-hit overlap',()=>{
  const {game,hero,enemy,cast}=fixture('sima_yi');
  for(const [x,y] of [[55,120],[210,120],[365,120]])for(let i=0;i<4;i++)enemy('armor',100,0,{x:x+i,y});
  const release=cast(), circles=release.target.circles;
  assert.equal(circles.length,3);for(let i=0;i<3;i++)for(let j=i+1;j<3;j++)assert.ok(Math.hypot(circles[i].x-circles[j].x,circles[i].y-circles[j].y)>=140-1e-7);
  const before=game.enemies.map(e=>e.hp);game._skillDamage(.999);assert.deepEqual(game.enemies.map(e=>e.hp),before);
  game._skillDamage(.001);assert.ok(release.hits.size>=12);
  assert.ok([...release.hits.values()].every(n=>n===1));
  const overlapFixture=fixture('sima_yi'),overlap=overlapFixture.enemy('armor',100,0,{x:170,y:200});
  const overlapping={shape:'delayed_multi_circle',x:100,y:200,radius:90,circles:[100,240,380].map(x=>({x,y:200,radius:90})),targetIds:[overlap.id]};
  overlapFixture.game._beginCast(overlapFixture.hero,overlapping);const overlapCast=overlapFixture.game._casts[0];
  overlapFixture.game._skillDamage(1);assert.equal(overlapCast.hits.get(overlap.id),1,'two intersecting circles still deal one hit');
});

test('fire/volley strips choose true road intervals, with pressure and coverage policies kept distinct',()=>{
  for(const id of ['zhou_yu','gan_ning']) {
    const {game,hero,enemy}=fixture(id);
    // Route 0 has the highest total pressure, but spreads outside one short strip.
    for(const progress of [50,100,game.paths[0].length-50,game.paths[0].length-100])enemy('boss',progress,0);
    for(let i=0;i<5;i++)enemy('armor',100+i*8,2);
    const target=game._target(hero), path=game.paths.find(p=>p.id===target.laneId);
    assert.equal(target.laneId,id==='zhou_yu'?'route_0':'route_2');
    assert.ok(target.s0>=0 && target.s1<=path.length);near(target.s1-target.s0,hero.definition.ultimate.length);
    const center=game.pathPoint(target.laneId,(target.s0+target.s1)/2);near(target.x,center.x);near(target.y,center.y);
    assert.equal(target.count,game.enemies.filter(e=>game._inShape(e,target,hero.definition.ultimate)).length);
    if(id==='zhou_yu'){game.tactics.add('zhou_yu_radius');const upgraded=game._target(hero);assert.equal(upgraded.width,target.width+24);assert.equal(upgraded.length,target.length);assert.match(game._tacticCopy('zhou_yu_radius'),/宽度增加24/);}
  }
});

test('same-hit damage, execute, knockback, slow and vulnerability exactly match the pre-redesign engine',()=>{
  for(const id of IDS)for(const type of ['infantry','cavalry','armor','ranged','banner','siege','boss']) {
    const results=[];
    for(const Engine of [BaselineGame,V1Game]) {
      const {game,hero,enemy}=fixture(id,Engine),e=enemy(type,400),release={id:1,heroId:id,hero,hits:new Map(),kills:0,target:{shape:'circle_shock',x:210,y:300,radius:2000}};
      game.stats.perHero[id]={casts:1,kills:0};
      const cap=hero.definition.ultimate.maxTicksPerEnemyPerCast||hero.definition.ultimate.maxHitsPerEnemyPerCast;
      for(let i=0;i<cap+2;i++)game._hitCast(release);
      results.push({hp:e.hp,progress:e.progress,slow:e.slowEffects,stun:e.stunRemaining,vulnerability:e.vulnerability,hits:release.hits.get(e.id),kills:release.kills,food:game.food,rage:hero.rage});
    }
    assert.deepEqual(results[1],results[0],id+' '+type);
  }
});

test('healing and all three allied buffs retain baseline magnitude, start time and duration',()=>{
  for(const id of ['cao_cao','liu_bei','sun_quan']) {
    const results=[];
    for(const Engine of [BaselineGame,V1Game]) {
      const {game,hero,cast}=fixture(id,Engine);game.hp=50;cast();
      results.push({hp:game.hp,buffs:game._buffs,rage:hero.rage,recovery:hero.rageRecovery,lock:hero.castingRemaining});
    }
    assert.deepEqual(results[1],results[0],id);
  }
});
