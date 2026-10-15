import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {launch,sleep} from './cdp.mjs';
import {writeAtomic} from '../write-atomic.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..'),out=path.join(root,'docs/v1/playtest/skill-art');
const port=4720+Math.floor(Math.random()*100),server=spawn(process.execPath,['scripts/serve.mjs'],{cwd:root,env:{...process.env,PORT:String(port)},stdio:'ignore'});
const report={scope:'Deterministic art review fixtures: actual engine and renderer, controlled enemy placement; campaign gameplay audited separately.',screens:[],errors:[]};let page;
async function crop(name,clip){
  const {data}=await page.send('Page.captureScreenshot',{format:'png',clip:{...clip,scale:1}});
  await writeAtomic(path.join(out,name),Buffer.from(data,'base64'));
}
try{
  await sleep(500);page=await launch();await page.viewport(390,700);
  await page.goto(`http://127.0.0.1:${port}/scripts/playtest/skill-art-fixtures.html`);await page.waitFor('window.ready===true');
  for(const [id,at]of Object.entries({xiahou_dun:.4,cao_cao:.46,liu_bei:.38,sun_quan:.3,zhou_yu:.33,sima_yi:1.04,xu_chu:.22,gan_ning:.55})){
    const data=await page.eval(`window.artFixture.skill(${JSON.stringify(id)},${at})`);await page.screenshot(path.join(out,`skill-${id}.png`));report.screens.push(data);
  }
  for(const type of ['shield','archer','crossbow','catapult','fire_oil','war_drum']){
    const data=await page.eval(`window.artFixture.camp(${JSON.stringify(type)})`);await page.screenshot(path.join(out,`camp-${type}.png`));
    const point=await page.eval(`(() => {const r=document.querySelector('canvas').getBoundingClientRect(),p=${JSON.stringify(data.position)};return{x:r.x+p.x*r.width/420,y:r.y+p.y*r.height/600};})()`);
    if(Number.isFinite(point.x)&&Number.isFinite(point.y))await crop(`camp-${type}-close.png`,{x:Math.max(0,point.x-65),y:Math.max(0,point.y-75),width:130,height:120});
    report.screens.push(data);
  }
  const party=await page.eval('window.artFixture.party()');assert.equal(party.heroes.length,3);await page.screenshot(path.join(out,'party-three.png'));report.screens.push(party);
  await crop('party-three-wall-close.png',{x:0,y:450,width:390,height:200});
  const crowd=await page.eval('window.artFixture.crowd()');assert.ok(crowd.slowed>0,'shield really slowed enemies');await page.screenshot(path.join(out,'crowd-stage-one.png'));report.screens.push(crowd);
  const reduced=await page.eval('window.artFixture.skill("xiahou_dun",.4,true)');await page.screenshot(path.join(out,'skill-reduced-motion.png'));report.screens.push(reduced);
  report.cacheBounds=await page.eval(`(async()=>{
    const {getBattleSprite,HERO_MOTION,CAMP_IDS,ENEMY_IDS}=await import('../../battle-sprites.js');
    let checked=0;const clipped=[];
    const inspect=(kind,id,options)=>{
      const s=getBattleSprite(kind,id,{...options,dpr:2}),c=s.canvas,w=c.width,h=c.height,p=c.getContext('2d').getImageData(0,0,w,h).data;
      let edge=false;for(let x=0;x<w;x++)edge ||= p[x*4+3]>0||p[((h-1)*w+x)*4+3]>0;
      for(let y=0;y<h;y++)edge ||= p[(y*w)*4+3]>0||p[(y*w+w-1)*4+3]>0;
      checked++;if(edge)clipped.push({kind,id,...options});
    };
    for(const [id,states]of Object.entries(HERO_MOTION))for(const [state,clip]of Object.entries(states))for(let frame=0;frame<clip.frames;frame++)inspect('hero',id,{state,frame});
    for(const id of CAMP_IDS)for(const level of [1,2,3])for(const state of ['idle','attack'])for(let frame=0;frame<(state==='idle'?4:5);frame++)inspect('camp',id,{level,state,frame});
    for(const id of ENEMY_IDS)for(const state of ['walk','hit'])for(let frame=0;frame<6;frame++)inspect('enemy',id,{state,frame});
    for(const variant of ['rammer','charger','banner_lord','guardian','siege_lord'])for(let frame=0;frame<6;frame++)inspect('enemy','boss',{variant,frame});
    return{checked,clipped};
  })()`);
  assert.deepEqual(report.cacheBounds.clipped,[],'all actual rasterized sprite frames retain transparent padding');
  assert.deepEqual(page.errors,[]);console.log(`Art fixtures: ${report.screens.length} screenshots, no errors`);
}catch(error){report.fatal=String(error.stack||error);console.error(report.fatal);process.exitCode=1;}
finally{report.errors=page?.errors||[];await writeAtomic(path.join(out,'art-fixtures-report.json'),JSON.stringify(report,null,2));await page?.close();server.kill();}
