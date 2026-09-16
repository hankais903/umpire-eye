/* 主審之眼：遊戲流程、判決、重播與結算 */

const TOTAL_PITCHES = 15;
// 投手從準備姿勢到出手的時間：有 Blender 模型時以動畫為準
const windupTime = () => (pitcherRig.model ? pitcherRig.releaseT : 1.0);
const DECIDE_LIMIT = 2.0;
const REPLAY_SPEED = 0.18;
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const $ = (id) => document.getElementById(id);
const ui = {
  pitchNo: $('pitchNo'), matchup: $('matchup'), modeInfo: $('modeInfo'),
  score: $('score'), showZone: $('showZone'),
  prompt: $('prompt'), btnPitch: $('btnPitch'), calls: $('calls'),
  btnBall: $('btnBall'), btnStrike: $('btnStrike'), flash: $('callFlash'),
  result: $('result'), verdict: $('verdict'), truth: $('truth'),
  fType: $('fType'), fSpeed: $('fSpeed'), fMargin: $('fMargin'), fTime: $('fTime'),
  absNote: $('absNote'), paNote: $('paNote'), fPoints: $('fPoints'),
  btnNext: $('btnNext'), tag: $('contactTag'),
  intro: $('intro'), summary: $('summary'),
};

const G = {
  phase: 'intro',
  n: 0, score: 0,
  batterSide: -1, batterHeight: 1.85, zone: zoneForHeight(1.85), pitcherHand: 'R', pitcherStyle: 'over',
  pitch: null, phaseStart: 0, call: null, history: [],
  view: 'orbit',
};

const clock = () => performance.now() / 1000;
// 顯示一律用公制
const cm = (m) => (Math.abs(m) * 100).toFixed(1);
const KMH = 3.6;
const EDGE = 0.025; // 邊界球：與好球帶邊緣 2.5 公分內
// 球與好球帶的距離：好球顯示進入多深，壞球顯示偏離多遠
const marginText = (p) => (p.isStrike ? `進入 ${cm(p.margin)}cm` : `偏離 ${cm(p.margin)}cm`);
// 重播畫面上的標籤：前面再標明這球實際是好球還是壞球
const marginTag = (p) => `${p.isStrike ? '好球' : '壞球'} ${marginText(p)}`;

/* ---------- 打席與計分板 ---------- */

const BATTER_PITCHES = 5; // 每 5 球換一位打者

function newAtBat() {
  G.batterSide = Math.random() < 0.6 ? -1 : 1;
  G.batterHeight = rand(1.72, 1.98);
  G.zone = zoneForHeight(G.batterHeight);
  setBatter(G.batterSide, G.batterHeight);
  buildZone(G.zone.bottom, G.zone.top);
}

// 每一場決定一次投手（左右投與投法），整場不換人
function chooseGamePitcher() {
  G.pitcherHand = Math.random() < 0.7 ? 'R' : 'L';
  const pick = settings.pitcherStyle;
  G.pitcherStyle = PITCH_STYLES[pick] ? pick : weightedPick([
    { key: 'over', weight: 1 }, { key: 'side', weight: 1 }, { key: 'sub', weight: 1 },
  ]).key;
  setPitcherHand(G.pitcherHand);
  setPitcherStyle(G.pitcherStyle);
}

const pitcherLabel = () => `${G.pitcherHand === 'R' ? '右投' : '左投'}・${PITCH_STYLES[G.pitcherStyle].label}`;

function renderBoard() {
  ui.pitchNo.innerHTML = `第 <b>${Math.min(G.n + 1, TOTAL_PITCHES)}</b> / ${TOTAL_PITCHES} 球`;
  // 每一段都是不會再斷行的短句：寬畫面排成一行，手機直向的側欄一段一行
  ui.matchup.innerHTML = `<b>${pitcherLabel()}</b> <span class="sub">vs ${G.batterSide < 0 ? '右打' : '左打'}</span> <span class="sub">${Math.round(G.batterHeight * 100)} 公分</span>`;
  ui.modeInfo.innerHTML = `<span class="sub">${DIFFICULTIES[settings.difficulty].label}難度</span> <span class="sub">${SPEED_LABELS[settings.speed]}球速</span>`;
  ui.score.textContent = G.score;
}

/* ---------- 相機 ---------- */

// 主審站位（參考 CPBL 主審面罩攝影機的轉播畫面推算）
// center：本壘板正後方，下巴在捕手頭盔斜後上方；捕手往另一側偏，頭盔出現在畫面下緣角落。
// slot：往打者那一側偏，蹲在捕手與打者之間。
// 位置以捕手頭盔頂為基準：dx 往打者側、dy 往上、dz 往後。
const UMP_STANCES = {
  slot: { dx: 0.28, dy: 0.31, dz: 0.26, fallback: { x: 0.28, y: 1.38, z: 0.95 } },
};
let umpStance = 'center';
const stance = () => UMP_STANCES[umpStance];

// 正中間站位的相機參數，由玩家對照 CPBL 轉播主審視角親自調整：
// 眼高 1.49 公尺、本壘板尖端後方 1.95 公尺、俯角 19 度、以 765×565 畫面計垂直視野 57 度
// x：左右偏移（往一壘側為正）；yaw：鏡頭左右轉向（度，往右為正）。可在「視角調整」面板修改
// lens：廣角鏡頭的桶狀變形強度（0 = 無變形）
const BROADCAST_DEFAULT = Object.freeze({ x: 0, y: 1.49, z: 1.95, pitch: 19, yaw: 0, vfov: 57, lens: 0, aspect: 765 / 565 });
const BROADCAST_CAM = Object.assign({}, BROADCAST_DEFAULT);

const umpEye = () => {
  if (umpStance === 'center') return new THREE.Vector3(BROADCAST_CAM.x, BROADCAST_CAM.y, BROADCAST_CAM.z);
  const s = stance(), h = catcherRig.headTop, side = G.batterSide;
  if (!h) return new THREE.Vector3(side * s.fallback.x, s.fallback.y, s.fallback.z);
  return new THREE.Vector3(side * s.dx, h.y + s.dy, h.z + s.dz);
};
function onCatcherLoaded() {
  if (G.phase === 'ready' || G.phase === 'intro') setUmpCamera();
}
let camTween = null;
const umpFrame = { fov: 60, look: new THREE.Vector3() };
// 廣角：照轉播主審攝影機推算，水平視野約 105 度、垂直視野約 88 度
const UMP_MIN_HFOV = 105, UMP_MIN_VFOV = 88, UMP_MAX_VFOV = 110;
const replayFov = () => (viewSize().w / viewSize().h < 0.8 ? 74 : 55);

/* 自動取景：鏡頭水平方向對著本壘板中心；畫面上緣要看到投手出手，
   下緣要在判決按鈕之上看到整塊本壘板與好球帶底部，左右盡量把打者整個人納入。 */
