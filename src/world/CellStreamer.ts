import * as THREE from 'three';
import type { Priority, RequestQueue, Ticket } from '../assets/RequestQueue';
import { cellColliders, sampleHeight } from '../content/world/codec';
import { cellKey, cellOf, type CellColliders, type CellData, type CellEntry } from '../content/world/format';
import { Horizon } from './Horizon';
import { PropInstancer, type PropHost } from './PropInstancer';
import { publicUrl, type Region } from './RegionManifest';
import { RETRY_DELAYS_MS, planRings, prefetchCells, withRetry, type CellLevel, type CellXZ } from './rings';
import type { TerrainBuilder } from './TerrainBuilder';
import { TerrainChunk, terrainMaterial } from './TerrainChunk';
import type { UploadBudget } from './UploadBudget';

/**
 * The sim's side of streaming, exactly as SimWorld exposes it (the app never touches Rapier):
 * colliders go in through loadCell (queued, built at the top of a tick, ≤ 96 per tick) and out
 * through unloadCell.
 */
export interface CellSink {
  loadCell(c: CellColliders): void;
  /** False when the sim refuses (an anchored cell: someone stands on it); its colliders stay. */
  unloadCell(cx: number, cz: number): boolean | void;
}

/** What the streamer reads from the ReadonlySimView. */
export interface CellView {
  cellAnchors(): [number, number][];
  cellReady(cx: number, cz: number): boolean;
  readonly waitingForGround: boolean;
}

export interface StreamerHost {
  queue: RequestQueue;
  builder: TerrainBuilder;
  uploads: UploadBudget;
  props: PropHost;
  grass: THREE.Texture;
  rock: THREE.Texture;
  sleep(ms: number): Promise<void>;
}

interface Payload {
  bin: ArrayBuffer;
  json: CellData;
}

interface Fetch {
  promise: Promise<Payload>;
  tickets: Ticket<unknown>[];
  priority: Priority;
  cancelled: boolean;
}

interface Cell {
  cx: number;
  cz: number;
  key: string;
  entry: CellEntry;
  level: CellLevel;
  priority: Priority;
  anchored: boolean;
  data: Payload | null;
  fetching: boolean;
  failed: boolean;
  heights: Float32Array | null;
  chunk: TerrainChunk | null;
  /** Resolution being built in the worker (0: none). */
  building: number;
  colliders: boolean;
  props: boolean;
  /** Bumped when the cell unloads, so late async results for it are dropped. */
  gen: number;
}

/** Raw cell payloads kept after a cell unloads (and prefetched ones): the whole 8 × 8 region fits. */
const CACHE_CELLS = 72;
/** Worker builds in flight at once. */
const MAX_BUILDS = 4;
/** Prefetch only while the shared queue is this short, so it never delays a needed cell. */
const PREFETCH_QUEUE_LIMIT = 6;

export interface StreamerCounters {
  /** Cells with terrain showing, and by level. */
  loaded: number;
  active: number;
  visual: number;
  /** Cells wanted but without data yet. */
  pending: number;
  /** Cell fetches waiting in the shared queue, and running. */
  queued: number;
  inFlight: number;
  fetched: number;
  prefetched: number;
  unloaded: number;
  retries: number;
  failed: number;
  builds: number;
  collidersLoaded: number;
  collidersUnloaded: number;
  cached: number;
}

/**
 * Streams a region's cells around the player (plan §3.2–3.4): ring policy from world/rings.ts,
 * fetches through the shared NOW/LATER queue with 3 retries, decode and meshing in
 * terrain.worker.ts, ≤ 4 geometry uploads per frame, colliders into the sim for Active cells, and
 * props into the global instancer. The horizon fills every cell without terrain.
 */
