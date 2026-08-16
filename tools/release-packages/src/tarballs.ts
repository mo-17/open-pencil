import { execFile } from 'node:child_process'
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'

import {
  PUBLISH_REPOSITORY_URL,
  type PreparedPublishPackage,
  type PreparedPublishPlan
} from './publish-dirs'
import { validatePackageResourceReferences } from './resource-references'

const execFileAsync = promisify(execFile)

type PackageJSON = {
  bin?: Record<string, string> | string
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
  imports?: unknown
  name: string
  optionalDependencies?: Record<string, string>
  peerDependencies?: Record<string, string>
  private?: boolean
  publishConfig?: unknown
  repository?: string | { url?: string }
  scripts?: unknown
  version?: string
}

const PUBLISHED_DEPENDENCY_FIELDS = [
  'dependencies',
  'peerDependencies',
  'optionalDependencies'
] as const

export function packageBinTargets(packageJSON: PackageJSON): Record<string, string> {
  if (typeof packageJSON.bin === 'string') return { [packageJSON.name]: packageJSON.bin }
  return packageJSON.bin ?? {}
}

export async function tarballEntries(tarballPath: string): Promise<Set<string>> {
  const { stdout } = await execFileAsync('tar', ['-tf', tarballPath], { encoding: 'utf8' })
  return new Set(stdout.trim().split('\n').filter(Boolean))
}

export async function tarballPackageJSON(tarballPath: string): Promise<PackageJSON> {
  const { stdout } = await execFileAsync('tar', ['-xOf', tarballPath, 'package/package.json'], {
    encoding: 'utf8'
  })
  return JSON.parse(stdout) as PackageJSON
}

export async function validateTarballBinTargets(tarballPath: string): Promise<void> {
  const entries = await tarballEntries(tarballPath)
  const packageJSON = await tarballPackageJSON(tarballPath)

  for (const [name, target] of Object.entries(packageBinTargets(packageJSON))) {
    const entry = `package/${target.replace(/^\.\//, '')}`
    if (!entries.has(entry)) {
      throw new Error(`${tarballPath}: bin ${name} target missing from tarball: ${entry}`)
    }
  }
}

export async function validateTarballLicense(
  tarballPath: string,
  expectedLicense: Uint8Array
): Promise<void> {
  const licenseEntry = 'package/LICENSE'
  const entries = await tarballEntries(tarballPath)
  if (!entries.has(licenseEntry)) {
    throw new Error(`${tarballPath}: ${licenseEntry} is missing from tarball`)
  }

  const { stdout } = await execFileAsync('tar', ['-xOf', tarballPath, licenseEntry])
  const packedLicense = Buffer.isBuffer(stdout) ? stdout : Buffer.from(stdout)
  if (!packedLicense.equals(expectedLicense)) {
    throw new Error(`${tarballPath}: ${licenseEntry} does not match repository LICENSE`)
  }
}

function tarballFilename(pkg: PreparedPublishPackage): string {
  return `${pkg.name.replace(/^@/, '').replaceAll('/', '-')}-${pkg.version}.tgz`
}

function repositoryURL(repository: PackageJSON['repository']): string | undefined {
  return typeof repository === 'string' ? repository : repository?.url
}

export function validatePublishedPackageJSON(
  packageJSON: PackageJSON,
  expected: PreparedPublishPackage,
  expectedRepository: string
): void {
  if (packageJSON.name !== expected.name || packageJSON.version !== expected.version) {
    throw new Error(
      `${expected.dir}: tarball identity mismatch (${packageJSON.name}@${String(packageJSON.version)})`
    )
  }
  if (repositoryURL(packageJSON.repository) !== expectedRepository) {
    throw new Error(`${expected.name}: tarball repository does not point to ${expectedRepository}`)
  }
  for (const field of [
    'devDependencies',
    'imports',
    'private',
    'publishConfig',
    'scripts'
  ] as const) {
    if (packageJSON[field] !== undefined) {
      throw new Error(`${expected.name}: tarball must not contain ${field}`)
    }
  }
  for (const field of PUBLISHED_DEPENDENCY_FIELDS) {
    for (const [name, version] of Object.entries(packageJSON[field] ?? {})) {
      if (version.startsWith('workspace:')) {
        throw new Error(`${expected.name}: tarball ${field}.${name} retains ${version}`)
      }
      if (name.startsWith('@open-pencil/') && name !== '@open-pencil/yoga-layout') {
        throw new Error(
          `${expected.name}: tarball ${field} retains source scope dependency ${name}`
        )
      }
    }
  }
}

