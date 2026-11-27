// 游戏核心：状态机、移动、门架调度、判分、道具
//
// 坐标约定：
//   - 门架 z 从 -220（远处）向 +6（身后）移动
//   - 自行车固定在 z = 0 平面附近，相机跟随
//   - 过门判定：门 z >= 0
import { CONFIG } from '../core/config.js';
import {
  clamp, damp, makeRng, pickWeighted, fmtTime,
} from '../core/utils.js';
import { makeVocabQuestion, spreadAnswerIndex } from '../core/questions.js';
import { buildBatch } from '../core/srs.js';
import { ttsUrlFor } from '../core/bank.js';

export const STATE = {
  MENU: 'menu',
  COUNTDOWN: 'countdown',
  RIDING: 'riding',
  FEEDBACK: 'feedback',
  PAUSED: 'paused',
  ROUND_END: 'roundEnd',      // 单轮结束，等待下一轮
  FINISHED: 'finished',
};

const GATE_SPAWN_Z = -130;
const GATE_DESPAWN_Z = 18;

function dedupeMistakes(list) {
  const seen = new Set();
  const out = [];
  for (const m of list) {
    const key = m.id + '|' + m.chosen;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(m);
  }
  return out;
}

export class Game {
  constructor({ bank, srs, world, audio, onEvent }) {
    this.bank = bank;
    this.srs = srs;
    this.world = world;
    this.audio = audio;
    this.onEvent = onEvent || (() => {});
    this.state = STATE.MENU;
    this.rng = makeRng(Date.now());
    this.reset();
  }

  reset(options = {}) {
    this.options = {
      includeNew: true, gear: 2,
      rounds: CONFIG.roundsPerMatch, ...options,
    };

    // ── 多轮比赛状态 ──
    this.totalRounds = this.options.rounds || CONFIG.roundsPerMatch;
    this.roundIndex = 0;          // 0-based
    this.roundResults = [];       // 每轮汇总
    this._roundRecorded = -1;     // 已记录成绩的轮次，防止重复

    this._roundRecorded = -1;   // 新一轮可以记录
    this.elapsed = 0;
    this.remaining = CONFIG.durationSec;
    this.score = 0;
    this.combo = 0;
    this.maxCombo = 0;
    this._milestones = new Set();
    this._lastMinuteReport = 0;
    this.gear = this.options.gear;
    this.speed = CONFIG.gears[this.gear];
    this.lane = 1;
    this.laneVisual = 1;
    this.lean = 0;
    this.timeScale = 1;

    this.answered = 0;
    this.correct = 0;
    this.decisive = 0;
    this.starsEarned = 0;

    this.queue = [];
    this.qIndex = 0;
    this.gates = [];
    // 下一道门的生成位置偏移（相对当前位置，负值更远）
    this.nextGateOffset = 0;   // 仅用于 speakAfter 判断，不再驱动生成

    this.slots = [];
    this.active = { double: 0, boost: 0, slowmo: 0 };
    this.shield = false;
    this.fiftyOnNext = false;

    this.currentGate = null;
    this.laneLocked = false;
    this.laneLockAt = 0;

    this.log = [];
    this.mistakes = [];

    this.fx = { flash: 0, flashColor: [1, 1, 1], shake: 0, speedLines: 0 };

    this._lastCountStep = null;
    this.feedbackTimer = 0;
    this._feedbackTimeout = null;
    // 答完题后的「结果驻留」：这段时间 HUD 停在刚答的题上显示对错，
    // 不立刻切到下一题，避免答案与下一题同屏打架
    this.hudHold = null;
    this.hudHoldExpired = true;

    this.rebuildQueue();
    this.clearGates();
  }

  rebuildQueue() {
    const batch = buildBatch(this.bank, this.srs, {
      includeNew: this.options.includeNew,
      rng: this.rng,
    });
    this.queue = batch.map((it, i) => ({
      ...it,
      answerIndex: spreadAnswerIndex(i, this.rng),
    }));
    this.qIndex = 0;
  }

