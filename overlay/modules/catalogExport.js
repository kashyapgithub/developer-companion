// overlay/modules/catalogExport.js
//
// Exports repository catalog as Markdown Table, CSV Spreadsheet, or JSON.

function normalizeParams(arg2, arg3, arg4, arg5) {
  let descriptionsMap = new Map();
  let repoTags = {};
  let customTags = [];
  let folders = [];

  if (arg2 instanceof Map) {
    descriptionsMap = arg2;
    repoTags = arg3 || {};
    customTags = Array.isArray(arg4) ? arg4 : [];
    folders = Array.isArray(arg5) ? arg5 : [];
  } else if (arg2 && typeof arg2 === 'object') {
    descriptionsMap = arg2.descriptions || arg2.descriptionsById || new Map();
    repoTags = arg2.repoTags || {};
    customTags = Array.isArray(arg2.customTags) ? arg2.customTags : [];
    folders = Array.isArray(arg2.folders) ? arg2.folders : [];
  }

  function getAiText(repoId) {
    const val = descriptionsMap.get(repoId);
    if (!val) return '';
    return typeof val === 'string' ? val : val.text || '';
  }

  return {
    foldersMap: new Map(folders.map((f) => [f.id, f.name])),
    tagsMap: new Map(customTags.map((t) => [t.id, t.name])),
    repoTags,
    getAiText,
  };
}

export function exportCatalogAsMarkdown(repos, arg2, arg3, arg4, arg5) {
  const { foldersMap, tagsMap, repoTags, getAiText } = normalizeParams(arg2, arg3, arg4, arg5);

  const rows = [];
  rows.push('# GitHub Repository Catalog');
  rows.push(`*Generated on ${new Date().toLocaleDateString()} — ${repos.length} total repositories*\n`);
  rows.push('| Repository | Description | Language | Stars | Forks | Issues | Status | Folder | Tags | URL |');
  rows.push('| :--- | :--- | :--- | :---: | :---: | :---: | :---: | :--- | :--- | :--- |');

  for (const r of repos) {
    const ai = getAiText(r.id);
    const desc = (ai || r.description || '—').replace(/\|/g, '\\|').replace(/\n/g, ' ');
    const folder = r.folderId ? foldersMap.get(r.folderId) || '—' : '—';
    const tagNames = (repoTags[r.id] || [])
      .map((tId) => tagsMap.get(tId))
      .filter(Boolean)
      .join(', ') || '—';
    const status = [
      r.isPinned ? '📌' : '',
      r.isPrivate ? 'Private' : 'Public',
      r.isFork ? (r.looksUntouched ? 'Untouched' : 'Fork') : 'Original',
    ].filter(Boolean).join(' · ');

    rows.push(
      `| **[${r.name}](${r.url})** | ${desc} | ${r.language || '—'} | ${r.stars} | ${r.forksCount ?? 0} | ${r.openIssues ?? 0} | ${status} | ${folder} | ${tagNames} | [Link](${r.url}) |`
    );
  }

  return rows.join('\n');
}

export function exportCatalogAsCsv(repos, arg2, arg3, arg4, arg5) {
  const { foldersMap, tagsMap, repoTags, getAiText } = normalizeParams(arg2, arg3, arg4, arg5);

  function escapeCsv(val) {
    if (val == null) return '""';
    const str = String(val).replace(/"/g, '""');
    return `"${str}"`;
  }

  const headers = [
    'Name',
    'Full Name',
    'Description',
    'AI Summary',
    'Language',
    'Stars',
    'Forks',
    'Open Issues',
    'Visibility',
    'Type',
    'Pinned',
    'Folder',
    'Tags',
    'URL',
    'Created At',
    'Last Pushed At',
  ];

  const rows = [headers.map(escapeCsv).join(',')];

  for (const r of repos) {
    const ai = getAiText(r.id);
    const folder = r.folderId ? foldersMap.get(r.folderId) || '' : '';
    const tagNames = (repoTags[r.id] || [])
      .map((tId) => tagsMap.get(tId))
      .filter(Boolean)
      .join(', ');

    const line = [
      escapeCsv(r.name),
      escapeCsv(r.fullName),
      escapeCsv(r.description || ''),
      escapeCsv(ai),
      escapeCsv(r.language || ''),
      r.stars ?? 0,
      r.forksCount ?? 0,
      r.openIssues ?? 0,
      escapeCsv(r.isPrivate ? 'Private' : 'Public'),
      escapeCsv(r.isFork ? (r.looksUntouched ? 'Untouched Fork' : 'Fork') : 'Original'),
      r.isPinned ? 'true' : 'false',
      escapeCsv(folder),
      escapeCsv(tagNames),
      escapeCsv(r.url),
      escapeCsv(r.createdAt || ''),
      escapeCsv(r.pushed_at || ''),
    ];
    rows.push(line.join(','));
  }

  return rows.join('\r\n');
}

export function exportCatalogAsJson(repos, arg2, arg3, arg4, arg5) {
  const { foldersMap, tagsMap, repoTags, getAiText } = normalizeParams(arg2, arg3, arg4, arg5);

  const catalog = {
    exportedAt: new Date().toISOString(),
    totalCount: repos.length,
    repositories: repos.map((r) => ({
      id: r.id,
      name: r.name,
      fullName: r.fullName,
      url: r.url,
      cloneUrl: r.cloneUrl || `https://github.com/${r.fullName}.git`,
      sshUrl: `git@github.com:${r.fullName}.git`,
      description: r.description || null,
      aiSummary: getAiText(r.id) || null,
      language: r.language || null,
      stars: r.stars,
      forks: r.forksCount ?? 0,
      openIssues: r.openIssues ?? 0,
      isPrivate: r.isPrivate,
      isFork: r.isFork,
      isPinned: r.isPinned,
      folder: r.folderId ? { id: r.folderId, name: foldersMap.get(r.folderId) || null } : null,
      tags: (repoTags[r.id] || []).map((tId) => ({ id: tId, name: tagsMap.get(tId) || tId })),
      createdAt: r.createdAt,
      pushedAt: r.pushed_at,
    })),
  };

  return JSON.stringify(catalog, null, 2);
}

export function triggerDownload(filename, content, mimeType = 'text/plain;charset=utf-8') {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
