// overlay/modules/render/repoTile.js
//
// Renders an individual repository as a classy Apple Bento Card.
// Themes:
// - Private repos: Deep dark orange luxury glass theme with crisp white text.
// - Public repos: Deep dark green luxury glass theme with crisp white text.
// No colored lines across the top — unified, sleek, architectural Bento design.

import { escapeHtml, timeAgo, formatNumber } from '../format.js';

export function createRepoTile(repo, { onSelect, onTogglePin, onToggleSelect, initialAiEntry, initialFolder } = {}) {
  const tile = document.createElement('div');
  const themeClass = repo.isPrivate ? 'repo-tile--private' : 'repo-tile--public';
  tile.className = `repo-tile ${themeClass} ${repo.isPinned ? 'repo-tile--pinned' : ''}`;
  tile.dataset.repoId = repo.id;
  tile.dataset.kind = repo.isFork ? (repo.looksUntouched ? 'untouched' : 'fork') : 'original';
  tile.tabIndex = 0;
  tile.role = 'article';
  tile.setAttribute('aria-label', `${repo.name}, ${repo.isPrivate ? 'private' : 'public'} repository`);

  const langDisplay = repo.language
    ? `<span class="repo-tile__lang-pill">
        <span class="repo-tile__lang-dot"></span>
        <span class="repo-tile__lang-name">${escapeHtml(repo.language)}</span>
      </span>`
    : '';

  const folderDisplay = initialFolder
    ? `<span class="repo-tile__folder-pill" data-role="folder-pill" style="--folder-color: ${initialFolder.color || '#0071e3'}" title="Folder: ${escapeHtml(initialFolder.name)}">
        <span class="folder-dot" style="background-color: ${initialFolder.color || '#0071e3'}"></span>
        <span class="folder-name">${escapeHtml(initialFolder.name)}</span>
      </span>`
    : `<span class="repo-tile__folder-pill" data-role="folder-pill" hidden>
        <span class="folder-dot"></span>
        <span class="folder-name"></span>
      </span>`;

  let kindBadge = '';
  if (repo.isFork) {
    if (repo.looksUntouched) {
      kindBadge = `<span class="badge badge--tile-untouched" title="Untouched fork">Untouched</span>`;
    } else {
      kindBadge = `<span class="badge badge--tile-fork" title="Forked repository">Fork</span>`;
    }
  }

  const visBadge = repo.isPrivate
    ? `<span class="badge badge--tile-private" title="Private repository">
        <svg class="badge__icon" viewBox="0 0 16 16" fill="currentColor">
          <path d="M4 4a4 4 0 0 1 8 0v2h.25c.966 0 1.75.784 1.75 1.75v5.5A1.75 1.75 0 0 1 12.25 15h-8.5A1.75 1.75 0 0 1 2 13.25v-5.5C2 6.784 2.784 6 3.75 6H4V4Zm1.5 2h5V4a2.5 2.5 0 0 0-5 0v2Z"/>
        </svg>Private
      </span>`
    : `<span class="badge badge--tile-public" title="Public repository">
        <svg class="badge__icon" viewBox="0 0 16 16" fill="currentColor">
          <path d="M8 0a8 8 0 1 0 0 16A8 8 0 0 0 8 0ZM1.5 8a6.5 6.5 0 0 1 1.05-3.522l3.415 3.415a.75.75 0 0 0 1.06 0l1.5-1.5a.75.75 0 0 0 0-1.06L6.106 2.915A6.47 6.47 0 0 1 8 1.5c1.47 0 2.82.49 3.9 1.314l-1.65 1.65a.75.75 0 0 0 0 1.06l1 1a.75.75 0 0 0 1.06 0l1.83-1.83A6.47 6.47 0 0 1 14.5 8c0 3.19-2.31 5.84-5.34 6.37l-1.3-2.6a.75.75 0 0 0-.82-.39l-2.04.51a.75.75 0 0 0-.55.63l-.22 1.74A6.51 6.51 0 0 1 1.5 8Z"/>
        </svg>Public
      </span>`;

  const initialStatus = initialAiEntry?.status || 'no-key';
  const descText = initialAiEntry?.text || repo.description || 'No description provided.';
  const isAiText = Boolean(initialAiEntry?.text);

  tile.innerHTML = `
    <div class="repo-tile__header">
      <div class="repo-tile__header-left">
        <label class="repo-tile__select-label" title="Select repository">
          <input type="checkbox" class="repo-checkbox" aria-label="Select ${escapeHtml(repo.name)}" />
        </label>
        <span class="repo-tile__status" data-role="status" data-status="${initialStatus}" title="${getStatusTitle(initialStatus)}" aria-label="AI Status"></span>
        ${visBadge}
        ${kindBadge}
      </div>
      <div class="repo-tile__header-right">
        ${folderDisplay}
        ${langDisplay}
        <button
          type="button"
          class="repo-tile__pin-btn ${repo.isPinned ? 'is-pinned' : ''}"
          title="${repo.isPinned ? 'Unpin repository' : 'Pin repository'}"
          aria-label="Pin repository"
        >
          <svg viewBox="0 0 16 16" fill="currentColor">
            <path d="M9.828.722a.5.5 0 0 1 .354.146l4.95 4.95a.5.5 0 0 1 0 .707c-.48.48-1.072.588-1.503.588-.177 0-.335-.018-.46-.039l-2.46 2.46c.02.125.039.283.039.46 0 .43-.108 1.022-.588 1.503a.5.5 0 0 1-.707 0L7.843 9.927 4.136 13.634a.5.5 0 0 1-.707 0l-.354-.354a.5.5 0 0 1 0-.707l3.707-3.707-1.57-1.57a.5.5 0 0 1 0-.707c.48-.48 1.072-.588 1.503-.588.177 0 .335.018.46.039l2.46-2.46c-.02-.125-.039-.283-.039-.46 0-.43.108-1.022.588-1.503a.5.5 0 0 1 .354-.146Z"/>
          </svg>
        </button>
      </div>
    </div>

    <div class="repo-tile__body">
      <div class="repo-tile__title-row">
        <h3 class="repo-tile__name" title="${escapeHtml(repo.name)}">
          ${escapeHtml(repo.name)}
        </h3>
        <a href="${repo.url}" target="_blank" rel="noopener" class="repo-tile__ext-link" title="Open repository on GitHub" tabindex="-1">
          <svg viewBox="0 0 16 16" fill="currentColor">
            <path d="M3.75 2h3.5a.75.75 0 0 1 0 1.5h-3.5a.25.25 0 0 0-.25.25v8.5c0 .138.112.25.25.25h8.5a.25.25 0 0 0 .25-.25v-3.5a.75.75 0 0 1 1.5 0v3.5A1.75 1.75 0 0 1 12.25 14h-8.5A1.75 1.75 0 0 1 2 12.25v-8.5C2 2.784 2.784 2 3.75 2Zm6.75.75a.75.75 0 0 1 .75-.75h3.5a.75.75 0 0 1 .75.75v3.5a.75.75 0 0 1-1.5 0V3.56l-4.22 4.22a.749.749 0 0 1-1.275-.326.749.749 0 0 1 .215-.734L13.44 2.5H10.5a.75.75 0 0 1-.75-.75Z"/>
          </svg>
        </a>
      </div>

      ${renderForkCalloutHtml(repo)}

      <div class="repo-tile__desc-box ${isAiText ? 'repo-tile__desc-box--ai' : ''}" data-role="desc-box">
        <p class="repo-tile__desc" data-role="desc">
          ${isAiText ? '<span class="tile-sparkle-icon">✦ AI: </span>' : ''}${escapeHtml(descText)}
        </p>
      </div>
    </div>

    <div class="repo-tile__footer">
      <div class="repo-tile__metrics">
        ${renderTileStarsHtml(repo)}

        ${
          repo.forksCount != null && repo.forksCount > 0
            ? `<span class="repo-tile__pill" title="${formatNumber(repo.forksCount)} forks">
                <svg class="repo-tile__pill-icon" viewBox="0 0 16 16" fill="currentColor">
                  <path d="M5 3.25a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0Zm0 2.122a2.25 2.25 0 1 0-1.5 0v.878A2.25 2.25 0 0 0 5.75 8.5h4.5A2.25 2.25 0 0 0 12.5 6.25v-.878a2.25 2.25 0 1 0-1.5 0v.878a.75.75 0 0 1-.75.75h-4.5A.75.75 0 0 1 5 6.25v-.878ZM12.5 3.25a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0ZM8 12.75a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0Zm0 2.122a2.25 2.25 0 1 0-1.5 0V11a.75.75 0 0 1 .75-.75h.001A.75.75 0 0 1 8 11v3.872Z"/>
                </svg>
                <span>${formatNumber(repo.forksCount)}</span>
              </span>`
            : ''
        }

        <span class="repo-tile__pill repo-tile__pill--time" title="Updated ${new Date(repo.updatedAt).toLocaleString()}">
          ${timeAgo(repo.updatedAt)}
        </span>
      </div>

      <div class="repo-tile__actions">
        <a href="vscode://vscode.git/clone?url=${encodeURIComponent(repo.cloneUrl || repo.url + '.git')}" class="repo-tile__action-btn btn-tile-vscode" title="Open in VS Code" aria-label="Open in VS Code" target="_blank" rel="noopener">
          <svg viewBox="0 0 16 16" fill="currentColor">
            <path d="M14.5 2.5a.5.5 0 0 0-.25-.433l-3-1.732a.5.5 0 0 0-.583.076L6.5 4.3 3.65 1.84a.5.5 0 0 0-.64.01L1.24 3.32a.5.5 0 0 0-.09.68L3.8 7.5 1.15 11.04a.5.5 0 0 0 .09.68l1.77 1.47a.5.5 0 0 0 .64.01L6.5 10.7l4.167 3.889a.5.5 0 0 0 .583.076l3-1.732a.5.5 0 0 0 .25-.433V2.5ZM11 4.232l2-1.155v9.846l-2-1.155V4.232Z"/>
          </svg>
        </a>
        <a href="https://github.dev/${escapeHtml(repo.fullName)}" class="repo-tile__action-btn btn-tile-githubdev" title="Open in github.dev" aria-label="Open in github.dev" target="_blank" rel="noopener">
          <svg viewBox="0 0 16 16" fill="currentColor">
            <path d="M4 1.75C4 .784 4.784 0 5.75 0h5.586a1.75 1.75 0 0 1 1.237.513l2.914 2.914c.328.328.513.774.513 1.237v8.586A1.75 1.75 0 0 1 14.25 15h-8.5A1.75 1.75 0 0 1 4 13.25V1.75Zm1.75-.25a.25.25 0 0 0-.25.25v11.5c0 .138.112.25.25.25h8.5a.25.25 0 0 0 .25-.25V5h-2.75A1.75 1.75 0 0 1 10 3.25V1.5H5.75Zm5.75 1.75v-.69L13.69 5H11.75a.25.25 0 0 1-.25-.25ZM2.25 3A1.75 1.75 0 0 0 .5 4.75v9.5C.5 15.216 1.284 16 2.25 16h8.5A1.75 1.75 0 0 0 12.5 14.25v-.5a.75.75 0 0 0-1.5 0v.5a.25.25 0 0 1-.25.25h-8.5a.25.25 0 0 1-.25-.25v-9.5a.25.25 0 0 1 .25-.25h.5a.75.75 0 0 0 0-1.5h-.5Z"/>
          </svg>
        </a>
        <button type="button" class="repo-tile__action-btn btn-tile-copy" title="Copy clone URL" aria-label="Copy clone URL" data-clone="${escapeHtml(repo.cloneUrl || repo.url + '.git')}">
          <svg viewBox="0 0 16 16" fill="currentColor">
            <path d="M0 6.75C0 5.784.784 5 1.75 5h1.5a.75.75 0 0 1 0 1.5h-1.5a.25.25 0 0 0-.25.25v7.5c0 .138.112.25.25.25h7.5a.25.25 0 0 0 .25-.25v-1.5a.75.75 0 0 1 1.5 0v1.5A1.75 1.75 0 0 1 9.25 16h-7.5A1.75 1.75 0 0 1 0 14.25Z"/>
            <path d="M5 1.75C5 .784 5.784 0 6.75 0h7.5C15.216 0 16 .784 16 1.75v7.5A1.75 1.75 0 0 1 14.25 11h-7.5A1.75 1.75 0 0 1 5 9.25Zm1.75-.25a.25.25 0 0 0-.25.25v7.5c0 .138.112.25.25.25h7.5a.25.25 0 0 0 .25-.25v-7.5a.25.25 0 0 0-.25-.25Z"/>
          </svg>
        </button>
      </div>
    </div>
  `;

  const checkbox = tile.querySelector('.repo-checkbox');
  checkbox?.addEventListener('change', (e) => {
    e.stopPropagation();
    if (onToggleSelect) onToggleSelect(repo.id, checkbox.checked);
  });

  tile.updateBatchSelected = (isSelected) => {
    tile.classList.toggle('is-batch-selected', isSelected);
    if (checkbox) checkbox.checked = isSelected;
  };

  // Selection handler
  tile.addEventListener('click', (e) => {
    if (
      e.target.closest('.btn-tile-copy') ||
      e.target.closest('.btn-tile-vscode') ||
      e.target.closest('.btn-tile-githubdev') ||
      e.target.closest('.repo-tile__ext-link') ||
      e.target.closest('.repo-tile__pin-btn') ||
      e.target.closest('.repo-tile__select-label') ||
      e.target.closest('.repo-checkbox')
    ) {
      return;
    }
    if (tile.closest('.is-select-mode')) {
      if (checkbox) {
        checkbox.checked = !checkbox.checked;
        if (onToggleSelect) onToggleSelect(repo.id, checkbox.checked);
      }
      return;
    }
    if (onSelect) onSelect(repo.id);
  });

  // Double click opens repo on GitHub
  tile.addEventListener('dblclick', () => {
    window.open(repo.url, '_blank', 'noopener');
  });

  // Enter opens repo
  tile.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      window.open(repo.url, '_blank', 'noopener');
    }
  });

  // Copy clone URL button
  const copyBtn = tile.querySelector('.btn-tile-copy');
  if (copyBtn) {
    copyBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const cloneUrl = copyBtn.dataset.clone;
      try {
        await navigator.clipboard.writeText(cloneUrl);
        copyBtn.classList.add('is-copied');
        copyBtn.title = 'Copied!';
        setTimeout(() => {
          copyBtn.classList.remove('is-copied');
          copyBtn.title = 'Copy clone URL';
        }, 1600);
      } catch {
        window.prompt('Copy clone URL:', cloneUrl);
      }
    });
  }

  // Pin button handler
  const pinBtn = tile.querySelector('.repo-tile__pin-btn');
  if (pinBtn) {
    pinBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (onTogglePin) onTogglePin(repo.id);
    });
  }

  // Public methods to update in place
  tile.updatePin = (isPinned) => {
    repo.isPinned = isPinned;
    tile.classList.toggle('repo-tile--pinned', isPinned);
    if (pinBtn) {
      pinBtn.classList.toggle('is-pinned', isPinned);
      pinBtn.title = isPinned ? 'Unpin repository' : 'Pin repository';
    }
  };

  tile.updateFolder = (folder) => {
    repo.folderId = folder ? folder.id : null;
    const folderPill = tile.querySelector('[data-role="folder-pill"]');
    if (folderPill) {
      if (folder) {
        folderPill.style.setProperty('--folder-color', folder.color || '#0071e3');
        const dotEl = folderPill.querySelector('.folder-dot');
        const nameEl = folderPill.querySelector('.folder-name');
        if (dotEl) dotEl.style.backgroundColor = folder.color || '#0071e3';
        if (nameEl) nameEl.textContent = folder.name;
        folderPill.title = `Folder: ${folder.name}`;
        folderPill.hidden = false;
      } else {
        folderPill.hidden = true;
      }
    }
  };

  tile.updateStars = () => {
    const starContainer = tile.querySelector('.repo-tile__pill--stars');
    if (starContainer) {
      starContainer.outerHTML = renderTileStarsHtml(repo);
    }
    const forkCallout = tile.querySelector('.repo-tile__fork-chip');
    if (forkCallout) {
      forkCallout.outerHTML = renderForkCalloutHtml(repo);
    }
  };

  tile.updateRepoData = (freshRepo) => {
    repo.stars = freshRepo.stars;
    repo.forksCount = freshRepo.forksCount;
    repo.openIssues = freshRepo.openIssues;
    repo.updatedAt = freshRepo.updatedAt;
    repo.pushed_at = freshRepo.pushed_at;
    repo.description = freshRepo.description;
    repo.language = freshRepo.language;
    repo.looksUntouched = freshRepo.looksUntouched;

    tile.updateStars();
    const updatedEl = tile.querySelector('.repo-tile__pill--time');
    if (updatedEl) {
      updatedEl.textContent = timeAgo(repo.updatedAt);
      updatedEl.title = `Updated ${new Date(repo.updatedAt).toLocaleString()}`;
    }
  };

  tile.updateAi = (entry) => {
    const statusEl = tile.querySelector('[data-role="status"]');
    if (statusEl) {
      statusEl.dataset.status = entry.status;
      statusEl.title = getStatusTitle(entry.status);
    }

    const descBox = tile.querySelector('[data-role="desc-box"]');
    const descEl = tile.querySelector('[data-role="desc"]');
    if (descEl && entry.text) {
      descBox?.classList.add('repo-tile__desc-box--ai');
      descEl.innerHTML = `<span class="tile-sparkle-icon">✦ AI: </span>${escapeHtml(entry.text)}`;
    }
  };

  tile.setSelected = (isSelected) => {
    tile.classList.toggle('repo-tile--selected', isSelected);
  };

  return tile;
}

