import test from 'node:test';
import assert from 'node:assert/strict';
import { V1Game, seededRandom } from '../v1-engine.js';
import { BALANCE as B } from '../runtime-data.js';
import { mergeHeroTactics } from '../hero-upgrade-rules.js';
import { mergeCampTactics } from '../camp-upgrade-rules.js';
import { updateCampFireFields } from '../camp-upgrade-effects.js';

const close = (actual,expected,message='') => assert.ok(Math.abs(actual-expected) < 1e-6,`${message}: ${actual} vs ${expected}`);
function game(type, options={}) {
  const g = new V1Game({mode:'endless',unlockedCamps:Object.keys(B.camps),party:[{heroId:'guan_yu'}],rng:seededRandom(9),...options});
  g.start(); g._spawnQueue=[{at:1e9}]; g._spawnIndex=0; g.food=10000; g.build(0,type); return g;
}
function cards(g,...ids) {
  for (const id of ids) { const card=g.tacticDefinition(id); assert.ok(card,id); g.state='choosing'; g.upgrades=[{id,...card}]; assert.equal(g.selectUpgrade(id).ok,true); }
  g._between=0;
}
function enemy(g,type='cavalry',values={}) {
  const camp=g.camps[0];
  return Object.assign(g._spawn({type,wave:g._waveConfig(1),lane:0,progress:300}),{hp:100000,maxHp:100000,speed:0,x:camp.x,y:camp.y},values);
}
function impact(g,camp,target,damage=g._campStats(camp).damage) {
  g.projectiles.push({type:camp.type,campType:camp.type,camp,x:target.x,y:target.y,targetId:target.id,targetX:target.x,targetY:target.y,speed:1000,damage,life:4});
  g._projectiles(.01);
}

test('P2 merges 42 camp cards into the actual catalog while preserving the published P1 registry', () => {
  const base=mergeHeroTactics(B),catalog=mergeCampTactics(base,B),g=game('archer');
  assert.equal(Object.keys(base).length,104); assert.equal(Object.keys(catalog).length,128);
  assert.equal(Object.values(g.tacticCatalog).filter(card=>card.category==='camp').length,42);
  for (const [type,group] of Object.entries(B.campUpgrades)) for (const card of group.upgrades) {
    assert.ok(g.tacticCatalog[card.id]); assert.equal(g.tacticDefinition(card.id).name,card.name);
    if (card.endlessOnly) {
      const owner=game(type); owner.lockedTacticId=card.id; owner._offerTactics(); assert.ok(owner.upgrades.some(choice=>choice.id===card.id));
      owner.selectUpgrade(card.id); owner.lockedTacticId=card.id; owner._offerTactics(); assert.ok(owner.upgrades.every(choice=>choice.id!==card.id));
    }
  }
  assert.equal(Object.keys(g.tacticDefinitions).length,104);
});

test('all new camp effects stay outside campaign and all eighteen legacy definitions remain unchanged', () => {
  const baseline=JSON.stringify(B.camps),story=new V1Game({unlockedCamps:Object.keys(B.camps)}); story.food=10000; story.build(1,'catapult');
  const camp=story.camps.find(c=>c.type==='catapult'),before=story._campInterval(camp);
  for (const group of Object.values(B.campUpgrades)) for (const card of group.upgrades) {
    if (card.endlessOnly) { assert.equal(story.tacticDefinition(card.id),undefined); story.tactics.add(card.id); }
    else { assert.equal(card.name,B.tactics[card.id].name); assert.deepEqual(card.effects,B.tactics[card.id].effects); }
  }
  close(story._campInterval(camp),before); assert.deepEqual(story._campEffects(camp),{}); assert.equal(JSON.stringify(B.camps),baseline);
});

test('archer cards add two real targets, local speed/slow and capped per-camp wave growth', () => {
  const g=game('archer',{rng:()=>.99}); cards(g,'archer_multishot','archer_rain','archer_whistle','archer_yangyouji');
  const camp=g.camps[0],targets=Array.from({length:4},(_,i)=>enemy(g,'cavalry',{x:camp.x+10*i,progress:400-i}));
  close(camp.range,245); close(g._campInterval(camp),.9*.85); g._attackCamps(.01); assert.equal(g.projectiles.length,3);
  close(g.projectiles[0].damage,12); close(g.projectiles[1].damage,7.2); g._projectiles(1);
  assert.equal(targets.filter(e=>e.hp<100000).length,3); assert.ok(targets[0].slowEffects.some(s=>s.factor===.82&&s.remaining===1.5));
  for(let i=0;i<45;i++) g._campHit(camp,enemy(g,'infantry',{hp:1}),10,'archer');
  close(g._campDamage(camp,targets[0],100),140); g.build(1,'archer'); close(g._campDamage(g.camps[1],targets[0],100),100);
  cards(g,'attr_camp_temper'); close(g._campDamage(camp,targets[0],100),154);
  camp.level=5; g._updateCamp(camp); close(g._campInterval(camp),.64*.8); g._startWave(2); close(g._campDamage(camp,targets[0],100),110);
});

