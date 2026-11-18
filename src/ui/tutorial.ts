import type { Combat } from '../sim/entity';
import type { SimEvent } from '../sim/events';

/**
 * First-time hints (plan §6.4, M4): each shows once per session, the first time its moment happens
 * in play, so the game teaches a rule right when it matters. Button names follow the device in use.
 */
export type TipId = 'lockOn' | 'unblockable' | 'resisted' | 'weak' | 'noMana' | 'blocked' | 'parried' | 'newSpell';

const BUTTONS = {
  pad: { lock: 'RS', dodge: 'B', heavy: 'RT', block: 'LB', cast: 'LT + a face button' },
  kbm: { lock: 'T', dodge: 'C', heavy: 'right mouse', block: 'Q', cast: '1–4' },
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
    case 'block':
      return e.target === me ? 'blocked' : null;
    case 'parry':
      // Only a parry that stunned someone has a riposte to teach.
      return e.target === me && e.stun ? 'parried' : null;
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
    case 'blocked':
      return `Blocked! Tap ${b.block} just before a blow lands to parry it. ${b.heavy} right after a block counters.`;
    case 'parried':
      return `Parried! It's stunned: press ${b.heavy} now to riposte for huge damage.`;
    case 'newSpell':
      return `New spell! Cast with ${b.cast}.`;
  }
}

/**
 * The counter-attack a heavy press would be right now, and the ticks left to press it. Hidden while
 * the player can't act on it (a riposte can cancel an attack's recovery; a guard counter can't).
 */
export function counterPrompt(c: Readonly<Pick<Combat, 'action' | 'riposteUntil' | 'guardCounterUntil'>>, now: number): { text: string; ticks: number } | null {
  const kind = c.action?.kind;
  const guarding = !kind || kind === 'block';
  if (now < c.riposteUntil && (guarding || kind === 'attack')) return { text: 'Riposte!', ticks: c.riposteUntil - now };
  if (now < c.guardCounterUntil && guarding) return { text: 'Counter!', ticks: c.guardCounterUntil - now };
  return null;
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
