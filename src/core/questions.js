// 出题引擎：把题库条目变成「一道门」所需的全部数据
//
// 每题结构：
// {
//   id, kind:'vocab'|'grammar',
//   type: 'word2meaning'|'audio2meaning'|'meaning2word'|'cloze'|'spell'|'grammar',
//   stem: { text, phonetic, pos, audioOnly, speaker }  // 门架题干牌
//         spell 题另有 blank:{pre,hole,post}（空缺高亮）与 sub（释义）
//   options: [4 个字符串]
//   answer: 0..3
//   answerFull: 拼写题的完整单词（选项只是缺字母，反馈时显示整词）
//   speakBefore: 文本（答前朗读）
//   speakAfter:  文本（答后朗读）
//   explain: 一句话解释
//   star: boolean
//   retryOf: 原题 id（错题重现时）
// }

import { CONFIG } from './config.js';
import {
  pickWeighted, shuffle, charOverlap, editDistance,
} from './utils.js';

const V2M = 'word2meaning';
const A2M = 'audio2meaning';
const M2W = 'meaning2word';
const CLOZE = 'cloze';
const SPELL = 'spell';

/* ── 拼写补全：易混字母组 ──
   只有长度与空缺一致的才会被用作干扰项 */
const CONFUSE = {
  a: ['e', 'i', 'o', 'u'], e: ['a', 'i', 'o', 'u'], i: ['e', 'a', 'y'],
  o: ['a', 'u', 'e'], u: ['o', 'a', 'e'], y: ['i', 'e'],
  b: ['p', 'd'], c: ['k', 's'], d: ['t', 'b'], f: ['v', 'p'],
  g: ['j', 'k'], j: ['g'], k: ['c', 'g'], l: ['r', 'n'], m: ['n', 'w'],
  n: ['m', 'r'], p: ['b', 'q'], q: ['g'], r: ['l', 'n'], s: ['c', 'z'],
  t: ['d', 'r'], v: ['f', 'w'], w: ['v', 'u'], x: ['z', 's'], z: ['s', 'x'],
  ea: ['ee', 'ie', 'ei', 'ai'], ee: ['ea', 'ie', 'ei'], ie: ['ei', 'ee', 'ea'],
  ei: ['ie', 'ea', 'ee'], ai: ['ei', 'ay', 'ia'], ay: ['ai', 'ey'],
  oa: ['ou', 'oo'], ou: ['oo', 'au', 'ow'], ow: ['ou', 'oa'], oo: ['ou', 'oa'],
  ue: ['ew', 'eu'], au: ['ou', 'aw'], aw: ['au', 'ow'], oi: ['oy'], oy: ['oi'],
  ck: ['k', 'c'], ch: ['sh', 'tc'], sh: ['ch', 'sc'], th: ['ht', 'sh'],
  ph: ['f', 'gh'], gh: ['f', 'ph'], wh: ['w', 'h'], qu: ['kw', 'q'],
  ng: ['nk', 'nc'], nk: ['ng', 'nc'],
  er: ['or', 'ar'], or: ['er', 'ar'], ar: ['er', 'or'],
  el: ['le', 'al'], le: ['el', 'al'], al: ['el', 'le'],
  an: ['en', 'on'], en: ['an', 'on'], on: ['en', 'an'],
  in: ['en', 'an'], un: ['on', 'an'],
  ss: ['sc', 'st'], ll: ['rl', 'lt'], tt: ['dt', 'ct'], nn: ['mn', 'rn'],
  mm: ['mn', 'nm'], pp: ['bp', 'pd'], rr: ['rl', 'rw'], ff: ['pf', 'fv'],
  tion: ['sion', 'cion'], sion: ['tion', 'cion'], able: ['ible', 'ebel'],
  ible: ['able', 'ibal'], ance: ['ence', 'ance'], ence: ['ance', 'ense'],
  ant: ['ent', 'int'], ent: ['ant', 'ont'], ous: ['us', 'uos'],
  ate: ['ete', 'ite'], ite: ['ate', 'ete'], ive: ['eve', 'ave'],
  ey: ['ay', 'y', 'ie'], ir: ['er', 'ur', 'or'], ur: ['ir', 'er', 'or'],
  ui: ['ue', 'iu'], eu: ['ue', 'ew'], ew: ['ue', 'eu', 'ow'],
  ce: ['se', 'ce'], ge: ['je', 'ge'], se: ['ce', 'ze'], ve: ['fe', 've'],
  te: ['de', 'te'], de: ['te', 'de'], re: ['er', 're'], ne: ['en', 'ne'],
  me: ['em', 'me'], pe: ['ep', 'pe'], ly: ['ley', 'li'], ty: ['tty', 'ti'],
  ed: ['d', 'ede'], es: ['s', 'ies'],
  dd: ['d', 'tt'], bb: ['b', 'pp'], gg: ['g', 'ck'],
};

