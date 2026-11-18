"""The Pepe Bull's clips, used by build_bull.py: `follow_walk`, `follow_run` and `gallop`.

A gait is a set of periodic curves for the body and a footfall table for the hooves. Each hoof is
planted on the ground and carried backward at exactly the ground speed while it is down, then
swung forward; the legs reach it by IK. Phase 0 is the left hind hoof landing in every gait, so the
game can blend between them in step. Each frame is posed from the phase alone, so every clip loops.

Lengths are the model's units; the game shows the bull 2.636 times larger. Angles are degrees.
+X is the bull's left, -Y forward, +Z up. A positive pitch is nose down.
"""
import math
import bpy
from mathutils import Matrix, Quaternion, Vector
from bull_rig import EAR_L, EAR_R, HEAD_0, HEAD_1, HIPS, LUMBAR, P, SPINE_0, SPINE_1, TAIL_BASE

GAME_SCALE = 2.636
THIGH_LIMIT = math.radians(30)
TAIL = (TAIL_BASE, P + 'TailMid', P + 'TailTip', P + 'TailEnd')
LEGS = {
    'HL': (P + '1_Left_Limb_', False),
    'HR': (P + '1_Right_Limb_', False),
    'FL': (P + '0_Left_Limb_', True),
    'FR': (P + '0_Right_Limb_', True),
}


def rad(d):
    return d * math.pi / 180


def qx(d):
    return Quaternion((1, 0, 0), rad(d))


def qy(d):
    return Quaternion((0, 1, 0), rad(d))


def qz(d):
    return Quaternion((0, 0, 1), rad(d))


class Loop:
    """A smooth periodic curve through (phase, value) knots."""

    def __init__(self, *knots):
        self.t = [k[0] for k in knots]
        self.v = [k[1] for k in knots]
        n = len(knots)
        self.m = []
        for i in range(n):
            a, b = (i - 1) % n, (i + 1) % n
            span = (self.t[b] - self.t[a]) % 1.0 or 1.0
            self.m.append((self.v[b] - self.v[a]) / span)

    def __call__(self, phase):
        p = phase % 1.0
        n = len(self.t)
        i = n - 1
        for j in range(n):
            if self.t[j] <= p:
                i = j
        k = (i + 1) % n
        span = (self.t[k] - self.t[i]) % 1.0 or 1.0
        s = ((p - self.t[i]) % 1.0) / span
        s2, s3 = s * s, s * s * s
        return (2 * s3 - 3 * s2 + 1) * self.v[i] + (s3 - 2 * s2 + s) * span * self.m[i] + (3 * s2 - 2 * s3) * self.v[k] + (s3 - s2) * span * self.m[k]


def wave(amp, cycles=1, lag=0.0):
    return lambda p: amp * math.sin(math.tau * (cycles * p - lag))


def ease(knots, u):
    """Ease between (u, value) knots, flat at each knot."""
    if u <= knots[0][0]:
        return knots[0][1]
    for (a, va), (b, vb) in zip(knots, knots[1:]):
        if u <= b:
            s = (u - a) / (b - a)
            return va + (vb - va) * s * s * (3 - 2 * s)
    return knots[-1][1]


class Rig:
    def __init__(self, arm):
        self.arm = arm
        self.rest, self.parent, self.rel, self.children = {}, {}, {}, {}
        self.order = []

        def visit(b):
            self.order.append(b.name)
            self.children[b.name] = [c.name for c in b.children]
            for c in b.children:
                visit(c)

        for b in arm.data.bones:
            self.rest[b.name] = arm.matrix_world @ b.matrix_local
            self.parent[b.name] = b.parent.name if b.parent else None
            if not b.parent:
                visit(b)
        for n, p in self.parent.items():
            if p:
                self.rel[n] = self.rest[p].inverted() @ self.rest[n]


