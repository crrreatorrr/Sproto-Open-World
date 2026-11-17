"""Author the player's melee clips in Blender.

Run inside Blender with the decoded rig (art/source/wizard_player_decoded.glb) imported and the
preview staff parented to RightHand:

    exec(open('<repo>/art/tools/melee_anim.py').read())

Every clip is rebuilt from scratch on each run, so tweak the POSES / CLIPS tables and re-run.

Coordinates in the tables are in the character's frame, metres from the centre of the feet:
    r = to the character's right, f = forward (the way the character faces), u = up.
The character faces Blender -Y, so world = (-r, -f, u). Yaw is in degrees, positive = turn left.
Pitch is degrees, positive = lean forward.

The staff is posed directly: `grip` is where the right fist holds the shaft and `staff` is the
direction from the butt to the head. Arms and legs are solved with two-bone IK, feet stay planted
unless a foot offset is given.
"""
import math
import os
import bpy
from mathutils import Matrix, Vector

FPS = 24
ARM_NAME = 'Armature'
BASE_ACTION = 'idle'
# Staff grip at bind pose, in world metres (from socket_staff extras.bindPoseWorld).
GRIP_REST_WORLD = Vector((-0.434, -0.177, 1.099))

arm = bpy.data.objects[ARM_NAME]
pbones = arm.pose.bones
CM = 100.0  # armature space is centimetres (armature object scale 0.01)


def C(r, f, u):
    """Character-frame metres -> armature-space centimetres."""
    return Vector((-r, -f, u)) * CM


def D(r, f, u):
    """Character-frame direction -> armature-space unit vector."""
    return Vector((-r, -f, u)).normalized()


# ---------------------------------------------------------------- hierarchy helpers
CHILDREN = {pb.name: [c.name for c in pb.children] for pb in pbones}


def desc(name):
    out = [name]
    for c in CHILDREN[name]:
        out += desc(c)
    return out


def rotate(M, bone, axis, deg, pivot=None):
    p = M[bone].translation.copy() if pivot is None else pivot
    R = Matrix.Translation(p) @ Matrix.Rotation(math.radians(deg), 4, axis) @ Matrix.Translation(-p)
    for d in desc(bone):
        M[d] = R @ M[d]


def rotate_q(M, bone, quat, pivot=None):
    p = M[bone].translation.copy() if pivot is None else pivot
    R = Matrix.Translation(p) @ quat.to_matrix().to_4x4() @ Matrix.Translation(-p)
    for d in desc(bone):
        M[d] = R @ M[d]


def move(M, bone, v):
    T = Matrix.Translation(v)
    for d in desc(bone):
        M[d] = T @ M[d]


def two_bone(M, upper, lower, end, target, pole):
    S = M[upper].translation.copy()
    E = M[lower].translation.copy()
    W = M[end].translation.copy()
    l1 = (E - S).length
    l2 = (W - E).length
    to_t = target - S
    d = max(min(to_t.length, (l1 + l2) * 0.999), abs(l1 - l2) * 1.001 + 1e-4)
    dirv = to_t.normalized()
    a = (l1 * l1 - l2 * l2 + d * d) / (2 * d)
    h = math.sqrt(max(l1 * l1 - a * a, 0.0))
    pp = pole - S
    pp = pp - dirv * pp.dot(dirv)
    if pp.length < 1e-6:
        pp = Vector((0, -1, 0))
    pp.normalize()
    E_new = S + dirv * a + pp * h
    rotate_q(M, upper, (E - S).rotation_difference(E_new - S))
    E2 = M[lower].translation.copy()
    W2 = M[end].translation.copy()
    rotate_q(M, lower, (W2 - E2).rotation_difference(S + dirv * d - E2))


def set_world_rot(M, bone, rot3):
    """Rotate `bone` (and children) about its head so its armature-space rotation is rot3."""
    cur = M[bone].to_3x3().normalized()
    delta = (rot3 @ cur.inverted()).to_quaternion()
    rotate_q(M, bone, delta)


def staff_frame(dirv):
    z = dirv.normalized()
    hint = Vector((0, -1, 0))  # character forward in world
    if abs(z.dot(hint)) > 0.9:
        hint = Vector((0, 0, 1))
    y = -(hint - z * hint.dot(z))
    y.normalize()
    x = y.cross(z)
    m = Matrix((x, y, z)).transposed()  # columns x, y, z
    return m


