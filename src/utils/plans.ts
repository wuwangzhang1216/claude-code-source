import { randomUUID } from 'crypto'
import { copyFile, writeFile } from 'fs/promises'
import memoize from 'lodash-es/memoize.js'
import { join, resolve, sep } from 'path'
import type { AgentId, SessionId } from 'src/types/ids.js'
import type { LogOption } from 'src/types/logs.js'
import type {
  AssistantMessage,
  AttachmentMessage,
  SystemFileSnapshotMessage,
  UserMessage,
} from 'src/types/message.js'
import { getPlanSlugCache, getSessionId } from '../bootstrap/state.js'
import { EXIT_PLAN_MODE_V2_TOOL_NAME } from '../tools/ExitPlanModeTool/constants.js'
import { getCwd } from './cwd.js'
import { logForDebugging } from './debug.js'
import { getClaudeConfigHomeDir } from './envUtils.js'
import { isENOENT } from './errors.js'
import { getEnvironmentKind } from './filePersistence/outputsScanner.js'
import { getFsImplementation } from './fsOperations.js'
import { logError } from './log.js'
import { getInitialSettings } from './settings/settings.js'
import { generateWordSlug } from './words.js'

const MAX_SLUG_RETRIES = 10
// Upstream 2.1.111: plan files are named after the user's prompt. We keep
// the prompt-derived prefix short and cap the total length; the random
// word suffix disambiguates collisions (e.g. `fix-auth-race-snug-otter.md`).
const PROMPT_SLUG_MAX_WORDS = 4
const PROMPT_SLUG_MAX_CHARS = 40

/**
 * Convert a user prompt into a short kebab-case prefix suitable for a plan
 * filename. Returns null when the prompt produces no usable word.
 *
 * Used by callers that have the first user prompt for this session before
 * the plan slug is first requested. Downcase, drop URLs, keep only
 * `[a-z0-9]` word characters, trim to a few leading words.
 */
export function buildPromptPlanSlugPrefix(prompt: string): string | null {
  if (!prompt) return null
  // Strip slash-commands and URLs so `/plan https://…` doesn't become the slug.
  const cleaned = prompt
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/\/[a-z][\w:-]*/gi, ' ')
    .toLowerCase()
  const words: string[] = []
  for (const token of cleaned.split(/[^a-z0-9]+/)) {
    if (!token) continue
    if (token.length < 2) continue
    words.push(token)
    if (words.length >= PROMPT_SLUG_MAX_WORDS) break
  }
  if (words.length === 0) return null
  let prefix = words.join('-')
  if (prefix.length > PROMPT_SLUG_MAX_CHARS) {
    prefix = prefix.slice(0, PROMPT_SLUG_MAX_CHARS).replace(/-+$/, '')
  }
  return prefix || null
}

// Session-keyed map of prompt-derived prefixes, populated by the message
// pipeline when the first user prompt is known. Consulted by getPlanSlug on
// first access for a session.
const PLAN_SLUG_PROMPT_HINTS = new Map<SessionId | string, string>()

/**
 * Register the first user prompt for this session so the next getPlanSlug()
 * call builds a prompt-derived slug instead of purely random words.
 *
 * Safe to call multiple times; only the first call that precedes getPlanSlug()
 * wins (later calls are ignored once the slug is cached).
 */
export function setPlanSlugPromptHint(sessionId: SessionId, prompt: string): void {
  const prefix = buildPromptPlanSlugPrefix(prompt)
  if (prefix) PLAN_SLUG_PROMPT_HINTS.set(sessionId, prefix)
}

/**
 * Clear the prompt hint for a session (e.g. on /clear so the next plan
 * starts from a fresh prompt).
 */
export function clearPlanSlugPromptHint(sessionId: SessionId): void {
  PLAN_SLUG_PROMPT_HINTS.delete(sessionId)
}

/**
 * Get or generate a word slug for the current session's plan.
 * The slug is generated lazily on first access and cached for the session.
 * If a plan file with the generated slug already exists, retries up to 10 times.
 *
 * Upstream 2.1.111: if a prompt hint has been registered for this session,
 * the slug starts with prompt-derived words and appends a random word
 * suffix for uniqueness (e.g. `fix-auth-race-snug-otter`).
 */
export function getPlanSlug(sessionId?: SessionId): string {
  const id = sessionId ?? getSessionId()
  const cache = getPlanSlugCache()
  let slug = cache.get(id)
  if (!slug) {
    const plansDir = getPlansDirectory()
    const promptPrefix = PLAN_SLUG_PROMPT_HINTS.get(id)
    // Try to find a unique slug that doesn't conflict with existing files
    for (let i = 0; i < MAX_SLUG_RETRIES; i++) {
      slug = promptPrefix
        ? `${promptPrefix}-${generateWordSlug()}`
        : generateWordSlug()
      const filePath = join(plansDir, `${slug}.md`)
      if (!getFsImplementation().existsSync(filePath)) {
        break
      }
    }
    cache.set(id, slug!)
  }
  return slug!
}

/**
 * Set a specific plan slug for a session (used when resuming a session)
 */
