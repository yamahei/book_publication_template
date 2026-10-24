#!/usr/bin/env bash
# ==============================================================================
# md2pdf.sh - Docker(book-pandoc)を使用してMarkdownからLuaLaTeXでPDFを生成するスクリプト
#
# 使用法:
#   ./bin/md2pdf.sh
#   （初回実行時に対話形式で設定を入力し、bin/md2pdf.sh.setting に保存します。
#     2回目以降は設定ファイルから自動読み込みされます）
# ==============================================================================

set -eu
export MSYS_NO_PATHCONV=1

SCRIPT_DIR="$(cd "$(dirname "$0")" && (pwd -W 2>/dev/null || pwd))"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && (pwd -W 2>/dev/null || pwd))"
SETTING_FILE="${SCRIPT_DIR}/md2pdf.sh.setting"

# 1. 設定ファイルの読み込み（存在する場合）
markdown_file=""
metadata_yaml=""

if [ -f "$SETTING_FILE" ]; then
  # shellcheck source=/dev/null
  source "$SETTING_FILE"
fi

# 2. 未設定項目の対話入力
need_save=false

if [ -z "${markdown_file:-}" ]; then
  read -r -p "Markdownファイルのパスを入力してください [例: book/contents.md]: " markdown_file
  need_save=true
fi

if [ -z "${metadata_yaml:-}" ]; then
  read -r -p "PDF組版メタデータYAMLのパスを入力してください [例: book/metadata-pdf.yaml]: " metadata_yaml
  need_save=true
fi

# 初回入力または設定変更時は設定ファイルに保存
if [ "$need_save" = true ] || [ ! -f "$SETTING_FILE" ]; then
  cat <<EOF > "$SETTING_FILE"
# md2pdf.sh 設定ファイル（対話入力により自動生成）
markdown_file="${markdown_file}"
metadata_yaml="${metadata_yaml}"
EOF
  echo "設定を ${SETTING_FILE} に保存しました（次回以降は自動参照されます）。"
fi

# パス解決（プロジェクトルート相対も考慮）
resolve_path() {
  local p="$1"
  if [ -f "$p" ]; then
    echo "$p"
  elif [ -f "${PROJECT_ROOT}/$p" ]; then
    echo "${PROJECT_ROOT}/$p"
  else
    echo "$p"
  fi
}

INPUT_PATH="$(resolve_path "$markdown_file")"
META_PATH="$(resolve_path "$metadata_yaml")"

if [ ! -f "$INPUT_PATH" ]; then
  echo "エラー: 入力Markdownファイルが見つかりません: $INPUT_PATH" >&2
  exit 1
fi

# 3. 出力先（book/dist 配下に拡張子違いで自動決定）
BASE_NAME="$(basename "${INPUT_PATH%.*}")"
DIST_DIR="${PROJECT_ROOT}/book/dist"
mkdir -p "$DIST_DIR"
OUTPUT_FILE="${DIST_DIR}/${BASE_NAME}.pdf"

# Dockerマウント用の相対パス
REL_INPUT="${INPUT_PATH#$PROJECT_ROOT/}"
REL_OUTPUT="${OUTPUT_FILE#$PROJECT_ROOT/}"

ARGS=(
  --pdf-engine=lualatex
  -s
  --toc
  --toc-depth=2
)

# ルビフィルタの自動適用
if [ -f "${PROJECT_ROOT}/filters/ruby.lua" ]; then
  ARGS+=("--lua-filter=filters/ruby.lua")
fi

if [ -f "$META_PATH" ]; then
  REL_META="${META_PATH#$PROJECT_ROOT/}"
  ARGS+=("$REL_META")
fi

ARGS+=("$REL_INPUT" -o "$REL_OUTPUT")

echo "PDF生成中: $REL_INPUT -> $REL_OUTPUT"

docker run --rm \
  -v "${PROJECT_ROOT}:/data" \
  -w /data \
  book-pandoc:latest \
  "${ARGS[@]}"

rm -f "${PROJECT_ROOT}/input.ltjruby"

echo "完了: $REL_OUTPUT を作成しました。"
