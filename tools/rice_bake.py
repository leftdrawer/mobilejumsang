# 요미산 쌀알·명주실 맵. Blender Cycles 헤드리스.
# 한국 단립종 백미(자포니카) 낮은 메시를 만들고, 높은 메시의 전분 요철을
# 탄젠트 노멀·알베도·거칠기·가장자리 발광으로 굽는다. 명주실은 섬유 타일.
# 사용: blender -b -P tools/rice_bake.py -- /tmp/rice_bake
import bpy, bmesh, json, math, os, sys
from mathutils import Vector

argv = sys.argv
out = argv[argv.index('--') + 1] if '--' in argv else '/tmp/rice_bake'
os.makedirs(out, exist_ok=True)

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.render.engine = 'CYCLES'
scene.cycles.device = 'CPU'
scene.cycles.samples = 8
scene.cycles.use_denoising = False
try:
    scene.cycles.use_adaptive_sampling = False
except Exception:
    pass

# 메시 로컬 축은 three.js 와 같다. X 길이, Y 두께(위), Z 폭.
HALF_L = 0.00290   # 전체 길이 5.8mm. 충돌 캡슐(6.04mm) 안에 둔다
HALF_T = 0.00108   # 두께 2.16mm
HALF_W = 0.00148   # 폭 2.96mm

def shape_vert(x, y, z, broken=False, plump=False):
    t = abs(x)
    # 단립종은 끝이 바늘처럼 뾰족하지 않다. 어깨까지 통통하고 끝은 둥근 반구.
    shoulder = 0.58
    if t <= shoulder:
        end = 1.0
    else:
        u = (t - shoulder) / (1.0 - shoulder)
        end = math.sqrt(max(0.0, 1.0 - u * u))
    if x > 0.2:
        end *= 1.0 - 0.05 * ((x - 0.2) / 0.8)          # 배아 쪽이 아주 조금 가늘다
    if plump:
        end = math.pow(max(end, 0.0), 0.8) * 1.04
    groove = 0.0
    if y > 0.0:
        groove = math.exp(-(z * z) / 0.09) * math.exp(-(x * x) / 0.7) * 0.10 * y
    ny = y * end - groove
    nz = z * end
    nx = x * 0.90
    if broken and nx > 0.46:
        k = (nx - 0.46) / 0.54
        nx = 0.46 + k * 0.07
        ny *= 1.0 - 0.22 * k
        nz *= 1.0 - 0.22 * k
        ny += 0.04 * math.sin(nz * 40.0) * k
        nz += 0.035 * math.sin(ny * 37.0 + 1.3) * k
    return nx * HALF_L, ny * HALF_T, nz * HALF_W

def make_mesh(name, seg_u, seg_v, broken=False, plump=False, micro=False):
    mesh = bpy.data.meshes.new(name)
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=seg_u, v_segments=seg_v, radius=1.0)
    for v in bm.verts:
        v.co.x, v.co.y, v.co.z = shape_vert(v.co.x, v.co.y, v.co.z, broken, plump)
    if micro:
        import random
        rnd = random.Random(7)
        for v in bm.verts:
            n = v.normal.normalized()
            # 도정 줄과 전분 알갱이. 높이는 0.03mm 안.
            u = (math.atan2(v.co.z, v.co.y) / (2 * math.pi))
            h = math.sin(u * 70.0 + v.co.x * 9000.0) * 0.000045
            h += (rnd.random() - 0.5) * 0.00003
            if v.co.y > 0:
                h -= math.exp(-(v.co.z ** 2) / (0.0004 ** 2)) * 0.00004
            v.co += n * h
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(mesh)
    bm.free()
    for p in mesh.polygons:
        p.use_smooth = True
    mesh.update()
    uv_cylindrical(mesh, broken)
    return obj

