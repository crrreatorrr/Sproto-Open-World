/**
 * Sproto Shooter's animations for every playable body (the three Mixamo class bodies through
 * retarget.mjs, the Wizard through wizard-gun-clips.mjs):
 *
 * - `aim`, `hold`, `shoot`, `reload`: upper-body layers. The stances are placed here (STANCES) and
 *   both arms reach the gun by IK; the shooter Pepe's `shoot` and `reload` clips supply the motion
 *   (the gun's kick, the gun's and the support hand's travel through a reload).
 * - `dash`: the shooter Pepe's `dash` stride, whole body.
 * - `slide`: the shooter's slide. There it is not a clip: `src/render/pvp/slidePose.js` builds a
 *   seated, one-leg-forward pose from the avatar's own limb lengths. The same construction runs
 *   here on each body and is written out as a held clip, over the body's standing `idle` arms.
 */
import { Matrix4, Quaternion, Vector3 } from 'three';
import { durationOf, posOf, poseAt, rotOf, worldOf } from './rig.mjs';
import { addClip, lowest, retargetPose, skinned } from './retarget.mjs';
import { BELT, reloadAt } from './reload-clips.mjs';

const FPS = 24;
/** The held layers' length (two keys). */
const AIM_SECONDS = 0.5;
/** `slide`: eased from standing over the first keys, then held. */
const SLIDE_SECONDS = 0.5;
const SLIDE_IN_KEYS = 3;

/** Joint names by rig: the Mixamo bodies, and sproto-duel's 24-joint wizard. */
export const JOINT = {
  mixamo: (n) => `mixamorig:${n}`,
  wizard: (n) => ({ Spine: 'Spine02', Spine1: 'Spine01', Spine2: 'Spine', Neck: 'neck' })[n] ?? n,
};

const clipOf = (doc, name) => doc.getRoot().listAnimations().find((a) => a.getName() === name);
const round = (v) => +v.toFixed(4);

/** World matrices for a pose whose entries hold three.js objects ({ r: Quaternion, t: Vector3 }). */
function worldOfPose(rig, pose) {
  const world = new Map();
  for (const n of rig.order) {
    const o = pose.get(n);
    const m = new Matrix4().compose(o?.t ?? new Vector3().fromArray(n.getTranslation()), o?.r ?? new Quaternion().fromArray(n.getRotation()), new Vector3().fromArray(n.getScale()));
    const p = rig.parent.get(n);
    world.set(n, p ? world.get(p).clone().multiply(m) : m);
  }
  return world;
}

/**
 * The body a gun and the arms must stay out of: the torso and head as a stack of ellipses, one per
 * 3 cm band. Returns a function of a pose's world matrices.
 */
function bodyShape(T, J) {
  const node = (n) => T.rig.byName.get(J(n));
  const coreJoints = new Set(['Hips', 'Spine', 'Spine1', 'Spine2', 'Neck', 'Head'].map((n) => T.skin.joints.indexOf(node(n))));
  const isCore = (v) => coreJoints.has(v.j[v.w.indexOf(Math.max(...v.w))]);
  return (world) => {
    const bands = new Map();
    for (const p of skinned(T.skin, world, isCore)) {
      const key = Math.floor(p.y / BAND);
      if (!bands.has(key)) bands.set(key, []);
      bands.get(key).push(p);
    }
    const shape = new Map();
    for (const [key, pts] of bands) {
      const cx = pts.reduce((sum, p) => sum + p.x, 0) / pts.length, cz = pts.reduce((sum, p) => sum + p.z, 0) / pts.length;
      shape.set(key, { cx, cz, rx: Math.max(...pts.map((p) => Math.abs(p.x - cx))), front: Math.max(...pts.map((p) => p.z - cz)), back: Math.max(...pts.map((p) => cz - p.z)) });
    }
    const near = (p) => [-1, 0, 1].map((d) => shape.get(Math.floor(p.y / BAND) + d)).filter(Boolean);
    /** How far forward `p` (a sphere of `radius`) must move to clear the body's front; 0 if it is clear. */
    const forward = (p, radius) => {
      let need = 0;
      for (const e of near(p)) {
        const u = (p.x - e.cx) / (e.rx + radius);
        if (Math.abs(u) >= 1 || p.z < e.cz - e.back) continue;
        need = Math.max(need, e.cz + (e.front + radius) * Math.sqrt(1 - u * u) - p.z);
      }
      return need;
    };
    /** How far out to its own side `p` must move to clear the body's flank; 0 if it is clear. */
    const sideways = (p, radius) => {
      let need = 0;
      for (const e of near(p)) {
        const depth = (p.z >= e.cz ? e.front : e.back) + radius;
        const v = (p.z - e.cz) / depth;
        if (Math.abs(v) >= 1) continue;
        need = Math.max(need, (e.rx + radius) * Math.sqrt(1 - v * v) - Math.abs(p.x - e.cx));
      }
      return need;
    };
    return { forward, sideways };
  };
}

