"""
Waterfalls environment kit (concept: docs/concepts/waterfalls.webp).

Towering faceted basalt-column cliffs, white/pale-blue streaked falls, stepped cascades, mist, a
rainbow, glowing blue crystals at the pool edge, stone rim slabs and steps, ferns, hanging vines,
a sagging rope bridge and tall cliff-top pines. Semi-low-poly, flat-shaded vertex colours.

Run (from the repo root):
    /Applications/Blender.app/Contents/MacOS/Blender --background --factory-startup \
        --python art/tools/env/waterfalls.py [-- prop_name ... | -- --sheet]

Writes art/source/env/waterfalls/<prop>.glb, preview PNGs, props.json, and (with --sheet or a full
build) preview/_kit_sheet.png. Deterministic: every random draw comes from a seeded Random.

Water UVs: the glTF exporter stores V as 1 - (Blender v), so ribbons write Blender v = 1 - V where
V runs from 0 at the top of the flow and grows downstream (10 m of flow per V unit; wf_fall_tall is
exactly 4 repeats top to bottom). The game scrolls V on the fx_water material.
"""
import json
import math
import os
import random
import sys

import bmesh
import bpy
from mathutils import Matrix, Vector

sys.dont_write_bytecode = True
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import envkit as ek  # noqa: E402

KIT = 'waterfalls'
OUT = os.path.join(ek.SOURCE, KIT)
M_PER_V = 10.0  # metres of flow per V unit on water ribbons

# --- palette (sampled from the concept, then evened out into flat bands) ----------------------

BASALT = {'top': '#8f9199', 'bevel': '#b3b4bb', 'lit': '#72757e', 'mid': '#5a5d67',
          'dark': '#42454f', 'deep': '#2b2e37'}
MOSS = {'lit': '#9aae4c', 'mid': '#7a933a', 'dark': '#5a742d'}
FERN = ('#6f9a35', '#7fa83c', '#5e8a2e', '#8db646', '#4f7a28')
LEAF = ('#6e9440', '#86aa50', '#587a34', '#9cbc5e', '#4c6e2e')
WATER = {'white': '#f6fafc', 'pale': '#e0edf3', 'blue': '#bcd8e5', 'teal': '#93cfd1',
         'shadow': '#9bbdd2', 'deep': '#7fb0c4'}
MIST = ('#f8fafb', '#eff3f6', '#e5ebf0', '#dbe3ea')
CRYSTAL = {'hi': '#e2fbff', 'lit': '#a3ecff', 'mid': '#66c8f8', 'dark': '#4194f0',
           'deep': '#346bd8'}
STEP = {'top': ('#cfc4a2', '#c2b897', '#d6caa5', '#b9b29b'), 'riser': ('#9a927d', '#8c8572'),
        'side': '#77726a', 'gap': '#33312c'}
SLAB = {'top': ('#b9b4a2', '#aaa89b', '#c2b68c', '#9c9e9a', '#8b9091', '#b3aa88'),
        'side': ('#4b5054', '#3c4246'), 'ground': '#3d4636'}
PINE = {'lit': '#467654', 'top': '#38654a', 'mid': '#2c5240', 'dark': '#203e33',
        'under': '#18302a', 'trunk': '#86553a', 'trunk_d': '#673f2d'}
BRIDGE = {'plank': ('#4b4139', '#574b40', '#3f3631', '#625446'), 'rope': '#b59b6b',
          'rope_d': '#9a8258', 'post': '#6b5238', 'post_d': '#54402c'}
RAINBOW = ('#f07878', '#f5ad6a', '#f3e27a', '#8fdb86', '#7ac4f0', '#8b8fe8', '#b98ae0')


def tint(h, f):
    h = h.lstrip('#')
    rgb = [min(255, max(0, round(int(h[i:i + 2], 16) * f))) for i in (0, 2, 4)]
    return '#%02x%02x%02x' % tuple(rgb)


def mixc(a, b, t):
    a, b = a.lstrip('#'), b.lstrip('#')
    rgb = [round(int(a[i:i + 2], 16) * (1 - t) + int(b[i:i + 2], 16) * t) for i in (0, 2, 4)]
    return '#%02x%02x%02x' % tuple(rgb)


# --- mesh builder: one object per prop, per-face colour, material and UVs ----------------------

class MB:
    def __init__(self):
        self.V, self.F, self.C, self.M, self.U = [], [], [], [], []

    def v(self, co):
        self.V.append(Vector(co))
        return len(self.V) - 1

    def vs(self, cos):
        return [self.v(c) for c in cos]

    def f(self, idx, col, mat='kit', uv=None):
        self.F.append(list(idx))
        self.C.append(col)
        self.M.append(mat)
        self.U.append(uv)

    def nrm(self, idx):
        n = Vector((0, 0, 0))
        pts = [self.V[i] for i in idx]
        for a, b in zip(pts, pts[1:] + pts[:1]):
            n.x += (a.y - b.y) * (a.z + b.z)
            n.y += (a.z - b.z) * (a.x + b.x)
            n.z += (a.x - b.x) * (a.y + b.y)
        return n.normalized() if n.length > 1e-12 else Vector((0, 0, 1))

    def tris(self):
        return sum(len(f) - 2 for f in self.F)

    def obj(self, name):
        me = bpy.data.meshes.new(name)
        me.from_pydata([tuple(v) for v in self.V], [], self.F)
        slots, order = {}, []
        for m in self.M:
            if m not in slots:
                slots[m] = len(order)
                order.append(m)
        makers = {'kit': ek.mat_kit, 'water': ek.mat_water, 'glow': ek.mat_glow}
        for m in order:
            me.materials.append(makers[m]())
        col = me.color_attributes.new('Col', 'FLOAT_COLOR', 'CORNER')
        uvl = me.uv_layers.new(name='UVMap')
        cache = {}
        for p, c, m, uv in zip(me.polygons, self.C, self.M, self.U):
            p.material_index = slots[m]
            rgba = cache.get(c) or cache.setdefault(c, ek.hex_rgb(c))
            for k, li in enumerate(p.loop_indices):
                col.data[li].color = rgba
                uvl.data[li].uv = uv[k] if uv else (0.0, 0.0)
        me.update()
        obj = bpy.data.objects.new(name, me)
        bpy.context.scene.collection.objects.link(obj)
        return obj


def R(seed):
    return random.Random(seed)


# --- basalt ------------------------------------------------------------------------------------

def rock_col(n, rng, pal=BASALT, moss=0.0, tf=1.0):
    if n.z > 0.8:
        c = MOSS['lit'] if rng.random() < moss else pal['top']
    elif n.z > 0.25:
        c = MOSS['mid'] if rng.random() < moss else pal['bevel']
    elif n.z < -0.35:
        return pal['deep']
    else:
        f = -n.y * 0.78 - n.x * 0.42
        band = 0 if f > 0.5 else 1 if f > 0.0 else 2 if f > -0.5 else 3
        if rng.random() < 0.2:
            band = min(3, max(0, band + rng.choice((-1, 1))))
        c = pal[('lit', 'mid', 'dark', 'deep')[band]]
    return tint(c, tf)


def poly_ring(rng, sides, r, rot, rj=(0.86, 1.1), aj=0.16):
    pts = []
    for i in range(sides):
        a = rot + 2 * math.pi * i / sides + rng.uniform(-aj, aj)
        rr = r * rng.uniform(*rj)
        pts.append((math.cos(a) * rr, math.sin(a) * rr))
    return pts


def block(mb, rng, bot, top, ch, inset, tilt=(0.0, 0.0), colfn=None, tf=1.0, moss=0.0,
          skirt=False, cap=True, cap_col=None, ins_off=(0.0, 0.0)):
    """One faceted prism segment: side faces bot->top, a chamfer from top up by ch to an inset ring,
    then a flat (optionally tilted) cap. Rings are CCW seen from above."""
    colfn = colfn or (lambda n, m: rock_col(n, rng, moss=m, tf=tf))
    n = len(top)
    cen = sum(top, Vector()) / n
    ins = []
    for i, p in enumerate(top):
        k = inset[i] if isinstance(inset, (list, tuple)) else inset
        q = Vector((cen.x + (p.x - cen.x) * k + ins_off[0], cen.y + (p.y - cen.y) * k + ins_off[1], 0))
        q.z = cen.z + ch + tilt[0] * (q.x - cen.x) + tilt[1] * (q.y - cen.y)
        ins.append(q)
    B, T, I = mb.vs(bot), mb.vs(top), mb.vs(ins)
    mossy = moss if not skirt else 1.0
    for i in range(n):
        j = (i + 1) % n
        q = [B[i], B[j], T[j], T[i]]
        mb.f(q, colfn(mb.nrm(q), 0.0))
        q = [T[i], T[j], I[j], I[i]]
        mb.f(q, colfn(mb.nrm(q), mossy))
    if cap:
        mb.f(I, cap_col or colfn(mb.nrm(I), mossy))
    if skirt:  # moss lip drooping over the edge of the chamfer
        s0 = [cen + (p - cen) * 1.045 + Vector((0, 0, 0.03)) for p in top]
        s1 = [cen + (p - cen) * rng.uniform(1.06, 1.12) - Vector((0, 0, rng.choice((0.08, 0.2, 0.45, 0.8)) * rng.uniform(0.8, 1.2)))
              for p in top]
        S0, S1 = mb.vs(s0), mb.vs(s1)
        for i in range(n):
            j = (i + 1) % n
            mb.f([S1[i], S1[j], S0[j], S0[i]], rng.choice((MOSS['dark'], MOSS['mid'])))
    return ins


