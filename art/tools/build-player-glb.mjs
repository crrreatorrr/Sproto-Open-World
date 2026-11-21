#!/usr/bin/env node
/**
 * Blender export → game GLB. Run from the repo root after exporting art/source/player_raw.glb:
 *
 *   node art/tools/build-player-glb.mjs
 *
 * 1. Restores `socket_staff`'s transform and extras from the source rig. Blender's glTF round trip
 *    re-expresses a bone-parented empty relative to the bone's tail and gets the armature's 0.01
 *    scale wrong (the socket landed 18 m up the hand bone), so the exported value is never trusted.
 * 2. Adds Sproto Shooter's `aim`, `shoot`, `reload`, `dash` and `slide` and a `socket_weapon`
 *    (art/tools/classes/wizard-gun-clips.mjs).
 * 3. resample → WebP → meshopt, like the other sibling GLBs. Not `gltf-transform optimize`, which
 *    prunes the empty socket node.
 */
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { meshopt, resample, textureCompress } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';
import sharp from 'sharp';
import { addWizardGunClips } from './classes/wizard-gun-clips.mjs';

const SOURCE = 'art/source/wizard_player_decoded.glb';
const RAW = 'art/source/player_raw.glb';
const OUT = 'public/assets/models/characters/player.glb';

await MeshoptDecoder.ready;
await MeshoptEncoder.ready;
const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });

const source = await io.read(SOURCE);
const want = source.getRoot().listNodes().find((n) => n.getName() === 'socket_staff');
if (!want) throw new Error(`${SOURCE} has no socket_staff`);

const doc = await io.read(RAW);
const socket = doc.getRoot().listNodes().find((n) => n.getName() === 'socket_staff');
if (!socket) throw new Error(`${RAW} has no socket_staff (select it when exporting)`);
const parent = doc.getRoot().listNodes().find((n) => n.listChildren().includes(socket));
if (parent?.getName() !== 'RightHand') throw new Error(`socket_staff is under ${parent?.getName()}, expected RightHand`);
socket.setTranslation(want.getTranslation()).setRotation(want.getRotation()).setScale(want.getScale()).setExtras(want.getExtras());

console.log(JSON.stringify(await addWizardGunClips(doc)));

// Channels that only ever hold their joint's default are dropped (three.js blends an undriven joint
// to its default, so the clip looks the same), as on the class bodies. Blender exports translation,
// rotation and scale for all 24 joints in every clip; nearly all the translations and scales are
// such constants, and they cost more of the file than the mesh. The gun layers keep every channel.
const LAYERS = new Set(['aim', 'hold', 'shoot', 'reload', 'aim_1h', 'hold_1h', 'shoot_1h', 'reload_1h', 'dual', 'dual_shoot_r', 'dual_shoot_l', 'dual_reload', 'dual_reload_r', 'dual_reload_l']);
const SAME = 2e-4;
let dropped = 0;
for (const anim of doc.getRoot().listAnimations()) {
  if (LAYERS.has(anim.getName())) continue;
  for (const ch of anim.listChannels()) {
    const node = ch.getTargetNode();
    const path = ch.getTargetPath();
    const def = path === 'rotation' ? node.getRotation() : path === 'translation' ? node.getTranslation() : path === 'scale' ? node.getScale() : null;
    if (!def) continue;
    const out = ch.getSampler().getOutput();
    const el = [];
    let same = true;
    for (let i = 0; i < out.getCount() && same; i++) {
      out.getElement(i, el);
      const sign = path === 'rotation' && el.reduce((a, v, k) => a + v * def[k], 0) < 0 ? -1 : 1;
      // Translations are in the armature's centimetres: the same tolerance, in metres.
      const tol = path === 'translation' ? SAME * 100 : SAME;
      same = el.every((v, k) => Math.abs(v * sign - def[k]) < tol);
    }
    if (!same) continue;
    const sampler = ch.getSampler();
    ch.dispose();
    if (!sampler.listParents().some((parent) => parent.propertyType === 'AnimationChannel')) {
      const accessors = [sampler.getInput(), sampler.getOutput()];
      sampler.dispose();
      for (const acc of accessors) if (!acc.listParents().some((parent) => parent.propertyType === 'AnimationSampler')) acc.dispose();
    }
    dropped++;
  }
}
console.log(`dropped ${dropped} default-only channels`);

await doc.transform(resample(), textureCompress({ encoder: sharp, targetFormat: 'webp' }), meshopt({ encoder: MeshoptEncoder }));
await io.write(OUT, doc);
console.log(`wrote ${OUT}: socket_staff restored to`, want.getTranslation().map((v) => +v.toFixed(3)));
