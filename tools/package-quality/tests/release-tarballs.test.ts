import { afterEach, describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  releaseTarballFilename,
  resolveExactReleaseTarballs,
  type ReleaseTarballPackage
} from '../src/release-tarballs'

const roots: string[] = []
const corePackage: ReleaseTarballPackage = {
  name: '@open-pencil-lowcode/core',
  version: '0.15.0'
}
const cliPackage: ReleaseTarballPackage = {
  name: '@open-pencil-lowcode/cli',
  version: '0.15.0'
}
const packages: ReleaseTarballPackage[] = [corePackage, cliPackage]

async function fixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'open-pencil-package-tarballs-'))
  roots.push(root)
  for (const pkg of packages) {
    await writeFile(join(root, releaseTarballFilename(pkg)), 'fixture')
  }
  return root
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { force: true, recursive: true })))
})

describe('resolveExactReleaseTarballs', () => {
  test('returns package-ordered paths for the exact npm tarball set', async () => {
    const root = await fixture()
    await writeFile(join(root, 'release-plan.json'), '{}')

    expect(resolveExactReleaseTarballs(root, packages)).toEqual(
      packages.map((pkg) => join(root, releaseTarballFilename(pkg)))
    )
  })

  test('rejects missing, extra, duplicate, or non-file tarballs', async () => {
    const missingRoot = await fixture()
    await rm(join(missingRoot, releaseTarballFilename(corePackage)))
    expect(() => resolveExactReleaseTarballs(missingRoot, packages)).toThrow(
      'Package consumer tarball set mismatch'
    )

    const extraRoot = await fixture()
    await writeFile(join(extraRoot, 'open-pencil-lowcode-extra-0.15.0.tgz'), 'fixture')
    expect(() => resolveExactReleaseTarballs(extraRoot, packages)).toThrow(
      'Package consumer tarball set mismatch'
    )

    const duplicateRoot = await fixture()
    expect(() => resolveExactReleaseTarballs(duplicateRoot, [corePackage, corePackage])).toThrow(
      'duplicate release tarball identities'
    )

    const directoryRoot = await fixture()
    const cliTarball = join(directoryRoot, releaseTarballFilename(cliPackage))
    await rm(cliTarball)
    await mkdir(cliTarball)
    expect(() => resolveExactReleaseTarballs(directoryRoot, packages)).toThrow(
      'Release tarball input is not a regular file'
    )
  })
})
