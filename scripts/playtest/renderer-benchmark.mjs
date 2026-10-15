import {spawn} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {launch,sleep} from './cdp.mjs';
import {writeAtomic} from '../write-atomic.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const compare=process.argv.includes('--compare'),port=4610+Math.floor(Math.random()*100);
const server=spawn(process.execPath,['scripts/serve.mjs'],{cwd:root,env:{...process.env,PORT:String(port)},stdio:'ignore'});
let page;
try{
  await sleep(500);page=await launch();await page.viewport(390,600);
  await page.goto(`http://127.0.0.1:${port}/scripts/playtest/renderer-benchmark.html${compare?'?compare=1':''}`);
  await page.waitFor('window.ready===true');
  const report=await page.eval('window.runBenchmark()');report.errors=page.errors;
  await writeAtomic(path.join(root,'docs/v1/playtest/skill-art',compare?'render-performance.json':'render-performance-before.json'),JSON.stringify(report,null,2));
  console.log(JSON.stringify(report,null,2));
  if(page.errors.length||compare&&report.ratio>1)process.exitCode=1;
}finally{await page?.close();server.kill();}