function renderTileStarsHtml(repo) {
  const hasUpstream = repo.isFork && repo.parentStars != null;
  const count = hasUpstream ? repo.parentStars : repo.stars;
  const title = hasUpstream
    ? `${repo.stars} stars on your fork · ${repo.parentStars.toLocaleString()} stars on upstream (${escapeHtml(repo.parent?.fullName || 'upstream')})`
    : (repo.isFork ? `${repo.stars} stars (fork)` : `${repo.stars} stars`);

  return `
    <span class="repo-tile__pill repo-tile__pill--stars ${hasUpstream ? 'repo-tile__pill--upstream' : ''}" title="${title}">
      <svg class="star-icon ${hasUpstream ? 'star-icon--upstream' : ''}" viewBox="0 0 16 16" fill="currentColor">
        <path d="M8 .25a.75.75 0 0 1 .673.418l1.882 3.815 4.21.612a.75.75 0 0 1 .416 1.279l-3.046 2.97.719 4.192a.75.75 0 0 1-1.088.791L8 12.347l-3.766 1.98a.75.75 0 0 1-1.088-.79l.72-4.194L.818 6.374a.75.75 0 0 1 .416-1.28l4.21-.611L7.327.668A.75.75 0 0 1 8 .25Z"/>
      </svg>
      <span>${formatNumber(count)}</span>
      ${hasUpstream ? '<span class="stars-sublabel">up</span>' : ''}
    </span>
  `;
}

