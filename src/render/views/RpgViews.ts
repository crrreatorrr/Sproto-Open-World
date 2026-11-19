import * as THREE from 'three';
import type { AssetLoader, ModelInstance } from '../../assets/AssetLoader';
import { MODELS, type ModelEntry, type ModelKey } from '../../assets/manifest';
import { ITEMS } from '../../content/items';
import { NPCS } from '../../content/npcs';
import { TICK_HZ } from '../../content/tuning';
import type { Entity } from '../../sim/entity';
import { Animator } from '../anim/Animator';
import { glowTexture } from '../fx/textures';
import type { PortalDraw } from '../portalShown';
import { GateLockView } from './BossViews';
import { drakeObjectView } from './DrakeViews';
import type { EntityView } from './EnemyViews';
import { placeEntity } from './interp';

/**
 * Views for the world objects (plan §5, M4): villagers, shrines, chests, pickups and one-use
 * objects. Villagers, shrines, chests and pickups are the imported models (manifest.ts); each shows
 * a greybox stand-in until its model arrives, and keeps it if the model is missing. None adds a
 * real light: a new light changes every lit material's shader and recompiles them all mid-play, so
 * the glows are emissive surfaces and additive sprites.
 */

/** Shared geometry, made on first use (one set for every view). */
let geo: Record<string, THREE.BufferGeometry> | null = null;
function shared(): Record<string, THREE.BufferGeometry> {
  if (geo) return geo;
  const heart = new THREE.Shape();
  heart.moveTo(0, -0.16);
  heart.bezierCurveTo(-0.05, -0.1, -0.2, -0.02, -0.2, 0.07);
  heart.bezierCurveTo(-0.2, 0.17, -0.08, 0.2, 0, 0.11);
  heart.bezierCurveTo(0.08, 0.2, 0.2, 0.17, 0.2, 0.07);
  heart.bezierCurveTo(0.2, -0.02, 0.05, -0.1, 0, -0.16);
  const heartGeo = new THREE.ExtrudeGeometry(heart, { depth: 0.08, bevelEnabled: true, bevelSize: 0.025, bevelThickness: 0.025, bevelSegments: 2 });
  heartGeo.center();
  geo = {
    head: new THREE.SphereGeometry(0.2, 16, 12),
    plinth: new THREE.CylinderGeometry(0.9, 1.05, 0.35, 8),
    stone: new THREE.CylinderGeometry(0.28, 0.42, 1.7, 6),
    crystal: new THREE.OctahedronGeometry(0.22, 0),
    ring: new THREE.RingGeometry(1.1, 1.35, 40),
    chestBase: new THREE.BoxGeometry(0.9, 0.5, 0.6),
    chestLid: new THREE.BoxGeometry(0.94, 0.16, 0.64),
    band: new THREE.BoxGeometry(0.96, 0.08, 0.66),
    gem: new THREE.OctahedronGeometry(0.16, 0),
    heart: heartGeo,
    item: new THREE.BoxGeometry(0.26, 0.26, 0.26),
    // Objects: the lever's base, arm and knob; the tome's stand, cover and pages; the beacon's flame.
    leverBase: new THREE.BoxGeometry(0.7, 0.3, 0.5),
    leverArm: new THREE.CylinderGeometry(0.04, 0.05, 1.0, 8).translate(0, 0.5, 0),
    knob: new THREE.SphereGeometry(0.1, 12, 8),
    post: new THREE.CylinderGeometry(0.06, 0.09, 1.0, 8),
    standTop: new THREE.BoxGeometry(0.55, 0.05, 0.4),
    cover: new THREE.BoxGeometry(0.42, 0.06, 0.3),
    pages: new THREE.BoxGeometry(0.38, 0.05, 0.27),
    flame: new THREE.OctahedronGeometry(0.28, 1),
  };
  return geo;
}

function mesh(g: THREE.BufferGeometry, m: THREE.Material, y = 0): THREE.Mesh {
  const out = new THREE.Mesh(g, m);
  out.position.y = y;
  out.castShadow = true;
  out.receiveShadow = true;
  return out;
}

function glowSprite(color: number, size: number, opacity: number): THREE.Sprite {
  const mat = new THREE.SpriteMaterial({ map: glowTexture(), color, transparent: true, opacity, depthWrite: false, blending: THREE.AdditiveBlending });
  const s = new THREE.Sprite(mat);
  s.scale.setScalar(size);
  return s;
}

