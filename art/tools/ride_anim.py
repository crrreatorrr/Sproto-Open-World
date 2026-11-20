"""Author the player's Pepe Bull riding clips in Blender: `mount`, `ride` and `dismount`.

Run inside Blender with art/source/player_melee.blend open:

    exec(open('<repo>/art/tools/ride_anim.py').read())

It runs melee_anim.py first (same rig helpers; the melee clips rebuild to the same keys), then writes
the three riding clips. Coordinates are melee_anim.py's: r = right, f = forward, u = up, metres from
the centre of the feet on the ground.

The clips carry height only. The game keeps the rider's origin on the ground under the saddle, and
moves it onto and off the bull itself (the loader pins every clip's horizontal root motion).

The seat is solved against the bull from art/tools/build_bull.py at the game's fit height (1.7 m
times `BULL_SCALE`), with its barrel slimmed and its saddle on: the legs clear its back and flanks
through the idle, walk and run clips. Keep the two feet symmetric: the loader centres each clip on the average of the feet.
"""
import math
import os
import bpy
from mathutils import Matrix, Vector

_tools = os.path.abspath(os.path.join(os.path.dirname(bpy.data.filepath), '..', 'tools'))
exec(open(os.path.join(_tools, 'melee_anim.py')).read(), globals())

# How big the bull is against the hub pet it was built from: src/content/mounts.ts `BULL_SCALE`.
# The seat and every key that touches the bull are solved per size, in POSES below.
BULL_SCALE = 2

# Height of the hips joint when seated on the bull's back (m): 0.19 m over the saddle's top, which is
# 1.27 m up on the hub-sized bull and rises with its scale.
SEAT_HIPS = 1.46 + 1.27 * (BULL_SCALE - 1)
REST_HIPS = M0['Hips'].translation.z / CM
RAISE = (SEAT_HIPS - REST_HIPS) * CM  # cm, as a negative `drop`


def leg(M, side, foot, knee, toe_down=20, toe_out=0):
    """Pose one leg from absolute targets: `foot` and the `knee` pole are (r, f, u) metres."""
    two_bone(M, side + 'UpLeg', side + 'Leg', side + 'Foot', C(*foot), C(*knee))
    turn = Matrix.Rotation(math.radians(toe_out if side == 'Right' else -toe_out), 3, Vector((0, 0, 1)))
    down = Matrix.Rotation(math.radians(toe_down), 3, Vector((1, 0, 0)))
    set_world_rot(M, side + 'Foot', down @ turn @ M0[side + 'Foot'].to_3x3().normalized())


def pose(spec, left=None, right=None):
    """A melee_anim spec plus optional absolute leg targets: left / right = (foot, knee[, toe_down])."""
    M = build(spec)
    for side, target in (('Left', left), ('Right', right)):
        if target:
            leg(M, side, target[0], target[1], *target[2:])
    return M


def mirror(target):
    """The left leg's target for a right one: r flipped."""
    (fr, ff, fu), (kr, kf, ku), *rest = target
    return ((-fr, ff, fu), (-kr, kf, ku), *rest)


S = SEAT_HIPS
# Each size's legs, as (foot, knee pole[, toe_down[, toe_out]]) with heights from the seat's hips.
#   seat: straddling the saddle (right leg; the left mirrors it).
#   over_*: the mount's top, hips over the saddle: the left leg on its side, the right swinging over.
#   lean_*: the dismount's start, the right leg brought up across the back.
#   drop_u: the dismount's slide, feet this far under the hips.
POSES = {
    # The hub-sized bull: thighs out over the flanks, knees bent, feet tucked in beside the barrel.
    1: dict(
        seat=((0.525, 0.0, S - 0.61), (1.085, 0.05, S - 0.31), 18, 10),
        over_left=((-0.52, 0.04, S - 0.74), (-1.00, 0.20, S - 0.28), 25),
        over_right=((0.62, -0.26, S - 0.06), (0.98, 0.25, S + 0.16), 40),
        lean_left=((-0.54, 0.04, S - 0.70), (-1.05, 0.20, S - 0.30), 25),
        lean_right=((0.40, -0.34, S + 0.02), (0.80, 0.20, S + 0.26), 40),
        spring_left=((-0.30, 0.05, S - 0.96), (-0.55, 0.60, S - 0.50), 35),
        spring_right=((0.42, -0.62, S - 0.28), (0.80, -0.10, S - 0.25), 45),
    ),
    # Twice the size: its back is too broad to hang legs down the flanks, so the rider sits up on it,
    # thighs spread across the saddle, shins resting on the slope of the back, knees forward and out.
    2: dict(
        seat=((0.80, 0.18, S - 0.36), (1.05, 0.75, S + 0.05), 25, 20),
        over_left=((-0.80, 0.10, S - 0.40), (-1.10, 0.60, S + 0.05), 25),
        over_right=((0.60, -0.40, S + 0.05), (0.95, 0.10, S + 0.30), 40),
        lean_left=((-0.80, 0.12, S - 0.38), (-1.10, 0.60, S + 0.05), 25),
        lean_right=((0.35, -0.40, S + 0.08), (0.80, 0.10, S + 0.34), 40),
        # The leap up: legs tucked under, the right one kicking back to clear the flank.
        spring_left=((-0.25, 0.20, S - 1.55), (-0.45, 0.80, S - 1.05), 35),
        spring_right=((0.30, -0.45, S - 1.30), (0.55, 0.20, S - 1.00), 45),
    ),
}
P = POSES[BULL_SCALE]
SEAT_R = P['seat']
SEAT_L = mirror(SEAT_R)

