"""把 MP3 裡夾帶的標籤（通常是封面圖）剝掉，只留下音訊。

從網路下載的音效常常內嵌一張幾百 KB 的封面圖，對遊戲完全沒用，
但會一起被存進手機的離線包裡。剝掉之後音質完全不變——音訊的位元組
一個都沒動，只是把前面的 ID3v2 標籤和後面的 ID3v1 標籤切掉。

    python tools/strip_audio_tags.py audio
"""

import os
import sys


def id3v2_len(data):
    """檔案開頭 ID3v2 標籤的長度，沒有就回 0。"""
    if len(data) < 10 or data[:3] != b'ID3':
        return 0
    # 長度是 synchsafe 整數：四個位元組各只用低 7 位
    n = 0
    for b in data[6:10]:
        n = (n << 7) | (b & 0x7F)
    size = n + 10
    # flags 的第 4 位代表後面還有一段 footer
    if data[5] & 0x10:
        size += 10
    return size


def id3v1_len(data):
    """檔案結尾 ID3v1 標籤（固定 128 位元組），沒有就回 0。"""
    return 128 if len(data) >= 128 and data[-128:-125] == b'TAG' else 0


def strip(path):
    with open(path, 'rb') as f:
        data = f.read()
    start = id3v2_len(data)
    end = len(data) - id3v1_len(data)
    if start == 0 and end == len(data):
        return len(data), len(data)
    with open(path, 'wb') as f:
        f.write(data[start:end])
    return len(data), end - start


def main():
    folder = sys.argv[1] if len(sys.argv) > 1 else 'audio'
    before = after = 0
    for name in sorted(os.listdir(folder)):
        if not name.lower().endswith(('.mp3', '.m4a')):
            continue
        b, a = strip(os.path.join(folder, name))
        before += b
        after += a
        print('%-14s %8.0f KB → %6.0f KB' % (name, b / 1024, a / 1024))
    if before:
        print('\n合計 %.2f MB → %.2f MB（省下 %.0f%%）'
              % (before / 1048576, after / 1048576, 100 * (before - after) / before))


if __name__ == '__main__':
    main()
