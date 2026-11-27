// UI：开始页 / HUD / 暂停 / 结算
import { CONFIG } from '../core/config.js';

const TYPE_LABEL = {
  word2meaning: '看词选义',
  audio2meaning: '听音选义',
  meaning2word: '看义选词',
  cloze: '例句填空',
  spell: '拼写补全',
  grammar: '语法填空',
};

const $ = sel => document.querySelector(sel);
const el = (tag, cls, html) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  return e;
};

export class UI {
  constructor({ onStart, onResume, onRestart, onQuit, onToggleSound, onSetQuality, onPreview }) {
    this.cb = { onStart, onResume, onRestart, onQuit, onToggleSound, onSetQuality, onPreview };
    this.screens = {};
    this._buildStart();
    this._buildHud();
    this._buildPause();
    this._buildRoundEnd();
    this._buildResult();
    this._buildCountdown();
  }

  /* ── 开始页 ── */
  _buildStart() {
    const s = $('#screen-start');
    s.innerHTML = `
      <div class="start-wrap">
        <div class="title-block">
          <div class="logo">
            <span class="logo-cn">词速骑行</span>
            <span class="logo-en">WORD&nbsp;RIDER</span>
          </div>
          <p class="tagline">3 分钟 · 四车道 · 边骑边背</p>
        </div>

        <div class="panel">
          <div class="picker">
            <div class="pick-group">
              <label class="lbl">赛道</label>
              <div class="cards" data-group="theme"></div>
            </div>
            <div class="pick-group">
              <label class="lbl">座驾</label>
              <div class="cards compact" data-group="vehicle"></div>
            </div>
            <div class="pick-group">
              <label class="lbl">配色</label>
              <div class="swatches" data-group="palette"></div>
            </div>
          </div>

          <div class="row">
            <label class="lbl">模式</label>
            <div class="seg" data-group="mode">
              <button data-v="mixed" class="on">混合</button>
              <button data-v="vocab">只背单词</button>
              <button data-v="grammar">只练语法</button>
            </div>
          </div>

          <div class="row">
            <label class="lbl">起始档位</label>
            <div class="seg" data-group="gear">
              <button data-v="0">1</button>
              <button data-v="1">2</button>
              <button data-v="2" class="on">3</button>
              <button data-v="3">4</button>
              <button data-v="4">5</button>
            </div>
          </div>

          <div class="row">
            <label class="lbl">新词</label>
            <div class="seg" data-group="new">
              <button data-v="1" class="on">允许</button>
              <button data-v="0">只复习到期</button>
            </div>
          </div>

          <div class="stats" id="start-stats"></div>

          <button class="btn-primary" id="btn-start">
            <span>开始骑行</span>
            <kbd>↵</kbd>
          </button>

          <div class="keys">
            <span><kbd>←</kbd><kbd>→</kbd> 换道</span>
            <span><kbd>↑</kbd><kbd>↓</kbd> 调档</span>
            <span><kbd>空格</kbd> 用道具</span>
            <span><kbd>R</kbd> 重听</span>
            <span><kbd>Esc</kbd> 暂停</span>
          </div>
        </div>
      </div>
    `;

    this.startOpts = {
      mode: 'mixed', gear: 2, includeNew: true,
      theme: 'coast', vehicle: 'bike', palette: 'teal',
    };
    this._buildPickers();

    s.querySelectorAll('.seg').forEach(seg => {
      seg.addEventListener('click', e => {
        const btn = e.target.closest('button');
        if (!btn) return;
        seg.querySelectorAll('button').forEach(b => b.classList.remove('on'));
        btn.classList.add('on');
        const g = seg.dataset.group;
        const v = btn.dataset.v;
        if (g === 'mode') this.startOpts.mode = v;
        if (g === 'gear') this.startOpts.gear = Number(v);
        if (g === 'new') this.startOpts.includeNew = v === '1';
      });
    });

    $('#btn-start').addEventListener('click', () => this.cb.onStart({ ...this.startOpts }));
  }

