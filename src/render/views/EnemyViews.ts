import * as THREE from 'three';
import type { AssetLoader, ModelInstance } from '../../assets/AssetLoader';
import type { EnemyDef, EnemyMoveDef } from '../../content/enemies';
import { TICK_HZ } from '../../content/tuning';
import type { Entity } from '../../sim/entity';
import { Animator } from '../anim/Animator';
import { BodyGlow } from './BodyGlow';
import { placeEntity, spring } from './interp';

/** One drawn sim entity (an enemy or a projectile); WorldViews makes and drops them. */
export interface EntityView {
  readonly root: THREE.Object3D;
  /** Height of the head above the feet (m): health bars, reticles, glints. */
  readonly height: number;
  update(e: Readonly<Entity>, alpha: number, dt: number): void;
  /** A wind-up started (telegraph event). */
  telegraph?(move: EnemyMoveDef | undefined, unblockable: boolean, ticks: number): void;
  /** It was hit from `from` (world position of the attacker). */
  flinch?(from: { x: number; z: number }, heavy: boolean): void;
  dispose(): void;
}

/**
 * Clip time for an enemy move: the wind-up plays the clip up to its contact frame, and active +
 * recovery play the rest, so the blow lands on the frame the hitbox comes out (plan §4.8).
 */
export function attackClipTime(mv: EnemyMoveDef, t: number, duration: number, contact: number): number {
  const c = duration * contact;
  if (t <= mv.windup) return (t / Math.max(1, mv.windup)) * c;
  const u = Math.min(1, (t - mv.windup) / Math.max(1, mv.active + mv.recovery));
  return c + u * (duration - c);
}

/**
 * Where the blow lands in each Brute clip (fraction of the clip), checked by eye scrubbing the
 * clips side-on: the punch is an overhead hammer that comes down between 0.50 and 0.52; the kick's
 * leg is fully out from 0.45 to 0.50.
 */
const BRUTE_CONTACT: Record<string, number> = { punch: 0.52, kick: 0.47 };
/** The Brute's enemy moves blend in over 6 ticks (its wind-ups are long; no need to snap). */
const BRUTE_FADE = 6 / TICK_HZ;
/** Death: hold the pose, then sink and fade (ticks). */
const SINK_DELAY = 24;
const SINK_TICKS = 70;
const SINK_DEPTH = 1.6;

/** Fade the body out and down over the sink (shared by the Brute and the fallback capsule). */
function sinkFor(t: number): number {
  return Math.min(1, Math.max(0, (t - SINK_DELAY) / SINK_TICKS));
}

/**
 * The Thornwood Brute: the shooter's `sproto_monster`, fitted to the 2.4 m body. Its punch and
 * kick clips are scrubbed from the move's tick counter; the slam (no clip of its own) reuses the
 * punch with a procedural rear-back and drive-down so the unblockable reads by pose too.
 */
export class BruteView implements EntityView {
  readonly root = new THREE.Group();
  readonly height: number;
  /** Lean and recoil pivot at the feet. */
  private readonly body = new THREE.Group();
  private readonly glow = new BodyGlow();
  private model: ModelInstance | null = null;
  private animator: Animator | null = null;
  private readonly recoil = { x: 0, v: 0 };
  private lean = 0;
  private disposed = false;

  constructor(assets: AssetLoader, readonly def: EnemyDef) {
    this.height = def.body.height;
    this.root.add(this.body, this.glow.glint);
    this.glow.glint.position.set(0, this.height * 0.86, 0.35);
    void assets.instance('brute').then((m) => {
      if (this.disposed) {
        m.dispose();
        return;
      }
      this.model = m;
      this.glow.adopt(m.root);
      this.body.add(m.root);
      this.animator = new Animator(m.root, m.clips);
    });
  }

  /** The debug clip viewer and QA poke at this. */
  get clips(): string[] {
    return this.animator?.clipNames ?? [];
  }

  telegraph(move: EnemyMoveDef | undefined, unblockable: boolean, ticks: number): void {
    void move;
    this.glow.telegraph(unblockable, ticks / TICK_HZ);
  }

  flinch(_from: { x: number; z: number }, heavy: boolean): void {
    this.glow.hit();
    // Elites shrug off hitstun (plan §4.2): the flinch is all the reaction a light hit gets.
    this.recoil.v -= heavy ? 2.6 : 1.4;
  }

