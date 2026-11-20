/**
 * Lightweight FPS viewmodel attached to the camera when `CameraRig.mode === 'fps'`.
 * Hidden in third-person and sniper scope modes. Displays the equipped gun GLB (or a clean
 * procedural sidearm mesh for handgun / machinepistol) plus an optional dual-wield off-hand gun,
 * with damped recoil kickback, look sway, and walk bobbing.
 *
 * Reads only `ReadonlySimView` or plain visual state (never `SimWorld`).
 */
import * as THREE from 'three';
import type { AssetLoader, ModelInstance } from '../../assets/AssetLoader';
import { MODELS, type ModelKey } from '../../assets/manifest';
import type { CameraMode } from '../../camera/CameraRig';
import type { PlayerId } from '../../sim/entity';
import type { ReadonlySimView } from '../../sim/view';

export interface ViewmodelState {
  /** Current camera mode; viewmodel is visible only when `cameraMode === 'fps'`. */
  cameraMode: CameraMode;
  /** Equipped main-hand gun model id (e.g. `'gun_mg'`, `'gun_handgun'`, `'gun_machinepistol'`, or `null`). */
  gunModel: string | null;
  /** Optional left-hand gun model id when dual-wielding sidearms. */
  offhandGunModel?: string | null;
  /** Planar movement speed (m/s) for walk bobbing. */
  moveSpeed?: number;
  /** Whether the player is grounded (bobbing eases out in mid-air). */
  grounded?: boolean;
  /** True while reloading (tilts the weapon down). */
  reloading?: boolean;
  /** Frame look deltas (radians or normalized) driving weapon sway. */
  lookDx?: number;
  lookDy?: number;
}

interface RecoilSpring {
  z: number;
  vz: number;
  pitch: number;
  vpitch: number;
}

interface HandSlot {
  readonly pivot: THREE.Group;
  modelKey: string | null;
  request: number;
  instance: ModelInstance | null;
  procedural: THREE.Group | null;
  readonly recoil: RecoilSpring;
}

const RIGHT_REST = new THREE.Vector3(0.26, -0.22, -0.46);
const LEFT_REST = new THREE.Vector3(-0.26, -0.22, -0.46);

const RECOIL_STIFFNESS = 190;
const RECOIL_DAMPING = 18;
const MAX_RECOIL_Z = 0.14;
const MAX_RECOIL_PITCH = 0.32;
const SWAY_SHARPNESS = 12;
const MAX_SWAY = 0.045;
const RELOAD_DIP_RAD = -0.55;

const damp = (a: number, b: number, sharpness: number, dt: number): number =>
  a + (b - a) * (1 - Math.exp(-sharpness * dt));

function isModelKey(key: string): key is ModelKey {
  return Object.prototype.hasOwnProperty.call(MODELS, key);
}

function isSidearmKind(key: string): 'handgun' | 'machinepistol' | null {
  if (key === 'gun_handgun' || key === 'handgun') return 'handgun';
  if (key === 'gun_machinepistol' || key === 'machinepistol') return 'machinepistol';
  return null;
}

function configureViewmodelNode(root: THREE.Object3D): void {
  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (mesh.isMesh) {
      mesh.frustumCulled = false;
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      mesh.renderOrder = 2;
    }
  });
}

function disposeObjectResources(root: THREE.Object3D): void {
  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.geometry.dispose();
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const m of mats) m.dispose();
  });
}

/**
 * Clean stylized procedural sidearm mesh (barrel pointing along `-Z` in camera space, grip at origin).
 */
