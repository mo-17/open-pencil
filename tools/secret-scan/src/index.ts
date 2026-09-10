import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { isIgnoredUntrackedFinding, parseGitleaksFindingPaths } from './policy'
import {
  captureWorkingTreeAuthority,
  createWorkingTreeSnapshot,
  materializeIndexBlobSnapshot,
  parseCommitEligiblePaths,
  parseGitBatchBlobs,
  parseGitBatchCheck,
  parseIndexEntries,
  uniqueIndexBlobIDs,
  workingTreeAuthorityEquals,
  type IndexEntry,
  type WorkingPathAuthority
} from './snapshot'

const GITLEAKS_VERSION = 'v8.30.1'
const GITLEAKS_MODULE = 'github.com/zricethezav/gitleaks/v8@' + GITLEAKS_VERSION
const GITLEAKS_FINDINGS_EXIT_CODE = 7
const MAX_GIT_INDEX_OUTPUT_BYTES = 32 * 1024 * 1024
const MAX_REPORT_BYTES = 5 * 1024 * 1024
const CONFIG_PATHS = ['.gitleaks.toml', '.gitleaks.local.toml'] as const

function run(
  command: string,
  args: string[],
  stdio: 'inherit' | 'pipe' = 'inherit',
  stdin?: Uint8Array
): Bun.SpawnSyncReturns<Buffer> | null {
  try {
    return Bun.spawnSync([command, ...args], {
      stdout: stdio,
      stderr: stdio,
      stdin
    })
  } catch (error) {
    if (error instanceof Error && Reflect.get(error, 'code') === 'ENOENT') return null
    throw error
  }
}

function runGitleaks(args: string[]): Bun.SpawnSyncReturns<Buffer> | null {
  return run('gitleaks', args) ?? run('go', ['run', GITLEAKS_MODULE, ...args])
}

function gitBoolean(args: string[]): boolean | null {
  const result = run('git', args, 'pipe')
  if (result?.exitCode === 0) return true
  if (result?.exitCode === 1) return false
  return null
}

function gitBuffer(args: string[], maxBytes: number): Buffer | null {
  const result = run('git', args, 'pipe')
  if (!result?.success || result.stdout.byteLength > maxBytes) return null
  return result.stdout
}

function repositoryRoot(): string | null {
  const result = run('git', ['rev-parse', '--show-toplevel'], 'pipe')
  if (!result?.success) return null
  const root = result.stdout.toString().trim()
  if (root.length === 0 || resolve(root) !== resolve(process.cwd())) return null
  return root
}

interface SecretScanOutcome {
  ignoredLocalFindings: number
  success: boolean
}

interface CommitSnapshotAuthority {
  config: WorkingPathAuthority[]
  index: Buffer
  paths: Buffer
  working: WorkingPathAuthority[]
  workingPaths: string[]
}

function readIndexBlobs(entries: readonly IndexEntry[]): Map<string, Uint8Array> | null {
  const objectIDs = uniqueIndexBlobIDs(entries)
  if (objectIDs.length === 0) return new Map()

  const input = Buffer.from(objectIDs.join('\n') + '\n')
  const checked = run('git', ['cat-file', '--batch-check'], 'pipe', input)
  if (!checked?.success) return null
  const sizes = parseGitBatchCheck(objectIDs, checked.stdout)
  if (sizes === null) return null

  const loaded = run('git', ['cat-file', '--batch'], 'pipe', input)
  return loaded?.success ? parseGitBatchBlobs(objectIDs, sizes, loaded.stdout) : null
}

function prepareCommitSnapshots(
  root: string,
  indexSnapshotRoot: string,
  workingSnapshotRoot: string,
  configSnapshotRoot: string
): CommitSnapshotAuthority | null {
  const index = gitBuffer(['ls-files', '--stage', '-z'], MAX_GIT_INDEX_OUTPUT_BYTES)
  const paths = gitBuffer(
    ['ls-files', '-z', '--cached', '--others', '--exclude-standard', '--', '.'],
    MAX_GIT_INDEX_OUTPUT_BYTES
  )
  if (index === null || paths === null) return null

  const commitEligiblePaths = parseCommitEligiblePaths(root, paths)
  const indexEntries = parseIndexEntries(root, index)
  if (commitEligiblePaths === null || indexEntries === null) return null
  const indexBlobs = readIndexBlobs(indexEntries)
  if (indexBlobs === null) return null

  mkdirSync(indexSnapshotRoot, { recursive: true, mode: 0o700 })
  mkdirSync(workingSnapshotRoot, { recursive: true, mode: 0o700 })
  mkdirSync(configSnapshotRoot, { recursive: true, mode: 0o700 })
  if (!materializeIndexBlobSnapshot(indexSnapshotRoot, indexEntries, indexBlobs)) return null

  const working = createWorkingTreeSnapshot(root, workingSnapshotRoot, commitEligiblePaths)
  const config = createWorkingTreeSnapshot(root, configSnapshotRoot, CONFIG_PATHS)
  if (working === null || config === null) return null
  return {
    config,
    index,
    paths,
    working,
    workingPaths: commitEligiblePaths
  }
}

