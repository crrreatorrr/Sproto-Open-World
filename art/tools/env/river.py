"""
River kit: the objects in and beside the valley river (concept: docs/concepts/river.webp).

A turquoise river through a green valley: a timber watermill with a big spoked overshot wheel fed
by a wooden flume, an old grey stone arch bridge, weeping willows, white birches, cattails, lily
pads, pebble shoals, mossy faceted boulders with foam rings, a fishing dock and a rowing boat,
pines in the distance. The water surface itself is the game's; these props sit in and beside it.

Conventions are envkit's (metres, +Z up, pivot at the footprint centre on the ground, front faces
-Y, flat per-face vertex colour). Water-surface props (lily pads, foam ring, boulders, shoal, boat)
treat z = 0 as the water surface. Everything is deterministic: seeded randomness only.

    /Applications/Blender.app/Contents/MacOS/Blender --background --factory-startup \
        --python art/tools/env/river.py [-- prop_name ... | _kit_sheet]

Geometry is accumulated in a small MeshBuilder (one Blender object per prop) rather than as
hundreds of primitives joined with bpy.ops, which keeps builds fast. Building props also refreshes
their entries in art/source/env/river/props.json; building everything also renders the contact
sheet art/source/env/river/preview/_kit_sheet.png.
"""
import json
import math
import os
import random
import sys

import bmesh
import bpy
from mathutils import Matrix, Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import envkit as ek  # noqa: E402

KIT = 'river'
PI = math.pi
X = Vector((1, 0, 0))
Y = Vector((0, 1, 0))
Z = Vector((0, 0, 1))


def V(*a):
    return Vector(a)


# --- palette (sampled from the concept, flattened to painterly tones) ----------------------------

WOOD_LIT = ['#b98c5a', '#ad8150', '#c49563', '#a77a4a']      # wheel rims, flume, frame
WOOD_MID = ['#8f6842', '#82603c', '#9a7048']
WOOD_DARK = ['#4a3826', '#55402b', '#3f3020']                 # bucket insides
FRAME = ['#a3703f', '#ad7a48', '#986838']                     # trestle beams
TIMBER = ['#6b4a2e', '#5e4128', '#734f31']                    # half-timber members
PLASTER = ['#e6d8b8', '#e0d0ae', '#ebdfc2']
SHINGLE = ['#8a4f36', '#9a5a3c', '#7c4630', '#a36444', '#86513a']
IRON = ['#4f545b', '#464a50', '#5a6068']
IRON_DARK = '#33363b'
PIER_STONE = ['#c9bfa0', '#b8b192', '#a9a386', '#d3caac', '#bdb698', '#9f9a80']
MOSS = ['#8aa04a', '#7a8f3c', '#98ad52', '#6f8434']
MORTAR = '#6c685c'
BRIDGE_STONE = ['#7a8381', '#6d7674', '#848c89', '#737c79', '#8d9692', '#68716f', '#7f8574']
BRIDGE_LIGHT = ['#8f9894', '#9aa29d', '#87908c', '#a3aaa4']
BRIDGE_MORTAR = '#474e4c'
BRIDGE_MOSS = ['#7c8c4c', '#71824a', '#899a56']
BARK_WILLOW = ['#5b3f30', '#4e362a', '#644636']
WILLOW = [('#6f8c4a', '#93b064', '#b7d083'), ('#7a9852', '#a2bd70', '#c3da92'),
          ('#84a05a', '#adc77c', '#cde29e'), ('#67844a', '#86a35d', '#a8c47a'),
          ('#8ba663', '#b5cd86', '#d3e6a6'), ('#728f4e', '#98b46a', '#b9d189')]
BIRCH_WHITE = '#ebe9e0'
BIRCH_SHADE = '#d6d5cc'
BIRCH_MARK = '#2b2b29'
BIRCH_BASE = ['#4a4a44', '#57564f']
BIRCH_TWIG = '#4a4741'
BIRCH_LEAF = [('#8cab52', '#aac86c', '#c8de8c'), ('#94b25a', '#b4cf76', '#d0e497'),
              ('#829f4c', '#a0bf62', '#bed784')]
PINE = ['#4c6b4e', '#55765a', '#45624a', '#5f7f5e', '#4f7052']
PINE_UNDER = '#30473a'
PINE_TRUNK = ['#6b4a32', '#5e4230']
CATTAIL_HEAD = ['#8f521d', '#9a5a22', '#84491a']
CATTAIL_SPIKE = '#c8b46a'
CATTAIL_STEM = ['#869f55', '#7d9a4c', '#93ab5f']
REED = ['#6f8f3a', '#86a24c', '#a3b86a', '#5b7a30', '#94ad58']
LILY = [('#5f8a2a', '#7aa33a', '#9cc458'), ('#6b962f', '#88b046', '#a8cf62'),
        ('#557f26', '#6f9a34', '#90bb50')]
LILY_WHITE = '#f6f2ec'
LILY_PINK = '#f0aec4'
LILY_GOLD = '#e8c84a'
SAND = ['#f2d8ad', '#ecd09f', '#f5dfb7']
SAND_DAMP = ['#e0c28e', '#d9ba86']
SAND_WET = ['#c9ad7c', '#c2a676']
PEBBLE = ['#9d9892', '#b3ada5', '#87827c', '#c4bdb2', '#7a7672', '#d2cabd', '#a59f97']
ROCK = ['#a29d8c', '#8f8b7e', '#b3ac9a', '#98948a', '#bcb4a0']
ROCK_DARK = ['#646a66', '#59605c', '#6e736f']
ROCK_MOSS = ['#7f9a2e', '#98b23e', '#6c8526', '#8aa636']
FOAM = ['#f4f8f7', '#e6f0f1', '#fbfdfc']
DOCK_PLANK = ['#d2aa78', '#c49a68', '#b98d5c', '#d9b88a', '#c9a06e']
DOCK_POST = ['#7a5a38', '#6e5232']
DOCK_WET = '#4a3c28'
ROPE = '#c9b182'
BOAT_RED = '#a63a24'
BOAT_BOTTOM = ['#6a2a16', '#5e2614']
BOAT_WHITE = '#efe9dc'
BOAT_WOOD = ['#a8703f', '#9a6438', '#b07a48']
BOAT_INNER = ['#c49a68', '#b98d5c', '#cea878']
OAR = ['#cfa86c', '#c49a60']


# --- deterministic noise ----------------------------------------------------------------------

def h3(p, seed=0):
    """A stable pseudo-random number in [0, 1) for a position."""
    x = math.sin(p.x * 12.9898 + p.y * 78.233 + p.z * 37.719 + seed * 11.131) * 43758.5453
    return x - math.floor(x)


def pick(pal, p, seed=0):
    return pal[int(h3(p, seed) * len(pal)) % len(pal)]


def shade3(tri):
    """Colour a face by its facing from a (dark, base, light) triple: lit tops, shaded undersides."""
    dark, base, light = tri

    def fn(c, n):
        if n.z > 0.45:
            return light
        if n.z < -0.35:
            return dark
        return base
    return fn


def newell(pts):
    n = Vector((0, 0, 0))
    for i, a in enumerate(pts):
        b = pts[(i + 1) % len(pts)]
        n.x += (a.y - b.y) * (a.z + b.z)
        n.y += (a.z - b.z) * (a.x + b.x)
        n.z += (a.x - b.x) * (a.y + b.y)
    return n


# --- mesh builder ------------------------------------------------------------------------------

HEXF = [(0, 1, 2, 3), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)]


class MB:
    """Accumulates faces (with per-face colour, material and optional UVs) for one object."""

    def __init__(self):
        self.verts, self.faces, self.fcol, self.fmat, self.fuv = [], [], [], [], []

    def add(self, verts, faces, color='#888888', mat='kit', uvs=None, orient=True):
        vs = [Vector(v) for v in verts]
        base = len(self.verts)
        cen = sum(vs, Vector()) / len(vs)
        for fi, f in enumerate(faces):
            f = list(f)
            if len(set(f)) < 3:
                continue
            pts = [vs[i] for i in f]
            nrm = newell(pts)
            fc = sum(pts, Vector()) / len(pts)
            uv = list(uvs[fi]) if uvs else None
            flip = (orient == 'up' and nrm.z < 0) or (orient is True and nrm.length > 1e-9 and nrm.dot(fc - cen) < 0)
            if flip:
                f = f[::-1]
                nrm = -nrm
                if uv:
                    uv = uv[::-1]
            nn = nrm.normalized() if nrm.length > 1e-9 else Z.copy()
            if callable(color):
                col = color(fc, nn)
            elif isinstance(color, (list, tuple)):
                col = color[fi]
            else:
                col = color
            self.faces.append([base + i for i in f])
            self.fcol.append(col)
            self.fmat.append(mat)
            self.fuv.append(uv)
        self.verts.extend(vs)
        return self

    def extend(self, other):
        base = len(self.verts)
        self.verts.extend(other.verts)
        self.faces.extend([[base + i for i in f] for f in other.faces])
        self.fcol.extend(other.fcol)
        self.fmat.extend(other.fmat)
        self.fuv.extend(other.fuv)

    def transform(self, M):
        self.verts = [M @ v for v in self.verts]
        return self

    def tris(self):
        return sum(len(f) - 2 for f in self.faces)

    def bounds(self):
        lo = Vector((min(v[i] for v in self.verts) for i in range(3)))
        hi = Vector((max(v[i] for v in self.verts) for i in range(3)))
        return lo, hi

    def to_object(self, name):
        me = bpy.data.meshes.new(name)
        me.from_pydata([tuple(v) for v in self.verts], [], self.faces)
        order = ['kit', 'water', 'glow']
        used = [m for m in order if m in self.fmat]
        mats = {'kit': ek.mat_kit, 'water': ek.mat_water, 'glow': ek.mat_glow}
        for m in used:
            me.materials.append(mats[m]())
        me.polygons.foreach_set('material_index', [used.index(m) for m in self.fmat])
        layer = me.color_attributes.new('Col', 'FLOAT_COLOR', 'CORNER')
        cache = {}
        cols = []
        for p, c in zip(me.polygons, self.fcol):
            if c not in cache:
                cache[c] = ek.hex_rgb(c)
            cols.extend(list(cache[c]) * p.loop_total)
        layer.data.foreach_set('color', cols)
        try:
            me.color_attributes.active_color = layer
            me.color_attributes.render_color_index = me.color_attributes.active_color_index
        except (AttributeError, TypeError):
            pass
        if any(self.fuv):
            uvl = me.uv_layers.new(name='UVMap')
            data = []
            for p, uv in zip(me.polygons, self.fuv):
                if uv:
                    for u, v in uv:
                        data += [u, v]
                else:
                    data += [0.0, 0.0] * p.loop_total
            uvl.data.foreach_set('uv', data)
        me.update()
        obj = bpy.data.objects.new(name, me)
        bpy.context.scene.collection.objects.link(obj)
        return obj


# --- shapes ------------------------------------------------------------------------------------

def basis(a):
    a = Vector(a).normalized()
    ref = Z if abs(a.z) < 0.9 else X
    s = a.cross(ref).normalized()
    u = s.cross(a).normalized()
    return s, u


def hexa(mb, pts, color, mat='kit', drop=None):
    """Eight points (bottom four, top four) -> a convex six-sided block. drop: a face index to omit."""
    faces = [f for i, f in enumerate(HEXF) if i != drop]
    cols = color
    if isinstance(color, (list, tuple)):
        cols = [c for i, c in enumerate(color) if i != drop]
    mb.add(pts, faces, cols, mat)


def obox(mb, c, axes, size, color, mat='kit'):
    """Box centred on c with the given (not necessarily axis-aligned) axes."""
    c = Vector(c)
    ax, ay, az = [Vector(a).normalized() for a in axes]
    pts = [c + ax * (i * size[0] / 2) + ay * (j * size[1] / 2) + az * (k * size[2] / 2)
           for k in (-1, 1) for (i, j) in ((-1, -1), (1, -1), (1, 1), (-1, 1))]
    mb.add(pts, HEXF, color, mat)


def box(mb, c, size, color, rz=0.0, rx=0.0, ry=0.0, base=True, mat='kit'):
    """Box of full size; c is its base centre (or its centre when base=False)."""
    R = Matrix.Rotation(rz, 3, 'Z') @ Matrix.Rotation(ry, 3, 'Y') @ Matrix.Rotation(rx, 3, 'X')
    c = Vector(c)
    off = Vector((0, 0, size[2] / 2)) if base else Vector()
    obox(mb, c + R @ off, (R @ X, R @ Y, R @ Z), size, color, mat)


def beam(mb, p0, p1, w, h, color, up=None, w1=None, h1=None, mat='kit'):
    """Rectangular beam from p0 to p1: w across (side), h along `up` (projected)."""
    p0, p1 = Vector(p0), Vector(p1)
    a = (p1 - p0).normalized()
    if up is None:
        s, u = basis(a)
    else:
        s = a.cross(Vector(up)).normalized()
        u = s.cross(a).normalized()
    w1 = w if w1 is None else w1
    h1 = h if h1 is None else h1
    pts = []
    for p, ww, hh in ((p0, w, h), (p1, w1, h1)):
        for (i, j) in ((-1, -1), (1, -1), (1, 1), (-1, 1)):
            pts.append(p + s * (i * ww / 2) + u * (j * hh / 2))
    mb.add(pts, HEXF, color, mat)


def cyl(mb, p0, p1, r0, r1, seg, color, caps=True, phase=0.0, mat='kit', squash=1.0):
    """Frustum (or cone when r1 == 0) from p0 to p1."""
    p0, p1 = Vector(p0), Vector(p1)
    s, u = basis(p1 - p0)
    pts, faces = [], []
    for i in range(seg):
        t = phase + 2 * PI * i / seg
        pts.append(p0 + (s * math.cos(t) + u * math.sin(t) * squash) * r0)
    if r1 <= 1e-6:
        pts.append(p1)
        for i in range(seg):
            faces.append((i, (i + 1) % seg, seg))
    else:
        for i in range(seg):
            t = phase + 2 * PI * i / seg
            pts.append(p1 + (s * math.cos(t) + u * math.sin(t) * squash) * r1)
        for i in range(seg):
            j = (i + 1) % seg
            faces.append((i, j, seg + j, seg + i))
        if caps:
            faces.append(tuple(range(seg, 2 * seg)))
    if caps:
        faces.append(tuple(range(seg)))
    mb.add(pts, faces, color, mat)


