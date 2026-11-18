/**
 * The Pepe Bull: the hub's default pet, big enough to ride (`art/tools/ride_anim.py` poses the rider
 * for it). Pure data. Ticks match the Blender clips: `mount` is 0.75 s and `dismount` 0.62 s.
 */
export const MOUNT = {
  id: 'pepe_bull',
  name: 'Pepe Bull',
  /** How far from the bull the ride prompt shows (m). */
  reach: 3.2,
  /** Top speed at a trot and at a gallop (m/s). The bull's gallop clip is built against these two numbers. */
  trotSpeed: 9.5,
  gallopSpeed: 17,
  /** Gathering speed and braking (m/s²): much heavier than a rider on foot (`MOVE.accel`, `MOVE.decel`). */
  accel: 13,
  brake: 20,
  /** Sideways grip (m/s²). The turning circle's radius is speed² / grip: under 10 m at a full gallop. */
  grip: 30,
  /** Under this speed (m/s) the bull can set off in any direction at once. */
  pivotSpeed: 3,
  /** Steering further off its line than `scrubFrom` (radians) slows the bull, to `scrubKeep` of its speed at `scrubTo`, so a hairpin is tight. */
  scrubFrom: Math.PI / 4,
  scrubTo: (3 * Math.PI) / 4,
  scrubKeep: 0.35,
  /** How fast the bull's body swings onto the line it is running (rad/s). */
  yawRate: 7,
  /** With the stick let go, the gallop ends once the bull has slowed to this (m/s). */
  stopSpeed: 1,
  /** The bull keeps moving at this fraction of its speed while the rider swings, casts or guards. */
  actionMove: 0.8,
  /** A dodge on the bull is a side-charge: this much faster than a roll. */
  dodgeScale: 1.25,
  /** The speed it was already running at carries through a dodge, bleeding away at this rate (m/s²). */
  dodgeBrake: 14,
  mountTicks: 45,
  dismountTicks: 37,
  /** The rider covers the ground between them and the saddle (or the landing spot) in these ticks. */
  travelTicks: 24,
  /** Where a dismount lands: this far to the bull's left (m). */
  dismountSide: 1.7,
  /** Resting or respawning calls an unridden bull to this offset from the shrine (m). */
  shrineOffset: [3.5, 2.5],
} as const;
