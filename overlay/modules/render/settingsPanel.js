// overlay/modules/render/settingsPanel.js
//
// Renders the settings form as a centered modal (with a backdrop).

import { saveSettings, clearDescriptionCache, exportConfiguration, importConfiguration } from '../storage.js';
import { testGithubToken, getRateLimitStatus, onRateLimitChange } from '../github-api.js';
import { testAiKey } from '../ai/index.js';
import { escapeHtml } from '../format.js';

const PROVIDER_LABELS = {
  gemini: 'Google Gemini (Auto-selects Flash e.g. 3.8 Flash, Free tier available)',
  openai: 'OpenAI (Auto-selects GPT-4o mini)',
  anthropic: 'Anthropic (Auto-selects Claude 3.5 Haiku)',
  openrouter: 'OpenRouter (Auto-selects Gemini 2.0 Flash / DeepSeek / GPT-4o mini / Haiku)',
};

const PROVIDER_PLACEHOLDERS = {
  gemini: 'AIzaSy…',
  openai: 'sk-…',
  anthropic: 'sk-ant-…',
  openrouter: 'sk-or-v1-…',
};

const PROVIDER_HINTS = {
  gemini: 'Free tier available via <a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noopener" class="link-external">Google AI Studio ↗</a>.',
  openai: 'Requires key from <a href="https://platform.openai.com/api-keys" target="_blank" rel="noopener" class="link-external">OpenAI Platform ↗</a>.',
  anthropic: 'Requires key from <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noopener" class="link-external">Anthropic Console ↗</a>.',
  openrouter: 'Unified access to 300+ models. Get your key at <a href="https://openrouter.ai/keys" target="_blank" rel="noopener" class="link-external">openrouter.ai/keys ↗</a>.',
};