  _buildPickers() {
    const THEME_CARDS = [
      { id: 'coast', name: '海边', desc: '椰树 · 海浪 · 灯塔', c1: '#2fa8dd', c2: '#e8dcbc' },
      { id: 'country', name: '乡村', desc: '麦田 · 栅栏 · 农舍', c1: '#6cba5c', c2: '#d8bd5e' },
      { id: 'prairie', name: '草原', desc: '草浪 · 孤树 · 远山', c1: '#c9b463', c2: '#7cba5e' },
    ];
    const VEHICLES = [
      {
        id: 'bike', name: '自行车', color: '#7fe3d8',
        svg: '<svg viewBox="0 0 48 32" fill="none">' +
          '<circle cx="11" cy="22" r="7.5" stroke="currentColor" stroke-width="2.4"/>' +
          '<circle cx="37" cy="22" r="7.5" stroke="currentColor" stroke-width="2.4"/>' +
          '<path d="M11 22 L19 10 L30 10 L37 22 M19 10 L24 22 L11 22 M30 10 L27 6 L33 6"' +
          ' stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>' +
          '<circle cx="24" cy="22" r="1.8" fill="currentColor"/>' +
          '</svg>',
      },
      {
        id: 'scooter', name: '滑板车', color: '#ffb07a',
        svg: '<svg viewBox="0 0 48 32" fill="none">' +
          '<circle cx="13" cy="24" r="5" stroke="currentColor" stroke-width="2.4"/>' +
          '<circle cx="37" cy="24" r="4.2" stroke="currentColor" stroke-width="2.4"/>' +
          '<path d="M13 24 L30 24" stroke="currentColor" stroke-width="3" stroke-linecap="round"/>' +
          '<path d="M13 24 L17 7 L17 4" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>' +
          '<path d="M11 5 L23 5" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/>' +
          '</svg>',
      },
    ];
    const PALETTES = {
      bike: [
        { id: 'teal', name: '青碧', c: '#1fb3ab' },
        { id: 'coral', name: '珊瑚', c: '#f2705a' },
        { id: 'midnight', name: '墨夜', c: '#35406b' },
      ],
      scooter: [
        { id: 'sunset', name: '落日', c: '#ff7a45' },
        { id: 'mint', name: '薄荷', c: '#3cc9a0' },
        { id: 'violet', name: '紫罗兰', c: '#8a6fe0' },
      ],
    };

    const themeBox = document.querySelector('.cards[data-group="theme"]');
    themeBox.innerHTML = THEME_CARDS.map(t => `
      <button class="card${t.id === this.startOpts.theme ? ' on' : ''}" data-v="${t.id}">
        <span class="card-art" style="--c1:${t.c1};--c2:${t.c2}"></span>
        <b>${t.name}</b>
        <small>${t.desc}</small>
      </button>
    `).join('');

    const vehBox = document.querySelector('.cards[data-group="vehicle"]');
    vehBox.innerHTML = VEHICLES.map(v => `
      <button class="card${v.id === this.startOpts.vehicle ? ' on' : ''}" data-v="${v.id}">
        <span class="card-icon" style="--vc:${v.color}">${v.svg}</span>
        <b>${v.name}</b>
      </button>
    `).join('');

    const palBox = document.querySelector('.swatches[data-group="palette"]');
    const renderPalettes = () => {
      const list = PALETTES[this.startOpts.vehicle] || PALETTES.bike;
      palBox.innerHTML = list.map(p => `
        <button class="swatch${p.id === this.startOpts.palette ? ' on' : ''}"
                data-v="${p.id}" title="${p.name}" style="--c:${p.c}">
          <i></i><span>${p.name}</span>
        </button>
      `).join('');
      if (!list.some(p => p.id === this.startOpts.palette)) {
        this.startOpts.palette = list[0].id;
        palBox.querySelector('.swatch')?.classList.add('on');
      }
    };
    renderPalettes();

    themeBox.addEventListener('click', e => {
      const btn = e.target.closest('.card');
      if (!btn) return;
      themeBox.querySelectorAll('.card').forEach(b => b.classList.remove('on'));
      btn.classList.add('on');
      this.startOpts.theme = btn.dataset.v;
      this.cb.onPreview?.({ ...this.startOpts });
    });

    vehBox.addEventListener('click', e => {
      const btn = e.target.closest('.card');
      if (!btn) return;
      vehBox.querySelectorAll('.card').forEach(b => b.classList.remove('on'));
      btn.classList.add('on');
      this.startOpts.vehicle = btn.dataset.v;
      renderPalettes();
      this.cb.onPreview?.({ ...this.startOpts });
    });

    palBox.addEventListener('click', e => {
      const btn = e.target.closest('.swatch');
      if (!btn) return;
      palBox.querySelectorAll('.swatch').forEach(b => b.classList.remove('on'));
      btn.classList.add('on');
      this.startOpts.palette = btn.dataset.v;
      this.cb.onPreview?.({ ...this.startOpts });
    });
  }

