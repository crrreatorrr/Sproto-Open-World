import * as THREE from 'three';
import type { AssetLoader, ModelInstance } from '../../assets/AssetLoader';
import { EDGE_WARDEN as W } from '../../content/packs/edge';
import { TICK_HZ } from '../../content/tuning';
import type { Entity } from '../../sim/entity';
import { Animator, ENTRY_FADE } from '../anim/Animator';
import type { HitFx } from '../fx/HitFx';
import { glowTexture } from '../fx/textures';
import type { EntityView } from './EnemyViews';
import { placeEntity } from './interp';

/** The Skyfire Drake's model is fitted to this height (m, `MODELS.drake.fitHeight`). */
const DRAKE_HEIGHT = 5;
/** Where the spit leaves in the `fireball` clip (seconds). */
const SPIT_AT = 20 / 30;
/** How dark its hide is next to the Drake's, and the glow under it. */
const HIDE = 0.26;
const EMBER = 0x5a0c00;
/** Its mouth's glow (m across): circling, firing, and at the end of the burn's warning. */
const GLOW = { watch: 5, strike: 9, burn: 30 };

const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/**
 * The Edge Warden (far-view plan §3.10): the Skyfire Drake's body at three times the size, dark,
 * with a burning mouth. It banks into its circle, spits through its barrage, and its mouth swells
 * white through the burn's warning. The model is fetched when the first one appears; it is still
 * flying in from beyond the edge by the time it arrives.
 */
export class EdgeWardenView implements EntityView {
  readonly root = new THREE.Group();
  readonly height = DRAKE_HEIGHT * W.scale;
  private readonly body = new THREE.Group();
  private readonly glowMat = new THREE.SpriteMaterial({ map: glowTexture(), color: 0xff4a14, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
  private readonly glow = new THREE.Sprite(this.glowMat);
  private readonly owned: THREE.Material[] = [];
  private model: ModelInstance | null = null;
  private animator: Animator | null = null;
  private pitch = 0;
  private bank = 0;
  private size = GLOW.watch;
  private time = 0;
  private embers = 0;
  private disposed = false;
  private readonly at = new THREE.Vector3();

  constructor(assets: AssetLoader, private readonly fx: HitFx | null) {
    this.glow.position.set(0, W.mouth.up, W.mouth.fwd);
    this.glow.renderOrder = 5;
    this.root.add(this.body, this.glow);
    void assets.instance('drake').then((m) => {
      if (this.disposed) {
        m.dispose();
        return;
      }
      m.root.scale.multiplyScalar(W.scale);
      // Its own dark materials: the template's are shared with the Drake.
      m.root.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh) return;
        const dark = (src: THREE.Material): THREE.Material => {
          const mat = src.clone() as THREE.MeshStandardMaterial;
          mat.color?.multiplyScalar(HIDE);
          if (mat.emissive) {
            mat.emissive.setHex(EMBER);
            mat.emissiveIntensity = 0.5;
          }
          this.owned.push(mat);
          return mat;
        };
        mesh.material = Array.isArray(mesh.material) ? mesh.material.map(dark) : dark(mesh.material);
      });
      this.model = m;
      this.body.add(m.root);
      this.animator = new Animator(m.root, m.clips);
    });
  }

  update(e: Readonly<Entity>, alpha: number, dt: number): void {
    placeEntity(this.root, e, alpha);
    this.time += dt;
    const s = e.warden;
    const anim = this.animator;
    const hspeed = Math.hypot(e.tf.vel.x, e.tf.vel.z);
    const nose = clamp(Math.atan2(-e.tf.vel.y, Math.max(1, hspeed)), -0.6, 0.85) * 0.8;
    const bank = clamp(-wrap(e.tf.yaw - e.tf.prevYaw) * TICK_HZ * 0.45, -0.55, 0.55);
    let want: number = GLOW.watch;
    if (s && s.burning >= 0) {
      // The burn's warning: the jaw opens to the spit's frame as the glow swells.
      const u = s.burning / W.burnTelegraph;
      anim?.scrub('fireball', SPIT_AT * u, ENTRY_FADE);
      want = GLOW.strike + (GLOW.burn - GLOW.strike) * u;
    } else if (s?.mode === 'strike' && anim?.has('fireball')) {
      // One spit for each fireball of the barrage.
      const every = W.volleyEvery / TICK_HZ;
      const u = 1 - clamp(s.volley / W.volleyEvery, 0, 1);
      anim.scrub('fireball', SPIT_AT + u * Math.min(anim.duration('fireball') - SPIT_AT, every), ENTRY_FADE);
      want = GLOW.strike;
    } else anim?.loop('fly', 1 + Math.min(0.6, hspeed / 60));
    this.pitch += (nose - this.pitch) * (1 - Math.exp(-6 * dt));
    this.bank += (bank - this.bank) * (1 - Math.exp(-5 * dt));
    this.body.rotation.x = this.pitch;
    this.body.rotation.z = this.bank;
    this.size += (want - this.size) * (1 - Math.exp(-10 * dt));
    const flicker = this.size * (1 + 0.12 * Math.sin(this.time * 27));
    this.glow.scale.set(flicker, flicker, 1);
    this.glowMat.color.setHex(s && s.burning >= 0 ? 0xffd9a0 : 0xff4a14);
    anim?.update(dt);
    // Sparks fall from its mouth while it means harm.
    this.embers += dt;
    if (this.fx && s?.mode === 'strike' && this.embers > 0.06) {
      this.embers = 0;
      this.fx.emit(this.glow.getWorldPosition(this.at), 'fire', 4, 0.6, 3);
    }
  }

  dispose(): void {
    this.disposed = true;
    this.animator?.dispose();
    this.model?.dispose();
    for (const m of this.owned) m.dispose();
    this.glowMat.dispose();
    this.root.removeFromParent();
  }
}
