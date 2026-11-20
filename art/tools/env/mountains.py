"""
Mountains environment kit: faceted snow peaks, violet-grey cliffs, pale meadow rocks, layered
pines, a sagging rope bridge, a ruined watchtower, fences, steps, wildflowers and snow drifts.

Concept: docs/concepts/mountains.webp. Conventions and helpers: art/tools/env/envkit.py.

    /Applications/Blender.app/Contents/MacOS/Blender --background --factory-startup \
        --python art/tools/env/mountains.py [-- prop_name ...] [-- --sheet]

Everything is seeded, so a rebuild gives the same meshes. Rock and mountain facets come from
convex hulls of hand-placed point sets (coplanar triangles merged), so they read as the concept's
big deliberate planes rather than noise. Colours are albedo: lighter on upward-facing facets and
violet on steep walls, which is rotation-invariant, so instances can be turned freely.
"""
import math
import os
import random
import sys

import bmesh
import bpy
from mathutils import Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import envkit as ek  # noqa: E402
from envkit import box, cylinder, join, paint, paint_by  # noqa: E402

KIT = 'mountains'

# --- palette (sampled from the concept) -------------------------------------------------------

PEAK = ['#3a384f', '#4a4762', '#5e5679', '#76698f', '#8f80a8', '#a898bb', '#bfb2cc']
SNOW = ['#c9cfe8', '#e0e3f2', '#f0f1f8', '#fbfbfe']
CLIFF = ['#433f55', '#5d5770', '#7a7389', '#958e9a', '#afa8ab', '#c9c2c4']
ROCK = ['#4c485c', '#77728a', '#9d97a0', '#bdb5ae', '#d6cdc4', '#ece3d6']
GRASS = ['#5f7033', '#768a3f', '#8a9a4b', '#9eaa5a']
PINE_TOP = ['#6a7a40', '#76874a', '#5f7039', '#82904f']
PINE_UNDER = ['#2c3824', '#34412a', '#27321f']
TRUNK = ['#7a4227', '#62351f', '#8a4e2c']
WOOD = ['#5a3820', '#7a4c29', '#94602f', '#a8703a']
PLANK = ['#7d5f42', '#94734f', '#a8845b', '#6a5038']
ROPE = ['#a8966f', '#b8a67f', '#8f7f5e']
SAND = ['#b8946a', '#cfa97c', '#ddb98c', '#e6c69c']
STONE = ['#7a716a', '#8a8075', '#9d9384', '#ab9f8f', '#b8ad9e', '#938a85']
MORTAR = '#3f3935'


def clamp01(x):
    return max(0.0, min(0.999, x))


def pick(pal, x):
    return pal[int(clamp01(x) * len(pal))]


# --- geometry helpers -------------------------------------------------------------------------

def hull(name, pts, color='#888888'):
    """Convex hull of a point set, coplanar triangles merged into one facet each."""
    bm = bmesh.new()
    vs = [bm.verts.new(Vector(p)) for p in pts]
    res = bmesh.ops.convex_hull(bm, input=vs, use_existing_faces=False)
    junk = {g for g in res['geom_interior'] + res['geom_unused'] if isinstance(g, bmesh.types.BMVert)}
    junk |= {v for v in bm.verts if not v.link_faces}
    if junk:
        # sorted: a set's order follows memory addresses, which would make rebuilds differ
        bm.verts.index_update()
        bmesh.ops.delete(bm, geom=sorted(junk, key=lambda v: v.index), context='VERTS')
    bmesh.ops.dissolve_limit(bm, angle_limit=math.radians(1.5), verts=list(bm.verts),
                             edges=list(bm.edges))
    bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
    return paint(ek._new_obj(name, bm, None), color)


def tube(name, pts, radius=0.03, color='#999999', sides=4):
    """A thin square tube (rope) along a polyline; no end caps."""
    bm = bmesh.new()
    rings = []
    n = len(pts)
    for i, p in enumerate(pts):
        p = Vector(p)
        a = Vector(pts[max(i - 1, 0)])
        b = Vector(pts[min(i + 1, n - 1)])
        t = (b - a).normalized()
        ref = Vector((0, 0, 1)) if abs(t.z) < 0.9 else Vector((1, 0, 0))
        u = t.cross(ref).normalized()
        v = t.cross(u).normalized()
        ring = []
        for k in range(sides):
            ang = (k + 0.5) * 2 * math.pi / sides
            ring.append(bm.verts.new(p + (u * math.cos(ang) + v * math.sin(ang)) * radius))
        rings.append(ring)
    for i in range(n - 1):
        r0, r1 = rings[i], rings[i + 1]
        for k in range(sides):
            k1 = (k + 1) % sides
            bm.faces.new((r0[k], r0[k1], r1[k1], r1[k]))
    bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
    return paint(ek._new_obj(name, bm, None), color)


def mesh(name, verts, faces, color='#888888'):
    return ek.from_pydata(name, verts, faces, color)


def rock_painter(pal, rng, up=0.5, jit=0.18, base=0.3):
    """Lighter on upward facets, darker on steep and downward ones, painterly per-facet jitter."""
    def fn(c, n):
        if n.z < -0.35:
            return pal[0]
        return pick(pal, base + up * n.z + 0.08 * n.x - 0.05 * n.y + rng.uniform(-jit, jit))
    return fn


# --- mountains --------------------------------------------------------------------------------

def block_pts(rng, centre, size, jitter=0.18):
    """Points of an angular boulder: a box's corners jittered plus a few chamfer points."""
    cx, cy, cz = centre
    sx, sy, sz = size
    pts = []
    for ix in (-1, 1):
        for iy in (-1, 1):
            for iz in (0, 1):
                k = rng.uniform(0.75, 1.0) if iz else 1.0
                pts.append((cx + ix * sx / 2 * k + rng.uniform(-jitter, jitter) * sx,
                            cy + iy * sy / 2 * k + rng.uniform(-jitter, jitter) * sy,
                            cz + iz * sz * rng.uniform(0.8, 1.0)))
    for _ in range(3):
        a = rng.uniform(0, 2 * math.pi)
        pts.append((cx + math.cos(a) * sx * 0.55, cy + math.sin(a) * sy * 0.55,
                    cz + sz * rng.uniform(0.5, 1.05)))
    return pts


def block(rng, parts, centre, size, jitter=0.18, pal_name='b'):
    parts.append(hull(f'{pal_name}{len(parts)}', block_pts(rng, centre, size, jitter)))


# A massif is a set of overlapping convex rock masses. Each mass is the convex hull of a
# hand-placed point set, so its sides are big flat planes and the edges between them are sharp
# aretes; where two masses meet they cut V-shaped couloirs into each other. build_massif joins
# them into one mesh: faces hidden inside another mass or under the ground are dropped, every
# facet gets one rock colour, then long edges are split (inside each plane, so the planes stay
# flat) and the small triangles are repainted with snow or grass, whose edges therefore run
# jagged across the planes like the concept's snowfields.

def ring(rng, cx, cy, z, rx, ry, n, jit=0.14, zj=0.02):
    phase = rng.uniform(0, 2 * math.pi)
    out = []
    for i in range(n):
        a = phase + (i + rng.uniform(-0.3, 0.3)) * 2 * math.pi / n
        k = rng.uniform(1 - jit, 1 + jit)
        out.append((cx + math.cos(a) * rx * k, cy + math.sin(a) * ry * k, z + rng.uniform(-1, 1) * zj * (rx + ry)))
    return out


def mass(rng, apexes, rings):
    """A rock mass: one or more summit points over irregular rings (cx, cy, z, rx, ry, n)."""
    pts = [tuple(a) for a in apexes]
    for r in rings:
        pts += ring(rng, *r)
    return pts


def arete(rng, top, bottom, w0, w1, bulge, keel=0.9):
    """A sharp-crested buttress from high on the mountain down and out to its foot: a crest line
    bowed outwards, with flanks falling away either side."""
    top, bottom = Vector(top), Vector(bottom)
    d = bottom - top
    horiz = Vector((d.x, d.y, 0)).normalized()
    side = Vector((-horiz.y, horiz.x, 0))
    up = Vector((0, 0, 1))
    pts = []
    for t in (0.0, 0.3, 0.62, 1.0):
        p = top.lerp(bottom, t) + up * bulge * math.sin(math.pi * min(t, 0.9)) * rng.uniform(0.7, 1.2)
        pts.append(tuple(p + side * rng.uniform(-0.1, 0.1) * w0))
    for t in (0.08, 0.45, 0.8, 1.0):
        p = top.lerp(bottom, t)
        w = (w0 + (w1 - w0) * t) * rng.uniform(0.85, 1.15)
        for s in (-1, 1):
            q = p + side * s * w - up * w * keel - horiz * w * 0.35
            if t == 1.0:
                q.z = min(q.z, bottom.z)
            pts.append(tuple(q))
    return pts


def noise2(x, y, seed=0.0):
    return (math.sin(0.11 * x + 1.3 + seed) * 0.45 + math.sin(0.13 * y + 0.4 + seed * 2) * 0.35
            + math.sin(0.07 * (x + y) + seed * 3) * 0.2 + math.sin(0.23 * x - 0.19 * y + seed) * 0.15)


