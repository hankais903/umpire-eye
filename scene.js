/* 主審之眼：球場、人物與好球帶
   單位公尺。y 軸向上，投手在 -z 方向，本壘板尖端在原點。
   從主審往投手看，+x 在右手邊（一壘側），右打者站在 -x。 */

const IN = 0.0254, FT = 0.3048, MPH = 0.44704;
const BALL_R = 1.45 * IN;
const PLATE_HALF = 8.5 * IN;
const PLATE_FRONT = -17 * IN;
const PLATE_SIDE = -8.5 * IN;
// 打者站得深一點，後腳接近打擊區後緣
const BATTER_Z = PLATE_SIDE + 0.46;
const RUBBER_Z = -60.5 * FT;
const MOUND_H = 10 * IN;
// 捕手接球的位置（本壘板尖端後方）。手套在捕手腳跟前方 72 公分，隨捕手位置調整
let CATCH_Z = 0.92;
const PLATE_POLY = [
  [-PLATE_HALF, PLATE_FRONT], [PLATE_HALF, PLATE_FRONT],
  [PLATE_HALF, PLATE_SIDE], [0, 0], [-PLATE_HALF, PLATE_SIDE],
];

const canvas = document.getElementById('field');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
// 觸控裝置（手機、平板）解析度上限低一點，換取流暢度
const IS_TOUCH = window.matchMedia('(pointer: coarse)').matches;
// 遊戲框的大小（電腦上模擬手機時比視窗小）；所有版面與相機計算都以它為準
const appEl = document.getElementById('app');
const viewSize = () => ({ w: appEl.clientWidth || window.innerWidth, h: appEl.clientHeight || window.innerHeight });
if (IS_TOUCH) appEl.classList.add('touch');
renderer.setPixelRatio(Math.min(window.devicePixelRatio, IS_TOUCH ? 1.5 : 2));
renderer.outputEncoding = THREE.sRGBEncoding;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0b1524);
scene.fog = new THREE.Fog(0x0b1524, 50, 170);

const camera = new THREE.PerspectiveCamera(55, 1, 0.03, 500);
const controls = new THREE.OrbitControls(camera, canvas);
controls.enabled = false;
controls.enableDamping = true;
controls.minDistance = 0.6;
controls.maxDistance = 14;

// 正交相機：重播的「正面」「俯視」視角用，沒有透視變形，才看得出球是否碰到好球帶邊緣
const ORTHO_HEIGHT = 1.3; // 畫面垂直涵蓋 1.3 公尺
const orthoCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 20);
let activeCamera = camera;

function resizeOrtho() {
  const { w: vw, h: vh } = viewSize();
  const aspect = vw / vh;
  const h = ORTHO_HEIGHT / 2;
  Object.assign(orthoCamera, { left: -h * aspect, right: h * aspect, top: h, bottom: -h });
  orthoCamera.updateProjectionMatrix();
}

function resize() {
  const { w, h } = viewSize();
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  // 手機直向時放寬視野，好球帶才不會被切掉
  camera.fov = w / h < 0.8 ? 74 : 55;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', () => { resize(); resizeOrtho(); });
resize();
resizeOrtho();

/* ---------- 打光 ----------
   電影感色調（ACES）、照明塔方向的真實陰影、夜間球場的環境反射。 */
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.1;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

scene.add(new THREE.HemisphereLight(0xa8c0e0, 0x1c2a1c, 0.35));

// 主光：本壘後方左側的照明塔，陰影範圍只涵蓋本壘板周圍（打者、捕手、本壘板）
const keyLight = new THREE.DirectionalLight(0xfff0d8, 1.6);
keyLight.position.set(-7, 16, 9);
keyLight.target.position.set(0, 0, -0.3);
keyLight.castShadow = true;
keyLight.shadow.mapSize.set(IS_TOUCH ? 1024 : 2048, IS_TOUCH ? 1024 : 2048);
Object.assign(keyLight.shadow.camera, { left: -3.2, right: 3.2, top: 3.2, bottom: -3.2, near: 5, far: 40 });
keyLight.shadow.bias = -0.0004;
keyLight.shadow.normalBias = 0.02;
scene.add(keyLight, keyLight.target);

const fillLight = new THREE.DirectionalLight(0xcfe0ff, 0.5);
fillLight.position.set(30, 35, -40);
scene.add(fillLight);

// 環境反射：用一個簡單的夜空與照明塔場景產生，讓球衣、頭盔有自然的明暗與反光
(() => {
  const pmrem = new THREE.PMREMGenerator(renderer);
  const env = new THREE.Scene();
  const c = document.createElement('canvas');
  c.width = 8; c.height = 256;
  const g = c.getContext('2d');
  const grd = g.createLinearGradient(0, 0, 0, 256);
  grd.addColorStop(0, '#0d1626');
  grd.addColorStop(0.45, '#2b3a52');
  grd.addColorStop(0.5, '#3d4a3a');
  grd.addColorStop(1, '#1a2416');
  g.fillStyle = grd; g.fillRect(0, 0, 8, 256);
  const skyTex = new THREE.CanvasTexture(c);
  skyTex.encoding = THREE.sRGBEncoding;
  env.add(new THREE.Mesh(new THREE.SphereGeometry(50, 32, 16), new THREE.MeshBasicMaterial({ map: skyTex, side: THREE.BackSide })));
  [[-30, 25, -25], [30, 25, -25], [-20, 28, 30], [20, 28, 30]].forEach(([x, y, z]) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(8, 3, 1), new THREE.MeshBasicMaterial({ color: new THREE.Color(6, 5.6, 4.8) }));
    m.position.set(x, y, z);
    m.lookAt(0, 0, 0);
    env.add(m);
  });
  scene.environment = pmrem.fromScene(env, 0.04).texture;
  pmrem.dispose();
})();

