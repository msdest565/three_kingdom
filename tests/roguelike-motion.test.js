import test from 'node:test';
import assert from 'node:assert/strict';
import {V1Renderer} from '../v1-renderer.js';
import {BALANCE as B,CONTENT} from '../runtime-data.js';
import {RoguelikePresentation,ROGUELIKE_COMBO_STYLES} from '../roguelike-presentation.js';

function surface() {
  const operations = [],props = {},gradient = {addColorStop(...args){operations.push(['colorStop',...args]);}};
  const ctx = new Proxy({operations,measureText:value => ({width:String(value).length * 8}),createLinearGradient:(...args) => {operations.push(['gradient',...args]);return gradient;},createRadialGradient:() => gradient},{
    get(target,key){if(key in target)return target[key];if(key in props)return props[key];return(...args)=>{for(const value of args)if(typeof value === 'number')assert.ok(Number.isFinite(value),'finite '+String(key));operations.push([key,...args]);};},
    set(target,key,value){props[key]=value;operations.push(['set',key,value]);return true;},
  });
  return {width:420,height:600,context:ctx,getContext:() => ctx,getBoundingClientRect:() => ({left:0,top:0,right:420,bottom:600,width:420,height:600})};
}
function setup(t,reducedMotion = false) {
  const previousWindow = globalThis.window,previousDocument = globalThis.document;
  globalThis.window = {devicePixelRatio:1}; globalThis.document = {hidden:false,createElement:() => surface()};
  t.after(() => {if(previousWindow === undefined)delete globalThis.window;else globalThis.window=previousWindow;if(previousDocument === undefined)delete globalThis.document;else globalThis.document=previousDocument;});
  const canvas = surface(),renderer = new V1Renderer(canvas,{reducedMotion}); t.after(() => renderer.destroy());
  return {renderer,canvas};
}
function comboEvent(id = 'combo_east_wind') {
  const entry = B.heroCombos.find(value => value.id === id);
  return {type:'heroCombo',presentation:'roguelike',comboId:id,name:entry.name,fromHeroId:entry.from,toHeroId:entry.to,target:{shape:'circle_shock',x:210,y:300,radius:80},fromTarget:{shape:'circle_shock',x:200,y:300,radius:75}};
}
function gameFor(event) {
  return {map:CONTENT.maps[0],mode:'endless',time:10,wave:1,hp:100,maxHp:100,camps:[],effects:[],projectiles:[],pendingEnemyCount:1,
    heroes:[event.fromHeroId,event.toHeroId].map((id,i) => ({id,heroId:id,definition:B.heroes[id],role:i?'support':'lead',rage:0,casting:false,x:180+i*60,y:500})),
    enemies:[{id:1,type:'armor',hp:500,maxHp:1000,x:210,y:300,radius:12,speed:0}],heroUltimate:hero => structuredClone(hero.definition.ultimate)};
}
const movement = operations => operations.filter(value => ['translate','rotate','scale'].includes(value[0]));

test('explicit presentation seconds retain a quarter-second hold in both motion modes and freeze when inactive', () => {
  const helper = new RoguelikePresentation(); helper.handleEvent(comboEvent()); assert.equal(helper.holdRemaining,.25); helper.tick(.1,{active:false}); assert.equal(helper.holdRemaining,.25);
  helper.tick(.2); assert.ok(Math.abs(helper.holdRemaining - .05) < 1e-8); helper.tick(.05); assert.equal(helper.holdRemaining,0); assert.equal(helper.phase,'dual'); helper.tick(.35); assert.equal(helper.phase,'title'); assert.equal(helper.view().combo.dualVisible,true);
  helper.tick(.5); assert.equal(helper.phase,'settle'); helper.tick(.3); assert.equal(helper.combo,null); assert.equal(helper.holdRemaining,0);
});

test('scoped events preserve the previous bare heroCombo behavior and copy every target snapshot', t => {
  const {renderer} = setup(t),event = comboEvent(); renderer.handleEvent({...event,presentation:undefined}); assert.equal(renderer.presentationHoldRemaining,0);
  renderer.handleEvent(event); event.target.radius = 999; event.fromTarget.x = 999; assert.equal(renderer.roguelikePresentation.combo.target.radius,80); assert.equal(renderer.roguelikePresentation.combo.fromTarget.x,200);
  renderer.advancePresentation(.1,{active:false}); assert.equal(renderer.presentationHoldRemaining,.25); globalThis.document.hidden=true; renderer.advancePresentation(.1,{active:true}); assert.equal(renderer.presentationHoldRemaining,.25);
});

