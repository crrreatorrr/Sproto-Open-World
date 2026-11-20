"""Contact sheets of a class body (or the wizard) with a gun on socket_weapon, without the UI:

    /Applications/Blender.app/Contents/MacOS/Blender --background --factory-startup \
      --python art/tools/classes/render_sheet.py -- body <decoded_body.glb> <out.png> [decoded_gun.glb sockets.json]
    ... -- grip <decoded_body.glb> <out.png> <decoded_gun.glb> <sockets.json>
    ... -- guns <out.png> <decoded_gun.glb> [<decoded_gun.glb> ...]

art/tools/classes/preview.mjs runs all of it (decode, socket frames, every sheet). Blender cannot
read meshopt, so it decodes the game files first (art/tools/decode-glb.mjs). Body sheets: one
row per pose (clip @ seconds, written on the cell), columns side, three-quarter, front, six rows
a page (<out>_1.png, <out>_2.png, ...).
`aim` and `shoot` are upper-body clips, drawn over `idle` the way the game layers them, and
again on their own (`aim_alone`, `shoot_alone`: default hips and legs). The gun
is placed each frame from sockets.json (art/tools/classes/socket-frames.mjs: socket_weapon's
world matrix as three.js poses it), so the sheet checks the socket contract. Without a gun, a
stick of balls runs along the imported socket empty's +Z, red end = muzzle. `grip` sheets are
close-ups of the gun hand in a few poses (side, three-quarter, from above). The gun
sheet shows each gun from the side with its `muzzle` node as a red ball and the grip origin as a
blue ball, on a 10 cm grid, barrel to the right (+Z).
"""
import math
import os
import sys

import bpy
import numpy as np
from mathutils import Matrix, Vector

args = sys.argv[sys.argv.index('--') + 1:]
MODE = args[0]
CELL = 300
POSES = [
    ('idle', [0.0, 0.9]), ('run', [0.0, 0.21, 0.42, 0.62]), ('attack_light_1', [0.0, 0.2, 0.35, 0.5]),
    ('attack_heavy', [0.3, 0.6, 0.8, 1.0]), ('block', [0.45]), ('cast', [0.3, 0.6]),
    ('roll', [0.15, 0.4, 0.65]), ('ride', [0.0, 0.5]), ('jump', [0.25]), ('defeat', [2.9]),
    ('shoot', [0.0, 0.083, 0.167, 0.333]), ('aim', [0.0]), ('aim_alone', [0.0]), ('shoot_alone', [0.125]),
]
VIEWS = {
    # camera location, ortho width, look-at (Blender: character faces -Y, left is +X)
    'side': ((-4.0, 0.0, 1.0), 2.6, (0, 0, 0.95)),
    'three_quarter': ((-2.9, -2.9, 1.7), 2.6, (0, 0, 0.95)),
    'front': ((0.0, -4.0, 1.0), 2.6, (0, 0, 0.95)),
}

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.render.fps = 24
try:
    scene.render.engine = 'BLENDER_EEVEE_NEXT'
except TypeError:
    scene.render.engine = 'BLENDER_EEVEE'
scene.render.resolution_x = CELL
scene.render.resolution_y = CELL
scene.render.image_settings.file_format = 'PNG'

world = bpy.data.worlds.new('sky')
world.use_nodes = True
world.node_tree.nodes['Background'].inputs[0].default_value = (0.78, 0.82, 0.88, 1)
world.node_tree.nodes['Background'].inputs[1].default_value = 1.0
scene.world = world
sun = bpy.data.objects.new('sun', bpy.data.lights.new('sun', 'SUN'))
sun.data.energy = 3.0
sun.rotation_euler = (math.radians(50), 0, math.radians(-40))
scene.collection.objects.link(sun)
camera = bpy.data.objects.new('camera', bpy.data.cameras.new('camera'))
camera.data.type = 'ORTHO'
scene.collection.objects.link(camera)
scene.camera = camera


