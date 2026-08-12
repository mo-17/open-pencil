import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import { compile, withDefaults } from '@open-pencil/compiler'
import { createPreviewServer, type PreviewServer } from '@open-pencil/compiler/dev-server'
import type { SceneGraph } from '@open-pencil/scene-graph'

import { firstPageId, makeSceneGraph } from '#tests/helpers/scene'

const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2])

function buildImageSmokeFiles() {
  const graph: SceneGraph = makeSceneGraph()
  const pageId = firstPageId(graph)
  graph.images.set('runtime-image', PNG_BYTES)
  graph.createNode('RECTANGLE', pageId, {
    name: 'ResponsiveImage',
    x: 8,
    y: 8,
    width: 320,
    height: 180,
    interactiveProps: {
      image: {
        src: 'https://example.test/desktop.jpg',
        alt: 'Hero',
        objectFit: 'cover',
        sources: [
          {
            srcSet: 'https://example.test/mobile.jpg 640w',
            media: '(max-width: 640px)',
            type: 'image/jpeg',
            sizes: '100vw'
          }
        ]
      },
      aspectRatio: '16/9'
    }
  })
  graph.createNode('RECTANGLE', pageId, {
    name: 'LayeredFill',
    x: 8,
    y: 220,
    width: 200,
    height: 100,
    fills: [
      { type: 'SOLID', color: { r: 1, g: 1, b: 1, a: 1 }, opacity: 1, visible: true },
      {
        type: 'GRADIENT_LINEAR',
        color: { r: 0, g: 0, b: 0, a: 1 },
        opacity: 1,
        visible: true,
        gradientStops: [
          { color: { r: 1, g: 0, b: 0, a: 1 }, position: 0 },
          { color: { r: 0, g: 0, b: 1, a: 1 }, position: 1 }
        ],
        gradientTransform: { m00: 0, m01: 1, m02: 0, m10: -1, m11: 0, m12: 1 }
      },
      {
        type: 'IMAGE',
        imageHash: 'runtime-image',
        imageScaleMode: 'FIT',
        color: { r: 0, g: 0, b: 0, a: 1 },
        opacity: 1,
        visible: true
      }
    ]
  })
  return compile({
    graph,
    pageIds: [pageId],
    options: withDefaults({ packageName: 'image-runtime' })
  }).files
}

async function fetchOk(url: string): Promise<Response> {
  const res = await fetch(url)
  if (res.status !== 200) throw new Error(`GET ${url} -> ${res.status}`)
  return res
}

async function fetchText(url: string): Promise<string> {
  return await (await fetchOk(url)).text()
}

async function fetchCSS(server: PreviewServer): Promise<string> {
  const body = await fetchText(`${server.url}src/index.css?t=${Date.now()}`)
  const match = body.match(/const __vite__css = "((?:[^"\\]|\\.)*)"/)
  if (!match) throw new Error('index.css did not transform to a Vite CSS module')
  return JSON.parse(`"${match[1]}"`) as string
}

describe('preview runtime — image fills and responsive images (Phase 4 §24)', () => {
  let server: PreviewServer | null = null

  beforeEach(async () => {
    server = await createPreviewServer({})
  })

  afterEach(async () => {
    if (server) await server.close()
    server = null
  })

  test('serves picture markup, stacked background CSS, and image fill assets', async () => {
    if (!server) throw new Error('no server')
    const files = buildImageSmokeFiles()
    server.updateFiles(files)

    const appSource = files.get('src/App.tsx') as string
    expect(appSource).toContain('<picture>')
    expect(appSource).toContain('<source')
    expect(appSource).toContain('https://example.test/mobile.jpg 640w')
    expect(appSource).toContain('https://example.test/desktop.jpg')
    expect(appSource).toContain('Hero')

    const css = await fetchCSS(server)
    expect(css).toContain('aspect-ratio: 16/9')
    expect(css).toContain('background-image: url(./assets/openpencil-image-runtime-image.png)')
    expect(css).toContain('linear-gradient(180deg, #FF0000 0%, #0000FF 100%)')
    expect(css).toContain('background-size: contain,auto,auto')
    expect(css).toContain('background-repeat: no-repeat,no-repeat,no-repeat')

    const asset = await fetchOk(`${server.url}src/assets/openpencil-image-runtime-image.png`)
    expect(asset.headers.get('content-type')).toContain('image/png')
    expect(new Uint8Array(await asset.arrayBuffer())).toEqual(PNG_BYTES)

    const rootRelativeAsset = await fetchOk(
      `${server.url}assets/openpencil-image-runtime-image.png`
    )
    expect(new Uint8Array(await rootRelativeAsset.arrayBuffer())).toEqual(PNG_BYTES)
  }, 15_000)
})
