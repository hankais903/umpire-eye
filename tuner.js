/* 主審之眼：視角調整面板
   即時調整「正中間」站位的相機與捕手位置，數值存在瀏覽器，並可複製給開發者設成預設值。 */

const TUNER_FIELDS = [
  { key: 'y', label: '主審眼睛高度', unit: 'm', min: 0.8, max: 2.5, step: 0.01 },
  { key: 'z', label: '主審距本壘板尖端', unit: 'm', min: 0.3, max: 5, step: 0.01 },
  { key: 'x', label: '主審左右偏移（+ 一壘側）', unit: 'm', min: -1, max: 1, step: 0.01 },
  { key: 'pitch', label: '鏡頭俯角', unit: '°', min: 0, max: 70, step: 0.5 },
  { key: 'yaw', label: '鏡頭左右轉向（+ 往右）', unit: '°', min: -30, max: 30, step: 0.5 },
  { key: 'vfov', label: '廣角：視野角度（越大看越廣）', unit: '°', min: 20, max: 140, step: 0.5 },
  { key: 'lens', label: '廣角：鏡頭變形（0 = 無，越大越像魚眼）', unit: '', min: 0, max: 2, step: 0.01 },
  { key: 'catcherZ', label: '捕手腳跟距本壘板尖端', unit: 'm', min: 0.6, max: 3.5, step: 0.01 },
  { key: 'catcherShift', label: '捕手往遠離打者側偏移', unit: 'm', min: -0.5, max: 0.5, step: 0.01 },
];

const CATCHER_DEFAULT = Object.freeze({ catcherZ: CATCHER_FEET_Z, catcherShift: CATCHER_SHIFT });
const CATCH_REACH = CATCHER_FEET_Z - CATCH_Z; // 捕手腳跟到手套接球點的距離

function tunerValues() {
  return {
    y: BROADCAST_CAM.y, z: BROADCAST_CAM.z, x: BROADCAST_CAM.x,
    pitch: BROADCAST_CAM.pitch, yaw: BROADCAST_CAM.yaw, vfov: BROADCAST_CAM.vfov, lens: BROADCAST_CAM.lens,
    catcherZ: CATCHER_FEET_Z, catcherShift: CATCHER_SHIFT,
  };
}

function applyTunerValues(v) {
  ['y', 'z', 'x', 'pitch', 'yaw', 'vfov', 'lens'].forEach((k) => {
    if (typeof v[k] === 'number') BROADCAST_CAM[k] = v[k];
  });
  lens.k = BROADCAST_CAM.lens;
  if (typeof v.catcherZ === 'number') CATCHER_FEET_Z = v.catcherZ;
  if (typeof v.catcherShift === 'number') CATCHER_SHIFT = v.catcherShift;
  CATCH_Z = CATCHER_FEET_Z - CATCH_REACH; // 手套接球點在捕手腳跟前方
  placeCatcher();
  if (G.phase !== 'result' && G.phase !== 'summary') {
    setUmpCamera();
    if (G.phase === 'ready' || G.phase === 'intro') glove.position.z = CATCH_Z;
  }
}

function renderTunerOutput() {
  const v = tunerValues();
  const rounded = {};
  Object.keys(v).forEach((k) => (rounded[k] = Math.round(v[k] * 1000) / 1000));
  $('tunerOut').value = JSON.stringify(rounded, null, 1);
}

function buildTuner() {
  const v = tunerValues();
  $('tunerRows').innerHTML = TUNER_FIELDS.map((f) => `
    <div class="tuner-row">
      <label for="tune-${f.key}">${f.label}</label>
      <output id="tune-${f.key}-out" for="tune-${f.key}"></output>
      <input type="range" id="tune-${f.key}" min="${f.min}" max="${f.max}" step="${f.step}" value="${v[f.key]}">
    </div>`).join('');
  TUNER_FIELDS.forEach((f) => {
    const input = $(`tune-${f.key}`), out = $(`tune-${f.key}-out`);
    const show = () => (out.textContent = `${Number(input.value).toFixed(f.step < 0.1 ? 2 : 1)} ${f.unit}`);
    show();
    input.addEventListener('input', () => {
      show();
      if (umpStance !== 'center') {
        settings.umpStance = umpStance = 'center';
        $('umpStance').value = 'center';
      }
      applyTunerValues({ [f.key]: Number(input.value) });
      settings.umpView = tunerValues();
      saveSettings();
      renderTunerOutput();
    });
  });
  renderTunerOutput();
}

// 啟動時套用上次調整的數值
// 舊版存的 view 含有錯誤的捕手位置，改用新的 umpView 欄位
delete settings.view;
if (settings.umpView) applyTunerValues(settings.umpView);

$('btnTuner').addEventListener('click', () => {
  buildTuner();
  $('tuner').hidden = false;
  $('settings').hidden = true;
  btnSettings.setAttribute('aria-expanded', 'false');
});
$('tunerClose').addEventListener('click', () => ($('tuner').hidden = true));
$('tunerReset').addEventListener('click', () => {
  delete settings.umpView;
  saveSettings();
  applyTunerValues(Object.assign({}, BROADCAST_DEFAULT, CATCHER_DEFAULT));
  buildTuner();
});
$('tunerCopy').addEventListener('click', async () => {
  const out = $('tunerOut');
  const btn = $('tunerCopy');
  renderTunerOutput();
  try {
    await navigator.clipboard.writeText(out.value);
    btn.textContent = '已複製';
  } catch (e) {
    out.focus();
    out.select();
    btn.textContent = '已選取，請按 Ctrl+C';
  }
  setTimeout(() => (btn.textContent = '複製數值'), 2000);
});
