// =============================================================================
// recorder.js - ショート動画の再生・録画・ダウンロード（1文1ページ・起承転結構成）
//
//   ボタンを押すと、割り当てられた動画を録画枠（1080x1920）で再生しながら録画し、
//   終わったらサーバー経由で FastStart MP4 として movie/ に保存する。
//   録画には画面共有（getDisplayMedia）と Region Capture（CropTarget）を使い、
//   録画枠（#stage-frame）の範囲だけを切り取る。Chrome / Edge 専用。
// =============================================================================

const STAGE_WIDTH = 1080;  // 録画枠のデザイン基準サイズ（座標系）
const STAGE_HEIGHT = 1920;
const FRAME_RATE = 30;
const VIDEO_BITS_PER_SECOND = 8_000_000;

// デフォルト設定（movies.js の window.BOOK_CONFIG で上書き可能）
const DEFAULT_CONFIG = {
  title: window.BOOK_TITLE || "書籍タイトル",
  ctaText: "続きは本書で",
  coverImage: "/api/cover",
  theme: {
    preset: "washi", // "washi" | "modern" | "classic" | "video"
    baseColor: "#314357", // cover.png の基調色
    subColor: "#1d2936",  // 穏やかな同系暗部色
    textColor: "#f4f7fa",
    accentColor: "#ebd095",
    phase4Shade: "rgba(10, 15, 22, 0.56)",
  },
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
    se: {
      起: "builtin:question",
      承: "builtin:page",
      転: "builtin:deep",
      結: "builtin:ending",
      subline: "builtin:subline", // 1ページ内の2行目出現時の軽いスナップ音（"none"で無効化可）
    },
    seVolume: 0.3,
  },
  timing: {
    leadInSec: 0.35,
    kiSec: 2.4,         // 【起】（1ページ目）の表示秒数
    pageBaseSec: 2.2,   // 【承・転】1行ページの基準秒数
    twoLineAddSec: 0.65,// 【承・転】2行ページ（時間差表示）の追加秒数
    sublineDelayMs: 550,// 1行目が出てから2行目が出るまでの時間差（ミリ秒）
    ketsuSec: 3.8,      // 【結】（表紙・誘導）の表示秒数
    leadOutSec: 0.4,
  },
};

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
const bgCanvasEl = document.getElementById("bg-canvas");
const bgVideoEl = document.getElementById("bg-video");
const phase4OverlayEl = document.getElementById("phase4-overlay");
const phaseTextAreaEl = document.getElementById("phase-text-area");
const textEl = document.getElementById("stage-text");
const phaseEndingEl = document.getElementById("phase-ending");
const endingCoverWrapEl = document.getElementById("ending-cover-wrap");
const endingCoverEl = document.getElementById("ending-cover");
const endingSubtitleEl = document.getElementById("ending-subtitle");
const endingTitleEl = document.getElementById("ending-title");
const endingCtaEl = document.getElementById("ending-cta");
const listEl = document.getElementById("movie-list");
const statusEl = document.getElementById("status");
const panelEl = document.querySelector(".panel");

let captureStream = null;
let isRecording = false;
let canRecord = true;

// 音響関連（Web Audio API）
let audioCtx = null;
let masterDestination = null; // 録画用音声ストリーム出力先（BGM + SE を合成）
let bgmAudioEl = null;
let bgmGainNode = null;
const externalSeBufferCache = new Map();

// 背景Canvasアニメーション関連
let bgAnimFrameId = null;
let bgTextureCanvas = null;
let bgTexturePreset = null;
let bgParticles = null;

// -----------------------------------------------------------------------------
// 設定のマージ・取得
// -----------------------------------------------------------------------------
function getConfig() {
  const userCfg = window.BOOK_CONFIG || {};
  return {
    title: userCfg.title || window.BOOK_TITLE || DEFAULT_CONFIG.title,
    ctaText: userCfg.ctaText ?? DEFAULT_CONFIG.ctaText,
    coverImage: userCfg.coverImage !== undefined ? userCfg.coverImage : DEFAULT_CONFIG.coverImage,
    theme: { ...DEFAULT_CONFIG.theme, ...(userCfg.theme || {}) },
    audio: {
      ...DEFAULT_CONFIG.audio,
      ...(userCfg.audio || {}),
      se: { ...DEFAULT_CONFIG.audio.se, ...(userCfg.audio?.se || {}) },
    },
    timing: { ...DEFAULT_CONFIG.timing, ...(userCfg.timing || {}) },
  };
}

function applyThemeCssVariables(theme) {
  const root = document.documentElement;
  root.style.setProperty("--stage-base-color", theme.baseColor);
  root.style.setProperty("--stage-sub-color", theme.subColor);
  root.style.setProperty("--stage-text-color", theme.textColor);
  root.style.setProperty("--stage-accent-color", theme.accentColor);
  root.style.setProperty("--phase4-shade", theme.phase4Shade);
}