  syncPickers(opts) {
    this.startOpts = { ...this.startOpts, ...opts };
    // 同步 UI 选中态
    document.querySelectorAll('.cards[data-group="theme"] .card').forEach(b =>
      b.classList.toggle('on', b.dataset.v === opts.theme));
    document.querySelectorAll('.cards[data-group="vehicle"] .card').forEach(b =>
      b.classList.toggle('on', b.dataset.v === opts.vehicle));
    document.querySelectorAll('.swatches .swatch').forEach(b =>
      b.classList.toggle('on', b.dataset.v === opts.palette));
  }

  setStartStats(stats, best) {
    const box = $('#start-stats');
    if (!box) return;
    box.innerHTML = `
      <div class="stat"><b>${stats.due}</b><span>今日待复习</span></div>
      <div class="stat"><b>${stats.unseen}</b><span>未学新词</span></div>
      <div class="stat"><b>${stats.mastered}</b><span>已掌握</span></div>
      <div class="stat"><b>${best || 0}</b><span>最高分</span></div>
    `;
  }

  /* ── HUD ── */
  _buildHud() {
    const h = $('#hud');
    h.innerHTML = `
      <div class="hud-top">
        <div class="hud-left">
          <div class="pill score"><span class="ico">★</span><b id="hud-score">0</b><small>分</small></div>
          <div class="pill combo" id="hud-combo"><span class="ico flame">🔥</span><span>连击</span><b id="hud-combo-val">0</b></div>
          <div class="pill rounds" id="hud-rounds"></div>
          <div class="effects" id="hud-effects"></div>
        </div>

        <div class="ask" id="hud-ask">
          <div class="ask-top">
            <span class="ask-type" id="hud-q-type">准备</span>
            <span class="ask-hint" id="hud-q-hint"></span>
            <span class="ask-retry" id="hud-q-retry">🔁 重做</span>
            <span class="ask-star" id="hud-star">★ 答对得道具</span>
          </div>
          <div class="ask-row">
            <button class="spk" id="btn-replay" title="重听 (R)">
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M4 9.5h3.2L12 5.2v13.6L7.2 14.5H4z" fill="currentColor"/>
                <path d="M15.6 8.6a4.6 4.6 0 0 1 0 6.8M18.2 6a8 8 0 0 1 0 12"
                      fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/>
              </svg>
            </button>
            <div class="ask-text">
              <b id="hud-q-main">准备出发…</b>
              <small id="hud-q-sub"></small>
            </div>
          </div>
          <div class="ask-bar"><i id="hud-read-bar"></i></div>
        </div>

        <div class="hud-right">
          <div class="timer">
            <svg viewBox="0 0 144 144">
              <circle class="tr" cx="72" cy="72" r="57"/>
              <circle class="pr" id="hud-timer-ring" cx="72" cy="72" r="57"/>
            </svg>
            <b id="hud-time">03:00</b>
          </div>
          <div class="pill gear"><small>档位</small>
            <div class="bars" id="hud-gear-bars"></div>
            <b id="hud-gear">3</b>
          </div>
          <button class="icon-btn" id="btn-pause" title="暂停 (Esc)">❚❚</button>
        </div>
      </div>

      <div class="hud-slots" id="hud-slots"></div>

      <div class="hud-bottom">
        <div class="feedback" id="hud-feedback"></div>
        <div class="opts" id="hud-opts"></div>
      </div>
      <div class="rider-line" id="hud-rider"></div>
    `;
    $('#btn-pause').addEventListener('click', () => this.cb.onTogglePause?.());
    $('#btn-replay').addEventListener('click', () => this.cb.onReplay?.());

    // 档位条
    const bars = $('#hud-gear-bars');
    for (let i = 0; i < 5; i++) bars.appendChild(el('i'));

    // 选项格
    const opts = $('#hud-opts');
    for (let i = 0; i < 4; i++) {
      const o = el('div', 'opt');
      o.dataset.i = i;
      o.innerHTML = `<span class="n">${i + 1}</span><span class="t"></span><span class="star-mini">★</span>`;
      o.addEventListener('click', () => this.cb.onPickLane?.(i));
      opts.appendChild(o);
    }
  }

