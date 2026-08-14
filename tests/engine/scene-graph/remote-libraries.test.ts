import { describe, expect, test } from 'bun:test'

import {
  acceptLibraryUpdate,
  cloneNodeProps,
  componentSubtreeVersion,
  ensureLibraryCachePage,
  importLibraryComponent,
  publishLibraryComponent,
  REMOTE_LIBRARY_IMAGE_LIMITS,
  REMOTE_LIBRARY_VALIDATION_LIMITS,
  SceneGraph,
  type Fill,
  validateLibraryArtifact
} from '@open-pencil/scene-graph'

const BLACK = { r: 0, g: 0, b: 0, a: 1 }

function pngBytes(width = 1, height = 1): Uint8Array {
  const bytes = new Uint8Array(45)
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  bytes[11] = 13
  bytes.set([0x49, 0x48, 0x44, 0x52], 12)
  const view = new DataView(bytes.buffer)
  view.setUint32(16, width)
  view.setUint32(20, height)
  bytes.set([0x49, 0x45, 0x4e, 0x44], 37)
  return bytes
}

function gifBytes(width = 1, height = 1): Uint8Array {
  const bytes = new Uint8Array(14)
  bytes.set(new TextEncoder().encode('GIF89a'))
  const view = new DataView(bytes.buffer)
  view.setUint16(6, width, true)
  view.setUint16(8, height, true)
  bytes[13] = 0x3b
  return bytes
}

function jpegBytes(width = 1, height = 1): Uint8Array {
  const bytes = new Uint8Array([
    0xff,
    0xd8,
    0xff,
    0xc0,
    0,
    7,
    8,
    (height >>> 8) & 0xff,
    height & 0xff,
    (width >>> 8) & 0xff,
    width & 0xff,
    0xff,
    0xd9
  ])
  return bytes
}

function webpBytes(width = 1, height = 1): Uint8Array {
  const bytes = new Uint8Array(30)
  const view = new DataView(bytes.buffer)
  bytes.set(new TextEncoder().encode('RIFF'))
  view.setUint32(4, 22, true)
  bytes.set(new TextEncoder().encode('WEBPVP8X'), 8)
  view.setUint32(16, 10, true)
  for (const [offset, value] of [
    [24, width - 1],
    [27, height - 1]
  ] as const) {
    bytes[offset] = value & 0xff
    bytes[offset + 1] = (value >>> 8) & 0xff
    bytes[offset + 2] = (value >>> 16) & 0xff
  }
  return bytes
}

function imageFill(imageHash: string): Fill {
  return {
    type: 'IMAGE',
    color: BLACK,
    opacity: 1,
    visible: true,
    imageHash,
    imageScaleMode: 'FILL'
  }
}

function patternFill(sourceNodeId: string): Fill {
  return {
    type: 'PATTERN',
    color: BLACK,
    opacity: 1,
    visible: true,
    sourceNodeId
  }
}

