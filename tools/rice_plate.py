# 요미산 고정 카메라에서 첫 화면 쌀더미처럼 낮고 넓게 렌더한다.
# three.js Y-up (x,y,z) -> blender Z-up (x, -z, y)
import bpy, math, json, os, random
from mathutils import Vector

random.seed(7)
OUT = '/tmp/rice_plate'
os.makedirs(OUT, exist_ok=True)

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.render.engine = 'CYCLES'
scene.cycles.samples = 28
scene.cycles.use_denoising = False
try:
    scene.cycles.device = 'CPU'
except Exception:
    pass
scene.view_settings.view_transform = 'Filmic'
scene.view_settings.look = 'Medium High Contrast'
scene.view_settings.exposure = 0.15
scene.render.resolution_x = 1784
scene.render.resolution_y = 824
scene.render.resolution_percentage = 100
scene.render.film_transparent = False
scene.render.image_settings.file_format = 'PNG'
scene.render.filepath = OUT + '/plate.png'
scene.world = bpy.data.worlds.new('w')
scene.world.use_nodes = True
bg = scene.world.node_tree.nodes['Background']
bg.inputs[0].default_value = (0.012, 0.008, 0.004, 1)  # ~#150f09 linear-ish
bg.inputs[1].default_value = 1.0

def T(x, y, z):
    return (x, -z, y)

# 카메라: pos (0,0.085,0.235) look (0,0.052,0), 세로 FOV 32°
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

# 따뜻한 부드러운 키
key = bpy.data.lights.new('key', 'AREA')
key.energy = 9
key.color = (1.0, 0.93, 0.82)
key.size = 0.22
ko = bpy.data.objects.new('key', key)
bpy.context.collection.objects.link(ko)
ko.location = T(0.12, 0.28, 0.16)
kc = ko.constraints.new('TRACK_TO')
kc.target = target
kc.track_axis = 'TRACK_NEGATIVE_Z'
kc.up_axis = 'UP_Y'
fill = bpy.data.lights.new('fill', 'AREA')
fill.energy = 2.2
fill.color = (1.0, 0.88, 0.75)
fill.size = 0.35
fo = bpy.data.objects.new('fill', fill)
bpy.context.collection.objects.link(fo)
fo.location = T(-0.16, 0.16, 0.22)
fc = fo.constraints.new('TRACK_TO')
fc.target = target
fc.track_axis = 'TRACK_NEGATIVE_Z'
fc.up_axis = 'UP_Y'

# 쟁반 200×145×16mm, 윗면 y=0
wood = bpy.data.materials.new('wood')
wood.use_nodes = True
nt = wood.node_tree
nt.nodes.clear()
out = nt.nodes.new('ShaderNodeOutputMaterial')
bsdf = nt.nodes.new('ShaderNodeBsdfPrincipled')
bsdf.inputs['Roughness'].default_value = 0.72
tex = nt.nodes.new('ShaderNodeTexImage')
img = bpy.data.images.load('/agent/repos/mobilejumsang/assets/wood_top_albedo.webp')
tex.image = img
# 첫 화면처럼 어두운 적갈. 채도를 눌러 주황으로 뜨지 않게.
hsv = nt.nodes.new('ShaderNodeHueSaturation')
hsv.inputs['Hue'].default_value = 0.52
hsv.inputs['Saturation'].default_value = 0.85
hsv.inputs['Value'].default_value = 0.28
nt.links.new(tex.outputs['Color'], hsv.inputs['Color'])
nt.links.new(hsv.outputs['Color'], bsdf.inputs['Base Color'])
nt.links.new(bsdf.outputs['BSDF'], out.inputs['Surface'])
tray = bpy.ops.mesh.primitive_cube_add(size=1, location=T(0, -0.008, 0))
tray = bpy.context.active_object
tray.scale = (0.200, 0.145, 0.016)
bpy.ops.object.transform_apply(scale=True)
bev = tray.modifiers.new('b', 'BEVEL')
bev.width = 0.004
bev.segments = 2
bpy.ops.object.modifier_apply(modifier='b')
tray.data.materials.append(wood)
# UV 대략
bpy.ops.object.mode_set(mode='EDIT')
bpy.ops.uv.smart_project(angle_limit=66)
bpy.ops.object.mode_set(mode='OBJECT')

# 낱알: 5.0×2.0×2.9mm 통통한 타원
bpy.ops.mesh.primitive_uv_sphere_add(segments=8, ring_count=5, radius=1, location=(0, 0, 0))
grain = bpy.context.active_object
grain.scale = (0.00250, 0.00145, 0.00100)
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
gmat = bpy.data.materials.new('rice')
gmat.use_nodes = True
gb = gmat.node_tree.nodes['Principled BSDF']
gb.inputs['Base Color'].default_value = (0.62, 0.58, 0.52, 1)
gb.inputs['Roughness'].default_value = 0.55
gb.inputs['Specular IOR Level'].default_value = 0.25
grain.data.materials.append(gmat)

