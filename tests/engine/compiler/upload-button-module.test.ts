import { describe, expect, test } from 'bun:test'

import { trustedNativeUploadButtonTrigger } from '#compiler/adapters/native-shared'
import {
  buildOpenPencilUploadButtonComponent,
  UPLOAD_BUTTON_REACT_MODULE_ADAPTER
} from '#compiler/adapters/react/modules/upload-button'
import type { IRElement } from '#compiler/ir/types'

import { compile, withDefaults, type CompilerOutput } from '@open-pencil/compiler'
import { collectTree } from '@open-pencil/compiler/ir/collect/tree'
import {
  createUploadButtonModuleFrameOverrides,
  UPLOAD_BUTTON_MODULE_DEFAULT_CONFIG
} from '@open-pencil/core/plugins'

import { firstPageId, makeSceneGraph } from '#tests/helpers/scene'

const UPLOAD_CONFIG = {
  ...UPLOAD_BUTTON_MODULE_DEFAULT_CONFIG,
  triggerLabel: 'Choose project files',
  accept: ['.png', 'image/jpeg', 'text/*'],
  multiple: true,
  maxFiles: 4,
  maxFileBytes: 2_000_000,
  helperText: 'Files remain on this device until your app handles them.'
}

function nativeSources(output: CompilerOutput, target: 'expo' | 'flutter'): string {
  const extensions = target === 'expo' ? ['.ts', '.tsx'] : ['.dart']
  return [...output.files]
    .filter(
      ([path, value]) =>
        typeof value === 'string' && extensions.some((extension) => path.endsWith(extension))
    )
    .map(([, value]) => value)
    .join('\n')
}

function nativeUploadTriggerElement(
  payload: Record<string, unknown>,
  children: IRElement['children'] = []
): IRElement {
  return {
    kind: 'element',
    sourceId: 'upload-trigger',
    tag: 'div',
    className: '',
    attrs: {},
    children,
    module: {
      pluginId: 'open-pencil.upload-button',
      moduleType: 'upload-button',
      configVersion: 1,
      payload
    }
  }
}

