/**
 * OpenAI SDK client factory for OpenAI-compatible providers.
 */

import OpenAI from 'openai'
import { type ProviderDef, getProviderApiKey } from './catalog.js'

/**
 * Create an OpenAI SDK client configured for the given provider.
 */
export function getOpenAIClient(providerDef: ProviderDef): OpenAI {
  const apiKey = getProviderApiKey(providerDef)
  if (!apiKey) {
    throw new Error(
      `No API key configured for ${providerDef.name}. ` +
        `Set the ${providerDef.envKeyName} environment variable.`,
    )
  }

  let baseURL = providerDef.baseUrl
  if (providerDef.id === 'custom') {
    baseURL = process.env.CUSTOM_OPENAI_BASE_URL || ''
    if (!baseURL) {
      throw new Error(
        'Custom provider requires CUSTOM_OPENAI_BASE_URL to be set.',
      )
    }
  }

  return new OpenAI({
    apiKey,
    baseURL,
    timeout: parseInt(process.env.API_TIMEOUT_MS || String(600 * 1000), 10),
  })
}
