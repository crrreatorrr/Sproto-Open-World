#!/usr/bin/env node
/**
 * Byte budgets on the production build (plan §3.5). Run after `npm run build`.
 *   - Title shell (index.html + CSS + entry JS, gzip): ≤ 150 KiB.
 *   - Critical transfer to playable (all JS, the player, its staff, every enemy model the yard or the wave runner loads, the yard textures,
 *     Sproutvale's region.json, the village cells (3–4, 0–1) and their ring, every prop those cells place (LOD0 + LOD1) and
 *     horizon.glb), as served (JS gzip; GLB/JPG/WebM already compressed; cell .bin/.json counted raw): ≤ 8 MiB.
 *   - World (plan §3.1, §3.5): every cell (bin + json) ≤ 120 KB; each region under world/ ≤ 30 MiB.
 * Prints the Rapier chunk size, which the plan asked M0 to measure.
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const DIST = path.resolve('dist');
const KiB = 1024, MiB = 1024 * 1024;
const gz = (f) => zlib.gzipSync(fs.readFileSync(f)).length;
const size = (f) => fs.statSync(f).size;
const build = path.join(DIST, 'build');
const files = fs.readdirSync(build);
const html = fs.readFileSync(path.join(DIST, 'index.html'), 'utf8');
const entry = [...html.matchAll(/(?:src|href)="\.\/build\/([^"]+)"/g)].map((m) => m[1]);
const shell = gz(path.join(DIST, 'index.html')) + entry.reduce((n, f) => n + gz(path.join(build, f)), 0);
const allJs = files.filter((f) => f.endsWith('.js')).reduce((n, f) => n + gz(path.join(build, f)), 0);
const rapier = files.filter((f) => f.startsWith('rapier') && f.endsWith('.js')).reduce((n, f) => n + gz(path.join(build, f)), 0);
const critical = ['assets/models/characters/player.glb', 'assets/models/staffs/staff_sproto.glb', 'assets/models/elites/brute.glb', 'assets/models/enemies/grunt.glb', 'assets/models/enemies/slinger.glb', 'assets/models/enemies/wisp.glb', 'assets/textures/grove/floor.jpg', 'assets/textures/grove/stone.jpg', 'assets/textures/grove/sky.jpg'];

// Sproutvale: the village cells and their ring load before Playing (plan §3.2), with their props and the horizon.
const WORLD = path.join(DIST, 'world');
const region = JSON.parse(fs.readFileSync(path.join(WORLD, 'sproutvale/region.json'), 'utf8'));
const villageRing = region.cells.filter((c) => c.cx >= 2 && c.cx <= 5 && c.cz >= 0 && c.cz <= 2);
const villageProps = new Set();
for (const c of villageRing) {
  critical.push(c.bin, c.json);
  for (const key of Object.keys(JSON.parse(fs.readFileSync(path.join(DIST, c.json), 'utf8')).props)) villageProps.add(key);
}
for (const key of [...villageProps].sort()) {
  const k = region.props[key];
  critical.push(`assets/${k.path}`);
  if (k.lod1Path) critical.push(`assets/${k.lod1Path}`);
}
critical.push('world/sproutvale/region.json', region.horizon);
const criticalBytes = allJs + [...new Set(critical)].reduce((n, f) => n + size(path.join(DIST, f)), 0);

// Per-cell and per-region payloads, for every baked region.
let largestCell = 0, largestCellName = '';
const regionRows = [];
let cellFailures = 0;
for (const id of fs.readdirSync(WORLD).sort()) {
  const manifestPath = path.join(WORLD, id, 'region.json');
  if (!fs.existsSync(manifestPath)) continue;
  const m = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  for (const c of m.cells) {
    const bytes = size(path.join(DIST, c.bin)) + size(path.join(DIST, c.json));
    if (bytes > largestCell) [largestCell, largestCellName] = [bytes, `${id} ${c.cx},${c.cz}`];
    if (bytes > 120 * 1000) {
      cellFailures++;
      console.log(`FAIL cell ${id} ${c.cx},${c.cz}: ${(bytes / 1000).toFixed(1)} KB (budget 120 KB)`);
    }
  }
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).reduce((n, e) => n + (e.isDirectory() ? walk(path.join(d, e.name)) : size(path.join(d, e.name))), 0);
  regionRows.push([`region ${id}`, walk(path.join(WORLD, id)), 30 * MiB]);
}

const rows = [
  ['title shell (gzip)', shell, 150 * KiB],
  ['critical to playable', criticalBytes, 8 * MiB],
  ...regionRows,
];
let bad = cellFailures;
for (const [name, bytes, cap] of rows) {
  const ok = bytes <= cap;
  if (!ok) bad++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}: ${(bytes / KiB).toFixed(0)} KiB (budget ${(cap / KiB).toFixed(0)} KiB)`);
}
console.log(`${cellFailures ? 'FAIL' : 'ok  '} largest cell: ${largestCellName} ${(largestCell / 1000).toFixed(1)} KB (budget 120 KB)`);
console.log(`info rapier chunk (gzip): ${(rapier / KiB).toFixed(0)} KiB; all JS (gzip): ${(allJs / KiB).toFixed(0)} KiB`);
console.log(`info village critical: ${villageRing.length} cells, ${villageProps.size} prop kinds (${[...villageProps].sort().join(', ')}) + horizon`);
if (bad) process.exit(1);
