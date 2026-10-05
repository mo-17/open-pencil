import { expect, test } from 'bun:test'
import { runInNewContext } from 'node:vm'

import { buildValidationGlue } from '#compiler/adapters/react/lowcode/validation'
import type { IRFieldValidation } from '#compiler/ir/types'

interface PendingValidation {
  signal?: AbortSignal
  finish(value: string | null): void
}
interface ValidationHarness {
  reset(id: string): void
  field(id: string, value: unknown): Promise<string | null>
  submit(ids: string[]): Promise<boolean>
}
function validationHarness(remote: boolean) {
  let errors: Record<string, string | null> = {}
  const pending: PendingValidation[] = []
  const started = new Map<number, () => void>()
  const fields: IRFieldValidation[] = ['first', 'second', 'other'].map((key) => ({
    key,
    stateName: key,
    stateKind: 'state',
    rules: {},
    ...(remote
      ? { async: { url: '/mock-validation', method: 'POST' as const, message: 'Rejected' } }
      : {})
  }))
  const context = {
    first: 1,
    second: 2,
    other: 3,
    AbortController,
    useId: () => 'test',
    useRef: <T>(value: T) => ({ current: value }),
    useState: (initial: unknown) => {
      if (typeof initial === 'function')
        return [
          initial(),
          () => {
            throw new Error('Stable epoch must not need a React update')
          }
        ]
      return [
        errors,
        (update: (value: Record<string, string | null>) => Record<string, string | null>) => {
          errors = update(errors)
        }
      ]
    },
    validateValue: () => (remote ? null : 'Local error'),
    validateRemote: (_value: unknown, _config: unknown, signal?: AbortSignal) =>
      new Promise<string | null>((finish) => {
        pending.push({ signal, finish })
        started.get(pending.length - 1)?.()
      })
  }
  const source = buildValidationGlue(fields)
  const runtime = runInNewContext(
    new Bun.Transpiler({ loader: 'ts' }).transformSync(source) +
      '\n({reset:__resetFieldValidation,field:(id,value)=>__validateFieldValue(id,value),submit:__validateFields})',
    context
  ) as ValidationHarness
  const waitForPending = (index: number) =>
    pending[index]
      ? Promise.resolve()
      : new Promise<void>((resolve) => {
          started.set(index, resolve)
        })
  return { runtime, pending, waitForPending, errors: () => errors }
}
test('reset drops local promise results while leaving a separate field validation current', async () => {
  const { runtime, errors } = validationHarness(false)
  const old = runtime.field('first', 1),
    other = runtime.field('other', 3)
  runtime.reset('first')
  expect(await old).toBeNull()
  expect(await other).toBe('Local error')
  expect(errors()).toEqual({ first: null, other: 'Local error' })
})
test('reset aborts the pending remote field and cannot restore its old error', async () => {
  const { runtime, pending, errors } = validationHarness(true)
  const submit = runtime.submit(['first'])
  expect(pending).toHaveLength(1)
  runtime.reset('first')
  expect(pending[0].signal?.aborted).toBe(true)
  // Simulate a transport that ignores cancellation and still resolves.
  pending[0].finish('Old remote error')
  expect(await submit).toBe(false)
  expect(errors()).toEqual({ first: null })
})
test('reset invalidates an entire owning submit including previously evaluated sibling fields', async () => {
  const { runtime, pending, waitForPending, errors } = validationHarness(true)
  const submit = runtime.submit(['first', 'second'])
  pending[0].finish('First old error')
  await waitForPending(1)
  expect(pending).toHaveLength(2)
  runtime.reset('first')
  // Resetting another key in the same submit must also block a late success.
  pending[1].finish(null)
  expect(await submit).toBe(false)
  expect(errors()).toEqual({ first: null })
})
test('a reset does not invalidate a different form and a fresh submit can succeed', async () => {
  const { runtime, pending, errors } = validationHarness(true)
  const other = runtime.submit(['other'])
  runtime.reset('first')
  pending[0].finish(null)
  expect(await other).toBe(true)
  const fresh = runtime.submit(['first'])
  pending[1].finish(null)
  expect(await fresh).toBe(true)
  expect(errors()).toEqual({ first: null, other: null })
})

test('the real generated remote module FORM typechecks with reset invalidation', async () => {
  const { remoteModuleResetFixture } =
    await import('#tests/helpers/compiler/components/form-modules/remote-reset')
  const { typeCheckCompilerFiles } = await import('#tests/helpers/compiler/typecheck')
  const result = remoteModuleResetFixture()
  expect(result.warnings).toEqual([])
  expect(() =>
    typeCheckCompilerFiles(
      new Map(
        [...result.files].filter((entry): entry is [string, string] => typeof entry[1] === 'string')
      ),
      'react'
    )
  ).not.toThrow()
}, 35000)
