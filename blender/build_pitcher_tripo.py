"""把 Tripo 球員模型接上程式產生的投球動作，輸出遊戲用的投手模型。

用法：
  blender --background --factory-startup --python blender/build_pitcher_tripo.py -- <輸出資料夾> <模型.glb> [投法] [預覽圖]
  投法：over（上肩，預設）、side（側投）、sub（下勾投）

做法：先跑 build_pitcher.py 的「只要骨架」模式，得到一整組會動的空物件（骨架節點），
再用約束把 Tripo 的骨架黏上去（四肢用兩節 IK，軀幹用瞄準＋滾轉鎖定），最後烘成關鍵影格。
"""

import base64
import math
import os
import runpy
import sys

import bpy
from mathutils import Vector

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import tripo_fix  # noqa: E402

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
OUT_DIR = os.path.abspath(argv[0])
MODEL = os.path.abspath(argv[1])
STYLE = argv[2] if len(argv) > 2 else "over"
PREVIEW = argv[3] if len(argv) > 3 and argv[3] != "-" else None

# ---------- 1. 跑出程式版投手的骨架動畫（空物件） ----------
os.environ["PITCHER_RIG_ONLY"] = "1"
sys.argv = [sys.argv[0], "--", OUT_DIR, "-", STYLE]
g = runpy.run_path(os.path.join(HERE, "build_pitcher.py"), run_name="pitcher_rig")
N, FPS, RELEASE_T, END_T = g["N"], g["FPS"], g["RELEASE_T"], g["END_T"]
rc = g["rc"]
scene = rc.scene
del os.environ["PITCHER_RIG_ONLY"]

# ---------- 2. 匯入並整理 Tripo 模型 ----------
arm, body = tripo_fix.prepare(MODEL, reset=False, facing=-1)   # 面向 -Y＝本壘板
bpy.context.view_layer.update()
hip_z = (arm.matrix_world @ arm.data.bones["Hip"].head_local).z
root = tripo_fix._root_of(arm)
k = rc.STAND_HIP / hip_z          # 髖高對齊程式版骨架，四肢長度才吻合
root.scale *= k
bpy.context.view_layer.update()
print("TRIPO scale", round(k, 4), "hip", round(hip_z * k, 3))

# ---------- 3. 幫程式版骨架補上「瞄準用」的目標點 ----------
def target(name, parent, loc):
    e = bpy.data.objects.new(name, None)
    e.empty_display_size = 0.05
    scene.collection.objects.link(e)
    e.parent = parent
    e.location = loc
    return e

T = {
    "pelvis_side": target("t_pelvis_side", N["pelvis"], (0.4, 0, 0)),
    "chest_side": target("t_chest_side", N["chest"], (0.4, 0, 0)),
    "head_aim": target("t_head_aim", N["head"], (0, 0, 0.3)),
    "head_side": target("t_head_side", N["head"], (0.3, 0, 0)),
}
for s in ("L", "R"):
    T["hand_tip_" + s] = target("t_hand_tip_" + s, N["hand_" + s], (0, 0, -0.12))
    T["toe_" + s] = target("t_toe_" + s, N["foot_" + s], (0, -0.18, 0))
bpy.context.view_layer.update()

# ---------- 4. 把 Tripo 骨架約束到程式版骨架上 ----------
bpy.context.view_layer.objects.active = arm
bpy.ops.object.mode_set(mode='POSE')
pb = arm.pose.bones


def add(bone, kind, **kw):
    c = pb[bone].constraints.new(kind)
    for a, v in kw.items():
        setattr(c, a, v)
    return c


def track(bone, tgt, axis='TRACK_Y'):
    add(bone, 'DAMPED_TRACK', target=tgt, track_axis=axis)


def roll(bone, tgt, lock='LOCK_Y', axis='TRACK_X'):
    add(bone, 'LOCKED_TRACK', target=tgt, track_axis=axis, lock_axis=lock)


def ik(bone, tgt, pole, chain=2):
    add(bone, 'IK', target=tgt, pole_target=pole, chain_count=chain, use_tail=True)


# 骨盆：位置跟著 pelvis，朝向沿脊椎往上，滾轉由身體側向決定
add("Hip", 'COPY_LOCATION', target=N["pelvis"])
track("Hip", N["chest"])
roll("Hip", T["pelvis_side"])
# 脊椎與頭
track("Spine01", N["chest"])
track("Spine02", T["head_aim"])
roll("Spine02", T["chest_side"])
track("Head", T["head_aim"])
roll("Head", T["head_side"])
# 手臂：逐節瞄準下一個關節。Tripo 的手臂比程式版短，用 IK 會構不到而縮在身體旁邊，
# 改成只跟「方向」就不受長度差影響，動作姿態才跟得上。
# 腿：用兩節 IK，腳才會確實踩在地面上（髖高已經對齊，長度吻合）。
for s in ("L", "R"):
    track(f"{s}_Upperarm", N["forearm_" + s])
    track(f"{s}_Forearm", N["hand_" + s])
    track(f"{s}_Hand", T["hand_tip_" + s])
    ik(f"{s}_Calf", N["foot_" + s], N["shin_" + s])
    track(f"{s}_Foot", T["toe_" + s])

# ---------- 5. 烘焙 ----------
bpy.ops.pose.select_all(action='SELECT')
bpy.ops.nla.bake(frame_start=scene.frame_start, frame_end=scene.frame_end, step=1,
                 only_selected=True, visual_keying=True, clear_constraints=True,
                 clear_parents=False, use_current_action=True, bake_types={'POSE'})
bpy.ops.object.mode_set(mode='OBJECT')

