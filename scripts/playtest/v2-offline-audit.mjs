// Offline UI and reward-tile check: a real saved account and public UI actions only.
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { launch, sleep } from './cdp.mjs';
import { buildReturningSave } from './returning-save.mjs';
import { writeAtomic } from '../write-atomic.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const out = path.join(root, 'docs/v1/playtest/v2-offline');
const report = { build: 'dist/index.html', offline: true, checks: [], layout: [], errors: [] };
const page = await launch();
const shot = name => page.screenshot(path.join(out, `${name}.png`));
const check = name => { report.checks.push(name); console.log('PASS', name); };
const size = selector => page.eval(`(() => { const n=document.querySelector(${JSON.stringify(selector)}), r=n.getBoundingClientRect(); return {width:r.width,height:r.height,left:r.left,top:r.top,right:r.right,bottom:r.bottom}; })()`);
try {
  const saved = await buildReturningSave(8);
  await page.viewport(360,740);
  await page.goto(pathToFileURL(path.join(root,'dist/favicon.svg')).href);
  await page.eval(`localStorage.clear(); localStorage.setItem('wushuang-guard-campaign-v2',${JSON.stringify(saved)}); true`);
  await page.send('Network.enable');
  await page.send('Network.emulateNetworkConditions',{offline:true,latency:0,downloadThroughput:0,uploadThroughput:0});
  await page.goto(pathToFileURL(path.join(root,'dist/index.html')).href+'?debug');
  await page.waitFor(`document.querySelector('#focus-nodes .focus-node') && !document.getElementById('campaign-start').disabled`);
  await sleep(500); await shot('campaign-360x740');
  assert.equal(await page.eval(`document.getElementById('lobby-scroll').scrollHeight <= document.getElementById('lobby-scroll').clientHeight`),true);
  assert.deepEqual(await page.eval(`performance.getEntriesByType('resource').filter(r=>/^https?:/.test(r.name)).map(r=>r.name)`),[]);
  check('standalone file opens with networking disabled and no HTTP assets');
  await page.tap('#heroes-tab'); await page.tap('#hero-roster .hero-card'); await sleep(300); await shot('hero-360x740');
  assert.equal(await page.eval(`document.getElementById('modal-body').scrollHeight <= document.getElementById('modal-body').clientHeight`),true);
  check('offline hero page has no vertical scroll');
  await page.send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]}); await sleep(120);
  assert.equal(await page.eval(`getComputedStyle(document.querySelector('.hero-detail-figure'),'::after').animationName`),'none');
  assert.equal(await page.eval(`getComputedStyle(document.querySelector('.preview-effect')).animationName`),'none');
  check('system reduced motion disables portrait rotation and skill movement');
  await page.send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'no-preference'}]});
  await page.tap('#modal-close'); await page.tap('#settings-tab'); await page.tap('#setting-motion');
  await page.tap('#heroes-tab'); await page.tap('#hero-roster .hero-card'); await sleep(120);
  assert.equal(await page.eval(`document.body.classList.contains('reduce-motion') && getComputedStyle(document.querySelector('.hero-detail-figure'),'::after').animationName === 'none'`),true);
  check('in-game reduced motion disables the same movements');
  await page.tap('#modal-close'); await page.tap('#settings-tab'); await page.tap('#setting-motion');
  await page.tap('#workshop-tab'); await page.tap('#ws-tab-forge'); await sleep(300); await shot('forge-360x740');
  const forge = await size('#forge-list .gear-tile'); assert.equal(forge.width,96); assert.equal(forge.height,96);
  check('offline forge uses the 96px shared equipment tile');
  await page.tap('#campaign-tab'); await page.tap('#route-button'); await sleep(450);
  await page.tap('#level-grid [data-level-id="wei_001"]');
  await page.waitFor(`document.getElementById('route-sheet').hidden`);
  await page.tap('#campaign-start'); await sleep(500);
  if(await page.eval(`!document.getElementById('story-overlay').hidden`)) await page.tap('#story-start');
  await page.tap('#speed-button'); await page.tap('#speed-button');
  await page.eval(`window.__offlineBot=setInterval(()=>{
    const q=s=>document.querySelector(s);
    if(!q('#result-overlay').hidden)return;
    if(!q('#choice-overlay').hidden){q('.upgrade-choice')?.click();return;}
    if(!q('#camp-panel').hidden){const b=[...document.querySelectorAll('#camp-options button')].filter(b=>!b.disabled);(b.find(b=>/弓营/.test(b.textContent))||b[0])?.click();if(!b.length)q('#close-camp').click();return;}
    for(const b of document.querySelectorAll('#lead-command .hero-command,#hero-commands .hero-command'))if(!b.disabled){b.click();return;}
    if(+q('#food-value').textContent>=60&&!q('#formation-button').disabled)q('#formation-button').click();
  },250);true`);
  const end = Date.now()+240000; let done=false;
  while(Date.now()<end){
    await sleep(1000);
    done=await page.eval(`!document.getElementById('result-overlay').hidden`);
    if(done)break;
  }
  await page.eval('clearInterval(window.__offlineBot);true');
  assert.equal(done,true,'a public-UI battle reaches its result');
  assert.equal(await page.eval('window.__wushuang.game.state'),'won');
  await sleep(3000); await page.tap('#result-open-box'); await sleep(800);
  check('offline public-UI battle wins and opens its saved reward');
  for(const [w,h] of [[360,740],[390,844]]){
    await page.viewport(w,h); await sleep(350); await shot(`victory-loot-${w}x${h}`);
    const tile=await size('#result-loot-item .gear-tile');
    const overflow=await page.eval('document.documentElement.scrollWidth>innerWidth');
    assert.equal(tile.width,96);assert.equal(tile.height,96);assert.equal(overflow,false);
    assert.ok(tile.top>=0&&tile.bottom<=h,'reward art stays visible');
    report.layout.push({screen:`victory-loot-${w}x${h}`,tile,horizontalOverflow:overflow});
  }
  assert.deepEqual(page.errors,[]);check('reward art is visible at both target sizes without horizontal overflow');
} catch(error){report.fatal=String(error.stack||error);console.error(report.fatal);process.exitCode=1;await shot('failure').catch(()=>{});}
finally{report.errors=page.errors;await writeAtomic(path.join(out,'report.json'),JSON.stringify(report,null,2));await page.close();}
