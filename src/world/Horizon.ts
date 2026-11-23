import * as THREE from 'three';
import type { RegionManifest } from '../content/world/format';

/** The horizon sits this far below the real terrain so the two never z-fight (plan §3.2). */
export const HORIZON_DROP = 0.5;

/**
 * The always-resident low-detail region mesh (plan §3.2): `horizon.glb` (an 8 m grid plus landmark
 * impostors) drawn 0.5 m low and masked out under every cell whose real terrain is showing. The
 * mask is a one-texel-per-cell texture over the region (R = 255 under a loaded cell, less while the
 * cell's ground is fading in); fragments that land on a masked texel are discarded, so the horizon
 * never pokes through real terrain and still fills the gap while a cell is loading. While a cell
 * fades in, each pixel is drawn by the horizon or by the cell's ground, never both and never neither.
 */
export class Horizon {
  readonly root = new THREE.Group();
  private readonly mask: THREE.DataTexture;
  private readonly bits: Uint8Array;
  private readonly w: number;
  private readonly h: number;
  private readonly materials: THREE.Material[] = [];
  /** The mask and where it lies, for the terrain material: a cell's ground dithers in as its horizon dithers out. */
  readonly uniforms = {
    horizonMask: { value: null as THREE.Texture | null },
    maskOrigin: { value: new THREE.Vector2() },
    maskSize: { value: new THREE.Vector2() },
  };
  loaded = false;

  constructor(private readonly manifest: RegionManifest) {
    this.root.name = 'horizon';
    this.root.position.y = -HORIZON_DROP;
    [this.w, this.h] = manifest.size;
    this.bits = new Uint8Array(this.w * this.h);
    this.mask = new THREE.DataTexture(this.bits, this.w, this.h, THREE.RedFormat, THREE.UnsignedByteType);
    this.mask.magFilter = this.mask.minFilter = THREE.NearestFilter;
    this.mask.unpackAlignment = 1;
    this.mask.needsUpdate = true;
    this.uniforms.horizonMask.value = this.mask;
    this.uniforms.maskOrigin.value.set(manifest.origin[0] * manifest.cellSize, manifest.origin[1] * manifest.cellSize);
    this.uniforms.maskSize.value.set(this.w * manifest.cellSize, this.h * manifest.cellSize);
  }

  /** Take the loaded horizon scene: every material learns the mask. */
  attach(scene: THREE.Object3D): void {
    scene.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.castShadow = false;
      mesh.receiveShadow = true;
      // One mesh per region: a region the camera has its back to is not drawn.
      mesh.frustumCulled = true;
      const list = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const m of list) this.patch(m);
    });
    this.root.add(scene);
    this.loaded = true;
  }

  /**
   * Set the mask from the cells whose terrain mesh is showing, each with how far its fade-in has
   * run (0 to 1). The horizon keeps the pixels the cell's own ground hasn't taken yet.
   */
  setLoaded(cells: Iterable<readonly [number, number, number?]>): void {
    const next = new Uint8Array(this.bits.length);
    const [ox, oz] = this.manifest.origin;
    for (const [cx, cz, fade] of cells) {
      const i = cx - ox, j = cz - oz;
      if (i >= 0 && j >= 0 && i < this.w && j < this.h) next[j * this.w + i] = Math.round(Math.min(1, Math.max(0, fade ?? 1)) * 255);
    }
    let same = true;
    for (let k = 0; k < next.length && same; k++) same = next[k] === this.bits[k];
    if (same) return;
    this.bits.set(next);
    this.mask.needsUpdate = true;
  }

  private patch(m: THREE.Material): void {
    if (this.materials.includes(m)) return;
    this.materials.push(m);
    m.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, this.uniforms);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec2 vHorizonXZ;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvHorizonXZ = (modelMatrix * vec4(transformed, 1.0)).xz;');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform sampler2D horizonMask;\nuniform vec2 maskOrigin;\nuniform vec2 maskSize;\nvarying vec2 vHorizonXZ;')
        .replace(
          '#include <clipping_planes_fragment>',
          `#include <clipping_planes_fragment>
  vec2 hc = (vHorizonXZ - maskOrigin) / maskSize;
  if (hc.x >= 0.0 && hc.y >= 0.0 && hc.x < 1.0 && hc.y < 1.0) {
    // The same per-pixel threshold the cell's ground uses (TerrainChunk.ts), the other way round.
    float horizonNoise = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
    if (texture2D(horizonMask, hc).r > horizonNoise) discard;
  }`,
        );
    };
    m.customProgramCacheKey = () => 'horizon-mask-v2';
    m.needsUpdate = true;
  }

  dispose(): void {
    this.root.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.geometry.dispose();
    });
    for (const m of this.materials) {
      for (const v of Object.values(m)) if (v instanceof THREE.Texture) v.dispose();
      m.dispose();
    }
    this.mask.dispose();
    this.root.clear();
  }
}