# ---------------------------------------------------------------- base pose
def base_pose():
    ad = arm.animation_data
    saved = (ad.action, [t.mute for t in ad.nla_tracks])
    for t in ad.nla_tracks:
        t.mute = True
    ad.action = bpy.data.actions[BASE_ACTION]
    bpy.context.scene.frame_set(0)
    bpy.context.view_layer.update()
    M = {pb.name: pb.matrix.copy() for pb in pbones}
    ad.action = saved[0]
    for t, m in zip(ad.nla_tracks, saved[1]):
        t.mute = m
    return M


M0 = base_pose()
HAND_REST = arm.data.bones['RightHand'].matrix_local.to_3x3().normalized()
# grip offset from the hand head, in the hand's local frame (cm)
_grip_rest = GRIP_REST_WORLD * CM
GRIP_LOCAL = HAND_REST.inverted() @ (_grip_rest - arm.data.bones['RightHand'].head_local)
ANIMATED = sorted({fc.data_path.split('"')[1]
                   for fc in bpy.data.actions[BASE_ACTION].layers[0].strips[0]
                   .channelbag(bpy.data.actions[BASE_ACTION].slots[0]).fcurves})


# ---------------------------------------------------------------- pose builder
def build(spec):
    """spec keys (all optional):
    drop (cm down), shift (r,f in cm), hips_yaw, hips_pitch, spine_yaw, spine_pitch, spine_roll,
    head_keep (0..1 of torso yaw undone at the head), grip (r,f,u m), staff (r,f,u dir),
    elbow (r,f,u m pole relative to shoulder), lhand (r,f,u m) or lhand_on_staff (m along staff
    from grip), lelbow, lfoot / rfoot (r,f,u cm offset), lfoot_yaw / rfoot_yaw.
    """
    M = {k: v.copy() for k, v in M0.items()}
    up = Vector((0, 0, 1))
    side = Vector((1, 0, 0))  # world X = character's left; rotating about +X leans forward

    # hips
    sh = spec.get('shift', (0, 0))
    move(M, 'Hips', C(sh[0] / CM, sh[1] / CM, -spec.get('drop', 0) / CM))
    rotate(M, 'Hips', up, spec.get('hips_yaw', 0))
    rotate(M, 'Hips', side, spec.get('hips_pitch', 0))

    # spine, spread over three bones
    for b in ('Spine02', 'Spine01', 'Spine'):
        rotate(M, b, up, spec.get('spine_yaw', 0) / 3)
        rotate(M, b, side, spec.get('spine_pitch', 0) / 3)
        rotate(M, b, Vector((0, -1, 0)), spec.get('spine_roll', 0) / 3)

    # keep the eyes roughly on the target
    total_yaw = spec.get('hips_yaw', 0) + spec.get('spine_yaw', 0)
    total_pitch = spec.get('hips_pitch', 0) + spec.get('spine_pitch', 0)
    keep = spec.get('head_keep', 0.6)
    rotate(M, 'neck', up, -total_yaw * keep * 0.5)
    rotate(M, 'Head', up, -total_yaw * keep * 0.5)
    rotate(M, 'neck', side, -total_pitch * keep * 0.6)

    # right arm + staff
    if 'grip' in spec:
        Srot = staff_frame(D(*spec['staff']))
        Hrot = Srot @ HAND_REST
        grip = C(*spec['grip'])
        hand_head = grip - Hrot @ GRIP_LOCAL
        el = spec.get('elbow', (0.55, -0.35, -0.45))
        pole = M['RightArm'].translation + C(*el)
        two_bone(M, 'RightArm', 'RightForeArm', 'RightHand', hand_head, pole)
        set_world_rot(M, 'RightHand', Hrot)

    # left arm
    lt = None
    if 'lhand_on_staff' in spec and 'grip' in spec:
        lt = C(*spec['grip']) + D(*spec['staff']) * spec['lhand_on_staff'] * CM
    elif 'lhand' in spec:
        lt = C(*spec['lhand'])
    if lt is not None:
        lel = spec.get('lelbow', (-0.55, -0.35, -0.45))
        pole = M['LeftArm'].translation + C(*lel)
        two_bone(M, 'LeftArm', 'LeftForeArm', 'LeftHand', lt, pole)

    # legs: feet back on their (optionally offset) marks, flat on the ground
    for s, key in (('Left', 'lfoot'), ('Right', 'rfoot')):
        off = spec.get(key, (0, 0, 0))
        target = M0[s + 'Foot'].translation + C(off[0] / CM, off[1] / CM, off[2] / CM)
        knee_fwd = Matrix.Rotation(math.radians(spec.get('hips_yaw', 0) * 0.5), 3, up) @ Vector((0, -1, 0))
        pole = M[s + 'Leg'].translation + knee_fwd * 40 + up * 10
        two_bone(M, s + 'UpLeg', s + 'Leg', s + 'Foot', target, pole)
        frot = Matrix.Rotation(math.radians(spec.get(key + '_yaw', 0)), 3, up) @ M0[s + 'Foot'].to_3x3().normalized()
        set_world_rot(M, s + 'Foot', frot)
        # toes follow the foot (already rotated with it), nothing else to do
    return M


