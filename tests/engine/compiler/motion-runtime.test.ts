import { describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

import { buildMotionRuntime } from '#compiler/adapters/react/motion/runtime'
import type { IRMotion, IRMotionTrigger } from '#compiler/ir/motion'

class FakeNode {
  parentElement: FakeElement | null = null
  readonly childNodes: FakeNode[] = []

  append<T extends FakeNode>(child: T): T {
    child.parentElement?.remove(child)
    child.parentElement = this instanceof FakeElement ? this : null
    this.childNodes.push(child)
    return child
  }

  remove(child: FakeNode): void {
    const index = this.childNodes.indexOf(child)
    if (index !== -1) this.childNodes.splice(index, 1)
    child.parentElement = null
  }

  contains(node: FakeNode): boolean {
    for (let current: FakeNode | null = node; current; current = current.parentElement) {
      if (current === this) return true
    }
    return false
  }
}

class FakeAnimation extends EventTarget {
  cancelCalls = 0
  reverseCalls = 0

  cancel(): void {
    this.cancelCalls += 1
    this.dispatchEvent(new Event('cancel'))
  }

  finish(): void {
    this.dispatchEvent(new Event('finish'))
  }

  reverse(): void {
    this.reverseCalls += 1
  }
}

class FakeElement extends FakeNode {
  readonly animations: FakeAnimation[] = []
  private readonly attributes = new Map<string, string>()

  constructor(readonly name: string) {
    super()
  }

  animate(_keyframes: unknown, _timing: unknown): FakeAnimation {
    const animation = new FakeAnimation()
    this.animations.push(animation)
    return animation
  }

  getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null
  }

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value)
  }

  removeAttribute(name: string): void {
    this.attributes.delete(name)
  }

  matches(selector: string): boolean {
    return (
      selector === '*' || (selector === '[data-op-motion]' && this.attributes.has('data-op-motion'))
    )
  }

  querySelectorAll(selector: string): FakeElement[] {
    const matches: FakeElement[] = []
    const visit = (node: FakeNode): void => {
      for (const child of node.childNodes) {
        if (!(child instanceof FakeElement)) continue
        if (child.matches(selector)) matches.push(child)
        visit(child)
      }
    }
    visit(this)
    return matches
  }
}

type FakeListener = (event: Record<string, unknown>) => void

class FakeDocument {
  readonly documentElement = new FakeElement('document')
  private readonly listeners = new Map<string, Set<FakeListener>>()

  addEventListener(type: string, listener: FakeListener): void {
    const listeners = this.listeners.get(type) ?? new Set<FakeListener>()
    listeners.add(listener)
    this.listeners.set(type, listeners)
  }

  removeEventListener(type: string, listener: FakeListener): void {
    this.listeners.get(type)?.delete(listener)
  }

  emit(type: string, event: Record<string, unknown>): void {
    for (const listener of this.listeners.get(type) ?? []) listener(event)
  }

  querySelectorAll(selector: string): FakeElement[] {
    const elements = this.documentElement.querySelectorAll(selector)
    return this.documentElement.matches(selector) ? [this.documentElement, ...elements] : elements
  }
}

class FakeMutationObserver {
  static latest: FakeMutationObserver | undefined
  disconnected = false
  observedTarget: FakeElement | undefined

  constructor(private readonly callback: (records: Array<Record<string, unknown>>) => void) {
    FakeMutationObserver.latest = this
  }

  observe(target: FakeElement, _options: unknown): void {
    this.observedTarget = target
  }

  disconnect(): void {
    this.disconnected = true
  }

  emit(records: Array<Record<string, unknown>>): void {
    this.callback(records)
  }
}

class FakeIntersectionObserver {
  static latest: FakeIntersectionObserver | undefined
  readonly observed = new Set<FakeElement>()
  disconnected = false

  constructor(_callback: (entries: unknown[]) => void) {
    FakeIntersectionObserver.latest = this
  }

  observe(element: FakeElement): void {
    this.observed.add(element)
  }

