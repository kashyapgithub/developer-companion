/**
 * cross-os.js
 * --------------------------------------------------------------------------
 * GitHub-side logic for the Cross-OS Website Tester MCP tool
 * (get_cross_os_results). Extracted from server.js so the lookup flow can
 * be tested without live network calls — callers inject their own `fetch`.
 *
 * Flow: list run folders on the target repo's `results` branch
 * (results/run-<timestamp>/), pick the newest (or the requested one), then
 * list its screenshots. Each screenshot is named <os>-<browser>.png by the
 * GitHub Actions workflow, matching what the extension polls on port 5959.
 * -------------------------------------------------------------------------- */

/**
 * Human-readable display labels for each os-browser combo. Keys mirror the
 * `${OS_LABEL}-${browser}.png` filenames the workflow commits and the
 * extension's ALL_TEST_COMBINATIONS in the service worker.
 */
export const COMBO_LABELS = {
  "windows-chromium": "Windows · Chrome",
  "windows-firefox": "Windows · Firefox",
  "windows-webkit": "Windows · WebKit",
  "macos-webkit": "macOS · Safari",
  "macos-chromium": "macOS · Chrome",
  "macos-firefox": "macOS · Firefox",
  "linux-chromium": "Linux · Chrome",
  "linux-firefox": "Linux · Firefox",
  "linux-webkit": "Linux · WebKit",
};

/**
 * Performs a GET against the GitHub Contents API. Resolves with
 * { ok, status, json, networkError } and never throws for HTTP problems.
 */
export async function githubApiRequest({ fetchImpl, path, token }) {
  const headers = { Accept: "application/vnd.github+json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  try {
    const res = await fetchImpl(`https://api.github.com${path}`, { headers });
    const json = await res.json().catch(() => null);
    return { ok: res.ok, status: res.status, json };
  } catch (err) {
    return { ok: false, status: 0, json: null, networkError: err?.message || String(err) };
  }
}

/**
 * Lists completed test runs on the results branch. Run folder names are
 * `run-<unix-ms>` created by the workflow, so numeric suffix ordering is
 * chronological. Returns { runs: string[] } or { error: string }.
 */
export async function listCrossOsRuns({ fetchImpl, token, owner, repo }) {
  const res = await githubApiRequest({
    fetchImpl,
    path: `/repos/${owner}/${repo}/contents/results?ref=results`,
    token,
  });

  if (!res.ok) {
    if (res.status === 404) {
      return {
        error:
          `No 'results' branch (or no 'results' folder on it) found in ${owner}/${repo}. ` +
          "Run a test from the extension first — the canvas toolbar 'Cross-OS Test' button → Run test.",
      };
    }
    if (res.status === 401 || res.status === 403) {
      return {
        error:
          `GitHub rejected the request (HTTP ${res.status}). For private repositories the configured ` +
          "githubToken must be present with Contents: read access.",
      };
    }
    return {
      error: `GitHub API error (HTTP ${res.status})${res.networkError ? `: ${res.networkError}` : ""}.`,
    };
  }

  const runs = Array.isArray(res.json)
    ? res.json
        .filter((entry) => entry.type === "dir" && /^run-/.test(entry.name))
        .map((entry) => entry.name)
        .sort((a, b) => Number(a.slice(4)) - Number(b.slice(4)))
    : [];

  return { runs };
}

/**
 * Lists the screenshots of one run. Returns
 * { result: { repository, run, started_at, runs_available, screenshots } }
 * or { error: string }.
 */
export async function fetchCrossOsResults({ fetchImpl, token, owner, repo, runTag, runs }) {
  const chosenRun = runTag && runs.includes(runTag) ? runTag : runs[runs.length - 1];

  const shotsRes = await githubApiRequest({
    fetchImpl,
    path: `/repos/${owner}/${repo}/contents/results/${chosenRun}?ref=results`,
    token,
  });

  if (!shotsRes.ok || !Array.isArray(shotsRes.json)) {
    return {
      error:
        `Run '${chosenRun}' exists but its folder could not be read (HTTP ${shotsRes.status}). ` +
        "Runners may still be uploading — retry in a minute.",
    };
  }

  const screenshots = shotsRes.json
    .filter((entry) => entry.type === "file" && entry.name.endsWith(".png"))
    .map((entry) => {
      const combo = entry.name.replace(/\.png$/, "");
      return {
        label: COMBO_LABELS[combo] || combo,
        file: entry.name,
        size_bytes: entry.size,
        download_url: entry.download_url,
        html_url: entry.html_url,
      };
    });

  const runTimestamp = Number(chosenRun.slice(4));
  return {
    result: {
      repository: `${owner}/${repo}`,
      run: chosenRun,
      started_at:
        Number.isFinite(runTimestamp) && runTimestamp > 0
          ? new Date(runTimestamp).toISOString()
          : undefined,
      runs_available: runs,
      screenshots,
    },
  };
}

/**
 * Full get_cross_os_results pipeline. Never throws — always resolves with
 * either { result } or { error } plus a machine-readable `status` field so
 * the MCP layer can turn it into plain text safely.
 */
export async function getCrossOsResults({ fetchImpl = globalThis.fetch, token, owner, repo, runTag }) {
  try {
    const { runs, error: runsError } = await listCrossOsRuns({ fetchImpl, token, owner, repo });
    if (runsError) return { status: "error", error: runsError };

    if (runs.length === 0) {
      return {
        status: "empty",
        error:
          `The results branch of ${owner}/${repo} has no completed test runs yet. ` +
          "Trigger one from the extension (Cross-OS Test → Run test).",
      };
    }

    const { result, error } = await fetchCrossOsResults({ fetchImpl, token, owner, repo, runTag, runs });
    if (error) return { status: "error", error };

    return { status: "ok", result };
  } catch (err) {
    return { status: "error", error: `Unexpected failure reading cross-OS results: ${err?.message || err}` };
  }
}
