// Public UI offline smoke test. Debug is used only to read actual game/renderer state.
import assert from 'node:assert/strict';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {launch,sleep} from './cdp.mjs';
import {writeAtomic} from '../write-atomic.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..'),out=path.join(root,'docs/v1/playtest/skill-art');
const report={offline:true,checks:[],errors:[]},page=await launch();
try{
  await page.viewport(390,844);
  await page.goto(pathToFileURL(path.join(root,'dist/favicon.svg')).href);await page.eval('localStorage.clear();true');
  await page.send('Network.enable');await page.send('Network.emulateNetworkConditions',{offline:true,latency:0,downloadThroughput:0,uploadThroughput:0});
  await page.goto(pathToFileURL(path.join(root,'dist/index.html')).href+'?debug');
  await page.waitFor(`!document.querySelector('#campaign-start').disabled`);await page.tap('#campaign-start');
  await page.waitFor(`!document.querySelector('#story-overlay').hidden`);await page.tap('#story-skip');
  if(await page.eval(`!document.querySelector('#tutorial-card').hidden`))await page.tap('#tutorial-skip');
  await page.waitFor('window.__wushuang.game.time>1');
  assert.equal(await page.eval(`document.querySelector('#fatal-message').hidden`),true);
  report.checks.push('standalone file renders a running battle with networking disabled');
  const target=await page.box('.battle-hero-name-key');assert.ok(target.w>=44&&target.h>=44);
  await page.eval(`document.querySelector('.battle-hero-name-key').focus();true`);
  assert.match(await page.eval(`document.activeElement.getAttribute('aria-label')`),/查看.*姓名/);
  report.checks.push('keyboard hero-name button is at least 44 CSS px and retains its accessible name');
  await page.eval('document.activeElement.blur();true');
  const point=await page.eval(`(()=>{const h=window.__wushuang.game.heroes[0],r=document.querySelector('#battle-canvas').getBoundingClientRect();return{x:r.x+h.x*r.width/420,y:r.y+h.y*r.height/600};})()`);
  await page.tap(point);assert.equal(await page.eval(`document.querySelector('#battle-announcer').textContent`),'关羽');
  report.checks.push('canvas hero tap announces its name');
  await page.send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});await sleep(150);
  assert.equal(await page.eval(`window.__wushuang.renderer.reducedMotion && document.body.classList.contains('reduce-motion')`),true);
  report.checks.push('system motion preference reaches the battlefield and body class');
  await page.screenshot(path.join(out,'offline-battle.png'));
  assert.deepEqual(await page.eval(`performance.getEntriesByType('resource').filter(r=>/^https?:/.test(r.name)).map(r=>r.name)`),[]);
  assert.deepEqual(page.errors,[]);console.log(JSON.stringify(report,null,2));
}catch(error){report.fatal=String(error.stack||error);console.error(report.fatal);process.exitCode=1;}
finally{report.errors=page.errors;await writeAtomic(path.join(out,'offline-report.json'),JSON.stringify(report,null,2));await page.close();}
