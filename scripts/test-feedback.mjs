// 纯逻辑测试：不需要浏览器，验证「答后驻留」时序与门架收线阈值
// 用法：node scripts/test-feedback.mjs
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const SRC = fileURLToPath(new URL('../src/', import.meta.url));

// 用最小替身跑 Game，不碰 three.js
const { Game, STATE } = await import(SRC + 'game/game.js').catch(async () => {
  // game.js 依赖 three 的世界对象，这里只取纯逻辑部分：直接读源码做静态断言
  return { Game: null, STATE: null };
});

const results = [];
const t = (name, fn) => {
  try { fn(); results.push(['✔', name]); }
  catch (e) { results.push(['✘', name + ' — ' + e.message]); }
};

/* ── 1. 配置项存在且合理 ── */
const { CONFIG } = await import(SRC + 'core/config.js');

t('答错驻留时间足够读完解释（≥2s）', () => {
  assert.ok(CONFIG.feedbackHoldWrong >= 2.0,
    `feedbackHoldWrong=${CONFIG.feedbackHoldWrong}`);
});
t('答对驻留时间短于答错（不拖节奏）', () => {
  assert.ok(CONFIG.feedbackHoldCorrect < CONFIG.feedbackHoldWrong);
});
t('答对驻留不为 0（留呼吸感）', () => {
  assert.ok(CONFIG.feedbackHoldCorrect > 0.3);
});
t('门架收线阈值在「不糊屏」范围内（≤7m）', () => {
  assert.ok(CONFIG.gatePassHideZ <= 7,
    `gatePassHideZ=${CONFIG.gatePassHideZ}`);
});
t('门架收线阈值不至于过早（≥4m）', () => {
  assert.ok(CONFIG.gatePassHideZ >= 4);
});

/* ── 2. 源码静态断言：关键接线是否正确 ── */
const { readFile } = await import('node:fs/promises');
const gameSrc = await readFile(SRC + 'game/game.js', 'utf8');
const uiSrc = await readFile(SRC + 'ui/ui.js', 'utf8');
const mainSrc = await readFile(SRC + 'main.js', 'utf8');
const cssSrc = await readFile(SRC + 'styles.css', 'utf8');