/* 真正的拼写单位：挖两字母时优先选这些，别把 nv 这种跨音节的组合挖掉 */
const DIGRAPHS = new Set([
  'ea', 'ee', 'ie', 'ei', 'ai', 'ay', 'ey', 'oa', 'ou', 'ow', 'oo', 'ue', 'ui',
  'au', 'aw', 'oi', 'oy', 'eu', 'ew',
  'ck', 'ch', 'sh', 'th', 'ph', 'gh', 'wh', 'qu', 'ng', 'nk',
  'ss', 'll', 'tt', 'nn', 'mm', 'pp', 'rr', 'ff', 'dd', 'bb', 'gg',
  'er', 'or', 'ar', 'ir', 'ur',
  'le', 'el', 'al', 'ce', 'ge', 'se', 've', 'te', 'de', 're', 'ne', 'me', 'pe',
  'ly', 'ty', 'ed', 'es',
]);

const VOWELS = new Set(['a', 'e', 'i', 'o', 'u']);

/** 按权重抽一个 */
function weightedPick(list, rng) {
  const total = list.reduce((s, c) => s + c.score, 0);
  let r = rng() * total;
  for (const c of list) {
    r -= c.score;
    if (r <= 0) return c;
  }
  return list[list.length - 1];
}

/** 枚举所有空缺位置：首尾各留一个字母，按「值不值得考」打分 */
function holeCandidates(word, len) {
  const out = [];
  for (let s = 1; s + len <= word.length - 1; s++) {
    const seg = word.slice(s, s + len).toLowerCase();
    let score;
    if (len === 2) {
      // 只有真 digraph 值得挖两个字母，其余几乎不选
      score = DIGRAPHS.has(seg) ? 3.2 : (seg[0] === seg[1] ? 1.3 : 0.16);
    } else if (VOWELS.has(seg)) {
      score = 1.7;                       // 元音最值得考
    } else if (CONFUSE[seg]) {
      score = 1.35;                      // 有易混对手的辅音（c/s、b/p、双写）
    } else {
      score = 0.5;
    }
    // 越靠词中后部越值得考（词尾的 -tion/-ence/-able 是拼写重灾区）
    score *= 1 + 0.55 * (s / word.length);
    out.push({ start: s, len, score });
  }
  return out;
}

/** 挑一个空缺 */
function pickHole(word, rng) {
  const L = word.length;
  if (L < 4) return { start: 1, len: 1 };

  if (L >= 6 && rng() < CONFIG.spellPairWeight) {
    const pairs = holeCandidates(word, 2).filter(c => c.score > 1);
    if (pairs.length) return weightedPick(pairs, rng);
  }
  const singles = holeCandidates(word, 1);
  if (!singles.length) return { start: 1, len: 1 };
  return weightedPick(singles, rng);
}

/** 拼写题的 3 个干扰字母组：易混组 + 本词其它位置 + 其它单词里的真实字母块 */
function spellDistractors(item, pool, hole, rng) {
  const word = item.word;
  const key = word.slice(hole.start, hole.start + hole.len).toLowerCase();
  const seen = new Set([key]);
  const claim = (s) => {
    if (s.length !== hole.len) return false;
    const k = s.toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  };

  const hard = [];
  for (const c of CONFUSE[key] || []) if (claim(c)) hard.push(c);
  for (let i = 0; i + hole.len <= word.length; i++) {
    if (i === hole.start) continue;
    if (claim(word.slice(i, i + hole.len))) hard.push(word.slice(i, i + hole.len));
  }

  const soft = [];
  const others = pool
    .filter(v => v.id !== item.id && v.word !== word)
    .sort((a, b) => Math.abs(a.word.length - word.length) - Math.abs(b.word.length - word.length));
  for (const v of others) {
    const w = v.word;
    const span = Math.max(1, w.length - hole.len + 1);
    for (const s0 of shuffle([...Array(span).keys()], rng)) {
      const s = w.slice(s0, s0 + hole.len);
      if (s.length === hole.len && claim(s)) { soft.push(s); break; }
    }
  }

  // 两个「像」的 + 一个「别的词里真出现过」的，凑不出再回填
  const h = shuffle(hard, rng);
  const s = shuffle(soft, rng);
  const ordered = [...h.slice(0, 2), ...s.slice(0, 1), ...h.slice(2), ...s.slice(1)];

  const out = ordered.slice(0, 3);
  const AB = 'abcdefghijklmnopqrstuvwxyz';
  while (out.length < 3) {
    let g = '';
    for (let i = 0; i < hole.len; i++) g += AB[Math.floor(rng() * AB.length)];
    if (claim(g)) out.push(g);
  }
  return out;
}