def to_basis(M):
    out = {}
    for pb in pbones:
        b = pb.bone
        if b.parent is None:
            out[b.name] = b.matrix_local.inverted() @ M[b.name]
        else:
            rest_rel = b.parent.matrix_local.inverted() @ b.matrix_local
            out[b.name] = rest_rel.inverted() @ M[b.parent.name].inverted() @ M[b.name]
    return out


# ---------------------------------------------------------------- clip writer
def write_clip(name, keys):
    """keys: list of (seconds, spec_or_matrices)."""
    old = bpy.data.actions.get(name)
    if old:
        for t in list(arm.animation_data.nla_tracks):
            if t.name == name:
                arm.animation_data.nla_tracks.remove(t)
        bpy.data.actions.remove(old)
    act = bpy.data.actions.new(name)
    ad = arm.animation_data
    ad.action = act
    for t, spec in keys:
        M = spec if isinstance(spec, dict) and 'Hips' in spec and isinstance(spec['Hips'], Matrix) else build(spec)
        B = to_basis(M)
        f = round(t * FPS)  # keys on whole frames, so the exported clip ends exactly on its last key
        for bn in ANIMATED:
            pb = pbones[bn]
            loc, rot, _ = B[bn].decompose()
            pb.rotation_quaternion = rot
            pb.keyframe_insert('rotation_quaternion', frame=f, group=bn)
            if bn == 'Hips':
                pb.location = loc
                pb.keyframe_insert('location', frame=f, group=bn)
    # keep quaternions on the short path between keys
    cb = act.layers[0].strips[0].channelbag(act.slots[0])
    for bn in ANIMATED:
        fcs = [cb.fcurves.find(f'pose.bones["{bn}"].rotation_quaternion', index=i) for i in range(4)]
        n = len(fcs[0].keyframe_points)
        for k in range(1, n):
            prev = Vector([fc.keyframe_points[k - 1].co[1] for fc in fcs])
            cur = Vector([fc.keyframe_points[k].co[1] for fc in fcs])
            if prev.dot(cur) < 0:
                for fc in fcs:
                    fc.keyframe_points[k].co[1] *= -1
        for fc in fcs:
            fc.update()
    for fc in cb.fcurves:
        for kp in fc.keyframe_points:
            kp.interpolation = 'BEZIER'
            kp.handle_left_type = kp.handle_right_type = 'AUTO_CLAMPED'
        fc.update()
    act.use_fake_user = True
    ad.action = None
    tr = ad.nla_tracks.new()
    tr.name = name
    tr.strips.new(name, 0, act)
    tr.mute = True
    return act


IDLE = {}  # empty spec = the idle frame-0 pose with feet planted

