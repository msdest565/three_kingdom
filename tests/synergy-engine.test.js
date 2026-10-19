import test from 'node:test';
import assert from 'node:assert/strict';
import {V1Game} from '../v1-engine.js';
import {BALANCE as B} from '../runtime-data.js';
import {detectSynergies,eligibleSynergyCards} from '../synergy-rules.js';
import {effectiveSynergyTarget} from '../synergy-effects.js';

const near = (actual,expected,message) => assert.ok(Math.abs(actual - expected) < 1e-6,`${message}: ${actual} versus ${expected}`);
function fixture(ids,cards = []) {
  const events = [],game = new V1Game({mode:'endless',party:ids.map(heroId => ({heroId})),unlockedCamps:Object.keys(B.camps),onEvent:event => events.push(event)});
  for (const id of cards) { assert.ok(game.tacticDefinition(id),id); game.tactics.add(id); game.tacticCounts[id] = 1; }
  game.start(); game._between = 0; game._spawnQueue = [{at:1e9}]; game._spawnIndex = 0;
  for (const hero of game.heroes) hero.attackCooldown = 1e9;
  const spawn = (type = 'armor',extra = {}) => Object.assign(game._spawn({type,progress:game.paths[0].length - 160,lane:0,wave:game._waveConfig(1)}),{hp:1e7,maxHp:1e7,speed:0},extra);
  const cast = id => { const hero = game.heroes.find(value => value.id === id); game._beginCast(hero,game._target(hero)); return game._casts.at(-1); };
  const damage = id => game.stats.sourceStats['ultimate_' + id]?.damage || 0;
  return {game,spawn,cast,events,damage};
}
const combos = events => events.filter(event => event.type === 'heroCombo');

test('the four corrected synergies use their explicit roster conditions and remain outside campaign', () => {
  for (const [id,heroes] of Object.entries({taoyuan:['liu_bei','guan_yu','zhang_fei'],weiwu_xiongfeng:['sima_yi','cao_cao','zhang_liao'],jiangdong_huchen:['taishi_ci','lv_meng'],wolong_zhonghu:['zhuge_liang','sima_yi']})) {
    const expected = detectSynergies(B,heroes); assert.ok(expected.some(synergy => synergy.id === id));
    const endless = new V1Game({mode:'endless',party:heroes.map(heroId => ({heroId}))}); assert.deepEqual(endless.activeSynergies,expected);
    const campaign = new V1Game({party:heroes.map(heroId => ({heroId}))}); assert.deepEqual(campaign.activeSynergies,[]); assert.equal(campaign.heroComboStatus().limit,0);
  }
  assert.deepEqual(detectSynergies(B,['sun_quan','gan_ning']).map(value => value.id),['jiangdong_huchen']);
  assert.equal(Object.keys(fixture(['guan_yu']).game.tacticDefinitions).length,104); assert.equal(Object.keys(fixture(['guan_yu']).game.tacticCatalog).length,136);
});

test('Taoyuan shortens the complete personal rage cycle and its card grants other heroes capped rage on release', () => {
  const {game,cast} = fixture(['liu_bei','guan_yu','zhang_fei'],['synergy_taoyuan']);
  for (const hero of game.heroes) near(game._heroRageCycle(hero),.85,'every Taoyuan hero uses the same complete-cycle reduction');
  game.heroes[1].rage = 98; game.heroes[2].rage = 20; cast('liu_bei'); near(game.heroes[1].rage,100,'ally rage clamps at its dynamic maximum'); near(game.heroes[2].rage,35,'the other ally receives fifteen');
});

