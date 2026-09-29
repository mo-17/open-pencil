import { expect, test } from 'bun:test'

import { withModuleFormCleanup } from '#tests/helpers/compiler/components/form-module/lifecycle'

test('a test failure retains its exact identity when both page navigation and server closing fail', async () => {
  const primary = new Error('Original field assertion failed')
  const calls: string[] = []
  await expect(
    withModuleFormCleanup(
      async () => {
        calls.push('run')
        throw primary
      },
      async () => {
        calls.push('leave')
        throw new Error('Page closed during navigation')
      },
      async () => {
        calls.push('close')
        throw new Error('Server close failed')
      }
    )
  ).rejects.toBe(primary)
  expect(calls).toEqual(['run', 'leave', 'close'])
})
test('server cleanup still runs after navigation fails, and successful tests expose that failure', async () => {
  const navigation = new Error('Navigation failed')
  const calls: string[] = []
  await expect(
    withModuleFormCleanup(
      async () => {
        calls.push('run')
      },
      async () => {
        calls.push('leave')
        throw navigation
      },
      async () => {
        calls.push('close')
        throw new Error('Secondary close failure')
      }
    )
  ).rejects.toBe(navigation)
  expect(calls).toEqual(['run', 'leave', 'close'])
})
test('a server close failure fails an otherwise successful test', async () => {
  const closeError = new Error('Server could not close')
  const calls: string[] = []
  await expect(
    withModuleFormCleanup(
      async () => {
        calls.push('run')
      },
      async () => {
        calls.push('leave')
      },
      async () => {
        calls.push('close')
        throw closeError
      }
    )
  ).rejects.toBe(closeError)
  expect(calls).toEqual(['run', 'leave', 'close'])
})
test('successful preview cleanup leaves no failure and executes in order', async () => {
  const calls: string[] = []
  await withModuleFormCleanup(
    async () => {
      calls.push('run')
    },
    async () => {
      calls.push('leave')
    },
    async () => {
      calls.push('close')
    }
  )
  expect(calls).toEqual(['run', 'leave', 'close'])
})