export function buildProceduralSidearm(kind: 'handgun' | 'machinepistol'): THREE.Group {
  const group = new THREE.Group();
  group.name = `procedural_${kind}`;

  const isMp = kind === 'machinepistol';
  const bodyMat = new THREE.MeshStandardMaterial({
    color: isMp ? 0x2d3540 : 0x3b424d,
    roughness: 0.45,
    metalness: 0.55,
  });
  const gripMat = new THREE.MeshStandardMaterial({
    color: 0x1b1e24,
    roughness: 0.85,
    metalness: 0.1,
  });
  const accentMat = new THREE.MeshStandardMaterial({
    color: isMp ? 0xe59424 : 0x7a8899,
    roughness: 0.35,
    metalness: 0.65,
  });

  // Slide / receiver
  const slideLen = isMp ? 0.28 : 0.22;
  const slideH = isMp ? 0.065 : 0.05;
  const slide = new THREE.Mesh(new THREE.BoxGeometry(0.044, slideH, slideLen), bodyMat);
  slide.position.set(0, 0.055, -slideLen * 0.42);
  group.add(slide);

  // Barrel
  const barrelLen = isMp ? 0.12 : 0.06;
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.011, 0.011, barrelLen, 8), accentMat);
  barrel.rotation.x = Math.PI / 2;
  barrel.position.set(0, 0.06, -slideLen * 0.92 - barrelLen * 0.35);
  group.add(barrel);

  // Grip
  const grip = new THREE.Mesh(new THREE.BoxGeometry(0.036, 0.11, 0.052), gripMat);
  grip.position.set(0, -0.01, 0.005);
  grip.rotation.x = 0.22;
  group.add(grip);

  // Extended magazine for machine pistol
  if (isMp) {
    const mag = new THREE.Mesh(new THREE.BoxGeometry(0.026, 0.14, 0.032), accentMat);
    mag.position.set(0, -0.075, -0.09);
    mag.rotation.x = 0.12;
    group.add(mag);
  }

  // Front sight
  const sight = new THREE.Mesh(new THREE.BoxGeometry(0.008, 0.012, 0.012), accentMat);
  sight.position.set(0, 0.055 + slideH * 0.5 + 0.006, -slideLen * 0.85);
  group.add(sight);

  const muzzle = new THREE.Object3D();
  muzzle.name = 'muzzle';
  muzzle.position.set(0, 0.06, -slideLen * 0.92 - barrelLen * 0.85);
  group.add(muzzle);

  configureViewmodelNode(group);
  return group;
}

export class Viewmodel {
  readonly root = new THREE.Group();
  private readonly rightHand: HandSlot;
  private readonly leftHand: HandSlot;
  private swayX = 0;
  private swayY = 0;
  private bobPhase = 0;
  private bobAmp = 0;
  private reloadDip = 0;

  constructor(
    private readonly camera: THREE.PerspectiveCamera,
    private readonly assets?: AssetLoader,
  ) {
    this.root.name = 'fps_viewmodel';
    this.root.visible = false;
    this.rightHand = this.createSlot('viewmodel_right');
    this.leftHand = this.createSlot('viewmodel_left');
    this.leftHand.pivot.visible = false;
    this.root.add(this.rightHand.pivot, this.leftHand.pivot);
    this.camera.add(this.root);
  }

  private createSlot(name: string): HandSlot {
    const pivot = new THREE.Group();
    pivot.name = name;
    return {
      pivot,
      modelKey: null,
      request: 0,
      instance: null,
      procedural: null,
      recoil: { z: 0, vz: 0, pitch: 0, vpitch: 0 },
    };
  }

  /** Trigger a recoil kick impulse on the right, left, or both hands. */
  kick(amount = 1, hand: 'right' | 'left' | 'both' = 'right'): void {
    const s = Math.max(0, amount);
    if (hand === 'right' || hand === 'both') {
      this.rightHand.recoil.vz += 1.4 * s;
      this.rightHand.recoil.vpitch += 3.2 * s;
    }
    if (hand === 'left' || hand === 'both') {
      this.leftHand.recoil.vz += 1.4 * s;
      this.leftHand.recoil.vpitch += 3.2 * s;
    }
  }

  /** Build a `ViewmodelState` snapshot from `ReadonlySimView` without importing `SimWorld`. */
  static stateFromView(
    view: ReadonlySimView,
    playerId: PlayerId,
    cameraMode: CameraMode,
    gunModel: string | null,
    offhandGunModel?: string | null,
    lookDx = 0,
    lookDy = 0,
    reloading = false,
  ): ViewmodelState {
    const player = view.playerEntity(playerId);
    return {
      cameraMode,
      gunModel,
      offhandGunModel,
      moveSpeed: player?.loco?.speed ?? 0,
      grounded: player?.loco?.grounded ?? true,
      reloading,
      lookDx,
      lookDy,
    };
  }

  private clearSlotVisual(slot: HandSlot): void {
    if (slot.instance) {
      slot.instance.root.removeFromParent();
      slot.instance.dispose();
      slot.instance = null;
    }
    if (slot.procedural) {
      slot.procedural.removeFromParent();
      disposeObjectResources(slot.procedural);
      slot.procedural = null;
    }
  }