const mat = (color, extra) => new THREE.MeshStandardMaterial(Object.assign({ color, roughness: 0.9 }, extra));

function canvasTexture(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.encoding = THREE.sRGBEncoding;
  return t;
}

/* ---------- 球場 ---------- */

// 草皮割痕條紋：地面紋理的疏密是重要的深度線索
const grassTex = canvasTexture(64, 64, (g, w, h) => {
  g.fillStyle = '#2d5a33'; g.fillRect(0, 0, w, h);
  g.fillStyle = '#346a3b'; g.fillRect(0, 0, w / 2, h);
  for (let i = 0; i < 400; i++) {
    g.fillStyle = `rgba(0,0,0,${Math.random() * 0.08})`;
    g.fillRect(Math.random() * w, Math.random() * h, 1, 2);
  }
});
grassTex.wrapS = grassTex.wrapT = THREE.RepeatWrapping;
grassTex.repeat.set(40, 40);
grassTex.anisotropy = renderer.capabilities.getMaxAnisotropy();

const flat = (geo, material, y) => {
  const m = new THREE.Mesh(geo, material);
  m.receiveShadow = true;
  m.rotation.x = -Math.PI / 2;
  m.position.y = y;
  scene.add(m);
  return m;
};

const grass = flat(new THREE.PlaneGeometry(320, 320), mat(0xffffff, { map: grassTex }), 0);
grass.rotation.z = Math.PI / 4;

// 紅土：畫面上要呈現指定的色碼 #613921，所以不受燈光與色調處理影響
// （顏色換成線性色彩空間，輸出時轉回 sRGB 剛好等於色碼）
const DIRT_HEX = 0x613921;
const dirtMat = new THREE.MeshBasicMaterial({
  color: new THREE.Color(DIRT_HEX).convertSRGBToLinear(),
  toneMapped: false,
});
// 內野紅土：以投手板為圓心、半徑 95 呎的半圓，朝外野方向
const skin = flat(new THREE.CircleGeometry(29, 64, 0, Math.PI), dirtMat, 0.002);
skin.position.z = RUBBER_Z + 18 * IN;
const infieldGrass = flat(new THREE.PlaneGeometry(24.2, 24.2), mat(0xffffff, { map: grassTex }), 0.004);
infieldGrass.position.z = -19.4;
infieldGrass.rotation.z = Math.PI / 4;
flat(new THREE.CircleGeometry(13 * FT, 48), dirtMat, 0.006);

// 紅土本身不受光，陰影另外用一層只顯示影子的透明平面疊在本壘板周圍
const dirtShadow = flat(new THREE.CircleGeometry(4.5, 48), new THREE.ShadowMaterial({ opacity: 0.35 }), 0.007);

const mound = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 9 * FT, MOUND_H, 40), dirtMat);
mound.position.set(0, MOUND_H / 2, RUBBER_Z + 18 * IN);
mound.receiveShadow = true;
scene.add(mound);
const rubber = new THREE.Mesh(new THREE.BoxGeometry(24 * IN, 0.02, 6 * IN), mat(0xeeeeee));
rubber.position.set(0, MOUND_H + 0.01, RUBBER_Z);
scene.add(rubber);

const chalk = mat(0xedeae0, { roughness: 0.7 });
function chalkLine(x1, z1, x2, z2, width = 3 * IN) {
  const len = Math.hypot(x2 - x1, z2 - z1);
  const m = flat(new THREE.PlaneGeometry(width, len), chalk, 0.008);
  m.position.x = (x1 + x2) / 2;
  m.position.z = (z1 + z2) / 2;
  m.rotation.z = Math.atan2(x2 - x1, z2 - z1);
}
// 線一律 3 吋寬，長方形以「外緣」為準，四個角接在一起不留缺口
const LINE_W = 3 * IN;
function chalkRect(x1, z1, x2, z2, { front = true, back = true, w = LINE_W } = {}) {
  const h = w / 2;
  chalkLine(x1 + h, z1, x1 + h, z2, w); // 左
  chalkLine(x2 - h, z1, x2 - h, z2, w); // 右
  if (front) chalkLine(x1, z1 + h, x2, z1 + h, w);
  if (back) chalkLine(x1, z2 - h, x2, z2 - h, w);
}

// 打擊區：4 呎 × 6 呎，內緣距本壘板邊緣 6 吋，前後以本壘板中心各 3 呎
const boxIn = PLATE_HALF + 6 * IN, boxOut = boxIn + 4 * FT;
const boxZ1 = PLATE_SIDE - 3 * FT, boxZ2 = PLATE_SIDE + 3 * FT;

// 界外線：延著本壘板尖端的 45 度線通過一、三壘外側角。
// 實際球場不會把粉線畫進打擊區與本壘板，所以從 45 度線離開打擊區前緣的那一點才起頭。
const foulStart = -boxZ1; // 45 度線上 x = -z，打擊區前緣 z = boxZ1
chalkLine(foulStart, -foulStart, 84, -84, LINE_W);
chalkLine(-foulStart, -foulStart, -84, -84, LINE_W);
[-1, 1].forEach((s) => {
  const [x1, x2] = s < 0 ? [-boxOut, -boxIn] : [boxIn, boxOut];
  chalkRect(x1, boxZ1, x2, boxZ2);
});

// 捕手區：內寬 43 吋，自打擊區後緣往後 8 呎，前面不封口
const catchHalf = 21.5 * IN;
chalkRect(-catchHalf, boxZ2, catchHalf, boxZ2 + 8 * FT, { front: false });
// 壘包
[[19.4, -19.4], [0, -38.8], [-19.4, -19.4]].forEach(([x, z]) => {
  const b = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.08, 0.38), chalk);
  b.position.set(x, 0.04, z);
  b.rotation.y = Math.PI / 4;
  scene.add(b);
});

