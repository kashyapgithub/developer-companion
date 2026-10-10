/**
 * companion-bridge.js
 * --------------------------------------------------------------------------
 * Integrates the Developer Companion features into the UI Sketch Canvas:
 *   1. GitHub Dashboard integration (modal drawer + pop-out window)
 *   2. "Send browser logs to agent" button (one-click push to server)
 *   3. Live Logs Viewer drawer with filtering and search
 *   4. Toast notifications & badge status updates
 * -------------------------------------------------------------------------- */

export function initCompanionBridge() {
  const githubBtn = document.getElementById("github-dashboard-btn");
  const sendLogsBtn = document.getElementById("send-logs-btn");
  const viewLogsBtn = document.getElementById("view-logs-btn");
  const logsBadge = document.getElementById("logs-badge");

  const githubModal = document.getElementById("github-modal");
  const githubCloseBtn = document.getElementById("github-close-btn");
  const githubPopoutBtn = document.getElementById("github-popout-btn");

  const logsModal = document.getElementById("logs-modal");
  const logsCloseBtn = document.getElementById("logs-close-btn");
  const logsPopoutBtn = document.getElementById("logs-popout-btn");
  const logsClearBtn = document.getElementById("logs-clear-btn");
  const logsFlushAgentBtn = document.getElementById("logs-flush-agent-btn");
  const logsListView = document.getElementById("logs-list-view");
  const logsCountLabel = document.getElementById("logs-count-label");
  const logsSearchInput = document.getElementById("logs-search");

  const tutorialBtn = document.getElementById("agent-tutorial-btn");
  const tutorialModal = document.getElementById("tutorial-modal");
  const tutorialCloseBtn = document.getElementById("tutorial-close-btn");
  const tutTestBtn = document.getElementById("tut-test-btn");
  const tutStatusDot = document.getElementById("tut-status-dot");
  const tutStatusText = document.getElementById("tut-status-text");

  const toastEl = document.getElementById("companion-toast");

  let currentLogs = [];

  // --- Toast Notification -------------------------------------------------
  function showToast(message, type = "info", duration = 3500) {
    if (!toastEl) return;
    toastEl.textContent = message;
    toastEl.className = `companion-toast show ${type}`;
    clearTimeout(toastEl._timer);
    toastEl._timer = setTimeout(() => {
      toastEl.className = "companion-toast hidden";
    }, duration);
  }

  // --- GitHub Modal -------------------------------------------------------
  function openGithubModal() {
    githubModal?.classList.remove("hidden");
    document.body.style.overflow = "hidden";
  }

  function closeGithubModal() {
    githubModal?.classList.add("hidden");
    document.body.style.overflow = "";
  }

  githubBtn?.addEventListener("click", () => {
    openGithubModal();
  });

  githubCloseBtn?.addEventListener("click", closeGithubModal);
  githubModal?.querySelector(".companion-modal-backdrop")?.addEventListener("click", closeGithubModal);

  githubPopoutBtn?.addEventListener("click", () => {
    closeGithubModal();
    chrome.runtime?.sendMessage?.({ type: "OPEN_GITHUB_DASHBOARD" });
  });

  // --- Send Logs to Agent Button ------------------------------------------
  async function sendLogsToAgent() {
    if (!chrome.runtime?.sendMessage) {
      showToast("Chrome extension runtime unavailable", "error");
      return;
    }

    sendLogsBtn?.classList.add("loading");
    try {
      const res = await chrome.runtime.sendMessage({ type: "SEND_LOGS_TO_AGENT" });
      if (res?.ok) {
        const count = res.count || 0;
        showToast(`Sent ${count} log${count === 1 ? "" : "s"} to Agent Server`, "success");
      } else {
        showToast(res?.error ? `Failed: ${res.error}` : "Agent server unreachable (is it running on port 5959?)", "error");
      }
    } catch (err) {
      showToast(`Error sending logs: ${err.message}`, "error");
    } finally {
      sendLogsBtn?.classList.remove("loading");
      updateStatusBadge();
    }
  }

  sendLogsBtn?.addEventListener("click", sendLogsToAgent);

  // --- Logs Viewer Modal --------------------------------------------------
  function openLogsModal() {
    logsModal?.classList.remove("hidden");
    document.body.style.overflow = "hidden";
    refreshLogsView();
  }

  function closeLogsModal() {
    logsModal?.classList.add("hidden");
    document.body.style.overflow = "";
  }

  viewLogsBtn?.addEventListener("click", openLogsModal);
  logsCloseBtn?.addEventListener("click", closeLogsModal);
  logsModal?.querySelector(".companion-modal-backdrop")?.addEventListener("click", closeLogsModal);

  logsPopoutBtn?.addEventListener("click", () => {
    closeLogsModal();
    chrome.runtime?.sendMessage?.({ type: "OPEN_LOGS_VIEWER" });
  });

  logsClearBtn?.addEventListener("click", async () => {
    await chrome.runtime?.sendMessage?.({ type: "CLEAR_LOGS" });
    showToast("Cleared captured logs", "info");
    refreshLogsView();
  });

  logsFlushAgentBtn?.addEventListener("click", async () => {
    await sendLogsToAgent();
    refreshLogsView();
  });

  async function refreshLogsView() {
    if (!chrome.runtime?.sendMessage) return;
    try {
      const res = await chrome.runtime.sendMessage({ type: "GET_ALL_LOGS" });
      currentLogs = res?.rows || [];
      renderLogsList();
    } catch {
      currentLogs = [];
      renderLogsList();
    }
  }

  function renderLogsList() {
    if (!logsListView) return;
    const query = (logsSearchInput?.value || "").toLowerCase().trim();
    const showErrors = document.getElementById("filter-errors")?.checked ?? true;
    const showWarns = document.getElementById("filter-warns")?.checked ?? true;
    const showInfo = document.getElementById("filter-info")?.checked ?? true;
    const showNetwork = document.getElementById("filter-network")?.checked ?? true;

    const filtered = currentLogs.filter((r) => {
      const lvl = (r.level || "info").toLowerCase();
      const isNet = (r.tags || []).includes("network") || r.type?.includes("network");

      if (isNet && !showNetwork) return false;
      if (!isNet && lvl === "error" && !showErrors) return false;
      if (!isNet && lvl === "warn" && !showWarns) return false;
      if (!isNet && (lvl === "info" || lvl === "debug" || lvl === "log") && !showInfo) return false;

      if (query) {
        const text = `${r.app_name || ""} ${r.message || ""} ${r.error_type || ""} ${JSON.stringify(r.context || {})}`.toLowerCase();
        return text.includes(query);
      }
      return true;
    });

    if (logsCountLabel) {
      logsCountLabel.textContent = `${filtered.length} of ${currentLogs.length} logs`;
    }

    if (filtered.length === 0) {
      logsListView.innerHTML = `
        <div class="logs-empty-state">
          <p>No captured logs match your filter.</p>
          <span class="hint">Tabs running on localhost or allowlisted domains automatically capture console output, errors, and network failures.</span>
        </div>
      `;
      return;
    }

    logsListView.innerHTML = filtered.map((r) => {
      const lvl = (r.level || "info").toLowerCase();
      const timeStr = r.created_at ? new Date(r.created_at).toLocaleTimeString() : "";
      const app = r.app_name || "browser";
      const msg = escapeHtml(r.message || "");
      const stack = r.stack_trace ? `<pre class="log-stack">${escapeHtml(r.stack_trace)}</pre>` : "";
      const contextStr = r.context && Object.keys(r.context).length > 0 ? `<div class="log-context">${escapeHtml(JSON.stringify(r.context))}</div>` : "";

      return `
        <div class="log-row level-${lvl}">
          <div class="log-meta">
            <span class="log-time">${timeStr}</span>
            <span class="log-app">${escapeHtml(app)}</span>
            <span class="log-level-tag ${lvl}">${lvl.toUpperCase()}</span>
          </div>
          <div class="log-body">
            <div class="log-msg">${msg}</div>
            ${contextStr}
            ${stack}
          </div>
        </div>
      `;
    }).join("");
  }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  logsSearchInput?.addEventListener("input", renderLogsList);
  document.querySelectorAll(".logs-filter-pills input").forEach((cb) => {
    cb.addEventListener("change", renderLogsList);
  });

  // --- Agent Connection Tutorial Modal ------------------------------------
  async function checkBackendStatus() {
    if (!tutStatusText || !tutStatusDot) return false;
    tutStatusDot.className = "status-indicator pending";
    tutStatusText.textContent = "Checking local backend connection (port 5959)...";
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 2000);
      const res = await fetch("http://127.0.0.1:5959/api/status", {
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      if (res.ok) {
        tutStatusDot.className = "status-indicator live";
        tutStatusText.textContent = "Backend Status: Connected on port 5959 (Agent Bridge is live)";
        return true;
      }
    } catch {}
    tutStatusDot.className = "status-indicator error";
    tutStatusText.textContent = "Backend Status: Server not detected on port 5959. Run 'npm start' in server/";
    return false;
  }

  function openTutorialModal() {
    tutorialModal?.classList.remove("hidden");
    document.body.style.overflow = "hidden";
    checkBackendStatus();
  }

  function closeTutorialModal() {
    tutorialModal?.classList.add("hidden");
    document.body.style.overflow = "";
  }

  tutorialBtn?.addEventListener("click", openTutorialModal);
  tutorialCloseBtn?.addEventListener("click", closeTutorialModal);
  tutorialModal?.querySelector(".companion-modal-backdrop")?.addEventListener("click", closeTutorialModal);

  tutTestBtn?.addEventListener("click", () => {
    checkBackendStatus().then((ok) => {
      showToast(
        ok ? "Backend server is running on port 5959" : "Backend server not responding on port 5959",
        ok ? "success" : "error"
      );
    });
  });

  // Agent tabs switching
  tutorialModal?.querySelectorAll(".agent-tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      const targetId = `pane-${tab.dataset.tab}`;
      tutorialModal.querySelectorAll(".agent-tab").forEach((t) => t.classList.remove("active"));
      tutorialModal.querySelectorAll(".agent-tab-pane").forEach((p) => p.classList.remove("active"));
      tab.classList.add("active");
      const targetPane = document.getElementById(targetId);
      if (targetPane) targetPane.classList.add("active");
    });
  });

  // Copy buttons
  tutorialModal?.querySelectorAll(".copy-snippet-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      let text = btn.dataset.copy;
      if (!text) {
        const codeEl = btn.closest(".code-snippet-box")?.querySelector("code");
        text = codeEl?.textContent?.trim() || "";
      }
      if (text) {
        try {
          await navigator.clipboard.writeText(text);
          const orig = btn.textContent;
          btn.textContent = "Copied!";
          btn.classList.add("copied");
          setTimeout(() => {
            btn.textContent = orig;
            btn.classList.remove("copied");
          }, 2000);
        } catch {
          showToast("Failed to copy to clipboard", "error");
        }
      }
    });
  });

  // --- Badge & Status Updater ---------------------------------------------
  async function updateStatusBadge() {
    if (!chrome.runtime?.sendMessage) return;
    try {
      const status = await chrome.runtime.sendMessage({ type: "GET_STATUS" });
      const total = status?.totalBufferedLogs || 0;
      if (logsBadge) {
        if (total > 0) {
          logsBadge.textContent = total > 99 ? "99+" : String(total);
          logsBadge.classList.remove("hidden");
        } else {
          logsBadge.classList.add("hidden");
        }
      }
    } catch {}
  }

  // Poll status periodically
  setInterval(updateStatusBadge, 4000);
  updateStatusBadge();

  // Escape key closes modals
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      closeGithubModal();
      closeLogsModal();
      closeTutorialModal();
    }
  });
}

// Auto-run when DOM ready
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initCompanionBridge);
} else {
  initCompanionBridge();
}
