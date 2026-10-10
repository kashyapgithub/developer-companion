// overlay/modules/github-api.js
//
// All direct communication with GitHub's REST API lives here. Nothing
// else in the extension should call fetch() against api.github.com —
// that keeps auth headers, error handling, and pagination in one spot.

const API_BASE = 'https://api.github.com';

/**
 * Fetches every repository the authenticated user owns — public and
 * private, original and forked. GitHub caps each page at 100 items,
 * so we keep requesting the next page until a page comes back with
 * fewer than 100 (the natural "that was the last page" signal).
 */
export async function fetchAllRepos(token) {
  const repos = [];
  let page = 1;

  // A hard ceiling on pages purely as a safety net against an infinite
  // loop if GitHub's API ever behaves unexpectedly — 50 pages is 5,000
  // repos, well beyond any personal account.
  const MAX_PAGES = 50;

  while (page <= MAX_PAGES) {
    const batch = await githubRequest(
      `/user/repos?per_page=100&page=${page}&affiliation=owner&sort=updated`,
      token
    );
    repos.push(...batch);
    if (batch.length < 100) break;
    page += 1;
  }

  return repos.map(normalizeRepo);
}

/**
 * Fetches a repo's README as plain text, truncated for use as AI
 * input. Returns '' (not an error) if the repo simply has no README —
 * that's common for quick forks and shouldn't block description
 * generation, just make it rely on the repo's name/description/language.
 */
export async function fetchReadmeExcerpt(owner, repoName, token, maxChars = 3000) {
  try {
    const text = await githubRequest(`/repos/${owner}/${repoName}/readme`, token, {
      acceptRaw: true,
    });
    return typeof text === 'string' ? text.slice(0, maxChars) : '';
  } catch {
    return '';
  }
}

let currentRateLimit = {
  limit: 5000,
  remaining: 5000,
  resetTime: null,
  used: 0,
};

const rateLimitListeners = new Set();

export function getRateLimitStatus() {
  return { ...currentRateLimit };
}

export function onRateLimitChange(listener) {
  rateLimitListeners.add(listener);
  return () => rateLimitListeners.delete(listener);
}

function updateRateLimitFromHeaders(headers) {
  if (!headers) return;
  const limit = headers.get('x-ratelimit-limit');
  const remaining = headers.get('x-ratelimit-remaining');
  const reset = headers.get('x-ratelimit-reset');
  const used = headers.get('x-ratelimit-used');

  if (remaining !== null && remaining !== undefined) {
    currentRateLimit = {
      limit: limit ? parseInt(limit, 10) : 5000,
      remaining: parseInt(remaining, 10),
      resetTime: reset ? new Date(parseInt(reset, 10) * 1000) : null,
      used: used ? parseInt(used, 10) : 0,
    };
    for (const listener of rateLimitListeners) {
      try {
        listener(currentRateLimit);
      } catch (err) {
        console.warn('Rate limit listener error:', err);
      }
    }
  }
}

async function githubRequest(path, token, { method = 'GET', acceptRaw = false, body = undefined } = {}) {
  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: acceptRaw ? 'application/vnd.github.raw' : 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };

  if (method === 'PUT' || method === 'POST' || method === 'PATCH') {
    if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
    } else {
      headers['Content-Length'] = '0';
    }
  }

  const response = await fetch(`${API_BASE}${path}`, {
    method,
    headers,
    body: body !== undefined ? (typeof body === 'string' ? body : JSON.stringify(body)) : undefined,
  });

  updateRateLimitFromHeaders(response.headers);

  if (response.status === 204) {
    return true;
  }

  if (!response.ok) {
    throw new Error(describeGithubError(response.status));
  }

  return acceptRaw ? response.text() : response.json();
}

function describeGithubError(status) {
  if (status === 401) return 'GitHub rejected the access token — check it in settings.';
  if (status === 403) return 'GitHub rate limit hit, or the token is missing the "repo" scope.';
  if (status === 404) return 'Not found.';
  return `GitHub API error: ${status}`;
}

/**
 * Checks whether the authenticated user has starred a specific repository.
 * Returns true if starred (204), false if not starred (404), or false on error.
 */
export async function checkRepoStarred(owner, repoName, token) {
  if (!owner || !repoName || !token) return false;
  try {
    const res = await fetch(`${API_BASE}/user/starred/${encodeURIComponent(owner)}/${encodeURIComponent(repoName)}`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    });
    updateRateLimitFromHeaders(res.headers);
    return res.status === 204;
  } catch {
    return false;
  }
}

