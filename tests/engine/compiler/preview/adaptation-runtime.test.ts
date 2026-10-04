import { describe, expect, test } from 'bun:test'
import { Script, createContext } from 'node:vm'

import { buildPreviewAdaptationRuntime } from '#compiler/adapters/preview-adaptation/runtime'
import { buildPreviewBridge } from '#compiler/adapters/preview-bridge'

import { compile, withDefaults } from '@open-pencil/compiler'
import { SceneGraph } from '@open-pencil/scene-graph'

interface AdaptationRuntime {
  update(value: { revision: number; textScale: number; diagnostics: boolean }): void
  dispose(): void
}
interface Report {
  type: string
  revision: number
  items: { nodeId: string; kind: string }[]
  truncated: boolean
}
class Style {
  values = new Map<string, string>()
  priorities = new Map<string, string>()
  getPropertyValue(name: string) {
    return this.values.get(name) ?? ''
  }
  getPropertyPriority(name: string) {
    return this.priorities.get(name) ?? ''
  }
  setProperty(name: string, value: string, priority = '') {
    this.values.set(
      name,
      value.endsWith('px') ? String(Math.round(Number.parseFloat(value) * 1e6) / 1e6) + 'px' : value
    )
    this.priorities.set(name, priority)
  }
  removeProperty(name: string) {
    this.values.delete(name)
    this.priorities.delete(name)
  }
}
class ElementPort {
  style = new Style()
  classList: string[] = []
  parentElement: ElementPort | null = null
  children: ElementPort[] = []
  hidden = false
  nodeId: string | null = null
  tagName = 'DIV'
  firstChild: { nodeType: number; nextSibling: null } | null = null
  baseFont: number | null = null
  baseLine: number | null = null
  css: Record<string, string> = {}
  rect = { left: 0, right: 100, width: 100, height: 40 }
  clientHeight = 40
  clientWidth = 100
  scrollHeight = 40
  scrollWidth = 100
  getAttribute(name: string) {
    return name === 'data-node-id' ? this.nodeId : null
  }
  getBoundingClientRect() {
    return this.rect
  }
  append(child: ElementPort) {
    child.parentElement = this
    this.children.push(child)
  }
}
type Callback = () => void

function runtimeFixture() {
  const body = new ElementPort()
  body.baseFont = 16
  body.baseLine = 24
  const frames = new Map<number, Callback>()
  const events = new Map<string, Callback>()
  const fontEvents = new Map<string, Callback>()
  const observers: { mutation?: Callback; resize?: (entries: unknown[]) => void } = {}
  const reports: Report[] = []
  let nextFrame = 1
  let disconnected = 0
  let observed = 0
  const flatten = (element: ElementPort): ElementPort[] =>
    element.children.flatMap((child) => [child, ...flatten(child)])
  const computed = (element: ElementPort): Record<string, unknown> => {
    const font =
      Number.parseFloat(element.style.getPropertyValue('font-size')) ||
      element.baseFont ||
      (element.parentElement
        ? Number.parseFloat(String(computed(element.parentElement).fontSize))
        : 16)
    const line =
      Number.parseFloat(element.style.getPropertyValue('line-height')) ||
      element.baseLine ||
      font * 1.5
    return {
      fontSize: String(font) + 'px',
      lineHeight: String(line) + 'px',
      display: 'block',
      visibility: 'visible',
      opacity: '1',
      overflowX: 'visible',
      overflowY: 'visible',
      textOverflow: 'clip',
      paddingTop: '0px',
      paddingBottom: '0px',
      ...element.css,
      getPropertyValue: (name: string) => element.css[name] ?? ''
    }
  }
  const context = createContext({
    HTMLElement: ElementPort,
    Node: { TEXT_NODE: 3 },
    NodeFilter: { SHOW_ELEMENT: 1 },
    window: {
      innerWidth: 360,
      addEventListener: (name: string, handler: Callback) => events.set(name, handler),
      removeEventListener: (name: string) => events.delete(name)
    },
    document: {
      body,
      documentElement: new ElementPort(),
      fonts: {
        ready: Promise.resolve(),
        addEventListener: (name: string, handler: Callback) => fontEvents.set(name, handler),
        removeEventListener: (name: string) => fontEvents.delete(name)
      },
      createTreeWalker: () => {
        const nodes = flatten(body)
        let index = 0
        return { nextNode: () => nodes[index++] ?? null }
      }
    },
    getComputedStyle: computed,
    requestAnimationFrame: (handler: Callback) => {
      const id = nextFrame++
      frames.set(id, handler)
      return id
    },
    cancelAnimationFrame: (id: number) => frames.delete(id),
    MutationObserver: class {
      constructor(callback: Callback) {
        observers.mutation = callback
      }
      observe() {
        observed++
      }
      disconnect() {
        disconnected++
      }
    },
    ResizeObserver: class {
      constructor(callback: (entries: unknown[]) => void) {
        observers.resize = callback
      }
      observe() {
        observed++
      }
      disconnect() {
        disconnected++
      }
    },
    post: (report: Report) => reports.push(report)
  })
  const source = new Bun.Transpiler({ loader: 'ts' }).transformSync(buildPreviewAdaptationRuntime())
  const runtime = new Script(source + '\ncreatePreviewAdaptation(post)').runInContext(
    context
  ) as AdaptationRuntime
  return {
    body,
    frames,
    events,
    fontEvents,
    observers,
    reports,
    runtime,
    disconnected: () => disconnected,
    observed: () => observed,
    flush() {
      const pending = [...frames.values()]
      frames.clear()
      for (const run of pending) run()
    },
    element(nodeId: string, parent = body) {
      const element = new ElementPort()
      element.nodeId = nodeId
      parent.append(element)
      return element
    }
  }
}

