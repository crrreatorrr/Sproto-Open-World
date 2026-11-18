"""Make the rideable Pepe Bull from the hub's pet, without the UI:

    /Applications/Blender.app/Contents/MacOS/Blender --background --factory-startup \
      --python art/tools/build_bull.py

Reads art/source/pepe_bull_decoded.glb (the hub's `pet_pepe_bull`, decoded), turns it onto its line
of travel, slims the barrel where the rider's legs go, repairs the rig (bull_rig.py), adds a fitted
blanket, saddle and ears, authors the clips (bull_anim.py) and exports art/source/pepe_bull_raw.glb.
Then run `node art/tools/build-bull-glb.mjs`. Lengths here are the model's own units: the game fits
the bull to 1.7 m, which is 2.64 times larger.
"""
import json
import math
import os
import sys
import bpy
import bmesh
from mathutils import Vector
from mathutils.bvhtree import BVHTree

TOOLS = os.path.dirname(os.path.abspath(__file__ if '__file__' in globals() else bpy.context.space_data.text.filepath))
sys.path.insert(0, TOOLS)
sys.dont_write_bytecode = True
import bull_anim  # noqa: E402
import bull_rig  # noqa: E402

SOURCE = os.path.abspath(os.path.join(TOOLS, '..', 'source'))

# Where the rider sits, along the body (+Y is toward the tail).
SEAT_Y = 0.070
# The barrel keeps this fraction of its width at the seat, blending back to full width by the ends.
SLIM = 0.70
SLIM_CORE = 0.11
SLIM_FADE = 0.17
# Blanket and saddle.
BLANKET_LEN = 0.135
# It stops short of the rump, which rolls under it as the hind legs swing.
BLANKET_REAR = 0.098
BLANKET_ANGLE = 62
SADDLE_LEN = 0.085
SADDLE_ANGLE = 30


def smooth(t):
    t = max(0.0, min(1.0, t))
    return t * t * (3 - 2 * t)


bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=os.path.join(SOURCE, 'pepe_bull_decoded.glb'), disable_bone_shape=True)
stray = bpy.data.objects.get('Cube')
if stray:
    bpy.data.objects.remove(stray)
body = next(o for o in bpy.data.objects if o.type == 'MESH')
armature = next(o for o in bpy.data.objects if o.type == 'ARMATURE')

# The hub's model stands turned off its own line of travel: put the spine on it first, so the bull
# runs straight and everything below is built square to it.
print('BULL_TURNED_DEG', round(math.degrees(bull_rig.straighten(armature, SEAT_Y)), 2))

# Slim the barrel in the bind pose: the legs and shoulders outside the window keep their shape.
# The mesh's own axes are turned from the world's, so everything here works in world space.
bpy.context.view_layer.update()
TO_WORLD = body.matrix_world.copy()
TO_LOCAL = TO_WORLD.inverted()
world = []
for v in body.data.vertices:
    p = TO_WORLD @ v.co
    d = abs(p.y - SEAT_Y)
    w = 1.0 - smooth((d - SLIM_CORE) / SLIM_FADE)
    p.x *= 1.0 - (1.0 - SLIM) * w
    v.co = TO_LOCAL @ p
    world.append(p)
body.data.update()

tree = BVHTree.FromPolygons(world, [tuple(p.vertices) for p in body.data.polygons])
AXIS_Z = 0.30


def surface(y, angle, lift):
    """The bull's outer surface at this place along the body and angle from the top, raised by `lift`."""
    out = Vector((math.sin(angle), 0, math.cos(angle)))
    centre = Vector((0, y, AXIS_Z))
    hit = tree.ray_cast(centre + out * 1.0, -out, 2.0)
    point = hit[0] if hit[0] is not None else centre + out * 0.2
    return point + out * lift


