// 主入口：装配各模块、输入、渲染循环
import { CONFIG } from './core/config.js';
import { loadBank, loadBankList } from './core/bank.js';
import { SRS } from './core/srs.js';
import { World } from './world/world.js';
import { Game, STATE } from './game/game.js';
import { Sfx, Bgm, Voice } from './audio/audio.js';
import { UI } from './ui/ui.js';
import { createLoop, clamp } from './core/utils.js';

const BEST_KEY = id => `wordrider:best:${id}`;

async function main() {
  const canvas = document.getElementById('game');
  const bootHint = document.getElementById('boot-hint');

  /* ── 音频 ── */
  const sfx = new Sfx();
  const bgm = new Bgm(sfx);
  const voice = new Voice();

  /* ── 画质 ── */
  const isMobile = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
  let quality = isMobile ? 'medium' : 'high';

  /* ── 上次的选择 ── */
  const LOOK_KEY = 'wordrider:look';
  const DEFAULT_LOOK = { theme: 'coast', vehicle: 'bike', palette: 'teal' };
  let savedLook = { ...DEFAULT_LOOK };
  try {
    const raw = localStorage.getItem(LOOK_KEY);
    if (raw) savedLook = { ...DEFAULT_LOOK, ...JSON.parse(raw) };
  } catch { /* ignore */ }

  /* ── 3D 世界 ── */
  bootHint.textContent = '正在构建赛道…';
  const world = new World(canvas, innerWidth, innerHeight, quality, savedLook);

  /* ── 题库 ── */
  bootHint.textContent = '正在载入题库…';
  let bank;
  let srs;
  try {
    const list = await loadBankList();
    const id = (list[0] && list[0].id) || 'cet4';
    bank = await loadBank(id);
    srs = new SRS(id);
    if (!bank.vocab.length) throw new Error('题库为空');
    bootHint.textContent = `已载入 ${bank.vocab.length} 个单词 · ${bank.grammar.length} 道语法题`;
  } catch (e) {
    console.error(e);
    bootHint.innerHTML = `题库载入失败：${e.message}<br>请确认通过本地服务器打开（不能直接双击 HTML）`;
    return;
  }

  const bestKey = BEST_KEY(bank.id);
  const getBest = () => Number(localStorage.getItem(bestKey) || 0);
  const setBest = v => localStorage.setItem(bestKey, String(v));

  /* ── 游戏 ── */
  const audio = { sfx, bgm, voice };
  let game = new Game({ bank, srs, world, audio, onEvent: handleEvent });

  /* ── UI ── */
  let lastOpts = { mode: 'mixed', gear: 2, includeNew: true, ...savedLook };

  const ui = new UI({
    onStart: (opts) => startRun(opts),
    onResume: () => { game.resume(); ui.show('hud'); },
    onRestart: () => startRun(lastOpts),
    onQuit: () => quitToMenu(),
    onTogglePause: () => togglePause(),
    onReplay: () => replayVoice(),
    onPickLane: (i) => game.setLane(i),
    onUsePowerup: (i) => game.usePowerup(i),
    onToggleSound: (on) => { sfx.enabled = on; voice.enabled = on; bgm.enabled = on; if (!on) { voice.stop(); bgm.stop(); sfx.setWind(0); } },
    onSetQuality: (hd) => setQuality(hd ? 'high' : 'medium'),
    onPreview: (opts) => {
      world.setTheme(opts.theme);
      world.setVehicle(opts.vehicle, opts.palette);
      try { localStorage.setItem(LOOK_KEY, JSON.stringify({ ...opts })); } catch { /* ignore */ }
    },
  });

  // 开始页显示上次的选择
  ui.syncPickers(savedLook);

  /* ── 事件 ── */
  function handleEvent(type, payload) {
    switch (type) {
      case 'state':
        if (payload === STATE.RIDING) ui.show('hud');
        if (payload === STATE.FEEDBACK) ui.setQuestion(game.hudGate);
        break;

      case 'countdown':
        ui.setCountdown(payload);
        break;

      case 'question':
        ui.setQuestion({ star: payload.star, retry: payload.retry });
        break;

      case 'answer':
        ui.showAnswer(payload);
        if (payload.correct) {
          world.burstAtBike(
            payload.star ? [1, 0.84, 0.34] : [0.55, 1, 0.7],
            payload.star ? 60 : 30
          );
        }
        break;

      case 'powerups':
        // HUD 会在下一帧刷新
        break;

      case 'roundEnd':
        onRoundEnd(payload);
        break;

      case 'finish':
        onFinish(payload);
        break;
    }
  }

  function onRoundEnd(payload) {
    // 有错题先记录，等最终结算再看
    ui.showRoundEnd(payload, (action) => {
      if (action === 'next') {
        world.resetView();
        game.nextRound();
        ui.show('countdown');
        ui.setCountdown(3);
      } else {
        // 最后一轮：进入整场结算
        showFinal();
      }
    });
  }

  function showFinal() {
    const sum = game.matchSummary();
    const best = getBest();
    if (sum.score > best) setBest(sum.score);
    ui.setStartStats(
      srs.stats(bank.vocab.map(v => v.id).concat(bank.grammar.map(g => g.id))),
      Math.max(best, sum.score)
    );
    ui.showResult(sum);
    ui.show('result');
  }

  function onFinish(sum) {
    showFinal();
  }

  /* ── 流程控制 ── */
  function startRun(opts) {
    lastOpts = { ...opts };
    world.setTheme(opts.theme || 'coast');
    world.setVehicle(opts.vehicle || 'bike', opts.palette || null);
    try { localStorage.setItem(LOOK_KEY, JSON.stringify({
      theme: opts.theme, vehicle: opts.vehicle, palette: opts.palette,
    })); } catch { /* ignore */ }
    // 音频需要用户手势初始化
    sfx.init();
    sfx.resume();

    // 重建游戏
    game = new Game({ bank, srs, world, audio, onEvent: handleEvent });
    world.resetGatePool();
    game.reset(opts);
    game.state = STATE.MENU;

    ui.resetRoundBars();
    ui.show('countdown');
    ui.setCountdown(3);
    game.start();
  }

  function quitToMenu() {
    game.state = STATE.MENU;
    bgm.stop();
    voice.stop();
    sfx.setWind(0);
    clearGatesVisual();
    refreshStart();
    ui.show('start');
  }

  function clearGatesVisual() {
    world.resetGatePool();
    game.clearGates?.();
  }

  function togglePause() {
    if (game.state === STATE.PAUSED) {
      game.resume();
      if (game.state === STATE.RIDING) ui.show('hud');
      else ui.show('hud');
    } else if ([STATE.RIDING, STATE.FEEDBACK, STATE.COUNTDOWN].includes(game.state)) {
      game.pause();
      ui.show('pause');
    }
  }

  function replayVoice() {
    const g = game.currentGate;
    if (!g || !g.question.speakBefore) return;
    const url = bank.tts.get(g.question.speakBefore.trim()) || null;
    voice.speak(url, g.question.speakBefore);
  }

  function setQuality(q) {
    // 画质切换需要重建渲染器，简化为提示刷新
    if (q === quality) return;
    quality = q;
    localStorage.setItem('wordrider:quality', q);
  }

  function refreshStart() {
    const ids = bank.vocab.map(v => v.id).concat(bank.grammar.map(g => g.id));
    ui.setStartStats(srs.stats(ids), getBest());
  }

  /* ── 输入 ── */
  const keys = new Set();
  addEventListener('keydown', (e) => {
    const k = e.key.toLowerCase();

    // 开始 / 结算页的回车
    if (k === 'enter') {
      if (game.state === STATE.MENU && ui.current === 'start') {
        startRun(ui.startOpts);
        e.preventDefault();
        return;
      }
      if (ui.current === 'result') { startRun(lastOpts); e.preventDefault(); return; }
      if (ui.current === 'round') {
        const btn = document.querySelector('#btn-round-next, #btn-round-final');
        if (btn) { btn.click(); e.preventDefault(); return; }
      }
    }

    if (k === 'escape') {
      if (ui.current === 'pause') { game.resume(); ui.show('hud'); }
      else togglePause();
      e.preventDefault();
      return;
    }

    if (ui.current !== 'hud') return;
    if (e.repeat) return;

    // 答后解释还在时，任意换道/空格键都当作「看完了，继续」
    if (game.hudHold && [' ', 'arrowleft', 'arrowright', 'arrowup', 'arrowdown', 'a', 'd', 'w', 's', 'enter'].includes(k)) {
      if (game.skipFeedback()) { e.preventDefault(); return; }
    }

    switch (k) {
      case 'arrowleft': case 'a': game.moveLane(-1); e.preventDefault(); break;
      case 'arrowright': case 'd': game.moveLane(1); e.preventDefault(); break;
      case 'arrowup': case 'w': game.changeGear(1); e.preventDefault(); break;
      case 'arrowdown': case 's': game.changeGear(-1); e.preventDefault(); break;
      case ' ': game.usePowerup(); e.preventDefault(); break;
      case 'r': replayVoice(); e.preventDefault(); break;
      case '1': case '2': case '3': case '4': game.setLane(Number(k) - 1); e.preventDefault(); break;
      case 'p': togglePause(); e.preventDefault(); break;
    }
  });

  // 触屏：左右滑动换道，点击选项格
  let touchX = null, touchY = null, touchT = 0;
  addEventListener('touchstart', (e) => {
    const t = e.touches[0];
    touchX = t.clientX; touchY = t.clientY; touchT = performance.now();
  }, { passive: true });

  addEventListener('touchend', (e) => {
    if (touchX === null) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - touchX;
    const dy = t.clientY - touchY;
    const dt = performance.now() - touchT;
    // 解释还在时，轻点一下屏幕就算「看完了」
    if (game.hudHold && Math.abs(dx) < 12 && Math.abs(dy) < 12 && dt < 500) {
      if (game.skipFeedback()) { touchX = null; return; }
    }
    if (Math.abs(dx) > 42 && Math.abs(dx) > Math.abs(dy) * 1.3 && dt < 600) {
      game.moveLane(dx > 0 ? 1 : -1);
    } else if (Math.abs(dy) > 52 && Math.abs(dy) > Math.abs(dx) * 1.3 && dt < 600) {
      game.changeGear(dy < 0 ? 1 : -1);
    }
    touchX = null;
  }, { passive: true });

  /* ── 缩放 ── */
  let resizeTimer = 0;
  addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => world.resize(innerWidth, innerHeight), 120);
  });

  /* ── 点击开始音频上下文（浏览器策略） ── */
  const unlock = () => { sfx.init(); sfx.resume(); };
  addEventListener('pointerdown', unlock, { once: true });
  addEventListener('keydown', unlock, { once: true });

  /* ── 主循环 ── */
  let hudAccum = 0;
  let wasHolding = false;
  const loop = createLoop((dt, now) => {
    const time = now / 1000;
    game.update(dt);
    world.update(dt, game, time);
    world.render();

    // 驻留刚结束 → 收起答后反馈，回到干净的答题界面
    const holding = !!game.hudHold;
    if (wasHolding && !holding) ui.clearAnswer?.();
    wasHolding = holding;

    // HUD 每帧更新（低成本，直接改文本）
    hudAccum += dt;
    if (hudAccum > 0.033) {
      hudAccum = 0;
      const hud = game.hud;
      ui.updateHud(hud, game.hudGate);
      const tEl = document.getElementById('hud-time');
      if (tEl) tEl.classList.toggle('rush', hud.remaining <= 10);
    }
  });

  /* ── 启动 ── */
  refreshStart();
  document.getElementById('loading').classList.add('hidden');
  ui.show('start');
  loop.start();

  // 调试入口
  window.__rider = {
    get game() { return game; },
    world, ui, srs, bank, sfx,
    get state() { return game.state; },
  };
}

main().catch(e => {
  console.error(e);
  const hint = document.getElementById('boot-hint');
  if (hint) hint.textContent = '启动失败：' + e.message;
});
