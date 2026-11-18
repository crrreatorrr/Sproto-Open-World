/**
 * The M1b wave runner (`?sandbox=1`, plan §9 M1b): mixed waves of 5–7 enemies that always pair
 * opposite profiles, so no single tool clears a wave efficiently. Spawn points are offsets from
 * the arena centre (m). Waves loop; each loop adds one Grunt.
 */
export interface WaveSpawn {
  def: string;
  at: [number, number];
}

export const WAVE_CENTRE: [number, number] = [0, -10];
/** Ticks between clearing a wave and the next one arriving. */
export const WAVE_GAP = 180;

export const WAVES: WaveSpawn[][] = [
  // 1. Grunts and Slingers: melee the Slingers (physical-weak), Blast the Grunt pack (burn-weak).
  [
    { def: 'grunt', at: [-3, -6] }, { def: 'grunt', at: [0, -7] }, { def: 'grunt', at: [3, -6] },
    { def: 'slinger', at: [-8, -14] }, { def: 'slinger', at: [8, -14] },
  ],
  // 2. Brute and Wisps: the Brute resists spells, the Wisps shrug off the staff.
  [
    { def: 'brute', at: [0, -8] },
    { def: 'wisp', at: [-9, -12] }, { def: 'wisp', at: [9, -12] },
    { def: 'grunt', at: [-4, -6] }, { def: 'grunt', at: [4, -6] },
  ],
  // 3. Everything.
  [
    { def: 'grunt', at: [-4, -5] }, { def: 'grunt', at: [4, -5] }, { def: 'grunt', at: [0, -6] },
    { def: 'slinger', at: [-10, -14] }, { def: 'wisp', at: [10, -13] }, { def: 'wisp', at: [0, -16] },
    { def: 'brute', at: [0, -10] },
  ],
];
