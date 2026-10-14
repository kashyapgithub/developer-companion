/**
 * commands.js — lets a trusted client (an MCP agent via `send_browser_command`
 * or `capture_tab`, or the `query_logs.js` CLI) tell this extension to do
 * something, through the local server's command queue.
 *
 * Flow: client queues a command -> this extension long-polls
 * GET /commands/wait (claiming it, so it runs once) -> executes -> PATCHes
 * /commands/<id> with status + result -> the client, still waiting, gets it.
 */

import {
  attachDebugger,
  detachDebugger,
  isAttached,
  captureLocalStorageSnapshot,
} from "./debugger-capture.js";
import { logSender } from "./log-sender.js";

import { captureViaDebugger } from "./tab-capture.js";
import { pickAllowedTab, runPageAction } from "./page-actions.js";
import { startRecording, stopRecording, addMarker, isRecording } from "./recording.js";
import { agentCommands } from "./agent-tools/index.js";

/** Same server address + access code the log sender uses (works for VMs / other computers too). */
async function getServerUrl() {
  return logSender.getEffectiveServerUrl();
}

const WAIT_MS = 20000;        // how long the server may hold a poll open (must stay under the 30s worker idle limit)
const RETRY_MS = 5000;        // pause after a failed poll so an offline server isn't hammered

let loopRunning = false;

/**
 * Starts the command loop (once). It long-polls the server: the request
 * returns the instant the agent queues something, so tools like capture_tab
 * answer in well under a second instead of waiting for a timer.
 * Safe to call repeatedly — an alarm in background.js restarts it if the
 * service worker was recycled.
 * @param {object} deps
 * @param {(hostname: string) => number | undefined} deps.findTabIdByHostname
 * @param {() => string[]} deps.getAttachedHostnames
 */
export function startCommandLoop(deps) {
  if (loopRunning) return;
  loopRunning = true;
  (async () => {
    try {
      for (;;) {
        const serverUrl = await getServerUrl();
        const headers = await logSender.getRequestHeaders();
        let commands = [];
        try {
          const res = await fetch(`${serverUrl}/commands/wait?timeout=${WAIT_MS}`, { headers, signal: AbortSignal.timeout(WAIT_MS + 5000) });
          if (!res.ok) throw new Error(`server said ${res.status}`);
          commands = (await res.json()).commands || [];
        } catch {
          await new Promise((r) => setTimeout(r, RETRY_MS));
          continue;
        }
        for (const cmd of commands) {
          const outcome = await executeCommand(cmd, deps);
          await reportCommandOutcome(serverUrl, cmd.id, outcome);
        }
      }
    } finally {
      loopRunning = false;
    }
  })();
}

async function executeCommand(cmd, { findTabIdByHostname, getAttachedHostnames, attachOpenTabs, getAttachedApps }) {
  try {
    switch (cmd.command) {
      case "flush":
        await logSender.flush();
        return { status: "done", result: { flushed: true } };

      case "status":
        return { status: "done", result: { attachedHostnames: getAttachedHostnames() } };

      case "attach": {
        if (!cmd.app_name) return { status: "failed", result: { error: "app_name is required" } };
        // No separate allowlist re-check needed here: findTabIdByHostname
        // only ever returns tabs that background.js already validated as
        // allowlisted at navigation time (see background.js's tabAppNames).
        const tabId = findTabIdByHostname(cmd.app_name);
        if (tabId === undefined) {
          return {
            status: "failed",
            result: { error: `no open, allowlisted tab found for app_name '${cmd.app_name}'` },
          };
        }
        await attachDebugger(tabId);
        return { status: "done", result: { tabId, attached: isAttached(tabId) } };
      }

      case "detach": {
        const tabId = findTabIdByHostname(cmd.app_name);
        if (tabId === undefined) {
          return { status: "failed", result: { error: `no open tab found for ${cmd.app_name}` } };
        }
        await detachDebugger(tabId);
        return { status: "done", result: { tabId, attached: false } };
      }

      case "localstorage_snapshot": {
        const tabId = findTabIdByHostname(cmd.app_name);
        if (tabId === undefined || !isAttached(tabId)) {
          return {
            status: "failed",
            result: {
              error:
                "that tab isn't open and attached — make sure the domain is allowlisted and the page is loaded",
            },
          };
        }
        const snapshot = await captureLocalStorageSnapshot(tabId);
        return { status: "done", result: { local_storage: snapshot } };
      }

      case "capture_tab":
        return captureForAgent(cmd.payload || {});

      // The agent records a session itself (see page-actions.js for driving the page).
      case "rec_start": {
        await attachOpenTabs();
        const res = await startRecording(getAttachedApps());
        return { status: "done", result: { recording: true, id: res.state.id, sites: res.state.sites } };
      }
      case "rec_marker":
        return (await addMarker(cmd.payload?.note || "")).ok
          ? { status: "done", result: { marked: true } }
          : { status: "failed", result: { error: "Not recording." } };
      case "rec_stop": {
        if (!isRecording()) return { status: "failed", result: { error: "Not recording." } };
        const res = await stopRecording();
        return { status: res.ok ? "done" : "failed", result: res.last };
      }

      case "page_action":
        return runPageAction(cmd.payload || {});

      default: {
        // The agent's newer browser tools live in lib/agent-tools/.
        const handler = agentCommands[cmd.command];
        if (handler) return await handler(cmd.payload || {});
        return { status: "failed", result: { error: `unknown command '${cmd.command}'` } };
      }
    }
  } catch (err) {
    return { status: "failed", result: { error: String(err) } };
  }
}

/**
 * capture_tab from the agent. Only tabs on allowed sites (localhost by default)
 * can be captured — the agent can't screenshot your bank — and the user's
 * active tab is never changed.
 */
async function captureForAgent({ url_contains, max_width }) {
  const tab = await pickAllowedTab(url_contains);
  if (!tab) {
    return { status: "failed", result: { error: `No open tab on an allowed site${url_contains ? ` matching "${url_contains}"` : ""}. The user can add sites in the extension's settings (localhost is allowed by default).` } };
  }
  try {
    await attachDebugger(tab.id);
    const shot = await captureViaDebugger(tab.id, { maxWidth: Number(max_width) || 1280 });
    return { status: "done", result: { ...shot, url: tab.url, title: tab.title } };
  } catch (err) {
    return { status: "failed", result: { error: `Couldn't capture the tab: ${err?.message || err}` } };
  }
}

async function reportCommandOutcome(serverUrl, id, { status, result }) {
  try {
    await fetch(`${serverUrl}/commands/${id}`, {
      method: "PATCH",
      headers: await logSender.getRequestHeaders(),
      body: JSON.stringify({ status, result }),
    });
  } catch (err) {
    console.warn("[central-log-capture] couldn't report command outcome:", err);
  }
}