def column(mb, rng, x, y, z0, z1, r, sides=None, lean=(0.0, 0.0), seg=(4.0, 9.0), moss=0.0,
           top_moss=0.0, rot=None, shrink=0.97, setback=(0.04, 0.36), tf=None, top_tilt=0.08):
    """A basalt column: stacked faceted segments with chamfered breaks, slight lean and set-backs.
    Returns (top centre, top ring) for placing moss, ferns or vines."""
    sides = sides or rng.choice((5, 6, 5, 6, 4, 5, 6))
    rot = rng.uniform(0, 2 * math.pi) if rot is None else rot
    prof = poly_ring(rng, sides, r, rot, (0.8, 1.14), 0.22)
    cuts, z = [z0], z0
    while True:
        z += rng.uniform(*seg)
        if z >= z1 - seg[0] * 0.45:
            cuts.append(z1)
            break
        cuts.append(z)
    tf = tf if tf is not None else rng.uniform(0.88, 1.12)
    H = max(z1 - z0, 0.01)
    ins = None
    top_c = None
    for si in range(len(cuts) - 1):
        za, zb = cuts[si], cuts[si + 1]
        last = si == len(cuts) - 2
        jx = rng.uniform(-0.18, 0.18) * r if si else 0.0
        jy = rng.uniform(*setback) * r if si else 0.0
        sc = (shrink ** si) * (rng.uniform(0.95, 1.03) if si else 1.0)

        def ring(zz):
            t = (zz - z0) / H
            return [Vector((x + lean[0] * t + jx + px * sc, y + lean[1] * t + jy + py * sc, zz))
                    for px, py in prof]
        ch = min(rng.uniform(0.3, 0.75) * r, (zb - za) * 0.3)
        inset = [rng.uniform(0.38, 0.7) for _ in prof]
        # angled cut: the chamfer is broad on the front and narrow at the back
        ins_off = (rng.uniform(-0.12, 0.12) * r, rng.uniform(0.08, 0.3) * r)
        if last:
            ch = min(rng.uniform(0.15, 0.4) * r, (zb - za) * 0.3)
            inset = [rng.uniform(0.62, 0.86) for _ in prof]
            ins_off = (rng.uniform(-0.06, 0.06) * r, rng.uniform(0.0, 0.1) * r)
        ch = max(ch, 0.06)
        tilt = (rng.uniform(-top_tilt, top_tilt), rng.uniform(-top_tilt, top_tilt * 0.6)) if last else (0, 0)
        zbot = za if si == 0 else za - 0.3
        mossy = last and rng.random() < top_moss
        bring = ring(zbot)
        ins = block(mb, rng, bring, ring(zb - ch), ch, inset, tilt, tf=tf,
                    moss=moss if not last else max(moss, 0.15), skirt=mossy, ins_off=ins_off)
        if si:  # underside, seen where a segment juts out past the one below
            mb.f(list(reversed(mb.vs(bring))), BASALT['deep'])
        top_c = sum(ins, Vector()) / len(ins)
    return top_c, ins, sc * r


# --- foliage and details -----------------------------------------------------------------------

def fern(mb, rng, origin, scale=1.0, fronds=None, yaw0=0.0, spread=1.0, mound=True):
    """A fern clump: arching fronds with saw-tooth leaflets. scale 1.0 is ~1.4 m across."""
    o = Vector(origin)
    fronds = fronds or rng.randint(10, 13)
    for fi in range(fronds):
        yaw = yaw0 + 2 * math.pi * fi / fronds + rng.uniform(-0.3, 0.3)
        L = scale * rng.uniform(0.85, 1.1)
        N = 17
        p0 = rng.uniform(1.05, 1.4) * (1.0 if spread >= 1 else 1.1)
        pts = [o + Vector((math.cos(yaw), math.sin(yaw), 0)) * 0.05 * scale]
        dirs = []
        for k in range(N):
            t = k / (N - 1)
            pitch = p0 - (p0 + 0.75) * t ** 2.0
            d = Vector((math.cos(pitch) * math.cos(yaw) * spread, math.cos(pitch) * math.sin(yaw) * spread,
                        math.sin(pitch)))
            dirs.append(d.normalized())
            pts.append(pts[-1] + d.normalized() * (L / N))
        base = rng.choice(FERN)
        for k in range(1, N):
            t = k / N
            p, q = pts[k], pts[k + 1]
            d = dirs[k]
            side = d.cross(Vector((0, 0, 1)))
            if side.length < 1e-4:
                side = Vector((1, 0, 0))
            side.normalize()
            lw = 0.18 * scale * math.sin(math.pi * min(1.0, 0.1 + t * 0.95)) ** 0.7
            col = tint(base, 0.92 + 0.28 * t)
            for s in (1, -1):
                tip = p + side * lw * s + d * lw * 0.7 + Vector((0, 0, -lw * 0.3))
                a, b, c = mb.v(p), mb.v(tip), mb.v(q)
                mb.f([a, b, c] if s > 0 else [c, b, a], col if s > 0 else tint(col, 0.88))
        # rachis tip
    if mound:
        blob(mb, rng, o + Vector((0, 0, -0.05)), 0.15 * scale, (1.3, 1.3, 0.5), 0.03 * scale,
             lambda n: MOSS['dark'] if n.z < 0.6 else MOSS['mid'], subdiv=1)


def blob(mb, rng, centre, radius, scale, jit, colfn, mat='kit', subdiv=1, uvfn=None):
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=subdiv, radius=radius)
    bm.verts.index_update()
    base = len(mb.V)
    c = Vector(centre)
    for v in bm.verts:
        co = Vector((v.co.x * scale[0], v.co.y * scale[1], v.co.z * scale[2]))
        co += Vector((rng.uniform(-1, 1), rng.uniform(-1, 1), rng.uniform(-1, 1))) * jit
        mb.V.append(c + co)
    for f in bm.faces:
        idx = [base + v.index for v in f.verts]
        n = mb.nrm(idx)
        uv = [uvfn(mb.V[i]) for i in idx] if uvfn else None
        mb.f(idx, colfn(n), mat, uv)
    bm.free()


def leaf(mb, p, d, w, col):
    """Diamond leaf from p along d (full length), half-width vector w."""
    a = mb.v(p)
    b = mb.v(p + d * 0.45 + w)
    c = mb.v(p + d)
    e = mb.v(p + d * 0.45 - w)
    mb.f([a, b, c, e], col)


def vine_curtain(mb, rng, origin, width, length, strands, leaf_size=1.0, lip=True):
    """Hanging vines from origin (top front edge of a ledge) down -Z, facing -Y."""
    o = Vector(origin)
    for s in range(strands):
        x = o.x + ((s + 0.5) / strands - 0.5) * width + rng.uniform(-0.12, 0.12) * width / strands
        L = length * rng.uniform(0.4, 1.0)
        phase, amp = rng.uniform(0, 6.3), rng.uniform(0.03, 0.12)
        bow = rng.uniform(0.05, 0.3)

        def stem(t):
            return Vector((x + amp * math.sin(phase + t * 7.0), o.y - 0.04 - bow * math.sin(math.pi * t * 0.8),
                           o.z - L * t))
        nleaf = max(3, int(L / 0.16))
        # stem as a thin ribbon
        prev = None
        for k in range(0, 6):
            t = k / 5
            p = stem(t)
            pair = (mb.v(p + Vector((-0.015, 0, 0))), mb.v(p + Vector((0.015, 0, 0))))
            if prev:
                mb.f([prev[0], pair[0], pair[1], prev[1]], '#4c6a2e')
            prev = pair
        for k in range(nleaf):
            t = (k + 0.5) / nleaf
            p = stem(t)
            side = 1 if k % 2 else -1
            sz = leaf_size * rng.uniform(0.1, 0.17) * (1.0 - 0.35 * t)
            d = Vector((side * 0.75, -0.35 + rng.uniform(-0.2, 0.2), -0.55)).normalized() * sz * 1.7
            w = d.cross(Vector((0, 1, 0)))
            if w.length < 1e-5:
                w = Vector((1, 0, 0))
            w = w.normalized() * sz * 0.5
            leaf(mb, p, d, w, rng.choice(LEAF))
    if lip:  # lumpy moss along the ledge the vines hang from
        nb = max(3, int(width / 0.42))
        for i in range(nb):
            x = o.x - width * 0.52 + width * 1.04 * (i + 0.5) / nb + rng.uniform(-0.08, 0.08)
            rad = rng.uniform(0.22, 0.34)
            blob(mb, rng, (x, o.y - 0.05 + rng.uniform(-0.08, 0.08), o.z - 0.02), rad, (1.5, 1.2, 0.75), rad * 0.15,
                 lambda n: MOSS['lit'] if n.z > 0.55 else MOSS['mid'] if n.z > -0.2 else MOSS['dark'], subdiv=1)


def crystal(mb, rng, base, h, r, tilt_dir, tilt, tip=(1.5, 2.2)):
    sides = 6
    rot = rng.uniform(0, math.pi)
    tip_h = r * rng.uniform(*tip)
    ring0 = poly_ring(rng, sides, r, rot, (0.9, 1.08), 0.08)
    shoulder = h - tip_h
    loc = []
    for px, py in ring0:
        loc.append(Vector((px, py, -0.12)))
    for px, py in ring0:
        loc.append(Vector((px * 0.94, py * 0.94, shoulder)))
    loc.append(Vector((rng.uniform(-0.15, 0.15) * r, rng.uniform(-0.15, 0.15) * r, h)))
    axis = Vector((-math.sin(tilt_dir), math.cos(tilt_dir), 0))
    m = Matrix.Rotation(tilt, 3, axis)
    b = Vector(base)
    idx = mb.vs([b + m @ p for p in loc])
    L = Vector((-0.5, -0.65, 0.55)).normalized()
    for i in range(sides):
        j = (i + 1) % sides
        q = [idx[i], idx[j], idx[sides + j], idx[sides + i]]
        n = mb.nrm(q)
        f = n.dot(L)
        c = CRYSTAL['lit'] if f > 0.35 else CRYSTAL['mid'] if f > -0.05 else CRYSTAL['dark'] if f > -0.5 else CRYSTAL['deep']
        mb.f(q, c, 'glow')
        q = [idx[sides + i], idx[sides + j], idx[-1]]
        n = mb.nrm(q)
        f = n.dot(L)
        mb.f(q, CRYSTAL['hi'] if f > 0.3 else CRYSTAL['lit'] if f > -0.2 else CRYSTAL['mid'], 'glow')


def tube(mb, pts, radius, col, sides=4, col2=None, rot=math.pi / 4):
    rings = []
    for k, p in enumerate(pts):
        t = (pts[min(k + 1, len(pts) - 1)] - pts[max(k - 1, 0)]).normalized()
        up = Vector((0, 0, 1)) if abs(t.z) < 0.9 else Vector((1, 0, 0))
        nn = t.cross(up).normalized()
        bb = nn.cross(t).normalized()
        ring = []
        for s in range(sides):
            a = rot + 2 * math.pi * s / sides
            ring.append(mb.v(p + (nn * math.cos(a) + bb * math.sin(a)) * radius))
        rings.append(ring)
    for k in range(len(rings) - 1):
        for s in range(sides):
            s2 = (s + 1) % sides
            q = [rings[k][s], rings[k + 1][s], rings[k + 1][s2], rings[k][s2]]
            n = mb.nrm(q)
            mb.f(q, col if (n.z > -0.2 or not col2) else col2)


