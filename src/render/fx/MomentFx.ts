import * as THREE from 'three';
import type { HitFx } from './HitFx';
import { glowTexture } from './textures';

const MAX_MOTES = 160;
const MAX_MOMENTS = 3;

/** How one moment looks and how long it lasts. */
interface Look {
  color: number;
  /** Seconds it lasts, and its column of light's height and radius (m); no height, no column. */
  life: number;
  height: number;
  radius: number;
  /** Motes per second while it lasts, and how fast they climb (m/s). */
  rate: number;
  climb: number;
}

const LEVEL_UP: Look = { color: 0xffd25a, life: 1.8, height: 7, radius: 1.1, rate: 70, climb: 2.6 };
const REST: Look = { color: 0x7fe8c8, life: 2.4, height: 4.5, radius: 1.5, rate: 46, climb: 1.3 };
const HEAL: Look = { color: 0x8dffa0, life: 0.9, height: 0, radius: 0.7, rate: 34, climb: 1.5 };

interface Moment {
  target: THREE.Object3D;
  look: Look;
  age: number;
  owed: number;
  pillar: THREE.Mesh<THREE.CylinderGeometry, THREE.MeshBasicMaterial>;
}

/** Light that is brightest at its foot and gone at its top. */
function pillarTexture(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = 4;
  c.height = 64;
  const g = c.getContext('2d')!;
  const grad = g.createLinearGradient(0, 64, 0, 0);
  grad.addColorStop(0, 'rgba(255,255,255,0.9)');
  grad.addColorStop(0.5, 'rgba(255,255,255,0.3)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 4, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/**
 * The player's big quiet moments: a column of gold and rising motes on a level-up, the shrine's
 * pale light on a rest, a brief green lift from a tonic. Each follows the body it was given.
 */
export class MomentFx {
  readonly root = new THREE.Group();
  private readonly moments: Moment[] = [];
  private readonly idle: Moment['pillar'][] = [];
  private readonly points: THREE.Points;
  private readonly pos = new Float32Array(MAX_MOTES * 3);
  private readonly col = new Float32Array(MAX_MOTES * 3);
  private readonly base = new Float32Array(MAX_MOTES * 3);
  private readonly age = new Float32Array(MAX_MOTES);
  private readonly life = new Float32Array(MAX_MOTES);
  private readonly angle = new Float32Array(MAX_MOTES);
  private readonly spin = new Float32Array(MAX_MOTES);
  private readonly reach = new Float32Array(MAX_MOTES);
  private readonly climb = new Float32Array(MAX_MOTES);
  private readonly owner: (THREE.Object3D | null)[] = new Array<THREE.Object3D | null>(MAX_MOTES).fill(null);
  private next = 0;
  private readonly tmp = new THREE.Color();

  constructor(private readonly fx: HitFx) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('color', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    this.points = new THREE.Points(geo, new THREE.PointsMaterial({ size: 0.16, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, map: glowTexture() }));
    this.points.frustumCulled = false;
    this.root.add(this.points);
    const tube = new THREE.CylinderGeometry(1, 1, 1, 28, 1, true).translate(0, 0.5, 0);
    const light = pillarTexture();
    for (let i = 0; i < MAX_MOMENTS; i++) {
      const m = new THREE.Mesh(tube, new THREE.MeshBasicMaterial({ map: light, transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending }));
      m.visible = false;
      this.idle.push(m);
      this.root.add(m);
    }
  }

  levelUp(target: THREE.Object3D): void {
    this.begin(target, LEVEL_UP);
    this.fx.ring(target.position, 0xffd25a, 0.3, 4.5, 0.7);
    this.fx.ring(target.position, 0xfff0b0, 0.2, 3, 0.5);
    this.fx.flash({ x: target.position.x, y: target.position.y + 1.2, z: target.position.z }, 0xffe6a0, 3.2, 0.3);
  }

  rest(target: THREE.Object3D): void {
    this.begin(target, REST);
    this.fx.ring(target.position, 0x7fe8c8, 0.3, 3.2, 0.9);
  }

  heal(target: THREE.Object3D): void {
    this.begin(target, HEAL);
  }

  private begin(target: THREE.Object3D, look: Look): void {
    // Out of pillars: the oldest moment gives its own up.
    if (!this.idle.length) this.finish(this.moments[0]);
    const pillar = this.idle.pop()!;
    pillar.material.color.setHex(look.color);
    pillar.visible = look.height > 0;
    this.moments.push({ target, look, age: 0, owed: 0, pillar });
  }

  private finish(m: Moment): void {
    m.pillar.visible = false;
    this.idle.push(m.pillar);
    this.moments.splice(this.moments.indexOf(m), 1);
  }

  private mote(m: Moment): void {
    const i = this.next;
    this.next = (i + 1) % MAX_MOTES;
    const c = this.tmp.setHex(m.look.color);
    this.base.set([c.r, c.g, c.b], i * 3);
    this.age[i] = 0;
    this.life[i] = 0.7 + Math.random() * 0.7;
    this.angle[i] = Math.random() * Math.PI * 2;
    this.spin[i] = (Math.random() < 0.5 ? -1 : 1) * (1.5 + Math.random() * 2);
    this.reach[i] = m.look.radius * (0.4 + Math.random() * 0.7);
    this.climb[i] = m.look.climb * (0.7 + Math.random() * 0.6);
    this.owner[i] = m.target;
  }

  update(dt: number): void {
    for (const m of [...this.moments]) {
      m.age += dt;
      const u = m.age / m.look.life;
      if (u >= 1) {
        this.finish(m);
        continue;
      }
      m.owed += m.look.rate * this.fx.density * dt;
      for (; m.owed >= 1; m.owed--) this.mote(m);
      if (m.pillar.visible) {
        const t = m.target.position;
        const open = 1 - (1 - Math.min(1, u * 5)) ** 2;
        m.pillar.position.set(t.x, t.y, t.z);
        m.pillar.scale.set(m.look.radius * (0.5 + 0.5 * open), m.look.height * open, m.look.radius * (0.5 + 0.5 * open));
        m.pillar.material.opacity = 0.75 * Math.min(1, (1 - u) * 2.5);
      }
    }
    let any = false;
    for (let i = 0; i < MAX_MOTES; i++) {
      const who = this.owner[i];
      if (!who) continue;
      this.age[i] += dt;
      const k = 1 - this.age[i] / this.life[i];
      if (k <= 0) {
        this.owner[i] = null;
        this.col.fill(0, i * 3, i * 3 + 3);
        any = true;
        continue;
      }
      any = true;
      this.angle[i] += this.spin[i] * dt;
      this.reach[i] *= Math.exp(-0.5 * dt);
      const rise = this.climb[i] * this.age[i];
      this.pos[i * 3] = who.position.x + Math.cos(this.angle[i]) * this.reach[i];
      this.pos[i * 3 + 1] = who.position.y + 0.1 + rise;
      this.pos[i * 3 + 2] = who.position.z + Math.sin(this.angle[i]) * this.reach[i];
      // Additive: fading to black fades it out.
      const glow = Math.min(1, k * 2);
      for (let a = 0; a < 3; a++) this.col[i * 3 + a] = this.base[i * 3 + a] * glow;
    }
    if (any) {
      const g = this.points.geometry;
      g.attributes.position.needsUpdate = true;
      g.attributes.color.needsUpdate = true;
    }
  }

  clear(): void {
    for (const m of [...this.moments]) this.finish(m);
    this.owner.fill(null);
    this.col.fill(0);
    this.points.geometry.attributes.color.needsUpdate = true;
  }
}