def build_massif(name, rng, sets, facet_fn, target, detail_fn, cull_z=-1.5, eps=0.08):
    """sets: point lists (one convex mass each). facet_fn(centre, normal, mass) -> hex rock colour
    per facet. detail_fn(centre, normal, mass, facet, concave) -> hex or None, per small triangle
    after splitting (None keeps the facet colour). Returns the joined object."""
    hulls = []
    for pts in sets:
        bm = bmesh.new()
        vs = [bm.verts.new(Vector(p)) for p in pts]
        res = bmesh.ops.convex_hull(bm, input=vs, use_existing_faces=False)
        junk = {g for g in res['geom_interior'] + res['geom_unused'] if isinstance(g, bmesh.types.BMVert)}
        junk |= {v for v in bm.verts if not v.link_faces}
        if junk:
            bm.verts.index_update()
            bmesh.ops.delete(bm, geom=sorted(junk, key=lambda v: v.index), context='VERTS')
        bmesh.ops.dissolve_limit(bm, angle_limit=math.radians(1.0), verts=list(bm.verts), edges=list(bm.edges))
        bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
        planes = [(f.normal.copy(), f.calc_center_median().copy()) for f in bm.faces]
        hulls.append((bm, planes))

    def inside(p, skip):
        for j, (_, planes) in enumerate(hulls):
            if j != skip and all(n.dot(p - c) < -eps for n, c in planes):
                return True
        return False

    out = bmesh.new()
    col = out.loops.layers.float_color.new('Col')
    mlay = out.faces.layers.int.new('mass')
    flay = out.faces.layers.int.new('facet')
    facet = 0
    for i, (bm, _) in enumerate(hulls):
        vmap = {}
        for f in bm.faces:
            cos = [v.co for v in f.verts]
            if all(c.z < cull_z for c in cos) or all(inside(c, i) for c in cos):
                continue
            vs = []
            for v in f.verts:
                if v.index not in vmap or True:
                    pass
                key = v
                if key not in vmap:
                    vmap[key] = out.verts.new(v.co)
                vs.append(vmap[key])
            nf = out.faces.new(vs)
            rgba = ek.hex_rgb(facet_fn(f.calc_center_median(), f.normal, i))
            for lo in nf.loops:
                lo[col] = rgba
            nf[mlay] = i
            nf[flay] = facet
            facet += 1
    bmesh.ops.triangulate(out, faces=list(out.faces))
    # split the longest edges, a slice at a time, until the budget is reached
    while len(out.faces) < target * 1.45:
        edges = list(out.edges)
        lens = sorted(e.calc_length() for e in edges)
        thr = lens[int(len(lens) * 0.8)]
        long = [e for e in edges if e.calc_length() > thr]
        if not long:
            break
        bmesh.ops.subdivide_edges(out, edges=long, cuts=1, use_grid_fill=False,
                                  edge_percents={e: rng.uniform(0.38, 0.62) for e in long})
        bmesh.ops.triangulate(out, faces=list(out.faces))
    # second cull, now the triangles are small
    dead = [f for f in out.faces
            if all(inside(v.co, f[mlay]) for v in f.verts) or all(v.co.z < cull_z for v in f.verts)]
    bmesh.ops.delete(out, geom=dead, context='FACES')
    from mathutils.bvhtree import BVHTree
    tree = BVHTree.FromBMesh(out)
    for f in out.faces:
        c = f.calc_center_median()
        n = f.normal
        # concave = a couloir or a re-entrant corner: rays leaving the face sideways hit rock
        tan = n.orthogonal().normalized()
        bit = n.cross(tan)
        hits = 0
        o = c + n * 0.3
        for t in (tan, -tan, bit, -bit):
            loc, _, _, _ = tree.ray_cast(o, (n + t * 1.2).normalized(), 20.0)
            hits += loc is not None
        hexc = detail_fn(c, n, f[mlay], f[flay], hits >= 1)
        if hexc:
            rgba = ek.hex_rgb(hexc)
            for lo in f.loops:
                lo[col] = rgba
    me = bpy.data.meshes.new(name)
    out.to_mesh(me)
    out.free()
    for bm, _ in hulls:
        bm.free()
    for att in ('mass', 'facet'):
        me.attributes.remove(me.attributes[att])
    me.color_attributes.active_color = me.color_attributes['Col']
    me.color_attributes.render_color_index = me.color_attributes.active_color_index
    obj = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(obj)
    me.materials.append(ek.mat_kit())
    return obj


def lips(obj, rng, colour_fn, keep, thick=0.35, over=0.3, name='lip'):
    """Raised grass (or snow) slabs over chosen upward faces, with a lip over their edges: the
    concept's turf and snow cornices along ledge tops. keep(centre, normal, colour) picks faces."""
    src = obj.data
    layer = src.color_attributes['Col']
    bm = bmesh.new()
    vmap = {}
    for p in src.polygons:
        c = Vector(p.center)
        rgba = tuple(layer.data[p.loop_indices[0]].color)
        if not keep(c, p.normal, rgba):
            continue
        vs = []
        for vi in p.vertices:
            if vi not in vmap:
                vmap[vi] = bm.verts.new(src.vertices[vi].co)
            vs.append(vmap[vi])
        bm.faces.new(vs)
    if not bm.faces:
        bm.free()
        return None
    res = bmesh.ops.extrude_face_region(bm, geom=list(bm.faces))
    top = [g for g in res['geom'] if isinstance(g, bmesh.types.BMVert)]
    # islands: push each island's rim outwards from its centre
    topset = set(top)
    for v in top:
        v.co.z += thick * rng.uniform(0.7, 1.2)
    seen = set()
    for v in top:
        if v in seen:
            continue
        isl, stack_ = [], [v]
        while stack_:
            u = stack_.pop()
            if u in seen:
                continue
            seen.add(u)
            isl.append(u)
            for e in u.link_edges:
                w = e.other_vert(u)
                if w in topset and w not in seen:
                    stack_.append(w)
        cen = sum((u.co for u in isl), Vector()) / len(isl)
        for u in isl:
            rim = any(len([f for f in e.link_faces if all(x in topset for x in f.verts)]) < 2
                      for e in u.link_edges if e.other_vert(u) in topset)
            if rim:
                o = u.co - cen
                o.z = 0
                if o.length > 1e-6:
                    u.co += o.normalized() * over
                u.co.z -= thick * 0.25
    bmesh.ops.delete(bm, geom=[f for f in bm.faces if not all(v in topset for v in f.verts)
                               and all(v not in topset for v in f.verts)], context='FACES')
    bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
    # extrude_face_region emits the rim faces in pointer order; sort them so rebuilds match
    bm.verts.index_update()
    rank = {f: i for i, f in enumerate(sorted(bm.faces, key=lambda f: tuple(sorted(v.index for v in f.verts))))}
    bm.faces.sort(key=lambda f: rank[f])
    bm.faces.index_update()
    lo = ek._new_obj(name, bm, None)
    return paint_by(lo, colour_fn)


# --- peaks ------------------------------------------------------------------------------------

def peak_facet(rng, pal=PEAK):
    def fn(c, n, m):
        if n.z < -0.3:
            return pal[0]
        steep = 1 - max(n.z, 0)
        return pick(pal, 0.66 - 0.4 * steep + 0.14 * n.x - 0.06 * n.y + rng.uniform(-0.2, 0.2))
    return fn


def peak_snow(rng, H, start=0.3, full=0.9, couloir=0.18, seed=0.0, bias_amp=0.1):
    """Snow over most upward faces in the upper half (more readily higher up, the line wavering),
    filling concave couloirs further down; a few facets stay bare as rock ribs."""
    bias = {}

    def fn(c, n, m, facet, concave):
        if facet not in bias:
            bias[facet] = rng.uniform(-bias_amp, bias_amp) + (0.25 if rng.random() < 0.12 else 0.0)
        h = (c.z + 7.0 * noise2(c.x, c.y, seed)) / H
        if n.z < -0.05:
            return None
        k = clamp01((h - start) / (full - start))
        need = 0.46 - 0.38 * k + bias[facet]
        snowy = h > start and n.z > need
        if not snowy and concave and h > couloir and n.z > 0.1 + bias[facet] * 0.5:
            snowy = True
        if h > full and n.z > 0.05 + bias[facet] * 0.5:
            snowy = True
        if not snowy:
            return None
        return pick(SNOW, 0.2 + n.z * 0.95)
    return fn


def build_peak_a():
    rng = random.Random(1101)
    H = 90.0
    S = []
    # the main wedge: a summit ridge stepping down to the south-east, broad snowy shoulders
    S.append(mass(rng, [(-4, 5, 90), (4, -1, 86), (11, -7, 76)],
                  [(1, 0, 68, 11, 9, 5), (0, 0, 44, 20, 17, 6), (0, 0, 18, 29, 25, 7), (0, 0, -6, 36, 31, 8)]))
    # a broad apron: the mountain's foot spreads wide before the faces rise out of it
    S.append(mass(rng, [], [(0, 0, -6, 37, 32, 9), (0, 0, 9, 31, 26, 8), (1, 0, 20, 21, 17, 6)]))
    # shoulder summits and back masses that make the skyline irregular
    S.append(mass(rng, [(-21, 11, 68), (-27, 4, 61)], [(-20, 9, 46, 11, 10, 5), (-18, 7, 16, 18, 16, 5),
                                                       (-18, 7, -6, 22, 20, 6)]))
    S.append(mass(rng, [(23, -10, 59), (27, -2, 53)], [(21, -7, 38, 11, 10, 5), (19, -5, 12, 17, 15, 5),
                                                       (18, -5, -6, 20, 18, 6)]))
    S.append(mass(rng, [(6, 21, 66)], [(5, 18, 40, 11, 9, 5), (4, 16, 12, 18, 13, 5), (4, 15, -6, 21, 15, 6)]))
    S.append(mass(rng, [(-7, -20, 36), (0, -22, 30)], [(-5, -18, 14, 11, 9, 5), (-5, -18, -6, 16, 12, 5)]))
    S.append(mass(rng, [(-28, -10, 32)], [(-26, -9, 12, 10, 9, 5), (-25, -8, -6, 14, 13, 5)]))
    # broad aretes: the edges between the big faces, running from the summit to the foot
    for top, bot, w0, w1, b in (((-4, 4, 88), (-38, -15, -6), 4.5, 13, 2.5),
                                ((5, -2, 84), (24, -34, -6), 4.5, 13, 2.5),
                                ((-3, 6, 88), (-11, 37, -6), 4.5, 12, 2.2),
                                ((10, -6, 75), (40, 4, -6), 4.0, 12, 2.2),
                                ((-21, 10, 66), (-40, 22, -6), 3.5, 10, 1.8)):
        S.append(arete(rng, top, bot, w0, w1, b, keel=0.7))
    for x, y, z, r, h in ((-15, -4, 52, 4.5, 8), (13, -15, 44, 4.0, 7)):
        S.append(mass(rng, [(x, y, z + h)], [(x, y, z - 4, r, r, 5)]))
    for i in range(7):
        a = i * 2 * math.pi / 7 + rng.uniform(-0.25, 0.25)
        s = rng.uniform(6, 10)
        S.append(block_pts(rng, (math.cos(a) * rng.uniform(28, 33), math.sin(a) * rng.uniform(24, 28), -3),
                           (s, s * rng.uniform(0.7, 1.0), s * rng.uniform(0.6, 0.9))))
    return build_massif('mtn_peak_a', rng, S, peak_facet(rng), 6800, peak_snow(rng, H))


