// overlay/modules/render/folderBar.js
//
// Renders the horizontal Folder Navigation Bar and the Folder Create/Edit Modal.
// Enables 1-click filtering across folders and pinned repositories.

import { escapeHtml } from '../format.js';
import { createFolder, updateFolder, deleteFolder } from '../storage.js';

const DEFAULT_COLORS = ['#0071e3', '#af52de', '#30d158', '#ffd60a', '#ff453a', '#5ac8fa', '#ff2d55'];

export function renderFolderBar(container, {
  folders = [],
  activeFolderId = 'all',
  totalCount = 0,
  pinnedCount = 0,
  folderCounts = {},
  onSelectFolder,
  onFolderCreated,
  onFolderUpdated,
  onFolderDeleted,
} = {}) {
  let currentFolders = [...folders];
  let currentActiveId = activeFolderId;
  let currentTotal = totalCount;
  let currentPinned = pinnedCount;
  let currentCounts = { ...folderCounts };
  let editingFolderId = null;
  let selectedColor = '#0071e3';

  container.innerHTML = `
    <div class="folder-bar-inner">
      <div class="folder-bar__scroll" role="tablist" aria-label="Repository folders"></div>
    </div>

    <!-- Folder Modal Dialog -->
    <div class="modal-backdrop folder-modal-backdrop" id="folder-modal-backdrop">
      <div class="modal folder-modal" role="dialog" aria-modal="true" aria-labelledby="folder-modal-title">
        <button type="button" class="modal__close" id="btn-close-folder-modal" title="Close (Esc)">✕</button>

        <div class="modal__header">
          <h2 id="folder-modal-title">Create Folder</h2>
          <p class="modal__subtitle">Organize repositories into folders for fast, categorized access.</p>
        </div>

        <form id="folder-form" class="folder-form">
          <div class="form-group">
            <label for="folder-name-input">Folder Name <span class="required">*</span></label>
            <input
              type="text"
              id="folder-name-input"
              name="folderName"
              placeholder="e.g. Work Projects, Side Apps, AI Tools…"
              required
              autocomplete="off"
              spellcheck="false"
              maxlength="40"
            />
          </div>

          <div class="form-group">
            <label>Accent Color</label>
            <div class="folder-color-picker" id="folder-color-picker">
              ${DEFAULT_COLORS.map(
                (color) => `
                  <button type="button" class="color-dot ${color === '#0071e3' ? 'color-dot--active' : ''}" data-color="${color}" style="background-color: ${color}">
                  </button>
                `
              ).join('')}
            </div>
          </div>

          <div class="folder-modal__actions">
            <button type="button" class="btn-secondary btn-delete-folder" id="btn-delete-folder" hidden>
              Delete Folder
            </button>
            <div class="folder-modal__actions-right">
              <button type="button" class="btn-secondary" id="btn-cancel-folder">Cancel</button>
              <button type="submit" class="btn-primary" id="btn-save-folder">Save Folder</button>
            </div>
          </div>
        </form>
      </div>
    </div>
  `;

  const scrollContainer = container.querySelector('.folder-bar__scroll');
  const modalBackdrop = container.querySelector('#folder-modal-backdrop');
  const modalTitle = container.querySelector('#folder-modal-title');
  const folderForm = container.querySelector('#folder-form');
  const nameInput = container.querySelector('#folder-name-input');
  const closeBtn = container.querySelector('#btn-close-folder-modal');
  const cancelBtn = container.querySelector('#btn-cancel-folder');
  const deleteBtn = container.querySelector('#btn-delete-folder');
  const saveBtn = container.querySelector('#btn-save-folder');
  const colorPicker = container.querySelector('#folder-color-picker');

  function renderPills() {
    scrollContainer.innerHTML = `
      <!-- All Repos Pill -->
      <button
        type="button"
        class="folder-pill ${currentActiveId === 'all' ? 'folder-pill--active' : ''}"
        data-folder-id="all"
        title="View all repositories"
      >
        <span class="folder-pill__name">All Repos</span>
        <span class="folder-pill__count">${currentTotal}</span>
      </button>

      <!-- Pinned Repos Pill -->
      <button
        type="button"
        class="folder-pill folder-pill--pinned ${currentActiveId === 'pinned' ? 'folder-pill--active' : ''}"
        data-folder-id="pinned"
        title="View pinned repositories"
      >
        <span class="folder-pill__icon">📌</span>
        <span class="folder-pill__name">Pinned</span>
        <span class="folder-pill__count">${currentPinned}</span>
      </button>

      <!-- Custom Folder Pills -->
      ${currentFolders
        .map((folder) => {
          const count = currentCounts[folder.id] ?? 0;
          const isActive = currentActiveId === folder.id;
          return `
            <div class="folder-pill-wrap">
              <button
                type="button"
                class="folder-pill folder-pill--custom ${isActive ? 'folder-pill--active' : ''}"
                data-folder-id="${folder.id}"
                style="--folder-color: ${folder.color || '#0071e3'}"
                title="Folder: ${escapeHtml(folder.name)} (${count} repos)"
              >
                <span class="folder-dot" style="background-color: ${folder.color || '#0071e3'}"></span>
                <span class="folder-pill__name">${escapeHtml(folder.name)}</span>
                <span class="folder-pill__count">${count}</span>
              </button>
              <button
                type="button"
                class="folder-pill__edit-btn"
                data-edit-folder-id="${folder.id}"
                title="Edit or delete ${escapeHtml(folder.name)}"
                aria-label="Edit folder ${escapeHtml(folder.name)}"
              >
                <svg viewBox="0 0 16 16" fill="currentColor">
                  <path d="M8 9a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3ZM1.5 9a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Zm13 0a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Z"/>
                </svg>
              </button>
            </div>
          `;
        })
        .join('')}

      <!-- New Folder Button -->
      <button type="button" class="folder-pill folder-pill--add" id="btn-new-folder" title="Create a new folder to organize repos">
        <span class="folder-pill__add-plus">+</span>
        <span>New Folder</span>
      </button>
    `;

    // Wire clicks on pills
    scrollContainer.querySelectorAll('.folder-pill').forEach((pill) => {
      if (pill.id === 'btn-new-folder') return;
      pill.addEventListener('click', () => {
        const folderId = pill.dataset.folderId;
        setActiveFolder(folderId);
        if (onSelectFolder) onSelectFolder(folderId);
      });
    });

    // Wire new folder button
    scrollContainer.querySelector('#btn-new-folder')?.addEventListener('click', () => {
      openNewFolderModal();
    });

    // Wire edit folder buttons
    scrollContainer.querySelectorAll('.folder-pill__edit-btn').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const fId = btn.dataset.editFolderId;
        if (fId) openEditFolderModal(fId);
      });
    });
  }

  function setActiveFolder(folderId) {
    currentActiveId = folderId;
    scrollContainer.querySelectorAll('.folder-pill').forEach((pill) => {
      pill.classList.toggle('folder-pill--active', pill.dataset.folderId === folderId);
    });
  }

  function updateCounts({ total, pinned, folderCounts: counts }) {
    if (total !== undefined) currentTotal = total;
    if (pinned !== undefined) currentPinned = pinned;
    if (counts) currentCounts = { ...counts };
    renderPills();
  }

  function setFolders(newFolders) {
    currentFolders = [...newFolders];
    renderPills();
  }

  // Modal Handlers
  function openNewFolderModal() {
    editingFolderId = null;
    modalTitle.textContent = 'Create New Folder';
    saveBtn.textContent = 'Create Folder';
    deleteBtn.hidden = true;
    nameInput.value = '';
    selectedColor = '#0071e3';
    updatePickerUi();
    modalBackdrop.classList.add('modal-backdrop--visible');
    setTimeout(() => nameInput.focus(), 120);
  }

  function openEditFolderModal(folderId) {
    const folder = currentFolders.find((f) => f.id === folderId);
    if (!folder) return;
    editingFolderId = folderId;
    modalTitle.textContent = 'Edit Folder';
    saveBtn.textContent = 'Save Changes';
    deleteBtn.hidden = false;
    nameInput.value = folder.name;
    selectedColor = folder.color || '#0071e3';
    updatePickerUi();
    modalBackdrop.classList.add('modal-backdrop--visible');
    setTimeout(() => nameInput.focus(), 120);
  }

  function closeFolderModal() {
    modalBackdrop.classList.remove('modal-backdrop--visible');
    editingFolderId = null;
  }

  function updatePickerUi() {
    colorPicker.querySelectorAll('.color-dot').forEach((dot) => {
      dot.classList.toggle('color-dot--active', dot.dataset.color === selectedColor);
    });
  }

  // Color Picker Event Listener
  colorPicker.addEventListener('click', (e) => {
    const dot = e.target.closest('.color-dot');
    if (!dot) return;
    selectedColor = dot.dataset.color;
    updatePickerUi();
  });

  // Modal Close Listeners
  closeBtn.addEventListener('click', closeFolderModal);
  cancelBtn.addEventListener('click', closeFolderModal);
  modalBackdrop.addEventListener('click', (e) => {
    if (e.target === modalBackdrop) closeFolderModal();
  });

  // Form Submit (Create or Update)
  folderForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = nameInput.value.trim();
    if (!name) return;

    if (editingFolderId) {
      const updated = await updateFolder(editingFolderId, {
        name,
        color: selectedColor,
      });
      const idx = currentFolders.findIndex((f) => f.id === editingFolderId);
      if (idx >= 0 && updated) {
        currentFolders[idx] = updated;
      }
      closeFolderModal();
      renderPills();
      if (onFolderUpdated) onFolderUpdated(updated);
    } else {
      const newFolder = await createFolder({
        name,
        color: selectedColor,
      });
      currentFolders.push(newFolder);
      closeFolderModal();
      renderPills();
      setActiveFolder(newFolder.id);
      if (onFolderCreated) onFolderCreated(newFolder);
      if (onSelectFolder) onSelectFolder(newFolder.id);
    }
  });

  // Delete Folder
  deleteBtn.addEventListener('click', async () => {
    if (!editingFolderId) return;
    const folder = currentFolders.find((f) => f.id === editingFolderId);
    const folderName = folder ? folder.name : 'this folder';
    if (!window.confirm(`Are you sure you want to delete "${folderName}"? Any repositories in this folder will become unfiled.`)) {
      return;
    }
    const deletedId = editingFolderId;
    await deleteFolder(deletedId);
    currentFolders = currentFolders.filter((f) => f.id !== deletedId);
    if (currentActiveId === deletedId) {
      currentActiveId = 'all';
      if (onSelectFolder) onSelectFolder('all');
    }
    closeFolderModal();
    renderPills();
    if (onFolderDeleted) onFolderDeleted(deletedId);
  });

  renderPills();

  return {
    setActiveFolder,
    updateCounts,
    setFolders,
    openNewFolderModal,
    openEditFolderModal,
  };
}
