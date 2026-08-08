import { describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { compile, withDefaults } from '@open-pencil/compiler'
import { buildPreviewProject } from '@open-pencil/compiler/build'
import { collectTree } from '@open-pencil/compiler/ir/collect/tree'
import type { IRElement } from '@open-pencil/compiler/ir/types'
import { MAP_MODULE_ATTRIBUTION, createMapModuleFrameOverrides } from '@open-pencil/core/plugins'

import { firstPageId, makeSceneGraph } from '#tests/helpers/scene'

function mapModule(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    version: 1,
    pluginId: 'open-pencil.map',
    moduleType: 'map',
    configVersion: 1,
    config: {
      provider: 'openstreetmap',
      style: 'dark',
      center: [121.4737, 31.2304],
      zoom: 11,
      interactive: true,
      markers: [{ id: 'bund', lng: 121.4903, lat: 31.2412, label: '<img src=x onerror=alert(1)>' }],
      layers: [],
      attribution: MAP_MODULE_ATTRIBUTION,
      ...overrides
    }
  }
}

describe('compiler built-in map module', () => {
  test('lowers a validated FRAME envelope to typed map IR with overlay children', () => {
    const graph = makeSceneGraph()
    const pageId = firstPageId(graph)
    const frame = graph.createNode('FRAME', pageId, {
      name: 'Map',
      width: 640,
      height: 360,
      interactiveProps: { module: mapModule() }
    })
    graph.createNode('TEXT', frame.id, { text: 'authored fallback child' })

    const ir = collectTree(graph, pageId)
    const element = ir.children[0] as IRElement

    expect(element.kind).toBe('element')
    expect(element.tag).toBe('div')
    expect(JSON.stringify(element.children)).toContain('authored fallback child')
    expect(element.module).toEqual({
      pluginId: 'open-pencil.map',
      moduleType: 'map',
      configVersion: 1,
      payload: {
        provider: 'openstreetmap',
        style: 'dark',
        center: [121.4737, 31.2304],
        zoom: 11,
        interactive: true,
        markers: [
          { id: 'bund', lng: 121.4903, lat: 31.2412, label: '<img src=x onerror=alert(1)>' }
        ],
        layers: [],
        attribution: MAP_MODULE_ATTRIBUTION
      }
    })
    expect(ir.warnings.map((warning) => warning.code)).not.toContain('map-module-children-dropped')
  })

  test('keeps all-vector map children instead of folding and dropping the overlay', () => {
    const graph = makeSceneGraph()
    const pageId = firstPageId(graph)
    const frame = graph.createNode('FRAME', pageId, {
      ...createMapModuleFrameOverrides(),
      width: 320,
      height: 180
    })
    const line = graph.createNode('LINE', frame.id, { width: 120, height: 1 })

    const ir = collectTree(graph, pageId)
    const element = ir.children[0] as IRElement

    expect(element.module).toBeDefined()
    expect(element.rawHtml).toBeUndefined()
    expect(element.className).toContain('bg-')
    expect(element.className).toContain('border')
    expect(JSON.stringify(element.children)).toContain(line.id)
  })

  test('keeps auto-layout children as direct Map host flex items', () => {
    const graph = makeSceneGraph()
    const pageId = firstPageId(graph)
    const frame = graph.createNode('FRAME', pageId, {
      ...createMapModuleFrameOverrides(),
      width: 320,
      height: 180,
      layoutMode: 'HORIZONTAL',
      itemSpacing: 12
    })
    graph.createNode('TEXT', frame.id, { text: 'First overlay' })
    graph.createNode('TEXT', frame.id, { text: 'Second overlay' })

    const out = compile({ graph, pageIds: [pageId], options: withDefaults() })
    const app = out.files.get('src/App.tsx') as string
    const runtime = out.files.get('src/__openpencil_map.tsx') as string

    expect(app).toMatch(/<OpenPencilMap[^>]*className="[^"]*\bflex\b[^"]*\bgap-3\b/)
    expect(app).toContain('First overlay')
    expect(app).toContain('Second overlay')
    expect(runtime).toContain('<div {...hostProps} className={className} style={hostStyle}>')
    expect(runtime).not.toContain(
      "<div style={{ height: '100%', position: 'relative', width: '100%' }}>"
    )
    expect(runtime).toMatch(
      /<div \{\.\.\.hostProps\} className=\{className\} style=\{hostStyle\}>[\s\S]*\n      \{children\}\n    <\/div>/
    )
  })

  test('keeps the ordinary FRAME fallback when the built-in map config is invalid', () => {
    const graph = makeSceneGraph()
    const pageId = firstPageId(graph)
    const frame = graph.createNode('FRAME', pageId, {
      width: 320,
      height: 180,
      interactiveProps: { module: mapModule({ provider: 'unsupported-provider' }) }
    })
    graph.createNode('TEXT', frame.id, { text: 'Map unavailable' })

    const ir = collectTree(graph, pageId)
    const element = ir.children[0] as IRElement

    expect(element.module).toBeUndefined()
    expect(JSON.stringify(element.children)).toContain('Map unavailable')
    expect(ir.warnings.map((warning) => warning.code)).toContain('map-module-invalid')
  })

  test('leaves another plugin module family untouched for a future adapter', () => {
    const graph = makeSceneGraph()
    const pageId = firstPageId(graph)
    const frame = graph.createNode('FRAME', pageId, {
      width: 320,
      height: 180,
      interactiveProps: {
        module: {
          version: 1,
          pluginId: 'example.chart',
          moduleType: 'chart',
          configVersion: 1,
          config: {}
        }
      }
    })
    graph.createNode('TEXT', frame.id, { text: 'Chart fallback' })

    const ir = collectTree(graph, pageId)
    const element = ir.children[0] as IRElement

    expect(element.module).toBeUndefined()
    expect(JSON.stringify(element.children)).toContain('Chart fallback')
    expect(ir.warnings.some((warning) => warning.code.startsWith('map-module-'))).toBe(false)
  })

  test('rejects non-canonical attribution and keeps authored fallback children', () => {
    const graph = makeSceneGraph()
    const pageId = firstPageId(graph)
    const frame = graph.createNode('FRAME', pageId, {
      width: 320,
      height: 180,
      interactiveProps: { module: mapModule({ attribution: 'Map data by Example' }) }
    })
    graph.createNode('TEXT', frame.id, { text: 'Invalid attribution fallback' })

    const ir = collectTree(graph, pageId)
    const element = ir.children[0] as IRElement

    expect(element.module).toBeUndefined()
    expect(JSON.stringify(element.children)).toContain('Invalid attribution fallback')
    expect(ir.warnings.map((warning) => warning.code)).toContain('map-module-invalid')
  })

  test('emits the local MapLibre runtime and dependency only for a reachable map', () => {
    const graph = makeSceneGraph()
    const pageId = firstPageId(graph)
    const mapFrame = graph.createNode('FRAME', pageId, {
      width: 640,
      height: 360,
      interactiveProps: { module: mapModule() }
    })
    graph.createNode('TEXT', mapFrame.id, { text: 'Venue overlay', x: 16, y: 16 })

    const out = compile({
      graph,
      pageIds: [pageId],
      options: withDefaults({ packageName: 'map-demo' })
    })
    const app = out.files.get('src/App.tsx') as string
    const runtime = out.files.get('src/__openpencil_map.tsx') as string
    const pkg = JSON.parse(out.files.get('package.json') as string) as {
      dependencies: Record<string, string>
    }

    expect(app).toContain("import OpenPencilMap from './__openpencil_map'")
    expect(app).toContain('<OpenPencilMap config={{')
    expect(app).toContain('Venue overlay')
    expect(app).toContain('</OpenPencilMap>')
    expect(app.indexOf('<OpenPencilMap config={{')).toBeLessThan(app.indexOf('Venue overlay'))
    expect(app.indexOf('Venue overlay')).toBeLessThan(app.indexOf('</OpenPencilMap>'))
    expect(pkg.dependencies['maplibre-gl']).toBe('6.0.0')
    expect(runtime).toContain("from 'maplibre-gl'")
    expect(runtime).toContain("import 'maplibre-gl/dist/maplibre-gl.css'")
    expect(runtime).not.toMatch(/import\s+maplibregl\s+from/)
    expect(runtime).not.toMatch(/<script|cdn\.jsdelivr|unpkg\.com/i)
    expect(runtime).toContain('.textContent = marker.label')
    expect(runtime).not.toContain('.innerHTML')
    expect(runtime).toContain('.remove()')
    expect(runtime).toContain('tile.openstreetmap.org')
    expect(runtime).toContain('maxzoom: 19')
    expect(runtime).toContain('maxZoom: 19')
    expect(runtime).toContain('https://www.openstreetmap.org/copyright')
    expect(runtime).toContain(MAP_MODULE_ATTRIBUTION)
    expect(runtime).toContain('target=\\"_blank\\"')
    expect(runtime).toContain('rel=\\"noopener noreferrer\\"')
    expect(runtime).toContain('attributionControl: { compact: false }')
    expect(runtime).not.toContain('escapeAttribution')
    expect(runtime).toContain('children,')
    expect(runtime.indexOf('ref={containerRef}')).toBeLessThan(runtime.indexOf('{children}'))
  })

  test('does not add a map runtime or dependency to an ordinary document', () => {
    const graph = makeSceneGraph()
    const pageId = firstPageId(graph)
    graph.createNode('FRAME', pageId, { width: 320, height: 180 })

    const out = compile({ graph, pageIds: [pageId], options: withDefaults() })
    const pkg = JSON.parse(out.files.get('package.json') as string) as {
      dependencies: Record<string, string>
    }

    expect(out.files.has('src/__openpencil_map.tsx')).toBe(false)
    expect(pkg.dependencies['maplibre-gl']).toBeUndefined()
    expect(out.files.get('src/App.tsx') as string).not.toContain('OpenPencilMap')
  })

  test('keeps a valid module ahead of conflicting generic icon metadata', () => {
    const graph = makeSceneGraph()
    const pageId = firstPageId(graph)
    graph.createNode('FRAME', pageId, {
      width: 320,
      height: 180,
      interactiveProps: {
        module: mapModule(),
        icon: { name: 'camera' }
      }
    })

    const out = compile({ graph, pageIds: [pageId], options: withDefaults() })
    const app = out.files.get('src/App.tsx') as string
    const pkg = JSON.parse(out.files.get('package.json') as string) as {
      dependencies: Record<string, string>
    }

    expect(app).toContain('<OpenPencilMap config={{')
    expect(app).not.toContain("from 'lucide-react'")
    expect(app).not.toContain('<Camera')
    expect(pkg.dependencies['lucide-react']).toBeUndefined()
  })

  test('uses the page-relative runtime import in a multi-page project', () => {
    const graph = makeSceneGraph()
    const firstPage = firstPageId(graph)
    const mapPage = graph.addPage('Map')
    graph.createNode('TEXT', firstPage, { text: 'Home' })
    graph.createNode('FRAME', mapPage.id, {
      width: 640,
      height: 360,
      interactiveProps: { module: mapModule({ style: 'light' }) }
    })

    const out = compile({
      graph,
      pageIds: [firstPage, mapPage.id],
      options: withDefaults({ packageName: 'map-pages' })
    })
    const pageSources = [...out.files]
      .filter(([path]) => path.startsWith('src/pages/'))
      .map(([, source]) => source as string)

    expect(pageSources.some((source) => source.includes("from '../__openpencil_map'"))).toBe(true)
    expect(out.files.has('src/__openpencil_map.tsx')).toBe(true)
  })

  test('scans a reachable reusable component body for maps', () => {
    const graph = makeSceneGraph()
    const pageId = firstPageId(graph)
    const master = graph.createNode('COMPONENT', pageId, {
      name: 'MapCard',
      width: 640,
      height: 360
    })
    graph.createNode('FRAME', master.id, {
      width: 640,
      height: 360,
      interactiveProps: { module: mapModule({ interactive: false }) }
    })
    graph.createInstance(master.id, pageId)

    const out = compile({
      graph,
      pageIds: [pageId],
      options: withDefaults({ packageName: 'map-component' })
    })
    const component = out.files.get('src/components/MapCard.tsx') as string
    const pkg = JSON.parse(out.files.get('package.json') as string) as {
      dependencies: Record<string, string>
    }

    expect(component).toContain("import OpenPencilMap from '../__openpencil_map'")
    expect(component).toContain('<OpenPencilMap config={{')
    expect(pkg.dependencies['maplibre-gl']).toBe('6.0.0')
    expect(out.files.has('src/__openpencil_map.tsx')).toBe(true)
  })

  test('bundles the generated MapLibre runtime into a static preview project', async () => {
    const graph = makeSceneGraph()
    const pageId = firstPageId(graph)
    graph.createNode('FRAME', pageId, {
      width: 640,
      height: 360,
      interactiveProps: { module: mapModule({ style: 'standard' }) }
    })
    const out = compile({
      graph,
      pageIds: [pageId],
      options: withDefaults({ packageName: 'map-static', devMode: false })
    })
    const buildDirectory = mkdtempSync(join(tmpdir(), 'openpencil-map-build-'))

    try {
      const built = await buildPreviewProject({ files: out.files, outDir: buildDirectory })

      expect(built.files).toContain('index.html')
      expect(built.files.some((path) => path.endsWith('.js'))).toBe(true)
      expect(built.files.some((path) => path.endsWith('.css'))).toBe(true)
    } finally {
      rmSync(buildDirectory, { recursive: true, force: true })
    }
  }, 15_000)
})