  private syncSlot(slot: HandSlot, key: string | null, mirrorX: boolean): void {
    if (slot.modelKey === key) return;
    slot.modelKey = key;
    const req = ++slot.request;
    this.clearSlotVisual(slot);
    if (!key) {
      slot.pivot.visible = false;
      return;
    }
    slot.pivot.visible = true;

    const sidearm = isSidearmKind(key);
    if (sidearm || !this.assets || !isModelKey(key)) {
      const mesh = buildProceduralSidearm(sidearm ?? 'handgun');
      if (mirrorX) mesh.scale.x = -1;
      slot.procedural = mesh;
      slot.pivot.add(mesh);
      return;
    }

    void this.assets.instance(key, 'now').then((inst) => {
      if (req !== slot.request) {
        inst.dispose();
        return;
      }
      // Gun GLBs have grip at origin and barrel along +Z; rotate 180° around Y to point down -Z.
      inst.root.rotation.set(0, Math.PI, 0);
      inst.root.scale.set(mirrorX ? -0.55 : 0.55, 0.55, 0.55);
      configureViewmodelNode(inst.root);
      slot.instance = inst;
      slot.pivot.add(inst.root);
    });
  }

  private stepRecoil(spring: RecoilSpring, h: number): void {
    const decay = Math.exp(-RECOIL_DAMPING * h);
    spring.vz = (spring.vz - spring.z * RECOIL_STIFFNESS * h) * decay;
    spring.z = Math.max(-0.02, Math.min(MAX_RECOIL_Z, spring.z + spring.vz * h));
    spring.vpitch = (spring.vpitch - spring.pitch * RECOIL_STIFFNESS * h) * decay;
    spring.pitch = Math.max(-0.05, Math.min(MAX_RECOIL_PITCH, spring.pitch + spring.vpitch * h));
  }

  update(dt: number, state: ViewmodelState): void {
    const show = state.cameraMode === 'fps' && !!state.gunModel;
    this.root.visible = show;

    this.syncSlot(this.rightHand, state.gunModel, false);
    this.syncSlot(this.leftHand, state.offhandGunModel ?? null, true);

    const h = Math.min(Math.max(dt, 0), 1 / 30);
    this.stepRecoil(this.rightHand.recoil, h);
    this.stepRecoil(this.leftHand.recoil, h);

    if (!show) return;

    const targetSwayX = Math.max(-MAX_SWAY, Math.min(MAX_SWAY, -(state.lookDx ?? 0) * 0.6));
    const targetSwayY = Math.max(-MAX_SWAY, Math.min(MAX_SWAY, (state.lookDy ?? 0) * 0.6));
    this.swayX = damp(this.swayX, targetSwayX, SWAY_SHARPNESS, dt);
    this.swayY = damp(this.swayY, targetSwayY, SWAY_SHARPNESS, dt);

    const speed = state.grounded === false ? 0 : Math.min(1.4, (state.moveSpeed ?? 0) / 6);
    this.bobAmp = damp(this.bobAmp, speed, 10, dt);
    this.bobPhase += dt * (4.5 + speed * 5.5);
    const bobX = Math.cos(this.bobPhase) * 0.012 * this.bobAmp;
    const bobY = Math.abs(Math.sin(this.bobPhase)) * 0.016 * this.bobAmp;

    this.reloadDip = damp(this.reloadDip, state.reloading ? RELOAD_DIP_RAD : 0, 10, dt);

    this.applySlotTransform(this.rightHand, RIGHT_REST, bobX, bobY);
    if (this.leftHand.pivot.visible) {
      this.applySlotTransform(this.leftHand, LEFT_REST, -bobX, bobY);
    }
  }

  private applySlotTransform(slot: HandSlot, rest: THREE.Vector3, bobX: number, bobY: number): void {
    slot.pivot.position.set(
      rest.x + this.swayX + bobX,
      rest.y + this.swayY - bobY + this.reloadDip * 0.14,
      rest.z + slot.recoil.z,
    );
    slot.pivot.rotation.set(slot.recoil.pitch + this.reloadDip, -this.swayX * 1.4, this.swayX * 1.8);
  }

  dispose(): void {
    this.rightHand.request++;
    this.leftHand.request++;
    this.clearSlotVisual(this.rightHand);
    this.clearSlotVisual(this.leftHand);
    this.root.removeFromParent();
  }
}