function computeUmpFrame() {
  const eye = umpEye();
  if (umpStance === 'center') {
    // 所有螢幕比例都維持同樣的垂直視野，所以手機直向的構圖（投手、本壘板在畫面上的高度）
    // 跟電腦上完全一樣；畫面比較窄時只是左右看到的範圍變少
    const rad = THREE.MathUtils.degToRad;
    const c = BROADCAST_CAM;
    umpFrame.fov = c.vfov;
    const p = rad(c.pitch), yaw = rad(c.yaw);
    umpFrame.look.set(
      eye.x + Math.sin(yaw) * Math.cos(p) * 10,
      eye.y - Math.sin(p) * 10,
      eye.z - Math.cos(yaw) * Math.cos(p) * 10
    );
    return;
  }
  const dir = new THREE.Vector2(-eye.x, PLATE_SIDE - eye.z).normalize(); // 水平視線方向（x, z）
  const forward = (x, z) => (x - eye.x) * dir.x + (z - eye.z) * dir.y;
  const down = (x, y, z) => Math.atan2(eye.y - y, forward(x, z)); // 俯角，往下為正
  const aTop = down(0, 2.05, RUBBER_Z);
  const aBot = Math.max(
    down(0, 0, 0), down(-PLATE_HALF, 0, PLATE_FRONT), down(PLATE_HALF, 0, PLATE_FRONT),
    down(0, G.zone.bottom - BALL_R, 0)
  ) + THREE.MathUtils.degToRad(2);
  const aspect = viewSize().w / viewSize().h;
  const uiFrac = Math.min(0.35, 130 / viewSize().h); // 底部判決按鈕區的高度
  // 打者身體外側（離本壘板中心約 1.1 公尺）要在畫面內
  const bx = G.batterSide * 1.1 - eye.x, bz = PLATE_SIDE - eye.z;
  const lateral = Math.abs(bx * dir.y - bz * dir.x);
  const batterTan = lateral / Math.max(0.3, bx * dir.x + bz * dir.y);
  const deg = THREE.MathUtils.radToDeg;
  const vFromH = 2 * deg(Math.atan(Math.tan(THREE.MathUtils.degToRad(UMP_MIN_HFOV / 2)) / aspect));
  let fov = Math.min(UMP_MAX_VFOV, Math.max(UMP_MIN_VFOV, vFromH)), pitch = 0;
  for (; fov <= UMP_MAX_VFOV; fov += 0.5) {
    const T = Math.tan(THREE.MathUtils.degToRad(fov / 2));
    pitch = aTop + Math.atan(0.72 * T); // 投手頭部在畫面上方約 14% 處，跟轉播畫面一樣
    const bottomOk = aBot - pitch <= Math.atan((1 - 2 * uiFrac) * T);
    const batterOk = batterTan <= 0.95 * T * aspect;
    if (bottomOk && (batterOk || fov >= 100)) break;
  }
  umpFrame.fov = Math.min(fov, UMP_MAX_VFOV);
  const c = Math.cos(pitch);
  umpFrame.look.set(eye.x + dir.x * c * 10, eye.y - Math.sin(pitch) * 10, eye.z + dir.y * c * 10);
}

function applyUmpLens() {
  camera.fov = umpFrame.fov;
  camera.updateProjectionMatrix();
}

function setUmpCamera() {
  controls.enabled = false;
  camTween = null;
  G.orbit = null;
  activeCamera = camera;
  setZoneOutlineMode(null);
  camera.clearViewOffset();
  computeUmpFrame();
  applyUmpLens();
  camera.position.copy(umpEye());
  camera.lookAt(umpFrame.look);
  updateHudSideWidth();
}

// 手機直向時介面直欄放在打者另一側：依好球帶在畫面上的實際位置，決定直欄最寬能到多少才不會擋住好球帶
function updateHudSideWidth() {
  camera.updateMatrixWorld();
  const { w } = viewSize();
  let minX = Infinity, maxX = -Infinity;
  const v = new THREE.Vector3();
  [G.zone.bottom - BALL_R, G.zone.top + BALL_R].forEach((y) => {
    PLATE_POLY.forEach(([x, z]) => {
      [x - BALL_R, x + BALL_R].forEach((xx) => {
        v.set(xx, y, z).project(camera);
        const px = (v.x * 0.5 + 0.5) * w;
        minX = Math.min(minX, px);
        maxX = Math.max(maxX, px);
      });
    });
  });
  const panelOnLeft = G.batterSide > 0; // 左打者在畫面右邊，直欄放左邊
  const room = (panelOnLeft ? minX : w - maxX) - 18;
  appEl.style.setProperty('--hud-side-w', `${Math.round(THREE.MathUtils.clamp(room, 104, 170))}px`);
}

window.addEventListener('resize', () => {
  if (G.phase === 'result' || G.phase === 'summary') return;
  computeUmpFrame();
  applyUmpLens();
});

function viewPose(view) {
  const zc = new THREE.Vector3(0, (G.zone.bottom + G.zone.top) / 2, PLATE_SIDE);
  switch (view) {
    case 'top': return { pos: new THREE.Vector3(0.02, 3.4, 0.9), target: zc };
    case 'ump': return { pos: umpEye(), target: zc };
    case 'pitcher': return { pos: new THREE.Vector3(0.2, 1.5, -5.5), target: zc };
    // 打者視角：攝影機貼在打者靠捕手那一側的肩膀旁，朝好球帶看、稍微偏向來球方向，
    // 看得到球從投手方向飛進好球帶（打者站在本壘板旁，投手與好球帶夾角太大，無法同時入鏡）
    case 'batter': return {
      pos: new THREE.Vector3(G.batterSide * 0.8, G.batterHeight * 0.82, BATTER_Z + 0.24),
      target: new THREE.Vector3(0, zc.y - 0.1, PLATE_SIDE - 0.6),
    };
    default: return { pos: new THREE.Vector3(-G.batterSide * 2.6, zc.y + 0.25, -0.1), target: zc };
  }
}

/* ---------- 判決後的環繞重播 ----------
   鏡頭從主審視角拉近到立體好球帶，繞一圈 360 度。手指或滑鼠一碰畫面就交給玩家自己轉。 */
const ORBIT = { zoom: 1.1, spin: 8, radius: 1.5, lift: 0.28, fov: 50 }; // spin：轉一圈的秒數

function markView(view) {
  G.view = view;
  document.querySelectorAll('.views button').forEach((b) => b.classList.toggle('on', b.dataset.view === view));
}

function startOrbit() {
  activeCamera = camera;
  setZoneOutlineMode(null);
  replayFit.ready = false;
  markView('orbit');
  const center = new THREE.Vector3(0, (G.zone.bottom + G.zone.top) / 2, PLATE_SIDE);
  const from = camera.position.clone();
  controls.target.copy(center);
  controls.enabled = true;
  camTween = null;
  G.orbit = {
    start: clock(), center, from, fromFov: camera.fov,
    // 從主審那一側開始繞，拉近時方向不會突然轉
    angle0: Math.atan2(from.x - center.x, from.z - center.z),
  };
}

