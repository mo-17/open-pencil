import { describe, expect, test } from 'bun:test'

import { emitBackendClientEvent } from '#compiler/adapters/backend-client/events'
import {
  eventUsesRequestGate,
  eventUsesRequestDebounce
} from '#compiler/adapters/react/request-timing'
import { substituteHandler } from '#compiler/ir/collect/substitute'
import type { IRBackendCommandRecoveryHandler } from '#compiler/ir/types'

import { emitExpression, parseExpression } from '@open-pencil/lowcode'
import type { BackendCommandRecoveryAction } from '@open-pencil/scene-graph'

import { compileBrowser, setSubmit } from '../helpers'
import { commandAction, commandApplication, commandGraph } from './helpers'

function expression(source: string) {
  const parsed = parseExpression(source)
  if (!parsed.ok) throw new Error('Invalid test expression')
  return parsed.ast
}

function recovery(): BackendCommandRecoveryAction {
  return {
    id: 'recover',
    kind: 'backendCommandRecovery',
    commandId: 'save-note',
    idempotencyKeyTarget: 'attempt',
    operation: 'inspect',
    resultTarget: 'result',
    errorTarget: 'error',
    onSuccess: [
      {
        id: 'retry-saved',
        kind: 'backendCommandRecovery',
        commandId: 'save-note',
        idempotencyKeyTarget: 'attempt',
        operation: 'retry',
        attemptKeyExpr: 'data.key',
        resultTarget: 'result'
      }
    ]
  }
}

describe('explicit command recovery compilation', () => {
  test.each(['react', 'vue'] as const)(
    '%s preserves the browser opt-in, saved key and nested result branches',
    (target) => {
      const fixture = commandGraph()
      const inspect = recovery()
      setSubmit(fixture, {
        ...commandAction(),
        recovery: 'browser',
        onSuccess: [inspect]
      })
      const output = compileBrowser(target, fixture, commandApplication())
      const pages = [...output.files]
        .filter(([path]) => path.startsWith('src/pages/'))
        .map(([, content]) => String(content))
        .join('\n')
      expect(pages).toContain('recovery: "browser"')
      expect(pages).toContain('operation: "inspect"')
      expect(pages).toContain('operation: "retry", attemptKey: String(data.key)')
      expect(pages).toContain('.backendCommandRecovery(__opBackendInput)')
      expect(output.warnings).toEqual([])
    }
  )

  test('unknown saved-key identifiers fail compilation instead of emitting an unsafe retry', () => {
    const fixture = commandGraph()
    setSubmit(fixture, {
      ...recovery(),
      operation: 'retry',
      attemptKeyExpr: 'missingAttempt.key',
      onSuccess: []
    })
    expect(() => compileBrowser('react', fixture, commandApplication())).toThrow(
      'backend-client-binding-invalid'
    )
  })

  test('saved-key workflow parameters are substituted through nested recovery branches', () => {
    const handler: IRBackendCommandRecoveryHandler = {
      kind: 'backendCommandRecovery',
      commandId: 'save-note',
      idempotencyKeyTarget: 'attempt',
      operation: 'retry',
      attemptKeyAst: expression('savedKey')
    }
    const substituted = substituteHandler(
      { ...handler, onError: [handler] },
      new Map([['savedKey', expression('result.key')]])
    )
    if (substituted.kind !== 'backendCommandRecovery' || !substituted.attemptKeyAst)
      throw new Error('Recovery handler was lost')
    expect(emitExpression(substituted.attemptKeyAst)).toBe('result.key')
    const nested = substituted.onError?.[0]
    expect(
      nested?.kind === 'backendCommandRecovery' &&
        nested.attemptKeyAst &&
        emitExpression(nested.attemptKeyAst)
    ).toBe('result.key')
    expect(eventUsesRequestGate('onSubmit', [substituted])).toBe(true)
    expect(eventUsesRequestDebounce('onChange', [substituted])).toBe(false)
  })

  test('emitted retry captures parent data before its own data binding and suppresses stale writes', async () => {
    const handler: IRBackendCommandRecoveryHandler = {
      kind: 'backendCommandRecovery',
      commandId: 'save-note',
      idempotencyKeyTarget: 'attempt',
      operation: 'retry',
      attemptKeyAst: expression('data.key'),
      resultTarget: 'result',
      onSuccess: []
    }
    const code = emitBackendClientEvent(handler, {
      expression: emitExpression,
      statements: () => 'host.continued = true;',
      request: 'unused',
      auth: 'host'
    })
    const javascript = new Bun.Transpiler({ loader: 'ts' }).transformSync(
      `export async function run(host, data) { ${code} }`
    )
    const { run } = (await import(
      'data:text/javascript;base64,' + Buffer.from(javascript).toString('base64')
    )) as RecoveryEventModule
    const current = eventHost(false)
    await run(current, { key: 'saved-attempt-key' })
    expect(current.inputs).toEqual([
      {
        commandId: 'save-note',
        operation: 'retry',
        attemptKey: 'saved-attempt-key',
        idempotencyKeyTarget: 'attempt'
      }
    ])
    expect(current.writes).toHaveLength(1)
    expect(current.continued).toBe(true)
    const stale = eventHost(true)
    await run(stale, { key: 'saved-attempt-key' })
    expect(stale.writes).toEqual([])
    expect(stale.continued).toBe(false)
  })
})

interface RecoveryEventModule {
  run: (host: ReturnType<typeof eventHost>, data: { key: string }) => Promise<void>
}

function eventHost(changeIdentity: boolean) {
  let generation = 1
  return {
    inputs: [] as object[],
    writes: [] as unknown[][],
    continued: false,
    getSession: () => ({ generation }),
    isCurrentGeneration: (value: number) => value === generation,
    async backendCommandRecovery(input: object) {
      this.inputs.push(input)
      if (changeIdentity) generation++
      return { current: true, data: { id: 'same-order' }, cursor: '' }
    },
    setBackendState(...args: unknown[]) {
      this.writes.push(args)
    },
    commandError: () => ({ message: 'Unexpected test failure' })
  }
}