  update(e: Readonly<Entity>, alpha: number, dt: number): void {
    placeEntity(this.root, e, alpha);
    const a = e.combat?.action ?? null;
    const anim = this.animator;
    let lean = 0;
    let sink = 0;
    if (a?.kind === 'attack') {
      const mv = this.def.moves.find((m) => m.id === a.move);
      if (mv) {
        if (anim && mv.clip && anim.has(mv.clip)) anim.scrub(mv.clip, attackClipTime(mv, a.t, anim.duration(mv.clip), BRUTE_CONTACT[mv.clip] ?? 0.5), BRUTE_FADE);
        if (mv.unblockable) {
          // Rear back through the wind-up, drive down on the active frames, settle in recovery.
          lean = a.t < mv.windup ? -0.24 * (a.t / mv.windup) : 0.3 * Math.max(0, 1 - (a.t - mv.windup) / (mv.active + 12));
        }
        if (a.t >= mv.windup) this.glow.endTelegraph();
      }
    } else {
      this.glow.endTelegraph();
      if (a?.kind === 'dead') {
        anim?.scrub('idle', 0, 0.2);
        lean = -0.35 * Math.min(1, a.t / 20);
        sink = sinkFor(a.t);
      } else if (a?.kind === 'stagger') {
        // Poise broken: reel back and sway, the idle slowed to a stagger.
        anim?.loop('idle', 0.35);
        lean = -0.2 + 0.07 * Math.sin((a.t / TICK_HZ) * 7);
      } else if (a?.kind === 'hitstun') {
        anim?.loop('idle', 0.5);
        lean = -0.12 * Math.max(0, 1 - a.t / Math.max(1, a.dur));
      } else if (anim) {
        const speed = Math.hypot(e.tf.vel.x, e.tf.vel.z);
        if (speed < 0.3) anim.loop('idle');
        else if (speed < 2.2) anim.loop('walk', Math.min(1.6, Math.max(0.5, speed / 1.4)));
        else anim.loop('run', Math.min(1.5, Math.max(0.6, speed / 3.4)));
      }
    }
    this.lean += (lean - this.lean) * (1 - Math.exp(-14 * dt));
    spring(this.recoil, 160, 14, dt);
    this.body.rotation.x = this.lean + this.recoil.x;
    this.body.position.y = -sink * SINK_DEPTH;
    this.glow.setOpacity(1 - sink);
    this.root.visible = sink < 1;
    this.glow.update(dt);
    anim?.update(dt);
  }

  dispose(): void {
    this.disposed = true;
    this.animator?.dispose();
    this.glow.dispose();
    this.model?.dispose();
    this.root.removeFromParent();
  }
}

/** Shared greybox geometry for the training dummies (one set for every dummy). */
let dummyGeo: Record<'base' | 'post' | 'sack' | 'head' | 'ring' | 'arm' | 'tube' | 'coin', THREE.BufferGeometry> | null = null;
function dummyGeometry() {
  dummyGeo ??= {
    base: new THREE.CylinderGeometry(0.42, 0.5, 0.12, 20),
    post: new THREE.CylinderGeometry(0.07, 0.08, 0.8, 10),
    sack: new THREE.CylinderGeometry(0.3, 0.36, 0.85, 16),
    head: new THREE.SphereGeometry(0.21, 16, 12),
    ring: new THREE.TorusGeometry(0.15, 0.035, 8, 24),
    arm: new THREE.BoxGeometry(0.1, 0.1, 1.45),
    tube: new THREE.CylinderGeometry(0.075, 0.1, 0.42, 12),
    coin: new THREE.CylinderGeometry(0.14, 0.14, 0.035, 16),
  };
  return dummyGeo;
}

/**
 * A training dummy (plan M1a): a post, a burlap sack and a head, all greybox. The swinging dummy
 * has an arm bar that sweeps across its front; the coin dummy has a launcher on its head that
 * loads a coin through the wind-up and kicks back when it fires. Hits wobble it on a spring.
 */
export class DummyView implements EntityView {
  readonly root = new THREE.Group();
  readonly height = 1.9;
  /** Wobble pivot at the base. */
  private readonly upper = new THREE.Group();
  private readonly glow = new BodyGlow();
  private readonly arm: THREE.Group | null = null;
  private readonly launcher: THREE.Group | null = null;
  private readonly loaded: THREE.Mesh | null = null;
  private readonly wx = { x: 0, v: 0 };
  private readonly wz = { x: 0, v: 0 };
  private tip = 0;
  private armYaw = 1.2;
  private kick = 0;
  /** The attack whose shot already kicked the launcher. */
  private kicked: object | null = null;

