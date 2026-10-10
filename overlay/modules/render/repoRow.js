// overlay/modules/render/repoRow.js
//
// Builds one row in the dense repo list (a ledger-style row, not a card)
// and lets its status dot be updated as an AI description moves through
// pending -> ready/error.

import { escapeHtml, timeAgo, formatNumber, getLanguageColor } from '../format.js';

export function createRepoRow(repo, { onSelect, onTogglePin, onToggleSelect, initialFolder } = {}) {
  const row = document.createElement('button');
  row.type = 'button';
  row.className = `repo-row ${repo.isPinned ? 'repo-row--pinned' : ''}`;
  row.dataset.repoId = repo.id;
  row.dataset.kind = repo.isFork ? (repo.looksUntouched ? 'untouched' : 'fork') : 'original';

  const langColor = repo.language ? getLanguageColor(repo.language) : null;
  const langDisplay = repo.language
    ? `<span class="repo-row__lang-dot" style="background-color: ${langColor}"></span><span class="repo-row__lang-name">${escapeHtml(repo.language)}</span>`
    : `<span class="repo-row__lang-empty">—</span>`;

  const folderDisplay = initialFolder
    ? `<span class="badge repo-row__folder-pill" data-role="folder-pill" style="--folder-color: ${initialFolder.color || '#0071e3'}" title="Folder: ${escapeHtml(initialFolder.name)}">
        <span class="folder-dot" style="background-color: ${initialFolder.color || '#0071e3'}"></span>
        <span class="folder-name">${escapeHtml(initialFolder.name)}</span>
      </span>`
    : `<span class="badge repo-row__folder-pill" data-role="folder-pill" hidden>
        <span class="folder-dot"></span>
        <span class="folder-name"></span>
      </span>`;

  let kindBadge = '';
  if (repo.isFork) {
    if (repo.looksUntouched) {
      kindBadge = `<span class="badge badge--untouched" title="Untouched fork">Untouched</span>`;
    } else {
      kindBadge = `<span class="badge badge--fork" title="Forked repository">Fork</span>`;
    }
  }

  const visBadge = repo.isPrivate
    ? `<span class="badge badge--private" title="Private repo"><svg class="badge__icon" viewBox="0 0 16 16" fill="currentColor"><path d="M4 4a4 4 0 0 1 8 0v2h.25c.966 0 1.75.784 1.75 1.75v5.5A1.75 1.75 0 0 1 12.25 15h-8.5A1.75 1.75 0 0 1 2 13.25v-5.5C2 6.784 2.784 6 3.75 6H4V4Zm1.5 2h5V4a2.5 2.5 0 0 0-5 0v2Z"/></svg>Private</span>`
    : `<span class="badge badge--public">Public</span>`;

  row.innerHTML = `
    <label class="repo-row__select-label" title="Select repository">
      <input type="checkbox" class="repo-checkbox" aria-label="Select ${escapeHtml(repo.name)}" />
    </label>
    <span class="repo-row__status" data-role="status" data-status="no-key" title="AI summary: not configured" aria-label="AI summary status"></span>
    <span class="repo-row__name-cell">
      <button
        type="button"
        class="repo-row__pin-btn ${repo.isPinned ? 'is-pinned' : ''}"
        title="${repo.isPinned ? 'Unpin repository' : 'Pin repository'}"
        aria-label="Pin repository"
      >
        <svg viewBox="0 0 16 16" fill="currentColor">
          <path d="M9.828.722a.5.5 0 0 1 .354.146l4.95 4.95a.5.5 0 0 1 0 .707c-.48.48-1.072.588-1.503.588-.177 0-.335-.018-.46-.039l-2.46 2.46c.02.125.039.283.039.46 0 .43-.108 1.022-.588 1.503a.5.5 0 0 1-.707 0L7.843 9.927 4.136 13.634a.5.5 0 0 1-.707 0l-.354-.354a.5.5 0 0 1 0-.707l3.707-3.707-1.57-1.57a.5.5 0 0 1 0-.707c.48-.48 1.072-.588 1.503-.588.177 0 .335.018.46.039l2.46-2.46c-.02-.125-.039-.283-.039-.46 0-.43.108-1.022.588-1.503a.5.5 0 0 1 .354-.146Z"/>
        </svg>
      </button>
      <span class="repo-row__name">${escapeHtml(repo.name)}</span>
      ${repo.description ? `<span class="repo-row__snippet">${escapeHtml(repo.description)}</span>` : ''}
    </span>
    <span class="repo-row__lang">${langDisplay}</span>
    ${renderStarsHtml(repo)}
    <span class="repo-row__updated" title="Updated ${new Date(repo.updatedAt).toLocaleString()}">${timeAgo(repo.updatedAt)}</span>
    <span class="repo-row__badges">
      ${folderDisplay}
      ${visBadge}
      ${kindBadge}
    </span>
  `;

  const checkbox = row.querySelector('.repo-checkbox');
  checkbox?.addEventListener('change', (e) => {
    e.stopPropagation();
    if (onToggleSelect) onToggleSelect(repo.id, checkbox.checked);
  });

  row.updateBatchSelected = (isSelected) => {
    row.classList.toggle('is-batch-selected', isSelected);
    if (checkbox) checkbox.checked = isSelected;
  };

  const pinBtn = row.querySelector('.repo-row__pin-btn');
  pinBtn?.addEventListener('click', (e) => {
    e.stopPropagation();
    if (onTogglePin) onTogglePin(repo.id);
  });

  row.updatePin = (isPinned) => {
    repo.isPinned = isPinned;
    row.classList.toggle('repo-row--pinned', isPinned);
    if (pinBtn) {
      pinBtn.classList.toggle('is-pinned', isPinned);
      pinBtn.title = isPinned ? 'Unpin repository' : 'Pin repository';
    }
  };

  row.updateFolder = (folder) => {
    repo.folderId = folder ? folder.id : null;
    const folderPill = row.querySelector('[data-role="folder-pill"]');
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

  row.updateStars = () => {
    const starContainer = row.querySelector('.repo-row__stars');
    if (starContainer) {
      starContainer.outerHTML = renderStarsHtml(repo);
    }
  };

  row.updateRepoData = (freshRepo) => {
    repo.stars = freshRepo.stars;
    repo.forksCount = freshRepo.forksCount;
    repo.openIssues = freshRepo.openIssues;
    repo.updatedAt = freshRepo.updatedAt;
    repo.pushed_at = freshRepo.pushed_at;
    repo.description = freshRepo.description;
    repo.language = freshRepo.language;
    repo.looksUntouched = freshRepo.looksUntouched;

    row.updateStars();
    const updatedEl = row.querySelector('.repo-row__updated');
    if (updatedEl) {
      updatedEl.textContent = timeAgo(repo.updatedAt);
      updatedEl.title = `Updated ${new Date(repo.updatedAt).toLocaleString()}`;
    }
  };

  row.addEventListener('click', (e) => {
    if (e.target.closest('.repo-row__pin-btn') || e.target.closest('.repo-row__select-label') || e.target.closest('.repo-checkbox')) return;
    if (row.closest('.is-select-mode')) {
      if (checkbox) {
        checkbox.checked = !checkbox.checked;
        if (onToggleSelect) onToggleSelect(repo.id, checkbox.checked);
      }
      return;
    }
    if (onSelect) onSelect(repo.id);
  });
  return row;
}

function renderStarsHtml(repo) {
  const hasUpstream = repo.isFork && repo.parentStars != null;
  const count = hasUpstream ? repo.parentStars : repo.stars;
  const title = hasUpstream
    ? `${repo.stars} stars on your fork · ${repo.parentStars.toLocaleString()} stars on upstream (${escapeHtml(repo.parent?.fullName || 'upstream')})`
    : (repo.isFork ? `${repo.stars} stars (fork)` : `${repo.stars} stars`);

  return `
    <span class="repo-row__stars ${hasUpstream ? 'repo-row__stars--upstream' : ''}" title="${title}">
      <svg class="repo-row__icon star-icon ${hasUpstream ? 'star-icon--upstream' : ''}" viewBox="0 0 16 16" fill="currentColor">
        <path d="M8 .25a.75.75 0 0 1 .673.418l1.882 3.815 4.21.612a.75.75 0 0 1 .416 1.279l-3.046 2.97.719 4.192a.75.75 0 0 1-1.088.791L8 12.347l-3.766 1.98a.75.75 0 0 1-1.088-.79l.72-4.194L.818 6.374a.75.75 0 0 1 .416-1.28l4.21-.611L7.327.668A.75.75 0 0 1 8 .25Z"/>
      </svg>
      <span>${formatNumber(count)}</span>
      ${hasUpstream ? '<span class="stars-sublabel">up</span>' : ''}
    </span>
  `;
}

const STATUS_TITLES = {
  'no-key': 'AI summary: API key not set in Settings',
  'pending': 'AI summary: Generating...',
  'ready': 'AI summary: Ready',
  'error': 'AI summary: Generation failed',
};

/** status: 'no-key' | 'pending' | 'ready' | 'error' */
export function setRowStatus(row, status) {
  if (!row) return;
  const statusEl = row.querySelector('[data-role="status"]');
  if (statusEl) {
    statusEl.dataset.status = status;
    statusEl.title = STATUS_TITLES[status] || status;
  }
}

