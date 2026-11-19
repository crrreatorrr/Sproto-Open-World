import * as THREE from 'three';
import type { AssetLoader, ModelInstance } from '../../assets/AssetLoader';
import { MODELS, type ModelEntry } from '../../assets/manifest';
import type { EnemyDef, EnemyMoveDef } from '../../content/enemies';
import { TICK_HZ } from '../../content/tuning';
import type { Entity } from '../../sim/entity';
import { Animator, ENTRY_FADE } from '../anim/Animator';
import { CAST_PEAKS, LIBRARY_CAST_PEAKS, castClipTime, isCastClip } from '../anim/castTiming';
import type { HitFx } from '../fx/HitFx';
import { HitReaction } from '../fx/HitReaction';
import { glowTexture } from '../fx/textures';
import { BodyGlow, type GlowStatus } from './BodyGlow';
import { placeEntity, spring } from './interp';

/** One drawn sim entity (an enemy or a projectile); WorldViews makes and drops them. */
export interface EntityView {
  readonly root: THREE.Object3D;
  /** Height of the head above the feet (m): health bars, reticles, glints. */
  readonly height: number;
  update(e: Readonly<Entity>, alpha: number, dt: number): void;
  /** A wind-up started (telegraph event). */
  telegraph?(move: EnemyMoveDef | undefined, unblockable: boolean, ticks: number): void;
  /** It was hit from `from` (world position of the attacker). `force` scales how far it is thrown. */
  flinch?(from: { x: number; z: number }, heavy: boolean, force?: number): void;
  /** Its poise broke: it reels back. */
  reel?(): void;
  /** The Quarry Gate's lock: glow only while the key is carried. */
  keyed?(on: boolean): void;
  /** A relic chest's quest shimmer, 0..1. Null keeps the chest's own twinkle. */
  shimmer?(strength: number | null): void;
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

/** The elites drawn by EliteView: their model key, clip timing and walking pace. */
export type EliteModel = 'brute' | 'gatekeeper';
interface EliteLook {
  /** Where the blow lands in each attack clip (fraction of the clip). */
  contact: Record<string, number>;
  /**
   * Per move id: where the wind-up starts in its clip (fraction of the way to contact). A string's
   * follow-up hits start part-way in, so each reads as a new, shorter blow rather than a full replay.
   */
  from?: Record<string, number>;
  /** Ground speed (m/s) of the walk and run clips at time scale 1, and where walking turns to running. */
  walk: number;
  run: number;
  runAbove: number;
}
const ELITES: Record<EliteModel, EliteLook> = {
  brute: { contact: BRUTE_CONTACT, walk: 1.4, run: 3.4, runAbove: 2.2 },
  /**
   * The Gatekeeper: sproto-shooter's `monster`, whose only attack clip is `smash` (the shooter's
   * contact frame: 24 of 54). Every move plays it: `smash` and `ground_wave` (the unblockable, which
   * also rears back and drives down like the Brute's slam) from the top, the 3-hit `string` from a
   * little in and its follow-ups from halfway, so the chain reads as three quick chops. Paces from
   * the shooter (0.648 and 1.623 m/s per metre of height) at 3.2 m.
   */
  gatekeeper: { contact: { smash: 24 / 54 }, from: { string: 0.15, string2: 0.45, string3: 0.4 }, walk: 2.07, run: 5.2, runAbove: 3.4 },
};
/** Death: hold the pose, then sink and fade (ticks). */
const SINK_DELAY = 24;
const SINK_TICKS = 70;
const SINK_DEPTH = 1.6;

/** Fade the body out and down over the sink (shared by the Brute and the fallback capsule). */
function sinkFor(t: number, delay = SINK_DELAY): number {
  return Math.min(1, Math.max(0, (t - delay) / SINK_TICKS));
}

/** The status tints an entity should show (plan §4.7): its statuses, and Frozen from its action. */
export function glowStatusOf(e: Readonly<Entity>): GlowStatus {
  const s = e.statuses;
  return { burn: !!s?.burn, chill: s?.chill?.stacks ?? 0, frozen: e.combat?.action?.kind === 'frozen', shock: !!s?.shock };
}

/**
 * The elites (plan §4.9). The Thornwood Brute: the shooter's `sproto_monster`, fitted to the 2.4 m
 * body. Its punch and kick clips are scrubbed from the move's tick counter; the slam (no clip of its
 * own) reuses the punch with a procedural rear-back and drive-down so the unblockable reads by pose
 * too. The Gatekeeper (M4) is the same view on the shooter's `monster` (see ELITES).
 */
export class BruteView implements EntityView {
  readonly root = new THREE.Group();
  readonly height: number;
  /** Lean and recoil pivot at the feet. */
  private readonly body = new THREE.Group();
  private readonly glow = new BodyGlow();
  private model: ModelInstance | null = null;
  private animator: Animator | null = null;
  /** Elites are heavy: the same blow moves them less. */
  private readonly reaction = new HitReaction(0.8);
  private lean = 0;
  private disposed = false;
  private readonly look: EliteLook;
  /** How much bigger than its model's authored size it is drawn: the stride and the sink grow with it. */
  private readonly size: number;

