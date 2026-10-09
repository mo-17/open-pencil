import { describe, expect, test } from 'bun:test'
import { runInNewContext } from 'node:vm'

import { effectPickRuntimeSource } from '#compiler/adapters/effect-pick/source'

import {
  EFFECT_PICK_CATALOG,
  type EffectPickCatalogEntry,
  type EffectPickConfigV1
} from '@open-pencil/core/plugins'

const NEW_EFFECT_IDS = [
  'arrow-expand',
  'border-trace',
  'gradient-button',
  'underline-slide',
  'aurora-curtains',
  'gradient-mesh',
  'hex-grid-pulse',
  'perspective-grid-floor',
  'text-mask-reveal',
  'outline-fill',
  'gradient-stroke-text',
  'text-zoom-trail',
  'tilt-card',
  'glare-card',
  'exploded-layer-card',
  'gatefold-reveal-card',
  'gooey-dots',
  'infinity-runner',
  'newtons-cradle',
  'equalizer-bars'
] as const

function entry(id: string): EffectPickCatalogEntry {
  const found = EFFECT_PICK_CATALOG.find((candidate) => candidate.id === id)
  if (!found) throw new Error(`Missing reviewed effect ${id}`)
  return found
}

class RuntimeEvents extends EventTarget {
  readonly listeners = new Map<string, Set<EventListenerOrEventListenerObject>>()

  override addEventListener(
    type: string,
    callback: EventListenerOrEventListenerObject | null,
    options?: AddEventListenerOptions | boolean
  ): void {
    if (callback) {
      const listeners = this.listeners.get(type) ?? new Set()
      listeners.add(callback)
      this.listeners.set(type, listeners)
    }
    super.addEventListener(type, callback, options)
  }

  override removeEventListener(
    type: string,
    callback: EventListenerOrEventListenerObject | null,
    options?: EventListenerOptions | boolean
  ): void {
    if (callback) this.listeners.get(type)?.delete(callback)
    super.removeEventListener(type, callback, options)
  }

  get listenerCount(): number {
    return [...this.listeners.values()].reduce((count, listeners) => count + listeners.size, 0)
  }
}

class RuntimeAnimation {
  state: 'running' | 'paused' | 'idle' = 'running'
  readonly rates: number[] = []

  updatePlaybackRate(rate: number): void {
    this.rates.push(rate)
  }
  play(): void {
    this.state = 'running'
  }
  pause(): void {
    this.state = 'paused'
  }
  cancel(): void {
    this.state = 'idle'
  }
}

class RuntimeTransition extends RuntimeAnimation {}

class RuntimeStyle {
  readonly values = new Map<string, string>()
  setProperty(name: string, value: string): void {
    this.values.set(name, value)
  }
  getPropertyValue(name: string): string {
    return this.values.get(name) ?? ''
  }
}

/** Only the generated runtime's DOM boundary; no HTML parser, layout or CSS engine. */
class RuntimeElement extends RuntimeEvents {
  readonly style = new RuntimeStyle()
  readonly attributes = new Map<string, string>()
  readonly animations: RuntimeAnimation[] = []
  children: RuntimeElement[] = []
  parent: RuntimeElement | null = null
  shadowRoot: RuntimeElement | null = null
  className = ''
  textContent = ''
  innerHTML = ''
  isConnected = true
  readonly offsetWidth = 224

  constructor(
    readonly ownerDocument: RuntimeDocument,
    readonly tagName = 'div'
  ) {
    super()
  }

  attachShadow(_options: { mode: 'open' }): RuntimeElement {
    this.shadowRoot = new RuntimeElement(this.ownerDocument, 'shadow')
    return this.shadowRoot
  }

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value)
  }
  hasAttribute(name: string): boolean {
    return this.attributes.has(name)
  }
  toggleAttribute(name: string, force: boolean): void {
    if (force) this.setAttribute(name, '')
    else this.attributes.delete(name)
  }

  querySelector(selector: string): RuntimeElement | null {
    if (selector !== '[data-effect-pick-surface]')
      throw new Error(`Unexpected selector ${selector}`)
    return this.children.find((child) => child.hasAttribute('data-effect-pick-surface')) ?? null
  }

  replaceChildren(...children: RuntimeElement[]): void {
    this.children.forEach((child) => {
      child.parent = null
    })
    this.children = children
    children.forEach((child) => {
      child.parent = this
    })
  }

  remove(): void {
    if (this.parent) this.parent.children = this.parent.children.filter((child) => child !== this)
    this.parent = null
  }

  getAnimations(_options: { subtree: boolean }): RuntimeAnimation[] {
    return this.animations.filter((animation) => animation.state !== 'idle')
  }
}

class RuntimeButton extends RuntimeElement {}

