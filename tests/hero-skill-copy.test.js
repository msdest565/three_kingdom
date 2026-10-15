import test from 'node:test';
import assert from 'node:assert/strict';
import {HERO_SKILL_COPY,skillPreviewSvg} from '../hero-skill-copy.js';
import {BALANCE} from '../runtime-data.js';
test('all fifteen skill previews have safe local geometry and renamed copy matches balance data',t=>{
  const create=()=>({attributes:{},children:[],style:{setProperty(){}},setAttribute(k,v){this.attributes[k]=String(v);},append(n){this.children.push(n);}});
  const original=Object.getOwnPropertyDescriptor(globalThis,'document');
  globalThis.document={createElementNS:()=>create()};
  t.after(()=>{if(original)Object.defineProperty(globalThis,'document',original);else delete globalThis.document;});
  for(const [id,hero] of Object.entries(BALANCE.heroes)){
    const copy=HERO_SKILL_COPY[id];assert.ok(copy.description);assert.ok(copy.tags.length>=2&&copy.tags.length<=3);
    if(copy.name)assert.equal(copy.name,hero.ultimate.name,id);
    const svg=skillPreviewSvg(id);assert.equal(svg.attributes['data-shape'],hero.ultimate.shape);
    const effect=svg.children.find(n=>n.attributes.class==='preview-effect');assert.ok(effect.children.length>0,`${id} has an implemented shape`);
    const visit=n=>{for(const [k,v]of Object.entries(n.attributes)){assert.ok(!/^(href|onload)$/i.test(k));assert.ok(!/NaN|Infinity|<script|<image/.test(v));}n.children.forEach(visit);};visit(svg);
  }
});
