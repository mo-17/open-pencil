import { expect, test } from 'bun:test'
import { runInNewContext } from 'node:vm'

import {
  STEPPER_CONFIG_SOURCE,
  STEPPER_RUNTIME_SOURCE
} from '#compiler/adapters/navigation/stepper/source'

import {
  STEPPER_MODULE_DEFAULT_CONFIG,
  stepperCurrentIndex,
  type StepperModuleConfigV1
} from '@open-pencil/core/plugins'

interface StepperInputs {
  currentIndex?: unknown
  currentIndexBound?: boolean
  disabled?: boolean
  readOnly?: boolean
}
interface Runtime {
  stepperCurrentIndex: typeof stepperCurrentIndex
  stepperProjection(
    config: StepperModuleConfigV1,
    inputs: StepperInputs,
    local: number,
    writable: boolean
  ): {
    current: number | null
    invalid: boolean
    interactive: boolean
    readOnly: boolean
    disabled: boolean
  }
  stepperKeyboardIndex(config: StepperModuleConfigV1, index: number, key: string): number | null
  stepperStatus(current: number | null, count: number, language?: string): string
  dispatchStepperChange(host: StepperHost, current: number, previous: number): void
  installStepperEvents(
    host: StepperHost,
    change: (event: CustomEvent) => void,
    reset: () => void
  ): () => void
}
const source = new Bun.Transpiler({ loader: 'ts', target: 'browser' }).transformSync(
  STEPPER_CONFIG_SOURCE + '\n' + STEPPER_RUNTIME_SOURCE
)
const runtime = runInNewContext(
  source +
    '\n({stepperCurrentIndex,stepperProjection,stepperKeyboardIndex,stepperStatus,dispatchStepperChange,installStepperEvents})',
  { queueMicrotask }
) as Runtime
const config = {
  ...structuredClone(STEPPER_MODULE_DEFAULT_CONFIG),
  allowStepClick: true,
  items: [
    ...structuredClone(STEPPER_MODULE_DEFAULT_CONFIG.items),
    { title: 'Finish', description: '', status: 'auto' as const, disabled: false }
  ]
}
config.items[2].disabled = true

test('Stepper runtime index matches Core/Canvas without coercion, clamping or disabled selection', () => {
  const values = [
    undefined,
    null,
    true,
    '1',
    {},
    [],
    Number.NaN,
    Infinity,
    -Infinity,
    -1,
    0,
    1,
    1.5,
    2,
    3,
    4,
    99
  ]
  for (const value of values)
    for (const bound of [true, false])
      expect(runtime.stepperCurrentIndex(config, value, bound)).toBe(
        stepperCurrentIndex(config, value, bound)
      )
  for (const value of values.filter((value) => value !== 0 && value !== 1 && value !== 3)) {
    const projection = runtime.stepperProjection(
      config,
      { currentIndex: value, currentIndexBound: true },
      1,
      true
    )
    expect(projection).toMatchObject({ current: null, invalid: true, interactive: false })
    expect(runtime.stepperStatus(projection.current, 4)).toContain('unavailable')
    expect(runtime.stepperStatus(projection.current, 4, 'zh-CN')).toContain('不可用')
  }
})

test('writable currentIndex requires actual interaction authority; local state is independent', () => {
  for (const inputs of [
    { disabled: true },
    { readOnly: true },
    { currentIndex: 0, currentIndexBound: true }
  ])
    expect(runtime.stepperProjection(config, inputs, 1, false).interactive).toBe(false)
  expect(
    runtime.stepperProjection({ ...config, allowStepClick: false }, {}, 0, true).interactive
  ).toBe(false)
  expect(
    runtime.stepperProjection(config, { currentIndex: 1, currentIndexBound: true }, 0, true)
  ).toMatchObject({ current: 1, interactive: true })
  expect(runtime.stepperProjection(config, {}, 0, true).current).toBe(0)
  expect(runtime.stepperProjection(config, {}, 3, true).current).toBe(3)
})

test('keyboard focus skips disabled steps and follows orientation without selecting', () => {
  expect(runtime.stepperKeyboardIndex(config, 1, 'ArrowRight')).toBe(3)
  expect(runtime.stepperKeyboardIndex(config, 3, 'ArrowLeft')).toBe(1)
  expect(runtime.stepperKeyboardIndex(config, 1, 'ArrowDown')).toBeNull()
  expect(runtime.stepperKeyboardIndex(config, 1, 'Enter')).toBeNull()
  expect(runtime.stepperKeyboardIndex(config, 1, 'Home')).toBe(0)
  expect(runtime.stepperKeyboardIndex(config, 1, 'End')).toBe(3)
  expect(runtime.stepperKeyboardIndex({ ...config, orientation: 'vertical' }, 1, 'ArrowDown')).toBe(
    3
  )
})

class FormHost extends EventTarget {}
class StepperHost extends EventTarget {
  isConnected = true
  ownerDocument = { defaultView: { CustomEvent } }
  constructor(readonly form: FormHost) {
    super()
  }
  closest() {
    return this.form
  }
}

test('stepschange delivers one bubbling DOM event with current/previous data and releases its listener', () => {
  const host = new StepperHost(new FormHost())
  const delivered: CustomEvent[] = []
  let resets = 0
  const cleanup = runtime.installStepperEvents(
    host,
    (event) => delivered.push(event),
    () => resets++
  )
  runtime.dispatchStepperChange(host, 3, 1)
  expect(delivered).toHaveLength(1)
  expect(delivered[0].detail).toEqual({ currentIndex: 3, previousIndex: 1 })
  expect(delivered[0].bubbles).toBe(true)
  cleanup()
  runtime.dispatchStepperChange(host, 1, 3)
  expect(delivered).toHaveLength(1)
  expect(resets).toBe(0)
})

test('local Stepper reset waits for cancellation and never emits stepschange', async () => {
  const form = new FormHost(),
    host = new StepperHost(form)
  let resets = 0,
    changes = 0
  const cleanup = runtime.installStepperEvents(
    host,
    () => changes++,
    () => resets++
  )
  const cancel = (event: Event) => event.preventDefault()
  form.addEventListener('reset', cancel)
  form.dispatchEvent(new Event('reset', { cancelable: true }))
  await Promise.resolve()
  expect(resets).toBe(0)
  form.removeEventListener('reset', cancel)
  form.dispatchEvent(new Event('reset', { cancelable: true }))
  await Promise.resolve()
  expect(resets).toBe(1)
  expect(changes).toBe(0)
  host.isConnected = false
  form.dispatchEvent(new Event('reset', { cancelable: true }))
  await Promise.resolve()
  expect(resets).toBe(1)
  cleanup()
})
