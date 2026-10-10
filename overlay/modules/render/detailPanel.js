// overlay/modules/render/detailPanel.js
//
// Renders the full detail view for whichever repo is currently selected in the list:
// - Navigation tabs: [Overview], [README], [Files], [Issues & PRs]
// - Overview: AI summary, metadata grid, 1-click Clone & CLI capsule, multi-language breakdown,
//   12-week commit activity sparkline, tags manager, and folder assignment.
// - README: Full in-extension rendered documentation.
// - Files: Interactive directory explorer with breadcrumb navigation.
// - Issues & PRs: Recent open issues and pull requests preview.

import { escapeHtml, timeAgo, formatDate, formatNumber, getLanguageColor } from '../format.js';
import {
  fetchRepoParent,
  fetchRepoCommits,
  fetchFullReadme,
  fetchRepoContents,
  fetchRepoLanguages,
  fetchRepoIssuesAndPRs,
  fetchRepoCommitActivity,
} from '../github-api.js';
import { renderMarkdown } from './markdown.js';

// In-memory caches to make tab switching and repo re-inspection instant
const readmeCache = new Map();
const contentsCache = new Map();
const languagesCache = new Map();
const issuesCache = new Map();
const commitActivityCache = new Map();
const activeTabByRepoId = new Map();
const filePathByRepoId = new Map();
let currentCloneFormat = 'https'; // 'https' | 'ssh' | 'cli'

