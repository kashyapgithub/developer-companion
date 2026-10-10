// overlay/modules/render/commandPalette.js
//
// Spotlight Command Palette (Cmd+K / Ctrl+K).
// Quick launcher for running actions, toggling views and filters,
// and jumping directly to any repository with fuzzy search.

import { escapeHtml } from '../format.js';

export function renderCommandPalette(container, {
  getRepos = () => [],
  onSelectRepo,
  onViewMode,
  onGroupBy,
  onFilter,
  onOpenCommits,
  onOpenTrending,
  onToggleSelectMode,
  onToggleInspector,
  onRefresh,
  onOpenSettings,
  onExportConfig,
  onExportCatalog,
} = {}) {
  container.innerHTML = `
    <div class="cmd-palette-backdrop" id="cmd-palette-backdrop" data-role="cmd-backdrop">
      <div class="cmd-palette" role="dialog" aria-modal="true" aria-label="Command Palette">
        <div class="cmd-palette__header">
          <svg class="cmd-palette__search-icon" viewBox="0 0 16 16" fill="currentColor">
            <path d="M10.68 11.74a6 6 0 0 1-7.922-8.982 6 6 0 0 1 8.982 7.922l3.04 3.04a.749.749 0 0 1-.326 1.275.749.749 0 0 1-.734-.215ZM11.5 7a4.499 4.499 0 1 0-8.997 0A4.499 4.499 0 0 0 11.5 7Z"/>
          </svg>
          <input
            type="text"
            id="cmd-palette-input"
            class="cmd-palette__input"
            placeholder="Type a command or jump to repo…"
            autocomplete="off"
            spellcheck="false"
          />
          <kbd class="cmd-palette__kbd">Esc</kbd>
        </div>
        <div class="cmd-palette__list" id="cmd-palette-list" role="listbox"></div>
        <div class="cmd-palette__footer">
          <span class="cmd-shortcut-hint"><kbd>↑</kbd><kbd>↓</kbd> to navigate</span>
          <span class="cmd-shortcut-hint"><kbd>Enter</kbd> to select</span>
          <span class="cmd-shortcut-hint"><kbd>Esc</kbd> to dismiss</span>
        </div>
      </div>
    </div>
  `;

  const backdrop = container.querySelector('#cmd-palette-backdrop');
  const input = container.querySelector('#cmd-palette-input');
  const list = container.querySelector('#cmd-palette-list');
  let selectedIndex = 0;
  let currentItems = [];

  const STATIC_COMMANDS = [
    {
      id: 'cmd-trending',
      category: 'Navigation',
      title: 'Topic Explorer & Trending Hub',
      shortcut: 'T',
      run: () => onOpenTrending?.(),
    },
    {
      id: 'cmd-commits',
      category: 'Navigation',
      title: 'View Recent Commits Sheet',
      shortcut: 'C',
      run: () => onOpenCommits?.(),
    },
    {
      id: 'cmd-select-mode',
      category: 'Batch Actions',
      title: 'Toggle Batch Multi-Select Mode',
      shortcut: 'M',
      run: () => onToggleSelectMode?.(),
    },
    {
      id: 'cmd-view-tiles',
      category: 'View Mode',
      title: 'Switch to Floor Tiles View',
      shortcut: '⊞',
      run: () => onViewMode?.('tiles'),
    },
    {
      id: 'cmd-view-list',
      category: 'View Mode',
      title: 'Switch to Dense List View',
      shortcut: '≡',
      run: () => onViewMode?.('list'),
    },
    {
      id: 'cmd-inspector',
      category: 'View Mode',
      title: 'Toggle Details Inspector Panel',
      shortcut: 'I',
      run: () => onToggleInspector?.(),
    },
    {
      id: 'cmd-filter-issues',
      category: 'Filter',
      title: 'Filter: Repositories with Open Issues',
      shortcut: 'Issues',
      run: () => onFilter?.('issues'),
    },
    {
      id: 'cmd-filter-recent',
      category: 'Filter',
      title: 'Filter: Recently Edited Repositories',
      shortcut: 'Recent',
      run: () => onFilter?.('recent'),
    },
    {
      id: 'cmd-filter-original',
      category: 'Filter',
      title: 'Filter: Original Repositories Only',
      shortcut: 'Originals',
      run: () => onFilter?.('original'),
    },
    {
      id: 'cmd-filter-fork',
      category: 'Filter',
      title: 'Filter: Forked Repositories Only',
      shortcut: 'Forks',
      run: () => onFilter?.('fork'),
    },
    {
      id: 'cmd-filter-stale',
      category: 'Filter',
      title: 'Filter: Dormant Repositories (>1 yr)',
      shortcut: 'Dormant',
      run: () => onFilter?.('stale'),
    },
    {
      id: 'cmd-filter-all',
      category: 'Filter',
      title: 'Filter: All Repositories',
      shortcut: 'All',
      run: () => onFilter?.('all'),
    },
    {
      id: 'cmd-group-folder',
      category: 'Grouping',
      title: 'Group by Custom Folder',
      shortcut: '',
      run: () => onGroupBy?.('folder'),
    },
    {
      id: 'cmd-group-language',
      category: 'Grouping',
      title: 'Group by Primary Language',
      shortcut: '',
      run: () => onGroupBy?.('language'),
    },
    {
      id: 'cmd-group-type',
      category: 'Grouping',
      title: 'Group by Repository Type',
      shortcut: '',
      run: () => onGroupBy?.('type'),
    },
    {
      id: 'cmd-group-none',
      category: 'Grouping',
      title: 'Remove Grouping (Flat View)',
      shortcut: '',
      run: () => onGroupBy?.('none'),
    },
    {
      id: 'cmd-refresh',
      category: 'Sync',
      title: 'Refresh Repositories Now',
      shortcut: 'Sync',
      run: () => onRefresh?.(),
    },
    {
      id: 'cmd-export-catalog-md',
      category: 'Export',
      title: 'Export Catalog as Markdown Table (.md)',
      shortcut: 'Markdown',
      run: () => onExportCatalog?.('markdown'),
    },
    {
      id: 'cmd-export-catalog-csv',
      category: 'Export',
      title: 'Export Catalog as CSV Spreadsheet (.csv)',
      shortcut: 'CSV',
      run: () => onExportCatalog?.('csv'),
    },
    {
      id: 'cmd-export-catalog-json',
      category: 'Export',
      title: 'Export Catalog as Full JSON Data (.json)',
      shortcut: 'JSON',
      run: () => onExportCatalog?.('json'),
    },
    {
      id: 'cmd-export-config',
      category: 'Settings',
      title: 'Export Organization Configuration (.json)',
      shortcut: 'Backup',
      run: () => onExportConfig?.(),
    },
    {
      id: 'cmd-settings',
      category: 'Settings',
      title: 'Open Settings & Tokens',
      shortcut: '⚙',
      run: () => onOpenSettings?.(),
    },
  ];

  function getFilteredItems(query) {
    const q = query.toLowerCase().trim();
    const repos = getRepos();

    if (!q) {
      return STATIC_COMMANDS.map((cmd) => ({
        type: 'command',
        id: cmd.id,
        category: cmd.category,
        title: cmd.title,
        shortcut: cmd.shortcut,
        run: cmd.run,
      }));
    }

    const matchedCommands = STATIC_COMMANDS.filter(
      (cmd) =>
        cmd.title.toLowerCase().includes(q) ||
        cmd.category.toLowerCase().includes(q)
    ).map((cmd) => ({
      type: 'command',
      id: cmd.id,
      category: cmd.category,
      title: cmd.title,
      shortcut: cmd.shortcut,
      run: cmd.run,
    }));

    const matchedRepos = repos
      .filter(
        (r) =>
          r.name.toLowerCase().includes(q) ||
          (r.description || '').toLowerCase().includes(q) ||
          (r.language || '').toLowerCase().includes(q)
      )
      .slice(0, 15)
      .map((r) => ({
        type: 'repo',
        id: `repo-${r.id}`,
        category: 'Jump to Repository',
        title: r.name,
        subtitle: r.description || (r.language ? `Language: ${r.language}` : 'Repository'),
        badge: r.isPrivate ? 'Private' : (r.isFork ? 'Fork' : 'Public'),
        run: () => onSelectRepo?.(r.id),
      }));

    return [...matchedCommands, ...matchedRepos];
  }

  function renderList() {
    const items = currentItems;
    if (items.length === 0) {
      list.innerHTML = `
        <div class="cmd-palette__empty">
          <span>No matching commands or repositories found</span>
        </div>
      `;
      return;
    }

    let html = '';
    let lastCat = null;

    items.forEach((item, idx) => {
      if (item.category !== lastCat) {
        lastCat = item.category;
        html += `<div class="cmd-palette__section-header">${escapeHtml(lastCat)}</div>`;
      }

      const isSelected = idx === selectedIndex;
      html += `
        <div class="cmd-palette__item ${isSelected ? 'is-selected' : ''}" data-index="${idx}" role="option" aria-selected="${isSelected}">
          <div class="cmd-palette__item-main">
            <span class="cmd-palette__item-title">${escapeHtml(item.title)}</span>
            ${item.subtitle ? `<span class="cmd-palette__item-sub">${escapeHtml(item.subtitle)}</span>` : ''}
          </div>
          ${item.badge ? `<span class="badge cmd-palette__badge">${escapeHtml(item.badge)}</span>` : ''}
          ${item.shortcut ? `<kbd class="cmd-palette__item-shortcut">${escapeHtml(item.shortcut)}</kbd>` : ''}
        </div>
      `;
    });

    list.innerHTML = html;

    const selectedEl = list.querySelector(`.cmd-palette__item[data-index="${selectedIndex}"]`);
    selectedEl?.scrollIntoView({ block: 'nearest' });
  }

  function executeSelectedItem() {
    if (currentItems.length === 0) return;
    const item = currentItems[selectedIndex];
    if (item && item.run) {
      close();
      item.run();
    }
  }

  input.addEventListener('input', () => {
    selectedIndex = 0;
    currentItems = getFilteredItems(input.value);
    renderList();
  });

  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      selectedIndex = (selectedIndex + 1) % Math.max(1, currentItems.length);
      renderList();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      selectedIndex = (selectedIndex - 1 + currentItems.length) % Math.max(1, currentItems.length);
      renderList();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      executeSelectedItem();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      close();
    }
  });

  list.addEventListener('click', (e) => {
    const itemEl = e.target.closest('.cmd-palette__item');
    if (!itemEl) return;
    const idx = parseInt(itemEl.dataset.index, 10);
    if (!isNaN(idx)) {
      selectedIndex = idx;
      executeSelectedItem();
    }
  });

  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop) {
      close();
    }
  });

  function open() {
    selectedIndex = 0;
    input.value = '';
    currentItems = getFilteredItems('');
    renderList();
    backdrop.classList.add('is-open');
    input.focus();
  }

  function close() {
    backdrop.classList.remove('is-open');
  }

  function toggle() {
    if (isOpen()) close();
    else open();
  }

  function isOpen() {
    return backdrop.classList.contains('is-open');
  }

  return { open, close, toggle, isOpen };
}
