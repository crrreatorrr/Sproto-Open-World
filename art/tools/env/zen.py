"""
Zen garden environment kit (prefix zen_), built from code to match docs/concepts/zen-garden.webp.

Semi-low-poly, faceted and chunky, flat painterly per-face vertex colours sampled from the concept.
Every prop is built in world coordinates into one accumulator (verts, faces, per-face colour and
material), so nothing depends on object transforms. Randomness is seeded per prop.

Run (from the repo root):
    /Applications/Blender.app/Contents/MacOS/Blender --background --factory-startup \
        --python art/tools/env/zen.py [-- zen_torii zen_lantern ...] [-- _sheet]

`_sheet` (also run after a full build) writes preview/_kit_sheet.png, a labelled grid of every
prop's preview. ZEN_VIEWS=front,side,... renders extra preview angles while iterating.
"""
import json
import math
import os
import random
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import bmesh  # noqa: E402
import bpy  # noqa: E402
from mathutils import Matrix, Vector  # noqa: E402

import envkit as ek  # noqa: E402

KIT = 'zen'
V = Vector
TAU = 2 * math.pi
OUT = os.path.join(ek.SOURCE, KIT)

# --- palette (sampled from the concept, nudged to flat painterly tones) ------------------------

RED = ['#e44b30', '#dc452b', '#ea5236', '#d6412a']
RED_D = '#a82e1d'
BLACK = ['#2b2b2a', '#262625', '#313130']
BLACK_TOP = ['#4d4e4c', '#555654', '#474846']
PLINTH = ['#b6b3a7', '#aeab9f', '#bdbaae']
LSTONE = ['#adb09d', '#a4a895', '#b5b8a4', '#9da08e']
LSTONE_D = ['#8a8e7e', '#828676']
MOSS = ['#7f9a2e', '#8eab38', '#6f8c28', '#9ab843']
ROCK = ['#9ea29b', '#90958e', '#aaaea6', '#848981']
GRAVEL = ['#fafbfc', '#f5f6f8', '#fdfdfe']
GRAVEL_S = ['#d8dce3', '#d2d7df']
TILE = ['#555a60', '#4b5056']
TILE_LIP = '#7a7f86'
TILE_HIP = ['#8a8f96', '#80858c']
WHITE = '#ecebe5'
WOOD = ['#9c5f36', '#93592f', '#a5673c']
WOOD_D = ['#6b4128', '#634026']
FASCIA = ['#b8703c', '#c07a42']
PLASTER = ['#ddd6c6', '#d6cfbe']
DARK = ['#3a2c28', '#342724']
DECK = ['#8e6a4a', '#86623f', '#96714f']
TEMPLE_STONE = ['#a9a7a0', '#9f9d96', '#b2b0a8']
BR_RED = ['#e6533a', '#de4c33', '#ec5a3f']
BR_RED_D = ['#c63f29', '#bd3a25']
BR_CAP = ['#2f2f2e', '#383837']
MAPLE_RED_TOP = ['#c8202a', '#d83a2e', '#b8181f', '#e24c36', '#cf2a28']
MAPLE_RED_BOT = ['#7c0e16', '#94141c', '#a81c20', '#86101a']
MAPLE_OR_TOP = ['#f6922f', '#fbae42', '#f07c2a', '#fcc458', '#ea6a28', '#f8a238']
MAPLE_OR_BOT = ['#bf4a1e', '#c95a22', '#a8381a', '#cf4428']
MAPLE_OR_RED = ['#d43a26', '#c42c22', '#dc4a2c']
TRUNK = ['#3d2b25', '#4a352c', '#33241f', '#45312a']
BAMBOO = ['#9cc257', '#acd066', '#90b84e', '#b6d672']
BAMBOO_D = ['#7fa642', '#88ae48']
BAMBOO_RING = ['#e6e8b4', '#dfe2a8']
BAMBOO_LEAF = ['#5f923a', '#73a647', '#4e8030', '#86b552', '#689c40']
FENCE = ['#dcc48e', '#d2b87e', '#e4cf9a', '#c8ac72', '#d8bf88']
FENCE_RAIL = ['#bfae6c', '#b5a462', '#c9b876']
FENCE_TIE = '#7a6440'
SHRUB = ['#6a9a3c', '#78a846', '#5f8e36', '#86b452', '#70a040']
SHRUB_D = ['#3e6426', '#466e2a']
AZ_LEAF = ['#557c34', '#62883a', '#4b712e']
AZ_FLOWER = ['#fb88a2', '#f2688a', '#fca2b8', '#ffbccb', '#f77898']
KOI_OR = ['#f0782a', '#ec6a24', '#f38534']
KOI_W = ['#f3efe8', '#ece7de']
KOI_K = '#2a2726'
KOI_GOLD = ['#f2a43a', '#eea036']
WALL = ['#8a8e86', '#7b8078', '#979a91', '#6d726b', '#84887f']
WALL_CORE = '#4c504b'
GRASS = ['#6f9a3a', '#7daa44', '#5f8c32', '#86b04a']
SOIL = '#5a5245'
GLOW = '#f2bd6c'


def shade(h, f):
    h = h.lstrip('#')
    r, g, b = (int(h[i:i + 2], 16) for i in (0, 2, 4))
    return '#%02x%02x%02x' % tuple(max(0, min(255, int(round(c * f)))) for c in (r, g, b))


# --- accumulator -------------------------------------------------------------------------------

MATS = {'kit': ek.mat_kit, 'glow': ek.mat_glow, 'water': ek.mat_water}


class Acc:
    """Collects parts in world space. col per part: '#hex', a list (seeded pick per face), or a
    callable (centre, normal) -> '#hex' evaluated after normals are fixed."""

    def __init__(self, seed):
        self.rng = random.Random(seed)
        self.v, self.f, self.c, self.m, self.fix = [], [], [], [], []

    def add(self, vf, col, mat='kit', recalc=True):
        verts, faces = vf
        base = len(self.v)
        self.v.extend(V(p) for p in verts)
        for face in faces:
            self.f.append([base + i for i in face])
            self.c.append(col)
            self.m.append(mat)
            self.fix.append(recalc)
        return self

    def build(self, name, vary=0.05):
        me = bpy.data.meshes.new(name)
        me.from_pydata([tuple(p) for p in self.v], [], self.f)
        me.update()
        bm = bmesh.new()
        bm.from_mesh(me)
        bm.faces.ensure_lookup_table()
        fix = [bm.faces[i] for i, r in enumerate(self.fix) if r]
        if fix:
            bmesh.ops.recalc_face_normals(bm, faces=fix)
        bm.to_mesh(me)
        bm.free()
        used = sorted(set(self.m), key=lambda k: list(MATS).index(k))
        for k in used:
            me.materials.append(MATS[k]())
        layer = ek._ensure_color_layer(me)
        rng = random.Random(len(self.f))
        for p in me.polygons:
            spec = self.c[p.index]
            p.material_index = used.index(self.m[p.index])
            if callable(spec):
                h = spec(p.center.copy(), p.normal.copy())
            elif isinstance(spec, (list, tuple)):
                h = spec[rng.randrange(len(spec))]
            else:
                h = spec
            if vary and self.m[p.index] == 'kit':
                h = shade(h, 1 + rng.uniform(-vary, vary))
            rgba = ek.hex_rgb(h)
            for li in p.loop_indices:
                layer.data[li].color = rgba
        obj = bpy.data.objects.new(name, me)
        bpy.context.scene.collection.objects.link(obj)
        return obj


# --- geometry primitives (return (verts, faces)) ----------------------------------------------

def loft(rings, cap0=True, cap1=True):
    verts, idx = [], []
    for r in rings:
        idx.append(list(range(len(verts), len(verts) + len(r))))
        verts.extend(V(p) for p in r)
    faces = []
    for a, b in zip(idx, idx[1:]):
        if len(a) == 1:
            faces += [[a[0], b[(i + 1) % len(b)], b[i]] for i in range(len(b))]
        elif len(b) == 1:
            faces += [[a[i], a[(i + 1) % len(a)], b[0]] for i in range(len(a))]
        else:
            n = len(a)
            faces += [[a[i], a[(i + 1) % n], b[(i + 1) % n], b[i]] for i in range(n)]
    if cap0 and len(idx[0]) > 2:
        faces.append(idx[0][::-1])
    if cap1 and len(idx[-1]) > 2:
        faces.append(idx[-1])
    return verts, faces


def basis(axis, side=None):
    axis = V(axis).normalized()
    if side is None:
        side = V((1, 0, 0)) if abs(axis.x) < 0.9 else V((0, 1, 0))
    u = (V(side) - axis * V(side).dot(axis)).normalized()
    return u, axis.cross(u)


def ring(c, r, n, axis=(0, 0, 1), ry=None, phase=0.0, side=None):
    u, w = basis(axis, side)
    ry = r if ry is None else ry
    return [V(c) + u * math.cos(phase + TAU * i / n) * r + w * math.sin(phase + TAU * i / n) * ry
            for i in range(n)]


def tube(path, radii, n=6, phase=0.0, caps=(True, True), side=None, ry=None):
    """Tube along a polyline with parallel-transported frames. radii/ry: scalar or per point."""
    path = [V(p) for p in path]
    rings, u_prev = [], None
    for i, p in enumerate(path):
        if i == 0:
            t = path[1] - path[0]
        elif i == len(path) - 1:
            t = path[-1] - path[-2]
        else:
            t = (path[i + 1] - path[i]).normalized() + (path[i] - path[i - 1]).normalized()
        t.normalize()
        if u_prev is None:
            u, _ = basis(t, side)
        else:
            u = u_prev - t * u_prev.dot(t)
            u = u.normalized() if u.length > 1e-6 else basis(t)[0]
        w = t.cross(u)
        u_prev = u
        r = radii[i] if isinstance(radii, (list, tuple)) else radii
        r2 = r if ry is None else (ry[i] if isinstance(ry, (list, tuple)) else ry)
        rings.append([p + u * math.cos(phase + TAU * k / n) * r + w * math.sin(phase + TAU * k / n) * r2
                      for k in range(n)])
    return loft(rings, *caps)


def cyl(c, r, h, n=8, r_top=None, phase=None):
    phase = math.pi / n if phase is None else phase
    c = V(c)
    return loft([ring(c, r, n, phase=phase),
                 ring(c + V((0, 0, h)), r if r_top is None else r_top, n, phase=phase)])


def prism(outline, z0, z1, top=None):
    """Vertical prism from a CCW outline [(x, y)], optionally with a different top outline."""
    top = outline if top is None else top
    return loft([[V((x, y, z0)) for x, y in outline], [V((x, y, z1)) for x, y in top]])


def xform(vf, m):
    verts, faces = vf
    return [m @ V(p) for p in verts], faces


def boxv(c, size, rz=0.0, rx=0.0, ry=0.0, taper=1.0):
    """Box of full size with its base centre at c; rotated about that base centre."""
    sx, sy, sz = (s / 2 for s in size)
    lo = [(-sx, -sy), (sx, -sy), (sx, sy), (-sx, sy)]
    hi = [(x * taper, y * taper) for x, y in lo]
    vf = loft([[V((x, y, 0)) for x, y in lo], [V((x, y, 2 * sz)) for x, y in hi]])
    m = Matrix.Translation(V(c)) @ Matrix.Rotation(rz, 4, 'Z') @ Matrix.Rotation(ry, 4, 'Y') @ \
        Matrix.Rotation(rx, 4, 'X')
    return xform(vf, m)


def bm_vf(bm):
    verts = [v.co.copy() for v in bm.verts]
    bm.verts.index_update()
    faces = [[v.index for v in f.verts] for f in bm.faces]
    bm.free()
    return verts, faces