  constructor(assets: AssetLoader, readonly def: EnemyDef, readonly kind: EliteModel = 'brute') {
    this.height = def.body.height;
    this.look = ELITES[kind];
    this.size = modelSize(kind, def);
    this.root.add(this.body, this.glow.glint);
    this.glow.glint.position.set(0, this.height * 0.86, 0.35 * this.size);
    void assets.instance(kind).then((m) => {
      if (this.disposed) {
        m.dispose();
        return;
      }
      fitToBody(m, kind, def);
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

  flinch(from: { x: number; z: number }, heavy: boolean, force = 1): void {
    this.glow.hit();
    // Elites shrug off hitstun (plan §4.2): the flinch is all the reaction a light hit gets.
    this.reaction.hit(from, this.root.position, this.root.rotation.y, heavy, force);
  }

  reel(): void {
    this.reaction.lurch();
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
        if (anim && mv.clip && anim.has(mv.clip)) {
          const d = anim.duration(mv.clip);
          const c = this.look.contact[mv.clip] ?? 0.5;
          const from = (this.look.from?.[mv.id] ?? 0) * c * d;
          anim.scrub(mv.clip, from + attackClipTime(mv, a.t, d - from, (c * d - from) / Math.max(1e-3, d - from)), BRUTE_FADE);
        }
        if (mv.unblockable) {
          // Rear back through the wind-up, drive down on the active frames, settle in recovery.
          lean = a.t < mv.windup ? -0.24 * (a.t / mv.windup) : 0.3 * Math.max(0, 1 - (a.t - mv.windup) / (mv.active + 12));
        }
        if (a.t >= mv.windup) this.glow.endTelegraph();
      }
    } else {
      this.glow.endTelegraph();
      // A rig without an idle holds the walk's first frame instead.
      const idle = (timeScale = 1) => {
        if (anim?.has('idle')) anim.loop('idle', timeScale);
        else anim?.scrub('walk', 0, 0.2);
      };
      if (a?.kind === 'dead') {
        if (anim?.has('idle')) anim.scrub('idle', 0, 0.2);
        else anim?.scrub('walk', 0, 0.2);
        lean = -0.35 * Math.min(1, a.t / 20);
        sink = sinkFor(a.t);
      } else if (a?.kind === 'stagger') {
        // Poise broken: reel back and sway, the idle slowed to a stagger.
        idle(0.35);
        lean = a.reason === 'parried' ? -0.36 + 0.1 * Math.sin((a.t / TICK_HZ) * 11) : -0.2 + 0.07 * Math.sin((a.t / TICK_HZ) * 7);
      } else if (a?.kind === 'hitstun') {
        idle(0.5);
        lean = -0.12 * Math.max(0, 1 - a.t / Math.max(1, a.dur));
      } else if (anim) {
        const speed = Math.hypot(e.tf.vel.x, e.tf.vel.z);
        // A longer leg covers more ground per step: the clips' paces grow with the body, so feet don't slide.
        const { walk, run, runAbove } = this.look;
        const s = this.size;
        if (speed < 0.3) idle();
        else if (speed < runAbove * s || !anim.has('run')) anim.loop('walk', Math.min(1.6, Math.max(0.35, speed / (walk * s))));
        else anim.loop('run', Math.min(1.5, Math.max(0.5, speed / (run * s))));
      }
    }
    this.lean += (lean - this.lean) * (1 - Math.exp(-14 * dt));
    this.reaction.update(dt);
    this.reaction.apply(this.body, this.lean);
    this.body.position.y = -sink * SINK_DEPTH * this.size;
    this.glow.setOpacity(1 - sink);
    this.root.visible = sink < 1;
    this.glow.setStatus(glowStatusOf(e));
    this.glow.update(dt);
    // Frozen (plan §4.7): the pose holds wherever the freeze caught it.
    if (a?.kind !== 'frozen') anim?.update(dt);
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
    // Breakable quest dummies (straw) are paler and yellower than the burlap training dummies.
    const burlap = new THREE.MeshStandardMaterial({ color: def.breakable ? 0xe2c45a : 0xc9a66b, roughness: 1 });
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

  flinch(from: { x: number; z: number }, heavy: boolean, force = 1): void {
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
    const k = (heavy ? 4.2 : 2.4) * force;
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
    if (a?.kind === 'stagger') this.wx.v += Math.sin((a.t / TICK_HZ) * 9) * (a.reason === 'parried' ? 15 : 6) * dt;
    const dead = a?.kind === 'dead';
    this.tip += ((dead ? 1 : 0) - this.tip) * (1 - Math.exp(-(dead ? 8 : 5) * dt));
    if (a?.kind !== 'frozen') {
      spring(this.wx, 70, 5, dt);
      spring(this.wz, 70, 5, dt);
    }
    this.upper.rotation.set(this.wx.x - this.tip * 1.35, 0, this.wz.x);
    this.glow.setStatus(glowStatusOf(e));
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
    this.glow.setStatus(glowStatusOf(e));
    this.glow.update(dt);
  }

  dispose(): void {
    this.geo.dispose();
    this.glow.dispose();
    this.root.removeFromParent();
  }
}

/**
 * Scale a fitted model to the EnemyDef's body when the two differ (the manifest's fitHeight is the
 * body the model was made for; a content variant may be bigger).
 */
export function fitToBody(m: ModelInstance, key: keyof typeof MODELS, def: EnemyDef): void {
  const size = modelSize(key, def);
  if (Math.abs(size - 1) > 1e-3) m.root.scale.multiplyScalar(size);
}

/** How many times the size its model was fitted at this body stands (1 when they match). */
export function modelSize(key: keyof typeof MODELS, def: EnemyDef): number {
  const fit = (MODELS[key] as ModelEntry).fitHeight;
  return fit ? def.body.height / fit : 1;
}

/** The standard enemies' model keys (manifest.ts): M1b's three and M4's veterans and Big Coin. */
export type HumanoidModel = 'grunt' | 'slinger' | 'wisp' | 'grunt_vet' | 'slinger_vet' | 'big_coin' | 'robot_shooter' | 'robot_laser';

/** Their idle resting glow: the Hex Wisp is a caster spirit, so it glows purple (plan §4.9). */
const WISP_EMISSIVE = 0x3a1060;
/** Wisp bob: amplitude (m) and rate (rad/s). */
const BOB = { amp: 0.07, rate: 2.3 };
/** Leap arc height per metre of leap (a 5.5 m leap peaks about 0.8 m up). */
const LEAP_LIFT = 0.15;
/** Humanoids fall over with `defeat` before they sink, so the sink waits longer than the Brute's. */
const HUMANOID_SINK_DELAY = 70;

/**
 * Grunt, Slinger and Hex Wisp (plan §4.9): 24-joint rigs with duel's clip set. Attacks scrub their
 * move's `cast` / `cast_big` clip so the hand's release lands on the last wind-up tick (the hit or
 * the shot); the Grunt's leap jumps an arc through its active ticks. Hitstun plays `hit`, a poise
 * break `stun`, death `defeat`; Frozen holds the pose. The Wisp floats `hover` m up with a soft
 * bob and a purple glow, and glides on its idle clip instead of running.
 */
export class HumanoidEnemyView implements EntityView {
  readonly root = new THREE.Group();
  readonly height: number;
  /** Lean, recoil and hover pivot at the feet. */
  private readonly body = new THREE.Group();
  private readonly glow = new BodyGlow();
  private readonly hover: number;
  private readonly peaks;
  private readonly floatGlow: THREE.Sprite | null = null;
  private model: ModelInstance | null = null;
  private animator: Animator | null = null;
  private readonly reaction = new HitReaction();
  private lean = 0;
  private time = Math.random() * 10;
  private disposed = false;
  /** How much bigger than its model's authored size it is drawn: the stride and the sink grow with it. */
  private readonly size: number;
  /** A carried pumpkin, worn on the head until a hit knocks it off. Shared mesh, one material. */
  private readonly pumpkin = new THREE.Mesh(pumpkinGeo(), pumpkinMat());

  constructor(assets: AssetLoader, readonly def: EnemyDef, readonly kind: HumanoidModel) {
    this.hover = def.hover ?? 0;
    this.height = def.body.height + this.hover;
    this.size = modelSize(kind, def);
    this.peaks = CAST_PEAKS[kind] ?? LIBRARY_CAST_PEAKS;
    this.pumpkin.position.set(0, this.height * 0.96, 0.08 * this.size);
    this.pumpkin.castShadow = true;
    this.pumpkin.visible = false;
    this.root.add(this.body, this.glow.glint, this.pumpkin);
    this.glow.glint.position.set(0, this.height * 0.88, 0.25 * this.size);
    if (kind === 'wisp') {
      // A soft purple pool of light under it, so the hover gap reads.
      const g = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: 0x9a4aff, transparent: true, opacity: 0.45, depthWrite: false, blending: THREE.AdditiveBlending }));
      g.scale.set(1.4 * this.size, 0.5 * this.size, 1);
      g.position.y = 0.12;
      this.root.add(g);
      this.floatGlow = g;
    }
    void assets.instance(kind).then((m) => {
      if (this.disposed) {
        m.dispose();
        return;
      }
      fitToBody(m, kind, def);
      this.model = m;
      this.glow.adopt(m.root, kind === 'wisp' ? WISP_EMISSIVE : undefined);
      this.body.add(m.root);
      this.animator = new Animator(m.root, m.clips);
    });
  }

