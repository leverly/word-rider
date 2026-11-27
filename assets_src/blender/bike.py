"""
自行车 / 滑板车：真实管件 + 细节件。

设计依据
- 车轮是剪影主角：有胎冠弧度、胎纹、双层轮圈、交叉辐条、花鼓、气门嘴
- 车架用椭圆截面的管（真实车管是抽管椭圆，不是圆柱）
- 传动系统完整：牙盘齿、链条、飞轮、后拨
- 骑手能抓住的车把：把套有防滑纹、刹把、变速线

坐标：Z 上，-Y 前进，原点 = 两轮接地点中点（车轮半径 0.34）。
"""
import bpy
import bmesh
import math
import sys
import os
from mathutils import Vector, Euler, Matrix

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from lib_mesh import *   # noqa

R_WHEEL = 0.340
WB = 0.545                 # 轴距的一半（前后轮各 ±WB）
BB = Vector((0, 0.030, 0.275))          # 中轴
SEAT_TOP = Vector((0, 0.150, 0.868))    # 座管顶
HEAD_TOP = Vector((0, -0.360, 0.930))   # 头管顶
HEAD_BOT = Vector((0, -0.330, 0.720))   # 头管底
BAR_C = Vector((0, -0.300, 0.958))      # 车把中心
AX_R = Vector((0, WB, R_WHEEL))
AX_F = Vector((0, -WB, R_WHEEL))


# ══════════════════════════════════════════════════════════════
def tube(a, b, rx, rz=None, sections=14, name='tube', mat=None, cap=True):
    """
    两点之间一段椭圆截面管。
    用「方向导出的正交架」生成截面，不用旋转矩阵——
    旋转矩阵在方向接近 ±X 时会退化，这正是之前车架歪掉的原因。
    rx 是沿「侧向」的半轴，rz 是沿「上向」的半轴。
    """
    A, B = Vector(a), Vector(b)
    d = (B - A)
    L = d.length
    if L < 1e-6:
        return None
    dz = d / L

    # 上参考：不能用 (0,0,1) 当方向接近竖直时外积退化
    ref = Vector((0, 0, 1)) if abs(dz.z) < 0.94 else Vector((0, 1, 0))
    sx = dz.cross(ref).normalized()      # 侧向
    sz = sx.cross(dz).normalized()       # 上向

    if rz is None:
        rz = rx

    rings = []
    STEPS = 6
    for i in range(STEPS + 1):
        t = i / STEPS
        c = A + d * t
        # 抽管：两端略粗、中间略细
        k = 1.0 + 0.12 * ((abs(t - 0.5) * 2) ** 2)
        ring = []
        for j in range(sections):
            ang = 2 * math.pi * j / sections
            ring.append(c + sx * (math.cos(ang) * rx * k)
                        + sz * (math.sin(ang) * rz * k))
        rings.append(ring)

    ob = loft(name, rings, close_caps=cap)
    if mat:
        assign(ob, mat)
    return ob


