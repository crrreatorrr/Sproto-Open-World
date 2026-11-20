"""
Shared helpers for the environment kits (town, mountains, river, waterfalls, zen garden).

Each kit is a headless Blender script, art/tools/env/<kit>.py, that builds its props from code and
exports one raw GLB per prop to art/source/env/<kit>/<prop>.glb. `node tools/build-env-props.mjs`
then writes the game files (public/assets/models/props/<prop>.glb plus -lod1.glb).

Conventions, matching the game's cartoon_kit props:
- Metres, +Z up in Blender (glTF +Y). The player is 1.7 m tall.
- Pivot at the centre of the footprint, on the ground (z = 0). The front faces Blender -Y, which
  is glTF +Z.
- Flat shaded, colour from per-face vertex colours (COLOR_0), one material per look:
    env_kit   - everything opaque (vertex colour, roughness 1)
    fx_water  - flowing water sheets: the game scrolls its UVs (V down the fall), semi-transparent
    fx_glow   - emissive bits (lantern glass, crystals); vertex colour also drives the glow
- Budgets: props <= 4000 triangles, landmarks <= 10000 (scripts/check-assets.mjs).

Run a kit:
    /Applications/Blender.app/Contents/MacOS/Blender --background --factory-startup \
        --python art/tools/env/<kit>.py [-- prop_name ...]
"""
import math
import os
import random
import sys

import bmesh
import bpy
from mathutils import Matrix, Vector

REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', '..'))
SOURCE = os.path.join(REPO, 'art', 'source', 'env')


def hex_rgb(h):
    """'#rrggbb' -> linear RGBA, the space Blender stores colour attributes in."""
    h = h.lstrip('#')
    srgb = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    lin = [c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4 for c in srgb]
    return (*lin, 1.0)


def only_args():
    """Prop names passed after `--` (build just those)."""
    return sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)


# --- materials -------------------------------------------------------------------------------

def _vc_material(name, emission=0.0, alpha=1.0):
    mat = bpy.data.materials.get(name)
    if mat:
        return mat
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nt = mat.node_tree
    bsdf = next(n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED')
    attr = nt.nodes.new('ShaderNodeVertexColor')
    attr.layer_name = 'Col'
    nt.links.new(attr.outputs['Color'], bsdf.inputs['Base Color'])
    bsdf.inputs['Roughness'].default_value = 1.0
    bsdf.inputs['Metallic'].default_value = 0.0
    if emission > 0:
        nt.links.new(attr.outputs['Color'], bsdf.inputs['Emission Color'])
        bsdf.inputs['Emission Strength'].default_value = emission
    if alpha < 1.0:
        bsdf.inputs['Alpha'].default_value = alpha
        try:
            mat.surface_render_method = 'BLENDED'
        except (AttributeError, TypeError):
            pass
    return mat


def mat_kit():
    return _vc_material('env_kit')


def mat_water():
    return _vc_material('fx_water', alpha=0.85)


def mat_glow():
    return _vc_material('fx_glow', emission=2.0)


# --- mesh building ---------------------------------------------------------------------------

def _ensure_color_layer(me):
    if 'Col' not in me.color_attributes:
        me.color_attributes.new('Col', 'FLOAT_COLOR', 'CORNER')
    return me.color_attributes['Col']


def paint(obj, color, faces=None):
    """Set the vertex colour of all faces (or the given face indices) of a mesh object."""
    me = obj.data
    layer = _ensure_color_layer(me)
    rgba = hex_rgb(color) if isinstance(color, str) else color
    sel = set(faces) if faces is not None else None
    for poly in me.polygons:
        if sel is None or poly.index in sel:
            for li in poly.loop_indices:
                layer.data[li].color = rgba
    return obj


def paint_by(obj, fn):
    """Colour each face by fn(face_center: Vector, face_normal: Vector) -> '#rrggbb'."""
    me = obj.data
    layer = _ensure_color_layer(me)
    mw = obj.matrix_world
    for poly in me.polygons:
        c = mw @ poly.center
        n = (mw.to_3x3() @ poly.normal).normalized()
        rgba = hex_rgb(fn(c, n))
        for li in poly.loop_indices:
            layer.data[li].color = rgba
    return obj


def _new_obj(name, bm, material):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    obj = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(obj)
    me.materials.append(material or mat_kit())
    _ensure_color_layer(me)
    return obj


def box(name, size, loc=(0, 0, 0), rot=(0, 0, 0), color='#888888', material=None, bevel=0.0):
    """Axis box of full size (x, y, z), its base at loc z (not its centre)."""
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.scale(bm, vec=Vector(size), verts=bm.verts)
    bmesh.ops.translate(bm, vec=Vector((0, 0, size[2] / 2)), verts=bm.verts)
    if bevel > 0:
        bmesh.ops.bevel(bm, geom=list(bm.edges), offset=bevel, segments=1, affect='EDGES')
    obj = _new_obj(name, bm, material)
    obj.location = loc
    obj.rotation_euler = rot
    return paint(obj, color)


def cylinder(name, radius, depth, loc=(0, 0, 0), rot=(0, 0, 0), segments=8, color='#888888',
             material=None, radius_top=None, cap=True):
    """Cylinder or frustum standing on loc (base at loc z)."""
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=cap, cap_tris=False, segments=segments,
                          radius1=radius, radius2=radius if radius_top is None else radius_top,
                          depth=depth)
    bmesh.ops.translate(bm, vec=Vector((0, 0, depth / 2)), verts=bm.verts)
    obj = _new_obj(name, bm, material)
    obj.location = loc
    obj.rotation_euler = rot
    return paint(obj, color)


