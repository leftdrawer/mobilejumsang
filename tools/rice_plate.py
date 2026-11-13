# 요미산 고정 카메라에서 첫 화면 쌀더미를 구운다.
# three.js Y-up (x,y,z) -> blender Z-up (x, -z, y)
import bpy, bmesh, json, math, os, random
from mathutils import Matrix, Vector

random.seed(7)
OUT = '/tmp/rice_plate'
os.makedirs(OUT, exist_ok=True)
ROOT = '/agent/repos/mobilejumsang'

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.render.engine = 'CYCLES'
scene.cycles.samples = 48
scene.cycles.use_denoising = False
try:
    scene.cycles.device = 'CPU'
except Exception:
    pass
# 생쌀은 누런 베이지가 아니다. 거의 흰 상아색이고, 그림자는 회색빛 갈색이다.
scene.view_settings.view_transform = 'AgX'
scene.view_settings.look = 'None'
scene.view_settings.exposure = -0.40
scene.render.resolution_x = 1784
scene.render.resolution_y = 824
scene.render.resolution_percentage = 100
scene.render.film_transparent = False
scene.render.image_settings.file_format = 'PNG'
scene.render.filepath = OUT + '/plate.png'
scene.world = bpy.data.worlds.new('w')
scene.world.use_nodes = True
bg = scene.world.node_tree.nodes['Background']
bg.inputs[0].default_value = (0.015, 0.009, 0.005, 1)
bg.inputs[1].default_value = 0.35

def T(x, y, z):
    return (x, -z, y)

cam_data = bpy.data.cameras.new('rice')
cam_data.sensor_fit = 'VERTICAL'
cam_data.angle = math.radians(32)
cam_data.clip_start = 0.01
cam_data.clip_end = 20
cam = bpy.data.objects.new('rice', cam_data)
bpy.context.collection.objects.link(cam)
cam.location = T(0, 0.085, 0.235)
target = bpy.data.objects.new('tgt', None)
bpy.context.collection.objects.link(target)
target.location = T(0, 0.052, 0)
con = cam.constraints.new('TRACK_TO')
con.target = target
con.track_axis = 'TRACK_NEGATIVE_Z'
con.up_axis = 'UP_Y'
scene.camera = cam

def area(name, energy, color, size, loc):
    L = bpy.data.lights.new(name, 'AREA')
    L.energy = energy
    L.color = color
    L.size = size
    ob = bpy.data.objects.new(name, L)
    bpy.context.collection.objects.link(ob)
    ob.location = T(*loc)
    c = ob.constraints.new('TRACK_TO')
    c.target = target
    c.track_axis = 'TRACK_NEGATIVE_Z'
    c.up_axis = 'UP_Y'
    return ob

# 키는 아주 약한 온기만. 주황 빛이면 쌀이 베이지로, 나무가 붉게 물든다.
area('key', 4.8, (1.0, 0.90, 0.64), 0.12, (-0.10, 0.24, 0.02))
area('fill', 1.2, (0.97, 0.94, 0.90), 0.55, (0.16, 0.12, 0.18))

