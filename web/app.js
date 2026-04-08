const EXAMPLE_MP4_URL = new URL("./data/example_mp4.json", import.meta.url).href;

const ROW_CASES = ["1", "2", "3", "4", "5"];
const COL_MODELS = [
  "GroundTruth",
  "Ours",
  "CMT",
  "Diff_bgm",
  "GVMGen",
  "M2UGen",
  "VeM",
  "VidMuse",
];
const MODEL_LABELS = {
  Diff_bgm: "Diff-BGM",
  M2UGen: "M2UGen",
};
const SEPARATOR_COL_INDICES = [0];
const SPECIAL_FILE_MAP = {
  Ours: {
    "1": "1_bgm.mp4",
    "2": "2_bgm_2.mp4",
    "3": "3_bgm_2.mp4",
    "4": "4_bgm.mp4",
    "5": "5_bgm.mp4",
  },
};
const ROW_ORDER = [
  "video_audio_image_text",
  "video_image_text",
  "audio_image_text",
  "image_text",
];
const EXAMPLES_BATCH_SIZE = 2;
const MAX_CONCURRENT_PREFETCH = 2;

const PLACEHOLDER_LABELS = {
  video: "No video modality",
  image: "No image modality",
  audio: "No audio modality",
};

const allVideos = [];
const allAudios = [];
const videoPrefetchQueue = [];
const loadedVideoUrls = new Set();
const lazyVideoLoaders = new WeakMap();
const exampleRenderState = {
  triggerObserver: null,
  batchObserver: null,
  sentinel: null,
  nextBatchQueued: false,
  loading: false,
  loaded: false,
};

let activePrefetchCount = 0;
let sharedVideoObserver;
let resizeTimer;

function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined || value === null) continue;
    if (key === "class") node.className = value;
    else if (key === "text") node.textContent = value;
    else if (key === "html") node.innerHTML = value;
    else if (key.startsWith("on") && typeof value === "function") {
      node.addEventListener(key.slice(2), value);
    } else {
      node.setAttribute(key, String(value));
    }
  }

  const normalizedChildren = Array.isArray(children) ? children : [children];
  normalizedChildren.forEach((child) => {
    if (child === undefined || child === null) return;
    node.appendChild(
      typeof child === "string" ? document.createTextNode(child) : child
    );
  });

  return node;
}

function setStatus(message) {
  const status = document.getElementById("status");
  if (status) status.textContent = message || "";
}

function resolveMediaSrc(src) {
  if (!src) return "";
  try {
    const base =
      typeof document !== "undefined" && document.baseURI ? document.baseURI : "";
    const normalized = base.replace(/\/$/, "");
    const baseForDemo = normalized.endsWith("/web")
      ? new URL("../", base)
      : new URL(base);
    return new URL(src, baseForDemo.href).href;
  } catch {
    return src;
  }
}

function scheduleLowPriorityWork(task) {
  if (typeof window !== "undefined" && "requestIdleCallback" in window) {
    window.requestIdleCallback(task, { timeout: 400 });
    return;
  }
  window.setTimeout(task, 16);
}

function disconnectExampleObservers() {
  if (exampleRenderState.triggerObserver) {
    exampleRenderState.triggerObserver.disconnect();
    exampleRenderState.triggerObserver = null;
  }
  if (exampleRenderState.batchObserver) {
    exampleRenderState.batchObserver.disconnect();
    exampleRenderState.batchObserver = null;
  }
  if (exampleRenderState.sentinel) {
    exampleRenderState.sentinel.remove();
    exampleRenderState.sentinel = null;
  }
  exampleRenderState.nextBatchQueued = false;
}

function resetRuntimeState() {
  allVideos.splice(0).forEach((video) => video.pause());
  allAudios.splice(0).forEach((audio) => audio.pause());
  videoPrefetchQueue.length = 0;
  loadedVideoUrls.clear();
  activePrefetchCount = 0;
  disconnectExampleObservers();
  exampleRenderState.loading = false;
  exampleRenderState.loaded = false;
  setStatus("");
}