def uv_cylindrical(mesh, broken):
    if not mesh.uv_layers:
        mesh.uv_layers.new(name='UVMap')
    uv = mesh.uv_layers.active
    for poly in mesh.polygons:
        cut = True
        for vi in poly.vertices:
            if mesh.vertices[vi].co.x < HALF_L * 0.78:
                cut = False
                break
        for li, vi in zip(poly.loop_indices, poly.vertices):
            co = mesh.vertices[vi].co
            if broken and cut:
                uv.data[li].uv = (0.03, 0.04)
                continue
            ang = math.atan2(co.z, co.y) / (2 * math.pi) + 0.5
            # 이음은 아래(-Y)에 둔다
            along = (co.x / HALF_L + 1.0) * 0.5
            uv.data[li].uv = (ang, 0.06 + along * 0.88)

def principled(name, chalk=False):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nt = mat.node_tree
    nt.nodes.clear()
    out = nt.nodes.new('ShaderNodeOutputMaterial')
    p = nt.nodes.new('ShaderNodeBsdfPrincipled')
    p.location = (-300, 0)
    # 좌표: 길이 방향 줄 + 잔알갱이
    tex = nt.nodes.new('ShaderNodeTexCoord')
    tex.location = (-1100, 200)
    sep = nt.nodes.new('ShaderNodeSeparateXYZ')
    sep.location = (-900, 200)
    nt.links.new(tex.outputs['Object'], sep.inputs['Vector'])
    n1 = nt.nodes.new('ShaderNodeTexNoise')
    n1.location = (-700, 280)
    n1.inputs['Scale'].default_value = 14000.0
    n1.inputs['Detail'].default_value = 6.0
    n1.inputs['Roughness'].default_value = 0.55
    nt.links.new(tex.outputs['Object'], n1.inputs['Vector'])
    ramp = nt.nodes.new('ShaderNodeValToRGB')
    ramp.location = (-480, 280)
    ramp.color_ramp.elements[0].position = 0.35
    ramp.color_ramp.elements[1].position = 0.75
    if chalk:
        ramp.color_ramp.elements[0].color = (0.93, 0.92, 0.90, 1)
        ramp.color_ramp.elements[1].color = (0.98, 0.97, 0.95, 1)
    else:
        # 속은 따뜻한 진주, 겉은 더 희다
        ramp.color_ramp.elements[0].color = (0.90, 0.84, 0.72, 1)
        ramp.color_ramp.elements[1].color = (0.97, 0.95, 0.90, 1)
    nt.links.new(n1.outputs['Fac'], ramp.inputs['Fac'])
    # 배아 끝(+X)에 노란 점
    mathn = nt.nodes.new('ShaderNodeMath')
    mathn.operation = 'GREATER_THAN'
    mathn.location = (-700, 40)
    mathn.inputs[1].default_value = HALF_L * 0.55
    nt.links.new(sep.outputs['X'], mathn.inputs[0])
    mix = nt.nodes.new('ShaderNodeMixRGB')
    mix.location = (-240, 160)
    mix.inputs['Fac'].default_value = 1.0
    mix.blend_type = 'MIX'
    nt.links.new(mathn.outputs['Value'], mix.inputs['Fac'])
    nt.links.new(ramp.outputs['Color'], mix.inputs['Color1'])
    mix.inputs['Color2'].default_value = (0.86, 0.78, 0.58, 1) if not chalk else (0.95, 0.94, 0.92, 1)
    nt.links.new(mix.outputs['Color'], p.inputs['Base Color'])
    def sock(bsdf, names):
        for n in names:
            if n in bsdf.inputs:
                return bsdf.inputs[n]
        raise KeyError(list(bsdf.inputs.keys()))
    sock(p, ['Subsurface Weight', 'Subsurface']).default_value = 0.05 if chalk else 0.35
    if 'Subsurface Radius' in p.inputs:
        p.inputs['Subsurface Radius'].default_value = (0.0012, 0.0009, 0.0006)
    sock(p, ['Roughness']).default_value = 0.78 if chalk else 0.32
    spec = sock(p, ['Specular IOR Level', 'Specular'])
    spec.default_value = 0.25 if chalk else 0.45
    if 'Coat Weight' in p.inputs:
        p.inputs['Coat Weight'].default_value = 0.0 if chalk else 0.08
    if 'Sheen Weight' in p.inputs:
        p.inputs['Sheen Weight'].default_value = 0.1 if chalk else 0.45
    elif 'Sheen' in p.inputs:
        p.inputs['Sheen'].default_value = 0.1 if chalk else 0.45
    # 거칠기 변화
    n2 = nt.nodes.new('ShaderNodeTexNoise')
    n2.location = (-700, -180)
    n2.inputs['Scale'].default_value = 9000.0
    n2.inputs['Detail'].default_value = 3.0
    nt.links.new(tex.outputs['Object'], n2.inputs['Vector'])
    mapr = nt.nodes.new('ShaderNodeMapRange')
    mapr.location = (-420, -180)
    mapr.inputs['From Min'].default_value = 0.3
    mapr.inputs['From Max'].default_value = 0.8
    mapr.inputs['To Min'].default_value = 0.62 if chalk else 0.42
    mapr.inputs['To Max'].default_value = 0.92 if chalk else 0.72
    nt.links.new(n2.outputs['Fac'], mapr.inputs['Value'])
    nt.links.new(mapr.outputs['Result'], p.inputs['Roughness'])
    nt.links.new(p.outputs['BSDF'], out.inputs['Surface'])
    return mat

