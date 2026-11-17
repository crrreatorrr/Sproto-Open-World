import * as THREE from 'three';
import { starTexture } from '../fx/textures';

const GLINT_SEC = 0.28;
const HIT_FLASH_SEC = 0.09;
const WHITE = new THREE.Color(1, 1, 1);
const GLINT = new THREE.Color(1, 0.92, 0.6);
const RED = new THREE.Color(1, 0.06, 0.02);

/**
 * Per-enemy emissive feedback (plan §1, telegraphs): a white glint when a wind-up starts, a red
 * pulse through an unblockable's wind-up, and a short white flash when hit. It owns cloned
 * materials so one enemy lighting up never lights up every enemy that shares a model, plus a
 * star sprite at the eyes for the glint.
 */
export class BodyGlow {
  readonly glint: THREE.Sprite;
  /** Every cloned material (opacity, disposal), and the lit ones among them. */
  private readonly owned: THREE.Material[] = [];
  /** Their own transparency, restored when a fade ends (respawn). */
  private readonly ownTransparent: boolean[] = [];
  private readonly mats: THREE.MeshStandardMaterial[] = [];
  private readonly base: THREE.Color[] = [];
  private readonly tmp = new THREE.Color();
  private glintT = 0;
  private hitT = 0;
  private redLeft = 0;
  private time = 0;
  private opacity = 1;

  constructor() {
    this.glint = new THREE.Sprite(new THREE.SpriteMaterial({ map: starTexture(), color: GLINT, transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending }));
    this.glint.visible = false;
    this.glint.renderOrder = 10;
  }

  /** Give every mesh under `root` its own copy of its material, and track the lit ones. */
  adopt(root: THREE.Object3D): void {
    root.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      const one = (m: THREE.Material) => {
        const c = m.clone();
        this.owned.push(c);
        this.ownTransparent.push(c.transparent);
        if ((c as THREE.MeshStandardMaterial).isMeshStandardMaterial) {
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

  /** Fade the whole body (death). 1 = opaque. */
  setOpacity(o: number): void {
    if (o === this.opacity) return;
    const fading = o < 1;
    if (fading !== this.opacity < 1) {
      this.owned.forEach((m, i) => {
        m.transparent = fading || this.ownTransparent[i];
        m.depthWrite = !m.transparent;
        m.needsUpdate = true;
      });
    }
    this.opacity = o;
    for (const m of this.owned) m.opacity = o;
  }

  update(dt: number): void {
    this.time += dt;
    this.glintT = Math.max(0, this.glintT - dt);
    this.hitT = Math.max(0, this.hitT - dt);
    this.redLeft = Math.max(0, this.redLeft - dt);
    // Red pulses (~5 Hz, faster near the end of the wind-up) up to 80%, so the body's shape still reads.
    const red = this.redLeft > 0 ? 0.3 + 0.5 * Math.abs(Math.sin(this.time * (this.redLeft < 0.25 ? 26 : 16))) : 0;
    const white = Math.max(this.hitT / HIT_FLASH_SEC, (this.glintT / GLINT_SEC) * 0.6);
    for (let i = 0; i < this.mats.length; i++) {
      const c = this.tmp.copy(this.base[i]);
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
