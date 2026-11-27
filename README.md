# 词速骑行 Word Rider

第三人称 · 3 轮 × 3 分钟 · 四车道。真 3D 骑行游戏，用来背单词。

**渲染**：PBR 材质 + HDRI 环境光照 + 软阴影 + ACES 色调映射。
角色与载具由 Blender 建模导出 glTF，地形贴图与天空来自 CC0 资产库。

**在线试玩**：https://leverly.github.io/word-rider/

## 启动

```bash
./start.sh
```

首次运行会自动装依赖、生成语音、构建并打开浏览器。之后每次启动约 3 秒。

- 游戏：http://127.0.0.1:8899
- 端口被占用会自动后移

### 重建 3D 资产

模型源码在 `assets_src/blender/`（Python，直接驱动 Blender 生成网格），
产物是 `models/*.glb`。改模型后：

```bash
node scripts/build-3d.mjs            # Blender 建模 → 贴图处理 → 构建
node scripts/build-3d.mjs --skip-blender   # 只重跑贴图与构建
```

需要 Blender 4.x（默认读 `/usr/local/bin/blender`，可用 `BLENDER=...` 覆盖）。

### 视觉验证

```bash
node scripts/serve.mjs 8899 &
node scripts/shoot-scene.mjs screenshots/scene 8899
```

会依次截四套天气与开局画面，并把控制台错误打出来。
脚本走 `--use-angle=metal` 用真实 GPU；用 SwiftShader 软渲染会慢到几十秒一帧。

## 怎么玩

开始页只有一个选项：**难度**（五档车速）。外观是固定的白天场景 + 自行车 + 青碧配色，不用挑。

### 一条精品赛道 · 四种天气

赛道是固定的风景公路：一侧湖泊、两侧林荫、远处雪峰与风车。

| 天气 | 天空 | 地面 | 光 |
|---|---|---|---|
| 白天 | HDRI 真实云层 | 草地贴图 + 顶点色变化 | 强日照，长阴影 |
| 黑夜 | 纯色夜空 + 粒子星空 | 压暗草地 | 月光 + 路灯亮斑 + 车灯光锥 |
| 下雨 | 阴天 HDRI | 湿滑沥青（低粗糙度 + 反射） | 柔光，雨丝随风倾斜 |
| 下雪 | 雪原 HDRI | 积雪贴图 | 高反照率，飘雪 + 浓雾 |

骑手是**一只鹈鹕**：大白身、橙色大喙、喉囊、蹼足。骑自行车时坐着踩踏板，
骑滑板车时站在甲板上。它会眨眼、随速度点头、答对时抬翅欢呼、围巾随风飘。

> 注：开始页只暴露「难度」。四套天气、两种座驾、多套配色在引擎里都可用
> （`world.setWeather(id)` / `world.setVehicle(kind, palette)`），
> 运行时固定使用 `src/main.js` 的 `LOOK` 常量。

**第三人称视角**：镜头在鹈鹕后上方，能看见骑手、座驾和整条路。换道时车身与镜头一起侧倾，速度越快 FOV 越广。

### 三轮制

一局 = **3 轮**，每轮 **3 分钟**，独立计分。

| | |
|---|---|
| 每轮 | 单独倒计时、单独分数、单独错题 |
| 轮间 | 过渡屏显示本轮成绩、四项统计、已完成轮次对比 |
| 最终成绩 | **取三轮中的最高分**，计入排行榜 |
| 汇总 | 三轮总正确率、总答对/作答、最高连击、拿到道具、复习词条、记忆升级 |

题目是路上的门架，**四条车道就是四个选项**。骑到门前的瞬间在哪条道，就算选了哪个。

| 操作 | 键盘 | 触屏 |
|---|---|---|
| 换道 | ← → / A D | 左右滑 |
| 直接选某道 | 1 2 3 4 | 点底部选项格 |
| 加减档 | ↑ ↓ / W S | 上下滑 |
| 用道具 | 空格 | 点道具圆钮 |
| 重听读音 | R | 点题干喇叭 |
| 暂停 | Esc / P | 右上角 |
| 轮间继续 | 回车 | 点按钮 |

