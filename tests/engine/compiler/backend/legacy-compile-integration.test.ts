import { describe, expect, test } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'

import {
  BackendProviderCompilationError,
  compile,
  withDefaults,
  type CompilerBackendProviderRequest,
  type CompilerOutput
} from '@open-pencil/compiler'
import {
  BACKEND_ARTIFACT_MANIFEST_PATH,
  SUPABASE_BACKEND_PROVIDER_COMPILER_BUNDLE_DIGEST,
  SUPABASE_BACKEND_PROVIDER_DESCRIPTOR,
  type BackendArtifactManifestV1
} from '@open-pencil/compiler/backend'
import { buildPreviewProject } from '@open-pencil/compiler/build'
import type { BackendApplicationSpecV1 } from '@open-pencil/lowcode/backend'
import { SceneGraph, type ServerWorkflowDef } from '@open-pencil/scene-graph'

const LEGACY_ANON_VALUE = 'legacy-public-anon-value'
const LEGACY_SERVER_WORKFLOW: ServerWorkflowDef = {
  id: 'health-check',
  name: 'Health check',
  trigger: { kind: 'http', method: 'POST', auth: 'supabase-user' },
  params: [],
  actions: [{ id: 'return', kind: 'return', valueExpr: 'true', status: 200 }]
}
const EXECUTABLE_SERVER_WORKFLOW_PATHS = [
  '.env.server.example',
  'openpencil-server.manifest.json',
  'SERVER_DEPLOYMENT.md',
  'supabase/functions/openpencil-runtime/index.ts'
].sort((left, right) => left.localeCompare(right, 'en'))

function legacyGraph(): { graph: SceneGraph; pageId: string } {
  const graph = new SceneGraph()
  const pageId = graph.getPages()[0].id
  graph.updateNode(graph.rootId, {
    lowcodeSupabaseConfig: {
      url: 'https://example.supabase.co',
      anonKey: LEGACY_ANON_VALUE,
      schema: 'public'
    },
    lowcodeServerWorkflows: [LEGACY_SERVER_WORKFLOW]
  })
  graph.createNode('BUTTON', pageId, {
    name: 'Load notes',
    events: {
      onClick: [
        {
          id: 'load-notes',
          kind: 'supabaseQuery',
          operation: 'select',
          table: 'notes',
          columns: ['id'],
          resultName: 'notes'
        }
      ]
    }
  })
  return { graph, pageId }
}

function compileLegacyGraph(source = legacyGraph()): CompilerOutput {
  const { graph, pageId } = source
  return compile({
    graph,
    pageIds: [pageId],
    options: withDefaults({ devMode: false })
  })
}

function explicitBackendApplication(): BackendApplicationSpecV1 {
  return {
    format: 'openpencil.backend-application',
    version: 1,
    applicationId: 'explicit-provider-compile',
    dataModel: { version: 1, entities: [], enums: [], relations: [] },
    auth: {
      version: 1,
      identities: [],
      roles: [],
      ownership: [],
      tenants: [],
      rowAccess: []
    },
    workflows: { version: 1, workflows: [] },
    capabilities: [
      { capability: 'data.read', required: true },
      { capability: 'policy.row-level', required: true }
    ],
    secrets: []
  }
}

function explicitBackendRequest(
  overrides: Partial<CompilerBackendProviderRequest['selection']> = {}
): CompilerBackendProviderRequest {
  return {
    selection: {
      descriptor: SUPABASE_BACKEND_PROVIDER_DESCRIPTOR,
      packageDigest: SUPABASE_BACKEND_PROVIDER_COMPILER_BUNDLE_DIGEST,
      enabled: true,
      ...overrides
    },
    application: explicitBackendApplication()
  }
}

function explicitGraph(): { graph: SceneGraph; pageId: string } {
  const graph = new SceneGraph()
  return { graph, pageId: graph.getPages()[0].id }
}

function backendEntries(output: CompilerOutput): [string, string | Uint8Array][] {
  return [...output.files]
    .filter(([path]) => path.startsWith('backend/') || path === BACKEND_ARTIFACT_MANIFEST_PATH)
    .sort(([left], [right]) => left.localeCompare(right, 'en'))
}

function textFile(output: CompilerOutput, path: string): string {
  const content = output.files.get(path)
  if (typeof content !== 'string') throw new TypeError(`Expected text compiler file: ${path}`)
  return content
}