  clearGates() {
    for (const g of this.gates) {
      if (g.gateObj?.group?.parent) this.world.scene.remove(g.gateObj.group);
    }
    this.gates = [];
    this.currentGate = null;
    this.world.resetGatePool?.();
  }

  /* ── 生命周期 ── */
  start() {
    this.state = STATE.COUNTDOWN;
    this.countdown = 3.6;
    this._lastCountStep = null;
    this.onEvent('state', this.state);
    this.onEvent('countdown', 3);
    this.audio.sfx.resume();
  }

  pause() {
    if (![STATE.RIDING, STATE.FEEDBACK, STATE.COUNTDOWN].includes(this.state)) return;
    this._prevState = this.state;
    this.state = STATE.PAUSED;
    this.audio.bgm.stop();
    this.audio.voice.stop();
    this.audio.sfx.setWind(0);
    this.audio.sfx.silenceEngine?.();
    this.onEvent('state', this.state);
  }

  resume() {
    if (this.state !== STATE.PAUSED) return;
    this.state = this._prevState || STATE.RIDING;
    if (this.state === STATE.RIDING) this.audio.bgm.start();
    this.onEvent('state', this.state);
  }

  /** 一轮结束（同一轮只会记录一次） */
  endRound() {
    // 已经结束过就直接返回（幂等）
    if (this.state === STATE.FINISHED || this.state === STATE.ROUND_END) return;
    this.state = STATE.ROUND_END;
    // 同一轮只记录一次成绩
    const alreadyRecorded = this._roundRecorded === this.roundIndex;
    this._roundRecorded = this.roundIndex;
    if (this._feedbackTimeout) clearTimeout(this._feedbackTimeout);
    // 轮次结束：清掉答后驻留，别把解释卡带进下一轮
    this.hudHold = null;
    this.hudHoldExpired = true;
    this.audio.bgm.stop();
    this.audio.voice.stop();
    this.audio.sfx.setWind(0);
    this.audio.sfx.silenceEngine?.();
    this.audio.sfx.finish();
    this.srs.save();

    const roundSummary = this.roundSummary();
    if (!alreadyRecorded) this.roundResults.push(roundSummary);

    this.onEvent('state', this.state);
    this.onEvent('roundEnd', {
      ...roundSummary,
      roundIndex: this.roundIndex,
      totalRounds: this.totalRounds,
      isLast: this.roundIndex >= this.totalRounds - 1,
      best: this.bestScore(),
    });
  }

  /** 开始下一轮（清空本轮状态，保留轮次记录与题库进度） */
  nextRound() {
    if (this.roundIndex >= this.totalRounds - 1) return false;
    this.roundIndex++;

    // 重置单轮状态（不动 roundResults / totalRounds / options）
    const keep = {
      totalRounds: this.totalRounds,
      roundIndex: this.roundIndex,
      roundResults: this.roundResults,
      options: this.options,
      srs: this.srs,
      bank: this.bank,
      world: this.world,
      audio: this.audio,
      onEvent: this.onEvent,
    };

    this._roundRecorded = -1;   // 新一轮可以记录
    this.elapsed = 0;
    this.remaining = CONFIG.durationSec;
    this.score = 0;
    this.combo = 0;
    this.maxCombo = 0;
    this.gear = this.options.gear;
    this.speed = CONFIG.gears[this.gear];
    this.lane = 1;
    this.laneVisual = 1;
    this.lean = 0;
    this.timeScale = 1;
    this.answered = 0;
    this.correct = 0;
    this.decisive = 0;
    this.starsEarned = 0;
    this.qIndex = 0;
    this.nextGateOffset = 0;
    this.slots = [];
    this.active = { double: 0, boost: 0, slowmo: 0 };
    this.shield = false;
    this.fiftyOnNext = false;
    this.currentGate = null;
    this.laneLocked = false;
    this.laneLockAt = 0;
    this.log = [];
    this.mistakes = [];
    this.fx = { flash: 0, flashColor: [1, 1, 1], shake: 0, speedLines: 0 };
    this._lastCountStep = null;
    this._feedbackTimeout = null;
    this.hudHold = null;
    this.hudHoldExpired = true;

    this.clearGates();
    this.rebuildQueue();
    this.start();
    return true;
  }