/**
 * Gun stances. The gun is placed in the body's frame and both arms reach it by two-bone IK, so the
 * hold is the same on every body whatever its proportions (a rotation-only retarget of the shooter
 * Pepe's `ready` leaves a short-armed body's support hand in the air).
 *
 * `at`: the grip, from the right shoulder, in right-arm lengths (in = toward the body's centre line,
 * up, fwd). `yaw` (toward the body's left), `pitch` (muzzle down) and `roll` (top toward the body's
 * left) turn the barrel, degrees. `lean`, `headPitch`, `headRoll`: the chest leaning into the gun and
 * the head coming down to the sights, degrees.
 */
const STANCES = {
  // Shouldered, eye behind the sights: where shots come from.
  aim: { at: [0.16, -0.16, 0.5], yaw: 0, pitch: 0, roll: 0, lean: 7, headPitch: 3, headRoll: -7 },
  // The ready hold between shots and on the move: stock under the arm, muzzle down across the body.
  hold: { at: [0.22, -0.54, 0.34], yaw: 30, pitch: 36, roll: 12, lean: 2, headPitch: 0, headRoll: 0 },
  // Reloading: the gun comes up in front of the chest, tipped so the magazine well faces the support hand.
  reload: { at: [0.24, -0.62, 0.38], yaw: 24, pitch: -4, roll: 26, lean: 4, headPitch: 12, headRoll: 0 },
  // One-handed, for the sidearms (the dual-wield guns): the other arm stays where standing leaves it.
  // Carried low at the side, raised at arm's length to aim; a reload brings both hands together.
  hold_1h: { at: [0.02, -0.86, 0.2], yaw: 4, pitch: 52, roll: 0, lean: 0, headPitch: 0, headRoll: 0, oneHand: true },
  aim_1h: { at: [0.1, -0.1, 0.9], yaw: 0, pitch: 0, roll: 0, lean: 3, headPitch: 2, headRoll: -3, oneHand: true },
  reload_1h: { at: [0.22, -0.5, 0.42], yaw: 14, pitch: -22, roll: 20, lean: 3, headPitch: 12, headRoll: 0, support: { fwd: 0.0, up: -0.07 } },
  // Akimbo: a sidearm in each hand, both arms out in front at chest height, elbows bent, the guns
  // canted in a little. One stance for carrying and firing (two guns have no sights to come up to).
  dual: { at: [0.02, -0.34, 0.74], yaw: 3, pitch: 0, roll: 12, lean: 6, headPitch: 2, headRoll: 0, dual: true },
  // Both guns tipped up and in to reload.
  dual_reload: { at: [0.12, -0.42, 0.5], yaw: 10, pitch: -38, roll: 20, lean: 4, headPitch: 10, headRoll: 0, dual: true },
};
/** The support hand's place on the gun: metres ahead of the grip along the barrel, and above it. */
const SUPPORT = { fwd: 0.27, up: 0.015 };
/** The shooter's recoil travel, scaled by arm length and then by this. */
const SHOOT_GAIN = 1.6;
/**
 * Keeping the gun and arms out of the body. The body is the torso and head as 3 cm bands, each an
 * ellipse; the gun is spheres along its barrel (metres ahead of the grip, above it) and one at the
 * magazine; a limb is a sphere of this radius at an arm 0.5 m long.
 */
const BAND = 0.03;
const GUN_SAMPLES = [[-0.2, 0.03], [-0.12, 0.03], [-0.04, 0.03], [0.06, 0.03], [0.16, 0.03], [0.28, 0.03], [0.4, 0.03], [0.1, -0.1]];
const GUN_RADIUS = 0.04;
const LIMB_RADIUS = 0.04;
const CLEAR_STEPS = 24;
/** The fit's moves: [which, step, most]. Metres, and the elbow pole's outward weight. */
const FIT_STEPS = [['fwd', 0.03, 0.3], ['out', 0.03, 0.24], ['down', 0.03, 0.24], ['flare', 0.3, 1.2]];
const CLEAR_SLOP = 0.004;
const RAD = Math.PI / 180;
/** The body faces +Z with +Y up, so its left is +X. */
const LEFT = new Vector3(1, 0, 0), UP = new Vector3(0, 1, 0), FWD = new Vector3(0, 0, 1);

/** A pose editor over a Map pose (node → { r, t }): world-space turns, written back as local rotations. */
function editor(T, pose) {
  let world = worldOfPose(T.rig, pose);
  const refresh = () => { world = worldOfPose(T.rig, pose); };
  const at = (n) => posOf(world.get(n));
  const parentRot = (n) => (T.rig.parent.get(n) ? rotOf(world.get(T.rig.parent.get(n))) : new Quaternion());
  const setWorldRot = (n, q) => {
    pose.set(n, { ...pose.get(n), r: parentRot(n).invert().multiply(q) });
    refresh();
  };
  const rotateWorld = (n, q) => setWorldRot(n, q.clone().multiply(rotOf(world.get(n))));
  /** Turn `n` so the direction from it to `from` becomes the direction to `to`. */
  const aim = (n, from, to) => {
    const p = at(n);
    rotateWorld(n, new Quaternion().setFromUnitVectors(from.clone().sub(p).normalize(), to.clone().sub(p).normalize()));
  };
  /** Two-bone IK: the wrist goes to `target` (as far as the arm reaches), the elbow toward `pole`. */
  const reach = (upper, lower, hand, target, pole) => {
    const start = at(upper);
    const a = start.distanceTo(at(lower)), b = at(lower).distanceTo(at(hand));
    const dir = target.clone().sub(start);
    const dist = Math.min(Math.max(dir.length(), Math.abs(a - b) + 1e-4), (a + b) * 0.999);
    dir.normalize();
    const along = (a * a - b * b + dist * dist) / (2 * dist);
    const bend = pole.clone().addScaledVector(dir, -pole.dot(dir)).normalize();
    aim(upper, at(lower), start.clone().addScaledVector(dir, along).addScaledVector(bend, Math.sqrt(Math.max(0, a * a - along * along))));
    aim(lower, at(hand), start.clone().addScaledVector(dir, dist));
  };
  return { at, world: () => world, setWorldRot, rotateWorld, aim, reach };
}

