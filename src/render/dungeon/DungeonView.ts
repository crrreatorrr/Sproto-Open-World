/**
 * Three.js visual view for instanced Campaign Dungeons (L01-L10).
 *
 * Imports ONLY Three.js and pure content types (never SimWorld or PhysicsWorld, enforced by
 * tests/architecture.test.ts).
 */
import * as THREE from 'three';
import type {
  DungeonDef,
  DungeonId,
  DungeonMaterial,
  DungeonRampPrimitive,
  DungeonTerrainDef,
} from '../../content/dungeons/types';

interface MaterialStyle {
  color: number;
  roughness: number;
  metalness: number;
  emissive?: number;
  emissiveIntensity?: number;
  transparent?: boolean;
  opacity?: number;
}

const MATERIAL_STYLES: Readonly<Record<DungeonMaterial, MaterialStyle>> = {
  concrete: { color: 0x737882, roughness: 0.9, metalness: 0.05 },
  metal: { color: 0x566270, roughness: 0.45, metalness: 0.65 },
  rock: { color: 0x524640, roughness: 0.92, metalness: 0.05 },
  stone: { color: 0x8b8378, roughness: 0.88, metalness: 0.06 },
  sand: { color: 0xc9a870, roughness: 0.95, metalness: 0.0 },
  wood: { color: 0x7a5436, roughness: 0.85, metalness: 0.02 },
  grass: { color: 0x3b6e35, roughness: 0.9, metalness: 0.0 },
  ice: { color: 0x8bc9e8, roughness: 0.25, metalness: 0.15 },
  void: { color: 0x161229, roughness: 0.6, metalness: 0.35 },
  neon: { color: 0x2de8c8, roughness: 0.3, metalness: 0.4, emissive: 0x18a890, emissiveIntensity: 0.6 },
  lava: { color: 0xd94414, roughness: 0.4, metalness: 0.1, emissive: 0xff4400, emissiveIntensity: 0.85 },
  carpet: { color: 0x992838, roughness: 0.95, metalness: 0.0 },
  glass: { color: 0x9cd2eb, roughness: 0.15, metalness: 0.1, transparent: true, opacity: 0.55 },
};

function degToRad(deg = 0): number {
  return (deg * Math.PI) / 180;
}

/**
 * Build a 6-vertex wedge BufferGeometry matching `buildRampWedgeVertices` in dungeonColliders.ts.
 * At yaw = 0, rises linearly from (-hx, -hy) to (+hx, +hy).
 */
function buildRampGeometry(ramp: Pick<DungeonRampPrimitive, 'size'>): THREE.BufferGeometry {
  const hx = ramp.size[0] * 0.5;
  const hy = ramp.size[1] * 0.5;
  const hz = ramp.size[2] * 0.5;

  // 6 unique corner positions
  const bNW = [-hx, -hy, -hz] as const;
  const bNE = [hx, -hy, -hz] as const;
  const bSE = [hx, -hy, hz] as const;
  const bSW = [-hx, -hy, hz] as const;
  const tNE = [hx, hy, -hz] as const;
  const tSE = [hx, hy, hz] as const;

  const positions: number[] = [];
  const pushTri = (a: readonly [number, number, number], b: readonly [number, number, number], c: readonly [number, number, number]) => {
    positions.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
  };

  // Sloped top face (outward normal pointing up and -X)
  pushTri(bSW, bSE, tSE); // unused? Wait: let's wind carefully!
  // Actually let's use exact vertices of each of the 5 faces:
  positions.length = 0;
  // 1. Sloped deck: bNW (-hx,-hy,-hz), bSW (-hx,-hy,+hz), tSE (+hx,+hy,+hz), tNE (+hx,+hy,-hz)
  pushTri(bNW, bSW, tSE);
  pushTri(bNW, tSE, tNE);
  // 2. Back vertical face at x = +hx: bSE, bNE, tNE, tSE
  pushTri(bSE, bNE, tNE);
  pushTri(bSE, tNE, tSE);
  // 3. Bottom face at y = -hy: bNW, bNE, bSE, bSW
  pushTri(bNW, bNE, bSE);
  pushTri(bNW, bSE, bSW);
  // 4. North triangular side at z = -hz: bNW, tNE, bNE
  pushTri(bNW, tNE, bNE);
  // 5. South triangular side at z = +hz: bSW, bSE, tSE
  pushTri(bSW, bSE, tSE);

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.computeVertexNormals();
  return geo;
}