describe('legacy Backend Provider compile integration', () => {
  test('fails Vue production instead of silently shipping omitted runtime behavior', () => {
    const { graph, pageId } = legacyGraph()
    let failure: unknown
    try {
      compile({
        graph,
        pageIds: [pageId],
        options: withDefaults({ target: 'vue', devMode: false })
      })
    } catch (error) {
      failure = error
    }
    expect(failure).toBeInstanceOf(BackendProviderCompilationError)
    expect(failure).toMatchObject({
      diagnostics: expect.arrayContaining([
        expect.objectContaining({
          code: 'backend-capability-source-only-mode-required',
          severity: 'error'
        })
      ])
    })
  })

  test('allows only an explicit Vue source-only prototype omission', () => {
    const { graph, pageId } = legacyGraph()
    const output = compile({
      graph,
      pageIds: [pageId],
      options: withDefaults({
        target: 'vue',
        devMode: false,
        backendCompilationMode: 'source-only-prototype'
      })
    })
    expect(output.files.has('src/main.ts')).toBe(true)
    expect(output.warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'backend-capability-source-only-omitted' })
      ])
    )
  })

  test('preserves the React client while emitting external-only, deny-default review artifacts', () => {
    const output = compileLegacyGraph()
    const entries = backendEntries(output)
    const paths = entries.map(([path]) => path)

    expect(textFile(output, 'src/_lowcode_supabase.ts')).toContain(LEGACY_ANON_VALUE)
    expect(paths).toContain(BACKEND_ARTIFACT_MANIFEST_PATH)
    expect(paths).toContain('backend/supabase/database-schema.json')
    expect(paths).toContain('backend/supabase/rls-policy.json')
    expect(output.artifactOwnership?.backendReviewFiles).toEqual(paths)
    expect(output.artifactOwnership?.executableServerWorkflowFiles).toEqual(
      EXECUTABLE_SERVER_WORKFLOW_PATHS
    )
    expect(
      output.artifactOwnership?.backendReviewFiles.some((path) =>
        output.artifactOwnership?.executableServerWorkflowFiles.includes(path)
      )
    ).toBe(false)
    expect(output.artifactOwnership?.backendReviewFiles).not.toContain('src/_lowcode_supabase.ts')
    expect(output.artifactOwnership?.executableServerWorkflowFiles).not.toContain(
      'src/_lowcode_server.ts'
    )

    const manifest = JSON.parse(
      textFile(output, BACKEND_ARTIFACT_MANIFEST_PATH)
    ) as BackendArtifactManifestV1
    expect(manifest.authority.packageDigest).toBe(SUPABASE_BACKEND_PROVIDER_COMPILER_BUNDLE_DIGEST)
    expect(manifest.authority.packageDigest.startsWith('sha256:')).toBe(true)
    expect(manifest.authority.providerId).toBe('supabase')
    expect(manifest.artifacts.map((entry) => entry.path)).toEqual(
      paths.filter((path) => path !== BACKEND_ARTIFACT_MANIFEST_PATH)
    )
    expect(manifest.requiredSecrets.map((entry) => entry.name)).toEqual([
      'BACKEND_PUBLIC_KEY',
      'BACKEND_PUBLIC_URL'
    ])

    const schema = textFile(output, 'backend/supabase/database-schema.json')
    expect(schema).toContain('"management": "external"')
    expect(schema).not.toContain('"management": "managed"')
    const policy = textFile(output, 'backend/supabase/rls-policy.json')
    expect(policy).toContain('"effect": "deny"')
    expect(policy).not.toContain('"effect": "allow"')
    expect(policy).toContain('"status": "blocked-review"')

    for (const [, content] of entries) {
      const text = typeof content === 'string' ? content : new TextDecoder().decode(content)
      expect(text).not.toContain(LEGACY_ANON_VALUE)
      expect(text.toLowerCase()).not.toContain('service_role')
    }
    expect(output.warnings.map((entry) => entry.code)).toContain(
      'legacy-backend-auth-intent-required'
    )
  })

  test('keeps backend bytes and every recorded artifact digest deterministic', () => {
    const source = legacyGraph()
    const first = compileLegacyGraph(source)
    const second = compileLegacyGraph(source)
    expect(backendEntries(second)).toEqual(backendEntries(first))

    const firstManifest = JSON.parse(
      textFile(first, BACKEND_ARTIFACT_MANIFEST_PATH)
    ) as BackendArtifactManifestV1
    const secondManifest = JSON.parse(
      textFile(second, BACKEND_ARTIFACT_MANIFEST_PATH)
    ) as BackendArtifactManifestV1
    expect(secondManifest.applicationDigest).toBe(firstManifest.applicationDigest)
    expect(secondManifest.planDigest).toBe(firstManifest.planDigest)
    expect(secondManifest.artifacts.map((entry) => entry.digest)).toEqual(
      firstManifest.artifacts.map((entry) => entry.digest)
    )
  })

  test('keeps Provider artifacts out of the frontend static upload boundary', async () => {
    const output = compileLegacyGraph()
    const temporary = mkdtempSync(join(tmpdir(), 'openpencil-backend-compile-'))
    const outDir = join(temporary, 'dist')
    try {
      const result = await buildPreviewProject({
        files: output.files,
        artifactOwnership: output.artifactOwnership,
        outDir,
        fsRoot: process.cwd(),
        target: 'react'
      })
      expect(result.staticFiles).toContain('index.html')
      expect(result.staticFiles.every((path) => !path.startsWith('openpencil-server/'))).toBe(true)
      expect(result.serverFiles).toContain(
        'openpencil-server/backend/supabase/database-schema.json'
      )
      expect(result.serverFiles).toContain(`openpencil-server/${BACKEND_ARTIFACT_MANIFEST_PATH}`)
      expect(result.backendReviewFiles).toEqual(
        output.artifactOwnership?.backendReviewFiles.map((path) => `openpencil-server/${path}`)
      )
      expect(result.executableServerWorkflowFiles).toEqual(
        EXECUTABLE_SERVER_WORKFLOW_PATHS.map((path) => `openpencil-server/${path}`).sort()
      )
      expect(result.executableServerWorkflowFiles).toContain(
        'openpencil-server/supabase/functions/openpencil-runtime/index.ts'
      )
      expect(result.backendReviewFiles).not.toContain(
        'openpencil-server/supabase/functions/openpencil-runtime/index.ts'
      )
      const copiedManifest = readFileSync(
        join(outDir, 'openpencil-server', BACKEND_ARTIFACT_MANIFEST_PATH),
        'utf8'
      )
      expect(copiedManifest).toBe(textFile(output, BACKEND_ARTIFACT_MANIFEST_PATH))
      expect(copiedManifest).not.toContain(LEGACY_ANON_VALUE)
    } finally {
      rmSync(temporary, { recursive: true, force: true })
    }
  })
})