export function setPlanSlug(sessionId: SessionId, slug: string): void {
  getPlanSlugCache().set(sessionId, slug)
}

/**
 * Clear the plan slug for the current session.
 * This should be called on /clear to ensure a fresh plan file is used.
 */
export function clearPlanSlug(sessionId?: SessionId): void {
  const id = sessionId ?? getSessionId()
  getPlanSlugCache().delete(id)
}

/**
 * Clear ALL plan slug entries (all sessions).
 * Use this on /clear to free sub-session slug entries.
 */
export function clearAllPlanSlugs(): void {
  getPlanSlugCache().clear()
}

// Memoized: called from render bodies (FileReadTool/FileEditTool/FileWriteTool UI.tsx)
// and permission checks. Inputs (initial settings + cwd) are fixed at startup, so the
// mkdirSync result is stable for the session. Without memoization, each rendered tool
// message triggers a mkdirSync syscall (regressed in #20005).
export const getPlansDirectory = memoize(function getPlansDirectory(): string {
  const settings = getInitialSettings()
  const settingsDir = settings.plansDirectory
  let plansPath: string

  if (settingsDir) {
    // Settings.json (relative to project root)
    const cwd = getCwd()
    const resolved = resolve(cwd, settingsDir)

    // Validate path stays within project root to prevent path traversal
    if (!resolved.startsWith(cwd + sep) && resolved !== cwd) {
      logError(
        new Error(`plansDirectory must be within project root: ${settingsDir}`),
      )
      plansPath = join(getClaudeConfigHomeDir(), 'plans')
    } else {
      plansPath = resolved
    }
  } else {
    // Default
    plansPath = join(getClaudeConfigHomeDir(), 'plans')
  }

  // Ensure directory exists (mkdirSync with recursive: true is a no-op if it exists)
  try {
    getFsImplementation().mkdirSync(plansPath)
  } catch (error) {
    logError(error)
  }

  return plansPath
})

/**
 * Get the file path for a session's plan
 * @param agentId Optional agent ID for subagents. If not provided, returns main session plan.
 * For main conversation (no agentId), returns {planSlug}.md
 * For subagents (agentId provided), returns {planSlug}-agent-{agentId}.md
 */
export function getPlanFilePath(agentId?: AgentId): string {
  const planSlug = getPlanSlug(getSessionId())

  // Main conversation: simple filename with word slug
  if (!agentId) {
    return join(getPlansDirectory(), `${planSlug}.md`)
  }

  // Subagents: include agent ID
  return join(getPlansDirectory(), `${planSlug}-agent-${agentId}.md`)
}

/**
 * Get the plan content for a session
 * @param agentId Optional agent ID for subagents. If not provided, returns main session plan.
 */
export function getPlan(agentId?: AgentId): string | null {
  const filePath = getPlanFilePath(agentId)
  try {
    return getFsImplementation().readFileSync(filePath, { encoding: 'utf-8' })
  } catch (error) {
    if (isENOENT(error)) return null
    logError(error)
    return null
  }
}

/**
 * Extract the plan slug from a log's message history.
 */
function getSlugFromLog(log: LogOption): string | undefined {
  return log.messages.find(m => m.slug)?.slug
}

/**
 * Restore plan slug from a resumed session.
 * Sets the slug in the session cache so getPlanSlug returns it.
 * If the plan file is missing, attempts to recover it from a file snapshot
 * (written incrementally during the session) or from message history.
 * Returns true if a plan file exists (or was recovered) for the slug.
 * @param log The log to restore from
 * @param targetSessionId The session ID to associate the plan slug with.
 *                        This should be the ORIGINAL session ID being resumed,
 *                        not the temporary session ID from before resume.
 */
export async function copyPlanForResume(
  log: LogOption,
  targetSessionId?: SessionId,
): Promise<boolean> {
  const slug = getSlugFromLog(log)
  if (!slug) {
    return false
  }

  // Set the slug for the target session ID (or current if not provided)
  const sessionId = targetSessionId ?? getSessionId()
  setPlanSlug(sessionId, slug)

  // Attempt to read the plan file directly — recovery triggers on ENOENT.
  const planPath = join(getPlansDirectory(), `${slug}.md`)
  try {
    await getFsImplementation().readFile(planPath, { encoding: 'utf-8' })
    return true
  } catch (e: unknown) {
    if (!isENOENT(e)) {
      // Don't throw — called fire-and-forget (void copyPlanForResume(...)) with no .catch()
      logError(e)
      return false
    }
    // Only attempt recovery in remote sessions (CCR) where files don't persist
    if (getEnvironmentKind() === null) {
      return false
    }

    logForDebugging(
      `Plan file missing during resume: ${planPath}. Attempting recovery.`,
    )

    // Try file snapshot first (written incrementally during session)
    const snapshotPlan = findFileSnapshotEntry(log.messages, 'plan')
    let recovered: string | null = null
    if (snapshotPlan && snapshotPlan.content.length > 0) {
      recovered = snapshotPlan.content
      logForDebugging(
        `Plan recovered from file snapshot, ${recovered.length} chars`,
        { level: 'info' },
      )
    } else {
      // Fall back to searching message history
      recovered = recoverPlanFromMessages(log)
      if (recovered) {
        logForDebugging(
          `Plan recovered from message history, ${recovered.length} chars`,
          { level: 'info' },
        )
      }
    }

    if (recovered) {
      try {
        await writeFile(planPath, recovered, { encoding: 'utf-8' })
        return true
      } catch (writeError) {
        logError(writeError)
        return false
      }
    }
    logForDebugging(
      'Plan file recovery failed: no file snapshot or plan content found in message history',
    )
    return false
  }
}

