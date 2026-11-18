import * as THREE from 'three';
import type { Priority } from '../assets/RequestQueue';
import type { CellData, PropKind } from '../content/world/format';
import { cellKey } from '../content/world/format';
import { chebyshev, distanceToCell, propBucket, type CellLevel, type CellXZ, type PropBucket } from './rings';

/** Ticks between a cell's LOD re-buckets (plan §3.4). */
export const REBUCKET_TICKS = 15;
/** A template nobody uses is kept this long in case it comes straight back (plan §3.3). */
export const TEMPLATE_GRACE_MS = 10_000;

const BUCKET_NAMES = ['lod0-shadow', 'lod0', 'lod1'] as const;

/** What the instancer needs from the outside: loading, and GPU warm-up spread over frames. */
export interface PropHost {
  load(path: string, priority: Priority): Promise<THREE.Group>;
  /** Queue a texture upload (≤ 2 per frame, world/UploadBudget.ts). */
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
  disposed: boolean;
}

/** One (prop, bucket) InstancedMesh set: one InstancedMesh per sub-mesh, sharing one matrix buffer. */
interface Slot {
  key: string;
  bucket: PropBucket;
  template: Template;
  meshes: THREE.InstancedMesh[];
  matrix: THREE.InstancedBufferAttribute;
  capacity: number;
  count: number;
  owner: (Assignment | null)[];
}

/** A cell's instances of one prop: where they're drawn now, and which template it wants. */
interface Assignment {
  key: string;
  packed: number[];
  slot: Slot | null;
  indices: number[];
  wantPath: string | null;
}

interface PropCell {
  key: string;
  cx: number;
  cz: number;
  level: CellLevel;
  nextRebucket: number;
  props: Map<string, Assignment>;
}

/**
 * The global prop instancer (plan §3.4): ONE InstancedMesh per (prop, LOD bucket) across every
 * loaded cell, created at the manifest's baked `capacity` and never resized, so draw calls scale
 * with prop kinds, not cells. Cells add their instances and swap-remove them when they leave or
 * change bucket. Buckets, per cell: LOD0 casting shadows (≤ 60 m), LOD0 (≤ 70 m), LOD1 (≤ 180 m,
 * and every Visual-ring cell), else hidden unless a landmark. Templates are refcounted by the
 * cells that want or show them and disposed 10 s after the last one lets go.
 */
/** Kinds that skip the shadow pass: the quarry's rock walls alone cost 158k shadow triangles. */
const NO_SHADOW: ReadonlySet<string> = new Set(['quarry_rock']);

export class PropInstancer {
  readonly root = new THREE.Group();
  private readonly templates = new Map<string, Template>();
  private readonly slots = new Map<string, Slot>();
  private readonly cells = new Map<string, PropCell>();
  private dirty = false;
  /** Cells added since the last update: bucketed at once, not on their staggered tick. */
  private readonly fresh = new Set<string>();
  private stagger = 0;
  /** Instances that didn't fit their slot's capacity (should stay 0; the bake sizes capacities). */
  overflow = 0;
  private readonly warned = new Set<string>();

  constructor(private readonly kinds: Readonly<Record<string, PropKind>>, private readonly host: PropHost) {
    this.root.name = 'props';
  }

  /** Counters for the overlay and the lap test. */
  stats(): { templates: number; ready: number; slots: number; instances: number; overflow: number } {
    let instances = 0;
    for (const s of this.slots.values()) instances += s.count;
    let ready = 0;
    for (const t of this.templates.values()) if (t.state === 'ready') ready++;
    return { templates: this.templates.size, ready, slots: this.slots.size, instances, overflow: this.overflow };
  }

  addCell(cx: number, cz: number, data: CellData, level: CellLevel, tick: number): void {
    const key = cellKey(cx, cz);
    if (this.cells.has(key)) this.removeCell(cx, cz);
    const props = new Map<string, Assignment>();
    for (const [k, packed] of Object.entries(data.props)) {
      if (!this.kinds[k]) {
        this.warnOnce(k, `[props] cell ${key} places unknown prop "${k}"`);
        continue;
      }
      if (packed.length >= 5) props.set(k, { key: k, packed, slot: null, indices: [], wantPath: null });
    }
    // Stagger re-buckets so 49 cells don't all re-bucket on the same tick.
    this.cells.set(key, { key, cx, cz, level, nextRebucket: tick + (this.stagger++ % REBUCKET_TICKS), props });
    this.fresh.add(key);
  }