/**
 * `aim`, `hold`, `shoot` and `reload` on `upper` (the layer's joints). `socket` is the body's
 * `socket_weapon` (under its right hand). The shooter Pepe's clips supply the motion: how its gun
 * kicks from its `ready` pose in `shoot`, and how its gun and support hand travel in `reload`.
 * Returns the report entries.
 */
export function addGunLayers(doc, shooter, T, al, upper, readyPose, socket, rigKind, idle0, socketL) {
  const J = JOINT[rigKind];
  const node = (n) => T.rig.byName.get(J(n));
  const arms = Object.fromEntries(['Left', 'Right'].map((s) => [s, ['Arm', 'ForeArm', 'Hand'].map((p) => node(s + p))]));
  const socketLocal = new Matrix4().compose(new Vector3().fromArray(socket.getTranslation()), new Quaternion().fromArray(socket.getRotation()), new Vector3().fromArray(socket.getScale()));
  const localOf = (n) => new Matrix4().compose(new Vector3().fromArray(n.getTranslation()), new Quaternion().fromArray(n.getRotation()), new Vector3().fromArray(n.getScale()));
  const socketLLocal = socketL ? localOf(socketL) : null;
  const base = () => new Map(upper.map((n) => [n, { r: readyPose.pose.get(n).r.clone() }]));
  // The support hand's turn relative to the gun, from the retargeted `ready` grip.
  const gunReady = readyPose.world.get(arms.Right[2]).clone().multiply(socketLocal);
  const supportRot = rotOf(gunReady).invert().multiply(rotOf(readyPose.world.get(arms.Left[2])));
  const armLength = (rig, world, name) => {
    const [u, l, h] = ['Arm', 'ForeArm', 'Hand'].map((p) => posOf(world.get(rig.byName.get(name(`Right${p}`)))));
    return u.distanceTo(l) + l.distanceTo(h);
  };
  const L = armLength(T.rig, T.ref.world, J);
  const k = L / armLength(shooter.rig, shooter.ref.world, JOINT.mixamo);

  const bodyOf = bodyShape(T, J);

  /**
   * One frame: the stance, moved by `gun` ({ p, q }: a world-space shift and turn of the gun) and
   * `support` ({ p, q }: the support hand's shift and turn in the gun's frame). `fit` moves the grip
   * (`fwd`, `out` toward the gun side, `down`, metres) and swings the elbows out (`flare`).
   */
  const attempt = (stance, gun, support, fit, gunL) => {
    const flare = fit.flare;
    const pose = base();
    const ed = editor(T, pose);
    const right = LEFT.clone().negate();
    ed.rotateWorld(node('Spine1'), new Quaternion().setFromAxisAngle(LEFT, stance.lean * RAD));
    if (stance.twist) ed.rotateWorld(node('Spine'), new Quaternion().setFromAxisAngle(UP, stance.twist * RAD));
    ed.rotateWorld(node('Head'), new Quaternion().setFromAxisAngle(LEFT, stance.headPitch * RAD).multiply(new Quaternion().setFromAxisAngle(FWD, stance.headRoll * RAD)));
    const [ru, rl, rh] = arms.Right, [lu, ll, lh] = arms.Left;
    const gripAt = ed.at(ru).addScaledVector(LEFT, stance.at[0] * L).addScaledVector(UP, stance.at[1] * L).addScaledVector(FWD, stance.at[2] * L)
      .addScaledVector(FWD, fit.fwd).addScaledVector(LEFT, -fit.out).addScaledVector(UP, -fit.down);
    let gunRot = new Quaternion().setFromAxisAngle(UP, stance.yaw * RAD)
      .multiply(new Quaternion().setFromAxisAngle(LEFT, stance.pitch * RAD))
      .multiply(new Quaternion().setFromAxisAngle(FWD, -stance.roll * RAD));
    if (gun) {
      gripAt.add(gun.p);
      gunRot = gun.q.clone().multiply(gunRot);
    }
    // Right hand: where the socket puts the gun on the wanted grip.
    const handWant = new Matrix4().compose(gripAt, gunRot, new Vector3(1, 1, 1)).multiply(socketLocal.clone().invert());
    ed.reach(ru, rl, rh, posOf(handWant), UP.clone().negate().addScaledVector(right, 0.55 + flare).addScaledVector(FWD, -0.25));
    ed.setWorldRot(rh, rotOf(handWant));
    // The gun where the hand really got to (a short arm may not reach the stance).
    const gunWorld = ed.world().get(rh).clone().multiply(socketLocal);
    const gp = posOf(gunWorld), gq = rotOf(gunWorld);
    const axis = (v) => v.clone().applyQuaternion(gq);
    let offhand = null;
    if (stance.dual) {
      // The other gun, mirrored: its own hand puts `socket_weapon_l` on its grip.
      const gripL = ed.at(lu).addScaledVector(LEFT, -stance.at[0] * L).addScaledVector(UP, stance.at[1] * L).addScaledVector(FWD, stance.at[2] * L)
        .addScaledVector(FWD, fit.fwd).addScaledVector(LEFT, fit.out).addScaledVector(UP, -fit.down);
      let rotL = new Quaternion().setFromAxisAngle(UP, -stance.yaw * RAD)
        .multiply(new Quaternion().setFromAxisAngle(LEFT, stance.pitch * RAD))
        .multiply(new Quaternion().setFromAxisAngle(FWD, stance.roll * RAD));
      if (gunL) {
        gripL.add(gunL.p);
        rotL = gunL.q.clone().multiply(rotL);
      }
      const wantL = new Matrix4().compose(gripL, rotL, new Vector3(1, 1, 1)).multiply(socketLLocal.clone().invert());
      ed.reach(lu, ll, lh, posOf(wantL), UP.clone().negate().addScaledVector(LEFT, 0.55 + flare).addScaledVector(FWD, -0.25));
      ed.setWorldRot(lh, rotOf(wantL));
      offhand = ed.world().get(lh).clone().multiply(socketLLocal);
    } else if (stance.oneHand) {
      // The free arm hangs as it does standing (the layer has to drive it: the legs' clip no longer does).
      for (const part of ['Shoulder', 'Arm', 'ForeArm', 'Hand']) {
        const joint = node(`Left${part}`);
        const stand = idle0?.get(joint)?.r;
        if (stand) pose.set(joint, { r: stand.clone() });
      }
    } else {
      // Support hand: on the handguard, pulled back toward the grip if the arm is too short.
      const place = stance.support ?? SUPPORT;
      const reachL = ed.at(lu).distanceTo(ed.at(ll)) + ed.at(ll).distanceTo(ed.at(lh));
      let want = null;
      for (let fwd = place.fwd; fwd >= Math.min(0.1, place.fwd); fwd -= 0.02) {
        want = gp.clone().addScaledVector(axis(FWD), fwd).addScaledVector(axis(UP), place.up);
        if (support) want.add(support.p.clone().applyQuaternion(gq));
        if (support || want.distanceTo(ed.at(lu)) <= reachL * 0.97) break;
      }
      if (support?.at) want.lerp(support.at, support.belt);
      const supportWorld = gq.clone().multiply(support ? support.q.clone().multiply(supportRot) : supportRot);
      // The wrist sits behind the palm: back it off along the hand so the palm lands on the gun.
      const palm = new Vector3(0, 1, 0).applyQuaternion(supportWorld).multiplyScalar(0.07 * (L / 0.5));
      ed.reach(lu, ll, lh, want.sub(palm), UP.clone().negate().addScaledVector(LEFT, 0.45 + flare).addScaledVector(FWD, -0.1));
      ed.setWorldRot(lh, supportWorld);
    }

    // What is inside the body: the gun and forearms (they move forward), the elbows (they swing out).
    const posed = editor(T, pose);
    const body = bodyOf(posed.world());
    const limb = LIMB_RADIUS * (L / 0.5);
    let forward = 0;
    for (const held of offhand ? [gunWorld, offhand] : [gunWorld]) {
      const at = posOf(held), q = rotOf(held);
      for (const [z, y] of GUN_SAMPLES) forward = Math.max(forward, body.forward(at.clone().addScaledVector(FWD.clone().applyQuaternion(q), z).addScaledVector(UP.clone().applyQuaternion(q), y), GUN_RADIUS));
    }
    let elbows = 0;
    for (const [, lower, hand] of stance.oneHand ? [arms.Right] : [arms.Right, arms.Left]) {
      forward = Math.max(forward, body.forward(posed.at(hand), limb), body.forward(posed.at(lower).lerp(posed.at(hand), 0.5), limb));
      elbows = Math.max(elbows, body.forward(posed.at(lower), limb * 0.6));
    }
    return { pose, forward, elbows };
  };
  /**
   * Where a stance fits this body: from where it is placed, the grip moves a step at a time (forward,
   * out to the gun side, down, or the elbows out; whichever clears the most) until nothing is inside
   * the body or no step helps. A slim body keeps the stance as placed; a wide one with short arms
   * (Pepe) carries the gun further out and lower. Found once per stance, so a clip's frames agree.
   */
  const fits = new Map();
  const fitOf = (stance) => {
    if (fits.has(stance)) return fits.get(stance);
    const inside = (o) => o.forward + o.elbows;
    let fit = { fwd: 0, out: 0, down: 0, flare: 0 };
    let out = attempt(stance, null, null, fit);
    for (let i = 0; i < CLEAR_STEPS && inside(out) > CLEAR_SLOP; i++) {
      let best = null;
      for (const [k, step, max] of FIT_STEPS) {
        if (fit[k] + step > max + 1e-9) continue;
        const tryFit = { ...fit, [k]: fit[k] + step };
        const got = attempt(stance, null, null, tryFit);
        if (!best || inside(got) < inside(best.got)) best = { fit: tryFit, got };
      }
      if (!best || inside(best.got) > inside(out) - 1e-4) break;
      fit = best.fit;
      out = best.got;
    }
    fits.set(stance, fit);
    fitted.push({ ...Object.fromEntries(Object.entries(fit).map(([k, v]) => [k, round(v)])), gunInBody: round(out.forward), elbowInBody: round(out.elbows) });
    return fit;
  };
  const fitted = [];
  const solve = (stance, gun, support, gunL) => attempt(stance, gun, support, fitOf(stance), gunL).pose;
  /** The same gun motion on the other side of the body. */
  const mirrored = (m) => ({ p: new Vector3(-m.p.x, m.p.y, m.p.z), q: new Quaternion(m.q.x, -m.q.y, -m.q.z, m.q.w) });

  // The shooter's gun frame (grip position, hand rotation) and support hand, relative to its `ready`.
  const sNode = (n) => shooter.rig.byName.get(n);
  const frameOf = (world) => {
    const q = rotOf(world.get(sNode(JOINT.mixamo('RightHand'))));
    const p = posOf(world.get(sNode('weapon_grip')));
    const lw = world.get(sNode(JOINT.mixamo('LeftHand')));
    const inv = q.clone().invert();
    return { p, q, lp: posOf(lw).sub(p).applyQuaternion(inv), lq: inv.clone().multiply(rotOf(lw)) };
  };
  const ready = frameOf(worldOf(shooter.rig, poseAt(clipOf(shooter.doc, 'ready'), 0)));
  const motionAt = (clip, t, gain) => {
    const f = frameOf(worldOf(shooter.rig, poseAt(clip, t)));
    const turn = new Quaternion().slerp(f.q.clone().multiply(ready.q.clone().invert()), Math.min(1, gain));
    return {
      gun: { p: f.p.clone().sub(ready.p).multiplyScalar(k * gain), q: turn },
      // The support hand's own travel (off the gun to the magazine and back) is kept whole.
      support: { p: f.lp.clone().sub(ready.lp).multiplyScalar(k), q: f.lq.clone().multiply(ready.lq.clone().invert()) },
    };
  };

  /** A held pose: two keys are all it takes. */
  const held = (name) => {
    const times = [0, AIM_SECONDS];
    const pose = solve(STANCES[name]);
    addClip(doc, name, times, times.map(() => pose), upper);
    return { seconds: AIM_SECONDS, keys: times.length, upperBodyOnly: true };
  };
  /** `hands`: which gun the shooter's motion plays on ('right', 'left' or 'both'; the left one mirrored). */
  const moving = (name, from, fps, stance, gain, supportMoves, hands = 'right') => {
    const clip = clipOf(shooter.doc, from);
    const times = Array.from({ length: Math.round(durationOf(clip) * fps) + 1 }, (_, i) => i / fps);
    const frames = times.map((t) => {
      const m = motionAt(clip, t, gain);
      return solve(stance, hands === 'left' ? null : m.gun, supportMoves ? m.support : null, hands === 'right' ? null : mirrored(m.gun));
    });
    addClip(doc, name, times, frames, upper);
    return { seconds: round(times[times.length - 1]), keys: times.length, upperBodyOnly: true };
  };
  /**
   * A reload: the keyed motion of reload-clips.mjs (staged for a third-person camera) on its stance,
   * as long as the shooter's own `reload` so the game's timing of it is unchanged.
   */
  /** `hands`: for a pair, which gun reloads ('both', or 'right' / 'left' while the other stays up). */
  const reloading = (name, stance, kind, hands = 'both') => {
    const seconds = durationOf(clipOf(shooter.doc, 'reload'));
    const belt = T.ref.pos(node('LeftUpLeg')).addScaledVector(LEFT, BELT[0] * (L / 0.5)).addScaledVector(UP, BELT[1] * (L / 0.5)).addScaledVector(FWD, BELT[2] * (L / 0.5));
    // On a wide body the pouch sits on the flank, not inside it: out until the hand clears the side,
    // which is also what lets a camera behind the body see the hand get there.
    const flank = bodyOf(T.ref.world);
    for (let n = 0; n < 20 && flank.sideways(belt, LIMB_RADIUS * (L / 0.5) * 1.5) > CLEAR_SLOP; n++) belt.addScaledVector(LEFT, 0.015);
    // 12 even steps (10 fps at 1.2 s): the beats are eased and about a tenth of the clip apart, and the
    // class bodies' files are at their size cap.
    const times = Array.from({ length: 13 }, (_, i) => (seconds * i) / 12);
    const frames = times.map((t) => {
      const m = reloadAt(kind, t / seconds, L / 0.5);
      // The belt is on the body: the hand's way there is a place in the world, not on the gun.
      m.support.at = belt;
      // The torso and head go with the hands; the stance's fit to this body is the plain stance's.
      const moved = { ...stance, lean: stance.lean + m.body.lean, headPitch: stance.headPitch + m.body.head, twist: m.body.twist };
      fits.set(moved, fitOf(stance));
      return solve(moved, stance.dual && hands === 'left' ? null : m.gun, stance.dual ? null : m.support, stance.dual && hands !== 'right' ? m.mirror : null);
    });
    addClip(doc, name, times, frames, upper);
    return { seconds: round(seconds), keys: times.length, upperBodyOnly: true, keyed: kind };
  };
  const clips = {
    aim: held('aim'),
    hold: held('hold'),
    shoot: moving('shoot', 'shoot', FPS, STANCES.aim, SHOOT_GAIN, false),
    reload: reloading('reload', STANCES.reload, 'long'),
    hold_1h: held('hold_1h'),
    aim_1h: held('aim_1h'),
    // A pistol kicks harder in one hand than a shouldered rifle does.
    shoot_1h: moving('shoot_1h', 'shoot', FPS, STANCES.aim_1h, SHOOT_GAIN * 1.5, false),
    reload_1h: reloading('reload_1h', STANCES.reload_1h, 'sidearm'),
  };
  if (socketLLocal) {
    Object.assign(clips, {
      dual: held('dual'),
      dual_shoot_r: moving('dual_shoot_r', 'shoot', FPS, STANCES.dual, SHOOT_GAIN * 1.5, false, 'right'),
      dual_shoot_l: moving('dual_shoot_l', 'shoot', FPS, STANCES.dual, SHOOT_GAIN * 1.5, false, 'left'),
      dual_reload: reloading('dual_reload', STANCES.dual_reload, 'akimbo'),
      // Each gun has its own trigger and its own magazine: one hand reloads while the other stays up.
      dual_reload_r: reloading('dual_reload_r', STANCES.dual, 'akimbo', 'right'),
      dual_reload_l: reloading('dual_reload_l', STANCES.dual, 'akimbo', 'left'),
    });
  }
  // How each stance (aim, hold, reload) was moved to fit this body, and what is still inside it (m).
  clips.fit = fitted;
  return clips;
}

