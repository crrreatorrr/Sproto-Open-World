import * as THREE from 'three';
import { glowTexture } from './textures';

export type SparkStyle =
  | 'normal' | 'heavy' | 'crit' | 'weak' | 'resist' | 'hurt' | 'block' | 'parry'
  // M1b spells and statuses: an arcane hit, Blast's fire, Frost Nova's ice, Chain Zap's sparks, the Wisp's hex.
  | 'arcane' | 'fire' | 'frost' | 'shock' | 'hex'
  // M6: the glowing ash a dissolving body sheds.
  | 'ash';

/** Count, speed (m/s), life (s) and colour of each burst style. `gravity`: share of full gravity (default 1). */
const STYLES: Record<SparkStyle, { n: number; speed: number; life: number; color: number; flash: number; flashSize: number; gravity?: number }> = {
  normal: { n: 14, speed: 5, life: 0.28, color: 0xffe9a8, flash: 0xfff2c8, flashSize: 0.7 },
  heavy: { n: 26, speed: 7, life: 0.36, color: 0xffd27a, flash: 0xffe0a0, flashSize: 1.1 },
  crit: { n: 30, speed: 8, life: 0.4, color: 0xfff6d0, flash: 0xffffff, flashSize: 1.3 },
  weak: { n: 28, speed: 7.5, life: 0.38, color: 0xff9a2e, flash: 0xffb04a, flashSize: 1.2 },
  resist: { n: 8, speed: 3, life: 0.22, color: 0x9a9a9a, flash: 0x8a8a8a, flashSize: 0.45 },
  hurt: { n: 16, speed: 5, life: 0.3, color: 0xff6a5a, flash: 0xff8070, flashSize: 0.8 },
  block: { n: 12, speed: 4, life: 0.25, color: 0x9fd0ff, flash: 0xc0e0ff, flashSize: 0.7 },
  parry: { n: 48, speed: 9, life: 0.5, color: 0xd8f4ff, flash: 0xffffff, flashSize: 2.4 },
  arcane: { n: 16, speed: 5, life: 0.3, color: 0x7ff4ff, flash: 0xb8fbff, flashSize: 0.9 },
  fire: { n: 40, speed: 8, life: 0.5, color: 0xff8a2a, flash: 0xffc070, flashSize: 2.2 },
  frost: { n: 22, speed: 5, life: 0.45, color: 0xbfe8ff, flash: 0xdff4ff, flashSize: 1 },
  shock: { n: 14, speed: 7, life: 0.2, color: 0xfff27a, flash: 0xfff8c0, flashSize: 0.8 },
  hex: { n: 16, speed: 4, life: 0.35, color: 0xc070ff, flash: 0xd8a0ff, flashSize: 1 },
  ash: { n: 6, speed: 0.8, life: 1.3, color: 0xffa25a, flash: 0xffb070, flashSize: 0.4, gravity: 0.04 },
};

const MAX_SPARKS = 1024;
const MAX_SPRITES = 16;
const MAX_RINGS = 8;
const GRAVITY = 12;

interface Timed {
  age: number;
  life: number;
}

/**
 * Hit sparks, flashes and rings (plan §1, Feedback). Cheap on purpose: every spark is one point
 * in a single THREE.Points (one draw call, fixed buffers, no allocation per hit), fading by
 * darkening under additive blending; flashes and rings come from small fixed pools.
 */
export class HitFx {
  readonly root = new THREE.Group();
  private readonly pos = new Float32Array(MAX_SPARKS * 3);
  private readonly col = new Float32Array(MAX_SPARKS * 3);
  private readonly vel = new Float32Array(MAX_SPARKS * 3);
  private readonly base = new Float32Array(MAX_SPARKS * 3);
  private readonly age = new Float32Array(MAX_SPARKS);
  private readonly life = new Float32Array(MAX_SPARKS);
  private readonly fall = new Float32Array(MAX_SPARKS);
  /** Share of each burst's sparks that are drawn (graphics quality). */
  density = 1;
  /** Strength of the flash sprites (the screen flashes setting); 0 draws none. */
  flashScale = 1;
  private next = 0;
  private readonly points: THREE.Points;
  private readonly sprites: (THREE.Sprite & { fx: Timed & { size: number } })[] = [];
  private readonly rings: (THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial> & { fx: Timed & { from: number; to: number } })[] = [];
  private readonly tmp = new THREE.Color();
  private live = 0;