class Pose:
    """One pose, worked in world axes, with each bone's change kept in its own space for keying."""

    def __init__(self, rig):
        self.rig = rig
        self.loc = {n: Vector() for n in rig.order}
        self.rot = {n: Quaternion() for n in rig.order}
        self.cache = {}

    def base(self, n):
        p = self.rig.parent[n]
        return self.get(p) @ self.rig.rel[n] if p else self.rig.rest[n]

    def get(self, n):
        if n not in self.cache:
            self.cache[n] = self.base(n) @ Matrix.Translation(self.loc[n]) @ self.rot[n].to_matrix().to_4x4()
        return self.cache[n]

    def touch(self, n):
        self.cache.pop(n, None)
        for c in self.rig.children[n]:
            self.touch(c)

    def head(self, n):
        return self.get(n).translation.copy()

    def turn(self, n, q):
        a = self.base(n).to_quaternion()
        self.rot[n] = (a.inverted() @ q @ a) @ self.rot[n]
        self.touch(n)

    def move(self, n, delta):
        self.loc[n] += self.base(n).to_quaternion().inverted() @ delta
        self.touch(n)

    def aim(self, n, target):
        w = self.get(n)
        now = w.to_3x3().col[1].normalized()
        self.turn(n, now.rotation_difference((target - w.translation).normalized()))

    def face(self, n, q):
        self.rot[n] = self.base(n).to_quaternion().inverted() @ q
        self.touch(n)


class Leg:
    def __init__(self, rig, prefix, fore, tip):
        self.fore = fore
        self.bones = [f'{prefix}{i}' for i in range(4)]
        at = [rig.rest[b].translation.copy() for b in self.bones]
        self.a = (at[1] - at[0]).length
        self.b = (at[2] - at[1]).length
        self.c = (at[3] - at[2]).length
        self.hip = at[0]
        self.x = at[3].x
        self.toe_rest = Vector((at[3].x, tip[0], tip[1]))
        self.fetlock_from_toe = at[3] - self.toe_rest
        self.cannon_dx = at[3].x - at[2].x
        self.hoof_rot = rig.rest[self.bones[3]].to_quaternion()


class Gait:
    def __init__(self, name, seconds, speed, frames, duty, beats, **curves):
        self.name, self.seconds, self.speed, self.frames, self.duty, self.beats = name, seconds, speed, frames, duty, beats
        self.stride = speed / GAME_SCALE * seconds
        self.sweep = self.stride * duty
        self.__dict__.update(curves)


WALK = Gait(
    'follow_walk', 0.56, 2.6, 20, 0.60, {'HL': 0.0, 'FL': 0.25, 'HR': 0.5, 'FR': 0.75},
    drop=-0.018,
    bob=Loop((0.05, -0.007), (0.30, 0.006), (0.55, -0.007), (0.80, 0.006)),
    surge=wave(0.004, 2, 0.1),
    sway=wave(0.010, 1, 0.20),
    pitch=wave(1.2, 2, 0.05),
    flex=wave(1.0, 2, 0.30),
    roll=wave(2.0, 1, 0.05),
    yaw=wave(2.2, 1, 0.30),
    stretch=wave(0.003, 2, 0.1),
    neck_bias=1.0, neck=wave(2.6, 2, 0.20), head=wave(-1.8, 2, 0.32), neck_yaw=wave(-2.0, 1, 0.42),
    tail_lift=4.0, tail_pitch=(2.0, 4.0, 6.0, 7.0), tail_cycles=2, tail_side=(5.0, 8.0, 11.0, 12.0),
    ear_back=6.0, ear_flap=(5.0, 2, 0.34),
    lift=(0.040, 0.050), reach=(0.0, -0.012), fold=(26.0, 36.0), hoof_off=26.0, hoof_fold=46.0, narrow=0.94,
)

