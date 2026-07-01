import { describe, expect, test } from 'bun:test'

import { compile, withDefaults } from '@open-pencil/compiler'
import type { ActionDef, SceneGraph } from '@open-pencil/core/scene-graph'

import { firstPageId, makeSceneGraph } from '#tests/helpers/scene'

function compileAnalytics(graph: SceneGraph, pageId: string) {
  return compile({
    graph,
    pageIds: [pageId],
    options: withDefaults({ packageName: 'analytics-app' })
  })
}

function graphWithButton(onClick: ActionDef[]) {
  const graph = makeSceneGraph('Analytics')
  const pageId = firstPageId(graph)
  const btn = graph.createNode('BUTTON', pageId, { interactiveProps: { text: 'Track' } })
  btn.events = { onClick }
  return { graph, pageId }
}

describe('compile — analytics runtime wiring (Phase 5 §10)', () => {
  test('no analytics config or action keeps generated output free of analytics runtime', () => {
    const graph = makeSceneGraph('Analytics')
    const pageId = firstPageId(graph)
    const out = compileAnalytics(graph, pageId)

    expect(out.files.has('src/_lowcode_analytics.ts')).toBe(false)
    expect(out.files.get('src/main.tsx') as string).not.toContain('_lowcode_analytics')
    expect(out.files.get('src/App.tsx') as string).not.toContain('__opTrackEvent')
  })

  test('root lowcodeAnalyticsConfig emits a side-effect runtime import and page view', () => {
    const graph = makeSceneGraph('Analytics')
    const pageId = firstPageId(graph)
    graph.updateNode(graph.rootId, {
      lowcodeAnalyticsConfig: {
        provider: 'ga4',
        id: 'G-TEST123',
        respectDoNotTrack: true,
        consentRequired: true
      }
    })

    const out = compileAnalytics(graph, pageId)
    const main = out.files.get('src/main.tsx') as string
    const runtime = out.files.get('src/_lowcode_analytics.ts') as string

    expect(main).toContain("import { LowcodeAnalyticsConsentBanner } from './_lowcode_analytics'")
    expect(main).toContain('<LowcodeAnalyticsConsentBanner />')
    expect(runtime).toContain('"provider": "ga4"')
    expect(runtime).toContain('"id": "G-TEST123"')
    expect(runtime).toContain('"respectDoNotTrack": true')
    expect(runtime).toContain('"consentRequired": true')
    expect(runtime).toContain('function hasDoNotTrack()')
    expect(runtime).toContain('export function __opGrantAnalyticsConsent()')
    expect(runtime).toContain('export function LowcodeAnalyticsConsentBanner()')
    expect(runtime).toContain('__openpencil_analytics_consent:${config.provider}:${config.id}')
    expect(runtime).toContain("writeConsentPreference('granted')")
    expect(runtime).toContain("writeConsentPreference('denied')")
    expect(runtime).toContain('Analytics preferences')
    expect(runtime).toContain('Necessary')
    expect(runtime).toContain('Analytics')
    expect(runtime).toContain('Save preferences')
    expect(runtime).toContain('Accept all')
    expect(runtime).toContain('Decline all')
    expect(runtime).toContain(
      'This app uses analytics to understand usage. You can choose which optional tracking is allowed.'
    )
    expect(runtime).toContain(
      'if (config.respectDoNotTrack === true && hasDoNotTrack()) return false'
    )
    expect(runtime).toContain('if (effectiveConsentRequired() && !consentGranted) return false')
    expect(runtime).toContain("gtag('config', config.id)")
    expect(runtime).toContain('if (config?.pageViews !== false) __opTrackPageView()')
  })

  test('trackEvent action imports helper and emits dynamic event properties', () => {
    const { graph, pageId } = graphWithButton([
      {
        id: 'track',
        kind: 'trackEvent',
        eventNameExpr: '"cta_click"',
        properties: {
          label: '"Hero CTA"',
          value: '42'
        }
      }
    ])
    graph.updateNode(graph.rootId, {
      lowcodeAnalyticsConfig: {
        provider: 'plausible',
        id: 'example.com'
      }
    })

    const out = compileAnalytics(graph, pageId)
    const app = out.files.get('src/App.tsx') as string
    const main = out.files.get('src/main.tsx') as string
    const runtime = out.files.get('src/_lowcode_analytics.ts') as string

    expect(app).toContain("import { __opTrackEvent } from './_lowcode_analytics'")
    expect(app).toContain('__opTrackEvent("cta_click", { "label": "Hero CTA", "value": 42 })')
    expect(main).toContain("import './_lowcode_analytics'")
    expect(main).not.toContain('LowcodeAnalyticsConsentBanner')
    expect(runtime).toContain('"provider": "plausible"')
    expect(runtime).toContain('https://plausible.io/js/script.js')
    expect(runtime).not.toContain('LowcodeAnalyticsConsentBanner')
  })

  test('trackEvent can be authored before provider config and uses a no-op runtime', () => {
    const { graph, pageId } = graphWithButton([
      {
        id: 'track',
        kind: 'trackEvent',
        eventNameExpr: '"early_event"'
      }
    ])

    const out = compileAnalytics(graph, pageId)
    const app = out.files.get('src/App.tsx') as string
    const main = out.files.get('src/main.tsx') as string
    const runtime = out.files.get('src/_lowcode_analytics.ts') as string

    expect(app).toContain("import { __opTrackEvent } from './_lowcode_analytics'")
    expect(app).toContain('__opTrackEvent("early_event")')
    expect(main).toContain("import './_lowcode_analytics'")
    expect(runtime).toContain('const config = null as AnalyticsConfig | null')
    expect(runtime).toContain('if (!config || typeof window ===')
  })

  test('multi-page analytics config emits a route-change page view tracker', () => {
    const graph = makeSceneGraph('Analytics')
    const home = graph.getPages()[0]
    const about = graph.addPage('About')
    graph.updateNode(graph.rootId, {
      lowcodeAnalyticsConfig: {
        provider: 'ga4',
        id: 'G-TEST123'
      }
    })

    const out = compile({
      graph,
      pageIds: [home.id, about.id],
      options: withDefaults({ packageName: 'analytics-app' })
    })
    const app = out.files.get('src/App.tsx') as string
    const runtime = out.files.get('src/_lowcode_analytics.ts') as string

    expect(app).toContain("import { LowcodeAnalyticsRouteTracker } from './_lowcode_analytics'")
    expect(app).toContain('<LowcodeAnalyticsRouteTracker />')
    expect(runtime).toContain("import { useLocation } from 'react-router-dom'")
    expect(runtime).toContain('export function LowcodeAnalyticsRouteTracker(): null')
    expect(runtime).toContain(
      '__opTrackPageView(location.pathname + location.search + location.hash)'
    )
  })

  test('pageViews false disables automatic page view tracking but keeps explicit events', () => {
    const { graph, pageId } = graphWithButton([
      {
        id: 'track',
        kind: 'trackEvent',
        eventNameExpr: '"manual_event"'
      }
    ])
    const about = graph.addPage('About')
    graph.updateNode(graph.rootId, {
      lowcodeAnalyticsConfig: {
        provider: 'posthog',
        id: 'phc_test',
        pageViews: false
      }
    })

    const out = compile({
      graph,
      pageIds: [pageId, about.id],
      options: withDefaults({ packageName: 'analytics-app' })
    })
    const app = out.files.get('src/App.tsx') as string
    const pageModule = [...out.files.entries()].find(
      ([path, contents]) =>
        path.startsWith('src/pages/') &&
        typeof contents === 'string' &&
        contents.includes('__opTrackEvent("manual_event")')
    )?.[1] as string | undefined
    const runtime = out.files.get('src/_lowcode_analytics.ts') as string

    expect(app).not.toContain('LowcodeAnalyticsRouteTracker')
    expect(pageModule).toContain("import { __opTrackEvent } from '../_lowcode_analytics'")
    expect(pageModule).toContain('__opTrackEvent("manual_event")')
    expect(runtime).toContain('"pageViews": false')
    expect(runtime).toContain('if (config?.pageViews !== false) __opTrackPageView()')
  })

  test('consentRequired emits branded consent copy as plain runtime data', () => {
    const graph = makeSceneGraph('Analytics')
    const pageId = firstPageId(graph)
    graph.updateNode(graph.rootId, {
      lowcodeAnalyticsConfig: {
        provider: 'plausible',
        id: 'example.com',
        consentRequired: true,
        consentAnalyticsDefault: false,
        consentCopy: {
          bannerText: 'Acme uses analytics to improve onboarding.',
          analyticsDescription: 'Optional product analytics for page views and button clicks.',
          privacyPolicyUrl: '/privacy',
          privacyPolicyLabel: 'Privacy notice'
        }
      }
    })

    const out = compileAnalytics(graph, pageId)
    const runtime = out.files.get('src/_lowcode_analytics.ts') as string

    expect(runtime).toContain('"consentCopy": {')
    expect(runtime).toContain('"consentAnalyticsDefault": false')
    expect(runtime).toContain('"bannerText": "Acme uses analytics to improve onboarding."')
    expect(runtime).toContain(
      '"analyticsDescription": "Optional product analytics for page views and button clicks."'
    )
    expect(runtime).toContain('"privacyPolicyUrl": "/privacy"')
    expect(runtime).toContain('"privacyPolicyLabel": "Privacy notice"')
    expect(runtime).toContain('const bannerText = copy?.bannerText ??')
    expect(runtime).toContain(
      'if (config?.consentAnalyticsDefault !== undefined) return config.consentAnalyticsDefault'
    )
    expect(runtime).toContain('return true')
    expect(runtime).toContain('href: copy.privacyPolicyUrl')
    expect(runtime).toContain('privacyPolicyLabel')
  })

  test('EEA consent preset enables an opt-in banner without explicit consentRequired', () => {
    const graph = makeSceneGraph('Analytics')
    const pageId = firstPageId(graph)
    graph.updateNode(graph.rootId, {
      lowcodeAnalyticsConfig: {
        provider: 'ga4',
        id: 'G-TEST123',
        consentRegionPreset: 'eea'
      }
    })

    const out = compileAnalytics(graph, pageId)
    const main = out.files.get('src/main.tsx') as string
    const runtime = out.files.get('src/_lowcode_analytics.ts') as string

    expect(main).toContain("import { LowcodeAnalyticsConsentBanner } from './_lowcode_analytics'")
    expect(main).toContain('<LowcodeAnalyticsConsentBanner />')
    expect(runtime).toContain('"consentRegionPreset": "eea"')
    expect(runtime).not.toContain('"consentRequired": true')
    expect(runtime).toContain("return config?.consentRegionPreset === 'eea'")
    expect(runtime).toContain(
      'if (config?.consentAnalyticsDefault !== undefined) return config.consentAnalyticsDefault'
    )
    expect(runtime).toContain("if (config?.consentRegionPreset === 'eea') return false")
    expect(runtime).toContain('if (effectiveConsentRequired() && !consentGranted) return false')
  })

  test('explicit consent settings override the EEA consent preset', () => {
    const graph = makeSceneGraph('Analytics')
    const pageId = firstPageId(graph)
    graph.updateNode(graph.rootId, {
      lowcodeAnalyticsConfig: {
        provider: 'plausible',
        id: 'example.com',
        consentRegionPreset: 'eea',
        consentRequired: false,
        consentAnalyticsDefault: true
      }
    })

    const out = compileAnalytics(graph, pageId)
    const main = out.files.get('src/main.tsx') as string
    const runtime = out.files.get('src/_lowcode_analytics.ts') as string

    expect(main).toContain("import './_lowcode_analytics'")
    expect(main).not.toContain('LowcodeAnalyticsConsentBanner')
    expect(runtime).toContain('"consentRegionPreset": "eea"')
    expect(runtime).toContain('"consentRequired": false')
    expect(runtime).toContain('"consentAnalyticsDefault": true')
    expect(runtime).not.toContain('export function LowcodeAnalyticsConsentBanner()')
  })
})
