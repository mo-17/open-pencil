import { describe, expect, test } from 'bun:test'

import { withDefaults } from '@open-pencil/compiler'
import { SceneGraph } from '@open-pencil/scene-graph'

import { BROWSER_PREVIEW_WORKER_LIMITS } from '@/app/lowcode/preview-pane/browser-worker/limits'
import {
  BROWSER_PREVIEW_WORKER_PROTOCOL_VERSION,
  createCorrelatedBrowserPreviewWorkerResponse,
  createBrowserPreviewWorkerRequest,
  parseBrowserPreviewWorkerResponse,
  validateBrowserPreviewWorkerBuildResult,
  validateBrowserPreviewWorkerRequest,
  type BrowserPreviewFontProvider
} from '@/app/lowcode/preview-pane/browser-worker/protocol'

const REQUEST_ID = '12345678-1234-4234-9234-123456789012'
const CHANNEL_ID = '87654321-4321-4321-8321-210987654321'

function fixture() {
  const graph = new SceneGraph()
  const pageIds = graph.getPages().map(({ id }) => id)
  return {
    graph,
    pageIds,
    options: withDefaults({ packageName: 'openpencil-preview', target: 'react', router: 'none' }),
    fontProviders: ['google', 'fontsource'] satisfies BrowserPreviewFontProvider[],
    refreshFonts: false
  }
}

function metrics() {
  return {
    compileMs: 1,
    bundleMs: 2,
    totalMs: 3,
    inputBytes: 4,
    outputBytes: 5,
    fileCount: 6,
    dependencyCount: 7
  }
}