/**
 * Stars a repository on GitHub for the authenticated user.
 * PUT /user/starred/{owner}/{repo}
 */
export async function starRepoOnGithub(owner, repoName, token) {
  if (!owner || !repoName || !token) throw new Error('Missing owner, repo, or token');
  await githubRequest(`/user/starred/${encodeURIComponent(owner)}/${encodeURIComponent(repoName)}`, token, {
    method: 'PUT',
  });
  return true;
}

/**
 * Unstars a repository on GitHub for the authenticated user.
 * DELETE /user/starred/{owner}/{repo}
 */
export async function unstarRepoOnGithub(owner, repoName, token) {
  if (!owner || !repoName || !token) throw new Error('Missing owner, repo, or token');
  await githubRequest(`/user/starred/${encodeURIComponent(owner)}/${encodeURIComponent(repoName)}`, token, {
    method: 'DELETE',
  });
  return true;
}

/**
 * Validates a GitHub token by fetching the authenticated user's profile.
 * Returns { login, name, avatarUrl } or throws an informative Error.
 */
export async function testGithubToken(token) {
  if (!token?.trim()) {
    throw new Error('Please enter a GitHub personal access token.');
  }
  const user = await githubRequest('/user', token);
  return {
    login: user.login,
    name: user.name || user.login,
    avatarUrl: user.avatar_url,
  };
}

/**
 * Reshapes GitHub's large repo object into just what the dashboard
 * needs, plus one derived field: whether a fork looks untouched.
 */
function normalizeRepo(raw) {
  return {
    id: raw.id,
    name: raw.name,
    fullName: raw.full_name || `${raw.owner?.login}/${raw.name}`,
    owner: raw.owner?.login || '',
    ownerAvatar: raw.owner?.avatar_url || '',
    url: raw.html_url,
    description: raw.description ?? '',
    language: raw.language,
    stars: raw.stargazers_count ?? 0,
    forksCount: raw.forks_count ?? 0,
    openIssues: raw.open_issues_count ?? 0,
    defaultBranch: raw.default_branch || 'main',
    isPrivate: Boolean(raw.private),
    isFork: Boolean(raw.fork),
    archived: Boolean(raw.archived),
    updatedAt: raw.updated_at,
    pushed_at: raw.pushed_at,
    createdAt: raw.created_at,
    cloneUrl: raw.clone_url || (raw.html_url ? `${raw.html_url}.git` : ''),
    sshUrl: raw.ssh_url || '',
    // A forked repo whose last-push timestamp equals its creation
    // timestamp has never received a commit since the fork happened.
    // This is a free signal — no extra API call — for "forked and
    // forgotten", as opposed to a fork you've actually worked in.
    looksUntouched: Boolean(raw.fork && raw.pushed_at === raw.created_at),
    parent: raw.parent
      ? {
          fullName: raw.parent.full_name,
          stars: raw.parent.stargazers_count ?? 0,
          forksCount: raw.parent.forks_count ?? 0,
          url: raw.parent.html_url,
        }
      : null,
    parentStars: raw.parent ? raw.parent.stargazers_count ?? 0 : null,
  };
}

/**
 * Enriches forked repos with upstream parent repository data
 * (including upstream stars, parent repository name, and fork count)
 * via GitHub's GraphQL API. Runs asynchronously in batches of 100.
 */
