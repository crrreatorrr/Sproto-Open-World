import * as THREE from 'three';
import { makeDissolvable } from '../fx/dissolve';
import { starTexture } from '../fx/textures';

/** Ash shed per second per metre of body while it dissolves. */
const ASH_RATE = 26;
const ASH_AT = { x: 0, y: 0, z: 0 };
const GLINT_SEC = 0.28;
const HIT_FLASH_SEC = 0.09;
const WHITE = new THREE.Color(1, 1, 1);
const GLINT = new THREE.Color(1, 0.92, 0.6);
const RED = new THREE.Color(1, 0.06, 0.02);
const BURN = new THREE.Color(1, 0.38, 0.05);
const CHILL = new THREE.Color(0.15, 0.45, 1);
const ICE = new THREE.Color(0.62, 0.88, 1);
const SHOCK = new THREE.Color(1, 0.92, 0.25);

/** Status tints (plan §4.7), drawn under the telegraph colours so a wind-up always reads. */
export interface GlowStatus {
  burn: boolean;
  /** Chill stacks (0 = none). */
  chill: number;
  frozen: boolean;
  shock: boolean;
}

/**
 * Per-enemy emissive feedback (plan §1, telegraphs): a white glint when a wind-up starts, a red
 * pulse through an unblockable's wind-up, and a short white flash when hit. It owns cloned
 * materials so one enemy lighting up never lights up every enemy that shares a model, plus a
 * star sprite at the eyes for the glint. Status tints (burning, chilled, frozen, shocked) sit
 * under the telegraph colours. A dying body burns away through the same materials (fx/dissolve.ts).
 */
export class BodyGlow {
  /** Where a dissolving body's ash goes (WorldViews points it at the sparks). */
  static ash: ((p: { x: number; y: number; z: number }) => void) | null = null;
  /** Strength of the white flash on a struck body (the screen flashes setting). */
  static flashScale = 1;
  readonly glint: THREE.Sprite;
  /** Every cloned material (disposal), and the lit ones among them. */
  private readonly owned: THREE.Material[] = [];
  /** The burn on each material, and the meshes whose shadows go with the body. */
  private readonly burns: { value: number }[] = [];
  private readonly meshes: THREE.Mesh[] = [];
  private readonly casts: boolean[] = [];
  private ashOwed = 0;
  private readonly mats: THREE.MeshStandardMaterial[] = [];
  private readonly base: THREE.Color[] = [];
  private readonly tmp = new THREE.Color();
  private glintT = 0;
  private hitT = 0;
  private redLeft = 0;
  private time = 0;
  private opacity = 1;
  private status: GlowStatus = { burn: false, chill: 0, frozen: false, shock: false };

  constructor() {
    this.glint = new THREE.Sprite(new THREE.SpriteMaterial({ map: starTexture(), color: GLINT, transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending }));
    this.glint.visible = false;
    this.glint.renderOrder = 10;
  }

