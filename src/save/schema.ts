/**
 * The save file (plan §2.8): one slot in localStorage (`sow.save`, previous good write in
 * `sow.save.bak`). JSON, about 20 KB at most. Enemy positions are never saved. Pure.
 */
import type { Progress, WorldState } from '../sim/entity';

export const SAVE_KEY = 'sow.save';
export const SAVE_BAK_KEY = 'sow.save.bak';
export const SAVE_SCHEMA = 6;

export interface SaveFile {
  schema: number;
  /** ISO time, set by the app (the sim has no clock). */
  savedAt: string;
  build: string;
  region: string;
  /** The player's whole RPG state (dialogue, shop and shrine menus are not resumed). */
  player: Omit<Progress, 'dialogue' | 'shop' | 'atShrine'>;
  world: WorldState;
}