export class CellStreamer {
  readonly root = new THREE.Group();
  readonly props: PropInstancer;
  readonly horizon: Horizon;
  private readonly terrain = new THREE.Group();
  private readonly material: THREE.MeshStandardMaterial;
  private readonly cells = new Map<string, Cell>();
  private readonly cache = new Map<string, Payload>();
  private readonly fetches = new Map<string, Fetch>();
  private sink: CellSink | null = null;
  private maskDirty = true;
  private tick = 0;
  readonly counters: StreamerCounters = {
    loaded: 0, active: 0, visual: 0, pending: 0, queued: 0, inFlight: 0, fetched: 0, prefetched: 0, unloaded: 0, retries: 0, failed: 0, builds: 0,
    collidersLoaded: 0, collidersUnloaded: 0, cached: 0,
  };

  constructor(readonly region: Region, private readonly host: StreamerHost) {
    const m = region.manifest;
    this.root.name = 'world';
    this.terrain.name = 'terrain';
    this.material = terrainMaterial(host.grass, host.rock, m.splatLayers);
    this.props = new PropInstancer(m.props, host.props);
    this.horizon = new Horizon(m);
    this.root.add(this.terrain, this.props.root, this.horizon.root);
  }

  /** The terrain material, for warming its program before the first cell shows. */
  get terrainMaterial(): THREE.Material {
    return this.material;
  }

  /** Start sending colliders to a sim (a new SimWorld has none, so every Active cell goes again). */
  attach(sink: CellSink): void {
    this.sink = sink;
    for (const c of this.cells.values()) c.colliders = false;
  }

  /** The sim is going away: forget what it had. */
  detach(): void {
    this.sink = null;
    for (const c of this.cells.values()) c.colliders = false;
  }

  /**
   * One frame of streaming around `focus` (the player, or the title camera's spot). `view` is the
   * sim's view while playing (anchors), `tick` the sim tick (or a frame count on the title).
   */
  update(focus: { x: number; z: number; vx: number; vz: number }, view: CellView | null, tick: number): void {
    this.tick = tick;
    const cs = this.region.cellSize;
    const players: CellXZ[] = [cellOf(focus.x, focus.z)];
    const anchors = view ? view.cellAnchors() : [];
    const current = new Map<string, CellLevel>();
    for (const c of this.cells.values()) current.set(c.key, c.level);
    const plan = planRings({ players, anchors, current, inRegion: this.region.has });

    for (const k of plan.unload) this.unload(this.cells.get(k)!);
    for (const w of plan.want) {
      let c = this.cells.get(w.key);
      if (!c) {
        c = this.makeCell(w.cx, w.cz, w.level);
        this.cells.set(w.key, c);
      }
      if (c.level !== w.level) {
        c.level = w.level;
        if (c.props) this.props.setLevel(c.cx, c.cz, c.level);
      }
      c.anchored = w.anchored;
      if (c.priority !== w.priority) {
        c.priority = w.priority;
        if (w.priority === 'now') this.promote(c.key);
      }
    }

    for (const w of plan.want) this.pump(this.cells.get(w.key)!);

    // Prefetch along the velocity: raw data only, into the cache.
    if (this.host.queue.queued < PREFETCH_QUEUE_LIMIT) {
      const skip = new Set<string>([...this.cells.keys(), ...this.cache.keys(), ...this.fetches.keys()]);
      for (const [cx, cz] of prefetchCells({ x: focus.x, z: focus.z }, { x: focus.vx, z: focus.vz }, cs, this.region.has, skip)) {
        if (this.host.queue.queued >= PREFETCH_QUEUE_LIMIT) break;
        this.request(cx, cz, 'later').then(() => this.counters.prefetched++, () => {});
      }
    }

    this.props.update(focus.x, focus.z, cs, tick);
    if (this.maskDirty) {
      this.maskDirty = false;
      const shown: [number, number][] = [];
      for (const c of this.cells.values()) if (c.chunk) shown.push([c.cx, c.cz]);
      this.horizon.setLoaded(shown);
    }
    this.count();
  }

  private makeCell(cx: number, cz: number, level: CellLevel): Cell {
    const key = cellKey(cx, cz);
    return {
      cx, cz, key, entry: this.region.entry(cx, cz)!, level, priority: 'later', anchored: false, data: null, fetching: false, failed: false,
      heights: null, chunk: null, building: 0, colliders: false, props: false, gen: 0,
    };
  }

