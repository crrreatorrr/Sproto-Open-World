import * as THREE from 'three';
import type { AssetLoader, ModelInstance } from '../../assets/AssetLoader';
import type { ModelKey } from '../../assets/manifest';
import { POWER } from '../../content/packs/c3';
import type { SpellId } from '../../content/spells';
import type { Entity, EntityId } from '../../sim/entity';
import type { SimEvent } from '../../sim/events';
import type { ReadonlySimView } from '../../sim/view';
import { lerpAngle } from '../views/interp';
import type { HitFx, SparkStyle } from './HitFx';
import { glowTexture } from './textures';

type PowerEvent = Extract<SimEvent, { type: 'power' }>;
type P3 = { x: number; y: number; z: number };
type Area = NonNullable<Entity['powerArea']>;
type WallArea = Extract<Area, { kind: 'wall' }>;
type BloomArea = Extract<Area, { kind: 'bloom' }>;

/** The hit sparks of a power's damage (null: the spell's usual arcane spark). */
export function powerSpark(spell: SpellId): SparkStyle | null {
  switch (spell) {
    case 'emberBreath':
      return 'fire';
    case 'staticSnare':
      return 'shock';
    case 'brambleWall':
    case 'vinePull':
      return 'normal';
    default:
      return null;
  }
}

/** Damage that ticks over and over: it sounds softer and doesn't shake the camera each time. */
export const isSoftPowerHit = (move: string): boolean => move === 'emberBreath' || move === 'brambleWall';

const MAX_MOTES = 420;
const WARD_POOL = 2;
const VINE_POOL = 2;
const VINE_LIFE = 0.32;
const THORNS = 36;
const FLAME_RATE = 150;
const FLAME_SPEED = 15;
const WALL_TINT = 0x9fc77a;
const FLOWER_TINT = 0xffb4dc;
const LEAF = 0x7fd65a;
const HEAL = 0x8dffa0;
const FLAME_COLORS = [0xffc24a, 0xff7a1e, 0xffe6a0, 0xff5a14];

const UP = new THREE.Vector3(0, 1, 0);

/** Soft additive motes in one draw call: flame, leaves, healing light. */
class Motes {
  readonly points: THREE.Points;
  private readonly pos = new Float32Array(MAX_MOTES * 3);
  private readonly col = new Float32Array(MAX_MOTES * 3);
  private readonly vel = new Float32Array(MAX_MOTES * 3);
  private readonly base = new Float32Array(MAX_MOTES * 3);
  private readonly age = new Float32Array(MAX_MOTES);
  private readonly life = new Float32Array(MAX_MOTES);
  private readonly c = new THREE.Color();
  private next = 0;

  constructor() {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('color', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    this.points = new THREE.Points(geo, new THREE.PointsMaterial({ size: 0.34, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, map: glowTexture() }));
    this.points.frustumCulled = false;
  }

  spawn(x: number, y: number, z: number, vx: number, vy: number, vz: number, color: number, life: number): void {
    const i = this.next;
    this.next = (i + 1) % MAX_MOTES;
    this.c.setHex(color);
    this.pos.set([x, y, z], i * 3);
    this.vel.set([vx, vy, vz], i * 3);
    this.base.set([this.c.r, this.c.g, this.c.b], i * 3);
    this.age[i] = 0;
    this.life[i] = life;
  }

  update(dt: number): void {
    for (let i = 0; i < MAX_MOTES; i++) {
      if (this.age[i] >= this.life[i]) {
        this.col[i * 3] = this.col[i * 3 + 1] = this.col[i * 3 + 2] = 0;
        continue;
      }
      this.age[i] += dt;
      const k = Math.max(0, 1 - this.age[i] / this.life[i]);
      for (let a = 0; a < 3; a++) {
        this.pos[i * 3 + a] += this.vel[i * 3 + a] * dt;
        this.col[i * 3 + a] = this.base[i * 3 + a] * k;
      }
    }
    const g = this.points.geometry;
    g.attributes.position.needsUpdate = true;
    g.attributes.color.needsUpdate = true;
  }

  clear(): void {
    this.age.fill(0);
    this.life.fill(0);
    this.col.fill(0);
  }
}

/** Fit a model into a box standing on y = 0, centred on (x, z). */
function fitPart(root: THREE.Object3D, width: number, height: number, depth: number, x: number, z: number): void {
  root.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(root);
  const size = box.getSize(new THREE.Vector3());
  const c = box.getCenter(new THREE.Vector3());
  const sx = width / Math.max(size.x, 1e-3), sy = height / Math.max(size.y, 1e-3), sz = depth / Math.max(size.z, 1e-3);
  root.scale.set(sx, sy, sz);
  root.position.set(x - c.x * sx, -box.min.y * sy, z - c.z * sz);
}

/** Grows in over `grow` ticks and withers over the last `fade`. */
const growth = (age: number, life: number, grow: number, fade: number): number => {
  const k = Math.min(1, age / grow, (life - age) / fade);
  return Math.max(0.01, 1 - (1 - k) * (1 - k));
};

type LoadPart = (key: ModelKey, tint: number) => Promise<ModelInstance>;

interface AreaView {
  readonly root: THREE.Group;
  update(e: Readonly<Entity>): void;
  dispose(): void;
}

/** Bramble Wall: the grove's root wall, tinted, in three clumps, bristling with thorns. */
class WallView implements AreaView {
  readonly root = new THREE.Group();
  private readonly thorns: THREE.InstancedMesh<THREE.ConeGeometry, THREE.MeshStandardMaterial>;
  private readonly parts: ModelInstance[] = [];
  private disposed = false;

