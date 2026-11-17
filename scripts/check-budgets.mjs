#!/usr/bin/env node
/**
 * Byte budgets on the production build (plan §3.5). Run after `npm run build`.
 *   - Title shell (index.html + CSS + entry JS, gzip): ≤ 150 KiB.
 *   - Critical transfer to playable (all JS, the player, its staff, the yard textures), as served
 *     (JS gzip; GLB/JPG/WebM already compressed): ≤ 8 MiB.
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
const critical = ['assets/models/characters/player.glb', 'assets/models/staffs/staff_sproto.glb', 'assets/textures/grove/floor.jpg', 'assets/textures/grove/stone.jpg', 'assets/textures/grove/sky.jpg'];
const criticalBytes = allJs + critical.reduce((n, f) => n + size(path.join(DIST, f)), 0);

const rows = [
  ['title shell (gzip)', shell, 150 * KiB],
  ['critical to playable', criticalBytes, 8 * MiB],
];
let bad = 0;
for (const [name, bytes, cap] of rows) {
  const ok = bytes <= cap;
  if (!ok) bad++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}: ${(bytes / KiB).toFixed(0)} KiB (budget ${(cap / KiB).toFixed(0)} KiB)`);
}
console.log(`info rapier chunk (gzip): ${(rapier / KiB).toFixed(0)} KiB; all JS (gzip): ${(allJs / KiB).toFixed(0)} KiB`);
if (bad) process.exit(1);