function getCompareBasePath() {
  const base =
    typeof document !== "undefined" && document.baseURI ? document.baseURI : "";
  const normalized = base.replace(/\/$/, "");
  return normalized.endsWith("/web")
    ? "../demo_io/demo_compare"
    : "demo_io/demo_compare";
}

function getCompareVideoPath(model, caseId) {
  const base = getCompareBasePath();
  if (SPECIAL_FILE_MAP[model]?.[caseId]) {
    return `${base}/${model}/${caseId}/${SPECIAL_FILE_MAP[model][caseId]}`;
  }
  return `${base}/${model}/${caseId}/${caseId}.mp4`;
}

function enqueueVideoPrefetch(src) {
  const resolved = resolveMediaSrc(src);
  if (!resolved || loadedVideoUrls.has(resolved)) return;
  const existingIndex = videoPrefetchQueue.indexOf(resolved);
  if (existingIndex !== -1) videoPrefetchQueue.splice(existingIndex, 1);
  videoPrefetchQueue.unshift(resolved);
  processPrefetchQueue();
}

function processPrefetchQueue() {
  while (
    videoPrefetchQueue.length > 0 &&
    activePrefetchCount < MAX_CONCURRENT_PREFETCH
  ) {
    const src = videoPrefetchQueue.shift();
    if (!src || loadedVideoUrls.has(src)) continue;
    activePrefetchCount += 1;
    prefetchSingleVideo(src);
  }
}

function prefetchSingleVideo(src) {
  const prefetchVideo = el("video", {
    src,
    preload: "metadata",
    muted: "",
  });

  const cleanup = () => {
    if (!loadedVideoUrls.has(src)) loadedVideoUrls.add(src);
    prefetchVideo.src = "";
    prefetchVideo.remove();
    activePrefetchCount = Math.max(0, activePrefetchCount - 1);
    processPrefetchQueue();
  };

  prefetchVideo.addEventListener("loadedmetadata", cleanup, { once: true });
  prefetchVideo.addEventListener("canplaythrough", cleanup, { once: true });
  prefetchVideo.addEventListener("error", cleanup, { once: true });
  window.setTimeout(cleanup, 10000);
}

function enqueueAllVideosInOrder() {
  const containers = document.querySelectorAll(".compare-grid-container, #videoGallery");
  containers.forEach((container) => {
    container.querySelectorAll(".grid-video-wrap video").forEach((video) => {
      const resolved = video.currentSrc || video.src;
      if (
        resolved &&
        !loadedVideoUrls.has(resolved) &&
        !videoPrefetchQueue.includes(resolved)
      ) {
        videoPrefetchQueue.push(resolved);
      }
    });
  });
  processPrefetchQueue();
}

function getSharedVideoObserver() {
  if (sharedVideoObserver) return sharedVideoObserver;
  sharedVideoObserver = new IntersectionObserver(
    (entries, observer) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        const loader = lazyVideoLoaders.get(entry.target);
        if (!loader) return;
        lazyVideoLoaders.delete(entry.target);
        observer.unobserve(entry.target);
        loader();
      });
    },
    { threshold: 0.05, rootMargin: "160px" }
  );
  return sharedVideoObserver;
}

function createVideoElement(src) {
  return el("video", {
    src: resolveMediaSrc(src),
    preload: "metadata",
    playsinline: "",
    "webkit-playsinline": "",
    muted: "",
    loop: "",
  });
}

function setupVideoEvents(video, playButton, wrapper, src) {
  const updateIcon = () => {
    playButton.classList.toggle("is-paused", video.paused);
    playButton.classList.toggle("is-playing", !video.paused);
  };

  updateIcon();
  video.addEventListener("play", updateIcon);
  video.addEventListener("pause", updateIcon);

  wrapper.addEventListener("click", () => {
    const shouldPlay = video.paused;
    allVideos.forEach((item) => {
      if (!item.paused && item !== video) item.pause();
    });

    if (!shouldPlay) {
      video.pause();
      return;
    }

    if (video.readyState < 2) video.preload = "auto";
    video.play().catch(() => {});
    enqueueVideoPrefetch(src);
    enqueueAllVideosInOrder();
  });
}

