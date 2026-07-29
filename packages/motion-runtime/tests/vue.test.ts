import { describe, expect, test } from 'bun:test'

import { effectScope, nextTick, ref } from 'vue'

import { createManualMotionClock, createMotionRuntime } from '../src'
import type { MotionStyleDeclaration } from '../src/dom'
import type { VanillaMotionElement } from '../src/vanilla'
import { useMotion, useMotionRuntime } from '../src/vue'
import { FakeReducedMotionQuery, installMatchMedia, removeMatchMedia } from './helpers/media-query'

function fakeElement(): VanillaMotionElement {
  const values = new Map<string, string>()
  const style: MotionStyleDeclaration = {
    getPropertyValue: (property: string) => values.get(property) ?? '',
    getPropertyPriority: () => '',
    setProperty: (property: string, value: string) => void values.set(property, value),
    removeProperty: (property: string) => {
      const value = values.get(property) ?? ''
      values.delete(property)
      return value
    }
  }
  return {
    style,
    addEventListener: () => undefined,
    removeEventListener: () => undefined
  }
}

describe('Vue Motion adapter', () => {
  test('reactively mounts and scope-disposes a DOM binding', async () => {
    const clock = createManualMotionClock()
    const element = ref<VanillaMotionElement | null>(null)
    const motion = ref({
      version: 1 as const,
      tracks: [
        {
          id: 'mount',
          trigger: 'mount' as const,
          keyframes: [
            { offset: 0, x: 0 },
            { offset: 1, x: 10 }
          ],
          timing: { durationMs: 100, easing: 'linear' as const }
        }
      ]
    })
    const scope = effectScope()
    const result = scope.run(() =>
      useMotion(element, motion, { runtimeOptions: { clock }, autoplay: false })
    )
    expect(result?.controller.value).toBeNull()

    element.value = fakeElement()
    await nextTick()
    expect(result?.controller.value).not.toBeNull()
    result?.play()
    clock.advanceBy(50)
    expect(element.value.style.getPropertyValue('transform')).toContain('translate3d(5px')

    scope.stop()
    expect(result?.controller.value).toBeNull()
    expect(clock.pendingFrameCount).toBe(0)
  })

  test('initializes and follows reduced motion for a scope-owned useMotion runtime', () => {
    const query = new FakeReducedMotionQuery(true)
    const installed = installMatchMedia(query)
    const scope = effectScope()
    try {
      const element = fakeElement()
      const result = scope.run(() =>
        useMotion(
          ref(element),
          ref({
            version: 1 as const,
            reducedMotion: 'disable' as const,
            tracks: [
              {
                id: 'mount',
                trigger: 'mount' as const,
                keyframes: [
                  { offset: 0, x: 0 },
                  { offset: 1, x: 10 }
                ],
                timing: { durationMs: 100, easing: 'linear' as const, fill: 'both' as const }
              }
            ]
          }),
          { runtimeOptions: { clock: createManualMotionClock() }, autoplay: false }
        )
      )
      expect(installed.callCount).toBe(1)
      expect(query.listeners.size).toBe(1)
      expect(result?.controller.value?.runtime.prefersReducedMotion).toBe(true)
      result?.controller.value?.handle.seek(50)
      expect(element.style.getPropertyValue('transform')).toBe('')

      query.change(false)
      expect(result?.controller.value?.runtime.prefersReducedMotion).toBe(false)
      result?.controller.value?.handle.seek(50)
      expect(element.style.getPropertyValue('transform')).toContain('translate3d(5px')

      query.change(true)
      expect(element.style.getPropertyValue('transform')).toBe('')
      scope.stop()
      expect(query.listeners.size).toBe(0)
    } finally {
      scope.stop()
      installed.restore()
    }
  })

  test('scope-owned useMotion releases its runtime after a host cleanup failure', () => {
    const query = new FakeReducedMotionQuery(false)
    const installed = installMatchMedia(query)
    const scope = effectScope()
    try {
      const result = scope.run(() =>
        useMotion(
          ref(fakeElement()),
          ref({
            version: 1 as const,
            tracks: [
              {
                id: 'mount',
                trigger: 'mount' as const,
                keyframes: [
                  { offset: 0, opacity: 0 },
                  { offset: 1, opacity: 1 }
                ],
                timing: { durationMs: 100 }
              }
            ]
          }),
          {
            autoplay: false,
            runtimeOptions: { clock: createManualMotionClock() },
            clearAdvanced: () => {
              throw new Error('Vue host restore failed')
            }
          }
        )
      )
      if (!result?.controller.value) throw new Error('Expected mounted Vue Motion controller')
      const runtime = result.controller.value.runtime
      expect(query.listeners.size).toBe(1)

      expect(() => result.dispose()).toThrow('Vue host restore failed')
      expect(result.controller.value).toBeNull()
      expect(query.listeners.size).toBe(0)
      expect(() => runtime.setPrefersReducedMotion(true)).toThrow('disposed')
      expect(() => result.dispose()).not.toThrow()
    } finally {
      scope.stop()
      installed.restore()
    }
  })

  test('does not observe or dispose a runtime injected into useMotion', () => {
    const query = new FakeReducedMotionQuery(true)
    const installed = installMatchMedia(query)
    const runtime = createMotionRuntime({ clock: createManualMotionClock() })
    const scope = effectScope()
    try {
      const result = scope.run(() =>
        useMotion(
          ref(fakeElement()),
          ref({
            version: 1 as const,
            tracks: [
              {
                id: 'mount',
                trigger: 'mount' as const,
                keyframes: [
                  { offset: 0, opacity: 0 },
                  { offset: 1, opacity: 1 }
                ],
                timing: { durationMs: 100 }
              }
            ]
          }),
          { runtime, autoplay: false }
        )
      )
      expect(result?.controller.value?.runtime).toBe(runtime)
      expect(installed.callCount).toBe(0)
      expect(query.listeners.size).toBe(0)
      scope.stop()
      runtime.setPrefersReducedMotion(true)
      expect(runtime.prefersReducedMotion).toBe(true)

      const explicitScope = effectScope()
      const explicit = explicitScope.run(() =>
        useMotion(
          ref(fakeElement()),
          ref({
            version: 1 as const,
            tracks: [
              {
                id: 'mount',
                trigger: 'mount' as const,
                keyframes: [
                  { offset: 0, opacity: 0 },
                  { offset: 1, opacity: 1 }
                ],
                timing: { durationMs: 100 }
              }
            ]
          }),
          {
            runtimeOptions: {
              clock: createManualMotionClock(),
              prefersReducedMotion: false
            },
            autoplay: false
          }
        )
      )
      expect(explicit?.controller.value?.runtime.prefersReducedMotion).toBe(false)
      expect(installed.callCount).toBe(0)
      expect(query.listeners.size).toBe(0)
      explicitScope.stop()
    } finally {
      scope.stop()
      runtime.dispose()
      installed.restore()
    }
  })

  test('keeps useMotionRuntime SSR-safe and observes only when matchMedia exists', () => {
    const restoreMatchMedia = removeMatchMedia()
    const ssrScope = effectScope()
    try {
      const ssr = ssrScope.run(() => useMotionRuntime({ clock: createManualMotionClock() }))
      expect(ssr?.runtime.prefersReducedMotion).toBe(false)
      ssrScope.stop()
    } finally {
      ssrScope.stop()
      restoreMatchMedia()
    }

    const query = new FakeReducedMotionQuery(true)
    const installed = installMatchMedia(query)
    const browserScope = effectScope()
    try {
      const browser = browserScope.run(() => useMotionRuntime({ clock: createManualMotionClock() }))
      expect(browser?.runtime.prefersReducedMotion).toBe(true)
      expect(query.listeners.size).toBe(1)
      query.change(false)
      expect(browser?.runtime.prefersReducedMotion).toBe(false)
      browserScope.stop()
      expect(query.listeners.size).toBe(0)
    } finally {
      browserScope.stop()
      installed.restore()
    }
  })
})