// -----------------------------------------------------------------------------
// 背景プリセット描画（Canvas: washi / modern / classic）
//   washi は cover.png の和綴じ布目（縦糸・横糸の織り目とスラブ感）を再現
// -----------------------------------------------------------------------------
function buildWashiTexture() {
  const c = document.createElement("canvas");
  c.width = STAGE_WIDTH;
  c.height = STAGE_HEIGHT;
  const ctx = c.getContext("2d");

  // 1. 縦糸の織り目（2〜3px周期で明暗の縦糸を全面に走らせる）
  for (let x = 0; x < STAGE_WIDTH; x += 2) {
    const hash = Math.sin(x * 12.9898) * 43758.5453;
    const frac = hash - Math.floor(hash);
    if (frac > 0.52) {
      const alpha = 0.04 + (frac - 0.5) * 0.16;
      ctx.fillStyle = `rgba(255, 238, 232, ${alpha.toFixed(3)})`;
    } else {
      const alpha = 0.04 + (0.5 - frac) * 0.18;
      ctx.fillStyle = `rgba(55, 18, 15, ${alpha.toFixed(3)})`;
    }
    const w = frac > 0.85 ? 2 : 1;
    ctx.fillRect(x, 0, w, STAGE_HEIGHT);
  }

  // 2. 横糸の織り目（2〜3px周期で明暗の横糸を交差させる）
  for (let y = 0; y < STAGE_HEIGHT; y += 2) {
    const hash = Math.sin(y * 78.233) * 43758.5453;
    const frac = hash - Math.floor(hash);
    if (frac > 0.52) {
      const alpha = 0.035 + (frac - 0.5) * 0.15;
      ctx.fillStyle = `rgba(255, 238, 232, ${alpha.toFixed(3)})`;
    } else {
      const alpha = 0.035 + (0.5 - frac) * 0.17;
      ctx.fillStyle = `rgba(55, 18, 15, ${alpha.toFixed(3)})`;
    }
    const h = frac > 0.85 ? 2 : 1;
    ctx.fillRect(0, y, STAGE_WIDTH, h);
  }

  // 3. 紬（つむぎ）・麻布特有の節（スラブ：部分的に少し太い繊維の筋）
  for (let i = 0; i < 650; i++) {
    const isVertical = i % 2 === 0;
    const x = (i * 173) % STAGE_WIDTH;
    const y = (i * 257) % STAGE_HEIGHT;
    const len = 80 + (i % 180);
    const isLight = i % 3 === 0;
    ctx.fillStyle = isLight ? "rgba(255, 240, 235, 0.065)" : "rgba(45, 12, 10, 0.075)";
    if (isVertical) {
      ctx.fillRect(x, y, 2, len);
    } else {
      ctx.fillRect(x, y, len, 2);
    }
  }

  return c;
}

