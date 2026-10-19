import test from 'node:test';
import assert from 'node:assert/strict';
import { BALANCE as B, CONTENT } from '../runtime-data.js';
import { V1Renderer } from '../v1-renderer.js';

function surface(width = 420, height = 600) {
  const operations = [], props = {}, gradient = { addColorStop() {} };
  const context = new Proxy({ operations, measureText: value => ({width:String(value).length * 8}),createLinearGradient:() => gradient,createRadialGradient:() => gradient }, {
    get(target,key) {
      if (key in target) return target[key];
      if (key in props) return props[key];
      return (...args) => {
        for (const value of args) if (typeof value === 'number') assert.ok(Number.isFinite(value),`finite ${String(key)} geometry`);
        operations.push([key,...args]);
      };
    },
    set(target,key,value) { props[key] = value; operations.push(['set',key,value]); return true; },
  });
  return {width,height,context,getContext:() => context,getBoundingClientRect:() => ({left:0,top:0,width:420,height:600,right:420,bottom:600})};
}

function setup(t) {
  const previousWindow=globalThis.window,previousDocument=globalThis.document;
  globalThis.window={devicePixelRatio:1};globalThis.document={createElement:()=>surface()};
  t.after(()=>{if(previousWindow===undefined)delete globalThis.window;else globalThis.window=previousWindow;if(previousDocument===undefined)delete globalThis.document;else globalThis.document=previousDocument;});
  const canvas=surface(),renderer=new V1Renderer(canvas,{reducedMotion:true});
  renderer.setMap(CONTENT.maps[0]);t.after(()=>renderer.destroy());return {canvas,renderer};
}

test('hero skill rendering prefers the immutable cast snapshot and falls back to the effective preview',t=>{
  const {canvas,renderer}=setup(t),hero={id:'sima_yi',definition:B.heroes.sima_yi};
  const original=JSON.stringify(B.heroes.sima_yi),snapshot={...hero.definition.ultimate,radius:120,delaySec:.6};
  const calls=[];renderer.drawRedesignedSkill=(ctx,effect,options)=>calls.push(options.definition);
  const game={heroes:[hero],heroUltimate:()=>snapshot};
  renderer.drawSkillShape(canvas.context,{heroId:hero.id,shape:'delayed_multi_circle',ultimate:snapshot},{game});
  renderer.drawSkillShape(canvas.context,{heroId:hero.id,shape:'delayed_multi_circle'},{preview:true,game});
  assert.equal(calls[0],snapshot);assert.equal(calls[1],snapshot);
  assert.equal(JSON.stringify(B.heroes.sima_yi),original);
});

test('multi-road cards render each independently locked strip rather than duplicating a single road',t=>{
  const {canvas,renderer}=setup(t),calls=[];
  renderer.drawRedesignedSkill=(ctx,effect)=>calls.push([effect.laneId,effect.s0,effect.s1,effect.width]);
  renderer.drawSkillShape(canvas.context,{heroId:'gan_ning',shape:'lane_volley_strip',width:120,
    strips:[{laneId:'route_0',s0:20,s1:320},{laneId:'route_1',s0:80,s1:380}]},{preview:true,game:{heroes:[]}});
  assert.deepEqual(calls,[['route_0',20,320,120],['route_1',80,380,120]]);
});

test('five-pass Zhao Yun and eight-mine Lu Meng retain all of their actual geometry',t=>{
  const {canvas,renderer}=setup(t);
  renderer.drawSkillLayers(canvas.context,'zhao_yun',{age:.8,width:85,length:610,definition:{passAtSec:[0,.15,.3,.45,.6]}});
  assert.equal(canvas.context.operations.filter(op=>op[0]==='fill').length,5);
  canvas.context.operations.length=0;
  const ultimate={...B.heroes.lv_meng.ultimate,laneProgressFractions:[.15,.35,.55,.75]};
  renderer.drawSkillShape(canvas.context,{heroId:'lv_meng',shape:'lane_mines',laneIds:['route_0','route_1']},
    {preview:true,game:{heroes:[{id:'lv_meng',definition:B.heroes.lv_meng}],heroUltimate:()=>ultimate}});
  assert.equal(canvas.context.operations.filter(op=>op[0]==='arc'&&op[3]===ultimate.triggerRadius).length,8);
});

test('new control and support zones preserve identical static information with reduced motion',t=>{
  const {renderer}=setup(t);
  const zones=[{heroId:'cao_cao',zoneKind:'banner',x:200,y:240,radius:165},
    {heroId:'liu_bei',zoneKind:'barrier',x:200,y:300,progress:200,laneId:'route_0',width:110,radius:55},
    {heroId:'guan_yu',zoneKind:'bladeWind',x:210,y:550,width:184,length:610,angle:-Math.PI/2,
      previousTarget:{x:210,y:550,width:184,length:610,angle:-Math.PI/2+.1}},
    {heroId:'zhang_fei',zoneKind:'rearguard',x:210,y:550,width:160,length:430,angle:-Math.PI/2,
      target:{x:210,y:550,width:160,length:430,angle:-Math.PI/2}},
    {heroId:'zhang_liao',zoneKind:'chargeMist',x:140,y:240,radius:50}];
  for(const zone of zones){
    const normal=surface(),calm=surface();renderer.reducedMotion=false;renderer.drawHeroUpgradeZone(normal.context,{...zone,age:0});
    renderer.reducedMotion=true;renderer.drawHeroUpgradeZone(calm.context,{...zone,age:1});
    assert.deepEqual(calm.context.operations,normal.context.operations,zone.zoneKind+' keeps its region and label without movement');
    assert.ok(calm.context.operations.some(op=>op[0]==='fillText'));
    assert.ok(calm.context.operations.filter(op=>op[0]==='set'&&['fillStyle','strokeStyle'].includes(op[1])).every(op=>typeof op[2]==='string'));
    if(zone.zoneKind==='rearguard'){
      assert.equal(calm.context.operations.filter(op=>op[0]==='arc').length,0,'rearguard keeps its rectangular attack region');
      assert.ok(calm.context.operations.some(op=>op[0]==='fillText'&&op[1]==='断后'));
    }
  }
});