def silk_material():
    mat = bpy.data.materials.new('silk')
    mat.use_nodes = True
    nt = mat.node_tree
    nt.nodes.clear()
    out = nt.nodes.new('ShaderNodeOutputMaterial')
    p = nt.nodes.new('ShaderNodeBsdfPrincipled')
    uv = nt.nodes.new('ShaderNodeTexCoord')
    sep = nt.nodes.new('ShaderNodeSeparateXYZ')
    nt.links.new(uv.outputs['UV'], sep.inputs['Vector'])
    # 둘레(v)로 가는 섬유, 길이(u)로 살짝 흔들림
    wave = nt.nodes.new('ShaderNodeTexWave')
    wave.wave_type = 'BANDS'
    wave.bands_direction = 'Y'
    wave.inputs['Scale'].default_value = 46.0
    wave.inputs['Distortion'].default_value = 2.2
    wave.inputs['Detail'].default_value = 4.0
    wave.inputs['Detail Scale'].default_value = 3.0
    nt.links.new(uv.outputs['UV'], wave.inputs['Vector'])
    fine = nt.nodes.new('ShaderNodeTexWave')
    fine.wave_type = 'BANDS'
    fine.bands_direction = 'Y'
    fine.inputs['Scale'].default_value = 180.0
    fine.inputs['Distortion'].default_value = 1.1
    fine.inputs['Detail'].default_value = 2.0
    nt.links.new(uv.outputs['UV'], fine.inputs['Vector'])
    mix = nt.nodes.new('ShaderNodeMixRGB')
    mix.blend_type = 'MIX'
    mix.inputs['Fac'].default_value = 0.45
    nt.links.new(wave.outputs['Color'], mix.inputs['Color1'])
    nt.links.new(fine.outputs['Color'], mix.inputs['Color2'])
    ramp = nt.nodes.new('ShaderNodeValToRGB')
    ramp.color_ramp.elements[0].position = 0.25
    ramp.color_ramp.elements[0].color = (0.78, 0.70, 0.55, 1)
    ramp.color_ramp.elements[1].position = 0.72
    ramp.color_ramp.elements[1].color = (0.98, 0.96, 0.90, 1)
    nt.links.new(mix.outputs['Color'], ramp.inputs['Fac'])
    nt.links.new(ramp.outputs['Color'], p.inputs['Base Color'])
    bump = nt.nodes.new('ShaderNodeBump')
    bump.inputs['Strength'].default_value = 0.35
    bump.inputs['Distance'].default_value = 0.15
    nt.links.new(mix.outputs['Color'], bump.inputs['Height'])
    nt.links.new(bump.outputs['Normal'], p.inputs['Normal'])
    rough = nt.nodes.new('ShaderNodeMapRange')
    rough.inputs['To Min'].default_value = 0.18
    rough.inputs['To Max'].default_value = 0.55
    nt.links.new(wave.outputs['Fac'], rough.inputs['Value'])
    nt.links.new(rough.outputs['Result'], p.inputs['Roughness'])
    def sock(bsdf, names):
        for n in names:
            if n in bsdf.inputs:
                return bsdf.inputs[n]
        return None
    s = sock(p, ['Sheen Weight', 'Sheen'])
    if s: s.default_value = 0.8
    c = sock(p, ['Coat Weight'])
    if c: c.default_value = 0.15
    an = sock(p, ['Anisotropic'])
    if an: an.default_value = 0.85
    nt.links.new(p.outputs['BSDF'], out.inputs['Surface'])
    return mat