function buildClassicTexture() {
  const c = document.createElement("canvas");
  c.width = STAGE_WIDTH;
  c.height = STAGE_HEIGHT;
  const ctx = c.getContext("2d");

  for (let i = 0; i < 3200; i++) {
    const x = (i * 97) % STAGE_WIDTH;
    const y = (i * 193) % STAGE_HEIGHT;
    const r = 0.8 + (i % 3) * 0.6;
    ctx.fillStyle = i % 2 === 0 ? "rgba(255, 255, 255, 0.03)" : "rgba(0, 0, 0, 0.035)";
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  return c;
}

function ensureBgResources(preset) {
  if (preset === "washi" && bgTexturePreset !== "washi") {
    bgTextureCanvas = buildWashiTexture();
    bgTexturePreset = "washi";
  } else if (preset === "classic" && bgTexturePreset !== "classic") {
    bgTextureCanvas = buildClassicTexture();
    bgTexturePreset = "classic";
  }
  if (!bgParticles) {
    bgParticles = Array.from({ length: 36 }, (_, i) => ({
      x: (((i * 137) % 1000) / 1000) * STAGE_WIDTH,
      y: (((i * 293) % 1000) / 1000) * STAGE_HEIGHT,
      r: 2.0 + (i % 5) * 1.4,
      speedY: -14 - (i % 7) * 4,
      speedX: ((i % 5) - 2) * 3,
      phase: i * 0.7,
    }));
  }
}

function renderBackgroundFrame(timestampMs) {
  const cfg = getConfig();
  const { preset, baseColor, subColor, accentColor } = cfg.theme;
  if (preset === "video") return;

  ensureBgResources(preset);
  const ctx = bgCanvasEl.getContext("2d");
  const t = timestampMs / 1000;

  ctx.clearRect(0, 0, STAGE_WIDTH, STAGE_HEIGHT);

  if (preset === "washi") {
    // 表紙の明るい色味（baseColor）をベースに、ごく穏やかな濃淡グラデーションを敷く
    const cx = STAGE_WIDTH * (0.48 + Math.sin(t * 0.4) * 0.08);
    const cy = STAGE_HEIGHT * (0.42 + Math.cos(t * 0.32) * 0.08);
    const grad = ctx.createRadialGradient(cx, cy, 120, STAGE_WIDTH * 0.5, STAGE_HEIGHT * 0.5, 1300);
    grad.addColorStop(0, baseColor);
    grad.addColorStop(1, subColor);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, STAGE_WIDTH, STAGE_HEIGHT);

    // 表面に緩やかな陽だまりのゆらぎ
    const lx = STAGE_WIDTH * (0.35 + Math.cos(t * 0.5) * 0.22);
    const ly = STAGE_HEIGHT * (0.32 + Math.sin(t * 0.42) * 0.22);
    const lightGrad = ctx.createRadialGradient(lx, ly, 40, lx, ly, 780);
    lightGrad.addColorStop(0, "rgba(255, 245, 238, 0.14)");
    lightGrad.addColorStop(1, "rgba(255, 245, 238, 0)");
    ctx.fillStyle = lightGrad;
    ctx.fillRect(0, 0, STAGE_WIDTH, STAGE_HEIGHT);

    // 和綴じ布目テクスチャを重ねる
    if (bgTextureCanvas) {
      ctx.drawImage(bgTextureCanvas, 0, 0);
    }
  } else if (preset === "modern") {
    const x0 = STAGE_WIDTH * (0.2 + Math.sin(t * 0.3) * 0.15);
    const y0 = STAGE_HEIGHT * 0.1;
    const x1 = STAGE_WIDTH * (0.8 - Math.sin(t * 0.3) * 0.15);
    const y1 = STAGE_HEIGHT * 0.9;
    const grad = ctx.createLinearGradient(x0, y0, x1, y1);
    grad.addColorStop(0, baseColor);
    grad.addColorStop(1, subColor);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, STAGE_WIDTH, STAGE_HEIGHT);

    ctx.save();
    for (const p of bgParticles) {
      const px = (p.x + p.speedX * t + STAGE_WIDTH) % STAGE_WIDTH;
      const py = (p.y + p.speedY * t + STAGE_HEIGHT * 10) % STAGE_HEIGHT;
      const alpha = 0.15 + (Math.sin(t * 1.4 + p.phase) + 1) * 0.16;
      ctx.fillStyle = accentColor;
      ctx.globalAlpha = alpha;
      ctx.beginPath();
      ctx.arc(px, py, p.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  } else {
    ctx.fillStyle = subColor;
    ctx.fillRect(0, 0, STAGE_WIDTH, STAGE_HEIGHT);

    const pulse = 0.92 + Math.sin(t * 0.6) * 0.08;
    const grad = ctx.createRadialGradient(
      STAGE_WIDTH * 0.5,
      STAGE_HEIGHT * 0.46,
      50,
      STAGE_WIDTH * 0.5,
      STAGE_HEIGHT * 0.48,
      980 * pulse
    );
    grad.addColorStop(0, baseColor);
    grad.addColorStop(1, subColor);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, STAGE_WIDTH, STAGE_HEIGHT);

    if (bgTextureCanvas) {
      ctx.drawImage(bgTextureCanvas, 0, 0);
    }
  }
}

function startBackgroundLoop() {
  if (bgAnimFrameId) return;
  const loop = (ts) => {
    renderBackgroundFrame(ts);
    bgAnimFrameId = requestAnimationFrame(loop);
  };
  bgAnimFrameId = requestAnimationFrame(loop);
}

// -----------------------------------------------------------------------------
// 音響エンジン（BGM + キレのある明瞭なSE を Web Audio API で合成）
// -----------------------------------------------------------------------------
function ensureAudioEngine() {
  const cfg = getConfig();
  if (!audioCtx) {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    audioCtx = new AudioContextClass();
    masterDestination = audioCtx.createMediaStreamDestination();
  }
  if (audioCtx.state === "suspended") {
    audioCtx.resume();
  }

  let bgmPath = (cfg.audio.bgm || "").trim();
  if (bgmPath && bgmPath !== "none") {
    // パス記述ミスの自動補完（"../backgroundファイル名" や "ファイル名のみ" でも "../background/ファイル名" として解決）
    if (bgmPath.startsWith("../background") && !bgmPath.startsWith("../background/")) {
      bgmPath = "../background/" + bgmPath.slice("../background".length);
    } else if (!bgmPath.includes("/")) {
      bgmPath = "../background/" + bgmPath;
    }
    const targetSrc = new URL(bgmPath, location.href).href;
  if (!bgmAudioEl) {
    bgmAudioEl = new Audio();
    bgmAudioEl.loop = true;
    bgmAudioEl.preload = "auto";
      bgmAudioEl.addEventListener("error", () => {
        console.warn("BGMファイルを読み込めません:", bgmPath);
        setStatus(`警告: BGMファイルを読み込めません (${bgmPath})`);
      });
    const sourceNode = audioCtx.createMediaElementSource(bgmAudioEl);
    bgmGainNode = audioCtx.createGain();
    sourceNode.connect(bgmGainNode);
      bgmGainNode.connect(masterDestination);
    bgmGainNode.connect(audioCtx.destination);
  }
    if (bgmAudioEl.src !== targetSrc) {
      bgmAudioEl.src = targetSrc;
    }
    bgmGainNode.gain.value = cfg.audio.bgmVolume ?? 0.42;
  }
}