# The arms while riding: staff upright in the right hand, left hand forward on the bull's neck.
ARMS = dict(grip=(0.34, 0.26, SEAT_HIPS + 0.22), staff=(0.10, 0.22, 0.97), elbow=(0.6, -0.3, -0.4),
            lhand=(-0.16, 0.46, SEAT_HIPS + 0.10), lelbow=(-0.6, -0.2, -0.5))
# The dismount's slide: hips this fraction of the way up, the feet hanging under them.
SLIDE = 0.45
SLIDE_HIPS = REST_HIPS + (SEAT_HIPS - REST_HIPS) * SLIDE


def seat(dip=0.0, lean=9):
    legs_dip = dip / CM
    left = ((SEAT_L[0][0], SEAT_L[0][1], SEAT_L[0][2] - legs_dip), *SEAT_L[1:])
    right = ((SEAT_R[0][0], SEAT_R[0][1], SEAT_R[0][2] - legs_dip), *SEAT_R[1:])
    arms = dict(ARMS, grip=(ARMS['grip'][0], ARMS['grip'][1], ARMS['grip'][2] - legs_dip),
                lhand=(ARMS['lhand'][0], ARMS['lhand'][1], ARMS['lhand'][2] - legs_dip))
    return pose(dict(arms, drop=-RAISE + dip, hips_pitch=lean, spine_pitch=2, head_keep=1.0), left, right)


# How far up the bull's side the hands reach before the spring, and how high the hands are mid-leap.
REACH_UP = min(1.36, SEAT_HIPS - 0.10)
RIDE_KEYS = {
    'ride': [(0.0, lambda: seat()), (0.5, lambda: seat(dip=3.0, lean=11)), (1.0, lambda: seat())],
    'mount': [
        (0.0, lambda: pose({})),
        # Crouch, reaching up for the saddle.
        (0.14, lambda: pose(dict(drop=16 + 6 * (BULL_SCALE - 1), hips_pitch=14, spine_pitch=16, grip=(0.34, 0.10, 0.98 + 0.25 * (BULL_SCALE - 1)),
                                 staff=(0.1, 0.1, 0.99), elbow=(0.6, -0.3, -0.4), lhand=(-0.12, 0.42, REACH_UP - 0.08 + 0.4 * (BULL_SCALE - 1)),
                                 lelbow=(-0.6, -0.2, -0.5)))),
        # Spring up, the right leg swinging out behind.
        (0.30, lambda: pose(dict(drop=-RAISE * 0.55, hips_pitch=22, spine_pitch=20, grip=(0.40, 0.14, SEAT_HIPS - 0.04), staff=(0.2, 0.05, 0.97),
                                 elbow=(0.6, -0.3, -0.3), lhand=(-0.12, 0.46, SEAT_HIPS - 0.10), lelbow=(-0.6, -0.2, -0.5)),
                            left=P['spring_left'], right=P['spring_right'])),
        # Over the top: hips above the saddle, right leg clearing the bull's back.
        (0.46, lambda: pose(dict(ARMS, drop=-RAISE - 16, hips_pitch=16, spine_pitch=12), left=P['over_left'], right=P['over_right'])),
        # Land in the saddle with a little squash.
        (0.62, lambda: seat(dip=5, lean=13)),
        (0.75, lambda: seat()),
    ],
    'dismount': [
        (0.0, lambda: seat()),
        # Lean over and bring the right leg up across the back.
        (0.14, lambda: pose(dict(ARMS, drop=-RAISE - 10, hips_pitch=14, spine_pitch=10, spine_roll=-8), left=P['lean_left'], right=P['lean_right'])),
        # Both legs on the left side, sliding down.
        (0.28, lambda: pose(dict(drop=-RAISE * SLIDE, hips_pitch=8, spine_pitch=6, grip=(0.36, 0.20, SLIDE_HIPS + 0.24), staff=(0.1, 0.15, 0.98),
                                 elbow=(0.6, -0.3, -0.4), lhand=(0.10, 0.40, SLIDE_HIPS + 0.08), lelbow=(-0.6, -0.2, -0.5)),
                            left=((-0.22, 0.10, SLIDE_HIPS - 0.92), (-0.30, 0.65, SLIDE_HIPS - 0.48), 30),
                            right=((0.10, -0.08, SLIDE_HIPS - 0.84), (0.20, 0.60, SLIDE_HIPS - 0.43), 30))),
        # Land, knees soft.
        (0.42, lambda: pose(dict(drop=18, hips_pitch=12, spine_pitch=12, grip=(0.36, 0.14, 0.94), staff=(0.1, 0.1, 0.99),
                                 elbow=(0.6, -0.3, -0.4), lhand=(-0.32, 0.12, 0.92), lelbow=(-0.6, -0.2, -0.5)))),
        (0.62, lambda: pose({})),
    ],
}


def build_ride():
    for name, keys in RIDE_KEYS.items():
        write_clip(name, [(t, make()) for t, make in keys])
    print('built', list(RIDE_KEYS), 'rest hips', round(REST_HIPS, 3), 'raise cm', round(RAISE, 1))


build_ride()