describe('browser preview Worker protocol', () => {
  test('creates a bounded data-only graph snapshot without detaching image bytes', () => {
    const input = fixture()
    const image = new Uint8Array([1, 2, 3, 4])
    input.graph.images.set('image', image)
    const request = createBrowserPreviewWorkerRequest(
      { generation: 7, ...input },
      REQUEST_ID,
      CHANNEL_ID
    )

    expect(request.type).toBe('build-browser-preview')
    expect(request.generation).toBe(7)
    expect(request.version).toBe(3)
    expect(request.fontProviders).toEqual(['google', 'fontsource'])
    expect(request.refreshFonts).toBe(false)
    expect(request.graph.images).toEqual([['image', image]])
    expect(request.graph).not.toBe(input.graph)
    expect(image.byteLength).toBe(4)
  })

  test('accepts only unique reviewed font provider ids and rejects network authority fields', () => {
    const input = fixture()
    const request = createBrowserPreviewWorkerRequest(
      {
        generation: 1,
        ...input,
        fontProviders: ['google', 'fontsource', 'bunny', 'fontshare'],
        refreshFonts: true
      },
      REQUEST_ID,
      CHANNEL_ID
    )
    expect(request.fontProviders).toEqual(['google', 'fontsource', 'bunny', 'fontshare'])
    expect(request.refreshFonts).toBe(true)
    expect(() =>
      validateBrowserPreviewWorkerRequest({
        ...request,
        fontProviders: ['google', 'google']
      })
    ).toThrow('must be unique')
    expect(() =>
      validateBrowserPreviewWorkerRequest({ ...request, fontProviders: ['google', 'custom'] })
    ).toThrow('font providers are invalid')
    expect(() =>
      validateBrowserPreviewWorkerRequest({
        ...request,
        fontURL: 'https://example.test/font.woff2',
        headers: { authorization: 'Bearer secret' },
        token: 'secret'
      })
    ).toThrow('fields are invalid')
    expect(() => validateBrowserPreviewWorkerRequest({ ...request, refreshFonts: 'yes' })).toThrow(
      'refresh fonts flag is invalid'
    )
  })

  test('checks font provider arrays inside the structured clone budget', () => {
    const input = fixture()
    const request = createBrowserPreviewWorkerRequest(
      { generation: 1, ...input },
      REQUEST_ID,
      CHANNEL_ID
    )
    const fontProviders = [...request.fontProviders]
    Object.defineProperty(fontProviders, 0, {
      enumerable: true,
      get: () => 'google'
    })
    expect(() => validateBrowserPreviewWorkerRequest({ ...request, fontProviders })).toThrow(
      'must not contain accessors'
    )
  })

  test('rejects unknown compiler options and nested accessors before Worker creation', () => {
    const input = fixture()
    const request = createBrowserPreviewWorkerRequest(
      { generation: 1, ...input },
      REQUEST_ID,
      CHANNEL_ID
    )
    const unknownOption = {
      ...request,
      options: { ...request.options, metadata: { title: 'not allowed in browser preview' } }
    }
    expect(() => validateBrowserPreviewWorkerRequest(unknownOption)).toThrow('fields are invalid')

    const accessorOptions = { ...request.options }
    Object.defineProperty(accessorOptions, 'packageName', {
      enumerable: true,
      get: () => 'openpencil-preview'
    })
    expect(() =>
      validateBrowserPreviewWorkerRequest({ ...request, options: accessorOptions })
    ).toThrow('must not contain accessors')
  })

  test('rejects duplicate graph tuple keys and duplicate page ids', () => {
    const input = fixture()
    input.graph.images.set('image', new Uint8Array([1]))
    const request = createBrowserPreviewWorkerRequest(
      { generation: 1, ...input },
      REQUEST_ID,
      CHANNEL_ID
    )
    const duplicateImages = {
      ...request,
      graph: {
        ...request.graph,
        images: [...request.graph.images, ['image', new Uint8Array([2])]]
      }
    }
    expect(() => validateBrowserPreviewWorkerRequest(duplicateImages)).toThrow('duplicate key')
    expect(() =>
      validateBrowserPreviewWorkerRequest({
        ...request,
        pageIds: [...request.pageIds, ...request.pageIds]
      })
    ).toThrow('must be unique')
  })

  test('counts the complete binary backing buffer against the 32 MiB input limit', () => {
    const input = fixture()
    const backing = new ArrayBuffer(BROWSER_PREVIEW_WORKER_LIMITS.maxSnapshotBytes + 1)
    input.graph.images.set('slice', new Uint8Array(backing, backing.byteLength - 1, 1))

    expect(() =>
      createBrowserPreviewWorkerRequest({ generation: 1, ...input }, REQUEST_ID, CHANNEL_ID)
    ).toThrow(`exceeds ${BROWSER_PREVIEW_WORKER_LIMITS.maxSnapshotBytes} bytes`)
  })

  test('requires exact correlated responses and rejects stale generations', () => {
    const response = {
      version: BROWSER_PREVIEW_WORKER_PROTOCOL_VERSION,
      type: 'result',
      requestId: REQUEST_ID,
      generation: 8,
      result: { status: 'ready', html: '<main>ready</main>', diagnostics: [], metrics: metrics() }
    }
    expect(parseBrowserPreviewWorkerResponse(response, REQUEST_ID, 7)).toBeNull()
    expect(parseBrowserPreviewWorkerResponse(response, REQUEST_ID, 8)).toEqual(response)
    expect(() =>
      parseBrowserPreviewWorkerResponse({ ...response, extra: true }, REQUEST_ID, 8)
    ).toThrow('fields are invalid')
  })

  test('accepts only exact, correlated, bounded Worker stage progress', () => {
    const progress = {
      version: BROWSER_PREVIEW_WORKER_PROTOCOL_VERSION,
      type: 'progress',
      requestId: REQUEST_ID,
      generation: 8,
      stage: 'fonts',
      elapsedMs: 12.5
    }
    expect(parseBrowserPreviewWorkerResponse(progress, REQUEST_ID, 8)).toEqual(progress)
    expect(parseBrowserPreviewWorkerResponse(progress, REQUEST_ID, 7)).toBeNull()
    expect(() =>
      parseBrowserPreviewWorkerResponse({ ...progress, stage: 'network' }, REQUEST_ID, 8)
    ).toThrow('progress is invalid')
    expect(() =>
      parseBrowserPreviewWorkerResponse({ ...progress, elapsedMs: -1 }, REQUEST_ID, 8)
    ).toThrow('progress is invalid')
    expect(() =>
      parseBrowserPreviewWorkerResponse({ ...progress, secret: 'nope' }, REQUEST_ID, 8)
    ).toThrow('fields are invalid')
  })

  test('turns a nested-invalid but correlated request into a structured failure', () => {
    const input = fixture()
    const request = createBrowserPreviewWorkerRequest(
      { generation: 12, ...input },
      REQUEST_ID,
      CHANNEL_ID
    )
    const malformed = { ...request, options: { ...request.options, metadata: {} } }
    expect(() => validateBrowserPreviewWorkerRequest(malformed)).toThrow()

    expect(
      createCorrelatedBrowserPreviewWorkerResponse(malformed, {
        status: 'error',
        diagnostics: [
          {
            code: 'browser-preview-build-failed',
            severity: 'error',
            message: 'Browser preview Worker options fields are invalid'
          }
        ],
        metrics: metrics()
      })
    ).toMatchObject({
      type: 'result',
      requestId: REQUEST_ID,
      generation: 12,
      result: { status: 'error' }
    })
  })

  test('bounds diagnostics and final HTML returned by the Worker', () => {
    expect(() =>
      validateBrowserPreviewWorkerBuildResult({
        status: 'error',
        diagnostics: Array.from(
          { length: BROWSER_PREVIEW_WORKER_LIMITS.maxDiagnostics + 1 },
          () => ({ code: 'error', severity: 'error', message: 'failed' })
        ),
        metrics: metrics()
      })
    ).toThrow('too many diagnostics')

    expect(() =>
      validateBrowserPreviewWorkerBuildResult({
        status: 'ready',
        html: 'x'.repeat(BROWSER_PREVIEW_WORKER_LIMITS.maxHtmlBytes + 1),
        diagnostics: [],
        metrics: metrics()
      })
    ).toThrow('output limit')
  })
})
