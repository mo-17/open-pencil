import { expect, test } from 'bun:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

import { pageViewportRuntimeSource } from '#compiler/adapters/page-viewport/runtime'
import type { IRPageViewport } from '#compiler/ir/layout'

interface HostPort {
  clientWidth: number
  ownerDocument: { defaultView: WindowPort }
}
interface WindowPort {
  getComputedStyle(): { paddingLeft: string; paddingRight: string }
  addEventListener(name: string, handler: () => void): unknown
  removeEventListener(name: string): unknown
  requestAnimationFrame(callback: () => void): number
  cancelAnimationFrame(id: number): void
  ResizeObserver?: new (handler: ObserverCallback) => {
    observe(target: HostPort): void
    disconnect(): void
  }
}
type ObserverCallback = (entries: { target: object; contentRect: { width: number } }[]) => void
interface CanvasPort {
  style: {
    getPropertyValue(name: string): string
    getPropertyPriority(): string
    setProperty(name: string, value: string): unknown
    removeProperty(name: string): unknown
  }
}
interface ViewportRuntime {
  mountPageViewport(host: HostPort, canvas: CanvasPort, config: IRPageViewport): () => void
  pageViewportCanvasStyle(config: IRPageViewport): Record<string, string | number>
  pageViewportContentStyle(config: IRPageViewport): Record<string, string | number>
}

const config: IRPageViewport = {
  version: 1,
  mode: 'fit-width',
  designWidth: 800,
  designHeight: 1200,
  originX: -80,
  originY: -40
}

