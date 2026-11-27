"""
环境资产：树 / 岩石 / 路灯 / 护栏 / 里程牌，导出为独立 glb。

每件都做 LOD 意识：远处看的是剪影和色块，近处看的是树皮与叶簇。
树用「树干放样 + 分枝 + 叶簇球」，比纯锥体自然；
叶簇用 displacement 打碎，避免「绿色气球」感。

产出（app/models/）：
  tree_pine.glb     针叶（3 层冠，高 7.2m）
  tree_broad.glb    阔叶（多主干，高 5.6m）
  tree_small.glb    灌木 / 小树（高 1.9m）
  rock_a.glb        岩石（0.9m）
  rock_b.glb        岩块（1.6m）
  lamp.glb          路灯（6.2m，灯头可换材质）
  guardrail.glb     公路护栏（4m 段，可拼接）
  bollard.glb       轮廓柱
  signpost.glb      绿色里程牌
  windmill.glb      风车（远景剪影）
  mountain.glb      远山（带雪线）
"""
import bpy
import bmesh
import math
import random
import sys
import os
from mathutils import Vector, Euler, Matrix

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from lib_mesh import *   # noqa

OUT_DIR = sys.argv[sys.argv.index('--') + 1] if '--' in sys.argv else 'app/models'
random.seed(1234)


def tube(a, b, rx, rz=None, sections=12, name='tube', mat=None, cap=True):
    """两点之间的椭圆截面直管（正交架，方向无关）"""
    A, B = Vector(a), Vector(b)
    d = B - A
    if d.length < 1e-6:
        return None
    dz = d.normalized()
    ref = Vector((0, 0, 1)) if abs(dz.z) < 0.94 else Vector((0, 1, 0))
    sx = dz.cross(ref).normalized()
    sz = sx.cross(dz).normalized()
    if rz is None:
        rz = rx
    rings = []
    for i in range(7):
        t = i / 6
        c = A + d * t
        ring = []
        for j in range(sections):
            a = 2 * math.pi * j / sections
            ring.append(c + sx * (math.cos(a) * rx) + sz * (math.sin(a) * rz))
        rings.append(ring)
    ob = loft(name, rings, close_caps=cap)
    if mat:
        assign(ob, mat)
    return ob


def bark_mat():
    return pbr('Bark', (0.230, 0.168, 0.118, 1), roughness=0.86)


def trunk(name, base, height, r0, r1, bend=0.0, bark=None, segs=14, sides=12):
    """树干：底部略粗，向上收窄并带弯曲"""
    rings = []
    N = 12
    for i in range(N + 1):
        t = i / N
        z = base.z + height * t
        r = r0 + (r1 - r0) * (t ** 0.65)
        # 弯曲
        ox = math.sin(t * math.pi * 0.9) * bend
        oy = math.cos(t * math.pi * 0.7) * bend * 0.6
        ring = []
        for k in range(sides):
            a = 2 * math.pi * k / sides
            # 树皮不规则：半径带一点噪声
            rr = r * (1 + 0.09 * math.sin(a * 5 + t * 9))
            ring.append(Vector((base.x + ox + math.cos(a) * rr,
                                base.y + oy + math.sin(a) * rr,
                                z)))
        rings.append(ring)
    ob = loft(name, rings, close_caps=True)
    shade_smooth(ob, 50)
    assign(ob, bark)
    return ob