# A three-beat canter, leading with the right fore: hind, the diagonal pair, fore, then a short float.
RUN = Gait(
    'follow_run', 0.42, 9.5, 16, 0.27, {'HL': 0.0, 'HR': 0.30, 'FL': 0.30, 'FR': 0.58},
    drop=-0.022,
    bob=Loop((0.06, -0.018), (0.26, 0.006), (0.38, -0.012), (0.64, -0.012), (0.90, 0.024)),
    surge=Loop((0.0, -0.018), (0.34, 0.016), (0.62, 0.006), (0.90, -0.022)),
    sway=wave(0.008, 1, 0.1),
    pitch=Loop((0.04, -6.0), (0.30, 0.0), (0.60, 6.5), (0.86, 0.5)),
    flex=Loop((0.0, 5.0), (0.32, -7.0), (0.62, -1.0), (0.90, 8.0)),
    roll=wave(2.5, 1, 0.1),
    yaw=wave(2.0, 1, 0.35),
    stretch=Loop((0.0, 0.010), (0.34, -0.012), (0.90, 0.012)),
    neck_bias=4.0, neck=Loop((0.0, 5.0), (0.30, -2.0), (0.62, -7.0), (0.88, 2.0)), head=Loop((0.0, -2.0), (0.34, 2.5), (0.66, 4.5), (0.92, -2.5)), neck_yaw=wave(-1.5, 1, 0.45),
    tail_lift=20.0, tail_pitch=(5.0, 9.0, 13.0, 16.0), tail_cycles=1, tail_side=(3.0, 5.0, 8.0, 10.0),
    ear_back=16.0, ear_flap=(12.0, 1, 0.30),
    lift=(0.085, 0.110), reach=(-0.012, -0.022), fold=(44.0, 66.0), hoof_off=38.0, hoof_fold=70.0, narrow=0.88,
)

# A four-beat transverse gallop: hind, hind, fore, fore, then the whole bull in the air, gathered.
GALLOP = Gait(
    'gallop', 0.32, 17.0, 16, 0.20, {'HL': 0.0, 'HR': 0.16, 'FL': 0.34, 'FR': 0.50},
    drop=-0.036,
    bob=Loop((0.0, -0.010), (0.11, -0.020), (0.28, -0.004), (0.47, -0.017), (0.62, -0.004), (0.84, 0.022)),
    surge=Loop((0.0, -0.032), (0.20, 0.004), (0.38, 0.036), (0.60, 0.006), (0.90, -0.038)),
    sway=wave(0.006, 1, 0.1),
    pitch=Loop((0.0, -6.0), (0.12, -9.0), (0.30, 0.0), (0.52, 9.5), (0.72, 4.0), (0.90, -3.0)),
    flex=Loop((0.0, 9.0), (0.18, -3.0), (0.38, -15.0), (0.58, -4.0), (0.78, 9.0), (0.92, 15.0)),
    roll=wave(2.2, 1, 0.2),
    yaw=wave(1.8, 1, 0.45),
    stretch=Loop((0.0, 0.012), (0.38, -0.022), (0.66, -0.002), (0.92, 0.022)),
    neck_bias=4.0, neck=Loop((0.0, 6.0), (0.16, 8.0), (0.36, -3.0), (0.56, -9.0), (0.76, -2.0), (0.92, 4.0)), head=Loop((0.0, -3.0), (0.20, -5.0), (0.42, 3.0), (0.62, 7.0), (0.86, 0.0)), neck_yaw=wave(-1.0, 1, 0.5),
    tail_lift=20.0, tail_pitch=(5.0, 8.0, 12.0, 16.0), tail_cycles=1, tail_side=(2.5, 4.0, 7.0, 10.0),
    ear_back=22.0, ear_flap=(16.0, 1, 0.26),
    lift=(0.095, 0.125), reach=(-0.022, -0.034), fold=(46.0, 72.0), hoof_off=48.0, hoof_fold=78.0, narrow=0.80,
)

GAITS = (WALK, RUN, GALLOP)