/** `naturalStance`: the feet's turn-out (degrees), and how straight a standing leg may get. */
const TOE_OUT = 5;
const LEG_STRAIGHT = 0.985;
/** The feet stand this much wider than the hip joints. */
const STANCE_WIDTH = 1.12;

/**
 * Standing frames set on a natural stance: the hips and chest face straight ahead, the hips sit
 * over the feet, and the feet stand parallel under the hip joints, flat on the floor. The wizard's
 * `idle` stands a quarter turn open with its feet wide and splayed (a staff fighter's stance), which
 * reads as a pose rather than as standing, and leaves a gun pointing off to the side. Everything
 * above the hips keeps its own motion (the breathing, the arms), but for the staff hand's wrist.
 */
export function naturalStance(T, rigKind, frames, staffRot) {
  const bodyOf = bodyShape(T, JOINT[rigKind]);
  const J = JOINT[rigKind];
  const node = (n) => T.rig.byName.get(J(n));
  const hips = node('Hips'), spine = node('Spine'), chest = node('Spine2');
  const hipsParent = T.rig.parent.get(hips);
  const legs = ['Left', 'Right'].map((side) => ['UpLeg', 'Leg', 'Foot'].map((part) => node(side + part)));
  const restHips = T.ref.pos(hips);
  const restFoot = legs.map(([, , foot]) => ({ at: T.ref.pos(foot), rot: T.ref.rot(foot) }));
  const yawFrom = (q, rest) => {
    const f = FWD.clone().applyQuaternion(q.clone().multiply(rest.clone().invert()));
    return Math.atan2(f.x, f.z);
  };
  return frames.map((frame) => {
    const pose = new Map([...frame].map(([n, e]) => [n, { ...e }]));
    const ed = editor(T, pose);
    const worldRot = (n) => rotOf(ed.world().get(n));
    ed.rotateWorld(hips, new Quaternion().setFromAxisAngle(UP, -yawFrom(worldRot(hips), T.ref.rot(hips))));
    ed.rotateWorld(spine, new Quaternion().setFromAxisAngle(UP, -yawFrom(worldRot(chest), T.ref.rot(chest))));
    // The feet's places, then the hips over them, low enough that neither knee locks.
    const sides = legs.map(([thigh, shin, foot], i) => {
      const a = ed.at(thigh).distanceTo(ed.at(shin)), b = ed.at(shin).distanceTo(ed.at(foot));
      const x = (ed.at(thigh).x - ed.at(hips).x) * STANCE_WIDTH + restHips.x;
      return { thigh, shin, foot, reach: (a + b) * LEG_STRAIGHT, target: new Vector3(x, restFoot[i].at.y, restFoot[i].at.z), rest: restFoot[i].rot, out: i === 0 ? 1 : -1 };
    });
    const at = ed.at(hips);
    at.x = restHips.x;
    at.z = restHips.z;
    for (const leg of sides) {
      const joint = ed.at(leg.thigh).sub(ed.at(hips)).add(at);
      const flat = Math.hypot(leg.target.x - joint.x, leg.target.z - joint.z);
      at.y -= Math.max(0, joint.y - leg.target.y - Math.sqrt(Math.max(0, leg.reach * leg.reach - flat * flat)));
    }
    pose.get(hips).t = hipsParent ? at.applyMatrix4(ed.world().get(hipsParent).clone().invert()) : at;
    const stand = editor(T, pose);
    for (const leg of sides) {
      stand.reach(leg.thigh, leg.shin, leg.foot, leg.target, FWD.clone().addScaledVector(LEFT, leg.out * 0.12));
      stand.setWorldRot(leg.foot, new Quaternion().setFromAxisAngle(UP, leg.out * TOE_OUT * RAD).multiply(leg.rest));
    }
    // The free arm hangs beside the body, the hand by the thigh: straight down from the shoulder, as
    // far out as the flank needs (a wide body's arm rests on it rather than sinking in), the elbow a
    // touch bent and behind. The source idle holds it out from the side like a pose half struck.
    {
      const [upper, lower, hand] = ['Arm', 'ForeArm', 'Hand'].map((part) => node(`Left${part}`));
      const reach = stand.at(upper).distanceTo(stand.at(lower)) + stand.at(lower).distanceTo(stand.at(hand));
      const limb = LIMB_RADIUS * (reach / 0.5);
      const body = bodyOf(stand.world());
      const target = stand.at(upper).addScaledVector(UP, -reach * 0.96).addScaledVector(FWD, reach * 0.1);
      for (let i = 0; i < 12; i++) {
        const mid = stand.at(upper).lerp(target, 0.55);
        const need = Math.max(body.sideways(target, limb), body.sideways(mid, limb));
        if (need < CLEAR_SLOP) break;
        target.addScaledVector(LEFT, Math.min(need, 0.03));
      }
      stand.reach(upper, lower, hand, target, FWD.clone().negate().addScaledVector(LEFT, 0.3));
    }
    // The staff stands straight up in the fist: the wrist turns until the shaft (`staffRot`, the staff
    // socket's turn in the hand) is vertical. The source idle carries it a few degrees off, which on
    // these bodies reads as the staff slipping through the fingers.
    if (staffRot) {
      const hand = node('RightHand');
      const shaft = new Vector3(0, 1, 0).applyQuaternion(rotOf(stand.world().get(hand)).multiply(staffRot));
      stand.rotateWorld(hand, new Quaternion().setFromUnitVectors(shaft, UP));
    }
    return pose;
  });
}

