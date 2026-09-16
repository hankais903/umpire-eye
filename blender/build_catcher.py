"""主審之眼：捕手模型與蹲姿動作

用法：
  blender --background --factory-startup --python blender/build_catcher.py -- <輸出資料夾> [預覽圖路徑]

捕手面向 +Y（投手方向），原點在兩腳中間。匯出後面向遊戲的 -z。
動畫只有蹲姿的呼吸與重心微晃（可循環）。接球手（左手）的位置由遊戲即時用 IK
控制，這樣配球、接球、偷好球時手套才會真的跟著手臂移動。
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from rig_common import *  # noqa: E402,F401,F403
import rig_common as rc  # noqa: E402

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
OUT_DIR = os.path.abspath(argv[0] if argv else ".")
PREVIEW = argv[1] if len(argv) > 1 else None

FPS = 60
END_T = 2.0

new_scene(FPS, END_T)

# 捕手跟投手同隊，用參考圖的配色
JERSEY = material("jersey", (0.0684, 0.1329, 0.2957), 0.6)
PANTS = material("pants", (0.89, 0.8689, 0.8276), 0.65)
UNDER = material("under", (0.8481, 0.8481, 0.8276), 0.6)
SOCK = material("sock", (0.047, 0.0946, 0.214), 0.6)
STRIPE = material("stripe", (0.89, 0.8689, 0.8276), 0.6)
NAVY = material("navy", (0.0397, 0.0783, 0.1873), 0.5)
GEAR = material("gear", (0.03, 0.04, 0.065), 0.3)
METAL = material("mask_metal", (0.22, 0.23, 0.25), 0.3)
SKIN = material("skin", (0.8276, 0.5705, 0.3931), 0.55)
MITT = material("mitt", (0.2633, 0.1005, 0.0272), 0.45)
SHOE = material("shoe", (0.022, 0.0363, 0.0835), 0.35)

N = skeleton("Catcher")
standard_body(N, JERSEY, PANTS, SOCK, SKIN, SHOE, build=1.05, under=UNDER, stripe=STRIPE)

# 頭盔與面罩（臉朝頭部的 -Y）
mesh_obj("catcher_helmet", [sphere(0.139, (0, 0.012, 0.175), (1.04, 1.06, 1.25))], GEAR, N["head"])
bars = [rbox((0.2, 0.014, 0.014), (0, -0.148, z), 0.006) for z in (0.06, 0.115, 0.17)]
bars += [rbox((0.014, 0.014, 0.15), (x, -0.15, 0.115), 0.006) for x in (-0.05, 0.05)]
bars.append(rbox((0.08, 0.012, 0.06), (0, -0.12, 0.0), 0.01))
mesh_obj("catcher_mask", bars, METAL, N["head"])

# 護胸與護肩
mesh_obj("chest_protector", [
    rbox((0.36, 0.08, 0.47), (0, -0.14, 0.22), 0.035),
    sphere(0.075, (0.2, -0.03, 0.42), (1, 1, 0.6)),
    sphere(0.075, (-0.2, -0.03, 0.42), (1, 1, 0.6)),
], GEAR, N["chest"])

# 深蹲時臀部的蒙皮會擠出褶皺，用一塊跟著骨盆動的平滑臀部外型蓋住（從主審方向看得到）
mesh_obj("seat", [
    sphere(0.135, (0, 0.03, -0.01), (1.32, 0.9, 0.86)),
], JERSEY, N["pelvis"])

# 護膝護脛
for side in ("L", "R"):
    mesh_obj("shin_guard_" + side, [
        sphere(0.082, (0, -0.025, 0), (1, 1.1, 1)),
        seg(0.078, 0.064, 0.40, -0.02, sy=1.15),
    ], GEAR, N["shin_" + side])

bare_hand(N, "R", SKIN)
mesh_obj("mitt", [
    sphere(0.14, (0, 0, -0.1), (0.5, 1.0, 1.0)),
    sphere(0.045, (0.0, -0.1, -0.02), (0.8, 1.0, 1.4)),
], MITT, N["hand_L"])

A = rc.ANKLE_H

# 捕手姿勢：面向 +Y（prot 的 Z = 180），骨盆壓低、軀幹前傾，膝蓋外開
SQUAT = dict(
    pelvis=(0, -0.14, 0.42), prot=(42, 0, 180), crot=(10, 0, 0), kneeOut=0.35,
    footL=(-0.28, 0.02, A), yawL=195, footR=(0.28, 0.02, A), yawR=165,
    handL=(0.10, -0.40, 0.30), elbowL=(1, 0.3, -1),
    handR=(-0.32, 0.05, -0.38), elbowR=(-1, 0.5, -0.5),
    look=180, lookPitch=-8,
)


def pose(t, **changes):
    k = dict(SQUAT, t=t)
    k.update(changes)
    return k


KEYS = [
    pose(0.0),
    pose(1.0, pelvis=(0.02, -0.13, 0.43), crot=(8, 0, 2), handL=(0.10, -0.41, 0.31)),
    pose(END_T),
]

rest = capture_rest(N)
bake(N, Timeline(KEYS), FPS, END_T)

rc.scene.frame_set(0)
import bpy  # noqa: E402
bpy.context.view_layer.update()
helmet = bpy.data.objects["catcher_helmet"]
top = max((helmet.matrix_world @ v.co).z for v in helmet.data.vertices)
print("HELMET_TOP_BLENDER_Z", round(top, 3), "HEAD_Y", round(N["head"].matrix_world.translation.y, 3))

skin_character(N, rest, FPS, END_T)

if PREVIEW:
    preview_sheet(PREVIEW, FPS, [
        ((7, 0.0, 0.6), (0, 0.0, 0.6), 1.8),
        ((0, -9, 0.6), (0, 0, 0.6), 1.8),
        ((0, 9, 0.6), (0, 0, 0.6), 1.8),
    ], [0.0, 1.0], ground_center=(0, 0, 0))

export(OUT_DIR, "catcher", "CATCHER_GLB")
