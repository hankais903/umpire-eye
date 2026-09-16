"""把 GLB 裡的貼圖從 bufferView 改寫成 data: URI。

Artifact 的沙箱 CSP 只允許 self 與 data: 的圖片，而且 connect-src 不含 blob:。
three.js 的 GLTFLoader 遇到存在 bufferView 裡的貼圖時，會做成 blob: URL 再 fetch，
在沙箱裡一定失敗，整個模型就載不進來（會退回簡易造型）。
改成 data: URI 之後 GLTFLoader 直接餵給 <img>，不經過 fetch，就不會被擋。

順便把圖片的位元組從 BIN 區塊移除，檔案不會因此變大。
"""

import base64
import json
import struct

GLB_MAGIC = 0x46546C67
JSON_CHUNK = 0x4E4F534A
BIN_CHUNK = 0x004E4942


def _chunks(data):
    magic, version, length = struct.unpack_from("<III", data, 0)
    assert magic == GLB_MAGIC, "不是 GLB 檔"
    out, off = {}, 12
    while off < length:
        clen, ctype = struct.unpack_from("<II", data, off)
        out[ctype] = data[off + 8: off + 8 + clen]
        off += 8 + clen
    return out


def _pad(b, fill=b"\x00"):
    return b + fill * (-len(b) % 4)


def inline_images(path):
    with open(path, "rb") as fh:
        data = fh.read()
    ch = _chunks(data)
    gltf = json.loads(ch[JSON_CHUNK].decode("utf-8"))
    binary = ch.get(BIN_CHUNK, b"")
    images = gltf.get("images", [])
    if not any("bufferView" in im for im in images):
        return False

    views = gltf.get("bufferViews", [])
    drop = set()
    for im in images:
        bv = im.get("bufferView")
        if bv is None:
            continue
        v = views[bv]
        start = v.get("byteOffset", 0)
        raw = binary[start:start + v["byteLength"]]
        mime = im.get("mimeType", "image/png")
        im["uri"] = "data:%s;base64,%s" % (mime, base64.b64encode(raw).decode("ascii"))
        im.pop("bufferView", None)
        im.pop("mimeType", None)
        drop.add(bv)

    # 重建 BIN：去掉貼圖，剩下的重新排列並更新 byteOffset 與索引
    keep = [i for i in range(len(views)) if i not in drop]
    remap = {old: new for new, old in enumerate(keep)}
    new_bin = bytearray()
    new_views = []
    for old in keep:
        v = dict(views[old])
        start = v.get("byteOffset", 0)
        raw = binary[start:start + v["byteLength"]]
        v["byteOffset"] = len(new_bin)
        new_views.append(v)
        new_bin += _pad(raw)
    gltf["bufferViews"] = new_views
    for acc in gltf.get("accessors", []):
        if "bufferView" in acc:
            acc["bufferView"] = remap[acc["bufferView"]]
        if "sparse" in acc:
            for key in ("indices", "values"):
                if key in acc["sparse"]:
                    acc["sparse"][key]["bufferView"] = remap[acc["sparse"][key]["bufferView"]]
    if gltf.get("buffers"):
        gltf["buffers"][0]["byteLength"] = len(new_bin)

    js = _pad(json.dumps(gltf, separators=(",", ":")).encode("utf-8"), b" ")
    bn = bytes(_pad(new_bin))
    total = 12 + 8 + len(js) + (8 + len(bn) if bn else 0)
    out = bytearray(struct.pack("<III", GLB_MAGIC, 2, total))
    out += struct.pack("<II", len(js), JSON_CHUNK) + js
    if bn:
        out += struct.pack("<II", len(bn), BIN_CHUNK) + bn
    with open(path, "wb") as fh:
        fh.write(out)
    return True


if __name__ == "__main__":
    import sys
    for p in sys.argv[1:]:
        print(p, "changed" if inline_images(p) else "unchanged")