/**
 * The shooter's slide on `T`, from its rest pose: hips down and back, spine leaning back, head
 * level, the left leg out in front and the right one folded under. Returns the joints it poses.
 */
function slideJoints(T, J) {
  const node = (n) => T.rig.byName.get(J(n));
  const hips = node('Hips'), spine = node('Spine1'), head = node('Head');
  const legs = ['Left', 'Right'].map((side) => ['UpLeg', 'Leg', 'Foot'].map((part) => node(side + part)));
  const pose = new Map();
  let world = worldOfPose(T.rig, pose);
  const refresh = () => { world = worldOfPose(T.rig, pose); };
  const at = (n) => posOf(world.get(n));
  const parentRot = (n) => (T.rig.parent.get(n) ? rotOf(world.get(T.rig.parent.get(n))) : new Quaternion());
  const setWorldRot = (n, q) => {
    pose.set(n, { ...pose.get(n), r: parentRot(n).invert().multiply(q) });
    refresh();
  };
  const rotateWorld = (n, q) => setWorldRot(n, q.clone().multiply(rotOf(world.get(n))));
  /** Turn `n` so the direction from it to `from` becomes the direction to `to`. */
  const aim = (n, from, to) => {
    const p = at(n);
    rotateWorld(n, new Quaternion().setFromUnitVectors(from.clone().sub(p).normalize(), to.clone().sub(p).normalize()));
  };

  const right = new Vector3(1, 0, 0), up = new Vector3(0, 1, 0), forward = new Vector3(0, 0, 1);
  const ankle = legs.map(([, , foot]) => at(foot));
  const footQ = legs.map(([, , foot]) => rotOf(world.get(foot)));
  const span = at(legs[0][0]).distanceTo(ankle[0]);

  const hipsAt = at(hips).addScaledVector(up, -0.55 * span).addScaledVector(forward, -0.11 * span);
  const hipsParent = T.rig.parent.get(hips);
  pose.set(hips, { t: hipsParent ? hipsAt.applyMatrix4(world.get(hipsParent).clone().invert()) : hipsAt });
  refresh();
  rotateWorld(hips, new Quaternion().setFromAxisAngle(forward, -0.10));
  rotateWorld(spine, new Quaternion().setFromAxisAngle(right, -0.33));
  rotateWorld(head, new Quaternion().setFromAxisAngle(right, 0.27));

  legs.forEach(([thigh, shin, foot], i) => {
    const lead = i === 0;
    const start = at(thigh), knee = at(shin), end = at(foot);
    const a = start.distanceTo(knee), b = knee.distanceTo(end);
    const direction = ankle[i].clone()
      .addScaledVector(forward, span * (lead ? 0.73 : -0.19))
      .addScaledVector(right, span * (lead ? 0.03 : -0.26))
      .addScaledVector(up, span * (lead ? 0.015 : 0.10))
      .sub(start);
    const distance = Math.min(Math.max(direction.length(), Math.abs(a - b) + 0.001), a + b - 0.001);
    direction.normalize();
    const along = (a * a - b * b + distance * distance) / (2 * distance);
    const pole = forward.clone().addScaledVector(right, lead ? 0.24 : -0.82);
    pole.addScaledVector(direction, -pole.dot(direction)).normalize();
    const kneeTo = start.clone().addScaledVector(direction, along).addScaledVector(pole, Math.sqrt(Math.max(0, a * a - along * along)));
    aim(thigh, at(shin), kneeTo);
    aim(shin, at(foot), start.clone().addScaledVector(direction, distance));
    setWorldRot(foot, new Quaternion().setFromAxisAngle(right, lead ? -0.23 : 0.35).multiply(footQ[i]));
  });
  return pose;
}

