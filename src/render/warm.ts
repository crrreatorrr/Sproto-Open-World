import * as THREE from 'three';
import { makeDissolvable } from './fx/dissolve';
import { textureBytes, type UploadBudget } from '../world/UploadBudget';
import type { Renderer } from './Renderer';

/**
 * Bodies are drawn with their own copy of each material, taught to burn away when they die
 * (views/BodyGlow.ts). That is a different shader program from the model's own, so it is compiled
 * here as well. The copies made for it are kept for the session: a program lives only while some
 * material uses it.
 */
const dissolving: THREE.Material[] = [];

async function compileDissolving(root: THREE.Object3D, renderer: Renderer): Promise<void> {
  const swapped: [THREE.Mesh, THREE.Material | THREE.Material[]][] = [];
  const copies = new Map<THREE.Material, THREE.Material>();
  const copy = (m: THREE.Material): THREE.Material => {
    let c = copies.get(m);
    if (!c) {
      c = m.clone();
      makeDissolvable(c);
      copies.set(m, c);
      dissolving.push(c);
    }
    return c;
  };
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || !mesh.material) return;
    swapped.push([mesh, mesh.material]);
    mesh.material = Array.isArray(mesh.material) ? mesh.material.map(copy) : copy(mesh.material);
  });
  // The programs are created as the call is made; the wait is only for the driver to finish them.
  const done = renderer.compile(root);
  for (const [mesh, material] of swapped) mesh.material = material;
  await done;
}

/** If the frame loop isn't running (a hidden tab), a model stops waiting for its warm-up after this long. */
export const WARM_TIMEOUT_MS = 2500;

/**
 * Get a freshly loaded model ready to draw before anything shows it: its textures go up through the
 * per-frame upload budget and its shader programs compile off the draw (in parallel where the
 * driver can). Without this, the first frame that draws a new enemy, NPC or weapon pays for all of
 * it inside the draw call, and the game freezes for that frame.
 *
 * Copies made from the model share its geometry and materials, so warming the template covers them.
 */
export async function warmModel(root: THREE.Object3D, uploads: UploadBudget, renderer: Renderer, body = false, timeoutMs = WARM_TIMEOUT_MS): Promise<void> {
  const textures = new Set<THREE.Texture>();
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      if (!m) continue;
      for (const v of Object.values(m)) if (v instanceof THREE.Texture && v.image) textures.add(v);
    }
  });
  const work = (async () => {
    await Promise.all(
      [...textures].map(
        (tex) =>
          new Promise<void>((resolve) =>
            uploads.texture(() => {
              renderer.renderer.initTexture(tex);
              resolve();
            }, textureBytes(tex)),
          ),
      ),
    );
    await renderer.compile(root);
    if (body) await compileDissolving(root, renderer);
  })();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const giveUp = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, timeoutMs);
  });
  try {
    await Promise.race([work, giveUp]);
  } catch {
    // A failed warm-up only means the first draw does the work, as it did before.
  } finally {
    clearTimeout(timer);
  }
}
