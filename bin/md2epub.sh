#!/usr/bin/env bash
# ==============================================================================
# md2epub.sh - Docker(book-pandoc)を使用してMarkdownからEPUBを生成するスクリプト
#
# 使用法:
#   ./bin/md2epub.sh
#   （初回実行時に対話形式で設定を入力し、bin/md2epub.sh.setting に保存します。
#     2回目以降は設定ファイルから自動読み込みされます）
# ==============================================================================

set -eu
export MSYS_NO_PATHCONV=1

SCRIPT_DIR="$(cd "$(dirname "$0")" && (pwd -W 2>/dev/null || pwd))"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && (pwd -W 2>/dev/null || pwd))"
SETTING_FILE="${SCRIPT_DIR}/md2epub.sh.setting"

# 1. 設定ファイルの読み込み（存在する場合）
markdown_file=""
metadata_yaml=""
cover_image=""
css_file=""

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
  read -r -p "EPUBメタデータYAMLのパスを入力してください [例: book/metadata-epub.yaml]: " metadata_yaml
  need_save=true
fi

if [ -z "${cover_image:-}" ]; then
  read -r -p "表紙画像のパスを入力してください [例: book/cover/cover.png]: " cover_image
  need_save=true
fi

if [ -z "${css_file:-}" ]; then
  read -r -p "EPUB用CSSのパスを入力してください [例: book/epub.css]: " css_file
  need_save=true
fi

# 初回入力または設定変更時は設定ファイルに保存
if [ "$need_save" = true ] || [ ! -f "$SETTING_FILE" ]; then
  cat <<EOF > "$SETTING_FILE"
# md2epub.sh 設定ファイル（対話入力により自動生成）
markdown_file="${markdown_file}"
metadata_yaml="${metadata_yaml}"
cover_image="${cover_image}"
css_file="${css_file}"
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
COVER_PATH="$(resolve_path "$cover_image")"
CSS_PATH="$(resolve_path "$css_file")"

if [ ! -f "$INPUT_PATH" ]; then
  echo "エラー: 入力Markdownファイルが見つかりません: $INPUT_PATH" >&2
  exit 1
fi

# 3. 出力先（book/dist 配下に拡張子違いで自動決定）
BASE_NAME="$(basename "${INPUT_PATH%.*}")"
DIST_DIR="${PROJECT_ROOT}/book/dist"
mkdir -p "$DIST_DIR"
OUTPUT_FILE="${DIST_DIR}/${BASE_NAME}.epub"

# Dockerマウント用の相対パス
REL_INPUT="${INPUT_PATH#$PROJECT_ROOT/}"
REL_OUTPUT="${OUTPUT_FILE#$PROJECT_ROOT/}"

ARGS=(
  --to=epub3
  --toc
  --toc-depth=2
)

if [ -f "$META_PATH" ]; then
  REL_META="${META_PATH#$PROJECT_ROOT/}"
  ARGS+=("$REL_META")
fi

if [ -f "$COVER_PATH" ]; then
  REL_COVER="${COVER_PATH#$PROJECT_ROOT/}"
  ARGS+=("--epub-cover-image=$REL_COVER")
fi

if [ -f "$CSS_PATH" ]; then
  REL_CSS="${CSS_PATH#$PROJECT_ROOT/}"
  ARGS+=("--css=$REL_CSS")
fi

ARGS+=("$REL_INPUT" -o "$REL_OUTPUT")

echo "EPUB生成中: $REL_INPUT -> $REL_OUTPUT"

docker run --rm \
  -v "${PROJECT_ROOT}:/data" \
  -w /data \
  book-pandoc:latest \
  "${ARGS[@]}"

echo "完了: $REL_OUTPUT を作成しました。"