test('shield cards count crowds, amplify other camps, strengthen elite control and root each enemy on the shared cooldown', () => {
  const g=game('shield'); cards(g,'shield_chain','shield_resolve','shield_iron_order','shield_eight_gates'); const shield=g.camps[0];
  const targets=Array.from({length:100},()=>enemy(g,'armor')); close(g._campDamage(shield,targets[0],100),180);
  g.build(1,'archer'); const archer=g.camps[1]; let before=targets[0].hp; g._campHit(archer,targets[0],100,'archer'); close(before-targets[0].hp,115);
  before=targets[0].hp; g._campHit(shield,targets[0],100,'shield'); close(before-targets[0].hp,100);
  close(g._resistedSlow(targets[0],.46,.22,.15),1-(1-.46)*.7*1.15);
  shield.x=targets[0].x; shield.y=targets[0].y;
  // Use one stationary unit on the real path to verify the continuous aura's movement control.
  g.enemies=[targets[0]]; targets[0].progress=300; targets[0].speed=30; Object.assign(targets[0],g.pathPoint(0,300)); Object.assign(shield,{x:targets[0].x,y:targets[0].y});
  g._step(.01); close(targets[0].progress,300); assert.ok(targets[0].campRootRemaining>0); const cooldown=targets[0].nextCampRootAt;
  g._step(.2); close(targets[0].nextCampRootAt,cooldown); close(targets[0].progress,300);
});

test('catapult cards change only the owned damage cap, add three ticks of fire, speed volleys and fire at a different random target', () => {
  const g=game('catapult'); cards(g,'catapult_oil_shell','catapult_collapse','catapult_repeat','catapult_thunder_cart'); const camp=g.camps[0];
  close(g._campInterval(camp),3*.82); const targets=Array.from({length:12},()=>enemy(g));
  impact(g,camp,targets[0]); assert.equal(targets.filter(e=>e.hp<100000).length,10); assert.ok(targets.every(e=>e.slowEffects.length));
  assert.equal(g._campFireFields[0].radius,58); const before=targets[0].hp; updateCampFireFields(g,3); close(before-targets[0].hp,36);
  assert.ok(g.effects.some(effect=>effect.type==='campZone'&&effect.kind==='catapultFire'));
  g.projectiles=[]; camp.cooldown=0; g._attackCamps(.01); assert.equal(g.projectiles.length,2); assert.notEqual(g.projectiles[0].targetId,g.projectiles[1].targetId);
  close(g.projectiles[1].damage,14*.7); assert.equal(B.camps.catapult.damageTargetCap,6);
});

test('crossbow percent damage stays independent of body damage, tech, precision and generic bonuses', () => {
  const g=game('crossbow',{campTech:{crossbow:10}}); cards(g,'crossbow_armor_cone','crossbow_precision','attr_camp_temper'); const camp=g.camps[0];
  const boss=enemy(g,'boss',{hp:10000,maxHp:10000}),body=g._campDamage(camp,boss,g._campStats(camp).damage);
  let before=boss.hp; g._campHit(camp,boss,body,'crossbow'); close(before-boss.hp,body+300);
  before=boss.hp; g._campHit(camp,boss,body*.35,'crossbow',{branchScale:.35}); close(before-boss.hp,body*.35+105);
  const cavalry=enemy(g,'cavalry',{hp:10000,maxHp:10000}); before=cavalry.hp; g._campHit(camp,cavalry,body,'crossbow'); close(before-cavalry.hp,body);
});

test('crossbow mechanisms snapshot three kill stacks at firing, target current HP and mark all incoming damage', () => {
  const g=game('crossbow'); cards(g,'crossbow_machine','crossbow_marksmen','crossbow_divine','attr_camp_temper'); const camp=g.camps[0];
  close(g._campInterval(camp),1.3*.8);
  for(let i=0;i<4;i++) g._campHit(camp,enemy(g,'infantry',{hp:1}),100,'crossbow');
  assert.equal(camp.upgradeState.nextAttackStacks,3);
  const boss=enemy(g,'boss',{hp:10000}),ordinary=enemy(g,'cavalry',{hp:20000}); g._attackCamps(.01);
  assert.equal(g.projectiles[0].targetId,ordinary.id); close(g.projectiles[0].damage,20); close(g.projectiles[0].attackDamageBonus,2.4); assert.equal(camp.upgradeState.nextAttackStacks,0);
  const firedHp=ordinary.hp;
  g._projectiles(1); assert.ok(ordinary.vulnerability.some(v=>v.factor===1.18)); const before=ordinary.hp; g._damage(ordinary,100,'hero_guan_yu'); close(before-ordinary.hp,118);
  close(firedHp-before,20*(1+.1+2.4)*1.18);
  camp.level=5; g._updateCamp(camp); close(g._campInterval(camp),.92*.75); assert.equal(boss.hp,10000);
});