  constructor(readonly def: EnemyDef) {
    const g = dummyGeometry();
    const wood = new THREE.MeshStandardMaterial({ color: 0x6b4a2b, roughness: 0.9 });
    const burlap = new THREE.MeshStandardMaterial({ color: 0xc9a66b, roughness: 1 });
    const paint = new THREE.MeshStandardMaterial({ color: 0xc8402e, roughness: 0.7 });
    const metal = new THREE.MeshStandardMaterial({ color: 0x8a8f96, roughness: 0.4, metalness: 0.6 });
    const mesh = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      m.castShadow = true;
      m.receiveShadow = true;
      return m;
    };
    this.root.add(mesh(g.base, wood, 0, 0.06, 0), this.upper, this.glow.glint);
    this.upper.add(mesh(g.post, wood, 0, 0.5, 0), mesh(g.sack, burlap, 0, 1.22, 0), mesh(g.head, burlap, 0, 1.86, 0));
    const ring = mesh(g.ring, paint, 0, 1.25, 0.33);
    this.upper.add(ring);
    if (def.dummy === 'swing') {
      const arm = new THREE.Group();
      arm.position.y = 1.32;
      // The bar sticks out along the pivot's +Z; the pivot's yaw sweeps it.
      arm.add(mesh(g.arm, wood, 0, 0, 0.72 + 0.32));
      this.upper.add(arm);
      this.arm = arm;
    } else if (def.dummy === 'shooter') {
      const l = new THREE.Group();
      l.position.set(0, 1.86, 0.12);
      const tube = mesh(g.tube, metal, 0, 0, 0.2);
      tube.rotation.x = Math.PI / 2;
      const coin = mesh(g.coin, new THREE.MeshStandardMaterial({ color: 0xf2c230, metalness: 0.8, roughness: 0.3, emissive: 0x3a2a00 }), 0, 0, 0.42);
      coin.rotation.x = Math.PI / 2;
      coin.visible = false;
      l.add(tube, coin);
      this.upper.add(l);
      this.launcher = l;
      this.loaded = coin;
    }
    // Each dummy owns its materials (BodyGlow clones them), so these templates are dropped.
    this.glow.adopt(this.root);
    for (const m of [wood, burlap, paint, metal]) m.dispose();
    this.glow.glint.position.set(0, 1.9, 0.3);
  }

  telegraph(_move: EnemyMoveDef | undefined, unblockable: boolean, ticks: number): void {
    this.glow.telegraph(unblockable, ticks / TICK_HZ);
  }

  flinch(from: { x: number; z: number }, heavy: boolean): void {
    this.glow.hit();
    // Tip away from the attacker, in the dummy's own frame.
    const p = this.root.position;
    let dx = p.x - from.x, dz = p.z - from.z;
    const d = Math.hypot(dx, dz) || 1;
    dx /= d;
    dz /= d;
    const yaw = this.root.rotation.y;
    const lx = Math.cos(yaw) * dx - Math.sin(yaw) * dz;
    const lz = Math.sin(yaw) * dx + Math.cos(yaw) * dz;
    const k = heavy ? 4.2 : 2.4;
    this.wx.v += lz * k;
    this.wz.v -= lx * k;
  }

  update(e: Readonly<Entity>, alpha: number, dt: number): void {
    placeEntity(this.root, e, alpha);
    const a = e.combat?.action ?? null;
    const mv = a?.kind === 'attack' ? this.def.moves.find((m) => m.id === a.move) : undefined;
    let armYaw = 1.2;
    let loaded = 0;
    if (a?.kind === 'attack' && mv) {
      const t = a.t;
      if (t < mv.windup) {
        // Wind back (the arm) or load a coin (the launcher), eased so the last third reads.
        const u = t / mv.windup;
        armYaw = 1.2 + 1.0 * u * u;
        loaded = u;
      } else if (t < mv.windup + mv.active) {
        const u = (t - mv.windup + 1) / mv.active;
        armYaw = 2.2 - 3.4 * Math.min(1, u);
        if (this.kicked !== a) {
          this.kicked = a;
          this.kick = 1;
        }
      } else {
        const u = Math.min(1, (t - mv.windup - mv.active) / Math.max(1, mv.recovery));
        armYaw = -1.2 + 2.4 * u * u * (3 - 2 * u);
      }
    } else {
      this.glow.endTelegraph();
    }
    if (mv && a?.kind === 'attack' && a.t >= mv.windup) this.glow.endTelegraph();
    // The arm swings fast (the active frames are only 6 ticks): follow it closely.
    this.armYaw += (armYaw - this.armYaw) * (1 - Math.exp(-40 * dt));
    if (this.arm) this.arm.rotation.y = this.armYaw;
    if (this.loaded) {
      this.loaded.visible = loaded > 0;
      this.loaded.scale.setScalar(0.4 + 0.6 * loaded);
    }
    if (this.launcher) {
      this.kick = Math.max(0, this.kick - dt * 5);
      this.launcher.position.z = 0.12 - 0.12 * this.kick;
    }
    if (a?.kind === 'stagger') this.wx.v += Math.sin((a.t / TICK_HZ) * 9) * 6 * dt;
    const dead = a?.kind === 'dead';
    this.tip += ((dead ? 1 : 0) - this.tip) * (1 - Math.exp(-(dead ? 8 : 5) * dt));
    spring(this.wx, 70, 5, dt);
    spring(this.wz, 70, 5, dt);
    this.upper.rotation.set(this.wx.x - this.tip * 1.35, 0, this.wz.x);
    this.glow.update(dt);
  }

  dispose(): void {
    this.glow.dispose();
    this.root.removeFromParent();
  }
}