function orbitPosition(o, angle) {
  return new THREE.Vector3(
    o.center.x + Math.sin(angle) * ORBIT.radius,
    o.center.y + ORBIT.lift,
    o.center.z + Math.cos(angle) * ORBIT.radius
  );
}

function updateOrbit(now) {
  const o = G.orbit;
  const t = now - o.start;
  if (reduceMotion) {
    camera.position.copy(orbitPosition(o, o.angle0));
    camera.fov = ORBIT.fov;
    G.orbit = null;
  } else if (t < ORBIT.zoom) {
    const k = THREE.MathUtils.smootherstep(t, 0, ORBIT.zoom);
    camera.position.lerpVectors(o.from, orbitPosition(o, o.angle0), k);
    camera.fov = THREE.MathUtils.lerp(o.fromFov, ORBIT.fov, k);
  } else {
    // 持續等速旋轉；開頭 1 秒慢慢加速，避免拉近後突然轉動
    const u = t - ORBIT.zoom;
    const ramp = 1;
    const turns = u < ramp ? (u * u) / (2 * ramp) : u - ramp / 2;
    camera.position.copy(orbitPosition(o, o.angle0 + (Math.PI * 2 * turns) / ORBIT.spin));
    camera.fov = ORBIT.fov;
  }
  camera.updateProjectionMatrix();
  camera.lookAt(o.center);
}

function stopOrbitForUser() {
  if (G.phase === 'result' && G.orbit) G.orbit = null;
}
canvas.addEventListener('pointerdown', stopOrbitForUser);
canvas.addEventListener('wheel', stopOrbitForUser, { passive: true });

// 元素在遊戲框內的位置（模擬手機時遊戲框有縮放，要換算回遊戲框的座標）
function localRect(el) {
  const r = el.getBoundingClientRect(), a = appEl.getBoundingClientRect();
  const k = a.width / appEl.clientWidth || 1;
  return { left: (r.left - a.left) / k, top: (r.top - a.top) / k, width: r.width / k, height: r.height / k };
}

// 結果面板蓋住畫面一側時，把畫面中心移到沒被蓋住的區域，好球帶才會在看得到的地方
// 重播時讓好球帶一定完整露出來：找出沒被介面蓋住的畫面範圍，
// 再用 setViewOffset 平移、縮放畫面，把好球帶放進這個範圍的正中央
const replayFit = { x: 0, y: 0, z: 1, ready: false };

function uiSafeRect() {
  const { w, h } = viewSize();
  const safe = { L: 0, T: 0, R: w, B: h };
  const blockers = [ui.result, document.querySelector('.board'), document.querySelector('.scorebox'),
    document.querySelector('.score-row'), document.querySelector('.hud-controls'), $('tuner')];
  blockers.forEach((el) => {
    if (!el || el.hidden || !el.getClientRects().length) return;
    const r = localRect(el);
    const right = r.left + r.width, bottom = r.top + r.height;
    // 沒有跟目前的安全範圍重疊就不用管
    if (right <= safe.L || r.left >= safe.R || bottom <= safe.T || r.top >= safe.B) return;
    // 從四個方向切掉這個面板，選切完後剩下面積最大的那一刀
    const cuts = [
      { side: 'L', value: right, area: (safe.R - right) * (safe.B - safe.T) },
      { side: 'R', value: r.left, area: (r.left - safe.L) * (safe.B - safe.T) },
      { side: 'T', value: bottom, area: (safe.R - safe.L) * (safe.B - bottom) },
      { side: 'B', value: r.top, area: (safe.R - safe.L) * (r.top - safe.T) },
    ].sort((a, b) => b.area - a.area);
    const c = cuts[0];
    if (c.side === 'L') safe.L = c.value;
    else if (c.side === 'R') safe.R = c.value;
    else if (c.side === 'T') safe.T = c.value;
    else safe.B = c.value;
  });
  const pad = 14;
  return { x: safe.L + pad, y: safe.T + pad, w: Math.max(40, safe.R - safe.L - pad * 2), h: Math.max(40, safe.B - safe.T - pad * 2) };
}

function applyResultOffset() {
  const cam = activeCamera;
  const { w: W, h: H } = viewSize();
  // 先在沒有偏移的情況下量好球帶在畫面上的範圍
  cam.clearViewOffset();
  cam.updateMatrixWorld();
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const v = new THREE.Vector3();
  [G.zone.bottom - BALL_R, G.zone.top + BALL_R].forEach((y) => {
    PLATE_POLY.forEach(([x, z]) => {
      v.set(x, y, z).project(cam);
      const px = (v.x * 0.5 + 0.5) * W, py = (-v.y * 0.5 + 0.5) * H;
      minX = Math.min(minX, px); maxX = Math.max(maxX, px);
      minY = Math.min(minY, py); maxY = Math.max(maxY, py);
    });
  });
  const safe = uiSafeRect();
  const zoneW = Math.max(1, maxX - minX), zoneH = Math.max(1, maxY - minY);
  // z > 1 是縮小畫面內容；好球帶佔安全範圍約 75%
  const minZoom = G.view === 'batter' ? 1 : 0.7; // 打者視角不放大，保留打者看出去的遠近感
  const z = THREE.MathUtils.clamp(Math.max(zoneW / (safe.w * 0.75), zoneH / (safe.h * 0.75)), minZoom, 4);
  const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
  const sx = safe.x + safe.w / 2, sy = safe.y + safe.h / 2;
  // 虛擬大圖中好球帶中心在 (cx, cy)，要出現在畫面的 (sx, sy)：offset = c - s * z
  const target = { x: cx - sx * z, y: cy - sy * z, z };
  const k = replayFit.ready ? 1 - Math.exp(-30 * frameDt) : 1; // 跟得上環繞旋轉，又不會一格一格跳
  replayFit.x += (target.x - replayFit.x) * k;
  replayFit.y += (target.y - replayFit.y) * k;
  replayFit.z += (target.z - replayFit.z) * k;
  replayFit.ready = true;
  cam.setViewOffset(W, H, replayFit.x, replayFit.y, W * replayFit.z, H * replayFit.z);
}

// 正交視角：完全平視、沒有透視。near、far 平面緊貼好球帶前後，其他人物不會入鏡
const ORTHO_VIEWS = {
  // 正面：從投手往捕手的方向看，看得出球的左右與高低，好球帶畫上九宮格與編號
  front: (zc) => ({ pos: new THREE.Vector3(0, zc.y, zc.z - 6), near: 6 - 0.7, far: 6 + 0.7, up: [0, 1, 0], outline: 'front' }),
  // 俯視：從正上方往下看，投手方向在畫面上方，看得出球在本壘板五角形上的位置
  top: (zc) => ({ pos: new THREE.Vector3(0, zc.y + 6, zc.z), near: 6 - 0.7, far: 6 + zc.y + 0.05, up: [0, 0, -1], outline: null }),
};

