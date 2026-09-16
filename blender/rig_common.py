"""主審之眼：人物模型共用工具（投手、打者、捕手共用）

座標：Blender Z 軸向上。身體在「靜止姿勢」面向 -Y，左手在 +X。
實際朝向由骨盆旋轉決定（prot 的 Z 角度）。匯出 glTF 後 Blender 的 (x, y, z)
會變成 (x, z, -y)，所以 Blender 的 +Y 對應遊戲的 -z（投手方向）。

骨架是階層式節點（空物件），肢體是剛體；每一幀用兩段式 IK 算關節旋轉後烘焙成關鍵格。
"""

import base64
import math
import os
import tempfile

import bmesh
import bpy
from mathutils import Euler, Matrix, Quaternion, Vector

# 身體尺寸（公尺），約 190 公分
HIP_W = 0.10
THIGH, SHIN, ANKLE_H = 0.45, 0.44, 0.075
CHEST_UP = 0.14
SHOULDER = Vector((0.20, 0.0, 0.40))
NECK_UP = 0.50
UPPER_ARM, FOREARM = 0.30, 0.27
STAND_HIP = THIGH + SHIN + ANKLE_H

DOWN = Vector((0, 0, -1))
scene = None


def new_scene(fps, end_t):
    global scene
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.render.fps = fps
    scene.frame_start = 0
    scene.frame_end = round(end_t * fps)
    return scene


# ---------- 材質與幾何 ----------

def material(name, rgb, rough=0.65):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    bsdf = m.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = (*rgb, 1)
    bsdf.inputs["Roughness"].default_value = rough
    m.diffuse_color = (*rgb, 1)
    return m


def mesh_obj(name, builders, mat, parent, loc=None, rot=None):
    me = bpy.data.meshes.new(name)
    bm = bmesh.new()
    for b in builders:
        b(bm)
    for f in bm.faces:
        f.smooth = True
    bm.to_mesh(me)
    bm.free()
    me.materials.append(mat)
    ob = bpy.data.objects.new(name, me)
    scene.collection.objects.link(ob)
    ob.parent = parent
    if loc:
        ob.location = loc
    if rot:
        ob.rotation_euler = [math.radians(a) for a in rot]
    return ob


def xf(loc=(0, 0, 0), scale=(1, 1, 1)):
    return Matrix.Translation(loc) @ Matrix.Diagonal((*scale, 1))


def seg(r_top, r_bottom, length, z_top=0.0, sy=1.0, segments=20, caps=True, sx=1.0):
    """從 z_top 往下延伸的錐台（肢體段）。"""
    def build(bm):
        bmesh.ops.create_cone(
            bm, cap_ends=caps, cap_tris=False, segments=segments,
            radius1=r_bottom, radius2=r_top, depth=length,
            matrix=xf((0, 0, z_top - length / 2), (sx, sy, 1)),
        )
    return build


def seg_up(r_bottom, r_top, length, z_bottom=0.0, segments=16, caps=True):
    """從 z_bottom 往上延伸的錐台（球棒用）。"""
    def build(bm):
        bmesh.ops.create_cone(
            bm, cap_ends=caps, cap_tris=False, segments=segments,
            radius1=r_bottom, radius2=r_top, depth=length,
            matrix=xf((0, 0, z_bottom + length / 2)),
        )
    return build


def sphere(r, loc=(0, 0, 0), scale=(1, 1, 1), u=24, v=14):
    def build(bm):
        bmesh.ops.create_uvsphere(bm, u_segments=u, v_segments=v, radius=r, matrix=xf(loc, scale))
    return build


def rbox(size, loc, bevel):
    def build(bm):
        new = bmesh.ops.create_cube(bm, size=1.0, matrix=xf(loc, size))
        verts = new["verts"]
        edges = list({e for v in verts for e in v.link_edges})
        bmesh.ops.bevel(bm, geom=verts + edges, offset=bevel, offset_type="OFFSET",
                        segments=3, profile=0.5, affect="EDGES")
    return build


def node(name, parent, loc):
    e = bpy.data.objects.new(name, None)
    e.empty_display_size = 0.04
    scene.collection.objects.link(e)
    e.parent = parent
    e.location = loc
    e.rotation_mode = "QUATERNION"
    return e


# ---------- 骨架與標準身體 ----------

ARM_REST_ANGLE = math.radians(40)  # 靜止姿勢手臂外張（A 字型），蒙皮時手臂才不會和軀幹黏在一起


