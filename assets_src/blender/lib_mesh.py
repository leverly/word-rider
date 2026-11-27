"""
建模工具库：给 Word Rider 生成商用级 3D 资产。

所有函数只依赖 bpy / bmesh / mathutils，不依赖插件。
坐标约定：Y 轴向前（-Y 是车头方向，与 three.js 的 -Z 对应），Z 轴向上。
导出前统一旋转到 glTF 的 Y-up。
"""
import bpy
import bmesh
import math
import random
from mathutils import Vector, Matrix, Euler, Quaternion


# ══════════════════════════════════════════════════════════════
#  场景 / 对象
# ══════════════════════════════════════════════════════════════

def reset_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    sc.unit_settings.system = 'METRIC'
    sc.unit_settings.scale_length = 1.0
    sc.render.engine = 'CYCLES'
    sc.cycles.device = 'CPU'
    sc.cycles.samples = 48
    return sc


def new_mesh_object(name, verts, faces, collection=None):
    me = bpy.data.meshes.new(name)
    me.from_pydata([tuple(v) for v in verts], [], [tuple(f) for f in faces])
    me.validate(verbose=False)
    me.update()
    ob = bpy.data.objects.new(name, me)
    (collection or bpy.context.scene.collection).objects.link(ob)
    return ob


def join_objects(objs, name=None):
    objs = [o for o in objs if o]
    if not objs:
        return None
    if len(objs) == 1:
        if name:
            objs[0].name = name
        return objs[0]
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.join()
    ob = bpy.context.view_layer.objects.active
    if name:
        ob.name = name
    return ob


def apply_modifiers(ob):
    bpy.context.view_layer.objects.active = ob
    for m in list(ob.modifiers):
        try:
            bpy.ops.object.modifier_apply(modifier=m.name)
        except Exception:
            ob.modifiers.remove(m)


def shade_smooth(ob, angle_deg=48.0):
    me = ob.data
    for p in me.polygons:
        p.use_smooth = True

    # Blender 4.x：按角度加分割，保留硬边
    if hasattr(me, 'use_auto_smooth'):        # <= 4.0
        me.use_auto_smooth = True
        me.auto_smooth_angle = math.radians(angle_deg)
    else:
        try:
            bpy.context.view_layer.objects.active = ob
            bpy.ops.object.shade_smooth_by_angle(angle=math.radians(angle_deg))
        except Exception:
            pass


def add_subsurf(ob, levels=1, render_levels=None):
    m = ob.modifiers.new('Subdivision', 'SUBSURF')
    m.levels = levels
    m.render_levels = render_levels if render_levels is not None else levels
    m.use_limit_surface = False
    return m


def add_bevel(ob, width=0.004, segments=3, angle=40):
    m = ob.modifiers.new('Bevel', 'BEVEL')
    m.width = width
    m.segments = segments
    m.limit_method = 'ANGLE'
    m.angle_limit = math.radians(angle)
    m.harden_normals = False
    return m


def add_solidify(ob, thickness=0.006, offset=0.0):
    m = ob.modifiers.new('Solidify', 'SOLIDIFY')
    m.thickness = thickness
    m.offset = offset
    return m


def add_displace(ob, texture, strength=0.01, mid=0.5):
    m = ob.modifiers.new('Displace', 'DISPLACE')
    m.texture = texture
    m.strength = strength
    m.mid_level = mid
    return m


def smooth_mesh(ob, iterations=2, factor=0.5):
    bpy.context.view_layer.objects.active = ob
    m = ob.modifiers.new('Smooth', 'SMOOTH')
    m.iterations = iterations
    m.factor = factor
    return m


def remove_doubles(ob, dist=0.0004):
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=dist)
    bm.to_mesh(ob.data)
    bm.free()
    ob.data.update()


def set_origin_at_base(ob, base_z=0.0):
    bpy.context.view_layer.objects.active = ob
    ob.select_set(True)
    cur = bpy.context.scene.cursor.location.copy()
    bpy.context.scene.cursor.location = (0, 0, base_z)
    bpy.ops.object.origin_set(type='ORIGIN_CURSOR')
    bpy.context.scene.cursor.location = cur


# ══════════════════════════════════════════════════════════════
#  材质：PBR，名字语义化，便于运行时改色
# ══════════════════════════════════════════════════════════════