def tube(mb, centres, radii, seg, color, phase=0.0, cap_end=True, mat='kit'):
    """A bent tube through ring centres (rings perpendicular to the local direction). Returns the ring list.
    color(i_band, j_face, centre, normal) or a plain colour."""
    rings = []
    n = len(centres)
    prev_s = None
    for i in range(n):
        a = (centres[min(i + 1, n - 1)] - centres[max(i - 1, 0)]).normalized()
        if prev_s is None:
            s, u = basis(a)
        else:  # parallel transport keeps the faces from twisting
            u = prev_s.cross(a).normalized()
            s = a.cross(u).normalized()
        prev_s = s
        ring = []
        for j in range(seg):
            t = phase + 2 * PI * j / seg
            ring.append(centres[i] + (s * math.cos(t) + u * math.sin(t)) * radii[i])
        rings.append(ring)
    verts = [v for r in rings for v in r]
    faces, cols = [], []
    for i in range(n - 1):
        for j in range(seg):
            k = (j + 1) % seg
            f = (i * seg + j, i * seg + k, (i + 1) * seg + k, (i + 1) * seg + j)
            faces.append(f)
            if callable(color):
                pts = [verts[q] for q in f]
                fc = sum(pts, Vector()) / 4
                nn = newell(pts).normalized()
                cols.append(color(i, j, fc, nn))
            else:
                cols.append(color)
    if cap_end:
        faces.append(tuple((n - 1) * seg + j for j in range(seg)))
        cols.append(cols[-1] if cols else color)
    # winding: make the first band face point away from its ring centre
    test = [verts[q] for q in faces[0]]
    if newell(test).dot(sum(test, Vector()) / 4 - centres[0]) < 0:
        faces = [tuple(reversed(f)) for f in faces]
    mb.add(verts, faces, cols, mat, orient=False)
    return rings


def add_bm(mb, bm, color, mat='kit'):
    # bmesh primitives (create_uvsphere in particular) do not always emit faces in the same order from
    # run to run; sort faces and vertices by position so the exported GLB is byte-for-byte stable.
    key = lambda co: (round(co.x, 4), round(co.y, 4), round(co.z, 4))
    vs = sorted(bm.verts, key=lambda v: key(v.co))
    idx = {v: i for i, v in enumerate(vs)}
    verts = [v.co.copy() for v in vs]
    fl = list(bm.faces)
    cols = list(color) if isinstance(color, (list, tuple)) else None
    order = sorted(range(len(fl)), key=lambda i: key(fl[i].calc_center_median()) + (len(fl[i].verts),))
    faces = []
    for i in order:
        f = [idx[v] for v in fl[i].verts]
        k = f.index(min(f))
        faces.append(f[k:] + f[:k])
    mb.add(verts, faces, [cols[i] for i in order] if cols else color, mat, orient=False)


def ico(mb, c, r, color, subdiv=1, scale=(1, 1, 1), jit=0.0, seed=0, rz=0.0, floor=None):
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=subdiv, radius=r)
    rng = random.Random(seed)
    R = Matrix.Rotation(rz, 3, 'Z')
    for v in bm.verts:
        co = Vector((v.co.x * scale[0], v.co.y * scale[1], v.co.z * scale[2]))
        co += Vector((rng.uniform(-1, 1), rng.uniform(-1, 1), rng.uniform(-1, 1))) * jit
        co = R @ co + Vector(c)
        if floor is not None and co.z < floor:
            co.z = floor
        v.co = co
    add_bm(mb, bm, color)
    bm.free()


def pebble(mb, c, size, color, seed, rz=0.0):
    """Low-poly rounded pebble (36 triangles)."""
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=6, v_segments=4, radius=0.5)
    rng = random.Random(seed)
    R = Matrix.Rotation(rz, 3, 'Z')
    for v in bm.verts:
        co = Vector((v.co.x * size[0], v.co.y * size[1], v.co.z * size[2]))
        co += Vector((rng.uniform(-1, 1), rng.uniform(-1, 1), rng.uniform(-0.4, 0.4))) * 0.08 * size[0]
        v.co = R @ co + Vector(c)
    add_bm(mb, bm, color)
    bm.free()


def strip(mb, left, right, color, mat='kit', vs=None, us=(0.0, 1.0), orient=False):
    """Quad strip between two polylines (water sheets, blades). vs: V coordinate per row."""
    n = len(left)
    verts = list(left) + list(right)
    faces, uvs = [], []
    for i in range(n - 1):
        faces.append((i, i + 1, n + i + 1, n + i))
        if vs is not None:
            uvs.append([(us[0], vs[i]), (us[0], vs[i + 1]), (us[1], vs[i + 1]), (us[1], vs[i])])
    mb.add(verts, faces, color, mat, uvs=uvs if vs is not None else None, orient=orient)


# --- masonry -----------------------------------------------------------------------------------

def masonry(mb, rng, origin, u, n, length, lo, hi, course=0.48, slen=(0.55, 1.15), depth=0.22,
            protrude=(0.0, 0.06), pal=PIER_STONE, moss=None, gap=0.045, holes=(), zstart=None,
            mosspal=MOSS, wob=0.02):
    """Staggered stone courses on a vertical wall face.

    The face runs along u (unit, horizontal) for `length` from origin, with outward normal n. A stone
    at distance t fills z between lo(t) and hi(t) (both follow curves: arches, humped decks). holes:
    (t0, t1, z0, z1) openings. moss(z) -> chance a stone is mossy."""
    origin, u, n = Vector(origin), Vector(u), Vector(n)

    def P(t, z, d):
        return origin + u * t + Z * z + n * d

    samples = [length * i / 60 for i in range(61)]
    zmin = min(lo(t) for t in samples) if zstart is None else zstart
    zmax = max(hi(t) for t in samples)
    k = 0
    z = zmin
    count = 0
    while z < zmax - 0.04:
        za, zb = z, z + course * rng.uniform(0.85, 1.15)
        ivs = [(0.0, length)]
        for (h0, h1, hz0, hz1) in holes:
            if hz0 < zb - 1e-6 and hz1 > za + 1e-6:
                new = []
                for (a, b) in ivs:
                    if h1 <= a or h0 >= b:
                        new.append((a, b))
                        continue
                    if h0 > a:
                        new.append((a, h0))
                    if h1 < b:
                        new.append((h1, b))
                ivs = new
        for (a, b) in ivs:
            t = a
            first = True
            while t < b - 0.06:
                L = rng.uniform(*slen)
                if first and k % 2:
                    L *= 0.5
                first = False
                t1 = min(b, t + L)
                if b - t1 < 0.3:
                    t1 = b
                # keep the part of [t, t1] whose height is usable
                ga, gb = t + gap / 2, t1 - gap / 2

                def span(tt):
                    bot = max(za + gap / 2, lo(tt) + gap / 2)
                    top = min(zb - gap / 2, hi(tt) - gap / 2)
                    return bot, top
                ok = [tt for tt in (ga + (gb - ga) * q / 6 for q in range(7)) if span(tt)[1] - span(tt)[0] > 0.06]
                if ok:
                    ga2, gb2 = ok[0], ok[-1]
                    if gb2 - ga2 > 0.12:
                        b0, t0_ = span(ga2)
                        b1, t1_ = span(gb2)
                        dout = rng.uniform(*protrude)
                        w = [Vector((rng.uniform(-1, 1), rng.uniform(-1, 1), rng.uniform(-1, 1))) * wob for _ in range(4)]
                        pts = [P(ga2, b0, -depth), P(gb2, b1, -depth), P(gb2, b1, dout) + w[0], P(ga2, b0, dout) + w[1],
                               P(ga2, t0_, -depth), P(gb2, t1_, -depth), P(gb2, t1_, dout) + w[2], P(ga2, t0_, dout) + w[3]]
                        zm = (b0 + t0_ + b1 + t1_) / 4
                        if moss and rng.random() < moss(zm):
                            col = rng.choice(mosspal)
                        else:
                            col = rng.choice(pal)
                        hexa(mb, pts, col, drop=2)   # face 2 is the hidden back
                        count += 1
                t = t1
        z = zb
        k += 1
    return count


# =================================================================================================
# props
# =================================================================================================

# --- water wheel ---------------------------------------------------------------------------------

WHEEL_R = 3.5
WHEEL_HALF = 0.8       # half width along the axle (1.6 m)


def wheel_mb():
    """The spoked overshot wheel in its own frame: axle along X through the origin."""
    mb = MB()
    rng = random.Random(7)
    r_in = 3.06
    xr = 0.70           # rim centre planes
    rw = 0.2            # rim thickness along X
    nseg = 16
    for side in (-1, 1):
        xc = side * xr
        for i in range(nseg):
            a0 = 2 * PI * i / nseg
            a1 = 2 * PI * (i + 1) / nseg
            pts = []
            for xx in (xc - rw / 2, xc + rw / 2):
                for (r, a) in ((r_in, a0), (r_in, a1), (WHEEL_R, a1), (WHEEL_R, a0)):
                    pts.append(V(xx, r * math.cos(a), r * math.sin(a)))
            lit = WOOD_LIT[i % 2] if i % 3 else WOOD_LIT[2]

            def rimcol(c, nn, lit=lit):
                if abs(nn.x) > 0.7:
                    return lit
                radial = V(0, c.y, c.z).normalized()
                return '#9c7448' if nn.dot(radial) > 0 else '#a87c4e'
            mb.add(pts, HEXF, rimcol)
        # spokes (slightly off-centre, like clasp arms)
        for k in range(8):
            a = 2 * PI * k / 8 + PI / 16
            d = V(0, math.cos(a), math.sin(a))
            tdir = V(0, -math.sin(a), math.cos(a))
            p0 = V(xc, 0, 0) + d * 0.45 + tdir * 0.12
            p1 = V(xc, 0, 0) + d * (r_in + 0.08) + tdir * 0.12
            beam(mb, p0, p1, 0.26, 0.18, rng.choice(WOOD_LIT), up=X)
            # iron strap where the spoke meets the rim
            obox(mb, V(xc + side * 0.11, 0, 0) + d * (r_in - 0.1) + tdir * 0.12, (X, d, tdir), (0.03, 0.34, 0.26), IRON_DARK)
        # rim joint plates
        for i in range(nseg):
            a = 2 * PI * (i + 0.5) / nseg
            d = V(0, math.cos(a), math.sin(a))
            tdir = V(0, -math.sin(a), math.cos(a))
            if i % 2 == 0:
                obox(mb, V(xc + side * (rw / 2 + 0.012), 0, 0) + d * (r_in + 0.22), (X, d, tdir), (0.025, 0.3, 0.18), '#3c3a36')
    # buckets: radial boards plus sole boards between the rims
    nb = 20
    inner_w = 2 * (xr - rw / 2)
    for k in range(nb):
        a = 2 * PI * k / nb
        d = V(0, math.cos(a), math.sin(a))
        tdir = V(0, -math.sin(a), math.cos(a))
        r0, r1 = 2.5, WHEEL_R - 0.05
        # the outer lip leans forward a little: two boards
        obox(mb, d * ((r0 + 2.95) / 2), (X, d, tdir), (inner_w, 2.95 - r0, 0.07),
             lambda c, nn: '#8a6a48' if abs(nn.x) > 0.7 else rng.choice(WOOD_DARK))
        lip = (d * math.cos(0.35) + tdir * math.sin(0.35)).normalized()
        lt = lip.cross(X).normalized()
        obox(mb, d * 2.95 + lip * ((r1 - 2.95) / 2), (X, lip, lt), (inner_w, r1 - 2.95 + 0.04, 0.07),
             lambda c, nn: '#9a7650' if abs(nn.x) > 0.7 else '#5c4630')
        am = a + PI / nb
        dm = V(0, math.cos(am), math.sin(am))
        tm = V(0, -math.sin(am), math.cos(am))
        chord = 2 * r0 * math.sin(PI / nb) + 0.02
        obox(mb, dm * (r0 - 0.04), (X, tm, dm), (inner_w, chord, 0.08), rng.choice(['#3a2c1e', '#43331f']))
    # hub and axle
    cyl(mb, V(-0.62, 0, 0), V(0.62, 0, 0), 0.52, 0.52, 8, lambda c, nn: IRON[0] if nn.z > 0.2 else IRON[1], phase=PI / 8)
    for side in (-1, 1):
        cyl(mb, V(side * 0.6, 0, 0), V(side * 0.84, 0, 0), 0.66, 0.6, 8, IRON_DARK, phase=0.0)
        cyl(mb, V(side * 0.84, 0, 0), V(side * 1.05, 0, 0), 0.34, 0.3, 8, IRON[2], phase=PI / 8)
        for k in range(8):
            a = 2 * PI * k / 8 + PI / 8
            box(mb, V(side * 0.86, 0.47 * math.cos(a), 0.47 * math.sin(a)), (0.08, 0.1, 0.1), '#2a2c30', base=False)
    cyl(mb, V(-1.25, 0, 0), V(1.25, 0, 0), 0.16, 0.16, 8, '#3a3e44', phase=PI / 8)
    return mb


def build_mill_wheel():
    return wheel_mb().to_object('river_mill_wheel')


# --- watermill -----------------------------------------------------------------------------------

def quoins(mb, rng, corner, ux, uy, z0, z1, course=0.48, pal=PIER_STONE):
    """Alternating long/short corner stones at a wall corner (ux, uy: the two outward wall directions)."""
    z = z0
    k = 0
    while z < z1 - 0.05:
        h = min(course, z1 - z)
        la, lb = (0.75, 0.45) if k % 2 == 0 else (0.45, 0.75)
        c = Vector(corner)
        p = 0.07
        pts = []
        for zz in (z + 0.02, z + h - 0.02):
            pts += [c + V(0, 0, zz) - ux * la + uy * p, c + V(0, 0, zz) + ux * p + uy * p,
                    c + V(0, 0, zz) + ux * p - uy * lb, c + V(0, 0, zz) - ux * la - uy * lb]
        hexa(mb, pts, rng.choice(pal))
        z += h
        k += 1


