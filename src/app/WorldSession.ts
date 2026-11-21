import * as THREE from 'three';
import type { AssetLoader } from '../assets/AssetLoader';
import { TEXTURES } from '../assets/manifest';
import { cellOf } from '../content/world/format';
import { regionAt } from '../content/world/regions';
import type { Renderer } from '../render/Renderer';
import { CellStreamer, type CellSink, type CellView } from '../world/CellStreamer';
import { GrassField } from '../world/GrassField';
import { loadWorld, propPath, type Region, type WorldManifest } from '../world/RegionManifest';
import { VEIL_TIMEOUT_MS, viewRings, viewScale, withRetry, type ViewQuality } from '../world/rings';
import { TerrainBuilder } from '../world/TerrainBuilder';
import { textureBytes, type UploadBudget } from '../world/UploadBudget';
import { WaterLayer, waterClock } from '../world/Water';

export type GroundState = 'ready' | 'loading' | 'timeout';

const sleep = (ms: number) => new Promise<void>((r) => window.setTimeout(r, ms));

/**
 * The streamed world around the game shell (M2): loads the region manifest, owns the cell
 * streamer, the terrain workers and the per-frame upload budget, and tracks the loading veil's
 * timeout (plan §2.9). Streaming starts on the title screen around the player start, so Play finds
 * its cells already fetched and meshed and only waits for the sim to build colliders.
 */
export class WorldSession {
  region: Region | null = null;
  streamer: CellStreamer | null = null;
  private builder: TerrainBuilder | null = null;
  private grass: GrassField | null = null;
  private water: WaterLayer | null = null;
  /** Overworld horizons still to load once play starts. */
  private farHorizons: string[] = [];
  private loading: Promise<Region> | null = null;
  /** When the veil went up for missing ground (performance.now ms), or null. */
  private veilSince: number | null = null;
  private readonly lookDir = new THREE.Vector3();

  /** `uploads` is the app's per-frame GPU upload budget; the app runs it once a frame. */
  constructor(private readonly renderer: Renderer, private readonly assets: AssetLoader, readonly uploads: UploadBudget, private grassOn = true) {}

  private quality: ViewQuality = 'high';
  private playing = false;
  private cave = false;

  /** The graphics quality: how many rings of the world are shown, and how far each prop is drawn. */
  setQuality(quality: ViewQuality): void {
    this.quality = quality;
    this.applyView();
  }

  /**
   * Behind the title only the nearest two rings stream (the title has a download budget, and Play
   * needs just the ground under the player). In play the view opens to what the quality allows.
   */
  setPlaying(on: boolean): void {
    this.playing = on;
    this.applyView();
  }

  /** In the Rootdeep the cave's own fog ends at 180 m: more rings would load cave nobody can see. */
  setCave(on: boolean): void {
    if (on === this.cave) return;
    this.cave = on;
    this.applyView();
  }

  private applyView(): void {
    const wide = this.playing && !this.cave;
    this.streamer?.setView(wide ? viewRings(this.quality) : viewRings('low'), viewScale(this.quality));
  }

  /** The Grass setting. */
  setGrass(on: boolean): void {
    this.grassOn = on;
    if (this.grass) this.grass.enabled = on;
  }

  /** Load every region as one world (3 retries) and set up streaming. Safe to call again after a failure. */
  load(): Promise<Region> {
    this.loading ??= withRetry(() => loadWorld(), sleep).then(
      (region) => {
        this.setup(region);
        return region;
      },
      (err: unknown) => {
        this.loading = null;
        throw err;
      },
    );
    return this.loading;
  }

