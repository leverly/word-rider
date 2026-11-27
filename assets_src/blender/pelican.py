"""
鹈鹕骑手 v5 —— 沿脊椎放样的连续身体。

为什么换做法
前几版用 metaball / 一堆管件拼，问题都在「接缝」和「原点错位」：
loft 建在世界原点，origin_set 只移原点不动网格，部件就飞到坐标原点去了。

这一版的核心是一个**沿脊椎的连续放样**：尾 → 臀 → 腹 → 胸 → 颈 → 头 → 喙
用同一张曲面生成，天然没有接缝、没有断裂，剪影就是一只鸟。
四肢用同样手法单独放样后并入。

坐标：Z 上，-Y 前进，原点 = 两轮接地点中点。坐姿，臀在座垫 z≈0.86。
"""
import bpy
import bmesh
import math
import sys
import os
from mathutils import Vector, Euler, Matrix

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from lib_mesh import *   # noqa

C_BODY = (0.700, 0.712, 0.738, 1.0)
C_BODY_SHADE = (0.575, 0.596, 0.632, 1.0)
C_WING = (0.540, 0.566, 0.606, 1.0)
C_PRIMARY = (0.095, 0.110, 0.146, 1.0)
C_BEAK = (0.820, 0.470, 0.098, 1.0)
C_BEAK_DARK = (0.690, 0.300, 0.048, 1.0)
C_POUCH = (0.840, 0.650, 0.348, 1.0)
C_POUCH_DEEP = (0.742, 0.400, 0.166, 1.0)
C_LEG = (0.800, 0.485, 0.145, 1.0)
C_LEG_DARK = (0.630, 0.320, 0.086, 1.0)
C_IRIS = (0.948, 0.765, 0.230, 1.0)
C_PUPIL = (0.028, 0.032, 0.048, 1.0)
C_SKIN = (0.740, 0.450, 0.290, 1.0)
C_CAP = (0.070, 0.520, 0.495, 1.0)
C_ACCENT = (0.840, 0.560, 0.198, 1.0)
C_GEAR = (0.118, 0.140, 0.196, 1.0)

SIDES = ((-1, 'L'), (1, 'R'))
SEAT_Z = 0.865
BAR = Vector((0, -0.300, 0.958))


# ══════════════════════════════════════════════════════════════
#  脊椎放样：所有截面都以世界 X 轴为「右」，保证对称且不扭转
# ══════════════════════════════════════════════════════════════

def loft_spine(name, stations, sides=24, cap_start=True, cap_end=True):
    """
    stations: [(Vector 中心, rx 半宽, rz 半厚), ...]
    截面法线沿脊椎切线，局部 X 恒为世界 X（身体对称面），
    因此左右完全对称，且不会出现扭转导致的褶皱。
    """
    pts = [Vector(s[0]) for s in stations]
    n = len(pts)
    rings = []
    for i in range(n):
        if i == 0:
            t = pts[1] - pts[0]
        elif i == n - 1:
            t = pts[-1] - pts[-2]
        else:
            t = pts[i + 1] - pts[i - 1]
        t.normalize()

        x = Vector((1, 0, 0)) - t * t.x       # 世界 X 正交化
        if x.length < 1e-5:
            x = Vector((1, 0, 0))
        x.normalize()
        z = x.cross(t).normalized()

        rx, rz = stations[i][1], stations[i][2]
        ring = []
        for k in range(sides):
            a = 2 * math.pi * k / sides
            ca, sa = math.cos(a), math.sin(a)
            ring.append(pts[i] + x * (ca * rx) + z * (sa * rz))
        rings.append(ring)
    return loft(name, rings, close_caps=False), rings, pts


def cap_spine(ob, rings, reverse_first=False, reverse_last=False):
    """给放样体两端加封盖（用扇形三角化，避免 NGON 阴影错）"""
    me = ob.data
    bm = bmesh.new()
    bm.from_mesh(me)
    bm.verts.ensure_lookup_table()
    n = len(rings[0])

    for idx, rev in ((0, reverse_first), (len(rings) - 1, reverse_last)):
        loop = [bm.verts[idx * n + k] for k in range(n)]
        if rev:
            loop = list(reversed(loop))
        try:
            bmesh.ops.contextual_create(bm, geom=loop)
        except Exception:
            pass
    bm.to_mesh(me)
    bm.free()
    me.update()
    return ob


