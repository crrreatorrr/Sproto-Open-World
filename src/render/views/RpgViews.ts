import * as THREE from 'three';
import { NPCS } from '../../content/npcs';
import { TICK_HZ } from '../../content/tuning';
import type { Entity } from '../../sim/entity';
import { glowTexture } from '../fx/textures';
import type { EntityView } from './EnemyViews';
import { placeEntity } from './interp';

/**
 * Greybox views for the M3 world objects (plan §5): villagers, shrines, chests and pickups. They
 * stand in until M4 brings the Pepe models and props. None adds a real light: a new light changes
 * every lit material's shader and recompiles them all mid-play, so the glows are emissive
 * surfaces and additive sprites.
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

/** Robe colours for the placeholder villagers, picked per NPC id so each reads apart. */
const NPC_ROBES = [0x8a5a3a, 0x3d6b3a, 0x5a4a8a, 0x8a3a4a, 0x3a5a7a];

/** A villager (plan §6): a robed capsule, a head and a name tag. Placeholder until M4's Pepes. */
export class NpcView implements EntityView {
  readonly root = new THREE.Group();
  readonly height: number;
  private readonly mats: THREE.Material[] = [];
  private readonly body: THREE.CapsuleGeometry;
  private readonly tag: THREE.Sprite;
  private bob = Math.random() * 10;
  private readonly upper = new THREE.Group();

  constructor(e: Readonly<Entity>) {
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
    this.tag = nameTag(def?.name ?? id);
    this.tag.position.y = h + 0.32;
    this.root.add(bodyMesh, this.upper, this.tag);
  }

  update(e: Readonly<Entity>, alpha: number, dt: number): void {
    placeEntity(this.root, e, alpha);
    // A slow idle nod, so they read as alive.
    this.bob += dt;
    this.upper.rotation.x = Math.sin(this.bob * 1.3) * 0.04;
  }

  dispose(): void {
    this.body.dispose();
    for (const m of this.mats) m.dispose();
    disposeSprite(this.tag);
    this.root.removeFromParent();
  }
}

/**
 * A shrine (plan §5): a standing stone on a plinth with a floating crystal and a soft glow. Dim
 * until the player has found it, bright once discovered; a pulse when someone rests.
 */
export class ShrineView implements EntityView {
  readonly root = new THREE.Group();
  readonly height = 2.2;
  private readonly crystal: THREE.Mesh;
  private readonly crystalMat: THREE.MeshStandardMaterial;
  private readonly stoneMat: THREE.MeshStandardMaterial;
  private readonly ringMat: THREE.MeshBasicMaterial;
  private readonly glow: THREE.Sprite;
  private lit = 0;
  private pulse = 0;
  private t = Math.random() * 10;

