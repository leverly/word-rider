// 生成题库：从 ECDICT 抽「中考」词，补齐标准 IPA 音标与中英例句
//
// 数据来源（全部开放授权）：
//   ECDICT        https://github.com/skywind3000/ECDICT         word / translation / tag(zk) / frq
//   ipa-dict      https://github.com/open-dict-data/ipa-dict    en_UK 标准 IPA 音标
//   Tatoeba       https://tatoeba.org                          中英对照例句
//
// 用法：
//   node tools/gen-bank.mjs                 # 用缓存，缺文件则下载
//   node tools/gen-bank.mjs --refresh       # 强制重新下载源数据
//
// 产物：data/banks/zhongkao/{bank.json,vocab.json}
// 下载缓存放在 .cache/bank-src/（不进仓库）

import fs from 'node:fs/promises';
import { existsSync, createWriteStream } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { execFile } from 'node:child_process';
import { pipeline } from 'node:stream/promises';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const CACHE = path.join(ROOT, '.cache', 'bank-src');
const OUT_DIR = path.join(ROOT, 'data', 'banks', 'zhongkao');

const REFRESH = process.argv.includes('--refresh');
const BANK_ID = 'zhongkao';

const SOURCES = {
  ecdict: {
    url: 'https://raw.githubusercontent.com/skywind3000/ECDICT/master/ecdict.csv',
    file: 'ecdict.csv',
  },
  ipaUk: {
    url: 'https://raw.githubusercontent.com/open-dict-data/ipa-dict/master/data/en_UK.txt',
    file: 'en_UK.txt',
  },
  ipaUs: {
    url: 'https://raw.githubusercontent.com/open-dict-data/ipa-dict/master/data/en_US.txt',
    file: 'en_US.txt',
  },
  links: {
    url: 'https://downloads.tatoeba.org/exports/per_language/eng/eng-cmn_links.tsv.bz2',
    file: 'eng-cmn_links.tsv',
    bz2: true,
  },
  cmnSentences: {
    url: 'https://downloads.tatoeba.org/exports/per_language/cmn/cmn_sentences.tsv.bz2',
    file: 'cmn_sentences.tsv',
    bz2: true,
  },
  engSentences: {
    url: 'https://downloads.tatoeba.org/exports/per_language/eng/eng_sentences.tsv.bz2',
    file: 'eng_sentences.tsv',
    bz2: true,
  },
};

/* ── 下载 ── */

