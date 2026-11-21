/**
 * The Wizard's share of Sproto Shooter's animations (shooter-clips.mjs): `aim`, `shoot`, `reload`,
 * `dash` and `slide` retargeted from the shooter Pepe onto sproto-duel's 24-joint rig, plus a
 * `socket_weapon` under `RightHand` so a gun in the Wizard's hand points where it shoots.
 * Called by art/tools/build-player-glb.mjs on the Blender export, before compression.
 *
 * The wizard has no finger joints: its mitten hand closes around the grip as it is.
 */
import { Matrix4, Quaternion, Vector3 } from 'three';
import { io, posOf, poseAt, worldOf } from './rig.mjs';
import { SHOOTER, addClip, align, retargetPose, rigData, skinned } from './retarget.mjs';
import { JOINT, addGunLayers, addMoveClips, naturalStance } from './shooter-clips.mjs';

const M = JOINT.mixamo;
const W = JOINT.wizard;
const SIDES = ['Left', 'Right'];
/** [wizard joint, shooter joint, wizard dir child, shooter dir child]; null = inherit the parent's correction. */
const MAP = [
  [W('Hips'), M('Hips'), null, null],
  [W('Spine'), M('Spine'), W('Spine1'), M('Spine1')],
  [W('Spine1'), M('Spine1'), W('Spine2'), M('Spine2')],
  [W('Spine2'), M('Spine2'), W('Neck'), M('Neck')],
  [W('Neck'), M('Neck'), 'Head', M('Head')],
  ['Head', M('Head'), null, null],
  ...SIDES.flatMap((s) => [
    [`${s}Shoulder`, M(`${s}Shoulder`), `${s}Arm`, M(`${s}Arm`)],
    [`${s}Arm`, M(`${s}Arm`), `${s}ForeArm`, M(`${s}ForeArm`)],
    [`${s}ForeArm`, M(`${s}ForeArm`), `${s}Hand`, M(`${s}Hand`)],
    [`${s}Hand`, M(`${s}Hand`), 'centroid', M(`${s}HandMiddle1`)],
    [`${s}UpLeg`, M(`${s}UpLeg`), `${s}Leg`, M(`${s}Leg`)],
    [`${s}Leg`, M(`${s}Leg`), `${s}Foot`, M(`${s}Foot`)],
    [`${s}Foot`, M(`${s}Foot`), `${s}ToeBase`, M(`${s}ToeBase`)],
    [`${s}ToeBase`, M(`${s}ToeBase`), null, null],
  ]),
];
const UPPER = /^((Left|Right)(Shoulder|Arm|ForeArm|Hand)|Spine\d*|neck|Head)$/;
const SOCKET_CONTRACT = 'gun root here: origin = the grip in the right fist (where socket_staff is), +Z along the barrel, +Y up from the top of the gun, metres (scale 100 cancels the 0.01 armature scale). In the aim pose (aim at 0 s over the default hips and legs) +Z is the character\'s forward (world +Z) and +Y is world up.';

export async function addWizardGunClips(doc) {
  const shooter = rigData(await io.read(SHOOTER));
  const T = rigData(doc);
  const handCentroid = (hand) => {
    const j = T.skin.joints.indexOf(hand);
    const pts = skinned(T.skin, T.ref.world, (v) => v.j.some((jj, k) => jj === j && v.w[k] > 0.5));
    return pts.reduce((a, p) => a.add(p), new Vector3()).multiplyScalar(1 / pts.length);
  };
  const al = align(MAP, shooter, T, null, handCentroid);
  const clipOf = (d, name) => d.getRoot().listAnimations().find((a) => a.getName() === name);
  const readyPose = retargetPose(shooter, T, al, worldOf(shooter.rig, poseAt(clipOf(shooter.doc, 'ready'), 0)), null, null, 'Hips');
  const upper = [...readyPose.pose.keys()].filter((n) => UPPER.test(n.getName()));
  const body = [...new Set(al.pairs.map((p) => p.t))];
  const report = {};
  // `idle` on the natural stance (shooter-clips.mjs naturalStance), rewritten in place.
  const idle = clipOf(doc, 'idle');
  const idleTimes = Array.from(idle.listSamplers().map((sm) => sm.getInput().getArray()).reduce((x, y) => (y.length > x.length ? y : x)));
  const standing = naturalStance(T, 'wizard', idleTimes.map((time) => {
    const sampled = poseAt(idle, time);
    return new Map(body.map((n) => {
      const e = sampled.get(n) ?? {};
      return [n, { r: new Quaternion().fromArray(e.r ?? n.getRotation()), ...(n.getName() === 'Hips' ? { t: new Vector3().fromArray(e.t ?? n.getTranslation()) } : {}) }];
    }));
  }), new Quaternion().fromArray(T.rig.byName.get('socket_staff').getRotation()));
  for (const sampler of idle.listSamplers()) {
    const accessors = [sampler.getInput(), sampler.getOutput()];
    sampler.dispose();
    for (const acc of accessors) if (acc && !acc.listParents().some((p) => p.propertyType === 'AnimationSampler')) acc.dispose();
  }
  idle.dispose();
  addClip(doc, 'idle', idleTimes, standing, body);
  report.idle = { seconds: +idleTimes[idleTimes.length - 1].toFixed(4), keys: idleTimes.length, stance: 'natural' };
  const idle0 = standing[0];
  // socket_weapon: at the staff's grip, square to the world in the aim pose.
  const hand = T.rig.byName.get('RightHand');
  const staff = T.rig.byName.get('socket_staff');
  const handWorld = readyPose.world.get(hand);
  const grip = new Vector3().fromArray(staff.getTranslation()).applyMatrix4(handWorld);
  const local = handWorld.clone().invert().multiply(new Matrix4().compose(grip, new Quaternion(), new Vector3(1, 1, 1)));
  const t = new Vector3(), r = new Quaternion(), s = new Vector3();
  local.decompose(t, r, s);
  const socket = doc.createNode('socket_weapon').setTranslation(t.toArray()).setRotation(r.toArray()).setScale(s.toArray());
  socket.setExtras({ contract: SOCKET_CONTRACT, aimPoseWorld: { position: grip.toArray().map((v) => +v.toFixed(4)) } });
  hand.addChild(socket);
  report.socket = { aimWorld: grip.toArray().map((v) => +v.toFixed(4)), scale: +s.x.toFixed(2) };
  // socket_weapon_l: the same in the left hand (its centre, from the skin), for the offhand gun.
  const handL = T.rig.byName.get('LeftHand');
  const handLWorld = readyPose.world.get(handL);
  const gripL = handCentroid(handL).applyMatrix4(T.ref.world.get(handL).clone().invert()).applyMatrix4(handLWorld);
  const localL = handLWorld.clone().invert().multiply(new Matrix4().compose(gripL, new Quaternion(), new Vector3(1, 1, 1)));
  const tl = new Vector3(), rl = new Quaternion(), sl = new Vector3();
  localL.decompose(tl, rl, sl);
  const socketL = doc.createNode('socket_weapon_l').setTranslation(tl.toArray()).setRotation(rl.toArray()).setScale(sl.toArray());
  socketL.setExtras({ contract: 'offhand gun root here: the left fist, +Z along the barrel, +Y up, metres (scale 100 cancels the 0.01 armature scale).' });
  handL.addChild(socketL);
  Object.assign(report, addGunLayers(doc, shooter, T, al, upper, readyPose, socket, 'wizard', idle0, socketL));


  Object.assign(report, addMoveClips(doc, shooter, T, al, 'wizard', idle0, body));

  return report;
}