  /** `discovered` is the shared set WorldViews keeps from the local player's progress. */
  constructor(private readonly id: string, private readonly discovered: ReadonlySet<string>) {
    const g = shared();
    this.stoneMat = new THREE.MeshStandardMaterial({ color: 0x8c8a80, roughness: 0.95, emissive: 0x2a6a8a, emissiveIntensity: 0 });
    this.crystalMat = new THREE.MeshStandardMaterial({ color: 0xbff4ff, roughness: 0.2, emissive: 0x6fdcff, emissiveIntensity: 0.4 });
    this.ringMat = new THREE.MeshBasicMaterial({ color: 0x8fe8ff, transparent: true, opacity: 0.15, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
    const plinth = mesh(g.plinth, this.stoneMat, 0.17);
    const stone = mesh(g.stone, this.stoneMat, 0.35 + 0.85);
    this.crystal = mesh(g.crystal, this.crystalMat, 2.25);
    this.crystal.castShadow = false;
    const ring = new THREE.Mesh(g.ring, this.ringMat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.36;
    this.glow = glowSprite(0x8fe8ff, 1.6, 0.3);
    this.glow.position.y = 2.25;
    this.root.add(plinth, stone, this.crystal, ring, this.glow);
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
    this.ringMat.opacity = 0.08 + 0.3 * this.lit * (0.7 + 0.3 * breathe) + this.pulse * 0.5;
    this.glow.material.opacity = 0.18 + 0.45 * k + this.pulse * 0.6;
    this.glow.scale.setScalar(1.3 + 1.2 * k + this.pulse * 2.5);
    this.crystal.position.y = 2.25 + Math.sin(this.t * 1.2) * 0.08;
    this.crystal.rotation.y += dt * (0.4 + 0.8 * this.lit);
  }

  dispose(): void {
    this.stoneMat.dispose();
    this.crystalMat.dispose();
    this.ringMat.dispose();
    disposeSprite(this.glow);
    this.root.removeFromParent();
  }
}

/** A chest (plan §5): wood and iron bands, a lid on a hinge that swings open once it is used. */
export class ChestView implements EntityView {
  readonly root = new THREE.Group();
  readonly height = 0.9;
  private readonly lid = new THREE.Group();
  private readonly mats: THREE.Material[];
  private readonly glint: THREE.Sprite;
  private open = 0;
  private t = 0;

  constructor() {
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
    this.glint = glowSprite(0xffe08a, 0.9, 0.5);
    this.glint.position.y = 0.75;
    this.root.add(base, band, this.lid, this.glint);
  }

  update(e: Readonly<Entity>, alpha: number, dt: number): void {
    placeEntity(this.root, e, alpha);
    this.t += dt;
    const used = e.interactable?.used ?? false;
    this.open += ((used ? 1 : 0) - this.open) * (1 - Math.exp(-6 * dt));
    this.lid.rotation.x = -this.open * 1.9;
    // Unopened chests twinkle so they read from across the yard.
    this.glint.visible = this.open < 0.95;
    this.glint.material.opacity = (1 - this.open) * (0.3 + 0.25 * Math.sin(this.t * 3));
  }

  dispose(): void {
    for (const m of this.mats) m.dispose();
    disposeSprite(this.glint);
    this.root.removeFromParent();
  }
}

/** Pickup colours: Sprouts are green gems, hearts red, items gold. */
const PICKUP_LOOK = {
  sprouts: { color: 0x5fe06a, emissive: 0x1f8a2a, glow: 0x8fff8a },
  heart: { color: 0xff4a5a, emissive: 0x8a0a1a, glow: 0xff8a8a },
  item: { color: 0xf2c230, emissive: 0x6a4a00, glow: 0xffe08a },
} as const;
/** The last seconds of a pickup's life blink (it is about to go). */
const BLINK_TICKS = 2 * TICK_HZ;

/** Something on the ground to walk over (plan §5): a spinning, bobbing gem, heart or box. */
export class PickupView implements EntityView {
  readonly root = new THREE.Group();
  readonly height = 0.6;
  private readonly item: THREE.Mesh;
  private readonly mat: THREE.MeshStandardMaterial;
  private readonly glow: THREE.Sprite;
  private t = Math.random() * 10;

  constructor(e: Readonly<Entity>) {
    const kind = e.pickup?.kind ?? 'item';
    const look = PICKUP_LOOK[kind];
    const g = shared();
    this.mat = new THREE.MeshStandardMaterial({ color: look.color, emissive: look.emissive, emissiveIntensity: 0.9, roughness: 0.25, metalness: kind === 'heart' ? 0 : 0.3 });
    this.item = mesh(kind === 'sprouts' ? g.gem : kind === 'heart' ? g.heart : g.item, this.mat, 0.45);
    if (kind === 'sprouts' && (e.pickup?.amount ?? 1) >= 5) this.item.scale.setScalar(1.35);
    this.glow = glowSprite(look.glow, 0.8, 0.45);
    this.glow.position.y = 0.45;
    this.root.add(this.item, this.glow);
  }

  update(e: Readonly<Entity>, alpha: number, dt: number): void {
    placeEntity(this.root, e, alpha);
    this.t += dt;
    this.item.position.y = 0.45 + Math.sin(this.t * 2.6) * 0.07;
    this.item.rotation.y = this.t * 2.2;
    this.glow.position.y = this.item.position.y;
    const life = e.pickup?.life ?? Infinity;
    this.root.visible = life > BLINK_TICKS || Math.floor(this.t * 8) % 2 === 0;
  }

  dispose(): void {
    this.mat.dispose();
    disposeSprite(this.glow);
    this.root.removeFromParent();
  }
}