function createLoadingIndicator() {
  return el("div", {
    class: "loading-indicator",
    html: '<div class="spinner" aria-hidden="true"></div>',
  });
}

function mediaNode(src, label, isSimple = false, options = {}) {
  const wrapper = el("div", { class: "grid-video-wrap lazy-video" });
  const loadingIndicator = createLoadingIndicator();
  const playButton = el("div", { class: "grid-play-icon is-paused" });

  wrapper.appendChild(loadingIndicator);
  wrapper.appendChild(playButton);
  wrapper.title = label;

  if (options.syncAspectRatio) {
    wrapper.style.aspectRatio = "16 / 9";
  }

  const mountVideo = () => {
    if (wrapper.querySelector("video")) return;

    const resolved = resolveMediaSrc(src);
    const video = createVideoElement(src);
    const reveal = () => {
      if (wrapper.contains(loadingIndicator)) loadingIndicator.remove();
      wrapper.classList.add("loaded");
    };

    wrapper.insertBefore(video, loadingIndicator);
    video.addEventListener("loadedmetadata", reveal, { once: true });
    video.addEventListener("canplay", reveal, { once: true });
    video.addEventListener("error", reveal, { once: true });
    window.setTimeout(reveal, 15000);

    allVideos.push(video);
    loadedVideoUrls.add(resolved);

    if (options.syncAspectRatio) {
      video.addEventListener(
        "loadedmetadata",
        () => {
          if (video.videoWidth && video.videoHeight) {
            wrapper.style.aspectRatio = `${video.videoWidth} / ${video.videoHeight}`;
          }
        },
        { once: true }
      );
    }

    setupVideoEvents(video, playButton, wrapper, src);
  };

  lazyVideoLoaders.set(wrapper, mountVideo);
  getSharedVideoObserver().observe(wrapper);

  if (isSimple) return wrapper;

  return el("div", { class: "grid-card" }, [
    wrapper,
    el("div", { class: "grid-label", text: label }),
  ]);
}

function renderCompareMatrix(container) {
  container.innerHTML = "";
  container.appendChild(
    el("div", { class: "section-head" }, [
      el("h2", { class: "page-title", text: "Comparison Results" }),
      el("p", {
        class: "page-subtitle",
        text: "Click a video to play or pause. Each column corresponds to a method.",
      }),
    ])
  );

  const grid = el("div", { class: "compare-grid-container" });
  grid.style.setProperty("--cols", String(COL_MODELS.length));

  const fragment = document.createDocumentFragment();
  ROW_CASES.forEach((caseId) => {
    const row = el("div", { class: "compare-grid-row" });
    COL_MODELS.forEach((model, index) => {
      const cell = el("div", { class: "compare-cell" });
      if (SEPARATOR_COL_INDICES.includes(index)) {
        cell.classList.add("has-separator");
      }
      cell.appendChild(
        mediaNode(getCompareVideoPath(model, caseId), MODEL_LABELS[model] || model, false, {
          syncAspectRatio: true,
        })
      );
      row.appendChild(cell);
    });
    fragment.appendChild(row);
  });

  grid.appendChild(fragment);
  container.appendChild(grid);
  window.requestAnimationFrame(syncCompareCellSizeToCssVars);
}