def skeleton(root_name):
    root = node(root_name, None, (0, 0, 0))
    pelvis = node("pelvis", root, (0, 0, STAND_HIP))
    chest = node("chest", pelvis, (0, 0, CHEST_UP))
    head = node("head", chest, (0, 0, NECK_UP))
    N = {"root": root, "pelvis": pelvis, "chest": chest, "head": head}
    for side, sx in (("L", 1), ("R", -1)):
        N["thigh_" + side] = node("thigh_" + side, pelvis, (sx * HIP_W, 0, 0))
        N["shin_" + side] = node("shin_" + side, N["thigh_" + side], (0, 0, -THIGH))
        N["foot_" + side] = node("foot_" + side, N["shin_" + side], (0, 0, -SHIN))
        ua = node("upper_arm_" + side, chest, (sx * SHOULDER.x, 0, SHOULDER.z))
        ua.rotation_quaternion = Euler((0, sx * -ARM_REST_ANGLE, 0)).to_quaternion()  # 往外張
        N["upper_arm_" + side] = ua
        N["forearm_" + side] = node("forearm_" + side, ua, (0, 0, -UPPER_ARM))
        N["hand_" + side] = node("hand_" + side, N["forearm_" + side], (0, 0, -FOREARM))
    return N


def standard_body(N, jersey, pants, accent, skin, shoe, sleeve_under=True, build=1.0,
                  under=None, stripe=None, hair=None):
    """記下身體的服裝配色（平滑身體在 skin_character 產生），並加上剛體配件：
    皮帶、領口、頭部五官、手掌、球鞋。帽子或頭盔由各角色另外加。"""
    N["_outfit"] = dict(jersey=jersey, pants=pants, accent=accent, skin=skin, shoe=shoe,
                        under=under or (accent if sleeve_under else skin), build=build)
    dark = material("eye_dark", (0.02, 0.015, 0.012), 0.3)
    brow = material("brow", (0.09, 0.055, 0.035), 0.8)
    b = build
    mesh_obj("belt", [seg(0.148 * b, 0.148 * b, 0.038, 0.175, sy=0.74)], accent, N["pelvis"])
    mesh_obj("belt_buckle", [rbox((0.05, 0.028, 0.032), (0, -0.108 * b, 0.157), 0.008)],
             material("buckle", (0.45, 0.43, 0.38), 0.3), N["pelvis"])
    mesh_obj("collar", [seg(0.058, 0.066, 0.05, 0.47)], accent, N["chest"])
    # 頭形本身併在身體網格裡，這裡只加鼻子與耳朵（臉朝 -Y）
    mesh_obj("nose_ears", [
        sphere(0.017, (0, -0.122, 0.124), (0.9, 1.15, 1.3)),
        sphere(0.028, (0.114, 0.0, 0.142), (0.38, 0.7, 1.0)),
        sphere(0.028, (-0.114, 0.0, 0.142), (0.38, 0.7, 1.0)),
    ], skin, N["head"])
    white = material("eye_white", (0.85, 0.83, 0.80), 0.35)
    mesh_obj("eye_whites", [sphere(0.018, (0.043, -0.113, 0.148), (1, 0.62, 0.78), u=16, v=10),
                            sphere(0.018, (-0.043, -0.113, 0.148), (1, 0.62, 0.78), u=16, v=10)], white, N["head"])
    mesh_obj("eyes", [sphere(0.0092, (0.044, -0.122, 0.147), (1, 0.8, 1.15), u=14, v=10),
                      sphere(0.0092, (-0.044, -0.122, 0.147), (1, 0.8, 1.15), u=14, v=10)], dark, N["head"])
    mesh_obj("mouth", [rbox((0.034, 0.01, 0.007), (0, -0.117, 0.088), 0.003)],
             material("mouth", (0.2, 0.1, 0.09), 0.6), N["head"])
    mesh_obj("brows", [rbox((0.034, 0.008, 0.006), (0.043, -0.118, 0.176), 0.002),
                       rbox((0.034, 0.008, 0.006), (-0.043, -0.118, 0.176), 0.002)], brow, N["head"])
    if hair:
        # 參考圖的髮型：帽子下緣露出來的一圈、額前的瀏海、鬢角與後頸的頭髮。
        # 只能蓋到眉毛以上，否則遠看會變成一條黑色眼罩。
        mesh_obj("hair", [
            seg(0.117, 0.121, 0.056, 0.236, sy=1.02),                    # 帽沿下露出的一圈
            sphere(0.046, (0, -0.109, 0.196), (1.65, 0.52, 0.46)),       # 瀏海
            sphere(0.034, (0.108, 0.01, 0.158), (0.5, 1.15, 1.25)),      # 鬢角
            sphere(0.034, (-0.108, 0.01, 0.158), (0.5, 1.15, 1.25)),
            sphere(0.058, (0, 0.086, 0.152), (1.45, 0.8, 1.15)),         # 後頸
        ], hair, N["head"])
    sole = material("sole", (0.16, 0.155, 0.15), 0.55)
    for side in ("L", "R"):
        # 鞋形也是身體網格的一部分，這裡只補一片鞋底
        mesh_obj("shoe_sole_" + side, [rbox((0.096, 0.235, 0.016), (0, -0.062, -0.088), 0.007)], sole, N["foot_" + side])
        # 袖口滾邊與襪子的兩道條紋（參考圖的高筒襪樣式）
        mesh_obj("sleeve_trim_" + side, [seg(0.069, 0.069, 0.018, -0.112)], accent, N["upper_arm_" + side])
        mesh_obj("sock_stripe_" + side, [seg(0.06, 0.06, 0.022, -0.196),
                                         seg(0.06, 0.06, 0.022, -0.248)],
                 stripe or jersey, N["shin_" + side])