  /* ── 暂停 ── */
  _buildPause() {
    const s = $('#screen-pause');
    s.innerHTML = `
      <div class="dialog">
        <h2>已暂停</h2>
        <p class="muted">倒计时与车辆都已停下</p>
        <button class="btn-primary" id="btn-resume">继续 <kbd>Esc</kbd></button>
        <button class="btn-ghost" id="btn-restart">重新开始</button>
        <button class="btn-ghost" id="btn-quit">回到首页</button>
        <div class="dialog-opts">
          <label><input type="checkbox" id="chk-sound" checked> 音效与语音</label>
          <label><input type="checkbox" id="chk-quality" checked> 高清画质</label>
        </div>
      </div>
    `;
    $('#btn-resume').addEventListener('click', () => this.cb.onResume());
    $('#btn-restart').addEventListener('click', () => this.cb.onRestart());
    $('#btn-quit').addEventListener('click', () => this.cb.onQuit());
    $('#chk-sound').addEventListener('change', e => this.cb.onToggleSound?.(e.target.checked));
    $('#chk-quality').addEventListener('change', e => this.cb.onSetQuality?.(e.target.checked));
  }

  /* ── 结算 ── */
  _buildResult() {
    const s = $('#screen-result');
    s.innerHTML = `
      <div class="result-wrap">
        <div class="result-head">
          <div class="grade" id="res-grade">A</div>
          <div class="score-block">
            <div class="res-title" id="res-title">最终成绩</div>
            <div class="big-score" id="res-score">0</div>
            <div class="muted">分 · 评级 <b id="res-grade-text">A</b></div>
          </div>
        </div>

        <div class="res-rounds" id="res-rounds"></div>

        <div class="result-stats" id="res-stats"></div>

        <div class="review" id="res-review"></div>

        <div class="result-actions">
          <button class="btn-primary" id="btn-again">再来一局 <kbd>↵</kbd></button>
          <button class="btn-ghost" id="btn-home">返回首页</button>
        </div>
      </div>
    `;
    $('#btn-again').addEventListener('click', () => this.cb.onRestart());
    $('#btn-home').addEventListener('click', () => this.cb.onQuit());
  }

  /* ── 轮间过渡 ── */
  _buildRoundEnd() {
    const s = $('#screen-round');
    s.innerHTML = `
      <div class="round-wrap">
        <div class="round-head">
          <span class="round-tag" id="re-tag">第 1 轮结束</span>
          <div class="round-score"><b id="re-score">0</b><small>分</small></div>
          <div class="round-grade" id="re-grade">C</div>
        </div>
        <div class="round-stats" id="re-stats"></div>
        <div class="round-compare" id="re-compare"></div>
        <div class="round-actions" id="re-actions"></div>
      </div>
    `;
  }

