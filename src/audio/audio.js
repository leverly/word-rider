// 音频：WebAudio 程序化音效 + 程序化 BGM + 语音播放
import { clamp } from '../core/utils.js';

/* ── 音效引擎 ── */
export class Sfx {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.enabled = true;
    this.volume = 0.7;
    this._wheelGain = null;
    this._wheelSrc = null;
  }

  /** 必须在用户手势里调用 */
  init() {
    if (this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.volume;
    this.master.connect(this.ctx.destination);
    this._startWind();
  }

  resume() {
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
  }

  setVolume(v) {
    this.volume = clamp(v, 0, 1);
    if (this.master) this.master.gain.value = this.volume;
  }

  /* ── 持续风声（随速度变） ── */
  _startWind() {
    const ctx = this.ctx;
    const len = ctx.sampleRate * 3;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      const white = Math.random() * 2 - 1;
      last = last * 0.92 + white * 0.08;
      data[i] = last * 1.6;
    }
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;

    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 620;
    filter.Q.value = 0.55;

    const gain = ctx.createGain();
    gain.gain.value = 0;

    src.connect(filter).connect(gain).connect(this.master);
    src.start();

    this._wheelSrc = src;
    this._wheelGain = gain;
    this._wheelFilter = filter;
  }

  setWind(level) {
    if (!this._wheelGain) return;
    const t = this.ctx.currentTime;
    this._wheelGain.gain.setTargetAtTime(clamp(level, 0, 1) * 0.075, t, 0.12);
    this._wheelFilter.frequency.setTargetAtTime(480 + level * 900, t, 0.2);
  }

  /* ── 基础合成器 ── */
  tone({
    freq = 440, dur = 0.2, type = 'sine', gain = 0.25,
    attack = 0.005, decay = null, slideTo = null, delay = 0,
  } = {}) {
    if (!this.ctx || !this.enabled) return;
    const ctx = this.ctx;
    const t0 = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), t0 + dur);

    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(gain, t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + (decay || dur));

    osc.connect(g).connect(this.master);
    osc.start(t0);
    osc.stop(t0 + dur + 0.05);
  }

  noise({ dur = 0.2, gain = 0.2, freq = 1200, q = 1, type = 'bandpass', delay = 0 } = {}) {
    if (!this.ctx || !this.enabled) return;
    const ctx = this.ctx;
    const t0 = ctx.currentTime + delay;
    const len = Math.ceil(ctx.sampleRate * dur);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(f).connect(g).connect(this.master);
    src.start(t0);
  }

  /* ── 具体音效 ── */
  correct(combo = 0) {
    const base = 620 + Math.min(combo, 12) * 26;
    this.tone({ freq: base, dur: 0.1, type: 'triangle', gain: 0.22 });
    this.tone({ freq: base * 1.5, dur: 0.16, type: 'triangle', gain: 0.18, delay: 0.07 });
    this.tone({ freq: base * 2, dur: 0.22, type: 'sine', gain: 0.11, delay: 0.13 });
  }

  wrong() {
    this.tone({ freq: 220, dur: 0.26, type: 'sawtooth', gain: 0.16, slideTo: 90 });
    this.noise({ dur: 0.18, gain: 0.1, freq: 380, q: 0.7 });
  }

  laneChange() {
    this.noise({ dur: 0.1, gain: 0.055, freq: 2200, q: 1.4 });
  }

  gearShift(up) {
    this.tone({ freq: up ? 420 : 340, dur: 0.09, type: 'square', gain: 0.075 });
    this.tone({ freq: up ? 560 : 260, dur: 0.08, type: 'square', gain: 0.05, delay: 0.05 });
  }

  powerup(kind = 'gain') {
    if (kind === 'shield') {
      this.tone({ freq: 320, dur: 0.35, type: 'sine', gain: 0.16, slideTo: 620 });
      this.tone({ freq: 480, dur: 0.3, type: 'triangle', gain: 0.1, delay: 0.06 });
    } else {
      this.tone({ freq: 520, dur: 0.1, type: 'triangle', gain: 0.17 });
      this.tone({ freq: 700, dur: 0.1, type: 'triangle', gain: 0.17, delay: 0.08 });
      this.tone({ freq: 940, dur: 0.22, type: 'triangle', gain: 0.15, delay: 0.16 });
    }
  }

  shieldBreak() {
    this.tone({ freq: 700, dur: 0.2, type: 'sine', gain: 0.16, slideTo: 240 });
    this.noise({ dur: 0.22, gain: 0.09, freq: 1600, q: 1.2 });
  }

  countdown(step) {
    const f = step === 0 ? 880 : 520;
    this.tone({ freq: f, dur: step === 0 ? 0.4 : 0.14, type: 'square', gain: 0.13 });
  }

  finish() {
    [523, 659, 784, 1046].forEach((f, i) =>
      this.tone({ freq: f, dur: 0.4, type: 'triangle', gain: 0.16, delay: i * 0.13 })
    );
  }

  starChime() {
    [1046, 1318, 1568, 2093].forEach((f, i) =>
      this.tone({ freq: f, dur: 0.5, type: 'sine', gain: 0.12, delay: i * 0.07 })
    );
  }

  click() {
    this.tone({ freq: 660, dur: 0.06, type: 'square', gain: 0.07 });
  }
}

/* ── 程序化 BGM ── */
export class Bgm {
  constructor(sfx) {
    this.sfx = sfx;
    this.playing = false;
    this.timer = 0;
    this.step = 0;
    this.intensity = 0;    // 0..1 随档位
    this.rush = false;     // 最后 10 秒
    this._next = 0;
    this._raf = 0;
    this.enabled = true;
  }

