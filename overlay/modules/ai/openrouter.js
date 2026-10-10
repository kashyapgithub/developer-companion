// overlay/modules/ai/openrouter.js
//
// Talks to OpenRouter's chat completions endpoint.
// OpenRouter provides unified access to hundreds of models.
// To keep generation fast and token costs negligible, this module
// auto-prioritizes high-speed, cost-effective, and free models.

const CANDIDATE_MODELS = [
  'google/gemini-2.0-flash-001',
  'deepseek/deepseek-chat',
  'openai/gpt-4o-mini',
  'anthropic/claude-3.5-haiku',
  'meta-llama/llama-3.3-70b-instruct:free',
  'google/gemini-flash-1.5',
];

let cachedActiveModel = null;

export async function generateWithOpenRouter({ apiKey, prompt }) {
  const cleanKey = (apiKey || '').trim();
  if (!cleanKey) {
    throw new Error('OpenRouter API key is missing. Please configure it in Settings.');
  }

  // If a model was already successfully verified in this session, try it first
  const modelsToTry = cachedActiveModel
    ? [cachedActiveModel, ...CANDIDATE_MODELS.filter((m) => m !== cachedActiveModel)]
    : [...CANDIDATE_MODELS];

  let lastError = null;

  for (let i = 0; i < modelsToTry.length; i++) {
    const model = modelsToTry[i];
    const isLast = i === modelsToTry.length - 1;

    try {
      const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${cleanKey}`,
          'HTTP-Referer': 'https://github.com/kashyapgithub/github-repo-dashboard',
          'X-Title': 'GitHub Repo Dashboard',
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
          // non-JSON response
        }

        // Fatal auth or billing errors shouldn't be retried across models
        if (response.status === 401) {
          throw new Error('OpenRouter rejected the API key (401). Verify your key at openrouter.ai/keys.');
        }
        if (response.status === 402) {
          throw new Error(
            detail
              ? `OpenRouter: ${detail}`
              : 'OpenRouter account has insufficient credits (402). Add credits or use a free model at openrouter.ai/credits.'
          );
        }

        // For model not found (404), bad request (400) or rate limit (429) on a specific model, try next candidate
        if ((response.status === 404 || response.status === 400 || response.status === 429) && !isLast) {
          continue;
        }

        throw new Error(detail ? `OpenRouter: ${detail}` : describeError(response.status));
      }

      const data = await response.json();
      const output = (data.choices?.[0]?.message?.content ?? '').trim();

      if (!output && !isLast) {
        continue;
      }

      cachedActiveModel = model;
      return { text: output, model };
    } catch (err) {
      lastError = err;
      // Do not continue if it's an authentication or balance failure
      if (err.message?.includes('401') || err.message?.includes('402')) {
        throw err;
      }
      if (isLast) {
        throw err;
      }
    }
  }

  throw lastError || new Error('Failed to generate summary with OpenRouter.');
}

function describeError(status) {
  if (status === 401) return 'OpenRouter rejected the API key (401).';
  if (status === 402) return 'OpenRouter: Insufficient credits (402).';
  if (status === 429) return 'OpenRouter rate limit reached (429). Please try again shortly.';
  return `OpenRouter API error: ${status}`;
}