  get clips(): string[] {
    return this.animator?.clipNames ?? [];
  }

  telegraph(_move: EnemyMoveDef | undefined, unblockable: boolean, ticks: number): void {
    this.glow.telegraph(unblockable, ticks / TICK_HZ);
  }

  flinch(from: { x: number; z: number }, heavy: boolean): void {
    this.glow.hit();
    this.reaction.hit(from, this.root.position, this.root.rotation.y, heavy);
  }

  reel(): void {
    this.reaction.lurch();
  }

  update(e: Readonly<Entity>, alpha: number, dt: number): void {
    placeEntity(this.root, e, alpha);
    this.root.visible = !e.brain?.held;
    this.pumpkin.visible = !!e.brain?.carry && !e.brain.held;
    const a = e.combat?.action ?? null;
    const anim = this.animator;
    const frozen = a?.kind === 'frozen';
    let lean = 0;
    let sink = 0;
    let lift = 0;
    if (a?.kind === 'attack') {
      const mv = this.def.moves.find((m) => m.id === a.move);
      if (mv) {
        const leaping = !!mv.leap && a.t >= mv.windup && a.t < mv.windup + mv.active;
        if (leaping) {
          const u = (a.t - mv.windup + alpha) / Math.max(1, mv.active);
          lift = Math.sin(Math.min(1, u) * Math.PI) * LEAP_LIFT * mv.leap!.distance;
          anim?.scrub('jump', Math.min(1, u) * anim.duration('jump'), ENTRY_FADE);
        } else if (anim && isCastClip(mv.clip) && anim.has(mv.clip)) {
          anim.scrub(mv.clip, castClipTime(this.peaks, mv.clip, a.t, mv.windup, mv.active + mv.recovery), ENTRY_FADE * 1.5);
        } else if (anim && mv.clip && anim.has(mv.clip)) {
          anim.scrub(mv.clip, attackClipTime(mv, a.t, anim.duration(mv.clip), 0.5), ENTRY_FADE * 1.5);
        }
        // Melee moves rear back through the wind-up and lunge into the blow.
        if (!mv.projectile && !mv.area && !mv.leap) lean = a.t < mv.windup ? -0.12 * (a.t / mv.windup) : 0.16 * Math.max(0, 1 - (a.t - mv.windup) / (mv.active + 10));
        if (a.t >= mv.windup) this.glow.endTelegraph();
      }
    } else {
      this.glow.endTelegraph();
      if (a?.kind === 'dead') {
        anim?.scrub('defeat', a.t / TICK_HZ, 0.12);
        // The robots have no `defeat` clip: they topple back instead.
        if (anim && !anim.has('defeat')) lean = -0.5 * Math.min(1, a.t / 24);
        sink = sinkFor(a.t, HUMANOID_SINK_DELAY);
      } else if (a?.kind === 'stagger') {
        const d = anim?.duration('stun') ?? 0;
        anim?.scrub('stun', d > 0 ? (a.t / TICK_HZ) % d : 0, 0.08);
        // The robots have no `stun` clip: they reel back and sway instead.
        if (anim && !anim.has('stun')) lean = -0.22 + 0.07 * Math.sin((a.t / TICK_HZ) * 7);
        // Parried: thrown further back on its heels than any other stagger.
        if (a.reason === 'parried') lean -= 0.16;
      } else if (a?.kind === 'hitstun') {
        anim?.scrub('hit', (Math.min(a.t, a.dur) / Math.max(1, a.dur)) * (anim?.duration('hit') ?? 0), 0.06);
        // Nor a `hit` clip: a short rock back on their heels.
        if (anim && !anim.has('hit')) lean = -0.16 * Math.max(0, 1 - a.t / Math.max(1, a.dur));
        // A knockdown (Blast) throws the body back on top of the flinch.
        if (a.knockdown) lean = -0.55 * Math.sin(Math.min(1, a.t / Math.max(1, a.dur)) * Math.PI);
      } else if (!frozen && anim) {
        const speed = Math.hypot(e.tf.vel.x, e.tf.vel.z);
        if (this.kind === 'wisp') {
          // Floating casters glide: idle, tipped into the direction of travel.
          anim.loop('idle');
          lean = Math.min(0.25, speed * 0.05);
        } else {
          // Enemies keep facing their target while they circle and backstep: legs follow velocity vs facing.
          const sy = Math.sin(e.tf.yaw), cy = Math.cos(e.tf.yaw);
          const { x: vx, z: vz } = e.tf.vel;
          // A longer leg covers more ground per step: the clips play slower on a bigger body, so feet don't slide.
          const s = this.size;
          anim.locomotion({ grounded: true, speed: speed / s, sprinting: false, minRate: s > 1 ? 0.25 : undefined, strafe: { x: (-cy * vx + sy * vz) / s, z: (sy * vx + cy * vz) / s } });
        }
      }
    }
    if (!frozen) {
      this.time += dt;
      this.lean += (lean - this.lean) * (1 - Math.exp(-14 * dt));
      this.reaction.update(dt);
    }
    const bob = this.hover > 0 && a?.kind !== 'dead' ? Math.sin(this.time * BOB.rate) * BOB.amp * this.size : 0;
    this.reaction.apply(this.body, this.lean);
    this.body.position.y = this.hover + bob + lift - sink * SINK_DEPTH * this.size;
    this.glow.setOpacity(1 - sink);
    if (this.floatGlow) this.floatGlow.material.opacity = 0.45 * (1 - sink) * (0.85 + 0.15 * Math.sin(this.time * BOB.rate * 2));
    this.root.visible = sink < 1;
    this.glow.setStatus(glowStatusOf(e));
    this.glow.update(dt);
    // Frozen (plan §4.7): the pose holds wherever the freeze caught it.
    if (!frozen) anim?.update(dt);
  }

