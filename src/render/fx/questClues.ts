import * as THREE from 'three';
import { QUESTS } from '../../content/quests';
import type { Entity } from '../../sim/entity';
import type { ReadonlySimView } from '../../sim/view';

const STEPS = ['giant_track_1', 'giant_track_2', 'giant_track_3', 'giant_track_4'] as const;
const HAY = ['burning_hay_1', 'burning_hay_2', 'burning_hay_3', 'burning_hay_4', 'burning_hay_5'];

/**
 * World clues in place of a compass: giant footprints that fade in as you near them, and a scorch
 * trail from a doused haystack toward the next one. Relic-chest shimmer is applied on the chests.
 */
export class QuestClues {
  readonly root = new THREE.Group();
  private readonly prints: THREE.Mesh[] = [];
  private readonly scorch: THREE.Mesh[] = [];

  constructor() {
    const print = new THREE.MeshBasicMaterial({ color: 0x6a5a40, transparent: true, opacity: 0.55, depthWrite: false });
    const burn = new THREE.MeshBasicMaterial({ color: 0x3a2418, transparent: true, opacity: 0.7, depthWrite: false });
    for (let i = 0; i < 8; i++) this.prints.push(mark(print, 0.28, 0.5));
    for (let i = 0; i < 6; i++) this.scorch.push(mark(burn, 0.45, 0.9));
    this.root.add(...this.prints, ...this.scorch);
  }

  sync(view: ReadonlySimView, me: Readonly<Entity> | undefined): void {
    this.prints.forEach((m) => (m.visible = false));
    this.scorch.forEach((m) => (m.visible = false));
    if (!me?.progress) return;
    const q = me.progress.quests.q_hollow_giant;
    if (q?.status === 'active' && QUESTS.q_hollow_giant.steps[q.step]?.clue === 'footprints') {
      const step = QUESTS.q_hollow_giant.steps[q.step];
      const reach = step.objectives.find((o) => o.kind === 'reach');
      const id = reach && reach.kind === 'reach' ? reach.trigger : '';
      const index = STEPS.indexOf(id as (typeof STEPS)[number]);
      const fromId = index <= 0 ? 'ranger_moss' : STEPS[index - 1];
      this.lay(this.prints, view.locate(fromId), view.locate(id), me, 28);
    }
    const hay = me.progress.quests.q_smoke_hills;
    if (hay?.status === 'active' && QUESTS.q_smoke_hills.steps[hay.step]?.clue === 'scorch') {
      const used = (id: string) => view.entities.some((e) => e.interactable?.id === id && e.interactable.used);
      const next = HAY.find((id) => !used(id));
      const from = [...HAY].reverse().find((id) => used(id));
      if (from && next && from !== next) this.lay(this.scorch, view.locate(from), view.locate(next), me, 40);
    }
  }

  private lay(marks: THREE.Mesh[], from: { x: number; y: number; z: number } | null, to: { x: number; y: number; z: number } | null, me: Readonly<Entity>, reach: number): void {
    if (!from || !to) return;
    const dx = to.x - from.x, dz = to.z - from.z, dy = to.y - from.y;
    const yaw = Math.atan2(dx, dz);
    const fades = trailFades(from, to, me.tf.pos, marks.length, reach);
    marks.forEach((m, i) => {
      const fade = fades[i] ?? 0;
      m.visible = fade > 0.02;
      if (!m.visible) return;
      const t = (i + 1) / (marks.length + 1);
      m.position.set(from.x + dx * t, from.y + dy * t + 0.05, from.z + dz * t);
      m.rotation.y = yaw + (i % 2 ? 0.4 : -0.3);
      (m.material as THREE.MeshBasicMaterial).opacity = 0.25 + 0.5 * fade;
    });
  }

  dispose(): void {
    for (const m of [...this.prints, ...this.scorch]) {
      m.geometry.dispose();
      (m.material as THREE.Material).dispose();
    }
  }
}

/**
 * How strongly one print reads. 1 beside it, 0 at `reach` metres.
 * Each print fades on its own distance, so a trail longer than `reach` still leads:
 * the prints ahead appear as you walk up to them. Fading the whole trail by the
 * distance to its far end hides it until you have already arrived.
 */
export function clueFade(dist: number, reach: number): number {
  if (!(reach > 0)) return 0;
  return Math.max(0, Math.min(1, 1 - dist / reach));
}

/** Fade of each print laid evenly from `from` to `to`, seen from `me`. */
export function trailFades(from: { x: number; z: number }, to: { x: number; z: number }, me: { x: number; z: number }, count: number, reach: number): number[] {
  const dx = to.x - from.x, dz = to.z - from.z;
  const fades: number[] = [];
  for (let i = 0; i < count; i++) {
    const t = (i + 1) / (count + 1);
    fades.push(clueFade(Math.hypot(me.x - (from.x + dx * t), me.z - (from.z + dz * t)), reach));
  }
  return fades;
}

function mark(mat: THREE.Material, w: number, h: number): THREE.Mesh {
  const g = new THREE.PlaneGeometry(w, h);
  g.rotateX(-Math.PI / 2);
  const m = new THREE.Mesh(g, mat.clone());
  m.visible = false;
  return m;
}