/** A name over a villager's head: a canvas texture on a sprite that always faces the camera. */
function nameTag(text: string): THREE.Sprite {
  const c = document.createElement('canvas');
  const g = c.getContext('2d')!;
  const font = '600 40px ui-rounded, system-ui, sans-serif';
  g.font = font;
  const w = Math.ceil(g.measureText(text).width) + 40;
  c.width = w;
  c.height = 64;
  g.font = font;
  g.fillStyle = 'rgba(16, 22, 12, 0.6)';
  g.beginPath();
  g.roundRect(0, 4, w, 56, 26);
  g.fill();
  g.fillStyle = '#fdf8ec';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, w / 2, 33);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
  const h = 0.26;
  s.scale.set((h * w) / 64, h, 1);
  return s;
}

function disposeSprite(s: THREE.Sprite): void {
  const m = s.material;
  if (m.map && m.map !== glowTexture()) m.map.dispose();
  m.dispose();
}

const isModelKey = (k: string): k is ModelKey => Object.prototype.hasOwnProperty.call(MODELS, k);

/**
 * Load a model instance for a view and hand it over once, unless the view was disposed first (then
 * it goes straight back). `use` gets only real models: a missing file keeps the view's greybox.
 */
class ModelSlot {
  model: ModelInstance | null = null;
  private disposed = false;

  constructor(assets: AssetLoader | null, key: string, use: (m: ModelInstance) => void) {
    if (!assets || !isModelKey(key)) return;
    void assets.instance(key).then((m) => {
      if (this.disposed || !m.real) {
        m.dispose();
        return;
      }
      this.model = m;
      use(m);
    });
  }

  dispose(): void {
    this.disposed = true;
    this.model?.dispose();
    this.model = null;
  }
}

/**
 * Give a model instance its own copies of the materials `pick` selects (shared templates must not
 * change for every instance), returning the copies so the view can drive and dispose them.
 */
function ownMaterials(root: THREE.Object3D, pick: (m: THREE.Material) => boolean = () => true): THREE.MeshStandardMaterial[] {
  const out: THREE.MeshStandardMaterial[] = [];
  const copies = new Map<THREE.Material, THREE.MeshStandardMaterial>();
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const swap = (m: THREE.Material): THREE.Material => {
      if (!pick(m) || !(m as THREE.MeshStandardMaterial).isMeshStandardMaterial) return m;
      let c = copies.get(m);
      if (!c) {
        c = (m as THREE.MeshStandardMaterial).clone();
        copies.set(m, c);
        out.push(c);
      }
      return c;
    };
    mesh.material = Array.isArray(mesh.material) ? mesh.material.map(swap) : swap(mesh.material);
  });
  return out;
}

/** Robe colours for the placeholder villagers, picked per NPC id so each reads apart. */
const NPC_ROBES = [0x8a5a3a, 0x3d6b3a, 0x5a4a8a, 0x8a3a4a, 0x3a5a7a];
/** Model tints by key (an entity's `view.tint` wins): the Miller is the Trader's Pepe, flour-dusted. */
export const NPC_TINTS: Record<string, number> = { npc_miller: 0xe0b070, npc_watch: 0xa8b8d8, npc_ranger: 0x9fc27a, npc_weaver: 0xd8a8c8, npc_miner: 0xb8a48c };

/**
 * A villager (plan §6): the NPC's model (manifest `npc_*`), standing on the ground, facing its yaw,
 * playing its idle (or breathing, if the model has none), with a name tag. An unknown key keeps the
 * greybox: a robed capsule and a head.
 */
export class NpcView implements EntityView {
  readonly root = new THREE.Group();
  readonly height: number;
  private readonly mats: THREE.Material[] = [];
  private readonly body: THREE.CapsuleGeometry;
  private readonly tag: THREE.Sprite;
  private bob = Math.random() * 10;
  private readonly greybox = new THREE.Group();
  private readonly upper = new THREE.Group();
  private readonly slot: ModelSlot;
  private animator: Animator | null = null;
  /** The model's holder (scaled to the body), breathing when there is no idle clip. */
  private holder: THREE.Object3D | null = null;
  private breathe = false;

