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
  test.each(['', 'String.raw'])(
    'ignores generated source in %s template text at any provider path',
    (tag) => {
      const source = fixture(
        [
          'export const generated = ' + tag + '`',
          "import pg from 'pg'",
          "export { Client } from 'postgres'",
          "import { readFileSync } from 'node:fs'",
          'const endpoint = process.env.DATABASE_URL',
          'const request = fetch(endpoint)',
          '`'
        ].join('\n')
      )
      expect(
        noHostCredentialsOrDatabaseClientsInBackendSandboxes.check(source).diagnostics
      ).toEqual([])
      expect(noBackendProviderRuntimeAuthorityInCompiler.check(source).diagnostics).toEqual([])
      expect(noBackendProviderRuntimeEffectsInCompiler.check(source).diagnostics).toEqual([])
    }
  )

  test('inspects live interpolation expressions and preserves their source positions', () => {
    const source = fixture(
      [
        'export const generated = String.raw`',
        "import pg from 'pg'; fetch(process.env.INERT)",
        `\${process.env.LIVE}`,
        `\${fetch('/actual')}`,
        `\${import('pg')}`,
        `\${require('postgres')}`,
        '`'
      ].join('\n')
    )
    const effects = noBackendProviderRuntimeEffectsInCompiler.check(source).diagnostics
    expect(effects.map(({ location }) => [location.line, location.column])).toEqual([
      [3, 2],
      [4, 2]
    ])
    const imports = noHostCredentialsOrDatabaseClientsInBackendSandboxes.check(source).diagnostics
    expect(imports.map(({ location }) => [location.line, location.column])).toEqual([
      [5, 2],
      [6, 2]
    ])
  })

  test('traverses nested templates without treating escaped interpolation or nested text as code', () => {
    const source = fixture(
      [
        'const generated = String.raw`',
        `\\\${fetch('/escaped')}`,
        `\${String.raw\`fetch("/nested-text") \${process["env"].LIVE}\`}`,
        '`'
      ].join('\n')
    )
    const diagnostics = noBackendProviderRuntimeEffectsInCompiler.check(source).diagnostics
    expect(diagnostics).toHaveLength(1)
    expect(diagnostics[0]?.location.line).toBe(3)
  })

  test('keeps actual effects outside generated strings and handles computed globals', () => {
    const source = fixture(
      [
        "const text = 'fetch(process.env.INERT)'",
        "const request = globalThis['fetch']('/actual')",
        "const setting = process['env'].LIVE",
        'const other = globalThis.process.env.OTHER',
        "const socket = new WebSocket('ws://localhost')",
        "const file = Bun['file']('local')"
      ].join('\n')
    )
    const diagnostics = noBackendProviderRuntimeEffectsInCompiler.check(source).diagnostics
    expect(diagnostics.map(({ location }) => location.line)).toEqual([2, 3, 4, 5, 6])
  })

  test.each([
    "import pg from 'pg'",
    "export { Client } from 'pg'",
    "const pg = require('pg')",
    "const pg = import('pg')",
    "import pg = require('pg')",
    "type Client = import('pg').Client"
  ])('rejects real database module references: %s', (content) => {
    expect(
      noHostCredentialsOrDatabaseClientsInBackendSandboxes.check(fixture(content)).diagnostics
    ).toHaveLength(1)
  })

  test('does not let generated text mask an adjacent actual import or the former allowlisted path', () => {
    const source = fixture(
      ['const generated = String.raw`', "import pg from 'pg'", '`', "import pg from 'pg'"].join(
        '\n'
      ),
      'packages/compiler/src/backend/supabase/legacy-react-artifacts.ts'
    )
    const diagnostics =
      noHostCredentialsOrDatabaseClientsInBackendSandboxes.check(source).diagnostics
    expect(diagnostics).toHaveLength(1)
    expect(diagnostics[0]?.location.line).toBe(4)
  })

  test('extracts actual Vue script imports with original line numbers', () => {
    const source = fixture(
      [
        '<template><div>import pg from pg</div></template>',
        '<script setup lang="ts">',
        'const source = String.raw`',
        "import pg from 'pg'",
        '`',
        "const database = import('pg')",
        '</script>'
      ].join('\n'),
      'src/app/lowcode/preview-popout/fixture.vue'
    )
    const diagnostics =
      noHostCredentialsOrDatabaseClientsInBackendSandboxes.check(source).diagnostics
    expect(diagnostics).toHaveLength(1)
    expect(diagnostics[0]?.location.line).toBe(6)
  })

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