function syncCompareCellSizeToCssVars() {
  const firstWrap = document.querySelector("#tbCompare .compare-cell .grid-video-wrap");
  if (!firstWrap) return;

  const { width, height } = firstWrap.getBoundingClientRect();
  if (!width || !height) return;

  const area = width * height;
  const root = document.documentElement;

  root.style.setProperty("--compare-cell-width", `${width}px`);
  root.style.setProperty("--compare-cell-height", `${height}px`);
  root.style.setProperty("--example-cell-area", String(area));
  root.style.setProperty(
    "--example-portrait-width",
    `${Math.sqrt((area * 9) / 16)}px`
  );
  root.style.setProperty(
    "--example-portrait-height",
    `${Math.sqrt((area * 16) / 9)}px`
  );
  root.style.setProperty(
    "--example-landscape-width",
    `${Math.sqrt((area * 16) / 9)}px`
  );
  root.style.setProperty(
    "--example-landscape-height",
    `${Math.sqrt((area * 9) / 16)}px`
  );
}

window.addEventListener("resize", () => {
  window.clearTimeout(resizeTimer);
  resizeTimer = window.setTimeout(syncCompareCellSizeToCssVars, 250);
});

function imageNode(src, label, options = {}) {
  const img = el("img", {
    src: resolveMediaSrc(src),
    alt: label || "",
    loading: "lazy",
    decoding: "async",
  });
  const wrapper = el("div", { class: "grid-image-wrap" }, [img]);
  wrapper.title = label;

  if (options.syncAspectRatio !== false) {
    img.addEventListener("load", () => {
      if (img.naturalWidth && img.naturalHeight) {
        wrapper.style.aspectRatio = `${img.naturalWidth} / ${img.naturalHeight}`;
      }
    });
  }

  return wrapper;
}

function audioNode(src, label) {
  const audio = el("audio", {
    src: resolveMediaSrc(src),
    preload: "metadata",
  });
  const button = el("button", { class: "audio-btn", type: "button" });
  const wrapper = el("div", { class: "grid-audio-wrap" }, [button, audio]);
  wrapper.title = label;

  const updateLabel = () => {
    button.textContent = audio.paused ? "Play" : "Pause";
  };

  updateLabel();
  allAudios.push(audio);
  audio.addEventListener("play", updateLabel);
  audio.addEventListener("pause", updateLabel);
  button.addEventListener("click", () => {
    const shouldPlay = audio.paused;
    allAudios.forEach((item) => {
      if (!item.paused && item !== audio) item.pause();
    });
    if (!shouldPlay) {
      audio.pause();
      return;
    }
    if (audio.readyState < 2) audio.preload = "auto";
    audio.play().catch(() => {});
  });

  return wrapper;
}

function textNode(text) {
  return el("div", { class: "grid-text-wrap" }, [
    el("div", { class: "grid-text-content", text: text || "" }),
  ]);
}

function placeholderNode(modality) {
  return el("div", { class: "ex-placeholder ex-placeholder-missing-modality" }, [
    el("span", {
      class: "ex-placeholder-icon",
      "aria-hidden": "true",
      text: "x",
    }),
    el("span", {
      class: "ex-placeholder-text",
      text: PLACEHOLDER_LABELS[modality] || "Modality not available",
    }),
  ]);
}

function wrapMediaCell(content) {
  return el("div", { class: "example-media-cell" }, [content]);
}

function renderExampleRow(original, rowData, orientation = "landscape") {
  const row = el("div", { class: "example-row" });
  const cells = el("div", { class: `example-row-cells mode-${orientation}` });
  const type = rowData.type;
  const mediaOptions = { syncAspectRatio: false };

  if (type === "video_audio_image_text" || type === "video_image_text") {
    cells.appendChild(
      wrapMediaCell(
        original.video
          ? mediaNode(original.video, "Input video", true, mediaOptions)
          : placeholderNode("video")
      )
    );
  } else {
    cells.appendChild(wrapMediaCell(placeholderNode("video")));
  }

  cells.appendChild(
    wrapMediaCell(
      original.image
        ? imageNode(original.image, "Input image", { syncAspectRatio: false })
        : placeholderNode("image")
    )
  );

  if (type === "video_audio_image_text" || type === "audio_image_text") {
    cells.appendChild(
      wrapMediaCell(
        original.audio
          ? audioNode(original.audio, "Input audio")
          : placeholderNode("audio")
      )
    );
  } else {
    cells.appendChild(wrapMediaCell(placeholderNode("audio")));
  }

  cells.appendChild(wrapMediaCell(textNode(original.text || "")));

  const oursWrapper = el("div", { class: "example-ours-wrapper" });
  oursWrapper.appendChild(
    wrapMediaCell(
      rowData.output?.bgm
        ? mediaNode(rowData.output.bgm, "Ours BGM", true, mediaOptions)
        : placeholderNode("video")
    )
  );
  oursWrapper.appendChild(
    wrapMediaCell(
      rowData.output?.vocal
        ? mediaNode(rowData.output.vocal, "Ours Vocal", true, mediaOptions)
        : placeholderNode("video")
    )
  );

  cells.appendChild(oursWrapper);
  row.appendChild(cells);
  return row;
}