  setLevel(cx: number, cz: number, level: CellLevel): void {
    const c = this.cells.get(cellKey(cx, cz));
    if (c && c.level !== level) {
      c.level = level;
      c.nextRebucket = 0;
    }
  }

  removeCell(cx: number, cz: number): void {
    const key = cellKey(cx, cz);
    const c = this.cells.get(key);
    if (!c) return;
    for (const a of c.props.values()) {
      this.unshow(a);
      this.setWant(a, null, 'later');
    }
    this.cells.delete(key);
  }

  /**
   * Re-bucket the cells that are due (every 15 ticks each, staggered), place newly ready
   * templates, and dispose templates past their grace period.
   */
  update(x: number, z: number, cellSize: number, tick: number): void {
    const here: CellXZ = [Math.floor(x / cellSize), Math.floor(z / cellSize)];
    const all = this.dirty;
    this.dirty = false;
    for (const c of this.cells.values()) {
      if (!all && tick < c.nextRebucket && !this.fresh.has(c.key)) continue;
      c.nextRebucket = tick + REBUCKET_TICKS;
      const meters = distanceToCell(x, z, c.cx, c.cz, cellSize);
      const ring = chebyshev([c.cx, c.cz], here);
      for (const a of c.props.values()) this.rebucket(a, propBucket(meters, c.level, ring, !!this.kinds[a.key].landmark));
    }
    this.fresh.clear();
    const now = this.host.now();
    for (const t of [...this.templates.values()]) {
      if (t.refs === 0 && t.zeroSince !== null && now - t.zeroSince >= TEMPLATE_GRACE_MS) this.disposeTemplate(t);
    }
  }

  private pathFor(key: string, bucket: PropBucket): string {
    const k = this.kinds[key];
    return bucket === 2 ? (k.lod1Path ?? k.path) : k.path;
  }

  private rebucket(a: Assignment, bucket: PropBucket | null): void {
    const wantPath = bucket === null ? null : this.pathFor(a.key, bucket);
    this.setWant(a, wantPath, bucket === 0 ? 'now' : 'later');
    let target: Slot | null = null;
    if (bucket !== null) {
      // The wanted LOD if it's ready, else the other one while the wanted one loads.
      target = this.slotIfReady(a.key, bucket);
      if (!target) target = this.slotIfReady(a.key, bucket === 2 ? 1 : 2);
    }
    if (target === a.slot) return;
    this.unshow(a);
    if (target) this.show(a, target);
  }

  private setWant(a: Assignment, path: string | null, priority: Priority): void {
    if (path === a.wantPath) return;
    if (path) this.retain(path, priority);
    if (a.wantPath) this.release(a.wantPath);
    a.wantPath = path;
  }

  private slotIfReady(key: string, bucket: PropBucket): Slot | null {
    const path = this.pathFor(key, bucket);
    const t = this.templates.get(path);
    if (!t || t.state !== 'ready') return null;
    const id = `${key}|${bucket}`;
    let s = this.slots.get(id);
    if (!s) {
      s = this.makeSlot(key, bucket, t);
      this.slots.set(id, s);
    }
    return s;
  }

