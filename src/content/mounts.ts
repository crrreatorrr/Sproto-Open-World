/**
 * The Pepe Bull: the hub's default pet, big enough to ride (`art/tools/ride_anim.py` poses the rider
 * for it). Pure data. Ticks match the Blender clips: `mount` is 0.75 s and `dismount` 0.62 s.
 */
export const MOUNT = {
  id: 'pepe_bull',
  name: 'Pepe Bull',
  /** How far from the bull the ride prompt shows (m). */
  reach: 3.2,
  /** Top speed while riding, as a multiple of running and of sprinting on foot. */
  runScale: 1.45,
  sprintScale: 1.55,
  /** The bull keeps moving at this fraction of its speed while the rider swings, casts or guards. */
  actionMove: 0.8,
  /** A dodge on the bull is a side-charge: this much faster than a roll. */
  dodgeScale: 1.25,
  mountTicks: 45,
  dismountTicks: 37,
  /** The rider covers the ground between them and the saddle (or the landing spot) in these ticks. */
  travelTicks: 24,
  /** Where a dismount lands: this far to the bull's left (m). */
  dismountSide: 1.7,
  /** Resting or respawning calls an unridden bull to this offset from the shrine (m). */
  shrineOffset: [3.5, 2.5],
} as const;
