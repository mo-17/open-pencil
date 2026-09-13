import { describe, expect, test } from 'bun:test'

import { collectTree } from '#compiler/ir/collect/tree'

import type { BackendCommandRecoveryAction } from '@open-pencil/scene-graph'

import { compileBrowser, setSubmit } from '../helpers'
import { commandApplication, commandGraph } from './helpers'

function fixture(branch: 'onSuccess' | 'onError') {
  const value = commandGraph()
  value.graph.updateNode(value.graph.rootId, {
    lowcodeDocumentState: [
      ...(value.graph.getNode(value.graph.rootId)?.lowcodeDocumentState ?? []),
      { id: 'empty', name: 'emptyCommandResult', type: 'object', defaultValue: {} }
    ]
  })
  value.graph.updateNode(value.notes.id, {
    state: [{ id: 'copy', name: 'recoveredCopy', type: 'object', defaultValue: {} }]
  })
  const action: BackendCommandRecoveryAction = {
    id: 'inspect',
    kind: 'backendCommandRecovery',
    commandId: 'save-note',
    idempotencyKeyTarget: 'attempt',
    operation: 'inspect',
    [branch]: [
      {
        id: 'acknowledge',
        kind: 'backendCommandRecovery',
        commandId: 'save-note',
        idempotencyKeyTarget: 'attempt',
        operation: 'acknowledge',
        attemptKeyExpr: branch === 'onSuccess' ? 'data.key' : 'attempt',
        onSuccess: [
          {
            id: 'copy-empty',
            kind: 'setState',
            targetStateId: 'copy',
            valueExpr: 'emptyCommandResult'
          }
        ]
      }
    ]
  }
  setSubmit(value, action)
  return value
}

describe('document state referenced only inside recovery continuations', () => {
  test.each(['onSuccess', 'onError'] as const)(
    'retains a legal nested %s document-state read',
    (branch) => {
      const value = fixture(branch)
      const ir = collectTree(
        value.graph,
        value.notes.id,
        new Map(),
        false,
        {},
        new Map(),
        undefined,
        commandApplication()
      )
      expect(ir.docStateReads).toContain('emptyCommandResult')
      expect(ir.warnings.filter((warning) => /action-|backend-client/.test(warning.code))).toEqual(
        []
      )
      for (const target of ['react', 'vue'] as const) {
        const output = compileBrowser(target, value, commandApplication())
        const pages = [...output.files]
          .filter(([path]) => path.startsWith('src/pages/'))
          .map(([, source]) => String(source))
          .join('\n')
        expect(pages).toContain('emptyCommandResult')
        expect(
          output.warnings.filter((warning) => /action-|backend-client/.test(warning.code))
        ).toEqual([])
      }
    }
  )

  test('keeps the existing setVariable scope rule while accepting the acknowledgement data alias', () => {
    const value = fixture('onSuccess')
    const action: BackendCommandRecoveryAction = {
      id: 'ack',
      kind: 'backendCommandRecovery',
      commandId: 'save-note',
      idempotencyKeyTarget: 'attempt',
      operation: 'acknowledge',
      attemptKeyExpr: 'attempt',
      onSuccess: [
        { id: 'clear', kind: 'setVariable', targetName: 'result', valueExpr: 'emptyCommandResult' }
      ]
    }
    setSubmit(value, action)
    expect(compileBrowser('react', value, commandApplication()).warnings).toContainEqual(
      expect.objectContaining({
        code: 'action-setvariable-unknown-identifier'
      })
    )
    action.onSuccess = [
      { id: 'clear', kind: 'setVariable', targetName: 'result', valueExpr: 'data' }
    ]
    setSubmit(value, action)
    for (const target of ['react', 'vue'] as const)
      expect(
        compileBrowser(target, value, commandApplication()).warnings.filter((warning) =>
          /action-|backend-client/.test(warning.code)
        )
      ).toEqual([])
  })
})