  constructor(e: Readonly<Entity>, assets: AssetLoader | null = null) {
    const id = e.npc?.id ?? '';
    const def = NPCS[id];
    const r = e.body?.radius ?? def?.body.radius ?? 0.4;
    const h = e.body?.height ?? def?.body.height ?? 1.8;
    this.height = h;
    let hash = 0;
    for (const ch of id) hash = (hash * 31 + ch.charCodeAt(0)) | 0;
    const robe = new THREE.MeshStandardMaterial({ color: NPC_ROBES[Math.abs(hash) % NPC_ROBES.length], roughness: 0.9 });
    const skin = new THREE.MeshStandardMaterial({ color: 0x8fc46a, roughness: 0.7 });
    this.mats.push(robe, skin);
    const bodyH = h - 0.42;
    this.body = new THREE.CapsuleGeometry(r * 0.85, Math.max(0.01, bodyH - 2 * r * 0.85), 4, 12);
    const bodyMesh = mesh(this.body, robe, bodyH / 2);
    const head = mesh(shared().head, skin, h - 0.2);
    // A nose, so you can tell which way they face.
    const nose = mesh(shared().head, skin, h - 0.22);
    nose.scale.setScalar(0.3);
    nose.position.z = 0.2;
    this.upper.add(head, nose);
    this.greybox.add(bodyMesh, this.upper);
    this.tag = nameTag(def?.name ?? id);
    this.tag.position.y = h + 0.32;
    this.root.add(this.greybox, this.tag);

    const key = e.view.model;
    const tint = e.view.tint ?? NPC_TINTS[key];
    this.slot = new ModelSlot(assets, key, (m) => {
      const fit = (MODELS[key as ModelKey] as ModelEntry).fitHeight;
      if (fit) m.root.scale.multiplyScalar(h / fit);
      if (tint !== undefined) {
        const t = new THREE.Color(tint);
        for (const mat of ownMaterials(m.root)) {
          mat.color.multiply(t);
          this.mats.push(mat);
        }
      }
      this.greybox.visible = false;
      this.root.add(m.root);
      this.holder = m.root;
      const anim = new Animator(m.root, m.clips);
      if (anim.has('idle')) {
        anim.loop('idle', 0.9 + 0.2 * Math.random(), 0);
        // Out of step with the other villagers.
        anim.update(Math.random() * anim.duration('idle'));
        this.animator = anim;
      } else {
        anim.dispose();
        this.breathe = true;
      }
    });
  }

  update(e: Readonly<Entity>, alpha: number, dt: number): void {
    placeEntity(this.root, e, alpha);
    this.bob += dt;
    if (this.animator) this.animator.update(dt);
    else if (this.breathe && this.holder) this.holder.scale.y = this.holder.scale.x * (1 + 0.012 * Math.sin(this.bob * 1.9));
    // The greybox's slow idle nod, so it reads as alive.
    else this.upper.rotation.x = Math.sin(this.bob * 1.3) * 0.04;
  }

  dispose(): void {
    this.animator?.dispose();
    this.slot.dispose();
    this.body.dispose();
    for (const m of this.mats) m.dispose();
    disposeSprite(this.tag);
    this.root.removeFromParent();
  }
}

/** The shrine model's glowing parts (sproto-shooter's `campaign_glow_signal`). */
const SHRINE_GLOW = /glow/i;
/** The shrine model's crystal: its `shrine_focus` node floats at 2.06 m. */
const SHRINE_FOCUS_Y = 2.06;

/**
 * A shrine (plan §5): sproto-shooter's campaign shrine (a plinth and a floating crystal with its own
 * clip), with a ground ring and a soft glow. Dim until the player has found it, bright once
 * discovered; a pulse when someone rests. The greybox (a standing stone) stands in until it loads.
 */
export class ShrineView implements EntityView {
  readonly root = new THREE.Group();
  readonly height = 2.5;
  private readonly crystal: THREE.Mesh;
  private readonly crystalMat: THREE.MeshStandardMaterial;
  private readonly stoneMat: THREE.MeshStandardMaterial;
  private readonly ringMat: THREE.MeshBasicMaterial;
  private readonly glow: THREE.Sprite;
  private readonly greybox = new THREE.Group();
  private readonly slot: ModelSlot;
  /** The model's own glow materials, driven like the greybox crystal. */
  private glowMats: THREE.MeshStandardMaterial[] = [];
  private mixer: THREE.AnimationMixer | null = null;
  private lit = 0;
  private pulse = 0;
  private t = Math.random() * 10;