def boxv(mb, centre, size, rotm, colfn, bottom=True):
    hx, hy, hz = size[0] / 2, size[1] / 2, size[2] / 2
    c = Vector(centre)
    corners = [Vector((sx * hx, sy * hy, sz * hz)) for sz in (-1, 1) for sy in (-1, 1) for sx in (-1, 1)]
    I = mb.vs([c + rotm @ p for p in corners])
    faces = [(4, 5, 7, 6), (0, 1, 5, 4), (1, 3, 7, 5), (3, 2, 6, 7), (2, 0, 4, 6)]
    if bottom:
        faces.append((0, 2, 3, 1))
    for f in faces:
        q = [I[i] for i in f]
        mb.f(q, colfn(mb.nrm(q)))


# --- water -------------------------------------------------------------------------------------

def path_lengths(path):
    s = [0.0]
    for a, b in zip(path, path[1:]):
        s.append(s[-1] + (b - a).length)
    return s


def ribbon(mb, rng, path, x0, x1, nx, col_at, v_total=None, rib=0.0, widen=0.0, edge_jit=0.0,
           mask=None, offset=0.0, v0=0.0, x_curve=None, xjit=0.0):
    """A water sheet along a (y, z) path, spanning x0..x1, facing the outside of the flow (front for a
    falling sheet, up for a flat run). UV u across, V from 0 at the path start growing downstream."""
    s = path_lengths(path)
    L = s[-1]
    vs = [v0 + (si / L * v_total if v_total else si / M_PER_V) for si in s]
    ribs = [rng.uniform(-rib, rib) for _ in range(nx + 1)]
    xm = (x0 + x1) / 2
    grid = []
    for j, p in enumerate(path):
        a = path[max(j - 1, 0)]
        b = path[min(j + 1, len(path) - 1)]
        t = (b - a).normalized()
        nrm = Vector((0, t.z, -t.y))
        frac = s[j] / L
        fall = max(0.0, -t.z)
        row = []
        for i in range(nx + 1):
            u = i / nx
            x = x0 + (x1 - x0) * u
            x = xm + (x - xm) * (1 + widen * frac)
            if i in (0, nx):
                x += rng.uniform(-edge_jit, edge_jit) * frac
            elif xjit and 0 < j < len(path) - 1:
                x += rng.uniform(-xjit, xjit) * (x1 - x0) / nx
            if x_curve:
                x += x_curve(u, frac)
            pos = p + nrm * (offset + ribs[i] * fall) + Vector((x, 0, 0))
            row.append(mb.v(pos))
        grid.append(row)
    for j in range(len(path) - 1):
        for i in range(nx):
            if mask and not mask(i, j):
                continue
            u0, u1 = i / nx, (i + 1) / nx
            q = [grid[j][i], grid[j + 1][i], grid[j + 1][i + 1], grid[j][i + 1]]
            uv = [(u0, 1 - vs[j]), (u0, 1 - vs[j + 1]), (u1, 1 - vs[j + 1]), (u1, 1 - vs[j])]
            mb.f(q, col_at(i, j), 'water', uv)
    return grid, vs


def streak_table(rng, cols, rows, choices, weights, run=(2, 5)):
    """Per-column runs of colours down a sheet: streaky, painterly falls."""
    tab = []
    for i in range(cols):
        col, left, out = None, 0, []
        for j in range(rows):
            if left <= 0:
                col = rng.choices(choices, weights)[0]
                left = rng.randint(*run)
            out.append(col)
            left -= 1
        tab.append(out)
    return tab


def fall_path(H, lip_y, back=0.9, bulge=0.7, rows=22):
    pts = [Vector((0, lip_y + back, H + 0.1)), Vector((0, lip_y + back * 0.45, H + 0.1)),
           Vector((0, lip_y, H + 0.02))]
    for k in range(1, rows + 1):
        u = (k / rows) ** 1.15
        z = H * (1 - u)
        y = lip_y * (1 - u) - bulge * (1 - math.exp(-u * 10)) * (1 - u) ** 0.8
        pts.append(Vector((0, y, z - (0.3 if k == rows else 0.0))))
    return pts


def build_fall(seed, W, H, lip_y, rows, nx, reps, bulge):
    rng = R(seed)
    mb = MB()
    path = fall_path(H, lip_y, bulge=bulge, rows=rows)
    nrow = len(path) - 1
    vtot = reps
    # back sheet: glassy teal / pale blue facets near the lip, breaking into white lower down
    runs = [[0.0] * nrow for _ in range(nx)]
    for i in range(nx):
        j = 0
        while j < nrow:
            q, ln = rng.random(), rng.randint(2, 5)
            for k in range(j, min(nrow, j + ln)):
                runs[i][k] = q
            j += ln

    def pick(q, f):
        top = (('teal', 4), ('pale', 3), ('blue', 2.5), ('white', 1.5), ('deep', 1))
        mid = (('white', 4), ('pale', 3), ('teal', 1.5), ('blue', 1.2), ('shadow', 0.6))
        low = (('white', 6), ('pale', 2.5), ('blue', 0.6))
        tbl = top if f < 0.22 else mid if f < 0.72 else low
        tot = sum(w for _, w in tbl)
        acc = 0.0
        for c, w in tbl:
            acc += w / tot
            if q <= acc:
                return WATER[c]
        return WATER[tbl[-1][0]]

    def back_col(i, j):
        if j < 2:
            return WATER[('teal', 'deep', 'blue')[(i + j) % 3]]
        return pick(runs[i][j], j / nrow)
    ribbon(mb, rng, path, -W / 2, W / 2, nx, back_col, v_total=vtot, rib=0.3, widen=0.16, edge_jit=0.35, xjit=0.3)
    # front streak layer: white and pale streaks over the back sheet
    nf = nx * 2
    on = [[False] * nrow for _ in range(nf)]
    for i in range(nf):
        j = rng.randint(0, 3)
        while j < nrow:
            ln = rng.randint(3, 9)
            for k in range(j, min(nrow, j + ln)):
                on[i][k] = True
            j += ln + rng.randint(1, 5)
    ftab = streak_table(rng, nf, nrow, ('white', 'pale', 'white', 'blue'), (5, 3, 2, 1), run=(3, 8))
    ribbon(mb, rng, path[2:], -W / 2 * 0.94, W / 2 * 0.94, nf,
           lambda i, j: WATER[ftab[i][j]], v_total=vtot * path_lengths(path[2:])[-1] / path_lengths(path)[-1],
           v0=path_lengths(path)[2] / path_lengths(path)[-1] * vtot,
           rib=0.18, widen=0.2, edge_jit=0.2, offset=0.14, mask=lambda i, j: on[i][j] and j > 1, xjit=0.25)
    # thin separate strands at the edges
    for side in (-1, 1):
        for k in range(1):
            xo = side * (W / 2 + 0.3 + rng.uniform(0, 0.3))
            w = rng.uniform(0.4, 0.7)
            start = rng.randint(2, 5)
            sub = path[start:]
            sl = path_lengths(path)
            ribbon(mb, rng, sub, xo - w / 2, xo + w / 2, 1,
                   lambda i, j: rng.choice((WATER['white'], WATER['pale'])),
                   v_total=vtot * (sl[-1] - sl[start]) / sl[-1], v0=sl[start] / sl[-1] * vtot,
                   rib=0.1, widen=0.3, offset=-0.1)
    # splash skirt at the base
    splash_skirt(mb, rng, Vector((0, 0, 0)), W * 0.62, max(1.6, W * 0.25), n=26, hmax=min(2.6, H * 0.09), v_base=reps)
    return mb


def splash_skirt(mb, rng, c, rx, ry, n=24, hmax=2.2, v_base=4.0):
    """A jagged foam crown around the base of a fall (fx_water, UV u around; V carries on from the
    bottom of the sheet, v_base, growing outward so the foam scrolls away from the fall)."""
    vb = lambda V: 1 - V  # noqa: E731  Blender v for a glTF V
    outer, crest, inner = [], [], []
    for i in range(n):
        a = 2 * math.pi * i / n
        ca, sa = math.cos(a), math.sin(a)
        h = hmax * (rng.uniform(0.55, 1.0) if i % 2 == 0 else rng.uniform(0.2, 0.45))
        k = 1.0 if sa < 0.3 else 0.75  # flatter at the back, against the cliff
        outer.append(mb.v(c + Vector((ca * rx * 1.05, sa * ry * 1.1, -0.3))))
        crest.append(mb.v(c + Vector((ca * rx * 0.78, sa * ry * 0.8, h * k))))
        inner.append(mb.v(c + Vector((ca * rx * 0.4, sa * ry * 0.4, 0.35 * k))))
    for i in range(n):
        j = (i + 1) % n
        u0, u1 = i / n, (i + 1) / n
        mb.f([outer[i], outer[j], crest[j], crest[i]], rng.choice((WATER['white'], WATER['pale'], WATER['white'])),
             'water', [(u0, vb(v_base + 0.3)), (u1, vb(v_base + 0.3)), (u1, vb(v_base + 0.1)), (u0, vb(v_base + 0.1))])
        mb.f([crest[i], crest[j], inner[j], inner[i]], rng.choice((WATER['white'], MIST[1])),
             'water', [(u0, vb(v_base + 0.1)), (u1, vb(v_base + 0.1)), (u1, vb(v_base)), (u0, vb(v_base))])
    for k in range(7):
        a = math.pi + math.pi * (k + 0.5) / 7 + rng.uniform(-0.2, 0.2)
        p = c + Vector((math.cos(a) * rx * rng.uniform(0.45, 0.8), math.sin(a) * ry * 0.6 - 0.2, rng.uniform(0.2, 0.6)))
        rad = rng.uniform(0.7, 1.2) * min(1.0, rx / 3)
        blob(mb, rng, p, rad, (1.4, 1.0, 0.7), rad * 0.15,
             lambda n: MIST[0] if n.z > 0.3 else MIST[1], 'water', subdiv=1,
             uvfn=lambda v: (v.x / 8.0, vb(v_base + 0.1 + (2.0 - v.z) / 10.0)))