def hoof_tips(body):
    """Each hoof's front tip and sole in the bind pose: (y, z). A hoof rolls over its real toe."""
    tips = {}
    for name, (prefix, _) in LEGS.items():
        group = body.vertex_groups[f'{prefix}3'].index
        points = [body.matrix_world @ v.co for v in body.data.vertices if any(g.group == group and g.weight > 0.5 for g in v.groups)]
        tips[name] = (min(p.y for p in points), min(p.z for p in points))
    return tips


def hoof_path(g, leg_name, leg, phase):
    """Where the hoof's toe is at this phase: (y, height, hoof pitch, swing progress or None)."""
    t = (phase - g.beats[leg_name]) % 1.0
    centre = leg.toe_rest.y + g.reach[1 if leg.fore else 0]
    if t < g.duty:
        s = t / g.duty
        y = centre - g.sweep / 2 + g.sweep * s
        return y, 0.0, ease([(0.45, 0.0), (1.0, g.hoof_off)], s), None
    u = (t - g.duty) / (1 - g.duty)
    y0, y1 = centre + g.sweep / 2, centre - g.sweep / 2
    m = g.sweep * 0.85
    u2, u3 = u * u, u * u * u
    y = (2 * u3 - 3 * u2 + 1) * y0 + (u3 - 2 * u2 + u) * m + (3 * u2 - 2 * u3) * y1 + (u3 - u2) * m
    height = g.lift[1 if leg.fore else 0] * math.sin(math.pi * u ** 0.72) ** 1.25
    pitch = ease([(0.0, g.hoof_off), (0.38, g.hoof_fold), (0.84, -12.0), (1.0, 0.0)], u)
    return y, height, pitch, u


def solve_leg(pose, g, leg_name, leg, phase, misses):
    y, z, pitch, u = hoof_path(g, leg_name, leg, phase)
    hoof = qx(pitch)
    toe = Vector((leg.x, y, z))
    fetlock = toe + hoof @ leg.fetlock_from_toe
    if leg.fore:
        # The shoulder blade slides along the ribs with the reach of the leg.
        pose.move(leg.bones[0], Vector((0, max(-0.03, min(0.03, (fetlock.y - leg.hip.y) * 0.16)), 0)))
    hip = pose.head(leg.bones[0])
    line = math.atan2(fetlock.y - hip.y, hip.z - fetlock.z)
    alpha = line * (0.95 if leg.fore else 0.80)
    if u is not None:
        alpha += rad(g.fold[1 if leg.fore else 0]) * math.sin(math.pi * u ** 0.78) ** 1.2
    dy = math.sqrt(max(1e-6, leg.c ** 2 - leg.cannon_dx ** 2))
    knee = fetlock - Vector((leg.cannon_dx, dy * math.sin(alpha), -dy * math.cos(alpha)))
    d = knee - hip
    span = d.length
    low, high = abs(leg.a - leg.b) + 0.004, leg.a + leg.b - 0.003
    clamped = max(low, min(high, span))
    if abs(clamped - span) > 1e-6:
        shift = d.normalized() * (clamped - span)
        knee += shift
        fetlock += shift
        if u is None:
            misses.append(shift.length)
    along = d.normalized()
    bend = Vector((0, 1 if leg.fore else -1, 0))
    bend = (bend - along * bend.dot(along)).normalized()
    a = (leg.a ** 2 - leg.b ** 2 + clamped ** 2) / (2 * clamped)
    joint = hip + along * a + bend * math.sqrt(max(0.0, leg.a ** 2 - a ** 2))
    if u is not None:
        # A leg in the air keeps its upper bone within what the skin over the joint can follow.
        v = joint - hip
        swing = math.atan2(-v.y, -v.z)
        if swing > THIGH_LIMIT:
            swing = THIGH_LIMIT + (swing - THIGH_LIMIT) * 0.25
            flat = math.hypot(v.y, v.z)
            joint = Vector((joint.x, hip.y - flat * math.sin(swing), hip.z - flat * math.cos(swing)))
            # The hoof keeps its path: the lower two bones take up the difference.
            to_hoof = fetlock - joint
            far = max(abs(leg.b - leg.c) + 0.004, min(leg.b + leg.c - 0.003, to_hoof.length))
            way = to_hoof.normalized()
            fetlock = joint + way * far
            out = Vector((0, -1 if leg.fore else 1, 0))
            out = (out - way * out.dot(way)).normalized()
            s2 = (leg.b ** 2 - leg.c ** 2 + far ** 2) / (2 * far)
            knee = joint + way * s2 + out * math.sqrt(max(0.0, leg.b ** 2 - s2 ** 2))
    pose.aim(leg.bones[0], joint)
    pose.aim(leg.bones[1], knee)
    pose.aim(leg.bones[2], fetlock)
    pose.face(leg.bones[3], hoof @ leg.hoof_rot)