def bake_pair(high, low, img, bake_type, margin=8):
    if os.environ.get('RICE_RENDER_ONLY') == '1':
        return
    scene.render.bake.use_selected_to_active = True
    scene.render.bake.cage_extrusion = 0.00035
    scene.render.bake.margin = margin
    scene.render.bake.use_clear = True
    if bake_type == 'DIFFUSE':
        scene.render.bake.use_pass_direct = False
        scene.render.bake.use_pass_indirect = False
        scene.render.bake.use_pass_color = True
    for o in (high, low):
        o.select_set(False)
    high.select_set(True)
    low.select_set(True)
    bpy.context.view_layer.objects.active = low
    bpy.ops.object.bake(type=bake_type)

def new_image(name, w, h, color=False):
    img = bpy.data.images.new(name, w, h, alpha=False, float_buffer=False)
    try:
        img.colorspace_settings.name = 'sRGB' if color else 'Non-Color'
    except Exception:
        pass
    return img

def assign_bake_target(obj, img, mat=None):
    if mat is None:
        mat = bpy.data.materials.new(obj.name + '_bake')
        mat.use_nodes = True
    if obj.data.materials:
        obj.data.materials[0] = mat
    else:
        obj.data.materials.append(mat)
    nt = mat.node_tree
    node = nt.nodes.new('ShaderNodeTexImage')
    node.image = img
    node.select = True
    nt.nodes.active = node
    return mat

def save_png(img, path):
    if os.environ.get('RICE_RENDER_ONLY') == '1':
        return
    img.filepath_raw = path
    img.file_format = 'PNG'
    img.save()
    print('saved', path)

# ── 쌀알 ──
low = make_mesh('grain_low', 20, 12, broken=False)
high = make_mesh('grain_high', 48, 24, broken=False, micro=True)
pearl = principled('pearl', chalk=False)
high.data.materials.append(pearl)
low_mat = bpy.data.materials.new('low_holder')
low_mat.use_nodes = True
low.data.materials.append(low_mat)

alb = new_image('rice_albedo', 1024, 1024, True)
nrm = new_image('rice_normal', 1024, 1024, False)
rgh = new_image('rice_rough', 1024, 1024, False)
ao = new_image('rice_ao', 512, 512, False)

scene.cycles.samples = 16
assign_bake_target(low, alb, low_mat)
bake_pair(high, low, alb, 'DIFFUSE')
save_png(alb, os.path.join(out, 'rice_albedo.png'))

assign_bake_target(low, nrm, low_mat)
bake_pair(high, low, nrm, 'NORMAL')
save_png(nrm, os.path.join(out, 'rice_normal.png'))

assign_bake_target(low, rgh, low_mat)
bake_pair(high, low, rgh, 'ROUGHNESS')
save_png(rgh, os.path.join(out, 'rice_rough.png'))

scene.cycles.samples = 32
assign_bake_target(low, ao, low_mat)
bake_pair(high, low, ao, 'AO')
save_png(ao, os.path.join(out, 'rice_ao.png'))

broken = make_mesh('grain_broken', 20, 12, broken=True)

