"""
资产预览：正交四视图 + 透视英雄图，用于精确校准比例。
用法：blender -b --python preview.py -- <glb> <outprefix> [views]
views: ortho | hero | all
"""
import bpy
import sys
import math
from mathutils import Vector

argv = sys.argv
argv = argv[argv.index('--') + 1:] if '--' in argv else []
SRC, PREFIX = argv[0], argv[1]
MODE = argv[2] if len(argv) > 2 else 'all'

bpy.ops.wm.read_factory_settings(use_empty=True)
sc = bpy.context.scene
sc.render.engine = 'CYCLES'
sc.cycles.device = 'CPU'
sc.cycles.samples = 64
sc.cycles.use_denoising = True
sc.render.film_transparent = False
sc.view_settings.view_transform = 'AgX'
sc.view_settings.look = 'AgX - Punchy'

bpy.ops.import_scene.gltf(filepath=SRC)

mn = Vector((1e9, 1e9, 1e9))
mx = Vector((-1e9, -1e9, -1e9))
for ob in bpy.context.scene.objects:
    if ob.type != 'MESH':
        continue
    for c in ob.bound_box:
        w = ob.matrix_world @ Vector(c)
        for i in range(3):
            mn[i] = min(mn[i], w[i])
            mx[i] = max(mx[i], w[i])
center = (mn + mx) * 0.5
sz = mx - mn
S = max(sz.x, sz.y, sz.z)
print(f'BBOX mn={tuple(round(v,3) for v in mn)} mx={tuple(round(v,3) for v in mx)} size={S:.3f}')

world = bpy.data.worlds.new('W')
sc.world = world
world.use_nodes = True
nt = world.node_tree
nt.nodes.clear()
bg = nt.nodes.new('ShaderNodeBackground')
bg.inputs['Color'].default_value = (0.45, 0.47, 0.52, 1)
bg.inputs['Strength'].default_value = 0.9
wnode = nt.nodes.new('ShaderNodeOutputWorld')
nt.links.new(bg.outputs['Background'], wnode.inputs['Surface'])


def area(name, loc, energy, size_, track_to):
    d = bpy.data.lights.new(name, 'AREA')
    d.energy = energy
    d.size = size_
    o = bpy.data.objects.new(name, d)
    o.location = loc
    sc.collection.objects.link(o)
    direction = Vector(track_to) - Vector(loc)
    o.rotation_euler = direction.to_track_quat('-Z', 'Y').to_euler()
    return o


area('key', (center.x - S * 1.2, center.y - S * 1.2, center.z + S * 1.4),
     S * S * 220, S * 1.0, center)
area('fill', (center.x + S * 1.5, center.y - S * 0.9, center.z + S * 0.5),
     S * S * 70, S * 1.4, center)
area('rim', (center.x + S * 0.5, center.y + S * 1.5, center.z + S * 1.2),
     S * S * 160, S * 0.9, center)

# 正交相机
cam_data = bpy.data.cameras.new('ortho')
cam_data.type = 'ORTHO'
cam_data.ortho_scale = S * 1.28
cam = bpy.data.objects.new('ortho', cam_data)
sc.collection.objects.link(cam)
sc.camera = cam
sc.render.resolution_x = 800
sc.render.resolution_y = 800

# 透视相机
pcam_data = bpy.data.cameras.new('persp')
pcam_data.lens = 85
pcam = bpy.data.objects.new('persp', pcam_data)
sc.collection.objects.link(pcam)

VIEWS = {
    # 名字: (位置方向, 是否正交)
    'front': (Vector((0, -1, 0)), True),    # 从 -Y 看（车头方向）
    'side':  (Vector((-1, 0, 0)), True),    # 从 -X 看（左侧）
    'back':  (Vector((0, 1, 0)), True),
    'top':   (Vector((0, 0, 1)), True),
}


def render_ortho(name, dirvec):
    sc.camera = cam
    d = dirvec.normalized()
    up = Vector((0, 0, 1))
    if abs(d.z) > 0.9:
        up = Vector((0, 1, 0))
    cam.location = center + d * S * 4.0
    cam.rotation_euler = (-d).to_track_quat('-Z', 'Y').to_euler()
    sc.render.filepath = f'{PREFIX}_{name}.png'
    bpy.ops.render.render(write_still=True)
    print('  🖼', sc.render.filepath)


def render_persp(name, az, el, dist_mul=2.6):
    sc.camera = pcam
    a = math.radians(az)
    e = math.radians(el)
    dd = S * dist_mul
    pcam.location = Vector((
        center.x + math.sin(a) * math.cos(e) * dd,
        center.y - math.cos(a) * math.cos(e) * dd,
        center.z + math.sin(e) * dd,
    ))
    pcam.rotation_euler = (center - pcam.location).to_track_quat('-Z', 'Y').to_euler()
    sc.render.filepath = f'{PREFIX}_{name}.png'
    bpy.ops.render.render(write_still=True)
    print('  🖼', sc.render.filepath)


if MODE in ('ortho', 'all'):
    for n, (d, _) in VIEWS.items():
        render_ortho(n, d)
if MODE in ('hero', 'all'):
    render_persp('hero', 36, 14, 2.7)
    render_persp('heroClose', 24, 8, 1.9)
