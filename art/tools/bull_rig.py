"""The Pepe Bull's rig repairs, used by build_bull.py.

The hub's auto-rig has the whole trunk on two bones, the body turned 13 degrees off its line of
travel, skin that drags the back with the legs, no ears, and leaf bones nothing uses. Lengths are
the model's own units; +Y is toward the tail, -Y is forward, +X is the bull's left.
"""
import math
import bmesh
import bpy
from mathutils import Matrix, Vector
from mathutils.bvhtree import BVHTree
from mathutils.interpolate import poly_3d_calc

P = 'tripo::'
HIPS, LUMBAR = 'Hips', 'Lumbar'
EAR_L, EAR_R = 'Ear_L', 'Ear_R'
SPINE_0, SPINE_1 = P + 'Spine_0', P + 'Spine_1'
HEAD_0, HEAD_1, HEAD_2 = P + 'Head_0', P + 'Head_1', P + 'Head_2'
TAIL_BASE = P + 'TailBase'
HIND_ROOTS = (P + '1_Left_Limb_0', P + '1_Right_Limb_0')
FORE_ROOTS = (P + '0_Left_Limb_0', P + '0_Right_Limb_0')
# Leaf bones that carry almost no skin: their weight goes to the parent and the bone goes away.
JUNK = {
    P + 'Head_3': HEAD_2,
    P + '0_Left_Limb_4': P + '0_Left_Limb_3',
    P + '0_Right_Limb_4': P + '0_Right_Limb_3',
    P + '1_Right_Limb_4': P + '1_Right_Limb_3',
    P + '1_Right_Limb_5': P + '1_Right_Limb_3',
}
MAX_INFLUENCES = 4
EAR_LENGTH = 0.118
EAR_TIP = math.radians(55)


def smooth(t):
    t = max(0.0, min(1.0, t))
    return t * t * (3 - 2 * t)


def bone_head(arm, name):
    return arm.matrix_world @ arm.data.bones[name].head_local


def straighten(arm, seat_y):
    """Turn the model about the seat so its spine runs along the line of travel, centred on it."""
    bpy.context.view_layer.update()
    hips = (bone_head(arm, HIND_ROOTS[0]) + bone_head(arm, HIND_ROOTS[1])) / 2
    chest = (bone_head(arm, FORE_ROOTS[0]) + bone_head(arm, FORE_ROOTS[1])) / 2
    d = chest - hips
    yaw = -math.atan2(d.x, -d.y)
    pivot = Vector((0, seat_y, 0))
    turn = Matrix.Translation(pivot) @ Matrix.Rotation(yaw, 4, 'Z') @ Matrix.Translation(-pivot)
    off = (turn @ hips).x
    top = arm
    while top.parent:
        top = top.parent
    top.matrix_world = Matrix.Translation((-off, 0, 0)) @ turn @ top.matrix_world
    bpy.context.view_layer.update()
    return yaw


def head_yaw(body):
    """How far the head is turned from straight ahead (radians), read from its two horn tips."""
    world = [body.matrix_world @ v.co for v in body.data.vertices]
    left = max((p for p in world if p.x > 0), key=lambda p: p.z)
    right = max((p for p in world if p.x < 0), key=lambda p: p.z)
    v = left - right
    return math.atan2(v.y, v.x)


def neck_fix(arm, yaw):
    """Yaw for the neck and the head (radians) that bring the head back onto the line of travel."""
    n, h = bone_head(arm, HEAD_0), bone_head(arm, HEAD_1)
    w = h - n
    neck = -math.atan2(w.x, -w.y)
    return neck, -yaw - neck


def ear_anchor(arm, tree, yaw, side):
    """Where an ear joins the head, and the way it points. `side` is +1 for left, -1 for right."""
    out = Vector((math.cos(yaw), math.sin(yaw), 0)) * side
    back = Vector((-math.sin(yaw), math.cos(yaw), 0))
    centre = bone_head(arm, HEAD_1)
    # Under the horn, where the skull meets the neck: the horn itself is higher than this.
    start = centre + out * 0.6 - back * 0.012 + Vector((0, 0, -0.030))
    hit = tree.ray_cast(start, -out, 1.0)[0]
    root = hit - out * 0.008
    return root, (out + back * 0.12 + Vector((0, 0, 0.30))).normalized()