def build_mill():
    mb = MB()
    rng = random.Random(11)
    X0, X1, Y0, Y1 = -6.0, 1.4, -3.8, 3.8
    BASE = 2.4
    TOP = 5.6
    RIDGE = 9.3
    SLOPE = 0.88
    # stone base: mortar core, then stone courses on every face
    box(mb, V((X0 + X1) / 2, 0, 0), (X1 - X0 - 0.1, Y1 - Y0 - 0.1, BASE), MORTAR)
    door = (2.55, 3.85, 0.0, 2.0)     # t range along the front face, z range
    moss = lambda z: 0.22 if z < 0.6 else (0.08 if z < 1.2 else 0.03)
    mkw = dict(moss=moss, course=0.6, slen=(0.75, 1.45))
    masonry(mb, rng, V(X0, Y0, 0), X, -Y, X1 - X0, lambda t: 0.0, lambda t: BASE, holes=[door], **mkw)
    masonry(mb, rng, V(X1, Y0, 0), Y, X, Y1 - Y0, lambda t: 0.0, lambda t: BASE, **mkw)
    masonry(mb, rng, V(X1, Y1, 0), -X, Y, X1 - X0, lambda t: 0.0, lambda t: BASE, **mkw)
    masonry(mb, rng, V(X0, Y1, 0), -Y, -X, Y1 - Y0, lambda t: 0.0, lambda t: BASE, **mkw)
    for (cx, cy, ux, uy) in ((X0, Y0, -X, -Y), (X1, Y0, X, -Y), (X1, Y1, X, Y), (X0, Y1, -X, Y)):
        # ux/uy point outward; quoins() wants the along-wall directions pointing into the walls
        quoins(mb, rng, V(cx, cy, 0), -ux, uy, 0.0, BASE, course=0.6)
    # plinth ledge on top of the stone base
    for (c, s) in ((V((X0 + X1) / 2, Y0 - 0.02, BASE - 0.12), (X1 - X0 + 0.3, 0.34, 0.14)),
                   (V((X0 + X1) / 2, Y1 + 0.02, BASE - 0.12), (X1 - X0 + 0.3, 0.34, 0.14)),
                   (V(X0 - 0.02, 0, BASE - 0.12), (0.34, Y1 - Y0 + 0.3, 0.14)),
                   (V(X1 + 0.02, 0, BASE - 0.12), (0.34, Y1 - Y0 + 0.3, 0.14))):
        box(mb, c, s, '#b3ab8e')
    # door: planks, stone jambs and lintel, steps
    dx0, dx1 = X0 + door[0], X0 + door[1]
    for i in range(5):
        w = (dx1 - dx0 - 0.1) / 5
        box(mb, V(dx0 + 0.05 + w * (i + 0.5), Y0 - 0.05, 0.0), (w - 0.02, 0.08, 1.95), rng.choice(['#7a5232', '#6e4a2c', '#835a37']))
    for zz in (0.45, 1.45):
        box(mb, V((dx0 + dx1) / 2, Y0 - 0.11, zz), (dx1 - dx0 - 0.15, 0.05, 0.12), TIMBER[1])
    box(mb, V(dx0 + 0.95, Y0 - 0.14, 0.95), (0.08, 0.06, 0.08), IRON_DARK)
    box(mb, V((dx0 + dx1) / 2, Y0 - 0.1, 2.0), (dx1 - dx0 + 0.5, 0.36, 0.38), '#d0c6a6')
    for xx in (dx0 - 0.1, dx1 + 0.1):
        box(mb, V(xx, Y0 - 0.1, 0.0), (0.22, 0.34, 2.0), '#bdb497')
    box(mb, V((dx0 + dx1) / 2, Y0 - 0.45, 0.0), (dx1 - dx0 + 0.5, 0.6, 0.18), '#a9a386', rz=0.02)
    box(mb, V((dx0 + dx1) / 2 + 0.05, Y0 - 0.95, 0.0), (dx1 - dx0 + 0.2, 0.5, 0.09), '#9f9a80', rz=-0.04)

    # timber-frame upper storey: plaster panels with dark members
    inset = 0.06
    box(mb, V((X0 + X1) / 2, 0, BASE), (X1 - X0 - 2 * inset, Y1 - Y0 - 2 * inset, TOP - BASE), lambda c, nn: pick(PLASTER, c, 3))
    T = 0.22
    pro = 0.06   # timbers stand proud of the plaster

    def faces_walls():
        # (origin, along, outward, length)
        return [(V(X0, Y0, 0), X, -Y, X1 - X0), (V(X1, Y0, 0), Y, X, Y1 - Y0),
                (V(X1, Y1, 0), -X, Y, X1 - X0), (V(X0, Y1, 0), -Y, -X, Y1 - Y0)]
    windows = {0: [(2.15, 3.05), (4.8, 5.7)], 1: [(3.35, 4.25)], 2: [(2.8, 3.7)], 3: [(3.35, 4.25)]}
    for fi, (o, u, n, length) in enumerate(faces_walls()):
        def at(t, z, d=0.0, o=o, u=u, n=n):
            return o + u * t + Z * z + n * (d - inset + pro / 2)
        tcol = lambda: rng.choice(TIMBER)
        # sill and top plate
        beam(mb, at(-0.05, BASE + 0.12), at(length + 0.05, BASE + 0.12), T + 0.04, 0.24, tcol(), up=Z)
        beam(mb, at(-0.05, TOP - 0.11), at(length + 0.05, TOP - 0.11), T + 0.04, 0.22, tcol(), up=Z)
        nbay = 4
        bw = length / nbay
        posts = [bw * i for i in range(nbay + 1)]
        for t in posts:
            tt = min(max(t, 0.11), length - 0.11)
            beam(mb, at(tt, BASE + 0.2), at(tt, TOP - 0.2), T, T, tcol(), up=n)
        wins = windows.get(fi, [])
        for b in range(nbay):
            t0, t1 = posts[b], posts[b + 1]
            has_win = any(w0 >= t0 - 0.01 and w1 <= t1 + 0.01 for (w0, w1) in wins)
            # mid rail
            beam(mb, at(t0, 3.85), at(t1, 3.85), 0.18, 0.18, tcol(), up=n)
            if not has_win and b in (0, nbay - 1):
                # corner braces (the classic diagonal)
                if b == 0:
                    beam(mb, at(t0 + 0.15, BASE + 0.25), at(t1 - 0.1, 3.8), 0.17, 0.17, tcol(), up=n)
                    beam(mb, at(t0 + 0.15, TOP - 0.25), at(t1 - 0.1, 3.95), 0.17, 0.17, tcol(), up=n)
                else:
                    beam(mb, at(t1 - 0.15, BASE + 0.25), at(t0 + 0.1, 3.8), 0.17, 0.17, tcol(), up=n)
                    beam(mb, at(t1 - 0.15, TOP - 0.25), at(t0 + 0.1, 3.95), 0.17, 0.17, tcol(), up=n)
            elif not has_win:
                beam(mb, at(t0 + 0.12, 3.95), at(t1 - 0.12, TOP - 0.25), 0.16, 0.16, tcol(), up=n)
        for (w0, w1) in wins:
            wz0, wz1 = 4.05, 5.1
            wc = (w0 + w1) / 2
            # glass, frame, mullions, sill, shutters
            g = at(wc, wz0, 0.0)
            obox(mb, g + Z * ((wz1 - wz0) / 2), (u, n, Z), (w1 - w0, 0.04, wz1 - wz0), '#3b4a55')
            for zz in (wz0, wz1):
                beam(mb, at(w0 - 0.08, zz, 0.04), at(w1 + 0.08, zz, 0.04), 0.14, 0.14, '#5a3e26', up=n)
            for tt in (w0, w1):
                beam(mb, at(tt, wz0, 0.04), at(tt, wz1, 0.04), 0.12, 0.12, '#5a3e26', up=n)
            beam(mb, at(wc, wz0, 0.05), at(wc, wz1, 0.05), 0.06, 0.06, '#d9cdb0', up=n)
            beam(mb, at(w0, (wz0 + wz1) / 2, 0.05), at(w1, (wz0 + wz1) / 2, 0.05), 0.06, 0.06, '#d9cdb0', up=n)
            beam(mb, at(w0 - 0.12, wz0 - 0.08, 0.12), at(w1 + 0.12, wz0 - 0.08, 0.12), 0.26, 0.08, '#8a6440', up=Z)
            # flower box
            box(mb, at(wc, wz0 - 0.38, 0.22), (w1 - w0, 0.24, 0.24), '#7a5232', rz=math.atan2(u.y, u.x))
            for q in range(3):
                fp = at(w0 + 0.15 + (w1 - w0 - 0.3) * q / 2, wz0 - 0.12, 0.22)
                ico(mb, fp, 0.1, rng.choice(['#d94f5c', '#f0a3b8', '#f2d35b', '#6d9a3e', '#e46a4f']), subdiv=0, seed=q)
            for sgn, tt in ((-1, w0), (1, w1)):
                sw = (w1 - w0) / 2
                sc = at(tt + sgn * (sw / 2 + 0.08), (wz0 + wz1) / 2, 0.1)
                obox(mb, sc, (u, n, Z), (sw, 0.05, wz1 - wz0 + 0.05), rng.choice(['#6f8f86', '#5f8279']))
                for zz in (wz0 + 0.2, wz1 - 0.2):
                    obox(mb, at(tt + sgn * (sw / 2 + 0.08), zz, 0.14), (u, n, Z), (sw - 0.04, 0.03, 0.08), '#4e6c65')
    # gable ends (vertical board cladding) on the -X and +X ends
    half = Y1 + 0.0
    for gx, nx in ((X0, -1), (X1, 1)):
        y = Y0
        bi = 0
        while y < Y1 - 0.01:
            w = min(0.34, Y1 - y)
            za0 = RIDGE - 0.12 - abs(y) * SLOPE
            za1 = RIDGE - 0.12 - abs(y + w) * SLOPE
            xi, xo = gx - nx * 0.1, gx + nx * 0.03
            pts = [V(xi, y, TOP - 0.02), V(xi, y + w, TOP - 0.02), V(xo, y + w, TOP - 0.02), V(xo, y, TOP - 0.02),
                   V(xi, y, za0 - 0.05), V(xi, y + w, za1 - 0.05), V(xo, y + w, za1 - 0.05), V(xo, y, za0 - 0.05)]
            hexa(mb, pts, ['#9a6a40', '#8a5e38', '#a67446'][bi % 3])
            y += w
            bi += 1
        # batten under the gable boards
        beam(mb, V(gx + nx * 0.05, Y0 - 0.1, TOP + 0.05), V(gx + nx * 0.05, Y1 + 0.1, TOP + 0.05), 0.18, 0.2, TIMBER[0], up=Z)
    # loft door with a sack hoist on the -X gable
    box(mb, V(X0 - 0.06, 0, 6.3), (0.08, 1.1, 1.3), '#6e4a2c')
    for zz in (6.3, 7.6):
        box(mb, V(X0 - 0.1, 0, zz - 0.06), (0.1, 1.3, 0.12), TIMBER[2])
    beam(mb, V(X0 + 0.2, 0, 8.4), V(X0 - 1.3, 0, 8.4), 0.24, 0.26, TIMBER[0], up=Z)
    beam(mb, V(X0 - 0.02, 0, 7.75), V(X0 - 0.75, 0, 8.3), 0.14, 0.14, TIMBER[1], up=Y)
    cyl(mb, V(X0 - 1.15, -0.08, 8.12), V(X0 - 1.15, 0.08, 8.12), 0.13, 0.13, 8, '#5a5650')
    beam(mb, V(X0 - 1.27, 0, 8.1), V(X0 - 1.27, 0, 6.4), 0.03, 0.03, ROPE)
    box(mb, V(X0 - 1.27, 0, 6.15), (0.1, 0.1, 0.25), IRON_DARK)

    # roof: overlapping shingle courses on both slopes, ridge cap, barge boards
    over = 0.55
    rx0, rx1 = X0 - over, X1 + over
    eave_y = Y1 + 0.7
    slope = SLOPE
    eave_z = RIDGE - eave_y * slope
    sl = math.hypot(eave_y, eave_y * slope)
    nrows = 12
    for sgn in (-1, 1):
        dn = V(0, sgn * eave_y, -eave_y * slope).normalized()     # down-slope direction
        nrm = V(0, sgn * slope, 1.0).normalized()                  # roof normal
        ridge_pt = V(0, 0, RIDGE)
        for r in range(nrows):
            s0 = sl - (r + 1) * sl / nrows - 0.06
            s1 = sl - r * sl / nrows + 0.05
            nx_seg = 4
            xs = [rx0 + (rx1 - rx0) * q / nx_seg for q in range(nx_seg + 1)]
            for q in range(nx_seg):
                lift = 0.02 * (r % 2) + rng.uniform(0.0, 0.03)
                a0 = ridge_pt + dn * s0
                a1 = ridge_pt + dn * s1
                th = 0.12
                pts = []
                for layer in (0.0, th):
                    o = nrm * (layer + lift + 0.05)
                    pts += [V(xs[q], 0, 0) + a0 + o, V(xs[q + 1], 0, 0) + a0 + o,
                            V(xs[q + 1], 0, 0) + a1 + o + nrm * rng.uniform(-0.03, 0.03),
                            V(xs[q], 0, 0) + a1 + o + nrm * rng.uniform(-0.03, 0.03)]
                hexa(mb, pts, rng.choice(SHINGLE))
        # roof deck under the shingles (hides gaps, visible from below)
        a0 = V(0, 0, RIDGE)
        a1 = a0 + dn * sl
        pts = []
        for layer in (-0.12, 0.05):
            o = nrm * layer
            pts += [V(rx0, 0, 0) + a0 + o, V(rx1, 0, 0) + a0 + o, V(rx1, 0, 0) + a1 + o, V(rx0, 0, 0) + a1 + o]
        hexa(mb, pts, '#5e3a28')
        # barge boards along the gable edges
        for bx in (rx0 + 0.06, rx1 - 0.06):
            beam(mb, V(bx, 0, RIDGE + 0.12) + nrm * 0.02, V(bx, 0, RIDGE + 0.12) + dn * (sl + 0.05) + nrm * 0.02,
                 0.12, 0.3, TIMBER[0], up=nrm)
    # ridge cap (an inverted V of boards)
    for sgn in (-1, 1):
        nrm = V(0, sgn * slope, 1).normalized()
        dn = V(0, sgn, -slope).normalized()
        beam(mb, V(rx0 - 0.05, 0, RIDGE + 0.24) + dn * 0.2, V(rx1 + 0.05, 0, RIDGE + 0.24) + dn * 0.2, 0.42, 0.08, '#6a3a26', up=nrm)
    # crossed gable tips
    for bx in (rx0 + 0.06, rx1 - 0.06):
        for sgn in (-1, 1):
            beam(mb, V(bx, 0, RIDGE + 0.2), V(bx, -sgn * 0.55, RIDGE + 0.75), 0.1, 0.12, TIMBER[0], up=X)
    # stone chimney through the back slope
    cx, cy = -4.6, 1.7
    z = 7.4
    k = 0
    while z < 10.0:
        h = 0.42
        box(mb, V(cx + rng.uniform(-0.03, 0.03), cy, z), (0.9 + 0.06 * (k % 2), 0.9 + 0.06 * ((k + 1) % 2), h - 0.03),
            rng.choice(PIER_STONE), rz=rng.uniform(-0.04, 0.04))
        z += h
        k += 1
    box(mb, V(cx, cy, z), (1.1, 1.1, 0.14), '#8f8a74')
    box(mb, V(cx, cy, z + 0.14), (0.5, 0.5, 0.12), '#3a3530')

    # wheel side: bearing block on the wall, axle, stone pier
    WX = X1 + 0.35 + WHEEL_HALF + 0.05          # wheel centre x
    WZ = 3.3
    box(mb, V(X1 + 0.12, 0, WZ - 0.45), (0.3, 0.8, 0.9), TIMBER[0])
    cyl(mb, V(X1 + 0.1, 0, WZ), V(WX + 1.7, 0, WZ), 0.17, 0.17, 8, '#3a3e44', phase=PI / 8)
    PX = WX + WHEEL_HALF + 0.65
    z = -0.4
    k = 0
    pier_top = WZ - 0.3
    while z < pier_top - 0.05:
        h = min(0.55, pier_top - z)
        if k % 2 == 0:
            parts = [(V(PX - 0.24, 0, z), (0.6, 1.3, h - 0.04)), (V(PX + 0.33, 0, z), (0.5, 1.3, h - 0.04))]
        else:
            parts = [(V(PX, -0.33, z), (1.1, 0.62, h - 0.04)), (V(PX, 0.33, z), (1.1, 0.62, h - 0.04))]
        for (c, s) in parts:
            col = rng.choice(MOSS) if (z < 0.6 and rng.random() < 0.45) or rng.random() < 0.12 else rng.choice(PIER_STONE)
            box(mb, c + V(rng.uniform(-0.04, 0.04), rng.uniform(-0.04, 0.04), 0), s, col, rz=rng.uniform(-0.05, 0.05))
        z += h
        k += 1
    box(mb, V(PX, 0, pier_top), (1.0, 0.7, 0.16), TIMBER[0])
    box(mb, V(PX, 0, pier_top + 0.16), (0.5, 0.45, 0.26), IRON[1])
    # mossy rocks at the pier foot (as in the concept)
    ico(mb, V(PX + 0.3, -1.1, -0.2), 0.75, lambda c, nn: rng.choice(MOSS) if nn.z > 0.55 else rng.choice(PIER_STONE),
        subdiv=1, scale=(1.2, 0.9, 0.75), jit=0.08, seed=5)
    ico(mb, V(PX + 0.8, 0.9, -0.2), 0.5, lambda c, nn: rng.choice(MOSS) if nn.z > 0.6 else rng.choice(PIER_STONE),
        subdiv=1, scale=(1.0, 1.1, 0.8), jit=0.06, seed=6)

    # flume and its timber trestle
    FX = WX
    FZ = WZ + WHEEL_R + 0.2            # flume floor
    fy0, fy1 = -0.55, 5.6
    iw = 0.8
    # floor and side boards
    box(mb, V(FX, (fy0 + fy1) / 2, FZ - 0.1), (iw + 0.2, fy1 - fy0, 0.1), WOOD_MID[0])
    for sgn in (-1, 1):
        for row, zz in enumerate((FZ, FZ + 0.24)):
            box(mb, V(FX + sgn * (iw / 2 + 0.05), (fy0 + fy1) / 2, zz), (0.1, fy1 - fy0, 0.23), WOOD_LIT[row])
    # yokes around the trough, with iron brackets like the concept
    for yy in (fy0 + 0.2, 1.4, 2.9, 4.4, fy1 - 0.2):
        box(mb, V(FX, yy, FZ - 0.26), (iw + 0.5, 0.16, 0.16), WOOD_MID[1])
        for sgn in (-1, 1):
            box(mb, V(FX + sgn * (iw / 2 + 0.17), yy, FZ - 0.26), (0.14, 0.16, 0.8), WOOD_MID[2])
            box(mb, V(FX + sgn * (iw / 2 + 0.25), yy, FZ + 0.2), (0.04, 0.22, 0.26), IRON_DARK)
    # trestle posts behind the wheel
    for yy in (4.1, 5.35):
        for xx in (FX - 0.75, FX + 0.75):
            beam(mb, V(xx, yy, 0.0), V(xx, yy, FZ - 0.34), 0.28, 0.28, rng.choice(FRAME), up=Y)
        beam(mb, V(FX - 1.05, yy, FZ - 0.46), V(FX + 1.05, yy, FZ - 0.46), 0.26, 0.24, rng.choice(FRAME), up=Z)
        for sgn in (-1, 1):   # knee braces
            beam(mb, V(FX + sgn * 0.75, yy, FZ - 1.6), V(FX + sgn * 0.2, yy, FZ - 0.55), 0.18, 0.18, rng.choice(FRAME), up=Y)
    for xx in (FX - 0.75, FX + 0.75):
        beam(mb, V(xx, 4.0, 3.3), V(xx, 5.45, 3.3), 0.2, 0.2, rng.choice(FRAME), up=Z)
        beam(mb, V(xx, 4.15, 0.5), V(xx, 5.3, 3.2), 0.16, 0.16, rng.choice(FRAME), up=X)
        beam(mb, V(xx, 4.15, FZ - 0.6), V(xx, 5.3, 3.45), 0.16, 0.16, rng.choice(FRAME), up=X)
        # stone footings
        for yy in (4.1, 5.35):
            box(mb, V(xx, yy, -0.1), (0.5, 0.5, 0.3), rng.choice(PIER_STONE))
    # cantilever beam from the gable wall with a diagonal brace (the concept's big frame beam)
    for yy in (2.3,):
        beam(mb, V(X1 - 0.1, yy, FZ - 0.46), V(FX + 1.05, yy, FZ - 0.46), 0.26, 0.28, FRAME[1], up=Z)
        beam(mb, V(X1 + 0.05, yy, FZ - 2.4), V(FX - 0.4, yy, FZ - 0.6), 0.2, 0.2, FRAME[0], up=Y)
        box(mb, V(X1 + 0.02, yy, FZ - 0.62), (0.08, 0.34, 0.36), IRON_DARK)
    # water in the trough, spilling onto the top of the wheel
    wz = FZ + 0.3
    ys = [fy1 - (fy1 - fy0) * q / 6 for q in range(7)]
    strip(mb, [V(FX - iw / 2, y, wz) for y in ys], [V(FX + iw / 2, y, wz) for y in ys], '#9ad8d2', mat='water',
          vs=[(fy1 - y) / 2.0 for y in ys])
    spill_l, spill_r, vs = [], [], []
    v0 = (fy1 - fy0) / 2.0
    for q in range(7):
        t = q / 6
        y = fy0 - 0.95 * t
        zz = wz - 1.65 * t * t - 0.05 * t
        w = iw / 2 - 0.06 * t
        spill_l.append(V(FX - w, y, zz))
        spill_r.append(V(FX + w, y, zz))
        vs.append(v0 + t * 0.9)
    strip(mb, spill_l, spill_r, lambda c, nn: '#c9eeea', mat='water', vs=vs)
    # water pouring from the low buckets at the front of the wheel: a few thin streams
    for (ox, w, top, seed) in ((-0.32, 0.16, 1.9, 1), (0.05, 0.22, 1.6, 2), (0.36, 0.12, 2.1, 3)):
        fl, fr, vs = [], [], []
        for q in range(5):
            t = q / 4
            y = -2.7 - 0.3 * t - 0.05 * seed
            zz = top - (top + 0.1) * t
            ww = w * (1 - 0.4 * t)
            fl.append(V(FX + ox - ww / 2, y, zz))
            fr.append(V(FX + ox + ww / 2, y, zz))
            vs.append(t * 1.2)
        strip(mb, fl, fr, '#bfe8e4', mat='water', vs=vs)

    # hand-placed yard clutter by the door: grain sacks, a barrel, a spare millstone, logs
    for i, (sx, sy, rz) in enumerate(((-4.3, -4.35, 0.3), (-4.85, -4.2, -0.2), (-4.55, -4.3, 0.1))):
        zz = 0.0 if i < 2 else 0.5
        ico(mb, V(sx, sy, zz + 0.28), 0.34, lambda c, nn: '#e3d3ae' if nn.z > 0.3 else '#cdbb92', subdiv=1,
            scale=(1.0, 0.75, 0.85), jit=0.03, seed=40 + i, rz=rz)
        box(mb, V(sx, sy, zz + 0.52), (0.14, 0.14, 0.12), '#b09a70', rz=rz)
    cyl(mb, V(-1.0, -4.3, 0.0), V(-1.0, -4.3, 0.95), 0.36, 0.36, 8, lambda c, nn: '#8a5e38' if nn.z < 0.9 else '#7a5232')
    for zz in (0.15, 0.8):
        cyl(mb, V(-1.0, -4.3, zz), V(-1.0, -4.3, zz + 0.07), 0.375, 0.375, 8, IRON_DARK, caps=False)
    ms = V(0.2, -4.05, 0.0)
    cyl(mb, ms + V(0, 0, 0.62), ms + V(0, 0.32, 0.6), 0.62, 0.62, 10, lambda c, nn: '#b9b4a6' if abs(nn.y) > 0.5 else '#a19c8e', phase=0.1)
    cyl(mb, ms + V(0, -0.02, 0.62), ms + V(0, 0.34, 0.6), 0.12, 0.12, 6, '#5a5650')
    for i, (yy, zz) in enumerate(((-4.15, 0.17), (-4.5, 0.17), (-4.32, 0.47))):
        cyl(mb, V(-6.2, yy, zz), V(-5.0, yy + 0.05, zz), 0.17, 0.17, 6, lambda c, nn: '#d8bf8e' if abs(nn.x) > 0.8 else '#7a5634')

    # the wheel: its own object, joined into the prop
    house = mb.to_object('river_mill_house')
    wmb = wheel_mb()
    wmb.transform(Matrix.Translation(V(WX, 0, WZ)))
    wheel = wmb.to_object('river_mill_wheel_part')
    obj = ek.join([house, wheel], 'river_mill')
    obj = centre_footprint(obj)
    global MILL_WHEEL_AXLE
    sh = obj['footprint_shift']
    MILL_WHEEL_AXLE = (WX + sh[0], sh[1], WZ)
    return obj


