import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Script } from 'node:vm';
import { writeAtomic } from './write-atomic.mjs';
import './build-runtime-data.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(root, 'dist');
await mkdir(output, { recursive:true });
const profiles = [
  {page:'prototype.html',entry:'app.js',css:['styles.css'],modules:['game-engine.js','renderer.js','audio-system.js','tutorial.js','combat-clock.js']},
  {page:'index.html',entry:'campaign-app.js',css:['styles.css','campaign.css','brush-font.css','ui-v2.css','gear-tile.css','campaign-focus.css','hero-detail.css','workshop-v2.css','battle-art.css'],modules:['runtime-data.js','campaign-state.js','skill-targeting.js','v1-engine.js','renderer.js','hero-portraits.js','battle-sprites.js','hero-name-cards.js','equipment-art.js','gear-tile.js','hero-skill-copy.js','hero-presentation.js','v1-renderer.js','audio-system.js','tutorial.js','combat-clock.js','experience.js','share-card.js']},
];
const files = new Set(['favicon.svg','.nojekyll',...profiles.flatMap(p => [p.page,p.entry,...p.css,...p.modules])]);
for (const file of files) if (!profiles.some(profile=>profile.page===file)) await writeAtomic(path.join(output,file),await readFile(path.join(root,file),'utf8'));
const icon = await readFile(path.join(root,'favicon.svg'),'utf8');
function exportedNames(source) {
  const names = [...source.matchAll(/^export\s+(?:async\s+)?(?:class|function|const|let)\s+(\w+)/gm)].map(m => m[1]);
  for (const m of source.matchAll(/^export\s*\{([^}]+)\}\s*;?/gm)) for (const item of m[1].split(',')) names.push(item.trim().split(/\s+as\s+/).at(-1));
  return [...new Set(names.filter(Boolean))];
}
function transform(source) {
  return source.replace(/^import\s+\{([^}]+)\}\s+from\s+['"]([^'"]+)['"];?\s*$/gm,(_,names,file) => `const {${names.replace(/\b(\w+)\s+as\s+(\w+)/g,'$1:$2')}} = __modules[${JSON.stringify(file)}];\n`)
    .replace(/^export\s*\{[^}]+\}\s*;?\s*$/gm,'').replace(/^export\s+/gm,'');
}
for (const profile of profiles) {
  let html = await readFile(path.join(root,profile.page),'utf8');
  let moduleCode = '';
  for (const file of profile.modules) {
    const source = await readFile(path.join(root,file),'utf8');
    moduleCode += `__modules[${JSON.stringify('./'+file)}] = (() => {\n${transform(source)}\nreturn {${exportedNames(source).join(',')}};\n})();\n`;
  }
  const app = await readFile(path.join(root,profile.entry),'utf8');
  const script = `(() => {\nconst __modules = {};\n${moduleCode}\n${transform(app)}\n})();`;
  new Script(script,{filename:profile.page+'.bundle.js'});
  for (const file of profile.css) {
    const css = await readFile(path.join(root,file),'utf8');
    html = html.replace(`<link rel="stylesheet" href="./${file}">`,()=>`<style>${css}</style>`);
  }
  html = html.replace('<link rel="icon" href="./favicon.svg" type="image/svg+xml">',()=>`<link rel="icon" href="data:image/svg+xml,${encodeURIComponent(icon)}" type="image/svg+xml">`);
  html = html.replace(`<script type="module" src="./${profile.entry}"></script>`,()=>`<script>${script.replace(/<\/script/gi,'<\\/script')}</script>`);
  await writeAtomic(path.join(output,profile.page),html);
}
process.stdout.write(`Static V1 campaign and preserved prototype ready: ${output}\nBoth HTML pages run offline without a server or remote assets.\n`);
