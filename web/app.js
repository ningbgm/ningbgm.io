// app.js

// Path compatibility: supports both /index.html and /web/index.html
const EXAMPLE_MP4_URL = new URL("./data/example_mp4.json", import.meta.url).href;

// --- Configuration ---
const ROW_CASES = ["1", "2", "3", "4", "5"];
const COL_MODELS = [
  "GroundTruth", "Ours", "CMT", "Diff_bgm", "GVMGen", "M2UGen", "VeM", "VidMuse",
];
const MODEL_LABELS = {
  Diff_bgm: "Diff-BGM",
  M2UGen: "M²UGen",
};
const SEPARATOR_COL_INDICES = [0];
const SPECIAL_FILE_MAP = {
  Ours: {
    "1": "1_bgm.mp4", "2": "2_bgm_2.mp4", "3": "3_bgm_2.mp4", "4": "4_bgm.mp4", "5": "5_bgm.mp4",
  },
};

// ============================================================
// Performance Configuration
// ============================================================
const PERFORMANCE_CONFIG = {
  // Video prefetch settings
  maxPrefetchVideos: 6,
  prefetchBatchSize: 2,
  prefetchThrottleMs: 800,
  prefetchTimeoutMs: 30000,

  // IntersectionObserver settings
  intersectionThreshold: 0.15,
  intersectionRootMargin: "200px",

  // Memory management
  maxCachedVideos: 10,
  maxCachedPosters: 30,
  cleanupIntervalMs: 60000,

  // Audio preload (auto = buffer audio for instant playback)
  audioPreload: "auto",

  // Priority management
  prioritizeVisibleCount: 2,
};

function getCompareBasePath() {
  const base = typeof document !== "undefined" && document.baseURI ? document.baseURI : "";
  const normalized = base.replace(/\/$/, "");
  return normalized.endsWith("/web") ? "../demo_io/demo_compare" : "demo_io/demo_compare";
}

function getCompareVideoPath(model, caseId) {
  const base = getCompareBasePath();
  if (SPECIAL_FILE_MAP[model] && SPECIAL_FILE_MAP[model][caseId]) {
    return `${base}/${model}/${caseId}/${SPECIAL_FILE_MAP[model][caseId]}`;
  }
  return `${base}/${model}/${caseId}/${caseId}.mp4`;
}

// --- DOM helpers ---
function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null) continue;
    if (k === "class") node.className = v;
    else if (k === "text") node.textContent = v;
    else if (k.startsWith("on") && typeof v === "function") node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, String(v));
  }
  for (const child of Array.isArray(children) ? children : [children]) {
    if (child === undefined || child === null) continue;
    node.appendChild(typeof child === "string" ? document.createTextNode(child) : child);
  }
  return node;
}

function setStatus(msg) {
  const status = document.getElementById("status");
  if (status) status.textContent = msg || "";
}

function resolveMediaSrc(src) {
  if (!src) return "";
  try {
    const base = typeof document !== "undefined" && document.baseURI ? document.baseURI : "";
    const normalized = base.replace(/\/$/, "");
    const baseForDemo = normalized.endsWith("/web") ? new URL("../", base) : new URL(base);
    const resolved = new URL(src, baseForDemo.href);
    return resolved.href;
  } catch {
    return src;
  }
}

// ============================================================
// Performance State Management
// ============================================================
const allVideos = [];
const allAudios = [];

// Poster cache with size limit
const posterPreloadCache = new Map();
const posterOrder = [];

function getVideoPosterPath(src) {
  return src.replace(/\.(mp4|MP4|mov|MOV|webm|WEBM)$/, ".jpg");
}

function preloadPoster(posterSrc, videoEl) {
  const resolved = resolveMediaSrc(posterSrc);
  if (posterPreloadCache.has(resolved)) {
    const cached = posterPreloadCache.get(resolved);
    if (cached && videoEl) {
      videoEl.poster = cached;
      updatePosterAccess(resolved);
    }
    return;
  }

  const img = new Image();
  img.onload = () => {
    posterPreloadCache.set(resolved, resolved);
    posterOrder.push(resolved);
    evictOldPosters();
    if (videoEl) videoEl.poster = resolved;
  };
  img.onerror = () => {
    posterPreloadCache.set(resolved, null);
  };
  img.src = resolved;
}