export async function enrichForksWithParent(repos, token, onRepoUpdated) {
  const forkMap = new Map();
  for (const repo of repos) {
    if (repo.isFork) {
      forkMap.set(repo.name.toLowerCase(), repo);
    }
  }

  if (forkMap.size === 0) return repos;

  try {
    let cursor = null;
    let hasNextPage = true;
    let pages = 0;
    const MAX_GRAPHQL_PAGES = 10;

    while (hasNextPage && pages < MAX_GRAPHQL_PAGES) {
      pages++;
      const query = `
        query($after: String) {
          viewer {
            repositories(first: 100, after: $after, isFork: true, affiliations: [OWNER]) {
              pageInfo {
                hasNextPage
                endCursor
              }
              nodes {
                name
                stargazerCount
                parent {
                  nameWithOwner
                  stargazerCount
                  forkCount
                  url
                }
              }
            }
          }
        }
      `;

      const response = await fetch(`${API_BASE}/graphql`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ query, variables: { after: cursor } }),
      });

      if (!response.ok) break;
      const result = await response.json();
      const repositories = result.data?.viewer?.repositories;
      if (!repositories?.nodes) break;

      for (const node of repositories.nodes) {
        const repo = forkMap.get(node.name?.toLowerCase());
        if (repo && node.parent) {
          repo.parent = {
            fullName: node.parent.nameWithOwner,
            stars: node.parent.stargazerCount ?? 0,
            forksCount: node.parent.forkCount ?? 0,
            url: node.parent.url,
          };
          repo.parentStars = node.parent.stargazerCount ?? 0;
          if (onRepoUpdated) {
            onRepoUpdated(repo);
          }
        }
      }

      hasNextPage = Boolean(repositories.pageInfo?.hasNextPage);
      cursor = repositories.pageInfo?.endCursor || null;
    }
  } catch (err) {
    console.warn('Background fork enrichment skipped:', err);
  }

  return repos;
}

/**
 * REST fallback to fetch single repo metadata including parent info.
 */
export async function fetchRepoParent(owner, repoName, token) {
  try {
    const raw = await githubRequest(`/repos/${owner}/${repoName}`, token);
    if (!raw?.parent) return null;
    return {
      fullName: raw.parent.full_name,
      stars: raw.parent.stargazers_count ?? 0,
      forksCount: raw.parent.forks_count ?? 0,
      url: raw.parent.html_url,
    };
  } catch {
    return null;
  }
}

/**
 * Fetches commits for a single repository.
 */
export async function fetchRepoCommits(owner, repoName, token, { perPage = 10 } = {}) {
  try {
    const rawCommits = await githubRequest(`/repos/${owner}/${repoName}/commits?per_page=${perPage}`, token);
    if (!Array.isArray(rawCommits)) return [];
    return rawCommits.map((item) => normalizeCommit(item, { owner, repoName }));
  } catch (err) {
    console.warn(`Failed to fetch commits for ${owner}/${repoName}:`, err);
    return [];
  }
}

/**
 * Fetches recent commits across the top most recently edited repositories.
 */
export async function fetchRecentCommitsAcrossRepos(repos, token, { maxRepos = 8, perRepo = 6 } = {}) {
  if (!repos?.length || !token) return [];

  // Sort repos by pushed_at or updatedAt descending to get most recently edited repos
  const sortedRepos = [...repos].sort((a, b) => {
    const dateA = new Date(a.pushed_at || a.updatedAt).getTime();
    const dateB = new Date(b.pushed_at || b.updatedAt).getTime();
    return dateB - dateA;
  });

  const targetRepos = sortedRepos.slice(0, maxRepos);
  const results = await Promise.allSettled(
    targetRepos.map(async (repo) => {
      const commits = await fetchRepoCommits(repo.owner, repo.name, token, { perPage: perRepo });
      return commits.map((c) => ({
        ...c,
        repoId: repo.id,
        repoName: repo.name,
        repoFullName: repo.fullName,
        repoUrl: repo.url,
        repoLanguage: repo.language,
        isPrivate: repo.isPrivate,
      }));
    })
  );

  const allCommits = [];
  for (const res of results) {
    if (res.status === 'fulfilled' && Array.isArray(res.value)) {
      allCommits.push(...res.value);
    }
  }

  // Sort chronologically (newest first)
  return allCommits.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
}

function normalizeCommit(raw, repoInfo) {
  const commit = raw.commit || {};
  const message = commit.message || '';
  const [headline, ...rest] = message.split('\n');
  const body = rest.join('\n').trim();

  return {
    sha: raw.sha,
    shortSha: raw.sha ? raw.sha.slice(0, 7) : '',
    url: raw.html_url || (raw.url ? raw.url.replace('api.github.com/repos', 'github.com').replace('/commits/', '/commit/') : '#'),
    message,
    headline: headline || 'No commit message',
    body,
    authorName: commit.author?.name || raw.author?.login || 'Unknown',
    authorLogin: raw.author?.login || '',
    authorAvatar: raw.author?.avatar_url || '',
    date: commit.author?.date || commit.committer?.date || '',
    verified: Boolean(commit.verification?.verified),
  };
}

/**
 * Helper to build GitHub search query qualifier for star ranges.
 * Supports:
 * - Both min and max: "stars:min..max"
 * - Only min: "stars:>=min"
 * - Only max: "stars:floor..max" (or "stars:<=max")
 */
