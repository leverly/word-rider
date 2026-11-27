// 生成读音资产：遍历题库，把需要朗读的文本合成成 mp3，写 manifest.json
//
// 引擎：
//   edge   —— Edge TTS（默认，必须用它。音色 en-US-AriaNeural / en-US-GuyNeural）
//   macos  —— macOS 内置 say。仅作应急开关，产物不算交付，禁止默认使用。
//
// 用法：
//   node tools/gen-tts.mjs                  # 增量生成当前题库缺失的音频（Edge）
//   node tools/gen-tts.mjs --force          # 全部重生成（Edge）
//   node tools/gen-tts.mjs --engine macos   # 应急：用系统 say
//
// 缓存键 = sha1(引擎 + 音色 + 文本)，同一句跨题库复用。
// 注意：Edge TTS 依赖 tools/node_modules/msedge-tts（带 Sec-MS-GEC v2 签名）。
// 旧的 edge-tts 包缺签名会稳定 403，不要退回它。

import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const BANKS_DIR = path.join(ROOT, 'data', 'banks');
const TTS_ROOT = path.join(ROOT, 'data', 'tts');

const args = process.argv.slice(2);
const FORCE = args.includes('--force');
const ENGINE = (args.find(a => a.startsWith('--engine='))?.split('=')[1])
  || (args.includes('--engine') ? args[args.indexOf('--engine') + 1] : null)
  || 'edge';
const CONCURRENCY = 3;

// 音色配置：单词用女声清晰，句子用男声略慢
const VOICES = {
  macos: { word: 'Samantha', sentence: 'Alex' },
  edge: { word: 'en-US-AriaNeural', sentence: 'en-US-GuyNeural' },
};

const LETTERS = ['A', 'B', 'C', 'D'];

function textKey(voice, text) {
  return createHash('sha1').update(`${ENGINE}|${voice}|${text}`).digest('hex').slice(0, 16);
}

