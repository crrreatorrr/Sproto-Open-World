import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { MODELS, type ModelEntry, type ModelKey } from './manifest';
import { RequestQueue, type Priority } from './RequestQueue';
import { prepareRig } from './rig';
import { isCancel, withRetry } from '../world/rings';

/** Requests in flight at once (the shooter's loader; plan §3.3). */
const PARALLEL = 4;
/** After the quick retries fail, a model or prop keeps trying this often (ms). */
const MODEL_RETRY_MS = 30_000;
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export interface ModelTemplate {
  key: ModelKey;
  scene: THREE.Group;
  clips: THREE.AnimationClip[];
  /** Loaded from disk (false: a primitive stand-in because the file is missing or broken). */
  real: boolean;
}

export interface ModelInstance {
  root: THREE.Object3D;
  clips: THREE.AnimationClip[];
  /** The real model (false: the loader's primitive stand-in; views may prefer their own greybox). */
  real: boolean;
  dispose(): void;
}

/**
 * GLB loading with meshopt (every sibling GLB uses EXT_meshopt_compression, EXT_texture_webp and
 * KHR_mesh_quantization), a small priority queue, refcounted templates, and primitive fallbacks
 * so a missing file never stops the game.
 */
/**
 * Free what a skinned copy owns on the GPU. Geometry and materials are shared with the template, but
 * every clone has its own skeleton, and three.js keeps one bone texture per skeleton until it's
 * disposed: without this, each enemy that leaves and re-enters view range leaks a texture.
 */
export function disposeSkeletons(root: THREE.Object3D): void {
  root.traverse((o) => {
    if ((o as THREE.SkinnedMesh).isSkinnedMesh) (o as THREE.SkinnedMesh).skeleton.dispose();
  });
}

export class AssetLoader {
  private readonly gltfLoader = new GLTFLoader();
  private readonly templates = new Map<ModelKey, Promise<ModelTemplate>>();
  private readonly refs = new Map<ModelKey, number>();
  private readonly real = new Set<ModelKey>();
  private readonly recovered = new Set<(key: ModelKey) => void>();
  /** Shared with the world streamer's cell fetches (plan §3.3: one NOW/LATER queue, 4 in flight). */
  readonly queue = new RequestQueue(PARALLEL);
  private readonly textures = new THREE.TextureLoader();
  /**
   * Set by the app: readies a loaded model for drawing (texture uploads within the frame budget,
   * shader programs compiled off the draw) before any view gets a copy of it (render/warm.ts).
   */
  warm: ((scene: THREE.Object3D, body: boolean) => Promise<void>) | null = null;

  constructor(private readonly base = import.meta.env.BASE_URL + 'assets/') {
    this.gltfLoader.setMeshoptDecoder(MeshoptDecoder);
  }

  /** Load (once) and return the template for a model key. */
  template(key: ModelKey, priority: Priority = 'now'): Promise<ModelTemplate> {
    let p = this.templates.get(key);
    if (!p) {
      p = this.loadTemplate(key, priority);
      this.templates.set(key, p);
    }
    return p;
  }

  /** Has the real file for this model arrived (false: not yet, or still on its stand-in)? */
  isReal(key: ModelKey): boolean {
    return this.real.has(key);
  }

  /** Called when a model that failed finally arrives, so views can swap their stand-ins. */
  onRecovered(listener: (key: ModelKey) => void): () => void {
    this.recovered.add(listener);
    return () => this.recovered.delete(listener);
  }

  /** A fresh, independently animatable copy of a model. Call `dispose()` when it leaves the scene. */
  async instance(key: ModelKey, priority: Priority = 'now'): Promise<ModelInstance> {
    const t = await this.template(key, priority);
    this.refs.set(key, (this.refs.get(key) ?? 0) + 1);
    const root = MODELS[key] && 'rigged' in MODELS[key] ? cloneSkinned(t.scene) : t.scene.clone(true);
    let disposed = false;
    return {
      root,
      clips: t.clips,
      real: t.real,
      dispose: () => {
        if (disposed) return;
        disposed = true;
        root.removeFromParent();
        disposeSkeletons(root);
        this.refs.set(key, Math.max(0, (this.refs.get(key) ?? 1) - 1));
      },
    };
  }