def build_peak_b():
    rng = random.Random(2202)
    H = 70.0
    S = []
    # the higher west summit and the lower east one
    S.append(mass(rng, [(-25, 4, 70), (-18, 0, 64)],
                  [(-23, 3, 46, 12, 11, 5), (-22, 2, 18, 21, 19, 6), (-21, 2, -6, 28, 27, 7)]))
    S.append(mass(rng, [(24, -3, 61), (31, 2, 55)],
                  [(24, -2, 38, 12, 11, 5), (23, -2, 12, 20, 19, 6), (22, -2, -6, 27, 26, 7)]))
    # the broad saddle between them: a long, gentle snowy ridge
    S.append(mass(rng, [(-12, 6, 43), (-2, 5, 45), (11, 3, 41)],
                  [(0, 4, 34, 17, 6, 6), (0, 3, 16, 24, 13, 6), (0, 0, -6, 33, 26, 8)]))
    # rock ribs running down the front and back of the saddle
    S.append(arete(rng, (-2, 4, 44), (-5, -31, -6), 3.0, 9, 2.0, keel=0.7))
    S.append(arete(rng, (4, 5, 42), (8, 33, -6), 3.0, 9, 2.0, keel=0.7))
    # the broad foot of the massif
    S.append(mass(rng, [], [(0, 0, -6, 50, 34, 10), (0, 0, 8, 42, 27, 9), (0, 0, 17, 30, 17, 7)]))
    # outlying shoulders and front and back buttresses
    S.append(mass(rng, [(-44, -5, 31)], [(-42, -4, 10, 9, 9, 5), (-41, -3, -6, 13, 14, 5)]))
    S.append(mass(rng, [(46, 6, 28)], [(44, 5, 8, 8, 9, 5), (42, 4, -6, 12, 14, 5)]))
    S.append(mass(rng, [(-6, -23, 27), (2, -24, 23)], [(-3, -21, 8, 10, 7, 4), (-2, -20, -6, 15, 10, 5)]))
    S.append(mass(rng, [(7, 23, 32)], [(6, 21, 10, 11, 8, 4), (5, 20, -6, 16, 11, 5)]))
    for top, bot, w0, w1, b in (((-25, 3, 68), (-47, 16, -6), 2.5, 8, 3),
                                ((-24, 3, 68), (-38, -30, -6), 2.5, 8, 3.5),
                                ((-19, 0, 62), (-12, -34, -6), 2.5, 8, 3.5),
                                ((-25, 5, 68), (-26, 35, -6), 2.5, 8, 3),
                                ((24, -3, 59), (16, -34, -6), 2.5, 8, 3),
                                ((25, -3, 59), (44, -25, -6), 2.5, 7, 3),
                                ((30, 2, 54), (50, 12, -6), 2.0, 7, 2.5),
                                ((25, -1, 59), (28, 34, -6), 2.5, 8, 3)):
        S.append(arete(rng, top, bot, w0, w1, b))
    for x, y, z, r, h in ((-35, 4, 38, 3.5, 8), (-11, -14, 36, 3, 8), (35, -10, 34, 3, 7), (14, 10, 38, 3, 7)):
        S.append(mass(rng, [(x, y, z + h)], [(x, y, z - 4, r, r, 5)]))
    for i in range(9):
        a = i * 2 * math.pi / 9 + rng.uniform(-0.2, 0.2)
        s = rng.uniform(5, 8)
        S.append(block_pts(rng, (math.cos(a) * rng.uniform(40, 46), math.sin(a) * rng.uniform(26, 30), -3),
                           (s, s * rng.uniform(0.7, 1.0), s * rng.uniform(0.6, 0.9))))
    return build_massif('mtn_peak_b', rng, S, peak_facet(rng), 5600, peak_snow(rng, H, start=0.34, seed=1.7))


# --- cliffs -----------------------------------------------------------------------------------

def slab_mass(rng, x0, x1, y0, y1, h, lean=0.2, bulge=0.14, top_tilt=0.12, z0=-2.0):
    """A broad cliff mass: an irregular, corner-cut footprint; a front that leans back as it rises
    and breaks into big angled planes; sides that bulge and taper; a faceted top, high at the back,
    whose gentler planes carry the grass."""
    w, d = x1 - x0, y1 - y0
    J = rng.uniform
    pts = []
    for fx, fy in ((0.1, 0), (0.45, -0.05), (0.8, 0.02), (1, 0.15), (1.02, 0.85), (0.6, 1.0), (0.15, 1.0),
                   (-0.02, 0.7), (0, 0.2)):
        pts.append((x0 + fx * w + J(-0.04, 0.04) * w, y0 + fy * d + J(-0.04, 0.04) * d, z0))
    # mid-height bulges on the sides and front
    for fx, fy in ((-0.06, J(0.3, 0.7)), (1.06, J(0.3, 0.7)), (J(0.2, 0.5), -bulge), (J(0.55, 0.85), -bulge * 0.7)):
        pts.append((x0 + fx * w, y0 + fy * d, h * J(0.3, 0.6)))
    # the top: front edge lower and set back by the lean, back edge higher
    front_y = y0 + lean * h
    for fx in (0.08, J(0.35, 0.6), 0.92):
        pts.append((x0 + fx * w + J(-0.05, 0.05) * w, front_y + J(-0.06, 0.08) * d,
                    h * J(0.84, 0.95) - top_tilt * d))
    for fx in (0.12, J(0.4, 0.6), 0.88):
        pts.append((x0 + fx * w + J(-0.05, 0.05) * w, y1 - J(0.05, 0.2) * d, h * J(0.95, 1.02)))
    return pts


def cliff_facet(rng, pal=CLIFF):
    def fn(c, n, m):
        if n.z < -0.3:
            return pal[0]
        steep = 1 - max(n.z, 0)
        return pick(pal, 0.66 - 0.38 * steep + 0.18 * n.x - 0.05 * n.y + rng.uniform(-0.18, 0.18))
    return fn


GRASS_SET = {tuple(round(x, 4) for x in ek.hex_rgb(g)) for g in GRASS}
SNOW_SET = {tuple(round(x, 4) for x in ek.hex_rgb(g)) for g in SNOW}


def cliff_cover(rng, snow_above=None, seed=0.0):
    """Grass on the upward ledge faces (snow on the highest, if asked), edges wavering."""
    def fn(c, n, m, facet, concave):
        k = n.z + 0.12 * noise2(c.x * 3, c.y * 3, seed)
        if k < 0.55 or c.z < 3.0:
            return None
        if snow_above is not None and c.z > snow_above:
            return SNOW[3] if n.z > 0.8 else SNOW[2]
        return GRASS[2] if n.z > 0.85 else GRASS[1]
    return fn


def finish_cliff(rng, obj, name):
    def is_cover(rgba, kind):
        key = tuple(round(x, 4) for x in rgba)
        return key in (GRASS_SET if kind == 'g' else SNOW_SET)
    out = [obj]
    g = lips(obj, rng, lambda c, n: (GRASS[3] if n.z > 0.85 else GRASS[2]) if n.z > 0.4 else GRASS[0],
             lambda c, n, rgba: n.z > 0.5 and is_cover(rgba, 'g'), name='grass')
    s = lips(obj, rng, lambda c, n: (SNOW[3] if n.z > 0.8 else SNOW[2]) if n.z > 0.4 else SNOW[0],
             lambda c, n, rgba: n.z > 0.5 and is_cover(rgba, 's'), name='snowlip')
    out += [o for o in (g, s) if o is not None]
    return join(out, name)