/** A coin from the shooting dummy: a small spinning gold disc (blue once it is parried back). */
export class CoinView implements EntityView {
  readonly root = new THREE.Group();
  readonly height = 0.3;
  private readonly disc: THREE.Mesh;
  private readonly mat = new THREE.MeshStandardMaterial({ color: 0xf2c230, metalness: 0.85, roughness: 0.25, emissive: 0x6a4a00 });
  private spin = 0;

  constructor() {
    this.disc = new THREE.Mesh(dummyGeometry().coin, this.mat);
    this.disc.scale.setScalar(1.3);
    this.disc.castShadow = true;
    this.root.add(this.disc);
  }

  update(e: Readonly<Entity>, alpha: number, dt: number): void {
    placeEntity(this.root, e, alpha);
    // Face along the flight path, flipping end over end.
    const v = e.tf.vel;
    if (v.x || v.z) this.root.rotation.y = Math.atan2(v.x, v.z);
    this.spin += dt * 22;
    this.disc.rotation.x = this.spin;
    if (e.projectile?.reflected) this.mat.emissive.setHex(0x1a4a9a);
  }

  dispose(): void {
    this.mat.dispose();
    this.root.removeFromParent();
  }
}

/** Anything without a view of its own yet: a capsule the size of its body. */
export class FallbackView implements EntityView {
  readonly root = new THREE.Group();
  readonly height: number;
  private readonly glow = new BodyGlow();
  private readonly geo: THREE.CapsuleGeometry;

  constructor(e: Readonly<Entity>) {
    const r = e.body?.radius ?? 0.4, h = e.body?.height ?? 1.8;
    this.height = h;
    this.geo = new THREE.CapsuleGeometry(r, Math.max(0.01, h - 2 * r), 4, 12);
    const mat = new THREE.MeshStandardMaterial({ color: 0xa04040, roughness: 0.8 });
    const mesh = new THREE.Mesh(this.geo, mat);
    mesh.position.y = h / 2;
    mesh.castShadow = true;
    this.root.add(mesh, this.glow.glint);
    this.glow.glint.position.set(0, h * 0.9, r);
    this.glow.adopt(this.root);
    mat.dispose();
  }

  telegraph(_move: EnemyMoveDef | undefined, unblockable: boolean, ticks: number): void {
    this.glow.telegraph(unblockable, ticks / TICK_HZ);
  }

  flinch(): void {
    this.glow.hit();
  }

  update(e: Readonly<Entity>, alpha: number, dt: number): void {
    placeEntity(this.root, e, alpha);
    const a = e.combat?.action;
    const sink = a?.kind === 'dead' ? sinkFor(a.t) : 0;
    this.root.position.y -= sink * SINK_DEPTH;
    this.glow.setOpacity(1 - sink);
    this.root.visible = sink < 1;
    this.glow.update(dt);
  }

  dispose(): void {
    this.geo.dispose();
    this.glow.dispose();
    this.root.removeFromParent();
  }
}