/**
 * Copy a plan file for a forked session. Unlike copyPlanForResume (which reuses
 * the original slug), this generates a NEW slug for the forked session and
 * writes the original plan content to the new file. This prevents the original
 * and forked sessions from clobbering each other's plan files.
 */
export async function copyPlanForFork(
  log: LogOption,
  targetSessionId: SessionId,
): Promise<boolean> {
  const originalSlug = getSlugFromLog(log)
  if (!originalSlug) {
    return false
  }

  const plansDir = getPlansDirectory()
  const originalPlanPath = join(plansDir, `${originalSlug}.md`)

  // Generate a new slug for the forked session (do NOT reuse the original)
  const newSlug = getPlanSlug(targetSessionId)
  const newPlanPath = join(plansDir, `${newSlug}.md`)
  try {
    await copyFile(originalPlanPath, newPlanPath)
    return true
  } catch (error) {
    if (isENOENT(error)) {
      return false
    }
    logError(error)
    return false
  }
}

/**
 * Recover plan content from the message history. Plan content can appear in
 * three forms depending on what happened during the session:
 *
 * 1. ExitPlanMode tool_use input — normalizeToolInput injects the plan content
 *    into the tool_use input, which persists in the transcript.
 *
 * 2. planContent field on user messages — set during the "clear context and
 *    implement" flow when ExitPlanMode is approved.
 *
 * 3. plan_file_reference attachment — created by auto-compact to preserve the
 *    plan across compaction boundaries.
 */
function recoverPlanFromMessages(log: LogOption): string | null {
  for (let i = log.messages.length - 1; i >= 0; i--) {
    const msg = log.messages[i]
    if (!msg) {
      continue
    }

    if (msg.type === 'assistant') {
      const { content } = (msg as AssistantMessage).message
      if (Array.isArray(content)) {
        for (const block of content) {
          if (
            block.type === 'tool_use' &&
            block.name === EXIT_PLAN_MODE_V2_TOOL_NAME
          ) {
            const input = block.input as Record<string, unknown> | undefined
            const plan = input?.plan
            if (typeof plan === 'string' && plan.length > 0) {
              return plan
            }
          }
        }
      }
    }

    if (msg.type === 'user') {
      const userMsg = msg as UserMessage
      if (
        typeof userMsg.planContent === 'string' &&
        userMsg.planContent.length > 0
      ) {
        return userMsg.planContent
      }
    }

    if (msg.type === 'attachment') {
      const attachmentMsg = msg as AttachmentMessage
      if (attachmentMsg.attachment?.type === 'plan_file_reference') {
        const plan = (attachmentMsg.attachment as { planContent?: string })
          .planContent
        if (typeof plan === 'string' && plan.length > 0) {
          return plan
        }
      }
    }
  }
  return null
}

/**
 * Find a file entry in the most recent file-snapshot system message in the transcript.
 * Scans backwards to find the latest snapshot.
 */
function findFileSnapshotEntry(
  messages: LogOption['messages'],
  key: string,
): { key: string; path: string; content: string } | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i]
    if (
      msg?.type === 'system' &&
      'subtype' in msg &&
      msg.subtype === 'file_snapshot' &&
      'snapshotFiles' in msg
    ) {
      const files = msg.snapshotFiles as Array<{
        key: string
        path: string
        content: string
      }>
      return files.find(f => f.key === key)
    }
  }
  return undefined
}

/**
 * Persist a snapshot of session files (plan, todos) to the transcript.
 * Called incrementally whenever these files change. Only active in remote
 * sessions (CCR) where local files don't persist between sessions.
 */
export async function persistFileSnapshotIfRemote(): Promise<void> {
  if (getEnvironmentKind() === null) {
    return
  }
  try {
    const snapshotFiles: SystemFileSnapshotMessage['snapshotFiles'] = []

    // Snapshot plan file
    const plan = getPlan()
    if (plan) {
      snapshotFiles.push({
        key: 'plan',
        path: getPlanFilePath(),
        content: plan,
      })
    }

    if (snapshotFiles.length === 0) {
      return
    }

    const message: SystemFileSnapshotMessage = {
      type: 'system',
      subtype: 'file_snapshot',
      content: 'File snapshot',
      level: 'info',
      isMeta: true,
      timestamp: new Date().toISOString(),
      uuid: randomUUID(),
      snapshotFiles,
    }

    const { recordTranscript } = await import('./sessionStorage.js')
    await recordTranscript([message])
  } catch (error) {
    logError(error)
  }
}
