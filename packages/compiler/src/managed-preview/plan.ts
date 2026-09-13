import type { BackendApplicationSpecV1 } from '@open-pencil/lowcode/backend'

import { digestCanonicalBackendValue } from '../backend/canonical'
import { planNestJSLocalPreviewMigration } from '../backend/nestjs/local-migration'
import { nestJSPreviewApplicationDigest } from '../backend/nestjs/preview-digest'
import { compileManagedGeneration, rawDigest } from './generation'
import type { ManagedPreviewConfig, ManagedPreviewPlan } from './protocol'

export interface ManagedSnapshot {
  readonly application: BackendApplicationSpecV1
  readonly config: ManagedPreviewConfig
}
export async function managedPlan(
  from: ManagedSnapshot | null,
  to: ManagedSnapshot
): Promise<ManagedPreviewPlan> {
  const toDigest = nestJSPreviewApplicationDigest(to.application)
  const fromDigest = from ? nestJSPreviewApplicationDigest(from.application) : null
  const files = compileManagedGeneration(to.application)
  let kind: ManagedPreviewPlan['kind'] = 'initial'
  let sql = files.get('migrations/001-initial.sql') ?? ''
  let summary = [
    'Initialize a new isolated PostgreSQL 16 database and install the pinned backend dependencies.'
  ]
  let diagnostics: ManagedPreviewPlan['diagnostics'] = []
  if (from) {
    const planned = await planNestJSLocalPreviewMigration({
      fromApplication: from.application,
      toApplication: to.application
    })
    if (!planned.ok) {
      kind = 'blocked'
      sql = ''
      summary = [
        'This model change requires a manual migration and cannot be applied by managed preview.'
      ]
      diagnostics = planned.diagnostics
    } else {
      kind = planned.plan.schemaChanged ? 'migration' : 'runtime'
      sql = planned.plan.sql
      summary = planned.plan.summary.length
        ? [...planned.plan.summary]
        : ['Rebuild and restart the managed API; the database schema is unchanged.']
    }
    if (from.config.dbPort !== to.config.dbPort) {
      kind = 'blocked'
      sql = ''
      summary = [
        'The owned database port cannot change after initialization. Create a separate managed session instead.'
      ]
      diagnostics = [
        {
          code: 'managed-preview-database-port-changed',
          severity: 'error',
          path: '$.config.dbPort',
          message: summary[0]
        }
      ]
    }
  }
  const planId = digestCanonicalBackendValue(
    {
      version: 1,
      scope: 'owned-managed-preview',
      fromDigest,
      toDigest,
      config: to.config,
      kind,
      sqlDigest: rawDigest(sql)
    },
    '$.managed.plan'
  )
  return Object.freeze({
    planId,
    kind,
    fromApplicationDigest: fromDigest,
    toApplicationDigest: toDigest,
    sql,
    summary,
    diagnostics,
    requiresApproval: kind === 'initial' || kind === 'migration'
  })
}
