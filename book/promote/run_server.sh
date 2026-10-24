#!/usr/bin/env bash
# ==============================================================================
# run_server.sh - 動画収録サーバー（server.py）をDockerコンテナで起動するスクリプト
#
# 使用法:
#   ./book/promote/run_server.sh
# ==============================================================================

set -eu
export MSYS_NO_PATHCONV=1

SCRIPT_DIR="$(cd "$(dirname "$0")" && (pwd -W 2>/dev/null || pwd))"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && (pwd -W 2>/dev/null || pwd))"

echo "================================================================"
echo "動画収録サーバーを Docker(book-pandoc) で起動します..."
echo "アクセス先: http://localhost:8000/recorder/index.html"
echo "停止方法: Ctrl+C"
echo "================================================================"

docker run --rm -it \
  -p 8000:8000 \
  -v "${PROJECT_ROOT}:/data" \
  -w /data/book/promote \
  --entrypoint python3 \
  book-pandoc:latest \
  server.py
