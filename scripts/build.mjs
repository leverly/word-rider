// 构建：把 src/ 编译成可直接部署的静态站点 app/
// - 拷贝 src 下所有文件到 app/
// - 拷贝 three.js 及用到的 addons 到 app/vendor/three/
// - 生成 data/ 索引（题库与语音清单）
import { readFile, writeFile, mkdir, copyFile, readdir, stat, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'src');
const APP = join(ROOT, 'app');
const THREE_DIR = join(ROOT, 'node_modules', 'three');

const ADDON_FILES = [
  'postprocessing/EffectComposer.js',
  'postprocessing/RenderPass.js',
  'postprocessing/ShaderPass.js',
  'postprocessing/MaskPass.js',
  'postprocessing/UnrealBloomPass.js',
  'postprocessing/OutputPass.js',
  'postprocessing/SMAAPass.js',
  'postprocessing/Pass.js',
  'shaders/CopyShader.js',
  'shaders/LuminosityHighPassShader.js',
  'shaders/OutputShader.js',
  'shaders/SMAAShader.js',
  'shaders/FXAAShader.js',
];

async function ensureDir(p) { await mkdir(p, { recursive: true }); }

async function copyTree(from, to, filter = () => true) {
  await ensureDir(to);
  const entries = await readdir(from, { withFileTypes: true });
  for (const e of entries) {
    const src = join(from, e.name);
    const dst = join(to, e.name);
    if (e.isDirectory()) {
      await copyTree(src, dst, filter);
    } else if (filter(src)) {
      await copyFile(src, dst);
    }
  }
}

async function main() {
  if (!existsSync(THREE_DIR)) {
    throw new Error('未找到 node_modules/three。请先运行：npm install');
  }

  // 清理旧产物（多等一拍，避免与后续 mkdir 竞态）
  if (existsSync(APP)) {
    await rm(APP, { recursive: true, force: true });
    for (let i = 0; i < 20 && existsSync(APP); i++) {
      await new Promise(r => setTimeout(r, 25));
    }
  }
  await ensureDir(APP);

  // 1. 前端源码
  await copyTree(SRC, APP);
  console.log('✔ 拷贝前端源码');

  // 2. three 核心
  const vendorThree = join(APP, 'vendor', 'three');
  await ensureDir(join(vendorThree, 'addons'));
  await copyFile(join(THREE_DIR, 'build', 'three.module.js'), join(vendorThree, 'three.module.js'));
  await copyFile(join(THREE_DIR, 'build', 'three.core.js'), join(vendorThree, 'three.core.js'));
  console.log('✔ 拷贝 three 核心');

  // 3. three addons（含依赖的 shader）
  const copied = new Set();
  async function copyAddon(rel) {
    if (copied.has(rel)) return;
    copied.add(rel);
    const from = join(THREE_DIR, 'examples', 'jsm', rel);
    if (!existsSync(from)) {
      console.warn('  ! 缺少 addon:', rel);
      return;
    }
    const dst = join(vendorThree, 'addons', rel);
    await ensureDir(dirname(dst));
    await copyFile(from, dst);

    // 解析该文件的相对 import，递归拷贝
    const code = await readFile(from, 'utf8');
    const re = /from\s+['"](\.[^'"]+)['"]/g;
    let m;
    while ((m = re.exec(code))) {
      const target = relative(join(THREE_DIR, 'examples', 'jsm'), join(dirname(from), m[1])).split(sep).join('/');
      await copyAddon(target);
    }
  }
  for (const f of ADDON_FILES) await copyAddon(f);
  console.log(`✔ 拷贝 three addons（${copied.size} 个文件）`);

  // 4. 题库与语音
  const banksFrom = join(ROOT, 'data', 'banks');
  const banksTo = join(APP, 'data', 'banks');
  await copyTree(banksFrom, banksTo);

  const ttsFrom = join(ROOT, 'data', 'tts');
  if (existsSync(ttsFrom)) {
    const ttsTo = join(APP, 'data', 'tts');
    await copyTree(ttsFrom, ttsTo);
    console.log('✔ 拷贝题库与语音');
  } else {
    console.warn('  ! 没有 data/tts，语音将回退到浏览器朗读');
  }

  // 5. 题库索引
  const bankDirs = (await readdir(banksFrom, { withFileTypes: true }))
    .filter(d => d.isDirectory())
    .map(d => d.name);
  const index = [];
  for (const id of bankDirs) {
    try {
      const meta = JSON.parse(await readFile(join(banksFrom, id, 'bank.json'), 'utf8'));
      index.push({ id: meta.id || id, name: meta.name || id });
    } catch {
      index.push({ id });
    }
  }
  await writeFile(join(banksTo, 'index.json'), JSON.stringify(index, null, 2), 'utf8');
  console.log(`✔ 题库索引：${index.map(i => i.id).join(', ')}`);

  // 6. 体积报告
  const size = await dirSize(APP);
  console.log(`\n✔ 构建完成  app/  ${(size / 1048576).toFixed(1)} MB`);
}

async function dirSize(p) {
  let total = 0;
  const entries = await readdir(p, { withFileTypes: true });
  for (const e of entries) {
    const full = join(p, e.name);
    if (e.isDirectory()) total += await dirSize(full);
    else total += (await stat(full)).size;
  }
  return total;
}

main().catch(e => { console.error('✘ 构建失败：' + e.message); process.exit(1); });