function containsExactPackageSpecifier(bytes: Buffer, packageName: string): boolean {
  const needle = Buffer.from(packageName)
  let offset = 0
  while (offset < bytes.length) {
    const index = bytes.indexOf(needle, offset)
    if (index === -1) return false
    const next = bytes.at(index + needle.length)
    const nextIsPackageNameCharacter =
      next !== undefined &&
      ((next >= 48 && next <= 57) ||
        (next >= 65 && next <= 90) ||
        (next >= 97 && next <= 122) ||
        next === 45 ||
        next === 46 ||
        next === 95)
    if (!nextIsPackageNameCharacter) return true
    offset = index + needle.length
  }
  return false
}

async function filesUnder(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true })
  const files = await Promise.all(
    entries.map(async (entry) => {
      const path = join(root, entry.name)
      return entry.isDirectory() ? filesUnder(path) : [path]
    })
  )
  return files.flat()
}

async function auditTarballFiles(
  tarballPath: string,
  workspaceNames: readonly string[]
): Promise<void> {
  const extractRoot = await mkdtemp(join(tmpdir(), 'open-pencil-tarball-audit-'))
  try {
    await execFileAsync('tar', ['-xzf', tarballPath, '-C', extractRoot])
    await validatePackageResourceReferences(join(extractRoot, 'package'))
    const failures: string[] = []
    for (const path of await filesUnder(extractRoot)) {
      const bytes = await readFile(path)
      const names = workspaceNames.filter((name) => containsExactPackageSpecifier(bytes, name))
      if (names.length > 0) failures.push(`${path}: ${names.join(', ')}`)
    }
    if (failures.length > 0) {
      throw new Error(
        `${tarballPath}: retained workspace package specifiers\n${failures.join('\n')}`
      )
    }
  } finally {
    await rm(extractRoot, { recursive: true, force: true })
  }
}

export async function validatePackedTarballs(
  directory: string,
  plan: PreparedPublishPlan,
  expectedLicense: Uint8Array,
  forbiddenWorkspaceNames: readonly string[] = []
): Promise<void> {
  if (plan.repository !== PUBLISH_REPOSITORY_URL) {
    throw new Error(`Release plan repository must be ${PUBLISH_REPOSITORY_URL}`)
  }
  for (const expected of plan.packages) {
    if (expected.version !== plan.version) {
      throw new Error(
        `${expected.name}: release plan package version ${expected.version} does not match ${plan.version}`
      )
    }
  }

  const tarballs = (await readdir(directory)).filter((name) => name.endsWith('.tgz')).sort()
  const expectedTarballs = plan.packages.map(tarballFilename).sort()
  if (JSON.stringify(tarballs) !== JSON.stringify(expectedTarballs)) {
    throw new Error(
      `Packed tarball set mismatch\nexpected: ${expectedTarballs.join(', ')}\nactual: ${tarballs.join(', ')}`
    )
  }

  for (const expected of plan.packages) {
    const tarballPath = join(directory, tarballFilename(expected))
    const packageJSON = await tarballPackageJSON(tarballPath)
    validatePublishedPackageJSON(packageJSON, expected, plan.repository)
    await validateTarballBinTargets(tarballPath)
    await validateTarballLicense(tarballPath, expectedLicense)
    await auditTarballFiles(tarballPath, forbiddenWorkspaceNames)
  }
}
