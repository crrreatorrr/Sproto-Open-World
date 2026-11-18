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

import { readFileSync } from 'node:fs';

const RAW = 'art/source/pepe_bull_raw.glb';
const OUT = 'public/assets/models/mounts/pepe_bull.glb';
/** Blender keys whole frames at 24 fps; build_bull.py records how long each gait really lasts. */
const SECONDS = JSON.parse(readFileSync('art/source/pepe_bull_clips.json', 'utf8'));

await MeshoptDecoder.ready;
await MeshoptEncoder.ready;
const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });

const doc = await io.read(RAW);
for (const clip of doc.getRoot().listAnimations()) {
  const seconds = SECONDS[clip.getName()];
  if (!seconds) continue;
  // Samplers may share a time accessor: each is rescaled once, and never shared with another clip.
  const times = new Map();
  for (const sampler of clip.listSamplers()) {
    const input = sampler.getInput();
    if (!times.has(input)) times.set(input, input.clone());
    sampler.setInput(times.get(input));
  }
  const end = Math.max(...[...times.values()].map((a) => a.getMax([])[0]));
  for (const input of times.values()) input.setArray(input.getArray().map((t) => (t * seconds) / end));
}
await doc.transform(resample(), prune({ keepAttributes: true }), textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [1024, 1024] }), meshopt({ encoder: MeshoptEncoder }));
await io.write(OUT, doc);
const clips = doc.getRoot().listAnimations().map((a) => a.getName());
console.log(`wrote ${OUT}: clips ${clips.join(', ')}`);
