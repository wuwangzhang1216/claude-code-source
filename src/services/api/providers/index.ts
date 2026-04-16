/**
 * OpenAI-compatible provider support for Claude Code.
 *
 * Adds support for models from OpenAI, DeepSeek, Qwen, Mistral, and other
 * providers that expose the /v1/chat/completions API.
 *
 * Usage:
 *   --model openai:gpt-5.4          (OpenAI API key)
 *   --model deepseek:deepseek-chat   (DeepSeek API key)
 *   --model chatgpt:gpt-5.4          (ChatGPT subscription, no API key needed)
 */

export { PROVIDER_CATALOG, isOpenAICompatModel, isChatGPTModel, resolveProvider, getConfiguredProviders } from './catalog.js'
export { getOpenAIClient } from './openaiClient.js'
export { queryOpenAIModel } from './queryOpenAI.js'
export { queryChatGPTSubscription, CHATGPT_MODELS } from './chatgptSubscription.js'
export {
  generateAuthUrl,
  exchangeCode,
  refreshAccessToken,
  ensureValidToken,
  getChatGPTTokens,
  clearChatGPTTokens,
  isChatGPTConnected,
  startCallbackListener,
  stopCallbackListener,
  OAUTH_REDIRECT_URI,
} from './chatgptOAuth.js'