_MAT_CACHE = {}


def pbr(name, base=(0.8, 0.8, 0.8, 1.0), roughness=0.5, metallic=0.0,
        emission=None, emission_strength=0.0, alpha=1.0, transmission=0.0,
        subsurface=0.0, subsurface_color=None, sheen=0.0, clearcoat=0.0,
        ior=1.45, specular=0.5):
    """创建（或复用）一个 Principled BSDF 材质，glTF 可直接导出。"""
    key = (name, base, roughness, metallic, tuple(emission) if emission else None,
           emission_strength, alpha, transmission, subsurface, sheen, clearcoat, ior)
    # 场景重置后旧的 Material 会失效，缓存必须按名字重新校验
    if key in _MAT_CACHE:
        cached = _MAT_CACHE[key]
        try:
            if cached.name in bpy.data.materials:
                return cached
        except ReferenceError:
            pass
        _MAT_CACHE.pop(key, None)

    mat = bpy.data.materials.get(name)
    if mat:
        mat.node_tree.nodes.clear() if mat.node_tree else None
    else:
        mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nt = mat.node_tree
    # use_nodes=True 会自动建一对默认节点，必须清掉，否则导出会取默认那个（永远是灰的）
    nt.nodes.clear()
    bsdf = nt.nodes.new('ShaderNodeBsdfPrincipled')
    bsdf.location = (0, 0)
    out = nt.nodes.new('ShaderNodeOutputMaterial')
    out.location = (320, 0)
    nt.links.new(bsdf.outputs['BSDF'], out.inputs['Surface'])

    def sset(key, val):
        if key in bsdf.inputs:
            bsdf.inputs[key].default_value = val

    sset('Base Color', base)
    sset('Roughness', roughness)
    sset('Metallic', metallic)
    sset('Alpha', alpha)
    sset('IOR', ior)
    sset('Transmission Weight', transmission)
    if 'Specular IOR Level' in bsdf.inputs:
        bsdf.inputs['Specular IOR Level'].default_value = specular
    elif 'Specular' in bsdf.inputs:
        bsdf.inputs['Specular'].default_value = specular
    if emission is not None:
        sset('Emission Color', emission if len(emission) == 4 else (*emission, 1.0))
        sset('Emission Strength', emission_strength)
    if subsurface > 0:
        sset('Subsurface Weight', subsurface)
        if subsurface_color:
            sset('Subsurface Radius', subsurface_color)
    if sheen > 0:
        sset('Sheen Weight', sheen)
    if clearcoat > 0:
        sset('Coat Weight', clearcoat)

    if alpha < 1.0:
        mat.blend_method = 'BLEND'
    mat.use_backface_culling = False
    _MAT_CACHE[key] = mat
    return mat


def textured_pbr(name, image_path, roughness=0.7, metallic=0.0,
                 normal_path=None, roughness_path=None, uv_scale=1.0,
                 base_color=(1, 1, 1, 1)):
    """带贴图的 PBR 材质（法线 / 粗糙度可选）。"""
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nt = mat.node_tree
    nt.nodes.clear()

    out = nt.nodes.new('ShaderNodeOutputMaterial')
    out.location = (600, 0)
    bsdf = nt.nodes.new('ShaderNodeBsdfPrincipled')
    bsdf.location = (300, 0)
    nt.links.new(bsdf.outputs['BSDF'], out.inputs['Surface'])

    tex = nt.nodes.new('ShaderNodeTexImage')
    tex.location = (-200, 200)
    tex.image = bpy.data.images.load(image_path, check_existing=True)
    tex.image.colorspace_settings.name = 'sRGB'
    uv = nt.nodes.new('ShaderNodeUVMap')
    uv.location = (-600, 200)
    mapping = nt.nodes.new('ShaderNodeMapping')
    mapping.location = (-420, 200)
    mapping.inputs['Scale'].default_value = (uv_scale, uv_scale, uv_scale)
    nt.links.new(uv.outputs['UV'], mapping.inputs['Vector'])
    nt.links.new(mapping.outputs['Vector'], tex.inputs['Vector'])
    nt.links.new(tex.outputs['Color'], bsdf.inputs['Base Color'])
    bsdf.inputs['Roughness'].default_value = roughness
    bsdf.inputs['Metallic'].default_value = metallic

    if roughness_path:
        rt = nt.nodes.new('ShaderNodeTexImage')
        rt.location = (-200, -60)
        rt.image = bpy.data.images.load(roughness_path, check_existing=True)
        rt.image.colorspace_settings.name = 'Non-Color'
        nt.links.new(mapping.outputs['Vector'], rt.inputs['Vector'])
        nt.links.new(rt.outputs['Color'], bsdf.inputs['Roughness'])

    if normal_path:
        nm = nt.nodes.new('ShaderNodeTexImage')
        nm.location = (-200, -320)
        nm.image = bpy.data.images.load(normal_path, check_existing=True)
        nm.image.colorspace_settings.name = 'Non-Color'
        nrm = nt.nodes.new('ShaderNodeNormalMap')
        nrm.location = (60, -320)
        nrm.inputs['Strength'].default_value = 1.0
        nt.links.new(mapping.outputs['Vector'], nm.inputs['Vector'])
        nt.links.new(nm.outputs['Color'], nrm.inputs['Color'])
        nt.links.new(nrm.outputs['Normal'], bsdf.inputs['Normal'])

    return mat