  dispose(): void {
    this.disposed = true;
    this.animator?.dispose();
    this.glow.dispose();
    this.floatGlow?.material.dispose();
    this.model?.dispose();
    this.root.removeFromParent();
  }
}

let pumpkinGeometry: THREE.SphereGeometry | null = null;
let pumpkinMaterial: THREE.MeshStandardMaterial | null = null;
const pumpkinGeo = () => (pumpkinGeometry ??= new THREE.SphereGeometry(0.22, 8, 6));
const pumpkinMat = () => (pumpkinMaterial ??= new THREE.MeshStandardMaterial({ color: 0xe07020, roughness: 0.7 }));

/** Shared geometry for spell projectiles. */
let spellGeo: { streak: THREE.BufferGeometry; core: THREE.BufferGeometry } | null = null;
function spellGeometry() {
  if (!spellGeo) {
    // A cone along -Z from the head (z = 0) back to its tail: the bolt's streak.
    const streak = new THREE.ConeGeometry(0.09, 1.6, 10, 1, true);
    streak.rotateX(-Math.PI / 2);
    streak.translate(0, 0, -0.8);
    spellGeo = { streak, core: new THREE.SphereGeometry(1, 16, 12) };
  }
  return spellGeo;
}

function additive(color: number, opacity = 1): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, blending: THREE.AdditiveBlending });
}

