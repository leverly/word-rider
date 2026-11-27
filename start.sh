#!/bin/bash
# 词速骑行 — 本地启动
set -euo pipefail
cd "$(dirname "$0")"

PORT="${1:-8899}"

if [ ! -d "node_modules/three" ]; then
  echo "▸ 首次运行，安装依赖 …"
  npm install --silent --no-audit --no-fund
fi

if [ ! -d "data/tts" ] || [ -z "$(ls -A data/tts 2>/dev/null)" ]; then
  echo "▸ 生成语音资产（首次需要 1-2 分钟）…"
  node tools/gen-tts.mjs
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