async function withRuntime(
  run: (runtime: ViewportRuntime) => void | Promise<void>,
  minify = false
) {
  const directory = await mkdtemp(join(tmpdir(), 'openpencil-viewport-runtime-'))
  try {
    const path = join(directory, 'runtime.ts')
    await writeFile(path, pageViewportRuntimeSource())
    let modulePath = path
    if (minify) {
      const result = await Bun.build({ entrypoints: [path], target: 'browser', minify: true })
      if (!result.success) throw new Error('Viewport runtime production minification failed')
      modulePath = join(directory, 'runtime.mjs')
      await writeFile(modulePath, await result.outputs[0].text())
    }
    await run((await import(pathToFileURL(modulePath).href)) as ViewportRuntime)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

function domFixture(resizeObserver = true) {
  const values = new Map<string, string>([['zoom', '0.75']])
  let callback: ObserverCallback | undefined,
    disconnected = 0,
    observed: HostPort | undefined
  const events = new Map<string, () => void>()
  const frames = new Map<number, () => void>(),
    cancelled = new Map<number, () => void>()
  let frameId = 0
  const win: WindowPort = {
    getComputedStyle: () => ({ paddingLeft: '20px', paddingRight: '30px' }),
    addEventListener: (name: string, handler: () => void) => events.set(name, handler),
    removeEventListener: (name: string) => events.delete(name),
    requestAnimationFrame(handler) {
      const id = frameId++
      frames.set(id, handler)
      return id
    },
    cancelAnimationFrame(id) {
      const handler = frames.get(id)
      if (handler) cancelled.set(id, handler)
      frames.delete(id)
    },
    ResizeObserver: resizeObserver
      ? class {
          constructor(handler: ObserverCallback) {
            callback = handler
          }
          observe(element: HostPort) {
            observed = element
          }
          disconnect() {
            disconnected += 1
          }
        }
      : undefined
  }
  // These boundary objects exercise only the DOM operations used by the emitted kernel.
  const host: HostPort = { clientWidth: 450, ownerDocument: { defaultView: win } }
  const canvas: CanvasPort = {
    style: {
      getPropertyValue: (name: string) => values.get(name) ?? '',
      getPropertyPriority: () => 'important',
      setProperty: (name: string, value: string) => values.set(name, value),
      removeProperty: (name: string) => values.delete(name)
    }
  }
  return {
    host,
    canvas,
    values,
    events,
    observed: () => observed,
    disconnected: () => disconnected,
    pendingFrames: () => frames.size,
    cancelledFrames: () => cancelled.size,
    flushFrame() {
      const current = [...frames.values()]
      frames.clear()
      for (const handler of current) handler()
    },
    flushCancelledFrames() {
      for (const handler of cancelled.values()) handler()
    },
    resize(width: number, target: object = host) {
      callback?.([{ target, contentRect: { width } }])
    }
  }
}

test.each([false, true])(
  'emitted DOM kernel uses content width and keeps late callbacks disposed (minify=%s)',
  async (minify) => {
    await withRuntime((runtime) => {
      const fixture = domFixture()
      const stop = runtime.mountPageViewport(fixture.host, fixture.canvas, config)
      expect(fixture.observed()).toBe(fixture.host)
      expect(fixture.values.get('zoom')).toBe('0.5')
      fixture.resize(390)
      expect(fixture.values.get('zoom')).toBe('0.5')
      expect(fixture.pendingFrames()).toBe(1)
      fixture.flushFrame()
      expect(fixture.values.get('zoom')).toBe('0.4875')
      fixture.resize(0)
      fixture.resize(Number.NaN)
      fixture.resize(800, {})
      expect(fixture.values.get('zoom')).toBe('0.4875')
      fixture.resize(1600)
      fixture.flushFrame()
      expect(fixture.values.get('zoom')).toBe('2')
      stop()
      fixture.resize(320)
      expect(fixture.values.get('zoom')).toBe('0.75')
      expect(fixture.disconnected()).toBe(1)
    }, minify)
  }
)

test.each([false, true])(
  'observer notifications coalesce on the next frame and stop cancels owned work (minify=%s)',
  async (minify) => {
    await withRuntime((runtime) => {
      const fixture = domFixture()
      const stop = runtime.mountPageViewport(fixture.host, fixture.canvas, config)
      fixture.resize(320)
      fixture.resize(390)
      fixture.resize(0)
      fixture.resize(Number.POSITIVE_INFINITY)
      expect(fixture.values.get('zoom')).toBe('0.5')
      expect(fixture.pendingFrames()).toBe(1)
      fixture.flushFrame()
      expect(fixture.values.get('zoom')).toBe('0.4875')
      fixture.resize(390)
      expect(fixture.pendingFrames()).toBe(0)
      fixture.resize(768)
      expect(fixture.pendingFrames()).toBe(1)
      stop()
      expect(fixture.pendingFrames()).toBe(0)
      expect(fixture.cancelledFrames()).toBe(1)
      const stopNew = runtime.mountPageViewport(fixture.host, fixture.canvas, config)
      fixture.flushCancelledFrames()
      stop()
      expect(fixture.values.get('zoom')).toBe('0.5')
      stopNew()
      expect(fixture.values.get('zoom')).toBe('0.75')
    }, minify)
  }
)

test('fallback resize listener is removed; responsive and invalid widths install no observer', async () => {
  await withRuntime((runtime) => {
    const fixture = domFixture(false)
    const stop = runtime.mountPageViewport(fixture.host, fixture.canvas, config)
    expect(fixture.events.has('resize')).toBe(true)
    fixture.host.clientWidth = 690
    fixture.events.get('resize')?.()
    fixture.host.clientWidth = 450
    fixture.events.get('resize')?.()
    expect(fixture.pendingFrames()).toBe(1)
    expect(fixture.values.get('zoom')).toBe('0.5')
    fixture.flushFrame()
    expect(fixture.values.get('zoom')).toBe('0.5')
    stop()
    expect(fixture.events.size).toBe(0)
    const untouched = domFixture()
    runtime.mountPageViewport(untouched.host, untouched.canvas, { ...config, mode: 'responsive' })()
    runtime.mountPageViewport(untouched.host, untouched.canvas, {
      ...config,
      designWidth: Number.NaN
    })()
    expect(untouched.observed()).toBeUndefined()
    expect(untouched.values.get('zoom')).toBe('0.75')
  })
})

test('normalized content creates no phantom-sized overflow box and responsive fills available width', async () => {
  await withRuntime((runtime) => {
    expect(runtime.pageViewportCanvasStyle(config)).toMatchObject({
      width: '800px',
      height: '1200px',
      minHeight: 0
    })
    expect(runtime.pageViewportContentStyle(config)).toEqual({
      position: 'absolute',
      left: '80px',
      top: '40px',
      width: 0,
      height: 0
    })
    expect(runtime.pageViewportCanvasStyle({ ...config, mode: 'responsive' })).toMatchObject({
      width: '100%',
      minWidth: 0,
      minHeight: '100dvh'
    })
  })
})