test('Wei target damage, Wu fire-arrow range and Wolong slow damage apply to their documented dimensions', () => {
  const wei = fixture(['cao_cao','xu_chu','sima_yi']),ordinary = wei.spawn('cavalry'),elite = wei.spawn('armor');
  let before = ordinary.hp; wei.game._damage(ordinary,100,'probe'); near(before - ordinary.hp,100,'ordinary damage has no Wei bonus'); before = elite.hp; wei.game._damage(elite,100,'probe'); near(before - elite.hp,115,'elite damage receives the whole-army target bonus');
  const wu = fixture(['zhou_yu','gan_ning','taishi_ci']);
  for (const hero of wu.game.heroes) { const u = wu.game.heroUltimate(hero); for (const field of ['width','length','range']) if (hero.definition.ultimate[field]) near(u[field],hero.definition.ultimate[field] * 1.12,hero.id + ' ' + field); }
  const wolong = fixture(['zhuge_liang','sima_yi']),enemy = wolong.spawn(); wolong.game._slow(enemy,.7,1,'probe'); before = enemy.hp; wolong.game._damage(enemy,100,'probe'); near(before - enemy.hp,120,'a real slow is an independent incoming multiplier');
});

test('same-faction rage affects only matching heroes while three hearts and four corners use separate damage buckets', () => {
  const comrades = fixture(['guan_yu','zhuge_liang','sun_quan'],['synergy_comrades']); comrades.game.heroes.forEach(hero => hero.rage = 0); comrades.game.update(.5);
  const solo = fixture(['guan_yu','zhuge_liang','sun_quan']); solo.game.heroes.forEach(hero => hero.rage = 0); solo.game.update(.5);
  near(comrades.game.heroes[0].rage,solo.game.heroes[0].rage * 1.1,'matching lead gains ten percent'); near(comrades.game.heroes[1].rage,solo.game.heroes[1].rage * 1.1,'matching support gains ten percent'); near(comrades.game.heroes[2].rage,solo.game.heroes[2].rage,'unmatched support is unchanged');
  const diverse = fixture(['zhuge_liang','sima_yi','sun_quan'],['synergy_three_hearts','synergy_four_corners']); diverse.game.attributeEffects.heroBasicDamageBonus = .8;
  near(diverse.game.heroDamageMultiplier(diverse.game.heroes[0]),(1 + .8 + .12) * 1.45,'rare adds to the shared pool and legendary remains independent'); assert.ok(diverse.game.activeSynergies.some(value => value.id === 'wolong_zhonghu'));
});

test('East Wind expands only fire-strip length for two combat seconds and counts one real combo', () => {
  const {game,spawn,cast,events} = fixture(['zhuge_liang','zhou_yu']); spawn(); cast('zhuge_liang'); game.update(1.05); const fire = cast('zhou_yu'),width = fire.target.width,length = fire.target.length; game.update(.3);
  assert.equal(combos(events).at(-1)?.comboId,'combo_east_wind'); near(effectiveSynergyTarget(game,fire).length,length * 1.5,'length expands'); near(effectiveSynergyTarget(game,fire).width,width,'width remains fixed');
  game.update(2.05); near(effectiveSynergyTarget(game,fire).length,length,'the temporary extension expires'); assert.equal(combos(events).length,1); assert.equal(game.heroComboStatus().remaining,2);
});

test('Righteous Sky compensates settled rally damage and boosts the triggering Guan Yu hit', () => {
  const {game,spawn,cast,events,damage} = fixture(['liu_bei','guan_yu']); const enemy = spawn(); cast('liu_bei'); game.update(1.05); const before = damage('liu_bei'); assert.ok(before > 0); cast('guan_yu'); game.update(.7);
  assert.equal(combos(events).at(-1)?.comboId,'combo_righteous_sky'); near(damage('liu_bei'),before * 1.4,'settled source damage is topped up once'); near(damage('guan_yu'),B.heroes.guan_yu.ultimate.damageByClass.elite * 1.4,'the triggering hit is already empowered'); assert.ok(enemy.hp > 0);
});

