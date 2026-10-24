// =============================================================================
// recorder.js - ショート動画の再生・録画・ダウンロード
//
//   ボタンを押すと、割り当てられた動画を録画枠で再生しながら録画し、
//   終わったら動画ファイルとしてダウンロードする。
//   録画には画面共有（getDisplayMedia）と Region Capture（CropTarget）を使い、
//   録画枠（#stage-frame）の範囲だけを切り取る。Chrome / Edge 専用。
//   枠は 9:16 の比率を保ち、画面サイズに合わせて最適化された解像度で録画する。
// =============================================================================

// ===== 調整用の定数 ==========================================================
const SCROLL_SPEED_PX_PER_SEC = 200; // 前景のスクロール速度（1080x1920 基準のピクセル/秒）
const LEAD_IN_SEC = 1.0;             // 録画開始から前景が動き出すまでの秒数
const LEAD_OUT_SEC = 0.5;            // 前景が流れ切ってから録画を止めるまでの秒数
const FRAME_RATE = 30;               // 録画のフレームレート
const VIDEO_BITS_PER_SECOND = 8_000_000; // 録画のビットレート
const BGM_SRC = "../background/296_BPM85_BGMアコースティック受け継がれてゆく心.mp3"; // 動画に付けるBGM
const BGM_VOLUME = 0.8;              // BGMの音量（0.0 〜 1.0）
// ============================================================================

const STAGE_WIDTH = 1080;  // 録画枠のデザイン基準サイズ（座標系）
const STAGE_HEIGHT = 1920;

// 録画形式の候補（上から順に、ブラウザが対応しているものを使う）
const MIME_CANDIDATES = [
  { mime: "video/mp4;codecs=avc1.640028,mp4a.40.2", ext: "mp4" },
  { mime: "video/mp4;codecs=avc1,mp4a.40.2", ext: "mp4" },
  { mime: "video/mp4", ext: "mp4" },
  { mime: "video/webm;codecs=vp9,opus", ext: "webm" },
  { mime: "video/webm;codecs=vp8,opus", ext: "webm" },
  { mime: "video/webm", ext: "webm" },
];

const frameEl = document.getElementById("stage-frame");
const stageEl = document.getElementById("stage");
const bgVideoEl = document.getElementById("bg-video");
const textEl = document.getElementById("stage-text");
const listEl = document.getElementById("movie-list");
const statusEl = document.getElementById("status");
const panelEl = document.querySelector(".panel");

let captureStream = null; // 画面共有のストリーム（2本目以降は使い回す）
let isRecording = false;
let scrollAnimation = null;
let canRecord = true;

let audioCtx = null;
let bgmAudioEl = null;
let bgmDestination = null;
let bgmGainNode = null;

// -----------------------------------------------------------------------------
// BGMの初期化（Web Audio APIで音量を調整し、録画用トラックとスピーカー出力に接続）
// -----------------------------------------------------------------------------
function ensureBgm() {
  if (!bgmAudioEl) {
    bgmAudioEl = new Audio();
    bgmAudioEl.src = new URL(BGM_SRC, location.href).href;
    bgmAudioEl.loop = true;
    bgmAudioEl.preload = "auto";

    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    audioCtx = new AudioContextClass();
    const sourceNode = audioCtx.createMediaElementSource(bgmAudioEl);
    bgmGainNode = audioCtx.createGain();
    bgmGainNode.gain.value = BGM_VOLUME;
    bgmDestination = audioCtx.createMediaStreamDestination();

    // source -> gainNode -> bgmDestination (録画用音声トラックへ)
    //                    -> audioCtx.destination (PCスピーカーへ出力)
    sourceNode.connect(bgmGainNode);
    bgmGainNode.connect(bgmDestination);
    bgmGainNode.connect(audioCtx.destination);
  }

  if (audioCtx.state === "suspended") {
    audioCtx.resume();
  }
}