def leaf_cluster(name, center, radius, mats, count=1, squash=0.80, seed=0,
                 leaf_count=None):
    """
    叶簇：内部融合体（密实遮挡）+ 表面真实叶片几何。
    只用一个打碎的球会变成碎纸片；只有叶片又会透光。
    两者叠起来才有商业级树冠的层次与体积。
    """
    rnd = random.Random(seed)

    # 1) 核心（低分辨率，只做遮挡）
    elems = []
    for i in range(max(1, count)):
        off = Vector((rnd.uniform(-0.45, 0.45) * radius,
                      rnd.uniform(-0.45, 0.45) * radius,
                      rnd.uniform(-0.30, 0.30) * radius))
        elems.append((center + off, radius * rnd.uniform(0.40, 0.56),
                      (1.0, 1.0, squash)))
    core = metaball_blob(f'{name}Core', elems, resolution=radius * 0.15, smooth_iter=1)
    # 核心要「糙」，别像气球：中等强度 + 高频一起上
    add_displace(core, noise_texture(f'{name}CoreN', 6.5 / max(radius, 0.1), 4, 0.55),
                 radius * 0.17)
    add_displace(core, noise_texture(f'{name}CoreN2', 22.0 / max(radius, 0.1), 3, 0.45),
                 radius * 0.06)
    apply_modifiers(core)
    shade_smooth(core, 42)
    assign(core, mats[-1])     # 用最深的一档，避免核心发亮

    # 2) 表面叶片
    if leaf_count is None:
        leaf_count = max(24, int(radius * radius * 62))
    parts = [core]
    for i in range(leaf_count):
        theta = 2 * math.pi * rnd.random()
        phi = math.acos(2 * rnd.random() - 1)
        dirv = Vector((math.sin(phi) * math.cos(theta),
                       math.sin(phi) * math.sin(theta),
                       math.cos(phi) * squash))
        p = center + dirv * (radius * rnd.uniform(0.58, 0.92))
        ln = radius * rnd.uniform(0.24, 0.42)
        wd = ln * rnd.uniform(0.55, 0.90)
        leaf = make_leaf(f'{name}L{i}', ln, wd)
        out = dirv.normalized()
        d = (out * 0.70 + Vector((rnd.uniform(-1, 1), rnd.uniform(-1, 1),
                                  rnd.uniform(-0.35, 1.0)))).normalized()
        orient_leaf(leaf, p, d, rnd.uniform(0, math.pi * 2))
        assign(leaf, mats[i % len(mats)])
        parts.append(leaf)

    return join_objects(parts, name)


def make_leaf(name, length, width):
    """一片叶子：椭圆叶身 + 中脉隆起 + 轻微卷曲"""
    rings = []
    N = 6
    for i in range(N + 1):
        t = i / N
        y = length * t
        e = math.sin(math.pi * min(1.0, t ** 0.62)) ** 0.60
        w = max(width * e * 0.5, width * 0.06)
        th = 0.0030 * (0.45 + 0.55 * math.sin(math.pi * t))
        curl = -0.20 * length * (t ** 2)
        ring = []
        for k in range(8):
            a = 2 * math.pi * k / 8
            cu, cv = math.cos(a), math.sin(a)
            ring.append(Vector((cu * w, y,
                                curl + cv * th
                                + 0.0020 * (1 - abs(cu)) * math.sin(math.pi * t))))
        rings.append(ring)
    ob = loft(name, rings, close_caps=True)
    shade_smooth(ob, 60)
    return ob


def orient_leaf(ob, root, direction, spin=0.0):
    """叶片局部 +Y 指向 direction"""
    y = Vector(direction).normalized()
    ref = Vector((0, 0, 1))
    if abs(y.dot(ref)) > 0.97:
        ref = Vector((1, 0, 0))
    x = y.cross(ref).normalized()
    z = x.cross(y).normalized()
    R = Matrix((
        (x.x, y.x, z.x, 0.0),
        (x.y, y.y, z.y, 0.0),
        (x.z, y.z, z.z, 0.0),
        (0.0, 0.0, 0.0, 1.0),
    ))
    ob.matrix_world = (Matrix.Translation(Vector(root))
                       @ R @ Matrix.Rotation(spin, 4, 'Y'))
    bpy.context.view_layer.objects.active = ob
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    return ob


