#!/usr/bin/env node
/**
 * Class bodies: retarget the wizard's 21 clips (art/source/player_raw.glb) and Sproto Shooter's
 * `ready`/`shoot` (art/source/classes/pepe_shooter_decoded.glb) onto the hub's Mixamo bodies, scale
 * them to the wizard's height and add `socket_weapon`. Writes art/source/classes/<id>_raw.glb
 * (uncompressed); art/tools/classes/build-class-glbs.mjs compresses them for the game.
 *
 *   node art/tools/classes/retarget.mjs [soldier|pepe_player ...]
 *
 * Done in three.js maths on the glTF itself rather than in Blender, so every pose means exactly
 * what the game will show (a joint no channel drives keeps its default TRS, which the shooter's
 * clips rely on for the hands).
 *
 * Method, per target joint b driven by source joint s:
 * 1. Rest alignment. Both rigs' reference poses are their default node TRS (wizard: A-pose,
 *    Mixamo bodies: their own T/A pose). Parent-first, each target joint gets a world correction
 *    C_b = swing(C_parent · dir_b → dir_s) · C_parent, so its bone points where the source bone
 *    points at rest and twist carries down the chain. A_b = C_b · R_b,ref.
 * 2. Every source frame: world delta D_s = R_s(t) · R_s,ref⁻¹, target world rotation D_s · A_b,
 *    turned into a local rotation under the target's own posed parent.
 * 3. Hips: horizontal motion scaled by the hip-height ratio. Height keeps the lowest point of the
 *    skinned mesh where the wizard's is, never below the floor (feet stay on the floor, a fall lands
 *    on the floor), and
 *    blends to matching the thighs' height while the wizard sits on the bull (mount, ride, dismount).
 * 4. Fingers are not in the wizard's rig: their default rotation is the target's own retargeted
 *    gun grip from the shooter's `ready` pose, so every wizard clip holds it.
 */
import { Matrix4, Quaternion, Vector3 } from 'three';
import { durationOf, io, posOf, poseAt, rigOf, rotOf, worldOf } from './rig.mjs';

const WIZARD = 'art/source/player_raw.glb';
const SHOOTER = 'art/source/classes/pepe_shooter_decoded.glb';
/** The wizard's standing height in player.glb at scale 1 (rest pose, skinned mesh, feet at y = 0). */
export const BODY_HEIGHT = 1.818;
const BODIES = {
  soldier: { src: 'art/source/classes/soldier_hub_decoded.glb', out: 'art/source/classes/soldier_raw.glb' },
  pepe_player: { src: 'art/source/classes/pepe_hub_decoded.glb', out: 'art/source/classes/pepe_player_raw.glb' },
};
export const WIZARD_CLIPS = ['idle', 'run', 'run_back', 'strafe_l', 'strafe_r', 'jump', 'roll', 'hit', 'stun', 'defeat', 'victory', 'cast', 'cast_big', 'attack_light_1', 'attack_light_2', 'attack_light_3', 'attack_heavy', 'block', 'mount', 'ride', 'dismount'];
const SEATED = new Set(['mount', 'ride', 'dismount']);
/**
 * Upper-body clips keep only these joints' channels: Sproto Shooter's `ARMS` filter plus the
 * spine, neck and head, so the gun points the same way over any locomotion clip.
 */
const UPPER = /^mixamorig:((Left|Right)(Shoulder|Arm|ForeArm|Hand)|Spine\d?|Neck|Head)$/;
const FINGER = /^mixamorig:(Left|Right)Hand(Index|Middle|Ring|Pinky|Thumb)\d$/;
/** Extra curl past the shooter's grip, degrees per segment (base, middle, tip). */
const CURL = {
  Right: { Index: [22, 30, 20], Middle: [48, 52, 35], Ring: [52, 52, 35], Pinky: [56, 50, 35], Thumb: [8, 22, 15] },
  Left: { Index: [28, 32, 22], Middle: [34, 38, 26], Ring: [38, 38, 26], Pinky: [42, 38, 26], Thumb: [6, 15, 10] },
};
const FPS = 24;
const AIM_SECONDS = 0.5;
/** Frames at each end of `shoot` eased back onto the `ready` pose. */
const SHOOT_EASE = 2;