def bare_hand(N, side, mat):
    """手掌（四指併攏的手套狀）加上拇指。"""
    sx = 1 if side == "L" else -1
    return mesh_obj("hand_mesh_" + side, [
        rbox((0.036, 0.075, 0.085), (0, 0, -0.05), 0.016),
        sphere(0.018, (-sx * 0.01, -0.04, -0.035), (0.9, 1.0, 1.7)),
    ], mat, N["hand_" + side])


def jersey_number(text, mat, N, z=0.25, depth=0.126):
    """背號：文字轉成網格，貼在胸部節點的背面（+Y）。"""
    cu = bpy.data.curves.new("number", "FONT")
    cu.body = text
    cu.size = 0.16
    cu.extrude = 0.004
    cu.align_x = "CENTER"
    cu.align_y = "CENTER"
    tmp = bpy.data.objects.new("number_tmp", cu)
    scene.collection.objects.link(tmp)
    me = bpy.data.meshes.new_from_object(tmp.evaluated_get(bpy.context.evaluated_depsgraph_get()))
    bpy.data.objects.remove(tmp)
    me.materials.append(mat)
    ob = bpy.data.objects.new("jersey_number", me)
    scene.collection.objects.link(ob)
    ob.parent = N["chest"]
    ob.location = (0, depth * N["_outfit"]["build"], z)
    ob.rotation_euler = (math.radians(90), 0, math.radians(180))
    return ob


# ---------- 姿勢插值 ----------

class Timeline:
    """關鍵姿勢的單調三次插值：相鄰關鍵值相同時保持不動，不會衝過頭。"""

    def __init__(self, keys):
        self.keys = keys
        self.fields = [f for f in keys[0] if f != "t"]
        self.times = [k["t"] for k in keys]
        self.vals = [self._flatten(k) for k in keys]
        cols = len(self.vals[0])
        self.slopes = [self._slopes([v[c] for v in self.vals]) for c in range(cols)]

    def _flatten(self, k):
        out = []
        for f in self.fields:
            v = k[f]
            out.extend(v if isinstance(v, (tuple, list)) else [v])
        return out

    def _unflatten(self, vals):
        k, i = {}, 0
        for f in self.fields:
            ref = self.keys[0][f]
            n = len(ref) if isinstance(ref, (tuple, list)) else 1
            k[f] = vals[i:i + n] if n > 1 else vals[i]
            i += n
        return k

    def _slopes(self, ys):
        ts, n = self.times, len(self.times)
        d = [(ys[i + 1] - ys[i]) / (ts[i + 1] - ts[i]) for i in range(n - 1)]
        m = [0.0] * n
        for i in range(1, n - 1):
            if d[i - 1] * d[i] > 0:
                m[i] = 2 / (1 / d[i - 1] + 1 / d[i])
        return m

    def sample(self, t):
        T = self.times
        t = min(max(t, T[0]), T[-1])
        i = len(T) - 2
        for j in range(len(T) - 1):
            if T[j] <= t < T[j + 1]:
                i = j
                break
        h = T[i + 1] - T[i]
        s = (t - T[i]) / h
        h00, h10 = 2 * s ** 3 - 3 * s ** 2 + 1, s ** 3 - 2 * s ** 2 + s
        h01, h11 = -2 * s ** 3 + 3 * s ** 2, s ** 3 - s ** 2
        V, M = self.vals, self.slopes
        return self._unflatten([
            h00 * V[i][c] + h10 * h * M[c][i] + h01 * V[i + 1][c] + h11 * h * M[c][i + 1]
            for c in range(len(V[0]))
        ])


