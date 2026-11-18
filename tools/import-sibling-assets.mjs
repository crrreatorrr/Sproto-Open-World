#!/usr/bin/env node
/**
 * Copy the assets this game reuses from its sibling repos into public/assets (plan §7.3), and
 * record where each came from in public/assets/IMPORTED.json. The copies are committed: nothing
 * reads the sibling repos at run time.
 *
 *   - `*.glb.gz` (sproto-shooter props) are gunzipped.
 *   - `*.wav` are transcoded to Opus in WebM, plus an AAC `.m4a` fallback for older Safari
 *     (needs ffmpeg on PATH).
 *   - World props (models/props, plan §3.4) are meshopt-compressed (LOD0), and also get a LOD1
 *     `<name>-lod1.glb`: drop normals, weld by position
 *     (the kit is flat-shaded with per-face colours, so a normal weld leaves nothing to collapse),
 *     simplify toward 30% of the triangles (meshoptimizer), unweld, flat normals, meshopt.
 *     Deterministic: the same source gives the same bytes. LOD1 files are this repo's own outputs
 *     (check-assets treats them as owned). meshopt quantizes positions and puts the dequantizing
 *     scale/offset on the mesh's node, so instancers must bake node transforms into the geometry.
 *
 *   - Characters, interactables and pickups can carry a recipe (the 4th FILES column): textures
 *     resized and re-encoded as WebP, clips the game never plays dropped, stray nodes removed, an
 *     optional skinned simplify, then meshopt (M4: the village start's download budget). The recipe
 *     is recorded as `derived` in IMPORTED.json, and a file is redone when its recipe or its source
 *     changes.
 *
 * Run by hand: `npm run import:assets` (add `--force` to redo files that already exist).
 */