/**
 * `dash` and `slide`, whole body. `idle0` is the body's standing pose (its `idle` at 0 s, three.js
 * objects): the slide keeps its arms. Returns the report entries.
 */
export function addMoveClips(doc, shooter, T, al, rigKind, idle0, bodyNodes) {
  const J = JOINT[rigKind];
  const hipsT = T.rig.byName.get(J('Hips'));
  const tRest = T.ref.pos(hipsT);
  const sHips = shooter.rig.byName.get(JOINT.mixamo('Hips'));
  const sRest = shooter.ref.pos(sHips);
  const ratio = tRest.y / sRest.y;
  const floor = lowest(T.skin, T.ref.world);

  // dash: the shooter Pepe's stride. Hips height scales with hip height and never sinks the feet.
  const dash = clipOf(shooter.doc, 'dash');
  const dashTimes = Array.from({ length: Math.round(durationOf(dash) * 30) + 1 }, (_, i) => i / 30);
  let dashLow = Infinity;
  const dashFrames = dashTimes.map((t) => {
    const sw = worldOf(shooter.rig, poseAt(dash, t));
    const sh = posOf(sw.get(sHips));
    const { pose, world } = retargetPose(shooter, T, al, sw, null, (first) => {
      const hy = posOf(first.get(hipsT)).y;
      const y = Math.max(tRest.y + (sh.y - sRest.y) * ratio, hy + floor - lowest(T.skin, first));
      return new Vector3(tRest.x, y, tRest.z);
    }, J('Hips'));
    dashLow = Math.min(dashLow, lowest(T.skin, world));
    return pose;
  });
  addClip(doc, 'dash', dashTimes, dashFrames, bodyNodes);

  // slide: the constructed pose over the standing arms, set down on the floor.
  const slide = new Map([...idle0].map(([n, e]) => [n, { ...e }]));
  for (const [n, e] of slideJoints(T, J)) slide.set(n, { ...slide.get(n), ...e });
  const drop = lowest(T.skin, worldOfPose(T.rig, slide)) - floor;
  const hipsParent = T.rig.parent.get(hipsT);
  const parentWorld = hipsParent ? worldOfPose(T.rig, slide).get(hipsParent) : new Matrix4();
  const hipsWorld = slide.get(hipsT).t.clone().applyMatrix4(parentWorld);
  hipsWorld.y -= drop;
  slide.get(hipsT).t = hipsWorld.clone().applyMatrix4(parentWorld.clone().invert());
  const slideTimes = Array.from({ length: Math.round(SLIDE_SECONDS * FPS) + 1 }, (_, i) => i / FPS);
  const slideFrames = slideTimes.map((_, i) => {
    const u = Math.min(1, i / SLIDE_IN_KEYS);
    const w = u * u * (3 - 2 * u);
    if (w >= 1) return slide;
    const frame = new Map();
    for (const [n, e] of slide) {
      const from = idle0.get(n) ?? {};
      const r0 = from.r ?? new Quaternion().fromArray(n.getRotation());
      const out = {};
      if (e.r) out.r = r0.clone().slerp(e.r, w);
      if (e.t) out.t = (from.t ?? new Vector3().fromArray(n.getTranslation())).clone().lerp(e.t, w);
      frame.set(n, out);
    }
    return frame;
  });
  addClip(doc, 'slide', slideTimes, slideFrames, bodyNodes);
  return {
    dash: { seconds: round(dashTimes[dashTimes.length - 1]), keys: dashTimes.length, lowest: round(dashLow - floor) },
    slide: { seconds: SLIDE_SECONDS, keys: slideTimes.length, hipsDrop: round(tRest.y - hipsWorld.y) },
  };
}