def pose_gait(rig, g, legs, neck_fix, phase, misses):
    pose = Pose(rig)
    pitch, flex = g.pitch(phase), g.flex(phase)
    pose.move(HIPS, Vector((g.sway(phase), g.surge(phase), g.drop + g.bob(phase))))
    pose.turn(HIPS, qz(g.yaw(phase)) @ qy(g.roll(phase)) @ qx(pitch - flex * 0.5))
    pose.turn(LUMBAR, qz(-g.yaw(phase) * 0.6) @ qx(flex * 0.45))
    pose.turn(SPINE_0, qz(-g.yaw(phase) * 0.4) @ qy(-g.roll(phase) * 0.6) @ qx(flex * 0.35))
    pose.move(SPINE_0, Vector((0, g.stretch(phase), 0)))
    pose.turn(SPINE_1, qx(flex * 0.20))
    # The neck keeps the head steady against the body's rocking, and nods a beat behind it.
    chest = pitch + flex * 0.5
    pose.turn(HEAD_0, Quaternion((0, 0, 1), neck_fix[0]) @ qz(g.neck_yaw(phase)) @ qx(g.neck_bias + g.neck(phase) - chest * 0.55))
    pose.turn(HEAD_1, Quaternion((0, 0, 1), neck_fix[1]) @ qx(g.head(phase) - chest * 0.30))
    # The tail streams out behind and carries the body's bounce down its length.
    lags = (0.06, 0.15, 0.25, 0.36)
    for i, bone in enumerate(TAIL):
        rise = g.tail_pitch[i] * math.sin(math.tau * (g.tail_cycles * phase - lags[i]))
        side = g.tail_side[i] * math.sin(math.tau * (phase - lags[i] - 0.1))
        pose.turn(bone, qz(side) @ qx(rise + (g.tail_lift if i == 0 else g.tail_lift * 0.12)))
    # The ears lie back with speed and flap a beat after the head.
    amp, cycles, lag = g.ear_flap
    flap = amp * math.sin(math.tau * (cycles * phase - lag))
    for bone, s in ((EAR_L, 1), (EAR_R, -1)):
        pose.turn(bone, qy(-s * (flap - g.ear_back * 0.25)) @ qz(s * g.ear_back))
    for name, leg in legs.items():
        solve_leg(pose, g, name, leg, phase, misses)
    return pose


def snapshot(pose, previous):
    frame = {}
    for n in pose.rig.order:
        q = pose.rot[n].normalized()
        if previous and previous[n][1].dot(q) < 0:
            q = -q
        frame[n] = (pose.loc[n].copy(), q)
    return frame


def park(arm, action):
    """Hold a finished clip on its own muted NLA track, where the exporter finds it."""
    action.use_fake_user = True
    track = arm.animation_data.nla_tracks.new()
    track.name = action.name
    track.strips.new(action.name, 0, action)
    track.mute = True


