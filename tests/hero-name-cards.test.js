import test from 'node:test';
import assert from 'node:assert/strict';
import {HeroNameCards} from '../hero-name-cards.js';
test('first sightings hold three seconds, then fade; later sessions show names only on request',()=>{
  let now=0;const values=new Map();const storage={getItem:k=>values.get(k),setItem:(k,v)=>values.set(k,v)};
  const cards=new HeroNameCards({storage,now:()=>now});cards.discover(['guan_yu','cao_cao']);
  now=2999;assert.equal(cards.visible().get('guan_yu'),1);
  now=3150;assert.equal(cards.visible().get('cao_cao'),.5);assert.equal(cards.visible(true).get('cao_cao'),1);
  now=3300;assert.equal(cards.visible().size,0);
  const reloaded=new HeroNameCards({storage,now:()=>now});reloaded.discover(['guan_yu','cao_cao']);assert.equal(reloaded.visible().size,0);
  reloaded.show('guan_yu');now+=1999;assert.ok(reloaded.visible().has('guan_yu'));now++;assert.equal(reloaded.visible().size,0);
  reloaded.discover(['xiahou_dun']);assert.deepEqual([...reloaded.visible().keys()],['xiahou_dun']);
});
test('name cards survive unavailable storage and remain independent of combat objects',()=>{
  const storage={getItem(){throw Error('private mode');},setItem(){throw Error('private mode');}};
  const cards=new HeroNameCards({storage,now:()=>0}),heroes=Object.freeze(['guan_yu']);
  cards.discover(heroes);assert.equal(cards.visible().get('guan_yu'),1);cards.clear();assert.equal(cards.visible().size,0);
});
