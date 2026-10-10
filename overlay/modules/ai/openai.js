// overlay/modules/ai/openai.js
//
// Talks to OpenAI's chat completions endpoint.
// Auto-selects the latest, fast, cost-effective mini models (e.g. gpt-4o-mini),
// keeping token usage low and generation swift.

const CANDIDATE_MODELS = [
  'gpt-4o-mini',
  'gpt-4.1-mini',
  'gpt-3.5-turbo',
];

export async function generateWithOpenAI({ apiKey, prompt }) {
  const cleanKey = (apiKey || '').trim();
  if (!cleanKey) {
    throw new Error('OpenAI API key is missing. Please configure it in Settings.');
  }

  let lastError = null;

  for (let i = 0; i < CANDIDATE_MODELS.length; i++) {
    const model = CANDIDATE_MODELS[i];
    const isLast = i === CANDIDATE_MODELS.length - 1;

    try {
      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${cleanKey}`,
        },
        body: JSON.stringify({
          model,
          messages: [{ role: 'user', content: prompt }],
          max_tokens: 220,
          temperature: 0.4,
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

        throw new Error(detail ? `OpenAI: ${detail}` : describeError(response.status));
      }

      const data = await response.json();
      const output = (data.choices?.[0]?.message?.content ?? '').trim();
      return { text: output, model };
    } catch (err) {
      lastError = err;
      if (!err.message?.includes('404') || isLast) {
        throw err;
      }
    }
  }

  throw lastError || new Error('Failed to generate summary with OpenAI.');
}

function describeError(status) {
  if (status === 401) return 'OpenAI rejected the API key (401).';
  if (status === 429) return 'OpenAI rate limit hit (429) — check your usage or quota.';
  return `OpenAI API error: ${status}`;
}