function setOrthoView(view) {
  G.orbit = null;
  replayFit.ready = false;
  camTween = null;
  controls.enabled = false;
  markView(view);
  const zc = new THREE.Vector3(0, (G.zone.bottom + G.zone.top) / 2, PLATE_SIDE);
  const v = ORTHO_VIEWS[view](zc);
  orthoCamera.position.copy(v.pos);
  orthoCamera.near = v.near;
  orthoCamera.far = v.far; // 好球帶前後以外的東西（捕手、打者）都裁掉，畫面只留好球帶附近
  orthoCamera.up.set(...v.up);
  orthoCamera.lookAt(zc);
  setZoneOutlineMode(v.outline);
  resizeOrtho();
  activeCamera = orthoCamera;
}

function goView(view) {
  if (ORTHO_VIEWS[view]) return setOrthoView(view);
  activeCamera = camera;
  setZoneOutlineMode(null);
  if (view === 'orbit') return startOrbit();
  G.orbit = null;
  markView(view);
  const pose = viewPose(view);
  controls.enabled = true;
  camera.fov = view === 'batter' ? 65 : replayFov();
  camera.updateProjectionMatrix();
  if (reduceMotion) {
    camera.position.copy(pose.pos);
    controls.target.copy(pose.target);
    return;
  }
  camTween = {
    fromPos: camera.position.clone(), fromTarget: controls.target.clone(),
    pose, start: clock(), dur: 0.6,
  };
}

/* ---------- 捕手接球（現代 framing） ----------
   不是「接到球再把手套拉進好球帶」，而是預判落點，讓手套在移動中接球：
   手套先到落點的外側（稍微偏下），在球到達前開始往好球帶方向移動，
   接球瞬間手套仍帶著往內的速度，接著順勢減速停住（stick）。
   手套位置是「飛行時間 t」的函數，所以即時投球與慢動作重播都用同一條路徑。 */
const RECEIVE = {
  restDrop: 0.12,       // 投球前手套放在好球帶中央偏低處，不先比出配球位置
  react: 0.28,          // 球飛行到這個比例時捕手才開始移動手套
  lead: 0.2,            // 接球前多久開始往內移動（秒）
  borderRange: 0.12,    // 離好球帶邊緣 12 公分內的球都會用力偷
  approachBorder: 0.16, // 邊界球：手套從落點外側多遠處開始移動（公尺）
  approachClear: 0.05,  // 明顯的球：移動幅度小
  followMax: 0.24,      // 接球後最多再往內帶多少（公尺）
  shrink: 0.04,         // 帶到「好球帶內縮 4 公分」的位置，壞球停下來時看起來在好球帶裡
};

function hermite2(a, va, b, vb, s, h, out) {
  const s2 = s * s, s3 = s2 * s;
  const h00 = 2 * s3 - 3 * s2 + 1, h10 = s3 - 2 * s2 + s, h01 = -2 * s3 + 3 * s2, h11 = s3 - s2;
  out.x = h00 * a.x + h10 * h * va.x + h01 * b.x + h11 * h * vb.x;
  out.y = h00 * a.y + h10 * h * va.y + h01 * b.y + h11 * h * vb.y;
  return out;
}

function gloveRestPosition(zone) {
  return new THREE.Vector2(0, (zone.bottom + zone.top) / 2 - RECEIVE.restDrop);
}

function planReceive(p) {
  const end = posAt(p, p.tEnd);
  const C = new THREE.Vector2(end.x, end.y);
  const z = p.zone;
  // 好球帶內縮後的最近點：手套要往這個方向帶
  const inner = new THREE.Vector2(
    THREE.MathUtils.clamp(C.x, -PLATE_HALF + RECEIVE.shrink, PLATE_HALF - RECEIVE.shrink),
    THREE.MathUtils.clamp(C.y, z.bottom + RECEIVE.shrink, z.top - RECEIVE.shrink)
  );
  const toInner = inner.clone().sub(C);
  const border = Math.abs(p.margin) < RECEIVE.borderRange;
  let dir, follow;
  if (toInner.length() < 0.005) {
    dir = new THREE.Vector2(0, 1); // 已經在好球帶深處：輕輕往上接
    follow = 0.015;
  } else {
    dir = toInner.clone().normalize();
    // 邊界球：一路帶到好球帶內側才停；明顯的球只順勢帶一小段
    follow = border
      ? THREE.MathUtils.clamp(toInner.length() + 0.02, 0.05, RECEIVE.followMax)
      : THREE.MathUtils.clamp(toInner.length() * 0.25, 0.015, 0.06);
  }
  const approach = border ? RECEIVE.approachBorder : RECEIVE.approachClear;
  const lead = Math.min(RECEIVE.lead, p.tEnd * 0.5);
  const S = C.clone().addScaledVector(dir, -approach).add(new THREE.Vector2(0, -0.02));
  let speed = (1.6 * approach) / lead;            // 接球瞬間手套的速度
  const tail = THREE.MathUtils.clamp((2 * follow) / speed, 0.12, 0.45); // 接球後減速到停住的時間
  speed = Math.min(speed, (2.5 * follow) / tail); // 帶得少時速度也要小，停住時才不會衝過頭再彈回
  const vC = dir.clone().multiplyScalar(speed);
  const E = C.clone().addScaledVector(dir, follow);
  // 投球前手套放在中央偏低處，不洩漏落點；球出手後才判斷位置開始移動
  const setup = gloveRestPosition(z);
  const tReact = Math.min(p.tEnd * RECEIVE.react, p.tEnd - lead - 0.1);
  return { C, S, E, vC, lead, tail, setup, tReact, zero: new THREE.Vector2() };
}

// t：球出手後經過的時間（秒）；可以超過 tEnd（接球後的順勢動作）
function glovePosAt(p, t, out) {
  const r = p.receive;
  const tStart = p.tEnd - r.lead;
  const v = new THREE.Vector2();
  if (t <= r.tReact) {
    v.copy(r.setup); // 還沒判斷出球路，手套不動
  } else if (t <= tStart) {
    const k = THREE.MathUtils.smootherstep(t, r.tReact, tStart);
    v.lerpVectors(r.setup, r.S, k);
  } else if (t <= p.tEnd) {
    hermite2(r.S, r.zero, r.C, r.vC, (t - tStart) / r.lead, r.lead, v);
  } else {
    hermite2(r.C, r.vC, r.E, r.zero, Math.min((t - p.tEnd) / r.tail, 1), r.tail, v);
  }
  return out.set(v.x, v.y, CATCH_Z);
}

// 球在手套裡的位置：有捕手模型時用畫面上手套口袋的實際位置
function ballInGlove(out) {
  if (catcherRig.model && catcherMittValid) return out.copy(catcherMitt);
  return out.set(glove.position.x, glove.position.y, CATCH_Z - 0.03);
}

/* ---------- 投球流程 ---------- */

