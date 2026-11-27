# 项目约定（Agent 必读）

## 语音：必须用 Edge TTS

所有朗读音频**只能**由 Edge TTS 生成，音色 `en-US-AriaNeural`（单词）/ `en-US-GuyNeural`（例句）。
**禁止使用 macOS `say`**（Samantha / Alex）—— 用户已多次强调，产物不算交付。

**每次执行 `tools/gen-tts.mjs` 之前与之后，都要核对 `data/tts/<题库>/manifest.json` 的 `voice` 字段：**

```bash
node tools/check-tts.mjs     # 一次性检查：文件齐全 + 音色全是 Edge TTS
```

期望输出 `✔ 语音资产完整，且全部由 Edge TTS 生成`。
`start.sh` 启动时也会自动跑这个检查，不通过直接退出。

- Edge TTS 依赖 `tools/node_modules/msedge-tts`（提供 `Sec-MS-GEC` v2 签名）。
  **旧的 `edge-tts` 包缺签名，会稳定 403，不要退回它。**
- Edge TTS 失败就如实报告，**不得静默回退到 `say`**。
- `--engine macos` 只是应急开关，默认引擎必须是 `edge`。

## 词库：由脚本生成，不手写

`data/banks/<题库>/vocab.json` 由 `tools/gen-bank.mjs` 从开放数据生成（ECDICT 的 `zk` 中考标签 +
ipa-dict 音标 + Tatoeba 中英例句）。改词库请改脚本后重跑，不要手改 JSON。

## 验证方式

界面与玩法改动后用无头 Chrome 截图确认，而不是只跑通语法检查：

```bash
node scripts/build.mjs && node scripts/serve.mjs &
node scripts/shoot-answer.mjs screenshots/zk 8899
```

## 3D 资产：Blender 建模，不手写几何

`src/` 里**不再有程序化建模**。角色、载具、树木、路灯、护栏、门架之外的场景道具
全部来自 `assets_src/blender/` 的 Python 脚本，用 Blender 生成后导出 `models/*.glb`。

```bash
node scripts/build-3d.mjs                 # 全量重建
node scripts/build-3d.mjs --skip-blender  # 只重跑贴图与构建
```

- 建模脚本用 `lib_mesh.py` 里的工具（`loft` / `loft_spine` / `tube_along` / `ribbon` / `metaball_blob`）。
- **父级绑定必须用 `matrix_parent_inverse = parent.matrix_world.inverted()`**，
  或先存 `matrix_world` 再赋值。写成 Identity 会让子物体整体平移（踩过的坑）。
- `origin_set(ORIGIN_CURSOR)` 只移原点、不动网格，所以建完立刻 `attach` 到父级前，
  要用「先记世界矩阵、再挂父级、再写回」的写法。
- 材质走 `pbr()`（Principled BSDF）。**注意 `use_nodes = True` 会自动建默认节点对，
  必须 `nodes.clear()`**，否则导出的 glTF 全是灰色。
- `ribbon()` 之类的几何工具不会自动上材质，漏了就会导出成 glTF 默认材质（纯白 + 金属度 1）。

## 渲染：PBR，不是卡通

旧的 toon 着色 + 反向外壳描边已全部移除。现在的管线：

```
RenderPass → Bloom → OutputPass(ACES + sRGB) → 调色 ShaderPass → SMAA
```

**调色必须放在 OutputPass 之后**。放在之前时缓冲还是线性 HDR（值 > 1），
`(col-0.5)*contrast+0.5` 会把亮部推得更高，整屏过曝。

光照原则：太阳 + 完整 IBL 同时全开会叠加 3~4 档曝光。白天用
`sunInt ≈ 1.8 / skyIntensity ≈ 0.6`，不是 3.0 / 1.0。

## 视觉验证：必须看截图，而且要用 GPU

```bash
node scripts/serve.mjs 8899 &
node scripts/shoot-scene.mjs screenshots/scene 8899
```

脚本用 `--use-angle=metal`（真实 GPU）。**不要用 `--use-angle=swiftshader`**：
软渲染下这个场景只有 1 fps 左右，截图脚本会超时，而且会误判成「场景没渲染」。

排查画面问题时的有效手段（都是实测过的）：
- 二分：先把 `world.render` 换成 `renderer.render` 跳过所有后处理。
- 逐层关：`scene.environmentIntensity = 0`、关灯、关某个子网格，看画面变化。
- **读像素**：`PIL` 取几个点，比对数值比肉眼判断可靠得多
  （曾靠「草地像素和路面像素完全相同」定位到一块覆盖全场的透明平面）。
