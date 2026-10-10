// overlay/modules/render/trendingPanel.js
//
// In-extension Trending & Topic Discovery Hub with Precision Controls:
// 1. Custom Star Range Selector (Min & Max + Presets) to eliminate 80k+ monoliths.
// 2. 1-Click Native GitHub Account Starring directly from discovery cards.
// 3. In-Discovery Quick README Peek slide-over modal without losing state.
// 4. Personalized "For You (Your Stack)" Recommendations Tab.
// 5. Topic Explorer with Language Matrix & Activity Recency filters.
// 6. Strict Apple HIG Obsidian styling & zero emojis outside '📌'.

import { escapeHtml, formatNumber, getLanguageColor } from '../format.js';
import {
  fetchTrendingRepos,
  fetchReposByTopics,
  checkRepoStarred,
  starRepoOnGithub,
  unstarRepoOnGithub,
  fetchFullReadme,
} from '../github-api.js';
import { renderMarkdown } from './markdown.js';
import { getTrendingWhy, generateHeuristicTrendingWhy } from '../ai/trendingWhy.js';
import { getStarredTopics, toggleStarredTopic } from '../storage.js';
import {
  TRENDING_TOPIC_CATEGORIES,
  getAllCuratedTopics,
  findTopicInfo,
  normalizeTopicSlug,
} from '../topics-data.js';

