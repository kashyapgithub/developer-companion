// overlay/modules/ai/gemini.js
//
// Talks to Google's Gemini API with auto-selection of the latest,
// cost-effective Flash model (e.g. gemini-3.8-flash, gemini-3.7-flash).
// Dynamically discovers active models supported by the API key,
// filtering for efficient Flash models, with graceful fallbacks.

const FALLBACK_MODELS = [
  'gemini-3.8-flash',
  'gemini-3.8-flash-lite',
  'gemini-3.7-flash',
  'gemini-3.7-flash-lite',
  'gemini-3.5-flash',
  'gemini-2.5-flash',
  'gemini-2.0-flash',
  'gemini-1.5-flash',
];

// In-memory cache of the discovered best model for the current key
let cachedDiscoveredModel = null;
let lastUsedApiKey = null;

/**
 * Discovers the latest active Flash model available to the provided API key.
 * Queries GET /v1beta/models and filters for generateContent-capable Flash models.
 */
export async function getBestGeminiModel(apiKey) {
  const cleanKey = (apiKey || '').trim();
  if (cachedDiscoveredModel && lastUsedApiKey === cleanKey) {
    return cachedDiscoveredModel;
  }

  try {
    const listUrl = `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(cleanKey)}`;
    const resp = await fetch(listUrl);
    if (resp.ok) {
      const data = await resp.json();
      const models = data.models || [];

      // Filter for models supporting generateContent and containing 'flash' (cost-effective, low token consumption)
      const flashModels = models
        .filter((m) => {
          const name = (m.name || '').toLowerCase();
          const methods = m.supportedGenerationMethods || [];
          return methods.includes('generateContent') && name.includes('flash');
        })
        .map((m) => m.name.replace(/^models\//, ''));

      if (flashModels.length > 0) {
        // Sort to find the highest/latest version (e.g., gemini-3.8-flash > gemini-3.7-flash)
        // Prefer stable over exp/preview
        flashModels.sort((a, b) => {
          const aExp = a.includes('exp') || a.includes('preview');
          const bExp = b.includes('exp') || b.includes('preview');
          if (aExp !== bExp) return aExp ? 1 : -1;

          // Extract version numbers (e.g. 3.8 vs 3.7 vs 2.5)
          const aVer = parseFloat(a.match(/gemini-([0-9.]+)/i)?.[1] || '0');
          const bVer = parseFloat(b.match(/gemini-([0-9.]+)/i)?.[1] || '0');
          if (bVer !== aVer) return bVer - aVer;

          return a.localeCompare(b);
        });

        const selected = flashModels[0];
        cachedDiscoveredModel = selected;
        lastUsedApiKey = cleanKey;
        return selected;
      }
    }
  } catch (err) {
    // If listing models fails, use fallback list
  }

  return FALLBACK_MODELS[0];
}

export async function generateWithGemini({ apiKey, prompt }) {
  const cleanKey = (apiKey || '').trim();
  if (!cleanKey) {
    throw new Error('Gemini API key is missing. Please configure it in Settings.');
  }

  const bestModel = await getBestGeminiModel(cleanKey);

  // Build candidate order starting with bestModel
  const candidates = [
    bestModel,
    ...FALLBACK_MODELS.filter((m) => m !== bestModel),
  ];

  let lastError = null;

  for (let i = 0; i < candidates.length; i++) {
    const model = candidates[i];
    const isLast = i === candidates.length - 1;

    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(cleanKey)}`;

      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { maxOutputTokens: 220, temperature: 0.4 },
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

        // If the error message mentions a specific replacement model, prioritize it next
        const suggestedModel = detail.match(/gemini-[0-9.]+(?:-[a-z0-9]+)*/i)?.[0];
        if (suggestedModel && !candidates.includes(suggestedModel)) {
          candidates.splice(i + 1, 0, suggestedModel);
        }

        // If 404 (endpoint not found or model retired) and more candidates exist, try fallback
        if (response.status === 404 && !isLast) {
          if (cachedDiscoveredModel === model) {
            cachedDiscoveredModel = null;
          }
          continue;
        }

        const fallbackMsg = describeError(response.status);
        throw new Error(detail ? `Gemini API: ${detail}` : fallbackMsg);
      }

      const data = await response.json();
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!text && data.candidates?.[0]?.finishReason) {
        throw new Error(`Gemini finished with reason: ${data.candidates[0].finishReason}`);
      }

      // Successful call: update cache
      cachedDiscoveredModel = model;
      lastUsedApiKey = cleanKey;

      const output = (text || '').trim();
      return { text: output, model };
    } catch (err) {
      lastError = err;
      if (!err.message?.includes('404') || isLast) {
        throw err;
      }
    }
  }

  throw lastError || new Error('Failed to generate summary with Gemini.');
}

function describeError(status) {
  if (status === 400) return 'Gemini rejected the request (400) — check the API key.';
  if (status === 403) return 'Gemini permission denied (403) — check API key permissions or quota.';
  if (status === 404) return 'Gemini model endpoint not found (404).';
  if (status === 429) return 'Gemini rate limit hit (429) — try again shortly.';
  return `Gemini API error: ${status}`;
}
