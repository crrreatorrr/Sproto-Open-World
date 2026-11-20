"""
Town environment kit: a hillside half-timbered fantasy town (docs/concepts/town.webp).

Cream plaster and dark timber framing over stone ground floors, steep slate-blue (mossy) and
terracotta roofs with dormers and brick chimneys, a stone clock tower, a round keep, an arch
bridge over a canal, cobbles, market stalls, lamps, planters and fences.

Run (from the repo root):
    /Applications/Blender.app/Contents/MacOS/Blender --background --factory-startup \
        --python art/tools/env/town.py [-- prop_name ...]
    ... --python art/tools/env/town.py -- --sheet     (contact sheet of the whole kit)
    ... --python art/tools/env/town.py -- --json      (only rewrite props.json)

Everything is built with a small face builder (MB) on top of envkit: one mesh per prop, flat
faces, colour per face (COLOR_0), materials env_kit and fx_glow. Randomness is seeded per prop.
"""
import json
import math
import os
import random
import sys

import bpy
from mathutils import Matrix, Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import envkit as ek  # noqa: E402

KIT = 'town'
V = Vector
X = V((1, 0, 0))
Y = V((0, 1, 0))
Z = V((0, 0, 1))

# --- palette (sampled from the concept, flattened to painterly tones) -----------------------
PLASTER = '#f0ddb8'
PLASTER_SH = '#e4cca4'
TIMBER = '#7f4d2a'
TIMBER_LT = '#9a6438'
TIMBER_DK = '#55311c'
SLATE = ['#3463b4', '#2d579f', '#3b6fc0', '#28508f', '#4678c6', '#3160ab']
SLATE_LT = '#6f9ad8'
SLATE_DECK = '#1b2f5c'
MOSS = ['#8ea63a', '#a2b54b', '#7b9534', '#b0bf58']
RED = ['#b6563a', '#a44b34', '#c26646', '#983f2e', '#b05b44', '#8c3a2c']
RED_LT = '#cf7650'
RED_DECK = '#4e2219'
STONE = ['#9b9ea9', '#8a8f9f', '#b0a68f', '#a09887', '#7f8699', '#b9ae96']
STONE_BASE = '#a39d90'
TSTONE = ['#cbbb99', '#bdac8c', '#d4c6a6', '#b2a387', '#c6b48f']
TSTONE_BASE = '#c2b292'
QUOIN = ['#7e8499', '#8d92a6', '#727990', '#9599aa']
BRICK = ['#b5573a', '#a24b33', '#c0664a', '#99442f']
BRICK_CAP = '#d9ccb2'
IRON = '#26262c'
IRON_LT = '#3a3a42'
GLOW = '#ffd27a'
WOOD = ['#8a5a32', '#9c6a3c', '#7a4c2a', '#a87444']
WOOD_DK = '#5e3a20'
FLOWERS = ['#d8302c', '#ef7fa8', '#f6efe6', '#e64b3c', '#f4a3c0', '#d8302c']
LEAF = ['#4c8a34', '#5e9c3c', '#3f7a2e']
GLASS = '#3b3a4a'
GLASS_LT = '#545468'
COBBLE = ['#c9ae8a', '#bba07f', '#d4bf9d', '#ad9478', '#c2b29a', '#b8a58e', '#a99a86']
GROUT = '#7c6c5a'
CAP = ['#ddc99d', '#e6d6ad', '#cdb98e', '#d6c49a', '#c8b48a']
CANAL = ['#9b998d', '#8d9197', '#aaa189', '#8f8a7c', '#7e8590', '#a49c8a']
BRIDGE = ['#a8a492', '#959486', '#b4ae98', '#8c8f84', '#bdb59c', '#9fa293', '#a3a58a']
MORTAR = '#77756b'
AWN_RED = '#cf4a2f'
AWN_CREAM = '#f2e4c2'
AWN_BLUE = '#4a69ae'
AWN_YEL = '#e8b448'
AWN_LAV = '#8389b9'
PRODUCE = ['#d8382c', '#f08a2a', '#f2c23a', '#8cbf3a', '#e85a30', '#b4d04a', '#c9302c']


def hx(c):
    c = c.lstrip('#')
    return [int(c[i:i + 2], 16) for i in (0, 2, 4)]


def mix(a, b, t):
    pa, pb = hx(a), hx(b)
    return '#%02x%02x%02x' % tuple(int(round(pa[i] + (pb[i] - pa[i]) * t)) for i in range(3))


def shade(c, f):
    p = hx(c)
    return '#%02x%02x%02x' % tuple(max(0, min(255, int(round(v * f)))) for v in p)


def newell(pts):
    n = V((0, 0, 0))
    k = len(pts)
    for i in range(k):
        a, b = pts[i], pts[(i + 1) % k]
        n.x += (a.y - b.y) * (a.z + b.z)
        n.y += (a.z - b.z) * (a.x + b.x)
        n.z += (a.x - b.x) * (a.y + b.y)
    return n


def basis(axis):
    axis = V(axis).normalized()
    ref = X if abs(axis.dot(X)) < 0.9 else Y
    a = axis.cross(ref).normalized()
    b = axis.cross(a).normalized()
    return a, b, axis