function updatePosterAccess(posterSrc) {
  const idx = posterOrder.indexOf(posterSrc);
  if (idx > -1) {
    posterOrder.splice(idx, 1);
    posterOrder.push(posterSrc);
  }
}

function evictOldPosters() {
  while (posterOrder.length > PERFORMANCE_CONFIG.maxCachedPosters) {
    const oldest = posterOrder.shift();
    posterPreloadCache.delete(oldest);
  }
}

// ============================================================
// Enhanced Image Preloader (avoid duplicate requests)
// ============================================================
const preloadedImages = new Set();

function preloadImages() {
  document.querySelectorAll("img").forEach((img) => {
    if (!img.src) return;
    if (preloadedImages.has(img.src)) return;
    if (img.complete && img.naturalWidth > 0) return;

    preloadedImages.add(img.src);
    if (img.getAttribute("loading") !== "lazy") {
      img.setAttribute("loading", "lazy");
    }
  });
}

// ============================================================
// Video Buffer Pool Management
// ============================================================
const videoBufferPool = new Map();

function createPrefetchContainer() {
  let container = document.getElementById("video-prefetch-container");
  if (container) return container;

  container = el("div", { id: "video-prefetch-container" });
  container.setAttribute("aria-hidden", "true");
  document.body.appendChild(container);
  return container;
}

function getOrCreateBufferVideo(src) {
  const resolved = resolveMediaSrc(src);

  if (videoBufferPool.has(resolved)) {
    const buffer = videoBufferPool.get(resolved);
    if (buffer.readyState >= 3) {
      buffer.lastUsed = Date.now();
      buffer.refCount++;
      return buffer.video;
    }
  }

  const bufferVideo = el("video", {
    src: resolved,
    preload: "auto",
    muted: "",
    playsinline: "",
  });

  const buffer = {
    video: bufferVideo,
    lastUsed: Date.now(),
    readyState: 0,
    refCount: 1,
  };

  bufferVideo._bufferInfo = buffer;

  bufferVideo.addEventListener("canplaythrough", () => {
    buffer.readyState = bufferVideo.readyState;
  });

  bufferVideo.addEventListener("error", () => {
    buffer.readyState = -1;
    videoBufferPool.delete(resolved);
  });

  bufferVideo.addEventListener("loadedmetadata", () => {
    buffer.readyState = 1;
  });

  bufferVideo.addEventListener("canplay", () => {
    buffer.readyState = 2;
  });

  bufferVideo.addEventListener("canplaythrough", () => {
    buffer.readyState = 3;
  });

  videoBufferPool.set(resolved, buffer);
  evictOldBuffers();

  return bufferVideo;
}

function evictOldBuffers() {
  if (videoBufferPool.size <= PERFORMANCE_CONFIG.maxCachedVideos) return;

  const entries = Array.from(videoBufferPool.entries())
    .sort((a, b) => a[1].lastUsed - b[1].lastUsed);

  const toRemove = entries.slice(0, videoBufferPool.size - PERFORMANCE_CONFIG.maxCachedVideos);

  for (const [src, buffer] of toRemove) {
    if (buffer.refCount <= 0) {
      buffer.video.src = "";
      buffer.video.load();
      videoBufferPool.delete(src);
    }
  }
}

function releaseBufferVideo(src) {
  const resolved = resolveMediaSrc(src);
  if (videoBufferPool.has(resolved)) {
    const buffer = videoBufferPool.get(resolved);
    buffer.refCount--;
    if (buffer.refCount <= 0) {
      buffer.lastUsed = Date.now() - 30000;
    }
  }
}

function getBufferVideoReadyState(src) {
  const resolved = resolveMediaSrc(src);
  if (videoBufferPool.has(resolved)) {
    return videoBufferPool.get(resolved).readyState;
  }
  return -1;
}