def assign(ob, mat, smooth=True, angle=48.0):
    ob.data.materials.clear()
    ob.data.materials.append(mat)
    if smooth:
        shade_smooth(ob, angle)
    return ob


def add_material_slot(ob, mat):
    ob.data.materials.append(mat)
    return len(ob.data.materials) - 1


# ══════════════════════════════════════════════════════════════
#  几何生成
# ══════════════════════════════════════════════════════════════

def loft(name, rings, close_caps=True, closed_ring=True):
    """
    用一串截面环放样成曲面。
    rings: [[Vector(x,y,z), ...], ...]，每环点数必须相同。
    """
    n = len(rings[0])
    verts = []
    for r in rings:
        assert len(r) == n, '每环点数必须一致'
        verts.extend(r)

    faces = []
    for i in range(len(rings) - 1):
        a = i * n
        b = (i + 1) * n
        for j in range(n if closed_ring else n - 1):
            j2 = (j + 1) % n
            faces.append((a + j, a + j2, b + j2, b + j))

    if close_caps:
        faces.append(tuple(range(n - 1, -1, -1)))
        base = (len(rings) - 1) * n
        faces.append(tuple(range(base, base + n)))

    return new_mesh_object(name, verts, faces)


def ring_ellipse(center, rx, ry, n=16, plane='XY', rot=0.0, taper=None):
    """生成一个椭圆环。plane 指定环所在平面（法线方向）。"""
    c = Vector(center)
    pts = []
    for i in range(n):
        a = 2 * math.pi * i / n + rot
        u = math.cos(a)
        v = math.sin(a)
        if taper:
            u *= taper(a)
            v *= taper(a)
        if plane == 'XY':
            pts.append(c + Vector((u * rx, v * ry, 0)))
        elif plane == 'XZ':
            pts.append(c + Vector((u * rx, 0, v * ry)))
        else:  # YZ
            pts.append(c + Vector((0, u * rx, v * ry)))
    return pts


def tube_along(name, points, radii, sections=12, cap=True, up=Vector((0, 0, 1))):
    """
    沿折线生成管状体（自动处理拐弯朝向）。
    points: 中心线点列；radii: 每点半径（标量或 (rx,ry)）。
    """
    pts = [Vector(p) for p in points]
    rings = []
    for i, p in enumerate(pts):
        # 切线
        if i == 0:
            t = (pts[1] - pts[0])
        elif i == len(pts) - 1:
            t = (pts[-1] - pts[-2])
        else:
            t = (pts[i + 1] - pts[i - 1])
        t.normalize()

        # 建立局部坐标系
        ref = up if abs(t.dot(up)) < 0.95 else Vector((1, 0, 0))
        x = ref.cross(t).normalized()
        y = t.cross(x).normalized()

        r = radii[i]
        rx, ry = (r, r) if isinstance(r, (int, float)) else r
        ring = []
        for k in range(sections):
            a = 2 * math.pi * k / sections
            ring.append(p + x * (math.cos(a) * rx) + y * (math.sin(a) * ry))
        rings.append(ring)

    return loft(name, rings, close_caps=cap)