const M = (n) => `mixamorig:${n}`;
const SIDES = ['Left', 'Right'];
/** [target, source, target dir child, source dir child]; null = inherit the parent's correction. */
const WIZARD_MAP = [
  [M('Hips'), 'Hips', null, null],
  [M('Spine'), 'Spine02', M('Spine1'), 'Spine01'],
  [M('Spine1'), 'Spine01', M('Spine2'), 'Spine'],
  [M('Spine2'), 'Spine', M('Neck'), 'neck'],
  [M('Neck'), 'neck', M('Head'), 'Head'],
  [M('Head'), 'Head', null, null],
  ...SIDES.flatMap((s) => [
    [M(`${s}Shoulder`), `${s}Shoulder`, M(`${s}Arm`), `${s}Arm`],
    [M(`${s}Arm`), `${s}Arm`, M(`${s}ForeArm`), `${s}ForeArm`],
    [M(`${s}ForeArm`), `${s}ForeArm`, M(`${s}Hand`), `${s}Hand`],
    [M(`${s}Hand`), `${s}Hand`, M(`${s}HandMiddle1`), 'centroid'],
    [M(`${s}UpLeg`), `${s}UpLeg`, M(`${s}Leg`), `${s}Leg`],
    [M(`${s}Leg`), `${s}Leg`, M(`${s}Foot`), `${s}Foot`],
    [M(`${s}Foot`), `${s}Foot`, M(`${s}ToeBase`), `${s}ToeBase`],
    [M(`${s}ToeBase`), `${s}ToeBase`, null, null],
  ]),
];
const same = (n, child) => [M(n), M(n), child && M(child), child && M(child)];
const SHOOTER_MAP = [
  same('Hips', null), same('Spine', 'Spine1'), same('Spine1', 'Spine2'), same('Spine2', 'Neck'), same('Neck', 'Head'), same('Head', null),
  ...SIDES.flatMap((s) => [
    same(`${s}Shoulder`, `${s}Arm`), same(`${s}Arm`, `${s}ForeArm`), same(`${s}ForeArm`, `${s}Hand`), same(`${s}Hand`, `${s}HandMiddle1`),
    ...['Index', 'Middle', 'Ring', 'Pinky', 'Thumb'].flatMap((f) => [same(`${s}Hand${f}1`, `${s}Hand${f}2`), same(`${s}Hand${f}2`, `${s}Hand${f}3`), same(`${s}Hand${f}3`, null)]),
    same(`${s}UpLeg`, `${s}Leg`), same(`${s}Leg`, `${s}Foot`), same(`${s}Foot`, `${s}ToeBase`), same(`${s}ToeBase`, null),
  ]),
];

/** Skinning data for fast "lowest point" queries (every `step`th vertex). */
function skinOf(doc, rig, step = 3) {
  for (const node of rig.order) {
    const skin = node.getSkin(), mesh = node.getMesh();
    if (!skin || !mesh) continue;
    const ibm = skin.listJoints().map((_, i) => new Matrix4().fromArray(Array.from(skin.getInverseBindMatrices().getElement(i, []))));
    const verts = [];
    for (const prim of mesh.listPrimitives()) {
      const P = prim.getAttribute('POSITION'), J = prim.getAttribute('JOINTS_0'), W = prim.getAttribute('WEIGHTS_0');
      for (let i = 0; i < P.getCount(); i += step) verts.push({ p: new Vector3().fromArray(P.getElement(i, [])), j: J.getElement(i, []), w: W.getElement(i, []) });
    }
    return { joints: skin.listJoints(), ibm, verts };
  }
  throw new Error('no skinned mesh');
}
function skinned(skin, world, filter) {
  const mats = skin.joints.map((j, i) => world.get(j).clone().multiply(skin.ibm[i]));
  const out = [], tmp = new Vector3();
  for (const v of skin.verts) {
    if (filter && !filter(v)) continue;
    const acc = new Vector3();
    for (let k = 0; k < 4; k++) if (v.w[k]) acc.add(tmp.copy(v.p).applyMatrix4(mats[v.j[k]]).multiplyScalar(v.w[k]));
    out.push(acc);
  }
  return out;
}
const lowest = (skin, world) => Math.min(...skinned(skin, world).map((p) => p.y));

