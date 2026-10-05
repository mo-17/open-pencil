import {
  backendProviderRuntimeEffectLocations,
  createBackendImportRule
} from './backend-provider-syntax.ts'
import { createTextRule } from './support.ts'

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

export const noBackendApplyAuthorityInUntrustedRuntimes = createBackendImportRule(
  'open-pencil/no-backend-apply-authority-in-untrusted-runtimes',
  (sourceRel) => sourceIsWithin(sourceRel, BACKEND_APPLY_UNTRUSTED_ROOTS),
  (sourceRel, _specifier, resolved) => {
    if (!sourceIsWithin(sourceRel, BACKEND_APPLY_UNTRUSTED_ROOTS)) return null
    if (!resolvedIsWithin(resolved, BACKEND_APPLY_AUTHORITY_ROOT)) return null
    return 'MCP, AI, automation, browser/compiler sandboxes, and Plugin WASM runtimes cannot import host Backend Apply or production deployment authority.'
  }
)

export const noHostCredentialsOrDatabaseClientsInBackendSandboxes = createBackendImportRule(
  'open-pencil/no-host-credentials-or-database-clients-in-backend-sandboxes',
  (sourceRel) => sourceIsWithin(sourceRel, BACKEND_PROVIDER_SANDBOX_ROOTS),
  (sourceRel, specifier, resolved) => {
    if (!sourceIsWithin(sourceRel, BACKEND_PROVIDER_SANDBOX_ROOTS)) return null
    if (resolvedIsWithin(resolved, HOST_CREDENTIALS_ROOT)) {
      return 'Browser/compiler sandboxes, MCP, and Plugin WASM runtimes cannot read host credential services. Pass only explicit secret-free data contracts.'
    }
    if (isDirectDatabaseClient(specifier)) {
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

export const noBackendProviderRuntimeAuthorityInCompiler = createBackendImportRule(
  'open-pencil/no-backend-provider-runtime-authority-in-compiler',
  (sourceRel) => sourceRel.startsWith('packages/compiler/src/backend/'),
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

export const noBackendProviderRuntimeEffectsInCompiler = createTextRule(
  'open-pencil/no-backend-provider-runtime-effects-in-compiler',
  (sourceRel, content) => {
    if (!sourceRel.startsWith('packages/compiler/src/backend/')) return []
    return backendProviderRuntimeEffectLocations(sourceRel, content).map((position) => ({
      message:
        'Compiler Backend Providers cannot read environment or host/browser network and storage globals.',
      ...position
    }))
  }
)
