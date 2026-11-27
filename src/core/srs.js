// 间隔重复：6 级记忆箱 + 批次编排 + 持久化

import { CONFIG } from './config.js';
import { shuffle } from './utils.js';

const STORE_KEY = id => `wordrider:progress:${id}`;

export class SRS {
  constructor(bankId) {
    this.bankId = bankId;
    this.items = new Map();   // 题目 id -> { box, due, seen, correct, wrong, best }
    this.load();
  }

  load() {
    try {
      const raw = localStorage.getItem(STORE_KEY(this.bankId));
      if (!raw) return;
      const obj = JSON.parse(raw);
      for (const [k, v] of Object.entries(obj || {})) {
        this.items.set(k, {
          box: clampBox(v.box ?? 0),
          due: Number(v.due ?? 0),
          seen: Number(v.seen ?? 0),
          correct: Number(v.correct ?? 0),
          wrong: Number(v.wrong ?? 0),
        });
      }
    } catch { /* ignore */ }
  }

  save() {
    try {
      const obj = {};
      for (const [k, v] of this.items) obj[k] = v;
      localStorage.setItem(STORE_KEY(this.bankId), JSON.stringify(obj));
    } catch { /* quota / 隐私模式 */ }
  }

  get(id) {
    let r = this.items.get(id);
    if (!r) {
      r = { box: 0, due: 0, seen: 0, correct: 0, wrong: 0 };
      this.items.set(id, r);
    }
    return r;
  }

  /** 记录一次作答 */
  record(id, correct, decisive) {
    const r = this.get(id);
    r.seen++;
    if (correct) {
      r.correct++;
      // 果断答对升级；犹豫答对保持
      if (decisive) r.box = clampBox(r.box + 1);
    } else {
      r.wrong++;
      r.box = 0;
    }
    r.due = Date.now() + CONFIG.srsIntervalsMs[r.box];
    return r;
  }

  /** 到期条目（按逾期程度排序） */
  dueItems(ids, now = Date.now()) {
    const due = [];
    for (const id of ids) {
      const r = this.items.get(id);
      if (!r) { due.push({ id, overdue: Infinity, fresh: true }); continue; }
      if (r.due <= now) due.push({ id, overdue: now - r.due, fresh: false });
    }
    due.sort((a, b) => b.overdue - a.overdue);
    return due;
  }

  /** 新题（从未见过） */
  freshItems(ids) {
    return ids.filter(id => !this.items.has(id));
  }

  stats(ids) {
    let due = 0, learning = 0, mastered = 0, unseen = 0;
    const now = Date.now();
    for (const id of ids) {
      const r = this.items.get(id);
      if (!r) { unseen++; continue; }
      if (r.due <= now) due++;
      if (r.box >= 5) mastered++;
      else if (r.box > 0) learning++;
    }
    return { due, learning, mastered, unseen, total: ids.length };
  }
}

const clampBox = b => Math.max(0, Math.min(CONFIG.srsIntervalsMs.length - 1, Math.round(b) || 0));

/**
 * 批次编排：凑够 batchSize 题，按模式混合，标记星标题
 * 返回条目数组：[{ id, kind:'vocab'|'grammar', source, star }]
 */
export function buildBatch(bank, srs, opts = {}) {
  const {
    mode = 'mixed',          // 'vocab' | 'grammar' | 'mixed'
    includeNew = true,
    mix = bank.meta?.defaultMix?.vocab ?? CONFIG.vocabGrammarMix,
    size = CONFIG.batchSize,
    rng = Math.random,
    starRatio = bank.meta?.starRatio ?? CONFIG.starRatio,
  } = opts;

  const vocabIds = bank.vocab.map(v => v.id);
  const grammarIds = bank.grammar.map(g => g.id);

  // 按模式决定每类要多少
  let vWant = 0, gWant = 0;
  if (mode === 'vocab') { vWant = size; }
  else if (mode === 'grammar') { gWant = size; }
  else { vWant = Math.round(size * mix); gWant = size - vWant; }

  const picked = [];

  const takeFrom = (kind, pool, sourceList, want) => {
    if (want <= 0 || !pool.length) return;
    const due = srs.dueItems(pool).map(d => d.id);
    const fresh = srs.freshItems(pool);
    const chosen = [];

    // 1. 到期优先（逾期最久的先）
    for (const id of due) {
      if (chosen.length >= want) break;
      chosen.push(id);
    }

    // 2. 新题
    if (includeNew) {
      for (const id of shuffle(fresh, rng)) {
        if (chosen.length >= want) break;
        if (!chosen.includes(id)) chosen.push(id);
      }
    }

    // 3. 还不够 → 用最近要到期的补（循环）
    if (chosen.length < want) {
      const rest = pool.filter(id => !chosen.includes(id));
      const sorted = rest.sort((a, b) => (srs.get(a).due ?? 0) - (srs.get(b).due ?? 0));
      let i = 0;
      while (chosen.length < want && sorted.length) {
        chosen.push(sorted[i % sorted.length]);
        i++;
        if (i > want * 4) break;
      }
    }

    for (const id of chosen.slice(0, want)) {
      picked.push({ id, kind, source: sourceList.find(s => s.id === id) });
    }
  };

  takeFrom('vocab', vocabIds, bank.vocab, vWant);
  takeFrom('grammar', grammarIds, bank.grammar, gWant);

  // 交错排列，避免一整串同类
  const ordered = interleave(picked, rng);

  // 标记星标题：题库里 star:true 的优先，其余按比例随机
  return markStars(ordered, starRatio, rng);
}

function interleave(list, rng) {
  const v = list.filter(x => x.kind === 'vocab');
  const g = list.filter(x => x.kind === 'grammar');
  const out = [];
  // 按比例插入语法题
  const total = list.length;
  const gRatio = g.length / Math.max(1, total);
  let vi = 0, gi = 0;
  while (vi < v.length || gi < g.length) {
    if (gi < g.length && (vi >= v.length || rng() < gRatio * 1.4)) out.push(g[gi++]);
    else if (vi < v.length) out.push(v[vi++]);
    else out.push(g[gi++]);
  }
  return out;
}

function markStars(list, ratio, rng) {
  // 显式标记（题库里 star:true）的一定是星标题
  const explicit = new Set(list.filter(it => it.source?.star).map(it => it.id));

  // 其余按比例随机补足，但不超过总数
  const targetCount = Math.min(list.length, Math.round(list.length * ratio));
  const need = Math.max(0, targetCount - explicit.size);

  const candidates = shuffle(
    list.filter(it => !explicit.has(it.id)),
    rng
  ).slice(0, need);
  const extra = new Set(candidates.map(x => x.id));

  // 避免星标题连续出现：若两个星标题相邻，把后一个换成非星
  const stars = list.map(it => ({
    ...it,
    star: explicit.has(it.id) || extra.has(it.id),
  }));

  for (let i = 1; i < stars.length; i++) {
    if (stars[i].star && stars[i - 1].star) {
      // 只有随机的可以被降级，人工标记的保留
      if (!explicit.has(stars[i].id)) stars[i].star = false;
    }
  }
  return stars;
}
