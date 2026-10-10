// overlay/modules/ai/index.js
//
// The single entry point the rest of the app calls to get an AI
// description — it doesn't know or care which provider is active.
// Adding a fourth provider later means: write provider-name.js
// exposing the same shape, add one line to PROVIDERS below.

import { generateWithOpenAI } from './openai.js';
import { generateWithAnthropic } from './anthropic.js';
import { generateWithGemini } from './gemini.js';
import { generateWithOpenRouter } from './openrouter.js';
import { fetchReadmeExcerpt } from '../github-api.js';
import { truncate } from '../format.js';

const PROVIDERS = {
  openai: generateWithOpenAI,
  anthropic: generateWithAnthropic,
  gemini: generateWithGemini,
  openrouter: generateWithOpenRouter,
};

/**
 * Generates a 3-4 sentence description for one repo. Fetches a README
 * excerpt (if one exists) to ground the summary in real content rather
 * than just the repo name.
 */
export async function generateDescription({ provider, apiKey, githubToken, repo }) {
  const generate = PROVIDERS[provider];
  if (!generate) {
    throw new Error(`Unknown AI provider: "${provider}"`);
  }

  const readme = await fetchReadmeExcerpt(repo.owner, repo.name, githubToken);
  const prompt = buildPrompt(repo, readme);
  const result = await generate({ apiKey, prompt });
  const rawText = typeof result === 'object' && result.text != null ? result.text : String(result || '');

  // Hard cap so a runaway or malformed response can't blow out a card's layout.
  return truncate(rawText.trim(), 600);
}

function buildPrompt(repo, readme) {
  return [
    'Write a 3-4 sentence plain-English summary of this GitHub repository, ' +
      'for someone deciding whether it is worth revisiting. Plain prose only — ' +
      'no markdown, no headings, no bullet points.',
    '',
    `Repo name: ${repo.name}`,
    `Existing description: ${repo.description || '(none provided)'}`,
    `Primary language: ${repo.language || 'unknown'}`,
    repo.isFork ? 'This is a fork of another repository.' : 'This is an original repository.',
    readme
      ? `README excerpt:\n${readme}`
      : 'No README is available — base the summary on the name, description and language above.',
  ].join('\n');
}

/**
 * Quick validation check for an AI key. Sends a minimal prompt to verify
 * that the provider accepts the key and the model responds.
 */
export async function testAiKey(provider, apiKey) {
  const generate = PROVIDERS[provider];
  if (!generate) {
    throw new Error(`Unknown AI provider: "${provider}"`);
  }
  const cleanKey = (apiKey || '').trim();
  if (!cleanKey) {
    throw new Error('Please enter an API key to test.');
  }
  const result = await generate({
    apiKey: cleanKey,
    prompt: 'Reply with the word "Working" and nothing else.',
  });
  const modelName = typeof result === 'object' && result.model ? result.model : null;
  return {
    success: true,
    model: modelName,
  };
}