def centre_footprint(obj):
    """Move the mesh so the centre of its XY footprint is the pivot (z untouched)."""
    me = obj.data
    xs = [v.co.x for v in me.vertices]
    ys = [v.co.y for v in me.vertices]
    c = V((min(xs) + max(xs)) / 2, (min(ys) + max(ys)) / 2, 0)
    me.transform(Matrix.Translation(-c))
    me.update()
    obj['footprint_shift'] = list(-c)
    return obj


# --- stone arch bridge ---------------------------------------------------------------------------

def build_bridge():
    mb = MB()
    rng = random.Random(21)
    L = 11.0           # half length
    HW = 2.25          # half width
    SPAN = 6.0         # half span of the arch at its springing (z = 0)
    RISE = 3.0
    R = (SPAN ** 2 + RISE ** 2) / (2 * RISE)
    ZC = RISE - R
    VD = 0.75          # voussoir (arch ring) depth
    RO = R + VD
    XE = math.sqrt(RO * RO - ZC * ZC)          # where the extrados meets z = 0
    FOOT = -0.6
    PAR = 0.65         # parapet height above the deck
    PT = 0.45          # parapet thickness

    def deck(x):
        return 4.0 - 1.75 * (x / L) ** 2

    def intr(x):
        return ZC + math.sqrt(max(R * R - x * x, 0.0))

    def extr(x):
        return ZC + math.sqrt(max(RO * RO - x * x, 0.0))

    sx = SPAN / R
    ang0 = math.asin(-ZC / R)                  # springing angle above horizontal
    spring_out = V(RO * math.cos(ang0), 0, ZC + RO * math.sin(ang0))

    # mortar core: columns from the ground (or the arch soffit) up to the deck
    xs = sorted(set([-L + 2 * L * i / 44 for i in range(45)] + [-SPAN, SPAN]))
    for x0, x1 in zip(xs, xs[1:]):
        xm = (x0 + x1) / 2
        inside = abs(xm) < SPAN
        b0 = intr(x0) + 0.05 if inside else FOOT
        b1 = intr(x1) + 0.05 if inside else FOOT
        pts = []
        for yy in (-HW + 0.02,):
            pass
        pts = [V(x0, -HW + 0.03, b0), V(x1, -HW + 0.03, b1), V(x1, HW - 0.03, b1), V(x0, HW - 0.03, b0),
               V(x0, -HW + 0.03, deck(x0)), V(x1, -HW + 0.03, deck(x1)), V(x1, HW - 0.03, deck(x1)), V(x0, HW - 0.03, deck(x0))]
        hexa(mb, pts, BRIDGE_MORTAR, drop=0)
        # parapet cores
        for y0, y1 in ((-HW + 0.03, -HW + PT - 0.03), (HW - PT + 0.03, HW - 0.03)):
            pts = [V(x0, y0, deck(x0)), V(x1, y0, deck(x1)), V(x1, y1, deck(x1)), V(x0, y1, deck(x0)),
                   V(x0, y0, deck(x0) + PAR - 0.05), V(x1, y0, deck(x1) + PAR - 0.05),
                   V(x1, y1, deck(x1) + PAR - 0.05), V(x0, y1, deck(x0) + PAR - 0.05)]
            hexa(mb, pts, BRIDGE_MORTAR, drop=0)

    # deck paving: a jittered grid of flags between the parapets
    nx_, ny_ = 30, 5
    yd0, yd1 = -HW + PT, HW - PT
    grid = {}
    for i in range(nx_ + 1):
        for j in range(ny_ + 1):
            x = -L + 2 * L * i / nx_
            y = yd0 + (yd1 - yd0) * j / ny_
            jx = rng.uniform(-0.08, 0.08) if 0 < i < nx_ else 0.0
            grid[i, j] = V(x + jx, y, deck(x + jx) + 0.03 + rng.uniform(-0.02, 0.025))
    for i in range(nx_):
        for j in range(ny_):
            q = [grid[i, j], grid[i + 1, j], grid[i + 1, j + 1], grid[i, j + 1]]
            mb.add(q, [(0, 1, 2, 3)], rng.choice(['#7b807a', '#868a82', '#70766f', '#8e9188', '#7f857c']), orient=False)

    stone_moss = lambda z: 0.03 + (0.07 if z < 0.4 else 0.0) + (0.03 if z > 3.4 else 0.0)

    def lo_face(x):
        if abs(x) < XE - 1e-6:
            return extr(x)
        return FOOT

    def hi_face(x):
        return deck(x) + PAR

    # outer faces (front -Y and back +Y), whole height including the parapet
    for (o, u, n) in ((V(-L, -HW, 0), X, -Y), (V(L, HW, 0), -X, Y)):
        ox, ux = o.x, u.x
        masonry(mb, rng, o, u, n, 2 * L, lambda t, ox=ox, ux=ux: lo_face(ox + ux * t),
                lambda t, ox=ox, ux=ux: hi_face(ox + ux * t), zstart=FOOT, course=0.5, slen=(0.6, 1.3),
                depth=0.24, protrude=(0.0, 0.07), pal=BRIDGE_STONE, moss=stone_moss, mosspal=BRIDGE_MOSS)
        # springer blocks between the arch ring and the abutment
        for sgn in (-1, 1):
            yy = o.y
            yi = yy - n.y * 0.6
            yo = yy + n.y * 0.06
            a, b = V(sgn * SPAN, 0, 0), V(sgn * spring_out.x, 0, spring_out.z)
            pts = [V(sgn * SPAN, yi, FOOT), V(sgn * XE, yi, FOOT), V(sgn * XE, yo, FOOT), V(sgn * SPAN, yo, FOOT),
                   V(a.x, yi, a.z), V(b.x, yi, b.z), V(b.x, yo, b.z), V(a.x, yo, a.z)]
            hexa(mb, pts, rng.choice(BRIDGE_LIGHT))
    # parapet inner faces
    for (o, u, n) in ((V(L, -HW + PT, 0), -X, Y), (V(-L, HW - PT, 0), X, -Y)):
        ox, ux = o.x, u.x
        masonry(mb, rng, o, u, n, 2 * L, lambda t, ox=ox, ux=ux: deck(ox + ux * t) + 0.02,
                lambda t, ox=ox, ux=ux: hi_face(ox + ux * t), course=0.34, slen=(0.6, 1.2), depth=0.2,
                protrude=(0.0, 0.04), pal=BRIDGE_STONE, moss=lambda z: 0.06, mosspal=BRIDGE_MOSS)
    # coping stones on the parapets
    for yc in (-HW + PT / 2, HW - PT / 2):
        x = -L - 0.05
        while x < L:
            ln = rng.uniform(0.7, 1.05)
            x1 = min(L + 0.05, x + ln)
            if L + 0.05 - x1 < 0.35:
                x1 = L + 0.05
            th = rng.uniform(0.15, 0.2)
            w = PT + 0.1 + rng.uniform(0, 0.04)
            z0a, z0b = hi_face(x + 0.02), hi_face(x1 - 0.02)
            pts = [V(x + 0.02, yc - w / 2, z0a - 0.02), V(x1 - 0.02, yc - w / 2, z0b - 0.02),
                   V(x1 - 0.02, yc + w / 2, z0b - 0.02), V(x + 0.02, yc + w / 2, z0a - 0.02),
                   V(x + 0.04, yc - w / 2 + 0.03, z0a + th), V(x1 - 0.04, yc - w / 2 + 0.03, z0b + th),
                   V(x1 - 0.04, yc + w / 2 - 0.03, z0b + th), V(x + 0.04, yc + w / 2 - 0.03, z0a + th)]
            col = rng.choice(BRIDGE_MOSS) if rng.random() < 0.12 else rng.choice(BRIDGE_LIGHT)
            hexa(mb, pts, col)
            x = x1
    # end posts where the parapets meet the banks
    for sx_ in (-1, 1):
        for yc in (-HW + PT / 2, HW - PT / 2):
            x = sx_ * (L - 0.35)
            box(mb, V(x, yc, deck(x) - 0.1), (0.75, PT + 0.2, PAR + 0.45), rng.choice(BRIDGE_STONE))
            box(mb, V(x, yc, deck(x) + PAR + 0.35), (0.85, PT + 0.3, 0.16), rng.choice(BRIDGE_LIGHT))

    # the arch ring: voussoirs through the full width (they also form the soffit)
    nv = 19
    a_lo, a_hi = ang0, PI - ang0
    for k in range(nv):
        t0 = a_lo + (a_hi - a_lo) * k / nv
        t1 = a_lo + (a_hi - a_lo) * (k + 1) / nv
        depth = VD + (0.1 if k % 2 else -0.05) + (0.12 if k == nv // 2 else 0.0)
        cuts = [-HW - 0.1, rng.uniform(-0.9, -0.3), rng.uniform(0.4, 1.0), HW + 0.1]
        for c0, c1 in zip(cuts, cuts[1:]):
            g = 0.025
            pts = []
            for rr in (R, R + depth):
                pts += [V(rr * math.cos(t0 + 0.012), c0 + g, ZC + rr * math.sin(t0 + 0.012)),
                        V(rr * math.cos(t1 - 0.012), c0 + g, ZC + rr * math.sin(t1 - 0.012)),
                        V(rr * math.cos(t1 - 0.012), c1 - g, ZC + rr * math.sin(t1 - 0.012)),
                        V(rr * math.cos(t0 + 0.012), c1 - g, ZC + rr * math.sin(t0 + 0.012))]
            outer = c0 < -HW or c1 > HW
            col = rng.choice(BRIDGE_LIGHT) if outer else rng.choice(['#5c6462', '#646c69', '#565e5c'])
            if outer and rng.random() < 0.1:
                col = rng.choice(BRIDGE_MOSS)
            hexa(mb, pts, col)
    # footing course where the abutments meet the water
    for sx_ in (-1, 1):
        for yy in (-HW, HW):
            x = sx_ * SPAN
            while abs(x) < L - 0.2:
                ln = rng.uniform(0.8, 1.3)
                x1 = x + sx_ * ln
                if abs(x1) > L - 0.2:
                    x1 = sx_ * (L - 0.2)
                box(mb, V((x + x1) / 2, yy + (0.12 if yy > 0 else -0.12), FOOT), (abs(x1 - x) - 0.05, 0.5, 0.75 + rng.uniform(-0.05, 0.08)),
                    rng.choice(BRIDGE_MOSS) if rng.random() < 0.35 else rng.choice(BRIDGE_STONE), rz=rng.uniform(-0.03, 0.03))
                x = x1
    return mb.to_object('river_bridge')


# --- trees ---------------------------------------------------------------------------------------

def limb(mb, pts, r0, r1, seg, color):
    """A tapered branch through a polyline."""
    n = len(pts)
    radii = [r0 + (r1 - r0) * i / (n - 1) for i in range(n)]
    tube(mb, [Vector(p) for p in pts], radii, seg, color)


def leaf_strand(mb, top, length, tri, rng, outward):
    """A hanging willow strand: two crossed ribbons with serrated, leafy edges."""
    dark, base, light = tri
    spacing = 0.44
    n = max(3, int(length / spacing))
    phase = rng.uniform(0, 6.28)
    rot = rng.uniform(0, PI)
    cs = []
    for i in range(n + 1):
        cs.append(Vector(top) + V(0, 0, -i * spacing) + outward * (0.05 * i) +
                  V(math.sin(i * 0.7 + phase), math.cos(i * 0.6 + phase), 0) * 0.06)
    for k, ang in enumerate((rot, rot + PI / 2)):
        d = V(math.cos(ang), math.sin(ang), 0)
        left, right = [], []
        for i, c in enumerate(cs):
            f = i / n
            w = (0.3 if i % 2 else 0.12) * (1 - 0.55 * f) * (0.85 if k else 1.0)
            if i == n:
                w = 0.0
            if i == 0:
                w = 0.05
            left.append(c - d * w + V(0, 0, 0.06 if i % 2 else 0.0))
            right.append(c + d * w + V(0, 0, 0.06 if i % 2 else 0.0))
        cols = []
        verts = left + right
        faces = []
        m = len(left)
        for i in range(m - 1):
            faces.append((i, i + 1, m + i + 1, m + i))
            cols.append(light if (i + k) % 3 == 0 else (dark if (i + k) % 3 == 1 and i > 1 else base))
        mb.add(verts, faces, cols, orient=False)


def build_willow():
    mb = MB()
    rng = random.Random(31)
    bark = lambda i, j, c, n: BARK_WILLOW[(i + j) % 3] if n.z > -0.2 else BARK_WILLOW[1]
    trunk = [V(0, 0, -0.2), V(0.2, 0.08, 1.4), V(0.5, 0.05, 2.9), V(0.4, -0.05, 4.3)]
    limb(mb, trunk, 0.44, 0.27, 7, bark)
    for a in range(5):   # root flare
        ang = a * 2 * PI / 5 + 0.3
        d = V(math.cos(ang), math.sin(ang), 0)
        beam(mb, V(0, 0, 0.7) + d * 0.1, d * 0.95 + V(0, 0, -0.08), 0.32, 0.3, BARK_WILLOW[a % 3], w1=0.1, h1=0.08)
    fork = trunk[-1]
    limbs = [[fork, V(-0.5, 0.25, 6.0), V(-1.3, 0.45, 7.6)],
             [fork, V(1.1, -0.3, 6.1), V(1.7, -0.5, 7.7)],
             [fork, V(0.3, 0.6, 6.4), V(0.1, 1.2, 8.3)],
             [fork, V(0.6, -0.2, 6.6), V(0.5, -0.9, 8.9)],
             [V(0.45, 0.05, 3.3), V(-0.6, -0.3, 4.4), V(-1.5, -0.4, 5.0)]]
    tops = []
    for i, lp in enumerate(limbs):
        limb(mb, lp, 0.2 if i < 4 else 0.1, 0.09 if i < 4 else 0.04, 6 if i < 4 else 5, bark)
        tops.append(lp[-1])
    # faceted crown mass at the top (the big green facets of the concept)
    for (c, r, sc, seed) in ((V(0.3, 0.0, 8.9), 1.45, (1.35, 1.15, 0.8), 1), (V(-1.1, 0.4, 8.2), 1.05, (1.2, 1.0, 0.85), 2),
                             (V(1.4, -0.4, 8.25), 1.05, (1.15, 1.0, 0.85), 3), (V(0.2, 1.0, 8.4), 0.9, (1.0, 1.1, 0.8), 4)):
        ico(mb, c, r * 0.85, shade3(('#6c8a4c', '#8eac62', '#b4cd84')), subdiv=2, scale=sc, jit=0.16, seed=seed)
    # arching branches with hanging strands
    narc = 17
    strands = 0
    for k in range(narc):
        ang = 2 * PI * k / narc + rng.uniform(-0.15, 0.15)
        d = V(math.cos(ang), math.sin(ang), 0)
        start = min(tops[:4], key=lambda t: (V(t.x, t.y, 0).normalized() - d).length if V(t.x, t.y, 0).length > 0.1 else 9)
        start = start + V(0, 0, rng.uniform(0.2, 0.7))
        r_end = rng.uniform(2.6, 4.0)
        z0 = start.z
        pts = []
        for q in range(5):
            t = q / 4
            hp = V(start.x, start.y, 0) * (1 - t) + d * (r_end * t)
            pts.append(V(hp.x, hp.y, z0 + 1.0 * t - 1.9 * t * t))
        limb(mb, pts, 0.06, 0.025, 4, BARK_WILLOW[0])
        for t in (0.3, 0.55, 0.8, 1.0):
            if t == 0.3 and k % 2:
                continue
            q = t * 4
            i0 = min(int(q), 3)
            p = pts[i0].lerp(pts[i0 + 1], q - i0)
            reach = (p.z - rng.uniform(1.6, 3.2)) if t > 0.5 else rng.uniform(2.0, 3.2)
            length = reach if t > 0.5 else min(reach, p.z - 4.0)
            leaf_strand(mb, p, max(1.3, length), WILLOW[rng.randrange(len(WILLOW))], rng, d)
            strands += 1
    return mb.to_object('river_willow')


def birch_tree(mb, base, lean, height, seed, clumps=12):
    rng = random.Random(seed)
    base = Vector(base)
    lean = Vector(lean)
    H = height * 0.86
    seg = 6
    # band list: (s0, s1, kind)
    bands = [(0.0, 0.35, 'base'), (0.35, 0.7, 'base2')]
    sv = 0.7
    while sv < H:
        w = rng.uniform(0.3, 0.55)
        bands.append((sv, min(H, sv + w), 'white'))
        sv += w
        if sv < H - 0.3:
            m = rng.uniform(0.14, 0.24)
            bands.append((sv, sv + m, 'mark'))
            sv += m
    ss = [b[0] for b in bands] + [bands[-1][1]]
    bend = V(-lean.y, lean.x, 0).normalized() if lean.length > 1e-6 else X

    def centre(sv):
        f = sv / H
        return base + V(0, 0, sv) + lean * sv + bend * (0.18 * math.sin(f * PI * 1.3))

    radii = [max(0.06, 0.25 * (1 - 0.7 * (v / H))) for v in ss]
    marks = {}
    for i, b in enumerate(bands):
        if b[2] == 'mark':
            j0 = rng.randrange(seg)
            marks[i] = {j0 % seg, (j0 + 1) % seg} | ({(j0 + 2) % seg} if rng.random() < 0.6 else set())

    def col(i, j, c, n):
        kind = bands[i][2]
        if kind == 'base':
            return BIRCH_BASE[j % 2]
        if kind == 'base2':
            return BIRCH_BASE[1] if j % 2 else '#8a8a82'
        if kind == 'mark' and j in marks[i]:
            return BIRCH_MARK
        return BIRCH_WHITE if (j + i) % 4 else BIRCH_SHADE
    tube(mb, [centre(v) for v in ss], radii, seg, col)
    # branches and airy light-green clumps
    ends = []
    nb = 7
    for b in range(nb):
        sv = H * (0.5 + 0.45 * b / (nb - 1))
        ang = b * 2.4 + rng.uniform(-0.3, 0.3)
        d = V(math.cos(ang), math.sin(ang), 0)
        p0 = centre(sv)
        ln = rng.uniform(1.2, 2.3) * (1.0 - 0.4 * b / nb)
        p1 = p0 + d * ln * 0.55 + V(0, 0, ln * 0.45)
        p2 = p1 + d * ln * 0.45 + V(0, 0, ln * 0.35)
        limb(mb, [p0, p1, p2], 0.06, 0.02, 4, BIRCH_TWIG)
        ends.append(p2)
    ends.append(centre(H) + V(0, 0, 0.3))
    k = 0
    while k < clumps:
        e = ends[k % len(ends)]
        c = e + V(rng.uniform(-0.9, 0.9), rng.uniform(-0.9, 0.9), rng.uniform(-0.7, 0.6)) * (1.0 if k >= len(ends) else 0.3)
        r = rng.uniform(0.5, 0.85)
        ico(mb, c, r, shade3(BIRCH_LEAF[k % 3]), subdiv=2, scale=(1.0, 1.0, 0.78), jit=0.12, seed=seed * 50 + k)
        k += 1


def build_birch():
    mb = MB()
    birch_tree(mb, V(0, 0, -0.1), V(0.02, 0.0, 0), 11.0, 3, clumps=24)
    return mb.to_object('river_birch')


def build_birch_pair():
    mb = MB()
    birch_tree(mb, V(-0.28, 0.05, -0.1), V(-0.075, 0.02, 0), 11.0, 4, clumps=20)
    birch_tree(mb, V(0.26, -0.05, -0.1), V(0.11, -0.03, 0), 9.4, 5, clumps=16)
    return mb.to_object('river_birch_pair')


def build_pine():
    mb = MB()
    rng = random.Random(41)
    tube(mb, [V(0, 0, -0.2), V(0.02, 0, 3.0), V(0, 0, 9.8)], [0.34, 0.24, 0.08], 6, lambda i, j, c, n: PINE_TRUNK[j % 2])
    tiers = 7
    for t in range(tiers):
        f = t / (tiers - 1)
        zb = 1.9 + t * 1.25
        rad = 2.35 * (1 - f) + 0.55
        h = 2.6 - 0.6 * f
        npts = 14
        rim = []
        for i in range(npts):
            a = 2 * PI * i / npts + t * 0.4
            rr = rad * (1.0 if i % 2 == 0 else 0.72) * rng.uniform(0.92, 1.05)
            zz = zb - (0.32 if i % 2 == 0 else 0.0) + rng.uniform(-0.05, 0.05)
            rim.append(V(rr * math.cos(a), rr * math.sin(a), zz))
        apex = V(rng.uniform(-0.05, 0.05), rng.uniform(-0.05, 0.05), zb + h)
        under = V(0, 0, zb + 0.45)
        pts = rim + [apex, under]
        faces = [(i, (i + 1) % npts, npts) for i in range(npts)] + [((i + 1) % npts, i, npts + 1) for i in range(npts)]

        def pc(c, n):
            if n.z < 0:
                return PINE_UNDER
            return PINE[int(h3(c, 7) * len(PINE))]
        mb.add(pts, faces, pc, orient=False)
    cone_ = V(0, 0, 1.9 + tiers * 1.25 + 0.5)
    cyl(mb, cone_ - V(0, 0, 0.9), cone_ + V(0, 0, 1.0), 0.4, 0.0, 6, PINE[1])
    return mb.to_object('river_pine')


# --- waterside plants --------------------------------------------------------------------------

def blade(mb, base, direction, length, width, color, bend=0.35, segs=4):
    """A reed blade: a tapered strip with a V fold, curving out and over."""
    base = Vector(base)
    d = Vector(direction).normalized()
    side = d.cross(Z).normalized() if abs(d.z) < 0.999 else X
    out = V(d.x, d.y, 0).normalized() if V(d.x, d.y, 0).length > 1e-6 else X
    left, mid, right = [], [], []
    for i in range(segs + 1):
        f = i / segs
        p = base + d * (length * f) + out * (bend * length * f * f) - Z * (0.25 * bend * length * f ** 3)
        w = width * (1 - f) + 0.004
        n_ = side.cross(d).normalized()
        left.append(p - side * w)
        right.append(p + side * w)
        mid.append(p + n_ * w * 0.5)
    strip(mb, left, mid, color)
    strip(mb, mid, right, color)


def build_cattails():
    mb = MB()
    rng = random.Random(51)
    # reeds and sedge blades
    for i in range(30):
        a = rng.uniform(0, 2 * PI)
        r = rng.uniform(0.0, 0.6)
        base = V(r * math.cos(a), r * math.sin(a) * 0.7, -0.15)
        tilt = rng.uniform(0.05, 0.35)
        d = V(math.cos(a) * tilt, math.sin(a) * tilt, 1.0)
        ln = rng.uniform(0.8, 1.6)
        blade(mb, base, d, ln, rng.uniform(0.035, 0.06), rng.choice(REED), bend=rng.uniform(0.1, 0.45))
    # cattails: stem, brown head, pale spike
    for i in range(8):
        a = rng.uniform(0, 2 * PI)
        r = rng.uniform(0.05, 0.5)
        base = V(r * math.cos(a), r * math.sin(a) * 0.7, -0.15)
        h = rng.uniform(1.35, 1.8)
        lean = V(math.cos(a), math.sin(a), 0) * rng.uniform(0.03, 0.12)
        top = base + V(0, 0, h) + lean * h
        hl = rng.uniform(0.28, 0.36)
        stem_top = top - (top - base).normalized() * (hl + 0.04)
        cyl(mb, base, stem_top, 0.022, 0.016, 4, rng.choice(CATTAIL_STEM), caps=False)
        dirv = (top - base).normalized()
        h0 = stem_top
        h1 = h0 + dirv * 0.04
        h2 = h1 + dirv * (hl - 0.08)
        h3_ = h2 + dirv * 0.04
        headc = rng.choice(CATTAIL_HEAD)
        tube(mb, [h0, h1, h2, h3_], [0.03, 0.062, 0.062, 0.035], 6, lambda i_, j, c, n, hc=headc: hc if j % 3 else '#a3642c')
        cyl(mb, h3_, h3_ + dirv * 0.16, 0.012, 0.0, 3, CATTAIL_SPIKE)
    return mb.to_object('river_cattails')


def lily_pad(mb, c, r, tri, rng, notch_dir):
    dark, base, light = tri
    n = 11
    gap = 0.32
    ring = []
    for i in range(n):
        a = notch_dir + gap / 2 + (2 * PI - gap) * i / (n - 1)
        rr = r * rng.uniform(0.94, 1.04)
        ring.append(c + V(rr * math.cos(a), rr * math.sin(a), 0.03))
    centre = c + V(0, 0, 0.045)
    bottom = [p - V(0, 0, 0.03) for p in ring]
    verts = [centre] + ring + bottom + [c + V(0, 0, 0.0)]
    faces, cols = [], []
    for i in range(n - 1):
        faces.append((0, 1 + i, 2 + i))
        cols.append(light if i % 2 else base)
    for i in range(n - 1):     # rim
        faces.append((1 + i, 1 + n + i, 2 + n + i, 2 + i))
        cols.append(dark)
    faces.append((0, 1 + n - 1, 1 + n + n - 1, 2 * n + 1))   # notch walls
    faces.append((0, 2 * n + 1, 1 + n, 1))
    cols += [dark, dark]
    mb.add(verts, faces, cols, orient=False)


def water_lily(mb, c, rng, pink=False):
    tip = LILY_PINK if pink else LILY_WHITE
    for ring_i, (cnt, ln, lift, w) in enumerate(((8, 0.3, 0.12, 0.09), (6, 0.22, 0.2, 0.075))):
        for k in range(cnt):
            a = 2 * PI * k / cnt + ring_i * 0.35
            d = V(math.cos(a), math.sin(a), 0)
            s_ = V(-d.y, d.x, 0)
            b = c + V(0, 0, 0.05)
            t = c + d * ln + V(0, 0, lift)
            m = c + d * (ln * 0.5) + V(0, 0, lift * 0.45)
            pts = [b, m + s_ * w, t, m - s_ * w, m + V(0, 0, -0.03)]
            col = tip if ring_i == 0 else (LILY_WHITE if pink else '#fbf8f2')
            mb.add(pts, [(0, 1, 2, 3), (0, 4, 1), (4, 2, 1), (0, 3, 4), (3, 2, 4)],
                   [col, '#e8dcd8' if pink else '#e6e2d8', '#e8dcd8' if pink else '#e6e2d8', col, col], orient=False)
    cyl(mb, c + V(0, 0, 0.04), c + V(0, 0, 0.14), 0.06, 0.045, 6, LILY_GOLD)


def build_lilypads():
    mb = MB()
    rng = random.Random(61)
    pads = [(-1.0, 0.3, 0.5), (-0.25, -0.45, 0.42), (0.55, 0.35, 0.55), (1.2, -0.35, 0.38), (0.3, -0.05, 0.3),
            (-1.25, -0.55, 0.32), (-0.55, 0.65, 0.28), (1.0, 0.75, 0.3), (0.05, 0.75, 0.22), (1.35, 0.25, 0.22)]
    for i, (x, y, r) in enumerate(pads):
        lily_pad(mb, V(x, y, 0), r, LILY[i % 3], rng, rng.uniform(0, 2 * PI))
    water_lily(mb, V(0.55, 0.32, 0.02), rng, pink=False)
    water_lily(mb, V(-1.0, 0.28, 0.02), rng, pink=True)
    # a closed pink bud
    cyl(mb, V(1.2, -0.3, 0.03), V(1.2, -0.3, 0.2), 0.07, 0.0, 5, LILY_PINK)
    return mb.to_object('river_lilypads')


# --- banks and rocks -----------------------------------------------------------------------------

def build_shoal():
    mb = MB()
    rng = random.Random(71)
    nx_, ny_ = 16, 8
    LX, LY = 4.0, 2.0

    def shape(x, y):
        a = math.atan2(y / LY, x / LX)
        edge = 1.0 + 0.1 * math.sin(3 * a + 0.7) + 0.06 * math.sin(7 * a + 1.3)
        d = math.hypot(x / LX, y / LY) / edge
        return d

    def height(x, y):
        d = shape(x, y)
        h = 0.42 * max(0.0, 1 - d * d) ** 0.6 - 0.12
        h += 0.06 * (y / LY)          # higher toward the bank side (+Y)
        return min(0.4, h)
    grid = {}
    for i in range(nx_ + 1):
        for j in range(ny_ + 1):
            x = -LX * 1.05 + 2.1 * LX * i / nx_
            y = -LY * 1.08 + 2.16 * LY * j / ny_
            if 0 < i < nx_ and 0 < j < ny_:
                x += rng.uniform(-0.12, 0.12)
                y += rng.uniform(-0.1, 0.1)
            grid[i, j] = V(x, y, max(-0.15, height(x, y)) + rng.uniform(-0.015, 0.015))

    def sandcol(c, n):
        if c.z < -0.02:
            return rng.choice(SAND_WET)
        if c.z < 0.06:
            return rng.choice(SAND_DAMP)
        return rng.choice(SAND)
    for i in range(nx_):
        for j in range(ny_):
            a, b, c_, d = grid[i, j], grid[i + 1, j], grid[i + 1, j + 1], grid[i, j + 1]
            tris = [(a, b, c_), (a, c_, d)] if (i + j) % 2 else [(a, b, d), (b, c_, d)]
            for t in tris:
                mb.add(list(t), [(0, 1, 2)], sandcol, orient='up')
    # pebbles: dense on the bank half, thinning toward the water
    placed = []
    tries = 0
    while len(placed) < 64 and tries < 4000:
        tries += 1
        x = rng.uniform(-3.4, 3.2)
        y = rng.uniform(-0.6, 1.7)
        if shape(x, y) > 0.84 or rng.random() > 0.3 + 0.6 * (y + 0.6) / 2.3:
            continue
        sz = rng.uniform(0.28, 0.6)
        if any((V(x, y, 0) - p).length < (sz + q) * 0.48 for p, q in placed):
            continue
        placed.append((V(x, y, 0), sz))
        h = max(0.0, height(x, y))
        pebble(mb, V(x, y, h + sz * 0.14), (sz, sz * rng.uniform(0.7, 0.95), sz * rng.uniform(0.45, 0.6)),
               rng.choice(PEBBLE), seed=len(placed), rz=rng.uniform(0, PI))
    # a bleached driftwood branch
    limb(mb, [V(1.6, -0.9, 0.12), V(2.4, -0.75, 0.14), V(3.1, -0.95, 0.08)], 0.09, 0.04, 5, '#b9ae98')
    beam(mb, V(2.4, -0.78, 0.14), V(2.7, -0.4, 0.2), 0.05, 0.05, '#a89d86')
    return mb.to_object('river_shoal')


def mossy_rock(mb, c, radii, seed, subdiv=2, moss_amt=0.2, jit=0.08):
    rng = random.Random(seed)
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=subdiv, radius=1.0)
    rx, ry, rz = radii
    for v in bm.verts:
        co = Vector((v.co.x * rx, v.co.y * ry, v.co.z * rz))
        co += Vector((rng.uniform(-1, 1), rng.uniform(-1, 1), rng.uniform(-1, 1))) * jit * max(radii)
        if co.z < -0.35 * rz:
            co.z = -0.35 * rz
        v.co = co + Vector(c)
    bm.normal_update()
    ph = rng.uniform(0, 6.28)

    def blotch(p):   # smooth, patchy field so the moss grows in clumps, not confetti
        q = (p - Vector(c)) * (3.6 / max(radii))
        return (math.sin(q.x * 2.1 + ph) + math.sin(q.y * 2.4 - ph * 0.7) + math.sin((q.x + q.y) * 1.7 + ph * 1.3)) / 3
    top = [f for f in bm.faces if f.normal.z > 0.35 and
           blotch(f.calc_center_median()) + 0.9 * (f.normal.z - 0.35) > 0.55 - moss_amt]
    moss_tops = set(top)
    res = bmesh.ops.inset_region(bm, faces=top, thickness=0.03, depth=0.07, use_even_offset=True)
    moss_sides = set(res['faces'])
    bm.normal_update()
    cols = []
    for f in bm.faces:
        cc = f.calc_center_median()
        if f in moss_tops:
            cols.append(pick(ROCK_MOSS, cc, seed))
        elif f in moss_sides:
            cols.append('#62792a')
        elif cc.z < Vector(c).z + 0.15 or f.normal.z < -0.3:
            cols.append(pick(ROCK_DARK, cc, seed))
        elif f.normal.z < 0.25 and (f.normal.x + f.normal.y) < 0:
            cols.append(pick(ROCK_DARK + ROCK[:2], cc, seed + 1))
        else:
            cols.append(pick(ROCK, cc, seed))
    add_bm(mb, bm, cols)
    bm.free()


