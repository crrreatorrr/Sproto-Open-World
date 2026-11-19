"""Build Rootcleaver, the Rootdeep vault greatsword, from nothing, without the UI:

    /Applications/Blender.app/Contents/MacOS/Blender --background --factory-startup \
      --python art/tools/build_rootcleaver.py

Writes public/assets/models/staffs/staff_rootcleaver.glb. The brief is
docs/plans/rootcleaver-blender-spec.md. The sword mounts on the player's `socket_staff` like any
staff, so it keeps the staff contract: origin at the right-hand grip, butt -> head along +Y, front
+Z, metres, root scale 1 and no rotation. There is no second compress step.

Blender is Z-up and the glTF exporter maps Blender +Z to glTF +Y and Blender -Y to glTF +Z, so every
part here is laid out along Blender +Z (the sword's length) with its front toward Blender -Y.

Layout along the length (glTF Y, metres from the right fist):
    -1.093  pommel tip         gold
    -0.99   butt collar        gold
            long wrapped haft  red, gold collars
     0.00   right fist         (left fist at 0.25 heavy, 0.28 overhead, 0.50 block)
     0.30   crossguard         gold, root-like tips drooping toward the hands
     0.345  ricasso, then a broad cleaver blade     blue, yellow bevelled edge toward +Z
    +0.801  tip
Flat colours from staff_sproto.glb's untextured materials, flat shading, no images, under 3,000
triangles.
"""
import math
import os
import bpy
import bmesh
from mathutils import Vector

TOOLS = os.path.dirname(os.path.abspath(__file__ if '__file__' in globals() else bpy.context.space_data.text.filepath))
REPO = os.path.abspath(os.path.join(TOOLS, '..', '..'))
OUT = os.path.join(REPO, 'public', 'assets', 'models', 'staffs', 'staff_rootcleaver.glb')

NAME = 'staff_rootcleaver'
# Staff contract (staff_sproto.glb root extras).
GRIP_FROM_BUTT = 1.093
HEAD_ABOVE_GRIP = 0.801

# Haft.
HAFT_R = 0.022
HAFT_SIDES = 8
HAFT_BOTTOM = -0.99
HAFT_TOP = 0.30
# Raised wrap bands on the hand zone, (centre y) every WRAP_STEP from WRAP_FROM to WRAP_TO.
WRAP_FROM, WRAP_TO, WRAP_STEP, WRAP_R, WRAP_HALF = -0.09, 0.27, 0.06, 0.0255, 0.008
# Gold collars on the haft: (centre y, half height, radius).
COLLARS = [(-0.975, 0.018, 0.031), (-0.55, 0.014, 0.028), (-0.13, 0.012, 0.028), (0.287, 0.013, 0.030)]

# Crossguard: a bar across the blade's width (glTF Z) with root tips that droop toward the hands.
GUARD_Y0, GUARD_Y1 = 0.300, 0.345
GUARD_FRONT, GUARD_BACK = 0.128, -0.068   # glTF Z extents of the bar
GUARD_HALF_T = 0.021                       # half thickness across glTF X
ROOT_DROP = 0.05

# Blade cross-sections, glTF Y up the blade. Each row: (y, spine z, bevel z, edge z, half thickness).
# The spine is the back (-Z), the edge faces the front (+Z). Faces between `bevel` and `edge` are the
# yellow edge line; the rest is blue.
BLADE_ROWS = [
    (0.345, -0.024, 0.022, 0.034, 0.010),  # ricasso, inside the guard
    (0.440, -0.024, 0.022, 0.034, 0.010),  # ricasso top, where the block hand can sit
    (0.480, -0.030, 0.052, 0.074, 0.009),  # flare
    (0.600, -0.031, 0.062, 0.085, 0.0085),
    (0.730, -0.032, 0.068, 0.092, 0.008),  # widest, the cleaver's belly
    (0.770, -0.004, 0.066, 0.088, 0.007),  # clipped back starts
]
TIP = (HEAD_ABOVE_GRIP, 0.064)  # (y, z), on the centre plane

# Pommel rings below the butt collar: (y, radius), ending in a point at the contract's butt.
POMMEL_RINGS = [(-0.993, 0.026), (-1.010, 0.044), (-1.040, 0.048), (-1.066, 0.034)]
POMMEL_SIDES = 8

PALETTE = {
    # name: (base colour, metallic, roughness), from staff_sproto.glb
    'blade': ((0.06, 0.2, 0.78), 0.0, 0.35),    # staff_sproto_blue_mat
    'edge': ((1.0, 0.78, 0.08), 0.0, 0.35),     # staff_sproto_yellow_mat
    'gold': ((1.0, 0.72, 0.28), 1.0, 0.28),     # staff_sproto_gold_mat (no metallicFactor = 1)
    'grip': ((0.82, 0.04, 0.05), 0.0, 0.85),    # staff_sproto_red_mat
}