// ============================================================
// Enhanced Video Prefetch Queue
// ============================================================
const videoPrefetchQueue = [];
const loadedVideoUrls = new Set();

function enqueueVideoPrefetch(src, immediate = false, priority = 1) {
  const resolved = resolveMediaSrc(src);
  if (loadedVideoUrls.has(resolved)) return;
  if (getBufferVideoReadyState(resolved) >= 3) return;

  const existingIdx = videoPrefetchQueue.findIndex(item => item.src === resolved);
  if (existingIdx !== -1) {
    videoPrefetchQueue.splice(existingIdx, 1);
  }

  const queueItem = { src: resolved, priority, addedAt: Date.now() };

  if (immediate) {
    const insertIdx = videoPrefetchQueue.findIndex(item => item.priority < priority);
    if (insertIdx === -1) {
      videoPrefetchQueue.unshift(queueItem);
    } else {
      videoPrefetchQueue.splice(insertIdx, 0, queueItem);
    }
  } else {
    videoPrefetchQueue.push(queueItem);
    videoPrefetchQueue.sort((a, b) => b.priority - a.priority);
  }

  schedulePrefetch();
}

let prefetchRunning = false;
let prefetchActiveCount = 0;
let prefetchThrottleTimer = null;

function schedulePrefetch() {
  if (prefetchThrottleTimer) return;
  prefetchThrottleTimer = setTimeout(() => {
    prefetchThrottleTimer = null;
    processPrefetchQueue();
  }, 100);
}

function processPrefetchQueue() {
  if (prefetchRunning) return;
  if (videoPrefetchQueue.length === 0) return;
  if (prefetchActiveCount >= PERFORMANCE_CONFIG.prefetchBatchSize) {
    setTimeout(processPrefetchQueue, 500);
    return;
  }

  prefetchRunning = true;
  const batch = videoPrefetchQueue.splice(0, PERFORMANCE_CONFIG.prefetchBatchSize);
  prefetchActiveCount += batch.length;

  batch.forEach(item => {
    if (loadedVideoUrls.has(item.src)) {
      prefetchActiveCount--;
      return;
    }

    const prefetchVideo = getOrCreateBufferVideo(item.src);
    const container = createPrefetchContainer();
    container.appendChild(prefetchVideo);

    const onComplete = () => {
      prefetchActiveCount--;
      loadedVideoUrls.add(item.src);
      cleanupVideoElement(prefetchVideo, container);
      prefetchRunning = false;
      schedulePrefetch();
    };

    prefetchVideo.addEventListener("canplaythrough", onComplete, { once: true });
    prefetchVideo.addEventListener("error", onComplete, { once: true });

    setTimeout(() => {
      if (loadedVideoUrls.has(item.src)) return;
      onComplete();
    }, PERFORMANCE_CONFIG.prefetchTimeoutMs);
  });
}

function cleanupVideoElement(video, container) {
  if (video.parentNode === container) {
    container.removeChild(video);
  }
  video.src = "";
  video.load();
}

function enqueueAllVideosInOrder(visibleVideos = []) {
  const containers = document.querySelectorAll(".compare-grid-container, #videoGallery");
  const toEnqueue = [];

  containers.forEach((container) => {
    const videos = container.querySelectorAll(".grid-video-wrap");
    videos.forEach((wrap) => {
      const video = wrap.querySelector("video");
      if (video && video.src) {
        const resolved = video.src;
        if (!loadedVideoUrls.has(resolved) && !videoPrefetchQueue.find(q => q.src === resolved)) {
          const priority = visibleVideos.includes(resolved) ? 2 : 1;
          toEnqueue.push({ src: resolved, priority });
        }
      }
    });
  });

  if (toEnqueue.length > 0) {
    toEnqueue.forEach(item => {
      if (!videoPrefetchQueue.find(q => q.src === item.src)) {
        videoPrefetchQueue.push(item);
      }
    });
    videoPrefetchQueue.sort((a, b) => b.priority - a.priority);
    schedulePrefetch();
  }
}

// ============================================================
// Memory Cleanup Management
// ============================================================
let memoryCleanupTimer = null;

