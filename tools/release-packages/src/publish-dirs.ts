import { copyFile, mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, extname, join, relative } from 'node:path'

import { validatePackageResourceReferences } from './resource-references'

export interface PackagePublishConfig {
  dir: string
  extraFiles: string[]
  include: string[]
}

interface PreparePublishDirectoriesOptions {
  coreVersion: string
  packages: PackagePublishConfig[]
  root: string
  outRoot?: string
  log?: (message: string) => void
}

type PackageJSON = Record<string, unknown> & {
  name?: string
  optionalDependencies?: Record<string, string>
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
  exports?: unknown
  imports?: unknown
  peerDependencies?: Record<string, string>
  peerDependenciesMeta?: Record<string, unknown>
  private?: boolean
  publishConfig?: Record<string, unknown>
  repository?: unknown
  scripts?: unknown
  version?: string
}

interface WorkspacePackage {
  dir: string
  manifest: PackageJSON
  name: string
  private: boolean
}

const PUBLISHED_DEPENDENCY_FIELDS = [
  'dependencies',
  'peerDependencies',
  'optionalDependencies'
] as const
const IGNORED_PUBLISH_CONFIG_FIELDS = new Set(['access', 'provenance', 'registry'])
const PUBLISH_CONFIG_OVERRIDE_FIELDS = new Set([
  'bin',
  'browser',
  'exports',
  'files',
  'main',
  'module',
  'sideEffects',
  'types',
  'typesVersions',
  'typings'
])
const TEXT_EXTENSIONS = new Set([
  '.cjs',
  '.css',
  '.cts',
  '.d.ts',
  '.html',
  '.js',
  '.json',
  '.jsx',
  '.map',
  '.md',
  '.mjs',
  '.mts',
  '.svg',
  '.ts',
  '.tsx',
  '.txt',
  '.vue'
])

export const PUBLISH_REPOSITORY_URL = 'git+https://github.com/mo-17/open-pencil.git'
export const PREPARED_PUBLISH_PLAN = 'release-plan.json'

export const PUBLIC_PACKAGE_NAME_MAP = {
  '@open-pencil/scene-graph': '@open-pencil-lowcode/scene-graph',
  '@open-pencil/motion': '@open-pencil-lowcode/motion',
  '@open-pencil/plugin-contracts': '@open-pencil-lowcode/plugin-contracts',
  '@open-pencil/lowcode': '@open-pencil-lowcode/lowcode',
  '@open-pencil/pen': '@open-pencil-lowcode/pen',
  '@open-pencil/kiwi': '@open-pencil-lowcode/kiwi',
  '@open-pencil/fig': '@open-pencil-lowcode/fig',
  '@open-pencil/core': '@open-pencil-lowcode/core',
  '@open-pencil/motion-runtime': '@open-pencil-lowcode/motion-runtime',
  '@open-pencil/dom-css': '@open-pencil-lowcode/dom-css',
  '@open-pencil/mcp': '@open-pencil-lowcode/mcp',
  '@open-pencil/harness': '@open-pencil-lowcode/harness',
  '@open-pencil/vue': '@open-pencil-lowcode/vue',
  '@open-pencil/cli': '@open-pencil-lowcode/cli'
} as const

const PUBLIC_PACKAGE_REPLACEMENTS = Object.entries(PUBLIC_PACKAGE_NAME_MAP)
  .sort(([left], [right]) => right.length - left.length)
  .map(([source, target]) => ({
    pattern: new RegExp(`${escapeRegExp(source)}(?![A-Za-z0-9._-])`, 'g'),
    source,
    target
  }))