/** 为给定单词挑 3 个干扰项 */
export function pickDistractors(target, pool, need, mode, rng) {
  // 排除自己、以及释义/拼写完全相同的
  const cands = pool.filter(v =>
    v.id !== target.id &&
    v.meaning !== target.meaning &&
    v.word.toLowerCase() !== target.word.toLowerCase()
  );

  let ordered;
  if (mode === 'hard') {
    // 形近（同词性优先）或义近
    ordered = [...cands].sort((a, b) => {
      const sa = (a.pos === target.pos ? 0 : 2) + editDistance(a.word, target.word) * 0.1 + (1 - charOverlap(a.meaning, target.meaning));
      const sb = (b.pos === target.pos ? 0 : 2) + editDistance(b.word, target.word) * 0.1 + (1 - charOverlap(b.meaning, target.meaning));
      return sa - sb;
    });
  } else if (mode === 'easy') {
    ordered = shuffle(cands, rng);
  } else {
    // 中：同词性 → 同 group → 其余
    const score = v =>
      (v.pos === target.pos ? 0 : 10) +
      (v.group && v.group === target.group ? 0 : 3);
    ordered = shuffle(cands, rng).sort((a, b) => score(a) - score(b));
  }

  // 去重（按被选字段）
  const field = (mode === 'hard' || mode === 'easy') ? 'word' : 'word';
  const out = [];
  const usedWord = new Set([target.word.toLowerCase()]);
  const usedMeaning = new Set([target.meaning]);

  for (const c of ordered) {
    if (out.length >= need) break;
    if (usedWord.has(c.word.toLowerCase())) continue;
    if (usedMeaning.has(c.meaning)) continue;
    usedWord.add(c.word.toLowerCase());
    usedMeaning.add(c.meaning);
    out.push(c);
  }

  // 题库太小兜底
  let i = 0;
  while (out.length < need && i < pool.length) {
    const c = pool[i++];
    if (c.id === target.id) continue;
    if (out.some(o => o.id === c.id)) continue;
    out.push(c);
  }
  return out.slice(0, need);
}

/** 把正确项和干扰项打乱成 4 个选项 */
function buildOptions(correctText, wrongTexts, rng, correctIndexHint = null) {
  const all = shuffle([correctText, ...wrongTexts], rng);
  let answer = all.indexOf(correctText);
  if (correctIndexHint !== null && answer !== correctIndexHint) {
    // 均匀分布：按提示位置交换
    const swapWith = correctIndexHint;
    [all[answer], all[swapWith]] = [all[swapWith], all[answer]];
    answer = swapWith;
  }
  return { options: all, answer };
}