  showRoundEnd(payload, onNext) {
    const { roundIndex, totalRounds, isLast, best } = payload;

    $('#re-tag').textContent = `第 ${roundIndex + 1} 轮结束`;
    $('#re-score').textContent = payload.score;
    $('#re-grade').textContent = payload.grade;
    $('#re-grade').dataset.grade = payload.grade;

    const acc = Math.round(payload.accuracy * 100);
    $('#re-stats').innerHTML = `
      <div class="stat"><b>${acc}%</b><span>正确率</span></div>
      <div class="stat"><b>${payload.correct}/${payload.answered}</b><span>答对/作答</span></div>
      <div class="stat"><b>${payload.maxCombo}</b><span>最高连击</span></div>
      <div class="stat"><b>${payload.starsEarned}</b><span>拿到道具</span></div>
    `;

    // 已完成轮次对比
    const cmp = this._roundBars || [];
    cmp.push({ round: roundIndex + 1, score: payload.score });
    this._roundBars = cmp;
    const max = Math.max(...cmp.map(c => c.score), 1);
    $('#re-compare').innerHTML = `
      <div class="cmp-title">已完成的轮次</div>
      <div class="cmp-rows">
        ${cmp.map(c => `
          <div class="cmp-row${c.score === max ? ' best' : ''}">
            <span class="cmp-lbl">第 ${c.round} 轮</span>
            <i class="cmp-bar"><u style="width:${Math.max(4, (c.score / max) * 100)}%"></u></i>
            <b>${c.score}</b>
          </div>
        `).join('')}
      </div>
    `;

    const act = $('#re-actions');
    if (isLast) {
      act.innerHTML = `<button class="btn-primary" id="btn-round-final">查看最终成绩 <kbd>↵</kbd></button>`;
      $('#btn-round-final').onclick = () => onNext('finish');
    } else {
      act.innerHTML = `<button class="btn-primary" id="btn-round-next">进入第 ${roundIndex + 2} 轮 <kbd>↵</kbd></button>`;
      $('#btn-round-next').onclick = () => onNext('next');
    }

    this.show('round');
  }

  resetRoundBars() { this._roundBars = []; }

  /* ── 倒计时 ── */
  _buildCountdown() {
    const c = $('#countdown');
    c.innerHTML = `
      <div class="count-wrap">
        <div class="count-num" id="count-num">3</div>
        <div class="count-hint">← → 换道 · 过门即作答</div>
      </div>
    `;
  }

  /* ── 屏幕切换 ── */
  show(name) {
    for (const k of ['start', 'hud', 'pause', 'result', 'round', 'countdown']) {
      const e = $(`#screen-${k}`) || $(`#${k}`);
      if (e) e.classList.toggle('active', k === name);
    }
    this.current = name;
    document.body.dataset.screen = name;
  }

