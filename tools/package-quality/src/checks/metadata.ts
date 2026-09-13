import { join } from 'node:path'

import {
  readPackageManifest,
  validateManifest,
  type PackageDiagnostic
} from '@open-pencil/package-artifacts'

import { publicPackages, repositoryRoot, usingPreparedPublishDirectories } from '../packages'

export async function validatePackageMetadata(root: string): Promise<PackageDiagnostic[]> {
  const packages = await publicPackages(root)
  if (packages.length === 0) {
    return [
      { field: 'workspaces', message: 'no public packages discovered', packageName: '<root>' }
    ]
  }

  const { version: expectedVersion } = await readPackageManifest(join(root, 'package.json'))
  const diagnostics = packages.flatMap(({ manifest }) => validateManifest(manifest))
  for (const { manifest } of packages) {
    if (manifest.version !== expectedVersion) {
      diagnostics.push({
        packageName: manifest.name,
        field: 'version',
        message: `${manifest.version} must match ${expectedVersion}`
      })
    }
  }
  if (usingPreparedPublishDirectories && root === repositoryRoot) {
    for (const { manifest } of packages) {
      for (const field of ['imports', 'private', 'publishConfig', 'scripts', 'devDependencies']) {
        if (manifest[field] !== undefined) {
          diagnostics.push({
            packageName: manifest.name,
            field,
            message: 'must be removed from prepared output'
          })
        }
      }
    }
  }
  return diagnostics
}

export function formatPackageDiagnostics(diagnostics: PackageDiagnostic[]): string {
  if (usingPreparedPublishDirectories && root === repositoryRoot) {
    for (const { manifest } of packages) {
      for (const field of ['imports', 'private', 'publishConfig', 'scripts', 'devDependencies']) {
        if (manifest[field] !== undefined) {
          diagnostics.push({
            packageName: manifest.name,
            field,
            message: 'must be removed from prepared output'
          })
        }
      }
    }
  }
  return diagnostics
    .map(({ packageName, field, message }) => `${packageName}: ${field} ${message}`)
    .join('\n')
}

if (import.meta.main) {
  const diagnostics = await validatePackageMetadata(repositoryRoot)
  if (diagnostics.length > 0) throw new Error(formatPackageDiagnostics(diagnostics))
  console.log('Package metadata checks passed.')
}