  /** 一轮的成绩单 */
  roundSummary() {
    const total = this.answered;
    const acc = total ? this.correct / total : 0;
    return {
      round: this.roundIndex + 1,
      score: this.score,
      grade: CONFIG.grades.find(g => this.score >= g.min)?.grade || 'C',
      answered: total,
      correct: this.correct,
      accuracy: acc,
      maxCombo: this.maxCombo,
      starsEarned: this.starsEarned,
      seconds: CONFIG.durationSec - this.remaining,
      reviewed: new Set(this.log.map(l => l.id)).size,
      upgraded: this.log.filter(l => l.correct && l.decisive).length,
      mistakes: this.mistakes.slice(),
    };
  }

  bestScore() {
    if (!this.roundResults.length) return 0;
    return Math.max(...this.roundResults.map(r => r.score));
  }

  /** 全部轮次结束 */
  finishMatch() {
    if (this.state === STATE.FINISHED) return;
    this.state = STATE.FINISHED;
    if (this._feedbackTimeout) clearTimeout(this._feedbackTimeout);
    this.audio.bgm.stop();
    this.audio.voice.stop();
    this.audio.sfx.setWind(0);
    this.audio.sfx.silenceEngine?.();
    this.srs.save();
    this.onEvent('state', this.state);
    this.onEvent('finish', this.matchSummary());
  }

  /** 整场结算：取三轮最高分 */
  matchSummary() {
    const rounds = this.roundResults.slice();
    const best = rounds.length ? Math.max(...rounds.map(r => r.score)) : 0;
    const bestRound = rounds.find(r => r.score === best) || rounds[0];
    const totalAnswered = rounds.reduce((a, r) => a + r.answered, 0);
    const totalCorrect = rounds.reduce((a, r) => a + r.correct, 0);

    return {
      // 最终成绩 = 三轮最高分
      score: best,
      grade: CONFIG.grades.find(g => best >= g.min)?.grade || 'C',
      rounds,
      bestRound,
      roundsPlayed: rounds.length,
      totalRounds: this.totalRounds,
      // 汇总统计
      answered: totalAnswered,
      correct: totalCorrect,
      accuracy: totalAnswered ? totalCorrect / totalAnswered : 0,
      maxCombo: Math.max(...rounds.map(r => r.maxCombo), 0),
      starsEarned: rounds.reduce((a, r) => a + r.starsEarned, 0),
      reviewed: new Set(rounds.flatMap(r => r.mistakes.map(m => m.id))).size,
      upgraded: rounds.reduce((a, r) => a + r.upgraded, 0),
      // 错题汇总（去重）
      mistakes: dedupeMistakes(rounds.flatMap(r => r.mistakes)),
      seconds: rounds.reduce((a, r) => a + r.seconds, 0),
    };
  }

  /** 直接结束整场（跳过剩余轮次） */
  finish() {
    if (this._roundRecorded !== this.roundIndex) this.endRound();
    // 跳过未进行的轮次，直接把已完成的轮次算进最终成绩
    this.finishMatch();
  }

  summary() {
    const total = this.answered;
    const acc = total ? this.correct / total : 0;
    const grade = CONFIG.grades.find(g => this.score >= g.min)?.grade || 'C';
    const reviewed = new Set(this.log.map(l => l.id)).size;
    const upgraded = this.log.filter(l => l.correct && l.decisive).length;
    return {
      score: this.score,
      grade,
      answered: total,
      correct: this.correct,
      accuracy: acc,
      maxCombo: this.maxCombo,
      gear: this.gear,
      starsEarned: this.starsEarned,
      mistakes: this.mistakes.slice(),
      seconds: CONFIG.durationSec - this.remaining,
      reviewed,
      upgraded,
      totalQueue: this.queue.length,
    };
  }

