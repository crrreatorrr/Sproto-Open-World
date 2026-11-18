"""Contact sheets of the Pepe Bull's clips, for checking the animation by eye, without the UI:

    /Applications/Blender.app/Contents/MacOS/Blender --background --factory-startup \
      --python art/tools/render_bull_sheet.py -- <glb> <out_dir> <clip[,clip]> <view[,view]> [frames] [cell_px]

Views: side, front, back, three_quarter, top. Each sheet shows the clip's loop in equal steps, read
left to right, with a ground grid that does not move. Writes <out_dir>/<clip>_<view>.png.
"""
import math
import os
import sys
import bpy
import numpy as np
from mathutils import Vector

args = sys.argv[sys.argv.index('--') + 1:]
GLB, OUT = os.path.abspath(args[0]), os.path.abspath(args[1])
CLIPS, VIEWS = args[2].split(','), args[3].split(',')
FRAMES = int(args[4]) if len(args) > 4 else 8
CELL = int(args[5]) if len(args) > 5 else 420
COLUMNS = 4
os.makedirs(OUT, exist_ok=True)

# Camera position, the width it sees, and the point it looks at.
CAMERAS = {
    'side': ((2.2, 0.0, 0.34), 1.3, (0, 0, 0.30)),
    'front': ((0.0, -2.4, 0.36), 1.0, (0, 0, 0.30)),
    'back': ((0.0, 2.4, 0.42), 1.0, (0, 0, 0.30)),
    'three_quarter': ((1.55, -1.65, 0.72), 1.35, (0, 0, 0.30)),
    'top': ((0.001, 0.0, 2.6), 1.3, (0, 0, 0.30)),
    'fore': ((2.2, -0.22, 0.36), 0.72, (0, -0.22, 0.32)),
    'hind': ((2.2, 0.24, 0.36), 0.72, (0, 0.24, 0.32)),
    'saddle': ((1.2, 0.07, 1.25), 0.62, (0, 0.07, 0.42)),
    'head': ((0.9, -1.2, 0.72), 0.62, (0, -0.32, 0.44)),
}

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=GLB, disable_bone_shape=True)
scene = bpy.context.scene
armature = next(o for o in bpy.data.objects if o.type == 'ARMATURE')
fps = scene.render.fps / scene.render.fps_base

# Ground: a checker that shows where the hooves meet the floor.
bpy.ops.mesh.primitive_plane_add(size=6, location=(0, 0, 0))
ground = bpy.context.object
mat = bpy.data.materials.new('ground')
mat.use_nodes = True
nodes = mat.node_tree.nodes
checker = nodes.new('ShaderNodeTexChecker')
checker.inputs['Scale'].default_value = 30
checker.inputs['Color1'].default_value = (0.62, 0.64, 0.60, 1)
checker.inputs['Color2'].default_value = (0.50, 0.52, 0.48, 1)
principled = next(n for n in nodes if n.type == 'BSDF_PRINCIPLED')
mat.node_tree.links.new(checker.outputs['Color'], principled.inputs['Base Color'])
ground.data.materials.append(mat)

world = bpy.data.worlds.new('sky')
world.use_nodes = True
world.node_tree.nodes['Background'].inputs[0].default_value = (0.78, 0.82, 0.88, 1)
world.node_tree.nodes['Background'].inputs[1].default_value = 0.9
scene.world = world
sun = bpy.data.objects.new('sun', bpy.data.lights.new('sun', 'SUN'))
sun.data.energy = 2.6
sun.rotation_euler = (math.radians(52), 0, math.radians(35))
scene.collection.objects.link(sun)

camera = bpy.data.objects.new('camera', bpy.data.cameras.new('camera'))
camera.data.type = 'ORTHO'
scene.collection.objects.link(camera)
scene.camera = camera

try:
    scene.render.engine = 'BLENDER_EEVEE_NEXT'
except TypeError:
    scene.render.engine = 'BLENDER_EEVEE'
scene.render.resolution_x = CELL
scene.render.resolution_y = int(CELL * 0.72)
scene.render.image_settings.file_format = 'PNG'
scene.render.film_transparent = False


def set_action(name):
    action = bpy.data.actions[name]
    armature.animation_data_create()
    # An imported clip is parked on an NLA track: mute those so only this clip plays.
    for track in armature.animation_data.nla_tracks:
        track.mute = True
    armature.animation_data.action = action
    if hasattr(armature.animation_data, 'action_suitable_slots'):
        slots = armature.animation_data.action_suitable_slots
        if slots:
            armature.animation_data.action_slot = slots[0]
    return action.frame_range


def tile(paths, out):
    cells = []
    for p in paths:
        img = bpy.data.images.load(p)
        w, h = img.size
        a = np.empty(w * h * 4, dtype=np.float32)
        img.pixels.foreach_get(a)
        cells.append(a.reshape(h, w, 4))
        bpy.data.images.remove(img)
    h, w = cells[0].shape[:2]
    rows = math.ceil(len(cells) / COLUMNS)
    sheet = np.ones((rows * h, COLUMNS * w, 4), dtype=np.float32)
    for i, c in enumerate(cells):
        y = (rows - 1 - i // COLUMNS) * h
        x = (i % COLUMNS) * w
        sheet[y:y + h, x:x + w] = c
    img = bpy.data.images.new('sheet', COLUMNS * w, rows * h, alpha=True)
    img.pixels.foreach_set(sheet.ravel())
    img.filepath_raw = out
    img.file_format = 'PNG'
    img.save()
    bpy.data.images.remove(img)


for clip in CLIPS:
    start, end = set_action(clip)
    for view in VIEWS:
        loc, scale, target = CAMERAS[view]
        camera.location = loc
        camera.data.ortho_scale = scale
        camera.rotation_euler = (Vector(target) - Vector(loc)).to_track_quat('-Z', 'Y').to_euler()
        paths = []
        for i in range(FRAMES):
            scene.frame_set(int(start), subframe=0)
            f = start + (end - start) * i / FRAMES
            scene.frame_set(int(math.floor(f)), subframe=f - math.floor(f))
            bpy.context.view_layer.update()
            scene.render.filepath = os.path.join(OUT, f'_{clip}_{view}_{i:02d}.png')
            bpy.ops.render.render(write_still=True)
            paths.append(scene.render.filepath)
        sheet = os.path.join(OUT, f'{clip}_{view}.png')
        tile(paths, sheet)
        for p in paths:
            os.remove(p)
        print('SHEET', sheet, 'clip length', round((end - start) / fps, 3), 's')