  start() {
    if (!this.sfx.ctx || this.playing) return;
    this.playing = true;
    this.step = 0;
    this._next = this.sfx.ctx.currentTime + 0.1;
    this._loop();
  }

  stop() {
    this.playing = false;
    if (this._raf) cancelAnimationFrame(this._raf);
    this._raf = 0;
  }

  setIntensity(v) { this.intensity = clamp(v, 0, 1); }
  setRush(v) { this.rush = v; }

  _loop() {
    if (!this.playing) return;
    const ctx = this.sfx.ctx;
    const ahead = 0.35;

    while (this._next < ctx.currentTime + ahead) {
      this._schedule(this._next, this.step);
      const bpm = 104 + this.intensity * 40 + (this.rush ? 26 : 0);
      const beat = 60 / bpm;
      const sub = this.rush ? beat / 2 : beat;   // 冲刺加密集
      this._next += sub;
      this.step++;
    }
    this._raf = requestAnimationFrame(() => this._loop());
  }

  _schedule(t, step) {
    if (!this.enabled) return;
    const ctx = this.sfx.ctx;
    const master = this.sfx.master;

    // 低音
    if (step % 4 === 0) {
      const root = [55, 55, 65.4, 58.3][Math.floor(step / 16) % 4];
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(root, t);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(0.16, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
      osc.connect(g).connect(master);
      osc.start(t); osc.stop(t + 0.34);
    }

    // 和声垫（每 2 拍）
    if (step % 8 === 0) {
      const chord = [[220, 277.2, 329.6], [196, 246.9, 293.7], [233.1, 293.7, 349.2], [207.7, 261.6, 311.1]][Math.floor(step / 32) % 4];
      for (const f of chord) {
        const osc = ctx.createOscillator();
        const g = ctx.createGain();
        const filt = ctx.createBiquadFilter();
        filt.type = 'lowpass';
        filt.frequency.value = 760 + this.intensity * 900;
        osc.type = 'triangle';
        osc.frequency.value = f;
        g.gain.setValueAtTime(0.0001, t);
        g.gain.linearRampToValueAtTime(0.022, t + 0.12);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 1.1);
        osc.connect(filt).connect(g).connect(master);
        osc.start(t); osc.stop(t + 1.2);
      }
    }

    // 踩镲（8 分音符）
    if (step % 2 === 1 && this.intensity > 0.12) {
      const len = Math.ceil(ctx.sampleRate * 0.045);
      const buf = ctx.createBuffer(1, len, ctx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
      const src = ctx.createBufferSource();
      src.buffer = buf;
      const f = ctx.createBiquadFilter();
      f.type = 'highpass';
      f.frequency.value = 7000;
      const g = ctx.createGain();
      g.gain.value = 0.012 + this.intensity * 0.02;
      src.connect(f).connect(g).connect(master);
      src.start(t);
    }

    // 旋律点缀（每 16 步）
    if (step % 16 === 0) {
      const notes = [523.3, 587.3, 659.3, 784.0, 880.0];
      const n = notes[(step / 16) % notes.length];
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = n;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(0.035 + this.intensity * 0.02, t + 0.03);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.55);
      osc.connect(g).connect(master);
      osc.start(t); osc.stop(t + 0.6);
    }
  }
}

/* ── 语音播放（优先预生成文件，缺失则浏览器朗读兜底） ── */
export class Voice {
  constructor() {
    this.audio = new Audio();
    this.audio.preload = 'auto';
    this.audio.volume = 1;
    this.enabled = true;
    this._token = 0;
    this._cache = new Map();
    this._playing = false;
    this._fallbackVoice = null;
    if ('speechSynthesis' in window) {
      const pick = () => {
        const vs = speechSynthesis.getVoices();
        this._fallbackVoice =
          vs.find(v => /Samantha|Aria|Google US English/i.test(v.name)) ||
          vs.find(v => v.lang === 'en-US') ||
          vs[0] || null;
      };
      pick();
      speechSynthesis.onvoiceschanged = pick;
    }
  }

  stop() {
    this._token++;
    try { this.audio.pause(); } catch { /* ignore */ }
    this._playing = false;
    if ('speechSynthesis' in window) speechSynthesis.cancel();
  }

  /**
   * 播放一句。url 为 null 时用浏览器朗读。
   * 返回 Promise，在播放结束或被打断时 resolve
   */
  speak(url, text, { rate = 1.0 } = {}) {
    if (!this.enabled) return Promise.resolve();
    this.stop();
    const token = this._token;

    if (url) {
      return new Promise(resolve => {
        const a = this.audio;
        a.src = url;
        a.playbackRate = rate;
        const done = () => {
          a.onended = a.onerror = null;
          if (token === this._token) this._playing = false;
          resolve();
        };
        a.onended = done;
        a.onerror = () => { done(); this._speakFallback(text, rate, token).then(resolve); };
        const p = a.play();
        if (p && p.catch) p.catch(() => { done(); this._speakFallback(text, rate, token).then(resolve); });
        else this._playing = true;
      });
    }
    return this._speakFallback(text, rate, token);
  }

  _speakFallback(text, rate, token) {
    if (!text || !('speechSynthesis' in window)) return Promise.resolve();
    return new Promise(resolve => {
      const u = new SpeechSynthesisUtterance(text);
      u.lang = 'en-US';
      u.rate = rate;
      if (this._fallbackVoice) u.voice = this._fallbackVoice;
      u.onend = u.onerror = () => resolve();
      // 防止某些浏览器不触发 onend
      const guard = setTimeout(() => resolve(), Math.max(2500, text.length * 110));
      u.onend = () => { clearTimeout(guard); resolve(); };
      u.onerror = () => { clearTimeout(guard); resolve(); };
      speechSynthesis.speak(u);
    });
  }

  get playing() { return this._playing; }
}