def write_clip(arm, name, frames, step=1):
    action = bpy.data.actions.new(name)
    arm.animation_data_create()
    arm.animation_data.action = action
    for i, frame in enumerate(frames):
        for n, (loc, rot) in frame.items():
            pb = arm.pose.bones[n]
            pb.rotation_mode = 'QUATERNION'
            pb.location = loc
            pb.rotation_quaternion = rot
            pb.scale = (1, 1, 1)
            for path in ('location', 'rotation_quaternion', 'scale'):
                pb.keyframe_insert(path, frame=i * step, group=n)
    arm.animation_data.action = None
    park(arm, action)
    return action


def sample_old_clip(arm, rig, name, neck_fix, step=2):
    """Read the hub's idle back off the rig, with the head brought onto the line of travel."""
    action = bpy.data.actions[name]
    arm.animation_data_create()
    arm.animation_data.action = action
    slots = arm.animation_data.action_suitable_slots
    if slots:
        arm.animation_data.action_slot = slots[0]
    start, end = (int(round(f)) for f in action.frame_range)
    scene = bpy.context.scene
    frames, previous = [], None
    count = (end - start) // step
    for i in range(count + 1):
        scene.frame_set(start + i * step)
        phase = i / count
        pose = Pose(rig)
        for n in rig.order:
            pb = arm.pose.bones[n]
            pose.loc[n] = pb.location.copy()
            pose.rot[n] = pb.rotation_quaternion.copy()
        pose.cache.clear()
        pose.turn(HEAD_0, Quaternion((0, 0, 1), neck_fix[0]))
        pose.turn(HEAD_1, Quaternion((0, 0, 1), neck_fix[1]))
        flick = max(0.0, math.sin(math.tau * (3 * phase))) ** 8
        for bone, s in ((EAR_L, 1), (EAR_R, -1)):
            pose.turn(bone, qy(-s * (5 * math.sin(math.tau * phase) + 14 * flick)) @ qz(s * 8))
        previous = snapshot(pose, previous)
        frames.append(previous)
    arm.animation_data.action = None
    # The hub's idle does not quite close: lean its last quarter onto the first frame.
    n = len(frames) - 1
    blend = max(1, n // 4)
    for i in range(n - blend, n + 1):
        s = (i - (n - blend)) / blend
        s = s * s * (3 - 2 * s)
        for bone, (loc, rot) in frames[i].items():
            loc0, rot0 = frames[0][bone]
            frames[i][bone] = (loc.lerp(loc0, s), rot.slerp(rot0, s))
    return frames, step


def build_clips(arm, neck_fix, body):
    """Replace the hub's clips. Returns each clip's real length in seconds, for the game build."""
    rig = Rig(arm)
    tips = hoof_tips(body)
    legs = {name: Leg(rig, prefix, fore, tips[name]) for name, (prefix, fore) in LEGS.items()}
    idle, idle_step = sample_old_clip(arm, rig, 'idle', neck_fix)
    for a in list(bpy.data.actions):
        bpy.data.actions.remove(a)
    if arm.animation_data:
        for t in list(arm.animation_data.nla_tracks):
            arm.animation_data.nla_tracks.remove(t)
    write_clip(arm, 'idle', idle, idle_step)
    seconds = {}
    for g in GAITS:
        for leg in legs.values():
            leg.x = leg.hip.x * 0.15 + (leg.toe_rest.x * g.narrow) * 0.85
        frames, previous, misses = [], None, []
        for i in range(g.frames + 1):
            previous = snapshot(pose_gait(rig, g, legs, neck_fix, i / g.frames, misses), previous)
            frames.append(previous)
        write_clip(arm, g.name, frames)
        seconds[g.name] = g.seconds
        print(f'CLIP {g.name}: {g.seconds:.3f} s, stride {g.stride:.2f}, hoof sweep {g.sweep:.3f}, '
              f'reach misses {len(misses)} (worst {max(misses, default=0):.4f})')
    return seconds