def rebuild_bones(arm, ears):
    """Add the hips, the loin and the ears; drop the empty leaf bones. `ears` maps bone to (head, tail)."""
    bpy.context.view_layer.objects.active = arm
    arm.select_set(True)
    bpy.ops.object.mode_set(mode='EDIT')
    to_arm = arm.matrix_world.inverted()
    eb = arm.data.edit_bones
    hip_w = (bone_head(arm, HIND_ROOTS[0]) + bone_head(arm, HIND_ROOTS[1])) / 2
    spine_w = bone_head(arm, SPINE_0)
    hip_at = Vector((0, hip_w.y, hip_w.z + 0.01))
    loin_at = hip_at.lerp(spine_w, 0.45)

    def add(name, head, tail, parent):
        b = eb.new(name)
        b.head, b.tail = to_arm @ head, to_arm @ tail
        b.parent = eb[parent]
        b.use_connect = False
        b.use_deform = True
        return b

    add(HIPS, hip_at, loin_at, P + 'Root')
    add(LUMBAR, loin_at, spine_w, HIPS)
    for name in (*HIND_ROOTS, TAIL_BASE):
        eb[name].use_connect = False
        eb[name].parent = eb[HIPS]
    eb[SPINE_0].use_connect = False
    eb[SPINE_0].parent = eb[LUMBAR]
    for name, (head, tail) in ears.items():
        add(name, head, tail, HEAD_1)
    for name in JUNK:
        eb.remove(eb[name])
    bpy.ops.object.mode_set(mode='OBJECT')
    bpy.context.view_layer.update()


def set_weights(obj, per_vertex):
    """Replace a mesh's skin. `per_vertex` holds one {bone: weight} for each vertex."""
    for g in list(obj.vertex_groups):
        obj.vertex_groups.remove(g)
    groups = {}
    for i, weights in enumerate(per_vertex):
        top = sorted(weights.items(), key=lambda kv: -kv[1])[:MAX_INFLUENCES]
        total = sum(w for _, w in top) or 1.0
        for name, w in top:
            if name not in groups:
                groups[name] = obj.vertex_groups.new(name=name)
            groups[name].add([i], w / total, 'REPLACE')


def trunk_split(y):
    """The trunk's share of a vertex this far along the body, shared across the four spine bones."""
    hips = 1 - smooth((0.215 - y) / 0.10)
    spine_1 = smooth((-0.055 - y) / 0.11)
    spine_0 = smooth((0.118 - y) / 0.10) - spine_1
    loin = max(0.0, 1.0 - hips - spine_0 - spine_1)
    return {HIPS: hips, LUMBAR: loin, SPINE_0: spine_0, SPINE_1: spine_1}


def reweight_body(body, arm):
    """
    Give the barrel a smooth bend along all four spine bones, and take the legs' weight off the back
    (the top of the shoulders and rump, and anything across the body's middle), so a swinging leg
    can no longer drag the skin under the saddle.
    """
    names = [g.name for g in body.vertex_groups]
    limb_roots = {n: bone_head(arm, n) for n in (*HIND_ROOTS, *FORE_ROOTS)}
    trunk = {P + 'Root', SPINE_0, SPINE_1}
    out = []
    for v in body.data.vertices:
        p = body.matrix_world @ v.co
        weights = {}
        for g in v.groups:
            name = JUNK.get(names[g.group], names[g.group])
            if g.weight > 1e-4:
                weights[name] = weights.get(name, 0.0) + g.weight
        spare = sum(weights.pop(n, 0.0) for n in trunk)
        for name, root in limb_roots.items():
            fore = name in FORE_ROOTS
            for bone in (name, name.replace('Limb_0', 'Limb_1')):
                w = weights.get(bone, 0.0)
                if not w:
                    continue
                # Fade out up over the joint, along the ribs (a hard edge there shows as a flap when
                # the leg swings), and on the far side of the body.
                keep = 1 - smooth((p.z - (root.z - 0.16)) / 0.15)
                along = (p.y - root.y) if fore else (root.y - p.y)
                keep *= 1 - smooth((along - 0.035) / 0.115)
                if p.x * root.x < 0:
                    keep *= 1 - smooth((abs(p.x) - 0.005) / 0.035)
                weights[bone] = w * keep
                spare += w * (1 - keep)
        if spare > 1e-4:
            for name, share in trunk_split(p.y).items():
                if share > 1e-4:
                    weights[name] = weights.get(name, 0.0) + spare * share
        neck_blend(p, weights)
        out.append({k: w for k, w in weights.items() if w > 1e-3})
    set_weights(body, out)