  private makeSlot(key: string, bucket: PropBucket, t: Template): Slot {
    const capacity = Math.max(1, this.kinds[key].capacity);
    const matrix = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 16), 16);
    matrix.setUsage(THREE.DynamicDrawUsage);
    const meshes = t.parts.map((p, i) => {
      const m = new THREE.InstancedMesh(p.geometry, p.material, capacity);
      m.instanceMatrix = matrix;
      m.count = 0;
      m.visible = false;
      // One mesh spans every loaded cell, so culling it as a whole would almost never cull.
      m.frustumCulled = false;
      m.castShadow = bucket === 0 && !NO_SHADOW.has(key);
      m.receiveShadow = true;
      m.name = `${key}:${BUCKET_NAMES[bucket]}:${i}`;
      this.root.add(m);
      return m;
    });
    return { key, bucket, template: t, meshes, matrix, capacity, count: 0, owner: new Array<Assignment | null>(capacity).fill(null) };
  }

  private show(a: Assignment, s: Slot): void {
    const n = Math.floor(a.packed.length / 5);
    const fit = Math.min(n, s.capacity - s.count);
    if (fit < n) {
      this.overflow += n - fit;
      this.warnOnce(`cap:${s.key}`, `[props] ${s.key} is over its capacity ${s.capacity}; ${n - fit} instances hidden`);
    }
    const arr = s.matrix.array as Float32Array;
    for (let i = 0; i < fit; i++) {
      const p = i * 5;
      const x = a.packed[p], y = a.packed[p + 1], z = a.packed[p + 2], yaw = a.packed[p + 3], sc = a.packed[p + 4];
      const c = Math.cos(yaw) * sc, sn = Math.sin(yaw) * sc;
      const o = s.count * 16;
      // T · Ry(yaw) · S(scale), column-major (the same yaw sense as the sim's box colliders).
      arr[o] = c;
      arr[o + 1] = 0;
      arr[o + 2] = -sn;
      arr[o + 3] = 0;
      arr[o + 4] = 0;
      arr[o + 5] = sc;
      arr[o + 6] = 0;
      arr[o + 7] = 0;
      arr[o + 8] = sn;
      arr[o + 9] = 0;
      arr[o + 10] = c;
      arr[o + 11] = 0;
      arr[o + 12] = x;
      arr[o + 13] = y;
      arr[o + 14] = z;
      arr[o + 15] = 1;
      s.owner[s.count] = a;
      a.indices.push(s.count);
      s.count++;
    }
    a.slot = s;
    this.retain(s.template.path, 'later');
    this.commit(s);
  }

  /** Swap-remove a cell's instances from its slot: each hole takes the slot's last instance. */
  private unshow(a: Assignment): void {
    const s = a.slot;
    if (!s) return;
    const arr = s.matrix.array as Float32Array;
    const holes = a.indices.slice().sort((p, q) => q - p);
    for (const h of holes) {
      const last = s.count - 1;
      if (h !== last) {
        arr.copyWithin(h * 16, last * 16, last * 16 + 16);
        const moved = s.owner[last]!;
        moved.indices[moved.indices.indexOf(last)] = h;
        s.owner[h] = moved;
      }
      s.owner[last] = null;
      s.count--;
    }
    a.indices.length = 0;
    a.slot = null;
    this.release(s.template.path);
    this.commit(s);
  }

  private commit(s: Slot): void {
    s.matrix.clearUpdateRanges();
    s.matrix.addUpdateRange(0, s.count * 16);
    s.matrix.needsUpdate = true;
    for (const m of s.meshes) {
      m.count = s.count;
      m.visible = s.count > 0;
    }
  }

  private retain(path: string, priority: Priority): void {
    let t = this.templates.get(path);
    if (!t) {
      t = { path, refs: 0, zeroSince: null, state: 'loading', parts: [], disposed: false };
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
        for (const v of Object.values(m)) if (v instanceof THREE.Texture) textures.add(v);
      }
    });
    await Promise.all([...textures].map((tex) => this.host.uploadTexture(tex)));
    if (t.disposed) return;
    // Compile the instanced programs now (in parallel where the driver can), not on first draw.
    const warm = new THREE.Group();
    for (const p of t.parts) warm.add(new THREE.InstancedMesh(p.geometry, p.material, 1));
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
      this.slots.delete(id);
    }
    const mats = new Set<THREE.Material>();
    for (const p of t.parts) {
      p.geometry.dispose();
      for (const m of Array.isArray(p.material) ? p.material : [p.material]) mats.add(m);
    }
    for (const m of mats) {
      for (const v of Object.values(m)) if (v instanceof THREE.Texture) v.dispose();
      m.dispose();
    }
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