function snapshotAuthorityIsCurrent(root: string, authority: CommitSnapshotAuthority): boolean {
  const index = gitBuffer(['ls-files', '--stage', '-z'], MAX_GIT_INDEX_OUTPUT_BYTES)
  const paths = gitBuffer(
    ['ls-files', '-z', '--cached', '--others', '--exclude-standard', '--', '.'],
    MAX_GIT_INDEX_OUTPUT_BYTES
  )
  const working = captureWorkingTreeAuthority(root, authority.workingPaths)
  const config = captureWorkingTreeAuthority(root, CONFIG_PATHS)
  return (
    index !== null &&
    paths !== null &&
    working !== null &&
    config !== null &&
    index.equals(authority.index) &&
    paths.equals(authority.paths) &&
    workingTreeAuthorityEquals(working, authority.working) &&
    workingTreeAuthorityEquals(config, authority.config)
  )
}

function strictDirectoryScan(configPath: string, target: string): boolean {
  const proc = runGitleaks([
    'dir',
    '--config',
    configPath,
    '--redact',
    '--no-banner',
    '--exit-code',
    String(GITLEAKS_FINDINGS_EXIT_CODE),
    target
  ])
  return proc?.success === true
}

function localDirectoryScan(
  root: string,
  configPath: string,
  reportPath: string
): SecretScanOutcome {
  const proc = runGitleaks([
    'dir',
    '--config',
    configPath,
    '--redact',
    '--no-banner',
    '--exit-code',
    String(GITLEAKS_FINDINGS_EXIT_CODE),
    '--report-format',
    'json',
    '--report-path',
    reportPath,
    '.'
  ])
  if (proc?.success) return { ignoredLocalFindings: 0, success: true }
  if (
    proc?.exitCode !== GITLEAKS_FINDINGS_EXIT_CODE ||
    !existsSync(reportPath) ||
    statSync(reportPath).size > MAX_REPORT_BYTES
  ) {
    return { ignoredLocalFindings: 0, success: false }
  }

  const findingPaths = parseGitleaksFindingPaths(readFileSync(reportPath, 'utf8'))
  if (
    findingPaths === null ||
    !findingPaths.every((path) =>
      isIgnoredUntrackedFinding(root, path, {
        exists: (candidate) => existsSync(resolve(root, candidate)),
        isIgnored: (candidate) => gitBoolean(['check-ignore', '-q', '--', candidate]),
        isTracked: (candidate) => gitBoolean(['ls-files', '--error-unmatch', '--', candidate])
      })
    )
  ) {
    return { ignoredLocalFindings: 0, success: false }
  }
  return { ignoredLocalFindings: findingPaths.length, success: true }
}

function executeSecretScan(): SecretScanOutcome {
  const root = repositoryRoot()
  if (root === null) return { ignoredLocalFindings: 0, success: false }

  const temporaryRoot = mkdtempSync(join(tmpdir(), 'open-pencil-gitleaks-'))
  const indexSnapshotRoot = join(temporaryRoot, 'index')
  const workingSnapshotRoot = join(temporaryRoot, 'working')
  const configSnapshotRoot = join(temporaryRoot, 'config')
  const reportPath = join(temporaryRoot, 'local-report.json')
  let outcome: SecretScanOutcome = { ignoredLocalFindings: 0, success: false }
  let cleanupSucceeded = false

  try {
    const authority = prepareCommitSnapshots(
      root,
      indexSnapshotRoot,
      workingSnapshotRoot,
      configSnapshotRoot
    )
    const localConfigPath = join(configSnapshotRoot, '.gitleaks.local.toml')
    const strictConfigPaths = [
      join(indexSnapshotRoot, '.gitleaks.toml'),
      join(workingSnapshotRoot, '.gitleaks.toml')
    ]
    const strictSnapshotRoots = [indexSnapshotRoot, workingSnapshotRoot]
    if (
      authority !== null &&
      strictConfigPaths.every((configPath) =>
        strictSnapshotRoots.every((snapshotRoot) => strictDirectoryScan(configPath, snapshotRoot))
      )
    ) {
      const localOutcome = localDirectoryScan(root, localConfigPath, reportPath)
      if (localOutcome.success && snapshotAuthorityIsCurrent(root, authority))
        outcome = localOutcome
    }
  } catch {
    outcome = { ignoredLocalFindings: 0, success: false }
  } finally {
    try {
      rmSync(temporaryRoot, { force: true, recursive: true })
      cleanupSucceeded = true
    } catch {
      cleanupSucceeded = false
    }
  }

  return cleanupSucceeded ? outcome : { ignoredLocalFindings: 0, success: false }
}

const outcome = executeSecretScan()
if (!outcome.success) {
  console.error('Secret scan failed.')
  process.exit(1)
}
if (outcome.ignoredLocalFindings > 0) {
  console.warn(
    'Ignored ' +
      outcome.ignoredLocalFindings +
      ' finding(s) confined to Git-ignored, untracked local files.'
  )
}
console.log('Secret scan passed.')
