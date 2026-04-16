/**
 * ChatGPT Subscription OAuth flow (PKCE S256).
 *
 * Uses OpenAI's OAuth endpoint to authenticate ChatGPT Plus/Pro/Team subscribers.
 * Tokens are stored in global config and used to call the WHAM API.
 */

import { randomBytes, createHash } from 'crypto'
import http from 'http'
import { getGlobalConfig, saveGlobalConfig } from '../../../utils/config.js'

// Shared Codex community client ID (public, no secret required)
const CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann'
const AUTH_URL = 'https://auth.openai.com/oauth/authorize'
const TOKEN_URL = 'https://auth.openai.com/oauth/token'
const SCOPES = 'openid profile email offline_access'

export const OAUTH_CALLBACK_PORT = 1455
export const OAUTH_REDIRECT_URI = `http://localhost:${OAUTH_CALLBACK_PORT}/auth/callback`

// In-memory pending OAuth flows: state -> { codeVerifier, redirectUri, createdAt }
const pendingFlows = new Map<
  string,
  { codeVerifier: string; redirectUri: string; createdAt: number }
>()

// Refresh lock to prevent concurrent refreshes
let refreshPromise: Promise<void> | null = null

export interface ChatGPTTokens {
  accessToken: string
  refreshToken: string
  accountId: string
  expiresAt: number // ms since epoch
  email: string
}

/**
 * Generate a PKCE auth URL for ChatGPT login.
 */
export function generateAuthUrl(redirectUri: string): {
  authUrl: string
  state: string
} {
  const codeVerifier = randomBytes(32).toString('base64url')
  const codeChallenge = createHash('sha256')
    .update(codeVerifier)
    .digest('base64url')

  const state = randomBytes(16).toString('hex')

  pendingFlows.set(state, {
    codeVerifier,
    redirectUri,
    createdAt: Date.now(),
  })

  // Clean up old pending flows (>10 min)
  for (const [key, flow] of pendingFlows) {
    if (Date.now() - flow.createdAt > 10 * 60 * 1000) {
      pendingFlows.delete(key)
    }
  }

  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: SCOPES,
    state,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
    id_token_add_organizations: 'true',
    codex_cli_simplified_flow: 'true',
    originator: 'codex',
  })

  return {
    authUrl: `${AUTH_URL}?${params}`,
    state,
  }
}

/**
 * Exchange an authorization code for tokens.
 */
export async function exchangeCode(
  code: string,
  state: string,
): Promise<ChatGPTTokens> {
  const flow = pendingFlows.get(state)
  if (!flow) {
    throw new Error('Invalid or expired OAuth state. Please try logging in again.')
  }
  pendingFlows.delete(state)

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: CLIENT_ID,
      code,
      redirect_uri: flow.redirectUri,
      code_verifier: flow.codeVerifier,
    }).toString(),
  })

  if (!res.ok) {
    const err = await res.text()
    throw new Error(`Token exchange failed: ${err}`)
  }

  const data = (await res.json()) as {
    access_token: string
    refresh_token: string
    id_token: string
    expires_in: number
  }

  const accountId = extractAccountId(data.id_token)
  const email = extractEmail(data.id_token)
  const expiresAt = Date.now() + data.expires_in * 1000

  const tokens: ChatGPTTokens = {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    accountId,
    expiresAt,
    email,
  }

  saveChatGPTTokens(tokens)
  return tokens
}

/**
 * Refresh an expired access token.
 */
export async function refreshAccessToken(): Promise<void> {
  if (refreshPromise) {
    await refreshPromise
    return
  }

  const tokens = getChatGPTTokens()
  if (!tokens?.refreshToken) {
    throw new Error('No refresh token available. Please log in again.')
  }

  refreshPromise = (async () => {
    try {
      const res = await fetch(TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'refresh_token',
          client_id: CLIENT_ID,
          refresh_token: tokens.refreshToken,
        }).toString(),
      })

      if (!res.ok) {
        const err = await res.text()
        throw new Error(`Token refresh failed: ${err}`)
      }

      const data = (await res.json()) as {
        access_token: string
        refresh_token: string
        id_token?: string
        expires_in: number
      }

      const updated: ChatGPTTokens = {
        accessToken: data.access_token,
        refreshToken: data.refresh_token || tokens.refreshToken,
        accountId: tokens.accountId,
        expiresAt: Date.now() + data.expires_in * 1000,
        email: tokens.email,
      }

      saveChatGPTTokens(updated)
    } finally {
      refreshPromise = null
    }
  })()

  await refreshPromise
}

/**
 * Ensure the access token is valid, refreshing if needed.
 */
export async function ensureValidToken(): Promise<ChatGPTTokens> {
  const tokens = getChatGPTTokens()
  if (!tokens) {
    throw new Error('ChatGPT not connected. Run `claude chatgpt-login` to authenticate.')
  }

  // Proactive refresh: 5 min buffer
  if (Date.now() > tokens.expiresAt - 5 * 60 * 1000) {
    await refreshAccessToken()
    return getChatGPTTokens()!
  }

  return tokens
}

/**
 * Get stored ChatGPT tokens from global config.
 */
export function getChatGPTTokens(): ChatGPTTokens | null {
  try {
    const config = getGlobalConfig() as any
    if (!config.chatgpt_access_token) return null
    return {
      accessToken: config.chatgpt_access_token,
      refreshToken: config.chatgpt_refresh_token || '',
      accountId: config.chatgpt_account_id || '',
      expiresAt: config.chatgpt_expires_at || 0,
      email: config.chatgpt_email || '',
    }
  } catch {
    return null
  }
}

