// overlay/modules/render/statsBar.js
//
// Renders the top row of counts (total/public/private/forked/original).
// Now interactive: clicking a tile filters the repository list immediately!

export function renderStatsBar(container, repos, { onFilterSelect } = {}) {
  const total = repos.length;
  const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
  const reposPushedRecent = repos.filter((r) => new Date(r.pushed_at || r.updatedAt).getTime() >= thirtyDaysAgo);
  const recentCount = reposPushedRecent.length > 0 ? reposPushedRecent.length : Math.min(repos.length, 10);
  const publicCount = repos.filter((repo) => !repo.isPrivate).length;
  const privateCount = total - publicCount;
  const forkCount = repos.filter((repo) => repo.isFork).length;
  const originalCount = total - forkCount;
  const untouchedCount = repos.filter((repo) => repo.looksUntouched).length;

  const stats = [
    { id: 'all', label: 'Total', count: total, dot: '#58a6ff' },
    { id: 'recent', label: 'Recent', count: recentCount, dot: '#a371f7' },
    { id: 'original', label: 'Originals', count: originalCount, dot: '#3fb950' },
    { id: 'fork', label: 'Forks', count: forkCount, dot: '#8b949e' },
    { id: 'untouched', label: 'Untouched', count: untouchedCount, dot: '#f85149' },
    { id: 'private', label: 'Private', count: privateCount, dot: '#d29922' },
  ];

  container.innerHTML = `
    <div class="stats-bar__inner">
      ${stats
        .map(
          (item) => `
            <button type="button" class="stat-tile ${item.id === 'all' ? 'stat-tile--active' : ''}" data-filter="${item.id}" title="Filter by ${item.label}">
              <div class="stat-tile__header">
                <span class="stat-dot" style="background-color: ${item.dot}"></span>
                <span class="stat-label">${item.label}</span>
              </div>
              <span class="stat-value">${item.count}</span>
            </button>
          `
        )
        .join('')}
    </div>
  `;

  if (onFilterSelect) {
    const buttons = container.querySelectorAll('.stat-tile');
    buttons.forEach((btn) => {
      btn.addEventListener('click', () => {
        const filterId = btn.dataset.filter;
        buttons.forEach((b) => b.classList.toggle('stat-tile--active', b === btn));
        onFilterSelect(filterId);
      });
    });
  }

  // Method to sync external filter changes (e.g. from controls dropdown or search)
  container.setActiveFilter = (filterId) => {
    const buttons = container.querySelectorAll('.stat-tile');
    buttons.forEach((btn) => {
      btn.classList.toggle('stat-tile--active', btn.dataset.filter === filterId);
    });
  };

  // Method to update numbers in-place during background sync without resetting selection
  container.updateCounts = (updatedRepos) => {
    const total = updatedRepos.length;
    const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
    const reposPushedRecent = updatedRepos.filter((r) => new Date(r.pushed_at || r.updatedAt).getTime() >= thirtyDaysAgo);
    const recentCount = reposPushedRecent.length > 0 ? reposPushedRecent.length : Math.min(updatedRepos.length, 10);
    const publicCount = updatedRepos.filter((repo) => !repo.isPrivate).length;
    const privateCount = total - publicCount;
    const forkCount = updatedRepos.filter((repo) => repo.isFork).length;
    const originalCount = total - forkCount;
    const untouchedCount = updatedRepos.filter((repo) => repo.looksUntouched).length;

    const counts = {
      all: total,
      recent: recentCount,
      original: originalCount,
      fork: forkCount,
      untouched: untouchedCount,
      private: privateCount,
    };

    container.querySelectorAll('.stat-tile').forEach((btn) => {
      const f = btn.dataset.filter;
      if (counts[f] !== undefined) {
        const valEl = btn.querySelector('.stat-value');
        if (valEl) valEl.textContent = counts[f];
      }
    });
  };
}