// 本壘板與五角柱共用同一個形狀
function plateShape() {
  const s = new THREE.Shape();
  PLATE_POLY.forEach(([x, z], i) => (i ? s.lineTo(x, -z) : s.moveTo(x, -z)));
  s.closePath();
  return s;
}
const plate = new THREE.Mesh(
  new THREE.ExtrudeGeometry(plateShape(), { depth: 0.012, bevelEnabled: false }),
  mat(0xf4f2ea, { roughness: 0.6 })
);
plate.rotation.x = -Math.PI / 2;
plate.position.y = 0.006;
scene.add(plate);

// 外野牆與看台
const wall = new THREE.Mesh(
  new THREE.CylinderGeometry(118, 118, 4, 64, 1, true, Math.PI * 0.72, Math.PI * 0.56),
  mat(0x163326, { side: THREE.BackSide })
);
wall.position.y = 2;
scene.add(wall);
const crowdTex = canvasTexture(1024, 256, (g, w, h) => {
  g.fillStyle = '#121a26'; g.fillRect(0, 0, w, h);
  const colors = ['#3b4a63', '#5c4a4a', '#6d6a5e', '#2e3d55', '#7a5a3a', '#4a5a4a'];
  for (let i = 0; i < 9000; i++) {
    g.fillStyle = colors[(Math.random() * colors.length) | 0];
    g.globalAlpha = 0.35 + Math.random() * 0.5;
    g.fillRect(Math.random() * w, Math.random() * h, 2, 2);
  }
  g.globalAlpha = 1;
});
crowdTex.wrapS = THREE.RepeatWrapping;
crowdTex.repeat.set(6, 1);
const stands = new THREE.Mesh(
  new THREE.CylinderGeometry(160, 120, 34, 64, 1, true, Math.PI * 0.62, Math.PI * 0.76),
  new THREE.MeshBasicMaterial({ map: crowdTex, side: THREE.BackSide, fog: true })
);
stands.position.y = 4 + 17;
scene.add(stands);

// 照明塔
const glowTex = canvasTexture(128, 128, (g, w) => {
  const grd = g.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2);
  grd.addColorStop(0, 'rgba(255,248,225,1)');
  grd.addColorStop(0.18, 'rgba(255,236,190,0.8)');
  grd.addColorStop(1, 'rgba(255,220,160,0)');
  g.fillStyle = grd; g.fillRect(0, 0, w, w);
});
[[-78, -60], [78, -60], [-45, -128], [45, -128]].forEach(([x, z]) => {
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.6, 40, 8), mat(0x1a212c));
  pole.position.set(x, 20, z);
  scene.add(pole);
  const bank = new THREE.Mesh(new THREE.BoxGeometry(9, 4, 0.6), new THREE.MeshBasicMaterial({ color: 0xfff4d8 }));
  bank.position.set(x, 41, z);
  bank.lookAt(0, 0, 0);
  scene.add(bank);
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
  glow.scale.set(34, 34, 1);
  glow.position.set(x, 41, z);
  scene.add(glow);
});

/* ---------- 人物（簡化造型） ---------- */

const SKIN = 0xc59474, NAVY = 0x22324f, GREY = 0x9097a0, WHITE = 0xe6e3da, DARK = 0x1b1f27, BROWN = 0x6b3f22;

function cyl(r, len, color, parent, x, y, z) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r * 0.85, len, 10), mat(color));
  m.position.set(x, y, z);
  parent.add(m);
  return m;
}
function box(sx, sy, sz, color, parent, x, y, z) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), mat(color));
  m.position.set(x, y, z);
  parent.add(m);
  return m;
}
function ball3(r, color, parent, x, y, z) {
  const m = new THREE.Mesh(new THREE.SphereGeometry(r, 16, 12), mat(color));
  m.position.set(x, y, z);
  parent.add(m);
  return m;
}
function disposeGroup(g) {
  g.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });
  scene.remove(g);
}

// 打者：以面向 +x（面向本壘板）的右打者建模，左打者鏡像
let batterGroup = null;
function setBatter(side, height) {
  // 從主審往投手看，右打者（side = -1）在畫面左邊；介面會放到打者的另一側
  appEl.dataset.batter = side < 0 ? 'left' : 'right';
  batterRig.side = side;
  batterRig.height = height;
  placeBatterModel();
  placeCatcher();
  if (batterGroup) disposeGroup(batterGroup);
  const g = new THREE.Group();
  const shirt = side < 0 ? WHITE : GREY;
  cyl(0.075, 0.88, shirt, g, 0, 0.44, -0.24).rotation.x = -0.18;
  cyl(0.075, 0.88, shirt, g, 0, 0.44, 0.24).rotation.x = 0.18;
  const torso = box(0.24, 0.62, 0.42, shirt, g, 0.05, 1.18, 0);
  torso.rotation.z = -0.22;
  ball3(0.105, SKIN, g, 0.14, 1.6, 0.02);
  const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.12, 16, 12, 0, Math.PI * 2, 0, Math.PI * 0.55), mat(NAVY, { roughness: 0.4 }));
  helmet.position.set(0.13, 1.62, 0.02);
  g.add(helmet);
  cyl(0.045, 0.5, shirt, g, 0.14, 1.3, 0.12).rotation.x = 0.9;
  cyl(0.045, 0.5, shirt, g, 0.18, 1.3, -0.02).rotation.x = 0.5;
  const bat = cyl(0.032, 0.86, 0xc8a070, g, 0.05, 1.78, 0.42);
  bat.rotation.x = 0.75;
  bat.rotation.z = 0.25;
  g.scale.setScalar(height / 1.85);
  g.scale.x *= -side; // 右打者 side = -1
  g.position.set(side * 0.92, 0, PLATE_SIDE);
  g.visible = !batterRig.model;
  scene.add(g);
  batterGroup = g;
}