function startMemoryCleanup() {
  if (memoryCleanupTimer) return;
  memoryCleanupTimer = setInterval(() => {
    evictOldBuffers();
    evictOldPosters();
  }, PERFORMANCE_CONFIG.cleanupIntervalMs);
}

// ============================================================
// Enhanced Video Lazy Loading
// ============================================================
function createVideoElement(src, options = {}) {
  const resolved = resolveMediaSrc(src);
  const posterSrc = getVideoPosterPath(resolved);
  const video = el("video", {
    src: resolved,
    preload: "none",
    playsinline: "",
    "webkit-playsinline": "",
    muted: "",
    loop: "",
  });

  video._originalSrc = src;
  video._isPreloaded = false;

  const readyState = getBufferVideoReadyState(src);
  if (readyState >= 2) {
    video._isPreloaded = true;
    video.preload = "auto";
  }

  if (posterSrc && posterPreloadCache.has(posterSrc)) {
    const cached = posterPreloadCache.get(posterSrc);
    if (cached) video.poster = cached;
  }

  video._releaseBuffer = () => releaseBufferVideo(src);

  return video;
}

function setupVideoEvents(video, btnPlay, wrapper, src) {
  const updateIcon = () => {
    if (video.paused) {
      btnPlay.classList.add("is-paused");
      btnPlay.classList.remove("is-playing");
    } else {
      btnPlay.classList.add("is-playing");
      btnPlay.classList.remove("is-paused");
    }
  };
  updateIcon();

  video.addEventListener("play", updateIcon);
  video.addEventListener("pause", updateIcon);
  video.addEventListener("ended", updateIcon);

  wrapper.addEventListener("click", () => {
    const willPlay = video.paused;

    allVideos.forEach((v) => {
      if (!v.paused) v.pause();
    });

    if (willPlay) {
      video.play().catch((e) => {
        console.warn("Video play failed:", e);
      });

      enqueueVideoPrefetch(src, true, 10);
      enqueueAllVideosInOrder();
    } else {
      video.pause();
    }
  });

  const observer = new MutationObserver((mutations) => {
    mutations.forEach((mutation) => {
      mutation.removedNodes.forEach((node) => {
        if (node === video && video._releaseBuffer) {
          video._releaseBuffer();
        }
      });
    });
  });
  observer.observe(wrapper, { childList: true });
}

function mediaNode(src, label, isSimple = false, options = {}) {
  const wrapper = el("div", { class: "grid-video-wrap lazy-video" });
  const btnPlay = el("div", { class: "grid-play-icon is-paused" });
  wrapper.appendChild(btnPlay);

  if (options.syncAspectRatio) {
    wrapper.style.aspectRatio = "16 / 9";
  }

  const rect = wrapper.getBoundingClientRect();
  const isAboveFold = rect.top < window.innerHeight * 1.5;

  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        const resolved = resolveMediaSrc(src);
        const video = createVideoElement(src, options);
        wrapper.insertBefore(video, btnPlay);
        wrapper.classList.add("loaded");
        allVideos.push(video);

        const posterSrc = getVideoPosterPath(resolved);
        if (posterSrc) preloadPoster(posterSrc, video);

        if (options.syncAspectRatio) {
          video.addEventListener("loadedmetadata", () => {
            if (video.videoWidth && video.videoHeight) {
              wrapper.style.aspectRatio = `${video.videoWidth} / ${video.videoHeight}`;
            }
          }, { once: true });
        }

        setupVideoEvents(video, btnPlay, wrapper, src);
        observer.unobserve(wrapper);

        enqueueVideoPrefetch(src, isAboveFold, isAboveFold ? 5 : 2);
      }
    });
  }, {
    threshold: PERFORMANCE_CONFIG.intersectionThreshold,
    rootMargin: PERFORMANCE_CONFIG.intersectionRootMargin,
  });

  observer.observe(wrapper);

  if (isAboveFold) {
    const posterSrc = getVideoPosterPath(resolveMediaSrc(src));
    if (posterSrc) preloadPoster(posterSrc, null);
  }

  if (isSimple) {
    wrapper.title = label;
    return wrapper;
  }

  return el("div", { class: "grid-card" }, [
    wrapper,
    el("div", { class: "grid-label", text: label }),
  ]);
}