def build_boulder():
    mb = MB()
    mossy_rock(mb, V(0, 0, 0), (1.25, 1.08, 0.95), seed=81, subdiv=3, jit=0.05)
    return mb.to_object('river_boulder')


def build_boulder_large():
    mb = MB()
    mossy_rock(mb, V(0, 0, 0), (2.0, 1.75, 1.45), seed=82, subdiv=3, jit=0.05)
    mossy_rock(mb, V(1.75, -0.9, 0), (0.7, 0.6, 0.45), seed=83, subdiv=2, moss_amt=0.1)
    return mb.to_object('river_boulder_large')


def build_foam_ring():
    mb = MB()
    rng = random.Random(91)
    n = 44
    zf = 0.015
    inner, outer, a_s = [], [], []
    for i in range(n + 1):
        a = 2 * PI * i / n
        ii = i % n
        rin = 1.12 + 0.06 * math.sin(3 * a + 1) + 0.04 * math.sin(7 * a)
        lump = 0.2 * abs(math.sin(5 * a + 0.4)) + 0.12 * abs(math.sin(11 * a + 2.0)) + (0.16 if ii % 3 == 0 else 0.0)
        rout = 1.42 + lump + 0.12 * math.cos(a)        # trails a little toward +X (downstream)
        inner.append(V(rin * math.cos(a), rin * math.sin(a), zf))
        outer.append(V(rout * math.cos(a), rout * math.sin(a), zf + 0.005))
        a_s.append(i / n * 4.0)
    faces, uvs, verts = [], [], inner + outer
    m = n + 1
    for i in range(n):
        faces.append((i, i + 1, m + i + 1, m + i))
        uvs.append([(a_s[i], 0.0), (a_s[i + 1], 0.0), (a_s[i + 1], 1.0), (a_s[i], 1.0)])
    mb.add(verts, faces, lambda c, nn: pick(FOAM, c, 3), mat='water', uvs=uvs, orient='up')
    # concentric streaks (the broken white arcs around the concept's rocks)
    for k in range(9):
        r = rng.uniform(1.85, 2.0) if k < 5 else rng.uniform(1.6, 1.75)
        a0 = rng.uniform(0, 2 * PI)
        span = rng.uniform(0.5, 1.1)
        seg = 6
        left, right, vs = [], [], []
        for q in range(seg + 1):
            f = q / seg
            a = a0 + span * f
            w = 0.075 * math.sin(PI * f) + 0.008
            rr = r + 0.1 * math.cos(a)
            left.append(V((rr - w) * math.cos(a), (rr - w) * math.sin(a), zf))
            right.append(V((rr + w) * math.cos(a), (rr + w) * math.sin(a), zf))
            vs.append(f * span * 2)
        strip(mb, left, right, FOAM[1], mat='water', vs=vs, orient='up')
    return mb.to_object('river_foam_ring')