# 쟁반 200×145×16mm, 윗면 y=0
wood = bpy.data.materials.new('wood')
wood.use_nodes = True
nt = wood.node_tree
nt.nodes.clear()
out = nt.nodes.new('ShaderNodeOutputMaterial')
bsdf = nt.nodes.new('ShaderNodeBsdfPrincipled')
bsdf.inputs['Roughness'].default_value = 0.72
tex = nt.nodes.new('ShaderNodeTexImage')
img = bpy.data.images.load(ROOT + '/assets/wood_top_albedo.webp')
tex.image = img
hsv = nt.nodes.new('ShaderNodeHueSaturation')
# 붉은 스캔을 눌러 어두운 호두색으로. 채도를 빼고 조금 어둡게.
hsv.inputs['Hue'].default_value = 0.50
hsv.inputs['Saturation'].default_value = 0.88
hsv.inputs['Value'].default_value = 0.33
nt.links.new(tex.outputs['Color'], hsv.inputs['Color'])
# 채도를 뺀 뒤 파랑을 더 눌러 호두색으로 둔다.
bal = nt.nodes.new('ShaderNodeMixRGB')
bal.blend_type = 'MULTIPLY'
bal.inputs['Fac'].default_value = 1.0
bal.inputs['Color2'].default_value = (0.88, 0.50, 0.26, 1)
nt.links.new(hsv.outputs['Color'], bal.inputs['Color1'])
nt.links.new(bal.outputs['Color'], bsdf.inputs['Base Color'])
nt.links.new(bsdf.outputs['BSDF'], out.inputs['Surface'])
bpy.ops.mesh.primitive_cube_add(size=1, location=T(0, -0.008, 0))
tray = bpy.context.active_object
tray.scale = (0.200, 0.145, 0.016)
bpy.ops.object.transform_apply(scale=True)
bev = tray.modifiers.new('b', 'BEVEL')
bev.width = 0.004
bev.segments = 2
bpy.ops.object.modifier_apply(modifier='b')
tray.data.materials.append(wood)
bpy.ops.object.mode_set(mode='EDIT')
bpy.ops.uv.smart_project(angle_limit=66)
bpy.ops.object.mode_set(mode='OBJECT')

# 첫 화면과 같은 단립종 메시. three (x 길이, y 두께, z 폭) -> blender (x, -z, y)
geo = json.load(open(ROOT + '/assets/rice_grains.json'))['whole']
pos, idx = geo['position'], geo['index']
verts = [(pos[i], -pos[i + 2], pos[i + 1]) for i in range(0, len(pos), 3)]
faces = [tuple(idx[i:i + 3]) for i in range(0, len(idx), 3)]
gmesh = bpy.data.meshes.new('grain')
gmesh.from_pydata(verts, [], faces)
gmesh.update()
for p in gmesh.polygons:
    p.use_smooth = True
grain = bpy.data.objects.new('grain', gmesh)
bpy.context.collection.objects.link(grain)

def rice_mat():
    mat = bpy.data.materials.new('rice')
    mat.use_nodes = True
    nt = mat.node_tree
    nt.nodes.clear()
    outn = nt.nodes.new('ShaderNodeOutputMaterial')
    p = nt.nodes.new('ShaderNodeBsdfPrincipled')
    tex = nt.nodes.new('ShaderNodeTexCoord')
    n1 = nt.nodes.new('ShaderNodeTexNoise')
    n1.inputs['Scale'].default_value = 900.0
    n1.inputs['Detail'].default_value = 4.0
    n1.inputs['Roughness'].default_value = 0.55
    nt.links.new(tex.outputs['Object'], n1.inputs['Vector'])
    ramp = nt.nodes.new('ShaderNodeValToRGB')
    ramp.color_ramp.elements[0].position = 0.32
    ramp.color_ramp.elements[0].color = (0.74, 0.66, 0.56, 1)
    ramp.color_ramp.elements[1].position = 0.72
    ramp.color_ramp.elements[1].color = (0.98, 0.88, 0.74, 1)
    nt.links.new(n1.outputs['Fac'], ramp.inputs['Fac'])
    # 알마다 밝기가 조금씩 다르다
    oi = nt.nodes.new('ShaderNodeObjectInfo')
    ramp2 = nt.nodes.new('ShaderNodeValToRGB')
    ramp2.color_ramp.elements[0].position = 0.0
    ramp2.color_ramp.elements[0].color = (0.90, 0.90, 0.90, 1)
    ramp2.color_ramp.elements[1].position = 1.0
    ramp2.color_ramp.elements[1].color = (1.06, 1.04, 1.02, 1)
    nt.links.new(oi.outputs['Random'], ramp2.inputs['Fac'])
    mul = nt.nodes.new('ShaderNodeMixRGB')
    mul.blend_type = 'MULTIPLY'
    mul.inputs['Fac'].default_value = 1.0
    nt.links.new(ramp.outputs['Color'], mul.inputs['Color1'])
    nt.links.new(ramp2.outputs['Color'], mul.inputs['Color2'])
    nt.links.new(mul.outputs['Color'], p.inputs['Base Color'])
    p.inputs['Roughness'].default_value = 0.30
    p.inputs['Specular IOR Level'].default_value = 0.30
    if 'Subsurface Weight' in p.inputs:
        p.inputs['Subsurface Weight'].default_value = 0.16
        p.inputs['Subsurface Radius'].default_value = (1.0, 0.98, 0.95)
        p.inputs['Subsurface Scale'].default_value = 0.00115
    if 'Sheen Weight' in p.inputs:
        p.inputs['Sheen Weight'].default_value = 0.18
    if 'Coat Weight' in p.inputs:
        p.inputs['Coat Weight'].default_value = 0.04
    nt.links.new(p.outputs['BSDF'], outn.inputs['Surface'])
    return mat