export function renderTrendingPanel(
  container,
  {
    token,
    aiProvider,
    aiApiKey,
    folders = [],
    pinnedRepoIds = [],
    repos = [],
    userStack = { topLanguages: [], topTopics: [], primaryLanguage: '' },
    onTogglePin,
    onAssignFolder,
    onViewRepo,
  } = {}
) {
  // Active navigation tab: 'topics' | 'feed' | 'foryou'
  let activeTab = 'topics';

  // Custom Star Range state
  let starsPreset = 'all'; // 'all' | 'radar' | 'rising' | 'sweet' | 'growth' | 'custom'
  let starsMin = 0;
  let starsMax = 0;

  // Star presets definition
  const STAR_PRESETS = {
    all: { min: 0, max: 0, label: 'All Stars' },
    radar: { min: 50, max: 500, label: '50 – 500 ★' },
    rising: { min: 500, max: 2500, label: '500 – 2.5k ★' },
    sweet: { min: 1000, max: 10000, label: '1k – 10k ★' },
    growth: { min: 2500, max: 25000, label: '2.5k – 25k ★' },
    custom: { min: 0, max: 5000, label: 'Custom' },
  };

  // Topics Explorer state
  let selectedTopics = new Set(['ai-agents', 'model-classifier']);
  let topicSortBy = 'trending';
  let topicTimeframe = 'week';
  let topicLanguage = 'all';
  let topicActivity = 'anytime';
  let topicRepos = [];
  let starredTopics = new Set();
  let topicCatalogExpanded = false;

  // Feed state
  let feedTimeframe = 'week';
  let feedMode = 'breakout';
  let feedFilter = 'all';
  let feedRepos = [];

  // "For You" state
  let forYouRepos = [];
  let forYouTimeframe = 'week';
  let forYouMode = 'breakout';
  let forYouLanguage = userStack.primaryLanguage ? userStack.primaryLanguage.toLowerCase() : 'all';

  // GitHub starred repos cache (full_name -> boolean)
  const starredGithubRepos = new Set();

  let isPanelOpen = false;
  let isLoading = false;
  let pinnedSet = new Set(pinnedRepoIds);

  container.innerHTML = `
    <div class="modal-backdrop trending-modal-backdrop" id="trending-modal-backdrop">
      <div class="modal trending-modal" role="dialog" aria-modal="true" aria-labelledby="trending-modal-title">
        
        <!-- Header -->
        <header class="trending-modal__header">
          <div class="trending-modal__title-wrap">
            <div class="trending-modal__icon-wrap">
              <svg class="trending-title-icon" viewBox="0 0 16 16" fill="currentColor">
                <path d="M1.5 1.75a.75.75 0 0 0-1.5 0v12.5c0 .414.336.75.75.75h14.5a.75.75 0 0 0 0-1.5H1.5V1.75Z"/>
                <path d="M14.03 4.47a.75.75 0 0 0-1.06 0L8.72 8.72 6.53 6.53a.75.75 0 0 0-1.06 0l-3.5 3.5a.75.75 0 1 0 1.06 1.06l2.97-2.97 2.19 2.19a.75.75 0 0 0 1.06 0l4.75-4.75a.75.75 0 0 0 0-1.06Z"/>
              </svg>
            </div>
            <div>
              <h2 id="trending-modal-title" class="trending-modal__title">Discover & Topic Explorer</h2>
              <p class="trending-modal__subtitle">Surface breakout tools, filter by custom star ranges (e.g. 50–5k ★), and explore curated topics.</p>
            </div>
          </div>
          <button type="button" class="modal__close" id="btn-close-trending" title="Close (Esc or T)" aria-label="Close">✕</button>
        </header>

        <!-- Top Navigation Switcher Tabs -->
        <nav class="trending-nav-tabs" role="tablist">
          <button type="button" class="trending-nav-tab ${activeTab === 'topics' ? 'trending-nav-tab--active' : ''}" data-tab="topics">
            <svg viewBox="0 0 16 16" fill="currentColor" class="tab-icon">
              <path d="M1 2.75A1.75 1.75 0 0 1 2.75 1h10.5C14.216 1 15 1.784 15 2.75v10.5A1.75 1.75 0 0 1 13.25 15H2.75A1.75 1.75 0 0 1 1 13.25V2.75Zm1.75-.25a.25.25 0 0 0-.25.25v10.5c0 .138.112.25.25.25h10.5a.25.25 0 0 0 .25-.25V2.75a.25.25 0 0 0-.25-.25H2.75ZM4 4.5h8v1.5H4V4.5Zm0 3h8V9H4V7.5Zm0 3h5V12H4v-1.5Z"/>
            </svg>
            <span>Topic Explorer & Starred Topics</span>
          </button>
          <button type="button" class="trending-nav-tab ${activeTab === 'feed' ? 'trending-nav-tab--active' : ''}" data-tab="feed">
            <svg viewBox="0 0 16 16" fill="currentColor" class="tab-icon">
              <path d="M14.03 4.47a.75.75 0 0 0-1.06 0L8.72 8.72 6.53 6.53a.75.75 0 0 0-1.06 0l-3.5 3.5a.75.75 0 1 0 1.06 1.06l2.97-2.97 2.19 2.19a.75.75 0 0 0 1.06 0l4.75-4.75a.75.75 0 0 0 0-1.06Z"/>
            </svg>
            <span>Trending Feeds</span>
          </button>
          <button type="button" class="trending-nav-tab ${activeTab === 'foryou' ? 'trending-nav-tab--active' : ''}" data-tab="foryou">
            <svg viewBox="0 0 16 16" fill="currentColor" class="tab-icon">
              <path d="M8 0a8 8 0 1 0 0 16A8 8 0 0 0 8 0ZM1.5 8a6.5 6.5 0 1 1 13 0 6.5 6.5 0 0 1-13 0Zm6.28-4.22a.75.75 0 0 0-1.06 1.06L8.94 7H4.75a.75.75 0 0 0 0 1.5h4.19l-2.22 2.16a.75.75 0 1 0 1.06 1.06l3.5-3.41a.75.75 0 0 0 0-1.09l-3.5-3.44Z"/>
            </svg>
            <span>For You (Your Stack)</span>
            ${userStack.primaryLanguage ? `<span class="nav-stack-badge">${escapeHtml(userStack.primaryLanguage)}</span>` : ''}
          </button>
        </nav>

        <!-- Custom Star Range Selector Bar (Universal across Discovery) -->
        <div class="star-range-bar" id="star-range-bar">
          <div class="star-range-label">
            <span class="star-glyph">★</span>
            <span>Star Range:</span>
          </div>

          <div class="star-range-presets" role="group" aria-label="Star Range Presets">
            <button type="button" class="star-range-preset ${starsPreset === 'all' ? 'is-active' : ''}" data-star-preset="all">All Stars</button>
            <button type="button" class="star-range-preset ${starsPreset === 'radar' ? 'is-active' : ''}" data-star-preset="radar" title="Under the radar gems: 50 to 500 stars">50 – 500 ★</button>
            <button type="button" class="star-range-preset ${starsPreset === 'rising' ? 'is-active' : ''}" data-star-preset="rising" title="Rising breakout tools: 500 to 2,500 stars">500 – 2.5k ★</button>
            <button type="button" class="star-range-preset ${starsPreset === 'sweet' ? 'is-active' : ''}" data-star-preset="sweet" title="Sweet spot: 1,000 to 10,000 stars">1k – 10k ★</button>
            <button type="button" class="star-range-preset ${starsPreset === 'growth' ? 'is-active' : ''}" data-star-preset="growth" title="High growth projects: 2,500 to 25,000 stars">2.5k – 25k ★</button>
            <button type="button" class="star-range-preset ${starsPreset === 'custom' ? 'is-active' : ''}" data-star-preset="custom">Custom Range</button>
          </div>

          <div class="star-range-custom-wrap ${starsPreset === 'custom' ? 'is-visible' : ''}" id="star-range-custom-wrap">
            <div class="star-range-inputs">
              <span class="star-range-prefix">Min:</span>
              <input type="number" id="input-star-min" class="star-range-input" min="0" max="1000000" placeholder="0" value="${starsMin > 0 ? starsMin : ''}" />
              <span class="star-range-to">to</span>
              <span class="star-range-prefix">Max:</span>
              <input type="number" id="input-star-max" class="star-range-input" min="0" max="1000000" placeholder="Max" value="${starsMax > 0 ? starsMax : ''}" />
              <button type="button" class="btn-apply-star-range" id="btn-apply-star-range">Apply</button>
            </div>
          </div>
        </div>

        <!-- Section 1: Topic Explorer & Starred Topics -->
        <div class="topic-explorer-section ${activeTab === 'topics' ? '' : 'is-hidden'}" id="topic-explorer-section">
          <!-- Starred Topics Shelf -->
          <div class="starred-topics-bar">
            <div class="starred-topics-label">
              <span class="star-icon">★</span>
              <span>Starred Topics:</span>
            </div>
            <div class="starred-topics-list" id="starred-topics-list">
              <!-- Rendered dynamically -->
            </div>
            <button type="button" class="btn-starred-filter" id="btn-filter-all-starred" title="Filter repos by all starred topics at once">
              Select All Starred
            </button>
          </div>

          <!-- Topic Search & Controls Row -->
          <div class="topic-controls-row">
            <!-- Custom Topic / Search Input -->
            <div class="topic-search-wrap">
              <svg class="topic-search-icon" viewBox="0 0 16 16" fill="currentColor">
                <path d="M10.68 11.74a6 6 0 0 1-7.922-8.982 6 6 0 0 1 8.982 7.922l3.04 3.04a.749.749 0 0 1-.326 1.275.749.749 0 0 1-.734-.215ZM11.5 7a4.499 4.499 0 1 0-8.997 0A4.499 4.499 0 0 0 11.5 7Z"/>
              </svg>
              <input type="search" id="topic-search-input" placeholder="Search or add topics (e.g. ai-agents, model-classifier, rag)…" autocomplete="off" spellcheck="false" />
              <button type="button" class="btn-add-custom-topic" id="btn-add-topic" title="Add topic to active filter">+ Add Topic</button>
            </div>

            <!-- Language Matrix Filter -->
            <div class="topic-select-group">
              <span class="topic-select-label">Language:</span>
              <div class="trending-select-wrap">
                <select id="topic-lang-select" aria-label="Filter by primary language">
                  <option value="all" selected>All Languages</option>
                  <option value="typescript">TypeScript</option>
                  <option value="python">Python</option>
                  <option value="rust">Rust</option>
                  <option value="go">Go</option>
                  <option value="javascript">JavaScript</option>
                  <option value="cpp">C++</option>
                  <option value="swift">Swift</option>
                  <option value="kotlin">Kotlin</option>
                  <option value="zig">Zig</option>
                </select>
                <svg class="select-chevron" viewBox="0 0 16 16" fill="currentColor">
                  <path d="m4.427 6.427 3.396 3.396a.25.25 0 0 0 .354 0l3.396-3.396A.25.25 0 0 0 11.396 6H4.604a.25.25 0 0 0-.177.427Z"/>
                </svg>
              </div>
            </div>

            <!-- Activity Recency Filter -->
            <div class="topic-select-group">
              <span class="topic-select-label">Activity:</span>
              <div class="trending-select-wrap">
                <select id="topic-activity-select" aria-label="Filter by recent commit activity">
                  <option value="anytime" selected>Anytime</option>
                  <option value="week">Active this week</option>
                  <option value="month">Active this month</option>
                  <option value="6months">Active in 6 months</option>
                  <option value="year">Active this year</option>
                </select>
                <svg class="select-chevron" viewBox="0 0 16 16" fill="currentColor">
                  <path d="m4.427 6.427 3.396 3.396a.25.25 0 0 0 .354 0l3.396-3.396A.25.25 0 0 0 11.396 6H4.604a.25.25 0 0 0-.177.427Z"/>
                </svg>
              </div>
            </div>

            <!-- Sort By Selector -->
            <div class="topic-select-group">
              <span class="topic-select-label">Sort:</span>
              <div class="trending-select-wrap">
                <select id="topic-sort-select" aria-label="Sort topic repositories by">
                  <option value="trending" selected>Trending Velocity (+stars/day)</option>
                  <option value="stars">Most Stars</option>
                  <option value="forks">Most Forks</option>
                  <option value="updated">Recently Updated</option>
                </select>
                <svg class="select-chevron" viewBox="0 0 16 16" fill="currentColor">
                  <path d="m4.427 6.427 3.396 3.396a.25.25 0 0 0 .354 0l3.396-3.396A.25.25 0 0 0 11.396 6H4.604a.25.25 0 0 0-.177.427Z"/>
                </svg>
              </div>
            </div>

            <!-- Timeframe Selector (Only for Trending sort) -->
            <div class="topic-timeframe-wrap" id="topic-timeframe-wrap">
              <div class="trending-segmented" role="group" aria-label="Topic Timeframe">
                <button type="button" class="trending-segment ${topicTimeframe === 'today' ? 'trending-segment--active' : ''}" data-topic-timeframe="today">Today</button>
                <button type="button" class="trending-segment ${topicTimeframe === 'week' ? 'trending-segment--active' : ''}" data-topic-timeframe="week">Week</button>
                <button type="button" class="trending-segment ${topicTimeframe === 'month' ? 'trending-segment--active' : ''}" data-topic-timeframe="month">Month</button>
              </div>
            </div>

            <!-- Toggle Curated Directory Button -->
            <button type="button" class="btn-toggle-catalog" id="btn-toggle-catalog" title="Browse full curated topics catalog">
              <span>Trending Topics</span>
              <span class="catalog-badge">50+</span>
            </button>
          </div>

          <!-- Collapsible Curated Trending Topics Directory -->
          <div class="curated-catalog-panel ${topicCatalogExpanded ? 'is-expanded' : ''}" id="curated-catalog-panel">
            <div class="curated-catalog-header">
              <span class="curated-catalog-title">Curated Trending Topics Catalog (Click to select for category filter, ★ to star)</span>
              <button type="button" class="btn-close-catalog" id="btn-close-catalog">Close Catalog</button>
            </div>
            <div class="curated-categories-grid" id="curated-categories-grid">
              <!-- Rendered dynamically -->
            </div>
          </div>

          <!-- Active Categories Filter Banner -->
          <div class="active-topics-bar" id="active-topics-bar">
            <span class="active-topics-label">Filtering Categories:</span>
            <div class="active-topics-chips" id="active-topics-chips">
              <!-- Rendered dynamically -->
            </div>
            <button type="button" class="btn-clear-topics" id="btn-clear-topics" title="Clear all category filters">Clear All</button>
          </div>
        </div>

        <!-- Section 2: Global Trending Feeds Toolbar -->
        <div class="trending-toolbar ${activeTab === 'feed' ? '' : 'is-hidden'}" id="trending-feed-toolbar">
          <div class="trending-toolbar__row">
            <div class="trending-search-wrap">
              <svg class="trending-search-icon" viewBox="0 0 16 16" fill="currentColor">
                <path d="M10.68 11.74a6 6 0 0 1-7.922-8.982 6 6 0 0 1 8.982 7.922l3.04 3.04a.749.749 0 0 1-.326 1.275.749.749 0 0 1-.734-.215ZM11.5 7a4.499 4.499 0 1 0-8.997 0A4.499 4.499 0 0 0 11.5 7Z"/>
              </svg>
              <input type="search" id="trending-search-input" placeholder="Filter trending projects by name, description, or topic…" autocomplete="off" spellcheck="false" />
              <button type="button" class="trending-search-clear" id="trending-search-clear" hidden title="Clear search">✕</button>
            </div>

            <div class="trending-segmented" role="group" aria-label="Timeframe">
              <button type="button" class="trending-segment ${feedTimeframe === 'today' ? 'trending-segment--active' : ''}" data-feed-timeframe="today">Today</button>
              <button type="button" class="trending-segment ${feedTimeframe === 'week' ? 'trending-segment--active' : ''}" data-feed-timeframe="week">This Week</button>
              <button type="button" class="trending-segment ${feedTimeframe === 'month' ? 'trending-segment--active' : ''}" data-feed-timeframe="month">This Month</button>
            </div>

            <div class="trending-segmented" role="group" aria-label="Discovery Mode">
              <button type="button" class="trending-segment ${feedMode === 'breakout' ? 'trending-segment--active' : ''}" data-feed-mode="breakout" title="Brand-new repositories created recently">Breakout Launches</button>
              <button type="button" class="trending-segment ${feedMode === 'surging' ? 'trending-segment--active' : ''}" data-feed-mode="surging" title="Established repositories with high recent momentum">Surging & Active</button>
            </div>

            <button type="button" class="trending-refresh-btn" id="btn-trending-refresh" title="Refresh trending repositories">
              <svg class="icon-refresh" viewBox="0 0 16 16" fill="currentColor">
                <path d="M1.705 8.005a.75.75 0 0 1 .834.656 5.5 5.5 0 0 0 9.592 2.97l-1.204-1.204a.25.25 0 0 1 .177-.427h3.646a.25.25 0 0 1 .25.25v3.646a.25.25 0 0 1-.427.177l-1.38-1.38A7.002 7.002 0 0 1 1.05 8.84a.75.75 0 0 1 .656-.834ZM8 2.5a5.487 5.487 0 0 0-4.131 1.869l1.204 1.204A.25.25 0 0 1 4.896 6H1.25A.25.25 0 0 1 1 5.75V2.104a.25.25 0 0 1 .427-.177l1.38 1.38A7.002 7.002 0 0 1 14.95 7.16a.75.75 0 0 1-1.49.178A5.5 5.5 0 0 0 8 2.5Z"/>
              </svg>
            </button>
          </div>

          <div class="trending-topic-chips" role="tablist" aria-label="Filter by topic or language">
            <button type="button" class="filter-chip filter-chip--active" data-feed-topic="all">All Topics</button>
            <button type="button" class="filter-chip" data-feed-topic="ai">AI & LLMs</button>
            <button type="button" class="filter-chip" data-feed-topic="typescript">TypeScript</button>
            <button type="button" class="filter-chip" data-feed-topic="python">Python</button>
            <button type="button" class="filter-chip" data-feed-topic="rust">Rust</button>
            <button type="button" class="filter-chip" data-feed-topic="go">Go</button>
            <button type="button" class="filter-chip" data-feed-topic="devtools">DevTools</button>
          </div>
        </div>

        <!-- Section 3: "For You (Your Stack)" Personalized Section -->
        <div class="foryou-section ${activeTab === 'foryou' ? '' : 'is-hidden'}" id="foryou-section">
          <div class="foryou-banner">
            <div class="foryou-banner__left">
              <span class="foryou-tag">Personalized Stack</span>
              <h3 class="foryou-title">Emerging Repositories Matching Your Personal Stack</h3>
              <p class="foryou-subtitle">
                Tailored recommendations based on your primary languages:
                <strong>${escapeHtml((userStack.topLanguages || []).slice(0, 4).join(', ') || 'Your Projects')}</strong>
              </p>
            </div>

            <div class="foryou-controls">
              <div class="trending-segmented" role="group" aria-label="For You Discovery Mode">
                <button type="button" class="trending-segment ${forYouMode === 'breakout' ? 'trending-segment--active' : ''}" data-foryou-mode="breakout">Breakout</button>
                <button type="button" class="trending-segment ${forYouMode === 'surging' ? 'trending-segment--active' : ''}" data-foryou-mode="surging">Surging</button>
              </div>

              <div class="trending-segmented" role="group" aria-label="For You Timeframe">
                <button type="button" class="trending-segment ${forYouTimeframe === 'today' ? 'trending-segment--active' : ''}" data-foryou-timeframe="today">Today</button>
                <button type="button" class="trending-segment ${forYouTimeframe === 'week' ? 'trending-segment--active' : ''}" data-foryou-timeframe="week">Week</button>
                <button type="button" class="trending-segment ${forYouTimeframe === 'month' ? 'trending-segment--active' : ''}" data-foryou-timeframe="month">Month</button>
              </div>
            </div>
          </div>

          <!-- Stack Language Pills -->
          <div class="foryou-stack-chips">
            <span class="foryou-stack-label">Focus Language:</span>
            <button type="button" class="filter-chip ${forYouLanguage === 'all' ? 'filter-chip--active' : ''}" data-foryou-lang="all">All Stack</button>
            ${(userStack.topLanguages || [])
              .slice(0, 6)
              .map(
                (lang) =>
                  `<button type="button" class="filter-chip ${forYouLanguage === lang.toLowerCase() ? 'filter-chip--active' : ''}" data-foryou-lang="${escapeHtml(lang.toLowerCase())}">${escapeHtml(lang)}</button>`
              )
              .join('')}
          </div>
        </div>

        <!-- Result Summary Bar -->
        <div class="trending-summary-bar" id="trending-summary-bar">
          <span class="summary-text" id="summary-text">Ready to explore.</span>
          <span class="summary-meta" id="summary-meta"></span>
        </div>

        <!-- Content List -->
        <div class="trending-modal__content" id="trending-content">
          <div class="trending-loading">
            <div class="loading-spinner"></div>
            <p>Loading repositories…</p>
          </div>
        </div>

        <!-- In-Discovery Quick README Peek Slide-Over Sheet -->
        <aside class="trending-readme-peek" id="trending-readme-peek" aria-hidden="true">
          <div class="trending-readme-peek__header">
            <div class="trending-readme-peek__title-wrap">
              <span class="trending-readme-peek__badge">Quick README Peek</span>
              <h3 class="trending-readme-peek__title" id="peek-repo-title">Loading…</h3>
              <div class="trending-readme-peek__meta" id="peek-repo-meta"></div>
            </div>
            <div class="trending-readme-peek__actions">
              <button type="button" class="trending-action-btn trending-action-btn--star" id="peek-btn-star" title="Star on GitHub">
                <span class="star-glyph">★</span>
                <span class="star-text">Star</span>
              </button>
              <a href="#" target="_blank" rel="noopener" class="trending-action-btn trending-action-btn--primary" id="peek-link-github" title="Open on GitHub">
                <span>GitHub</span>
                <svg viewBox="0 0 16 16" fill="currentColor">
                  <path d="M3.75 2h3.5a.75.75 0 0 1 0 1.5h-3.5a.25.25 0 0 0-.25.25v8.5c0 .138.112.25.25.25h8.5a.25.25 0 0 0 .25-.25v-3.5a.75.75 0 0 1 1.5 0v3.5A1.75 1.75 0 0 1 12.25 14h-8.5A1.75 1.75 0 0 1 2 12.25v-8.5C2 2.784 2.784 2 3.75 2Zm6.75.75a.75.75 0 0 1 .75-.75h3.5a.75.75 0 0 1 .75.75v3.5a.75.75 0 0 1-1.5 0V3.56l-4.22 4.22a.749.749 0 0 1-1.275-.326.749.749 0 0 1 .215-.734L13.44 2.5H10.5a.75.75 0 0 1-.75-.75Z"/>
                </svg>
              </a>
              <button type="button" class="trending-readme-peek__close" id="btn-close-peek" title="Close README preview">✕</button>
            </div>
          </div>
          <div class="trending-readme-peek__body" id="peek-body">
            <div class="trending-loading">
              <div class="loading-spinner"></div>
              <p>Fetching documentation…</p>
            </div>
          </div>
        </aside>

        <!-- Floating Toast Notification within Discovery Hub -->
        <div class="trending-toast" id="trending-toast" aria-live="polite"></div>

      </div>
    </div>
  `;

  // Element handles
  const modalBackdrop = container.querySelector('#trending-modal-backdrop');
  const closeBtn = container.querySelector('#btn-close-trending');
  const navTabs = container.querySelectorAll('.trending-nav-tab');
  const topicExplorerSection = container.querySelector('#topic-explorer-section');
  const feedToolbar = container.querySelector('#trending-feed-toolbar');
  const forYouSection = container.querySelector('#foryou-section');
  const summaryText = container.querySelector('#summary-text');
  const summaryMeta = container.querySelector('#summary-meta');
  const contentArea = container.querySelector('#trending-content');
  const discoveryToast = container.querySelector('#trending-toast');

  // Star range elements
  const starPresetBtns = container.querySelectorAll('[data-star-preset]');
  const starRangeCustomWrap = container.querySelector('#star-range-custom-wrap');
  const inputStarMin = container.querySelector('#input-star-min');
  const inputStarMax = container.querySelector('#input-star-max');
  const btnApplyStarRange = container.querySelector('#btn-apply-star-range');

  // Starred shelf & catalog
  const starredListEl = container.querySelector('#starred-topics-list');
  const filterAllStarredBtn = container.querySelector('#btn-filter-all-starred');
  const curatedCatalogPanel = container.querySelector('#curated-catalog-panel');
  const btnToggleCatalog = container.querySelector('#btn-toggle-catalog');
  const btnCloseCatalog = container.querySelector('#btn-close-catalog');
  const curatedCategoriesGrid = container.querySelector('#curated-categories-grid');
  const activeTopicsChips = container.querySelector('#active-topics-chips');
  const btnClearTopics = container.querySelector('#btn-clear-topics');

  // Topic search & controls
  const topicSearchInput = container.querySelector('#topic-search-input');
  const btnAddTopic = container.querySelector('#btn-add-topic');
  const topicLangSelect = container.querySelector('#topic-lang-select');
  const topicActivitySelect = container.querySelector('#topic-activity-select');
  const topicSortSelect = container.querySelector('#topic-sort-select');
  const topicTimeframeWrap = container.querySelector('#topic-timeframe-wrap');
  const topicTimeframeBtns = container.querySelectorAll('[data-topic-timeframe]');

  // Feed controls
  const feedSearchInput = container.querySelector('#trending-search-input');
  const feedSearchClear = container.querySelector('#trending-search-clear');
  const feedRefreshBtn = container.querySelector('#btn-trending-refresh');
  const feedTimeframeBtns = container.querySelectorAll('[data-feed-timeframe]');
  const feedModeBtns = container.querySelectorAll('[data-feed-mode]');
  const feedTopicChips = container.querySelectorAll('[data-feed-topic]');

  // For You controls
  const forYouModeBtns = container.querySelectorAll('[data-foryou-mode]');
  const forYouTimeframeBtns = container.querySelectorAll('[data-foryou-timeframe]');
  const forYouLangChips = container.querySelectorAll('[data-foryou-lang]');

  // Peek README drawer elements
  const peekDrawer = container.querySelector('#trending-readme-peek');
  const btnClosePeek = container.querySelector('#btn-close-peek');
  const peekRepoTitle = container.querySelector('#peek-repo-title');
  const peekRepoMeta = container.querySelector('#peek-repo-meta');
  const peekBody = container.querySelector('#peek-body');
  const peekBtnStar = container.querySelector('#peek-btn-star');
  const peekLinkGithub = container.querySelector('#peek-link-github');
  let currentPeekRepo = null;

  // Initialize starred topics from storage
  getStarredTopics().then((topics) => {
    starredTopics = new Set(topics);
    renderStarredShelf();
    renderCuratedCatalog();
    renderActiveTopicsBar();
  });

  // Seed local starred set from loaded repositories that user owns or stars
  repos.forEach((r) => {
    if (r.stars > 0 && r.fullName) {
      // Optional seed
    }
  });

  function showToast(message, isSuccess = true) {
    if (!discoveryToast) return;
    discoveryToast.textContent = message;
    discoveryToast.className = `trending-toast trending-toast--visible ${isSuccess ? 'trending-toast--success' : 'trending-toast--info'}`;
    clearTimeout(discoveryToast._timer);
    discoveryToast._timer = setTimeout(() => {
      discoveryToast.classList.remove('trending-toast--visible');
    }, 2800);
  }

  function open() {
    isPanelOpen = true;
    modalBackdrop.classList.add('modal-backdrop--visible');
    if (activeTab === 'topics' && topicRepos.length === 0) {
      loadTopicsRepos();
    } else if (activeTab === 'feed' && feedRepos.length === 0) {
      loadFeed();
    } else if (activeTab === 'foryou' && forYouRepos.length === 0) {
      loadForYou();
    }
  }

  function close() {
    isPanelOpen = false;
    modalBackdrop.classList.remove('modal-backdrop--visible');
    closePeekDrawer();
  }

  function isOpen() {
    return isPanelOpen;
  }

  closeBtn.addEventListener('click', close);
  modalBackdrop.addEventListener('click', (e) => {
    if (e.target === modalBackdrop) close();
  });

  // =========================================================================
  // Star Range Presets & Custom Min/Max Controls
  // =========================================================================

  function applyStarRange(presetKey, customMin, customMax) {
    starsPreset = presetKey;
    if (presetKey === 'custom') {
      starsMin = Math.max(0, parseInt(customMin, 10) || 0);
      starsMax = Math.max(0, parseInt(customMax, 10) || 0);
    } else {
      const p = STAR_PRESETS[presetKey] || STAR_PRESETS.all;
      starsMin = p.min;
      starsMax = p.max;
      inputStarMin.value = starsMin > 0 ? starsMin : '';
      inputStarMax.value = starsMax > 0 ? starsMax : '';
    }

    // Update active preset buttons
    starPresetBtns.forEach((btn) => {
      btn.classList.toggle('is-active', btn.dataset.starPreset === starsPreset);
    });

    starRangeCustomWrap.classList.toggle('is-visible', starsPreset === 'custom');

    // Reload active tab
    if (activeTab === 'topics') loadTopicsRepos();
    else if (activeTab === 'feed') loadFeed();
    else if (activeTab === 'foryou') loadForYou();
  }

  starPresetBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      const preset = btn.dataset.starPreset;
      if (preset === 'custom') {
        starsPreset = 'custom';
        starPresetBtns.forEach((b) => b.classList.toggle('is-active', b.dataset.starPreset === 'custom'));
        starRangeCustomWrap.classList.add('is-visible');
        inputStarMin.focus();
      } else {
        applyStarRange(preset);
      }
    });
  });

  btnApplyStarRange?.addEventListener('click', () => {
    applyStarRange('custom', inputStarMin.value, inputStarMax.value);
  });

  [inputStarMin, inputStarMax].forEach((input) => {
    input?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        applyStarRange('custom', inputStarMin.value, inputStarMax.value);
      }
    });
  });

  // =========================================================================
  // Navigation Tabs Switching
  // =========================================================================

  navTabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      const target = tab.dataset.tab;
      if (target === activeTab) return;
      activeTab = target;
      navTabs.forEach((t) => t.classList.toggle('trending-nav-tab--active', t.dataset.tab === activeTab));

      topicExplorerSection.classList.toggle('is-hidden', activeTab !== 'topics');
      feedToolbar.classList.toggle('is-hidden', activeTab !== 'feed');
      forYouSection.classList.toggle('is-hidden', activeTab !== 'foryou');

      if (activeTab === 'topics') {
        if (topicRepos.length === 0) loadTopicsRepos();
        else renderTopicResults();
      } else if (activeTab === 'feed') {
        if (feedRepos.length === 0) loadFeed();
        else renderFeedResults();
      } else if (activeTab === 'foryou') {
        if (forYouRepos.length === 0) loadForYou();
        else renderForYouResults();
      }
    });
  });

  // =========================================================================
  // Topic Explorer Logic
  // =========================================================================

  function renderStarredShelf() {
    if (!starredListEl) return;
    const slugs = Array.from(starredTopics);
    if (slugs.length === 0) {
      starredListEl.innerHTML = `<span class="starred-empty-hint">No starred topics yet. Click ★ on any topic to bookmark.</span>`;
      return;
    }

    starredListEl.innerHTML = slugs
      .map((slug) => {
        const info = findTopicInfo(slug);
        const isSelected = selectedTopics.has(slug);
        return `
          <button type="button" class="starred-topic-pill ${isSelected ? 'is-selected' : ''}" data-slug="${escapeHtml(slug)}">
            <span class="star-glyph">★</span>
            <span class="topic-label">${escapeHtml(info.label)}</span>
          </button>
        `;
      })
      .join('');

    starredListEl.querySelectorAll('.starred-topic-pill').forEach((btn) => {
      btn.addEventListener('click', () => {
        const slug = btn.dataset.slug;
        if (selectedTopics.has(slug)) {
          selectedTopics.delete(slug);
        } else {
          selectedTopics.add(slug);
        }
        renderStarredShelf();
        renderActiveTopicsBar();
        renderCuratedCatalog();
        loadTopicsRepos();
      });
    });
  }

  filterAllStarredBtn?.addEventListener('click', () => {
    if (starredTopics.size === 0) return;
    selectedTopics = new Set(starredTopics);
    renderStarredShelf();
    renderActiveTopicsBar();
    renderCuratedCatalog();
    loadTopicsRepos();
  });

  function renderCuratedCatalog() {
    if (!curatedCategoriesGrid) return;
    curatedCategoriesGrid.innerHTML = TRENDING_TOPIC_CATEGORIES.map((cat) => {
      return `
        <div class="topic-category-card">
          <div class="topic-category-card__head">
            <h4 class="topic-category-title">${escapeHtml(cat.name)}</h4>
            <span class="topic-category-desc">${escapeHtml(cat.description)}</span>
          </div>
          <div class="topic-category-chips">
            ${cat.topics
              .map((t) => {
                const isSelected = selectedTopics.has(t.slug);
                const isStarred = starredTopics.has(t.slug);
                return `
                  <div class="topic-chip ${isSelected ? 'topic-chip--selected' : ''}" data-slug="${escapeHtml(t.slug)}">
                    <span class="topic-chip__label" data-action="toggle-select">${escapeHtml(t.label)}</span>
                    <button type="button" class="topic-chip__star ${isStarred ? 'is-starred' : ''}" data-action="star" title="${isStarred ? 'Unstar topic' : 'Star topic'}">
                      ★
                    </button>
                  </div>
                `;
              })
              .join('')}
          </div>
        </div>
      `;
    }).join('');

    // Wire actions inside catalog
    curatedCategoriesGrid.querySelectorAll('.topic-chip').forEach((chip) => {
      const slug = chip.dataset.slug;
      chip.querySelector('[data-action="toggle-select"]')?.addEventListener('click', () => {
        if (selectedTopics.has(slug)) {
          selectedTopics.delete(slug);
        } else {
          selectedTopics.add(slug);
        }
        renderCuratedCatalog();
        renderActiveTopicsBar();
        renderStarredShelf();
        loadTopicsRepos();
      });

      chip.querySelector('[data-action="star"]')?.addEventListener('click', async (e) => {
        e.stopPropagation();
        const isNowStarred = await toggleStarredTopic(slug);
        if (isNowStarred) starredTopics.add(slug);
        else starredTopics.delete(slug);

        renderCuratedCatalog();
        renderStarredShelf();
      });
    });
  }

  function renderActiveTopicsBar() {
    if (!activeTopicsChips) return;
    const slugs = Array.from(selectedTopics);
    if (slugs.length === 0) {
      activeTopicsChips.innerHTML = `<span class="active-topics-none">None selected (browse topics above or add custom topic)</span>`;
      return;
    }

    activeTopicsChips.innerHTML = slugs
      .map((slug) => {
        const info = findTopicInfo(slug);
        return `
          <span class="active-topic-tag">
            <span>${escapeHtml(info.label)}</span>
            <button type="button" class="btn-remove-topic" data-slug="${escapeHtml(slug)}" title="Remove topic filter">✕</button>
          </span>
        `;
      })
      .join('');

    activeTopicsChips.querySelectorAll('.btn-remove-topic').forEach((btn) => {
      btn.addEventListener('click', () => {
        selectedTopics.delete(btn.dataset.slug);
        renderActiveTopicsBar();
        renderCuratedCatalog();
        renderStarredShelf();
        loadTopicsRepos();
      });
    });
  }

  btnClearTopics?.addEventListener('click', () => {
    selectedTopics.clear();
    renderActiveTopicsBar();
    renderCuratedCatalog();
    renderStarredShelf();
    loadTopicsRepos();
  });

  btnToggleCatalog?.addEventListener('click', () => {
    topicCatalogExpanded = !topicCatalogExpanded;
    curatedCatalogPanel.classList.toggle('is-expanded', topicCatalogExpanded);
  });

  btnCloseCatalog?.addEventListener('click', () => {
    topicCatalogExpanded = false;
    curatedCatalogPanel.classList.remove('is-expanded');
  });

  function handleAddTopicInput() {
    const raw = topicSearchInput.value.trim();
    if (!raw) return;
    const slug = normalizeTopicSlug(raw);
    if (slug) {
      selectedTopics.add(slug);
      topicSearchInput.value = '';
      renderActiveTopicsBar();
      renderCuratedCatalog();
      renderStarredShelf();
      loadTopicsRepos();
    }
  }

  topicSearchInput?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleAddTopicInput();
    }
  });

  btnAddTopic?.addEventListener('click', handleAddTopicInput);

  // Topic Sorters & Quality Thresholds
  topicSortSelect?.addEventListener('change', () => {
    topicSortBy = topicSortSelect.value;
    topicTimeframeWrap.style.display = topicSortBy === 'trending' ? 'inline-flex' : 'none';
    loadTopicsRepos();
  });

  topicLangSelect?.addEventListener('change', () => {
    topicLanguage = topicLangSelect.value;
    loadTopicsRepos();
  });

  topicActivitySelect?.addEventListener('change', () => {
    topicActivity = topicActivitySelect.value;
    loadTopicsRepos();
  });

  topicTimeframeBtns?.forEach((btn) => {
    btn.addEventListener('click', () => {
      topicTimeframeBtns.forEach((b) => b.classList.remove('trending-segment--active'));
      btn.classList.add('trending-segment--active');
      topicTimeframe = btn.dataset.topicTimeframe;
      loadTopicsRepos();
    });
  });

  function getActiveStarRangeDescription() {
    if (starsMin > 0 && starsMax > 0) return `${formatNumber(starsMin)} – ${formatNumber(starsMax)} ★`;
    if (starsMin > 0) return `≥ ${formatNumber(starsMin)} ★`;
    if (starsMax > 0) return `≤ ${formatNumber(starsMax)} ★`;
    return 'All Stars';
  }

  async function loadTopicsRepos() {
    if (!token) {
      renderTokenRequired();
      return;
    }

    const topicsArr = Array.from(selectedTopics);
    if (topicsArr.length === 0) {
      contentArea.innerHTML = `
        <div class="trending-empty">
          <p class="trending-empty__title">Select Topics to Discover Repositories</p>
          <p class="trending-empty__desc">Choose topics from the catalog above (e.g. AI Agents, Model Classifier, RAG), or add any custom topic.</p>
        </div>
      `;
      summaryText.textContent = 'No topics selected.';
      summaryMeta.textContent = '';
      return;
    }

    isLoading = true;
    renderSkeletonLoading();
    summaryText.textContent = `Searching GitHub for repositories matching: ${topicsArr.join(', ')}…`;
    summaryMeta.textContent = `Range: ${getActiveStarRangeDescription()} • Lang: ${topicLanguage} • Activity: ${topicActivity}`;

    try {
      topicRepos = await fetchReposByTopics(token, {
        topics: topicsArr,
        sortBy: topicSortBy,
        timeframe: topicTimeframe,
        starsMin,
        starsMax,
        language: topicLanguage,
        activity: topicActivity,
        perPage: 30,
      });

      isLoading = false;
      renderTopicResults();
      enrichWithWhyAnalysis(topicRepos);
    } catch (err) {
      isLoading = false;
      contentArea.innerHTML = `
        <div class="trending-error">
          <p class="trending-error__title">Failed to load topic repositories</p>
          <p class="trending-error__desc">${escapeHtml(err.message)}</p>
          <button type="button" class="btn-primary btn-retry-trending" id="btn-retry-topics">Try Again</button>
        </div>
      `;
      contentArea.querySelector('#btn-retry-topics')?.addEventListener('click', loadTopicsRepos);
      summaryText.textContent = 'Error loading repositories.';
      summaryMeta.textContent = '';
    }
  }

  function renderTopicResults() {
    const topicsArr = Array.from(selectedTopics);
    const count = topicRepos.length;

    summaryText.innerHTML = `Showing <strong>${count}</strong> repositories in <em>${escapeHtml(topicsArr.join(', '))}</em>`;
    summaryMeta.textContent = `Range: ${getActiveStarRangeDescription()} • Sorted by ${topicSortBy === 'trending' ? `Velocity (${topicTimeframe})` : topicSortBy}`;

    if (count === 0) {
      contentArea.innerHTML = `
        <div class="trending-empty">
          <p class="trending-empty__title">No repositories found in this star range</p>
          <p class="trending-empty__desc">Try broadening your star range (${getActiveStarRangeDescription()}) or clearing language/activity filters.</p>
        </div>
      `;
      return;
    }

    contentArea.innerHTML = `
      <div class="trending-grid">
        ${topicRepos.map((repo) => renderRepoCardHtml(repo)).join('')}
      </div>
    `;

    wireCardActions(contentArea);
  }

  // =========================================================================
  // Trending Feeds Logic
  // =========================================================================

  feedTimeframeBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      feedTimeframeBtns.forEach((b) => b.classList.remove('trending-segment--active'));
      btn.classList.add('trending-segment--active');
      feedTimeframe = btn.dataset.feedTimeframe;
      loadFeed();
    });
  });

  feedModeBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      feedModeBtns.forEach((b) => b.classList.remove('trending-segment--active'));
      btn.classList.add('trending-segment--active');
      feedMode = btn.dataset.feedMode;
      loadFeed();
    });
  });

  feedTopicChips.forEach((chip) => {
    chip.addEventListener('click', () => {
      feedTopicChips.forEach((c) => c.classList.remove('filter-chip--active'));
      chip.classList.add('filter-chip--active');
      feedFilter = chip.dataset.feedTopic;
      loadFeed();
    });
  });

  feedSearchInput?.addEventListener('input', () => {
    const q = feedSearchInput.value.trim().toLowerCase();
    feedSearchClear.hidden = !q;
    renderFeedResults();
  });

  feedSearchClear?.addEventListener('click', () => {
    feedSearchInput.value = '';
    feedSearchClear.hidden = true;
    feedSearchInput.focus();
    renderFeedResults();
  });

  feedRefreshBtn?.addEventListener('click', () => {
    loadFeed();
  });

  async function loadFeed() {
    if (!token) {
      renderTokenRequired();
      return;
    }

    isLoading = true;
    feedRefreshBtn.classList.add('is-spinning');
    renderSkeletonLoading();

    summaryText.textContent = `Scanning GitHub for ${feedMode} repositories (${feedTimeframe})…`;
    summaryMeta.textContent = `Star Range: ${getActiveStarRangeDescription()}`;

    let langArg = '';
    let topicArg = '';
    if (['typescript', 'python', 'rust', 'go'].includes(feedFilter)) {
      langArg = feedFilter;
    } else if (['ai', 'devtools'].includes(feedFilter)) {
      topicArg = feedFilter;
    }

    try {
      feedRepos = await fetchTrendingRepos(token, {
        timeframe: feedTimeframe,
        mode: feedMode,
        language: langArg,
        topic: topicArg,
        starsMin,
        starsMax,
        perPage: 30,
      });

      isLoading = false;
      feedRefreshBtn.classList.remove('is-spinning');
      renderFeedResults();
      enrichWithWhyAnalysis(feedRepos);
    } catch (err) {
      isLoading = false;
      feedRefreshBtn.classList.remove('is-spinning');
      contentArea.innerHTML = `
        <div class="trending-error">
          <p class="trending-error__title">Failed to load trending repositories</p>
          <p class="trending-error__desc">${escapeHtml(err.message)}</p>
          <button type="button" class="btn-primary btn-retry-trending" id="btn-retry-feed">Try Again</button>
        </div>
      `;
      contentArea.querySelector('#btn-retry-feed')?.addEventListener('click', loadFeed);
    }
  }

  function renderFeedResults() {
    const q = feedSearchInput.value.trim().toLowerCase();
    const filtered = feedRepos.filter((repo) => {
      if (!q) return true;
      return (
        repo.name.toLowerCase().includes(q) ||
        repo.fullName.toLowerCase().includes(q) ||
        (repo.description || '').toLowerCase().includes(q) ||
        (repo.language || '').toLowerCase().includes(q) ||
        (repo.topics || []).some((t) => t.toLowerCase().includes(q))
      );
    });

    summaryText.innerHTML = `Found <strong>${filtered.length}</strong> trending projects`;
    summaryMeta.textContent = `${feedMode === 'breakout' ? 'Breakout Launches' : 'Surging & Active'} • Range: ${getActiveStarRangeDescription()} • ${feedTimeframe}`;

    if (filtered.length === 0) {
      contentArea.innerHTML = `
        <div class="trending-empty">
          <p class="trending-empty__title">No trending repositories found</p>
          <p class="trending-empty__desc">Try adjusting your star range (${getActiveStarRangeDescription()}) or clearing search filters.</p>
        </div>
      `;
      return;
    }

    contentArea.innerHTML = `
      <div class="trending-grid">
        ${filtered.map((repo) => renderRepoCardHtml(repo)).join('')}
      </div>
    `;

    wireCardActions(contentArea);
  }

  // =========================================================================
  // Section 3: "For You (Your Stack)" Logic
  // =========================================================================

  forYouModeBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      forYouModeBtns.forEach((b) => b.classList.remove('trending-segment--active'));
      btn.classList.add('trending-segment--active');
      forYouMode = btn.dataset.foryouMode;
      loadForYou();
    });
  });

  forYouTimeframeBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      forYouTimeframeBtns.forEach((b) => b.classList.remove('trending-segment--active'));
      btn.classList.add('trending-segment--active');
      forYouTimeframe = btn.dataset.foryouTimeframe;
      loadForYou();
    });
  });

  forYouLangChips.forEach((chip) => {
    chip.addEventListener('click', () => {
      forYouLangChips.forEach((c) => c.classList.remove('filter-chip--active'));
      chip.classList.add('filter-chip--active');
      forYouLanguage = chip.dataset.foryouLang;
      loadForYou();
    });
  });

  async function loadForYou() {
    if (!token) {
      renderTokenRequired();
      return;
    }

    isLoading = true;
    renderSkeletonLoading();

    const targetLang = forYouLanguage !== 'all' ? forYouLanguage : userStack.primaryLanguage?.toLowerCase() || '';
    summaryText.textContent = `Finding emerging tools for your stack (${targetLang || 'top languages'})…`;
    summaryMeta.textContent = `Star Range: ${getActiveStarRangeDescription()} • Mode: ${forYouMode}`;

    try {
      forYouRepos = await fetchTrendingRepos(token, {
        timeframe: forYouTimeframe,
        mode: forYouMode,
        language: targetLang,
        starsMin,
        starsMax,
        perPage: 30,
      });

      isLoading = false;
      renderForYouResults();
      enrichWithWhyAnalysis(forYouRepos);
    } catch (err) {
      isLoading = false;
      contentArea.innerHTML = `
        <div class="trending-error">
          <p class="trending-error__title">Failed to load personalized recommendations</p>
          <p class="trending-error__desc">${escapeHtml(err.message)}</p>
          <button type="button" class="btn-primary btn-retry-trending" id="btn-retry-foryou">Try Again</button>
        </div>
      `;
      contentArea.querySelector('#btn-retry-foryou')?.addEventListener('click', loadForYou);
    }
  }

  function renderForYouResults() {
    const count = forYouRepos.length;
    summaryText.innerHTML = `Showing <strong>${count}</strong> personalized tools for your stack`;
    summaryMeta.textContent = `Range: ${getActiveStarRangeDescription()} • ${forYouMode === 'breakout' ? 'Breakout' : 'Surging'} • ${forYouTimeframe}`;

    if (count === 0) {
      contentArea.innerHTML = `
        <div class="trending-empty">
          <p class="trending-empty__title">No recommendations found in this star range</p>
          <p class="trending-empty__desc">Try switching star range (${getActiveStarRangeDescription()}) or selecting "All Stack".</p>
        </div>
      `;
      return;
    }

    contentArea.innerHTML = `
      <div class="trending-grid">
        ${forYouRepos.map((repo) => renderRepoCardHtml(repo)).join('')}
      </div>
    `;

    wireCardActions(contentArea);
  }

  function renderTokenRequired() {
    contentArea.innerHTML = `
      <div class="trending-empty">
        <p class="trending-empty__title">GitHub Token Required</p>
        <p class="trending-empty__desc">Please configure your GitHub personal access token in settings to discover trending repositories and topics.</p>
      </div>
    `;
    summaryText.textContent = 'Token missing.';
    summaryMeta.textContent = '';
  }

  // =========================================================================
  // Quick README Peek Slide-Over Logic
  // =========================================================================

  function isPeekOpen() {
    return Boolean(peekDrawer?.classList.contains('is-open'));
  }

  function closePeekDrawer() {
    if (!peekDrawer) return;
    peekDrawer.classList.remove('is-open');
    peekDrawer.setAttribute('aria-hidden', 'true');
    currentPeekRepo = null;
  }

  btnClosePeek?.addEventListener('click', closePeekDrawer);

  // Close peek drawer on Escape or when clicking outside it in contentArea
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && isPeekOpen()) {
      e.stopPropagation();
      e.preventDefault();
      closePeekDrawer();
    }
  });

  contentArea?.addEventListener('click', (e) => {
    if (isPeekOpen() && !e.target.closest('#trending-readme-peek') && !e.target.closest('[data-action="peek-readme"]')) {
      closePeekDrawer();
    }
  });

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

  async function openReadmePeek(owner, repoName, fallbackRepo = null) {
    if (!peekDrawer) return;
    currentPeekRepo = { owner, repoName, ...fallbackRepo };
    peekDrawer.classList.add('is-open');
    peekDrawer.setAttribute('aria-hidden', 'false');

    peekRepoTitle.textContent = `${owner}/${repoName}`;
    peekRepoMeta.textContent = fallbackRepo?.language ? `${fallbackRepo.language} • ${fallbackRepo.stars?.toLocaleString() || 0} ★` : '';
    peekLinkGithub.href = fallbackRepo?.url || `https://github.com/${owner}/${repoName}`;

    // Update peek star button state
    const isStarred = starredGithubRepos.has(`${owner}/${repoName}`.toLowerCase());
    peekBtnStar.classList.toggle('is-starred', isStarred);
    peekBtnStar.querySelector('.star-text').textContent = isStarred ? 'Starred' : 'Star';

    peekBody.innerHTML = `
      <div class="trending-loading">
        <div class="loading-spinner"></div>
        <p>Fetching full README documentation for ${escapeHtml(repoName)}…</p>
      </div>
    `;

    try {
      const readmeText = await fetchFullReadme(owner, repoName, token);
      if (!readmeText || !readmeText.trim()) {
        peekBody.innerHTML = `
          <div class="md-empty">
            <p>This repository has not published a README document.</p>
          </div>
        `;
      } else {
        const renderedHtml = renderMarkdown(readmeText, {
          repoFullName: `${owner}/${repoName}`,
          defaultBranch: 'main',
        });
        peekBody.innerHTML = `<article class="readme-view">${renderedHtml}</article>`;
        wireReadmeCodeCopy(peekBody);
      }
    } catch (err) {
      peekBody.innerHTML = `
        <div class="trending-error">
          <p class="trending-error__title">Unable to load README</p>
          <p class="trending-error__desc">${escapeHtml(err.message)}</p>
        </div>
      `;
    }
  }

  peekBtnStar?.addEventListener('click', async () => {
    if (!currentPeekRepo || !token) return;
    const { owner, repoName } = currentPeekRepo;
    const key = `${owner}/${repoName}`.toLowerCase();
    const isNowStarred = !starredGithubRepos.has(key);

    if (isNowStarred) starredGithubRepos.add(key);
    else starredGithubRepos.delete(key);

    peekBtnStar.classList.toggle('is-starred', isNowStarred);
    peekBtnStar.querySelector('.star-text').textContent = isNowStarred ? 'Starred' : 'Star';

    // Sync card buttons and star counters across discovery
    contentArea.querySelectorAll(`[data-action="github-star"]`).forEach((b) => {
      if (b.dataset.owner?.toLowerCase() === owner.toLowerCase() && b.dataset.repo?.toLowerCase() === repoName.toLowerCase()) {
        b.classList.toggle('is-starred', isNowStarred);
        b.querySelector('.star-text').textContent = isNowStarred ? 'Starred' : 'Star';
        const card = b.closest('.trending-card');
        const starNumEl = card?.querySelector('[data-role="star-num"]');
        if (starNumEl) {
          const currentCount = parseInt(starNumEl.textContent.replace(/,/g, ''), 10) || 0;
          starNumEl.textContent = formatNumber(isNowStarred ? currentCount + 1 : Math.max(0, currentCount - 1));
        }
      }
    });

    try {
      if (isNowStarred) {
        await starRepoOnGithub(owner, repoName, token);
        showToast(`✓ Starred ${owner}/${repoName} on GitHub`);
      } else {
        await unstarRepoOnGithub(owner, repoName, token);
        showToast(`Unstarred ${owner}/${repoName}`);
      }
    } catch (err) {
      // Revert on error
      if (isNowStarred) starredGithubRepos.delete(key);
      else starredGithubRepos.add(key);
      peekBtnStar.classList.toggle('is-starred', !isNowStarred);
      peekBtnStar.querySelector('.star-text').textContent = !isNowStarred ? 'Starred' : 'Star';
      showToast(`GitHub star failed: ${err.message}`, false);
    }
  });

  // =========================================================================
  // Repository Card HTML & Wire Actions
  // =========================================================================

  function renderRepoCardHtml(repo) {
    const langColor = repo.language ? getLanguageColor(repo.language) : null;
    const isPinned = pinnedSet.has(repo.id);
    const isGithubStarred = starredGithubRepos.has(repo.fullName.toLowerCase());
    const initialWhy = repo.whyTrending || generateHeuristicTrendingWhy(repo);

    let rankClass = 'trending-rank--other';
    if (repo.rank === 1) rankClass = 'trending-rank--1';
    else if (repo.rank === 2) rankClass = 'trending-rank--2';
    else if (repo.rank === 3) rankClass = 'trending-rank--3';

    return `
      <article class="trending-card ${repo.rank <= 3 ? 'trending-card--top-3' : ''} ${isPinned ? 'trending-card--pinned' : ''}" data-repo-id="${repo.id}">
        <!-- Top Row -->
        <div class="trending-card__top">
          <div class="trending-card__identity">
            <span class="trending-rank ${rankClass}" title="Rank #${repo.rank || '-'}">
              <span class="trending-rank__hash">#</span><span class="trending-rank__num">${repo.rank || '•'}</span>
            </span>

            ${
              repo.ownerAvatar
                ? `<img src="${repo.ownerAvatar}" alt="${escapeHtml(repo.owner)}" class="trending-avatar" loading="lazy" />`
                : ''
            }

            <div class="trending-name-wrap">
              <a href="${repo.url}" target="_blank" rel="noopener" class="trending-repo-name" title="${escapeHtml(repo.fullName)}">
                <span class="trending-owner">${escapeHtml(repo.owner)}/</span>${escapeHtml(repo.name)}
              </a>
              <div class="trending-meta-line">
                ${
                  repo.language
                    ? `<span class="trending-lang-tag">
                        <span class="trending-lang-dot" style="background-color: ${langColor};"></span>
                        <span>${escapeHtml(repo.language)}</span>
                      </span>`
                    : ''
                }
                ${repo.pushedAt ? `<span>Pushed ${escapeHtml(repo.pushedAt.split('T')[0])}</span>` : ''}
              </div>
            </div>
          </div>

          <div class="trending-card__metrics">
            <div class="trending-metric-pill" title="${repo.stars.toLocaleString()} total stars">
              <span class="star-glyph">★</span>
              <span class="metric-num" data-role="star-num">${formatNumber(repo.stars)}</span>
            </div>
            ${
              repo.starsPerDay > 0
                ? `<div class="trending-velocity-pill" title="Average velocity since creation">
                    <span class="velocity-plus">+${formatNumber(repo.starsPerDay)}</span>
                    <span class="velocity-label">/day</span>
                  </div>`
                : ''
            }
            <div class="trending-metric-pill trending-metric-pill--forks" title="${repo.forks.toLocaleString()} forks">
              <svg class="icon-fork" viewBox="0 0 16 16" fill="currentColor">
                <path d="M5 3.25a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0Zm0 2.122a2.25 2.25 0 1 0-1.5 0v.878A2.25 2.25 0 0 0 5.75 8.5h4.5A2.25 2.25 0 0 0 12.5 6.25v-.878a2.25 2.25 0 1 0-1.5 0v.878a.75.75 0 0 1-.75.75h-4.5A.75.75 0 0 1 5 6.25v-.878ZM12.5 3.25a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0ZM8 12.75a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0Zm0 2.122a2.25 2.25 0 1 0-1.5 0V11a.75.75 0 0 1 .75-.75h.001A.75.75 0 0 1 8 11v3.872Z"/>
              </svg>
              <span class="metric-num">${formatNumber(repo.forks)}</span>
            </div>
          </div>
        </div>

        <!-- Description -->
        <p class="trending-card__desc">
          ${escapeHtml(repo.description || 'No description provided.')}
        </p>

        <!-- Topic Tags (Clickable to jump into Topic Explorer) -->
        ${
          repo.topics && repo.topics.length > 0
            ? `<div class="trending-tags">
                ${repo.topics
                  .slice(0, 6)
                  .map(
                    (t) =>
                      `<button type="button" class="trending-tag" data-action="explore-topic" data-topic="${escapeHtml(t)}" title="Filter by topic '${escapeHtml(t)}'">${escapeHtml(t)}</button>`
                  )
                  .join('')}
              </div>`
            : ''
        }

        <!-- "Why It's Trending" Feature Card -->
        <div class="trending-why-card" data-role="why-card">
          <div class="trending-why-header">
            <div class="trending-why-badge">
              <svg class="trending-why-icon" viewBox="0 0 16 16" fill="currentColor">
                <path d="M8.75.75a.75.75 0 0 0-1.5 0V2h-.5A2.25 2.25 0 0 0 4.5 4.25v.5h-.75a.75.75 0 0 0 0 1.5h.75v1.5h-.75a.75.75 0 0 0 0 1.5h.75v1.5h-.75a.75.75 0 0 0 0 1.5h.75v.5A2.25 2.25 0 0 0 6.75 14h.5v1.25a.75.75 0 0 0 1.5 0V14h1.5v1.25a.75.75 0 0 0 1.5 0V14h.5a2.25 2.25 0 0 0 2.25-2.25v-.5h.75a.75.75 0 0 0 0-1.5h-.75v-1.5h.75a.75.75 0 0 0 0-1.5h-.75v-1.5h.75a.75.75 0 0 0 0-1.5h-.75v-.5A2.25 2.25 0 0 0 11.25 2h-.5V.75a.75.75 0 0 0-1.5 0V2h-1.5V.75ZM6 4.25a.75.75 0 0 1 .75-.75h4.5a.75.75 0 0 1 .75.75v7.5a.75.75 0 0 1-.75.75h-4.5a.75.75 0 0 1-.75-.75v-7.5Z"/>
              </svg>
              <span>Why It's Trending</span>
            </div>
            <span class="trending-why-pill" data-role="why-pill">${repo.isAiWhy ? 'AI Analysis' : 'Momentum Analysis'}</span>
          </div>
          <p class="trending-why-text" data-role="why-text">${escapeHtml(initialWhy)}</p>
        </div>

        <!-- Quick Actions Bar -->
        <div class="trending-card__footer">
          <div class="trending-footer-left">
            <!-- 1-Click Native GitHub Star -->
            <button
              type="button"
              class="trending-action-btn trending-action-btn--star ${isGithubStarred ? 'is-starred' : ''}"
              data-action="github-star"
              data-owner="${escapeHtml(repo.owner)}"
              data-repo="${escapeHtml(repo.name)}"
              title="${isGithubStarred ? 'Unstar on your GitHub account' : 'Star on your GitHub account'}"
            >
              <span class="star-glyph">★</span>
              <span class="star-text">${isGithubStarred ? 'Starred' : 'Star'}</span>
            </button>

            <!-- Quick README Peek -->
            <button
              type="button"
              class="trending-action-btn trending-action-btn--peek"
              data-action="peek-readme"
              data-owner="${escapeHtml(repo.owner)}"
              data-repo="${escapeHtml(repo.name)}"
              title="Inspect repository README without leaving"
            >
              <svg viewBox="0 0 16 16" fill="currentColor">
                <path d="M0 2.75C0 1.784.784 1 1.75 1h12.5c.966 0 1.75.784 1.75 1.75v10.5A1.75 1.75 0 0 1 14.25 15H1.75A1.75 1.75 0 0 1 0 13.25V2.75Zm1.75-.25a.25.25 0 0 0-.25.25v10.5c0 .138.112.25.25.25h12.5a.25.25 0 0 0 .25-.25V2.75a.25.25 0 0 0-.25-.25H1.75ZM7.25 4a.75.75 0 0 1 .75.75v6.5a.75.75 0 0 1-1.5 0v-6.5A.75.75 0 0 1 7.25 4Zm3 2a.75.75 0 0 1 .75.75v4.5a.75.75 0 0 1-1.5 0v-4.5A.75.75 0 0 1 10.25 6ZM4.25 8a.75.75 0 0 1 .75.75v2.5a.75.75 0 0 1-1.5 0v-2.5A.75.75 0 0 1 4.25 8Z"/>
              </svg>
              <span>README</span>
            </button>

            <!-- Pin Button (Keep Pin Icon) -->
            <button
              type="button"
              class="trending-action-btn trending-action-btn--pin ${isPinned ? 'is-pinned' : ''}"
              data-action="pin"
              data-repo-id="${repo.id}"
              title="${isPinned ? 'Unpin repository' : 'Pin repository to dashboard'}"
            >
              <span class="pin-glyph">📌</span>
              <span class="pin-text">${isPinned ? 'Pinned' : 'Pin'}</span>
            </button>

            <!-- Save to Folder Dropdown -->
            ${
              folders.length > 0
                ? `<div class="trending-folder-select-wrap">
                    <select class="trending-folder-select" data-action="folder" data-repo-id="${repo.id}">
                      <option value="" disabled selected>Add to Folder…</option>
                      ${folders.map((f) => `<option value="${f.id}">${escapeHtml(f.name)}</option>`).join('')}
                    </select>
                    <svg class="select-chevron" viewBox="0 0 16 16" fill="currentColor">
                      <path d="m4.427 6.427 3.396 3.396a.25.25 0 0 0 .354 0l3.396-3.396A.25.25 0 0 0 11.396 6H4.604a.25.25 0 0 0-.177.427Z"/>
                    </svg>
                  </div>`
                : ''
            }
          </div>

          <div class="trending-footer-right">
            <!-- Copy Clone URL -->
            <button
              type="button"
              class="trending-action-btn"
              data-action="clone"
              data-clone-url="${escapeHtml(repo.cloneUrl)}"
              data-full-name="${escapeHtml(repo.fullName)}"
              title="Copy git clone command"
            >
              <svg viewBox="0 0 16 16" fill="currentColor">
                <path d="M0 6.75C0 5.784.784 5 1.75 5h1.5a.75.75 0 0 1 0 1.5h-1.5a.25.25 0 0 0-.25.25v7.5c0 .138.112.25.25.25h7.5a.25.25 0 0 0 .25-.25v-1.5a.75.75 0 0 1 1.5 0v1.5A1.75 1.75 0 0 1 9.25 16h-7.5A1.75 1.75 0 0 1 0 14.25v-7.5Z"/>
                <path d="M5 1.75C5 .784 5.784 0 6.75 0h7.5C15.216 0 16 .784 16 1.75v7.5A1.75 1.75 0 0 1 14.25 11h-7.5A1.75 1.75 0 0 1 5 9.25v-7.5Zm1.75-.25a.25.25 0 0 0-.25.25v7.5c0 .138.112.25.25.25h7.5a.25.25 0 0 0 .25-.25v-7.5a.25.25 0 0 0-.25-.25h-7.5Z"/>
              </svg>
              <span>Copy</span>
            </button>

            <!-- Open on GitHub -->
            <a href="${repo.url}" target="_blank" rel="noopener" class="trending-action-btn trending-action-btn--primary">
              <span>GitHub</span>
              <svg viewBox="0 0 16 16" fill="currentColor">
                <path d="M3.75 2h3.5a.75.75 0 0 1 0 1.5h-3.5a.25.25 0 0 0-.25.25v8.5c0 .138.112.25.25.25h8.5a.25.25 0 0 0 .25-.25v-3.5a.75.75 0 0 1 1.5 0v3.5A1.75 1.75 0 0 1 12.25 14h-8.5A1.75 1.75 0 0 1 2 12.25v-8.5C2 2.784 2.784 2 3.75 2Zm6.75.75a.75.75 0 0 1 .75-.75h3.5a.75.75 0 0 1 .75.75v3.5a.75.75 0 0 1-1.5 0V3.56l-4.22 4.22a.749.749 0 0 1-1.275-.326.749.749 0 0 1 .215-.734L13.44 2.5H10.5a.75.75 0 0 1-.75-.75Z"/>
              </svg>
            </a>
          </div>
        </div>
      </article>
    `;
  }

  function wireCardActions(parentEl) {
    // 1-Click Native GitHub Star
    parentEl.querySelectorAll('[data-action="github-star"]').forEach((btn) => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        if (!token) {
          showToast('Please add GitHub token to star repos', false);
          return;
        }

        const owner = btn.dataset.owner;
        const repoName = btn.dataset.repo;
        const key = `${owner}/${repoName}`.toLowerCase();
        const isNowStarred = !starredGithubRepos.has(key);

        // Optimistic UI updates
        if (isNowStarred) starredGithubRepos.add(key);
        else starredGithubRepos.delete(key);

        btn.classList.toggle('is-starred', isNowStarred);
        btn.querySelector('.star-text').textContent = isNowStarred ? 'Starred' : 'Star';

        // Optimistic star counter update
        const card = btn.closest('.trending-card');
        const starNumEl = card?.querySelector('[data-role="star-num"]');
        if (starNumEl) {
          const currentCount = parseInt(starNumEl.textContent.replace(/,/g, ''), 10) || 0;
          starNumEl.textContent = formatNumber(isNowStarred ? currentCount + 1 : Math.max(0, currentCount - 1));
        }

        try {
          if (isNowStarred) {
            await starRepoOnGithub(owner, repoName, token);
            showToast(`✓ Starred ${owner}/${repoName} on GitHub`);
          } else {
            await unstarRepoOnGithub(owner, repoName, token);
            showToast(`Unstarred ${owner}/${repoName}`);
          }
        } catch (err) {
          // Revert on error
          if (isNowStarred) starredGithubRepos.delete(key);
          else starredGithubRepos.add(key);
          btn.classList.toggle('is-starred', !isNowStarred);
          btn.querySelector('.star-text').textContent = !isNowStarred ? 'Starred' : 'Star';
          showToast(`Starring failed: ${err.message}`, false);
        }
      });
    });

    // In-Discovery Quick README Peek
    parentEl.querySelectorAll('[data-action="peek-readme"]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const owner = btn.dataset.owner;
        const repoName = btn.dataset.repo;
        const targetRepo =
          topicRepos.find((r) => r.owner === owner && r.name === repoName) ||
          feedRepos.find((r) => r.owner === owner && r.name === repoName) ||
          forYouRepos.find((r) => r.owner === owner && r.name === repoName);
        openReadmePeek(owner, repoName, targetRepo);
      });
    });

    // Pin buttons
    parentEl.querySelectorAll('[data-action="pin"]').forEach((btn) => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const repoId = Number(btn.dataset.repoId);
        const isNowPinned = !pinnedSet.has(repoId);
        if (isNowPinned) pinnedSet.add(repoId);
        else pinnedSet.delete(repoId);

        btn.classList.toggle('is-pinned', isNowPinned);
        btn.querySelector('.pin-text').textContent = isNowPinned ? 'Pinned' : 'Pin';
        btn.closest('.trending-card')?.classList.toggle('trending-card--pinned', isNowPinned);

        if (onTogglePin) {
          await onTogglePin(repoId);
        }
      });
    });

    // Folder assignments
    parentEl.querySelectorAll('.trending-folder-select').forEach((select) => {
      select.addEventListener('change', async (e) => {
        e.stopPropagation();
        const repoId = Number(select.dataset.repoId);
        const folderId = select.value;
        if (folderId && onAssignFolder) {
          await onAssignFolder(repoId, folderId);
          select.classList.add('is-assigned');
          setTimeout(() => select.classList.remove('is-assigned'), 1500);
          showToast('Saved to folder');
        }
      });
    });

    // Copy clone URL
    parentEl.querySelectorAll('[data-action="clone"]').forEach((btn) => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const cloneUrl = btn.dataset.cloneUrl;
        try {
          await navigator.clipboard.writeText(`git clone ${cloneUrl}`);
          const span = btn.querySelector('span');
          if (span) {
            const oldText = span.textContent;
            span.textContent = 'Copied!';
            setTimeout(() => (span.textContent = oldText), 1500);
          }
          showToast('Copied git clone command');
        } catch {
          // Fallback
        }
      });
    });

    // Clicking any topic badge jumps into Topic Explorer with that topic
    parentEl.querySelectorAll('[data-action="explore-topic"]').forEach((tagBtn) => {
      tagBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const topicSlug = normalizeTopicSlug(tagBtn.dataset.topic);
        if (!topicSlug) return;

        // Switch to topics view
        activeTab = 'topics';
        navTabs.forEach((t) => t.classList.toggle('trending-nav-tab--active', t.dataset.tab === 'topics'));
        topicExplorerSection.classList.remove('is-hidden');
        feedToolbar.classList.add('is-hidden');
        forYouSection.classList.add('is-hidden');

        // Set topic as selected
        selectedTopics = new Set([topicSlug]);
        renderActiveTopicsBar();
        renderCuratedCatalog();
        renderStarredShelf();
        loadTopicsRepos();
      });
    });
  }

  async function enrichWithWhyAnalysis(targetRepos) {
    if (!targetRepos || targetRepos.length === 0) return;
    const topCandidates = targetRepos.slice(0, 10);

    for (const repo of topCandidates) {
      if (repo.isAiWhy) continue;
      const card = contentArea.querySelector(`[data-repo-id="${repo.id}"]`);
      if (!card) continue;

      const whyResult = await getTrendingWhy({
        repo,
        provider: aiProvider,
        apiKey: aiApiKey,
        githubToken: token,
      });

      repo.whyTrending = whyResult.text;
      repo.isAiWhy = whyResult.isAi;

      const whyTextEl = card.querySelector('[data-role="why-text"]');
      const whyPillEl = card.querySelector('[data-role="why-pill"]');
      if (whyTextEl) whyTextEl.textContent = whyResult.text;
      if (whyPillEl) whyPillEl.textContent = whyResult.isAi ? 'AI Analysis' : 'Momentum Analysis';
    }
  }

  function renderSkeletonLoading() {
    contentArea.innerHTML = `
      <div class="trending-grid">
        ${[1, 2, 3, 4]
          .map(
            () => `
            <div class="trending-card trending-card--skeleton">
              <div class="trending-card__top">
                <div class="trending-skeleton-pill" style="width: 140px;"></div>
                <div class="trending-skeleton-pill" style="width: 80px;"></div>
              </div>
              <div class="trending-skeleton-text" style="height: 14px; width: 90%; margin-top: 10px;"></div>
              <div class="trending-skeleton-text" style="height: 14px; width: 70%; margin-top: 6px;"></div>
              <div class="trending-skeleton-card" style="height: 70px; margin-top: 14px;"></div>
            </div>
          `
          )
          .join('')}
      </div>
    `;
  }

  function updatePinnedState(newPinnedIds) {
    pinnedSet = new Set(newPinnedIds);
    contentArea.querySelectorAll('.trending-card').forEach((card) => {
      const id = Number(card.dataset.repoId);
      const isPinned = pinnedSet.has(id);
      card.classList.toggle('trending-card--pinned', isPinned);
      const pinBtn = card.querySelector('[data-action="pin"]');
      if (pinBtn) {
        pinBtn.classList.toggle('is-pinned', isPinned);
        pinBtn.querySelector('.pin-text').textContent = isPinned ? 'Pinned' : 'Pin';
      }
    });
  }

  return {
    open,
    close,
    isOpen,
    isPeekOpen,
    closePeekDrawer,
    updatePinnedState,
  };
}
