import * as THREE from 'three';
import type { AssetLoader } from '../../assets/AssetLoader';
import { ENEMIES, type EnemyDef, type EnemyMoveDef } from '../../content/enemies';
import type { Entity } from '../../sim/entity';
import { ENTRY_FADE } from '../anim/Animator';
import type { HitFx } from '../fx/HitFx';
import { ScrapjawView } from './BossViews';
import { attackClipTime, type EntityView } from './EnemyViews';
import { placeEntity } from './interp';

/** How far under the ground her body goes, per metre of her height: past her own height, so nothing shows. */
const DEPTH_PER_HEIGHT = 1.12;
/** How quickly the body follows the depth it should be at (1/s). */
const DEPTH_RATE = 12;
/** Where the slam's blow lands in its clip (the boss views' CONTACT table). */
const SLAM_CONTACT = 0.45;
/** Seconds between puffs of dust while she digs or tunnels. */
const DUST_EVERY = 0.04;
const DUST_COLOR = 0xb8a68c;

/**
 * The Burrowmother (expansion plan §3.4): Scrapjaw's view with her own clips. The model has no burrow
 * clip, so she sinks by a transform offset; dust marks the dig, runs along the ground to where she is
 * coming up, and bursts when she breaks the surface.
 */
class BurrowmotherView extends ScrapjawView {
  /** How far down she goes (m). */
  private readonly deepest = this.def.body.height * DEPTH_PER_HEIGHT;
  private depth = this.deepest;
  private wasUnder = true;
  private dust = 0;
  private readonly at = { x: 0, y: 0, z: 0 };

  constructor(assets: AssetLoader, def: EnemyDef, private readonly fx: HitFx | null) {
    super(assets, def, 'burrowmother');
  }

  /** Her body is out of sight during a burrow: the decal and the dust are the telegraph. */
  telegraph(move: EnemyMoveDef | undefined, unblockable: boolean, ticks: number): void {
    if (!move?.burrow) super.telegraph(move, unblockable, ticks);
  }

  protected playAttack(mv: EnemyMoveDef, t: number): void {
    const anim = this.animator;
    if (anim && mv.burrow) {
      anim.scrub('slam', attackClipTime(mv, t, anim.duration('slam'), SLAM_CONTACT), ENTRY_FADE);
    } else if (anim && mv.projectile) {
      if (t < mv.windup) anim.scrub('shoot_start', (t / mv.windup) * anim.duration('shoot_start'), ENTRY_FADE);
      else if (t < mv.windup + mv.active) anim.loop('shoot_loop', 1, ENTRY_FADE);
      else anim.loop('idle');
    } else super.playAttack(mv, t);
  }

  protected burrowDepth(e: Readonly<Entity>, dt: number): number {
    const a = e.combat?.action;
    const mv = a?.kind === 'attack' ? this.def.moves.find((m) => m.id === a.move) : undefined;
    const deepest = this.deepest;
    let want = e.boss?.under ? deepest : 0;
    // Digging in: she goes down through the wind-up, slowly at first.
    if (a?.kind === 'attack' && mv?.burrow === 'sink' && a.t < mv.windup) want = deepest * (a.t / mv.windup) ** 2;
    this.depth += (want - this.depth) * (1 - Math.exp(-DEPTH_RATE * dt));
    this.body.visible = this.depth < deepest - 0.1;
    return this.depth;
  }

  update(e: Readonly<Entity>, alpha: number, dt: number): void {
    super.update(e, alpha, dt);
    const under = !!e.boss?.under;
    const p = this.root.position;
    // Breaking the surface, or closing over her.
    if (under !== this.wasUnder) this.burst(p, under ? 0.6 : 1);
    this.wasUnder = under;
    this.dust += dt;
    if (this.dust < DUST_EVERY) return;
    this.dust = 0;
    const a = e.combat?.action;
    if (a?.kind !== 'attack') return;
    const mv = this.def.moves.find((m) => m.id === a.move);
    if (mv?.burrow === 'sink' && a.t < mv.windup) this.puff(p.x, p.y, p.z, 5);
    else if (mv?.burrow === 'rise' && under && a.aim) {
      // The dust runs from where she went down to where she is coming up.
      const u = Math.min(1, a.t / Math.max(1, mv.windup * 0.7));
      this.puff(p.x + (a.aim.x - p.x) * u, a.aim.y + (p.y - a.aim.y) * (1 - u), p.z + (a.aim.z - p.z) * u, 6);
    }
  }

  private puff(x: number, y: number, z: number, n: number): void {
    this.at.x = x;
    this.at.y = y + 0.3;
    this.at.z = z;
    this.fx?.emit(this.at, 'resist', n, 1.4, 2.4);
  }

  private burst(p: THREE.Vector3, size: number): void {
    this.at.x = p.x;
    this.at.y = p.y + 0.2;
    this.at.z = p.z;
    this.fx?.ring(this.at, DUST_COLOR, 0.6, 7 * size * (this.def.size ?? 1), 0.45);
    this.fx?.emit(this.at, 'resist', Math.round(60 * size), 3.2, 3.5);
    this.fx?.emit(this.at, 'heavy', Math.round(18 * size), 1.6, 3);
  }
}

/** A Burn glob: a spitting ball of fire that turns cold blue once it has been sent back. */
class BurnGlobView implements EntityView {
  readonly root = new THREE.Group();
  readonly height = 0.6;
  private readonly geo = new THREE.IcosahedronGeometry(1, 1);
  private readonly mat = new THREE.MeshStandardMaterial({ color: 0xff7a1a, emissive: 0xff4a00, emissiveIntensity: 1.6, roughness: 0.5 });
  private readonly ball = new THREE.Mesh(this.geo, this.mat);
  private time = 0;
  private ember = 0;
  private readonly at = new THREE.Vector3();

  constructor(e: Readonly<Entity>, private readonly fx: HitFx | null) {
    this.ball.scale.setScalar(e.projectile?.radius ?? 0.5);
    this.root.add(this.ball);
  }

  update(e: Readonly<Entity>, alpha: number, dt: number): void {
    placeEntity(this.root, e, alpha);
    this.time += dt;
    this.ball.rotation.set(this.time * 7, this.time * 5, 0);
    const reflected = !!e.projectile?.reflected;
    if (reflected) this.mat.emissive.setHex(0x1a8aff);
    this.ember += dt;
    if (this.ember < 0.05) return;
    this.ember = 0;
    this.root.getWorldPosition(this.at);
    this.fx?.emit(this.at, reflected ? 'frost' : 'fire', 2, 0.25, 1.5);
  }

  dispose(): void {
    this.geo.dispose();
    this.mat.dispose();
    this.root.removeFromParent();
  }
}

/** The view for the Burrowmother or her spit (by view model), or null for anything else. */
export function makeBurrowmotherView(e: Readonly<Entity>, assets: AssetLoader, fx: HitFx | null): EntityView | null {
  if (e.view.model === 'burn_glob') return new BurnGlobView(e, fx);
  if (e.view.model !== 'burrowmother') return null;
  const def = e.brain ? ENEMIES[e.brain.def] : undefined;
  return def ? new BurrowmotherView(assets, def, fx) : null;
}
