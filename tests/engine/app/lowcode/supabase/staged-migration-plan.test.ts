import { describe, expect, test } from 'bun:test'

import { effectScope } from 'vue'

import {
  STAGED_MIGRATION_EXECUTION_FORMAT,
  type StagedMigrationExecutionPlanV1
} from '@open-pencil/lowcode/backend'
import { digestCanonicalManifest } from '@open-pencil/scene-graph'

import {
  MAX_SUPABASE_STAGED_MIGRATION_PLAN_BYTES,
  useSupabaseStagedMigrationPlan
} from '@/app/lowcode/supabase/staged-migration-plan'

async function plan(): Promise<StagedMigrationExecutionPlanV1> {
  return {
    format: STAGED_MIGRATION_EXECUTION_FORMAT,
    version: 1,
    executionId: 'execution:expand-title',
    changeId: 'change:title',
    sourceMigrationPlan: {
      version: 1,
      planId: 'migration:title',
      planDigest: await digestCanonicalManifest({ plan: 'title' }),
      fromModelDigest: await digestCanonicalManifest({ model: 'before' }),
      targetModelDigest: await digestCanonicalManifest({ model: 'after' })
    },
    phase: 'expand',
    predecessor: null,
    operations: [
      {
        operation: {
          id: 'staged:add-title',
          kind: 'add-nullable-field',
          sourceOperationIds: ['op-0001'],
          entityId: 'notes',
          field: { id: 'title', name: 'title', type: 'string', nullable: true }
        },
        risk: 'low'
      }
    ],
    highestRisk: 'low',
    requiresHumanApproval: false
  }
}

function selection(file: File): Event {
  const event = new Event('change')
  Object.defineProperty(event, 'currentTarget', {
    configurable: true,
    value: { files: { item: () => file } }
  })
  return event
}

describe('Supabase staged migration plan input', () => {
  test('accepts only a bounded, normalized, secret-free execution plan', async () => {
    let changed = 0
    const scope = effectScope()
    const controller = scope.run(() =>
      useSupabaseStagedMigrationPlan(() => {
        changed += 1
      })
    )
    if (!controller) throw new Error('Missing staged migration plan controller')

    const source = await plan()
    await controller.select(
      selection(
        new File([JSON.stringify(source)], 'expand-title.json', { type: 'application/json' })
      )
    )
    expect(controller.error.value).toBeNull()
    expect(controller.fileName.value).toBe('expand-title.json')
    expect(controller.plan.value).toEqual(source)
    expect(controller.plan.value).not.toBe(source)
    expect(changed).toBe(1)

    controller.clear()
    expect(controller.plan.value).toBeNull()
    expect(controller.fileName.value).toBe('')
    expect(changed).toBe(2)
    scope.stop()
  })

  test('rejects malformed, secret-bearing, and oversized inputs', async () => {
    const scope = effectScope()
    const controller = scope.run(() => useSupabaseStagedMigrationPlan(() => undefined))
    if (!controller) throw new Error('Missing staged migration plan controller')

    await controller.select(selection(new File(['{'], 'broken.json')))
    expect(controller.error.value).toBe('invalid-plan')
    expect(controller.plan.value).toBeNull()

    await controller.select(
      selection(
        new File([JSON.stringify({ ...(await plan()), secretValue: 'forbidden' })], 'x.json')
      )
    )
    expect(controller.error.value).toBe('invalid-plan')
    expect(controller.plan.value).toBeNull()

    const oversized = {
      name: 'oversized.json',
      size: MAX_SUPABASE_STAGED_MIGRATION_PLAN_BYTES + 1,
      text: async () => '{}'
    } as File
    await controller.select(selection(oversized))
    expect(controller.error.value).toBe('plan-too-large')
    scope.stop()
  })
})