def wheel(name, radius, tire_w, mats, spokes=20, rim_w=0.020, hub_w=0.085,
          offset_x=0.0, tread=True):
    """完整车轮：胎冠 + 胎纹 + 双层轮圈 + 交叉辐条 + 花鼓 + 气门嘴"""
    g = []
    R = radius
    tire_r = tire_w * 0.5

    # 轮胎（圆环，横截面是圆的，有弹性感）
    t = torus(f'{name}_tire', R - tire_r, tire_r,
              location=(offset_x, 0, 0), rotation=(0, math.radians(90), 0),
              major_seg=48, minor_seg=16)
    shade_smooth(t)
    assign(t, mats['tire'])
    g.append(t)

    # 胎冠纹路（沿圆周的小块，模拟橡胶块）
    if tread:
        for i in range(30):
            a = 2 * math.pi * i / 30
            for s in (-1, 1):
                blk = rounded_box(f'{name}_tr{i}_{s}',
                                  (tire_w * 0.44, 0.020, 0.012), 0.0035,
                                  location=(offset_x + s * tire_w * 0.22,
                                            math.sin(a) * (R - tire_r * 0.65),
                                            math.cos(a) * (R - tire_r * 0.65)))
                blk.rotation_euler = (a + math.pi / 2, 0, 0)
                bpy.context.view_layer.objects.active = blk
                blk.select_set(True)
                bpy.ops.object.transform_apply(rotation=True)
                blk.select_set(False)
                assign(blk, mats['tread'])
                g.append(blk)

    # 轮圈（双层：外圈亮、内圈暗）
    rim_outer = torus(f'{name}_rim', R - tire_r - 0.012, rim_w * 0.5,
                      location=(offset_x, 0, 0), rotation=(0, math.radians(90), 0),
                      major_seg=48, minor_seg=10)
    shade_smooth(rim_outer)
    assign(rim_outer, mats['rim'])
    g.append(rim_outer)

    rim_inner = torus(f'{name}_rim2', R - tire_r - 0.026, rim_w * 0.30,
                      location=(offset_x, 0, 0), rotation=(0, math.radians(90), 0),
                      major_seg=44, minor_seg=8)
    shade_smooth(rim_inner)
    assign(rim_inner, mats['rimDark'])
    g.append(rim_inner)

    # 花鼓
    hub = cylinder(f'{name}_hub', hub_w * 0.26, hub_w,
                   location=(offset_x, 0, 0), rotation=(0, math.radians(90), 0),
                   verts=20)
    shade_smooth(hub)
    assign(hub, mats['metal'])
    g.append(hub)

    flange = torus(f'{name}_hubFlange', hub_w * 0.30, 0.007,
                   location=(offset_x, 0, 0), rotation=(0, math.radians(90), 0),
                   major_seg=20, minor_seg=8)
    shade_smooth(flange)
    assign(flange, mats['metal'])
    g.append(flange)

    # 交叉辐条（真实编法：左右交错，不是放射状）
    r0 = hub_w * 0.30
    r1 = R - tire_r - 0.024
    for i in range(spokes):
        for side_sign in (-1, 1):
            a0 = 2 * math.pi * i / spokes
            a1 = a0 + (math.pi / spokes) * side_sign * 1.6
            p0 = Vector((offset_x + side_sign * hub_w * 0.16,
                         math.sin(a0) * r0, math.cos(a0) * r0))
            p1 = Vector((offset_x + side_sign * 0.004,
                         math.sin(a1) * r1, math.cos(a1) * r1))
            sp = tube(p0, p1, 0.0028, 0.0020, sections=5,
                      name=f'{name}_sp{i}_{side_sign}', mat=mats['spoke'])
            if sp:
                g.append(sp)

    # 气门嘴
    valve = cylinder(f'{name}_valve', 0.0055, 0.030,
                     location=(offset_x, 0, R - tire_r - 0.030),
                     verts=10)
    assign(valve, mats['metal'])
    g.append(valve)

    return join_objects(g, name)


