#!/usr/bin/env node
/**
 * Class bodies → game GLBs. Run from the repo root after art/tools/classes/retarget.mjs:
 *
 *   node art/tools/classes/build-class-glbs.mjs [soldier|pepe_player ...]
 *
 * Most of a rigged GLB like player.glb is clip JSON (an accessor, a sampler and a channel per
 * joint per clip), so the clips are kept lean:
 * 1. No resample: every channel of a clip then shares the clip's one 24 fps time accessor, which
 *    costs less than per-channel key times once meshopt has packed the quaternions.
 * 2. Channels that only ever hold their joint's default TRS are dropped (three.js blends an
 *    undriven joint back to its default, so the clip looks the same), except in the upper-body
 *    layers `aim` and `shoot`.
 * 3. Defaults are stripped from the written JSON (LINEAR interpolation, zero byte offsets).
 * The Tripo mesh is welded and simplified (its UV atlas has so many seams that the soldier stops
 * near 10.4k triangles), textures go to WebP, then meshopt. prune keeps leaves: `socket_weapon` is
 * an empty leaf. Not `gltf-transform optimize`, which prunes it. Fails over MAX_KIB / MAX_TRIS.
 */
import { meshopt, prune, simplify, textureCompress, weld } from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer';
import sharp from 'sharp';
import fs from 'node:fs';
import { io } from './rig.mjs';

await MeshoptSimplifier.ready;
/**
 * `tris`: simplify target. `textures`: largest side per texture slot, 0 drops the map (the
 * soldier's camo base colour needs the bytes more than its normal map does).
 */
const BODIES = {
  soldier: { raw: 'art/source/classes/soldier_raw.glb', out: 'public/assets/models/characters/soldier.glb', tris: 9000, quality: 70, textures: { baseColorTexture: 512, normalTexture: 0, metallicRoughnessTexture: 256 } },
  pepe_player: { raw: 'art/source/classes/pepe_player_raw.glb', out: 'public/assets/models/characters/pepe_player.glb', tris: 10000, textures: { baseColorTexture: 1024, normalTexture: 256, metallicRoughnessTexture: 256 } },
  pepe_warrior: { raw: 'art/source/classes/pepe_warrior_raw.glb', out: 'public/assets/models/characters/pepe_warrior.glb', tris: 10000, textures: { baseColorTexture: 512, normalTexture: 256, metallicRoughnessTexture: 256 } },
};
const MAX_KIB = 470;
const MAX_TRIS = 22000;
const SAME = 2e-4;
const QUALITY = 76;
/** Slow loops and holds keyed at 12 fps (every other 24 fps key; their lengths are whole 12ths). */
const HALF_RATE = new Set(['idle', 'stun', 'victory', 'defeat']);

function halveRate(doc) {
  for (const anim of doc.getRoot().listAnimations()) {
    if (!HALF_RATE.has(anim.getName())) continue;
    const done = new Map();
    const keep = (acc) => {
      if (done.has(acc)) return done.get(acc);
      const n = acc.getElementSize(), src = acc.getArray();
      const count = acc.getCount();
      if ((count - 1) % 2) throw new Error(`${anim.getName()}: ${count} keys is not 12 fps aligned`);
      const dst = new src.constructor(((count + 1) / 2) * n);
      for (let i = 0; i < count; i += 2) dst.set(src.subarray(i * n, i * n + n), (i / 2) * n);
      const copy = acc.clone().setArray(dst);
      done.set(acc, copy);
      return copy;
    };
    for (const sampler of anim.listSamplers()) sampler.setInput(keep(sampler.getInput())).setOutput(keep(sampler.getOutput()));
  }
}

/** Rewrite a GLB's JSON chunk without glTF defaults. */
function stripDefaults(glb) {
  const view = new DataView(glb.buffer, glb.byteOffset, glb.byteLength);
  const jsonLen = view.getUint32(12, true);
  const json = JSON.parse(new TextDecoder().decode(glb.subarray(20, 20 + jsonLen)));
  for (const anim of json.animations ?? []) for (const s of anim.samplers) if (s.interpolation === 'LINEAR') delete s.interpolation;
  for (const a of json.accessors ?? []) {
    if (a.byteOffset === 0) delete a.byteOffset;
    if (a.normalized === false) delete a.normalized;
  }
  for (const v of json.bufferViews ?? []) if (v.byteOffset === 0) delete v.byteOffset;
  let text = new TextEncoder().encode(JSON.stringify(json));
  const pad = (4 - (text.length % 4)) % 4;
  const chunk = new Uint8Array(text.length + pad).fill(0x20);
  chunk.set(text);
  const rest = glb.subarray(20 + jsonLen);
  const out = new Uint8Array(12 + 8 + chunk.length + rest.length);
  const ov = new DataView(out.buffer);
  out.set(glb.subarray(0, 12));
  ov.setUint32(8, out.length, true);
  ov.setUint32(12, chunk.length, true);
  ov.setUint32(16, 0x4e4f534a, true);
  out.set(chunk, 20);
  out.set(rest, 20 + chunk.length);
  return out;
}