function glowSprite(color: number, size: number): THREE.Sprite {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
  s.scale.set(size, size, 1);
  s.renderOrder = 5;
  return s;
}

/** Point a projectile view along its velocity (+Z forward). */
function faceVelocity(root: THREE.Object3D, e: Readonly<Entity>): void {
  const v = e.tf.vel;
  if (v.x || v.y || v.z) root.lookAt(root.position.x + v.x, root.position.y + v.y, root.position.z + v.z);
}

/**
 * Arcane Bolt (plan §4.4): a bright cyan streak, a white-hot head in a cyan glow. The tail grows in
 * over its first frames so it never pokes out behind the caster's hand.
 */
export class BoltView implements EntityView {
  readonly root = new THREE.Group();
  readonly height = 0.3;
  private readonly streak: THREE.Mesh;
  private readonly mats: THREE.Material[];
  private readonly halo: THREE.Sprite;
  private age = 0;

  constructor() {
    const g = spellGeometry();
    const streakMat = additive(0x2fe0ff, 0.9);
    const coreMat = additive(0xf0ffff);
    this.streak = new THREE.Mesh(g.streak, streakMat);
    const core = new THREE.Mesh(g.core, coreMat);
    core.scale.setScalar(0.11);
    this.halo = glowSprite(0x6ff6ff, 0.9);
    this.root.add(this.streak, core, this.halo);
    this.mats = [streakMat, coreMat, this.halo.material];
  }

