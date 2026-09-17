/* 音效。
 *
 * 使用者自己的音檔放在 audio/，載不到的時候退回用 Web Audio 當場合成，
 * 所以就算某個檔案壞了或沒放，遊戲也不會沒聲音、更不會壞掉。
 *
 * iOS 規定要有使用者動作才能出聲，所以音訊環境是等到第一次點擊或按鍵
 * 才真正建立起來（unlock），音檔也是那時候才開始下載解碼。
 */
const SFX = (function () {
  const STORE_KEY = 'umpire-eye:sound';

  // 使用者提供的音檔。key 就是 play() 用的名字。
  const FILES = {
    ball: 'audio/ball.mp3',      // 按下壞球
    strike: 'audio/strike.mp3',  // 按下好球
    catch: 'audio/catch.mp3',    // 球進捕手手套
    happy: 'audio/happy.mp3',    // 判決正確
    boo: 'audio/boo.mp3',        // 誤判
    fans: 'audio/fans.mp3',      // 球場背景人聲，整場循環
  };

  // 每個音檔錄音音量不一，這裡各自調整讓它們聽起來一樣大聲
  const LEVEL = { ball: 0.85, strike: 0.85, catch: 0.95, happy: 0.8, boo: 0.8 };

  const CROWD_LEVEL = 0.22;   // 背景人聲要明顯低於判決音，不然會蓋掉
  const CROWD_FADE = 1.2;     // 進場淡入、結算淡出的秒數

  let ctx = null, master = null, sfxBus = null, crowdBus = null, crowd = null;
  let noise = null;
  const buffers = {};
  // 每個音檔「實際有聲音」到第幾秒。排隊時等這個長度就好，
  // 不必連尾巴的空白一起等（ball 全長 1 秒，但 0.77 秒之後就沒聲音了）。
  const tails = {};
  let queueUntil = 0;   // 排隊播放的聲音要接在什麼時候
  let enabled = true;
  let wantCrowd = false;

  // 私密視窗或擋了網站資料時 localStorage 會直接丟例外，讀不到就當作開著
  try { enabled = localStorage.getItem(STORE_KEY) !== 'off'; } catch (e) {}

  function unlock() {
    if (ctx) {
      if (ctx.state === 'suspended') ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    try { ctx = new AC(); } catch (e) { return; }

    master = ctx.createGain();
    master.gain.value = 0.9;
    master.connect(ctx.destination);
    sfxBus = ctx.createGain();
    sfxBus.gain.value = 1;
    sfxBus.connect(master);
    crowdBus = ctx.createGain();
    crowdBus.gain.value = 0;      // 先靜音，要播的時候才淡入
    crowdBus.connect(master);

    // 合成備援用的白噪音
    const n = Math.ceil(ctx.sampleRate);
    noise = ctx.createBuffer(1, n, ctx.sampleRate);
    const d = noise.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;

    if (ctx.state === 'suspended') ctx.resume();
    load();
  }

  // 從尾巴往回找第一個有聲音的取樣，得到實際的發聲長度
  function audibleLength(buf) {
    const d = buf.getChannelData(0);
    for (let i = d.length - 1; i >= 0; i--) {
      if (Math.abs(d[i]) > 0.005) return (i + 1) / buf.sampleRate;
    }
    return buf.duration;
  }

  function load() {
    Object.keys(FILES).forEach((name) => {
      fetch(FILES[name])
        .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(r.status)))
        .then((buf) => new Promise((ok, no) => ctx.decodeAudioData(buf, ok, no)))
        .then((audio) => {
          buffers[name] = audio;
          tails[name] = audibleLength(audio);
          // 背景人聲可能在檔案載完之前就該開始了，補播
          if (name === 'fans' && wantCrowd) startCrowd();
        })
        .catch(() => {}); // 載不到就用合成的，不吵使用者
    });
  }

  /* ---------- 合成備援 ---------- */

  function tone(freq, at, dur, type, peak, glideTo) {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type || 'sine';
    o.frequency.setValueAtTime(freq, at);
    if (glideTo) o.frequency.exponentialRampToValueAtTime(glideTo, at + dur);
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(peak, at + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    o.connect(g); g.connect(sfxBus);
    o.start(at); o.stop(at + dur + 0.03);
  }

  function hiss(at, dur, freq, q, peak) {
    const s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
    s.buffer = noise; s.loop = true;
    f.type = 'bandpass'; f.frequency.value = freq; f.Q.value = q;
    g.gain.setValueAtTime(peak, at);
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    s.connect(f); f.connect(g); g.connect(sfxBus);
    s.start(at); s.stop(at + dur + 0.02);
  }

  // 使用者沒有提供這三個場合的音檔，用合成的補上
  const SYNTH = {
    release: (t) => hiss(t, 0.13, 900, 0.7, 0.10),                      // 投手出手
    late: (t) => { tone(190, t, 0.13, 'square', 0.22); tone(150, t + 0.16, 0.20, 'square', 0.22); },
    end: (t) => {                                                        // 結算
      tone(523, t, 0.16, 'triangle', 0.42);
      tone(659, t + 0.13, 0.16, 'triangle', 0.42);
      tone(784, t + 0.26, 0.42, 'triangle', 0.5);
    },
    // 音檔還沒載好時，這兩個先用合成的頂著
    catch: (t) => { hiss(t, 0.10, 2000, 0.8, 0.85); tone(140, t, 0.09, 'sine', 0.55); },
    happy: (t) => { tone(660, t, 0.10, 'triangle', 0.5); tone(990, t + 0.075, 0.20, 'triangle', 0.45); },
    boo: (t) => tone(300, t, 0.28, 'sawtooth', 0.28, 170),
  };

  /* ---------- 播放 ---------- */

  /* mode 控制「按鍵音 → 判決音」這一串的排隊：
       'start' 立刻響，並重新開始排隊（按下好壞球用這個）
       'queue' 接在前一個排隊的聲音實際發完之後才響（判決音用這個）
       不給   立刻響，跟排隊無關（進手套、超時等）
     按鍵音一定要是 'start'：它是按鈕的回饋，被延後就像按鈕卡住。
     前一球的判決音最長 4 秒，不重設的話下一球按得快就會被它卡到。 */
  function play(name, mode) {
    if (!enabled || !ctx) return;
    if (ctx.state === 'suspended') ctx.resume();
    try {
      const now = ctx.currentTime + 0.01;
      const queue = mode === 'queue' || mode === 'start';
      const at = mode === 'queue' ? Math.max(now, queueUntil) : now;
      const buf = buffers[name];
      if (buf) {
        const s = ctx.createBufferSource(), g = ctx.createGain();
        s.buffer = buf;
        g.gain.value = LEVEL[name] === undefined ? 1 : LEVEL[name];
        s.connect(g); g.connect(sfxBus);
        s.start(at);
        if (queue) queueUntil = at + (tails[name] || buf.duration);
      } else if (SYNTH[name]) {
        SYNTH[name](at);
        if (queue) queueUntil = at + 0.35; // 退回合成音時的估計長度
      }
    } catch (e) {}
  }

  function startCrowd() {
    if (!ctx || !enabled || crowd) return;
    const buf = buffers.fans;
    if (!buf) return;
    crowd = ctx.createBufferSource();
    crowd.buffer = buf;
    crowd.loop = true;
    // MP3 解碼前後會多出一點點靜音，接回開頭時會有「喀」一聲，
    // 所以循環點各往內縮 50 毫秒。30 秒的人聲少這麼一點聽不出來。
    if (buf.duration > 0.2) {
      crowd.loopStart = 0.05;
      crowd.loopEnd = buf.duration - 0.05;
    }
    crowd.connect(crowdBus);
    crowd.start();
    const t = ctx.currentTime;
    crowdBus.gain.cancelScheduledValues(t);
    crowdBus.gain.setValueAtTime(crowdBus.gain.value, t);
    crowdBus.gain.linearRampToValueAtTime(CROWD_LEVEL, t + CROWD_FADE);
  }

  function stopCrowd(fade) {
    if (!ctx || !crowd) return;
    const c = crowd;
    crowd = null;
    const t = ctx.currentTime, dur = fade === false ? 0.05 : CROWD_FADE;
    crowdBus.gain.cancelScheduledValues(t);
    crowdBus.gain.setValueAtTime(crowdBus.gain.value, t);
    crowdBus.gain.linearRampToValueAtTime(0, t + dur);
    try { c.stop(t + dur + 0.1); } catch (e) {}
  }

  // 背景人聲：開打的時候叫 crowd(true)，結算的時候叫 crowd(false)
  function setCrowd(on) {
    wantCrowd = !!on;
    if (!ctx) return;
    if (wantCrowd) startCrowd(); else stopCrowd();
  }

  function setEnabled(v) {
    enabled = !!v;
    try { localStorage.setItem(STORE_KEY, enabled ? 'on' : 'off'); } catch (e) {}
    if (enabled) {
      unlock();
      if (wantCrowd) startCrowd();
    } else {
      stopCrowd(false);
    }
  }

  // 第一次任何互動就把音訊環境打開，之後就不用再管了
  ['pointerdown', 'keydown', 'touchstart'].forEach((ev) =>
    window.addEventListener(ev, unlock, { once: true, passive: true }));

  // 切到別的分頁時瀏覽器會把音訊停掉，切回來要叫醒它
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && ctx && ctx.state === 'suspended' && enabled) ctx.resume();
  });

  return { play, unlock, setCrowd, setEnabled, isEnabled: () => enabled };
})();