def icov(c, r, subdiv=1, scale=(1, 1, 1), jit=0.0, rng=None, floor=None):
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=subdiv, radius=r)
    for v in bm.verts:
        v.co = V((v.co.x * scale[0], v.co.y * scale[1], v.co.z * scale[2]))
        if jit:
            v.co += V((rng.uniform(-1, 1), rng.uniform(-1, 1), rng.uniform(-1, 1))) * jit
        v.co += V(c)
        if floor is not None and v.co.z < floor:
            v.co.z = floor
    return bm_vf(bm)


def bevel_box(c, size, bevel, rz=0.0, jit=0.0, rng=None):
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.scale(bm, vec=V(size), verts=bm.verts)
    bmesh.ops.translate(bm, vec=V((0, 0, size[2] / 2)), verts=bm.verts)
    if bevel > 0:
        bmesh.ops.bevel(bm, geom=list(bm.edges), offset=bevel, segments=1, affect='EDGES')
    m = Matrix.Translation(V(c)) @ Matrix.Rotation(rz, 4, 'Z')
    for v in bm.verts:
        if jit:
            v.co += V((rng.uniform(-1, 1), rng.uniform(-1, 1), rng.uniform(-1, 1))) * jit
        v.co = m @ v.co
    return bm_vf(bm)


def grid_slab(P, thick, flip=False):
    """Thick slab from a grid of top points P[j][i]. Returns (top, bottom, edges) parts, so the
    caller can colour each. Top faces are ordered row by row, column by column."""
    nj, ni = len(P), len(P[0])
    top_v = [V(p) for row in P for p in row]
    bot_v = [V(p) - V((0, 0, thick)) for row in P for p in row]
    idx = lambda j, i: j * ni + i  # noqa: E731
    top_f, bot_f = [], []
    for j in range(nj - 1):
        for i in range(ni - 1):
            q = [idx(j, i), idx(j, i + 1), idx(j + 1, i + 1), idx(j + 1, i)]
            top_f.append(q[::-1] if flip else q)
            bot_f.append(q if flip else q[::-1])
    border = [idx(0, i) for i in range(ni)] + [idx(j, ni - 1) for j in range(1, nj)] + \
             [idx(nj - 1, i) for i in range(ni - 2, -1, -1)] + [idx(j, 0) for j in range(nj - 2, 0, -1)]
    ev = top_v + bot_v
    n = len(top_v)
    edge_f = []
    for k in range(len(border)):
        a, b = border[k], border[(k + 1) % len(border)]
        q = [a, b, n + b, n + a]
        edge_f.append(q if flip else q[::-1])
    return (top_v, top_f), (bot_v, bot_f), (ev, edge_f)


# --- roofs -------------------------------------------------------------------------------------

def rect_pts(a, b, dx, dy):
    """CCW perimeter of a rectangle, (x, y, cornerness 0..1)."""
    pts = []
    for k in range(dx):
        t = k / dx
        pts.append((-a + 2 * a * t, -b, abs(2 * t - 1)))
    for k in range(dy):
        t = k / dy
        pts.append((a, -b + 2 * b * t, abs(2 * t - 1)))
    for k in range(dx):
        t = k / dx
        pts.append((a - 2 * a * t, b, abs(2 * t - 1)))
    for k in range(dy):
        t = k / dy
        pts.append((-a, b - 2 * b * t, abs(2 * t - 1)))
    return pts


def hip_roof(acc, hx, hy, ze, thx, thy, zt, dx, dy, rings=5, curve=1.8, thick=0.35, lift=0.8,
             out=0.4, wall=None, soffit_rise=0.3, rib=0.05, extra_lift=None, close_top=False,
             hips=True, hip_r=0.12, tile=TILE, lip=TILE_LIP, fascia=FASCIA, soffit=WOOD_D,
             hip_col=TILE_HIP, hip_end=WHITE):
    """Japanese hip roof: concave rings from the eave up to a top rectangle, upturned corners."""
    R = []
    for r in range(rings + 1):
        s = r / rings
        a = hx + (thx - hx) * s
        b = hy + (thy - hy) * s
        z = ze + (zt - ze) * s ** curve
        row = []
        for i, (x, y, c) in enumerate(rect_pts(a, b, dx, dy)):
            cc = c ** 3
            push = out * cc * (1 - s)
            p = V((x + math.copysign(push, x), y + math.copysign(push, y),
                   z + lift * cc * (1 - s) ** 2))
            if rib and i % 2 and r > 0 and c < 0.99:
                p.z += rib
            if extra_lift:
                p.z += extra_lift(x, y, s)
            row.append(p)
        R.append(row)
    n = len(R[0])
    # top surface, one stripe colour per perimeter column
    for r in range(rings):
        for i in range(n):
            j = (i + 1) % n
            col = lip if r == 0 else tile[i % 2]
            acc.add(([R[r][i], R[r][j], R[r + 1][j], R[r + 1][i]], [[0, 1, 2, 3]]), col, recalc=False)
    if close_top:
        acc.add((R[-1], [list(range(n))]), tile[0], recalc=False)
    U = [p - V((0, 0, thick)) for p in R[0]]
    for i in range(n):
        j = (i + 1) % n
        acc.add(([U[i], U[j], R[0][j], R[0][i]], [[0, 1, 2, 3]]), fascia, recalc=False)
    wx, wy = wall if wall else (thx, thy)
    W = [V((x, y, ze - thick + soffit_rise)) for x, y, _ in rect_pts(wx, wy, dx, dy)]
    for i in range(n):
        j = (i + 1) % n
        acc.add(([W[i], W[j], U[j], U[i]], [[0, 1, 2, 3]]), soffit, recalc=False)
    if hips:
        for ci in (0, dx, dx + dy, 2 * dx + dy):
            path = [R[r][ci] + V((0, 0, hip_r * 0.6)) for r in range(rings + 1)]
            tip = path[0] + (path[0] - path[1]).normalized() * 0.25 + V((0, 0, 0.12))
            acc.add(tube([tip] + path, hip_r, n=4, phase=math.pi / 4), hip_col)
            acc.add(cyl(tip - V((0, 0, hip_r * 1.2)), hip_r * 1.5, hip_r * 2.4, n=6), hip_end)
    return R


def gable_slopes(acc, gx, gy, zg, zr, ov=0.45, ny=4, nx=12, thick=0.3, dip=0.25, tile=TILE,
                 under=WOOD_D, edge=FASCIA):
    """Front and back gable slopes of an irimoya roof, from just below the hip top up to the ridge."""
    y0 = gy + 0.35
    for side in (-1, 1):
        P = []
        for j in range(ny + 1):
            u = 1 - j / ny  # 1 at the bottom edge, 0 at the ridge
            y = side * y0 * u
            z = zr - (zr - (zg - dip)) * (1 - (1 - u) ** 1.6)
            row = []
            for i in range(nx + 1):
                x = -gx - ov + 2 * (gx + ov) * i / nx
                xe = abs(x) / (gx + ov)
                row.append(V((x, y, z + 0.12 * xe ** 4 + (0.05 if i % 2 and j < ny else 0))))
            P.append(row)
        top, bot, edges = grid_slab(P, thick, flip=(side > 0))
        tv, tf = top
        cols = []
        for j in range(ny):
            for i in range(nx):
                cols.append(TILE_LIP if j == 0 else tile[i % 2])
        acc.add((tv, tf), lambda c, n, _it=iter(cols): next(_it), recalc=False)
        acc.add(bot, under, recalc=False)
        acc.add(edges, TILE_LIP, recalc=False)


# --- props -------------------------------------------------------------------------------------

def zen_torii():
    acc = Acc(11)
    rng = acc.rng
    px, lean = 2.35, 0.12
    # stone pedestals and black base sleeves
    for s in (-1, 1):
        acc.add(boxv((s * px, 0, 0), (1.35, 1.35, 0.28), taper=0.92), PLINTH)
        acc.add(cyl((s * px, 0, 0.28), 0.56, 1.25, n=8, r_top=0.52), BLACK)
        acc.add(cyl((s * px, 0, 1.53), 0.52, 0.06, n=8, r_top=0.42), BLACK_TOP)
    # pillars (8-sided, chunky, leaning in a little), with faint vertical facet variation
    for s in (-1, 1):
        base = V((s * px, 0, 1.4))
        top = V((s * (px - lean), 0, 7.15))
        path = [base.lerp(top, t) for t in (0, 0.33, 0.66, 1)]
        acc.add(tube(path, [0.4, 0.39, 0.38, 0.36], n=8, phase=math.pi / 8), RED)
    # nuki tie beam, through the pillars and out past them
    acc.add(boxv((0, 0, 5.55), (6.2, 0.42, 0.52)), RED)
    for s in (-1, 1):  # wedges (kusabi) beside the pillars
        acc.add(boxv((s * (px - lean * 0.66 + 0.42), 0, 5.6), (0.14, 0.5, 0.42)), RED_D)
    # gakuzuka: short central post between nuki and shimaki, with a dark plaque
    acc.add(boxv((0, 0, 6.07), (0.56, 0.36, 0.8)), RED)
    # shimaki (red lintel) and kasagi (black top beam), both curving up at the ends
    nx = 14

    def curve(x, base, amp, p):
        return base + amp * (abs(x) / 4.0) ** p

    rings = []
    for k in range(nx + 1):
        x = -3.75 + 7.5 * k / nx
        zb = curve(x, 6.85, 0.28, 2.4)
        zt = curve(x, 7.3, 0.3, 2.4)
        rings.append([V((x, -0.32, zb)), V((x, 0.32, zb)), V((x, 0.32, zt)), V((x, -0.32, zt))])
    acc.add(loft(rings), RED)
    rings = []
    for k in range(nx + 1):
        t = k / nx
        x = -4.15 + 8.3 * t
        zb = curve(x, 7.3, 0.42, 2.3)
        zt = curve(x, 7.82, 0.62, 2.2)
        xo = math.copysign(0.18, x) * (abs(x) / 4.15) ** 6  # tips flare outward at the top
        rings.append([V((x, -0.44, zb)), V((x, 0.44, zb)), V((x + xo, 0.48, zt - 0.1)),
                      V((x + xo, 0.0, zt)), V((x + xo, -0.48, zt - 0.1))])

    def kasagi_col(c, n):
        if n.z > 0.45:
            return rng.choice(BLACK_TOP)
        return rng.choice(BLACK)

    acc.add(loft(rings), kasagi_col)
    return acc.build('zen_torii')


