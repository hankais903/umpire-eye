# 主審之眼 THE SLOT

3D 好壞球判決遊戲。用棒球主審的視角看投手投球，在球通過本壘板後判好球或壞球。

好球帶做成本壘板往上延伸的**五角柱**，球體只要在飛行過程中碰到柱體的任何一部分就算好球——包含擦過後方尖角的情形。判決完會有環繞、正面、俯視、主審、打者、投手六種重播視角，正面與俯視是無透視的平視圖，看得出球到底有沒有碰到好球帶。

## 玩法

| | |
|---|---|
| 判決 | 球通過本壘板後按 `S` 好球、`B` 壞球，或點畫面按鈕。接球後 2 秒內要判，超時扣分。 |
| 注意 | 捕手會偷好球，把手套往好球帶拉。看球，不要看手套。 |
| 計分 | 依難度給分：球離好球帶邊緣越近越難判，判對 +40～+150、判錯 −25～−130（越一眼可辨扣越多）。判得越快加越多（0.4 秒內 +30，之後線性遞減，1.6 秒歸零）。超時 −50。一場 15 球。 |

開場可以選投手類型（上肩／側投／下勾）、判決難度、球速。同一場不換投手。

## 執行

純靜態網頁，但因為模型是用 `fetch` 以外的方式內嵌的，直接開 `file://` 也可以，用伺服器比較保險：

```bash
python blender/devserver.py .
```

然後開 http://localhost:8131/

加上 `--csp` 會送出跟 Claude Artifact 沙箱一樣的 Content-Security-Policy，用來驗證模型在沙箱裡載不載得進去：

```bash
python blender/devserver.py . --csp
```

## 發佈與加到手機主畫面

用 GitHub Pages 發佈（Settings → Pages → Source 選 `main` / root），網址是：

```
https://hankais903.github.io/umpire-eye/
```

在 iPhone 用 Safari 打開，分享鈕 →「加入主畫面」，就會變成一個沒有網址列的全螢幕 App。
`index.html` 的 `apple-mobile-web-app-*` 標籤負責這件事，版面本來就用 `env(safe-area-inset-*)`
讓開瀏海與 Home 指示條，所以狀態列設成 `black-translucent`、畫面延伸到滿版也不會被蓋到。

### 離線

`sw.js` 會在第一次上線開啟時，把遊戲跑起來需要的 18 個檔案（約 3.7 MB）整包快取下來，
之後**沒有網路也能玩**。three.js 也因此放在 `vendor/` 而不是走 CDN——CDN 的東西沒辦法
保證快取得到。字型是跨網域的，第一次連線時順手存起來，沒存到就退回系統字型。

service worker 需要 https 或 localhost，所以直接開 `file://` 不會有離線能力
（遊戲本身照常跑，註冊失敗會安靜略過）。

> **改過遊戲檔案之後，記得把 `sw.js` 裡的 `VERSION` 加一。**
> 那些資源是 cache-first，不換 VERSION 的話裝過的人會一直拿到舊版。
> `index.html` 本身是 network-first，所以只有它不受這個限制。

## 檔案

| 檔案 | 內容 |
|---|---|
| `index.html` | 版面與全部 CSS（用 container query 做手機直向／橫向） |
| `scene.js` | 球場、燈光、人物載入、好球帶、重播 |
| `physics.js` | 球種、投法、難度、Statcast 式的等加速度球路模型 |
| `game.js` | 遊戲流程、判決、相機、結算 |
| `tuner.js` | 遊戲內的主審視角微調面板 |
| `sfx.js` | 音效。播 `audio/` 裡的音檔，載不到就退回用 Web Audio 合成 |
| `audio/` | 音效檔（MP3）。細節看 `audio/README.md` |
| `*-model.js` | Blender 產生的角色模型（glTF 以 base64 內嵌） |
| `manifest.webmanifest` | 加到手機主畫面時的名稱、圖示、啟動方式 |
| `icons/` | 桌面圖示，用 `tools/build_icon.py` 產生 |
| `sw.js` | service worker，負責離線快取 |
| `vendor/` | three.js r128、OrbitControls、GLTFLoader（取自 npm `three@0.128.0`） |

## 重建角色模型

需要 Blender 4.5，全部都是背景執行，不用開 GUI。

```bash
blender --background --factory-startup --python blender/build_pitcher.py -- . blender/prev_over.png over
blender --background --factory-startup --python blender/build_pitcher.py -- . - side
blender --background --factory-startup --python blender/build_pitcher.py -- . - sub
blender --background --factory-startup --python blender/build_batter.py  -- . blender/prev_batter.png
blender --background --factory-startup --python blender/build_catcher.py -- . blender/prev_catcher.png
```

每個腳本會輸出 `<name>.glb` 和 `<name>-model.js`（後者是遊戲實際載入的，glTF 直接 base64 內嵌在 JS 裡）。

| 腳本 | 用途 |
|---|---|
| `blender/rig_common.py` | 共用的骨架、身體剖面、蒙皮、動作烘焙、glTF 匯出 |
| `blender/build_pitcher.py` | 投手（三種投法各一個動畫） |
| `blender/build_batter.py` | 打者 |
| `blender/build_catcher.py` | 捕手（接球手臂由遊戲即時 IK 控制） |
| `blender/check_broadcast_view.py` | 用線稿比對主審視角與參考照片 |
| `tools/build_icon.py` | 產生桌面圖示（只用標準函式庫手寫 PNG，不需要 Pillow） |

人物是**一整塊蒙皮網格**：頭、手掌、腳掌都接在同一條骨架線上，不是另外貼上去的剛體。比例與配色照 `reference/player_front.jpg`。

### 換成外部模型

`blender/tripo_fix.py` 和 `blender/build_pitcher_tripo.py` 是把外部模型接上這裡的投球動作的流程（處理綁定姿勢、對正方向尺寸、逐節瞄準轉移動作）。目前沒有啟用——外部模型的手臂比這裡的骨架短兩成五，轉移後出手點會偏低。

`blender/glb_datauri.py` 把 GLB 裡的貼圖從 bufferView 改寫成 `data:` URI。有貼圖的模型一定要跑這一步，否則 GLTFLoader 會做成 `blob:` URL 再 fetch，在 Artifact 沙箱裡會被 CSP 擋掉、整個模型載入失敗。

## 尺寸

全部照規則書的實際尺寸：投手板到本壘板尖端 18.44 公尺、本壘板 17 吋寬、打擊區 4×6 呎（內緣距板邊 6 吋）、捕手區內寬 43 吋深 8 呎、壘間 90 呎、投手丘半徑 9 呎高 10 吋、內野土半徑 95 呎。好球帶寬度固定，上下緣依打者身高換算。
