import { isEnvTruthy } from './envUtils.js'
import { getSessionId } from '../bootstrap/state.js'

/**
 * Env vars to strip from subprocess environments when running inside GitHub
 * Actions. This prevents prompt-injection attacks from exfiltrating secrets
 * via shell expansion (e.g., ${ANTHROPIC_API_KEY}) in Bash tool commands.
 *
 * The parent claude process keeps these vars (needed for API calls, lazy
 * credential reads). Only child processes (bash, shell snapshot, MCP stdio, LSP, hooks) are scrubbed.
 *
 * GITHUB_TOKEN / GH_TOKEN are intentionally NOT scrubbed — wrapper scripts
 * (gh.sh) need them to call the GitHub API. That token is job-scoped and
 * expires when the workflow ends.
 */
const GHA_SUBPROCESS_SCRUB = [
  // Anthropic auth — claude re-reads these per-request, subprocesses don't need them
  'ANTHROPIC_API_KEY',
  'CLAUDE_CODE_OAUTH_TOKEN',
  'ANTHROPIC_AUTH_TOKEN',
  'ANTHROPIC_FOUNDRY_API_KEY',
  'ANTHROPIC_CUSTOM_HEADERS',

  // OTLP exporter headers — documented to carry Authorization=Bearer tokens
  // for monitoring backends; read in-process by OTEL SDK, subprocesses never need them
  'OTEL_EXPORTER_OTLP_HEADERS',
  'OTEL_EXPORTER_OTLP_LOGS_HEADERS',
  'OTEL_EXPORTER_OTLP_METRICS_HEADERS',
  'OTEL_EXPORTER_OTLP_TRACES_HEADERS',

  // Cloud provider creds — same pattern (lazy SDK reads)
  'AWS_SECRET_ACCESS_KEY',
  'AWS_SESSION_TOKEN',
  'AWS_BEARER_TOKEN_BEDROCK',
  'GOOGLE_APPLICATION_CREDENTIALS',
  'AZURE_CLIENT_SECRET',
  'AZURE_CLIENT_CERTIFICATE_PATH',

  // GitHub Actions OIDC — consumed by the action's JS before claude spawns;
  // leaking these allows minting an App installation token → repo takeover
  'ACTIONS_ID_TOKEN_REQUEST_TOKEN',
  'ACTIONS_ID_TOKEN_REQUEST_URL',

  // GitHub Actions artifact/cache API — cache poisoning → supply-chain pivot
  'ACTIONS_RUNTIME_TOKEN',
  'ACTIONS_RUNTIME_URL',

  // claude-code-action-specific duplicates — action JS consumes these during
  // prepare, before spawning claude. ALL_INPUTS contains anthropic_api_key as JSON.
  'ALL_INPUTS',
  'OVERRIDE_GITHUB_TOKEN',
  'DEFAULT_WORKFLOW_TOKEN',
  'SSH_SIGNING_KEY',
] as const

/**
 * Returns a copy of process.env with sensitive secrets stripped, for use when
 * spawning subprocesses (Bash tool, shell snapshot, MCP stdio servers, LSP
 * servers, shell hooks).
 *
 * Gated on CLAUDE_CODE_SUBPROCESS_ENV_SCRUB. claude-code-action sets this
 * automatically when `allowed_non_write_users` is configured — the flag that
 * exposes a workflow to untrusted content (prompt injection surface).
 */
// Registered by init.ts after the upstreamproxy module is dynamically imported
// in CCR sessions. Stays undefined in non-CCR startups so we never pull in the
// upstreamproxy module graph (upstreamproxy.ts + relay.ts) via a static import.
let _getUpstreamProxyEnv: (() => Record<string, string>) | undefined

/**
 * Called from init.ts to wire up the proxy env function after the upstreamproxy
 * module has been lazily loaded. Must be called before any subprocess is spawned.
 */
export function registerUpstreamProxyEnvFn(
  fn: () => Record<string, string>,
): void {
  _getUpstreamProxyEnv = fn
}

/**
 * Upstream 2.1.128: subprocesses (Bash, hooks, MCP, LSP) must not inherit
 * the CLI's OTEL_* configuration. Otherwise OTEL-instrumented apps invoked
 * via Bash would pick up the CLI's OTLP endpoint, sample rate, service name,
 * etc. — flooding the Claude Code session telemetry with the child app's
 * spans and silently cross-tenanting export endpoints.
 *
 * Strip every OTEL_* variable unconditionally (not gated on
 * CLAUDE_CODE_SUBPROCESS_ENV_SCRUB) since this is about isolating the
 * child app's telemetry, not about secret hygiene.
 */
function stripOtelVars(env: NodeJS.ProcessEnv): void {
  for (const key of Object.keys(env)) {
    if (key.startsWith('OTEL_')) {
      delete env[key]
    }
  }
}

export function subprocessEnv(): NodeJS.ProcessEnv {
  // CCR upstreamproxy: inject HTTPS_PROXY + CA bundle vars so curl/gh/python
  // in agent subprocesses route through the local relay. Returns {} when the
  // proxy is disabled or not registered (non-CCR), so this is a no-op outside
  // CCR containers.
  const proxyEnv = _getUpstreamProxyEnv?.() ?? {}

  // Upstream 2.1.120: identify Claude-spawned subprocesses to env-aware CLIs.
  // `gh` (and other tools that key on AI_AGENT) attribute traffic correctly
  // when this is set; absence isn't an error, but with it set the GitHub
  // backend can distinguish Claude Code traffic from human-driven `gh`. Use
  // 'claude_code' verbatim — this is the documented value upstream agreed
  // with the gh team. Don't override if the user already set AI_AGENT (e.g.
  // running Claude Code from inside a wrapper that wants its own attribution).
  const agentAttribution: NodeJS.ProcessEnv = process.env.AI_AGENT
    ? {}
    : { AI_AGENT: 'claude_code' }

  // Upstream 2.1.132: expose the current Claude Code session id to every
  // subprocess (Bash, hooks, MCP stdio, LSP, shell snapshot) — matches the
  // session_id that hooks already receive in their payload, so user scripts
  // can correlate shell-side work with the parent session. May be undefined
  // very early in startup before getSessionId is initialized; skip in that
  // case so spawned children don't see the literal string "undefined".
  const sessionId = getSessionId()
  const sessionAttribution: NodeJS.ProcessEnv = sessionId
    ? { CLAUDE_CODE_SESSION_ID: sessionId }
    : {}

  if (!isEnvTruthy(process.env.CLAUDE_CODE_SUBPROCESS_ENV_SCRUB)) {
    const merged = {
      ...process.env,
      ...proxyEnv,
      ...agentAttribution,
      ...sessionAttribution,
    }
    stripOtelVars(merged)
    return merged
  }
  const env = {
    ...process.env,
    ...proxyEnv,
    ...agentAttribution,
    ...sessionAttribution,
  }
  for (const k of GHA_SUBPROCESS_SCRUB) {
    delete env[k]
    // GitHub Actions auto-creates INPUT_<NAME> for `with:` inputs, duplicating
    // secrets like INPUT_ANTHROPIC_API_KEY. No-op for vars that aren't action inputs.
    delete env[`INPUT_${k}`]
  }
  stripOtelVars(env)
  return env
}
