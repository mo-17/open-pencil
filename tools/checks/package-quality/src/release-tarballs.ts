import { readdirSync } from 'node:fs'
import { join } from 'node:path'

export interface ReleaseTarballPackage {
  name: string
  version: string
}

export function releaseTarballFilename(pkg: ReleaseTarballPackage): string {
  return `${pkg.name.replace(/^@/, '').replaceAll('/', '-')}-${pkg.version}.tgz`
}

export function resolveExactReleaseTarballs(
  directory: string,
  packages: readonly ReleaseTarballPackage[]
): string[] {
  const expected = packages.map(releaseTarballFilename)
  if (new Set(expected).size !== expected.length) {
    throw new Error('Package consumer smoke received duplicate release tarball identities')
  }

  const actual = readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.name.endsWith('.tgz'))
    .map((entry) => {
      if (!entry.isFile()) {
        throw new Error(`Release tarball input is not a regular file: ${entry.name}`)
      }
      return entry.name
    })
    .sort()
  const expectedSorted = [...expected].sort()
  if (JSON.stringify(actual) !== JSON.stringify(expectedSorted)) {
    throw new Error(
      `Package consumer tarball set mismatch\nexpected: ${expectedSorted.join(', ')}\nactual: ${actual.join(', ')}`
    )
  }

  return expected.map((filename) => join(directory, filename))
}