/** 生成一道单词题 */
export function makeVocabQuestion(item, pool, rng, opts = {}) {
  const type = opts.type || pickWeighted(CONFIG.typeWeights, rng);
  const distractorMode = opts.distractorMode || 'medium';
  const wantIndex = opts.answerIndex ?? null;

  if (type === M2W) {
    const wrongs = pickDistractors(item, pool, 3, distractorMode, rng).map(v => v.word);
    const { options, answer } = buildOptions(item.word, wrongs, rng, wantIndex);
    return {
      id: item.id, kind: 'vocab', type: M2W,
      stem: { text: item.meaning, phonetic: '', pos: item.pos, audioOnly: false, speaker: 'meaning' },
      options, answer,
      speakBefore: null,                      // 读出来就泄底
      speakAfter: item.word,
      explain: `${item.word} ${item.phonetic || ''} — ${item.meaning}`.trim(),
      sentence: item.sentence || null,
      source: item,
    };
  }

  if (type === A2M) {
    const wrongs = pickDistractors(item, pool, 3, distractorMode, rng).map(v => v.meaning);
    const { options, answer } = buildOptions(item.meaning, wrongs, rng, wantIndex);
    return {
      id: item.id, kind: 'vocab', type: A2M,
      stem: { text: '🔊 听读音选含义', phonetic: '', pos: '', audioOnly: true, speaker: 'word' },
      options, answer,
      speakBefore: item.word,
      speakAfter: `${item.word}。${item.sentence || ''}`.trim(),
      explain: `${item.word} ${item.phonetic || ''} — ${item.meaning}`.trim(),
      sentence: item.sentence || null,
      source: item,
    };
  }

  if (type === SPELL && item.word.length >= 4) {
    const hole = pickHole(item.word, rng);
    const pre = item.word.slice(0, hole.start);
    const key = item.word.slice(hole.start, hole.start + hole.len);
    const post = item.word.slice(hole.start + hole.len);
    const blanked = pre + '_'.repeat(hole.len) + post;
    const wrongs = spellDistractors(item, pool, hole, rng);
    const { options, answer } = buildOptions(key, wrongs, rng, wantIndex);
    return {
      id: item.id, kind: 'vocab', type: SPELL,
      stem: {
        text: blanked, phonetic: item.phonetic || '', pos: item.pos || '',
        audioOnly: false, speaker: 'word',
        blank: { pre, len: hole.len, post },   // 让题干牌把空缺画成高亮横线
        sub: item.meaning,                     // 释义提示
      },
      options, answer,
      answerFull: item.word,
      speakBefore: item.word,                  // 读整词，练「音→形」
      speakAfter: `${item.word}。${item.sentence || ''}`.trim(),
      explain: `${item.word} ${item.phonetic || ''} — ${item.meaning}`.trim(),
      sentence: item.sentence || null,
      source: item,
    };
  }

  if (type === CLOZE && item.sentence && item.sentence.toLowerCase().includes(item.word.toLowerCase())) {
    const blanked = item.sentence.replace(
      new RegExp(item.word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'),
      '_____'
    );
    const wrongs = pickDistractors(item, pool, 3, distractorMode, rng).map(v => v.word);
    const { options, answer } = buildOptions(item.word, wrongs, rng, wantIndex);
    return {
      id: item.id, kind: 'vocab', type: CLOZE,
      stem: { text: blanked, phonetic: '', pos: '', audioOnly: false, speaker: 'sentenceBlank' },
      options, answer,
      speakBefore: blanked.replace(/_{3,}/g, ', '),
      speakAfter: item.sentence,
      explain: `${item.word} ${item.phonetic || ''} — ${item.meaning}`.trim(),
      sentence: item.sentence,
      source: item,
    };
  }

  // 默认 / 兜底：看词选义
  const wrongs = pickDistractors(item, pool, 3, distractorMode, rng).map(v => v.meaning);
  const { options, answer } = buildOptions(item.meaning, wrongs, rng, wantIndex);
  return {
    id: item.id, kind: 'vocab', type: V2M,
    stem: { text: item.word, phonetic: item.phonetic || '', pos: item.pos || '', audioOnly: false, speaker: 'word' },
    options, answer,
    speakBefore: item.word,
    speakAfter: item.sentence || item.word,
    explain: `${item.word} ${item.phonetic || ''} — ${item.meaning}`.trim(),
    sentence: item.sentence || null,
    source: item,
  };
}

/** 生成一道语法题（选项由题库给定） */
export function makeGrammarQuestion(item, rng, opts = {}) {
  const wantIndex = opts.answerIndex ?? null;
  const texts = [...item.options];
  const correctText = item.options[item.answer];

  let all = texts;
  let answer = item.answer;
  if (wantIndex !== null && wantIndex !== item.answer) {
    all = [...texts];
    [all[answer], all[wantIndex]] = [all[wantIndex], all[answer]];
    answer = wantIndex;
  } else {
    // 轻微打乱，但保持正确项位置可控
    const perm = shuffle([0, 1, 2, 3], rng);
    all = perm.map(i => texts[i]);
    answer = perm.indexOf(item.answer);
  }

  const filled = item.prompt.replace(/_{2,}/g, ` ${correctText} `).replace(/\s+/g, ' ').trim();

  return {
    id: item.id, kind: 'grammar', type: 'grammar',
    stem: { text: item.prompt, phonetic: '', pos: item.topic || '', audioOnly: false, speaker: 'sentenceBlank' },
    options: all, answer,
    speakBefore: item.prompt.replace(/_{2,}/g, ', '),
    speakAfter: filled,
    explain: item.explanation || `正确答案：${correctText}`,
    sentence: filled,
    source: item,
  };
}

/** 均匀分布正确答案到四条道 */
export function spreadAnswerIndex(seqIndex, rng) {
  // 每 4 题覆盖一次 0..3，且顺序随机
  const block = Math.floor(seqIndex / 4);
  const offset = seqIndex % 4;
  const perm = shuffle([0, 1, 2, 3], (() => {
    let s = block * 7919 + 13;
    return () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
  })());
  return perm[offset];
}