function formatBytes(bytes) {
  if (!bytes || bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

export function renderDetailPanel(
  container,
  repo,
  info,
  {
    onRegenerate,
    onOpenSettings,
    onViewCommits,
    onTogglePin,
    onAssignFolder,
    onCreateFolder,
    folders = [],
    repoTags = {},
    customTags = [],
    onAssignTag,
    onRemoveTag,
    onCreateTag,
    githubToken,
    onParentLoaded,
  } = {}
) {
  if (!repo) {
    container.innerHTML = `
      <div class="detail-panel__empty">
        <svg class="detail-panel__empty-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
          <path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1-2.5-2.5Z"/>
          <path d="M6 6h10"/>
          <path d="M6 10h10"/>
        </svg>
        <p class="detail-panel__empty-title">No repository selected</p>
        <p class="detail-panel__empty-desc">Click any repository from the list or use the ↑ / ↓ arrow keys to view its AI summary and details.</p>
      </div>
    `;
    return;
  }

  const kindLabel = repo.isFork ? (repo.looksUntouched ? 'Untouched fork' : 'Fork') : 'Original';
  const kindBadgeClass = repo.isFork ? (repo.looksUntouched ? 'badge--untouched' : 'badge--fork') : 'badge--original';
  const langColor = repo.language ? getLanguageColor(repo.language) : null;
  const currentFolder = folders.find((f) => f.id === repo.folderId);
  const activeTab = activeTabByRepoId.get(repo.id) || 'overview';
  const assignedTagIds = repoTags[repo.id] || [];
  const assignedTags = assignedTagIds
    .map((id) => customTags.find((t) => t.id === id))
    .filter(Boolean);

  container.innerHTML = `
    <div class="detail-panel__header">
      <div class="detail-panel__title-row">
        <h2 class="detail-panel__title">
          <a href="${repo.url}" target="_blank" rel="noopener" title="Open on GitHub">
            ${escapeHtml(repo.name)}
          </a>
        </h2>
      </div>

      <div class="detail-panel__meta-badges">
        <span class="badge ${repo.isPrivate ? 'badge--private' : 'badge--public'}">
          ${repo.isPrivate ? '<svg class="badge__icon" viewBox="0 0 16 16" fill="currentColor"><path d="M4 4a4 4 0 0 1 8 0v2h.25c.966 0 1.75.784 1.75 1.75v5.5A1.75 1.75 0 0 1 12.25 15h-8.5A1.75 1.75 0 0 1 2 13.25v-5.5C2 6.784 2.784 6 3.75 6H4V4Zm1.5 2h5V4a2.5 2.5 0 0 0-5 0v2Z"/></svg>' : ''}
          ${repo.isPrivate ? 'Private' : 'Public'}
        </span>
        <span class="badge ${kindBadgeClass}">${kindLabel}</span>
        ${repo.archived ? '<span class="badge badge--archived">Archived</span>' : ''}
        ${repo.isPinned ? '<span class="badge badge--pinned">📌 Pinned</span>' : ''}
        ${currentFolder ? `<span class="badge badge--folder" style="--folder-color: ${currentFolder.color || '#0071e3'}"><span class="folder-dot" style="background-color: ${currentFolder.color || '#0071e3'}"></span> ${escapeHtml(currentFolder.name)}</span>` : ''}
        ${repo.owner ? `<span class="detail-panel__owner-badge">by <strong>${escapeHtml(repo.owner)}</strong></span>` : ''}
      </div>

      ${
        repo.isFork && repo.parent
          ? `
        <div class="detail-fork-callout">
          <svg class="detail-fork-icon" viewBox="0 0 16 16" fill="currentColor">
            <path d="M5 3.25a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0Zm0 2.122a2.25 2.25 0 1 0-1.5 0v.878A2.25 2.25 0 0 0 5.75 8.5h4.5A2.25 2.25 0 0 0 12.5 6.25v-.878a2.25 2.25 0 1 0-1.5 0v.878a.75.75 0 0 1-.75.75h-4.5A.75.75 0 0 1 5 6.25v-.878ZM12.5 3.25a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0ZM8 12.75a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0Zm0 2.122a2.25 2.25 0 1 0-1.5 0V11a.75.75 0 0 1 .75-.75h.001A.75.75 0 0 1 8 11v3.872Z"/>
          </svg>
          <span class="detail-fork-text">
            Forked from <a href="${escapeHtml(repo.parent.url || 'https://github.com/' + repo.parent.fullName)}" target="_blank" rel="noopener" class="detail-fork-link"><strong>${escapeHtml(repo.parent.fullName)}</strong></a>
          </span>
          <span class="detail-fork-stars" title="${repo.parent.stars.toLocaleString()} upstream stars">★ ${formatNumber(repo.parent.stars)}</span>
        </div>
      `
          : ''
      }

      <div class="detail-panel__actions">
        <a class="detail-btn detail-btn--primary" href="${repo.url}" target="_blank" rel="noopener">
          <svg class="detail-btn__icon" viewBox="0 0 16 16" fill="currentColor">
            <path d="M3.75 2h3.5a.75.75 0 0 1 0 1.5h-3.5a.25.25 0 0 0-.25.25v8.5c0 .138.112.25.25.25h8.5a.25.25 0 0 0 .25-.25v-3.5a.75.75 0 0 1 1.5 0v3.5A1.75 1.75 0 0 1 12.25 14h-8.5A1.75 1.75 0 0 1 2 12.25v-8.5C2 2.784 2.784 2 3.75 2Zm6.75.75a.75.75 0 0 1 .75-.75h3.5a.75.75 0 0 1 .75.75v3.5a.75.75 0 0 1-1.5 0V3.56l-4.22 4.22a.749.749 0 0 1-1.275-.326.749.749 0 0 1 .215-.734L13.44 2.5H10.5a.75.75 0 0 1-.75-.75Z"/>
          </svg>
          <span>GitHub</span>
        </a>

        <button
          type="button"
          class="detail-btn detail-btn--pin ${repo.isPinned ? 'detail-btn--pinned' : ''}"
          id="btn-detail-pin"
          title="${repo.isPinned ? 'Unpin repository' : 'Pin repository'}"
        >
          <svg class="detail-btn__icon" viewBox="0 0 16 16" fill="currentColor">
            <path d="M9.828.722a.5.5 0 0 1 .354.146l4.95 4.95a.5.5 0 0 1 0 .707c-.48.48-1.072.588-1.503.588-.177 0-.335-.018-.46-.039l-2.46 2.46c.02.125.039.283.039.46 0 .43-.108 1.022-.588 1.503a.5.5 0 0 1-.707 0L7.843 9.927 4.136 13.634a.5.5 0 0 1-.707 0l-.354-.354a.5.5 0 0 1 0-.707l3.707-3.707-1.57-1.57a.5.5 0 0 1 0-.707c.48-.48 1.072-.588 1.503-.588.177 0 .335.018.46.039l2.46-2.46c-.02-.125-.039-.283-.039-.46 0-.43.108-1.022.588-1.503a.5.5 0 0 1 .354-.146Z"/>
          </svg>
          <span class="detail-btn-pin-label">${repo.isPinned ? 'Pinned' : 'Pin'}</span>
        </button>

        <a class="detail-btn detail-btn--secondary btn-vscode" href="vscode://vscode.git/clone?url=${encodeURIComponent(repo.cloneUrl || repo.url + '.git')}" title="Clone and open in local VS Code" target="_blank" rel="noopener">
          <svg class="detail-btn__icon" viewBox="0 0 16 16" fill="currentColor">
            <path d="M14.5 2.5a.5.5 0 0 0-.25-.433l-3-1.732a.5.5 0 0 0-.583.076L6.5 4.3 3.65 1.84a.5.5 0 0 0-.64.01L1.24 3.32a.5.5 0 0 0-.09.68L3.8 7.5 1.15 11.04a.5.5 0 0 0 .09.68l1.77 1.47a.5.5 0 0 0 .64.01L6.5 10.7l4.167 3.889a.5.5 0 0 0 .583.076l3-1.732a.5.5 0 0 0 .25-.433V2.5ZM11 4.232l2-1.155v9.846l-2-1.155V4.232Z"/>
          </svg>
          <span>VS Code</span>
        </a>

        <a class="detail-btn detail-btn--secondary btn-githubdev" href="https://github.dev/${escapeHtml(repo.fullName)}" title="Open in web-based github.dev editor" target="_blank" rel="noopener">
          <svg class="detail-btn__icon" viewBox="0 0 16 16" fill="currentColor">
            <path d="M4 1.75C4 .784 4.784 0 5.75 0h5.586a1.75 1.75 0 0 1 1.237.513l2.914 2.914c.328.328.513.774.513 1.237v8.586A1.75 1.75 0 0 1 14.25 15h-8.5A1.75 1.75 0 0 1 4 13.25V1.75Zm1.75-.25a.25.25 0 0 0-.25.25v11.5c0 .138.112.25.25.25h8.5a.25.25 0 0 0 .25-.25V5h-2.75A1.75 1.75 0 0 1 10 3.25V1.5H5.75Zm5.75 1.75v-.69L13.69 5H11.75a.25.25 0 0 1-.25-.25ZM2.25 3A1.75 1.75 0 0 0 .5 4.75v9.5C.5 15.216 1.284 16 2.25 16h8.5A1.75 1.75 0 0 0 12.5 14.25v-.5a.75.75 0 0 0-1.5 0v.5a.25.25 0 0 1-.25.25h-8.5a.25.25 0 0 1-.25-.25v-9.5a.25.25 0 0 1 .25-.25h.5a.75.75 0 0 0 0-1.5h-.5Z"/>
          </svg>
          <span>github.dev</span>
        </a>
      </div>
    </div>

    <!-- Inspector Navigation Tabs -->
    <nav class="detail-tabs" role="tablist" aria-label="Repository Inspector Navigation">
      <button type="button" class="detail-tab-btn ${activeTab === 'overview' ? 'detail-tab--active' : ''}" data-tab="overview">
        Overview
      </button>
      <button type="button" class="detail-tab-btn ${activeTab === 'readme' ? 'detail-tab--active' : ''}" data-tab="readme">
        README
      </button>
      <button type="button" class="detail-tab-btn ${activeTab === 'files' ? 'detail-tab--active' : ''}" data-tab="files">
        Files
      </button>
      <button type="button" class="detail-tab-btn ${activeTab === 'issues' ? 'detail-tab--active' : ''}" data-tab="issues">
        Issues & PRs ${repo.openIssues ? `<span class="detail-tab-count">${repo.openIssues}</span>` : ''}
      </button>
    </nav>

    <!-- Tab Content Container -->
    <div class="detail-tab-content">
      <!-- 1. OVERVIEW TAB -->
      <div class="tab-pane ${activeTab === 'overview' ? 'is-active' : ''}" data-pane="overview">
        <!-- 1-Click Git Clone & CLI Capsule -->
        <div class="clone-capsule">
          <div class="clone-capsule__top">
            <div class="clone-switcher" role="group" aria-label="Clone protocol">
              <button type="button" class="clone-switcher__btn ${currentCloneFormat === 'https' ? 'is-active' : ''}" data-format="https">HTTPS</button>
              <button type="button" class="clone-switcher__btn ${currentCloneFormat === 'ssh' ? 'is-active' : ''}" data-format="ssh">SSH</button>
              <button type="button" class="clone-switcher__btn ${currentCloneFormat === 'cli' ? 'is-active' : ''}" data-format="cli">GitHub CLI</button>
            </div>
            <button type="button" class="clone-copy-btn" id="btn-capsule-copy" title="Copy command to clipboard">
              <svg class="clone-copy-icon" viewBox="0 0 16 16" fill="currentColor">
                <path d="M0 6.75C0 5.784.784 5 1.75 5h1.5a.75.75 0 0 1 0 1.5h-1.5a.25.25 0 0 0-.25.25v7.5c0 .138.112.25.25.25h7.5a.25.25 0 0 0 .25-.25v-1.5a.75.75 0 0 1 1.5 0v1.5A1.75 1.75 0 0 1 9.25 16h-7.5A1.75 1.75 0 0 1 0 14.25Z"/>
                <path d="M5 1.75C5 .784 5.784 0 6.75 0h7.5C15.216 0 16 .784 16 1.75v7.5A1.75 1.75 0 0 1 14.25 11h-7.5A1.75 1.75 0 0 1 5 9.25Zm1.75-.25a.25.25 0 0 0-.25.25v7.5c0 .138.112.25.25.25h7.5a.25.25 0 0 0 .25-.25v-7.5a.25.25 0 0 0-.25-.25Z"/>
              </svg>
              <span class="clone-copy-text">Copy</span>
            </button>
          </div>
          <div class="clone-code-box" id="clone-code-box">
            <code>${escapeHtml(getCloneCommand(repo, currentCloneFormat))}</code>
          </div>
        </div>

        <!-- AI Summary Section -->
        <div class="detail-card detail-card--ai">
          <div class="detail-card__header">
            <div class="detail-card__title">
              <svg class="icon-sparkle" viewBox="0 0 16 16" fill="currentColor">
                <path d="M7.53 1.282a.5.5 0 0 1 .94 0l1.246 3.655a.5.5 0 0 0 .348.348l3.655 1.246a.5.5 0 0 1 0 .94l-3.655 1.246a.5.5 0 0 0-.348.348l-1.246 3.655a.5.5 0 0 1-.94 0L6.284 9.066a.5.5 0 0 0-.348-.348L2.28 7.472a.5.5 0 0 1 0-.94l3.655-1.246a.5.5 0 0 0 .348-.348L7.53 1.282Z"/>
              </svg>
              <span>AI Summary</span>
            </div>
            ${
              onRegenerate
                ? `<button type="button" class="btn-card-action" id="btn-regen-ai" title="Regenerate summary">
                    <svg class="icon-regen" viewBox="0 0 16 16" fill="currentColor">
                      <path d="M1.705 8.005a.75.75 0 0 1 .834.656 5.5 5.5 0 0 0 9.592 2.97l-1.204-1.204a.25.25 0 0 1 .177-.427h3.646a.25.25 0 0 1 .25.25v3.646a.25.25 0 0 1-.427.177l-1.38-1.38A7.002 7.002 0 0 1 1.05 8.84a.75.75 0 0 1 .656-.834ZM8 2.5a5.487 5.487 0 0 0-4.131 1.869l1.204 1.204A.25.25 0 0 1 4.896 6H1.25A.25.25 0 0 1 1 5.75V2.104a.25.25 0 0 1 .427-.177l1.38 1.38A7.002 7.002 0 0 1 14.95 7.16a.75.75 0 0 1-1.49.178A5.5 5.5 0 0 0 8 2.5Z"/>
                    </svg>
                  </button>`
                : ''
            }
          </div>
          <div class="detail-card__body" data-role="ai-slot">
            ${renderAiSlot(info, Boolean(onRegenerate))}
          </div>
        </div>

        <!-- GitHub Description -->
        ${
          repo.description
            ? `<div class="detail-card">
                 <div class="detail-card__header">
                   <div class="detail-card__title">GitHub Description</div>
                 </div>
                 <div class="detail-card__body">
                   <p class="repo-desc-text">${escapeHtml(repo.description)}</p>
                 </div>
               </div>`
            : ''
        }

        <!-- Multi-Language Composition Bar -->
        <div class="detail-card detail-card--languages" id="lang-card">
          <div class="detail-card__header">
            <div class="detail-card__title">Languages</div>
          </div>
          <div class="detail-card__body" id="lang-slot">
            <div class="detail-loading-skeleton" style="height: 14px; border-radius: 4px;"></div>
          </div>
        </div>

        <!-- 12-Week Commit Activity Sparkline -->
        <div class="detail-card detail-card--activity" id="activity-card">
          <div class="detail-card__header">
            <div class="detail-card__title">12-Week Commit Pulse</div>
            <span class="sparkline-total" id="sparkline-total">—</span>
          </div>
          <div class="detail-card__body" id="activity-slot">
            <div class="detail-loading-skeleton" style="height: 36px; border-radius: 4px;"></div>
          </div>
        </div>

        <!-- Tags Manager Card -->
        <div class="detail-card detail-card--tags">
          <div class="detail-card__header">
            <div class="detail-card__title">Tags</div>
            <button type="button" class="btn-card-action" id="btn-open-tag-popover" title="Add tag">+ Add Tag</button>
          </div>
          <div class="detail-card__body">
            <div class="detail-tags-wrap" id="detail-tags-wrap">
              ${
                assignedTags.length > 0
                  ? assignedTags
                      .map(
                        (t) => `
                    <span class="detail-tag-chip" style="--tag-color: ${t.color || '#0071e3'}">
                      <span class="tag-dot" style="background-color: ${t.color || '#0071e3'}"></span>
                      <span class="tag-name">${escapeHtml(t.name)}</span>
                      <button type="button" class="btn-remove-tag" data-tag-id="${t.id}" title="Remove tag">✕</button>
                    </span>
                  `
                      )
                      .join('')
                  : '<span class="detail-tags-empty">No tags assigned</span>'
              }
            </div>
            <div class="tag-popover" id="tag-popover" hidden>
              <div class="tag-popover__title">Assign Tag</div>
              <div class="tag-popover__list">
                ${customTags
                  .map((t) => {
                    const isAssigned = assignedTagIds.includes(t.id);
                    return `
                    <button type="button" class="tag-popover__item ${isAssigned ? 'is-assigned' : ''}" data-tag-id="${t.id}">
                      <span class="tag-dot" style="background-color: ${t.color || '#0071e3'}"></span>
                      <span class="tag-popover__name">${escapeHtml(t.name)}</span>
                      ${isAssigned ? '<span class="tag-popover__check">✓</span>' : ''}
                    </button>
                  `;
                  })
                  .join('')}
              </div>
              <div class="tag-popover__create">
                <input type="text" class="tag-popover__input" id="tag-create-input" placeholder="New tag name…" maxlength="24" />
                <button type="button" class="tag-popover__create-btn" id="btn-create-tag">Create</button>
              </div>
            </div>
          </div>
        </div>

        <!-- Repository Metadata Grid -->
        <div class="detail-card">
          <div class="detail-card__header">
            <div class="detail-card__title">Repository Overview</div>
          </div>
          <div class="detail-grid">
            <div class="detail-grid__item">
              <span class="detail-grid__label">Primary Language</span>
              <span class="detail-grid__value">
                ${
                  repo.language
                    ? `<span class="detail-grid__lang-dot" style="background-color: ${langColor}"></span>${escapeHtml(repo.language)}`
                    : '—'
                }
              </span>
            </div>

            <div class="detail-grid__item">
              <span class="detail-grid__label">Stars</span>
              <span class="detail-grid__value">
                ${
                  repo.parentStars != null
                    ? `<span title="${repo.stars} stars on your fork">${formatNumber(repo.stars)}</span> <span class="detail-grid__subtle" title="${repo.parentStars.toLocaleString()} stars on upstream (${escapeHtml(repo.parent?.fullName || '')})">(★ ${formatNumber(repo.parentStars)} upstream)</span>`
                    : repo.isFork
                    ? `${formatNumber(repo.stars)} <span class="detail-grid__subtle">(fork)</span>`
                    : formatNumber(repo.stars)
                }
              </span>
            </div>

            <div class="detail-grid__item">
              <span class="detail-grid__label">Forks</span>
              <span class="detail-grid__value">
                ${
                  repo.parent?.forksCount != null
                    ? `<span title="${repo.forksCount ?? 0} forks on this repo">${formatNumber(repo.forksCount ?? 0)}</span> <span class="detail-grid__subtle">(${formatNumber(repo.parent.forksCount)} upstream)</span>`
                    : formatNumber(repo.forksCount ?? 0)
                }
              </span>
            </div>

            <div class="detail-grid__item">
              <span class="detail-grid__label">Open Issues</span>
              <span class="detail-grid__value">${formatNumber(repo.openIssues ?? 0)}</span>
            </div>

            <div class="detail-grid__item">
              <span class="detail-grid__label">Default Branch</span>
              <span class="detail-grid__value font-mono">${escapeHtml(repo.defaultBranch || 'main')}</span>
            </div>

            <div class="detail-grid__item">
              <span class="detail-grid__label">Last Pushed</span>
              <span class="detail-grid__value" title="${formatDate(repo.pushed_at)}">${timeAgo(repo.pushed_at)}</span>
            </div>

            <div class="detail-grid__item">
              <span class="detail-grid__label">Created</span>
              <span class="detail-grid__value" title="${formatDate(repo.createdAt)}">${timeAgo(repo.createdAt)}</span>
            </div>

            <div class="detail-grid__item">
              <span class="detail-grid__label">Visibility</span>
              <span class="detail-grid__value">${repo.isPrivate ? 'Private' : 'Public'}</span>
            </div>
          </div>
        </div>

        <!-- Latest Commit Card -->
        <div class="detail-card detail-card--latest-commit" data-repo-id="${repo.id}">
          <div class="detail-card__header">
            <div class="detail-card__title">
              <svg class="icon-commit" viewBox="0 0 16 16" fill="currentColor">
                <path d="M11.93 8.5a4.002 4.002 0 0 1-7.86 0H.75a.75.75 0 0 1 0-1.5h3.32a4.002 4.002 0 0 1 7.86 0h3.32a.75.75 0 0 1 0 1.5h-3.32Zm-1.43-.75a2.5 2.5 0 1 0-5 0 2.5 2.5 0 0 0 5 0Z"/>
              </svg>
              <span>Latest Commit</span>
            </div>
            <button type="button" class="btn-card-action" id="btn-card-all-commits" title="View all recent commits across repositories">
              <span>All Commits</span> ↗
            </button>
          </div>
          <div class="detail-card__body" id="latest-commit-slot">
            <div class="latest-commit-loading">
              <div class="detail-loading-skeleton"></div>
              <div class="detail-loading-skeleton" style="width: 60%"></div>
            </div>
          </div>
        </div>

        <!-- Folder Organization Card -->
        <div class="detail-card detail-card--folder">
          <div class="detail-card__header">
            <div class="detail-card__title">
              <svg class="icon-folder" viewBox="0 0 16 16" fill="currentColor">
                <path d="M1.75 1A1.75 1.75 0 0 0 0 2.75v10.5C0 14.216.784 15 1.75 15h12.5A1.75 1.75 0 0 0 16 13.25v-8.5A1.75 1.75 0 0 0 14.25 3H7.5a.25.25 0 0 1-.2-.1l-.9-1.2C6.07 1.26 5.55 1 5 1H1.75Z"/>
              </svg>
              <span>Folder Assignment</span>
            </div>
            ${
              onCreateFolder
                ? `<button type="button" class="btn-card-action" id="btn-detail-new-folder" title="Create new folder">+ New</button>`
                : ''
            }
          </div>
          <div class="detail-card__body">
            <div class="folder-selector-wrap">
              <select class="folder-selector" id="detail-folder-select" aria-label="Assign to folder">
                <option value="">None (Unfiled)</option>
                ${folders
                  .map(
                    (f) => `
                  <option value="${escapeHtml(f.id)}" ${f.id === repo.folderId ? 'selected' : ''}>
                    ${escapeHtml(f.name)}
                  </option>
                `
                  )
                  .join('')}
              </select>
            </div>
          </div>
        </div>
      </div>

      <!-- 2. README TAB -->
      <div class="tab-pane ${activeTab === 'readme' ? 'is-active' : ''}" data-pane="readme">
        <div class="readme-view" id="readme-slot">
          <div class="detail-loading-skeleton" style="height: 120px; border-radius: 8px;"></div>
        </div>
      </div>

      <!-- 3. FILES TAB -->
      <div class="tab-pane ${activeTab === 'files' ? 'is-active' : ''}" data-pane="files">
        <div class="file-tree-view" id="files-slot">
          <div class="detail-loading-skeleton" style="height: 100px; border-radius: 8px;"></div>
        </div>
      </div>

      <!-- 4. ISSUES & PRS TAB -->
      <div class="tab-pane ${activeTab === 'issues' ? 'is-active' : ''}" data-pane="issues">
        <div class="issues-view" id="issues-slot">
          <div class="detail-loading-skeleton" style="height: 100px; border-radius: 8px;"></div>
        </div>
      </div>
    </div>
  `;

  // Wire Tab switching
  const tabButtons = container.querySelectorAll('.detail-tab-btn');
  tabButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      const tabId = btn.dataset.tab;
      activeTabByRepoId.set(repo.id, tabId);
      tabButtons.forEach((b) => b.classList.toggle('detail-tab--active', b === btn));
      container.querySelectorAll('.tab-pane').forEach((pane) => {
        pane.classList.toggle('is-active', pane.dataset.pane === tabId);
      });
      loadActiveTabContent(tabId);
    });
  });

  // Wire Clone protocol switcher & Copy button
  function getCloneCommand(targetRepo, format) {
    if (format === 'ssh') {
      return `git clone git@github.com:${targetRepo.fullName}.git`;
    }
    if (format === 'cli') {
      return `gh repo clone ${targetRepo.fullName}`;
    }
    return `git clone ${targetRepo.cloneUrl || 'https://github.com/' + targetRepo.fullName + '.git'}`;
  }

  const switcherButtons = container.querySelectorAll('.clone-switcher__btn');
  const codeBox = container.querySelector('#clone-code-box code');
  const capsuleCopyBtn = container.querySelector('#btn-capsule-copy');

  switcherButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      currentCloneFormat = btn.dataset.format;
      switcherButtons.forEach((b) => b.classList.toggle('is-active', b === btn));
      if (codeBox) {
        codeBox.textContent = getCloneCommand(repo, currentCloneFormat);
      }
    });
  });

  if (capsuleCopyBtn) {
    capsuleCopyBtn.addEventListener('click', async () => {
      const cmd = getCloneCommand(repo, currentCloneFormat);
      try {
        await navigator.clipboard.writeText(cmd);
        const textEl = capsuleCopyBtn.querySelector('.clone-copy-text');
        if (textEl) {
          const original = textEl.textContent;
          textEl.textContent = '✓ Copied';
          capsuleCopyBtn.classList.add('is-copied');
          setTimeout(() => {
            textEl.textContent = original;
            capsuleCopyBtn.classList.remove('is-copied');
          }, 1800);
        }
      } catch {
        window.prompt('Copy command:', cmd);
      }
    });
  }

  // Wire Pin toggle
  const pinBtn = container.querySelector('#btn-detail-pin');
  if (pinBtn && onTogglePin) {
    pinBtn.addEventListener('click', () => {
      onTogglePin(repo.id);
    });
  }

  // Wire Folder Assignment
  const folderSelect = container.querySelector('#detail-folder-select');
  if (folderSelect && onAssignFolder) {
    folderSelect.addEventListener('change', () => {
      onAssignFolder(repo.id, folderSelect.value || null);
    });
  }

  // Wire Create Folder button
  const newFolderBtn = container.querySelector('#btn-detail-new-folder');
  if (newFolderBtn && onCreateFolder) {
    newFolderBtn.addEventListener('click', onCreateFolder);
  }

  // Wire Tags Popover & Management
  const tagPopover = container.querySelector('#tag-popover');
  const openTagPopoverBtn = container.querySelector('#btn-add-tag, #btn-open-tag-popover');
  const tagCreateInput = container.querySelector('#tag-create-input');
  const createTagBtn = container.querySelector('#btn-create-tag');

  if (openTagPopoverBtn && tagPopover) {
    openTagPopoverBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      tagPopover.hidden = !tagPopover.hidden;
      if (!tagPopover.hidden && tagCreateInput) {
        tagCreateInput.focus();
      }
    });
  }

  if (container._tagDocClick) {
    document.removeEventListener('click', container._tagDocClick);
  }
  container._tagDocClick = (e) => {
    if (tagPopover && !tagPopover.hidden && !tagPopover.contains(e.target) && !openTagPopoverBtn?.contains(e.target)) {
      tagPopover.hidden = true;
    }
  };
  document.addEventListener('click', container._tagDocClick);

  container.querySelectorAll('.tag-popover__item').forEach((itemBtn) => {
    itemBtn.addEventListener('click', () => {
      const tagId = itemBtn.dataset.tagId;
      const isAssigned = assignedTagIds.includes(tagId);
      if (isAssigned) {
        if (onRemoveTag) onRemoveTag(repo.id, tagId);
      } else {
        if (onAssignTag) onAssignTag(repo.id, tagId);
      }
      if (tagPopover) tagPopover.hidden = true;
    });
  });

  container.querySelectorAll('.btn-remove-tag').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const tagId = btn.dataset.tagId;
      if (onRemoveTag) onRemoveTag(repo.id, tagId);
    });
  });

  if (createTagBtn && tagCreateInput && onCreateTag) {
    const handleCreate = async () => {
      const name = tagCreateInput.value.trim();
      if (!name) return;
      const newTag = await onCreateTag(name);
      if (newTag?.id && onAssignTag) {
        await onAssignTag(repo.id, newTag.id);
      }
      tagCreateInput.value = '';
      if (tagPopover) tagPopover.hidden = true;
    };

    createTagBtn.addEventListener('click', handleCreate);
    tagCreateInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        handleCreate();
      }
    });
  }

  // Wire Latest Commit card
  const latestCommitSlot = container.querySelector('#latest-commit-slot');
  const allCommitsBtn = container.querySelector('#btn-card-all-commits');

  if (allCommitsBtn && onViewCommits) {
    allCommitsBtn.addEventListener('click', () => {
      onViewCommits(repo);
    });
  }

  if (latestCommitSlot) {
    if (githubToken && repo.owner && repo.name) {
      fetchRepoCommits(repo.owner, repo.name, githubToken, { perPage: 1 })
        .then((commits) => {
          if (container.dataset.activeRepoId !== String(repo.id)) return;
          if (!commits || commits.length === 0) {
            latestCommitSlot.innerHTML = `<div class="latest-commit-empty">No commits found on default branch</div>`;
            return;
          }
          const c = commits[0];
          latestCommitSlot.innerHTML = `
            <div class="latest-commit-item">
              <div class="latest-commit-msg" title="${escapeHtml(c.message)}">${escapeHtml(c.message.split('\n')[0])}</div>
              <div class="latest-commit-meta">
                ${c.authorAvatar ? `<img src="${c.authorAvatar}" class="latest-commit-avatar" alt="${escapeHtml(c.authorName)}" />` : ''}
                <span class="latest-commit-author">${escapeHtml(c.authorName)}</span>
                <span class="latest-commit-time" title="${new Date(c.date).toLocaleString()}">· ${timeAgo(c.date)}</span>
                <a href="${c.url}" target="_blank" rel="noopener" class="latest-commit-sha" title="View commit on GitHub">${c.sha.slice(0, 7)}</a>
              </div>
            </div>
          `;
        })
        .catch((err) => {
          if (container.dataset.activeRepoId !== String(repo.id)) return;
          latestCommitSlot.innerHTML = `<div class="latest-commit-error">Unable to load commit: ${escapeHtml(err.message)}</div>`;
        });
    } else {
      latestCommitSlot.innerHTML = `<div class="latest-commit-empty">Enter a GitHub token in Settings to preview commits</div>`;
    }
  }

  // Wire Regenerate AI button
  const regenBtn = container.querySelector('#btn-regen-ai');
  if (regenBtn && onRegenerate) {
    regenBtn.addEventListener('click', () => {
      regenBtn.classList.add('is-spinning');
      onRegenerate(repo.id);
    });
  }

  // Wire Retry AI button
  const retryBtn = container.querySelector('#btn-retry-ai');
  if (retryBtn && onRegenerate) {
    retryBtn.addEventListener('click', () => {
      retryBtn.disabled = true;
      retryBtn.textContent = 'Retrying…';
      onRegenerate(repo.id);
    });
  }

  // Wire Open Settings prompt
  const settingsBtn = container.querySelector('#btn-open-settings-prompt');
  if (settingsBtn && onOpenSettings) {
    settingsBtn.addEventListener('click', onOpenSettings);
  }

  container.dataset.activeRepoId = String(repo.id);

  // Load language composition bar on Overview
  loadLanguages(repo, githubToken);

  // Load 12-week commit activity sparkline on Overview
  loadCommitActivity(repo, githubToken);

  // Load active tab content (if active tab is not overview)
  if (activeTab !== 'overview') {
    loadActiveTabContent(activeTab);
  }

  function loadActiveTabContent(tabId) {
    if (tabId === 'readme') {
      loadReadme(repo, githubToken);
    } else if (tabId === 'files') {
      const curPath = filePathByRepoId.get(repo.id) || '';
      loadFiles(repo, curPath, githubToken);
    } else if (tabId === 'issues') {
      loadIssues(repo, githubToken);
    }
  }

  // Helper to load languages breakdown
  function loadLanguages(targetRepo, token) {
    const langSlot = container.querySelector('#lang-slot');
    if (!langSlot || !token) return;

    if (languagesCache.has(targetRepo.id)) {
      renderLanguages(langSlot, languagesCache.get(targetRepo.id));
      return;
    }

    fetchRepoLanguages(targetRepo.owner, targetRepo.name, token)
      .then((data) => {
        languagesCache.set(targetRepo.id, data);
        if (container.dataset.activeRepoId === String(targetRepo.id)) {
          renderLanguages(langSlot, data);
        }
      })
      .catch(() => {
        if (container.dataset.activeRepoId === String(targetRepo.id)) {
          langSlot.innerHTML = `<span class="detail-grid__subtle">No language data available</span>`;
        }
      });
  }

  function renderLanguages(slot, data) {
    const entries = Object.entries(data);
    if (entries.length === 0) {
      slot.innerHTML = `<span class="detail-grid__subtle">No language distribution recorded</span>`;
      return;
    }
    const totalBytes = entries.reduce((acc, [, bytes]) => acc + bytes, 0);
    if (totalBytes === 0) {
      slot.innerHTML = `<span class="detail-grid__subtle">0 bytes of code</span>`;
      return;
    }

    const segments = entries
      .map(([name, bytes]) => {
        const pct = Math.max(0.1, (bytes / totalBytes) * 100);
        return {
          name,
          color: getLanguageColor(name),
          percent: pct < 1 ? pct.toFixed(1) : Math.round(pct),
          bytes,
        };
      })
      .sort((a, b) => b.bytes - a.bytes);

    slot.innerHTML = `
      <div class="lang-composition-bar">
        ${segments.map((s) => `<div class="lang-composition-segment" style="width: ${s.percent}%; background-color: ${s.color}" title="${escapeHtml(s.name)}: ${s.percent}% (${formatBytes(s.bytes)})"></div>`).join('')}
      </div>
      <div class="lang-composition-legend">
        ${segments
          .slice(0, 5)
          .map(
            (s) => `
          <span class="lang-legend-item">
            <span class="lang-legend-dot" style="background-color: ${s.color}"></span>
            <span class="lang-legend-name">${escapeHtml(s.name)}</span>
            <span class="lang-legend-pct">${s.percent}%</span>
          </span>
        `
          )
          .join('')}
      </div>
    `;
  }

  // Helper to load 12-week commit activity
  function loadCommitActivity(targetRepo, token) {
    const activitySlot = container.querySelector('#activity-slot');
    const totalSpan = container.querySelector('#sparkline-total');
    if (!activitySlot || !token) return;

    if (commitActivityCache.has(targetRepo.id)) {
      renderActivity(activitySlot, totalSpan, commitActivityCache.get(targetRepo.id));
      return;
    }

    fetchRepoCommitActivity(targetRepo.owner, targetRepo.name, token)
      .then((weeks) => {
        commitActivityCache.set(targetRepo.id, weeks);
        if (container.dataset.activeRepoId === String(targetRepo.id)) {
          renderActivity(activitySlot, totalSpan, weeks);
        }
      })
      .catch(() => {
        if (container.dataset.activeRepoId === String(targetRepo.id)) {
          activitySlot.innerHTML = `<span class="detail-grid__subtle">Activity data unavailable</span>`;
        }
      });
  }

  function renderActivity(slot, totalSpan, weeks) {
    const totalCommits = weeks.reduce((acc, c) => acc + c, 0);
    if (totalSpan) {
      totalSpan.textContent = `${totalCommits.toLocaleString()} commit${totalCommits === 1 ? '' : 's'}`;
    }

    const max = Math.max(1, ...weeks);
    slot.innerHTML = `
      <div class="sparkline-chart" role="img" aria-label="12-week commit activity chart">
        ${weeks
          .map((count, idx) => {
            const h = Math.max(3, Math.round((count / max) * 32));
            const weekNum = 12 - idx;
            const weekLabel = weekNum === 1 ? 'This week' : `${weekNum} weeks ago`;
            return `
              <div class="sparkline-col" title="${weekLabel}: ${count} commit${count === 1 ? '' : 's'}">
                <div class="sparkline-bar" style="height: ${h}px"></div>
              </div>
            `;
          })
          .join('')}
      </div>
    `;
  }

  // Helper to load full README
  function loadReadme(targetRepo, token) {
    const readmeSlot = container.querySelector('#readme-slot');
    if (!readmeSlot) return;

    if (readmeCache.has(targetRepo.id)) {
      readmeSlot.innerHTML = readmeCache.get(targetRepo.id);
      wireReadmeCodeCopy(readmeSlot);
      return;
    }

    if (!token) {
      readmeSlot.innerHTML = `<div class="readme-empty">Provide a GitHub token in Settings to preview the full README.</div>`;
      return;
    }

    fetchFullReadme(targetRepo.owner, targetRepo.name, token)
      .then((md) => {
        if (container.dataset.activeRepoId !== String(targetRepo.id)) return;
        if (md === null) {
          const emptyHtml = `<div class="readme-empty">This repository does not have a README file.</div>`;
          readmeCache.set(targetRepo.id, emptyHtml);
          readmeSlot.innerHTML = emptyHtml;
          return;
        }
        const renderedHtml = `
          <div class="readme-header">
            <span class="readme-title">README.md</span>
            <a href="${targetRepo.url}#readme" target="_blank" rel="noopener" class="readme-ext-link">Open on GitHub ↗</a>
          </div>
          <article class="markdown-body">
            ${renderMarkdown(md, { repoFullName: targetRepo.fullName, defaultBranch: targetRepo.defaultBranch || 'main' })}
          </article>
        `;
        readmeCache.set(targetRepo.id, renderedHtml);
        readmeSlot.innerHTML = renderedHtml;
        wireReadmeCodeCopy(readmeSlot);
      })
      .catch((err) => {
        if (container.dataset.activeRepoId !== String(targetRepo.id)) return;
        readmeSlot.innerHTML = `<div class="readme-error">Unable to load README: ${escapeHtml(err.message)}</div>`;
      });
  }

  function wireReadmeCodeCopy(slot) {
    if (!slot) return;
    slot.querySelectorAll('.md-copy-btn').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const code = btn.closest('.md-code-wrap')?.querySelector('code')?.textContent || '';
        if (!code) return;
        try {
          await navigator.clipboard.writeText(code);
          const orig = btn.textContent;
          btn.textContent = '✓ Copied';
          setTimeout(() => {
            btn.textContent = orig;
          }, 1800);
        } catch {
          window.prompt('Copy code:', code);
        }
      });
    });
  }

  // Helper to load file tree
  function loadFiles(targetRepo, path = '', token) {
    const filesSlot = container.querySelector('#files-slot');
    if (!filesSlot) return;

    const cacheKey = `${targetRepo.id}:${path}`;
    if (contentsCache.has(cacheKey)) {
      renderFileList(filesSlot, targetRepo, path, contentsCache.get(cacheKey), token);
      return;
    }

    if (!token) {
      filesSlot.innerHTML = `<div class="files-empty">Provide a GitHub token in Settings to browse files.</div>`;
      return;
    }

    fetchRepoContents(targetRepo.owner, targetRepo.name, token, path)
      .then((items) => {
        contentsCache.set(cacheKey, items);
        if (container.dataset.activeRepoId === String(targetRepo.id)) {
          renderFileList(filesSlot, targetRepo, path, items, token);
        }
      })
      .catch((err) => {
        if (container.dataset.activeRepoId === String(targetRepo.id)) {
          filesSlot.innerHTML = `<div class="files-error">Unable to load directory: ${escapeHtml(err.message)}</div>`;
        }
      });
  }

  function renderFileList(slot, targetRepo, currentPath, items, token) {
    if (!Array.isArray(items)) {
      slot.innerHTML = `<div class="files-empty">No files available</div>`;
      return;
    }

    // Build breadcrumb segments
    const pathParts = currentPath ? currentPath.split('/') : [];
    let breadcrumbHtml = `<button type="button" class="file-crumb-btn" data-nav-path="">${escapeHtml(targetRepo.name)}</button>`;
    let accum = '';
    for (const part of pathParts) {
      accum = accum ? `${accum}/${part}` : part;
      breadcrumbHtml += ` <span class="file-crumb-sep">/</span> <button type="button" class="file-crumb-btn" data-nav-path="${escapeHtml(accum)}">${escapeHtml(part)}</button>`;
    }

    slot.innerHTML = `
      <div class="file-tree-header">
        <div class="file-breadcrumbs">${breadcrumbHtml}</div>
        <span class="file-tree-count">${items.length} item${items.length === 1 ? '' : 's'}</span>
      </div>
      <div class="file-tree-list">
        ${items
          .map((item) => {
            const isDir = item.type === 'dir';
            return `
            <div class="file-tree-row ${isDir ? 'is-dir' : 'is-file'}" data-type="${item.type}" data-path="${escapeHtml(item.path)}">
              <span class="file-tree-icon">${
                isDir
                  ? '<svg class="file-icon" viewBox="0 0 16 16" fill="currentColor"><path d="M1.75 1A1.75 1.75 0 0 0 0 2.75v10.5C0 14.216.784 15 1.75 15h12.5A1.75 1.75 0 0 0 16 13.25v-8.5A1.75 1.75 0 0 0 14.25 3H7.5a.25.25 0 0 1-.2-.1l-.9-1.2C6.07 1.26 5.55 1 5 1H1.75Z"/></svg>'
                  : '<svg class="file-icon" viewBox="0 0 16 16" fill="currentColor"><path d="M2 1.75C2 .784 2.784 0 3.75 0h6.586a1.75 1.75 0 0 1 1.237.513l3.914 3.914c.328.328.513.774.513 1.237v8.586A1.75 1.75 0 0 1 14.25 16h-10.5A1.75 1.75 0 0 1 2 14.25Zm1.75-.25a.25.25 0 0 0-.25.25v12.5c0 .138.112.25.25.25h10.5a.25.25 0 0 0 .25-.25V6h-3.75A1.75 1.75 0 0 1 9 4.25V1.5Zm7.75 1.75V1.5h-.5v2.75c0 .138.112.25.25.25h2.75v-.5Z"/></svg>'
              }</span>
              <span class="file-tree-name">${escapeHtml(item.name)}</span>
              <span class="file-tree-size">${isDir ? '—' : formatBytes(item.size)}</span>
              <a href="${item.url}" target="_blank" rel="noopener" class="file-tree-link" title="Open on GitHub">↗</a>
            </div>
          `;
          })
          .join('')}
      </div>
    `;

    slot.querySelectorAll('.file-crumb-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const nextPath = btn.dataset.navPath;
        filePathByRepoId.set(targetRepo.id, nextPath);
        loadFiles(targetRepo, nextPath, token);
      });
    });

    slot.querySelectorAll('.file-tree-row.is-dir').forEach((row) => {
      row.addEventListener('click', (e) => {
        if (e.target.closest('a')) return;
        const nextPath = row.dataset.path;
        filePathByRepoId.set(targetRepo.id, nextPath);
        loadFiles(targetRepo, nextPath, token);
      });
    });
  }

  // Helper to load issues & PRs
  function loadIssues(targetRepo, token) {
    const issuesSlot = container.querySelector('#issues-slot');
    if (!issuesSlot) return;

    if (issuesCache.has(targetRepo.id)) {
      renderIssuesList(issuesSlot, targetRepo, issuesCache.get(targetRepo.id));
      return;
    }

    if (!token) {
      issuesSlot.innerHTML = `<div class="issues-empty">Provide a GitHub token in Settings to view open issues & PRs.</div>`;
      return;
    }

    fetchRepoIssuesAndPRs(targetRepo.owner, targetRepo.name, token)
      .then((items) => {
        issuesCache.set(targetRepo.id, items);
        if (container.dataset.activeRepoId === String(targetRepo.id)) {
          renderIssuesList(issuesSlot, targetRepo, items);
        }
      })
      .catch((err) => {
        if (container.dataset.activeRepoId === String(targetRepo.id)) {
          issuesSlot.innerHTML = `<div class="issues-error">Unable to load issues: ${escapeHtml(err.message)}</div>`;
        }
      });
  }

  function renderIssuesList(slot, targetRepo, items) {
    if (!items || items.length === 0) {
      slot.innerHTML = `
        <div class="issues-empty">
          <p class="issues-empty-title">Zero Open Issues or Pull Requests</p>
          <p class="issues-empty-desc">This repository has a completely clean issue inbox!</p>
        </div>
      `;
      return;
    }

    slot.innerHTML = `
      <div class="issues-header">
        <span>Recent Open Issues & Pull Requests</span>
        <a href="${targetRepo.url}/issues" target="_blank" rel="noopener" class="issues-ext-link">View all on GitHub ↗</a>
      </div>
      <div class="issues-list">
        ${items
          .map(
            (item) => `
          <a href="${item.url}" target="_blank" rel="noopener" class="issue-item ${item.isPR ? 'issue-item--pr' : 'issue-item--issue'}">
            <div class="issue-item__top">
              <span class="issue-badge ${item.isPR ? 'issue-badge--pr' : 'issue-badge--issue'}">
                ${item.isPR ? 'PR' : 'Issue'} #${item.number}
              </span>
              <span class="issue-title">${escapeHtml(item.title)}</span>
            </div>
            <div class="issue-item__meta">
              ${item.authorAvatar ? `<img src="${item.authorAvatar}" class="issue-avatar" alt="${escapeHtml(item.author)}" />` : ''}
              <span class="issue-author">${escapeHtml(item.author)}</span>
              <span class="issue-time">· updated ${timeAgo(item.updatedAt)}</span>
              ${
                item.labels.length > 0
                  ? `<div class="issue-labels">
                      ${item.labels
                        .slice(0, 3)
                        .map(
                          (l) => `
                        <span class="issue-label-pill" style="--label-color: ${l.color}">${escapeHtml(l.name)}</span>
                      `
                        )
                        .join('')}
                    </div>`
                  : ''
              }
            </div>
          </a>
        `
          )
          .join('')}
      </div>
    `;
  }

  // If repo is a fork and parent is not yet loaded, load on-demand
  if (repo.isFork && !repo.parent && githubToken) {
    fetchRepoParent(repo.owner, repo.name, githubToken).then((parent) => {
      if (parent) {
        repo.parent = parent;
        repo.parentStars = parent.stars;
        if (onParentLoaded) onParentLoaded(repo);
        if (container.dataset.activeRepoId === String(repo.id)) {
          renderDetailPanel(container, repo, info, {
            onRegenerate,
            onOpenSettings,
            onViewCommits,
            onTogglePin,
            onAssignFolder,
            onCreateFolder,
            folders,
            repoTags,
            customTags,
            onAssignTag,
            onRemoveTag,
            onCreateTag,
            githubToken,
            onParentLoaded,
          });
        }
      }
    });
  }
}