# --- dock and boat -------------------------------------------------------------------------------

def build_dock():
    mb = MB()
    rng = random.Random(101)
    DZ = 0.8
    LX, HY = 3.0, 1.25
    postcol = lambda c, nn: DOCK_WET if c.z < 0.1 else (rng.choice(DOCK_POST) if nn.z < 0.9 else '#8a6844')
    # posts: corners rise above the deck, middles stop under it
    for x in (-2.85, 0.0, 2.85):
        for y in (-HY - 0.05, HY + 0.05):
            top = DZ + (0.5 if abs(x) > 1 else -0.02)
            beam(mb, V(x, y, -1.2), V(x, y, top), 0.24, 0.24, postcol, up=Y)
            box(mb, V(x, y, top), (0.26, 0.26, 0.05), '#6e5232') if abs(x) > 1 else None
        # cross brace under the deck
        beam(mb, V(x, -HY, 0.15), V(x, HY, DZ - 0.2), 0.12, 0.08, rng.choice(DOCK_POST), up=X)
    # stringers
    for y in (-HY + 0.02, HY - 0.02):
        beam(mb, V(-LX, y, DZ - 0.2), V(LX, y, DZ - 0.2), 0.14, 0.24, rng.choice(DOCK_POST), up=Z)
    # deck planks across, with staggered ends and small gaps
    w = 0.29
    x = -LX
    i = 0
    while x < LX - 0.05:
        off = rng.uniform(-0.09, 0.09)
        ln = 2 * HY + 0.25 + rng.uniform(-0.12, 0.1)
        box(mb, V(x + w / 2, off, DZ - 0.07 + rng.uniform(-0.01, 0.012)), (w - 0.035, ln, 0.08), rng.choice(DOCK_PLANK),
            rz=rng.uniform(-0.02, 0.02))
        x += w
        i += 1
    # ladder down into the water at the outer end
    for y in (-0.32, 0.32):
        beam(mb, V(LX + 0.12, y, -0.9), V(LX + 0.12, y, DZ + 0.55), 0.08, 0.1, '#8a6642', up=X)
    for zz in (-0.4, 0.0, 0.4):
        beam(mb, V(LX + 0.12, -0.32, zz), V(LX + 0.12, 0.32, zz), 0.07, 0.07, '#9a7650', up=Z)
    # mooring rope coil and a loop on the corner post, a bucket, a little crate
    coil = V(2.35, 0.75, DZ + 0.01)
    rr = []
    for k in range(9):
        a = 2 * PI * k / 8
        rr.append(coil + V(0.24 * math.cos(a), 0.24 * math.sin(a), 0.05))
    tube(mb, rr, [0.045] * 9, 4, ROPE, cap_end=False)
    tube(mb, [coil + V(0.17 * math.cos(2 * PI * k / 8), 0.17 * math.sin(2 * PI * k / 8), 0.1) for k in range(9)], [0.04] * 9, 4, '#bba374', cap_end=False)
    tube(mb, [V(2.85, HY + 0.05, DZ + 0.3) + V(0.17 * math.cos(2 * PI * k / 8), 0.17 * math.sin(2 * PI * k / 8), 0.0) for k in range(9)],
         [0.035] * 9, 4, ROPE, cap_end=False)
    limb(mb, [V(2.85, HY + 0.2, DZ + 0.3), V(2.9, HY + 0.55, DZ - 0.2), V(2.95, HY + 0.9, 0.05)], 0.03, 0.03, 4, ROPE)
    cyl(mb, V(-1.9, -0.6, DZ + 0.01), V(-1.9, -0.6, DZ + 0.36), 0.17, 0.2, 7, lambda c, nn: '#8a6440' if nn.z < 0.9 else '#3a5a66')
    cyl(mb, V(-1.9, -0.6, DZ + 0.28), V(-1.9, -0.6, DZ + 0.32), 0.205, 0.205, 7, IRON_DARK, caps=False)
    box(mb, V(-2.5, 0.65, DZ + 0.01), (0.5, 0.4, 0.34), lambda c, nn: '#a8804f' if nn.z > 0.5 else '#9a7246', rz=0.25)
    # fishing rod leaning on the crate, its line down to the water
    beam(mb, V(-2.3, 0.5, DZ + 0.05), V(-0.6, -HY - 0.9, DZ + 1.3), 0.03, 0.03, '#6e5232', w1=0.015, h1=0.015)
    beam(mb, V(-0.6, -HY - 0.9, DZ + 1.3), V(-0.62, -HY - 0.95, 0.0), 0.008, 0.008, '#e8e4da')
    return mb.to_object('river_dock')


