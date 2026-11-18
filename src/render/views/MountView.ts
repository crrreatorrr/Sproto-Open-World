import * as THREE from 'three';
import type { AssetLoader, ModelInstance } from '../../assets/AssetLoader';
import type { Entity } from '../../sim/entity';
import { Animator } from '../anim/Animator';
import type { EntityView } from './EnemyViews';
import { placeEntity } from './interp';

/** The saddle sits this far behind the model's origin: moved so the rider's origin is on it (m). */
const SADDLE_BACK = 0.15;
/** Below this speed it stands; above the second it runs (m/s). */
const WALK_FROM = 0.4;
const RUN_FROM = 6;
/** Ground speeds its walk and run clips were authored for at this size (m/s). */
const WALK_CLIP_SPEED = 3.6;
const RUN_CLIP_SPEED = 9;

/** The Pepe Bull: the hub's model and its idle, walk and run clips, driven by the sim's speed. */
export class MountView implements EntityView {
  readonly root = new THREE.Group();
  readonly height = 1.7;
  private model: ModelInstance | null = null;
  private animator: Animator | null = null;
  private disposed = false;
  /** The spine bone under the saddle, and its height above the bull's feet when standing idle. */
  private spine: THREE.Object3D | null = null;
  private spineRest = 0;
  private readonly scratch = new THREE.Vector3();
  /** How far the saddle has risen (m) from its idle height: the back dips as the bull runs. */
  saddleLift = 0;

  constructor(assets: AssetLoader) {
    void assets.instance('pepe_bull').then((m) => {
      if (this.disposed) {
        m.dispose();
        return;
      }
      m.root.position.z = SADDLE_BACK;
      this.root.add(m.root);
      this.model = m;
      this.animator = new Animator(m.root, m.clips);
      m.root.traverse((o) => {
        if (!this.spine && (o as THREE.Bone).isBone && o.name.includes('Spine_0')) this.spine = o;
      });
      this.animator.loop('idle', 1, 0);
      this.animator.update(0);
      this.spineRest = this.spineHeight();
    });
  }

  update(e: Readonly<Entity>, alpha: number, dt: number): void {
    placeEntity(this.root, e, alpha);
    const a = this.animator;
    if (!a) return;
    const speed = e.mount?.speed ?? 0;
    if (speed < WALK_FROM) a.loop('idle');
    else if (speed < RUN_FROM) a.loop('follow_walk', THREE.MathUtils.clamp(speed / WALK_CLIP_SPEED, 0.6, 1.6));
    else a.loop('follow_run', THREE.MathUtils.clamp(speed / RUN_CLIP_SPEED, 0.8, 1.6));
    a.update(dt);
    this.saddleLift = this.spine ? this.spineHeight() - this.spineRest : 0;
  }

  private spineHeight(): number {
    this.root.updateMatrixWorld(true);
    return this.spine!.getWorldPosition(this.scratch).y - this.root.position.y;
  }

  dispose(): void {
    this.disposed = true;
    this.animator?.dispose();
    this.model?.dispose();
    this.root.removeFromParent();
  }
}