/* ── 需要朗读的文本清单 ── */
function collectTexts(vocab) {
  const items = [];
  const add = (kind, voiceRole, text) => {
    if (!text || !String(text).trim()) return;
    items.push({ kind, voiceRole, text: String(text).trim() });
  };

  for (const v of vocab) {
    add('word', 'word', v.word);
    if (v.sentence) add('sentence', 'sentence', v.sentence);
  }

  // 去重
  const seen = new Set();
  return items.filter(it => {
    const k = `${it.voiceRole}|${it.text}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/* ── 合成器 ── */
function run(cmd, argv) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, argv, { stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    p.stderr.on('data', d => (err += d));
    p.on('error', reject);
    p.on('close', code => (code === 0 ? resolve() : reject(new Error(`${cmd} exit ${code}: ${err.slice(0, 300)}`))));
  });
}

async function synthMacos(voice, text, destM4a) {
  const rate = voice === VOICES.macos.sentence ? 165 : 150;
  // say 直接输出 m4a（需 --file-format 与 --data-format）
  await run('say', [
    '-v', voice,
    '-r', String(rate),
    '-o', destM4a,
    '--file-format=m4af',
    '--data-format=aac',
    text,
  ]);
}

let edgeMod = null;
async function synthEdge(voice, text, destFile) {
  if (!edgeMod) {
    const p = path.join(ROOT, 'tools', 'node_modules', 'msedge-tts', 'dist', 'index.js');
    if (!existsSync(p)) {
      throw new Error('未安装 msedge-tts。请在 tools/ 下执行：npm install msedge-tts');
    }
    edgeMod = await import(p);
  }
  const { MsEdgeTTS, OUTPUT_FORMAT } = edgeMod;
  const tts = new MsEdgeTTS();
  try {
    await tts.setMetadata(voice, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);
    const { audioStream } = tts.toStream(text);
    const chunks = [];
    await new Promise((resolve, reject) => {
      // 单条硬超时：websocket 偶尔静默挂住，不设上限会拖死整批
      const guard = setTimeout(() => reject(new Error(`edge-tts 超时: ${text.slice(0, 40)}`)), 25000);
      audioStream.on('data', c => chunks.push(c));
      audioStream.on('end', () => { clearTimeout(guard); resolve(); });
      audioStream.on('error', e => { clearTimeout(guard); reject(e); });
    });
    const buf = Buffer.concat(chunks);
    if (!buf.length) throw new Error(`edge-tts 返回空音频: ${text.slice(0, 40)}`);
    await fs.writeFile(destFile, buf);
  } finally {
    // 必须显式关连接，否则超时/异常的 socket 会留下句柄让进程无法退出
    try { tts.close(); } catch { /* ignore */ }
  }
}

/* ── 主流程 ── */
async function main() {
  const bankDirs = (await fs.readdir(BANKS_DIR, { withFileTypes: true }))
    .filter(d => d.isDirectory())
    .map(d => d.name);

  if (!bankDirs.length) throw new Error('data/banks 下没有题库');

  console.log(`引擎：${ENGINE}   并发：${CONCURRENCY}`);

  let totalNew = 0;
  let totalSkip = 0;

  for (const bankId of bankDirs) {
    const bankDir = path.join(BANKS_DIR, bankId);
    const readJson = async (f, fallback) => {
      const p = path.join(bankDir, f);
      if (!existsSync(p)) return fallback;
      return JSON.parse(await fs.readFile(p, 'utf8'));
    };

    const vocab = await readJson('vocab.json', []);
    const items = collectTexts(vocab);

    const outDir = path.join(TTS_ROOT, bankId);
    await fs.mkdir(outDir, { recursive: true });

    const manifestPath = path.join(outDir, 'manifest.json');
    // 按当前题库的文本 + 当前引擎重建清单，旧引擎（如 macos）的条目自然被淘汰
    const manifest = {};

    const ext = ENGINE === 'macos' ? '.m4a' : '.mp3';
    const voices = VOICES[ENGINE];

    const todo = [];
    for (const it of items) {
      const voice = voices[it.voiceRole];
      const key = textKey(voice, it.text);
      const file = key + ext;
      const rel = `${bankId}/${file}`;
      const abs = path.join(TTS_ROOT, rel);

      if (!FORCE && existsSync(abs)) {
        // 只有音频真实存在才登记，避免清单指向还没生成的文件
        manifest[key] = { file: rel, text: it.text, voice, kind: it.kind };
        totalSkip++;
        continue;
      }
      todo.push({ key, voice, text: it.text, abs, file, rel, kind: it.kind });
    }

    // 并发合成
    const total = todo.length;
    let done = 0, ok = 0;
    const failures = [];
    const queue = [...todo];
    async function worker() {
      while (queue.length) {
        const job = queue.shift();
        try {
          if (ENGINE === 'macos') await synthMacos(job.voice, job.text, job.abs);
          else await synthEdge(job.voice, job.text, job.abs);
          // 成功后才登记进清单
          manifest[job.key] = { file: job.rel, text: job.text, voice: job.voice, kind: job.kind };
          ok++;
        } catch (e) {
          failures.push({ text: job.text, error: e.message });
        } finally {
          done++;
          if (process.stdout.isTTY) process.stdout.write(`\r  ${bankId}: ${done}/${total}  `);
        }
      }
    }
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, total) }, () => worker()));
    if (total) process.stdout.write('\n');

    await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');

    totalNew += ok;
    console.log(`  ${bankId}: 新增 ${ok} 条，复用 ${totalSkip} 条，失败 ${failures.length} 条`);

    if (failures.length) {
      for (const f of failures.slice(0, 5)) console.log(`    ✘ ${f.text.slice(0, 50)} — ${f.error}`);
    }
  }

  console.log(`\n✔ 完成：新增 ${totalNew} 条音频 → data/tts/`);
}

main().catch(e => { console.error('✘ ' + e.message); process.exit(1); });
