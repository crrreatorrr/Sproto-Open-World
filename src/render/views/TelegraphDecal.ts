import * as THREE from 'three';

export type DecalShape = 'circle' | 'jagged';

const SPIKES = 11;
const RIM = 0.88;

/** A unit outline (radius 1) of the decal shape. The jagged one is a spiky star: never a circle. */
function outline(shape: DecalShape): THREE.Vector2[] {
  const pts: THREE.Vector2[] = [];
  if (shape === 'circle') {
    for (let i = 0; i < 48; i++) {
      const a = (i / 48) * Math.PI * 2;
      pts.push(new THREE.Vector2(Math.cos(a), Math.sin(a)));
    }
  } else {
    for (let i = 0; i < SPIKES * 2; i++) {
      const a = (i / (SPIKES * 2)) * Math.PI * 2;
      const r = i % 2 === 0 ? 1 : 0.68;
      pts.push(new THREE.Vector2(Math.cos(a) * r, Math.sin(a) * r));
    }
  }
  return pts;
}

const geos = new Map<string, THREE.BufferGeometry>();
function geometry(shape: DecalShape, part: 'rim' | 'fill'): THREE.BufferGeometry {
  const key = `${shape}:${part}`;
  let g = geos.get(key);
  if (!g) {
    const pts = outline(shape);
    const s = new THREE.Shape(pts);
    if (part === 'rim') s.holes.push(new THREE.Path(pts.map((p) => p.clone().multiplyScalar(RIM)).reverse()));
    g = new THREE.ShapeGeometry(s);
    // Lie flat on the ground (the shape is drawn in XY).
    g.rotateX(-Math.PI / 2);
    geos.set(key, g);
  }
  return g;
}

/**
 * A ground decal under an area attack's hitbox (plan §1): its rim shows where it lands, and its
 * fill grows over the wind-up, so the fill reaching the rim is the moment to have moved. The
 * unblockable shape is jagged and red, the normal one a circle, so it reads without colour.
 */
export class TelegraphDecal {
  readonly root = new THREE.Group();
  private readonly fill: THREE.Mesh;
  private readonly rimMat: THREE.MeshBasicMaterial;
  private readonly fillMat: THREE.MeshBasicMaterial;
  private readonly baseColor: number;
  private time = 0;

  constructor(readonly shape: DecalShape, color: number) {
    this.baseColor = color;
    const mat = (opacity: number) =>
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, side: THREE.DoubleSide });
    this.rimMat = mat(0.9);
    this.fillMat = mat(0.38);
    const rim = new THREE.Mesh(geometry(shape, 'rim'), this.rimMat);
    this.fill = new THREE.Mesh(geometry(shape, 'fill'), this.fillMat);
    rim.renderOrder = this.fill.renderOrder = 2;
    this.root.add(rim, this.fill);
  }

  /** Place it (feet-level centre, radius) and set the wind-up progress 0..1. */
  update(x: number, y: number, z: number, yaw: number, radius: number, progress: number, dt: number, gold = false): void {
    this.time += dt;
    const tint = gold && this.shape === 'circle' ? 0xf0c548 : this.baseColor;
    this.rimMat.color.setHex(tint);
    this.fillMat.color.setHex(tint);
    this.root.position.set(x, y + 0.03, z);
    this.root.rotation.y = yaw;
    this.root.scale.setScalar(radius);
    const p = Math.min(1, Math.max(0, progress));
    this.fill.scale.setScalar(Math.max(0.001, p));
    // The rim throbs harder as the fill closes in.
    this.rimMat.opacity = 0.65 + 0.35 * Math.abs(Math.sin(this.time * (6 + 14 * p)));
    this.fillMat.opacity = 0.25 + 0.3 * p;
  }

  dispose(): void {
    this.rimMat.dispose();
    this.fillMat.dispose();
    this.root.removeFromParent();
  }
}
