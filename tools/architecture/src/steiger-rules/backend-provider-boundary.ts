import { createImportRule, createTextRule } from './support.ts'

const BACKEND_APPLY_AUTHORITY_ROOT = 'src/app/plugins/host/deployment'
const HOST_CREDENTIALS_ROOT = 'src/app/settings/credentials'

const BACKEND_PROVIDER_SANDBOX_ROOTS = [
  'packages/mcp/src/',
  'src/app/plugins/runtime/',
  'src/app/lowcode/preview-pane/browser-worker/',
  'src/app/lowcode/preview-popout/',
  'packages/compiler/src/browser-preview/',
  'packages/compiler/src/backend/'
] as const

const BACKEND_APPLY_UNTRUSTED_ROOTS = [
  ...BACKEND_PROVIDER_SANDBOX_ROOTS,
  'src/app/ai/',
  'src/app/automation/'
] as const

const DIRECT_DATABASE_CLIENTS = ['@supabase/supabase-js', 'pg', 'postgres'] as const

// This compatibility builder emits browser application source as inert text. The
// generated application may use supabase-js; the compiler process itself does not.
const DATABASE_CLIENT_SOURCE_EMITTER_ALLOWLIST = new Set([
  'packages/compiler/src/backend/supabase/legacy-react-artifacts.ts'
])

function sourceIsWithin(sourceRel: string, roots: readonly string[]): boolean {
  return roots.some((root) => sourceRel.startsWith(root))
}

function resolvedIsWithin(resolved: string | null, root: string): boolean {
  return resolved === root || resolved?.startsWith(`${root}/`) === true
}

function isDirectDatabaseClient(specifier: string): boolean {
  return DIRECT_DATABASE_CLIENTS.some(
    (client) => specifier === client || specifier.startsWith(`${client}/`)
  )
}

export const noBackendApplyAuthorityInUntrustedRuntimes = createImportRule(
  'open-pencil/no-backend-apply-authority-in-untrusted-runtimes',
  (sourceRel, _specifier, resolved) => {
    if (!sourceIsWithin(sourceRel, BACKEND_APPLY_UNTRUSTED_ROOTS)) return null
    if (!resolvedIsWithin(resolved, BACKEND_APPLY_AUTHORITY_ROOT)) return null
    return 'MCP, AI, automation, browser/compiler sandboxes, and Plugin WASM runtimes cannot import host Backend Apply or production deployment authority.'
  }
)

export const noHostCredentialsOrDatabaseClientsInBackendSandboxes = createImportRule(
  'open-pencil/no-host-credentials-or-database-clients-in-backend-sandboxes',
  (sourceRel, specifier, resolved) => {
    if (!sourceIsWithin(sourceRel, BACKEND_PROVIDER_SANDBOX_ROOTS)) return null
    if (resolvedIsWithin(resolved, HOST_CREDENTIALS_ROOT)) {
      return 'Browser/compiler sandboxes, MCP, and Plugin WASM runtimes cannot read host credential services. Pass only explicit secret-free data contracts.'
    }
    if (
      isDirectDatabaseClient(specifier) &&
      !DATABASE_CLIENT_SOURCE_EMITTER_ALLOWLIST.has(sourceRel)
    ) {
      return 'Browser/compiler sandboxes, MCP, and Plugin WASM runtimes cannot import database clients. Database inspection and Backend Apply stay in the trusted host.'
    }
    return null
  }
)

const NODE_RUNTIME_SPECIFIERS = new Set([
  'assert',
  'buffer',
  'child_process',
  'cluster',
  'crypto',
  'dgram',
  'dns',
  'events',
  'fs',
  'http',
  'https',
  'module',
  'net',
  'os',
  'path',
  'perf_hooks',
  'process',
  'stream',
  'tls',
  'url',
  'util',
  'vm',
  'worker_threads',
  'zlib'
])

export const noBackendProviderRuntimeAuthorityInCompiler = createImportRule(
  'open-pencil/no-backend-provider-runtime-authority-in-compiler',
  (sourceRel, specifier) => {
    if (!sourceRel.startsWith('packages/compiler/src/backend/')) return null
    if (
      specifier === '@open-pencil/scene-graph/primitives' ||
      specifier.startsWith('@open-pencil/scene-graph/primitives/')
    ) {
      return null
    }
    if (
      specifier === '@open-pencil/scene-graph' ||
      specifier.startsWith('@open-pencil/scene-graph/')
    ) {
      return 'Compiler Backend Providers consume normalized Backend IR, not SceneGraph APIs.'
    }
    const rootSpecifier = specifier.split('/')[0]
    if (
      specifier === 'bun' ||
      specifier.startsWith('bun:') ||
      specifier.startsWith('node:') ||
      NODE_RUNTIME_SPECIFIERS.has(rootSpecifier)
    ) {
      return 'Compiler Backend Providers must remain deterministic and cannot import host filesystem, process, or network runtimes.'
    }
    return null
  }
)

const BACKEND_PROVIDER_FORBIDDEN_GLOBALS = [
  /\bprocess\s*\.\s*env\b/gu,
  /\b(?:fetch|XMLHttpRequest|WebSocket|EventSource)\s*\(/gu,
  /\b(?:Bun|Deno)\s*\./gu,
  /\b(?:window|document|navigator|localStorage|sessionStorage)\s*\./gu
]

export const noBackendProviderRuntimeEffectsInCompiler = createTextRule(
  'open-pencil/no-backend-provider-runtime-effects-in-compiler',
  (sourceRel, content) => {
    if (!sourceRel.startsWith('packages/compiler/src/backend/')) return []
    return BACKEND_PROVIDER_FORBIDDEN_GLOBALS.flatMap((pattern) =>
      [...content.matchAll(pattern)].map((match) => {
        const before = content.slice(0, match.index)
        const lines = before.split('\n')
        return {
          message:
            'Compiler Backend Providers cannot read environment or host/browser network and storage globals.',
          line: lines.length,
          column: lines.at(-1)?.length ?? 0
        }
      })
    )
  }
)