// -----------------------------------------------------------------------------
// 録画枠の表示倍率を決める（録画中は変えない）
//   画面の高さ・幅に合わせて 9:16 の比率を維持したまま最大化する
// -----------------------------------------------------------------------------
function fitStage() {
  if (isRecording) return;
  const availW = window.innerWidth - panelEl.offsetWidth - 24 - 32;
  const availH = window.innerHeight;
  const scale = Math.min(availW / STAGE_WIDTH, availH / STAGE_HEIGHT, 1.0);
  
  // 極端に小さい場合（高さ400px未満）は録画を一時停止
  canRecord = availH >= 400 && availW >= 225;
  
  frameEl.style.width = `${Math.floor(STAGE_WIDTH * scale)}px`;
  frameEl.style.height = `${Math.floor(STAGE_HEIGHT * scale)}px`;
  stageEl.style.transform = `scale(${scale})`;

  if (!canRecord) {
    setStatus("ウィンドウが小さすぎるため録画できません。\nウィンドウを大きくしてください。");
  } else if (statusEl.textContent.startsWith("ウィンドウが小さすぎる")) {
    setStatus("");
  }
}

// -----------------------------------------------------------------------------
// 動画1本ぶんの準備（背景・前景を差し替え、スクロールを開始位置に戻す）
//   戻り値: 録画する秒数
// -----------------------------------------------------------------------------
async function prepareStage(movie) {
  // タイトル表示（movies.jsから動的に設定）
  const titleMainEl = document.querySelector(".stage-title-main");
  if (titleMainEl) {
    titleMainEl.textContent = window.BOOK_TITLE || "書籍タイトル";
  }
  const titleSubEl = document.querySelector(".stage-title-sub");
  if (titleSubEl) {
    titleSubEl.textContent = movie.title || movie.subtitle || "書籍内容紹介";
  }

  // 前景
  textEl.innerHTML = movie.lines.map((line) => `<p>${line}</p>`).join("");
  await document.fonts.ready;

  // 左端の外（前景の右端が枠の左端に接する位置）から、
  // 右端の外（前景の左端が枠の右端に接する位置）まで流す
  const textWidth = textEl.offsetWidth;
  const distance = textWidth + STAGE_WIDTH;
  const scrollMs = (distance / SCROLL_SPEED_PX_PER_SEC) * 1000;

  if (scrollAnimation) scrollAnimation.cancel();
  scrollAnimation = textEl.animate(
    [
      { transform: `translateX(${-textWidth}px)` },
      { transform: `translateX(${STAGE_WIDTH}px)` },
    ],
    { duration: scrollMs, delay: LEAD_IN_SEC * 1000, easing: "linear", fill: "both" }
  );
  scrollAnimation.pause();
  scrollAnimation.currentTime = 0;

  // 背景
  const src = new URL(movie.background, location.href).href;
  if (bgVideoEl.src !== src) {
    bgVideoEl.src = src;
    await new Promise((resolve, reject) => {
      bgVideoEl.addEventListener("loadeddata", resolve, { once: true });
      bgVideoEl.addEventListener("error", () => reject(new Error(`背景動画を読み込めません: ${movie.background}`)), { once: true });
    });
  }
  bgVideoEl.pause();
  bgVideoEl.currentTime = 0;
  await new Promise((resolve) => bgVideoEl.addEventListener("seeked", resolve, { once: true }));

  return LEAD_IN_SEC + scrollMs / 1000 + LEAD_OUT_SEC;
}

// -----------------------------------------------------------------------------
// 画面共有を開始し、録画枠だけに切り取る
// -----------------------------------------------------------------------------
async function ensureCapture() {
  if (captureStream && captureStream.getVideoTracks()[0]?.readyState === "live") {
    return captureStream;
  }
  if (!("CropTarget" in window)) {
    throw new Error("このブラウザは Region Capture に対応していません（Chrome / Edge を使ってください）");
  }

  const stream = await navigator.mediaDevices.getDisplayMedia({
    video: {
      frameRate: FRAME_RATE,
    },
    audio: false,
    preferCurrentTab: true,
    selfBrowserSurface: "include",
  });
  const [track] = stream.getVideoTracks();
  try {
    const cropTarget = await CropTarget.fromElement(frameEl);
    await track.cropTo(cropTarget);
  } catch (e) {
    stream.getTracks().forEach((t) => t.stop());
    throw new Error("録画枠を切り取れませんでした。共有先には「このタブ」を選んでください");
  }
  track.addEventListener("ended", () => {
    captureStream = null;
  });
  captureStream = stream;
  return stream;
}