/** Bake a uniform scale into a skinned doc: node translations, inverse bind matrices, positions. */
function scaleDoc(doc, k) {
  for (const n of doc.getRoot().listNodes()) n.setTranslation(n.getTranslation().map((v) => v * k));
  for (const skin of doc.getRoot().listSkins()) {
    const acc = skin.getInverseBindMatrices();
    const el = [];
    for (let i = 0; i < acc.getCount(); i++) {
      acc.getElement(i, el);
      el[12] *= k; el[13] *= k; el[14] *= k;
      acc.setElement(i, el);
    }
  }
  const done = new Set();
  for (const mesh of doc.getRoot().listMeshes()) for (const prim of mesh.listPrimitives()) {
    const P = prim.getAttribute('POSITION');
    if (done.has(P)) continue;
    done.add(P);
    const el = [];
    for (let i = 0; i < P.getCount(); i++) P.setElement(i, P.getElement(i, el).map((v) => v * k));
  }
}

/** Reference (rest) data of a rig: world matrices, rotations and positions at default TRS. */
function refOf(rig) {
  const world = worldOf(rig, null);
  return { world, rot: (n) => rotOf(world.get(n)), pos: (n) => posOf(world.get(n)) };
}

/** Per-target-joint rest alignment A_b for a source → target map. */
function align(map, S, T, sCentroid) {
  const C = new Map(), A = new Map(), pairs = [];
  for (const [tName, sName, tChild, sChild] of map) {
    const t = T.rig.byName.get(tName), s = S.rig.byName.get(sName);
    if (!t || !s) continue;
    let up = T.rig.parent.get(t);
    while (up && !C.has(up)) up = T.rig.parent.get(up);
    const inherit = up ? C.get(up).clone() : new Quaternion();
    let c = inherit;
    const tc = tChild && T.rig.byName.get(tChild);
    const sc = sChild === 'centroid' ? sCentroid(s) : sChild && S.ref.pos(S.rig.byName.get(sChild));
    if (tc && sc) {
      const dt = T.ref.pos(tc).sub(T.ref.pos(t)).normalize().applyQuaternion(inherit);
      const ds = sc.clone().sub(S.ref.pos(s)).normalize();
      c = new Quaternion().setFromUnitVectors(dt, ds).multiply(inherit);
    }
    C.set(t, c);
    A.set(t, c.clone().multiply(T.ref.rot(t)));
    pairs.push({ t, s });
  }
  return { A, pairs };
}

function rigData(doc) {
  const rig = rigOf(doc);
  return { doc, rig, ref: refOf(rig), skin: skinOf(doc, rig) };
}

/**
 * Retarget one source pose. Returns the target's local pose (Map node → {r, t?}) and its world.
 * `fixed` holds constant local rotations (the finger grip); `hips(world)` returns the hips' world
 * position for a first-pass world, or null to leave the hips' translation alone.
 */
function retargetPose(S, T, al, srcWorld, fixed, hips) {
  const D = new Map();
  for (const { t, s } of al.pairs) D.set(t, rotOf(srcWorld.get(s)).multiply(S.ref.rot(s).invert()));
  const hipsNode = T.rig.byName.get(M('Hips'));
  const build = (hipsPos) => {
    const pose = new Map(), world = new Map();
    for (const n of T.rig.order) {
      const parent = T.rig.parent.get(n);
      const pw = parent ? world.get(parent) : new Matrix4();
      const t = new Vector3().fromArray(n.getTranslation()), s = new Vector3().fromArray(n.getScale());
      let r = new Quaternion().fromArray(n.getRotation());
      const entry = {};
      if (D.has(n)) {
        r = rotOf(pw).invert().multiply(D.get(n).clone().multiply(al.A.get(n)));
        entry.r = r;
      } else if (fixed?.has(n.getName())) {
        r = fixed.get(n.getName()).clone();
        entry.r = r;
      }
      if (n === hipsNode && hipsPos) {
        t.copy(hipsPos.clone().applyMatrix4(pw.clone().invert()));
        entry.t = t;
      }
      if (entry.r || entry.t) pose.set(n, entry);
      world.set(n, pw.clone().multiply(new Matrix4().compose(t, r, s)));
    }
    return { pose, world };
  };
  let out = build(null);
  if (hips) out = build(hips(out.world));
  return out;
}