  /* ── HUD 更新 ── */
  updateHud(hud, gateQ) {
    const scoreEl = $('#hud-score');
    if (scoreEl.textContent !== String(hud.score)) {
      scoreEl.textContent = hud.score;
      scoreEl.classList.remove('bump');
      void scoreEl.offsetWidth;
      scoreEl.classList.add('bump');
    }

    // 轮次指示：第 N / 3 轮 + 前三轮分数
    const rBox = $('#hud-rounds');
    if (rBox && hud.round) {
      const sig = `${hud.round}/${hud.totalRounds}/${hud.bestSoFar}`;
      if (rBox.dataset.sig !== sig) {
        rBox.dataset.sig = sig;
        rBox.innerHTML = `<span>第 <b>${hud.round}</b>/${hud.totalRounds} 轮</span>`;
      }
    }

    const comboBox = $('#hud-combo');
    $('#hud-combo-val').textContent = hud.combo;
    comboBox.classList.toggle('active', hud.combo >= 2);
    comboBox.classList.toggle('hot', hud.combo >= 5);

    $('#hud-time').textContent = hud.timeText;
    const ring = $('#hud-timer-ring');
    const C = 2 * Math.PI * 57;
    ring.style.strokeDasharray = `${C}`;
    ring.style.strokeDashoffset = `${C * (1 - hud.remaining / CONFIG.durationSec)}`;
    ring.classList.toggle('rush', hud.remaining <= 10);

    const bars = $('#hud-gear-bars').children;
    for (let i = 0; i < bars.length; i++) bars[i].classList.toggle('on', i <= hud.gear);
    $('#hud-gear').textContent = hud.gear + 1;

    // 生效道具
    const fx = [];
    for (const [k, v] of Object.entries(hud.active)) {
      if (v > 0) {
        const p = CONFIG.powerups[k];
        fx.push(`<div class="fx" style="--c:${p.color}">
          <span class="fi">${p.icon}</span><span>${p.label}</span><b>${Math.ceil(v)}s</b>
        </div>`);
      }
    }
    if (hud.shield) fx.push(`<div class="fx" style="--c:#1e7be0"><span class="fi">🛡</span><span>护盾</span></div>`);
    $('#hud-effects').innerHTML = fx.join('');

    // 道具槽
    const slots = $('#hud-slots');
    if (slots.dataset.sig !== hud.slots.join(',')) {
      slots.dataset.sig = hud.slots.join(',');
      slots.innerHTML = '<span class="slots-lbl">道具</span>' + hud.slots.map((k, i) => {
        const p = CONFIG.powerups[k];
        return `<button class="slot" data-k="${k}" data-i="${i}" title="${p.label}" style="--c:${p.color}">
          <span>${p.icon}</span>
        </button>`;
      }).join('');
      slots.querySelectorAll('.slot').forEach(b => {
        b.addEventListener('click', () => this.cb.onUsePowerup?.(Number(b.dataset.i)));
      });
    }

    // 题目
    if (gateQ) {
      const ask = $('#hud-ask');
      const main = $('#hud-q-main');
      const sub = $('#hud-q-sub');
      const q = gateQ.question;
      const mainText = q.stem.audioOnly ? '听读音，选出它的含义' : q.stem.text;
      const sig = `${q.id}|${q.type}|${q.answer}|${mainText}`;
      if (main.dataset.sig !== sig) {
        main.dataset.sig = sig;
        if (q.stem.blank) main.innerHTML = spellStemHtml(q.stem);
        else main.textContent = mainText;
        // 按字数分级缩字号，尽量不截断
        const len = mainText.length;
        main.classList.toggle('long', len > 40);
        main.classList.toggle('mid', len > 20 && len <= 40);
      }

      const parts = [];
      // 听音题不能露音标，否则等于把答案写出来了
      if (q.stem.phonetic && !q.stem.audioOnly) parts.push(q.stem.phonetic);
      if (q.stem.pos) parts.push(q.stem.pos);
      if (q.stem.sub) parts.push(q.stem.sub);   // 拼写题：释义提示
      sub.textContent = parts.join('  ');
      sub.classList.toggle('hide', parts.length === 0);

      // 题型标签
      $('#hud-q-type').textContent = TYPE_LABEL[q.type] || '选一题';

      // 读题进度：以「题目激活那一刻」的距离为 100%，走满即到门
      const dist = Math.max(0, -gateQ.z);
      const window0 = gateQ.activeDist || gateQ.gap || CONFIG.gateGapVocab;
      const left = Math.min(1, dist / window0);        // 剩余比例
      const bar = $('#hud-read-bar');
      bar.style.transform = `scaleX(${1 - left})`;
      const secs = dist / Math.max(1, hud.speed || CONFIG.gears[hud.gear]);
      $('#hud-q-hint').textContent = secs >= 0.4
        ? `${secs.toFixed(1)}s 后过门`
        : '锁定车道';
      ask.classList.toggle('urgent', left < 0.3);
      ask.classList.toggle('locked', !!hud.locked);

      ask.classList.toggle('audio-only', !!q.stem.audioOnly);
      ask.classList.toggle('starred', !!gateQ.star);
      $('#hud-q-retry').classList.toggle('on', !!gateQ.retry);

      const opts = $('#hud-opts').children;
      const letters = q.type === 'spell';
      for (let i = 0; i < 4; i++) {
        const o = opts[i];
        const t = o.querySelector('.t');
        if (t.textContent !== q.options[i]) t.textContent = q.options[i];
        o.classList.toggle('letters', letters);
        o.classList.toggle('selected', i === hud.lane);
        o.classList.toggle('star', !!gateQ.star && i === q.answer);
        o.classList.toggle('locked', !!hud.locked);
      }
      $('#hud-opts').classList.toggle('locked', !!hud.locked);
      document.documentElement.style.setProperty('--lane', hud.lane);
    }
  }

