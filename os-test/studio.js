// ---------------------------------------------------------------------------
// studio.js — Cross-OS Test Studio UI
//
// Ported from the standalone cross-os tester popup and adapted for
// Developer Companion, where it opens as a pop-out window from the canvas
// toolbar ("Cross-OS Test" button). Thin UI layer only — all GitHub API
// work lives in lib/os-test.js inside the unified background service
// worker. Opens a long-lived port and updates each bench slot as
// COMBO_READY messages stream in, so each OS updates independently.
// ---------------------------------------------------------------------------

const currentUrlEl = document.getElementById("current-url");
const runBtn = document.getElementById("run-btn");
const statusLine = document.getElementById("status-line");
const settingsBtn = document.getElementById("settings-btn");
const setupBanner = document.getElementById("setup-banner");
const setupBannerBtn = document.getElementById("setup-banner-btn");

const modeUrlBtn = document.getElementById("mode-url-btn");
const modeRepoBtn = document.getElementById("mode-repo-btn");
const panelUrl = document.getElementById("panel-url");
const panelRepo = document.getElementById("panel-repo");
const repoPathInput = document.getElementById("repo-path-input");
let currentTestMode = "url";

const lightboxModal = document.getElementById("lightbox-modal");
const lightboxBackdrop = document.getElementById("lightbox-backdrop");
const lightboxClose = document.getElementById("lightbox-close");
const lightboxTitle = document.getElementById("lightbox-title");
const lightboxImg = document.getElementById("lightbox-img");

const browserCheckboxes = {
  chromium: document.getElementById("browser-chromium"),
  firefox: document.getElementById("browser-firefox"),
  webkit: document.getElementById("browser-webkit"),
};

const slotByLabel = {
  "Windows · Chrome": document.querySelector('[data-combo="windows"]'),
  "Windows · Firefox": document.querySelector('[data-combo="windows-firefox"]'),
  "Windows · WebKit": document.querySelector('[data-combo="windows-webkit"]'),
  "macOS · Safari": document.querySelector('[data-combo="macos-webkit"]'),
  "macOS · Chrome": document.querySelector('[data-combo="macos"]'),
  "macOS · Firefox": document.querySelector('[data-combo="macos-firefox"]'),
  "Linux · Chrome": document.querySelector('[data-combo="linux"]'),
  "Linux · Firefox": document.querySelector('[data-combo="linux-firefox"]'),
  "Linux · WebKit": document.querySelector('[data-combo="linux-webkit"]'),
};

const comboBrowser = {
  "Windows · Chrome": "chromium",
  "Windows · Firefox": "firefox",
  "Windows · WebKit": "webkit",
  "macOS · Safari": "webkit",
  "macOS · Chrome": "chromium",
  "macOS · Firefox": "firefox",
  "Linux · Chrome": "chromium",
  "Linux · Firefox": "firefox",
  "Linux · WebKit": "webkit",
};

const SETTINGS_URL = chrome.runtime.getURL("os-test/settings.html");

const openSettings = () => {
  chrome.tabs?.create?.({ url: SETTINGS_URL });
};

/**
 * The studio window is opened with ?url=<target> captured by the background
 * at the moment the user clicked the toolbar button. Run flows honor that
 * frozen capture so the URL never drifts mid-session; the focus-refresh
 * handler instead re-reads the browser's actual most-recent http(s) tab so
 * flipping away and back reflects where the user just was.
 */
const getLatestHttpTabUrl = async () => {
  try {
    const tabs = await chrome.tabs.query({ url: ["http://*/*", "https://*/*"] });
    if (!tabs || tabs.length === 0) return "";
    const latest = tabs.reduce((a, b) => ((b.lastAccessed || 0) > (a.lastAccessed || 0) ? b : a));
    return latest?.url ?? "";
  } catch {
    return "";
  }
};

