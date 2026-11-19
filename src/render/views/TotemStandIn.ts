/**
 * Stand-in for a placed totem until grok/quest-polish-blender-assets publishes the GLBs.
 * Not imported from the boot graph: WorldViews loads it the first time a totem is planted.
 * Paths live on the keepsake (`models/props/totems/<id>.glb`). No new GLB is authored here.
 */
import * as THREE from 'three';
import { TOTEM_FADE_TICKS } from '../../content/relics';

/** Placed heights from the plan (m). The GLB path is models/props/totems/<id>.glb once the spec lands. */
const HEIGHT: Record<string, number> = {
  totem_elders_hearth: 0.5,
  totem_field_warden: 1.6,
  totem_seekers_lantern: 1.2,
  totem_turnstone: 1,
  totem_elders_seed: 0.35,
  totem_earthspeaker_stake: 0.9,
  totem_ember_quench_pail: 0.5,
  totem_skylure_post: 2,
};

export interface StandInTotem {
  id: number;
  placedTotem?: { id: string; age: number; life: number; x: number; y: number; z: number };
}

const groups = new Map<number, THREE.Group>();

const tint = (id: string): number => {
  if (id.includes('hearth') || id.includes('drake') || id.includes('ember')) return 0xc46a3a;
  if (id.includes('seed') || id.includes('briar') || id.includes('hope')) return 0x6aaa55;
  if (id.includes('lantern') || id.includes('turn')) return 0xd7b15e;
  return 0x8a7358;
};

function build(id: string): THREE.Group {
  const g = new THREE.Group();
  const h = HEIGHT[id] ?? 1;
  const mat = new THREE.MeshStandardMaterial({ color: tint(id), roughness: 0.7, transparent: true });
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(Math.max(0.12, h * 0.18), Math.max(0.15, h * 0.22), h, 6), mat);
  mesh.position.y = h / 2;
  g.add(mesh);
  return g;
}

/** Move, fade and drop stand-ins to match the sim. One group per player who has a totem down. */
export function syncTotemStandIns(root: THREE.Object3D, entities: readonly StandInTotem[]): void {
  const live = new Set<number>();
  for (const e of entities) {
    const t = e.placedTotem;
    if (!t) continue;
    live.add(e.id);
    let g = groups.get(e.id);
    if (!g || g.name !== t.id) {
      g?.removeFromParent();
      g = build(t.id);
      g.name = t.id;
      groups.set(e.id, g);
      root.add(g);
    }
    g.position.set(t.x, t.y, t.z);
    const left = t.life - t.age;
    const fade = left < TOTEM_FADE_TICKS ? Math.max(0, left / TOTEM_FADE_TICKS) : 1;
    g.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        const m = o.material as THREE.MeshStandardMaterial;
        m.opacity = fade;
      }
    });
  }
  for (const [id, g] of groups) {
    if (live.has(id)) continue;
    g.removeFromParent();
    groups.delete(id);
  }
}
