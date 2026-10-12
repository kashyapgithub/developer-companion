/**
 * recorder-core.js — records a MediaStream, with pause, and can grab the
 * exact frame on screen at any moment.
 *
 * Pure browser APIs (MediaRecorder + a hidden <video>), no extension APIs,
 * so it can be tested with a fake stream. The timer counts recorded time only:
 * paused time doesn't count, which is what moment timestamps refer to.
 */

const FRAME_MAX_WIDTH = 1280;   // longest side of a grabbed frame
const FRAME_QUALITY = 0.82;     // JPEG quality
const CHUNK_MS = 1000;          // MediaRecorder emits data this often

/** Best WebM flavour this browser can record. */
function pickMimeType() {
  return ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"].find((t) => MediaRecorder.isTypeSupported(t)) || "";
}

/**
 * @param {MediaStream} stream
 * @param {{onEnded?: () => void}} [hooks]  onEnded: the user stopped sharing from the browser's own bar
 */
export async function createRecorder(stream, { onEnded = () => {} } = {}) {
  const video = document.createElement("video");
  video.muted = true;
  video.srcObject = stream;
  await video.play();

  const recorder = new MediaRecorder(stream, { mimeType: pickMimeType(), videoBitsPerSecond: 2_500_000 });
  const chunks = [];
  recorder.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
  stream.getVideoTracks()[0]?.addEventListener("ended", onEnded);

  let startedAt = 0, pausedAt = 0, pausedTotal = 0;

  return {
    start() { startedAt = Date.now(); recorder.start(CHUNK_MS); },
    pause() { if (recorder.state === "recording") { recorder.pause(); pausedAt = Date.now(); } },
    resume() { if (recorder.state === "paused") { recorder.resume(); pausedTotal += Date.now() - pausedAt; pausedAt = 0; } },
    get state() { return recorder.state; },

    /** Seconds of recorded (not paused) time so far. */
    elapsedSeconds() {
      const now = pausedAt || Date.now();
      return Math.max(0, (now - startedAt - pausedTotal) / 1000);
    },

    /** The frame on screen right now, as a JPEG data URL. */
    grabFrame() {
      const scale = Math.min(1, FRAME_MAX_WIDTH / (video.videoWidth || FRAME_MAX_WIDTH));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
      canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
      canvas.getContext("2d").drawImage(video, 0, 0, canvas.width, canvas.height);
      return canvas.toDataURL("image/jpeg", FRAME_QUALITY);
    },

    /** Stops recording, releases the screen share, resolves to the finished video Blob. */
    stop() {
      return new Promise((resolve) => {
        const finish = () => {
          stream.getTracks().forEach((t) => t.stop());
          video.srcObject = null;
          resolve(new Blob(chunks, { type: "video/webm" }));
        };
        if (recorder.state === "inactive") return finish();
        recorder.onstop = finish;
        recorder.stop();
      });
    },
  };
}

/** "mm:ss" for a number of seconds. */
export function clock(seconds) {
  const s = Math.floor(seconds);
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}
