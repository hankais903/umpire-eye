/* 主審之眼：投球物理與好球帶判定
   軌跡採用 Statcast 的等加速度模型：p(t) = p0 + v0·t + ½·a·t²
   加速度已包含重力、馬格努斯力與空氣阻力的平均效果。 */

// armSide：往投球手臂側的橫向加速度（m/s²），負值代表往手套側
// drop：垂直加速度（含重力），數值參考大聯盟各球種的平均位移
const PITCH_TYPES = [
  { key: 'FF', name: '四縫線速球', mph: [92, 98], armSide: 3.0, drop: -4.4, weight: 34 },
  { key: 'SI', name: '伸卡球', mph: [91, 96], armSide: 6.4, drop: -7.6, weight: 14 },
  { key: 'FC', name: '卡特球', mph: [86, 92], armSide: -2.4, drop: -7.6, weight: 10 },
  { key: 'SL', name: '滑球', mph: [83, 89], armSide: -4.2, drop: -11.0, weight: 16 },
  { key: 'ST', name: '橫掃球', mph: [80, 85], armSide: -7.6, drop: -10.2, weight: 8 },
  { key: 'CU', name: '曲球', mph: [76, 82], armSide: -3.6, drop: -17.5, weight: 9 },
  { key: 'CH', name: '變速球', mph: [82, 88], armSide: 5.8, drop: -10.4, weight: 9 },
];

// 投法：影響球速、橫向位移（run）、旋轉造成的上飄或下沉（lift）與球種比例
// 側投：球比較慢一點、橫向位移大、比較沉；下勾投：球速明顯較慢、橫向位移最大，速球有上竄感
const PITCH_STYLES = {
  over: { label: '上肩投', speed: 1, run: 1, lift: 1, weights: {} },
  side: {
    label: '側投', speed: 0.95, run: 1.35, lift: 0.7,
    weights: { FF: 18, SI: 28, FC: 6, SL: 18, ST: 18, CU: 3, CH: 9 },
  },
  sub: {
    label: '下勾投', speed: 0.86, run: 1.5, lift: 1.25,
    weights: { FF: 26, SI: 26, FC: 4, SL: 14, ST: 8, CU: 4, CH: 18 },
  },
};

const rand = (a, b) => a + Math.random() * (b - a);
function gauss() {
  let u = 0;
  while (!u) u = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * Math.random());
}
function weightedPick(list) {
  let r = Math.random() * list.reduce((s, x) => s + x.weight, 0);
  for (const x of list) if ((r -= x.weight) <= 0) return x;
  return list[0];
}

// 好球帶上下緣依打者身高估算（肩膀與褲帶中點、膝蓋下緣）
function zoneForHeight(h) {
  return { bottom: h * 0.27, top: h * 0.565 };
}

const GRAVITY = 9.81;

// speedFactor：球速倍率。球變慢時旋轉造成的位移（馬格努斯力）與空氣阻力都跟速度平方成正比，
// 重力不變，所以慢速球的下墜比例會變大，跟真實的慢速投球一樣
// 判決難度：決定擦邊球的比例，以及擦邊的程度
// margin 是「球與好球帶的距離」（公尺）：負值代表碰到（好球），越接近 0 越擦邊
// cornerStrike 角落擦邊好球、edgeStrike 邊線擦邊好球、edgeBall 差一點的壞球、strike 明顯好球、ball 明顯壞球
const DIFFICULTIES = {
  easy: {
    label: '入門',
    note: '大多是明顯的好壞球，擦邊球少，而且擦得比較深。',
    mix: [
      { kind: 'cornerStrike', weight: 4, margin: [-0.04, -0.02] },
      { kind: 'edgeStrike', weight: 8, margin: [-0.04, -0.02] },
      { kind: 'edgeBall', weight: 10, margin: [0.03, 0.06] },
      { kind: 'strike', weight: 45 },
      { kind: 'ball', weight: 33, margin: [0.08, 0.25] },
    ],
  },
  normal: {
    label: '普通',
    note: '好壞球與擦邊球各半，擦邊大約 1～3 公分。',
    mix: [
      { kind: 'cornerStrike', weight: 8, margin: [-0.03, -0.008] },
      { kind: 'edgeStrike', weight: 14, margin: [-0.03, -0.008] },
      { kind: 'edgeBall', weight: 20, margin: [0.01, 0.04] },
      { kind: 'strike', weight: 33 },
      { kind: 'ball', weight: 25, margin: [0.06, 0.2] },
    ],
  },
  hard: {
    label: '困難',
    note: '擦邊球變多，常常只差 1 公分左右，也會有擦過本壘板後方的好球。',
    mix: [
      { kind: 'cornerStrike', weight: 16, margin: [-0.018, -0.002] },
      { kind: 'edgeStrike', weight: 16, margin: [-0.018, -0.002] },
      { kind: 'edgeBall', weight: 23, margin: [0.003, 0.03] },
      { kind: 'strike', weight: 25 },
      { kind: 'ball', weight: 20, margin: [0.05, 0.18] },
    ],
  },
  mlb: {
    label: '大聯盟',
    note: '大部分是角落與邊線的擦邊球，只碰到好球帶一點點。',
    mix: [
      { kind: 'cornerStrike', weight: 30, margin: [-0.015, -0.001] },
      { kind: 'edgeStrike', weight: 18, margin: [-0.015, -0.001] },
      { kind: 'edgeBall', weight: 22, margin: [0.002, 0.03] },
      { kind: 'strike', weight: 17 },
      { kind: 'ball', weight: 13, margin: [0.06, 0.2] },
    ],
  },
};

