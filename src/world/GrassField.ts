import * as THREE from 'three';
import { decodeCellBin } from '../content/world/codec';
import { CELL_SIZE, cellKey, cellOf, type CellData, type PropKind } from '../content/world/format';
import { GRASS_CANDIDATES, GRASS_FAR, GRASS_NEAR, grassDensity, grassDrawCount, scatterGrass } from './grassScatter';
import { distanceToCell } from './rings';

/** The player's 3 × 3 cells: the most the grass radius can touch at once. */
const SLOTS = 9;
/** A cell keeps its grass this far past the draw distance, so walking along an edge doesn't rebuild it. */
const KEEP_MARGIN = 8;

/** Where the grass reads a cell from: its raw payload, once its terrain is showing. */
export interface GrassSource {
  grassSource(cx: number, cz: number): { bin: ArrayBuffer; json: CellData } | null;
}

interface Slot {
  geometry: THREE.InstancedBufferGeometry;
  mesh: THREE.Mesh;
  place: THREE.InstancedBufferAttribute;
  shape: THREE.InstancedBufferAttribute;
  key: string | null;
  cx: number;
  cz: number;
  count: number;
}

/** Three blades fanned around the tuft's centre: unit height, tapering to a point. */
function tuftGeometry(): THREE.BufferGeometry {
  const positions: number[] = [];
  const index: number[] = [];
  const blades = [0.2, 2.3, 4.4];
  for (const a of blades) {
    const s = Math.sin(a), c = Math.cos(a);
    const side = { x: c, z: -s }, out = { x: s, z: c };
    const root = 0.1, lean = 0.3, w = 0.075;
    const add = (across: number, y: number, along: number) => positions.push(side.x * across + out.x * along, y, side.z * across + out.z * along);
    const v = positions.length / 3;
    add(-w, 0, root);
    add(w, 0, root);
    add(-w * 0.72, 0.55, root + lean * 0.32);
    add(w * 0.72, 0.55, root + lean * 0.32);
    add(0, 1, root + lean);
    index.push(v, v + 1, v + 2, v + 2, v + 1, v + 3, v + 2, v + 3, v + 4);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setIndex(index);
  return g;
}

const GRASS_VERTEX_PARS = /* glsl */ `
attribute vec4 aPlace;
attribute vec2 aShape;
uniform vec2 uFocus;
uniform vec2 uRange;
uniform float uTime;
varying vec3 vGrassColor;
`;

/**
 * Density by distance is the same smoothstep as grassDensity(): a tuft shows while the density is
 * above its rank, and grows in over the last stretch, so it never pops.
 */
const GRASS_BEGIN_VERTEX = /* glsl */ `
float gTip = position.y;
vec2 gAway = aPlace.xz - uFocus;
float gDist = length(gAway);
float gKeep = 1.0 - smoothstep(uRange.x, uRange.y, gDist);
float gScale = aShape.y * clamp((gKeep - aPlace.w) / 0.1, 0.0, 1.0);
float gC = cos(aShape.x), gS = sin(aShape.x);
vec3 transformed = vec3(gC * position.x + gS * position.z, position.y, gC * position.z - gS * position.x) * gScale;
float gPhase = uTime * 1.7 + aPlace.x * 0.33 + aPlace.z * 0.27;
vec2 gWind = vec2(sin(gPhase), cos(gPhase * 0.8 + 1.3)) * 0.11;
vec2 gPush = gDist > 0.001 ? (gAway / gDist) * (1.0 - smoothstep(0.35, 1.5, gDist)) * 0.55 : vec2(0.0);
transformed.xz += (gWind + gPush) * gTip * gTip * gScale;
transformed += aPlace.xyz;
vGrassColor = mix(vec3(0.21, 0.37, 0.10), vec3(0.42, 0.57, 0.17), gTip) * (0.86 + 0.28 * fract(aPlace.w * 977.0));
`;

function grassMaterial(uniforms: Record<string, THREE.IUniform>): THREE.MeshLambertMaterial {
  const mat = new THREE.MeshLambertMaterial({ color: 0xffffff, side: THREE.DoubleSide });
  mat.name = 'grass';
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${GRASS_VERTEX_PARS}`)
      // Blades light like the ground under them, whichever way they face.
      .replace('#include <beginnormal_vertex>', 'vec3 objectNormal = vec3(0.0, 1.0, 0.0);')
      .replace('#include <begin_vertex>', GRASS_BEGIN_VERTEX);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vGrassColor;')
      .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb *= vGrassColor;')
      // Double-sided faces would flip the normal on their backs and go dark.
      .replace('#include <normal_fragment_begin>', '#include <normal_fragment_begin>\nnormal = normalize(vNormal);');
  };
  mat.customProgramCacheKey = () => 'grass-v1';
  return mat;
}

/**
 * Instanced grass around the player (M7). One draw call per nearby cell, at most six at a time: each
 * cell is one instanced tuft mesh from a fixed pool of nine, frustum-culled by the cell's bounds. It
 * casts no shadow. Tufts thin out with distance in the shader, and the instance count follows, so
 * far cells cost little. At most one cell is scattered per frame. Settings can turn it off.
 */
export class GrassField {
  readonly root = new THREE.Group();
  private readonly base = tuftGeometry();
  private readonly material: THREE.MeshLambertMaterial;
  private readonly uniforms = {
    uFocus: { value: new THREE.Vector2() },
    uRange: { value: new THREE.Vector2(GRASS_NEAR, GRASS_FAR) },
    uTime: { value: 0 },
  };
  private readonly slots: Slot[] = [];
  private readonly shown = new Map<string, Slot>();
  private on = true;

  constructor(
    private readonly channel: number,
    private readonly kinds: Readonly<Record<string, PropKind>>,
    private readonly range: { min: number; max: number },
  ) {
    this.root.name = 'grass';
    this.material = grassMaterial(this.uniforms);
    for (let i = 0; i < SLOTS; i++) this.slots.push(this.makeSlot(i));
  }

  private makeSlot(i: number): Slot {
    const geometry = new THREE.InstancedBufferGeometry();
    geometry.setAttribute('position', this.base.getAttribute('position'));
    geometry.setIndex(this.base.getIndex());
    const place = new THREE.InstancedBufferAttribute(new Float32Array(GRASS_CANDIDATES * 4), 4);
    const shape = new THREE.InstancedBufferAttribute(new Float32Array(GRASS_CANDIDATES * 2), 2);
    place.setUsage(THREE.DynamicDrawUsage);
    shape.setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute('aPlace', place);
    geometry.setAttribute('aShape', shape);
    geometry.instanceCount = 0;
    geometry.boundingSphere = new THREE.Sphere();
    const mesh = new THREE.Mesh(geometry, this.material);
    mesh.name = `grass:${i}`;
    mesh.visible = false;
    mesh.castShadow = false;
    mesh.receiveShadow = true;
    mesh.matrixAutoUpdate = false;
    this.root.add(mesh);
    return { geometry, mesh, place, shape, key: null, cx: 0, cz: 0, count: 0 };
  }

  /** The Grass setting. */
  get enabled(): boolean {
    return this.on;
  }

  set enabled(on: boolean) {
    this.on = on;
    this.root.visible = on;
  }

  /** One frame around (x, z): let go of far cells, scatter the nearest missing one, set the counts. */
  update(x: number, z: number, seconds: number, source: GrassSource): void {
    if (!this.on) return;
    this.uniforms.uFocus.value.set(x, z);
    this.uniforms.uTime.value = seconds % 3600;
    const [px, pz] = cellOf(x, z);
    for (const s of this.slots) {
      if (s.key === null) continue;
      const far = Math.max(Math.abs(s.cx - px), Math.abs(s.cz - pz)) > 1 || distanceToCell(x, z, s.cx, s.cz, CELL_SIZE) > GRASS_FAR + KEEP_MARGIN;
      if (far) this.release(s);
    }
    this.scatterNearest(x, z, px, pz, source);
    for (const s of this.slots) {
      if (s.key === null) continue;
      const n = grassDrawCount(s.place.array as Float32Array, s.count, grassDensity(distanceToCell(x, z, s.cx, s.cz, CELL_SIZE)));
      s.geometry.instanceCount = n;
      s.mesh.visible = n > 0;
    }
  }

  private release(s: Slot): void {
    if (s.key !== null) this.shown.delete(s.key);
    s.key = null;
    s.count = 0;
    s.geometry.instanceCount = 0;
    s.mesh.visible = false;
  }

  private scatterNearest(x: number, z: number, px: number, pz: number, source: GrassSource): void {
    let best: { cx: number; cz: number; data: { bin: ArrayBuffer; json: CellData } } | null = null;
    let bestDist: number = GRASS_FAR;
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        const cx = px + dx, cz = pz + dz;
        const d = distanceToCell(x, z, cx, cz, CELL_SIZE);
        if (d >= bestDist || this.shown.has(cellKey(cx, cz))) continue;
        const data = source.grassSource(cx, cz);
        if (!data) continue;
        best = { cx, cz, data };
        bestDist = d;
      }
    }
    const slot = this.slots.find((s) => s.key === null);
    if (best && slot) this.fill(slot, best.cx, best.cz, best.data);
  }

  private fill(s: Slot, cx: number, cz: number, data: { bin: ArrayBuffer; json: CellData }): void {
    const { heights, splat } = decodeCellBin(data.bin, this.range);
    const r = scatterGrass(s.place.array as Float32Array, s.shape.array as Float32Array, heights, splat, this.channel, data.json, this.kinds, cx, cz);
    s.key = cellKey(cx, cz);
    s.cx = cx;
    s.cz = cz;
    s.count = r.count;
    this.shown.set(s.key, s);
    if (r.count === 0) return;
    for (const a of [s.place, s.shape]) {
      a.clearUpdateRanges();
      a.addUpdateRange(0, r.count * a.itemSize);
      a.needsUpdate = true;
    }
    const half = CELL_SIZE / 2;
    const midY = (r.minY + r.maxY) / 2;
    s.geometry.boundingSphere!.center.set((cx + 0.5) * CELL_SIZE, midY, (cz + 0.5) * CELL_SIZE);
    s.geometry.boundingSphere!.radius = Math.hypot(half, half, (r.maxY - r.minY) / 2 + 1);
  }

  dispose(): void {
    for (const s of this.slots) {
      s.mesh.removeFromParent();
      s.geometry.dispose();
    }
    this.base.dispose();
    this.material.dispose();
    this.root.removeFromParent();
  }
}