def build_bike(pal):
    """pal: {frame, frameDark, accent, rim, metal, seat, tire}"""
    reset_scene()

    M = {
        'frame': pbr('BikeFrame', pal['frame'], roughness=0.22, metallic=0.05, clearcoat=0.85),
        'frameDark': pbr('BikeFrameDark', pal['frameDark'], roughness=0.26,
                         metallic=0.05, clearcoat=0.75),
        'accent': pbr('BikeAccent', pal['accent'], roughness=0.34, clearcoat=0.55),
        'metal': pbr('BikeMetal', pal['metal'], roughness=0.24, metallic=1.0),
        'metalDark': pbr('BikeMetalDark', (0.20, 0.22, 0.26, 1), roughness=0.38, metallic=0.9),
        'rim': pbr('BikeRim', pal['rim'], roughness=0.20, metallic=0.92),
        'rimDark': pbr('BikeRimDark', (0.24, 0.26, 0.30, 1), roughness=0.30, metallic=0.85),
        'tire': pbr('BikeTire', (0.055, 0.058, 0.070, 1), roughness=0.72),
        'tread': pbr('BikeTread', (0.038, 0.040, 0.050, 1), roughness=0.80),
        'seat': pbr('BikeSeat', pal['seat'], roughness=0.42, sheen=0.30),
        'spoke': pbr('BikeSpoke', (0.72, 0.75, 0.80, 1), roughness=0.22, metallic=1.0),
        'rubber': pbr('BikeRubber', (0.10, 0.11, 0.13, 1), roughness=0.68),
    }

    parts = {}

    # ══════════════════════════════════════════════════════════
    #  车轮
    # ══════════════════════════════════════════════════════════
    wheels = []
    for name, ax in (('wheelRear', AX_R), ('wheelFront', AX_F)):
        w = wheel(name, R_WHEEL, 0.036, M, spokes=22, hub_w=0.090)
        w.location = ax
        wheels.append(w)

    # ══════════════════════════════════════════════════════════
    #  车架：菱形，椭圆管
    # ══════════════════════════════════════════════════════════
    frame_parts = []

    # 下管（中轴 → 头管底）：最粗
    frame_parts.append(tube(BB, HEAD_BOT, 0.026, 0.030, 16, 'downTube', M['frame']))
    # 上管（座管顶 → 头管顶）
    frame_parts.append(tube(SEAT_TOP + Vector((0, -0.010, -0.008)), HEAD_TOP,
                            0.019, 0.024, 14, 'topTube', M['frame']))
    # 立管（中轴 → 座管顶）
    frame_parts.append(tube(BB, SEAT_TOP, 0.021, 0.024, 14, 'seatTube', M['frame']))
    # 头管
    frame_parts.append(tube(HEAD_BOT, HEAD_TOP + Vector((0, -0.004, 0.020)),
                            0.027, 0.028, 16, 'headTube', M['frameDark']))

    # 后三角：后下叉 + 后上叉（两侧，细）
    for s in (-1, 1):
        frame_parts.append(tube(BB + Vector((s * 0.032, 0, 0)),
                                AX_R + Vector((s * 0.052, 0, 0)),
                                0.012, 0.016, 10, f'chainStay{s}', M['frame']))
        frame_parts.append(tube(SEAT_TOP + Vector((s * 0.020, -0.006, -0.030)),
                                AX_R + Vector((s * 0.052, 0, 0)),
                                0.010, 0.014, 10, f'seatStay{s}', M['frame']))

    # 前叉：两片刀型叉腿
    for s in (-1, 1):
        fork = tube(HEAD_BOT + Vector((s * 0.026, 0.010, -0.010)),
                    AX_F + Vector((s * 0.050, 0, 0.004)),
                    0.0115, 0.020, 12, f'fork{s}', M['frameDark'])
        frame_parts.append(fork)

    # 五通（中轴壳）
    bb_shell = cylinder('bbShell', 0.036, 0.086, location=BB,
                        rotation=(0, math.radians(90), 0), verts=22)
    shade_smooth(bb_shell)
    assign(bb_shell, M['frameDark'])
    frame_parts.append(bb_shell)

    # 座杆（连接座管顶与座垫）
    seatpost = tube(SEAT_TOP, Vector((0, 0.150, 0.930)),
                    0.0150, 0.0150, 12, 'seatpost', M['metal'])
    frame_parts.append(seatpost)

    # 座管束
    collar = cylinder('seatCollar', 0.028, 0.024,
                      location=SEAT_TOP + Vector((0, 0.004, 0.012)),
                      rotation=(0, math.radians(-12), 0), verts=18)
    shade_smooth(collar)
    assign(collar, M['metal'])
    frame_parts.append(collar)

    frame_node = join_objects(frame_parts, 'frame')

    # ══════════════════════════════════════════════════════════
    #  座垫（有座弓、鼻头窄尾宽）
    # ══════════════════════════════════════════════════════════
    seat_stations = []
    for i in range(11):
        t = i / 10
        y = -0.100 + t * 0.230      # 鼻尖朝前
        # 宽度：前窄后宽
        w = 0.022 + 0.070 * (t ** 1.7)
        # 厚度
        h = 0.014 + 0.012 * math.sin(math.pi * t ** 0.8)
        # 中脊（人体工学凹槽）
        seat_stations.append((Vector((0, y, 0.945 + 0.008 * math.sin(math.pi * t))),
                              w, h))
    seat_mesh, seat_rings, _ = loft_spine('seat', seat_stations, sides=18)
    cap_spine(seat_mesh, seat_rings)
    shade_smooth(seat_mesh, 52)
    add_subsurf(seat_mesh, 1)
    apply_modifiers(seat_mesh)
    shade_smooth(seat_mesh, 52)
    assign(seat_mesh, M['seat'])

    # 座弓
    rail_parts = []
    for s in (-1, 1):
        rail_parts.append(tube(Vector((s * 0.028, -0.058, 0.918)),
                               Vector((s * 0.026, 0.058, 0.934)),
                               0.0045, sections=8, mat=M['metal'], name=f'rail{s}'))
    rail_parts.append(tube(Vector((0, -0.055, 0.918)), Vector((0, 0.062, 0.930)),
                           0.0055, sections=8, mat=M['metal'], name='railJoin'))
    rails = join_objects([r for r in rail_parts if r], 'seatRails')

    # ══════════════════════════════════════════════════════════
    #  车把：把立 + 横把 + 把套 + 刹把
    # ══════════════════════════════════════════════════════════
    bar_parts = []

    # 把立
    stem = tube(HEAD_TOP + Vector((0, -0.004, 0.018)),
                BAR_C + Vector((0, 0.006, -0.004)),
                0.017, 0.019, 12, 'stem', M['metal'])
    bar_parts.append(stem)

    # 横把（中间粗、两端细的平把）
    bar_stations = []
    for i in range(13):
        t = i / 12
        x = (t - 0.5) * 0.400
        r = 0.0115 + 0.0025 * math.cos(math.pi * (t - 0.5) * 2)
        bar_stations.append((BAR_C + Vector((x, 0, 0)), r, r * 0.96))
    hbar, hbar_rings, _ = loft_spine('handlebar', bar_stations, sides=14)
    cap_spine(hbar, hbar_rings)
    shade_smooth(hbar, 50)
    assign(hbar, M['metal'])
    bar_parts.append(hbar)

    # 把套（有防滑纹）+ 把塞
    for s in (-1, 1):
        grip_c = BAR_C + Vector((s * 0.168, 0, 0))
        grip = cylinder(f'grip{s}', 0.0165, 0.098,
                        location=grip_c, rotation=(0, math.radians(90), 0), verts=20)
        shade_smooth(grip)
        assign(grip, M['rubber'])
        bar_parts.append(grip)

        # 防滑环
        for k in range(4):
            gr = torus(f'gripRing{s}_{k}', 0.0170, 0.0022,
                       location=grip_c + Vector(((k - 1.5) * 0.022, 0, 0)),
                       rotation=(0, math.radians(90), 0),
                       major_seg=18, minor_seg=6)
            shade_smooth(gr)
            assign(gr, M['accent'])
            bar_parts.append(gr)

        plug = cylinder(f'gripPlug{s}', 0.0168, 0.008,
                        location=grip_c + Vector((s * 0.052, 0, 0)),
                        rotation=(0, math.radians(90), 0), verts=18)
        assign(plug, M['accent'])
        bar_parts.append(plug)

        # 刹把（从把套内侧向前弯出）
        lever_pts = [
            grip_c + Vector((-s * 0.020, -0.010, -0.002)),
            grip_c + Vector((-s * 0.010, -0.052, -0.010)),
            grip_c + Vector((-s * 0.002, -0.078, -0.014)),
        ]
        lever = tube(lever_pts[0], lever_pts[1], 0.0072, 0.0050,
                     sections=10, name=f'lever{s}', mat=M['metalDark'])
        bar_parts.append(lever)
        lever2 = tube(lever_pts[1], lever_pts[2], 0.0050, 0.0038,
                      sections=8, name=f'leverTip{s}', mat=M['metalDark'])
        bar_parts.append(lever2)

        # 变速指拨（小方块）
        shifter = rounded_box(f'shifter{s}', (0.026, 0.030, 0.022), 0.006,
                              location=grip_c + Vector((-s * 0.058, 0.006, 0.008)))
        assign(shifter, M['frameDark'])
        bar_parts.append(shifter)

    bar_node = join_objects([p for p in bar_parts if p], 'handlebar')

    # ══════════════════════════════════════════════════════════
    #  传动：牙盘 + 曲柄 + 踏板 + 链条 + 飞轮
    # ══════════════════════════════════════════════════════════
    drivetrain = []

    # 牙盘（有齿）
    chainring_r = 0.088
    cr = cylinder('chainring', chainring_r, 0.006,
                  location=BB + Vector((0.046, 0, 0)),
                  rotation=(0, math.radians(90), 0), verts=40)
    shade_smooth(cr)
    assign(cr, M['metalDark'])
    drivetrain.append(cr)

    # 齿
    for i in range(36):
        a = 2 * math.pi * i / 36
        tooth = rounded_box(f'tooth{i}', (0.0045, 0.011, 0.009), 0.0016,
                            location=BB + Vector((0.046,
                                                  math.sin(a) * chainring_r,
                                                  math.cos(a) * chainring_r)))
        tooth.rotation_euler = (-a, 0, 0)
        bpy.context.view_layer.objects.active = tooth
        tooth.select_set(True)
        bpy.ops.object.transform_apply(rotation=True)
        tooth.select_set(False)
        assign(tooth, M['metal'])
        drivetrain.append(tooth)

    # 曲柄（两侧，左右错开 180°）
    for s, phase in ((-1, 0.0), (1, math.pi)):
        crank_len = 0.150
        end = BB + Vector((s * 0.075,
                           math.sin(phase) * crank_len,
                           math.cos(phase) * crank_len))
        arm = tube(BB + Vector((s * 0.062, 0, 0)), end, 0.0105, 0.0145,
                   sections=12, name=f'crank{s}', mat=M['metalDark'])
        drivetrain.append(arm)

        # 踏板
        pedal = rounded_box(f'pedal{s}', (0.055, 0.085, 0.014), 0.006,
                            location=end + Vector((s * 0.020, 0, 0)))
        assign(pedal, M['rubber'])
        drivetrain.append(pedal)

        # 踏板轴
        paxle = cylinder(f'pedalAxle{s}', 0.0050, 0.046,
                         location=end + Vector((s * 0.010, 0, 0)),
                         rotation=(0, math.radians(90), 0), verts=10)
        assign(paxle, M['metal'])
        drivetrain.append(paxle)

        # 反光片
        refl = rounded_box(f'refl{s}', (0.004, 0.030, 0.020), 0.003,
                           location=end + Vector((s * 0.048, -0.020, 0)))
        assign(refl, pbr('BikeReflector', (1.0, 0.42, 0.08, 1), roughness=0.18,
                         emission=(1.0, 0.42, 0.08), emission_strength=0.35))
        drivetrain.append(refl)

    # 飞轮
    cassette_r = 0.048
    cas = cylinder('cassette', cassette_r, 0.038,
                   location=AX_R + Vector((0.030, 0, 0)),
                   rotation=(0, math.radians(90), 0), verts=28)
    shade_smooth(cas)
    assign(cas, M['metalDark'])
    drivetrain.append(cas)

    # 链条（上下两段，有链节）
    for (za, zb, ya, yb) in (
        (BB.z + chainring_r, AX_R.z + cassette_r, 0.0, 0.0),
        (BB.z - chainring_r, AX_R.z - cassette_r, 0.0, 0.0),
    ):
        p0 = Vector((0.050, BB.y, za))
        p1 = Vector((0.048, AX_R.y, zb))
        chain = tube(p0, p1, 0.0035, 0.0055, sections=7,
                     name=f'chain_{za:.2f}', mat=M['metalDark'])
        drivetrain.append(chain)

    # 后拨
    rd = rounded_box('rearDerailleur', (0.026, 0.040, 0.062), 0.008,
                     location=AX_R + Vector((0.056, 0.020, -0.046)),
                     rotation=(0, 0, math.radians(-10)))
    assign(rd, M['metalDark'])
    drivetrain.append(rd)

    drivetrain_node = join_objects([d for d in drivetrain if d], 'drivetrain')

    # ══════════════════════════════════════════════════════════
    #  车筐（前，学习感）＋ 车灯
    # ══════════════════════════════════════════════════════════
    basket_parts = []

    # 车筐做成铁丝篮：横向 6 圈 + 竖向 14 根 + 底板
    BK_C = Vector((0, -0.498, 0.828))
    BK_W, BK_D, BK_H = 0.106, 0.072, 0.062
    wire_r = 0.0042

    # 横箍（6 层，顶层粗一点做口沿）
    for lvl in range(6):
        t = lvl / 5
        z = BK_C.z - BK_H + t * BK_H * 2
        # 上宽下窄（篮子的锥度）
        k = 0.86 + 0.14 * t
        pts = []
        N = 24
        for i in range(N):
            a = 2 * math.pi * i / N
            # 圆角矩形截面
            ex = max(abs(math.cos(a)), 1e-6)
            ey = max(abs(math.sin(a)), 1e-6)
            px = math.copysign(min(BK_W * k, BK_W * k / ex) * 0.98, math.cos(a))
            py = math.copysign(min(BK_D * k, BK_D * k / ey) * 0.98, math.sin(a))
            pts.append(BK_C + Vector((px, py, 0)) + Vector((0, 0, z - BK_C.z)))
        ring = tube_along(f'bkHoop{lvl}', pts + [pts[0]],
                          [wire_r * (1.25 if lvl == 5 else 1.0)] * (N + 1),
                          sections=6, cap=False)
        if ring:
            shade_smooth(ring)
            assign(ring, M['metal'])
            basket_parts.append(ring)

    # 竖筋
    for i in range(14):
        a = 2 * math.pi * i / 14
        ex = max(abs(math.cos(a)), 1e-6)
        ey = max(abs(math.sin(a)), 1e-6)
        px0 = math.copysign(min(BK_W * 0.86, BK_W * 0.86 / ex) * 0.98, math.cos(a))
        py0 = math.copysign(min(BK_D * 0.86, BK_D * 0.86 / ey) * 0.98, math.sin(a))
        px1 = math.copysign(min(BK_W * 1.00, BK_W * 1.00 / ex) * 0.98, math.cos(a))
        py1 = math.copysign(min(BK_D * 1.00, BK_D * 1.00 / ey) * 0.98, math.sin(a))
        v = tube(BK_C + Vector((px0, py0, -BK_H)),
                 BK_C + Vector((px1, py1, BK_H)),
                 wire_r * 0.85, sections=6, name=f'bkV{i}', mat=M['metal'])
        if v:
            basket_parts.append(v)

    # 底板
    floor = rounded_box('bkFloor', (BK_W * 1.9, BK_D * 1.9, 0.010), 0.004,
                        location=BK_C + Vector((0, 0, -BK_H)))
    assign(floor, M['metalDark'])
    basket_parts.append(floor)

    # 筐内：两本书（斜放）
    for i, (w, h, d, col, rx, ry) in enumerate([
        (0.150, 0.022, 0.104, (0.88, 0.26, 0.24, 1), 0.10, 0.06),
        (0.138, 0.026, 0.096, (0.18, 0.38, 0.70, 1), -0.06, -0.10),
    ]):
        book = rounded_box(f'book{i}', (w, d, h), 0.004,
                           location=BK_C + Vector((0.006 * i, 0.004 * i,
                                                   -BK_H + 0.030 + i * 0.030)),
                           rotation=(math.radians(rx), math.radians(ry), 0))
        assign(book, pbr(f'BikeBook{i}', col, roughness=0.70, sheen=0.25))
        basket_parts.append(book)

    # 筐支架（从筐底连到头管）
    basket_parts.append(tube(BK_C + Vector((0, 0.010, -BK_H - 0.004)),
                             HEAD_TOP + Vector((0, -0.020, 0.006)),
                             0.0060, sections=8, mat=M['metal'],
                             name='basketStay'))

    basket_node = join_objects(basket_parts, 'basket')

    # 车灯
    lamp_body = cylinder('lampBody', 0.026, 0.038,
                         location=Vector((0, -0.520, 0.720)),
                         rotation=(math.radians(90), 0, 0), verts=20)
    shade_smooth(lamp_body)
    assign(lamp_body, M['metalDark'])
    lamp_lens = cylinder('lampLens', 0.0235, 0.008,
                         location=Vector((0, -0.540, 0.720)),
                         rotation=(math.radians(90), 0, 0), verts=20)
    assign(lamp_lens, pbr('BikeLampLens', (1.0, 0.96, 0.82, 1), roughness=0.06,
                          emission=(1.0, 0.94, 0.76), emission_strength=1.4,
                          transmission=0.6))
    lamp = join_objects([lamp_body, lamp_lens], 'lamp')

    # 挡泥板
    fenders = []
    for nm, ax, a0, a1 in (('fenderRear', AX_R, 0.55, 2.55), ('fenderFront', AX_F, -2.55, -0.55)):
        rings = []
        r_in = R_WHEEL + 0.014
        for i in range(13):
            t = i / 12
            a = a0 + (a1 - a0) * t
            ring = []
            for k in range(9):
                ang = -0.55 + (k / 8) * 1.10
                rr = r_in - 0.004 * math.sin(math.pi * (k / 8))
                ring.append(Vector((
                    ax.x + math.sin(ang) * 0.055,
                    ax.y - math.sin(a) * rr,
                    ax.z + math.cos(a) * rr,
                )))
            rings.append(ring)
        f = loft(nm, rings, close_caps=True)
        add_solidify(f, 0.005, 0.0)
        apply_modifiers(f)
        shade_smooth(f, 46)
        assign(f, M['frameDark'])
        fenders.append(f)
    fenders_node = join_objects(fenders, 'fenders')

    # ══════════════════════════════════════════════════════════
    #  层级：整车 root
    # ══════════════════════════════════════════════════════════
    root = bpy.data.objects.new('bike', None)
    root.empty_display_type = 'PLAIN_AXES'
    bpy.context.scene.collection.objects.link(root)
    bpy.context.view_layer.update()

    def attach(child, parent, pivot):
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

    # 车轮挂在 root，原点放在轮轴（便于旋转）
    for w, ax in zip(wheels, (AX_R, AX_F)):
        attach(w, root, ax)
        w.name = 'wheelRear' if ax is AX_R else 'wheelFront'

    # 曲柄组（绕中轴旋转）
    drivetrain_node.name = 'drivetrain'
    attach(drivetrain_node, root, BB)

    # 车架 / 座垫 / 车把 / 筐 / 灯 / 挡泥板 → root（静态）
    for ob, nm in ((frame_node, 'frame'), (seat_mesh, 'seat'), (rails, 'seatRails'),
                   (bar_node, 'handlebar'), (basket_node, 'basket'),
                   (lamp, 'lamp'), (fenders_node, 'fenders')):
        attach(ob, root, Vector((0, 0, 0)))
        ob.name = nm

    node_names = ['wheelRear', 'wheelFront', 'drivetrain', 'frame', 'seat',
                  'handlebar', 'basket', 'lamp']
    print(f'\n  三角面数：{tri_count():,}')
    return root, [root] + [bpy.data.objects[n] for n in node_names if n in bpy.data.objects]


if __name__ == '__main__':
    args = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    out = args[0] if args else None
    pal = {
        'frame': (0.055, 0.615, 0.596, 1),
        'frameDark': (0.030, 0.430, 0.420, 1),
        'accent': (1.000, 0.708, 0.278, 1),
        'rim': (0.760, 0.790, 0.830, 1),
        'metal': (0.620, 0.650, 0.700, 1),
        'seat': (0.075, 0.088, 0.115, 1),
    }
    root, objs = build_bike(pal)
    if out:
        export_glb(out, objs)