export function renderSettingsPanel(container, { settings, onSaved, forceOpen, onExportCatalog }) {
  container.innerHTML = `
    ${
      forceOpen
        ? ''
        : `<button class="settings__toggle" type="button" aria-label="Open settings" title="Settings">
            <svg class="icon icon-gear" viewBox="0 0 16 16" fill="currentColor">
              <path d="M8 0a8.2 8.2 0 0 0-.701.031C7.03.044 6.75.244 6.64.53l-.265.688a.8.8 0 0 1-.95.485l-.717-.2a.8.8 0 0 0-.916.38l-.7 1.212a.8.8 0 0 0 .193.987l.55.51a.8.8 0 0 1 0 1.176l-.55.51a.8.8 0 0 0-.193.987l.7 1.212a.8.8 0 0 0 .916.38l.717-.2a.8.8 0 0 1 .95.485l.265.688c.11.286.39.486.659.499A8.2 8.2 0 0 0 8 16a8.2 8.2 0 0 0 .701-.031c.269-.013.549-.213.659-.499l.265-.688a.8.8 0 0 1 .95-.485l.717.2a.8.8 0 0 0 .916-.38l.7-1.212a.8.8 0 0 0-.193-.987l-.55-.51a.8.8 0 0 1 0-1.176l.55-.51a.8.8 0 0 0 .193-.987l-.7-1.212a.8.8 0 0 0-.916-.38l-.717.2a.8.8 0 0 1-.95-.485l-.265-.688a.8.8 0 0 0-.659-.499A8.2 8.2 0 0 0 8 0Zm0 5.5a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5Z"/>
            </svg>
            <span>Settings</span>
          </button>`
    }
    <div class="modal-backdrop ${forceOpen ? 'modal-backdrop--visible' : ''}" data-role="backdrop">
      <div class="modal" role="dialog" aria-modal="true" aria-labelledby="settings-heading">
        ${forceOpen ? '' : '<button class="modal__close" type="button" aria-label="Close settings" title="Close (Esc)">✕</button>'}
        <div class="modal__header">
          <h2 id="settings-heading">${forceOpen ? 'Connect Your GitHub Account' : 'Settings'}</h2>
          <p class="modal__subtitle">
            ${
              forceOpen
                ? 'Your keys stay in this browser only and are never shared with any third party. Enter your GitHub personal access token to start browsing and analyzing your repositories.'
                : 'Your keys stay in this browser only and are never shared with any third party. The extension has no server — it talks directly to GitHub and your AI provider.'
            }
          </p>
        </div>

        <form class="settings__form">
          <div class="form-group">
            <label for="input-github-token">
              GitHub Personal Access Token <span class="required">*</span>
            </label>
            <div class="input-with-action">
              <input
                id="input-github-token"
                type="password"
                name="githubToken"
                placeholder="ghp_… or github_pat_…"
                value="${escapeHtml(settings.githubToken || '')}"
                required
                autocomplete="off"
                spellcheck="false"
              />
              <button type="button" class="btn-toggle-pw" title="Toggle token visibility" tabindex="-1">
                <svg class="icon-eye" viewBox="0 0 16 16" fill="currentColor">
                  <path d="M8 2c1.981 0 3.67.992 4.933 2.078 1.27 1.091 2.187 2.345 2.637 3.023a1.62 1.62 0 0 1 0 1.798c-.45.678-1.367 1.932-2.637 3.023C11.67 13.008 9.981 14 8 14c-1.981 0-3.67-.992-4.933-2.078C1.797 10.83.88 9.577.43 8.899a1.62 1.62 0 0 1 0-1.798c.45-.678 1.367-1.932 2.637-3.023C4.33 2.992 6.019 2 8 2ZM1.679 7.938c.386.564 1.18 1.637 2.298 2.6C5.074 11.487 6.47 12.5 8 12.5c1.53 0 2.926-1.013 4.023-1.962 1.118-.963 1.912-2.036 2.298-2.6a.12.12 0 0 0 0-.076c-.386-.564-1.18-1.637-2.298-2.6C10.926 4.313 9.53 3.5 8 3.5c-1.53 0-2.926 1.013-4.023 1.962-1.118.963-1.912 2.036-2.298 2.6a.12.12 0 0 0 0 .076ZM8 5.5a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5Z"/>
                </svg>
              </button>
              <button type="button" class="btn-verify-token" id="btn-verify-token" title="Test this token with GitHub API">
                Test Token
              </button>
            </div>
            <div class="token-feedback" id="token-feedback" hidden></div>
            <p class="settings__hint">
              Requires <code>repo</code> scope to inspect private repos.
              <a href="https://github.com/settings/tokens/new?scopes=repo&description=Repo+Dashboard" target="_blank" rel="noopener" class="link-external">
                Generate token on GitHub ↗
              </a>
            </p>
          </div>

          <div class="form-group">
            <label for="select-ai-provider">
              AI Provider for Repository Summaries (Optional)
            </label>
            <div class="select-wrap">
              <select id="select-ai-provider" name="aiProvider">
                <option value="">None (stats and details only, no AI summaries)</option>
                ${Object.entries(PROVIDER_LABELS)
                  .map(
                    ([value, label]) =>
                      `<option value="${value}" ${settings.aiProvider === value ? 'selected' : ''}>${label}</option>`
                  )
                  .join('')}
              </select>
              <svg class="select-chevron" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
                <path d="m4.427 6.427 3.396 3.396a.25.25 0 0 0 .354 0l3.396-3.396A.25.25 0 0 0 11.396 6H4.604a.25.25 0 0 0-.177.427Z"/>
              </svg>
            </div>
            <p class="settings__hint">
              Tip: Google Gemini has a free tier with generous limits — recommended!
            </p>
          </div>

          ${Object.entries(PROVIDER_LABELS)
            .map(
              ([value, label]) => `
                <div class="form-group settings__provider-key" data-provider="${value}" ${
                settings.aiProvider === value ? '' : 'hidden'
              }>
                  <label for="input-key-${value}">${label} API Key</label>
                  <div class="input-with-action">
                    <input
                      id="input-key-${value}"
                      type="password"
                      name="key_${value}"
                      placeholder="${PROVIDER_PLACEHOLDERS[value] || 'API key…'}"
                      value="${escapeHtml(settings.aiApiKeys?.[value] || '')}"
                      autocomplete="off"
                      spellcheck="false"
                    />
                    <button type="button" class="btn-toggle-pw" title="Toggle visibility" tabindex="-1">
                      <svg class="icon-eye" viewBox="0 0 16 16" fill="currentColor">
                        <path d="M8 2c1.981 0 3.67.992 4.933 2.078 1.27 1.091 2.187 2.345 2.637 3.023a1.62 1.62 0 0 1 0 1.798c-.45.678-1.367 1.932-2.637 3.023C11.67 13.008 9.981 14 8 14c-1.981 0-3.67-.992-4.933-2.078C1.797 10.83.88 9.577.43 8.899a1.62 1.62 0 0 1 0-1.798c.45-.678 1.367-1.932 2.637-3.023C4.33 2.992 6.019 2 8 2ZM1.679 7.938c.386.564 1.18 1.637 2.298 2.6C5.074 11.487 6.47 12.5 8 12.5c1.53 0 2.926-1.013 4.023-1.962 1.118-.963 1.912-2.036 2.298-2.6a.12.12 0 0 0 0-.076c-.386-.564-1.18-1.637-2.298-2.6C10.926 4.313 9.53 3.5 8 3.5c-1.53 0-2.926 1.013-4.023 1.962-1.118.963-1.912 2.036-2.298 2.6a.12.12 0 0 0 0 .076ZM8 5.5a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5Z"/>
                      </svg>
                    </button>
                    <button type="button" class="btn-verify-token btn-test-ai-key" data-provider="${value}" title="Test key with API">
                      Test Key
                    </button>
                  </div>
                  <div class="token-feedback ai-key-feedback" id="feedback-key-${value}" hidden></div>
                  <p class="settings__hint">${PROVIDER_HINTS[value] || ''}</p>
                </div>
              `
            )
            .join('')}

          <!-- Auto-Refresh Cadence -->
          <div class="form-group">
            <label for="select-refresh-interval">
              Auto-Refresh Cadence
            </label>
            <div class="select-wrap">
              <select id="select-refresh-interval" name="autoRefreshInterval">
                <option value="5" ${settings.autoRefreshInterval === 5 ? 'selected' : ''}>Every 5 minutes</option>
                <option value="10" ${(!settings.autoRefreshInterval || settings.autoRefreshInterval === 10) ? 'selected' : ''}>Every 10 minutes (Default)</option>
                <option value="30" ${settings.autoRefreshInterval === 30 ? 'selected' : ''}>Every 30 minutes</option>
                <option value="60" ${settings.autoRefreshInterval === 60 ? 'selected' : ''}>Every 1 hour</option>
                <option value="0" ${settings.autoRefreshInterval === 0 ? 'selected' : ''}>Manual only (No background timer)</option>
              </select>
              <svg class="select-chevron" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
                <path d="m4.427 6.427 3.396 3.396a.25.25 0 0 0 .354 0l3.396-3.396A.25.25 0 0 0 11.396 6H4.604a.25.25 0 0 0-.177.427Z"/>
              </svg>
            </div>
            <p class="settings__hint">
              Updates repository stats and data in the background without resetting your active UI state or scroll position.
            </p>
          </div>

          <!-- GitHub API Rate Limit Status -->
          <div class="form-group settings__rate-limit-group">
            <label>GitHub API Quota Status</label>
            <div class="rate-limit-card" id="settings-rate-limit">
              <div class="rate-limit-row">
                <span class="rate-limit-label">Hourly API Quota</span>
                <span class="rate-limit-value font-mono" id="rate-limit-remaining-val">Checking quota…</span>
              </div>
              <div class="rate-limit-progress-bar">
                <div class="rate-limit-progress-fill" id="rate-limit-fill" style="width: 100%;"></div>
              </div>
              <div class="rate-limit-sub">
                <span id="rate-limit-reset-val">Resets in —</span>
              </div>
            </div>
          </div>

          <!-- Export Repository Catalog -->
          ${
            forceOpen
              ? ''
              : `
              <div class="form-group settings__catalog-export-group">
                <label>Export Repository Catalog</label>
                <div class="settings__backup-actions settings__catalog-actions">
                  <button type="button" class="btn-secondary" id="btn-export-catalog-md" title="Export catalog as clean GitHub Markdown table">
                    <svg viewBox="0 0 16 16" fill="currentColor" class="btn-icon-svg">
                      <path d="M0 3.75C0 2.784.784 2 1.75 2h12.5c.966 0 1.75.784 1.75 1.75v8.5A1.75 1.75 0 0 1 14.25 14H1.75A1.75 1.75 0 0 1 0 12.25v-8.5Zm1.75-.25a.25.25 0 0 0-.25.25v8.5c0 .138.112.25.25.25h12.5a.25.25 0 0 0 .25-.25v-8.5a.25.25 0 0 0-.25-.25H1.75ZM3 5h2v6H3V5Zm4 0h2v6H7V5Zm4 0h2v6h-2V5Z"/>
                    </svg>
                    <span>Markdown (.md)</span>
                  </button>
                  <button type="button" class="btn-secondary" id="btn-export-catalog-csv" title="Export catalog as CSV spreadsheet">
                    <svg viewBox="0 0 16 16" fill="currentColor" class="btn-icon-svg">
                      <path d="M2.5 1.75v11.5c0 .138.112.25.25.25h10.5a.25.25 0 0 0 .25-.25V5.328a.25.25 0 0 0-.073-.177L9.854 1.573A.25.25 0 0 0 9.672 1.5H2.75a.25.25 0 0 0-.25.25Zm-1.5 0A1.75 1.75 0 0 1 2.75 0h6.922c.464 0 .909.184 1.237.513l3.575 3.575c.33.328.514.773.514 1.24V13.25A1.75 1.75 0 0 1 13.25 15H2.75A1.75 1.75 0 0 1 1 13.25V1.75Z"/>
                    </svg>
                    <span>CSV (.csv)</span>
                  </button>
                  <button type="button" class="btn-secondary" id="btn-export-catalog-json" title="Export catalog as structured JSON">
                    <svg viewBox="0 0 16 16" fill="currentColor" class="btn-icon-svg">
                      <path d="M2.75 1.5a.25.25 0 0 0-.25.25v12.5c0 .138.112.25.25.25h10.5a.25.25 0 0 0 .25-.25V1.75a.25.25 0 0 0-.25-.25H2.75ZM1 1.75C1 .784 1.784 0 2.75 0h10.5C14.216 0 15 .784 15 1.75v12.5A1.75 1.75 0 0 1 13.25 16H2.75A1.75 1.75 0 0 1 1 14.25V1.75Z"/>
                    </svg>
                    <span>JSON (.json)</span>
                  </button>
                </div>
                <p class="settings__hint">Download your repository catalog with languages, stars, folders, tags, and AI summaries.</p>
              </div>
            `
          }

          <!-- Backup & Restore Configuration -->
          ${
            forceOpen
              ? ''
              : `
              <div class="form-group settings__backup-group">
                <label>Backup & Restore Organization</label>
                <div class="settings__backup-actions">
                  <button type="button" class="btn-secondary" id="btn-export-config" title="Download backup of custom folders, pinned repos, and starred topics">
                    <svg viewBox="0 0 16 16" fill="currentColor" class="btn-icon-svg">
                      <path d="M.5 9.9a.75.75 0 0 1 .75.75v2.5c0 .138.112.25.25.25h13a.25.25 0 0 0 .25-.25v-2.5a.75.75 0 0 1 1.5 0v2.5A1.75 1.75 0 0 1 14.5 15h-13A1.75 1.75 0 0 1 0 13.15v-2.5a.75.75 0 0 1 .75-.75Z"/>
                      <path d="M7.47 10.53a.75.75 0 0 0 1.06 0l3-3a.75.75 0 0 0-1.06-1.06L8.75 8.19V1.75a.75.75 0 0 0-1.5 0v6.44L5.53 6.47a.75.75 0 0 0-1.06 1.06l3 3Z"/>
                    </svg>
                    <span>Export Configuration (.json)</span>
                  </button>
                  <label class="btn-secondary btn-file-label" title="Import folders and pins from backup file">
                    <svg viewBox="0 0 16 16" fill="currentColor" class="btn-icon-svg">
                      <path d="M.5 9.9a.75.75 0 0 1 .75.75v2.5c0 .138.112.25.25.25h13a.25.25 0 0 0 .25-.25v-2.5a.75.75 0 0 1 1.5 0v2.5A1.75 1.75 0 0 1 14.5 15h-13A1.75 1.75 0 0 1 0 13.15v-2.5a.75.75 0 0 1 .75-.75Z"/>
                      <path d="M7.47 1.47a.75.75 0 0 1 1.06 0l3 3a.75.75 0 0 1-1.06 1.06L8.75 3.81v6.44a.75.75 0 0 1-1.5 0V3.81L5.53 5.53a.75.75 0 0 1-1.06-1.06l3-3Z"/>
                    </svg>
                    <span>Import Configuration</span>
                    <input type="file" id="input-import-config" accept=".json,application/json" hidden />
                  </label>
                </div>
                <p class="settings__hint">Safely export or restore custom folders, colors, repository assignments, and pinned repositories.</p>
              </div>
            `
          }

          <div class="settings__actions">
            <button type="submit" class="btn-primary" id="btn-save-settings">
              ${forceOpen ? 'Connect & Load Dashboard' : 'Save Changes'}
            </button>
            ${
              forceOpen
                ? ''
                : '<button type="button" class="btn-secondary settings__clear-cache" id="btn-clear-cache">Clear AI Cache</button>'
            }
          </div>
          <div class="settings__status" id="settings-status" hidden></div>
        </form>
      </div>
    </div>
  `;

  wireUpForm(container, settings, onSaved, forceOpen, onExportCatalog);
}

