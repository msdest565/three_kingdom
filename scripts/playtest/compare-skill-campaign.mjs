import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {writeAtomic} from '../write-atomic.mjs';
const directory=new URL('../../docs/v1/playtest/skill-art/',import.meta.url);
const read=name=>readFile(new URL(name,directory),'utf8').then(JSON.parse);
const before=await read('campaign-before.json'),after=await read('campaign-after.json');
assert.equal(before.results.length,60);assert.equal(after.results.length,60);
const rows=before.results.map(old=>{
  const next=after.results.find(r=>r.levelId===old.levelId);assert.ok(next,old.levelId);
  return{levelId:old.levelId,beforeState:old.state,afterState:next.state,beforeHp:old.hp,afterHp:next.hp,beforeMaxHp:old.maxHp,afterMaxHp:next.maxHp,hpDelta:next.hp-old.hp,beforeTime:old.time,afterTime:next.time,timeDelta:Number((next.time-old.time).toFixed(2)),beforeCasts:old.casts,afterCasts:next.casts};
});
const report={scope:'Same new-account progression policy, seeds and earned resources; core party is Guan Yu / Xiahou Dun / Cao Cao. This audit does not substitute for eight-skill geometry tests.',beforeWins:rows.filter(r=>r.beforeState==='won').length,afterWins:rows.filter(r=>r.afterState==='won').length,regressions:rows.filter(r=>r.beforeState==='won'&&r.afterState!=='won'),newWins:rows.filter(r=>r.beforeState!=='won'&&r.afterState==='won'),hpImproved:rows.filter(r=>r.hpDelta>0).length,hpReduced:rows.filter(r=>r.hpDelta<0).length,largeChanges:rows.filter(r=>Math.abs(r.hpDelta)>=r.beforeMaxHp*.25||Math.abs(r.timeDelta)>=r.beforeTime*.2),rows};
await writeAtomic(fileURLToPath(new URL('campaign-comparison.json',directory)),JSON.stringify(report,null,2)+'\n');
const keys=Object.keys(rows[0]);await writeAtomic(fileURLToPath(new URL('campaign-comparison.csv',directory)),'\ufeff'+keys.join(',')+'\n'+rows.map(r=>keys.map(k=>r[k]).join(',')).join('\n')+'\n');
console.log(JSON.stringify({...report,rows:undefined},null,2));
