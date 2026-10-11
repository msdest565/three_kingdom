import { mkdir, copyFile, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Script } from 'node:vm';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(root, 'dist');
await mkdir(output, {recursive:true});
const assets = ['index.html','styles.css','app.js','game-engine.js','renderer.js','favicon.svg','.nojekyll'];
for (const name of assets) await copyFile(path.join(root,name),path.join(output,name));
const [html,css,engine,renderer,app,icon] = await Promise.all(
  ['index.html','styles.css','game-engine.js','renderer.js','app.js','favicon.svg'].map(name=>readFile(path.join(root,name),'utf8'))
);
const unexport = source => source.replace(/^export\s*\{[^}]*\};?\s*$/gm,'').replace(/^export\s+/gm,'');
const withoutImports = source => source.replace(/^import\s+.+;\s*$/gm,'');
const bundled = `(() => {\nconst {Game,CAMP_TYPES} = (() => {\n${unexport(engine)}\nreturn {Game,CAMP_TYPES};\n})();\nconst {Renderer} = (() => {\n${unexport(renderer)}\nreturn {Renderer};\n})();\n${withoutImports(app)}\n})();`;
new Script(bundled, {filename:'portable-game.js'});
const portable = html
  .replace('<link rel="stylesheet" href="./styles.css">',()=>`<style>${css}</style>`)
  .replace('<link rel="icon" href="./favicon.svg" type="image/svg+xml">',()=>`<link rel="icon" href="data:image/svg+xml,${encodeURIComponent(icon)}" type="image/svg+xml">`)
  .replace('<script type="module" src="./app.js"></script>',()=>`<script>${bundled.replace(/<\/script/gi,'<\\/script')}</script>`);
await writeFile(path.join(output,'index.html'),portable,'utf8');
process.stdout.write(`Static game ready: ${output}\nPortable index.html works offline with no server, external assets or runtime dependencies.\n`);