test('oil cards enlarge and strengthen fields, extend each level duration, burn exits and keep two readable ground fields', () => {
  const g=game('fire_oil'); cards(g,'fire_oil_fierce','fire_oil_spread_time','fire_oil_scorch','fire_oil_embers'); const camp=g.camps[0],target=enemy(g);
  impact(g,camp,target,0); assert.equal(camp.field.radius,83); assert.equal(camp.field.remaining,4.5);
  let before=target.hp; g._oilField(camp,.75); close(before-target.hp,3*1.25*1.2);
  const other=enemy(g,'cavalry',{x:camp.x+180,y:camp.y}); impact(g,camp,other,0); assert.equal(camp.fields.length,2);
  const visuals=g.effects.filter(e=>e.type==='oil'); assert.equal(visuals.length,2); assert.equal(new Set(visuals.map(e=>e.fieldId)).size,2);
  before=target.hp; g._damage(target,100,'hero_guan_yu'); close(before-target.hp,120);
  g._oilField(camp,.01); target.x=camp.x-200; g._oilField(camp,.01);
  const burn=target.oilBurns.find(b=>b.slot===camp.slot); assert.equal(burn.remaining,2); before=target.hp;
  g._oilBurns(1); close(before-target.hp,3*1.25*.5);
  camp.level=5; g._updateCamp(camp); impact(g,camp,other,0); assert.equal(camp.field.remaining,5.5);
});

test('drum cards count their source camp, raise only the local cap and double owned speed and damage after an ultimate', () => {
  const g=game('war_drum',{campTech:{war_drum:10}}); cards(g,'war_drum_first','war_drum_three','war_drum_morale','war_drum_resound','war_drum_vigor'); const drum=g.camps[0];
  drum.level=5; g._updateCamp(drum); for(let slot=1;slot<6;slot++){g.build(slot,'archer');Object.assign(g.camps.at(-1),{x:drum.x,y:drum.y});}
  const archer=g.camps[1],hero=g.heroes[0]; Object.assign(hero,{x:drum.x,y:drum.y});
  close(g._friendlySpeed(archer),.45); close(g._friendlySpeed(hero),.45);
  const target=enemy(g),tech=g._campStats(drum).auraDamage; close(g._campDamage(archer,target,100),100*(1+tech)*1.23);
  g._beginCast(hero,g._target(hero)); close(g._campDamage(archer,target,100),100*(1+tech*2)*1.46); close(drum.upgradeState.empoweredUntil,g.time+5);
  g.time+=2; g._beginCast(hero,g._target(hero)); close(drum.upgradeState.empoweredUntil,g.time+5);
  g.time+=5.01; close(g._campDamage(archer,target,100),100*(1+tech)*1.23); assert.equal(B.camps.war_drum.globalAttackSpeedBonusCap,.3);
});

test('camp fire and ordinary oil share the generic additive DoT pool and legacy range cards apply once', () => {
  const g=game('catapult'); cards(g,'catapult_oil_shell','attr_camp_temper','attr_dot_formula'); const camp=g.camps[0],target=enemy(g);
  impact(g,camp,target); const before=target.hp; updateCampFireFields(g,1); close(before-target.hp,12*1.4);
  const cross=game('crossbow'); cards(cross,'crossbow_range'); close(cross.camps[0].range,205+25);
  const shield=game('shield'); cards(shield,'shield_reach'); close(shield.camps[0].range,145+25);
  const drum=game('war_drum'); cards(drum,'war_drum_reach'); close(drum.camps[0].range,180+30);
  const stone=game('catapult'); cards(stone,'catapult_blast'); impact(stone,stone.camps[0],enemy(stone));
  close(stone.effects.find(effect=>effect.type==='explosion').radius,48+12);
  const oil=game('fire_oil'); cards(oil,'fire_oil_spread'); impact(oil,oil.camps[0],enemy(oil),0);
  close(oil.camps[0].field.radius,58+16);
  cards(oil,'fire_oil_fierce','attr_camp_temper','attr_dot_formula'); close(oil._campDamage(oil.camps[0],enemy(oil),100),100*1.4*1.25);
});
