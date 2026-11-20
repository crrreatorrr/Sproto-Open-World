/**
 * Shared glTF rig helpers for the class bodies (three.js math only, so poses mean exactly what
 * three.js will show: a node no clip channel drives keeps its default TRS).
 */
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';
import { Matrix4, Quaternion, Vector3 } from 'three';

await MeshoptDecoder.ready;
await MeshoptEncoder.ready;
export const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });

/** Every node of the default scene with its parent, in parent-first order. */
export function rigOf(doc) {
  const order = [];
  const parent = new Map();
  const visit = (n, p) => {
    parent.set(n, p);
    order.push(n);
    n.listChildren().forEach((c) => visit(c, n));
  };
  const scene = doc.getRoot().getDefaultScene() ?? doc.getRoot().listScenes()[0];
  scene.listChildren().forEach((n) => visit(n, null));
  const byName = new Map(order.map((n) => [n.getName(), n]));
  return { order, parent, byName };
}

/** Local TRS per node: default TRS overridden by `pose` (Map node → {t,r,s}). */
export function localOf(node, pose) {
  const o = pose?.get(node);
  return {
    t: new Vector3().fromArray(o?.t ?? node.getTranslation()),
    r: new Quaternion().fromArray(o?.r ?? node.getRotation()),
    s: new Vector3().fromArray(o?.s ?? node.getScale()),
  };
}

/** World matrices (Map node → Matrix4) for a pose. */
export function worldOf(rig, pose) {
  const world = new Map();
  for (const n of rig.order) {
    const { t, r, s } = localOf(n, pose);
    const m = new Matrix4().compose(t, r, s);
    const p = rig.parent.get(n);
    world.set(n, p ? world.get(p).clone().multiply(m) : m);
  }
  return world;
}

export const posOf = (m) => new Vector3().setFromMatrixPosition(m);
export const rotOf = (m) => {
  const t = new Vector3(), q = new Quaternion(), s = new Vector3();
  m.decompose(t, q, s);
  return q;
};

function sample(sampler, t) {
  const input = sampler.getInput().getArray();
  const out = sampler.getOutput();
  const n = out.getElementSize();
  const cubic = sampler.getInterpolation() === 'CUBICSPLINE';
  // getElement applies `normalized` (meshopt-quantized clips store int16 rotations).
  const get = (i) => out.getElement(cubic ? i * 3 + 1 : i, []);
  if (t <= input[0]) return get(0);
  const last = input.length - 1;
  if (t >= input[last]) return get(last);
  let i = 0;
  while (input[i + 1] < t) i++;
  const a = get(i), b = get(i + 1);
  if (sampler.getInterpolation() === 'STEP') return a;
  const u = (t - input[i]) / (input[i + 1] - input[i]);
  if (n === 4) return new Quaternion().fromArray(a).slerp(new Quaternion().fromArray(b), u).toArray();
  return a.map((v, k) => v + (b[k] - v) * u);
}

/** Pose (Map node → {t?,r?,s?}) of an animation at time t. */
export function poseAt(anim, t) {
  const pose = new Map();
  for (const ch of anim.listChannels()) {
    const node = ch.getTargetNode();
    const path = ch.getTargetPath();
    if (!node || path === 'weights') continue;
    const key = { translation: 't', rotation: 'r', scale: 's' }[path];
    if (!pose.has(node)) pose.set(node, {});
    pose.get(node)[key] = sample(ch.getSampler(), t);
  }
  return pose;
}

export function durationOf(anim) {
  let max = 0;
  for (const s of anim.listSamplers()) {
    const a = s.getInput().getArray();
    max = Math.max(max, a[a.length - 1]);
  }
  return max;
}

/** Skinned meshes' world-space bounding box for a pose (linear blend skinning, three.js style). */
export function skinnedBox(doc, rig, pose) {
  const world = worldOf(rig, pose);
  const lo = new Vector3(Infinity, Infinity, Infinity), hi = new Vector3(-Infinity, -Infinity, -Infinity);
  const v = new Vector3(), acc = new Vector3(), tmp = new Vector3();
  for (const node of rig.order) {
    const skin = node.getSkin(), mesh = node.getMesh();
    if (!mesh) continue;
    const meshWorld = world.get(node);
    const mats = skin ? skin.listJoints().map((j, i) => {
      const ibm = new Matrix4().fromArray(Array.from(skin.getInverseBindMatrices().getElement(i, [])));
      return world.get(j).clone().multiply(ibm);
    }) : null;
    for (const prim of mesh.listPrimitives()) {
      const P = prim.getAttribute('POSITION'), J = prim.getAttribute('JOINTS_0'), W = prim.getAttribute('WEIGHTS_0');
      const pe = [], je = [], we = [];
      for (let i = 0; i < P.getCount(); i++) {
        v.fromArray(P.getElement(i, pe));
        if (mats && J) {
          // glTF and three.js (attached bind mode) both ignore a skinned mesh node's own transform.
          J.getElement(i, je); W.getElement(i, we);
          acc.set(0, 0, 0);
          for (let k = 0; k < 4; k++) if (we[k]) acc.add(tmp.copy(v).applyMatrix4(mats[je[k]]).multiplyScalar(we[k]));
          v.copy(acc);
        } else v.applyMatrix4(meshWorld);
        lo.min(v); hi.max(v);
      }
    }
  }
  return { lo, hi };
}