def build_cliff_a():
    rng = random.Random(3303)
    S = []
    # back wall: three broad masses, the middle one highest
    S.append(slab_mass(rng, -15.5, -4.0, -3.0, 6.0, 20.0))
    S.append(slab_mass(rng, -6.5, 6.5, -2.0, 6.0, 25.0, lean=0.14))
    S.append(slab_mass(rng, 4.0, 15.5, -3.5, 6.0, 18.0))
    # front: lower masses standing proud, their tops grassy ledges
    S.append(slab_mass(rng, -14.5, -5.5, -6.5, 0.5, 10.0, lean=0.1, top_tilt=0.06))
    S.append(slab_mass(rng, -4.0, 5.0, -6.0, 1.0, 13.5, lean=0.1, top_tilt=0.06))
    S.append(slab_mass(rng, 5.5, 14.5, -6.5, 0.0, 8.0, lean=0.1, top_tilt=0.06))
    # side crags breaking the ends
    S.append(mass(rng, [(-15, 1, 16)], [(-15, 1, -2, 3.5, 4.5, 5)]))
    S.append(mass(rng, [(15.5, 0, 13)], [(15, 1, -2, 3, 4.5, 5)]))
    for i in range(7):
        k = rng.uniform(1.4, 3.0)
        S.append(block_pts(rng, (rng.uniform(-14, 14), -7.0 - rng.uniform(0, 1.8), -0.4), (k, k * 0.8, k * 0.65),
                           jitter=0.12))
    obj = build_massif('cliff_a_rock', rng, S, cliff_facet(rng), 2800, cliff_cover(rng, snow_above=23.0))
    return finish_cliff(rng, obj, 'mtn_cliff_a')


def build_cliff_b():
    rng = random.Random(4404)
    S = []
    # the crag: a tall leaning wedge with a pointed, chiselled top
    S.append(mass(rng, [(-1.0, 0.5, 35.0), (1.6, 2.2, 32.5)],
                  [(-0.5, 0.5, 24, 4.2, 4.0, 5), (0, 0.5, 8, 5.6, 5.0, 6), (0, 0.5, -2, 6.0, 5.4, 6)]))
    S.append(slab_mass(rng, -8.0, -2.0, -3.0, 4.5, 23.0, lean=0.1))
    S.append(slab_mass(rng, 2.0, 8.0, -2.5, 5.5, 19.0, lean=0.1))
    S.append(slab_mass(rng, -6.0, 5.0, -6.0, -0.5, 10.5, lean=0.08, top_tilt=0.05))
    S.append(arete(rng, (-0.5, -0.5, 33), (-1.5, -6.5, -2), 1.2, 3.5, 1.5))
    for i in range(5):
        k = rng.uniform(1.4, 2.8)
        S.append(block_pts(rng, (rng.uniform(-7, 7), -7.0 - rng.uniform(0, 1.5), -0.4), (k, k * 0.8, k * 0.65),
                           jitter=0.12))
    obj = build_massif('cliff_b_rock', rng, S, cliff_facet(rng), 2600, cliff_cover(rng))
    return finish_cliff(rng, obj, 'mtn_cliff_b')


# --- rocks ------------------------------------------------------------------------------------

def chamfered(rng, cx, cy, z0, sx, sy, sz, cut=0.22, extra=4):
    """Box corners with each top corner cut by a small triangle (three points instead of one):
    the concept's chunky pale rocks with big flat faces and bevelled edges."""
    pts = []
    for ix in (-1, 1):
        for iy in (-1, 1):
            bx, by = cx + ix * sx / 2 * rng.uniform(0.9, 1.05), cy + iy * sy / 2 * rng.uniform(0.9, 1.05)
            pts.append((bx, by, z0))
            tz = z0 + sz * rng.uniform(0.85, 1.0)
            c = cut * rng.uniform(0.5, 1.4)
            pts.append((bx - ix * sx * c, by, tz))
            pts.append((bx, by - iy * sy * c, tz - sz * c * 0.6))
            pts.append((bx - ix * sx * c * 0.4, by - iy * sy * c * 0.4, tz - sz * c * 1.2))
    for _ in range(extra):
        a = rng.uniform(0, 2 * math.pi)
        pts.append((cx + math.cos(a) * sx * 0.56, cy + math.sin(a) * sy * 0.56, z0 + sz * rng.uniform(0.3, 0.7)))
    return pts


def build_rock_large():
    rng = random.Random(505)
    parts = []
    parts.append(hull('a', chamfered(rng, -0.7, 0.4, -0.6, 5.4, 4.4, 6.4)))
    parts.append(hull('b', chamfered(rng, 2.1, -1.0, -0.5, 3.6, 3.4, 3.8, cut=0.28)))
    parts.append(hull('c', chamfered(rng, -3.0, -1.7, -0.4, 2.2, 2.0, 2.0, cut=0.3)))
    parts.append(hull('d', chamfered(rng, 1.4, 2.0, -0.4, 2.6, 1.8, 2.6, cut=0.3)))
    obj = join(parts, 'mtn_rock_large')
    return paint_by(obj, rock_painter(ROCK, rng, up=0.45, base=0.42, jit=0.12))


def boulder_pts(rng, sx, sy, sz, n=18, sink=0.25):
    """Points on a squashed dome: wider than tall, a broad top, a few big facets."""
    pts = []
    golden = math.pi * (3 - math.sqrt(5))
    for i in range(n):
        u = (i + 0.5) / n
        z = 1 - u  # 1 at top .. 0 at the equator (upper hemisphere only)
        r = math.sqrt(max(0.0, 1 - z * z))
        a = i * golden + rng.uniform(-0.3, 0.3)
        k = rng.uniform(0.9, 1.08)
        pts.append((math.cos(a) * r * sx / 2 * k, math.sin(a) * r * sy / 2 * k, z * sz * k))
    for i in range(6):
        a = i * 2 * math.pi / 6 + rng.uniform(-0.3, 0.3)
        pts.append((math.cos(a) * sx / 2 * 0.92, math.sin(a) * sy / 2 * 0.92, -sink))
    return pts


def build_boulder():
    rng = random.Random(606)
    obj = hull('mtn_boulder', boulder_pts(rng, 2.6, 2.2, 1.7, n=16))
    return paint_by(obj, rock_painter(ROCK, rng, up=0.5, base=0.36, jit=0.12))


def build_boulder_flat():
    rng = random.Random(707)
    obj = hull('mtn_boulder_flat', chamfered(rng, 0, 0, -0.2, 3.0, 2.0, 1.15, cut=0.25, extra=3))
    return paint_by(obj, rock_painter(ROCK, rng, up=0.5, base=0.4, jit=0.12))


# --- pines ------------------------------------------------------------------------------------

def tier(rng, z, r, tips, name):
    """One layered bough tier: a drooping star, olive on top and dark green underneath."""
    verts = [(0, 0, z + r * 0.32), (0, 0, z - r * 0.12)]
    ring = []
    phase = rng.uniform(0, 2 * math.pi)
    for i in range(tips):
        a = phase + (i + rng.uniform(-0.2, 0.2)) * 2 * math.pi / tips
        rr = r * rng.uniform(0.85, 1.12)
        ring.append((math.cos(a) * rr, math.sin(a) * rr, z - rr * rng.uniform(0.28, 0.42)))
        a2 = phase + (i + 0.5) * 2 * math.pi / tips
        rn = r * rng.uniform(0.5, 0.62)
        ring.append((math.cos(a2) * rn, math.sin(a2) * rn, z - rn * 0.05))
    verts += ring
    m = len(ring)
    faces = []
    for i in range(m):
        j = (i + 1) % m
        faces.append((0, 2 + i, 2 + j))
        faces.append((1, 2 + j, 2 + i))
    obj = mesh(name, verts, faces)
    under = pick(PINE_UNDER, rng.random())
    top = pick(PINE_TOP, rng.random())
    paint_by(obj, lambda c, n: top if n.z > 0 else under)
    return obj


def build_pine(seed, height, radius, tiers, name):
    rng = random.Random(seed)
    parts = [cylinder('trunk', height * 0.022, height * 0.96, loc=(0, 0, -0.2), segments=6,
                      radius_top=0.03, color=TRUNK[0])]
    paint_by(parts[0], lambda c, n: TRUNK[0] if n.x + n.y > 0 else TRUNK[1])
    bottom = height * 0.27
    for i in range(tiers):
        t = i / (tiers - 1)
        z = bottom + (height * 0.93 - bottom) * t ** 0.92
        r = radius * (1 - t) ** 0.9 + 0.3
        tips = 8 if t < 0.5 else (7 if t < 0.8 else 6)
        parts.append(tier(rng, z, r, tips, f't{i}'))
    tipc = ek.cone('tip', 0.35, height * 0.1, loc=(0, 0, height * 0.9), segments=5, color=PINE_TOP[0])
    paint_by(tipc, lambda c, n: PINE_TOP[0] if n.z > 0.1 else PINE_UNDER[0])
    parts.append(tipc)
    return join(parts, name)


def build_pine_big():
    return build_pine(808, 14.0, 2.7, 11, 'mtn_pine')


def build_pine_small():
    return build_pine(909, 7.0, 1.5, 7, 'mtn_pine_small')


# --- rope bridge ------------------------------------------------------------------------------