def build_boat():
    mb = MB()
    rng = random.Random(111)
    HL = 1.75
    ns = 12
    prof = [1.0, 0.9, 0.8, 0.68, 0.45, 0.2, 0.0]        # height fraction of each hull line
    shp = [1.0, 0.995, 0.975, 0.93, 0.8, 0.55, 0.0]     # half-beam fraction at each line

    def beamw(s):
        if s > 0.42:
            return 0.72 * (1 - ((s - 0.42) / 0.58) ** 1.8) + 0.015
        return 0.72 - 0.24 * ((0.42 - s) / 0.42) ** 2

    def keel(s):
        return -0.2 + 0.32 * max(0, s - 0.6) ** 2 / 0.16 + 0.12 * max(0, 0.25 - s) / 0.25

    def sheer(s):
        return 0.42 + 0.3 * max(0, s - 0.55) ** 2 / 0.2 + 0.1 * max(0, 0.3 - s) / 0.3
    stations = []
    for i in range(ns + 1):
        s = i / ns
        x = -HL + 2 * HL * s
        b, k, sh = beamw(s), keel(s), sheer(s)
        stations.append([(x, b * shp[q], k + (sh - k) * prof[q]) for q in range(len(prof))])
    band = ['white', 'red', 'white', 'wood', 'wood2', 'bottom']
    bandcol = {'white': BOAT_WHITE, 'red': BOAT_RED, 'wood': BOAT_WOOD[0], 'wood2': BOAT_WOOD[1], 'bottom': BOAT_BOTTOM[0]}
    nl = len(prof)
    for sgn in (-1, 1):
        for shell, inset in (('out', 0.0), ('in', 0.05)):
            verts, faces, cols = [], [], []
            for i, st in enumerate(stations):
                for q, (x, y, z) in enumerate(st):
                    yy = max(0.0, y - inset) if y > 0 else 0.0
                    zz = z + (inset if q == nl - 1 else inset * 0.4 * (1 - prof[q]))
                    verts.append(V(x, sgn * yy, zz))
            for i in range(ns):
                for q in range(nl - 1):
                    a, b = i * nl + q, (i + 1) * nl + q
                    f = (a, b, b + 1, a + 1) if sgn > 0 else (a, a + 1, b + 1, b)
                    if shell == 'in':
                        f = f[::-1]
                    faces.append(f)
                    if shell == 'out':
                        cols.append(bandcol[band[q]] if band[q] != 'wood' else BOAT_WOOD[i % 3])
                    else:
                        cols.append(BOAT_INNER[(i + q) % 3])
            mb.add(verts, faces, cols, orient=False)
        # gunwale cap joining outer and inner shell
        top = []
        for i, st in enumerate(stations):
            x, y, z = st[0]
            top.append((V(x, sgn * y, z), V(x, sgn * max(0.0, y - 0.05), z + 0.05)))
        for i in range(ns):
            a0, a1 = top[i]
            b0, b1 = top[i + 1]
            mb.add([a0 + V(0, 0, 0.0), b0, b1, a1], [(0, 1, 2, 3)], BOAT_WHITE, orient=False)
    # transom at the stern
    st = stations[0]
    poly = [V(st[q][0], st[q][1], st[q][2]) for q in range(nl)] + [V(st[q][0], -st[q][1], st[q][2]) for q in reversed(range(nl - 1))]
    mb.add(poly, [tuple(range(len(poly)))], BOAT_WOOD[2], orient=False)
    obox(mb, V(-HL - 0.01, 0, sheer(0) - 0.1), (X, Y, Z), (0.02, 2 * beamw(0) - 0.05, 0.1), BOAT_RED)
    # thwarts (seats), a stern seat, a bow deck, oarlocks
    for (s, w) in ((0.33, 0.24), (0.6, 0.22)):
        x = -HL + 2 * HL * s
        bw = beamw(s) - 0.08
        box(mb, V(x, 0, 0.22), (w, 2 * bw, 0.05), BOAT_WOOD[2])
    box(mb, V(-HL + 0.32, 0, 0.27), (0.5, 2 * beamw(0.05) - 0.12, 0.05), BOAT_INNER[0])
    box(mb, V(-0.1, 0, -0.12), (2.6, 0.24, 0.03), BOAT_INNER[1])
    for sgn in (-1, 1):
        s = 0.47
        x = -HL + 2 * HL * s
        box(mb, V(x, sgn * (beamw(s) - 0.01), sheer(s) + 0.04), (0.06, 0.06, 0.09), IRON_DARK)
        box(mb, V(x, sgn * (beamw(s) - 0.01), sheer(s) + 0.13), (0.05, 0.12, 0.03), IRON_DARK)
    # oars: one stowed along the boat, one resting out over the side
    def oar(p_hand, p_blade, w=0.17):
        p_hand, p_blade = Vector(p_hand), Vector(p_blade)
        d = (p_blade - p_hand).normalized()
        cyl(mb, p_hand, p_blade - d * 0.55, 0.033, 0.03, 6, OAR[0])
        cyl(mb, p_hand, p_hand + d * 0.18, 0.04, 0.04, 6, '#a07c4c')
        side = d.cross(Z).normalized()
        b0 = p_blade - d * 0.6
        pts = [b0 + side * 0.03, b0 - side * 0.03, p_blade - side * w / 2, p_blade + side * w / 2]
        verts = [p + Z * 0.015 for p in pts] + [p - Z * 0.015 for p in pts]
        mb.add(verts, [(0, 1, 2, 3), (4, 7, 6, 5), (0, 4, 5, 1), (1, 5, 6, 2), (2, 6, 7, 3), (3, 7, 4, 0)], OAR[1])
    oar(V(-1.1, 0.25, 0.3), V(1.25, 0.33, 0.3))
    s = 0.47
    xl = -HL + 2 * HL * s
    oar(V(xl - 0.5, -0.1, 0.35), V(xl + 0.3, -beamw(s) - 1.7, -0.02))
    # bow ring and a coil of line
    cyl(mb, V(HL - 0.02, 0, 0.6), V(HL + 0.06, 0, 0.6), 0.05, 0.05, 6, IRON_DARK)
    tube(mb, [V(1.05 + 0.15 * math.cos(2 * PI * k / 8), 0.15 * math.sin(2 * PI * k / 8), 0.02) for k in range(9)], [0.03] * 9, 4, ROPE, cap_end=False)
    return mb.to_object('river_boat')