  /** `discovered` is the shared set WorldViews keeps from the local player's progress. */
  constructor(private readonly id: string, private readonly discovered: ReadonlySet<string>, assets: AssetLoader | null = null) {
    const g = shared();
    this.stoneMat = new THREE.MeshStandardMaterial({ color: 0x8c8a80, roughness: 0.95, emissive: 0x2a6a8a, emissiveIntensity: 0 });
    this.crystalMat = new THREE.MeshStandardMaterial({ color: 0xbff4ff, roughness: 0.2, emissive: 0x6fdcff, emissiveIntensity: 0.4 });
    this.ringMat = new THREE.MeshBasicMaterial({ color: 0x8fe8ff, transparent: true, opacity: 0.15, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
    const plinth = mesh(g.plinth, this.stoneMat, 0.17);
    const stone = mesh(g.stone, this.stoneMat, 0.35 + 0.85);
    this.crystal = mesh(g.crystal, this.crystalMat, 2.25);
    this.crystal.castShadow = false;
    this.greybox.add(plinth, stone, this.crystal);
    const ring = new THREE.Mesh(g.ring, this.ringMat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.05;
    this.glow = glowSprite(0x8fe8ff, 1.6, 0.3);
    this.glow.position.y = 2.25;
    this.root.add(this.greybox, ring, this.glow);
    this.slot = new ModelSlot(assets, 'shrine', (m) => {
      this.glowMats = ownMaterials(m.root, (mat) => SHRINE_GLOW.test(mat.name));
      this.greybox.visible = false;
      this.glow.position.y = SHRINE_FOCUS_Y;
      this.root.add(m.root);
      if (m.clips.length) {
        this.mixer = new THREE.AnimationMixer(m.root);
        for (const c of m.clips) this.mixer.clipAction(c).play();
        this.mixer.update(Math.random() * 5);
      }
    });
  }

  /** Someone rested here: a bright pulse. */
  rested(): void {
    this.pulse = 1;
  }

  update(e: Readonly<Entity>, alpha: number, dt: number): void {
    placeEntity(this.root, e, alpha);
    this.t += dt;
    const target = this.discovered.has(this.id) ? 1 : 0;
    this.lit += (target - this.lit) * (1 - Math.exp(-3 * dt));
    this.pulse = Math.max(0, this.pulse - dt * 0.8);
    const breathe = 0.5 + 0.5 * Math.sin(this.t * 1.6);
    const k = 0.25 + 0.75 * this.lit;
    this.crystalMat.emissiveIntensity = 0.3 + 1.4 * k + this.pulse * 2;
    this.stoneMat.emissiveIntensity = 0.25 * this.lit * (0.6 + 0.4 * breathe) + this.pulse * 0.6;
    // The model's glow: nearly dark until found (it reads as a shrine still), bright once found.
    for (const m of this.glowMats) m.emissiveIntensity = 0.15 + 1.1 * this.lit * (0.8 + 0.2 * breathe) + this.pulse * 2;
    this.ringMat.opacity = 0.08 + 0.3 * this.lit * (0.7 + 0.3 * breathe) + this.pulse * 0.5;
    this.glow.material.opacity = 0.18 + 0.45 * k + this.pulse * 0.6;
    this.glow.scale.setScalar(1.3 + 1.2 * k + this.pulse * 2.5);
    this.crystal.position.y = 2.25 + Math.sin(this.t * 1.2) * 0.08;
    this.crystal.rotation.y += dt * (0.4 + 0.8 * this.lit);
    // The crystal spins faster once the shrine is found.
    this.mixer?.update(dt * (0.5 + 0.8 * this.lit + this.pulse));
  }

  dispose(): void {
    this.mixer?.stopAllAction();
    this.slot.dispose();
    this.stoneMat.dispose();
    this.crystalMat.dispose();
    this.ringMat.dispose();
    for (const m of this.glowMats) m.dispose();
    disposeSprite(this.glow);
    this.root.removeFromParent();
  }
}

/** The chest model's lid node (the importer splits it off, its origin on the hinge). */
const CHEST_LID = 'chest_lid';

/**
 * A chest (plan §5): sproto-shooter's chest, its lid swinging open on the back hinge once it is
 * used; unopened chests twinkle. The greybox (wood and iron bands) stands in until it loads.
 */
export class ChestView implements EntityView {
  readonly root = new THREE.Group();
  readonly height = 0.9;
  private lid: THREE.Object3D = new THREE.Group();
  private readonly mats: THREE.Material[];
  private readonly glint: THREE.Sprite;
  private readonly greybox = new THREE.Group();
  private readonly slot: ModelSlot;
  private open = 0;
  private t = 0;
  /** Quest shimmer 0..1, or null for the chest's own twinkle. */
  private clue: number | null = null;

  constructor(assets: AssetLoader | null = null) {
    const g = shared();
    const wood = new THREE.MeshStandardMaterial({ color: 0x7a4a26, roughness: 0.85 });
    const iron = new THREE.MeshStandardMaterial({ color: 0x5a5a60, roughness: 0.5, metalness: 0.6 });
    this.mats = [wood, iron];
    const base = mesh(g.chestBase, wood, 0.25);
    const band = mesh(g.band, iron, 0.42);
    // The hinge runs along the back edge (−z is the back; the chest faces +z like everything else).
    this.lid.position.set(0, 0.5, -0.32);
    const top = mesh(g.chestLid, wood, 0.08);
    top.position.z = 0.32;
    const lidBand = mesh(g.band, iron, 0.08);
    lidBand.scale.set(1, 0.6, 1);
    lidBand.position.z = 0.32;
    this.lid.add(top, lidBand);
    this.greybox.add(base, band, this.lid);
    this.glint = glowSprite(0xffe08a, 0.9, 0.5);
    this.glint.position.y = 0.75;
    this.root.add(this.greybox, this.glint);
    this.slot = new ModelSlot(assets, 'chest', (m) => {
      const lid = m.root.getObjectByName(CHEST_LID);
      if (!lid) {
        // An older chest without a split lid: keep the greybox, which can open.
        m.dispose();
        return;
      }
      this.lid = lid;
      this.greybox.visible = false;
      this.root.add(m.root);
    });
  }

  update(e: Readonly<Entity>, alpha: number, dt: number): void {
    placeEntity(this.root, e, alpha);
    this.t += dt;
    const used = e.interactable?.used ?? false;
    this.open += ((used ? 1 : 0) - this.open) * (1 - Math.exp(-6 * dt));
    this.lid.rotation.x = -this.open * 1.9;
    // Unopened chests twinkle so they read from across the yard. A relic chest on a search
    // shimmers only as strongly as the quest asked (nothing past its radius).
    const pulse = 0.3 + 0.25 * Math.sin(this.t * 3);
    if (this.clue === null) {
      this.glint.visible = this.open < 0.95;
      this.glint.material.opacity = (1 - this.open) * pulse;
    } else {
      this.glint.visible = this.clue > 0.04 && this.open < 0.95;
      this.glint.material.opacity = this.clue * (0.35 + pulse);
    }
  }

  shimmer(strength: number | null): void {
    this.clue = strength;
  }

  dispose(): void {
    this.slot.dispose();
    for (const m of this.mats) m.dispose();
    disposeSprite(this.glint);
    this.root.removeFromParent();
  }
}

/** Pickup colours (the greybox and the glow): Sprouts are green gems, hearts red, items gold. */
const PICKUP_LOOK = {
  sprouts: { color: 0x5fe06a, emissive: 0x1f8a2a, glow: 0x8fff8a },
  heart: { color: 0xff4a5a, emissive: 0x8a0a1a, glow: 0xff8a8a },
  item: { color: 0xf2c230, emissive: 0x6a4a00, glow: 0xffe08a },
  rivet: { color: 0xffd36a, emissive: 0xff9a2a, glow: 0xffe08a },
  tonic: { color: 0x6fd0ff, emissive: 0x0a4a6a, glow: 0x9fe8ff },
} as const;
/** The models for each look, and the size (m, largest side) they are drawn at. */
const PICKUP_MODEL: Partial<Record<keyof typeof PICKUP_LOOK, { key: ModelKey; size: number }>> = {
  sprouts: { key: 'pickup_gem', size: 0.36 },
  heart: { key: 'pickup_heart', size: 0.42 },
  tonic: { key: 'pickup_potion', size: 0.44 },
};
/** The last seconds of a pickup's life blink (it is about to go). */
const BLINK_TICKS = 2 * TICK_HZ;

/** Which look a pickup has: consumables (the tonic flask) are potions; other items the gold box. */
function pickupLook(e: Readonly<Entity>): keyof typeof PICKUP_LOOK {
  const p = e.pickup;
  if (!p || p.kind !== 'item') return p?.kind ?? 'item';
  if (p.item === 'rivet') return 'rivet';
  const item = p.item ? ITEMS[p.item] : undefined;
  return item?.kind === 'consumable' || p.item?.includes('tonic') ? 'tonic' : 'item';
}

/** Model bounds per key, measured once: the pickup is centred on its middle and scaled to size. */
const pickupBounds = new Map<string, THREE.Box3>();

/** Something on the ground to walk over (plan §5): a spinning, bobbing gem, heart, potion or box. */
export class PickupView implements EntityView {
  readonly root = new THREE.Group();
  readonly height = 0.6;
  /** The spinning, bobbing part (the greybox mesh or the model). */
  private readonly spin = new THREE.Group();
  private readonly item: THREE.Mesh;
  private readonly mat: THREE.MeshStandardMaterial;
  private readonly glow: THREE.Sprite;
  private readonly slot: ModelSlot;
  private readonly modelMats: THREE.Material[] = [];
  private t = Math.random() * 10;

  constructor(e: Readonly<Entity>, assets: AssetLoader | null = null) {
    const kind = e.pickup?.kind ?? 'item';
    const lookKey = pickupLook(e);
    const look = PICKUP_LOOK[lookKey];
    const g = shared();
    this.mat = new THREE.MeshStandardMaterial({ color: look.color, emissive: look.emissive, emissiveIntensity: 0.9, roughness: 0.25, metalness: kind === 'heart' ? 0 : 0.3 });
    this.item = mesh(kind === 'sprouts' ? g.gem : kind === 'heart' ? g.heart : g.item, this.mat);
    const big = kind === 'sprouts' && (e.pickup?.amount ?? 1) >= 5;
    if (big) this.spin.scale.setScalar(1.35);
    this.spin.position.y = 0.45;
    this.spin.add(this.item);
    this.glow = glowSprite(look.glow, 0.8, 0.45);
    this.glow.position.y = 0.45;
    this.root.add(this.spin, this.glow);
    const model = PICKUP_MODEL[lookKey];
    this.slot = new ModelSlot(assets, model?.key ?? '', (m) => {
      let box = pickupBounds.get(model!.key);
      if (!box) {
        box = new THREE.Box3().setFromObject(m.root);
        pickupBounds.set(model!.key, box);
      }
      const size = box.getSize(new THREE.Vector3());
      const s = model!.size / Math.max(size.x, size.y, size.z, 1e-3);
      const c = box.getCenter(new THREE.Vector3());
      m.root.scale.setScalar(s);
      m.root.position.set(-c.x * s, -c.y * s, -c.z * s);
      m.root.traverse((o) => {
        if ((o as THREE.Mesh).isMesh) o.castShadow = false;
      });
      // The kit's pickups are white where the game colours them (the shooter tints them too).
      for (const mat of ownMaterials(m.root)) {
        mat.color.setHex(look.color);
        mat.emissive.setHex(look.emissive);
        mat.emissiveIntensity = 0.6;
        this.modelMats.push(mat);
      }
      this.item.visible = false;
      this.spin.add(m.root);
    });
  }

  update(e: Readonly<Entity>, alpha: number, dt: number): void {
    placeEntity(this.root, e, alpha);
    this.t += dt;
    this.spin.position.y = 0.45 + Math.sin(this.t * 2.6) * 0.07;
    this.spin.rotation.y = this.t * 2.2;
    this.glow.position.y = this.spin.position.y;
    const life = e.pickup?.life ?? Infinity;
    this.root.visible = life > BLINK_TICKS || Math.floor(this.t * 8) % 2 === 0;
  }

  dispose(): void {
    this.slot.dispose();
    this.mat.dispose();
    for (const m of this.modelMats) m.dispose();
    disposeSprite(this.glow);
    this.root.removeFromParent();
  }
}

/** Ease a 0..1 state toward `used` (the sim flips it in one tick; views swing over a few frames). */
function easeUsed(cur: number, used: boolean, rate: number, dt: number): number {
  return cur + ((used ? 1 : 0) - cur) * (1 - Math.exp(-rate * dt));
}

/**
 * The Watchtower beacon (an `object` interactable, model `beacon`): it sits on the static
 * `frost_beacon` landmark prop (scale 2), so it draws nothing of its own until it is lit; then a
 * flame and a warm glow burn on the prop's lens. The entity settles onto the prop's collider, so its
 * origin is already the top of the prop, about 4 m up.
 */
export class BeaconView implements EntityView {
  readonly root = new THREE.Group();
  readonly height = 0.8;
  private readonly fire = new THREE.Group();
  private readonly flame: THREE.Mesh;
  private readonly flameMat = new THREE.MeshBasicMaterial({ color: 0xffb04a, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending });
  private readonly glow = glowSprite(0xffa040, 3.2, 0);
  private readonly core = glowSprite(0xfff0c0, 1.2, 0);
  private lit = 0;
  private t = Math.random() * 10;

  constructor() {
    this.flame = new THREE.Mesh(shared().flame, this.flameMat);
    this.flame.scale.set(1, 1.6, 1);
    this.fire.position.y = 0.4;
    this.fire.add(this.flame, this.glow, this.core);
    this.fire.visible = false;
    this.root.add(this.fire);
  }

  update(e: Readonly<Entity>, alpha: number, dt: number): void {
    placeEntity(this.root, e, alpha);
    this.t += dt;
    this.lit = easeUsed(this.lit, e.interactable?.used ?? false, 2, dt);
    this.fire.visible = this.lit > 0.01;
    if (!this.fire.visible) return;
    const flicker = 0.85 + 0.1 * Math.sin(this.t * 13) + 0.05 * Math.sin(this.t * 29);
    this.flameMat.opacity = 0.75 * this.lit * flicker;
    this.flame.scale.set(flicker, 1.6 * (0.9 + 0.2 * Math.sin(this.t * 9)), flicker);
    this.flame.rotation.y += dt * 2;
    this.glow.material.opacity = 0.55 * this.lit * flicker;
    this.glow.scale.setScalar(3.2 * this.lit * flicker);
    this.core.material.opacity = 0.8 * this.lit;
  }

  dispose(): void {
    this.flameMat.dispose();
    disposeSprite(this.glow);
    disposeSprite(this.core);
    this.root.removeFromParent();
  }
}

/** A lever (an `object` interactable, model `lever`): greybox, thrown from back to front when used. */
export class LeverView implements EntityView {
  readonly root = new THREE.Group();
  readonly height = 1.2;
  private readonly arm = new THREE.Group();
  private readonly mats: THREE.Material[];
  private readonly glint = glowSprite(0xffe08a, 0.6, 0.4);
  private thrown = 0;
  private t = 0;

  constructor() {
    const g = shared();
    const wood = new THREE.MeshStandardMaterial({ color: 0x6b4a2b, roughness: 0.9 });
    const iron = new THREE.MeshStandardMaterial({ color: 0x5a5a60, roughness: 0.5, metalness: 0.6 });
    const paint = new THREE.MeshStandardMaterial({ color: 0xc8402e, roughness: 0.6 });
    this.mats = [wood, iron, paint];
    this.arm.position.y = 0.3;
    const knob = mesh(g.knob, paint, 1.0);
    this.arm.add(mesh(g.leverArm, iron), knob);
    this.root.add(mesh(g.leverBase, wood, 0.15), this.arm, this.glint);
  }

  update(e: Readonly<Entity>, alpha: number, dt: number): void {
    placeEntity(this.root, e, alpha);
    this.t += dt;
    this.thrown = easeUsed(this.thrown, e.interactable?.used ?? false, 7, dt);
    // Leans back (away from the player who walks up to its front) until pulled forward.
    this.arm.rotation.x = -0.6 + 1.2 * this.thrown;
    this.glint.visible = this.thrown < 0.95;
    this.glint.position.set(0, 0.3 + Math.cos(this.arm.rotation.x), Math.sin(this.arm.rotation.x));
    this.glint.material.opacity = (1 - this.thrown) * (0.25 + 0.2 * Math.sin(this.t * 3));
  }

  dispose(): void {
    for (const m of this.mats) m.dispose();
    disposeSprite(this.glint);
    this.root.removeFromParent();
  }
}

/**
 * A tome on a stand (an `object` interactable, model `tome`; the Frost Nova tome): greybox, its
 * cover glowing frost-blue with a soft glow over it. Read, it closes and goes dark.
 */
export class TomeView implements EntityView {
  readonly root = new THREE.Group();
  readonly height = 1.3;
  private readonly book = new THREE.Group();
  private readonly coverMat = new THREE.MeshStandardMaterial({ color: 0x3a6aa8, roughness: 0.6, emissive: 0x4fb8ff, emissiveIntensity: 0.8 });
  private readonly mats: THREE.Material[];
  private readonly glow = glowSprite(0x9fe0ff, 1.2, 0.4);
  private read = 0;
  private t = Math.random() * 10;

  constructor() {
    const g = shared();
    const wood = new THREE.MeshStandardMaterial({ color: 0x6b4a2b, roughness: 0.9 });
    const paper = new THREE.MeshStandardMaterial({ color: 0xf0e6cc, roughness: 0.9, emissive: 0x9fe0ff, emissiveIntensity: 0.3 });
    this.mats = [wood, paper, this.coverMat];
    const top = mesh(g.standTop, wood, 1.02);
    top.rotation.x = 0.35;
    this.book.position.set(0, 1.09, 0);
    this.book.rotation.x = 0.35;
    this.book.add(mesh(g.cover, this.coverMat), mesh(g.pages, paper, 0.05));
    this.glow.position.y = 1.35;
    this.root.add(mesh(g.post, wood, 0.5), top, this.book, this.glow);
  }

  update(e: Readonly<Entity>, alpha: number, dt: number): void {
    placeEntity(this.root, e, alpha);
    this.t += dt;
    this.read = easeUsed(this.read, e.interactable?.used ?? false, 3, dt);
    const pulse = 0.75 + 0.25 * Math.sin(this.t * 2.2);
    const on = 1 - this.read;
    this.coverMat.emissiveIntensity = 0.05 + 0.9 * on * pulse;
    (this.mats[1] as THREE.MeshStandardMaterial).emissiveIntensity = 0.3 * on;
    this.glow.visible = on > 0.02;
    this.glow.material.opacity = 0.45 * on * pulse;
    this.glow.position.y = 1.35 + Math.sin(this.t * 1.5) * 0.05;
  }

  dispose(): void {
    for (const m of this.mats) m.dispose();
    disposeSprite(this.glow);
    this.root.removeFromParent();
  }
}

/** Shared across every mouth. Not disposed with a view: the next mouth still uses them. */
let portalGeo: { opening: THREE.BoxGeometry; column: THREE.CylinderGeometry } | null = null;
function portalGeometry(): { opening: THREE.BoxGeometry; column: THREE.CylinderGeometry } {
  portalGeo ??= {
    opening: new THREE.BoxGeometry(1.6, 2.4, 0.16),
    column: new THREE.CylinderGeometry(0.42, 0.55, 2.5, 6),
  };
  return portalGeo;
}

const MOTE_COUNT = 6;

/**
 * A hidden entrance, built from code (no model file). Sealed mouths never get one. The main door
 * shows faint green motes until it is opened, then a flat near-black gap 1.6 m wide and 2.4 m tall.
 * A cave mouth is a dark stone column. `show` follows the flags each frame.
 */
export class PortalView implements EntityView {
  readonly root = new THREE.Group();
  readonly height = 2.4;
  private opening: THREE.Mesh | null = null;
  private column: THREE.Mesh | null = null;
  private motes: THREE.Group | null = null;
  private readonly moteY: number[] = [];
  private mode: PortalDraw = 'opening';
  private t = 0;

  show(mode: PortalDraw): void {
    this.mode = mode;
    if (mode === 'opening' && !this.opening) {
      const mat = new THREE.MeshStandardMaterial({ color: 0x07080c, roughness: 1, metalness: 0 });
      this.opening = new THREE.Mesh(portalGeometry().opening, mat);
      this.opening.position.y = 1.2;
      this.opening.castShadow = false;
      this.opening.receiveShadow = true;
      this.root.add(this.opening);
    }
    if (mode === 'column' && !this.column) {
      const mat = new THREE.MeshStandardMaterial({ color: 0x3a424c, roughness: 0.95, metalness: 0 });
      this.column = new THREE.Mesh(portalGeometry().column, mat);
      this.column.position.y = 1.25;
      this.column.castShadow = true;
      this.column.receiveShadow = true;
      this.root.add(this.column);
    }
    if (mode === 'motes' && !this.motes) {
      this.motes = new THREE.Group();
      for (let i = 0; i < MOTE_COUNT; i++) {
        const mat = new THREE.SpriteMaterial({
          map: glowTexture(), color: 0xb8ffc4, transparent: true, opacity: 0.72,
          depthWrite: false, blending: THREE.AdditiveBlending,
        });
        const s = new THREE.Sprite(mat);
        const a = (i / MOTE_COUNT) * Math.PI * 2;
        const y = 0.9 + (i % 3) * 0.5;
        // Local −z is the side the player walks in from (the mouth's yaw faces the wall).
        s.position.set(Math.cos(a) * 0.55, y, -0.7 + Math.sin(a) * 0.2);
        s.scale.setScalar(0.48 + (i % 2) * 0.18);
        this.moteY.push(y);
        this.motes.add(s);
      }
      this.root.add(this.motes);
    }
    if (this.opening) this.opening.visible = mode === 'opening';
    if (this.column) this.column.visible = mode === 'column';
    if (this.motes) this.motes.visible = mode === 'motes';
  }

  update(e: Readonly<Entity>, alpha: number, dt: number): void {
    placeEntity(this.root, e, alpha);
    if (this.mode !== 'motes' || !this.motes) return;
    this.t += dt;
    const sprites = this.motes.children;
    for (let i = 0; i < sprites.length; i++) sprites[i].position.y = this.moteY[i] + Math.sin(this.t * 1.7 + i * 1.3) * 0.16;
  }

  dispose(): void {
    (this.opening?.material as THREE.Material | undefined)?.dispose();
    (this.column?.material as THREE.Material | undefined)?.dispose();
    if (this.motes) for (const s of this.motes.children) (s as THREE.Sprite).material.dispose();
    this.root.removeFromParent();
  }
}

/** An `object` interactable's view by its model key (beacon, lever, tome; anything else reads as a tome). */
export function objectView(model: string): EntityView {
  const drakeQuest = drakeObjectView(model);
  if (drakeQuest) return drakeQuest;
  if (model === 'beacon') return new BeaconView();
  if (model === 'lever') return new LeverView();
  if (model === 'gate_lock') return new GateLockView();
  return new TomeView();
}
