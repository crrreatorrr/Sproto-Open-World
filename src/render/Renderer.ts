import * as THREE from 'three';
import type { AssetLoader } from '../assets/AssetLoader';
import { TEXTURES } from '../assets/manifest';
import type { LevelDef } from '../content/sandbox';
import { DAY_HAZE, sunCastsShadow, worldLight } from './caveLook';
import { snapToShadowTexels } from './shadowSnap';

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
const SKY_HAZE = new THREE.Color(DAY_HAZE);

/**
 * The WebGL2 renderer, scene, lights and the level's greybox meshes. One directional "sun" whose
 * shadow box follows the player. The training yard keeps its night sky. The streamed world shares
 * one look, computed from the storm, the cave and the graphics quality: the cave wins underground.
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
  /** The bait post's roar, until the Drake is down. Remembered in the cave and painted on the way out. */
  private storm = false;
  /** Sun shadows as the graphics quality asks (`applyQuality`). The cave can only turn them off. */
  private shadowsWanted = true;
  /** True after `worldLook`. The training yard keeps its own sky and only takes a storm tint. */
  private daylight = false;
  /** Fog band from the last `worldLook`, put back when the player leaves the cave. */
  private surfaceFog: WorldLook['fog'] = { near: 80, far: 180, farPlane: 450 };
  private readonly caveSky = new THREE.Color(0x000000);
  private readonly sunOffset = new THREE.Vector3(18, 30, 12);
  private readonly stats: FrameStats = { calls: 0, triangles: 0, shadowCalls: 0, shadowTriangles: 0 };
  /**
   * Work that happened inside the draw while the player was playing (`watchFirstDraw`): frames in
   * which a shader program was compiled or a texture first uploaded there, and how many of each.
   * Every model is warmed before it shows (render/warm.ts), so `programs` should stay 0 in play.
   * `textures` also counts each new skinned body's bone texture, which is small.
   */
  readonly firstDraw = { frames: 0, programs: 0, textures: 0 };
  watchFirstDraw = false;
  private readonly kept = new WeakSet<object>();
  /** The surface fog's near and far, as shares of the region's own (the graphics quality; world/rings.ts `fogReach`). */
  private fogReach: readonly [number, number] = [1, 1];
  /** The most device pixels per CSS pixel the graphics quality allows, and the share of it drawn now. */
  private pixelCap = 2;
  private resolution = 1;
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
    this.daylight = false;
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
   * A storm that is already going keeps its dim light.
   */
  worldLook(look: WorldLook): void {
    this.surfaceFog = { near: look.fog.near, far: look.fog.far, farPlane: look.fog.farPlane };
    this.daylight = true;
    if (!this.cave) this.applyComposed();
  }

  /** The graphics quality's fog reach on the surface. The cave keeps its own fog. */
  setFogReach(reach: readonly [number, number]): void {
    if (reach[0] === this.fogReach[0] && reach[1] === this.fogReach[1]) return;
    this.fogReach = reach;
    if (this.daylight || this.cave) this.applyComposed();
  }

  /** The graphics quality's pixel ratio ceiling. */
  setPixelCap(cap: number): void {
    this.pixelCap = cap;
    this.applyPixels();
  }

  /** Draw at this share of the quality's resolution (render/resolutionGovernor.ts). */
  setResolution(scale: number): void {
    if (scale === this.resolution) return;
    this.resolution = scale;
    this.applyPixels();
  }

  private applyPixels(): void {
    const ratio = Math.min(window.devicePixelRatio, this.pixelCap) * this.resolution;
    if (Math.abs(this.renderer.getPixelRatio() - ratio) > 1e-3) this.renderer.setPixelRatio(ratio);
  }

  /** The player is in the Rootdeep. No-op when the boolean has not changed. */
  setCave(on: boolean): void {
    if (on === this.cave) return;
    this.cave = on;
    this.applyComposed();
  }

  get inCave(): boolean {
    return this.cave;
  }

  /** The graphics quality's shadow choice. Low keeps them off on the surface and in the cave alike. */
  setShadows(on: boolean): void {
    this.shadowsWanted = on;
    this.sun.castShadow = sunCastsShadow(on, this.cave);
  }

  /**
   * The bait post's distant roar, until the Drake is down. Both setters paint `worldLight`, so
   * neither writes over the other: the cave stays dark, and the storm is still there on the way out.
   */
  setStorm(on: boolean): void {
    if (on === this.storm) return;
    // Before any look exists there is nothing to paint. The next call tries again.
    if (!this.daylight && !this.cave && !(this.scene.fog instanceof THREE.Fog)) return;
    this.storm = on;
    if (this.daylight || this.cave) this.applyComposed();
    else this.applyStormTint();
  }

  /** Sun, hemisphere, fog and torch from the storm, the cave and the quality, together. */
  private applyComposed(): void {
    const fog = this.surfaceFog;
    const light = worldLight(
      { storm: this.storm, cave: this.cave, shadows: this.shadowsWanted },
      { near: fog.near * this.fogReach[0], far: fog.far * this.fogReach[1], farPlane: fog.farPlane },
    );
    if (light.background === 'cave') this.scene.background = this.caveSky;
    else {
      this.daySky ??= daySkyTexture();
      this.scene.background = this.daySky;
    }
    this.scene.fog = new THREE.Fog(light.fogColor, light.fogNear, light.fogFar);
    this.camera.far = light.farPlane;
    this.camera.updateProjectionMatrix();
    this.hemi.color.set(light.hemiColor);
    this.hemi.groundColor.set(light.hemiGround);
    this.hemi.intensity = light.hemiIntensity;
    this.sun.color.set(light.sunColor);
    this.sun.intensity = light.sunIntensity;
    this.sun.castShadow = light.castShadow;
    this.torch.intensity = light.torchIntensity;
  }

  /** The yard keeps its sky and fog distances. A storm only drops the light, the way it used to. */
  private applyStormTint(): void {
    if (!(this.scene.fog instanceof THREE.Fog)) return;
    const light = worldLight({ storm: this.storm, cave: false, shadows: this.shadowsWanted }, this.surfaceFog);
    this.scene.fog.color.setHex(light.fogColor);
    this.hemi.intensity = light.hemiIntensity;
    this.sun.intensity = light.sunIntensity;
    this.sun.color.set(light.sunColor);
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

  /**
   * Keep the shadow box on the player, moved in whole shadow texels so shadow edges hold still
   * while they walk (render/shadowSnap.ts), and the torch 2 m above their feet.
   */
  follow(target: THREE.Vector3): void {
    const box = this.sun.shadow.camera;
    const at = snapToShadowTexels(target, this.sunOffset, (box.right - box.left) / this.sun.shadow.mapSize.x);
    this.sun.target.position.set(at.x, at.y, at.z);
    this.sun.position.copy(this.sun.target.position).add(this.sunOffset);
    this.torch.position.set(target.x, target.y + 2, target.z);
  }

  /** Compile an object's programs against this scene's lights and fog without stalling a frame. */
  async compile(obj: THREE.Object3D): Promise<void> {
    await this.renderer.compileAsync(obj, this.camera, this.scene);
  }

  render(): void {
    const info = this.renderer.info;
    const programs = info.programs?.length ?? 0, textures = info.memory.textures;
    this.renderer.render(this.scene, this.camera);
    this.keepPrograms();
    if (this.watchFirstDraw) {
      const p = (info.programs?.length ?? 0) - programs, t = info.memory.textures - textures;
      if (p > 0 || t > 0) {
        this.firstDraw.frames++;
        this.firstDraw.programs += Math.max(0, p);
        this.firstDraw.textures += Math.max(0, t);
      }
    }
    const r = this.renderer.info.render;
    this.stats.calls = r.calls;
    this.stats.triangles = r.triangles;
  }

  /**
   * Keep every compiled shader program for the session. three.js deletes a program when the last
   * material using it is disposed, so each time the last enemy of a kind left view its program went
   * with it, and the next one to walk in paid for the compile again, inside a draw. Counting one
   * extra user on each program stops that. The number of programs is small and bounded (a few dozen).
   */
  private keepPrograms(): void {
    const programs = this.renderer.info.programs;
    if (!programs) return;
    for (const program of programs) {
      if (this.kept.has(program)) continue;
      this.kept.add(program);
      const p = program as unknown as { usedTimes?: number };
      if (typeof p.usedTimes === 'number') p.usedTimes++;
    }
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