// 捕手：蹲在本壘板後方，手套獨立出來做偷好球
const catcher = new THREE.Group();
(() => {
  const g = catcher;
  box(0.4, 0.2, 0.45, NAVY, g, 0, 0.45, 0.72);
  cyl(0.07, 0.42, NAVY, g, -0.17, 0.25, 0.55).rotation.x = 0.2;
  cyl(0.07, 0.42, NAVY, g, 0.17, 0.25, 0.55).rotation.x = 0.2;
  const chest = box(0.4, 0.46, 0.24, DARK, g, 0, 0.72, 0.68);
  chest.rotation.x = -0.25;
  ball3(0.12, DARK, g, 0, 0.85, 0.6);
  box(0.2, 0.12, 0.05, 0x2a2e36, g, 0, 0.83, 0.49);
  cyl(0.05, 0.4, NAVY, g, 0.2, 0.66, 0.48).rotation.x = 1.2;
})();
scene.add(catcher);
const glove = new THREE.Mesh(new THREE.SphereGeometry(0.1, 16, 12), mat(BROWN, { roughness: 0.7 }));
glove.scale.set(1, 1.15, 0.55);
scene.add(glove);

// 投手：面向 +z 的右投手，左投鏡像；手臂掛在肩膀樞紐上
const pitcher = new THREE.Group();
const pitcherArm = new THREE.Group();
const pitcherLeg = new THREE.Group();
(() => {
  const g = pitcher;
  cyl(0.08, 0.9, WHITE, g, -0.12, 0.45, 0);
  pitcherLeg.position.set(0.12, 0.9, 0);
  cyl(0.08, 0.9, WHITE, pitcherLeg, 0, -0.45, 0);
  g.add(pitcherLeg);
  box(0.44, 0.64, 0.26, WHITE, g, 0, 1.22, 0);
  ball3(0.11, SKIN, g, 0, 1.66, 0);
  const cap = new THREE.Mesh(new THREE.SphereGeometry(0.115, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.5), mat(NAVY));
  cap.position.set(0, 1.68, 0);
  g.add(cap);
  cyl(0.045, 0.56, WHITE, g, 0.28, 1.2, 0.05).rotation.z = 0.2;
  pitcherArm.position.set(-0.26, 1.48, 0);
  cyl(0.045, 0.66, WHITE, pitcherArm, 0, -0.33, 0);
  g.add(pitcherArm);
})();
pitcher.position.set(0, MOUND_H, RUBBER_Z + 0.2);
scene.add(pitcher);

/* ---------- Blender 做的人物模型（blender/build_*.py 產生） ----------
   每個模型都以 base64 內嵌在 *-model.js，載入失敗時沿用上面的簡易造型。 */

const DOWN_Y = new THREE.Vector3(0, -1, 0);
// 三種投法各一個模型：上肩投（四分之三）、側投、下勾投。同一場只會出現其中一種
const PITCHER_STYLE_GLOBALS = { over: 'PITCHER_GLB', side: 'PITCHER_SIDE_GLB', sub: 'PITCHER_SUB_GLB' };
const pitcherRigs = {};
Object.keys(PITCHER_STYLE_GLOBALS).forEach((style) => {
  pitcherRigs[style] = { style, model: null, actions: [], releaseT: 1.1, release: null, ball: null };
});
let pitcherStyle = 'over';
let pitcherRig = pitcherRigs.over;
const batterRig = { model: null, actions: [], releaseT: 2.35, idleEnd: 1.6, side: -1, height: 1.85 };
const catcherRig = { model: null, actions: [], upper: null, fore: null, hand: null, headTop: null };