  /**
   * 答后反馈：不再弹「屏幕正中的卡片」，改成在答题条上就地呈现。
   * 屏幕中心是赛道的消失点，也是下一道门升起来的位置 —— 卡片放那里
   * 一定会挡住玩家看下一题。改成：
   *   · 选项条里直接把「正确项」点亮、「选错项」标红
   *   · 解释挤在答题条上沿一行小字，不遮挡赛道
   *   · 答对只在分数旁飘一个 +N，不做大遮罩
   */
  showAnswer({ correct, gained, explain, answerText, shielded, answerIndex, chosen }) {
    const opts = $('#hud-opts');
    const bar = $('.hud-bottom');

    // 1) 选项就地标注
    if (opts) {
      const kids = opts.children;
      for (let i = 0; i < kids.length; i++) {
        kids[i].classList.remove('reveal-ok', 'reveal-bad');
        if (i === answerIndex) kids[i].classList.add('reveal-ok');
        else if (!correct && i === chosen) kids[i].classList.add('reveal-bad');
      }
      opts.classList.add('revealed');
    }

    // 2) 解释条：挂在答题条上沿，不压赛道中心
    const fb = $('#hud-feedback');
    if (fb) {
      if (correct) {
        fb.className = 'feedback on-bar good';
        fb.innerHTML = `<span class="fb-mark">✓</span><b>+${gained}</b>`
          + `${gained >= 10 ? '<em class="fb-tag">双倍</em>' : ''}`
          + `<em>${answerText}</em>`;
      } else if (shielded) {
        fb.className = 'feedback on-bar shield';
        fb.innerHTML = `<span class="fb-mark">🛡</span><b>护盾抵挡</b><em>${answerText}</em>`;
      } else {
        fb.className = 'feedback on-bar bad';
        fb.innerHTML = `<span class="fb-mark">✕</span><b>${answerText}</b>`
          + `<em>${explain || ''}</em>`;
      }
      // 告诉玩家可以不等：读到一半就能继续
      if (fb && !fb.querySelector('.fb-skip')) {
        const skip = el('span', 'fb-skip', '任意键继续');
        fb.appendChild(skip);
      }
      fb.classList.add('show');
    }
    if (bar) bar.classList.add('revealed');

    clearTimeout(this._fbTimer);
    // 时长由游戏侧的驻留时间决定，这里只负责兜底清理
    this._fbTimer = setTimeout(() => this.clearAnswer(), correct ? 1400 : 2800);
  }

  /** 收起答后反馈，回到干净的答题状态 */
  clearAnswer() {
    const fb = $('#hud-feedback');
    if (fb) { fb.classList.remove('show'); fb.className = 'feedback'; }
    const opts = $('#hud-opts');
    if (opts) {
      opts.classList.remove('revealed');
      for (const k of opts.children) k.classList.remove('reveal-ok', 'reveal-bad');
    }
    const bar = $('.hud-bottom');
    if (bar) bar.classList.remove('revealed');
  }

  setQuestion(gate) {
    const ask = $('#hud-ask');
    ask.classList.toggle('starred', !!gate?.star);
    $('#hud-star').classList.toggle('on', !!gate?.star);
    $('#hud-q-retry').classList.toggle('on', !!gate?.retry);
  }

  /* ── 倒计时数字 ── */
  setCountdown(n) {
    const num = $('#count-num');
    if (!num) return;
    num.textContent = n === 0 ? 'GO!' : n;
    num.classList.remove('pop');
    void num.offsetWidth;
    num.classList.add('pop');
    num.classList.toggle('go', n === 0);
  }