function renderCategory(category) {
  const orientation = category.orientation || "landscape";
  const section = el("div", { class: `example-category ${orientation}` });

  section.appendChild(
    el("h3", { class: "category-title", text: category.name || "Category" })
  );

  const headerRow = el("div", { class: "example-header-row" });
  const headerCells = el("div", {
    class: `example-row-cells mode-${orientation}`,
  });
  ["Input video", "Input image", "Input audio", "Input text"].forEach((label) => {
    headerCells.appendChild(el("div", { class: "ex-header-cell", text: label }));
  });

  const oursHeader = el("div", { class: "example-ours-wrapper" });
  oursHeader.appendChild(el("div", { class: "ex-header-cell", text: "Ours BGM" }));
  oursHeader.appendChild(
    el("div", { class: "ex-header-cell", text: "Ours Vocal" })
  );
  headerCells.appendChild(oursHeader);
  headerRow.appendChild(headerCells);
  section.appendChild(headerRow);

  const sortedRows = (category.rows || [])
    .slice()
    .sort((a, b) => ROW_ORDER.indexOf(a.type) - ROW_ORDER.indexOf(b.type));

  sortedRows.forEach((rowData) => {
    section.appendChild(renderExampleRow(category.original || {}, rowData, orientation));
  });

  return section;
}

function sortCategories(categories) {
  return (categories || []).slice().sort((a, b) => {
    const weight = (category) => {
      if (category.id === "live") return 999;
      return (category.orientation || "landscape") === "portrait" ? 0 : 1;
    };
    return weight(a) - weight(b);
  });
}

function queueExampleBatchRender(renderNextBatch) {
  if (exampleRenderState.nextBatchQueued) return;
  exampleRenderState.nextBatchQueued = true;
  scheduleLowPriorityWork(() => {
    exampleRenderState.nextBatchQueued = false;
    renderNextBatch();
  });
}

function mountExampleBatches(container, categories) {
  disconnectExampleObservers();

  let index = 0;
  const total = categories.length;
  const sentinel = el("div", {
    class: "examples-sentinel",
    "aria-hidden": "true",
  });

  const renderNextBatch = () => {
    if (index >= total) return;

    const fragment = document.createDocumentFragment();
    const end = Math.min(index + EXAMPLES_BATCH_SIZE, total);

    while (index < end) {
      fragment.appendChild(renderCategory(categories[index]));
      index += 1;
    }

    container.insertBefore(fragment, sentinel);

    if (index >= total) {
      sentinel.remove();
      if (exampleRenderState.batchObserver) {
        exampleRenderState.batchObserver.disconnect();
        exampleRenderState.batchObserver = null;
      }
      exampleRenderState.sentinel = null;
      exampleRenderState.loaded = true;
      setStatus("");
      return;
    }

    setStatus(`Examples rendered: ${index}/${total}`);
  };

  container.appendChild(sentinel);
  exampleRenderState.sentinel = sentinel;
  renderNextBatch();

  if (index >= total) return;

  exampleRenderState.batchObserver = new IntersectionObserver(
    (entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        queueExampleBatchRender(renderNextBatch);
      }
    },
    { rootMargin: "280px" }
  );
  exampleRenderState.batchObserver.observe(sentinel);
}