def foam_strip(mb, rng, x0, x1, y, z, depth=0.5, h=0.45):
    nx = max(3, int((x1 - x0) / 0.45))
    A, B, C = [], [], []
    for i in range(nx + 1):
        x = x0 + (x1 - x0) * i / nx
        A.append(mb.v((x, y - depth, z - 0.05)))
        B.append(mb.v((x + rng.uniform(-0.1, 0.1), y - depth * 0.5, z + h * (rng.uniform(0.6, 1.0) if i % 2 else rng.uniform(0.15, 0.4)))))
        C.append(mb.v((x, y + 0.1, z + 0.05)))
    for i in range(nx):
        u0, u1 = i / nx, (i + 1) / nx
        mb.f([A[i], A[i + 1], B[i + 1], B[i]], WATER['white'], 'water', [(u0, 1), (u1, 1), (u1, 0.95), (u0, 0.95)])
        mb.f([B[i], B[i + 1], C[i + 1], C[i]], rng.choice((WATER['white'], WATER['pale'])), 'water',
             [(u0, 0.95), (u1, 0.95), (u1, 0.9), (u0, 0.9)])


# --- props -------------------------------------------------------------------------------------

def cliff_wall(rng, mb, W, rows, notch=None, lip_z=None, lip_front=-3.1, base=-3.0, ledges=(), vines=0,
               ferns=0):
    """rows: list of dict(y, yj, r, h(x) -> top, seg, moss, top_moss, notch_y, notch_h).
    notch: (x0, x1) gap in the front rows where a fall pours over a lip slab at lip_z."""
    tops = []
    for ri, row in enumerate(rows):
        x = -W / 2 + row['r'][0] * 0.7
        while x < W / 2 - row['r'][0] * 0.5:
            r = rng.uniform(*row['r'])
            cx = min(x + r * 0.78, W / 2 - r * 0.75)
            x = cx + r * 0.8
            cy = row['y'] + rng.uniform(-row['yj'], row['yj'])
            in_notch = notch and notch[0] - r * 0.35 < cx < notch[1] + r * 0.35
            if in_notch and row.get('notch') == 'skip':
                continue
            if in_notch:
                cy = row['notch_y']
                top = row['notch_h']
            else:
                top = row['h'](cx, rng)
            lean = (rng.uniform(-0.35, 0.35), rng.uniform(-0.15, 0.45))
            tc, ring, rr = column(mb, rng, cx, cy, base, top, r, lean=lean, seg=row['seg'],
                                  moss=row.get('moss', 0.0), top_moss=row.get('top_moss', 0.3))
            tops.append((ri, cx, cy, top, tc, r))
    if notch:
        x0, x1 = notch
        # filler slab behind the lip (the channel floor)
        poly = [(x0 - 0.3, lip_front + 1.0), (x1 + 0.3, lip_front + 1.0), (x1 + 0.4, 3.0), (x0 - 0.4, 3.0)]
        bot = [Vector((px, py, lip_z - 2.2)) for px, py in poly]
        top = [Vector((px, py, lip_z - 0.24)) for px, py in poly]
        block(mb, rng, bot, top, 0.12, 0.985, moss=0.3)
        # the lip itself: broken column ends jutting out over the drop
        n = max(2, round((x1 - x0) / 2.9))
        for k in range(n):
            r = (x1 - x0) / n * 0.62 * rng.uniform(0.95, 1.08)
            cx = x0 + (x1 - x0) * (k + 0.5) / n + rng.uniform(-0.2, 0.2)
            chunk(mb, rng, cx, lip_front + r * 0.92, lip_z - rng.uniform(3.0, 4.6), lip_z - 0.1, r)
    return tops


def chunk(mb, rng, x, y, z0, z1, r, sides=None):
    """A short column piece with a chamfered underside (overhangs, the lip of a notch)."""
    sides = sides or rng.choice((5, 6))
    prof = poly_ring(rng, sides, r, rng.uniform(0, 6.3), (0.85, 1.1), 0.2)
    chb = rng.uniform(0.3, 0.6) * r
    ch = rng.uniform(0.08, 0.18)
    ring = lambda z, k=1.0: [Vector((x + px * k, y + py * k, z)) for px, py in prof]  # noqa: E731
    bot = ring(z0 + chb)
    block(mb, rng, bot, ring(z1 - ch), ch, [rng.uniform(0.8, 0.92) for _ in prof], moss=0.4)
    low = [Vector((x + px * k, y + py * k, z0)) for (px, py), k in zip(prof, [rng.uniform(0.45, 0.7) for _ in prof])]
    B, L = mb.vs(bot), mb.vs(low)
    for i in range(sides):
        j = (i + 1) % sides
        q = [L[i], L[j], B[j], B[i]]
        mb.f(q, rock_col(mb.nrm(q), rng))
    mb.f(list(reversed(L)), BASALT['deep'])


def deco_ledges(mb, rng, tops, nv, nf, zmin, zmax, front_rows=(0,), vine_len=(3, 6)):
    cands = [t for t in tops if t[0] in front_rows and zmin < t[3] < zmax]
    rng.shuffle(cands)
    for t in cands[:nv]:
        ri, cx, cy, top, tc, r = t
        vine_curtain(mb, rng, (tc.x, cy - r * 0.75, tc.z - 0.05), rng.uniform(2.2, 3.2),
                     rng.uniform(*vine_len), rng.randint(6, 8), leaf_size=1.9, lip=False)
    for t in cands[nv:nv + nf]:
        ri, cx, cy, top, tc, r = t
        fern(mb, rng, (tc.x, tc.y - 0.3, tc.z), scale=rng.uniform(1.3, 1.6), fronds=9)


def build_basalt_cliff():
    rng = R(4101)
    mb = MB()
    W = 30.0
    notch = (-4.4, 4.4)

    def h_front(x, rng):
        if abs(x) < 7.8:
            return rng.uniform(42.5, 45.5)
        return rng.uniform(36, 44) if rng.random() < 0.55 else rng.uniform(19, 31)

    rows = [
        dict(y=-2.6, yj=0.6, r=(1.6, 2.15), h=h_front, seg=(4.5, 8.5), notch='skip', top_moss=0.6, moss=0.06),
        dict(y=-0.3, yj=0.4, r=(1.7, 2.2), h=lambda x, g: g.uniform(38, 44.5), seg=(5, 10), notch='skip',
             top_moss=0.45),
        dict(y=1.9, yj=0.3, r=(1.8, 2.2), h=lambda x, g: g.uniform(39, 44), seg=(7, 13), notch_y=1.9,
             notch_h=37.6, top_moss=0.4),
        dict(y=3.4, yj=0.2, r=(1.7, 2.1), h=lambda x, g: g.uniform(39, 42.5), seg=(10, 16), notch_y=3.4,
             notch_h=39.6, top_moss=0.3),
    ]
    tops = cliff_wall(rng, mb, W, rows, notch=notch, lip_z=40.0, lip_front=-3.1)
    deco_ledges(mb, rng, tops, 3, 4, 18, 33, vine_len=(4, 8))
    # vines spilling from the cliff top near the notch, like the concept's upper ledges
    for t in [t for t in tops if t[0] == 0 and t[3] > 40][:2]:
        ri, cx, cy, top, tc, r = t
        vine_curtain(mb, rng, (tc.x, cy - r * 0.7, tc.z - 0.05), 2.0, rng.uniform(5, 9), 5, leaf_size=1.8, lip=False)
    for t in [t for t in tops if t[0] == 1 and t[3] > 41][:2]:
        ri, cx, cy, top, tc, r = t
        fern(mb, rng, (tc.x, tc.y, tc.z), scale=1.1, fronds=9)
    return mb


def build_basalt_cliff_low():
    rng = R(4202)
    mb = MB()
    W = 25.0
    notch = (1.3, 6.7)

    def step(x):
        return 2.0 if x < -5 else 0.0 if x < 1 else -1.2

    rows = [
        dict(y=-2.6, yj=0.5, r=(1.5, 2.0), h=lambda x, g: g.uniform(7.5, 11.5) + step(x), seg=(3.5, 6),
             notch='skip', top_moss=0.75, moss=0.08),
        dict(y=-0.3, yj=0.4, r=(1.6, 2.1), h=lambda x, g: (g.uniform(17.4, 18.6) if abs(x - 4) < 4.4 else g.uniform(11.5, 14.5) + step(x)),
             seg=(4, 7), notch='skip', top_moss=0.6),
        dict(y=1.9, yj=0.3, r=(1.7, 2.1), h=lambda x, g: g.uniform(14.5, 17.5) + step(x) * 0.5, seg=(5, 9),
             notch_y=1.9, notch_h=13.6, top_moss=0.5),
        dict(y=3.4, yj=0.2, r=(1.7, 2.1), h=lambda x, g: g.uniform(16.5, 18.0), seg=(6, 10), notch_y=3.4,
             notch_h=15.6, top_moss=0.4),
    ]
    tops = cliff_wall(rng, mb, W, rows, notch=notch, lip_z=16.0, lip_front=-3.1)
    deco_ledges(mb, rng, tops, 2, 3, 6, 13, vine_len=(3, 5))
    return mb


def build_basalt_columns():
    rng = R(4303)
    mb = MB()
    spots = [(0, 0, 6.0, 0.85)]
    for k in range(6):
        a = k * math.pi / 3 + rng.uniform(-0.15, 0.15)
        d = 1.45 + rng.uniform(-0.1, 0.15)
        spots.append((math.cos(a) * d, math.sin(a) * d, rng.choice((2.2, 3.4, 4.6, 5.3, 1.4, 3.9)), rng.uniform(0.72, 0.85)))
    spots.append((0.4, -2.35, 0.9, 0.6))
    spots.append((-1.4, -2.0, 0.55, 0.55))
    tops = []
    for (x, y, h, r) in spots:
        tc, ring, rr = column(mb, rng, x, y, -1.0, h, r, sides=rng.choice((5, 6, 6)), lean=(rng.uniform(-0.2, 0.2), rng.uniform(-0.2, 0.2)),
                              seg=(1.8, 3.2), top_moss=0.55, top_tilt=0.12)
        tops.append((h, tc, r))
    mid = sorted(tops, key=lambda t: t[0])[3]
    fern(mb, rng, (mid[1].x, mid[1].y, mid[1].z), scale=0.75, fronds=8)
    return mb


