// 生成读音资产：遍历题库，把需要朗读的文本合成成 m4a，写 manifest.json
//
// 引擎：
//   macos  —— macOS 内置 say（默认，离线可用，质量好）
//   edge   —— Edge TTS（需要能访问微软服务；本环境 403，留作以后切换）
//
// 用法：
//   node tools/gen-tts.mjs                # 增量生成当前题库缺失的音频
//   node tools/gen-tts.mjs --force        # 全部重生成
//   node tools/gen-tts.mjs --engine edge  # 切 Edge TTS
//
// 缓存键 = sha1(音色 + 语速 + 文本)，同一句跨题库复用。

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
  || 'macos';
const CONCURRENCY = 4;

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
function collectTexts(vocab, grammar) {
  const items = [];
  const add = (kind, voiceRole, text) => {
    if (!text || !String(text).trim()) return;
    items.push({ kind, voiceRole, text: String(text).trim() });
  };

  for (const v of vocab) {
    add('word', 'word', v.word);
    if (v.sentence) add('sentence', 'sentence', v.sentence);
  }
  for (const g of grammar) {
    // 题干：把空格念成短暂停顿（say 用逗号近似），答后念完整正确句
    if (g.prompt) add('sentence', 'sentence', g.prompt.replace(/_{2,}/g, ', '));
    const correct = fillPrompt(g.prompt, g.options[g.answer]);
    add('sentence', 'sentence', correct);
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

function fillPrompt(prompt, answer) {
  return prompt.replace(/_{2,}/g, ` ${answer} `).replace(/\s+/g, ' ').trim();
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

let edgeTtsMod = null;
async function synthEdge(voice, text, destFile) {
  if (!edgeTtsMod) {
    const p = path.join(ROOT, 'tools', 'node_modules', 'edge-tts', 'out', 'index.js');
    if (!existsSync(p)) {
      throw new Error('未安装 edge-tts。请在 tools/ 下执行：npm install edge-tts');
    }
    edgeTtsMod = await import(p);
  }
  await edgeTtsMod.ttsSave(text, destFile, { voice, rate: '-8%' });
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
    const grammar = await readJson('grammar.json', []);
    const items = collectTexts(vocab, grammar);

    const outDir = path.join(TTS_ROOT, bankId);
    await fs.mkdir(outDir, { recursive: true });

    const manifestPath = path.join(outDir, 'manifest.json');
    const manifest = existsSync(manifestPath)
      ? JSON.parse(await fs.readFile(manifestPath, 'utf8'))
      : {};

    const ext = ENGINE === 'macos' ? '.m4a' : '.mp3';
    const voices = VOICES[ENGINE];

    const todo = [];
    for (const it of items) {
      const voice = voices[it.voiceRole];
      const key = textKey(voice, it.text);
      const file = key + ext;
      const rel = `${bankId}/${file}`;
      const abs = path.join(TTS_ROOT, rel);

      manifest[key] = { file: rel, text: it.text, voice, kind: it.kind };

      if (!FORCE && existsSync(abs)) { totalSkip++; continue; }
      todo.push({ voice, text: it.text, abs, file });
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
