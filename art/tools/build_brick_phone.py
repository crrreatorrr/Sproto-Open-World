"""Build the Brick Phone, the fast-travel device, from nothing, without the UI:

    /Applications/Blender.app/Contents/MacOS/Blender --background --factory-startup \
      --python art/tools/build_brick_phone.py

Writes public/assets/models/staffs/staff_brick_phone.glb. It is wielded in the weapon slot and
mounts on the player's `socket_staff`, so it keeps the staff contract: origin at the right-hand
grip, bottom -> antenna along +Y, front (the keypad) +Z, metres, root scale 1 and no rotation.

An old-school brick phone, the first mobile kind: a long chunky handset, a little green LCD,
twelve chunky keys plus Send and End, a mouthpiece grille at the bottom, an earpiece at the top and
a stubby antenna with a ball on its tip. Built 1.25x real size (SCALE) so it reads in third person.

Blender is Z-up and the glTF exporter maps Blender +Z to glTF +Y and Blender -Y to glTF +Z, so the
parts are written in glTF coordinates through g().

Layout along the length (glTF Y, metres from the fist):
    -0.090  bottom of the body         mouthpiece grille just above it
     0.000  fist (around the lower body)
            keypad, 4 rows of 3, then Send / End
     0.150  LCD window
     0.205  earpiece slots
     0.225  top of the body; the antenna stands on its back corner
     0.385  antenna ball
Flat colours, flat shading, no images, under 1,500 triangles.
"""
import os
import bpy
import bmesh
from mathutils import Vector

TOOLS = os.path.dirname(os.path.abspath(__file__ if '__file__' in globals() else bpy.context.space_data.text.filepath))
REPO = os.path.abspath(os.path.join(TOOLS, '..', '..'))
OUT = os.path.join(REPO, 'public', 'assets', 'models', 'staffs', 'staff_brick_phone.glb')

NAME = 'staff_brick_phone'

# Body: a box, glTF x across, y up its length, z front (+) to back (-).
BODY_X = 0.042
BODY_Y0, BODY_Y1 = -0.090, 0.225
BODY_Z0, BODY_Z1 = -0.028, 0.026
# The front face is inset into a slightly raised bezel band at the top and bottom.
FACE = BODY_Z1

# LCD window (dark frame, green glass).
LCD_X = 0.030
LCD_Y0, LCD_Y1 = 0.128, 0.178
# Keys: 3 columns x 4 rows, plus a Send and an End key above them.
KEY_W, KEY_H, KEY_D = 0.017, 0.012, 0.005
KEY_COLS = (-0.023, 0.0, 0.023)
KEY_ROWS = (0.010, 0.032, 0.054, 0.076)
CALL_ROW = 0.102
# Earpiece: three slots above the LCD. Mouthpiece: three below the keys.
EAR_Y = 0.203
MOUTH_Y = -0.060

# Antenna: a square stub on the back-right corner of the top, a thin mast, a ball.
ANT_X, ANT_Z = 0.026, -0.012
ANT_STUB = (0.010, 0.235, 0.255)        # half width, y0, y1
ANT_MAST = (0.0045, 0.255, 0.372)
ANT_BALL = (0.009, 0.372, 0.390)

PALETTE = {
    # name: (base colour, metallic, roughness)
    'body': ((0.10, 0.10, 0.11), 0.0, 0.55),
    'bezel': ((0.22, 0.22, 0.24), 0.0, 0.5),
    'key': ((0.72, 0.72, 0.70), 0.0, 0.6),
    'send': ((0.10, 0.62, 0.18), 0.0, 0.5),
    'end': ((0.80, 0.08, 0.06), 0.0, 0.5),
    'lcd': ((0.48, 0.78, 0.22), 0.0, 0.25),
    'lcd_frame': ((0.03, 0.03, 0.03), 0.0, 0.4),
    'grille': ((0.02, 0.02, 0.02), 0.0, 0.8),
    'antenna': ((0.04, 0.04, 0.04), 0.3, 0.45),
}


# Every size above is the real handset's; the model is built this much bigger so it reads in third person.
SCALE = 1.25


def g(x, y, z):
    """glTF (x, y, z) -> Blender (x, -z, y), scaled by SCALE."""
    return Vector((x, -z, y)) * SCALE


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
    if key == 'lcd':
        # A faint backlight, so the screen reads in the dark of the Rootdeep.
        bsdf.inputs['Emission Color'].default_value = (*colour, 1.0)
        bsdf.inputs['Emission Strength'].default_value = 0.6
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

    def box(self, x0, x1, y0, y1, z0, z1, slot=0, open_back=False):
        c = [self.v(x, y, z) for x in (x0, x1) for y in (y0, y1) for z in (z0, z1)]
        # index = xi*4 + yi*2 + zi
        quads = [(0, 1, 3, 2), (4, 6, 7, 5), (0, 4, 5, 1), (2, 3, 7, 6), (1, 5, 7, 3), (0, 2, 6, 4)]
        # The last quad is the back (z0): a key or a window sitting on the body skips it.
        for q in quads[:-1] if open_back else quads:
            self.face([c[i] for i in q], slot)
        return c

    def bevel_box(self, hx, y0, y1, z0, z1, chamfer, slot=0):
        """A box with its four long edges (along y) chamfered: an octagon prism, capped."""
        c = chamfer
        ring = [(-hx + c, z1), (hx - c, z1), (hx, z1 - c), (hx, z0 + c), (hx - c, z0), (-hx + c, z0), (-hx, z0 + c), (-hx, z1 - c)]
        bottom = [self.v(x, y0, z) for x, z in ring]
        top = [self.v(x, y1, z) for x, z in ring]
        n = len(ring)
        for i in range(n):
            j = (i + 1) % n
            self.face([bottom[i], bottom[j], top[j], top[i]], slot)
        self.face(list(reversed(bottom)), slot)
        self.face(top, slot)

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


