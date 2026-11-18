import * as THREE from 'three';
import type { HitFx, SparkStyle } from './HitFx';
import type { SpellFx } from './SpellFx';
import { starTexture } from './textures';

type P3 = { x: number; y: number; z: number };

const MAX_SLASHES = 14;
const MAX_STARS = 6;
const MAX_SCORCH = 6;
const MAX_SHARDS = 48;
const SLASH_LIFE = 0.14;
const STAR_LIFE = 0.22;
const SCORCH_LIFE = 6;
const SHARD_LIFE = 0.55;
const SHARD_GRAVITY = 11;

/** The streak each hit style draws across the blow: colour, length and width (m). */
const SLASH: Partial<Record<SparkStyle, { color: number; len: number; width: number }>> = {
  normal: { color: 0xfff0c0, len: 1.25, width: 0.16 },
  heavy: { color: 0xffd488, len: 2, width: 0.26 },
  crit: { color: 0xffffff, len: 2.3, width: 0.28 },
  weak: { color: 0xffa040, len: 2, width: 0.26 },
  resist: { color: 0x9a9a9a, len: 0.7, width: 0.1 },
  hurt: { color: 0xff7464, len: 1.4, width: 0.2 },
  block: { color: 0xa8d8ff, len: 1.1, width: 0.16 },
};

interface Timed {
  age: number;
  life: number;
}
type Slash = THREE.Sprite & { fx: Timed & { len: number; width: number } };
type Star = THREE.Sprite & { fx: Timed & { size: number } };
type Scorch = THREE.Mesh<THREE.CircleGeometry, THREE.MeshBasicMaterial> & { fx: Timed };

