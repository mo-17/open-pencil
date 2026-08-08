import { describe, expect, test } from 'bun:test'

import { unzipSync } from 'fflate'

import { compile, safeFlutterPackageName, type CompilerFontManifest } from '@open-pencil/compiler'
import { SceneGraph } from '@open-pencil/scene-graph'

import {
  applyFlutterRedistributionFontPolicy,
  buildFlutterExportFiles,
  exportCurrentDocumentAsFlutterSource,
  type FlutterExportEditor,
  type FlutterExporterDependencies
} from '@/app/plugins/host/flutter-exporter'
import { archiveProjectFiles } from '@/app/plugins/host/project-archive'

const decoder = new TextDecoder()

function exportEditor(documentName = 'Flutter Demo'): FlutterExportEditor {
  return { state: { documentName }, graph: new SceneGraph() }
}

function text(files: Record<string, Uint8Array>, path: string): string {
  const value = files[path]
  if (!value) throw new Error(`Missing archive file: ${path}`)
  return decoder.decode(value)
}

describe('Flutter project exporter', () => {
  test('creates bounded Dart package identifiers with stable Unicode disambiguation', () => {
    expect(safeFlutterPackageName(' Demo / Mobile App ')).toBe('demo_mobile_app')
    expect(safeFlutterPackageName('123 App')).toBe('openpencil_123_app')
    expect(safeFlutterPackageName('class')).toBe('openpencil_class')
    expect(safeFlutterPackageName('../../";\nclass')).toBe('openpencil_class')
    expect(safeFlutterPackageName('惊悚 乐园')).toMatch(/^openpencil_flutter_app_[a-z0-9]+$/)
    expect(safeFlutterPackageName('惊悚 乐园')).toBe(safeFlutterPackageName('惊悚 乐园'))
    expect(safeFlutterPackageName('另一个项目')).not.toBe(safeFlutterPackageName('惊悚 乐园'))
    const firstLongName = safeFlutterPackageName(`${'a'.repeat(100)}-first`)
    const secondLongName = safeFlutterPackageName(`${'a'.repeat(100)}-second`)
    expect(firstLongName).toHaveLength(64)
    expect(secondLongName).toHaveLength(64)
    expect(firstLongName).not.toBe(secondLongName)
  })

  test('omits fonts until complete notices are available and reports unsupported formats', () => {
    const manifest: CompilerFontManifest = {
      faces: [
        {
          family: 'Open TTF',
          weight: 400,
          style: 'normal',
          format: 'truetype',
          path: 'assets/fonts/open.ttf',
          content: new Uint8Array([1]),
          licenseEvidence: { kind: 'verified_open', licenseIds: ['OFL-1.1'] }
        },
        {
          family: 'Open WOFF',
          weight: 400,
          style: 'normal',
          format: 'woff',
          path: 'assets/fonts/open.woff',
          content: new Uint8Array([2]),
          licenseEvidence: { kind: 'verified_open', licenseIds: ['OFL-1.1'] }
        },
        {
          family: 'Restricted OTF',
          weight: 400,
          style: 'normal',
          format: 'opentype',
          path: 'assets/fonts/restricted.otf',
          content: new Uint8Array([3]),
          licenseEvidence: { kind: 'restricted', restriction: 'embedding', fsType: 2 }
        },
        {
          family: 'Unknown TTF',
          weight: 400,
          style: 'normal',
          format: 'truetype',
          path: 'assets/fonts/unknown.ttf',
          content: new Uint8Array([4])
        }
      ]
    }

    const filtered = applyFlutterRedistributionFontPolicy(manifest)
    expect(filtered.manifest.faces).toEqual([])
    expect(filtered.warnings.map((warning) => warning.code)).toEqual([
      'font-license-notice-unavailable',
      'font-license-notice-unavailable',
      'font-license-embedding-restricted',
      'flutter-font-license-unverified',
      'flutter-font-format-unsupported'
    ])
    expect(filtered.warnings[0]?.message).toContain(
      'Open TTF" (assets/fonts/open.ttf; SPDX: OFL-1.1)'
    )
  })

  test('adds a Flutter warning report without mutating compiler output', () => {
    const compiled = new Map<string, string | Uint8Array>([['pubspec.yaml', 'name: demo\n']])
    const project = buildFlutterExportFiles(compiled, [
      {
        code: 'flutter-module-unsupported',
        message: 'Rich Text\nrequires a native adapter.',
        nodeId: 'node-1'
      }
    ])

    expect(compiled.has('EXPORT_WARNINGS.md')).toBe(false)
    expect(project.get('EXPORT_WARNINGS.md')).toBe(
      '# OpenPencil Flutter export warnings\n\n' +
        'The project was generated, but the following authored features require review or a native adapter. OpenPencil did not silently treat them as supported.\n\n' +
        '1. `flutter-module-unsupported` (node `node-1`): Rich Text requires a native adapter.\n'
    )
  })

  test('chooses the destination before fonts and compiles with the explicit Flutter target', async () => {
    const calls: string[] = []
    const editor = exportEditor('移动 Flutter 应用')
    editor.graph.addPage('Details')
    const dependencies: FlutterExporterDependencies = {
      async chooseDestination(fileName) {
        calls.push(`choose:${fileName}`)
        return {
          async write(data) {
            calls.push(`write:${data.byteLength}`)
          }
        }
      },
      async resolveFontManifest() {
        calls.push('fonts')
        return { faces: [] }
      },
      compile(input) {
        calls.push(
          `compile:${input.options.target}:${input.options.router}:${input.options.packageName}`
        )
        return {
          files: new Map([['pubspec.yaml', 'name: mobile_flutter_app\n']]),
          warnings: [{ code: 'flutter-static-warning', message: 'Review this feature.' }]
        }
      },
      async archive(files) {
        calls.push(`archive:${files.has('EXPORT_WARNINGS.md')}`)
        return new Uint8Array([1, 2, 3])
      }
    }

    const result = await exportCurrentDocumentAsFlutterSource(editor, dependencies)
    expect(result).toMatchObject({ fileCount: 2, saved: true })
    expect(result.fileName).toMatch(/^[a-z0-9-]+-flutter\.zip$/)
    expect(calls).toEqual([
      `choose:${result.fileName}`,
      'fonts',
      `compile:flutter:flutter-router:${safeFlutterPackageName('移动 Flutter 应用')}`,
      'archive:true',
      'write:3'
    ])
  })

  test('stops before expensive work when the destination picker is cancelled', async () => {
    const calls: string[] = []
    const dependencies: FlutterExporterDependencies = {
      async chooseDestination() {
        calls.push('choose')
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

    await expect(
      exportCurrentDocumentAsFlutterSource(exportEditor(), dependencies)
    ).resolves.toEqual({
      fileName: 'flutter-demo-flutter.zip',
      fileCount: 0,
      warnings: [],
      saved: false
    })
    expect(calls).toEqual(['choose'])
  })

  test('does not write when cancellation arrives after archiving', async () => {
    const calls: string[] = []
    const controller = new AbortController()
    const dependencies: FlutterExporterDependencies = {
      async chooseDestination() {
        calls.push('choose')
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
        return { files: new Map([['pubspec.yaml', 'name: flutter_demo\n']]), warnings: [] }
      },
      async archive() {
        calls.push('archive')
        controller.abort()
        return new Uint8Array([1])
      }
    }

    await expect(
      exportCurrentDocumentAsFlutterSource(exportEditor(), dependencies, controller.signal)
    ).rejects.toMatchObject({ name: 'AbortError' })
    expect(calls).toEqual(['choose', 'fonts', 'compile', 'archive'])
  })

  test('fails when the compiler emits no Flutter project files', async () => {
    const calls: string[] = []
    const dependencies: FlutterExporterDependencies = {
      async chooseDestination() {
        return {
          async write() {
            calls.push('write')
          }
        }
      },
      async resolveFontManifest() {
        return { faces: [] }
      },
      compile() {
        return {
          files: new Map(),
          warnings: [{ code: 'target-not-implemented', message: 'Flutter unavailable.' }]
        }
      },
      async archive() {
        calls.push('archive')
        return new Uint8Array()
      }
    }

    await expect(
      exportCurrentDocumentAsFlutterSource(exportEditor(), dependencies)
    ).rejects.toThrow('target-not-implemented')
    expect(calls).toEqual([])
  })

  test('propagates archive and destination failures without reporting a saved export', async () => {
    const base = {
      async resolveFontManifest() {
        return { faces: [] }
      },
      compile() {
        return { files: new Map([['pubspec.yaml', 'name: flutter_demo\n']]), warnings: [] }
      }
    }
    let wroteAfterArchiveFailure = false
    await expect(
      exportCurrentDocumentAsFlutterSource(exportEditor(), {
        ...base,
        async chooseDestination() {
          return {
            async write() {
              wroteAfterArchiveFailure = true
            }
          }
        },
        async archive() {
          throw new Error('archive failed')
        }
      })
    ).rejects.toThrow('archive failed')
    expect(wroteAfterArchiveFailure).toBe(false)

    await expect(
      exportCurrentDocumentAsFlutterSource(exportEditor(), {
        ...base,
        async chooseDestination() {
          return {
            async write() {
              throw new Error('destination failed')
            }
          }
        },
        async archive() {
          return new Uint8Array([1])
        }
      })
    ).rejects.toThrow('destination failed')
  })

  test('produces a real Flutter source ZIP through the exporter flow', async () => {
    const editor = exportEditor('移动演示')
    const page = editor.graph.getPages()[0]
    editor.graph.createNode('TEXT', page.id, { text: 'Hello Flutter', fontSize: 22 })
    const imageBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2])
    editor.graph.images.set('flutter-hero', imageBytes)
    editor.graph.createNode('RECTANGLE', page.id, {
      name: 'Hero image',
      width: 120,
      height: 80,
      fills: [
        {
          type: 'IMAGE',
          imageHash: 'flutter-hero',
          imageScaleMode: 'FIT',
          color: { r: 0, g: 0, b: 0, a: 1 },
          opacity: 1,
          visible: true
        }
      ]
    })
    let written: Uint8Array | undefined
    const dependencies: FlutterExporterDependencies = {
      async chooseDestination() {
        return {
          async write(data) {
            written = data
          }
        }
      },
      async resolveFontManifest() {
        return {
          faces: [
            {
              family: 'License ID Only',
              weight: 400,
              style: 'normal',
              format: 'truetype',
              path: 'assets/fonts/license-id-only.ttf',
              content: new Uint8Array([9, 8, 7]),
              licenseEvidence: { kind: 'verified_open', licenseIds: ['OFL-1.1'] }
            }
          ]
        }
      },
      compile,
      archive: archiveProjectFiles
    }

    const result = await exportCurrentDocumentAsFlutterSource(editor, dependencies)
    if (!written) throw new Error('Expected the Flutter project archive to be written')
    const files = unzipSync(written)

    expect(result.saved).toBe(true)
    expect(result.fileName).toMatch(/^openpencil-app-[a-z0-9]+-flutter\.zip$/)
    const pubspec = text(files, 'pubspec.yaml')
    const packageName = safeFlutterPackageName('移动演示')
    expect(pubspec).toContain(`name: ${packageName}`)
    expect(text(files, 'README.md')).toContain(
      `flutter create --platforms=android,ios --project-name ${packageName} --no-pub .`
    )
    expect(text(files, 'README.md')).toContain('dart format lib test')
    expect(text(files, 'lib/main.dart')).toContain('runApp')
    expect(
      Object.keys(files).some(
        (path) => path.endsWith('.dart') && text(files, path).includes('Hello Flutter')
      )
    ).toBe(true)
    const image = Object.entries(files).find(
      ([path, bytes]) =>
        /^assets\/images\/[^/]+\.(?:gif|jpe?g|png|webp)$/i.test(path) &&
        bytes.byteLength === imageBytes.byteLength
    )
    expect(image?.[1]).toEqual(imageBytes)
    expect(image?.[0]).toBeDefined()
    expect(pubspec).toContain(image?.[0] ?? 'missing-image-asset')
    expect(Object.keys(files).some((path) => path.startsWith('assets/fonts/'))).toBe(false)
    expect(text(files, 'EXPORT_WARNINGS.md')).toContain('font-license-notice-unavailable')
    expect(text(files, 'EXPORT_WARNINGS.md')).toContain('assets/fonts/license-id-only.ttf')
    expect(files['index.html']).toBeUndefined()
    expect(Object.keys(files).some((path) => /^(?:android|ios)\//.test(path))).toBe(false)
  })
})
