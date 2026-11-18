import * as THREE from 'three';
import type { AssetLoader, ModelInstance } from '../../assets/AssetLoader';
import type { ModelKey } from '../../assets/manifest';
import { ENEMIES, type EnemyDef, type EnemyMoveDef } from '../../content/enemies';
import { TICK_HZ } from '../../content/tuning';
import type { Entity } from '../../sim/entity';
import { Animator, ENTRY_FADE } from '../anim/Animator';
import type { HitFx } from '../fx/HitFx';
import { glowTexture } from '../fx/textures';
import { BodyGlow } from './BodyGlow';
import { attackClipTime, glowStatusOf, type EntityView } from './EnemyViews';
import { placeEntity, spring } from './interp';
import { TelegraphDecal } from './TelegraphDecal';

/** Where the blow lands in each attack clip (fraction of the clip; the smash is the shooter's 24 of 54). */
const CONTACT: Record<string, number> = { smash: 24 / 54, slam: 0.45 };
/** Ground speed of the walk and charge clips at time scale 1 (the shooter's speeds per metre of height, at 5.4 m). */
const WALK_CLIP_SPEED = 1.79;
const CHARGE_CLIP_SPEED = 6.73;
/** Death: hold the pose, then sink and fade (ticks). */
const SINK_DELAY = 30;
const SINK_TICKS = 70;
const SINK_DEPTH = 2.4;
/** The charge's lane on the ground (m). */
const LANE_LENGTH = 20;

/** A vertical fade, bright at the foot: the arena's fog wall and the gate's barrier. */
let fogTex: THREE.CanvasTexture | null = null;
function fogTexture(): THREE.CanvasTexture {
  if (fogTex) return fogTex;
  const c = document.createElement('canvas');
  c.width = 4;
  c.height = 64;
  const g = c.getContext('2d')!;
  const grad = g.createLinearGradient(0, 64, 0, 0);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.6, 'rgba(255,255,255,0.35)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 4, 64);
  fogTex = new THREE.CanvasTexture(c);
  fogTex.colorSpace = THREE.SRGBColorSpace;
  return fogTex;
}

function fogMaterial(color: number): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({ map: fogTexture(), color, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending });
}

/**
 * Scrapjaw (plan §4.10): every action has its own clip, scrubbed from the sim's tick counter so the
 * blow lands on the frame the hitbox comes out. A charge paints its lane on the ground through the
 * wind-up, and the arena's fog wall stands while the fight is on.
 */
