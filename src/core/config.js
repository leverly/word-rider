// 全局配置：所有可调参数集中在这里
export const CONFIG = {
  // ── 一轮 ──
  durationSec: 180,
  roundsPerMatch: 3,      // 一局几轮
  lanes: 4,
  scoreCorrect: 5,
  scoreWrong: -1,
  scoreFloor: 0,

  // ── 速度与节奏（米/秒） ──
  gears: [10, 12.5, 15, 17.5, 20],
  gearNames: ['轻松', '悠闲', '巡航', '迅捷', '冲刺'],
  gateGapVocab: 110,     // 单词题两道门之间 110 米（巡航 7.3s / 冲刺 5.5s 读题）
  gateGapGrammar: 155,   // 语法题句子长，给到 155 米（巡航 10.3s / 冲刺 7.8s）
  firstGateDist: 95,
  lockDistance: 6,       // 距门 6 米锁车道（留出一点余量，避免最后一刻误判）

  // ── 判分节奏 ──
  decisiveSec: 0.6,      // 过门前 0.6 秒内才换到正确道 = 犹豫
  wrongSlowmo: 1.0,      // 答错慢镜头时长（真实秒）
  wrongSlowmoScale: 0.25,

  // ── 答后反馈（关键体验参数） ──
  // 过门后把 HUD 停在刚答的题上，显示对错与解释；这段时间不切下一题。
  // 慢镜头期间本就在 FEEDBACK，错题要给足看解释的时间。
  feedbackHoldCorrect: 0.75,   // 答对：只留一点呼吸感
  feedbackHoldWrong: 2.4,      // 答错：够读完「正确答案 + 解释」
  feedbackFade: 0.25,          // 反馈淡出到下一题题的过渡时长（秒）

  // 过门后门架收到这个 z 就不再画：再往前它会撑满镜头，糊掉视线
  // （相机在 z=10.6，门到 6.0 时单块牌已占 65% 屏宽）
  gatePassHideZ: 6.0,

  // 答后驻留期间赛道推进速度倍率：几乎停住，
  // 让玩家看完解释后下一题仍在舒适的读题距离
  studyHoldSpeed: 0.12,

  // ── 批次 ──
  batchSize: 60,
  vocabGrammarMix: 0.7,  // 单词:语法
  starRatio: 0.22,
  retryGap: 4,           // 错题隔 4 题重现
  maxRetries: 2,
  noStarLastSec: 10,

  // ── 题型比例（单词题内部） ──
  typeWeights: {
    word2meaning: 0.32, audio2meaning: 0.16, meaning2word: 0.16, cloze: 0.16,
    spell: 0.20,        // 拼写补全：释义 + 缺字母词形，四选一填空
  },
  spellPairWeight: 0.35, // 拼写题挖两个连续字母（如 ea / ck）的比例，其余挖一个

  // ── 间隔重复（毫秒） ──
  srsIntervalsMs: [
    10 * 60 * 1000,
    24 * 3600 * 1000,
    3 * 24 * 3600 * 1000,
    7 * 24 * 3600 * 1000,
    15 * 24 * 3600 * 1000,
    30 * 24 * 3600 * 1000,
  ],

  // ── 道具 ──
  powerups: {
    double:   { dur: 15, label: '双倍得分', icon: '×2', color: '#e63946', weight: 0.30 },
    boost:    { dur: 10, label: '极速冲刺', icon: '⚡', color: '#ffc233', weight: 0.25 },
    shield:   { dur: 0,  label: '护盾',     icon: '🛡', color: '#1e7be0', weight: 0.15 },
    slowmo:   { dur: 8,  label: '慢镜头',   icon: '⏱', color: '#8e9bb3', weight: 0.15 },
    fifty:    { dur: 0,  label: '二选一',   icon: '½',  color: '#a855c8', weight: 0.15 },
  },
  powerupSlots: 2,
  boostMul: 1.4,
  slowmoMul: 0.7,

  // ── 评级（实测：满档全对 130 分 / 巡航 105 分 / 轻松 65 分） ──
  grades: [
    { min: 125, grade: 'S' },   // 接近满档全对
    { min: 85,  grade: 'A' },
    { min: 40,  grade: 'B' },
    { min: 0,   grade: 'C' },
  ],

  // ── 渲染 ──
  laneWidth: 3.6,
  roadHalf: 7.2,
  laneX: [-5.4, -1.8, 1.8, 5.4],
  laneColors: [0xe63946, 0xffc233, 0x159a6e, 0x1e7be0],
  laneCssColors: ['#e63946', '#ffc233', '#159a6e', '#1e7be0'],
  bikeZ: -2.2,
  camFollowY: 4.9,
  camFollowZ: 10.6,
};

export const LANE_LABELS = ['1', '2', '3', '4'];
