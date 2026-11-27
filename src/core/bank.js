// 题库加载与校验

const BANK_BASE = 'data/banks';
const TTS_BASE = 'data/tts';

export async function loadBankList() {
  // 静态部署无法列目录，用索引文件；没有就用默认
  try {
    const res = await fetch(`${BANK_BASE}/index.json`, { cache: 'no-cache' });
    if (res.ok) return await res.json();
  } catch { /* ignore */ }
  return [{ id: 'zhongkao' }];
}

export async function loadBank(bankId) {
  const base = `${BANK_BASE}/${bankId}`;
  const [meta, vocab, ttsIndex] = await Promise.all([
    fetch(`${base}/bank.json`).then(r => r.json()),
    fetch(`${base}/vocab.json`).then(r => r.json()),
    loadTtsIndex(bankId),
  ]);

  const errors = [];
  const vocabOk = validateVocab(vocab, errors);

  if (errors.length) {
    console.warn(`[bank:${bankId}] 校验问题：\n` + errors.join('\n'));
  }

  return {
    id: bankId,
    meta,
    vocab: vocabOk,
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

/** 按文本查音频 */
export function ttsUrlFor(bank, text) {
  if (!text) return null;
  return bank.tts.get(String(text).trim()) || null;
}
