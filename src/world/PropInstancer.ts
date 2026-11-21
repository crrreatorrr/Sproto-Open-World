import * as THREE from 'three';
import { patchFlowingWater, patchVertexColorGlow } from './Water';
import type { Priority } from '../assets/RequestQueue';
import type { CellData, PropKind } from '../content/world/format';
import { cellKey } from '../content/world/format';
import { fadeMaterial, type PropFadeShared } from './propFade';
import { ALOFT_M, NEAR_SHADOW_M, coverageM, distanceToCell, farDistanceToCell, propRanges, propTiers, type PropRange } from './rings';

/** A template nobody uses is kept this long in case it comes straight back (plan §3.3). */
export const TEMPLATE_GRACE_MS = 10_000;
/** A model is asked for when the camera is this far short of where it will first be drawn (San Andreas: 50 m). */
export const STREAM_AHEAD_M = 50;
/** The camera moves this far before cells are sorted into levels of detail again (m). */
const RECLASSIFY_M = 2;
/** The bake sizes `capacity` for a 7 × 7 window of cells (tools/bake-world.ts CAPACITY_WINDOW). */
const CAPACITY_WINDOW = 7;

/** The three sets a prop kind is drawn in. `near` and `hd` are the detailed model, `far` the simple one. */
const TIERS = ['near', 'hd', 'far'] as const;
type Tier = (typeof TIERS)[number];

/** What the instancer needs from the outside: loading, and GPU warm-up spread over frames. */
export interface PropHost {
  load(path: string, priority: Priority): Promise<THREE.Group>;
  /** Queue a texture upload (world/UploadBudget.ts). */
  uploadTexture(tex: THREE.Texture): Promise<void>;
  /** Compile an object's programs without stalling (renderer.compileAsync). */
  compile(obj: THREE.Object3D): Promise<void>;
  now(): number;
}

interface Template {
  path: string;
  refs: number;
  zeroSince: number | null;
  state: 'loading' | 'ready' | 'failed';
  parts: { geometry: THREE.BufferGeometry; material: THREE.Material | THREE.Material[] }[];
  /** What was compiled ahead of the first draw, kept so those programs stay alive. */
  warm: THREE.Material[];
  disposed: boolean;
}

/** One (kind, tier) set: an InstancedMesh per sub-mesh of the model, sharing the instance buffers. */
interface Slot {
  id: string;
  key: string;
  tier: Tier;
  template: Template;
  meshes: THREE.InstancedMesh[];
  geometries: THREE.BufferGeometry[];
  materials: THREE.Material[];
  matrix: THREE.InstancedBufferAttribute;
  born: THREE.InstancedBufferAttribute;
  /** x, y: fades in between these distances; z, w: fades out between these (m). */
  fade: THREE.Vector4;
  capacity: number;
  count: number;
  /** What the buffers hold now (see `signature`). */
  sig: number;
}

/** One cell's props of one kind. */
interface CellKind {
  /** A small integer naming this (cell, kind) for slot signatures. */
  id: number;
  key: string;
  cell: PropCell;
  n: number;
  /** n × 16 floats, column-major, ready to copy into a slot. */
  matrices: Float32Array;
  minY: number;
  maxY: number;
  /** Seconds at which the detailed and the simple set first showed this cell (-1: not yet). */
  bornHd: number;
  bornFar: number;
  tiers: { near: boolean; hd: boolean; far: boolean };
  /**
   * The cell lies across a swap distance: only its props on the right side of it go in the set
   * (`hd`: closer than the detailed model's reach; `far`: beyond where the simple one starts).
   */
  splitHd: boolean;
  splitFar: boolean;
  /** Template paths this cell keeps alive. */
  wantHd: boolean;
  wantFar: boolean;
  visible: boolean;
}

interface PropCell {
  key: string;
  cx: number;
  cz: number;
  kinds: Map<string, CellKind>;
}

interface KindState {
  key: string;
  kind: PropKind;
  range: PropRange;
  hdPath: string;
  farPath: string;
  cells: Set<CellKind>;
}

/** Kinds that never cast: the quarry's rock walls alone cost 158k shadow triangles. */
const NO_SHADOW: ReadonlySet<string> = new Set(['quarry_rock']);