  unobserve(element: FakeElement): void {
    this.observed.delete(element)
  }

  disconnect(): void {
    this.disconnected = true
    this.observed.clear()
  }
}

interface MotionRuntimeHandle {
  dispose(): void
}

interface InstalledRuntime {
  stop(): void
}

let moduleNonce = 0

function runtimeFor(triggers: IRMotionTrigger[]): string {
  const motion: IRMotion = {
    version: 1,
    reducedMotion: 'allow',
    tracks: triggers.map((trigger, index) => ({
      id: `${trigger}-${index}`,
      trigger,
      exit: 'reverse',
      keyframes: [
        { offset: 0, opacity: 0.5 },
        { offset: 1, opacity: 1 }
      ],
      timing: {
        durationMs: 100,
        delayMs: 0,
        easing: 'linear',
        iterations: 1,
        direction: 'normal',
        fill: 'both'
      }
    }))
  }
  const runtime = buildMotionRuntime([{ token: 'nested', motion }])
  if (!runtime) throw new Error('Expected an interactive Motion runtime')
  return runtime
}

async function installRuntime(source: string, document: FakeDocument): Promise<InstalledRuntime> {
  FakeMutationObserver.latest = undefined
  FakeIntersectionObserver.latest = undefined
  const replacements: Record<string, unknown> = {
    document,
    Element: FakeElement,
    Node: FakeNode,
    MutationObserver: FakeMutationObserver,
    IntersectionObserver: FakeIntersectionObserver,
    window: { matchMedia: () => ({ matches: false }) }
  }
  const previous = new Map<string, PropertyDescriptor | undefined>()
  for (const [name, value] of Object.entries(replacements)) {
    previous.set(name, Object.getOwnPropertyDescriptor(globalThis, name))
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value })
  }

  try {
    const javascript = new Bun.Transpiler({ loader: 'ts' }).transformSync(
      `${source}\n// runtime-test-${moduleNonce++}`
    )
    const directory = mkdtempSync(join(tmpdir(), 'openpencil-motion-runtime-'))
    const path = join(directory, 'runtime.mjs')
    try {
      writeFileSync(path, javascript)
      await import(pathToFileURL(path).href)
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  } catch (error) {
    restoreGlobals(previous)
    throw error
  }

  let stopped = false
  return {
    stop(): void {
      if (stopped) return
      stopped = true
      const runtimeGlobal = globalThis as typeof globalThis & {
        __OPENPENCIL_MOTION_RUNTIME__?: MotionRuntimeHandle
      }
      runtimeGlobal.__OPENPENCIL_MOTION_RUNTIME__?.dispose()
      delete runtimeGlobal.__OPENPENCIL_MOTION_RUNTIME__
      restoreGlobals(previous)
    }
  }
}

function restoreGlobals(previous: ReadonlyMap<string, PropertyDescriptor | undefined>): void {
  for (const [name, descriptor] of previous) {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor)
    else Reflect.deleteProperty(globalThis, name)
  }
}

function nestedDocument(): {
  document: FakeDocument
  parent: FakeElement
  child: FakeElement
  outside: FakeElement
} {
  const document = new FakeDocument()
  const parent = document.documentElement.append(new FakeElement('parent'))
  const child = parent.append(new FakeElement('child'))
  const outside = document.documentElement.append(new FakeElement('outside'))
  parent.setAttribute('data-op-motion', 'nested')
  child.setAttribute('data-op-motion', 'nested')
  return { document, parent, child, outside }
}

