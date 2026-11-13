# 더미 본체의 쌀 표면. 한 칸이 22mm이고, 칸 안 알은 길이 약 4.6mm.
# 블렌더 Z-up, 카메라가 내려다본다. 알베도는 발광색, 노멀은 월드 법선(OpenGL).
# blender -b -P tools/heap_tile.py -- /tmp/heap_tile
import bpy, bmesh, math, os, random, sys
from mathutils import Vector

argv = sys.argv
out = argv[argv.index('--') + 1] if '--' in argv else '/tmp/heap_tile'
os.makedirs(out, exist_ok=True)

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.render.engine = 'CYCLES'
scene.cycles.device = 'CPU'
scene.cycles.samples = 1
scene.cycles.use_denoising = False
scene.render.resolution_x = 1024
scene.render.resolution_y = 1024
scene.render.film_transparent = False

TILE = 0.022
rng = random.Random(11)

def make_grain(name):
    mesh = bpy.data.meshes.new(name + '_m')
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=12, v_segments=8, radius=1.0)
    for v in bm.verts:
        x, y, z = v.co
        t = abs(x)
        shoulder = 0.62
        if t <= shoulder:
            end = 1.0
        else:
            u = (t - shoulder) / (1.0 - shoulder)
            end = math.sqrt(max(0.0, 1.0 - u * u))
        v.co.x = x * 0.00215          # 길이 4.3mm
        v.co.y = y * end * 0.00115    # 폭 2.3mm. 고치처럼 통통하지 않다
        v.co.z = z * end * 0.00055    # 두께 1.1mm
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(mesh)
    bm.free()
    for p in mesh.polygons:
        p.use_smooth = True
    mesh.update()
    return obj

proto = make_grain('proto')
proto.hide_render = True

def color_mat(rgb):
    mat = bpy.data.materials.new('alb')
    mat.use_nodes = True
    nt = mat.node_tree
    nt.nodes.clear()
    out = nt.nodes.new('ShaderNodeOutputMaterial')
    em = nt.nodes.new('ShaderNodeEmission')
    em.inputs['Color'].default_value = (*rgb, 1)
    em.inputs['Strength'].default_value = 1
    nt.links.new(em.outputs['Emission'], out.inputs['Surface'])
    return mat

def varied_albedo():
    mat = bpy.data.materials.new('alb')
    mat.use_nodes = True
    nt = mat.node_tree
    nt.nodes.clear()
    out = nt.nodes.new('ShaderNodeOutputMaterial')
    em = nt.nodes.new('ShaderNodeEmission')
    info = nt.nodes.new('ShaderNodeObjectInfo')
    ramp = nt.nodes.new('ShaderNodeValToRGB')
    ramp.color_ramp.elements[0].position = 0.15
    ramp.color_ramp.elements[0].color = (0.86, 0.82, 0.74, 1)
    ramp.color_ramp.elements[1].position = 0.85
    ramp.color_ramp.elements[1].color = (0.97, 0.95, 0.90, 1)
    mid = ramp.color_ramp.elements.new(0.55)
    mid.color = (0.93, 0.90, 0.84, 1)
    nt.links.new(info.outputs['Random'], ramp.inputs['Fac'])
    nt.links.new(ramp.outputs['Color'], em.inputs['Color'])
    nt.links.new(em.outputs['Emission'], out.inputs['Surface'])
    return mat

alb = varied_albedo()
bed = color_mat((0.72, 0.67, 0.58))