import { Logger, NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import {
  clearNodeTransform, dedup, dequantize, getBounds, meshopt, normals, prune, resample, simplify, textureCompress, unweld, weld,
} from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import zlib from 'node:zlib';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
/** The folder holding the sibling repos: this repo's parent, or `SPROTO_GAMES` (run from a worktree). */
const GAMES = path.resolve(process.env.SPROTO_GAMES ?? path.join(ROOT, '..'));
const OUT = path.join(ROOT, 'public', 'assets');
const force = process.argv.includes('--force');

const DUEL = 'sproto-duel';
const SHOOTER = 'sproto-shooter';
const BOSSES = 'sproto-shooter-bosses';

/**
 * Sproutvale's props and set pieces (plan §6.1, §7.1): the sproto-shooter grove set plus the
 * landmarks. Each becomes models/props/<name>.glb and a generated models/props/<name>-lod1.glb.
 */
const WORLD_PROPS = [
  'grove_tree', 'grove_pines', 'grove_boulder', 'grove_stones', 'grove_hedge', 'grove_reeds', 'grove_root_wall',
  'grove_shed', 'grove_barn_roof', 'grove_silo', 'grove_water_tower', 'grove_tower', 'grove_beanstalk', 'grove_bridge',
  'grove_crops', 'grove_hay', 'grove_scarecrow', 'grove_pumpkin', 'well', 'frost_beacon', 'frost_gate', 'skyline_crane',
  'underworks_hoist',
  // M4: Sproutvale's village square.
  'fountain', 'bench', 'cart', 'lantern_post',
];
/**
 * sproto-duel's arena obstacles used as village props. They are authored at unit size facing +X,
 * so the import turns them to face +Z and scales them to their duel size (config.ts's collider
 * heights), feet on y = 0: the bake places them at scale 1 in metres like every other prop.
 */
const DUEL_PROPS = {
  market_stall: { height: 2.4, rotationY: -90, tex: 256, lod1Tex: 128 },
  // 5.7k triangles in the source: simplified to fit the 4k prop cap.
  rock_outcrop: { height: 3.0, rotationY: -90, tex: 256, lod1Tex: 128, simplify: 0.65 },
};
/** LOD1 target: this fraction of LOD0's triangles (plan §3.4). */
const LOD1_RATIO = 0.3;
const LOD1_ERROR = 0.05;

/**
 * Recipes (M4). `tex`: largest texture side (WebP, quality 80). `clips`: keep only these.
 * `drop`: remove nodes by name (pepe's stray Blender `Cube`). `simplify`: triangle ratio.
 * `meshopt`: meshopt-compress a static model. `lid`: split a chest's lid onto its own hinged node.
 */
/** Villagers: idle is the only clip they play; small on screen, so 256 px textures. */
const NPC = { tex: 256, clips: ['idle'], drop: ['Cube'] };
/** Pepe is 17k triangles: simplified to about 7k for the village (NPCs are all in the start ring). */
const PEPE = { ...NPC, simplify: 0.4 };

/**
 * The chest's lid (the cartoon kit's chest is one mesh): everything above y = `cutY` moves to a
 * `chest_lid` child node whose origin is the hinge along the back edge, so the view can swing it.
 */
const CHEST_LID = { cutY: 0.52, hinge: [0, 0.52, -0.4] };

/** [repo, source path under the repo, destination under public/assets, recipe?]. */
const FILES = [
  // Staffs: the player's weapon and the loot pool (plan §5.2). Mounted on socket_staff.
  // (alien_ray is left out: its LOD1 alone is 9.3k triangles, and the slice's loot doesn't use it.)
  ...['sproto', 'moonward', 'momentum', 'nobu', 'fighters_might'].flatMap((id) => [
    [DUEL, `public/assets/models/staffs/staff_${id}.glb`, `models/staffs/staff_${id}.glb`],
    [DUEL, `public/assets/models/staffs/staff_${id}-lod1.glb`, `models/staffs/staff_${id}-lod1.glb`],
  ]),
  // Ground, rock and sky for the yard and, later, Sproutvale.
  [DUEL, 'public/assets/textures/themes/grove/floor.jpg', 'textures/grove/floor.jpg'],
  [DUEL, 'public/assets/textures/themes/grove/stone.jpg', 'textures/grove/stone.jpg'],
  [DUEL, 'public/assets/textures/themes/grove/sky.jpg', 'textures/grove/sky.jpg'],
  // M1a: the Thornwood Brute (punch, kick, idle, walk, run clips; elite tier, 19.5k triangles).
  // M4: its three 512 px maps re-encoded at 256 px (it is in the critical download: 1.1 MB → 0.7 MB).
  [SHOOTER, 'public/assets/models/characters/sproto_monster.glb', 'models/elites/brute.glb', { tex: 256 }],
  // M1b: the standard enemies (24-joint rigs with duel's clip set: idle, run, cast, cast_big, hit, stun, defeat…).
  [SHOOTER, 'public/assets/models/characters/midget_stage1.glb', 'models/enemies/grunt.glb'],
  [SHOOTER, 'public/assets/models/characters/obama_stage1.glb', 'models/enemies/slinger.glb'],
  // M4: the Wisp's 1024 px map at 512 px, like the other two.
  [DUEL, 'public/assets/models/rigged/sahil_stage1.glb', 'models/enemies/wisp.glb', { tex: 512 }],
  // M4: the veterans (same clip set; Big Coin is the Slinger veteran fitted bigger) and the Gatekeeper
  // (idle, walk, run, smash; elite tier, 18k triangles, its maps at 512 px).
  [SHOOTER, 'public/assets/models/characters/midget_stage2.glb', 'models/enemies/grunt_vet.glb'],
  [SHOOTER, 'public/assets/models/characters/obama_stage2.glb', 'models/enemies/slinger_vet.glb'],
  [SHOOTER, 'public/assets/models/characters/monster.glb', 'models/elites/gatekeeper.glb', { tex: 512 }],
  // M5: Scrapjaw, the Quarry Beast (20.1k triangles; every boss clip; lazy-loaded at the quarry).
  [BOSSES, 'dist/assets/models/characters/car_monster.glb', 'models/bosses/scrapjaw.glb', { tex: 512 }],
  // M4: Sproutvale's villagers.
  [SHOOTER, 'public/assets/models/characters/pepe-general.glb', 'models/npcs/pepe_general.glb', PEPE],
  [SHOOTER, 'public/assets/models/characters/pepe.glb', 'models/npcs/pepe.glb', PEPE],
  [SHOOTER, 'public/assets/models/characters/pepe-tux.glb', 'models/npcs/pepe_tux.glb', PEPE],
  [DUEL, 'public/assets/models/rigged/broccoli_stage1.glb', 'models/npcs/broccoli.glb', NPC],
  [DUEL, 'public/assets/models/rigged/agent_stage1.glb', 'models/npcs/agent.glb', NPC],
  // M4: shrines, chests and pickups (the cartoon kit: vertex colours, no textures).
  [SHOOTER, 'public/assets/models/props/campaign_shrine.glb.gz', 'models/interactables/shrine.glb.gz', { meshopt: true }],
  [SHOOTER, 'public/assets/models/props/chest.glb.gz', 'models/interactables/chest.glb.gz', { meshopt: true, lid: CHEST_LID }],
  ...['gem', 'heart', 'potion'].map((id) => [SHOOTER, `public/assets/models/pickups/${id}.glb.gz`, `models/pickups/${id}.glb.gz`, { meshopt: true }]),
  ...Object.entries(DUEL_PROPS).map(([id, fit]) => [DUEL, `public/assets/models/obstacles/${id}.glb`, `models/props/${id}.glb`, { fit }]),
  // Sounds used from M0/M1: menus, movement, hits, guards, swings, lock-on and telegraphs.
  ...WORLD_PROPS.map((id) => [SHOOTER, `public/assets/models/props/${id}.glb.gz`, `models/props/${id}.glb.gz`]),
  ...['uiClick', 'uiHover', 'dodge', 'clash', 'hurt', 'shieldBlock', 'shieldPerfect', 'shieldUp', 'boltCast', 'boltHit', 'blastExplode', 'noMana',
    'rugWhoosh', 'carpetWhoosh', 'lockBeep', 'stunCharge', 'bossSlam', 'pillarHit', 'roundLose'].map(
    (id) => [DUEL, `public/assets/audio/placeholder/${id}.wav`, `audio/${id}.wav`],
  ),
];

function commitOf(repo) {
  try {
    return execFileSync('git', ['-C', path.join(GAMES, repo), 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  } catch {
    return 'unknown';
  }
}

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

function hasFfmpeg() {
  try {
    execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

await MeshoptDecoder.ready;
await MeshoptEncoder.ready;
await MeshoptSimplifier.ready;
const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });

/**
 * Merge vertices that share a position (keeping the first one's colour), so the simplifier sees
 * connected surfaces. Expects dequantized float positions and no normals.
 */
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

/** LOD0 GLB bytes → LOD1 GLB bytes. Pure function of the input, so re-running gives the same file. */
async function makeLod1(glb) {
  const doc = await io.readBinary(new Uint8Array(glb));
  doc.setLogger(new Logger(Logger.Verbosity.ERROR));
  for (const mesh of doc.getRoot().listMeshes()) for (const prim of mesh.listPrimitives()) prim.setAttribute('NORMAL', null);
  await doc.transform(
    dequantize(),
    weldByPosition(),
    simplify({ simplifier: MeshoptSimplifier, ratio: LOD1_RATIO, error: LOD1_ERROR }),
    unweld(),
    normals({ overwrite: true }),
    prune(),
    meshopt({ encoder: MeshoptEncoder, level: 'high' }),
  );
  return Buffer.from(await io.writeBinary(doc));
}

/** LOD0 prop: meshopt compression only (the source is already quantized; this is ~3× smaller). */
async function compressLod0(glb) {
  const doc = await io.readBinary(new Uint8Array(glb));
  doc.setLogger(new Logger(Logger.Verbosity.ERROR));
  await doc.transform(meshopt({ encoder: MeshoptEncoder, level: 'high' }));
  return Buffer.from(await io.writeBinary(doc));
}

const quiet = () => new Logger(Logger.Verbosity.ERROR);

/** Remove every clip not in `keep` (its channels and samplers too, so prune frees their data). */
function keepClips(doc, keep) {
  for (const a of doc.getRoot().listAnimations()) {
    if (keep.includes(a.getName())) continue;
    for (const c of a.listChannels()) c.dispose();
    for (const s of a.listSamplers()) s.dispose();
    a.dispose();
  }
}

/**
 * Drop animation channels that hold a node at its rest value for the whole clip (Tripo exports key
 * every joint's translation, rotation and scale in every clip). Lossless: three.js's mixer blends a
 * property no clip drives back to its rest value. Most of the Brute's 190 KB of glTF JSON is
 * these channels' accessors.
 */
function dropStaticChannels(doc) {
  const el = [];
  for (const a of doc.getRoot().listAnimations()) {
    for (const c of a.listChannels()) {
      const node = c.getTargetNode();
      const pathName = c.getTargetPath();
      if (!node || !['translation', 'rotation', 'scale'].includes(pathName)) continue;
      const rest = pathName === 'translation' ? node.getTranslation() : pathName === 'rotation' ? node.getRotation() : node.getScale();
      const out = c.getSampler().getOutput();
      let same = c.getSampler().getInterpolation() !== 'CUBICSPLINE';
      for (let i = 0; same && i < out.getCount(); i++) {
        out.getElement(i, el);
        // Rotations: q and -q are the same turn.
        const sign = pathName === 'rotation' && el[0] * rest[0] + el[1] * rest[1] + el[2] * rest[2] + el[3] * rest[3] < 0 ? -1 : 1;
        for (let k = 0; k < rest.length; k++) if (Math.abs(sign * el[k] - rest[k]) > 1e-5) same = false;
      }
      if (!same) continue;
      const sampler = c.getSampler();
      c.dispose();
      if (!sampler.listParents().some((p) => p.propertyType === 'AnimationChannel')) sampler.dispose();
    }
  }
}

/** Move everything under a temporary parent with `matrix`-like TRS, then bake it into the meshes. */
function bakeTransform(doc, { rotation = [0, 0, 0, 1], scale = 1, translation = [0, 0, 0] }) {
  const scene = doc.getRoot().listScenes()[0];
  const fit = doc.createNode('fit').setRotation(rotation).setScale([scale, scale, scale]).setTranslation(translation);
  const kids = scene.listChildren();
  scene.addChild(fit);
  for (const k of kids) fit.addChild(k);
  clearNodeTransform(fit);
  const bake = (n) => {
    if (n.getMesh()) clearNodeTransform(n);
    n.listChildren().forEach(bake);
  };
  kids.forEach(bake);
  for (const k of kids) scene.addChild(k);
  fit.dispose();
}

/**
 * A duel obstacle at its real size: turned `rotationY` degrees to face +Z, scaled to `height` m,
 * centred on x/z with its feet on y = 0. Expects dequantized geometry.
 */
const fitProp = ({ height, rotationY }) => (doc) => {
  const scene = doc.getRoot().listScenes()[0];
  for (const n of doc.getRoot().listNodes()) if (n.getMesh()) clearNodeTransform(n);
  const th = (rotationY * Math.PI) / 180;
  bakeTransform(doc, { rotation: [0, Math.sin(th / 2), 0, Math.cos(th / 2)] });
  const b = getBounds(scene);
  const s = height / (b.max[1] - b.min[1]);
  const cx = (b.min[0] + b.max[0]) / 2, cz = (b.min[2] + b.max[2]) / 2;
  bakeTransform(doc, { scale: s, translation: [-cx * s, -b.min[1] * s, -cz * s] });
};

/**
 * Split a chest's lid onto a `chest_lid` child node at `hinge`: the kit's chest is one mesh whose end
 * caps run from the base to the lid, so every triangle is cut by the plane y = `cutY` (attributes
 * interpolated along the cut edges) and the parts above it become the lid, with vertices relative
 * to the hinge. Expects dequantized geometry.
 */
const splitLid = ({ cutY, hinge }) => (doc) => {
  const root = doc.getRoot();
  const buffer = root.listBuffers()[0];
  const node = root.listNodes().find((n) => n.getMesh());
  clearNodeTransform(node);
  const lidMesh = doc.createMesh('chest_lid');
  for (const prim of node.getMesh().listPrimitives()) {
    const sems = prim.listSemantics();
    const attrs = sems.map((sm) => prim.getAttribute(sm));
    const pi = sems.indexOf('POSITION');
    const n = attrs[0].getCount();
    const ia = prim.getIndices()?.getArray() ?? Uint32Array.from({ length: n }, (_, i) => i);
    /** A vertex: one array per attribute. */
    const vert = (i) => attrs.map((a) => a.getElement(i, []));
    const lerp = (va, vb, t) => va.map((arr, k) => arr.map((x, c) => x + (vb[k][c] - x) * t));
    const out = { base: sems.map(() => []), lid: sems.map(() => []) };
    const emit = (side, poly) => {
      for (let i = 1; i + 1 < poly.length; i++) for (const v of [poly[0], poly[i], poly[i + 1]]) v.forEach((arr, k) => out[side][k].push(...arr));
    };
    for (let t = 0; t < ia.length; t += 3) {
      const vs = [vert(ia[t]), vert(ia[t + 1]), vert(ia[t + 2])];
      const up = vs.map((v) => v[pi][1] > cutY);
      if (up.every(Boolean)) emit('lid', vs);
      else if (!up.some(Boolean)) emit('base', vs);
      else {
        // Sutherland–Hodgman against the plane, once for each side.
        const above = [], below = [];
        for (let i = 0; i < 3; i++) {
          const a = vs[i], b = vs[(i + 1) % 3];
          (up[i] ? above : below).push(a);
          if (up[i] !== up[(i + 1) % 3]) {
            const m = lerp(a, b, (cutY - a[pi][1]) / (b[pi][1] - a[pi][1]));
            above.push(m);
            below.push(m);
          }
        }
        emit('lid', above);
        emit('base', below);
      }
    }
    const build = (target, data, offset) => {
      sems.forEach((sm, k) => {
        const src = attrs[k];
        let arr = Float32Array.from(data[k]);
        if (offset && sm === 'POSITION') for (let i = 0; i < arr.length; i += 3) for (let c = 0; c < 3; c++) arr[i + c] -= offset[c];
        if (src.getNormalized() || !(src.getArray() instanceof Float32Array)) arr = new src.getArray().constructor(arr.map(Math.round));
        target.setAttribute(sm, doc.createAccessor().setType(src.getType()).setNormalized(src.getNormalized()).setArray(arr).setBuffer(buffer));
      });
      target.setIndices(null);
    };
    const lp = prim.clone();
    build(lp, out.lid, hinge);
    build(prim, out.base, null);
    lidMesh.addPrimitive(lp);
  }
  // The mesh sits on a child: meshopt's quantization puts its dequantizing scale on the mesh's node,
  // and the view turns `chest_lid` about the hinge.
  const lidNode = doc.createNode('chest_lid').setTranslation(hinge);
  lidNode.addChild(doc.createNode('chest_lid_mesh').setMesh(lidMesh));
  node.addChild(lidNode);
};

/** A recipe as text: IMPORTED.json's `derived`, and what decides whether a file is redone. */
function describe(o) {
  const parts = [];
  if (o.fit) parts.push(`fit ${o.fit.height} m, turn ${o.fit.rotationY}°`);
  if (o.drop) parts.push(`drop ${o.drop.join(', ')}`);
  if (o.clips) parts.push(`clips ${o.clips.join(', ')}`);
  // (Clips only; nothing for a static model.)
  parts.push('resample + static channels dropped');
  const simp = o.simplify ?? o.fit?.simplify;
  if (simp) parts.push(`simplify(${simp})`);
  const tex = o.tex ?? o.fit?.tex;
  if (tex) parts.push(`webp ≤${tex} px`);
  if (o.lid) parts.push(`lid cut at y ${o.lid.cutY} onto a hinged node`);
  parts.push('meshopt');
  return parts.join(' + ');
}

/** Source GLB → re-encoded GLB per its recipe (see `describe`). */
async function encode(glb, o) {
  const doc = await io.readBinary(new Uint8Array(glb));
  doc.setLogger(quiet());
  const root = doc.getRoot();
  for (const n of root.listNodes()) if (o.drop?.includes(n.getName())) n.dispose();
  if (o.clips) keepClips(doc, o.clips);
  const steps = [dedup()];
  if (root.listAnimations().length) steps.push(resample(), () => dropStaticChannels(doc));
  steps.push(prune());
  const simp = o.simplify ?? o.fit?.simplify;
  if (o.fit || o.lid || simp) steps.push(dequantize());
  if (o.fit) steps.push(fitProp(o.fit));
  if (o.lid) steps.push(splitLid(o.lid), weld());
  if (simp) steps.push(weld(), simplify({ simplifier: MeshoptSimplifier, ratio: simp, error: 0.01 }));
  const tex = o.tex ?? o.fit?.tex;
  if (tex) steps.push(textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [tex, tex], quality: 80 }));
  if (o.fit) for (const m of root.listMaterials()) m.setDoubleSided(true);
  steps.push(prune(), meshopt({ encoder: MeshoptEncoder, level: 'high' }));
  await doc.transform(...steps);
  return Buffer.from(await io.writeBinary(doc));
}

/**
 * LOD1 for a textured prop (the duel obstacles): a normal weld keeps the UV seams, so the
 * position-weld + flat-normal recipe of the cartoon kit doesn't apply. From the encoded LOD0.
 */
async function makeTexturedLod1(lod0, tex) {
  const doc = await io.readBinary(new Uint8Array(lod0));
  doc.setLogger(quiet());
  await doc.transform(
    dequantize(),
    weld(),
    simplify({ simplifier: MeshoptSimplifier, ratio: LOD1_RATIO, error: LOD1_ERROR }),
    textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [tex, tex], quality: 80 }),
    prune(),
    meshopt({ encoder: MeshoptEncoder, level: 'high' }),
  );
  return Buffer.from(await io.writeBinary(doc));
}
const texturedLod1 = (tex) => `LOD1: weld + simplify(${LOD1_RATIO}, error ${LOD1_ERROR}) + webp ≤${tex} px + meshopt`;
const KIT_LOD1 = `LOD1: position weld + simplify(${LOD1_RATIO}, error ${LOD1_ERROR}) + flat normals + meshopt`;