  texture(path: string, srgb = true): THREE.Texture {
    const tex = this.textures.load(this.base + path);
    if (srgb) tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  /**
   * Load any GLB under public/assets (world props, the horizon) through the shared queue. Not
   * cached here: the caller owns the result and its refcount (world/PropInstancer.ts). `persist`
   * keeps trying until the file arrives, instead of failing after the quick retries.
   */
  gltf(path: string, priority: Priority = 'later', persist = false): Promise<GLTF> {
    const attempt = () =>
      withRetry(() => this.queue.run(() => this.gltfLoader.loadAsync(import.meta.env.BASE_URL + path), priority).promise, sleep);
    if (!persist) return attempt();
    const untilLoaded = (): Promise<GLTF> =>
      attempt().catch(async (err: unknown) => {
        if (isCancel(err)) throw err;
        console.warn(`[assets] ${path} failed to load; trying again in ${MODEL_RETRY_MS / 1000} s`, err);
        await sleep(MODEL_RETRY_MS);
        return untilLoaded();
      });
    return untilLoaded();
  }

  /** The model, or a stand-in while it keeps retrying in the background (a blip never lasts the session). */
  private async loadTemplate(key: ModelKey, priority: Priority): Promise<ModelTemplate> {
    try {
      return await this.warmed(await this.fetchTemplate(key, priority));
    } catch (err) {
      console.warn(`[assets] ${MODELS[key].path} failed to load, using a placeholder and retrying`, err);
      this.retryLater(key);
      return { key, scene: placeholder(key), clips: [], real: false };
    }
  }

  /** The template, once it can be drawn without a stall. A warm-up that fails never fails the model. */
  private async warmed(t: ModelTemplate): Promise<ModelTemplate> {
    try {
      // A rigged model is a body: it is drawn with the burn-away variant of its materials too.
      await this.warm?.(t.scene, !!(MODELS[t.key] as ModelEntry).rigged);
    } catch (err) {
      console.warn(`[assets] ${t.key} could not be warmed up; its first draw will compile it`, err);
    }
    return t;
  }

  private fetchTemplate(key: ModelKey, priority: Priority): Promise<ModelTemplate> {
    return withRetry(() => this.queue.run(() => this.readTemplate(key), priority).promise, sleep);
  }

  private retryLater(key: ModelKey): void {
    setTimeout(() => {
      this.fetchTemplate(key, 'later').then((t) => this.warmed(t)).then(
        (t) => {
          this.templates.set(key, Promise.resolve(t));
          for (const listener of this.recovered) listener(key);
        },
        () => this.retryLater(key),
      );
    }, MODEL_RETRY_MS);
  }

  private async readTemplate(key: ModelKey): Promise<ModelTemplate> {
    const entry = MODELS[key];
    const gltf: GLTF = await this.gltfLoader.loadAsync(this.base + entry.path);
    this.real.add(key);
    const scene = gltf.scene;
    scene.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh) {
        mesh.castShadow = true;
        mesh.receiveShadow = true;
      }
    });
    const e: ModelEntry = entry;
    // In-place clips keep their root motion: only the culling half of prepareRig applies.
    if (e.rigged) prepareRig(scene, e.inPlace ? [] : gltf.animations);
    if ('clips' in entry && entry.clips) {
      const have = new Set(gltf.animations.map((c) => c.name));
      const missing = entry.clips.filter((c) => !have.has(c));
      if (missing.length) console.warn(`[assets] ${key} is missing clips: ${missing.join(', ')}`);
    }
    return { key, scene: e.fitHeight ? fitModel(scene, e.fitHeight, e.rotationY ?? 0) : scene, clips: gltf.animations, real: true };
  }
}

/**
 * Wrap a model in a holder so it stands `height` m tall with its feet on y = 0, turned by
 * `rotationY`. Measured on the skinned vertices in the rest pose (a skinned mesh's own bounds are
 * the bind geometry's, which can sit anywhere). The holder is the template: instances clone it, and
 * the animation mixer binds to the bones by name underneath it.
 */
function fitModel(scene: THREE.Group, height: number, rotationY: number): THREE.Group {
  const holder = new THREE.Group();
  holder.name = `fit:${scene.name}`;
  scene.rotation.y = rotationY;
  holder.add(scene);
  holder.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(holder, true);
  const h = box.max.y - box.min.y;
  if (!(h > 1e-3)) return holder;
  const s = height / h;
  scene.scale.multiplyScalar(s);
  scene.position.y -= box.min.y * s;
  holder.updateMatrixWorld(true);
  return holder;
}

function placeholder(key: ModelKey): THREE.Group {
  const g = new THREE.Group();
  g.name = `placeholder:${key}`;
  const mat = new THREE.MeshStandardMaterial({ color: key === 'player' ? 0x3b6fd8 : 0xc08040, roughness: 0.7 });
  if (key.startsWith('staff')) {
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.025, 1.9, 8), mat);
    shaft.position.y = -0.15;
    g.add(shaft);
  } else {
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.35, 1.1, 4, 12), mat);
    body.position.y = 0.9;
    body.castShadow = true;
    g.add(body);
    // The capsule is 1.8 m: stretch it to a fitted model's height (the Brute's stand-in is 2.4 m).
    const fit = (MODELS[key] as ModelEntry).fitHeight;
    if (fit) g.scale.setScalar(fit / 1.8);
  }
  return g;
}
