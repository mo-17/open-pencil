import { digestCanonicalBackendValue, freezeBackendValue } from '#compiler/backend/canonical'
import { sha256 } from '@noble/hashes/sha2'

import {
  parseBackendApplicationSpecV1,
  planBackendMigration,
  type BackendApplicationSpecV1,
  type BackendDiagnostic
} from '@open-pencil/lowcode/backend'

import { validateNestJSConnectedPreview } from '../connected-preview'
import {
  NESTJS_BACKEND_PROVIDER_COMPILER_BUNDLE_DIGEST,
  NESTJS_BACKEND_PROVIDER_DESCRIPTOR
} from '../descriptor'
import { nestJSPreviewApplicationDigest } from '../preview-digest'
import { localMigrationDiagnostic, validateLocalMigrationBoundary } from './boundary'
import { emitLocalMigrationOperation } from './sql'
import type {
  NestJSLocalPreviewMigrationInput,
  NestJSLocalPreviewMigrationOperation,
  NestJSLocalPreviewMigrationPlan,
  NestJSLocalPreviewMigrationResult
} from './types'

export type {
  NestJSLocalPreviewMigrationInput,
  NestJSLocalPreviewMigrationOperation,
  NestJSLocalPreviewMigrationPlan,
  NestJSLocalPreviewMigrationResult
} from './types'

const MAX_MIGRATION_SQL_BYTES = 256 * 1024

function readInput(value: unknown): NestJSLocalPreviewMigrationInput | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) return undefined
  const keys = Reflect.ownKeys(value)
  if (keys.length !== 2 || keys.some((key) => key !== 'fromApplication' && key !== 'toApplication'))
    return undefined
  const from = Object.getOwnPropertyDescriptor(value, 'fromApplication')
  const to = Object.getOwnPropertyDescriptor(value, 'toApplication')
  if (!from?.enumerable || !('value' in from) || !to?.enumerable || !('value' in to))
    return undefined
  return { fromApplication: from.value, toApplication: to.value }
}

function normalizeApplication(
  value: unknown,
  path: string
): { application?: BackendApplicationSpecV1; diagnostics: readonly BackendDiagnostic[] } {
  const parsed = parseBackendApplicationSpecV1(value)
  if (!parsed.ok)
    return {
      diagnostics: parsed.diagnostics.map((entry) => ({
        ...entry,
        path: path + entry.path.slice(1)
      }))
    }
  // Validation of the fixed compiler implementation only. The Host must separately resolve its live installed Provider.
  const validated = validateNestJSConnectedPreview({
    selection: {
      descriptor: NESTJS_BACKEND_PROVIDER_DESCRIPTOR,
      packageDigest: NESTJS_BACKEND_PROVIDER_COMPILER_BUNDLE_DIGEST,
      enabled: true
    },
    application: parsed.value,
    target: 'react',
    applicationDigest: nestJSPreviewApplicationDigest(parsed.value)
  })
  return validated.ok
    ? { application: validated.application, diagnostics: [] }
    : { diagnostics: validated.diagnostics }
}

/** Hashes the exact submitted SQL bytes, not a JSON wrapper around them. */
export function nestJSLocalPreviewMigrationSQLDigest(sql: string): string {
  let binary = ''
  for (const byte of sha256(new TextEncoder().encode(sql))) binary += String.fromCharCode(byte)
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '')
}