**计分**：答对 +5，答错 −1（不低于 0）。连击影响结算评价。

**评级**：S ≥ 125 / A ≥ 85 / B ≥ 40 / C。最终成绩按最高轮计算。

**星标题**：题干牌带金边和「★ 答对得道具」的题，答对必得一个道具，最多存 2 个，主动使用。

**五个档位**：10 / 12.5 / 15 / 17.5 / 20 m/s。越快题越密、分越多，但读题时间越短（最快档仍有 5.5 秒读题窗口）。

**题干在屏幕顶部正中**：大字号题干卡 + 题型标签 + 读题倒计时 + 一条「离门还有多远」的进度条（走满即到门，剩余不足 30% 会转橙闪动提示锁道）。底部只有四个选项。

## 学习机制

- **五种单词题型**：看词选义、听音选义、看义选词、例句填空、拼写补全，分别练 形→义、音→义、义→形、语境→形、义/音→精确拼写。
- **拼写补全（W5，最难的拼写题）**：题干给「释义 + 挖空的词形」，缺 1~2 个字母（金色空格槽），整词可重听；四个选项是等长的字母组，填进空格。首尾字母不挖，优先挖元音与真拼写单位（`ea / oo / ck / tion / ence / able`），干扰项全取自真实拼写片段，靠长度猜不出来。
- **间隔重复**：每题 6 级记忆箱（10 分钟 / 1 天 / 3 天 / 7 天 / 15 天 / 30 天）。果断答对升级，犹豫答对保持，答错归零。
- **错题重现**：答错的题隔 4 题再出现，最多 2 次。
- **即时反馈**：答错有 1 秒慢镜头，显示并朗读正确答案与解释。
- 进度存在浏览器 IndexedDB/localStorage，按题库独立保存。

## 换题库

当前内置 **北京中考英语课标词汇**（1546 词，含音标、例句与词频分档）。

题库放在 `data/banks/<名字>/`：

```
data/banks/zhongkao/
├── bank.json       { id, name, lang, starRatio, tiers, source }
└── vocab.json      单词表
```

词库由 `tools/gen-bank.mjs` 从开放数据生成，不手写：