def zen_lantern():
    acc = Acc(21)
    rng = acc.rng

    def stone_moss(p_moss, zmin=0.0):
        def f(c, n):
            if n.z > 0.5 and c.z > zmin and rng.random() < p_moss:
                return rng.choice(MOSS)
            return rng.choice(LSTONE if n.z > -0.3 else LSTONE_D)
        return f

    # stepped base (kiso)
    acc.add(bevel_box((0, 0, 0), (1.05, 1.05, 0.2), 0.04, jit=0.012, rng=rng), stone_moss(0.75))
    acc.add(bevel_box((0, 0, 0.2), (0.78, 0.78, 0.16), 0.03, jit=0.01, rng=rng), stone_moss(0.5))
    # moss clumps spilling over the base
    for a in (0.5, 2.2, 3.9, 5.3):
        acc.add(icov((0.45 * math.cos(a), 0.45 * math.sin(a), 0.2), 0.14, 1, (1.3, 1.3, 0.5), 0.02, rng),
                MOSS)
    # post (sao): six-sided, waisted, with dark carved marks
    rs = [(0.36, 0.25), (0.33, 0.42), (0.27, 0.65), (0.29, 0.85), (0.36, 1.0), (0.4, 1.06)]
    rings = [ring((0, 0, z), r, 6, phase=math.pi / 6) for r, z in rs]

    def post_col(c, n):
        if 0.45 < c.z < 0.9 and abs(n.z) < 0.5 and rng.random() < 0.3:
            return '#4f5348'
        return rng.choice(LSTONE)

    acc.add(loft(rings), post_col)
    # middle platform (chudai), hexagonal with a sloped underside
    acc.add(loft([ring((0, 0, 1.06), 0.42, 6, phase=math.pi / 6),
                  ring((0, 0, 1.16), 0.55, 6, phase=math.pi / 6),
                  ring((0, 0, 1.28), 0.55, 6, phase=math.pi / 6),
                  ring((0, 0, 1.3), 0.5, 6, phase=math.pi / 6)]), stone_moss(0.35, 1.25))
    # light box (hibukuro): six corner posts, sill and lintel, glowing core seen through windows
    z0, z1 = 1.3, 1.74
    acc.add(cyl((0, 0, z0), 0.24, z1 - z0, n=6, phase=0.0), GLOW, mat='glow')
    for k in range(6):
        a = k * TAU / 6
        acc.add(boxv((0.31 * math.cos(a), 0.31 * math.sin(a), z0), (0.11, 0.11, z1 - z0), rz=a), LSTONE)
    acc.add(loft([ring((0, 0, z0), 0.36, 6, phase=0.0), ring((0, 0, z0 + 0.08), 0.36, 6, phase=0.0)]),
            LSTONE)
    acc.add(loft([ring((0, 0, z1 - 0.07), 0.36, 6, phase=0.0), ring((0, 0, z1), 0.38, 6, phase=0.0)]),
            LSTONE)
    # cap (kasa): hexagonal, wide, with upturned corner tips (warabite)
    zc = z1
    n = 12
    eave = []
    for i in range(n):
        a = TAU * i / n
        corner = i % 2 == 0
        r = 0.74 if corner else 0.62
        eave.append(V((r * math.cos(a), r * math.sin(a), zc + 0.13 + (0.07 if corner else 0.0))))
    under = [V((p.x * 0.97, p.y * 0.97, zc + 0.02)) for p in eave]
    mid = ring((0, 0, zc + 0.33), 0.46, 12, phase=0.0)
    for i, p in enumerate(mid):
        if i % 2 == 0:
            p.z += 0.03
    top = ring((0, 0, zc + 0.42), 0.16, 6, phase=0.0)
    vf = loft([ring((0, 0, zc), 0.34, 12, phase=0.0), under, eave, mid,
               [top[i // 2] if i % 2 == 0 else top[i // 2].lerp(top[(i // 2 + 1) % 6], 0.5) for i in range(12)]])

    def cap_col(c, n):
        if n.z > 0.4 and rng.random() < 0.35:
            return rng.choice(MOSS)
        return rng.choice(LSTONE if n.z > 0 else LSTONE_D)

    acc.add(vf, cap_col)
    for i in range(0, n, 2):  # curled tips
        p = eave[i]
        d = V((p.x, p.y, 0)).normalized()
        acc.add(tube([p - d * 0.06, p + d * 0.02 + V((0, 0, 0.04)), p + d * 0.03 + V((0, 0, 0.1))],
                     [0.06, 0.05, 0.03], n=4), LSTONE)
    # finial (hoju) on a drum
    acc.add(cyl((0, 0, zc + 0.42), 0.17, 0.12, n=6, r_top=0.15), LSTONE)
    acc.add(loft([ring((0, 0, zc + 0.54), 0.08, 6, phase=0.0), ring((0, 0, zc + 0.6), 0.17, 6, phase=0.0),
                  ring((0, 0, zc + 0.72), 0.15, 6, phase=0.0), [V((0, 0, zc + 0.9))]]),
            lambda c, n: rng.choice(MOSS) if n.z > 0.6 and rng.random() < 0.4 else rng.choice(LSTONE))
    acc.v = [p * 0.91 for p in acc.v]  # to the 2.4 m target
    return acc.build('zen_lantern')


def temple_body(acc, rng, hx, hy, z0, z1, posts_x, posts_y, front_door=True, low=True):
    """A wooden hall body: posts, beams, white plaster band, lattice and doors."""
    acc.add(boxv((0, 0, z0), (2 * hx - 0.1, 2 * hy - 0.1, z1 - z0)), DARK)
    h = z1 - z0
    zb1, zb2 = z0 + h * 0.58, z0 + h * 0.8  # door-head beam, plaster band top
    # walls: plaster panel band and lattice/board panels, slightly proud of the core
    for s in (-1, 1):
        acc.add(boxv((0, s * (hy - 0.02), zb1), (2 * hx - 0.2, 0.06, zb2 - zb1)), PLASTER)
        acc.add(boxv((s * (hx - 0.02), 0, zb1), (0.06, 2 * hy - 0.2, zb2 - zb1)), PLASTER)
    xs = [-hx + 2 * hx * i / posts_x for i in range(posts_x + 1)]
    ys = [-hy + 2 * hy * i / posts_y for i in range(posts_y + 1)]
    # lower panels: boards on the sides and back, lattice windows and a door on the front
    for i in range(posts_x):
        xa, xb = xs[i], xs[i + 1]
        xc, w = (xa + xb) / 2, xb - xa - 0.3
        mid = i == posts_x // 2 and posts_x % 2 == 1
        for s in (-1, 1):
            y = s * (hy - 0.01)
            if s < 0 and front_door and mid:
                acc.add(boxv((xc, y, z0), (w, 0.08, zb1 - z0 - 0.05)), WOOD_D)
                acc.add(boxv((xc, y - 0.03, z0 + 0.1), (0.08, 0.06, zb1 - z0 - 0.2)), DARK)
                for k in range(3):
                    acc.add(boxv((xc, y - 0.04, z0 + 0.4 + k * 0.7), (w - 0.1, 0.05, 0.08)), WOOD)
            elif s < 0 and low:
                acc.add(boxv((xc, y, z0 + 0.6), (w, 0.04, zb1 - z0 - 0.7)), DARK)
                nb = max(4, int(w / 0.22))
                for k in range(nb):
                    bxx = xa + 0.15 + (k + 0.5) * w / nb
                    acc.add(boxv((bxx, y - 0.04, z0 + 0.6), (0.06, 0.05, zb1 - z0 - 0.7)), WOOD)
                acc.add(boxv((xc, y - 0.02, z0), (w, 0.05, 0.6)), WOOD_D)
            else:
                acc.add(boxv((xc, y, z0), (w, 0.05, zb1 - z0)), WOOD_D)
    for j in range(posts_y):
        ya, yb = ys[j], ys[j + 1]
        for s in (-1, 1):
            acc.add(boxv((s * (hx - 0.01), (ya + yb) / 2, z0), (0.05, yb - ya - 0.3, zb1 - z0)), WOOD_D)
    # posts and beams
    for x in xs:
        for y in (ys[0], ys[-1]):
            acc.add(boxv((x, y, z0), (0.3, 0.3, h)), WOOD)
    for y in ys[1:-1]:
        for x in (xs[0], xs[-1]):
            acc.add(boxv((x, y, z0), (0.3, 0.3, h)), WOOD)
    for zz, th in ((zb1 - 0.1, 0.22), (zb2, 0.2), (z1 - 0.25, 0.25)):
        for s in (-1, 1):
            acc.add(boxv((0, s * (hy + 0.04), zz), (2 * hx + 0.3, 0.14, th)), WOOD)
            acc.add(boxv((s * (hx + 0.04), 0, zz), (0.14, 2 * hy + 0.3, th)), WOOD)
    # bracket blocks (masugumi) on each post head
    for x in xs:
        for y in (ys[0], ys[-1]):
            acc.add(boxv((x, y * 1.03, z1 - 0.02), (0.45, 0.45, 0.22), taper=1.15), FASCIA)
    return xs, ys


def railing(acc, pts_list, z_of, h=0.85, post=0.12, rail=(0.1, 0.12), col=DECK, step=1.4, gaps=()):
    """Railing along polylines [(x, y)], posts every `step`, top and mid rails."""
    for pts in pts_list:
        for (xa, ya), (xb, yb) in zip(pts, pts[1:]):
            L = math.hypot(xb - xa, yb - ya)
            n = max(1, round(L / step))
            ang = math.atan2(yb - ya, xb - xa)
            for k in range(n + 1):
                t = k / n
                x, y = xa + (xb - xa) * t, ya + (yb - ya) * t
                acc.add(boxv((x, y, z_of), (post, post, h + 0.06), rz=ang), col)
            cx, cy = (xa + xb) / 2, (ya + yb) / 2
            acc.add(boxv((cx, cy, z_of + h - rail[1]), (L + post, rail[0], rail[1]), rz=ang), col)
            acc.add(boxv((cx, cy, z_of + h * 0.45), (L, rail[0] * 0.7, rail[1] * 0.7), rz=ang), col)


def zen_temple():
    acc = Acc(31)
    rng = acc.rng
    vx, vy = 6.9, 4.6  # veranda half size
    deck = 1.1
    # stone plinth and dark void under the deck
    acc.add(bevel_box((0, 0, 0), (2 * vx + 0.3, 2 * vy + 0.3, 0.45), 0.05), TEMPLE_STONE)
    for k in range(14):  # stone course lines on the plinth front
        x = -vx + (k + 0.5) * 2 * vx / 14
        acc.add(boxv((x, -vy - 0.16, 0.0), (0.04, 0.03, 0.45)), '#8a8880')
    acc.add(boxv((0, 0, 0.45), (2 * vx - 0.5, 2 * vy - 0.5, deck - 0.6)), '#2b2422')
    for k in range(11):
        x = -vx + 0.25 + k * (2 * vx - 0.5) / 10
        for y in (-vy + 0.25, vy - 0.25):
            acc.add(boxv((x, y, 0.45), (0.22, 0.22, deck - 0.6)), WOOD_D)
    for k in range(1, 7):
        y = -vy + 0.25 + k * (2 * vy - 0.5) / 7
        for x in (-vx + 0.25, vx - 0.25):
            acc.add(boxv((x, y, 0.45), (0.22, 0.22, deck - 0.6)), WOOD_D)
    # veranda deck with plank stripes
    nplank = 24
    for k in range(nplank):
        x = -vx + (k + 0.5) * 2 * vx / nplank
        acc.add(boxv((x, 0, deck - 0.15), (2 * vx / nplank - 0.02, 2 * vy, 0.15)), DECK)
    acc.add(boxv((0, -vy, deck - 0.3), (2 * vx + 0.1, 0.16, 0.22)), WOOD)
    # railing with a gap for the front steps
    gx = 1.75
    z = deck
    railing(acc, [[(-gx, -vy + 0.1), (-vx + 0.1, -vy + 0.1), (-vx + 0.1, vy - 0.1), (vx - 0.1, vy - 0.1),
                   (vx - 0.1, -vy + 0.1), (gx, -vy + 0.1)]], z, col=DECK)
    # front steps down toward -Y with cheek walls
    nst = 6
    for k in range(nst):
        depth = (k + 1) * 0.32
        acc.add(boxv((0, -vy - 0.1 - depth / 2, 0), (2 * gx - 0.3, depth, deck * (nst - k) / (nst + 1))),
                TEMPLE_STONE)
    for s in (-1, 1):
        prof = [(-vy - 0.1, deck + 0.1), (-vy - 0.1 - nst * 0.32, 0.28), (-vy - 0.1 - nst * 0.32, 0.0),
                (-vy - 0.1, 0.0)]
        verts = [V((s * (gx - 0.05) + dx, y, zz)) for dx in (-0.15, 0.15) for y, zz in prof]
        faces = [[0, 1, 2, 3], [7, 6, 5, 4], [0, 4, 5, 1], [1, 5, 6, 2], [2, 6, 7, 3], [3, 7, 4, 0]]
        acc.add((verts, faces), TEMPLE_STONE)
    # main hall body
    hx, hy = 5.2, 3.2
    temple_body(acc, rng, hx, hy, deck, 4.65, 5, 3)
    # lower (skirt) roof with a karahafu bump over the entrance
    def bump(x, y, s):
        if y < 0 and abs(x) < 2.8:
            return 0.85 * math.cos(math.pi / 2 * x / 2.8) ** 2 * (1 - s) ** 1.4
        return 0.0

    hip_roof(acc, 7.8, 5.75, 4.6, 5.4, 3.4, 5.95, 22, 16, rings=4, curve=1.5, thick=0.32, lift=0.75,
             out=0.45, wall=(hx, hy), soffit_rise=0.15, extra_lift=bump, hip_r=0.11)
    # karahafu gable face under the bump (curved board)
    prof = []
    for k in range(13):
        x = -2.7 + 5.4 * k / 12
        prof.append((x, 4.4 + 0.82 * math.cos(math.pi / 2 * x / 2.8) ** 2))
    prof_b = [(x, 4.4) for x, _ in prof[::-1]]
    poly = prof + prof_b[1:-1]
    verts = [V((x, -5.8, zz)) for x, zz in poly] + [V((x, -5.55, zz)) for x, zz in poly]
    n = len(poly)
    faces = [list(range(n))[::-1], list(range(n, 2 * n))] + \
            [[i, (i + 1) % n, n + (i + 1) % n, n + i] for i in range(n)]
    acc.add((verts, faces), FASCIA)
    # upper storey (clerestory) body
    ux, uy = 4.3, 2.6
    acc.add(boxv((0, 0, 5.55), (2 * ux, 2 * uy, 1.45)), PLASTER)
    for k in range(7):
        x = -ux + k * 2 * ux / 6
        for y in (-uy - 0.02, uy + 0.02):
            acc.add(boxv((x, y, 5.55), (0.24, 0.1, 1.45)), WOOD)
    for y in (-uy - 0.02, uy + 0.02):
        acc.add(boxv((0, y, 5.55), (2 * ux + 0.2, 0.12, 0.2)), WOOD)
        acc.add(boxv((0, y, 6.75), (2 * ux + 0.2, 0.12, 0.22)), WOOD)
    for x in (-ux - 0.02, ux + 0.02):
        acc.add(boxv((x, 0, 6.75), (0.12, 2 * uy + 0.2, 0.22)), WOOD)
    # upper roof: irimoya (hip below, gable above)
    zg = 8.55
    hip_roof(acc, 7.2, 5.0, 6.8, 4.6, 2.4, zg, 20, 14, rings=4, curve=1.6, thick=0.34, lift=0.9,
             out=0.5, wall=(ux, uy), soffit_rise=0.1, hip_r=0.12)
    zr = 9.75
    gable_slopes(acc, 4.6, 2.4, zg, zr, ov=0.45, ny=4, nx=14, thick=0.3)
    # gable walls (tsuma) with lattice stripes and white bargeboards that sweep out at the foot
    for s in (-1, 1):
        x = s * 4.5
        tri = [V((x, -2.5, zg - 0.2)), V((x, 2.5, zg - 0.2)), V((x, 0, zr - 0.15))]
        acc.add((tri, [[0, 1, 2]]), WOOD_D)
        for k in range(5):
            yy = -1.6 + k * 0.8
            hgt = (zr - 0.15 - (zg - 0.2)) * (1 - abs(yy) / 2.5)
            acc.add(boxv((x + s * 0.03, yy, zg - 0.2), (0.05, 0.1, hgt)), WOOD)
        acc.add(boxv((x + s * 0.04, 0, zg - 0.2), (0.06, 5.0, 0.18)), WHITE)
        xb = s * (4.6 + 0.47)
        for side in (-1, 1):
            path = []
            for k in range(7):
                u = k / 6
                y = side * (2.75 * u)
                zz = zr + 0.1 - (zr - zg + 0.25) * (1 - (1 - u) ** 1.6)
                path.append(V((xb, y, zz + 0.12)))
            path.append(path[-1] + V((0, side * 0.45, 0.05)))
            path.append(path[-1] + V((s * 0.05, side * 0.35, 0.28)))
            acc.add(tube(path, 0.1, n=4, ry=0.3, phase=math.pi / 4, side=(1, 0, 0)), WHITE)
    # ridge with upturned white ends (onigawara)
    acc.add(boxv((0, 0, zr - 0.08), (2 * (4.6 + 0.45) + 0.2, 0.55, 0.42), taper=0.85), TILE)
    acc.add(boxv((0, 0, zr + 0.3), (2 * (4.6 + 0.45) + 0.3, 0.32, 0.1)), '#3e4247')
    for s in (-1, 1):
        x = s * 5.2
        acc.add(tube([V((x - s * 0.3, 0, zr + 0.1)), V((x, 0, zr + 0.22)), V((x + s * 0.25, 0, zr + 0.42)),
                      V((x + s * 0.36, 0, zr + 0.62))], [0.3, 0.28, 0.22, 0.14], n=4,
                     phase=math.pi / 4), WHITE)
    return acc.build('zen_temple')


def zen_pagoda():
    acc = Acc(41)
    rng = acc.rng
    # stone plinth with steps
    acc.add(bevel_box((0, 0, 0), (8.0, 8.0, 0.7), 0.06), TEMPLE_STONE)
    for k in range(3):
        acc.add(boxv((0, -4.0 - 0.25 - k * 0.3, 0), (2.4, 0.3, 0.7 - (k + 1) * 0.22)), TEMPLE_STONE)
    z = 0.7
    storeys = [
        # body half, body height, eave half, roof rise
        (2.9, 3.3, 5.1, 1.1),
        (2.6, 2.55, 4.85, 1.0),
        (2.35, 2.45, 4.6, 0.95),
        (2.1, 2.35, 4.4, 0.9),
        (1.85, 2.25, 4.2, 0.85),
    ]
    for i, (bw, bh, ew, rise) in enumerate(storeys):
        if i > 0:
            # balcony deck and railing above the roof below
            acc.add(boxv((0, 0, z - 0.1), (2 * bw + 1.0, 2 * bw + 1.0, 0.12)), FASCIA)
            r = bw + 0.45
            corners = [(-r, -r), (r, -r), (r, r), (-r, r), (-r, -r)]
            railing(acc, [corners], z, h=0.7, post=0.1, rail=(0.08, 0.1), col=FASCIA, step=1.2)
        zb = z
        acc.add(boxv((0, 0, zb), (2 * bw, 2 * bw, bh)), DARK)
        # posts, lattice panels and beams per face
        n = 3
        for k in range(n + 1):
            x = -bw + 2 * bw * k / n
            for y in (-bw, bw):
                acc.add(boxv((x, y, zb), (0.22, 0.22, bh)), WOOD)
                acc.add(boxv((y, x, zb), (0.22, 0.22, bh)), WOOD)
        for k in range(n):
            xc = -bw + 2 * bw * (k + 0.5) / n
            col = WOOD_D if k != n // 2 else '#2c221f'
            for s in (-1, 1):
                acc.add(boxv((xc, s * (bw + 0.0), zb + 0.15), (2 * bw / n - 0.3, 0.05, bh * 0.62)), col)
                acc.add(boxv((s * (bw + 0.0), xc, zb + 0.15), (0.05, 2 * bw / n - 0.3, bh * 0.62)), col)
        for s in (-1, 1):
            acc.add(boxv((0, s * (bw + 0.03), zb + bh * 0.72), (2 * bw + 0.2, 0.1, 0.16)), WOOD)
            acc.add(boxv((s * (bw + 0.03), 0, zb + bh * 0.72), (0.1, 2 * bw + 0.2, 0.16)), WOOD)
            acc.add(boxv((0, s * (bw + 0.08), zb + bh - 0.32), (2 * bw + 0.5, 0.14, 0.32)), FASCIA)
            acc.add(boxv((s * (bw + 0.08), 0, zb + bh - 0.32), (0.14, 2 * bw + 0.5, 0.32)), FASCIA)
        # bracket band under the eaves
        for k in range(4):
            x = -bw + 2 * bw * k / 3
            for s in (-1, 1):
                acc.add(boxv((x, s * (bw + 0.25), zb + bh - 0.1), (0.35, 0.4, 0.22), taper=1.2), FASCIA)
                acc.add(boxv((s * (bw + 0.25), x, zb + bh - 0.1), (0.4, 0.35, 0.22), taper=1.2), FASCIA)
        ze = zb + bh + 0.1
        top = bw * 0.62 if i < 4 else 0.55
        hip_roof(acc, ew, ew, ze, top, top, ze + rise, 12, 12, rings=4, curve=1.7, thick=0.32,
                 lift=0.85, out=0.45, wall=(bw, bw), soffit_rise=0.05, close_top=True, hip_r=0.1)
        z = ze + rise - 0.05
    # spire (sorin): base block, pole, nine rings, flame and jewel
    acc.add(boxv((0, 0, z - 0.1), (1.1, 1.1, 0.55), taper=0.85), TILE)
    acc.add(cyl((0, 0, z + 0.45), 0.45, 0.35, n=8, r_top=0.3), '#3d3c3a')
    zs = z + 0.8
    acc.add(cyl((0, 0, zs), 0.11, 6.4, n=6, r_top=0.08), '#3d3c3a')
    for k in range(9):
        zz = zs + 0.4 + k * 0.5
        r = 0.42 - k * 0.012
        acc.add(loft([ring((0, 0, zz), r * 0.75, 8), ring((0, 0, zz + 0.09), r, 8),
                      ring((0, 0, zz + 0.18), r * 0.75, 8)]), ['#4a4946', '#43423f'])
    zt = zs + 0.4 + 9 * 0.5
    acc.add(loft([ring((0, 0, zt), 0.1, 6), ring((0, 0, zt + 0.3), 0.32, 6), ring((0, 0, zt + 0.6), 0.1, 6)]),
            '#4a4946')
    acc.add(icov((0, 0, zt + 0.85), 0.22, 1, (1, 1, 1.3)), '#55534f')
    acc.add(cone_vf((0, 0, zt + 1.05), 0.08, 0.5), '#55534f')
    return acc.build('zen_pagoda')


def cone_vf(c, r, h, n=6):
    return loft([ring(c, r, n), [V(c) + V((0, 0, h))]])


def zen_bridge():
    acc = Acc(51)
    L, W, top = 9.0, 2.4, 1.8
    hl = 4.5

    def deck_z(x):
        return 0.12 + (top - 0.12) * math.cos(math.pi / 2 * min(1.0, abs(x) / hl)) ** 1.15

    n = 20
    xs = [-hl + 2 * hl * k / n for k in range(n + 1)]
    # planks: one slab per segment, alternating tones
    for k in range(n):
        xa, xb = xs[k], xs[k + 1]
        za, zb = deck_z(xa), deck_z(xb)
        hw = W / 2 - 0.12
        verts = [V((xa, -hw, za)), V((xb, -hw, zb)), V((xb, hw, zb)), V((xa, hw, za)),
                 V((xa, -hw, za - 0.16)), V((xb, -hw, zb - 0.16)), V((xb, hw, zb - 0.16)), V((xa, hw, za - 0.16))]
        faces = [[0, 1, 2, 3], [7, 6, 5, 4], [0, 4, 5, 1], [1, 5, 6, 2], [2, 6, 7, 3], [3, 7, 4, 0]]
        acc.add((verts, faces), '#e85a3e' if k % 2 else '#c9442d')
    # side girders: deep curved beams forming the drum silhouette
    for s in (-1, 1):
        path = [V((x, s * (W / 2 - 0.05), deck_z(x) - 0.2)) for x in xs]
        acc.add(tube(path, 0.08, n=4, ry=0.3, phase=math.pi / 4, side=(0, 1, 0)), BR_RED_D)
    # railing: posts, curved top rail and mid rail, big end posts with black caps
    rail_y = W / 2 - 0.05
    for s in (-1, 1):
        y = s * rail_y
        for k in range(1, n, 3):
            x = xs[k]
            acc.add(boxv((x, y, deck_z(x) - 0.1), (0.13, 0.13, 1.05)), BR_RED)
        top_path = [V((x, y, deck_z(x) + 0.92)) for x in xs[1:-1]]
        acc.add(tube(top_path, 0.07, n=4, ry=0.08, phase=math.pi / 4, side=(0, 1, 0)), BR_RED)
        mid_path = [V((x, y, deck_z(x) + 0.5)) for x in xs[1:-1]]
        acc.add(tube(mid_path, 0.045, n=4, ry=0.06, phase=math.pi / 4, side=(0, 1, 0)), BR_RED_D)
        for e in (-1, 1):
            x = e * (hl - 0.25)
            zb = deck_z(x) - 0.3
            acc.add(boxv((x, y, zb), (0.3, 0.3, 1.55)), BR_RED)
            acc.add(boxv((x, y, zb + 1.55), (0.34, 0.34, 0.08)), BR_CAP)
            acc.add(boxv((x, y, zb + 1.63), (0.26, 0.26, 0.16), taper=0.8), BR_CAP)
            acc.add(cone_vf((x, y, zb + 1.79), 0.12, 0.12, n=4), BR_CAP)
            acc.add(boxv((x, y, -0.1), (0.42, 0.42, zb + 0.15), taper=0.9), BR_RED_D)
    # piers under the arch (they stand in the water)
    for x in (-2.6, 2.6):
        for s in (-1, 1):
            acc.add(boxv((x, s * (W / 2 - 0.35), -0.6), (0.24, 0.24, deck_z(x) + 0.4)), BR_RED_D)
        acc.add(boxv((x, 0, deck_z(x) - 0.45), (0.24, W - 0.4, 0.22)), BR_RED_D)
    return acc.build('zen_bridge')


def star_pad(c, R, k, rng, tilt=0.0, thick=0.35):
    """Spiky lens of leaves: a star outline with a domed top and shallower bottom."""
    c = V(c)
    ang0 = rng.uniform(0, TAU)
    outline = []
    for i in range(2 * k):
        r = R * (1.0 if i % 2 == 0 else rng.uniform(0.55, 0.7)) * rng.uniform(0.85, 1.1)
        a = ang0 + math.pi * i / k + rng.uniform(-0.12, 0.12)
        outline.append(V((r * math.cos(a), r * math.sin(a), rng.uniform(-0.08, 0.08) * R)))
    top = V((rng.uniform(-0.15, 0.15) * R, rng.uniform(-0.15, 0.15) * R, thick * R))
    bot = V((0, 0, -thick * 0.45 * R))
    m = Matrix.Translation(c) @ Matrix.Rotation(tilt, 4, V((rng.uniform(-1, 1), rng.uniform(-1, 1), 0)).normalized()
                                                  if tilt else V((1, 0, 0)))
    verts = [m @ p for p in outline] + [m @ top, m @ bot]
    n = 2 * k
    faces = [[i, (i + 1) % n, n] for i in range(n)] + [[(i + 1) % n, i, n + 1] for i in range(n)]
    return verts, faces


def maple(name, seed, top_cols, bot_cols, accent=None, accent_p=0.0):
    acc = Acc(seed)
    rng = acc.rng
    # gnarled trunk: a zig-zag column with a flared root
    trunk = [V((0, 0, -0.1)), V((0.05, 0.02, 0.5)), V((0.32, -0.05, 1.2)), V((0.05, 0.1, 1.9)),
             V((-0.25, 0.0, 2.5)), V((-0.1, -0.08, 3.0))]
    acc.add(tube(trunk, [0.42, 0.3, 0.27, 0.25, 0.23, 0.2], n=6), TRUNK)
    for a in (0.3, 2.4, 4.4):  # root flares
        d = V((math.cos(a), math.sin(a), 0))
        acc.add(tube([V((0, 0, 0.45)), d * 0.45 + V((0, 0, 0.08)), d * 0.75 + V((0, 0, -0.05))],
                     [0.16, 0.11, 0.05], n=4), TRUNK)
    tips = []
    branches = [
        # (start index on trunk, direction angle, horizontal reach, end height)
        (3, 0.2, 3.0, 4.4), (3, 2.7, 2.6, 4.0), (4, 1.3, 2.4, 5.2), (4, 4.0, 2.7, 4.9),
        (5, 5.4, 2.4, 5.6), (5, 2.0, 1.8, 6.1), (5, 0.6, 1.3, 6.4), (2, 5.0, 2.3, 3.3),
    ]
    for si, a, reach, hz in branches:
        a += rng.uniform(-0.2, 0.2)
        s = trunk[si]
        d = V((math.cos(a), math.sin(a), 0))
        mid = s + d * reach * 0.45 + V((0, 0, (hz - s.z) * 0.55)) + \
            V((rng.uniform(-0.3, 0.3), rng.uniform(-0.3, 0.3), 0))
        end = s + d * reach + V((0, 0, hz - s.z))
        acc.add(tube([s, mid, end], [0.15, 0.1, 0.05], n=5), TRUNK)
        tips.append(end)
        # a twig off each branch
        tw = mid + (end - mid) * 0.5
        d2 = V((math.cos(a + 1.0), math.sin(a + 1.0), 0.3)).normalized()
        tend = tw + d2 * 1.0
        acc.add(tube([mid, tw + d2 * 0.4, tend], [0.06, 0.045, 0.025], n=4), TRUNK)
        tips.append(tend)

    def leaf_col(c, n):
        if accent and rng.random() < accent_p:
            return rng.choice(accent)
        return rng.choice(top_cols if n.z > 0.15 else bot_cols)

    # layered spiky leaf pads around the branch tips
    for tip in tips:
        for _ in range(7):
            off = V((rng.uniform(-1.0, 1.0), rng.uniform(-1.0, 1.0), rng.uniform(-0.25, 0.3)))
            R = rng.uniform(0.75, 1.15)
            acc.add(star_pad(tip + off, R, rng.choice((5, 6, 7)), rng, tilt=rng.uniform(0, 0.25)), leaf_col)
        # a dark core blob fills the gaps between pads
        acc.add(icov(tip + V((0, 0, -0.1)), 0.95, 1, (1.35, 1.35, 0.6), 0.12, rng),
                lambda c, n: rng.choice(bot_cols))
        off = V((rng.uniform(-1.6, 1.6), rng.uniform(-1.6, 1.6), rng.uniform(-0.6, 0.2)))
        acc.add(star_pad(tip + off, rng.uniform(0.2, 0.32), 5, rng, tilt=rng.uniform(0.2, 0.8), thick=0.2),
                leaf_col)
    return acc.build(name, vary=0.06)


def zen_maple_red():
    return maple('zen_maple_red', 61, MAPLE_RED_TOP, MAPLE_RED_BOT)


def zen_maple_orange():
    return maple('zen_maple_orange', 62, MAPLE_OR_TOP, MAPLE_OR_BOT, accent=MAPLE_OR_RED, accent_p=0.22)


def bamboo_culm(acc, rng, base, height, r, lean, nodes=None):
    """One culm: six-sided, tapering, pale node bands, slight bend toward the tip."""
    nodes = nodes or max(7, int(height / 1.05))
    d = V((math.cos(lean[0]), math.sin(lean[0]), 0)) * lean[1]
    pts, radii, cols = [], [], []
    zs = [0.0]
    for k in range(nodes):
        zs.append(height * ((k + 1) / nodes) ** 0.92)
    rings = []
    for k, z in enumerate(zs):
        t = z / height
        rr = r * (1 - 0.4 * t)
        c = V(base) + d * (t ** 1.6) + V((0, 0, z))
        rings.append(ring(c, rr, 6, phase=0.3 * k))
        if 0 < k < len(zs) - 1:
            rings.append(ring(c + V((0, 0, 0.1)), rr * 1.07, 6, phase=0.3 * k))
    vf = loft(rings, cap0=False, cap1=True)
    faces = vf[1]
    n_body = len(faces)
    # colour: bands between a node ring and its +0.07 ring are pale
    cols = []
    band = 0
    for ri in range(len(rings) - 1):
        pale = ri % 2 == 1 and ri < len(rings) - 1
        for _ in range(6):
            cols.append(rng.choice(BAMBOO_RING) if pale else rng.choice(BAMBOO + BAMBOO_D))
        band += 1
    while len(cols) < n_body:
        cols.append(BAMBOO_D[0])
    it = iter(cols)
    acc.add(vf, lambda c, n: next(it))
    top = V(base) + d + V((0, 0, height))
    return [V(base) + d * (t ** 1.6) + V((0, 0, height * t)) for t in (0.5, 0.6, 0.68, 0.76, 0.84, 0.9, 0.96)], top


def leaf_spray(acc, rng, at, direction, count=6, length=0.5):
    """Lance-shaped leaves fanning down from a twig tip, each a folded diamond (two triangles)."""
    at = V(at)
    for i in range(count):
        a = direction + rng.uniform(-0.9, 0.9)
        droop = rng.uniform(-0.9, -0.25)
        d = V((math.cos(a), math.sin(a), droop)).normalized()
        L = length * rng.uniform(0.75, 1.15)
        side = V((-math.sin(a), math.cos(a), 0)) * L * 0.13
        tip = at + d * L
        mid = at + d * L * 0.4
        fold = V((0, 0, 0.03))
        verts = [at, mid + side, tip, mid - side + fold]
        acc.add((verts, [[0, 1, 2], [0, 2, 3]]), BAMBOO_LEAF, recalc=False)


def zen_bamboo():
    acc = Acc(71)
    rng = acc.rng
    spots = []
    for i in range(10):
        a = i * 2.39996 + rng.uniform(-0.3, 0.3)
        r = 1.2 * math.sqrt((i + 0.5) / 10)
        spots.append((r * math.cos(a), r * math.sin(a), a))
    for i, (x, y, a) in enumerate(spots):
        h = rng.uniform(8.4, 10.0)
        r = rng.uniform(0.12, 0.17)
        sprouts, top = bamboo_culm(acc, rng, (x, y, -0.05), h, r, (a + rng.uniform(-0.4, 0.4), rng.uniform(0.3, 0.8)))
        for j, p in enumerate(sprouts[1:] if i % 2 else sprouts):
            ang = rng.uniform(0, TAU)
            d = V((math.cos(ang), math.sin(ang), 0.35)).normalized()
            twig_end = p + d * rng.uniform(0.35, 0.6)
            acc.add(tube([p, twig_end], [0.018, 0.012], n=3), BAMBOO_D)
            leaf_spray(acc, rng, twig_end, ang, count=rng.randint(6, 8), length=0.62)
        for _ in range(2):
            leaf_spray(acc, rng, top, rng.uniform(0, TAU), count=6, length=0.55)
    for x, y in ((0.7, -0.6), (-0.5, 0.8)):  # cut stumps at the foot
        acc.add(cyl((x, y, -0.05), 0.09, 0.5, n=6), BAMBOO_D)
        acc.add(cyl((x, y, 0.45), 0.092, 0.06, n=6), BAMBOO_RING)
    return acc.build('zen_bamboo', vary=0.04)


def zen_bamboo_fence():
    acc = Acc(81)
    rng = acc.rng
    L = 4.0
    # vertical split-bamboo slats, alternately front and back of the rails (woven)
    ns = 30
    w = (L - 0.16) / ns
    for k in range(ns):
        x = -L / 2 + 0.08 + (k + 0.5) * w
        h = 2.05 + 0.06 * math.sin(k * 1.7) + rng.uniform(-0.03, 0.03)
        y = 0.018 if k % 2 else -0.018
        acc.add(boxv((x, y, 0), (w - 0.012, 0.045, h)), FENCE)
        acc.add(boxv((x, y - 0.024, 0), (w * 0.2, 0.01, h - 0.02)), '#bfa56e')
    # horizontal bamboo rails, both faces, with dark ties
    for z in (0.45, 1.15, 1.8):
        for y in (-0.075, 0.075):
            acc.add(tube([V((-L / 2, y, z)), V((L / 2, y, z))], 0.035, n=6), FENCE_RAIL)
        for k in range(6):
            x = -L / 2 + 0.35 + k * (L - 0.7) / 5
            acc.add(boxv((x, 0, z - 0.04), (0.04, 0.19, 0.08)), FENCE_TIE)
    # end posts: thick culms with pale nodes and a cut cap
    for x in (-L / 2, L / 2):
        rings = []
        cols = []
        zs = [0.0, 0.55, 0.62, 1.25, 1.32, 1.95, 2.02, 2.45]
        for z in zs:
            rings.append(ring((x, 0, z), 0.07 if z not in (0.62, 1.32, 2.02) else 0.075, 6))
        vf = loft(rings, cap0=False, cap1=True)
        for ri in range(len(rings) - 1):
            for _ in range(6):
                cols.append(BAMBOO_RING[0] if ri % 2 == 1 else FENCE_RAIL[ri % 3])
        cols.append('#d8cc9a')
        it = iter(cols)
        acc.add(vf, lambda c, n, it=it: next(it))
    return acc.build('zen_bamboo_fence')


def zen_shrub():
    acc = Acc(91)
    rng = acc.rng

    def col(c, n):
        if n.z < -0.2:
            return rng.choice(SHRUB_D)
        return rng.choice(SHRUB if n.z < 0.55 else SHRUB[1:] + ['#86b552'])

    acc.add(icov((0, 0, 0.62), 0.95, 3, (1.0, 1.0, 0.8), 0.035, rng, floor=0.0), col)
    for i in range(24):
        a = i * 2.39996
        el = math.asin(min(0.97, -0.15 + 1.12 * (i + 0.5) / 24))
        d = V((math.cos(a) * math.cos(el), math.sin(a) * math.cos(el), math.sin(el) * 0.8))
        c = V((0, 0, 0.62)) + d * 0.8
        if c.z < 0.2:
            continue
        acc.add(icov(c, rng.uniform(0.26, 0.34), 2, (1, 1, 0.82), 0.035, rng, floor=0.0), col)
    return acc.build('zen_shrub', vary=0.05)


def zen_azalea():
    acc = Acc(101)
    rng = acc.rng
    leaf = lambda c, n: rng.choice(AZ_LEAF) if n.z > -0.2 else '#34521f'  # noqa: E731
    acc.add(icov((0, 0, 0.6), 0.8, 3, (1.0, 1.0, 0.85), 0.035, rng, floor=0.0), leaf)
    for i in range(10):
        a = i * 2.39996
        c = V((0.6 * math.cos(a), 0.6 * math.sin(a), 0.45 + 0.25 * (i % 3) / 2))
        acc.add(icov(c, rng.uniform(0.22, 0.27), 2, (1, 1, 0.8), 0.03, rng, floor=0.0), leaf)
    # pink flower clusters over the dome
    for i in range(85):
        a = i * 2.39996
        el = math.asin(min(0.97, -0.3 + 1.28 * (i + 0.5) / 85))
        d = V((math.cos(a) * math.cos(el), math.sin(a) * math.cos(el), math.sin(el) * 0.85))
        c = V((0, 0, 0.6)) + d * 0.81
        if c.z < 0.15:
            continue
        cc = rng.choice(AZ_FLOWER)
        nrm = V((d.x, d.y, d.z / 0.85 ** 2)).normalized()
        verts, faces = star_pad((0, 0, 0), rng.uniform(0.11, 0.15), 5, rng, thick=0.45)
        m = Matrix.Translation(c) @ nrm.to_track_quat('Z', 'Y').to_matrix().to_4x4()
        acc.add(([m @ v for v in verts], faces),
                lambda p, n, cc=cc, nrm=nrm: shade(cc, 1.1) if n.dot(nrm) > 0.7 else cc)
    return acc.build('zen_azalea', vary=0.05)


def mossy_rock(acc, rng, c, r, scale, jit, flat_top=None, moss_p=0.25, moss_up=0.35, subdiv=1):
    vf = icov(c, r, subdiv, scale, jit, rng, floor=0.0 if c[2] >= 0 else None)
    verts, faces = vf
    if flat_top is not None:
        for v in verts:
            if v.z > flat_top:
                v.z = flat_top + (v.z - flat_top) * 0.15
    zmax = max(v.z for v in verts)

    def col(p, n):
        if n.z > moss_up or (p.z > zmax * 0.45 and rng.random() < moss_p):
            return rng.choice(MOSS)
        return rng.choice(ROCK)

    acc.add((verts, faces), col)


def zen_rock_moss():
    acc = Acc(111)
    rng = acc.rng
    verts, faces = icov((0, 0, 0.85), 1.0, 2, (0.6, 0.52, 1.12), 0.16, rng)
    for v in verts:
        v.z = max(v.z, -0.08)
        k = 1 - 0.3 * max(0.0, v.z - 0.8)  # narrower, blunter top
        v.x, v.y = v.x * k + 0.08 * v.z, v.y * k
        if v.z > 1.75:
            v.z = 1.75 + (v.z - 1.75) * 0.3
    zmax = max(v.z for v in verts)

    def col(p, n):
        if n.z > 0.4 or (p.z > zmax * 0.35 and rng.random() < 0.3) or (p.z < 0.3 and rng.random() < 0.3):
            return rng.choice(MOSS)
        return rng.choice(ROCK)

    acc.add((verts, faces), col)
    mossy_rock(acc, rng, (0.72, -0.42, 0.12), 0.42, (1.15, 0.95, 0.65), 0.05, moss_p=0.3, subdiv=2)
    return acc.build('zen_rock_moss', vary=0.05)


def zen_rock_low():
    acc = Acc(121)
    rng = acc.rng
    mossy_rock(acc, rng, (0, 0, 0.42), 1.0, (0.95, 0.72, 0.6), 0.13, flat_top=0.78, moss_p=0.15, subdiv=2,
               moss_up=0.7)
    return acc.build('zen_rock_low', vary=0.05)


def zen_gravel_ripples():
    acc = Acc(131)
    rng = acc.rng
    r_in, r_out = 1.0, 5.0
    nr = 6
    base = 0.025
    prof = [(r_in - 0.05, 0.0), (r_in, base + 0.05)]
    spacing = (r_out - 0.55 - r_in) / nr
    for k in range(nr):
        rc = r_in + 0.25 + k * spacing
        prof += [(rc - 0.2, base), (rc, base + 0.09), (rc + 0.2, base)]
    prof += [(r_out - 0.25, base), (r_out, 0.0)]
    seg = 48
    rings = [[V((r * math.cos(TAU * i / seg), r * math.sin(TAU * i / seg), z)) for i in range(seg)]
             for r, z in prof]
    verts, faces = loft(rings, cap0=False, cap1=False)
    cols = []
    for k in range(len(rings) - 1):
        r0, z0 = prof[k]
        r1, z1 = prof[k + 1]
        for i in range(seg):
            if z1 > z0 + 0.02:
                cols.append(rng.choice(GRAVEL))  # rising, lit side of a ridge
            elif z0 > z1 + 0.02:
                cols.append(rng.choice(GRAVEL_S))  # falling side: the raked groove shadow
            else:
                cols.append(rng.choice(GRAVEL))
    faces = [f[::-1] for f in faces]  # face up
    it = iter(cols)
    acc.add((verts, faces), lambda c, n: next(it), recalc=False)
    return acc.build('zen_gravel_ripples', vary=0.015)


def zen_gravel_lines():
    acc = Acc(141)
    rng = acc.rng
    hx, hy = 5.0, 3.0
    base = 0.025
    nr = 11
    prof = [(-hy, 0.0), (-hy + 0.2, base)]
    sp = (2 * hy - 0.4) / nr
    for k in range(nr):
        yc = -hy + 0.2 + (k + 0.5) * sp
        prof += [(yc - sp * 0.42, base), (yc, base + 0.09), (yc + sp * 0.42, base)]
    prof += [(hy - 0.2, base), (hy, 0.0)]
    nx = 10
    P = [[V((-hx + 2 * hx * i / nx, y, z)) for i in range(nx + 1)] for y, z in prof]
    verts = [p for row in P for p in row]
    faces, cols = [], []
    for j in range(len(prof) - 1):
        z0, z1 = prof[j][1], prof[j + 1][1]
        for i in range(nx):
            a = j * (nx + 1) + i
            faces.append([a, a + 1, a + nx + 2, a + nx + 1])
            cols.append(rng.choice(GRAVEL_S) if z0 > z1 + 0.02 else rng.choice(GRAVEL))
    it = iter(cols)
    acc.add((verts, faces), lambda c, n: next(it), recalc=False)
    for x in (-hx, hx):  # end caps (hidden when tiled)
        cap = [V((x, y, z)) for y, z in prof]
        acc.add((cap, [list(range(len(cap)))[::-1] if x > 0 else list(range(len(cap)))]), GRAVEL_S[0],
                recalc=False)
    return acc.build('zen_gravel_lines', vary=0.015)


def step_stone(acc, rng, c, sx, sy, rz, h=0.16):
    n = 8
    outline = []
    for i in range(n):
        a = TAU * (i + 0.5) / n + rng.uniform(-0.12, 0.12)
        rr = rng.uniform(0.88, 1.05)
        outline.append((sx * rr * math.cos(a), sy * rr * math.sin(a)))
    m = Matrix.Translation(V(c)) @ Matrix.Rotation(rz, 4, 'Z')
    bot = [m @ V((x, y, -0.06)) for x, y in outline]
    top = [m @ V((x * 0.9, y * 0.9, h + rng.uniform(-0.015, 0.015))) for x, y in outline]
    inner = [m @ V((x * 0.5, y * 0.5, h + 0.02)) for x, y in outline]
    centre = [m @ V((0, 0, h + 0.025))]
    vf = loft([bot, top, inner, centre], cap0=True, cap1=False)

    def col(p, nrm):
        d = (p - m @ V((0, 0, 0))).length / max(sx, sy)
        if nrm.z < 0.6:
            return rng.choice(MOSS) if rng.random() < 0.75 else rng.choice(ROCK)
        if d > 0.55:
            return rng.choice(MOSS) if rng.random() < 0.65 else rng.choice(ROCK[:3])
        return rng.choice(MOSS) if rng.random() < 0.15 else rng.choice(['#a3a49c', '#9a9b93', '#aaaaa2'])

    acc.add(vf, col)


def zen_stepping_stones():
    acc = Acc(151)
    rng = acc.rng
    for k in range(5):
        t = k / 4
        x = -2.6 + 5.2 * t
        y = 0.7 * math.sin(math.pi * t * 1.2 - 0.4)
        step_stone(acc, rng, (x, y, 0), rng.uniform(0.5, 0.6), rng.uniform(0.34, 0.42),
                   0.5 * math.cos(math.pi * t * 1.2) + rng.uniform(-0.2, 0.2))
    return acc.build('zen_stepping_stones', vary=0.04)


def zen_terrace_wall():
    acc = Acc(161)
    rng = acc.rng
    L, H = 8.0, 2.0
    # core (the dark mortar gaps between stones), battered back
    acc.add(loft([[V((-L / 2, -0.55, 0)), V((L / 2, -0.55, 0)), V((L / 2, 0.6, 0)), V((-L / 2, 0.6, 0))],
                  [V((-L / 2, -0.4, H)), V((L / 2, -0.4, H)), V((L / 2, 0.6, H)), V((-L / 2, 0.6, H))]]),
            WALL_CORE)
    courses = [0.0, 0.52, 1.02, 1.5, H - 0.04]
    for ci in range(len(courses) - 1):
        z0, z1 = courses[ci], courses[ci + 1]
        x = -L / 2 + (0 if ci % 2 == 0 else -0.45)
        while x < L / 2 - 0.05:
            w = rng.uniform(0.75, 1.3)
            xa, xb = max(x, -L / 2), min(x + w, L / 2)
            if xb - xa > 0.2:
                zc = z0
                yf = -0.55 + 0.15 * (zc / H)
                hgt = z1 - z0 - 0.04
                acc.add(bevel_box(((xa + xb) / 2, yf + 0.25, zc), (xb - xa - 0.05, 0.6, hgt), 0.06, jit=0.025,
                                  rng=rng),
                        lambda p, n: rng.choice(MOSS) if n.z > 0.6 and rng.random() < 0.45 else rng.choice(WALL))
            x += w
    # mossy grass cap overhanging the front, with clumps spilling over
    nx = 16
    P = []
    for j, (y, z) in enumerate(((-0.55, H - 0.12), (-0.42, H + 0.02), (0.0, H + 0.05), (0.65, H))):
        row = []
        for i in range(nx + 1):
            x = -L / 2 + L * i / nx
            dz = 0.0 if j in (0, 3) or i in (0, nx) else rng.uniform(-0.03, 0.05)
            row.append(V((x, y + (rng.uniform(-0.06, 0.04) if j == 0 and 0 < i < nx else 0), z + dz)))
        P.append(row)
    top, bot, edges = grid_slab(P, 0.12)
    acc.add(top, GRASS, recalc=False)
    acc.add(bot, SOIL, recalc=False)
    acc.add(edges, GRASS[2], recalc=False)
    for k in range(11):
        x = -L / 2 + 0.4 + k * (L - 0.8) / 10 + rng.uniform(-0.2, 0.2)
        acc.add(icov((x, -0.52, H - 0.12), rng.uniform(0.18, 0.26), 1, (1.6, 0.9, 0.7), 0.03, rng), GRASS)
    return acc.build('zen_terrace_wall', vary=0.04)


def koi_fish(acc, rng, c, heading, length, pattern, bend):
    c = V(c)
    n = 7
    spine = []
    for k in range(n):
        t = k / (n - 1)
        a = heading + bend * (t - 0.3) ** 2 * 2.0
        spine.append(t)
    pts = []
    x = 0.0
    p = V((0, 0, 0))
    d0 = V((math.cos(heading), math.sin(heading), 0))
    for k in range(n):
        t = k / (n - 1)
        a = heading + math.pi + bend * t * t
        if k:
            p = p + V((math.cos(a), math.sin(a), 0)) * length / (n - 1)
        pts.append(p.copy())
    widths = [0.02, 0.09, 0.12, 0.11, 0.08, 0.05, 0.025]
    heights = [0.02, 0.06, 0.075, 0.07, 0.05, 0.03, 0.02]
    rings = []
    for k, q in enumerate(pts):
        if k == 0:
            t = pts[1] - pts[0]
        else:
            t = pts[k] - pts[k - 1]
        t = V((t.x, t.y, 0)).normalized()
        side = V((-t.y, t.x, 0))
        w, h = widths[k] * length / 0.65, heights[k] * length / 0.65
        rings.append([c + q + side * math.cos(TAU * i / 6) * w + V((0, 0, math.sin(TAU * i / 6) * h))
                      for i in range(6)])
    vf = loft([[c + pts[0] - (pts[1] - pts[0]).normalized() * 0.03]] + rings, cap0=False, cap1=True)

    def col(p, nrm):
        u = (p - (c + pts[0])).length / length
        return pattern(u, p, nrm)

    acc.add(vf, col)
    # tail fin, pectoral fins, dorsal fin
    tail0 = c + pts[-1]
    tdir = (pts[-1] - pts[-2]).normalized()
    side = V((-tdir.y, tdir.x, 0))
    tl = length * 0.3
    fin = [tail0, tail0 + tdir * tl + side * tl * 0.55, tail0 + tdir * tl * 0.6,
           tail0 + tdir * tl - side * tl * 0.55]
    acc.add((fin, [[0, 1, 2], [0, 2, 3]]), KOI_W[0] if pattern(0.9, tail0, V((0, 0, 1))) != KOI_GOLD[0]
            else KOI_GOLD[1], recalc=False)
    hd = (pts[1] - pts[0]).normalized()
    hs = V((-hd.y, hd.x, 0))
    for s in (-1, 1):
        b = c + pts[2] + hs * s * 0.1 * length / 0.65
        acc.add(([b, b + hs * s * 0.12 * length + hd * 0.06 * length, b + hd * 0.12 * length], [[0, 1, 2]]),
                KOI_W[1], recalc=False)
    db = c + pts[2] + V((0, 0, heights[2] * length / 0.65))
    acc.add(([db, c + pts[4] + V((0, 0, heights[4] * length / 0.65)), db + (pts[3] - pts[2]) + V((0, 0, 0.05))],
             [[0, 1, 2]]), KOI_OR[1], recalc=False)


def zen_koi():
    acc = Acc(171)
    rng = acc.rng

    def kohaku(u, p, n):
        return KOI_OR[0] if (0.08 < u < 0.32 or 0.45 < u < 0.7) and n.z > -0.3 else rng.choice(KOI_W)

    def sanke(u, p, n):
        if 0.5 < u < 0.6 and n.z > 0.3:
            return KOI_K
        return KOI_OR[1] if (0.1 < u < 0.42 or 0.66 < u < 0.82) and n.z > -0.3 else rng.choice(KOI_W)

    def ogon(u, p, n):
        return rng.choice(KOI_GOLD) if n.z > -0.4 else KOI_W[1]

    koi_fish(acc, rng, (-0.55, -0.25, -0.1), 0.4, 0.7, kohaku, 0.5)
    koi_fish(acc, rng, (0.45, 0.35, -0.12), 2.6, 0.62, sanke, -0.6)
    koi_fish(acc, rng, (0.25, -0.65, -0.14), -0.6, 0.55, ogon, 0.4)
    return acc.build('zen_koi', vary=0.03)


def zen_temple_steps():
    acc = Acc(181)
    rng = acc.rng
    W, rise, run = 3.0, 1.5, 3.0
    n = 5
    for k in range(n):
        y0 = -run / 2 + k * run / n
        top = (k + 1) * rise / n
        acc.add(bevel_box((rng.uniform(-0.03, 0.03), (y0 + run / 2) / 2, 0), (W, run / 2 - y0 + 0.02, top),
                          0.03, jit=0.01, rng=rng),
                lambda p, nn: rng.choice(MOSS) if nn.z > 0.6 and abs(p.x) > 1.25 and rng.random() < 0.5
                else rng.choice(TEMPLE_STONE if nn.z > 0.5 else ['#8f8d86', '#96948d']))
    for s in (-1, 1):  # cheek walls
        prof = [(-run / 2, 0.0), (-run / 2, 0.42), (run / 2, rise + 0.22), (run / 2, 0.0)]
        x = s * (W / 2 + 0.17)
        verts = [V((x + dx, y, z)) for dx in (-0.17, 0.17) for y, z in prof]
        faces = [[0, 1, 2, 3], [7, 6, 5, 4], [0, 4, 5, 1], [1, 5, 6, 2], [2, 6, 7, 3], [3, 7, 4, 0]]
        acc.add((verts, faces), lambda p, nn: rng.choice(MOSS) if nn.z > 0.5 and rng.random() < 0.4
                else rng.choice(['#9d9b94', '#a6a49c']))
    return acc.build('zen_temple_steps', vary=0.03)


# --- registry ----------------------------------------------------------------------------------

BUILDERS = {
    'zen_torii': zen_torii,
    'zen_lantern': zen_lantern,
    'zen_temple': zen_temple,
    'zen_pagoda': zen_pagoda,
    'zen_bridge': zen_bridge,
    'zen_maple_red': zen_maple_red,
    'zen_maple_orange': zen_maple_orange,
    'zen_bamboo': zen_bamboo,
    'zen_bamboo_fence': zen_bamboo_fence,
    'zen_shrub': zen_shrub,
    'zen_azalea': zen_azalea,
    'zen_rock_moss': zen_rock_moss,
    'zen_rock_low': zen_rock_low,
    'zen_gravel_ripples': zen_gravel_ripples,
    'zen_gravel_lines': zen_gravel_lines,
    'zen_stepping_stones': zen_stepping_stones,
    'zen_terrace_wall': zen_terrace_wall,
    'zen_koi': zen_koi,
    'zen_temple_steps': zen_temple_steps,
}
LANDMARKS = {'zen_torii', 'zen_temple', 'zen_pagoda', 'zen_bridge'}
CAPS = {name: (10000 if name in LANDMARKS else 4000) for name in BUILDERS}

# Game-space metadata (y up). Colliders are centred on the pivot, resting on the ground.
META = {
    'zen_torii': dict(collider={'kind': 'none'}, footprint=4.6,
                      notes='Gate: walk through along game Z. Two pillar cylinders (r 0.56, h 7.2) at x=+-2.35 '
                            'would be the right collider; a single box would block the opening, so none.'),
    'zen_lantern': dict(collider={'kind': 'box', 'half': [0.5, 1.2, 0.5]}, footprint=1.0,
                        notes='Stone toro lantern; pairs either side of paths, gates and the temple steps.'),
    'zen_temple': dict(collider={'kind': 'box', 'half': [6.9, 4.8, 4.6]}, footprint=9.5,
                       notes='Hall with veranda; front steps reach game z=+6.3 (toward the player). The box '
                             'covers the plinth and hall, not the steps or eaves.'),
    'zen_pagoda': dict(collider={'kind': 'box', 'half': [4.0, 12.0, 4.0]}, footprint=6.5,
                       notes='Five-roof pagoda on an 8 m plinth; eaves reach 5.6 m out. Stand it behind the '
                             'temple, uphill.'),
    'zen_bridge': dict(collider={'kind': 'none'}, footprint=5.0,
                       notes='Taiko drum bridge spanning game X (9 m), deck 2.2 m wide, arch top 1.8 m. Walkable: '
                             'needs a trimesh or a ramp pair, not a box. Place over a pond; piers go 0.6 m below.'),
    'zen_maple_red': dict(collider={'kind': 'cylinder', 'radius': 0.35, 'height': 3.0}, footprint=3.5,
                          notes='Crimson Japanese maple; trunk collider only. Lean over gravel, gates and ponds.'),
    'zen_maple_orange': dict(collider={'kind': 'cylinder', 'radius': 0.35, 'height': 3.0}, footprint=3.5,
                             notes='Orange/amber maple with red accents; beside the temple and the fence line.'),
    'zen_bamboo': dict(collider={'kind': 'cylinder', 'radius': 1.2, 'height': 9.0}, footprint=2.0,
                       notes='Cluster of 10 culms; repeat in clumps (random yaw) for a dense grove behind fences.'),
    'zen_bamboo_fence': dict(collider={'kind': 'box', 'half': [2.0, 1.2, 0.1]}, footprint=2.1,
                             notes='4 m segment along game X; tiles end to end (shared end posts at x=+-2).'),
    'zen_shrub': dict(collider={'kind': 'cylinder', 'radius': 0.8, 'height': 1.4}, footprint=1.1,
                      notes='Clipped round shrub; along the fence, the veranda and gravel edges.'),
    'zen_azalea': dict(collider={'kind': 'cylinder', 'radius': 0.7, 'height': 1.2}, footprint=1.0,
                       notes='Pink-flowering azalea; pair with zen_shrub, sparingly.'),
    'zen_rock_moss': dict(collider={'kind': 'cylinder', 'radius': 0.6, 'height': 2.0}, footprint=1.4,
                          notes='Standing rock; set in the centre gap of zen_gravel_ripples.'),
    'zen_rock_low': dict(collider={'kind': 'box', 'half': [0.9, 0.45, 0.65]}, footprint=1.2,
                         notes='Low flat-topped mossy rock; ripple centres, pond edges.'),
    'zen_gravel_ripples': dict(collider={'kind': 'none'}, footprint=5.0,
                               notes='Ground dressing, 0.12 m max. 2 m central gap for a rock. Lay on flat '
                                     'ground slightly above the terrain (+0.01).'),
    'zen_gravel_lines': dict(collider={'kind': 'none'}, footprint=5.0,
                             notes='10 x 6 m raked rectangle, ridges along game X; tiles end to end along X.'),
    'zen_stepping_stones': dict(collider={'kind': 'none'}, footprint=3.0,
                                notes='Five mossy stones on a gentle S-curve along game X; walkable dressing.'),
    'zen_terrace_wall': dict(collider={'kind': 'box', 'half': [4.0, 1.0, 0.6]}, footprint=4.0,
                             notes='Retaining wall, face toward +Z (the player), 8 m along X; tiles end to end. '
                                   'Terrain behind sits at the 2 m top.'),
    'zen_koi': dict(collider={'kind': 'none'}, footprint=1.0,
                    notes='Decorative: pivot is the water surface; fish sit 0.1 m below it. Place at the pond '
                          'water level, under the water sheet.'),
    'zen_temple_steps': dict(collider={'kind': 'none'}, footprint=2.0,
                             notes='3 m wide, rises 1.5 m over 3 m toward game -Z (bottom step faces +Z). Walkable: '
                                   'use a ramp collider.'),
}


def bounds_size(obj):
    xs = [v.co.x for v in obj.data.vertices]
    ys = [v.co.y for v in obj.data.vertices]
    zs = [v.co.z for v in obj.data.vertices]
    return [round(max(xs) - min(xs), 2), round(max(zs) - min(zs), 2), round(max(ys) - min(ys), 2)]


def write_props(sizes):
    path = os.path.join(OUT, 'props.json')
    old = {}
    if os.path.exists(path):
        with open(path) as f:
            old = json.load(f)
    out = {}
    for name in BUILDERS:
        size = sizes.get(name) or old.get(name, {}).get('size')
        if size is None:
            continue
        m = META[name]
        out[name] = {'landmark': name in LANDMARKS, 'collider': m['collider'], 'footprint': m['footprint'],
                     'size': size, 'notes': m['notes']}
    with open(path, 'w') as f:
        json.dump(out, f, indent=2)
        f.write('\n')


# --- contact sheet -----------------------------------------------------------------------------

def _glyphs():
    # 5x7 bitmap font for lowercase, digits and underscore (rows top to bottom)
    g = {
        'a': ['00000', '00000', '01110', '00001', '01111', '10001', '01111'],
        'b': ['10000', '10000', '11110', '10001', '10001', '10001', '11110'],
        'c': ['00000', '00000', '01110', '10000', '10000', '10001', '01110'],
        'd': ['00001', '00001', '01111', '10001', '10001', '10001', '01111'],
        'e': ['00000', '00000', '01110', '10001', '11111', '10000', '01110'],
        'f': ['00110', '01001', '01000', '11100', '01000', '01000', '01000'],
        'g': ['00000', '01111', '10001', '10001', '01111', '00001', '01110'],
        'h': ['10000', '10000', '10110', '11001', '10001', '10001', '10001'],
        'i': ['00100', '00000', '01100', '00100', '00100', '00100', '01110'],
        'j': ['00010', '00000', '00110', '00010', '00010', '10010', '01100'],
        'k': ['10000', '10000', '10010', '10100', '11000', '10100', '10010'],
        'l': ['01100', '00100', '00100', '00100', '00100', '00100', '01110'],
        'm': ['00000', '00000', '11010', '10101', '10101', '10001', '10001'],
        'n': ['00000', '00000', '10110', '11001', '10001', '10001', '10001'],
        'o': ['00000', '00000', '01110', '10001', '10001', '10001', '01110'],
        'p': ['00000', '00000', '11110', '10001', '11110', '10000', '10000'],
        'q': ['00000', '00000', '01111', '10001', '01111', '00001', '00001'],
        'r': ['00000', '00000', '10110', '11001', '10000', '10000', '10000'],
        's': ['00000', '00000', '01111', '10000', '01110', '00001', '11110'],
        't': ['01000', '01000', '11100', '01000', '01000', '01001', '00110'],
        'u': ['00000', '00000', '10001', '10001', '10001', '10011', '01101'],
        'v': ['00000', '00000', '10001', '10001', '10001', '01010', '00100'],
        'w': ['00000', '00000', '10001', '10001', '10101', '10101', '01010'],
        'x': ['00000', '00000', '10001', '01010', '00100', '01010', '10001'],
        'y': ['00000', '00000', '10001', '10001', '01111', '00001', '01110'],
        'z': ['00000', '00000', '11111', '00010', '00100', '01000', '11111'],
        '_': ['00000', '00000', '00000', '00000', '00000', '00000', '11111'],
        ' ': ['00000'] * 7,
    }
    for d, rows in zip('0123456789', [
        ['01110', '10001', '10011', '10101', '11001', '10001', '01110'],
        ['00100', '01100', '00100', '00100', '00100', '00100', '01110'],
        ['01110', '10001', '00001', '00010', '00100', '01000', '11111'],
        ['11110', '00001', '00001', '01110', '00001', '00001', '11110'],
        ['00010', '00110', '01010', '10010', '11111', '00010', '00010'],
        ['11111', '10000', '11110', '00001', '00001', '10001', '01110'],
        ['00110', '01000', '10000', '11110', '10001', '10001', '01110'],
        ['11111', '00001', '00010', '00100', '01000', '01000', '01000'],
        ['01110', '10001', '10001', '01110', '10001', '10001', '01110'],
        ['01110', '10001', '10001', '01111', '00001', '00010', '01100'],
    ]):
        g[d] = rows
    return g


def contact_sheet():
    import numpy as np
    names = [n for n in BUILDERS if os.path.exists(os.path.join(OUT, 'preview', f'{n}_three_quarter.png'))]
    cols, cell, label_h = 5, 360, 34
    rows = (len(names) + cols - 1) // cols
    sheet = np.ones(((cell + label_h) * rows, cell * cols, 4), dtype=np.float32)
    sheet[..., :3] = 0.16
    glyphs = _glyphs()
    for k, name in enumerate(names):
        img = bpy.data.images.load(os.path.join(OUT, 'preview', f'{name}_three_quarter.png'))
        w, h = img.size
        px = np.array(img.pixels[:], dtype=np.float32).reshape(h, w, 4)[::-1]  # top row first
        f = max(1, w // cell)
        px = px[:cell * f, :cell * f].reshape(cell, f, cell, f, 4).mean(axis=(1, 3))
        r, c = divmod(k, cols)
        y0, x0 = r * (cell + label_h), c * cell
        sheet[y0:y0 + cell, x0:x0 + cell] = px
        # label
        text = name.replace('zen_', '')
        tris = TRIS.get(name)
        if tris:
            text += f' {tris}'
        s = 3
        tx, ty = x0 + 10, y0 + cell + 6
        for ch in text:
            rows_ = glyphs.get(ch, glyphs[' '])
            for gy, row in enumerate(rows_):
                for gx, bit in enumerate(row):
                    if bit == '1':
                        sheet[ty + gy * s:ty + gy * s + s, tx + gx * s:tx + gx * s + s, :3] = 0.92
            tx += 6 * s
        bpy.data.images.remove(img)
    out = bpy.data.images.new('kit_sheet', sheet.shape[1], sheet.shape[0], alpha=True)
    out.pixels[:] = sheet[::-1].ravel()
    out.filepath_raw = os.path.join(OUT, 'preview', '_kit_sheet.png')
    out.file_format = 'PNG'
    out.save()
    print('ENVKIT zen/_kit_sheet.png')


TRIS = {}

# A garden laid out like the concept (name, x, y, yaw degrees), for checking the kit together.
SCENE = [
    ('zen_gravel_ripples', 0, 0, 0), ('zen_rock_moss', 0, 0, 20), ('zen_gravel_ripples', -7, 9, 0),
    ('zen_rock_low', -7, 9, 0), ('zen_gravel_ripples', 4, 11, 0), ('zen_rock_low', 4, 11, 70),
    ('zen_gravel_lines', 0, 7, 0), ('zen_torii', -10, -3, 8), ('zen_lantern', -4.5, -5, 10),
    ('zen_lantern', -15, -1, 0), ('zen_temple', 2, 24, 0), ('zen_pagoda', -6, 36, 10),
    ('zen_maple_orange', 14, 21, 0), ('zen_maple_red', -16, -9, 0), ('zen_maple_red', -20, 22, 40),
    ('zen_bamboo', 21, 17, 0), ('zen_bamboo', 24, 13, 120), ('zen_bamboo', 25, 21, 240),
    ('zen_bamboo_fence', 15, 14, 0), ('zen_bamboo_fence', 19, 14, 0), ('zen_bamboo_fence', 23, 14, 0),
    ('zen_shrub', 15, 12.5, 0), ('zen_azalea', 19, 11, 0), ('zen_shrub', -4, 17, 0), ('zen_azalea', -7, 17, 0),
    ('zen_bridge', 16, -1, -15), ('zen_koi', 13, 1.5, 30), ('zen_stepping_stones', 8, -6, 0),
    ('zen_terrace_wall', -18, 6, 90), ('zen_terrace_wall', -18, 14, 90), ('zen_temple_steps', -15, 18, 90),
]


def scene_render():
    from math import radians
    ek.reset()
    scene = bpy.context.scene
    ground = bpy.data.meshes.new('ground')
    ground.from_pydata([(-60, -40, 0), (60, -40, 0), (60, 70, 0), (-60, 70, 0)], [], [(0, 1, 2, 3)])
    g = bpy.data.objects.new('ground', ground)
    scene.collection.objects.link(g)
    ek.paint(g, '#76a040')
    pond = bpy.data.meshes.new('pond')
    pond.from_pydata([(9, -5, 0.03), (21, -5, 0.03), (21, 5, 0.03), (9, 5, 0.03)], [], [(0, 1, 2, 3)])
    w = bpy.data.objects.new('pond', pond)
    scene.collection.objects.link(w)
    ek.paint(w, '#3f7f86')
    for name, x, y, yaw in SCENE:
        path = os.path.join(OUT, f'{name}.glb')
        if not os.path.exists(path):
            continue
        before = set(bpy.data.objects)
        bpy.ops.import_scene.gltf(filepath=path)
        for o in set(bpy.data.objects) - before:
            if o.parent is None:
                o.location = (x, y, 0.05 if name == 'zen_koi' else 0.0)
                o.rotation_euler = (0, 0, radians(yaw))
    preview_look()
    sh = scene.display.shading
    scene.render.engine = 'BLENDER_WORKBENCH'
    sh.light, sh.color_type, sh.show_shadows = 'STUDIO', 'VERTEX', True
    sh.background_type = 'WORLD'
    scene.world = scene.world or bpy.data.worlds.new('World')
    scene.world.color = (0.62, 0.7, 0.78)
    scene.render.resolution_x, scene.render.resolution_y = 1456, 823
    cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam'))
    cam.data.lens = 26
    scene.collection.objects.link(cam)
    scene.camera = cam
    cam.location = V((-2, -30, 13))
    cam.rotation_euler = (V((3, 12, 4)) - cam.location).to_track_quat('-Z', 'Y').to_euler()
    scene.render.filepath = os.path.join(OUT, 'preview', '_kit_scene.png')
    bpy.ops.render.render(write_still=True)
    print('ENVKIT zen/_kit_scene.png')


def preview_look():
    # Standard view transform, so the preview shows the flat colours the game will (not AgX's).
    vs = bpy.context.scene.view_settings
    try:
        vs.view_transform = 'Standard'
    except TypeError:
        pass
    vs.look = 'None'


def main():
    wanted = ek.only_args()
    views = tuple(os.environ.get('ZEN_VIEWS', 'three_quarter').split(','))
    sizes = {}
    for name, fn in BUILDERS.items():
        if wanted and name not in wanted:
            continue
        ek.reset()
        obj = fn()
        _, tris = ek.export_prop(obj, KIT, name, CAPS[name])
        TRIS[name] = tris
        sizes[name] = bounds_size(obj)
        preview_look()
        ek.render_preview(obj, KIT, name, views=views)
    if sizes:
        write_props(sizes)
    if not wanted or '_sheet' in wanted:
        if not TRIS:
            # sheet only: read triangle counts back from the GLBs is not needed; leave labels bare
            pass
        ek.reset()
        contact_sheet()
    if not wanted or '_scene' in wanted:
        scene_render()


if __name__ == '__main__':
    main()
