import test from 'node:test';
import assert from 'node:assert/strict';
import { V1Game } from '../v1-engine.js';

const near = (actual,expected,message) => assert.ok(Math.abs(actual - expected) < 1e-6,`${message}: ${actual} versus ${expected}`);
function fixture(ids,cardIds) {
  const game = new V1Game({mode:'endless',party:ids.map(heroId => ({heroId,level:1,skillLevel:1}))});
  for (const id of cardIds) { assert.ok(game.tacticDefinition(id),id); game.tactics.add(id); game.tacticCounts[id] = 1; }
  game.start(); game._between = 0; game._spawnQueue = [{at:1e9}]; game._spawnIndex = 0;
  for (const hero of game.heroes) hero.attackCooldown = 1e9;
  const spawn = (type = 'armor',progress = game.paths[0].length - 160,lane = 0,extra = {}) => Object.assign(game._spawn({type,progress,lane,wave:game._waveConfig(1)}),{hp:1e7,maxHp:1e7,speed:0},extra);
  const cast = id => {
    const hero = game.heroes.find(item => item.id === id); hero.rage = game.heroRageCost(hero); hero.rageRecovery = 0;
    assert.equal(game.castUltimate(id).ok,true,id); assert.ok(!hero.reserved,`${id} starts without remaining queued`);
    return game._casts.at(-1);
  };
  return {game,spawn,cast};
}
function probeDamage(game,enemy,amount = 100) {
  const before = enemy.hp; game._damage(enemy,amount,'interaction_probe'); return before - enemy.hp;
}

test('Gan Ning permanent stacks combine with Zhuge Liang vulnerability without duplicating Gan Ning temporary marks', () => {
  const {game,spawn,cast} = fixture(['zhuge_liang','gan_ning'],['zhuge_liang_memorial','gan_ning_rain','gan_ning_bells']);
  const enemy = spawn(); cast('zhuge_liang'); game.update(1.05); cast('gan_ning'); game.update(.3);
  assert.equal(enemy.permanentVulnerabilityStacks,1);
  near(probeDamage(game,enemy),150,'the full 1.5 Zhuge multiplier wins over one permanent Gan Ning layer');
  game.update(1.8); cast('gan_ning'); game.update(.3);
  assert.equal(enemy.permanentVulnerabilityStacks,2);
  near(probeDamage(game,enemy),100 * 1.35 ** 2,'two permanent layers exceed Zhuge while same-class vulnerability still takes the strongest');
  game.update(11);
  assert.equal(enemy.permanentVulnerabilityStacks,2);
  near(probeDamage(game,enemy),100 * 1.35 ** 2,'temporary marks expire while the two permanent layers remain');
});

test('Zhang Fei rear guard covers later arrivals after his expanded roar stops dealing damage', () => {
  const {game,spawn,cast} = fixture(['zhang_fei'],['zhang_fei_echo','zhang_fei_bridge','zhang_fei_rearguard']);
  const first = spawn(); const release = cast('zhang_fei');
  assert.ok(game._inShape(first,release.target,release.ultimate)); game.update(1.7);
  assert.ok(!game._casts.includes(release),'the extended one-hit roar window has ended');
  const late = spawn('armor',first.progress),outside = spawn('armor',0); game.update(1/60);
  near(probeDamage(game,late),110,'an enemy entering the original roar area still receives rear-guard vulnerability');
  near(probeDamage(game,outside),100,'the rear guard does not expose enemies outside its locked area');
  game.update(5);
  const after = spawn('armor',first.progress); game.update(1/60);
  near(probeDamage(game,after),100,'the rear-guard area eventually expires');
});

test('overlapping Cao Cao banners award one permanent rage increment for one kill', () => {
  const {game,spawn,cast} = fixture(['cao_cao'],['cao_cao_banner_heal','cao_cao_unify']);
  const anchor = spawn(); cast('cao_cao'); game.update(1.05); cast('cao_cao'); game.update(.5);
  const banners = game._heroZones.filter(zone => zone.type === 'banner'); assert.equal(banners.length,2);
  assert.ok(banners.every(zone => Math.hypot(anchor.x - zone.x,anchor.y - zone.y) <= zone.radius));
  const victim = spawn('cavalry',anchor.progress,0,{hp:1,maxHp:1}); game._damage(victim,100,'interaction_kill');
  near(game.heroes[0].upgradeState.permanentRageGain,.005,'one kill contributes +0.5%, even inside two active flags');
});