export const DEFAULT_PACKAGES: PackagePublishConfig[] = [
  { dir: 'packages/scene-graph', include: ['dist'], extraFiles: ['README.md'] },
  { dir: 'packages/motion', include: ['dist'], extraFiles: ['README.md'] },
  { dir: 'packages/plugin-contracts', include: ['dist'], extraFiles: ['README.md'] },
  { dir: 'packages/lowcode', include: ['dist'], extraFiles: ['README.md'] },
  { dir: 'packages/pen', include: ['dist'], extraFiles: ['README.md'] },
  { dir: 'packages/kiwi', include: ['dist'], extraFiles: ['README.md'] },
  { dir: 'packages/fig', include: ['dist'], extraFiles: ['README.md'] },
  { dir: 'packages/core', include: ['dist', 'assets'], extraFiles: [] },
  { dir: 'packages/motion-runtime', include: ['dist'], extraFiles: ['README.md'] },
  { dir: 'packages/dom-css', include: ['dist'], extraFiles: ['README.md'] },
  { dir: 'packages/mcp', include: ['dist'], extraFiles: [] },
  { dir: 'packages/harness', include: ['dist'], extraFiles: ['README.md'] },
  { dir: 'packages/vue', include: ['dist'], extraFiles: ['README.md'] },
  { dir: 'packages/cli', include: ['bin', 'dist'], extraFiles: [] }
]

export interface PreparedPublishPackage {
  dir: string
  name: string
  version: string
}

export interface PreparedPublishPlan {
  packages: PreparedPublishPackage[]
  repository: string
  version: string
}

async function exists(path: string) {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

async function copyRecursive(from: string, to: string): Promise<void> {
  const sourceStat = await stat(from)
  if (sourceStat.isDirectory()) {
    await mkdir(to, { recursive: true })
    for (const entry of await readdir(from)) {
      await copyRecursive(join(from, entry), join(to, entry))
    }
    return
  }

  await mkdir(dirname(to), { recursive: true })
  await copyFile(from, to)
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function remapPublicPackageSpecifiersInText(value: string): string {
  let output = value
  for (const replacement of PUBLIC_PACKAGE_REPLACEMENTS) {
    output = output.replace(replacement.pattern, replacement.target)
  }
  return output
}

function remapDependencyRecord(
  dependencies: Record<string, string>,
  workspaceVersion: string
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(dependencies).map(([name, version]) => [
      PUBLIC_PACKAGE_NAME_MAP[name as keyof typeof PUBLIC_PACKAGE_NAME_MAP] ?? name,
      version.startsWith('workspace:') ? `^${workspaceVersion}` : version
    ])
  )
}

function remapPackageKeyRecord(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(value).map(([name, metadata]) => [
      PUBLIC_PACKAGE_NAME_MAP[name as keyof typeof PUBLIC_PACKAGE_NAME_MAP] ?? name,
      metadata
    ])
  )
}

function stripBunExportConditions(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripBunExportConditions)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => key !== 'bun')
      .map(([key, child]) => [key, stripBunExportConditions(child)])
  )
}

export function publishPackageJSON(source: PackageJSON, coreVersion: string): PackageJSON {
  const json = structuredClone(source)
  const sourceName = json.name
  const publishedName =
    sourceName && PUBLIC_PACKAGE_NAME_MAP[sourceName as keyof typeof PUBLIC_PACKAGE_NAME_MAP]
  if (!sourceName || !publishedName) {
    throw new Error(`Public package has no publish-name mapping: ${sourceName ?? '<missing name>'}`)
  }
  json.name = publishedName

  for (const field of PUBLISHED_DEPENDENCY_FIELDS) {
    const dependencies = json[field]
    if (!dependencies) continue
    json[field] = remapDependencyRecord(dependencies, coreVersion)
  }
  if (json.peerDependenciesMeta) {
    json.peerDependenciesMeta = remapPackageKeyRecord(json.peerDependenciesMeta)
  }

  delete json.scripts
  delete json.devDependencies
  delete json.private

  if (json.publishConfig) {
    for (const [key, value] of Object.entries(json.publishConfig)) {
      if (IGNORED_PUBLISH_CONFIG_FIELDS.has(key)) continue
      if (!PUBLISH_CONFIG_OVERRIDE_FIELDS.has(key)) {
        throw new Error(`${sourceName}: publishConfig cannot override protected field ${key}`)
      }
      json[key] = value
    }
    delete json.publishConfig
  }

  if (json.exports) json.exports = stripBunExportConditions(json.exports)
  // Workspace-only #aliases point at TypeScript sources and are not needed by built output.
  // Removing them keeps the published manifest from advertising files omitted by `files`.
  delete json.imports

  const repository =
    json.repository && typeof json.repository === 'object' && !Array.isArray(json.repository)
      ? json.repository
      : {}
  json.repository = { ...repository, type: 'git', url: PUBLISH_REPOSITORY_URL }

  const published = JSON.parse(
    remapPublicPackageSpecifiersInText(JSON.stringify(json))
  ) as PackageJSON
  published.name = publishedName
  if (published.exports) published.exports = stripBunExportConditions(published.exports)
  delete published.imports
  delete published.devDependencies
  delete published.private
  delete published.scripts
  return published
}

