import { afterEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { flutterAdapter } from '#compiler/adapters/flutter'
import { vrTourHybridKey } from '#compiler/adapters/vr-tour/hybrid'
import type { ComponentDef, IRElement, IRModule, IRTree } from '#compiler/ir/types'

import { withDefaults } from '@open-pencil/compiler'
import { createVRTourModuleInstance } from '@open-pencil/core/plugins'

const temporaryDirectories: string[] = []
const options = withDefaults({ target: 'flutter', router: 'none', packageName: 'vr-tour-proof' })

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

function tour(
  overrides: Partial<Omit<IRElement, 'module'>> = {}
): IRElement & { module: IRModule } {
  const instance = createVRTourModuleInstance()
  return {
    kind: 'element',
    sourceId: 'room-tour',
    tag: 'div',
    className: '',
    attrs: {},
    children: [],
    module: {
      pluginId: instance.pluginId,
      moduleType: instance.moduleType,
      configVersion: instance.configVersion,
      payload: { ...structuredClone(instance.config), locale: 'zh-CN' }
    },
    ...overrides
  }
}

function page(children: IRElement[], overrides: Partial<IRTree> = {}): IRTree {
  return {
    pageId: 'page',
    pageName: 'Tour',
    children,
    states: [],
    docStates: [],
    docStateReads: [],
    docStateWrites: [],
    usesRouteParams: false,
    warnings: [],
    ...overrides
  }
}

function textFile(files: ReadonlyMap<string, string | Uint8Array>, path: string): string {
  const value = files.get(path)
  if (typeof value !== 'string') throw new Error(`Missing text file: ${path}`)
  return value
}

function pageSource(files: ReadonlyMap<string, string | Uint8Array>): string {
  const path = [...files.keys()].find((key) => key.startsWith('lib/pages/'))
  if (!path) throw new Error('Missing Flutter page')
  return textFile(files, path)
}

function writeProject(files: ReadonlyMap<string, string | Uint8Array>, directory: string): void {
  for (const [path, bytes] of files) {
    const destination = join(directory, path)
    mkdirSync(dirname(destination), { recursive: true })
    writeFileSync(destination, bytes)
  }
}

describe('Flutter VR WebView source export', () => {
  test('emits local HTML assets and an explicitly prepared pinned WebView project', () => {
    const output = flutterAdapter.emit([page([tour()])], options)
    const htmlPath = `assets/vr-tour/${vrTourHybridKey('room-tour')}.html`
    const dartPage = pageSource(output.files)
    const pubspec = textFile(output.files, 'pubspec.yaml')
    const readme = textFile(output.files, 'README.md')

    expect(pubspec).toContain('webview_flutter: 4.14.1')
    expect(pubspec).toContain('sdk: ">=3.10.0 <4.0.0"')
    expect(pubspec).toContain('flutter: ">=3.38.0"')
    expect(pubspec).toContain(`- ${JSON.stringify(htmlPath)}`)
    expect(dartPage).toContain("import '../openpencil_vr_tour.dart';")
    expect(dartPage).toContain(`OpenPencilVRTourWebView(assetPath: ${JSON.stringify(htmlPath)}`)
    expect(dartPage).toContain('locale: "zh-CN"')
    expect(dartPage).toContain('height: 400')
    expect(textFile(output.files, htmlPath)).toContain('node vr-tour-web/build.mjs')
    expect(output.files.has('vr-tour-web/manifest.json')).toBe(true)
    expect(readme).toContain('npm install --prefix vr-tour-web')
    expect(readme).toContain('android.permission.INTERNET')
    expect(readme).toContain('actual Android/iOS devices')
    expect(output.warnings.map((warning) => warning.code)).toContain('flutter-vr-tour-webview')
    expect(output.warnings.map((warning) => warning.code)).not.toContain(
      'flutter-element-feature-unsupported'
    )

    const directory = process.env.OPENPENCIL_FLUTTER_VR_VERIFY_DIR
    if (directory) writeProject(output.files, directory)
    const dart = process.env.OPENPENCIL_DART_BIN ?? Bun.which('dart')
    if (dart) {
      const syntaxDirectory = mkdtempSync(join(tmpdir(), 'openpencil-flutter-vr-syntax-'))
      temporaryDirectories.push(syntaxDirectory)
      writeProject(output.files, syntaxDirectory)
      const result = Bun.spawnSync({
        cmd: [
          dart,
          'format',
          '--output=none',
          join(syntaxDirectory, 'lib'),
          join(syntaxDirectory, 'test')
        ],
        stdout: 'pipe',
        stderr: 'pipe'
      })
      expect(result.exitCode, result.stdout.toString() + result.stderr.toString()).toBe(0)
    }
  })

  test('emits navigation isolation, stale-result protection and explicit lifecycle cleanup', () => {
    const output = flutterAdapter.emit([page([tour()])], options)
    const runtime = textFile(output.files, 'lib/openpencil_vr_tour.dart')
    const mountTest = textFile(output.files, 'test/widget_test.dart')
    expect(runtime).toContain('controller.loadFlutterAsset(widget.assetPath)')
    expect(runtime).toContain("uri.scheme == 'file'")
    expect(runtime).toContain('!uri.hasQuery && !uri.hasFragment')
    expect(runtime).toContain('value == _documentUrl')
    expect(runtime).toContain('!request.isMainFrame')
    expect(runtime).toContain('return NavigationDecision.prevent')
    expect(runtime).toContain('generation == _generation')
    expect(runtime).toContain('AppLifecycleState.paused')
    expect(runtime).toContain('AppLifecycleState.hidden')
    expect(runtime).toContain('AppLifecycleState.detached')
    expect(runtime).toContain('globalThis.__openpencilDisposeVRTour?.()')
    expect(runtime).toContain('WidgetsBinding.instance.removeObserver(this)')
    expect(runtime).toContain('Factory<EagerGestureRecognizer>')
    expect(runtime).toContain('if (!_supported || !_active) return')
    expect(runtime).toContain('!kIsWeb')
    expect(runtime).not.toContain('JavaScriptChannel')
    expect(mountTest).toContain('debugDefaultTargetPlatformOverride = TargetPlatform.linux')
    expect(mountTest).toContain('debugDefaultTargetPlatformOverride = previous')
  })

  test('blocks panorama bindings without static fallback assets or WebView dependencies', () => {
    const node = tour()
    node.module.panoramaUrlExpr = { kind: 'ident', name: 'unresolvedListing' }
    const output = flutterAdapter.emit([page([node])], options)
    const dartPage = pageSource(output.files)
    expect(dartPage).toContain('动态全景绑定不会回退加载示例')
    expect(dartPage).not.toContain('OpenPencilVRTourWebView')
    expect(output.files.has('lib/openpencil_vr_tour.dart')).toBe(false)
    expect(output.files.has('vr-tour-web/manifest.json')).toBe(false)
    expect(textFile(output.files, 'pubspec.yaml')).not.toContain('webview_flutter')
    expect(output.warnings.map((warning) => warning.code)).toContain(
      'flutter-vr-tour-binding-unsupported'
    )
  })

  test('leaves invalid or unrelated modules blocked and normal Flutter SDK requirements unchanged', () => {
    const invalid = tour()
    invalid.module.payload.initialFov = -99
    const unrelated = tour({ sourceId: 'other-module' })
    unrelated.module.pluginId = 'other.plugin'
    const output = flutterAdapter.emit([page([invalid, unrelated])], options)
    const pubspec = textFile(output.files, 'pubspec.yaml')
    expect(pubspec).toContain('sdk: ">=3.3.0 <4.0.0"')
    expect(pubspec).not.toContain('webview_flutter')
    expect(output.files.has('lib/openpencil_vr_tour.dart')).toBe(false)
    expect(output.warnings.map((warning) => warning.code)).toContain(
      'flutter-vr-tour-config-unavailable'
    )
    expect(output.warnings.some((warning) => warning.message.includes('plugin module'))).toBe(true)
  })

  test('imports the player in emitted component bodies and does not duplicate VR images as raster assets', () => {
    const node = tour()
    const scenes = node.module.payload.scenes as Array<Record<string, unknown>>
    scenes[0].panoramaUrl = '/assets/vr-tour/room.jpg'
    const component: ComponentDef = {
      componentId: 'component',
      name: 'RoomCard',
      props: [],
      children: [node],
      assets: [{ path: 'public/assets/vr-tour/room.jpg', bytes: new Uint8Array([1, 2, 3]) }]
    }
    const output = flutterAdapter.emit([page([])], options, [component])
    const source = textFile(output.files, 'lib/components/room_card.dart')
    expect(source).toContain("import '../openpencil_vr_tour.dart';")
    expect(source).toContain('OpenPencilVRTourWebView')
    expect([...output.files.keys()].some((path) => path.startsWith('vr-tour-web/assets/'))).toBe(
      true
    )
    expect([...output.files.keys()].some((path) => path.startsWith('assets/images/'))).toBe(false)
  })

  test('prepares the first emitted component variant rather than silently blocking its tour', () => {
    const component: ComponentDef = {
      componentId: 'variant-component',
      name: 'RoomVariants',
      props: [],
      children: [],
      variants: [{ key: 'Default', children: [tour()] }]
    }
    const output = flutterAdapter.emit([page([])], options, [component])
    expect(textFile(output.files, 'lib/components/room_variants.dart')).toContain(
      'OpenPencilVRTourWebView'
    )
    expect(output.files.has(`assets/vr-tour/${vrTourHybridKey('room-tour')}.html`)).toBe(true)
    expect(output.warnings.map((warning) => warning.code)).not.toContain(
      'flutter-vr-tour-config-unavailable'
    )
  })
})