def material(name, rgba):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    p = next(n for n in m.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
    p.inputs['Base Color'].default_value = rgba
    return m


def ball(name, radius, rgba, parent=None, loc=(0, 0, 0)):
    bpy.ops.mesh.primitive_uv_sphere_add(radius=radius, location=loc)
    o = bpy.context.object
    o.name = name
    o.data.materials.append(material(name, rgba))
    if parent:
        o.parent = parent
        o.matrix_parent_inverse = Matrix.Identity(4)
        o.location = loc
    return o


def ground(size, scale):
    bpy.ops.mesh.primitive_plane_add(size=size, location=(0, 0, 0))
    g = bpy.context.object
    m = bpy.data.materials.new('ground')
    m.use_nodes = True
    nodes = m.node_tree.nodes
    checker = nodes.new('ShaderNodeTexChecker')
    checker.inputs['Scale'].default_value = scale
    checker.inputs['Color1'].default_value = (0.62, 0.64, 0.60, 1)
    checker.inputs['Color2'].default_value = (0.48, 0.50, 0.46, 1)
    p = next(n for n in nodes if n.type == 'BSDF_PRINCIPLED')
    m.node_tree.links.new(checker.outputs['Color'], p.inputs['Base Color'])
    g.data.materials.append(m)
    return g


def label():
    bpy.ops.object.text_add()
    t = bpy.context.object
    t.data.size = 0.13
    t.data.materials.append(material('label', (0.05, 0.05, 0.05, 1)))
    return t


def import_glb(path):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=path, guess_original_bind_pose=False)
    return [o for o in bpy.data.objects if o not in before]


