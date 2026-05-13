import type { APIError } from '@anthropic-ai/sdk'

// SSL/TLS error codes from OpenSSL (used by both Node.js and Bun)
// See: https://www.openssl.org/docs/man3.1/man3/X509_STORE_CTX_get_error.html
const SSL_ERROR_CODES = new Set([
  // Certificate verification errors
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'UNABLE_TO_GET_ISSUER_CERT',
  'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
  'CERT_SIGNATURE_FAILURE',
  'CERT_NOT_YET_VALID',
  'CERT_HAS_EXPIRED',
  'CERT_REVOKED',
  'CERT_REJECTED',
  'CERT_UNTRUSTED',
  // Self-signed certificate errors
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'SELF_SIGNED_CERT_IN_CHAIN',
  // Chain errors
  'CERT_CHAIN_TOO_LONG',
  'PATH_LENGTH_EXCEEDED',
  // Hostname/altname errors
  'ERR_TLS_CERT_ALTNAME_INVALID',
  'HOSTNAME_MISMATCH',
  // TLS handshake errors
  'ERR_TLS_HANDSHAKE_TIMEOUT',
  'ERR_SSL_WRONG_VERSION_NUMBER',
  'ERR_SSL_DECRYPTION_FAILED_OR_BAD_RECORD_MAC',
])

export type ConnectionErrorDetails = {
  code: string
  message: string
  isSSLError: boolean
}

/**
 * Extracts connection error details from the error cause chain.
 * The Anthropic SDK wraps underlying errors in the `cause` property.
 * This function walks the cause chain to find the root error code/message.
 */
export function extractConnectionErrorDetails(
  error: unknown,
): ConnectionErrorDetails | null {
  if (!error || typeof error !== 'object') {
    return null
  }

  // Walk the cause chain to find the root error with a code
  let current: unknown = error
  const maxDepth = 5 // Prevent infinite loops
  let depth = 0

  while (current && depth < maxDepth) {
    if (
      current instanceof Error &&
      'code' in current &&
      typeof current.code === 'string'
    ) {
      const code = current.code
      const isSSLError = SSL_ERROR_CODES.has(code)
      return {
        code,
        message: current.message,
        isSSLError,
      }
    }

    // Move to the next cause in the chain
    if (
      current instanceof Error &&
      'cause' in current &&
      current.cause !== current
    ) {
      current = current.cause
      depth++
    } else {
      break
    }
  }

  return null
}

/**
 * Returns an actionable hint for SSL/TLS errors, intended for contexts outside
 * the main API client (OAuth token exchange, preflight connectivity checks)
 * where `formatAPIError` doesn't apply.
 *
 * Motivation: enterprise users behind TLS-intercepting proxies (Zscaler et al.)
 * see OAuth complete in-browser but the CLI's token exchange silently fails
 * with a raw SSL code. Surfacing the likely fix saves a support round-trip.
 */
export function getSSLErrorHint(error: unknown): string | null {
  const details = extractConnectionErrorDetails(error)
  if (!details?.isSSLError) {
    return null
  }
  return `SSL certificate error (${details.code}). If you are behind a corporate proxy or TLS-intercepting firewall, set NODE_EXTRA_CA_CERTS to your CA bundle path, or ask IT to allowlist *.anthropic.com. Run /doctor for details.`
}

/**
 * Strips HTML content (e.g., CloudFlare error pages) from a message string,
 * returning a user-friendly title or empty string if HTML is detected.
 * Returns the original message unchanged if no HTML is found.
 */
function sanitizeMessageHTML(message: string): string {
  if (message.includes('<!DOCTYPE html') || message.includes('<html')) {
    const titleMatch = message.match(/<title>([^<]+)<\/title>/)
    if (titleMatch && titleMatch[1]) {
      return titleMatch[1].trim()
    }
    return ''
  }
  return message
}

/**
 * Upstream 2.1.129: when an APIError carries a body the SDK couldn't
 * pretty-print, `error.message` ends up as the full JSON-stringified body
 * (e.g. `400 {"type":"error","error":{"type":"invalid_request_error",
 * "message":"…"}}`). The bare JSON dump in the assistant transcript is
 * useless to users; pull out the inner human-readable message instead.
 *
 * Conservative: only match when we recognise an `{ ..., "error": { "message"
 * } }`-shaped JSON body wrapped in optional status/method/path noise.
 * Anything else falls through to the original message untouched.
 */
function extractInlineJsonErrorMessage(message: string): string | null {
  // Find the first '{' and try to parse from there to the end of the string.
  const braceIdx = message.indexOf('{')
  if (braceIdx < 0) return null
  const jsonSlice = message.slice(braceIdx)
  let parsed: unknown
  try {
    parsed = JSON.parse(jsonSlice)
  } catch {
    return null
  }
  if (!parsed || typeof parsed !== 'object') return null
  const candidate =
    (parsed as { error?: { message?: string; error?: { message?: string } } })
      .error
  if (!candidate || typeof candidate !== 'object') return null
  // Standard Anthropic shape: { error: { error: { message } } }
  const deepMsg = candidate.error?.message
  if (typeof deepMsg === 'string' && deepMsg.length > 0) return deepMsg
  // Bedrock shape: { error: { message } }
  const msg = candidate.message
  if (typeof msg === 'string' && msg.length > 0) return msg
  return null
}