// ============================================================
// Collect and Preload Posters
// ============================================================
function collectAndPreloadPosters(categories) {
  if (!categories) return;
  categories.forEach((cat) => {
    const orig = cat.original || {};
    const paths = [orig.video, orig.image];
    (cat.rows || []).forEach((row) => {
      if (row.output) {
        if (row.output.bgm) paths.push(row.output.bgm);
        if (row.output.vocal) paths.push(row.output.vocal);
      }
    });
    paths.forEach((src) => {
      if (!src) return;
      const poster = getVideoPosterPath(src);
      if (poster) preloadPoster(poster, null);
    });
  });
}

// --- Comparison grid ---
function renderCompareMatrix(container) {
  container.innerHTML = "";
  container.appendChild(
    el("div", { class: "section-head" }, [
      el("h2", { class: "page-title", text: "Comparison Results" }),
      el("p", { class: "page-subtitle", text: "Click a video to play/pause. Each column corresponds to a method." }),
    ]),
  );

  ROW_CASES.forEach((caseId) => {
    COL_MODELS.forEach((model) => {
      const path = getCompareVideoPath(model, caseId);
      const poster = getVideoPosterPath(resolveMediaSrc(path));
      if (poster) preloadPoster(poster, null);
    });
  });

  const grid = el("div", { class: "compare-grid-container" });
  grid.style.setProperty("--cols", String(COL_MODELS.length));

  for (const caseId of ROW_CASES) {
    const rowDiv = el("div", { class: "compare-grid-row" });
    COL_MODELS.forEach((model, index) => {
      const path = getCompareVideoPath(model, caseId);
      const cell = el("div", { class: "compare-cell" });
      if (SEPARATOR_COL_INDICES.includes(index)) cell.classList.add("has-separator");

      const label = MODEL_LABELS[model] || model;
      cell.appendChild(mediaNode(path, label, false, { syncAspectRatio: true }));
      rowDiv.appendChild(cell);
    });
    grid.appendChild(rowDiv);
  }
  container.appendChild(grid);

  requestAnimationFrame(syncCompareCellSizeToCssVars);
}

function syncCompareCellSizeToCssVars() {
  const tbEl = document.getElementById("tbCompare");
  const firstWrap = tbEl?.querySelector(".compare-cell .grid-video-wrap");
  if (!firstWrap) return;

  const rect = firstWrap.getBoundingClientRect();
  const w = rect.width;
  const h = rect.height;
  const root = document.documentElement;
  root.style.setProperty("--compare-cell-width", `${w}px`);
  root.style.setProperty("--compare-cell-height", `${h}px`);
  const S = w * h;

  if (S > 0) {
    root.style.setProperty("--example-cell-area", String(S));
    const portraitW = Math.sqrt(S * 9 / 16);
    const portraitH = Math.sqrt(S * 16 / 9);
    const landscapeW = Math.sqrt(S * 16 / 9);
    const landscapeH = Math.sqrt(S * 9 / 16);
    root.style.setProperty("--example-portrait-width", `${portraitW}px`);
    root.style.setProperty("--example-portrait-height", `${portraitH}px`);
    root.style.setProperty("--example-landscape-width", `${landscapeW}px`);
    root.style.setProperty("--example-landscape-height", `${landscapeH}px`);
  }
}

let resizeTimer;
window.addEventListener("resize", () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(syncCompareCellSizeToCssVars, 250);
});

// --- Examples: new layout (video, image, audio, text, plus two Ours columns) ---

const ROW_ORDER = ["video_audio_image_text", "video_image_text", "audio_image_text", "image_text"];

function imageNode(src, label, options = {}) {
  const resolved = resolveMediaSrc(src);
  const img = el("img", {
    src: resolved,
    alt: label || "",
    loading: "lazy",
  });
  const wrapper = el("div", { class: "grid-image-wrap" }, [img]);
  wrapper.title = label;
  const { syncAspectRatio = true } = options;
  if (syncAspectRatio) {
    img.addEventListener("load", () => {
      if (img.naturalWidth && img.naturalHeight) {
        wrapper.style.aspectRatio = `${img.naturalWidth} / ${img.naturalHeight}`;
      }
    });
  }
  return wrapper;
}

