import { afterEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import {
  noBackendApplyAuthorityInUntrustedRuntimes,
  noBackendProviderRuntimeAuthorityInCompiler,
  noBackendProviderRuntimeEffectsInCompiler,
  noHostCredentialsOrDatabaseClientsInBackendSandboxes
} from '../src/steiger-rules/backend-provider-boundary'
import type { TreeEntry } from '../src/steiger-rules/support'

const temporaryDirectories: string[] = []

function fixture(
  content: string,
  sourceRel = 'packages/compiler/src/backend/fixture.ts'
): TreeEntry {
  const root = mkdtempSync(join(tmpdir(), 'open-pencil-backend-architecture-'))
  temporaryDirectories.push(root)
  const filePath = join(root, sourceRel)
  mkdirSync(dirname(filePath), { recursive: true })
  writeFileSync(filePath, content)
  return {
    type: 'folder',
    path: root,
    children: [{ type: 'file', path: filePath }]
  }
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

describe('Compiler Backend Provider architecture boundary', () => {
  test('rejects SceneGraph and host runtime imports', () => {
    const result = noBackendProviderRuntimeAuthorityInCompiler.check(
      fixture(`
import { SceneGraph } from '@open-pencil/scene-graph'
import { readFileSync } from 'node:fs'
export const values = [SceneGraph, readFileSync]
`)
    )
    expect(result.diagnostics).toHaveLength(2)
    expect(result.diagnostics.map((entry) => entry.message)).toEqual(
      expect.arrayContaining([
        expect.stringContaining('normalized Backend IR'),
        expect.stringContaining('cannot import host filesystem')
      ])
    )
  })

  test('allows provider-neutral IR and primitive data types', () => {
    const result = noBackendProviderRuntimeAuthorityInCompiler.check(
      fixture(`
import type { BackendApplicationSpecV1 } from '@open-pencil/lowcode/backend'
import type { JSONValue } from '@open-pencil/scene-graph/primitives'
export type Payload = BackendApplicationSpecV1 | JSONValue
`)
    )
    expect(result.diagnostics).toEqual([])
  })

  test('rejects environment, network, and host storage globals', () => {
    const result = noBackendProviderRuntimeEffectsInCompiler.check(
      fixture(`
const endpoint = process.env.BACKEND_URL
const request = fetch(endpoint)
const cached = localStorage.getItem('backend')
export { cached, request }
`)
    )
    expect(result.diagnostics).toHaveLength(3)
  })
})

describe('Backend Provider host trust boundary', () => {
  test('rejects Backend Apply authority imports from every untrusted runtime root', () => {
    const roots = [
      'packages/mcp/src/fixture.ts',
      'src/app/ai/fixture.ts',
      'src/app/automation/fixture.ts',
      'src/app/plugins/runtime/fixture.ts',
      'src/app/lowcode/preview-pane/browser-worker/fixture.ts',
      'src/app/lowcode/preview-popout/fixture.ts',
      'packages/compiler/src/browser-preview/fixture.ts',
      'packages/compiler/src/backend/fixture.ts'
    ]

    for (const sourceRel of roots) {
      const result = noBackendApplyAuthorityInUntrustedRuntimes.check(
        fixture(
          "import { createBackendReleaseController } from '@/app/plugins/host/deployment/backend/release-controller'\n",
          sourceRel
        )
      )
      expect(result.diagnostics, sourceRel).toHaveLength(1)
      expect(result.diagnostics[0]?.message).toContain('production deployment authority')
    }
  })

  test('rejects host credentials and direct database clients from sandbox roots', () => {
    const roots = [
      'packages/mcp/src/fixture.ts',
      'src/app/plugins/runtime/fixture.ts',
      'src/app/lowcode/preview-pane/browser-worker/fixture.ts',
      'src/app/lowcode/preview-popout/fixture.ts',
      'packages/compiler/src/browser-preview/fixture.ts',
      'packages/compiler/src/backend/fixture.ts'
    ]
    const imports = `
import { appCredentialServices } from '@/app/settings/credentials/app'
import { createClient } from '@supabase/supabase-js'
import pg from 'pg'
import postgres from 'postgres'
export { appCredentialServices, createClient, pg, postgres }
`

    for (const sourceRel of roots) {
      const result = noHostCredentialsOrDatabaseClientsInBackendSandboxes.check(
        fixture(imports, sourceRel)
      )
      expect(result.diagnostics, sourceRel).toHaveLength(4)
      expect(result.diagnostics.map((entry) => entry.message)).toEqual(
        expect.arrayContaining([
          expect.stringContaining('cannot read host credential services'),
          expect.stringContaining('cannot import database clients')
        ])
      )
    }
  })

  test('allows trusted Supabase host adapters and AI provider credential ownership', () => {
    const hostImports = `
import { appCredentialServices } from '@/app/settings/credentials/app'
import { createBackendReleaseController } from '@/app/plugins/host/deployment/backend/release-controller'
import { createClient } from '@supabase/supabase-js'
export { appCredentialServices, createBackendReleaseController, createClient }
`
    const trustedHost = fixture(hostImports, 'src/app/lowcode/supabase/adapter.ts')
    expect(noBackendApplyAuthorityInUntrustedRuntimes.check(trustedHost).diagnostics).toEqual([])
    expect(
      noHostCredentialsOrDatabaseClientsInBackendSandboxes.check(trustedHost).diagnostics
    ).toEqual([])

    const aiCredentials = fixture(
      `
import { appCredentialServices } from '@/app/settings/credentials/app'
import { resolveRemoteMCPBearerToken } from '@/app/ai/mcp/credentials'
export { appCredentialServices, resolveRemoteMCPBearerToken }
`,
      'src/app/ai/providers/runtime.ts'
    )
    expect(
      noHostCredentialsOrDatabaseClientsInBackendSandboxes.check(aiCredentials).diagnostics
    ).toEqual([])
  })

  test('does not treat a generated browser client source string as a compiler import', () => {
    const generatedSource = fixture(
      `export const source = \`import { createClient } from '@supabase/supabase-js'\`\n`,
      'packages/compiler/src/backend/supabase/legacy-react-artifacts.ts'
    )
    expect(
      noHostCredentialsOrDatabaseClientsInBackendSandboxes.check(generatedSource).diagnostics
    ).toEqual([])
  })
})
