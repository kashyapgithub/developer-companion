/**
 * video.js — the Video review window.
 *
 *   record → pause on any moment → write what you WANT vs what's HAPPENING →
 *   resume → stop → the video and all moments go to your agent (get_video_review).
 *
 * The recording itself lives in recorder-core.js; this file is the screens,
 * the moments list, and the hand-off to the log recorder and the server.
 */

import { createRecorder, clock } from "./recorder-core.js";
import { uploadReview } from "./review-upload.js";
import { createAnnotator } from "./annotate-overlay.js";

const $ = (id) => document.getElementById(id);
const SCREENS = ["idle", "live", "paused", "done"];
const TICK_MS = 250;

let recorder = null;
let moments = [];            // { at, seconds, frame, expected, actual }
let reviewId = null;
let logRecordingId = null;   // set when logs were captured alongside
let sourceLabel = null;
let tick = null;
let pendingFrame = null;     // frame shown on the "paused" screen
let annotTool = "arrow";     // current annotation tool
const annotator = createAnnotator($("frame"), $("ann-canvas"), { tool: () => annotTool, color: () => $("ann-color").value });

/** Shows one screen and tags <body> so the timer colour follows the state. */
function show(screen) {
  SCREENS.forEach((s) => { $(s).hidden = s !== screen; });
  document.body.classList.toggle("recording", screen === "live");
  document.body.classList.toggle("paused", screen === "paused");
}

function renderMoments() {
  $("moments-wrap").hidden = moments.length === 0;
  $("moments").textContent = "";
  for (const m of moments) {
    const li = document.createElement("li");
    li.innerHTML = "<b></b><span class='want'></span><br><span class='is'></span>";
    li.querySelector("b").textContent = m.at;
    li.querySelector(".want").textContent = m.expected ? `Want: ${m.expected}` : "(marked)";
    li.querySelector(".is").textContent = m.actual ? `Happening: ${m.actual}` : "";
    $("moments").append(li);
  }
}

// ---- recording ----------------------------------------------------------------

/** Starts recording a MediaStream (public so tests can pass a fake one). */
async function begin(stream) {
  reviewId = `video-${Date.now().toString(36)}`;
  moments = []; renderMoments();
  sourceLabel = stream.getVideoTracks()[0]?.label || null;
  recorder = await createRecorder(stream, { onEnded: () => { if (recorder) stop(); } });
  recorder.start();
  logRecordingId = $("with-logs").checked ? await startLogs() : null;
  tick = setInterval(() => { $("timer").textContent = clock(recorder.elapsedSeconds()); }, TICK_MS);
  show("live");
}

async function chooseAndBegin() {
  let stream;
  try { stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false }); }
  catch { return; } // the user closed the picker
  await begin(stream);
}

/** Starts the console/network recorder at the same time; the agent can read both. Best effort. */
async function startLogs() {
  try { return (await chrome.runtime.sendMessage({ type: "REC_START" }))?.state?.id || null; } catch { return null; }
}
async function stopLogs() {
  try { await chrome.runtime.sendMessage({ type: "REC_STOP" }); } catch { /* not running */ }
}

// ---- moments --------------------------------------------------------------------

function currentMoment(extra = {}) {
  const seconds = recorder.elapsedSeconds();
  return { at: clock(seconds), seconds: Math.round(seconds * 10) / 10, ...extra };
}

/** Pause freezes the video and shows the exact frame for notes. */
function pauseAndAnnotate() {
  recorder.pause();
  pendingFrame = { ...currentMoment(), frame: recorder.grabFrame() };
  $("frame").src = pendingFrame.frame;
  annotator.clear();
  $("frame").decode().catch(() => {}).then(() => annotator.fit());   // size the drawing layer once the frame is laid out
  $("expected").value = $("actual").value = "";
  show("paused");
  $("expected").focus();
}

async function saveMoment() {
  const marks = annotator.describe();
  const frame = await annotator.flatten(pendingFrame.frame);      // drawings burned into the frame the agent receives
  moments.push({ ...pendingFrame, frame, ...(marks ? { annotations: marks } : {}), expected: $("expected").value.trim(), actual: $("actual").value.trim() });
  renderMoments();
  resume();
}

/** One click: keep recording, but remember this frame for the agent. */
function markMoment() {
  moments.push({ ...currentMoment({ frame: recorder.grabFrame() }), expected: "", actual: "" });
  renderMoments();
}

function resume() {
  pendingFrame = null;
  recorder.resume();
  show("live");
}

/** Sends the paused frame to the canvas editor so it can be drawn on. */
async function drawOnIt() {
  const res = await chrome.runtime.sendMessage({
    type: "VIDEO_FRAME_TO_EDITOR",   // to the background, which picks the one editor (a broadcast would add it twice)
    dataUrl: await annotator.flatten(pendingFrame.frame),
    name: `Video frame ${pendingFrame.at}`,
    meta: { kind: "video-frame", at: pendingFrame.at, expected: $("expected").value.trim(), actual: $("actual").value.trim() },
  }).catch(() => null);
  $("to-canvas").textContent = res?.ok ? "Added to canvas ✓" : "Open the editor first";
}

// ---- finishing ----------------------------------------------------------------------

async function stop() {
  const active = recorder;
  recorder = null;
  clearInterval(tick);
  const duration = Math.round(active.elapsedSeconds());
  const blob = await active.stop();
  if (logRecordingId) await stopLogs();
  show("done");
  $("result").className = "result";
  $("result").textContent = "Sending to your agent…";
  const res = await uploadReview({ id: reviewId, blob, durationSeconds: duration, moments, source: sourceLabel, recordingId: logRecordingId });
  $("result").classList.toggle("error", !res.ok);
  $("result").textContent = res.ok
    ? `Sent: ${moments.length} moment${moments.length === 1 ? "" : "s"}, ${clock(duration)} of video. Ask your agent to “check the video review”.`
    : res.error;
}

function reset() {
  $("timer").textContent = "00:00";
  $("to-canvas").textContent = "Draw on it";
  show("idle");
}

// ---- annotation toolbar ----------------------------------------------------------------

document.querySelectorAll("[data-ann-tool]").forEach((b) => {
  b.onclick = () => {
    annotTool = b.dataset.annTool;
    document.querySelectorAll("[data-ann-tool]").forEach((o) => o.classList.toggle("on", o === b));
  };
});
$("ann-undo").onclick = () => annotator.undo();
$("ann-clear").onclick = () => annotator.clear();
addEventListener("resize", () => { if (pendingFrame) annotator.fit(); });

// ---- wiring ---------------------------------------------------------------------------

$("start").onclick = chooseAndBegin;
$("pause").onclick = pauseAndAnnotate;
$("mark").onclick = markMoment;
$("stop").onclick = stop;
$("save-moment").onclick = saveMoment;
$("discard").onclick = resume;
$("to-canvas").onclick = drawOnIt;
$("again").onclick = reset;
addEventListener("beforeunload", (e) => { if (recorder) e.preventDefault(); }); // closing the window would lose the recording

globalThis.__dcVideo = { begin, stop, state: () => ({ moments, reviewId, logRecordingId }) }; // test hook
show("idle");