def normal_mat():
    mat = bpy.data.materials.new('nrm')
    mat.use_nodes = True
    nt = mat.node_tree
    nt.nodes.clear()
    out = nt.nodes.new('ShaderNodeOutputMaterial')
    em = nt.nodes.new('ShaderNodeEmission')
    geo = nt.nodes.new('ShaderNodeNewGeometry')
    sep = nt.nodes.new('ShaderNodeSeparateXYZ')
    comb = nt.nodes.new('ShaderNodeCombineXYZ')
    nt.links.new(geo.outputs['Normal'], sep.inputs['Vector'])
    for axis, sock in (('X', 'X'), ('Y', 'Y'), ('Z', 'Z')):
        m = nt.nodes.new('ShaderNodeMath')
        m.operation = 'MULTIPLY_ADD'
        m.inputs[1].default_value = 0.5
        m.inputs[2].default_value = 0.5
        nt.links.new(sep.outputs[axis], m.inputs[0])
        nt.links.new(m.outputs['Value'], comb.inputs[axis])
    nt.links.new(comb.outputs['Vector'], em.inputs['Color'])
    nt.links.new(em.outputs['Emission'], out.inputs['Surface'])
    return mat

nrm = normal_mat()

bpy.ops.mesh.primitive_plane_add(size=TILE, location=(TILE/2, TILE/2, 0))
plane = bpy.context.active_object
plane.data.materials.append(bed)

grains = []
step = 0.00172
n = int(TILE / step)
for i in range(n):
    for j in range(n):
        x = (i + 0.5) * step + (rng.random() - 0.5) * step * 0.55
        y = (j + 0.5) * step + (rng.random() - 0.5) * step * 0.55
        x %= TILE
        y %= TILE
        shifts = [(0, 0)]
        if x < 0.0026: shifts.append((TILE, 0))
        if x > TILE - 0.0026: shifts.append((-TILE, 0))
        if y < 0.0026: shifts.append((0, TILE))
        if y > TILE - 0.0026: shifts.append((0, -TILE))
        if x < 0.0026 and y < 0.0026: shifts.append((TILE, TILE))
        if x < 0.0026 and y > TILE - 0.0026: shifts.append((TILE, -TILE))
        if x > TILE - 0.0026 and y < 0.0026: shifts.append((-TILE, TILE))
        if x > TILE - 0.0026 and y > TILE - 0.0026: shifts.append((-TILE, -TILE))
        for sx, sy in shifts:
            ob = proto.copy()
            ob.data = proto.data
            bpy.context.collection.objects.link(ob)
            ob.hide_render = False
            ob.location = (x + sx, y + sy, 0.00058)
            ob.rotation_euler = (
                (rng.random() - 0.5) * 0.35,
                (rng.random() - 0.5) * 0.35,
                rng.random() * math.tau,
            )
            sc = 0.92 + rng.random() * 0.14
            ob.scale = (sc, sc * (0.9 + rng.random() * 0.15), sc)
            if not ob.data.materials:
                ob.data.materials.append(alb)
            grains.append(ob)

cam_data = bpy.data.cameras.new('cam')
cam_data.type = 'ORTHO'
cam_data.ortho_scale = TILE
cam_data.clip_start = 0.0001
cam_data.clip_end = 1.0
cam = bpy.data.objects.new('cam', cam_data)
bpy.context.collection.objects.link(cam)
cam.location = (TILE / 2, TILE / 2, 0.08)
cam.rotation_euler = (0, 0, 0)
scene.camera = cam
world = scene.world or bpy.data.worlds.new('w')
scene.world = world
world.use_nodes = True
bg = world.node_tree.nodes.get('Background')
if bg:
    bg.inputs['Strength'].default_value = 0

try:
    scene.view_settings.view_transform = 'Standard'
except Exception:
    scene.view_settings.view_transform = 'Raw'
scene.view_settings.look = 'None'
scene.view_settings.exposure = 0
scene.view_settings.gamma = 1

def render(path):
    scene.render.filepath = path
    scene.render.image_settings.file_format = 'PNG'
    scene.render.image_settings.color_mode = 'RGB'
    bpy.ops.render.render(write_still=True)
    print('rendered', path)

render(os.path.join(out, 'heap_albedo.png'))

for ob in grains:
    ob.data.materials[0] = nrm
plane.data.materials[0] = nrm
render(os.path.join(out, 'heap_normal.png'))
print('DONE', out)