  update(e: Readonly<Entity>, alpha: number, dt: number): void {
    placeEntity(this.root, e, alpha);
    faceVelocity(this.root, e);
    this.age += dt;
    this.streak.scale.set(1, 1, Math.min(1, 0.15 + this.age * 9));
    const s = 0.8 + 0.2 * Math.sin(this.age * 60);
    this.halo.scale.set(s, s, 1);
  }

  dispose(): void {
    for (const m of this.mats) m.dispose();
    this.root.removeFromParent();
  }
}

/** Blast (plan §4.4): a slow, big glowing orb, fire around a white core, trailing embers. */
export class BlastOrbView implements EntityView {
  readonly root = new THREE.Group();
  readonly height = 0.7;
  private readonly shell: THREE.Mesh;
  private readonly halo: THREE.Sprite;
  private readonly mats: THREE.Material[];
  private readonly at = new THREE.Vector3();
  private age = 0;
  private trail = 0;

  constructor(private readonly fx: HitFx | null, radius = 0.35) {
    const g = spellGeometry();
    const coreMat = additive(0xfff2d0);
    const shellMat = additive(0xff6a1a, 0.6);
    const core = new THREE.Mesh(g.core, coreMat);
    core.scale.setScalar(radius * 0.55);
    this.shell = new THREE.Mesh(g.core, shellMat);
    this.shell.scale.setScalar(radius);
    this.halo = glowSprite(0xff8a3a, radius * 6);
    this.root.add(core, this.shell, this.halo);
    this.mats = [coreMat, shellMat, this.halo.material];
  }

