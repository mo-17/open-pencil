import type { BackendArtifactSource, BackendProviderDescriptor } from '#compiler/backend/contracts'
import { sameBackendProviderDescriptor } from '#compiler/backend/descriptor'

import { nestJSArtifact } from '../artifact'
import type { NESTJS_PROJECT_PACKAGE } from '../project'
import { NESTJS_PRISMA_CRM_BACKEND_PROVIDER_DESCRIPTOR } from './descriptor'
import presetLock from './preset-lock.json'

export const PRISMA_CRM_NODE_VERSION = '^22.18.0 || >=24.11.0'
export const PRISMA_CRM_PRESET_LOCK_SOURCE = JSON.stringify(presetLock, null, 2) + '\n'

export function prismaCRMProjectPackage(base: typeof NESTJS_PROJECT_PACKAGE) {
  return {
    ...base,
    engines: { node: PRISMA_CRM_NODE_VERSION },
    scripts: {
      ...base.scripts,
      'contract:emit': 'node scripts/contract.mjs',
      prebuild: 'node scripts/contract.mjs',
      prestart: 'node scripts/runtime-version.mjs'
    },
    dependencies: { ...base.dependencies, '@prisma/orm-postgres': '8.0.0-rc.11', pg: '8.22.0' },
    devDependencies: {
      ...base.devDependencies,
      '@types/node': '26.1.2',
      '@types/pg': '8.20.4',
      prisma: '8.0.0-rc.15',
      typescript: '6.0.3'
    }
  }
}

/** Only these reviewed bytes under this exact provider identity bypass integrity-string scanning. */
export function isReviewedPrismaCRMPresetLockArtifact(
  artifact: BackendArtifactSource,
  descriptor: BackendProviderDescriptor
): boolean {
  return (
    sameBackendProviderDescriptor(descriptor, NESTJS_PRISMA_CRM_BACKEND_PROVIDER_DESCRIPTOR) &&
    artifact.path === 'backend/nestjs/package-lock.json' &&
    artifact.kind === 'server-runtime' &&
    artifact.mediaType === 'application/json' &&
    artifact.content === PRISMA_CRM_PRESET_LOCK_SOURCE
  )
}

const VERSION_SOURCE = String.raw`import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export function supportsPrismaRuntime(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version)
  if (!match) return false
  const major = Number(match[1]), minor = Number(match[2])
  return (major === 22 && minor >= 18) || (major === 24 && minor >= 11) || major > 24
}
export function requirePrismaRuntime() {
  if (!supportsPrismaRuntime(process.versions.node)) {
    throw new Error('Prisma 8 CRM requires Node 22.18+ or Node 24.11+. Node 24.19 is recommended.')
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { requirePrismaRuntime() }
  catch { console.error('Prisma 8 CRM requires Node 22.18+ or Node 24.11+.'); process.exitCode = 1 }
}
`

const CONTRACT_SCRIPT = `import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { requirePrismaRuntime } from './runtime-version.mjs'

requirePrismaRuntime()
const require = createRequire(import.meta.url)
const cli = join(dirname(require.resolve('prisma/package.json')), 'dist/prisma.js')
execFileSync(process.execPath, [cli, 'contract', 'emit'], {
  cwd: fileURLToPath(new URL('../', import.meta.url)),
  env: { ...process.env, PRISMA_DISABLE_TELEMETRY: '1', PRISMA_SKILLS_CHECK: '0' },
  stdio: 'inherit', timeout: 60000
})
`

export function emitPrismaCRMProjectArtifacts() {
  return [
    nestJSArtifact('scripts/runtime-version.mjs', VERSION_SOURCE),
    nestJSArtifact('scripts/contract.mjs', CONTRACT_SCRIPT),
    nestJSArtifact(
      'prisma.config.ts',
      `import { definePrismaConfig } from 'prisma/config'
import { defineConfig } from '@prisma/orm-postgres/config'

// Query mapping only. OpenPencil SQL migrations remain the sole schema owner.
export default definePrismaConfig({
  orm: defineConfig({ contract: './src/prisma/contract.prisma' }),
  skills: { agents: [], check: false }
})
`
    )
  ]
}

export const PRISMA_CRM_GUIDE = `# NestJS + Prisma 8 CRM (experimental)

Customer list/read use Prisma ORM. Other resources and all transactional commands retain
the existing pg implementation and share its connection pool, timeouts and idempotency ledger.
Only the reviewed three-entity CRM model and customer read authority are accepted.
This provider emits source projects for React/Vue; editor managed/external preview is unsupported.

Use Node 24.19 (minimum Node 22.18 or 24.11). From backend/nestjs run
\`npm ci --ignore-scripts\`, then \`npm run build\`. The prebuild step runs the installed
Prisma CLI to emit contract.json and contract.d.ts without connecting to a database.
\`npm run contract:emit\` runs that step explicitly. No global CLI is required.
The tested pins are prisma 8.0.0-rc.15, @prisma/orm-postgres 8.0.0-rc.11 and pg 8.22.0.
Keep the lockfile; upgrading RC packages requires renewed compatibility checks.

Review migrations/001-initial.sql before initializing a fresh database. It is the sole schema
owner. The Prisma contract is a query mapping, omits SQL-owned secondary indexes, and must
never be used with Prisma schema initialization/update/migration commands. verifyMarker:false
is not a schema-verification result. Use a restricted runtime role and a separate migration role.

Follow LOCAL-RUN.md for standalone local setup, identity configuration and startup.
The editor compatibility endpoint is disabled even with OPENPENCIL_LOCAL_PREVIEW=1.
Public OIDC configuration is exported; passwords and tokens are not. Browser consent/login,
platform testing and production deployment require separate verification after export.
`
