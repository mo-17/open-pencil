import { readdir } from 'node:fs/promises'
import { isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  discoverPublicPackages,
  readPackageManifest,
  type WorkspacePackage
} from '@open-pencil/package-artifacts'

export const repositoryRoot = resolve(fileURLToPath(new URL('../../..', import.meta.url)))
const configuredPackageRoot = process.env.OPENPENCIL_PACKAGE_ROOT?.trim()
export const usingPreparedPublishDirectories = Boolean(configuredPackageRoot)
export const packageRoot = configuredPackageRoot
  ? resolve(repositoryRoot, configuredPackageRoot)
  : repositoryRoot

export async function publicPackages(root: string): Promise<WorkspacePackage[]> {
  if (!usingPreparedPublishDirectories || resolve(root) !== resolve(repositoryRoot)) {
    return discoverPublicPackages(root)
  }
  const packages: WorkspacePackage[] = []
  for (const entry of await readdir(packageRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const directory = join(packageRoot, entry.name)
    const manifest = await readPackageManifest(join(directory, 'package.json'))
    if (manifest.private === true) {
      throw new Error(`Prepared publish directory must not be private: ${entry.name}`)
    }
    packages.push({ directory, manifest })
  }
  return packages.sort((left, right) => left.directory.localeCompare(right.directory))
}

export async function publicPackageDirs(root: string): Promise<string[]> {
  return (await publicPackages(root)).map(({ directory }) => directory)
}

export function publicPackagePath(packageDir: string): string {
  return isAbsolute(packageDir) ? packageDir : join(packageRoot, packageDir)
}
