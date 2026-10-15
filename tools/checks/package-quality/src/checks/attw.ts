import { mkdtemp, rm } from 'node:fs/promises'
import { availableParallelism, tmpdir } from 'node:os'
import { join, relative, resolve } from 'node:path'

import { runCommand } from '@open-pencil/package-artifacts-tools'

import { publicPackages, repositoryRoot } from '../packages'
import { packWorkspaceTarballs } from '../smoke/pack'
import { runPackageChecks } from './run'

// Each package analysis keeps one core busy.
const TYPE_CHECK_CONCURRENCY = availableParallelism()

export async function checkTypes(root: string): Promise<void> {
  const temporaryRoot = await mkdtemp(join(tmpdir(), 'open-pencil-package-types-'))
  try {
    const packages = (await publicPackages(root)).map((pkg) => ({
      ...pkg,
      directory: relative(root, resolve(root, pkg.directory))
    }))
    // Keep lifecycle scripts and temporary tarballs out of the source directories.
    const tarballs = await packWorkspaceTarballs(root, temporaryRoot, packages, 'npm')
    await runPackageChecks(
      tarballs.map((tarball) => ({
        command: 'bun',
        args: ['attw', tarball, '--profile', 'esm-only', '--format', 'ascii'],
        cwd: root,
        env: { ...process.env, npm_config_ignore_scripts: 'true' }
      })),
      runCommand,
      TYPE_CHECK_CONCURRENCY
    )
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true })
  }
}

if (import.meta.main) await checkTypes(repositoryRoot)
