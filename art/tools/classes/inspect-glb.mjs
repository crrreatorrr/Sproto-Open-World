// Print a GLB's node tree, skins, clips (name, duration, channel count) and triangle count.
// Usage: node art/tools/classes/inspect-glb.mjs <file.glb> [--nodes]
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import fs from 'node:fs';

const [file, ...flags] = process.argv.slice(2);
await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
const doc = await io.read(file);
const root = doc.getRoot();
let tris = 0;
for (const m of root.listMeshes()) for (const p of m.listPrimitives()) { const i = p.getIndices(); tris += (i ? i.getCount() : p.getAttribute('POSITION').getCount()) / 3; }
console.log(`${file}: ${(fs.statSync(file).size / 1024).toFixed(1)} KiB, ${tris} tris, ${root.listMeshes().length} meshes, ${root.listTextures().length} textures`);
for (const t of root.listTextures()) console.log('  tex', t.getName(), t.getMimeType(), t.getSize(), (t.getImage()?.byteLength / 1024).toFixed(0) + 'KiB');
console.log('extensions', root.listExtensionsUsed().map((e) => e.extensionName).join(' '));
if (flags.includes('--nodes')) {
  const f = (v) => v.map((x) => +x.toFixed(4)).join(',');
  const pr = (n, d) => { console.log(`${'  '.repeat(d)}${n.getName()} t[${f(n.getTranslation())}] r[${f(n.getRotation())}] s[${f(n.getScale())}]${n.getMesh() ? ' MESH' : ''}${n.getSkin() ? ' SKIN' : ''}${Object.keys(n.getExtras()).length ? ' extras=' + JSON.stringify(n.getExtras()) : ''}`); n.listChildren().forEach((c) => pr(c, d + 1)); };
  for (const s of root.listScenes()) s.listChildren().forEach((n) => pr(n, 0));
}
for (const s of root.listSkins()) console.log('skin', s.getName(), s.listJoints().length, 'joints');
for (const a of root.listAnimations()) {
  let max = 0, min = Infinity, frames = 0;
  for (const s of a.listSamplers()) { const arr = s.getInput().getArray(); max = Math.max(max, arr[arr.length - 1]); min = Math.min(min, arr[0]); frames = Math.max(frames, arr.length); }
  const paths = {}; for (const c of a.listChannels()) paths[c.getTargetPath()] = (paths[c.getTargetPath()] || 0) + 1;
  console.log(`clip ${a.getName()} ${min.toFixed(4)}..${max.toFixed(4)} keys=${frames} ch=${JSON.stringify(paths)}`);
}