# ---------- IK 與烘焙 ----------

def eul(deg):
    return Euler([math.radians(a) for a in deg], "XYZ").to_quaternion()


def two_bone(base, target, l1, l2, pole):
    d = target - base
    dist = min(max(d.length, abs(l1 - l2) + 1e-4), l1 + l2 - 1e-4)
    u = d.normalized()
    v = pole - u * pole.dot(u)
    if v.length < 1e-6:
        v = u.orthogonal()
    v.normalize()
    cos_a = max(-1.0, min(1.0, (l1 * l1 + dist * dist - l2 * l2) / (2 * l1 * dist)))
    mid = base + (u * cos_a + v * math.sqrt(1 - cos_a * cos_a)) * l1
    end = base + u * dist
    return (mid - base).normalized(), (end - mid).normalized()


def aim(direction, rest=DOWN):
    return rest.rotation_difference(Vector(direction).normalized())


def solve(k, hand_space="chest"):
    """一個姿勢 → 骨盆位置、各節點的區域旋轉、胸部的世界變換。

    欄位：pelvis, prot, crot, footL/R, yawL/R, handL/R, elbowL/R
    可選：kneeOut（膝蓋外開量）, look（頭部朝向，度）, lookPitch（低頭角度，度）
    hand_space="chest"：手的目標以胸部座標表示；"root"：以角色原點座標表示。
    """
    rot = {}
    P = Vector(k["pelvis"])
    q_p = eul(k["prot"])
    rot["pelvis"] = q_p

    facing = q_p @ Vector((0, -1, 0))
    knee_out = k.get("kneeOut", 0.0)
    for side, sx in (("L", 1), ("R", -1)):
        hip = P + q_p @ Vector((sx * HIP_W, 0, 0))
        pole = facing + Vector((0, 0, 0.25)) + (q_p @ Vector((sx, 0, 0))) * knee_out
        d_th, d_sh = two_bone(hip, Vector(k["foot" + side]), THIGH, SHIN, pole)
        q_th, q_sh = aim(d_th), aim(d_sh)
        q_ft = eul((0, 0, k["yaw" + side]))
        rot["thigh_" + side] = q_p.inverted() @ q_th
        rot["shin_" + side] = q_th.inverted() @ q_sh
        rot["foot_" + side] = q_sh.inverted() @ q_ft

    q_c = q_p @ eul(k["crot"])
    rot["chest"] = eul(k["crot"])
    C = P + q_p @ Vector((0, 0, CHEST_UP))
    for side, sx in (("L", 1), ("R", -1)):
        shoulder = C + q_c @ Vector((sx * SHOULDER.x, 0, SHOULDER.z))
        if hand_space == "root":
            target = Vector(k["hand" + side])
            pole = Vector(k["elbow" + side])
        else:
            target = C + q_c @ Vector(k["hand" + side])
            pole = q_c @ Vector(k["elbow" + side])
        d_ua, d_fa = two_bone(shoulder, target, UPPER_ARM, FOREARM, pole)
        q_ua, q_fa = aim(d_ua), aim(d_fa)
        rot["upper_arm_" + side] = q_c.inverted() @ q_ua
        rot["forearm_" + side] = q_ua.inverted() @ q_fa
        rot["hand_" + side] = Quaternion()

    q_head = eul((k.get("lookPitch", 0.0), 0, k.get("look", 0.0)))
    rot["head"] = q_c.inverted() @ q_head
    return P, rot


def bake(N, timeline, fps, end_t, hand_space="chest", extra=None):
    """逐幀解 IK 並寫入關鍵格。extra(frame, pose) 可額外設定其他節點（例如球棒）。"""
    prev = {}
    for f in range(0, round(end_t * fps) + 1):
        k = timeline.sample(f / fps)
        if extra:
            extra(f, k)
        P, rot = solve(k, hand_space)
        N["pelvis"].location = P
        N["pelvis"].keyframe_insert("location", frame=f)
        for name, q in rot.items():
            if name in prev and prev[name].dot(q) < 0:
                q.negate()  # 保持四元數連續，避免插值時翻轉
            prev[name] = q.copy()
            N[name].rotation_quaternion = q
            N[name].keyframe_insert("rotation_quaternion", frame=f)