# ══════════════════════════════════════════════════════════════
def build_pine():
    """针叶树：主干 + 3 层伞状冠（用多个团块堆出，不是圆锥）"""
    reset_scene()
    bark = bark_mat()
    leaf_a = pbr('PineLeafA', (0.052, 0.185, 0.082, 1), roughness=0.80, sheen=0.2)
    leaf_b = pbr('PineLeafB', (0.072, 0.230, 0.106, 1), roughness=0.78, sheen=0.2)
    leaf_c = pbr('PineLeafC', (0.038, 0.142, 0.062, 1), roughness=0.82, sheen=0.2)

    H = 7.2
    parts = [trunk('pineTrunk', Vector((0, 0, 0)), H * 0.72, 0.19, 0.055,
                   bend=0.06, bark=bark)]

    # 三层冠：下层宽、上层窄
    layers = [
        (H * 0.30, 1.92, 4, leaf_c, 0.72),
        (H * 0.52, 1.55, 4, leaf_a, 0.66),
        (H * 0.70, 1.16, 3, leaf_b, 0.62),
        (H * 0.84, 0.72, 2, leaf_b, 0.55),
    ]
    for li, (z, r, n, mat, sq) in enumerate(layers):
        rnd = random.Random(100 + li)
        for i in range(n):
            ang = 2 * math.pi * i / n + rnd.uniform(-0.4, 0.4)
            dist = r * rnd.uniform(0.30, 0.62)
            c = Vector((math.cos(ang) * dist, math.sin(ang) * dist, z))
            ob = leaf_cluster(f'pineLeaf{li}_{i}', c, r * rnd.uniform(0.52, 0.72),
                              [mat], count=2, squash=sq, seed=200 + li * 10 + i,
                              leaf_count=int(r * r * 34))
            parts.append(ob)

    root = join_objects(parts, 'tree_pine')
    print(f'  pine tris: {tri_count():,}')
    export_glb(os.path.join(OUT_DIR, 'tree_pine.glb'), [root])


def build_broad():
    """阔叶树：分叉主干 + 大叶簇"""
    reset_scene()
    bark = bark_mat()
    leaf_a = pbr('BroadLeafA', (0.086, 0.246, 0.086, 1), roughness=0.78, sheen=0.22)
    leaf_b = pbr('BroadLeafB', (0.118, 0.300, 0.104, 1), roughness=0.76, sheen=0.22)
    leaf_c = pbr('BroadLeafC', (0.056, 0.180, 0.062, 1), roughness=0.80, sheen=0.22)

    H = 3.6
    parts = [trunk('broadTrunk', Vector((0, 0, 0)), H * 0.62, 0.17, 0.085,
                   bend=0.05, bark=bark)]

    # 三根主枝
    rnd = random.Random(77)
    branch_ends = []
    for i in range(3):
        ang = math.radians(60 + i * 120 + rnd.uniform(-18, 18))
        base = Vector((0, 0, H * 0.42 + i * 0.12))
        end = base + Vector((math.cos(ang) * 1.28, math.sin(ang) * 1.28,
                             H * 0.34 + rnd.uniform(-0.2, 0.3)))
        # 分枝：用 trunk 的变体（倾斜的锥）
        rings = []
        N = 8
        for j in range(N + 1):
            t = j / N
            p = base.lerp(end, t)
            r = 0.095 * (1 - t * 0.72)
            ring = []
            for k in range(11):
                a = 2 * math.pi * k / 11
                ring.append(p + Vector((math.cos(a) * r, math.sin(a) * r,
                                        math.sin(a) * r * 0.3)))
            rings.append(ring)
        br = loft(f'branch{i}', rings, close_caps=True)
        shade_smooth(br, 50)
        assign(br, bark)
        parts.append(br)
        branch_ends.append(end)

    # 叶簇（沿枝端成团）
    for i, end in enumerate(branch_ends):
        for j, (dx, dy, dz, r) in enumerate([
            (0, 0, 0.42, 1.15), (0.55, 0.30, 0.10, 0.88),
            (-0.45, -0.40, 0.22, 0.92), (0.10, -0.55, 0.60, 0.80),
        ]):
            c = end + Vector((dx, dy, dz))
            mat = [leaf_a, leaf_b, leaf_c][(i + j) % 3]
            parts.append(leaf_cluster(f'bl{i}_{j}', c, r, [mat], count=3,
                                  squash=0.78, seed=300 + i * 10 + j,
                                  leaf_count=int(r * r * 46)))

    root = join_objects(parts, 'tree_broad')
    print(f'  broad tris: {tri_count():,}')
    export_glb(os.path.join(OUT_DIR, 'tree_broad.glb'), [root])


