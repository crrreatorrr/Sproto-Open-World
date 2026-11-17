import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { MODELS, type ModelEntry, type ModelKey } from './manifest';
import { prepareRig } from './rig';

/** Requests in flight at once (the shooter's loader; plan §3.3). */
const PARALLEL = 4;

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
  dispose(): void;
}

/**
 * GLB loading with meshopt (every sibling GLB uses EXT_meshopt_compression, EXT_texture_webp and
 * KHR_mesh_quantization), a small priority queue, refcounted templates, and primitive fallbacks
 * so a missing file never stops the game.
 */
export class AssetLoader {
  private readonly gltf = new GLTFLoader();
  private readonly templates = new Map<ModelKey, Promise<ModelTemplate>>();
  private readonly refs = new Map<ModelKey, number>();
  private readonly queue: (() => void)[] = [];
  private active = 0;
  private readonly textures = new THREE.TextureLoader();

  constructor(private readonly base = import.meta.env.BASE_URL + 'assets/') {
    this.gltf.setMeshoptDecoder(MeshoptDecoder);
  }

  /** Load (once) and return the template for a model key. */
  template(key: ModelKey): Promise<ModelTemplate> {
    let p = this.templates.get(key);
    if (!p) {
      p = this.schedule(() => this.loadTemplate(key));
      this.templates.set(key, p);
    }
    return p;
  }

  /** A fresh, independently animatable copy of a model. Call `dispose()` when it leaves the scene. */
  async instance(key: ModelKey): Promise<ModelInstance> {
    const t = await this.template(key);
    this.refs.set(key, (this.refs.get(key) ?? 0) + 1);
    const root = MODELS[key] && 'rigged' in MODELS[key] ? cloneSkinned(t.scene) : t.scene.clone(true);
    let disposed = false;
    return {
      root,
      clips: t.clips,
      dispose: () => {
        if (disposed) return;
        disposed = true;
        root.removeFromParent();
        this.refs.set(key, Math.max(0, (this.refs.get(key) ?? 1) - 1));
      },
    };
  }

  texture(path: string, srgb = true): THREE.Texture {
    const tex = this.textures.load(this.base + path);
    if (srgb) tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  private schedule<T>(job: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const run = () => {
        this.active++;
        job()
          .then(resolve, reject)
          .finally(() => {
            this.active--;
            this.queue.shift()?.();
          });
      };
      if (this.active < PARALLEL) run();
      else this.queue.push(run);
    });
  }

  private async loadTemplate(key: ModelKey): Promise<ModelTemplate> {
    const entry = MODELS[key];
    let gltf: GLTF;
    try {
      gltf = await this.gltf.loadAsync(this.base + entry.path);
    } catch (err) {
      console.warn(`[assets] ${entry.path} failed to load, using a placeholder`, err);
      return { key, scene: placeholder(key), clips: [], real: false };
    }
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