describe('remote library scene-graph contracts', () => {
  test('enforces isolated SceneGraph node/depth limits before mutating a parent', () => {
    const nodeLimited = new SceneGraph({ maxNodes: 2 })
    const nodeParent = nodeLimited.getPages()[0]
    expect(() => nodeLimited.createNode('FRAME', nodeParent.id)).toThrow(
      'SceneGraph node limit exceeded (2)'
    )
    expect(nodeLimited.getNode(nodeParent.id)?.childIds).toEqual([])

    const depthLimited = new SceneGraph({ maxDepth: 2 })
    const depthPage = depthLimited.getPages()[0]
    const frame = depthLimited.createNode('FRAME', depthPage.id)
    expect(() => depthLimited.createNode('TEXT', frame.id)).toThrow(
      'SceneGraph depth limit exceeded (2)'
    )
    expect(depthLimited.getNode(frame.id)?.childIds).toEqual([])
  })

  test('creates one hidden marked library cache page and reuses it', () => {
    const graph = new SceneGraph()
    const cachePage = ensureLibraryCachePage(graph)

    expect(cachePage.type).toBe('CANVAS')
    expect(cachePage.internalOnly).toBe(true)
    expect(cachePage.lowcodeLibraryCache).toBe(true)
    expect(graph.getPages()).not.toContain(cachePage)
    expect(graph.getPages(true)).toContain(cachePage)
    expect(ensureLibraryCachePage(graph).id).toBe(cachePage.id)
    expect(graph.getPages(true).filter((page) => page.lowcodeLibraryCache)).toHaveLength(1)
  })

  test('stores, preserves, and deep-copies a distinct manifest source', () => {
    const sourceGraph = new SceneGraph()
    const sourcePage = sourceGraph.getPages()[0]
    const component = sourceGraph.createNode('COMPONENT', sourcePage.id, { name: 'Card' })
    const published = publishLibraryComponent(sourceGraph, {
      componentId: component.id,
      libraryId: 'design-system',
      componentKey: 'component-card',
      source: { kind: 'file', ref: './design-system.fig' }
    })
    expect('error' in published).toBe(false)
    if ('error' in published) return

    const targetGraph = new SceneGraph()
    const first = importLibraryComponent({
      sourceGraph,
      targetGraph,
      manifest: published.manifest,
      componentKey: 'component-card',
      manifestSource: { kind: 'url', ref: 'https://example.com/manifest.json' }
    })
    expect('error' in first).toBe(false)
    if ('error' in first) return
    const second = importLibraryComponent({
      sourceGraph,
      targetGraph,
      manifest: published.manifest,
      componentKey: 'component-card'
    })
    expect('error' in second).toBe(false)
    if ('error' in second) return

    const nodeCountBeforeConflict = targetGraph.getNodeCount()
    const librariesBeforeConflict = structuredClone(
      targetGraph.getNode(targetGraph.rootId)?.lowcodeLibraries
    )
    const conflict = importLibraryComponent({
      sourceGraph,
      targetGraph,
      manifest: published.manifest,
      componentKey: 'component-card',
      manifestSource: { kind: 'url', ref: 'https://example.com/other-manifest.json' }
    })
    expect(conflict).toEqual({
      error:
        'Library "design-system" is already bound to manifest source "url:https://example.com/manifest.json"; refusing to rebind to "url:https://example.com/other-manifest.json"'
    })
    expect(targetGraph.getNodeCount()).toBe(nodeCountBeforeConflict)
    expect(targetGraph.getNode(targetGraph.rootId)?.lowcodeLibraries).toEqual(
      librariesBeforeConflict
    )

    const root = targetGraph.getNode(targetGraph.rootId)
    expect(root).toBeDefined()
    if (!root) return
    const storedSource = root.lowcodeLibraries?.[0]?.manifestSource
    const copiedSource = cloneNodeProps(root, null).lowcodeLibraries?.[0]?.manifestSource
    expect(storedSource).toEqual({ kind: 'url', ref: 'https://example.com/manifest.json' })
    expect(copiedSource).toEqual(storedSource)
    expect(copiedSource).not.toBe(storedSource)
  })

  test('rejects manifest source rebinding before update mutation but permits artifact changes', () => {
    const sourceGraph = new SceneGraph()
    const sourcePage = sourceGraph.getPages()[0]
    const component = sourceGraph.createNode('COMPONENT', sourcePage.id, { name: 'Card' })
    const first = publishLibraryComponent(sourceGraph, {
      componentId: component.id,
      libraryId: 'design-system',
      componentKey: 'component-card',
      source: { kind: 'file', ref: './design-system.fig' }
    })
    expect('error' in first).toBe(false)
    if ('error' in first) return
    const targetGraph = new SceneGraph()
    const imported = importLibraryComponent({
      sourceGraph,
      targetGraph,
      manifest: first.manifest,
      componentKey: 'component-card',
      manifestSource: { kind: 'url', ref: 'https://example.com/manifest.json' }
    })
    expect('error' in imported).toBe(false)
    if ('error' in imported) return

    sourceGraph.createNode('TEXT', component.id, { name: 'Title', text: 'Updated' })
    const next = publishLibraryComponent(sourceGraph, {
      componentId: component.id,
      libraryId: 'design-system',
      componentKey: 'component-card',
      source: { kind: 'url', ref: 'https://example.com/design-system-v2.fig' }
    })
    expect('error' in next).toBe(false)
    if ('error' in next) return
    const cachedChildIdsBeforeConflict = [
      ...(targetGraph.getNode(imported.importedNodeId)?.childIds ?? [])
    ]
    const nodeCountBeforeConflict = targetGraph.getNodeCount()
    const librariesBeforeConflict = structuredClone(
      targetGraph.getNode(targetGraph.rootId)?.lowcodeLibraries
    )
    const conflict = acceptLibraryUpdate({
      sourceGraph,
      targetGraph,
      manifest: next.manifest,
      componentKey: 'component-card',
      manifestSource: { kind: 'url', ref: 'https://example.com/manifest-v2.json' }
    })
    expect(conflict).toEqual({
      error:
        'Library "design-system" is already bound to manifest source "url:https://example.com/manifest.json"; refusing to rebind to "url:https://example.com/manifest-v2.json"'
    })
    expect(targetGraph.getNodeCount()).toBe(nodeCountBeforeConflict)
    expect(targetGraph.getNode(imported.importedNodeId)?.childIds).toEqual(
      cachedChildIdsBeforeConflict
    )
    expect(targetGraph.getNode(targetGraph.rootId)?.lowcodeLibraries).toEqual(
      librariesBeforeConflict
    )

    const accepted = acceptLibraryUpdate({
      sourceGraph,
      targetGraph,
      manifest: next.manifest,
      componentKey: 'component-card',
      manifestSource: { kind: 'url', ref: 'https://example.com/manifest.json' }
    })
    expect('error' in accepted).toBe(false)
    if ('error' in accepted) return
    expect(accepted.libraryRef.manifestSource).toEqual({
      kind: 'url',
      ref: 'https://example.com/manifest.json'
    })
    expect(accepted.libraryRef.source).toEqual({
      kind: 'url',
      ref: 'https://example.com/design-system-v2.fig'
    })
    expect(targetGraph.getNode(imported.importedNodeId)?.childIds).toHaveLength(1)
  })

  test('does not resolve a manifest entry by matching node name alone', () => {
    const graph = new SceneGraph()
    const page = graph.getPages()[0]
    const component = graph.createNode('COMPONENT', page.id, { name: 'Matching name' })
    const result = validateLibraryArtifact(graph, {
      libraryId: 'design-system',
      name: 'Design System',
      components: [
        {
          key: 'component-key-not-on-node',
          name: component.name,
          version: `v1-${'0'.repeat(16)}`,
          nodeId: 'missing-component-node',
          type: 'COMPONENT'
        }
      ]
    })

    expect(result).toEqual({
      ok: false,
      issues: [
        expect.objectContaining({
          code: 'missing-component',
          componentKey: 'component-key-not-on-node',
          nodeId: 'missing-component-node'
        })
      ]
    })
  })

  test('rejects an ambiguous embedded-key fallback instead of choosing the first node', () => {
    const graph = new SceneGraph()
    const page = graph.getPages()[0]
    for (const name of ['First duplicate', 'Second duplicate']) {
      graph.createNode('COMPONENT', page.id, {
        name,
        componentKey: 'duplicate-key',
        libraryComponentKey: 'duplicate-key'
      })
    }
    const result = validateLibraryArtifact(graph, {
      libraryId: 'design-system',
      name: 'Design System',
      components: [
        {
          key: 'duplicate-key',
          name: 'Ambiguous',
          version: 'v1-untrusted',
          nodeId: 'missing-exact-id',
          type: 'COMPONENT'
        }
      ]
    })

    expect(result).toEqual({
      ok: false,
      issues: [
        expect.objectContaining({
          code: 'ambiguous-component',
          componentKey: 'duplicate-key',
          nodeId: 'missing-exact-id'
        })
      ]
    })
  })

  test('resolves an exact component node id when a source format has no embedded key', () => {
    const graph = new SceneGraph()
    const page = graph.getPages()[0]
    const component = graph.createNode('COMPONENT', page.id, { name: 'Pen component' })
    const result = validateLibraryArtifact(graph, {
      libraryId: 'design-system',
      name: 'Design System',
      components: [
        {
          key: 'component-card',
          name: component.name,
          version: componentSubtreeVersion(graph, component.id),
          nodeId: component.id,
          type: 'COMPONENT'
        }
      ]
    })

    expect(result).toEqual({ ok: true, issues: [] })
  })

  test('rejects distinct manifest keys that resolve to the same unkeyed source node', () => {
    const graph = new SceneGraph()
    const page = graph.getPages()[0]
    const component = graph.createNode('COMPONENT', page.id, { name: 'Pen component' })
    const version = componentSubtreeVersion(graph, component.id)
    const result = validateLibraryArtifact(graph, {
      libraryId: 'design-system',
      name: 'Design System',
      components: [
        {
          key: 'component-card',
          name: component.name,
          version,
          nodeId: component.id,
          type: 'COMPONENT'
        },
        {
          key: 'component-card-alias',
          name: `${component.name} Alias`,
          version,
          nodeId: component.id,
          type: 'COMPONENT'
        }
      ]
    })

    expect(result).toEqual({
      ok: false,
      issues: [
        expect.objectContaining({
          code: 'duplicate-component-node',
          componentKey: 'component-card-alias',
          nodeId: component.id
        })
      ]
    })
  })

  test('rejects nested manifest component roots whose declared subtrees overlap', () => {
    const graph = new SceneGraph()
    const page = graph.getPages()[0]
    const parent = graph.createNode('COMPONENT', page.id, { name: 'Parent' })
    const child = graph.createNode('COMPONENT', parent.id, { name: 'Nested child' })
    const childPublished = publishLibraryComponent(graph, {
      componentId: child.id,
      libraryId: 'design-system',
      componentKey: 'nested-child'
    })
    const parentPublished = publishLibraryComponent(graph, {
      componentId: parent.id,
      libraryId: 'design-system',
      componentKey: 'parent'
    })
    expect('error' in childPublished).toBe(false)
    expect('error' in parentPublished).toBe(false)
    if ('error' in childPublished || 'error' in parentPublished) return

    const result = validateLibraryArtifact(graph, {
      ...parentPublished.manifest,
      components: [parentPublished.component, childPublished.component]
    })
    expect(result.ok).toBe(false)
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'overlapping-component-subtree',
          componentKey: childPublished.component.key,
          nodeId: child.id
        })
      ])
    )
  })

  test('bounds remote binary version work before invoking the legacy subtree hash', () => {
    const graph = new SceneGraph()
    const component = graph.createNode('COMPONENT', graph.getPages()[0].id, {
      name: 'Binary-heavy component'
    })
    const published = publishLibraryComponent(graph, {
      componentId: component.id,
      libraryId: 'design-system',
      componentKey: 'binary-heavy'
    })
    expect('error' in published).toBe(false)
    if ('error' in published) return

    const oversizedBinary = new Uint8Array(
      REMOTE_LIBRARY_VALIDATION_LIMITS.maxCanonicalBinaryBytes + 1
    )
    const expectBoundedFailure = () => {
      const result = validateLibraryArtifact(graph, published.manifest)
      expect(result.ok).toBe(false)
      expect(result.issues).toEqual([
        expect.objectContaining({
          code: 'validation-work-limit',
          componentKey: 'binary-heavy',
          message: expect.stringContaining('binary data exceeds')
        })
      ])
    }

    graph.updateNode(component.id, {
      fillGeometry: [{ windingRule: 'NONZERO', commandsBlob: oversizedBinary }]
    })
    expectBoundedFailure()

    graph.updateNode(component.id, { fillGeometry: [], textPicture: oversizedBinary })
    expectBoundedFailure()

    graph.updateNode(component.id, {
      textPicture: null,
      figmaDerivedTextGlyphs: [{ commandsBlob: oversizedBinary, x: 0, y: 0, fontSize: 16 }]
    })
    expectBoundedFailure()
  })

  test('fails closed on cyclic and deeply nested remote canonical values', () => {
    const graph = new SceneGraph()
    const component = graph.createNode('COMPONENT', graph.getPages()[0].id, {
      name: 'Cyclic component'
    })
    const published = publishLibraryComponent(graph, {
      componentId: component.id,
      libraryId: 'design-system',
      componentKey: 'cyclic-component'
    })
    expect('error' in published).toBe(false)
    if ('error' in published) return

    const cyclic: { next?: unknown } = {}
    cyclic.next = [cyclic]
    graph.updateNode(component.id, { overrides: { cyclic } })
    const cycleResult = validateLibraryArtifact(graph, published.manifest)
    expect(cycleResult.ok).toBe(false)
    expect(cycleResult.issues).toEqual([
      expect.objectContaining({
        code: 'validation-work-limit',
        message: expect.stringContaining('value contains a cycle')
      })
    ])

    const deep: { next?: unknown } = {}
    let cursor = deep
    for (
      let depth = 0;
      depth <= REMOTE_LIBRARY_VALIDATION_LIMITS.maxCanonicalValueDepth;
      depth += 1
    ) {
      const next: { next?: unknown } = {}
      cursor.next = next
      cursor = next
    }
    graph.updateNode(component.id, { overrides: { deep } })
    const depthResult = validateLibraryArtifact(graph, published.manifest)
    expect(depthResult.ok).toBe(false)
    expect(depthResult.issues).toEqual([
      expect.objectContaining({
        code: 'validation-work-limit',
        message: expect.stringContaining('value depth exceeds')
      })
    ])
  })

  test('validates a complete artifact and rejects unsafe or inconsistent entries', () => {
    const graph = new SceneGraph()
    const page = graph.getPages()[0]
    const external = graph.createNode('COMPONENT', page.id, { name: 'External' })
    const component = graph.createNode('COMPONENT', page.id, { name: 'Card' })
    const child = graph.createNode('RECTANGLE', component.id, {
      name: 'Hero',
      boundVariables: { fills: 'variable-id' },
      componentId: external.id,
      fills: [
        {
          type: 'IMAGE',
          color: { r: 0, g: 0, b: 0, a: 1 },
          visible: true,
          opacity: 1,
          imageHash: 'missing-image',
          imageScaleMode: 'FILL'
        }
      ]
    })
    const published = publishLibraryComponent(graph, {
      componentId: component.id,
      libraryId: 'design-system',
      componentKey: 'component-card',
      source: { kind: 'file', ref: './design-system.fig' }
    })
    expect('error' in published).toBe(false)
    if ('error' in published) return

    const invalid = validateLibraryArtifact(graph, {
      ...published.manifest,
      components: [
        { ...published.component, type: 'COMPONENT_SET', version: 'v1-tampered' },
        { ...published.component }
      ]
    })
    expect(invalid.ok).toBe(false)
    expect(invalid.issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining([
        'duplicate-component-key',
        'type-mismatch',
        'version-mismatch',
        'missing-image',
        'bound-variables',
        'external-component-reference'
      ])
    )
    expect(invalid.issues.some((issue) => issue.nodeId === child.id)).toBe(true)

    graph.updateNode(child.id, { boundVariables: {}, componentId: component.id })
    graph.images.set('missing-image', pngBytes())
    const safe = publishLibraryComponent(graph, {
      componentId: component.id,
      libraryId: 'design-system',
      componentKey: 'component-card',
      source: { kind: 'file', ref: './design-system.fig' }
    })
    expect('error' in safe).toBe(false)
    if ('error' in safe) return
    expect(validateLibraryArtifact(graph, safe.manifest)).toEqual({ ok: true, issues: [] })
  })

  test('rejects active lowcode behavior and node references outside the component subtree', () => {
    const graph = new SceneGraph()
    const page = graph.getPages()[0]
    const external = graph.createNode('FRAME', page.id, { name: 'Outside' })
    const component = graph.createNode('COMPONENT', page.id, { name: 'Remote card' })
    graph.createNode('BUTTON', component.id, {
      name: 'Unsafe button',
      events: {
        onClick: [
          {
            id: 'request',
            kind: 'apiCall',
            method: 'GET',
            url: 'https://api.example.com/data',
            targetName: 'result'
          }
        ]
      },
      prototype: {
        version: 1,
        connections: [
          {
            id: 'navigate-outside',
            trigger: { kind: 'click' },
            action: { kind: 'navigate', targetNodeId: external.id },
            transition: { kind: 'instant' }
          }
        ]
      },
      overrides: { [`${external.id}:opacity`]: 0.5 }
    })
    const published = publishLibraryComponent(graph, {
      componentId: component.id,
      libraryId: 'design-system',
      componentKey: 'remote-card'
    })
    expect('error' in published).toBe(false)
    if ('error' in published) return

    const result = validateLibraryArtifact(graph, published.manifest)
    expect(result.ok).toBe(false)
    expect(result.issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining(['active-lowcode-behavior', 'external-node-reference'])
    )
  })

  test('validates and remaps PATTERN and INSTANCE_SWAP dependencies inside the subtree', () => {
    const sourceGraph = new SceneGraph()
    const component = sourceGraph.createNode('COMPONENT', sourceGraph.getPages()[0].id, {
      name: 'Dependency card'
    })
    const patternSource = sourceGraph.createNode('FRAME', component.id, { name: 'Pattern source' })
    const swapTarget = sourceGraph.createNode('COMPONENT', component.id, { name: 'Swap target' })
    const definitionOwner = sourceGraph.createNode('COMPONENT', component.id, {
      name: 'Definition owner',
      componentPropertyDefinitions: [
        {
          id: 'swap-property',
          name: 'Icon',
          type: 'INSTANCE_SWAP',
          defaultValue: swapTarget.id
        },
        { id: 'plain-property', name: 'Label', type: 'TEXT', defaultValue: 'Label' }
      ]
    })
    sourceGraph.createNode('COMPONENT', component.id, {
      name: 'Unrelated collision',
      componentPropertyDefinitions: [
        {
          id: 'plain-property',
          name: 'Unrelated swap',
          type: 'INSTANCE_SWAP',
          defaultValue: swapTarget.id
        }
      ]
    })
    const owner = sourceGraph.createNode('INSTANCE', component.id, {
      name: 'Dependency owner',
      componentId: definitionOwner.id,
      fills: [patternFill(patternSource.id)],
      componentPropertyAssignments: {
        'swap-property': swapTarget.id,
        'plain-property': patternSource.id
      },
      overrides: {
        [`${patternSource.id}:componentId`]: swapTarget.id,
        [`${patternSource.id}:sourceComponentId`]: patternSource.id
      }
    })
    const published = publishLibraryComponent(sourceGraph, {
      componentId: component.id,
      libraryId: 'design-system',
      componentKey: 'dependency-card',
      source: { kind: 'file', ref: './dependency-card.fig' }
    })
    expect('error' in published).toBe(false)
    if ('error' in published) return
    expect(validateLibraryArtifact(sourceGraph, published.manifest)).toEqual({
      ok: true,
      issues: []
    })

    const targetGraph = new SceneGraph()
    targetGraph.createNode('COMPONENT', targetGraph.getPages()[0].id, {
      componentPropertyDefinitions: [
        { id: 'plain-property', name: 'Collision', type: 'INSTANCE_SWAP', defaultValue: '' }
      ]
    })
    const imported = importLibraryComponent({
      sourceGraph,
      targetGraph,
      manifest: published.manifest,
      componentKey: 'dependency-card'
    })
    expect('error' in imported).toBe(false)
    if ('error' in imported) return
    const importedNodes = targetGraph.getChildren(imported.importedNodeId)
    const importedSource = importedNodes.find((node) => node.name === patternSource.name)
    const importedSwap = importedNodes.find((node) => node.name === swapTarget.name)
    const importedDefinitionOwner = importedNodes.find((node) => node.name === definitionOwner.name)
    const importedOwner = importedNodes.find((node) => node.name === owner.name)
    expect(importedOwner?.fills[0]?.sourceNodeId).toBe(importedSource?.id)
    expect(importedDefinitionOwner?.componentPropertyDefinitions[0]?.defaultValue).toBe(
      importedSwap?.id
    )
    expect(importedOwner?.componentPropertyAssignments['swap-property']).toBe(importedSwap?.id)
    expect(importedOwner?.componentPropertyAssignments['plain-property']).toBe(patternSource.id)
    expect(importedOwner?.overrides[`${importedSource?.id}:componentId`]).toBe(importedSwap?.id)
    expect(importedOwner?.overrides[`${importedSource?.id}:sourceComponentId`]).toBe(
      importedSource?.id
    )
  })

  test('rejects external, missing, or non-component paint and INSTANCE_SWAP dependencies', () => {
    const graph = new SceneGraph()
    const page = graph.getPages()[0]
    const externalFrame = graph.createNode('FRAME', page.id, { name: 'External pattern' })
    const externalComponent = graph.createNode('COMPONENT', page.id, { name: 'External swap' })
    const component = graph.createNode('COMPONENT', page.id, {
      name: 'Unsafe dependencies',
      componentPropertyDefinitions: [
        {
          id: 'external-swap',
          name: 'External',
          type: 'INSTANCE_SWAP',
          defaultValue: externalComponent.id
        },
        {
          id: 'unresolved-swap',
          name: 'Unresolved',
          type: 'INSTANCE_SWAP',
          defaultValue: 'published-library-key'
        }
      ]
    })
    graph.createNode('INSTANCE', component.id, {
      name: 'Unsafe owner',
      componentId: component.id,
      fills: [patternFill(externalFrame.id)],
      componentPropertyAssignments: {
        'external-swap': externalComponent.id,
        'unresolved-swap': 'published-library-key'
      },
      overrides: {
        [`${component.id}:componentId`]: externalComponent.id,
        [`${component.id}:sourceComponentId`]: externalFrame.id
      }
    })
    const published = publishLibraryComponent(graph, {
      componentId: component.id,
      libraryId: 'design-system',
      componentKey: 'unsafe-dependencies'
    })
    expect('error' in published).toBe(false)
    if ('error' in published) return
    const result = validateLibraryArtifact(graph, published.manifest)
    expect(result.ok).toBe(false)
    expect(result.issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining(['external-node-reference', 'invalid-node-reference'])
    )
  })

  test('finds image assets in geometry and interaction-state paint carriers', () => {
    const graph = new SceneGraph()
    const component = graph.createNode('COMPONENT', graph.getPages()[0].id, {
      name: 'Paint card'
    })
    graph.createNode('RECTANGLE', component.id, {
      fillGeometry: [
        { windingRule: 'NONZERO', commandsBlob: new Uint8Array(), fills: [imageFill('fill-image')] }
      ],
      strokeGeometry: [
        {
          windingRule: 'NONZERO',
          commandsBlob: new Uint8Array(),
          fills: [imageFill('stroke-image')]
        }
      ],
      stateOverrides: { hover: { fills: [imageFill('state-image')] } }
    })
    for (const hash of ['fill-image', 'stroke-image', 'state-image']) {
      graph.images.set(hash, pngBytes())
    }
    const published = publishLibraryComponent(graph, {
      componentId: component.id,
      libraryId: 'design-system',
      componentKey: 'paint-card'
    })
    expect('error' in published).toBe(false)
    if ('error' in published) return
    expect(validateLibraryArtifact(graph, published.manifest)).toEqual({ ok: true, issues: [] })

    graph.images.delete('stroke-image')
    const missing = validateLibraryArtifact(graph, published.manifest)
    expect(missing.ok).toBe(false)
    expect(missing.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'missing-image', imageHash: 'stroke-image' })
      ])
    )
  })

  test('accepts bounded PNG, JPEG, and WebP images and rejects unsafe image headers or dimensions', () => {
    const graph = new SceneGraph()
    const component = graph.createNode('COMPONENT', graph.getPages()[0].id, {
      name: 'Image card'
    })
    graph.createNode('RECTANGLE', component.id, { fills: [imageFill('remote-image')] })
    const published = publishLibraryComponent(graph, {
      componentId: component.id,
      libraryId: 'design-system',
      componentKey: 'image-card'
    })
    expect('error' in published).toBe(false)
    if ('error' in published) return

    for (const bytes of [pngBytes(10_000, 5_000), jpegBytes(), webpBytes()]) {
      graph.images.set('remote-image', bytes)
      expect(validateLibraryArtifact(graph, published.manifest)).toEqual({ ok: true, issues: [] })
    }

    const rejected: Array<{
      bytes: Uint8Array
      code: 'invalid-image' | 'oversized-image'
    }> = [
      { bytes: new Uint8Array([1, 2, 3]), code: 'invalid-image' },
      { bytes: gifBytes(), code: 'invalid-image' },
      {
        bytes: pngBytes(REMOTE_LIBRARY_IMAGE_LIMITS.maxSide + 1, 1),
        code: 'oversized-image'
      },
      { bytes: pngBytes(10_000, 5_001), code: 'oversized-image' }
    ]
    for (const { bytes, code } of rejected) {
      graph.images.set('remote-image', bytes)
      const result = validateLibraryArtifact(graph, published.manifest)
      expect(result.ok).toBe(false)
      expect(result.issues).toEqual(
        expect.arrayContaining([expect.objectContaining({ code, imageHash: 'remote-image' })])
      )
    }
  })

  test('accepts only static visual interactive props and rejects runtime dependencies', () => {
    const validateChild = (
      type: 'BUTTON' | 'INPUT' | 'CHECKBOX',
      overrides: Parameters<SceneGraph['createNode']>[2]
    ) => {
      const graph = new SceneGraph()
      const page = graph.getPages()[0]
      const component = graph.createNode('COMPONENT', page.id, { name: 'Remote control' })
      graph.createNode(type, component.id, overrides)
      const published = publishLibraryComponent(graph, {
        componentId: component.id,
        libraryId: 'design-system',
        componentKey: 'remote-control'
      })
      expect('error' in published).toBe(false)
      if ('error' in published) throw new Error(published.error)
      return validateLibraryArtifact(graph, published.manifest)
    }

    expect(
      validateChild('BUTTON', {
        interactiveProps: { text: 'Continue', textColor: '#ffffff' }
      })
    ).toEqual({ ok: true, issues: [] })
    expect(
      validateChild('INPUT', {
        interactiveProps: {
          placeholder: 'Email',
          value: '',
          textColor: '#111827',
          placeholderColor: '#6b7280'
        }
      })
    ).toEqual({ ok: true, issues: [] })
    expect(
      validateChild('CHECKBOX', {
        interactiveProps: { options: ['Email', 'SMS'], checked: false }
      })
    ).toEqual({ ok: true, issues: [] })
    expect(
      validateChild('BUTTON', {
        state: [],
        bindings: {},
        renderCondition: '',
        interactiveProps: {}
      })
    ).toEqual({ ok: true, issues: [] })

    const unsafeOverrides: Array<Parameters<SceneGraph['createNode']>[2]> = [
      { state: [{ id: 'open', name: 'open', type: 'boolean', defaultValue: false }] },
      { bindings: { text: { kind: 'expr', expr: 'profile.name' } } },
      { renderCondition: 'isVisible' },
      { interactiveProps: { state: { name: 'open' } } },
      { interactiveProps: { dataSourceRef: { kind: 'docStateRef', docStateName: 'rows' } } },
      { interactiveProps: { optionsSource: { kind: 'ref', stateId: 'choices' } } },
      { interactiveProps: { link: { href: 'https://example.com' } } },
      { interactiveProps: { upload: { bucket: 'assets' } } },
      { interactiveProps: { module: { id: 'remote-module' } } },
      { interactiveProps: { text: { expr: 'profile.name' } } },
      { interactiveProps: { unknownFutureBehavior: true } },
      { bindings: [] as never },
      { events: { onClick: null } as never },
      { interactiveProps: null as never }
    ]
    for (const overrides of unsafeOverrides) {
      const result = validateChild('BUTTON', overrides)
      expect(result.ok).toBe(false)
      expect(result.issues.map((issue) => issue.code)).toContain('active-lowcode-behavior')
    }
  })

  test('rejects every document/application lowcode field, even when empty or false', () => {
    const patches: Array<Parameters<SceneGraph['createNode']>[2]> = [
      { lowcodeDocumentState: [] },
      { lowcodeSupabaseConfig: { url: 'https://example.supabase.co', anonKey: 'public' } },
      { lowcodeSeoMetadata: {} },
      { lowcodeAnalyticsConfig: {} as never },
      { lowcodeHeadMetadata: {} },
      { lowcodeCustomCss: '' },
      { lowcodeTranslations: {} },
      { lowcodeWorkflows: [] },
      { lowcodeServerWorkflows: [] },
      { lowcodeRoutePattern: '' },
      { lowcodeRequiresAuth: false },
      { lowcodeAuthRedirect: '' },
      { lowcodeLibraries: [] }
    ]
    for (const patch of patches) {
      const graph = new SceneGraph()
      const component = graph.createNode('COMPONENT', graph.getPages()[0].id, patch)
      const published = publishLibraryComponent(graph, {
        componentId: component.id,
        libraryId: 'design-system',
        componentKey: 'application-config'
      })
      expect('error' in published).toBe(false)
      if ('error' in published) throw new Error(published.error)
      const result = validateLibraryArtifact(graph, published.manifest)
      expect(result.ok).toBe(false)
      expect(result.issues.map((issue) => issue.code)).toContain('active-lowcode-behavior')
    }
  })

  test('rejects target-cache flags, external links, relaunch commands, and third-party plugin data', () => {
    const unsafePatches: Array<Parameters<SceneGraph['createNode']>[2]> = [
      { internalOnly: true },
      { lowcodeLibraryCache: true },
      { symbolLinks: [{ uri: ['javascript', 'alert(1)'].join(':') }] },
      { symbolLinks: [{ uri: 'file:///tmp/secret' }] },
      { symbolLinks: [{ uri: 'https://example.com/docs' }] },
      {
        pluginRelaunchData: [
          { pluginId: 'third-party', command: 'run', message: 'Run plugin', isDeleted: false }
        ]
      },
      { pluginData: [{ pluginId: 'third-party', key: 'payload', value: '{}' }] }
    ]
    for (const patch of unsafePatches) {
      const graph = new SceneGraph()
      const component = graph.createNode('COMPONENT', graph.getPages()[0].id, patch)
      const published = publishLibraryComponent(graph, {
        componentId: component.id,
        libraryId: 'design-system',
        componentKey: 'unsafe-metadata'
      })
      expect('error' in published).toBe(false)
      if ('error' in published) throw new Error(published.error)
      const result = validateLibraryArtifact(graph, published.manifest)
      expect(result.ok).toBe(false)
      expect(result.issues.map((issue) => issue.code)).toContain(
        patch.internalOnly || patch.lowcodeLibraryCache
          ? 'internal-library-node'
          : 'unsafe-library-metadata'
      )
    }
  })

  test('prefers the unique hidden cached master and rejects duplicate cache identities', () => {
    const sourceGraph = new SceneGraph()
    const sourcePage = sourceGraph.getPages()[0]
    const component = sourceGraph.createNode('COMPONENT', sourcePage.id, { name: 'Card' })
    const first = publishLibraryComponent(sourceGraph, {
      componentId: component.id,
      libraryId: 'design-system',
      componentKey: 'component-card',
      source: { kind: 'url', ref: 'https://example.com/card.fig' }
    })
    expect('error' in first).toBe(false)
    if ('error' in first) return

    const targetGraph = new SceneGraph()
    const cachePage = ensureLibraryCachePage(targetGraph)
    const imported = importLibraryComponent({
      sourceGraph,
      targetGraph,
      manifest: first.manifest,
      componentKey: 'component-card',
      parentId: cachePage.id
    })
    expect('error' in imported).toBe(false)
    if ('error' in imported) return
    targetGraph.createNode('COMPONENT', targetGraph.getPages()[0].id, {
      name: 'Visible legacy copy',
      libraryId: 'design-system',
      libraryComponentKey: 'component-card',
      libraryReadonly: true
    })

    sourceGraph.createNode('TEXT', component.id, { name: 'Updated', text: 'v2' })
    const next = publishLibraryComponent(sourceGraph, {
      componentId: component.id,
      libraryId: 'design-system',
      componentKey: 'component-card',
      source: { kind: 'url', ref: 'https://example.com/card-v2.fig' }
    })
    expect('error' in next).toBe(false)
    if ('error' in next) return
    const accepted = acceptLibraryUpdate({
      sourceGraph,
      targetGraph,
      manifest: next.manifest,
      componentKey: 'component-card'
    })
    expect(accepted).not.toHaveProperty('error')
    if ('error' in accepted) return
    expect(accepted.cachedNodeId).toBe(imported.importedNodeId)

    targetGraph.createNode('COMPONENT', cachePage.id, {
      name: 'Duplicate cached master',
      libraryId: 'design-system',
      libraryComponentKey: 'component-card',
      libraryReadonly: true
    })
    expect(
      acceptLibraryUpdate({
        sourceGraph,
        targetGraph,
        manifest: next.manifest,
        componentKey: 'component-card'
      })
    ).toEqual({
      error: 'Multiple cached components "component-card" exist for library "design-system"'
    })
  })

  test('fails validation when a manifest component cannot be resolved', () => {
    const graph = new SceneGraph()
    const result = validateLibraryArtifact(graph, {
      libraryId: 'design-system',
      name: 'Design System',
      components: [
        {
          key: 'missing',
          name: 'Missing',
          version: 'v1-missing',
          nodeId: 'missing',
          type: 'COMPONENT'
        }
      ]
    })
    expect(result).toEqual({
      ok: false,
      issues: [
        expect.objectContaining({
          code: 'missing-component',
          componentKey: 'missing',
          nodeId: 'missing'
        })
      ]
    })
  })
})
