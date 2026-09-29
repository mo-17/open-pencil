import { expect, test } from 'bun:test'

import { SceneGraph } from '@open-pencil/scene-graph'

import { BUILTIN_MODULE_CANVAS_ADAPTERS } from '#core/canvas/modules/registry'
import { exportFigFile } from '#core/io/formats/fig'
import { initCodec, parseFigFile } from '#core/kiwi'
import { BUILTIN_PLUGIN_REGISTRY } from '#core/plugins/builtin'
import {
  createWalktourModuleInstance,
  createWalktourModuleFrameOverrides,
  resolveWalktourModule,
  parseWalktourSteps,
  WALKTOUR_MODULE_DEFAULT_CONFIG,
  WALKTOUR_MODULE_TYPE,
  WALKTOUR_PLUGIN_ID,
  type WalktourStep
} from '#core/plugins/walktour'

const step = (id = 'welcome', targetChildName = ''): WalktourStep => ({
  id,
  title: 'Welcome',
  content: 'A local guide',
  targetChildName,
  placement: 'bottom'
})

test('Walktour registers strict identity and immutable independent defaults on an ordinary unclipped frame', () => {
  const module = createWalktourModuleInstance(),
    frame = createWalktourModuleFrameOverrides()
  expect(frame.interactiveProps?.module).toEqual(module)
  expect([frame.width, frame.height, frame.layoutMode, frame.clipsContent]).toEqual([
    320,
    44,
    'NONE',
    false
  ])
  expect(BUILTIN_PLUGIN_REGISTRY.getModule(WALKTOUR_PLUGIN_ID, WALKTOUR_MODULE_TYPE)).toBeDefined()
  expect(BUILTIN_MODULE_CANVAS_ADAPTERS.get(WALKTOUR_PLUGIN_ID, WALKTOUR_MODULE_TYPE)).toBeDefined()
  expect(Object.isFrozen(WALKTOUR_MODULE_DEFAULT_CONFIG.steps)).toBe(true)
  expect(Object.isFrozen(WALKTOUR_MODULE_DEFAULT_CONFIG.steps[0])).toBe(true)
  const input = [step()],
    created = createWalktourModuleInstance({ steps: input })
  input[0].title = 'Changed after insertion'
  expect(created.config.steps).not.toEqual(input)
  expect(resolveWalktourModule({ ...module, pluginId: 'foreign.walktour' })).toBeNull()
  expect(resolveWalktourModule({ ...module, configVersion: 2 })?.ok).toBe(false)
  expect(
    resolveWalktourModule({ ...module, config: { ...module.config, automatic: true } })?.ok
  ).toBe(false)
})

test('Walktour limits step count, safe IDs, own data keys and unambiguous named child targets', () => {
  for (const input of [
    [],
    Array.from({ length: 13 }, (_, i) => step('n' + i)),
    [step(), step()],
    [step('a', 'Target'), step('b', 'Target')],
    [step('a.b')],
    [step('a"b')],
    [step('a b')],
    [{ ...step(), title: '  ' }],
    [{ ...step(), targetChildName: '  ' }],
    [{ ...step(), placement: 'auto' }],
    [{ ...step(), selector: 'body' }],
    [{ ...step(), content: 'x'.repeat(2001) }]
  ])
    expect(() => parseWalktourSteps(input)).toThrow()
  expect(parseWalktourSteps(Array.from({ length: 12 }, (_, i) => step('n' + i)))).toHaveLength(12)
  expect(
    parseWalktourSteps([step('a', '设置'), step('b', 'Overview'), step('c')]).map(
      (value) => value.targetChildName
    )
  ).toEqual(['设置', 'Overview', ''])
  expect(parseWalktourSteps([{ ...step(), content: '', targetChildName: '' }])[0].content).toBe('')
})

