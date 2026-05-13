/**
 * Shared analytics configuration
 *
 * Common logic for determining when analytics should be disabled
 * across all analytics systems (Datadog, 1P)
 */

import { isEnvTruthy } from '../../utils/envUtils.js'
import { isTelemetryDisabled } from '../../utils/privacyLevel.js'

/**
 * Check if analytics operations should be disabled
 *
 * Analytics is disabled in the following cases:
 * - Test environment (NODE_ENV === 'test')
 * - Third-party cloud providers (Bedrock/Vertex)
 * - Privacy level is no-telemetry or essential-traffic
 */
export function isAnalyticsDisabled(): boolean {
  return (
    process.env.NODE_ENV === 'test' ||
    isEnvTruthy(process.env.CLAUDE_CODE_USE_BEDROCK) ||
    isEnvTruthy(process.env.CLAUDE_CODE_USE_VERTEX) ||
    isEnvTruthy(process.env.CLAUDE_CODE_USE_FOUNDRY) ||
    isTelemetryDisabled()
  )
}

/**
 * Check if the feedback survey should be suppressed.
 *
 * Unlike isAnalyticsDisabled(), this does NOT block on 3P providers
 * (Bedrock/Vertex/Foundry). The survey is a local UI prompt with no
 * transcript data — enterprise customers capture responses via OTEL.
 *
 * Upstream 2.1.136: CLAUDE_CODE_ENABLE_FEEDBACK_SURVEY_FOR_OTEL=1
 * forces the survey on even when isTelemetryDisabled() returned true
 * because the user has only OTEL telemetry configured (no 1P analytics).
 * These enterprises capture survey responses through their OTLP pipeline
 * and lose visibility into product feedback when the survey is silently
 * suppressed by the default telemetry-disabled check.
 */
export function isFeedbackSurveyDisabled(): boolean {
  if (process.env.NODE_ENV === 'test') return true
  if (
    isTelemetryDisabled() &&
    process.env.CLAUDE_CODE_ENABLE_FEEDBACK_SURVEY_FOR_OTEL !== '1'
  ) {
    return true
  }
  return false
}