  constructor(e: Readonly<Entity>, load: LoadPart) {
    const W = POWER.wall;
    this.root.position.set(e.tf.pos.x, e.tf.pos.y, e.tf.pos.z);
    this.root.rotation.y = e.tf.yaw;
    this.thorns = new THREE.InstancedMesh(new THREE.ConeGeometry(0.06, 0.6, 5), new THREE.MeshStandardMaterial({ color: 0x4f3d20, roughness: 0.8 }), THORNS);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), one = new THREE.Vector3(1, 1, 1), tilt = new THREE.Euler();
    for (let i = 0; i < THORNS; i++) {
      const side = i % 2 ? 1 : -1;
      p.set((Math.random() - 0.5) * W.length, 0.3 + Math.random() * (W.height - 0.6), side * (W.thickness / 2 + 0.12));
      // A cone points along +Y: a quarter turn about X points it out of the wall's face.
      tilt.set(side * (Math.PI / 2 + (Math.random() - 0.5) * 0.7), 0, (Math.random() - 0.5) * 0.7);
      this.thorns.setMatrixAt(i, m.compose(p, q.setFromEuler(tilt), one));
    }
    this.root.add(this.thorns);
    const clump = W.length / 3;
    for (let i = 0; i < 3; i++) {
      void load('prop_root_wall', WALL_TINT).then((part) => {
        if (this.disposed) return part.dispose();
        fitPart(part.root, clump * 1.3, W.height * (i === 1 ? 1 : 0.88), W.thickness * 1.5, (i - 1) * clump, 0);
        this.parts.push(part);
        this.root.add(part.root);
      });
    }
  }

  update(e: Readonly<Entity>): void {
    const a = e.powerArea as WallArea;
    this.root.scale.y = growth(a.age, a.life, 12, 18);
  }

  dispose(): void {
    this.disposed = true;
    for (const p of this.parts) p.dispose();
    this.thorns.geometry.dispose();
    this.thorns.material.dispose();
    this.thorns.dispose();
    this.root.removeFromParent();
  }
}

/** Healing Bloom: a soft glow on the ground, its rim, and the farm's crops in flower. */
class BloomView implements AreaView {
  readonly root = new THREE.Group();
  private readonly disc: THREE.Mesh<THREE.CircleGeometry, THREE.MeshBasicMaterial>;
  private readonly rim: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;
  private readonly parts: ModelInstance[] = [];
  private disposed = false;