def build_bush():
    reset_scene()
    leaf = pbr('BushLeaf', (0.098, 0.262, 0.094, 1), roughness=0.80, sheen=0.24)
    leaf2 = pbr('BushLeaf2', (0.066, 0.196, 0.072, 1), roughness=0.82, sheen=0.24)
    parts = []
    for i, (c, r) in enumerate([
        ((0, 0, 0.58), 0.62), ((0.52, 0.24, 0.44), 0.46),
        ((-0.46, -0.20, 0.42), 0.44), ((0.10, -0.50, 0.40), 0.40),
        ((-0.10, 0.48, 0.46), 0.42),
    ]):
        parts.append(leaf_cluster(f'bush{i}', Vector(c), r,
                                  [leaf if i % 2 == 0 else leaf2],
                                  count=2, squash=0.82, seed=400 + i,
                                  leaf_count=int(r * r * 60)))
    root = join_objects(parts, 'tree_small')
    print(f'  bush tris: {tri_count():,}')
    export_glb(os.path.join(OUT_DIR, 'tree_small.glb'), [root])


# ══════════════════════════════════════════════════════════════
def build_rocks():
    """岩石：metaball 团 + 强烈 displacement（形成棱面感）+ Voronoi 打碎"""
    for tag, (n, scale, seed) in {'a': (2, 0.55, 501), 'b': (3, 1.05, 502)}.items():
        reset_scene()
        mat = pbr('Rock', (0.400, 0.392, 0.372, 1), roughness=0.86)
        rnd = random.Random(seed)
        elems = []
        for i in range(n + 1):
            off = Vector((rnd.uniform(-0.5, 0.5), rnd.uniform(-0.4, 0.4),
                          rnd.uniform(-0.2, 0.35))) * scale
            elems.append((off, scale * rnd.uniform(0.72, 1.05),
                          (rnd.uniform(0.9, 1.3), rnd.uniform(0.9, 1.3), 0.72)))
        ob = metaball_blob(f'rock_{tag}', elems, resolution=scale * 0.075, smooth_iter=1)

        # 强 displacement：岩面的断裂与起伏
        add_displace(ob, noise_texture(f'RockBig_{tag}', 4.0 / scale, 5, 0.55), scale * 0.30)
        add_displace(ob, noise_texture(f'RockMid_{tag}', 13.0 / scale, 4, 0.45), scale * 0.10)
        add_displace(ob, voronoi_texture(f'RockCrack_{tag}', 9.0 / scale), scale * 0.045)
        apply_modifiers(ob)
        shade_smooth(ob, 34)   # 低平滑角 → 保留岩棱

        # 压平底部
        bm = bmesh.new()
        bm.from_mesh(ob.data)
        for v in bm.verts:
            if v.co.z < 0:
                v.co.z *= 0.15
        bm.to_mesh(ob.data)
        bm.free()
        ob.data.update()

        assign(ob, mat)
        ob.name = f'rock_{tag}'
        print(f'  rock_{tag} tris: {tri_count():,}')
        export_glb(os.path.join(OUT_DIR, f'rock_{tag}.glb'), [ob])


