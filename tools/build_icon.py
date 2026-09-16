"""產生桌面圖示：夜間球場底色上的本壘板五角形。

只用標準函式庫，直接手寫 PNG（沒有 Pillow 也能跑）。
iOS 會自己把圖示切成圓角，所以這裡輸出滿版的正方形，不做圓角也不留透明。

    python tools/build_icon.py
"""

import os
import struct
import zlib

NIGHT = (0x0B, 0x15, 0x24)   # --night 夜間球場底色
AMBER = (0xF3, 0xB3, 0x3D)   # --amber 好球帶的琥珀色

SS = 4          # 每軸的超取樣倍率，用來做邊緣抗鋸齒
PLATE_FRAC = 0.62   # 本壘板寬度佔圖示邊長的比例

# 本壘板照規則書的比例：17 吋寬的上緣、兩側各 8.5 吋、再收成一個尖角。
# 座標原點在形狀正中央，y 軸向下。
PLATE = [
    (-8.5, -8.5),
    (8.5, -8.5),
    (8.5, 0.0),
    (0.0, 8.5),
    (-8.5, 0.0),
]


def write_png(path, size, pixels):
    """pixels 是長度 size*size 的 (r, g, b) 序列。"""
    raw = bytearray()
    for y in range(size):
        raw.append(0)  # 每列的 filter type：0 = None
        for x in range(size):
            raw.extend(pixels[y * size + x])

    def chunk(tag, data):
        body = tag + data
        return struct.pack(">I", len(data)) + body + struct.pack(">I", zlib.crc32(body) & 0xFFFFFFFF)

    png = b"\x89PNG\r\n\x1a\n"
    png += chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 2, 0, 0, 0))
    png += chunk(b"IDAT", zlib.compress(bytes(raw), 9))
    png += chunk(b"IEND", b"")
    with open(path, "wb") as f:
        f.write(png)


def coverage(size, poly):
    """用掃描線算出每個像素被多邊形蓋住的比例（0~1）。

    本壘板是凸多邊形，所以每條掃描線最多只會有一段在形狀內，
    取最左與最右的交點就夠了，不用處理多段的情形。
    """
    cov = [0.0] * (size * size)
    weight = 1.0 / SS
    for sub in range(size * SS):
        y = (sub + 0.5) / SS
        xs = []
        for i in range(len(poly)):
            x1, y1 = poly[i]
            x2, y2 = poly[(i + 1) % len(poly)]
            if (y1 <= y < y2) or (y2 <= y < y1):
                xs.append(x1 + (y - y1) * (x2 - x1) / (y2 - y1))
        if len(xs) < 2:
            continue
        left, right = min(xs), max(xs)
        row = int(y) * size
        for px in range(max(0, int(left)), min(size, int(right) + 1)):
            overlap = min(right, px + 1) - max(left, px)
            if overlap > 0:
                cov[row + px] += overlap * weight
    return cov


def build(size):
    scale = size * PLATE_FRAC / 17.0
    cx = cy = size / 2.0
    poly = [(cx + x * scale, cy + y * scale) for x, y in PLATE]
    cov = coverage(size, poly)

    pixels = []
    for c in cov:
        a = min(1.0, c)
        pixels.append(bytes(round(NIGHT[i] + (AMBER[i] - NIGHT[i]) * a) for i in range(3)))
    return pixels


def main():
    out = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "icons")
    os.makedirs(out, exist_ok=True)
    for name, size in [("apple-touch-icon.png", 180), ("icon-192.png", 192), ("icon-512.png", 512)]:
        path = os.path.join(out, name)
        write_png(path, size, build(size))
        print("%s  %dx%d  %d bytes" % (name, size, size, os.path.getsize(path)))


if __name__ == "__main__":
    main()
