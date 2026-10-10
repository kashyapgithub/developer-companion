// overlay/modules/storage.js
//
// A thin wrapper around chrome.storage.local. Everything the dashboard
// persists — the GitHub token, the AI provider choice, per-provider
// API keys, and cached AI descriptions — goes through this one file so
// no other module has to know the actual storage keys or shape.

const SETTINGS_KEY = 'settings';

// AI description cache uses one storage key PER REPO ("desc_<id>")
// rather than one giant object. That way, generating a description
// for one repo only ever reads/writes that repo's key instead of
// re-serializing hundreds of cached descriptions on every save.
const DESC_CACHE_PREFIX = 'desc_';

/** Returns the saved settings, or sensible empty defaults on first run. */
export async function getSettings() {
  const { [SETTINGS_KEY]: settings } = await chrome.storage.local.get(SETTINGS_KEY);
  return {
    githubToken: '',
    aiProvider: '',
    aiApiKeys: {},
    autoRefreshInterval: 10, // 5 | 10 | 30 | 60 | 0 (0 = manual only)
    ...(settings || {}),
  };
}

export async function saveSettings(settings) {
  const current = await getSettings();
  const merged = { ...current, ...settings };
  await chrome.storage.local.set({ [SETTINGS_KEY]: merged });
  return merged;
}

/**
 * Returns { pushedAt, description } for a repo if we've generated one
 * before, or null if we haven't. Callers compare `pushedAt` against
 * the repo's current pushed_at to decide whether the cached text is
 * still valid — this is what makes descriptions "generate once".
 */
export async function getCachedDescription(repoId) {
  const key = DESC_CACHE_PREFIX + repoId;
  const result = await chrome.storage.local.get(key);
  return result[key] ?? null;
}

export async function setCachedDescription(repoId, entry) {
  const key = DESC_CACHE_PREFIX + repoId;
  await chrome.storage.local.set({ [key]: entry });
}

/** Wipes every cached description (used by the "Clear cache" button). */
export async function clearDescriptionCache() {
  const all = await chrome.storage.local.get(null);
  const keysToRemove = Object.keys(all).filter((key) => key.startsWith(DESC_CACHE_PREFIX));
  if (keysToRemove.length > 0) {
    await chrome.storage.local.remove(keysToRemove);
  }
}

const UI_PREFS_KEY = 'ui_prefs';

/** Returns saved UI preferences (viewMode, groupBy, inspectorOpen, activeFolderId) */
export async function getUiPreferences() {
  const { [UI_PREFS_KEY]: prefs } = await chrome.storage.local.get(UI_PREFS_KEY);
  return {
    viewMode: prefs?.viewMode ?? 'tiles', // 'tiles' | 'list'
    groupBy: prefs?.groupBy ?? 'none',   // 'none' | 'folder' | 'language' | 'type' | 'year'
    inspectorOpen: prefs?.inspectorOpen ?? true,
    activeFolderId: prefs?.activeFolderId ?? 'all', // 'all' | 'pinned' | folderId
  };
}

export async function saveUiPreferences(newPrefs) {
  const current = await getUiPreferences();
  const merged = { ...current, ...newPrefs };
  await chrome.storage.local.set({ [UI_PREFS_KEY]: merged });
  return merged;
}

const PINNED_REPOS_KEY = 'pinned_repos';
const FOLDERS_KEY = 'custom_folders';
const REPO_FOLDERS_KEY = 'repo_folders';

/** Returns array of pinned repo IDs (numbers) */
export async function getPinnedRepoIds() {
  const { [PINNED_REPOS_KEY]: ids } = await chrome.storage.local.get(PINNED_REPOS_KEY);
  return Array.isArray(ids) ? ids : [];
}

export async function setPinnedRepoIds(ids) {
  await chrome.storage.local.set({ [PINNED_REPOS_KEY]: ids });
}

export async function togglePinnedRepo(repoId) {
  const current = await getPinnedRepoIds();
  const index = current.indexOf(repoId);
  let isPinned = false;
  let updated;
  if (index >= 0) {
    updated = current.filter((id) => id !== repoId);
    isPinned = false;
  } else {
    updated = [...current, repoId];
    isPinned = true;
  }
  await setPinnedRepoIds(updated);
  return isPinned;
}