def export_mesh(obj, broken_flag):
    mesh = obj.data
    bm = bmesh.new()
    bm.from_mesh(mesh)
    bmesh.ops.triangulate(bm, faces=bm.faces)
    bm.to_mesh(mesh)
    bm.free()
    mesh.update()
    uv = mesh.uv_layers.active
    pos, nor, uvs, idx = [], [], [], []
    # 꼭짓점을 루프마다 풀지 않고, 매끈한 정점 노멀을 쓴다
    for v in mesh.vertices:
        pos += [round(v.co.x, 6), round(v.co.y, 6), round(v.co.z, 6)]
        nor += [round(v.normal.x, 5), round(v.normal.y, 5), round(v.normal.z, 5)]
    # uv 는 루프 단위라 정점에 첫 값을 넣되, 잘린 면은 따로 처리돼 있다.
    # 잘린 면의 uv 가 정점의 다른 면과 다르면 정점을 나눈다.
    vert_uv = {}
    remap = {}
    next_i = 0
    # 다시: 루프마다 정점을 복제하면 uv 이음이 맞다. 쌀알은 작다.
    pos, nor, uvs, idx = [], [], [], []
    for poly in mesh.polygons:
        for li, vi in zip(poly.loop_indices, poly.vertices):
            co = mesh.vertices[vi].co
            n = mesh.vertices[vi].normal
            u, v = uv.data[li].uv
            key = (vi, round(u, 4), round(v, 4))
            if key not in remap:
                remap[key] = next_i
                next_i += 1
                pos += [round(co.x, 6), round(co.y, 6), round(co.z, 6)]
                nor += [round(n.x, 5), round(n.y, 5), round(n.z, 5)]
                uvs += [round(u, 5), round(v, 5)]
            idx.append(remap[key])
    return {'position': pos, 'normal': nor, 'uv': uvs, 'index': idx}

geo = {
    'whole': export_mesh(low, False),
    'broken': export_mesh(broken, True),
}
# 잘린 면이 쓰는 uv(0.03,0.04) 칸을 분상(하얗고 거칠게)으로 찍는다
def stamp_break(path, rgba):
    img = bpy.data.images.load(path)
    w, h = img.size
    px = list(img.pixels)
    x0, y0, x1, y1 = int(0.01*w), int(0.015*h), int(0.055*w), int(0.07*h)
    for y in range(y0, y1):
        for x in range(x0, x1):
            i = (y * w + x) * 4
            px[i:i+4] = rgba
    img.pixels[:] = px
    img.filepath_raw = path
    img.file_format = 'PNG'
    img.save()

stamp_break(os.path.join(out, 'rice_albedo.png'), (0.93, 0.91, 0.86, 1))
stamp_break(os.path.join(out, 'rice_rough.png'), (0.86, 0.86, 0.86, 1))
stamp_break(os.path.join(out, 'rice_normal.png'), (0.5, 0.5, 1.0, 1))

with open(os.path.join(out, 'rice_grains.json'), 'w') as f:
    json.dump(geo, f, separators=(',', ':'))
print('verts whole', len(geo['whole']['position'])//3, 'broken', len(geo['broken']['position'])//3)

# ── 명주실 타일. 평면 스스로 굽기 ──
bpy.ops.mesh.primitive_plane_add(size=2, location=(0, 0, 0))
plane = bpy.context.active_object
plane.name = 'silk_plane'
# uv 0-1 은 기본 평면이 이미 가진다. 크기를 늘려 섬유가 타일로 보이게 한다.
silk = silk_material()
plane.data.materials.append(silk)
# 굽기 대상은 자기 자신
scene.render.bake.use_selected_to_active = False
scene.render.bake.margin = 4
scene.cycles.samples = 8

def bake_self(obj, img, bake_type):
    if os.environ.get('RICE_RENDER_ONLY') == '1':
        return
    mat = obj.data.materials[0]
    node = mat.node_tree.nodes.new('ShaderNodeTexImage')
    node.image = img
    for n in mat.node_tree.nodes:
        n.select = False
    node.select = True
    mat.node_tree.nodes.active = node
    bpy.ops.object.select_all(action='DESELECT')
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    if bake_type == 'DIFFUSE':
        scene.render.bake.use_pass_direct = False
        scene.render.bake.use_pass_indirect = False
        scene.render.bake.use_pass_color = True
    bpy.ops.object.bake(type=bake_type)

sa = new_image('silk_albedo', 1024, 128, True)
sn = new_image('silk_normal', 1024, 128, False)
sr = new_image('silk_rough', 1024, 128, False)
bake_self(plane, sa, 'DIFFUSE')
save_png(sa, os.path.join(out, 'silk_albedo.png'))
bake_self(plane, sn, 'NORMAL')
save_png(sn, os.path.join(out, 'silk_normal.png'))
bake_self(plane, sr, 'ROUGHNESS')
save_png(sr, os.path.join(out, 'silk_rough.png'))

# ── 실사 참고 렌더 (SSS 쌀, 나무 상) ──
if os.environ.get('SKIP_RENDER') == '1':
    print('DONE', out)
    raise SystemExit(0)
for obj in (low, high, broken, plane):
    obj.hide_render = True

def show(obj):
    obj.hide_render = False
    obj.hide_viewport = False

wood_path = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'assets', 'wood_top_albedo.webp')