  /* ── 输入 ── */
  moveLane(dir) { this.setLane(this.lane + dir); }

  /** 跳过答后解释（玩家想快点继续时用），返回是否真的跳过了 */
  skipFeedback() {
    if (!this.hudHold) return false;
    // 至少让人看清一瞬，避免误触直接跳走
    if (this.hudHold.left > this.hudHold.dur - 0.25) return false;
    this.hudHold = null;
    this.hudHoldExpired = true;
    this.onEvent('skipFeedback');
    return true;
  }

  setLane(i) {
    if (![STATE.RIDING, STATE.COUNTDOWN].includes(this.state)) return;
    if (this.laneLocked) return;        // 已进入判定区，不能再改
    const next = clamp(i, 0, CONFIG.lanes - 1);
    if (next === this.lane) return;
    this.lane = next;
    this.laneLockAt = this.elapsed;
    this.audio.sfx.laneChange();
    this.onEvent('lane', this.lane);
  }

  changeGear(dir) {
    if (![STATE.RIDING, STATE.COUNTDOWN].includes(this.state)) return;
    const next = clamp(this.gear + dir, 0, CONFIG.gears.length - 1);
    if (next === this.gear) return;
    this.gear = next;
    this.audio.sfx.gearShift(dir > 0);
    this.onEvent('gear', this.gear);
  }

  usePowerup(slotIndex = null) {
    if (this.state !== STATE.RIDING) return;
    if (!this.slots.length) return;
    const idx = slotIndex === null ? 0 : clamp(slotIndex, 0, this.slots.length - 1);
    const p = this.slots.splice(idx, 1)[0];
    this.applyPowerup(p.kind);
    this.audio.sfx.powerup(p.kind === 'shield' ? 'shield' : 'gain');
    this.onEvent('powerups', this.powerupState());
  }

  applyPowerup(kind) {
    switch (kind) {
      case 'double':
        this.active.double = CONFIG.powerups.double.dur;
        this.fx.flash = 0.26;
        this.fx.flashColor = [1, 0.86, 0.42];
        break;
      case 'boost':
        this.active.boost = CONFIG.powerups.boost.dur;
        this.audio.sfx.nitro?.();
        this.fx.flash = 0.2;
        this.fx.flashColor = [0.55, 0.86, 1.0];
        break;
      case 'slowmo': this.active.slowmo = CONFIG.powerups.slowmo.dur; break;
      case 'shield': this.shield = true; break;
      case 'fifty': this.fiftyOnNext = true; break;
    }
  }

  grantPowerup() {
    if (this.slots.length >= CONFIG.powerupSlots) this.slots.shift();
    const weights = {};
    for (const [k, v] of Object.entries(CONFIG.powerups)) weights[k] = v.weight;
    const kind = pickWeighted(weights, this.rng);
    this.slots.push({ kind });
    this.starsEarned++;
    this.audio.sfx.starChime();
    this.world.pelicanMood?.('powerup', 1.2);
    this.onEvent('powerups', this.powerupState());
    return kind;
  }

  powerupState() {
    return {
      slots: this.slots.map(s => s.kind),
      active: { ...this.active },
      shield: this.shield,
      fifty: this.fiftyOnNext,
    };
  }

