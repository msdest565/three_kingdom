import test from 'node:test';
import assert from 'node:assert/strict';
import { BALANCE as B } from '../runtime-data.js';
import { V1Game } from '../v1-engine.js';
import { drawTacticOffer } from '../roguelike-system.js';

const LEGACY_HERO_IDS = ['guan_yu_width','guan_yu_press','zhou_yu_radius','zhou_yu_duration'];
const heroIds = Object.keys(B.heroes);
const campTypes = Object.keys(B.camps);
const entries = () => Object.values(B.heroUpgrades).flatMap(group => group.upgrades);
const makeGame = (ids = ['guan_yu'], mode = 'endless') => new V1Game({mode,levelId:'wei_001',party:ids.map(heroId => ({heroId,level:1,skillLevel:1}))});
const offer = (tactics, options = {}) => drawTacticOffer({tactics,config:B.endless,rng:() => 0,...options});

test('the fifteen indexed hero sets supply sixty readable unique cards, with four preserved legacy IDs', () => {
  assert.deepEqual(Object.keys(B.heroUpgrades).sort(),heroIds.slice().sort());
  const cards = entries(); assert.equal(cards.length,60); assert.equal(new Set(cards.map(card => card.id)).size,60);
  for (const [heroId,group] of Object.entries(B.heroUpgrades)) {
    assert.ok(Number.isFinite(group.baseStrength) && group.baseStrength > 0,heroId);
    assert.equal(group.upgrades.length,4,heroId);
    assert.deepEqual(group.upgrades.map(card => card.tier).sort(),[1,2,3,4],`${heroId} has four distinct tiers`);
    assert.deepEqual(group.upgrades.map(card => card.rarity).sort(),['epic','legendary','rare','rare'],`${heroId} has two rare, one epic and one legendary`);
    for (const card of group.upgrades) {
      assert.equal(card.hero,heroId); assert.equal(card.category,'hero'); assert.equal(card.repeatable,false); assert.equal(card.decay,1);
      assert.ok(typeof card.name === 'string' && /\p{Script=Han}/u.test(card.name),card.id);
      assert.ok(typeof card.description === 'string' && /\p{Script=Han}/u.test(card.description),`${card.id} has player-readable copy`);
      assert.doesNotMatch(card.description,/TODO|未实现|待实现|undefined|\[object Object\]/i);
      assert.ok(card.effects && Object.keys(card.effects).length,`${card.id} has concrete effects`);
      if (LEGACY_HERO_IDS.includes(card.id)) {
        assert.equal(card.name,B.tactics[card.id].name,`${card.id} name remains unchanged`);
        assert.deepEqual(card.effects,B.tactics[card.id].effects,`${card.id} still uses its existing effects`);
      } else {
        assert.equal(card.endlessOnly,true,`${card.id} is isolated from story`);
        assert.equal(card.camp,null);
      }
    }
  }
  assert.deepEqual(cards.filter(card => Object.hasOwn(B.tactics,card.id)).map(card => card.id).sort(),LEGACY_HERO_IDS.slice().sort());
  const names = new Set(cards.map(card => card.name.replace(/\s/g,'')));
  for (const name of ['独眼·连跃','独眼·残躯血战','八阵·攻心','江东·统御','江东·仲谋之志','赤壁·火势滔天','白衣·示弱','白衣·连雷阵','锦帆·铃震三军']) assert.ok(names.has(name),`corrected name ${name}`);
  for (const name of names) assert.doesNotMatch(name,/心理战|增灶|白衣·更新|铃响铃响|生子当如|江东·领导|二段跳|拔矢无双|赤壁·火烧连营/);
});

test('the real endless definition registry merges 48 tactics with 56 new hero cards exactly once', () => {
  const game = makeGame(),story = makeGame(['guan_yu'],'campaign');
  assert.equal(Object.keys(B.tactics).length,48);
  assert.equal(Object.keys(game.tacticDefinitions).length,104);
  assert.equal(Object.values(game.tacticDefinitions).filter(card => card.category === 'hero').length,60);
  assert.equal(Object.values(game.tacticDefinitions).filter(card => card.category === 'attribute').length,26);
  assert.equal(Object.values(game.tacticDefinitions).filter(card => card.category === 'camp').length,18);
  for (const card of entries()) {
    const definition = game.tacticDefinition(card.id);
    assert.ok(definition,card.id); assert.equal(definition.name,card.name); assert.deepEqual(definition.effects,card.effects);
    if (!LEGACY_HERO_IDS.includes(card.id)) assert.equal(story.tacticDefinition(card.id),undefined,`${card.id} never enters the story registry`);
  }
});

