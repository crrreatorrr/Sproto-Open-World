import * as THREE from 'three';
import type { Entity, EntityId } from '../../sim/entity';
import type { SpellFx } from './SpellFx';
import { glowTexture, starTexture } from './textures';

const MAX_FROZEN = 8;
const CRYSTALS_EACH = 9;
const MAX_FLAMES = 18;
const FLAMES_EACH = 3;
const MAX_FROST_RINGS = 8;
const MAX_DIZZY = 12;
const DIZZY_EACH = 3;
/** Seconds between the arcs that jump across a shocked body. */
const ARC_EVERY = 0.2;
/** Ticks a freeze takes to close over the body. */
const FREEZE_IN = 10;

/**
 * What a status looks like on the body, over BodyGlow's tints and the particles WorldViews sheds:
 * ice crystals locking a frozen body, flames licking a burning one, a frost ring at the feet of a
 * chilled one, arcs across a shocked one, and stars circling the head of anything staggered, which
 * is the moment to punish it. Slots are handed out afresh each frame from fixed pools.
 */
export class StatusFx {
  readonly root = new THREE.Group();
  private readonly crystals: THREE.InstancedMesh;
  private readonly flames: THREE.Sprite[] = [];
  private readonly rings: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>[] = [];
  private readonly dizzy: THREE.Sprite[] = [];
  private frozenUsed = 0;
  private flamesUsed = 0;
  private ringsUsed = 0;
  private dizzyUsed = 0;
  private time = 0;
  private readonly arcClock = new Map<EntityId, number>();
  private readonly wasFrozen = new Set<EntityId>();
  private readonly frozenNow = new Set<EntityId>();
  private readonly dummy = new THREE.Object3D();
  private readonly at = { x: 0, y: 0, z: 0 };
  /** A freeze broke here (the frost shatters off). */
  onThaw: ((p: { x: number; y: number; z: number }) => void) | null = null;