async function renderExampleGallery(container) {
  if (exampleRenderState.loading || exampleRenderState.loaded) return;

  exampleRenderState.loading = true;
  container.innerHTML = "";
  setStatus("Loading examples...");

  try {
    const response = await fetch(EXAMPLE_MP4_URL);
    const data = await response.json();
    const categories = sortCategories(data.categories);

    container.appendChild(
      el("div", { class: "section-head" }, [
        el("h2", {
          class: "page-title",
          text: data.title || "Example Videos",
        }),
        el("p", {
          class: "page-subtitle",
          text: "Categories are rendered in small batches to keep the page responsive.",
        }),
      ])
    );

    if (categories.length === 0) {
      container.appendChild(
        el("div", { class: "examples-placeholder" }, [
          el("div", {
            class: "examples-placeholder-copy",
            text: "No example data is available.",
          }),
        ])
      );
      exampleRenderState.loaded = true;
      setStatus("");
      return;
    }

    mountExampleBatches(container, categories);
  } catch (error) {
    console.error(error);
    container.innerHTML = "";
    container.appendChild(
      el("div", { class: "examples-placeholder is-error" }, [
        el("div", {
          class: "examples-placeholder-copy",
          text: "Failed to load examples.",
        }),
      ])
    );
    setStatus("Failed to load examples.");
  } finally {
    exampleRenderState.loading = false;
  }
}

function setupDeferredExampleGallery() {
  const galleryEl = document.getElementById("videoGallery");
  const triggerEl = document.getElementById("page-3") || galleryEl;
  if (!galleryEl || !triggerEl) return;

  galleryEl.innerHTML = "";
  galleryEl.appendChild(
    el("div", { class: "examples-placeholder" }, [
      el("div", {
        class: "examples-placeholder-title",
        text: "Examples load on demand",
      }),
      el("div", {
        class: "examples-placeholder-copy",
        text: "Scroll to this section to render the media-heavy gallery.",
      }),
    ])
  );

  exampleRenderState.triggerObserver = new IntersectionObserver(
    (entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      if (exampleRenderState.triggerObserver) {
        exampleRenderState.triggerObserver.disconnect();
        exampleRenderState.triggerObserver = null;
      }
      scheduleLowPriorityWork(() => renderExampleGallery(galleryEl));
    },
    { rootMargin: "420px" }
  );
  exampleRenderState.triggerObserver.observe(triggerEl);
}

function initAbstractToggle() {
  const text = document.getElementById("abstractText");
  const button = document.getElementById("abstractToggle");
  if (!text || !button) return;

  const updateButton = () => {
    const expanded = !text.classList.contains("is-collapsed");
    button.textContent = expanded ? "Collapse abstract" : "Read full abstract";
    button.setAttribute("aria-expanded", String(expanded));
  };

  text.classList.add("is-collapsed");
  updateButton();

  button.addEventListener("click", () => {
    text.classList.toggle("is-collapsed");
    updateButton();
  });

  window.requestAnimationFrame(() => {
    const isOverflowing = text.scrollHeight > text.clientHeight + 8;
    button.hidden = !isOverflowing;
    if (!isOverflowing) {
      text.classList.remove("is-collapsed");
      updateButton();
    }
  });
}

function init() {
  const reloadButton = document.getElementById("reloadBtn");
  if (reloadButton) {
    reloadButton.addEventListener("click", () => renderAll());
  }

  initAbstractToggle();
  renderAll();
}

function renderAll() {
  resetRuntimeState();

  const compareEl = document.getElementById("tbCompare");
  if (compareEl) renderCompareMatrix(compareEl);

  window.requestAnimationFrame(() => {
    syncCompareCellSizeToCssVars();
    setupDeferredExampleGallery();
  });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init, { once: true });
} else {
  init();
}