test('a combo requires a real source hit but can respond to a different enemy in the original source area', () => {
  const missed = fixture(['liu_bei','guan_yu']); missed.cast('liu_bei'); missed.game.update(1.05); missed.spawn(); missed.cast('guan_yu'); missed.game.update(.7); assert.equal(combos(missed.events).length,0,'an empty source cast creates no eligible history');
  const hit = fixture(['liu_bei','guan_yu']),first = hit.spawn(); hit.cast('liu_bei'); hit.game.update(1.05); hit.game._damage(first,first.hp * 2,'remove_first'); const later = hit.spawn(); assert.notEqual(first.id,later.id); hit.cast('guan_yu'); hit.game.update(.7);
  assert.equal(combos(hit.events).length,1,'a later victim may trigger in the frozen original area even after the first victim dies');
});

test('Changban Guard adds the real push difference and supplies five passes without duplicating a five-pass card', () => {
  const {game,spawn,cast,events} = fixture(['zhang_fei','zhao_yun'],['zhao_yun_five_passes']); const enemy = spawn(),progress = enemy.progress,roar = cast('zhang_fei'),pushed = progress - enemy.progress; assert.ok(pushed > 0); game.update(1.05); const passes = cast('zhao_yun'); game.update(1.1);
  assert.equal(combos(events).at(-1)?.comboId,'combo_changban_guard'); assert.equal(passes.ultimate.passAtSec.length,5); assert.equal(passes.hits.get(enemy.id),5); near(progress - enemy.progress,pushed * 1.8,'the source push is increased by its actual eighty-percent difference'); assert.equal(roar.synergyPushMultiplier,1.8);
});

test('Thunder Rain replaces the three source circles with crosses of exactly forty percent larger union area', () => {
  const {game,spawn,cast,events} = fixture(['sima_yi','gan_ning']); spawn(); const thunder = cast('sima_yi'); game.update(1.05); cast('gan_ning'); game.update(.3);
  assert.equal(combos(events).at(-1)?.comboId,'combo_thunder_rain'); assert.equal(thunder.target.shape,'delayed_multi_cross'); assert.equal(thunder.target.crosses.length,3);
  for (const cross of thunder.target.crosses) near(2 * cross.length * cross.width - cross.width ** 2,Math.PI * cross.radius ** 2 * 1.4,'the two centered rectangles use union area');
});

test('Thunder Rain really hits the newly covered cross arm without hitting an old source victim twice', () => {
  const {game,spawn,events} = fixture(['sima_yi','gan_ning']);
  const center = {x:180,y:300},anchor = spawn('armor',{...center}),outer = spawn('armor',{x:center.x + 115,y:center.y});
  const sima = game.heroes[0],gan = game.heroes[1];
  game._beginCast(sima,{shape:'delayed_multi_circle',...center,radius:90,circles:[{...center,radius:90},{x:600,y:300,radius:90},{x:1000,y:300,radius:90}],targetIds:[anchor.id]});
  const source = game._casts.at(-1); game.time = 1; game._skillDamage(1); assert.equal(source.hits.get(anchor.id),1); assert.equal(source.hits.get(outer.id),undefined);
  game._beginCast(gan,{shape:'circle_shock',...center,radius:200,targetIds:[anchor.id,outer.id]}); game.time = 1.3; game._skillDamage(.3);
  assert.equal(combos(events).at(-1)?.comboId,'combo_thunder_rain'); assert.equal(source.hits.get(anchor.id),1,'the original victim keeps the one-hit source cap'); assert.equal(source.hits.get(outer.id),1,'the wider cross arm deals actual source thunder damage');
  assert.ok(events.some(event => event.type === 'damage' && event.heroId === 'sima_yi' && event.enemyId === outer.id));
});

test('Tiger Command increases camps inside the responding banner by fifty percent for two seconds', () => {
  const {game,spawn,cast,events} = fixture(['xu_chu','cao_cao']); const enemy = spawn(),camp = game._addCamp(0,'archer',1); Object.assign(camp,{x:enemy.x,y:enemy.y,cooldown:1e9}); cast('xu_chu'); game.update(1.05); cast('cao_cao'); game.update(.45);
  assert.equal(combos(events).at(-1)?.comboId,'combo_tiger_command'); near(camp.range,205 * 1.5,'banner range applies locally'); game.update(2.05); near(camp.range,205,'the range boost expires');
});