async function workspacePackages(root: string): Promise<WorkspacePackage[]> {
  const rootPackageJSON = JSON.parse(await readFile(join(root, 'package.json'), 'utf8')) as {
    workspaces?: unknown
  }
  if (
    !Array.isArray(rootPackageJSON.workspaces) ||
    !rootPackageJSON.workspaces.every((workspace) => typeof workspace === 'string')
  ) {
    throw new Error('Root package.json must declare explicit string workspace directories')
  }

  const packages: WorkspacePackage[] = []
  for (const dir of rootPackageJSON.workspaces) {
    const manifest = JSON.parse(
      await readFile(join(root, dir, 'package.json'), 'utf8')
    ) as PackageJSON
    if (typeof manifest.name !== 'string')
      throw new Error(`${dir}: workspace package name is missing`)
    packages.push({
      dir,
      manifest,
      name: manifest.name,
      private: manifest.private === true
    })
  }
  return packages
}

function assertNoPrivateWorkspaceDependencies(
  workspace: WorkspacePackage,
  workspaceByName: ReadonlyMap<string, WorkspacePackage>
): void {
  for (const field of PUBLISHED_DEPENDENCY_FIELDS) {
    for (const dependencyName of Object.keys(workspace.manifest[field] ?? {})) {
      const dependencyWorkspace = workspaceByName.get(dependencyName)
      if (dependencyWorkspace?.private) {
        throw new Error(
          `${workspace.name}: ${field} must not reference private workspace ${dependencyName}`
        )
      }
    }
  }
}