def keyframe_quat(obj, q, frame, prev_store):
    key = obj.name
    if key in prev_store and prev_store[key].dot(q) < 0:
        q.negate()
    prev_store[key] = q.copy()
    obj.rotation_quaternion = q
    obj.keyframe_insert("rotation_quaternion", frame=frame)


# ---------- 匯出與預覽 ----------

def export(out_dir, basename, js_global):
    os.makedirs(out_dir, exist_ok=True)
    glb_path = os.path.join(out_dir, basename + ".glb")
    for ob in scene.objects:
        ob.select_set(ob.type in {"ARMATURE", "MESH"} or bool(ob.get("export_node")))
    bpy.ops.export_scene.gltf(
        filepath=glb_path, export_format="GLB", export_animations=True, export_apply=False,
        export_yup=True, export_extras=True, export_force_sampling=True, export_frame_range=True,
        export_animation_mode="SCENE", export_cameras=False, export_lights=False,
        use_selection=True, export_skins=True,
    )
    with open(glb_path, "rb") as fh:
        b64 = base64.b64encode(fh.read()).decode("ascii")
    with open(os.path.join(out_dir, basename + "-model.js"), "w", encoding="utf-8") as fh:
        fh.write(f"// 由 blender/build_{basename}.py 產生，請勿手動修改\n")
        fh.write(f"window.{js_global} = \"{b64}\";\n")
    print("GLB_BYTES", os.path.getsize(glb_path))
    return glb_path


def preview_sheet(path, fps, views, times, ground_center=(0, 0, 0), size=(300, 380)):
    """views：[(相機位置, 看向的點, 正交尺寸)]；每個視角一列、每個時間一欄。"""
    import numpy as np

    path = os.path.abspath(path)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    scene.render.engine = "BLENDER_WORKBENCH"
    scene.display.shading.light = "STUDIO"
    scene.display.shading.color_type = "MATERIAL"
    scene.render.resolution_x, scene.render.resolution_y = size
    scene.render.image_settings.file_format = "PNG"
    world = bpy.data.worlds.new("preview")
    world.color = (0.08, 0.1, 0.14)
    scene.world = world

    ground = bpy.data.meshes.new("preview_ground")
    bm = bmesh.new()
    bmesh.ops.create_grid(bm, x_segments=12, y_segments=12, size=2.5)
    bm.to_mesh(ground)
    bm.free()
    ground.materials.append(material("preview_ground_mat", (0.28, 0.16, 0.09)))
    gob = bpy.data.objects.new("preview_ground", ground)
    gob.location = ground_center
    scene.collection.objects.link(gob)

    cam_data = bpy.data.cameras.new("preview_cam")
    cam_data.type = "ORTHO"
    cam = bpy.data.objects.new("preview_cam", cam_data)
    scene.collection.objects.link(cam)
    scene.camera = cam

    W, H = size
    sheet = np.zeros((H * len(views), W * len(times), 4), dtype=np.float32)
    tmp = os.path.join(tempfile.gettempdir(), "rig_preview_frame.png")  # 短路徑，避開 Windows 路徑長度限制
    for r, (loc, target, scale) in enumerate(views):
        loc, target = Vector(loc), Vector(target)
        cam.location = loc
        cam.rotation_euler = (target - loc).to_track_quat("-Z", "Y").to_euler()
        cam_data.ortho_scale = scale
        for c, t in enumerate(times):
            scene.frame_set(round(t * fps))
            scene.render.filepath = tmp
            bpy.ops.render.render(write_still=True)
            img = bpy.data.images.load(tmp, check_existing=False)
            px = np.array(img.pixels[:], dtype=np.float32).reshape(H, W, 4)
            row = len(views) - 1 - r  # 影像像素由下往上存
            sheet[row * H:(row + 1) * H, c * W:(c + 1) * W] = px
            bpy.data.images.remove(img)
    out = bpy.data.images.new("sheet", W * len(times), H * len(views), alpha=True)
    out.pixels.foreach_set(sheet.ravel())
    out.filepath_raw = path
    out.file_format = "PNG"
    out.save()
    os.remove(tmp)
    # 預覽用物件不留在匯出後的場景裡
    for ob in (gob, cam):
        bpy.data.objects.remove(ob)

