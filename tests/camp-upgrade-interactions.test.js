import test from 'node:test';
import assert from 'node:assert/strict';
import { V1Game } from '../v1-engine.js';
import { BALANCE as B } from '../runtime-data.js';
import { createOilField, oilFields } from '../camp-upgrade-effects.js';

const near = (actual,expected,message) => assert.ok(Math.abs(actual - expected) < 1e-6,`${message}: ${actual} versus ${expected}`);
function fixture(types,cardIds = [],heroIds = ['guan_yu'],options = {}) {
  const events = [],game = new V1Game({mode:'endless',party:heroIds.map(heroId => ({heroId})),unlockedCamps:Object.keys(B.camps),rng:() => 0,onEvent:event => events.push(event),...options});
  for (const id of cardIds) { assert.ok(game.tacticDefinition(id),id); game.tactics.add(id); game.tacticCounts[id] = 1; }
  game.start(); game._between = 0; game._spawnQueue = [{at:1e9}]; game._spawnIndex = 0; game.food = 10000;
  for (const hero of game.heroes) hero.attackCooldown = 1e9;
  const camps = types.map((item,slot) => { const type = typeof item === 'string' ? item : item.type,level = typeof item === 'string' ? 1 : item.level; const camp = game._addCamp(slot,type,level); camp.cooldown = 1e9; return camp; });
  const spawn = (type = 'cavalry',progress = 300,lane = 0,values = {}) => Object.assign(game._spawn({type,progress,lane,wave:game._waveConfig(1)}),{hp:100000,maxHp:100000,speed:0},values);
  const impact = (camp,target,damage = game._campStats(camp).damage || 0) => {
    game.projectiles.push({type:camp.type,campType:camp.type,camp,x:target.x,y:target.y,targetId:target.id,targetX:target.x,targetY:target.y,speed:1000,damage,life:4}); game._projectiles(.01);
  };
  return {game,camps,spawn,impact,events};
}

test('an L5 multishot volley shares its three unique targets with legacy pierce and its extra arrow', () => {
  const {game,camps:[camp],spawn} = fixture([{type:'archer',level:5}],['archer_multishot','archer_pierce','archer_volley','archer_whistle']);
  const targets = Array.from({length:5},(_,i) => spawn('cavalry',400 - i * 10,0,{x:camp.x + 40 + i * 25,y:camp.y}));
  camp.cooldown = 0; game._attackCamps(0); assert.equal(game.projectiles.length,4,'main, two multishot branches, one L5 arrow');
  const ledger = game.projectiles[0].attackLedger; assert.equal(ledger.cap,3); assert.ok(game.projectiles.every(projectile => projectile.attackLedger === ledger));
  game._projectiles(1);
  assert.deepEqual(targets.filter(enemy => enemy.hp < 100000).map(enemy => enemy.id),targets.slice(0,3).map(enemy => enemy.id));
  const base = game._campStats(camp).damage;
  near(100000 - targets[0].hp,base * 1.75,'main target receives main, legacy 25% volley and L5 50% arrow');
  near(100000 - targets[1].hp,base * .95,'first side target receives 60% multishot and 35% pierce');
  near(100000 - targets[2].hp,base * .6,'second side target receives only its 60% multishot');
  assert.ok(targets.slice(0,3).every(enemy => enemy.slowEffects.some(effect => effect.factor === .82)));
});

test('legacy camp range and area upgrades combine with their new counterparts exactly once', () => {
  const {game,camps,spawn,impact} = fixture(['catapult','fire_oil','crossbow','war_drum'],['catapult_blast','catapult_thunder_cart','fire_oil_spread','fire_oil_fierce','crossbow_range','war_drum_reach']);
  const [stone,oil,crossbow,drum] = camps,target = spawn();
  near(crossbow.range,205 + 25,'legacy crossbow range applies once'); near(drum.range,180 + 30,'legacy drum range applies once');
  impact(stone,target); near(game.effects.find(effect => effect.type === 'explosion').radius,48 + 12 + 10,'legacy and new stone radii add once');
  impact(oil,target,0); near(oil.field.radius,58 + 16 + 25,'legacy and new oil radii add once');
});