/** Returns array of folders: [ { id, name, icon, color, createdAt } ] */
export async function getFolders() {
  const { [FOLDERS_KEY]: folders } = await chrome.storage.local.get(FOLDERS_KEY);
  return Array.isArray(folders) ? folders : [];
}

export async function saveFolders(folders) {
  await chrome.storage.local.set({ [FOLDERS_KEY]: folders });
}

export async function createFolder({ name, color = '#0071e3' }) {
  const folders = await getFolders();
  const newFolder = {
    id: 'f_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7),
    name: name.trim(),
    color: color || '#0071e3',
    createdAt: new Date().toISOString(),
  };
  folders.push(newFolder);
  await saveFolders(folders);
  return newFolder;
}

export async function updateFolder(folderId, { name, color }) {
  const folders = await getFolders();
  const folder = folders.find((f) => f.id === folderId);
  if (folder) {
    if (name !== undefined) folder.name = name.trim();
    if (color !== undefined) folder.color = color;
    await saveFolders(folders);
  }
  return folder;
}

export async function deleteFolder(folderId) {
  const folders = await getFolders();
  const updated = folders.filter((f) => f.id !== folderId);
  await saveFolders(updated);

  // Unassign any repos in this folder
  const repoFolders = await getRepoFolders();
  let changed = false;
  for (const [repoId, fId] of Object.entries(repoFolders)) {
    if (fId === folderId) {
      delete repoFolders[repoId];
      changed = true;
    }
  }
  if (changed) {
    await chrome.storage.local.set({ [REPO_FOLDERS_KEY]: repoFolders });
  }
}

/** Returns object mapping repoId -> folderId: { [repoId]: folderId } */
export async function getRepoFolders() {
  const { [REPO_FOLDERS_KEY]: map } = await chrome.storage.local.get(REPO_FOLDERS_KEY);
  return map && typeof map === 'object' ? map : {};
}

export async function setRepoFolder(repoId, folderId) {
  const repoFolders = await getRepoFolders();
  if (folderId) {
    repoFolders[repoId] = folderId;
  } else {
    delete repoFolders[repoId];
  }
  await chrome.storage.local.set({ [REPO_FOLDERS_KEY]: repoFolders });
}

export async function removeRepoFromFolder(repoId) {
  await setRepoFolder(repoId, null);
}

const TRENDING_WHY_KEY = 'trending_why_cache';
const TRENDING_WHY_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

export async function getCachedTrendingWhy(repoFullName) {
  const { [TRENDING_WHY_KEY]: cache } = await chrome.storage.local.get(TRENDING_WHY_KEY);
  if (!cache || typeof cache !== 'object') return null;
  const entry = cache[repoFullName];
  if (!entry || !entry.text) return null;
  if (Date.now() - entry.timestamp > TRENDING_WHY_TTL_MS) return null;
  return entry.text;
}

export async function setCachedTrendingWhy(repoFullName, text) {
  const { [TRENDING_WHY_KEY]: cache = {} } = await chrome.storage.local.get(TRENDING_WHY_KEY);
  cache[repoFullName] = {
    text,
    timestamp: Date.now(),
  };
  await chrome.storage.local.set({ [TRENDING_WHY_KEY]: cache });
}

const STARRED_TOPICS_KEY = 'starred_topics';
const DEFAULT_STARRED_TOPICS = ['ai-agents', 'model-classifier', 'llm', 'rag', 'rust', 'devtools'];

/** Returns array of topic slugs favorited/starred by user. */
export async function getStarredTopics() {
  const { [STARRED_TOPICS_KEY]: topics } = await chrome.storage.local.get(STARRED_TOPICS_KEY);
  return Array.isArray(topics) ? topics : [...DEFAULT_STARRED_TOPICS];
}

export async function saveStarredTopics(topics) {
  const clean = Array.isArray(topics) ? Array.from(new Set(topics.map((t) => t.toLowerCase().trim()))) : [];
  await chrome.storage.local.set({ [STARRED_TOPICS_KEY]: clean });
}

export async function toggleStarredTopic(topicSlug) {
  const normalized = topicSlug.toLowerCase().trim();
  const topics = await getStarredTopics();
  const set = new Set(topics);
  let isStarred = false;
  if (set.has(normalized)) {
    set.delete(normalized);
    isStarred = false;
  } else {
    set.add(normalized);
    isStarred = true;
  }
  await saveStarredTopics(Array.from(set));
  return isStarred;
}