test('eight charged Lv Meng mines retain combat-time age through pause and card choice, then reach the 150% bonus', () => {
  const {game,spawn,cast} = fixture(['lv_meng'],['lv_meng_mine_array','lv_meng_three_days']);
  const release = cast('lv_meng'); assert.equal(release.mines.length,8); assert.equal(release.life,24);
  game.update(4.2);
  const snapshot = () => JSON.stringify({time:game.time,age:release.age,mines:release.mines,effects:game.effects.map(effect => [effect.type,effect.age,effect.life])});
  game.pause(); const paused = snapshot(); game.update(120); assert.equal(snapshot(),paused,'pause freezes mine charge and lifetime');
  game.resume(); game.state = 'choosing'; const choosing = snapshot(); game.update(120); assert.equal(snapshot(),choosing,'card choices freeze mine charge and lifetime');
  game.state = 'playing'; game.update(15.9);
  assert.ok(game._casts.includes(release)); assert.ok(release.age > 20 && release.age < 21);
  const mine = release.mines[0],lane = game.paths.findIndex(path => path.id === mine.laneId),progress = game._pathProjection(mine.laneId,mine).progress;
  const enemy = spawn('armor',progress,lane); game.update(1/60);
  assert.ok(mine.triggered);
  const base = game.heroes[0].definition.ultimate.damagePerMineByClass.elite;
  near(1e7 - enemy.hp,base * 2.5 * game.heroDamageMultiplier(game.heroes[0],true),'twenty combat seconds accumulate exactly +150% damage');
});

test('Gan Ning blindness prevents new enemy actions without extending an existing guardian shield', () => {
  const {game,spawn,cast} = fixture(['gan_ning'],['gan_ning_rain','gan_ning_raid']);
  const guardian = spawn('boss',game.paths[0].length - 160,0,{bossTemplateId:'guardian'});
  cast('gan_ning'); game.update(.55); assert.ok(guardian.blindRemaining > 0,'a repeated arrow-rain hit blinds the vulnerable guardian');
  guardian.bossAbilityRemaining = 2; guardian.damageTakenMultiplier = .75;
  game.update(1);
  near(guardian.bossAbilityRemaining,1,'an already-running shield keeps consuming combat time while its owner is blind');
  game.update(1.1);
  assert.ok(guardian.blindRemaining > 0,'the later arrow-rain hits keep the guardian blind');
  assert.equal(guardian.bossAbilityRemaining,0);
  assert.equal(guardian.damageTakenMultiplier,1,'blindness does not prolong the guardian damage reduction');
});

test('a maximum-density death-thunder cascade rewards each victim once and cannot tag a protected bystander', () => {
  const {game,spawn} = fixture(['sima_yi'],['sima_yi_chain_death']);
  const first = spawn('armor',400,0,{hp:10000}),position = {x:first.x + 50,y:first.y};
  const victims = Array.from({length:158},() => spawn('armor',400,0,{...position,hp:60}));
  const protectedEnemy = spawn('armor',400,0,{...position,hp:60,invulnerable:true});
  assert.equal(game.enemies.length,160,'the cascade uses the live-enemy capacity');
  game._beginCast(game.heroes[0],{shape:'circle_shock',x:first.x,y:first.y,radius:1,targetIds:[first.id]});
  game._skillDamage(1.01); assert.ok(first.deathThunder); assert.ok(victims.every(enemy => !enemy.deathThunder));
  const food = game.food,rewards = first.reward + victims.reduce((sum,enemy) => sum + enemy.reward,0);
  game._damage(first,1e8,'interaction_chain_trigger');
  assert.equal(game.kills,159); assert.equal(game.food - food,rewards);
  assert.ok(victims.every(enemy => enemy.hp === 0 && enemy.deathThunderTriggered));
  assert.equal(protectedEnemy.hp,60); assert.equal(protectedEnemy.deathThunder,undefined,'a failed hit cannot propagate the death-thunder tag');
  const explosionCount = game.effects.filter(effect => effect.type === 'explosion').length;
  protectedEnemy.invulnerable = false; game._damage(protectedEnemy,100,'interaction_cleanup');
  assert.equal(game.effects.filter(effect => effect.type === 'explosion').length,explosionCount,'the previously protected bystander has no unearned death explosion');
  assert.equal(game.kills,160);
  for (const enemy of game.enemies) game._damage(enemy,1e8,'interaction_duplicate');
  assert.equal(game.kills,160); assert.equal(game.food - food,rewards + protectedEnemy.reward,'dead enemies cannot award a second reward');
});