def build_fall_tall():
    return build_fall(5101, W=8.0, H=40.0, lip_y=-1.5, rows=24, nx=10, reps=4.0, bulge=0.75)


def build_fall_mid():
    return build_fall(5202, W=5.0, H=16.0, lip_y=-1.2, rows=14, nx=7, reps=16.0 / M_PER_V, bulge=0.45)


def build_cascade_steps():
    rng = R(5303)
    mb = MB()
    N = 5
    hs = [2.4 * (k + 1) for k in range(N)]
    yf = [-5.0 + 2.0 * k for k in range(N)]
    XW = 4.3
    for k in range(N):
        zbot = -2.0 if k == 0 else hs[k - 1] - 0.6
        # split the ledge into 3-4 chunky blocks
        nb = rng.choice((3, 4))
        cuts = sorted([-XW] + [rng.uniform(-XW + 1.5, XW - 1.5) for _ in range(nb - 1)] + [XW])
        for b in range(nb):
            x0, x1 = cuts[b] - 0.05, cuts[b + 1] + 0.05
            if x1 - x0 < 0.9:
                continue
            fy = yf[k] + rng.uniform(-0.35, 0.3)
            ht = hs[k] + rng.uniform(-0.18, 0.1)
            yb = yf[k] + 2.6 if k < N - 1 else 5.0
            poly = [(x0, fy + rng.uniform(-0.1, 0.15)), ((x0 + x1) / 2 + rng.uniform(-0.3, 0.3), fy - rng.uniform(0.0, 0.25)),
                    (x1, fy + rng.uniform(-0.1, 0.15)), (x1, yb), (x0, yb)]
            bot = [Vector((px, py, zbot)) for px, py in poly]
            top = [Vector((px, py, ht - 0.16)) for px, py in poly]
            inset = [0.96, 0.93, 0.96, 0.99, 0.99]
            block(mb, rng, bot, top, 0.16, inset, moss=0.3 if rng.random() < 0.5 else 0.05, tf=rng.uniform(0.9, 1.1))
        # water over this ledge: 2-3 curtains covering most of the width
        segs = []
        x = -XW + rng.uniform(0.0, 0.6)
        while x < XW - 0.8:
            w = rng.uniform(1.6, 3.6)
            x1 = min(XW - 0.15, x + w)
            segs.append((x, x1))
            x = x1 + rng.uniform(0.3, 1.1)
        zl = hs[k - 1] if k > 0 else -0.15
        for (x0, x1) in segs:
            path = [Vector((0, yf[k] + 1.9, hs[k] + 0.05)), Vector((0, yf[k] + 0.8, hs[k] + 0.07)),
                    Vector((0, yf[k] - 0.05, hs[k] + 0.09)), Vector((0, yf[k] - 0.3, hs[k] - 0.12)),
                    Vector((0, yf[k] - 0.42, hs[k] - 0.8)), Vector((0, yf[k] - 0.5, (hs[k] + zl) / 2 - 0.3)),
                    Vector((0, yf[k] - 0.55, zl + 0.05))]
            nx = max(2, int((x1 - x0) / 0.45))
            tab = streak_table(rng, nx, 6, ('white', 'pale', 'teal', 'blue'), (6, 3, 1.2, 1), run=(1, 3))

            def colf(i, j, tab=tab):
                if j < 2:
                    return rng.choice((WATER['teal'], WATER['blue'], WATER['pale']))
                return WATER[tab[i][j]]
            v0 = (N - 1 - k) * 0.55
            ribbon(mb, rng, path, x0, x1, nx, colf, rib=0.14, edge_jit=0.12, v0=v0, xjit=0.3)
            # front white streaks on the drop
            ribbon(mb, rng, path[3:], x0 + 0.1, x1 - 0.1, nx * 2, lambda i, j: rng.choice((WATER['white'], WATER['white'], WATER['pale'])),
                   rib=0.08, offset=0.08, v0=v0 + 0.25, mask=lambda i, j: (i * 7 + j * 3 + k) % 3 != 0)
            foam_strip(mb, rng, x0 - 0.15, x1 + 0.15, yf[k] - 0.55, zl, depth=0.6, h=0.5)
    # framing columns on both sides, stepping up toward the back
    for side in (-1, 1):
        for j in range(6):
            y = -4.4 + j * 1.85 + rng.uniform(-0.2, 0.2)
            top = 2.6 + j * 1.85 + rng.uniform(-0.4, 1.4) + (0.6 if side > 0 else 0)
            column(mb, rng, side * (XW + 0.75 + rng.uniform(-0.1, 0.25)), y, -2.0, min(top, 13.2), rng.uniform(0.85, 1.05),
                   sides=rng.choice((4, 5, 5, 6)), seg=(1.8, 3.5), top_moss=0.65, moss=0.1)
    # vines over the right-hand columns, ferns low on the left
    vine_curtain(mb, rng, (XW + 0.6, -2.9, 7.2), 1.4, 4.0, 5, lip=True)
    vine_curtain(mb, rng, (XW + 0.7, 0.8, 10.4), 1.2, 3.2, 4, lip=False)
    fern(mb, rng, (-XW - 0.8, -4.5, 3.0), scale=0.8, fronds=8)
    return mb


def build_mist():
    rng = R(5404)
    mb = MB()

    def colf(n):
        return MIST[0] if n.z > 0.55 else MIST[1] if n.z > 0.0 else MIST[2] if n.z > -0.5 else MIST[3]
    uv = lambda v: (v.x / 10.0 + 0.5, v.z / 5.0)  # noqa: E731  glTF V = 1 - z / 5: drifts upward if scrolled
    spots = [
        (0, 0.6, 1.4, 2.6, (1.6, 1.0, 0.75)), (-2.8, 0.2, 1.0, 2.0, (1.5, 1.0, 0.7)), (2.9, 0.3, 1.1, 2.1, (1.4, 1.0, 0.7)),
        (-1.2, -1.2, 0.6, 1.7, (1.6, 1.0, 0.55)), (1.6, -1.4, 0.55, 1.6, (1.7, 1.0, 0.55)), (0.2, 1.2, 2.6, 1.8, (1.2, 0.9, 1.1)),
        (-1.0, 1.4, 3.6, 1.2, (1.3, 0.9, 1.0)), (1.1, 1.5, 3.8, 1.1, (1.2, 0.9, 1.0)), (-3.8, -0.8, 0.5, 1.1, (1.4, 1.0, 0.6)),
        (3.9, -0.9, 0.5, 1.2, (1.4, 1.0, 0.6)), (0.0, -2.2, 0.3, 1.0, (2.0, 1.0, 0.4)), (-2.0, 1.0, 2.2, 1.3, (1.3, 0.9, 0.9)),
        (2.2, 1.1, 2.4, 1.3, (1.3, 0.9, 0.9)),
    ]
    for (x, y, z, r, sc) in spots:
        blob(mb, rng, (x, y, z), r, sc, r * 0.1, colf, 'water', subdiv=2, uvfn=uv)
    return mb


def build_rainbow():
    rng = R(5505)
    mb = MB()
    n = 26
    rx, rz = 8.0, 10.6
    band = 0.24
    for b, col in enumerate(RAINBOW):
        k0 = 1.0 - b * band / rz
        k1 = 1.0 - (b + 1) * band / rz
        A, B = [], []
        for i in range(n + 1):
            a = math.pi * i / n
            ca, sa = math.cos(a), math.sin(a)
            ex = 1.0 + (0.02 if i % 2 else 0)
            yy = 0.1 * math.sin(a * 3 + b * 0.2)
            A.append(mb.v((ca * (rx - b * band) * ex, yy, sa * rz * k0 - 0.6)))
            B.append(mb.v((ca * (rx - (b + 1) * band) * ex, yy, sa * rz * k1 - 0.6)))
        for i in range(n):
            mb.f([A[i], B[i], B[i + 1], A[i + 1]], col, 'glow')
    return mb


def build_crystals_impl(seed, big):
    rng = R(seed)
    mb = MB()
    H = 1.5 if big else 0.8
    r0 = 0.25 if big else 0.14
    # flat dark slate seat the crystals grow from
    for k in range(2 if big else 1):
        ring = poly_ring(rng, 7, (0.62 if big else 0.36) * (1.0 - 0.3 * k), rng.uniform(0, 6), (0.8, 1.15), 0.25)
        off = Vector((rng.uniform(-0.12, 0.12), rng.uniform(-0.12, 0.12), 0)) if k else Vector()
        bot = [Vector((px, py, -0.15)) + off for px, py in ring]
        top = [Vector((px, py, 0.03 + 0.05 * k)) + off for px, py in ring]
        block(mb, rng, bot, top, 0.03, 0.9, colfn=lambda n, m: '#3d4855' if n.z > 0.5 else '#2a333f')
    # glow pool on the seat
    ring = poly_ring(rng, 7, 0.42 if big else 0.24, 0.3, (0.8, 1.15), 0.2)
    zg = 0.065 + (0.05 if big else 0)
    gi = mb.vs([Vector((px, py, zg)) for px, py in ring])
    mb.f(gi, '#3a7cf0', 'glow')
    crystal(mb, rng, (0, 0, 0.05), H, r0, 0.0, 0.06, tip=(1.1, 1.5))
    sat = 6 if big else 4
    for k in range(sat):
        a = 2 * math.pi * k / sat + rng.uniform(-0.3, 0.3)
        d = r0 * rng.uniform(0.9, 1.3)
        h = H * rng.uniform(0.28, 0.58)
        crystal(mb, rng, (math.cos(a) * d, math.sin(a) * d, 0.06), h, r0 * rng.uniform(0.42, 0.62), a,
                rng.uniform(0.4, 0.8), tip=(1.1, 1.6))
    return mb


def build_crystals():
    return build_crystals_impl(6101, True)


def build_crystals_small():
    return build_crystals_impl(6202, False)