describe('explicit Backend Provider compile integration', () => {
  test('plans, emits, and builds a Host-resolved request deterministically through public APIs', async () => {
    const { graph, pageId } = explicitGraph()
    const options = withDefaults({
      devMode: false,
      backendProvider: explicitBackendRequest()
    })
    const first = compile({ graph, pageIds: [pageId], options })
    const second = compile({ graph, pageIds: [pageId], options })
    const firstEntries = backendEntries(first)

    expect(firstEntries.length).toBeGreaterThan(1)
    expect(backendEntries(second)).toEqual(firstEntries)
    expect(first.artifactOwnership?.backendReviewFiles).toEqual(firstEntries.map(([path]) => path))
    const manifest = JSON.parse(
      textFile(first, BACKEND_ARTIFACT_MANIFEST_PATH)
    ) as BackendArtifactManifestV1
    expect(manifest.authority).toMatchObject({
      providerId: 'supabase',
      packageDigest: SUPABASE_BACKEND_PROVIDER_COMPILER_BUNDLE_DIGEST
    })

    const temporary = mkdtempSync(join(tmpdir(), 'openpencil-explicit-backend-compile-'))
    const outDir = join(temporary, 'dist')
    try {
      const result = await buildPreviewProject({
        files: first.files,
        artifactOwnership: first.artifactOwnership,
        outDir,
        fsRoot: process.cwd(),
        target: 'react'
      })
      expect(result.staticFiles).toContain('index.html')
      expect(result.backendReviewFiles).toEqual(
        firstEntries.map(([path]) => `openpencil-server/${path}`)
      )
      expect(result.executableServerWorkflowFiles).toEqual([])
    } finally {
      rmSync(temporary, { recursive: true, force: true })
    }
  })

  test('does not fall back when explicit authority is disabled or malformed', () => {
    const { graph, pageId } = explicitGraph()
    const cases = [
      explicitBackendRequest({ enabled: false }),
      {
        ...explicitBackendRequest(),
        unexpected: 'second-authority'
      }
    ]
    const expectedCodes = ['backend-provider-disabled', 'backend-provider-request-invalid']

    for (let index = 0; index < cases.length; index += 1) {
      let failure: unknown
      try {
        compile({
          graph,
          pageIds: [pageId],
          options: withDefaults({
            devMode: false,
            backendProvider: cases[index] as CompilerBackendProviderRequest
          })
        })
      } catch (cause) {
        failure = cause
      }
      expect(failure).toBeInstanceOf(BackendProviderCompilationError)
      expect(failure).toMatchObject({
        diagnostics: expect.arrayContaining([
          expect.objectContaining({ code: expectedCodes[index], severity: 'error' })
        ])
      })
    }
  })

  test('rejects explicit and legacy Backend authorities in the same document', () => {
    const { graph, pageId } = legacyGraph()
    let failure: unknown
    try {
      compile({
        graph,
        pageIds: [pageId],
        options: withDefaults({
          devMode: false,
          backendProvider: explicitBackendRequest()
        })
      })
    } catch (cause) {
      failure = cause
    }
    expect(failure).toBeInstanceOf(BackendProviderCompilationError)
    expect(failure).toMatchObject({
      diagnostics: expect.arrayContaining([
        expect.objectContaining({
          code: 'backend-provider-authority-conflict',
          severity: 'error'
        })
      ])
    })
  })
})
