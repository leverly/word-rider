// 一键重建全部 3D 资产：Blender 建模 → 贴图处理 → 构建
// 用法：node scripts/build-3d.mjs [--skip-blender]
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BLENDER = process.env.BLENDER || '/usr/local/bin/blender';
const MODELS = join(ROOT, 'models');

const skipBlender = process.argv.includes('--skip-blender');

const JOBS = [
  // [脚本, 输出 glb, 说明]
  ['pelican.py', 'pelican.glb', '鹈鹕骑手'],
  ['bike.py', 'bike.glb', '自行车'],
  ['scooter.py', 'scooter.glb', '滑板车'],
];

const PROPS = [
  'tree_pine.glb', 'tree_broad.glb', 'tree_small.glb',
  'rock_a.glb', 'rock_b.glb', 'lamp.glb', 'guardrail.glb',
  'bollard.glb', 'signpost.glb', 'windmill.glb', 'mountain.glb',
];

function run(cmd, args, label) {
  return new Promise((res, rej) => {
    console.log(`▶ ${label}`);
    const p = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    p.stdout.on('data', d => { out += d; });
    p.stderr.on('data', d => { out += d; });
    p.on('close', (code) => {
      // 只打印关键行，Blender 的 INFO 太吵
      for (const line of out.split('\n')) {
        if (/三角面数|→|Error|Traceback|✘/.test(line)) console.log('  ' + line.trim());
      }
      code === 0 ? res() : rej(new Error(`${label} 失败（exit ${code}）`));
    });
  });
}

async function main() {
  if (!skipBlender) {
    if (!existsSync(BLENDER)) {
      throw new Error(`找不到 Blender：${BLENDER}\n可用 BLENDER=/path/to/blender 指定`);
    }

    for (const [script, out, label] of JOBS) {
      await run(BLENDER, [
        '-b', '--python', join(ROOT, 'assets_src', 'blender', script),
        '--', join(MODELS, out),
      ], `${label} → models/${out}`);
    }

    await run(BLENDER, [
      '-b', '--python', join(ROOT, 'assets_src', 'blender', 'props.py'),
      '--', MODELS,
    ], '环境资产（树 / 岩石 / 路灯 / 护栏 / 远山）');

    // 校验产物
    const missing = PROPS.filter(f => !existsSync(join(MODELS, f)));
    if (missing.length) console.warn(`  ! 缺少：${missing.join(', ')}`);
  } else {
    console.log('▶ 跳过 Blender，沿用 models/ 里已有产物');
  }

  await run(process.execPath, [join(ROOT, 'scripts', 'build-assets.mjs')], '处理贴图与 HDRI');
  await run(process.execPath, [join(ROOT, 'scripts', 'build.mjs')], '构建静态站点');

  console.log('\n✔ 3D 资产重建完成');
}

main().catch(e => { console.error('✘ ' + e.message); process.exit(1); });