def wood_mat():
    mat = bpy.data.materials.new('wood')
    mat.use_nodes = True
    nt = mat.node_tree
    bsdf = nt.nodes.get('Principled BSDF')
    tex = nt.nodes.new('ShaderNodeTexImage')
    try:
        img = bpy.data.images.load(wood_path)
        tex.image = img
    except Exception as e:
        print('wood load failed', e)
    nt.links.new(tex.outputs['Color'], bsdf.inputs['Base Color'])
    bsdf.inputs['Roughness'].default_value = 0.48
    return mat

bpy.ops.mesh.primitive_plane_add(size=0.08, location=(0, 0, 0))
table = bpy.context.active_object
table.name = 'table'
table.data.materials.append(wood_mat())
# three Y-up 메시를 블렌더 Z-up 상에 눕힌다: X 90°
def lay(src, name, loc, rot_z=0.0, scale=1.0):
    ob = src.copy()
    ob.data = src.data
    ob.name = name
    bpy.context.collection.objects.link(ob)
    ob.hide_render = False
    ob.rotation_euler = (math.radians(90), 0, rot_z)
    ob.location = Vector(loc)
    ob.scale = (scale, scale, scale)
    if not ob.data.materials:
        ob.data.materials.append(pearl)
    else:
        ob.data.materials[0] = pearl
    return ob

# 더미
import random
rng = random.Random(3)
heap = []
for i in range(36):
    a = rng.random() * math.tau
    rad = math.sqrt(rng.random()) * 0.012
    loc = (math.cos(a) * rad, math.sin(a) * rad, 0.0012 + rng.random() * 0.004 * (1 - rad / 0.012))
    src = broken if rng.random() < 0.08 else high
    heap.append(lay(src, f'h{i}', loc, rng.random() * math.tau, 0.9 + rng.random() * 0.2))

world = scene.world or bpy.data.worlds.new('w')
scene.world = world
world.use_nodes = True
bg = world.node_tree.nodes.get('Background')
if bg:
    bg.inputs['Color'].default_value = (0.85, 0.78, 0.68, 1)
    bg.inputs['Strength'].default_value = 0.35
bpy.ops.object.light_add(type='AREA', location=(0.04, -0.03, 0.08))
key = bpy.context.active_object
key.data.energy = 3.2
key.data.size = 0.06
key.data.color = (1.0, 0.95, 0.88)
bpy.ops.object.light_add(type='AREA', location=(-0.05, 0.04, 0.05))
fill = bpy.context.active_object
fill.data.energy = 2.2
fill.data.size = 0.08
fill.data.color = (0.85, 0.88, 1.0)

scene.cycles.samples = 48
scene.cycles.use_denoising = False
scene.render.resolution_x = 840
scene.render.resolution_y = 560
scene.render.film_transparent = False
try:
    scene.view_settings.view_transform = 'AgX'
except Exception:
    scene.view_settings.view_transform = 'Filmic'
scene.view_settings.exposure = -1.1

cam_data = bpy.data.cameras.new('cam')
cam_data.lens = 50
cam_data.clip_start = 0.001
cam_data.clip_end = 2.0
cam = bpy.data.objects.new('cam', cam_data)
bpy.context.collection.objects.link(cam)
scene.camera = cam