# 낮고 넓은 더미 + 흩어진 알
domes = [
    (0.000, 0.000, 0.078, 0.018),
    (0.012, -0.008, 0.040, 0.010),
    (-0.014, 0.010, 0.036, 0.009),
    (0.006, 0.016, 0.030, 0.008),
]
def height(x, z):
    h = 0.0
    for cx, cz, rad, peak in domes:
        d = math.hypot(x - cx, z - cz) / rad
        if d < 1:
            h = max(h, peak * (1 - d * d) ** 1.15)
    return h

pts = []
# 속
for i in range(4200):
    x = random.uniform(-0.07, 0.07)
    z = random.uniform(-0.055, 0.055)
    h = height(x, z)
    if h < 0.002:
        continue
    y = random.uniform(0.001, h)
    pts.append((x, y, z, random.random() * math.tau, random.uniform(-0.4, 0.4)))
# 겉면
for i in range(2800):
    x = random.uniform(-0.07, 0.07)
    z = random.uniform(-0.055, 0.055)
    h = height(x, z)
    if h < 0.0015:
        continue
    y = h + random.uniform(-0.0004, 0.0006)
    pts.append((x, y, z, random.random() * math.tau, random.uniform(-0.5, 0.5)))
# 흩어진 알
for i in range(1700):
    a = random.random() * math.tau
    cluster = random.randrange(6)
    ca = cluster * 1.05 + random.uniform(-0.55, 0.55)
    rr = random.uniform(0.045, 0.088)
    x = math.cos(ca) * rr + random.uniform(-0.006, 0.006)
    z = math.sin(ca) * rr * 0.82 + random.uniform(-0.006, 0.006)
    if abs(x) > 0.092 or abs(z) > 0.066:
        continue
    if height(x, z) > 0.004:
        continue
    pts.append((x, 0.0011, z, random.random() * math.tau, random.uniform(-0.2, 0.2)))

print('grains', len(pts))

import bmesh
from mathutils import Matrix
me = grain.data
bm = bmesh.new()
nv = len(me.vertices)
for x, y, z, yaw, tilt in pts:
    M = Matrix.Translation(T(x, y, z)) @ Matrix.Rotation(yaw, 4, 'Z') @ Matrix.Rotation(tilt, 4, 'X')
    for v in me.vertices:
        bm.verts.new(M @ v.co)
bm.verts.ensure_lookup_table()
for gi in range(len(pts)):
    base = gi * nv
    for p in me.polygons:
        try:
            bm.faces.new([bm.verts[base + i] for i in p.vertices])
        except ValueError:
            pass
out_me = bpy.data.meshes.new('pile')
bm.to_mesh(out_me)
bm.free()
ob = bpy.data.objects.new('pile', out_me)
bpy.context.collection.objects.link(ob)
ob.data.materials.append(gmat)
grain.hide_render = True

# 깊이 격자
NX, NZ = 56, 42
xs0, xs1, zs0, zs1 = -0.10, 0.10, -0.072, 0.072
grid = [0.0] * (NX * NZ)
for x, y, z, yaw, tilt in pts:
    ix = int((x - xs0) / (xs1 - xs0) * (NX - 1))
    iz = int((z - zs0) / (zs1 - zs0) * (NZ - 1))
    if 0 <= ix < NX and 0 <= iz < NZ:
        top = y + 0.00105
        k = iz * NX + ix
        if top > grid[k]:
            grid[k] = top
for _ in range(2):
    nxt = grid[:]
    for iz in range(NZ):
        for ix in range(NX):
            m = grid[iz * NX + ix]
            for dz in (-1, 0, 1):
                for dx in (-1, 0, 1):
                    jx, jz = ix + dx, iz + dz
                    if 0 <= jx < NX and 0 <= jz < NZ:
                        m = max(m, grid[jz * NX + jx] * 0.92)
            nxt[iz * NX + ix] = m
    grid = nxt
json.dump({'nx': NX, 'nz': NZ, 'x0': xs0, 'x1': xs1, 'z0': zs0, 'z1': zs1, 'h': [round(v, 5) for v in grid]},
          open('/agent/repos/mobilejumsang/assets/rice_heap_h.json', 'w'))
print('height max', max(grid))

# 틈으로 검정이 비치지 않게, 더미 속에 같은 빛의 속을 깐다
bed = bpy.data.materials.new('bed')
bed.use_nodes = True
bb = bed.node_tree.nodes['Principled BSDF']
bb.inputs['Base Color'].default_value = (0.42, 0.40, 0.36, 1)
bb.inputs['Roughness'].default_value = 0.9
bpy.ops.mesh.primitive_grid_add(x_subdivisions=48, y_subdivisions=36, size=1, location=(0, 0, 0))
bed_ob = bpy.context.active_object
for v in bed_ob.data.vertices:
    tx, tz = v.co.x * 0.15, v.co.y * 0.11
    hh = height(tx, tz)
    if hh < 0.002:
        v.co = (0, 0, -2)
    else:
        v.co = T(tx, max(0.0005, hh - 0.0008), tz)
bed_ob.data.materials.clear()
bed_ob.data.materials.append(bed)

bpy.ops.render.render(write_still=True)
print('rendered', scene.render.filepath)
