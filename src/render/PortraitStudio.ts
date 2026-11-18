import * as THREE from 'three';
import type { AssetLoader, ModelInstance } from '../assets/AssetLoader';
import { MODELS, type ModelEntry, type ModelKey } from '../assets/manifest';
import { NPCS } from '../content/npcs';
import { Animator } from './anim/Animator';
import { NPC_TINTS } from './views/RpgViews';

/** Portrait side in pixels. */
const SIZE = 256;
/** The idle plays this many times a second: every redraw reads pixels back from the GPU. */
const REDRAW_HZ = 12;
const FOV = 26;

const BLIT_VERTEX = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}`;

/** The sitter over a soft backdrop, tone-mapped and encoded for the 2D canvas. */
const BLIT_FRAGMENT = /* glsl */ `
uniform sampler2D tScene;
varying vec2 vUv;
vec3 aces(vec3 x) {
  return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);
}
vec3 encode(vec3 c) {
  return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
}
void main() {
  vec4 s = texture2D(tScene, vUv);
  float glow = smoothstep(1.0, 0.1, distance(vUv, vec2(0.5, 0.6)));
  vec3 backdrop = mix(vec3(0.03, 0.05, 0.025), vec3(0.34, 0.46, 0.2), glow);
  gl_FragColor = vec4(encode(aces(s.rgb + backdrop * (1.0 - clamp(s.a, 0.0, 1.0)))), 1.0);
}`;

interface Sitter {
  model: ModelInstance;
  animator: Animator;
  materials: THREE.Material[];
}

/**
 * Render-to-texture portraits for the dialogue panel (M7): the speaker's own model, alone in a small
 * lit scene, playing its idle. Each redraw renders to an off-screen target and copies the pixels to a
 * canvas the panel shows. Nothing here touches the world's scene. Until the model is ready (or if it
 * is missing) the canvas shows the speaker's initial.
 */
export class PortraitStudio {
  readonly canvas = document.createElement('canvas');
  private readonly paint: CanvasRenderingContext2D;
  private readonly image: ImageData;
  private readonly pixels = new Uint8Array(SIZE * SIZE * 4);
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(FOV, 1, 0.05, 20);
  private readonly hdr: THREE.WebGLRenderTarget;
  private readonly output: THREE.WebGLRenderTarget;
  private readonly blitScene = new THREE.Scene();
  private readonly blitCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly blitMaterial: THREE.ShaderMaterial;
  private readonly clearColor = new THREE.Color();
  private sitter: Sitter | null = null;
  private npc = '';
  /** Counts requests, so a slow download can't seat someone who has stopped talking. */
  private request = 0;
  private wait = 0;
  private pending = 0;

  constructor(private readonly renderer: THREE.WebGLRenderer, private readonly assets: AssetLoader) {
    this.canvas.width = this.canvas.height = SIZE;
    this.canvas.className = 'portrait';
    this.paint = this.canvas.getContext('2d')!;
    this.image = this.paint.createImageData(SIZE, SIZE);
    const floatTarget = renderer.extensions.has('EXT_color_buffer_float') || renderer.extensions.has('EXT_color_buffer_half_float');
    this.hdr = new THREE.WebGLRenderTarget(SIZE, SIZE, { type: floatTarget ? THREE.HalfFloatType : THREE.UnsignedByteType, samples: 4, depthBuffer: true });
    this.output = new THREE.WebGLRenderTarget(SIZE, SIZE, { type: THREE.UnsignedByteType, depthBuffer: false });
    this.blitMaterial = new THREE.ShaderMaterial({
      uniforms: { tScene: { value: this.hdr.texture } },
      vertexShader: BLIT_VERTEX,
      fragmentShader: BLIT_FRAGMENT,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    });
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.blitMaterial);
    quad.frustumCulled = false;
    this.blitScene.add(quad);
    const key = new THREE.DirectionalLight(0xfff1dc, 2.6);
    key.position.set(1.2, 2.2, 2.6);
    this.scene.add(new THREE.HemisphereLight(0xeaf4ff, 0x5a6a3a, 1.5), key, key.target);
  }

  /** Seat this NPC (once per speaker) and return the canvas for the dialogue panel. */
  show(npc: string): HTMLCanvasElement | null {
    const def = NPCS[npc];
    if (!def) return null;
    if (npc === this.npc) return this.canvas;
    this.release();
    this.npc = npc;
    this.placeholder(def.name);
    if (def.model in MODELS) void this.seat(def.model as ModelKey, ++this.request);
    return this.canvas;
  }

  /** Once per frame, before the world renders: `on` while the dialogue is the top screen. */
  frame(dt: number, on: boolean): void {
    if (!on) {
      if (this.npc) this.release();
      return;
    }
    const s = this.sitter;
    if (!s) return;
    this.pending += dt;
    this.wait -= dt;
    if (this.wait > 0) return;
    this.wait = 1 / REDRAW_HZ;
    s.animator.update(this.pending);
    this.pending = 0;
    this.draw();
  }

  private async seat(key: ModelKey, request: number): Promise<void> {
    const model = await this.assets.instance(key);
    if (request !== this.request || !model.real) {
      model.dispose();
      return;
    }
    const materials = tintModel(model.root, NPC_TINTS[key]);
    const animator = new Animator(model.root, model.clips);
    if (animator.has('idle')) animator.loop('idle', 1, 0);
    animator.update(0);
    this.scene.add(model.root);
    model.root.updateMatrixWorld(true);
    this.frameFace(model.root, (MODELS[key] as ModelEntry).fitHeight ?? 1.8);
    try {
      // The studio's lights make their own shader variants: build them without stalling a frame.
      await this.renderer.compileAsync(this.scene, this.camera);
    } catch {
      // A failed warm-up only means the first draw compiles them.
    }
    if (request !== this.request) {
      animator.dispose();
      model.dispose();
      for (const m of materials) m.dispose();
      return;
    }
    this.sitter = { model, animator, materials };
    this.wait = 0;
  }

  /** Aim at the head: from the head bone to the top of the model, with a little room around it. */
  private frameFace(root: THREE.Object3D, top: number): void {
    let head: THREE.Object3D | null = null;
    root.traverse((o) => {
      if (!head && (o as THREE.Bone).isBone && /head$/i.test(o.name)) head = o;
    });
    const headY = head ? (head as THREE.Object3D).getWorldPosition(new THREE.Vector3()).y : top * 0.8;
    const span = Math.max(0.2, top - headY);
    const aimY = headY + span * 0.42;
    const view = Math.max(0.5, span * 1.75);
    const dist = view / 2 / Math.tan(THREE.MathUtils.degToRad(FOV / 2));
    this.camera.position.set(Math.sin(0.22) * dist, aimY + 0.04, Math.cos(0.22) * dist);
    this.camera.lookAt(0, aimY, 0);
  }

  private draw(): void {
    const r = this.renderer;
    const target = r.getRenderTarget();
    const alpha = r.getClearAlpha();
    r.getClearColor(this.clearColor);
    r.setClearColor(0x000000, 0);
    r.setRenderTarget(this.hdr);
    r.render(this.scene, this.camera);
    r.setRenderTarget(this.output);
    r.render(this.blitScene, this.blitCamera);
    r.readRenderTargetPixels(this.output, 0, 0, SIZE, SIZE, this.pixels);
    r.setRenderTarget(target);
    r.setClearColor(this.clearColor, alpha);
    // GL's rows run bottom to top.
    const row = SIZE * 4;
    for (let y = 0; y < SIZE; y++) this.image.data.set(this.pixels.subarray((SIZE - 1 - y) * row, (SIZE - y) * row), y * row);
    this.paint.putImageData(this.image, 0, 0);
  }

  /** The speaker's initial on the backdrop, while the model loads. */
  private placeholder(name: string): void {
    const g = this.paint;
    const fill = g.createRadialGradient(SIZE / 2, SIZE * 0.4, 8, SIZE / 2, SIZE * 0.4, SIZE * 0.75);
    fill.addColorStop(0, '#7f9a55');
    fill.addColorStop(1, '#1d2a14');
    g.fillStyle = fill;
    g.fillRect(0, 0, SIZE, SIZE);
    g.fillStyle = '#fdf8ec';
    g.font = `700 ${SIZE * 0.46}px ui-rounded, system-ui, sans-serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(name.charAt(0), SIZE / 2, SIZE * 0.54);
  }

  /** Nobody is talking: let the model go. The render targets stay for the next speaker. */
  private release(): void {
    this.request++;
    this.npc = '';
    this.pending = 0;
    const s = this.sitter;
    if (!s) return;
    this.sitter = null;
    s.animator.dispose();
    s.model.dispose();
    for (const m of s.materials) m.dispose();
  }

  dispose(): void {
    this.release();
    this.hdr.dispose();
    this.output.dispose();
    this.blitMaterial.dispose();
  }
}

/** Give a model its own tinted copies of its materials (the template's are shared). */
function tintModel(root: THREE.Object3D, tint: number | undefined): THREE.Material[] {
  if (tint === undefined) return [];
  const color = new THREE.Color(tint);
  const copies = new Map<THREE.Material, THREE.MeshStandardMaterial>();
  const swap = (m: THREE.Material): THREE.Material => {
    if (!(m as THREE.MeshStandardMaterial).isMeshStandardMaterial) return m;
    let c = copies.get(m);
    if (!c) {
      c = (m as THREE.MeshStandardMaterial).clone();
      c.color.multiply(color);
      copies.set(m, c);
    }
    return c;
  };
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (mesh.isMesh) mesh.material = Array.isArray(mesh.material) ? mesh.material.map(swap) : swap(mesh.material);
  });
  return [...copies.values()];
}