function startBgmIfNeeded() {
  const cfg = getConfig();
  if (!bgmAudioEl || !bgmAudioEl.src || cfg.audio.bgm === "none") return;
  const targetVol = cfg.audio.bgmVolume ?? 0.42;
  if (bgmGainNode && audioCtx) {
    bgmGainNode.gain.cancelScheduledValues(audioCtx.currentTime);
    bgmGainNode.gain.setValueAtTime(targetVol, audioCtx.currentTime);
  }
  if (bgmAudioEl.paused) {
    bgmAudioEl.currentTime = 0;
    bgmAudioEl.play().catch(() => {});
  }
}

function stopBgmIfNeeded(fadeOutSec = 0) {
  if (!bgmAudioEl || bgmAudioEl.paused) return;
  if (fadeOutSec > 0 && bgmGainNode && audioCtx) {
    const now = audioCtx.currentTime;
    bgmGainNode.gain.cancelScheduledValues(now);
    bgmGainNode.gain.setValueAtTime(bgmGainNode.gain.value, now);
    bgmGainNode.gain.linearRampToValueAtTime(0.0001, now + fadeOutSec);
    setTimeout(() => {
      if (bgmAudioEl) bgmAudioEl.pause();
    }, fadeOutSec * 1000);
  } else {
    bgmAudioEl.pause();
  }
}

function connectSeNode(node) {
  node.connect(masterDestination);
  node.connect(audioCtx.destination);
}

// 短いノイズバースト（打撃音のアタック成分）を生成するヘルパー
function playNoiseTransient(now, durationSec, filterType, freq, q, peakGain) {
  const bufferSize = Math.max(1, Math.floor(audioCtx.sampleRate * durationSec));
  const noiseBuffer = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
  const data = noiseBuffer.getChannelData(0);
  for (let i = 0; i < bufferSize; i++) {
    const env = Math.pow(1 - i / bufferSize, 2);
    data[i] = (Math.random() * 2 - 1) * env;
  }
  const noise = audioCtx.createBufferSource();
  noise.buffer = noiseBuffer;

  const filter = audioCtx.createBiquadFilter();
  filter.type = filterType;
  filter.frequency.setValueAtTime(freq, now);
  filter.Q.setValueAtTime(q, now);

  const gain = audioCtx.createGain();
  gain.gain.setValueAtTime(peakGain, now);
  gain.gain.exponentialRampToValueAtTime(0.001, now + durationSec);

  noise.connect(filter);
  filter.connect(gain);
  connectSeNode(gain);
  noise.start(now);
}

