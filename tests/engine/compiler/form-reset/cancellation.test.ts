import { expect, test } from 'bun:test'

import {
  FORM_RESET_ACCEPTED_EVENT,
  reactFormResetAttribute,
  vueFormResetAttribute
} from '#compiler/adapters/form-reset'
import type { IRFormResetField } from '#compiler/ir/types'

const fields: IRFormResetField[] = [
  {
    write: { kind: 'docState', name: 'value', targetType: 'string' },
    defaultValue: 'declared',
    sourceIds: ['field']
  }
]

function handlerSource(target: 'react' | 'vue'): string {
  const keys = ['field', 'field']
  if (target === 'react') {
    const attribute = reactFormResetAttribute(fields, keys)
    return `const reset = ${attribute.slice('onReset={'.length, -1)}`
  }
  const context = { eventIndex: 0, eventFunctions: [] as string[], writableStateNames: new Map() }
  vueFormResetAttribute(fields, keys, context)
  return `${context.eventFunctions.join('\n')}\nconst reset = __opFormReset_1`
}

/** Execute the emitted handler with controllable microtask/timer checkpoints. */
function resetContract(target: 'react' | 'vue') {
  const microtasks: (() => void)[] = []
  const timers: (() => void)[] = []
  const effects: string[] = []
  const accepted: { type: string; detail: { values: Record<string, string> } }[] = []
  let error: string | null = 'Required'
  let value = 'draft'
  class Form {
    isConnected = true
    control = new Input(this)
    ownerDocument = {
      defaultView: {
        setTimeout: (callback: () => void) => timers.push(callback),
        CustomEvent: class {
          detail: { values: Record<string, string> }
          constructor(
            public type: string,
            options: { detail: { values: Record<string, string> } }
          ) {
            this.detail = options.detail
          }
        }
      }
    }
    querySelectorAll() {
      return [this.control]
    }
    dispatchEvent(event: (typeof accepted)[number]) {
      accepted.push(event)
    }
  }
  class Input {
    constructor(public form: Form) {}
    closest() {
      return this.form
    }
  }
  const write = (name: string, next: string) => {
    effects.push(`write:${name}`)
    value = next
  }
  const globals = {
    HTMLFormElement: Form,
    HTMLInputElement: Input,
    HTMLSelectElement: Input,
    HTMLTextAreaElement: Input,
    queueMicrotask: (callback: () => void) => microtasks.push(callback),
    __resetFieldValidation: (key: string) => {
      effects.push(`clear:${key}`)
      error = null
    },
    setDocState: write,
    __setDocState: write
  }
  const source = new Bun.Transpiler({ loader: 'ts' }).transformSync(handlerSource(target))
  const reset = new Function(
    'globals',
    `const { HTMLFormElement, HTMLInputElement, HTMLSelectElement, HTMLTextAreaElement, queueMicrotask, __resetFieldValidation, setDocState, __setDocState } = globals; ${source}; return reset`
  )(globals) as (event: unknown) => void
  const form = new Form()
  const nativeEvent = { defaultPrevented: false, target: form, currentTarget: form }
  reset(target === 'react' ? { ...nativeEvent, nativeEvent } : nativeEvent)
  return {
    microtasks,
    timers,
    effects,
    accepted,
    nativeEvent,
    snapshot: () => ({ error, value })
  }
}

for (const target of ['react', 'vue'] as const) {
  test(`${target} reset cancelled after its microtask keeps validation and values untouched`, () => {
    const contract = resetContract(target)
    expect(contract.microtasks).toHaveLength(1)
    contract.microtasks.shift()?.()
    expect(contract.timers).toHaveLength(1)
    expect(contract.effects).toEqual([])
    expect(contract.snapshot()).toEqual({ error: 'Required', value: 'draft' })

    contract.nativeEvent.defaultPrevented = true
    contract.timers.shift()?.()
    expect(contract.effects).toEqual([])
    expect(contract.accepted).toEqual([])
    expect(contract.snapshot()).toEqual({ error: 'Required', value: 'draft' })
  })

  test(`${target} accepted reset clears each error once before writing its default`, () => {
    const contract = resetContract(target)
    contract.microtasks.shift()?.()
    expect(contract.effects).toEqual([])
    contract.timers.shift()?.()
    expect(contract.effects).toEqual(['clear:field', 'write:value'])
    expect(contract.snapshot()).toEqual({ error: null, value: 'declared' })
    expect(contract.accepted).toEqual([
      expect.objectContaining({
        type: FORM_RESET_ACCEPTED_EVENT,
        detail: { values: { 'docState:value': 'declared' } }
      })
    ])
  })
}