  update(e: Readonly<Entity>, alpha: number, dt: number): void {
    placeEntity(this.root, e, alpha);
    this.age += dt;
    const r = e.projectile?.radius ?? 0.35;
    const pulse = 1 + 0.12 * Math.sin(this.age * 26) + 0.06 * Math.sin(this.age * 41);
    this.shell.scale.setScalar(r * pulse);
    const h = r * 6 * pulse;
    this.halo.scale.set(h, h, 1);
    this.trail += dt;
    if (this.fx && this.trail > 0.03) {
      this.trail = 0;
      this.fx.emit(this.root.getWorldPosition(this.at), 'fire', 2, 0.2, 1.5);
    }
  }

  dispose(): void {
    for (const m of this.mats) m.dispose();
    this.root.removeFromParent();
  }
}

/** The Hex Wisp's Homing Hex (plan §4.9): a pulsing purple orb with a faint wake; cyan once parried back. */
export class HexView implements EntityView {
  readonly root = new THREE.Group();
  readonly height = 0.4;
  private readonly coreMat = additive(0xf0d8ff);
  private readonly halo: THREE.Sprite;
  private readonly at = new THREE.Vector3();
  private age = 0;
  private trail = 0;
  private reflected = false;

  constructor(private readonly fx: HitFx | null) {
    const core = new THREE.Mesh(spellGeometry().core, this.coreMat);
    core.scale.setScalar(0.16);
    this.halo = glowSprite(0xa040ff, 1.1);
    this.root.add(core, this.halo);
  }

  update(e: Readonly<Entity>, alpha: number, dt: number): void {
    placeEntity(this.root, e, alpha);
    this.age += dt;
    if (e.projectile?.reflected && !this.reflected) {
      this.reflected = true;
      this.halo.material.color.setHex(0x5ff0ff);
    }
    const s = 1 + 0.25 * Math.sin(this.age * 14);
    this.halo.scale.set(s, s, 1);
    this.trail += dt;
    if (this.fx && this.trail > 0.05) {
      this.trail = 0;
      this.fx.emit(this.root.getWorldPosition(this.at), this.reflected ? 'arcane' : 'hex', 1, 0.15);
    }
  }

  dispose(): void {
    this.coreMat.dispose();
    this.halo.material.dispose();
    this.root.removeFromParent();
  }
}