def cone(name, radius, depth, loc=(0, 0, 0), rot=(0, 0, 0), segments=8, color='#888888', material=None):
    return cylinder(name, radius, depth, loc, rot, segments, color, material, radius_top=0.0)


def ico(name, radius, loc=(0, 0, 0), subdiv=1, color='#888888', material=None, scale=(1, 1, 1),
        jitter=0.0, seed=0):
    """Faceted blob: an icosphere, optionally scaled and jittered for a hand-cut rock look."""
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=subdiv, radius=radius)
    bmesh.ops.scale(bm, vec=Vector(scale), verts=bm.verts)
    if jitter > 0:
        rng = random.Random(seed)
        for v in bm.verts:
            v.co += Vector((rng.uniform(-1, 1), rng.uniform(-1, 1), rng.uniform(-1, 1))) * jitter
    obj = _new_obj(name, bm, material)
    obj.location = loc
    return paint(obj, color)


def from_pydata(name, verts, faces, color='#888888', material=None, loc=(0, 0, 0)):
    me = bpy.data.meshes.new(name)
    me.from_pydata([tuple(v) for v in verts], [], [tuple(f) for f in faces])
    me.update()
    obj = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(obj)
    me.materials.append(material or mat_kit())
    obj.location = loc
    return paint(obj, color)


def extrude_profile(name, profile, depth, color='#888888', material=None, loc=(0, 0, 0), rot=(0, 0, 0)):
    """Extrude a closed 2D profile [(x, z), ...] along Y by depth, centred on y = 0 (gables, roofs, arches)."""
    n = len(profile)
    verts = [(x, -depth / 2, z) for x, z in profile] + [(x, depth / 2, z) for x, z in profile]
    faces = [list(range(n))[::-1], list(range(n, 2 * n))]
    for i in range(n):
        j = (i + 1) % n
        faces.append([i, j, n + j, n + i])
    obj = from_pydata(name, verts, faces, color, material, loc)
    obj.rotation_euler = rot
    return obj


def jitter(obj, amount, seed=0):
    """Nudge every vertex a little: chunky, hand-placed geometry instead of perfect primitives."""
    rng = random.Random(seed)
    for v in obj.data.vertices:
        v.co += Vector((rng.uniform(-1, 1), rng.uniform(-1, 1), rng.uniform(-1, 1))) * amount
    return obj


def array_ring(make, count, radius, z=0.0, phase=0.0):
    """Call make(i, x, y, angle) for count points on a ring and return the objects."""
    out = []
    for i in range(count):
        a = phase + i * 2 * math.pi / count
        out.append(make(i, radius * math.cos(a), radius * math.sin(a), a))
    return out


