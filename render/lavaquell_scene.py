"""
Lavaquell bottle-emergence render (Blender 5.x, Cycles).

  blender -b -P render/lavaquell_scene.py -- --mode stills [--samples 128]
  blender -b -P render/lavaquell_scene.py -- --mode anim --start 1 --end 150 [--samples 96]
  blender -b -P render/lavaquell_scene.py -- --mode save        (writes render/lavaquell.blend)

Geometry follows the real 1000 mL returnable bottle: the silhouette is traced
from the official product photo (tall straight body, long conical shoulder,
short neck ring) and the glass is a closed solid with real wall thickness and
a thick base. A separate water volume fills it to the shoulder; the print is a
thin shell textured with artwork built from the real Lavaquell logo files.
Units: metres (bottle ~0.32 m tall).
"""
import bpy, bmesh, math, os, sys
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
def arg(name, default):
    return type(default)(argv[argv.index(name) + 1]) if name in argv else default
MODE = arg('--mode', 'stills')
SAMPLES = arg('--samples', 128)
START, END = arg('--start', 1), arg('--end', 150)
RES_X, RES_Y = arg('--rx', 1280), arg('--ry', 800)
OUT = arg('--out', os.path.join(HERE, 'frames'))

S = 0.08                    # profile units -> metres (bottle 4 units = 0.32 m)
WALL, BASE_TOP, FILL = 0.032, 0.17, 2.62
FPS = 24
F_TOTAL = 150
F_RISE0, F_RISE1 = 14, 70
F_TURN0, F_TURN1 = 58, 136

PROFILE = [
    (0.0, 0.06), (0.2, 0.04), (0.38, 0.008), (0.455, 0.012), (0.478, 0.04),
    (0.486, 0.1), (0.486, 0.5), (0.484, 0.9), (0.479, 1.3), (0.468, 1.62),
    (0.449, 1.95), (0.418, 2.26), (0.378, 2.56), (0.33, 2.86), (0.281, 3.11),
    (0.236, 3.33), (0.199, 3.5), (0.18, 3.6), (0.175, 3.66), (0.186, 3.675),
    (0.19, 3.7), (0.19, 3.735), (0.178, 3.755),
]

# ------------------------------------------------------------------ helpers
def catmull(points, per=10):
    P = [np.array(p, float) for p in points]
    P = [P[0] * 2 - P[1]] + P + [P[-1] * 2 - P[-2]]
    out = []
    for i in range(1, len(P) - 2):
        p0, p1, p2, p3 = P[i - 1], P[i], P[i + 1], P[i + 2]
        for s in range(per):
            t = s / per
            out.append(0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t + (-p0 + 3 * p1 - 3 * p2 + p3) * t ** 3))
    out.append(np.array(points[-1], float))
    pts = np.array(out)
    pts[:, 0] = np.maximum(pts[:, 0], 0)
    return pts

OUTER = catmull(PROFILE)

def radius_at(y):
    pts = OUTER
    for i in range(1, len(pts)):
        a, b = pts[i - 1], pts[i]
        if a[1] > 0.1 and a[1] <= y <= b[1] and b[1] > a[1]:
            return a[0] + (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1])
    return pts[-1][0]

