/* 音效：全部用 Web Audio 當場合成，不放任何音檔。
 *
 * 不用音檔有兩個理由：離線快取不會多幾百 KB，而且 Artifact 沙箱的 CSP
 * 對外部資源很嚴，合成出來的聲音沒有這個問題。
 *
 * iOS 規定要有使用者動作才能出聲，所以音訊環境是等到第一次點擊或按鍵
 * 才真正建立起來（unlock）。在那之前呼叫 play 都會安靜地什麼都不做。
 */
const SFX = (function () {
  const STORE_KEY = 'umpire-eye:sound';
  let ctx = null, master = null, noise = null;
  let enabled = true;

  // 私密視窗或擋了網站資料時 localStorage 會直接丟例外，讀不到就當作開著
  try { enabled = localStorage.getItem(STORE_KEY) !== 'off'; } catch (e) {}

  function unlock() {
    if (ctx) {
      if (ctx.state === 'suspended') ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    try {
      ctx = new AC();
    } catch (e) {
      return;
    }
    master = ctx.createGain();
    master.gain.value = 0.32;
    master.connect(ctx.destination);

    // 1 秒的白噪音，手套聲、擦棒聲都從這裡切片來用
    const n = Math.ceil(ctx.sampleRate);
    noise = ctx.createBuffer(1, n, ctx.sampleRate);
    const d = noise.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    if (ctx.state === 'suspended') ctx.resume();
  }

  // 一個帶包絡的單音。peak 是音量，dur 是含衰減的總長度。
  function tone(freq, at, dur, type, peak, glideTo) {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type || 'sine';
    o.frequency.setValueAtTime(freq, at);
    if (glideTo) o.frequency.exponentialRampToValueAtTime(glideTo, at + dur);
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(peak, at + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    o.connect(g); g.connect(master);
    o.start(at); o.stop(at + dur + 0.03);
  }

  // 一段噪音，經過濾波器塑形。手套的「啪」就是這個。
  function hiss(at, dur, freq, q, peak, type) {
    const s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
    s.buffer = noise;
    s.loop = true;
    f.type = type || 'bandpass';
    f.frequency.value = freq;
    f.Q.value = q;
    g.gain.setValueAtTime(peak, at);
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    s.connect(f); f.connect(g); g.connect(master);
    s.start(at); s.stop(at + dur + 0.02);
  }

  const VOICES = {
    // 出手：很輕的一聲風切，只是提示球出來了，不搶戲
    release: (t) => hiss(t, 0.13, 900, 0.7, 0.10),

    // 進手套：整個遊戲最重要的聲音。高頻的皮革啪聲疊一個低頻悶響才有重量。
    mitt: (t) => { hiss(t, 0.10, 2000, 0.8, 0.85); tone(140, t, 0.09, 'sine', 0.55); },

    // 判對：往上兩個音，乾淨
    good: (t) => { tone(660, t, 0.10, 'triangle', 0.5); tone(990, t + 0.075, 0.20, 'triangle', 0.45); },

    // 判錯：往下滑一個音，悶悶的，不刺耳
    bad: (t) => { tone(300, t, 0.28, 'sawtooth', 0.28, 170); },

    // 超時：低沉的兩短聲
    late: (t) => { tone(190, t, 0.13, 'square', 0.22); tone(150, t + 0.16, 0.20, 'square', 0.22); },

    // 結算：三個音的小號式上行
    end: (t) => {
      tone(523, t, 0.16, 'triangle', 0.42);
      tone(659, t + 0.13, 0.16, 'triangle', 0.42);
      tone(784, t + 0.26, 0.42, 'triangle', 0.5);
    },
  };

  function play(name) {
    if (!enabled || !ctx || !VOICES[name]) return;
    if (ctx.state === 'suspended') ctx.resume();
    try { VOICES[name](ctx.currentTime + 0.01); } catch (e) {}
  }

  function setEnabled(v) {
    enabled = !!v;
    try { localStorage.setItem(STORE_KEY, enabled ? 'on' : 'off'); } catch (e) {}
    if (enabled) unlock();
  }

  // 第一次任何互動就把音訊環境打開，之後就不用再管了
  ['pointerdown', 'keydown', 'touchstart'].forEach((ev) =>
    window.addEventListener(ev, unlock, { once: true, passive: true }));

  return { play, unlock, setEnabled, isEnabled: () => enabled };
})();