async function download(url, dest) {
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`);
  await pipeline(res.body, createWriteStream(dest));
}

async function ensureSource(key) {
  const s = SOURCES[key];
  const finalPath = path.join(CACHE, s.file);
  if (existsSync(finalPath) && !REFRESH) return finalPath;

  await fs.mkdir(CACHE, { recursive: true });
  if (!s.bz2) {
    console.log(`  ↓ ${s.file}`);
    await download(s.url, finalPath);
    return finalPath;
  }

  const bz2Path = finalPath + '.bz2';
  console.log(`  ↓ ${path.basename(bz2Path)}（较大，稍等）`);
  await download(s.url, bz2Path);
  console.log(`  ⇢ 解压 ${s.file}`);
  await execFileAsync('bunzip2', ['-f', bz2Path]);
  return finalPath;
}

/* ── CSV 解析（ECDICT 用字面 \n 表示换行，无引号内真换行） ── */

function parseCsvLine(line) {
  const out = [];
  let cur = '';
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      if (inQ && line[i + 1] === '"') { cur += '"'; i++; }
      else inQ = !inQ;
    } else if (c === ',' && !inQ) {
      out.push(cur); cur = '';
    } else cur += c;
  }
  out.push(cur);
  return out;
}

/* ── 释义清洗 ── */

// ECDICT 的领域/专业标注，中考用不上
const DOMAIN_RE = /^\s*\[[^\]]{1,8}\]/;

const POS_ZH = {
  n: 'n', v: 'v', vt: 'vt', vi: 'vi', a: 'adj', adj: 'adj', ad: 'adv', adv: 'adv',
  prep: 'prep', conj: 'conj', pron: 'pron', num: 'num', art: 'art', int: 'int',
  aux: 'aux', abbr: 'abbr', pl: 'n', det: 'det',
};

/**
 * 把 ECDICT 的 translation 拆成结构化的释义。
 * 输入形如："n. 能力, 才干\n[经] 能力, 才能"
 * 输出 { pos, meaning, senses:[{pos, zh}] }
 */
function cleanTranslation(raw) {
  if (!raw) return null;
  const lines = String(raw)
    .replace(/\\r\\n|\\n|\\r/g, '\n')   // ECDICT 里是字面 \n
    .split('\n')
    .map(s => s.trim())
    .filter(Boolean)
    .filter(s => !DOMAIN_RE.test(s));   // 丢掉 [经] [医] [计] 这类

  const senses = [];
  for (const line of lines) {
    // 词性前缀：n. / vt. / adj. / a. / prep. 等
    const m = line.match(/^([a-zA-Z]{1,5})\.\s*(.+)$/);
    const pos = m ? (POS_ZH[m[1].toLowerCase()] || m[1].toLowerCase()) : '';
    const body = m ? m[2] : line;
    // 同一词性多义用 , 分隔，取前三义；义项里夹的 [计] [化] 这类标注要剔掉
    let zh = body
      .replace(/\[[^\]]{1,10}\]/g, '')
      .split(/[,，;；]/)
      .map(s => s.trim())
      .filter(s => s && s !== '...' && s !== '…')
      .slice(0, 2)
      .join('；');
    // 去掉「run的过去式…」这类词形说明，中考释义用不到
    if (!zh || /的(过去式|过去分词|现在分词|复数|比较级|最高级)/.test(zh)) continue;
    if (zh) senses.push({ pos, zh });
  }
  if (!senses.length) return null;

  // 跨词性会重复同一批义项（run: n.跑/赛跑 + vi.跑/奔跑），按义项去重
  const seenZh = new Set();
  const unique = [];
  for (const s of senses) {
    const parts = s.zh.split('；').filter(p => p && !seenZh.has(p));
    if (!parts.length) continue;
    parts.forEach(p => seenZh.add(p));
    unique.push({ pos: s.pos, zh: parts.join('；') });
  }
  if (!unique.length) return null;

  // 主词性取第一个义项的；主释义最多两个义项、总长压到门牌能显示的范围内
  const pos = unique[0].pos || '';
  const meaning = unique.slice(0, 2).map(s => s.zh).join('；').slice(0, 30);
  return { pos, meaning, senses: unique };
}

/* ── 简体化 ──
   Tatoeba 的中文句混有繁体（「義大利是很美麗的國家」）。
   没有 OpenCC 依赖，这里用一张覆盖中考例句常见字的映射表；
   同时把「残留繁体字」作为例句打分的扣分项，优先选简体。 */
const T2S = {
  來: '来', 個: '个', 們: '们', 備: '备', 兩: '两', 劃: '划', 動: '动', 務: '务', 員: '员', 問: '问',
  噹: '当', 國: '国', 園: '园', 圓: '圆', 圖: '图', 團: '团', 型: '型', 執: '执', 場: '场', 塊: '块',
  壞: '坏', 夠: '够', 夢: '梦', 媽: '妈', 學: '学', 實: '实', 寫: '写', 對: '对', 師: '师', 帶: '带',
  幣: '币', 幫: '帮', 幾: '几', 張: '张', 後: '后', 從: '从', 愛: '爱', 憶: '忆', 應: '应', 戲: '戏',
  於: '于', 時: '时', 書: '书', 會: '会', 東: '东', 構: '构', 樂: '乐', 樣: '样', 機: '机', 檔: '档',
  檢: '检', 歡: '欢', 歲: '岁', 歷: '历', 氣: '气', 測: '测', 準: '准', 溫: '温', 為: '为', 熱: '热',
  燈: '灯', 爺: '爷', 現: '现', 產: '产', 畫: '画', 當: '当', 發: '发', 碼: '码', 種: '种', 節: '节',
  級: '级', 給: '给', 統: '统', 經: '经', 網: '网', 線: '线', 總: '统', 義: '义', 聽: '听', 臺: '台',
  與: '与', 興: '兴', 藥: '药', 處: '处', 號: '号', 裝: '装', 裡: '里', 見: '见', 視: '视', 親: '亲',
  覺: '觉', 計: '计', 記: '记', 詞: '词', 試: '试', 話: '话', 該: '该', 認: '认', 說: '说', 誰: '谁',
  請: '请', 講: '讲', 識: '识', 護: '护', 讀: '读', 變: '变', 讓: '让', 豐: '丰', 貓: '猫', 買: '买',
  費: '费', 賣: '卖', 質: '质', 車: '车', 辦: '办', 這: '这', 週: '周', 進: '进', 遊: '游', 運: '运',
  過: '过', 遠: '远', 適: '适', 選: '选', 還: '还', 邊: '边', 醫: '医', 銀: '银', 錢: '钱', 鐵: '铁',
  長: '长', 開: '开', 關: '关', 陰: '阴', 陽: '阳', 隊: '队', 際: '际', 隻: '只', 雙: '双', 雞: '鸡',
  難: '难', 雲: '云', 電: '电', 頁: '页', 頭: '头', 題: '题', 類: '类', 風: '风', 颱: '台', 飯: '饭',
  餅: '饼', 馬: '马', 驗: '验', 體: '体', 魚: '鱼', 鳥: '鸟', 麗: '丽', 麵: '面', 麼: '么', 點: '点',
  齋: '斋', 齣: '出',
}

// 拼音/符号之外的非简中判定，用于给例句打分
const TRAD_HINT = new Set(Object.keys(T2S));

function toSimplified(s) {
  let out = '';
  let changed = 0;
  for (const ch of String(s)) {
    const t = T2S[ch];
    if (t) { out += t; changed++; } else out += ch;
  }
  return { text: out, changed };
}

/* ── 出题可用性过滤 ──
   跑酷玩法是「四选一选释义」。纯虚词（a / of / to / if）释义无法互斥区分，
   选义题会退化成猜；单字母与缩写同样不适合。这些词保留在词表里没有意义，
   直接不进题库。 */
const STOPWORD_ONLY = new Set([
  // 冠词 / 助动词 / 系动词
  'a', 'an', 'the', 'be', 'is', 'am', 'are', 'was', 'were', 'do', 'does', 'did',
  // 代词
  'i', 'you', 'he', 'she', 'it', 'its', 'we', 'us', 'me', 'my', 'your',
  'they', 'them', 'this', 'that', 'these', 'those',
  // 高频介词与连词：释义无法在四选一里互斥区分
  'of', 'to', 'in', 'on', 'at', 'by', 'for', 'with', 'as', 'from', 'about',
  'if', 'or', 'and', 'but', 'so', 'no', 'not', 'up', 'out', 'off', 'than',
]);

function isPlayable(word, meaning) {
  const w = String(word || '').trim();
  if (w.length < 3) return false;                        // 单字母 / 双字母
  if (!/^[a-zA-Z][a-zA-Z' -]*$/.test(w)) return false;    // 含数字符号（CD-ROM）
  if (w === w.toUpperCase() && w.length > 1) return false; // 全大写缩写（CD / TV / DVD）
  if (STOPWORD_ONLY.has(w.toLowerCase())) return false;
  if (!meaning || meaning.length < 2) return false;
  return true;
}

/* ── 音标 ──
   用 ipa-dict 的 en_UK：元音正确（有 ʌ），但重音标记被放在「重读元音」前面，
   而不是音节开头（beautiful → /bjˈuːtɪfəl/，应为 /ˈbjuːtɪfəl/）。
   下面把每个重音符号左移到它所在音节的起始辅音之前。 */

const IPA_VOWELS = new Set([
  'i', 'ɪ', 'e', 'ɛ', 'æ', 'a', 'ɑ', 'ɒ', 'ɔ', 'o', 'ʊ', 'u', 'ʌ', 'ə', 'ɜ', 'ɐ',
  'ɚ', 'ɝ', 'ᵻ', 'ɵ', 'œ', 'ø', 'y', 'ɨ', 'ʉ', 'ɘ', 'ɯ', 'ɤ', 'ː', 'ˑ',
]);
const IPA_SEP = new Set(['.', '-', '‿', ' ', '̯', '̃']);

// 英语合法的多辅音起首
const ONSET2 = new Set([
  'pr', 'br', 'tr', 'dr', 'kr', 'gr', 'fr', 'vr', 'θr', 'ðr', 'ʃr',
  'pl', 'bl', 'kl', 'gl', 'fl', 'sl',
  'sp', 'st', 'sk', 'sm', 'sn', 'sw', 'sv',
  'tw', 'dw', 'kw', 'gw', 'θw', 'hw', 'ðw',
  'pj', 'bj', 'tj', 'dj', 'kj', 'gj', 'mj', 'nj', 'fj', 'vj', 'hj', 'lj', 'rj', 'sj', 'zj',
]);
const ONSET3 = new Set(['spr', 'str', 'skr', 'spl', 'skl', 'skw', 'spj', 'stj', 'skj', 'smj', 'sfl']);

function isValidOnset(cluster) {
  if (!cluster) return false;
  if (cluster.length === 1) return !IPA_VOWELS.has(cluster) && cluster !== 'ŋ';
  if (cluster.length === 2) return ONSET2.has(cluster);
  if (cluster.length === 3) return ONSET3.has(cluster);
  return false;
}

const STRESS_MARKS = new Set(['ˈ', 'ˌ']);

function fixStress(body) {
  const stripped = [];
  const marks = [];
  for (const ch of body) {
    if (STRESS_MARKS.has(ch)) marks.push({ at: stripped.length, mark: ch });
    else stripped.push(ch);
  }
  if (!marks.length) return body;

  const placed = marks.map(m => {
    // 从标记处左移，跨过起首辅音簇，停在元音/分隔符
    let j = m.at - 1;
    while (j >= 0 && !IPA_VOWELS.has(stripped[j]) && !IPA_SEP.has(stripped[j])) j--;
    const cluster = stripped.slice(j + 1, m.at).join('');
    // 取最长的合法起首（最大音节首原则）
    let k = 0;
    for (let len = Math.min(3, cluster.length); len >= 1; len--) {
      if (isValidOnset(cluster.slice(cluster.length - len))) { k = len; break; }
    }
    return { at: m.at - k, mark: m.mark };
  });

  const out = [...stripped];
  placed.sort((a, b) => a.at - b.at);
  for (let i = placed.length - 1; i >= 0; i--) out.splice(placed[i].at, 0, placed[i].mark);
  return out.join('');
}

function normalizeIpa(s) {
  let v = String(s || '').trim();
  // ipa-dict 有多读音，用 ", " 分隔；只取第一个
  if (v.includes(',')) v = v.split(',')[0].trim();
  v = v.replace(/^\/+|\/+$/g, '').trim();
  if (!v) return '';
  v = v.replace(/ɡ/g, 'g');   // U+0261 → 普通 g，避免缺字
  v = v.replace(/ɹ/g, 'r');   // ɹ → r，中考教材习惯
  v = v.replace(/ɐ/g, 'ə');   // ɐ 是库里的词尾弱化音，统一写成 ə
  // 源库的次级重音位置污染严重（accent → /ˈæˌksɛnt/、address → /ˈæˌdrɛs/），
  // 中考阶段只需要主重音，去掉 ˈˌ 里的次级标记更不容易记错
  v = v.replace(/ˌ/g, '');
  v = fixStress(v);
  return `/${v}/`;
}

/* ── 主流程 ── */

async function main() {
  console.log('▶ 准备源数据');
  const ecdictPath = await ensureSource('ecdict');
  const ipaPath = await ensureSource('ipaUk');
  console.log('▶ 解析 ECDICT（约 77 万条，稍等）');

  // 1. 抽 zk 词条
  const entries = [];
  const rl = createInterface({ input: createReadStream(ecdictPath, 'utf8'), crlfDelay: Infinity });
  let header = null;
  for await (const line of rl) {
    if (!line) continue;
    if (!header) { header = parseCsvLine(line); continue; }
    const cols = parseCsvLine(line);
    const rec = {};
    for (let i = 0; i < header.length; i++) rec[header[i]] = cols[i] ?? '';
    const tags = (rec.tag || '').split(/\s+/).filter(Boolean);
    if (!tags.includes('zk')) continue;

    const word = (rec.word || '').trim();
    if (!word) continue;
    const cleaned = cleanTranslation(rec.translation);
    if (!cleaned) continue;
    if (!isPlayable(word, cleaned.meaning)) continue;

    entries.push({
      word,
      frq: Number(rec.frq) || 0,
      collins: Number(rec.collins) || 0,
      oxford: Number(rec.oxford) || 0,
      ...cleaned,
      tags,
    });
  }
  console.log(`  zk 词条（释义可解析）：${entries.length}`);

  // 2. 音标（UK 为主：元音准确；UK 缺的用 US 补）
  const ipaMap = new Map();
  const irl = createInterface({ input: createReadStream(ipaPath, 'utf8'), crlfDelay: Infinity });
  for await (const line of irl) {
    const p = line.split('\t');
    if (p.length === 2 && p[0] && p[1]) ipaMap.set(p[0].toLowerCase(), p[1]);
  }
  console.log(`  音标库(UK)：${ipaMap.size} 条`);

  const ipaFallback = new Map();
  const usPath = await ensureSource('ipaUs');
  const usrl = createInterface({ input: createReadStream(usPath, 'utf8'), crlfDelay: Infinity });
  for await (const line of usrl) {
    const p = line.split('\t');
    if (p.length === 2 && p[0] && p[1]) ipaFallback.set(p[0].toLowerCase(), p[1]);
  }
  console.log(`  音标库(US 兜底)：${ipaFallback.size} 条`);

  // 3. 例句：需要英中对照
  console.log('▶ 解析 Tatoeba 例句');
  const linksPath = await ensureSource('links');
  const cmnPath = await ensureSource('cmnSentences');
  const engPath = await ensureSource('engSentences');

  const cmn = new Map();
  for await (const line of createInterface({ input: createReadStream(cmnPath, 'utf8'), crlfDelay: Infinity })) {
    const p = line.split('\t');
    if (p.length >= 3) cmn.set(p[0], p[2]);
  }
  const eng2cmn = new Map();
  for await (const line of createInterface({ input: createReadStream(linksPath, 'utf8'), crlfDelay: Infinity })) {
    const p = line.split('\t');
    if (p.length >= 2) {
      if (!eng2cmn.has(p[0])) eng2cmn.set(p[0], []);
      eng2cmn.get(p[0]).push(p[1]);
    }
  }
  console.log(`  中文句 ${cmn.size}，对照对 ${eng2cmn.size}`);

  // 只在需要时扫英文句（2M 行，挑候选）
  const want = new Set(entries.map(e => e.word.toLowerCase()));
  const candidates = new Map();   // word -> [{ en, zh, score }]
  for await (const line of createInterface({ input: createReadStream(engPath, 'utf8'), crlfDelay: Infinity })) {
    const p = line.split('\t');
    if (p.length < 3) continue;
    const [, , txt] = p;
    if (!txt || txt.length > 90) continue;
    const words = new Set(txt.toLowerCase().match(/[a-z']+/g) || []);
    let touched = false;
    for (const w of words) if (want.has(w)) { touched = true; break; }
    if (!touched) continue;
    const n = txt.split(/\s+/).length;
    if (n < 3 || n > 12) continue;

    const zhs = eng2cmn.get(p[0]);
    if (!zhs) continue;
    let zh = null;
    for (const cid of zhs) {
      const z = cmn.get(cid);
      if (z && z.length < 40 && /[\u4e00-\u9fff]/.test(z)) { zh = z; break; }
    }
    if (!zh) continue;
    const conv = toSimplified(zh);

    for (const w of words) {
      if (!want.has(w)) continue;
      if (!new RegExp(`\\b${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(txt)) continue;
      const list = candidates.get(w) || [];
      if (list.length < 12) {
        // 越接近 6-9 词的句子越适合做例句
        let score = Math.abs(n - 7);
        score += conv.changed * 4;                       // 需转换的繁体字越多越差
        if (/[a-zA-Z]/.test(conv.text)) score += 3;      // 中文里混英文（CEO 之类）
        if (/公司|总裁|執行長|执行长|股份|CEO|合同|律师|股票/.test(txt + conv.text)) score += 6;  // 成人语境
        list.push({ en: txt, zh: conv.text, score });
        candidates.set(w, list);
      }
    }
  }
  console.log(`  有中英例句的词：${candidates.size}`);

  // 4. 组装词条
  const seen = new Set();
  const vocab = [];
  for (const e of entries) {
    const key = e.word.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);

    const ipa = ipaMap.get(key) || ipaFallback.get(key);
    const cands = (candidates.get(key) || []).sort((a, b) => a.score - b.score);
    const best = cands[0];

    vocab.push({
      id: `w-${key.replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`,
      word: e.word,
      phonetic: ipa ? normalizeIpa(ipa) : '',
      pos: e.pos,
      meaning: e.meaning,
      senses: e.senses,
      sentence: best ? best.en : '',
      sentence_cn: best ? best.zh : '',
      frq: e.frq,
    });
  }

  // 5. 按词频分三档（frq 越小越高频；0 表示词表外，归入最易档）
  const ranked = [...vocab].sort((a, b) => {
    const fa = a.frq > 0 ? a.frq : 999999;
    const fb = b.frq > 0 ? b.frq : 999999;
    return fa - fb;
  });
  const n = ranked.length;
  const t1 = Math.round(n / 3);
  const t2 = Math.round((n * 2) / 3);
  ranked.forEach((v, i) => {
    v.rank = i + 1;
    v.group = i < t1 ? 'unit-01' : i < t2 ? 'unit-02' : 'unit-03';
  });

  // 6. 输出（按字母序存，便于人工查阅；游戏内按 group 排序）
  vocab.sort((a, b) => a.word.toLowerCase().localeCompare(b.word.toLowerCase()));

  const meta = {
    id: BANK_ID,
    name: '北京中考英语 · 课标词汇',
    lang: 'en',
    starRatio: 0.2,
    tiers: {
      'unit-01': { name: '核心高频', count: ranked.filter(v => v.group === 'unit-01').length },
      'unit-02': { name: '常用词', count: ranked.filter(v => v.group === 'unit-02').length },
      'unit-03': { name: '拓展词', count: ranked.filter(v => v.group === 'unit-03').length },
    },
    source: {
      words: 'ECDICT (tag=zk 中考) — MIT',
      phonetic: 'ipa-dict en_UK 为主 / en_US 兜底 — CC BY-SA',
      sentences: 'Tatoeba 中英对照 — CC BY 2.0 FR',
    },
  };

  await fs.mkdir(OUT_DIR, { recursive: true });
  await fs.writeFile(path.join(OUT_DIR, 'bank.json'), JSON.stringify(meta, null, 2) + '\n', 'utf8');
  await fs.writeFile(path.join(OUT_DIR, 'vocab.json'), JSON.stringify(vocab, null, 0) + '\n', 'utf8');

  const withPh = vocab.filter(v => v.phonetic).length;
  const withEx = vocab.filter(v => v.sentence).length;
  console.log(`\n✔ ${vocab.length} 词 → data/banks/${BANK_ID}/`);
  console.log(`  音标 ${withPh} (${((withPh / vocab.length) * 100).toFixed(1)}%)  例句 ${withEx} (${((withEx / vocab.length) * 100).toFixed(1)}%)`);
  console.log(`  分档：核心高频 ${meta.tiers['unit-01'].count} / 常用 ${meta.tiers['unit-02'].count} / 拓展 ${meta.tiers['unit-03'].count}`);
  const avgLen = vocab.reduce((s, v) => s + v.word.length, 0) / vocab.length;
  console.log(`  平均词长 ${avgLen.toFixed(2)}`);
}

main().catch(e => { console.error('生成失败：', e.message); process.exit(1); });
