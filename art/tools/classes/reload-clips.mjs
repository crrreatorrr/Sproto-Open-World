/**
 * The reloads, keyed by hand. Sproto Shooter's `reload` clip is made for a first-person view: the
 * gun tips a few degrees and the support hand shifts a few centimetres, which from a third-person
 * camera reads as the arms freezing. These are the same reloads staged to be seen from behind and
 * beside the body: the hand visibly leaves the gun, goes to the belt, comes back with a magazine,
 * seats it, and works the action.
 *
 * Each reload is a list of keys over the clip's 0..1 (the game scrubs a reload clip by the sim's
 * reload progress, so any reload time plays the whole motion). A key holds:
 *
 * - `gun`: the gun's shift from its reload stance (metres: left, up, forward in the body's frame) and
 *   turn (degrees: `yaw` toward the body's left, `pitch` muzzle down, `roll` top toward the left).
 * - `hand`: the support hand's shift from its place on the gun, in the gun's own frame (metres: to
 *   the gun's left, above it, ahead along the barrel). The arm's reach limits it on a short-armed body.
 * - `belt` (0..1): how far the hand has left the gun for the magazine pouch on the left hip. That is
 *   a place on the body, not on the gun: the gun is tipped and rolled through a reload, and a hand
 *   steered in its frame wanders off across the chest instead of going down to the belt.
 * - `body`: the torso and head going with it, on top of the stance (degrees: `lean` forward, `head`
 *   down, `twist` toward the body's left). The game's camera sits behind the player, where the hands
 *   are hidden by the back: there a reload is read from the shoulders turning toward the pouch, the
 *   head dropping to look, the elbow going down beside the hip and the muzzle rising past the shoulder.
 *
 * Keys ease into each other (smoothstep), so every beat settles before the next starts.
 */
import { Quaternion, Vector3 } from 'three';

const RAD = Math.PI / 180;
const LEFT = new Vector3(1, 0, 0), UP = new Vector3(0, 1, 0), FWD = new Vector3(0, 0, 1);
const REST = { gun: { at: [0, 0, 0], yaw: 0, pitch: 0, roll: 0 }, hand: [0, 0, 0] };
const key = (u, gun = {}, hand = [0, 0, 0], belt = 0, body = {}) => ({ u, gun: { ...REST.gun, ...gun }, hand, belt, body: { lean: 0, head: 0, twist: 0, ...body } });

/** The support hand's places on a long gun, from its hold on the handguard. */
const MAGWELL = [0, -0.1, -0.17];
const MAG_OUT = [0.02, -0.24, -0.17];
const ACTION = [0.04, 0.05, -0.13];
/** And on a sidearm, from its place under the grip. */
const BUTT = [0, -0.1, 0];
const SLIDE = [0, 0.17, 0.02];
const SLIDE_BACK = [0, 0.17, -0.07];

