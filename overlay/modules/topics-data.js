// overlay/modules/topics-data.js
//
// Curated catalog of trending GitHub topics across modern software engineering,
// AI development, systems programming, and developer tooling.
// Provides structured categories, display labels, and search/normalization utilities.

export const TRENDING_TOPIC_CATEGORIES = [
  {
    id: 'ai-agents',
    name: 'AI & Autonomous Agents',
    description: 'Autonomous reasoning, multi-agent orchestration, and LLM-powered agentic systems.',
    topics: [
      { slug: 'ai-agents', label: 'AI Agents', popular: true },
      { slug: 'autonomous-agents', label: 'Autonomous Agents', popular: true },
      { slug: 'agentic-ai', label: 'Agentic AI' },
      { slug: 'multi-agent', label: 'Multi-Agent Systems', popular: true },
      { slug: 'agent-framework', label: 'Agent Frameworks' },
      { slug: 'llm-agents', label: 'LLM Agents' },
      { slug: 'crewai', label: 'CrewAI' },
      { slug: 'autogen', label: 'AutoGen' },
    ],
  },
  {
    id: 'classification-vision',
    name: 'Model Classification & Vision',
    description: 'Neural classifiers, computer vision architectures, transformers, and fine-tuning pipelines.',
    topics: [
      { slug: 'model-classifier', label: 'Model Classifier', popular: true },
      { slug: 'classification', label: 'Classification', popular: true },
      { slug: 'text-classification', label: 'Text Classification' },
      { slug: 'image-classification', label: 'Image Classification', popular: true },
      { slug: 'zero-shot-classification', label: 'Zero-Shot Classification' },
      { slug: 'fine-tuning', label: 'Fine-Tuning', popular: true },
      { slug: 'transformers', label: 'Transformers', popular: true },
      { slug: 'diffusion-models', label: 'Diffusion Models' },
      { slug: 'object-detection', label: 'Object Detection' },
      { slug: 'huggingface', label: 'Hugging Face' },
    ],
  },
  {
    id: 'llm-rag',
    name: 'LLMs, GenAI & RAG',
    description: 'Large language model inference, local execution engines, vector search, and prompt pipelines.',
    topics: [
      { slug: 'llm', label: 'LLM', popular: true },
      { slug: 'rag', label: 'RAG Systems', popular: true },
      { slug: 'vector-database', label: 'Vector Databases', popular: true },
      { slug: 'local-llm', label: 'Local LLMs', popular: true },
      { slug: 'ollama', label: 'Ollama' },
      { slug: 'vllm', label: 'vLLM' },
      { slug: 'prompt-engineering', label: 'Prompt Engineering' },
      { slug: 'langchain', label: 'LangChain' },
      { slug: 'embeddings', label: 'Embeddings' },
    ],
  },
  {
    id: 'devtools',
    name: 'Developer Tools & Terminal',
    description: 'Command-line utilities, coding assistants, developer workflows, and testing suites.',
    topics: [
      { slug: 'devtools', label: 'Developer Tools', popular: true },
      { slug: 'cli', label: 'CLI Tools', popular: true },
      { slug: 'terminal', label: 'Terminal Utilities' },
      { slug: 'code-generation', label: 'Code Generation', popular: true },
      { slug: 'docker', label: 'Docker' },
      { slug: 'testing', label: 'Testing Frameworks' },
      { slug: 'linter', label: 'Linters & Formatters' },
      { slug: 'compiler', label: 'Compilers' },
    ],
  },
  {
    id: 'systems-rust',
    name: 'Systems, Performance & Rust',
    description: 'Low-level performance, memory-safe kernels, WebAssembly, and native runtimes.',
    topics: [
      { slug: 'rust', label: 'Rust', popular: true },
      { slug: 'systems-programming', label: 'Systems Programming' },
      { slug: 'webassembly', label: 'WebAssembly (WASM)', popular: true },
      { slug: 'kernel', label: 'Microkernels & OS' },
      { slug: 'ebpf', label: 'eBPF' },
      { slug: 'c-plus-plus', label: 'C++' },
      { slug: 'go', label: 'Go', popular: true },
      { slug: 'embedded', label: 'Embedded Systems' },
    ],
  },
  {
    id: 'web-fullstack',
    name: 'Modern Web & Full-Stack',
    description: 'Next-gen web frameworks, TypeScript runtimes, reactivity engines, and reactive UI.',
    topics: [
      { slug: 'nextjs', label: 'Next.js', popular: true },
      { slug: 'react', label: 'React', popular: true },
      { slug: 'typescript', label: 'TypeScript', popular: true },
      { slug: 'tailwind', label: 'Tailwind CSS' },
      { slug: 'graphql', label: 'GraphQL' },
      { slug: 'vue', label: 'Vue.js' },
      { slug: 'svelte', label: 'Svelte' },
    ],
  },
  {
    id: 'security-privacy',
    name: 'Cybersecurity & Privacy',
    description: 'Offensive and defensive security, cryptography, reverse engineering, and private computing.',
    topics: [
      { slug: 'security', label: 'Cybersecurity', popular: true },
      { slug: 'cryptography', label: 'Cryptography' },
      { slug: 'penetration-testing', label: 'Penetration Testing' },
      { slug: 'reverse-engineering', label: 'Reverse Engineering', popular: true },
      { slug: 'malware-analysis', label: 'Malware Analysis' },
      { slug: 'privacy', label: 'Privacy Tools' },
    ],
  },
  {
    id: 'data-ml',
    name: 'Data Science & Machine Learning',
    description: 'Deep learning frameworks, neural networks, data pipelines, and analytics engines.',
    topics: [
      { slug: 'machine-learning', label: 'Machine Learning', popular: true },
      { slug: 'deep-learning', label: 'Deep Learning', popular: true },
      { slug: 'pytorch', label: 'PyTorch', popular: true },
      { slug: 'tensorflow', label: 'TensorFlow' },
      { slug: 'data-science', label: 'Data Science' },
      { slug: 'datasets', label: 'Datasets' },
    ],
  },
];

/** Flattened array of all curated topics with category tags */
export function getAllCuratedTopics() {
  const result = [];
  for (const cat of TRENDING_TOPIC_CATEGORIES) {
    for (const t of cat.topics) {
      result.push({
        ...t,
        categoryId: cat.id,
        categoryName: cat.name,
      });
    }
  }
  return result;
}

/** Looks up topic info by slug */
export function findTopicInfo(slug) {
  const target = normalizeTopicSlug(slug);
  for (const cat of TRENDING_TOPIC_CATEGORIES) {
    const found = cat.topics.find((t) => t.slug === target);
    if (found) {
      return {
        ...found,
        categoryId: cat.id,
        categoryName: cat.name,
      };
    }
  }
  return {
    slug: target,
    label: target.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
    categoryId: 'custom',
    categoryName: 'Custom Topics',
    popular: false,
  };
}

/**
 * Normalizes user input into a valid GitHub topic slug:
 * e.g. "Model Classifier" -> "model-classifier", "AI Agents" -> "ai-agents"
 */
export function normalizeTopicSlug(input) {
  if (!input) return '';
  return input
    .toLowerCase()
    .trim()
    .replace(/^topic:/i, '')
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
