// overlay/modules/ai/trendingWhy.js
//
// Analyzes why a repository is trending on GitHub.
// Combines instant deterministic heuristics (star velocity, community adoption,
// topic classification) with optional deep AI synthesis via Gemini, OpenRouter,
// Claude, or OpenAI.

import { generateWithOpenAI } from './openai.js';
import { generateWithAnthropic } from './anthropic.js';
import { generateWithGemini } from './gemini.js';
import { generateWithOpenRouter } from './openrouter.js';
import { fetchReadmeExcerpt } from '../github-api.js';
import { getCachedTrendingWhy, setCachedTrendingWhy } from '../storage.js';
import { truncate } from '../format.js';

const PROVIDERS = {
  openai: generateWithOpenAI,
  anthropic: generateWithAnthropic,
  gemini: generateWithGemini,
  openrouter: generateWithOpenRouter,
};

/**
 * Returns an instant deterministic explanation of why a repo is trending
 * based on star velocity, days since creation, fork ratio, and topics.
 */
export function generateHeuristicTrendingWhy(repo) {
  const parts = [];

  // 1. Velocity signal
  if (repo.daysOld <= 3) {
    parts.push(
      `Viral new debut: accumulated ${repo.stars.toLocaleString()} stars in just ${repo.daysOld} day${repo.daysOld === 1 ? '' : 's'} (${repo.starsPerDay.toLocaleString()} stars/day).`
    );
  } else if (repo.daysOld <= 14) {
    parts.push(
      `Rapid breakout launch: reached ${repo.stars.toLocaleString()} stars with an average of ${repo.starsPerDay.toLocaleString()} stars/day since launch.`
    );
  } else {
    parts.push(
      `Surging community momentum: highly active with ${repo.stars.toLocaleString()} total stars and sustained engagement.`
    );
  }

  // 2. Domain / Topic classification
  const topics = (repo.topics || []).map((t) => t.toLowerCase());
  const descLower = (repo.description || '').toLowerCase();

  if (
    topics.some((t) => t.includes('agent') || t.includes('llm') || t.includes('ai') || t.includes('gpt')) ||
    descLower.includes('llm') ||
    descLower.includes('agent') ||
    descLower.includes('artificial intelligence')
  ) {
    parts.push('Trending at the forefront of AI and autonomous agent developer experimentation.');
  } else if (
    topics.some((t) => t.includes('rust') || t.includes('wasm') || t.includes('gpu') || t.includes('systems')) ||
    repo.language === 'Rust'
  ) {
    parts.push('Drawing heavy attention for its high-performance architecture and modern systems engineering.');
  } else if (
    topics.some((t) => t.includes('security') || t.includes('privacy') || t.includes('hacker') || t.includes('reverse'))
  ) {
    parts.push('Gaining widespread traction in the cybersecurity and developer privacy communities.');
  } else if (
    topics.some((t) => t.includes('react') || t.includes('next') || t.includes('frontend') || t.includes('ui')) ||
    repo.language === 'TypeScript' ||
    repo.language === 'JavaScript'
  ) {
    parts.push('Capturing enthusiasm across the modern web and full-stack engineering ecosystem.');
  } else if (repo.description) {
    parts.push(`Focuses on ${repo.description.charAt(0).toLowerCase() + repo.description.slice(1)}`);
  }

  // 3. Forks & Community builders signal
  if (repo.forks >= 200) {
    parts.push(
      `Over ${repo.forks.toLocaleString()} forks indicate heavy developer building, extension, and experimentation.`
    );
  } else if (repo.forks >= 50) {
    parts.push(`Active developer interest with ${repo.forks.toLocaleString()} community forks.`);
  }

  return parts.join(' ');
}

/**
 * Generates an AI-synthesized explanation of why the repo is trending.
 * Falls back to deterministic heuristic analysis if no key is configured
 * or if generation fails.
 */
export async function getTrendingWhy({ repo, provider, apiKey, githubToken }) {
  // Check local cache first for instant response
  const cached = await getCachedTrendingWhy(repo.fullName);
  if (cached) {
    return { text: cached, isAi: true };
  }

  // If no AI provider configured, use heuristic
  const generate = PROVIDERS[provider];
  if (!generate || !apiKey) {
    return {
      text: generateHeuristicTrendingWhy(repo),
      isAi: false,
    };
  }

  try {
    const readme = await fetchReadmeExcerpt(repo.owner, repo.name, githubToken, 1200);
    const prompt = buildTrendingPrompt(repo, readme);
    const result = await generate({ apiKey, prompt });
    const rawText = typeof result === 'object' && result.text != null ? result.text : String(result || '');
    const cleanText = truncate(rawText.trim(), 400);

    if (cleanText) {
      await setCachedTrendingWhy(repo.fullName, cleanText);
      return { text: cleanText, isAi: true };
    }
  } catch (err) {
    console.warn(`[Trending AI] Fallback to heuristic for ${repo.fullName}:`, err.message);
  }

  // Fallback to heuristic
  return {
    text: generateHeuristicTrendingWhy(repo),
    isAi: false,
  };
}

function buildTrendingPrompt(repo, readme) {
  return [
    'You are a senior open-source analyst. Explain why the following GitHub repository is currently trending and why developers are excited about it.',
    'Write a concise 2-3 sentence explanation. Plain English prose only — NO markdown, NO bullet points, NO headings.',
    'Highlight the problem it solves, what makes it buzzworthy, and why it is surging in stars right now.',
    '',
    `Repository: ${repo.fullName}`,
    `Total Stars: ${repo.stars} (velocity: ~${repo.starsPerDay} stars/day since ${repo.daysOld} days ago)`,
    `Total Forks: ${repo.forks}`,
    `Primary Language: ${repo.language || 'Unknown'}`,
    `Topics: ${repo.topics?.join(', ') || 'None'}`,
    `Description: ${repo.description || 'No description provided.'}`,
    readme ? `README Excerpt:\n${readme}` : '',
  ].join('\n');
}