  /* ── 主循环 ── */
  update(dtRaw) {
    this.fx.flash = Math.max(0, this.fx.flash - dtRaw * 2.4);
    this.fx.shake = Math.max(0, this.fx.shake - dtRaw * 3.2);

    if (this.state === STATE.MENU || this.state === STATE.PAUSED || this.state === STATE.FINISHED) {
      this.applyFx();
      return;
    }

    if (this.state === STATE.COUNTDOWN) {
      this.countdown -= dtRaw;
      const step = Math.ceil(this.countdown - 0.6);
      if (step !== this._lastCountStep && step >= 0 && step <= 3) {
        this._lastCountStep = step;
        this.audio.sfx.countdown(step);
        this.onEvent('countdown', step);
      }
      if (this.countdown <= 0) {
        this.state = STATE.RIDING;
        this.audio.bgm.start();
        this.onEvent('state', this.state);
        this.spawnGate();
      }
      this.applyFx();
      return;
    }

    const dt = dtRaw * this.timeScale;
    this.elapsed += dt;

    // 学习暂停：答完后读解释的时间不计入比赛倒计时。
    // 这是个背单词游戏 —— 让人看答案要倒扣时间，等于惩罚学习。
    const studyHold = !!this.hudHold;
    if (!studyHold) this.remaining -= dt;

    // 速度
    let target = CONFIG.gears[this.gear];
    if (this.active.boost > 0) target *= CONFIG.boostMul;
    if (this.active.slowmo > 0) target *= CONFIG.slowmoMul;
    this.speed = damp(this.speed, target, 5, dt);

    // 道具计时
    for (const k of ['double', 'boost', 'slowmo']) {
      if (this.active[k] > 0) this.active[k] = Math.max(0, this.active[k] - dt);
    }
    this.timeScale = damp(this.timeScale, 1, 4, dt);

    // 车道视觉与侧倾
    this.laneVisual = damp(this.laneVisual, this.lane, 12, dt);
    this.lean = damp(this.lean, clamp((this.laneVisual - this.lane) * 0.2 + (this.lane - this.laneVisual) * 0.1, -0.16, 0.16), 8, dt);

    // 答后驻留倒计时：走真实时间，不受慢镜头影响，
    // 保证「看解释」的时长是可预期的
    if (this.hudHold) {
      this.hudHold.left -= dtRaw;
      if (this.hudHold.left <= 0) {
        this.hudHold = null;
        this.hudHoldExpired = true;      // 允许下一题接管 HUD
      }
    }

    // 驻留期间把车速压到很低：门架几乎不前进，
    // 玩家看完解释后下一题仍在舒适读题距离，不会「一抬头已经贴脸」
    const gateDt = this.hudHold ? dt * CONFIG.studyHoldSpeed : dt;

    // 门架推进
    this.updateGates(gateDt);

    // 音频
    const windLevel = clamp((this.speed - 8) / 16, 0, 1);
    this.audio.sfx.setWind(windLevel);
    this.audio.sfx.setEngine?.(windLevel, this.gear, this.active.boost > 0);
    this.audio.bgm.setIntensity(clamp(this.gear / 4, 0, 1));
    this.audio.bgm.setRush(this.remaining <= 10);

    if (this.remaining <= 0) {
      this.remaining = 0;
      this.endRound();
      return;
    }

    this.applyFx();
  }

  applyFx() {
    this.fx.speedLines = clamp((this.speed - 15) / 12, 0, 1) * (this.active.boost > 0 ? 1.7 : 1);
  }