  private setup(region: Region): void {
    this.region = region;
    const m = region.manifest;
    this.renderer.worldLook({ fog: m.fog });
    this.builder = new TerrainBuilder();
    const grass = this.assets.texture(TEXTURES.groundGrass);
    const rock = this.assets.texture(TEXTURES.stone);
    const streamer = new CellStreamer(region, {
      queue: this.assets.queue,
      builder: this.builder,
      uploads: this.uploads,
      grass,
      rock,
      sleep,
      props: {
        // A prop that fails keeps trying: its instances stay hidden only until the file arrives.
        load: (path, priority) => this.assets.gltf(propPath(path), priority, true).then((g) => g.scene),
        uploadTexture: (tex) =>
          new Promise<void>((resolve) =>
            this.uploads.texture(() => {
              this.renderer.renderer.initTexture(tex);
              resolve();
            }, textureBytes(tex)),
          ),
        compile: (obj) => this.renderer.compile(obj),
        now: () => performance.now(),
      },
    });
    this.streamer = streamer;
    this.applyView();
    this.renderer.scene.add(streamer.root);
    // Warm the terrain program before the first cell lands (it would compile on its first draw).
    const probe = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), streamer.terrainMaterial);
    probe.receiveShadow = true;
    void this.renderer.compile(probe).finally(() => probe.geometry.dispose());
    const field = new GrassField(Math.max(0, m.splatLayers.indexOf('grass')), m.props, m.heightRange);
    field.enabled = this.grassOn;
    this.grass = field;
    streamer.root.add(field.root);
    void this.renderer.compile(field.root);
    // Rivers, pools and falls: a few meshes for the whole world, resident like the horizon.
    if (m.water?.length) {
      // Past the fog's far edge the water is fully fogged: those tiles aren't drawn.
      const water = new WaterLayer(m.water, m.fog.far);
      this.water = water;
      streamer.root.add(water.root);
      void this.renderer.compile(water.root);
    }
    // The horizons are resident for the whole session: one per overworld region. Only the start
    // region's loads behind the title (scripts/check-budgets.mjs and the loading e2e count it); the
    // rest wait for Play (loadFarHorizons), since the fog hides most of a neighbour's far ground.
    const horizons = (m as Partial<WorldManifest>).horizons ?? [m.horizon];
    const [sx, , sz] = m.playerStart.pos;
    const startHorizon = `world/${regionAt(sx, sz).id}/`;
    this.farHorizons = horizons.filter((path) => !path.startsWith(startHorizon));
    for (const path of horizons) if (path.startsWith(startHorizon)) this.loadHorizon(path, 'now');
  }

  /** The other regions' horizons, once play has started (at low priority, behind the cells). */
  loadFarHorizons(): void {
    const paths = this.farHorizons;
    this.farHorizons = [];
    for (const path of paths) this.loadHorizon(path, 'later');
  }

  private loadHorizon(path: string, priority: 'now' | 'later'): void {
    const streamer = this.streamer;
    if (!streamer) return;
    this.assets.gltf(path, priority).then(
      (g) => {
        if (this.streamer !== streamer) return;
        streamer.horizon.attach(g.scene);
        void this.renderer.compile(streamer.horizon.root);
      },
      (err: unknown) => console.warn(`[world] horizon ${path} failed to load; distant terrain there stays empty`, err),
    );
  }

  /** The manifest's player start. */
  get start(): { pos: [number, number, number]; yaw: number } | null {
    return this.region?.manifest.playerStart ?? null;
  }

  /**
   * One frame of streaming around `focus` (the app has already spent this frame's upload budget).
   * What the camera faces is asked for first.
   */
  frame(focus: { x: number; z: number; vx: number; vz: number }, view: CellView | null): void {
    if (!this.streamer) return;
    waterClock.value = performance.now() / 1000;
    const cam = this.renderer.camera;
    cam.getWorldDirection(this.lookDir);
    this.streamer.update(focus, view, { x: cam.position.x, z: cam.position.z, dx: this.lookDir.x, dz: this.lookDir.z });
    this.water?.update(focus.x, focus.z);
    this.grass?.update(focus.x, focus.z, performance.now() / 1000, this.streamer);
  }

  /**
   * Just before the draw, with the camera where this frame shows it: the props in view go into
   * their instance buffers and the fades move on (world/PropInstancer.ts).
   */
  present(): void {
    const s = this.streamer;
    if (!s) return;
    const cam = this.renderer.camera;
    cam.updateMatrixWorld();
    const ground = s.heightAt(cam.position.x, cam.position.z);
    s.props.present(cam, performance.now() / 1000, s.region.cellSize, ground === null ? null : cam.position.y - ground);
  }

  attach(sim: CellSink): void {
    this.streamer?.attach(sim);
    this.veilSince = null;
  }

  detach(): void {
    this.streamer?.detach();
    this.veilSince = null;
  }

  /**
   * Whether the player may play: the ground around them has colliders (plan §3.2). While not, the
   * veil shows, and it lifts only when the whole 3 × 3 is ready; after 15 s it times out and the app
   * offers Retry / Return to start.
   */
  ground(view: CellView, pos: { x: number; z: number }): GroundState {
    const s = this.streamer;
    if (!s || s.groundReady(view, pos.x, pos.z, this.veilSince === null)) {
      this.veilSince = null;
      return 'ready';
    }
    const now = performance.now();
    this.veilSince ??= now;
    return now - this.veilSince >= VEIL_TIMEOUT_MS ? 'timeout' : 'loading';
  }

  /** Back from a pause: nothing loads colliders meanwhile, so the veil's 15 s start over. */
  restartVeilClock(): void {
    if (this.veilSince !== null) this.veilSince = performance.now();
  }

  /** The veil's Retry: failed cells fetch again and the 15 s clock restarts. */
  retry(): void {
    this.streamer?.retryFailed();
    this.veilSince = null;
  }

  heightAt(x: number, z: number): number | null {
    return this.streamer?.heightAt(x, z) ?? null;
  }

  /** The debug overlay's world lines: counters and a 7 × 7 ring map around the player. */
  overlayLines(pos: { x: number; z: number } | null): string[] {
    const s = this.streamer;
    if (!s) return [this.loading ? 'world: loading manifest' : 'world: none'];
    const k = s.counters;
    const p = s.props.stats();
    const lines = [
      `cells ${k.loaded} shown  active ${k.active}  visual ${k.visual}  pending ${k.pending}  cached ${k.cached}`,
      `loader queue ${k.queued} waiting + ${k.inFlight} running   uploads ${this.uploads.pending}   builds ${this.builder?.inFlight ?? 0}`,
      `fetched ${k.fetched} (prefetched ${k.prefetched})  unloaded ${k.unloaded}  retries ${k.retries}  failed ${k.failed}`,
      `colliders +${k.collidersLoaded} −${k.collidersUnloaded}   props ${p.instances} in ${p.slots} meshes, templates ${p.ready}/${p.templates}, overflow ${p.overflow}`,
    ];
    if (pos) {
      const [px, pz] = cellOf(pos.x, pos.z);
      const byKey = new Map(s.rings().map((r) => [r.key, r]));
      lines.push('rings (A active, V visual, lower case: loading, @ you, + colliders)');
      for (let dz = 3; dz >= -3; dz--) {
        let row = '  ';
        for (let dx = -3; dx <= 3; dx++) {
          const cx = px + dx, cz = pz + dz;
          const r = byKey.get(`${cx},${cz}`);
          let ch = this.region!.has(cx, cz) ? '·' : ' ';
          if (r) ch = r.level === 'active' ? (r.shown ? 'A' : 'a') : r.shown ? 'V' : 'v';
          if (dx === 0 && dz === 0) ch = '@';
          row += ch + (r?.colliders ? '+' : ' ');
        }
        lines.push(row);
      }
    }
    return lines;
  }

  /** Counters for the QA API and the lap test. */
  qa(): Record<string, unknown> | null {
    const s = this.streamer;
    if (!s) return null;
    return {
      region: this.region!.manifest.id,
      counters: { ...s.counters },
      props: s.props.stats(),
      uploads: this.uploads.pending,
      horizon: s.horizon.loaded,
      rings: s.rings(),
    };
  }

  dispose(): void {
    this.grass?.dispose();
    this.water?.dispose();
    this.water = null;
    this.grass = null;
    this.streamer?.dispose();
    this.streamer = null;
    this.builder?.dispose();
    this.builder = null;
    this.uploads.clear();
  }
}