def lathe(name, prof, segs=192, uv=None, smooth=True):
    """prof: list of (r, z) in metres. uv=(z0, z1) adds a cylindrical UV seam column."""
    bm = bmesh.new()
    ring_n = segs + 1 if uv else segs
    rings = []
    vert_u = {}
    for r, z in prof:
        if r < 1e-7:
            rings.append([bm.verts.new((0, 0, z))])
            continue
        ring = []
        for i in range(ring_n):
            th = 2 * math.pi * i / segs
            v = bm.verts.new((-r * math.sin(th), r * math.cos(th), z))
            vert_u[v] = i / segs
            ring.append(v)
        rings.append(ring)
    bm.verts.ensure_lookup_table()
    uvl = bm.loops.layers.uv.new('UVMap') if uv else None
    for a, b, pa, pb in zip(rings[:-1], rings[1:], prof[:-1], prof[1:]):
        if len(a) == 1 and len(b) == 1:
            continue
        n = max(len(a), len(b))
        rng = range(n - 1) if uv else range(n)
        for i in rng:
            j = (i + 1) % n if not uv else i + 1
            if len(a) == 1:
                vs = [a[0], b[j], b[i]]
            elif len(b) == 1:
                vs = [a[i], a[j], b[0]]
            else:
                vs = [a[i], a[j], b[j], b[i]]
            try:
                f = bm.faces.new(vs)
            except ValueError:
                continue
            if uvl:
                for loop in f.loops:
                    loop[uvl].uv = (vert_u.get(loop.vert, 0.0), (loop.vert.co.z - uv[0]) / (uv[1] - uv[0]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    if smooth:
        for p in me.polygons:
            p.use_smooth = True
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    return ob

def node_mat(name):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    for n in list(nt.nodes):
        nt.nodes.remove(n)
    out = nt.nodes.new('ShaderNodeOutputMaterial')
    return m, nt, out

def principled(nt, **kw):
    b = nt.nodes.new('ShaderNodeBsdfPrincipled')
    names = {
        'color': 'Base Color', 'metallic': 'Metallic', 'roughness': 'Roughness', 'ior': 'IOR',
        'transmission': 'Transmission Weight', 'coat': 'Coat Weight', 'coat_roughness': 'Coat Roughness',
        'specular': 'Specular IOR Level', 'aniso': 'Anisotropic',
    }
    for k, v in kw.items():
        b.inputs[names[k]].default_value = v
    return b

# ------------------------------------------------------------------ scene
def build():
    sc = bpy.context.scene
    for ob in list(bpy.data.objects):
        bpy.data.objects.remove(ob, do_unlink=True)

    # --- glass: closed solid with wall thickness and a thick base
    base_outer = [(r, y) for r, y in OUTER]
    lip_in = (0.178 - 0.034, 3.755)
    inner = []
    for i in range(90):
        y = 3.74 - (3.74 - (BASE_TOP + 0.02)) * i / 89
        inner.append((radius_at(y) - WALL, y))
    inner.append((radius_at(BASE_TOP + 0.02) - WALL - 0.03, BASE_TOP))
    inner.append((0.0, BASE_TOP))
    glass_prof = [(r * S, y * S) for r, y in base_outer + [lip_in] + inner]
    glass = lathe('Glass', glass_prof, 192)

    # --- water: inside the glass up to the shoulder, with a small meniscus
    wp = [(0.0, BASE_TOP + 0.003)]
    wp.append((radius_at(BASE_TOP + 0.03) - WALL - 0.035, BASE_TOP + 0.003))
    for i in range(70):
        y = (BASE_TOP + 0.03) + (FILL + 0.018 - (BASE_TOP + 0.03)) * i / 69
        wp.append((radius_at(y) - WALL - 0.0025, y))
    rf = radius_at(FILL) - WALL - 0.0025
    wp += [(rf - 0.012, FILL + 0.004), (rf - 0.035, FILL), (0.0, FILL)]
    water = lathe('Water', [(r * S, y * S) for r, y in wp], 192)

    # --- cap
    cap_prof = [(0, 3.735), (0.186, 3.735), (0.199, 3.75), (0.2, 3.79), (0.2, 3.86), (0.2, 3.93), (0.2, 3.97),
                (0.193, 3.992), (0.17, 4.0), (0, 4.0)]
    cap = lathe('Cap', [(r * S, y * S) for r, y in cap_prof], 256)

    # --- print shell
    lp = []
    for i in range(60):
        y = 0.18 + (1.45 - 0.18) * i / 59
        lp.append((radius_at(y) * 1.0012 * S, y * S))
    label = lathe('Print', lp, 256, uv=(0.18 * S, 1.45 * S))

    root = bpy.data.objects.new('Bottle', None)
    sc.collection.objects.link(root)
    for ob in (glass, water, cap, label):
        ob.parent = root

    # --- materials
    m, nt, out = node_mat('Glass')
    b = principled(nt, color=(1, 1, 1, 1), roughness=0.0, ior=1.5, transmission=1.0)
    vol = nt.nodes.new('ShaderNodeVolumeAbsorption')
    vol.inputs['Color'].default_value = (0.86, 0.97, 0.95, 1)
    vol.inputs['Density'].default_value = 4.0
    nt.links.new(b.outputs[0], out.inputs['Surface'])
    nt.links.new(vol.outputs[0], out.inputs['Volume'])
    glass.data.materials.append(m)

    m, nt, out = node_mat('Water')
    b = principled(nt, color=(1, 1, 1, 1), roughness=0.0, ior=1.333, transmission=1.0)
    vol = nt.nodes.new('ShaderNodeVolumeAbsorption')
    vol.inputs['Color'].default_value = (0.80, 0.95, 0.99, 1)
    vol.inputs['Density'].default_value = 1.6
    nt.links.new(b.outputs[0], out.inputs['Surface'])
    nt.links.new(vol.outputs[0], out.inputs['Volume'])
    water.data.materials.append(m)

    # brushed aluminium screw cap with a knurled grip band
    m, nt, out = node_mat('Cap')
    b = principled(nt, color=(0.62, 0.64, 0.66, 1), metallic=1.0, roughness=0.3, aniso=0.35)
    tc = nt.nodes.new('ShaderNodeTexCoord')
    sep = nt.nodes.new('ShaderNodeSeparateXYZ'); nt.links.new(tc.outputs['Object'], sep.inputs[0])
    at = nt.nodes.new('ShaderNodeMath'); at.operation = 'ARCTAN2'
    nt.links.new(sep.outputs['Y'], at.inputs[0]); nt.links.new(sep.outputs['X'], at.inputs[1])
    mul = nt.nodes.new('ShaderNodeMath'); mul.operation = 'MULTIPLY'; mul.inputs[1].default_value = 140
    nt.links.new(at.outputs[0], mul.inputs[0])
    sn = nt.nodes.new('ShaderNodeMath'); sn.operation = 'SINE'; nt.links.new(mul.outputs[0], sn.inputs[0])
    band = nt.nodes.new('ShaderNodeMapRange')
    band.inputs['From Min'].default_value = 3.82 * S; band.inputs['From Max'].default_value = 3.84 * S
    nt.links.new(sep.outputs['Z'], band.inputs['Value'])
    band2 = nt.nodes.new('ShaderNodeMapRange')
    band2.inputs['From Min'].default_value = 3.96 * S; band2.inputs['From Max'].default_value = 3.94 * S
    nt.links.new(sep.outputs['Z'], band2.inputs['Value'])
    mk = nt.nodes.new('ShaderNodeMath'); mk.operation = 'MULTIPLY'
    nt.links.new(band.outputs[0], mk.inputs[0]); nt.links.new(band2.outputs[0], mk.inputs[1])
    h = nt.nodes.new('ShaderNodeMath'); h.operation = 'MULTIPLY'
    nt.links.new(sn.outputs[0], h.inputs[0]); nt.links.new(mk.outputs[0], h.inputs[1])
    bump = nt.nodes.new('ShaderNodeBump'); bump.inputs['Strength'].default_value = 0.6; bump.inputs['Distance'].default_value = 0.0004
    nt.links.new(h.outputs[0], bump.inputs['Height']); nt.links.new(bump.outputs[0], b.inputs['Normal'])
    nt.links.new(b.outputs[0], out.inputs['Surface'])
    cap.data.materials.append(m)

    # print: ink where the artwork has alpha, clear elsewhere
    m, nt, out = node_mat('Print')
    tex = nt.nodes.new('ShaderNodeTexImage')
    tex.image = bpy.data.images.load(os.path.join(HERE, 'label_still.png'))
    tex.interpolation = 'Cubic'
    ink = principled(nt, roughness=0.55, specular=0.15)
    dim = nt.nodes.new('ShaderNodeMix'); dim.data_type = 'RGBA'; dim.blend_type = 'MULTIPLY'
    dim.inputs['Factor'].default_value = 1.0
    dim.inputs[7].default_value = (0.55, 0.55, 0.6, 1)
    nt.links.new(tex.outputs['Color'], dim.inputs[6])
    nt.links.new(dim.outputs[2], ink.inputs['Base Color'])
    tr = nt.nodes.new('ShaderNodeBsdfTransparent')
    mix = nt.nodes.new('ShaderNodeMixShader')
    nt.links.new(tex.outputs['Alpha'], mix.inputs[0])
    nt.links.new(tr.outputs[0], mix.inputs[1]); nt.links.new(ink.outputs[0], mix.inputs[2])
    nt.links.new(mix.outputs[0], out.inputs['Surface'])
    label.data.materials.append(m)

    build_pool()
    build_world()
    build_lights()

    cam_data = bpy.data.cameras.new('Cam')
    cam_data.lens = 68
    cam = bpy.data.objects.new('Cam', cam_data)
    sc.collection.objects.link(cam)
    sc.camera = cam
    tgt = bpy.data.objects.new('CamTarget', None)
    sc.collection.objects.link(tgt)
    con = cam.constraints.new('TRACK_TO'); con.target = tgt
    con.track_axis = 'TRACK_NEGATIVE_Z'; con.up_axis = 'UP_Y'

    r = sc.render
    r.engine = 'CYCLES'
    r.resolution_x, r.resolution_y, r.resolution_percentage = RES_X, RES_Y, 100
    r.fps = FPS
    cy = sc.cycles
    cy.device = 'GPU'
    cy.samples = SAMPLES
    cy.use_adaptive_sampling = True
    cy.adaptive_threshold = 0.012
    cy.use_denoising = True
    cy.denoiser = 'OPTIX'
    cy.max_bounces = 24
    cy.transmission_bounces = 24
    cy.transparent_max_bounces = 16
    cy.glossy_bounces = 6
    cy.diffuse_bounces = 2
    cy.volume_bounces = 1
    cy.caustics_reflective = False
    cy.caustics_refractive = False
    cy.blur_glossy = 0.4
    cy.sample_clamp_indirect = 6.0
    vs = sc.view_settings
    # Standard keeps the site's aqua palette faithful (AgX greyed it out)
    vs.view_transform = 'Standard'
    vs.look = 'None'
    vs.exposure = -0.1
    prefs = bpy.context.preferences.addons['cycles'].preferences
    prefs.compute_device_type = 'OPTIX'
    prefs.refresh_devices()
    for d in prefs.devices:
        d.use = d.type == 'OPTIX'
    r.image_settings.file_format = 'PNG'
    r.image_settings.color_mode = 'RGB'
    r.image_settings.color_depth = '8'

# radial water-surface mesh: fine rings near the bottle, coarser outwards
POOL_R = None
def build_pool():
    global POOL_R
    radii = [0.001]
    while radii[-1] < 3.2:
        radii.append(radii[-1] + 0.0016 + radii[-1] * 0.012)
    POOL_R = np.array(radii)
    segs = 384
    bm = bmesh.new()
    rings = [[bm.verts.new((r * math.cos(2 * math.pi * i / segs), r * math.sin(2 * math.pi * i / segs), 0)) for i in range(segs)] for r in radii]
    for a, b in zip(rings[:-1], rings[1:]):
        for i in range(segs):
            j = (i + 1) % segs
            bm.faces.new((a[i], a[j], b[j], b[i]))
    me = bpy.data.meshes.new('Pool'); bm.to_mesh(me); bm.free()
    for p in me.polygons: p.use_smooth = True
    pool = bpy.data.objects.new('Pool', me); bpy.context.scene.collection.objects.link(pool)
    # far water out to the horizon (annulus, so nothing cuts through the bottle)
    far = [3.1, 4, 6, 10, 20, 50, 120, 300]
    bm = bmesh.new()
    rings = [[bm.verts.new((r * math.cos(2 * math.pi * i / 128), r * math.sin(2 * math.pi * i / 128), -0.00005)) for i in range(128)] for r in far]
    for a, b in zip(rings[:-1], rings[1:]):
        for i in range(128):
            j = (i + 1) % 128
            bm.faces.new((a[i], a[j], b[j], b[i]))
    me2 = bpy.data.meshes.new('PoolFar'); bm.to_mesh(me2); bm.free()
    farob = bpy.data.objects.new('PoolFar', me2); bpy.context.scene.collection.objects.link(farob)

    m, nt, out = node_mat('Pool')
    b = principled(nt, color=(0.86, 0.97, 0.99, 1), roughness=0.012, ior=1.333, transmission=1.0)
    # gentle live micro-ripples
    tc = nt.nodes.new('ShaderNodeTexCoord')
    noise = nt.nodes.new('ShaderNodeTexNoise'); noise.noise_dimensions = '4D'
    noise.inputs['Scale'].default_value = 9.0; noise.inputs['Detail'].default_value = 3.0
    noise.inputs['W'].default_value = 0.0
    nt.links.new(tc.outputs['Object'], noise.inputs['Vector'])
    bump = nt.nodes.new('ShaderNodeBump'); bump.inputs['Strength'].default_value = 0.12; bump.inputs['Distance'].default_value = 0.002
    nt.links.new(noise.outputs['Fac'], bump.inputs['Height']); nt.links.new(bump.outputs[0], b.inputs['Normal'])
    # shadow rays pass straight through the water (no black pool shadows)
    lp = nt.nodes.new('ShaderNodeLightPath')
    tr = nt.nodes.new('ShaderNodeBsdfTransparent')
    mix = nt.nodes.new('ShaderNodeMixShader')
    nt.links.new(lp.outputs['Is Shadow Ray'], mix.inputs[0])
    nt.links.new(b.outputs[0], mix.inputs[1]); nt.links.new(tr.outputs[0], mix.inputs[2])
    nt.links.new(mix.outputs[0], out.inputs['Surface'])
    pool.data.materials.append(m)
    farob.data.materials.append(m)
    m['noise'] = noise.name

def build_world():
    w = bpy.data.worlds.new('Studio'); bpy.context.scene.world = w
    w.use_nodes = True
    nt = w.node_tree
    for n in list(nt.nodes): nt.nodes.remove(n)
    out = nt.nodes.new('ShaderNodeOutputWorld')
    bg = nt.nodes.new('ShaderNodeBackground'); bg.inputs['Strength'].default_value = 1.0
    tc = nt.nodes.new('ShaderNodeTexCoord')
    sep = nt.nodes.new('ShaderNodeSeparateXYZ'); nt.links.new(tc.outputs['Generated'], sep.inputs[0])
    mr = nt.nodes.new('ShaderNodeMapRange')
    mr.inputs['From Min'].default_value = -0.35; mr.inputs['From Max'].default_value = 0.7
    nt.links.new(sep.outputs['Z'], mr.inputs['Value'])
    ramp = nt.nodes.new('ShaderNodeValToRGB')
    cr = ramp.color_ramp
    # site palette: deep aqua below, #c6e6f0 at the horizon, pearl #eef7fa above
    cr.elements[0].position = 0.0; cr.elements[0].color = (0.12, 0.45, 0.58, 1)
    cr.elements[1].position = 1.0; cr.elements[1].color = (0.85, 0.93, 0.96, 1)
    e = cr.elements.new(0.34); e.color = (0.56, 0.79, 0.87, 1)
    nt.links.new(mr.outputs[0], ramp.inputs['Fac'])
    nt.links.new(ramp.outputs['Color'], bg.inputs['Color'])
    nt.links.new(bg.outputs[0], out.inputs['Surface'])

def build_lights():
    sc = bpy.context.scene
    def area(name, loc, size, energy, color=(1, 1, 1), target=(0, 0, 0.16)):
        d = bpy.data.lights.new(name, 'AREA'); d.shape = 'RECTANGLE'
        d.size, d.size_y = size; d.energy = energy; d.color = color
        ob = bpy.data.objects.new(name, d); sc.collection.objects.link(ob)
        ob.location = loc
        t = bpy.data.objects.new(name + '_t', None); sc.collection.objects.link(t); t.location = target
        c = ob.constraints.new('TRACK_TO'); c.target = t; c.track_axis = 'TRACK_NEGATIVE_Z'; c.up_axis = 'UP_Y'
        ob.visible_camera = False
        return ob
    def backlight(*a, **k):
        # glows through the glass (transmission) but never mirrors in the pool or glass
        ob = area(*a, **k)
        ob.visible_glossy = False
        return ob
    # tall strip softboxes (long vertical highlights), soft top, back rim
    # all placed outside the camera's view of the pool, so they never mirror in it
    area('KeyStrip', (-0.8, -0.6, 0.24), (0.18, 1.1), 70)
    area('FillStrip', (0.85, -0.45, 0.24), (0.1, 1.1), 40, (0.93, 0.97, 1.0))
    backlight('Rim', (-0.25, 0.9, 0.3), (0.35, 0.9), 45, (0.92, 0.98, 1.0))
    backlight('Rim2', (0.3, 0.9, 0.3), (0.2, 0.9), 30, (0.92, 0.98, 1.0))
    # black flags just outside the frame: dark edges that define the glass
    m = bpy.data.materials.new('Flag'); m.use_nodes = True
    m.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (0.01, 0.015, 0.02, 1)
    m.node_tree.nodes['Principled BSDF'].inputs['Roughness'].default_value = 1.0
    for name, loc, rot in (('FlagL', (-0.5, -0.32, 0.2), (math.radians(90), 0, math.radians(60))),
                           ('FlagR', (0.52, -0.25, 0.2), (math.radians(90), 0, math.radians(-62)))):
        bpy.ops.mesh.primitive_plane_add(size=1, location=loc, rotation=rot)
        f = bpy.context.active_object; f.name = name
        f.scale = (0.22, 0.75, 1)
        f.data.materials.append(m)
        f.visible_camera = False; f.visible_shadow = False

# ------------------------------------------------------------------ animation
def ease(t):
    t = min(1.0, max(0.0, t))
    return 4 * t ** 3 if t < 0.5 else 1 - (-2 * t + 2) ** 3 / 2
def smoother(t):
    t = min(1.0, max(0.0, t))
    return t * t * t * (t * (t * 6 - 15) + 10)

BOTTLE_H = 4.0 * S
Z0, Z1 = -BOTTLE_H - 0.025, -0.016

def bottle_z(f):
    return Z0 + (Z1 - Z0) * ease((f - F_RISE0) / (F_RISE1 - F_RISE0))
def bottle_rot(f):
    t = ease((f - F_TURN0) / (F_TURN1 - F_TURN0))
    return -(2 * math.pi + 0.6) * (1 - t)

C_W, LAMBDA = 0.2, 0.032
K = 2 * math.pi / LAMBDA
OMEGA = C_W * K
R0 = 0.486 * S

def emission(f):
    """ripple amplitude emitted at frame f (m): proportional to rise speed while crossing the surface"""
    z = bottle_z(f)
    if not (z < 0 < z + BOTTLE_H):
        return 0.0
    v = abs(bottle_z(f + 0.5) - bottle_z(f - 0.5)) * FPS
    return 0.0065 * v

def cross_radius(f):
    z = bottle_z(f)
    h = (0 - z) / S
    if not (z < 0 < z + BOTTLE_H) or h > 4.0:
        return 0.0
    if h > 3.735:
        return 0.2 * S
    return radius_at(max(0.1, h)) * S

POOL_BASE = None
def update_pool(f):
    global POOL_BASE
    me = bpy.data.objects['Pool'].data
    n = len(me.vertices)
    if POOL_BASE is None:
        POOL_BASE = np.empty(n * 3); me.vertices.foreach_get('co', POOL_BASE); POOL_BASE = POOL_BASE.reshape(-1, 3)
    co = POOL_BASE.copy()
    r = np.hypot(co[:, 0], co[:, 1])
    t = f / FPS
    d = np.maximum(r - R0, 0)
    # wave train emitted while the bottle passes through the surface (retarded time)
    tau = t - d / C_W
    fr = tau * FPS
    amp = np.interp(fr, np.arange(0, F_TOTAL + 2), [emission(i) for i in range(0, F_TOTAL + 2)], left=0, right=0)
    h = amp * np.sin(K * d - OMEGA * t) * np.exp(-d / 0.9) / np.sqrt(1 + d / 0.05)
    # a single soft ring when the cap first breaks the surface
    fb = next((i for i in range(F_TOTAL) if bottle_z(i) + BOTTLE_H > 0), None)
    if fb is not None and f >= fb:
        x = d - C_W * 1.15 * (t - fb / FPS)
        h += 0.0016 * np.exp(-(x / 0.03) ** 2) * np.cos(K * 0.7 * x) * np.exp(-(t - fb / FPS) / 2.5)
    rc = cross_radius(f)
    if rc > 0:
        h += 0.0011 * np.exp(-np.maximum(r - rc, 0) / 0.0028)  # meniscus against the glass
        scale = np.where(r < rc, rc / np.maximum(r, 1e-6), 1.0)
        co[:, 0] *= scale; co[:, 1] *= scale
    co[:, 2] = h
    me.vertices.foreach_set('co', co.ravel())
    me.update()

def set_frame(f):
    sc = bpy.context.scene
    sc.frame_set(int(f))
    b = bpy.data.objects['Bottle']
    b.location = (0, 0, bottle_z(f))
    b.rotation_euler = (0, 0, bottle_rot(f))
    c = smoother((f - 1) / (F_TOTAL - 1))
    cam, tgt = bpy.data.objects['Cam'], bpy.data.objects['CamTarget']
    p0, p1 = np.array((0.05, -1.3, 0.09)), np.array((0.0, -1.32, 0.13))
    t0, t1 = np.array((0.0, 0.0, 0.05)), np.array((0.0, 0.0, 0.158))
    cam.location = tuple(p0 + (p1 - p0) * c)
    tgt.location = tuple(t0 + (t1 - t0) * c)
    pm = bpy.data.materials['Pool']
    pm.node_tree.nodes[pm['noise']].inputs['W'].default_value = f / FPS * 0.35
    update_pool(f)

# ------------------------------------------------------------------ main
build()
if MODE == 'save':
    set_frame(F_TOTAL)
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(HERE, 'lavaquell.blend'))
elif MODE == 'cutouts':
    # transparent-background bottle states for the cycle section (same model, lighting and scale)
    sc = bpy.context.scene
    for name in ('Pool', 'PoolFar'):
        bpy.data.objects[name].hide_render = True
    sc.render.film_transparent = True
    sc.cycles.film_transparent_glass = True
    sc.render.image_settings.color_mode = 'RGBA'
    sc.render.resolution_x, sc.render.resolution_y = 900, 1500
    root = bpy.data.objects['Bottle']
    root.location = (0, 0, 0)
    root.rotation_euler = (0, 0, 0)
    cam, tgt = bpy.data.objects['Cam'], bpy.data.objects['CamTarget']
    cam.data.sensor_fit = 'VERTICAL'
    cam.data.sensor_height = 24
    cam.location = (0.0, -1.3, 0.17)
    tgt.location = (0.0, 0.0, 0.165)
    cam.data.lens = 24 * 1.3 / 0.355
    out_dir = os.path.join(ROOT, 'public', 'assets', 'cycle')
    os.makedirs(out_dir, exist_ok=True)
    states = {
        'bottle-full-capped': (True, True),
        'bottle-empty-capped': (False, True),
        'bottle-empty-open': (False, False),
        'bottle-full-open': (True, False),
    }
    for name, (water, cap) in states.items():
        bpy.data.objects['Water'].hide_render = not water
        bpy.data.objects['Cap'].hide_render = not cap
        sc.render.filepath = os.path.join(HERE, 'cutouts', name + '.png')
        bpy.ops.render.render(write_still=True)
        print('CUTOUT', name, flush=True)
elif MODE == 'glb':
    # export just the bottle (glass, water, cap, print) for the live web scene
    bpy.ops.object.select_all(action='DESELECT')
    root = bpy.data.objects['Bottle']
    root.location = (0, 0, 0); root.rotation_euler = (0, 0, 0)
    root.select_set(True)
    for ob in root.children:
        ob.select_set(True)
    bpy.context.view_layer.objects.active = root
    out = os.path.join(ROOT, 'public', 'models', 'lavaquell-bottle-real.glb')
    bpy.ops.export_scene.gltf(filepath=out, export_format='GLB', use_selection=True, export_apply=True,
                              export_yup=True, export_texcoords=True, export_normals=True, export_materials='EXPORT')
    print('GLB', out, os.path.getsize(out))
elif MODE == 'stills':
    os.makedirs(os.path.join(HERE, 'stills'), exist_ok=True)
    for name, rot in (('front', 0.0), ('three-quarter', -0.75), ('rear', math.pi)):
        set_frame(F_TOTAL)
        bpy.data.objects['Bottle'].rotation_euler = (0, 0, rot)
        bpy.context.scene.render.filepath = os.path.join(HERE, 'stills', name + '.png')
        bpy.ops.render.render(write_still=True)
        print('STILL', name, flush=True)
elif MODE == 'frame':
    f = arg('--f', 40)
    set_frame(f)
    bpy.context.scene.render.filepath = os.path.join(HERE, 'stills', f'frame_{f:03d}.png')
    bpy.ops.render.render(write_still=True)
elif MODE == 'anim':
    os.makedirs(OUT, exist_ok=True)
    for f in range(START, END + 1):
        path = os.path.join(OUT, f'{f:04d}.png')
        if os.path.exists(path):
            continue
        set_frame(f)
        bpy.context.scene.render.filepath = path
        bpy.ops.render.render(write_still=True)
        print('FRAME', f, flush=True)