def build_rope_bridge():
    rng = random.Random(1010)
    L = 40.0
    half = L / 2
    sag = 2.0
    hw = 0.8
    parts = []

    def deck_z(x):
        if abs(x) >= half:
            return 0.05
        return 0.05 - sag * (1 - (x / half) ** 2)

    def slope(x):
        if abs(x) >= half:
            return 0.0
        return sag * 2 * x / half ** 2

    # planks, crosswise, following the sag; a landing of planks past each post
    x = -half - 1.4
    i = 0
    while x < half + 1.4:
        w = rng.uniform(0.2, 0.26)
        cx = x + w / 2
        ang = math.atan(slope(cx))
        p = box(f'pl{i}', (w, 2 * hw + rng.uniform(-0.08, 0.12), 0.06),
                loc=(cx, rng.uniform(-0.05, 0.05), deck_z(cx) - 0.03),
                rot=(0, -ang, rng.uniform(-0.05, 0.05)), color=pick(PLANK, rng.random()))
        parts.append(p)
        x += w + rng.uniform(0.04, 0.08)
        i += 1
    # side ropes: one under the plank ends, a mid rope and the hand rail
    xs = [(-half + L * k / 40) for k in range(41)]
    for side in (-1, 1):
        y = side * (hw - 0.05)
        parts.append(tube('deckrope', [(x_, y, deck_z(x_) - 0.07) for x_ in xs], 0.045, ROPE[2]))
        parts.append(tube('rail', [(x_, side * (hw + 0.06), deck_z(x_) + 1.05) for x_ in xs], 0.045, ROPE[0]))
        parts.append(tube('mid', [(x_, side * (hw + 0.03), deck_z(x_) + 0.55) for x_ in xs], 0.035, ROPE[1]))
        # hangers every 1.33 m with a V lacing between them, knots where they meet the rail
        n = 30
        for k in range(1, n):
            xk = -half + L * k / n
            zt = deck_z(xk) + 1.05
            zb = deck_z(xk) - 0.05
            yr = side * (hw + 0.05)
            parts.append(tube('hang', [(xk, yr, zt), (xk, yr, zb)], 0.025, ROPE[2]))
            knot = box('knot', (0.12, 0.12, 0.12), loc=(xk, yr, zt - 0.06), color=ROPE[2])
            parts.append(knot)
            if k < n - 1:
                xn = -half + L * (k + 1) / n
                xm = (xk + xn) / 2
                parts.append(tube('v', [(xk, yr, zt - 0.05), (xm, yr, deck_z(xm) + 0.02),
                                        (xn, yr, deck_z(xn) + 1.0)], 0.02, ROPE[1]))
    # two posts at each end with knob tops, a rope collar, and anchor ropes to ground stakes
    for sx in (-1, 1):
        for side in (-1, 1):
            px, py = sx * (half + 0.15), side * (hw + 0.18)
            post = cylinder('post', 0.15, 1.75, loc=(px, py, -0.3), segments=7, color=WOOD[1])
            paint_by(post, lambda c, n: WOOD[2] if n.x * sx < 0 else WOOD[1])
            parts.append(post)
            parts.append(cylinder('knob', 0.17, 0.16, loc=(px, py, 1.45), segments=7, radius_top=0.1,
                                  color=WOOD[0]))
            parts.append(cylinder('collar', 0.17, 0.14, loc=(px, py, 1.0), segments=7, color=ROPE[2]))
            parts.append(cylinder('collar2', 0.17, 0.1, loc=(px, py, 0.5), segments=7, color=ROPE[2]))
            sxx, syy = px + sx * 2.2, py + side * 0.6
            parts.append(tube('anchor', [(px, py, 1.05), (px + sx * 1.1, py + side * 0.3, 0.5),
                                         (sxx, syy, 0.1)], 0.04, ROPE[0]))
            stake = box('stake', (0.12, 0.12, 0.55), loc=(sxx, syy, -0.25), rot=(0, sx * 0.3, 0),
                        color=WOOD[0])
            parts.append(stake)
    # a loose rope hanging under the middle of the span, as in the concept
    loose = []
    for k in range(13):
        t = k / 12
        x_ = -6 + 9 * t
        loose.append((x_, -0.3 + 0.2 * t, deck_z(x_) - 0.1 - 1.8 * math.sin(math.pi * t)))
    parts.append(tube('loose', loose, 0.035, ROPE[2]))
    return join(parts, 'mtn_rope_bridge')


# --- watchtower ruin --------------------------------------------------------------------------

def build_watchtower():
    rng = random.Random(1111)
    W = 6.4
    T = 0.85
    parts = []
    sides = {
        # name: (outward normal, tangent u (left to right seen from outside), perimeter offset)
        'front': (Vector((0, -1, 0)), Vector((1, 0, 0)), 0.0),
        'right': (Vector((1, 0, 0)), Vector((0, 1, 0)), 1.0),
        'back': (Vector((0, 1, 0)), Vector((-1, 0, 0)), 2.0),
        'left': (Vector((-1, 0, 0)), Vector((0, -1, 0)), 3.0),
    }
    door_w, door_h = 1.3, 2.55
    win = {'front': (0.9, 7.6, 0.55, 0.7), 'right': (-0.8, 10.2, 0.5, 0.65), 'left': (0.6, 5.0, 0.45, 0.6)}

    def top_h(side, u):
        """Broken wall-top height: whole at the back-left, crumbled low across the front-right."""
        p = (sides[side][2] + (u / W + 0.5)) / 4.0  # 0..1 around the perimeter
        # high around the back and left (p 0.55..0.95), low at front-right (p 0.05..0.3)
        hh = 11.0 + 3.0 * (0.5 - 0.5 * math.cos(2 * math.pi * (p - 0.27)))
        return hh

    # each wall's core is one extruded profile whose top edge is the broken, ragged wall-top:
    # irregular segments, sloped and stepped, with merlon stubs where the wall stands full height
    tops = {}
    rots = {'front': 0.0, 'right': math.pi / 2, 'back': math.pi, 'left': -math.pi / 2}
    for side, (nrm, tan, _) in sides.items():
        pts = []
        u = -W / 2
        while u < W / 2 - 1e-6:
            sw = min(rng.uniform(0.3, 0.75), W / 2 - u)
            if W / 2 - u - sw < 0.25:
                sw = W / 2 - u
            base = top_h(side, u + sw / 2) + rng.uniform(-0.6, 0.35)
            if base > 12.7 and rng.random() < 0.55:
                base += rng.uniform(0.45, 0.85)  # a merlon stub
            slope = rng.uniform(-0.25, 0.25)
            pts.append((u, base + slope))
            pts.append((u + sw, base - slope))
            u += sw
        tops[side] = pts
        prof = [(-W / 2, -0.3)]
        if side == 'front':
            prof += [(-door_w / 2 - 0.05, -0.3), (-door_w / 2 - 0.05, door_h + 0.05),
                     (door_w / 2 + 0.05, door_h + 0.05), (door_w / 2 + 0.05, -0.3)]
        prof += [(W / 2, -0.3)] + list(reversed(pts))
        c = nrm * (W / 2 - T / 2)
        wall = ek.extrude_profile(f'core_{side}', prof, T, color=MORTAR, loc=(c.x, c.y, 0),
                                  rot=(0, 0, rots[side]))
        wall.rotation_euler = (0, 0, rots[side])
        bpy.context.view_layer.update()
        nw = nrm.copy()
        paint_by(wall, lambda c_, n_, nw=nw: (pick(STONE, rng.uniform(0.2, 0.9)) if n_.z > 0.5
                                              else '#5e5650' if n_.dot(nw) < -0.5 else MORTAR))
        parts.append(wall)

    def top_at(side, u):
        pts = tops[side]
        for (ua, za), (ub, zb) in zip(pts[::2], pts[1::2]):
            if ua - 1e-6 <= u <= ub + 1e-6:
                return za + (zb - za) * (u - ua) / max(ub - ua, 1e-6)
        return pts[-1][1] if u > 0 else pts[0][1]

    # outer masonry: running-bond stones, each a shallow frustum proud of the wall
    sv, sf = [], []
    scol = []

    def stone(side, u0, u1, z0, z1, d):
        nrm, tan, _ = sides[side]
        g = 0.022
        base = Vector((0, 0, 0)) + nrm * (W / 2)
        quad0 = [base + tan * (u0 + g) + Vector((0, 0, z0 + g)), base + tan * (u1 - g) + Vector((0, 0, z0 + g)),
                 base + tan * (u1 - g) + Vector((0, 0, z1 - g)), base + tan * (u0 + g) + Vector((0, 0, z1 - g))]
        ins = min(0.035, (u1 - u0) * 0.1)
        quad1 = [base + nrm * d + tan * (u0 + g + ins) + Vector((0, 0, z0 + g + ins)),
                 base + nrm * d + tan * (u1 - g - ins) + Vector((0, 0, z0 + g + ins)),
                 base + nrm * d + tan * (u1 - g - ins) + Vector((0, 0, z1 - g - ins)),
                 base + nrm * d + tan * (u0 + g + ins) + Vector((0, 0, z1 - g - ins))]
        k = len(sv)
        sv.extend(quad0 + quad1)
        sf.append((k + 4, k + 5, k + 6, k + 7))
        for a in range(4):
            b = (a + 1) % 4
            sf.append((k + a, k + b, k + 4 + b, k + 4 + a))
        low = z1 < 1.5
        c = pick(STONE, rng.random())
        if low and rng.random() < 0.35:
            c = '#7a8050'  # moss on the lowest courses
        scol.extend([c] * 5)

    for side, (nrm, tan, _) in sides.items():
        ext = 0.14 if side in ('front', 'back') else 0.0
        z = -0.3
        row = 0
        while z < 14.6:
            sh = rng.uniform(0.36, 0.62) if z > 1.2 else rng.uniform(0.6, 0.8)
            u = -W / 2 - ext - (rng.uniform(0.2, 0.5) if row % 2 else 0.0)
            while u < W / 2 + ext - 0.05:
                sl = rng.uniform(0.45, 1.35) if z > 1.2 else rng.uniform(0.9, 1.5)
                u0, u1 = max(u, -W / 2 - ext), min(u + sl, W / 2 + ext)
                um = (u0 + u1) / 2
                uc = max(min(um, W / 2), -W / 2)
                topz = min(top_at(side, max(u0, -W / 2)), top_at(side, min(u1, W / 2)), top_at(side, uc))
                ok = z + sh * 0.6 < topz
                if side == 'front' and u1 > -door_w / 2 - 0.32 and u0 < door_w / 2 + 0.32 and z < door_h + 0.3:
                    ok = False
                if side in win:
                    wu, wz, ww, wh = win[side]
                    if u1 > wu - ww / 2 - 0.05 and u0 < wu + ww / 2 + 0.05 and z + sh > wz - wh / 2 and z < wz + wh / 2:
                        ok = False
                if ok and z > 1.5 and rng.random() < 0.05:
                    ok = False  # a fallen-out stone
                if ok and u1 - u0 > 0.2:
                    d = rng.uniform(0.03, 0.16) if z > 1.2 else rng.uniform(0.12, 0.24)
                    stone(side, u0, u1, z, min(z + sh, topz), d)
                u += sl
            z += sh
            row += 1
    st = ek.from_pydata('stones', [tuple(v) for v in sv], sf)
    layer = st.data.color_attributes['Col']
    for poly in st.data.polygons:
        rgba = ek.hex_rgb(scol[poly.index])
        for li in poly.loop_indices:
            layer.data[li].color = rgba
    parts.append(st)
    # arched doorway: voussoirs round a dark plank door set back in the wall
    r = door_w / 2
    spring = door_h - r
    door_prof = [(-r, 0)] + [(-r * math.cos(math.pi * k / 6), spring + r * math.sin(math.pi * k / 6))
                             for k in range(7)] + [(r, 0)]
    door_prof = [(-r, -0.3)] + door_prof[1:-1] + [(r, -0.3)]
    door = ek.extrude_profile('door', door_prof, 0.12, color='#6b4a33', loc=(0, -W / 2 + 0.55, 0),
                              rot=(0, 0, 0))
    paint_by(door, lambda c, n: '#5a3c28' if abs(n.y) > 0.5 else '#3a2a1e')
    parts.append(door)
    # the wall above the arch, filling the spandrels
    spandrel = [(-r - 0.05, spring)] + [(-r * math.cos(math.pi * k / 6) * 1.0, spring + r * math.sin(math.pi * k / 6))
                                        for k in range(1, 6)] + [(r + 0.05, spring), (r + 0.05, door_h + 0.1),
                                                                 (-r - 0.05, door_h + 0.1)]
    sp = ek.extrude_profile('spandrel', spandrel, T, color=MORTAR, loc=(0, -W / 2 + T / 2, 0))
    parts.append(sp)
    for k in range(7):
        a0 = math.pi * (k / 7)
        a1 = math.pi * ((k + 1) / 7)
        am = (a0 + a1) / 2
        cx = -(r - 0.02) * math.cos(am)
        cz = spring + (r - 0.02) * math.sin(am)
        v = box('vous', (0.4, 0.34, 0.5), loc=(cx, -W / 2 - 0.08, cz),
                rot=(0, am - math.pi / 2, 0), color=pick(STONE, 0.5 + rng.uniform(0, 0.5)))
        parts.append(v)
    for sx in (-1, 1):
        for k in range(3):
            parts.append(box('jamb', (0.38, 0.36, 0.55), loc=(sx * (r + 0.19), -W / 2 - 0.06, -0.2 + k * 0.62),
                             color=pick(STONE, rng.random())))
    # windows: dark recesses
    for side, (wu, wz, ww, wh) in win.items():
        nrm, tan, _ = sides[side]
        c = nrm * (W / 2 - 0.25) + tan * wu
        sz = (abs(tan.x) * ww + abs(nrm.x) * 0.5, abs(tan.y) * ww + abs(nrm.y) * 0.5, wh)
        parts.append(box('win', sz, loc=(c.x, c.y, wz - wh / 2), color='#1e1a18'))
    # inner face of the walls is in shade; a broken floor is visible through the top
    parts.append(box('floor', (W - 2 * T, W - 2 * T, 0.3), loc=(0, 0, 9.0), color='#4a4038'))
    # door steps
    parts.append(box('step0', (1.9, 0.6, 0.22), loc=(0, -W / 2 - 0.55, -0.05), color=STONE[1]))
    parts.append(box('step1', (1.6, 0.45, 0.2), loc=(0, -W / 2 - 0.25, 0.15), color=STONE[2]))
    # rubble: fallen squared blocks and broken stone round the base
    for i in range(22):
        a = rng.uniform(0, 2 * math.pi)
        if abs(math.atan2(math.sin(a), math.cos(a)) + math.pi / 2) < 0.35:
            a += 0.6  # keep the doorway path clear
        R = rng.uniform(3.4, 5.3)
        s = rng.uniform(0.35, 0.9)
        if i % 3 == 0:
            rub = []
            block(rng, rub, (math.cos(a) * R, math.sin(a) * R, -0.15), (s * 1.6, s * 1.2, s), jitter=0.12)
            o = rub[0]
            paint_by(o, rock_painter(ROCK, rng, base=0.4))
        else:
            o = box('rub', (s * 1.5, s, s * 0.8), loc=(math.cos(a) * R, math.sin(a) * R, -0.12),
                    rot=(rng.uniform(-0.25, 0.25), rng.uniform(-0.25, 0.25), rng.uniform(0, 3)),
                    color=pick(STONE, rng.random()))
        parts.append(o)
    # two big broken wall chunks leaning against the base, like the concept's right side
    for (x, y, rz) in ((3.9, -1.2, 0.4), (-2.2, -3.9, 1.2), (3.6, 2.3, -0.3)):
        parts.append(box('chunk', (1.6, 1.0, 1.1), loc=(x, y, -0.15), rot=(0.12, -0.15, rz),
                         color=pick(STONE, rng.random())))
    tower = join(parts, 'mtn_watchtower_ruin')
    # a slight batter: the walls lean in as they rise
    for v in tower.data.vertices:
        k = 1 - 0.045 * max(0.0, min(v.co.z, 15.0)) / 14.0
        v.co.x *= k
        v.co.y *= k
    return tower


