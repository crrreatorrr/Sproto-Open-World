import * as THREE from 'three';
import type { AssetLoader, ModelInstance } from '../../assets/AssetLoader';
import { STAFF_SOCKET, type ModelKey } from '../../assets/manifest';
import type { Entity } from '../../sim/entity';
import { Animator } from '../anim/Animator';

const lerpAngle = (a: number, b: number, t: number) => {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
};

/** Draws one player entity: the rigged model, its staff on `socket_staff`, and its animation. */
export class PlayerView {
  readonly root = new THREE.Group();
  animator: Animator | null = null;
  private model: ModelInstance | null = null;
  private staff: ModelInstance | null = null;
  /** The staff attached to the socket (false: no socket, or no staff model). */
  staffMounted = false;

  constructor(private readonly assets: AssetLoader) {}

  async load(staffKey: ModelKey = 'staff_sproto'): Promise<void> {
    this.model = await this.assets.instance('player');
    this.root.add(this.model.root);
    this.animator = new Animator(this.model.root, this.model.clips);
    await this.setStaff(staffKey);
  }

  async setStaff(key: ModelKey): Promise<void> {
    this.staff?.dispose();
    this.staff = null;
    this.staffMounted = false;
    const socket = this.model?.root.getObjectByName(STAFF_SOCKET);
    if (!socket) {
      console.warn('[player] no socket_staff node: staff not shown');
      return;
    }
    this.staff = await this.assets.instance(key);
    socket.add(this.staff.root);
    this.staffMounted = true;
  }

  /** Interpolate between the last two ticks and advance the animation. */
  update(e: Readonly<Entity>, alpha: number, dt: number): void {
    const { pos, prevPos, yaw, prevYaw } = e.tf;
    this.root.position.set(prevPos.x + (pos.x - prevPos.x) * alpha, prevPos.y + (pos.y - prevPos.y) * alpha, prevPos.z + (pos.z - prevPos.z) * alpha);
    this.root.rotation.y = lerpAngle(prevYaw, yaw, alpha);
    const loco = e.loco;
    this.animator?.update(dt, { grounded: loco?.grounded ?? true, speed: loco?.speed ?? 0, sprinting: loco?.sprinting ?? false });
  }

  dispose(): void {
    this.animator?.dispose();
    this.staff?.dispose();
    this.model?.dispose();
    this.root.removeFromParent();
  }
}