export function buildStarsQualifier(starsMin = 0, starsMax = 0, defaultFloor = 0) {
  const min = Math.max(0, parseInt(starsMin, 10) || 0);
  const max = Math.max(0, parseInt(starsMax, 10) || 0);

  if (min > 0 && max > 0) {
    const low = Math.min(min, max);
    const high = Math.max(min, max);
    return `stars:${low}..${high}`;
  } else if (min > 0) {
    return `stars:>=${min}`;
  } else if (max > 0) {
    const floor = defaultFloor > 0 ? defaultFloor : 0;
    return floor > 0 ? `stars:${floor}..${max}` : `stars:<=${max}`;
  } else if (defaultFloor > 0) {
    return `stars:>=${defaultFloor}`;
  }
  return '';
}

/**
 * Fetches trending repositories from GitHub Search API.
 * Supports timeframes (today, week, month), modes (breakout, surging),
 * custom star ranges (e.g. 100..5000), activity recency, language, and topic filters.
 */
export async function fetchTrendingRepos(
  token,
  {
    timeframe = 'week',
    language = '',
    topic = '',
    mode = 'breakout',
    starsMin = 0,
    starsMax = 0,
    minStars = 0,
    maxStars = 0,
    activity = 'anytime',
    perPage = 30,
  } = {}
) {
  let days = 7;
  if (timeframe === 'today') days = 2;
  else if (timeframe === 'month') days = 30;

  const sinceDate = new Date(Date.now() - days * 86400000).toISOString().split('T')[0];

  let queryParts = [];
  if (mode === 'surging') {
    queryParts.push(`pushed:>${sinceDate}`);
  } else {
    // Default: Breakout launches created recently
    queryParts.push(`created:>${sinceDate}`);
  }

  // Star range filter (eliminates 80k+ monoliths)
  const sMin = starsMin || minStars || 0;
  const sMax = starsMax || maxStars || 0;
  const defaultFloor = mode === 'surging' ? 250 : 10;
  const starsQual = buildStarsQualifier(sMin, sMax, defaultFloor);
  if (starsQual) {
    queryParts.push(starsQual);
  }

  if (language && language !== 'all') {
    queryParts.push(`language:${language.toLowerCase()}`);
  }

  if (topic && topic !== 'all') {
    queryParts.push(`topic:${topic.toLowerCase()}`);
  }

  if (activity && activity !== 'anytime') {
    let actDays = 7;
    if (activity === 'month') actDays = 30;
    else if (activity === '6months') actDays = 180;
    else if (activity === 'year') actDays = 365;
    const actSince = new Date(Date.now() - actDays * 86400000).toISOString().split('T')[0];
    queryParts.push(`pushed:>${actSince}`);
  }

  const query = queryParts.join(' ');
  const data = await githubRequest(
    `/search/repositories?q=${encodeURIComponent(query)}&sort=stars&order=desc&per_page=${perPage}`,
    token
  );

  const items = Array.isArray(data.items) ? data.items : [];
  return items.map((item, idx) => {
    const daysOld = Math.max(1, Math.round((Date.now() - new Date(item.created_at).getTime()) / 86400000));
    const starsPerDay = Math.round(item.stargazers_count / daysOld);

    return {
      rank: idx + 1,
      id: item.id,
      name: item.name,
      fullName: item.full_name,
      owner: item.owner?.login || '',
      ownerAvatar: item.owner?.avatar_url || '',
      ownerUrl: item.owner?.html_url || '',
      url: item.html_url,
      description: item.description || '',
      stars: item.stargazers_count ?? 0,
      forks: item.forks_count ?? 0,
      language: item.language || '',
      topics: Array.isArray(item.topics) ? item.topics : [],
      createdAt: item.created_at,
      updatedAt: item.updated_at,
      pushedAt: item.pushed_at,
      daysOld,
      starsPerDay,
      cloneUrl: item.clone_url || `https://github.com/${item.full_name}.git`,
      sshUrl: item.ssh_url || `git@github.com:${item.full_name}.git`,
    };
  });
}

/**
 * Fetches repositories filtered by one or more topic categories.
 * Supports sorting by:
 * - 'trending': highest velocity/momentum in chosen timeframe (today, week, month)
 * - 'stars': highest total stars
 * - 'forks': highest forks count
 * - 'updated': most recently updated
 * Supports custom star ranges (e.g. 100..5000), language, and activity filters.
 */
