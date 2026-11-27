// 把 Blender 产出的 glb / 原始 PBR 贴图 / HDRI 处理成 web 可用资产
//
// - glb：Draco 压缩代价高且需额外解码器，这里改为单纯优化（去冗余、量化）
// - 贴图：转 WebP（体积约为 JPG 的 60%，保留 alpha）
// - HDRI：保留 .hdr 原样（RGBE，Three 的 RGBELoader 直接读）
//
// 产物：src/assets/  （build.mjs 再原样拷进 app/）
import { readFile, writeFile, mkdir, readdir, stat, rm, copyFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, dirname, basename, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const RAW = join(ROOT, 'assets_src', '_raw');
const MODELS = join(ROOT, 'app', 'models');
const OUT = join(ROOT, 'src', 'assets');

const SIZES = {};   // 记录产物体积，最后打印

async function ensure(p) { await mkdir(p, { recursive: true }); }

function run(cmd, args) {
  return new Promise((res, rej) => {
    const p = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let err = '';
    p.stderr.on('data', d => { err += d; });
    p.on('close', c => (c === 0 ? res() : rej(new Error(err || `${cmd} exit ${c}`))));
  });
}

/** 用 ffmpeg 把图片转 WebP（CRF 质量可调） */
async function toWebp(src, dst, { width = 1024, quality = 82 } = {}) {
  await ensure(dirname(dst));
  await run('ffmpeg', [
    '-y', '-loglevel', 'error', '-i', src,
    '-vf', `scale='min(${width},iw)':-2:flags=lanczos`,
    '-c:v', 'libwebp', '-quality', String(quality), '-compression_level', '6',
    dst,
  ]);
  const s = (await stat(dst)).size;
  SIZES[basename(dst)] = s;
  return s;
}

async function main() {
  await ensure(OUT);

  // ── 1. HDRI ──────────────────────────────────────────
  const hdriOut = join(OUT, 'hdri');
  await ensure(hdriOut);
  const hdriDir = join(RAW, 'hdri');
  const MAP = {
    'kloofendal_48d_partly_cloudy_puresky_1k.hdr': 'day.hdr',
    'qwantani_night_puresky_1k.hdr': 'night.hdr',
    'overcast_soil_puresky_1k.hdr': 'rain.hdr',
    'snow_field_puresky_1k.hdr': 'snow.hdr',
  };
  for (const [src, dst] of Object.entries(MAP)) {
    const p = join(hdriDir, src);
    if (!existsSync(p)) {
      console.warn(`  ! 缺 HDRI: ${src}`);
      continue;
    }
    await copyFile(p, join(hdriOut, dst));
    const s = (await stat(join(hdriOut, dst))).size;
    SIZES[dst] = s;
    console.log(`  ✔ hdri/${dst}  ${(s / 1e6).toFixed(2)} MB`);
  }

  // ── 2. 地面 / 路面 PBR 贴图 ──────────────────────────
  // ambientCG 命名：<Asset>_1K-JPG_Color.jpg / _NormalGL / _Roughness
  const texOut = join(OUT, 'tex');
  await ensure(texOut);

  const TEX_SETS = [
    // [源目录, 输出前缀, 目标宽度]
    ['Asphalt033', 'asphalt', 1024],
    ['Grass004', 'grass', 1024],
    ['Rock030', 'rock', 768],
    ['Snow006', 'snow', 768],
    ['Metal032', 'metal', 512],
  ];

  for (const [dir, prefix, w] of TEX_SETS) {
    const srcDir = join(RAW, dir);
    if (!existsSync(srcDir)) {
      console.warn(`  ! 缺贴图集: ${dir}`);
      continue;
    }
    const files = await readdir(srcDir);
    const pick = kind => files.find(f => f.toLowerCase().includes(kind.toLowerCase()));

    const colorSrc = pick('_Color');
    const normalSrc = pick('_NormalGL');
    const roughSrc = pick('_Roughness');

    if (colorSrc) {
      const s = await toWebp(join(srcDir, colorSrc), join(texOut, `${prefix}_color.webp`),
                             { width: w, quality: 84 });
      console.log(`  ✔ tex/${prefix}_color.webp  ${(s / 1024).toFixed(0)} KB`);
    }
    if (normalSrc) {
      const s = await toWebp(join(srcDir, normalSrc), join(texOut, `${prefix}_normal.webp`),
                             { width: w, quality: 90 });
      console.log(`  ✔ tex/${prefix}_normal.webp  ${(s / 1024).toFixed(0)} KB`);
    }
    if (roughSrc) {
      const s = await toWebp(join(srcDir, roughSrc), join(texOut, `${prefix}_rough.webp`),
                             { width: w, quality: 82 });
      console.log(`  ✔ tex/${prefix}_rough.webp  ${(s / 1024).toFixed(0)} KB`);
    }
  }

  // ── 3. 模型 ──────────────────────────────────────────
  // 直接沿用 app/models（build.mjs 会拷进站点），这里只报告体积
  if (existsSync(MODELS)) {
    const files = await readdir(MODELS);
    console.log('\n  模型：');
    for (const f of files.filter(f => f.endsWith('.glb')).sort()) {
      const s = (await stat(join(MODELS, f))).size;
      SIZES[f] = s;
      console.log(`    ${f.padEnd(22)} ${(s / 1024).toFixed(0)} KB`);
    }
  }

  const total = Object.values(SIZES).reduce((a, b) => a + b, 0);
  console.log(`\n✔ 资产处理完成，共 ${(total / 1048576).toFixed(1)} MB`);
}

main().catch(e => { console.error('✘', e.message); process.exit(1); });
