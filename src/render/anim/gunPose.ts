import * as THREE from 'three';
import { WEAPON_SOCKET } from '../../assets/manifest';

const Q1 = new THREE.Quaternion();
const Q2 = new THREE.Quaternion();
const Q3 = new THREE.Quaternion();
const Q4 = new THREE.Quaternion();
const V = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

/** The upper-body layers that point a gun down the body's facing. */
const SQUARED = new Set(['aim', 'shoot', 'aim_1h', 'shoot_1h', 'dual', 'dual_shoot_r', 'dual_shoot_l']);
/** The lowest spine joint by rig: the Mixamo class bodies, then the Wizard. */
const SPINES = ['mixamorigSpine', 'Spine02'];

/**
 * The Wizard's idle stands with its hips turned (about 25°), and a gun's aim and shot layers ride on
 * whatever the legs do. While the gun is up, the spine turns about the body's up by however far the
 * barrel is off the body's facing, so it points where the shots go (a run's hips already face ahead).
 * Call after the mixer has posed the body this frame.
 */
export function squareGun(body: THREE.Object3D, upperClip: string | null): void {
  if (!upperClip || !SQUARED.has(upperClip)) return;
  let spine: THREE.Object3D | undefined;
  for (const name of SPINES) if ((spine = body.getObjectByName(name))) break;
  const socket = body.getObjectByName(WEAPON_SOCKET);
  if (!spine?.parent || !socket) return;
  body.updateWorldMatrix(true, true);
  // The barrel (the socket's +Z) in the body's frame, flattened: its yaw off the body's +Z.
  body.getWorldQuaternion(Q1);
  socket.getWorldQuaternion(Q2).premultiply(Q4.copy(Q1).invert());
  V.set(0, 0, 1).applyQuaternion(Q2);
  const off = Math.atan2(V.x, V.z);
  if (Math.abs(off) < 1e-3) return;
  // Turn the spine by −off about the body's up, expressed in the spine's parent frame.
  Q3.setFromAxisAngle(UP, -off).premultiply(Q1).multiply(Q4.copy(Q1).invert());
  spine.parent.getWorldQuaternion(Q1);
  spine.quaternion.premultiply(Q2.copy(Q1).invert().multiply(Q3).multiply(Q1));
  spine.updateMatrixWorld(true);
}

const A = new THREE.Vector3();
const B = new THREE.Vector3();
const C = new THREE.Vector3();
const DIR = new THREE.Vector3();
const POLE = new THREE.Vector3();
const TO = new THREE.Vector3();

/** Turn `bone` (in world space) so the direction from it to `from` becomes the direction to `to`. */
function aimBone(bone: THREE.Object3D, from: THREE.Vector3, to: THREE.Vector3): void {
  bone.getWorldPosition(A);
  B.copy(from).sub(A).normalize();
  C.copy(to).sub(A).normalize();
  if (B.lengthSq() < 1e-8 || C.lengthSq() < 1e-8) return;
  Q1.setFromUnitVectors(B, C);
  bone.getWorldQuaternion(Q2).premultiply(Q1);
  bone.parent!.getWorldQuaternion(Q3);
  bone.quaternion.copy(Q3.invert().multiply(Q2));
  bone.updateMatrixWorld(true);
}

export interface ArmBones {
  upper: THREE.Object3D;
  lower: THREE.Object3D;
  hand: THREE.Object3D;
}

/** An arm's joints on either rig (the Mixamo class bodies, the Wizard), or null if the body has none. */
export function armBones(body: THREE.Object3D, side: 'Left' | 'Right'): ArmBones | null {
  const find = (part: string) => body.getObjectByName(`mixamorig${side}${part}`) ?? body.getObjectByName(`${side}${part}`);
  const upper = find('Arm'), lower = find('ForeArm'), hand = find('Hand');
  return upper && lower && hand ? { upper, lower, hand } : null;
}

/**
 * Sproto Shooter's grapple arm (its `viewmodel/grappleArm.js`): the arm straightens toward the
 * anchor, the elbow kept slightly out. `weight` blends from the posed arm (0) to the full reach (1).
 * Call after the mixer has posed the body this frame.
 */
export function reachArm(arm: ArmBones, target: THREE.Vector3, weight: number): void {
  if (weight <= 0.001) return;
  const { upper, lower, hand } = arm;
  const shoulder = upper.getWorldPosition(new THREE.Vector3());
  const elbow = lower.getWorldPosition(new THREE.Vector3());
  const wrist = hand.getWorldPosition(new THREE.Vector3());
  const a = shoulder.distanceTo(elbow), b = elbow.distanceTo(wrist);
  if (a < 1e-4 || b < 1e-4) return;
  DIR.copy(target).sub(shoulder).normalize();
  TO.copy(shoulder).addScaledVector(DIR, (a + b) * 0.985);
  TO.lerpVectors(wrist, TO, weight);
  DIR.subVectors(TO, shoulder);
  const dist = THREE.MathUtils.clamp(DIR.length(), Math.abs(a - b) + 1e-3, a + b - 1e-3);
  DIR.normalize();
  POLE.subVectors(elbow, shoulder).normalize();
  POLE.addScaledVector(DIR, -POLE.dot(DIR)).normalize();
  const along = (a * a - b * b + dist * dist) / (2 * dist);
  const elbowTo = new THREE.Vector3().copy(shoulder).addScaledVector(DIR, along).addScaledVector(POLE, Math.sqrt(Math.max(0, a * a - along * along)));
  aimBone(upper, elbow, elbowTo);
  aimBone(lower, hand.getWorldPosition(wrist), TO.copy(shoulder).addScaledVector(DIR, dist));
}

/** The upper layers in which the left hand holds a gun (its own, or the other end of a long one). */
const LEFT_HAND_GRIPS = new Set(['aim', 'hold', 'shoot', 'reload', 'reload_1h', 'dual', 'dual_shoot_r', 'dual_shoot_l', 'dual_reload', 'dual_reload_r', 'dual_reload_l']);

/** Does the left hand hold something in this upper layer (null: no layer, so it is free)? */
export function leftHandGrips(upperClip: string | null): boolean {
  return upperClip !== null && LEFT_HAND_GRIPS.has(upperClip);
}

interface Finger {
  bone: THREE.Object3D;
  grip: THREE.Quaternion;
  open: THREE.Quaternion;
}
const fingerCache = new WeakMap<THREE.Object3D, Record<string, Finger[]>>();

/**
 * A hand's fingers, between its grip and open and relaxed. No clip drives the fingers: a body's file
 * holds them closed round a grip, and carries the relaxed pose on each finger joint (`relaxed` in the
 * node's extras, art/tools/classes/retarget.mjs). `weight` 0 is the grip, 1 the open hand. A body
 * without finger joints (the Wizard's mitten hands) is left alone.
 */
export function relaxHand(body: THREE.Object3D, side: 'Left' | 'Right', weight: number): void {
  let hands = fingerCache.get(body);
  if (!hands) fingerCache.set(body, hands = {});
  let fingers = hands[side];
  if (!fingers) {
    fingers = hands[side] = [];
    const prefix = `mixamorig${side}Hand`;
    body.traverse((o) => {
      const relaxed = o.userData.relaxed as number[] | undefined;
      if (o.name.startsWith(prefix) && Array.isArray(relaxed) && relaxed.length === 4) {
        fingers!.push({ bone: o, grip: o.quaternion.clone(), open: new THREE.Quaternion().fromArray(relaxed) });
      }
    });
  }
  for (const f of fingers) f.bone.quaternion.copy(f.grip).slerp(f.open, weight);
}
