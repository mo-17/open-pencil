import type { IRAnalyticsConfig } from '#compiler/ir/types'

export function buildLowcodeAnalyticsRuntime(
  config: IRAnalyticsConfig | undefined,
  routeTracking = false,
  consentBanner = false
): string {
  const encoded = JSON.stringify(config ?? null, null, 2)
  const reactImports = [
    ...(consentBanner ? ['createElement', 'useState'] : []),
    ...(routeTracking ? ['useEffect', 'useRef'] : [])
  ]
  const imports =
    reactImports.length > 0
      ? `import { ${reactImports.join(', ')} } from 'react'\n${
          routeTracking ? "import { useLocation } from 'react-router-dom'\n" : ''
        }\n`
      : ''
  const routeTracker = routeTracking
    ? `
export function LowcodeAnalyticsRouteTracker(): null {
  const location = useLocation()
  const didMount = useRef(false)
  useEffect(() => {
    if (!didMount.current) {
      didMount.current = true
      return
    }
    __opTrackPageView(location.pathname + location.search + location.hash)
  }, [location.pathname, location.search, location.hash])
  return null
}
`
    : ''
  const consentComponent = consentBanner
    ? `
export function LowcodeAnalyticsConsentBanner(): ReturnType<typeof createElement> | null {
  const [visible, setVisible] = useState(() => effectiveConsentRequired() && readConsentPreference() === null)
  const [analyticsEnabled, setAnalyticsEnabled] = useState(() => {
    const preference = readConsentPreference()
    if (preference === 'granted') return true
    if (preference === 'denied') return false
    if (config?.consentAnalyticsDefault !== undefined) return config.consentAnalyticsDefault
    if (config?.consentRegionPreset === 'eea') return false
    return true
  })
  const copy = config?.consentCopy
  const bannerText = copy?.bannerText ?? 'This app uses analytics to understand usage. You can choose which optional tracking is allowed.'
  const analyticsDescription = copy?.analyticsDescription ?? 'Helps the team understand page views and explicit tracked events.'
  const privacyPolicyLabel = copy?.privacyPolicyLabel ?? 'Privacy policy'
  if (!effectiveConsentRequired()) return null
  if (!visible) {
    return createElement(
      'button',
      {
        type: 'button',
        onClick: () => setVisible(true),
        style: {
          position: 'fixed',
          right: '1rem',
          bottom: '1rem',
          zIndex: 2147483646,
          border: '1px solid color-mix(in srgb, CanvasText 14%, transparent)',
          borderRadius: '999px',
          background: 'Canvas',
          color: 'CanvasText',
          boxShadow: '0 10px 32px color-mix(in srgb, CanvasText 14%, transparent)',
          padding: '0.5rem 0.75rem',
          font: '12px/1.4 system-ui, sans-serif',
          cursor: 'pointer'
        }
      },
      'Analytics preferences'
    )
  }
  const accept = (): void => {
    setAnalyticsEnabled(true)
    __opGrantAnalyticsConsent()
    setVisible(false)
  }
  const decline = (): void => {
    setAnalyticsEnabled(false)
    __opRevokeAnalyticsConsent()
    setVisible(false)
  }
  const save = (): void => {
    if (analyticsEnabled) __opGrantAnalyticsConsent()
    else __opRevokeAnalyticsConsent()
    setVisible(false)
  }
  const toggleAnalytics = (): void => setAnalyticsEnabled((value) => !value)
  return createElement(
    'section',
    {
      role: 'region',
      'aria-label': 'Analytics consent',
      style: {
        position: 'fixed',
        left: '1rem',
        right: '1rem',
        bottom: '1rem',
        zIndex: 2147483647,
        margin: '0 auto',
        maxWidth: '40rem',
        border: '1px solid color-mix(in srgb, CanvasText 14%, transparent)',
        borderRadius: '0.75rem',
        background: 'Canvas',
        color: 'CanvasText',
        boxShadow: '0 18px 48px color-mix(in srgb, CanvasText 16%, transparent)',
        padding: '1rem',
        font: '14px/1.5 system-ui, sans-serif'
      }
    },
    createElement(
      'div',
      { style: { display: 'grid', gap: '0.875rem' } },
      createElement(
        'p',
        { style: { margin: 0 } },
        bannerText
      ),
      copy?.privacyPolicyUrl
        ? createElement(
            'a',
            {
              href: copy.privacyPolicyUrl,
              target: '_blank',
              rel: 'noopener noreferrer',
              style: {
                color: '#2563eb',
                fontSize: '12px',
                textDecoration: 'underline'
              }
            },
            privacyPolicyLabel
          )
        : null,
      createElement(
        'div',
        { style: { display: 'grid', gap: '0.625rem' } },
        createElement(
          'label',
          {
            style: {
              display: 'flex',
              alignItems: 'flex-start',
              justifyContent: 'space-between',
              gap: '0.75rem',
              border: '1px solid color-mix(in srgb, CanvasText 12%, transparent)',
              borderRadius: '0.625rem',
              padding: '0.75rem'
            }
          },
          createElement(
            'span',
            null,
            createElement('strong', { style: { display: 'block' } }, 'Necessary'),
            createElement(
              'span',
              { style: { display: 'block', opacity: 0.72, fontSize: '12px' } },
              'Required for this app to run. Always active.'
            )
          ),
          createElement('input', { type: 'checkbox', checked: true, disabled: true })
        ),
        createElement(
          'label',
          {
            style: {
              display: 'flex',
              alignItems: 'flex-start',
              justifyContent: 'space-between',
              gap: '0.75rem',
              border: '1px solid color-mix(in srgb, CanvasText 12%, transparent)',
              borderRadius: '0.625rem',
              padding: '0.75rem'
            }
          },
          createElement(
            'span',
            null,
            createElement('strong', { style: { display: 'block' } }, 'Analytics'),
            createElement(
              'span',
              { style: { display: 'block', opacity: 0.72, fontSize: '12px' } },
              analyticsDescription
            )
          ),
          createElement('input', {
            type: 'checkbox',
            checked: analyticsEnabled,
            onChange: toggleAnalytics
          })
        )
      ),
      createElement(
        'div',
        { style: { display: 'flex', gap: '0.5rem', flexWrap: 'wrap', justifyContent: 'flex-end' } },
        createElement(
          'button',
          {
            type: 'button',
            onClick: decline,
            style: {
              border: '1px solid color-mix(in srgb, CanvasText 16%, transparent)',
              borderRadius: '0.5rem',
              background: 'transparent',
              color: 'inherit',
              padding: '0.5rem 0.75rem',
              cursor: 'pointer'
            }
          },
          'Decline all'
        ),
        createElement(
          'button',
          {
            type: 'button',
            onClick: save,
            style: {
              border: '1px solid color-mix(in srgb, CanvasText 16%, transparent)',
              borderRadius: '0.5rem',
              background: 'transparent',
              color: 'inherit',
              padding: '0.5rem 0.75rem',
              cursor: 'pointer'
            }
          },
          'Save preferences'
        ),
        createElement(
          'button',
          {
            type: 'button',
            onClick: accept,
            style: {
              border: '1px solid transparent',
              borderRadius: '0.5rem',
              background: '#2563eb',
              color: '#fff',
              padding: '0.5rem 0.75rem',
              cursor: 'pointer'
            }
          },
          'Accept all'
        )
      )
    )
  )
}
`
    : ''
  return `${imports}type AnalyticsConfig =
  | { provider: 'ga4'; id: string; endpoint?: string; pageViews?: boolean; respectDoNotTrack?: boolean; consentRequired?: boolean; consentRegionPreset?: 'eea'; consentAnalyticsDefault?: boolean; consentCopy?: AnalyticsConsentCopy }
  | { provider: 'plausible'; id: string; endpoint?: string; pageViews?: boolean; respectDoNotTrack?: boolean; consentRequired?: boolean; consentRegionPreset?: 'eea'; consentAnalyticsDefault?: boolean; consentCopy?: AnalyticsConsentCopy }
  | { provider: 'posthog'; id: string; endpoint?: string; pageViews?: boolean; respectDoNotTrack?: boolean; consentRequired?: boolean; consentRegionPreset?: 'eea'; consentAnalyticsDefault?: boolean; consentCopy?: AnalyticsConsentCopy }
type AnalyticsConsentCopy = {
  bannerText?: string
  analyticsDescription?: string
  privacyPolicyUrl?: string
  privacyPolicyLabel?: string
}

const config = ${encoded} as AnalyticsConfig | null
let ready = false
type ConsentPreference = 'granted' | 'denied'
const consentStorageKey = config ? \`__openpencil_analytics_consent:\${config.provider}:\${config.id}\` : ''
let consentGranted = !effectiveConsentRequired() || readConsentPreference() === 'granted'

function effectiveConsentRequired(): boolean {
  if (config?.consentRequired !== undefined) return config.consentRequired
  return config?.consentRegionPreset === 'eea'
}

function readConsentPreference(): ConsentPreference | null {
  if (!consentStorageKey || typeof window === 'undefined') return null
  try {
    const value = window.localStorage.getItem(consentStorageKey)
    return value === 'granted' || value === 'denied' ? value : null
  } catch {
    return null
  }
}

function writeConsentPreference(value: ConsentPreference): void {
  if (!consentStorageKey || typeof window === 'undefined') return
  try {
    window.localStorage.setItem(consentStorageKey, value)
  } catch {
    // Storage can be disabled; runtime consent still works for this page load.
  }
}

function hasDoNotTrack(): boolean {
  if (typeof navigator === 'undefined') return false
  const n = navigator as Navigator & { msDoNotTrack?: string }
  const w = typeof window === 'undefined' ? undefined : (window as typeof window & { doNotTrack?: string })
  return n.doNotTrack === '1' || n.msDoNotTrack === '1' || w?.doNotTrack === '1'
}

function canTrack(): boolean {
  if (!config || typeof window === 'undefined') return false
  if (config.respectDoNotTrack === true && hasDoNotTrack()) return false
  if (effectiveConsentRequired() && !consentGranted) return false
  return true
}

function loadScript(src: string, attrs: Record<string, string> = {}): void {
  if (typeof document === 'undefined') return
  if (document.querySelector(\`script[data-op-analytics="true"][src="\${src}"]\`)) return
  const script = document.createElement('script')
  script.async = true
  script.src = src
  script.dataset.opAnalytics = 'true'
  for (const [key, value] of Object.entries(attrs)) script.setAttribute(key, value)
  document.head.appendChild(script)
}

function setup(): void {
  if (ready || !canTrack()) return
  ready = true
  if (config.provider === 'ga4') {
    loadScript(\`https://www.googletagmanager.com/gtag/js?id=\${encodeURIComponent(config.id)}\`)
    const w = window as typeof window & { dataLayer?: unknown[]; gtag?: (...args: unknown[]) => void }
    w.dataLayer = w.dataLayer ?? []
    w.gtag = (...args: unknown[]) => {
      w.dataLayer?.push(args)
    }
    w.gtag('js', new Date())
    w.gtag('config', config.id)
    return
  }
  if (config.provider === 'plausible') {
    const w = window as typeof window & {
      plausible?: ((event: string, opts?: { props?: Record<string, unknown> }) => void) & {
        q?: unknown[]
      }
    }
    w.plausible =
      w.plausible ??
      ((...args: unknown[]) => {
        w.plausible!.q = w.plausible!.q ?? []
        w.plausible!.q.push(args)
      })
    loadScript(config.endpoint ?? 'https://plausible.io/js/script.js', { 'data-domain': config.id })
    return
  }
  const w = window as typeof window & {
    posthog?: unknown[] & {
      capture?: (event: string, props?: Record<string, unknown>) => void
      init?: (key: string, opts: Record<string, string>) => void
    }
  }
  w.posthog = w.posthog ?? []
  loadScript(\`\${config.endpoint ?? 'https://app.posthog.com'}/static/array.js\`)
  w.posthog.init?.(config.id, { api_host: config.endpoint ?? 'https://app.posthog.com' }) ??
    w.posthog.push?.(['init', config.id, { api_host: config.endpoint ?? 'https://app.posthog.com' }])
}

setup()

export function __opGrantAnalyticsConsent(): void {
  consentGranted = true
  writeConsentPreference('granted')
  setup()
}

export function __opRevokeAnalyticsConsent(): void {
  consentGranted = false
  writeConsentPreference('denied')
}

export function __opTrackEvent(event: unknown, properties?: Record<string, unknown>): void {
  setup()
  if (!canTrack()) return
  const name = String(event ?? '').trim()
  if (!name) return
  if (config.provider === 'ga4') {
    ;(window as typeof window & { gtag?: (...args: unknown[]) => void }).gtag?.('event', name, properties ?? {})
    return
  }
  if (config.provider === 'plausible') {
    ;(window as typeof window & { plausible?: (event: string, opts?: { props?: Record<string, unknown> }) => void }).plausible?.(name, properties ? { props: properties } : undefined)
    return
  }
  ;(window as typeof window & { posthog?: { capture?: (event: string, props?: Record<string, unknown>) => void } }).posthog?.capture?.(name, properties)
}

export function __opTrackPageView(path?: string): void {
  if (!canTrack() || config?.pageViews === false) return
  const currentPath = path ?? window.location.pathname + window.location.search + window.location.hash
  __opTrackEvent('page_view', { path: currentPath, url: window.location.href })
}

if (config?.pageViews !== false) __opTrackPageView()
${routeTracker}
${consentComponent}
`
}