function audioNode(src, label) {
  const resolved = resolveMediaSrc(src);
  const audio = el("audio", {
    src: resolved,
    preload: PERFORMANCE_CONFIG.audioPreload,
  });
  const btn = el("button", { class: "audio-btn", type: "button" });
  const wrapper = el("div", { class: "grid-audio-wrap" }, [btn, audio]);
  wrapper.title = label;

  allAudios.push(audio);

  const updateLabel = () => {
    btn.textContent = audio.paused ? "Play" : "Pause";
  };
  updateLabel();

  audio.addEventListener("play", updateLabel);
  audio.addEventListener("pause", updateLabel);

  btn.addEventListener("click", () => {
    const willPlay = audio.paused;
    allAudios.forEach((a) => { if (!a.paused) a.pause(); });
    if (willPlay) audio.play().catch(() => {});
    else audio.pause();
  });

  return wrapper;
}

function textNode(text) {
  return el("div", { class: "grid-text-wrap" }, [
    el("div", { class: "grid-text-content", text: text || "" })
  ]);
}

const PLACEHOLDER_LABELS = {
  video: "No video modality",
  image: "No image modality",
  audio: "No audio modality",
};
function placeholderNode(modality) {
  const label = PLACEHOLDER_LABELS[modality] || "Modality not available";
  const icon = el("span", { class: "ex-placeholder-icon", "aria-hidden": "true", text: "—" });
  const text = el("span", { class: "ex-placeholder-text", text: label });
  return el("div", { class: "ex-placeholder ex-placeholder-missing-modality" }, [
    icon,
    text,
  ]);
}

function wrapMediaCell(content) {
  const cell = el("div", { class: "example-media-cell" });
  cell.appendChild(content);
  return cell;
}

function renderExampleRow(original, rowData, orientation = "landscape") {
  const row = el("div", { class: "example-row" });
  const cells = el("div", { class: `example-row-cells mode-${orientation}` });

  const type = rowData.type;
  const mediaOpts = { syncAspectRatio: false };

  if (type === "video_audio_image_text") {
    if (original.video) cells.appendChild(wrapMediaCell(mediaNode(original.video, "Input video", true, mediaOpts)));
    else cells.appendChild(wrapMediaCell(placeholderNode("video")));

    if (original.image) cells.appendChild(wrapMediaCell(imageNode(original.image, "Input image", { syncAspectRatio: false })));
    else cells.appendChild(wrapMediaCell(placeholderNode("image")));

    cells.appendChild(wrapMediaCell(audioNode(original.audio, "Input audio")));
    cells.appendChild(wrapMediaCell(textNode(original.text || "")));
  } else if (type === "audio_image_text") {
    cells.appendChild(wrapMediaCell(placeholderNode("video")));

    if (original.image) cells.appendChild(wrapMediaCell(imageNode(original.image, "Input image", { syncAspectRatio: false })));
    else cells.appendChild(wrapMediaCell(placeholderNode("image")));

    cells.appendChild(wrapMediaCell(audioNode(original.audio, "Input audio")));
    cells.appendChild(wrapMediaCell(textNode(original.text || "")));
  } else if (type === "video_image_text") {
    if (original.video) cells.appendChild(wrapMediaCell(mediaNode(original.video, "Input video", true, mediaOpts)));
    else cells.appendChild(wrapMediaCell(placeholderNode("video")));

    if (original.image) cells.appendChild(wrapMediaCell(imageNode(original.image, "Input image", { syncAspectRatio: false })));
    else cells.appendChild(wrapMediaCell(placeholderNode("image")));

    cells.appendChild(wrapMediaCell(placeholderNode("audio")));
    cells.appendChild(wrapMediaCell(textNode(original.text || "")));
  } else if (type === "image_text") {
    cells.appendChild(wrapMediaCell(placeholderNode("video")));

    if (original.image) cells.appendChild(wrapMediaCell(imageNode(original.image, "Input image", { syncAspectRatio: false })));
    else cells.appendChild(wrapMediaCell(placeholderNode("image")));

    cells.appendChild(wrapMediaCell(placeholderNode("audio")));
    cells.appendChild(wrapMediaCell(textNode(original.text || "")));
  }

  const oursWrapper = el("div", { class: "example-ours-wrapper" });
  if (rowData.output?.bgm) {
    oursWrapper.appendChild(wrapMediaCell(mediaNode(rowData.output.bgm, "Ours BGM", true, mediaOpts)));
  } else {
    oursWrapper.appendChild(wrapMediaCell(placeholderNode("video")));
  }
  if (rowData.output?.vocal) {
    oursWrapper.appendChild(wrapMediaCell(mediaNode(rowData.output.vocal, "Ours Vocal", true, mediaOpts)));
  } else {
    oursWrapper.appendChild(wrapMediaCell(placeholderNode("video")));
  }
  cells.appendChild(oursWrapper);

  row.appendChild(cells);
  return row;
}

