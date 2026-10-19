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

test('catapult fire and root status keep static information in both motion modes',t=>{
  const {renderer}=setup(t),zone={type:'campZone',kind:'catapultFire',x:170,y:240,radius:75};
  const normal=surface(),calm=surface();renderer.reducedMotion=false;renderer.drawCampUpgradeZone(normal.context,{...zone,age:0});
  renderer.reducedMotion=true;renderer.drawCampUpgradeZone(calm.context,{...zone,age:2});
  assert.deepEqual(calm.context.operations,normal.context.operations);
  assert.ok(calm.context.operations.some(op=>op[0]==='arc'&&op[3]===75));
  assert.ok(calm.context.operations.some(op=>op[0]==='fillText'&&op[1]==='火油弹火场'));
  renderer.drawCachedActor=()=>{};
  const enemy={id:1,type:'infantry',hp:100,maxHp:100,campRootRemaining:1};
  for(const reducedMotion of [false,true]){
    const canvas=surface();renderer.reducedMotion=reducedMotion;renderer.drawV1Enemy(canvas.context,enemy,1);
    assert.ok(canvas.context.operations.some(op=>op[0]==='fillText'&&op[1]==='定'),'immobilization remains readable');
  }
});

test('two oil fields keep their separate actual ground regions',t=>{
  const {renderer,canvas}=setup(t);
  const fields=[{type:'oil',fieldId:1,x:100,y:240,radius:70},{type:'oil',fieldId:2,x:300,y:240,radius:70}];
  for(const effect of fields)renderer.drawSkillShape(canvas.context,effect,{ground:true,game:{heroes:[]}});
  const circles=canvas.context.operations.filter(op=>op[0]==='arc'&&op[3]===70);
  assert.ok(circles.some(op=>op[1]===0&&op[2]===0),'oil geometry uses each field local origin');
  const origins=canvas.context.operations.filter(op=>op[0]==='translate');
  assert.ok(origins.some(op=>op[1]===100&&op[2]===240));
  assert.ok(origins.some(op=>op[1]===300&&op[2]===240));
});