  /* ── 结算渲染 ── */
  showResult(sum) {
    // 大分数 = 三轮最高分
    $('#res-grade').textContent = sum.grade;
    $('#res-grade-text').textContent = sum.grade;
    $('#res-score').textContent = sum.score;
    $('#res-grade').dataset.grade = sum.grade;

    // 标题文案：强调「取最高轮」
    const titleEl = $('#res-title');
    if (titleEl) {
      titleEl.textContent = `最终成绩 · ${sum.roundsPlayed} 轮取最高`;
    }

    // 三轮对比
    const rounds = sum.rounds || [];
    if (rounds.length > 1) {
      const maxScore = Math.max(...rounds.map(r => r.score), 1);
      const bestIdx = rounds.findIndex(r => r.score === sum.score);
      $('#res-rounds').innerHTML = `
        <div class="rr-title">三轮成绩 <span class="muted">（最高分计入最终成绩）</span></div>
        <div class="rr-list">
          ${rounds.map((r, i) => `
            <div class="rr-card${i === bestIdx ? ' best' : ''}">
              <div class="rr-head">
                <span class="rr-n">第 ${r.round} 轮</span>
                ${i === bestIdx ? '<span class="rr-crown">最高</span>' : ''}
              </div>
              <b class="rr-score">${r.score}</b>
              <div class="rr-bar"><u style="width:${Math.max(4, (r.score / maxScore) * 100)}%"></u></div>
              <div class="rr-meta">${Math.round(r.accuracy * 100)}% · ${r.correct}/${r.answered}</div>
            </div>
          `).join('')}
        </div>
      `;
      $('#res-rounds').style.display = '';
    } else {
      $('#res-rounds').style.display = 'none';
    }

    const acc = Math.round(sum.accuracy * 100);
    $('#res-stats').innerHTML = `
      <div class="stat"><b>${acc}%</b><span>总正确率</span></div>
      <div class="stat"><b>${sum.correct}/${sum.answered}</b><span>答对/作答</span></div>
      <div class="stat"><b>${sum.maxCombo}</b><span>最高连击</span></div>
      <div class="stat"><b>${sum.starsEarned}</b><span>拿到道具</span></div>
      <div class="stat"><b>${sum.reviewed}</b><span>复习词条</span></div>
      <div class="stat"><b>${sum.upgraded}</b><span>记忆升级</span></div>
    `;

    const rev = $('#res-review');
    if (!sum.mistakes.length) {
      rev.innerHTML = `<h3>全部答对 🎉</h3><p class="muted">这一批没有错题，间隔重复已安排好下次复习。</p>`;
    } else {
      const cards = sum.mistakes.map(m => `
        <div class="rev-card">
          <div class="rev-top">
            <span class="rev-q">${m.blank ? spellStemHtml({ blank: m.blank }) : escapeHtml(m.stem)}</span>
            ${m.phonetic ? `<span class="rev-ph">${escapeHtml(m.phonetic)}</span>` : ''}
          </div>
          <div class="rev-ans">
            <span class="rev-correct">✓ ${escapeHtml(m.answerFull || m.options[m.answer])}</span>
            <span class="rev-wrong">${m.answerFull
              ? `你填了 ${escapeHtml(m.options[m.chosen] ?? '—')}`
              : `你选了 ${escapeHtml(m.options[m.chosen] ?? '—')}`}</span>
          </div>
          ${m.explain ? `<div class="rev-exp">${escapeHtml(m.explain)}</div>` : ''}
        </div>
      `).join('');
      rev.innerHTML = `
        <h3>错题回顾 <span class="muted">（${sum.mistakes.length}）</span></h3>
        <div class="rev-list">${cards}</div>
      `;
    }
    this.show('result');
  }

  setBest(best) {
    const e = $('#res-best');
    if (e) e.textContent = best;
  }
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

/** 拼写题题干：缺字母处画成金色空格槽（用空白块，不画下划线字符，免得与边框叠成两条线） */
function spellStemHtml(stem) {
  const { pre, len, post } = stem.blank;
  const slot = `<i class="hole" style="width:${(len * 0.68).toFixed(2)}em"></i>`;
  return `${escapeHtml(pre)}${slot}${escapeHtml(post)}`;
}
