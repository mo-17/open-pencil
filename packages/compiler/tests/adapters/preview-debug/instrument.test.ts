import { describe, expect, test } from 'bun:test'

import { emitEventHandler } from '#compiler/adapters/react/emit/event'
import { emitEventAttributes } from '#compiler/adapters/vue/events'
import { createContext } from '#compiler/adapters/vue/shared'
import type { IREventHandler } from '#compiler/ir/types'

interface TraceHook {
  begin(node: string, event: string): number
  step(trace: number, kind: string, label: string, status: string): void
  expression<T>(trace: number, compute: () => T): T
}

function execute(
  handlers: IREventHandler[],
  hook: TraceHook | undefined,
  write: (value: number) => void
) {
  const source = emitEventHandler(handlers, { debug: { nodeId: 'button', event: 'onClick' } })
  const javascript = new Bun.Transpiler({ loader: 'ts' }).transformSync(
    `const handler = ${source};`
  )
  const factory = new Function('window', 'setCount', `${javascript}\nreturn handler;`)
  const handler: () => void = factory({ __opLowcodeDebug: hook }, write)
  return handler()
}

describe('dev preview action instrumentation', () => {
  const set: IREventHandler = {
    kind: 'setState',
    stateName: 'count',
    mode: 'absolute',
    references: [],
    ast: { kind: 'number', value: 7 }
  }

  test('executes authored state and expression once with or without the debug host', () => {
    const steps: string[] = []
    const values: number[] = []
    const hook: TraceHook = {
      begin: (node, event) => {
        steps.push(`${node}:${event}`)
        return 1
      },
      step: (_trace, kind, label, status) => steps.push(`${kind}:${label}:${status}`),
      expression: (_trace, compute) => {
        steps.push('expression')
        return compute()
      }
    }
    execute([set], hook, (value) => values.push(value))
    execute([set], undefined, (value) => values.push(value))
    expect(values).toEqual([7, 7])
    expect(steps).toEqual([
      'button:onClick',
      'action:setState:start',
      'expression',
      'state:count:changed',
      'action:setState:success'
    ])
  })

  test('preserves stop and thrown-expression semantics', () => {
    const values: number[] = []
    const failureSteps: string[] = []
    execute([{ kind: 'stop' }, set], undefined, (value) => values.push(value))
    expect(values).toEqual([])
    expect(() =>
      execute(
        [set],
        {
          begin: () => 1,
          step: (_trace, kind, _label, status) => {
            failureSteps.push(`${kind}:${status}`)
          },
          expression: () => {
            throw new Error('evaluation failed')
          }
        },
        (value) => values.push(value)
      )
    ).toThrow('evaluation failed')
    expect(values).toEqual([])
    expect(failureSteps).toEqual(['action:start', 'action:error'])
  })

  test('ordinary exported event source keeps its existing runtime contract', () => {
    const source = emitEventHandler([set])
    expect(source).toBe('() => setCount(7)')
  })

  test('Vue authored actions execute with the same trace and state contract', async () => {
    const context = createContext(true, false, new Set(['count']), [
      { id: 'count', name: 'count', type: 'number', defaultValue: 0 }
    ])
    emitEventAttributes({ onClick: [set] }, context, 'button', [])
    const source = context.eventFunctions[0]
    const name = /^async function ([A-Za-z0-9_$]+)/.exec(source)?.[1]
    if (!name) throw new Error('Vue event function was not emitted')
    const javascript = new Bun.Transpiler({ loader: 'ts' }).transformSync(source)
    const state = { value: 0 }
    const traces: number[] = []
    const hook: TraceHook = {
      begin: () => 3,
      step: (trace) => {
        traces.push(trace)
      },
      expression: (_trace, compute) => compute()
    }
    const factory = new Function('window', 'count', `${javascript}\nreturn ${name};`)
    const handler: (event: { target: { value: string } }) => Promise<void> = factory(
      { __opLowcodeDebug: hook },
      state
    )
    await handler({ target: { value: '' } })
    expect(state.value).toBe(7)
    expect(traces).toEqual([3, 3, 3])
  })
})