| 字段 | 来源 |
|---|---|
| 词条范围 | [ECDICT](https://github.com/skywind3000/ECDICT) 中带 `zk`（中考）标签的词 — MIT |
| 中文释义 / 词形 | 同上，按词性优先取义，剔除 `[计]` `[医]` 等领域标注 |
| 音标 | [ipa-dict](https://github.com/open-dict-data/ipa-dict) `en_UK` 为主、`en_US` 兜底 — CC BY-SA |
| 中英例句 | [Tatoeba](https://tatoeba.org) 中英对照句，繁体自动转简体 — CC BY 2.0 FR |

```bash
node tools/gen-bank.mjs            # 用缓存生成
node tools/gen-bank.mjs --refresh  # 重新下载源数据
```

生成的词条按 ECDICT 词频分三档（`unit-01` 核心高频 / `unit-02` 常用 / `unit-03` 拓展），
纯虚词（`a` `of` `to`）、缩写（`CD` `TV`）和带符号的词不进题库——四选一选释义没法区分它们。

`vocab.json` 每条：

```json
{
  "id": "w-abandon",
  "word": "abandon",
  "phonetic": "/əˈbændən/",
  "pos": "v",
  "meaning": "放弃；抛弃",
  "senses": [{ "pos": "v", "zh": "放弃；抛弃" }],
  "sentence": "He abandoned the car on the highway.",
  "sentence_cn": "他把车丢在了高速公路上。",
  "frq": 1152,
  "rank": 214,
  "group": "unit-01"
}
```

必填 `id` `word` `meaning` `pos`；`sentence` 用于例句填空和答后朗读；
`group` 是词频档位；`star:true` 可手动指定星标题（不写则按 `starRatio` 随机分配）。

加新题库后：

```bash
node tools/gen-tts.mjs   # 生成读音（增量，已有音频自动跳过）
./start.sh
```

## 语音

朗读音频由 **Edge TTS** 在构建期预生成，存在 `data/tts/<题库>/`，随站点部署、离线可用。

- 音色：单词 `en-US-AriaNeural`，例句 `en-US-GuyNeural`（`tools/gen-tts.mjs` 里可改）
- 输出 24kHz / 48kbps 单声道 mp3，缓存键 = `sha1(引擎+音色+文本)`，同一句跨题库复用
- 依赖 `tools/node_modules/msedge-tts` —— 它实现了 `Sec-MS-GEC v2` 签名。
  **不要换成旧的 `edge-tts` 包，那个缺签名会稳定 403。**
- `node tools/gen-tts.mjs --engine macos` 只是应急开关（系统 `say`），产物不作为交付。

## 技术

纯前端，零后端进程：

- **Three.js 0.187** 真 3D，`MeshToonMaterial` 三阶色阶 + 反向外壳描边做卡通风
- **后处理**：UnrealBloom（只让高光溢出）+ ACES 色调映射 + SMAA + 自定义调色（径向速度模糊 / 边缘色散 / 冲刺冷蓝染色 / 速度晕影 / 闪光 / 撞击颗粒）

## 体感设计（参考赛车游戏）

速度感不是靠「数值变快」，而是靠一整套互相印证的视觉线索：

| 手段 | 实现 |
|---|---|
| **路面真的在流** | 车道虚线、路肩红白条、路边橙顶轮廓柱都以各自周期循环滚动；沥青有程序化颗粒纹理 |
| **近景参照物** | 每 16 米一根轮廓柱，高速掠过时提供最强的速度参照 |
| **镜头语言** | 横向弹簧滞后（换道有甩感）、换道 FOV 冲击、按横向速度压弯侧倾、加减速俯仰、高速细微起伏 |
| **FOV 拉伸** | 基础 48° → 满速 +11° → 氮气再 +9°，冲刺时峰值约 66° |
| **3D 速度线** | 车身两侧真实向后掠过的光条（不是屏幕假象），高速才显现 |
| **氮气** | 双锥尾焰 + 蓝光地染 + 后处理冷蓝染色 + 点火扫频音效 |
| **引擎声** | 锯齿基频 + 低八度 + 轻微失谐，随档位/速度升调，冲刺再抬 |

调参集中在 `src/core/config.js` 的 `cam` 段与 `src/world/scene.js` 的 `GRADE_SHADER`。
- **程序化建模**：全部代码生成，无外部模型文件
  - 座驾：自行车（真实比例，曲柄/脚踏联动）、滑板车（甲板/立管/小旗）
  - 骑手：鹈鹕（大喙 + 喉囊 + 蹼足 + 眨眼 + 围巾飘动）
  - 环境：三套主题各 10+ 种景物（椰树/灯塔/农舍/风车/孤树/平顶山…）
- **天气系统**：四套配置（`src/world/themes.js` 的 `WEATHERS`）各自定义天空渐变、太阳光晕色与强度、平行光/半球光、环境光、雾的远近、曝光、饱和度/对比/晕影。切换时重建道路（景物换色、积雪、湿路面材质）并更新星空、月亮、雨、雪、车灯。
- **天气特效**（`src/world/weather.js`）：
  - 星空：900 点云上半球分布，缓慢天球旋转
  - 月亮：圆盘 + 光晕，夜间可见
  - 雨：2000 条线段的粒子系统，随车速倾斜，落地后在天幕范围内重生
  - 雪：2600 个圆形贴图粒子，正弦横摆飘落
  - 车灯：加色混合的光锥 + 地面光斑 + 点光源，跟随车辆横向位置
- **音频**：WebAudio 实时合成音效与 BGM（随档位加密、最后 10 秒变奏），无音频素材文件
- 无构建工具依赖，`scripts/build.mjs` 拷贝 + vendor three

## 改外观（可选，默认不暴露）

开始页不提供外观选项，固定使用 `src/main.js` 里的：

```js
const LOOK = { theme: 'day', vehicle: 'bike', palette: 'teal' };
```

想换就改这一行的值，可选值在 `src/world/themes.js`：

- `theme`：`day` / `night` / `rain` / `snow`（`WEATHERS`）
- `vehicle`：`bike` / `scooter`
- `palette`：自行车 `teal` / `coral` / `midnight`，滑板车 `sunset` / `mint` / `violet`

`TRACK` 控制赛道本身的景物组合（`props` 数组）与是否有湖；新景物需先在
`src/world/road.js` 的 `makePropBuilders()` 里实现建模函数。天气特效在 `src/world/weather.js`。

## 目录

```
背单词/
├── start.sh                一键启动
├── src/                    前端源码
│   ├── core/               配置、工具、题库加载、出题引擎、间隔重复
│   ├── world/              3D 场景、天气、座驾、鹈鹕、道路、门架
│   ├── game/               游戏状态机、判分、道具
│   ├── audio/              音效、BGM、语音
│   ├── ui/                 HUD、开始页、暂停、结算
│   ├── main.js             装配入口
│   ├── index.html
│   └── styles.css
├── data/
│   ├── banks/zhongkao/     题库
│   └── tts/zhongkao/       预生成语音 + manifest.json
├── tools/gen-tts.mjs       语音生成
├── scripts/
│   ├── build.mjs           构建 → app/
│   └── serve.mjs           零依赖静态服务器
├── app/                    ← 构建产物，可直接部署
├── design/                 设计稿与设计图
└── 词速骑行-游戏设计方案.md  设计文档
```

## 部署

`app/` 整个目录丢到任何静态托管即可（GitHub Pages、Vercel、Nginx），不需要 Node 运行时。

**必须通过 HTTP 访问**，不能双击 `index.html`——ES module 在 `file://` 下会被浏览器跨域策略拦住。

仓库自带 `.github/workflows/pages.yml`：推到 `main` 后自动 `npm ci && node scripts/build.mjs`，把 `app/` 发布到 GitHub Pages。启用方式：仓库 **Settings → Pages → Source** 选 **GitHub Actions**。

## 开发

```bash
npm install
node scripts/build.mjs      # 只构建，不启服务
node scripts/serve.mjs 8899 # 起静态服务器
node tools/gen-tts.mjs      # 增量补语音（Edge TTS）
```

`scripts/` 下还有一批无头 Chrome 截图/探针脚本（`shoot-*.mjs`、`probe-*.mjs`），用于回归检查界面与 HUD。

### 答后反馈的回归检查

改动画/判分/反馈相关逻辑后，先跑这个（纯逻辑，不需要浏览器，不受机器负载影响）：

```bash
node scripts/test-feedback.mjs
```

它断言了「答后驻留」这套时序的关键约定，任何一条被破坏都会立刻失败：

- 答完后 HUD 停在**刚答的题**上（不立刻切下一题），答错 2.4s / 答对 0.75s
- 驻留期间**不判分、不锁道、比赛倒计时不减**
- 反馈条渲染在答题条内部（不会飘到屏幕中央挡住下一道门）
- 门架掠过镜头时（z > `gatePassHideZ`）不再渲染，避免撑满屏幕
- 按键/轻点可跳过解释，且有最短显示保护

设计约定（别退回去）：
1. **反馈不占屏幕中心**。中心是赛道消失点，也是下一道门升起的位置，任何居中弹窗都会挡住下一题。
2. **答案和下一题不同屏**。先看完对错与解释，再切题。
3. **学习不该被倒计时惩罚**。读解释的时间不计入比赛时间。

要拍真实画面时：`node scripts/probe-answer.mjs` 量 DOM 矩形，`node scripts/shoot-answer.mjs <outDir>` 截图。
注意无头 SwiftShader 跑真 3D 很慢，页面会长时间停在「正在载入题库…」（其实卡在 WebGL 初始化），
机器 `uptime` 负载高于 10 时基本跑不动。

