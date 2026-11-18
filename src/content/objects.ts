/**
 * One-use world objects a quest points at (M4): the Watchtower beacon, the mill lever, the Frost
 * Nova tome. Interacting uses the object once (it stays used, saved as the world flag
 * `used:<id>`) and applies its effects. Pure data.
 */
import { C4_OBJECTS } from './packs/c4';
import { QUARRY_GATE_LOCK } from './packs/m5';
import type { Condition, Effect } from './quests';

export interface ObjectDef {
  id: string;
  /** The interact prompt's name ("Light the beacon" reads "[Y] Light Watchtower Beacon"). */
  name: string;
  /** The prompt's verb. */
  verb: string;
  /** View model key: `beacon`, `lever`, `tome`. */
  model: string;
  effects?: Effect[];
  /** It can be used only when these hold; otherwise `refusal` is said and it stays unused. */
  requires?: Condition[];
  refusal?: string;
}

export const OBJECTS: Record<string, ObjectDef> = {
  watchtower_beacon: { id: 'watchtower_beacon', name: 'Watchtower Beacon', verb: 'Light', model: 'beacon', effects: [{ setFlag: 'beacon.lit' }] },
  mill_lever: { id: 'mill_lever', name: 'Mill Lever', verb: 'Pull', model: 'lever', effects: [{ setFlag: 'mill.running' }] },
  frost_tome: { id: 'frost_tome', name: 'Frost Tome', verb: 'Read', model: 'tome', effects: [{ learnSpell: 'frostNova' }] },
  quarry_gate_lock: QUARRY_GATE_LOCK,
};

Object.assign(OBJECTS, C4_OBJECTS);

/** The world flag that records an object as used. */
export const usedFlag = (id: string) => `used:${id}`;
