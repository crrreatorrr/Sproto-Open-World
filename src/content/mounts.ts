/**
 * How big the Pepe Bull is, against the hub pet it was built from (1.7 m tall at 1). Every length
 * below that is the bull's own (its body, the rider's collider, where a call pulls up) is that
 * length at 1 times this; `art/tools/ride_anim.py` poses the rider for the same scale (`BULL_SCALE`).
 */
export const BULL_SCALE = 2;

/**
 * The Pepe Bull: the hub's default pet, big enough to ride (`art/tools/ride_anim.py` poses the rider
 * for it). Pure data. Ticks match the Blender clips: `mount` is 0.75 s and `dismount` 0.62 s.
 */
export const MOUNT = {
  id: 'pepe_bull',
  name: 'Pepe Bull',
  /** How big it is (see `BULL_SCALE`). */
  scale: BULL_SCALE,
  /** How tall the model stands (m). */
  standHeight: 1.7 * BULL_SCALE,
  /** How far from the bull the ride prompt shows (m): its flank plus an arm's length. */
  reach: 2.2 + 1.0 * BULL_SCALE,
  /** Top speed at a trot and at a gallop (m/s). The bull's gallop clip is built against these two numbers. */
  trotSpeed: 9.5,
  gallopSpeed: 17,
  /** Gathering speed and braking (m/s²): much heavier than a rider on foot (`MOVE.accel`, `MOVE.decel`). */
  accel: 13,
  brake: 20,
  /** Sideways grip (m/s²). The turning circle's radius is speed² / grip: about 7 m at a full gallop. */
  grip: 42,
  /**
   * The fastest its line can swing round, whatever its speed (rad/s): about 143° a second, so a
   * quarter turn takes 0.63 s and turning right round at least 1.26 s. Grip is the tighter limit
   * only at a full gallop; at a walk or a trot this is what makes a turn an arc and not a snap
   * (1.5 m radius at a 3.8 m/s walk, 3.8 m at a trot, 7 m at a gallop).
   */
  turnRate: 2.5,
  /** Under this speed (m/s), all but standing, the bull can set off in any direction at once. */
  pivotSpeed: 1,
  /** Steering further off its line than `scrubFrom` (radians) slows the bull, to `scrubKeep` of its speed at `scrubTo`, so a hairpin is tight. */
  scrubFrom: Math.PI / 3,
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
  dismountSide: 1.2 + 0.5 * BULL_SCALE,
  /** The standing bull's solid body (m): half its width, half its length, and its height up to its back (its head and horns stand above). */
  bodyHalfWidth: 0.5 * BULL_SCALE,
  bodyHalfLength: 1.25 * BULL_SCALE,
  bodyHeight: 1.4 * BULL_SCALE,
  /** In the saddle the rider's collider is as wide as the bull, so its flanks meet walls, trees and people (m). */
  rideRadius: 0.65 * BULL_SCALE,
  /**
   * From the saddle the staff's swing reaches this many times as far across the ground: it scales
   * with the bull, so a bigger bull's body doesn't swallow the swing (1 on the hub-sized bull).
   */
  saddleReach: BULL_SCALE,
  /** …and its hit capsule is this much fatter (m), as the arc is wider but the enemies in it are not (0 on the hub-sized bull). */
  saddleStaffPad: 0.2 * (BULL_SCALE - 1),
  /**
   * The rider's collider is round but the bull is long, its nose `bodyHalfLength` ahead of its middle:
   * running at a wall it stops when its nose meets it. The nose is a ball this wide (m) at this height
   * above the feet (m), so low fences pass under the head and slopes don't count.
   */
  noseRadius: 0.3 * BULL_SCALE,
  noseHeight: 0.88 * BULL_SCALE,
  /** Sitting down lifts the wider collider this far clear of a slope; snapping to the ground takes it back (m). */
  seatLift: 0.12 * BULL_SCALE,
  /**
   * Flight, flown like a plane: three quick jumps in the saddle take off (and three more come down),
   * and touching the ground ends it. The stick pitches the nose (forward is down) and banks into a
   * turn, and the gallop button is the throttle between cruising and boosting.
   */
  fly: {
    /** A jump press within this many ticks of the last counts toward the three. */
    jumpWindow: 24,
    /** Airspeed: cruising, boosting, and the slowest it flies (m/s); how fast the throttle gathers it, and drag sheds speed above it (m/s²). */
    cruise: 14,
    boost: 24,
    slowest: 7,
    throttle: 9,
    drag: 1.5,
    /** Diving speeds it up and climbing slows it: this much (m/s²) at the nose straight down, by the sine of the pitch. */
    dive: 7,
    /** The nose's steepest climb and dive, and how fast it moves there and back to level (radians, rad/s). */
    pitchMax: 0.6,
    pitchRate: 1.4,
    /** The hardest bank, how fast it rolls, and the turn it gives: rad/s of heading per radian of bank. */
    bankMax: 0.75,
    bankRate: 2.4,
    turnPerBank: 1.5,
    /** Take-off: the nose holds at least this high (radians) for this long (ticks), climbing clear; the ground can't land it meanwhile. */
    takeoffPitch: 0.45,
    takeoffTicks: 45,
    /** It can't fly higher than this (m, world height). */
    ceiling: 110,
    /** Swinging from the air, the staff also reaches this far (m) below where it would on the ground: low passes hit what is under them. */
    reachDown: 2,
  },
  /** Called from within this distance, the bull runs to the player over the ground (m). */
  callRange: 80,
  /** From further away, or when it can't get through, it appears behind the camera at one of these distances and runs in (m). */
  callAppear: [28, 20],
  /** It pulls up this far from the player: close enough to ride (m). */
  callStop: 1.6 + 1.0 * BULL_SCALE,
  /** It drops from a gallop to a trot this far out (m). */
  callTrotWithin: 14,
  /** Getting no closer by `callProgress` metres for this many ticks means it can't get through. */
  callStuckTicks: 90,
  callProgress: 1.5,
  /** The capsule it runs on (m). */
  callRadius: 0.6 * BULL_SCALE,
  /** Resting or respawning calls an unridden bull to this offset from the shrine (m). */
  shrineOffset: [3.5 + 1.5 * (BULL_SCALE - 1), 2.5 + 1.5 * (BULL_SCALE - 1)],
} as const;
