import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { unzipSync } from 'fflate'

import { compile, type CompilerFontManifest } from '@open-pencil/compiler'
import { SceneGraph } from '@open-pencil/scene-graph'

import {
  applyExpoRedistributionFontPolicy,
  buildExpoReactNativeExportFiles,
  exportCurrentDocumentAsExpoReactNativeSource,
  type ExpoReactNativeExportEditor,
  type ExpoReactNativeExporterDependencies
} from '@/app/plugins/host/expo-react-native-exporter'
import { archiveProjectFiles, validateProjectArchivePath } from '@/app/plugins/host/project-archive'
import {
  safeSourceProjectPackageName,
  safeSourceProjectProductName
} from '@/app/plugins/host/source-project'
import { buildTauriReactProjectFiles } from '@/app/plugins/host/tauri-react-exporter'

const decoder = new TextDecoder()

function expoExportEditor(documentName = 'Mobile Demo'): ExpoReactNativeExportEditor {
  return {
    state: { documentName },
    graph: new SceneGraph()
  }
}

interface GeneratedPackageJson {
  name: string
  private: boolean
  description: string
  scripts: Record<string, string>
  dependencies: Record<string, string>
  devDependencies: Record<string, string>
  customMetadata: { preserved: boolean }
}

interface DesktopCapabilityConfig {
  permissions: unknown[]
}

function text(files: Record<string, Uint8Array>, path: string): string {
  const value = files[path]
  if (!value) throw new Error(`Missing archive file: ${path}`)
  return decoder.decode(value)
}

describe('plugin project archive', () => {
  test('grants the desktop rename permission required by atomic Expo ZIP saves', () => {
    const capability = JSON.parse(
      readFileSync(
        resolve(import.meta.dir, '../../../../desktop/capabilities/default.json'),
        'utf8'
      )
    ) as DesktopCapabilityConfig

    expect(capability.permissions).toContainEqual({
      identifier: 'fs:allow-rename',
      allow: [{ path: '**' }]
    })
  })

  test('preserves nested text and binary files', async () => {
    const binary = new Uint8Array([0, 1, 2, 127, 128, 254, 255])
    const archive = await archiveProjectFiles(
      new Map<string, string | Uint8Array>([
        ['package.json', '{"name":"demo"}\n'],
        ['src/pages/Home.tsx', 'export default function Home() {}\n'],
        ['public/assets/logo.bin', binary]
      ])
    )
    const files = unzipSync(archive)

    expect(Object.keys(files).sort()).toEqual([
      'package.json',
      'public/assets/logo.bin',
      'src/pages/Home.tsx'
    ])
    expect(text(files, 'package.json')).toBe('{"name":"demo"}\n')
    expect(text(files, 'src/pages/Home.tsx')).toBe('export default function Home() {}\n')
    expect(files['public/assets/logo.bin']).toEqual(binary)
  })

  test('rejects traversal, absolute, backslash, and prototype-pollution path segments', () => {
    for (const path of [
      '../secret.txt',
      'src/../secret.txt',
      '/absolute/path.txt',
      'src\\windows-path.ts',
      '__proto__/payload.js',
      'src/constructor/payload.js',
      'src/PROTOTYPE/payload.js',
      'CON/readme.txt',
      'src/aux.txt',
      'src/bad?.txt',
      'src/trailing-dot.',
      'src/trailing-space ',
      'src/control\u0085name.txt',
      'src/hidden\u202Egpj.exe',
      `src/${'a'.repeat(256)}.txt`,
      `src/${'界'.repeat(86)}.txt`
    ]) {
      expect(() => validateProjectArchivePath(path)).toThrow('Unsafe project archive path')
    }
  })

  test('rejects unsafe archive entries before producing an archive', async () => {
    await expect(
      archiveProjectFiles(new Map([['safe/../../escape.txt', 'blocked']]))
    ).rejects.toThrow('Unsafe project archive path')
  })

  test('emits byte-identical archives for the same files regardless of insertion order', async () => {
    const first = new Map<string, string | Uint8Array>([
      ['z-last.txt', 'last'],
      ['a-first.txt', 'first'],
      ['nested/data.bin', new Uint8Array([9, 8, 7])]
    ])
    const second = new Map<string, string | Uint8Array>([...first.entries()].reverse())

    expect(await archiveProjectFiles(first)).toEqual(await archiveProjectFiles(second))
  })

  test('rejects file paths that collide on case-insensitive filesystems', async () => {
    await expect(
      archiveProjectFiles(
        new Map([
          ['src/pages/Foo.tsx', 'first'],
          ['src/pages/foo.tsx', 'second']
        ])
      )
    ).rejects.toThrow('case-insensitive filesystems')
  })

  test('rejects an aborted archive before producing bytes', async () => {
    const controller = new AbortController()
    controller.abort()

    await expect(
      archiveProjectFiles(new Map([['package.json', '{}\n']]), controller.signal)
    ).rejects.toMatchObject({ name: 'AbortError' })
  })
})

