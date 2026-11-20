#!/usr/bin/env node
/**
 * Byte budgets on the production build (plan §3.5). Run after `npm run build`.
 *   - Title shell (index.html + CSS + entry JS, gzip): ≤ 150 KiB.
 *   - Critical transfer to playable in the world (all JS, the player, the small boot staff, the terrain textures, the combat sounds,
 *     the village's villagers, shrine, chests, pickups and square props,
 *     every region's region.json, the village cells (3–4, 0–1) and their ring, every prop those cells place (LOD0 + LOD1) and
 *     every overworld region's horizon.glb), as served (JS gzip; GLB/JPG/WebM already compressed; cell .bin/.json counted raw): ≤ 6 MiB.
 *     Enemies, other staffs and the full starter staff load later, by distance or when calm, so they don't count.
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
const critical = ['assets/models/characters/player.glb', 'assets/models/staffs/staff_sproto-lod1.glb', 'assets/textures/grove/floor.jpg', 'assets/textures/grove/stone.jpg'];
// The combat sounds load when play starts (App's COMBAT_SOUNDS); Opus is what most browsers fetch.
critical.push(...fs.readdirSync(path.join(DIST, 'assets/audio')).filter((f) => f.endsWith('.webm')).map((f) => `assets/audio/${f}`));
// M4: the village start draws its villagers, its shrine and chests, the pickups and the village
// square's props.
// The veterans, Big Coin and the Gatekeeper live out in the wilds: not critical.
critical.push(
  ...['pepe_general', 'pepe', 'pepe_tux', 'broccoli', 'agent'].map((id) => `assets/models/npcs/${id}.glb`),
  'assets/models/interactables/shrine.glb', 'assets/models/interactables/chest.glb',
  ...['gem', 'heart', 'potion'].map((id) => `assets/models/pickups/${id}.glb`),
  ...['fountain', 'bench', 'cart', 'lantern_post', 'market_stall'].flatMap((id) => [`assets/models/props/${id}.glb`, `assets/models/props/${id}-lod1.glb`]),
);

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
// The world loads every region's manifest before Play, and every overworld horizon at once (src/content/world/regions.ts).
for (const id of fs.readdirSync(WORLD).sort()) {
  const m = path.join(WORLD, id, 'region.json');
  if (!fs.existsSync(m)) continue;
  critical.push(`world/${id}/region.json`);
  if (id !== 'rootdeep') critical.push(JSON.parse(fs.readFileSync(m, 'utf8')).horizon);
}
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
  ['critical to playable', criticalBytes, 6 * MiB],
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