# ---------- 平滑身體、骨架與蒙皮 ----------
# 流程：先用空物件節點算好動作（bake），再
#   1. 依節點的靜止位置建立 Armature 骨架
#   2. 用 Skin 修改器從「骨架線」長出一整塊連續身體，細分後變平滑
#   3. 依頂點到骨頭的距離算蒙皮權重，依部位分配球衣、褲子、襪子、皮膚材質
#   4. 剛體配件改掛到對應的骨頭上
#   5. 每一幀把節點的動作轉移到骨頭上並寫入關鍵格

BONE_PARENTS = {
    "pelvis": None, "chest": "pelvis", "head": "chest",
    "thigh_L": "pelvis", "shin_L": "thigh_L", "foot_L": "shin_L",
    "thigh_R": "pelvis", "shin_R": "thigh_R", "foot_R": "shin_R",
    "upper_arm_L": "chest", "forearm_L": "upper_arm_L", "hand_L": "forearm_L",
    "upper_arm_R": "chest", "forearm_R": "upper_arm_R", "hand_R": "forearm_R",
}
BONE_ORDER = list(BONE_PARENTS)  # 父骨頭一定排在子骨頭前面
BONE_TAIL_CHILD = {
    "pelvis": "chest", "chest": "head",
    "thigh_L": "shin_L", "shin_L": "foot_L", "thigh_R": "shin_R", "shin_R": "foot_R",
    "upper_arm_L": "forearm_L", "forearm_L": "hand_L", "upper_arm_R": "forearm_R", "forearm_R": "hand_R",
}


def capture_rest(N):
    """在寫入任何關鍵格之前呼叫：記下節點與配件的靜止世界矩陣。"""
    bpy.context.view_layer.update()
    nodes = {n: N[n].matrix_world.copy() for n in BONE_ORDER}
    meshes = {ob: ob.matrix_world.copy() for ob in scene.objects if ob.type == "MESH"}
    return {"nodes": nodes, "meshes": meshes}


def _rest_pos(rest, n):
    return rest["nodes"][n].translation.copy()


def _bone_tail(rest, n):
    if n in BONE_TAIL_CHILD:
        return _rest_pos(rest, BONE_TAIL_CHILD[n])
    head = _rest_pos(rest, n)
    if n == "head":
        return head + Vector((0, 0, 0.25))
    if n.startswith("foot"):
        return head + Vector((0, -0.14, -0.05))
    # 手：沿著前臂方向延伸
    fore = _rest_pos(rest, "forearm_" + n[-1])
    return head + (head - fore).normalized() * 0.09


BODY_BULK = 1.32


def _body_profile(rest, build):
    """身體的「骨架線」：頂點位置與 Skin 半徑 (左右, 前後)。"""
    P, C, H = _rest_pos(rest, "pelvis"), _rest_pos(rest, "chest"), _rest_pos(rest, "head")
    pts, edges = [], []

    def add(pos, r, link=None, scale=True):
        # 細分後體積會縮水約三成，半徑先放大；scale=False 的部位（脖子、腳踝）不隨體格變壯
        k = BODY_BULK * (build if scale else 1.0)
        pts.append((Vector(pos), (r[0] * k, r[1] * k)))
        i = len(pts) - 1
        if link is not None:
            edges.append((link, i))
        return i

    hips = add(P + Vector((0, 0.01, 0.02)), (0.176, 0.114))
    waist = add(C + Vector((0, 0, 0.04)), (0.144, 0.118), hips)
    chest = add(C + Vector((0, 0, 0.21)), (0.168, 0.126), waist)
    yoke = add(C + Vector((0, 0.005, 0.35)), (0.168, 0.116), chest)
    # 脖子接到頭：頭也是同一塊網格的一部分，才不會有接縫
    neck = add(H + Vector((0, 0.004, -0.025)), (0.060, 0.060), yoke, scale=False)
    jaw = add(H + Vector((0, -0.018, 0.060)), (0.090, 0.094), neck, scale=False)
    cheek = add(H + Vector((0, -0.004, 0.138)), (0.118, 0.122), jaw, scale=False)
    skull = add(H + Vector((0, 0.008, 0.208)), (0.112, 0.116), cheek, scale=False)
    add(H + Vector((0, 0.008, 0.272)), (0.054, 0.056), skull, scale=False)
    for side in ("L", "R"):
        sh, el, wr = (_rest_pos(rest, n + side) for n in ("upper_arm_", "forearm_", "hand_"))
        s0 = add(sh + (sh - el).normalized() * 0.005, (0.067, 0.064), yoke)
        s1 = add(sh.lerp(el, 0.45), (0.055, 0.051), s0)
        e = add(el, (0.042, 0.04), s1)
        f1 = add(el.lerp(wr, 0.35), (0.047, 0.042), e)
        w0 = add(wr + (el - wr).normalized() * 0.012, (0.028, 0.023), f1)
        # 手掌也接上來（四指併攏的連指手套形狀），拇指另外加
        hd = (wr - el).normalized()
        pm = add(wr + hd * 0.042, (0.038, 0.024), w0, scale=False)
        add(wr + hd * 0.098, (0.026, 0.018), pm, scale=False)
        hp, kn, an = (_rest_pos(rest, n + side) for n in ("thigh_", "shin_", "foot_"))
        h0 = add(hp + Vector((0, 0.005, -0.05)), (0.09, 0.094), hips)
        h1 = add(hp.lerp(kn, 0.42), (0.081, 0.084), h0)
        k = add(kn, (0.056, 0.058), h1)
        c1 = add(kn.lerp(an, 0.32) + Vector((0, 0.014, 0)), (0.058, 0.062), k)
        # 腳掌：腳踝往前彎成鞋子的形狀，同樣是本體的一部分
        a0 = add(an + Vector((0, 0.008, -0.022)), (0.043, 0.05), c1, scale=False)
        ins = add(an + Vector((0, -0.055, -0.052)), (0.051, 0.062), a0, scale=False)
        add(an + Vector((0, -0.148, -0.055)), (0.043, 0.048), ins, scale=False)
    return pts, edges