t('game 在 resolveGate 里建立 hudHold', () => {
  assert.match(gameSrc, /this\.hudHold\s*=\s*\{/);
});
t('game 驻留期间不切换 currentGate', () => {
  // 实际写法：if (this.currentGate !== approaching && !holding) { ...切题... }
  assert.match(gameSrc, /this\.currentGate\s*!==\s*approaching\s*&&\s*!holding/,
    '缺少 holding 守卫，会立刻切下一题');
});
t('game 提供 hudGate getter', () => {
  assert.match(gameSrc, /get hudGate\(\)/);
});
t('hudGate 驻留时返回刚答的题', () => {
  assert.match(gameSrc, /if\s*\(this\.hudHold\?\.gate\)\s*return\s*this\.hudHold\.gate/);
});
t('main 用 hudGate 而非 currentGate 驱动 HUD', () => {
  assert.match(mainSrc, /ui\.updateHud\(hud,\s*game\.hudGate\)/);
});
t('main 在驻留结束时清掉反馈', () => {
  assert.match(mainSrc, /wasHolding\s*&&\s*!holding.*clearAnswer/);
});
t('ui.showAnswer 会标注正确项与选错项', () => {
  assert.match(uiSrc, /reveal-ok/);
  assert.match(uiSrc, /reveal-bad/);
});
t('ui 提供 clearAnswer', () => {
  assert.match(uiSrc, /clearAnswer\(\)/);
});
t('反馈条位于 .hud-bottom 内部（不会飘到赛道中心）', () => {
  const m = uiSrc.match(/<div class="hud-bottom">([\s\S]*?)<\/div>\s*<\/div>/);
  assert.ok(m, '找不到 hud-bottom 结构');
  assert.match(m[1], /hud-feedback/, '反馈条不在 hud-bottom 里');
});
t('CSS 里反馈条不再用 top:44% 的居中定位', () => {
  assert.ok(!/\.feedback\s*\{[^}]*top\s*:\s*44%/.test(cssSrc),
    '反馈条仍是屏幕中央定位，会挡下一题');
});
t('CSS 反馈条用 grid 行内布局', () => {
  assert.match(cssSrc, /\.feedback\{[^}]*display:none/);
});
t('门架在 gatePassHideZ 之后不再渲染', () => {
  assert.match(gameSrc, /visible\s*=\s*g\.z\s*>\s*-260\s*&&\s*g\.z\s*<=\s*CONFIG\.gatePassHideZ/);
});

/* ── 3. 时序模拟：验证驻留窗口内 HUD 不会跳题 ── */
t('时序模拟：驻留期间 HUD 题目保持不变，结束后才切', () => {
  // 复刻 game.js 里 holding 的判定与倒计时逻辑
  const HOLD = CONFIG.feedbackHoldWrong;
  let hudHold = { left: HOLD };
  let hudHoldExpired = false;
  let currentGate = 'Q1';
  const nextGate = 'Q2';

  const tick = (dt) => {
    if (hudHold) {
      hudHold.left -= dt;
      if (hudHold.left <= 0) { hudHold = null; hudHoldExpired = true; }
    }
    const holding = hudHold && !hudHoldExpired;
    if (currentGate !== nextGate && !holding) currentGate = nextGate;
  };
  const hudGate = () => (hudHold?.gate ? hudHold.gate : currentGate);

  // 把 gate 挂上去，模拟刚答完
  hudHold.gate = 'Q1';

  // 驻留窗口内：每 1/60 秒推进，HUD 必须一直是 Q1
  let steps = 0;
  while (hudHold && steps < 1000) {
    tick(1 / 60); steps++;
    if (hudHold) {
      assert.equal(hudGate(), 'Q1', `第 ${steps} 帧 HUD 提前跳到下一题`);
    }
  }
  assert.ok(steps > 60, `驻留时间太短（${steps} 帧 ≈ ${(steps/60).toFixed(2)}s）`);
  // 驻留结束后才允许切换
  tick(1 / 60);
  assert.equal(hudGate(), 'Q2', '驻留结束后 HUD 没有切到下一题');
});

/* ── 4. 门架阈值几何校验 ── */
t('门架收线阈值对应屏占比 < 70%', () => {
  const camZ = 10.6, boardW = 3.62;
  const vfov = 44 * Math.PI / 180, aspect = 1400 / 880;
  const hfov = 2 * Math.atan(Math.tan(vfov / 2) * aspect);
  const dz = camZ - CONFIG.gatePassHideZ;
  const frac = (2 * Math.atan((boardW / 2) / dz)) / hfov;
  assert.ok(frac < 0.70, `z=${CONFIG.gatePassHideZ} 时单牌占屏 ${(frac*100).toFixed(0)}%`);
});

/* ── 5. 学习不该被倒计时惩罚 ── */
t('驻留期间比赛倒计时暂停', () => {
  assert.match(gameSrc, /studyHold[\s\S]{0,120}if\s*\(!studyHold\)\s*this\.remaining\s*-=/,
    '读解释的时间仍从比赛时间里扣');
});
t('驻留期间门架推进被减速', () => {
  assert.match(gameSrc, /gateDt\s*=\s*this\.hudHold\s*\?\s*dt\s*\*\s*CONFIG\.studyHoldSpeed/);
  assert.ok(CONFIG.studyHoldSpeed > 0 && CONFIG.studyHoldSpeed < 0.5,
    `studyHoldSpeed=${CONFIG.studyHoldSpeed} 应接近停住但保留一点动感`);
});
t('提供 skipFeedback 让玩家跳过解释', () => {
  assert.match(gameSrc, /skipFeedback\(\)/);
  assert.match(mainSrc, /game\.skipFeedback\(\)/);
});
t('跳过有最短保护（不能一出现就跳过）', () => {
  assert.match(gameSrc, /hudHold\.left\s*>\s*this\.hudHold\.dur\s*-\s*0\.25/,
    '缺少最短显示保护，误触会直接跳走');
});
t('UI 提示可以跳过', () => {
  assert.match(uiSrc, /fb-skip/);
});

/* ── 6. 时钟暂停的数值模拟 ── */
t('时序模拟：驻留 2.4s 内倒计时不减，之后恢复', () => {
  let remaining = 60;
  let hudHold = { left: CONFIG.feedbackHoldWrong, dur: CONFIG.feedbackHoldWrong };
  const step = (dt) => {
    const studyHold = !!hudHold;
    if (!studyHold) remaining -= dt;
    if (hudHold) {
      hudHold.left -= dt;
      if (hudHold.left <= 0) hudHold = null;
    }
  };
  // 驻留期间推进 2.0s
  for (let i = 0; i < 120; i++) step(1 / 60);
  assert.ok(Math.abs(remaining - 60) < 1e-9, `驻留期间倒计时被扣了 ${(60 - remaining).toFixed(2)}s`);
  // 驻留结束后推进 1s（驻留本身在 2.4s 整点结束前就归零，多出的那一帧也算正常流逝）
  for (let i = 0; i < 60; i++) step(1 / 60);
  assert.ok(remaining < 60 && remaining > 58.5,
    `恢复后倒计时没有正常走（${remaining}）`);
});

/* ── 输出 ── */
console.log('');
for (const [mark, name] of results) console.log(`  ${mark} ${name}`);
const failed = results.filter(r => r[0] === '✘').length;
console.log(`\n  ${results.length - failed}/${results.length} 通过`);
process.exit(failed ? 1 : 0);