def clip_half(poly, a, b):
    """Keep the part of poly closer to seed a than seed b (Sutherland-Hodgman on one half-plane)."""
    m = ((a[0] + b[0]) / 2, (a[1] + b[1]) / 2)
    d = (b[0] - a[0], b[1] - a[1])
    side = lambda p: (p[0] - m[0]) * d[0] + (p[1] - m[1]) * d[1]  # noqa: E731
    out = []
    for i, p in enumerate(poly):
        q = poly[(i + 1) % len(poly)]
        sp, sq = side(p), side(q)
        if sp <= 0:
            out.append(p)
        if (sp < 0) != (sq < 0) and sp != sq:
            t = sp / (sp - sq)
            out.append((p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t))
    return out


def flagstones(rng, outline, seeds, gap=0.05):
    cells = []
    for i, a in enumerate(seeds):
        poly = list(outline)
        for j, b in enumerate(seeds):
            if i != j:
                poly = clip_half(poly, a, b)
                if len(poly) < 3:
                    break
        if len(poly) < 3:
            continue
        cx = sum(p[0] for p in poly) / len(poly)
        cy = sum(p[1] for p in poly) / len(poly)
        shr = []
        for p in poly:
            dx, dy = p[0] - cx, p[1] - cy
            dd = math.hypot(dx, dy) or 1.0
            k = max(0.2, 1 - gap / dd)
            shr.append((cx + dx * k, cy + dy * k))
        # drop near-duplicate points left by the clipping
        clean = [shr[0]]
        for p in shr[1:]:
            if math.hypot(p[0] - clean[-1][0], p[1] - clean[-1][1]) > 0.04:
                clean.append(p)
        if len(clean) >= 3 and math.hypot(clean[0][0] - clean[-1][0], clean[0][1] - clean[-1][1]) < 0.04:
            clean.pop()
        if len(clean) >= 3:
            cells.append(((cx, cy), clean))
    return cells


def build_rim_slabs():
    rng = R(6303)
    mb = MB()
    # dark mossy ground under the slabs (shows in the gaps)
    g = [(-3.05, -1.45), (3.05, -1.45), (3.1, 1.5), (-3.1, 1.5)]
    mb.f(mb.vs([Vector((x, y, 0.03)) for x, y in g]), SLAB['ground'])
    outline = [(-3.0, -1.1), (-2.2, -1.45), (-0.6, -1.32), (0.9, -1.5), (2.4, -1.3), (3.0, -0.9),
               (3.05, 1.45), (-3.05, 1.45)]
    seeds = []
    for row, yr in enumerate((-0.85, 0.05, 0.95)):
        x = -2.7 + rng.uniform(0, 0.4) + (0.45 if row == 1 else 0)
        while x < 3.0:
            seeds.append((x + rng.uniform(-0.15, 0.15), yr + rng.uniform(-0.2, 0.2)))
            x += rng.uniform(0.95, 1.4)
    for (cx, cy), poly in flagstones(rng, outline, seeds, gap=0.045):
        h = rng.uniform(0.24, 0.4) if cy < -0.3 else rng.uniform(0.16, 0.3)
        tz = (rng.uniform(-0.03, 0.03), rng.uniform(-0.03, 0.03))
        topc = rng.choice(SLAB['top'])
        bot = [Vector((cx + (px - cx) * 0.96, cy + (py - cy) * 0.96, -0.2)) for px, py in poly]
        top = [Vector((px, py, h - 0.05)) for px, py in poly]
        block(mb, rng, bot, top, 0.05, 0.93, tilt=tz,
              colfn=lambda n, m, topc=topc: (topc if n.z > 0.85 else tint(topc, 0.84) if n.z > 0.3 else rng.choice(SLAB['side'])))
    # grass tufts in the back gaps
    for k in range(8):
        x, y = rng.uniform(-2.8, 2.8), rng.uniform(-0.6, 1.4)
        for b in range(3):
            a = rng.uniform(0, 6.3)
            base = Vector((x, y, 0.02))
            tip = base + Vector((math.cos(a) * 0.12, math.sin(a) * 0.12, rng.uniform(0.35, 0.55)))
            w = Vector((-math.sin(a), math.cos(a), 0)) * 0.05
            mb.f(mb.vs([base - w, base + w, tip]), rng.choice(('#6f9a35', '#5e8a2e', '#86aa50')))
    return mb


def build_stone_steps():
    rng = R(6404)
    mb = MB()
    NS, rise, run, W = 10, 0.25, 0.4, 2.5
    y0 = -2.0

    def stepcol(n, m, topc, riser):
        if n.z > 0.8:
            return topc
        if n.z > 0.3:
            return tint(topc, 0.9)
        if n.y < -0.6:
            return riser
        return STEP['side']
    # dark core under the stair (shows through the gaps between blocks)
    core = [(-W / 2 + 0.05, y0 + 0.05), (W / 2 - 0.05, y0 + 0.05), (W / 2 - 0.05, 2.0), (-W / 2 + 0.05, 2.0)]
    for k in range(NS):
        ya = y0 + k * run
        zt = (k + 1) * rise
        mb.f(mb.vs([Vector((-W / 2 + 0.05, ya + 0.03, zt - 0.02)), Vector((W / 2 - 0.05, ya + 0.03, zt - 0.02)),
                    Vector((W / 2 - 0.05, ya + 0.03, zt - rise - 0.02)), Vector((-W / 2 + 0.05, ya + 0.03, zt - rise - 0.02))][::-1]),
             STEP['gap'])
        nb = rng.choice((2, 3, 3))
        cuts = sorted([-W / 2] + [rng.uniform(-W / 2 + 0.6, W / 2 - 0.6) for _ in range(nb - 1)] + [W / 2])
        for b in range(nb):
            x0, x1 = cuts[b] + 0.025, cuts[b + 1] - 0.025
            if x1 - x0 < 0.35:
                continue
            fy = ya + rng.uniform(-0.03, 0.04)
            ht = zt + rng.uniform(-0.03, 0.02)
            poly = [(x0, fy), (x1, fy + rng.uniform(-0.03, 0.03)), (x1, ya + run + 0.12), (x0, ya + run + 0.12)]
            bot = [Vector((px, py, zt - rise - 0.35)) for px, py in poly]
            top = [Vector((px, py, ht - 0.04)) for px, py in poly]
            topc, riser = rng.choice(STEP['top']), rng.choice(STEP['riser'])
            block(mb, rng, bot, top, 0.04, [0.97, 0.97, 0.99, 0.99],
                  tilt=(rng.uniform(-0.02, 0.02), rng.uniform(-0.02, 0.02)),
                  colfn=lambda n, m, topc=topc, riser=riser: stepcol(n, m, topc, riser))
    # mossy edges: moss pads creeping over the outer ends of the steps
    for side in (-1, 1):
        for k in range(NS):
            if rng.random() < 0.3:
                continue
            ya = y0 + k * run
            zt = (k + 1) * rise
            x_out = side * W / 2
            w = rng.uniform(0.18, 0.45)
            pts = [(x_out + side * 0.04, ya + 0.02), (x_out - side * w, ya + rng.uniform(0.05, 0.15)),
                   (x_out - side * w * 0.7, ya + run - 0.02), (x_out + side * 0.04, ya + run + 0.05)]
            if side < 0:
                pts = pts[::-1]
            I = mb.vs([Vector((px, py, zt + 0.025)) for px, py in pts])
            mb.f(I, rng.choice((MOSS['lit'], MOSS['mid'])))
            J = mb.vs([Vector((px + side * 0.03, py, zt - rng.uniform(0.1, 0.22))) for px, py in pts])
            for i in range(4):
                j = (i + 1) % 4
                q = [J[i], J[j], I[j], I[i]]
                mb.f(q, MOSS['dark'])
        # low basalt kerb stones with moss tops along the side
        for k in range(5):
            yy = y0 + 0.35 + k * 0.82
            zt = min(2.5, (yy - y0) / run * rise + 0.35)
            column(mb, rng, side * (W / 2 + 0.3), yy, -0.4, zt + rng.uniform(0.0, 0.3), rng.uniform(0.3, 0.42),
                   sides=rng.choice((4, 5, 5)), seg=(0.8, 1.6), top_moss=0.8, top_tilt=0.15)
    fern(mb, rng, (-W / 2 - 0.35, -1.4, 0.6), scale=0.62, fronds=8)
    fern(mb, rng, (W / 2 + 0.35, 0.6, 2.0), scale=0.55, fronds=7)
    return mb


def build_fern():
    rng = R(7101)
    mb = MB()
    fern(mb, rng, (0, 0, 0.02), scale=1.05, fronds=13)
    fern(mb, rng, (0.12, -0.05, 0.02), scale=0.7, fronds=6, mound=False)
    return mb


def build_vines():
    rng = R(7202)
    mb = MB()
    vine_curtain(mb, rng, (0, 0, 0), 3.0, 5.0, 12, leaf_size=1.1, lip=True)
    return mb