const REPO_TAGS_KEY = 'repo_tags';
const CUSTOM_TAGS_KEY = 'custom_tags';
const DEFAULT_CUSTOM_TAGS = [
  { id: 'tag-prototype', name: 'Prototype', color: '#ff9500' },
  { id: 'tag-production', name: 'Production', color: '#34c759' },
  { id: 'tag-client', name: 'Client', color: '#0071e3' },
  { id: 'tag-template', name: 'Template', color: '#af52de' },
  { id: 'tag-archive', name: 'Archive', color: '#8e8e93' },
];

/** Returns map of repoId -> array of tag IDs */
export async function getRepoTags() {
  const { [REPO_TAGS_KEY]: tags } = await chrome.storage.local.get(REPO_TAGS_KEY);
  return tags && typeof tags === 'object' ? tags : {};
}

/** Updates tags array for a single repository */
export async function setRepoTags(repoId, tagsList) {
  const all = await getRepoTags();
  if (!tagsList || tagsList.length === 0) {
    delete all[repoId];
  } else {
    all[repoId] = Array.from(new Set(tagsList));
  }
  await chrome.storage.local.set({ [REPO_TAGS_KEY]: all });
  return all;
}

/** Returns list of all defined custom tags */
export async function getCustomTags() {
  const { [CUSTOM_TAGS_KEY]: tags } = await chrome.storage.local.get(CUSTOM_TAGS_KEY);
  return Array.isArray(tags) && tags.length > 0 ? tags : [...DEFAULT_CUSTOM_TAGS];
}

export async function saveCustomTags(tags) {
  await chrome.storage.local.set({ [CUSTOM_TAGS_KEY]: tags });
}

export async function addCustomTag(name, color = '#0071e3') {
  const tags = await getCustomTags();
  const id = `tag-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const newTag = { id, name: name.trim(), color };
  tags.push(newTag);
  await saveCustomTags(tags);
  return newTag;
}

export async function deleteCustomTag(tagId) {
  const tags = await getCustomTags();
  const filtered = tags.filter((t) => t.id !== tagId);
  await saveCustomTags(filtered);

  const allRepoTags = await getRepoTags();
  let changed = false;
  for (const [rId, rTags] of Object.entries(allRepoTags)) {
    if (Array.isArray(rTags) && rTags.includes(tagId)) {
      allRepoTags[rId] = rTags.filter((t) => t !== tagId);
      changed = true;
    }
  }
  if (changed) {
    await chrome.storage.local.set({ [REPO_TAGS_KEY]: allRepoTags });
  }
}

/** Exports all custom organization data (folders, assignments, pins, topics, tags, prefs) */
export async function exportConfiguration() {
  const folders = await getFolders();
  const repoFolders = await getRepoFolders();
  const pinnedRepoIds = await getPinnedRepoIds();
  const starredTopics = await getStarredTopics();
  const repoTags = await getRepoTags();
  const customTags = await getCustomTags();
  const uiPrefs = await getUiPreferences();

  return {
    version: 2,
    exportedAt: new Date().toISOString(),
    folders,
    repoFolders,
    pinnedRepoIds,
    starredTopics,
    repoTags,
    customTags,
    uiPrefs,
  };
}

/** Restores configuration from imported JSON object */
export async function importConfiguration(imported) {
  if (!imported || typeof imported !== 'object') {
    throw new Error('Invalid configuration file format');
  }

  if (Array.isArray(imported.folders)) {
    await saveFolders(imported.folders);
  }
  if (imported.repoFolders && typeof imported.repoFolders === 'object') {
    await chrome.storage.local.set({ [REPO_FOLDERS_KEY]: imported.repoFolders });
  }
  if (Array.isArray(imported.pinnedRepoIds)) {
    await setPinnedRepoIds(imported.pinnedRepoIds);
  }
  if (Array.isArray(imported.starredTopics)) {
    await saveStarredTopics(imported.starredTopics);
  }
  if (imported.repoTags && typeof imported.repoTags === 'object') {
    await chrome.storage.local.set({ [REPO_TAGS_KEY]: imported.repoTags });
  }
  if (Array.isArray(imported.customTags)) {
    await saveCustomTags(imported.customTags);
  }
  if (imported.uiPrefs && typeof imported.uiPrefs === 'object') {
    await saveUiPreferences(imported.uiPrefs);
  }
  return true;
}