/**
 * The global prop instancer. ONE InstancedMesh per (prop kind, set) across every loaded cell, so draw
 * calls scale with prop kinds, not cells. The way San Andreas drew its map objects, fitted to WebGL:
 *
 * - **A draw distance per kind, by size** (world/rings.ts `propRanges`): the detailed model out to
 *   `hd`, the simple one from there to `far`. Small things stop early; big ones reach as far as ground
 *   is loaded, and never further, so nothing appears out of thin air.
 * - **Fades, not pops** (world/propFade.ts): each prop is dithered in and out by its own distance to
 *   the camera, in the shader. A cell that straddles a swap distance feeds both sets and each prop
 *   shows in exactly one. A cell that has just loaded dithers in over a moment.
 * - **Only what the camera can see is drawn.** Every frame the cells in view are worked out and each
 *   set's buffers hold just those cells' props. Buffers are rewritten only when what they hold changes.
 * - **A small shadow-casting set.** Only props near the camera, of kinds tall enough to matter, are
 *   in `near`, the one set that casts.
 *
 * Templates are refcounted by the cells that want them, asked for 50 m before they are needed, and
 * disposed 10 s after the last cell lets go.
 */
export class PropInstancer {
  readonly root = new THREE.Group();
  private readonly templates = new Map<string, Template>();
  private readonly slots = new Map<string, Slot>();
  private readonly cells = new Map<string, PropCell>();
  private readonly kinds = new Map<string, KindState>();
  private readonly shared: PropFadeShared = { cam: { value: new THREE.Vector3() }, time: { value: 0 } };
  private readonly frustum = new THREE.Frustum();
  private readonly projView = new THREE.Matrix4();
  private readonly box = new THREE.Box3();
  private readonly origin = new THREE.Vector3(Infinity, 0, Infinity);
  private rings = 2;
  private scale = 1;
  private aloft = false;
  /** Cells, templates or settings changed: sort every cell into its sets again. */
  private dirty = true;
  /** Bumped at every sort: a cell split by distance may hold different props on each side now. */
  private sortVersion = 0;
  /** The simple model is standing in for the detailed one (see `standIn`), per kind, at the last sort. */
  private readonly standing = new Set<string>();
  private nextId = 1;
  /** Instances that didn't fit their set's capacity (should stay 0; the bake sizes capacities). */
  overflow = 0;
  private readonly warned = new Set<string>();
  /** Scratch: what each set should hold this frame. */
  private readonly sources = new Map<string, CellKind[]>();

  constructor(private readonly table: Readonly<Record<string, PropKind>>, private readonly host: PropHost) {
    this.root.name = 'props';
  }

  /** How far the world is shown: rings of cells loaded, and the draw-distance scale (world/rings.ts). */
  configure(rings: number, scale: number): void {
    if (rings === this.rings && scale === this.scale) return;
    this.rings = rings;
    this.scale = scale;
    for (const k of this.kinds.values()) k.range = this.rangeOf(k.key, k.kind);
    this.dirty = true;
  }

  /** Counters for the overlay and the lap test. `instances` is what is drawn this frame. */
  stats(): { templates: number; ready: number; slots: number; instances: number; placed: number; overflow: number } {
    let instances = 0;
    for (const s of this.slots.values()) instances += s.count;
    let ready = 0;
    for (const t of this.templates.values()) if (t.state === 'ready') ready++;
    let placed = 0;
    for (const k of this.kinds.values()) for (const c of k.cells) placed += c.n;
    return { templates: this.templates.size, ready, slots: this.slots.size, instances, placed, overflow: this.overflow };
  }

  private rangeOf(key: string, kind: PropKind): PropRange {
    const r = propRanges(kind, this.scale, coverageM(this.rings));
    return NO_SHADOW.has(key) ? { ...r, casts: false } : r;
  }