  /* ── 门架 ── */
  updateGates(dt) {
    const travel = this.speed * dt;

    for (const g of this.gates) g.z += travel;

    // 移除已过的门
    const keep = [];
    for (const g of this.gates) {
      if (g.z > GATE_DESPAWN_Z) {
        if (g.gateObj?.group?.parent) this.world.scene.remove(g.gateObj.group);
        this.world.recycleGate?.(g.gateObj);
      } else {
        keep.push(g);
      }
    }
    this.gates = keep;

    // 保持前方始终有 2~3 道门（不足就立刻补）
    this.nextGateOffset -= travel;
    let guard = 0;
    while (this.gates.length < 2 && guard++ < 4) {
      this.spawnGate();
    }
    if (this.gates.length < 3 && this.nextGateOffset <= 0) {
      this.spawnGate();
    }

    // 逼近中的门（最前面的、未作答的）
    let approaching = null;
    for (const g of this.gates) {
      if (g.answered) continue;
      if (!approaching || g.z > approaching.z) approaching = g;
    }

    if (approaching) {
      // 答后驻留期间：不切换当前题，也不触发新题朗读，
      // 让玩家先把上一题的对错和解释看完
      const holding = this.hudHold && !this.hudHoldExpired;
      if (this.currentGate !== approaching && !holding) {
        this.currentGate = approaching;
        this.laneLocked = false;
            this.onQuestionActive(approaching);
      }

      // 车道锁定（驻留期间不判定，避免刚答完就把下一题锁住）
      const dist = -approaching.z;   // 还差多少米到门
      const nowLocked = !holding && dist <= CONFIG.lockDistance && dist > 0;
      if (nowLocked && !this.laneLocked) {
        this.laneLockAt = this.elapsed;
        this.onEvent('lock', { lane: this.lane });
      }
      this.laneLocked = nowLocked;

      // 下一道门的高亮始终跟随玩家当前车道：
      // 驻留期间车速很慢，玩家正好可以趁机把车挪到想好的车道
      if (approaching.gateObj) approaching.gateObj.setLaneSelected(this.lane);

      // 过门判分：驻留期间不判，避免解释还没看完就被下一题判了
      if (!holding && approaching.z >= 0) this.resolveGate(approaching);
    }

    for (const g of this.gates) {
      if (!g.gateObj) continue;
      g.gateObj.group.position.z = g.z;
      g.gateObj.update(dt);

      // 过门后门架继续逼近相机。第一人称镜头在 z≈-2.8，
      // 门一旦越过镜头（z > rideZ）就会在身后被大 FOV 拉成糊屏色块，
      // 所以只保留「镜头之前」的部分。
      const camZ = CONFIG.bikeZ - 0.55;
      g.gateObj.group.visible = g.z > -260 && g.z <= camZ;
    }

    // 预告剪影门
    if (this.world.ghostGate) {
      const upcoming = this.gates
        .filter(g => !g.answered && g !== approaching && g.z < -20)
        .sort((a, b) => b.z - a.z)[0];
      if (upcoming) {
        this.world.ghostGate.visible = true;
        this.world.ghostGate.position.z = upcoming.z;
      } else {
        this.world.ghostGate.visible = false;
      }
    }
  }

  spawnGate() {
    if (!this.queue.length) return null;
    const entry = this.queue[this.qIndex % this.queue.length];
    this.qIndex++;

    const q = makeVocabQuestion(entry.source, this.bank.vocab, this.rng, { answerIndex: entry.answerIndex });

    const isStar = !!entry.star && this.remaining > CONFIG.noStarLastSec;

    const gateObj = this.world.createGate();
    gateObj.configure(q, isStar);

    const gap = CONFIG.gateGapVocab;
    // 首道门直接放在 firstGateDist 处；之后接在最远那道门后面再退 gap
    const z = this.gates.length
      ? Math.min(...this.gates.map(g => g.z)) - gap
      : -CONFIG.firstGateDist;
    const gate = {
      z,
      gap,
      question: q,
      star: isStar,
      gateObj,
      answered: false,
      retryOf: entry.retryOf || null,
      retryCount: entry.retryCount || 0,
      decisive: false,
      laneAtLock: -1,
    };

    gateObj.group.position.z = gate.z;
    this.world.scene.add(gateObj.group);
    this.gates.push(gate);

    this.nextGateOffset = gap;
    this._lastGap = gap;

    if (this.fiftyOnNext) {
      gateObj.disableTwo();
      this.fiftyOnNext = false;
      this.onEvent('powerups', this.powerupState());
    }

    return gate;
  }

  onQuestionActive(gate) {
    const q = gate.question;
    // 记录题目激活时的距离，供 HUD 读题进度条换算真实窗口
    gate.activeDist = Math.max(1, -gate.z);
    this.onEvent('question', {
      question: q,
      star: gate.star,
      retry: gate.retryOf,
      timeLeft: this.remaining,
    });
    if (q.speakBefore) {
      const url = ttsUrlFor(this.bank, q.speakBefore);
      this.audio.voice.speak(url, q.speakBefore);
    }
  }