function addClip(doc, name, times, frames, nodes) {
  const buffer = doc.getRoot().listBuffers()[0];
  const anim = doc.createAnimation(name);
  const input = doc.createAccessor(`${name}_t`).setType('SCALAR').setArray(new Float32Array(times)).setBuffer(buffer);
  for (const node of nodes) {
    for (const path of ['rotation', 'translation']) {
      const key = path === 'rotation' ? 'r' : 't';
      if (!frames.every((f) => f.get(node)?.[key])) continue;
      const vals = [];
      let prev = null;
      for (const f of frames) {
        const v = f.get(node)[key];
        if (key === 'r') {
          const q = v.clone().normalize();
          if (prev && prev.dot(q) < 0) q.set(-q.x, -q.y, -q.z, -q.w);
          prev = q;
          vals.push(q.x, q.y, q.z, q.w);
        } else vals.push(v.x, v.y, v.z);
      }
      const output = doc.createAccessor(`${name}_${node.getName()}_${key}`).setType(key === 'r' ? 'VEC4' : 'VEC3').setArray(new Float32Array(vals)).setBuffer(buffer);
      const sampler = doc.createAnimationSampler().setInput(input).setOutput(output).setInterpolation('LINEAR');
      anim.addSampler(sampler).addChannel(doc.createAnimationChannel().setTargetNode(node).setTargetPath(path).setSampler(sampler));
    }
  }
  return anim;
}

/** Hand frame from joint positions: fingers, across the knuckles, palm normal; and hand length. */
function handFrame(world, rig, side) {
  const p = (n) => posOf(world.get(rig.byName.get(M(`${side}${n}`))));
  const h = p('Hand'), mid = p('HandMiddle1');
  const f = mid.clone().sub(h);
  const len = f.length();
  f.normalize();
  const s = p('HandIndex1').sub(p('HandRing1'));
  s.addScaledVector(f, -s.dot(f)).normalize();
  const n = new Vector3().crossVectors(f, s);
  return { h, f, s, n, len };
}