  /** Move one cell along: fetch, build at its level's resolution, colliders, props. */
  private pump(c: Cell): void {
    if (!c.data && !c.fetching && !c.failed) {
      const cached = this.cache.get(c.key);
      if (cached) {
        this.touch(c.key, cached);
        c.data = cached;
      } else this.fetchFor(c);
    }
    const res = c.level === 'active' ? 64 : 32;
    if (c.data && !c.building && c.chunk?.res !== res && this.host.builder.inFlight < MAX_BUILDS) this.build(c, res);

    const sink = this.sink;
    if (sink) {
      if (c.level === 'active' && c.heights && c.data && !c.colliders) {
        sink.loadCell(cellColliders(c.data.json, c.heights, this.region.manifest));
        c.colliders = true;
        this.counters.collidersLoaded++;
      } else if (c.level === 'visual' && c.colliders && !c.anchored && sink.unloadCell(c.cx, c.cz) !== false) {
        c.colliders = false;
        this.counters.collidersUnloaded++;
      }
    }
    // Props arrive with the terrain, so nothing floats over the horizon mesh.
    if (c.chunk && c.data && !c.props) {
      this.props.addCell(c.cx, c.cz, c.data.json, c.level, this.tick);
      c.props = true;
    }
  }

  private fetchFor(c: Cell): void {
    c.fetching = true;
    const gen = c.gen;
    this.request(c.cx, c.cz, c.priority).then(
      (p) => {
        if (c.gen !== gen) return;
        c.fetching = false;
        c.data = p;
      },
      (err: unknown) => {
        if (c.gen !== gen) return;
        c.fetching = false;
        if (err instanceof Error && (err.name === 'CancelledError' || err.name === 'AbortError')) return;
        c.failed = true;
        this.counters.failed++;
        console.warn(`[world] cell ${c.key} failed to load after ${RETRY_DELAYS_MS.length} retries`, err);
      },
    );
  }

  /** Fetch a cell's .bin and .json (two queued requests, each retried), shared by cells and prefetch. */
  private request(cx: number, cz: number, priority: Priority): Promise<Payload> {
    const key = cellKey(cx, cz);
    const have = this.cache.get(key);
    if (have) return Promise.resolve(have);
    const existing = this.fetches.get(key);
    if (existing) {
      if (priority === 'now') this.promote(key);
      return existing.promise;
    }
    const entry = this.region.entry(cx, cz)!;
    const f: Fetch = { promise: null!, tickets: [], priority, cancelled: false };
    const get = <T>(path: string, read: (r: Response) => Promise<T>): Promise<T> =>
      withRetry(
        () => {
          const t = this.host.queue.run(async (signal) => {
            const r = await fetch(publicUrl(path), { signal });
            if (!r.ok) throw new Error(`${path}: HTTP ${r.status}`);
            return read(r);
          }, f.priority);
          f.tickets.push(t);
          return t.promise;
        },
        this.host.sleep,
        () => !f.cancelled,
        RETRY_DELAYS_MS,
        () => this.counters.retries++,
      );
    f.promise = Promise.all([get(entry.bin, (r) => r.arrayBuffer()), get(entry.json, (r) => r.json() as Promise<CellData>)]).then(
      ([bin, json]) => {
        this.fetches.delete(key);
        const p = { bin, json };
        this.touch(key, p);
        this.counters.fetched++;
        return p;
      },
      (err: unknown) => {
        this.fetches.delete(key);
        throw err;
      },
    );
    this.fetches.set(key, f);
    return f.promise;
  }

  private promote(key: string): void {
    const f = this.fetches.get(key);
    if (!f || f.priority === 'now') return;
    f.priority = 'now';
    for (const t of f.tickets) t.promote();
  }

  /** LRU insert. */
  private touch(key: string, p: Payload): void {
    this.cache.delete(key);
    this.cache.set(key, p);
    while (this.cache.size > CACHE_CELLS) {
      const oldest = this.cache.keys().next().value!;
      this.cache.delete(oldest);
    }
  }

