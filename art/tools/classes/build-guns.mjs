#!/usr/bin/env node
/**
 * Sproto Shooter's seven toy guns → third-person game guns. Run from the repo root:
 *
 *   node art/tools/classes/build-guns.mjs [mg shotgun ...]
 *
 * Reads ../sproto-shooter/public/assets/models/guns/toy_<id>.glb (only at build time; the outputs
 * are committed) and writes public/assets/models/guns/gun_<id>.glb:
 * - turned so the barrel points +Z and the top is +Y (the shooter's `GUN_MODELS[id].yaw` turns
 *   the barrel to -Z; this adds half a turn),
 * - origin at the right hand's grip (the shooter's `HAND_FRAC[id].grip`, fractions of the box from
 *   its centre, +z = back),
 * - scaled to the shooter's third-person length (`GUN_MODEL_LEN[id] * 0.82`, the machine gun
 *   0.96 m, for its 1.8 m characters),
 * - an empty child `muzzle` at the barrel tip (`GUN_MODELS[id].muzzleY` up the box, front face),
 * - simplified to ≤ MAX_TRIS, WebP ≤ TEXTURE px, meshopt; ≤ MAX_KIB each.
 */
import { clearNodeTransform, dequantize, flatten, meshopt, prune, simplify, textureCompress, weld } from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer';
import sharp from 'sharp';
import fs from 'node:fs';
import { Matrix4, Quaternion, Vector3 } from 'three';
import { io } from './rig.mjs';

await MeshoptSimplifier.ready;
const SRC = '../sproto-shooter/public/assets/models/guns';
const OUT = 'public/assets/models/guns';
const MAX_TRIS = 4000;
const MAX_KIB = 90;
/** From sproto-shooter src/render/assets.js GUN_MODELS and src/render/viewmodel/gunMesh.js. */
const GUNS = {
  mg: { yaw: 90, muzzleY: 0.6, length: 0.96, grip: [0, -0.26, 0.23] },
  shotgun: { yaw: -90, muzzleY: 0.85, length: 0.75 * 0.82, grip: [0, -0.29, 0.373] },
  sniper: { yaw: 90, muzzleY: 0.68, length: 0.8 * 0.82, grip: [0, -0.27, 0.145] },
  bazooka: { yaw: 0, muzzleY: 0.47, length: 0.9 * 0.82, grip: [0, -0.415, 0.208] },
  raygun: { yaw: 90, muzzleY: 0.64, length: 0.62 * 0.82, grip: [0, -0.298, 0.31] },
  bigbullets: { yaw: 90, muzzleY: 0.59, length: 0.78 * 0.82, grip: [0, -0.401, 0.405] },
  duckgun: { yaw: 90, muzzleY: 0.62, length: 0.8 * 0.82, grip: [0, -0.4, 0.219] },
};
/**
 * Tried in order until a gun fits MAX_KIB: the first step keeps the most triangles and texture.
 * Tripo atlases have so many UV seams that the mesh costs about as much as the base colour.
 */
const LADDER = [
  { tris: 4000, texture: 512 }, { tris: 3600, texture: 512 }, { tris: 3200, texture: 512 }, { tris: 3200, texture: 448 },
  { tris: 3000, texture: 384 }, { tris: 2600, texture: 384 }, { tris: 2400, texture: 320 },
];
const MAPS = { rm: 256, normal: 256, error: 0.02 };

function transformMesh(doc, matrix) {
  const normal = new Matrix4().extractRotation(matrix);
  const v = new Vector3();
  const done = new Set();
  for (const mesh of doc.getRoot().listMeshes()) for (const prim of mesh.listPrimitives()) {
    for (const [sem, m] of [['POSITION', matrix], ['NORMAL', normal]]) {
      const a = prim.getAttribute(sem);
      if (!a || done.has(a)) continue;
      done.add(a);
      for (let i = 0; i < a.getCount(); i++) a.setElement(i, v.fromArray(a.getElement(i, [])).applyMatrix4(m).toArray());
    }
    const t = prim.getAttribute('TANGENT');
    if (t && !done.has(t)) {
      done.add(t);
      const el = [];
      for (let i = 0; i < t.getCount(); i++) {
        t.getElement(i, el);
        v.set(el[0], el[1], el[2]).applyMatrix4(normal);
        t.setElement(i, [v.x, v.y, v.z, el[3]]);
      }
    }
  }
}

function boxOf(doc) {
  const lo = new Vector3(Infinity, Infinity, Infinity), hi = new Vector3(-Infinity, -Infinity, -Infinity), v = new Vector3();
  for (const mesh of doc.getRoot().listMeshes()) for (const prim of mesh.listPrimitives()) {
    const a = prim.getAttribute('POSITION');
    for (let i = 0; i < a.getCount(); i++) { v.fromArray(a.getElement(i, [])); lo.min(v); hi.max(v); }
  }
  return { lo, hi, size: hi.clone().sub(lo), center: lo.clone().add(hi).multiplyScalar(0.5) };
}

const tris = (doc) => doc.getRoot().listMeshes().reduce((n, m) => n + m.listPrimitives().reduce((k, p) => k + p.getIndices().getCount() / 3, 0), 0);

