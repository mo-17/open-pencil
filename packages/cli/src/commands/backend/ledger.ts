import { createHash } from 'node:crypto'
import { lstat, mkdir, readFile, realpath, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path'

import { defineCommand } from 'citty'

import {
  BACKEND_LIMITS,
  createSourceMigrationLedger,
  digestSourceMigrationLedger,
  transitionSourceMigrationLedger,
  verifySourceMigrationLedgerIntegrity,
  type SourceMigrationLedgerV1
} from '@open-pencil/lowcode/backend'

import { readBoundedJSON } from '#cli/commands/bounded-input'
import { bold, fmtList, ok } from '#cli/format'

import { jsonArg, runBackendCommandSafely } from './common'

const LEDGER_ID = /^[A-Za-z0-9](?:[A-Za-z0-9._:-]{0,126}[A-Za-z0-9])?$/u
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u
const LEDGER_MAX_BYTES = BACKEND_LIMITS.maxCanonicalBytes
const SOURCE_MIGRATION_MAX_BYTES = BACKEND_LIMITS.maxCanonicalBytes

const ledgerArg = {
  type: 'positional',
  required: true,
  description: 'SourceMigrationLedgerV1 JSON path'
} as const

const outputArg = {
  type: 'string',
  alias: 'o',
  required: true,
  description: 'New ledger JSON path; an existing path is never overwritten'
} as const

const sourceRootArg = {
  type: 'string',
  required: true,
  description: 'Repository root used to verify every source migration SQL digest'
} as const

interface SourceFileVerification {
  readonly sourceFileCount: number
  readonly sourceFileBytes: number
}

function printLedgerReport(title: string, report: Record<string, unknown>, json: boolean): void {
  if (json) {
    console.log(JSON.stringify(report, null, 2))
    return
  }
  console.log('')
  console.log(bold(`  ${title}`))
  console.log('')
  console.log(fmtList([{ header: ok(title), details: report }]))
  console.log('')
}

async function loadLedger(path: string): Promise<SourceMigrationLedgerV1> {
  const source = await readBoundedJSON(path, LEDGER_MAX_BYTES, 'Source migration ledger')
  const verified = await verifySourceMigrationLedgerIntegrity(source)
  if (!verified.ok) {
    throw new Error(
      `Source migration ledger failed closed: ${verified.diagnostics
        .map((entry) => `${entry.code} (${entry.path})`)
        .join(', ')}`
    )
  }
  return verified.value
}

function sourcePathWithinRoot(root: string, path: string): string {
  const destination = resolve(root, path)
  const relativePath = relative(root, destination)
  if (
    relativePath === '' ||
    relativePath === '..' ||
    relativePath.startsWith(`..${sep}`) ||
    isAbsolute(relativePath)
  ) {
    throw new Error(`Source migration path escapes --source-root: ${path}.`)
  }
  return destination
}

async function canonicalSourceRoot(path: string): Promise<string> {
  const requested = resolve(path)
  let info: Awaited<ReturnType<typeof lstat>>
  try {
    info = await lstat(requested)
  } catch {
    throw new Error('--source-root must identify an accessible directory.')
  }
  if (info.isSymbolicLink() || !info.isDirectory()) {
    throw new Error('--source-root must identify a real directory and must not be a symbolic link.')
  }
  return realpath(requested)
}

async function verifySourceFiles(
  ledger: SourceMigrationLedgerV1,
  sourceRoot: string
): Promise<SourceFileVerification> {
  const root = await canonicalSourceRoot(sourceRoot)
  const seenPaths = new Set<string>()
  let sourceFileBytes = 0
  for (const entry of ledger.entries) {
    const sourcePath = entry.source.path
    if (seenPaths.has(sourcePath)) {
      throw new Error(`Source migration path is duplicated: ${sourcePath}.`)
    }
    seenPaths.add(sourcePath)
    const destination = sourcePathWithinRoot(root, sourcePath)
    let canonicalDestination: string
    let info: Awaited<ReturnType<typeof lstat>>
    try {
      ;[canonicalDestination, info] = await Promise.all([realpath(destination), lstat(destination)])
    } catch {
      throw new Error(`Source migration file is missing or inaccessible: ${sourcePath}.`)
    }
    if (info.isSymbolicLink() || canonicalDestination !== destination) {
      throw new Error(`Source migration file path must not contain symbolic links: ${sourcePath}.`)
    }
    if (!info.isFile()) {
      throw new Error(`Source migration path must identify a regular file: ${sourcePath}.`)
    }
    if (info.size > SOURCE_MIGRATION_MAX_BYTES) {
      throw new Error(
        `Source migration file may not exceed ${SOURCE_MIGRATION_MAX_BYTES} bytes: ${sourcePath}.`
      )
    }
    const bytes = new Uint8Array(await readFile(destination))
    if (bytes.byteLength > SOURCE_MIGRATION_MAX_BYTES) {
      throw new Error(
        `Source migration file may not exceed ${SOURCE_MIGRATION_MAX_BYTES} bytes: ${sourcePath}.`
      )
    }
    const actualDigest = createHash('sha256').update(bytes).digest('base64url')
    if (actualDigest !== entry.source.digest) {
      throw new Error(`Source migration file digest does not match the ledger: ${sourcePath}.`)
    }
    sourceFileBytes += bytes.byteLength
  }
  return { sourceFileCount: seenPaths.size, sourceFileBytes }
}

async function writeNewLedger(path: string, ledger: SourceMigrationLedgerV1): Promise<string> {
  const destination = resolve(path)
  const content = `${JSON.stringify(ledger, null, 2)}\n`
  if (new TextEncoder().encode(content).byteLength > LEDGER_MAX_BYTES) {
    throw new Error(`Source migration ledger may not exceed ${LEDGER_MAX_BYTES} bytes.`)
  }
  await mkdir(dirname(destination), { recursive: true })
  try {
    await writeFile(destination, content, { encoding: 'utf8', flag: 'wx' })
  } catch (cause) {
    if (cause && typeof cause === 'object' && Reflect.get(cause, 'code') === 'EEXIST') {
      throw new Error('Source migration ledger output already exists and is never overwritten.')
    }
    throw cause
  }
  return destination
}

function environmentSummary(ledger: SourceMigrationLedgerV1) {
  return ledger.environments.map((environment) => ({
    environment: environment.environment,
    providerId: environment.targetAuthority?.providerId ?? null,
    providerAuthorityDigest: environment.targetAuthority?.providerAuthorityDigest ?? null,
    projectRef: environment.targetAuthority?.projectRef ?? null,
    accountId: environment.targetAuthority?.accountId ?? null,
    grantGeneration: environment.targetAuthority?.grantGeneration ?? null,
    appliedMigrationIds: environment.appliedMigrationIds,
    schemaDigest: environment.schemaDigest,
    drift: environment.drift
  }))
}

async function ledgerReport(
  operation: 'init' | 'inspect' | 'transition',
  ledger: SourceMigrationLedgerV1,
  output: string | null,
  eventType: string | null,
  sourceVerification: SourceFileVerification | null
): Promise<Record<string, unknown>> {
  return {
    format: `openpencil.backend-cli-ledger-${operation}.v1`,
    version: 1,
    operation,
    ledgerId: ledger.ledgerId,
    ledgerDigest: await digestSourceMigrationLedger(ledger),
    updatedAt: ledger.updatedAt,
    entries: ledger.entries.length,
    promotions: ledger.promotions.length,
    driftRecords: ledger.driftRecords.length,
    recoveryRecords: ledger.recoveryRecords.length,
    authorityRebindings: ledger.authorityRebindings.length,
    environments: environmentSummary(ledger),
    eventType,
    output,
    sourceFilesVerified: sourceVerification !== null,
    sourceFileCount: sourceVerification?.sourceFileCount ?? 0,
    sourceFileBytes: sourceVerification?.sourceFileBytes ?? 0,
    networkPerformed: false,
    applyPerformed: false,
    deployPerformed: false
  }
}

const init = defineCommand({
  meta: { description: 'Create an empty, source-controlled migration ledger locally' },
  args: {
    'ledger-id': {
      type: 'string',
      required: true,
      description: 'Stable project-scoped ledger id'
    },
    'created-at': {
      type: 'string',
      required: true,
      description: 'Canonical UTC timestamp, for example 2026-09-04T00:00:00.000Z'
    },
    output: outputArg,
    json: jsonArg
  },
  async run({ args }) {
    await runBackendCommandSafely(async () => {
      if (!LEDGER_ID.test(args['ledger-id'])) {
        throw new Error('--ledger-id must be a bounded source migration ledger identifier.')
      }
      if (!TIMESTAMP.test(args['created-at'])) {
        throw new Error('--created-at must be a canonical UTC timestamp with milliseconds.')
      }
      const ledger = createSourceMigrationLedger({
        ledgerId: args['ledger-id'],
        createdAt: args['created-at']
      })
      const output = await writeNewLedger(args.output, ledger)
      printLedgerReport(
        'Initialized source migration ledger',
        await ledgerReport('init', ledger, output, null, null),
        args.json
      )
    })
  }
})

const inspect = defineCommand({
  meta: { description: 'Verify and summarize a source migration ledger without network access' },
  args: { ledger: ledgerArg, 'source-root': sourceRootArg, json: jsonArg },
  async run({ args }) {
    await runBackendCommandSafely(async () => {
      const ledger = await loadLedger(args.ledger)
      const sourceVerification = await verifySourceFiles(ledger, args['source-root'])
      printLedgerReport(
        'Verified source migration ledger',
        await ledgerReport('inspect', ledger, null, null, sourceVerification),
        args.json
      )
    })
  }
})

const transition = defineCommand({
  meta: {
    description:
      'Append one validated registration, promotion, drift, rollback, restore, or authority rebind event locally'
  },
  args: {
    ledger: ledgerArg,
    event: {
      type: 'string',
      required: true,
      description: 'Secret-free SourceMigrationLedgerEventV1 JSON path'
    },
    'source-root': sourceRootArg,
    output: outputArg,
    json: jsonArg
  },
  async run({ args }) {
    await runBackendCommandSafely(async () => {
      const [ledger, event] = await Promise.all([
        loadLedger(args.ledger),
        readBoundedJSON(args.event, LEDGER_MAX_BYTES, 'Source migration ledger event')
      ])
      const next = await transitionSourceMigrationLedger(ledger, event)
      const sourceVerification = await verifySourceFiles(next, args['source-root'])
      const output = await writeNewLedger(args.output, next)
      const eventType =
        event && typeof event === 'object' && typeof Reflect.get(event, 'type') === 'string'
          ? String(Reflect.get(event, 'type'))
          : null
      printLedgerReport(
        'Transitioned source migration ledger',
        await ledgerReport('transition', next, output, eventType, sourceVerification),
        args.json
      )
    })
  }
})

export default defineCommand({
  meta: {
    description:
      'Manage source-controlled Backend migration history without network, Apply, or Deploy'
  },
  subCommands: { init, inspect, transition }
})