describe('Tauri React project builder', () => {
  test('preserves compiled files, merges package.json, and adds a safe Tauri 2 scaffold', () => {
    const sourcePackage = {
      name: 'compiled-app',
      private: true,
      scripts: { dev: 'vite', build: 'vite build', inspect: 'custom-inspect' },
      dependencies: { react: '^19.0.0', 'existing-runtime': '1.2.3' },
      devDependencies: { vite: '^7.0.0', 'existing-tool': '4.5.6' },
      customMetadata: { preserved: true }
    }
    const binary = new Uint8Array([222, 173, 190, 239])
    const files = buildTauriReactProjectFiles(
      new Map<string, string | Uint8Array>([
        ['package.json', `${JSON.stringify(sourcePackage)}\n`],
        ['src/main.tsx', 'export const boot = true\n'],
        ['public/icon.bin', binary]
      ]),
      'demo-desktop-app',
      'Demo Desktop App'
    )

    expect(files.get('src/main.tsx')).toBe('export const boot = true\n')
    expect(files.get('public/icon.bin')).toEqual(binary)

    const packageJson: GeneratedPackageJson = JSON.parse(String(files.get('package.json')))
    expect(packageJson).toMatchObject({
      name: 'compiled-app',
      private: true,
      description: 'Tauri desktop project exported from Demo Desktop App in OpenPencil',
      scripts: {
        dev: 'vite',
        build: 'vite build',
        inspect: 'custom-inspect',
        tauri: 'tauri'
      },
      dependencies: {
        react: '^19.0.0',
        'existing-runtime': '1.2.3',
        '@tauri-apps/api': '^2.0.0'
      },
      devDependencies: {
        vite: '^7.0.0',
        'existing-tool': '4.5.6',
        '@tauri-apps/cli': '^2.0.0'
      },
      customMetadata: { preserved: true }
    })

    expect([...files.keys()].sort()).toEqual(
      expect.arrayContaining([
        'README.md',
        'src-tauri/.gitignore',
        'src-tauri/Cargo.toml',
        'src-tauri/build.rs',
        'src-tauri/src/lib.rs',
        'src-tauri/src/main.rs',
        'src-tauri/tauri.conf.json'
      ])
    )
    for (const path of files.keys()) expect(() => validateProjectArchivePath(path)).not.toThrow()

    expect(String(files.get('src-tauri/Cargo.toml'))).toContain('name = "demo_desktop_app"')
    expect(String(files.get('src-tauri/src/main.rs'))).toContain('demo_desktop_app_lib::run();')
    expect(String(files.get('src-tauri/src/lib.rs'))).toContain('tauri::Builder::default()')
    const tauriConfig = JSON.parse(String(files.get('src-tauri/tauri.conf.json'))) as {
      identifier: string
      productName: string
      build: Record<string, unknown>
    }
    expect(tauriConfig).toMatchObject({
      productName: 'Demo Desktop App',
      identifier: 'dev.openpencil.demo-desktop-app',
      build: {
        beforeDevCommand: 'npm run dev',
        beforeBuildCommand: 'npm run build',
        frontendDist: '../dist'
      }
    })
  })

  test('requires compiler output to include a text package.json', () => {
    expect(() =>
      buildTauriReactProjectFiles(new Map([['src/main.tsx', 'export {}']]), 'demo', 'Demo')
    ).toThrow('missing a text package.json')
    expect(() =>
      buildTauriReactProjectFiles(
        new Map([['package.json', new Uint8Array([123, 125])]]),
        'demo',
        'Demo'
      )
    ).toThrow('missing a text package.json')
  })
})