test('Divine Cavalry amplifies its very first real Zhang Liao hit by sixty percent', () => {
  const {game,spawn,cast,events,damage} = fixture(['taishi_ci','zhang_liao']); spawn('boss'); cast('taishi_ci'); game.update(1.05); cast('zhang_liao'); game.update(.85);
  assert.equal(combos(events).at(-1)?.comboId,'combo_divine_cavalry'); near(damage('zhang_liao'),B.heroes.zhang_liao.ultimate.damageByClass.boss * 1.6,'the triggering strike receives the full bonus');
});

test('Chibi Fire doubles the settled wave and attributes exactly sixteen responding fire-profile ticks to Sun Quan', () => {
  const {game,spawn,cast,events,damage} = fixture(['sun_quan','zhou_yu']); spawn(); cast('sun_quan'); game.update(1.05); const wave = damage('sun_quan'); const fire = cast('zhou_yu'); game.update(.26);
  assert.equal(combos(events).at(-1)?.comboId,'combo_chibi_fire'); near(damage('sun_quan'),wave * 2,'settled wave damage is doubled before the first burn tick');
  const tick = fire.ultimate.tickDamageByClass.elite * (fire.ultimate.damageMultiplier || 1) * game.heroDamageMultiplier(fire.hero,true,true); game.update(4.1); near(damage('sun_quan'),wave * 2 + tick * 16,'the four-second burn has sixteen source-attributed ticks');
});

test('One-Eyed Tiger applies fifty percent only to the intersection and tops up the earlier landing once', () => {
  const {game,spawn,cast,events,damage} = fixture(['xiahou_dun','xu_chu']); spawn(); cast('xiahou_dun'); game.update(1.05); const landing = damage('xiahou_dun'); cast('xu_chu');
  assert.equal(combos(events).at(-1)?.comboId,'combo_one_eye_tiger'); near(damage('xiahou_dun'),landing * 1.5,'the previous landing is topped up'); near(damage('xu_chu'),B.heroes.xu_chu.ultimate.damageByClass.elite * 1.5,'the cone trigger is amplified immediately');
});

test('the default three-combo limit is run-wide and mastery extends it to five with a four-second window', () => {
  const {game,spawn,cast,events} = fixture(['liu_bei','guan_yu']); spawn();
  for (let i = 0; i < 5; i++) { cast('liu_bei'); game.update(1.05); cast('guan_yu'); game.update(1.05); }
  assert.equal(combos(events).length,3); assert.deepEqual(game.heroComboStatus(),{count:3,limit:3,windowSec:2,remaining:0});
  const mastered = fixture(['liu_bei','guan_yu'],['synergy_combo_mastery']); mastered.spawn();
  for (let i = 0; i < 6; i++) { mastered.cast('liu_bei'); mastered.game.update(3); mastered.cast('guan_yu'); mastered.game.update(1.05); }
  assert.equal(combos(mastered.events).length,5); assert.deepEqual(mastered.game.heroComboStatus(),{count:5,limit:5,windowSec:4,remaining:0});
});

test('synergy cards remain eligible only under their explicit roster conditions', () => {
  const eligible = ids => new Set(eligibleSynergyCards(B,ids));
  assert.ok(eligible(['guan_yu']).has('synergy_combo_mastery')); assert.equal(eligible(['guan_yu']).size,1);
  assert.ok(!eligible(['sun_quan','lv_meng']).has('synergy_jiangdong_huchen')); assert.ok(eligible(['zhou_yu','gan_ning']).has('synergy_jiangdong_huchen'));
  assert.ok(eligible(['zhuge_liang','sima_yi','sun_quan']).has('synergy_four_corners')); assert.ok(eligible(['zhuge_liang','sima_yi','sun_quan']).has('synergy_wolong_zhonghu'));
});