function renderForkCalloutHtml(repo) {
  if (!repo.isFork || !repo.parent) return '';
  return `
    <div class="repo-tile__fork-chip" title="Forked from ${escapeHtml(repo.parent.fullName)}">
      <svg viewBox="0 0 16 16" fill="currentColor">
        <path d="M5 3.25a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0Zm0 2.122a2.25 2.25 0 1 0-1.5 0v.878A2.25 2.25 0 0 0 5.75 8.5h4.5A2.25 2.25 0 0 0 12.5 6.25v-.878a2.25 2.25 0 1 0-1.5 0v.878a.75.75 0 0 1-.75.75h-4.5A.75.75 0 0 1 5 6.25v-.878ZM12.5 3.25a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0ZM8 12.75a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0Zm0 2.122a2.25 2.25 0 1 0-1.5 0V11a.75.75 0 0 1 .75-.75h.001A.75.75 0 0 1 8 11v3.872Z"/>
      </svg>
      <span>Forked from <strong>${escapeHtml(repo.parent.fullName)}</strong></span>
    </div>
  `;
}

function getStatusTitle(status) {
  const map = {
    'no-key': 'AI summary: API key not set in Settings',
    'pending': 'AI summary: Generating...',
    'ready': 'AI summary: Ready',
    'error': 'AI summary: Generation failed',
  };
  return map[status] || status;
}
