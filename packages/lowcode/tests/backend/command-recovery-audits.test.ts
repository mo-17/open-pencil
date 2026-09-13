import { describe, expect, test } from 'bun:test'

import { auditLowcodeNavigation, collectRlsRequirements } from '@open-pencil/lowcode'
import { auditApplicationRuntime } from '@open-pencil/lowcode/application-runtime'
import { lowerLegacySupabaseApplication } from '@open-pencil/lowcode/backend'
import { SceneGraph, type BackendCommandRecoveryAction } from '@open-pencil/scene-graph'

function fixture(branch: 'onSuccess' | 'onError') {
  const graph = new SceneGraph()
  const recovery: BackendCommandRecoveryAction = {
    id: 'recover',
    kind: 'backendCommandRecovery',
    commandId: 'checkout',
    idempotencyKeyTarget: 'attempt',
    operation: 'inspect',
    [branch]: [
      {
        id: 'nested-recovery',
        kind: 'backendCommandRecovery',
        commandId: 'checkout',
        idempotencyKeyTarget: 'attempt',
        operation: 'retry',
        attemptKeyExpr: 'recovery.key',
        onSuccess: [
          { id: 'read', kind: 'supabaseQuery', table: 'private_orders', resultTarget: 'orders' }
        ],
        onError: [{ id: 'missing-route', kind: 'navigate', to: '/missing-recovery-route' }]
      }
    ]
  }
  graph.createNode('BUTTON', graph.getPages()[0].id, { events: { onClick: [recovery] } })
  return { graph, recovery }
}

describe('command recovery branches remain visible to existing audits', () => {
  test.each(['onSuccess', 'onError'] as const)(
    'checks nested %s navigation and data access',
    (branch) => {
      const { graph, recovery } = fixture(branch)
      expect(auditLowcodeNavigation(graph).issues.map((entry) => entry.code)).toContain(
        'navigate-target-missing'
      )
      expect(collectRlsRequirements([recovery])).toMatchObject([
        { table: 'private_orders', commands: ['SELECT'] }
      ])
      const runtime = auditApplicationRuntime(graph)
      expect(runtime.usesSupabase).toBe(true)
      expect(runtime.ready).toBe(false)
      expect(runtime.issues.map((entry) => entry.code)).toContain('supabase-config-required')
      const lowered = lowerLegacySupabaseApplication(graph)
      expect(lowered.spec.dataModel.entities.some((entry) => entry.name === 'private_orders')).toBe(
        true
      )
      expect(lowered.spec.capabilities.map((entry) => entry.capability)).toContain('data.read')
    }
  )
})
