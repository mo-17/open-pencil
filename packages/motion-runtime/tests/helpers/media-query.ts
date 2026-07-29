type MediaChangeListener =
  | EventListenerOrEventListenerObject
  | ((this: MediaQueryList, event: MediaQueryListEvent) => unknown)

class FakeMediaQueryListEvent extends Event implements MediaQueryListEvent {
  readonly matches: boolean
  readonly media: string

  constructor(matches: boolean, media: string) {
    super('change')
    this.matches = matches
    this.media = media
  }
}

export class FakeReducedMotionQuery implements MediaQueryList {
  readonly media = '(prefers-reduced-motion: reduce)'
  readonly listeners = new Set<MediaChangeListener>()
  onchange: ((this: MediaQueryList, event: MediaQueryListEvent) => unknown) | null = null
  matches: boolean

  constructor(matches: boolean) {
    this.matches = matches
  }

  addEventListener<K extends keyof MediaQueryListEventMap>(
    type: K,
    listener: (this: MediaQueryList, event: MediaQueryListEventMap[K]) => unknown,
    options?: boolean | AddEventListenerOptions
  ): void
  addEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject | null,
    options?: boolean | AddEventListenerOptions
  ): void
  addEventListener(type: string, listener: MediaChangeListener | null): void {
    if (type === 'change' && listener) this.listeners.add(listener)
  }

  removeEventListener<K extends keyof MediaQueryListEventMap>(
    type: K,
    listener: (this: MediaQueryList, event: MediaQueryListEventMap[K]) => unknown,
    options?: boolean | EventListenerOptions
  ): void
  removeEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject | null,
    options?: boolean | EventListenerOptions
  ): void
  removeEventListener(type: string, listener: MediaChangeListener | null): void {
    if (type === 'change' && listener) this.listeners.delete(listener)
  }

  addListener(
    listener: ((this: MediaQueryList, event: MediaQueryListEvent) => unknown) | null
  ): void {
    if (listener) this.listeners.add(listener)
  }

  removeListener(
    listener: ((this: MediaQueryList, event: MediaQueryListEvent) => unknown) | null
  ): void {
    if (listener) this.listeners.delete(listener)
  }

  dispatchEvent(event: Event): boolean {
    if (event.type !== 'change') return true
    this.dispatch(event as MediaQueryListEvent)
    return !event.defaultPrevented
  }

  change(matches: boolean): void {
    this.matches = matches
    this.dispatch(new FakeMediaQueryListEvent(matches, this.media))
  }

  private dispatch(event: MediaQueryListEvent): void {
    this.onchange?.(event)
    for (const listener of this.listeners) {
      if (typeof listener === 'function') listener.call(this, event)
      else listener.handleEvent(event)
    }
  }
}

export interface InstalledMatchMedia {
  readonly callCount: number
  restore(): void
}

export function installMatchMedia(query: FakeReducedMotionQuery): InstalledMatchMedia {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'matchMedia')
  let callCount = 0
  Object.defineProperty(globalThis, 'matchMedia', {
    configurable: true,
    writable: true,
    value: ((media: string) => {
      if (media !== query.media) throw new Error(`Unexpected media query: ${media}`)
      callCount++
      return query
    }) satisfies typeof matchMedia
  })
  return {
    get callCount() {
      return callCount
    },
    restore() {
      if (descriptor) Object.defineProperty(globalThis, 'matchMedia', descriptor)
      else Reflect.deleteProperty(globalThis, 'matchMedia')
    }
  }
}

export function removeMatchMedia(): () => void {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'matchMedia')
  Reflect.deleteProperty(globalThis, 'matchMedia')
  return () => {
    if (descriptor) Object.defineProperty(globalThis, 'matchMedia', descriptor)
  }
}
