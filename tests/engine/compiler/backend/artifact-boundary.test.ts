import { describe, expect, test } from 'bun:test'

import {
  BACKEND_ARTIFACT_MANIFEST_PATH,
  createBackendProviderPlan,
  createBackendProviderRegistry,
  emitBackendProviderPlan
} from '@open-pencil/compiler'
import type { BackendArtifactSource } from '@open-pencil/compiler'

import { createFakeBackendProviderBundle, fakeBackendApplication, fakeSelection } from './helpers'

function emitArtifacts(
  artifacts: readonly BackendArtifactSource[],
  occupiedPaths: readonly string[] = [],
  outputs: readonly BackendArtifactSource['kind'][] = ['database-schema']
) {
  const bundle = createFakeBackendProviderBundle({ artifacts, outputs })
  const registry = createBackendProviderRegistry([bundle])
  const selection = fakeSelection(bundle)
  const planned = createBackendProviderPlan(registry, {
    selection,
    application: fakeBackendApplication(),
    target: 'react',
    mode: 'production'
  })
  if (!planned.ok) throw new Error(JSON.stringify(planned.diagnostics))
  return emitBackendProviderPlan(registry, {
    plan: planned.plan,
    selection,
    occupiedPaths
  })
}

function runtimeArtifact(path: string): BackendArtifactSource {
  return {
    path,
    kind: 'database-schema',
    mediaType: 'text/typescript',
    content: 'export {}\n'
  }
}

describe('Compiler Backend artifact boundary', () => {
  test('rejects traversal, absolute, non-NFC, Windows-reserved, and host manifest paths', () => {
    for (const path of [
      '../escape.ts',
      '/absolute.ts',
      'src\\backend.ts',
      'src/../backend.ts',
      'src/CON.txt',
      'src/trailing. ',
      'src/e\u0301.ts',
      'https://example.invalid/backend.ts',
      BACKEND_ARTIFACT_MANIFEST_PATH
    ]) {
      const result = emitArtifacts([runtimeArtifact(path)])
      expect(result.ok, path).toBe(false)
      if (result.ok) continue
      expect(result.diagnostics, path).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code:
              path === BACKEND_ARTIFACT_MANIFEST_PATH
                ? 'backend-artifact-path-conflict'
                : 'backend-artifact-path-invalid'
          })
        ])
      )
    }
  })

  test('rejects exact, case-folded, and frontend-project path conflicts', () => {
    expect(
      emitArtifacts([runtimeArtifact('src/backend.ts'), runtimeArtifact('src/backend.ts')])
    ).toMatchObject({
      ok: false,
      diagnostics: expect.arrayContaining([
        expect.objectContaining({ code: 'backend-artifact-path-conflict' })
      ])
    })
    expect(
      emitArtifacts([runtimeArtifact('src/backend.ts'), runtimeArtifact('SRC/BACKEND.ts')])
    ).toMatchObject({
      ok: false,
      diagnostics: expect.arrayContaining([
        expect.objectContaining({ code: 'backend-artifact-path-conflict' })
      ])
    })
    expect(emitArtifacts([runtimeArtifact('src/backend.ts')], ['src/backend.ts'])).toMatchObject({
      ok: false,
      diagnostics: expect.arrayContaining([
        expect.objectContaining({ code: 'backend-artifact-path-conflict' })
      ])
    })
  })

  test('rejects artifact kinds that are not declared by the exact adapter descriptor', () => {
    const result = emitArtifacts(
      [
        {
          path: 'src/backend/config.json',
          kind: 'client-config',
          mediaType: 'application/json',
          content: '{}\n'
        }
      ],
      [],
      ['database-schema']
    )
    expect(result).toMatchObject({
      ok: false,
      diagnostics: expect.arrayContaining([
        expect.objectContaining({ code: 'backend-artifact-output-undeclared' })
      ])
    })
  })

  test('rejects secret-like material emitted directly by a trusted adapter', () => {
    const secretCanary = ['sk', 'live', '0123456789abcdefghijklmnopqrstuvwxyz'].join('_')
    const result = emitArtifacts([
      {
        path: 'backend/unsafe.json',
        kind: 'database-schema',
        mediaType: 'application/json',
        content: JSON.stringify({ token: secretCanary })
      }
    ])
    expect(result).toMatchObject({
      ok: false,
      diagnostics: expect.arrayContaining([
        expect.objectContaining({
          code: 'backend-artifact-secret-material-forbidden'
        })
      ])
    })
    expect(JSON.stringify(result)).not.toContain(secretCanary)
  })

  test('rejects secret-like artifact metadata and all contract v1 binary content without echo', () => {
    const secretCanary = ['sk', 'live', '0123456789abcdefghijklmnopqrstuvwxyz'].join('_')
    const cases: readonly [BackendArtifactSource, string][] = [
      [
        {
          path: `backend/${secretCanary}.json`,
          kind: 'database-schema',
          mediaType: 'application/json',
          content: '{}\n'
        },
        'backend-artifact-metadata-secret-material-forbidden'
      ],
      [
        {
          path: 'backend/schema.json',
          kind: 'database-schema',
          mediaType: `application/json; token=${secretCanary}`,
          content: '{}\n'
        },
        'backend-artifact-metadata-secret-material-forbidden'
      ],
      [
        {
          path: 'backend/schema.bin',
          kind: 'database-schema',
          mediaType: 'application/octet-stream',
          content: new TextEncoder().encode(secretCanary)
        },
        'backend-artifact-binary-content-forbidden'
      ]
    ]

    for (const [artifact, code] of cases) {
      const result = emitArtifacts([artifact])
      expect(result).toMatchObject({
        ok: false,
        diagnostics: expect.arrayContaining([expect.objectContaining({ code })])
      })
      expect(JSON.stringify(result)).not.toContain(secretCanary)
    }
  })
})