// 明瞭でキレのある効果音（SE）の再生
async function playSe(seSpec) {
  if (!seSpec || seSpec === "none" || !audioCtx) return;
  const cfg = getConfig();
  const vol = cfg.audio.seVolume ?? 0.95;
  const now = audioCtx.currentTime;

  if (seSpec === "builtin:question") {
    // 【起】：静寂を切り裂く凛とした打音＋琴・鐘の明瞭な共鳴
    // 1. 鋭い打撃アタック（ピッチ急降下 680Hz -> 140Hz）
    const punchOsc = audioCtx.createOscillator();
    const punchGain = audioCtx.createGain();
    punchOsc.type = "triangle";
    punchOsc.frequency.setValueAtTime(680, now);
    punchOsc.frequency.exponentialRampToValueAtTime(140, now + 0.065);
    punchGain.gain.setValueAtTime(vol * 0.85, now);
    punchGain.gain.exponentialRampToValueAtTime(0.001, now + 0.22);
    punchOsc.connect(punchGain);
    connectSeNode(punchGain);
    punchOsc.start(now);
    punchOsc.stop(now + 0.24);

    // 2. 拍子木・小鼓風のアタックトランジェント
    playNoiseTransient(now, 0.045, "bandpass", 1800, 1.5, vol * 0.65);

    // 3. 明瞭な中高域の倍音共鳴（A4=440Hz, E5=659.25Hz, A5=880Hz）
    const harmonics = [
      { freq: 440.0, weight: 0.45, dur: 1.1 },
      { freq: 659.25, weight: 0.35, dur: 0.9 },
      { freq: 880.0, weight: 0.25, dur: 0.75 },
    ];
    harmonics.forEach((h) => {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(h.freq, now);
      gain.gain.setValueAtTime(0.001, now);
      gain.gain.linearRampToValueAtTime(vol * h.weight, now + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0008, now + h.dur);
      osc.connect(gain);
      connectSeNode(gain);
      osc.start(now);
      osc.stop(now + h.dur + 0.02);
    });
    return;
  }

  if (seSpec === "builtin:page") {
    // 【承】：キレのある小気味よい転換音（「タンッ」）
    const snapOsc = audioCtx.createOscillator();
    const snapGain = audioCtx.createGain();
    snapOsc.type = "triangle";
    snapOsc.frequency.setValueAtTime(820, now);
    snapOsc.frequency.exponentialRampToValueAtTime(220, now + 0.045);
    snapGain.gain.setValueAtTime(vol * 0.65, now);
    snapGain.gain.exponentialRampToValueAtTime(0.001, now + 0.14);
    snapOsc.connect(snapGain);
    connectSeNode(snapGain);
    snapOsc.start(now);
    snapOsc.stop(now + 0.16);

    playNoiseTransient(now, 0.035, "bandpass", 2200, 2.0, vol * 0.5);

    // 短い明瞭なトーン（E5=659.25Hz）
    const toneOsc = audioCtx.createOscillator();
    const toneGain = audioCtx.createGain();
    toneOsc.type = "sine";
    toneOsc.frequency.setValueAtTime(659.25, now);
    toneGain.gain.setValueAtTime(vol * 0.3, now);
    toneGain.gain.exponentialRampToValueAtTime(0.001, now + 0.28);
    toneOsc.connect(toneGain);
    connectSeNode(toneGain);
    toneOsc.start(now);
    toneOsc.stop(now + 0.3);
    return;
  }

  if (seSpec === "builtin:deep") {
    // 【転】：核心へ切り込む力強い転換音（「トン・トーン」）
    const punchOsc = audioCtx.createOscillator();
    const punchGain = audioCtx.createGain();
    punchOsc.type = "triangle";
    punchOsc.frequency.setValueAtTime(580, now);
    punchOsc.frequency.exponentialRampToValueAtTime(160, now + 0.055);
    punchGain.gain.setValueAtTime(vol * 0.72, now);
    punchGain.gain.exponentialRampToValueAtTime(0.001, now + 0.18);
    punchOsc.connect(punchGain);
    connectSeNode(punchGain);
    punchOsc.start(now);
    punchOsc.stop(now + 0.2);

    playNoiseTransient(now, 0.04, "bandpass", 1900, 1.8, vol * 0.55);

    // 印象的な二音（D5=587.33Hz -> A5=880Hz）
    const notes = [
      { freq: 587.33, delay: 0.0, dur: 0.55, weight: 0.38 },
      { freq: 880.0, delay: 0.06, dur: 0.75, weight: 0.35 },
    ];
    notes.forEach((n) => {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(n.freq, now + n.delay);
      gain.gain.setValueAtTime(0.001, now + n.delay);
      gain.gain.linearRampToValueAtTime(vol * n.weight, now + n.delay + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.001, now + n.delay + n.dur);
      osc.connect(gain);
      connectSeNode(gain);
      osc.start(now + n.delay);
      osc.stop(now + n.delay + n.dur + 0.02);
    });
    return;
  }

  if (seSpec === "builtin:ending") {
    // 【結】：表紙が登場する華やかで澄んだ和音チャイム（A4 - C#5 - E5 - A5）
    const notes = [440.0, 554.37, 659.25, 880.0];
    notes.forEach((freq, idx) => {
      const start = now + idx * 0.055;
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = idx === 0 ? "triangle" : "sine";
      osc.frequency.setValueAtTime(freq, start);
      gain.gain.setValueAtTime(0.001, start);
      gain.gain.linearRampToValueAtTime(vol * (0.42 - idx * 0.06), start + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0008, start + 1.5);
      osc.connect(gain);
      connectSeNode(gain);
      osc.start(start);
      osc.stop(start + 1.55);
    });
    return;
  }

  if (seSpec === "builtin:subline") {
    // 1ページ内の2行目が時間差で出る瞬間の控えめなスナップ音（「コッ」）
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(920, now);
    osc.frequency.exponentialRampToValueAtTime(340, now + 0.03);
    gain.gain.setValueAtTime(vol * 0.32, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.075);
    osc.connect(gain);
    connectSeNode(gain);
    osc.start(now);
    osc.stop(now + 0.08);
    return;
  }

  // 外部音声ファイル（../background/xxx.mp3 等）が指定された場合
  try {
    const url = new URL(seSpec, location.href).href;
    let audioBuffer = externalSeBufferCache.get(url);
    if (!audioBuffer) {
      const res = await fetch(url);
      if (!res.ok) return;
      const arrayBuf = await res.arrayBuffer();
      audioBuffer = await audioCtx.decodeAudioData(arrayBuf);
      externalSeBufferCache.set(url, audioBuffer);
    }
    const src = audioCtx.createBufferSource();
    src.buffer = audioBuffer;
    const gain = audioCtx.createGain();
    gain.gain.setValueAtTime(vol, now);
    src.connect(gain);
    connectSeNode(gain);
    src.start(now);
  } catch (e) {
    console.warn("外部SEの再生に失敗しました:", seSpec, e);
  }
}

