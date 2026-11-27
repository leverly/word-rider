"""
滑板车：铝制大轮休闲车（kick scooter），与自行车同管线。

结构
  deck 甲板（有防滑砂纸面、侧边铝型材）
  stem 立管 + 折叠扣 + 车把 + 把套
  wheelFront / wheelRear（大轮，充气胎）
  刹车（后轮脚刹片）
  bell 车铃
  小旗（辨识度）
"""
import bpy
import bmesh
import math
import sys
import os
from mathutils import Vector, Euler, Matrix

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from lib_mesh import *   # noqa
from bike import tube, wheel, R_WHEEL


def build_scooter(pal):
    reset_scene()

    M = {
        'frame': pbr('ScootFrame', pal['frame'], roughness=0.24, metallic=0.72, clearcoat=0.55),
        'frameDark': pbr('ScootFrameDark', pal['frameDark'], roughness=0.30, metallic=0.70),
        'accent': pbr('ScootAccent', pal['accent'], roughness=0.36, clearcoat=0.50),
        'metal': pbr('ScootMetal', pal['metal'], roughness=0.20, metallic=1.0),
        'metalDark': pbr('ScootMetalDark', (0.19, 0.21, 0.25, 1), roughness=0.36, metallic=0.9),
        'rim': pbr('ScootRim', pal['rim'], roughness=0.18, metallic=0.92),
        'rimDark': pbr('ScootRimDark', (0.22, 0.24, 0.28, 1), roughness=0.28, metallic=0.85),
        'tire': pbr('ScootTire', (0.055, 0.058, 0.070, 1), roughness=0.72),
        'tread': pbr('ScootTread', (0.038, 0.040, 0.050, 1), roughness=0.80),
        'deck': pbr('ScootDeck', pal['seat'], roughness=0.52, sheen=0.20),
        'grip': pbr('ScootGrip', (0.075, 0.080, 0.092, 1), roughness=0.86),
        'spoke': pbr('ScootSpoke', (0.72, 0.75, 0.80, 1), roughness=0.22, metallic=1.0),
        'rubber': pbr('ScootRubber', (0.10, 0.11, 0.13, 1), roughness=0.68),
    }

    R_F = 0.155
    R_R = 0.155
    FRONT_Y = -0.400
    REAR_Y = 0.400
    DECK_Y0 = -0.310
    DECK_Y1 = 0.330
    DECK_Z = 0.105

    # ══════════════════════════════════════════════════════════
    #  车轮
    # ══════════════════════════════════════════════════════════
    wheels = []
    for nm, y, r in (('wheelFront', FRONT_Y, R_F), ('wheelRear', REAR_Y, R_R)):
        w = wheel(nm, r, 0.030, M, spokes=14, hub_w=0.062, tread=True)
        w.location = Vector((0, y, r))
        wheels.append(w)

    # ══════════════════════════════════════════════════════════
    #  甲板：斜面铝型材 + 防滑砂纸
    # ══════════════════════════════════════════════════════════
    deck_parts = []

    # 甲板主体（前低后高，两端上翘）
    st = []
    N = 12
    for i in range(N + 1):
        t = i / N
        y = DECK_Y0 + (DECK_Y1 - DECK_Y0) * t
        # 两端翘起
        lift = 0.026 * max(0, (abs(t - 0.5) * 2 - 0.66) / 0.34) ** 1.6
        w = 0.098 - 0.014 * max(0, (abs(t - 0.5) * 2 - 0.7) / 0.3)
        st.append((Vector((0, y, DECK_Z + lift)), w, 0.014))
    deck, dr, _ = loft_spine('deck', st, sides=16)
    cap_spine(deck, dr)
    shade_smooth(deck, 44)
    add_subsurf(deck, 1)
    apply_modifiers(deck)
    shade_smooth(deck, 44)
    assign(deck, M['deck'])
    deck_parts.append(deck)

    # 侧边铝型材（两条）
    for s in (-1, 1):
        rail = rounded_box(f'deckRail{s}', (0.012, (DECK_Y1 - DECK_Y0) * 0.94, 0.016),
                           0.004, location=Vector((s * 0.094, (DECK_Y0 + DECK_Y1) / 2,
                                                  DECK_Z + 0.004)))
        assign(rail, M['metal'])
        deck_parts.append(rail)

    # 防滑砂纸（顶面一片，稍窄）
    grip = rounded_box('deckGrip', (0.158, (DECK_Y1 - DECK_Y0) * 0.82, 0.0035), 0.002,
                       location=Vector((0, (DECK_Y0 + DECK_Y1) / 2, DECK_Z + 0.0165)))
    assign(grip, M['grip'])
    deck_parts.append(grip)

    # 砂纸上的菱形纹（少量，避免太多面）
    for i in range(9):
        t = (i + 0.5) / 9
        y = DECK_Y0 + (DECK_Y1 - DECK_Y0) * (0.10 + t * 0.80)
        for s in (-1, 1):
            d = rounded_box(f'gripD{i}{s}', (0.024, 0.024, 0.0016), 0.0006,
                            location=Vector((s * 0.036, y, DECK_Z + 0.0188)),
                            rotation=(0, 0, math.radians(45)))
            assign(d, M['deck'])
            deck_parts.append(d)

    # 尾部刹车片（脚踩）
    brake = rounded_box('footBrake', (0.078, 0.070, 0.010), 0.004,
                        location=Vector((0, DECK_Y1 + 0.010, DECK_Z - 0.010)),
                        rotation=(math.radians(12), 0, 0))
    assign(brake, M['metalDark'])
    deck_parts.append(brake)

    deck_node = join_objects(deck_parts, 'deck')

    # ══════════════════════════════════════════════════════════
    #  立管 + 车把
    # ══════════════════════════════════════════════════════════
    stem_parts = []
    STEM_BOT = Vector((0, DECK_Y0 + 0.030, DECK_Z + 0.010))
    STEM_TOP = Vector((0, DECK_Y0 + 0.058, 1.040))

    # 立管（下粗上细）
    stem = tube(STEM_BOT, STEM_TOP, 0.0245, 0.0225, 20, 'stem', M['frame'])
    stem_parts.append(stem)

    # 折叠扣（两片夹 + 快拆杆）
    fold = rounded_box('foldClamp', (0.062, 0.070, 0.052), 0.008,
                       location=STEM_BOT + Vector((0, -0.006, 0.058)))
    assign(fold, M['frameDark'])
    stem_parts.append(fold)

    qr = cylinder('foldQR', 0.0075, 0.088,
                  location=STEM_BOT + Vector((0, -0.006, 0.058)),
                  rotation=(0, math.radians(90), 0), verts=12)
    assign(qr, M['metal'])
    stem_parts.append(qr)

    # 车把横管：一整根穿过把立，中心略粗
    BAR_C = STEM_TOP + Vector((0, 0.002, 0.010))
    hbar = tube(BAR_C + Vector((-0.215, 0, 0)), BAR_C + Vector((0.215, 0, 0)),
                0.0128, 0.0122, sections=16, name='scootBar', mat=M['metal'])
    stem_parts.append(hbar)

    # 把立顶盖 / 车把夹
    bar_clamp = rounded_box('barClamp', (0.070, 0.052, 0.038), 0.008,
                            location=BAR_C + Vector((0, 0.006, -0.006)))
    assign(bar_clamp, M['frameDark'])
    stem_parts.append(bar_clamp)

    # 把套
    for s in (-1, 1):
        gc = BAR_C + Vector((s * 0.180, 0, 0))
        g = cylinder(f'grip{s}', 0.0170, 0.104,
                     location=gc, rotation=(0, math.radians(90), 0), verts=20)
        shade_smooth(g)
        assign(g, M['rubber'])
        stem_parts.append(g)

        for k in range(4):
            gr = torus(f'gripRing{s}_{k}', 0.0176, 0.0022,
                       location=gc + Vector(((k - 1.5) * 0.024, 0, 0)),
                       rotation=(0, math.radians(90), 0), major_seg=18, minor_seg=6)
            shade_smooth(gr)
            assign(gr, M['accent'])
            stem_parts.append(gr)

        plug = cylinder(f'plug{s}', 0.0172, 0.008,
                        location=gc + Vector((s * 0.056, 0, 0)),
                        rotation=(0, math.radians(90), 0), verts=18)
        assign(plug, M['accent'])
        stem_parts.append(plug)

        # 刹车手柄
        lv = tube(gc + Vector((-s * 0.026, -0.008, 0)),
                  gc + Vector((-s * 0.014, -0.062, -0.012)),
                  0.0072, 0.0048, sections=10, name=f'lever{s}', mat=M['metalDark'])
        stem_parts.append(lv)

    # 车铃
    bell_base = BAR_C + Vector((-0.098, 0.014, 0.012))
    bell = sphere('bell', bell_base + Vector((0, 0, 0.014)), 0.0215,
                  seg=20, rings=14, scale=(1, 1, 0.62))
    assign(bell, M['metal'])
    stem_parts.append(bell)
    bell_clamp = cylinder('bellClamp', 0.0145, 0.016, location=bell_base,
                          rotation=(0, math.radians(90), 0), verts=14)
    assign(bell_clamp, M['metalDark'])
    stem_parts.append(bell_clamp)

    # 前灯（挂在立管上）
    lamp_h = cylinder('scootLamp', 0.024, 0.034,
                      location=STEM_BOT + Vector((0, -0.034, 0.500)),
                      rotation=(math.radians(90), 0, 0), verts=18)
    shade_smooth(lamp_h)
    assign(lamp_h, M['metalDark'])
    stem_parts.append(lamp_h)
    lens = cylinder('scootLens', 0.0215, 0.006,
                    location=STEM_BOT + Vector((0, -0.054, 0.500)),
                    rotation=(math.radians(90), 0, 0), verts=18)
    assign(lens, pbr('ScootLampLens', (1.0, 0.96, 0.82, 1), roughness=0.06,
                     emission=(1.0, 0.94, 0.76), emission_strength=1.5,
                     transmission=0.6))
    stem_parts.append(lens)

    stem_node = join_objects(stem_parts, 'stem')

    # ══════════════════════════════════════════════════════════
    #  前叉（连接立管与前轮）
    # ══════════════════════════════════════════════════════════
    fork_parts = []
    for s in (-1, 1):
        fk = tube(STEM_BOT + Vector((s * 0.020, -0.008, -0.006)),
                  Vector((s * 0.042, FRONT_Y, R_F)),
                  0.0105, 0.0165, 12, f'fork{s}', M['frameDark'])
        fork_parts.append(fk)
    crown = rounded_box('forkCrown', (0.086, 0.040, 0.032), 0.008,
                        location=STEM_BOT + Vector((0, -0.006, -0.020)))
    assign(crown, M['frameDark'])
    fork_parts.append(crown)

    # 后叉（甲板后端 → 后轮）
    for s in (-1, 1):
        fk = tube(Vector((s * 0.078, DECK_Y1 - 0.020, DECK_Z - 0.006)),
                  Vector((s * 0.046, REAR_Y, R_R)),
                  0.0095, 0.0145, 12, f'rearFork{s}', M['frameDark'])
        fork_parts.append(fk)

    # 后挡泥板
    fr = []
    r_in = R_R + 0.012
    for i in range(11):
        t = i / 10
        a = -2.45 + t * 2.10
        ring = []
        for k in range(9):
            ang = -0.50 + (k / 8) * 1.00
            rr = r_in - 0.003 * math.sin(math.pi * (k / 8))
            ring.append(Vector((math.sin(ang) * 0.048,
                                REAR_Y - math.sin(a) * rr,
                                R_R + math.cos(a) * rr)))
        fr.append(ring)
    fender = loft('scootFender', fr, close_caps=True)
    add_solidify(fender, 0.0045, 0.0)
    apply_modifiers(fender)
    shade_smooth(fender, 46)
    assign(fender, M['frameDark'])
    fork_parts.append(fender)

    fork_node = join_objects([f for f in fork_parts if f], 'fork')

    # ══════════════════════════════════════════════════════════
    #  层级
    # ══════════════════════════════════════════════════════════
    root = bpy.data.objects.new('scooter', None)
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

    for w, y in zip(wheels, (FRONT_Y, REAR_Y)):
        attach(w, root, Vector((0, y, R_F if y == FRONT_Y else R_R)))

    for ob, nm in ((deck_node, 'deck'), (stem_node, 'stem'),
                   (fork_node, 'fork')):
        attach(ob, root, Vector((0, 0, 0)))
        ob.name = nm

    print(f'\n  三角面数：{tri_count():,}')
    return root, [root] + [bpy.data.objects[n] for n in
                           ('wheelFront', 'wheelRear', 'deck', 'stem', 'fork')
                           if n in bpy.data.objects]


if __name__ == '__main__':
    args = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    out = args[0] if args else None
    pal = {
        'frame': (0.105, 0.155, 0.255, 1),
        'frameDark': (0.070, 0.105, 0.180, 1),
        'accent': (1.000, 0.470, 0.230, 1),
        'rim': (0.760, 0.790, 0.830, 1),
        'metal': (0.640, 0.670, 0.720, 1),
        'seat': (0.130, 0.150, 0.190, 1),
    }
    root, objs = build_scooter(pal)
    if out:
        export_glb(out, objs)
