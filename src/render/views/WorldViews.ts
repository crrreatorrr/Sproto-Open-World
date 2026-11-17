import * as THREE from 'three';
import type { AssetLoader } from '../../assets/AssetLoader';
import { ENEMIES, type EnemyDef, type EnemyMoveDef } from '../../content/enemies';
import type { Entity, EntityId } from '../../sim/entity';
import type { SimEvent } from '../../sim/events';
import type { ReadonlySimView } from '../../sim/view';
import { BruteView, CoinView, DummyView, FallbackView, type EntityView } from './EnemyViews';
import { TelegraphDecal, type DecalShape } from './TelegraphDecal';

const DECAL_COLOR: Record<DecalShape, number> = { circle: 0xffa23a, jagged: 0xff2a1a };

interface LiveDecal {
  entity: EntityId;
  move: EnemyMoveDef;
  decal: TelegraphDecal;
}

/** The enemy definition behind an entity, if it has a brain. */
export function enemyDef(e: Readonly<Entity> | undefined): EnemyDef | undefined {
  const id = e?.brain?.def;
  return id ? ENEMIES[id] : undefined;
}

/**
 * Every drawn non-player entity: a view per enemy and projectile, made when the entity appears and
 * dropped when it leaves the sim, plus the telegraph decals under their attacks. Players have
 * their own PlayerView.
 */
export class WorldViews {
  readonly root = new THREE.Group();
  private readonly views = new Map<EntityId, EntityView>();
  private readonly decals: LiveDecal[] = [];
  private readonly seen = new Set<EntityId>();

  constructor(private readonly assets: AssetLoader) {}

  get(id: EntityId): EntityView | undefined {
    return this.views.get(id);
  }

  /** Make, update and drop views to match the sim. Call once per rendered frame. */
  sync(view: ReadonlySimView, alpha: number, dt: number): void {
    this.seen.clear();
    for (const e of view.entities) {
      if (e.kind === 'player') continue;
      let v = this.views.get(e.id);
      if (!v) {
        const made = this.make(e);
        if (!made) continue;
        v = made;
        this.views.set(e.id, v);
        this.root.add(v.root);
      }
      this.seen.add(e.id);
      v.update(e, alpha, dt);
    }
    for (const [id, v] of this.views) {
      if (this.seen.has(id)) continue;
      v.dispose();
      this.views.delete(id);
    }
    this.updateDecals(view, dt);
  }

  /** React to a sim event (telegraphs and flinches; sounds and numbers live in the app). */
  event(view: ReadonlySimView, e: SimEvent): void {
    if (e.type === 'telegraph') {
      const ent = view.get(e.entity);
      const move = enemyDef(ent)?.moves.find((m) => m.id === e.move);
      this.views.get(e.entity)?.telegraph?.(move, e.unblockable, e.ticks);
      const shape: DecalShape | null = e.decal ?? (e.unblockable ? 'jagged' : null);
      if (shape && move) {
        const decal = new TelegraphDecal(shape, DECAL_COLOR[shape]);
        this.root.add(decal.root);
        this.decals.push({ entity: e.entity, move, decal });
      }
    } else if (e.type === 'hit') {
      const from = view.get(e.attacker)?.tf.pos ?? e.pos;
      this.views.get(e.target)?.flinch?.(from, e.heavy);
    }
  }

  /**
   * Decals sit on the move's hitbox (forward / radius from its EnemyDef) and follow the enemy while
   * it still tracks. They fill with the sim's tick counter, so hit-stop pauses them too, and go
   * when the active frames end or the attack is interrupted.
   */
  private updateDecals(view: ReadonlySimView, dt: number): void {
    for (let i = this.decals.length - 1; i >= 0; i--) {
      const d = this.decals[i];
      const e = view.get(d.entity);
      const a = e?.combat?.action;
      const live = e && a?.kind === 'attack' && a.move === d.move.id && a.t < d.move.windup + d.move.active;
      if (!live) {
        d.decal.dispose();
        this.decals.splice(i, 1);
        continue;
      }
      const v = this.views.get(d.entity);
      const p = v?.root.position ?? e.tf.pos;
      const yaw = v?.root.rotation.y ?? e.tf.yaw;
      const f = d.move.hitbox.forward;
      d.decal.update(p.x + Math.sin(yaw) * f, p.y, p.z + Math.cos(yaw) * f, yaw, d.move.hitbox.radius, a.t / Math.max(1, d.move.windup), dt);
    }
  }

  private make(e: Readonly<Entity>): EntityView | null {
    const def = enemyDef(e);
    switch (e.view.model) {
      case 'brute':
        return def ? new BruteView(this.assets, def) : new FallbackView(e);
      case 'dummy':
        return def ? new DummyView(def) : new FallbackView(e);
      case 'coin':
        return new CoinView();
      default:
        return e.kind === 'enemy' || e.kind === 'boss' ? new FallbackView(e) : null;
    }
  }

  /** Drop everything (quit to title). */
  clear(): void {
    for (const v of this.views.values()) v.dispose();
    this.views.clear();
    for (const d of this.decals) d.decal.dispose();
    this.decals.length = 0;
  }
}