# =================================================================================================

BUILDERS = {
    'river_mill': build_mill,
    'river_mill_wheel': build_mill_wheel,
    'river_bridge': build_bridge,
    'river_willow': build_willow,
    'river_birch': build_birch,
    'river_birch_pair': build_birch_pair,
    'river_cattails': build_cattails,
    'river_lilypads': build_lilypads,
    'river_shoal': build_shoal,
    'river_boulder': build_boulder,
    'river_boulder_large': build_boulder_large,
    'river_foam_ring': build_foam_ring,
    'river_dock': build_dock,
    'river_boat': build_boat,
    'river_pine': build_pine,
}
CAPS = {'river_mill': 10000, 'river_bridge': 10000}


MILL_WHEEL_AXLE = None     # set by build_mill: the wheel's axle centre in river_mill's frame (Blender axes)


def _game(v):
    """Blender (x, y, z) -> glTF/game (x, y up, z)."""
    return [round(v[0], 3), round(v[2], 3), round(-v[1], 3)]


def meta_for(name, obj):
    lo = Vector((min(v.co[i] for v in obj.data.vertices) for i in range(3)))
    hi = Vector((max(v.co[i] for v in obj.data.vertices) for i in range(3)))
    zlo = lo.z if name == 'river_mill_wheel' else max(lo.z, 0.0)
    size = [round(hi.x - lo.x, 2), round(hi.z - zlo, 2), round(hi.y - lo.y, 2)]
    foot = round(0.5 * math.hypot(hi.x - lo.x, hi.y - lo.y) * 0.8, 2)
    none = {'kind': 'none'}
    m = {
        'river_mill': dict(landmark=True, collider={'kind': 'box', 'half': [round(size[0] / 2 - 0.4, 2), 3.0, round(size[2] / 2 - 0.6, 2)]},
                           notes='Watermill landmark. Mill house on the bank; the wheel side (+X) overhangs the river or a mill race: '
                                 'the wheel dips about 0.2 m below z = 0, the stone pier stands in the water. Flume and trestle at the back (-Z in game). '
                                 'The wheel is joined into this mesh (static); river_mill_wheel is the same wheel alone for a spinning version, '
                                 f'axle centre at {_game(MILL_WHEEL_AXLE) if MILL_WHEEL_AXLE else "?"} in this prop\'s frame. '
                                 'Box collider covers the house, wheel and trestle.'),
        'river_mill_wheel': dict(landmark=False, collider=none,
                                 notes='The mill wheel alone (7 m diameter, 1.6 m wide). Pivot is the AXLE centre, not the ground: '
                                       'spin it about its local X axis (same axis in Blender and glTF). Fed at the front-top (overshot): spin it by a positive '
                                       'angle about +X so the top moves toward the front (+Z in game). No collider of its own (the mill\'s box covers it).'),
        'river_bridge': dict(landmark=True, collider=none,
                             notes='Stone arch bridge, 22 m along X, 4.5 m wide. The arch spans 12 m of water at z = 0 (springing), soffit crown '
                                   'at 3.0 m. Walkable: another mechanism must carry the walk surface: deck top y = 4.03 - 1.75 * (x / 11)^2 '
                                   '(4.0 m at the crown, 2.28 m at the ends), between parapets at |z| <= 1.8; parapets 0.45 thick, 0.65 high '
                                   '(+0.18 coping). Ends (x = +-11) butt into the banks; the end faces are plain mortar and should be buried.'),
        'river_willow': dict(landmark=False, collider={'kind': 'cylinder', 'radius': 0.45, 'height': 4.0},
                             notes='Weeping willow for river banks; the leaf curtain hangs to ~1.5 m above ground. Collider is the trunk only.'),
        'river_birch': dict(landmark=False, collider={'kind': 'cylinder', 'radius': 0.25, 'height': 4.0},
                            notes='White birch with black marks. Bank and meadow scatter. Collider is the trunk only.'),
        'river_birch_pair': dict(landmark=False, collider={'kind': 'cylinder', 'radius': 0.55, 'height': 4.0},
                                 notes='Two birches from one root, leaning apart. Collider covers both trunks near the base.'),
        'river_pine': dict(landmark=False, collider={'kind': 'cylinder', 'radius': 0.4, 'height': 4.0},
                           notes='Conifer in the concept\'s distant style (cheap: ~230 triangles); for hillsides and the valley rim.'),
        'river_cattails': dict(landmark=False, collider=none,
                               notes='Cattails and reeds. Plant at the water\'s edge or in shallows; the base starts at z = -0.15 so it can sit slightly submerged.'),
        'river_lilypads': dict(landmark=False, collider=none,
                               notes='Lily pad cluster with one white and one pink flower. Sits ON the water surface: put z = 0 at the water level. Calm water only.'),
        'river_shoal': dict(landmark=False, collider=none,
                            notes='Sandbar with a pebble bank. Put z = 0 at the water level: the sandy rim dips to -0.15 under the water, the top '
                                  'is at most 0.4 m. Pebbles cluster on the +Y side (game -Z): face that side toward the bank. Visual only; '
                                  'the riverbed or terrain carries the walk surface.'),
        'river_boulder': dict(landmark=False, collider={'kind': 'cylinder', 'radius': 1.05, 'height': 1.0},
                              notes='Mossy river boulder. Put z = 0 at the water level (it extends ~0.33 m below). Pair with river_foam_ring at the same spot.'),
        'river_boulder_large': dict(landmark=False, collider={'kind': 'cylinder', 'radius': 1.75, 'height': 1.5},
                                    notes='Large mossy boulder with a small companion rock. Put z = 0 at the water level. Pair with river_foam_ring scaled ~1.6.'),
        'river_foam_ring': dict(landmark=False, collider=none,
                                notes='White foam ring and streaks (fx_water, U around the ring, V outward) for the water around a boulder. Lies 0.015 above '
                                      'the water surface (z = 0); inner radius ~1.1 fits river_boulder (scale ~1.6 for the large one). The ring trails '
                                      'slightly toward +X: turn +X downstream.'),
        'river_dock': dict(landmark=False, collider=none,
                           notes='Fishing dock 6 x 2.5 m; z = 0 is the water level, deck top at 0.8 m. The bank end is -X, the ladder end +X. '
                                 'Walkable: another mechanism must carry the deck surface (a 6 x 2.5 m plane at y = 0.8). Posts go 1.2 m below the water.'),
        'river_boat': dict(landmark=False, collider={'kind': 'box', 'half': [1.75, 0.35, 0.7]},
                           notes='Rowing boat, bow +X. Floats: put z = 0 at the water level (hull bottom ~0.2 m below). One oar rests out over the -Y side.'),
    }[name]
    out = {'landmark': m['landmark'], 'collider': m['collider'], 'footprint': foot, 'size': size, 'notes': m['notes']}
    return out


def write_props(entries):
    path = os.path.join(ek.SOURCE, KIT, 'props.json')
    data = {}
    if os.path.exists(path):
        with open(path) as f:
            data = json.load(f)
    data.update(entries)
    data = {k: data[k] for k in sorted(data) if k in BUILDERS}
    with open(path, 'w') as f:
        json.dump(data, f, indent=2)
        f.write('\n')


def label(text, loc, size=0.9):
    cu = bpy.data.curves.new('lbl_' + text, 'FONT')
    cu.body = text
    cu.size = size
    cu.align_x = 'CENTER'
    cu.extrude = 0.02
    tmp = bpy.data.objects.new('lbl_tmp', cu)
    bpy.context.scene.collection.objects.link(tmp)
    dg = bpy.context.evaluated_depsgraph_get()
    me = bpy.data.meshes.new_from_object(tmp.evaluated_get(dg))
    bpy.data.objects.remove(tmp)
    obj = bpy.data.objects.new('lbl_' + text, me)
    bpy.context.scene.collection.objects.link(obj)
    obj.location = loc
    obj.rotation_euler = (math.radians(90), 0, math.radians(25))
    ek.paint(obj, '#20262b')
    return obj


def kit_sheet():
    """All props in one scene on a turquoise water plane, labelled, with a 1.7 m figure for scale."""
    ek.reset()
    layout = {
        'river_pine': (-23, 24), 'river_bridge': (-12, 22), 'river_mill': (10, 22),
        'river_willow': (-31, 8), 'river_birch': (-21, 7), 'river_birch_pair': (-14, 7), 'river_boulder_large': (-5, 7),
        'river_dock': (4, 7), 'river_boat': (12, 7), 'river_mill_wheel': (21, 7),
        'river_cattails': (-27, -5), 'river_lilypads': (-20, -5), 'river_shoal': (-10, -5), 'river_boulder': (0, -5),
        'river_foam_ring': (7, -5),
    }
    for name, (x, y) in layout.items():
        obj = BUILDERS[name]()
        dz = WHEEL_R + 0.3 if name == 'river_mill_wheel' else 0.0
        obj.location = (x, y, dz)
        if name == 'river_foam_ring':
            b = BUILDERS['river_boulder']()
            b.location = (x, y, 0)
        lo_y = min(v.co.y for v in obj.data.vertices)
        label(name.replace('river_', ''), (x, y + lo_y - 1.2, 0.05), size=0.9)
    # scale figure next to the boulder
    fig = MB()
    cyl(fig, V(0, 0, 0), V(0, 0, 1.05), 0.17, 0.2, 8, '#c0392b')
    ico(fig, V(0, 0, 1.45), 0.2, '#f0c8a0', subdiv=2)
    cyl(fig, V(0, 0, 1.05), V(0, 0, 1.25), 0.2, 0.12, 8, '#c0392b')
    f = fig.to_object('figure')
    f.location = (2.4, -6.5, 0)
    water = MB()
    water.add([V(-40, -14, -0.02), V(32, -14, -0.02), V(32, 34, -0.02), V(-40, 34, -0.02)], [(0, 1, 2, 3)], '#86d3cb', orient=False)
    w = water.to_object('water_plane')
    scene = bpy.context.scene
    scene.render.engine = 'BLENDER_WORKBENCH'
    sh = scene.display.shading
    sh.light = 'STUDIO'
    sh.color_type = 'VERTEX'
    sh.show_shadows = True
    sh.show_cavity = False
    scene.render.resolution_x = 2400
    scene.render.resolution_y = 1500
    world = scene.world or bpy.data.worlds.new('World')
    scene.world = world
    world.color = (0.62, 0.74, 0.84)
    sh.background_type = 'WORLD'
    cam_data = bpy.data.cameras.new('sheet_cam')
    cam_data.type = 'ORTHO'
    cam_data.ortho_scale = 58
    cam = bpy.data.objects.new('sheet_cam', cam_data)
    scene.collection.objects.link(cam)
    scene.camera = cam
    target = V(-4, 8, 2.5)
    d = V(0.35, -1.0, 0.62).normalized()
    cam.location = target + d * 90
    cam.rotation_euler = (target - cam.location).to_track_quat('-Z', 'Y').to_euler()
    cam_data.clip_end = 300
    out = os.path.join(ek.SOURCE, KIT, 'preview', '_kit_sheet.png')
    scene.render.filepath = out
    bpy.ops.render.render(write_still=True)
    print('ENVKIT river kit sheet ->', os.path.relpath(out, ek.REPO))


def run():
    global MILL_WHEEL_AXLE
    wanted = ek.only_args()
    entries = {}
    for name, fn in BUILDERS.items():
        if wanted and name not in wanted:
            continue
        ek.reset()
        obj = fn()
        entries[name] = meta_for(name, obj)
        ek.export_prop(obj, KIT, name, CAPS.get(name, 4000))
        views = os.environ.get('RIVER_VIEWS', 'three_quarter').split(',')
        ek.render_preview(obj, KIT, name, views=tuple(views))
    if entries:
        write_props(entries)
    if not wanted or '_kit_sheet' in wanted:
        kit_sheet()


if __name__ == '__main__':
    run()