/**
 * Detects if an error message contains HTML content (e.g., CloudFlare error pages)
 * and returns a user-friendly message instead
 */
export function sanitizeAPIError(apiError: APIError): string {
  const message = apiError.message
  if (!message) {
    // Sometimes message is undefined
    // TODO: figure out why
    return ''
  }
  // Strip embedded JSON body before HTML sanitization — the JSON body itself
  // may contain HTML inside a string field, but the user wants the message,
  // not the encoded blob.
  const jsonExtracted = extractInlineJsonErrorMessage(message)
  if (jsonExtracted) return sanitizeMessageHTML(jsonExtracted)
  return sanitizeMessageHTML(message)
}

/**
 * Shapes of deserialized API errors from session JSONL.
 *
 * After JSON round-tripping, the SDK's APIError loses its `.message` property.
 * The actual message lives at different nesting levels depending on the provider:
 *
 * - Bedrock/proxy: `{ error: { message: "..." } }`
 * - Standard Anthropic API: `{ error: { error: { message: "..." } } }`
 *   (the outer `.error` is the response body, the inner `.error` is the API error)
 *
 * See also: `getErrorMessage` in `logging.ts` which handles the same shapes.
 */
type NestedAPIError = {
  error?: {
    message?: string
    error?: { message?: string }
  }
}

function hasNestedError(value: unknown): value is NestedAPIError {
  return (
    typeof value === 'object' &&
    value !== null &&
    'error' in value &&
    typeof value.error === 'object' &&
    value.error !== null
  )
}

/**
 * Extract a human-readable message from a deserialized API error that lacks
 * a top-level `.message`.
 *
 * Checks two nesting levels (deeper first for specificity):
 * 1. `error.error.error.message` — standard Anthropic API shape
 * 2. `error.error.message` — Bedrock shape
 */
function extractNestedErrorMessage(error: APIError): string | null {
  if (!hasNestedError(error)) {
    return null
  }

  // Access `.error` via the narrowed type so TypeScript sees the nested shape
  // instead of the SDK's `Object | undefined`.
  const narrowed: NestedAPIError = error
  const nested = narrowed.error

  // Standard Anthropic API shape: { error: { error: { message } } }
  const deepMsg = nested?.error?.message
  if (typeof deepMsg === 'string' && deepMsg.length > 0) {
    const sanitized = sanitizeMessageHTML(deepMsg)
    if (sanitized.length > 0) {
      return sanitized
    }
  }

  // Bedrock shape: { error: { message } }
  const msg = nested?.message
  if (typeof msg === 'string' && msg.length > 0) {
    const sanitized = sanitizeMessageHTML(msg)
    if (sanitized.length > 0) {
      return sanitized
    }
  }

  return null
}

export function formatAPIError(error: APIError): string {
  // Extract connection error details from the cause chain
  const connectionDetails = extractConnectionErrorDetails(error)

  if (connectionDetails) {
    const { code, isSSLError } = connectionDetails

    // Handle timeout errors
    if (code === 'ETIMEDOUT') {
      return 'Request timed out. Check your internet connection and proxy settings'
    }

    // Handle SSL/TLS errors with specific messages
    if (isSSLError) {
      switch (code) {
        case 'UNABLE_TO_VERIFY_LEAF_SIGNATURE':
        case 'UNABLE_TO_GET_ISSUER_CERT':
        case 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY':
          return 'Unable to connect to API: SSL certificate verification failed. Check your proxy or corporate SSL certificates'
        case 'CERT_HAS_EXPIRED':
          return 'Unable to connect to API: SSL certificate has expired'
        case 'CERT_REVOKED':
          return 'Unable to connect to API: SSL certificate has been revoked'
        case 'DEPTH_ZERO_SELF_SIGNED_CERT':
        case 'SELF_SIGNED_CERT_IN_CHAIN':
          return 'Unable to connect to API: Self-signed certificate detected. Check your proxy or corporate SSL certificates'
        case 'ERR_TLS_CERT_ALTNAME_INVALID':
        case 'HOSTNAME_MISMATCH':
          return 'Unable to connect to API: SSL certificate hostname mismatch'
        case 'CERT_NOT_YET_VALID':
          return 'Unable to connect to API: SSL certificate is not yet valid'
        default:
          return `Unable to connect to API: SSL error (${code})`
      }
    }
  }

  if (error.message === 'Connection error.') {
    // If we have a code but it's not SSL, include it for debugging
    if (connectionDetails?.code) {
      return `Unable to connect to API (${connectionDetails.code})`
    }
    return 'Unable to connect to API. Check your internet connection'
  }

  // Guard: when deserialized from JSONL (e.g. --resume), the error object may
  // be a plain object without a `.message` property.  Return a safe fallback
  // instead of undefined, which would crash callers that access `.length`.
  if (!error.message) {
    return (
      extractNestedErrorMessage(error) ??
      `API error (status ${error.status ?? 'unknown'})`
    )
  }

  const sanitizedMessage = sanitizeAPIError(error)
  // Use sanitized message if it's different from the original (i.e., HTML was sanitized)
  return sanitizedMessage !== error.message && sanitizedMessage.length > 0
    ? sanitizedMessage
    : error.message
}