// GLTFLoader 預設用 ImageBitmapLoader 載貼圖，它內部是 fetch()，
// 而 Artifact 沙箱的 CSP 不允許 fetch blob: 或 data:，整個模型就會載入失敗。
// 幫 data: 開頭的貼圖註冊 TextureLoader（走 <img>，不經過 fetch）。
if (THREE.DefaultLoadingManager && THREE.TextureLoader) {
  THREE.DefaultLoadingManager.addHandler(/^data:image\//, new THREE.TextureLoader());
}

function loadRig(globalName, rig, onReady) {
  if (!window[globalName] || !THREE.GLTFLoader) return;
  const bin = Uint8Array.from(atob(window[globalName]), (c) => c.charCodeAt(0));
  new THREE.GLTFLoader().parse(bin.buffer, '', (gltf) => {
    rig.mixer = new THREE.AnimationMixer(gltf.scene);
    rig.actions = gltf.animations.map((clip) => rig.mixer.clipAction(clip).play());
    rig.root = gltf.scene.children[0];
    rig.extras = (rig.root && rig.root.userData) || {};
    scene.add(gltf.scene);
    rig.model = gltf.scene;
    gltf.scene.traverse((o) => {
      if (!o.isMesh) return;
      o.castShadow = true;
      o.receiveShadow = true;
      o.frustumCulled = false; // 蒙皮動畫會移出靜止姿勢的包圍範圍，不做視錐剔除
    });
    onReady(rig);
  }, (err) => console.warn(`${globalName} 載入失敗，改用簡易造型`, err));
}

// 把動畫定格在某個時間點（秒）
function poseRig(rig, t) {
  if (!rig.model) return false;
  rig.actions.forEach((a) => (a.time = Math.min(Math.max(t, 0), a.getClip().duration - 1e-4)));
  rig.mixer.update(0);
  return true;
}

// 投手
function setPitcherHand(hand) {
  pitcher.scale.x = hand === 'R' ? 1 : -1;
  Object.values(pitcherRigs).forEach((r) => { if (r.model) r.model.scale.x = pitcher.scale.x; });
}

// 只顯示這一場的投手；該投法的模型還沒載入時先用簡易造型
function setPitcherStyle(style) {
  pitcherStyle = pitcherRigs[style] ? style : 'over';
  pitcherRig = pitcherRigs[pitcherStyle];
  Object.values(pitcherRigs).forEach((r) => { if (r.model) r.model.visible = r === pitcherRig; });
  pitcher.visible = !pitcherRig.model;
  if (pitcherRig.model) posePitcherModel(0);
}

function posePitcherModel(animT) {
  if (!poseRig(pitcherRig, animT)) return false;
  if (pitcherRig.ball) pitcherRig.ball.visible = animT < pitcherRig.releaseT;
  return true;
}

// 出手點直接取自動畫：出手瞬間手中那顆球的位置
function modelReleasePoint(hand) {
  if (!pitcherRig.release) return null;
  const p = pitcherRig.release.clone();
  if (hand === 'L') p.x = -p.x;
  return p;
}

Object.entries(PITCHER_STYLE_GLOBALS).forEach(([style, globalName]) => {
  loadRig(globalName, pitcherRigs[style], (r) => {
    if (r.extras.release_time) r.releaseT = r.extras.release_time;
    r.ball = r.model.getObjectByName('ball_in_hand');
    r.model.position.set(0, MOUND_H, RUBBER_Z);
    r.model.scale.x = 1;
    poseRig(r, r.releaseT - 1e-3);
    if (r.ball) r.ball.visible = true;
    r.model.updateMatrixWorld(true);
    r.release = r.ball ? r.ball.getWorldPosition(new THREE.Vector3()) : null;
    r.model.scale.x = pitcher.scale.x;
    poseRig(r, 0);
    setPitcherStyle(pitcherStyle);
  });
});

// 打者：模型是右打者，左打者鏡像
function placeBatterModel() {
  const r = batterRig;
  if (!r.model) return;
  const k = r.height / 1.9;
  r.model.scale.set(k * -r.side, k, k);
  r.model.position.set(r.side * 0.72, 0, BATTER_Z);
}

loadRig('BATTER_GLB', batterRig, (r) => {
  if (r.extras.release_time) r.releaseT = r.extras.release_time;
  if (r.extras.idle_end) r.idleEnd = r.extras.idle_end;
  placeBatterModel();
  poseRig(r, 0);
  if (batterGroup) batterGroup.visible = false;
});

// 捕手：蹲在本壘板後方，接球手臂由遊戲即時 IK 控制
let CATCHER_FEET_Z = 1.86; // 捕手腳跟距本壘板尖端（公尺）。可在遊戲內的「視角調整」面板修改
let CATCHER_SHIFT = -0.01; // 捕手往遠離打者那一側偏移（公尺）

function placeCatcher() {
  const x = -batterRig.side * CATCHER_SHIFT;
  catcher.position.x = x;
  const r = catcherRig;
  if (!r.model) return;
  r.basePos = new THREE.Vector3(x, 0, CATCHER_FEET_Z);
  r.sway = new THREE.Vector3();
  r.model.position.copy(r.basePos);
  r.model.updateMatrixWorld(true);
  const helmet = r.model.getObjectByName('catcher_helmet');
  if (helmet) {
    const box = new THREE.Box3().setFromObject(helmet);
    r.headTop = { y: box.max.y, z: (box.min.z + box.max.z) / 2 };
  }
}

loadRig('CATCHER_GLB', catcherRig, (r) => {
  r.model.position.set(0, 0, CATCHER_FEET_Z);
  r.model.scale.setScalar(0.95);
  placeCatcher();
  r.upper = r.model.getObjectByName('upper_arm_L');
  r.fore = r.model.getObjectByName('forearm_L');
  r.hand = r.model.getObjectByName('hand_L');
  poseRig(r, 0);
  r.model.updateMatrixWorld(true);
  const helmet = r.model.getObjectByName('catcher_helmet');
  if (helmet) {
    const box = new THREE.Box3().setFromObject(helmet);
    r.headTop = { y: box.max.y, z: (box.min.z + box.max.z) / 2 };
  }
  catcher.visible = false;
  glove.visible = false;
  const a = catcherAlpha;
  catcherAlpha = 1;
  setCatcherAlpha(a); // 模型晚載入時補套目前的透明度
  if (typeof onCatcherLoaded === 'function') onCatcherLoaded();
});

// 人物透明度：主審站正中間時捕手會擋住本壘板；環繞重播時打者和捕手也會擋住球
function setObjectsAlpha(objects, alpha) {
  objects.forEach((obj) => {
    if (!obj) return;
    obj.traverse((o) => {
      if (!o.isMesh) return;
      o.material.transparent = alpha < 1;
      o.material.opacity = alpha;
      o.material.depthWrite = alpha >= 1;
      o.material.needsUpdate = true;
    });
  });
}

let catcherAlpha = 1;
function setCatcherAlpha(alpha) {
  if (alpha === catcherAlpha) return;
  catcherAlpha = alpha;
  setObjectsAlpha([catcherRig.model, catcher, glove], alpha);
}

let batterAlpha = 1;
function setBatterAlpha(alpha) {
  if (alpha === batterAlpha) return;
  batterAlpha = alpha;
  setObjectsAlpha([batterRig.model, batterGroup], alpha);
}

// 兩段式 IK：讓捕手的手套中心移到 target（世界座標）
// 捕手身體跟著手套移動：framing 時肩膀、重心會往手套方向移；手伸不到時身體再多挪過去
const CATCHER_SWAY = { follow: 0.45, maxSide: 0.35, smooth: 14 };
const catcherMitt = new THREE.Vector3(); // 畫面上手套口袋的實際位置（球接到後黏在這裡）
let catcherMittValid = false;

function catcherReach(target, dt = 1 / 60) {
  const r = catcherRig;
  if (!r.upper) return;
  const ws = r.model.scale.y;
  const l1 = r.fore.position.length() * ws, l2 = r.hand.position.length() * ws;
  const mittOffset = 0.1 * ws; // 手套中心在手腕前方
  const aimPoint = target.clone().add(new THREE.Vector3(0, 0, 0.06)); // 球落在手套口袋前緣

  // 身體目標位移：左右跟著手套走一部分；若肩膀到手套超出手臂長度，再補上不足的距離
  r.model.position.copy(r.basePos).add(r.sway);
  r.model.updateMatrixWorld(true);
  const S0 = r.upper.getWorldPosition(new THREE.Vector3());
  const want = new THREE.Vector3((aimPoint.x - r.basePos.x) * CATCHER_SWAY.follow, 0, 0);
  const reach = (l1 + l2) * 0.96 + mittOffset;
  const gap = aimPoint.clone().sub(S0).sub(want.clone().sub(r.sway));
  const over = gap.length() - reach;
  if (over > 0) {
    const push = gap.normalize().multiplyScalar(over);
    want.x += push.x;
    want.z += push.z;
  }
  want.x = THREE.MathUtils.clamp(want.x, -CATCHER_SWAY.maxSide, CATCHER_SWAY.maxSide);
  want.z = THREE.MathUtils.clamp(want.z, -0.3, 0.1);
  r.sway.lerp(want, 1 - Math.exp(-CATCHER_SWAY.smooth * dt));
  r.model.position.copy(r.basePos).add(r.sway);
  r.model.updateMatrixWorld(true);

  const S = r.upper.getWorldPosition(new THREE.Vector3());
  const wrist = aimPoint.clone().addScaledVector(aimPoint.clone().sub(S).normalize(), -mittOffset);
  const d = wrist.clone().sub(S);
  const dist = THREE.MathUtils.clamp(d.length(), Math.abs(l1 - l2) + 1e-4, l1 + l2 - 1e-4);
  const u = d.normalize();
  const pole = new THREE.Vector3(-1, -0.6, 0.3);
  const v = pole.addScaledVector(u, -pole.dot(u)).normalize();
  const cosA = THREE.MathUtils.clamp((l1 * l1 + dist * dist - l2 * l2) / (2 * l1 * dist), -1, 1);
  const elbow = S.clone().addScaledVector(u, cosA * l1).addScaledVector(v, Math.sqrt(1 - cosA * cosA) * l1);
  const end = S.clone().addScaledVector(u, dist);
  // 骨頭在自己座標系裡「指向子骨頭」的方向，轉到世界座標後要對準算出來的方向
  const parentQ = r.upper.parent.getWorldQuaternion(new THREE.Quaternion());
  const upperDir = elbow.clone().sub(S).normalize().applyQuaternion(parentQ.clone().invert());
  r.upper.quaternion.setFromUnitVectors(r.fore.position.clone().normalize(), upperDir);
  const upperQ = parentQ.clone().multiply(r.upper.quaternion);
  const foreDir = end.clone().sub(elbow).normalize().applyQuaternion(upperQ.invert());
  r.fore.quaternion.setFromUnitVectors(r.hand.position.clone().normalize(), foreDir);

  // 記下手套口袋實際到達的位置（手臂伸直仍不夠時會比目標短一點）
  const armDir = end.clone().sub(S).normalize();
  catcherMitt.copy(end).addScaledVector(armDir, mittOffset).add(new THREE.Vector3(0, 0, -0.06));
  catcherMittValid = true;
}

/* ---------- 球與好球帶 ---------- */

const ballTex = canvasTexture(256, 128, (g, w, h) => {
  g.fillStyle = '#f3efe4'; g.fillRect(0, 0, w, h);
  g.strokeStyle = '#c0392b'; g.lineWidth = 3;
  [0, Math.PI].forEach((phase) => {
    g.beginPath();
    for (let x = 0; x <= w; x += 2) {
      const y = h / 2 + Math.sin((x / w) * Math.PI * 2 + phase) * h * 0.28;
      x ? g.lineTo(x, y) : g.moveTo(x, y);
    }
    g.stroke();
  });
});
const ball = new THREE.Mesh(
  new THREE.SphereGeometry(BALL_R, 24, 16),
  new THREE.MeshStandardMaterial({ map: ballTex, roughness: 0.55, emissive: 0x2a2a2a })
);
ball.visible = false;
scene.add(ball);

// 陰影貼片：投射在地面，幫助判斷高度
const ballShadow = new THREE.Mesh(
  new THREE.CircleGeometry(BALL_R * 1.6, 20),
  new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.4, depthWrite: false })
);
ballShadow.rotation.x = -Math.PI / 2;
ballShadow.visible = false;
scene.add(ballShadow);