function buildPlan(
  from: BackendApplicationSpecV1,
  to: BackendApplicationSpecV1,
  fromModelDigest: string,
  toModelDigest: string,
  operations: readonly NestJSLocalPreviewMigrationOperation[]
): NestJSLocalPreviewMigrationPlan {
  const fromApplicationDigest = nestJSPreviewApplicationDigest(from)
  const toApplicationDigest = nestJSPreviewApplicationDigest(to)
  const schemaChanged = operations.length > 0
  const sql = schemaChanged
    ? 'SET LOCAL standard_conforming_strings = on;\n\n' +
      operations.map((entry) => entry.sql).join('\n\n') +
      '\n'
    : ''
  if (new TextEncoder().encode(sql).byteLength > MAX_MIGRATION_SQL_BYTES)
    throw new RangeError('Local migration SQL exceeds its bound.')
  const payload = {
    format: 'openpencil.nestjs-local-preview-migration' as const,
    version: 1 as const,
    scope: 'owned-local-preview' as const,
    planId:
      'local-migration:' +
      fromApplicationDigest.slice(0, 16) +
      ':' +
      toApplicationDigest.slice(0, 16),
    applicationId: from.applicationId,
    fromApplicationDigest,
    toApplicationDigest,
    fromModelDigest,
    toModelDigest,
    operations,
    summary: schemaChanged
      ? operations.map((entry) => entry.summary)
      : ['Database schema unchanged. Rebuild the local Backend runtime only.'],
    highestRisk: operations.some((entry) => entry.risk === 'medium')
      ? ('medium' as const)
      : ('low' as const),
    schemaChanged,
    requiresReview: schemaChanged,
    transactionRequired: true as const,
    sql,
    sqlDigest: nestJSLocalPreviewMigrationSQLDigest(sql)
  }
  return freezeBackendValue({
    ...payload,
    planDigest: digestCanonicalBackendValue(payload, '$.localMigrationPlan')
  }) as NestJSLocalPreviewMigrationPlan
}

/**
 * Pure planning for an already-owned local preview database. No SQL is executed and no release
 * gate is changed. The executor must replan, verify live schema/receipts under a lock, and apply
 * the exact reviewed SQL plus its new receipt in one transaction.
 */
export async function planNestJSLocalPreviewMigration(
  input: NestJSLocalPreviewMigrationInput
): Promise<NestJSLocalPreviewMigrationResult> {
  try {
    const data = readInput(input)
    if (!data)
      return {
        ok: false,
        diagnostics: [
          localMigrationDiagnostic(
            'input-invalid',
            '$',
            'Local migration input requires exactly two plain application fields.'
          )
        ]
      }
    return await planMigration(data)
  } catch {
    return {
      ok: false,
      diagnostics: [
        localMigrationDiagnostic(
          'plan-unavailable',
          '$',
          'Invalid or oversized local migration could not produce a bounded plan. No SQL was produced.'
        )
      ]
    }
  }
}

async function planMigration(
  input: NestJSLocalPreviewMigrationInput
): Promise<NestJSLocalPreviewMigrationResult> {
  const from = normalizeApplication(input.fromApplication, '$.fromApplication')
  const to = normalizeApplication(input.toApplication, '$.toApplication')
  if (!from.application || !to.application)
    return { ok: false, diagnostics: [...from.diagnostics, ...to.diagnostics] }
  const diagnostics = validateLocalMigrationBoundary(from.application, to.application)
  if (diagnostics.length > 0) return { ok: false, diagnostics }
  const shared = await planBackendMigration(from.application.dataModel, to.application.dataModel)
  const operations: NestJSLocalPreviewMigrationOperation[] = []
  for (const entry of shared.operations) {
    const emitted = emitLocalMigrationOperation(entry.operation, from.application, to.application)
    if (emitted) operations.push(emitted)
    else
      diagnostics.push(
        localMigrationDiagnostic(
          'operation-blocked',
          '$.operations.' + entry.operation.id,
          'Local preview does not automatically execute ' +
            entry.operation.kind +
            '. Existing data is preserved; use a separately reviewed migration.'
        )
      )
  }
  if (diagnostics.length > 0) return { ok: false, diagnostics }
  if (!shared.fromModelDigest)
    throw new Error('Local migration requires an exact source model digest.')
  return {
    ok: true,
    plan: buildPlan(
      from.application,
      to.application,
      shared.fromModelDigest,
      shared.targetModelDigest,
      operations
    )
  }
}