test('marksman stacks belong to their source camp and remain snapshotted while a shot is in flight', () => {
  const {game,camps:[a,b],spawn} = fixture(['crossbow','crossbow'],['crossbow_marksmen','crossbow_divine']);
  for (let i = 0; i < 3; i++) game._campHit(a,spawn('infantry',300,0,{hp:1}),100,'crossbow');
  game._campHit(b,spawn('infantry',300,0,{hp:1}),100,'crossbow');
  assert.equal(a.upgradeState.nextAttackStacks,3); assert.equal(b.upgradeState.nextAttackStacks,1);
  a.cooldown = 0; game._attackCamps(0); assert.equal(a.upgradeState.nextAttackStacks,3,'a targetless attack does not consume stacks');
  const high = spawn('cavalry',300,0,{x:a.x + 40,y:a.y,hp:100000}),boss = spawn('boss',300,0,{x:a.x + 45,y:a.y,hp:50000});
  game._attackCamps(0); const shot = game.projectiles[0]; assert.equal(shot.targetId,high.id); near(shot.damage,20,'the fired shot preserves its base body damage'); near(shot.attackDamageBonus,2.4,'the fired shot captures three kill stacks in the additive attack bucket');
  assert.equal(a.upgradeState.nextAttackStacks,0); assert.equal(b.upgradeState.nextAttackStacks,1);
  game._campHit(a,spawn('infantry',300,0,{hp:1}),100,'crossbow'); assert.equal(a.upgradeState.nextAttackStacks,1); near(shot.damage,20,'a later kill cannot rewrite the in-flight body damage'); near(shot.attackDamageBonus,2.4,'a later kill cannot rewrite the captured kill stacks');
  game._projectiles(1); near(100000 - high.hp,68 * 1.18,'the old shot retains its captured body damage and applies the current mark once'); assert.equal(boss.hp,50000);
  Object.assign(b,{x:a.x,y:a.y}); b.cooldown = 0; game._attackCamps(0); const second = game.projectiles.find(projectile => projectile.camp === b); assert.ok(second,'the second camp can reach the same target'); near(second.damage,20,'the other camp also preserves its base body damage'); near(second.attackDamageBonus,.8,'the other camp spends only its own stack');
  assert.equal(a.upgradeState.nextAttackStacks,1); assert.equal(b.upgradeState.nextAttackStacks,0);
});

test('two overlapping oil fields from one camp tick once and provide one incoming-damage multiplier', () => {
  const {game,camps:[camp],spawn} = fixture(['fire_oil'],['fire_oil_fierce','fire_oil_embers']);
  const enemy = spawn(),point = {x:enemy.x,y:enemy.y};
  createOilField(game,camp,point,83,4); game._oilField(camp,.2); createOilField(game,camp,{x:point.x + 30,y:point.y},83,4);
  assert.equal(oilFields(camp).length,2); const before = enemy.hp; game._oilField(camp,.55);
  near(before - enemy.hp,3 * 1.25 * 1.2,'overlap cannot cause a double oil tick');
  const probe = enemy.hp; game._damage(enemy,100,'interaction_probe'); near(probe - enemy.hp,120,'two same-source fields do not multiply exposure twice');
  createOilField(game,camp,{x:point.x + 200,y:point.y},83,4);
  assert.equal(oilFields(camp).length,2); const visuals = game.effects.filter(effect => effect.type === 'oil' && effect.campSlot === camp.slot);
  assert.equal(visuals.length,2); assert.equal(new Set(visuals.map(effect => effect.fieldId)).size,2);
});

test('L5 edge burning stays stronger than exit burning while the same-source tail and both clocks freeze', () => {
  const {game,camps:[camp],spawn} = fixture([{type:'fire_oil',level:5}],['fire_oil_scorch','fire_oil_embers']);
  const enemy = spawn(),center = {x:enemy.x,y:enemy.y}; createOilField(game,camp,center,70,4); game.update(.1);
  let exit;
  for (let progress = enemy.progress; progress < enemy.pathLength; progress += .1) {
    const point = game.pathPoint(enemy.laneId,progress),distance = Math.hypot(point.x - center.x,point.y - center.y);
    if (distance > 70 + enemy.radius + 3 && distance < 70 + enemy.radius + 9) { exit = {...point,progress}; break; }
  }
  assert.ok(exit,'the real route has an accessible L5 outer edge'); Object.assign(enemy,exit); game.update(.02);
  const before = enemy.hp;
  const snapshot = () => JSON.stringify({time:game.time,fields:oilFields(camp),burns:enemy.oilBurns?.map(({camp:owner,...burn}) => ({...burn,exitTail:burn.exitTail && {...burn.exitTail,camp:owner.slot}})),hp:enemy.hp});
  game.pause(); const paused = snapshot(); game.update(120); assert.equal(snapshot(),paused);
  game.resume(); game.state = 'choosing'; const choosing = snapshot(); game.update(120); assert.equal(snapshot(),choosing);
  game.state = 'playing'; game.update(2.04);
  near(before - enemy.hp,9 * 1.5,'one full edge tick followed by one half-strength exit tick; same-source burns never double-tick');
});