// 動態模糊：在「一幀的曝光時間」內沿真實軌跡鋪一串半透明球，
// 讓每秒 40 公尺的球看起來是連續拖影，而不是一格一格跳的殘影
const BLUR_SAMPLES = 12;
const blurBalls = Array.from({ length: BLUR_SAMPLES }, (_, i) => {
  const m = new THREE.Mesh(ball.geometry, new THREE.MeshBasicMaterial({
    color: 0xf3efe4, transparent: true, depthWrite: false,
    opacity: 0.32 * (1 - i / BLUR_SAMPLES),
  }));
  m.visible = false;
  scene.add(m);
  return m;
});

const zoneGroup = new THREE.Group();
scene.add(zoneGroup);
function buildZone(bottom, top) {
  zoneGroup.children.slice().forEach((c) => { c.geometry.dispose(); c.material.dispose(); zoneGroup.remove(c); });
  const geo = new THREE.ExtrudeGeometry(plateShape(), { depth: top - bottom, bevelEnabled: false });
  const fill = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
    color: 0xf3b33d, transparent: true, opacity: 0.1, depthWrite: false, side: THREE.DoubleSide,
  }));
  const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geo), new THREE.LineBasicMaterial({
    color: 0xf3b33d, transparent: true, opacity: 0.9,
  }));
  [fill, edges].forEach((m) => {
    m.rotation.x = -Math.PI / 2; // 形狀平面轉平，擠出方向朝上
    m.position.y = bottom;
    zoneGroup.add(m);
  });
  zoneEdges = edges;
  zoneFill = fill;
  buildZoneOutlines(bottom, top);
  setZoneOutlineMode(zoneOutlineMode);
}

