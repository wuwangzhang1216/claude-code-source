/**
 * Message format translation between Anthropic and OpenAI APIs.
 *
 * Converts the internal Anthropic-shaped messages to OpenAI chat completion
 * format and vice versa, enabling OpenAI-compatible providers to work within
 * the existing Claude Code pipeline.
 */

import type OpenAI from 'openai'
import type {
  BetaContentBlockParam,
  BetaToolResultBlockParam,
  BetaToolUnion,
} from '@anthropic-ai/sdk/resources/beta/messages/messages.mjs'
import type { SystemPrompt } from '../../../utils/systemPromptType.js'
import type { Message, AssistantMessage, UserMessage } from '../../../types/message.js'
import type { Tools, ToolPermissionContext } from '../../../Tool.js'
import type { AgentDefinition } from '../../../tools/AgentTool/loadAgentsDir.js'
import { normalizeMessagesForAPI } from '../../../utils/messages.js'
import { toolToAPISchema } from '../../../utils/api.js'

// ---------- Outbound: Anthropic -> OpenAI ----------

/**
 * Extract plain text from an Anthropic SystemPrompt.
 */
export function systemPromptToText(system: SystemPrompt): string {
  if (!system) return ''
  if (typeof system === 'string') return system
  if (Array.isArray(system)) {
    return (system as readonly any[])
      .map((block: any) => {
        if (typeof block === 'string') return block
        if (block.type === 'text') return block.text
        return ''
      })
      .filter(Boolean)
      .join('\n\n')
  }
  return ''
}

/**
 * Convert internal messages to OpenAI ChatCompletionMessageParam format.
 */
export function messagesToOpenAI(
  messages: Message[],
  systemPrompt: SystemPrompt,
  tools: Tools,
): OpenAI.ChatCompletionMessageParam[] {
  const result: OpenAI.ChatCompletionMessageParam[] = []

  // System message first
  const systemText = systemPromptToText(systemPrompt)
  if (systemText) {
    result.push({ role: 'system', content: systemText })
  }

  // Normalize messages to UserMessage | AssistantMessage pairs
  const normalized = normalizeMessagesForAPI(messages, tools)

  for (const msg of normalized) {
    if (msg.type === 'assistant') {
      const converted = convertAssistantMessage(msg as AssistantMessage)
      if (converted) result.push(converted)
    } else {
      // User message - may contain tool_result blocks
      const converted = convertUserMessage(msg as UserMessage)
      result.push(...converted)
    }
  }

  return result
}

function convertAssistantMessage(
  msg: AssistantMessage,
): OpenAI.ChatCompletionAssistantMessageParam | null {
  const content = msg.message.content
  if (!content) return null

  if (typeof content === 'string') {
    return { role: 'assistant', content }
  }

  const textParts: string[] = []
  const toolCalls: OpenAI.ChatCompletionMessageToolCall[] = []

  for (const block of content) {
    if (block.type === 'text') {
      textParts.push(block.text)
    } else if (block.type === 'tool_use') {
      toolCalls.push({
        id: block.id,
        type: 'function',
        function: {
          name: block.name,
          arguments:
            typeof block.input === 'string'
              ? block.input
              : JSON.stringify(block.input ?? {}),
        },
      })
    }
    // Skip 'thinking' blocks - not supported in OpenAI
  }

  const result: OpenAI.ChatCompletionAssistantMessageParam = {
    role: 'assistant',
    content: textParts.join('') || null,
  }

  if (toolCalls.length > 0) {
    result.tool_calls = toolCalls
  }

  return result
}

function convertUserMessage(
  msg: UserMessage,
): OpenAI.ChatCompletionMessageParam[] {
  const content = msg.message.content
  const results: OpenAI.ChatCompletionMessageParam[] = []

  if (typeof content === 'string') {
    results.push({ role: 'user', content })
    return results
  }

  // Separate tool_result blocks from other content
  const userParts: Array<OpenAI.ChatCompletionContentPart> = []
  const toolResults: BetaToolResultBlockParam[] = []

  for (const block of content as BetaContentBlockParam[]) {
    if (block.type === 'tool_result') {
      toolResults.push(block as BetaToolResultBlockParam)
    } else if (block.type === 'text') {
      userParts.push({ type: 'text', text: (block as any).text })
    } else if (block.type === 'image') {
      const imageBlock = block as any
      if (imageBlock.source?.type === 'base64') {
        userParts.push({
          type: 'image_url',
          image_url: {
            url: `data:${imageBlock.source.media_type};base64,${imageBlock.source.data}`,
          },
        })
      }
    }
  }

  // Emit tool results as separate 'tool' role messages (OpenAI format)
  for (const tr of toolResults) {
    let toolContent = ''
    if (typeof tr.content === 'string') {
      toolContent = tr.content
    } else if (Array.isArray(tr.content)) {
      toolContent = tr.content
        .map((b: any) => {
          if (b.type === 'text') return b.text
          if (b.type === 'image') return '[image]'
          return ''
        })
        .filter(Boolean)
        .join('\n')
    }
    results.push({
      role: 'tool',
      tool_call_id: tr.tool_use_id,
      content: toolContent || '(empty result)',
    })
  }

  // Emit user content (if any non-tool-result blocks exist)
  if (userParts.length > 0) {
    if (userParts.every(p => p.type === 'text')) {
      results.push({
        role: 'user',
        content: userParts.map(p => (p as any).text).join('\n'),
      })
    } else {
      results.push({ role: 'user', content: userParts })
    }
  }

  return results
}

// ---------- Tools: Anthropic -> OpenAI ----------

/**
 * Convert Anthropic tool definitions to OpenAI function-calling format.
 */
export async function toolsToOpenAI(
  tools: Tools,
  opts: {
    getToolPermissionContext: () => Promise<ToolPermissionContext>
    agents: AgentDefinition[]
    allowedAgentTypes?: string[]
    model?: string
  },
): Promise<OpenAI.ChatCompletionTool[]> {
  return Promise.all(
    tools.map(async tool => {
      const schema = await toolToAPISchema(tool, {
        getToolPermissionContext: opts.getToolPermissionContext,
        tools,
        agents: opts.agents,
        allowedAgentTypes: opts.allowedAgentTypes,
        model: opts.model,
      })
      return {
        type: 'function' as const,
        function: {
          name: schema.name,
          description: (schema as any).description || '',
          parameters: (schema as any).input_schema as Record<string, unknown>,
        },
      }
    }),
  )
}

// ---------- Inbound: OpenAI -> Anthropic ----------

/**
 * Map OpenAI finish_reason to Anthropic stop_reason.
 */
export function openAIStopReasonToAnthropic(
  finishReason: string | null,
): string {
  switch (finishReason) {
    case 'stop':
      return 'end_turn'
    case 'tool_calls':
      return 'tool_use'
    case 'length':
      return 'max_tokens'
    case 'content_filter':
      return 'end_turn'
    default:
      return 'end_turn'
  }
}

/**
 * Accumulated tool call from OpenAI streaming chunks.
 */
export interface AccumulatedToolCall {
  id: string
  name: string
  arguments: string
}

/**
 * Normalize OpenAI usage tokens to Anthropic-style usage object.
 */
export function normalizeOpenAIUsage(usage: any): {
  input_tokens: number
  output_tokens: number
  cache_creation_input_tokens: number
  cache_read_input_tokens: number
} {
  if (!usage) {
    return {
      input_tokens: 0,
      output_tokens: 0,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
    }
  }
  return {
    input_tokens: usage.prompt_tokens ?? 0,
    output_tokens: usage.completion_tokens ?? 0,
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: 0,
  }
}
