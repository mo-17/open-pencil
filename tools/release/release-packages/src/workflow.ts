import { createHash } from 'node:crypto'
import { mkdir, readFile, readdir, rm } from 'node:fs/promises'
import { basename, join } from 'node:path'

import {
  buildPublicPackages,
  CommandError,
  discoverPublicPackages,
  orderPackagesByDependencies,
  parseNpmPack,
  parsePackageManifest,
  isRegistryNotFound,
  validateRegistryVersion,
  readPackageManifest,
  runCommand,
  type WorkspacePackage
} from '@open-pencil/package-artifacts-tools'
import {
  inspectTarball,
  validatePackedTarballs
} from '@open-pencil/package-artifacts-tools/tarball'
import { verifyArtifactConsumers } from '@open-pencil/package-quality-tools/consumer'

import { NPM_RELEASE_POLICY } from './policy'
import {
  discoverPublishPackages,
  preparePublishDirectories,
  publishPackageJSON,
  PUBLIC_PACKAGE_NAME_MAP,
  PREPARED_PUBLISH_PLAN,
  type PackageFileLister,
  type PreparedPublishPlan
} from './publish-dirs'
import { validatePackedTarballs as validateForkTarballs } from './tarballs'

export interface PublicationPlanEntry {
  package: WorkspacePackage
  status: 'published' | 'unpublished'
}

export type PackagePublicationLookup = (pkg: WorkspacePackage) => Promise<boolean>

export interface PrepareReleaseOptions {
  listPackageFiles?: PackageFileLister
}

/** Packs a prepared package directory into `destination` and returns the tarball filename. */
export type PackDirectory = (directory: string, destination: string) => Promise<string>

export interface PackReleaseOptions {
  /** Defaults to a real `npm pack`; tests inject an in-process packer to stay out of npm. */
  packDirectory?: PackDirectory
}

export interface ReleasePaths {
  artifacts: string
  prepared: string
  root: string
}

export function releasePaths(root: string): ReleasePaths {
  return {
    root,
    artifacts: join(root, '.npm-packages'),
    prepared: join(root, '.publish')
  }
}

export { buildPublicPackages as buildReleasePackages }

export async function prepareReleasePackages(
  root: string,
  options: PrepareReleaseOptions = {}
): Promise<void> {
  const packages = await discoverPublicPackages(root)
  const { version } = await readPackageManifest(join(root, 'package.json'))
  if (packages.length === 0) throw new Error('No public packages discovered')
  if (packages.some(({ manifest }) => manifest.version !== version)) {
    throw new Error('Public package versions must be aligned before release preparation')
  }
  await preparePublishDirectories({
    coreVersion: version,
    packages: await discoverPublishPackages(root),
    root,
    listPackageFiles: options.listPackageFiles,
    log: console.log
  })
}

async function npmPackDirectory(directory: string, destination: string): Promise<string> {
  const result = await runCommand({
    command: 'npm',
    args: ['pack', '--json', '--ignore-scripts', '--pack-destination', destination],
    cwd: directory,
    timeoutMs: 60_000
  })
  return parseNpmPack(result.stdout).filename
}

async function packageIsPublished(pkg: WorkspacePackage, root: string): Promise<boolean> {
  const specifier = `${pkg.manifest.name}@${pkg.manifest.version}`
  try {
    const result = await runCommand({
      command: 'npm',
      args: ['view', specifier, 'version', '--json', '--registry', NPM_RELEASE_POLICY.registry],
      cwd: root,
      timeoutMs: 30_000
    })
    validateRegistryVersion(result.stdout, pkg.manifest.version)
    return true
  } catch (error) {
    if (error instanceof CommandError && isRegistryNotFound(error.stdout)) return false
    throw error
  }
}

export async function createPublicationPlan(
  root: string,
  isPublished: PackagePublicationLookup = (pkg) => packageIsPublished(pkg, root)
): Promise<PublicationPlanEntry[]> {
  const packages = orderPackagesByDependencies(await discoverPublicPackages(root)).map((pkg) => {
    if (!Object.hasOwn(PUBLIC_PACKAGE_NAME_MAP, pkg.manifest.name)) return pkg
    return {
      ...pkg,
      manifest: parsePackageManifest(
        JSON.stringify(publishPackageJSON(pkg.manifest, pkg.manifest.version)),
        pkg.directory
      )
    }
  })
  const statuses = await Promise.all(packages.map(isPublished))
  return packages.map((pkg, index) => ({
    package: pkg,
    status: statuses[index] ? 'published' : 'unpublished'
  }))
}

export async function packReleasePackages(
  root: string,
  isPublished?: PackagePublicationLookup,
  options: PackReleaseOptions = {}
): Promise<PublicationPlanEntry[]> {
  const paths = releasePaths(root)
  const packDirectory = options.packDirectory ?? npmPackDirectory
  const plan = await createPublicationPlan(root, isPublished)
  await rm(paths.artifacts, { recursive: true, force: true })
  await mkdir(paths.artifacts, { recursive: true })

  for (const entry of plan) {
    const { manifest } = entry.package
    const preparedDirectory = join(paths.prepared, basename(entry.package.directory))
    const filename = await packDirectory(preparedDirectory, paths.artifacts)
    console.log(`Packed ${manifest.name}: ${filename}`)
  }

  await validatePackedTarballs(paths.artifacts)
  const preparedPlan = JSON.parse(
    await readFile(join(paths.prepared, PREPARED_PUBLISH_PLAN), 'utf8')
  ) as PreparedPublishPlan
  const workspace = JSON.parse(await readFile(join(root, 'package.json'), 'utf8')) as {
    workspaces: string[]
  }
  const workspaceNames = await Promise.all(
    workspace.workspaces.map(async (directory) => {
      const manifest = JSON.parse(
        await readFile(join(root, directory, 'package.json'), 'utf8')
      ) as { name: string }
      return manifest.name
    })
  )
  await validateForkTarballs(
    paths.artifacts,
    preparedPlan,
    await readFile(join(root, 'LICENSE')),
    workspaceNames
  )
  return plan
}

