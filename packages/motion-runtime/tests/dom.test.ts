import { describe, expect, test } from 'bun:test'

import { createManualMotionClock } from '../src/clock'
import {
  createDOMMotionTarget,
  DOMMotionCapabilityError,
  type MotionStyleDeclaration
} from '../src/dom'
import { createMotionRuntime } from '../src/runtime'
import { createVanillaMotion, type VanillaMotionElement } from '../src/vanilla'
import { FakeReducedMotionQuery, installMatchMedia } from './helpers/media-query'

class FakeStyle implements MotionStyleDeclaration {
  readonly values = new Map<string, { value: string; priority: string }>()
  readonly mutations: string[] = []

  getPropertyValue(property: string): string {
    return this.values.get(property)?.value ?? ''
  }

  getPropertyPriority(property: string): string {
    return this.values.get(property)?.priority ?? ''
  }

  setProperty(property: string, value: string, priority = ''): void {
    this.mutations.push(`set:${property}:${value}`)
    this.values.set(property, { value, priority })
  }

  removeProperty(property: string): string {
    this.mutations.push(`remove:${property}`)
    const previous = this.getPropertyValue(property)
    this.values.delete(property)
    return previous
  }
}

class FakeElement implements VanillaMotionElement {
  readonly style = new FakeStyle()
  readonly listeners = new Map<string, Set<EventListenerOrEventListenerObject>>()

  addEventListener(type: string, listener: EventListenerOrEventListenerObject): void {
    const listeners = this.listeners.get(type) ?? new Set()
    listeners.add(listener)
    this.listeners.set(type, listeners)
  }

  removeEventListener(type: string, listener: EventListenerOrEventListenerObject): void {
    this.listeners.get(type)?.delete(listener)
  }

  dispatch(type: string): void {
    for (const listener of this.listeners.get(type) ?? []) {
      if (typeof listener === 'function') listener(new Event(type))
      else listener.handleEvent(new Event(type))
    }
  }
}