test('drum doubling stays on its own source axis while Cao Cao speed and Sun Quan range keep their own values', () => {
  const {game,camps:[drum,archer],spawn} = fixture(['war_drum','archer'],['war_drum_morale','war_drum_resound','war_drum_first','sun_quan_command'],['cao_cao','sun_quan']);
  const gate = game._gateCenter(),position = {x:gate.x,y:gate.y - 100}; Object.assign(drum,position); Object.assign(archer,position); for (const hero of game.heroes) Object.assign(hero,position); spawn();
  game._buffs.push({kind:'speed',bonus:.25,remaining:9}); near(game._friendlySpeed(archer),.25,'Cao Cao wins over the ordinary 10% drum aura'); near(game._friendlySpeed(game.heroes[0]),.25,'Cao Cao also wins over the ordinary drum-plus-morale source');
  const sun = game.heroes.find(hero => hero.id === 'sun_quan'); game._beginCast(sun,game._target(sun)); game._skillDamage(.4);
  near(game._friendlySpeed(archer),.25,'doubled 20% drum speed cannot double Cao Cao 25%'); near(game._friendlySpeed(game.heroes[0]),.44,'the whole 22% drum hero aura doubles before strongest-source resolution');
  near(archer.range,205 * 1.2,'Sun Quan grants 20% range without drum doubling it');
  near(game._campDamage(archer,game.enemies[0],100),130,'the owned 15% drum damage aura doubles to 30%');
  const speed = game._buffs.find(buff => buff.kind === 'speed'); near(speed.bonus,.25,'Cao Cao buff data stays unchanged');
  game.time = 5.01; for (const camp of game.camps) game._updateCamp(camp);
  near(game._friendlySpeed(game.heroes[0]),.25,'the drum amplification ends without cancelling Cao Cao'); near(archer.range,205,'Sun Quan range expires on its own four-second clock');
});

test('overlapping shields share one enemy root cooldown across exit, re-entry, pause and card choices', () => {
  const {game,camps:[a,b],spawn,events} = fixture(['shield','shield'],['shield_eight_gates']);
  const enemy = spawn('infantry'),position = {x:enemy.x,y:enemy.y}; Object.assign(a,position); Object.assign(b,position);
  game.update(.02); assert.equal(events.filter(event => event.type === 'campRoot').length,1,'two shields cannot root twice together'); const next = enemy.nextCampRootAt;
  game.update(.2); Object.assign(a,{x:2000,y:2000}); Object.assign(b,{x:2000,y:2000}); game.update(.5); Object.assign(a,position); Object.assign(b,position); game.update(.1);
  assert.equal(events.filter(event => event.type === 'campRoot').length,1); near(enemy.nextCampRootAt,next,'leaving and re-entering cannot reset the shared immunity');
  game.pause(); const paused = game.time; game.update(120); near(game.time,paused,'pause cannot consume the six-second root cooldown'); game.resume();
  game.state = 'choosing'; game.update(120); near(game.time,paused,'card choice cannot consume the six-second root cooldown'); game.state = 'playing';
  game.update(next - game.time - .03); assert.equal(events.filter(event => event.type === 'campRoot').length,1);
  game.update(.05); const roots = events.filter(event => event.type === 'campRoot'); assert.equal(roots.length,2); near(enemy.nextCampRootAt,roots[1].time + 6,'the shared cooldown restarts from the actual second root'); assert.ok(enemy.nextCampRootAt >= next + 6 - 1e-8 && enemy.nextCampRootAt <= next + 6 + 1 / 60 + 1e-8,'a legal second root may wait up to one fixed simulation step');
});