  constructor(private readonly spells: SpellFx) {
    this.crystals = new THREE.InstancedMesh(
      new THREE.OctahedronGeometry(1, 0),
      new THREE.MeshStandardMaterial({ color: 0xbfe9ff, emissive: 0x3f9fe0, emissiveIntensity: 0.55, roughness: 0.15, transparent: true, opacity: 0.78, flatShading: true }),
      MAX_FROZEN * CRYSTALS_EACH,
    );
    this.crystals.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.crystals.frustumCulled = false;
    this.crystals.count = 0;
    this.root.add(this.crystals);
    for (let i = 0; i < MAX_FLAMES; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: 0xff7a24, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
      s.visible = false;
      s.renderOrder = 5;
      this.flames.push(s);
      this.root.add(s);
    }
    const ringGeo = new THREE.RingGeometry(0.72, 1, 32).rotateX(-Math.PI / 2);
    for (let i = 0; i < MAX_FROST_RINGS; i++) {
      const m = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: 0x9fdcff, transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending }));
      m.visible = false;
      this.rings.push(m);
      this.root.add(m);
    }
    for (let i = 0; i < MAX_DIZZY; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: starTexture(), color: 0xffe27a, transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending }));
      s.visible = false;
      s.renderOrder = 9;
      this.dizzy.push(s);
      this.root.add(s);
    }
  }

  /** Start a frame's worth of tracking. */
  begin(dt: number): void {
    this.time += dt;
    this.frozenUsed = this.flamesUsed = this.ringsUsed = this.dizzyUsed = 0;
    this.frozenNow.clear();
  }

  /** Dress one body for this frame. `root` is its drawn position, `height` and `radius` its size. */
  track(e: Readonly<Entity>, root: THREE.Object3D, height: number, radius: number, dt: number): void {
    const a = e.combat?.action;
    if (a?.kind === 'dead') return;
    const p = root.position;
    const s = e.statuses;
    if (a?.kind === 'frozen') this.frozen(e.id, p, height, radius, a.t);
    if (s?.burn) this.burning(e.id, p, height, radius);
    if (s?.chill && a?.kind !== 'frozen') this.chilled(p, radius, s.chill.stacks);
    if (s?.shock) this.shocked(e.id, p, height, radius, dt);
    if (a?.kind === 'stagger') this.staggered(e.id, p, height, radius);
  }

  /** End the frame: hide every slot nobody claimed, and notice the freezes that broke. */
  end(view: (id: EntityId) => THREE.Object3D | undefined): void {
    this.crystals.count = this.frozenUsed * CRYSTALS_EACH;
    if (this.frozenUsed) this.crystals.instanceMatrix.needsUpdate = true;
    for (let i = this.flamesUsed; i < MAX_FLAMES; i++) this.flames[i].visible = false;
    for (let i = this.ringsUsed; i < MAX_FROST_RINGS; i++) this.rings[i].visible = false;
    for (let i = this.dizzyUsed; i < MAX_DIZZY; i++) this.dizzy[i].visible = false;
    for (const id of this.wasFrozen) {
      if (this.frozenNow.has(id)) continue;
      this.wasFrozen.delete(id);
      const r = view(id);
      if (r) {
        this.at.x = r.position.x;
        this.at.y = r.position.y + 1;
        this.at.z = r.position.z;
        this.onThaw?.(this.at);
      }
    }
    for (const id of this.frozenNow) this.wasFrozen.add(id);
  }

  /** A body left the world. */
  drop(id: EntityId): void {
    this.arcClock.delete(id);
    this.wasFrozen.delete(id);
  }

  private frozen(id: EntityId, p: THREE.Vector3, height: number, radius: number, t: number): void {
    this.frozenNow.add(id);
    if (this.frozenUsed >= MAX_FROZEN) return;
    const slot = this.frozenUsed++ * CRYSTALS_EACH;
    const grow = Math.min(1, t / FREEZE_IN);
    const d = this.dummy;
    for (let k = 0; k < CRYSTALS_EACH; k++) {
      // Fixed per body: the same crystals stay put for the whole freeze.
      const angle = k * 2.4 + id * 1.3;
      const r = radius * (0.72 + 0.3 * Math.sin(k * 3.1 + id));
      const size = (0.16 + 0.07 * Math.sin(k * 5.7 + id)) * (height / 1.8) * grow;
      d.position.set(p.x + Math.sin(angle) * r, p.y + height * (0.08 + (0.82 * k) / (CRYSTALS_EACH - 1)), p.z + Math.cos(angle) * r);
      d.rotation.set(0.5 * Math.sin(angle), angle, 0.5 * Math.cos(angle));
      d.scale.set(size * 0.7, size * 1.9, size * 0.7);
      d.updateMatrix();
      this.crystals.setMatrixAt(slot + k, d.matrix);
    }
  }

  private burning(id: EntityId, p: THREE.Vector3, height: number, radius: number): void {
    for (let k = 0; k < FLAMES_EACH && this.flamesUsed < MAX_FLAMES; k++) {
      const s = this.flames[this.flamesUsed++];
      const phase = this.time * (7 + k * 2.3) + id + k * 2.1;
      const angle = this.time * 1.4 + (k * Math.PI * 2) / FLAMES_EACH + id;
      const tall = height * (0.34 + 0.1 * Math.sin(phase));
      s.position.set(p.x + Math.sin(angle) * radius * 0.7, p.y + height * 0.2 + tall * 0.5, p.z + Math.cos(angle) * radius * 0.7);
      s.scale.set(radius * (0.9 + 0.2 * Math.sin(phase * 1.7)), tall * 1.5, 1);
      s.material.opacity = 0.42 + 0.2 * Math.sin(phase * 2.3);
      s.visible = true;
    }
  }

  private chilled(p: THREE.Vector3, radius: number, stacks: number): void {
    if (this.ringsUsed >= MAX_FROST_RINGS) return;
    const m = this.rings[this.ringsUsed++];
    m.position.set(p.x, p.y + 0.05, p.z);
    m.scale.setScalar(radius * (1.5 + 0.08 * Math.sin(this.time * 3)));
    m.material.opacity = 0.14 + 0.13 * Math.min(3, stacks);
    m.visible = true;
  }

  private shocked(id: EntityId, p: THREE.Vector3, height: number, radius: number, dt: number): void {
    const t = (this.arcClock.get(id) ?? Math.random() * ARC_EVERY) + dt;
    if (t < ARC_EVERY) {
      this.arcClock.set(id, t);
      return;
    }
    this.arcClock.set(id, 0);
    const point = () => {
      const a = Math.random() * Math.PI * 2;
      return { x: p.x + Math.sin(a) * radius, y: p.y + height * (0.25 + Math.random() * 0.7), z: p.z + Math.cos(a) * radius };
    };
    this.spells.zap([point(), point()]);
  }

  private staggered(id: EntityId, p: THREE.Vector3, height: number, radius: number): void {
    const orbit = Math.max(0.3, radius * 0.9);
    for (let k = 0; k < DIZZY_EACH && this.dizzyUsed < MAX_DIZZY; k++) {
      const s = this.dizzy[this.dizzyUsed++];
      const a = this.time * 5 + (k * Math.PI * 2) / DIZZY_EACH + id;
      s.position.set(p.x + Math.sin(a) * orbit, p.y + height + 0.18 + 0.05 * Math.sin(a * 2), p.z + Math.cos(a) * orbit);
      const size = 0.3 + 0.06 * Math.sin(this.time * 12 + k);
      s.scale.set(size, size, 1);
      s.material.rotation = a;
      s.visible = true;
    }
  }

  clear(): void {
    this.begin(0);
    this.end(() => undefined);
    this.arcClock.clear();
    this.wasFrozen.clear();
  }
}
