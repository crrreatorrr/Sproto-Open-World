import * as THREE from 'three';
import { runeTexture } from './textures';

type P3 = { x: number; y: number; z: number };

/** Chain Zap: how long the bolt stays, how often it re-jags, and its half-widths (m). */
const ZAP_LIFE = 0.16;
const ZAP_REJAG = 0.04;
const ZAP_STEP = 0.45;
const ZAP_JITTER = 0.22;
const ZAP_CORE = 0.035;
const ZAP_GLOW = 0.14;
/** Woven-cast rune: life (s) and size (m). */
const RUNE_LIFE = 0.32;
const RUNE_SIZE = 1.1;
const MAX_RUNES = 4;

const UP = new THREE.Vector3(0, 1, 0);
const X = new THREE.Vector3(1, 0, 0);

interface Zap {
  points: THREE.Vector3[];
  core: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  glow: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  age: number;
  jag: number;
}

/**
 * Spell visuals that aren't sparks (plan §4.4): Chain Zap's lightning and the woven-cast rune.
 * Lightning is two crossed ribbons per strand (a bright core and a wide soft glow), so it reads
 * from any angle without facing the camera; it re-jags a few times over its short life.
 */
export class SpellFx {
  readonly root = new THREE.Group();
  private readonly zaps: Zap[] = [];
  private readonly runes: (THREE.Sprite & { age: number })[] = [];
  private readonly a = new THREE.Vector3();
  private readonly d = new THREE.Vector3();
  private readonly p1 = new THREE.Vector3();
  private readonly p2 = new THREE.Vector3();

  constructor() {
    for (let i = 0; i < MAX_RUNES; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: runeTexture(), color: 0x7ff4ff, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending })) as THREE.Sprite & { age: number };
      s.age = RUNE_LIFE;
      s.visible = false;
      s.renderOrder = 6;
      this.runes.push(s);
      this.root.add(s);
    }
  }

  /** Lightning through `points` (the caster's hand first, then each target's chest). */
  zap(points: readonly P3[]): void {
    if (points.length < 2) return;
    const pts = points.map((p) => new THREE.Vector3(p.x, p.y, p.z));
    let n = 0;
    for (let i = 1; i < pts.length; i++) n += Math.max(1, Math.ceil(pts[i].distanceTo(pts[i - 1]) / ZAP_STEP));
    const verts = (n + 1) * 4;
    const mk = (color: number, opacity: number) => {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(verts * 3), 3).setUsage(THREE.DynamicDrawUsage));
      const idx: number[] = [];
      // Two ribbons: vertices (4k, 4k+1) and (4k+2, 4k+3) at each polyline point k.
      for (let k = 0; k < n; k++) {
        for (const o of [0, 2]) {
          const a = 4 * k + o, b = a + 1, c = a + 4, d = a + 5;
          idx.push(a, b, c, b, d, c);
        }
      }
      g.setIndex(idx);
      const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }));
      m.frustumCulled = false;
      m.renderOrder = 6;
      this.root.add(m);
      return m;
    };
    const z: Zap = { points: pts, core: mk(0xfffbe0, 1), glow: mk(0xffe04a, 0.45), age: 0, jag: 0 };
    this.jag(z);
    this.zaps.push(z);
  }

  /** The cyan rune a woven cast flashes at the caster's hands. */
  rune(p: P3): void {
    const s = this.runes.find((r) => r.age >= RUNE_LIFE) ?? this.runes[0];
    s.position.set(p.x, p.y, p.z);
    s.age = 0;
    s.visible = true;
  }

  update(dt: number): void {
    for (let i = this.zaps.length - 1; i >= 0; i--) {
      const z = this.zaps[i];
      z.age += dt;
      if (z.age >= ZAP_LIFE) {
        for (const m of [z.core, z.glow]) {
          m.geometry.dispose();
          m.material.dispose();
          m.removeFromParent();
        }
        this.zaps.splice(i, 1);
        continue;
      }
      z.jag += dt;
      if (z.jag >= ZAP_REJAG) {
        z.jag = 0;
        this.jag(z);
      }
      // Flicker: dips between re-jags, fading over the last third.
      const k = Math.min(1, (ZAP_LIFE - z.age) / (ZAP_LIFE / 3));
      const f = 0.65 + 0.35 * Math.random();
      z.core.material.opacity = k * f;
      z.glow.material.opacity = 0.45 * k * f;
    }
    for (const s of this.runes) {
      if (!s.visible) continue;
      s.age += dt;
      const u = s.age / RUNE_LIFE;
      if (u >= 1) {
        s.visible = false;
        continue;
      }
      const sc = RUNE_SIZE * (0.55 + 0.6 * (1 - (1 - u) * (1 - u)));
      s.scale.set(sc, sc, 1);
      s.material.opacity = 1 - u * u;
      s.material.rotation = u * 1.2;
    }
  }

  /** A fresh jagged path through the zap's points, written into both ribbons. */
  private jag(z: Zap): void {
    const core = z.core.geometry.attributes.position as THREE.BufferAttribute;
    const glow = z.glow.geometry.attributes.position as THREE.BufferAttribute;
    let v = 0;
    const put = (p: THREE.Vector3, dir: THREE.Vector3) => {
      this.p1.crossVectors(dir, Math.abs(dir.y) > 0.95 ? X : UP).normalize();
      this.p2.crossVectors(dir, this.p1).normalize();
      for (const [attr, w] of [[core, ZAP_CORE], [glow, ZAP_GLOW]] as const) {
        attr.setXYZ(v, p.x + this.p1.x * w, p.y + this.p1.y * w, p.z + this.p1.z * w);
        attr.setXYZ(v + 1, p.x - this.p1.x * w, p.y - this.p1.y * w, p.z - this.p1.z * w);
        attr.setXYZ(v + 2, p.x + this.p2.x * w, p.y + this.p2.y * w, p.z + this.p2.z * w);
        attr.setXYZ(v + 3, p.x - this.p2.x * w, p.y - this.p2.y * w, p.z - this.p2.z * w);
      }
      v += 4;
    };
    const pts = z.points;
    for (let i = 1; i < pts.length; i++) {
      const from = pts[i - 1], to = pts[i];
      this.d.subVectors(to, from);
      const len = this.d.length();
      const steps = Math.max(1, Math.ceil(len / ZAP_STEP));
      this.d.divideScalar(len || 1);
      // Ends sit exactly on the hand and the chests; the middle wanders.
      for (let s = i === 1 ? 0 : 1; s <= steps; s++) {
        const u = s / steps;
        this.a.lerpVectors(from, to, u);
        if (s > 0 && s < steps) this.a.set(this.a.x + (Math.random() - 0.5) * 2 * ZAP_JITTER, this.a.y + (Math.random() - 0.5) * 2 * ZAP_JITTER, this.a.z + (Math.random() - 0.5) * 2 * ZAP_JITTER);
        put(this.a, this.d);
      }
    }
    core.needsUpdate = glow.needsUpdate = true;
  }

  clear(): void {
    for (const z of this.zaps) z.age = ZAP_LIFE;
    this.update(0);
    for (const s of this.runes) {
      s.age = RUNE_LIFE;
      s.visible = false;
    }
  }
}