def build_rope_bridge():
    rng = R(8101)
    mb = MB()
    span, sag, Wd = 50.0, 3.0, 1.8
    half = span / 2

    def deck(x):
        return -sag * (1 - (x / half) ** 2)

    def slope(x):
        return 2 * sag * x / half ** 2
    x = -half + 0.45
    while x < half - 0.4:
        z = deck(x)
        ang = math.atan(slope(x))
        rm = Matrix.Rotation(-ang, 3, 'Y') @ Matrix.Rotation(rng.uniform(-0.03, 0.03), 3, 'Z')
        pc = rng.choice(BRIDGE['plank'])
        ln = Wd + rng.uniform(-0.12, 0.08)
        boxv(mb, (x, rng.uniform(-0.05, 0.05), z), (0.26, ln, 0.06), rm,
             lambda n, pc=pc: tint(pc, 1.25) if n.z > 0.7 else pc if n.z > -0.5 else tint(pc, 0.7))
        x += 0.36 + rng.uniform(-0.02, 0.03)
    N = 44
    xs = [-half + span * i / N for i in range(N + 1)]
    for sy in (-1, 1):
        y = sy * (Wd / 2 - 0.08)
        # deck ropes under the plank ends
        tube(mb, [Vector((xx, y, deck(xx) - 0.06)) for xx in xs], 0.045, BRIDGE['rope'], col2=BRIDGE['rope_d'])
        # handrails
        tube(mb, [Vector((xx, y * 1.05, deck(xx) + 1.25 - 0.22 * (1 - (xx / half) ** 2))) for xx in xs], 0.045,
             BRIDGE['rope'], col2=BRIDGE['rope_d'])
        # hangers with knots
        hx = -half + 2.0
        while hx < half - 1.0:
            zb = deck(hx) - 0.06
            zt = deck(hx) + 1.25 - 0.22 * (1 - (hx / half) ** 2)
            tube(mb, [Vector((hx, y, zb)), Vector((hx, y * 1.03, zt + 0.08))], 0.025, BRIDGE['rope_d'], sides=4)
            k = mb.vs([Vector((hx, y, zt + 0.17)), Vector((hx + 0.07, y, zt + 0.08)), Vector((hx, y + 0.07, zt + 0.08)),
                       Vector((hx - 0.07, y, zt + 0.08)), Vector((hx, y - 0.07, zt + 0.08)), Vector((hx, y, zt - 0.01))])
            for a in range(4):
                b = a % 4 + 1
                c = (a + 1) % 4 + 1
                mb.f([k[0], k[b], k[c]], BRIDGE['rope'])
                mb.f([k[5], k[c], k[b]], BRIDGE['rope_d'])
            hx += 2.0
        # end posts, anchor ropes and stakes
        for sx in (-1, 1):
            px = sx * (half + 0.1)
            column_post(mb, rng, px, sy * (Wd / 2 + 0.05), 1.55)
            top = Vector((px, sy * (Wd / 2 + 0.05), 1.5))
            stake = Vector((px + sx * 2.2, sy * (Wd / 2 + 0.35), 0.0))
            tube(mb, [top, (top + stake) / 2 + Vector((0, 0, -0.1)), stake], 0.04, BRIDGE['rope'], col2=BRIDGE['rope_d'])
            column_post(mb, rng, stake.x, stake.y, 0.45, r=0.08)
    # landing boards at each end
    for sx in (-1, 1):
        for k in range(3):
            xx = sx * (half + 0.35 + k * 0.32)
            pc = rng.choice(BRIDGE['plank'])
            boxv(mb, (xx, 0, 0.02), (0.28, Wd + 0.2, 0.08), Matrix.Identity(3),
                 lambda n, pc=pc: tint(pc, 1.25) if n.z > 0.7 else pc)
    return mb


def column_post(mb, rng, x, y, h, r=0.13):
    ring = poly_ring(rng, 6, r, rng.uniform(0, 1), (0.95, 1.05), 0.05)
    bot = [Vector((x + px, y + py, -0.6)) for px, py in ring]
    top = [Vector((x + px, y + py, h - 0.08)) for px, py in ring]
    block(mb, rng, bot, top, 0.08, 0.55, colfn=lambda n, m: BRIDGE['post'] if n.z > 0.3 or n.y < 0 else BRIDGE['post_d'])


def build_pine():
    rng = R(9101)
    mb = MB()
    Htot = 16.0
    # trunk
    sides = 7
    zs = [-0.4, 1.5, 4.0, 8.0, 12.0, 15.2]
    rings = []
    for k, z in enumerate(zs):
        r = 0.42 * (1 - z / 16.5) ** 0.9 + 0.04
        ox = 0.06 * math.sin(k * 1.3)
        rings.append(mb.vs([Vector((ox + math.cos(2 * math.pi * i / sides + 0.2) * r, math.sin(2 * math.pi * i / sides + 0.2) * r, z))
                            for i in range(sides)]))
    for k in range(len(rings) - 1):
        for i in range(sides):
            j = (i + 1) % sides
            q = [rings[k][i], rings[k][j], rings[k + 1][j], rings[k + 1][i]]
            n = mb.nrm(q)
            mb.f(q, PINE['trunk'] if (-n.y * 0.7 - n.x * 0.5) > -0.1 else PINE['trunk_d'])
    # root flare
    for k in range(5):
        a = 2 * math.pi * k / 5 + 0.4
        out = Vector((math.cos(a), math.sin(a), 0))
        side = Vector((-math.sin(a), math.cos(a), 0))
        p_tip = out * rng.uniform(0.85, 1.05) + Vector((0, 0, -0.1))
        p_top = out * 0.3 + Vector((0, 0, rng.uniform(1.0, 1.5)))
        pa, pb = out * 0.3 + side * 0.22, out * 0.3 - side * 0.22
        I = mb.vs([p_tip, pa + Vector((0, 0, -0.1)), p_top, pb + Vector((0, 0, -0.1))])
        mb.f([I[0], I[2], I[1]], PINE['trunk'])
        mb.f([I[0], I[3], I[2]], PINE['trunk_d'])
    # foliage tiers: jagged drooping star skirts
    T = 12
    for k in range(T):
        t = k / (T - 1)
        zb = 3.4 + t * 10.9
        h = 2.0 - 0.9 * t
        Rr = 2.7 * (1 - t) ** 0.85 + 0.45
        n = 9 if k < 8 else 7
        rot = rng.uniform(0, 6.3)
        for layer in range(2 if k < 9 else 1):
            lr = Rr * (1.0 if layer == 0 else 0.7)
            lz = zb + layer * h * 0.45
            apex = mb.v((0, 0, lz + h * (1.0 if layer == 0 else 0.75)))
            under = mb.v((0, 0, lz + h * 0.32))
            rim = []
            for i in range(2 * n):
                a = rot + layer * math.pi / n + i * math.pi / n
                if i % 2 == 0:
                    rr = lr * rng.uniform(0.88, 1.1)
                    z = lz - rng.uniform(0.15, 0.4)
                else:
                    rr = lr * rng.uniform(0.5, 0.62)
                    z = lz + h * 0.22
                rim.append(mb.v((math.cos(a) * rr, math.sin(a) * rr, z)))
            for i in range(2 * n):
                j = (i + 1) % (2 * n)
                q = [rim[i], rim[j], apex]
                nn = mb.nrm(q)
                lit = -nn.y * 0.6 - nn.x * 0.5
                c = PINE['lit'] if lit > 0.45 else PINE['top'] if lit > 0.0 else PINE['mid'] if lit > -0.45 else PINE['dark']
                mb.f(q, c)
                if layer == 0:
                    mb.f([rim[j], rim[i], under], PINE['under'])
    # tip
    tip = mb.v((0, 0, Htot))
    ring = mb.vs([Vector((math.cos(2 * math.pi * i / 6) * 0.35, math.sin(2 * math.pi * i / 6) * 0.35, Htot - 1.6)) for i in range(6)])
    for i in range(6):
        mb.f([ring[i], ring[(i + 1) % 6], tip], PINE['top'] if i % 2 else PINE['lit'])
    return mb


# --- registry, export, previews, props.json ----------------------------------------------------

PROPS = {
    'wf_basalt_cliff': (build_basalt_cliff, True, ('three_quarter', 'front')),
    'wf_basalt_cliff_low': (build_basalt_cliff_low, True, ('three_quarter', 'front')),
    'wf_basalt_columns': (build_basalt_columns, False, ('three_quarter',)),
    'wf_fall_tall': (build_fall_tall, True, ('front', 'side')),
    'wf_fall_mid': (build_fall_mid, False, ('front', 'side')),
    'wf_cascade_steps': (build_cascade_steps, True, ('three_quarter', 'front')),
    'wf_mist': (build_mist, False, ('three_quarter',)),
    'wf_rainbow': (build_rainbow, False, ('front',)),
    'wf_crystals': (build_crystals, False, ('three_quarter',)),
    'wf_crystals_small': (build_crystals_small, False, ('three_quarter',)),
    'wf_rim_slabs': (build_rim_slabs, False, ('three_quarter',)),
    'wf_stone_steps': (build_stone_steps, False, ('three_quarter',)),
    'wf_fern': (build_fern, False, ('three_quarter',)),
    'wf_vines': (build_vines, False, ('front',)),
    'wf_rope_bridge': (build_rope_bridge, True, ('three_quarter', 'detail')),
    'wf_pine': (build_pine, False, ('three_quarter',)),
}

# Placement metadata for props.json. Colliders are in game space (y up), centred at (0, half_y, 0).
META = {
    'wf_basalt_cliff': dict(collider='box', footprint=17.0, notes=(
        'Cliff of faceted basalt columns, front faces -Y (glTF +Z); place over steep terrain, base sinks 3 m '
        'below the pivot for slopes. Notch at x -4.4..4.4 with a lip slab at z 40 (front edge y -3.1): put '
        'wf_fall_tall at cliff-local (0, -1.6, 0), same yaw, wf_mist and wf_rainbow in front of it.')),
    'wf_basalt_cliff_low': dict(collider='box', footprint=14.0, notes=(
        'Lower cliff with a stepped top (high on -X, low on +X), front faces -Y; base sinks 3 m. Notch at x '
        '1.3..6.7 with a lip slab at z 16 (front edge y -3.1): put wf_fall_mid at cliff-local (4.0, -1.9, 0).')),
    'wf_basalt_columns': dict(collider='cylinder', footprint=3.0, notes=(
        'Cluster of 9 basalt columns 0.5-6 m tall for pool edges and stepping; pivot at the cluster centre, '
        'base sinks 1 m.')),
    'wf_fall_tall': dict(collider='none', footprint=5.0, notes=(
        'Tall fall sheet, front faces -Y. Pivot is the bottom centre at the pool surface (z 0); the lip is at '
        'z 40, 1.5 m toward -Y. fx_water UVs: V 0 at the lip, 4 repeats to the bottom (scroll V). Foam skirt '
        'at the base. Pair with wf_basalt_cliff (see its notes) and wf_mist.')),
    'wf_fall_mid': dict(collider='none', footprint=3.5, notes=(
        'Mid fall, 5 m wide and 16 m tall, front faces -Y. Pivot bottom centre at the pool surface; lip at z '
        '16, 1.2 m toward -Y. V 0 at the lip, 10 m per V. Pairs with wf_basalt_cliff_low.')),
    'wf_cascade_steps': dict(collider='box', footprint=7.0, notes=(
        'Five basalt ledges (2.4 m rise, 2 m deep) with water spilling forward toward -Y into the pool at z 0; '
        'top ledge at z 12 at the back (+Y). Box collider covers the whole rock mass; base sinks 2 m.')),
    'wf_mist': dict(collider='none', footprint=0.0, notes=(
        'Soft mist mound for the base of a fall (fx_water, pale; V = 0 at the top, 1 at the pool, so a '
        'scroll drifts it slowly). Pivot on the pool surface; place under the fall with its back (+Y) against '
        'the sheet. Decorative.')),
    'wf_rainbow': dict(collider='none', footprint=0.0, notes=(
        'Purely decorative: a thin 7-band rainbow arc (fx_glow), 16 m wide, 10 m tall, in the XZ plane facing '
        '-Y. Ends dip 0.6 m below the pivot so they vanish into mist; place in the spray in front of a fall.')),
    'wf_crystals': dict(collider='cylinder', footprint=0.9, notes=(
        'Glowing blue crystal cluster (fx_glow) on a dark slate seat, 1.5 m tall. Pool edges, between rim slabs.')),
    'wf_crystals_small': dict(collider='cylinder', footprint=0.5, notes='Small glowing crystal cluster, 0.8 m tall.'),
    'wf_rim_slabs': dict(collider='box', footprint=3.3, notes=(
        'Flat irregular stone slabs edging a pool, 6 x 3 m, ~0.4 m tall; the pool side is -Y. Walkable: the box '
        'is low (0.4 m) so use it only if the controller steps up 0.4 m, otherwise treat as ground.')),
    'wf_stone_steps': dict(collider='none', footprint=2.6, notes=(
        'Stone-slab stair, 2.5 m wide, rising 2.5 m over 4 m from -Y (bottom, front) to +Y (top), with mossy '
        'kerb stones. No collider: give it a ramp collider or let the terrain carry the slope.')),
    'wf_fern': dict(collider='none', footprint=0.8, notes='Fern clump ~1.6 m across with arching fronds. Ledges, pool edges, cliff bases.'),
    'wf_vines': dict(collider='none', footprint=0.0, notes=(
        'Curtain of hanging vines 3 m wide, up to 5 m long. Pivot at the TOP (the mossy roll that sits on a '
        'ledge edge); hangs down -Z with leaves facing -Y. Place on cliff ledges.')),
    'wf_rope_bridge': dict(collider='none', footprint=26.0, notes=(
        'Rope-and-plank suspension bridge spanning X: end posts at x +-25, deck 1.8 m wide, sagging 3 m to '
        'z -3 at mid-span. Pivot at the middle of the span at anchor height (deck ends at z 0); anchor stakes at '
        'x +-27.2. No collider: build a walk collider along the deck curve z = -3 * (1 - (x / 25)^2).')),
    'wf_pine': dict(collider='cylinder', footprint=2.5, notes='Tall slender cliff-top pine, 16 m; cylinder collider is the trunk.'),
}