// 正面平視圖只畫好球帶最外圍的矩形框與九宮格，五角柱內部的稜線隱藏
let zoneEdges = null, zoneFill = null;
let zoneOutlineMode = null; // null（完整五角柱）、'front'
const zoneOutlines = new THREE.Group();
scene.add(zoneOutlines);

function buildZoneOutlines(bottom, top) {
  zoneOutlines.children.slice().forEach((c) => {
    if (c.geometry) c.geometry.dispose();
    c.material.dispose(); // 貼圖（九宮格數字）是共用的，保留不 dispose
    zoneOutlines.remove(c);
  });
  const loop = (name, pts) => {
    const line = new THREE.LineLoop(
      new THREE.BufferGeometry().setFromPoints(pts.map(([x, y, z]) => new THREE.Vector3(x, y, z))),
      new THREE.LineBasicMaterial({ color: 0xf3b33d, transparent: true, opacity: 0.95 })
    );
    line.name = name;
    zoneOutlines.add(line);
  };
  // 半透明的矩形底色，取代五角柱的面（五角柱的面在平視圖會疊出一條條深淺不同的區塊）
  const panel = (name, w, h, pos, rotY) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({
      color: 0xf3b33d, transparent: true, opacity: 0.12, depthWrite: false, side: THREE.DoubleSide,
    }));
    m.position.set(...pos);
    m.rotation.y = rotY;
    m.name = name;
    zoneOutlines.add(m);
  };
  const midY = (bottom + top) / 2, hgt = top - bottom;
  // 正面：本壘板寬度 × 好球帶高度
  loop('front', [[-PLATE_HALF, bottom, PLATE_FRONT], [PLATE_HALF, bottom, PLATE_FRONT], [PLATE_HALF, top, PLATE_FRONT], [-PLATE_HALF, top, PLATE_FRONT]]);
  panel('front', PLATE_HALF * 2, hgt, [0, midY, PLATE_FRONT], 0);
  // 九宮格：從投手往捕手看，畫面左上是 1、右下是 9（照畫面上的閱讀順序）
  // 這個方向畫面右邊是 -x，所以第 c 欄（由左往右）的中心在 x = PLATE_HALF - (c + 0.5) * 寬 / 3
  const cellW = (PLATE_HALF * 2) / 3, cellH = hgt / 3;
  const grid = [];
  for (let i = 1; i < 3; i++) {
    const x = PLATE_HALF - cellW * i, y = bottom + cellH * i;
    grid.push(new THREE.Vector3(x, bottom, PLATE_FRONT), new THREE.Vector3(x, top, PLATE_FRONT));
    grid.push(new THREE.Vector3(-PLATE_HALF, y, PLATE_FRONT), new THREE.Vector3(PLATE_HALF, y, PLATE_FRONT));
  }
  const gridLines = new THREE.LineSegments(
    new THREE.BufferGeometry().setFromPoints(grid),
    new THREE.LineBasicMaterial({ color: 0xf3b33d, transparent: true, opacity: 0.45 })
  );
  gridLines.name = 'front';
  zoneOutlines.add(gridLines);
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      const label = new THREE.Sprite(new THREE.SpriteMaterial({
        map: zoneNumberTexture(r * 3 + c + 1), transparent: true, opacity: 0.55, depthTest: false, depthWrite: false,
      }));
      label.position.set(PLATE_HALF - cellW * (c + 0.5), top - cellH * (r + 0.5), PLATE_FRONT);
      const size = Math.min(cellW, cellH) * 0.55;
      label.scale.set(size, size, 1);
      label.renderOrder = 3;
      label.name = 'front';
      zoneOutlines.add(label);
    }
  }
}

const zoneNumberTextures = {};
function zoneNumberTexture(n) {
  if (!zoneNumberTextures[n]) {
    zoneNumberTextures[n] = canvasTexture(128, 128, (g, w, h) => {
      g.clearRect(0, 0, w, h);
      g.font = '900 96px "Big Shoulders Display", "JetBrains Mono", sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.lineWidth = 10;
      g.strokeStyle = 'rgba(11, 21, 36, 0.85)';
      g.strokeText(String(n), w / 2, h / 2 + 4);
      g.fillStyle = '#F3B33D';
      g.fillText(String(n), w / 2, h / 2 + 4);
    });
  }
  return zoneNumberTextures[n];
}

function setZoneOutlineMode(mode) {
  zoneOutlineMode = mode;
  if (zoneEdges) zoneEdges.visible = !mode;
  if (zoneFill) zoneFill.visible = !mode;
  zoneOutlines.children.forEach((c) => (c.visible = c.name === mode));
}

// 重播用：軌跡管線與最接近點的幽靈球
const replayGroup = new THREE.Group();
scene.add(replayGroup);
// 重播時的球：球體「在好球帶五角柱裡面」的部分顯示黃色，其他部分綠色。
// 用著色器逐像素判斷世界座標是否在五角柱內，所以球穿過好球帶時會看到黃色區域移動。
const ZONE_YELLOW = new THREE.Color(0xffd23f).convertSRGBToLinear();
const ZONE_GREEN = new THREE.Color(0x4fcb85).convertSRGBToLinear();