  resolveGate(gate) {
    if (gate.answered) return;
    gate.answered = true;

    const q = gate.question;
    const chosen = this.lane;
    const isCorrect = chosen === q.answer;

    // 果断：锁定车道时刻距过门至少 decisiveSec
    const lockDist = Math.max(0, -gate.z);
    const timeToGate = lockDist / Math.max(1, this.speed);
    const decisive = this.laneLockAt > 0
      ? (this.elapsed - this.laneLockAt) >= CONFIG.decisiveSec
      : true;

    gate.decisive = decisive;
    gate.chosen = chosen;
    gate.gateObj.revealResult(chosen);

    let gained = 0;
    let shieldedHit = false;

    if (isCorrect) {
      this.combo++;
      this.maxCombo = Math.max(this.maxCombo, this.combo);
      gained = this.active.double > 0 ? CONFIG.scoreCorrect * 2 : CONFIG.scoreCorrect;
      this.score += gained;
      this.correct++;
      this.answered++;
      if (decisive) this.decisive++;

      this.audio.sfx.correct(this.combo);
      this.fx.flash = 0.15;
      this.fx.flashColor = [0.72, 1.0, 0.82];

      // 鹈鹕欢呼：连击越高越兴奋
      const cheerLevel = this.combo >= 8 ? 1.5 : this.combo >= 5 ? 1.3
        : this.combo >= 3 ? 1.15 : 1.0;
      this.world.pelicanMood?.(this.combo >= 5 ? 'superCheer' : 'cheer', cheerLevel);

      // ── 中途里程碑：给孩子即时反馈，别等 3 分钟 ──
      this._checkMilestone();

      if (gate.star) this.grantPowerup();
      this.speakAfter(q);
    } else {
      if (this.shield) {
        this.shield = false;
        shieldedHit = true;
        this.audio.sfx.shieldBreak();
        this.world.pelicanMood?.('powerup', 0.9);
        this.fx.flash = 0.24;
        this.fx.flashColor = [0.5, 0.82, 1.0];
        this.onEvent('powerups', this.powerupState());
      } else {
        this.combo = 0;
        this.score = Math.max(CONFIG.scoreFloor, this.score + CONFIG.scoreWrong);
        this.fx.flash = 0.3;
        this.fx.flashColor = [1, 0.44, 0.44];
        this.fx.shake = 0.5;
        this.audio.sfx.wrong();
        this.world.pelicanMood?.('oops', 1.0);
      }
      this.answered++;

      this.audio.voice.stop();
      if (q.speakAfter) this.audio.voice.speak(ttsUrlFor(this.bank, q.speakAfter), q.speakAfter);

      this.mistakes.push({
        id: q.id, kind: q.kind, type: q.type,
        stem: q.stem.text, phonetic: q.stem.phonetic,
        options: q.options.slice(), answer: q.answer, chosen,
        answerFull: q.answerFull || null,
        blank: q.stem.blank || null,
        explain: q.explain, speakAfter: q.speakAfter,
      });

      // 慢镜头反馈
      this.timeScale = CONFIG.wrongSlowmoScale;
      this.state = STATE.FEEDBACK;
      if (this._feedbackTimeout) clearTimeout(this._feedbackTimeout);
      this._feedbackTimeout = setTimeout(() => {
        if (this.state === STATE.FEEDBACK) {
          this.state = STATE.RIDING;
          this.onEvent('state', this.state);
        }
      }, CONFIG.wrongSlowmo * 1000);

      this.scheduleRetry(gate);
    }

    this.srs.record(q.id, isCorrect, decisive);
    this.srs.flush?.();

    this.log.push({
      id: q.id, correct: isCorrect, decisive,
      star: gate.star, kind: q.kind, type: q.type,
    });

    // 结果驻留：接下来 feedbackHold 秒内 HUD 停在刚答的题上，
    // 让玩家看到对错与解释，之后再切下一题（避免同屏打架）
    const holdDur = isCorrect ? CONFIG.feedbackHoldCorrect : CONFIG.feedbackHoldWrong;
    this.hudHold = {
      gate,
      chosen,
      correct: isCorrect,
      shielded: shieldedHit,
      answerIndex: q.answer,
      answerText: q.answerFull || q.options[q.answer],
      explain: q.explain,
      left: holdDur,
      dur: holdDur,
    };
    this.hudHoldExpired = false;

    this.onEvent('answer', {
      correct: isCorrect,
      gained,
      score: this.score,
      combo: this.combo,
      explain: q.explain,
      answerText: q.answerFull || q.options[q.answer],
      answerIndex: q.answer,     // 让 HUD 就地标出正确项
      chosen,                    // 以及自己骑进了哪条道
      stem: q.stem.text,
      type: q.type,
      star: gate.star,
      shielded: shieldedHit,
    });

    gate.resolved = true;
  }