  /**
   * Give every mesh under `root` its own copy of its material, and track the lit ones. `emissive`
   * replaces the materials' own glow as the resting colour (the Wisp's purple).
   */
  adopt(root: THREE.Object3D, emissive?: number): void {
    root.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      this.meshes.push(mesh);
      this.casts.push(mesh.castShadow);
      const one = (m: THREE.Material) => {
        const c = m.clone();
        this.owned.push(c);
        const burn = makeDissolvable(c);
        burn.value = 1 - this.opacity;
        this.burns.push(burn);
        if ((c as THREE.MeshStandardMaterial).isMeshStandardMaterial) {
          if (emissive !== undefined) (c as THREE.MeshStandardMaterial).emissive.setHex(emissive);
          this.mats.push(c as THREE.MeshStandardMaterial);
          this.base.push((c as THREE.MeshStandardMaterial).emissive.clone());
        }
        return c;
      };
      mesh.material = Array.isArray(mesh.material) ? mesh.material.map(one) : one(mesh.material);
    });
  }

  /** A wind-up started: glint, and for an unblockable a red pulse for `seconds`. */
  telegraph(unblockable: boolean, seconds: number): void {
    this.glintT = GLINT_SEC;
    this.glint.material.color.copy(unblockable ? RED : GLINT);
    this.redLeft = unblockable ? seconds : 0;
  }

  /** The wind-up ended (it hit, or the enemy was interrupted). */
  endTelegraph(): void {
    this.redLeft = 0;
  }

  hit(): void {
    this.hitT = HIT_FLASH_SEC;
  }

  setStatus(s: GlowStatus): void {
    this.status = s;
  }

  /** Burn the whole body away (death). 1 = whole, 0 = gone. */
  setOpacity(o: number): void {
    if (o === this.opacity) return;
    const fading = o < 1;
    if (fading !== this.opacity < 1) this.meshes.forEach((m, i) => (m.castShadow = !fading && this.casts[i]));
    this.opacity = o;
    for (const b of this.burns) b.value = 1 - o;
  }

  /** While the body burns away it sheds glowing ash from all over. */
  private shedAsh(dt: number): void {
    const body = this.glint.parent;
    if (!BodyGlow.ash || !body || this.opacity >= 1 || this.opacity <= 0) return;
    const h = Math.max(1, this.glint.position.y);
    this.ashOwed += ASH_RATE * h * dt;
    for (; this.ashOwed >= 1; this.ashOwed--) {
      const a = Math.random() * Math.PI * 2;
      const r = h * 0.22 * Math.random();
      ASH_AT.x = body.position.x + Math.sin(a) * r;
      ASH_AT.y = body.position.y + h * Math.random();
      ASH_AT.z = body.position.z + Math.cos(a) * r;
      BodyGlow.ash(ASH_AT);
    }
  }

  update(dt: number): void {
    this.shedAsh(dt);
    this.time += dt;
    this.glintT = Math.max(0, this.glintT - dt);
    this.hitT = Math.max(0, this.hitT - dt);
    this.redLeft = Math.max(0, this.redLeft - dt);
    // Red pulses (~5 Hz, faster near the end of the wind-up) up to 80%, so the body's shape still reads.
    const red = this.redLeft > 0 ? 0.3 + 0.5 * Math.abs(Math.sin(this.time * (this.redLeft < 0.25 ? 26 : 16))) : 0;
    const white = Math.max((this.hitT / HIT_FLASH_SEC) * BodyGlow.flashScale, (this.glintT / GLINT_SEC) * 0.6);
    const st = this.status;
    const t = this.time;
    // Burning flickers like a fire (two beating sines); shock snaps on and off; chill deepens per stack.
    const burn = st.burn ? 0.28 + 0.14 * (Math.sin(t * 23) + Math.sin(t * 37.3)) : 0;
    const shock = st.shock && Math.sin(t * 61) + Math.sin(t * 17) > 0.6 ? 0.55 : 0;
    const chill = st.frozen ? 0 : Math.min(3, st.chill) * 0.11;
    for (let i = 0; i < this.mats.length; i++) {
      const c = this.tmp.copy(this.base[i]);
      if (st.frozen) c.lerp(ICE, 0.6);
      if (chill > 0) c.lerp(CHILL, chill);
      if (burn > 0) c.lerp(BURN, burn);
      if (shock > 0) c.lerp(SHOCK, shock);
      if (white > 0) c.lerp(WHITE, white * 0.85);
      if (red > 0) c.lerp(RED, red);
      this.mats[i].emissive.copy(c);
    }
    const g = this.glintT / GLINT_SEC;
    this.glint.visible = g > 0;
    if (g > 0) {
      // Pop in, then shrink and fade.
      const s = 0.5 + 0.9 * Math.sin(Math.min(1, (1 - g) * 3) * Math.PI * 0.5) * g;
      this.glint.scale.set(s, s, 1);
      this.glint.material.opacity = Math.min(1, g * 1.6);
      this.glint.material.rotation = this.time * 2;
    }
  }

  dispose(): void {
    for (const m of this.owned) m.dispose();
    this.glint.material.dispose();
  }
}
