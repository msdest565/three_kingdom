import { writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { BALANCE, CONTENT } from '../runtime-data.js';
import { CampaignStore } from '../campaign-state.js';
import { seededRandom } from '../v1-engine.js';
import { simulateLevel } from './simulate-campaign.mjs';

/** Simulate an actual new offline account. No supplied materials, skipped unlocks or daily farming. */
export function verifyCampaignProgression() {
  const memory = new Map();
  const storage = { getItem:key => memory.get(key) ?? null, setItem:(key,value) => memory.set(key,value), removeItem:key => memory.delete(key) };
  const store = new CampaignStore({storage,rng:seededRandom(2026101199),now:() => new Date('2026-10-11T12:00:00')});
  const results = [];
  const technologyCosts = {copper_coin:0,refined_iron:0};
  const lootCounts = Object.fromEntries(BALANCE.metaProgression.equipment.qualityIds.map(id=>[id,0]));
  const requireOkay = (result,context) => { if (!result?.ok) throw new Error(`${context}: ${result?.reason}`); };
  for (const level of CONTENT.levels) {
    if (!store.isLevelUnlocked(level.id)) throw new Error('Progression blocked at ' + level.id);
    const tier = BALANCE.stageGrowthTiers.find(t => t.id === level.growthTierId);
    const core = ['guan_yu','xiahou_dun','cao_cao'].filter(id => store.getHero(id));
    for (const id of core) {
      while (store.getHero(id).level < tier.recommendedHeroLevelRange[0]) requireOkay(store.trainHero(id),`${level.id} ${id} hero level`);
      while (store.getHero(id).skillLevel < tier.recommendedSkillLevelRange[0]) requireOkay(store.trainSkill(id),`${level.id} ${id} skill level`);
      while (store.getHero(id).equipment.weapon.level < tier.recommendedMainWeaponLevelRange[0]) requireOkay(store.upgradeEquipment(id,'weapon'),`${level.id} ${id} weapon level`);
      while (store.getHero(id).equipment.weapon.quality !== tier.recommendedMainWeaponQuality) requireOkay(store.promoteEquipment(id,'weapon'),`${level.id} ${id} weapon quality`);
    }
    requireOkay(store.setParty(core.slice(0,level.maxPartySize)),level.id + ' party');
    for (const campId of store.state.unlockedCamps) {
      while (true) {
        const quote=store.getTechnologyCost(campId);
        if (!quote.ok || Object.entries(quote.cost).some(([key,value]) => store.state.resources[key]<value)) break;
        requireOkay(store.researchTechnology(campId),`${level.id} technology ${campId}`);
        technologyCosts.copper_coin+=quote.cost.copper_coin;technologyCosts.refined_iron+=quote.cost.refined_iron;
      }
    }
    const party = store.getPartyForLevel(level.id);
    const battleId=store.createBattleId();
    const result = simulateLevel(level,{party,campTech:store.getBattleTechnology(),mode:6});
    if (result.state !== 'won') throw new Error(`${level.id}: ${result.state} at wave ${result.wave}, ${result.time}s`);
    const settlement = store.settleBattle({battleId,levelId:level.id,won:true,hp:result.hp,maxHp:result.maxHp,kills:result.kills,bestBurst:result.bestBurst,time:result.time,casts:result.casts});
    requireOkay(settlement,level.id + ' settlement');
    if (!settlement.loot?.item) throw new Error(`${level.id}: missing victory chest`);
    lootCounts[settlement.loot.quality]++;
    results.push({...result,resourcesAfter:{...store.state.resources},unlockedHeroes:settlement.unlockedHeroes,unlockedCamps:settlement.unlockedCamps,rewards:settlement.rewards,stars:settlement.stars,loot:settlement.loot});
  }
  const noUltimate=['wei_001','wei_020','shu_020','wu_020'].map(id=>simulateLevel(CONTENT.levels.find(l=>l.id===id),{skills:false,campTech:results.find(r=>r.levelId===id).campTech}));
  if (noUltimate.some(r=>r.state!=='lost')) throw new Error('Technology removes the hero skill requirement in contrast stages');
  return {buildVersion:'1.1.0-alpha.1',contentVersion:CONTENT.contentVersion,scope:'actual_new_account_no_repeat_rewards_no_material_injection_no_random_equipment_required',policy:'public_control_priority_mode6_all_levels_research_earned_resources_at_legal_gates',lootSeed:2026101199,core:['guan_yu','xiahou_dun','cao_cao'],passed:results.length,ownedHeroes:Object.keys(store.state.heroes).length,technologyCosts,finalTechnology:store.getBattleTechnology(),chests:results.length,lootCounts,inventoryCount:store.state.inventory.length,finalResources:store.state.resources,results,noUltimate};
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const report = verifyCampaignProgression();
  await writeFile(new URL('../docs/v1/data/playable-audit.json',import.meta.url),JSON.stringify(report,null,2) + '\n','utf8');
  console.log(JSON.stringify({passed:report.passed,ownedHeroes:report.ownedHeroes,finalResources:report.finalResources,minimumTime:Math.min(...report.results.map(r => r.time)),maximumTime:Math.max(...report.results.map(r => r.time)),bossKills:report.results.reduce((sum,r) => sum+r.bossKills,0)},null,2));
}