function validatePublishPlan(
  configuredPackages: readonly PackagePublishConfig[],
  workspaces: readonly WorkspacePackage[]
): void {
  const workspaceByDir = new Map(workspaces.map((workspace) => [workspace.dir, workspace]))
  const workspaceByName = new Map(workspaces.map((workspace) => [workspace.name, workspace]))
  if (workspaceByDir.size !== workspaces.length || workspaceByName.size !== workspaces.length) {
    throw new Error('Workspace directories and package names must be unique')
  }

  const configuredDirs = new Set(configuredPackages.map((pkg) => pkg.dir))
  if (configuredDirs.size !== configuredPackages.length) {
    throw new Error('Publish package directories must be unique')
  }

  const mappedSources = new Set(Object.keys(PUBLIC_PACKAGE_NAME_MAP))
  const mappedTargets = new Set(Object.values(PUBLIC_PACKAGE_NAME_MAP))
  if (mappedTargets.size !== mappedSources.size)
    throw new Error('Published package names must be unique')

  for (const workspace of workspaces) {
    if (workspace.private) continue
    if (!mappedSources.has(workspace.name)) {
      throw new Error(
        `Public workspace has no publish-name mapping: ${workspace.name} (${workspace.dir})`
      )
    }
    if (!configuredDirs.has(workspace.dir)) {
      throw new Error(
        `Mapped public workspace is missing from publish directories: ${workspace.dir}`
      )
    }

    assertNoPrivateWorkspaceDependencies(workspace, workspaceByName)
  }

  for (const sourceName of mappedSources) {
    const workspace = workspaceByName.get(sourceName)
    if (!workspace || workspace.private) {
      throw new Error(`Publish-name mapping does not resolve to a public workspace: ${sourceName}`)
    }
  }

  for (const configured of configuredPackages) {
    const workspace = workspaceByDir.get(configured.dir)
    if (!workspace || workspace.private || !mappedSources.has(workspace.name)) {
      throw new Error(
        `Publish directory is not an exactly mapped public workspace: ${configured.dir}`
      )
    }
  }
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

function isPublishTextFile(path: string): boolean {
  const name = basename(path).toLowerCase()
  if (name.startsWith('readme') || name.startsWith('license')) return true
  if (name.endsWith('.d.ts')) return true
  return TEXT_EXTENSIONS.has(extname(name))
}

async function remapPublishTree(root: string): Promise<void> {
  for (const path of await filesUnder(root)) {
    if (!isPublishTextFile(path)) continue
    const source = await readFile(path, 'utf8')
    const remapped = remapPublicPackageSpecifiersInText(source)
    if (remapped !== source) await writeFile(path, remapped)
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

async function assertNoWorkspaceSpecifiers(
  outRoot: string,
  workspaceNames: readonly string[]
): Promise<void> {
  const failures: string[] = []
  for (const path of await filesUnder(outRoot)) {
    const bytes = await readFile(path)
    const names = workspaceNames.filter((name) => containsExactPackageSpecifier(bytes, name))
    if (names.length > 0) failures.push(`${relative(outRoot, path)}: ${names.join(', ')}`)
  }
  if (failures.length > 0) {
    throw new Error(
      `Published output contains unreplaced workspace package specifiers:\n${failures.join('\n')}`
    )
  }
}

export async function preparePublishDirectories(
  options: PreparePublishDirectoriesOptions
): Promise<void> {
  const outRoot = options.outRoot ?? join(options.root, '.publish')
  const log = options.log
  const workspaces = await workspacePackages(options.root)
  validatePublishPlan(options.packages, workspaces)

  await rm(outRoot, { recursive: true, force: true })
  await mkdir(outRoot, { recursive: true })
  const preparedPackages: PreparedPublishPackage[] = []

  for (const pkg of options.packages) {
    const sourceDir = join(options.root, pkg.dir)
    const destinationDir = join(outRoot, basename(pkg.dir))
    await mkdir(destinationDir, { recursive: true })

    for (const relativePath of pkg.include) {
      const from = join(sourceDir, relativePath)
      if (await exists(from)) await copyRecursive(from, join(destinationDir, relativePath))
    }

    for (const relativePath of pkg.extraFiles) {
      const from = join(sourceDir, relativePath)
      if (await exists(from)) await copyRecursive(from, join(destinationDir, relativePath))
    }

    const packageJSON = JSON.parse(
      await readFile(join(sourceDir, 'package.json'), 'utf8')
    ) as PackageJSON
    const publishJSON = publishPackageJSON(packageJSON, options.coreVersion)
    if (publishJSON.version !== options.coreVersion || typeof publishJSON.name !== 'string') {
      throw new Error(
        `${pkg.dir}: prepared identity must match release ${options.coreVersion} (${String(publishJSON.name)}@${String(publishJSON.version)})`
      )
    }
    await writeFile(
      join(destinationDir, 'package.json'),
      `${JSON.stringify(publishJSON, null, 2)}\n`
    )
    await remapPublishTree(destinationDir)
    // Keep the legal text byte-for-byte identical to the repository license.
    // Copy it after text remapping so it can never be rewritten as package content.
    await copyFile(join(options.root, 'LICENSE'), join(destinationDir, 'LICENSE'))
    await validatePackageResourceReferences(destinationDir)
    preparedPackages.push({
      dir: basename(pkg.dir),
      name: publishJSON.name,
      version: publishJSON.version
    })
    log?.(`Prepared ${destinationDir}`)
  }

  const plan: PreparedPublishPlan = {
    packages: preparedPackages,
    repository: PUBLISH_REPOSITORY_URL,
    version: options.coreVersion
  }
  await writeFile(join(outRoot, PREPARED_PUBLISH_PLAN), `${JSON.stringify(plan, null, 2)}\n`)

  await assertNoWorkspaceSpecifiers(
    outRoot,
    workspaces.map((workspace) => workspace.name)
  )
}