/**
 * Upper-body clips the game layers over locomotion: every channel stays, even one that holds the
 * default, or the layer underneath would show through on that joint.
 */
const LAYERS = new Set(['aim', 'shoot']);

/** Remove channels whose every key equals the target node's default value. */
function dropDefaultChannels(doc) {
  let dropped = 0;
  for (const anim of doc.getRoot().listAnimations()) {
    if (LAYERS.has(anim.getName())) continue;
    for (const ch of anim.listChannels()) {
      const node = ch.getTargetNode();
      const path = ch.getTargetPath();
      const def = path === 'rotation' ? node.getRotation() : path === 'translation' ? node.getTranslation() : path === 'scale' ? node.getScale() : null;
      if (!def) continue;
      const out = ch.getSampler().getOutput();
      let same = true;
      const el = [];
      for (let i = 0; i < out.getCount() && same; i++) {
        out.getElement(i, el);
        const sign = path === 'rotation' && el.reduce((a, v, k) => a + v * def[k], 0) < 0 ? -1 : 1;
        same = el.every((v, k) => Math.abs(v * sign - def[k]) < SAME);
      }
      if (!same) continue;
      const sampler = ch.getSampler();
      ch.dispose();
      if (!sampler.listParents().some((p) => p.propertyType === 'AnimationChannel')) sampler.dispose();
      dropped++;
    }
  }
  return dropped;
}

const ids = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(BODIES);
let failed = false;
for (const id of ids) {
  const { raw, out, tris: target, textures, quality = QUALITY } = BODIES[id];
  const doc = await io.read(raw);
  // Tripo's KHR_materials_volume does nothing without transmission.
  for (const ext of doc.getRoot().listExtensionsUsed()) if (ext.extensionName === 'KHR_materials_volume') ext.dispose();
  for (const mat of doc.getRoot().listMaterials()) {
    if (!textures.normalTexture) mat.setNormalTexture(null);
    if (!textures.metallicRoughnessTexture) mat.setMetallicRoughnessTexture(null);
  }
  halveRate(doc);
  const dropped = dropDefaultChannels(doc);
  let before = 0;
  for (const m of doc.getRoot().listMeshes()) for (const p of m.listPrimitives()) before += p.getIndices().getCount() / 3;
  await doc.transform(
    weld(),
    simplify({ simplifier: MeshoptSimplifier, ratio: target / before, error: 0.03, lockBorder: false }),
    prune({ keepLeaves: true, keepAttributes: false }),
    ...Object.entries(textures).filter(([, px]) => px).map(([slot, px]) => textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [px, px], quality, slots: new RegExp(`^${slot}$`) })),
    meshopt({ encoder: MeshoptEncoder, level: 'high', quantizePosition: 12, quantizeTexcoord: 12, quantizeNormal: 8 }),
  );
  for (const a of doc.getRoot().listAccessors()) a.setName('');
  if (!doc.getRoot().listNodes().some((n) => n.getName() === 'socket_weapon')) throw new Error(`${id}: socket_weapon was pruned`);
  fs.writeFileSync(out, stripDefaults(await io.writeBinary(doc)));
  let tris = 0;
  for (const m of doc.getRoot().listMeshes()) for (const p of m.listPrimitives()) tris += p.getIndices().getCount() / 3;
  const kib = fs.statSync(out).size / 1024;
  const clips = doc.getRoot().listAnimations();
  const channels = clips.reduce((a, c) => a + c.listChannels().length, 0);
  console.log(`wrote ${out}: ${kib.toFixed(1)} KiB, ${tris} triangles (from ${before}), ${clips.length} clips, ${channels} channels (${dropped} default-only dropped)`);
  if (kib > MAX_KIB || tris > MAX_TRIS) {
    console.error(`${id} is over budget (${MAX_KIB} KiB, ${MAX_TRIS} triangles)`);
    failed = true;
  }
}
if (failed) process.exit(1);
