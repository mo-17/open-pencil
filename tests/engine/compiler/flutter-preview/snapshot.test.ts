import { describe, expect, test } from 'bun:test'

import {
  captureFlutterPreviewSnapshot,
  compileFlutterPreviewSnapshot,
  validateFlutterPreviewSnapshot,
  FLUTTER_PREVIEW_SNAPSHOT_LIMITS as LIMITS
} from '@open-pencil/compiler/flutter-preview'

import { editSnapshotNode, previewFixture, snapshotFixture } from './helpers'

describe('portable Flutter native preview snapshot', () => {
  test('captures detached JSON with exact binary geometry, local values and image assets', () => {
    const { graph, page, text } = previewFixture()
    const bytes = new Uint8Array([0, 1, 2, 128, 255])
    graph.images.set('asset', bytes)
    text.fillGeometry = [{ windingRule: 'NONZERO', commandsBlob: bytes }]
    text.textPicture = bytes
    text.derivedTextGlyphs = [{ commandsBlob: bytes, x: 0, y: 0, fontSize: 14 }]
    graph.addCollection({
      id: 'palette',
      name: 'Palette',
      modes: [{ modeId: 'light', name: 'Light' }],
      defaultModeId: 'light',
      variableIds: []
    })
    graph.addVariable({
      id: 'blue',
      collectionId: 'palette',
      name: 'Blue',
      type: 'COLOR',
      valuesByMode: { light: { r: 0, g: 0, b: 1, a: 1 } },
      description: '',
      hiddenFromPublishing: false
    })
    const snapshot = captureFlutterPreviewSnapshot(graph, [page.id])
    const wireJSON = JSON.stringify(snapshot)
    const roundtrip = validateFlutterPreviewSnapshot(JSON.parse(wireJSON))
    expect(roundtrip.graph.images).toEqual([['asset', 'AAECgP8=']])
    expect(editSnapshotNode(roundtrip, text.id).fillGeometry[0].commandsBlob).toEqual([...bytes])
    expect(editSnapshotNode(roundtrip, text.id).textPicture).toEqual([...bytes])
    expect(editSnapshotNode(roundtrip, text.id).derivedTextGlyphs?.[0].commandsBlob).toEqual([
      ...bytes
    ])
    expect(roundtrip.graph.variables[0][1].valuesByMode.light).toEqual({ r: 0, g: 0, b: 1, a: 1 })
    bytes[0] = 42
    text.text = 'Changed later'
    expect(editSnapshotNode(roundtrip, text.id).text).toBe('Native preview 中文')
    expect(roundtrip.graph.images[0][1]).toBe('AAECgP8=')
  })

  test('emits only the fixed Flutter project and recompiles current content', () => {
    const { graph, page, text } = previewFixture()
    const output = compileFlutterPreviewSnapshot(captureFlutterPreviewSnapshot(graph, [page.id]))
    expect(output.files.get('pubspec.yaml')).toContain('name: openpencil_flutter_preview')
    expect(output.files.has('lib/main.dart')).toBe(true)
    expect(output.files.has('package.json')).toBe(false)
    expect(
      [...output.files.values()].some(
        (value) => typeof value === 'string' && value.includes('Native preview 中文')
      )
    ).toBe(true)
    text.text = 'Accepted latest content'
    const updated = compileFlutterPreviewSnapshot(captureFlutterPreviewSnapshot(graph, [page.id]))
    expect(
      [...updated.files.values()].some(
        (value) => typeof value === 'string' && value.includes('Accepted latest content')
      )
    ).toBe(true)
    const dartSources = (files: typeof output.files) =>
      [...files]
        .filter(([path]) => path.endsWith('.dart'))
        .map(([, source]) => source)
        .join('\n')
    expect(dartSources(output.files)).toContain(`ValueKey("openpencil-node-${text.id}")`)
    expect(dartSources(updated.files)).toContain(`ValueKey("openpencil-node-${text.id}")`)
    const widgetClasses = (sources: string) => sources.match(/class \w+ extends StatefulWidget/gu)
    expect(widgetClasses(dartSources(updated.files))).toEqual(
      widgetClasses(dartSources(output.files))
    )
  })

  test('rejects compiler options, output files, wrong protocol and unknown graph fields', () => {
    for (const extra of [
      { options: { target: 'react' } },
      { files: { 'lib/main.dart': 'untrusted Dart' } },
      { version: 2 }
    ]) {
      expect(() => validateFlutterPreviewSnapshot({ ...snapshotFixture(), ...extra })).toThrow(
        'Invalid Flutter preview snapshot.'
      )
    }
    const snapshot = snapshotFixture()
    Reflect.set(snapshot.graph, 'lazyFigImport', {})
    expect(() => validateFlutterPreviewSnapshot(snapshot)).toThrow(
      'Invalid Flutter preview snapshot.'
    )
  })

  test('requires complete node shapes before compiler reconstruction', () => {
    for (const field of [
      'source',
      'paddingLeft',
      'layoutMode',
      'componentPropertyDefinitions',
      'pluginData'
    ]) {
      const missing = snapshotFixture()
      Reflect.deleteProperty(missing.graph.nodes[0][1], field)
      expect(() => validateFlutterPreviewSnapshot(missing)).toThrow(
        'Invalid Flutter preview snapshot.'
      )
    }
    for (const [field, value] of [
      ['paddingLeft', 'wrong'],
      ['source', []],
      ['layoutMode', 'EXECUTE'],
      ['fontVariations', 1]
    ] as const) {
      const malformed = snapshotFixture()
      Reflect.set(malformed.graph.nodes[0][1], field, value)
      expect(() => validateFlutterPreviewSnapshot(malformed)).toThrow(
        'Invalid Flutter preview snapshot.'
      )
    }
    const { graph, page } = previewFixture()
    let owner = page
    for (let depth = 0; depth <= LIMITS.maxDepth; depth += 1)
      owner = graph.createNode('FRAME', owner.id)
    expect(() => captureFlutterPreviewSnapshot(graph, [page.id])).toThrow(
      'Invalid Flutter preview snapshot.'
    )
  })

  test('rejects getters without invoking them, custom prototypes, symbols and dangerous keys', () => {
    let reads = 0
    const getter = snapshotFixture()
    Object.defineProperty(getter.graph, 'rootId', {
      enumerable: true,
      get() {
        reads += 1
        return 'secret-value'
      }
    })
    expect(() => validateFlutterPreviewSnapshot(getter)).toThrow(
      'Invalid Flutter preview snapshot.'
    )
    expect(reads).toBe(0)
    for (const mutate of [
      (snapshot: ReturnType<typeof snapshotFixture>) =>
        Object.setPrototypeOf(snapshot.graph, { unexpected: true }),
      (snapshot: ReturnType<typeof snapshotFixture>) =>
        Reflect.set(snapshot.graph, Symbol('extra'), true),
      (snapshot: ReturnType<typeof snapshotFixture>) => Reflect.set(snapshot.graph, '__proto__', {})
    ]) {
      const snapshot = snapshotFixture()
      mutate(snapshot)
      expect(() => validateFlutterPreviewSnapshot(snapshot)).toThrow(
        'Invalid Flutter preview snapshot.'
      )
    }
  })

  test('rejects non-JSON, cyclic, sparse and excessively nested data', () => {
    for (const value of [
      Number.NaN,
      Number.POSITIVE_INFINITY,
      () => undefined,
      1n,
      new Uint8Array([1]),
      new Date()
    ]) {
      const snapshot = snapshotFixture()
      Reflect.set(snapshot.graph.nodes[0][1], 'interactiveProps', { value })
      expect(() => validateFlutterPreviewSnapshot(snapshot)).toThrow(
        'Invalid Flutter preview snapshot.'
      )
    }
    const cyclic = snapshotFixture()
    Reflect.set(cyclic.graph.nodes[0][1], 'interactiveProps', cyclic)
    expect(() => validateFlutterPreviewSnapshot(cyclic)).toThrow(
      'Invalid Flutter preview snapshot.'
    )
    const sparse = snapshotFixture()
    Reflect.deleteProperty(sparse.pageIds, '0')
    expect(() => validateFlutterPreviewSnapshot(sparse)).toThrow(
      'Invalid Flutter preview snapshot.'
    )
    const deep = snapshotFixture()
    let nested: unknown = 'leaf'
    for (let index = 0; index <= LIMITS.maxDepth; index += 1) nested = { nested }
    Reflect.set(deep.graph.nodes[0][1], 'interactiveProps', nested)
    expect(() => validateFlutterPreviewSnapshot(deep)).toThrow('Invalid Flutter preview snapshot.')
  })

  test('rejects duplicate identities, disconnected nodes, cycles and non-page selections', () => {
    const duplicate = snapshotFixture()
    duplicate.graph.nodes.push(duplicate.graph.nodes[0])
    expect(() => validateFlutterPreviewSnapshot(duplicate)).toThrow(
      'Invalid Flutter preview snapshot.'
    )
    const mismatched = snapshotFixture()
    mismatched.graph.nodes[0][1].id = 'different-id'
    expect(() => validateFlutterPreviewSnapshot(mismatched)).toThrow(
      'Invalid Flutter preview snapshot.'
    )
    const invalidPage = snapshotFixture()
    invalidPage.pageIds = [invalidPage.graph.rootId]
    expect(() => validateFlutterPreviewSnapshot(invalidPage)).toThrow(
      'Invalid Flutter preview snapshot.'
    )
    const foreignPage = snapshotFixture()
    foreignPage.pageIds = ['outside-document']
    expect(() => validateFlutterPreviewSnapshot(foreignPage)).toThrow(
      'Invalid Flutter preview snapshot.'
    )
    const cycle = snapshotFixture()
    const page = editSnapshotNode(cycle, cycle.pageIds[0])
    const frame = editSnapshotNode(cycle, page.childIds[0])
    page.parentId = frame.id
    frame.childIds.push(page.id)
    expect(() => validateFlutterPreviewSnapshot(cycle)).toThrow('Invalid Flutter preview snapshot.')
  })

  test('rejects flat component reference cycles and bounds their expansion depth', () => {
    const { graph, page } = previewFixture()
    const component = graph.createNode('COMPONENT', page.id, { name: 'First' })
    const instance = graph.createNode('INSTANCE', component.id, { componentId: component.id })
    expect(() => captureFlutterPreviewSnapshot(graph, [page.id])).toThrow(
      'Invalid Flutter preview snapshot.'
    )
    const second = graph.createNode('COMPONENT', page.id, { name: 'Second' })
    instance.componentId = second.id
    graph.createNode('INSTANCE', second.id, { componentId: component.id })
    expect(() => captureFlutterPreviewSnapshot(graph, [page.id])).toThrow(
      'Invalid Flutter preview snapshot.'
    )
    const bounded = previewFixture()
    let owner = bounded.graph.createNode('COMPONENT', bounded.page.id)
    for (let index = 0; index <= LIMITS.maxDepth; index += 1) {
      const target = bounded.graph.createNode('COMPONENT', bounded.page.id)
      bounded.graph.createNode('INSTANCE', owner.id, { componentId: target.id })
      owner = target
    }
    expect(() => captureFlutterPreviewSnapshot(bounded.graph, [bounded.page.id])).toThrow(
      'Invalid Flutter preview snapshot.'
    )
  })

  test('accepts acyclic components and rejects unsafe variable identities and alias dependencies', () => {
    const { graph, page } = previewFixture()
    const component = graph.createNode('COMPONENT', page.id, { name: 'Reusable' })
    graph.createNode('INSTANCE', page.id, { componentId: component.id })
    graph.addCollection({
      id: 'values',
      name: 'Values',
      modes: [{ modeId: 'default', name: 'Default' }],
      defaultModeId: 'default',
      variableIds: []
    })
    graph.addVariable({
      id: 'a',
      name: 'A',
      collectionId: 'values',
      type: 'FLOAT',
      valuesByMode: { default: 1 },
      description: '',
      hiddenFromPublishing: false
    })
    expect(captureFlutterPreviewSnapshot(graph, [page.id]).pageIds).toEqual([page.id])
    const invalid = captureFlutterPreviewSnapshot(graph, [page.id])
    invalid.graph.variables[0][1].collectionId = 'outside'
    expect(() => validateFlutterPreviewSnapshot(invalid)).toThrow(
      'Invalid Flutter preview snapshot.'
    )
    const variable = graph.variables.get('a')
    if (!variable) throw new Error('Fixture variable is missing')
    variable.valuesByMode.default = { aliasId: 'a' }
    expect(() => captureFlutterPreviewSnapshot(graph, [page.id])).toThrow(
      'Invalid Flutter preview snapshot.'
    )
    variable.valuesByMode.default = 1
    for (let index = 0; index <= LIMITS.maxDepth; index += 1) {
      const id = `alias-${index}`
      graph.addVariable({
        id,
        name: id,
        collectionId: 'values',
        type: 'FLOAT',
        valuesByMode: { default: { aliasId: index ? `alias-${index - 1}` : 'a' } },
        description: '',
        hiddenFromPublishing: false
      })
    }
    expect(() => captureFlutterPreviewSnapshot(graph, [page.id])).toThrow(
      'Invalid Flutter preview snapshot.'
    )
  })

  test('enforces canonical image encoding, individual and aggregate image quotas', () => {
    for (const encoded of ['', 'AB==', 'YWJj\n', 'data:image/png;base64,YWJj', 'AA']) {
      const snapshot = snapshotFixture()
      snapshot.graph.images = [['asset', encoded]]
      expect(() => validateFlutterPreviewSnapshot(snapshot)).toThrow(
        'Invalid Flutter preview snapshot.'
      )
    }
    const { graph, page } = previewFixture()
    graph.images.set('too-large', new Uint8Array(LIMITS.maxImageBytes + 1))
    expect(() => captureFlutterPreviewSnapshot(graph, [page.id])).toThrow(
      'Invalid Flutter preview snapshot.'
    )
    graph.images.clear()
    for (let index = 0; index < 3; index += 1)
      graph.images.set(`asset-${index}`, new Uint8Array(LIMITS.maxImageBytes))
    expect(() => captureFlutterPreviewSnapshot(graph, [page.id])).toThrow(
      'Invalid Flutter preview snapshot.'
    )
  })

  test('enforces text, binary, node and total serialized budgets', () => {
    const { graph, page, text } = previewFixture()
    text.text = 'a'.repeat(LIMITS.maxStringBytes + 1)
    expect(() => captureFlutterPreviewSnapshot(graph, [page.id])).toThrow(
      'Invalid Flutter preview snapshot.'
    )
    text.text = 'Short'
    text.textPicture = new Uint8Array(LIMITS.maxBinaryBytes + 1)
    expect(() => captureFlutterPreviewSnapshot(graph, [page.id])).toThrow(
      'Invalid Flutter preview snapshot.'
    )
    text.textPicture = null
    const node = graph.nodes.get(graph.rootId)
    if (!node) throw new Error('Fixture root is missing')
    for (let index = graph.nodes.size; index <= LIMITS.maxNodes; index += 1)
      graph.nodes.set(`node-${index}`, node)
    expect(() => captureFlutterPreviewSnapshot(graph, [page.id])).toThrow(
      'Invalid Flutter preview snapshot.'
    )
    const total = snapshotFixture()
    Reflect.set(
      total.graph.nodes[0][1],
      'interactiveProps',
      Object.fromEntries(
        Array.from({ length: 40 }, (_, index) => [
          `field-${index}`,
          'a'.repeat(LIMITS.maxStringBytes)
        ])
      )
    )
    expect(() => validateFlutterPreviewSnapshot(total)).toThrow('Invalid Flutter preview snapshot.')
  })
})
