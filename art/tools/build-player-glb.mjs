#!/usr/bin/env node
/**
 * Blender export → game GLB. Run from the repo root after exporting art/source/player_raw.glb:
 *
 *   node art/tools/build-player-glb.mjs
 *
 * 1. Restores `socket_staff`'s transform and extras from the source rig. Blender's glTF round trip
 *    re-expresses a bone-parented empty relative to the bone's tail and gets the armature's 0.01
 *    scale wrong (the socket landed 18 m up the hand bone), so the exported value is never trusted.
 * 2. resample → WebP → meshopt, like the other sibling GLBs. Not `gltf-transform optimize`, which
 *    prunes the empty socket node.
 */
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { meshopt, resample, textureCompress } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';
import sharp from 'sharp';

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

await doc.transform(resample(), textureCompress({ encoder: sharp, targetFormat: 'webp' }), meshopt({ encoder: MeshoptEncoder }));
await io.write(OUT, doc);
console.log(`wrote ${OUT}: socket_staff restored to`, want.getTranslation().map((v) => +v.toFixed(3)));