gmat = rice_mat()
grain.data.materials.append(gmat)

domes = [
    (-0.001, -0.004, 0.040, 0.0155),
    (0.010, -0.008, 0.018, 0.007),
    (-0.012, 0.000, 0.016, 0.006),
]
def height(x, z):
    h = 0.0
    for cx, cz, rad, peak in domes:
        d = math.hypot(x - cx, z - cz) / rad
        if d < 1:
            h = max(h, peak * (1 - d * d) ** 1.2)
    return h

def pose(loose=False):
    yaw = random.random() * math.tau
    if loose or random.random() < 0.18:
        roll = random.uniform(-1.15, 1.15)
        pitch = random.uniform(-0.55, 0.55)
    else:
        # 긴 면이 보이도록 대부분 눕힌다. 두께가 있어 원반으로 납작하지 않다.
        roll = random.uniform(-0.55, 0.55)
        pitch = random.uniform(-0.28, 0.28)
    return yaw, roll, pitch

# 겹침을 막아 틈의 검은 구멍이 생기지 않게 한다.
cell = 0.0032
buckets = {}
def near(x, y, z, d):
    ix, iz = int(x / cell), int(z / cell)
    d2 = d * d
    for dx in (-1, 0, 1):
        for dz in (-1, 0, 1):
            for q in buckets.get((ix + dx, iz + dz), ()):
                if (q[0] - x) ** 2 + (q[2] - z) ** 2 + (q[1] - y) ** 2 < d2:
                    return True
    return False

def keep(x, y, z, yaw, roll, pitch):
    ix, iz = int(x / cell), int(z / cell)
    buckets.setdefault((ix, iz), []).append((x, y, z))
    pts.append((x, y, z, yaw, roll, pitch))

pts = []
for i in range(14000):
    x = random.uniform(-0.042, 0.042)
    z = random.uniform(-0.040, 0.032)
    h = height(x, z)
    if h < 0.0035:
        continue
    y = random.uniform(0.0011, h * 0.82)
    if near(x, y, z, 0.00085):
        continue
    yaw, roll, pitch = pose()
    keep(x, y, z, yaw, roll, pitch)
for i in range(26000):
    x = random.uniform(-0.046, 0.046)
    z = random.uniform(-0.044, 0.036)
    h = height(x, z)
    if h < 0.0014:
        continue
    y = h + random.uniform(-0.0004, 0.00025)
    if near(x, y, z, 0.00095):
        continue
    yaw, roll, pitch = pose()
    keep(x, y, z, yaw, roll, pitch)
# 앞쪽(카메라 쪽, +z) 가장자리는 알로 메운다. 속이 비면 검게 뚫린다.
for i in range(1800):
    x = random.uniform(-0.034, 0.034)
    z = random.uniform(0.004, 0.034)
    h = height(x, z)
    if h < 0.001:
        continue
    y = max(0.0011, h * random.uniform(0.15, 0.95))
    if near(x, y, z, 0.00105):
        continue
    yaw, roll, pitch = pose()
    keep(x, y, z, yaw, roll, pitch)