def bbox(obj):
    pts = [obj.matrix_world @ v.co for v in obj.data.vertices]
    lo = Vector((min(p[i] for p in pts) for i in range(3)))
    hi = Vector((max(p[i] for p in pts) for i in range(3)))
    return lo, hi


FLAT_PREVIEW = {'wf_fall_tall', 'wf_fall_mid', 'wf_mist', 'wf_rainbow', 'wf_crystals', 'wf_crystals_small'}


def render(obj, name, views, size=720):
    scene = bpy.context.scene
    try:
        scene.render.engine = 'BLENDER_WORKBENCH'
    except TypeError:
        pass
    sh = scene.display.shading
    sh.light = 'FLAT' if name in FLAT_PREVIEW else 'STUDIO'
    sh.color_type = 'VERTEX'
    sh.show_shadows = True
    sh.show_cavity = False
    sh.show_backface_culling = False
    scene.render.resolution_x = size
    scene.render.resolution_y = size
    world = scene.world or bpy.data.worlds.new('World')
    scene.world = world
    world.color = (0.55, 0.62, 0.70)
    sh.background_type = 'WORLD'
    lo, hi = bbox(obj)
    centre = (lo + hi) / 2
    radius = max((hi - lo).length / 2, 0.5)
    cam_data = bpy.data.cameras.new('preview_cam')
    cam_data.lens = 50
    cam_data.clip_end = 5000
    cam = bpy.data.objects.new('preview_cam', cam_data)
    scene.collection.objects.link(cam)
    scene.camera = cam
    dirs = {'three_quarter': Vector((1.0, -1.3, 0.75)), 'front': Vector((0.0, -1.0, 0.18)),
            'side': Vector((1.0, -0.15, 0.2)), 'low': Vector((0.5, -1.2, -0.25))}
    details = {'detail': (Vector((-0.8, -1.2, 0.5)), Vector((-21.0, 0.0, -0.8)), 9.0)}
    os.makedirs(os.path.join(OUT, 'preview'), exist_ok=True)
    for v in views:
        if v in details:
            d, tgt, dist = details[v]
            cam.location = tgt + d.normalized() * dist
            cam.rotation_euler = (tgt - cam.location).to_track_quat('-Z', 'Y').to_euler()
            scene.render.filepath = os.path.join(OUT, 'preview', f'{name}_{v}.png')
            bpy.ops.render.render(write_still=True)
            continue
        d = dirs[v].normalized()
        cam.location = centre + d * radius * 3.0
        cam.rotation_euler = (centre - cam.location).to_track_quat('-Z', 'Y').to_euler()
        scene.render.filepath = os.path.join(OUT, 'preview', f'{name}_{v}.png')
        bpy.ops.render.render(write_still=True)
    bpy.data.objects.remove(cam)


def props_entry(name, obj):
    lo, hi = bbox(obj)
    dims = hi - lo
    meta = META[name]
    # height above the pivot; props that hang below it (vines, bridge deck) report their full drop
    full = name in ('wf_vines', 'wf_rope_bridge')
    size = [round(dims.x, 2), round(dims.z if full else hi.z - max(lo.z, 0.0), 2), round(dims.y, 2)]
    kind = meta['collider']
    if kind == 'box':
        top = hi.z
        if name == 'wf_rim_slabs':
            top = 0.4
        col = {'kind': 'box', 'half': [round(dims.x / 2 * 0.92, 2), round(top / 2, 2), round(dims.y / 2 * 0.85, 2)]}
    elif kind == 'cylinder':
        if name == 'wf_pine':
            col = {'kind': 'cylinder', 'radius': 0.45, 'height': 16.0}
        elif name == 'wf_basalt_columns':
            col = {'kind': 'cylinder', 'radius': 2.1, 'height': round(hi.z, 2)}
        else:
            col = {'kind': 'cylinder', 'radius': round(max(dims.x, dims.y) / 2 * 0.6, 2), 'height': round(hi.z, 2)}
    else:
        col = {'kind': 'none'}
    return {'landmark': PROPS[name][1], 'collider': col, 'footprint': meta['footprint'], 'size': size,
            'notes': meta['notes']}


def write_props_json(entries):
    path = os.path.join(OUT, 'props.json')
    data = {}
    if os.path.exists(path):
        with open(path) as fh:
            data = json.load(fh)
    data.update(entries)
    data = {k: data[k] for k in PROPS if k in data}
    with open(path, 'w') as fh:
        json.dump(data, fh, indent=2)
        fh.write('\n')


def build_sheet():
    """One Workbench render of the whole kit, each prop scaled to a tile, with labels."""
    ek.reset()
    names = list(PROPS)
    cols = 4
    objs = []
    for i, name in enumerate(names):
        obj = PROPS[name][0]().obj(name)
        lo, hi = bbox(obj)
        dims = hi - lo
        s = 1.0 / max(dims.x, dims.y, dims.z)
        c = (lo + hi) / 2
        gx, gy = i % cols, i // cols
        base = Vector((gx * 1.5, 0, -gy * 1.55))
        obj.scale = (s, s, s)
        obj.rotation_euler = (0, 0, math.radians(-28))
        bpy.context.view_layer.update()
        lo, hi = bbox(obj)
        obj.location = base - Vector(((lo.x + hi.x) / 2, (lo.y + hi.y) / 2, lo.z))
        objs.append(obj)
        cu = bpy.data.curves.new(f'lbl_{name}', 'FONT')
        cu.body = name
        cu.size = 0.085
        cu.align_x = 'CENTER'
        t = bpy.data.objects.new(f'lbl_{name}', cu)
        bpy.context.scene.collection.objects.link(t)
        t.location = base + Vector((0.0, -0.7, -0.2))
        t.rotation_euler = (math.radians(90), 0, 0)
        bpy.context.view_layer.objects.active = t
        for o in bpy.context.scene.objects:
            o.select_set(False)
        t.select_set(True)
        bpy.ops.object.convert(target='MESH')
        ek.paint(t, '#15181d')
    scene = bpy.context.scene
    scene.render.engine = 'BLENDER_WORKBENCH'
    sh = scene.display.shading
    sh.light = 'STUDIO'
    sh.color_type = 'VERTEX'
    sh.show_shadows = False
    sh.show_backface_culling = False
    world = scene.world or bpy.data.worlds.new('World')
    scene.world = world
    world.color = (0.62, 0.69, 0.76)
    sh.background_type = 'WORLD'
    scene.render.resolution_x = 1800
    scene.render.resolution_y = 1800
    cam_data = bpy.data.cameras.new('sheet_cam')
    cam_data.type = 'ORTHO'
    cam_data.ortho_scale = 6.4
    cam_data.clip_end = 1000
    cam = bpy.data.objects.new('sheet_cam', cam_data)
    scene.collection.objects.link(cam)
    scene.camera = cam
    centre = Vector((1.5 * 1.5, 0.0, -1.5 * 1.55 + 0.3))
    d = Vector((0.0, -1.0, 0.3)).normalized()
    cam.location = centre + d * 20
    cam.rotation_euler = (centre - cam.location).to_track_quat('-Z', 'Y').to_euler()
    scene.render.filepath = os.path.join(OUT, 'preview', '_kit_sheet.png')
    bpy.ops.render.render(write_still=True)


def main():
    wanted = ek.only_args()
    sheet = '--sheet' in wanted
    wanted = [w for w in wanted if w != '--sheet']
    caps = {n: (10000 if lm else 4000) for n, (_, lm, _) in PROPS.items()}
    entries = {}
    if not sheet or wanted:
        for name, (fn, lm, views) in PROPS.items():
            if wanted and name not in wanted:
                continue
            ek.reset()
            obj = fn().obj(name)
            ek.export_prop(obj, KIT, name, caps[name])
            render(obj, name, views)
            entries[name] = props_entry(name, obj)
        write_props_json(entries)
    if sheet or not wanted:
        build_sheet()


main()