def _seg_dist(p, a, b):
    ab = b - a
    t = max(0.0, min(1.0, (p - a).dot(ab) / max(ab.length_squared, 1e-9)))
    return (a + ab * t - p).length, t


def skin_character(N, rest, fps, end_t, name="rig"):
    outfit = N["_outfit"]
    build = outfit["build"]
    view_layer = bpy.context.view_layer

    # 1. 骨架
    arm_data = bpy.data.armatures.new(name)
    arm = bpy.data.objects.new(name, arm_data)
    scene.collection.objects.link(arm)
    for ob in scene.objects:
        ob.select_set(False)
    view_layer.objects.active = arm
    arm.select_set(True)
    bpy.ops.object.mode_set(mode="EDIT")
    for n in BONE_ORDER:
        eb = arm_data.edit_bones.new(n)
        eb.head = _rest_pos(rest, n)
        eb.tail = _bone_tail(rest, n)
        if BONE_PARENTS[n]:
            eb.parent = arm_data.edit_bones[BONE_PARENTS[n]]
            eb.use_connect = False
    bpy.ops.object.mode_set(mode="OBJECT")
    bone_rest = {n: arm_data.bones[n].matrix_local.copy() for n in BONE_ORDER}
    segments = {n: (bone_rest[n].translation.copy(), arm_data.bones[n].tail_local.copy()) for n in BONE_ORDER}

    # 2. 平滑身體
    pts, edges = _body_profile(rest, build)
    src_me = bpy.data.meshes.new("body_src")
    src_me.from_pydata([p for p, _ in pts], edges, [])
    src = bpy.data.objects.new("body_src", src_me)
    scene.collection.objects.link(src)
    sk = src.modifiers.new("skin", "SKIN")
    sk.use_smooth_shade = True
    sk.branch_smoothing = 0.5
    sub = src.modifiers.new("subdiv", "SUBSURF")
    sub.levels = sub.render_levels = 2
    layer = src_me.skin_vertices[0].data
    for i, (_, r) in enumerate(pts):
        layer[i].radius = r
    layer[0].use_root = True
    body_me = bpy.data.meshes.new_from_object(src.evaluated_get(bpy.context.evaluated_depsgraph_get()))
    bpy.data.objects.remove(src)
    body = bpy.data.objects.new("body", body_me)
    scene.collection.objects.link(body)
    for poly in body_me.polygons:
        poly.use_smooth = True

    # 3. 蒙皮權重
    groups = {n: body.vertex_groups.new(name=n) for n in BONE_ORDER}
    dominant = []
    for v in body_me.vertices:
        co = v.co
        cands = []
        for n in groups:
            d, t = _seg_dist(co, *segments[n])
            # 另一側的骨頭加上平滑的距離懲罰，避免在身體中線附近硬切造成裂縫
            if n.endswith("_R"):
                d += max(0.0, co.x) * 2.5
            elif n.endswith("_L"):
                d += max(0.0, -co.x) * 2.5
            cands.append((d, n, t))
        cands.sort()
        dmin = cands[0][0]
        use = [(d, n, t) for d, n, t in cands[:4] if d <= dmin * 1.6 + 0.04]
        ws = [(1.0 / max(d, 0.004) ** 3.5, n) for d, n, _ in use]
        total = sum(w for w, _ in ws)
        for w, n in ws:
            groups[n].add([v.index], w / total, "REPLACE")
        dominant.append((cands[0][1], cands[0][2]))

    # 材質：依部位分配
    mats = ["jersey", "pants", "accent", "skin", "under", "shoe"]
    for key in mats:
        body_me.materials.append(outfit[key])
    idx = {k: i for i, k in enumerate(mats)}
    belt_z = _rest_pos(rest, "pelvis").z + 0.175
    knee_z = {s: _rest_pos(rest, "shin_" + s).z for s in ("L", "R")}
    neck_z = _rest_pos(rest, "head").z - 0.035
    for poly in body_me.polygons:
        c = poly.center
        bone, t = dominant[poly.vertices[0]]
        if bone == "head" or (c.z > neck_z and abs(c.x) < 0.11):
            m = "skin"
        elif bone.startswith("foot"):
            m = "shoe"
        elif bone.startswith("hand"):
            m = "skin"
        elif (bone.startswith("forearm") or bone.startswith("upper_arm")) and abs(c.x) < 0.2 * build:
            m = "jersey" if c.z > belt_z else "pants"  # 腋下、體側仍屬於軀幹
        elif bone.startswith("forearm"):
            m = "under"
        elif bone.startswith("upper_arm"):
            m = "jersey" if t < 0.42 else "under"
        elif bone.startswith("shin"):
            m = "pants" if c.z > knee_z[bone[-1]] - 0.17 else "accent"
        elif bone.startswith("thigh"):
            m = "pants"
        else:
            m = "jersey" if c.z > belt_z else "pants"
        poly.material_index = idx[m]

    body.parent = arm
    mod = body.modifiers.new("armature", "ARMATURE")
    mod.object = arm

    # 4. 配件改掛到骨頭上（保持靜止位置）
    view_layer.update()
    rebound = []
    for ob, mw in rest["meshes"].items():
        par = ob.parent
        if par is None or ob in (body,):
            continue
        if par.name in BONE_PARENTS:
            ob.parent = arm
            ob.parent_type = "BONE"
            ob.parent_bone = par.name
            rebound.append((ob, mw))
        elif par == N["root"]:
            ob.parent = arm
            rebound.append((ob, mw))
    for ob in scene.objects:
        if ob.type == "EMPTY" and ob.parent == N["root"] and ob.name not in BONE_PARENTS:
            ob.parent = arm  # 例如球棒節點：保留原本的動畫
    view_layer.update()
    for ob, mw in rebound:
        ob.matrix_world = mw

    # 5. 動作轉移：骨頭跟著節點從靜止姿勢的變化量移動
    rest_inv = {n: rest["nodes"][n].inverted() for n in BONE_ORDER}
    rel_rest_inv = {n: (bone_rest[BONE_PARENTS[n]].inverted() @ bone_rest[n]).inverted()
                    for n in BONE_ORDER if BONE_PARENTS[n]}
    prev = {}
    for f in range(0, round(end_t * fps) + 1):
        scene.frame_set(f)
        M = {n: N[n].matrix_world @ rest_inv[n] @ bone_rest[n] for n in BONE_ORDER}
        for n in BONE_ORDER:
            pb = arm.pose.bones[n]
            pb.rotation_mode = "QUATERNION"
            parent = BONE_PARENTS[n]
            basis = (bone_rest[n].inverted() @ M[n]) if parent is None \
                else rel_rest_inv[n] @ M[parent].inverted() @ M[n]
            loc, rot, _ = basis.decompose()
            if n in prev and prev[n].dot(rot) < 0:
                rot.negate()
            prev[n] = rot.copy()
            pb.rotation_quaternion = rot
            pb.keyframe_insert("rotation_quaternion", frame=f)
            if parent is None:
                pb.location = loc
                pb.keyframe_insert("location", frame=f)
    scene.frame_set(0)
    return arm
