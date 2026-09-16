"""主審之眼：打者模型與動作（右打者，左打者在遊戲中鏡像）

用法：
  blender --background --factory-startup --python blender/build_batter.py -- <輸出資料夾> [預覽圖路徑]

站位：打者面向 +X（本壘板），投手在 +Y，捕手在 -Y；原點在兩腳中間。
匯出後 +X 維持 +x、+Y 變成遊戲的 -z（投手方向）。

動畫分兩段，時間點寫在根節點的 extras：
  0 ~ idle_end        打擊準備的小幅晃棒，可循環
  idle_end ~ 結束     跟著投手出手的反應：拉棒、跨步、看球進捕手手套、放鬆、回到準備姿勢
  release_time        對應投手出手的瞬間
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from rig_common import *  # noqa: E402,F401,F403
import rig_common as rc  # noqa: E402
from mathutils import Vector  # noqa: E402

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
OUT_DIR = os.path.abspath(argv[0] if argv else ".")
PREVIEW = argv[1] if len(argv) > 1 else None

FPS = 60
IDLE_END = 1.6
RELEASE_T = 2.35
END_T = 4.4

new_scene(FPS, END_T)

# 客隊：配色結構跟參考圖一樣（有色球衣＋白褲＋白內搭＋有條紋的高筒襪），只是換成酒紅
MAROON = material("maroon", (0.26, 0.028, 0.045), 0.6)
PANTS = material("pants", (0.86, 0.845, 0.815), 0.65)
UNDER = material("under", (0.83, 0.83, 0.81), 0.6)
SOCK = material("sock", (0.17, 0.02, 0.03), 0.6)
STRIPE = material("stripe", (0.86, 0.845, 0.815), 0.6)
HELMET = material("helmet", (0.24, 0.022, 0.032), 0.2)
SKIN = material("skin", (0.79, 0.545, 0.375), 0.55)
BATTING_GLOVE = material("batting_glove", (0.85, 0.85, 0.83), 0.6)
SHOE = material("shoe", (0.03, 0.028, 0.03), 0.35)
WOOD = material("bat_wood", (0.62, 0.43, 0.22), 0.35)

N = skeleton("Batter")
N["root"]["release_time"] = RELEASE_T
N["root"]["idle_end"] = IDLE_END
standard_body(N, MAROON, PANTS, SOCK, SKIN, SHOE, under=UNDER, stripe=STRIPE)
jersey_number("7", STRIPE, N)

# 打擊頭盔：面向投手那一側（左耳）有護耳
mesh_obj("helmet", [
    sphere(0.132, (0, 0.006, 0.196), (1.0, 1.04, 1.12)),
    sphere(0.072, (0.118, 0.0, 0.142), (0.42, 1.0, 1.25)),
], HELMET, N["head"])
mesh_obj("helmet_brim", [seg(0.086, 0.086, 0.012, 0.0, sy=0.8)], HELMET, N["head"],
         loc=(0, -0.118, 0.176), rot=(-12, 0, 0))
bare_hand(N, "L", BATTING_GLOVE)
bare_hand(N, "R", BATTING_GLOVE)

# 球棒：節點原點在握把末端，棒身沿 +Z
bat = rc.node("bat", N["root"], (0, 0, 0))
bat["export_node"] = True
mesh_obj("bat_mesh", [
    sphere(0.028, (0, 0, 0), (1, 1, 0.5)),
    seg_up(0.014, 0.018, 0.40, 0.01),
    seg_up(0.018, 0.031, 0.22, 0.41, caps=False),
    seg_up(0.031, 0.033, 0.22, 0.63, caps=False),
    sphere(0.033, (0, 0, 0.85), (1, 1, 0.35)),
], WOOD, bat)

A = rc.ANKLE_H

# knob：握把末端位置；batdir：棒身方向（角色原點座標）
# 雙手要在胸前往本壘板方向伸出去一些，才不會穿進變壯後的身體
# 下手（左手）握在握把末端附近，上手（右手）在上方
STANCE = dict(
    pelvis=(0, -0.03, 0.89), prot=(14, 0, 90), crot=(4, 0, -8), kneeOut=0.2,
    footL=(0.02, 0.34, A), yawL=80, footR=(0.0, -0.34, A), yawR=90,
    knob=(0.32, -0.20, 1.22), batdir=(-0.25, -0.35, 0.90),
    elbowL=(0.3, 0.3, -1), elbowR=(-0.2, -1, -0.3),
    look=176, lookPitch=5,
)


def pose(t, **changes):
    k = dict(STANCE, t=t)
    k.update(changes)
    return k


KEYS = [
    pose(0.0),
    # 晃棒
    pose(0.5, crot=(4, 0, -10), knob=(0.32, -0.22, 1.25), batdir=(-0.10, -0.50, 0.86)),
    pose(1.0, crot=(4, 0, -6), knob=(0.33, -0.18, 1.20), batdir=(-0.35, -0.25, 0.90)),
    pose(IDLE_END),
    # 拉棒蓄力：前腳收回、雙手往捕手方向拉
    pose(2.0, pelvis=(0, -0.09, 0.89), prot=(14, 0, 84), crot=(4, 0, -20),
         footL=(0.0, 0.20, 0.15), yawL=85, knob=(0.30, -0.32, 1.26), batdir=(-0.10, -0.55, 0.83), look=178),
    pose(RELEASE_T, pelvis=(0, 0.0, 0.88), prot=(14, 0, 88), crot=(4, 0, -22),
         footL=(0.02, 0.44, 0.12), yawL=78, knob=(0.30, -0.33, 1.25), batdir=(-0.12, -0.50, 0.86), look=178),
    # 前腳落地，決定不揮棒，視線跟著球
    pose(2.5, pelvis=(0, 0.07, 0.86), prot=(14, 0, 92), crot=(4, 0, -22),
         footL=(0.03, 0.52, A), yawL=65, knob=(0.30, -0.33, 1.23), batdir=(-0.15, -0.48, 0.86),
         look=150, lookPitch=12),
    pose(2.8, pelvis=(0, 0.07, 0.86), prot=(14, 0, 92), crot=(4, 0, -20),
         footL=(0.03, 0.52, A), yawL=65, knob=(0.31, -0.32, 1.22), batdir=(-0.15, -0.48, 0.86),
         look=70, lookPitch=22),
    # 放鬆、把球棒放下來
    pose(3.2, pelvis=(0, 0.04, 0.90), prot=(6, 0, 92), crot=(0, 0, -5),
         footL=(0.03, 0.52, A), yawL=65, knob=(0.45, -0.05, 1.00), batdir=(0.35, -0.10, 0.93),
         elbowL=(0.2, 1, -1), elbowR=(0.2, -1, -1), look=110, lookPitch=10),
    # 前腳退回，回到準備姿勢
    pose(3.8, pelvis=(0, -0.02, 0.92), prot=(10, 0, 90), crot=(2, 0, -6),
         footL=(0.02, 0.34, 0.12), yawL=80, knob=(0.35, -0.15, 1.10), batdir=(-0.10, -0.30, 0.95), look=160),
    pose(END_T),
]

prev = {}


def place_bat(frame, k):
    d = Vector(k["batdir"]).normalized()
    knob = Vector(k["knob"])
    k["handL"] = tuple(knob + d * 0.05)
    k["handR"] = tuple(knob + d * 0.14)
    bat.location = knob
    bat.keyframe_insert("location", frame=frame)
    keyframe_quat(bat, aim(d, rest=Vector((0, 0, 1))), frame, prev)


# 取樣時需要 handL/handR 欄位才能解 IK，先用站姿值補上
for key in KEYS:
    key.setdefault("handL", (0, 0, 0))
    key.setdefault("handR", (0, 0, 0))

rest = capture_rest(N)
bake(N, Timeline(KEYS), FPS, END_T, hand_space="root", extra=place_bat)
skin_character(N, rest, FPS, END_T)

if PREVIEW:
    preview_sheet(PREVIEW, FPS, [
        ((7, 0.05, 1.0), (0, 0.05, 1.0), 2.4),
        ((0, -9, 1.0), (0, 0, 1.0), 2.4),
    ], [0.0, 2.0, RELEASE_T, 2.5, 2.8, 3.2], ground_center=(0, 0, 0))

export(OUT_DIR, "batter", "BATTER_GLB")
