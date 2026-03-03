// Model configuration — ported from the SaaS shared model-config.
// In standalone mode there are no tiers; use the model strings directly
// in your prompts.json targets array.

export interface ModelVariant {
  id: string;
  name: string;
}

export interface ModelFamilyConfig {
  id: string;
  name: string;
  provider: string;
  description: string;
  /** Preferred OpenRouter provider routing order */
  preferred_providers?: string[];
  /** Representative free-tier model — used as default when building config */
  default: ModelVariant;
  /** All available variants keyed by a friendly name */
  variants: Record<string, ModelVariant>;
}

export const MODEL_FAMILIES: ModelFamilyConfig[] = [
  {
    id: 'anthropic',
    name: 'Claude',
    provider: 'Anthropic',
    description: "Anthropic's Claude models.",
    preferred_providers: ['Anthropic'],
    default: { id: 'anthropic/claude-haiku-4.5', name: 'Claude Haiku 4.5' },
    variants: {
      haiku: { id: 'anthropic/claude-haiku-4.5', name: 'Claude Haiku 4.5' },
      sonnet: { id: 'anthropic/claude-sonnet-4.6', name: 'Claude Sonnet 4.6' },
    },
  },
  {
    id: 'openai',
    name: 'GPT',
    provider: 'OpenAI',
    description: "OpenAI's flagship GPT models.",
    preferred_providers: ['OpenAI'],
    default: { id: 'openai/gpt-5-nano', name: 'GPT-5 Nano' },
    variants: {
      nano: { id: 'openai/gpt-5-nano', name: 'GPT-5 Nano' },
      gpt52: { id: 'openai/gpt-5.2', name: 'GPT-5.2' },
    },
  },
  {
    id: 'google',
    name: 'Gemini',
    provider: 'Google',
    description: "Google's multimodal Gemini models.",
    default: {
      id: 'google/gemini-3-flash-preview',
      name: 'Gemini 3 Flash',
    },
    variants: {
      flash: { id: 'google/gemini-3-flash-preview', name: 'Gemini 3 Flash' },
      pro: { id: 'google/gemini-3.1-pro-preview', name: 'Gemini 3.1 Pro' },
    },
  },
  {
    id: 'xai',
    name: 'Grok',
    provider: 'xAI',
    description: "xAI's Grok models with real-time knowledge.",
    default: { id: 'x-ai/grok-4.1-fast', name: 'Grok 4.1 Fast' },
    variants: {
      fast: { id: 'x-ai/grok-4.1-fast', name: 'Grok 4.1 Fast' },
      grok4: { id: 'x-ai/grok-4', name: 'Grok 4' },
    },
  },
  {
    id: 'mistral',
    name: 'Mistral',
    provider: 'Mistral AI',
    description: "Mistral AI's efficient and open-weight models.",
    default: { id: 'mistralai/ministral-8b-2512', name: 'Ministral 8B' },
    variants: {
      '8b': { id: 'mistralai/ministral-8b-2512', name: 'Ministral 8B' },
      '14b': { id: 'mistralai/ministral-14b-2512', name: 'Ministral 14B' },
    },
  },
  {
    id: 'qwen',
    name: 'Qwen',
    provider: 'Alibaba Cloud',
    description: "Alibaba Cloud's Qwen models.",
    default: { id: 'qwen/qwen3.5-flash-02-23', name: 'Qwen3.5 Flash' },
    variants: {
      flash: { id: 'qwen/qwen3.5-flash-02-23', name: 'Qwen3.5 Flash' },
      max: { id: 'qwen/qwen3-max-thinking', name: 'Qwen3 Max Thinking' },
    },
  },
  {
    id: 'deepseek',
    name: 'DeepSeek',
    provider: 'DeepSeek',
    description: "DeepSeek's coding and reasoning models.",
    default: { id: 'deepseek/deepseek-v3.2', name: 'DeepSeek v3.2' },
    variants: {
      v32: { id: 'deepseek/deepseek-v3.2', name: 'DeepSeek v3.2' },
    },
  },
  {
    id: 'perplexity',
    name: 'Perplexity',
    provider: 'Perplexity',
    description: "Perplexity's search-optimized models.",
    default: { id: 'perplexity/sonar', name: 'Sonar' },
    variants: {
      sonar: { id: 'perplexity/sonar', name: 'Sonar' },
      deep: {
        id: 'perplexity/sonar-deep-research',
        name: 'Sonar Deep Research',
      },
    },
  },
  {
    id: 'llama',
    name: 'Llama',
    provider: 'Meta',
    description: "Meta's open-weight Llama models.",
    default: { id: 'meta-llama/llama-4-scout', name: 'Llama 4 Scout' },
    variants: {
      scout: { id: 'meta-llama/llama-4-scout', name: 'Llama 4 Scout' },
      maverick: {
        id: 'meta-llama/llama-4-maverick',
        name: 'Llama 4 Maverick',
      },
    },
  },
];

export const MODEL_FAMILIES_BY_ID = MODEL_FAMILIES.reduce(
  (acc, f) => {
    acc[f.id] = f;
    return acc;
  },
  {} as Record<string, ModelFamilyConfig>,
);

/** Return the preferred provider list for a given model ID, if any. */
export function getPreferredProviders(modelId: string): string[] | undefined {
  for (const family of MODEL_FAMILIES) {
    const isInFamily = Object.values(family.variants).some(
      (v) => v.id === modelId,
    );
    if (isInFamily) return family.preferred_providers;
  }
  return undefined;
}