# --- small path props -------------------------------------------------------------------------

def wood_painter(rng, pal=WOOD):
    def fn(c, n):
        if n.z > 0.6:
            return pal[3]
        return pick(pal, 0.35 + 0.3 * n.x - 0.2 * n.y + rng.uniform(-0.15, 0.15))
    return fn


def build_fence():
    rng = random.Random(1212)
    parts = []
    # posts at -1.5 and 0; the next segment's first post closes this one's +1.5 end
    for i, x in enumerate((-1.5, 0.0)):
        p = box(f'post{i}', (0.15, 0.15, 1.35), loc=(x, 0, -0.25),
                rot=(rng.uniform(-0.03, 0.03), rng.uniform(-0.03, 0.03), rng.uniform(-0.1, 0.1)))
        parts.append(p)
        parts.append(box(f'cap{i}', (0.17, 0.17, 0.05), loc=(x, 0, 1.08), rot=(0, 0, p.rotation_euler.z)))
    for j, z in enumerate((0.95, 0.52)):
        for k, (x0, x1) in enumerate(((-1.55, 0.02), (-0.02, 1.55))):
            parts.append(box(f'rail{j}{k}', (x1 - x0, 0.07, 0.13),
                             loc=((x0 + x1) / 2, -0.11, z + rng.uniform(-0.03, 0.03)),
                             rot=(0, rng.uniform(-0.02, 0.02), rng.uniform(-0.015, 0.015))))
    obj = join(parts, 'mtn_fence')
    return paint_by(obj, wood_painter(rng))


def build_steps():
    rng = random.Random(1313)
    parts = []
    n = 6
    run = 3.0 / n
    rise = 1.5 / n
    for i in range(n):
        y0 = -1.5 + i * run
        top = (i + 1) * rise
        e = box(f'earth{i}', (2.0, 3.0 - i * run + 0.02, top + 0.35), loc=(0, (y0 + 1.5) / 2 + 0.0, -0.35))
        ek.jitter(e, 0.02, seed=i)
        parts.append(e)
    earth = join(parts, 'earth')
    paint_by(earth, lambda c, n: pick(SAND, 0.65 + rng.uniform(-0.2, 0.3)) if n.z > 0.5
             else pick(SAND, rng.uniform(0.0, 0.3)))
    wood = []
    for i in range(n):
        y0 = -1.5 + i * run
        top = (i + 1) * rise
        wood.append(box(f'beam{i}', (2.1, 0.16, 0.22), loc=(rng.uniform(-0.03, 0.03), y0 + 0.08, top - 0.2),
                        rot=(0, rng.uniform(-0.02, 0.02), rng.uniform(-0.02, 0.02))))
        for sx in (-1, 1):
            wood.append(box('stake', (0.09, 0.09, 0.4), loc=(sx * 1.02, y0 - 0.02, top - 0.38)))
    w = join(wood, 'wood')
    paint_by(w, wood_painter(rng))
    return join([earth, w], 'mtn_steps')


def blade(rng, x, y, h, lean, color):
    a = rng.uniform(0, 2 * math.pi)
    r = rng.uniform(0.015, 0.03)
    base = [(x + math.cos(a + k * 2.094) * r, y + math.sin(a + k * 2.094) * r, -0.02) for k in range(3)]
    la = rng.uniform(0, 2 * math.pi)
    tip = (x + math.cos(la) * lean, y + math.sin(la) * lean, h)
    return mesh('blade', base + [tip], [(0, 1, 3), (1, 2, 3), (2, 0, 3)], color)