function pickFormat() {
  const found = MIME_CANDIDATES.find((c) => MediaRecorder.isTypeSupported(c.mime));
  if (!found) throw new Error("このブラウザで使える録画形式がありません");
  return found;
}

function download(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

// 録画した動画の解像度を調べる（確認表示用）
async function getVideoSize(blob) {
  const url = URL.createObjectURL(blob);
  try {
    const v = document.createElement("video");
    v.muted = true;
    v.src = url;
    await new Promise((resolve, reject) => {
      v.addEventListener("loadedmetadata", resolve, { once: true });
      v.addEventListener("error", () => reject(new Error("録画した動画を読み込めません")), { once: true });
    });
    return { width: v.videoWidth, height: v.videoHeight };
  } finally {
    URL.revokeObjectURL(url);
  }
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const nextFrame = () => new Promise((resolve) => requestAnimationFrame(() => resolve()));

function setStatus(message) {
  statusEl.textContent = message;
}

function setButtonsDisabled(disabled, activeButton = null) {
  listEl.querySelectorAll("button").forEach((b) => {
    b.disabled = disabled;
    b.classList.toggle("is-recording", b === activeButton);
  });
}

// -----------------------------------------------------------------------------
// 再生＆録画＆ダウンロード
// -----------------------------------------------------------------------------
async function playAndRecord(movie, button) {
  setButtonsDisabled(true, button);
  try {
    if (!canRecord) {
      throw new Error("ウィンドウが小さいため録画できません。全画面表示（F11）にするか、ウィンドウを大きくしてください");
    }
    setStatus("画面共有を準備しています…");
    const stream = await ensureCapture();
    ensureBgm();

    // 共有開始により表示領域が狭くなった場合に備えて、もう一度確かめる
    await wait(300);
    fitStage();
    if (!canRecord) {
      throw new Error("画面共有の開始後、ウィンドウが小さくなったため録画できません。全画面表示（F11）にしてください");
    }

    isRecording = true;
    setStatus(`動画 ${movie.id} を準備しています…`);
    const durationSec = await prepareStage(movie);

    // 表示が落ち着くのを待つ
    await wait(300);
    await nextFrame();
    await nextFrame();

    // 画面キャプチャの映像トラックと、BGMの音声トラックを合成する
    const videoTrack = stream.getVideoTracks()[0];
    const audioTrack = bgmDestination.stream.getAudioTracks()[0];
    const recordStream = new MediaStream([videoTrack, audioTrack]);

    const format = pickFormat();
    const recorder = new MediaRecorder(recordStream, {
      mimeType: format.mime,
      videoBitsPerSecond: VIDEO_BITS_PER_SECOND,
    });
    const chunks = [];
    recorder.addEventListener("dataavailable", (e) => {
      if (e.data.size > 0) chunks.push(e.data);
    });
    const stopped = new Promise((resolve) => recorder.addEventListener("stop", resolve, { once: true }));

    recorder.start();
    bgVideoEl.play();
    scrollAnimation.play();
    bgmAudioEl.currentTime = 0;
    bgmAudioEl.play();
    setStatus(`動画 ${movie.id} を録画中…（約 ${durationSec.toFixed(1)} 秒）`);

    await wait(durationSec * 1000);
    recorder.stop();
    bgmAudioEl.pause();
    await stopped;
    bgVideoEl.pause();

    const blob = new Blob(chunks, { type: format.mime });
    const baseName = movie.filename || `movie_${movie.id}`;
    const filename = `${baseName}.${format.ext}`;
    const size = await getVideoSize(blob);

    // サーバー（server.py）への保存を試みる
    let savedViaServer = false;
    try {
      setStatus(`動画 ${movie.id} を保存しています…`);
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 15000);
      const res = await fetch(`/api/save-movie?filename=${encodeURIComponent(filename)}`, {
        method: "POST",
        body: blob,
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      if (res.ok) {
        const result = await res.json();
        if (result.success) {
          savedViaServer = true;
          updateButtonCheckmark(movie.id, true);
          setStatus(`${filename} を保存しました（movie/ フォルダ）\n長さ: 約 ${durationSec.toFixed(1)} 秒 / 解像度: ${size.width}x${size.height} (9:16)`);
        }
      }
    } catch (e) {
      savedViaServer = false;
    }

    // サーバー保存ができなかった場合はブラウザからダウンロード
    if (!savedViaServer) {
      download(blob, filename);
      updateButtonCheckmark(movie.id, true);
      setStatus(`${filename} をダウンロードしました\n長さ: 約 ${durationSec.toFixed(1)} 秒 / 解像度: ${size.width}x${size.height} (9:16)`);
    }
  } catch (e) {
    console.error(e);
    setStatus(`エラー: ${e.message}`);
  } finally {
    if (bgmAudioEl) {
      bgmAudioEl.pause();
    }
    isRecording = false;
    setButtonsDisabled(false);
    fitStage();
  }
}

// -----------------------------------------------------------------------------
// ダウンロード（保存）済み状態の管理
//   movie/ フォルダ内の実ファイルの有無と厳密に同期する
// -----------------------------------------------------------------------------
function updateButtonCheckmark(movieId, isDownloaded) {
  const button = document.getElementById(`record-${movieId}`);
  if (!button) return;
  const idEl = button.querySelector(".movie-button-id");
  if (!idEl) return;
  const label = `動画 ${movieId} を録画`;
  idEl.textContent = isDownloaded ? `☑ ${label}` : label;
  button.classList.toggle("is-downloaded", isDownloaded);
}

async function checkExistingMovies() {
  // 以前の古い localStorage キャッシュがあれば破棄
  try {
    localStorage.removeItem("cherryboys_downloaded_movies");
  } catch {}

  // 1. サーバーAPI（server.py）が利用可能な場合
  try {
    const res = await fetch("/api/movies-status", { cache: "no-store" });
    if (res.ok) {
      const data = await res.json();
      if (data.success && Array.isArray(data.files)) {
        const fileSet = new Set(data.files);
        window.MOVIES.forEach((movie) => {
          const baseName = movie.filename || `movie_${movie.id}`;
          const exists = fileSet.has(`${baseName}.mp4`);
          updateButtonCheckmark(movie.id, exists);
        });
        return;
      }
    }
  } catch (e) {
    // サーバーAPIが利用できない場合は静的チェックへフォールバック
  }

  // 2. 静的サーバー（python -m http.server 等）向けのフォールバック判定
  await Promise.all(
    window.MOVIES.map(async (movie) => {
      const baseName = movie.filename || `movie_${movie.id}`;
      try {
        const res = await fetch(`../movie/${encodeURIComponent(baseName)}.mp4`, {
          method: "HEAD",
          cache: "no-store",
        });
        updateButtonCheckmark(movie.id, res.ok);
      } catch {
        updateButtonCheckmark(movie.id, false);
      }
    })
  );
}

// -----------------------------------------------------------------------------
// 初期化
// -----------------------------------------------------------------------------
function plainText(html) {
  const div = document.createElement("div");
  div.innerHTML = html.replace(/<rt>.*?<\/rt>/g, "");
  return div.textContent;
}

function buildButtons() {
  window.MOVIES.forEach((movie) => {
    const li = document.createElement("li");
    const button = document.createElement("button");
    button.type = "button";
    button.id = `record-${movie.id}`;
    button.className = "movie-button";
    button.innerHTML = `<span class="movie-button-id">動画 ${movie.id} を録画</span><span class="movie-button-text"></span>`;
    button.querySelector(".movie-button-text").textContent = plainText(movie.lines.join(""));
    button.addEventListener("click", () => playAndRecord(movie, button));
    li.appendChild(button);
    listEl.appendChild(li);
  });
}

window.addEventListener("resize", fitStage);
const initialTitleEl = document.querySelector(".stage-title-main");
if (initialTitleEl && window.BOOK_TITLE) {
  initialTitleEl.textContent = window.BOOK_TITLE;
}
const initialSubEl = document.querySelector(".stage-title-sub");
if (initialSubEl) {
  initialSubEl.textContent = window.MOVIES[0]?.title || window.MOVIES[0]?.subtitle || "書籍内容紹介";
}
buildButtons();
checkExistingMovies();
fitStage();
if (window.MOVIES.length > 0) {
  prepareStage(window.MOVIES[0]).catch((e) => setStatus(`エラー: ${e.message}`));
}