def build_body(mats):
    part = Part(f'{NAME}_body', [mats['body'], mats['bezel']])
    part.bevel_box(BODY_X, BODY_Y0, BODY_Y1, BODY_Z0, BODY_Z1, 0.008, 0)
    # Raised bezel bands across the face, top and bottom, and a battery seam round the back.
    part.box(-BODY_X + 0.004, BODY_X - 0.004, 0.185, 0.222, FACE - 0.001, FACE + 0.003, 1, open_back=True)
    part.box(-BODY_X + 0.004, BODY_X - 0.004, BODY_Y0 + 0.004, -0.040, FACE - 0.001, FACE + 0.003, 1, open_back=True)
    part.box(-BODY_X - 0.001, BODY_X + 0.001, -0.004, 0.002, BODY_Z0 - 0.001, BODY_Z0 + 0.012, 1)
    return part


def build_lcd(mats):
    part = Part(f'{NAME}_lcd', [mats['lcd_frame'], mats['lcd']])
    part.box(-LCD_X - 0.004, LCD_X + 0.004, LCD_Y0 - 0.004, LCD_Y1 + 0.004, FACE - 0.001, FACE + 0.002, 0, open_back=True)
    part.box(-LCD_X, LCD_X, LCD_Y0, LCD_Y1, FACE + 0.002, FACE + 0.0035, 1, open_back=True)
    return part


def build_keys(mats):
    part = Part(f'{NAME}_keys', [mats['key'], mats['send'], mats['end']])
    for y in KEY_ROWS:
        for x in KEY_COLS:
            part.box(x - KEY_W / 2, x + KEY_W / 2, y - KEY_H / 2, y + KEY_H / 2, FACE - 0.001, FACE + KEY_D, 0, open_back=True)
    # Send (green, left) and End (red, right), a little wider.
    for x, slot in ((-0.018, 1), (0.018, 2)):
        part.box(x - 0.013, x + 0.013, CALL_ROW - KEY_H / 2, CALL_ROW + KEY_H / 2, FACE - 0.001, FACE + KEY_D, slot, open_back=True)
    return part


def build_grilles(mats):
    part = Part(f'{NAME}_grilles', [mats['grille']])
    for y in (EAR_Y, MOUTH_Y):
        for dx in (-0.012, 0.0, 0.012):
            part.box(dx - 0.0035, dx + 0.0035, y - 0.009, y + 0.009, FACE + 0.003, FACE + 0.0042, 0, open_back=True)
    return part


def build_antenna(mats):
    part = Part(f'{NAME}_antenna', [mats['antenna']])
    hw, y0, y1 = ANT_STUB
    part.bevel_box(hw, y0 - 0.012, y1, -hw, hw, 0.003, 0)
    hw, y0, y1 = ANT_MAST
    part.bevel_box(hw, y0, y1, -hw, hw, 0.0015, 0)
    hw, y0, y1 = ANT_BALL
    part.bevel_box(hw, y0, y1, -hw, hw, 0.0035, 0)
    obj = part
    return obj


def main():
    clear_scene()
    mats = {k: make_material(k) for k in PALETTE}

    root = bpy.data.objects.new(NAME, None)
    bpy.context.scene.collection.objects.link(root)
    root['item_id'] = NAME
    root['contract'] = {
        'socket': 'socket:staff',
        'origin': 'grip point (centre of the hand)',
        'up': '+Y (bottom -> antenna)',
        'forward': '+Z (the keypad)',
        'units': 'metres',
        'length_m': round((ANT_BALL[2] - BODY_Y0) * SCALE, 3),
        'grip_from_butt_m': round(-BODY_Y0 * SCALE, 3),
        'head_above_grip_m': round(ANT_BALL[2] * SCALE, 3),
    }
    root['note'] = 'Brick Phone, the fast-travel device. Built by art/tools/build_brick_phone.py.'

    antenna = build_antenna(mats).finish(root)
    # The antenna stands on the back corner of the top.
    antenna.location = g(ANT_X, 0, ANT_Z)
    objs = [build_body(mats).finish(root), build_lcd(mats).finish(root), build_keys(mats).finish(root),
            build_grilles(mats).finish(root), antenna]

    bpy.context.view_layer.update()
    tris = sum(len(p.vertices) - 2 for o in objs for p in o.data.polygons)
    lo = Vector((1e9,) * 3)
    hi = Vector((-1e9,) * 3)
    for o in objs:
        for vert in o.data.vertices:
            w = o.matrix_world @ vert.co
            lo = Vector(map(min, lo, w))
            hi = Vector(map(max, hi, w))
    print('BRICK_PHONE_BOUNDS_BLENDER', tuple(round(c, 4) for c in lo), tuple(round(c, 4) for c in hi), 'tris', tris)
    assert tris < 1500, tris

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
    print('BRICK_PHONE_BUILT', result, OUT, [o.name for o in objs])


main()
