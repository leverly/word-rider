#!/bin/bash
# 词速骑行 — 本地启动
set -euo pipefail
cd "$(dirname "$0")"

PORT="${1:-8899}"

if [ ! -d "node_modules/three" ]; then
  echo "▸ 首次运行，安装依赖 …"
  npm install --silent --no-audit --no-fund
fi

# Edge TTS 的依赖装在 tools/ 下（与前端依赖分开）
if [ ! -d "tools/node_modules/msedge-tts" ]; then
  echo "▸ 安装语音依赖 msedge-tts …"
  ( cd tools && npm install --silent --no-audit --no-fund )
fi

# 语音缺失时才生成。gen-tts 只在音频真实存在后才登记清单条目，
# 所以「条目数 ≠ 文件数」就说明上次中途断了，续跑补齐剩余部分。
BANK_ID="$(ls data/banks | head -1)"
TTS_DIR="data/tts/$BANK_ID"
MANIFEST="$TTS_DIR/manifest.json"

tts_complete() {
  [ -f "$MANIFEST" ] || return 1
  local entries files
  entries=$(grep -c '"file"' "$MANIFEST" 2>/dev/null || echo 0)
  files=$(ls "$TTS_DIR"/*.mp3 "$TTS_DIR"/*.m4a 2>/dev/null | wc -l | tr -d ' ')
  [ "$entries" -gt 0 ] && [ "$entries" -le "$files" ]
}

if ! tts_complete; then
  echo "▸ 生成语音资产（Edge TTS，首次约 20 分钟）…"
  node tools/gen-tts.mjs
fi

# 启动前把关：清单/文件齐全，且音色必须是 Edge TTS（禁止 macOS say）
if ! node tools/check-tts.mjs "$BANK_ID"; then
  echo ""
  echo "✘ 语音校验未通过。请执行：node tools/gen-tts.mjs --force"
  exit 1
fi

echo "▸ 构建 …"
node scripts/build.mjs

while lsof -ti:"$PORT" >/dev/null 2>&1; do
  echo "▸ 端口 $PORT 已占用，换一个"
  PORT=$((PORT + 1))
done

echo ""
echo "  游戏地址： http://127.0.0.1:$PORT"
echo "  按 Ctrl+C 停止"
echo ""

open "http://127.0.0.1:$PORT/" 2>/dev/null || true
node scripts/serve.mjs "$PORT"
