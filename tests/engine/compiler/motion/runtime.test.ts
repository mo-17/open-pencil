/* eslint-disable max-lines -- generated runtime behavior shares one fake DOM/WAAPI harness */
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
  animationName: string | undefined
  cancelCalls = 0
  currentTime: number | null = 0
  readonly effect = {
    getComputedTiming: (): { progress: number | null } => ({ progress: this.progress() })
  }
  oncancel: (() => void) | null = null
  onfinish: (() => void) | null = null
  playbackRate = 1
  playCalls = 0
  playState: AnimationPlayState = 'running'
  reverseCalls = 0

  constructor(
    readonly keyframes: unknown,
    readonly timing: unknown
  ) {
    super()
  }

  cancel(): void {
    this.cancelCalls += 1
    this.currentTime = null
    this.playState = 'idle'
    this.dispatchEvent(new Event('cancel'))
    this.oncancel?.()
  }

  finish(): void {
    const timing = this.timing as { delay?: number; duration?: number }
    this.currentTime = (timing.delay ?? 0) + (timing.duration ?? 0)
    this.playState = 'finished'
    this.dispatchEvent(new Event('finish'))
    this.onfinish?.()
  }

  play(): void {
    this.playCalls += 1
    this.currentTime ??= 0
    this.playState = 'running'
  }

  reverse(): void {
    this.playbackRate = -this.playbackRate
    this.playState = 'running'
    this.reverseCalls += 1
  }

  private progress(): number | null {
    if (this.currentTime === null) return null
    const timing = this.timing as { delay?: number; duration?: number }
    const duration = timing.duration ?? 0
    if (duration <= 0) return 1
    return Math.max(0, Math.min(1, (this.currentTime - (timing.delay ?? 0)) / duration))
  }
}

class FakeStyle {
  private readonly values = new Map<string, string>()

  setProperty(name: string, value: string): void {
    this.values.set(name, value)
  }

  getPropertyValue(name: string): string {
    return this.values.get(name) ?? ''
  }

  removeProperty(name: string): void {
    this.values.delete(name)
  }
}

class FakeElement extends FakeNode {
  readonly animations: FakeAnimation[] = []
  readonly style = new FakeStyle()
  private readonly attributes = new Map<string, string>()

  constructor(readonly name: string) {
    super()
  }

  animate(keyframes: unknown, timing: unknown): FakeAnimation {
    const animation = new FakeAnimation(keyframes, timing)
    this.animations.push(animation)
    return animation
  }