function startPitch() {
  if (G.phase !== 'ready') return;
  G.pitch = makePitch(G.pitcherHand, G.zone, settings.speed, settings.difficulty, G.pitcherStyle);
  G.call = null;
  G.practice = ui.showZone.checked;
  G.phase = 'windup';
  G.phaseStart = clock();
  ui.btnPitch.hidden = true;
  ui.calls.hidden = false;
  setCallButtons(false);
  ui.prompt.textContent = '投手準備投球…';
  zoneGroup.visible = G.practice;
  replayGroup.visible = false;
  // 先算好接球路徑；投球前手套維持在中央偏低處，不先比出位置
  G.pitch.receive = planReceive(G.pitch);
}

function setCallButtons(on) {
  ui.btnBall.disabled = !on;
  ui.btnStrike.disabled = !on;
}

function makeCall(isStrike) {
  if (G.phase !== 'flight' && G.phase !== 'decide') return;
  const t = clock();
  const sincePlate = t - (G.flightStart + G.pitch.tPlate);
  if (sincePlate < 0) return; // 球還沒到本壘板
  G.call = { isStrike, time: sincePlate };
  finishPitch();
}

function finishPitch() {
  const p = G.pitch, call = G.call;
  const correct = call && call.isStrike === p.isStrike;
  const absM = Math.abs(p.margin);
  let points = 0;

  if (!call) {
    flash('超時', 'none');
    points = -50;
  } else {
    flash(call.isStrike ? '好球！' : '壞球！', call.isStrike ? 'strike' : 'ball');
    points = correct ? 100 + (absM < EDGE ? 50 : 0) + (call.time < 0.6 ? 20 : 0) : -50;
  }
  if (G.practice) points = 0;

  G.score += points;
  G.n++;

  G.history.push({ p, call, correct, points });
  showResult({ correct, points });

  G.phase = 'result';
  appEl.dataset.phase = 'result';
  G.replayStart = clock();
  setCallButtons(false);
  ui.calls.hidden = true;
  ui.prompt.textContent = '';
  zoneGroup.visible = true;
  replayGroup.visible = true;
  buildReplay(trajectoryPoints(p), p.contact, p.isStrike, p.zone);
  startOrbit();
  renderBoard();
}

function showResult({ correct, points }) {
  const p = G.pitch, call = G.call;
  ui.verdict.textContent = !call ? '超時' : correct ? '正確' : '誤判';
  ui.verdict.className = 'verdict ' + (correct ? 'good' : 'bad');
  let truth = `實際是 <b>${p.isStrike ? '好球' : '壞球'}</b>`;
  if (p.backDoor) truth += '：在本壘板前緣是壞球，但擦過五角柱的後段';
  else if (Math.abs(p.margin) < EDGE) truth += '：邊界球';
  ui.truth.innerHTML = truth;
  ui.fType.textContent = `${pitcherLabel()} ${p.type.name}`;
  ui.fSpeed.textContent = `${(p.mph * MPH * KMH).toFixed(1)} km/h`;
  ui.fMargin.textContent = marginText(p);
  ui.fTime.textContent = call ? `${call.time.toFixed(2)} 秒` : '—';
  ui.absNote.hidden = true;
  ui.paNote.hidden = true;
  ui.fPoints.textContent = G.practice ? '練習模式，不計分' : `${points > 0 ? '+' : ''}${points} 分`;
  ui.fPoints.className = 'points ' + (G.practice ? '' : points >= 0 ? 'plus' : 'minus');
  ui.result.hidden = false;
  ui.btnNext.innerHTML = G.n >= TOTAL_PITCHES ? '看本場結算 <kbd>Space</kbd>' : '下一球 <kbd>Space</kbd>';
}

function flash(text, cls) {
  ui.flash.textContent = text;
  ui.flash.className = 'call-flash';
  void ui.flash.offsetWidth;
  ui.flash.className = `call-flash show ${cls}`;
}

function nextPitch() {
  if (G.phase !== 'result') return;
  ui.result.hidden = true;
  ui.tag.hidden = true;
  if (G.n >= TOTAL_PITCHES) return showSummary();
  if (G.n % BATTER_PITCHES === 0) newAtBat();
  toReady();
}

function toReady() {
  G.phase = 'ready';
  appEl.dataset.phase = 'play';
  hideBall();
  setBallReplayLook(false);
  animatePitcher(-windupTime());
  replayGroup.visible = false;
  zoneGroup.visible = ui.showZone.checked;
  const rest = gloveRestPosition(G.zone);
  glove.position.set(rest.x, rest.y, CATCH_Z);
  setUmpCamera();
  ui.btnPitch.hidden = false;
  ui.calls.hidden = true;
  // 每場第一球前告訴玩家這場的投手是誰
  const intro = G.n === 0 ? `本場投手：${pitcherLabel()}` : '';
  ui.prompt.textContent = touchUI() ? intro : [intro, '按空白鍵，請投手投球'].filter(Boolean).join('　');
  renderBoard();
}

function startGame() {
  Object.assign(G, { n: 0, score: 0, history: [], view: 'orbit' });
  ui.intro.hidden = true;
  ui.summary.hidden = true;
  ui.result.hidden = true;
  ui.tag.hidden = true;
  ui.flash.className = 'call-flash';
  setCallButtons(false);
  chooseGamePitcher();
  newAtBat();
  toReady();
}

/* ---------- 每幀更新 ---------- */

const tmp = new THREE.Vector3();

// trail：{ p, t, span } 代表這一幀曝光期間球走過的軌跡；null 代表球靜止（在手套裡）
function placeBall(pos, spin, trail) {
  ball.visible = true;
  ball.position.copy(pos);
  ball.rotation.x = spin;
  ballShadow.visible = true;
  ballShadow.position.set(pos.x, 0.01, pos.z);
  ballShadow.material.opacity = Math.max(0.1, 0.5 - pos.y * 0.18);
  const blur = trail && settings.blur;
  blurBalls.forEach((m, i) => {
    const tt = blur ? trail.t - (trail.span * (i + 1)) / BLUR_SAMPLES : -1;
    m.visible = tt > 0;
    if (m.visible) posAt(trail.p, tt, m.position);
  });
}

function hideBall() {
  ball.visible = false;
  ballShadow.visible = false;
  blurBalls.forEach((m) => (m.visible = false));
}

function animatePitcher(t) {
  // t：相對出手瞬間的秒數（負值是揮臂準備）
  if (posePitcherModel(pitcherRig.releaseT + t)) return;
  let arm = 0, leg = 0;
  if (t < -0.4) { const k = (t + 1.0) / 0.6; arm = 1.1 * k; leg = -1.2 * Math.sin(Math.PI * k); }
  else if (t < 0) { const k = (t + 0.4) / 0.4; arm = 1.1 - 3.7 * k * k; }
  else if (t < 0.35) { arm = -2.6 - 1.2 * (t / 0.35); }
  else if (t < 1.2) { arm = -3.8 + 3.8 * ((t - 0.35) / 0.85); }
  pitcherArm.rotation.x = arm;
  pitcherLeg.rotation.x = leg;
}

