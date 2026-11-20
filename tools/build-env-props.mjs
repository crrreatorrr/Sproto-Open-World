#!/usr/bin/env node
/**
 * The environment kits' game files (town, mountains, river, waterfalls, zen garden). Each kit is
 * built in Blender by art/tools/env/<kit>.py into raw GLBs under art/source/env/<kit>/; this turns
 * every one into
 *
 *   public/assets/models/props/<name>.glb        meshopt-compressed (positions quantized)
 *   public/assets/models/props/<name>-lod1.glb   drop normals, weld by position, simplify toward
 *                                                30%, unweld, flat normals, meshopt (the same
 *                                                recipe as tools/import-sibling-assets.mjs)
 *
 * and writes art/source/env/ENV_PROPS.json: every prop, its kit and whether it is a landmark (from
 * the kit's props.json). scripts/check-assets.mjs treats the listed files as this repo's own and
 * applies the landmark triangle cap to landmarks. Deterministic: the same sources give the same
 * bytes.
 *
 *   node tools/build-env-props.mjs [kit ...]
 */
import { Logger, NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, dequantize, meshopt, normals, prune, simplify, unweld } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const SOURCE = path.join(ROOT, 'art/source/env');
const OUT = path.join(ROOT, 'public/assets/models/props');
const KITS = ['town', 'mountains', 'river', 'waterfalls', 'zen'];
const LOD1_RATIO = 0.3;
const LOD1_ERROR = 0.05;

await Promise.all([MeshoptDecoder.ready, MeshoptEncoder.ready, MeshoptSimplifier.ready]);
const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });
const quiet = () => new Logger(Logger.Verbosity.ERROR);

/** Merge vertices that share a position (keeping the first one's attributes) so the simplifier sees connected surfaces. */
const weldByPosition = () => (doc) => {
  const buffer = doc.getRoot().listBuffers()[0];
  for (const mesh of doc.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      const pos = prim.getAttribute('POSITION');
      const pa = pos.getArray();
      const n = pos.getCount();
      const slot = new Map();
      const remap = new Uint32Array(n);
      const keep = [];
      for (let i = 0; i < n; i++) {
        const k = `${Math.round(pa[i * 3] * 1e4)},${Math.round(pa[i * 3 + 1] * 1e4)},${Math.round(pa[i * 3 + 2] * 1e4)}`;
        let j = slot.get(k);
        if (j === undefined) {
          j = keep.length;
          slot.set(k, j);
          keep.push(i);
        }
        remap[i] = j;
      }
      for (const sem of prim.listSemantics()) {
        const a = prim.getAttribute(sem);
        const es = a.getElementSize();
        const src = a.getArray();
        const out = new src.constructor(keep.length * es);
        keep.forEach((i, j) => {
          for (let c = 0; c < es; c++) out[j * es + c] = src[i * es + c];
        });
        prim.setAttribute(sem, doc.createAccessor().setType(a.getType()).setNormalized(a.getNormalized()).setArray(out).setBuffer(buffer));
      }
      const idx = prim.getIndices();
      const ia = idx ? idx.getArray() : Uint32Array.from({ length: n }, (_, i) => i);
      const ni = new Uint32Array(ia.length);
      for (let i = 0; i < ia.length; i++) ni[i] = remap[ia[i]];
      prim.setIndices(doc.createAccessor().setType('SCALAR').setArray(ni).setBuffer(buffer));
    }
  }
};

/** Opaque kit parts never sample a texture: drop their UVs (water sheets keep theirs, the game scrolls them). */
const dropUnusedUvs = () => (doc) => {
  for (const mesh of doc.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      if (prim.getMaterial()?.getName() !== 'fx_water') prim.setAttribute('TEXCOORD_0', null);
    }
  }
};

async function lod0(bytes) {
  const doc = await io.readBinary(bytes);
  doc.setLogger(quiet());
  await doc.transform(dropUnusedUvs(), dedup(), prune({ keepAttributes: true }), meshopt({ encoder: MeshoptEncoder, level: 'high' }));
  return Buffer.from(await io.writeBinary(doc));
}

async function lod1(bytes) {
  const doc = await io.readBinary(bytes);
  doc.setLogger(quiet());
  for (const mesh of doc.getRoot().listMeshes()) for (const prim of mesh.listPrimitives()) prim.setAttribute('NORMAL', null);
  await doc.transform(
    dropUnusedUvs(),
    dequantize(),
    weldByPosition(),
    simplify({ simplifier: MeshoptSimplifier, ratio: LOD1_RATIO, error: LOD1_ERROR }),
    unweld(),
    normals({ overwrite: true }),
    prune({ keepAttributes: true }),
    meshopt({ encoder: MeshoptEncoder, level: 'high' }),
  );
  return Buffer.from(await io.writeBinary(doc));
}

const wanted = process.argv.slice(2);
const manifestPath = path.join(SOURCE, 'ENV_PROPS.json');
const manifest = fs.existsSync(manifestPath) ? JSON.parse(fs.readFileSync(manifestPath, 'utf8')) : { props: {} };
fs.mkdirSync(OUT, { recursive: true });
for (const kit of KITS) {
  if (wanted.length && !wanted.includes(kit)) continue;
  const dir = path.join(SOURCE, kit);
  if (!fs.existsSync(dir)) continue;
  const meta = fs.existsSync(path.join(dir, 'props.json')) ? JSON.parse(fs.readFileSync(path.join(dir, 'props.json'), 'utf8')) : {};
  // A kit is rebuilt whole: forget its old entries, so a prop it no longer makes drops out.
  for (const [name, p] of Object.entries(manifest.props)) if (p.kit === kit) delete manifest.props[name];
  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.glb')).sort()) {
    const name = file.replace(/\.glb$/, '');
    const raw = new Uint8Array(fs.readFileSync(path.join(dir, file)));
    fs.writeFileSync(path.join(OUT, `${name}.glb`), await lod0(raw));
    fs.writeFileSync(path.join(OUT, `${name}-lod1.glb`), await lod1(raw));
    manifest.props[name] = { kit, landmark: Boolean(meta[name]?.landmark) };
    console.log(`build-env-props: ${kit}/${name}${meta[name]?.landmark ? ' (landmark)' : ''}`);
  }
}
manifest.props = Object.fromEntries(Object.keys(manifest.props).sort().map((k) => [k, manifest.props[k]]));
manifest._doc = 'Written by tools/build-env-props.mjs. Environment-kit props this repo builds itself (art/tools/env); scripts/check-assets.mjs reads it.';
fs.writeFileSync(manifestPath, JSON.stringify({ _doc: manifest._doc, props: manifest.props }, null, 2) + '\n');
