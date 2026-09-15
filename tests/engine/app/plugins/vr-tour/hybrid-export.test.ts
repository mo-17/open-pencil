import { afterAll, beforeAll, describe, expect, spyOn, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { unzipSync } from 'fflate'

import { compile, type CompilerInput } from '@open-pencil/compiler'
import { createEditor } from '@open-pencil/core/editor'
import {
  createLocalizedVRTourConfig,
  createVRTourModuleFrameOverrides,
  VR_TOUR_SAMPLE_ASSETS
} from '@open-pencil/core/plugins'

import { exportCurrentDocumentAsExpoReactNativeSource } from '@/app/plugins/host/expo-react-native-exporter'
import { exportCurrentDocumentAsFlutterSource } from '@/app/plugins/host/flutter-exporter'
import {
  createMiniProgramSourceCompilerWorkerRequest,
  MINIPROGRAM_SOURCE_COMPILER_WORKER_PROTOCOL_VERSION,
  parseMiniProgramSourceCompilerWorkerResponse,
  restoreMiniProgramCompilerGraph,
  validateMiniProgramSourceCompilerWorkerRequest
} from '@/app/plugins/host/miniprogram/compiler/protocol'
import { exportCurrentDocumentAsTaroSource } from '@/app/plugins/host/miniprogram/source-exporter'
import type {
  SourceExporterEditor,
  SourceProjectExporterDependencies
} from '@/app/plugins/host/source-exporter-runtime'
import {
  assertVueSourceArchiveWorkerOutput,
  createVueSourceArchiveWorkerRequest,
  validateVueSourceArchiveWorkerRequest
} from '@/app/plugins/host/vue/archive/protocol'
import { applyVRTourSamples } from '@/app/plugins/vr-tour/samples'

const REQUEST_ID = 'vr-sample-export-20260915'
const NODE = Bun.which('node')
let archiveDirectory = ''
let archiveSerial = 0
const SAMPLES = VR_TOUR_SAMPLE_ASSETS.map((asset) => ({
  asset,
  bytes: new Uint8Array(readFileSync(join('packages/demos/vr-tour', asset.fileName)))
}))
const EXPORTERS = [
  { target: 'expo', exportProject: exportCurrentDocumentAsExpoReactNativeSource },
  { target: 'flutter', exportProject: exportCurrentDocumentAsFlutterSource },
  { target: 'taro', exportProject: exportCurrentDocumentAsTaroSource }
] as const

beforeAll(async () => {
  if (!NODE) throw new Error('Node.js is required for real fflate archive verification')
  archiveDirectory = mkdtempSync(join(tmpdir(), 'openpencil-hybrid-source-archive-'))
  // Bun 1.3.10's worker_threads compatibility breaks fflate's async large-file
  // handoff. Execute the unchanged app archiver with real Node worker_threads.
  const built = await Bun.build({
    entrypoints: [join(process.cwd(), 'src/app/plugins/host/project-archive.ts')],
    target: 'node',
    format: 'cjs',
    outdir: archiveDirectory,
    naming: 'archive.cjs'
  })
  if (!built.success) throw new Error(built.logs.map(String).join('\n'))
  writeFileSync(
    join(archiveDirectory, 'run.cjs'),
    `
const { readFileSync, writeFileSync } = require('node:fs');
const { archiveProjectFiles } = require('./archive.cjs');
const entries = JSON.parse(readFileSync(process.argv[2], 'utf8')).map(([path, text, content]) =>
  [path, text ? content : new Uint8Array(Buffer.from(content, 'base64'))]);
archiveProjectFiles(new Map(entries)).then(
  (bytes) => writeFileSync(process.argv[3], bytes),
  (error) => { console.error(error); process.exitCode = 1; });
`
  )
})

afterAll(() => {
  if (archiveDirectory) rmSync(archiveDirectory, { recursive: true, force: true })
})

async function archiveUsingAppFunction(files: ReadonlyMap<string, string | Uint8Array>) {
  if (!NODE) throw new Error('Node.js is required for real archive verification')
  const serial = ++archiveSerial
  const inputPath = join(archiveDirectory, `input-${serial}.json`)
  const outputPath = join(archiveDirectory, `output-${serial}.zip`)
  writeFileSync(
    inputPath,
    JSON.stringify(
      [...files].map(([path, value]) => [
        path,
        typeof value === 'string',
        typeof value === 'string' ? value : Buffer.from(value).toString('base64')
      ])
    )
  )
  const compression = Bun.spawn({
    cmd: [NODE, join(archiveDirectory, 'run.cjs'), inputPath, outputPath],
    stdout: 'pipe',
    stderr: 'pipe'
  })
  const exitCode = await compression.exited
  const diagnostics = await new Response(compression.stderr).text()
  if (exitCode !== 0) throw new Error(`Node app archive failed: ${diagnostics}`)
  return new Uint8Array(readFileSync(outputPath))
}

interface HybridManifest {
  target: string
  tours: Array<{ key: string }>
  assets: Array<{ url: string; byteLength: number; sha256: string; chunks: string[] }>
}

function savedSampleDocument() {
  const editor = createEditor()
  const node = editor.graph.createNode(
    'FRAME',
    editor.state.currentPageId,
    createVRTourModuleFrameOverrides(createLocalizedVRTourConfig('zh-CN'))
  )
  applyVRTourSamples(editor, node.id, 'zh-CN', SAMPLES)
  return { graph: editor.graph, state: { documentName: 'VR saved 8K samples' } }
}

function compileAcrossMiniProgramProtocol(input: CompilerInput) {
  // Exercise the actual snapshot/response validators without claiming that a
  // browser Worker or structured-clone transport was started by this unit test.
  const request = structuredClone(createMiniProgramSourceCompilerWorkerRequest(input, REQUEST_ID))
  validateMiniProgramSourceCompilerWorkerRequest(request)
  const output = compile({
    graph: restoreMiniProgramCompilerGraph(request.graph),
    pageIds: request.pageIds,
    options: request.options
  })
  const response = parseMiniProgramSourceCompilerWorkerResponse(
    structuredClone({
      version: MINIPROGRAM_SOURCE_COMPILER_WORKER_PROTOCOL_VERSION,
      type: 'result',
      requestId: REQUEST_ID,
      output
    }),
    REQUEST_ID,
    request.options.target
  )
  if (response?.type !== 'result') throw new Error('Mini-program compiler response was rejected')
  return response.output
}

function bytesOf(value: string | Uint8Array): Uint8Array {
  return typeof value === 'string' ? new TextEncoder().encode(value) : value
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

describe('saved 8K VR samples through mobile app source exporters', () => {
  for (const { target, exportProject } of EXPORTERS) {
    test(`${target} preserves every sidecar file and both pinned originals in a real ZIP`, async () => {
      const capture: { zip?: Uint8Array; files?: ReadonlyMap<string, string | Uint8Array> } = {}
      // Capture the destination bytes: browser download dialogs, desktop file
      // pickers and native atomic writes are outside this host-boundary test.
      const dependencies: SourceProjectExporterDependencies<SourceExporterEditor> = {
        async chooseDestination() {
          return {
            async write(bytes) {
              capture.zip = bytes
            }
          }
        },
        async resolveFontManifest() {
          return { faces: [] }
        },
        compile(input) {
          expect(input.options.target).toBe(target)
          return target === 'taro' ? compileAcrossMiniProgramProtocol(input) : compile(input)
        },
        async archive(files) {
          capture.files = files
          const request = structuredClone(createVueSourceArchiveWorkerRequest(files, REQUEST_ID))
          validateVueSourceArchiveWorkerRequest(request)
          const zip = await archiveUsingAppFunction(request.files)
          assertVueSourceArchiveWorkerOutput(zip)
          return zip
        }
      }
      const fetch = spyOn(globalThis, 'fetch').mockImplementation(() => {
        throw new Error('Saved sample source export must not use the network')
      })
      try {
        const result = await exportProject(savedSampleDocument(), dependencies)
        const { zip, files } = capture
        if (!zip || !files) throw new Error('Expected the app exporter to produce a ZIP')
        const entries = unzipSync(zip)
        const manifest = JSON.parse(
          new TextDecoder().decode(entries['vr-tour-web/manifest.json'])
        ) as HybridManifest

        expect(result.saved).toBe(true)
        expect(result.fileCount).toBe(files.size)
        expect(Object.keys(entries).sort()).toEqual([...files.keys()].sort())
        for (const [path, value] of files) {
          expect(sha256(entries[path])).toBe(sha256(bytesOf(value)))
        }
        expect(manifest.target).toBe(target)
        expect(manifest.assets).toHaveLength(2)
        expect(entries['vr-tour-web/build.mjs']).toBeDefined()
        expect(entries['vr-tour-web/package.json']).toBeDefined()
        expect(entries['vr-tour-web/SOURCES.json']).toBeDefined()
        expect(entries['EXPORT_WARNINGS.md'] !== undefined).toBe(result.warnings.length > 0)
        expect(Object.keys(entries).some((path) => path.includes('node_modules/'))).toBe(false)
        for (const { asset, bytes } of SAMPLES) {
          expect(asset.width).toBe(8192)
          expect(asset.height).toBe(4096)
          expect(sha256(bytes)).toBe(asset.sha256)
          const packaged = manifest.assets.find((entry) => entry.url === asset.panoramaUrl)
          if (!packaged) throw new Error(`Missing packaged sample ${asset.id}`)
          const chunks = packaged.chunks.map((path) => entries['vr-tour-web/' + path])
          for (const chunk of chunks) {
            expect(chunk.byteLength).toBeGreaterThan(0)
            expect(chunk.byteLength).toBeLessThanOrEqual(1024 * 1024)
          }
          const restored = Buffer.concat(chunks)
          expect(restored.byteLength).toBe(asset.byteLength)
          expect(packaged.byteLength).toBe(asset.byteLength)
          expect(packaged.sha256).toBe(asset.sha256)
          expect(sha256(restored)).toBe(asset.sha256)
        }
        if (target === 'flutter') {
          const pubspec = new TextDecoder().decode(entries['pubspec.yaml'])
          for (const tour of manifest.tours) {
            const path = `assets/vr-tour/${tour.key}.html`
            expect(new TextDecoder().decode(entries[path])).toContain('node vr-tour-web/build.mjs')
            expect(pubspec).toContain(JSON.stringify(path))
          }
        }
        expect(fetch).not.toHaveBeenCalled()
        const outputDirectory = process.env.OPENPENCIL_HYBRID_ARCHIVE_VERIFY_DIR
        if (outputDirectory) {
          mkdirSync(outputDirectory, { recursive: true })
          writeFileSync(join(outputDirectory, `${target}.zip`), zip)
          writeFileSync(
            join(outputDirectory, `${target}.json`),
            JSON.stringify(
              {
                target,
                fileCount: files.size,
                zipBytes: zip.byteLength,
                sourceBytes: [...files.values()].reduce(
                  (total, value) => total + bytesOf(value).byteLength,
                  0
                ),
                sampleBytes: SAMPLES.reduce((total, sample) => total + sample.bytes.byteLength, 0),
                archiveWorkerProtocolValidated: true,
                realBrowserWorker: false,
                realDesktopDialog: false,
                compilerWorkerProtocolValidated: target === 'taro',
                manifest
              },
              null,
              2
            ) + '\n'
          )
        }
      } finally {
        fetch.mockRestore()
      }
    }, 30_000)
  }
})