function update() {
  const now = clock();
  const p = G.pitch;

  if (G.phase === 'windup') {
    const t = now - G.phaseStart;
    animatePitcher(t - windupTime());
    if (t >= windupTime()) {
      G.phase = 'flight';
      G.flightStart = now;
      ui.prompt.textContent = '';
    }
  } else if (G.phase === 'flight') {
    const t = now - G.flightStart;
    animatePitcher(t);
    if (t >= p.tPlate) setCallButtons(true);
    if (t >= p.tEnd) {
      G.phase = 'decide';
      G.catchAt = now;
      placeBall(posAt(p, p.tEnd, tmp), p.tEnd * 25, null);
      ui.prompt.textContent = '判決！';
    } else {
      // 即時畫面降低縫線轉速，避免高速旋轉在低更新率下閃爍
      placeBall(posAt(p, t, tmp), t * 25, { p, t, span: frameDt });
      glovePosAt(p, t, glove.position); // 預判落點，手套在移動中接球
    }
  } else if (G.phase === 'decide') {
    const t = now - G.catchAt;
    animatePitcher(p.tEnd + t);
    // 接球後手套帶著慣性往好球帶方向減速停住，球跟著手套走
    glovePosAt(p, p.tEnd + t, glove.position);
    ballInGlove(tmp);
    placeBall(tmp, p.tEnd * 25, null);
    if (t > DECIDE_LIMIT) finishPitch();
  } else if (G.phase === 'result') {
    const loop = p.tEnd / REPLAY_SPEED + 1.2;
    const lt = ((now - G.replayStart) % loop) * REPLAY_SPEED;
    const t = Math.min(lt, p.tEnd);
    G.replayT = t;
    animatePitcher(t); // 投手動作跟著慢動作重播
    // 重播是慢動作，縫線用真實轉速（約 2100 rpm）
    glovePosAt(p, lt, glove.position); // 重播也看得到手套在移動中接球
    if (lt < p.tEnd) {
      placeBall(posAt(p, t, tmp), t * 220, { p, t, span: frameDt * REPLAY_SPEED });
    } else {
      ballInGlove(tmp);
      placeBall(tmp, p.tEnd * 220, null);
    }
    updateTag(p);
  }

  if (G.phase === 'ready' || G.phase === 'windup' || G.phase === 'flight' || G.phase === 'decide') {
    // 主審蹲姿的輕微呼吸晃動，提供些許動態視差
    const eye = umpEye();
    camera.position.set(eye.x + Math.sin(now * 0.9) * 0.004, eye.y + Math.sin(now * 1.4) * 0.005, eye.z);
    camera.lookAt(umpFrame.look);
  }

  updateBatterAndCatcher(now);

  if (G.phase === 'result') {
    if (G.orbit) updateOrbit(now);
    applyResultOffset();
  }

  if (camTween) {
    const k = THREE.MathUtils.smootherstep(now - camTween.start, 0, camTween.dur);
    camera.position.lerpVectors(camTween.fromPos, camTween.pose.pos, k);
    controls.target.lerpVectors(camTween.fromTarget, camTween.pose.target, k);
    if (k >= 1) camTween = null;
  }
  if (controls.enabled && !G.orbit) controls.update();
}

// 打者：待機時循環晃棒；投手出手前開始拉棒跨步，之後看球進捕手手套
const BATTER_FLIGHT = 0.43; // 打者動畫是以職業球速（約 0.43 秒到捕手）設計的
function batterAnimTime(now) {
  const r = batterRig;
  const idle = now % r.idleEnd;
  switch (G.phase) {
    case 'windup': {
      const t = r.releaseT - (windupTime() - (now - G.phaseStart));
      return t >= r.idleEnd ? t : idle;
    }
    case 'flight':
      return r.releaseT + (now - G.flightStart) * (BATTER_FLIGHT / G.pitch.tEnd);
    case 'decide':
      return r.releaseT + BATTER_FLIGHT + (now - G.catchAt);
    case 'result':
      return r.releaseT + (G.replayT || 0) * (BATTER_FLIGHT / G.pitch.tEnd);
    default:
      return idle;
  }
}

function updateBatterAndCatcher(now) {
  // 打者視角時攝影機就在打者肩膀旁，隱藏打者本人才不會擋住畫面
  const inBatterView = G.phase === 'result' && G.view === 'batter';
  if (batterRig.model) batterRig.model.visible = !inBatterView;
  // 只在主審視角時半透明，重播換視角時恢復原樣
  const umpView = G.phase !== 'result' && G.phase !== 'summary';
  const replay = G.phase === 'result';
  setCatcherAlpha(replay ? 0.25 : settings.ghostCatcher && umpView ? 0.28 : 1);
  setBatterAlpha(replay ? 0.25 : 1);
  if (batterRig.model) poseRig(batterRig, batterAnimTime(now));
  if (catcherRig.model) {
    poseRig(catcherRig, now % 2.0);
    catcherReach(glove.position, frameDt);
  }
}

function updateTag(p) {
  const v = p.contact.clone().project(activeCamera);
  if (v.z > 1) { ui.tag.hidden = true; return; }
  ui.tag.hidden = false;
  ui.tag.style.color = p.isStrike ? '#FFD23F' : '#4FCB85';
  ui.tag.textContent = marginTag(p);
  // 標籤放在球的右上方，離遠一點才不會擋住球；右邊放不下就翻到左邊，
  // 而且整塊一定要留在畫面內
  const { w, h } = viewSize();
  const x = (v.x * 0.5 + 0.5) * w, y = (-v.y * 0.5 + 0.5) * h;
  const tw = ui.tag.offsetWidth, th = ui.tag.offsetHeight;
  const gap = 46, lift = 34, pad = 8;
  let left = x + gap;
  if (left + tw > w - pad) left = x - gap - tw;
  ui.tag.style.left = `${Math.min(Math.max(left, pad), Math.max(pad, w - pad - tw))}px`;
  const top = y - lift, lo = pad + th / 2, hi = Math.max(lo, h - pad - th / 2);
  ui.tag.style.top = `${Math.min(Math.max(top, lo), hi)}px`;
  ui.tag.style.transform = 'translateY(-50%)';
}

/* ---------- 畫面更新率與設定 ---------- */

const settings = { fpsCap: 0, blur: true, showFps: false, speed: 0.7, difficulty: 'normal', pitcherStyle: 'over', umpStance: 'center', ghostCatcher: false };
try { Object.assign(settings, JSON.parse(localStorage.getItem('umpire-eye-settings') || '{}')); } catch (e) {}
const saveSettings = () => { try { localStorage.setItem('umpire-eye-settings', JSON.stringify(settings)); } catch (e) {} };

let frameDt = 1 / 60, lastFrame = 0, fpsFrames = 0, fpsSince = 0;