class MB:
    """Face soup builder: polygons with a colour and a material index (0 kit, 1 glow, 2 water)."""

    def __init__(self):
        self.faces = []

    def poly(self, pts, col, mat=0, out=None):
        pts = [V(p) for p in pts]
        if out is not None and newell(pts).dot(V(out)) < 0:
            pts = pts[::-1]
        self.faces.append((pts, col, mat))

    def merge(self, other, M=None):
        if M is None:
            self.faces.extend(other.faces)
            return
        flip = M.to_3x3().determinant() < 0
        for pts, col, mat in other.faces:
            q = [M @ p for p in pts]
            self.faces.append((q[::-1] if flip else q, col, mat))

    def obox(self, c, ax, ay, az, h, col, mat=0, skip=(), cols=None, jit=0.0, rng=None):
        c = V(c)
        ax, ay, az = V(ax).normalized(), V(ay).normalized(), V(az).normalized()
        P = {}
        for sx in (-1, 1):
            for sy in (-1, 1):
                for sz in (-1, 1):
                    p = c + ax * (sx * h[0]) + ay * (sy * h[1]) + az * (sz * h[2])
                    if jit and rng:
                        p += V((rng.uniform(-jit, jit), rng.uniform(-jit, jit), rng.uniform(-jit, jit)))
                    P[(sx, sy, sz)] = p
        axes = (ax, ay, az)
        names = 'xyz'
        for i in range(3):
            for s in (-1, 1):
                key = ('+' if s > 0 else '-') + names[i]
                if key in skip:
                    continue
                quad = []
                for a, b in ((-1, -1), (1, -1), (1, 1), (-1, 1)):
                    idx = [0, 0, 0]
                    idx[i] = s
                    others = [j for j in range(3) if j != i]
                    idx[others[0]] = a
                    idx[others[1]] = b
                    quad.append(P[tuple(idx)])
                fc = cols.get(key, col) if cols else col
                self.poly(quad, fc, mat, out=axes[i] * s)

    def box(self, x0, x1, y0, y1, z0, z1, col, mat=0, skip=('-z',), cols=None, jit=0.0, rng=None):
        self.obox(((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2), X, Y, Z,
                  (abs(x1 - x0) / 2, abs(y1 - y0) / 2, abs(z1 - z0) / 2), col, mat, skip, cols, jit, rng)

    def beam(self, p0, p1, n, w, d, col, ends=False, mat=0, jit=0.0, rng=None, flat=False):
        p0, p1, n = V(p0), V(p1), V(n).normalized()
        a = p1 - p0
        L = a.length
        if L < 1e-4:
            return
        a.normalize()
        b = n.cross(a).normalized()
        skip = ['-z'] + ([] if ends else ['-x', '+x']) + (['-y', '+y'] if flat else [])
        self.obox((p0 + p1) / 2 + n * (d / 2), a, b, n, (L / 2, w / 2, d / 2), col, mat, skip, None, jit, rng)

    def cyl(self, c, r, h, seg, col, r2=None, axis=Z, caps=(False, True), phase=0.0, mat=0,
            cols=None, cap_col=None):
        c = V(c)
        a, b, ax = basis(axis)
        r2 = r if r2 is None else r2
        lo = [c + (a * math.cos(phase + 2 * math.pi * i / seg) + b * math.sin(phase + 2 * math.pi * i / seg)) * r
              for i in range(seg)]
        hi = [c + ax * h + (a * math.cos(phase + 2 * math.pi * i / seg) + b * math.sin(phase + 2 * math.pi * i / seg)) * r2
              for i in range(seg)]
        for i in range(seg):
            j = (i + 1) % seg
            mid = (lo[i] + lo[j]) / 2 - c
            fc = cols[i % len(cols)] if cols else col
            if r2 < 1e-4:
                self.poly([lo[i], lo[j], hi[i]], fc, mat, out=mid)
            else:
                self.poly([lo[i], lo[j], hi[j], hi[i]], fc, mat, out=mid - ax * mid.dot(ax))
        if caps[0]:
            self.poly(lo, cap_col or col, mat, out=-ax)
        if caps[1] and r2 > 1e-4:
            self.poly(hi, cap_col or col, mat, out=ax)

    def octa(self, c, r, col, squash=1.0, rng=None, jit=0.0, mat=0, top_only=False):
        c = V(c)
        pts = [c + V((r, 0, 0)), c + V((0, r, 0)), c + V((-r, 0, 0)), c + V((0, -r, 0))]
        if rng and jit:
            pts = [p + V((rng.uniform(-jit, jit), rng.uniform(-jit, jit), 0)) for p in pts]
        top = c + V((0, 0, r * squash))
        bot = c + V((0, 0, -r * squash * 0.6))
        for i in range(4):
            a, b = pts[i], pts[(i + 1) % 4]
            m = (a + b) / 2 - c
            self.poly([a, b, top], col, mat, out=m + V((0, 0, 0.5 * r)))
            if not top_only:
                self.poly([b, a, bot], shade(col, 0.75), mat, out=m - V((0, 0, 0.5 * r)))

    def slab(self, top, n, thick, col_top, col_side, col_bot):
        """Convex polygon `top` extruded down along -n by thick."""
        top = [V(p) for p in top]
        n = V(n).normalized()
        bot = [p - n * thick for p in top]
        c = sum(top, V((0, 0, 0))) / len(top)
        self.poly(top, col_top, out=n)
        self.poly(bot, col_bot, out=-n)
        k = len(top)
        for i in range(k):
            j = (i + 1) % k
            m = (top[i] + top[j]) / 2 - c
            self.poly([top[i], top[j], bot[j], bot[i]], col_side, out=m - n * m.dot(n))

    def tris(self):
        return sum(len(p) - 2 for p, _, _ in self.faces)

    def build(self, name):
        mats = [ek.mat_kit(), ek.mat_glow(), ek.mat_water()]
        used = sorted({m for _, _, m in self.faces})
        slot = {m: i for i, m in enumerate(used)}
        verts, faces = [], []
        for pts, _, _ in self.faces:
            idx = []
            for p in pts:
                idx.append(len(verts))
                verts.append((p.x, p.y, p.z))
            faces.append(idx)
        me = bpy.data.meshes.new(name)
        me.from_pydata(verts, [], faces)
        me.update()
        for m in used:
            me.materials.append(mats[m])
        layer = me.color_attributes.new('Col', 'FLOAT_COLOR', 'CORNER')
        try:
            me.color_attributes.active_color = layer
            me.color_attributes.render_color_index = 0
        except (AttributeError, TypeError):
            pass
        cache = {}
        for poly, (_, col, m) in zip(me.polygons, self.faces):
            poly.material_index = slot[m]
            rgba = cache.get(col)
            if rgba is None:
                rgba = cache[col] = ek.hex_rgb(col)
            for li in poly.loop_indices:
                layer.data[li].color = rgba
        obj = bpy.data.objects.new(name, me)
        bpy.context.scene.collection.objects.link(obj)
        return obj


def T(x=0.0, y=0.0, z=0.0):
    return Matrix.Translation((x, y, z))


def Rz(deg):
    return Matrix.Rotation(math.radians(deg), 4, 'Z')


class Facade:
    """A wall plane seen from outside: s runs right along u, h runs up, d sticks out along n."""

    def __init__(self, O, u, n):
        self.O, self.u, self.n = V(O), V(u).normalized(), V(n).normalized()

    def p(self, s, h, d=0.0):
        return self.O + self.u * s + Z * h + self.n * d


def faces_of(x0, x1, y0, y1, z0):
    return {
        'front': (Facade((x0, y0, z0), X, -Y), x1 - x0),
        'right': (Facade((x1, y0, z0), Y, X), y1 - y0),
        'back': (Facade((x1, y1, z0), -X, Y), x1 - x0),
        'left': (Facade((x0, y1, z0), -Y, -X), y1 - y0),
    }


# --- small details -----------------------------------------------------------------------------

def fbeam(mb, F, s0, h0, s1, h1, w, d, col, ends=False, flat=False):
    mb.beam(F.p(s0, h0), F.p(s1, h1), F.n, w, d, col, ends, flat=flat)


def fblock(mb, F, s0, s1, h0, h1, d, col, skip_sides=False, d0=0.0):
    """A block proud of the facade by d (front, top, bottom and maybe sides)."""
    c = F.p((s0 + s1) / 2, (h0 + h1) / 2, d0 + d / 2)
    skip = ('-z', '-x', '+x') if skip_sides else ('-z',)
    mb.obox(c, F.u, Z, F.n, (abs(s1 - s0) / 2, abs(h1 - h0) / 2, d / 2), col, skip=skip)


def flowers(mb, c0, c1, rng, n=None, size=0.16):
    """Flower clump along a line from c0 to c1 (top of soil)."""
    c0, c1 = V(c0), V(c1)
    L = (c1 - c0).length
    n = n or max(3, int(L / 0.15))
    for i in range(max(2, n // 2)):
        t = (i + 0.5) / max(2, n // 2)
        mb.octa(c0.lerp(c1, t) + V((0, 0, 0.05)), size * 1.4, rng.choice(LEAF), 0.6, rng, 0.03, top_only=True)
    for i in range(n):
        t = (i + rng.uniform(0.15, 0.85)) / n
        p = c0.lerp(c1, t) + V((rng.uniform(-0.05, 0.05), rng.uniform(-0.05, 0.05), rng.uniform(0.09, 0.17)))
        mb.octa(p, size * rng.uniform(0.85, 1.15), rng.choice(FLOWERS), 0.5, rng, 0.02, top_only=True)


def flower_box(mb, F, s_c, h, w, rng, depth=0.3):
    s0, s1 = s_c - w / 2, s_c + w / 2
    fblock(mb, F, s0, s1, h - 0.24, h, depth, rng.choice(WOOD))
    mb.poly([F.p(s0 + 0.04, h + 0.01, 0.04), F.p(s1 - 0.04, h + 0.01, 0.04), F.p(s1 - 0.04, h + 0.01, depth - 0.04),
             F.p(s0 + 0.04, h + 0.01, depth - 0.04)], '#5b3d24', out=Z)
    # two small brackets
    for s in (s0 + 0.12, s1 - 0.12):
        fbeam(mb, F, s, h - 0.24, s, h - 0.42, 0.06, 0.12, TIMBER_DK, flat=True)
    flowers(mb, F.p(s0 + 0.1, h, depth / 2), F.p(s1 - 0.1, h, depth / 2), rng)


def window(mb, F, s_c, h0, w, h, rng, fbox=True, frame=TIMBER_LT, lattice=True, recess=0.0):
    s0, s1 = s_c - w / 2, s_c + w / 2
    mb.poly([F.p(s0, h0, 0.012 - recess), F.p(s1, h0, 0.012 - recess), F.p(s1, h0 + h, 0.012 - recess),
             F.p(s0, h0 + h, 0.012 - recess)], GLASS, out=F.n)
    fw, fd = 0.11, 0.09
    fbeam(mb, F, s0 - fw / 2, h0, s1 + fw / 2, h0, fw, fd, frame)
    fbeam(mb, F, s0 - fw / 2, h0 + h, s1 + fw / 2, h0 + h, fw, fd, frame)
    fbeam(mb, F, s0, h0, s0, h0 + h, fw, fd, frame)
    fbeam(mb, F, s1, h0, s1, h0 + h, fw, fd, frame)
    lw, ld = 0.045, 0.05
    fbeam(mb, F, s_c, h0, s_c, h0 + h, 0.07, 0.07, frame)
    if lattice:
        for a, b in ((s0, s_c), (s_c, s1)):
            fbeam(mb, F, a, h0, b, h0 + h, lw, ld, frame, flat=True)
            fbeam(mb, F, b, h0, a, h0 + h, lw, ld, frame, flat=True)
    else:
        fbeam(mb, F, s0, h0 + h * 0.55, s1, h0 + h * 0.55, 0.06, 0.06, frame)
    if fbox:
        flower_box(mb, F, s_c, h0 - 0.04, w + 0.1, rng)


def plank_door(mb, F, s_c, w, h, rng, arch=False, d=0.06, frame=TIMBER_DK):
    """Wooden plank door (optionally round-arched) on facade F standing at h=0."""
    n = max(3, int(w / 0.22))
    s0 = s_c - w / 2
    rise = w / 2 if arch else 0.0
    hs = h - rise
    for i in range(n):
        a, b = s0 + i * w / n, s0 + (i + 1) * w / n
        col = WOOD[i % 2] if not arch else ['#7a4a2a', '#6a3f24'][i % 2]
        top_a = hs + (math.sqrt(max(0.0, rise ** 2 - (a - s_c) ** 2)) if arch else 0)
        top_b = hs + (math.sqrt(max(0.0, rise ** 2 - (b - s_c) ** 2)) if arch else 0)
        pts = [F.p(a, 0, d), F.p(b, 0, d), F.p(b, top_b, d), F.p(a, top_a, d)]
        mb.poly(pts, col, out=F.n)
    for hh in (h * 0.25, h * 0.62):
        fbeam(mb, F, s0 + 0.05, hh, s0 + w - 0.05, hh, 0.07, d + 0.03, IRON_LT, ends=True)
    fblock(mb, F, s_c + w * 0.3, s_c + w * 0.36, h * 0.42, h * 0.5, d + 0.05, IRON)
    if not arch:
        fbeam(mb, F, s0 - 0.08, 0, s0 - 0.08, h + 0.08, 0.16, 0.1, frame)
        fbeam(mb, F, s0 + w + 0.08, 0, s0 + w + 0.08, h + 0.08, 0.16, 0.1, frame)
        fbeam(mb, F, s0 - 0.16, h + 0.08, s0 + w + 0.16, h + 0.08, 0.16, 0.12, frame, ends=True)


# --- walls -------------------------------------------------------------------------------------

def timber_facade(mb, F, W, H, wins, rng, sill=0.95, wh=1.15, braces=True):
    """Half-timber framing on a plaster wall: plates, posts, rails, braces and windows.
    wins: list of (s_centre, width[, flowerbox])."""
    tw, td = 0.2, 0.07
    col = TIMBER
    fbeam(mb, F, 0, 0.1, W, 0.1, tw, td, col)
    fbeam(mb, F, 0, H - 0.1, W, H - 0.1, tw, td, col)
    posts = [0.11, W - 0.11]
    for w in wins:
        posts += [w[0] - w[1] / 2 - 0.13, w[0] + w[1] / 2 + 0.13]
    posts.sort()
    full = []
    for a, b in zip(posts, posts[1:]):
        full.append(a)
        gap = b - a
        inside = any(abs((a + b) / 2 - w[0]) < w[1] / 2 for w in wins)
        if not inside and gap > 1.9:
            k = int(gap / 1.3)
            for i in range(1, k):
                full.append(a + gap * i / k)
    full.append(posts[-1])
    full = sorted(set(round(p, 3) for p in full))
    for p in full:
        fbeam(mb, F, p, 0.2, p, H - 0.2, 0.2 if p in (full[0], full[-1]) else 0.16, td, col)
    if wins:
        lo, hi = sill - 0.08, sill + wh + 0.08
    else:
        lo, hi = H * 0.36, H * 0.72
    fbeam(mb, F, 0.2, lo, W - 0.2, lo, 0.15, td, col)
    if hi < H - 0.35:
        fbeam(mb, F, 0.2, hi, W - 0.2, hi, 0.15, td, col)
    for i, (a, b) in enumerate(zip(full, full[1:]) if braces else []):
        mid = (a + b) / 2
        inside = any(abs(mid - w[0]) < w[1] / 2 for w in wins)
        gap = b - a
        if gap < 0.45:
            continue
        a2, b2 = a + 0.09, b - 0.09
        # below the sill rail
        if lo > 0.55:
            fbeam(mb, F, a2, 0.2, b2, lo - 0.07, 0.11, td * 0.9, col, flat=True)
            if inside:
                fbeam(mb, F, a2, lo - 0.07, b2, 0.2, 0.11, td * 0.9, col, flat=True)
        if not inside:
            left = mid < W / 2
            top = hi if hi < H - 0.35 else H - 0.2
            if left:
                fbeam(mb, F, a2, lo + 0.07, b2, top - 0.07, 0.13, td, col, flat=True)
            else:
                fbeam(mb, F, b2, lo + 0.07, a2, top - 0.07, 0.13, td, col, flat=True)
            if gap > 1.0 and (i % 2 == 0):
                fbeam(mb, F, (a2 + b2) / 2, lo + 0.07, (a2 + b2) / 2, top - 0.07, 0.11, td, col)
        if hi < H - 0.55 and gap > 0.6 and not inside:
            fbeam(mb, F, a2, hi + 0.07, b2, H - 0.2, 0.1, td * 0.9, col, flat=True)
    for w in wins:
        fb = w[2] if len(w) > 2 else True
        window(mb, F, w[0], sill, w[1], wh, rng, fbox=fb, lattice=fb)


def gable_face(mb, F, W, Hg, rng, wins=(), plaster=PLASTER):
    """Triangular half-timber gable end, base on F at h=0, apex at (W/2, Hg)."""
    mb.poly([F.p(0, 0), F.p(W, 0), F.p(W / 2, Hg)], plaster, out=F.n)
    td = 0.07
    col = TIMBER
    fbeam(mb, F, 0, 0.1, W, 0.1, 0.22, td, col)
    fbeam(mb, F, W / 2, 0.2, W / 2, Hg - 0.2, 0.18, td, col)
    hc = Hg * 0.5
    sc = (W / 2) * (1 - hc / Hg)
    fbeam(mb, F, sc + 0.1, hc, W - sc - 0.1, hc, 0.16, td, col)
    # rafters along the edges
    fbeam(mb, F, 0.3, 0.05, W / 2, Hg - 0.3, 0.2, td, col)
    fbeam(mb, F, W - 0.3, 0.05, W / 2, Hg - 0.3, 0.2, td, col)
    if wins:
        for s_c, w, h0, h in wins:
            window(mb, F, s_c, h0, w, h, rng, fbox=False, lattice=False)
        # studs either side of the windows
        for s_c, w, h0, h in wins:
            for s in (s_c - w / 2 - 0.14, s_c + w / 2 + 0.14):
                top = min(hc, Hg * (1 - abs(s - W / 2) / (W / 2))) - 0.1
                fbeam(mb, F, s, 0.2, s, top, 0.13, td, col)
    else:
        # V braces from the tie beam to the collar
        for sgn in (-1, 1):
            fbeam(mb, F, W / 2 + sgn * W * 0.36, 0.2, W / 2 + sgn * 0.12, hc - 0.08, 0.13, td, col, flat=True)
            s = W / 2 + sgn * W * 0.2
            fbeam(mb, F, s, 0.2, s, hc - 0.08, 0.12, td, col)
    # upper triangle: two short struts
    for sgn in (-1, 1):
        fbeam(mb, F, W / 2 + sgn * (sc * 0.0 + (W / 2 - sc) * 0.75), hc + 0.08, W / 2 + sgn * 0.1, Hg * 0.8,
              0.11, td, col, flat=True)


def stone_storey(mb, x0, x1, y0, y1, z0, z1, rng, palette=STONE, base=STONE_BASE, density=0.25,
                 faces=('front', 'right', 'back', 'left'), quoin=True, holes=None):
    """Stone ground floor: body, plinth, corner quoins and scattered proud blocks.
    holes: {face: [(s0, s1, h0, h1)]} areas kept clear of blocks (doors, windows)."""
    holes = holes or {}
    mb.box(x0, x1, y0, y1, z0, z1, base)
    mb.box(x0 - 0.08, x1 + 0.08, y0 - 0.08, y1 + 0.08, z0, z0 + 0.3, shade(base, 0.82), skip=('-z',))
    ch = 0.42
    if quoin:
        for k in range(int((z1 - z0 - 0.3) / ch)):
            h0 = z0 + 0.3 + k * ch
            for cx, cy, sx, sy in ((x0, y0, 1, 1), (x1, y0, -1, 1), (x1, y1, -1, -1), (x0, y1, 1, -1)):
                lx, ly = (0.7, 0.4) if k % 2 == 0 else (0.4, 0.7)
                c = rng.choice(palette)
                inner = ('+x' if sx > 0 else '-x', '+y' if sy > 0 else '-y')
                mb.box(min(cx - sx * 0.05, cx + sx * lx), max(cx - sx * 0.05, cx + sx * lx),
                       min(cy - sy * 0.05, cy + sy * ly), max(cy - sy * 0.05, cy + sy * ly),
                       h0 + 0.02, h0 + ch - 0.02, c, skip=('-z',) + inner, jit=0.02, rng=rng)
    for key, (F, W) in faces_of(x0, x1, y0, y1, z0).items():
        if key not in faces:
            continue
        rows = int((z1 - z0 - 0.3) / ch)
        for r in range(rows):
            h0 = 0.3 + r * ch
            s = 0.8 + (0.35 if r % 2 else 0.0)
            while s < W - 0.9:
                bw = rng.uniform(0.45, 0.8)
                if rng.random() < density:
                    sa, sb = s, min(s + bw - 0.04, W - 0.8)
                    if not any(sa < hb and sb > ha and h0 < hh1 and h0 + ch > hh0
                               for ha, hb, hh0, hh1 in holes.get(key, [])):
                        fblock(mb, F, sa, sb, h0 + 0.02, h0 + ch - 0.02, rng.uniform(0.025, 0.05),
                               rng.choice(palette), skip_sides=True)
                s += bw


def chimney(mb, x, y, zb, zt, w, d, rng, stone_base_to=None):
    if stone_base_to:
        mb.box(x - w / 2, x + w / 2, y - d / 2, y + d / 2, zb, stone_base_to, '#d8cdb4', skip=('-z',))
        for k in range(int((stone_base_to - zb) / 0.35)):
            pass
        zb2 = stone_base_to
    else:
        zb2 = zb
    mb.box(x - w / 2, x + w / 2, y - d / 2, y + d / 2, zb2, zt, BRICK[0], skip=('-z',))
    # brick courses: proud bricks in two tones on every face
    ch = 0.24
    rows = int((zt - zb2) / ch)
    for r in range(rows):
        if r % 2:
            continue
        h0 = zb2 + r * ch
        for F, W in faces_of(x - w / 2, x + w / 2, y - d / 2, y + d / 2, 0).values():
            s = 0.0 if r % 4 == 0 else 0.15
            while s < W - 0.05:
                bw = min(0.36, W - s)
                if rng.random() < 0.15:
                    fblock(mb, F, s + 0.01, s + bw - 0.01, h0 + 0.01, h0 + ch - 0.01, 0.025,
                           rng.choice(BRICK[1:]), skip_sides=True)
                s += bw
    mb.box(x - w / 2 - 0.1, x + w / 2 + 0.1, y - d / 2 - 0.1, y + d / 2 + 0.1, zt - 0.3, zt - 0.12, BRICK[3],
           skip=())
    mb.box(x - w / 2 - 0.14, x + w / 2 + 0.14, y - d / 2 - 0.14, y + d / 2 + 0.14, zt - 0.12, zt + 0.06,
           BRICK_CAP, skip=())
    pots = 2 if w > 0.9 else 1
    for i in range(pots):
        px = x + (i - (pots - 1) / 2) * w * 0.45
        mb.box(px - 0.16, px + 0.16, y - 0.16, y + 0.16, zt + 0.06, zt + 0.42, BRICK[2], skip=('-z',),
               cols={'+z': '#2a1c18'})


# --- roofs -------------------------------------------------------------------------------------

def tiles_facet(mb, A, B, C, D, n, tw, ch, colfn, rng, lift=0.08, gap=0.035):
    """Overlapping staggered tiles over the quad A B (eave) C D (top, may collapse to a point).
    colfn(row, col, centre, t) -> colour or None (skip)."""
    A, B, C, D, n = V(A), V(B), V(C), V(D), V(n).normalized()
    down = (A - D).normalized()
    rows = max(1, int(round((D - A).length / ch)))
    for i in range(rows):
        t0 = i / rows
        t1 = min(1.0, (i + 1.4) / rows)
        L0, R0 = A.lerp(D, t0), B.lerp(C, t0)
        L1, R1 = A.lerp(D, t1), B.lerp(C, t1)
        w = (R0 - L0).length
        nt = max(1, int(round(w / tw)))
        if i % 2 and nt > 1:
            bounds = [0.0] + [(k + 0.5) / nt for k in range(nt)] + [1.0]
        else:
            bounds = [k / nt for k in range(nt + 1)]
        gs = gap / max(w, 0.05)
        for k in range(len(bounds) - 1):
            sa, sb = bounds[k], bounds[k + 1]
            if sb - sa < 1e-3:
                continue
            sa2 = sa + gs if sa > 0 else sa
            sb2 = sb - gs if sb < 1 else sb
            p00, p10 = L0.lerp(R0, sa2), L0.lerp(R0, sb2)
            p01, p11 = L1.lerp(R1, sa2), L1.lerp(R1, sb2)
            ctr = (p00 + p11) / 2
            col = colfn(i, k, ctr, t0)
            if col is None:
                continue
            lf = lift * rng.uniform(0.8, 1.3)
            b0 = p00 + n * lf
            b1 = p10 + n * (lf + rng.uniform(-0.02, 0.02))
            mb.poly([b0, b1, p11 + n * 0.015, p01 + n * 0.015], col, out=n)
            mb.poly([p00, p10, b1, b0], shade(col, 0.62), out=down)


ROOF_STYLES = {
    'slate': dict(tiles=SLATE, edge=SLATE_LT, deck=SLATE_DECK, moss=0.9, tw=0.85, ch=0.62),
    'red': dict(tiles=RED, edge=RED_LT, deck=RED_DECK, moss=0.25, tw=0.95, ch=0.66),
}


def tile_colfn(style, rng, frame_pts, blobs, holes, moss_scale):
    st = ROOF_STYLES[style]

    def fn(i, k, ctr, t):
        for h in holes:
            if h(ctr):
                return None
        for (bc, br, sq) in blobs:
            dv = ctr - bc
            dd = math.sqrt(dv.x ** 2 * sq + dv.y ** 2 / sq + dv.z ** 2 / sq)
            if dd < br * rng.uniform(0.6, 1.25):
                return rng.choice(MOSS)
        c = rng.choice(st['tiles'])
        if rng.random() < 0.12:
            c = shade(c, 1.12)
        return c
    return fn


def gable_roof(mb, M, L, D, ze, pitch, style, rng, og=0.45, oe=0.5, ends=(True, True), end_wins=None,
               dormers=(), moss_blobs=2, tw=None, ch=None, chimneys=(), gable_plaster=PLASTER, hide=()):
    """Gable roof in a local frame: ridge along X over x in [-L/2, L/2], walls y in [-D/2, D/2],
    eaves at ze. dormers: [(side, x_centre, width, wall_height)] side -1 front (-Y) / +1 back.
    Built locally, then merged with matrix M. Returns the ridge height."""
    sub = MB()
    st = ROOF_STYLES[style]
    hd = D / 2
    t = math.tan(math.radians(pitch))
    zr = ze + hd * t
    xa, xb = -L / 2 - og, L / 2 + og
    ze2 = ze - oe * t
    holes = list(hide)
    dormer_specs = []
    tw = tw or st['tw']
    ch = ch or st['ch']
    for side, xc, w, hw in dormers:
        setback = 0.75
        yf = side * (hd - setback)
        zb = ze + setback * t
        pd = 52
        rise_d = (w / 2 + 0.3) * math.tan(math.radians(pd))
        depth = (hw + rise_d) / t + 0.2
        dormer_specs.append((side, xc, w, hw, yf, zb, depth, pd))

        def hole(c, xc=xc, w=w, yf=yf, side=side, depth=depth):
            if abs(c.x - xc) > w / 2 + 0.25:
                return False
            yy = (c.y - yf) * (-side)  # distance behind the dormer front, towards the ridge
            return -0.05 < yy < depth * 0.8
        holes.append(hole)
    for side in (-1, 1):
        A = V((xa, side * (hd + oe), ze2))
        B = V((xb, side * (hd + oe), ze2))
        C = V((xb, 0, zr))
        Dd = V((xa, 0, zr))
        n = V((0, side * t, 1)).normalized()
        sub.slab([A, B, C, Dd], n, 0.18, st['deck'], TIMBER_DK, TIMBER_DK)
        blobs = []
        if rng.random() < st['moss'] or moss_blobs > 2:
            for _ in range(moss_blobs if st['moss'] > 0.5 else 1):
                bt = rng.uniform(0.25, 0.7)
                bc = A.lerp(B, rng.uniform(0.15, 0.85)).lerp(Dd.lerp(C, 0.5), bt)
                blobs.append((bc, rng.uniform(0.9, 1.5) * (1 if st['moss'] > 0.5 else 0.6), rng.uniform(0.35, 0.6)))
        colfn = tile_colfn(style, rng, None, blobs, holes, 1)
        if side == -1:
            tiles_facet(sub, A, B, C, Dd, n, tw, ch, colfn, rng)
        else:
            tiles_facet(sub, B, A, Dd, C, n, tw, ch, colfn, rng)
        # verge caps on both gable edges
        for (p, q) in ((A, Dd), (B, C)):
            segs = max(2, int((q - p).length / 1.0))
            inward = V((1 if p.x < 0 else -1, 0, 0))
            for k in range(segs):
                a = p.lerp(q, k / segs) + inward * 0.14
                b = p.lerp(q, (k + 1) / segs) + inward * 0.14 + (q - p).normalized() * 0.05
                sub.beam(a, b, n, 0.38, 0.2 + rng.uniform(-0.02, 0.03),
                         st['edge'] if k % 2 == 0 else shade(st['edge'], 0.9))
        # eave fascia
        sub.beam(A + n * 0.0 - n * 0.18, B - n * 0.18, (A - Dd).normalized(), 0.18, 0.06, TIMBER_DK)
    # ridge cap
    segs = max(2, int((xb - xa) / 0.9))
    for k in range(segs):
        a = xa + (xb - xa) * k / segs
        b = xa + (xb - xa) * (k + 1) / segs + 0.04
        sub.obox(((a + b) / 2, 0, zr + 0.04), X, V((0, 1, 1)), V((0, -1, 1)), ((b - a) / 2, 0.19, 0.19),
                 st['edge'] if k % 2 else shade(st['edge'], 0.88), skip=('-y', '-z', '-x', '+x') if 0 < k < segs - 1 else ('-y', '-z'))
    # gable ends
    Hg = zr - ze
    for idx, sx in enumerate((-1, 1)):
        if not ends[idx]:
            continue
        x = sx * L / 2
        F = Facade((x, -sx * hd, ze), V((0, -sx, 0)) * -1 if False else V((0, sx, 0)), V((sx, 0, 0)))
        # F.u must run left->right seen from outside: outside normal +X => u = +Y; normal -X => u = -Y
        F = Facade((x, -sx * hd, ze), V((0, sx, 0)), V((sx, 0, 0)))
        wins = (end_wins or {}).get(idx, ())
        gable_face(sub, F, D, Hg, rng, wins, gable_plaster)
    for spec in dormer_specs:
        side, xc, w, hw, yf, zb, depth, pd = spec
        dm = MB()
        dormer(dm, w, hw, depth, pd, style, rng)
        Md = T(xc, yf, zb) @ (Rz(0) if side == -1 else Rz(180))
        sub.merge(dm, Md)
    for (cx, cy, cw, cd, ctop, stone_to) in chimneys:
        chimney(sub, cx, cy, ze - 0.5, ctop, cw, cd, rng, stone_to)
    mb.merge(sub, M)
    return zr


def dormer(mb, w, hw, depth, pd, style, rng):
    """Gabled dormer facing -Y, front wall at y=0, base at z=0, running back by depth."""
    mb.box(-w / 2, w / 2, 0, depth, -1.4, hw, PLASTER, skip=('-z', '+z', '+y'))
    F = Facade((-w / 2, 0, 0), X, -Y)
    fbeam(mb, F, 0.08, 0, 0.08, hw, 0.16, 0.07, TIMBER)
    fbeam(mb, F, w - 0.08, 0, w - 0.08, hw, 0.16, 0.07, TIMBER)
    fbeam(mb, F, 0, 0.08, w, 0.08, 0.16, 0.07, TIMBER)
    ww = w - 0.55
    window(mb, F, w / 2, 0.22, ww, hw - 0.42, rng, fbox=False)
    for sx in (-1, 1):
        Fs = Facade((sx * w / 2, 0 if sx > 0 else depth, 0), V((0, sx, 0)), V((sx, 0, 0)))
        fbeam(mb, Fs, 0.1, hw - 0.08, depth * 0.6, hw - 0.08, 0.14, 0.05, TIMBER)
    sub = MB()
    gable_roof(sub, Matrix.Identity(4), depth, w, hw, pd, style, rng, og=0.28, oe=0.22, ends=(False, True),
               moss_blobs=0, tw=0.55, ch=0.45)
    mb.merge(sub, T(0, depth / 2, 0) @ Rz(-90))


def awning(mb, F, s0, s1, h_top, proj, drop, cols, rng, valance=0.22, stripe=0.42, segs=3, sag=0.12):
    """Striped market awning: curved canvas from the wall (h_top) out by proj, dropping by drop."""
    W = s1 - s0
    n = max(2, int(round(W / stripe)))

    def prof(t):  # (out, h) along the canvas, a bowed curve
        return (proj * t, h_top - drop * t - sag * math.sin(math.pi * t) * -1 * 0.0 - drop * 0.25 * t * (1 - t) * -1)

    for i in range(n):
        a, b = s0 + W * i / n, s0 + W * (i + 1) / n
        col = cols[i % len(cols)]
        for j in range(segs):
            t0, t1 = j / segs, (j + 1) / segs
            (o0, h0), (o1, h1) = prof(t0), prof(t1)
            q = [F.p(a, h0, o0 + 0.02), F.p(b, h0, o0 + 0.02), F.p(b, h1, o1 + 0.02), F.p(a, h1, o1 + 0.02)]
            up = Z * 1.0 + F.n * (drop / proj)
            mb.poly(q, col, out=up)
            mb.poly(q, shade(col, 0.7), out=-up)
        (o, h) = prof(1.0)
        q = [F.p(a, h, o + 0.02), F.p(b, h, o + 0.02), F.p(b, h - valance, o + 0.03), F.p(a, h - valance, o + 0.03)]
        mb.poly(q, col, out=F.n)
        mb.poly(q, shade(col, 0.7), out=-F.n)
        # scallop tooth
        tq = [F.p(a, h - valance, o + 0.03), F.p(b, h - valance, o + 0.03), F.p((a + b) / 2, h - valance - 0.1, o + 0.03)]
        mb.poly(tq, col, out=F.n)
        mb.poly(tq, shade(col, 0.7), out=-F.n)
    # side flaps
    for s in (s0, s1):
        pts = [F.p(s, h_top, 0.02)] + [F.p(s, prof(j / segs)[1], prof(j / segs)[0] + 0.02) for j in range(1, segs + 1)]
        pts += [F.p(s, prof(1)[1] - valance, proj + 0.03)]
        for k in range(1, len(pts) - 1):
            tri = [pts[0], pts[k], pts[k + 1]]
            mb.poly(tri, cols[0], out=F.u * (1 if s == s1 else -1))
            mb.poly(tri, shade(cols[0], 0.7), out=F.u * (-1 if s == s1 else 1))
    # rail under the wall edge
    fbeam(mb, F, s0, h_top, s1, h_top, 0.1, 0.1, TIMBER_DK, ends=True)


def produce_crate(mb, c, w, d, h, rng, fruit=None, tilt=0.0):
    x, y, z = c
    col = rng.choice(WOOD)
    mb.box(x - w / 2, x + w / 2, y - d / 2, y + d / 2, z, z + h, col, skip=('-z', '+z'), jit=0.01, rng=rng)
    mb.box(x - w / 2 + 0.03, x + w / 2 - 0.03, y - d / 2 + 0.03, y + d / 2 - 0.03, z, z + h - 0.06, '#4a3020',
           skip=('-z', '-x', '+x', '-y', '+y'))
    # slat line on the front
    if h > 0.3:
        mb.poly([V((x - w / 2, y - d / 2 - 0.012, z + h * 0.48)), V((x + w / 2, y - d / 2 - 0.012, z + h * 0.48)),
                 V((x + w / 2, y - d / 2 - 0.012, z + h * 0.56)), V((x - w / 2, y - d / 2 - 0.012, z + h * 0.56))],
                shade(col, 0.72), out=-Y)
    if fruit is not None:
        fc = fruit if isinstance(fruit, list) else [fruit]
        nx, ny = max(2, int(w / 0.19)), max(2, int(d / 0.21))
        for i in range(nx):
            for j in range(ny):
                px = x - w / 2 + (i + 0.5) * w / nx
                py = y - d / 2 + (j + 0.5) * d / ny
                mb.octa((px, py, z + h - 0.02 + rng.uniform(0, 0.04)), 0.105, rng.choice(fc), 0.7, rng, 0.015,
                        top_only=True)


# --- props -------------------------------------------------------------------------------------

def house_blue():
    rng = random.Random(101)
    mb = MB()
    x0, x1, y0, y1 = -4.0, 4.0, -3.5, 3.5
    g = 3.0
    ze = 6.45
    holes = {'front': [(1.0, 2.6, 0, 2.6), (4.9, 6.4, 0.9, 2.3)], 'back': [(3.5, 5.0, 0.9, 2.3)]}
    stone_storey(mb, x0, x1, y0, y1, 0, g, rng, holes=holes)
    F = faces_of(x0, x1, y0, y1, 0)
    Ff, _ = F['front']
    plank_door(mb, Ff, 1.8, 1.2, 2.2, rng)
    window(mb, Ff, 5.65, 1.0, 1.1, 1.1, rng, fbox=True, frame=TIMBER_DK, recess=0.0)
    Fb, _ = F['back']
    window(mb, Fb, 4.2, 1.0, 1.0, 1.1, rng, fbox=False, frame=TIMBER_DK)
    # jettied timber storey
    j = 0.25
    ux0, ux1, uy0, uy1 = x0 - j, x1 + j, y0 - j, y1 + j
    mb.box(ux0, ux1, uy0, uy1, g, ze, PLASTER, skip=())
    mb.box(ux0 - 0.04, ux1 + 0.04, uy0 - 0.04, uy1 + 0.04, g - 0.05, g + 0.25, TIMBER_DK, skip=())
    UF = faces_of(ux0, ux1, uy0, uy1, g + 0.25)
    H = ze - g - 0.25
    wins = {'front': [(1.9, 1.25), (6.6, 1.25)], 'back': [(2.2, 1.0, False), (6.3, 1.0, False)],
            'right': [(3.75, 1.0)], 'left': [(3.75, 1.0, False)]}
    for key, (Fk, W) in UF.items():
        timber_facade(mb, Fk, W, H, wins[key], rng, sill=0.75, wh=1.3)
    # jetty brackets
    for s in (0.3, 4.25, 8.2):
        fbeam(mb, Ff, s - 0.25 + 0.25, g - 0.55, s, g - 0.05, 0.14, 0.2, TIMBER_DK)
    D = uy1 - uy0
    gable_roof(mb, Matrix.Identity(4), ux1 - ux0, D, ze, 47, 'slate', rng, og=0.45, oe=0.4,
               dormers=[(-1, -0.3, 1.9, 1.55)], moss_blobs=3,
               end_wins={0: [(D / 2, 0.8, 0.9, 0.85)], 1: [(D / 2, 0.8, 0.9, 0.85)]},
               chimneys=[(2.4, -0.7, 1.05, 1.05, 11.7, 10.6)])
    return mb.build('town_house_blue')


def house_red():
    rng = random.Random(202)
    mb = MB()
    x0, x1, y0, y1 = -3.5, 3.5, -4.0, 4.0
    g = 3.0
    holes = {'front': [(2.6, 4.4, 0, 2.6), (0.6, 2.1, 0.8, 2.3), (4.9, 6.4, 0.8, 2.3)]}
    stone_storey(mb, x0, x1, y0, y1, 0, g, rng, holes=holes, density=0.18)
    F = faces_of(x0, x1, y0, y1, 0)
    Ff, _ = F['front']
    plank_door(mb, Ff, 3.5, 1.2, 2.3, rng)
    window(mb, Ff, 1.35, 1.0, 1.0, 1.1, rng, fbox=True, frame=TIMBER_DK)
    window(mb, Ff, 5.65, 1.0, 1.0, 1.1, rng, fbox=True, frame=TIMBER_DK)
    zz = g
    hs = [2.75, 2.6]
    jet = 0.0
    for si, h in enumerate(hs):
        jet += 0.3
        bx0, bx1, by0, by1 = x0 - 0.1, x1 + 0.1, y0 - jet, y1
        mb.box(bx0, bx1, by0, by1, zz, zz + h, PLASTER, skip=())
        mb.box(bx0 - 0.05, bx1 + 0.05, by0 - 0.06, by1 + 0.02, zz - 0.02, zz + 0.26, TIMBER_DK, skip=())
        FF = faces_of(bx0, bx1, by0, by1, zz + 0.26)
        W = bx1 - bx0
        wins = {'front': [(1.6, 1.05), (W - 1.6, 1.05)] if si == 0 else [(1.75, 0.95), (W - 1.75, 0.95)],
                'right': [(2.3, 1.0), (6.3, 1.0, False)] if si == 0 else [(4.3, 1.0, False)],
                'left': [(4.0, 1.0, False)] if si == 0 else [(6.0, 1.0)],
                'back': [(W / 2, 1.0, False)] if si == 0 else []}
        for key, (Fk, Wk) in FF.items():
            timber_facade(mb, Fk, Wk, h - 0.26, wins[key], rng, sill=0.8, wh=1.1)
        # brackets under the jetty
        Fj = Facade((bx0, by0, zz), X, -Y)
        for s in (0.15, W / 2, W - 0.15):
            fbeam(mb, Facade((bx0, by0 + 0.3, zz), X, -Y), s, -0.6, s, 0.0, 0.14, 0.16, TIMBER_DK)
        zz += h
    ze = zz
    # front gable roof: ridge along Y -> local roof rotated 90 deg
    by0 = y0 - jet
    L = y1 - by0
    Dw = x1 - x0 + 0.2
    M = T(0, (y1 + by0) / 2, 0) @ Rz(90)
    # local +X end -> world +Y (back); local -X end -> world -Y (front)
    gable_roof(mb, M, L, Dw, ze, 50, 'red', rng, og=0.5, oe=0.5,
               end_wins={0: [(Dw / 2 - 1.0, 0.75, 0.6, 1.0), (Dw / 2 + 1.0, 0.75, 0.6, 1.0)],
                         1: [(Dw / 2, 0.8, 0.7, 0.9)]},
               dormers=[(1, 0.8, 1.4, 1.25)], moss_blobs=1,
               chimneys=[(2.4, -1.9, 0.9, 0.9, ze + 5.0, None)])
    return mb.build('town_house_red')


def house_narrow():
    rng = random.Random(303)
    mb = MB()
    x0, x1, y0, y1 = -2.5, 2.5, -3.5, 3.5
    g = 3.3
    holes = {'front': [(0.2, 4.8, 0, 3.0)]}
    stone_storey(mb, x0, x1, y0, y1, 0, g, rng, holes=holes, density=0.4)
    F = faces_of(x0, x1, y0, y1, 0)
    Ff, _ = F['front']
    # shop front: timber frame, big display window and a door
    fbeam(mb, Ff, 0.35, 0, 0.35, 2.95, 0.22, 0.12, TIMBER_DK)
    fbeam(mb, Ff, 4.65, 0, 4.65, 2.95, 0.22, 0.12, TIMBER_DK)
    fbeam(mb, Ff, 0.25, 2.95, 4.75, 2.95, 0.25, 0.14, TIMBER_DK, ends=True)
    plank_door(mb, Ff, 3.85, 1.0, 2.3, rng, frame=TIMBER_DK)
    # display window with small panes and a sill counter
    s0, s1, h0, h1 = 0.55, 3.05, 0.8, 2.55
    mb.poly([Ff.p(s0, h0, 0.02), Ff.p(s1, h0, 0.02), Ff.p(s1, h1, 0.02), Ff.p(s0, h1, 0.02)], GLASS, out=Ff.n)
    for s in (s0, (s0 + s1) / 2 - 0.42, (s0 + s1) / 2 + 0.42, s1):
        fbeam(mb, Ff, s, h0, s, h1, 0.08, 0.08, TIMBER_LT)
    for h in (h0, (h0 + h1) / 2, h1):
        fbeam(mb, Ff, s0, h, s1, h, 0.08, 0.08, TIMBER_LT, ends=True)
    fblock(mb, Ff, s0 - 0.1, s1 + 0.1, h0 - 0.12, h0, 0.35, WOOD[0])
    for i in range(4):
        produce_crate(mb, Ff.p(0.85 + i * 0.6, 0, 0.45), 0.5, 0.4, 0.45, rng, PRODUCE[i * 2 % len(PRODUCE)])
    # sign board
    fblock(mb, Ff, 3.4, 4.3, 2.55, 2.85, 0.05, '#6a4426')
    zz = g
    for si, h in enumerate((2.7, 2.55)):
        j = 0.15 * (si + 1)
        bx0, bx1, by0, by1 = x0 - 0.05, x1 + 0.05, y0 - j, y1
        mb.box(bx0, bx1, by0, by1, zz, zz + h, PLASTER, skip=())
        mb.box(bx0 - 0.04, bx1 + 0.04, by0 - 0.05, by1 + 0.02, zz - 0.02, zz + 0.24, TIMBER_DK, skip=())
        W = bx1 - bx0
        wins = {'front': [(1.3, 0.9), (W - 1.3, 0.9)], 'right': [(3.5, 0.9, False)],
                'left': [(3.5, 0.9, si == 0)], 'back': [(W / 2, 0.9, False)]}
        for key, (Fk, Wk) in faces_of(bx0, bx1, by0, by1, zz + 0.24).items():
            timber_facade(mb, Fk, Wk, h - 0.24, wins[key], rng, sill=0.75, wh=1.1)
        zz += h
    ze = zz
    by0 = y0 - 0.3
    L = y1 - by0
    Dw = x1 - x0 + 0.1
    M = T(0, (y1 + by0) / 2, 0) @ Rz(90)
    gable_roof(mb, M, L, Dw, ze, 52, 'slate', rng, og=0.45, oe=0.45,
               end_wins={0: [(Dw / 2, 0.75, 0.55, 0.95)], 1: [(Dw / 2, 0.7, 0.6, 0.8)]}, moss_blobs=2,
               chimneys=[(1.8, 1.2, 0.8, 0.8, ze + 3.9, None)])
    # striped awning over the shop front
    awning(mb, Facade((x0, y0, 0), X, -Y), 0.2, 4.8, 2.85, 1.5, 0.75, [AWN_RED, AWN_CREAM], rng)
    return mb.build('town_house_narrow')


def house_corner():
    rng = random.Random(404)
    mb = MB()
    # main block along X (back), gable wing at the front left
    mx0, mx1, my0, my1 = -5.0, 5.0, -1.0, 4.0
    wx0, wx1, wy0, wy1 = -5.0, -0.8, -4.0, -1.0
    g = 3.2
    stone_storey(mb, mx0, mx1, my0, my1, 0, g, rng, density=0.1, faces=('right', 'back', 'left'))
    stone_storey(mb, wx0, wx1, wy0, wy1, 0, g, rng, density=0.16, faces=('front', 'right', 'left'),
                 holes={'front': [(1.4, 2.9, 0, 2.6)]})
    Fw, _ = faces_of(wx0, wx1, wy0, wy1, 0)['front']
    plank_door(mb, Fw, 2.1, 1.2, 2.3, rng)
    # the stall under the awning (ground floor of the main block, right of the wing)
    Fm, _ = faces_of(mx0, mx1, my0, my1, 0)['front']
    mb.poly([Fm.p(4.6, 0.2, 0.02), Fm.p(9.7, 0.2, 0.02), Fm.p(9.7, 2.6, 0.02), Fm.p(4.6, 2.6, 0.02)], '#3e3430',
            out=Fm.n)
    for s in (4.5, 7.15, 9.8):
        fbeam(mb, Fm, s, 0, s, 2.75, 0.2, 0.1, TIMBER_DK)
    fbeam(mb, Fm, 4.4, 2.75, 9.9, 2.75, 0.22, 0.12, TIMBER_DK, ends=True)
    # counter with crates of produce
    mb.box(0.0, 4.6, -1.75, -1.05, 0, 0.85, WOOD[2], skip=('-z',), cols={'+z': WOOD[3]})
    for i in range(3):
        produce_crate(mb, (0.75 + i * 1.5, -1.4, 0.85), 1.1, 0.55, 0.22, rng, [PRODUCE[i % len(PRODUCE)],
                                                                              PRODUCE[(i + 3) % len(PRODUCE)]])
    produce_crate(mb, (3.6, -2.05, 0), 0.6, 0.45, 0.42, rng, PRODUCE[3])
    mb.box(0.5, 1.0, -2.3, -1.8, 0, 0.45, WOOD[1], skip=('-z',), jit=0.01, rng=rng)
    # awning over the stall, posts at the front
    awning(mb, Fm, 4.3, 10.0, 2.95, 1.9, 0.85, [AWN_BLUE, AWN_CREAM], rng, stripe=0.52)
    for x in (-0.65, 4.85):
        mb.box(x - 0.06, x + 0.06, -2.85, -2.73, 0, 2.2, TIMBER, skip=('-z',))
    # timber upper storey (main and wing)
    j = 0.2
    zt = g + 2.85
    H = zt - g - 0.24
    mb.box(mx0 - j, mx1 + j, my0 - j, my1 + j, g, zt, PLASTER, skip=())
    mb.box(mx0 - j - 0.04, mx1 + j + 0.04, my0 - j - 0.04, my1 + j + 0.04, g - 0.02, g + 0.24, TIMBER_DK, skip=())
    for key, (Fk, W) in faces_of(mx0 - j, mx1 + j, my0 - j, my1 + j, g + 0.24).items():
        wins = {'front': [(1.4, 1.0), (4.0, 1.0)], 'back': [(5.2, 1.0, False)],
                'right': [(2.7, 1.0, False)], 'left': []}[key]
        if key == 'front':  # only the part right of the wing shows
            Fk = Facade(Fk.p(4.65, 0), Fk.u, Fk.n)
            W -= 4.65
        timber_facade(mb, Fk, W, H, wins, rng, sill=0.8, wh=1.1, braces=key in ('front', 'right'))
    mb.box(wx0 - j, wx1 + j, wy0 - j, wy1 + 0.3, g, zt, PLASTER, skip=())
    mb.box(wx0 - j - 0.04, wx1 + j + 0.04, wy0 - j - 0.04, wy1 + 0.3, g - 0.02, g + 0.24, TIMBER_DK, skip=())
    WF = faces_of(wx0 - j, wx1 + j, wy0 - j, wy1 + 0.3, g + 0.24)
    for key in ('front', 'left', 'right'):
        Fk, W = WF[key]
        wins = {'front': [(1.25, 1.0), (W - 1.25, 1.0)], 'left': [], 'right': []}[key]
        timber_facade(mb, Fk, W, H, wins, rng, sill=0.8, wh=1.1)
    # roofs
    D = my1 - my0 + 2 * j
    M = T(0, (my0 + my1) / 2, 0)
    zr = gable_roof(mb, M, mx1 - mx0 + 2 * j, D, zt, 48, 'red', rng, og=0.4, oe=0.5,
                    dormers=[(-1, 2.6, 1.5, 1.3)], moss_blobs=1, tw=1.0, ch=0.7,
                    end_wins={1: [(D / 2, 0.8, 0.7, 0.9)]},
                    chimneys=[(-2.8, 1.6, 0.9, 0.9, zt + 4.2, None)],
                    hide=[lambda c: c.y < 0 and -5.3 < c.x < -0.5 and c.z < 8.75 - abs(c.x + 2.9) * 1.19])
    Dw = wx1 - wx0 + 2 * j
    Lw = (wy1 + 1.6) - (wy0 - j)
    Mw = T((wx0 + wx1) / 2, (wy0 - j + wy1 + 1.6) / 2, 0) @ Rz(90)
    gable_roof(mb, Mw, Lw, Dw, zt, 50, 'red', rng, og=0.45, oe=0.45, ends=(True, False),
               end_wins={0: [(Dw / 2, 0.8, 0.6, 0.95)]}, moss_blobs=1, tw=1.0, ch=0.7)
    return mb.build('town_house_corner')


def masonry(mb, F, W, s0, s1, h0, h1, rng, palette, density, ch=0.5, d=(0.03, 0.06), holes=(), bw=(0.5, 1.0),
            skip_sides=False):
    rows = int((h1 - h0) / ch)
    for r in range(rows):
        hh = h0 + r * ch
        s = s0 + (rng.uniform(0, 0.4) if r % 2 else 0.0)
        while s < s1 - 0.15:
            w = rng.uniform(*bw)
            sa, sb = s, min(s + w - 0.05, s1)
            if sb - sa > 0.15 and rng.random() < density:
                if not any(sa < hb and sb > ha and hh < q1 and hh + ch > q0 for ha, hb, q0, q1 in holes):
                    fblock(mb, F, sa, sb, hh + 0.025, hh + ch - 0.025, rng.uniform(*d), rng.choice(palette),
                           skip_sides=skip_sides)
            s += w


def clock_face(mb, F, s_c, h_c, r, rng):
    seg = 20
    pts = [F.p(s_c + r * math.cos(2 * math.pi * i / seg), h_c + r * math.sin(2 * math.pi * i / seg), 0.14)
           for i in range(seg)]
    ring_o = [F.p(s_c + (r + 0.18) * math.cos(2 * math.pi * i / seg), h_c + (r + 0.18) * math.sin(2 * math.pi * i / seg), 0.2)
              for i in range(seg)]
    ring_b = [F.p(s_c + (r + 0.18) * math.cos(2 * math.pi * i / seg), h_c + (r + 0.18) * math.sin(2 * math.pi * i / seg), 0.0)
              for i in range(seg)]
    ring_i = [F.p(s_c + r * math.cos(2 * math.pi * i / seg), h_c + r * math.sin(2 * math.pi * i / seg), 0.2)
              for i in range(seg)]
    mb.poly(pts, '#efe2bd', out=F.n)
    for i in range(seg):
        j = (i + 1) % seg
        mb.poly([ring_i[i], ring_i[j], ring_o[j], ring_o[i]], '#2d2a27', out=F.n)
        mid = (ring_o[i] + ring_o[j]) / 2 - F.p(s_c, h_c, 0.2)
        mb.poly([ring_o[i], ring_o[j], ring_b[j], ring_b[i]], '#3a3530', out=mid)
        mb.poly([pts[i], pts[j], ring_i[j], ring_i[i]], '#3a3530', out=-(mid))
    # stone surround (square frame with corner stones)
    for k in range(12):
        a = 2 * math.pi * k / 12
        c, s = math.cos(a), math.sin(a)
        l0, l1 = r * 0.72, r * (0.92 if k % 3 == 0 else 0.84)
        p0 = F.p(s_c + c * l0, h_c + s * l0, 0.14)
        p1 = F.p(s_c + c * l1, h_c + s * l1, 0.14)
        mb.beam(p0, p1, F.n, 0.09 if k % 3 == 0 else 0.05, 0.03, '#2b2724', ends=True)
    # hands at ten past ten, and the hub
    mb.beam(F.p(s_c, h_c, 0.18), F.p(s_c - r * 0.5, h_c + r * 0.32, 0.18), F.n, 0.1, 0.03, '#1f1c1a', ends=True)
    mb.beam(F.p(s_c, h_c, 0.2), F.p(s_c + r * 0.12, h_c + r * 0.82, 0.2), F.n, 0.07, 0.03, '#1f1c1a', ends=True)
    fblock(mb, F, s_c - 0.1, s_c + 0.1, h_c - 0.1, h_c + 0.1, 0.25, '#1f1c1a')


def corbel_row(mb, F, W, h, n, depth, rng, col_palette, tall=0.5):
    for i in range(n):
        s = (i + 0.5) * W / n
        mb.obox(F.p(s, h - tall / 2, depth / 2), F.u, Z, F.n, (0.16, tall / 2, depth / 2), rng.choice(col_palette),
                skip=('-z',))


def clock_tower():
    rng = random.Random(505)
    mb = MB()
    half = 3.5
    # plinth
    mb.box(-3.75, 3.75, -3.75, 3.75, 0, 0.5, shade(TSTONE_BASE, 0.85), skip=('-z',))
    # lower stage 0..8 (7 x 7)
    z1 = 8.0
    mb.box(-half, half, -half, half, 0.5, z1, TSTONE_BASE, skip=('-z',))
    # side buttress block (the step at the right of the concept's base)
    mb.box(half - 0.2, half + 0.9, -half + 0.2, -half + 2.6, 0, 3.2, TSTONE[1], skip=('-z',))
    mb.obox((half + 0.35, -half + 1.4, 3.2), X, Y, Z, (0.55, 1.2, 0.01), TSTONE[2], skip=('-z',))
    door_hole = (2.1, 4.9, 0, 4.4)
    for key, (F, W) in faces_of(-half, half, -half, half, 0).items():
        holes = [door_hole] if key == 'front' else []
        masonry(mb, F, W, 0.55, W - 0.55, 0.5, z1 - 0.1, rng, TSTONE + STONE[:2], 0.46, ch=0.5, holes=holes)
    Ff, _ = faces_of(-half, half, -half, half, 0)['front']
    # arched door with voussoirs
    dw, dh = 2.1, 3.6
    plank_door(mb, Ff, 3.5, dw, dh, rng, arch=True, d=0.03)
    mb.poly([Ff.p(3.5 - dw / 2, 0, 0.001), Ff.p(3.5 + dw / 2, 0, 0.001), Ff.p(3.5 + dw / 2, 0.5, 0.001),
             Ff.p(3.5 - dw / 2, 0.5, 0.001)], '#4a3a2c', out=Ff.n)
    rise = dw / 2
    nv = 9
    for i in range(nv):
        a0 = math.pi * i / nv
        a1 = math.pi * (i + 1) / nv
        ri, ro = rise + 0.02, rise + 0.55
        hs = dh - rise
        pts = [Ff.p(3.5 + ri * math.cos(a0), hs + ri * math.sin(a0), 0.1),
               Ff.p(3.5 + ro * math.cos(a0), hs + ro * math.sin(a0), 0.1),
               Ff.p(3.5 + ro * math.cos(a1), hs + ro * math.sin(a1), 0.1),
               Ff.p(3.5 + ri * math.cos(a1), hs + ri * math.sin(a1), 0.1)]
        col = [TSTONE[2], QUOIN[1]][i % 2]
        mb.poly(pts, col, out=Ff.n)
        # inner soffit of the arch (depth of the reveal)
        mb.poly([pts[0], pts[3], pts[3] - Ff.n * 0.32, pts[0] - Ff.n * 0.32], shade(col, 0.7),
                out=-(pts[0] - Ff.p(3.5, hs, 0.1)))
        mb.poly([pts[1], pts[2], pts[2] - Ff.n * 0.1, pts[1] - Ff.n * 0.1], shade(col, 0.8),
                out=(pts[1] - Ff.p(3.5, hs, 0.1)))
    for sgn in (-1, 1):
        s = 3.5 + sgn * (dw / 2 + 0.25)
        for k in range(5):
            hh = 0.5 + k * 0.48
            wdt = 0.5 if k % 2 == 0 else 0.35
            fblock(mb, Ff, s - wdt / 2, s + wdt / 2, hh, hh + 0.44, 0.1, [TSTONE[2], QUOIN[0]][k % 2])
        mb.poly([Ff.p(3.5 + sgn * dw / 2, 0.5, 0.0), Ff.p(3.5 + sgn * dw / 2, dh - rise, 0.0),
                 Ff.p(3.5 + sgn * dw / 2, dh - rise, -0.22), Ff.p(3.5 + sgn * dw / 2, 0.5, -0.22)],
                shade(TSTONE[0], 0.7), out=-Ff.u * sgn)
    # string course
    mb.box(-half - 0.25, half + 0.25, -half - 0.25, half + 0.25, z1, z1 + 0.35, TSTONE[2], skip=())
    # shaft 8.35..15.6, slightly narrower
    sh = 3.3
    z2 = 15.6
    mb.box(-sh, sh, -sh, sh, z1 + 0.35, z2, TSTONE_BASE, skip=('-z',))
    for key, (F, W) in faces_of(-sh, sh, -sh, sh, 0).items():
        masonry(mb, F, W, 0.55, W - 0.55, z1 + 0.4, z2 - 0.1, rng, TSTONE + STONE[:1], 0.3, ch=0.5,
                holes=[(2.9, 3.7, 11.0, 12.8)] if key in ('front', 'right', 'left') else [])
        if key in ('front', 'right', 'left'):
            mb.poly([F.p(3.05, 11.2, 0.01), F.p(3.55, 11.2, 0.01), F.p(3.55, 12.6, 0.01), F.p(3.05, 12.6, 0.01)],
                    '#2a2630', out=F.n)
            fblock(mb, F, 2.95, 3.65, 11.0, 11.2, 0.12, TSTONE[2])
            fblock(mb, F, 2.95, 3.65, 12.6, 12.8, 0.08, TSTONE[1])
    # quoins along all four corners of the lower stage and shaft
    for (za, zb, hw) in ((0.5, z1, half), (z1 + 0.35, z2, sh)):
        k = 0
        hh = za
        while hh < zb - 0.3:
            ch = 0.55
            for cx, cy in ((-1, -1), (1, -1), (1, 1), (-1, 1)):
                lx, ly = (0.9, 0.5) if (k + (cx * cy > 0)) % 2 == 0 else (0.5, 0.9)
                xa = cx * (hw + 0.06)
                xb = cx * (hw - lx)
                ya = cy * (hw + 0.06)
                yb = cy * (hw - ly)
                inner = ('+x' if cx < 0 else '-x', '+y' if cy < 0 else '-y')
                mb.box(min(xa, xb), max(xa, xb), min(ya, yb), max(ya, yb), hh + 0.03, hh + ch - 0.03,
                       rng.choice(QUOIN), skip=('-z',) + inner, jit=0.02, rng=rng)
            hh += ch
            k += 1
    # corbel table under the clock stage
    ck = 3.75
    for key, (F, W) in faces_of(-sh, sh, -sh, sh, z2).items():
        corbel_row(mb, F, W, 0.0, 9, 0.45, rng, TSTONE)
    mb.box(-ck, ck, -ck, ck, z2, z2 + 0.35, TSTONE[2], skip=())
    # clock stage
    z3 = z2 + 0.35
    z4 = z3 + 6.0
    cs = 3.55
    mb.box(-cs, cs, -cs, cs, z3, z4, TSTONE_BASE, skip=('-z',))
    for key, (F, W) in faces_of(-cs, cs, -cs, cs, 0).items():
        masonry(mb, F, W, 0.6, W - 0.6, z3, z4 - 0.1, rng, TSTONE, 0.35, ch=0.5,
                holes=[(1.2, W - 1.2, z3 + 0.6, z4 - 0.5)])
        clock_face(mb, F, W / 2, z3 + 3.1, 1.75, rng)
    k = 0
    hh = z3
    while hh < z4 - 0.3:
        for cx, cy in ((-1, -1), (1, -1), (1, 1), (-1, 1)):
            lx, ly = (0.8, 0.45) if k % 2 == 0 else (0.45, 0.8)
            xa, xb = cx * (cs + 0.07), cx * (cs - lx)
            ya, yb = cy * (cs + 0.07), cy * (cs - ly)
            inner = ('+x' if cx < 0 else '-x', '+y' if cy < 0 else '-y')
            mb.box(min(xa, xb), max(xa, xb), min(ya, yb), max(ya, yb), hh + 0.03, hh + 0.52,
                   rng.choice(QUOIN), skip=('-z',) + inner, jit=0.02, rng=rng)
        hh += 0.55
        k += 1
    # cornice: ledge, corbels, cap
    for key, (F, W) in faces_of(-cs, cs, -cs, cs, z4 + 0.1).items():
        corbel_row(mb, F, W, 0.0, 10, 0.35, rng, TSTONE, tall=0.35)
    mb.box(-3.95, 3.95, -3.95, 3.95, z4, z4 + 0.45, TSTONE[2], skip=())
    mb.box(-3.85, 3.85, -3.85, 3.85, z4 + 0.45, z4 + 0.7, TSTONE[3], skip=('-z',))
    # spire: steep pyramid of blue slate with dormers
    zb = z4 + 0.7
    apex = V((0, 0, 30.0))
    b = 4.0
    corners = [V((-b, -b, zb)), V((b, -b, zb)), V((b, b, zb)), V((-b, b, zb))]
    st = ROOF_STYLES['slate']
    run = (30.0 - zb) / b  # rise per metre inward
    setback = 1.25
    hs = zb + setback * run
    for i in range(4):
        A, B = corners[i], corners[(i + 1) % 4]
        n = newell([A, B, apex]).normalized()
        if n.z < 0:
            n = -n
        mb.poly([A - n * 0.15, B - n * 0.15, apex - n * 0.15], SLATE_DECK, out=n)
        mb.poly([A - n * 0.15, B - n * 0.15, B, A], TIMBER_DK, out=(A + B) / 2 - V((0, 0, zb)))
        mid = (A + B) / 2
        out = V((mid.x, mid.y, 0)).normalized()

        def hole(c, out=out, mid=mid):
            dv = c - mid
            lat = dv - out * dv.dot(out)
            lat.z = 0
            return lat.length < 0.95 and hs - 0.2 < c.z < hs + 2.4

        blobs = [(A.lerp(B, rng.uniform(0.2, 0.8)).lerp(apex, rng.uniform(0.15, 0.35)), 0.7, 0.5)]
        colfn = tile_colfn('slate', rng, None, blobs, [hole], 1)
        tiles_facet(mb, A, B, apex, apex, n, 0.8, 0.6, colfn, rng, lift=0.09)
        # hip caps
        segs = 10
        for k in range(segs):
            p = A.lerp(apex, k / segs)
            q = A.lerp(apex, (k + 1) / segs + 0.01)
            hn = (V((A.x, A.y, 0)).normalized() * 0.4 + Z).normalized()
            mb.beam(p, q, hn, 0.26, 0.16, st['edge'] if k % 2 else shade(st['edge'], 0.88))
    # louvred dormers on each face of the spire
    for ang in (0, 90, 180, 270):
        dm = MB()
        w, hw = 1.5, 1.7
        depth = (hw + 1.0) / run + 0.6
        dm.box(-w / 2, w / 2, 0, depth, -1.0, hw, TSTONE[0], skip=('-z', '+z', '+y'))
        Fd = Facade((-w / 2, 0, 0), X, -Y)
        fbeam(dm, Fd, 0.12, 0, 0.12, hw, 0.2, 0.08, TSTONE[2])
        fbeam(dm, Fd, w - 0.12, 0, w - 0.12, hw, 0.2, 0.08, TSTONE[2])
        dm.poly([Fd.p(0.25, 0.15, 0.01), Fd.p(w - 0.25, 0.15, 0.01), Fd.p(w - 0.25, hw - 0.1, 0.01),
                 Fd.p(0.25, hw - 0.1, 0.01)], '#1e1c24', out=Fd.n)
        for k in range(5):
            hh = 0.3 + k * (hw - 0.45) / 5
            fbeam(dm, Fd, 0.25, hh, w - 0.25, hh + 0.12, 0.1, 0.1, '#5a5550', ends=True)
        sub = MB()
        gable_roof(sub, Matrix.Identity(4), depth, w, hw, 55, 'slate', rng, og=0.3, oe=0.2, ends=(False, True),
                   moss_blobs=0, tw=0.42, ch=0.36)
        dm.merge(sub, T(0, depth / 2, 0) @ Rz(-90))
        mb.merge(dm, Rz(ang) @ T(0, -b + setback, hs))
    # finial
    mb.cyl((0, 0, 29.6), 0.18, 0.5, 6, IRON)
    mb.octa((0, 0, 30.35), 0.22, '#c9a04a', 1.2)
    mb.cyl((0, 0, 30.4), 0.04, 1.0, 4, IRON)
    return mb.build('town_clock_tower')


def keep():
    rng = random.Random(606)
    mb = MB()
    R = 4.0
    seg = 20
    H = 13.0
    # battered base
    mb.cyl((0, 0, 0), R + 0.45, 1.4, seg, shade(TSTONE_BASE, 0.85), r2=R, caps=(False, False))
    mb.cyl((0, 0, 1.4), R, H - 1.4, seg, TSTONE_BASE, caps=(False, False))
    # block courses: proud blocks around the drum
    ch = 0.55
    rows = int((H - 1.6) / ch)
    door_a = -math.pi / 2  # front (-Y)
    for r in range(rows):
        zz = 1.5 + r * ch
        off = (math.pi / seg) if r % 2 else 0.0
        for i in range(seg):
            a0 = off + 2 * math.pi * i / seg
            a1 = a0 + 2 * math.pi / seg
            am = (a0 + a1) / 2
            dang = (am - door_a + math.pi) % (2 * math.pi) - math.pi
            if abs(dang) < 0.32 and zz < 4.2:
                continue
            if abs(dang) < 0.25 and 7.0 < zz < 9.6:
                continue
            if rng.random() > 0.55:
                continue
            ro = R + rng.uniform(0.03, 0.07)
            p = [V((R * math.cos(a0 + 0.02), R * math.sin(a0 + 0.02), zz + 0.03)),
                 V((R * math.cos(a1 - 0.02), R * math.sin(a1 - 0.02), zz + 0.03))]
            q = [V((ro * math.cos(a0 + 0.02), ro * math.sin(a0 + 0.02), 0)), V((ro * math.cos(a1 - 0.02), ro * math.sin(a1 - 0.02), 0))]
            col = rng.choice(TSTONE + STONE[:2])
            z0, z1 = zz + 0.03, zz + ch - 0.03
            f = [V((q[0].x, q[0].y, z0)), V((q[1].x, q[1].y, z0)), V((q[1].x, q[1].y, z1)), V((q[0].x, q[0].y, z1))]
            outv = V((math.cos(am), math.sin(am), 0))
            mb.poly(f, col, out=outv)
            mb.poly([f[3], f[2], V((p[1].x, p[1].y, z1)), V((p[0].x, p[0].y, z1))], shade(col, 1.08), out=Z)
    # entrance portal standing proud of the battered base, arched plank door on its face
    py = -R - 0.62
    mb.box(-1.35, 1.35, py, -R + 0.4, 0, 3.9, TSTONE[1], skip=('-z',), jit=0.02, rng=rng)
    mb.box(-1.45, 1.45, py - 0.08, -R + 0.4, 3.9, 4.15, TSTONE[2], skip=('-z',), jit=0.02, rng=rng)
    Fd = Facade((-0.9, py, 0), X, -Y)
    plank_door(mb, Fd, 0.9, 1.5, 3.0, rng, arch=True, d=0.03)
    for i in range(7):
        a0, a1 = math.pi * i / 7, math.pi * (i + 1) / 7
        ri, ro = 0.77, 1.2
        hs = 2.25
        pts = [Fd.p(0.9 + ri * math.cos(a0), hs + ri * math.sin(a0), 0.07), Fd.p(0.9 + ro * math.cos(a0), hs + ro * math.sin(a0), 0.07),
               Fd.p(0.9 + ro * math.cos(a1), hs + ro * math.sin(a1), 0.07), Fd.p(0.9 + ri * math.cos(a1), hs + ri * math.sin(a1), 0.07)]
        mb.poly(pts, [TSTONE[2], QUOIN[1]][i % 2], out=Fd.n)
    for sgn in (-1, 1):
        for k in range(4):
            wdt = 0.36 if k % 2 == 0 else 0.26
            s0 = 0.9 + sgn * 0.98
            fblock(mb, Fd, s0 - wdt / 2, s0 + wdt / 2, k * 0.56 + 0.02, k * 0.56 + 0.54, 0.07, [TSTONE[2], QUOIN[0]][k % 2])
    mb.box(-1.1, 1.1, py - 0.55, py, 0, 0.18, TSTONE[3], skip=('-z',), jit=0.02, rng=rng)
    # big arched window above the door (as in the concept) and slits around
    Fw = Facade((-0.6, -R + 0.01, 0), X, -Y)
    mb.poly([Fw.p(0, 7.2, 0.0), Fw.p(1.2, 7.2, 0.0), Fw.p(1.2, 8.8, 0.0), Fw.p(0.6, 9.4, 0.0), Fw.p(0, 8.8, 0.0)],
            '#2a2630', out=Fw.n)
    for i in range(6):
        a0, a1 = math.pi * i / 6, math.pi * (i + 1) / 6
        pts = [Fw.p(0.6 + 0.62 * math.cos(a0), 8.8 + 0.62 * math.sin(a0), 0.1), Fw.p(0.6 + 1.0 * math.cos(a0), 8.8 + 1.0 * math.sin(a0), 0.1),
               Fw.p(0.6 + 1.0 * math.cos(a1), 8.8 + 1.0 * math.sin(a1), 0.1), Fw.p(0.6 + 0.62 * math.cos(a1), 8.8 + 0.62 * math.sin(a1), 0.1)]
        mb.poly(pts, [TSTONE[2], QUOIN[0]][i % 2], out=Fw.n)
    fblock(mb, Fw, -0.2, 1.4, 6.95, 7.2, 0.15, TSTONE[2])
    for ang, zz in ((40, 5.0), (140, 5.0), (90, 9.0), (-10, 8.5), (190, 8.5), (90, 3.5)):
        a = math.radians(ang)
        out = V((math.cos(a), math.sin(a), 0))
        u = Z.cross(out).normalized()
        c = out * (R + 0.01)
        F = Facade(c - u * 0.3, u, out)
        mb.poly([F.p(0.22, zz, 0.0), F.p(0.38, zz, 0.0), F.p(0.38, zz + 1.2, 0.0), F.p(0.22, zz + 1.2, 0.0)],
                '#1f1c22', out=out)
        fblock(mb, F, 0.0, 0.6, zz - 0.2, zz, 0.1, TSTONE[2])
        fblock(mb, F, 0.0, 0.6, zz + 1.2, zz + 1.4, 0.1, TSTONE[1])
    # corbelled parapet with merlons
    Rp = R + 0.45
    for i in range(seg):
        a = 2 * math.pi * (i + 0.5) / seg
        out = V((math.cos(a), math.sin(a), 0))
        u = Z.cross(out)
        c = out * (R + 0.2) + V((0, 0, H - 0.45))
        mb.obox(c, u, out, Z, (0.22, 0.25, 0.45), rng.choice(TSTONE), skip=())
    mb.cyl((0, 0, H), Rp, 0.5, seg, TSTONE[2], caps=(True, False))
    mb.cyl((0, 0, H + 0.5), Rp - 0.05, 0.8, seg, TSTONE_BASE, caps=(False, False))
    mb.cyl((0, 0, H + 0.5), Rp - 0.55, 0.8, seg, shade(TSTONE_BASE, 0.8), caps=(False, False))
    # walk top (inside ring)
    ring_o = [V(((Rp - 0.05) * math.cos(2 * math.pi * i / seg), (Rp - 0.05) * math.sin(2 * math.pi * i / seg), H + 1.3)) for i in range(seg)]
    ring_i = [V(((Rp - 0.55) * math.cos(2 * math.pi * i / seg), (Rp - 0.55) * math.sin(2 * math.pi * i / seg), H + 1.3)) for i in range(seg)]
    for i in range(seg):
        j = (i + 1) % seg
        mb.poly([ring_o[i], ring_o[j], ring_i[j], ring_i[i]], TSTONE[2], out=Z)
    mb.poly([V(((Rp - 0.55) * math.cos(2 * math.pi * i / seg), (Rp - 0.55) * math.sin(2 * math.pi * i / seg), H + 0.6))
             for i in range(seg)], '#8f846f', out=Z)
    nm = 10
    for i in range(nm):
        a = 2 * math.pi * i / nm
        out = V((math.cos(a), math.sin(a), 0))
        u = Z.cross(out)
        c = out * (Rp - 0.3) + V((0, 0, H + 1.3 + 0.45))
        mb.obox(c, u, out, Z, (0.62, 0.3, 0.45), rng.choice(TSTONE + [TSTONE_BASE]), skip=('-z',), jit=0.03, rng=rng)
    return mb.build('town_keep')


def bridge():
    rng = random.Random(707)
    mb = MB()
    Lh = 8.0
    Wh = 3.0
    span = 8.0
    spring = 0.2
    rise = 2.8
    r = (span ** 2 / 4 + rise ** 2) / (2 * rise)
    zc = spring + rise - r
    a_lim = math.asin((span / 2) / r)

    def deck_z(x):
        return 3.5 - 0.3 * (x / Lh) ** 2

    def intrados(t):  # t in [0,1] left to right
        a = -a_lim + 2 * a_lim * t
        return V((r * math.sin(a), 0, zc + r * math.cos(a)))
    na = 14
    ring_t = 0.42
    # spandrel faces (front and back): mortar base polys
    for side in (-1, 1):
        y = side * Wh
        outn = V((0, side, 0))
        # abutments
        for xs in ((-Lh, -span / 2), (span / 2, Lh)):
            pts = [V((xs[0], y, 0)), V((xs[1], y, 0)), V((xs[1], y, deck_z(xs[1]))), V((xs[0], y, deck_z(xs[0])))]
            mb.poly(pts, MORTAR, out=outn)
        for i in range(na):
            p, q = intrados(i / na), intrados((i + 1) / na)
            mb.poly([V((p.x, y, p.z)), V((q.x, y, q.z)), V((q.x, y, deck_z(q.x))), V((p.x, y, deck_z(p.x)))], MORTAR,
                    out=outn)
        # block courses on the face, skipping the arch ring
        F = Facade((-Lh, y, 0), X if side < 0 else -X, outn) if side < 0 else Facade((Lh, y, 0), -X, outn)
        ch = 0.42
        for rr in range(int(4.1 / ch)):
            hh = 0.05 + rr * ch
            s = 0.0 if rr % 2 else 0.35
            while s < 2 * Lh - 0.1:
                bw = rng.uniform(0.6, 1.0)
                sa, sb = s + 0.03, min(s + bw - 0.03, 2 * Lh)
                xa = -Lh + sa if side < 0 else Lh - sb
                xb = -Lh + sb if side < 0 else Lh - sa
                top = hh + ch - 0.03
                ok = top < min(deck_z(xa), deck_z(xb)) + 0.6
                for xx in (xa, xb, (xa + xb) / 2):
                    if abs(xx) < span / 2 + ring_t + 0.05:
                        aa = math.asin(max(-1, min(1, xx / (r + ring_t))))
                        zr_ = zc + (r + ring_t) * math.cos(aa)
                        if hh < zr_ + 0.05:
                            ok = False
                if ok:
                    col = rng.choice(BRIDGE)
                    if hh < 1.2 and rng.random() < 0.45:
                        col = mix(col, '#6f8a3c', rng.uniform(0.3, 0.6))
                    elif rng.random() < 0.1:
                        col = rng.choice(CAP)
                    fblock(mb, F, sa, sb, hh + 0.03, top, rng.uniform(0.03, 0.07), col)
                s += bw
        # voussoirs
        nv = 15
        for i in range(nv):
            a0 = -a_lim + 2 * a_lim * i / nv
            a1 = -a_lim + 2 * a_lim * (i + 1) / nv
            rr_o = r + ring_t + (0.08 if i % 2 else 0.0)
            col = rng.choice(BRIDGE[:3] + [CAP[2]])
            dd = 0.1
            pts = [V((r * math.sin(a0 + 0.01), y + side * dd, zc + r * math.cos(a0 + 0.01))),
                   V((r * math.sin(a1 - 0.01), y + side * dd, zc + r * math.cos(a1 - 0.01))),
                   V((rr_o * math.sin(a1 - 0.01), y + side * dd, zc + rr_o * math.cos(a1 - 0.01))),
                   V((rr_o * math.sin(a0 + 0.01), y + side * dd, zc + rr_o * math.cos(a0 + 0.01)))]
            mb.poly(pts, col, out=outn)
            back = [V((p.x, y, p.z)) for p in pts]
            mb.poly([pts[2], pts[3], back[3], back[2]], shade(col, 1.05), out=pts[2] + pts[3] - 2 * V((0, y, zc)))
            mb.poly([pts[0], pts[1], back[1], back[0]], shade(col, 0.7), out=-(pts[0] + pts[1] - 2 * V((0, y, zc))))
            mb.poly([pts[1], pts[2], back[2], back[1]], shade(col, 0.85), out=V((math.cos(a1), 0, -math.sin(a1))))
            mb.poly([pts[3], pts[0], back[0], back[3]], shade(col, 0.85), out=V((-math.cos(a0), 0, math.sin(a0))))
    # arch barrel (soffit) in courses
    nb = 6
    for i in range(na):
        p, q = intrados(i / na), intrados((i + 1) / na)
        for k in range(nb):
            ya = -Wh + 2 * Wh * k / nb
            yb = ya + 2 * Wh / nb
            off = 0.5 * (2 * Wh / nb) * (i % 2)
            col = rng.choice(BRIDGE)
            mb.poly([V((p.x, ya, p.z)), V((q.x, ya, q.z)), V((q.x, yb, q.z)), V((p.x, yb, p.z))], shade(col, 0.8),
                    out=-(p + q) / 2 + V((0, 0, zc)))
    # abutment inner faces down to the ground
    for sx in (-1, 1):
        x = sx * span / 2
        mb.poly([V((x, -Wh, 0)), V((x, Wh, 0)), V((x, Wh, spring)), V((x, -Wh, spring))], MORTAR, out=V((-sx, 0, 0)))
    # deck paving (flagstones) between the parapets, following the hump
    pw = Wh - 0.45
    nx = 22
    for i in range(nx):
        xa = -Lh + 2 * Lh * i / nx
        xb = -Lh + 2 * Lh * (i + 1) / nx
        ny = 5
        for k in range(ny):
            off = (0.5 if i % 2 else 0.0) * (2 * pw / ny)
            ya = -pw + 2 * pw * k / ny + (off if k else 0)
            yb = min(pw, -pw + 2 * pw * (k + 1) / ny + off)
            if k == ny - 1:
                yb = pw
            col = rng.choice(BRIDGE + [CAP[3]])
            lift = rng.uniform(0.01, 0.04)
            g = 0.03
            pts = [V((xa + g, ya + g, deck_z(xa) + lift)), V((xb - g, ya + g, deck_z(xb) + lift)),
                   V((xb - g, yb - g, deck_z(xb) + lift)), V((xa + g, yb - g, deck_z(xa) + lift))]
            mb.poly(pts, col, out=Z)
    for i in range(nx):
        xa = -Lh + 2 * Lh * i / nx
        xb = -Lh + 2 * Lh * (i + 1) / nx
        mb.poly([V((xa, -pw, deck_z(xa))), V((xb, -pw, deck_z(xb))), V((xb, pw, deck_z(xb))), V((xa, pw, deck_z(xa)))],
                MORTAR, out=Z)
    # parapets with capstones
    for side in (-1, 1):
        yo, yi = side * Wh, side * pw
        nseg = 16
        for i in range(nseg):
            xa = -Lh + 2 * Lh * i / nseg
            xb = -Lh + 2 * Lh * (i + 1) / nseg
            za, zb = deck_z(xa), deck_z(xb)
            hp = 0.65
            # inner face, outer face of the parapet wall
            mb.poly([V((xa, yi, za)), V((xb, yi, zb)), V((xb, yi, zb + hp)), V((xa, yi, za + hp))],
                    rng.choice(BRIDGE[1:4]), out=V((0, -side, 0)))
            mb.poly([V((xa, yo, za - 0.05)), V((xb, yo, zb - 0.05)), V((xb, yo, zb + hp)), V((xa, yo, za + hp))],
                    rng.choice(BRIDGE[1:4]), out=V((0, side, 0)))
            # a couple of proud blocks on the inner parapet face
            if rng.random() < 0.6:
                xm = (xa + xb) / 2
                zm = deck_z(xm)
                mb.box(xa + 0.05, xb - 0.05, min(yi, yi - side * 0.04), max(yi, yi - side * 0.04), zm + 0.08,
                       zm + 0.38, rng.choice(BRIDGE), skip=('-z',))
            # capstone
            cz = (za + zb) / 2 + hp
            dx = xb - xa
            ang = math.atan2(zb - za, dx)
            ax = V((math.cos(ang), 0, math.sin(ang)))
            c = V(((xa + xb) / 2, (yo + yi) / 2, cz + 0.14))
            col = rng.choice(CAP + BRIDGE[4:])
            if rng.random() < 0.18:
                col = rng.choice(MOSS)
            mb.obox(c, ax, Y, ax.cross(Y) * -1, (dx / 2 - 0.008, 0.34, 0.14), col, skip=('-z',), jit=0.012, rng=rng)
        # end piers
        for sx in (-1, 1):
            x = sx * (Lh - 0.35)
            z = deck_z(x)
            mb.box(x - 0.4, x + 0.4, min(yo + side * 0.08, yi - side * 0.05), max(yo + side * 0.08, yi - side * 0.05),
                   z - 0.1, z + 1.05, CAP[0], skip=('-z',), jit=0.03, rng=rng)
            mb.box(x - 0.47, x + 0.47, min(yo + side * 0.14, yi - side * 0.1), max(yo + side * 0.14, yi - side * 0.1),
                   z + 1.05, z + 1.25, CAP[1], skip=('-z',), jit=0.02, rng=rng)
    # ends of the bridge (where it meets the road), mortar
    for sx in (-1, 1):
        x = sx * Lh
        mb.poly([V((x, -Wh, 0)), V((x, Wh, 0)), V((x, Wh, deck_z(x))), V((x, -Wh, deck_z(x)))], MORTAR,
                out=V((sx, 0, 0)))
    # moss and ivy patches on the spandrels
    for _ in range(10):
        side = rng.choice((-1, 1))
        x = rng.uniform(-Lh + 0.5, Lh - 0.5)
        z = rng.uniform(0.3, 1.8)
        if abs(x) < span / 2 + 0.6:
            continue
        mb.octa((x, side * (Wh + 0.05), z), rng.uniform(0.18, 0.32), rng.choice(MOSS), 0.6, rng, 0.05)
    return mb.build('town_bridge')


def canal_wall():
    rng = random.Random(808)
    mb = MB()
    L, H, T_ = 8.0, 3.0, 1.0
    y0 = -T_ / 2
    mb.box(-L / 2, L / 2, y0, T_ / 2, 0, H - 0.35, MORTAR, skip=('-z',))
    F = Facade((-L / 2, y0, 0), X, -Y)
    ch = 0.44
    for r in range(int((H - 0.35) / ch)):
        hh = r * ch
        s = 0.0 if r % 2 == 0 else -0.4
        while s < L - 0.01:
            bw = rng.uniform(0.7, 1.1)
            sa, sb = max(0.0, s) + 0.025, min(L, s + bw) - 0.025
            if sb - sa > 0.2:
                col = rng.choice(CANAL)
                if hh < 0.9 and rng.random() < 0.3:
                    col = mix(col, '#5f7a3a', 0.45)
                fblock(mb, F, sa, sb, hh + 0.025, hh + ch - 0.025, rng.uniform(0.03, 0.08), col)
            s += bw
    # capstone row: chunky slabs overhanging the water side
    s = 0.0
    while s < L - 0.01:
        bw = min(rng.uniform(0.85, 1.15), L - s)
        if L - s - bw < 0.4:
            bw = L - s
        col = rng.choice(CAP)
        if rng.random() < 0.2:
            col = mix(col, MOSS[1], 0.5)
        mb.box(-L / 2 + s + 0.02, -L / 2 + s + bw - 0.02, y0 - 0.12, T_ / 2 + 0.05, H - 0.35, H + rng.uniform(-0.02, 0.03),
               col, skip=('-z',), jit=0.015, rng=rng)
        s += bw
    # moss tufts and drips
    for _ in range(7):
        x = rng.uniform(-L / 2 + 0.4, L / 2 - 0.4)
        mb.octa((x, y0 - 0.06, rng.uniform(0.3, 2.3)), rng.uniform(0.14, 0.26), rng.choice(MOSS), 0.6, rng, 0.04)
    for _ in range(4):
        x = rng.uniform(-L / 2 + 0.4, L / 2 - 0.4)
        mb.octa((x, y0 - 0.1, H - 0.4), rng.uniform(0.16, 0.24), rng.choice(MOSS), 0.5, rng, 0.04)
    return mb.build('town_canal_wall')


def stairs():
    rng = random.Random(909)
    mb = MB()
    W, rise, run = 4.0, 3.0, 6.0
    n = 18
    sr = rise / n
    tr = run / n
    cw = 0.4
    xi = W / 2 - cw
    y0 = -run / 2
    for i in range(n):
        ya = y0 + i * tr
        za = (i + 1) * sr
        # each tread split into 2-3 stones
        parts = rng.choice((2, 3))
        cuts = sorted([-xi] + [rng.uniform(-xi + 0.6, xi - 0.6) for _ in range(parts - 1)] + [xi])
        for a, b in zip(cuts, cuts[1:]):
            col = rng.choice(BRIDGE + CAP[2:4])
            mb.box(a + 0.015, b - 0.015, ya - 0.04, ya + tr + 0.02, za - sr - 0.02, za + rng.uniform(-0.01, 0.02), col,
                   skip=('-z', '+y'), jit=0.012, rng=rng, cols={'-y': shade(col, 0.82)})
        # fill below the step (front riser down to the ground is covered by the next steps)
    # under-body sides (the cheek walls hide them) and back face
    mb.poly([V((-xi, run / 2, 0)), V((xi, run / 2, 0)), V((xi, run / 2, rise)), V((-xi, run / 2, rise))], MORTAR,
            out=Y)
    # cheek walls with sloped coping
    for sx in (-1, 1):
        xa, xb = sx * xi, sx * (W / 2)
        x0_, x1_ = min(xa, xb), max(xa, xb)
        prof = [(y0 - 0.1, 0), (run / 2, 0), (run / 2, rise + 0.45), (y0 - 0.1, 0.45)]
        # outer and inner faces
        for x, out in ((x1_ if sx > 0 else x0_, V((sx, 0, 0))), (x0_ if sx > 0 else x1_, V((-sx, 0, 0)))):
            mb.poly([V((x, p[0], p[1])) for p in prof], MORTAR if out.x * sx < 0 else STONE_BASE, out=out)
        mb.poly([V((x0_, y0 - 0.1, 0)), V((x1_, y0 - 0.1, 0)), V((x1_, y0 - 0.1, 0.45)), V((x0_, y0 - 0.1, 0.45))],
                STONE_BASE, out=-Y)
        # coping stones along the slope
        ncs = 7
        for k in range(ncs):
            ya = y0 - 0.1 + (run + 0.1) * k / ncs
            yb = y0 - 0.1 + (run + 0.1) * (k + 1) / ncs
            za = 0.45 + rise * (ya - (y0 - 0.1)) / (run + 0.1)
            zb = 0.45 + rise * (yb - (y0 - 0.1)) / (run + 0.1)
            ang = math.atan2(zb - za, yb - ya)
            ay = V((0, math.cos(ang), math.sin(ang)))
            c = V(((x0_ + x1_) / 2, (ya + yb) / 2, (za + zb) / 2 + 0.11))
            mb.obox(c, X, ay, X.cross(ay), (cw / 2 + 0.06, (yb - ya) / 2 - 0.02, 0.11), rng.choice(CAP), skip=('-z',),
                    jit=0.015, rng=rng)
        # proud blocks on the outer face
        F = Facade((sx * W / 2, -run / 2 if sx > 0 else run / 2, 0), V((0, sx, 0)), V((sx, 0, 0)))
        for _ in range(16):
            s = rng.uniform(0.3, run - 0.9)
            ss = s if sx > 0 else s
            yy = -run / 2 + s if sx > 0 else run / 2 - s
            top = 0.45 + rise * (yy - (y0 - 0.1)) / (run + 0.1)
            h0 = rng.uniform(0.05, max(0.1, top - 0.5))
            fblock(mb, F, s, s + rng.uniform(0.4, 0.8), h0, h0 + 0.38, 0.04, rng.choice(STONE))
    return mb.build('town_stairs')


def market_stall():
    rng = random.Random(1001)
    mb = MB()
    W, D = 3.0, 2.0
    # counter table
    mb.box(-1.35, 1.35, -0.95, -0.25, 0.8, 0.9, WOOD[1], skip=())
    mb.box(-1.3, 1.3, -0.9, -0.3, 0.0, 0.8, WOOD[2], skip=('-z',), cols={'-y': WOOD[0]})
    for i in range(5):
        x = -1.3 + i * 0.65
        mb.box(x - 0.02, x + 0.02, -0.93, -0.88, 0.05, 0.78, WOOD_DK, skip=('-z',))
    # crates on the counter, tilted towards the customer
    for i in range(4):
        produce_crate(mb, (-1.0 + i * 0.66, -0.6, 0.9), 0.56, 0.5, 0.2, rng,
                      [PRODUCE[(i * 2) % len(PRODUCE)], PRODUCE[(i * 2 + 1) % len(PRODUCE)]])
    # back shelf with baskets
    mb.box(-1.4, 1.4, 0.45, 0.95, 0.0, 1.05, WOOD[0], skip=('-z',), cols={'+z': WOOD[3]})
    for i in range(3):
        x = -0.95 + i * 0.95
        mb.cyl((x, 0.7, 1.05), 0.28, 0.24, 8, '#c29550', r2=0.33, caps=(False, False))
        mb.cyl((x, 0.7, 1.06), 0.27, 0.0, 8, '#8a6a3a', caps=(False, True))
        for k in range(6):
            a = 2 * math.pi * k / 6
            mb.octa((x + 0.15 * math.cos(a), 0.7 + 0.15 * math.sin(a), 1.27), 0.09, rng.choice(PRODUCE), 0.9, rng, 0.01)
    # ground crates
    produce_crate(mb, (-1.15, -1.3, 0.0), 0.55, 0.45, 0.42, rng, PRODUCE[2])
    produce_crate(mb, (0.95, -1.25, 0.0), 0.55, 0.45, 0.42, rng, PRODUCE[3])
    mb.box(1.25, 1.65, -0.3, 0.1, 0, 0.4, WOOD[2], skip=('-z',), jit=0.01, rng=rng)
    # A-frame chalk board
    for sy in (-1, 1):
        a = V((0.15, -1.25 + sy * 0.0, 0))
    p0 = V((-0.25, -1.45, 0.0))
    mb.obox(V((-0.25, -1.42, 0.38)), X, V((0, math.sin(0.25), math.cos(0.25))), V((0, -math.cos(0.25), math.sin(0.25))),
            (0.25, 0.38, 0.02), '#3a3633', skip=())
    for sx in (-1, 1):
        mb.beam(V((-0.25 + sx * 0.27, -1.6, 0)), V((-0.25 + sx * 0.27, -1.4, 0.8)), V((0, -1, 0.2)), 0.05, 0.04, AWN_YEL,
                ends=True)
        mb.beam(V((-0.25 + sx * 0.27, -1.2, 0)), V((-0.25 + sx * 0.27, -1.4, 0.8)), V((0, 1, 0.2)), 0.05, 0.04, AWN_YEL,
                ends=True)
    # posts
    for x, y, h in ((-1.45, -0.95, 2.25), (1.45, -0.95, 2.25), (-1.45, 0.95, 2.55), (1.45, 0.95, 2.55)):
        mb.box(x - 0.06, x + 0.06, y - 0.06, y + 0.06, 0, h, TIMBER_LT, skip=('-z',))
    mb.box(-1.5, 1.5, 0.89, 1.01, 2.45, 2.57, TIMBER, skip=())
    # awning: canvas from back (high) to front (low) over the posts
    F = Facade((-1.55, 1.0, 0), X, -Y)
    awning(mb, F, 0.0, 3.1, 2.62, 2.15, 0.45, [AWN_RED, AWN_CREAM], rng, valance=0.25, stripe=0.38, segs=4)
    return mb.build('town_market_stall')


def lamp():
    rng = random.Random(1101)
    mb = MB()
    # stepped octagonal base
    mb.cyl((0, 0, 0), 0.28, 0.12, 8, IRON, caps=(False, True), phase=math.pi / 8)
    mb.cyl((0, 0, 0.12), 0.2, 0.3, 8, IRON, r2=0.13, caps=(False, True), phase=math.pi / 8)
    mb.cyl((0, 0, 0.42), 0.15, 0.08, 8, IRON_LT, caps=(True, True), phase=math.pi / 8)
    mb.cyl((0, 0, 0.5), 0.075, 2.0, 8, IRON, r2=0.06, phase=math.pi / 8)
    for z in (1.15, 2.25):
        mb.cyl((0, 0, z), 0.1, 0.08, 8, IRON_LT, caps=(True, True), phase=math.pi / 8)
    # collar and lantern seat
    mb.cyl((0, 0, 2.5), 0.07, 0.18, 8, IRON, r2=0.13, caps=(False, True), phase=math.pi / 8)
    mb.cyl((0, 0, 2.68), 0.22, 0.06, 4, IRON, caps=(True, True), phase=math.pi / 4)
    # lantern: tapered square glass box, wider at the top
    zb, zt = 2.74, 3.22
    rb, rt = 0.17, 0.24
    mb.cyl((0, 0, zb), rb * 1.05, zt - zb, 4, GLOW, r2=rt * 1.05, mat=1, phase=math.pi / 4, caps=(False, False))
    for k in range(4):
        a = math.pi / 4 + k * math.pi / 2
        p0 = V((rb * 1.06 * math.cos(a), rb * 1.06 * math.sin(a), zb))
        p1 = V((rt * 1.06 * math.cos(a), rt * 1.06 * math.sin(a), zt))
        out = V((math.cos(a), math.sin(a), 0))
        mb.beam(p0, p1, out, 0.04, 0.04, IRON, ends=True)
    mb.cyl((0, 0, zt), 0.31, 0.05, 4, IRON, caps=(True, True), phase=math.pi / 4)
    mb.cyl((0, 0, zt + 0.05), 0.31, 0.24, 4, IRON, r2=0.06, caps=(False, False), phase=math.pi / 4)
    mb.cyl((0, 0, zt + 0.29), 0.05, 0.08, 6, IRON)
    mb.octa((0, 0, zt + 0.42), 0.05, IRON, 1.4)
    # cross arm with two hanging flower baskets (as in the concept foreground)
    za = 2.1
    mb.box(-0.62, 0.62, -0.025, 0.025, za, za + 0.05, IRON, skip=())
    for sx in (-1, 1):
        mb.beam(V((sx * 0.08, 0, za - 0.35)), V((sx * 0.45, 0, za)), V((0, -1, 0)), 0.03, 0.03, IRON, ends=True)
        x = sx * 0.55
        for k in range(3):
            a = 2 * math.pi * k / 3
            mb.beam(V((x, 0, za)), V((x + 0.17 * math.cos(a), 0.17 * math.sin(a), za - 0.4)), V((math.sin(a), -math.cos(a), 0)),
                    0.015, 0.015, IRON)
        mb.cyl((x, 0, za - 0.62), 0.12, 0.22, 8, '#b0552e', r2=0.2, caps=(True, False))
        mb.cyl((x, 0, za - 0.4), 0.19, 0.0, 8, '#5b3d24', caps=(False, True))
        for k in range(7):
            a = 2 * math.pi * k / 7
            rr = 0.13 if k else 0.0
            mb.octa((x + rr * math.cos(a), rr * math.sin(a), za - 0.32 + rng.uniform(0, 0.05)), 0.08,
                    rng.choice(FLOWERS[1:3] + ['#f08ab0']), 0.9, rng, 0.01)
        for k in range(4):
            a = 2 * math.pi * k / 4 + 0.4
            mb.octa((x + 0.17 * math.cos(a), 0.17 * math.sin(a), za - 0.42), 0.09, rng.choice(LEAF), 0.9, rng, 0.02)
    return mb.build('town_lamp')


def planter():
    rng = random.Random(1201)
    mb = MB()
    w, d, h = 1.2, 0.6, 0.48
    mb.box(-w / 2, w / 2, -d / 2, d / 2, 0, h, '#a0683a', skip=('-z',), cols={'+z': '#5b3d24'})
    # plank lines and corner posts
    for z in (0.16, 0.32):
        mb.box(-w / 2 - 0.015, w / 2 + 0.015, -d / 2 - 0.015, d / 2 + 0.015, z - 0.015, z + 0.015, WOOD_DK,
               skip=('-z', '+z'))
    for sx in (-1, 1):
        for sy in (-1, 1):
            mb.box(sx * w / 2 - 0.05, sx * w / 2 + 0.05, sy * d / 2 - 0.05, sy * d / 2 + 0.05, 0, h + 0.05, WOOD[3],
                   skip=('-z',))
    # top rim
    for sy in (-1, 1):
        mb.box(-w / 2 - 0.03, w / 2 + 0.03, sy * d / 2 - 0.05, sy * d / 2 + 0.05, h, h + 0.04, WOOD[1], skip=('-z',))
    # flowers: a full mound in red, pink and white over green
    for i in range(7):
        for j in range(3):
            x = -w / 2 + 0.12 + i * (w - 0.24) / 6 + rng.uniform(-0.03, 0.03)
            y = -d / 2 + 0.13 + j * (d - 0.26) / 2 + rng.uniform(-0.03, 0.03)
            mb.octa((x, y, h + 0.1), 0.19, rng.choice(LEAF), 0.65, rng, 0.03, top_only=True)
    for i in range(26):
        x = rng.uniform(-w / 2 + 0.1, w / 2 - 0.1)
        y = rng.uniform(-d / 2 + 0.08, d / 2 - 0.08)
        mb.octa((x, y, h + 0.2 + rng.uniform(0, 0.1)), rng.uniform(0.09, 0.13), rng.choice(FLOWERS), 0.5, rng, 0.02,
                top_only=True)
    return mb.build('town_planter')


def fence():
    rng = random.Random(1301)
    mb = MB()
    L = 3.0
    for x in (-L / 2, 0.0, L / 2):
        mb.box(x - 0.07, x + 0.07, -0.07, 0.07, 0, 1.1, WOOD[2], skip=('-z',))
        mb.obox(V((x, 0, 1.1)), X, Y, Z, (0.075, 0.075, 0.04), WOOD[3], skip=('-z',))
    for z in (0.45, 0.88):
        segs = 2
        for k in range(segs):
            xa = -L / 2 + L * k / segs
            xb = xa + L / segs
            mb.obox(V(((xa + xb) / 2, -0.09, z + rng.uniform(-0.01, 0.01))), X, Y, Z, ((xb - xa) / 2, 0.035, 0.065),
                    rng.choice(WOOD[:3]), skip=('+y',), jit=0.01, rng=rng)
    return mb.build('town_fence')


def props_cluster():
    rng = random.Random(1401)
    mb = MB()

    def barrel(x, y, z=0.0, h=0.9, r=0.33):
        c = rng.choice(WOOD)
        mb.cyl((x, y, z), r * 0.88, h / 2, 10, c, r2=r, caps=(False, False))
        mb.cyl((x, y, z + h / 2), r, h / 2, 10, c, r2=r * 0.88, caps=(False, True), cap_col='#6a4428')
        for zz, rr in ((0.12, 0.91), (h - 0.12, 0.91), (h * 0.36, 0.98), (h * 0.64, 0.98)):
            mb.cyl((x, y, z + zz - 0.03), r * rr + 0.015, 0.06, 10, IRON_LT, caps=(False, False))
    barrel(-1.1, 0.45)
    barrel(-0.4, 0.6)
    barrel(-0.8, -0.05, 0.0, 0.75, 0.29)
    # crates (one stacked)
    for (x, y, z, s) in ((0.45, 0.45, 0, 0.62), (0.45, 0.45, 0.62, 0.5), (1.15, 0.5, 0, 0.55)):
        c = rng.choice(WOOD)
        mb.box(x - s / 2, x + s / 2, y - s / 2, y + s / 2, z, z + s, c, skip=('-z',), jit=0.01, rng=rng)
        for F, W in faces_of(x - s / 2, x + s / 2, y - s / 2, y + s / 2, z).values():
            fbeam(mb, F, 0.04, 0.04, W - 0.04, s - 0.04, 0.07, 0.025, shade(c, 0.75))
            fbeam(mb, F, 0, 0.04, W, 0.04, 0.07, 0.025, shade(c, 0.75))
            fbeam(mb, F, 0, s - 0.04, W, s - 0.04, 0.07, 0.025, shade(c, 0.75))
    # sack
    mb.octa((1.2, 0.45, 0.72), 0.2, '#d9c49a', 1.1, rng, 0.03)
    # bench (front)
    by = -0.6
    mb.box(-0.9, 0.9, by - 0.2, by + 0.2, 0.42, 0.5, WOOD[1], skip=())
    mb.box(-0.9, 0.9, by + 0.2, by + 0.26, 0.55, 0.85, WOOD[0], skip=())
    for x in (-0.78, 0.78):
        mb.box(x - 0.05, x + 0.05, by - 0.17, by - 0.07, 0, 0.42, WOOD_DK, skip=('-z',))
        mb.box(x - 0.05, x + 0.05, by + 0.16, by + 0.26, 0, 0.9, WOOD_DK, skip=('-z',))
        mb.box(x - 0.05, x + 0.05, by - 0.22, by + 0.26, 0.6, 0.65, WOOD_DK, skip=())
        mb.box(x - 0.05, x + 0.05, by - 0.22, by - 0.15, 0.5, 0.6, WOOD_DK, skip=())
    return mb.build('town_props_cluster')


def cobble_patch():
    rng = random.Random(1501)
    mb = MB()
    L = 8.0
    mb.poly([V((-L / 2, -L / 2, 0.01)), V((L / 2, -L / 2, 0.01)), V((L / 2, L / 2, 0.01)), V((-L / 2, L / 2, 0.01))],
            GROUT, out=Z)
    rd = 0.5
    rows = int(L / rd)
    for r in range(rows):
        ya, yb = -L / 2 + r * rd, -L / 2 + (r + 1) * rd
        x = -L / 2 - (rng.uniform(0.1, 0.35) if r % 2 else 0.0)
        while x < L / 2 - 0.01:
            w = rng.uniform(0.45, 0.75)
            xa, xb = max(-L / 2, x), min(L / 2, x + w)
            if L / 2 - xb < 0.2:
                xb = L / 2
            x += w if xb < L / 2 else L
            if xb - xa < 0.12:
                continue
            g = 0.04
            h = rng.uniform(0.07, 0.12)
            ins = min(0.07, (xb - xa) / 4)
            col = rng.choice(COBBLE)
            if rng.random() < 0.08:
                col = mix(col, '#8ea04a', 0.35)
            j = [rng.uniform(-0.025, 0.025) for _ in range(8)]
            b = [V((xa + g, ya + g, 0.01)), V((xb - g, ya + g, 0.01)), V((xb - g, yb - g, 0.01)), V((xa + g, yb - g, 0.01))]
            t = [V((xa + g + ins + j[0], ya + g + ins + j[1], h)), V((xb - g - ins + j[2], ya + g + ins + j[3], h + j[4] * 0.5)),
                 V((xb - g - ins + j[5], yb - g - ins + j[6], h)), V((xa + g + ins + j[7], yb - g - ins + j[0], h + j[3] * 0.5))]
            mb.poly(t, col, out=Z)
            for k in range(4):
                m = (b[k] + b[(k + 1) % 4]) / 2 - V(((xa + xb) / 2, (ya + yb) / 2, 0))
                mb.poly([b[k], b[(k + 1) % 4], t[(k + 1) % 4], t[k]], shade(col, 0.85), out=m + Z * 0.1)
    return mb.build('town_cobble_patch')


BUILDERS = {
    'town_house_blue': house_blue,
    'town_house_red': house_red,
    'town_house_narrow': house_narrow,
    'town_house_corner': house_corner,
    'town_clock_tower': clock_tower,
    'town_keep': keep,
    'town_bridge': bridge,
    'town_canal_wall': canal_wall,
    'town_stairs': stairs,
    'town_market_stall': market_stall,
    'town_lamp': lamp,
    'town_planter': planter,
    'town_fence': fence,
    'town_props_cluster': props_cluster,
    'town_cobble_patch': cobble_patch,
}
LANDMARKS = {'town_clock_tower', 'town_keep', 'town_bridge'}
CAPS = {k: (10000 if k in LANDMARKS else 4000) for k in BUILDERS}
if os.environ.get('TOWN_NOCAP'):  # iterate on looks before trimming triangles
    CAPS = {k: 10 ** 9 for k in BUILDERS}


def bounds(obj):
    pts = [obj.matrix_world @ v.co for v in obj.data.vertices]
    lo = V((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
    hi = V((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
    return lo, hi


# collider / placement data (game space: y up; half = [hx, hy, hz] with hy half height)
PLACEMENT = {
    'town_house_blue': (dict(kind='box', half=[4.25, 3.23, 3.75]),
                        'Building. Front (door, dormer) faces +Z. Collider covers the walls up to the eaves '
                        '(box centred at y = hy). Stone ground floor 3 m, eaves 6.45 m.'),
    'town_house_red': (dict(kind='box', half=[3.6, 4.2, 4.3]),
                       'Building, front gable faces +Z; upper floors jetty 0.6 m out over the street. '
                       'Collider to the eaves, centred at y = hy.'),
    'town_house_narrow': (dict(kind='box', half=[2.55, 4.25, 3.65]),
                          'Narrow townhouse with a shop front and awning on +Z; line several up with ~5.2 m '
                          'spacing for a street. Awning sticks 1.5 m out in front (not in the collider).'),
    'town_house_corner': (dict(kind='box', half=[5.2, 3.0, 4.2]),
                          'Wide L-shaped house: gable wing on the front left, market stall with awning on the '
                          'front right (+Z). Good on a plaza corner. Collider is the full footprint.'),
    'town_clock_tower': (dict(kind='box', half=[3.6, 15.0, 3.6]),
                         'Landmark: place once on the main plaza, arched door facing the plaza (+Z). '
                         'Visible from far away; keep 6 m clear around it.'),
    'town_keep': (dict(kind='cylinder', radius=4.1, height=14.3),
                  'Landmark: round watch tower for a distant hilltop, door faces +Z. Sink the battered base '
                  '0.3 m into the slope.'),
    'town_bridge': (dict(kind='none'),
                    'Landmark: stone arch bridge, deck runs along local x (16 m), canal flows along local z under '
                    'the 8 m arch. Walkable: no collider; the terrain/walk mesh must carry the deck (3.5 m at the '
                    'centre, 3.2 m at the ends) and the parapet tops (deck + 0.65 m) need thin walls if wanted.'),
    'town_canal_wall': (dict(kind='box', half=[4.0, 1.5, 0.55]),
                        'Tiles every 8 m along its local x. Water side faces +Z; base at the canal bed, '
                        'top 3 m above it, back flush with the bank.'),
    'town_stairs': (dict(kind='none'),
                    'Walkable: no collider; the terrain must carry the steps. Rises 3 m from local -z (bottom) '
                    'to +z (top) over 6 m, 4 m wide incl. 0.4 m cheek walls.'),
    'town_market_stall': (dict(kind='box', half=[1.5, 1.3, 1.0]),
                          'Customer side faces +Z. Scatter in rows on the plaza, 3.5 m apart.'),
    'town_lamp': (dict(kind='cylinder', radius=0.2, height=3.6),
                  'Street lamp; lantern glass uses fx_glow. Place every 10-14 m along streets, bridge ends '
                  'and the plaza.'),
    'town_planter': (dict(kind='box', half=[0.62, 0.4, 0.32]),
                     'Flower planter; scatter along walls, bridge parapets and the plaza edge.'),
    'town_fence': (dict(kind='box', half=[1.5, 0.55, 0.1]),
                   'Tiles every 3 m along its local x (end posts coincide). Use along the winding hill road.'),
    'town_props_cluster': (dict(kind='box', half=[1.5, 0.5, 0.95]),
                           'Barrels, crates and a bench; drop beside doors and stalls. Bench faces +Z.'),
    'town_cobble_patch': (dict(kind='none'),
                          'Ground dressing: 8 x 8 m, 0.13 m tall. Tiles on a grid every 8 m over flat-ish '
                          'terrain (plaza, streets); sink 0.02 m.'),
}
FOOTPRINT = {
    'town_house_blue': 6.5, 'town_house_red': 6.2, 'town_house_narrow': 4.8, 'town_house_corner': 7.0,
    'town_clock_tower': 7.0, 'town_keep': 6.0, 'town_bridge': 9.0, 'town_canal_wall': 4.2, 'town_stairs': 3.8,
    'town_market_stall': 2.2, 'town_lamp': 0.6, 'town_planter': 0.8, 'town_fence': 1.6, 'town_props_cluster': 1.8,
    'town_cobble_patch': 0.0,
}


def write_props_json(sizes):
    path = os.path.join(ek.SOURCE, KIT, 'props.json')
    data = {}
    if os.path.exists(path):
        with open(path) as f:
            data = json.load(f)
    for name in BUILDERS:
        if name not in sizes and name not in data:
            continue
        col, notes = PLACEMENT[name]
        size = sizes.get(name, data.get(name, {}).get('size'))
        data[name] = {'landmark': name in LANDMARKS, 'collider': col, 'footprint': FOOTPRINT[name], 'size': size,
                      'notes': notes}
    data = {k: data[k] for k in BUILDERS if k in data}
    with open(path, 'w') as f:
        json.dump(data, f, indent=2)
        f.write('\n')
    print(f'ENVKIT {KIT}: wrote {os.path.relpath(path, ek.REPO)}')


def build_sheet():
    ek.reset()
    order = ['town_clock_tower', 'town_keep', 'town_house_blue', 'town_house_red', 'town_house_narrow',
             'town_house_corner', 'town_bridge', 'town_canal_wall', 'town_stairs', 'town_cobble_patch',
             'town_market_stall', 'town_props_cluster', 'town_lamp', 'town_planter', 'town_fence']
    place = {
        'town_clock_tower': (0, 0), 'town_keep': (11, 4), 'town_house_blue': (-11, -2), 'town_house_red': (-22, 2),
        'town_house_narrow': (21, 2), 'town_house_corner': (31, 4), 'town_bridge': (-4, -16), 'town_canal_wall': (12, -14),
        'town_stairs': (21, -14), 'town_cobble_patch': (-22, -14), 'town_market_stall': (28, -13),
        'town_props_cluster': (32, -15), 'town_lamp': (5, -9), 'town_planter': (7, -10), 'town_fence': (24, -19),
    }
    objs = []
    for name in order:
        obj = BUILDERS[name]()
        obj.location = (*place[name], 0)
        objs.append(obj)
    bpy.context.view_layer.update()
    scene = bpy.context.scene
    scene.render.engine = 'BLENDER_WORKBENCH'
    sh = scene.display.shading
    sh.light = 'STUDIO'
    sh.color_type = 'VERTEX'
    sh.show_shadows = True
    scene.render.resolution_x = 2400
    scene.render.resolution_y = 1350
    world = bpy.data.worlds.new('World')
    scene.world = world
    world.color = (0.55, 0.62, 0.70)
    sh.background_type = 'WORLD'
    cam_data = bpy.data.cameras.new('sheet_cam')
    cam_data.lens = 50
    cam = bpy.data.objects.new('sheet_cam', cam_data)
    scene.collection.objects.link(cam)
    scene.camera = cam
    target = V((5, -6, 10.5))
    cam.location = target + V((16, -92, 44))
    cam.rotation_euler = (target - cam.location).to_track_quat('-Z', 'Y').to_euler()
    path = os.path.join(ek.SOURCE, KIT, 'preview', '_kit_sheet.png')
    scene.render.filepath = path
    bpy.ops.render.render(write_still=True)
    print('ENVKIT sheet ->', os.path.relpath(path, ek.REPO))


def main():
    args = ek.only_args()
    if '--sheet' in args:
        build_sheet()
        return
    if '--json' in args:
        sizes = {}
        for name, fn in BUILDERS.items():
            ek.reset()
            lo, hi = bounds(fn())
            sizes[name] = [round(hi.x - lo.x, 2), round(hi.z - lo.z, 2), round(hi.y - lo.y, 2)]
        write_props_json(sizes)
        return
    sizes = {}
    report = []
    for name, fn in BUILDERS.items():
        if args and name not in args:
            continue
        ek.reset()
        obj = fn()
        lo, hi = bounds(obj)
        sizes[name] = [round(hi.x - lo.x, 2), round(hi.z - lo.z, 2), round(hi.y - lo.y, 2)]
        _, tris = ek.export_prop(obj, KIT, name, CAPS[name])
        ek.render_preview(obj, KIT, name, views=('three_quarter', 'front'))
        report.append((name, tris, sizes[name]))
    write_props_json(sizes)
    for name, tris, size in report:
        print(f'TOWN {name}: {tris} tris, size {size}')


main()
