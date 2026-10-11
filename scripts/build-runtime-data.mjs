import { readFile } from 'node:fs/promises';
import { writeAtomic } from './write-atomic.mjs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const [balance, content] = await Promise.all(['balance', 'levels'].map(async name => JSON.parse(await readFile(path.join(root, 'docs/v1/data', name + '.json'), 'utf8'))));
const source = '/** Generated from docs/v1/data. Edit the source JSON and run npm run data:build. */\n'
  + 'export const BALANCE = ' + JSON.stringify(balance.v1Baseline) + ';\n'
  + 'export const CONTENT = ' + JSON.stringify(content) + ';\n';
await writeAtomic(path.join(root, 'runtime-data.js'), source);
process.stdout.write(`Runtime content: ${Object.keys(balance.v1Baseline.heroes).length} heroes, ${content.levels.length} levels, ${content.maps.length} maps.\n`);