# ══════════════════════════════════════════════════════════════
def build_lamp():
    """路灯：锥形杆 + 弧形挑臂 + 灯头（灯罩 / 发光面分离，便于夜间点亮）"""
    reset_scene()
    metal = pbr('LampPole', (0.235, 0.250, 0.278, 1), roughness=0.42, metallic=0.65)
    dark = pbr('LampDark', (0.100, 0.108, 0.122, 1), roughness=0.52, metallic=0.5)
    glass = pbr('LampGlass', (1.0, 0.955, 0.860, 1), roughness=0.08,
                emission=(1.0, 0.94, 0.80), emission_strength=0.0,
                transmission=0.55)

    parts = []
    # 基座
    base = cylinder('lampBase', 0.145, 0.16, location=(0, 0, 0.08), verts=20)
    shade_smooth(base)
    assign(base, dark)
    parts.append(base)

    # 柱（锥形，上细下粗）
    H = 6.2
    ring_pts = []
    N = 14
    for i in range(N + 1):
        t = i / N
        r = 0.088 * (1 - t * 0.48)
        ring_pts.append((Vector((0, 0, 0.16 + t * (H - 0.16))), r, r))
    pole, pr, _ = loft_spine('lampPole', ring_pts, sides=16)
    cap_spine(pole, pr)
    shade_smooth(pole, 46)
    assign(pole, metal)
    parts.append(pole)

    # 弧形挑臂（向 -X 伸出，道路在那一侧）
    arm_pts = []
    for i in range(13):
        t = i / 12
        ang = t * math.pi * 0.46
        x = -0.10 - math.sin(ang) * 1.02
        z = H + 0.06 + (1 - math.cos(ang)) * 0.30
        arm_pts.append(Vector((x, 0, z)))
    arm = tube_along('lampArm', arm_pts,
                     [0.052 - t * 0.026 for t in [k / 12 for k in range(13)]],
                     sections=12)
    shade_smooth(arm)
    assign(arm, metal)
    parts.append(arm)

    # 灯头：壳体 + 发光面
    head_c = arm_pts[-1] + Vector((0.02, 0, -0.075))
    head_shell = rounded_box('lampHead', (0.325, 0.185, 0.075), 0.030,
                             location=head_c, rotation=(0, math.radians(-6), 0))
    assign(head_shell, dark)
    parts.append(head_shell)

    lens = rounded_box('lampLens', (0.285, 0.155, 0.018), 0.008,
                       location=head_c + Vector((0, 0, -0.042)),
                       rotation=(0, math.radians(-6), 0))
    assign(lens, glass)
    parts.append(lens)

    # 灯头小顶盖
    cap = rounded_box('lampCap', (0.20, 0.12, 0.030), 0.012,
                      location=head_c + Vector((0, 0, 0.048)))
    assign(cap, metal)
    parts.append(cap)

    root = join_objects(parts, 'lamp')
    print(f'  lamp tris: {tri_count():,}')
    export_glb(os.path.join(OUT_DIR, 'lamp.glb'), [root])


def build_guardrail():
    """公路波形护栏：一整段 4m，可首尾拼接"""
    reset_scene()
    metal = pbr('GuardRail', (0.520, 0.548, 0.580, 1), roughness=0.38, metallic=0.85)
    post_mat = pbr('GuardPost', (0.290, 0.310, 0.338, 1), roughness=0.44, metallic=0.70)

    parts = []
    L = 4.0
    # 波形板：沿 X 延伸（横向），波峰波谷在 Y 方向
    rings = []
    Nx = 22
    for i in range(Nx + 1):
        t = i / Nx
        x = (t - 0.5) * L
        ring = []
        # 截面：W 形（两个波峰）
        for k in range(15):
            u = k / 14
            w = math.sin(u * math.pi * 2.0) * 0.048
            ring.append(Vector((x, w, 0.72 + (u - 0.5) * 0.30)))
        rings.append(ring)
    rail = loft('railBeam', rings, close_caps=True)
    add_solidify(rail, 0.006, 0.0)
    apply_modifiers(rail)
    shade_smooth(rail, 40)
    assign(rail, metal)
    parts.append(rail)

    # 立柱（每 2m 一根）
    for x in (-L / 2 + 0.15, 0.0, L / 2 - 0.15):
        p = rounded_box(f'railPost{x:.1f}', (0.075, 0.075, 0.95), 0.010,
                        location=Vector((x, 0.055, 0.475)))
        assign(p, post_mat)
        parts.append(p)
        # 连接件
        br = rounded_box(f'railBr{x:.1f}', (0.055, 0.045, 0.075), 0.006,
                         location=Vector((x, 0.020, 0.74)))
        assign(br, post_mat)
        parts.append(br)

    root = join_objects(parts, 'guardrail')
    print(f'  guardrail tris: {tri_count():,}')
    export_glb(os.path.join(OUT_DIR, 'guardrail.glb'), [root])