  addCell(cx: number, cz: number, data: CellData): void {
    const key = cellKey(cx, cz);
    if (this.cells.has(key)) this.removeCell(cx, cz);
    const cell: PropCell = { key, cx, cz, kinds: new Map() };
    for (const [k, packed] of Object.entries(data.props)) {
      const kind = this.table[k];
      if (!kind) {
        this.warnOnce(k, `[props] cell ${key} places unknown prop "${k}"`);
        continue;
      }
      const n = Math.floor(packed.length / 5);
      if (n < 1) continue;
      let state = this.kinds.get(k);
      if (!state) {
        state = { key: k, kind, range: this.rangeOf(k, kind), hdPath: kind.path, farPath: kind.lod1Path ?? kind.path, cells: new Set() };
        this.kinds.set(k, state);
      }
      const matrices = new Float32Array(n * 16);
      let minY = Infinity, maxY = -Infinity;
      for (let i = 0; i < n; i++) {
        const p = i * 5;
        const x = packed[p], y = packed[p + 1], z = packed[p + 2], yaw = packed[p + 3], sc = packed[p + 4];
        const c = Math.cos(yaw) * sc, sn = Math.sin(yaw) * sc;
        const o = i * 16;
        // T · Ry(yaw) · S(scale), column-major (the same yaw sense as the sim's box colliders).
        matrices[o] = c;
        matrices[o + 2] = -sn;
        matrices[o + 5] = sc;
        matrices[o + 8] = sn;
        matrices[o + 10] = c;
        matrices[o + 12] = x;
        matrices[o + 13] = y;
        matrices[o + 14] = z;
        matrices[o + 15] = 1;
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y + (kind.size?.[1] ?? 12) * sc);
      }
      const ck: CellKind = {
        id: this.nextId++, key: k, cell, n, matrices, minY: minY - 2, maxY: maxY + 2, bornHd: -1, bornFar: -1,
        tiers: { near: false, hd: false, far: false }, splitHd: false, splitFar: false, wantHd: false, wantFar: false, visible: false,
      };
      cell.kinds.set(k, ck);
      state.cells.add(ck);
    }
    this.cells.set(key, cell);
    this.dirty = true;
  }

  removeCell(cx: number, cz: number): void {
    const key = cellKey(cx, cz);
    const cell = this.cells.get(key);
    if (!cell) return;
    for (const ck of cell.kinds.values()) {
      const state = this.kinds.get(ck.key)!;
      this.want(ck, state, false, false, 'later');
      state.cells.delete(ck);
      if (state.cells.size === 0) this.kinds.delete(ck.key);
    }
    this.cells.delete(key);
    this.dirty = true;
  }

  /**
   * Once a frame, with the camera this frame is drawn from: sort cells into their sets if the camera
   * has moved, work out which cells are in view, and rewrite the buffers of any set whose contents
   * changed. `seconds` is a running clock for the fades; `aloft` is the camera's height over the
   * ground (m), or null when it isn't known.
   */
  present(camera: THREE.PerspectiveCamera, seconds: number, cellSize: number, aloft: number | null = null): void {
    const cam = camera.position;
    this.shared.cam.value.copy(cam);
    this.shared.time.value = seconds;
    const high = aloft !== null && aloft > ALOFT_M;
    if (high !== this.aloft) {
      this.aloft = high;
      this.dirty = true;
    }
    const moved = Math.hypot(cam.x - this.origin.x, cam.z - this.origin.z);
    if (this.dirty || !(moved < RECLASSIFY_M)) {
      this.dirty = false;
      this.origin.set(cam.x, 0, cam.z);
      this.classify(cam.x, cam.z, cellSize, seconds);
      this.sortVersion++;
    }
    this.projView.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.projView);
    this.fill(cellSize, seconds);
    const now = this.host.now();
    for (const t of [...this.templates.values()]) {
      if (t.refs === 0 && t.zeroSince !== null && now - t.zeroSince >= TEMPLATE_GRACE_MS) this.disposeTemplate(t);
    }
  }

  /** Which sets each cell's props feed, which models that needs, and each set's fade distances. */
  private classify(x: number, z: number, cellSize: number, seconds: number): void {
    for (const state of this.kinds.values()) {
      const r = state.range;
      const hdReady = this.templates.get(state.hdPath)?.state === 'ready';
      const farReady = this.templates.get(state.farPath)?.state === 'ready';
      const standIn = this.standIn(state);
      if (standIn) this.standing.add(state.key);
      else this.standing.delete(state.key);
      for (const ck of state.cells) {
        const dmin = distanceToCell(x, z, ck.cell.cx, ck.cell.cz, cellSize);
        const dmax = farDistanceToCell(x, z, ck.cell.cx, ck.cell.cz, cellSize);
        const t = propTiers(dmin, dmax, r, standIn);
        ck.tiers.near = t.near && hdReady;
        ck.tiers.hd = t.hd && hdReady;
        ck.tiers.far = t.far && farReady;
        ck.splitHd = dmax > r.hd;
        ck.splitFar = dmax > r.far || (!standIn && dmin < r.hd - r.band);
        if ((ck.tiers.near || ck.tiers.hd) && ck.bornHd < 0) ck.bornHd = seconds;
        if (ck.tiers.far && ck.bornFar < 0) ck.bornFar = seconds;
        // Ask for each model a little before it is first drawn (SA5), the close ones first.
        const wantHd = !this.aloft && dmin < r.hd + STREAM_AHEAD_M;
        const wantFar = dmin < r.far + STREAM_AHEAD_M && (this.aloft || dmax > r.hd - r.band - STREAM_AHEAD_M || state.farPath === state.hdPath);
        this.want(ck, state, wantHd, wantFar, dmin < NEAR_SHADOW_M ? 'now' : 'later');
      }
      for (const tier of TIERS) {
        const slot = this.slots.get(`${state.key}|${tier}`);
        if (slot) this.setFade(slot.fade, state, tier);
      }
    }
  }

  /** While the detailed model is loading, or from high up, the simple one stands in for it up close. */
  private standIn(state: KindState): boolean {
    return this.aloft || (this.templates.get(state.hdPath)?.state !== 'ready' && this.templates.get(state.farPath)?.state === 'ready');
  }

  /** A set's fade distances: the detailed model out to `hd`, the simple one from there to `far`. */
  private setFade(fade: THREE.Vector4, state: KindState, tier: Tier): void {
    const r = state.range;
    if (tier !== 'far') fade.set(-2, -1, r.hd - r.band, r.hd);
    else if (this.standIn(state)) fade.set(-2, -1, r.far - r.band, r.far);
    else fade.set(r.hd - r.band, r.hd, r.far - r.band, r.far);
  }

  private want(ck: CellKind, state: KindState, hd: boolean, far: boolean, priority: Priority): void {
    if (hd !== ck.wantHd) {
      if (hd) this.retain(state.hdPath, priority);
      else this.release(state.hdPath);
      ck.wantHd = hd;
    }
    if (far !== ck.wantFar) {
      if (far) this.retain(state.farPath, priority);
      else this.release(state.farPath);
      ck.wantFar = far;
    }
  }

  /** Put this frame's visible props into each set, rewriting only the sets that changed. */
  private fill(cellSize: number, seconds: number): void {
    for (const list of this.sources.values()) list.length = 0;
    const box = this.box;
    for (const state of this.kinds.values()) {
      // A prop reaches past its own cell by up to half its width; the box grows by that.
      const reach = Math.max(4, (state.kind.size?.[0] ?? 12) * 0.75);
      for (const ck of state.cells) {
        const t = ck.tiers;
        if (!t.near && !t.hd && !t.far) continue;
        const x0 = ck.cell.cx * cellSize, z0 = ck.cell.cz * cellSize;
        box.min.set(x0 - reach, ck.minY, z0 - reach);
        box.max.set(x0 + cellSize + reach, ck.maxY, z0 + cellSize + reach);
        ck.visible = this.frustum.intersectsBox(box);
        // Shadow casters count whether or not the camera faces them.
        if (t.near) this.source(`${state.key}|near`).push(ck);
        if (t.hd && ck.visible) this.source(`${state.key}|hd`).push(ck);
        if (t.far && ck.visible) this.source(`${state.key}|far`).push(ck);
      }
    }
    for (const [id, list] of this.sources) {
      const bar = id.lastIndexOf('|');
      const key = id.slice(0, bar), tier = id.slice(bar + 1) as Tier;
      let slot = this.slots.get(id);
      if (!slot) {
        if (!list.length) continue;
        slot = this.makeSlot(key, tier) ?? undefined;
        if (!slot) continue;
      }
      const sig = this.signature(list, tier);
      if (sig === slot.sig) continue;
      slot.sig = sig;
      this.write(slot, list, seconds);
    }
  }

  private source(id: string): CellKind[] {
    let list = this.sources.get(id);
    if (!list) {
      list = [];
      this.sources.set(id, list);
    }
    return list;
  }

  /**
   * A number that changes when a set's contents would: which cells feed it, in order, and (for the
   * sets split by distance to the camera) which split. Two independent 32-bit hashes folded into one
   * double, so a false "unchanged" is out of the question in practice.
   */
  private signature(list: readonly CellKind[], tier: Tier): number {
    let a = 2166136261, b = 5381;
    for (const ck of list) {
      a = Math.imul(a ^ ck.id, 16777619);
      b = (Math.imul(b, 33) + ck.id) | 0;
      // A cell split per prop by distance holds whatever the last sort put on this side.
      if (tier === 'far' ? ck.splitFar : ck.splitHd || ck.tiers.near) {
        a = Math.imul(a ^ this.sortVersion, 16777619);
        b = (Math.imul(b, 33) + this.sortVersion) | 0;
      }
    }
    return (a >>> 0) * 2097152 + ((b >>> 0) & 2097151) + list.length + 1;
  }

  private write(slot: Slot, list: readonly CellKind[], seconds: number): void {
    const arr = slot.matrix.array as Float32Array, born = slot.born.array as Float32Array;
    const ox = this.origin.x, oz = this.origin.z;
    const tier = slot.tier;
    const r = this.kinds.get(slot.key)?.range;
    // The shader fades by the live camera, which is up to RECLASSIFY_M from where this sort stood.
    const slack = RECLASSIFY_M + 1;
    const near2 = NEAR_SHADOW_M * NEAR_SHADOW_M;
    const hd2 = r ? (r.hd + slack) ** 2 : Infinity;
    const farIn = r && !this.standing.has(slot.key) ? Math.max(0, r.hd - r.band - slack) : 0;
    const farIn2 = farIn * farIn, farOut2 = r ? (r.far + slack) ** 2 : Infinity;
    let count = 0, dropped = 0;
    for (const ck of list) {
      const at = tier === 'far' ? ck.bornFar : ck.bornHd;
      const stamp = at < 0 ? seconds : at;
      const split = tier === 'far' ? ck.splitFar : ck.splitHd || ck.tiers.near;
      if (!split) {
        // The whole cell.
        const fit = Math.min(ck.n, slot.capacity - count);
        dropped += ck.n - fit;
        if (fit > 0) {
          arr.set(fit === ck.n ? ck.matrices : ck.matrices.subarray(0, fit * 16), count * 16);
          born.fill(stamp, count, count + fit);
          count += fit;
        }
        continue;
      }
      // Prop by prop: `near` takes the close ones (they cast shadows), `hd` the rest within the
      // detailed model's reach, `far` those beyond where the simple model starts.
      const m = ck.matrices;
      for (let i = 0; i < ck.n; i++) {
        const o = i * 16;
        const dx = m[o + 12] - ox, dz = m[o + 14] - oz;
        const d2 = dx * dx + dz * dz;
        if (tier === 'far') {
          if (d2 < farIn2 || d2 > farOut2) continue;
        } else {
          const close = ck.tiers.near && d2 < near2;
          if (close !== (tier === 'near')) continue;
          if (d2 > hd2) continue;
        }
        if (count >= slot.capacity) {
          dropped++;
          continue;
        }
        arr.set(m.subarray(o, o + 16), count * 16);
        born[count] = stamp;
        count++;
      }
    }
    if (dropped > 0) {
      this.overflow += dropped;
      this.warnOnce(`cap:${slot.id}`, `[props] ${slot.id} is over its capacity ${slot.capacity}; ${dropped} instances hidden`);
    }
    slot.count = count;
    for (const attr of [slot.matrix, slot.born]) {
      attr.clearUpdateRanges();
      attr.addUpdateRange(0, count * attr.itemSize);
      attr.needsUpdate = true;
    }
    for (const mesh of slot.meshes) {
      mesh.count = count;
      mesh.visible = count > 0;
    }
  }

  private makeSlot(key: string, tier: Tier): Slot | null {
    const state = this.kinds.get(key);
    if (!state) return null;
    const t = this.templates.get(tier === 'far' ? state.farPath : state.hdPath);
    if (!t || t.state !== 'ready') return null;
    // The bake's capacity covers a 7 × 7 window of cells; the simple set may span more rings than that.
    const span = 2 * this.rings + 3;
    const windows = tier === 'far' ? Math.ceil(span / CAPACITY_WINDOW) ** 2 : 1;
    const capacity = Math.max(1, state.kind.capacity) * windows;
    const matrix = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 16), 16);
    matrix.setUsage(THREE.DynamicDrawUsage);
    const born = new THREE.InstancedBufferAttribute(new Float32Array(capacity), 1);
    born.setUsage(THREE.DynamicDrawUsage);
    const fade = new THREE.Vector4();
    this.setFade(fade, state, tier);
    const geometries: THREE.BufferGeometry[] = [];
    const materials: THREE.Material[] = [];
    const id = `${key}|${tier}`;
    const meshes = t.parts.map((p, i) => {
      const geometry = instancedGeometry(p.geometry, born);
      geometries.push(geometry);
      const fadeOne = (m: THREE.Material) => {
        const c = fadeMaterial(m, this.shared, fade);
        materials.push(c);
        return c;
      };
      const material = Array.isArray(p.material) ? p.material.map(fadeOne) : fadeOne(p.material);
      const mesh = new THREE.InstancedMesh(geometry, material, capacity);
      mesh.instanceMatrix = matrix;
      mesh.count = 0;
      mesh.visible = false;
      // The buffers hold only the cells in view (and, for `near`, the props close by).
      mesh.frustumCulled = false;
      mesh.castShadow = tier === 'near';
      mesh.receiveShadow = true;
      mesh.name = `${key}:${tier}:${i}`;
      this.root.add(mesh);
      return mesh;
    });
    const slot: Slot = { id, key, tier, template: t, meshes, geometries, materials, matrix, born, fade, capacity, count: 0, sig: 0 };
    this.slots.set(id, slot);
    return slot;
  }

  private retain(path: string, priority: Priority): void {
    let t = this.templates.get(path);
    if (!t) {
      t = { path, refs: 0, zeroSince: null, state: 'loading', parts: [], warm: [], disposed: false };
      this.templates.set(path, t);
      void this.loadTemplate(t, priority);
    }
    t.refs++;
    t.zeroSince = null;
  }

  private release(path: string): void {
    const t = this.templates.get(path);
    if (!t) return;
    t.refs = Math.max(0, t.refs - 1);
    if (t.refs === 0) t.zeroSince = this.host.now();
  }

  private async loadTemplate(t: Template, priority: Priority): Promise<void> {
    let scene: THREE.Group;
    try {
      scene = await this.host.load(t.path, priority);
    } catch (err) {
      t.state = 'failed';
      console.warn(`[props] ${t.path} failed to load; its instances stay hidden`, err);
      return;
    }
    if (t.disposed) return;
    scene.updateMatrixWorld(true);
    const textures = new Set<THREE.Texture>();
    scene.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      // Bake the sub-mesh's place in the prop into its geometry, so every sub-mesh takes the
      // same instance matrix and can share one instance buffer. Quantized GLBs store positions
      // as normalized Int16 with the scale on the node: writing metres back into that format
      // clamps every coordinate to ±1 (a 10 m tree became a 2 m block), so go to floats first.
      const g = floatAttributes(mesh.geometry.clone()).applyMatrix4(mesh.matrixWorld);
      mesh.geometry.dispose();
      t.parts.push({ geometry: g, material: mesh.material });
      for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
        // The environment kits' flowing water (waterfall sheets, mist, foam) runs on the world's water clock.
        if (m.name === 'fx_water') patchFlowingWater(m);
        // Their glow follows the vertex colours (glTF exports it as flat white).
        if (m.name === 'fx_glow') patchVertexColorGlow(m);
        for (const v of Object.values(m)) if (v instanceof THREE.Texture) textures.add(v);
      }
    });
    await Promise.all([...textures].map((tex) => this.host.uploadTexture(tex)));
    if (t.disposed) return;
    // Compile the programs the sets will draw with (instanced, with the fade), not on first draw.
    const warm = new THREE.Group();
    const born = new THREE.InstancedBufferAttribute(new Float32Array(1), 1);
    const fade = new THREE.Vector4(-2, -1, 1e9, 2e9);
    for (const p of t.parts) {
      const one = (m: THREE.Material) => {
        const c = fadeMaterial(m, this.shared, fade);
        t.warm.push(c);
        return c;
      };
      const mesh = new THREE.InstancedMesh(instancedGeometry(p.geometry, born), Array.isArray(p.material) ? p.material.map(one) : one(p.material), 1);
      mesh.receiveShadow = true;
      warm.add(mesh);
    }
    try {
      await this.host.compile(warm);
    } catch {
      // A failed warm-up only means the first draw compiles it.
    }
    if (t.disposed) return;
    t.state = 'ready';
    this.dirty = true;
  }

  private disposeTemplate(t: Template): void {
    t.disposed = true;
    this.templates.delete(t.path);
    for (const [id, s] of this.slots) {
      if (s.template !== t) continue;
      for (const m of s.meshes) {
        m.removeFromParent();
        m.dispose();
      }
      // The sets' geometries share the template's vertex buffers, which go with it just below.
      for (const g of s.geometries) g.dispose();
      for (const m of s.materials) m.dispose();
      this.slots.delete(id);
    }
    for (const m of t.warm) m.dispose();
    const mats = new Set<THREE.Material>();
    for (const p of t.parts) {
      p.geometry.dispose();
      for (const m of Array.isArray(p.material) ? p.material : [p.material]) mats.add(m);
    }
    for (const m of mats) {
      for (const v of Object.values(m)) if (v instanceof THREE.Texture) v.dispose();
      m.dispose();
    }
    this.dirty = true;
  }

  private warnOnce(id: string, msg: string): void {
    if (this.warned.has(id)) return;
    this.warned.add(id);
    console.warn(msg);
  }

  dispose(): void {
    for (const c of [...this.cells.values()]) this.removeCell(c.cx, c.cz);
    for (const t of [...this.templates.values()]) this.disposeTemplate(t);
  }
}

