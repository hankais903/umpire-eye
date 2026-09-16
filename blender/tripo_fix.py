"""把 Tripo 匯出的球員模型整理成可用的骨架。

Tripo 的 glTF 有兩個問題：
  1. 骨架節點全部是單位矩陣，綁定姿勢只存在 inverseBindMatrices 裡，
     任何合規的檢視器都會把網格算爛。把 pose 清成 rest 就是正確的綁定姿勢。
  2. 骨架的 rest 座標與網格座標差了一個 90 度旋轉。因為 pose == rest 時
     蒙皮矩陣是單位矩陣，所以可以直接把 rest 骨頭轉到網格上，網格不會動。
     旋轉量用「每根骨頭的權重重心」對「骨頭中點」做 Kabsch 擬合求得。
整理完：+Z 朝上、+Y 是面向（本壘板方向）、+X 是角色的右手邊、腳底在 z = 0、身高 1.88 公尺。
"""
import bpy
import numpy as np
from mathutils import Matrix, Vector

HEIGHT = 1.88


def load(path, reset=True):
    if reset:
        bpy.ops.wm.read_factory_settings(use_empty=True)
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=path)
    new = [o for o in bpy.data.objects if o not in before]

    arm = next(o for o in new if o.type == 'ARMATURE')
    meshes = [o for o in new if o.type == 'MESH']
    body = max(meshes, key=lambda o: len(o.data.vertices))
    for o in meshes:                      # Tripo 會多塞一顆包圍球
        if o is not body:
            bpy.data.objects.remove(o, do_unlink=True)
    return arm, body


def clear_pose(arm):
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.mode_set(mode='POSE')
    for pb in arm.pose.bones:
        pb.matrix_basis.identity()
    bpy.ops.object.mode_set(mode='OBJECT')
    bpy.context.view_layer.update()


def bind_rotation(arm, body):
    """求出「骨架空間 → 網格空間」的旋轉：骨頭中點對權重重心做剛體擬合。"""
    names = {vg.index: vg.name for vg in body.vertex_groups}
    acc = {}
    for v in body.data.vertices:
        for g in v.groups:
            if g.weight < 0.2:
                continue
            n = names.get(g.group)
            if n is None:
                continue
            w, c = acc.setdefault(n, [0.0, Vector((0, 0, 0))])
            acc[n] = [w + g.weight, c + v.co * g.weight]
    A, B = [], []
    for n, (w, c) in acc.items():
        b = arm.data.bones.get(n)
        if b and w >= 1.0:
            A.append(list((b.head_local + b.tail_local) / 2))
            B.append(list(c / w))
    A, B = np.array(A), np.array(B)
    P, Q = A - A.mean(0), B - B.mean(0)
    U, S, Vt = np.linalg.svd(P.T @ Q)
    d = np.sign(np.linalg.det(Vt.T @ U.T))
    R = Vt.T @ np.diag([1, 1, d]) @ U.T
    rms = float(np.sqrt((((R @ P.T).T - Q) ** 2).sum(1).mean()))
    snapped = np.round(R)                 # 實際上一定是 90 度的整數倍
    if np.abs(snapped @ snapped.T - np.eye(3)).max() < 1e-6:
        R = snapped
    return Matrix(R.tolist()).to_4x4(), rms


def _root_of(arm):
    o = arm
    while o.parent is not None:
        o = o.parent
    return o


def orient(arm, body, facing=1, height=HEIGHT):
    """把整組轉成 +Z 朝上、+X 右手邊，腳底貼地、身高正規化。
    facing=1 面向 +Y；facing=-1 面向 -Y（本壘板方向，跟程式產生的投手一致）。"""
    W = arm.matrix_world
    bw = lambda n: W @ arm.data.bones[n].head_local
    up = (bw("Head") - (bw("L_Foot") + bw("R_Foot")) / 2).normalized()
    left = (bw("L_Thigh") - bw("R_Thigh")).normalized()
    right = (left - left.project(up)).normalized() * -1
    fwd = up.cross(right).normalized()    # (right, fwd, up) 要是右手系，否則整個模型會鏡像
    right, fwd = right * facing, fwd * facing
    R = Matrix(((right.x, fwd.x, up.x),
                (right.y, fwd.y, up.y),
                (right.z, fwd.z, up.z))).transposed().to_4x4()
    root = _root_of(arm)
    root.matrix_world = R @ root.matrix_world
    bpy.context.view_layer.update()

    mn, mx = mesh_bounds(body)
    k = height / (mx.z - mn.z)
    root.matrix_world = Matrix.Scale(k, 4) @ root.matrix_world
    bpy.context.view_layer.update()
    mn, mx = mesh_bounds(body)
    root.location -= Vector(((mn.x + mx.x) / 2, (mn.y + mx.y) / 2, mn.z))
    bpy.context.view_layer.update()
    return k


def mesh_bounds(body):
    dg = bpy.context.evaluated_depsgraph_get()
    ev = body.evaluated_get(dg)
    me = ev.to_mesh()
    co = [ev.matrix_world @ v.co for v in me.vertices]
    mn = Vector([min(c[i] for c in co) for i in range(3)])
    mx = Vector([max(c[i] for c in co) for i in range(3)])
    ev.to_mesh_clear()
    return mn, mx


def prepare(path, reset=True, facing=1, height=HEIGHT):
    arm, body = load(path, reset)
    clear_pose(arm)
    R, rms = bind_rotation(arm, body)
    arm.data.transform(R)                 # 只動 rest，pose 仍等於 rest，網格不動
    bpy.context.view_layer.update()
    k = orient(arm, body, facing, height)
    print(f"TRIPO_FIX rms={rms:.4f} scale={k:.4f}")
    return arm, body
