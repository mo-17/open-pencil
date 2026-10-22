import { expect, test } from 'bun:test'

import type { CanvasKit } from 'canvaskit-wasm'

import { releaseWebGLContext } from '#vue/canvas/surface/gl-surface'

import { asDouble } from '#tests/helpers/doubles'

test('replaces a parking context dropped by WebKit while releasing a tab', () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'document')
  const context = {}
  const deleted: number[] = []
  let next = 10
  let dropped = false
  const canvas = asDouble<HTMLCanvasElement>({ getContext: () => context })
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: { createElement: () => ({ width: 0, height: 0 }) }
  })
  const ck = asDouble<CanvasKit>({
    ctx: context,
    GetWebGLContext: () => next++,
    deleteContext: (handle: number) => {
      deleted.push(handle)
    },
    MakeGrContext: (handle: number) => {
      if (dropped && handle === 10) throw new Error('WebGL context lost')
      return {
        delete() {
          /* Native resource is represented by this scoped double. */
        }
      }
    }
  })
  try {
    releaseWebGLContext(ck, 1, canvas)
    dropped = true
    expect(() => releaseWebGLContext(ck, 2, canvas)).not.toThrow()
    expect(deleted).toEqual([1, 2, 10])
    expect(next).toBe(12)
    expect(() => releaseWebGLContext(ck, 3, canvas)).not.toThrow()
    expect(next).toBe(12)
  } finally {
    if (original) Object.defineProperty(globalThis, 'document', original)
    else Reflect.deleteProperty(globalThis, 'document')
  }
})
