"""Author the player's Pepe Bull riding clips in Blender: `mount`, `ride` and `dismount`.

Run inside Blender with art/source/player_melee.blend open:

    exec(open('<repo>/art/tools/ride_anim.py').read())

It runs melee_anim.py first (same rig helpers; the melee clips rebuild to the same keys), then writes
the three riding clips. Coordinates are melee_anim.py's: r = right, f = forward, u = up, metres from
the centre of the feet on the ground.

The clips carry height only. The game keeps the rider's origin on the ground under the saddle, and
moves it onto and off the bull itself (the loader pins every clip's horizontal root motion).

The seat is solved against the bull from art/tools/build_bull.py at the game's fit height of 1.7 m,
with its barrel slimmed and its saddle on: the legs clear its flanks through the idle, walk and run
clips. Keep the two feet symmetric: the loader centres each clip on the average of the feet.
"""
import math
import os
import bpy
from mathutils import Matrix, Vector

_tools = os.path.abspath(os.path.join(os.path.dirname(bpy.data.filepath), '..', 'tools'))
exec(open(os.path.join(_tools, 'melee_anim.py')).read(), globals())

# Height of the hips joint when seated on the bull's back (m).
SEAT_HIPS = 1.46
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


# The arms while riding: staff upright in the right hand, left hand forward on the bull's neck.
ARMS = dict(grip=(0.34, 0.26, SEAT_HIPS + 0.22), staff=(0.10, 0.22, 0.97), elbow=(0.6, -0.3, -0.4),
            lhand=(-0.16, 0.46, SEAT_HIPS + 0.10), lelbow=(-0.6, -0.2, -0.5))
# Straddling the saddle: thighs out over the flanks, knees bent, feet tucked in beside the barrel.
SEAT_L = ((-0.525, 0.0, 0.85), (-1.085, 0.05, 1.15), 18, 10)
SEAT_R = ((0.525, 0.0, 0.85), (1.085, 0.05, 1.15), 18, 10)
# Heights in the climbing keys were set for a seat this much lower.
UP = SEAT_HIPS - 1.30


def seat(dip=0.0, lean=9):
    legs_dip = dip / CM
    left = ((SEAT_L[0][0], SEAT_L[0][1], SEAT_L[0][2] - legs_dip), *SEAT_L[1:])
    right = ((SEAT_R[0][0], SEAT_R[0][1], SEAT_R[0][2] - legs_dip), *SEAT_R[1:])
    arms = dict(ARMS, grip=(ARMS['grip'][0], ARMS['grip'][1], ARMS['grip'][2] - legs_dip),
                lhand=(ARMS['lhand'][0], ARMS['lhand'][1], ARMS['lhand'][2] - legs_dip))
    return pose(dict(arms, drop=-RAISE + dip, hips_pitch=lean, spine_pitch=2, head_keep=1.0), left, right)


RIDE_KEYS = {
    'ride': [(0.0, lambda: seat()), (0.5, lambda: seat(dip=3.0, lean=11)), (1.0, lambda: seat())],
    'mount': [
        (0.0, lambda: pose({})),
        # Crouch, reaching up for the bull's neck.
        (0.14, lambda: pose(dict(drop=16, hips_pitch=14, spine_pitch=16, grip=(0.34, 0.10, 0.98), staff=(0.1, 0.1, 0.99),
                                 elbow=(0.6, -0.3, -0.4), lhand=(-0.12, 0.42, 1.28), lelbow=(-0.6, -0.2, -0.5)))),
        # Spring up, the right leg swinging out behind.
        (0.30, lambda: pose(dict(drop=-RAISE * 0.55, hips_pitch=22, spine_pitch=20, grip=(0.40, 0.14, 1.42), staff=(0.2, 0.05, 0.97),
                                 elbow=(0.6, -0.3, -0.3), lhand=(-0.12, 0.46, 1.36), lelbow=(-0.6, -0.2, -0.5)),
                            left=((-0.30, 0.05, 0.34 + UP), (-0.55, 0.60, 0.80 + UP), 35),
                            right=((0.42, -0.62, 1.02 + UP), (0.80, -0.10, 1.05 + UP), 45))),
        # Over the top: hips above the saddle, right leg clearing the bull's back.
        (0.46, lambda: pose(dict(ARMS, drop=-RAISE - 16, hips_pitch=16, spine_pitch=12),
                            left=((-0.52, 0.04, 0.72), (-1.00, 0.20, 1.18), 25),
                            right=((0.62, -0.26, 1.08 + UP * 2), (0.98, 0.25, 1.30 + UP * 2), 40))),
        # Land in the saddle with a little squash.
        (0.62, lambda: seat(dip=5, lean=13)),
        (0.75, lambda: seat()),
    ],
    'dismount': [
        (0.0, lambda: seat()),
        # Lean over and bring the right leg up across the back.
        (0.14, lambda: pose(dict(ARMS, drop=-RAISE - 10, hips_pitch=14, spine_pitch=10, spine_roll=-8),
                            left=((-0.54, 0.04, 0.76), (-1.05, 0.20, 1.16), 25),
                            right=((0.40, -0.34, 1.16 + UP * 2), (0.80, 0.20, 1.40 + UP * 2), 40))),
        # Both legs on the left side, sliding down.
        (0.28, lambda: pose(dict(drop=-RAISE * 0.45, hips_pitch=8, spine_pitch=6, grip=(0.36, 0.20, 1.34 + UP / 2), staff=(0.1, 0.15, 0.98),
                                 elbow=(0.6, -0.3, -0.4), lhand=(0.10, 0.40, 1.26), lelbow=(-0.6, -0.2, -0.5)),
                            left=((-0.22, 0.10, 0.26), (-0.30, 0.65, 0.70), 30),
                            right=((0.10, -0.08, 0.34), (0.20, 0.60, 0.75), 30))),
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
