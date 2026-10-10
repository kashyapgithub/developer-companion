// overlay/modules/render/commitsPanel.js
//
// Renders the Recent Commits popup panel (macOS Sheet Modal)
// showing live commit activity across recently edited repositories.

import { escapeHtml, timeAgo, formatDate, getLanguageColor } from '../format.js';
import { fetchRecentCommitsAcrossRepos, fetchRepoCommits } from '../github-api.js';

export function renderCommitsPanel(container, { token, repos = [], onOpenRepo } = {}) {
  let allRepos = repos;
  let currentToken = token;
  let currentFilterRepoId = 'all'; // 'all' or numeric repo id
  let searchQuery = '';
  let isLoading = false;
  let hasLoaded = false;
  let cachedCommits = []; // all recent commits across repos
  const commitsByRepoId = new Map(); // cached per repo

  container.innerHTML = `
    <div class="modal-backdrop commits-modal-backdrop" id="commits-backdrop" data-role="commits-backdrop">
      <div class="modal commits-modal" role="dialog" aria-modal="true" aria-labelledby="commits-heading">
        <button type="button" class="modal__close" id="btn-close-commits" aria-label="Close commits panel" title="Close (Esc)">✕</button>

        <div class="modal__header commits-modal__header">
          <div class="commits-title-row">
            <svg class="commits-header-icon" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
              <path d="M11.93 8.5a4.002 4.002 0 0 1-7.86 0H.75a.75.75 0 0 1 0-1.5h3.32a4.002 4.002 0 0 1 7.86 0h3.32a.75.75 0 0 1 0 1.5h-3.32Zm-1.43-.75a2.5 2.5 0 1 0-5 0 2.5 2.5 0 0 0 5 0Z"/>
            </svg>
            <div>
              <h2 id="commits-heading">Recent Commits</h2>
              <p class="modal__subtitle commits-subtitle">
                Latest commits across your most recently edited repositories.
              </p>
            </div>
          </div>
        </div>

        <div class="commits-toolbar">
          <div class="commits-toolbar__left">
            <!-- Repository Scope Filter Dropdown -->
            <div class="commits-select-wrap" title="Filter by repository">
              <select id="commits-repo-filter" aria-label="Filter commits by repository">
                <option value="all">All Recent Repositories</option>
              </select>
              <svg class="select-chevron" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
                <path d="m4.427 6.427 3.396 3.396a.25.25 0 0 0 .354 0l3.396-3.396A.25.25 0 0 0 11.396 6H4.604a.25.25 0 0 0-.177.427Z"/>
              </svg>
            </div>

            <!-- Live Commit Search Bar -->
            <div class="commits-search-wrap">
              <svg class="commits-search-icon" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
                <path d="M10.68 11.74a6 6 0 0 1-7.922-8.982 6 6 0 0 1 8.982 7.922l3.04 3.04a.749.749 0 0 1-.326 1.275.749.749 0 0 1-.734-.215ZM11.5 7a4.499 4.499 0 1 0-8.997 0A4.499 4.499 0 0 0 11.5 7Z"/>
              </svg>
              <input
                type="search"
                id="commits-search-input"
                placeholder="Search commit messages, authors, SHAs…"
                autocomplete="off"
                spellcheck="false"
              />
              <button type="button" class="commits-search-clear" id="commits-search-clear" title="Clear search" aria-label="Clear search" hidden>✕</button>
            </div>
          </div>

          <div class="commits-toolbar__right">
            <button type="button" class="btn-commits-refresh" id="btn-refresh-commits" title="Reload commits from GitHub">
              <svg class="icon-refresh" viewBox="0 0 16 16" fill="currentColor">
                <path d="M1.705 8.005a.75.75 0 0 1 .834.656 5.5 5.5 0 0 0 9.592 2.97l-1.204-1.204a.25.25 0 0 1 .177-.427h3.646a.25.25 0 0 1 .25.25v3.646a.25.25 0 0 1-.427.177l-1.38-1.38A7.002 7.002 0 0 1 1.05 8.84a.75.75 0 0 1 .656-.834ZM8 2.5a5.487 5.487 0 0 0-4.131 1.869l1.204 1.204A.25.25 0 0 1 4.896 6H1.25A.25.25 0 0 1 1 5.75V2.104a.25.25 0 0 1 .427-.177l1.38 1.38A7.002 7.002 0 0 1 14.95 7.16a.75.75 0 0 1-1.49.178A5.5 5.5 0 0 0 8 2.5Z"/>
              </svg>
              <span>Refresh</span>
            </button>
          </div>
        </div>

        <div class="commits-meta-bar">
          <span class="commits-meta-badge" id="commits-meta-count">Loading…</span>
          <span class="commits-meta-scope" id="commits-meta-scope"></span>
        </div>

        <!-- Scrollable Commits List Container -->
        <div class="commits-list-scroll" id="commits-list-scroll" role="region" aria-label="Commit entries">
          <div class="commits-list" id="commits-list"></div>
        </div>
      </div>
    </div>
  `;

  const backdrop = container.querySelector('#commits-backdrop');
  const closeBtn = container.querySelector('#btn-close-commits');
  const repoFilterSelect = container.querySelector('#commits-repo-filter');
  const searchInput = container.querySelector('#commits-search-input');
  const searchClear = container.querySelector('#commits-search-clear');
  const refreshBtn = container.querySelector('#btn-refresh-commits');
  const metaCount = container.querySelector('#commits-meta-count');
  const metaScope = container.querySelector('#commits-meta-scope');
  const listEl = container.querySelector('#commits-list');

  function getSortedRecentRepos(limit = 12) {
    return [...allRepos]
      .sort((a, b) => new Date(b.pushed_at || b.updatedAt).getTime() - new Date(a.pushed_at || a.updatedAt).getTime())
      .slice(0, limit);
  }

  function populateRepoFilterOptions(selectedRepoId = currentFilterRepoId) {
    const recentRepos = getSortedRecentRepos();
    repoFilterSelect.innerHTML = `
      <option value="all" ${selectedRepoId === 'all' ? 'selected' : ''}>
        All Recent Repositories (${recentRepos.length})
      </option>
      ${recentRepos
        .map(
          (r) => `
            <option value="${r.id}" ${String(selectedRepoId) === String(r.id) ? 'selected' : ''}>
              ${escapeHtml(r.name)} (${r.language || 'Plain'})
            </option>
          `
        )
        .join('')}
    `;
  }

  async function loadCommits({ forceRefresh = false } = {}) {
    if (!currentToken) {
      renderError('GitHub access token is required to load commits.');
      return;
    }

    if (forceRefresh) {
      cachedCommits = [];
      commitsByRepoId.clear();
    }

    // Check if we need to load a single repo or all recent repos
    if (currentFilterRepoId !== 'all') {
      const repoId = Number(currentFilterRepoId);
      const repo = allRepos.find((r) => r.id === repoId);
      if (!repo) return;

      if (!commitsByRepoId.has(repoId)) {
        setLoadingState(true);
        try {
          const commits = await fetchRepoCommits(repo.owner, repo.name, currentToken, { perPage: 15 });
          const enriched = commits.map((c) => ({
            ...c,
            repoId: repo.id,
            repoName: repo.name,
            repoFullName: repo.fullName,
            repoUrl: repo.url,
            repoLanguage: repo.language,
            isPrivate: repo.isPrivate,
          }));
          commitsByRepoId.set(repoId, enriched);
        } catch (err) {
          renderError(err.message || 'Failed to fetch commits for this repository.');
          setLoadingState(false);
          return;
        }
        setLoadingState(false);
      }
    } else {
      if (cachedCommits.length === 0) {
        setLoadingState(true);
        try {
          const recentRepos = getSortedRecentRepos(10);
          cachedCommits = await fetchRecentCommitsAcrossRepos(recentRepos, currentToken, {
            maxRepos: 10,
            perRepo: 6,
          });
          // Cache into individual repos as well
          for (const c of cachedCommits) {
            if (!commitsByRepoId.has(c.repoId)) {
              commitsByRepoId.set(c.repoId, []);
            }
            commitsByRepoId.get(c.repoId).push(c);
          }
        } catch (err) {
          renderError(err.message || 'Failed to load recent commits across repositories.');
          setLoadingState(false);
          return;
        }
        setLoadingState(false);
      }
    }

    hasLoaded = true;
    renderCurrentCommits();
  }

  function setLoadingState(loading) {
    isLoading = loading;
    if (loading) {
      refreshBtn.classList.add('is-refreshing');
      metaCount.textContent = 'Fetching commits…';
      metaScope.textContent = '';
      renderSkeletons();
    } else {
      refreshBtn.classList.remove('is-refreshing');
    }
  }

  function renderSkeletons() {
    listEl.innerHTML = Array.from({ length: 5 })
      .map(
        () => `
          <div class="commit-card commit-card--skeleton">
            <div class="commit-card__meta">
              <div class="commit-skeleton-pill"></div>
              <div class="commit-skeleton-text" style="width: 80px;"></div>
            </div>
            <div class="commit-skeleton-text" style="width: 85%; height: 18px; margin: 8px 0;"></div>
            <div class="commit-skeleton-text" style="width: 45%; height: 14px;"></div>
          </div>
        `
      )
      .join('');
  }

  function renderError(message) {
    listEl.innerHTML = `
      <div class="commits-empty-state">
        <svg class="commits-empty-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <circle cx="12" cy="12" r="10"/>
          <line x1="12" y1="8" x2="12" y2="12"/>
          <line x1="12" y1="16" x2="12.01" y2="16"/>
        </svg>
        <p class="commits-empty-title">Unable to load commits</p>
        <p class="commits-empty-desc">${escapeHtml(message)}</p>
        <button type="button" class="btn-primary btn-retry-commits" id="btn-retry-commits-action">Try Again</button>
      </div>
    `;
    listEl.querySelector('#btn-retry-commits-action')?.addEventListener('click', () => {
      loadCommits({ forceRefresh: true });
    });
  }

  function renderCurrentCommits() {
    let commits = [];
    if (currentFilterRepoId === 'all') {
      commits = cachedCommits;
    } else {
      commits = commitsByRepoId.get(Number(currentFilterRepoId)) || [];
    }

    const query = searchQuery.trim().toLowerCase();
    if (query) {
      commits = commits.filter((c) => {
        return (
          (c.headline || '').toLowerCase().includes(query) ||
          (c.body || '').toLowerCase().includes(query) ||
          (c.authorName || '').toLowerCase().includes(query) ||
          (c.authorLogin || '').toLowerCase().includes(query) ||
          (c.repoName || '').toLowerCase().includes(query) ||
          (c.shortSha || '').toLowerCase().includes(query)
        );
      });
    }

    // Update status bar indicators
    const scopeLabel =
      currentFilterRepoId === 'all'
        ? `Across ${new Set(commits.map((c) => c.repoId)).size} recently edited repos`
        : `Repository: ${allRepos.find((r) => r.id === Number(currentFilterRepoId))?.name || 'Selected'}`;

    metaCount.textContent = `${commits.length} commit${commits.length === 1 ? '' : 's'}`;
    metaScope.textContent = scopeLabel;

    if (commits.length === 0) {
      listEl.innerHTML = `
        <div class="commits-empty-state">
          <svg class="commits-empty-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <circle cx="12" cy="12" r="10"/>
            <path d="m4.93 4.93 14.14 14.14"/>
          </svg>
          <p class="commits-empty-title">No commits found</p>
          <p class="commits-empty-desc">${
            query
              ? `No commits matched "${escapeHtml(searchQuery)}". Try another search keyword.`
              : 'No commits could be found for the selected repository.'
          }</p>
        </div>
      `;
      return;
    }

    listEl.innerHTML = commits.map((commit) => renderCommitCardHtml(commit)).join('');

    // Wire up clicks on repo pills inside commit cards to switch filter
    listEl.querySelectorAll('.commit-repo-pill').forEach((pill) => {
      pill.addEventListener('click', (e) => {
        e.stopPropagation();
        const repoId = pill.dataset.repoId;
        if (repoId) {
          setRepoFilter(repoId);
        }
      });
    });
  }

  function renderCommitCardHtml(commit) {
    const langColor = getLanguageColor(commit.repoLanguage);
    const hasBody = Boolean(commit.body);

    return `
      <article class="commit-card" data-sha="${commit.sha}">
        <div class="commit-card__header">
          <div class="commit-card__header-left">
            <!-- REPOSITORY PILL: Explicitly identifies which repo this commit belongs to -->
            <button
              type="button"
              class="commit-repo-pill"
              data-repo-id="${commit.repoId}"
              title="Isolate commits for ${escapeHtml(commit.repoName)}"
            >
              <span class="commit-repo-pill__dot" style="background-color: ${langColor};"></span>
              <span class="commit-repo-pill__name">${escapeHtml(commit.repoName)}</span>
              ${commit.isPrivate ? '<svg class="commit-repo-pill__lock-icon" viewBox="0 0 16 16" fill="currentColor" title="Private repo" aria-label="Private repo"><path d="M4 4a4 4 0 0 1 8 0v2h.25c.966 0 1.75.784 1.75 1.75v5.5A1.75 1.75 0 0 1 12.25 15h-8.5A1.75 1.75 0 0 1 2 13.25v-5.5C2 6.784 2.784 6 3.75 6H4V4Zm1.5 2h5V4a2.5 2.5 0 0 0-5 0v2Z"/></svg>' : ''}
            </button>

            <!-- Short SHA pill linking directly to commit on GitHub -->
            <a
              href="${commit.url}"
              target="_blank"
              rel="noopener"
              class="commit-sha-pill"
              title="View commit ${commit.shortSha} on GitHub"
            >
              <svg class="commit-sha-icon" viewBox="0 0 16 16" fill="currentColor">
                <path d="M11.93 8.5a4.002 4.002 0 0 1-7.86 0H.75a.75.75 0 0 1 0-1.5h3.32a4.002 4.002 0 0 1 7.86 0h3.32a.75.75 0 0 1 0 1.5h-3.32Zm-1.43-.75a2.5 2.5 0 1 0-5 0 2.5 2.5 0 0 0 5 0Z"/>
              </svg>
              <span>${commit.shortSha}</span>
            </a>

            ${
              commit.verified
                ? `<span class="commit-verified-badge" title="Verified commit signature">✓ Verified</span>`
                : ''
            }
          </div>

          <div class="commit-card__header-right">
            <time class="commit-time" datetime="${commit.date}" title="${formatDate(commit.date)}">
              ${timeAgo(commit.date)}
            </time>
          </div>
        </div>

        <div class="commit-card__body">
          <p class="commit-headline">
            <a href="${commit.url}" target="_blank" rel="noopener" class="commit-headline-link">
              ${escapeHtml(commit.headline)}
            </a>
          </p>
          ${
            hasBody
              ? `
                <div class="commit-extended-desc">
                  <pre class="commit-body-text">${escapeHtml(commit.body)}</pre>
                </div>
              `
              : ''
          }
        </div>

        <div class="commit-card__footer">
          <div class="commit-author-group">
            ${
              commit.authorAvatar
                ? `<img class="commit-avatar" src="${commit.authorAvatar}" alt="" loading="lazy" />`
                : `<div class="commit-avatar-fallback">${escapeHtml((commit.authorName || 'U').charAt(0).toUpperCase())}</div>`
            }
            <span class="commit-author-name">${escapeHtml(commit.authorName)}</span>
            ${
              commit.authorLogin && commit.authorLogin !== commit.authorName
                ? `<span class="commit-author-login">@${escapeHtml(commit.authorLogin)}</span>`
                : ''
            }
          </div>

          <div class="commit-actions">
            <a href="${commit.url}" target="_blank" rel="noopener" class="commit-ext-btn" title="View commit diff on GitHub">
              <span>View Diff</span>
              <svg viewBox="0 0 16 16" fill="currentColor">
                <path d="M3.75 2h3.5a.75.75 0 0 1 0 1.5h-3.5a.25.25 0 0 0-.25.25v8.5c0 .138.112.25.25.25h8.5a.25.25 0 0 0 .25-.25v-3.5a.75.75 0 0 1 1.5 0v3.5A1.75 1.75 0 0 1 12.25 14h-8.5A1.75 1.75 0 0 1 2 12.25v-8.5C2 2.784 2.784 2 3.75 2Zm6.75.75a.75.75 0 0 1 .75-.75h3.5a.75.75 0 0 1 .75.75v3.5a.75.75 0 0 1-1.5 0V3.56l-4.22 4.22a.749.749 0 0 1-1.275-.326.749.749 0 0 1 .215-.734L13.44 2.5H10.5a.75.75 0 0 1-.75-.75Z"/>
              </svg>
            </a>
          </div>
        </div>
      </article>
    `;
  }

  function setRepoFilter(repoId) {
    currentFilterRepoId = String(repoId);
    repoFilterSelect.value = String(repoId);
    loadCommits();
  }

  // Event Listeners
  closeBtn.addEventListener('click', close);
  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop) close();
  });

  repoFilterSelect.addEventListener('change', () => {
    currentFilterRepoId = repoFilterSelect.value;
    loadCommits();
  });

  searchInput.addEventListener('input', () => {
    searchQuery = searchInput.value;
    searchClear.hidden = !searchQuery;
    renderCurrentCommits();
  });

  searchClear.addEventListener('click', () => {
    searchInput.value = '';
    searchQuery = '';
    searchClear.hidden = true;
    searchInput.focus();
    renderCurrentCommits();
  });

  refreshBtn.addEventListener('click', () => {
    loadCommits({ forceRefresh: true });
  });

  function open({ repoId = null } = {}) {
    populateRepoFilterOptions(repoId || 'all');
    currentFilterRepoId = repoId ? String(repoId) : 'all';
    repoFilterSelect.value = currentFilterRepoId;
    backdrop.classList.add('modal-backdrop--visible');
    loadCommits();
    setTimeout(() => searchInput.focus(), 150);
  }

  function close() {
    backdrop.classList.remove('modal-backdrop--visible');
  }

  function isOpen() {
    return backdrop.classList.contains('modal-backdrop--visible');
  }

  function setRepos(newRepos) {
    allRepos = newRepos;
    populateRepoFilterOptions(currentFilterRepoId);
  }

  function setToken(newToken) {
    currentToken = newToken;
  }

  return {
    open,
    close,
    isOpen,
    setRepos,
    setToken,
    refresh: () => loadCommits({ forceRefresh: true }),
  };
}
