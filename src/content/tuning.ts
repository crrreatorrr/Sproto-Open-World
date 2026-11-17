/** Hand-tuned gameplay numbers (plan §2.5). Pure data: the sim reads it, nothing writes it. */

/** Fixed simulation rate. Frame data everywhere is in these ticks. */
export const TICK_HZ = 60;
export const DT = 1 / TICK_HZ;

export const PLAYER_BODY = {
  /** Capsule radius (m). */
  radius: 0.35,
  /** Capsule total height, feet to crown (m). */
  height: 1.8,
} as const;

export const MOVE = {
  /** Full-stick run speed (m/s). Walking is a partial stick. */
  runSpeed: 5.2,
  sprintSpeed: 7.8,
  /** Ground acceleration and braking (m/s²). */
  accel: 38,
  decel: 46,
  /** Fraction of ground acceleration available in the air. */
  airControl: 0.35,
  /** Facing turn rate toward the move direction (rad/s). */
  turnRate: 12,
  /** Stick magnitude needed before sprint engages. */
  sprintMinStick: 0.5,
  gravity: 26,
  /** Jump apex height (m). */
  jumpHeight: 1.15,
  /** Ticks a jump press is remembered before landing, and after walking off a ledge. */
  jumpBufferTicks: 6,
  coyoteTicks: 6,
  /** Terminal fall speed (m/s). */
  maxFall: 40,
  /** Below this height the player is returned to the spawn point (m). */
  killY: -40,
} as const;

/** Rapier character-controller settings. */
export const KCC = {
  offset: 0.02,
  maxSlopeDeg: 50,
  minSlideDeg: 55,
  autostepHeight: 0.4,
  autostepMinWidth: 0.2,
  snapToGround: 0.35,
} as const;