def build_bollard():
    """轮廓柱（路缘反光柱）"""
    reset_scene()
    body_mat = pbr('BollardBody', (0.900, 0.910, 0.925, 1), roughness=0.36)
    cap_mat = pbr('BollardCap', (1.0, 0.35, 0.08, 1), roughness=0.22,
                  emission=(1.0, 0.35, 0.08), emission_strength=0.20)
    parts = []

    rings = []
    N = 8
    for i in range(N + 1):
        t = i / N
        r = 0.058 * (1 - t * 0.18)
        rings.append((Vector((0, 0, t * 0.855)), r, r))
    body, br, _ = loft_spine('bollardBody', rings, sides=14)
    cap_spine(body, br)
    shade_smooth(body, 46)
    assign(body, body_mat)
    parts.append(body)

    # 反光环 * 2
    for z in (0.66, 0.74):
        r = torus(f'boRefl{z}', 0.0565, 0.0075, location=(0, 0, z),
                  major_seg=16, minor_seg=6)
        shade_smooth(r)
        assign(r, cap_mat)
        parts.append(r)

    # 顶部圆头
    top = sphere('bollardTop', Vector((0, 0, 0.868)), 0.049,
                 seg=16, rings=12, scale=(1, 1, 0.7))
    assign(top, body_mat)
    parts.append(top)

    root = join_objects(parts, 'bollard')
    print(f'  bollard tris: {tri_count():,}')
    export_glb(os.path.join(OUT_DIR, 'bollard.glb'), [root])


def build_signpost():
    """绿色里程牌：杆 + 牌面（牌面用简单材质，文字在运行时贴图）"""
    reset_scene()
    metal = pbr('SignPole', (0.330, 0.348, 0.375, 1), roughness=0.40, metallic=0.80)
    green = pbr('SignGreen', (0.055, 0.320, 0.190, 1), roughness=0.44)
    white = pbr('SignWhite', (0.930, 0.935, 0.940, 1), roughness=0.40)
    parts = []

    for x in (-0.42, 0.42):
        p = tube(Vector((x, 0, 0)), Vector((x, 0, 2.05)), 0.038, sections=12,
                 name=f'signPole{x}', mat=metal)
        parts.append(p)

    board = rounded_box('signBoard', (1.12, 0.045, 0.62), 0.020,
                        location=Vector((0, 0, 1.78)))
    assign(board, green)
    parts.append(board)

    # 牌面白边
    for (w, h, x, z) in ((1.10, 0.030, 0, 0.62 + 1.78 - 0.31),
                         (1.10, 0.030, 0, 1.78 - 0.31)):
        e = rounded_box(f'signEdge{z:.2f}', (w, 0.048, h), 0.008,
                        location=Vector((x, 0, z)))
        assign(e, white)
        parts.append(e)

    root = join_objects(parts, 'signpost')
    print(f'  signpost tris: {tri_count():,}')
    export_glb(os.path.join(OUT_DIR, 'signpost.glb'), [root])


