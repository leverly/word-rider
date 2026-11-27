# 词速骑行 Word Rider

第一人称 · 3 轮 × 3 分钟 · 四车道。真 3D 卡通骑行游戏，用来背单词和练语法。

## 启动

```bash
cd "/Users/sunzhidong/Desktop/thinking/背单词"
./start.sh
```

首次运行会自动装依赖、生成语音、构建并打开浏览器。之后每次启动约 3 秒。

- 游戏：http://127.0.0.1:8899
- 端口被占用会自动后移

## 怎么玩

开始页可以选 **赛道 / 座驾 / 配色**，每次选择都会立刻反映在背景里：

| 赛道 | 特色景物 |
|---|---|
| 海边 | 椰树、沙滩、海浪、灯塔、海鸥 |
| 乡村 | 绿草地、麦田、木栅栏、红顶农舍、风车、干草堆 |
| 草原 | 金色草浪、孤树、平顶山、草簇 |

| 座驾 | 配色 |
|---|---|
| 自行车 | 青碧 / 珊瑚 / 墨夜 |
| 滑板车 | 落日 / 薄荷 / 紫罗兰 |

骑手是**一只鹈鹕**：大白身、橙色大喙、喉囊、蹼足。骑自行车时坐着踩踏板，骑滑板车时站在甲板上握把。它会眨眼、随速度点头、围巾随风飘。

选择会记住，下次打开还是上次的搭配。

**第一人称视角**：镜头在鹈鹕的眼睛位置，看得到路面从脚下延伸，看不到自己的身体。

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

- **四种单词题型**：看词选义、听音选义、看义选词、例句填空，分别练 形→义、音→义、义→形、语境→形。
- **语法题**：题干挖空，四选一，答后朗读完整正确句。
- **间隔重复**：每题 6 级记忆箱（10 分钟 / 1 天 / 3 天 / 7 天 / 15 天 / 30 天）。果断答对升级，犹豫答对保持，答错归零。
- **错题重现**：答错的题隔 4 题再出现，最多 2 次。
- **即时反馈**：答错有 1 秒慢镜头，显示并朗读正确答案与解释。
- 进度存在浏览器 IndexedDB/localStorage，按题库独立保存。

## 换题库

题库放在 `data/banks/<名字>/`：

```
data/banks/cet4/
├── bank.json       { id, name, lang, defaultMix, starRatio }
├── vocab.json      单词表
└── grammar.json    语法题（可选）
```

`vocab.json` 每条：

```json
{
  "id": "w-abandon",
  "word": "abandon",
  "phonetic": "/əˈbændən/",
  "pos": "v",
  "meaning": "放弃；抛弃",
  "sentence": "He abandoned the car on the highway.",
  "group": "unit-01",
  "star": true
}
```

必填 `id` `word` `meaning` `pos`；`sentence` 用于例句填空和答后朗读；`star:true` 标记为星标题。

`grammar.json` 每条：

```json
{
  "id": "g-present-perfect-01",
  "topic": "现在完成时",
  "prompt": "I _____ in Beijing for ten years.",
  "options": ["live", "have lived", "lived", "am living"],
  "answer": 1,
  "explanation": "for ten years 表示持续到现在的时间段，用现在完成时。"
}
```

加新题库后：

```bash
node tools/gen-tts.mjs   # 生成读音（增量，已有音频自动跳过）
./start.sh
```

## 语音

**注意：Edge TTS 在当前网络环境不可用（返回 403）**，因此改用 macOS 内置 `say` 在构建期预生成音频，存在 `data/tts/<题库>/`，随站点部署、离线可用。

- 音色：单词用 Samantha，句子用 Alex（`tools/gen-tts.mjs` 里可改）
- 缓存键 = `sha1(引擎+音色+文本)`，同一句跨题库复用
- 想换回 Edge TTS：`node tools/gen-tts.mjs --engine edge`（需要网络能访问微软的语音服务）

## 技术

纯前端，零后端进程：

- **Three.js 0.187** 真 3D，`MeshToonMaterial` 三阶色阶 + 反向外壳描边做卡通风
- **后处理**：UnrealBloom（只让高光溢出）+ ACES 色调映射 + SMAA + 自定义调色（饱和度/对比/晕影/速度线/闪光）
- **程序化建模**：全部代码生成，无外部模型文件
  - 座驾：自行车（真实比例，曲柄/脚踏联动）、滑板车（甲板/立管/小旗）
  - 骑手：鹈鹕（大喙 + 喉囊 + 蹼足 + 眨眼 + 围巾飘动）
  - 环境：三套主题各 10+ 种景物（椰树/灯塔/农舍/风车/孤树/平顶山…）
- **音频**：WebAudio 实时合成音效与 BGM（随档位加密、最后 10 秒变奏），无音频素材文件
- 无构建工具依赖，`scripts/build.mjs` 拷贝 + vendor three

## 扩展新赛道 / 新配色

编辑 `src/world/themes.js`：

- `THEMES` 加一项即可新增赛道（天空色、雾、地面色、景物列表、光照）
- `PALETTES` 里给自行车/滑板车各加一条即新增配色
- 新景物需要先在 `src/world/road.js` 的 `makePropBuilders()` 里实现建模函数

## 目录

```
背单词/
├── start.sh                一键启动
├── src/                    前端源码
│   ├── core/               配置、工具、题库加载、出题引擎、间隔重复
│   ├── world/              3D 场景、主题、座驾、鹈鹕、道路、门架
│   ├── game/               游戏状态机、判分、道具
│   ├── audio/              音效、BGM、语音
│   ├── ui/                 HUD、开始页、暂停、结算
│   ├── main.js             装配入口
│   ├── index.html
│   └── styles.css
├── data/
│   ├── banks/cet4/         题库
│   └── tts/cet4/           预生成语音 + manifest.json
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
node tools/gen-tts.mjs      # 增量补语音（macOS say）
```

`scripts/` 下还有一批无头 Chrome 截图/探针脚本（`shoot-*.mjs`、`probe-*.mjs`），用于回归检查界面与 HUD。