test('Walktour rejects accessors, prototypes, sparse arrays and symbol keys without invoking getters', () => {
  let calls = 0
  const unsafe = step()
  Object.defineProperty(unsafe, 'title', {
    enumerable: true,
    get() {
      calls++
      return 'bad'
    }
  })
  const sparse: unknown[] = []
  sparse.length = 1
  const extra = [step()]
  Object.defineProperty(extra, Symbol('hidden'), { value: true })
  const inherited = Object.create({ placement: 'bottom' })
  Object.assign(inherited, { id: 'inherited', title: 'Title', content: '', targetChildName: '' })
  for (const input of [[unsafe], sparse, extra, [inherited]])
    expect(() => parseWalktourSteps(input)).toThrow()
  const index: unknown[] = []
  Object.defineProperty(index, '0', {
    enumerable: true,
    get() {
      calls++
      return step()
    }
  })
  expect(() => createWalktourModuleInstance({ steps: index })).toThrow()
  const config = { ...WALKTOUR_MODULE_DEFAULT_CONFIG }
  Object.defineProperty(config, 'triggerLabel', {
    enumerable: true,
    get() {
      calls++
      return 'bad'
    }
  })
  expect(() => createWalktourModuleInstance(config)).toThrow()
  const module = createWalktourModuleInstance()
  expect(resolveWalktourModule({ ...module, config })?.ok).toBe(false)
  expect(calls).toBe(0)
})

test('Walktour bounds style values and aggregate UTF-8 bytes without coercion or hidden authority', () => {
  for (const config of [
    { overlayOpacity: -0.1 },
    { overlayOpacity: 0.81 },
    { overlayOpacity: Number.NaN },
    { overlayOpacity: '0.5' },
    { panelWidth: 159 },
    { panelWidth: 601 },
    { fontSize: 9 },
    { fontSize: 25 },
    { borderRadius: -1 },
    { borderRadius: 25 },
    { triggerBackground: 'url(secret)' },
    { triggerLabel: ' ' },
    { disabled: 1 },
    { showSkip: 'true' },
    { href: 'https://example.com' },
    { onComplete: 'submit' }
  ])
    expect(() => createWalktourModuleInstance(config)).toThrow()
  expect(
    resolveWalktourModule(
      createWalktourModuleInstance({
        overlayOpacity: 0,
        panelWidth: 160,
        fontSize: 10,
        borderRadius: 0
      })
    )?.ok
  ).toBe(true)
  expect(
    resolveWalktourModule(
      createWalktourModuleInstance({
        overlayOpacity: 0.8,
        panelWidth: 600,
        fontSize: 24,
        borderRadius: 24
      })
    )?.ok
  ).toBe(true)
  expect(() =>
    createWalktourModuleInstance({
      steps: Array.from({ length: 12 }, (_, i) => ({
        ...step('n' + i),
        content: '中'.repeat(2000)
      }))
    })
  ).toThrow()
})

test('Walktour FIG roundtrip preserves guide config and every ordinary child layer without converting or hiding targets', async () => {
  await initCodec()
  const graph = new SceneGraph(),
    page = graph.getPages()[0]
  const frame = graph.createNode('FRAME', page.id, {
    ...createWalktourModuleFrameOverrides({ steps: [step('a', '设置'), step('b')] }),
    height: 180
  })
  const target = graph.createNode('RECTANGLE', frame.id, {
    name: '设置',
    x: 0,
    y: 60,
    width: 140,
    height: 40
  })
  const other = graph.createNode('TEXT', frame.id, {
    name: 'Unmapped content',
    text: 'Still visible',
    x: 0,
    y: 120,
    width: 140,
    height: 30
  })
  const before = structuredClone(frame.interactiveProps?.module)
  const data = await exportFigFile(graph),
    restored = await parseFigFile(data.slice().buffer)
  const result = [...restored.getAllNodes()].find(
    (node) => node.interactiveProps?.module?.pluginId === WALKTOUR_PLUGIN_ID
  )
  expect(result?.type).toBe('FRAME')
  expect(result?.interactiveProps?.module).toEqual(before)
  expect(result?.childIds.map((id) => restored.getNode(id)?.name)).toEqual([
    target.name,
    other.name
  ])
  expect(result?.childIds.every((id) => restored.getNode(id)?.visible)).toBe(true)
  expect(result?.clipsContent).toBe(false)
})