describe('emitted adaptation runtime', () => {
  test('snapshots inherited fonts before writes and rescans new descendants without double scaling', () => {
    const fixture = runtimeFixture()
    const parent = fixture.element('parent')
    const child = fixture.element('child', parent)
    fixture.runtime.update({ revision: 1, textScale: 2, diagnostics: false })
    fixture.flush()
    expect(parent.style.getPropertyValue('font-size')).toBe('32px')
    expect(child.style.getPropertyValue('font-size')).toBe('32px')
    const inserted = fixture.element('new-child', parent)
    fixture.observers.mutation?.()
    fixture.flush()
    expect(inserted.style.getPropertyValue('font-size')).toBe('32px')
    expect(child.style.getPropertyValue('font-size')).toBe('32px')
    fixture.runtime.dispose()
  })

  test('restores original value/priority and leaves application replacements intact', () => {
    const fixture = runtimeFixture()
    const label = fixture.element('label')
    label.style.setProperty('font-size', '16.3px', 'important')
    label.style.setProperty('line-height', '20px')
    fixture.runtime.update({ revision: 1, textScale: 1.3, diagnostics: false })
    fixture.flush()
    expect(label.style.getPropertyValue('font-size')).toBe('21.19px')
    fixture.runtime.update({ revision: 2, textScale: 1, diagnostics: false })
    expect(label.style.getPropertyValue('font-size')).toBe('16.3px')
    expect(label.style.getPropertyPriority('font-size')).toBe('important')
    expect(label.style.getPropertyValue('line-height')).toBe('20px')
    expect(label.style.getPropertyPriority('line-height')).toBe('')
    fixture.runtime.update({ revision: 3, textScale: 2, diagnostics: false })
    fixture.flush()
    label.style.setProperty('font-size', '30px')
    fixture.runtime.dispose()
    expect(label.style.getPropertyValue('font-size')).toBe('30px')
    expect(label.style.getPropertyValue('line-height')).toBe('20px')
  })

  test('coalesces observer/font/resize work and cancels it on off or dispose', () => {
    const fixture = runtimeFixture()
    fixture.runtime.update({ revision: 1, textScale: 2, diagnostics: true })
    fixture.observers.mutation?.()
    fixture.events.get('resize')?.()
    fixture.fontEvents.get('loadingdone')?.()
    expect(fixture.frames.size).toBe(1)
    fixture.flush()
    fixture.observers.resize?.([{ contentRect: { width: 360, height: 400 } }])
    expect(fixture.frames.size).toBe(1)
    fixture.flush()
    fixture.observers.resize?.([{ contentRect: { width: 360, height: 400 } }])
    expect(fixture.frames.size).toBe(0)
    fixture.events.get('resize')?.()
    fixture.runtime.update({ revision: 2, textScale: 1, diagnostics: false })
    expect(fixture.frames.size).toBe(0)
    expect(fixture.events.size).toBe(0)
    expect(fixture.fontEvents.size).toBe(0)
    expect(fixture.disconnected()).toBeGreaterThan(0)
    expect(fixture.observed()).toBeGreaterThan(0)
    fixture.runtime.dispose()
    fixture.observers.mutation?.()
    expect(fixture.frames.size).toBe(0)
  })

  test('rejects stale or conflicting equal revisions and emits only correlated structural fields', () => {
    const fixture = runtimeFixture()
    const node = fixture.element('oversized')
    node.rect.right = 500
    fixture.runtime.update({ revision: 3, textScale: 1.6, diagnostics: true })
    fixture.runtime.update({ revision: 2, textScale: 1, diagnostics: false })
    fixture.runtime.update({ revision: 3, textScale: 2, diagnostics: false })
    fixture.flush()
    expect(node.style.getPropertyValue('font-size')).toBe('25.6px')
    expect(fixture.reports).toEqual([
      {
        type: 'adaptation',
        revision: 3,
        items: [{ nodeId: 'oversized', kind: 'horizontal-overflow' }],
        truncated: false
      }
    ])
    fixture.runtime.dispose()
  })

  test('reports actual clipping and authored height risk without inspecting text or input values', () => {
    const fixture = runtimeFixture()
    const input = fixture.element('input')
    input.tagName = 'INPUT'
    input.style.setProperty('height', '32px')
    input.clientHeight = 32
    input.scrollHeight = 80
    input.css.overflowY = 'hidden'
    Object.defineProperty(input, 'value', {
      get: () => {
        throw new Error('Never read form value')
      }
    })
    Object.defineProperty(input, 'textContent', {
      get: () => {
        throw new Error('Never read business text')
      }
    })
    fixture.runtime.update({ revision: 1, textScale: 2, diagnostics: true })
    fixture.flush()
    expect(fixture.reports[0].items).toEqual([
      { nodeId: 'input', kind: 'text-clipping' },
      { nodeId: 'input', kind: 'fixed-height-risk' }
    ])
    fixture.runtime.dispose()
  })

  test('recognizes only authored fixed height evidence; HUG/FILL and computed height are not evidence', () => {
    for (const [classes, inline, expected] of [
      [[], '32px', true],
      [['h-[32px]'], '', true],
      [['h-8'], '', true],
      [['h-auto'], '', false],
      [['h-fit'], '', false],
      [['h-full'], '', false],
      [['h-[32px]', 'h-auto'], '', false],
      [[], '', false],
      [['h-[32px]'], 'auto', false]
    ] as const) {
      const fixture = runtimeFixture()
      const node = fixture.element('text')
      node.classList = [...classes]
      node.firstChild = { nodeType: 3, nextSibling: null }
      node.clientHeight = 32
      if (inline) node.style.setProperty('height', inline)
      fixture.runtime.update({ revision: 1, textScale: 2, diagnostics: true })
      fixture.flush()
      expect(fixture.reports[0].items.some((item) => item.kind === 'fixed-height-risk')).toBe(
        expected
      )
      fixture.runtime.dispose()
    }
  })

  test('excludes hidden, ellipsis, line-clamp and intentional horizontal scrolling subtrees', () => {
    const fixture = runtimeFixture()
    for (const [nodeId, css] of [
      ['hidden', { display: 'none' }],
      ['ellipsis', { textOverflow: 'ellipsis' }],
      ['clamp', { '-webkit-line-clamp': '2' }],
      ['scroll', { overflowX: 'auto' }]
    ] as const) {
      const parent = fixture.element(nodeId)
      parent.css = css
      const child = fixture.element(nodeId + '-child', parent)
      child.rect.right = 500
      child.css.overflowY = 'hidden'
      child.scrollHeight = 100
      child.firstChild = { nodeType: 3, nextSibling: null }
    }
    fixture.runtime.update({ revision: 1, textScale: 2, diagnostics: true })
    fixture.flush()
    expect(fixture.reports[0].items).toEqual([])
    fixture.runtime.dispose()
  })

  test('caps element scans and output items, validates IDs and deduplicates kinds', () => {
    const fixture = runtimeFixture()
    for (let index = 0; index < 140; index++) {
      const node = fixture.element('wide-' + index)
      node.rect.right = 500
    }
    fixture.runtime.update({ revision: 1, textScale: 1, diagnostics: true })
    fixture.flush()
    expect(fixture.reports[0].items).toHaveLength(128)
    expect(fixture.reports[0].truncated).toBe(true)
    fixture.runtime.dispose()
    const scanned = runtimeFixture()
    for (let index = 0; index < 4096; index++) scanned.element('within-width-' + index)
    scanned.runtime.update({ revision: 1, textScale: 1, diagnostics: true })
    scanned.flush()
    expect(scanned.reports[0]).toMatchObject({ items: [], truncated: true })
    scanned.runtime.dispose()
    const ids = runtimeFixture()
    for (const nodeId of ['same', 'same', 'bad\nid', 'bad\u0085id', 'n'.repeat(513)])
      ids.element(nodeId).rect.right = 500
    ids.runtime.update({ revision: 1, textScale: 1, diagnostics: true })
    ids.flush()
    expect(ids.reports[0].items).toEqual([{ nodeId: 'same', kind: 'horizontal-overflow' }])
    ids.runtime.dispose()
  })
})

