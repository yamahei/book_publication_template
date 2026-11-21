// =============================================================================
// movies.js - ショート動画の定義一覧（1文1ページ・起承転結構成）
//
//   BOOK_CONFIG : 書籍全体の基本設定（表紙を踏襲したカラーテーマ・BGM/SE・秒数基準）
//   MOVIES      : 各動画の配列（1動画1テーマ、起1ページ＋承転2〜4ページ＋結1ページ）
// =============================================================================

window.BOOK_CONFIG = {
  title: "書籍出版テンプレート利用の手引き",
  ctaText: "続きは本書で",
  coverImage: "/api/cover", // 表紙画像（server.py 経由で book/cover/cover.png を表示。非表示は ""）

  // 背景プリセットとカラーパレット（book/cover/cover.png の藍色和紙・幾何学デザインを踏襲）
  theme: {
    preset: "washi", // "washi"（和紙・布目） | "modern"（知的グラデ・微粒子） | "classic"（重厚ビネット） | "video"（背景動画）
    baseColor: "#314357", // 背景の基調色（cover.png のスレートネイビー・藍色）
    subColor: "#1d2936",  // 背景の同系暗部色
    textColor: "#f4f7fa", // 基本文字色（白）
    accentColor: "#ebd095", // 強調文字（<em>）の彩り色（藍色の上で品よく映えるシャンパンゴールド）
    phase4Shade: "rgba(10, 15, 22, 0.56)", // 【結】で表紙を際立たせるための半透明背景
  },

  // 音響設定（外部音声ファイルのパスを指定すれば任意の音源に差し替え可能）
  audio: {
    bgm: "../background/296_BPM85_BGMアコースティック受け継がれてゆく心.mp3",
    bgmVolume: 0.42,
    // BGMを鳴らすタイミング:
    //   "middle_only" : 【承・転】（フェーズ2,3）のみBGM再生（【起】と【結】は無音・デフォルト推奨）
    //   "from_phase2" : 【起】は無音、【承・転・結】（フェーズ2,3,4）でBGM再生
    //   "ending_only" : 【結】（フェーズ4）のみBGM再生
    //   "all"         : 最初から最後までBGM再生
    //   "none"        : BGMなし
    bgmTiming: "middle_only",
    // 内蔵SE: "builtin:question" | "builtin:page" | "builtin:deep" | "builtin:ending" | "builtin:subline"
    // 無音: "none" / 外部音源: "../background/xxx.mp3"
    se: {
      起: "builtin:question",
      承: "builtin:page",
      転: "builtin:deep",
      結: "builtin:ending",
      subline: "builtin:subline", // 1ページ内の2行目が時間差で出る瞬間のスナップ音（"none"で無効化可）
    },
    seVolume: 0.3,
  },

  // 秒数基準（各ページに durationSec を個別指定した場合はそちらを優先）
  timing: {
    leadInSec: 0.35,
    kiSec: 2.4,          // 【起】（1ページ目）の表示秒数
    pageBaseSec: 2.2,    // 【承・転】1行ページの基準秒数
    twoLineAddSec: 0.65, // 【承・転】2行ページ（時間差表示）の追加秒数
    sublineDelayMs: 550, // 1行目が出てから2行目が出るまでの時間差（ミリ秒）
    ketsuSec: 3.8,       // 【結】（表紙・誘導）の表示秒数
    leadOutSec: 0.4,
  },
};

window.MOVIES = [
  {
    id: "01",
    filename: "書籍出版の手引き_01_単一源泉化",
    title: "出版の壁と単一源泉化",
    pages: [
      { role: "起", lines: ["なぜ個人出版は<em>挫折</em>するのか。"] },
      { role: "承", lines: ["電子書籍と紙書籍では、", "求められるデータ形式が全く異なる。"] },
      { role: "承", lines: ["別々に原稿を管理すれば、", "修正のたびに<em>二重の作業</em>が生じる。"] },
      { role: "転", lines: ["ひとつの原稿から両方を生み出す", "<em><ruby>単一源泉<rt>シングルソース</rt></ruby>化</em>がすべてを変える。"] },
    ],
    ending: {
      subtitle: "出版の壁と単一源泉化",
      cta: "続きは本書で",
    },
  },
  {
    id: "02",
    filename: "書籍出版の手引き_02_テーマ選定",
    title: "世間が求めるテーマの発見",
    pages: [
      { role: "起", lines: ["あなたの本は、<em>誰の悩み</em>を救うのか。"] },
      { role: "承", lines: ["どれほど情熱を注いでも、", "読者に価値がなければ本は埋もれる。"] },
      { role: "転", lines: ["世間の悩みと自分の経験が交わる場所に", "<em>真のテーマ</em>がある。"] },
      { role: "転", lines: ["AIとの対話が、あなた自身も気づかぬ", "<em>独自の切り口</em>を引き出す。"] },
    ],
    ending: {
      subtitle: "世間が求めるテーマの発見",
      cta: "続きは本書で",
    },
  },
  {
    id: "03",
    filename: "書籍出版の手引き_03_AI推敲",
    title: "AIと共創する推敲と校正",
    pages: [
      { role: "起", lines: ["自分の文章を、<em>客観視</em>できているか。"] },
      { role: "承", lines: ["一人で書き上げた初稿には、", "気づかぬ<em>論理の飛躍</em>が潜んでいる。"] },
      { role: "転", lines: ["AIは代筆ではなく、", "原稿を多角的に磨く<em>優秀な編集者</em>になる。"] },
    ],
    ending: {
      subtitle: "AIと共創する推敲と校正",
      cta: "続きは本書で",
    },
  },
  {
    id: "04",
    filename: "書籍出版の手引き_04_自動組版",
    title: "縦書き組版とルビの自動化",
    pages: [
      { role: "起", lines: ["組版や<em>ルビ振り</em>に消耗していないか。"] },
      { role: "承", lines: ["縦書きの余白やルビタグを、", "手作業で整えるのは限界がある。"] },
      { role: "転", lines: ["自然なカッコ書きから、", "<em>美しい縦書きとルビ</em>が自動生成される。"] },
    ],
    ending: {
      subtitle: "縦書き組版とルビの自動化",
      cta: "続きは本書で",
    },
  },
  {
    id: "05",
    filename: "書籍出版の手引き_05_装丁と宣伝",
    title: "装丁とショート動画宣伝",
    pages: [
      { role: "起", lines: ["出版後の<em>宣伝</em>まで手が回っているか。"] },
      { role: "承", lines: ["紙の表紙作成や動画編集は、", "多くの著者にとって<em>高い壁</em>になる。"] },
      { role: "転", lines: ["同梱ツールを使えば、", "<em>表紙PDFも宣伝動画</em>も手軽に量産できる。"] },
    ],
    ending: {
      subtitle: "装丁とショート動画宣伝",
      cta: "続きは本書で",
    },
  },
];
