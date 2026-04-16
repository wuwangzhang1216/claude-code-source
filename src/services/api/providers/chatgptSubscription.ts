/**
 * ChatGPT Subscription provider - calls the WHAM API using OAuth tokens.
 *
 * This lets ChatGPT Plus/Pro/Team subscribers use their subscription
 * to access GPT models without a separate API key.
 */

import { randomUUID } from 'crypto'
import type {
  Message,
  AssistantMessage,
  StreamEvent,
  SystemAPIErrorMessage,
} from '../../../types/message.js'
import type { SystemPrompt } from '../../../utils/systemPromptType.js'
import type { ThinkingConfig } from '../../../utils/thinking.js'
import type { Tools } from '../../../Tool.js'
import { normalizeMessagesForAPI } from '../../../utils/messages.js'
import { toolToAPISchema } from '../../../utils/api.js'
import {
  ensureValidToken,
  refreshAccessToken,
  type ChatGPTTokens,
} from './chatgptOAuth.js'
import { systemPromptToText } from './messageTranslation.js'
import type { Options } from '../claude.js'

const WHAM_BASE_URL = 'https://chatgpt.com/backend-api/codex'
const WHAM_RESPONSES_URL = `${WHAM_BASE_URL}/responses`

/** Available ChatGPT subscription models */
export const CHATGPT_MODELS = [
  { id: 'gpt-5.4', label: 'GPT-5.4' },
  { id: 'gpt-5.4-mini', label: 'GPT-5.4 Mini' },
  { id: 'gpt-5.4-nano', label: 'GPT-5.4 Nano' },
  { id: 'gpt-4.1', label: 'GPT-4.1' },
  { id: 'gpt-4.1-mini', label: 'GPT-4.1 Mini' },
  { id: 'gpt-4.1-nano', label: 'GPT-4.1 Nano' },
  { id: 'gpt-4o', label: 'GPT-4o' },
  { id: 'gpt-4o-mini', label: 'GPT-4o Mini' },
  { id: 'o3', label: 'o3' },
  { id: 'o4-mini', label: 'o4-mini' },
]

/**
 * Build the WHAM API request body from internal messages.
 */
async function buildWhamRequest(
  messages: Message[],
  systemPrompt: SystemPrompt,
  tools: Tools,
  modelId: string,
  options: Options,
) {
  const normalized = normalizeMessagesForAPI(messages, tools)

  const input: any[] = []
  const instructions = systemPromptToText(systemPrompt)

  for (const msg of normalized) {
    if (msg.type === 'assistant') {
      const content = msg.message.content
      if (typeof content === 'string') {
        input.push({
          role: 'assistant',
          content: [{ type: 'output_text', text: content }],
        })
      } else if (Array.isArray(content)) {
        let textParts: string[] = []
        for (const block of content) {
          if (block.type === 'text') {
            textParts.push(block.text)
          } else if (block.type === 'tool_use') {
            if (textParts.length > 0) {
              input.push({
                role: 'assistant',
                content: [{ type: 'output_text', text: textParts.join('') }],
              })
              textParts = []
            }
            input.push({
              type: 'function_call',
              call_id: block.id,
              name: block.name,
              arguments: typeof block.input === 'string'
                ? block.input
                : JSON.stringify(block.input ?? {}),
            })
          }
        }
        if (textParts.length > 0) {
          input.push({
            role: 'assistant',
            content: [{ type: 'output_text', text: textParts.join('') }],
          })
        }
      }
    } else {
      // User message
      const content = msg.message.content
      if (typeof content === 'string') {
        input.push({
          role: 'user',
          content: [{ type: 'input_text', text: content }],
        })
      } else if (Array.isArray(content)) {
        const userParts: any[] = []
        for (const block of content as any[]) {
          if (block.type === 'tool_result') {
            const resultContent = typeof block.content === 'string'
              ? block.content
              : Array.isArray(block.content)
                ? block.content.map((b: any) => b.type === 'text' ? b.text : '').filter(Boolean).join('\n')
                : '(empty)'
            input.push({
              type: 'function_call_output',
              call_id: block.tool_use_id,
              output: resultContent || '(empty)',
            })
          } else if (block.type === 'text') {
            userParts.push({ type: 'input_text', text: block.text })
          } else if (block.type === 'image') {
            const src = block.source
            if (src?.type === 'base64') {
              userParts.push({
                type: 'input_image',
                image_url: `data:${src.media_type};base64,${src.data}`,
              })
            } else if (src?.type === 'url') {
              userParts.push({ type: 'input_image', image_url: src.url })
            }
          }
        }
        if (userParts.length > 0) {
          input.push({ role: 'user', content: userParts })
        }
      }
    }
  }

  // Build tools list
  const whamTools: any[] = []
  for (const tool of tools) {
    const schema = await toolToAPISchema(tool, {
      getToolPermissionContext: options.getToolPermissionContext,
      tools,
      agents: options.agents,
      allowedAgentTypes: options.allowedAgentTypes,
      model: modelId,
    })
    whamTools.push({
      type: 'function',
      name: (schema as any).name,
      description: (schema as any).description || '',
      parameters: (schema as any).input_schema,
    })
  }

  return {
    model: modelId,
    store: false,
    stream: true,
    instructions: instructions || undefined,
    input,
    tools: whamTools.length > 0 ? whamTools : undefined,
    reasoning: { effort: 'medium', summary: 'auto' },
  }
}

