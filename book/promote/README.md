# プロモーション動画制作手順書 (book/promote/README.md)

> [!NOTE]
> 書籍宣伝のための、縦書きショート動画を制作するツールです。
> この作業は任意ですが、手間の大きい動画制作を「AIによる構成・定義生成」と「ブラウザ録画」の最小手順で完了できるようツールを提供しています。
> 画面解像度や録画エンジンの技術仕様、カスタマイズ項目の詳細については、[specification.md](./specification.md) を参照してください。


## 4-1. プロモーション動画の制作手順

動画制作は、「AIで動画構成と定義データを生成する」ステップと、「ブラウザで録画・保存する」ステップの2段階で進めます。

---

### Step 1: 動画構成と定義データの生成（AI活用）

1. **動画構成案（`movie_contents.md`）の生成と確認**
   - [book/prompt.md の「4-1. ショート動画構成案（movie_contents.md）の抽出・生成」](../prompt.md#4-1-ショート動画構成案movie_contentsmdの抽出生成) プロンプト（または `book-assistant` スキル）を実行し、本文（[book/contents.md](../contents.md)）から [movie_contents.md](./movie_contents.md) を自動生成します。
   - 生成されたテーマ一覧を確認し、必要に応じて採用テーマの取捨選択や文言の微調整を行います。
2. **動画定義（`recorder/movies.js`）へのコンバート**
   - [book/prompt.md の「4-2. ショート動画定義（movies.js）の生成」](../prompt.md#4-2-ショート動画定義moviesjsの生成) プロンプト（または `book-assistant` スキル）を実行し、[movie_contents.md](./movie_contents.md) と表紙画像（[book/cover/cover.png](../cover/cover.png)）から [recorder/movies.js](./recorder/movies.js) を自動生成します。
   - ※背景プリセット・カラーパレット・BGM音源・BGM再生区間・効果音（SE）・表示秒数などは `movies.js` 内でカスタマイズ可能です（設定の詳細は [specification.md](./specification.md) を参照）。

---

### Step 2: 録画と自動保存（機械的作業）

定義ができたら、ブラウザ上で再生しながら録画します。

1. **録画サーバーを起動**:
   ```sh
   # Git Bash または Linux/macOS ターミナルで実行
   ./book/promote/run_server.sh
   ```
2. **ブラウザで録画画面を開く**:
   - Google Chrome または Microsoft Edge で **`http://localhost:8000/recorder/index.html`** を開きます。
3. **録画の実行**:
   - 画面右側のリストから録画したい動画のボタン（例:「動画 01 を録画」）をクリックします。
   - 画面共有ダイアログが表示されるので、**「このタブ（Chromeのタブ / Edgeのタブ）」** を選択して「共有」をクリックします。
   - 再生終了後、FastStart 形式のMP4動画として **[book/promote/movie/](./movie/)** 配下へ自動保存されます（録画済みのボタンには `☑` が付きます）。


---

## 制作完了後の活用

生成された動画（`book/promote/movie/*.mp4`）は、そのまま各SNSプラットフォーム（YouTube Shorts、TikTok、Instagram Reels）へアップロードしてご活用ください。

### SNS説明文

SNSの概要欄やコメント欄に貼り付ける紹介文です（[book/prompt.md の「4-3. プロモーション動画用『SNS説明文（＋ハッシュタグ5つ）』の生成」](../prompt.md#4-3-プロモーション動画用sns説明文ハッシュタグ5つの生成) プロンプトで作成可能）。

```text
電子書籍と紙書籍、2つの原稿管理や面倒な組版・ルビ振りに消耗していませんか？

個人出版における最大の壁は、データ形式の違いによる二重管理と技術的な手間です。本書は、1つのMarkdown原稿から高品質な縦書きEPUB・ペーパーバック印刷用PDF・プロモーション動画までを一貫して生み出す「単一源泉（シングルソース）出版基盤」の実践ガイドです。

・AI壁打ちによる「読まれるテーマ発掘と多角的推敲」
・自然なカッコ書きから自動変換される「美しい縦書き・ルビ組版」
・ワンコマンドで完了する「EPUB＆紙書籍PDFの一括ビルド」
・ブラウザ録画だけで量産できる「縦型ショート動画プロモーション」

📖 書籍『書籍出版テンプレート利用の手引き』（Amazon Kindle / ペーパーバックにて配信中）

#個人出版 #Kindle出版 #セルフパブリッシング #執筆ツール #Markdown
```