function renderCategory(category) {
  const orientation = category.orientation || "landscape";
  const categorySection = el("div", { class: `example-category ${orientation}` });

  const categoryTitle = el("h3", { class: "category-title", text: category.name });
  categorySection.appendChild(categoryTitle);

  const headerRow = el("div", { class: "example-header-row" });
  const headerCells = el("div", { class: `example-row-cells mode-${orientation}` });
  headerCells.appendChild(el("div", { class: "ex-header-cell", text: "Input video" }));
  headerCells.appendChild(el("div", { class: "ex-header-cell", text: "Input image" }));
  headerCells.appendChild(el("div", { class: "ex-header-cell", text: "Input audio" }));
  headerCells.appendChild(el("div", { class: "ex-header-cell", text: "Input text" }));
  const oursHeader = el("div", { class: "example-ours-wrapper" });
  oursHeader.appendChild(el("div", { class: "ex-header-cell", text: "Ours BGM" }));
  oursHeader.appendChild(el("div", { class: "ex-header-cell", text: "Ours Vocal" }));
  headerCells.appendChild(oursHeader);
  headerRow.appendChild(headerCells);
  categorySection.appendChild(headerRow);

  const sortedRows = (category.rows || []).slice().sort(
    (a, b) => ROW_ORDER.indexOf(a.type) - ROW_ORDER.indexOf(b.type)
  );
  sortedRows.forEach(rowData => {
    const row = renderExampleRow(category.original, rowData, orientation);
    categorySection.appendChild(row);
  });

  return categorySection;
}

async function renderExampleGallery(container) {
  container.innerHTML = "";
  try {
    const resp = await fetch(EXAMPLE_MP4_URL);
    const data = await resp.json();

    container.appendChild(el("div", { class: "section-head" }, [
      el("h2", { class: "page-title", text: data.title || "Example Videos" }),
    ]));

    const categories = (data.categories || [])
      .slice()
      .sort((a, b) => {
        const weight = (cat) => {
          if (cat.id === "live") return 999;
          return (cat.orientation || "landscape") === "portrait" ? 0 : 1;
        };
        return weight(a) - weight(b);
      });

    collectAndPreloadPosters(categories);

    categories.forEach(category => {
      const categorySection = renderCategory(category);
      container.appendChild(categorySection);
    });

  } catch (err) {
    console.error(err);
    container.innerText = "Failed to load.";
  }
}

// --- Init ---
function init() {
  preloadImages();
  startMemoryCleanup();

  const btn = document.getElementById("reloadBtn");
  if (btn) btn.addEventListener("click", () => renderAll());
  renderAll();
}

async function renderAll() {
  const tbEl = document.getElementById("tbCompare");
  if (tbEl) renderCompareMatrix(tbEl);

  await new Promise((r) => requestAnimationFrame(r));
  syncCompareCellSizeToCssVars();

  const galleryEl = document.getElementById("videoGallery");
  if (galleryEl) await renderExampleGallery(galleryEl);
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
else init();