def ribbon(name, lead, trail, across=7, thickness=0.007, taper=None):
    """在两条空间曲线之间铺一张带厚度的薄片（翅膀 / 蹼）。"""
    verts = []
    faces = []
    rows = len(lead)
    for i in range(rows):
        l = Vector(lead[i])
        t = Vector(trail[i])
        for j in range(across + 1):
            u = j / across
            p = l.lerp(t, u)
            # 中间略鼓，边缘略薄（羽面感）
            bulge = math.sin(u * math.pi) * thickness * 0.9
            verts.append(p + Vector((0, 0, bulge)))
    for i in range(rows - 1):
        for j in range(across):
            a = i * (across + 1) + j
            b = a + across + 1
            faces.append((a, a + 1, b + 1, b))
    ob = new_mesh_object(name, verts, faces)
    add_solidify(ob, thickness, 0.0)
    apply_modifiers(ob)
    shade_smooth(ob, 44)
    return ob


def orient(ob, root, direction, up=(0, 0, 1)):
    y = Vector(direction).normalized()
    u = Vector(up).normalized()
    if abs(y.dot(u)) > 0.99:
        u = Vector((0, 1, 0))
        if abs(y.dot(u)) > 0.99:
            u = Vector((1, 0, 0))
    x = y.cross(u).normalized()
    z = x.cross(y).normalized()
    ob.matrix_world = Matrix.Translation(Vector(root)) @ Matrix((
        (x.x, y.x, z.x, 0.0),
        (x.y, y.y, z.y, 0.0),
        (x.z, y.z, z.z, 0.0),
        (0.0, 0.0, 0.0, 1.0),
    ))
    bpy.context.view_layer.objects.active = ob
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    return ob


def make_feather(name, length, width, thickness=0.0034, curve=0.14,
                 camber=0.10, segs=12, sides=14):
    rings = []
    for i in range(segs + 1):
        t = i / segs
        y = length * t
        z0 = -curve * length * (t ** 1.85)
        e = math.sin(math.pi * min(1.0, t ** 0.66)) ** 0.72
        w = max(width * max(0.20, e), width * 0.12)
        th = thickness * (0.55 + 0.45 * math.sin(math.pi * t ** 0.75))
        ring = []
        for k in range(sides):
            a = 2 * math.pi * k / sides
            cu, cv = math.cos(a), math.sin(a)
            ring.append(Vector((
                cu * w * 0.5, y,
                z0 + cv * th + camber * (cu * cu) * width * 0.32,
            )))
        rings.append(ring)
    ob = loft(name, rings, close_caps=True)
    shade_smooth(ob, 50)
    return ob