def neck_blend(p, weights):
    """Bend the neck over its whole length, not at one crease. The horns stay rigid on the skull."""
    if abs(p.x) > 0.12 and p.z > 0.44:
        return
    t = smooth((-0.12 - p.y) / 0.14)
    if t <= 0 or t >= 1:
        return
    share = sum(weights.pop(n, 0.0) for n in (SPINE_1, HEAD_0, HEAD_1))
    if share <= 1e-4:
        return
    for name, s in ((SPINE_1, (1 - t) ** 2), (HEAD_0, 2 * t * (1 - t)), (HEAD_1, t * t)):
        weights[name] = weights.get(name, 0.0) + share * s


def copy_skin(body, target):
    """Skin `target` exactly as the body surface beneath it, so the two can only move together."""
    world = [body.matrix_world @ v.co for v in body.data.vertices]
    polys = [tuple(p.vertices) for p in body.data.polygons]
    tree = BVHTree.FromPolygons(world, polys)
    names = [g.name for g in body.vertex_groups]
    skin = [{names[g.group]: g.weight for g in v.groups} for v in body.data.vertices]
    out = []
    for v in target.data.vertices:
        p = target.matrix_world @ v.co
        loc, _, index, _ = tree.find_nearest(p)
        ids = polys[index]
        share = poly_3d_calc([world[i] for i in ids], loc)
        mixed = {}
        for i, s in zip(ids, share):
            for name, w in skin[i].items():
                mixed[name] = mixed.get(name, 0.0) + w * s
        out.append(mixed)
    set_weights(target, out)


def ear_mesh(name, body, anchors, parent_setup):
    """Two soft leaf-shaped ears, coloured from the head's own skin, each on its own bone."""
    to_local = body.matrix_world.inverted()
    verts, faces, owner = [], [], []
    length, width, depth = EAR_LENGTH, 0.040, 0.009
    rings, around = 6, 8
    for bone, (root, tip) in anchors.items():
        axis = (tip - root).normalized()
        # The broad face is tipped up toward the front, so the ear reads from ahead and from behind.
        level = axis.cross(Vector((0, 0, 1))).normalized()
        flat = (level * math.cos(EAR_TIP) + level.cross(axis).normalized() * math.sin(EAR_TIP)).normalized()
        up = flat.cross(axis).normalized()
        start = len(verts)
        for r in range(rings):
            t = r / rings
            w = width * math.sin(math.pi * (0.16 + 0.84 * t)) ** 0.75 + 0.002
            d = depth * (1 - t * 0.65)
            centre = root + axis * length * t + up * (-0.018 * math.sin(math.pi * t))
            for a in range(around):
                c = a / around * math.tau
                # A shallow cup: the inner face is pressed in toward the back of the ear.
                cup = -0.006 * (1 - math.cos(c) ** 2) * (1 if math.sin(c) > 0 else 0)
                verts.append(to_local @ (centre + flat * (math.cos(c) * w) + up * (math.sin(c) * d + cup)))
                owner.append(bone)
        verts.append(to_local @ (root + axis * length))
        owner.append(bone)
        tip_index = len(verts) - 1
        for r in range(rings - 1):
            for a in range(around):
                b = (a + 1) % around
                i = start + r * around
                faces.append((i + a, i + b, i + around + b, i + around + a))
        last = start + (rings - 1) * around
        for a in range(around):
            faces.append((last + a, last + (a + 1) % around, tip_index))
    me = bpy.data.meshes.new(name)
    me.from_pydata(verts, [], faces)
    bm = bmesh.new()
    bm.from_mesh(me)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(me)
    bm.free()
    me.update()
    for p in me.polygons:
        p.use_smooth = True
    # Every ear corner samples the head's green, from the body corner nearest the ear's root.
    source_uv = body.data.uv_layers.active.data
    root = next(iter(anchors.values()))[0]
    near = min(body.data.loops, key=lambda l: (body.matrix_world @ body.data.vertices[l.vertex_index].co - root).length_squared)
    uv = source_uv[near.index].uv.copy()
    layer = me.uv_layers.new(name=body.data.uv_layers.active.name)
    for d in layer.data:
        d.uv = uv
    me.materials.append(body.data.materials[0])
    obj = bpy.data.objects.new(name, me)
    bpy.context.collection.objects.link(obj)
    parent_setup(obj)
    set_weights(obj, [{bone: 1.0} for bone in owner])
    return obj