const manifestPath = path.join(OUT, 'IMPORTED.json');
const manifest = fs.existsSync(manifestPath) ? JSON.parse(fs.readFileSync(manifestPath, 'utf8')) : { files: {} };
const commits = {};
const ffmpeg = hasFfmpeg();
let copied = 0, skipped = 0;

for (const [repo, rel, destRel, recipe] of FILES) {
  const src = path.join(GAMES, repo, rel);
  if (!fs.existsSync(src)) {
    console.error(`missing: ${repo}/${rel}`);
    process.exitCode = 1;
    continue;
  }
  commits[repo] ??= commitOf(repo);
  let buf = fs.readFileSync(src);
  let outRel = destRel.replace(/\.gz$/, '');
  if (rel.endsWith('.gz')) buf = zlib.gunzipSync(buf);
  /** [output path, derived description or undefined, written now]. */
  const outputs = [];
  // Redo a file when asked, when it is missing, or when its recipe changed.
  const stale = (o, derived) => force || !fs.existsSync(path.join(OUT, o)) || manifest.files[o]?.derived !== derived;
  if (outRel.endsWith('.wav')) {
    if (!ffmpeg) {
      console.error('ffmpeg not found: cannot transcode audio');
      process.exitCode = 1;
      continue;
    }
    const base = path.join(OUT, outRel.replace(/\.wav$/, ''));
    fs.mkdirSync(path.dirname(base), { recursive: true });
    for (const [ext, args] of [
      ['.webm', ['-c:a', 'libopus', '-b:a', '64k']],
      ['.m4a', ['-c:a', 'aac', '-b:a', '80k']],
    ]) {
      const dest = base + ext;
      if (!force && fs.existsSync(dest)) {
        skipped++;
      } else {
        execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', src, ...args, '-ac', '1', dest]);
        copied++;
      }
      outputs.push([path.relative(OUT, dest), undefined, true]);
    }
  } else {
    const dest = path.join(OUT, outRel);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    const isProp = outRel.startsWith('models/props/');
    const derived = recipe ? describe(recipe) : isProp ? 'meshopt' : undefined;
    const redo = stale(outRel, derived);
    if (!redo) skipped++;
    else {
      fs.writeFileSync(dest, recipe ? await encode(buf, recipe) : isProp ? await compressLod0(buf) : buf);
      copied++;
    }
    outputs.push([outRel, derived, redo]);
    if (isProp) {
      const lodRel = outRel.replace(/\.glb$/, '-lod1.glb');
      const textured = Boolean(recipe?.fit);
      const lodDerived = textured ? texturedLod1(recipe.fit.lod1Tex) : KIT_LOD1;
      const lodRedo = redo || stale(lodRel, lodDerived);
      if (!lodRedo) skipped++;
      else {
        fs.writeFileSync(path.join(OUT, lodRel), textured ? await makeTexturedLod1(fs.readFileSync(dest), recipe.fit.lod1Tex) : await makeLod1(buf));
        copied++;
      }
      outputs.push([lodRel, lodDerived, lodRedo]);
    }
  }
  for (const [o, derived, written] of outputs) {
    // A file left as it was keeps the provenance it was made from.
    if (!written && manifest.files[o]) continue;
    manifest.files[o] = { repo, path: rel, commit: commits[repo], sourceSha256: sha256(fs.readFileSync(src)) };
    if (derived) manifest.files[o].derived = derived;
  }
}

manifest.note = 'Generated by tools/import-sibling-assets.mjs. Every asset is the owner\'s own work (plan §7.3).';
manifest.files = Object.fromEntries(Object.entries(manifest.files).sort(([a], [b]) => a.localeCompare(b)));
fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
console.log(`import: ${copied} written, ${skipped} already present, ${Object.keys(manifest.files).length} tracked`);
