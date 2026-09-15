import { describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { compile, withDefaults } from '@open-pencil/compiler'
import { buildPreviewProject } from '@open-pencil/compiler/build'
import { collectTree } from '@open-pencil/compiler/ir/collect/tree'
import type { IRElement } from '@open-pencil/compiler/ir/types'

import { firstPageId, makeSceneGraph } from '#tests/helpers/scene'

const VIDEO_CONFIG = {
  src: 'https://media.example.com/open-pencil/demo.mp4',
  poster: 'https://media.example.com/open-pencil/poster.webp',
  controls: true,
  autoplay: true,
  muted: true,
  loop: true,
  fit: 'cover' as const
}

function videoFrameOverrides(config: Record<string, unknown>) {
  return {
    width: 560,
    height: 320,
    interactiveProps: {
      module: {
        version: 1 as const,
        pluginId: 'open-pencil.video',
        moduleType: 'video',
        configVersion: 1,
        config
      }
    }
  }
}

describe('compiler trusted video module adapter', () => {
  test('lowers verified HTTPS media and emits the reviewed native video and HLS runtime', () => {
    const graph = makeSceneGraph()
    const pageId = firstPageId(graph)
    const frame = graph.createNode('FRAME', pageId, videoFrameOverrides(VIDEO_CONFIG))
    graph.createNode('TEXT', frame.id, { text: 'Video overlay' })

    const ir = collectTree(graph, pageId)
    const element = ir.children[0] as IRElement
    expect(element.module).toEqual({
      pluginId: 'open-pencil.video',
      moduleType: 'video',
      configVersion: 1,
      payload: VIDEO_CONFIG
    })

    const out = compile({
      graph,
      pageIds: [pageId],
      options: withDefaults({ packageName: 'video-module-demo', devMode: false })
    })
    const app = out.files.get('src/App.tsx') as string
    const runtime = out.files.get('src/__openpencil_video.tsx') as string
    const pkg = JSON.parse(out.files.get('package.json') as string) as {
      dependencies: Record<string, string>
    }

    expect(app).toContain("import OpenPencilVideo from './__openpencil_video'")
    expect(app).toContain('<OpenPencilVideo config={{')
    expect(app).toContain('Video overlay')
    expect(app).toContain('</OpenPencilVideo>')
    expect(runtime).toContain("document.createElement('video')")
    expect(runtime).toContain('video.autoplay = !dynamic && config.autoplay && config.muted')
    expect(runtime).toContain('video.controls = config.controls')
    expect(runtime).toContain('video.muted = config.muted')
    expect(runtime).toContain('video.loop = config.loop')
    expect(runtime).toContain('video.playsInline = true')
    expect(runtime).toContain('preview: false')
    expect(runtime).toContain('useLayoutEffect')
    expect(runtime).toContain('hls?.destroy()')
    expect(runtime).toContain('objectFit: config.fit')
    expect(runtime).not.toContain('dangerouslySetInnerHTML')
    expect(runtime).not.toContain('<iframe')
    expect(runtime).not.toContain('WebView')
    expect(runtime).not.toContain('Load video preview')
    expect(runtime).toContain("redirect: 'error'")
    expect(pkg.dependencies['hls.js']).toBe('1.7.3')
    expect(pkg.dependencies['video.js']).toBeUndefined()
    expect(pkg.dependencies['react-player']).toBeUndefined()
    expect(out.warnings).toEqual([])
  })

  test('gates preview media URLs behind explicit user activation', () => {
    const graph = makeSceneGraph()
    const pageId = firstPageId(graph)
    graph.createNode('FRAME', pageId, videoFrameOverrides(VIDEO_CONFIG))

    const out = compile({
      graph,
      pageIds: [pageId],
      options: withDefaults({ packageName: 'video-module-preview-gate', devMode: true })
    })
    const runtime = out.files.get('src/__openpencil_video.tsx') as string

    expect(runtime).toContain('preview: true')
    expect(runtime).toContain('else if (!inputs.preview && !dynamic) load()')
    expect(runtime).toContain("button.addEventListener('click', load)")
    expect(runtime).toContain("video.preload = 'none'")
    expect(runtime).toContain('inputs.srcBound ? inputs.src : config.src')
    expect(runtime).toContain('inputs.posterBound ? inputs.poster : config.poster')
    expect(out.warnings).toEqual([])
  })

  test('keeps authored fallback content for non-HTTPS media URLs', () => {
    for (const config of [
      { ...VIDEO_CONFIG, src: 'http://media.example.com/demo.mp4' },
      { ...VIDEO_CONFIG, poster: 'http://media.example.com/poster.webp' }
    ]) {
      const graph = makeSceneGraph()
      const pageId = firstPageId(graph)
      const frame = graph.createNode('FRAME', pageId, videoFrameOverrides(config))
      graph.createNode('TEXT', frame.id, { text: 'Video unavailable' })

      const ir = collectTree(graph, pageId)
      const element = ir.children[0] as IRElement
      expect(element.module).toBeUndefined()
      expect(JSON.stringify(element.children)).toContain('Video unavailable')
      expect(ir.warnings.map((warning) => warning.code)).toContain('video-module-invalid')
    }
  })

  test('bundles the native video runtime into a static preview project', async () => {
    const graph = makeSceneGraph()
    const pageId = firstPageId(graph)
    graph.createNode('FRAME', pageId, videoFrameOverrides(VIDEO_CONFIG))
    const out = compile({
      graph,
      pageIds: [pageId],
      options: withDefaults({ packageName: 'video-module-static', devMode: false })
    })
    const buildDirectory = mkdtempSync(join(tmpdir(), 'openpencil-video-module-build-'))

    try {
      const built = await buildPreviewProject({ files: out.files, outDir: buildDirectory })
      expect(built.files).toContain('index.html')
      expect(built.files.some((path) => path.endsWith('.js'))).toBe(true)
      expect(out.warnings).toEqual([])
    } finally {
      rmSync(buildDirectory, { recursive: true, force: true })
    }
  }, 15_000)
})