def sphere(name, center, radius, seg=24, rings=16, scale=(1, 1, 1)):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=seg, ring_count=rings, radius=radius,
                                         location=center)
    ob = bpy.context.active_object
    ob.name = name
    ob.scale = scale
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    return ob


def rounded_box(name, size, radius=0.01, segments=3, location=(0, 0, 0), rotation=(0, 0, 0)):
    bpy.ops.mesh.primitive_cube_add(size=1, location=location, rotation=rotation)
    ob = bpy.context.active_object
    ob.name = name
    ob.scale = (size[0], size[1], size[2])
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    add_bevel(ob, radius, segments, 30)
    apply_modifiers(ob)
    return ob


def cylinder(name, radius, depth, location=(0, 0, 0), rotation=(0, 0, 0),
             verts=24, cap='NGON', radius_top=None):
    if radius_top is None:
        bpy.ops.mesh.primitive_cylinder_add(vertices=verts, radius=radius, depth=depth,
                                            end_fill_type=cap, location=location,
                                            rotation=rotation)
    else:
        bpy.ops.mesh.primitive_cone_add(vertices=verts, radius1=radius, radius2=radius_top,
                                        depth=depth, end_fill_type=cap,
                                        location=location, rotation=rotation)
    ob = bpy.context.active_object
    ob.name = name
    return ob


def torus(name, major_r, minor_r, location=(0, 0, 0), rotation=(0, 0, 0),
          major_seg=32, minor_seg=12):
    bpy.ops.mesh.primitive_torus_add(major_radius=major_r, minor_radius=minor_r,
                                     major_segments=major_seg, minor_segments=minor_seg,
                                     location=location, rotation=rotation)
    ob = bpy.context.active_object
    ob.name = name
    return ob


def feather(name, length, width, thickness=0.004, curve=0.25, tip_sharp=0.75,
            ripple=0.0, segments=7):
    """
    一片羽毛：带弧度和尖端的扁平叶片。
    沿 +Y 延伸，Z 是厚度方向。
    """
    rings = []
    for i in range(segments + 1):
        t = i / segments
        # 宽度：根部窄→中段最宽→尖端收成一点
        w = width * (0.35 + 0.9 * math.sin(math.pi * min(1.0, t * 1.05)) ** 0.7)
        w *= (1.0 - t ** (1 / tip_sharp)) * 0.85 + 0.15
        w = max(w, width * 0.06)
        th = thickness * (0.4 + 0.6 * math.sin(math.pi * t)) * (1 - t * 0.6)
        y = length * t
        z = -curve * length * (t ** 2) * 0.5
        # 轻微的羽片起伏
        wob = ripple * math.sin(t * math.pi * 5) * width * 0.25
        ring = [
            Vector((-w * 0.5, y, z + wob)),
            Vector((-w * 0.34, y, z + th * 0.7)),
            Vector((0, y, z + th)),
            Vector((w * 0.34, y, z + th * 0.7)),
            Vector((w * 0.5, y, z + wob)),
            Vector((w * 0.34, y, z - th * 0.7)),
            Vector((0, y, z - th)),
            Vector((-w * 0.34, y, z - th * 0.7)),
        ]
        rings.append(ring)
    # 尖端
    rings.append([Vector((0, length * 1.03, -curve * length * 0.5))] * 8)
    ob = loft(name, rings, close_caps=True)
    shade_smooth(ob)
    return ob


def metaball_blob(name, elems, resolution=0.012, smooth_iter=3):
    """
    用 metaball 融合出有机体块（身体 / 脖子 / 头一体化），
    再转 mesh + 平滑，比堆球自然得多。
    elems: [(center, radius, (sx,sy,sz)), ...]
    """
    mb = bpy.data.metaballs.new(name + '_mb')
    mb.resolution = resolution
    mb.render_resolution = resolution
    ob = bpy.data.objects.new(name + '_mbobj', mb)
    bpy.context.scene.collection.objects.link(ob)

    for center, radius, scale in elems:
        el = mb.elements.new()
        el.co = Vector(center)
        el.radius = radius
        el.type = 'BALL'
        el.stiffness = 2.0
        # metaball 不直接支持椭球，用 size_x/y/z
        el.size_x = scale[0]
        el.size_y = scale[1]
        el.size_z = scale[2]

    bpy.context.view_layer.objects.active = ob
    ob.select_set(True)
    bpy.ops.object.convert(target='MESH')
    mesh_ob = bpy.context.active_object
    mesh_ob.name = name

    if smooth_iter:
        smooth_mesh(mesh_ob, smooth_iter, 0.6)
        apply_modifiers(mesh_ob)
    shade_smooth(mesh_ob)
    return mesh_ob


