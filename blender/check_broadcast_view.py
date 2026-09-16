"""用 Blender 依推算出的主審攝影機參數畫出球場線條，跟轉播照片對照構圖。

用法：blender --background --factory-startup --python blender/check_broadcast_view.py -- <輸出 PNG> <眼高> <距本壘板尖端> <俯角> <垂直視野>
遊戲座標 (x, y, z) → Blender (x, -z, y)。
"""

import math
import sys

import bmesh
import bpy
from mathutils import Euler

args = sys.argv[sys.argv.index("--") + 1:]
OUT = args[0]
EYE_Y, EYE_Z, PITCH, VFOV = (float(a) for a in args[1:5])
CATCHER = [float(a) for a in args[5:8]] if len(args) >= 8 else None

IN, FT = 0.0254, 0.3048
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene


def mat(rgb):
    m = bpy.data.materials.new("m")
    m.diffuse_color = (*rgb, 1)
    return m


def poly(name, pts_game_xz, y, rgb):
    me = bpy.data.meshes.new(name)
    bm = bmesh.new()
    vs = [bm.verts.new((x, -z, y)) for x, z in pts_game_xz]
    bm.faces.new(vs)
    bm.to_mesh(me)
    bm.free()
    me.materials.append(mat(rgb))
    ob = bpy.data.objects.new(name, me)
    scene.collection.objects.link(ob)


def line(x1, z1, x2, z2, w=3 * IN, y=0.002):
    dx, dz = x2 - x1, z2 - z1
    L = math.hypot(dx, dz)
    nx, nz = -dz / L * w / 2, dx / L * w / 2
    poly("line", [(x1 + nx, z1 + nz), (x2 + nx, z2 + nz), (x2 - nx, z2 - nz), (x1 - nx, z1 - nz)], y, (0.95, 0.95, 0.92))


def box3(center_game, size, rgb):
    bpy.ops.mesh.primitive_cube_add(size=1)
    ob = bpy.context.active_object
    x, y, z = center_game
    ob.location = (x, -z, y)
    ob.scale = size
    ob.data.materials.append(mat(rgb))


poly("dirt", [(-30, 5), (30, 5), (30, -40), (-30, -40)], 0, (0.45, 0.25, 0.15))
H, F, S = 8.5 * IN, -17 * IN, -8.5 * IN
poly("plate", [(-H, F), (H, F), (H, S), (0, 0), (-H, S)], 0.004, (0.97, 0.97, 0.97))
line(0.3, -0.3, 40, -40)
line(-0.3, -0.3, -40, -40)
bi, bo = H + 6 * IN, H + 6 * IN + 4 * FT
z1, z2 = S - 3 * FT, S + 3 * FT
for s in (-1, 1):
    line(s * bi, z1, s * bi, z2)
    line(s * bo, z1, s * bo, z2)
    line(s * bi, z1, s * bo, z1)
    line(s * bi, z2, s * bo, z2)
box3((0, 0.12, -60.5 * FT), (5.5, 5.5, 0.25), (0.5, 0.3, 0.2))    # 投手丘
box3((0, 1.15, -60.5 * FT + 0.3), (0.45, 0.3, 1.9), (0.2, 0.3, 0.6))  # 投手
box3((0.9, 0.9, -0.2), (0.4, 0.4, 1.8), (0.9, 0.8, 0.2))            # 左打者
if CATCHER:
    bpy.ops.mesh.primitive_uv_sphere_add(radius=0.13, location=(CATCHER[0], -CATCHER[2], CATCHER[1]))
    bpy.context.active_object.data.materials.append(mat((0.05, 0.05, 0.06)))

cam_data = bpy.data.cameras.new("cam")
cam_data.sensor_fit = "VERTICAL"
cam_data.angle_y = math.radians(VFOV)
cam_data.clip_start = 0.02
cam = bpy.data.objects.new("cam", cam_data)
scene.collection.objects.link(cam)
cam.location = (0, -EYE_Z, EYE_Y)
cam.rotation_euler = Euler((math.radians(90 - PITCH), 0, 0), "XYZ")  # 相機預設朝 -Z，轉到朝 +Y 再往下看
scene.camera = cam

scene.render.engine = "BLENDER_WORKBENCH"
scene.display.shading.color_type = "MATERIAL"
scene.render.resolution_x, scene.render.resolution_y = 765, 565
scene.render.filepath = OUT
world = bpy.data.worlds.new("w")
world.color = (0.2, 0.35, 0.2)
scene.world = world
bpy.ops.render.render(write_still=True)