export async function fetchReposByTopics(
  token,
  {
    topics = [],
    sortBy = 'trending',
    timeframe = 'week',
    minStars = 0,
    maxStars = 0,
    starsMin = 0,
    starsMax = 0,
    language = '',
    activity = 'anytime',
    query = '',
    perPage = 30,
  } = {}
) {
  const queryParts = [];

  // 1. Topic filtering (comma-separated acts as OR in GitHub Search API)
  const validTopics = (Array.isArray(topics) ? topics : [topics])
    .map((t) => (typeof t === 'string' ? t.toLowerCase().trim().replace(/^topic:/i, '') : ''))
    .filter(Boolean);

  if (validTopics.length > 0) {
    queryParts.push(`topic:${validTopics.join(',')}`);
  }

  // 2. Extra keyword query if provided
  if (query && query.trim()) {
    queryParts.push(query.trim());
  }

  // 3. Timeframe or activity constraint
  if (activity && activity !== 'anytime') {
    let actDays = 7;
    if (activity === 'month') actDays = 30;
    else if (activity === '6months') actDays = 180;
    else if (activity === 'year') actDays = 365;
    const actSince = new Date(Date.now() - actDays * 86400000).toISOString().split('T')[0];
    queryParts.push(`pushed:>${actSince}`);
  } else if (sortBy === 'trending') {
    let days = 7;
    if (timeframe === 'today') days = 2;
    else if (timeframe === 'month') days = 30;
    const sinceDate = new Date(Date.now() - days * 86400000).toISOString().split('T')[0];
    queryParts.push(`pushed:>${sinceDate}`);
  }

  // 4. Custom Star Range (e.g. 100..5000 to exclude 80k monoliths)
  const sMin = starsMin || minStars || 0;
  const sMax = starsMax || maxStars || 0;
  const defaultFloor = sortBy === 'trending' ? 10 : 0;
  const starsQual = buildStarsQualifier(sMin, sMax, defaultFloor);
  if (starsQual) {
    queryParts.push(starsQual);
  }

  // 5. Language filter
  if (language && language !== 'all') {
    queryParts.push(`language:${language.toLowerCase()}`);
  }

  // If queryParts is empty, default to popular AI/ML repos with star ceiling
  if (queryParts.length === 0) {
    queryParts.push('topic:ai-agents,model-classifier,llm stars:100..15000');
  }

  // Determine GitHub sort parameter
  let ghSort = 'stars';
  let ghOrder = 'desc';
  if (sortBy === 'forks') {
    ghSort = 'forks';
  } else if (sortBy === 'updated') {
    ghSort = 'updated';
  } else {
    ghSort = 'stars';
  }

  const queryString = queryParts.join(' ');
  const data = await githubRequest(
    `/search/repositories?q=${encodeURIComponent(queryString)}&sort=${ghSort}&order=${ghOrder}&per_page=${perPage}`,
    token
  );

  const items = Array.isArray(data.items) ? data.items : [];
  const normalized = items.map((item) => {
    const daysOld = Math.max(1, Math.round((Date.now() - new Date(item.created_at).getTime()) / 86400000));
    const starsPerDay = Math.round((item.stargazers_count ?? 0) / daysOld);

    return {
      id: item.id,
      name: item.name,
      fullName: item.full_name,
      owner: item.owner?.login || '',
      ownerAvatar: item.owner?.avatar_url || '',
      ownerUrl: item.owner?.html_url || '',
      url: item.html_url,
      description: item.description || '',
      stars: item.stargazers_count ?? 0,
      forks: item.forks_count ?? 0,
      language: item.language || '',
      topics: Array.isArray(item.topics) ? item.topics : [],
      createdAt: item.created_at,
      updatedAt: item.updated_at,
      pushedAt: item.pushed_at,
      daysOld,
      starsPerDay,
      cloneUrl: item.clone_url || `https://github.com/${item.full_name}.git`,
    };
  });

  // If sorting by trending velocity, sort by starsPerDay descending so high-velocity breakout repos rank first
  if (sortBy === 'trending') {
    normalized.sort((a, b) => b.starsPerDay - a.starsPerDay || b.stars - a.stars);
  }

  // Assign 1-indexed ranks
  return normalized.map((item, idx) => ({
    ...item,
    rank: idx + 1,
  }));
}