test('draw does not advance the separate presentation clock or mutate the real game while hold paints actual enemies as silhouettes', t => {
  const {renderer,canvas} = setup(t),event = comboEvent(),game = gameFor(event),before = structuredClone(game.enemies); renderer.handleEvent(event); renderer.draw(game,{realDt:.1}); renderer.draw(game,{realDt:.1});
  assert.equal(renderer.presentationHoldRemaining,.25); assert.deepEqual(game.enemies,before); assert.ok(canvas.context.operations.some(value => value[0]==='set' && value[1]==='fillStyle' && value[2]==='#091510'));
  renderer.advancePresentation(.25,{active:true}); assert.equal(renderer.presentationHoldRemaining,0);
});

test('all eight pairs draw their distinct original-color motifs without new moving transforms in reduced motion', t => {
  const {renderer} = setup(t,true); assert.equal(Object.keys(ROGUELIKE_COMBO_STYLES).length,8); assert.equal(new Set(Object.values(ROGUELIKE_COMBO_STYLES).map(value => value.motif)).size,8);
  for (const id of Object.keys(ROGUELIKE_COMBO_STYLES)) {
    const event = comboEvent(id),game = gameFor(event); renderer.resetFeedback(); renderer.handleEvent(event); const first = surface(),second = surface(); renderer.drawRoguelikeSkills(first.context,game,true); renderer.drawRoguelikeSkills(first.context,game,false); renderer.drawRoguelikeResult(first.context);
    renderer.advancePresentation(.7,{active:true}); renderer.drawRoguelikeSkills(second.context,game,true); renderer.drawRoguelikeSkills(second.context,game,false); renderer.drawRoguelikeResult(second.context);
    assert.deepEqual(first.context.operations,second.context.operations,id+' keeps one static final composite and its name'); assert.deepEqual(movement(second.context.operations),[]); assert.ok(second.context.operations.some(value => value[0]==='fillText' && value[1]===event.name));
    for(const color of [ROGUELIKE_COMBO_STYLES[id].fromColor,ROGUELIKE_COMBO_STYLES[id].toColor])assert.ok(second.context.operations.some(value => value[0]==='set' && value[2]===color),id+' keeps '+color);
    assert.deepEqual(renderer.roguelikePresentation.camera(true),{x:0,y:0,strength:0});
  }
});

test('normal combo effects and bounded camera shakes advance independently of battle time for all eight pairs', t => {
  const {renderer,canvas} = setup(t);
  for (const id of Object.keys(ROGUELIKE_COMBO_STYLES)) {
    const event = comboEvent(id),game = gameFor(event); renderer.resetFeedback(); renderer.handleEvent(event); renderer.advancePresentation(.65,{active:true}); canvas.context.operations.length=0; renderer.draw(game,{realDt:0});
    const camera = renderer.roguelikePresentation.camera(false); assert.ok(camera.strength>0 && camera.strength<=6); assert.ok(movement(canvas.context.operations).length>0); assert.equal(game.time,10);
    renderer.reducedMotion=true; assert.deepEqual(renderer.roguelikePresentation.camera(true),{x:0,y:0,strength:0}); renderer.reducedMotion=false;
  }
});

test('wall heals keep exact green numbers while reduced motion removes every particle displacement', t => {
  const {renderer} = setup(t,true); renderer.handleEvent({type:'heal',heal:12.5,presentation:'roguelike'}); const first = surface(); renderer.drawRoguelikeEffects(first.context); renderer.advancePresentation(.5,{active:true}); const second = surface(); renderer.drawRoguelikeEffects(second.context);
  const labels = value => value.context.operations.filter(op => op[0]==='fillText'); assert.deepEqual(labels(first),labels(second)); assert.ok(labels(second).some(value => value[1]==='+12.5')); assert.deepEqual(movement(second.context.operations),[]);
  renderer.reducedMotion=false; const normal=surface(); renderer.drawRoguelikeEffects(normal.context); assert.ok(normal.context.operations.filter(value => value[0]==='fillRect').length>=6,'normal healing supplies rising green particles');
});

