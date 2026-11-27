// 题库加载与校验
import { CONFIG } from './config.js';

const BANK_BASE = 'data/banks';
const TTS_BASE = 'data/tts';

export async function loadBankList() {
  // 静态部署无法列目录，用索引文件；没有就用默认
  try {
    const res = await fetch(`${BANK_BASE}/index.json`, { cache: 'no-cache' });
    if (res.ok) return await res.json();
  } catch { /* ignore */ }
  return [{ id: 'cet4' }];
}

export async function loadBank(bankId) {
  const base = `${BANK_BASE}/${bankId}`;
  const [meta, vocab, grammar, ttsIndex] = await Promise.all([
    fetch(`${base}/bank.json`).then(r => r.json()),
    fetch(`${base}/vocab.json`).then(r => r.json()),
    fetch(`${base}/grammar.json`).then(r => r.json()).catch(() => []),
    loadTtsIndex(bankId),
  ]);

  const errors = [];
  const vocabOk = validateVocab(vocab, errors);
  const grammarOk = validateGrammar(grammar, errors);

  if (errors.length) {
    console.warn(`[bank:${bankId}] 校验问题：\n` + errors.join('\n'));
  }

  return {
    id: bankId,
    meta,
    vocab: vocabOk,
    grammar: grammarOk,
    tts: ttsIndex,        // { 文本 -> 文件相对路径 }
    errors,
  };
}

async function loadTtsIndex(bankId) {
  try {
    const res = await fetch(`${TTS_BASE}/${bankId}/manifest.json`, { cache: 'no-cache' });
    if (!res.ok) return new Map();
    const m = await res.json();
    const map = new Map();
    for (const key of Object.keys(m)) {
      const e = m[key];
      if (e?.text && e?.file) map.set(e.text.trim(), `${TTS_BASE}/${e.file}`);
    }
    return map;
  } catch {
    return new Map();
  }
}

function validateVocab(list, errors) {
  const seen = new Set();
  return (list || []).filter((v, i) => {
    if (!v || typeof v !== 'object') { errors.push(`vocab[${i}] 不是对象`); return false; }
    if (!v.id) { errors.push(`vocab[${i}] 缺少 id`); return false; }
    if (seen.has(v.id)) { errors.push(`vocab 重复 id: ${v.id}`); return false; }
    if (!v.word || !v.meaning) { errors.push(`vocab ${v.id} 缺少 word/meaning`); return false; }
    seen.add(v.id);
    return true;
  });
}

function validateGrammar(list, errors) {
  const seen = new Set();
  return (list || []).filter((g, i) => {
    if (!g || typeof g !== 'object') { errors.push(`grammar[${i}] 不是对象`); return false; }
    if (!g.id) { errors.push(`grammar[${i}] 缺少 id`); return false; }
    if (seen.has(g.id)) { errors.push(`grammar 重复 id: ${g.id}`); return false; }
    if (!g.prompt) { errors.push(`grammar ${g.id} 缺少 prompt`); return false; }
    if (!Array.isArray(g.options) || g.options.length !== CONFIG.lanes) {
      errors.push(`grammar ${g.id} 选项数必须为 ${CONFIG.lanes}`);
      return false;
    }
    if (!Number.isInteger(g.answer) || g.answer < 0 || g.answer >= g.options.length) {
      errors.push(`grammar ${g.id} answer 下标非法`);
      return false;
    }
    seen.add(g.id);
    return true;
  });
}

/** 按文本查音频 */
export function ttsUrlFor(bank, text) {
  if (!text) return null;
  return bank.tts.get(String(text).trim()) || null;
}