async function build(id) {
  const { src, out } = BODIES[id];
  const wiz = rigData(await io.read(WIZARD));
  const shooterDoc = await io.read(SHOOTER);
  const shooter = rigData(shooterDoc);
  const doc = await io.read(src);

  // Clean the hub body: its clips, morph targets (shirt sweeps the new clips never drive) and
  // meshes no scene node uses.
  for (const a of doc.getRoot().listAnimations()) a.dispose();
  for (const mesh of doc.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) for (const t of prim.listTargets()) t.dispose();
    mesh.setWeights([]);
  }
  const used = new Set(rigOf(doc).order.map((n) => n.getMesh()).filter(Boolean));
  for (const mesh of doc.getRoot().listMeshes()) if (!used.has(mesh)) mesh.dispose();

  // Scale to the wizard's height, feet on the floor.
  let T = rigData(doc);
  const ys = skinned(T.skin, T.ref.world).map((p) => p.y);
  const k = BODY_HEIGHT / (Math.max(...ys) - Math.min(...ys));
  scaleDoc(doc, k);
  T = rigData(doc);
  const floor = lowest(T.skin, T.ref.world);
  for (const n of doc.getRoot().getDefaultScene().listChildren()) n.setTranslation(n.getTranslation().map((v, i) => (i === 1 ? v - floor : v)));
  T = rigData(doc);
  const hipsT = T.rig.byName.get(M('Hips'));
  const tRest = T.ref.pos(hipsT);

  // Shooter Pepe → this body: `ready` (held as `aim`) and `shoot`; arms and fingers only.
  const shooterAl = align(SHOOTER_MAP, shooter, T, null);
  const clipOf = (d, name) => d.getRoot().listAnimations().find((a) => a.getName() === name);
  const ready = clipOf(shooterDoc, 'ready'), shoot = clipOf(shooterDoc, 'shoot');
  const readyPose = retargetPose(shooter, T, shooterAl, worldOf(shooter.rig, poseAt(ready, 0)), null, null);
  // The shooter's grip is barely curled (its guns hide the hand). Curl each finger further toward
  // the palm, then make that the fingers' default rotation: every clip then holds a gun without a
  // single finger channel.
  for (const side of SIDES) {
    // The palm is the side the shooter's fingers already bend toward.
    const hf = handFrame(readyPose.world, T.rig, side);
    const at = (n) => posOf(readyPose.world.get(T.rig.byName.get(M(`${side}Hand${n}`))));
    const palm = new Vector3();
    for (const f of ['Index', 'Middle', 'Ring']) {
      const bend = at(`${f}3`).sub(at(`${f}1`));
      palm.add(bend.addScaledVector(hf.f, -bend.dot(hf.f)));
    }
    palm.normalize();
    for (const [finger, angles] of Object.entries(CURL[side])) {
      angles.forEach((deg, i) => {
        const node = T.rig.byName.get(M(`${side}Hand${finger}${i + 1}`));
        if (!node) return;
        const W = rotOf(readyPose.world.get(node));
        const axis = new Vector3(0, 1, 0).applyQuaternion(W).cross(palm).normalize();
        const turn = new Quaternion().setFromAxisAngle(axis, (deg * Math.PI) / 180);
        const local = readyPose.pose.get(node).r.clone().multiply(W.clone().invert().multiply(turn).multiply(W));
        node.setRotation(local.toArray());
      });
    }
  }
  const upper = [...readyPose.pose.keys()].filter((n) => UPPER.test(n.getName()));

  const aimTimes = Array.from({ length: Math.round(AIM_SECONDS * FPS) + 1 }, (_, i) => i / FPS);
  addClip(doc, 'aim', aimTimes, aimTimes.map(() => readyPose.pose), upper);

  const shootEnd = durationOf(shoot);
  const shootTimes = Array.from({ length: Math.round(shootEnd * FPS) + 1 }, (_, i) => i / FPS);
  const shootFrames = shootTimes.map((t, i) => {
    const { pose } = retargetPose(shooter, T, shooterAl, worldOf(shooter.rig, poseAt(shoot, t)), null, null);
    const edge = Math.min(i, shootTimes.length - 1 - i);
    const w = edge >= SHOOT_EASE ? 0 : 1 - edge / SHOOT_EASE;
    if (w > 0) for (const n of upper) pose.get(n).r = pose.get(n).r.clone().slerp(readyPose.pose.get(n).r, w);
    return pose;
  });
  addClip(doc, 'shoot', shootTimes, shootFrames, upper);

  // Wizard → this body.
  const handCentroid = (s) => {
    const j = wiz.skin.joints.indexOf(s);
    const pts = skinned(wiz.skin, wiz.ref.world, (v) => v.j.some((jj, kk) => jj === j && v.w[kk] > 0.5));
    return pts.reduce((a, p) => a.add(p), new Vector3()).multiplyScalar(1 / pts.length);
  };
  const wizAl = align(WIZARD_MAP, wiz, T, handCentroid);
  const wHips = wiz.rig.byName.get('Hips');
  const wRest = wiz.ref.pos(wHips);
  const ratio = tRest.y / wRest.y;
  const idle = clipOf(wiz.doc, 'idle');
  const wizFloor = lowest(wiz.skin, worldOf(wiz.rig, poseAt(idle, 0)));
  const wizStandY = posOf(worldOf(wiz.rig, poseAt(idle, 0)).get(wHips)).y;
  const ride = clipOf(wiz.doc, 'ride');
  const wizSeatY = posOf(worldOf(wiz.rig, poseAt(ride, 0)).get(wHips)).y;
  const thigh = (rig, world) => (posOf(world.get(rig.byName.get(rig === wiz.rig ? 'LeftUpLeg' : M('LeftUpLeg')))).y + posOf(world.get(rig.byName.get(rig === wiz.rig ? 'RightUpLeg' : M('RightUpLeg')))).y) / 2;
  const report = { id, scale: +k.toFixed(4), hipsRatio: +ratio.toFixed(4), clips: {} };
  const bodyNodes = [...new Set(wizAl.pairs.map((p) => p.t))];

  for (const name of WIZARD_CLIPS) {
    const clip = clipOf(wiz.doc, name);
    // The wizard's own key times (24 fps), from its longest sampler: lengths stay exact.
    const times = Array.from(clip.listSamplers().map((sm) => sm.getInput().getArray()).reduce((a, b) => (b.length > a.length ? b : a)));
    const frames = [];
    let sink = 0;
    for (const t of times) {
      const sw = worldOf(wiz.rig, poseAt(clip, t));
      const sh = posOf(sw.get(wHips));
      const hips = (world) => {
        const p = new Vector3(tRest.x + (sh.x - wRest.x) * ratio, 0, tRest.z + (sh.z - wRest.z) * ratio);
        const hy = posOf(world.get(hipsT)).y;
        // Never below the floor: the wizard's roll and fall sink up to 16 cm, Pepe's head would too.
        const ground = hy + Math.max(0, lowest(wiz.skin, sw) - wizFloor) - lowest(T.skin, world);
        const seat = hy + thigh(wiz.rig, sw) - thigh(T.rig, world);
        const w = SEATED.has(name) ? Math.min(1, Math.max(0, (sh.y - wizStandY) / (wizSeatY - wizStandY))) : 0;
        p.y = ground + (seat - ground) * w;
        return p;
      };
      const { pose, world } = retargetPose(wiz, T, wizAl, sw, null, hips);
      sink = Math.min(sink, lowest(T.skin, world));
      frames.push(pose);
    }
    addClip(doc, name, times, frames, bodyNodes);
    report.clips[name] = { seconds: +times[times.length - 1].toFixed(4), keys: times.length, lowest: +sink.toFixed(3) };
  }
  report.clips.aim = { seconds: aimTimes[aimTimes.length - 1], keys: aimTimes.length, upperBodyOnly: true };
  report.clips.shoot = { seconds: +shootTimes[shootTimes.length - 1].toFixed(4), keys: shootTimes.length, upperBodyOnly: true };

  // socket_weapon: at the shooter's grip point (carried over in hand-relative terms), turned so
  // +Z is the character's forward and +Y up in the `aim` pose on its own (over the default hips and
  // legs). Over a clip whose hips turn (the wizard's idle stands 23° open), the gun turns with them.
  const sGrip = posOf(worldOf(shooter.rig, poseAt(ready, 0)).get(shooter.rig.byName.get('weapon_grip')));
  const sf = handFrame(worldOf(shooter.rig, poseAt(ready, 0)), shooter.rig, 'Right');
  const d = sGrip.clone().sub(sf.h);
  const c = [d.dot(sf.f) / sf.len, d.dot(sf.s) / sf.len, d.dot(sf.n) / sf.len];
  const tf = handFrame(readyPose.world, T.rig, 'Right');
  const at = tf.h.clone().addScaledVector(tf.f, c[0] * tf.len).addScaledVector(tf.s, c[1] * tf.len).addScaledVector(tf.n, c[2] * tf.len);
  const hand = T.rig.byName.get(M('RightHand'));
  const gripInHand = at.clone().applyMatrix4(readyPose.world.get(hand).clone().invert());
  const handWorld = worldOf(T.rig, poseAt(clipOf(doc, 'aim'), 0)).get(hand);
  const gripWorld = gripInHand.clone().applyMatrix4(handWorld);
  const local = handWorld.clone().invert().multiply(new Matrix4().compose(gripWorld, new Quaternion(), new Vector3(1, 1, 1)));
  const lt = new Vector3(), lr = new Quaternion(), ls = new Vector3();
  local.decompose(lt, lr, ls);
  const socket = doc.createNode('socket_weapon').setTranslation(lt.toArray()).setRotation(lr.toArray()).setScale(ls.toArray());
  socket.setExtras({
    contract: 'gun root here: origin = centre of the closed right fist (the grip), +Z along the barrel, +Y up from the top of the gun, metres. In the aim pose (aim at 0 s over the default hips and legs) +Z is the character\'s forward (world +Z) and +Y is world up; the gun turns with whatever hips the aim layer sits on. A gun authored with its grip at the origin and its barrel along +Z parents under it with an identity transform.',
    aimPoseWorld: { position: gripWorld.toArray().map((v) => +v.toFixed(4)) },
  });
  hand.addChild(socket);
  report.socket = { t: lt.toArray().map((v) => +v.toFixed(4)), r: lr.toArray().map((v) => +v.toFixed(4)), aimWorld: gripWorld.toArray().map((v) => +v.toFixed(4)) };

  await io.write(out, doc);
  console.log(JSON.stringify(report));
}

const ids = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(BODIES);
for (const id of ids) await build(id);