describe('compiler trusted Upload Button module adapter', () => {
  test('lowers a detached accept list and emits a dependency-free local-only runtime', () => {
    const graph = makeSceneGraph()
    const pageId = firstPageId(graph)
    const frame = graph.createNode('FRAME', pageId, {
      ...createUploadButtonModuleFrameOverrides(UPLOAD_CONFIG),
      width: 240,
      height: 52
    })
    graph.createNode('BUTTON', frame.id, {
      width: 200,
      height: 44,
      interactiveProps: { text: 'Authored upload trigger' }
    })

    const ir = collectTree(graph, pageId)
    const element = ir.children[0] as IRElement
    expect(element.module).toEqual({
      pluginId: 'open-pencil.upload-button',
      moduleType: 'upload-button',
      configVersion: 1,
      payload: UPLOAD_CONFIG
    })
    expect(element.module?.payload).not.toBe(UPLOAD_CONFIG)
    expect(element.module?.payload.accept).not.toBe(UPLOAD_CONFIG.accept)

    const output = compile({
      graph,
      pageIds: [pageId],
      options: withDefaults({ packageName: 'upload-button-demo', devMode: false })
    })
    const app = String(output.files.get('src/App.tsx'))
    const runtime = String(output.files.get('src/__openpencil_upload_button.tsx'))
    const pkg = JSON.parse(String(output.files.get('package.json'))) as {
      dependencies: Record<string, string>
    }

    expect(app).toContain("import OpenPencilUploadButton from './__openpencil_upload_button'")
    expect(app).toContain('<OpenPencilUploadButton config={{')
    expect(app).toContain('Authored upload trigger')
    expect(runtime).toBe(buildOpenPencilUploadButtonComponent())
    expect(() => new Bun.Transpiler({ loader: 'tsx' }).transformSync(runtime)).not.toThrow()
    expect(runtime).toContain('type="file"')
    expect(runtime).toContain("import { createPortal } from 'react-dom'")
    expect(runtime).toContain("accept={config.accept.length > 0 ? config.accept.join(',')")
    expect(runtime).toContain('matchesAccept(file, config.accept)')
    expect(runtime).toContain("token.endsWith('/*')")
    expect(runtime).toContain('name.slice(-token.length).toLowerCase() === token')
    expect(runtime).toContain("event.currentTarget.value = ''")
    expect(runtime).toContain('selected locally — not uploaded.')
    expect(runtime).toContain('Clear local selection')
    expect(runtime).toContain('selectedRef.current = []')
    expect(runtime).toContain('aria-live="assertive"')
    expect(runtime).toContain('Folders are not supported.')
    expect(runtime).toContain('data-openpencil-upload-trigger-authored=""')
    expect(runtime).toContain('id={authoredLabelId} inert')
    expect(runtime).toContain("aria-labelledby={authoredLabelId + ' ' + authoredFallbackId}")
    expect(runtime).toContain('data-openpencil-upload-owner={baseId}')
    expect(runtime).toContain('const MAX_INCOMING_FILES = 100')
    expect(runtime).toContain('const MAX_ERROR_MESSAGES = 4')
    expect(runtime).toContain('files.length - candidateCount')
    expect(runtime).toContain('additional files were not checked.')
    expect(runtime).toContain('point === 0x061c')
    expect(runtime).toContain('(point >= 0x2028 && point <= 0x202e)')
    expect(runtime).not.toContain('Array.from(event.currentTarget.files')
    expect(runtime).toContain("window.matchMedia('(prefers-reduced-motion: reduce)')")
    expect(runtime).not.toContain('fetch(')
    expect(runtime).not.toContain('XMLHttpRequest')
    expect(runtime).not.toContain('WebSocket')
    expect(runtime).not.toContain('FileReader')
    expect(runtime).not.toContain('createObjectURL')
    expect(runtime).not.toContain('localStorage')
    expect(runtime).not.toContain('indexedDB')
    expect(runtime).not.toContain('console.')
    expect(runtime).not.toContain('dangerouslySetInnerHTML')
    expect(runtime).not.toContain('.innerHTML')
    expect(pkg.dependencies['@uppy/core']).toBeUndefined()
    expect(pkg.dependencies.axios).toBeUndefined()
    expect(UPLOAD_BUTTON_REACT_MODULE_ADAPTER.dependencies).toBeUndefined()
  })

  test('accepts only complete native trigger payloads and safely recognizes authored triggers', () => {
    const payload = {
      triggerLabel: 'Choose files',
      showTriggerIcon: true,
      showTriggerLabel: false
    }
    expect(trustedNativeUploadButtonTrigger(nativeUploadTriggerElement(payload))).toEqual({
      label: 'Choose files',
      showIcon: true,
      showLabel: false
    })
    expect(
      trustedNativeUploadButtonTrigger(
        nativeUploadTriggerElement({ triggerLabel: 'Incomplete', showTriggerIcon: true })
      )
    ).toBeUndefined()
    expect(
      trustedNativeUploadButtonTrigger(
        nativeUploadTriggerElement(payload, [
          { kind: 'text', sourceId: 'authored', value: 'Authored trigger' }
        ])
      )
    ).toEqual({
      label: 'Choose files',
      showIcon: true,
      showLabel: false
    })
  })

  for (const target of ['expo', 'flutter'] as const) {
    test(`${target} emits only a trusted static trigger and an unsupported warning`, () => {
      const graph = makeSceneGraph(`Native Upload ${target}`)
      const pageId = firstPageId(graph)
      const frame = graph.createNode('FRAME', pageId, {
        ...createUploadButtonModuleFrameOverrides({
          ...UPLOAD_CONFIG,
          triggerLabel: `Native ${target} upload`
        })
      })
      graph.createNode('BUTTON', frame.id, {
        height: 44,
        interactiveProps: { text: 'Authored native upload action' },
        width: 180
      })
      const output = compile({
        graph,
        pageIds: [pageId],
        options: withDefaults({
          target,
          router: 'none',
          devMode: false,
          packageName: target === 'flutter' ? 'native_upload' : 'native-upload'
        })
      })
      const source = nativeSources(output, target)
      expect(source).toContain(`Native ${target} upload`)
      expect(source).not.toContain('Authored native upload action')
      expect(source).not.toContain('project files')
      expect(source).not.toContain('.png')
      expect(source).not.toContain('text/*')
      expect(source).not.toContain('FileReader')
      expect(source).not.toContain('WebView')
      if (target === 'expo') {
        expect(source).not.toContain('<Pressable')
        expect(source).not.toContain('onPress=')
        expect(source).toContain('pointerEvents="none"')
        expect(source).toContain('accessible={true}')
        expect(source).toContain('accessibilityRole="button"')
        expect(source).toContain('accessibilityState={{ disabled: true }}')
        expect(source).toContain('File selection is unavailable in this static Expo export.')
        expect(source).toContain('Unavailable')
        expect(source).toContain('"opacity":0.62')
        expect(source).toContain('"backgroundColor":"#FFFFFF"')
        expect(output.warnings.map((warning) => warning.code)).toContain('expo-module-unsupported')
      } else {
        expect(source).not.toContain('TextButton(')
        expect(source).not.toContain('onPressed:')
        expect(source).toContain('Icons.file_upload_outlined')
        expect(source).toContain('Semantics(')
        expect(source).toContain('button: true')
        expect(source).toContain('enabled: false')
        expect(source).toContain('File selection unavailable in this static Flutter export.')
        expect(source).toContain("'Unavailable'")
        expect(source).toContain('opacity: 0.62')
        expect(source).not.toContain('GestureDetector(')
        expect(output.warnings.map((warning) => warning.code)).toContain(
          'flutter-element-feature-unsupported'
        )
      }
    })
  }
})
