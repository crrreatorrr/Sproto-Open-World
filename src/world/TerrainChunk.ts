import * as THREE from 'three';
import { CELL_SIZE } from '../content/world/format';
import type { TerrainMeshData } from './terrainMesh';

/** The four splat layers the shader knows, in its own channel order. */
const LAYERS = ['grass', 'dirt', 'rock', 'path'] as const;

/**
 * The terrain's 4-layer splat material (plan §3.4): a MeshStandardMaterial (so it takes the sun,
 * fog and shadows like everything else) whose albedo blends grass, dirt, rock and path by the
 * per-vertex splat weights. Textures are sampled in world space at two scales to break up tiling;
 * grass and dirt take their detail from the grove floor, rock and path from the stone. The layers'
 * colours are tints, because the grove textures are dark and mossy and Sproutvale is a daylight field.
 *
 * `splatLayers` is the manifest's channel order; a permutation matrix maps it onto LAYERS, so the
 * bake can reorder channels without a shader change.
 */
/** The horizon's cell mask (world/Horizon.ts): R is how far each cell's ground has faded in. */
export interface CellMaskUniforms {
  horizonMask: { value: THREE.Texture | null };
  maskOrigin: { value: THREE.Vector2 };
  maskSize: { value: THREE.Vector2 };
}

export function terrainMaterial(grass: THREE.Texture, rock: THREE.Texture, splatLayers: readonly string[], mask?: CellMaskUniforms): THREE.MeshStandardMaterial {
  for (const t of [grass, rock]) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = 8;
  }
  const remap = new THREE.Matrix4().set(0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0);
  const e = remap.elements;
  LAYERS.forEach((name, row) => {
    const col = splatLayers.indexOf(name);
    // Column-major: element [col * 4 + row] is (row, col). An unknown layer name keeps its channel.
    e[(col >= 0 ? col : row) * 4 + row] = 1;
  });
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.96, metalness: 0 });
  mat.name = 'terrain';
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.tGrass = { value: grass };
    shader.uniforms.tRock = { value: rock };
    shader.uniforms.splatRemap = { value: remap };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec4 splat;\nattribute vec2 wuv;\nuniform mat4 splatRemap;\nvarying vec4 vSplat;\nvarying vec2 vWorldUv;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvSplat = splatRemap * splat;\nvWorldUv = wuv;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform sampler2D tGrass;\nuniform sampler2D tRock;\nvarying vec4 vSplat;\nvarying vec2 vWorldUv;')
      .replace('#include <map_fragment>', SPLAT_GLSL);
    if (mask) {
      // A cell that has just loaded dithers in over the horizon mesh. The fade is read once per
      // cell, at its centre (the mesh sits at the cell's south-west corner), so every pixel of the
      // cell agrees, and the horizon's shader keeps exactly the pixels this one gives up.
      Object.assign(shader.uniforms, mask);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nuniform sampler2D horizonMask;\nuniform vec2 maskOrigin;\nuniform vec2 maskSize;\nvarying float vCellFade;')
        .replace('#include <begin_vertex>', `#include <begin_vertex>\nvCellFade = texture2D(horizonMask, (modelMatrix[3].xz + ${(CELL_SIZE / 2).toFixed(1)} - maskOrigin) / maskSize).r;`);
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying float vCellFade;')
        .replace(
          '#include <clipping_planes_fragment>',
          `#include <clipping_planes_fragment>
  if (vCellFade < 0.999) {
    float cellNoise = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
    if (vCellFade <= cellNoise) discard;
  }`,
        );
    }
  };
  mat.customProgramCacheKey = () => (mask ? 'terrain-splat-v3-fade' : 'terrain-splat-v2');
  return mat;
}

const SPLAT_GLSL = /* glsl */ `
  // The grove floor carries rune circles: sampled small, blurred a few mips and at two rotated
  // scales it reads as grass noise instead of a pattern. The stone, very large, gives meadow patches.
  vec2 p = vWorldUv;
  vec2 q = mat2(0.799, -0.602, 0.602, 0.799) * p;
  float fine = dot(texture2D(tGrass, p * (1.0 / 1.7), 2.5).rgb, vec3(0.3333));
  float mid = dot(texture2D(tGrass, q * (1.0 / 5.3) + vec2(0.37, 0.71), 3.0).rgb, vec3(0.3333));
  float patches = dot(texture2D(tRock, q * (1.0 / 41.0)).rgb, vec3(0.3333));
  vec3 rockTex = texture2D(tRock, p * (1.0 / 6.0)).rgb;
  float rockLum = dot(rockTex, vec3(0.3333));
  float stoneLum = dot(texture2D(tRock, p * (1.0 / 13.0) + vec2(0.5, 0.25)).rgb, vec3(0.3333));
  float detail = (fine * 0.5 + mid * 0.5) - 0.3;
  vec3 grass = mix(vec3(0.24, 0.42, 0.11), vec3(0.36, 0.50, 0.15), smoothstep(0.2, 0.45, patches)) * (0.95 + 1.2 * detail);
  vec3 dirt = vec3(0.38, 0.27, 0.16) * (0.8 + 1.2 * (fine - 0.3));
  vec3 rock = mix(vec3(0.44, 0.43, 0.40) * (0.45 + 1.0 * rockLum), rockTex, 0.3);
  vec3 path = vec3(0.62, 0.53, 0.37) * (0.75 + 0.6 * (stoneLum - 0.3));
  vec4 w = max(vSplat, vec4(0.0));
  w /= max(w.r + w.g + w.b + w.a, 1e-3);
  diffuseColor.rgb *= grass * w.r + dirt * w.g + rock * w.b + path * w.a;
`;

/**
 * One cell's terrain mesh, built from the worker's arrays. The mesh sits at the cell's SW corner;
 * it receives shadows but doesn't cast them (the shadow pass's draw calls go to props and
 * characters, plan §3.4).
 */
export class TerrainChunk {
  readonly mesh: THREE.Mesh;
  readonly res: number;

  constructor(readonly cx: number, readonly cz: number, data: TerrainMeshData, material: THREE.Material) {
    this.res = data.res;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(data.position, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(data.normal, 3));
    g.setAttribute('wuv', new THREE.BufferAttribute(data.uv, 2));
    g.setAttribute('splat', new THREE.BufferAttribute(data.splat, 4, true));
    g.setIndex(new THREE.BufferAttribute(data.index, 1));
    // Bounds from the known extents, not a pass over every vertex.
    g.boundingBox = new THREE.Box3(new THREE.Vector3(0, data.minY, 0), new THREE.Vector3(CELL_SIZE, data.maxY, CELL_SIZE));
    g.boundingSphere = g.boundingBox.getBoundingSphere(new THREE.Sphere());
    this.mesh = new THREE.Mesh(g, material);
    this.mesh.name = `terrain:${cx},${cz}@${data.res}`;
    this.mesh.position.set(cx * CELL_SIZE, 0, cz * CELL_SIZE);
    this.mesh.receiveShadow = true;
    this.mesh.castShadow = false;
    this.mesh.matrixAutoUpdate = false;
    this.mesh.updateMatrix();
  }

  dispose(): void {
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
  }
}