// requestAnimationFrame 跟螢幕更新率同步；設定上限時就跳過多餘的幀
function frame(ts) {
  requestAnimationFrame(frame);
  if (settings.fpsCap && lastFrame && ts - lastFrame < 1000 / settings.fpsCap - 1.5) return;
  frameDt = lastFrame ? Math.min((ts - lastFrame) / 1000, 1 / 20) : 1 / 60;
  lastFrame = ts;
  update();
  const umpView = G.phase !== 'result' && G.phase !== 'summary';
  renderFrame(umpView && umpStance === 'center');

  fpsFrames++;
  if (ts - fpsSince >= 500) {
    const fps = Math.round((fpsFrames * 1000) / (ts - fpsSince));
    $('fpsNow').textContent = fps;
    ui.fpsBadge.textContent = `${fps} FPS`;
    fpsFrames = 0;
    fpsSince = ts;
  }
}

ui.fpsBadge = $('fpsBadge');
const fpsCapEl = $('fpsCap'), blurEl = $('motionBlur'), showFpsEl = $('showFps'), btnSettings = $('btnSettings');
fpsCapEl.value = String(settings.fpsCap);

const stanceEl = $('umpStance'), ghostEl = $('ghostCatcher');
if (settings.umpStance !== 'center' && !UMP_STANCES[settings.umpStance]) settings.umpStance = 'center';
umpStance = settings.umpStance;
stanceEl.value = settings.umpStance;
ghostEl.checked = settings.ghostCatcher;
function onViewSettingChange() {
  saveSettings();
  if (G.phase !== 'result' && G.phase !== 'summary') setUmpCamera();
}
stanceEl.addEventListener('change', () => {
  settings.umpStance = umpStance = stanceEl.value;
  onViewSettingChange();
  stanceEl.blur();
});
ghostEl.addEventListener('change', () => {
  settings.ghostCatcher = ghostEl.checked;
  onViewSettingChange();
  ghostEl.blur();
});

// 球速：只影響下一球。依四縫線速球的範圍換算，讓玩家知道大概多快、要多久到本壘板
/* ---------- 開場設定：投手類型、判決難度、球速 ----------
   在開場畫面選好才開始新的一場，整場都不會改變。 */
const PITCHER_STYLE_NOTES = {
  random: '每一場隨機決定上肩投、側投或下勾投，左右投也隨機。',
  over: '四分之三的上肩投法，出手點最高。',
  side: '手臂在肩膀高度往外平伸出手，橫向位移大、球比較沉。',
  sub: '手在膝蓋高度甩出，球從低處往上進壘，高低球最難判。',
};
const SPEED_LABELS = { 1: '職業', 0.85: '高中、大學', 0.7: '青少年', 0.5: '慢速練習' };

if (settings.pitcherStyle !== 'random' && !PITCH_STYLES[settings.pitcherStyle]) settings.pitcherStyle = 'random';
if (!DIFFICULTIES[settings.difficulty]) settings.difficulty = 'normal';
if (!SPEED_LABELS[settings.speed]) settings.speed = 1;

function renderSetupNotes() {
  $('pitcherStyleNote').textContent = PITCHER_STYLE_NOTES[settings.pitcherStyle];
  $('difficultyNote').textContent = DIFFICULTIES[settings.difficulty].note;
  const ff = PITCH_TYPES[0].mph.map((v) => Math.round(v * settings.speed * MPH * KMH));
  const flight = (60.5 * FT - 1.9) / ((((ff[0] + ff[1]) / 2) / KMH) * 0.95);
  $('speedNote').innerHTML = `上肩投的速球約 <b>${ff[0]}–${ff[1]}</b> km/h，約 <b>${flight.toFixed(2)}</b> 秒到本壘板。`;
}

function syncSetupForm() {
  const pick = (name, value) => {
    const el = document.querySelector(`input[name="${name}"][value="${value}"]`);
    if (el) el.checked = true;
  };
  pick('pitcherStyle', settings.pitcherStyle);
  pick('difficulty', settings.difficulty);
  pick('pitchSpeed', String(settings.speed));
  renderSetupNotes();
}

$('setup').addEventListener('change', (e) => {
  const { name, value } = e.target;
  if (name === 'pitcherStyle') settings.pitcherStyle = value;
  else if (name === 'difficulty') settings.difficulty = value;
  else if (name === 'pitchSpeed') settings.speed = Number(value);
  saveSettings();
  renderSetupNotes();
});
syncSetupForm();

// 回到開場設定畫面（結算後、或按重新開始）
function showSetup() {
  G.phase = 'intro';
  appEl.dataset.phase = 'play';
  G.orbit = null;
  ui.summary.hidden = true;
  ui.result.hidden = true;
  ui.tag.hidden = true;
  ui.calls.hidden = true;
  setCallButtons(false);
  hideBall();
  setBallReplayLook(false);
  setUmpCamera();
  syncSetupForm();
  ui.intro.hidden = false;
  ui.intro.scrollTop = 0;
}

blurEl.checked = settings.blur;
showFpsEl.checked = settings.showFps;
ui.fpsBadge.hidden = !settings.showFps;
fpsCapEl.addEventListener('change', () => { settings.fpsCap = Number(fpsCapEl.value); saveSettings(); fpsCapEl.blur(); });
blurEl.addEventListener('change', () => { settings.blur = blurEl.checked; saveSettings(); blurEl.blur(); });
showFpsEl.addEventListener('change', () => {
  settings.showFps = showFpsEl.checked;
  ui.fpsBadge.hidden = !settings.showFps;
  saveSettings();
  showFpsEl.blur();
});
btnSettings.addEventListener('click', () => {
  const open = $('settings').hidden;
  $('settings').hidden = !open;
  btnSettings.setAttribute('aria-expanded', String(open));
});

/* ---------- 結算 ---------- */

function showSummary() {
  $('summaryEyebrow').textContent = `本場結算 · ${pitcherLabel()} · ${DIFFICULTIES[settings.difficulty].label}難度 · ${SPEED_LABELS[settings.speed]}球速`;
  const H = G.history;
  const correct = H.filter((h) => h.correct).length;
  const edge = H.filter((h) => Math.abs(h.p.margin) < EDGE);
  const edgeOk = edge.filter((h) => h.correct).length;
  const acc = correct / H.length;
  $('sAcc').textContent = `${Math.round(acc * 100)}%`;
  $('sEdge').textContent = edge.length ? `${edgeOk}/${edge.length}` : '—';
  $('sOver').textContent = H.filter((h) => !h.call).length;
  $('sScore').textContent = G.score;
  $('grade').textContent =
    acc >= 0.93 ? '大聯盟主審等級' :
    acc >= 0.85 ? '3A 主審，離大聯盟不遠' :
    acc >= 0.7 ? '業餘聯盟主審' : '建議回裁判學校進修';
  ui.summary.hidden = false;
  G.phase = 'summary';
  drawChart(H);
  // 版面剛展開時畫布可能還量不到寬度，隔一拍再畫一次確保落點圖有出現
  setTimeout(() => { if (G.phase === 'summary') drawChart(H); }, 80);
}