def build_windmill():
    """远景风车（剪影用，简化但正确）"""
    reset_scene()
    body = pbr('WindBody', (0.880, 0.878, 0.862, 1), roughness=0.62)
    dark = pbr('WindDark', (0.180, 0.195, 0.220, 1), roughness=0.55)
    parts = []

    # 塔身（锥形，八边）
    st = []
    N = 10
    for i in range(N + 1):
        t = i / N
        r = 2.05 * (1 - t * 0.56)
        st.append((Vector((0, 0, t * 24.0)), r, r))
    tower, tr, _ = loft_spine('windTower', st, sides=10)
    cap_spine(tower, tr)
    shade_smooth(tower, 40)
    assign(tower, body)
    parts.append(tower)

    # 机舱
    nac = rounded_box('windNacelle', (1.5, 2.6, 1.35), 0.30,
                      location=Vector((0, -0.55, 24.4)))
    assign(nac, body)
    parts.append(nac)

    # 轮毂
    hub = cylinder('windHub', 0.62, 0.75,
                   location=Vector((0, -1.95, 24.4)),
                   rotation=(math.radians(90), 0, 0), verts=20)
    shade_smooth(hub)
    assign(hub, dark)
    parts.append(hub)

    # 三片桨叶（扭转的细长叶）
    for i in range(3):
        ang = i * 2 * math.pi / 3
        blade_parts = []
        NB = 14
        rings = []
        for j in range(NB + 1):
            t = j / NB
            dist = 0.55 + t * 12.5
            # 翼型：根部窄、中段宽、尖端收
            chord = 1.55 * (0.26 + 0.85 * math.sin(math.pi * min(1.0, t * 1.05)) ** 0.8)
            chord *= (1 - t * 0.55)
            thick = 0.22 * (1 - t * 0.70)
            # 扭转
            twist = math.radians(-16 + t * 20)
            ring = []
            for k in range(10):
                u = k / 9
                a = 2 * math.pi * u
                cy = math.cos(a) * chord * 0.5
                cz = math.sin(a) * thick * 0.5
                # 扭转
                ry = cy * math.cos(twist) - cz * math.sin(twist)
                rz = cy * math.sin(twist) + cz * math.cos(twist)
                ring.append(Vector((0, ry, dist + rz)))
            rings.append(ring)
        blade = loft(f'blade{i}', rings, close_caps=True)
        shade_smooth(blade)
        assign(blade, body)
        blade_parts.append(blade)

        holder = join_objects(blade_parts, f'windBlade{i}')
        holder.rotation_euler = (0, ang, 0)
        bpy.context.view_layer.objects.active = holder
        holder.location = Vector((0, -1.95, 24.4))
        holder.select_set(True)
        bpy.ops.object.transform_apply(location=True, rotation=True)
        holder.select_set(False)
        parts.append(holder)

    root = join_objects(parts, 'windmill')
    root.name = 'windmill'
    print(f'  windmill tris: {tri_count():,}')
    export_glb(os.path.join(OUT_DIR, 'windmill.glb'), [root])


def build_mountain():
    """远山：真实的脊线，不是圆锥。用位移做出沟壑与雪线"""
    reset_scene()
    rock = pbr('MtnRock', (0.200, 0.225, 0.270, 1), roughness=0.90)
    snow = pbr('MtnSnow', (0.700, 0.745, 0.800, 1), roughness=0.72, sheen=0.15)

    # 山体：一个高瘦的隆起
    bpy.ops.mesh.primitive_cone_add(vertices=18, radius1=58, radius2=2,
                                   depth=112, location=(0, 0, 56))
    mtn = bpy.context.active_object
    mtn.name = 'mountain'

    # 细分 + 位移 → 山脊沟壑
    add_subsurf(mtn, 3)
    apply_modifiers(mtn)
    add_displace(mtn, noise_texture('MtnRidge', 0.055, 6, 0.55), 17.0)
    add_displace(mtn, noise_texture('MtnGully', 0.16, 5, 0.45), 6.5)
    add_displace(mtn, noise_texture('MtnDetail', 0.55, 4, 0.35), 2.2)
    apply_modifiers(mtn)
    shade_smooth(mtn, 40)

    # 材质：按高度分雪线（用顶点色 → 两材质按 Z 切换）
    assign(mtn, rock)
    idx_snow = add_material_slot(mtn, snow)
    for p in mtn.data.polygons:
        c = p.center
        # 雪线：高于 72m 且面朝上
        if c.z > 66 + 8 * math.sin(c.x * 0.05) * math.cos(c.y * 0.04):
            if p.normal.z > 0.12:
                p.material_index = idx_snow

    print(f'  mountain tris: {tri_count():,}')
    export_glb(os.path.join(OUT_DIR, 'mountain.glb'), [mtn])


if __name__ == '__main__':
    os.makedirs(OUT_DIR, exist_ok=True)
    for fn in (build_pine, build_broad, build_bush, build_rocks, build_lamp,
               build_guardrail, build_bollard, build_signpost,
               build_windmill, build_mountain):
        print(f'▶ {fn.__name__}')
        fn()
    print('\n完成')