/**
 * Save ChatGPT tokens to global config.
 */
export function saveChatGPTTokens(tokens: ChatGPTTokens): void {
  saveGlobalConfig((current: any) => ({
    ...current,
    chatgpt_access_token: tokens.accessToken,
    chatgpt_refresh_token: tokens.refreshToken,
    chatgpt_account_id: tokens.accountId,
    chatgpt_expires_at: tokens.expiresAt,
    chatgpt_email: tokens.email,
  }))
}

/**
 * Clear ChatGPT tokens.
 */
export function clearChatGPTTokens(): void {
  saveGlobalConfig((current: any) => {
    const {
      chatgpt_access_token,
      chatgpt_refresh_token,
      chatgpt_account_id,
      chatgpt_expires_at,
      chatgpt_email,
      ...rest
    } = current as any
    return rest
  })
}

/**
 * Check if ChatGPT subscription is connected.
 */
export function isChatGPTConnected(): boolean {
  const tokens = getChatGPTTokens()
  return !!tokens?.accessToken
}

// --- JWT helpers (decode without verification - trust OpenAI) ---

function decodeJwtPayload(token: string): Record<string, any> {
  try {
    const parts = token.split('.')
    if (parts.length < 2) return {}
    const payload = Buffer.from(parts[1]!, 'base64url').toString('utf-8')
    return JSON.parse(payload)
  } catch {
    return {}
  }
}

function extractAccountId(idToken: string): string {
  const payload = decodeJwtPayload(idToken)

  const authClaim = payload['https://api.openai.com/auth'] as any
  if (authClaim) {
    if (authClaim.chatgpt_account_id) return authClaim.chatgpt_account_id
    const orgs = authClaim.organizations
    if (Array.isArray(orgs) && orgs[0]) {
      if (orgs[0].chatgpt_account_id) return orgs[0].chatgpt_account_id
      if (orgs[0].id) return orgs[0].id
    }
  }

  if (payload.chatgpt_account_id) return payload.chatgpt_account_id
  return payload.sub || ''
}

function extractEmail(idToken: string): string {
  const payload = decodeJwtPayload(idToken)
  return payload.email || ''
}

// --- One-shot callback listener on port 1455 (Node.js http) ---

let callbackServer: http.Server | null = null
let callbackTimeout: ReturnType<typeof setTimeout> | null = null

/**
 * Start a temporary HTTP server on port 1455 to catch the OAuth redirect.
 * Shuts down after handling one request or after 10 minutes.
 */
export function startCallbackListener(
  onComplete: (result: { tokens?: ChatGPTTokens; error?: string }) => void,
): void {
  stopCallbackListener()

  const htmlPage = (title: string, body: string, color: string) =>
    `<!DOCTYPE html><html><head><title>${title}</title></head>
<body style="font-family:system-ui;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#0a0a0a;color:#e0e0e0">
<div style="text-align:center;max-width:400px;padding:2rem">
<div style="font-size:3rem;margin-bottom:1rem;color:${color}">${color === '#4ade80' ? '&#10003;' : '&#10007;'}</div>
<h1 style="font-size:1.25rem;margin-bottom:.5rem">${title}</h1>
<p style="color:#888;font-size:.875rem">${body}</p>
<p style="color:#666;font-size:.75rem;margin-top:1.5rem">You can close this tab.</p>
</div></body></html>`

  try {
    callbackServer = http.createServer(async (req, res) => {
      const url = new URL(req.url || '/', `http://localhost:${OAUTH_CALLBACK_PORT}`)
      if (url.pathname !== '/auth/callback') {
        res.writeHead(404).end('Not found')
        return
      }

      const code = url.searchParams.get('code')
      const state = url.searchParams.get('state')
      const error = url.searchParams.get('error')

      if (error) {
        const errDesc = url.searchParams.get('error_description') || ''
        onComplete({ error: `${error}: ${errDesc}` })
        res.writeHead(400, { 'Content-Type': 'text/html' }).end(
          htmlPage('Login Failed', error, '#f87171'),
        )
        stopCallbackListener()
        return
      }

      if (!code || !state) {
        onComplete({ error: 'Missing code or state parameter' })
        res.writeHead(400, { 'Content-Type': 'text/html' }).end(
          htmlPage('Login Failed', 'Missing code or state', '#f87171'),
        )
        stopCallbackListener()
        return
      }

      try {
        const tokens = await exchangeCode(code, state)
        onComplete({ tokens })
        res.writeHead(200, { 'Content-Type': 'text/html' }).end(
          htmlPage('Login Successful', `Signed in as <strong>${tokens.email}</strong>`, '#4ade80'),
        )
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        onComplete({ error: msg })
        res.writeHead(500, { 'Content-Type': 'text/html' }).end(
          htmlPage('Login Failed', msg, '#f87171'),
        )
      }
      stopCallbackListener()
    })

    callbackServer.listen(OAUTH_CALLBACK_PORT, '127.0.0.1')

    // Auto-stop after 10 minutes
    callbackTimeout = setTimeout(() => stopCallbackListener(), 10 * 60 * 1000)
  } catch (err) {
    console.warn(
      `ChatGPT OAuth callback listener failed to start on port ${OAUTH_CALLBACK_PORT}:`,
      err,
    )
  }
}

export function stopCallbackListener(): void {
  if (callbackServer) {
    try { callbackServer.close() } catch { /* ignore */ }
    callbackServer = null
  }
  if (callbackTimeout) {
    clearTimeout(callbackTimeout)
    callbackTimeout = null
  }
}
