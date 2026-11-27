// 校验语音资产：清单条目 ↔ 实际文件 ↔ 音色
//
// 用法：node tools/check-tts.mjs [bankId]
//
// 检查三件事：
//   1. manifest 每条指向的文件都真实存在
//   2. 文件数与清单条目数一致（不一致说明生成中途断过）
//   3. 音色必须是 Edge TTS（禁用 macOS say 的 Samantha / Alex）
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const TTS_ROOT = path.join(ROOT, 'data', 'tts');
const BANKS_ROOT = path.join(ROOT, 'data', 'banks');

const EDGE_VOICES = new Set(['en-US-AriaNeural', 'en-US-GuyNeural']);
const BANNED_VOICES = new Set(['Samantha', 'Alex', 'Daniel', 'Karen', 'Moira']);

const bankId = process.argv[2]
  || (await fs.readdir(BANKS_ROOT, { withFileTypes: true }))
    .filter(d => d.isDirectory()).map(d => d.name)[0];

const dir = path.join(TTS_ROOT, bankId);
const manifestPath = path.join(dir, 'manifest.json');

if (!existsSync(manifestPath)) {
  console.error(`✘ 缺少 ${path.relative(ROOT, manifestPath)}`);
  process.exit(1);
}

const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
const entries = Object.entries(manifest);

const missing = [];
const voices = new Map();
for (const [, e] of entries) {
  voices.set(e.voice, (voices.get(e.voice) || 0) + 1);
  if (!existsSync(path.join(TTS_ROOT, e.file))) missing.push(e.file);
}

const files = (await fs.readdir(dir)).filter(f => /\.(mp3|m4a)$/i.test(f));

const badVoices = [...voices.keys()].filter(v => BANNED_VOICES.has(v) || !EDGE_VOICES.has(v));

let ok = true;
console.log(`题库 ${bankId}：清单 ${entries.length} 条，文件 ${files.length} 个`);
console.log('音色分布：');
for (const [v, n] of voices) console.log(`  ${v}  ×${n}`);

if (missing.length) {
  ok = false;
  console.log(`\n✘ 清单指向但文件缺失：${missing.length} 个`);
  for (const f of missing.slice(0, 5)) console.log(`   ${f}`);
}
if (files.length > entries.length) {
  ok = false;
  console.log(`\n✘ 有 ${files.length - entries.length} 个文件不在清单里（旧引擎残留？）`);
}
if (badVoices.length) {
  ok = false;
  console.log(`\n✘ 音色不是 Edge TTS：${badVoices.join(', ')}`);
  console.log('   请用 node tools/gen-tts.mjs --force 重新生成（禁止 macOS say）');
}

console.log(ok ? '\n✔ 语音资产完整，且全部由 Edge TTS 生成' : '\n✘ 校验未通过');
process.exit(ok ? 0 : 1);
