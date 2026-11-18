import type { DamageKind } from '../content/combat';
import type { Affinity, EnemyDef } from '../content/enemies';
import type { StatusId } from '../content/statuses';

/** What a health bar can reveal about an enemy type: its two damage kinds and three statuses. */
export type RevealKey = DamageKind | StatusId;
export const REVEAL_ORDER: readonly RevealKey[] = ['physical', 'arcane', 'burn', 'chill', 'shock'];

/**
 * The weakness and resistance reveals (plan §4.6, "the player sees it"): the first hit of each
 * damage kind on an enemy type shows that kind's icon on the type's health bar, and the first
 * time a status lands shows the status's. Remembered per enemy type for the session (not saved:
 * a new session learns them again), along with whether each explanation toast has been shown.
 */
export class Reveals {
  private readonly byType = new Map<string, Map<RevealKey, Affinity>>();
  private readonly toasted = new Set<Affinity>();

  /** Record what a hit or status showed. True if this is new for the type. */
  reveal(type: string, key: RevealKey, affinity: Affinity): boolean {
    let m = this.byType.get(type);
    if (!m) {
      m = new Map();
      this.byType.set(type, m);
    }
    if (m.get(key) === affinity) return false;
    m.set(key, affinity);
    return true;
  }

  /** The type's revealed icons, in a fixed order (sword, rune, then the statuses). */
  list(type: string): { key: RevealKey; affinity: Affinity }[] {
    const m = this.byType.get(type);
    if (!m) return [];
    return REVEAL_ORDER.filter((k) => m.has(k)).map((key) => ({ key, affinity: m.get(key)! }));
  }

  /** True the first time `affinity` is seen this session: the caller shows its explanation once. */
  firstToast(affinity: Affinity): boolean {
    if (affinity === 'normal' || this.toasted.has(affinity)) return false;
    this.toasted.add(affinity);
    return true;
  }
}

const plural = (name: string) => (name.endsWith('s') ? name : `${name}s`);

/**
 * The one-time explanation for the first "Weak!" or "Resisted" hit (plan §4.6), naming the enemy
 * and the tool that does better, e.g. "Hex Wisps shrug off the staff — try a spell".
 */
export function affinityToast(def: Pick<EnemyDef, 'name'>, kind: DamageKind, affinity: 'weak' | 'resist'): string {
  const who = plural(def.name);
  const tool = kind === 'physical' ? 'the staff' : 'spells';
  if (affinity === 'weak') return `${who} are weak to ${tool} — Weak! hits deal 50% more`;
  return `${who} shrug off ${tool} — ${kind === 'physical' ? 'try a spell' : 'get in close with the staff'}`;
}
