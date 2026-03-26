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
    // Compatibility for root and /web/: demo_io paths should resolve from site root
    const base = typeof document !== "undefined" && document.baseURI ? document.baseURI : "";
    const normalized = base.replace(/\/$/, "");
    const baseForDemo = normalized.endsWith("/web") ? new URL("../", base) : new URL(base);
    const resolved = new URL(src, baseForDemo.href);
    return resolved.href;
  } catch {
    return src;
  }
}

const allVideos = [];
const allAudios = [];

function mediaNode(src, label, isSimple = false, options = {}) {
  const resolved = resolveMediaSrc(src);
  const video = el("video", {
    src: resolved,
    preload: "metadata",
    playsinline: "",
    "webkit-playsinline": "",
    muted: "",
    loop: "", // Looping makes demos smoother
  });

  const btnPlay = el("div", { class: "grid-play-icon" });
  const wrapper = el("div", { class: "grid-video-wrap" }, [video, btnPlay]);

  // In Comparison Results, sync container aspect ratio to avoid letterboxing
  if (options.syncAspectRatio) {
    video.addEventListener("loadedmetadata", () => {
      if (video.videoWidth && video.videoHeight) {
        wrapper.style.aspectRatio = `${video.videoWidth} / ${video.videoHeight}`;
      }
    });
  }

  allVideos.push(video);

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

  wrapper.addEventListener("click", () => {
    const willPlay = video.paused;
    allVideos.forEach((v) => { if (!v.paused) v.pause(); });
    if (willPlay) video.play().catch(() => {});
    else video.pause();
  });

  // Simple mode is used in Examples: no bottom label; show tooltip via title attribute
  if (isSimple) {
    wrapper.title = label; // Tooltip
    return wrapper;
  }

  return el("div", { class: "grid-card" }, [
    wrapper,
    el("div", { class: "grid-label", text: label }),
  ]);
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
}

// Requirement 3/5: write the first-cell size to CSS vars, and compute equal-area sizes for portrait/landscape
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

// --- Examples: new layout (video, image, audio, text, plus two Ours columns) ---

// Display order (top to bottom):
// full modalities (video, image, audio, text) → missing audio (video, image, text) → missing video (image, audio, text) → missing video+audio (image, text)
const ROW_ORDER = ["video_audio_image_text", "video_image_text", "audio_image_text", "image_text"];

// Create an image node.
// Default: set wrapper aspect-ratio based on natural size; can be disabled via options.syncAspectRatio = false
function imageNode(src, label, options = {}) {
  const resolved = resolveMediaSrc(src);
  const img = el("img", {
    src: resolved,
    alt: label || "",
    loading: "lazy",
  });
  const wrapper = el("div", { class: "grid-image-wrap" }, [img]);
  wrapper.title = label; // Tooltip
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

// Create an audio node
function audioNode(src, label) {
  const resolved = resolveMediaSrc(src);
  const audio = el("audio", {
    src: resolved,
    preload: "metadata",
  });
  const btn = el("button", { class: "audio-btn", type: "button" });
  const wrapper = el("div", { class: "grid-audio-wrap" }, [btn, audio]);
  wrapper.title = label; // Tooltip

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

// Create a text node
function textNode(text) {
  return el("div", { class: "grid-text-wrap" }, [
    el("div", { class: "grid-text-content", text: text || "" })
  ]);
}

// Missing-modality placeholder: short label + minimal icon
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

// Requirement 7: equal-area media cells within the same row
function wrapMediaCell(content) {
  const cell = el("div", { class: "example-media-cell" });
  cell.appendChild(content);
  return cell;
}

// Render a row by type (orientation controls CSS sizing via mode-portrait/mode-landscape)
function renderExampleRow(original, rowData, orientation = "landscape") {
  const row = el("div", { class: "example-row" });
  const cells = el("div", { class: `example-row-cells mode-${orientation}` });

  const type = rowData.type;
  // In Examples, the visible size is controlled by CSS; do not sync wrapper aspect-ratio from metadata
  const mediaOpts = { syncAspectRatio: false };

  if (type === "video_audio_image_text") {
    if (original.video) cells.appendChild(wrapMediaCell(mediaNode(original.video, "Input video", true, mediaOpts)));
    else cells.appendChild(wrapMediaCell(placeholderNode("video")));

    if (original.image) cells.appendChild(wrapMediaCell(imageNode(original.image, "Input image", { syncAspectRatio: false })));
    else cells.appendChild(wrapMediaCell(placeholderNode("image")));

    // Put audio into example-media-cell so the button centers and aligns with input video
    cells.appendChild(wrapMediaCell(audioNode(original.audio, "Input audio")));
    // Put text into example-media-cell so the block centers (content still left-aligned)
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

// Render a category section
function renderCategory(category) {
  const orientation = category.orientation || "landscape";
  const categorySection = el("div", { class: `example-category ${orientation}` });

  // Category title
  const categoryTitle = el("h3", { class: "category-title", text: category.name });
  categorySection.appendChild(categoryTitle);
  
  // Header row (same mode as data rows to keep columns aligned)
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
  
  // Sort by fixed order and render rows
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
    
    // Top title
    container.appendChild(el("div", { class: "section-head" }, [
      el("h2", { class: "page-title", text: data.title || "Example Videos" }),
    ]));

    const categories = (data.categories || [])
      .slice()
      .sort((a, b) => {
        // Sorting rules:
        // 1) Default: portrait first, landscape after
        // 2) Special: id === "live" stays last
        const weight = (cat) => {
          if (cat.id === "live") return 999; // force after all categories
          return (cat.orientation || "landscape") === "portrait" ? 0 : 1;
        };
        return weight(a) - weight(b);
      });
    
    // Render categories
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