function wireUpForm(container, settings, onSaved, forceOpen, onExportCatalog) {
  const backdrop = container.querySelector('[data-role="backdrop"]');
  const toggleButton = container.querySelector('.settings__toggle');
  const closeButton = container.querySelector('.modal__close');
  const form = container.querySelector('.settings__form');
  const providerSelect = form.querySelector('[name="aiProvider"]');
  const verifyBtn = form.querySelector('#btn-verify-token');
  const tokenInput = form.querySelector('#input-github-token');
  const tokenFeedback = form.querySelector('#token-feedback');
  const statusEl = form.querySelector('#settings-status');

  const openModal = () => {
    backdrop.classList.add('modal-backdrop--visible');
    tokenInput?.focus();
  };
  const closeModal = () => backdrop.classList.remove('modal-backdrop--visible');

  toggleButton?.addEventListener('click', openModal);
  closeButton?.addEventListener('click', closeModal);

  backdrop.addEventListener('click', (event) => {
    if (!forceOpen && event.target === backdrop) closeModal();
  });

  // Password visibility toggle buttons
  container.querySelectorAll('.btn-toggle-pw').forEach((btn) => {
    btn.addEventListener('click', () => {
      const input = btn.previousElementSibling;
      if (!input) return;
      const isPassword = input.type === 'password';
      input.type = isPassword ? 'text' : 'password';
      btn.classList.toggle('is-visible', isPassword);
    });
  });

  // Test token action
  if (verifyBtn) {
    verifyBtn.addEventListener('click', async () => {
      const token = tokenInput.value.trim();
      if (!token) {
        showFeedback(tokenFeedback, 'Please enter a token first.', 'error');
        return;
      }

      verifyBtn.disabled = true;
      verifyBtn.textContent = 'Testing…';

      try {
        const userInfo = await testGithubToken(token);
        showFeedback(
          tokenFeedback,
          `✓ Valid! Authenticated as <strong>${escapeHtml(userInfo.login)}</strong> (${escapeHtml(userInfo.name)})`,
          'success'
        );
      } catch (err) {
        showFeedback(tokenFeedback, `✕ ${escapeHtml(err.message)}`, 'error');
      } finally {
        verifyBtn.disabled = false;
        verifyBtn.textContent = 'Test Token';
      }
    });
  }

  // Test AI Key action
  container.querySelectorAll('.btn-test-ai-key').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const provider = btn.dataset.provider;
      const input = container.querySelector(`#input-key-${provider}`);
      const feedback = container.querySelector(`#feedback-key-${provider}`);
      const key = input?.value?.trim() || '';

      if (!key) {
        showFeedback(feedback, 'Please enter an API key first.', 'error');
        return;
      }

      btn.disabled = true;
      btn.textContent = 'Testing…';

      try {
        const result = await testAiKey(provider, key);
        const modelNote = result?.model ? ` using <strong>${escapeHtml(result.model)}</strong>` : '';
        showFeedback(feedback, `✓ Success! Connected and verified with ${PROVIDER_LABELS[provider] || provider}${modelNote}.`, 'success');
      } catch (err) {
        showFeedback(feedback, `✕ ${escapeHtml(err.message)}`, 'error');
      } finally {
        btn.disabled = false;
        btn.textContent = 'Test Key';
      }
    });
  });

  // Provider selector change
  providerSelect.addEventListener('change', () => {
    for (const field of form.querySelectorAll('.settings__provider-key')) {
      field.hidden = field.dataset.provider !== providerSelect.value;
    }
  });

  // Form submit
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const formData = new FormData(form);
    const aiProvider = formData.get('aiProvider') || '';
    const tokenVal = formData.get('githubToken')?.trim() || '';

    const aiApiKeys = { ...settings.aiApiKeys };
    for (const providerKey of Object.keys(PROVIDER_LABELS)) {
      const val = formData.get(`key_${providerKey}`)?.trim();
      if (val !== undefined && val !== '') {
        aiApiKeys[providerKey] = val;
      }
    }

    const intervalVal = parseInt(formData.get('autoRefreshInterval') ?? '10', 10);

    const saveBtn = form.querySelector('#btn-save-settings');
    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving…';

    await saveSettings({
      githubToken: tokenVal,
      aiProvider,
      aiApiKeys,
      autoRefreshInterval: isNaN(intervalVal) ? 10 : intervalVal,
    });

    closeModal();
    onSaved();
  });

  // Live Rate Limit Status in Settings
  const rateLimitRemainingEl = container.querySelector('#rate-limit-remaining-val');
  const rateLimitFillEl = container.querySelector('#rate-limit-fill');
  const rateLimitResetEl = container.querySelector('#rate-limit-reset-val');

  function updateRateLimitUi(rl) {
    if (!rateLimitRemainingEl || !rl) return;
    const remaining = rl.remaining ?? 5000;
    const limit = rl.limit ?? 5000;
    const pct = Math.max(0, Math.min(100, Math.round((remaining / limit) * 100)));
    rateLimitRemainingEl.textContent = `${remaining.toLocaleString()} / ${limit.toLocaleString()} remaining`;
    if (rateLimitFillEl) {
      rateLimitFillEl.style.width = `${pct}%`;
      if (pct < 15) {
        rateLimitFillEl.style.backgroundColor = 'var(--apple-red)';
      } else if (pct < 35) {
        rateLimitFillEl.style.backgroundColor = '#ff9f0a';
      } else {
        rateLimitFillEl.style.backgroundColor = 'var(--apple-blue)';
      }
    }
    if (rateLimitResetEl) {
      if (rl.resetTime) {
        const minsLeft = Math.max(0, Math.round((rl.resetTime.getTime() - Date.now()) / 60000));
        rateLimitResetEl.textContent = minsLeft > 0 ? `Resets in ~${minsLeft} minute${minsLeft === 1 ? '' : 's'}` : 'Resetting shortly';
      } else {
        rateLimitResetEl.textContent = 'Quota resets hourly';
      }
    }
  }

  updateRateLimitUi(getRateLimitStatus());
  onRateLimitChange(updateRateLimitUi);

  // Catalog Export actions (Markdown, CSV, JSON)
  const exportMdBtn = container.querySelector('#btn-export-catalog-md');
  const exportCsvBtn = container.querySelector('#btn-export-catalog-csv');
  const exportJsonBtn = container.querySelector('#btn-export-catalog-json');

  if (exportMdBtn && onExportCatalog) {
    exportMdBtn.addEventListener('click', async () => {
      try {
        await onExportCatalog('markdown');
        showFeedback(statusEl, '✓ Exported catalog as Markdown table!', 'success');
      } catch (err) {
        showFeedback(statusEl, `✕ Export failed: ${escapeHtml(err.message)}`, 'error');
      }
    });
  }
  if (exportCsvBtn && onExportCatalog) {
    exportCsvBtn.addEventListener('click', async () => {
      try {
        await onExportCatalog('csv');
        showFeedback(statusEl, '✓ Exported catalog as CSV spreadsheet!', 'success');
      } catch (err) {
        showFeedback(statusEl, `✕ Export failed: ${escapeHtml(err.message)}`, 'error');
      }
    });
  }
  if (exportJsonBtn && onExportCatalog) {
    exportJsonBtn.addEventListener('click', async () => {
      try {
        await onExportCatalog('json');
        showFeedback(statusEl, '✓ Exported catalog as JSON data!', 'success');
      } catch (err) {
        showFeedback(statusEl, `✕ Export failed: ${escapeHtml(err.message)}`, 'error');
      }
    });
  }

  // Backup & Restore: Export configuration
  const exportBtn = container.querySelector('#btn-export-config');
  if (exportBtn) {
    exportBtn.addEventListener('click', async () => {
      try {
        const config = await exportConfiguration();
        const jsonStr = JSON.stringify(config, null, 2);
        const blob = new Blob([jsonStr], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `github-dashboard-backup-${new Date().toISOString().slice(0, 10)}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        showFeedback(statusEl, '✓ Configuration exported successfully!', 'success');
      } catch (err) {
        showFeedback(statusEl, `✕ Export failed: ${escapeHtml(err.message)}`, 'error');
      }
    });
  }

  // Backup & Restore: Import configuration
  const importInput = container.querySelector('#input-import-config');
  if (importInput) {
    importInput.addEventListener('change', async (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      try {
        const text = await file.text();
        const data = JSON.parse(text);
        await importConfiguration(data);
        showFeedback(statusEl, '✓ Configuration imported successfully! Reloading…', 'success');
        setTimeout(() => {
          window.location.reload();
        }, 1200);
      } catch (err) {
        showFeedback(statusEl, `✕ Import failed: ${escapeHtml(err.message)}`, 'error');
      } finally {
        importInput.value = '';
      }
    });
  }

  // Clear AI cache
  const clearBtn = container.querySelector('#btn-clear-cache');
  if (clearBtn) {
    clearBtn.addEventListener('click', async () => {
      clearBtn.disabled = true;
      clearBtn.textContent = 'Clearing…';
      await clearDescriptionCache();
      showFeedback(statusEl, '✓ AI description cache cleared! Reload to regenerate.', 'success');
      setTimeout(() => {
        clearBtn.disabled = false;
        clearBtn.textContent = 'Clear AI Cache';
      }, 1500);
    });
  }
}

function showFeedback(el, html, type) {
  if (!el) return;
  el.hidden = false;
  el.className = `settings-feedback settings-feedback--${type}`;
  el.innerHTML = html;
}