def g(x, y, z):
    """glTF (x, y, z) -> Blender (x, -z, y)."""
    return Vector((x, -z, y))


def clear_scene():
    for o in list(bpy.data.objects):
        bpy.data.objects.remove(o, do_unlink=True)
    for coll in (bpy.data.meshes, bpy.data.materials, bpy.data.cameras, bpy.data.lights, bpy.data.images):
        for block in list(coll):
            coll.remove(block)


def make_material(key):
    colour, metallic, roughness = PALETTE[key]
    mat = bpy.data.materials.new(f'{NAME}_{key}_mat')
    mat.use_nodes = True
    bsdf = next(n for n in mat.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
    bsdf.inputs['Base Color'].default_value = (*colour, 1.0)
    bsdf.inputs['Metallic'].default_value = metallic
    bsdf.inputs['Roughness'].default_value = roughness
    mat.diffuse_color = (*colour, 1.0)
    return mat


class Part:
    """One mesh object built with bmesh; faces carry a material slot index, all flat shaded."""

    def __init__(self, name, mats):
        self.name = name
        self.mats = mats
        self.bm = bmesh.new()

    def v(self, x, y, z):
        return self.bm.verts.new(g(x, y, z))

    def face(self, verts, slot=0):
        f = self.bm.faces.new(verts)
        f.material_index = slot
        f.smooth = False
        return f

    def ring(self, y, r, sides, phase=math.pi / 8):
        return [self.v(r * math.cos(phase + 2 * math.pi * i / sides), y, r * math.sin(phase + 2 * math.pi * i / sides))
                for i in range(sides)]

    def bridge(self, a, b, slot=0):
        n = len(a)
        for i in range(n):
            j = (i + 1) % n
            self.face([a[i], a[j], b[j], b[i]], slot)

    def lathe(self, rings, slot=0, cap_bottom=True, cap_top=True, point_bottom=None, sides=HAFT_SIDES):
        """rings: [(y, r)] bottom to top. point_bottom: y of a cone point under the first ring."""
        loops = [self.ring(y, r, sides) for y, r in rings]
        for a, b in zip(loops, loops[1:]):
            self.bridge(a, b, slot)
        if point_bottom is not None:
            tip = self.v(0, point_bottom, 0)
            first = loops[0]
            for i in range(sides):
                self.face([first[(i + 1) % sides], first[i], tip], slot)
        elif cap_bottom:
            self.face(list(reversed(loops[0])), slot)
        if cap_top:
            self.face(loops[-1], slot)

    def box(self, x0, x1, y0, y1, z0, z1, slot=0):
        c = [self.v(x, y, z) for x in (x0, x1) for y in (y0, y1) for z in (z0, z1)]
        # index = xi*4 + yi*2 + zi
        quads = [(0, 1, 3, 2), (4, 6, 7, 5), (0, 4, 5, 1), (2, 3, 7, 6), (0, 2, 6, 4), (1, 5, 7, 3)]
        for q in quads:
            self.face([c[i] for i in q], slot)
        return c

    def finish(self, parent):
        bmesh.ops.recalc_face_normals(self.bm, faces=self.bm.faces)
        mesh = bpy.data.meshes.new(self.name)
        self.bm.to_mesh(mesh)
        self.bm.free()
        for m in self.mats:
            mesh.materials.append(m)
        for p in mesh.polygons:
            p.use_smooth = False
        obj = bpy.data.objects.new(self.name, mesh)
        bpy.context.scene.collection.objects.link(obj)
        obj.parent = parent
        return obj


def build_grip(mats):
    part = Part(f'{NAME}_grip', [mats['grip'], mats['gold']])
    # Haft as a stack of rings, with raised wrap bands across the hand zone.
    rings = [(HAFT_BOTTOM, HAFT_R)]
    y = WRAP_FROM
    while y <= WRAP_TO + 1e-6:
        rings += [(y - WRAP_HALF, HAFT_R), (y - WRAP_HALF * 0.4, WRAP_R), (y + WRAP_HALF * 0.4, WRAP_R), (y + WRAP_HALF, HAFT_R)]
        y += WRAP_STEP
    rings.append((HAFT_TOP, HAFT_R))
    part.lathe(rings, slot=0)
    for cy, half, r in COLLARS:
        part.lathe([(cy - half, r), (cy - half * 0.5, r * 1.06), (cy + half * 0.5, r * 1.06), (cy + half, r)], slot=1)
    return part


def build_pommel(mats):
    part = Part(f'{NAME}_pommel', [mats['gold']])
    part.lathe(POMMEL_RINGS[::-1], point_bottom=-GRIP_FROM_BUTT, cap_bottom=False, sides=POMMEL_SIDES)
    return part


def build_guard(mats):
    part = Part(f'{NAME}_guard', [mats['gold']])
    t = GUARD_HALF_T
    # The bar.
    part.box(-t, t, GUARD_Y0, GUARD_Y1, GUARD_BACK, GUARD_FRONT)
    # A raised boss on each flat, where the blade meets the guard.
    part.box(-t - 0.008, t + 0.008, GUARD_Y0 + 0.006, GUARD_Y1 + 0.012, -0.03, 0.07)
    # Root tips: wedges hanging off each end of the bar, bent back toward the hands.
    for z_end, out in ((GUARD_FRONT, 1), (GUARD_BACK, -1)):
        top_in, top_out = z_end - out * 0.034, z_end
        foot = z_end + out * 0.012
        y_top, y_foot = GUARD_Y0, GUARD_Y0 - ROOT_DROP
        tt = t * 0.75
        a = part.v(-tt, y_top, top_in)
        b = part.v(-tt, y_top, top_out)
        c = part.v(tt, y_top, top_out)
        d = part.v(tt, y_top, top_in)
        tip_l = part.v(-tt * 0.3, y_foot, foot)
        tip_r = part.v(tt * 0.3, y_foot, foot)
        part.face([a, b, c, d])
        part.face([b, tip_l, tip_r, c])
        part.face([d, tip_r, tip_l, a])
        part.face([a, tip_l, b])
        part.face([c, tip_r, d])
    return part


def build_blade(mats):
    part = Part(f'{NAME}_blade', [mats['blade'], mats['edge']])
    loops = []
    for y, spine, bevel, edge, half in BLADE_ROWS:
        # Ring around the section: back +X, bevel +X, edge, bevel -X, back -X.
        loops.append([part.v(half, y, spine), part.v(half, y, bevel), part.v(0, y, edge),
                      part.v(-half, y, bevel), part.v(-half, y, spine)])
    slots = [0, 1, 1, 0, 0]  # flat +X, edge +X, edge -X, flat -X, spine
    for a, b in zip(loops, loops[1:]):
        for i in range(5):
            j = (i + 1) % 5
            part.face([a[i], a[j], b[j], b[i]], slots[i])
    tip = part.v(0, TIP[0], TIP[1])
    last = loops[-1]
    for i in range(5):
        part.face([last[i], last[(i + 1) % 5], tip], slots[i])
    part.face(list(reversed(loops[0])), 0)
    return part


def main():
    clear_scene()
    mats = {k: make_material(k) for k in PALETTE}

    root = bpy.data.objects.new(NAME, None)
    bpy.context.scene.collection.objects.link(root)
    root['item_id'] = NAME
    root['contract'] = {
        'socket': 'socket:staff',
        'origin': 'grip point (centre of the hand)',
        'up': '+Y (butt -> head)',
        'forward': '+Z (front of the head)',
        'units': 'metres',
        'length_m': round(GRIP_FROM_BUTT + HEAD_ABOVE_GRIP, 3),
        'grip_from_butt_m': GRIP_FROM_BUTT,
        'head_above_grip_m': HEAD_ABOVE_GRIP,
    }
    root['note'] = 'Rootcleaver greatsword. Built by art/tools/build_rootcleaver.py; uses the staff swing clips.'

    objs = [build_blade(mats).finish(root), build_guard(mats).finish(root),
            build_grip(mats).finish(root), build_pommel(mats).finish(root)]

    bpy.context.view_layer.update()
    tris = sum(len(p.vertices) - 2 for o in objs for p in o.data.polygons)
    lo = Vector((1e9,) * 3)
    hi = Vector((-1e9,) * 3)
    for o in objs:
        for vert in o.data.vertices:
            w = o.matrix_world @ vert.co
            lo = Vector(map(min, lo, w))
            hi = Vector(map(max, hi, w))
    print('ROOTCLEAVER_BOUNDS_BLENDER', tuple(round(c, 4) for c in lo), tuple(round(c, 4) for c in hi), 'tris', tris)
    assert tris < 3000, tris

    for o in bpy.data.objects:
        o.select_set(o in objs or o is root)
    bpy.context.view_layer.objects.active = root
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    result = bpy.ops.export_scene.gltf(
        filepath=OUT,
        export_format='GLB',
        use_selection=True,
        export_extras=True,
        export_yup=True,
        export_apply=True,
        export_normals=True,
        export_materials='EXPORT',
        export_animations=False,
        export_skins=False,
        export_morph=False,
        export_cameras=False,
        export_lights=False,
    )
    print('ROOTCLEAVER_BUILT', result, OUT, [o.name for o in objs])


main()