# ---------- 6. 清掉程式版投手（空物件與它身上的配件網格），只留 Tripo 這一組 ----------
keep = {root, arm, body}
for o in list(scene.objects):
    if o not in keep:
        bpy.data.objects.remove(o, do_unlink=True)
bpy.context.view_layer.update()

# ---------- 7. 手上的球、根節點資訊 ----------
ball_mat = bpy.data.materials.new("ball")
ball_mat.use_nodes = True
ball_mat.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (0.92, 0.90, 0.84, 1)
bpy.ops.mesh.primitive_uv_sphere_add(radius=0.037, segments=20, ring_count=12)
ball = bpy.context.active_object
ball.name = "ball_in_hand"
ball.data.materials.append(ball_mat)
# 骨頭綁定會把子物件放在骨頭的「尾端」（指尖），球就放在那裡
ball.parent = arm
ball.parent_type = 'BONE'
ball.parent_bone = "R_Hand"
ball.matrix_parent_inverse.identity()
ball.location = (0, 0, 0)
ball.scale = (1 / root.scale.x, 1 / root.scale.y, 1 / root.scale.z)

root.name = "Pitcher"
root["release_time"] = RELEASE_T
root["style"] = STYLE

scene.frame_set(round(RELEASE_T * FPS))
bpy.context.view_layer.update()
print("RELEASE_WORLD_BLENDER", STYLE, tuple(round(x, 3) for x in ball.matrix_world.translation))
print("RELEASE_HAND", tuple(round(x, 3) for x in (arm.matrix_world @ arm.pose.bones["R_Hand"].tail)))

# ---------- 8. 貼圖縮小後匯出 ----------
for img in bpy.data.images:
    if max(img.size) > 1024:
        img.scale(1024, 1024)
        img.pack()

name, js_global = {"over": ("pitcher", "PITCHER_GLB"), "side": ("pitcher-side", "PITCHER_SIDE_GLB"),
                   "sub": ("pitcher-sub", "PITCHER_SUB_GLB")}[STYLE]
glb = os.path.join(OUT_DIR, name + ".glb")
for ob in scene.objects:
    ob.select_set(True)
bpy.ops.export_scene.gltf(
    filepath=glb, export_format="GLB", export_animations=True, export_apply=False,
    export_yup=True, export_extras=True, export_force_sampling=True, export_frame_range=True,
    export_animation_mode="SCENE", export_cameras=False, export_lights=False,
    use_selection=True, export_skins=True, export_image_format="JPEG", export_jpeg_quality=85,
)
import glb_datauri  # noqa: E402

glb_datauri.inline_images(glb)   # 貼圖改成 data: URI，Artifact 沙箱才載得進來
with open(glb, "rb") as fh:
    b64 = base64.b64encode(fh.read()).decode("ascii")
with open(os.path.join(OUT_DIR, name + "-model.js"), "w", encoding="utf-8") as fh:
    fh.write("// 由 blender/build_pitcher_tripo.py 產生，請勿手動修改\n")
    fh.write(f"window.{js_global} = \"{b64}\";\n")
print("GLB_BYTES", os.path.getsize(glb))

if PREVIEW:
    # 自己畫預覽（rig_common 的是 workbench，看不到貼圖）
    import numpy as np

    TIMES = [0.0, 0.55, 0.80, 0.95, 1.03, RELEASE_T, 1.40]
    VIEWS = [((7, -0.75, 1.1), (0, -0.75, 1.1)), ((0, -9, 1.1), (0, -0.9, 1.1))]
    W, H = 300, 420
    scene.render.engine = 'BLENDER_EEVEE_NEXT'
    scene.render.film_transparent = False
    scene.world = bpy.data.worlds.new("w")
    scene.world.use_nodes = True
    scene.world.node_tree.nodes["Background"].inputs[0].default_value = (0.32, 0.37, 0.46, 1)
    for ang, e in ((40, 3.2), (-60, 1.4)):
        l = bpy.data.objects.new("sun", bpy.data.lights.new("sun", 'SUN'))
        l.data.energy = e
        l.rotation_euler = (math.radians(55), 0, math.radians(ang))
        scene.collection.objects.link(l)
    cam_data = bpy.data.cameras.new("cam")
    cam_data.type = 'ORTHO'
    cam_data.ortho_scale = 2.7
    cam = bpy.data.objects.new("cam", cam_data)
    scene.collection.objects.link(cam)
    scene.camera = cam
    scene.render.resolution_x, scene.render.resolution_y = W, H
    sheet = np.zeros((H * len(VIEWS), W * len(TIMES), 4), dtype=np.float32)
    tmp = os.path.join(os.environ.get("TEMP", "/tmp"), "tripo_frame.png")
    for r, (pos, look) in enumerate(VIEWS):
        cam.location = pos
        cam.rotation_euler = (Vector(look) - Vector(pos)).to_track_quat('-Z', 'Y').to_euler()
        for c, t in enumerate(TIMES):
            scene.frame_set(round(t * FPS))
            scene.render.filepath = tmp
            bpy.ops.render.render(write_still=True)
            img = bpy.data.images.load(tmp)
            a = np.array(img.pixels[:]).reshape(H, W, 4)[::-1]
            sheet[r * H:(r + 1) * H, c * W:(c + 1) * W] = a
            bpy.data.images.remove(img)
    out = bpy.data.images.new("sheet", sheet.shape[1], sheet.shape[0], alpha=True)
    out.pixels = sheet[::-1].ravel().tolist()
    out.filepath_raw = os.path.abspath(PREVIEW)
    out.file_format = 'PNG'
    out.save()
    print("PREVIEW", PREVIEW)
