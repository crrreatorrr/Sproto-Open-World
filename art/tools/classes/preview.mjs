#!/usr/bin/env node
/**
 * Contact sheets for the class bodies and guns, from the game files. Run from the repo root:
 *
 *   node art/tools/classes/preview.mjs
 *
 * Decodes the GLBs into a temp folder, writes socket_weapon's per-frame world matrices
 * (socket-frames.mjs), and runs render_sheet.py in Blender: art/source/classes/preview/
 * soldier_<n>.png and pepe_player_<n>.png (gun_mg on socket_weapon), <body>_grip.png (close-ups
 * of the gun hand), wizard_<n>.png (the same poses on the motion donor, for comparison) and
 * guns.png.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';

const BLENDER = process.env.BLENDER ?? '/Applications/Blender.app/Contents/MacOS/Blender';
const OUT = 'art/source/classes/preview';
const GUNS = ['mg', 'shotgun', 'sniper', 'bazooka', 'raygun', 'bigbullets', 'duckgun'];
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'class-preview-'));
fs.mkdirSync(OUT, { recursive: true });
const run = (cmd, args) => execFileSync(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] }).toString();
const decode = (from, to) => run('node', ['art/tools/decode-glb.mjs', from, to]);
const blender = (...args) => {
  const log = run(BLENDER, ['--background', '--factory-startup', '--python', 'art/tools/classes/render_sheet.py', '--', ...args]);
  for (const line of log.split('\n')) if (line.startsWith('SHEET')) console.log(line);
};

for (const g of GUNS) decode(`public/assets/models/guns/gun_${g}.glb`, `${tmp}/gun_${g}.glb`);
blender('guns', `${OUT}/guns.png`, ...GUNS.map((g) => `${tmp}/gun_${g}.glb`));
for (const body of ['soldier', 'pepe_player']) {
  decode(`public/assets/models/characters/${body}.glb`, `${tmp}/${body}.glb`);
  run('node', ['art/tools/classes/socket-frames.mjs', `public/assets/models/characters/${body}.glb`, `${tmp}/${body}_sockets.json`]);
  blender('body', `${tmp}/${body}.glb`, `${OUT}/${body}.png`, `${tmp}/gun_mg.glb`, `${tmp}/${body}_sockets.json`);
  blender('grip', `${tmp}/${body}.glb`, `${OUT}/${body}_grip.png`, `${tmp}/gun_mg.glb`, `${tmp}/${body}_sockets.json`);
}
blender('body', 'art/source/player_raw.glb', `${OUT}/wizard.png`);
fs.rmSync(tmp, { recursive: true, force: true });
// Blender writes 16-bit RGBA; palette PNGs are a tenth of the size and fine for checking by eye.
for (const name of fs.readdirSync(OUT).filter((f) => f.endsWith('.png'))) {
  const file = `${OUT}/${name}`;
  const png = await sharp(file).flatten({ background: '#ffffff' }).png({ palette: true, quality: 90, compressionLevel: 9 }).toBuffer();
  fs.writeFileSync(file, png);
}
