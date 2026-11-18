import type { SimEvent } from '../sim/events';

/**
 * First-time hints (plan §6.4, M4): each shows once per session, the first time its moment happens
 * in play, so the game teaches a rule right when it matters. Button names follow the device in use.
 */
export type TipId = 'lockOn' | 'unblockable' | 'resisted' | 'weak' | 'noMana' | 'parried' | 'newSpell';

const BUTTONS = {
  pad: { lock: 'RS', dodge: 'B', heavy: 'RT', cast: 'LT + a face button' },
  kbm: { lock: 'T', dodge: 'C', heavy: 'right mouse', cast: '1–4' },
} as const;

/** Which tip this event earns, if any. `me` is the local player's entity id. */
export function tipFor(e: SimEvent, me: number | null): TipId | null {
  switch (e.type) {
    case 'telegraph':
      return e.unblockable ? 'unblockable' : 'lockOn';
    case 'hit':
      if (e.attacker !== me) return null;
      return e.affinity === 'resist' ? 'resisted' : e.affinity === 'weak' ? 'weak' : null;
    case 'noMana':
      return e.entity === me ? 'noMana' : null;
    case 'parry':
      return e.target === me ? 'parried' : null;
    case 'spellLearned':
      return e.entity === me ? 'newSpell' : null;
    default:
      return null;
  }
}

export function tipText(id: TipId, device: 'pad' | 'kbm'): string {
  const b = BUTTONS[device];
  switch (id) {
    case 'lockOn':
      return `Enemy! Press ${b.lock} to lock on.`;
    case 'unblockable':
      return `That attack can't be blocked. Dodge it with ${b.dodge}!`;
    case 'resisted':
      return 'Resisted! Try another kind of damage.';
    case 'weak':
      return 'Weak spot! That damage hits harder here.';
    case 'noMana':
      return 'Out of mana. Staff hits refill it.';
    case 'parried':
      return `Parried! Press ${b.heavy} now for a riposte.`;
    case 'newSpell':
      return `New spell! Cast with ${b.cast}.`;
  }
}

/** Remembers which tips have shown this session. */
export class Tutorial {
  private readonly seen = new Set<TipId>();

  /** The text to show for this event, once per tip; null otherwise. */
  tip(e: SimEvent, me: number | null, device: 'pad' | 'kbm'): string | null {
    const id = tipFor(e, me);
    if (!id || this.seen.has(id)) return null;
    this.seen.add(id);
    return tipText(id, device);
  }
}
