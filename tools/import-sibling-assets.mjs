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
 * Run by hand: `npm run import:assets` (add `--force` to redo files that already exist).
 */
import { Logger, NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dequantize, meshopt, normals, prune, simplify, unweld } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
/** The folder holding the sibling repos (set SIBLING_REPOS when running from a git worktree). */
const GAMES = process.env.SIBLING_REPOS ?? path.resolve(ROOT, '..');
const OUT = path.join(ROOT, 'public', 'assets');
const force = process.argv.includes('--force');

const DUEL = 'sproto-duel';
const SHOOTER = 'sproto-shooter';

/**
 * Sproutvale's props and set pieces (plan §6.1, §7.1): the sproto-shooter grove set plus the
 * landmarks. Each becomes models/props/<name>.glb and a generated models/props/<name>-lod1.glb.
 */
const WORLD_PROPS = [
  'grove_tree', 'grove_pines', 'grove_boulder', 'grove_stones', 'grove_hedge', 'grove_reeds', 'grove_root_wall',
  'grove_shed', 'grove_barn_roof', 'grove_silo', 'grove_water_tower', 'grove_tower', 'grove_beanstalk', 'grove_bridge',
  'grove_crops', 'grove_hay', 'grove_scarecrow', 'grove_pumpkin', 'well', 'frost_beacon', 'frost_gate', 'skyline_crane',
  'underworks_hoist',
];
/** LOD1 target: this fraction of LOD0's triangles (plan §3.4). */
const LOD1_RATIO = 0.3;
const LOD1_ERROR = 0.05;

/** [repo, source path under the repo, destination under public/assets]. */
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
  [SHOOTER, 'public/assets/models/characters/sproto_monster.glb', 'models/elites/brute.glb'],
  // M1b: the standard enemies (24-joint rigs with duel's clip set: idle, run, cast, cast_big, hit, stun, defeat…).
  [SHOOTER, 'public/assets/models/characters/midget_stage1.glb', 'models/enemies/grunt.glb'],
  [SHOOTER, 'public/assets/models/characters/obama_stage1.glb', 'models/enemies/slinger.glb'],
  [DUEL, 'public/assets/models/rigged/sahil_stage1.glb', 'models/enemies/wisp.glb'],
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

const manifestPath = path.join(OUT, 'IMPORTED.json');
const manifest = fs.existsSync(manifestPath) ? JSON.parse(fs.readFileSync(manifestPath, 'utf8')) : { files: {} };
const commits = {};
const ffmpeg = hasFfmpeg();
let copied = 0, skipped = 0;

for (const [repo, rel, destRel] of FILES) {
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
  const outputs = [];
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
      outputs.push(path.relative(OUT, dest));
    }
  } else {
    const dest = path.join(OUT, outRel);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    const isProp = outRel.startsWith('models/props/');
    if (!force && fs.existsSync(dest)) skipped++;
    else {
      fs.writeFileSync(dest, isProp ? await compressLod0(buf) : buf);
      copied++;
    }
    outputs.push(outRel);
    if (isProp) {
      const lodRel = outRel.replace(/\.glb$/, '-lod1.glb');
      const lodDest = path.join(OUT, lodRel);
      if (!force && fs.existsSync(lodDest)) skipped++;
      else {
        fs.writeFileSync(lodDest, await makeLod1(buf));
        copied++;
      }
      outputs.push(lodRel);
    }
  }
  for (const o of outputs) {
    manifest.files[o] = { repo, path: rel, commit: commits[repo], sourceSha256: sha256(fs.readFileSync(src)) };
    if (o.startsWith('models/props/')) {
      manifest.files[o].derived = o.endsWith('-lod1.glb')
        ? `LOD1: position weld + simplify(${LOD1_RATIO}, error ${LOD1_ERROR}) + flat normals + meshopt`
        : 'meshopt';
    }
  }
}

manifest.note = 'Generated by tools/import-sibling-assets.mjs. Every asset is the owner\'s own work (plan §7.3).';
manifest.files = Object.fromEntries(Object.entries(manifest.files).sort(([a], [b]) => a.localeCompare(b)));
fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
console.log(`import: ${copied} written, ${skipped} already present, ${Object.keys(manifest.files).length} tracked`);