// 本壘板五角形每條邊的內側半平面：nx * x + nz * z + d >= 0 代表在內側
const PLATE_EDGES = (() => {
  const cx = PLATE_POLY.reduce((a, p) => a + p[0], 0) / PLATE_POLY.length;
  const cz = PLATE_POLY.reduce((a, p) => a + p[1], 0) / PLATE_POLY.length;
  return PLATE_POLY.map((a, i) => {
    const b = PLATE_POLY[(i + 1) % PLATE_POLY.length];
    let nx = -(b[1] - a[1]), nz = b[0] - a[0];
    const len = Math.hypot(nx, nz);
    nx /= len; nz /= len;
    if (nx * (cx - a[0]) + nz * (cz - a[1]) < 0) { nx = -nx; nz = -nz; }
    return new THREE.Vector3(nx, nz, -(nx * a[0] + nz * a[1]));
  });
})();

const zoneBallUniforms = {
  uZoneBottom: { value: 0 },
  uZoneTop: { value: 0 },
  uEdges: { value: PLATE_EDGES },
  uYellow: { value: ZONE_YELLOW },
  uGreen: { value: ZONE_GREEN },
};

function makeZoneBallMaterial(base) {
  const m = base.clone();
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, zoneBallUniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vZoneWorld;')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvZoneWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vZoneWorld;
        uniform float uZoneBottom;
        uniform float uZoneTop;
        uniform vec3 uEdges[5];
        uniform vec3 uYellow;
        uniform vec3 uGreen;`)
      .replace('#include <map_fragment>', `#include <map_fragment>
        bool inZone = vZoneWorld.y >= uZoneBottom && vZoneWorld.y <= uZoneTop;
        for (int i = 0; i < 5; i++) {
          if (dot(uEdges[i].xy, vZoneWorld.xz) + uEdges[i].z < 0.0) inZone = false;
        }
        float seam = dot(diffuseColor.rgb, vec3(0.333));
        diffuseColor.rgb = (inZone ? uYellow : uGreen) * (0.6 + 0.4 * seam);`);
  };
  m.customProgramCacheKey = () => 'zone-ball';
  return m;
}

const liveBallMaterial = ball.material;
const replayBallMaterial = makeZoneBallMaterial(liveBallMaterial);
replayBallMaterial.emissive = new THREE.Color(0x202020);

// on：重播時換成黃綠顯示的球；即時投球時維持白球，不洩漏答案
function setBallReplayLook(on, zone) {
  if (zone) {
    zoneBallUniforms.uZoneBottom.value = zone.bottom;
    zoneBallUniforms.uZoneTop.value = zone.top;
  }
  ball.material = on ? replayBallMaterial : liveBallMaterial;
}

function buildReplay(points, contact, isStrike, zone) {
  replayGroup.children.slice().forEach((c) => { c.geometry.dispose(); c.material.dispose(); replayGroup.remove(c); });
  setBallReplayLook(true, zone);
  const curve = new THREE.CatmullRomCurve3(points);
  const tube = new THREE.Mesh(
    new THREE.TubeGeometry(curve, 400, 0.006, 6, false),
    new THREE.MeshBasicMaterial({ color: 0xedeae0, transparent: true, opacity: 0.5 })
  );
  // 最接近好球帶位置的幽靈球，同樣依是否在好球帶內分黃綠
  const ghostMaterial = makeZoneBallMaterial(new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.6 }));
  ghostMaterial.transparent = true;
  ghostMaterial.opacity = 0.65;
  const ghost = new THREE.Mesh(new THREE.SphereGeometry(BALL_R, 32, 20), ghostMaterial);
  ghost.position.copy(contact);
  ghost.renderOrder = 5;
  replayGroup.add(tube, ghost);
}

/* ---------- 廣角鏡頭變形 ----------
   真實的廣角攝影機會有桶狀變形：畫面中央放大、邊緣壓縮，直線往外彎。
   先把場景畫到離屏畫布，再用著色器把整張畫面「包」進螢幕。k = 0 時完全不變形。 */

const lens = { k: 0 };
const lensTarget = renderer.capabilities.isWebGL2
  ? new THREE.WebGLMultisampleRenderTarget(1, 1)
  : new THREE.WebGLRenderTarget(1, 1);
const lensScene = new THREE.Scene();
const lensCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
const lensMaterial = new THREE.ShaderMaterial({
  uniforms: { tDiffuse: { value: lensTarget.texture }, k: { value: 0 }, aspect: { value: 1 } },
  vertexShader: `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
  fragmentShader: `
    uniform sampler2D tDiffuse;
    uniform float k;
    uniform float aspect;
    varying vec2 vUv;
    void main() {
      vec2 p = (vUv - 0.5) * vec2(aspect, 1.0);
      float corner = 0.25 * (aspect * aspect + 1.0);
      // 輸出半徑 r 取樣輸入半徑 r(1 + k r²)，再縮放讓畫面四角剛好對到原畫面四角，內容不會被切掉
      vec2 q = p * (1.0 + k * dot(p, p)) / (1.0 + k * corner);
      vec4 color = texture2D(tDiffuse, q / vec2(aspect, 1.0) + 0.5);
      #ifdef TONE_MAPPING
        color.rgb = toneMapping(color.rgb);
      #endif
      gl_FragColor = linearToOutputTexel(color);
    }`,
  depthTest: false,
  depthWrite: false,
});
lensScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), lensMaterial));

function resizeLens() {
  const size = renderer.getDrawingBufferSize(new THREE.Vector2());
  lensTarget.setSize(size.x, size.y);
  lensMaterial.uniforms.aspect.value = size.x / size.y;
}
window.addEventListener('resize', resizeLens);
resizeLens();

// distort：這一幀要不要套用鏡頭變形（只在主審視角套用，重播的其他視角維持正常）
function renderFrame(distort) {
  if (!distort || lens.k <= 0) {
    renderer.render(scene, activeCamera);
    return;
  }
  lensMaterial.uniforms.k.value = lens.k;
  renderer.setRenderTarget(lensTarget);
  renderer.render(scene, activeCamera);
  renderer.setRenderTarget(null);
  renderer.render(lensScene, lensCamera);
}
