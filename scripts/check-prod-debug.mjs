#!/usr/bin/env node
/** Fails if a production build ships the QA hooks, the debug overlay toggle (plan §8) or the placement editor. */
import fs from 'node:fs';
import path from 'node:path';

const dir = path.resolve('dist/build');
const banned = ['__qa', 'installQa', 'placementEditor', 'placement-editor'];
let bad = 0;
for (const f of fs.readdirSync(dir)) {
  if (!f.endsWith('.js')) continue;
  const src = fs.readFileSync(path.join(dir, f), 'utf8');
  for (const b of banned) {
    if (src.includes(b)) {
      console.error(`check-prod-debug: ${f} contains "${b}"`);
      bad++;
    }
  }
}
if (bad) process.exit(1);
console.log('check-prod-debug: no QA hooks or dev tools in the production build');
