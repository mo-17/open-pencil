import { parseStableSemver, validateModuleIdentity } from '@open-pencil/scene-graph'

import { safeSourceProjectPackageName } from '@/app/plugins/host/source-project'

import { boundedCLIOutputString, isCLIOutputRecord as isRecord } from '../cli-output'

export type MicrofrontendExportTarget = 'react' | 'vue'
export type MicrofrontendExportUIKit = 'none' | 'shadcn'

export interface MicrofrontendExportCommandOptions {
  snapshotPath: string
  outDir: string
  target: MicrofrontendExportTarget
  appId: string
  version: string
  packageName: string
  uiKit?: MicrofrontendExportUIKit
}

export interface MicrofrontendExportResult {
  outDir: string
  packageName: string
  target: MicrofrontendExportTarget
  files: string[]
  warningCount: number
  manifestDigest: string
  manifestByteLength: number
}

const CLI_ENTRY = 'packages/cli/src/index.ts'
const MAX_CLI_OUTPUT_BYTES = 1024 * 1024
const MAX_RESULT_FILES = 4096
const MAX_RESULT_WARNINGS = 4096

function boundedString(value: unknown, label: string, maximum: number): string {
  return boundedCLIOutputString(value, {
    label,
    maximum,
    subject: 'Microfrontend build output'
  })
}

export function defaultMicrofrontendAppId(documentName: string): string {
  const namespace = 'openpencil.'
  const slug = safeSourceProjectPackageName(documentName)
    .slice(0, 128 - namespace.length)
    .replace(/[._-]+$/g, '')
  return `${namespace}${slug}`
}

export function microfrontendAppIdError(value: string): string | null {
  return validateModuleIdentity(value.trim(), 'App ID')
}

export function microfrontendVersionError(value: string): string | null {
  try {
    parseStableSemver(value.trim(), 'Version')
    return null
  } catch (error) {
    return error instanceof Error ? error.message : 'Version must use major.minor.patch.'
  }
}

export function buildMicrofrontendExportArgs(options: MicrofrontendExportCommandOptions): string[] {
  const appId = options.appId.trim()
  const version = options.version.trim()
  const appIdError = microfrontendAppIdError(appId)
  if (appIdError) throw new Error(appIdError)
  const versionError = microfrontendVersionError(version)
  if (versionError) throw new Error(versionError)
  if (!options.snapshotPath || !options.outDir || !options.packageName) {
    throw new Error('Microfrontend build paths and package name are required.')
  }

  const args = [
    CLI_ENTRY,
    'build',
    options.snapshotPath,
    '-o',
    options.outDir,
    '--target',
    options.target,
    '--packaging',
    'microfrontend',
    '--app-id',
    appId,
    '--app-version',
    version,
    '--package-name',
    options.packageName,
    '--base',
    './',
    '--json'
  ]
  if (options.target === 'react' && options.uiKit === 'shadcn') {
    args.push('--ui-kit', 'shadcn')
  }
  return args
}

function parseFiles(value: unknown): string[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_RESULT_FILES) {
    throw new Error('Microfrontend build output has an invalid file list.')
  }
  return value.map((entry) => boundedString(entry, 'file path', 4096))
}

/** Validate the bounded machine-readable result emitted by `open-pencil build --json`. */
export function parseMicrofrontendExportResult(raw: string): MicrofrontendExportResult {
  if (raw.length === 0 || new TextEncoder().encode(raw).byteLength > MAX_CLI_OUTPUT_BYTES) {
    throw new Error('Microfrontend build output is empty or too large.')
  }
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    throw new Error('Could not parse microfrontend build output.')
  }
  if (!isRecord(value)) throw new Error('Microfrontend build output must be an object.')

  const target = value.target
  if (target !== 'react' && target !== 'vue') {
    throw new Error('Microfrontend build output has an invalid target.')
  }
  const outDir = boundedString(value.outDir, 'output directory', 4096)
  const packageName = boundedString(value.packageName, 'package name', 256)
  const files = parseFiles(value.files)
  if (!Array.isArray(value.warnings) || value.warnings.length > MAX_RESULT_WARNINGS) {
    throw new Error('Microfrontend build output has an invalid warning list.')
  }
  const microfrontend = value.microfrontend
  if (!isRecord(microfrontend) || !isRecord(microfrontend.manifest)) {
    throw new Error('Microfrontend build output is missing its runtime manifest summary.')
  }
  const manifestDigest = boundedString(microfrontend.manifest.digest, 'manifest digest', 64)
  if (!/^[A-Za-z0-9_-]{43}$/.test(manifestDigest)) {
    throw new Error('Microfrontend build output has an invalid manifest digest.')
  }
  const manifestByteLength = microfrontend.manifest.byteLength
  if (
    !Number.isSafeInteger(manifestByteLength) ||
    (manifestByteLength as number) <= 0 ||
    (manifestByteLength as number) > MAX_CLI_OUTPUT_BYTES
  ) {
    throw new Error('Microfrontend build output has an invalid manifest byte length.')
  }

  return {
    outDir,
    packageName,
    target,
    files,
    warningCount: value.warnings.length,
    manifestDigest,
    manifestByteLength: manifestByteLength as number
  }
}