const getActiveTabUrl = async () => {
  let queryUrl = "";
  try {
    queryUrl = new URLSearchParams(location.search).get("url") || "";
  } catch {}
  if (/^https?:\/\//.test(queryUrl)) return queryUrl;
  return getLatestHttpTabUrl();
};

const setStatus = (message, tone = "normal") => {
  statusLine.textContent = message;
  statusLine.dataset.tone = tone;
};

const setSlotState = (slot, state, label) => {
  const stateEl = slot.querySelector(".bench__state");
  if (stateEl) {
    stateEl.dataset.state = state;
    stateEl.textContent = label;
  }
  slot.dataset.active = state === "running";
};

const getSelectedBrowsers = () => {
  const selected = [];
  if (browserCheckboxes.chromium?.checked) selected.push("chromium");
  if (browserCheckboxes.firefox?.checked) selected.push("firefox");
  if (browserCheckboxes.webkit?.checked) selected.push("webkit");

  if (selected.length === 0 && !browserCheckboxes.chromium && !browserCheckboxes.firefox && !browserCheckboxes.webkit) {
    return ["chromium"];
  }

  return selected;
};

const updateSlotVisibility = () => {
  const selected = new Set(getSelectedBrowsers());
  Object.entries(slotByLabel).forEach(([label, slot]) => {
    if (!slot) return;
    const browser = comboBrowser[label];
    slot.hidden = !selected.has(browser);
  });
};

const resetBench = () => {
  const selected = new Set(getSelectedBrowsers());
  Object.entries(slotByLabel).forEach(([label, slot]) => {
    if (!slot) return;
    const browser = comboBrowser[label];
    if (selected.has(browser) || !selected.size) {
      setSlotState(slot, "queued", "Queued");
      const thumb = slot.querySelector(".bench__thumb");
      if (thumb) {
        thumb.hidden = true;
        thumb.removeAttribute("data-expanded");
      }
    }
  });
  const expandAllBtn = document.getElementById("expand-all-btn");
  if (expandAllBtn) {
    expandAllBtn.textContent = "Expand all";
  }
};

const openLightbox = (title, src) => {
  if (!lightboxModal) return;
  if (lightboxTitle) lightboxTitle.textContent = title;
  if (lightboxImg) lightboxImg.src = src;
  lightboxModal.hidden = false;
};

const closeLightbox = () => {
  if (!lightboxModal) return;
  lightboxModal.hidden = true;
  if (lightboxImg) lightboxImg.src = "";
};

const toggleExpandAll = () => {
  const expandAllBtn = document.getElementById("expand-all-btn");
  const visibleSlots = Object.values(slotByLabel).filter((slot) => slot && !slot.hidden);
  const thumbs = visibleSlots
    .map((slot) => slot.querySelector?.(".bench__thumb"))
    .filter(Boolean);

  if (thumbs.length === 0) return;

  const anyCollapsed = thumbs.some((t) => t.dataset?.expanded !== "true");
  const targetState = anyCollapsed ? "true" : "false";

  thumbs.forEach((t) => {
    if (t.dataset) {
      if (anyCollapsed) {
        t.dataset.expanded = "true";
      } else {
        t.removeAttribute?.("data-expanded");
        delete t.dataset?.expanded;
      }
    }
  });

  if (expandAllBtn) {
    expandAllBtn.textContent = anyCollapsed ? "Collapse all" : "Expand all";
  }
};

const markSlotDone = (label, imageUrl) => {
  const slot = slotByLabel[label];
  if (!slot) return;

  setSlotState(slot, "done", "Done");

  const thumb = slot.querySelector(".bench__thumb");
  if (thumb) {
    thumb.src = imageUrl;
    thumb.hidden = false;
    thumb.onclick = () => openLightbox(label, imageUrl);
  }
};

const setTestMode = (mode, shouldPersist = false) => {
  currentTestMode = mode;
  if (modeUrlBtn) {
    modeUrlBtn.classList?.toggle?.("is-active", mode === "url");
    modeUrlBtn.setAttribute?.("aria-selected", String(mode === "url"));
  }
  if (modeRepoBtn) {
    modeRepoBtn.classList?.toggle?.("is-active", mode === "repo");
    modeRepoBtn.setAttribute?.("aria-selected", String(mode === "repo"));
  }
  if (panelUrl) panelUrl.hidden = mode !== "url";
  if (panelRepo) panelRepo.hidden = mode !== "repo";

  if (shouldPersist) {
    chrome.storage?.local?.set?.({ testMode: mode });
  }
};

const handleRunClick = async () => {
  // Disabled synchronously, before any await — an async function yields
  // control back to the browser at the first `await`, so a fast double-
  // click could otherwise invoke this handler a second time before the
  // first call ever reaches the line that disables the button, firing two
  // overlapping GitHub Actions runs from one click.
  if (runBtn.disabled) return;
  runBtn.disabled = true;

  let targetUrl = "";
  let repoPath = "docs/index.html";

  if (currentTestMode === "url") {
    targetUrl = await getActiveTabUrl();

    if (!/^https?:\/\//.test(targetUrl)) {
      setStatus("This isn't a testable web page — open a real http(s) site first, or switch to '📁 GitHub Repo' mode.", "error");
      runBtn.disabled = false;
      return;
    }
  } else {
    repoPath = repoPathInput?.value?.trim() || "docs/index.html";
    if (!repoPath) {
      setStatus("Please enter a file path inside your repository (e.g. docs/index.html).", "error");
      runBtn.disabled = false;
      return;
    }
  }

  const selectedBrowsers = getSelectedBrowsers();
  if (selectedBrowsers.length === 0) {
    setStatus("Please select at least one browser to test.", "error");
    runBtn.disabled = false;
    return;
  }

  resetBench();
  setStatus(currentTestMode === "repo" ? `Starting repo test for "${repoPath}"…` : "Starting run…");

  const port = chrome.runtime.connect({ name: "cross-os-test" });

  port.onMessage.addListener((message) => {
    if (message.type === "TRIGGERED") {
      setStatus("Workflow triggered — waiting for runners to spin up…");
      const selected = new Set(getSelectedBrowsers());
      Object.entries(slotByLabel).forEach(([label, slot]) => {
        if (!slot) return;
        const browser = comboBrowser[label];
        if (selected.has(browser) || !selected.size) {
          setSlotState(slot, "running", "Running…");
        }
      });
      return;
    }

    if (message.type === "COMBO_READY") {
      markSlotDone(message.label, message.imageUrl);
      return;
    }

    if (message.type === "RUN_FINISHED") {
      setStatus(message.timedOut ? "Some OSes timed out — check the Actions tab." : "All done ✓");
      runBtn.disabled = false;
      port.disconnect();
      return;
    }

    if (message.type === "ERROR") {
      if (message.error === "MISSING_CREDENTIALS") {
        setStatus("No GitHub setup yet — opening configuration…", "error");
        openSettings();
      } else {
        setStatus(`Failed: ${message.error}`, "error");
      }
      runBtn.disabled = false;
      port.disconnect();
    }
  });

  port.postMessage({
    type: "START",
    testMode: currentTestMode,
    targetUrl,
    repoPath,
    fullPage: document.getElementById("fullpage-toggle")?.checked ?? true,
    browsers: selectedBrowsers,
  });
};

const init = async () => {
  if (currentUrlEl) {
    currentUrlEl.textContent = await getActiveTabUrl();
  }

  window.addEventListener("focus", async () => {
    // When the user flips back into this window after browsing another
    // site, refresh the suggested target URL from their latest http(s) tab
    // — but leave it alone mid-run.
    if (!runBtn.disabled && currentTestMode === "url" && currentUrlEl) {
      currentUrlEl.textContent = await getLatestHttpTabUrl();
    }
  });

  runBtn?.addEventListener("click", handleRunClick);
  settingsBtn?.addEventListener("click", openSettings);
  setupBannerBtn?.addEventListener("click", openSettings);

  // Check if credentials are missing to guide first-time users.
  // Credentials may come from this tool's own keys (githubPat/repoOwner/
  // repoName) or fall back to the GitHub Dashboard token stored under the
  // dashboard's merged `settings` object.
  const [creds, settingsStore] = await Promise.all([
    chrome.storage.local.get(["githubPat", "repoOwner", "repoName"]),
    chrome.storage.local.get("settings"),
  ]);
  const dashboardToken = settingsStore?.settings?.githubToken || "";
  const hasToken = Boolean(creds?.githubPat || dashboardToken);
  if (!hasToken || !creds?.repoOwner || !creds?.repoName) {
    if (setupBanner) setupBanner.hidden = false;
  }

  // Restore the last-used capture mode & browser selection — without
  // this, the toggle silently resets every time the window reopens.
  const { fullPage, selectedBrowsers } = await chrome.storage.local.get(["fullPage", "selectedBrowsers"]);
  const fullPageToggle = document.getElementById("fullpage-toggle");
  const fullPageToggleLabel = document.getElementById("fullpage-toggle-label");
  if (fullPageToggle && fullPage !== undefined) {
    fullPageToggle.checked = fullPage;
    if (fullPageToggleLabel) {
      fullPageToggleLabel.textContent = fullPage ? "Full page" : "Visible area only";
    }
  }

  if (fullPageToggle) {
    fullPageToggle.addEventListener("change", () => {
      if (fullPageToggleLabel) {
        fullPageToggleLabel.textContent = fullPageToggle.checked ? "Full page" : "Visible area only";
      }
      chrome.storage.local.set({ fullPage: fullPageToggle.checked });
    });
  }

  if (selectedBrowsers && Array.isArray(selectedBrowsers)) {
    if (browserCheckboxes.chromium) browserCheckboxes.chromium.checked = selectedBrowsers.includes("chromium");
    if (browserCheckboxes.firefox) browserCheckboxes.firefox.checked = selectedBrowsers.includes("firefox");
    if (browserCheckboxes.webkit) browserCheckboxes.webkit.checked = selectedBrowsers.includes("webkit");
  }

  const saveBrowsers = () => {
    const browsers = getSelectedBrowsers();
    chrome.storage.local.set({ selectedBrowsers: browsers });
    updateSlotVisibility();
  };

  Object.values(browserCheckboxes).forEach((cb) => {
    cb?.addEventListener?.("change", saveBrowsers);
  });

  updateSlotVisibility();

  // Mode selection & repo path inputs
  modeUrlBtn?.addEventListener?.("click", () => setTestMode("url", true));
  modeRepoBtn?.addEventListener?.("click", () => setTestMode("repo", true));
  repoPathInput?.addEventListener?.("change", () => {
    const val = repoPathInput.value?.trim();
    if (val) chrome.storage?.local?.set?.({ repoPath: val });
  });

  const { testMode, repoPath } = await chrome.storage.local.get(["testMode", "repoPath"]);
  setTestMode(testMode || "url", false);
  if (repoPath && repoPathInput) {
    repoPathInput.value = repoPath;
  }

  const expandAllBtn = document.getElementById("expand-all-btn");
  if (expandAllBtn) {
    expandAllBtn.textContent = "Expand all";
    expandAllBtn.addEventListener("click", toggleExpandAll);
  }

  lightboxClose?.addEventListener?.("click", closeLightbox);
  lightboxBackdrop?.addEventListener?.("click", closeLightbox);
  document.addEventListener("keydown", (e) => {
    if (e?.key === "Escape") closeLightbox();
  });
};

init();