  constructor(e: Readonly<Entity>, load: LoadPart) {
    const R = POWER.bloom.radius;
    this.root.position.set(e.tf.pos.x, e.tf.pos.y, e.tf.pos.z);
    const flat = { transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide } as const;
    this.disc = new THREE.Mesh(new THREE.CircleGeometry(R, 40).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ ...flat, color: HEAL, map: glowTexture(), opacity: 0.55 }));
    this.rim = new THREE.Mesh(new THREE.RingGeometry(R * 0.96, R, 56).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ ...flat, color: HEAL, opacity: 0.7 }));
    this.disc.position.y = this.rim.position.y = 0.12;
    this.root.add(this.disc, this.rim);
    for (let i = 0; i < 5; i++) {
      const ang = (i / 5) * Math.PI * 2 + 0.4;
      void load('prop_crops', FLOWER_TINT).then((part) => {
        if (this.disposed) return part.dispose();
        fitPart(part.root, 1.1, 0.5, 0.8, Math.sin(ang) * R * 0.62, Math.cos(ang) * R * 0.62);
        this.parts.push(part);
        this.root.add(part.root);
      });
    }
  }

  update(e: Readonly<Entity>): void {
    const a = e.powerArea as BloomArea;
    this.root.scale.setScalar(growth(a.age, a.life, 20, 30));
    // A cast pauses the healing: the glow dims until it comes back.
    const glow = a.pause > 0 ? 0.35 : 1;
    this.disc.material.opacity = 0.55 * glow;
    this.rim.material.opacity = 0.7 * glow;
  }

  dispose(): void {
    this.disposed = true;
    for (const p of this.parts) p.dispose();
    for (const m of [this.disc, this.rim]) {
      m.geometry.dispose();
      m.material.dispose();
    }
    this.root.removeFromParent();
  }
}

interface Vine {
  mesh: THREE.Mesh;
  owner: EntityId;
  target?: EntityId;
  to: THREE.Vector3;
  age: number;
}

const WARD_VERT = /* glsl */ `
varying vec3 vN;
varying vec3 vV;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vN = normalize(normalMatrix * normal);
  vV = normalize(-mv.xyz);
  gl_Position = projectionMatrix * mv;
}`;

const WARD_FRAG = /* glsl */ `
uniform vec3 color;
uniform float alpha;
varying vec3 vN;
varying vec3 vV;
void main() {
  float rim = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 2.2);
  gl_FragColor = vec4(color * (0.12 + rim), (0.12 + rim) * alpha);
}`;

/**
 * Everything the eight C3 powers draw (expansion plan §1.2): the ward's bubble, the thorn wall and
 * the flower patch, the vine, the flame of Ember Breath, the surge wave and the small particles of
 * the rest. It reads the sim through the view each frame and never changes it.
 */
export class PowerFx {
  readonly root = new THREE.Group();
  private readonly motes = new Motes();
  private readonly wards: THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial>[] = [];
  private readonly vines: Vine[] = [];
  private readonly wave: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;
  private readonly areas = new Map<EntityId, AreaView>();
  private readonly seen = new Set<EntityId>();
  private readonly tints = new Map<string, THREE.Material>();
  private readonly warmed = new Set<ModelKey>();
  private readonly a = new THREE.Vector3();
  private readonly b = new THREE.Vector3();
  private flameDebt = 0;
  private crackle = 0;
  private trail = 0;
  private spin = 0;