export const RELOADS = {
  /**
   * A long gun, both hands: the muzzle comes up and the magazine well rolls toward the support hand;
   * the hand strips the magazine, drops to the belt for a fresh one, brings it up and seats it (the
   * gun takes the knock), then works the action as the gun rolls back level.
   */
  long: [
    key(0),
    key(0.09, { pitch: -16, roll: 14, yaw: -8, at: [-0.02, 0.05, -0.03] }, MAGWELL, 0, { lean: 2, head: 6 }),
    key(0.18, { pitch: -30, roll: 20, yaw: -16, at: [-0.05, 0.1, -0.05] }, MAG_OUT, 0, { lean: 3, head: 10, twist: 6 }),
    key(0.32, { pitch: -34, roll: 22, yaw: -20, at: [-0.06, 0.12, -0.06] }, MAG_OUT, 1, { lean: 6, head: 16, twist: 16 }),
    key(0.48, { pitch: -34, roll: 22, yaw: -20, at: [-0.06, 0.12, -0.06] }, MAG_OUT, 1, { lean: 6, head: 16, twist: 16 }),
    key(0.6, { pitch: -28, roll: 20, yaw: -14, at: [-0.05, 0.1, -0.05] }, MAG_OUT, 0, { lean: 3, head: 10, twist: 6 }),
    key(0.67, { pitch: -20, roll: 16, yaw: -8, at: [-0.02, 0.13, -0.03] }, MAGWELL, 0, { lean: 1, head: 8 }),
    key(0.74, { pitch: -14, roll: 10, at: [0, 0.05, -0.01] }, MAGWELL, 0, { lean: 3, head: 6 }),
    key(0.84, { pitch: 4, roll: -8 }, ACTION, 0, { lean: 2, head: 3, twist: -4 }),
    key(0.9, { pitch: 10, roll: -10, at: [0, -0.01, -0.05] }, [ACTION[0], ACTION[1], ACTION[2] - 0.08], 0, { lean: 4, head: 2, twist: -6 }),
    key(1),
  ],
  /**
   * A sidearm in the right hand: the gun comes up in front of the chest while the left hand fetches
   * a magazine from the hip, pushes it up into the grip (the gun jumps), then racks the slide and
   * falls away.
   */
  sidearm: [
    key(0, {}, BUTT, 1),
    key(0.12, { pitch: -16, roll: 10, at: [0, 0.04, 0] }, BUTT, 1, { head: 6, twist: 8 }),
    key(0.3, { pitch: -26, roll: 14, at: [0, 0.08, -0.02] }, BUTT, 1, { lean: 4, head: 12, twist: 14 }),
    key(0.5, { pitch: -24, roll: 14, at: [0, 0.08, -0.02] }, BUTT, 0, { lean: 3, head: 10, twist: 4 }),
    key(0.57, { pitch: -18, roll: 10, at: [0, 0.13, -0.02] }, [0, -0.02, 0], 0, { lean: 1, head: 8 }),
    key(0.64, { pitch: -12, roll: 6, at: [0, 0.07, 0] }, [0, -0.02, 0], 0, { lean: 2, head: 6 }),
    key(0.76, { pitch: -2, roll: -8, at: [0, 0.04, 0] }, SLIDE, 0, { lean: 2, head: 4, twist: -4 }),
    key(0.84, { pitch: 6, roll: -10, at: [0, 0.03, -0.05] }, SLIDE_BACK, 0, { lean: 4, head: 3, twist: -6 }),
    key(0.9, { pitch: 0, roll: -4, at: [0, 0.02, 0] }, SLIDE, 0, { lean: 2, head: 2 }),
    key(1, {}, BUTT, 1),
  ],
  /**
   * A sidearm in each hand, no hand free: both guns tip up and in, drop sharply to shake the empty
   * magazines out, are driven down onto fresh ones at the belt, and snap back up level. The other
   * gun does the same, mirrored.
   */
  akimbo: [
    key(0),
    key(0.14, { pitch: -24, roll: 18, at: [0.02, 0.05, -0.04] }, [0, 0, 0], 0, { lean: -2, head: -2 }),
    key(0.26, { pitch: 14, roll: 6, at: [0, -0.07, -0.02] }, [0, 0, 0], 0, { lean: 4, head: 6 }),
    key(0.36, { pitch: -6, roll: 10, at: [0, -0.02, -0.04] }, [0, 0, 0], 0, { lean: 3, head: 8 }),
    key(0.56, { pitch: 44, roll: 26, at: [-0.03, -0.22, -0.2] }, [0, 0, 0], 0, { lean: 10, head: 16 }),
    key(0.66, { pitch: 40, roll: 22, at: [-0.03, -0.25, -0.2] }, [0, 0, 0], 0, { lean: 12, head: 16 }),
    key(0.74, { pitch: 30, roll: 18, at: [-0.02, -0.19, -0.18] }, [0, 0, 0], 0, { lean: 8, head: 10 }),
    key(0.9, { pitch: -12, roll: 4, at: [0, 0.03, -0.02] }, [0, 0, 0], 0, { lean: -1, head: 0 }),
    key(1),
  ],
};

const lerp = (a, b, w) => a + (b - a) * w;

/**
 * A reload at `u` (0..1): `gun` and `support` as shooter-clips.mjs's solver takes them ({ p, q }: the
 * gun's world-space shift and turn; the support hand's shift in the gun's frame, no extra turn, and
 * `belt`, how far it is toward the hip),
 * with the lengths scaled by `scale` (arm length over 0.5 m, so a small body's reload is its own
 * size). `mirror` gives the same gun motion for the left hand's gun.
 */
export function reloadAt(kind, u, scale = 1) {
  const keys = RELOADS[kind];
  let i = 0;
  while (i < keys.length - 2 && keys[i + 1].u <= u) i++;
  const a = keys[i], b = keys[i + 1];
  const t = Math.min(1, Math.max(0, (u - a.u) / (b.u - a.u)));
  const w = t * t * (3 - 2 * t);
  const mix = (x, y) => x.map((v, n) => lerp(v, y[n], w) * scale);
  const at = mix(a.gun.at, b.gun.at);
  const yaw = lerp(a.gun.yaw, b.gun.yaw, w), pitch = lerp(a.gun.pitch, b.gun.pitch, w), roll = lerp(a.gun.roll, b.gun.roll, w);
  const hand = mix(a.hand, b.hand);
  const turn = (sign) => new Quaternion().setFromAxisAngle(UP, sign * yaw * RAD)
    .multiply(new Quaternion().setFromAxisAngle(LEFT, pitch * RAD))
    .multiply(new Quaternion().setFromAxisAngle(FWD, -sign * roll * RAD));
  const shift = (sign) => new Vector3().addScaledVector(LEFT, sign * at[0]).addScaledVector(UP, at[1]).addScaledVector(FWD, at[2]);
  return {
    gun: { p: shift(1), q: turn(1) },
    mirror: { p: shift(-1), q: turn(-1) },
    support: { p: new Vector3(hand[0], hand[1], hand[2]), q: new Quaternion(), belt: lerp(a.belt, b.belt, w) },
    body: { lean: lerp(a.body.lean, b.body.lean, w), head: lerp(a.body.head, b.body.head, w), twist: lerp(a.body.twist, b.body.twist, w) },
  };
}

/** The magazine pouch, on the side of the hip where a camera behind the body sees the hand reach it: from the left hip joint, in the body's frame (metres at an arm 0.5 m long: left, up, forward). */
export const BELT = [0.17, 0.05, 0.0];
