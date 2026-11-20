#!/usr/bin/env node
/**
 * socket_weapon's world matrix for every 24 fps frame of every clip of a body GLB, the way three.js
 * poses it (`aim` and `shoot` layered over `idle`, and on their own as `aim_alone` and
 * `shoot_alone`). render_sheet.py places the gun with these, so
 * the contact sheets check the socket contract itself rather than Blender's import of a
 * bone-parented empty.
 *
 *   node art/tools/classes/socket-frames.mjs <body.glb> <out.json>
 */
import fs from 'node:fs';
import { durationOf, io, poseAt, rigOf, worldOf } from './rig.mjs';

const [file, out] = process.argv.slice(2);
const doc = await io.read(file);
const rig = rigOf(doc);
const socket = rig.byName.get('socket_weapon');
const clips = doc.getRoot().listAnimations();
const idle = clips.find((a) => a.getName() === 'idle');
const result = {};
const framesOf = (clip, base) => {
  const frames = [];
  for (let f = 0; f <= Math.round(durationOf(clip) * 24); f++) {
    const t = Math.min(f / 24, durationOf(clip));
    const pose = base ? poseAt(base, t) : new Map();
    for (const [node, v] of poseAt(clip, t)) pose.set(node, { ...pose.get(node), ...v });
    frames.push(worldOf(rig, pose).get(socket).elements.map((v) => +v.toFixed(5)));
  }
  return frames;
};
for (const clip of clips) {
  const upper = ['aim', 'shoot'].includes(clip.getName());
  result[clip.getName()] = framesOf(clip, upper ? idle : null);
  // The upper-body layers on their own too (default hips and legs): where the contract is exact.
  if (upper) result[`${clip.getName()}_alone`] = framesOf(clip, null);
}
fs.writeFileSync(out, JSON.stringify(result));
console.log(`wrote ${out}: ${clips.length} clips`);
