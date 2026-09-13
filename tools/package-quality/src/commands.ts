import { defineCommand } from 'citty'

import { resolveWorkspaceRoot, runCommand } from '@open-pencil/package-artifacts'

import { checkTypes } from './checks/attw'
import { formatPackageDiagnostics, validatePackageMetadata } from './checks/metadata'
import { checkPublint } from './checks/publint'
import { repositoryRoot } from './packages'
import { verifyPackedPackages } from './smoke/verify'

async function smoke(root: string): Promise<void> {
  if (root !== repositoryRoot) return verifyPackedPackages(root)
  await runCommand({
    command: 'bun',
    args: ['tools/package-quality/src/smoke.ts'],
    cwd: root,
    output: 'inherit',
    timeoutMs: 600_000
  })
}

const rootArg = { type: 'string', description: 'Explicit workspace root' } as const

async function check(root: string): Promise<void> {
  const diagnostics = await validatePackageMetadata(root)
  if (diagnostics.length > 0) throw new Error(formatPackageDiagnostics(diagnostics))
  await checkPublint(root)
  await checkTypes(root)
  console.log('Package metadata, Publint and ATTW checks passed.')
}

export const checkCommand = defineCommand({
  meta: { name: 'check', description: 'Check public package metadata and declarations' },
  args: { root: rootArg },
  async run({ args }) {
    await check(await resolveWorkspaceRoot(process.cwd(), args.root))
  }
})

export const smokeCommand = defineCommand({
  meta: { name: 'smoke', description: 'Smoke-test built public packages' },
  args: { root: rootArg },
  async run({ args }) {
    await smoke(await resolveWorkspaceRoot(process.cwd(), args.root))
  }
})

export const verifyCommand = defineCommand({
  meta: { name: 'verify', description: 'Run package checks and built-package smoke tests' },
  args: { root: rootArg },
  async run({ args }) {
    const root = await resolveWorkspaceRoot(process.cwd(), args.root)
    await check(root)
    await smoke(root)
  }
})