/** info is { status: 'no-key' | 'pending' | 'ready' | 'error', text? } */
function renderAiSlot(info, canRetry = false) {
  const status = info?.status ?? 'pending';

  if (status === 'pending') {
    return `
      <div class="ai-skeleton-wrap" aria-label="Generating summary">
        <div class="ai-skeleton"></div>
        <div class="ai-skeleton"></div>
        <div class="ai-skeleton"></div>
      </div>
    `;
  }
  if (status === 'ready') {
    return `<p class="ai-text">${escapeHtml(info.text)}</p>`;
  }
  if (status === 'error') {
    return `
      <div class="ai-error-box">
        <div class="ai-error-header">
          <p class="ai-error-title">Failed to generate summary</p>
          ${
            canRetry
              ? `<button type="button" class="ai-retry-btn" id="btn-retry-ai">Retry</button>`
              : ''
          }
        </div>
        <p class="ai-error-desc">${escapeHtml(info.text || 'An unknown error occurred.')}</p>
      </div>
    `;
  }
  return `
    <div class="ai-no-key">
      <p class="ai-no-key__text">Automated AI summaries are disabled. Configure an AI API key (Google Gemini, OpenRouter, OpenAI, or Claude) in Settings to see summaries for each repo.</p>
      <button type="button" class="ai-no-key__btn" id="btn-open-settings-prompt">Configure in Settings</button>
    </div>
  `;
}
