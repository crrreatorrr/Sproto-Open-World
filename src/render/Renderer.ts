import * as THREE from 'three';
import type { AssetLoader } from '../assets/AssetLoader';
import { TEXTURES } from '../assets/manifest';
import type { LevelDef } from '../content/sandbox';
import { lookFor, sunCastsShadow } from './caveLook';

/** Draw calls and triangles of the last frame, split into the shadow pass and the main pass. */
export interface FrameStats {
  calls: number;
  triangles: number;
  shadowCalls: number;
  shadowTriangles: number;
}

/** The streamed world's daylight (plan §3.2): fog band and far plane come from the manifest. */
export interface WorldLook {
  fog: { near: number; far: number; farPlane: number };
}

/** Daylight sky colours: overhead, and the haze at the horizon (the fog fades into it). */
const SKY_TOP = new THREE.Color(0x4f8fd6);
const SKY_HAZE = new THREE.Color(0xcfe3ef);

/**
 * The WebGL2 renderer, scene, lights and the level's greybox meshes. One directional "sun" whose
 * shadow box follows the player. Two looks: the night grove sky over the training yard, and a
 * bright daylight sky with the manifest's fog over the streamed world.
 */
export class Renderer {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly sun: THREE.DirectionalLight;
  readonly hemi: THREE.HemisphereLight;
  /** Warm pool of light on the player. It stays in the scene: adding a light recompiles every shader. */
  readonly torch: THREE.PointLight;
  private readonly levelGroup = new THREE.Group();
  /** False on the surface. `setCave` does nothing when this is already the value asked for. */
  private cave = false;
  /** Sun shadows as the graphics quality asks (`applyQuality`). The cave can only turn them off. */
  private shadowsWanted = true;
  /** Fog band from the last `worldLook`, put back when the player leaves the cave. */
  private surfaceFog: WorldLook['fog'] = { near: 80, far: 180, farPlane: 450 };
  private readonly caveSky = new THREE.Color(0x000000);
  private readonly sunOffset = new THREE.Vector3(18, 30, 12);
  private readonly stats: FrameStats = { calls: 0, triangles: 0, shadowCalls: 0, shadowTriangles: 0 };
  private yardSky: THREE.Texture | null = null;
  private daySky: THREE.Texture | null = null;

  constructor(readonly canvas: HTMLCanvasElement, private readonly assets: AssetLoader) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.measureShadowPass();