/**
 * Parse SSE stream from WHAM API.
 */
async function* parseWhamSSE(
  response: Response,
  signal: AbortSignal,
): AsyncGenerator<{ event: string; data: any }> {
  const reader = response.body!.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  try {
    while (true) {
      if (signal.aborted) break
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop()!

      let currentEvent = ''
      let currentData = ''

      for (const line of lines) {
        if (line.startsWith('event: ')) {
          currentEvent = line.slice(7).trim()
        } else if (line.startsWith('data: ')) {
          currentData = line.slice(6)
        } else if (line === '' && currentData) {
          try {
            const parsed = JSON.parse(currentData)
            yield { event: currentEvent || parsed.type || '', data: parsed }
          } catch {
            // Skip unparseable data
          }
          currentEvent = ''
          currentData = ''
        }
      }
    }
  } finally {
    reader.releaseLock()
  }
}

/**
 * Stream a query to the ChatGPT WHAM API.
 */
export async function* queryChatGPTSubscription(
  messages: Message[],
  systemPrompt: SystemPrompt,
  _thinkingConfig: ThinkingConfig,
  tools: Tools,
  signal: AbortSignal,
  options: Options,
): AsyncGenerator<StreamEvent | AssistantMessage | SystemAPIErrorMessage, void> {
  // Extract model ID from chatgpt:model format
  const modelId = options.model.startsWith('chatgpt:')
    ? options.model.slice(8)
    : options.model

  function* yieldErrorAsAssistant(text: string) {
    yield {
      message: {
        id: randomUUID(),
        type: 'message',
        role: 'assistant',
        content: [{ type: 'text', text }],
        model: modelId,
        stop_reason: 'end_turn',
        stop_sequence: null,
        usage: {
          input_tokens: 0,
          output_tokens: 0,
          cache_creation_input_tokens: 0,
          cache_read_input_tokens: 0,
        },
      },
      requestId: undefined,
      type: 'assistant',
      uuid: randomUUID(),
      timestamp: new Date().toISOString(),
    } as any
  }

  let tokens: ChatGPTTokens
  try {
    tokens = await ensureValidToken()
  } catch (err: any) {
    yield* yieldErrorAsAssistant(`ChatGPT Auth Error: ${err.message}`)
    return
  }

  let body: any
  try {
    body = await buildWhamRequest(messages, systemPrompt, tools, modelId, options)
  } catch (err: any) {
    yield* yieldErrorAsAssistant(`ChatGPT Request Error: ${err.message || String(err)}`)
    return
  }

  // Emit message_start
  yield {
    type: 'stream_event',
    event: {
      type: 'message_start',
      message: {
        id: randomUUID(),
        type: 'message',
        role: 'assistant',
        content: [],
        model: modelId,
        stop_reason: null,
        usage: { input_tokens: 0, output_tokens: 0 },
      },
    },
  } as unknown as StreamEvent

  let textContent = ''
  let hasTextBlock = false
  let contentBlockIndex = -1
  const toolCallMap: Map<string, { call_id: string; name: string; arguments: string }> = new Map()
  let usageData: any = null
  let retried = false

  async function doRequest(tkns: ChatGPTTokens): Promise<Response> {
    return fetch(WHAM_RESPONSES_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${tkns.accessToken}`,
        'ChatGPT-Account-Id': tkns.accountId,
      },
      body: JSON.stringify(body),
      signal,
    })
  }

  let response: Response
  try {
    response = await doRequest(tokens)

    // Auto-retry on 401 with refreshed token
    if (response.status === 401 && !retried) {
      retried = true
      await refreshAccessToken()
      tokens = await ensureValidToken()
      response = await doRequest(tokens)
    }

    if (!response.ok) {
      const errText = await response.text()
      throw new Error(`WHAM API error ${response.status}: ${errText}`)
    }
  } catch (err: any) {
    if (signal.aborted) throw err
    yield* yieldErrorAsAssistant(`ChatGPT Error: ${err.message || String(err)}`)
    return
  }

  // Parse SSE stream
  try {
    for await (const { event, data } of parseWhamSSE(response, signal)) {
      const eventType = event || data?.type || ''

      // Text delta
      if (
        eventType === 'response.output_text.delta' ||
        eventType === 'response.text.delta'
      ) {
        const deltaText = data?.delta || ''
        if (deltaText) {
          if (!hasTextBlock) {
            hasTextBlock = true
            contentBlockIndex++
            yield {
              type: 'stream_event',
              event: {
                type: 'content_block_start',
                index: contentBlockIndex,
                content_block: { type: 'text', text: '' },
              },
            } as unknown as StreamEvent
          }
          textContent += deltaText
          yield {
            type: 'stream_event',
            event: {
              type: 'content_block_delta',
              index: contentBlockIndex,
              delta: { type: 'text_delta', text: deltaText },
            },
          } as unknown as StreamEvent
        }
      }

      // Reasoning summary delta
      if (eventType === 'response.reasoning_summary_text.delta') {
        const deltaText = data?.delta || ''
        if (deltaText) {
          if (!hasTextBlock) {
            hasTextBlock = true
            contentBlockIndex++
            yield {
              type: 'stream_event',
              event: {
                type: 'content_block_start',
                index: contentBlockIndex,
                content_block: { type: 'text', text: '' },
              },
            } as unknown as StreamEvent
          }
          textContent += deltaText
          yield {
            type: 'stream_event',
            event: {
              type: 'content_block_delta',
              index: contentBlockIndex,
              delta: { type: 'text_delta', text: deltaText },
            },
          } as unknown as StreamEvent
        }
      }

      // Function call arguments delta
      if (eventType === 'response.function_call_arguments.delta') {
        const itemId = data?.item_id || ''
        const argsDelta = data?.delta || ''
        if (itemId && argsDelta) {
          if (!toolCallMap.has(itemId)) {
            toolCallMap.set(itemId, { call_id: '', name: '', arguments: '' })
          }
          toolCallMap.get(itemId)!.arguments += argsDelta
        }
      }

      // Output item added (function call start)
      if (eventType === 'response.output_item.added') {
        const item = data?.item
        if (item?.type === 'function_call') {
          const itemId = item.id || randomUUID()
          const existing = toolCallMap.get(itemId)
          toolCallMap.set(itemId, {
            call_id: item.call_id || existing?.call_id || itemId,
            name: item.name || existing?.name || '',
            arguments: existing?.arguments ?? '',
          })
        }
      }

      // Response completed - extract usage
      if (eventType === 'response.completed') {
        const resp = data?.response
        if (resp?.usage) {
          usageData = resp.usage
        }
      }

      // Error
      if (eventType === 'error') {
        const errMsg = data?.message || data?.error?.message || 'Unknown WHAM error'
        yield* yieldErrorAsAssistant(`ChatGPT Error: ${errMsg}`)
        return
      }
    }
  } catch (err: any) {
    if (signal.aborted) throw err
    // Stream interrupted
  }

  // Close text block
  if (hasTextBlock) {
    yield {
      type: 'stream_event',
      event: { type: 'content_block_stop', index: contentBlockIndex },
    } as unknown as StreamEvent
  }

  // Build content blocks
  const contentBlocks: any[] = []
  if (textContent) {
    contentBlocks.push({ type: 'text', text: textContent })
  }

  // Emit tool_use blocks
  for (const [, tc] of toolCallMap) {
    let input: Record<string, unknown> = {}
    try {
      if (tc.arguments) input = JSON.parse(tc.arguments)
    } catch {
      input = { _raw: tc.arguments }
    }

    const toolBlock = {
      type: 'tool_use' as const,
      id: tc.call_id || `toolu_${randomUUID().replace(/-/g, '').slice(0, 20)}`,
      name: tc.name,
      input,
    }
    contentBlocks.push(toolBlock)

    contentBlockIndex++
    yield {
      type: 'stream_event',
      event: {
        type: 'content_block_start',
        index: contentBlockIndex,
        content_block: { ...toolBlock, input: {} },
      },
    } as unknown as StreamEvent
    yield {
      type: 'stream_event',
      event: {
        type: 'content_block_delta',
        index: contentBlockIndex,
        delta: { type: 'input_json_delta', partial_json: JSON.stringify(input) },
      },
    } as unknown as StreamEvent
    yield {
      type: 'stream_event',
      event: { type: 'content_block_stop', index: contentBlockIndex },
    } as unknown as StreamEvent
  }

  // Usage
  const usage = {
    input_tokens: usageData?.input_tokens ?? usageData?.prompt_tokens ?? 0,
    output_tokens: usageData?.output_tokens ?? usageData?.completion_tokens ?? 0,
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: 0,
  }

  const stopReason = toolCallMap.size > 0 ? 'tool_use' : 'end_turn'

  // Emit message_delta + message_stop
  yield {
    type: 'stream_event',
    event: {
      type: 'message_delta',
      delta: { stop_reason: stopReason },
      usage: { output_tokens: usage.output_tokens },
    },
  } as unknown as StreamEvent

  yield {
    type: 'stream_event',
    event: { type: 'message_stop' },
  } as unknown as StreamEvent

  // Yield final AssistantMessage(s)
  const finalContent = contentBlocks.length > 0
    ? contentBlocks
    : [{ type: 'text', text: '' }]

  for (const block of finalContent) {
    yield {
      message: {
        id: randomUUID(),
        type: 'message',
        role: 'assistant',
        content: [block],
        model: modelId,
        stop_reason: stopReason,
        stop_sequence: null,
        usage,
      },
      requestId: undefined,
      type: 'assistant',
      uuid: randomUUID(),
      timestamp: new Date().toISOString(),
    } as any
  }
}
