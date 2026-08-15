import { describe, expect, test } from 'bun:test'

import { parsePluginObjectParameterValue } from '@open-pencil/plugin-contracts'
import { SceneGraph } from '@open-pencil/scene-graph'

import type { EditorStore } from '@/app/editor/active-store'
import {
  APPLICATION_SECURITY_READINESS_HOST_CONTRACT,
  APPLICATION_SECURITY_READINESS_LIMITS,
  APPLICATION_SECURITY_READINESS_RESULT,
  runApplicationSecurityReadiness
} from '@/app/plugins/host/application-security-readiness'

function editorFor(graph: SceneGraph): EditorStore {
  return { graph } as EditorStore
}

describe('application security readiness plugin', () => {
  test('renders the structured findings in the installed plugin settings panel', async () => {
    const [panel, report] = await Promise.all([
      Bun.file('src/components/settings/plugins/PluginsPanel.vue').text(),
      Bun.file('src/components/settings/plugins/ApplicationSecurityReadinessReport.vue').text()
    ])
    expect(panel).toContain('ApplicationSecurityReadinessReport')
    expect(panel).toContain('data-test-id="plugin-host-action-result"')
    expect(panel).toContain("scrollIntoView({ behavior: 'smooth', block: 'nearest' })")
    expect(report).toContain("data.kind !== 'application-security-readiness'")
    expect(report).toContain('finding.title')
    expect(report).toContain('finding.remediation')
    expect(report).toContain('report.notEvaluated')
  })

  test('returns a fixed bounded result that satisfies the manifest contract', async () => {
    const graph = new SceneGraph()

    const result = await runApplicationSecurityReadiness(editorFor(graph))
    const validated = parsePluginObjectParameterValue(
      result,
      APPLICATION_SECURITY_READINESS_RESULT.schema,
      APPLICATION_SECURITY_READINESS_RESULT.maxBytes,
      'Application security readiness result'
    )

    expect(validated).toEqual(result)
    expect(result.kind).toBe('application-security-readiness')
    expect(result.scope).toBe('document')
    expect(result.status).toBe('pass')
    expect(result.findings).toEqual([])
    expect(result.notEvaluated.some((entry) => entry.includes('not a complete'))).toBe(true)
    expect(APPLICATION_SECURITY_READINESS_HOST_CONTRACT.command.permissions).toEqual([
      'document.read'
    ])
    expect(APPLICATION_SECURITY_READINESS_HOST_CONTRACT.command.parameters.maxBytes).toBe(2)
  })

  test('reports only fixed finding text and never returns document content or secrets', async () => {
    const graph = new SceneGraph()
    const secret = 'sb_secret_DO_NOT_LEAK_71a4d821'
    const contentMarker = 'PRIVATE_DOCUMENT_MARKER_8de4e972'
    graph.updateNode(graph.rootId, {
      lowcodeSupabaseConfig: {
        url: `http://user:${contentMarker}@private.example.test`,
        anonKey: secret
      },
      lowcodeAnalyticsConfig: {
        provider: 'posthog',
        id: contentMarker,
        endpoint: `http://analytics.example.test/${contentMarker}`,
        enabled: true,
        consentRequired: false
      },
      lowcodeCustomCss: `.private { background: url(javascript:${contentMarker}); }`,
      lowcodeHeadMetadata: {
        link: [
          {
            rel: 'preload',
            href: `javascript:${contentMarker}`,
            crossorigin: 'use-credentials'
          }
        ],
        meta: [
          {
            kind: 'httpEquiv',
            key: 'refresh',
            content: `0; url=javascript:${contentMarker}`
          }
        ]
      }
    })
    const page = graph.getPages()[0]
    graph.createNode('BUTTON', page.id, {
      name: contentMarker,
      events: {
        click: [
          {
            id: 'unsafe-api',
            kind: 'apiCall',
            method: 'GET',
            url: `http://user:${contentMarker}@api.example.test/data`,
            targetName: 'result'
          }
        ]
      }
    })

    const result = await runApplicationSecurityReadiness(editorFor(graph))
    const serialized = JSON.stringify(result)
    const codes = new Set(result.findings.map((finding) => finding.code))

    expect(result.status).toBe('blocked')
    expect(codes).toContain('supabase-secret-key-embedded')
    expect(codes).toContain('insecure-client-endpoint')
    expect(codes).toContain('client-endpoint-credentials')
    expect(codes).toContain('insecure-analytics-endpoint')
    expect(codes).toContain('unsafe-custom-css-url')
    expect(codes).toContain('unsafe-head-link')
    expect(codes).toContain('unsafe-meta-refresh')
    expect(serialized).not.toContain(secret)
    expect(serialized).not.toContain(contentMarker)
    expect(serialized).not.toContain('private.example.test')
  })

  test('marks the report partial when the document exceeds its node budget', async () => {
    const graph = new SceneGraph()
    const page = graph.getPages()[0]
    for (let index = 0; index < APPLICATION_SECURITY_READINESS_LIMITS.nodes + 1; index += 1) {
      graph.createNode('RECTANGLE', page.id, { name: `Audit item ${index}` })
    }

    const result = await runApplicationSecurityReadiness(editorFor(graph))

    expect(result.truncated).toBe(true)
    expect(result.status).toBe('review')
    expect(result.summary.visitedNodeCount).toBe(APPLICATION_SECURITY_READINESS_LIMITS.nodes)
    expect(result.notEvaluated).toContain('content beyond the static audit resource limits')
  })

  test('cooperatively cancels without returning a partial report', async () => {
    const graph = new SceneGraph()
    const page = graph.getPages()[0]
    for (let index = 0; index < 512; index += 1) {
      graph.createNode('RECTANGLE', page.id, { name: `Cancellation item ${index}` })
    }
    const controller = new AbortController()
    setTimeout(() => controller.abort(), 0)

    const promise = runApplicationSecurityReadiness(editorFor(graph), {
      signal: controller.signal
    })

    await expect(promise).rejects.toMatchObject({ name: 'AbortError' })
  })
})