# ---------------------------------------------------------------- key poses
P = {
    # light 1: forehand diagonal slash, high right to low left
    'l1_wind': dict(hips_yaw=-15, spine_yaw=-30, spine_pitch=-4, drop=3,
                    grip=(0.40, 0.05, 1.40), staff=(0.75, -0.45, 0.45), elbow=(0.6, -0.2, 0.1),
                    lhand=(-0.12, 0.35, 1.10)),
    'l1_hit': dict(hips_yaw=10, spine_yaw=18, spine_pitch=10, drop=7, lfoot=(0, 16, 0),
                   grip=(0.08, 0.50, 1.20), staff=(-0.15, 0.97, 0.05), elbow=(0.5, -0.1, -0.5),
                   lhand=(-0.38, 0.05, 1.05)),
    'l1_follow': dict(hips_yaw=20, spine_yaw=35, spine_pitch=12, drop=8, lfoot=(0, 16, 0),
                      grip=(-0.25, 0.38, 1.05), staff=(-0.85, -0.15, -0.25), elbow=(0.3, -0.3, -0.6),
                      lhand=(-0.40, -0.12, 1.00)),
    # light 2: backhand slash, low left to high right
    'l2_wind': dict(hips_yaw=22, spine_yaw=45, spine_pitch=6, drop=6, lfoot=(0, 10, 0),
                    grip=(-0.35, 0.25, 1.20), staff=(-0.8, -0.3, 0.35), elbow=(0.2, -0.5, -0.3),
                    lhand=(-0.35, -0.05, 1.05)),
    'l2_hit': dict(hips_yaw=-8, spine_yaw=-18, spine_pitch=10, drop=7, rfoot=(0, 14, 0),
                   grip=(0.05, 0.55, 1.22), staff=(0.15, 0.97, 0.10), elbow=(0.6, -0.1, -0.4),
                   lhand=(-0.30, 0.20, 1.05)),
    'l2_follow': dict(hips_yaw=-18, spine_yaw=-38, spine_pitch=6, drop=6, rfoot=(0, 14, 0),
                      grip=(0.45, 0.25, 1.30), staff=(0.8, -0.35, 0.3), elbow=(0.6, -0.3, -0.2),
                      lhand=(-0.15, 0.30, 1.10)),
    # light 3: two-handed overhead slam
    'l3_wind': dict(hips_pitch=-4, spine_pitch=-14, drop=-2,
                    grip=(0.08, -0.02, 1.95), staff=(0.0, -0.75, 0.65), elbow=(0.5, 0.0, 0.2),
                    lhand_on_staff=0.28, lelbow=(-0.5, 0.0, 0.2)),
    'l3_hit': dict(hips_pitch=10, spine_pitch=22, drop=20, lfoot=(0, 24, 0), rfoot=(0, -6, 0),
                   grip=(0.06, 0.55, 0.88), staff=(0.0, 0.75, -0.62), elbow=(0.45, -0.2, -0.4),
                   lhand_on_staff=0.28, lelbow=(-0.45, -0.2, -0.4)),
    'l3_settle': dict(hips_pitch=10, spine_pitch=24, drop=23, lfoot=(0, 24, 0), rfoot=(0, -6, 0),
                      grip=(0.06, 0.55, 0.80), staff=(0.0, 0.72, -0.68), elbow=(0.45, -0.2, -0.4),
                      lhand_on_staff=0.28, lelbow=(-0.45, -0.2, -0.4)),
    # heavy: coiled wind-up, then a full-body horizontal sweep
    'h_wind': dict(hips_yaw=-25, spine_yaw=-45, spine_pitch=6, drop=12, rfoot=(0, -14, 0),
                   grip=(0.50, -0.25, 1.25), staff=(0.6, -0.75, 0.15), elbow=(0.6, -0.2, -0.2),
                   lhand_on_staff=0.25, lelbow=(-0.3, -0.5, -0.3)),
    'h_charge': dict(hips_yaw=-27, spine_yaw=-48, spine_pitch=8, drop=14, rfoot=(0, -14, 0),
                     grip=(0.51, -0.27, 1.23), staff=(0.6, -0.75, 0.13), elbow=(0.6, -0.2, -0.2),
                     lhand_on_staff=0.25, lelbow=(-0.3, -0.5, -0.3)),
    'h_hit': dict(hips_yaw=22, spine_yaw=28, spine_pitch=14, drop=14, lfoot=(0, 28, 0), rfoot=(0, -10, 0),
                  grip=(0.0, 0.62, 1.12), staff=(-0.2, 0.97, 0.0), elbow=(0.5, -0.1, -0.5),
                  lhand_on_staff=0.25, lelbow=(-0.3, -0.5, -0.4)),
    'h_follow': dict(hips_yaw=32, spine_yaw=48, spine_pitch=14, drop=13, lfoot=(0, 28, 0), rfoot=(0, -10, 0),
                     grip=(-0.45, 0.25, 1.00), staff=(-0.85, -0.45, -0.1), elbow=(0.3, -0.4, -0.5),
                     lhand_on_staff=0.25, lelbow=(-0.2, -0.6, -0.3)),
    # block: staff held across the body, both hands on it
    'block': dict(hips_pitch=4, spine_pitch=8, drop=10, lfoot=(-6, 6, 0), rfoot=(6, -4, 0),
                  grip=(0.26, 0.38, 1.12), staff=(-1.0, 0.08, 0.22), elbow=(0.6, -0.2, -0.4),
                  lhand_on_staff=0.50, lelbow=(-0.6, -0.2, -0.4)),
}

