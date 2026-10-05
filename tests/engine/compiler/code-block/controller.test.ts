import { expect, test } from 'bun:test'

import { CODE_BLOCK_CONTROLLER_SOURCE } from '#compiler/adapters/code-block/controller'
import { encode } from 'js-base64'

interface CopyOwner {
  key: string
  code: string
  enabled: boolean
  alive: boolean
}
interface CopyController {
  copy(): Promise<void>
  reset(): void
  destroy(): void
}
type CopyControllerFactory = (
  read: () => CopyOwner,
  write: (code: string) => Promise<void>,
  publish: (status: string) => void
) => CopyController
const javascript = new Bun.Transpiler({ loader: 'ts' }).transformSync(
  CODE_BLOCK_CONTROLLER_SOURCE + '\nexport {createCodeCopyController}'
)
const { createCodeCopyController } = (await import(
  'data:text/javascript;base64,' + encode(javascript)
)) as { createCodeCopyController: CopyControllerFactory }

test('Copy is explicit, preserves exact source, deduplicates pending clicks and reports only bounded status', async () => {
  const source = '<script>not executed</script>\r\n\t中文'
  const statuses: string[] = [],
    writes: string[] = []
  const pending = Promise.withResolvers<undefined>()
  const controller = createCodeCopyController(
    () => ({ key: 'A', code: source, enabled: true, alive: true }),
    (code) => {
      writes.push(code)
      return pending.promise
    },
    (status) => statuses.push(status)
  )
  expect(writes).toEqual([])
  const operation = controller.copy()
  await controller.copy()
  expect(writes).toEqual([source])
  expect(statuses).toEqual(['pending'])
  pending.resolve(undefined)
  await operation
  expect(statuses).toEqual(['pending', 'success'])
  const errors: string[] = []
  const rejected = createCodeCopyController(
    () => ({ key: 'B', code: source, enabled: true, alive: true }),
    () => Promise.reject(new Error('private device details')),
    (status) => errors.push(status)
  )
  await rejected.copy()
  expect(errors).toEqual(['pending', 'error'])
})

test('Config replacement, A to B to A, disabled state and unmount invalidate late copy completions', async () => {
  let owner = { key: 'A', code: 'original', enabled: true, alive: true }
  const statuses: string[] = []
  const pending = Promise.withResolvers<undefined>()
  let writes = 0
  const controller = createCodeCopyController(
    () => owner,
    () => {
      writes++
      return pending.promise
    },
    (status) => statuses.push(status)
  )
  const old = controller.copy()
  owner = { ...owner, key: 'B', code: 'replacement' }
  controller.reset()
  owner = { ...owner, key: 'A', code: 'original' }
  controller.reset()
  pending.resolve(undefined)
  await old
  expect(statuses).toEqual(['pending', 'idle', 'idle'])
  owner = { ...owner, enabled: false }
  await controller.copy()
  expect(writes).toBe(1)
  owner = { ...owner, enabled: true }
  const after = controller.copy()
  controller.destroy()
  await after
  expect(statuses.at(-1)).toBe('pending')
  await controller.copy()
  expect(writes).toBe(2)
})

test('Copy instances and replacement requests cannot publish one another’s late results', async () => {
  let owner = { key: 'A', code: 'first', enabled: true, alive: true }
  const a = Promise.withResolvers<undefined>(),
    b = Promise.withResolvers<undefined>()
  const statuses: string[] = [],
    other: string[] = []
  const controller = createCodeCopyController(
    () => owner,
    (code) => (code === 'first' ? a.promise : b.promise),
    (status) => statuses.push(status)
  )
  const isolated = createCodeCopyController(
    () => ({ ...owner, key: 'other' }),
    () => Promise.resolve(undefined),
    (status) => other.push(status)
  )
  const previous = controller.copy()
  owner = { ...owner, key: 'B', code: 'second' }
  const current = controller.copy()
  a.resolve(undefined)
  await previous
  expect(statuses).toEqual(['pending', 'pending'])
  await isolated.copy()
  expect(other).toEqual(['pending', 'success'])
  owner = { ...owner, alive: false }
  b.resolve(undefined)
  await current
  expect(statuses).toEqual(['pending', 'pending'])
})