test('generated adaptation inbound parser rejects accessors, unknown fields and unsafe revisions', () => {
  const source = new Bun.Transpiler({ loader: 'ts' }).transformSync(
    buildPreviewBridge().replaceAll('import.meta.env.DEV', 'false').replace('export {}', '')
  )
  const parser = new Script(source + '\nparseInbound').runInContext(
    createContext({ Object, Number })
  ) as (value: unknown, channel: string) => unknown
  const channel = 'preview_channel_0123456789'
  const valid = {
    source: 'op-lowcode-editor',
    channel,
    type: 'adaptation',
    revision: 0,
    textScale: 2,
    diagnostics: true
  }
  expect(parser(valid, channel)).toEqual(valid)
  for (const patch of [
    { revision: -1 },
    { revision: Number.NaN },
    { revision: Number.MAX_SAFE_INTEGER + 1 },
    { textScale: 1.5 },
    { diagnostics: 'true' },
    { extra: true },
    { source: 'attacker' },
    { channel: channel + 'wrong' }
  ])
    expect(parser({ ...valid, ...patch }, channel)).toBeNull()
  let reads = 0
  const getter = () => {
    reads++
    return 2
  }
  for (const name of ['type', 'source', 'channel', 'revision', 'textScale', 'diagnostics']) {
    const accessor = { ...valid }
    Object.defineProperty(accessor, name, {
      enumerable: true,
      get: getter
    })
    expect(parser(accessor, channel)).toBeNull()
  }
  expect(reads).toBe(0)
  expect(parser(Object.assign(Object.create({ inherited: true }), valid), channel)).toBeNull()
  expect(parser({ ...valid, [Symbol('hidden')]: true }, channel)).toBeNull()
})

test('React and Vue production export omit the entire dev-only adaptation bridge', () => {
  const graph = new SceneGraph()
  const page = graph.getPages()[0]
  graph.createNode('TEXT', page.id, { text: 'Export fixture', width: 100, height: 24 })
  for (const target of ['react', 'vue'] as const) {
    const production = compile({
      graph,
      pageIds: [page.id],
      options: withDefaults({ target, devMode: false })
    })
    expect(production.files.has('src/__preview-bridge.ts')).toBe(false)
    expect(
      [...production.files.values()].some(
        (source) => typeof source === 'string' && source.includes('createPreviewAdaptation')
      )
    ).toBe(false)
    const development = compile({
      graph,
      pageIds: [page.id],
      options: withDefaults({ target, devMode: true })
    })
    expect(development.files.get('src/__preview-bridge.ts')).toContain('createPreviewAdaptation')
    expect(development.files.get('src/__preview-bridge.ts')).toContain(
      "window.addEventListener('pagehide', adaptation.dispose"
    )
  }
})
