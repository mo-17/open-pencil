import type { BackendDiagnostic } from '@open-pencil/lowcode/backend'

export interface NestJSLocalPreviewMigrationInput {
  readonly fromApplication: unknown
  readonly toApplication: unknown
}

export interface NestJSLocalPreviewMigrationOperation {
  readonly id: string
  readonly kind: 'create-entity' | 'rename-entity' | 'add-field' | 'rename-field'
  readonly entityId: string
  readonly fieldId?: string
  readonly summary: string
  readonly risk: 'low' | 'medium'
  readonly sql: string
}

/** A compatibility plan for an owned local database, never a production release receipt. */
export interface NestJSLocalPreviewMigrationPlan {
  readonly format: 'openpencil.nestjs-local-preview-migration'
  readonly version: 1
  readonly scope: 'owned-local-preview'
  readonly planId: string
  readonly applicationId: string
  readonly fromApplicationDigest: string
  readonly toApplicationDigest: string
  readonly fromModelDigest: string
  readonly toModelDigest: string
  readonly operations: readonly NestJSLocalPreviewMigrationOperation[]
  readonly summary: readonly string[]
  readonly highestRisk: 'low' | 'medium'
  readonly schemaChanged: boolean
  readonly requiresReview: boolean
  readonly transactionRequired: true
  /** Exact SQL body; the host must own BEGIN, locking, live schema verification and receipt CAS. */
  readonly sql: string
  /** Raw UTF-8 SQL SHA-256, canonical base64url without a prefix. */
  readonly sqlDigest: string
  /** Canonical digest of every other plan field. Not execution authority. */
  readonly planDigest: string
}

export type NestJSLocalPreviewMigrationResult =
  | Readonly<{ ok: true; plan: NestJSLocalPreviewMigrationPlan }>
  | Readonly<{ ok: false; diagnostics: readonly BackendDiagnostic[] }>