  /** 连击/答题数里程碑，以及每分钟进度播报 */
  _checkMilestone() {
    const c = this.combo;

    // 每 5 连击一次（5/10/15/20…）
    if (c > 0 && c % 5 === 0) {
      const key = 'combo' + c;
      if (!this._milestones.has(key)) {
        this._milestones.add(key);
        const words = {
          5: '连对 5！',
          10: '连对 10！太厉害了',
          15: '连对 15！停不下来',
          20: '连对 20！神了',
          25: '连对 25！',
          30: '连对 30！',
        };
        this.onEvent('milestone', {
          kind: 'combo',
          count: c,
          text: words[c] || `连对 ${c}！`,
        });
      }
    }

    // 每分钟报一次进度
    const elapsed = CONFIG.durationSec - this.remaining;
    const minute = Math.floor(elapsed / 60);
    if (minute > this._lastMinuteReport && minute < Math.ceil(CONFIG.durationSec / 60)) {
      this._lastMinuteReport = minute;
      this.onEvent('milestone', {
        kind: 'minute',
        count: minute,
        text: `第 ${minute} 分钟 · 已答对 ${this.correct} 题`,
      });
    }
  }

  speakAfter(q) {
    if (!q.speakAfter) return;
    // 距离下一道门还有多少米 → 折算成可用时间
    const gap = this._lastGap || CONFIG.gateGapVocab;
    const gapTime = gap / Math.max(1, this.speed);
    if (gapTime > 2.4) {
      this.audio.voice.speak(ttsUrlFor(this.bank, q.speakAfter), q.speakAfter);
    }
  }

  scheduleRetry(gate) {
    const q = gate.question;
    const retryCount = (gate.retryCount || 0) + 1;
    if (retryCount > CONFIG.maxRetries) return;

    const insertAt = Math.min(this.qIndex + CONFIG.retryGap, this.queue.length);
    const original = this.queue.find(e => e.source?.id === q.id);
    this.queue.splice(insertAt, 0, {
      id: q.id,
      kind: q.kind,
      source: q.source,
      star: original?.star ?? false,
      retryOf: q.id,
      retryCount,
      answerIndex: (q.answer + 1 + Math.floor(this.rng() * 3)) % 4,
    });
  }

  get hud() {
    return {
      score: this.score,
      combo: this.combo,
      remaining: this.remaining,
      timeText: fmtTime(this.remaining),
      gear: this.gear,
      gearName: CONFIG.gearNames[this.gear],
      gearMax: CONFIG.gears.length - 1,
      lane: this.lane,
      speed: this.speed,
      active: { ...this.active },
      shield: this.shield,
      slots: this.slots.map(s => s.kind),
      speedRatio: clamp((this.speed - 8) / 22, 0, 1),
      rush: this.remaining <= 10,
      progress: 1 - this.remaining / CONFIG.durationSec,
      locked: this.laneLocked,
      round: this.roundIndex + 1,
      totalRounds: this.totalRounds,
      bestSoFar: this.bestScore(),
      // 答后驻留：HUD 应显示刚答完的那道题，而不是下一题
      hold: this.hudHold,
    };
  }

  /** HUD 当前该显示哪道题：驻留期间显示刚答的那道 */
  get hudGate() {
    if (this.hudHold?.gate) return this.hudHold.gate;
    return this.currentGate;
  }
}