def build():
    reset_scene()

    M = {}
    M['body'] = pbr('PelicanBody', C_BODY, roughness=0.66, sheen=0.06,
                    subsurface=0.07, subsurface_color=(0.85, 0.66, 0.60))
    M['bodyS'] = pbr('PelicanBodyShade', C_BODY_SHADE, roughness=0.70, sheen=0.05)
    M['wing'] = pbr('PelicanWing', C_WING, roughness=0.68, sheen=0.05)
    M['primary'] = pbr('PelicanPrimary', C_PRIMARY, roughness=0.40, sheen=0.10)
    M['beak'] = pbr('PelicanBeak', C_BEAK, roughness=0.58, clearcoat=0.0)
    M['beakDark'] = pbr('PelicanBeakDark', C_BEAK_DARK, roughness=0.62, clearcoat=0.0)
    M['pouch'] = pbr('PelicanPouch', C_POUCH, roughness=0.60, subsurface=0.10,
                     subsurface_color=(1.0, 0.46, 0.24), sheen=0.04)
    M['pouchDeep'] = pbr('PelicanPouchDeep', C_POUCH_DEEP, roughness=0.39)
    M['leg'] = pbr('PelicanLeg', C_LEG, roughness=0.52, clearcoat=0.16)
    M['legDark'] = pbr('PelicanLegDark', C_LEG_DARK, roughness=0.45)
    M['iris'] = pbr('PelicanIris', C_IRIS, roughness=0.09, clearcoat=0.92)
    M['pupil'] = pbr('PelicanPupil', C_PUPIL, roughness=0.04)
    M['sclera'] = pbr('PelicanSclera', (0.986, 0.976, 0.960, 1), roughness=0.07)
    M['glint'] = pbr('PelicanGlint', (1, 1, 1, 1), roughness=0.05,
                     emission=(1, 1, 1), emission_strength=0.35)
    M['skin'] = pbr('PelicanSkin', C_SKIN, roughness=0.46)
    M['cap'] = pbr('PelicanCap', C_CAP, roughness=0.62, sheen=0.32)
    M['accent'] = pbr('PelicanAccent', C_ACCENT, roughness=0.64, sheen=0.36)
    M['gear'] = pbr('PelicanGear', C_GEAR, roughness=0.66)

    # ══════════════════════════════════════════════════════════
    #  身体 + 颈 + 头 + 喙：一条脊椎
    # ══════════════════════════════════════════════════════════
    # (中心, 半宽 rx, 半厚 rz)
    SPINE = [
        (Vector((0,  0.300, 0.958)), 0.016, 0.014),   # 0  尾尖
        (Vector((0,  0.245, 0.966)), 0.040, 0.034),   # 1  尾根
        (Vector((0,  0.180, 0.972)), 0.072, 0.060),   # 2  臀后
        (Vector((0,  0.105, 0.975)), 0.106, 0.088),   # 3  臀
        (Vector((0,  0.020, 0.978)), 0.135, 0.114),   # 4  腹
        (Vector((0, -0.062, 0.992)), 0.148, 0.126),   # 5  下胸
        (Vector((0, -0.128, 1.028)), 0.144, 0.126),   # 6  胸
        (Vector((0, -0.168, 1.078)), 0.119, 0.110),   # 7  上胸
        (Vector((0, -0.184, 1.128)), 0.087, 0.085),   # 8  胸肩
        (Vector((0, -0.190, 1.176)), 0.071, 0.071),   # 9  颈根
        (Vector((0, -0.197, 1.224)), 0.063, 0.063),   # 10 颈中
        (Vector((0, -0.198, 1.272)), 0.059, 0.060),   # 11 颈上
        (Vector((0, -0.191, 1.318)), 0.059, 0.062),   # 12 喉
        (Vector((0, -0.180, 1.360)), 0.064, 0.067),   # 13 枕
        (Vector((0, -0.172, 1.400)), 0.067, 0.070),   # 14 颅
        (Vector((0, -0.176, 1.430)), 0.060, 0.060),   # 15 额
        (Vector((0, -0.196, 1.440)), 0.046, 0.042),   # 16 喙根
    ]
    body, rings, pts = loft_spine('pelicanBody', SPINE, sides=26)
    cap_spine(body, rings)
    shade_smooth(body, 46)
    add_subsurf(body, 1)
    apply_modifiers(body)
    # 羽面细节
    add_displace(body, noise_texture('Plume1', 7.0, 4, 0.45), 0.0075)
    add_displace(body, noise_texture('Plume2', 21.0, 4, 0.35), 0.0034)
    add_displace(body, noise_texture('Plume3', 60.0, 2, 0.25), 0.0012)
    apply_modifiers(body)
    shade_smooth(body, 46)

    # 身体整体白羽。喙是独立网格（见下），避免按面切材质出现锯齿边
    assign(body, M['body'])

    # ══════════════════════════════════════════════════════════
    #  喙：从颅前长出的扁长上颌，尖端下钩
    # ══════════════════════════════════════════════════════════
    BEAK_R = Vector((0, -0.208, 1.392))   # 喙根：脸部高度，不是头顶
    BK_LEN = 0.360
    BK_DROOP = 0.088

    bk_rings = []
    BKN = 30
    for i in range(BKN + 1):
        t = i / BKN
        y = -t * BK_LEN
        # 半宽：根部 0.038，中间略涨再收窄（扁长的桨状）
        w = 0.038 * (0.94 + 0.20 * math.sin(math.pi * min(1.0, t * 1.4))) * (1 - t * 0.52)
        # 半厚：很扁
        h = 0.0195 * (1 - t * 0.48)
        z = -BK_DROOP * (t ** 2.5)
        ring = []
        N = 18
        for k in range(N):
            a = 2 * math.pi * k / N
            cu, cv = math.cos(a), math.sin(a)
            # 上圆隆、下平（下颌面）—— 这是扁喙的关键
            zz = cv * h if cv > 0 else cv * h * 0.18
            ring.append(BEAK_R + Vector((cu * w, y, z + zz)))
        bk_rings.append(ring)

    beak_mesh = loft('beakUpper', bk_rings, close_caps=True)
    shade_smooth(beak_mesh, 42)
    add_subsurf(beak_mesh, 1)
    apply_modifiers(beak_mesh)
    shade_smooth(beak_mesh, 42)
    assign(beak_mesh, M['beak'])

    # 喙中脊（上表面一道隆起）
    rp, rr = [], []
    for i in range(15):
        t = i / 14
        rp.append(BEAK_R + Vector((0, -t * BK_LEN * 0.97,
                                  0.0205 - 0.009 * t - BK_DROOP * (t ** 2.5))))
        rr.append((0.0044 * (1 - t * 0.72) + 0.0010, 0.0042 * (1 - t * 0.6) + 0.0009))
    ridge = tube_along('beakRidge', rp, rr, sections=10)
    shade_smooth(ridge)
    assign(ridge, M['beak'])

    # 喙尖钩（下弯的小爪）
    hook = sphere('beakHook',
                  BEAK_R + Vector((0, -BK_LEN * 0.982, -BK_DROOP - 0.003)),
                  0.0092, seg=18, rings=12, scale=(0.78, 1.20, 1.25))
    assign(hook, M['beakDark'])

    # 下颌（细，藏在喉囊上沿）
    lr = []
    for i in range(20):
        t = i / 19
        y = -t * BK_LEN * 0.95
        w = 0.027 * (1 - t * 0.60)
        z = -0.0075 - BK_DROOP * (t ** 2.5) * 0.97
        ring = []
        N = 12
        for k in range(N):
            a = 2 * math.pi * k / N
            ring.append(BEAK_R + Vector((math.cos(a) * w, y,
                                         z + math.sin(a) * 0.0068)))
        lr.append(ring)
    lower = loft('beakLower', lr, close_caps=True)
    shade_smooth(lower, 42)
    assign(lower, M['beakDark'])

    # ══════════════════════════════════════════════════════════
    #  喉囊：只挂在下颌下方，不越过胸（鹈鹕的兜）
    # ══════════════════════════════════════════════════════════
    po_stations = []
    PN = 15
    for i in range(PN + 1):
        t = i / PN
        # 上缘沿下颌线
        y = -t * BK_LEN * 0.93
        zt = BEAK_R.z - 0.010 - BK_DROOP * (t ** 2.5)
        # 垂深：中段最深，两端收到 0
        depth = 0.058 * math.sin(math.pi * min(1.0, t * 0.92) ** 0.72) ** 0.85
        # 宽：略宽于喙，中段最鼓
        wide = 0.030 * (0.80 + 0.50 * math.sin(math.pi * t ** 0.85))
        center = Vector((0, BEAK_R.y + y, zt - depth * 0.50))
        po_stations.append((center, wide, depth * 0.52 + 0.006))

    pouch, po_rings, _ = loft_spine('pouch', po_stations, sides=20)
    cap_spine(pouch, po_rings)
    shade_smooth(pouch, 54)
    add_subsurf(pouch, 1)
    apply_modifiers(pouch)
    add_displace(pouch, noise_texture('PouchLoose', 10.0, 3, 0.45), 0.0055)
    add_displace(pouch, noise_texture('PouchWrinkle', 36.0, 2, 0.30), 0.0018)
    apply_modifiers(pouch)
    shade_smooth(pouch, 54)
    assign(pouch, M['pouch'])

    # 兜底暗色（腹面一条，增加体积）
    dp, dr = [], []
    for i in range(10):
        t = i / 9
        y = -t * BK_LEN * 0.90
        zt = BEAK_R.z - 0.010 - BK_DROOP * (t ** 2.5)
        depth = 0.058 * math.sin(math.pi * min(1.0, t * 0.92) ** 0.72) ** 0.85
        dp.append(Vector((0, BEAK_R.y + y, zt - depth * 0.84)))
        dr.append((0.024 * (0.7 + 0.5 * math.sin(math.pi * t)), 0.006))
    pouch_belly = tube_along('pouchBelly', dp, dr, sections=12)
    shade_smooth(pouch_belly)
    assign(pouch_belly, M['pouchDeep'])

    beak_all = join_objects([beak_mesh, ridge, hook, lower, pouch, pouch_belly],
                            'beak')

    # ══════════════════════════════════════════════════════════
    #  眼（贴在颅侧）
    # ══════════════════════════════════════════════════════════
    eyes = []
    for side, tag in SIDES:
        c = Vector((side * 0.047, -0.208, 1.398))
        es = torus(f'eyeSkin_{tag}', 0.0190, 0.0054,
                   location=c + Vector((side * 0.004, 0, 0)),
                   rotation=(0, math.radians(90), 0), major_seg=20, minor_seg=8)
        shade_smooth(es); assign(es, M['skin']); eyes.append(es)

        o = sphere(f'sclera_{tag}', c, 0.0158, seg=20, rings=14)
        assign(o, M['sclera']); eyes.append(o)
        o = sphere(f'iris_{tag}', c + Vector((side * 0.0084, -0.0028, 0)),
                   0.0102, seg=18, rings=12, scale=(0.62, 1, 1))
        assign(o, M['iris']); eyes.append(o)
        o = sphere(f'pupil_{tag}', c + Vector((side * 0.0120, -0.0048, 0)),
                   0.0060, seg=16, rings=10, scale=(0.55, 1, 1))
        assign(o, M['pupil']); eyes.append(o)
        o = sphere(f'glint_{tag}', c + Vector((side * 0.0138, -0.0080, 0.0054)),
                   0.0027, seg=10, rings=8)
        assign(o, M['glint']); eyes.append(o)
    eye_node = join_objects(eyes, 'eyes')

    # ══════════════════════════════════════════════════════════
    #  头巾
    # ══════════════════════════════════════════════════════════
    CAP_C = Vector((0, -0.170, 1.432))
    bpy.ops.mesh.primitive_uv_sphere_add(segments=32, ring_count=20, radius=0.0685,
                                        location=CAP_C)
    cap = bpy.context.active_object
    cap.name = 'cap'
    bm = bmesh.new(); bm.from_mesh(cap.data)
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if v.co.z < CAP_C.z - 0.012],
                     context='VERTS')
    bm.to_mesh(cap.data); bm.free()
    add_solidify(cap, 0.0060, 1.0); apply_modifiers(cap)
    assign(cap, M['cap'])
    cap_parts = [cap]

    band = torus('capBand', 0.0672, 0.0070, location=CAP_C + Vector((0, 0, -0.014)),
                 major_seg=32, minor_seg=8)
    band.scale = (1.0, 1.02, 1.0)
    shade_smooth(band); assign(band, M['accent']); cap_parts.append(band)

    tk = sphere('capTop', CAP_C + Vector((0, 0.004, 0.0668)), 0.0085, seg=12, rings=8)
    assign(tk, M['accent']); cap_parts.append(tk)

    # 后颈护片
    bpy.ops.mesh.primitive_uv_sphere_add(segments=26, ring_count=18, radius=0.052,
                                        location=CAP_C + Vector((0, 0.044, -0.016)))
    flap = bpy.context.active_object
    flap.name = 'capFlap'
    flap.scale = (1.16, 0.50, 1.00)
    bpy.ops.object.transform_apply(scale=True)
    bm = bmesh.new(); bm.from_mesh(flap.data)
    bmesh.ops.delete(bm, geom=[v for v in bm.verts
                               if v.co.z > CAP_C.z + 0.002 or v.co.y < CAP_C.y + 0.014],
                     context='VERTS')
    bm.to_mesh(flap.data); bm.free()
    if len(flap.data.polygons):
        add_solidify(flap, 0.0048, 1.0); apply_modifiers(flap)
        assign(flap, M['cap']); cap_parts.append(flap)

    cap_node = join_objects(cap_parts, 'cap')

    # ══════════════════════════════════════════════════════════
    #  翅膀：前缘→后缘的薄片 + 掌部实体 + 后缘飞羽
    # ══════════════════════════════════════════════════════════
    wings = {}
    for side, tag in SIDES:
        shoulder = Vector((side * 0.126, -0.062, 1.078))
        elbow = Vector((side * 0.170, -0.184, 1.000))
        wrist = Vector((side * 0.096, BAR.y + 0.026, BAR.z + 0.006))
        # 翼尖收在身后靠内，避免一张横片插出来
        wingtip = Vector((side * 0.172, 0.070, 0.952))

        # 前缘（肩 → 肘 → 腕）
        lead = []
        for i in range(9):
            t = i / 8
            p = shoulder.lerp(elbow, t / 0.5) if t < 0.5 else elbow.lerp(wrist, (t - 0.5) / 0.5)
            lead.append(p)

        # 后缘（肩后 → 翼尖 → 腕后）
        rear0 = shoulder + Vector((side * 0.012, 0.042, -0.022))
        rear2 = wrist + Vector((side * 0.040, 0.052, -0.012))
        trail = []
        for i in range(9):
            t = i / 8
            p = rear0.lerp(wingtip, t / 0.5) if t < 0.5 else wingtip.lerp(rear2, (t - 0.5) / 0.5)
            trail.append(p)

        membrane = ribbon(f'wing_{tag}', lead, trail, across=10, thickness=0.0090)
        # 关键：ribbon 不会自动上材质，漏了就会导出成 glTF 默认材质（纯白 + 金属度 1）
        assign(membrane, M['wing'])

        # 上臂实体（让根部有肉，不是纸片）
        upper = tube_along(f'upperArm_{tag}',
                           [shoulder, shoulder.lerp(elbow, 0.55), elbow],
                           [(0.056, 0.042), (0.048, 0.034), (0.040, 0.026)],
                           sections=18)
        add_subsurf(upper, 1); apply_modifiers(upper)
        assign(upper, M['wing'])

        fore = tube_along(f'foreArm_{tag}',
                          [elbow, elbow.lerp(wrist, 0.5), wrist],
                          [(0.038, 0.026), (0.031, 0.022), (0.023, 0.018)],
                          sections=16)
        add_subsurf(fore, 1); apply_modifiers(fore)
        assign(fore, M['wing'])

        hand = sphere(f'hand_{tag}', wrist, 0.025, seg=18, rings=12,
                      scale=(1.0, 1.10, 0.88))
        assign(hand, M['beak'])

        # 覆羽：贴在前缘上，短、密，像瓦片
        cvt = []
        for i in range(8):
            t = i / 7
            p = lead[int(t * 8)]
            f = make_feather(f'cvt_{tag}_{i}', 0.064 - t * 0.014, 0.052,
                             thickness=0.0026, curve=0.26, camber=0.12, segs=10)
            orient(f, p + Vector((side * 0.002, 0.012, -0.006)),
                   Vector((side * 0.14, 0.80, -0.58)).normalized())
            cvt.append(f)

        # 后缘飞羽：短而柔，构成圆润的翅尾
        pri = []
        for i in range(5):
            t = i / 4
            p = wingtip.lerp(rear0, t)
            ln = 0.098 - t * 0.020
            f = make_feather(f'pri_{tag}_{i}', ln, 0.062,
                             thickness=0.0030, curve=0.30, camber=0.14, segs=12)
            orient(f, p, Vector((side * 0.10, 0.72, -0.68)).normalized())
            pri.append(f)

        for f in cvt:
            assign(f, M['wing'])
        for f in pri:
            assign(f, M['primary'])

        wing_node = join_objects([membrane, upper, fore, hand] + cvt + pri,
                                 f'wing{tag}')
        wings[tag] = wing_node

    # ══════════════════════════════════════════════════════════
    #  尾羽
    # ══════════════════════════════════════════════════════════
    tail_base = Vector((0, 0.190, 0.968))
    tails = []
    for i in range(5):
        t = (i / 4) - 0.5
        f = make_feather(f'tl_{i}', 0.165 - abs(t) * 0.034, 0.078,
                         thickness=0.0026, curve=0.10, camber=0.06, segs=14)
        orient(f, tail_base + Vector((t * 0.046, 0, -abs(t) * 0.008)),
               Vector((t * 0.32, 0.94, -0.12)).normalized())
        assign(f, M['wing'] if abs(t) < 0.30 else M['bodyS'])
        tails.append(f)
    tail = join_objects(tails, 'tail')

    # ══════════════════════════════════════════════════════════
    #  腿：羽裤 + 鳞胫 + 蹼足（一条连续放样）
    # ══════════════════════════════════════════════════════════
    legs = {}
    for side, tag in SIDES:
        hip = Vector((side * 0.060, 0.010, 0.945))
        knee = Vector((side * 0.082, -0.118, 0.852))
        ankle = Vector((side * 0.086, -0.058, 0.686))
        pedal = Vector((side * 0.086, -0.058, 0.672))

        # 羽裤（粗，白色）
        trouser, tr_rings, _ = loft_spine(f'trouser_{tag}', [
            (hip + Vector((0, 0, 0.026)), 0.062, 0.060),
            (hip, 0.064, 0.062),
            (hip.lerp(knee, 0.45) + Vector((0, 0.004, 0)), 0.056, 0.054),
            (knee + Vector((0, 0.004, 0.010)), 0.044, 0.042),
            (knee + Vector((0, 0, -0.004)), 0.036, 0.034),
        ], sides=18)
        cap_spine(trouser, tr_rings)
        shade_smooth(trouser, 50)
        add_subsurf(trouser, 1); apply_modifiers(trouser)
        add_displace(trouser, noise_texture(f'TrousDown_{tag}', 30.0, 3, 0.3), 0.0026)
        apply_modifiers(trouser)
        assign(trouser, M['body'])

        # 羽裤下摆（羽尖垂在膝上）
        thf = []
        for i in range(8):
            a = math.radians(-86 + (i / 7) * 172)
            f = make_feather(f'thf_{tag}_{i}', 0.048, 0.028,
                             thickness=0.0018, curve=0.62, segs=8)
            orient(f, knee + Vector((math.sin(a) * 0.020, 0.006, 0.008)),
                   Vector((math.sin(a) * 0.24, 0.26, -0.94)).normalized())
            thf.append(f)
        for f in thf:
            assign(f, M['body'])

        # 胫（橙色细杆）
        shin = tube_along(f'shin_{tag}', [knee, knee.lerp(ankle, 0.55), ankle],
                          [0.0190, 0.0166, 0.0158], sections=14)
        add_subsurf(shin, 1); apply_modifiers(shin)
        assign(shin, M['leg'])

        # 鳞环
        rings_ob = []
        for i in range(4):
            t = (i + 1) / 5
            p = knee.lerp(ankle, t)
            r = torus(f'ring_{tag}_{i}', 0.0176 - t * 0.0010, 0.0032,
                      location=p, rotation=(math.radians(90), 0, 0),
                      major_seg=16, minor_seg=6)
            shade_smooth(r); assign(r, M['legDark']); rings_ob.append(r)

        # 蹼足：三趾 + 蹼膜
        foot = []
        # 踝关节小肉包，把胫和蹼足接成一整块
        ankleJoint = sphere(f'ankle_{tag}', ankle + Vector((0, -0.002, -0.006)),
                            0.0185, seg=16, rings=10, scale=(1.0, 1.1, 0.9))
        assign(ankleJoint, M['leg']); foot.append(ankleJoint)

        toe_ang = [-0.56, 0.0, 0.56]
        toe_len = [0.062, 0.074, 0.060]
        tips = []
        base = ankle + Vector((0, -0.002, -0.008))
        for k, (ang, ln) in enumerate(zip(toe_ang, toe_len)):
            d = Vector((math.sin(ang) * side, -math.cos(ang), 0)).normalized()
            tip = base + d * ln
            tips.append(tip)
            toe = tube_along(f'toe_{tag}_{k}', [base, base + d * ln * 0.55, tip],
                             [0.0115, 0.0088, 0.0054], sections=10)
            add_subsurf(toe, 1); apply_modifiers(toe)
            assign(toe, M['leg']); foot.append(toe)

            claw = sphere(f'clw_{tag}_{k}', tip + d * 0.004, 0.0050,
                          seg=10, rings=8, scale=(0.70, 1.25, 0.70))
            assign(claw, M['legDark']); foot.append(claw)

        # 蹼膜：三趾之间的三角膜
        for k in range(2):
            a, b = tips[k], tips[k + 1]
            wv = [base, a, b]
            wf = [(0, 1, 2)]
            w = new_mesh_object(f'web_{tag}_{k}', wv, wf)
            add_solidify(w, 0.0016); apply_modifiers(w)
            shade_smooth(w); assign(w, M['leg']); foot.append(w)

        leg_node = join_objects([trouser] + thf + [shin] + rings_ob + foot,
                                f'leg{tag}')
        legs[tag] = leg_node

    # ══════════════════════════════════════════════════════════
    #  冠羽（头顶向后翘的几根）
    # ══════════════════════════════════════════════════════════
    crest = []
    for i, (dx, rz) in enumerate([(-0.014, -0.40), (0.0, 0.0), (0.014, 0.40)]):
        f = make_feather(f'cr_{i}', 0.058, 0.017, thickness=0.0016,
                         curve=-0.60, segs=8)
        orient(f, Vector((dx, -0.146, 1.478)),
               Vector((math.sin(rz) * 0.26, 0.62, 0.74)).normalized())
        assign(f, M['accent']); crest.append(f)
    crest_node = join_objects(crest, 'crest')

    # ══════════════════════════════════════════════════════════
    #  围巾
    # ══════════════════════════════════════════════════════════
    SCARF_C = Vector((0, -0.187, 1.128))
    knot = sphere('scarfKnot', SCARF_C, 0.034, seg=18, rings=12,
                  scale=(1.28, 0.86, 0.76))
    assign(knot, M['accent'])

    st = []
    for i, (dx, ln, dz) in enumerate([(-0.026, 0.190, -0.046), (0.028, 0.154, -0.032)]):
        pts_, rr = [], []
        for k in range(10):
            t = k / 9
            pts_.append(Vector((dx + math.sin(t * 2.9) * 0.024,
                                -0.186 + t * ln * 0.46,
                                1.152 + dz * t)))
            rr.append((0.030 - t * 0.011, 0.0052 - t * 0.0015))
        s = tube_along(f'scarfTail_{i}', pts_, rr, sections=12)
        add_subsurf(s, 1); apply_modifiers(s)
        assign(s, M['accent']); st.append(s)
    scarf = join_objects([knot] + st, 'scarf')

    # ══════════════════════════════════════════════════════════
    #  小书包
    # ══════════════════════════════════════════════════════════
    bag_body = rounded_box('bagBody', (0.104, 0.074, 0.122), 0.014,
                           location=Vector((0.150, 0.030, 1.002)),
                           rotation=(math.radians(-8), math.radians(18),
                                     math.radians(-7)))
    assign(bag_body, M['accent'])
    bag_flap = rounded_box('bagFlap', (0.106, 0.022, 0.050), 0.008,
                           location=Vector((0.152, 0.062, 1.030)),
                           rotation=(math.radians(-8), math.radians(18),
                                     math.radians(-7)))
    assign(bag_flap, M['gear'])
    bag_buckle = rounded_box('bagBuckle', (0.018, 0.010, 0.012), 0.003,
                             location=Vector((0.166, 0.068, 0.998)),
                             rotation=(0, math.radians(18), 0))
    assign(bag_buckle, M['gear'])
    bag_strap = tube_along('bagStrap', [
        Vector((0.138, -0.016, 1.060)),
        Vector((0.038, -0.156, 1.098)),
        Vector((-0.056, -0.176, 1.104)),
    ], [0.0096, 0.0088, 0.0096], sections=8)
    shade_smooth(bag_strap); assign(bag_strap, M['gear'])
    bag = join_objects([bag_body, bag_flap, bag_buckle, bag_strap], 'bag')

    # ══════════════════════════════════════════════════════════
    #  层级
    # ══════════════════════════════════════════════════════════
    root = bpy.data.objects.new('pelican', None)
    root.empty_display_type = 'PLAIN_AXES'
    root.location = (0, 0, 0)
    bpy.context.scene.collection.objects.link(root)
    bpy.context.view_layer.update()

    def pivot_parent(child, parent, pivot):
        bpy.context.view_layer.objects.active = child
        child.select_set(True)
        cur = bpy.context.scene.cursor.location.copy()
        bpy.context.scene.cursor.location = Vector(pivot)
        bpy.ops.object.origin_set(type='ORIGIN_CURSOR')
        bpy.context.scene.cursor.location = cur
        child.select_set(False)
        bpy.context.view_layer.update()
        mw = child.matrix_world.copy()
        child.parent = parent
        child.matrix_world = mw
        bpy.context.view_layer.update()

    # 躯干节点：身体 + 喙 + 喉囊 + 喙脊 + 钩 合并为一个「身体」网格
    body_all = join_objects([body], 'body')
    # 头颈节点：颈以上 + 眼 + 头巾 + 冠羽（眼睛/帽子跟着头转）
    head_all = None

    pivot_parent(body_all, root, Vector((0, 0.030, SEAT_Z)))

    # 头颈单独一组，便于点头
    # 简化：把颈根以上切出来太麻烦，这里让 cap/eyes/crest 作为子节点跟随，
    # 点头动画靠整体轻微俯仰实现（相机远，看不出来）
    head_pivot = Vector((0, -0.190, 1.180))
    pivot_parent(beak_all, body_all, head_pivot)
    pivot_parent(eye_node, body_all, head_pivot)
    pivot_parent(cap_node, body_all, head_pivot)
    pivot_parent(crest_node, body_all, head_pivot)

    for side, tag in SIDES:
        pivot_parent(wings[tag], body_all, Vector((side * 0.128, -0.056, 1.072)))
        pivot_parent(legs[tag], body_all, Vector((side * 0.060, 0.010, 0.945)))
    pivot_parent(tail, body_all, tail_base)
    pivot_parent(scarf, body_all, SCARF_C)
    pivot_parent(bag, body_all, Vector((0.150, 0.030, 1.002)))

    nodes = {'body': body_all, 'beak': beak_all, 'eyes': eye_node,
             'cap': cap_node, 'crest': crest_node,
             'wingL': wings['L'], 'wingR': wings['R'],
             'legL': legs['L'], 'legR': legs['R'],
             'tail': tail, 'scarf': scarf, 'bag': bag}
    for k, ob in nodes.items():
        ob.name = k

    print(f'\n  三角面数：{tri_count():,}')
    for k, ob in nodes.items():
        bb = [ob.matrix_world @ Vector(c) for c in ob.bound_box]
        print(f'    {k:7s} x=[{min(p.x for p in bb):+.3f},{max(p.x for p in bb):+.3f}] '
              f'y=[{min(p.y for p in bb):+.3f},{max(p.y for p in bb):+.3f}] '
              f'z=[{min(p.z for p in bb):+.3f},{max(p.z for p in bb):+.3f}]')
    return root, [root] + list(nodes.values())


if __name__ == '__main__':
    args = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    out = args[0] if args else None
    root, objs = build()
    if out:
        export_glb(out, objs)