// 依指定的出手條件與目標點（本壘板前緣平面）算出整顆球的軌跡與判定
function buildPitch(base, tx, ty) {
  const { type, speed, acc, p0, zone } = base;
  const target = new THREE.Vector3(tx, ty, PLATE_FRONT);
  // 反推初速：先猜飛行時間，再依實際速度修正
  let T = (target.z - p0.z) / speed;
  const v0 = new THREE.Vector3();
  for (let i = 0; i < 8; i++) {
    v0.subVectors(target, p0).addScaledVector(acc, -0.5 * T * T).divideScalar(T);
    T *= v0.length() / speed;
  }
  v0.subVectors(target, p0).addScaledVector(acc, -0.5 * T * T).divideScalar(T);
  const pitch = { type, mph: v0.length() / MPH, p0, v0, acc, zone, target };
  pitch.tPlate = timeAtZ(pitch, PLATE_FRONT);
  pitch.tEnd = timeAtZ(pitch, CATCH_Z);
  Object.assign(pitch, analyze(pitch));
  return pitch;
}

// 從好球帶中心沿著某個方向往外推，二分搜尋到剛好達成指定的 margin。
// 因為判定看的是整段 3D 軌跡，變化球擦過本壘板後方尖角的情況也會自然出現
function pitchWithMargin(base, dirX, dirY, wantMargin) {
  const cy = (base.zone.bottom + base.zone.top) / 2;
  let lo = 0, hi = 0.9, best = null;
  for (let i = 0; i < 16; i++) {
    const s = (lo + hi) / 2;
    const p = buildPitch(base, dirX * s, cy + dirY * s);
    if (!best || Math.abs(p.margin - wantMargin) < Math.abs(best.margin - wantMargin)) best = p;
    if (p.margin < wantMargin) lo = s; else hi = s;
  }
  return best;
}

function makePitch(pitcherHand, zone, speedFactor = 1, difficulty = 'normal', style = 'over') {
  const st = PITCH_STYLES[style] || PITCH_STYLES.over;
  const type = weightedPick(PITCH_TYPES.map((t) => Object.assign({}, t, { weight: st.weights[t.key] ?? t.weight })));
  const mph = rand(type.mph[0], type.mph[1]) * speedFactor * st.speed;
  const speed = mph * MPH;
  const f2 = speedFactor * speedFactor;
  const hs = pitcherHand === 'R' ? 1 : -1; // 右投手的手臂側在 -x
  const armSide = type.armSide * rand(0.8, 1.2) * f2 * st.run;
  const spinLift = (type.drop + GRAVITY) * rand(0.9, 1.1) * f2 * st.lift;
  const acc = new THREE.Vector3(
    -hs * armSide,
    spinLift - GRAVITY,
    -7.6 * (speed / 42) ** 2 // 空氣阻力讓球減速
  );
  // 出手點跟投手動畫同步；投手每球的出手點只有些微差異
  const modelP0 = modelReleasePoint(pitcherHand);
  const p0 = modelP0
    ? modelP0.add(new THREE.Vector3(gauss() * 0.015, gauss() * 0.015, 0))
    : new THREE.Vector3(-hs * rand(0.45, 0.62), rand(1.72, 1.86), RUBBER_Z + rand(1.8, 2.1));
  const base = { type, speed, acc, p0, zone };

  const hw = PLATE_HALF, hh = (zone.top - zone.bottom) / 2;
  const mix = weightedPick((DIFFICULTIES[difficulty] || DIFFICULTIES.normal).mix);
  if (mix.kind === 'strike') {
    return buildPitch(base, rand(-hw + 0.06, hw - 0.06), rand(zone.bottom + 0.07, zone.top - 0.07));
  }
  if (mix.kind === 'ball') {
    const a = Math.random() * Math.PI * 2;
    const want = rand(mix.margin[0], mix.margin[1]);
    return pitchWithMargin(base, Math.cos(a), Math.sin(a), want);
  }
  let a;
  if (mix.kind === 'cornerStrike') {
    // 對準四個角落之一，稍微偏一點
    const sx = Math.random() < 0.5 ? -1 : 1, sy = Math.random() < 0.5 ? -1 : 1;
    a = Math.atan2(sy * hh, sx * hw) + gauss() * 0.12;
  } else {
    // 上下左右四條邊，偏向邊的中段
    const side = Math.floor(Math.random() * 4);
    const spreadX = Math.atan2(hh, hw); // 角落方向的角度
    const center = [0, Math.PI / 2, Math.PI, -Math.PI / 2][side];
    const half = side % 2 === 0 ? spreadX : Math.PI / 2 - spreadX;
    a = center + rand(-0.8, 0.8) * half;
  }
  return pitchWithMargin(base, Math.cos(a), Math.sin(a), rand(mix.margin[0], mix.margin[1]));
}

