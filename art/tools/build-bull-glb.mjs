#!/usr/bin/env node
/**
 * Blender export → game GLB for the rideable Pepe Bull. Run from the repo root after
 * art/tools/build_bull.py:
 *
 *   node art/tools/build-bull-glb.mjs
 */
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { meshopt, prune, resample, textureCompress } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';
import sharp from 'sharp';

const RAW = 'art/source/pepe_bull_raw.glb';
const OUT = 'public/assets/models/mounts/pepe_bull.glb';

await MeshoptDecoder.ready;
await MeshoptEncoder.ready;
const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });

const doc = await io.read(RAW);
await doc.transform(resample(), prune({ keepAttributes: true }), textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [1024, 1024] }), meshopt({ encoder: MeshoptEncoder }));
await io.write(OUT, doc);
const clips = doc.getRoot().listAnimations().map((a) => a.getName());
console.log(`wrote ${OUT}: clips ${clips.join(', ')}`);