def join(objs, name):
    """Join mesh objects into one, applying transforms. Materials are kept per face."""
    objs = [o for o in objs if o is not None]
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    if len(objs) > 1:
        bpy.ops.object.join()
    obj = bpy.context.view_layer.objects.active
    obj.name = name
    obj.data.name = name
    return obj


def triangles(obj):
    return sum(len(p.vertices) - 2 for p in obj.data.polygons)


def flat(obj):
    for p in obj.data.polygons:
        p.use_smooth = False
    return obj


# --- export and preview -----------------------------------------------------------------------

def export_prop(obj, kit, name, cap=4000):
    """Export one prop (a single joined object) as a raw GLB, and check its triangle cap."""
    flat(obj)
    tris = triangles(obj)
    if tris > cap:
        raise SystemExit(f'{kit}/{name}: {tris} triangles > cap {cap}')
    out_dir = os.path.join(SOURCE, kit)
    os.makedirs(out_dir, exist_ok=True)
    path = os.path.join(out_dir, f'{name}.glb')
    bpy.ops.object.select_all(action='DESELECT')
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    kwargs = dict(filepath=path, export_format='GLB', use_selection=True, export_apply=True,
                  export_yup=True, export_normals=True, export_texcoords=True, export_materials='EXPORT',
                  export_animations=False, export_extras=False)
    try:
        bpy.ops.export_scene.gltf(export_vertex_color='ACTIVE', **kwargs)
    except TypeError:
        bpy.ops.export_scene.gltf(export_colors=True, **kwargs)
    print(f'ENVKIT {kit}/{name}: {tris} triangles -> {os.path.relpath(path, REPO)}')
    return path, tris


def render_preview(obj, kit, name, views=('three_quarter',), size=720):
    """Workbench render(s) of the prop with flat vertex colours, for comparing against the concept."""
    scene = bpy.context.scene
    try:
        scene.render.engine = 'BLENDER_WORKBENCH'
    except TypeError:
        pass
    shading = scene.display.shading
    shading.light = 'STUDIO'
    shading.color_type = 'VERTEX'
    shading.show_shadows = True
    shading.show_cavity = False
    scene.render.resolution_x = size
    scene.render.resolution_y = size
    scene.render.film_transparent = False
    world = scene.world or bpy.data.worlds.new('World')
    scene.world = world
    world.color = (0.55, 0.62, 0.70)
    shading.background_type = 'WORLD'
    lo = Vector((min(v[i] for v in [obj.matrix_world @ Vector(c) for c in obj.bound_box]) for i in range(3)))
    hi = Vector((max(v[i] for v in [obj.matrix_world @ Vector(c) for c in obj.bound_box]) for i in range(3)))
    centre = (lo + hi) / 2
    radius = max((hi - lo).length / 2, 0.5)
    cam_data = bpy.data.cameras.new('preview_cam')
    cam_data.lens = 50
    cam = bpy.data.objects.new('preview_cam', cam_data)
    scene.collection.objects.link(cam)
    scene.camera = cam
    dirs = {
        'three_quarter': Vector((1.0, -1.3, 0.75)),
        'front': Vector((0.0, -1.0, 0.25)),
        'side': Vector((1.0, 0.0, 0.25)),
        'top': Vector((0.01, -0.2, 1.0)),
        'low': Vector((0.9, -1.2, 0.15)),
    }
    out_dir = os.path.join(SOURCE, kit, 'preview')
    os.makedirs(out_dir, exist_ok=True)
    paths = []
    for v in views:
        d = dirs[v].normalized()
        cam.location = centre + d * radius * 2.9
        cam.rotation_euler = (centre - cam.location).to_track_quat('-Z', 'Y').to_euler()
        path = os.path.join(out_dir, f'{name}_{v}.png')
        scene.render.filepath = path
        bpy.ops.render.render(write_still=True)
        paths.append(path)
    bpy.data.objects.remove(cam)
    return paths


def build_all(kit, builders, caps=None):
    """builders: {name: fn() -> joined object}. caps: {name: triangle cap}. Builds, exports, previews."""
    wanted = only_args()
    caps = caps or {}
    for name, fn in builders.items():
        if wanted and name not in wanted:
            continue
        reset()
        obj = fn()
        export_prop(obj, kit, name, caps.get(name, 4000))
        render_preview(obj, kit, name)