/**
 * A geometry for one instanced set: the model's own vertex buffers (shared, not copied) plus the
 * set's per-instance `aBorn`. It must be disposed together with the model's geometry, never before
 * it: disposing frees the shared buffers.
 */
function instancedGeometry(source: THREE.BufferGeometry, born: THREE.InstancedBufferAttribute): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setIndex(source.index);
  for (const [name, attr] of Object.entries(source.attributes)) g.setAttribute(name, attr);
  for (const group of source.groups) g.addGroup(group.start, group.count, group.materialIndex);
  g.boundingBox = source.boundingBox;
  g.boundingSphere = source.boundingSphere;
  g.setAttribute('aBorn', born);
  return g;
}

/** Replace quantized (normalized integer or interleaved) position and normal attributes with plain Float32 copies. */
export function floatAttributes(g: THREE.BufferGeometry): THREE.BufferGeometry {
  for (const name of ['position', 'normal']) {
    const a = g.getAttribute(name) as THREE.BufferAttribute | THREE.InterleavedBufferAttribute | undefined;
    if (!a) continue;
    const plain = !(a as THREE.InterleavedBufferAttribute).isInterleavedBufferAttribute && a.array instanceof Float32Array && !a.normalized;
    if (plain) continue;
    const out = new Float32Array(a.count * a.itemSize);
    for (let i = 0; i < a.count; i++) {
      out[i * a.itemSize] = a.getX(i);
      if (a.itemSize > 1) out[i * a.itemSize + 1] = a.getY(i);
      if (a.itemSize > 2) out[i * a.itemSize + 2] = a.getZ(i);
      if (a.itemSize > 3) out[i * a.itemSize + 3] = a.getW(i);
    }
    g.setAttribute(name, new THREE.BufferAttribute(out, a.itemSize));
  }
  return g;
}
