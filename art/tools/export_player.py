"""Rebuild the riding clips, save the .blend and export art/source/player_raw.glb, without the UI:

    /Applications/Blender.app/Contents/MacOS/Blender --background art/source/player_melee.blend \
      --python art/tools/export_player.py

Then build the game file: `node art/tools/build-player-glb.mjs`.
"""
import os
import sys
import bpy

SOURCE = os.path.dirname(bpy.data.filepath)
TOOLS = os.path.abspath(os.path.join(SOURCE, '..', 'tools'))
exec(open(os.path.join(TOOLS, 'ride_anim.py')).read(), globals())

bpy.data.objects['Armature'].animation_data.action = None
bpy.context.scene.frame_set(0)

EXPORTED = ('Armature', 'char1', 'socket_staff')
# The socket is hidden in the viewport, which would keep it out of a selection-only export.
socket = bpy.data.objects['socket_staff']
socket.hide_viewport = False
bpy.context.view_layer.update()
for o in bpy.context.view_layer.objects:
    o.select_set(o.name in EXPORTED)
bpy.context.view_layer.objects.active = bpy.data.objects['Armature']

result = bpy.ops.export_scene.gltf(
    filepath=os.path.join(SOURCE, 'player_raw.glb'),
    export_format='GLB',
    use_selection=True,
    export_animations=True,
    export_animation_mode='ACTIONS',
    export_force_sampling=True,
    export_extras=True,
    export_skins=True,
)
if 'FINISHED' not in result:
    sys.exit('export failed')
socket.hide_viewport = True
bpy.ops.wm.save_mainfile()
print('exported', os.path.join(SOURCE, 'player_raw.glb'))
