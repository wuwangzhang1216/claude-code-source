/**
 * Provider catalog for OpenAI-compatible API providers.
 *
 * Each provider entry defines the base URL and env var for its API key.
 * Model strings use the format `provider:model_id` (e.g., `openai:gpt-5.4`).
 */

import { getGlobalConfig } from '../../../utils/config.js'

export type ProviderKind = 'anthropic' | 'openai_compat'

export interface ProviderDef {
  id: string
  name: string
  kind: ProviderKind
  baseUrl: string
  envKeyName: string
  /** Well-known model IDs for this provider (shown in model selector) */
  defaultModels?: Array<{ id: string; label: string }>
}

export const PROVIDER_CATALOG: Record<string, ProviderDef> = {
  openai: {
    id: 'openai',
    name: 'OpenAI',
    kind: 'openai_compat',
    baseUrl: 'https://api.openai.com/v1',
    envKeyName: 'OPENAI_API_KEY',
    defaultModels: [
      { id: 'gpt-5.4', label: 'GPT-5.4' },
      { id: 'gpt-5.4-mini', label: 'GPT-5.4 Mini' },
      { id: 'gpt-5.4-nano', label: 'GPT-5.4 Nano' },
      { id: 'gpt-4.1', label: 'GPT-4.1' },
    ],
  },
  deepseek: {
    id: 'deepseek',
    name: 'DeepSeek',
    kind: 'openai_compat',
    baseUrl: 'https://api.deepseek.com/v1',
    envKeyName: 'DEEPSEEK_API_KEY',
    defaultModels: [
      { id: 'deepseek-chat', label: 'DeepSeek V3.2' },
      { id: 'deepseek-reasoner', label: 'DeepSeek R1' },
    ],
  },
  groq: {
    id: 'groq',
    name: 'Groq',
    kind: 'openai_compat',
    baseUrl: 'https://api.groq.com/openai/v1',
    envKeyName: 'GROQ_API_KEY',
    defaultModels: [
      { id: 'llama-3.3-70b-versatile', label: 'Llama 3.3 70B' },
    ],
  },
  qwen: {
    id: 'qwen',
    name: 'Qwen (Alibaba)',
    kind: 'openai_compat',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    envKeyName: 'QWEN_API_KEY',
    defaultModels: [
      { id: 'qwen3.5-plus', label: 'Qwen 3.5 Plus' },
      { id: 'qwen3.5-flash', label: 'Qwen 3.5 Flash' },
    ],
  },
  mistral: {
    id: 'mistral',
    name: 'Mistral',
    kind: 'openai_compat',
    baseUrl: 'https://api.mistral.ai/v1',
    envKeyName: 'MISTRAL_API_KEY',
    defaultModels: [
      { id: 'mistral-large-latest', label: 'Mistral Large 3' },
      { id: 'devstral-2-25-12', label: 'Devstral 2' },
    ],
  },
  xai: {
    id: 'xai',
    name: 'xAI (Grok)',
    kind: 'openai_compat',
    baseUrl: 'https://api.x.ai/v1',
    envKeyName: 'XAI_API_KEY',
    defaultModels: [
      { id: 'grok-4.20-0309-reasoning', label: 'Grok 4.20' },
    ],
  },
  together: {
    id: 'together',
    name: 'Together AI',
    kind: 'openai_compat',
    baseUrl: 'https://api.together.xyz/v1',
    envKeyName: 'TOGETHER_API_KEY',
  },
  custom: {
    id: 'custom',
    name: 'Custom OpenAI-Compatible',
    kind: 'openai_compat',
    baseUrl: '', // user must set CUSTOM_OPENAI_BASE_URL
    envKeyName: 'CUSTOM_OPENAI_API_KEY',
  },
}

const PROVIDER_IDS = new Set(Object.keys(PROVIDER_CATALOG))

/**
 * Parse a `provider:model_id` string into its parts.
 * Returns null if the string doesn't match the provider:model format.
 */
export function resolveProvider(modelString: string): {
  providerDef: ProviderDef
  modelId: string
} | null {
  const colonIdx = modelString.indexOf(':')
  if (colonIdx === -1) return null

  const providerId = modelString.slice(0, colonIdx)
  const modelId = modelString.slice(colonIdx + 1)

  if (!PROVIDER_IDS.has(providerId) || !modelId) return null

  return {
    providerDef: PROVIDER_CATALOG[providerId]!,
    modelId,
  }
}

/**
 * Check if a model string targets an OpenAI-compatible provider.
 */
export function isOpenAICompatModel(model: string): boolean {
  return resolveProvider(model) !== null
}

/**
 * Check if a model string targets ChatGPT subscription (chatgpt:model format).
 */
export function isChatGPTModel(model: string): boolean {
  return model.startsWith('chatgpt:')
}

/**
 * Get the provider API key from environment variables or global config.
 */
export function getProviderApiKey(providerDef: ProviderDef): string | undefined {
  // First check env var
  const envKey = process.env[providerDef.envKeyName]
  if (envKey) return envKey

  // Then check global config (provider_api_keys object)
  try {
    const config = getGlobalConfig() as any
    const keys = config?.provider_api_keys as Record<string, string> | undefined
    if (keys?.[providerDef.id]) {
      return keys[providerDef.id]
    }
  } catch {
    // config module may not be available in all contexts
  }

  return undefined
}

/**
 * Get all providers that have API keys configured.
 */
export function getConfiguredProviders(): ProviderDef[] {
  return Object.values(PROVIDER_CATALOG).filter(
    p => p.kind === 'openai_compat' && getProviderApiKey(p),
  )
}