def tile(cells, cols, out, rows_per_page=6):
    """Lay cells out left to right; pages of rows_per_page rows: out_1.png, out_2.png, ..."""
    imgs = []
    for p in cells:
        img = bpy.data.images.load(p)
        w, h = img.size
        a = np.empty(w * h * 4, dtype=np.float32)
        img.pixels.foreach_get(a)
        imgs.append(a.reshape(h, w, 4))
        bpy.data.images.remove(img)
        os.remove(p)
    h, w = imgs[0].shape[:2]
    per = rows_per_page * cols
    pages = [imgs[i:i + per] for i in range(0, len(imgs), per)]
    for n, page in enumerate(pages, 1):
        rows = math.ceil(len(page) / cols)
        sheet = np.ones((rows * h, cols * w, 4), dtype=np.float32)
        for i, c in enumerate(page):
            sheet[(rows - 1 - i // cols) * h:(rows - i // cols) * h, (i % cols) * w:(i % cols + 1) * w] = c
        img = bpy.data.images.new('sheet', cols * w, rows * h, alpha=True)
        img.pixels.foreach_set(sheet.ravel())
        path = out if len(pages) == 1 else f'{out[:-4]}_{n}.png'
        img.filepath_raw = path
        img.file_format = 'PNG'
        img.save()
        bpy.data.images.remove(img)
        print('SHEET', path, f'{rows}x{cols}')


def aim_camera(loc, width, target):
    camera.location = loc
    camera.data.ortho_scale = width
    camera.rotation_euler = (Vector(target) - Vector(loc)).to_track_quat('-Z', 'Y').to_euler()
    bpy.context.view_layer.update()


def render(path):
    scene.render.filepath = path
    bpy.ops.render.render(write_still=True)
    return path


# glTF (Y up, +Z forward) to Blender (Z up, -Y forward).
Y_UP = Matrix(((1, 0, 0, 0), (0, 0, -1, 0), (0, 1, 0, 0), (0, 0, 0, 1)))


# Close-ups of the gun hand: camera direction from the hand, ortho width.
GRIP_POSES = [('aim_alone', [0.0]), ('shoot_alone', [0.125]), ('idle', [0.0]), ('run', [0.21]), ('attack_light_1', [0.2]), ('block', [0.45])]
GRIP_VIEWS = {'side': ((-1, 0, 0), 0.6), 'three_quarter': ((-0.7, -0.7, 0.3), 0.6), 'top': ((-0.15, -0.1, 1), 0.6)}


def body_sheet(body, out, gun, sockets, close=False):
    objs = import_glb(body)
    arm = next(o for o in objs if o.type == 'ARMATURE')
    socket = next((o for o in objs if o.name.startswith('socket_weapon')), None)
    gun_roots = []
    if gun:
        import json
        frames = json.load(open(sockets))
        gun_roots = [o for o in import_glb(gun) if o.parent is None]
    elif socket:
        # No gun: a stick along the socket's +Z (glTF +Z is Blender -Y), red end = muzzle, blue = grip.
        ball('grip', 0.03, (0.1, 0.2, 0.9, 1), socket)
        for i in range(1, 6):
            ball(f'barrel{i}', 0.02, (0.9, 0.1 + 0.15 * i, 0.1, 1), socket, (0, -0.08 * i, 0))
    ground(8, 16)
    text = label()
    ad = arm.animation_data or arm.animation_data_create()
    for track in ad.nla_tracks:
        track.mute = True
    idle = bpy.data.actions.get('idle')
    base = ad.nla_tracks.new()
    base.strips.new('idle_base', 0, idle)
    base.mute = True
    cells = []
    for clip, times in (GRIP_POSES if close else POSES):
        act = bpy.data.actions.get(clip.replace('_alone', ''))
        if not act:
            continue
        ad.action = act
        if hasattr(ad, 'action_suitable_slots') and ad.action_suitable_slots:
            ad.action_slot = ad.action_suitable_slots[0]
        base.mute = clip not in ('aim', 'shoot')
        if clip.endswith('_alone'):
            for pb in arm.pose.bones:
                pb.matrix_basis = Matrix.Identity(4)
        for t in times:
            f = t * 24
            scene.frame_set(int(math.floor(f)), subframe=f - math.floor(f))
            if gun_roots:
                m = frames[clip][min(round(f), len(frames[clip]) - 1)]
                world = Y_UP @ Matrix([m[0:16:4], m[1:16:4], m[2:16:4], m[3:16:4]]) @ Y_UP.inverted()
                for o in gun_roots:
                    o.matrix_world = world
            views = VIEWS.items()
            if close:
                at = world.to_translation()
                views = [(v, (at + Vector(d).normalized() * 3, w, at)) for v, (d, w) in GRIP_VIEWS.items()]
            for view, (loc, width, target) in views:
                aim_camera(loc, width, target)
                text.data.size = 0.13 * width / 2.6 if close else 0.13
                text.data.body = f'{clip} {t:.2f}s'
                text.matrix_world = camera.matrix_world @ Matrix.Translation((-width / 2 + 0.023 * width, width / 2 - 0.077 * width, -1.0))
                cells.append(render(f'{out[:-4]}_cell{len(cells):03d}.png'))
    tile(cells, len(GRIP_VIEWS if close else VIEWS), out)


def gun_sheet(out, guns):
    ground(8, 80).location = (0, 0, -0.25)
    text = label()
    cells = []
    aim_camera((-3.0, 0.0, 0.0), 1.1, (0, 0, 0))
    for path in guns:
        objs = import_glb(path)
        muzzle = next((o for o in objs if o.name.startswith('muzzle')), None)
        extra = [ball('origin', 0.012, (0.1, 0.2, 0.9, 1))]
        if muzzle:
            extra.append(ball('muzzle_ball', 0.015, (0.95, 0.1, 0.1, 1), muzzle))
        bpy.context.view_layer.update()
        text.data.body = os.path.basename(path).split('.')[0].replace('_decoded', '')
        text.matrix_world = camera.matrix_world @ Matrix.Translation((-0.5, 0.42, -1.0))
        cells.append(render(f'{out[:-4]}_cell{len(cells):02d}.png'))
        for o in objs + extra:
            bpy.data.objects.remove(o)
    tile(cells, 4, out)


os.makedirs(os.path.dirname(os.path.abspath(args[1] if MODE == 'guns' else args[2])), exist_ok=True)
if MODE in ('body', 'grip'):
    body_sheet(os.path.abspath(args[1]), os.path.abspath(args[2]), os.path.abspath(args[3]) if len(args) > 4 else None, os.path.abspath(args[4]) if len(args) > 4 else None, MODE == 'grip')
else:
    gun_sheet(os.path.abspath(args[1]), [os.path.abspath(a) for a in args[2:]])
