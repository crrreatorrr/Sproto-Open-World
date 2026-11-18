import * as THREE from 'three';
import type { AssetLoader } from '../assets/AssetLoader';
import { TEXTURES } from '../assets/manifest';
import type { LevelDef } from '../content/sandbox';

/**
 * The WebGL2 renderer, scene, lights and the level's greybox meshes. One directional "sun" whose
 * shadow box follows the player, sky from the grove theme, light fog.
 */
export class Renderer {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly sun: THREE.DirectionalLight;
  private readonly levelGroup = new THREE.Group();
  private readonly sunOffset = new THREE.Vector3(18, 30, 12);

  constructor(readonly canvas: HTMLCanvasElement, private readonly assets: AssetLoader) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;

    this.camera = new THREE.PerspectiveCamera(62, 1, 0.1, 600);
    this.scene.fog = new THREE.Fog(0xbfd8e6, 80, 260);
    this.scene.background = new THREE.Color(0xbfd8e6);
    const sky = assets.texture(TEXTURES.sky);
    sky.mapping = THREE.EquirectangularReflectionMapping;
    this.scene.background = sky;

    this.scene.add(new THREE.HemisphereLight(0xdfefff, 0x4a5a30, 1.15));
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
    this.scene.add(this.sun, this.sun.target);
    this.scene.add(this.levelGroup);

    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  resize(): void {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / Math.max(1, h);
    this.camera.updateProjectionMatrix();
  }

  /** Build the greybox meshes for a level (the sim builds the matching colliders from the same data). */
  buildLevel(level: LevelDef): void {
    this.levelGroup.clear();
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

  /** Keep the shadow box centred on the player. */
  follow(target: THREE.Vector3): void {
    this.sun.position.copy(target).add(this.sunOffset);
    this.sun.target.position.copy(target);
  }

  render(): void {
    this.renderer.render(this.scene, this.camera);
  }
}
