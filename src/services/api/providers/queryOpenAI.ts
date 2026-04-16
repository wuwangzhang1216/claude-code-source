/**
 * OpenAI-compatible streaming query function.
 *
 * This generator produces the same StreamEvent | AssistantMessage output
 * as the Anthropic queryModel() in claude.ts, so all downstream consumers
 * (query.ts, tool orchestration) work unchanged.
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
import { resolveProvider } from './catalog.js'
import { getOpenAIClient } from './openaiClient.js'
import {
  messagesToOpenAI,
  toolsToOpenAI,
  openAIStopReasonToAnthropic,
  normalizeOpenAIUsage,
  type AccumulatedToolCall,
} from './messageTranslation.js'
import type { Options } from '../claude.js'

/**
 * Stream a query to an OpenAI-compatible provider.
 *
 * Translates Anthropic-shaped inputs -> OpenAI format, calls the API,
 * and translates streaming responses back to Anthropic-shaped events
 * so the rest of the pipeline works identically.
 */
export async function* queryOpenAIModel(
  messages: Message[],
  systemPrompt: SystemPrompt,
  _thinkingConfig: ThinkingConfig,
  tools: Tools,
  signal: AbortSignal,
  options: Options,
): AsyncGenerator<StreamEvent | AssistantMessage | SystemAPIErrorMessage, void> {
  const resolved = resolveProvider(options.model)
  if (!resolved) {
    throw new Error(`Cannot resolve OpenAI provider for model: ${options.model}`)
  }

  const { providerDef, modelId } = resolved
  const client = getOpenAIClient(providerDef)

  // Translate messages and tools
  const openAIMessages = messagesToOpenAI(messages, systemPrompt, tools)
  const openAITools = tools.length > 0
    ? await toolsToOpenAI(tools, {
        getToolPermissionContext: options.getToolPermissionContext,
        agents: options.agents,
        allowedAgentTypes: options.allowedAgentTypes,
        model: modelId,
      })
    : undefined

  // Build request params
  const params: Record<string, unknown> = {
    model: modelId,
    messages: openAIMessages,
    stream: true,
    stream_options: { include_usage: true },
  }
  if (openAITools && openAITools.length > 0) {
    params.tools = openAITools
  }
  if (options.maxOutputTokensOverride) {
    params.max_tokens = options.maxOutputTokensOverride
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

  // Track content blocks and tool calls
  let contentBlockIndex = -1
  let hasTextBlock = false
  let textContent = ''
  const toolCallAccumulators: Map<number, AccumulatedToolCall> = new Map()
  let finishReason: string | null = null
  let usageData: any = null

  try {
    const stream = await client.chat.completions.create(
      params as any,
      { signal },
    )

    for await (const chunk of stream as any) {
      const choice = chunk.choices?.[0]

      if (choice?.delta) {
        const delta = choice.delta

        // Handle reasoning content (DeepSeek, etc.)
        const reasoningText =
          delta.reasoning_content ?? delta.reasoning ?? null
        if (reasoningText) {
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
          textContent += reasoningText
          yield {
            type: 'stream_event',
            event: {
              type: 'content_block_delta',
              index: contentBlockIndex,
              delta: { type: 'text_delta', text: reasoningText },
            },
          } as unknown as StreamEvent
        }

        // Handle text content
        if (delta.content) {
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
          textContent += delta.content
          yield {
            type: 'stream_event',
            event: {
              type: 'content_block_delta',
              index: contentBlockIndex,
              delta: { type: 'text_delta', text: delta.content },
            },
          } as unknown as StreamEvent
        }

        // Handle tool calls (streamed incrementally)
        if (delta.tool_calls) {
          for (const tc of delta.tool_calls) {
            const idx = tc.index
            if (!toolCallAccumulators.has(idx)) {
              toolCallAccumulators.set(idx, {
                id: tc.id || '',
                name: '',
                arguments: '',
              })
            }
            const acc = toolCallAccumulators.get(idx)!
            if (tc.id) acc.id = tc.id
            if (tc.function?.name) acc.name = tc.function.name
            if (tc.function?.arguments) acc.arguments += tc.function.arguments
          }
        }
      }

      // Capture finish reason
      if (choice?.finish_reason) {
        finishReason = choice.finish_reason
      }

      // Capture usage (sent in final chunk with stream_options)
      if (chunk.usage) {
        usageData = chunk.usage
      }
    }
  } catch (err: any) {
    if (signal.aborted) throw err

    // Yield error as system message
    const errorMsg: SystemAPIErrorMessage = {
      type: 'system',
      message: {
        role: 'user',
        content: [
          {
            type: 'text',
            text: `API Error (${providerDef.name}): ${err.message || String(err)}`,
          },
        ],
      },
      uuid: randomUUID(),
      timestamp: new Date().toISOString(),
      isApiError: true,
    } as any
    yield errorMsg
    return
  }

  // Close text block if open
  if (hasTextBlock) {
    yield {
      type: 'stream_event',
      event: {
        type: 'content_block_stop',
        index: contentBlockIndex,
      },
    } as unknown as StreamEvent
  }

  // Build content blocks for the AssistantMessage
  const contentBlocks: any[] = []

  if (textContent) {
    contentBlocks.push({ type: 'text', text: textContent })
  }

  // Emit tool_use blocks
  for (const [, acc] of [...toolCallAccumulators.entries()].sort(
    (a, b) => a[0] - b[0],
  )) {
    let input: Record<string, unknown> = {}
    try {
      if (acc.arguments) {
        input = JSON.parse(acc.arguments)
      }
    } catch {
      input = { _raw: acc.arguments }
    }

    const toolBlock = {
      type: 'tool_use' as const,
      id: acc.id || `toolu_${randomUUID().replace(/-/g, '').slice(0, 20)}`,
      name: acc.name,
      input,
    }
    contentBlocks.push(toolBlock)

    // Emit streaming events for tool_use blocks too
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
        delta: {
          type: 'input_json_delta',
          partial_json: JSON.stringify(input),
        },
      },
    } as unknown as StreamEvent
    yield {
      type: 'stream_event',
      event: {
        type: 'content_block_stop',
        index: contentBlockIndex,
      },
    } as unknown as StreamEvent
  }

  // Build usage
  const usage = normalizeOpenAIUsage(usageData)
  const stopReason = openAIStopReasonToAnthropic(finishReason)

  // Emit message_delta with usage and stop_reason
  yield {
    type: 'stream_event',
    event: {
      type: 'message_delta',
      delta: { stop_reason: stopReason },
      usage: { output_tokens: usage.output_tokens },
    },
  } as unknown as StreamEvent

  // Emit message_stop
  yield {
    type: 'stream_event',
    event: { type: 'message_stop' },
  } as unknown as StreamEvent

  // Yield final AssistantMessage(s)
  const normalizedContent = contentBlocks.length > 0
    ? contentBlocks
    : [{ type: 'text', text: '' }]

  for (const block of normalizedContent) {
    const assistantMessage: AssistantMessage = {
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
    yield assistantMessage
  }
}
