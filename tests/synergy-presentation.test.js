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


test('all four synergy ground geometries preserve identical static regions and names under reduced motion',t=>{
  const {renderer}=setup(t),zones=[
    {kind:'eastWind',target:{laneId:'route_0',s0:100,s1:580,length:480,width:100,x:140,y:300}},
    {kind:'tigerCommand',target:{x:210,y:300,radius:165}},
    {kind:'thunderCross',target:{x:210,y:300,crosses:[{x:100,y:220,length:216,width:110},{x:300,y:300,length:216,width:110}]}},
    {kind:'chibiBurn',enemyId:1,target:{x:100,y:300,radius:20}}
  ];
  for(const zone of zones){
    const normal=surface(),calm=surface(),game={enemies:[{id:1,hp:100,x:230,y:320}]};
    renderer.reducedMotion=false;renderer.drawSynergyZone(normal.context,{...zone,age:0},game);
    renderer.reducedMotion=true;renderer.drawSynergyZone(calm.context,{...zone,age:1},game);
    assert.deepEqual(calm.context.operations,normal.context.operations,zone.kind+' remains static');
    assert.ok(calm.context.operations.some(op=>op[0]==='fillText'),'each region keeps its information');
    assert.ok(!calm.context.operations.some(op=>['translate','rotate','scale'].includes(op[0])),'new regions use no moving transforms');
  }
});

test('cross lightning renders the real union outlines and chibi burns follow their actual living recipient',t=>{
  const {renderer,canvas}=setup(t),cross={kind:'thunderCross',target:{crosses:[{x:200,y:250,length:240,width:120}]}};
  renderer.drawSynergyZone(canvas.context,cross,{enemies:[]});
  assert.equal(canvas.context.operations.filter(op=>op[0]==='moveTo').length,1);
  assert.equal(canvas.context.operations.filter(op=>op[0]==='lineTo').length,11);
  assert.equal(canvas.context.operations.filter(op=>op[0]==='arc').length,0);
  const game={enemies:[{id:8,hp:100,x:200,y:320}]},effect={kind:'chibiBurn',enemyId:8,target:{x:0,y:0,radius:20}};
  canvas.context.operations.length=0;renderer.drawSynergyZone(canvas.context,effect,game);
  assert.ok(canvas.context.operations.some(op=>op[0]==='arc'&&op[1]===200&&op[2]===320));
  assert.deepEqual(effect.target,{x:0,y:0,radius:20},'drawing leaves the hit snapshot unchanged');
  game.enemies[0].hp=0;canvas.context.operations.length=0;renderer.drawSynergyZone(canvas.context,effect,game);
  assert.equal(canvas.context.operations.length,0,'dead recipients have no ghost burn');
});
