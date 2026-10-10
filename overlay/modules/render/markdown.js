// overlay/modules/render/markdown.js
//
// Fast, secure, zero-dependency Markdown-to-HTML converter.
// Renders READMEs and documentation inside the Detail Inspector.
// Escapes HTML entities to prevent XSS.

import { escapeHtml } from '../format.js';

export function renderMarkdown(rawMd, { repoFullName = '', defaultBranch = 'main' } = {}) {
  if (!rawMd || typeof rawMd !== 'string') return '<p class="md-empty">No content to display.</p>';

  const lines = rawMd.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  const out = [];

  let inCodeBlock = false;
  let codeBlockLang = '';
  let codeBlockLines = [];

  let inTable = false;
  let tableHeaderParsed = false;

  let inList = false;
  let listType = 'ul'; // 'ul' | 'ol'

  const rawBaseUrl = repoFullName ? `https://raw.githubusercontent.com/${repoFullName}/${defaultBranch}/` : '';
  const githubBaseUrl = repoFullName ? `https://github.com/${repoFullName}/blob/${defaultBranch}/` : '';

  function resolveUrl(url, isImage = false) {
    if (!url) return '';
    if (/^(https?:|\/\/|data:|mailto:)/i.test(url)) return url;
    const clean = url.replace(/^\.\//, '');
    return isImage ? `${rawBaseUrl}${clean}` : `${githubBaseUrl}${clean}`;
  }

  function formatInline(text) {
    let s = escapeHtml(text);

    // Inline code: `code`
    s = s.replace(/`([^`]+)`/g, '<code class="md-inline-code">$1</code>');

    // Images: ![alt](url)
    s = s.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (match, alt, url) => {
      const resolved = resolveUrl(url.trim(), true);
      return `<img src="${escapeHtml(resolved)}" alt="${escapeHtml(alt)}" class="md-img" loading="lazy" />`;
    });

    // Links: [text](url)
    s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (match, text, url) => {
      const resolved = resolveUrl(url.trim(), false);
      return `<a href="${escapeHtml(resolved)}" target="_blank" rel="noopener" class="md-link">${text}</a>`;
    });

    // Bold + Italic: ***text*** or ___text___
    s = s.replace(/(\*\*\*|___)(.+?)\1/g, '<strong><em>$2</em></strong>');

    // Bold: **text** or __text__
    s = s.replace(/(\*\*|__)(.+?)\1/g, '<strong>$2</strong>');

    // Italic: *text* or _text_
    s = s.replace(/(\*|_)(.+?)\1/g, '<em>$2</em>');

    // Strikethrough: ~~text~~
    s = s.replace(/~~(.+?)~~/g, '<del>$1</del>');

    return s;
  }

  function closeList() {
    if (inList) {
      out.push(listType === 'ol' ? '</ol>' : '</ul>');
      inList = false;
    }
  }

  function closeTable() {
    if (inTable) {
      out.push('</tbody></table></div>');
      inTable = false;
      tableHeaderParsed = false;
    }
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // 1. Code blocks (``` or ~~~)
    if (trimmed.startsWith('```') || trimmed.startsWith('~~~')) {
      if (inCodeBlock) {
        closeList();
        closeTable();
        const codeContent = escapeHtml(codeBlockLines.join('\n'));
        const langClass = codeBlockLang ? ` class="language-${escapeHtml(codeBlockLang)}"` : '';
        const langHeader = `
          <div class="md-code-header">
            <span class="md-code-lang">${escapeHtml(codeBlockLang || 'text')}</span>
            <button type="button" class="md-copy-btn" title="Copy snippet">Copy</button>
          </div>
        `;
        out.push(
          `<div class="md-code-wrap">${langHeader}<pre class="md-pre"><code${langClass}>${codeContent}</code></pre></div>`
        );
        inCodeBlock = false;
        codeBlockLines = [];
        codeBlockLang = '';
      } else {
        closeList();
        closeTable();
        inCodeBlock = true;
        codeBlockLang = trimmed.slice(3).trim().toLowerCase();
        codeBlockLines = [];
      }
      continue;
    }

    if (inCodeBlock) {
      codeBlockLines.push(line);
      continue;
    }

    // 2. Empty lines
    if (!trimmed) {
      closeList();
      closeTable();
      continue;
    }

    // 3. Headings (#, ##, ###, ####, #####, ######)
    const headingMatch = line.match(/^(#{1,6})\s+(.*)$/);
    if (headingMatch) {
      closeList();
      closeTable();
      const level = headingMatch[1].length;
      const content = formatInline(headingMatch[2]);
      out.push(`<h${level} class="md-h md-h${level}">${content}</h${level}>`);
      continue;
    }

    // 4. Horizontal Rule (---, ***, ___)
    if (/^(\-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
      closeList();
      closeTable();
      out.push('<hr class="md-hr" />');
      continue;
    }

    // 5. Blockquotes (> text)
    if (line.startsWith('>')) {
      closeList();
      closeTable();
      const quoteText = formatInline(line.replace(/^>\s?/, ''));
      out.push(`<blockquote class="md-blockquote"><p>${quoteText}</p></blockquote>`);
      continue;
    }

    // 6. Tables (| col | col |)
    if (trimmed.startsWith('|') && trimmed.endsWith('|')) {
      closeList();
      const cells = trimmed
        .slice(1, -1)
        .split('|')
        .map((c) => c.trim());

      // Check if it's the separator line |---|---|
      const isSeparator = cells.every((c) => /^:?-+:?$/.test(c));
      if (isSeparator) {
        continue;
      }

      if (!inTable) {
        inTable = true;
        tableHeaderParsed = true;
        const ths = cells.map((c) => `<th>${formatInline(c)}</th>`).join('');
        out.push(`<div class="md-table-wrap"><table class="md-table"><thead><tr>${ths}</tr></thead><tbody>`);
        continue;
      } else {
        const tds = cells.map((c) => `<td>${formatInline(c)}</td>`).join('');
        out.push(`<tr>${tds}</tr>`);
        continue;
      }
    } else {
      closeTable();
    }

    // 7. Unordered Lists (- , * , + )
    const ulMatch = line.match(/^(\s*)([-*+])\s+(.*)$/);
    if (ulMatch) {
      closeTable();
      if (!inList || listType !== 'ul') {
        closeList();
        inList = true;
        listType = 'ul';
        out.push('<ul class="md-list md-ul">');
      }
      out.push(`<li>${formatInline(ulMatch[3])}</li>`);
      continue;
    }

    // 8. Ordered Lists (1. , 2. )
    const olMatch = line.match(/^(\s*)\d+\.\s+(.*)$/);
    if (olMatch) {
      closeTable();
      if (!inList || listType !== 'ol') {
        closeList();
        inList = true;
        listType = 'ol';
        out.push('<ol class="md-list md-ol">');
      }
      out.push(`<li>${formatInline(olMatch[2])}</li>`);
      continue;
    }

    closeList();

    // 9. Standard Paragraph
    out.push(`<p class="md-p">${formatInline(line)}</p>`);
  }

  closeList();
  closeTable();

  if (inCodeBlock) {
    const codeContent = escapeHtml(codeBlockLines.join('\n'));
    out.push(`<pre class="md-pre"><code>${codeContent}</code></pre>`);
  }

  return out.join('\n');
}
