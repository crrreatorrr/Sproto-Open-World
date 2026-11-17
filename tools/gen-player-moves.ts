/**
 * `npm run gen:moves` (plan §2.5): reads player.melee.json and player.glb and writes
 *
 *   src/content/generated/playerMoveTiming.ts  every timing marker in 60 Hz ticks
 *   src/content/generated/playerHitboxes.ts    per move and active tick, the staff as a capsule
 *                                              (butt → head) in character space
 *
 * The staff path is sampled from the clips exactly as the game plays them: the same root-motion
 * pinning (src/assets/rig.ts), the socket_staff node, and the staff's butt and top from the
 * socket's `extras.bindPoseWorld` contract. Character space: metres from the centre of the feet,
 * +Z forward, +X to the character's left, +Y up.
 *
 * `npm run gen:moves -- --check` fails if either file is stale.
 */
import { NodeIO, type Node as GNode } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import fs from 'node:fs';
import path from 'node:path';
import * as THREE from 'three';
import { pinRootMotion } from '../src/assets/rig';

const ROOT = path.resolve(import.meta.dirname, '..');
const GLB = path.join(ROOT, 'public/assets/models/characters/player.glb');
const JSON_PATH = path.join(ROOT, 'public/assets/models/characters/player.melee.json');
const OUT_TIMING = path.join(ROOT, 'src/content/generated/playerMoveTiming.ts');
const OUT_HITBOX = path.join(ROOT, 'src/content/generated/playerHitboxes.ts');
const TICK_HZ = 60;
const CAPSULE_RADIUS = 0.18;
const check = process.argv.includes('--check');

interface ClipTiming {
  active?: [number, number];
  cancel?: number;
  charge?: [number, number];
  raise_done?: number;
  hold_from?: number;
  end: number;
}

const ticks = (sec: number) => Math.round(sec * TICK_HZ);
const r4 = (v: number) => Math.round(v * 1e4) / 1e4;

// ---------------------------------------------------------------- timing
const melee = JSON.parse(fs.readFileSync(JSON_PATH, 'utf8')) as { clips: Record<string, ClipTiming> };
const timing: Record<string, Record<string, number>> = {};
for (const [name, t] of Object.entries(melee.clips)) {
  const m: Record<string, number> = { start: 0 };
  if (t.charge) {
    m.chargeStart = ticks(t.charge[0]);
    m.chargeEnd = ticks(t.charge[1]);
  }
  if (t.active) {
    m.activeStart = ticks(t.active[0]);
    m.activeEnd = ticks(t.active[1]);
  }
  if (t.cancel !== undefined) m.cancel = ticks(t.cancel);
  if (t.raise_done !== undefined) m.raised = ticks(t.raise_done);
  if (t.hold_from !== undefined) m.holdFrom = ticks(t.hold_from);
  m.end = ticks(t.end);
  timing[name] = m;
}

// ---------------------------------------------------------------- scene graph from the GLB
await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
const doc = await io.read(GLB);
const groot = doc.getRoot();

const objects = new Map<GNode, THREE.Object3D>();
for (const n of groot.listNodes()) {
  const isJoint = groot.listSkins().some((s) => s.listJoints().includes(n));
  const o = isJoint ? new THREE.Bone() : new THREE.Object3D();
  o.name = n.getName();
  o.position.fromArray(n.getTranslation());
  o.quaternion.fromArray(n.getRotation());
  o.scale.fromArray(n.getScale());
  objects.set(n, o);
}
const template = new THREE.Group();
for (const [n, o] of objects) {
  const children = n.listChildren();
  for (const c of children) o.add(objects.get(c)!);
}
for (const n of groot.listScenes()[0].listChildren()) template.add(objects.get(n)!);

const clips: THREE.AnimationClip[] = [];
for (const anim of groot.listAnimations()) {
  const tracks: THREE.KeyframeTrack[] = [];
  for (const ch of anim.listChannels()) {
    const node = ch.getTargetNode();
    const s = ch.getSampler();
    if (!node || !s) continue;
    const times = Array.from(s.getInput()!.getArray()!);
    const out = s.getOutput()!;
    const values = Array.from(out.getArray()!).map((v) => (out.getNormalized() ? normalizedToFloat(v, out.getComponentType()) : v));
    const prop = ch.getTargetPath();
    const name = `${node.getName()}.${prop === 'translation' ? 'position' : prop === 'rotation' ? 'quaternion' : 'scale'}`;
    if (prop === 'rotation') tracks.push(new THREE.QuaternionKeyframeTrack(name, times, values));
    else if (prop === 'translation' || prop === 'scale') tracks.push(new THREE.VectorKeyframeTrack(name, times, values));
  }
  clips.push(new THREE.AnimationClip(anim.getName(), -1, tracks));
}