// -----------------------------------------------------------------------------
// 録画枠の表示倍率を決める（録画中は変えない）
// -----------------------------------------------------------------------------
function fitStage() {
  if (isRecording) return;
  const availW = window.innerWidth - panelEl.offsetWidth - 24 - 32;
  const availH = window.innerHeight;
  const scale = Math.min(availW / STAGE_WIDTH, availH / STAGE_HEIGHT, 1.0);
  
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
// テキスト処理と1文1ページ（起・承・転・結）のスケジュール算出
// -----------------------------------------------------------------------------
function plainText(html) {
  const div = document.createElement("div");
  div.innerHTML = (html || "").replace(/<rt>.*?<\/rt>/g, "");
  return div.textContent || "";
}

function countPureChars(lines) {
  if (!Array.isArray(lines)) return 0;
  return plainText(lines.join("")).replace(/\s+/g, "").length;
}

// 1文を「先に読む行」と「次に出る行」の2行へ自然に分割する（すでに配列で2行以上ならそのまま）
function splitPageLines(role, rawLinesOrText) {
  const arr = Array.isArray(rawLinesOrText)
    ? rawLinesOrText
    : typeof rawLinesOrText === "string"
    ? [rawLinesOrText]
    : [];

  if (arr.length !== 1) return arr;
  const line = arr[0].trim();
  const pureLen = plainText(line).length;

  // 【起】（短い一言）または16文字以下の短い文は1行のまま一発表示
  if (role === "起" || pureLen <= 16) {
    return [line];
  }

  // 読点「、」があれば最初の読点の直後で2行に分ける（タグの途中を割らないよう注意）
  const commaIdx = line.indexOf("、");
  if (commaIdx !== -1 && commaIdx < line.length - 2) {
    const first = line.slice(0, commaIdx + 1).trim();
    const second = line.slice(commaIdx + 1).trim();
    if (plainText(first).length >= 4 && plainText(second).length >= 4) {
      return [first, second];
    }
  }

  return [line];
}

// 動画データを pages: [{ role: "起"|"承"|"転", lines: [...] }, ...] + ending の正規形に変換
function normalizeMovieStructure(movie) {
  const cfg = getConfig();

  // 1. 新形式（movie.pages 配列）
  if (Array.isArray(movie.pages)) {
    const pages = movie.pages.map((p, idx) => {
      const role = p.role || (idx === 0 ? "起" : "承");
      const raw = p.lines || p.text || "";
      return {
        role,
        lines: splitPageLines(role, raw),
        durationSec: p.durationSec,
        se: p.se,
      };
    });
    const ending = {
      subtitle: movie.ending?.subtitle ?? movie.title ?? "",
      title: movie.ending?.title ?? cfg.title,
      cta: movie.ending?.cta ?? movie.cta ?? cfg.ctaText,
      durationSec: movie.ending?.durationSec,
      se: movie.ending?.se,
    };
    return { pages, ending };
  }

  // 2. 中間形式（movie.phases）
  if (movie.phases) {
    const pages = [];
    if (movie.phases.phase1?.lines) {
      pages.push({ role: "起", lines: splitPageLines("起", movie.phases.phase1.lines) });
    }
    (movie.phases.phase2?.lines || []).forEach((l) => {
      pages.push({ role: "承", lines: splitPageLines("承", l) });
    });
    (movie.phases.phase3?.lines || []).forEach((l) => {
      pages.push({ role: "転", lines: splitPageLines("転", l) });
    });
    const ending = {
      subtitle: movie.phases.phase4?.subtitle ?? movie.title ?? "",
      title: cfg.title,
      cta: movie.phases.phase4?.cta ?? cfg.ctaText,
    };
    return { pages, ending };
  }

  // 3. 旧形式（movie.lines のみ）
  const lines = Array.isArray(movie.lines) ? movie.lines : [];
  const pages = lines.map((l, idx) => {
    const role = idx === 0 ? "起" : idx === lines.length - 1 ? "転" : "承";
    return { role, lines: splitPageLines(role, l) };
  });
  return {
    pages,
    ending: { subtitle: movie.title || "", title: cfg.title, cta: cfg.ctaText },
  };
}

function calculateSchedule(movie) {
  const cfg = getConfig();
  const t = cfg.timing;
  const { pages, ending } = normalizeMovieStructure(movie);

  const scheduledPages = pages.map((p) => {
    if (p.durationSec) {
      return { ...p, durationSec: p.durationSec };
    }
    if (p.role === "起") {
      return { ...p, durationSec: t.kiSec };
    }
    const isTwoLine = p.lines.length >= 2;
    const chars = countPureChars(p.lines);
    const charBonus = Math.max(0, (chars - 20) * 0.05);
    const dur = Math.round((t.pageBaseSec + (isTwoLine ? t.twoLineAddSec : 0) + charBonus) * 10) / 10;
    return { ...p, durationSec: dur };
  });

  const ketsuSec = ending.durationSec ?? t.ketsuSec;
  const pagesTotalSec = scheduledPages.reduce((acc, p) => acc + p.durationSec, 0);
  const totalSec = Math.round((t.leadInSec + pagesTotalSec + ketsuSec + t.leadOutSec) * 10) / 10;

  return {
    leadInSec: t.leadInSec,
    pages: scheduledPages,
    ending: { ...ending, durationSec: ketsuSec },
    leadOutSec: t.leadOutSec,
    totalSec,
  };
}

// -----------------------------------------------------------------------------
// フェーズ・ページ描画制御
// -----------------------------------------------------------------------------
let coverLoaded = false;

async function ensureCoverImage() {
  const cfg = getConfig();
  if (!cfg.coverImage) {
    endingCoverWrapEl.classList.add("is-hidden");
    return;
  }
  if (coverLoaded) return;

  const candidates = [cfg.coverImage, "../../cover/cover.png", "../../cover/cover_for_kdp.jpg"];
  for (const src of candidates) {
    try {
      await new Promise((resolve, reject) => {
        endingCoverEl.onload = resolve;
        endingCoverEl.onerror = reject;
        endingCoverEl.src = src;
      });
      endingCoverWrapEl.classList.remove("is-hidden");
      coverLoaded = true;
      return;
    } catch {
      // 次の候補へ
    }
  }
  endingCoverWrapEl.classList.add("is-hidden");
}

// 1ページ分のテキストを表示（2行ある場合は1行目を出したあと時間差で2行目を出す）
function renderPage(page, animateIn = true) {
  const cfg = getConfig();
  phase4OverlayEl.classList.remove("is-active");
  phaseEndingEl.classList.remove("is-active");
  phaseTextAreaEl.style.opacity = "1";
  phaseTextAreaEl.setAttribute("data-phase", page.role);

  const safeLines = Array.isArray(page.lines) ? page.lines : [];
  const maxLineChars = safeLines.reduce((m, l) => Math.max(m, plainText(l).length), 0);
  const threshold = page.role === "起" ? 15 : 18;
  textEl.classList.toggle("is-compact", maxLineChars > threshold);

  textEl.innerHTML = safeLines.map((line) => `<p>${line}</p>`).join("");
  const paragraphs = Array.from(textEl.querySelectorAll("p"));

  if (!animateIn) {
    paragraphs.forEach((p) => p.classList.add("is-visible"));
    return;
  }

  const sublineDelayMs = cfg.timing.sublineDelayMs ?? 550;
  paragraphs.forEach((p, idx) => {
    if (idx === 0) {
      // 1行目は即座にスパッと表示
      requestAnimationFrame(() => {
        p.classList.add("is-visible");
      });
    } else {
      // 2行目以降は時間差でスパッと表示（＋軽い補助スナップ音）
      setTimeout(() => {
        p.classList.add("is-visible");
        if (isRecording) {
          playSe(cfg.audio.se.subline);
        }
      }, idx * sublineDelayMs);
    }
  });
}

function renderEndingPhase(endingData) {
  phaseTextAreaEl.style.opacity = "0";
  phase4OverlayEl.classList.add("is-active");

  endingSubtitleEl.textContent = endingData.subtitle || "";
  endingSubtitleEl.classList.toggle("is-hidden", !endingData.subtitle);
  endingTitleEl.textContent = endingData.title || "";
  endingCtaEl.textContent = endingData.cta || "";
  endingCtaEl.classList.toggle("is-hidden", !endingData.cta);

  phaseEndingEl.classList.add("is-active");
}

async function prepareStage(movie, showInitialPhase = true) {
  const cfg = getConfig();
  applyThemeCssVariables(cfg.theme);
  await document.fonts.ready;
  await ensureCoverImage();

  const useVideo = cfg.theme.preset === "video" || Boolean(movie.background);
  if (useVideo && movie.background) {
    bgCanvasEl.classList.add("is-hidden");
    bgVideoEl.classList.remove("is-hidden");
  const src = new URL(movie.background, location.href).href;
  if (bgVideoEl.src !== src) {
    bgVideoEl.src = src;
    await new Promise((resolve, reject) => {
      bgVideoEl.addEventListener("loadeddata", resolve, { once: true });
        bgVideoEl.addEventListener(
          "error",
          () => reject(new Error(`背景動画を読み込めません: ${movie.background}`)),
          { once: true }
        );
    });
  }
  bgVideoEl.pause();
  bgVideoEl.currentTime = 0;
  await new Promise((resolve) => bgVideoEl.addEventListener("seeked", resolve, { once: true }));
  } else {
    bgVideoEl.classList.add("is-hidden");
    bgCanvasEl.classList.remove("is-hidden");
    startBackgroundLoop();
  }

  const schedule = calculateSchedule(movie);
  if (showInitialPhase && schedule.pages.length > 0) {
    renderPage(schedule.pages[0], false);
  } else {
    textEl.innerHTML = "";
    phase4OverlayEl.classList.remove("is-active");
    phaseEndingEl.classList.remove("is-active");
  }
  return schedule;
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
// 起・承・転・結の全ページ連続再生（BGMの開始・停止タイミングもここで制御）
// -----------------------------------------------------------------------------
async function runMovieTimeline(schedule) {
  const cfg = getConfig();
  const bgmTiming = cfg.audio.bgmTiming || "from_phase2";
  const fadeOutLeadMs = 150;

  // 最初からBGMを流す設定の場合のみ開始時に再生
  if (bgmTiming === "all") {
    startBgmIfNeeded();
  } else {
    stopBgmIfNeeded();
  }

  // リードイン
  await wait(schedule.leadInSec * 1000);

  // 起・承・転の各ページを順番に表示
  for (let i = 0; i < schedule.pages.length; i++) {
    const page = schedule.pages[i];

    // 【承】（2ページ目以降）に入ったタイミングでBGMを開始する設定
    if (page.role !== "起" && (bgmTiming === "from_phase2" || bgmTiming === "middle_only")) {
      startBgmIfNeeded();
    }

    const seSpec = page.se ?? cfg.audio.se[page.role] ?? "builtin:page";
    playSe(seSpec);
    renderPage(page, true);

    const holdMs = Math.max(100, page.durationSec * 1000 - fadeOutLeadMs);
    await wait(holdMs);
    phaseTextAreaEl.style.opacity = "0";
    await wait(fadeOutLeadMs);
  }

  // 【結】（フェーズ4：誘導）のBGM制御
  if (bgmTiming === "middle_only") {
    stopBgmIfNeeded(0.35);
  } else if (bgmTiming === "ending_only" || bgmTiming === "from_phase2") {
    startBgmIfNeeded();
  }

  const ketsuSe = schedule.ending.se ?? cfg.audio.se["結"] ?? "builtin:ending";
  playSe(ketsuSe);
  renderEndingPhase(schedule.ending);
  await wait(schedule.ending.durationSec * 1000);

  // リードアウト
  await wait(schedule.leadOutSec * 1000);
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
    ensureAudioEngine();

    await wait(300);
    fitStage();
    if (!canRecord) {
      throw new Error("画面共有の開始後、ウィンドウが小さくなったため録画できません。全画面表示（F11）にしてください");
    }

    isRecording = true;
    setStatus(`動画 ${movie.id} を準備しています…`);
    const schedule = await prepareStage(movie, false);
    const durationSec = schedule.totalSec;

    await wait(300);
    await nextFrame();
    await nextFrame();

    const videoTrack = stream.getVideoTracks()[0];
    const audioTrack = masterDestination.stream.getAudioTracks()[0];
    const recordStream = audioTrack ? new MediaStream([videoTrack, audioTrack]) : new MediaStream([videoTrack]);

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
    if (!bgVideoEl.classList.contains("is-hidden")) {
    bgVideoEl.play();
    }

    const pageSummary = schedule.pages.map((p) => `${p.role}${p.durationSec}s`).join(" / ");
    setStatus(
      `動画 ${movie.id} を録画中…（約 ${durationSec.toFixed(1)} 秒）\n[${pageSummary} / 結${schedule.ending.durationSec}s]`
    );

    await runMovieTimeline(schedule);

    recorder.stop();
    stopBgmIfNeeded();
    await stopped;
    if (!bgVideoEl.classList.contains("is-hidden")) {
    bgVideoEl.pause();
    }

    const blob = new Blob(chunks, { type: format.mime });
    const baseName = movie.filename || `movie_${movie.id}`;
    const filename = `${baseName}.${format.ext}`;
    const size = await getVideoSize(blob);

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
          setStatus(
            `${filename} を保存しました（movie/ フォルダ）\n長さ: 約 ${durationSec.toFixed(1)} 秒 / 解像度: ${size.width}x${size.height} (9:16)`
          );
        }
      }
    } catch (e) {
      savedViaServer = false;
    }

    if (!savedViaServer) {
      download(blob, filename);
      updateButtonCheckmark(movie.id, true);
      setStatus(
        `${filename} をダウンロードしました\n長さ: 約 ${durationSec.toFixed(1)} 秒 / 解像度: ${size.width}x${size.height} (9:16)`
      );
    }
  } catch (e) {
    console.error(e);
    setStatus(`エラー: ${e.message}`);
  } finally {
    stopBgmIfNeeded();
    isRecording = false;
    setButtonsDisabled(false);
    fitStage();
  }
}