def aim(loc, target):
    cam.location = Vector(loc)
    direction = Vector(target) - cam.location
    cam.rotation_euler = direction.to_track_quat('-Z', 'Y').to_euler()

def render_to(path):
    scene.render.filepath = path
    scene.render.image_settings.file_format = 'PNG'
    bpy.ops.render.render(write_still=True)
    print('rendered', path)

aim((0.028, -0.034, 0.026), (0, 0, 0.004))
render_to(os.path.join(out, 'blender_heap.png'))

aim((0.012, -0.010, 0.010), (0.002, 0.0, 0.003))
render_to(os.path.join(out, 'blender_grains.png'))

# 명주실: 현수선 곡선 + 매달린 알
for ob in heap:
    ob.hide_render = True
bpy.ops.curve.primitive_bezier_curve_add(location=(0, 0, 0.012))
curve = bpy.context.active_object
curve.name = 'silk_curve'
curve.data.dimensions = '3D'
curve.data.bevel_depth = 0.00040
curve.data.bevel_resolution = 3
curve.data.resolution_u = 24
spl = curve.data.splines[0]
# 기본 베지어는 두 점. 가운데가 처지게 점을 옮긴다.
pts = spl.bezier_points
pts[0].co = (-0.03, 0, 0.012)
pts[0].handle_left_type = pts[0].handle_right_type = 'AUTO'
pts[1].co = (0.03, 0, 0.012)
pts[1].handle_left_type = pts[1].handle_right_type = 'AUTO'
# 가운데 점 추가
spl.bezier_points.add(1)
# add 는 끝에 붙는다. 다시 배치
bp = spl.bezier_points
bp[0].co = (-0.028, 0.0, 0.016)
bp[0].handle_left = (-0.034, 0, 0.016)
bp[0].handle_right = (-0.016, 0, 0.010)
bp[1].co = (0.028, 0.0, 0.016)
bp[1].handle_left = (0.016, 0, 0.010)
bp[1].handle_right = (0.034, 0, 0.016)
bp[2].co = (0.0, 0.0, 0.004)
bp[2].handle_left = (-0.010, 0, 0.004)
bp[2].handle_right = (0.010, 0, 0.004)
for p in bp:
    p.handle_left_type = 'FREE'
    p.handle_right_type = 'FREE'
if curve.data.materials:
    curve.data.materials[0] = silk
else:
    curve.data.materials.append(silk)
# 곡선은 UV 가 약하다. 렌더용으로 구운 실 맵을 입힌다.
silk_img_mat = bpy.data.materials.new('silk_baked')
silk_img_mat.use_nodes = True
nt = silk_img_mat.node_tree
bs = nt.nodes.get('Principled BSDF')
im = nt.nodes.new('ShaderNodeTexImage')
im.image = bpy.data.images.load(os.path.join(out, 'silk_albedo.png'))
nt.links.new(im.outputs['Color'], bs.inputs['Base Color'])
bs.inputs['Roughness'].default_value = 0.28
s = None
for n in ('Sheen Weight', 'Sheen'):
    if n in bs.inputs:
        s = bs.inputs[n]
if s: s.default_value = 0.9
curve.data.materials[0] = silk_img_mat

for i, x in enumerate((-0.004, -0.001, 0.002, 0.0055)):
    z = 0.0032 - abs(x) * 0.05
    lay(high if i != 2 else broken, f'sg{i}', (x, 0.0, z), rng.random()*6, 1.0)

aim((0.02, -0.028, 0.018), (0, 0, 0.008))
render_to(os.path.join(out, 'blender_silk.png'))

# 흩어진 알
for ob in list(bpy.context.collection.objects):
    if ob.name.startswith('sg') or ob.name == 'silk_curve':
        ob.hide_render = True
for i in range(18):
    loc = ((rng.random()-0.5)*0.03, (rng.random()-0.5)*0.02, 0.0011)
    lay(broken if rng.random()<0.12 else high, f'sc{i}', loc, rng.random()*math.tau, 0.92+rng.random()*0.16)
aim((0.03, -0.036, 0.028), (0, 0, 0.001))
render_to(os.path.join(out, 'blender_scatter.png'))
print('DONE', out)