function normalizedToFloat(v: number, componentType: number): number {
  switch (componentType) {
    case 5120: return Math.max(v / 127, -1);
    case 5121: return v / 255;
    case 5122: return Math.max(v / 32767, -1);
    case 5123: return v / 65535;
    default: return v;
  }
}

// Same root-motion pinning as the game (src/assets/rig.ts).
pinRootMotion(template, clips);

const socket = template.getObjectByName('socket_staff');
if (!socket) throw new Error('player.glb has no socket_staff');
const socketNode = groot.listNodes().find((n) => n.getName() === 'socket_staff')!;
const bind = (socketNode.getExtras() as { bindPoseWorld?: { position: number[]; quaternion: number[]; scale: number[]; butt: number[]; top: number[] } }).bindPoseWorld;
if (!bind) throw new Error('socket_staff has no extras.bindPoseWorld');
const bindWorld = new THREE.Matrix4().compose(new THREE.Vector3().fromArray(bind.position), new THREE.Quaternion().fromArray(bind.quaternion), new THREE.Vector3().fromArray(bind.scale));
const toLocal = bindWorld.clone().invert();
const buttLocal = new THREE.Vector3().fromArray(bind.butt).applyMatrix4(toLocal);
const topLocal = new THREE.Vector3().fromArray(bind.top).applyMatrix4(toLocal);

// ---------------------------------------------------------------- sample the active ticks
const mixer = new THREE.AnimationMixer(template);
const hitboxes: Record<string, { tick: number; a: number[]; b: number[] }[]> = {};
for (const [name, t] of Object.entries(timing)) {
  if (t.activeStart === undefined) continue;
  const clip = clips.find((c) => c.name === name);
  if (!clip) throw new Error(`player.glb has no clip ${name}`);
  const action = mixer.clipAction(clip);
  action.play();
  const list: { tick: number; a: number[]; b: number[] }[] = [];
  for (let tick = t.activeStart; tick < t.activeEnd; tick++) {
    action.time = Math.min(clip.duration, tick / TICK_HZ);
    mixer.update(0);
    template.updateMatrixWorld(true);
    const a = buttLocal.clone().applyMatrix4(socket.matrixWorld);
    const b = topLocal.clone().applyMatrix4(socket.matrixWorld);
    list.push({ tick, a: a.toArray().map(r4), b: b.toArray().map(r4) });
  }
  action.stop();
  hitboxes[name] = list;
}

// ---------------------------------------------------------------- write
const header = (what: string) => `// Generated by tools/gen-player-moves.ts from public/assets/models/characters/player.melee.json${what}.\n// Do not edit: change the clips (art/README.md) and run \`npm run gen:moves\`.\n\n`;
const timingSrc =
  header('') +
  `/** Clip timing markers in 60 Hz ticks from the clip's start. Intervals are half-open: [activeStart, activeEnd). */\n` +
  `export const PLAYER_MOVE_TIMING = ${JSON.stringify(timing, null, 2)} as const;\n\n` +
  `export type PlayerClip = keyof typeof PLAYER_MOVE_TIMING;\n`;
const hitboxSrc =
  header(' and player.glb') +
  `/**\n * The staff as a capsule (a = butt, b = head) for every active tick of each attack clip, in character\n * space: metres from the centre of the feet, +Z forward, +X to the character's left, +Y up.\n */\n` +
  `export const STAFF_CAPSULE_RADIUS = ${CAPSULE_RADIUS};\n\n` +
  `export const PLAYER_HITBOXES: Record<string, readonly { tick: number; a: readonly [number, number, number]; b: readonly [number, number, number] }[]> = ${JSON.stringify(hitboxes, null, 2)};\n`;

let stale = false;
for (const [file, src] of [[OUT_TIMING, timingSrc], [OUT_HITBOX, hitboxSrc]] as const) {
  const current = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  if (current === src) continue;
  if (check) {
    console.error(`stale: ${path.relative(ROOT, file)} (run npm run gen:moves)`);
    stale = true;
  } else {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, src);
    console.log(`wrote ${path.relative(ROOT, file)}`);
  }
}
if (stale) process.exit(1);
if (check) console.log('gen:moves: generated files are up to date');
