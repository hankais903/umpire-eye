"""主審之眼：投手模型與投球動作（上肩投 / 側投 / 下勾投）

用法（背景執行，不需打開 Blender）：
  blender --background --factory-startup --python blender/build_pitcher.py -- <輸出資料夾> [預覽圖路徑] [投法]
  投法：over（上肩、四分之三，預設）、side（側投）、sub（下勾投）

產出：
  over → pitcher.glb、pitcher-model.js（PITCHER_GLB）
  side → pitcher-side.glb、pitcher-side-model.js（PITCHER_SIDE_GLB）
  sub  → pitcher-sub.glb、pitcher-sub-model.js（PITCHER_SUB_GLB）
投手面向 -Y（本壘方向），匯出後對應遊戲的 +z。出手瞬間寫在根節點的 release_time。
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from rig_common import *  # noqa: E402,F401,F403
import rig_common as rc  # noqa: E402

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
OUT_DIR = os.path.abspath(argv[0] if argv else ".")
PREVIEW = argv[1] if len(argv) > 1 and argv[1] != "-" else None
STYLE = argv[2] if len(argv) > 2 else "over"
assert STYLE in ("over", "side", "sub"), STYLE

FPS = 60
RELEASE_T = 1.10  # 出手瞬間（秒），遊戲以此對齊球的物理起點
END_T = 1.90

new_scene(FPS, END_T)

# 配色照參考圖 reference/player_front.jpg（數值是線性色彩空間）
JERSEY = material("jersey", (0.0684, 0.1329, 0.2957), 0.6)   # 藍色球衣
PANTS = material("pants", (0.89, 0.8689, 0.8276), 0.65)      # 白色球褲
UNDER = material("under", (0.8481, 0.8481, 0.8276), 0.6)     # 白色內搭長袖
SOCK = material("sock", (0.047, 0.0946, 0.214), 0.6)         # 深藍高筒襪、皮帶、領口
STRIPE = material("stripe", (0.89, 0.8689, 0.8276), 0.6)     # 襪子上的兩道白條
NAVY = material("navy", (0.0397, 0.0783, 0.1873), 0.5)       # 帽子
SKIN = material("skin", (0.8276, 0.5705, 0.3931), 0.55)
HAIR = material("hair", (0.0153, 0.0196, 0.0397), 0.45)
LEATHER = material("glove", (0.2633, 0.1005, 0.0272), 0.45)
SHOE = material("shoe", (0.022, 0.0363, 0.0835), 0.35)
BALL = material("ball", (0.92, 0.90, 0.84), 0.5)

N = skeleton("Pitcher")
N["root"]["release_time"] = RELEASE_T
N["root"]["style"] = STYLE
standard_body(N, JERSEY, PANTS, SOCK, SKIN, SHOE, under=UNDER, stripe=STRIPE, hair=HAIR)
jersey_number({"over": "18", "side": "21", "sub": "36"}[STYLE], STRIPE, N)

mesh_obj("cap", [
    sphere(0.127, (0, 0.008, 0.222), (0.97, 1.0, 0.82)),
    seg(0.104, 0.104, 0.013, 0.236, sy=0.88),
], NAVY, N["head"])
mesh_obj("cap_brim", [seg(0.086, 0.086, 0.013, 0.0, sy=0.82)], NAVY, N["head"],
         loc=(0, -0.112, 0.199), rot=(-10, 0, 0))
bare_hand(N, "R", SKIN)
mesh_obj("ball_in_hand", [sphere(0.037, u=20, v=12)], BALL, N["hand_R"], loc=(0, -0.035, -0.075))
mesh_obj("glove", [
    sphere(0.1, (0, 0, -0.08), (0.45, 0.95, 1.25)),
    sphere(0.035, (0.0, -0.075, -0.03), (0.8, 1.0, 1.6)),
], LEATHER, N["hand_L"])

A = rc.ANKLE_H

# ---------- 投球動作關鍵姿勢（右投） ----------
# pelvis：髖部中心位置；prot / crot：骨盆與胸部旋轉（度，XYZ；胸部相對骨盆）
#   crot 的 Y 是軀幹左右傾：正值往手套側（+X）傾，負值往投球手側傾
# foot：腳踝目標位置；yaw：腳尖朝向（0 = 朝本壘 -Y）
# hand：手的目標位置，以胸部座標表示（胸部面向自己的 -Y）；elbow：手肘極向量
# 頭部預設在世界座標面向本壘，眼睛始終看著捕手

# 準備到抬腿：三種投法共用
WINDUP = [
    # 固定式準備：左肩對本壘，雙手在胸前
    dict(t=0.00, pelvis=(0, -0.22, 0.95), prot=(0, 0, -90), crot=(6, 0, 0),
         footL=(0.0, -0.46, A), yawL=-80, footR=(0.0, 0.03, A), yawR=-90,
         handL=(0.04, -0.27, 0.06), elbowL=(1, 0.2, -1), handR=(-0.04, -0.27, 0.04), elbowR=(-1, 0.2, -1)),
    dict(t=0.25, pelvis=(0, -0.12, 0.95), prot=(0, 0, -92), crot=(4, 0, -4),
         footL=(-0.05, -0.30, 0.16), yawL=-85, footR=(0.0, 0.03, A), yawR=-90,
         handL=(0.04, -0.26, 0.12), elbowL=(1, 0.2, -1), handR=(-0.04, -0.26, 0.10), elbowR=(-1, 0.2, -1)),
    # 抬腿最高點：身體往二壘方向扭轉蓄力
    dict(t=0.55, pelvis=(0, -0.02, 0.94), prot=(-4, 0, -102), crot=(-2, 0, -10),
         footL=(-0.22, -0.05, 0.52), yawL=-100, footR=(0.0, 0.03, A), yawR=-90,
         handL=(0.04, -0.25, 0.16), elbowL=(1, 0.2, -1), handR=(-0.04, -0.25, 0.14), elbowR=(-1, 0.2, -1)),
]

OVER = [
    # 分手、往本壘跨步
    dict(t=0.80, pelvis=(0, -0.55, 0.83), prot=(0, 0, -96), crot=(0, 0, -6),
         footL=(0.0, -1.0, 0.22), yawL=-60, footR=(0.0, 0.03, A), yawR=-90,
         handL=(0.50, -0.12, 0.18), elbowL=(0, 0.6, -1), handR=(-0.62, 0.08, 0.05), elbowR=(0, 0.6, -1)),
    # 前腳落地：髖部開始打開，肩膀仍保持關閉（髖肩分離）
    dict(t=0.95, pelvis=(0, -0.86, 0.80), prot=(0, 0, -52), crot=(4, 0, -38),
         footL=(0.06, -1.46, A), yawL=-25, footR=(0.0, -0.08, 0.10), yawR=-80,
         handL=(0.58, -0.1, 0.26), elbowL=(0, 1, -0.6), handR=(-0.44, 0.10, 0.50), elbowR=(-1, 0, -0.4)),
    # 手臂最大後倒
    dict(t=1.03, pelvis=(0, -1.0, 0.79), prot=(0, 0, -18), crot=(16, 0, -42),
         footL=(0.06, -1.46, A), yawL=-25, footR=(-0.02, -0.32, 0.14), yawR=-60,
         handL=(0.36, -0.26, 0.10), elbowL=(1, 0.3, -1), handR=(-0.36, 0.36, 0.34), elbowR=(-1, 0, -0.3)),
    # 出手（四分之三側投）：軀幹往手套側傾，投球手伸到頭部前上方
    dict(t=RELEASE_T, pelvis=(0, -1.12, 0.79), prot=(0, 0, 2), crot=(24, 8, 16),
         footL=(0.06, -1.46, A), yawL=-25, footR=(-0.05, -0.56, 0.24), yawR=-30,
         handL=(0.24, -0.22, 0.0), elbowL=(1, 0.3, -1), handR=(-0.45, -0.30, 0.78), elbowR=(-1, 0.4, -0.5)),
    # 收尾：投球手甩到左膝外側
    dict(t=1.40, pelvis=(0, -1.26, 0.72), prot=(0, 0, 26), crot=(48, 0, 22),
         footL=(0.06, -1.46, A), yawL=-25, footR=(-0.28, -1.05, 0.34), yawR=0,
         handL=(0.30, 0.08, -0.04), elbowL=(1, 0.5, -1), handR=(0.26, -0.36, -0.30), elbowR=(-0.5, 0.6, -1)),
]

SIDE = [
    dict(t=0.80, pelvis=(0, -0.58, 0.80), prot=(0, 0, -96), crot=(4, 0, -6),
         footL=(0.0, -1.02, 0.2), yawL=-60, footR=(0.0, 0.03, A), yawR=-90,
         handL=(0.50, -0.12, 0.12), elbowL=(0, 0.6, -1), handR=(-0.62, 0.08, 0.0), elbowR=(0, 0.6, -1)),
    # 前腳落地：手臂在肩膀高度往後拉
    dict(t=0.95, pelvis=(0, -0.90, 0.76), prot=(0, 0, -52), crot=(8, -6, -38),
         footL=(0.06, -1.50, A), yawL=-25, footR=(0.0, -0.08, 0.10), yawR=-80,
         handL=(0.58, -0.1, 0.2), elbowL=(0, 1, -0.6), handR=(-0.58, 0.12, 0.30), elbowR=(-0.4, 0.6, -1)),
    dict(t=1.03, pelvis=(0, -1.02, 0.75), prot=(0, 0, -18), crot=(16, -8, -42),
         footL=(0.06, -1.50, A), yawL=-25, footR=(-0.02, -0.32, 0.14), yawR=-60,
         handL=(0.36, -0.26, 0.05), elbowL=(1, 0.3, -1), handR=(-0.55, 0.38, 0.25), elbowR=(-0.5, 0.3, -1)),
    # 出手（側投）：軀幹不往手套側傾，手臂與地面接近平行，在身體外側出手
    dict(t=RELEASE_T, pelvis=(0, -1.14, 0.74), prot=(0, 0, 2), crot=(22, -10, 18),
         footL=(0.06, -1.50, A), yawL=-25, footR=(-0.05, -0.56, 0.22), yawR=-30,
         handL=(0.24, -0.22, -0.05), elbowL=(1, 0.3, -1), handR=(-0.68, -0.34, 0.36), elbowR=(-0.3, 0.4, -1)),
    # 收尾：手臂在腰部高度橫掃過身體
    dict(t=1.40, pelvis=(0, -1.28, 0.70), prot=(0, 0, 28), crot=(40, -4, 24),
         footL=(0.06, -1.50, A), yawL=-25, footR=(-0.30, -1.05, 0.30), yawR=0,
         handL=(0.30, 0.08, -0.06), elbowL=(1, 0.5, -1), handR=(0.30, -0.38, -0.05), elbowR=(-0.5, 0.6, -1)),
]

SUB = [
    # 跨步時就壓低重心
    dict(t=0.80, pelvis=(0, -0.62, 0.74), prot=(4, 0, -96), crot=(10, 0, -6),
         footL=(0.0, -1.08, 0.18), yawL=-60, footR=(0.0, 0.03, A), yawR=-90,
         handL=(0.50, -0.15, 0.05), elbowL=(0, 0.6, -1), handR=(-0.62, 0.08, -0.10), elbowR=(0, 0.6, -1)),
    # 前腳大步落地，膝蓋深蹲，軀幹往投球手側與前方大幅傾斜
    dict(t=0.95, pelvis=(0, -0.95, 0.64), prot=(10, 0, -52), crot=(30, -20, -38),
         footL=(0.06, -1.58, A), yawL=-25, footR=(0.0, -0.10, 0.10), yawR=-80,
         handL=(0.50, -0.20, 0.10), elbowL=(0, 1, -0.6), handR=(-0.50, 0.15, -0.05), elbowR=(-0.3, 0.8, -1)),
    dict(t=1.03, pelvis=(0, -1.08, 0.62), prot=(12, 0, -18), crot=(40, -26, -40),
         footL=(0.06, -1.58, A), yawL=-25, footR=(-0.02, -0.34, 0.12), yawR=-60,
         handL=(0.30, -0.30, -0.05), elbowL=(1, 0.3, -1), handR=(-0.50, 0.35, -0.15), elbowR=(-0.3, 0.5, -1)),
    # 出手（下勾）：手在膝蓋高度、身體外側往上甩出
    dict(t=RELEASE_T, pelvis=(0, -1.26, 0.60), prot=(14, 0, 4), crot=(40, -30, 12),
         footL=(0.06, -1.58, A), yawL=-25, footR=(-0.08, -0.62, 0.16), yawR=-30,
         handL=(0.22, -0.26, -0.10), elbowL=(1, 0.3, -1), handR=(-0.72, -0.48, -0.06), elbowR=(-0.2, 0.4, -1)),
    # 收尾：投球手往上甩過身體
    dict(t=1.40, pelvis=(0, -1.32, 0.62), prot=(10, 0, 30), crot=(42, -18, 26),
         footL=(0.06, -1.58, A), yawL=-25, footR=(-0.30, -1.10, 0.28), yawR=0,
         handL=(0.28, 0.05, -0.10), elbowL=(1, 0.5, -1), handR=(0.25, -0.40, 0.20), elbowR=(-0.5, 0.6, -1)),
]

# 守備準備姿勢
FINISH = dict(t=END_T, pelvis=(0, -1.36, 0.82), prot=(0, 0, 0), crot=(16, 0, 0),
              footL=(0.2, -1.46, A), yawL=-10, footR=(-0.28, -1.36, A), yawR=10,
              handL=(0.2, -0.3, -0.04), elbowL=(1, 0.3, -1), handR=(-0.2, -0.3, -0.06), elbowR=(-1, 0.3, -1))

KEYS = WINDUP + {"over": OVER, "side": SIDE, "sub": SUB}[STYLE] + [FINISH]

rest = capture_rest(N)
bake(N, Timeline(KEYS), FPS, END_T)

rc.scene.frame_set(round(RELEASE_T * FPS))
import bpy  # noqa: E402
bpy.context.view_layer.update()
print("RELEASE_WORLD_BLENDER", STYLE, tuple(round(x, 3) for x in N["hand_R"].matrix_world.translation))

# 只要骨架動畫的模式（給 build_pitcher_tripo.py 用）：做到這裡就停，
# 讓 build_pitcher_tripo.py 接手把動作轉移到外部模型上
if not os.environ.get("PITCHER_RIG_ONLY"):
    skin_character(N, rest, FPS, END_T)

    if PREVIEW:
        preview_sheet(PREVIEW, FPS, [
            ((7, -0.75, 1.0), (0, -0.75, 1.0), 2.6),
            ((0, -9, 1.0), (0, 0, 1.0), 2.6),
        ], [0.0, 0.55, 0.80, 0.95, 1.03, RELEASE_T, 1.40], ground_center=(0, -0.8, 0))

    name, js_global = {"over": ("pitcher", "PITCHER_GLB"), "side": ("pitcher-side", "PITCHER_SIDE_GLB"),
                       "sub": ("pitcher-sub", "PITCHER_SUB_GLB")}[STYLE]
    export(OUT_DIR, name, js_global)