/**
 * Build a displaced terrain BufferGeometry matching `DungeonTerrainDef`.
 */
function buildTerrainGeometry(t: DungeonTerrainDef): THREE.BufferGeometry {
  const { cols, rows, size, heights } = t;
  const verts = new Float32Array(cols * rows * 3);
  const dx = size[0] / (cols - 1);
  const dz = size[1] / (rows - 1);

  for (let iz = 0; iz < rows; iz++) {
    for (let ix = 0; ix < cols; ix++) {
      const idx = iz * cols + ix;
      verts[idx * 3] = ix * dx;
      verts[idx * 3 + 1] = heights[idx] ?? 0;
      verts[idx * 3 + 2] = iz * dz;
    }
  }

  const indices: number[] = [];
  for (let iz = 0; iz < rows - 1; iz++) {
    for (let ix = 0; ix < cols - 1; ix++) {
      const a = iz * cols + ix;
      const b = a + 1;
      const c = a + cols;
      const d = c + 1;
      indices.push(a, c, b, b, c, d);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(verts, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

interface SavedLighting {
  scene: THREE.Scene;
  background: THREE.Color | THREE.Texture | THREE.CubeTexture | null;
  fog: THREE.Fog | THREE.FogExp2 | null;
  sun?: THREE.DirectionalLight;
  sunColor?: number;
  hemi?: THREE.HemisphereLight;
  hemiColor?: number;
}

export class DungeonView {
  readonly dungeonId: DungeonId;
  readonly root = new THREE.Group();

  private readonly geometries: THREE.BufferGeometry[] = [];
  private readonly materials: THREE.Material[] = [];
  private readonly materialCache = new Map<DungeonMaterial, THREE.MeshStandardMaterial>();
  private readonly doorMeshes = new Map<string, THREE.Mesh>();
  private readonly checkpointMaterials = new Map<string, THREE.MeshStandardMaterial>();
  private exitRingMat: THREE.MeshStandardMaterial | null = null;
  private exitDiscMat: THREE.MeshStandardMaterial | null = null;
  private savedLighting: SavedLighting | null = null;
  private disposed = false;

  constructor(readonly dungeon: DungeonDef) {
    this.dungeonId = dungeon.id;
    this.root.name = `dungeon-${dungeon.id}`;
    this.buildSolids();
    this.buildTerrain();
    this.buildCheckpoints();
    this.buildGrappleAnchors();
    this.buildMechanisms();
    this.buildExitPortal();
  }

  private getMaterial(mat: DungeonMaterial): THREE.MeshStandardMaterial {
    let m = this.materialCache.get(mat);
    if (!m) {
      const s = MATERIAL_STYLES[mat];
      m = new THREE.MeshStandardMaterial({
        color: s.color,
        roughness: s.roughness,
        metalness: s.metalness,
        emissive: s.emissive ?? 0x000000,
        emissiveIntensity: s.emissiveIntensity ?? 0,
        transparent: s.transparent ?? false,
        opacity: s.opacity ?? 1,
      });
      this.materialCache.set(mat, m);
      this.materials.push(m);
    }
    return m;
  }

  private trackGeo<T extends THREE.BufferGeometry>(geo: T): T {
    this.geometries.push(geo);
    return geo;
  }

  private trackMat<T extends THREE.Material>(mat: T): T {
    this.materials.push(mat);
    return mat;
  }

  private buildSolids(): void {
    for (const solid of this.dungeon.solids) {
      const mat = this.getMaterial(solid.material);
      let geo: THREE.BufferGeometry;
      if (solid.kind === 'box') {
        geo = this.trackGeo(new THREE.BoxGeometry(solid.size[0], solid.size[1], solid.size[2]));
      } else if (solid.kind === 'ramp') {
        geo = this.trackGeo(buildRampGeometry(solid));
      } else {
        geo = this.trackGeo(new THREE.CylinderGeometry(solid.r, solid.r, solid.h, 16));
      }
      const mesh = new THREE.Mesh(geo, mat);
      mesh.name = solid.id;
      mesh.position.set(solid.at[0], solid.at[1], solid.at[2]);
      mesh.rotation.y = degToRad(solid.yaw ?? 0);
      mesh.castShadow = solid.material !== 'glass';
      mesh.receiveShadow = true;
      this.root.add(mesh);
    }
  }

  private buildTerrain(): void {
    const t = this.dungeon.terrain;
    if (!t) return;
    const geo = this.trackGeo(buildTerrainGeometry(t));
    const mat = this.getMaterial(this.dungeon.id === 'L05' ? 'ice' : 'grass');
    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = t.id;
    mesh.position.set(t.origin[0], t.origin[1], t.origin[2]);
    mesh.receiveShadow = true;
    this.root.add(mesh);
  }

  private buildCheckpoints(): void {
    const ringGeo = this.trackGeo(new THREE.TorusGeometry(1.6, 0.12, 10, 28));
    const beaconGeo = this.trackGeo(new THREE.CylinderGeometry(0.14, 0.14, 3.2, 10));

    for (const cp of this.dungeon.checkpoints) {
      const mat = this.trackMat(
        new THREE.MeshStandardMaterial({
          color: 0x3ad6ff,
          emissive: 0x1ab2e8,
          emissiveIntensity: 0.75,
          roughness: 0.25,
          metalness: 0.2,
        }),
      );
      this.checkpointMaterials.set(cp.id, mat);

      const group = new THREE.Group();
      group.name = cp.id;
      group.position.set(cp.pos[0], cp.pos[1], cp.pos[2]);

      const ring = new THREE.Mesh(ringGeo, mat);
      ring.rotation.x = Math.PI / 2;
      ring.position.y = 0.18;
      group.add(ring);

      const beacon = new THREE.Mesh(beaconGeo, mat);
      beacon.position.y = 1.6;
      group.add(beacon);

      this.root.add(group);
    }
  }

  private buildGrappleAnchors(): void {
    if (this.dungeon.grappleAnchors.length === 0) return;
    const orbGeo = this.trackGeo(new THREE.OctahedronGeometry(0.45, 0));
    const mat = this.trackMat(
      new THREE.MeshStandardMaterial({
        color: 0xffd147,
        emissive: 0xff9d1a,
        emissiveIntensity: 0.9,
        roughness: 0.2,
        metalness: 0.5,
      }),
    );
    for (const ga of this.dungeon.grappleAnchors) {
      const mesh = new THREE.Mesh(orbGeo, mat);
      mesh.name = ga.id;
      mesh.position.set(ga.pos[0], ga.pos[1], ga.pos[2]);
      this.root.add(mesh);
    }
  }

  private buildMechanisms(): void {
    const doorMat = this.trackMat(
      new THREE.MeshStandardMaterial({
        color: 0xd93838,
        emissive: 0x991818,
        emissiveIntensity: 0.65,
        roughness: 0.35,
        metalness: 0.5,
        transparent: true,
        opacity: 0.82,
      }),
    );
    const switchMat = this.trackMat(
      new THREE.MeshStandardMaterial({
        color: 0x45e87c,
        emissive: 0x1ea84c,
        emissiveIntensity: 0.7,
        roughness: 0.3,
        metalness: 0.4,
      }),
    );
    const geyserMat = this.trackMat(
      new THREE.MeshStandardMaterial({
        color: 0x5ce1ff,
        emissive: 0x2299cc,
        emissiveIntensity: 0.8,
        roughness: 0.2,
        metalness: 0.1,
      }),
    );
    const hazardMat = this.trackMat(
      new THREE.MeshStandardMaterial({
        color: 0xff4e1a,
        emissive: 0xcc2200,
        emissiveIntensity: 0.9,
        roughness: 0.4,
        metalness: 0.1,
      }),
    );
    const moverMat = this.getMaterial('metal');

    for (const mech of this.dungeon.mechanisms) {
      const geo = this.trackGeo(new THREE.BoxGeometry(mech.size[0], mech.size[1], mech.size[2]));
      const mat =
        mech.kind === 'door'
          ? doorMat
          : mech.kind === 'switch'
            ? switchMat
            : mech.kind === 'geyser'
              ? geyserMat
              : mech.kind === 'hazard'
                ? hazardMat
                : moverMat;
      const mesh = new THREE.Mesh(geo, mat);
      mesh.name = mech.id;
      mesh.position.set(mech.pos[0], mech.pos[1], mech.pos[2]);
      if (mech.kind === 'door') {
        mesh.visible = false; // Doors start unsealed until lockdown activates
        this.doorMeshes.set(mech.id, mesh);
      }
      this.root.add(mesh);
    }
  }

  private buildExitPortal(): void {
    const ringGeo = this.trackGeo(new THREE.TorusGeometry(2.2, 0.22, 12, 32));
    const discGeo = this.trackGeo(new THREE.CircleGeometry(2.0, 28));
    this.exitRingMat = this.trackMat(
      new THREE.MeshStandardMaterial({
        color: 0x9b5cff,
        emissive: 0x6c2be8,
        emissiveIntensity: 0.95,
        roughness: 0.2,
        metalness: 0.4,
      }),
    );
    this.exitDiscMat = this.trackMat(
      new THREE.MeshStandardMaterial({
        color: 0xc299ff,
        emissive: 0x8040ff,
        emissiveIntensity: 0.7,
        transparent: true,
        opacity: 0.4,
        side: THREE.DoubleSide,
      }),
    );

    const group = new THREE.Group();
    group.name = `${this.dungeon.id}-exit-portal`;
    group.position.set(this.dungeon.exit[0], this.dungeon.exit[1] + 2.4, this.dungeon.exit[2]);
    group.rotation.y = Math.PI / 2;

    group.add(new THREE.Mesh(ringGeo, this.exitRingMat));
    group.add(new THREE.Mesh(discGeo, this.exitDiscMat));
    this.root.add(group);
  }

  /** Apply this dungeon's sky, fog, sun, and ambient lighting palette to the scene. */
  applyLighting(
    scene: THREE.Scene,
    sun?: THREE.DirectionalLight,
    hemi?: THREE.HemisphereLight,
  ): void {
    if (!this.savedLighting) {
      this.savedLighting = {
        scene,
        background: scene.background,
        fog: scene.fog,
        sun,
        sunColor: sun?.color.getHex(),
        hemi,
        hemiColor: hemi?.color.getHex(),
      };
    }
    scene.background = new THREE.Color(this.dungeon.skyColor);
    scene.fog = new THREE.Fog(
      this.dungeon.fogColor,
      this.dungeon.fogNear,
      this.dungeon.fogFar,
    );
    if (sun) sun.color.setHex(this.dungeon.sunColor);
    if (hemi) hemi.color.setHex(this.dungeon.ambientColor);
  }

  /** Restore the scene's previous lighting/sky/fog saved before `applyLighting`. */
  restoreLighting(): void {
    if (!this.savedLighting) return;
    const s = this.savedLighting;
    s.scene.background = s.background;
    s.scene.fog = s.fog;
    if (s.sun && s.sunColor !== undefined) s.sun.color.setHex(s.sunColor);
    if (s.hemi && s.hemiColor !== undefined) s.hemi.color.setHex(s.hemiColor);
    this.savedLighting = null;
  }

  /** Show or hide a lockdown door barrier mesh. */
  setDoorSealed(doorId: string, sealed: boolean): void {
    const mesh = this.doorMeshes.get(doorId);
    if (mesh) mesh.visible = sealed;
  }

  /** Highlight an activated checkpoint ring in bright gold. */
  setCheckpointActivated(checkpointId: string, active: boolean): void {
    const mat = this.checkpointMaterials.get(checkpointId);
    if (!mat) return;
    if (active) {
      mat.color.setHex(0xffd740);
      mat.emissive.setHex(0xffa000);
      mat.emissiveIntensity = 1.1;
    } else {
      mat.color.setHex(0x3ad6ff);
      mat.emissive.setHex(0x1ab2e8);
      mat.emissiveIntensity = 0.75;
    }
  }

  /** Shift exit portal color when the boss/final encounter is cleared. */
  setExitUnlocked(unlocked: boolean): void {
    if (!this.exitRingMat || !this.exitDiscMat) return;
    if (unlocked) {
      this.exitRingMat.color.setHex(0x4dff9e);
      this.exitRingMat.emissive.setHex(0x18cc66);
      this.exitDiscMat.color.setHex(0x80ffbb);
      this.exitDiscMat.opacity = 0.75;
    } else {
      this.exitRingMat.color.setHex(0x9b5cff);
      this.exitRingMat.emissive.setHex(0x6c2be8);
      this.exitDiscMat.color.setHex(0xc299ff);
      this.exitDiscMat.opacity = 0.4;
    }
  }

  /** Remove dungeon group from its parent, restore lighting, and free all GPU resources. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.restoreLighting();
    this.root.removeFromParent();
    for (const geo of this.geometries) geo.dispose();
    for (const mat of this.materials) mat.dispose();
    this.geometries.length = 0;
    this.materials.length = 0;
    this.materialCache.clear();
    this.doorMeshes.clear();
    this.checkpointMaterials.clear();
  }
}