/**
 * Fetches the full raw README markdown for a repository.
 * Returns null if no README exists (HTTP 404).
 */
export async function fetchFullReadme(owner, repoName, token) {
  try {
    const text = await githubRequest(`/repos/${owner}/${repoName}/readme`, token, {
      acceptRaw: true,
    });
    return typeof text === 'string' ? text : '';
  } catch (err) {
    if (err.message && (err.message.includes('404') || err.message.toLowerCase().includes('not found'))) {
      return null;
    }
    throw err;
  }
}

/**
 * Fetches directory contents or file metadata for a given path.
 * Returns sorted list with directories first, then files.
 */
export async function fetchRepoContents(owner, repoName, token, path = '') {
  const cleanPath = path.startsWith('/') ? path.slice(1) : path;
  const endpoint = cleanPath ? `/repos/${owner}/${repoName}/contents/${cleanPath}` : `/repos/${owner}/${repoName}/contents`;
  const items = await githubRequest(endpoint, token);
  if (!Array.isArray(items)) {
    return items;
  }

  return items
    .map((item) => ({
      name: item.name,
      path: item.path,
      type: item.type, // 'dir' | 'file' | 'symlink' | 'submodule'
      size: item.size || 0,
      url: item.html_url,
      downloadUrl: item.download_url,
    }))
    .sort((a, b) => {
      if (a.type === 'dir' && b.type !== 'dir') return -1;
      if (a.type !== 'dir' && b.type === 'dir') return 1;
      return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
    });
}

/**
 * Fetches language byte distribution for a repository.
 * e.g. { TypeScript: 154200, CSS: 23100, HTML: 12400 }
 */
export async function fetchRepoLanguages(owner, repoName, token) {
  try {
    const data = await githubRequest(`/repos/${owner}/${repoName}/languages`, token);
    return data && typeof data === 'object' ? data : {};
  } catch {
    return {};
  }
}

/**
 * Fetches recent open issues and pull requests for a repository.
 */
export async function fetchRepoIssuesAndPRs(owner, repoName, token) {
  try {
    const items = await githubRequest(`/repos/${owner}/${repoName}/issues?state=open&per_page=15&sort=updated`, token);
    if (!Array.isArray(items)) return [];

    return items.map((item) => ({
      id: item.id,
      number: item.number,
      title: item.title,
      url: item.html_url,
      isPR: Boolean(item.pull_request),
      author: item.user?.login || 'unknown',
      authorAvatar: item.user?.avatar_url || '',
      labels: Array.isArray(item.labels)
        ? item.labels.map((l) => ({
            name: typeof l === 'string' ? l : l.name,
            color: typeof l === 'object' && l.color ? `#${l.color}` : '#58a6ff',
          }))
        : [],
      comments: item.comments || 0,
      createdAt: item.created_at,
      updatedAt: item.updated_at,
    }));
  } catch {
    return [];
  }
}

/**
 * Fetches commit activity for the last 12 weeks.
 * Returns an array of 12 integers representing commits per week.
 */
export async function fetchRepoCommitActivity(owner, repoName, token) {
  try {
    const stats = await githubRequest(`/repos/${owner}/${repoName}/stats/commit_activity`, token);
    if (Array.isArray(stats) && stats.length >= 12) {
      return stats.slice(-12).map((w) => w.total || 0);
    }
  } catch {}

  // Fallback: fetch recent commits and bucket into the last 12 weeks
  try {
    const commits = await githubRequest(`/repos/${owner}/${repoName}/commits?per_page=50`, token);
    if (!Array.isArray(commits)) return new Array(12).fill(0);

    const now = Date.now();
    const ONE_WEEK_MS = 7 * 24 * 60 * 60 * 1000;
    const weeklyBuckets = new Array(12).fill(0);

    for (const c of commits) {
      const dateStr = c.commit?.committer?.date || c.commit?.author?.date;
      if (!dateStr) continue;
      const t = new Date(dateStr).getTime();
      const diffWeeks = Math.floor((now - t) / ONE_WEEK_MS);
      if (diffWeeks >= 0 && diffWeeks < 12) {
        // Index 11 is the most recent week, index 0 is 12 weeks ago
        weeklyBuckets[11 - diffWeeks]++;
      }
    }
    return weeklyBuckets;
  } catch {
    return new Array(12).fill(0);
  }
}