const ids = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(GUNS);
fs.mkdirSync(OUT, { recursive: true });
let failed = false;
async function buildGun(id, step) {
  const g = GUNS[id];
  const tune = { ...MAPS, ...step };
  const doc = await io.read(`${SRC}/toy_${id}.glb`);
  for (const e of doc.getRoot().listExtensionsUsed()) if (e.extensionName === 'EXT_meshopt_compression' || e.extensionName === 'KHR_mesh_quantization' || e.extensionName === 'KHR_materials_volume') e.dispose();
  await doc.transform(dequantize(), flatten());
  for (const node of doc.getRoot().listNodes()) if (node.getMesh()) clearNodeTransform(node);
  const before = tris(doc);

  // Barrel to +Z: the shooter's yaw (barrel to -Z) plus half a turn.
  transformMesh(doc, new Matrix4().makeRotationY(((g.yaw + 180) * Math.PI) / 180));
  const box = boxOf(doc);
  const grip = box.center.clone().add(new Vector3(-g.grip[0] * box.size.x, g.grip[1] * box.size.y, -g.grip[2] * box.size.z));
  const muzzleAt = new Vector3(box.center.x, box.lo.y + box.size.y * g.muzzleY, box.hi.z);
  const s = g.length / box.size.z;
  transformMesh(doc, new Matrix4().makeScale(s, s, s).multiply(new Matrix4().makeTranslation(-grip.x, -grip.y, -grip.z)));
  const muzzle = muzzleAt.sub(grip).multiplyScalar(s);

  // One stray texcoord just past 1 would keep a gun's UVs as floats through quantization.
  for (const mesh of doc.getRoot().listMeshes()) for (const prim of mesh.listPrimitives()) {
    const uv = prim.getAttribute('TEXCOORD_0');
    const el = [];
    for (let i = 0; uv && i < uv.getCount(); i++) uv.setElement(i, uv.getElement(i, el).map((v) => (v > 1 && v < 1.01 ? 1 : v < 0 && v > -0.01 ? 0 : v)));
  }
  await doc.transform(weld(), simplify({ simplifier: MeshoptSimplifier, ratio: tune.tris / before, error: tune.error, lockBorder: false }));
  // The seams of a Tripo atlas stop the seam-aware pass early; finish with attribute-aware,
  // permissive collapses (UVs weighted so the texture stays put).
  for (const mesh of doc.getRoot().listMeshes()) for (const prim of mesh.listPrimitives()) {
    const pos = prim.getAttribute('POSITION'), uv = prim.getAttribute('TEXCOORD_0'), nor = prim.getAttribute('NORMAL');
    const idx = new Uint32Array(prim.getIndices().getArray());
    if (idx.length / 3 <= tune.tris) continue;
    const P = new Float32Array(pos.getArray()), n = pos.getCount();
    const A = new Float32Array(n * 5);
    const el = [];
    for (let i = 0; i < n; i++) {
      uv.getElement(i, el); A[i * 5] = el[0]; A[i * 5 + 1] = el[1];
      nor.getElement(i, el); A[i * 5 + 2] = el[0]; A[i * 5 + 3] = el[1]; A[i * 5 + 4] = el[2];
    }
    const [out] = MeshoptSimplifier.simplifyWithAttributes(idx, P, 3, A, 5, [0.6, 0.6, 0.05, 0.05, 0.05], null, tune.tris * 3, 0.05, ['Permissive', 'Prune']);
    prim.setIndices(doc.createAccessor().setType('SCALAR').setArray(out).setBuffer(doc.getRoot().listBuffers()[0]));
  }

  // gun_<id> (empty, identity) → the mesh node and `muzzle`. meshopt's quantization puts its
  // dequantize transform on the mesh node, so the socket child must not live under it.
  const scene = doc.getRoot().getDefaultScene() ?? doc.getRoot().listScenes()[0];
  const root = doc.createNode(`gun_${id}`);
  for (const n of scene.listChildren()) {
    scene.removeChild(n);
    root.addChild(n);
    if (n.getMesh()) n.setName(`gun_${id}_mesh`);
  }
  scene.addChild(root);
  root.setExtras({ contract: 'origin = right-hand grip, +Z = barrel (muzzle end), +Y = top of the gun, metres; parent under socket_weapon with an identity transform' });
  const tip = doc.createNode('muzzle').setTranslation(muzzle.toArray().map((v) => +v.toFixed(4)));
  tip.setExtras({ contract: 'barrel tip: shots and the muzzle flash start here and travel along the gun\'s +Z' });
  root.addChild(tip);
  for (const mat of doc.getRoot().listMaterials()) if (!tune.normal) mat.setNormalTexture(null);

  await doc.transform(
    prune({ keepLeaves: true, keepAttributes: false }),
    textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [tune.texture, tune.texture], quality: 74, slots: /^(baseColorTexture|emissiveTexture)$/ }),
    textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [tune.rm, tune.rm], quality: 74, slots: /^(metallicRoughnessTexture|occlusionTexture)$/ }),
    ...(tune.normal ? [textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [tune.normal, tune.normal], quality: 74, slots: /^normalTexture$/ })] : []),
    meshopt({ encoder: MeshoptEncoder, level: 'high' }),
  );
  if (!doc.getRoot().listNodes().some((n) => n.getName() === 'muzzle')) throw new Error(`${id}: muzzle was pruned`);
  return { bytes: await io.writeBinary(doc), before, after: tris(doc), muzzle };
}

for (const id of ids) {
  let built, step;
  for (step of LADDER) {
    built = await buildGun(id, step);
    if (built.bytes.byteLength / 1024 <= MAX_KIB) break;
  }
  const file = `${OUT}/gun_${id}.glb`;
  fs.writeFileSync(file, built.bytes);
  const kib = built.bytes.byteLength / 1024;
  console.log(`wrote ${file}: ${kib.toFixed(1)} KiB, ${built.after} triangles (from ${built.before}), base colour ${step.texture} px, length ${GUNS[id].length.toFixed(3)} m, muzzle ${built.muzzle.toArray().map((v) => v.toFixed(3))}`);
  if (built.after > MAX_TRIS || kib > MAX_KIB) {
    console.error(`${id} is over budget (${MAX_TRIS} triangles, ${MAX_KIB} KiB)`);
    failed = true;
  }
}
if (failed) process.exit(1);
