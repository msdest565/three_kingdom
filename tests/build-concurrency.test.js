import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Script } from 'node:vm';
const root=fileURLToPath(new URL('../',import.meta.url));

test('concurrent package builds expose only complete runtime modules and portable pages', {timeout:30000}, async()=>{
  const build=()=>new Promise((resolve,reject)=>{
    const child=spawn(process.execPath,['scripts/build.mjs'],{cwd:root,windowsHide:true,stdio:['ignore','ignore','pipe']});
    let stderr='';child.stderr.on('data',chunk=>{stderr+=chunk;});
    child.once('error',reject);child.once('exit',code=>code===0?resolve():reject(new Error(`Build exited ${code}: ${stderr}`)));
  });
  const builders=Promise.allSettled([build(),build()]);
  try { for(let i=0;i<20;i++) {
    const runtime=await import(`${pathToFileURL(fileURLToPath(new URL('../runtime-data.js',import.meta.url))).href}?atomic-read=${process.pid}-${i}`);
    assert.equal(Object.keys(runtime.BALANCE.heroes).length,15);assert.equal(runtime.CONTENT.levels.length,60);
    const page=await readFile(new URL('../dist/index.html',import.meta.url),'utf8');
    assert.ok(page.endsWith('</html>\n') || page.trimEnd().endsWith('</html>'));
    const code=[...page.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].at(-1)?.[1];
    assert.ok(code?.includes('const __modules = {}'));new Script(code);
  } } finally { for(const result of await builders) if(result.status==='rejected') throw result.reason; }
});