function posAt(p, t, out = new THREE.Vector3()) {
  return out.copy(p.p0).addScaledVector(p.v0, t).addScaledVector(p.acc, 0.5 * t * t);
}

function timeAtZ(p, z) {
  const a = 0.5 * p.acc.z, b = p.v0.z, c = p.p0.z - z;
  if (Math.abs(a) < 1e-9) return -c / b;
  return (-b + Math.sqrt(b * b - 4 * a * c)) / (2 * a);
}

/* 本壘板五角形的 2D 幾何（x-z 平面） */
function inPlate(x, z) {
  let inside = false;
  for (let i = 0, j = PLATE_POLY.length - 1; i < PLATE_POLY.length; j = i++) {
    const [xi, zi] = PLATE_POLY[i], [xj, zj] = PLATE_POLY[j];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}
function plateEdgeDist(x, z) {
  let best = Infinity;
  for (let i = 0, j = PLATE_POLY.length - 1; i < PLATE_POLY.length; j = i++) {
    const [ax, az] = PLATE_POLY[j], [bx, bz] = PLATE_POLY[i];
    const dx = bx - ax, dz = bz - az;
    const k = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz)));
    best = Math.min(best, Math.hypot(x - ax - k * dx, z - az - k * dz));
  }
  return best;
}

// 球心到五角柱的帶號距離：在柱外為正、在柱內為負
function zoneSignedDist(p, zone) {
  const inside = inPlate(p.x, p.z);
  const edge = plateEdgeDist(p.x, p.z);
  const below = zone.bottom - p.y, above = p.y - zone.top;
  if (inside && below <= 0 && above <= 0) return -Math.min(edge, -below, -above);
  return Math.hypot(inside ? 0 : edge, Math.max(0, below, above));
}

// 沿著球通過本壘板的整段軌跡掃描。球的任何部分碰到五角柱就是好球
function analyze(p) {
  const t1 = timeAtZ(p, PLATE_FRONT - BALL_R - 0.01);
  const t2 = timeAtZ(p, BALL_R + 0.01);
  const pos = new THREE.Vector3();
  let best = Infinity, bestT = t1;
  for (let t = t1; t <= t2; t += 0.0001) {
    const d = zoneSignedDist(posAt(p, t, pos), p.zone);
    if (d < best) { best = d; bestT = t; }
  }
  const margin = best - BALL_R; // 負值代表球有碰到好球帶
  const contact = posAt(p, bestT);
  const front = posAt(p, p.tPlate);
  // 在本壘板前緣看起來是壞球、整段軌跡卻有碰到：只有 3D 才判得出來的好球
  const inFrontPlaneRect =
    Math.abs(front.x) <= PLATE_HALF + BALL_R &&
    front.y >= p.zone.bottom - BALL_R && front.y <= p.zone.top + BALL_R;
  return {
    isStrike: margin <= 0,
    margin,
    contact,
    front,
    backDoor: margin <= 0 && !inFrontPlaneRect,
  };
}

function trajectoryPoints(p) {
  const pts = [];
  for (let i = 0; i <= 400; i++) pts.push(posAt(p, (p.tEnd * i) / 400));
  return pts;
}
