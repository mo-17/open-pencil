import { readdirSync, readFileSync } from 'node:fs'
import { isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

interface RootPackageJSON {
  workspaces?: string[]
}

interface PackageJSON {
  private?: boolean
}

export const repositoryRoot = fileURLToPath(new URL('../../..', import.meta.url))
const configuredPackageRoot = process.env.OPENPENCIL_PACKAGE_ROOT?.trim()
export const usingPreparedPublishDirectories = Boolean(configuredPackageRoot)

function resolvePackageRoot(configuredRoot: string | undefined): string {
  if (!configuredRoot) return repositoryRoot
  return isAbsolute(configuredRoot) ? configuredRoot : resolve(repositoryRoot, configuredRoot)
}

export const packageRoot = resolvePackageRoot(configuredPackageRoot)

function readJSON(path: string): unknown {
  return JSON.parse(readFileSync(path, 'utf8')) as unknown
}

const rootPackage = readJSON(join(repositoryRoot, 'package.json')) as RootPackageJSON

export const publicPackageDirs = usingPreparedPublishDirectories
  ? readdirSync(packageRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .map((packageDir) => {
        const packageJSON = readJSON(join(packageRoot, packageDir, 'package.json')) as PackageJSON
        if (packageJSON.private === true) {
          throw new Error(`Prepared publish directory must not be private: ${packageDir}`)
        }
        return packageDir
      })
      .sort()
  : (rootPackage.workspaces ?? []).filter((workspaceDir) => {
      const workspacePackage = readJSON(
        join(repositoryRoot, workspaceDir, 'package.json')
      ) as PackageJSON
      return workspacePackage.private !== true
    })

export function publicPackagePath(packageDir: string): string {
  return join(packageRoot, packageDir)
}