  constructor() {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('color', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    this.points = new THREE.Points(
      geo,
      new THREE.PointsMaterial({ size: 0.09, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, map: glowTexture() }),
    );
    // The buffer moves every frame; its bounds would always be stale.
    this.points.frustumCulled = false;
    this.root.add(this.points);
    for (let i = 0; i < MAX_SPRITES; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending })) as THREE.Sprite & { fx: Timed & { size: number } };
      s.fx = { age: 1, life: 0, size: 1 };
      s.visible = false;
      s.renderOrder = 5;
      this.sprites.push(s);
      this.root.add(s);
    }
    const ringGeo = new THREE.RingGeometry(0.86, 1, 40).rotateX(-Math.PI / 2);
    for (let i = 0; i < MAX_RINGS; i++) {
      const m = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide })) as THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial> & { fx: Timed & { from: number; to: number } };
      m.fx = { age: 1, life: 0, from: 0, to: 1 };
      m.visible = false;
      this.rings.push(m);
      this.root.add(m);
    }
  }

  /** A burst of sparks and a flash at `p`. Returns the number of sparks spawned. */
  burst(p: { x: number; y: number; z: number }, style: SparkStyle): number {
    const s = STYLES[style];
    this.emit(p, style, s.n);
    this.flash(p, s.flash, s.flashSize, style === 'parry' ? 0.22 : 0.12);
    return s.n;
  }

  /**
   * `n` sparks of a style at `p` with no flash (status embers and crackle). `speed` scales the
   * style's speed; `lift` (m/s) is added upward so embers rise instead of arcing out.
   */
  emit(p: { x: number; y: number; z: number }, style: SparkStyle, n: number, speed = 1, lift = 0): void {
    const s = STYLES[style];
    const c = this.tmp.setHex(s.color);
    const count = Math.ceil(n * this.density);
    for (let k = 0; k < count; k++) {
      const i = this.next;
      this.next = (this.next + 1) % MAX_SPARKS;
      // A random direction, biased upward so sparks arc out instead of into the ground.
      const u = Math.random() * 2 - 1, th = Math.random() * Math.PI * 2;
      const r = Math.sqrt(1 - u * u);
      const sp = s.speed * speed * (0.4 + Math.random() * 0.8);
      this.vel[i * 3] = r * Math.cos(th) * sp;
      this.vel[i * 3 + 1] = (Math.abs(u) * 0.8 + 0.3) * sp + lift;
      this.vel[i * 3 + 2] = r * Math.sin(th) * sp;
      this.pos[i * 3] = p.x;
      this.pos[i * 3 + 1] = p.y;
      this.pos[i * 3 + 2] = p.z;
      this.base[i * 3] = c.r;
      this.base[i * 3 + 1] = c.g;
      this.base[i * 3 + 2] = c.b;
      this.age[i] = 0;
      this.life[i] = s.life * (0.6 + Math.random() * 0.6);
      this.fall[i] = s.gravity ?? 1;
    }
    this.live = MAX_SPARKS;
  }

  /** A soft additive flash sprite. */
  flash(p: { x: number; y: number; z: number }, color: number, size: number, life: number): void {
    if (this.flashScale <= 0) return;
    const s = this.sprites.find((x) => x.fx.age >= x.fx.life) ?? this.sprites[0];
    s.position.set(p.x, p.y, p.z);
    s.material.color.setHex(color);
    s.fx.age = 0;
    s.fx.life = life;
    s.fx.size = size;
    s.visible = true;
  }

  /** An expanding flat ring (perfect dodge, parry). */
  ring(p: { x: number; y: number; z: number }, color: number, from: number, to: number, life: number): void {
    const m = this.rings.find((x) => x.fx.age >= x.fx.life) ?? this.rings[0];
    m.position.set(p.x, p.y + 0.05, p.z);
    m.material.color.setHex(color);
    m.fx.age = 0;
    m.fx.life = life;
    m.fx.from = from;
    m.fx.to = to;
    m.visible = true;
  }

  update(dt: number): void {
    if (this.live > 0) {
      let alive = 0;
      for (let i = 0; i < MAX_SPARKS; i++) {
        if (this.age[i] >= this.life[i]) {
          this.col[i * 3] = this.col[i * 3 + 1] = this.col[i * 3 + 2] = 0;
          continue;
        }
        alive++;
        this.age[i] += dt;
        this.vel[i * 3 + 1] -= GRAVITY * this.fall[i] * dt;
        const drag = Math.exp(-3 * dt);
        this.vel[i * 3] *= drag;
        this.vel[i * 3 + 2] *= drag;
        this.pos[i * 3] += this.vel[i * 3] * dt;
        this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
        this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
        const k = Math.max(0, 1 - this.age[i] / this.life[i]);
        this.col[i * 3] = this.base[i * 3] * k;
        this.col[i * 3 + 1] = this.base[i * 3 + 1] * k;
        this.col[i * 3 + 2] = this.base[i * 3 + 2] * k;
      }
      const g = this.points.geometry;
      g.attributes.position.needsUpdate = true;
      g.attributes.color.needsUpdate = true;
      this.live = alive;
    }
    for (const s of this.sprites) {
      if (!s.visible) continue;
      s.fx.age += dt;
      const k = 1 - s.fx.age / s.fx.life;
      if (k <= 0) {
        s.visible = false;
        continue;
      }
      const sc = s.fx.size * (0.6 + 0.4 * (1 - k));
      s.scale.set(sc, sc, 1);
      s.material.opacity = k * this.flashScale;
    }
    for (const m of this.rings) {
      if (!m.visible) continue;
      m.fx.age += dt;
      const u = m.fx.age / m.fx.life;
      if (u >= 1) {
        m.visible = false;
        continue;
      }
      const e = 1 - (1 - u) * (1 - u);
      m.scale.setScalar(m.fx.from + (m.fx.to - m.fx.from) * e);
      m.material.opacity = 1 - u;
    }
  }

  clear(): void {
    this.age.fill(0);
    this.life.fill(0);
    this.col.fill(0);
    this.live = 1;
    for (const s of this.sprites) s.visible = false;
    for (const m of this.rings) m.visible = false;
  }
}