describe('DOM Motion adapter', () => {
  test('projects visual channels and restores every touched style', () => {
    const style = new FakeStyle()
    style.setProperty('transform', 'skewX(4deg)')
    style.setProperty('opacity', '0.5')
    const target = createDOMMotionTarget({ style })

    target.apply({
      x: 10,
      y: 20,
      scaleX: 2,
      scaleY: 3,
      rotate: 45,
      opacity: 0.4,
      cornerRadii: { topLeft: 1, topRight: 2, bottomRight: 3, bottomLeft: 4 },
      fontAxes: [{ tag: 'wght', value: 650 }],
      fillColor: { r: 1, g: 0, b: 0, a: 1 }
    })

    expect(style.getPropertyValue('transform')).toContain('skewX(4deg) translate3d(10px, 20px')
    expect(style.getPropertyValue('opacity')).toBe('0.2')
    expect(style.getPropertyValue('border-radius')).toBe('1px 2px 3px 4px')
    expect(style.getPropertyValue('background-color')).toBe('rgb(255, 0, 0)')
    expect(style.getPropertyValue('font-variation-settings')).toBe("'wght' 650")

    target.restore()
    expect(style.getPropertyValue('transform')).toBe('skewX(4deg)')
    expect(style.getPropertyValue('opacity')).toBe('0.5')
    expect(style.getPropertyValue('background-color')).toBe('')
  })

  test('serializes bounded alpha colors without a core color dependency', () => {
    const style = new FakeStyle()
    const target = createDOMMotionTarget({ style })

    target.apply({
      x: 0,
      y: 0,
      scaleX: 1,
      scaleY: 1,
      rotate: 0,
      opacity: 1,
      fillColor: { r: 0.1, g: 0.2, b: 0.3, a: 0.333_333 },
      shadowColor: { r: -1, g: 2, b: 0.499, a: 0.995 }
    })

    expect(style.getPropertyValue('background-color')).toBe('rgba(26, 51, 77, 0.33)')
    expect(style.getPropertyValue('box-shadow')).toBe('0px 0px 0px 0px rgba(0, 255, 127, 1)')
  })

  test('reveals Unicode code points and restores the authored text snapshot', () => {
    const style = new FakeStyle()
    let text = 'A🐸中'
    const target = createDOMMotionTarget(
      { style },
      {
        textContent: {
          read: () => text,
          write: (value) => {
            text = value
          }
        }
      }
    )

    target.apply({ x: 0, y: 0, scaleX: 1, scaleY: 1, rotate: 0, opacity: 1, textReveal: 0.5 })
    expect(text).toBe('A🐸')
    expect(style.getPropertyValue('clip-path')).toBe('')
    target.apply({ x: 0, y: 0, scaleX: 1, scaleY: 1, rotate: 0, opacity: 1, textReveal: 1 })
    expect(text).toBe('A🐸中')
    target.restore()
    expect(text).toBe('A🐸中')
  })

  test('fails closed before mutation for undeclared structured channels', () => {
    const style = new FakeStyle()
    const target = createDOMMotionTarget({ style })
    const apply = () =>
      target.apply({
        x: 0,
        y: 0,
        scaleX: 1,
        scaleY: 1,
        rotate: 0,
        opacity: 1,
        paints: [
          { kind: 'fill', index: 0, color: { r: 1, g: 0, b: 0, a: 1 } },
          { kind: 'fill', index: 1, color: { r: 0, g: 1, b: 0, a: 1 } }
        ],
        gradientStops: [
          {
            kind: 'fill',
            paintIndex: 0,
            stopIndex: 0,
            position: 0.25,
            color: { r: 0, g: 0, b: 1, a: 1 }
          }
        ],
        effects: [{ kind: 'blur', index: 0, radius: 8 }],
        textReveal: 0.5,
        vectorMorph: {
          topologyId: 'same',
          points: [
            { x: 0, y: 0 },
            { x: 1, y: 1 }
          ]
        }
      })

    expect(apply).toThrow(DOMMotionCapabilityError)
    try {
      apply()
    } catch (error) {
      expect(error).toBeInstanceOf(DOMMotionCapabilityError)
      expect((error as DOMMotionCapabilityError).channels).toEqual([
        'paints',
        'gradientStops',
        'effects',
        'textReveal',
        'vectorMorph'
      ])
    }
    expect(style.values.size).toBe(0)
  })

  test('runs only explicitly declared advanced projections and restores them', () => {
    const style = new FakeStyle()
    const calls: string[] = []
    const target = createDOMMotionTarget(
      { style },
      {
        advancedCapabilities: ['paints'],
        applyAdvanced: (_element, visual) => calls.push(`apply:${visual.paints?.length ?? 0}`),
        clearAdvanced: () => calls.push('clear')
      }
    )
    expect(target.advancedCapabilities).toEqual(['paints'])
    target.apply({
      x: 0,
      y: 0,
      scaleX: 1,
      scaleY: 1,
      rotate: 0,
      opacity: 1,
      paints: [{ kind: 'fill', index: 1, opacity: 0.5 }]
    })
    expect(calls).toEqual(['apply:1'])
    expect(style.getPropertyValue('--open-pencil-motion-fill-1-opacity')).toBe('0.5')
    target.restore()
    expect(calls).toEqual(['apply:1', 'clear'])
    expect(style.getPropertyValue('--open-pencil-motion-fill-1-opacity')).toBe('')
  })

  test('Vanilla adapter attaches bounded trigger listeners and removes them on dispose', () => {
    const element = new FakeElement()
    const clock = createManualMotionClock()
    const controller = createVanillaMotion({
      element,
      trigger: 'hover',
      runtimeOptions: { clock },
      motion: {
        version: 1,
        tracks: [
          {
            id: 'hover',
            trigger: 'hover',
            keyframes: [
              { offset: 0, opacity: 0 },
              { offset: 1, opacity: 1 }
            ],
            timing: { durationMs: 100, easing: 'linear' }
          }
        ]
      }
    })

    expect(element.listeners.get('pointerenter')?.size).toBe(1)
    element.dispatch('pointerenter')
    clock.advanceBy(50)
    expect(element.style.getPropertyValue('opacity')).toBe('0.5')
    element.dispatch('pointerleave')
    expect(controller.handle.getState().status).toBe('idle')
    controller.dispose()
    expect(element.listeners.get('pointerenter')?.size).toBe(0)
    expect(element.style.getPropertyValue('opacity')).toBe('')
  })

  test('Vanilla-owned cleanup remains complete when a host restore callback throws', () => {
    const query = new FakeReducedMotionQuery(false)
    const installed = installMatchMedia(query)
    try {
      const element = new FakeElement()
      const controller = createVanillaMotion({
        element,
        trigger: 'hover',
        autoplay: false,
        runtimeOptions: { clock: createManualMotionClock() },
        clearAdvanced: () => {
          throw new Error('host restore failed')
        },
        motion: {
          version: 1,
          tracks: [
            {
              id: 'hover',
              trigger: 'hover',
              keyframes: [
                { offset: 0, opacity: 0 },
                { offset: 1, opacity: 1 }
              ],
              timing: { durationMs: 100 }
            }
          ]
        }
      })
      const runtime = controller.runtime
      expect(element.listeners.get('pointerenter')?.size).toBe(1)
      expect(query.listeners.size).toBe(1)

      expect(() => controller.dispose()).toThrow('host restore failed')
      expect(element.listeners.get('pointerenter')?.size).toBe(0)
      expect(query.listeners.size).toBe(0)
      expect(() => runtime.setPrefersReducedMotion(true)).toThrow('disposed')
      expect(() => controller.dispose()).not.toThrow()
    } finally {
      installed.restore()
    }
  })

  test('Vanilla-owned runtimes follow live reduced motion and restore disabled DOM styles', () => {
    const query = new FakeReducedMotionQuery(false)
    const installed = installMatchMedia(query)
    try {
      const element = new FakeElement()
      const controller = createVanillaMotion({
        element,
        autoplay: false,
        runtimeOptions: { clock: createManualMotionClock() },
        motion: {
          version: 2,
          reducedMotion: 'disable',
          tracks: [
            {
              id: 'move',
              trigger: 'mount',
              keyframes: [
                { offset: 0, x: 0, opacity: 0, trimStart: 0 },
                { offset: 1, x: 100, opacity: 1, trimStart: 1 }
              ],
              timing: { durationMs: 100, easing: 'linear', fill: 'both' }
            }
          ]
        }
      })
      expect(installed.callCount).toBe(1)
      expect(query.listeners.size).toBe(1)
      expect(controller.runtime.prefersReducedMotion).toBe(false)

      controller.handle.seek(50)
      expect(element.style.getPropertyValue('transform')).toContain('translate3d(50px')
      expect(element.style.getPropertyValue('opacity')).toBe('0.5')
      expect(element.style.getPropertyValue('--open-pencil-motion-trim-start')).toBe('0.5')

      query.change(true)
      expect(controller.runtime.prefersReducedMotion).toBe(true)
      expect(controller.handle.getState()).toMatchObject({ elapsedMs: 0, durationMs: 0 })
      expect(element.style.getPropertyValue('transform')).toBe('')
      expect(element.style.getPropertyValue('opacity')).toBe('')
      expect(element.style.getPropertyValue('--open-pencil-motion-trim-start')).toBe('')

      element.style.mutations.length = 0
      controller.handle.seek(0)
      expect(element.style.mutations.some((mutation) => mutation.startsWith('set:'))).toBe(false)

      query.change(false)
      expect(controller.handle.getState()).toMatchObject({ elapsedMs: 50, durationMs: 100 })
      expect(element.style.getPropertyValue('transform')).toContain('translate3d(50px')
      expect(element.style.getPropertyValue('opacity')).toBe('0.5')
      expect(element.style.getPropertyValue('--open-pencil-motion-trim-start')).toBe('0.5')

      controller.dispose()
      expect(query.listeners.size).toBe(0)
      expect(element.style.getPropertyValue('transform')).toBe('')
    } finally {
      installed.restore()
    }
  })

  test('injected and explicitly configured Vanilla runtimes do not own a media listener', () => {
    const query = new FakeReducedMotionQuery(true)
    const installed = installMatchMedia(query)
    const runtime = createMotionRuntime({ clock: createManualMotionClock() })
    try {
      const injected = createVanillaMotion({
        element: new FakeElement(),
        motion: {
          version: 1,
          tracks: [
            {
              id: 'mount',
              trigger: 'mount',
              keyframes: [
                { offset: 0, opacity: 0 },
                { offset: 1, opacity: 1 }
              ],
              timing: { durationMs: 100 }
            }
          ]
        },
        runtime,
        autoplay: false
      })
      expect(installed.callCount).toBe(0)
      expect(query.listeners.size).toBe(0)
      injected.dispose()
      runtime.setPrefersReducedMotion(true)
      expect(runtime.prefersReducedMotion).toBe(true)

      const explicit = createVanillaMotion({
        element: new FakeElement(),
        motion: {
          version: 1,
          tracks: [
            {
              id: 'mount',
              trigger: 'mount',
              keyframes: [
                { offset: 0, opacity: 0 },
                { offset: 1, opacity: 1 }
              ],
              timing: { durationMs: 100 }
            }
          ]
        },
        runtimeOptions: {
          clock: createManualMotionClock(),
          prefersReducedMotion: false
        },
        autoplay: false
      })
      expect(installed.callCount).toBe(0)
      expect(query.listeners.size).toBe(0)
      explicit.dispose()
    } finally {
      runtime.dispose()
      installed.restore()
    }
  })
})