  private build(c: Cell, res: 64 | 32): void {
    c.building = res;
    const gen = c.gen;
    this.counters.builds++;
    this.host.builder.build(c.data!.bin, this.region.manifest.heightRange, c.cx, c.cz, res).then(
      (r) => {
        if (c.gen !== gen) return;
        c.heights = r.heights;
        // The mesh goes up within the per-frame upload budget; colliders don't wait for it.
        this.host.uploads.geometry(() => {
          c.building = 0;
          if (c.gen !== gen) return;
          const chunk = new TerrainChunk(c.cx, c.cz, r.mesh, this.material);
          c.chunk?.dispose();
          c.chunk = chunk;
          this.terrain.add(chunk.mesh);
          this.maskDirty = true;
        });
      },
      (err: unknown) => {
        if (c.gen !== gen) return;
        c.building = 0;
        c.failed = true;
        this.counters.failed++;
        console.warn(`[world] cell ${c.key} could not be built`, err);
      },
    );
  }

  private unload(c: Cell): void {
    c.gen++;
    const f = this.fetches.get(c.key);
    if (f && c.fetching && f.priority === 'later') {
      // Still waiting in the queue for a cell that's gone: drop it (a running request finishes
      // into the cache).
      f.cancelled = true;
      for (const t of f.tickets) t.cancel();
    }
    if (c.chunk) {
      c.chunk.dispose();
      c.chunk = null;
      this.maskDirty = true;
    }
    if (c.props) this.props.removeCell(c.cx, c.cz);
    if (c.colliders && this.sink && this.sink.unloadCell(c.cx, c.cz) !== false) this.counters.collidersUnloaded++;
    this.cells.delete(c.key);
    this.counters.unloaded++;
  }

  /** Cells that failed their retries get another go (the veil's Retry). */
  retryFailed(): void {
    for (const c of this.cells.values()) c.failed = false;
  }

  /**
   * The player's cell and its neighbours have colliders in the sim (plan §3.2: Loading → Playing
   * needs them). Cells outside the region don't count.
   */
  groundReady(view: CellView, x: number, z: number): boolean {
    if (view.waitingForGround) return false;
    const [px, pz] = cellOf(x, z);
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (this.region.has(px + dx, pz + dz) && !view.cellReady(px + dx, pz + dz)) return false;
      }
    }
    return true;
  }

  /** Terrain height (m) at a world point, if its cell's heights are decoded. */
  heightAt(x: number, z: number): number | null {
    const [cx, cz] = cellOf(x, z);
    const c = this.cells.get(cellKey(cx, cz));
    return c?.heights ? sampleHeight(c.heights, cx, cz, x, z) : null;
  }

  /** A cell's raw payload once its terrain is showing, for the grass to scatter over. */
  grassSource(cx: number, cz: number): { bin: ArrayBuffer; json: CellData } | null {
    const c = this.cells.get(cellKey(cx, cz));
    return c?.chunk && c.data ? c.data : null;
  }

  /** Loaded cells by level, for the overlay's ring view. */
  rings(): { key: string; cx: number; cz: number; level: CellLevel; shown: boolean; colliders: boolean }[] {
    return [...this.cells.values()].map((c) => ({ key: c.key, cx: c.cx, cz: c.cz, level: c.level, shown: !!c.chunk, colliders: c.colliders }));
  }

  private count(): void {
    const k = this.counters;
    k.loaded = k.active = k.visual = k.pending = 0;
    for (const c of this.cells.values()) {
      if (c.chunk) k.loaded++;
      if (c.level === 'active') k.active++;
      else k.visual++;
      if (!c.data) k.pending++;
    }
    k.queued = this.host.queue.queued;
    k.inFlight = this.host.queue.active;
    k.cached = this.cache.size;
  }

  dispose(): void {
    for (const c of [...this.cells.values()]) this.unload(c);
    for (const f of this.fetches.values()) {
      f.cancelled = true;
      for (const t of f.tickets) t.cancel();
    }
    this.fetches.clear();
    this.cache.clear();
    this.props.dispose();
    this.horizon.dispose();
    this.material.dispose();
    this.root.removeFromParent();
  }
}