def flower_head(rng, x, y, z, kind):
    parts = []
    if kind == 'daisy':
        n, r, col, centre = 6, 0.09, '#f4f1e6', '#e8b830'
    elif kind == 'yellow':
        n, r, col, centre = 5, 0.065, '#f0c43a', '#d99a20'
    elif kind == 'orange':
        n, r, col, centre = 5, 0.08, '#e8822a', '#7a3a1a'
    else:
        n, r, col, centre = 0, 0, '', ''
    if kind == 'blue':
        for k in range(3):
            c = ['#5b78c8', '#7f8fd8', '#8a6cc0'][k]
            o = ek.ico('bl', 0.055 - k * 0.01, loc=(x, y, z + k * 0.08), subdiv=0, color=c)
            parts.append(o)
        return parts
    # a shallow cup of petals: star outline raised at the tips, two-sided
    verts = [(x, y, z - 0.01)]
    for k in range(2 * n):
        a = k * math.pi / n
        rr = r if k % 2 == 0 else r * 0.45
        verts.append((x + math.cos(a) * rr, y + math.sin(a) * rr, z + (0.025 if k % 2 == 0 else 0.0)))
    m = 2 * n
    faces = [(0, 1 + k, 1 + (k + 1) % m) for k in range(m)] + [(0, 1 + (k + 1) % m, 1 + k) for k in range(m)]
    parts.append(mesh('petals', verts, faces, col))
    parts.append(ek.ico('ctr', r * 0.32, loc=(x, y, z + 0.012), subdiv=0, color=centre, scale=(1, 1, 0.6)))
    return parts


def build_wildflowers():
    rng = random.Random(1414)
    parts = []
    # grass tufts across the patch
    for i in range(38):
        a = rng.uniform(0, 2 * math.pi)
        rr = 1.45 * math.sqrt(rng.random())
        tx, ty = math.cos(a) * rr, math.sin(a) * rr
        for b in range(rng.randint(5, 8)):
            parts.append(blade(rng, tx + rng.uniform(-0.08, 0.08), ty + rng.uniform(-0.08, 0.08),
                               rng.uniform(0.18, 0.42), rng.uniform(0.04, 0.14),
                               pick(GRASS, rng.uniform(0.2, 1.0))))
    # flowers in loose drifts of one kind, like the concept's meadow
    drifts = [('daisy', 0.6, -0.5, 14), ('yellow', -0.7, 0.4, 12), ('orange', 0.2, 0.9, 8),
              ('blue', -0.6, -0.8, 9), ('daisy', -1.0, 0.9, 6), ('orange', 1.0, -1.0, 4),
              ('yellow', 1.1, 0.5, 5)]
    for kind, cx, cy, count in drifts:
        for k in range(count):
            x = cx + rng.gauss(0, 0.32)
            y = cy + rng.gauss(0, 0.32)
            if math.hypot(x, y) > 1.5:
                continue
            h = rng.uniform(0.22, 0.4) if kind != 'blue' else rng.uniform(0.28, 0.42)
            parts.append(mesh('stem', [(x - 0.008, y, 0), (x + 0.008, y, 0), (x, y + 0.008, 0),
                                       (x + rng.uniform(-0.03, 0.03), y + rng.uniform(-0.03, 0.03), h)],
                              [(0, 1, 3), (1, 2, 3), (2, 0, 3)], GRASS[1]))
            hx = parts[-1].data.vertices[3].co
            parts += flower_head(rng, hx.x, hx.y, hx.z, kind)
    return join(parts, 'mtn_wildflowers')


def build_snow_drift():
    rng = random.Random(1515)
    parts = []

    def mound(cx, cy, sx, sy, sz, n, name):
        pts = []
        for i in range(n):
            a = i * 2 * math.pi / n + rng.uniform(-0.15, 0.15)
            k = rng.uniform(0.92, 1.06)
            pts.append((cx + math.cos(a) * sx * k, cy + math.sin(a) * sy * k, -0.25))
            pts.append((cx + math.cos(a) * sx * 0.82 * k, cy + math.sin(a) * sy * 0.82 * k, sz * rng.uniform(0.12, 0.25)))
            a2 = a + math.pi / n
            pts.append((cx + math.cos(a2) * sx * 0.55, cy + math.sin(a2) * sy * 0.55 + sy * 0.12,
                        sz * rng.uniform(0.45, 0.65)))
        for i in range(3):
            a = rng.uniform(0, 2 * math.pi)
            # the crest sits toward the lee (+Y) side: a long windward slope, a short steep back
            pts.append((cx + math.cos(a) * sx * 0.25, cy + sy * 0.3 + math.sin(a) * sy * 0.12,
                        sz * rng.uniform(0.85, 1.0)))
        parts.append(hull(name, pts))

    mound(-0.6, 0.1, 2.4, 1.95, 1.0, 9, 'm0')
    mound(1.5, -0.4, 1.5, 1.2, 0.7, 8, 'm1')
    mound(-2.2, 0.8, 0.9, 0.8, 0.45, 6, 'm2')
    snow = join(parts, 'snow')

    def fn(c, n):
        if n.z > 0.75:
            return pick(SNOW, 0.75 + rng.uniform(0, 0.25))
        if n.z > 0.4:
            return pick(SNOW, 0.5 + rng.uniform(0, 0.3))
        return pick(SNOW, rng.uniform(0.0, 0.45))
    paint_by(snow, fn)
    rocks = []
    for (x, y, s) in ((1.9, 0.6, 0.6), (-2.6, -0.6, 0.45)):
        block(rng, rocks, (x, y, -0.2), (s * 1.3, s, s * 0.9), jitter=0.12)
    r = join(rocks, 'rocks')
    paint_by(r, rock_painter(PEAK, rng, up=0.3, base=0.45))
    return join([snow, r], 'mtn_snow_drift')


# --- build ------------------------------------------------------------------------------------

LANDMARKS = ['mtn_peak_a', 'mtn_peak_b', 'mtn_cliff_a', 'mtn_cliff_b', 'mtn_rope_bridge', 'mtn_watchtower_ruin']

BUILDERS = {
    'mtn_peak_a': build_peak_a,
    'mtn_peak_b': build_peak_b,
    'mtn_cliff_a': build_cliff_a,
    'mtn_cliff_b': build_cliff_b,
    'mtn_rock_large': build_rock_large,
    'mtn_boulder': build_boulder,
    'mtn_boulder_flat': build_boulder_flat,
    'mtn_pine': build_pine_big,
    'mtn_pine_small': build_pine_small,
    'mtn_rope_bridge': build_rope_bridge,
    'mtn_watchtower_ruin': build_watchtower,
    'mtn_fence': build_fence,
    'mtn_steps': build_steps,
    'mtn_wildflowers': build_wildflowers,
    'mtn_snow_drift': build_snow_drift,
}

# props.json entries. Colliders are axis-aligned in the prop's own frame at scale 1, y up, standing
# on the pivot (a box spans y 0..2*hy, a cylinder y 0..height). Size is measured at build time.
META = {
    'mtn_peak_a': dict(
        collider={'kind': 'cylinder', 'radius': 22.0, 'height': 60.0}, footprint=38.0,
        notes='Snow-capped mountain, 90 m to a summit ridge that steps down to the south-east, ~74 x 64 m '
              'at the ground (aretes reach ~80 x 71 m just below it). Big flat violet facets, aretes and '
              'snow-filled couloirs; snow over the upward faces of the upper half. Backdrop landmark; the '
              'base sinks ~6 m below the pivot, so it sits on rough or sloping ground. Turn it freely: '
              'colours assume no sun direction. The cylinder is the solid core only; keep the player off '
              'the flanks with terrain.'),
    'mtn_peak_b': dict(
        collider={'kind': 'box', 'half': [38.0, 24.0, 20.0]}, footprint=50.0,
        notes='Broad double-summit massif: 70 m west summit, 61 m east summit, a snowy saddle at ~45 m '
              'between, ~100 x 66 m at the ground, long axis on X. Backdrop landmark; base sinks ~6 m. '
              'The box is the solid core.'),
    'mtn_cliff_a': dict(
        collider={'kind': 'box', 'half': [15.0, 11.0, 5.5]}, footprint=18.0,
        notes='Faceted violet-grey cliff wall chunk, front faces -Y (glTF +Z): three broad back masses '
              '(the middle one 25 m with a snow cap) and three lower front masses whose tops are grass '
              'ledges with turf lips. Lay it against steep terrain with its back (+Y) in the slope; base '
              'sinks 2 m. Several side by side, rotated and scaled 0.8-1.3, make a long wall. The front '
              'masses and scree stand ~2 m proud of the box.'),
    'mtn_cliff_b': dict(
        collider={'kind': 'box', 'half': [7.0, 16.0, 5.5]}, footprint=10.0,
        notes='Tall crag or buttress, 35 m, a leaning pointed wedge with two shoulders and a grassy front '
              'ledge; front faces -Y. Use at gorge rims and as a vertical accent among mtn_cliff_a walls; '
              'base sinks 2-3 m.'),
    'mtn_rock_large': dict(
        collider={'kind': 'box', 'half': [3.6, 2.8, 2.4]}, footprint=5.0,
        notes='Pale faceted outcrop of four chunky blocks, like the concept\'s foreground rocks. Beside '
              'trails and on meadow edges; base sinks 0.6 m.'),
    'mtn_boulder': dict(
        collider={'kind': 'cylinder', 'radius': 1.05, 'height': 1.55}, footprint=1.8,
        notes='Rounded-faceted meadow boulder ~2.5 m across. Scatter in loose groups of 2-5 at mixed '
              'scale (0.4-1.3) and yaw over meadows; base sinks 0.25 m.'),
    'mtn_boulder_flat': dict(
        collider={'kind': 'box', 'half': [1.4, 0.45, 0.9]}, footprint=2.0,
        notes='Low chamfered slab 3 x 2 x 1 m. Mix with mtn_boulder in meadows and at path edges; also '
              'works as a stepping stone. Base sinks 0.2 m.'),
    'mtn_pine': dict(
        collider={'kind': 'cylinder', 'radius': 0.35, 'height': 14.0}, footprint=2.5,
        notes='Tall layered conifer, 14 m, olive-topped tiers with dark undersides. Scatter in loose '
              'stands on slopes and along the trail; vary yaw and scale 0.8-1.25. Collider is the trunk.'),
    'mtn_pine_small': dict(
        collider={'kind': 'cylinder', 'radius': 0.2, 'height': 7.0}, footprint=1.5,
        notes='Young conifer, 7 m. Mix with mtn_pine at stand edges and on cliff ledges.'),
    'mtn_rope_bridge': dict(
        collider={'kind': 'none'}, footprint=4.0,
        notes='Sagging rope suspension bridge spanning X: 40 m between the two post pairs at x = +-20.15 '
              '(planks run on 1.4 m past each), deck 1.6 m wide, 2 m sag at mid-span, hand rails 1.05 m '
              'above the deck. The pivot is at deck level at the ends: put both ends on the gorge rims '
              'at the same height. Walk surface: not carried by a collider; the game must supply one '
              '(a deck ribbon following y = -2 * (1 - (x / 20)^2), |x| <= 20, width 1.6). Post colliders '
              '(r 0.15 at x = +-20.15, z = +-0.98) are optional.'),
    'mtn_watchtower_ruin': dict(
        collider={'kind': 'box', 'half': [3.3, 7.0, 3.3]}, footprint=6.5,
        notes='Ruined stone watchtower ~6.5 m wide, 14-15 m tall, broken crenellated top (high at the back '
              'left), arched door and two steps on the front (-Y), rubble at the base out to ~5 m. Place '
              'on a grassy cliff ledge with the door facing the path. The door is closed; the box is the '
              'tower body, rubble has no collider.'),
    'mtn_fence': dict(
        collider={'kind': 'box', 'half': [1.5, 0.55, 0.08]}, footprint=0.0,
        notes='Post-and-rail fence segment, 3 m along X, 1.1 m tall. Posts at x = -1.5 and 0; tile '
              'segments end to end every 3 m along X (the next segment\'s first post closes the joint) '
              'and finish a run with one more post-only segment or leave it open. Rails sit on the -Y '
              'side: put that side toward the path. Small yaw changes at joints follow a curving path.'),
    'mtn_steps': dict(
        collider={'kind': 'none'}, footprint=0.0,
        notes='Wooden-edged earth steps, 2 m wide, six 0.25 m risers rising 1.5 m over 3 m toward +Y '
              '(bottom step at -Y). Walk surface: shape the terrain (or a ramp collider) to the 1:2 slope '
              'under it; the steps are visual. Chain them up a trail, each 1.5 m higher and 3 m further.'),
    'mtn_wildflowers': dict(
        collider={'kind': 'none'}, footprint=0.0,
        notes='3 x 3 m ground patch of grass tufts with drifts of white daisies, yellow buttercups, orange '
              'poppies and blue spikes. Decal-like: scatter many over meadows and trail edges at any yaw '
              'and scale 0.7-1.4; no base, so it sits on any terrain.'),
    'mtn_snow_drift': dict(
        collider={'kind': 'none'}, footprint=0.0,
        notes='Low faceted wind-blown snow mound, 6 x 3.5 x 1 m, with two rock tips poking through; the '
              'crest leans to +Y (lee side). Scatter above the tree line and at cliff feet; base sinks '
              '0.25 m. Walkable: terrain carries the player.'),
}

