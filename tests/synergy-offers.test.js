import test from 'node:test';
import assert from 'node:assert/strict';
import {BALANCE as B} from '../runtime-data.js';
import {V1Game} from '../v1-engine.js';
import {drawTacticOffer} from '../roguelike-system.js';
import {eligibleSynergyCards} from '../synergy-rules.js';

const rosters = {
  synergy_taoyuan:['liu_bei','guan_yu','zhang_fei'],
  synergy_weiwu_xiongfeng:['cao_cao','sima_yi','zhang_liao'],
  synergy_jiangdong_huchen:['zhou_yu','gan_ning'],
  synergy_wolong_zhonghu:['zhuge_liang','sima_yi'],
  synergy_three_hearts:['zhuge_liang','sima_yi','sun_quan'],
  synergy_combo_mastery:['guan_yu'],
  synergy_comrades:['guan_yu','zhuge_liang'],
  synergy_four_corners:['zhuge_liang','sima_yi','sun_quan'],
};
function game(ids) { return new V1Game({mode:'endless',party:ids.map(heroId => ({heroId})),rng:() => .99}); }

test('the actual catalog has exactly 136 unique readable cards, including all eight synergy entries', () => {
  const g = game(['guan_yu']); assert.equal(Object.keys(g.tacticCatalog).length,136); assert.equal(Object.keys(g.tacticDefinitions).length,104);
  for (const card of B.synergyUpgrades) { assert.equal(g.tacticDefinition(card.id).name,card.name); assert.ok(card.description.length > 10); assert.equal(card.category,'synergy'); assert.equal(card.repeatable,false); assert.equal(card.decay,1); }
  const story = new V1Game(); for (const card of B.synergyUpgrades) assert.equal(story.tacticDefinition(card.id),undefined);
});

test('every synergy card enters its actual eligible engine pool once, then cannot be drawn again even when locked', () => {
  for (const [id,ids] of Object.entries(rosters)) {
    const g = game(ids); g.lockedTacticId = id; g._offerTactics(); const offer = g.upgrades.find(card => card.id === id); assert.ok(offer,id);
    assert.equal(offer.description,B.synergyUpgrades.find(card => card.id === id).description); assert.equal(offer.stacks,0); assert.ok(offer.nextEffects);
    assert.equal(g.selectUpgrade(id).ok,true); g.lockedTacticId = id; g._offerTactics(); assert.ok(g.upgrades.every(card => card.id !== id),id + ' cannot repeat');
  }
});

test('ineligible bonds never enter engine offers, while mastery remains available to a solo party', () => {
  const g = game(['guan_yu']);
  for (const card of B.synergyUpgrades) {
    g.lockedTacticId = card.id; g._offerTactics(); assert.equal(g.upgrades.some(choice => choice.id === card.id),card.id === 'synergy_combo_mastery',card.id);
  }
  const incomplete = game(['sun_quan','lv_meng']); incomplete.lockedTacticId = 'synergy_jiangdong_huchen'; incomplete._offerTactics(); assert.ok(incomplete.upgrades.every(card => card.id !== 'synergy_jiangdong_huchen'));
  assert.ok(eligibleSynergyCards(B,['zhuge_liang','sima_yi','sun_quan']).includes('synergy_four_corners'));
});

test('an equally rare synergy has six times the attribute appearance weight before any guarantee', () => {
  const tactics = {attribute:{category:'attribute',rarity:'rare'},bond:{category:'synergy',rarity:'rare'}};
  const pick = value => drawTacticOffer({tactics,rng:() => value,config:{eligibleSynergyIds:['bond']}}).choices[0].id;
  assert.equal(pick(1 / 7 - 1e-8),'attribute'); assert.equal(pick(1 / 7 + 1e-8),'bond'); assert.equal(pick(.99),'bond');
});