    this.camera = new THREE.PerspectiveCamera(62, 1, 0.1, 600);
    this.hemi = new THREE.HemisphereLight(0xdfefff, 0x4a5a30, 1.15);
    this.scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0xfff1d6, 2.4);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const s = this.sun.shadow.camera;
    s.left = s.bottom = -35;
    s.right = s.top = 35;
    s.near = 1;
    s.far = 120;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.03;
    // Intensity 0 until the cave. Distance 22, decay 2: a torch, not a second sun.
    this.torch = new THREE.PointLight(0xffc98a, 0, 22, 2);
    this.scene.add(this.sun, this.sun.target, this.torch);
    this.scene.add(this.levelGroup);

    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  /** The M1 look: the grove's night sky and light fog over the training yard. */
  yardLook(): void {
    if (!this.yardSky) {
      this.yardSky = this.assets.texture(TEXTURES.sky);
      this.yardSky.mapping = THREE.EquirectangularReflectionMapping;
    }
    this.scene.background = this.yardSky;
    this.scene.fog = new THREE.Fog(0xbfd8e6, 80, 260);
    this.camera.far = 600;
    this.camera.updateProjectionMatrix();
    this.hemi.color.set(0xdfefff);
    this.hemi.groundColor.set(0x4a5a30);
    this.hemi.intensity = 1.15;
    this.sun.color.set(0xfff1d6);
    this.sun.intensity = 2.4;
  }

  /**
   * Sproutvale's daylight: a bright gradient sky, fog from the manifest's band in the sky's haze
   * colour (so the edge of the loaded rings melts into the sky), and the far plane at 450 m.
   */
  worldLook(look: WorldLook): void {
    this.surfaceFog = { near: look.fog.near, far: look.fog.far, farPlane: look.fog.farPlane };
    if (!this.cave) this.applySurface();
  }

  /** The player is in the Rootdeep. No-op when the boolean has not changed. */
  setCave(on: boolean): void {
    if (on === this.cave) return;
    this.cave = on;
    if (on) this.applyCave();
    else this.applySurface();
  }

  get inCave(): boolean {
    return this.cave;
  }

  /** The graphics quality's shadow choice. Low keeps them off on the surface and in the cave alike. */
  setShadows(on: boolean): void {
    this.shadowsWanted = on;
    this.sun.castShadow = sunCastsShadow(on, this.cave);
  }

  /** Sproutvale's daylight, from `lookFor(false)` plus the fog `worldLook` stored. */
  private applySurface(): void {
    const look = lookFor(false);
    const fog = this.surfaceFog;
    this.daySky ??= daySkyTexture();
    this.scene.background = this.daySky;
    this.scene.fog = new THREE.Fog(SKY_HAZE.getHex(), fog.near, fog.far);
    this.camera.far = fog.farPlane;
    this.camera.updateProjectionMatrix();
    this.hemi.color.set(0xe8f4ff);
    this.hemi.groundColor.set(0x5a6a3a);
    this.hemi.intensity = look.hemiIntensity;
    this.sun.color.set(0xfff4e0);
    this.sun.intensity = look.sunIntensity;
    this.sun.castShadow = sunCastsShadow(this.shadowsWanted, this.cave);
    this.torch.intensity = look.torchIntensity;
  }

  /** Black, short fog, no sun. The torch and a dim hemisphere light the rock. */
  private applyCave(): void {
    const look = lookFor(true);
    this.scene.background = this.caveSky;
    this.scene.fog = new THREE.Fog(0x050608, look.fogNear, look.fogFar);
    this.camera.far = look.farPlane;
    this.camera.updateProjectionMatrix();
    this.hemi.color.set(0x6a7a8a);
    this.hemi.groundColor.set(0x1a1a22);
    this.hemi.intensity = look.hemiIntensity;
    this.sun.intensity = look.sunIntensity;
    this.sun.castShadow = sunCastsShadow(this.shadowsWanted, this.cave);
    this.torch.intensity = look.torchIntensity;
  }

  resize(): void {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / Math.max(1, h);
    this.camera.updateProjectionMatrix();
  }

  /** Build the greybox meshes for a level (the sim builds the matching colliders from the same data). */
  buildLevel(level: LevelDef): void {
    this.clearLevel();
    // A streamed world has no ground plane: its cells bring their own terrain.
    if (level.ground) {
      const grass = this.assets.texture(TEXTURES.groundGrass);
      grass.wrapS = grass.wrapT = THREE.RepeatWrapping;
      grass.repeat.set(level.ground.size / 6, level.ground.size / 6);
      grass.anisotropy = 8;
      const ground = new THREE.Mesh(
        new THREE.PlaneGeometry(level.ground.size, level.ground.size),
        new THREE.MeshStandardMaterial({ map: grass, color: 0xffffff, roughness: 0.95 }),
      );
      ground.rotation.x = -Math.PI / 2;
      ground.receiveShadow = true;
      this.levelGroup.add(ground);
    }

    const stone = this.assets.texture(TEXTURES.stone);
    stone.wrapS = stone.wrapT = THREE.RepeatWrapping;
    for (const sdef of level.shapes) {
      const mat = new THREE.MeshStandardMaterial({ map: stone, color: sdef.color ?? 0xaaaaaa, roughness: 0.9 });
      let mesh: THREE.Mesh;
      if (sdef.kind === 'box') {
        mesh = new THREE.Mesh(new THREE.BoxGeometry(sdef.half[0] * 2, sdef.half[1] * 2, sdef.half[2] * 2), mat);
        mesh.position.set(...sdef.pos);
        mesh.rotation.set(sdef.pitch ?? 0, sdef.yaw ?? 0, 0, 'YXZ');
      } else {
        mesh = new THREE.Mesh(new THREE.CylinderGeometry(sdef.radius, sdef.radius * 1.08, sdef.height, 20), mat);
        mesh.position.set(sdef.pos[0], sdef.pos[1] + sdef.height / 2, sdef.pos[2]);
      }
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.levelGroup.add(mesh);
    }
  }

  /** Drop the greybox level (its geometries and materials; textures are shared and stay). */
  clearLevel(): void {
    for (const o of this.levelGroup.children) {
      const m = o as THREE.Mesh;
      m.geometry?.dispose();
      (m.material as THREE.Material | undefined)?.dispose();
    }
    this.levelGroup.clear();
  }

  /** Keep the shadow box centred on the player, and the torch 2 m above their feet. */
  follow(target: THREE.Vector3): void {
    this.sun.position.copy(target).add(this.sunOffset);
    this.sun.target.position.copy(target);
    this.torch.position.set(target.x, target.y + 2, target.z);
  }

  /** Compile an object's programs against this scene's lights and fog without stalling a frame. */
  async compile(obj: THREE.Object3D): Promise<void> {
    await this.renderer.compileAsync(obj, this.camera, this.scene);
  }

  render(): void {
    this.renderer.render(this.scene, this.camera);
    const r = this.renderer.info.render;
    this.stats.calls = r.calls;
    this.stats.triangles = r.triangles;
  }

  /** Last frame's draw calls and triangles: `calls` includes the shadow pass (plan §3.5 budget). */
  frameStats(): Readonly<FrameStats> {
    return this.stats;
  }

  /**
   * The shadow map renders inside `renderer.render`, after info resets and before the main pass,
   * so wrapping it tells the two passes apart.
   */
  private measureShadowPass(): void {
    const sm = this.renderer.shadowMap;
    const info = this.renderer.info.render;
    const inner = sm.render.bind(sm);
    sm.render = (lights, scene, camera) => {
      const c0 = info.calls, t0 = info.triangles;
      inner(lights, scene, camera);
      this.stats.shadowCalls = info.calls - c0;
      this.stats.shadowTriangles = info.triangles - t0;
    };
  }
}

/** A small vertical gradient as an equirectangular sky: deep blue overhead to haze at the horizon. */
function daySkyTexture(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = 4;
  c.height = 256;
  const g = c.getContext('2d')!;
  const grad = g.createLinearGradient(0, 0, 0, c.height);
  grad.addColorStop(0, `#${SKY_TOP.getHexString()}`);
  grad.addColorStop(0.42, '#8fbfe6');
  grad.addColorStop(0.5, `#${SKY_HAZE.getHexString()}`);
  grad.addColorStop(1, '#b9cdb0');
  g.fillStyle = grad;
  g.fillRect(0, 0, c.width, c.height);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.mapping = THREE.EquirectangularReflectionMapping;
  return tex;
}