# (clip, keys as (seconds, pose name)), plus gameplay timing metadata exported to JSON
CLIPS = {
    'attack_light_1': [(0.0, 'IDLE'), (0.12, 'l1_wind'), (0.20, 'l1_hit'), (0.30, 'l1_follow'), (0.62, 'IDLE')],
    'attack_light_2': [(0.0, 'l1_follow'), (0.10, 'l2_wind'), (0.18, 'l2_hit'), (0.28, 'l2_follow'), (0.62, 'IDLE')],
    'attack_light_3': [(0.0, 'l2_follow'), (0.24, 'l3_wind'), (0.34, 'l3_hit'), (0.48, 'l3_settle'), (0.90, 'IDLE')],
    'attack_heavy': [(0.0, 'IDLE'), (0.30, 'h_wind'), (0.48, 'h_charge'), (0.58, 'h_hit'), (0.72, 'h_follow'), (1.15, 'IDLE')],
    'block': [(0.0, 'IDLE'), (0.12, 'block'), (0.50, 'block')],
}

TIMING = {
    # seconds: startup ends / active window / recovery; cancel = earliest chain into the next attack
    # `end` is filled in from the clip's last key (rounded to a whole 24 fps frame) by build_all().
    'attack_light_1': dict(active=[0.14, 0.26], cancel=0.34),
    'attack_light_2': dict(active=[0.12, 0.24], cancel=0.32),
    'attack_light_3': dict(active=[0.30, 0.40], cancel=0.60),
    'attack_heavy': dict(charge=[0.30, 0.48], active=[0.52, 0.64], cancel=0.80),
    'block': dict(raise_done=0.12, hold_from=0.12),
}


# The .blend lives in art/source, so the repo root is two folders up from it.
REPO = os.path.abspath(os.path.join(os.path.dirname(bpy.data.filepath), '..', '..'))
TIMING_JSON = os.path.join(REPO, 'public', 'assets', 'models', 'characters', 'player.melee.json')


def write_timing_json():
    import json
    clips = {}
    for name, keys in CLIPS.items():
        t = dict(TIMING[name])
        t['end'] = round(round(keys[-1][0] * FPS) / FPS, 4)
        clips[name] = t
    out = {
        'source': 'art/tools/melee_anim.py (generated, do not edit by hand)',
        'units': 'seconds',
        'weapon': 'staff (right hand, socket_staff)',
        'notes': 'active = hitbox window; cancel = earliest time the next combo step may start; '
                 'charge = heavy hold window (freeze or loop here while the button is held); '
                 'end = clip duration. attack_light_2 starts from attack_light_1\'s follow-through '
                 'pose and attack_light_3 from attack_light_2\'s, so chain them at or after cancel.',
        'clips': clips,
    }
    with open(TIMING_JSON, 'w') as f:
        json.dump(out, f, indent=2)
        f.write('\n')


def build_all():
    for name, keys in CLIPS.items():
        write_clip(name, [(t, IDLE if p == 'IDLE' else P[p]) for t, p in keys])
    write_timing_json()
    print('built', list(CLIPS))


build_all()


def show(name):
    """Preview helper: play one clip on the armature with the NLA tracks muted."""
    ad = arm.animation_data
    for t in ad.nla_tracks:
        t.mute = True
    ad.action = bpy.data.actions[name]
    bpy.context.scene.frame_start = 0
    bpy.context.scene.frame_end = int(math.ceil(ad.action.frame_range[1]))