class RuntimeMediaQuery extends RuntimeEvents {
  matches = false
  change(matches: boolean): void {
    this.matches = matches
    this.dispatchEvent(new Event('change'))
  }
}

type RuntimeIntersectionCallback = (entries: readonly { isIntersecting: boolean }[]) => void

class RuntimeObserver {
  disconnected = false
  host: RuntimeElement | null = null
  constructor(readonly callback: RuntimeIntersectionCallback) {}
  observe(host: RuntimeElement): void {
    this.host = host
  }
  disconnect(): void {
    this.disconnected = true
    this.host = null
  }
  change(isIntersecting: boolean): void {
    this.callback([{ isIntersecting }])
  }
}

class RuntimeDocument extends RuntimeEvents {
  hidden = false
  readonly reduced = new RuntimeMediaQuery()
  readonly observers: RuntimeObserver[] = []
  readonly defaultView = {
    Event,
    HTMLButtonElement: RuntimeButton,
    CSSTransition: RuntimeTransition,
    crypto,
    IntersectionObserver: this.observerConstructor(),
    matchMedia: (_query: string) => this.reduced
  }

  private observerConstructor() {
    const observers = this.observers
    return class extends RuntimeObserver {
      constructor(callback: RuntimeIntersectionCallback) {
        super(callback)
        observers.push(this)
      }
    }
  }

  createElement(tag: string): RuntimeElement {
    return tag === 'button' ? new RuntimeButton(this, tag) : new RuntimeElement(this, tag)
  }
}

class RuntimeClick extends Event {
  stopped = false
  constructor(readonly path: [EventTarget]) {
    super('click', { bubbles: true })
  }
  override composedPath(): [EventTarget] {
    return this.path
  }
  override stopPropagation(): void {
    this.stopped = true
    super.stopPropagation()
  }
}

interface EffectPickController {
  play(): void
  pause(): void
  replay(): void
  setReducedMotion(value: boolean): void
  setConfig(value: unknown): boolean
  destroy(): void
}

function isController(value: unknown): value is EffectPickController {
  return (
    typeof value === 'object' &&
    value !== null &&
    ['play', 'pause', 'replay', 'setReducedMotion', 'setConfig', 'destroy'].every(
      (name) => typeof Reflect.get(value, name) === 'function'
    )
  )
}

function runtime(artifacts: readonly EffectPickCatalogEntry[] = EFFECT_PICK_CATALOG) {
  // Share only Object identity so authored plain data passes the cross-realm record check.
  const mount: unknown = runInNewContext(effectPickRuntimeSource(artifacts) + '\nmountEffectPick', {
    Object
  })
  if (typeof mount !== 'function') throw new Error('Missing generated mount function')
  const document = new RuntimeDocument()
  return {
    document,
    host: () => document.createElement('section'),
    mount(host: RuntimeElement, config: unknown, onClick?: (event: RuntimeClick) => void) {
      const controller: unknown = mount(host, config, onClick)
      if (!isController(controller)) throw new Error('Missing generated controller')
      return controller
    }
  }
}

function surface(host: RuntimeElement): RuntimeElement {
  const value = host.shadowRoot?.querySelector('[data-effect-pick-surface]')
  if (!value) throw new Error('Missing mounted surface')
  return value
}

function effect(host: RuntimeElement): RuntimeElement {
  const value = surface(host).children[0]
  if (!value) throw new Error('Missing effect element')
  return value
}

function renderedStyle(host: RuntimeElement): string {
  return host.shadowRoot?.children.find((child) => child.tagName === 'style')?.textContent ?? ''
}

function click(host: RuntimeElement, button = true): RuntimeClick {
  const target = host.ownerDocument.createElement(button ? 'button' : 'span')
  const event = new RuntimeClick([target])
  surface(host).dispatchEvent(event)
  return event
}

