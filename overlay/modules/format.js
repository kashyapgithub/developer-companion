// overlay/modules/format.js
//
// Small, dependency-free string/date helpers shared by the render
// modules. Kept separate so repoCard.js, statsBar.js etc. don't each
// reinvent the same escaping/date-formatting logic.

const HTML_ESCAPES = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

/** Escapes text before it's dropped into innerHTML, to stop a repo
 *  name or AI-generated description from being interpreted as markup. */
export function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, (ch) => HTML_ESCAPES[ch]);
}

/** Converts an ISO timestamp into a relative string like "3 days ago". */
export function timeAgo(isoString) {
  const seconds = Math.floor((Date.now() - new Date(isoString).getTime()) / 1000);
  const units = [
    ['year', 31536000],
    ['month', 2592000],
    ['week', 604800],
    ['day', 86400],
    ['hour', 3600],
    ['minute', 60],
  ];

  for (const [name, secondsInUnit] of units) {
    const count = Math.floor(seconds / secondsInUnit);
    if (count >= 1) return `${count} ${name}${count > 1 ? 's' : ''} ago`;
  }
  return 'just now';
}

/** Trims text to a max length with an ellipsis, never mid-word where avoidable. */
export function truncate(str, maxLength) {
  const text = str ?? '';
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength - 1).trimEnd() + '…';
}

/** Formats numbers with commas or compact notation (e.g. 1,240 or 12.4k). */
export function formatNumber(num) {
  if (num == null || isNaN(num)) return '0';
  if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M`;
  if (num >= 1000) return `${(num / 1000).toFixed(1)}k`;
  return String(num);
}

/** Formats ISO date to human readable date, e.g. "Sep 28, 2026". */
export function formatDate(isoString) {
  if (!isoString) return '—';
  try {
    const d = new Date(isoString);
    return d.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return isoString;
  }
}

const LANGUAGE_COLORS = {
  JavaScript: '#f1e05a',
  TypeScript: '#3178c6',
  Python: '#3572A5',
  HTML: '#e34c26',
  CSS: '#563d7c',
  Rust: '#dea584',
  Go: '#00ADD8',
  C: '#555555',
  'C++': '#f34b7d',
  'C#': '#178600',
  Java: '#b07219',
  Ruby: '#701516',
  PHP: '#4F5D95',
  Swift: '#F05138',
  Kotlin: '#A97BFF',
  Dart: '#00B4AB',
  Shell: '#89e051',
  Vue: '#41b883',
  Svelte: '#ff3e00',
  SCSS: '#c6538c',
  Jupyter: '#DA5B0B',
  'Jupyter Notebook': '#DA5B0B',
  Lua: '#000080',
  R: '#198CE7',
  Zig: '#ec915c',
  Elixir: '#6e4a7e',
  Haskell: '#5e5086',
  Clojure: '#db5855',
  Markdown: '#083fa1',
};

/** Returns the hex color for a programming language, with a neutral fallback. */
export function getLanguageColor(language) {
  if (!language) return '#8b949e';
  return LANGUAGE_COLORS[language] || '#8b949e';
}
