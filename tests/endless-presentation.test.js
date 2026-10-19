import test from 'node:test';
import assert from 'node:assert/strict';
import { CONTENT } from '../runtime-data.js';
import { CAMP_IDS, createBattleSpriteCache, drawCampSprite } from '../battle-sprites.js';
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

test('endless camp tiers preserve the established L3 mechanism and add readable IV/V badges', () => {
  for (const id of CAMP_IDS) {
    const third = surface(); drawCampSprite(third.context,id,{level:3,reducedMotion:true});
    for (const level of [4,5]) {
      const canvas = surface(); drawCampSprite(canvas.context,id,{level,reducedMotion:true});
      assert.deepEqual(canvas.context.operations.slice(0,third.context.operations.length),third.context.operations,`${id} L${level} retains the L3 mechanism`);
      assert.ok(canvas.context.operations.some(op => op[0] === 'fillText' && op[1] === (level === 5 ? 'Ⅴ' : 'Ⅳ')),`${id} L${level} badge remains visible with reduced motion`);
    }
  }
});

test('endless L4 and L5 occupy separate cache entries, while reduced motion folds each grade to a static pose', () => {
  const cache = createBattleSpriteCache({createCanvas:surface});
  for (const id of CAMP_IDS) {
    const third = cache.get('camp',id,{level:3}),fourth = cache.get('camp',id,{level:4}),fifth = cache.get('camp',id,{level:5});
    assert.equal(fourth.level,4); assert.equal(fifth.level,5);
    assert.notEqual(third,fourth); assert.notEqual(fourth,fifth);
    assert.equal(cache.get('camp',id,{level:5}),fifth);
    for (const level of [4,5]) for (const state of ['idle','attack']) {
      const first = cache.get('camp',id,{level,state,frame:0,reducedMotion:true});
      assert.equal(cache.get('camp',id,{level,state,frame:4,reducedMotion:true}),first);
      const a = surface(),b = surface();
      drawCampSprite(a.context,id,{level,state,frame:0,reducedMotion:true});
      drawCampSprite(b.context,id,{level,state,frame:4,reducedMotion:true});
      assert.deepEqual(a.context.operations,b.context.operations,`${id} L${level} ${state} has no frame movement`);
    }
  }
});

test('renderer detects both endless camp upgrades and exposes the real grade to sprite and selected label', t => {
  const previousWindow = globalThis.window,previousDocument = globalThis.document;
  globalThis.window = {devicePixelRatio:1}; globalThis.document = {createElement:() => surface()};
  t.after(() => { if (previousWindow === undefined) delete globalThis.window; else globalThis.window = previousWindow; if (previousDocument === undefined) delete globalThis.document; else globalThis.document = previousDocument; });
  const canvas = surface(),renderer = new V1Renderer(canvas,{reducedMotion:true});
  t.after(() => renderer.destroy());
  const camp = {slot:0,type:'archer',level:3,range:120},game = {map:CONTENT.maps[0],heroes:[],enemies:[],camps:[camp],hp:100,maxHp:100,wave:1,pendingEnemyCount:1};
  renderer.observe(game,1); assert.deepEqual(renderer.consumeUiEvents(),[]);
  const grades = []; renderer.drawCachedActor = (ctx,kind,id,options) => grades.push(options.level);
  for (const level of [4,5]) {
    camp.level = level; renderer.observe(game,1 + level * .01);
    assert.deepEqual(renderer.consumeUiEvents().map(event => [event.type,event.level]),[['upgrade',level]]);
    renderer.drawV1Camp(canvas.context,camp,true,0);
    assert.ok(canvas.context.operations.some(op => op[0] === 'fillText' && op[1] === `弓营 ${level === 5 ? 'Ⅴ' : 'Ⅳ'}`));
  }
  assert.deepEqual(grades,[4,5]);
  renderer.observe(game,1.06); assert.deepEqual(renderer.consumeUiEvents(),[]);
});

test('hero readiness uses the increased endless rage cost rather than a fixed 100', () => {
  const renderer = Object.create(V1Renderer.prototype);
  renderer.reducedMotion = true; renderer.actorAttacks = new Map(); renderer.heroRageCosts = new Map([['guan_yu',108]]);
  assert.equal(renderer.actorFrame({id:'guan_yu',rage:100},0).state,'idle');
  assert.equal(renderer.actorFrame({id:'guan_yu',rage:108},0).state,'ready');
});