describe('EffectPick generated runtime contract', () => {
  for (const id of NEW_EFFECT_IDS) {
    test(`mounts reviewed ${id} and projects bounded authored configuration`, () => {
      const fixture = runtime(),
        host = fixture.host(),
        reviewed = entry(id)
      const config: EffectPickConfigV1 = {
        ...reviewed.defaultConfig,
        text: '<img src=x onerror="bad"> & 🐸 __EP_INSTANCE__',
        color: '#12345678',
        secondaryColor: '#ABCDEF',
        speed: 2.5
      }
      const controller = fixture.mount(host, config)
      try {
        const mounted = effect(host)
        expect(mounted.className).toBe(`fx fx-${id}`)
        expect(mounted.style.getPropertyValue('--fx-accent')).toBe(config.color)
        expect(mounted.style.getPropertyValue('--fx-secondary')).toBe(config.secondaryColor)
        expect(mounted.style.getPropertyValue('--fx-bg')).toBe(config.secondaryColor)
        expect(mounted.style.getPropertyValue('--fx-duration')).toBe(
          `${reviewed.artifact.durationMs}ms`
        )
        expect(mounted.style.getPropertyValue('--fx-speed')).toBe('2.5')
        expect(mounted.attributes.get('aria-label')).toBe(config.text)
        expect(renderedStyle(host)).toContain(reviewed.artifact.css)
        expect(mounted.innerHTML).not.toContain('<img')
        if (reviewed.editableFields.includes('text')) {
          expect(mounted.innerHTML).toContain(
            '&lt;img src=x onerror=&quot;bad&quot;&gt; &amp; 🐸 __EP_INSTANCE__'
          )
        }
        const animation = new RuntimeAnimation(),
          transition = new RuntimeTransition()
        surface(host).animations.push(animation, transition)
        controller.play()
        expect(animation.rates).toEqual([2.5])
        expect(transition.rates).toEqual([])
        controller.pause()
        expect(animation.state).toBe('paused')
        expect(transition.state).toBe('paused')
      } finally {
        controller.destroy()
      }
    })
  }

  test('rejects invalid identity and input without changing mounted configuration', () => {
    const fixture = runtime(),
      host = fixture.host(),
      reviewed = entry('arrow-expand')
    const config = { ...reviewed.defaultConfig }
    const controller = fixture.mount(host, config)
    try {
      const original = effect(host)
      const getter = Object.defineProperty({ ...config }, 'text', {
        enumerable: true,
        get: () => 'hidden'
      })
      const invalid = [
        { ...config, collectionVersion: '0.6.0' },
        { ...config, artifactDigest: entry('underline-slide').artifactDigest },
        { ...config, effectId: 'missing-effect' },
        { ...config, effectId: 'diagonal-fill' },
        { ...config, text: '🐸'.repeat(81) },
        { ...config, color: 'url(https://example.invalid/image)' },
        { ...config, secondaryColor: '#123' },
        ...[Number.NaN, Infinity, -Infinity, 0.09, 4.01, '2'].map((speed) => ({
          ...config,
          speed
        })),
        { ...config, extra: true },
        getter,
        Object.assign(Object.create({}), config)
      ]
      for (const next of invalid) {
        expect(controller.setConfig(next)).toBe(false)
        expect(effect(host)).toBe(original)
        const rejectedHost = fixture.host()
        expect(() => fixture.mount(rejectedHost, next)).toThrow('configuration rejected')
        expect(rejectedHost.shadowRoot).toBeNull()
      }
      for (const speed of [0.1, 4]) {
        expect(controller.setConfig({ ...config, text: '🐸'.repeat(80), speed })).toBe(true)
        expect(effect(host).style.getPropertyValue('--fx-speed')).toBe(String(speed))
      }
    } finally {
      controller.destroy()
    }
  })

  test('preserves pause across legacy-to-new changes and disposes all listeners', () => {
    const fixture = runtime(),
      host = fixture.host()
    const controller = fixture.mount(host, entry('diagonal-fill').defaultConfig)
    const animation = new RuntimeAnimation()
    surface(host).animations.push(animation)
    controller.pause()
    for (const id of NEW_EFFECT_IDS) {
      expect(controller.setConfig({ ...entry(id).defaultConfig, speed: 3 })).toBe(true)
      expect(surface(host).hasAttribute('data-effect-pick-paused')).toBe(true)
      expect(effect(host).className).toBe(`fx fx-${id}`)
    }
    expect(animation.state).toBe('idle')
    const next = new RuntimeAnimation()
    surface(host).animations.push(next)
    fixture.document.dispatchEvent(new Event('visibilitychange'))
    expect(next.rates).toEqual([3])
    expect(next.state).toBe('paused')
    controller.replay()
    expect(next.state).toBe('idle')
    expect(surface(host).hasAttribute('data-effect-pick-paused')).toBe(false)
    const last = new RuntimeAnimation(),
      mountedSurface = surface(host)
    mountedSurface.animations.push(last)
    expect(fixture.document.listenerCount).toBe(1)
    expect(fixture.document.reduced.listenerCount).toBe(1)
    controller.destroy()
    controller.destroy()
    expect(last.state).toBe('idle')
    expect(mountedSurface.listenerCount).toBe(0)
    expect(fixture.document.listenerCount).toBe(0)
    expect(fixture.document.reduced.listenerCount).toBe(0)
    expect(fixture.document.observers.every((observer) => observer.disconnected)).toBe(true)
    expect(host.shadowRoot?.children).toEqual([])
    expect(controller.setConfig(entry('arrow-expand').defaultConfig)).toBe(false)
    controller.play()
    controller.pause()
    controller.replay()
    expect(host.shadowRoot?.children).toEqual([])
  })

  test('applies document and reduced-motion suspension independently of requested play', () => {
    const fixture = runtime(),
      host = fixture.host()
    const controller = fixture.mount(host, entry('gooey-dots').defaultConfig)
    const animation = new RuntimeAnimation()
    surface(host).animations.push(animation)
    try {
      const observer = fixture.document.observers[0]
      if (!observer) throw new Error('Missing runtime intersection observer')
      expect(observer.host).toBe(host)
      observer.change(false)
      expect(animation.state).toBe('paused')
      observer.change(true)
      expect(animation.state).toBe('running')
      fixture.document.hidden = true
      fixture.document.dispatchEvent(new Event('visibilitychange'))
      expect(animation.state).toBe('paused')
      fixture.document.hidden = false
      fixture.document.dispatchEvent(new Event('visibilitychange'))
      expect(animation.state).toBe('running')
      fixture.document.reduced.change(true)
      expect(surface(host).hasAttribute('data-effect-pick-reduced-motion')).toBe(true)
      expect(animation.state).toBe('paused')
      fixture.document.reduced.change(false)
      controller.setReducedMotion(true)
      expect(animation.state).toBe('paused')
      controller.pause()
      controller.setReducedMotion(false)
      expect(animation.state).toBe('paused')
      controller.play()
      expect(animation.state).toBe('running')
    } finally {
      controller.destroy()
    }
  })

  test('namespaces local SVG references and isolates instances and replacement cleanup', () => {
    const svgEntries = NEW_EFFECT_IDS.map(entry).filter((candidate) =>
      candidate.artifact.markup.includes('__EP_INSTANCE__')
    )
    expect(svgEntries).toHaveLength(2)
    for (const svgEntry of svgEntries) {
      const fixture = runtime(),
        first = fixture.host(),
        second = fixture.host()
      const a = fixture.mount(first, svgEntry.defaultConfig),
        b = fixture.mount(second, svgEntry.defaultConfig)
      try {
        const firstMarkup = effect(first).innerHTML,
          secondMarkup = effect(second).innerHTML
        const firstIds = [...firstMarkup.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1])
        const secondIds = new Set(
          [...secondMarkup.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1])
        )
        expect(firstIds.length).toBeGreaterThan(0)
        expect(firstIds.every((id) => !secondIds.has(id))).toBe(true)
        for (const markup of [firstMarkup, secondMarkup]) {
          for (const match of markup.matchAll(/url\(#([^)]*)\)/g))
            expect(markup).toContain(`id="${match[1]}"`)
        }
        const priorSurface = surface(first),
          prior = new RuntimeAnimation()
        priorSurface.animations.push(prior)
        const replacement = fixture.mount(first, entry('arrow-expand').defaultConfig)
        try {
          expect(prior.state).toBe('idle')
          expect(priorSurface.listenerCount).toBe(0)
          expect(a.setConfig(svgEntry.defaultConfig)).toBe(false)
          expect(effect(second).innerHTML).toBe(secondMarkup)
          expect(fixture.document.listenerCount).toBe(2)
        } finally {
          replacement.destroy()
        }
      } finally {
        a.destroy()
        b.destroy()
      }
      expect(fixture.document.listenerCount).toBe(0)
      expect(fixture.document.reduced.listenerCount).toBe(0)
    }
  })

  test('forwards only the five supported button events and updates the gate on switch', () => {
    const fixture = runtime(),
      host = fixture.host(),
      calls: RuntimeClick[] = []
    const controller = fixture.mount(host, entry('diagonal-fill').defaultConfig, (event) =>
      calls.push(event)
    )
    try {
      for (const id of ['diagonal-fill', ...NEW_EFFECT_IDS]) {
        controller.setConfig(entry(id).defaultConfig)
        const before = calls.length,
          dispatched = click(host)
        const supported = [
          'diagonal-fill',
          'arrow-expand',
          'border-trace',
          'gradient-button',
          'underline-slide'
        ].includes(id)
        expect(calls.length - before).toBe(supported ? 1 : 0)
        expect(dispatched.stopped).toBe(supported)
        expect(click(host, false).stopped).toBe(false)
      }
      controller.setConfig(entry('arrow-expand').defaultConfig)
      host.isConnected = false
      const before = calls.length
      expect(click(host).stopped).toBe(false)
      expect(calls).toHaveLength(before)
    } finally {
      controller.destroy()
    }
  })

  test('rejects unreviewed artifacts before producing executable runtime', () => {
    const reviewed = entry('arrow-expand')
    expect(() =>
      effectPickRuntimeSource([{ ...reviewed, artifactDigest: '0'.repeat(64) }])
    ).toThrow('reviewed catalog')
    expect(() => effectPickRuntimeSource([{ ...reviewed, collectionVersion: '0.6.0' }])).toThrow(
      'reviewed catalog'
    )
  })
})
