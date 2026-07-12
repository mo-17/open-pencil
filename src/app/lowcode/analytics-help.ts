import type { AnalyticsProvider } from '@open-pencil/scene-graph'

export interface AnalyticsProviderHelp {
  idLabel: string
  idHint: string
  endpointHint: string
  docsHref: string
}

const PROVIDER_HELP: Record<AnalyticsProvider, AnalyticsProviderHelp> = {
  ga4: {
    idLabel: 'Measurement ID',
    idHint: 'Use a GA4 web stream measurement id such as G-XXXXXXXXXX.',
    endpointHint: 'GA4 loads from Google Tag Manager; custom endpoints are not used.',
    docsHref: 'https://support.google.com/analytics/answer/9539598'
  },
  plausible: {
    idLabel: 'Domain',
    idHint: 'Use the Plausible site domain, for example example.com.',
    endpointHint: 'Leave blank for plausible.io, or paste a self-hosted script URL.',
    docsHref: 'https://plausible.io/docs/plausible-script'
  },
  posthog: {
    idLabel: 'Project API key',
    idHint: 'Use the public PostHog project API key, usually starting with phc_.',
    endpointHint: 'Leave blank for app.posthog.com, or use your regional/self-hosted host.',
    docsHref: 'https://posthog.com/docs/libraries/js'
  }
}

export const ANALYTICS_TRACK_EVENT_CONFIG_HINT =
  'Configure Analytics in Services & Workflows before publishing. Track event stays editable, but generated apps no-op until a provider id is set.'

export function analyticsProviderHelp(provider: AnalyticsProvider): AnalyticsProviderHelp {
  return PROVIDER_HELP[provider]
}