for i in range(520):
    a = random.random() * math.tau
    rr = random.uniform(0.034, 0.062)
    x = math.cos(a) * rr * random.uniform(0.85, 1.15)
    z = math.sin(a) * rr * 0.78 - 0.002
    if abs(x) > 0.082 or z > 0.050 or z < -0.055:
        continue
    if height(x, z) > 0.0022:
        continue
    if near(x, 0.0011, z, 0.0022):
        continue
    yaw, roll, pitch = pose(loose=True)
    keep(x, 0.00105, z, yaw, roll, pitch)

print('grains', len(pts))

for x, y, z, yaw, roll, pitch in pts:
    ob = grain.copy()
    ob.data = grain.data
    # 첫 화면은 더 멀리서 봐 알이 더 잘게 보인다. 비율(통통한 단립종)은 그대로 두고 살짝 줄인다.
    ob.matrix_world = (Matrix.Translation(T(x, y, z))
                       @ Matrix.Rotation(yaw, 4, 'Z')
                       @ Matrix.Rotation(roll, 4, 'X')
                       @ Matrix.Rotation(pitch, 4, 'Y')
                       @ Matrix.Scale(0.62, 4))
    bpy.context.collection.objects.link(ob)
grain.hide_render = True

# 깊이 격자. 알이 있는 곳만, 가장자리는 퍼지지 않게.
NX, NZ = 56, 42
xs0, xs1, zs0, zs1 = -0.10, 0.10, -0.072, 0.072
grid = [0.0] * (NX * NZ)
for x, y, z, yaw, roll, pitch in pts:
    ix = int((x - xs0) / (xs1 - xs0) * (NX - 1))
    iz = int((z - zs0) / (zs1 - zs0) * (NZ - 1))
    if 0 <= ix < NX and 0 <= iz < NZ:
        top = y + 0.0010
        k = iz * NX + ix
        if top > grid[k]:
            grid[k] = top
# 한 칸만 메워 실이 틈으로 빠지지 않게 하되, 사진 밖으로 튀지 않게 한다.
nxt = grid[:]
for iz in range(NZ):
    for ix in range(NX):
        m = grid[iz * NX + ix]
        for dz in (-1, 0, 1):
            for dx in (-1, 0, 1):
                jx, jz = ix + dx, iz + dz
                if 0 <= jx < NX and 0 <= jz < NZ:
                    m = max(m, grid[jz * NX + jx] * 0.82)
        nxt[iz * NX + ix] = m
grid = nxt
json.dump({'nx': NX, 'nz': NZ, 'x0': xs0, 'x1': xs1, 'z0': zs0, 'z1': zs1,
           'h': [round(v, 5) for v in grid]},
          open(ROOT + '/assets/rice_heap_h.json', 'w'))
print('height max', max(grid))

# 틈은 어두운 쌀색. 나무나 검정이 비치면 구멍으로 읽힌다.
bed = bpy.data.materials.new('bed')
bed.use_nodes = True
bb = bed.node_tree.nodes['Principled BSDF']
bb.inputs['Base Color'].default_value = (0.34, 0.32, 0.29, 1)
bb.inputs['Roughness'].default_value = 0.85
bpy.ops.mesh.primitive_grid_add(x_subdivisions=48, y_subdivisions=36, size=1, location=(0, 0, 0))
bed_ob = bpy.context.active_object
for v in bed_ob.data.vertices:
    tx, tz = v.co.x * 0.10, v.co.y * 0.086 - 0.004
    hh = height(tx, tz)
    if hh < 0.0008:
        v.co = (0, 0, -2)
    else:
        v.co = T(tx, max(0.0, hh - 0.0016), tz)
bed_ob.data.materials.clear()
bed_ob.data.materials.append(bed)

bpy.ops.render.render(write_still=True)
print('rendered', scene.render.filepath)