test('all sixty hero cards can enter their owner solo pool, cannot enter absent-owner pools, and cannot repeat', () => {
  const tactics = makeGame().tacticDefinitions;
  for (const card of entries()) {
    const eligible = offer(tactics,{heroIds:[card.hero],campTypes,lockedId:card.id});
    assert.ok(eligible.choices.some(choice => choice.id === card.id),`${card.id} is offered to its owner`);
    const otherHero = heroIds.find(id => id !== card.hero);
    const absent = offer(tactics,{heroIds:[otherHero],campTypes,lockedId:card.id});
    assert.ok(absent.choices.every(choice => choice.id !== card.id && (!choice.hero || choice.hero === otherHero)),`${card.id} stays out when its owner is absent`);
    const alreadyOwned = offer(tactics,{heroIds:[card.hero],campTypes,lockedId:card.id,counts:{[card.id]:1},maxStacksPerTactic:999});
    assert.ok(alreadyOwned.choices.every(choice => choice.id !== card.id),`${card.id} never repeats even with a raised global stack cap`);
  }
});

test('a three-hero party can take twelve distinct exclusive cards before the hero guarantee safely exhausts', () => {
  const party = ['cao_cao','liu_bei','zhou_yu'],tactics = makeGame(party).tacticDefinitions;
  const cards = entries().filter(card => party.includes(card.hero)),counts = {};
  assert.equal(cards.length,12);
  for (const card of cards) {
    const result = offer(tactics,{heroIds:party,counts,lockedId:card.id,counters:{heroMisses:2}});
    assert.ok(result.choices.some(choice => choice.id === card.id),card.id);
    assert.ok(result.choices.every(choice => !choice.hero || party.includes(choice.hero)));
    counts[card.id] = 1;
  }
  const exhausted = offer(tactics,{heroIds:party,counts,counters:{heroMisses:100}});
  assert.equal(exhausted.pity.hero,false); assert.equal(exhausted.choices.length,3);
  assert.ok(exhausted.choices.every(card => card.category === 'attribute'));
});

test('the third consecutive hero-less offer forces a live exclusive and resets its pity counter', () => {
  const selectedHero = B.heroUpgrades.cao_cao.upgrades.find(card => card.rarity === 'rare');
  const attributes = Object.entries(B.tactics).filter(([,card]) => card.category === 'attribute').slice(0,4);
  const tactics = {...Object.fromEntries(attributes),[selectedHero.id]:selectedHero};
  let counters;
  for (let number = 1; number <= 3; number++) {
    const result = offer(tactics,{heroIds:['cao_cao'],counters});
    assert.equal(result.choices.some(card => card.id === selectedHero.id),number === 3,`offer ${number}`);
    assert.equal(result.pity.hero,number === 3); counters = result.counters;
  }
  assert.equal(counters.heroMisses,0);
  const absent = offer(tactics,{heroIds:['liu_bei'],counters:{heroMisses:2}});
  assert.equal(absent.pity.hero,false); assert.ok(absent.choices.every(card => card.category === 'attribute'));
});

test('hero appearance weight is exactly three times an equal-rarity attribute before pity', () => {
  const tactics = {exclusive:{category:'hero',hero:'cao_cao',rarity:'rare',repeatable:false},a:{category:'attribute',rarity:'rare',repeatable:true},b:{category:'attribute',rarity:'rare',repeatable:true},c:{category:'attribute',rarity:'rare',repeatable:true}};
  // One hero has weight 3, three equal-rarity attributes have weight 1 each: its exact boundary is 1/2.
  assert.equal(offer(tactics,{heroIds:['cao_cao'],rng:() => .499999}).choices[0].id,'exclusive');
  assert.equal(offer(tactics,{heroIds:['cao_cao'],rng:() => .5}).choices[0].id,'a');
});

test('Single Rider can be offered only when Guan Yu is the sole hero; conditional in-battle legends remain available', () => {
  const tactics = makeGame().tacticDefinitions,solo = entries().find(card => card.name.includes('单骑绝尘'));
  assert.ok(solo); assert.equal(solo.requiredPartySize,1);
  assert.ok(offer(tactics,{heroIds:['guan_yu'],lockedId:solo.id}).choices.some(card => card.id === solo.id));
  assert.ok(offer(tactics,{heroIds:['guan_yu','cao_cao'],lockedId:solo.id}).choices.every(card => card.id !== solo.id));
  for (const heroId of ['liu_bei','lv_meng']) {
    const card = B.heroUpgrades[heroId].upgrades.find(entry => entry.rarity === 'legendary');
    assert.ok(offer(tactics,{heroIds:[heroId,'cao_cao'],lockedId:card.id}).choices.some(choice => choice.id === card.id),`${card.id} can reach its condition during the run`);
  }
});

test('engine hero offers resolve their readable definition and incremental effect payload from the merged registry', () => {
  for (const heroId of heroIds) {
    const game = makeGame([heroId]),card = B.heroUpgrades[heroId].upgrades.find(entry => !LEGACY_HERO_IDS.includes(entry.id));
    game.lockedTacticId = card.id; game._offerTactics();
    const shown = game.upgrades.find(choice => choice.id === card.id);
    assert.ok(shown,card.id); assert.equal(shown.hero,heroId); assert.equal(shown.name,card.name);
    assert.ok(/\p{Script=Han}/u.test(shown.description),`${card.id} has a readable engine choice`);
    assert.equal(shown.stacks,0); assert.deepEqual(shown.nextEffects,card.effects);
  }
});