describe('compiler — generated Motion runtime execution', () => {
  test('dispatches nested hover, focus, pointer, keyboard, and click boundaries', async () => {
    const { document, parent, child, outside } = nestedDocument()
    const installed = await installRuntime(
      runtimeFor(['hover', 'focus', 'press', 'click']),
      document
    )
    try {
      document.emit('pointerover', { target: parent, relatedTarget: null })
      document.emit('pointerover', { target: child, relatedTarget: parent })
      expect(parent.animations).toHaveLength(1)
      expect(child.animations).toHaveLength(1)

      document.emit('pointerout', { target: child, relatedTarget: outside })
      expect(parent.animations[0].reverseCalls).toBe(1)
      expect(child.animations[0].reverseCalls).toBe(1)

      document.emit('focusin', { target: child, relatedTarget: null })
      expect(parent.animations).toHaveLength(2)
      expect(child.animations).toHaveLength(2)
      document.emit('focusout', { target: child, relatedTarget: outside })
      expect(parent.animations[1].reverseCalls).toBe(1)
      expect(child.animations[1].reverseCalls).toBe(1)

      document.emit('pointerdown', { target: child, pointerId: 7 })
      expect(parent.animations).toHaveLength(3)
      expect(child.animations).toHaveLength(3)
      document.emit('pointerup', { target: outside, pointerId: 7 })
      expect(parent.animations[2].reverseCalls).toBe(1)
      expect(child.animations[2].reverseCalls).toBe(1)

      document.emit('keydown', { target: child, key: 'Enter', repeat: false })
      expect(parent.animations).toHaveLength(4)
      expect(child.animations).toHaveLength(4)
      document.emit('keyup', { target: outside, key: 'Enter' })
      expect(parent.animations[3].reverseCalls).toBe(1)
      expect(child.animations[3].reverseCalls).toBe(1)

      document.emit('click', { target: child })
      expect(parent.animations).toHaveLength(5)
      expect(child.animations).toHaveLength(5)
    } finally {
      installed.stop()
    }
  })

  test('cleans completed animations and observers across token changes and removed subtrees', async () => {
    const { document, parent, child, outside } = nestedDocument()
    const installed = await installRuntime(runtimeFor(['click', 'press', 'inView']), document)
    try {
      const intersection = FakeIntersectionObserver.latest
      const mutation = FakeMutationObserver.latest
      expect(intersection?.observed).toEqual(new Set([parent, child]))
      expect(mutation).toBeDefined()

      document.emit('click', { target: child })
      const completedParent = parent.animations[0]
      const completedChild = child.animations[0]
      completedParent.finish()
      completedChild.finish()

      parent.removeAttribute('data-op-motion')
      mutation?.emit([{ type: 'attributes', target: parent, addedNodes: [], removedNodes: [] }])
      expect(completedParent.cancelCalls).toBe(1)
      expect(intersection?.observed.has(parent)).toBe(false)
      expect(intersection?.observed.has(child)).toBe(true)

      parent.setAttribute('data-op-motion', 'nested')
      mutation?.emit([{ type: 'attributes', target: parent, addedNodes: [], removedNodes: [] }])
      expect(intersection?.observed.has(parent)).toBe(true)

      document.emit('pointerdown', { target: child, pointerId: 11 })
      const parentPress = parent.animations.at(-1) as FakeAnimation
      const childPress = child.animations.at(-1) as FakeAnimation
      document.documentElement.remove(parent)
      mutation?.emit([
        {
          type: 'childList',
          target: document.documentElement,
          addedNodes: [],
          removedNodes: [parent]
        }
      ])
      expect(parentPress.cancelCalls).toBe(1)
      expect(childPress.cancelCalls).toBe(1)
      expect(completedChild.cancelCalls).toBe(1)
      expect(intersection?.observed.size).toBe(0)

      document.emit('pointerup', { target: outside, pointerId: 11 })
      expect(parentPress.reverseCalls).toBe(0)
      expect(childPress.reverseCalls).toBe(0)
    } finally {
      installed.stop()
    }
  })

  test('drops finished animations from the runtime strong-reference set', async () => {
    const { document, parent } = nestedDocument()
    const installed = await installRuntime(runtimeFor(['click']), document)
    try {
      document.emit('click', { target: parent })
      const animation = parent.animations[0]
      animation.finish()
      document.documentElement.remove(parent)

      installed.stop()
      expect(animation.cancelCalls).toBe(0)
    } finally {
      installed.stop()
    }
  })
})