describe('source project names', () => {
  test('normalizes package names and preserves safe display names', () => {
    expect(safeSourceProjectPackageName('惊悚 乐园')).toMatch(/^openpencil-app-[a-z0-9]+$/)
    expect(safeSourceProjectPackageName('惊悚 乐园')).toBe(
      safeSourceProjectPackageName('惊悚 乐园')
    )
    expect(safeSourceProjectPackageName('惊悚 乐园')).not.toBe(
      safeSourceProjectPackageName('另一个项目')
    )
    expect(safeSourceProjectPackageName(' Demo / Mobile App ')).toBe('demo-mobile-app')
    expect(safeSourceProjectProductName('  惊悚乐园  ')).toBe('惊悚乐园')
  })

  test('uses stable fallbacks for empty and control-only names', () => {
    expect(safeSourceProjectPackageName('---')).toBe('openpencil-app')
    expect(safeSourceProjectProductName('\u0000\u001f\u0085')).toBe('OpenPencil App')
  })

  test('does not split a Unicode code point at the display-name limit', () => {
    const name = `${'A'.repeat(127)}😀tail`
    expect(safeSourceProjectProductName(name)).toBe(`${'A'.repeat(127)}😀`)
  })

  test('disambiguates mixed Unicode package names and strips format controls', () => {
    expect(safeSourceProjectPackageName('惊悚 v2')).not.toBe(safeSourceProjectPackageName('v2'))
    expect(safeSourceProjectPackageName('node_modules')).toBe('openpencil-node_modules')
    expect(safeSourceProjectProductName('Safe\u202Egpj.exe')).toBe('Safegpj.exe')
    expect(safeSourceProjectProductName('Safe\u0085Product')).toBe('SafeProduct')
  })

  test('disambiguates truncated ASCII package names', () => {
    const first = safeSourceProjectPackageName(`${'a'.repeat(150)}-first`)
    const second = safeSourceProjectPackageName(`${'a'.repeat(150)}-second`)
    expect(first).toHaveLength(128)
    expect(second).toHaveLength(128)
    expect(first).not.toBe(second)
  })
})

