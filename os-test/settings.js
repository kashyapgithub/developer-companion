// ---------------------------------------------------------------------------
// settings.js — Cross-OS Test setup form
//
// Ported from the standalone tester's options page. Handles the one-time
// GitHub credentials form. Once saved, the token/owner/repo live in
// chrome.storage.local and lib/os-test.js reads them for every future API
// call — the user never has to re-enter them. If the PAT field is left
// empty, the token saved for the GitHub Dashboard feature (settings.
// githubToken) is reused; the dispatch and poll code in lib/os-test.js
// applies the same fallback.
// ---------------------------------------------------------------------------

const form = document.getElementById("setup-form");
const patInput = document.getElementById("pat-input");
const ownerInput = document.getElementById("owner-input");
const repoInput = document.getElementById("repo-input");
const toggleTokenBtn = document.getElementById("toggle-token-btn");
const saveBtn = document.getElementById("save-btn");
const statusMessage = document.getElementById("status-message");

const setStatus = (msg, tone = "") => {
  if (!statusMessage) return;
  statusMessage.textContent = msg;
  statusMessage.dataset.tone = tone;
};

/**
 * Returns the most useful token to prefill: the tester's own token when
 * one is saved, otherwise the GitHub Dashboard token. May be empty.
 */
const resolveInitialToken = async () => {
  const saved = await chrome.storage.local.get(["githubPat", "settings"]);
  if (saved.githubPat) return { token: saved.githubPat, reused: false };
  const dashboardToken = saved?.settings?.githubToken || "";
  return { token: dashboardToken, reused: Boolean(dashboardToken) };
};

/**
 * Pre-fill the form so revisiting the settings page doesn't look like a
 * blank slate. If we show the Dashboard token, the PAT field still starts
 * empty — the fallback applies automatically at dispatch time, and pasting
 * it into a visible field would encourage accidental sharing.
 */
const restoreSavedValues = async () => {
  const saved = await chrome.storage.local.get(["githubPat", "repoOwner", "repoName", "settings"]);
  const savedPat = saved.githubPat || "";
  const dashboardToken = saved?.settings?.githubToken || "";

  if (savedPat) patInput.value = savedPat;
  else if (dashboardToken) {
    patInput.placeholder = `Reusing GitHub Dashboard token (${dashboardToken.slice(0, 7)}…) — paste here to override`;
  }

  if (saved.repoOwner) ownerInput.value = saved.repoOwner;
  if (saved.repoName) repoInput.value = saved.repoName;
};

/**
 * Toggle visibility of PAT input.
 */
toggleTokenBtn?.addEventListener("click", () => {
  if (patInput.type === "password") {
    patInput.type = "text";
    toggleTokenBtn.textContent = "Hide";
  } else {
    patInput.type = "password";
    toggleTokenBtn.textContent = "Show";
  }
});

/**
 * Validates the credentials against GitHub API before saving. The token
 * saved here (or the Dashboard one it falls back to) must at minimum be
 * able to read private repositories and dispatch workflow runs.
 * @param {SubmitEvent} event
 */
const handleSubmit = async (event) => {
  event.preventDefault();

  const pat = patInput.value.trim();
  const repoOwner = ownerInput.value.trim();
  const repoName = repoInput.value.trim();

  if (!repoOwner || !repoName) {
    setStatus("Please fill in the repo owner and repo name.", "error");
    return;
  }

  if (!pat) {
    const dashboardToken = (await chrome.storage.local.get("settings"))?.settings?.githubToken || "";
    if (!dashboardToken) {
      setStatus("No token pasted and the GitHub Dashboard has no saved token either. Create one in Step 1.", "error");
      return;
    }
  }

  saveBtn.disabled = true;
  setStatus("Testing connection to GitHub repository…", "loading");

  try {
    const res = await fetch(`https://api.github.com/repos/${repoOwner}/${repoName}`, {
      headers: pat
        ? {
            Authorization: `Bearer ${pat}`,
            Accept: "application/vnd.github+json",
          }
        : {},
    });

    if (res.ok) {
      if (pat) await chrome.storage.local.set({ githubPat: pat });
      await chrome.storage.local.set({ repoOwner, repoName });
      setStatus(`✓ Verified & Connected! Repository "${repoOwner}/${repoName}" is ready. You can close this tab and start testing pages.`, "success");
    } else if (res.status === 401) {
      setStatus("❌ 401 Unauthorized: GitHub rejected this token. Please check that you copied the token completely with no extra characters.", "error");
    } else if (res.status === 404) {
      setStatus(`❌ 404 Not Found: Repository "${repoOwner}/${repoName}" could not be found. Check for typos in your username or repo name, and ensure the token has access (private repos need a token).`, "error");
    } else if (res.status === 403) {
      setStatus("❌ 403 Forbidden: Permission denied or rate limited. Ensure token has 'repo' or 'Actions: Read & write' and 'Contents: Read & write'.", "error");
    } else {
      setStatus(`❌ GitHub API responded with status ${res.status}.`, "error");
    }
  } catch (err) {
    // If user is offline, save anyway
    if (pat) await chrome.storage.local.set({ githubPat: pat });
    await chrome.storage.local.set({ repoOwner, repoName });
    setStatus(`⚠️ Saved locally, but could not reach GitHub network to verify: ${err.message}`, "error");
  } finally {
    saveBtn.disabled = false;
  }
};

form.addEventListener("submit", handleSubmit);
restoreSavedValues();