/** A tapered white streak, bright along its middle. */
function slashTexture(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 24;
  const g = c.getContext('2d')!;
  const along = g.createLinearGradient(0, 0, 128, 0);
  along.addColorStop(0, 'rgba(255,255,255,0)');
  along.addColorStop(0.5, 'rgba(255,255,255,1)');
  along.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = along;
  g.beginPath();
  g.moveTo(0, 12);
  g.quadraticCurveTo(64, -6, 128, 12);
  g.quadraticCurveTo(64, 30, 0, 12);
  g.fill();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** A soft, ragged black burn for the ground. */
function scorchTexture(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  for (let i = 0; i < 26; i++) {
    const a = (i / 26) * Math.PI * 2;
    const r = 20 + (i % 5) * 7;
    const x = 64 + Math.cos(a) * r, y = 64 + Math.sin(a) * r;
    const blob = g.createRadialGradient(x, y, 0, x, y, 30);
    blob.addColorStop(0, 'rgba(12,9,7,0.5)');
    blob.addColorStop(1, 'rgba(12,9,7,0)');
    g.fillStyle = blob;
    g.fillRect(0, 0, 128, 128);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/**
 * The second layer of a blow, over HitFx's sparks: a streak across the impact, a star on the big
 * ones, ice that shatters outward, and burns left on the ground. Everything comes from fixed pools.
 */
export class ImpactFx {
  readonly root = new THREE.Group();
  private readonly slashes: Slash[] = [];
  private readonly stars: Star[] = [];
  private readonly scorches: Scorch[] = [];
  private readonly shards: THREE.InstancedMesh;
  private readonly shardPos = new Float32Array(MAX_SHARDS * 3);
  private readonly shardVel = new Float32Array(MAX_SHARDS * 3);
  private readonly shardAge = new Float32Array(MAX_SHARDS).fill(SHARD_LIFE);
  private nextShard = 0;
  private shardsLive = false;
  private readonly dummy = new THREE.Object3D();

  constructor(private readonly fx: HitFx, private readonly spells: SpellFx) {
    const streak = slashTexture();
    for (let i = 0; i < MAX_SLASHES; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: streak, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending })) as Slash;
      s.fx = { age: 1, life: 0, len: 1, width: 0.2 };
      s.visible = false;
      s.renderOrder = 6;
      this.slashes.push(s);
      this.root.add(s);
    }
    for (let i = 0; i < MAX_STARS; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: starTexture(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending })) as Star;
      s.fx = { age: 1, life: 0, size: 1 };
      s.visible = false;
      s.renderOrder = 7;
      this.stars.push(s);
      this.root.add(s);
    }
    const burn = scorchTexture();
    const disc = new THREE.CircleGeometry(1, 20).rotateX(-Math.PI / 2);
    for (let i = 0; i < MAX_SCORCH; i++) {
      const m = new THREE.Mesh(disc, new THREE.MeshBasicMaterial({ map: burn, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 })) as Scorch;
      m.fx = { age: 1, life: 0 };
      m.visible = false;
      this.scorches.push(m);
      this.root.add(m);
    }
    this.shards = new THREE.InstancedMesh(
      new THREE.OctahedronGeometry(0.09),
      new THREE.MeshBasicMaterial({ color: 0xcdf1ff, transparent: true, opacity: 0.9, depthWrite: false }),
      MAX_SHARDS,
    );
    this.shards.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.shards.frustumCulled = false;
    this.shards.visible = false;
    this.root.add(this.shards);
  }

  /** A blow landed at `p`, in the spark style App chose for it. */
  hit(p: P3, style: SparkStyle, heavy: boolean, crit: boolean): void {
    const look = SLASH[style];
    if (look) {
      const angle = Math.random() * Math.PI;
      this.slash(p, look.color, look.len, look.width, angle);
      // A big blow crosses its own streak.
      if (heavy || crit) this.slash(p, look.color, look.len * 0.7, look.width * 0.8, angle + Math.PI / 2 + (Math.random() - 0.5) * 0.6);
    }
    if (crit || style === 'weak') this.star(p, style === 'weak' ? 0xffb050 : 0xffffff, 2.2);
    switch (style) {
      case 'fire':
        this.fx.ring(p, 0xff8a30, 0.2, 1.5, 0.28);
        this.fx.emit(p, 'fire', 10, 0.5, 2.5);
        return;
      case 'frost':
        this.shatter(p, 8);
        return;
      case 'shock':
        this.arc(p, 0.8);
        return;
      case 'arcane':
        this.spells.rune(p);
        return;
      case 'hex':
        this.fx.ring(p, 0xc070ff, 0.2, 1.3, 0.3);
        return;
      default:
        return;
    }
  }

  /** A blow turned aside on a raised guard. */
  guard(p: P3, broke: boolean): void {
    this.slash(p, 0xa8d8ff, broke ? 2 : 1.1, broke ? 0.3 : 0.16, Math.random() * Math.PI);
    if (broke) this.star(p, 0xa8d8ff, 2.4);
  }

  /** A perfect parry: the brightest moment a blade can make. */
  parry(p: P3): void {
    const angle = Math.random() * Math.PI;
    this.slash(p, 0xe0f6ff, 2.8, 0.3, angle);
    this.slash(p, 0xe0f6ff, 2.8, 0.3, angle + Math.PI / 2);
    this.star(p, 0xffffff, 3.2);
  }

  /** Ice flung outward from `p` (a freeze taking hold or breaking, Frost Nova). */
  shatter(p: P3, n: number): void {
    const count = Math.ceil(n * this.fx.density);
    for (let k = 0; k < count; k++) {
      const i = this.nextShard;
      this.nextShard = (i + 1) % MAX_SHARDS;
      const a = Math.random() * Math.PI * 2;
      const sp = 2 + Math.random() * 3;
      this.shardPos.set([p.x, p.y, p.z], i * 3);
      this.shardVel.set([Math.cos(a) * sp, 1.5 + Math.random() * 3, Math.sin(a) * sp], i * 3);
      this.shardAge[i] = Math.random() * 0.12;
    }
    this.shardsLive = true;
    this.shards.visible = true;
  }

  /** A burn on the ground, the blast's size. `y` is the ground's height there. */
  scorch(x: number, y: number, z: number, radius: number): void {
    const m = this.scorches.find((s) => s.fx.age >= s.fx.life) ?? this.scorches.reduce((a, b) => (b.fx.age > a.fx.age ? b : a));
    m.position.set(x, y + 0.06, z);
    m.rotation.y = Math.random() * Math.PI * 2;
    m.scale.setScalar(radius);
    m.fx.age = 0;
    m.fx.life = SCORCH_LIFE;
    m.visible = true;
  }

  /** A short arc of lightning jumping off `p`. */
  private arc(p: P3, reach: number): void {
    const a = Math.random() * Math.PI * 2;
    this.spells.zap([p, { x: p.x + Math.cos(a) * reach, y: p.y + (Math.random() - 0.5) * reach, z: p.z + Math.sin(a) * reach }]);
  }

  private slash(p: P3, color: number, len: number, width: number, angle: number): void {
    const s = this.slashes.find((x) => x.fx.age >= x.fx.life) ?? this.slashes[0];
    s.position.set(p.x, p.y, p.z);
    s.material.color.setHex(color);
    s.material.rotation = angle;
    s.fx.age = 0;
    s.fx.life = SLASH_LIFE;
    s.fx.len = len;
    s.fx.width = width;
    s.visible = true;
  }

  private star(p: P3, color: number, size: number): void {
    if (this.fx.flashScale <= 0) return;
    const s = this.stars.find((x) => x.fx.age >= x.fx.life) ?? this.stars[0];
    s.position.set(p.x, p.y, p.z);
    s.material.color.setHex(color);
    s.material.rotation = Math.random() * Math.PI;
    s.fx.age = 0;
    s.fx.life = STAR_LIFE;
    s.fx.size = size;
    s.visible = true;
  }

  update(dt: number): void {
    for (const s of this.slashes) {
      if (!s.visible) continue;
      s.fx.age += dt;
      const u = s.fx.age / s.fx.life;
      if (u >= 1) {
        s.visible = false;
        continue;
      }
      // Snaps out to full length at once, then thins away.
      s.scale.set(s.fx.len * (0.7 + 0.3 * Math.min(1, u * 4)), s.fx.width * (1 - u), 1);
      s.material.opacity = 1 - u * u;
    }
    for (const s of this.stars) {
      if (!s.visible) continue;
      s.fx.age += dt;
      const u = s.fx.age / s.fx.life;
      if (u >= 1) {
        s.visible = false;
        continue;
      }
      const size = s.fx.size * (0.5 + 0.5 * Math.sin(Math.min(1, u * 2.5) * Math.PI * 0.5)) * (1 - u * 0.4);
      s.scale.set(size, size, 1);
      s.material.opacity = (1 - u) * this.fx.flashScale;
    }
    for (const m of this.scorches) {
      if (!m.visible) continue;
      m.fx.age += dt;
      const left = m.fx.life - m.fx.age;
      if (left <= 0) {
        m.visible = false;
        continue;
      }
      m.material.opacity = Math.min(1, left / 2) * 0.85;
    }
    if (this.shardsLive) this.updateShards(dt);
  }

  private updateShards(dt: number): void {
    let live = false;
    const d = this.dummy;
    for (let i = 0; i < MAX_SHARDS; i++) {
      const age = this.shardAge[i] + dt;
      if (age >= SHARD_LIFE) {
        this.shardAge[i] = SHARD_LIFE;
        d.scale.setScalar(0);
      } else {
        live = true;
        this.shardAge[i] = age;
        this.shardVel[i * 3 + 1] -= SHARD_GRAVITY * dt;
        for (let a = 0; a < 3; a++) this.shardPos[i * 3 + a] += this.shardVel[i * 3 + a] * dt;
        d.position.set(this.shardPos[i * 3], this.shardPos[i * 3 + 1], this.shardPos[i * 3 + 2]);
        d.rotation.set(age * 9 + i, age * 7, 0);
        d.scale.set(0.7, 1.6, 0.7).multiplyScalar(1 - age / SHARD_LIFE);
      }
      d.updateMatrix();
      this.shards.setMatrixAt(i, d.matrix);
    }
    this.shards.instanceMatrix.needsUpdate = true;
    this.shardsLive = live;
    this.shards.visible = live;
  }

  clear(): void {
    for (const s of [...this.slashes, ...this.stars, ...this.scorches]) s.visible = false;
    this.shardAge.fill(SHARD_LIFE);
    this.shardsLive = false;
    this.shards.visible = false;
  }
}
