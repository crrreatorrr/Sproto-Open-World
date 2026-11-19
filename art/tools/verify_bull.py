"""Measures the Pepe Bull's clips from the game file, without the UI:

    /Applications/Blender.app/Contents/MacOS/Blender --background --factory-startup \
      --python art/tools/verify_bull.py -- public/assets/models/mounts/pepe_bull.glb

For each clip it reports: how far the loop's last pose is from its first; how far the hooves slide
against the ground while they are planted (m/s at game size); how far hooves sink below the ground;
and how deep the body pokes through the blanket and saddle (model units). Exits non-zero on a fail.
"""
import sys
import bpy
from mathutils import Vector
from mathutils.bvhtree import BVHTree

GLB = sys.argv[sys.argv.index('--') + 1]
GAME_SCALE = 2.636
# The clip, the ground speed it is authored for (m/s).
SPEEDS = {'follow_walk': 2.6, 'follow_run': 9.5, 'gallop': 17.0}
HOOVES = {'HL': 'tripo::1_Left_Limb_3', 'HR': 'tripo::1_Right_Limb_3', 'FL': 'tripo::0_Left_Limb_3', 'FR': 'tripo::0_Right_Limb_3'}
SAMPLES = 32
MAX_POP, MAX_SKATE, MAX_SINK, MAX_POKE = 0.002, 0.6, 0.015, 0.004

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=GLB, disable_bone_shape=True)
scene = bpy.context.scene
arm = next(o for o in bpy.data.objects if o.type == 'ARMATURE')
meshes = {o.name: o for o in bpy.data.objects if o.type == 'MESH'}
body = next(o for n, o in meshes.items() if n.startswith('tripo'))
tack = [o for n, o in meshes.items() if n.startswith('saddle')]
fps = scene.render.fps / scene.render.fps_base
arm.animation_data_create()
for t in arm.animation_data.nla_tracks:
    t.mute = True


def goto(f):
    whole = int(f // 1)
    scene.frame_set(whole, subframe=f - whole)
    bpy.context.view_layer.update()
    return bpy.context.evaluated_depsgraph_get()


def signed_depths(obj, tree, graph):
    """
    How far each vertex of `obj` lies below the body's outermost surface, along the line out from the
    spine (negative when the vertex is outside it). The mesh has inner shells, so the nearest surface
    says nothing: the ray comes from outside and stops at the first skin it meets.
    """
    ev = obj.evaluated_get(graph)
    me = ev.to_mesh()
    # The tree is in the body object's own space.
    to_body = body.matrix_world.inverted()
    out = []
    for v in me.vertices:
        p = ev.matrix_world @ v.co
        way = (p - Vector((0, p.y, 0.30))).normalized()
        hit = tree.ray_cast(to_body @ (p + way * 0.02), to_body.to_3x3() @ -way, 0.06)[0]
        out.append(((body.matrix_world @ hit) - p).dot(way) if hit is not None else -1.0)
    ev.to_mesh_clear()
    return out


# The outer face of the tack is what must stay outside: find it in the bind pose.
for pb in arm.pose.bones:
    pb.matrix_basis.identity()
arm.animation_data.action = None
graph = goto(0)
rest_tree = BVHTree.FromObject(body, graph)
outer = {o.name: [d < -0.0015 for d in signed_depths(o, rest_tree, graph)] for o in tack}

failed = 0
for action in sorted(bpy.data.actions, key=lambda a: a.name):
    arm.animation_data.action = action
    slots = arm.animation_data.action_suitable_slots
    if slots:
        arm.animation_data.action_slot = slots[0]
    start, end = action.frame_range
    length = (end - start) / fps
    span = end - start

    def bones():
        return {b.name: (arm.matrix_world @ b.matrix).copy() for b in arm.pose.bones}

    goto(start)
    first = bones()
    goto(end)
    last = bones()
    pop = max((first[n].translation - last[n].translation).length for n in first)

    hoof_y = {k: [] for k in HOOVES}
    hoof_z = {k: [] for k in HOOVES}
    sink, poke, poke_at = 0.0, 0.0, 0
    for i in range(SAMPLES):
        graph = goto(start + span * i / SAMPLES)
        for k, bone in HOOVES.items():
            at = arm.matrix_world @ arm.pose.bones[bone].head
            hoof_y[k].append(at.y)
            hoof_z[k].append(at.z)
        ev = body.evaluated_get(graph)
        me = ev.to_mesh()
        sink = max(sink, -min((ev.matrix_world @ v.co).z for v in me.vertices))
        ev.to_mesh_clear()
        tree = BVHTree.FromObject(body, graph)
        for o in tack:
            for d, is_outer in zip(signed_depths(o, tree, graph), outer[o.name]):
                if is_outer and d > poke:
                    poke, poke_at = d, i

    skate = 0.0
    if action.name in SPEEDS:
        belt = SPEEDS[action.name] / GAME_SCALE
        dt = length / SAMPLES
        for k in HOOVES:
            floor = min(hoof_z[k])
            for i in range(SAMPLES):
                j = (i + 1) % SAMPLES
                if hoof_z[k][i] < floor + 0.002 and hoof_z[k][j] < floor + 0.002:
                    skate = max(skate, abs((hoof_y[k][j] - hoof_y[k][i]) / dt - belt) * GAME_SCALE)

    ok = pop <= MAX_POP and skate <= MAX_SKATE and sink <= MAX_SINK and poke <= MAX_POKE
    failed += 0 if ok else 1
    print(f'VERIFY {"ok  " if ok else "FAIL"} {action.name}: {length:.3f} s, loop pop {pop:.4f}, '
          f'skate {skate:.2f} m/s, sink {sink:.4f}, tack poke {poke:.4f} (sample {poke_at}/{SAMPLES})')

print('VERIFY_DONE', 'failed' if failed else 'passed')
sys.exit(1 if failed else 0)