// -----------------------------------------------------------------------------
// 保存済み状態の管理（movie/ フォルダ内の実ファイルと同期）
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
  try {
    localStorage.removeItem("cherryboys_downloaded_movies");
  } catch {}

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
    // 静的チェックへフォールバック
  }

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
function buildButtons() {
  window.MOVIES.forEach((movie) => {
    const { pages } = normalizeMovieStructure(movie);
    const previewLine = pages[0]?.lines?.join("") || movie.title || "";

    const li = document.createElement("li");
    const button = document.createElement("button");
    button.type = "button";
    button.id = `record-${movie.id}`;
    button.className = "movie-button";
    button.innerHTML = `<span class="movie-button-id">動画 ${movie.id} を録画</span><span class="movie-button-text"></span>`;
    button.querySelector(".movie-button-text").textContent = `${movie.title ? `【${movie.title}】` : ""}${plainText(previewLine)}`;
    button.addEventListener("click", () => playAndRecord(movie, button));
    li.appendChild(button);
    listEl.appendChild(li);
  });
}

window.addEventListener("resize", fitStage);
buildButtons();
checkExistingMovies();
fitStage();
if (Array.isArray(window.MOVIES) && window.MOVIES.length > 0) {
  prepareStage(window.MOVIES[0], true).catch((e) => setStatus(`エラー: ${e.message}`));
}