export class ScrapjawView implements EntityView {
  readonly root = new THREE.Group();
  readonly height: number;
  protected readonly body = new THREE.Group();
  private readonly glow = new BodyGlow();
  private model: ModelInstance | null = null;
  protected animator: Animator | null = null;
  private readonly recoil = { x: 0, v: 0 };
  private lean = 0;
  private disposed = false;
  private readonly lane: THREE.Mesh;
  private readonly laneMat = new THREE.MeshBasicMaterial({ color: 0xff5a2a, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  private readonly wall: THREE.Mesh;
  private readonly wallMat = fogMaterial(0xffb070);
  private wallOn = 0;
  private time = 0;

  constructor(assets: AssetLoader, readonly def: EnemyDef, modelKey: ModelKey = 'scrapjaw') {
    this.height = def.body.height;
    this.root.add(this.body, this.glow.glint);
    this.glow.glint.position.set(0, this.height * 0.88, 0.8);
    const laneGeo = new THREE.PlaneGeometry(1, LANE_LENGTH);
    laneGeo.rotateX(-Math.PI / 2);
    laneGeo.translate(0, 0, LANE_LENGTH / 2);
    this.lane = new THREE.Mesh(laneGeo, this.laneMat);
    this.lane.position.y = 0.06;
    this.lane.visible = false;
    this.root.add(this.lane);
    const r = def.boss?.arenaRadius ?? 20;
    this.wall = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 7, 64, 1, true), this.wallMat);
    this.wall.visible = false;
    void assets.instance(modelKey).then((m) => {
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

  telegraph(move: EnemyMoveDef | undefined, unblockable: boolean, ticks: number): void {
    this.glow.telegraph(unblockable, ticks / TICK_HZ);
    if (move?.charge) this.lane.scale.x = move.hitbox.radius * 2;
  }

  flinch(_from: { x: number; z: number }, heavy: boolean): void {
    this.glow.hit();
    this.recoil.v -= heavy ? 1.2 : 0.6;
  }

  /** How far under the ground the body is drawn (m): the Burrowmother's burrow. */
  protected burrowDepth(_e: Readonly<Entity>, _dt: number): number {
    return 0;
  }

  /** One attack's clip at tick `t` of the move. */
  protected playAttack(mv: EnemyMoveDef, t: number): void {
    const anim = this.animator;
    if (!anim) return;
    const total = mv.windup + mv.active + mv.recovery;
    if (mv.charge) {
      if (t < mv.windup) anim.scrub('charge_start', (t / mv.windup) * anim.duration('charge_start'), ENTRY_FADE);
      else if (t < mv.windup + mv.active) anim.loop('charge', Math.min(2.4, mv.charge.speed / CHARGE_CLIP_SPEED), ENTRY_FADE);
      else anim.loop('idle');
    } else if (mv.projectile) {
      if (t < mv.windup) anim.scrub('throw_start', (t / mv.windup) * anim.duration('throw_start'), ENTRY_FADE);
      else anim.scrub('throw_loop', ((t - mv.windup) / Math.max(1, mv.active + mv.recovery)) * anim.duration('throw_loop'), ENTRY_FADE);
    } else if (mv.noHit) {
      anim.scrub('roar', (t / total) * anim.duration('roar'), ENTRY_FADE);
    } else if (mv.clip && anim.has(mv.clip)) {
      anim.scrub(mv.clip, attackClipTime(mv, t, anim.duration(mv.clip), CONTACT[mv.clip] ?? 0.5), ENTRY_FADE);
    }
  }

  update(e: Readonly<Entity>, alpha: number, dt: number): void {
    placeEntity(this.root, e, alpha);
    this.time += dt;
    const a = e.combat?.action ?? null;
    const anim = this.animator;
    let lean = 0;
    let sink = 0;
    let lane = 0;
    if (a?.kind === 'attack') {
      const mv = this.def.moves.find((m) => m.id === a.move);
      if (mv) {
        this.playAttack(mv, a.t);
        if (mv.charge && a.t < mv.windup) lane = a.t / mv.windup;
        if (a.t >= mv.windup) this.glow.endTelegraph();
      }
    } else {
      this.glow.endTelegraph();
      if (a?.kind === 'dead') {
        anim?.scrub('stunned', Math.min(a.t / TICK_HZ, anim.duration('stunned') - 0.01), 0.2);
        lean = -0.3 * Math.min(1, a.t / 30);
        sink = Math.min(1, Math.max(0, (a.t - SINK_DELAY) / SINK_TICKS));
      } else if (a?.kind === 'stagger' || a?.kind === 'hitstun') {
        anim?.loop('stunned', a.kind === 'stagger' && a.reason === 'broken' ? 0.75 : 1);
      } else if (e.boss?.state === 'intro') {
        const ticks = this.def.boss?.introTicks ?? 120;
        anim?.scrub('roar', (e.boss.t / ticks) * (anim?.duration('roar') ?? 0), 0.25);
      } else if (anim) {
        const speed = Math.hypot(e.tf.vel.x, e.tf.vel.z);
        if (speed < 0.3) anim.loop('idle');
        else anim.loop('walk', Math.min(1.8, Math.max(0.6, speed / WALK_CLIP_SPEED)));
      }
    }
    this.lane.visible = lane > 0;
    if (lane > 0) this.laneMat.opacity = 0.12 + 0.3 * lane * (0.8 + 0.2 * Math.sin(this.time * 30));
    this.lean += (lean - this.lean) * (1 - Math.exp(-14 * dt));
    spring(this.recoil, 160, 14, dt);
    this.body.rotation.x = this.lean + this.recoil.x;
    this.body.position.y = -sink * SINK_DEPTH - this.burrowDepth(e, dt);
    this.glow.setOpacity(1 - sink);
    this.root.visible = sink < 1;
    this.glow.setStatus(glowStatusOf(e));
    this.glow.update(dt);
    if (a?.kind !== 'frozen') anim?.update(dt);
    this.fogWall(e, dt);
  }

  /** The arena's fog wall: on the world, not on the boss, and up while the fight is on. */
  private fogWall(e: Readonly<Entity>, dt: number): void {
    const on = e.boss?.state === 'intro' || e.boss?.state === 'fight';
    this.wallOn += ((on ? 1 : 0) - this.wallOn) * (1 - Math.exp(-3 * dt));
    this.wall.visible = this.wallOn > 0.01;
    if (!this.wall.visible) return;
    if (!this.wall.parent) this.root.parent?.add(this.wall);
    const home = e.brain?.home;
    if (home) this.wall.position.set(home.x, home.y + 3.5, home.z);
    this.wallMat.opacity = this.wallOn * (0.3 + 0.08 * Math.sin(this.time * 2.2));
  }

  dispose(): void {
    this.disposed = true;
    this.animator?.dispose();
    this.glow.dispose();
    this.model?.dispose();
    this.lane.geometry.dispose();
    this.laneMat.dispose();
    this.wall.removeFromParent();
    this.wall.geometry.dispose();
    this.wallMat.dispose();
    this.root.removeFromParent();
  }
}

/** Scrap Throw: a tumbling lump of junk; it glows cyan once a parry has sent it back. */
export class ScrapView implements EntityView {
  readonly root = new THREE.Group();
  readonly height = 0.8;
  private readonly lump = new THREE.Group();
  private readonly geo = new THREE.BoxGeometry(1, 1, 1);
  private readonly mat = new THREE.MeshStandardMaterial({ color: 0x70604f, roughness: 0.75, metalness: 0.5, emissive: 0x401a08 });
  private spin = 0;

  constructor() {
    for (const [x, y, z, sx, sy, sz] of [[0, 0, 0, 0.95, 0.7, 0.8], [0.3, 0.25, -0.15, 0.6, 0.45, 0.6], [-0.3, -0.2, 0.2, 0.5, 0.55, 0.45]] as const) {
      const m = new THREE.Mesh(this.geo, this.mat);
      m.position.set(x, y, z);
      m.scale.set(sx, sy, sz);
      m.rotation.set(x * 2, y * 3, z * 2);
      m.castShadow = true;
      this.lump.add(m);
    }
    this.root.add(this.lump);
  }

  update(e: Readonly<Entity>, alpha: number, dt: number): void {
    placeEntity(this.root, e, alpha);
    this.spin += dt * 9;
    this.lump.rotation.set(this.spin, this.spin * 0.7, 0);
    if (e.projectile?.reflected) this.mat.emissive.setHex(0x1a6a9a);
  }

  dispose(): void {
    this.geo.dispose();
    this.mat.dispose();
    this.root.removeFromParent();
  }
}

/** A falling rock: its circle fills on the ground while the rock drops out of the sky onto it. */
export class RockHazardView implements EntityView {
  readonly root = new THREE.Group();
  readonly height = 1;
  private readonly decal = new TelegraphDecal('circle', 0xffa23a);
  private readonly rock: THREE.Mesh;
  private readonly geo = new THREE.DodecahedronGeometry(1, 0);
  private readonly mat = new THREE.MeshStandardMaterial({ color: 0x77706a, roughness: 0.95 });
  private landed = false;

  constructor(private readonly fx: HitFx | null) {
    this.rock = new THREE.Mesh(this.geo, this.mat);
    this.rock.castShadow = true;
    this.root.add(this.decal.root, this.rock);
  }

  update(e: Readonly<Entity>, alpha: number, dt: number): void {
    placeEntity(this.root, e, alpha);
    const h = e.hazard;
    if (!h) return;
    const size = h.radius * 0.5;
    this.rock.scale.setScalar(size);
    const u = 1 - h.fuse / Math.max(1, h.fuseMax);
    this.decal.update(0, 0, 0, 0, h.radius, u, dt);
    this.decal.root.visible = h.fuse > 0;
    // It falls through the last part of the fuse, landing as the circle fills.
    const fall = Math.max(0, (u - 0.45) / 0.55);
    this.rock.visible = fall > 0;
    this.rock.position.y = size * 0.6 + 18 * (1 - fall * fall);
    this.rock.rotation.x += dt * 2.4;
    this.rock.rotation.z += dt * 1.7;
    if (h.fuse === 0 && !this.landed) {
      this.landed = true;
      const p = this.root.position;
      this.fx?.ring({ x: p.x, y: p.y + 0.1, z: p.z }, 0xd8c8a8, 0.4, h.radius * 1.2, 0.35);
      this.fx?.emit({ x: p.x, y: p.y + 0.4, z: p.z }, 'heavy', 24, 1.4, 2);
    }
    if (this.landed) this.rock.scale.setScalar(size * Math.max(0, h.life / 40));
  }

  dispose(): void {
    this.decal.dispose();
    this.geo.dispose();
    this.mat.dispose();
    this.root.removeFromParent();
  }
}

/** A Burn patch: a flickering pool of fire on the ground, shedding embers. */
export class BurnPatchView implements EntityView {
  readonly root = new THREE.Group();
  readonly height = 0.5;
  private readonly geo = new THREE.PlaneGeometry(1, 1);
  private readonly mat = new THREE.MeshBasicMaterial({ map: glowTexture(), color: 0xff6a1a, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  private readonly pool: THREE.Mesh;
  private time = Math.random() * 10;
  private ember = 0;
  private readonly at = new THREE.Vector3();

  constructor(private readonly fx: HitFx | null) {
    this.geo.rotateX(-Math.PI / 2);
    this.pool = new THREE.Mesh(this.geo, this.mat);
    this.pool.position.y = 0.07;
    this.root.add(this.pool);
  }

  update(e: Readonly<Entity>, alpha: number, dt: number): void {
    placeEntity(this.root, e, alpha);
    const h = e.hazard;
    if (!h) return;
    this.time += dt;
    // The glow texture fades out toward its edge: draw it wider than the burn's real radius.
    this.pool.scale.setScalar(h.radius * 2.6);
    const fade = Math.min(1, h.life / 40);
    this.mat.opacity = fade * (0.7 + 0.12 * Math.sin(this.time * 17) + 0.1 * Math.sin(this.time * 29));
    this.ember += dt;
    if (this.fx && this.ember > 0.05) {
      this.ember = 0;
      const a = Math.random() * Math.PI * 2;
      const r = Math.sqrt(Math.random()) * h.radius;
      this.root.getWorldPosition(this.at);
      this.fx.emit({ x: this.at.x + Math.sin(a) * r, y: this.at.y + 0.2, z: this.at.z + Math.cos(a) * r }, 'fire', 2, 0.2, 2.6);
    }
  }

  dispose(): void {
    this.geo.dispose();
    this.mat.dispose();
    this.root.removeFromParent();
  }
}

/** A pillar in the arena: stands until a charge smashes it, and comes back when the fight resets. */
export class PillarView implements EntityView {
  readonly root = new THREE.Group();
  readonly height = 5.7;
  private model: ModelInstance | null = null;
  private disposed = false;
  private broken = false;

  constructor(assets: AssetLoader, private readonly fx: HitFx | null) {
    void assets.instance('quarry_pillar').then((m) => {
      if (this.disposed) {
        m.dispose();
        return;
      }
      this.model = m;
      // The quarry's rock, stretched up into a pillar about as wide as its collider.
      m.root.scale.set(1.2, 1.9, 1.2);
      m.root.traverse((o) => {
        if ((o as THREE.Mesh).isMesh) o.castShadow = o.receiveShadow = true;
      });
      this.root.add(m.root);
    });
  }

  update(e: Readonly<Entity>, alpha: number): void {
    placeEntity(this.root, e, alpha);
    const broken = !!e.obstacle?.broken;
    if (broken && !this.broken) {
      const p = this.root.position;
      this.fx?.flash({ x: p.x, y: p.y + 2.5, z: p.z }, 0xe8d8b8, 7, 0.25);
      for (let i = 0; i < 5; i++) this.fx?.emit({ x: p.x, y: p.y + 0.8 * i, z: p.z }, 'heavy', 22, 2.4, 2.5);
    }
    this.broken = broken;
    this.root.visible = !broken;
  }

  dispose(): void {
    this.disposed = true;
    this.model?.dispose();
    this.root.removeFromParent();
  }
}

/** The Quarry Gate's barrier: a wall of cold fog across the ravine, gone once the gate is opened. */
export class GateBarrierView implements EntityView {
  readonly root = new THREE.Group();
  readonly height = 10;
  private readonly geo: THREE.PlaneGeometry;
  private readonly mat = fogMaterial(0x9fdcff);
  private on = 1;
  private time = 0;

  constructor(e: Readonly<Entity>) {
    const shape = e.obstacle?.shape;
    const halfWidth = shape?.kind === 'box' ? shape.half[0] : 10;
    this.geo = new THREE.PlaneGeometry(halfWidth * 2, this.height);
    this.geo.translate(0, this.height / 2 - 1, 0);
    this.root.add(new THREE.Mesh(this.geo, this.mat));
  }

  update(e: Readonly<Entity>, alpha: number, dt: number): void {
    placeEntity(this.root, e, alpha);
    this.time += dt;
    this.on += ((e.obstacle?.broken ? 0 : 1) - this.on) * (1 - Math.exp(-2.5 * dt));
    this.root.visible = this.on > 0.01;
    this.mat.opacity = this.on * (0.55 + 0.1 * Math.sin(this.time * 1.7));
  }

  dispose(): void {
    this.geo.dispose();
    this.mat.dispose();
    this.root.removeFromParent();
  }
}

/** The Quarry Gate's lock (an `object` interactable): a stone post with a keyhole that glows until it is used. */
export class GateLockView implements EntityView {
  readonly root = new THREE.Group();
  readonly height = 1.5;
  private readonly postGeo = new THREE.CylinderGeometry(0.28, 0.36, 1.4, 8);
  private readonly stone = new THREE.MeshStandardMaterial({ color: 0x6e6a66, roughness: 0.95 });
  private readonly keyMat = new THREE.SpriteMaterial({ map: glowTexture(), color: 0x9fdcff, transparent: true, opacity: 0.8, depthWrite: false, blending: THREE.AdditiveBlending });
  private readonly key = new THREE.Sprite(this.keyMat);
  private used = 0;
  private time = Math.random() * 10;

  constructor() {
    const post = new THREE.Mesh(this.postGeo, this.stone);
    post.position.y = 0.7;
    post.castShadow = true;
    this.key.position.set(0, 1.15, 0.32);
    this.key.scale.setScalar(0.7);
    this.root.add(post, this.key);
  }

  update(e: Readonly<Entity>, alpha: number, dt: number): void {
    placeEntity(this.root, e, alpha);
    this.time += dt;
    this.used += ((e.interactable?.used ? 1 : 0) - this.used) * (1 - Math.exp(-3 * dt));
    this.keyMat.opacity = (1 - this.used) * (0.6 + 0.3 * Math.sin(this.time * 2.6));
  }

  dispose(): void {
    this.postGeo.dispose();
    this.stone.dispose();
    this.keyMat.dispose();
    this.root.removeFromParent();
  }
}

/** The view for a boss-fight entity (by its view model), or null for anything else. */
export function makeBossView(e: Readonly<Entity>, assets: AssetLoader, fx: HitFx | null): EntityView | null {
  switch (e.view.model) {
    case 'scrapjaw': {
      const def = e.brain ? ENEMIES[e.brain.def] : undefined;
      return def ? new ScrapjawView(assets, def) : null;
    }
    case 'scrap':
      return new ScrapView();
    case 'hazard_rock':
      return new RockHazardView(fx);
    case 'hazard_burn':
      return new BurnPatchView(fx);
    case 'quarry_pillar':
      return new PillarView(assets, fx);
    case 'gate_barrier':
      return new GateBarrierView(e);
    default:
      return null;
  }
}