# ══════════════════════════════════════════════════════════════
#  材质噪波 / 细节
# ══════════════════════════════════════════════════════════════

def noise_texture(name='DetailNoise', scale=12.0, detail=6.0, strength=1.0):
    tex = bpy.data.textures.new(name, type='CLOUDS')
    tex.noise_scale = 1.0 / scale
    tex.noise_depth = int(detail)
    tex.noise_basis = 'IMPROVED_PERLIN'
    tex.intensity = strength
    return tex


def voronoi_texture(name='SurfaceDetail', scale=40.0):
    tex = bpy.data.textures.new(name, type='VORONOI')
    tex.noise_scale = 1.0 / scale
    tex.distance_metric = 'DISTANCE'
    return tex


# ══════════════════════════════════════════════════════════════
#  导出
# ══════════════════════════════════════════════════════════════

def export_glb(path, objects=None, with_anim=False, apply_transforms=True):
    bpy.ops.object.select_all(action='DESELECT')
    if objects:
        for o in objects:
            o.select_set(True)
        bpy.context.view_layer.objects.active = objects[0]
        use_selection = True
    else:
        use_selection = False

    bpy.ops.export_scene.gltf(
        filepath=path,
        export_format='GLB',
        use_selection=use_selection,
        export_apply=apply_transforms,
        export_yup=True,
        export_normals=True,
        export_tangents=False,
        export_materials='EXPORT',
        export_image_format='AUTO',
        export_cameras=False,
        export_lights=False,
        export_animations=with_anim,
        export_skins=with_anim,
        export_morph=False,
        export_def_bones=False,
        export_optimize_animation_size=True,
    )
    print(f'  → {path}')


def tri_count():
    total = 0
    for ob in bpy.context.scene.objects:
        if ob.type != 'MESH':
            continue
        me = ob.data
        me.calc_loop_triangles()
        total += len(me.loop_triangles)
    return total


# ══════════════════════════════════════════════════════════════
#  脊椎放样：截面局部 X 恒为世界 X，保证左右对称、不扭转
# ══════════════════════════════════════════════════════════════

def loft_spine(name, stations, sides=24):
    """stations: [(center Vector, rx, rz), ...] -> (ob, rings, pts)"""
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
        x = Vector((1, 0, 0)) - t * t.x
        if x.length < 1e-5:
            x = Vector((1, 0, 0))
        x.normalize()
        z = x.cross(t).normalized()
        rx, rz = stations[i][1], stations[i][2]
        ring = []
        for k in range(sides):
            a = 2 * math.pi * k / sides
            ring.append(pts[i] + x * (math.cos(a) * rx) + z * (math.sin(a) * rz))
        rings.append(ring)
    return loft(name, rings, close_caps=False), rings, pts


def cap_spine(ob, rings):
    """给放样体两端封盖"""
    me = ob.data
    bm = bmesh.new()
    bm.from_mesh(me)
    bm.verts.ensure_lookup_table()
    n = len(rings[0])
    for idx in (0, len(rings) - 1):
        loop = [bm.verts[idx * n + k] for k in range(n)]
        try:
            bmesh.ops.contextual_create(bm, geom=loop)
        except Exception:
            pass
    bm.to_mesh(me)
    bm.free()
    me.update()
    return ob


def ribbon(name, lead, trail, across=8, thickness=0.007):
    """在两条曲线之间铺一张带厚度的薄片（翅膀 / 蹼膜）"""
    verts, faces = [], []
    rows = len(lead)
    for i in range(rows):
        l, t = Vector(lead[i]), Vector(trail[i])
        for j in range(across + 1):
            u = j / across
            p = l.lerp(t, u)
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