test('L5 has a growing column and wave normally but a direct static grade and short stable outline in calm mode', t => {
  const {renderer} = setup(t); const camp = {slot:0,type:'archer',level:5,x:100,y:300},event = {type:'campLevel5',camp,presentation:'roguelike'}; renderer.handleEvent(event); camp.x=999;
  renderer.advancePresentation(.2,{active:true}); const normal=surface(); renderer.drawRoguelikeEffects(normal.context); assert.ok(normal.context.operations.some(value => value[0]==='gradient')); assert.ok(normal.context.operations.some(value => value[0]==='ellipse'));
  renderer.resetFeedback(); renderer.reducedMotion=true; renderer.handleEvent({...event,camp:{...camp,x:100}}); const first=surface(); renderer.drawRoguelikeEffects(first.context); assert.ok(first.context.operations.some(value => value[0]==='strokeRect')); renderer.advancePresentation(.5,{active:true}); const calm=surface(); renderer.drawRoguelikeEffects(calm.context);
  assert.ok(calm.context.operations.some(value => value[0]==='fillText' && value[1].includes('Ⅴ'))); assert.ok(!calm.context.operations.some(value => ['gradient','ellipse','strokeRect'].includes(value[0]))); assert.deepEqual(movement(calm.context.operations),[]);
});

test('L5 calm highlighting survives the first actual 30 FPS or 10 FPS draw', t => {
  const {renderer,canvas} = setup(t,true),game = gameFor(comboEvent()); game.camps = [{slot:0,type:'archer',level:5,x:100,y:300,range:280}];
  for (const dt of [1 / 30,.1]) {
    renderer.resetFeedback(); renderer.handleEvent({type:'campLevel5',camp:game.camps[0],presentation:'roguelike'}); renderer.advancePresentation(dt,{active:true}); canvas.context.operations.length = 0; renderer.draw(game,{realDt:dt});
    assert.ok(canvas.context.operations.some(value => value[0]==='strokeRect' && value[1]===71 && value[2]===252 && value[3]===58 && value[4]===59),'first low-frame-rate draw retains the static outline');
  }
});

test('settlement numbers report only actual ultimate damage and all presentation buffers remain bounded', t => {
  const {renderer} = setup(t,true),event=comboEvent(); renderer.handleEvent({type:'damage',source:'ultimate_zhuge_liang',heroId:'zhuge_liang',enemyId:1,amount:12,x:210,y:300}); renderer.handleEvent(event);
  renderer.handleEvent({type:'damage',source:'ultimate_zhou_yu',heroId:'zhou_yu',enemyId:1,amount:8,x:210,y:300}); renderer.handleEvent({type:'damage',source:'hero_zhou_yu',heroId:'zhou_yu',amount:100,x:210,y:300}); renderer.advancePresentation(1.1,{active:true}); const canvas=surface(); renderer.drawRoguelikeResult(canvas.context);
  assert.equal(renderer.roguelikePresentation.combo.damage,20); assert.ok(canvas.context.operations.some(value => value[0]==='fillText' && value[1]==='本段双将实伤 20'));
  for(let i=0;i<1000;i++){renderer.handleEvent({type:'heal',heal:1,presentation:'roguelike'});renderer.handleEvent({type:'damage',source:'ultimate_zhou_yu',heroId:'zhou_yu',enemyId:i,amount:1,x:210,y:300});}
  assert.equal(renderer.roguelikePresentation.effects.length,24); assert.equal(renderer.roguelikePresentation.damageHistory.length,64); assert.ok(renderer.roguelikePresentation.combo.recipients.length<=8); renderer.resetFeedback(); assert.equal(renderer.presentationHoldRemaining,0); assert.equal(renderer.roguelikePresentation.effects.length,0);
});

test('a dense real hit batch keeps its complete actual total even when individual labels are bounded', () => {
  const helper = new RoguelikePresentation();
  for (let id = 0; id < 160; id++) helper.handleEvent({type:'damage',source:'ultimate_zhou_yu',heroId:'zhou_yu',enemyId:id,amount:2,x:210,y:300});
  helper.handleEvent(comboEvent()); assert.equal(helper.damageHistory.length,64); assert.equal(helper.combo.recipients.length,8); assert.equal(helper.combo.damage,320); assert.equal(helper.damageTotals.length,1);
});
