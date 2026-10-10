// overlay/modules/ai/anthropic.js
//
// Talks to Anthropic's Messages API.
// Auto-selects the latest, cost-effective Haiku model (e.g. claude-3-5-haiku-latest),
// explicitly avoiding expensive Sonnet or Opus models to keep token consumption minimal.

const CANDIDATE_MODELS = [
  'claude-3-5-haiku-latest',
  'claude-3-5-haiku-20241022',
  'claude-3-haiku-20240307',
];

export async function generateWithAnthropic({ apiKey, prompt }) {
  const cleanKey = (apiKey || '').trim();
  if (!cleanKey) {
    throw new Error('Anthropic API key is missing. Please configure it in Settings.');
  }

  let lastError = null;

  for (let i = 0; i < CANDIDATE_MODELS.length; i++) {
    const model = CANDIDATE_MODELS[i];
    const isLast = i === CANDIDATE_MODELS.length - 1;

    try {
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': cleanKey,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true',
        },
        body: JSON.stringify({
          model,
          max_tokens: 220,
          messages: [{ role: 'user', content: prompt }],
        }),
      });

      if (!response.ok) {
        let detail = '';
        try {
          const errData = await response.json();
          detail = errData.error?.message || '';
        } catch {
          // not JSON
        }

        if (response.status === 404 && !isLast) {
          continue;
        }

        throw new Error(detail ? `Anthropic: ${detail}` : describeError(response.status));
      }

      const data = await response.json();
      const output = (data.content?.[0]?.text ?? '').trim();
      return { text: output, model };
    } catch (err) {
      lastError = err;
      if (!err.message?.includes('404') || isLast) {
        throw err;
      }
    }
  }

  throw lastError || new Error('Failed to generate summary with Anthropic.');
}

function describeError(status) {
  if (status === 401) return 'Anthropic rejected the API key (401).';
  if (status === 403) return 'Anthropic access denied (403) — check key permissions.';
  if (status === 429) return 'Anthropic rate limit hit (429) — try again shortly.';
  return `Anthropic API error: ${status}`;
}