describe('Expo React Native project export', () => {
  test('adds a reviewable warning report without mutating compiler output', () => {
    const compiled = new Map<string, string | Uint8Array>([['package.json', '{}\n']])
    const project = buildExpoReactNativeExportFiles(compiled, [
      {
        code: 'expo-module-unsupported',
        message: 'Rich Text\nrequires a native adapter.',
        nodeId: 'node-1'
      }
    ])

    expect(compiled.has('EXPORT_WARNINGS.md')).toBe(false)
    expect(project.get('EXPORT_WARNINGS.md')).toBe(
      '# OpenPencil Expo export warnings\n\n' +
        'The project was generated, but the following authored features require review or a native adapter. OpenPencil did not silently treat them as supported.\n\n' +
        '1. `expo-module-unsupported` (node `node-1`): Rich Text requires a native adapter.\n'
    )
  })

  test('does not add a report to warning-free exports', () => {
    const project = buildExpoReactNativeExportFiles(new Map([['package.json', '{}\n']]), [])
    expect(project.has('EXPORT_WARNINGS.md')).toBe(false)
  })

  test('omits fonts until complete redistribution notices can accompany their bytes', () => {
    const manifest: CompilerFontManifest = {
      faces: [
        {
          family: 'Open Font',
          weight: 400,
          style: 'normal',
          format: 'truetype',
          path: 'src/assets/fonts/open.ttf',
          content: new Uint8Array([1]),
          licenseEvidence: { kind: 'verified_open', licenseIds: ['OFL-1.1'] }
        },
        {
          family: 'Policy Only',
          weight: 400,
          style: 'normal',
          format: 'woff2',
          path: 'src/assets/fonts/policy.woff2',
          content: new Uint8Array([2]),
          licenseEvidence: {
            kind: 'provider_policy',
            policyUrl: 'https://example.test/policy',
            policyCheckedAt: '2026-08-06T00:00:00.000Z'
          }
        },
        {
          family: 'Restricted Font',
          weight: 400,
          style: 'normal',
          format: 'opentype',
          path: 'src/assets/fonts/restricted.otf',
          content: new Uint8Array([3]),
          licenseEvidence: { kind: 'restricted', restriction: 'embedding', fsType: 2 }
        }
      ]
    }

    const filtered = applyExpoRedistributionFontPolicy(manifest)
    expect(filtered.manifest.faces).toEqual([])
    expect(filtered.warnings.map((warning) => warning.code)).toEqual([
      'font-license-notice-unavailable',
      'expo-font-license-unverified',
      'font-license-embedding-restricted'
    ])
    expect(filtered.warnings[0]?.message).toContain(
      'Open Font" (src/assets/fonts/open.ttf; SPDX: OFL-1.1)'
    )
    expect(filtered.warnings[0]?.message).toContain(
      'font-specific copyright, license text, or NOTICE'
    )
  })

  test('chooses the save destination before resolving fonts or compiling', async () => {
    const calls: string[] = []
    const editor = expoExportEditor()
    const dependencies: ExpoReactNativeExporterDependencies = {
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
        calls.push(`compile:${input.options.target}`)
        return {
          files: new Map([['package.json', '{}\n']]),
          warnings: [{ code: 'expo-static-warning', message: 'Review this feature.' }]
        }
      },
      async archive(files) {
        calls.push(`archive:${files.has('EXPORT_WARNINGS.md')}`)
        return new Uint8Array([1, 2, 3])
      }
    }

    await expect(
      exportCurrentDocumentAsExpoReactNativeSource(editor, dependencies)
    ).resolves.toMatchObject({
      fileName: 'mobile-demo-expo.zip',
      fileCount: 2,
      saved: true,
      warnings: [{ code: 'expo-static-warning' }]
    })
    expect(calls).toEqual([
      'choose:mobile-demo-expo.zip',
      'fonts',
      'compile:expo',
      'archive:true',
      'write:3'
    ])
  })

  test('stops before expensive work when the destination picker is cancelled', async () => {
    const calls: string[] = []
    const editor = expoExportEditor()
    const dependencies: ExpoReactNativeExporterDependencies = {
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
      exportCurrentDocumentAsExpoReactNativeSource(editor, dependencies)
    ).resolves.toEqual({
      fileName: 'mobile-demo-expo.zip',
      fileCount: 0,
      warnings: [],
      saved: false
    })
    expect(calls).toEqual(['choose'])
  })

  test('does not resolve fonts or write when cancellation arrives while choosing a destination', async () => {
    const calls: string[] = []
    const controller = new AbortController()
    const dependencies: ExpoReactNativeExporterDependencies = {
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
        return { files: new Map([['package.json', '{}\n']]), warnings: [] }
      },
      async archive() {
        calls.push('archive')
        return new Uint8Array([1])
      }
    }

    await expect(
      exportCurrentDocumentAsExpoReactNativeSource(
        expoExportEditor(),
        dependencies,
        controller.signal
      )
    ).rejects.toMatchObject({ name: 'AbortError' })
    expect(calls).toEqual(['choose:true'])
  })

  test('produces a real native Expo project ZIP through the trusted export flow', async () => {
    const editor = expoExportEditor('移动演示')
    const page = editor.graph.getPages()[0]
    editor.graph.createNode('TEXT', page.id, { text: 'Hello mobile', fontSize: 22 })
    let written: Uint8Array | undefined
    const dependencies: ExpoReactNativeExporterDependencies = {
      async chooseDestination() {
        return {
          async write(data) {
            written = data
          }
        }
      },
      async resolveFontManifest() {
        return { faces: [] }
      },
      compile,
      archive: archiveProjectFiles
    }

    const result = await exportCurrentDocumentAsExpoReactNativeSource(editor, dependencies)
    if (!written) throw new Error('Expected the Expo project archive to be written')
    const files = unzipSync(written)
    const packageJson = JSON.parse(text(files, 'package.json')) as {
      dependencies: Record<string, string>
    }
    const pageSource = text(files, 'src/pages/index.tsx')

    expect(result.saved).toBe(true)
    expect(result.fileName).toMatch(/^openpencil-app-[a-z0-9]+-expo\.zip$/)
    expect(packageJson.dependencies.expo).toBe('~57.0.10')
    expect(pageSource).toContain("from 'react-native'")
    expect(pageSource).toContain('Hello mobile')
    expect(files['index.html']).toBeUndefined()
    expect(files['EXPORT_WARNINGS.md']).toBeDefined()
  })
})
