/**
 * recorder.js — the Record control in the top bar.
 *
 *   idle      [● Record logs]
 *   recording [● 00:42  3 errors · 1 failed request   ⚑  Stop & send]
 *
 * The background service worker owns the recording; this file only mirrors its
 * state (chrome.storage.local "dcRecording") and sends it commands. Because
 * the state lives in storage, the editor tab and the floating hover window
 * show the same timer.
 */

const STATE_KEY = "dcRecording";
const STATUS_CLEAR_MS = 12000;

/** 83 -> "01:23" (hours roll into minutes: 75 min -> "75:00"). */
export function formatClock(totalSeconds) {
  const s = Math.max(0, Math.floor(totalSeconds));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** Live one-liner: what the agent will see so far. */
export function describeCounts(counts, sites) {
  if (!sites.length) return "Not capturing any tab yet";
  const parts = [];
  if (counts.errors) parts.push(plural(counts.errors, "error"));
  if (counts.failedRequests) parts.push(plural(counts.failedRequests, "failed request"));
  if (counts.warnings) parts.push(plural(counts.warnings, "warning"));
  return parts.length ? parts.join(" · ") : `${plural(counts.events, "event")}, no errors`;
}

/** One-liner after Stop: confirms what was handed to the agent. */
export function describeResult(last) {
  if (!last) return "";
  if (!last.ok) return last.error || "Couldn't send the recording";
  const errs = last.counts?.errors || 0;
  return `Sent ${plural(last.sent, "event")}${errs ? ` · ${plural(errs, "error")}` : ""} — ask your agent to check the latest recording`;
}

/** @param {{rootEl?: HTMLElement}} opts */
export function wireRecorder({ rootEl = document } = {}) {
  const $ = (id) => rootEl.querySelector(`#${id}`);
  const startBtn = $("rec-start"), live = $("rec-live"), timer = $("rec-timer"), counts = $("rec-counts");
  const markBtn = $("rec-mark"), stopBtn = $("rec-stop"), status = $("rec-status"), retryBtn = $("rec-retry");
  if (!startBtn) return;

  let state = null;
  let tick = null;
  let statusTimer = null;

  const send = (message) => new Promise((resolve) => chrome.runtime.sendMessage(message, resolve));

  function setStatus(text, kind = "", canRetry = false) {
    retryBtn.classList.toggle("hidden", !canRetry);
    status.textContent = text;
    status.className = `rec-status ${kind}`;
    clearTimeout(statusTimer);
    // A failed send stays on screen until retried; everything else fades.
    if (text && !canRetry) statusTimer = setTimeout(() => setStatus(""), STATUS_CLEAR_MS);
  }

  function paintTimer() {
    timer.textContent = formatClock((Date.now() - Date.parse(state.startedAt)) / 1000);
  }

  /** Re-draws everything from `state`. Runs on every storage change. */
  function render() {
    const active = !!state?.active;
    startBtn.classList.toggle("hidden", active);
    // The live pill is wide: let the rest of the bar drop its text labels while recording.
    document.getElementById("toolbar")?.classList.toggle("recording", active);
    live.classList.toggle("hidden", !active);
    clearInterval(tick);
    if (active) {
      paintTimer();
      tick = setInterval(paintTimer, 250);
      counts.textContent = describeCounts(state.counts, state.sites);
      counts.classList.toggle("warn", !state.sites.length);
      stopBtn.disabled = false;
      stopBtn.textContent = "Stop & send";
    }
  }

  startBtn.addEventListener("click", async () => {
    setStatus("");
    const res = await send({ type: "REC_START" });
    if (!res?.ok) setStatus("Couldn't start recording", "err");
    else if (!res.attachedApps?.length) setStatus("Open your app on localhost (or add its site in settings) so there's something to record.", "warn");
  });

  markBtn.addEventListener("click", async () => {
    await send({ type: "REC_MARK" });
    markBtn.classList.add("flash");
    setTimeout(() => markBtn.classList.remove("flash"), 400);
  });

  stopBtn.addEventListener("click", async () => {
    stopBtn.disabled = true;
    stopBtn.textContent = "Sending…";
    const res = await send({ type: "REC_STOP" });
    setStatus(describeResult(res?.last), res?.ok ? "ok" : "err", !!res?.last?.canRetry);
  });

  retryBtn.addEventListener("click", async () => {
    retryBtn.disabled = true;
    const res = await send({ type: "REC_RETRY" });
    retryBtn.disabled = false;
    setStatus(describeResult(res?.last), res?.ok ? "ok" : "err", !!res?.last?.canRetry);
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local" || !changes[STATE_KEY]) return;
    state = changes[STATE_KEY].newValue;
    render();
  });
  chrome.storage.local.get(STATE_KEY).then((got) => { state = got[STATE_KEY] || null; render(); });
}