  constructor(private readonly assets: AssetLoader, private readonly fx: HitFx | null) {
    this.root.add(this.motes.points);
    const sphere = new THREE.SphereGeometry(1, 28, 18);
    for (let i = 0; i < WARD_POOL; i++) {
      const mat = new THREE.ShaderMaterial({
        vertexShader: WARD_VERT, fragmentShader: WARD_FRAG, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
        uniforms: { color: { value: new THREE.Color(0x8fd8ff) }, alpha: { value: 1 } },
      });
      const m = new THREE.Mesh(sphere, mat);
      m.visible = false;
      m.renderOrder = 6;
      this.wards.push(m);
      this.root.add(m);
    }
    const stalk = new THREE.CylinderGeometry(0.035, 0.05, 1, 6).translate(0, 0.5, 0);
    const green = new THREE.MeshStandardMaterial({ color: 0x5fae3f, roughness: 0.7 });
    for (let i = 0; i < VINE_POOL; i++) {
      const mesh = new THREE.Mesh(stalk, green);
      mesh.visible = false;
      this.vines.push({ mesh, owner: -1, to: new THREE.Vector3(), age: VINE_LIFE });
      this.root.add(mesh);
    }
    this.wave = new THREE.Mesh(
      new THREE.RingGeometry(0.9, 1, 72).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0xc8ff8a, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }),
    );
    this.wave.visible = false;
    this.root.add(this.wave);
  }

  /** Once per rendered frame, after the sim's ticks. */
  sync(view: ReadonlySimView, alpha: number, dt: number): void {
    this.warm(view);
    this.crackle += dt;
    this.trail += dt;
    this.spin += dt;
    const crackle = this.crackle >= 0.1;
    const trail = this.trail >= 0.03;
    if (crackle) this.crackle = 0;
    if (trail) this.trail = 0;
    this.seen.clear();
    this.wave.visible = false;
    let wards = 0;
    for (const e of view.entities) {
      if (e.powerArea) {
        this.area(e, alpha, crackle);
        continue;
      }
      const pw = e.powers;
      if (pw?.ward && wards < WARD_POOL) this.drawWard(this.wards[wards++], e, pw.ward, alpha);
      if (pw?.swarm && trail) this.orbit(e, alpha);
      if (pw?.rooted && crackle) this.fx?.emit(this.lerped(e, alpha, (e.body?.height ?? 1.8) * 0.6), 'shock', 4, 0.5);
      const act = e.combat?.action;
      if (act?.kind === 'cast' && act.channel) this.flame(e, alpha, dt);
      const pr = e.projectile;
      if (pr && trail) {
        if (pr.spell === 'staticSnare') this.fx?.emit(e.tf.pos, 'shock', 3, 0.3);
        else if (pr.spell === 'bolt' && pr.homing) this.motes.spawn(e.tf.pos.x, e.tf.pos.y, e.tf.pos.z, 0, 0.4, 0, 0xb48cff, 0.3);
      }
    }
    for (let i = wards; i < WARD_POOL; i++) this.wards[i].visible = false;
    for (const [id, v] of this.areas) {
      if (this.seen.has(id)) continue;
      v.dispose();
      this.areas.delete(id);
    }
    this.updateVines(view, alpha, dt);
    this.motes.update(dt);
  }

  /** A power's moment (sounds and rumble are the app's). */
  event(view: ReadonlySimView, e: PowerEvent): void {
    const fx = this.fx;
    const p = e.pos;
    switch (e.fx) {
      case 'ward':
        fx?.ring(p, 0xbfe8ff, 0.4, POWER.ward.radius * 1.5, 0.25);
        return;
      case 'wardReflect':
        fx?.burst(p, 'parry');
        return;
      case 'wardBlock':
        fx?.burst(p, 'block');
        return;
      case 'snareRoot':
        fx?.burst(p, 'shock');
        fx?.ring({ x: p.x, y: view.get(e.entity)?.tf.pos.y ?? p.y, z: p.z }, 0xfff27a, 0.3, 1.6, 0.35);
        return;
      case 'swarm':
        fx?.ring(p, 0xb48cff, 0.4, 2, 0.3);
        return;
      case 'wall':
        fx?.ring(p, LEAF, 0.5, POWER.wall.length * 0.6, 0.35);
        this.spray(p, 26, LEAF, POWER.wall.length * 0.5);
        return;
      case 'wallStun':
        fx?.burst(p, 'heavy');
        fx?.ring(p, 0xffe0a0, 0.4, 3, 0.35);
        return;
      case 'wallEnd':
        this.spray(p, 18, 0x8a6a3a, POWER.wall.length * 0.5);
        return;
      case 'vine':
        this.startVine(e);
        return;
      case 'bloom':
        fx?.ring(p, HEAL, 0.4, e.radius ?? POWER.bloom.radius, 0.45);
        fx?.flash({ x: p.x, y: p.y + 1, z: p.z }, HEAL, 2.4, 0.25);
        return;
      case 'emberStart':
        fx?.flash(p, 0xffb060, 1.4, 0.16);
        return;
      case 'surgeReady':
        fx?.ring(p, 0xe8ff8a, 0.5, 2.4, 0.4);
        return;
      case 'surge':
        fx?.flash({ x: p.x, y: p.y + 1, z: p.z }, 0xe8ffb0, 4, 0.28);
        fx?.ring(p, 0xc8ff8a, 0.5, e.radius ?? POWER.surge.radius, 0.7);
        this.spray(p, 40, LEAF, 2);
        return;
      default:
        return;
    }
  }

  clear(): void {
    for (const v of this.areas.values()) v.dispose();
    this.areas.clear();
    for (const w of this.wards) w.visible = false;
    for (const v of this.vines) {
      v.age = VINE_LIFE;
      v.mesh.visible = false;
    }
    this.wave.visible = false;
    this.motes.clear();
    for (const m of this.tints.values()) m.dispose();
    this.tints.clear();
  }

  /** Fetch the props a known power will need, so its first cast doesn't wait on the network. */
  private warm(view: ReadonlySimView): void {
    const known = view.playerEntity(0)?.progress?.spells;
    if (!known) return;
    const want = (spell: SpellId, key: ModelKey) => {
      if (!known.includes(spell) || this.warmed.has(key)) return;
      this.warmed.add(key);
      void this.assets.template(key);
    };
    want('brambleWall', 'prop_root_wall');
    want('healingBloom', 'prop_crops');
  }

  /** A fresh prop copy in a tinted material (one material per tint, shared by every copy). */
  private readonly loadPart: LoadPart = async (key, tint) => {
    const part = await this.assets.instance(key);
    part.root.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh && !Array.isArray(mesh.material)) mesh.material = this.tinted(mesh.material, tint);
    });
    return part;
  };

  private tinted(src: THREE.Material, tint: number): THREE.Material {
    const key = `${src.uuid}:${tint}`;
    let m = this.tints.get(key);
    if (!m) {
      m = src.clone();
      (m as THREE.MeshStandardMaterial).color?.setHex(tint);
      this.tints.set(key, m);
    }
    return m;
  }

  private area(e: Readonly<Entity>, alpha: number, crackle: boolean): void {
    const a = e.powerArea!;
    if (a.kind === 'surge') {
      this.wave.visible = true;
      this.wave.position.set(e.tf.pos.x, e.tf.pos.y + 0.25, e.tf.pos.z);
      // Drawn a fraction of a tick ahead, so the ring runs smoothly between sim steps.
      this.wave.scale.setScalar(Math.max(0.01, a.radius + POWER.surge.speed * alpha));
      this.wave.material.opacity = Math.max(0, 1 - a.radius / POWER.surge.radius);
      return;
    }
    this.seen.add(e.id);
    let v = this.areas.get(e.id);
    if (!v) {
      v = a.kind === 'wall' ? new WallView(e, this.loadPart) : new BloomView(e, this.loadPart);
      this.areas.set(e.id, v);
      this.root.add(v.root);
    }
    v.update(e);
    if (a.kind === 'bloom' && crackle && a.pause <= 0) {
      const ang = Math.random() * Math.PI * 2, r = Math.random() * POWER.bloom.radius;
      this.motes.spawn(e.tf.pos.x + Math.sin(ang) * r, e.tf.pos.y + 0.2, e.tf.pos.z + Math.cos(ang) * r, 0, 1.3, 0, HEAL, 0.9);
    }
  }

  /** An entity's interpolated position, `up` metres above its feet. */
  private lerped(e: Readonly<Entity>, alpha: number, up = 0): THREE.Vector3 {
    const { pos, prevPos } = e.tf;
    return this.a.set(prevPos.x + (pos.x - prevPos.x) * alpha, prevPos.y + (pos.y - prevPos.y) * alpha + up, prevPos.z + (pos.z - prevPos.z) * alpha);
  }

  private drawWard(m: THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial>, e: Readonly<Entity>, ward: { t: number; dur: number }, alpha: number): void {
    m.visible = true;
    m.position.copy(this.lerped(e, alpha, (e.body?.height ?? 1.8) / 2));
    m.scale.setScalar(POWER.ward.radius * (0.75 + 0.25 * Math.min(1, ward.t / 6)));
    // Gold while it reflects, blue while it only blocks; it fades out over its last ticks.
    (m.material.uniforms.color.value as THREE.Color).setHex(ward.t < POWER.ward.reflectTicks ? 0xffe9a0 : 0x8fd8ff);
    m.material.uniforms.alpha.value = Math.min(1, (ward.dur - ward.t) / 10);
  }

  /** Seeker Swarm: three motes circling the caster. */
  private orbit(e: Readonly<Entity>, alpha: number): void {
    const p = this.lerped(e, alpha, 1.2);
    for (let i = 0; i < 3; i++) {
      const ang = this.spin * 5 + (i / 3) * Math.PI * 2;
      this.motes.spawn(p.x + Math.sin(ang) * 0.85, p.y + Math.sin(ang * 2) * 0.2, p.z + Math.cos(ang) * 0.85, 0, 0, 0, 0xb48cff, 0.22);
    }
  }

  /** Ember Breath: flame streaming out of the hands across the cone. */
  private flame(e: Readonly<Entity>, alpha: number, dt: number): void {
    const E = POWER.ember;
    this.flameDebt += dt * FLAME_RATE;
    const n = Math.floor(this.flameDebt);
    this.flameDebt -= n;
    const yaw = lerpAngle(e.tf.prevYaw, e.tf.yaw, alpha);
    const p = this.lerped(e, alpha, 1.3);
    const x = p.x + Math.sin(yaw) * 0.6, y = p.y, z = p.z + Math.cos(yaw) * 0.6;
    for (let i = 0; i < n; i++) {
      const ang = yaw + (Math.random() - 0.5) * 2 * E.halfAngle * 0.85;
      const speed = FLAME_SPEED * (0.75 + Math.random() * 0.4);
      const life = (E.range / FLAME_SPEED) * (0.7 + Math.random() * 0.4);
      this.motes.spawn(x, y, z, Math.sin(ang) * speed, (Math.random() - 0.45) * 2.4, Math.cos(ang) * speed, FLAME_COLORS[i % FLAME_COLORS.length], life);
    }
  }

  /** Leaves (or chips) thrown up from a spot. */
  private spray(p: P3, n: number, color: number, spread: number): void {
    for (let i = 0; i < n; i++) {
      const ang = Math.random() * Math.PI * 2, r = Math.random() * spread;
      this.motes.spawn(p.x + Math.sin(ang) * r, p.y + 0.3 + Math.random() * 1.2, p.z + Math.cos(ang) * r, Math.sin(ang) * 1.2, 1 + Math.random() * 2, Math.cos(ang) * 1.2, color, 0.5 + Math.random() * 0.5);
    }
  }

  private startVine(e: PowerEvent): void {
    const v = this.vines.find((x) => x.age >= VINE_LIFE) ?? this.vines[0];
    v.owner = e.entity;
    v.target = e.target;
    v.to.set(e.to?.x ?? e.pos.x, e.to?.y ?? e.pos.y, e.to?.z ?? e.pos.z);
    v.age = 0;
    v.mesh.visible = true;
    if (e.to) this.spray(e.to, 10, LEAF, 0.5);
  }

  /** A vine shoots out, holds on through the pull (following both ends), then snaps back. */
  private updateVines(view: ReadonlySimView, alpha: number, dt: number): void {
    for (const v of this.vines) {
      if (v.age >= VINE_LIFE) continue;
      v.age += dt;
      const owner = view.get(v.owner);
      if (v.age >= VINE_LIFE || !owner) {
        v.age = VINE_LIFE;
        v.mesh.visible = false;
        continue;
      }
      const target = v.target !== undefined ? view.get(v.target) : undefined;
      if (target) v.to.copy(this.lerped(target, alpha, (target.body?.height ?? 1.8) * 0.55));
      const from = this.b.copy(this.lerped(owner, alpha, 1.35));
      const dir = this.a.subVectors(v.to, from);
      const len = dir.length();
      const u = v.age / VINE_LIFE;
      const reach = u < 0.3 ? u / 0.3 : u > 0.75 ? (1 - u) / 0.25 : 1;
      v.mesh.position.copy(from);
      v.mesh.scale.set(1, Math.max(0.01, len * reach), 1);
      if (len > 1e-3) v.mesh.quaternion.setFromUnitVectors(UP, dir.divideScalar(len));
    }
  }
}