function drawChart(H) {
  const cv = $('chart');
  const dpr = Math.min(window.devicePixelRatio, 2);
  const w = cv.clientWidth, h = cv.clientHeight;
  cv.width = w * dpr; cv.height = h * dpr;
  const g = cv.getContext('2d');
  g.scale(dpr, dpr);
  g.clearRect(0, 0, w, h);

  // x：英寸（主審視角），y：好球帶高度正規化後換算成 22 吋的等效高度
  // 座標範圍依實際落點決定，確保每一顆球（含球的半徑與外框留白）都畫得進來
  const ZONE_IN = 22, PAD = 3;
  const yInOf = (hh) => ((hh.p.contact.y - hh.p.zone.bottom) / (hh.p.zone.top - hh.p.zone.bottom) - 0.5) * ZONE_IN;
  let halfX = 13, halfY = 15;
  H.forEach((hh) => {
    halfX = Math.max(halfX, Math.abs(hh.p.contact.x / IN) + PAD);
    halfY = Math.max(halfY, Math.abs(yInOf(hh)) + PAD);
  });
  const labelPx = 22; // 底下留給「43.2 cm」那行字
  const pxPerIn = Math.min(w / (2 * halfX), (h - labelPx) / (2 * halfY));
  const cx = w / 2, zoneH = ZONE_IN * pxPerIn, cy = (h - labelPx) / 2;
  const X = (xIn) => cx + xIn * pxPerIn;
  const Y = (yn) => cy + zoneH / 2 - yn * zoneH;

  g.strokeStyle = 'rgba(237,234,224,0.12)';
  g.lineWidth = 1;
  for (let i = 1; i < 3; i++) {
    g.beginPath(); g.moveTo(X(-8.5 + (17 * i) / 3), Y(0)); g.lineTo(X(-8.5 + (17 * i) / 3), Y(1)); g.stroke();
    g.beginPath(); g.moveTo(X(-8.5), Y(i / 3)); g.lineTo(X(8.5), Y(i / 3)); g.stroke();
  }
  g.strokeStyle = '#F3B33D';
  g.lineWidth = 2;
  g.strokeRect(X(-8.5), Y(1), 17 * pxPerIn, zoneH);

  g.fillStyle = '#9AA7B6';
  g.font = '12px "JetBrains Mono", monospace';
  g.textAlign = 'center';
  g.fillText('43.2 cm', cx, Y(0) + 18);

  H.forEach((hh) => {
    const z = hh.p.zone;
    const xIn = hh.p.contact.x / IN;
    const yn = (hh.p.contact.y - z.bottom) / (z.top - z.bottom);
    void z;
    const r = Math.max(4, 1.45 * pxPerIn);
    const color = hh.correct ? '#6CCB8C' : '#EE6A4F';
    g.beginPath();
    g.arc(X(xIn), Y(yn), r, 0, Math.PI * 2);
    if (hh.p.isStrike) { g.fillStyle = color; g.fill(); }
    else { g.strokeStyle = color; g.lineWidth = 2; g.stroke(); }
  });
}

/* ---------- 輸入 ---------- */

ui.btnPitch.addEventListener('click', startPitch);
ui.btnBall.addEventListener('click', () => makeCall(false));
ui.btnStrike.addEventListener('click', () => makeCall(true));
ui.btnNext.addEventListener('click', nextPitch);
$('btnStart').addEventListener('click', startGame);
$('btnAgain').addEventListener('click', showSetup);

// 重新開始：打到一半時要再按一次確認，避免誤按清掉分數；還沒投球或已結算就直接重來
const btnRestart = $('btnRestart');
let restartTimer = null;
function resetRestartButton() {
  clearTimeout(restartTimer);
  btnRestart.classList.remove('confirm');
  btnRestart.textContent = '重新開始';
}
function requestRestart() {
  if (G.phase === 'intro') return;
  const inProgress = G.n > 0 && G.phase !== 'summary';
  if (inProgress && !btnRestart.classList.contains('confirm')) {
    btnRestart.classList.add('confirm');
    btnRestart.textContent = '再按一次確認';
    restartTimer = setTimeout(resetRestartButton, 3000);
    return;
  }
  resetRestartButton();
  showSetup();
}
btnRestart.addEventListener('click', () => { requestRestart(); btnRestart.blur(); });
ui.showZone.addEventListener('change', () => {
  if (G.phase === 'ready') zoneGroup.visible = ui.showZone.checked;
  ui.showZone.blur();
});
document.querySelectorAll('.views button').forEach((b) =>
  b.addEventListener('click', () => { if (G.phase === 'result') goView(b.dataset.view); })
);

window.addEventListener('keydown', (e) => {
  if (e.repeat || ['SELECT', 'INPUT', 'TEXTAREA'].includes(e.target.tagName) || e.target === btnSettings) return;
  const k = e.key.toLowerCase();
  if (k === ' ' || k === 'enter') {
    if (G.phase === 'intro' && k === 'enter') return startGame();
    e.preventDefault();
    if (G.phase === 'ready') startPitch();
    else if (G.phase === 'result') nextPitch();
  } else if (k === 's' || k === 'arrowright') {
    makeCall(true);
  } else if (k === 'b' || k === 'arrowleft') {
    makeCall(false);
  } else if (k === 'r') {
    requestRestart();
  }
});

/* ---------- 預覽裝置：電腦 / 手機直向 / 手機橫向 ----------
   在電腦上把遊戲框縮成手機大小，版面（觸控按鈕配置）與相機都照手機計算。真的手機上不顯示。 */
const SIM_DEVICES = { portrait: [390, 844], landscape: [844, 390] };
const touchUI = () => appEl.classList.contains('touch');
let applyingDevice = false;

function applyDevice(mode, notify = true) {
  if (IS_TOUCH || !SIM_DEVICES[mode]) mode = 'desktop';
  settings.device = mode;
  const sim = mode !== 'desktop';
  document.body.classList.toggle('sim-phone', sim);
  appEl.classList.toggle('touch', IS_TOUCH || sim);
  if (sim) {
    const [w, h] = SIM_DEVICES[mode];
    const k = Math.min(1, (window.innerWidth - 48) / w, (window.innerHeight - 96) / h);
    Object.assign(appEl.style, { width: `${w}px`, height: `${h}px`, transform: `scale(${k})`, flex: 'none' });
  } else {
    Object.assign(appEl.style, { width: '', height: '', transform: '' });
  }
  document.querySelectorAll('#deviceSwitch button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.device === mode)));
  if (notify) {
    applyingDevice = true;
    window.dispatchEvent(new Event('resize'));
    applyingDevice = false;
    if (G.phase === 'ready' || G.phase === 'intro' || G.phase === 'windup') setUmpCamera();
  }
}

document.querySelectorAll('#deviceSwitch button').forEach((b) => b.addEventListener('click', () => {
  applyDevice(b.dataset.device);
  saveSettings();
  b.blur();
}));
window.addEventListener('resize', () => { if (!applyingDevice) applyDevice(settings.device, false); });
applyDevice(settings.device || 'desktop');

// 開場畫面背後先擺好主審視角
chooseGamePitcher();
newAtBat();
toReady();
G.phase = 'intro';
requestAnimationFrame(frame);
