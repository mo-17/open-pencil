import { describe, expect, test } from 'bun:test'

import {
  eventUsesRequestGate,
  eventUsesRequestDebounce
} from '#compiler/adapters/react/request-timing'
import { substituteHandler } from '#compiler/ir/collect/substitute'

import { emitExpression, parseExpression, type ExprAst } from '@open-pencil/lowcode'

import { compileBrowser, setSubmit } from '../helpers'
import { commandAction, commandApplication, commandGraph } from './helpers'

function expression(value: string): ExprAst {
  const parsed = parseExpression(value)
  if (!parsed.ok) throw new Error('Invalid test expression')
  return parsed.ast
}

describe('atomic command compilation', () => {
  test.each(['react', 'vue'] as const)(
    'emits %s command action with result branches and a durable in-session key',
    (target) => {
      const output = compileBrowser(target, commandGraph(), commandApplication())
      const pages = [...output.files]
        .filter(([path]) => /src\/pages\//.test(path))
        .map(([, content]) => String(content))
        .join('\n')
      expect(pages).toContain('.backendCommand(__opBackendInput)')
      expect(pages).toContain('commandId: "save-note"')
      expect(pages).toContain('idempotencyKeyTarget: "attempt"')
      expect(pages).toContain('.commandError(')
      expect(pages).toContain('error.code')
      expect(output.files.get('src/lowcode-backend-api.ts')).toContain('commands: {')
      expect(
        output.warnings.filter((warning) => /backend|binding|unsupported|scope/u.test(warning.code))
      ).toEqual([])
    }
  )
  test('commands run immediately behind submit gates and never join read debounce', () => {
    const command = {
      kind: 'backendCommand' as const,
      commandId: 'save-note',
      idempotencyKeyTarget: 'attempt'
    }
    const read = {
      kind: 'backendRequest' as const,
      resourceId: 'notes-api',
      operation: 'list' as const
    }
    expect(eventUsesRequestGate('onSubmit', [command])).toBe(true)
    expect(eventUsesRequestDebounce('onChange', [command])).toBe(false)
    expect(eventUsesRequestDebounce('onChange', [{ ...read, onSuccess: [command] }])).toBe(false)
  })

  test('rejects unknown command expression identifiers before generation', () => {
    const fixture = commandGraph()
    setSubmit(fixture, {
      ...commandAction(),
      payloadEntries: [{ key: 'title', valueExpr: 'undeclaredTitle' }]
    })
    expect(() => compileBrowser('react', fixture, commandApplication())).toThrow(
      'backend-client-binding-invalid'
    )
  })
  test('substitutes workflow parameters and preserves nested command continuations', () => {
    const handler = substituteHandler(
      {
        kind: 'backendCommand',
        commandId: 'save-note',
        idempotencyKeyTarget: 'attempt',
        payloadEntries: [{ key: 'title', ast: expression('parameter'), references: ['parameter'] }],
        onSuccess: [
          {
            kind: 'backendCommand',
            commandId: 'save-note',
            idempotencyKeyTarget: 'nestedAttempt',
            payloadEntries: [
              { key: 'title', ast: expression('parameter'), references: ['parameter'] }
            ]
          }
        ]
      },
      new Map([['parameter', expression('title')]])
    )
    if (handler.kind !== 'backendCommand') throw new Error('Unexpected handler')
    expect(handler.payloadEntries?.[0].references).toEqual(['title'])
    expect(handler.payloadEntries && emitExpression(handler.payloadEntries[0].ast)).toBe('title')
    const nested = handler.onSuccess?.[0]
    expect(nested?.kind === 'backendCommand' && nested.payloadEntries?.[0].references).toEqual([
      'title'
    ])
  })
})