async function artifactsByPackage(directory: string): Promise<Map<string, string>> {
  const artifacts = new Map<string, string>()
  for (const filename of (await readdir(directory)).filter((name) => name.endsWith('.tgz'))) {
    const path = join(directory, filename)
    const { manifest, diagnostics } = await inspectTarball(path)
    if (diagnostics.length > 0) {
      throw new Error(
        diagnostics
          .map(({ packageName, field, message }) => `${packageName}: ${field} ${message}`)
          .join('\n')
      )
    }
    const key = `${manifest.name}@${manifest.version}`
    if (artifacts.has(key)) throw new Error(`Duplicate package artifact for ${key}`)
    artifacts.set(key, path)
  }
  return artifacts
}

export function validatePublicationArtifacts(
  plan: PublicationPlanEntry[],
  artifacts: Map<string, string>
): void {
  const expected = new Set(
    plan
      .filter(({ status }) => status === 'unpublished')
      .map(({ package: pkg }) => `${pkg.manifest.name}@${pkg.manifest.version}`)
  )
  const missing = [...expected].filter((key) => !artifacts.has(key))
  const known = new Set(
    plan.map(({ package: pkg }) => `${pkg.manifest.name}@${pkg.manifest.version}`)
  )
  const unexpected = [...artifacts.keys()].filter((key) => !known.has(key))
  if (missing.length === 0 && unexpected.length === 0) return

  const messages = [
    ...missing.map((key) => `Missing verified package artifact for ${key}`),
    ...unexpected.map((key) => `Unexpected package artifact for ${key}`)
  ]
  throw new Error(messages.join('\n'))
}

export interface PublicationOperations {
  plan(root: string): Promise<PublicationPlanEntry[]>
  artifacts(directory: string): Promise<Map<string, string>>
  verify(root: string, tarballs: string[]): Promise<void>
  execute: typeof runCommand
  verifyPublished(root: string, entry: PublicationPlanEntry, tarball: string): Promise<void>
}

const publicationOperations: PublicationOperations = {
  plan: createPublicationPlan,
  artifacts: artifactsByPackage,
  verify: verifyArtifactConsumers,
  execute: runCommand,
  async verifyPublished(root, entry, tarball) {
    const { manifest } = entry.package
    const result = await runCommand({
      command: 'npm',
      args: [
        'view',
        `${manifest.name}@${manifest.version}`,
        'dist.integrity',
        '--json',
        '--registry',
        NPM_RELEASE_POLICY.registry
      ],
      cwd: root,
      timeoutMs: 30_000
    })
    const remote = JSON.parse(result.stdout) as unknown
    const local = `sha512-${createHash('sha512')
      .update(await readFile(tarball))
      .digest('base64')}`
    if (remote !== local)
      throw new Error(
        `Published ${manifest.name}@${manifest.version} differs from the audited tarball`
      )
  }
}

export async function publishReleasePackages(
  root: string,
  operations: PublicationOperations = publicationOperations
): Promise<PublicationPlanEntry[]> {
  const paths = releasePaths(root)
  const plan = await operations.plan(root)
  if (
    operations === publicationOperations &&
    plan.some(({ package: pkg }) => !pkg.manifest.name.startsWith('@open-pencil-lowcode/'))
  ) {
    throw new Error(
      'Fork publication requires an explicitly mapped @open-pencil-lowcode package set'
    )
  }
  const artifacts = await operations.artifacts(paths.artifacts)
  validatePublicationArtifacts(plan, artifacts)
  await operations.verify(root, [...artifacts.values()])
  for (const entry of plan) {
    if (entry.status !== 'published') continue
    const { manifest } = entry.package
    const tarball = artifacts.get(`${manifest.name}@${manifest.version}`)
    if (!tarball)
      throw new Error(`Missing retained artifact for ${manifest.name}@${manifest.version}`)
    await operations.verifyPublished(root, entry, tarball)
  }

  for (const entry of plan) {
    const { manifest } = entry.package
    if (entry.status === 'published') {
      console.log(`Skipping ${manifest.name}@${manifest.version}: already published`)
      continue
    }
    const key = `${manifest.name}@${manifest.version}`
    const artifact = artifacts.get(key)
    if (!artifact) throw new Error(`Publication artifact disappeared for ${key}`)
    await operations.execute({
      command: 'npm',
      args: [
        'publish',
        artifact,
        '--access',
        NPM_RELEASE_POLICY.access,
        '--provenance',
        '--registry',
        NPM_RELEASE_POLICY.registry
      ],
      cwd: root,
      output: 'inherit',
      timeoutMs: 120_000
    })
  }
  return plan
}
