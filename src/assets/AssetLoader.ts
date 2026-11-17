import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { MODELS, type ModelKey } from './manifest';
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
    if ('rigged' in entry && entry.rigged) prepareRig(scene, gltf.animations);
    if ('clips' in entry && entry.clips) {
      const have = new Set(gltf.animations.map((c) => c.name));
      const missing = entry.clips.filter((c) => !have.has(c));
      if (missing.length) console.warn(`[assets] ${key} is missing clips: ${missing.join(', ')}`);
    }
    return { key, scene, clips: gltf.animations, real: true };
  }
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
  }
  return g;
}