  getAnimations(): FakeAnimation[] {
    return this.animations
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
      selector === '*' ||
      (selector === '[data-op-motion]' && this.attributes.has('data-op-motion')) ||
      (selector === '[data-op-motion-scope]' && this.attributes.has('data-op-motion-scope'))
    )
  }

  closest(selector: string): FakeElement | null {
    if (this.matches(selector)) return this
    for (let element = this.parentElement; element; element = element.parentElement) {
      if (element.matches(selector)) return element
    }
    return null
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

  constructor(private readonly callback: (entries: unknown[]) => void) {
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

  emit(entries: unknown[]): void {
    this.callback(entries)
  }
}

class FakeMediaQueryList extends EventTarget {
  matches = false

  setMatches(matches: boolean): void {
    if (this.matches === matches) return
    this.matches = matches
    this.dispatchEvent(new Event('change'))
  }
}

interface MotionDebugEntry {
  nodeId: string
  token: string
  reducedMotion: IRMotion['reducedMotion']
  trackId: string
  trigger: IRMotionTrigger
  source: 'automatic' | 'controlled' | 'idle' | 'stopped'
  playState: AnimationPlayState
  currentTime: number | null
  progress: number | null
  timing: {
    duration: number
    delay: number
    easing: string
    iterations: number | 'infinite'
    direction: PlaybackDirection
    fill: FillMode
  }
  exit: 'none' | 'reverse' | 'reset'
  stopped: boolean
}

interface MotionRuntimeHandle {
  dispose(): void
  inspect(
    targetNodeId?: string,
    scope?: FakeElement
  ): {
    capturedAt: number
    entries: readonly MotionDebugEntry[]
    activeAnimationCount: number
  }
  play(targetNodeId: string, trackId?: string, scope?: FakeElement): void
  pageExit(options?: { timeoutMs?: number }): Promise<{
    status: 'finished' | 'stopped' | 'timeout' | 'missing'
    trackCount: number
    animationCount: number
  }>
  stop(targetNodeId: string, trackId?: string, scope?: FakeElement): void
  toggle(targetNodeId: string, trackId?: string, scope?: FakeElement): void
  wait(
    targetNodeId: string,
    trackId?: string,
    scope?: FakeElement,
    options?: { timeoutMs?: number; stopOnTimeout?: boolean }
  ): Promise<{
    status: 'finished' | 'stopped' | 'timeout' | 'missing'
    targetNodeId: string
    trackId?: string
  }>
}

interface InstalledRuntime {
  mediaQuery: FakeMediaQueryList
  runtime: MotionRuntimeHandle
  stop(): void
}

let moduleNonce = 0
function runtimeFor(triggers: IRMotionTrigger[], includeProgrammaticTracks = false): string {
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
  return runtimeForMotion(motion, includeProgrammaticTracks)
}

function runtimeForMotion(motion: IRMotion, includeProgrammaticTracks = false): string {
  const runtime = buildMotionRuntime([{ token: 'nested', motion }], includeProgrammaticTracks)
  if (!runtime) throw new Error('Expected an interactive Motion runtime')
  return runtime
}

function policyMotion(
  reducedMotion: IRMotion['reducedMotion'],
  channel: 'opacity' | 'translate'
): IRMotion {
  return {
    version: 1,
    reducedMotion,
    tracks: [
      {
        id: 'enter',
        trigger: 'mount',
        exit: 'reset',
        keyframes:
          channel === 'opacity'
            ? [
                { offset: 0, opacity: 0 },
                { offset: 1, opacity: 1 }
              ]
            : [
                { offset: 0, x: -20 },
                { offset: 1, x: 0 }
              ],
        timing: {
          durationMs: 300,
          delayMs: 0,
          easing: 'linear',
          iterations: 1,
          direction: 'normal',
          fill: 'both'
        }
      }
    ]
  }
}

function transientPolicyMotion(reducedMotion: 'reduce' | 'disable'): IRMotion {
  const triggers = ['hover', 'focus', 'press', 'click', 'inView'] as const
  return {
    version: 1,
    reducedMotion,
    tracks: triggers.map((trigger, index) => ({
      id: `${trigger}-${index}`,
      trigger,
      exit: 'reset',
      keyframes: [
        { offset: 0, x: -20 },
        { offset: 1, x: 0 }
      ],
      timing: {
        durationMs: 300,
        delayMs: 0,
        easing: 'linear',
        iterations: 1,
        direction: 'normal',
        fill: 'both'
      }
    }))
  }
}

async function installRuntime(source: string, document: FakeDocument): Promise<InstalledRuntime> {
  FakeMutationObserver.latest = undefined
  FakeIntersectionObserver.latest = undefined
  const mediaQuery = new FakeMediaQueryList()
  const replacements: Record<string, unknown> = {
    document,
    Element: FakeElement,
    Node: FakeNode,
    MutationObserver: FakeMutationObserver,
    IntersectionObserver: FakeIntersectionObserver,
    window: { matchMedia: () => mediaQuery }
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

  const runtimeGlobal = globalThis as typeof globalThis & {
    __OPENPENCIL_MOTION_RUNTIME__?: MotionRuntimeHandle
  }
  const runtime = runtimeGlobal.__OPENPENCIL_MOTION_RUNTIME__
  if (!runtime) throw new Error('Motion runtime handle was not installed')
  let stopped = false
  return {
    mediaQuery,
    runtime,
    stop(): void {
      if (stopped) return
      stopped = true
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
  parent.setAttribute('data-node-id', 'shared-target')
  child.setAttribute('data-node-id', 'shared-target')
  return { document, parent, child, outside }
}

describe('compiler — generated Motion runtime execution', () => {
  test('toggles controlled tracks and awaits finish, stop, timeout, or missing targets', async () => {
    const { document, parent } = nestedDocument()
    parent.setAttribute('data-node-id', 'wait-target')
    const installed = await installRuntime(runtimeFor(['pageEnter', 'pageExit'], true), document)
    try {
      expect(installed.runtime.inspect('wait-target').entries).toEqual([
        expect.objectContaining({ trackId: 'pageEnter-0', source: 'automatic' }),
        expect.objectContaining({ trackId: 'pageExit-1', source: 'idle' })
      ])

      installed.runtime.toggle('wait-target', 'pageExit-1')
      expect(installed.runtime.inspect('wait-target').entries[1]?.source).toBe('controlled')
      const finished = installed.runtime.wait('wait-target', 'pageExit-1')
      parent.animations[1]?.finish()
      expect(await finished).toEqual({
        status: 'finished',
        targetNodeId: 'wait-target',
        trackId: 'pageExit-1'
      })

      installed.runtime.toggle('wait-target', 'pageExit-1')
      expect(installed.runtime.inspect('wait-target').entries[1]?.source).toBe('stopped')
      installed.runtime.toggle('wait-target', 'pageExit-1')
      const stopped = installed.runtime.wait('wait-target', 'pageExit-1')
      installed.runtime.stop('wait-target', 'pageExit-1')
      expect(await stopped).toMatchObject({ status: 'stopped' })

      installed.runtime.play('wait-target', 'pageExit-1')
      expect(
        await installed.runtime.wait('wait-target', 'pageExit-1', undefined, {
          timeoutMs: 0,
          stopOnTimeout: true
        })
      ).toMatchObject({ status: 'timeout' })
      expect(installed.runtime.inspect('wait-target').entries[1]?.source).toBe('stopped')
      expect(await installed.runtime.wait('missing')).toEqual({
        status: 'missing',
        targetNodeId: 'missing'
      })
    } finally {
      installed.stop()
    }
  })

  test('plays every mounted pageExit track once and shares the bounded in-flight wait', async () => {
    const { document, parent, child } = nestedDocument()
    const installed = await installRuntime(runtimeFor(['pageExit']), document)
    try {
      expect(parent.animations[0]).toMatchObject({ cancelCalls: 1, playCalls: 0 })
      expect(child.animations[0]).toMatchObject({ cancelCalls: 1, playCalls: 0 })

      const first = installed.runtime.pageExit({ timeoutMs: 1_000 })
      const concurrent = installed.runtime.pageExit({ timeoutMs: 0 })
      expect(concurrent).toBe(first)
      expect(parent.animations[0].playCalls).toBe(1)
      expect(child.animations[0].playCalls).toBe(1)

      parent.animations[0].finish()
      child.animations[0].finish()
      expect(await first).toEqual({ status: 'finished', trackCount: 2, animationCount: 2 })
    } finally {
      installed.stop()
    }
  })

  test('times out and cancels infinite pageExit tracks within the caller-independent cap', async () => {
    const motion: IRMotion = {
      ...policyMotion('allow', 'opacity'),
      tracks: [
        {
          ...policyMotion('allow', 'opacity').tracks[0],
          id: 'infinite-exit',
          trigger: 'pageExit' as const,
          timing: {
            ...policyMotion('allow', 'opacity').tracks[0].timing,
            iterations: 'infinite' as const
          }
        }
      ]
    }
    const { document, parent, child } = nestedDocument()
    const installed = await installRuntime(runtimeForMotion(motion), document)
    try {
      expect(await installed.runtime.pageExit({ timeoutMs: 0 })).toEqual({
        status: 'timeout',
        trackCount: 2,
        animationCount: 2
      })
      expect(parent.animations[0]).toMatchObject({ cancelCalls: 2, playCalls: 1 })
      expect(child.animations[0]).toMatchObject({ cancelCalls: 2, playCalls: 1 })
    } finally {
      installed.stop()
    }
  })

  test('passes MotionSpec v2 visual channels to real WAAPI keyframes', async () => {
    const motion: IRMotion = {
      version: 2,
      reducedMotion: 'allow',
      target: {
        kind: 'box',
        fillColor: { r: 1, g: 0.5, b: 0, a: 1 },
        fillOpacity: 1
      },
      tracks: [
        {
          id: 'advanced',
          trigger: 'click',
          exit: 'reset',
          path: {
            points: [
              { x: 0, y: 0 },
              { x: 20, y: 30 }
            ],
            autoRotate: true
          },
          keyframes: [
            {
              offset: 0,
              originX: 0.25,
              originY: 0.75,
              width: 120,
              fillColor: { r: 1, g: 0.5, b: 0, a: 0.5 },
              shadowX: 4,
              shadowY: 6,
              shadowBlur: 8,
              shadowSpread: 2,
              shadowColor: { r: 0, g: 0, b: 0, a: 0.4 },
              pathProgress: 0.25,
              trimStart: 0.25,
              trimEnd: 0.75,
              paddingTop: 10,
              paddingRight: 12,
              paddingBottom: 14,
              paddingLeft: 16,
              easing: { type: 'steps', steps: 4, position: 'end' }
            },
            { offset: 1, width: 160, pathProgress: 1 }
          ],
          timing: {
            durationMs: 200,
            delayMs: 0,
            easing: 'linear',
            iterations: 1,
            direction: 'normal',
            fill: 'both'
          }
        }
      ]
    }
    const { document, parent } = nestedDocument()
    const installed = await installRuntime(runtimeForMotion(motion), document)
    try {
      expect(parent.animations[0].keyframes).toEqual([
        expect.objectContaining({
          transformOrigin: '25% 75%',
          width: '120px',
          backgroundColor: 'rgba(255, 128, 0, 0.5)',
          boxShadow: '4px 6px 8px 2px rgba(0, 0, 0, 0.4)',
          offsetPath: 'path("M 30 0 L 50 30")',
          offsetDistance: '25%',
          offsetAnchor: '25% 75%',
          offsetRotate: 'auto',
          paddingTop: '10px',
          paddingRight: '12px',
          paddingBottom: '14px',
          paddingLeft: '16px',
          easing: 'steps(4, end)'
        }),
        expect.objectContaining({
          width: '160px',
          offsetPath: 'path("M 80 0 L 100 30")',
          offsetDistance: '100%',
          offsetAnchor: '50% 50%'
        })
      ])
    } finally {
      installed.stop()
    }
  })

  test('inspect reports automatic, controlled, idle, and stopped tracks without mutation', async () => {
    const { document, parent } = nestedDocument()
    parent.setAttribute('data-node-id', 'parent-target')
    const installed = await installRuntime(runtimeFor(['mount', 'hover'], true), document)
    try {
      parent.animations[0].currentTime = 40
      const countsBeforeInspect = parent.animations.map((animation) => ({
        cancelCalls: animation.cancelCalls,
        playCalls: animation.playCalls
      }))
      const initial = installed.runtime.inspect('parent-target')
      expect(typeof initial.capturedAt).toBe('number')
      expect(Object.isFrozen(initial)).toBe(true)
      expect(Object.isFrozen(initial.entries)).toBe(true)
      expect(initial.entries).toHaveLength(2)
      expect(initial.activeAnimationCount).toBe(2)
      expect(initial.entries[0]).toMatchObject({
        nodeId: 'parent-target',
        token: 'nested',
        reducedMotion: 'allow',
        trackId: 'mount-0',
        trigger: 'mount',
        source: 'automatic',
        playState: 'running',
        currentTime: 40,
        progress: 0.4,
        exit: 'reverse',
        stopped: false,
        timing: { duration: 100, delay: 0, easing: 'linear' }
      })
      expect(initial.entries[1]).toMatchObject({
        trackId: 'hover-1',
        source: 'idle',
        playState: 'idle',
        currentTime: null,
        progress: null
      })
      expect(
        parent.animations.map(({ cancelCalls, playCalls }) => ({ cancelCalls, playCalls }))
      ).toEqual(countsBeforeInspect)

      installed.runtime.play('parent-target', 'hover-1')
      expect(installed.runtime.inspect('parent-target').entries[1]).toMatchObject({
        source: 'controlled',
        playState: 'running',
        currentTime: 0,
        progress: 0,
        stopped: false
      })
      installed.runtime.stop('parent-target', 'hover-1')
      expect(installed.runtime.inspect('parent-target').entries[1]).toMatchObject({
        source: 'stopped',
        playState: 'idle',
        currentTime: null,
        progress: null,
        stopped: true
      })
      expect(installed.runtime.inspect('missing-target').entries).toEqual([])
    } finally {
      installed.stop()
    }
  })

  test('inspect safely includes CSS-only, unprepared, and removed elements', async () => {
    const document = new FakeDocument()
    const cssOnly = document.documentElement.append(new FakeElement('css-only'))
    cssOnly.setAttribute('data-op-motion', 'css-only')
    cssOnly.setAttribute('data-node-id', 'css-target')
    const cssAnimation = new FakeAnimation([], { duration: 200, delay: 0 })
    cssAnimation.animationName = 'op-css-only-0'
    cssAnimation.currentTime = 50
    cssOnly.animations.push(cssAnimation)
    const runtime = buildMotionRuntime([
      { token: 'css-only', motion: policyMotion('allow', 'opacity') },
      {
        token: 'interactive',
        motion: {
          ...policyMotion('allow', 'opacity'),
          tracks: [
            {
              ...policyMotion('allow', 'opacity').tracks[0],
              id: 'tap',
              trigger: 'click'
            }
          ]
        }
      }
    ])
    if (!runtime) throw new Error('Expected the interactive entry to install a runtime')
    const installed = await installRuntime(runtime, document)
    try {
      expect(cssOnly.animations).toHaveLength(1)
      expect(installed.runtime.inspect('css-target').entries[0]).toMatchObject({
        token: 'css-only',
        trackId: 'enter',
        source: 'automatic',
        playState: 'running',
        currentTime: 50,
        progress: 0.25
      })

      const unprepared = document.documentElement.append(new FakeElement('unprepared'))
      unprepared.setAttribute('data-op-motion', 'interactive')
      unprepared.setAttribute('data-node-id', 'late-target')
      expect(installed.runtime.inspect('late-target').entries[0]).toMatchObject({
        trackId: 'tap',
        source: 'idle',
        playState: 'idle',
        currentTime: null,
        progress: null
      })

      const mutation = FakeMutationObserver.latest
      document.documentElement.remove(unprepared)
      mutation?.emit([
        {
          type: 'childList',
          target: document.documentElement,
          addedNodes: [],
          removedNodes: [unprepared]
        }
      ])
      expect(installed.runtime.inspect('late-target').entries).toEqual([])
      expect(installed.runtime.inspect(undefined, unprepared).entries[0]).toMatchObject({
        source: 'idle',
        playState: 'idle'
      })
    } finally {
      installed.stop()
    }
  })

  test('devMode installs inspection without taking CSS-only tracks into WAAPI ownership', async () => {
    const document = new FakeDocument()
    const element = document.documentElement.append(new FakeElement('css-only'))
    element.setAttribute('data-op-motion', 'css-only')
    element.setAttribute('data-node-id', 'css-target')
    const runtime = buildMotionRuntime(
      [{ token: 'css-only', motion: policyMotion('allow', 'opacity') }],
      false,
      true
    )
    if (!runtime) throw new Error('Expected devMode to install the inspection handle')
    const installed = await installRuntime(runtime, document)
    try {
      expect(element.animations).toEqual([])
      expect(element.style.getPropertyValue('--op-css-only-0-name')).toBe('')
      expect(installed.runtime.inspect('css-target')).toMatchObject({
        activeAnimationCount: 0,
        entries: [{ trackId: 'enter', source: 'idle', playState: 'idle' }]
      })
    } finally {
      installed.stop()
    }
  })

  test('reacts to reduced-motion changes without restarting allow or losing control state', async () => {
    const document = new FakeDocument()
    const entries = [
      { token: 'allow', motion: policyMotion('allow', 'translate') },
      { token: 'reduce-opacity', motion: policyMotion('reduce', 'opacity') },
      { token: 'reduce-stopped', motion: policyMotion('reduce', 'translate') },
      { token: 'reduce-idle', motion: policyMotion('reduce', 'translate') },
      { token: 'disable', motion: policyMotion('disable', 'opacity') }
    ] as const
    const elements = Object.fromEntries(
      entries.map((entry) => {
        const element = document.documentElement.append(new FakeElement(entry.token))
        element.setAttribute('data-op-motion', entry.token)
        element.setAttribute('data-node-id', entry.token)
        return [entry.token, element]
      })
    ) as Record<(typeof entries)[number]['token'], FakeElement>
    const runtime = buildMotionRuntime(entries, true, true)
    if (!runtime) throw new Error('Expected programmatic Motion tracks to install')
    const installed = await installRuntime(runtime, document)
    try {
      installed.runtime.play('reduce-opacity', 'enter')
      installed.runtime.stop('reduce-stopped', 'enter')
      installed.mediaQuery.setMatches(true)

      expect(elements.allow.animations).toHaveLength(1)
      expect(elements.allow.animations[0]).toMatchObject({ cancelCalls: 0, playCalls: 0 })
      expect(elements['reduce-opacity'].animations).toHaveLength(2)
      expect(elements['reduce-opacity'].animations[1].timing).toMatchObject({ duration: 120 })
      expect(elements['reduce-opacity'].animations[1].keyframes).toEqual([
        { offset: 0, opacity: 0 },
        { offset: 1, opacity: 1 }
      ])
      elements['reduce-opacity'].animations[1].currentTime = 60
      expect(installed.runtime.inspect('reduce-opacity').entries[0]).toMatchObject({
        reducedMotion: 'reduce',
        source: 'controlled',
        playState: 'running',
        currentTime: 60,
        progress: 0.5,
        timing: { duration: 120, delay: 0 }
      })
      elements['reduce-opacity'].animations[1].effect.getComputedTiming = () => {
        throw new Error('detached effect timing')
      }
      expect(installed.runtime.inspect('reduce-opacity').entries[0].progress).toBe(0.5)
      expect(elements['reduce-stopped'].animations).toHaveLength(1)
      expect(installed.runtime.inspect('reduce-stopped').entries[0]).toMatchObject({
        source: 'stopped',
        playState: 'idle'
      })
      expect(elements['reduce-idle'].animations).toHaveLength(1)
      expect(installed.runtime.inspect('reduce-idle').entries[0]).toMatchObject({
        source: 'idle',
        playState: 'idle'
      })
      expect(elements.disable.animations).toHaveLength(1)
      expect(installed.runtime.inspect('disable').entries[0]).toMatchObject({
        reducedMotion: 'disable',
        source: 'idle',
        playState: 'idle'
      })

      installed.mediaQuery.setMatches(false)
      expect(elements.allow.animations).toHaveLength(1)
      expect(elements['reduce-opacity'].animations).toHaveLength(3)
      expect(elements['reduce-opacity'].animations[2].timing).toMatchObject({ duration: 300 })
      expect(installed.runtime.inspect('reduce-opacity').entries[0].source).toBe('controlled')
      expect(elements['reduce-stopped'].animations).toHaveLength(2)
      expect(installed.runtime.inspect('reduce-stopped').entries[0].source).toBe('stopped')
      expect(elements['reduce-idle'].animations).toHaveLength(2)
      expect(installed.runtime.inspect('reduce-idle').entries[0].source).toBe('automatic')
      expect(elements.disable.animations).toHaveLength(2)
      expect(installed.runtime.inspect('disable').entries[0].source).toBe('automatic')

      installed.stop()
      installed.mediaQuery.setMatches(true)
      expect(elements.allow.animations).toHaveLength(1)
      expect(elements['reduce-opacity'].animations).toHaveLength(3)
    } finally {
      installed.stop()
    }
  })

  test('restores active transient triggers across live reduce and disable policy changes', async () => {
    for (const policy of ['reduce', 'disable'] as const) {
      const document = new FakeDocument()
      const element = document.documentElement.append(new FakeElement(policy))
      element.setAttribute('data-op-motion', policy)
      element.setAttribute('data-node-id', `${policy}-target`)
      const runtime = buildMotionRuntime([{ token: policy, motion: transientPolicyMotion(policy) }])
      if (!runtime) throw new Error(`Expected ${policy} transient runtime`)
      const installed = await installRuntime(runtime, document)
      try {
        const intersection = FakeIntersectionObserver.latest
        document.emit('pointerover', { target: element, relatedTarget: null })
        document.emit('focusin', { target: element, relatedTarget: null })
        document.emit('pointerdown', { target: element, pointerId: 42 })
        document.emit('click', { target: element })
        intersection?.emit([{ target: element, isIntersecting: true }])
        expect(element.animations.map((animation) => animation.playCalls)).toEqual([1, 1, 1, 1, 1])

        installed.mediaQuery.setMatches(true)
        expect(element.animations).toHaveLength(5)
        expect(installed.runtime.inspect(`${policy}-target`).activeAnimationCount).toBe(0)

        installed.mediaQuery.setMatches(false)
        expect(element.animations).toHaveLength(10)
        const restored = element.animations.slice(5)
        expect(restored.map((animation) => animation.playCalls)).toEqual([1, 1, 1, 1, 1])

        document.emit('pointerout', { target: element, relatedTarget: null })
        document.emit('focusout', { target: element, relatedTarget: null })
        document.emit('pointerup', { target: element, pointerId: 42 })
        intersection?.emit([{ target: element, isIntersecting: false }])
        restored[3]?.finish()

        installed.mediaQuery.setMatches(true)
        installed.mediaQuery.setMatches(false)
        expect(element.animations).toHaveLength(15)
        expect(element.animations.slice(10).map((animation) => animation.playCalls)).toEqual([
          0, 0, 0, 0, 0
        ])
      } finally {
        installed.stop()
      }
    }
  })

  test('refreshes nested reduced-motion elements in one scan', async () => {
    const { document, parent, child } = nestedDocument()
    const runtime = buildMotionRuntime(
      [{ token: 'nested', motion: policyMotion('reduce', 'opacity') }],
      true,
      true
    )
    if (!runtime) throw new Error('Expected programmatic nested Motion')
    const installed = await installRuntime(runtime, document)
    try {
      expect(parent.animations).toHaveLength(1)
      expect(child.animations).toHaveLength(1)
      installed.mediaQuery.setMatches(true)
      expect(parent.animations).toHaveLength(2)
      expect(child.animations).toHaveLength(2)
    } finally {
      installed.stop()
    }
  })

  test('programmatic forwards fill persists without restarting CSS mount', async () => {
    const { document, parent, child } = nestedDocument()
    const installed = await installRuntime(runtimeFor(['mount', 'hover'], true), document)
    try {
      expect(parent.animations).toHaveLength(2)
      expect(child.animations).toHaveLength(2)
      expect(parent.style.getPropertyValue('--op-nested-0-name')).toBe('none')

      installed.runtime.play('shared-target', 'mount-0')
      expect(parent.animations).toHaveLength(2)
      expect(child.animations).toHaveLength(2)
      expect(parent.animations[0].cancelCalls).toBe(1)
      expect(parent.animations[0]).toMatchObject({ playCalls: 1 })
      expect(parent.animations[0].timing).toMatchObject({ duration: 100, fill: 'both' })

      parent.animations[0].finish()
      child.animations[0].finish()
      expect(parent.animations[0].cancelCalls).toBe(1)
      expect(child.animations[0].cancelCalls).toBe(1)

      installed.runtime.stop('shared-target', 'mount-0')
      expect(parent.animations[0].cancelCalls).toBe(2)
      expect(child.animations[0].cancelCalls).toBe(2)
    } finally {
      installed.stop()
    }
  })

  test('finite fill none resets after programmatic completion without restoring CSS', async () => {
    const motion: IRMotion = {
      version: 1,
      reducedMotion: 'allow',
      tracks: [
        {
          id: 'enter',
          trigger: 'mount',
          exit: 'reset',
          keyframes: [
            { offset: 0, opacity: 0 },
            { offset: 1, opacity: 1 }
          ],
          timing: {
            durationMs: 100,
            delayMs: 0,
            easing: 'linear',
            iterations: 1,
            direction: 'normal',
            fill: 'none'
          }
        }
      ]
    }
    const { document, parent } = nestedDocument()
    const installed = await installRuntime(runtimeForMotion(motion, true), document)
    try {
      installed.runtime.play('shared-target', 'enter')
      const programmatic = parent.animations[0]
      programmatic.finish()
      expect(programmatic.cancelCalls).toBe(2)
      expect(parent.animations).toHaveLength(1)
      expect(parent.style.getPropertyValue('--op-nested-0-name')).toBe('none')
    } finally {
      installed.stop()
    }
  })

  test('stops automatic and programmatic tracks with exact track filtering', async () => {
    const { document, parent, child } = nestedDocument()
    const installed = await installRuntime(runtimeFor(['mount', 'loop'], true), document)
    try {
      expect(parent.animations).toHaveLength(2)
      expect(child.animations).toHaveLength(2)
      installed.runtime.play('missing-target')
      installed.runtime.play('shared-target', 'missing-track')
      expect(parent.animations).toHaveLength(2)
      expect(child.animations).toHaveLength(2)

      installed.runtime.stop('shared-target', 'mount-0')
      expect(parent.animations[0].cancelCalls).toBe(1)
      expect(parent.animations[1].cancelCalls).toBe(0)
      expect(child.animations[0].cancelCalls).toBe(1)
      expect(child.animations[1].cancelCalls).toBe(0)

      installed.runtime.stop('shared-target')
      expect(parent.animations[1].cancelCalls).toBe(1)
      expect(child.animations[1].cancelCalls).toBe(1)

      installed.runtime.play('shared-target')
      expect(parent.animations).toHaveLength(2)
      expect(child.animations).toHaveLength(2)
      expect(parent.animations.map((animation) => animation.playCalls)).toEqual([1, 1])
      installed.runtime.stop('shared-target', 'mount-0')
      expect(parent.animations[0].cancelCalls).toBe(2)
      expect(parent.animations[1].cancelCalls).toBe(1)
      expect(child.animations[0].cancelCalls).toBe(2)
      expect(child.animations[1].cancelCalls).toBe(1)

      installed.runtime.stop('shared-target')
      installed.runtime.stop('missing-target', 'mount-0')
    } finally {
      installed.stop()
    }
  })

  test('keeps overlapping triggers in authored source order', async () => {
    const motion: IRMotion = {
      version: 1,
      reducedMotion: 'allow',
      tracks: [
        {
          id: 'press-first',
          trigger: 'press',
          exit: 'reset',
          keyframes: [
            { offset: 0, opacity: 1 },
            { offset: 1, opacity: 0.8 }
          ],
          timing: {
            durationMs: 100,
            delayMs: 0,
            easing: 'linear',
            iterations: 1,
            direction: 'normal',
            fill: 'both'
          }
        },
        {
          id: 'hover-later',
          trigger: 'hover',
          exit: 'reset',
          keyframes: [
            { offset: 0, opacity: 1 },
            { offset: 1, opacity: 0.4 }
          ],
          timing: {
            durationMs: 100,
            delayMs: 0,
            easing: 'linear',
            iterations: 1,
            direction: 'normal',
            fill: 'both'
          }
        }
      ]
    }
    const { document, parent } = nestedDocument()
    const installed = await installRuntime(runtimeForMotion(motion), document)
    try {
      document.emit('pointerover', { target: parent, relatedTarget: null })
      document.emit('pointerdown', { target: parent, pointerId: 19 })
      expect(parent.animations).toHaveLength(2)
      const ordered = parent.animations.map((animation) => {
        const frames = animation.keyframes as Array<{ opacity?: number }>
        return frames[1]?.opacity
      })
      expect(ordered).toEqual([0.8, 0.4])
      expect(parent.animations.map((animation) => animation.playCalls)).toEqual([1, 1])
      installed.runtime.play('shared-target', 'press-first', parent)
      expect(parent.animations).toHaveLength(2)
      expect(parent.animations.map((animation) => animation.playCalls)).toEqual([2, 1])
    } finally {
      installed.stop()
    }
  })

  test('dispatches nested hover, focus, pointer, keyboard, and click boundaries', async () => {
    const { document, parent, child, outside } = nestedDocument()
    const installed = await installRuntime(
      runtimeFor(['hover', 'focus', 'press', 'click']),
      document
    )
    try {
      document.emit('pointerover', { target: parent, relatedTarget: null })
      document.emit('pointerover', { target: child, relatedTarget: parent })
      expect(parent.animations).toHaveLength(4)
      expect(child.animations).toHaveLength(4)
      expect(parent.animations[0].playCalls).toBe(1)
      expect(child.animations[0].playCalls).toBe(1)

      document.emit('pointerout', { target: child, relatedTarget: outside })
      expect(parent.animations[0].reverseCalls).toBe(1)
      expect(child.animations[0].reverseCalls).toBe(1)

      document.emit('focusin', { target: child, relatedTarget: null })
      expect(parent.animations[1].playCalls).toBe(1)
      expect(child.animations[1].playCalls).toBe(1)
      document.emit('focusout', { target: child, relatedTarget: outside })
      expect(parent.animations[1].reverseCalls).toBe(1)
      expect(child.animations[1].reverseCalls).toBe(1)

      document.emit('pointerdown', { target: child, pointerId: 7 })
      expect(parent.animations[2].playCalls).toBe(1)
      expect(child.animations[2].playCalls).toBe(1)
      document.emit('pointerup', { target: outside, pointerId: 7 })
      expect(parent.animations[2].reverseCalls).toBe(1)
      expect(child.animations[2].reverseCalls).toBe(1)

      document.emit('keydown', { target: child, key: 'Enter', repeat: false })
      expect(parent.animations[2].playCalls).toBe(2)
      expect(child.animations[2].playCalls).toBe(2)
      document.emit('keyup', { target: outside, key: 'Enter' })
      expect(parent.animations[2].reverseCalls).toBe(2)
      expect(child.animations[2].reverseCalls).toBe(2)

      document.emit('click', { target: child })
      expect(parent.animations[3].playCalls).toBe(1)
      expect(child.animations[3].playCalls).toBe(1)
    } finally {
      installed.stop()
    }
  })

  test('does not restart an active mount track when hover enters', async () => {
    const { document, parent } = nestedDocument()
    const installed = await installRuntime(runtimeFor(['mount', 'hover']), document)
    try {
      const [mount, hover] = parent.animations
      expect(mount.cancelCalls).toBe(0)
      expect(hover.cancelCalls).toBe(1)

      document.emit('pointerover', { target: parent, relatedTarget: null })
      expect(parent.animations).toHaveLength(2)
      expect(mount).toMatchObject({ cancelCalls: 0, playCalls: 0 })
      expect(hover.playCalls).toBe(1)

      document.emit('pointerout', { target: parent, relatedTarget: null })
      document.emit('pointerover', { target: parent, relatedTarget: null })
      expect(mount).toMatchObject({ cancelCalls: 0, playCalls: 0 })
      expect(hover.playCalls).toBe(2)
    } finally {
      installed.stop()
    }
  })

  test('replays click only on click and not when hover later enters', async () => {
    const { document, parent } = nestedDocument()
    const installed = await installRuntime(runtimeFor(['click', 'hover']), document)
    try {
      const [click, hover] = parent.animations
      document.emit('click', { target: parent })
      click.finish()
      expect(click).toMatchObject({ cancelCalls: 1, playCalls: 1 })

      document.emit('pointerover', { target: parent, relatedTarget: null })
      expect(parent.animations).toHaveLength(2)
      expect(click).toMatchObject({ cancelCalls: 1, playCalls: 1 })
      expect(hover.playCalls).toBe(1)

      document.emit('click', { target: parent })
      expect(click.playCalls).toBe(2)
    } finally {
      installed.stop()
    }
  })

  test('scopes programmatic targets before falling back to the document', async () => {
    const document = new FakeDocument()
    const scopeA = document.documentElement.append(new FakeElement('scope-a'))
    const scopeB = document.documentElement.append(new FakeElement('scope-b'))
    scopeA.setAttribute('data-op-motion-scope', '')
    scopeB.setAttribute('data-op-motion-scope', '')
    const innerScope = scopeA.append(new FakeElement('inner-scope'))
    innerScope.setAttribute('data-op-motion-scope', '')
    const triggerA = innerScope.append(new FakeElement('trigger-a'))
    const triggerB = scopeB.append(new FakeElement('trigger-b'))
    const targetA = scopeA.append(new FakeElement('target-a'))
    const targetB = scopeB.append(new FakeElement('target-b'))
    for (const target of [triggerA, triggerB, targetA, targetB]) {
      target.setAttribute('data-op-motion', 'nested')
    }
    triggerA.setAttribute('data-node-id', 'self-target')
    triggerB.setAttribute('data-node-id', 'self-target')
    targetA.setAttribute('data-node-id', 'repeated-target')
    targetB.setAttribute('data-node-id', 'repeated-target')
    const installed = await installRuntime(runtimeFor(['click']), document)
    try {
      installed.runtime.play('repeated-target', 'click-0', triggerA)
      installed.runtime.play('self-target', 'click-0', triggerA)
      expect(targetA.animations[0].playCalls).toBe(1)
      expect(targetB.animations[0].playCalls).toBe(0)
      expect(triggerA.animations[0].playCalls).toBe(1)
      expect(triggerB.animations[0].playCalls).toBe(0)
      installed.runtime.stop('repeated-target', 'click-0', triggerA)
      expect(targetA.animations[0].cancelCalls).toBe(2)

      const emptyScope = document.documentElement.append(new FakeElement('empty-scope'))
      installed.runtime.play('repeated-target', 'click-0', emptyScope)
      expect(targetA.animations[0].playCalls).toBe(2)
      expect(targetB.animations[0].playCalls).toBe(1)
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
      expect(completedParent.cancelCalls).toBe(2)
      expect(intersection?.observed.has(parent)).toBe(false)
      expect(intersection?.observed.has(child)).toBe(true)

      parent.setAttribute('data-op-motion', 'nested')
      mutation?.emit([{ type: 'attributes', target: parent, addedNodes: [], removedNodes: [] }])
      expect(intersection?.observed.has(parent)).toBe(true)

      document.emit('pointerdown', { target: child, pointerId: 11 })
      const parentPress = parent.animations[4]
      const childPress = child.animations[1]
      document.documentElement.remove(parent)
      mutation?.emit([
        {
          type: 'childList',
          target: document.documentElement,
          addedNodes: [],
          removedNodes: [parent]
        }
      ])
      expect(parentPress.cancelCalls).toBe(2)
      expect(childPress.cancelCalls).toBe(2)
      expect(completedChild.cancelCalls).toBe(2)
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
      const cancelCalls = animation.cancelCalls
      animation.finish()
      document.documentElement.remove(parent)

      installed.stop()
      expect(animation.cancelCalls).toBe(cancelCalls)
    } finally {
      installed.stop()
    }
  })

  test('dispose releases CSS suppression for HMR fallback', async () => {
    const { document, parent } = nestedDocument()
    const installed = await installRuntime(runtimeFor(['mount'], true), document)
    try {
      expect(parent.style.getPropertyValue('--op-nested-0-name')).toBe('none')
      installed.stop()
      expect(parent.style.getPropertyValue('--op-nested-0-name')).toBe('')
    } finally {
      installed.stop()
    }
  })
})
