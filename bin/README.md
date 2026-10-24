# 製本・組版手順書 (bin/README.md)

> [!NOTE]
> ここではスクリプトを1本実行し、執筆した原稿から電子書籍（EPUB）と紙書籍（PDF）を一括生成して仕上がりを確認するだけの機械的な作業ステップです。
> スクリプトの内部構造や引数の仕様については、[specification.md](./specification.md) を参照してください。


## 2-1. 組版・パブリッシュの実行

リポジトリルート（プロジェクトの最上位フォルダ）で、以下のコマンドを実行します。

```sh
# Git Bash または Linux/macOS ターミナルで実行
./bin/md2kdp.sh
```

> [!TIP]
> **初回の対話質問について**:
> 初めて実行したときだけ、ターミナルで原稿やメタデータファイルの場所を尋ねられます。
> 本テンプレートの標準構成（`book/contents.md` 等）で進めている場合は、**何も入力せずそのまま Enter を連打**すればデフォルト値が自動記憶されます（2回目以降は何も聞かれません）。

## 成果物の確認（チェックポイント）

処理が完了すると、成果物は自動的に **[book/dist/](../book/dist/)** 配下に出力されます。ファイルを開いて仕上がりを確認してください。

1. **電子書籍: `book/dist/contents.epub`**:
   - 公式の「Kindle Previewer」等で開き、縦書き、右開き、目次リンク、ルビが意図通り表示されているか確認します。
2. **紙書籍: `book/dist/contents.pdf`**:
   - Adobe Acrobat Reader等の「見開きページ表示（表紙を別に表示）」で開き、以下を確認します：
     - 大見出し（章タイトル）が左ページ（偶数ページ）起こしになっているか
     - ノド側（綴じ側）と小口側の余白が確保されているか
     - **総ページ数（※この数字をメモしてください。次の表紙制作で背表紙幅の計算に使います）**


## 動かないときの対処法

- **`docker: command not found` / Docker接続エラー**:
  - Docker Desktopが起動しているか確認してください。
- **`image book-pandoc:latest not found`**:
  - リポジトリルートで `docker build -t book-pandoc .` を実行してイメージをビルドしてください。
- **Windows（PowerShell）で `.sh` がエラーになる**:
  - Git Bash（`bash ./bin/md2kdp.sh`）を使用してください。


---

## 次のステップ

成果物の確認ができたら、次は **[Step 3-1: KDP入稿（submission.md）](../submission.md)** および **[Step 3-2: 表紙・装丁制作（book/cover/README.md）](../book/cover/README.md)** に進みます。
