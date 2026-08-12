import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import { chromium, type Browser, type Page } from '@playwright/test'
import { unzlibSync } from 'fflate'

import { compile, withDefaults } from '@open-pencil/compiler'
import { createPreviewServer, type PreviewServer } from '@open-pencil/compiler/dev-server'
import type { SceneGraph } from '@open-pencil/scene-graph'

import { firstPageId, makeSceneGraph } from '#tests/helpers/scene'

const SVG_GREEN = new TextEncoder().encode(
  '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"><rect width="20" height="20" fill="#00ff00"/></svg>'
)

function svgDataURL(color: string): string {
  return `data:image/svg+xml,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"><rect width="20" height="20" fill="${color}"/></svg>`
  )}`
}

function buildBrowserSmokeFiles(): { files: Map<string, string | Uint8Array>; ids: SmokeIds } {
  const graph: SceneGraph = makeSceneGraph()
  const pageId = firstPageId(graph)
  graph.images.set('green-fill', SVG_GREEN)

  const picture = graph.createNode('RECTANGLE', pageId, {
    name: 'PictureSmoke',
    x: 8,
    y: 8,
    width: 80,
    height: 80,
    interactiveProps: {
      image: {
        src: svgDataURL('#ff0000'),
        alt: 'Picture smoke',
        objectFit: 'cover',
        sources: [
          {
            srcSet: svgDataURL('#0000ff'),
            media: '(max-width: 640px)',
            type: 'image/svg+xml'
          }
        ]
      }
    }
  })

  const layered = graph.createNode('RECTANGLE', pageId, {
    name: 'LayeredGradientSmoke',
    x: 110,
    y: 8,
    width: 80,
    height: 80,
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
      }
    ]
  })

  const imageFill = graph.createNode('RECTANGLE', pageId, {
    name: 'ImageFillSmoke',
    x: 212,
    y: 8,
    width: 80,
    height: 80,
    fills: [
      {
        type: 'IMAGE',
        imageHash: 'green-fill',
        imageScaleMode: 'FIT',
        color: { r: 0, g: 0, b: 0, a: 1 },
        opacity: 1,
        visible: true
      }
    ]
  })

  graph.createNode('RECTANGLE', pageId, {
    name: 'BlendBaseSmoke',
    x: 8,
    y: 110,
    width: 80,
    height: 80,
    fills: [{ type: 'SOLID', color: { r: 1, g: 0, b: 0, a: 1 }, opacity: 1, visible: true }]
  })
  const blended = graph.createNode('RECTANGLE', pageId, {
    name: 'BlendMultiplySmoke',
    x: 8,
    y: 110,
    width: 80,
    height: 80,
    blendMode: 'MULTIPLY',
    fills: [{ type: 'SOLID', color: { r: 0, g: 0, b: 1, a: 1 }, opacity: 1, visible: true }]
  })

  const files = compile({
    graph,
    pageIds: [pageId],
    options: withDefaults({ packageName: 'browser-pixel-smoke' })
  }).files
  return {
    files,
    ids: { picture: picture.id, layered: layered.id, imageFill: imageFill.id, blended: blended.id }
  }
}

function buildLayoutFidelityFiles(): {
  files: Map<string, string | Uint8Array>
  ids: LayoutFidelityIds
} {
  const graph = makeSceneGraph()
  const pageId = firstPageId(graph)
  const scene = graph.createNode('FRAME', pageId, {
    name: 'GardenScene',
    width: 390,
    height: 400,
    layoutMode: 'NONE',
    clipsContent: true
  })
  const cabin = graph.createNode('FRAME', scene.id, {
    name: 'TinyCabin',
    x: 190,
    y: 98,
    width: 138,
    height: 174,
    layoutMode: 'NONE'
  })
  graph.createNode('RECTANGLE', cabin.id, {
    x: 8,
    y: 50,
    width: 122,
    height: 116
  })
  const frog = graph.createNode('ELLIPSE', scene.id, {
    name: 'FrogTraveler',
    x: 141,
    y: 248,
    width: 72,
    height: 78
  })

  const header = graph.createNode('FRAME', pageId, {
    name: 'StatusBar',
    x: 0,
    y: 420,
    width: 100,
    height: 40,
    layoutMode: 'HORIZONTAL',
    counterAxisAlign: 'CENTER'
  })
  const iconRow = graph.createNode('FRAME', header.id, {
    name: 'StatusIcons',
    width: 38,
    height: 16,
    layoutMode: 'HORIZONTAL',
    primaryAxisSizing: 'HUG',
    counterAxisSizing: 'HUG',
    itemSpacing: 8
  })
  const signal = graph.createNode('STAR', iconRow.id, { width: 14, height: 14 })
  const battery = graph.createNode('STAR', iconRow.id, { width: 16, height: 16 })

  const files = compile({
    graph,
    pageIds: [pageId],
    options: withDefaults({ packageName: 'layout-fidelity-smoke' })
  }).files
  return {
    files,
    ids: {
      scene: scene.id,
      cabin: cabin.id,
      frog: frog.id,
      iconRow: iconRow.id,
      signal: signal.id,
      battery: battery.id
    }
  }
}

interface SmokeIds {
  picture: string
  layered: string
  imageFill: string
  blended: string
}

interface LayoutFidelityIds {
  scene: string
  cabin: string
  frog: string
  iconRow: string
  signal: string
  battery: string
}

describe('preview browser pixels — image and visual fills (Phase 4 §24)', () => {
  const hookTimeoutMs = 30_000
  let server: PreviewServer | null = null
  let browser: Browser | null = null
  let page: Page | null = null

  beforeEach(async () => {
    server = await createPreviewServer({})
    browser = await chromium.launch()
    page = await browser.newPage({ viewport: { width: 360, height: 220 }, deviceScaleFactor: 1 })
  }, hookTimeoutMs)

  afterEach(async () => {
    try {
      if (page) await page.close()
    } finally {
      try {
        if (browser) await browser.close()
      } finally {
        if (server) await server.close()
        page = null
        browser = null
        server = null
      }
    }
  }, hookTimeoutMs)

  test('renders picture, multi-background, image-fill, and blend pixels', async () => {
    if (!server || !page) throw new Error('missing preview test runtime')
    const { files, ids } = buildBrowserSmokeFiles()
    server.updateFiles(files)
    await page.goto(server.url)
    await waitForImages(page)

    const picture = await elementImage(page, ids.picture)
    expect(colorAt(picture, 40, 40)).toEqual([0, 0, 255, 255])

    const layered = await elementImage(page, ids.layered)
    const top = colorAt(layered, 40, 10)
    const bottom = colorAt(layered, 40, 70)
    expect(top[0]).toBeGreaterThan(top[2])
    expect(bottom[2]).toBeGreaterThan(bottom[0])

    const imageFill = await elementImage(page, ids.imageFill)
    expect(colorAt(imageFill, 40, 40)).toEqual([0, 255, 0, 255])

    const blended = await elementImage(page, ids.blended)
    expectRGBNear(colorAt(blended, 40, 40), [0, 0, 0], 4)

    const blendMode = await page.locator(nodeSelector(ids.blended)).evaluate((el) => {
      return getComputedStyle(el as HTMLElement).mixBlendMode
    })
    expect(blendMode).toBe('multiply')

    const backgroundImage = await page.locator(nodeSelector(ids.layered)).evaluate((el) => {
      return getComputedStyle(el as HTMLElement).backgroundImage
    })
    expect(backgroundImage).toContain('linear-gradient')
    expect(backgroundImage).toContain('rgb(255, 255, 255)')
  }, 30_000)

  test('keeps nested coordinate scenes and HUG icon rows at canvas geometry', async () => {
    if (!server || !page) throw new Error('missing preview test runtime')
    const { files, ids } = buildLayoutFidelityFiles()
    server.updateFiles(files)
    await page.goto(server.url, { waitUntil: 'networkidle' })

    const boxes = await page.evaluate(
      (selectors) => {
        const rect = (selector: string) => {
          const el = document.querySelector(selector)
          if (!el) throw new Error(`missing ${selector}`)
          const box = el.getBoundingClientRect()
          return { x: box.x, y: box.y, width: box.width, height: box.height }
        }
        return {
          scene: rect(selectors.scene),
          cabin: rect(selectors.cabin),
          frog: rect(selectors.frog),
          iconRow: rect(selectors.iconRow),
          signal: rect(selectors.signal),
          battery: rect(selectors.battery)
        }
      },
      Object.fromEntries(Object.entries(ids).map(([key, id]) => [key, nodeSelector(id)]))
    )

    expect(boxes.cabin.x - boxes.scene.x).toBeCloseTo(190, 1)
    expect(boxes.cabin.y - boxes.scene.y).toBeCloseTo(98, 1)
    expect(boxes.frog.x - boxes.scene.x).toBeCloseTo(141, 1)
    expect(boxes.frog.y - boxes.scene.y).toBeCloseTo(248, 1)
    expect(boxes.iconRow.width).toBeCloseTo(38, 1)
    expect(boxes.iconRow.height).toBeCloseTo(16, 1)
    expect(boxes.signal.width).toBeCloseTo(14, 1)
    expect(boxes.battery.width).toBeCloseTo(16, 1)
  }, 30_000)
})

async function waitForImages(page: Page): Promise<void> {
  await page.waitForFunction(
    () =>
      new Promise<boolean>((resolve) => {
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            resolve([...document.images].every((img) => img.complete && img.naturalWidth > 0))
          })
        })
      })
  )
}

async function elementImage(page: Page, nodeId: string): Promise<PNGImage> {
  const locator = page.locator(nodeSelector(nodeId))
  await locator.waitFor({ state: 'visible' })
  const box = await locator.boundingBox()
  if (!box) throw new Error(`node ${nodeId} has no bounding box`)
  return decodePNG(new Uint8Array(await page.screenshot({ clip: box })))
}

function nodeSelector(nodeId: string): string {
  return `[data-node-id="${cssEscape(nodeId)}"]`
}

function cssEscape(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

interface PNGImage {
  width: number
  height: number
  data: Uint8Array
}

function colorAt(image: PNGImage, x: number, y: number): [number, number, number, number] {
  const clampedX = Math.max(0, Math.min(image.width - 1, Math.round(x)))
  const clampedY = Math.max(0, Math.min(image.height - 1, Math.round(y)))
  const index = (clampedY * image.width + clampedX) * 4
  return [
    image.data[index] ?? 0,
    image.data[index + 1] ?? 0,
    image.data[index + 2] ?? 0,
    image.data[index + 3] ?? 0
  ]
}

function expectRGBNear(
  actual: [number, number, number, number],
  expected: [number, number, number],
  tolerance: number
): void {
  for (let i = 0; i < expected.length; i++) {
    expect(Math.abs((actual[i] ?? 0) - expected[i])).toBeLessThanOrEqual(tolerance)
  }
  expect(actual[3]).toBe(255)
}

function decodePNG(bytes: Uint8Array): PNGImage {
  assertPNGSignature(bytes)
  let offset = 8
  let width = 0
  let height = 0
  let colorType = 6
  const idat: Uint8Array[] = []
  while (offset < bytes.length) {
    const length = readU32(bytes, offset)
    const type = ascii(bytes, offset + 4, 4)
    const dataStart = offset + 8
    const dataEnd = dataStart + length
    if (type === 'IHDR') {
      width = readU32(bytes, dataStart)
      height = readU32(bytes, dataStart + 4)
      const bitDepth = bytes[dataStart + 8]
      colorType = bytes[dataStart + 9] ?? 6
      if (bitDepth !== 8 || (colorType !== 2 && colorType !== 6)) {
        throw new Error(`unsupported PNG format bitDepth=${bitDepth} colorType=${colorType}`)
      }
    } else if (type === 'IDAT') {
      idat.push(bytes.slice(dataStart, dataEnd))
    } else if (type === 'IEND') {
      break
    }
    offset = dataEnd + 4
  }
  if (width <= 0 || height <= 0 || idat.length === 0) throw new Error('invalid PNG screenshot')
  return unfilterPNG(width, height, colorType, concat(idat))
}

function unfilterPNG(
  width: number,
  height: number,
  colorType: number,
  compressed: Uint8Array
): PNGImage {
  const channels = colorType === 6 ? 4 : 3
  const stride = width * channels
  const inflated = unzlibSync(compressed)
  const raw = new Uint8Array(width * height * channels)
  let source = 0
  for (let y = 0; y < height; y++) {
    const filter = inflated[source++]
    const rowStart = y * stride
    for (let x = 0; x < stride; x++) {
      const left = x >= channels ? (raw[rowStart + x - channels] ?? 0) : 0
      const up = y > 0 ? (raw[rowStart + x - stride] ?? 0) : 0
      const upLeft = y > 0 && x >= channels ? (raw[rowStart + x - stride - channels] ?? 0) : 0
      const value = inflated[source++] ?? 0
      raw[rowStart + x] = (value + filterDelta(filter, left, up, upLeft)) & 0xff
    }
  }
  return { width, height, data: toRgba(raw, colorType) }
}

function filterDelta(filter: number, left: number, up: number, upLeft: number): number {
  if (filter === 0) return 0
  if (filter === 1) return left
  if (filter === 2) return up
  if (filter === 3) return Math.floor((left + up) / 2)
  if (filter === 4) return paeth(left, up, upLeft)
  throw new Error(`unsupported PNG filter ${filter}`)
}

function paeth(left: number, up: number, upLeft: number): number {
  const p = left + up - upLeft
  const pa = Math.abs(p - left)
  const pb = Math.abs(p - up)
  const pc = Math.abs(p - upLeft)
  if (pa <= pb && pa <= pc) return left
  return pb <= pc ? up : upLeft
}

function toRgba(raw: Uint8Array, colorType: number): Uint8Array {
  if (colorType === 6) return raw
  const out = new Uint8Array((raw.length / 3) * 4)
  for (let source = 0, target = 0; source < raw.length; source += 3, target += 4) {
    out[target] = raw[source] ?? 0
    out[target + 1] = raw[source + 1] ?? 0
    out[target + 2] = raw[source + 2] ?? 0
    out[target + 3] = 255
  }
  return out
}

function assertPNGSignature(bytes: Uint8Array): void {
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
  for (let i = 0; i < signature.length; i++) {
    if (bytes[i] !== signature[i]) throw new Error('not a PNG screenshot')
  }
}

function concat(chunks: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.length, 0))
  let offset = 0
  for (const chunk of chunks) {
    out.set(chunk, offset)
    offset += chunk.length
  }
  return out
}

function readU32(bytes: Uint8Array, offset: number): number {
  return (
    (((bytes[offset] ?? 0) << 24) |
      ((bytes[offset + 1] ?? 0) << 16) |
      ((bytes[offset + 2] ?? 0) << 8) |
      (bytes[offset + 3] ?? 0)) >>>
    0
  )
}

function ascii(bytes: Uint8Array, offset: number, length: number): string {
  return String.fromCharCode(...bytes.slice(offset, offset + length))
}
