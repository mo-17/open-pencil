import type { AnalyticsConfig } from '#core/scene-graph'

import type { ValidationResult } from './validate'

const ANALYTICS_PROVIDERS = new Set(['ga4', 'plausible', 'posthog'])
const ANALYTICS_CONSENT_REGION_PRESETS = new Set(['eea'])

export function validateAnalyticsConfig(config: AnalyticsConfig): ValidationResult {
  if (!ANALYTICS_PROVIDERS.has(config.provider)) {
    return { ok: false, reason: 'provider must be one of ga4 / plausible / posthog' }
  }
  if (config.id.trim() === '') return { ok: false, reason: 'id is required' }
  if (config.endpoint && !isHttpUrl(config.endpoint)) {
    return { ok: false, reason: 'endpoint must be http(s)' }
  }
  if (
    config.consentRegionPreset !== undefined &&
    !ANALYTICS_CONSENT_REGION_PRESETS.has(config.consentRegionPreset)
  ) {
    return { ok: false, reason: 'consentRegionPreset must be one of eea' }
  }
  const policyUrl = config.consentCopy?.privacyPolicyUrl?.trim()
  if (policyUrl && !isSafeAnalyticsPolicyUrl(policyUrl)) {
    return { ok: false, reason: 'consentCopy.privacyPolicyUrl must be http(s) or root-relative' }
  }
  return { ok: true }
}

export function isSafeAnalyticsPolicyUrl(value: string): boolean {
  if (value.startsWith('/')) return !value.startsWith('//')
  return isHttpUrl(value)
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}