def material(name, colour, roughness):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    p = next(n for n in m.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
    p.inputs['Base Color'].default_value = (*colour, 1)
    p.inputs['Roughness'].default_value = roughness
    return m


def skin(obj):
    obj.parent = body.parent
    obj.matrix_parent_inverse = body.matrix_parent_inverse.copy()
    obj.matrix_basis = body.matrix_basis.copy()
    obj.modifiers.new('Armature', 'ARMATURE').object = armature


def draped(name, length, half_angle, lift, thickness, mat, ny=12, na=18, ridge=0.0, rear=None):
    """A sheet that follows the bull's back, thickened and softly rounded at its edges."""
    verts, faces = [], []
    for j in range(ny + 1):
        along = j / ny * 2 - 1
        y = SEAT_Y + along * (rear if rear is not None and along > 0 else length)
        for i in range(na + 1):
            u = i / na * 2 - 1
            bump = ridge * (1 - u * u) * (abs(j / ny * 2 - 1) ** 2)
            verts.append(TO_LOCAL @ surface(y, math.radians(half_angle) * u, lift + bump))
    for j in range(ny):
        for i in range(na):
            a = j * (na + 1) + i
            faces.append((a, a + 1, a + na + 2, a + na + 1))
    me = bpy.data.meshes.new(name)
    me.from_pydata(verts, [], faces)
    bm = bmesh.new()
    bm.from_mesh(me)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    if bm.faces and (TO_WORLD.to_3x3() @ bm.faces[len(bm.faces) // 2].normal).z < 0:
        bmesh.ops.reverse_faces(bm, faces=bm.faces)
    bmesh.ops.solidify(bm, geom=bm.faces[:], thickness=thickness)
    bm.to_mesh(me)
    bm.free()
    for p in me.polygons:
        p.use_smooth = True
    me.materials.append(mat)
    obj = bpy.data.objects.new(name, me)
    bpy.context.collection.objects.link(obj)
    skin(obj)
    return obj


# The rig: new spine and ear bones, then the body's skin, which the tack below is copied from.
YAW = bull_rig.head_yaw(body)
NECK_FIX = bull_rig.neck_fix(armature, YAW)
EARS = {}
for bone, side in ((bull_rig.EAR_L, 1), (bull_rig.EAR_R, -1)):
    root, way = bull_rig.ear_anchor(armature, tree, YAW, side)
    EARS[bone] = (root, root + way * bull_rig.EAR_LENGTH)
bull_rig.rebuild_bones(armature, EARS)
bull_rig.reweight_body(body, armature)
print('BULL_HEAD_YAW_DEG', round(math.degrees(YAW), 2), 'NECK_FIX_DEG', [round(math.degrees(a), 2) for a in NECK_FIX])

blanket_mat = material('saddle_blanket', (0.50, 0.07, 0.06), 0.85)
leather_mat = material('saddle_leather', (0.20, 0.10, 0.04), 0.45)
blanket = draped('saddle_blanket', BLANKET_LEN, BLANKET_ANGLE, 0.004, 0.004, blanket_mat, rear=BLANKET_REAR)
# The seat: raised at the front and back (a pommel and a cantle) so the rider sits down into it.
seat = draped('saddle_seat', SADDLE_LEN, SADDLE_ANGLE, 0.010, 0.008, leather_mat, ridge=0.022)
bpy.context.view_layer.update()
bull_rig.copy_skin(body, blanket)
bull_rig.copy_skin(body, seat)
bull_rig.ear_mesh('bull_ears', body, EARS, skin)

seconds = bull_anim.build_clips(armature, NECK_FIX, body)
with open(os.path.join(SOURCE, 'pepe_bull_clips.json'), 'w') as f:
    json.dump(seconds, f, indent=2)
    f.write('\n')

bpy.context.view_layer.update()
for o in bpy.data.objects:
    o.select_set(o.type in {'MESH', 'ARMATURE'} or o.type == 'EMPTY')
bpy.context.view_layer.objects.active = armature
result = bpy.ops.export_scene.gltf(
    filepath=os.path.join(SOURCE, 'pepe_bull_raw.glb'),
    export_format='GLB',
    use_selection=True,
    export_animations=True,
    export_animation_mode='ACTIONS',
    export_force_sampling=True,
    export_skins=True,
)
print('BULL_BUILT', result, [o.name for o in bpy.data.objects if o.type == 'MESH'], [a.name for a in bpy.data.actions])
