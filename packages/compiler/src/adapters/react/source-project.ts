export type ReactCompilerProjectFiles = ReadonlyMap<string, string | Uint8Array>

interface ReactPackageJSONPatch {
  description: string
  main?: string
  scripts?: Readonly<Record<string, string>>
  dependencies?: Readonly<Record<string, string>>
  devDependencies?: Readonly<Record<string, string>>
  removeScripts?: readonly string[]
  removeDependencies?: readonly string[]
  removeDevDependencies?: readonly string[]
}

interface ReactPackageJSONRecord {
  [key: string]: unknown
}

const UNSAFE_OBJECT_KEYS = new Set(['__proto__', 'constructor', 'prototype'])

function isPlainPackageObject(value: unknown): value is ReactPackageJSONRecord {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function assertSafeObjectKey(key: string, path: string): void {
  if (UNSAFE_OBJECT_KEYS.has(key)) throw new TypeError(`${path} contains an unsafe key: ${key}`)
}

function stringRecord(value: unknown, path: string): Record<string, string> {
  if (value === undefined) return Object.create(null) as Record<string, string>
  if (!isPlainPackageObject(value)) throw new TypeError(`${path} must be an object`)
  const result = Object.create(null) as Record<string, string>
  for (const [key, entry] of Object.entries(value)) {
    assertSafeObjectKey(key, path)
    if (typeof entry !== 'string') throw new TypeError(`${path}.${key} must be a string`)
    result[key] = entry
  }
  return result
}

function mergeStringRecord(
  value: unknown,
  path: string,
  additions: Readonly<Record<string, string>> | undefined,
  removals: readonly string[] | undefined
): Record<string, string> {
  const current = stringRecord(value, path)
  const removed = new Set(removals)
  const result = Object.create(null) as Record<string, string>
  for (const [key, entry] of Object.entries(current)) {
    if (!removed.has(key)) result[key] = entry
  }
  for (const [key, entry] of Object.entries(additions ?? {})) {
    assertSafeObjectKey(key, path)
    result[key] = entry
  }
  return result
}

export function requireReactCompilerTextFile(
  files: ReactCompilerProjectFiles,
  path: string
): string {
  const value = files.get(path)
  if (typeof value !== 'string') {
    throw new TypeError(`React compiler output is missing a text ${path}`)
  }
  return value
}

export function patchReactCompilerPackageJSON(
  compiledFiles: ReactCompilerProjectFiles,
  patch: ReactPackageJSONPatch
): Map<string, string | Uint8Array> {
  const source = requireReactCompilerTextFile(compiledFiles, 'package.json')
  const parsed: unknown = JSON.parse(source)
  if (!isPlainPackageObject(parsed))
    throw new TypeError('React compiler package.json must be an object')

  const packageJSON: ReactPackageJSONRecord = {}
  for (const [key, value] of Object.entries(parsed)) {
    assertSafeObjectKey(key, 'package.json')
    packageJSON[key] = value
  }
  packageJSON.description = patch.description
  if (patch.main) packageJSON.main = patch.main
  packageJSON.scripts = mergeStringRecord(
    parsed.scripts,
    'package.json.scripts',
    patch.scripts,
    patch.removeScripts
  )
  packageJSON.dependencies = mergeStringRecord(
    parsed.dependencies,
    'package.json.dependencies',
    patch.dependencies,
    patch.removeDependencies
  )
  packageJSON.devDependencies = mergeStringRecord(
    parsed.devDependencies,
    'package.json.devDependencies',
    patch.devDependencies,
    patch.removeDevDependencies
  )

  const files = new Map(compiledFiles)
  files.set('package.json', `${JSON.stringify(packageJSON, null, 2)}\n`)
  return files
}

export function appendReactProjectGitignore(
  files: Map<string, string | Uint8Array>,
  additions: readonly string[]
): void {
  const current = files.get('.gitignore')
  if (current !== undefined && typeof current !== 'string') {
    throw new TypeError('React compiler output contains a binary .gitignore')
  }
  const lines = (current ?? '').split(/\r?\n/).filter(Boolean)
  const seen = new Set(lines)
  for (const addition of additions) {
    if (!seen.has(addition)) lines.push(addition)
    seen.add(addition)
  }
  files.set('.gitignore', `${lines.join('\n')}\n`)
}

export function rewriteReactProjectForHashRouting(files: Map<string, string | Uint8Array>): void {
  const app = requireReactCompilerTextFile(files, 'src/App.tsx')
  if (app.includes('BrowserRouter')) {
    files.set('src/App.tsx', app.replaceAll('BrowserRouter', 'HashRouter'))
  }
}

export function configureReactViteRelativeBase(files: Map<string, string | Uint8Array>): void {
  const config = requireReactCompilerTextFile(files, 'vite.config.ts')
  const marker = 'defineConfig({'
  if (!config.includes(marker)) {
    throw new TypeError('React compiler vite.config.ts has an unsupported shape')
  }
  files.set('vite.config.ts', config.replace(marker, `defineConfig({\n  base: './',`))
}

export function stripReactMainCSSImports(source: string): string {
  return source.replace(/^import ['"]\.\/[^'"]+\.css['"]\s*;?\r?\n/gm, '')
}

export function safeReverseDomainAppId(packageName: string): string {
  const segments = packageName
    .toLowerCase()
    .split(/[._-]+/)
    .map((segment) => segment.replace(/[^a-z0-9]/g, ''))
    .filter(Boolean)
    .map((segment) => (/^[0-9]/.test(segment) ? `app${segment}` : segment))
  return `dev.openpencil.${segments.join('.') || 'app'}`
}
