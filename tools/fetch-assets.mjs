// 拉取 CC0 素材（Poly Haven 模型 / HDRI，ambientCG 材质）
// 全部 CC0，可商用。产物落在 assets_src/，由 scripts/build-assets.mjs 处理成 web 资产。
import { mkdir, writeFile, readFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const RAW = join(ROOT, 'assets_src', '_raw');

async function ensure(p) { await mkdir(p, { recursive: true }); }

async function download(url, dest) {
  if (existsSync(dest) && (await stat(dest)).size > 1024) {
    return 'cached';
  }
  await ensure(dirname(dest));
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  await writeFile(dest, buf);
  return `${(buf.length / 1e6).toFixed(1)}MB`;
}

/** Poly Haven 模型：拉 gltf + 它 include 的所有贴图 */
async function fetchModel(id, resolution = '1k') {
  const meta = await (await fetch(`https://api.polyhaven.com/files/${id}`)).json();
  // 结构：{ gltf: { "1k": { gltf: {url,include}, ... } } }
  const res0 = meta?.gltf?.[resolution];
  const node = res0?.gltf || res0;
  if (!node?.url) throw new Error(`没有 ${id} @${resolution} 的 gltf`);

  const outDir = join(RAW, 'models', id);
  await ensure(outDir);

  const gltfUrl = node.url;
  const gltfName = gltfUrl.split('/').pop();
  await download(gltfUrl, join(outDir, gltfName));

  const includes = node.include || {};
  let i = 0;
  for (const [rel, info] of Object.entries(includes)) {
    i++;
    await download(info.url, join(outDir, rel));
  }
  console.log(`  ✔ ${id}  ${gltfName} + ${i} 张贴图`);
  return join(outDir, gltfName);
}

async function main() {
  await ensure(RAW);

  // ── CC0 模型 ──────────────────────────────────────
  // 树：针叶（松柏）+ 阔叶，低模草原风
  const models = [
    'fir_tree_01',        // 冷杉（远景针叶林）
    'jacaranda_tree',     // 树冠饱满的阔叶树
    'boulder_01',         // 岩石
    'tree_stump_01',      // 树桩
    'grass_medium_01',    // 草丛
    'pine_sapling_small', // 小松苗
  ];
  for (const m of models) {
    try {
      await fetchModel(m, '1k');
    } catch (e) {
      console.warn(`  ! ${m}: ${e.message}`);
    }
  }

  // ── HDRI（1k，够 IBL 用）────────────────────────
  const hdris = [
    'kloofendal_48d_partly_cloudy_puresky', // 白天
    'qwantani_night_puresky',               // 黑夜
    'overcast_soil_puresky',                // 下雨（阴天）
    'snow_field_puresky',                   // 下雪
  ];
  for (const h of hdris) {
    try {
      const url = `https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/1k/${h}_1k.hdr`;
      const r = await download(url, join(RAW, 'hdri', `${h}_1k.hdr`));
      console.log(`  ✔ ${h}.hdr  ${r}`);
    } catch (e) {
      console.warn(`  ! ${h}: ${e.message}`);
    }
  }

  console.log('\n完成。原始素材在 assets_src/_raw/');
}

main().catch(e => { console.error('✘', e); process.exit(1); });