CAPS = {name: 10000 for name in LANDMARKS}

EXTRA_VIEWS = {
    'mtn_rope_bridge': ('front',),
    'mtn_watchtower_ruin': ('front',),
    'mtn_peak_a': ('front', 'low'),
    'mtn_peak_b': ('front', 'low'),
    'mtn_cliff_a': ('front', 'low'),
    'mtn_cliff_b': ('low',),
    'mtn_steps': ('side',),
}


def preview(obj, name, views=('three_quarter',), size=720):
    """Lit preview render(s) of the prop, art/source/env/mountains/preview/<name>_<view>.png.

    envkit.render_preview uses Workbench under factory settings (AgX view transform, Default
    studio light), which renders white at about 50% grey and flattens the facets, so it cannot be
    compared with the concept. This uses the same camera framing with EEVEE, a warm sun from the
    upper right and a blue sky fill, the light the concept is painted in."""
    scene = bpy.context.scene
    try:
        scene.render.engine = 'BLENDER_EEVEE'
    except TypeError:
        return ek.render_preview(obj, KIT, name, views=views, size=size)
    scene.view_settings.view_transform = 'Standard'
    scene.render.resolution_x = size
    scene.render.resolution_y = size
    scene.render.film_transparent = False
    world = bpy.data.worlds.new('preview_sky')
    scene.world = world
    world.use_nodes = True
    bg = next(n for n in world.node_tree.nodes if n.type == 'BACKGROUND')
    bg.inputs['Color'].default_value = (0.42, 0.55, 0.78, 1.0)
    bg.inputs['Strength'].default_value = 0.45
    sun_data = bpy.data.lights.new('preview_sun', 'SUN')
    sun_data.energy = 3.0
    sun_data.color = (1.0, 0.95, 0.86)
    sun_data.angle = math.radians(2)
    sun = bpy.data.objects.new('preview_sun', sun_data)
    scene.collection.objects.link(sun)
    sun.rotation_euler = Vector((0.75, -0.45, 0.6)).to_track_quat('Z', 'Y').to_euler()
    corners = [obj.matrix_world @ Vector(c) for c in obj.bound_box]
    lo = Vector([min(v[i] for v in corners) for i in range(3)])
    hi = Vector([max(v[i] for v in corners) for i in range(3)])
    centre = (lo + hi) / 2
    radius = max((hi - lo).length / 2, 0.5)
    cam_data = bpy.data.cameras.new('preview_cam')
    cam_data.lens = 50
    cam_data.clip_end = 5000
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
    out_dir = os.path.join(ek.SOURCE, KIT, 'preview')
    os.makedirs(out_dir, exist_ok=True)
    paths = []
    for v in views:
        d = dirs[v].normalized()
        cam.location = centre + d * radius * 2.6
        cam.rotation_euler = (centre - cam.location).to_track_quat('-Z', 'Y').to_euler()
        path = os.path.join(out_dir, f'{name}_{v}.png')
        scene.render.filepath = path
        bpy.ops.render.render(write_still=True)
        paths.append(path)
    for o in (cam, sun):
        bpy.data.objects.remove(o)
    return paths


def contact_sheet(names, cols=5, tile=360):
    """Tile the three-quarter previews into art/source/env/mountains/preview/_kit_sheet.png."""
    import numpy as np
    prev = os.path.join(ek.SOURCE, KIT, 'preview')
    rows = (len(names) + cols - 1) // cols
    sheet = np.ones((rows * tile, cols * tile, 4), dtype=np.float32)
    for i, name in enumerate(names):
        path = os.path.join(prev, f'{name}_three_quarter.png')
        if not os.path.exists(path):
            continue
        img = bpy.data.images.load(path)
        w, h = img.size
        px = np.array(img.pixels[:], dtype=np.float32).reshape(h, w, 4)
        ys = (np.arange(tile) * h / tile).astype(int)
        xs = (np.arange(tile) * w / tile).astype(int)
        small = px[ys][:, xs]
        r, c = divmod(i, cols)
        # Blender pixel rows run bottom-up
        y0 = (rows - 1 - r) * tile
        sheet[y0:y0 + tile, c * tile:(c + 1) * tile] = small
        sheet[y0:y0 + tile, c * tile:c * tile + 2] = 0.15
        sheet[y0:y0 + 2, c * tile:(c + 1) * tile] = 0.15
        bpy.data.images.remove(img)
    out = bpy.data.images.new('kit_sheet', cols * tile, rows * tile, alpha=True)
    out.pixels[:] = sheet.ravel()
    out.filepath_raw = os.path.join(prev, '_kit_sheet.png')
    out.file_format = 'PNG'
    out.save()
    print('ENVKIT sheet ->', out.filepath_raw)


def measure(obj):
    """Bounds in game space (y up): size [x, height, depth] and the lowest point below the pivot."""
    me = obj.data
    xs = [v.co.x for v in me.vertices]
    ys = [v.co.y for v in me.vertices]
    zs = [v.co.z for v in me.vertices]
    return {'size': [round(max(xs) - min(xs), 2), round(max(zs) - min(zs), 2), round(max(ys) - min(ys), 2)],
            'top': round(max(zs), 2), 'bottom': round(min(zs), 2)}


def write_props(measured):
    """art/source/env/mountains/props.json: META plus the measured size of each prop built."""
    import json
    path = os.path.join(ek.SOURCE, KIT, 'props.json')
    data = {}
    if os.path.exists(path):
        with open(path) as f:
            data = json.load(f)
    for name, m in measured.items():
        meta = META[name]
        data[name] = {'landmark': name in LANDMARKS, 'collider': meta['collider'],
                      'footprint': meta['footprint'], 'size': m['size'], 'notes': meta['notes']}
    data = {k: data[k] for k in BUILDERS if k in data}
    with open(path, 'w') as f:
        json.dump(data, f, indent=2)
        f.write('\n')
    print('ENVKIT props ->', os.path.relpath(path, ek.REPO))


def main():
    wanted = ek.only_args()
    sheet = '--sheet' in wanted
    wanted = [w for w in wanted if not w.startswith('--')]
    measured = {}
    for name, fn in BUILDERS.items():
        if wanted and name not in wanted:
            continue
        ek.reset()
        obj = fn()
        ek.export_prop(obj, KIT, name, CAPS.get(name, 4000))
        measured[name] = measure(obj)
        print('ENVKIT bounds', name, measured[name])
        preview(obj, name, views=('three_quarter',) + EXTRA_VIEWS.get(name, ()))
    write_props(measured)
    if sheet or not wanted:
        contact_sheet(list(BUILDERS))


main()
