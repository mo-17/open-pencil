import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join, parse } from 'node:path'
import { fileURLToPath } from 'node:url'

interface CLIPackageJSON {
  dependencies?: Record<string, string>
  name?: string
}

interface CompilerBuildRootOptions {
  moduleURL?: string
  temporaryDirectory?: string
}

const CLI_PACKAGE_NAMES = new Set(['@open-pencil/cli', '@open-pencil-lowcode/cli'])
const COMPILER_BUILD_PACKAGE_JSON = `${JSON.stringify(
  { name: 'openpencil-cli-compiler-build', private: true, type: 'module' },
  null,
  2
)}\n`

function hasErrorCode(error: unknown, code: string): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === code
}

async function readPackageJSON(path: string): Promise<CLIPackageJSON | null> {
  let source: string
  try {
    source = await readFile(path, 'utf8')
  } catch (error) {
    if (hasErrorCode(error, 'ENOENT')) return null
    throw error
  }
  return JSON.parse(source) as CLIPackageJSON
}

async function modulePaths(moduleURL: string): Promise<string[]> {
  const lexicalPath = fileURLToPath(moduleURL)
  try {
    const canonicalPath = await realpath(lexicalPath)
    return canonicalPath === lexicalPath ? [lexicalPath] : [lexicalPath, canonicalPath]
  } catch (error) {
    if (hasErrorCode(error, 'ENOENT')) return [lexicalPath]
    throw error
  }
}

async function findCLIPackageManifest(paths: readonly string[]): Promise<CLIPackageJSON> {
  for (const modulePath of paths) {
    let directory = dirname(modulePath)
    const filesystemRoot = parse(directory).root
    while (directory !== filesystemRoot) {
      const manifest = await readPackageJSON(join(directory, 'package.json'))
      if (manifest?.name && CLI_PACKAGE_NAMES.has(manifest.name)) return manifest
      directory = dirname(directory)
    }
  }
  throw new Error('Could not locate the installed OpenPencil CLI package')
}

function packageNameSegments(name: string): string[] {
  if (!name || name.includes('\\') || name.includes('\0')) {
    throw new Error(`Invalid CLI build dependency name: ${JSON.stringify(name)}`)
  }
  const segments = name.split('/')
  const valid = name.startsWith('@')
    ? segments.length === 2 && segments[0].length > 1 && segments[1].length > 0
    : segments.length === 1 && segments[0].length > 0
  if (!valid || segments.some((segment) => segment === '.' || segment === '..')) {
    throw new Error(`Invalid CLI build dependency name: ${JSON.stringify(name)}`)
  }
  return segments
}

function isOpenPencilDependency(name: string): boolean {
  return name.startsWith('@open-pencil/') || name.startsWith('@open-pencil-lowcode/')
}

function dependencySearchRoots(modulePath: string): string[] {
  const roots: string[] = []
  let directory = dirname(modulePath)
  const filesystemRoot = parse(directory).root
  while (directory !== filesystemRoot) {
    if (basename(directory) !== 'node_modules') roots.push(join(directory, 'node_modules'))
    directory = dirname(directory)
  }
  return roots
}

async function resolveDependencyDirectory(
  dependencyName: string,
  paths: readonly string[]
): Promise<string> {
  const segments = packageNameSegments(dependencyName)
  const visited = new Set<string>()
  for (const modulePath of paths) {
    for (const searchRoot of dependencySearchRoots(modulePath)) {
      const candidate = join(searchRoot, ...segments)
      if (visited.has(candidate)) continue
      visited.add(candidate)
      const manifest = await readPackageJSON(join(candidate, 'package.json'))
      if (manifest?.name === dependencyName) return realpath(candidate)
    }
  }
  throw new Error(`OpenPencil CLI build dependency is not installed: ${dependencyName}`)
}

async function linkDependency(root: string, name: string, target: string): Promise<void> {
  const segments = packageNameSegments(name)
  const destination = join(root, 'node_modules', ...segments)
  await mkdir(dirname(destination), { recursive: true })
  await symlink(target, destination, process.platform === 'win32' ? 'junction' : 'dir')
}

/**
 * Give bundled compiler builds a writable VFS root without touching the user's
 * current working directory. The temporary node_modules overlay points back to
 * the CLI installation, so local, global, and bunx installs resolve the exact
 * dependencies shipped with that CLI rather than ambient project packages.
 */
export async function withCompilerBuildRoot<T>(
  operation: (fsRoot: string) => T | Promise<T>,
  options: CompilerBuildRootOptions = {}
): Promise<T> {
  const paths = await modulePaths(options.moduleURL ?? import.meta.url)
  const manifest = await findCLIPackageManifest(paths)
  if (!manifest.dependencies || typeof manifest.dependencies !== 'object') {
    throw new Error('OpenPencil CLI package has no runtime dependencies')
  }

  const prefix = join(options.temporaryDirectory ?? tmpdir(), 'openpencil-cli-build-')
  const fsRoot = await mkdtemp(prefix)
  try {
    await Promise.all([
      mkdir(join(fsRoot, 'node_modules'), { recursive: true }),
      writeFile(join(fsRoot, 'package.json'), COMPILER_BUILD_PACKAGE_JSON, { flag: 'wx' })
    ])
    for (const dependencyName of Object.keys(manifest.dependencies).sort()) {
      if (isOpenPencilDependency(dependencyName)) continue
      const target = await resolveDependencyDirectory(dependencyName, paths)
      await linkDependency(fsRoot, dependencyName, target)
    }
    return await operation(fsRoot)
  } finally {
    await rm(fsRoot, { recursive: true, force: true })
  }
}
