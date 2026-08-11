import { describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { trustedNativeModalTrigger } from '#compiler/adapters/native-shared'
import type { IRElement } from '#compiler/ir/types'

import { compile, withDefaults, type CompilerOutput } from '@open-pencil/compiler'
import { buildPreviewProject } from '@open-pencil/compiler/build'
import { collectTree } from '@open-pencil/compiler/ir/collect/tree'
import {
  createModalModuleFrameOverrides,
  MODAL_MODULE_DEFAULT_CONFIG
} from '@open-pencil/core/plugins'

import { firstPageId, makeSceneGraph } from '#tests/helpers/scene'

const MODAL_CONFIG = {
  ...MODAL_MODULE_DEFAULT_CONFIG,
  triggerLabel: 'Review changes',
  title: 'Publish design',
  content: 'Review every field.\n<script>alert("never execute")</script>',
  cancelLabel: 'Keep editing',
  confirmLabel: 'Publish',
  panelWidth: 640,
  footerAlign: 'center' as const,
  overlayOpacity: 0.52
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

function nativeModalTriggerElement(
  payload: Record<string, unknown>,
  children: IRElement['children'] = []
): IRElement {
  return {
    kind: 'element',
    sourceId: 'modal-trigger',
    tag: 'div',
    className: '',
    attrs: {},
    children,
    module: {
      pluginId: 'open-pencil.modal',
      moduleType: 'modal',
      configVersion: 1,
      payload
    }
  }
}

describe('compiler trusted Modal module adapter', () => {
  test('lowers the bounded config and emits an accessible dependency-free portal runtime', () => {
    const graph = makeSceneGraph()
    const pageId = firstPageId(graph)
    const frame = graph.createNode('FRAME', pageId, {
      ...createModalModuleFrameOverrides(MODAL_CONFIG),
      width: 220,
      height: 56
    })
    graph.createNode('BUTTON', frame.id, {
      width: 180,
      height: 44,
      interactiveProps: { text: 'Authored modal trigger' }
    })

    const ir = collectTree(graph, pageId)
    const element = ir.children[0] as IRElement
    expect(element.module).toEqual({
      pluginId: 'open-pencil.modal',
      moduleType: 'modal',
      configVersion: 1,
      payload: MODAL_CONFIG
    })
    expect(element.module?.payload).not.toBe(MODAL_CONFIG)

    const output = compile({
      graph,
      pageIds: [pageId],
      options: withDefaults({ packageName: 'modal-module-demo', devMode: false })
    })
    const app = output.files.get('src/App.tsx') as string
    const runtime = output.files.get('src/__openpencil_modal.tsx') as string
    const pkg = JSON.parse(output.files.get('package.json') as string) as {
      dependencies: Record<string, string>
    }

    expect(app).toContain("import OpenPencilModal from './__openpencil_modal'")
    expect(app).toContain('<OpenPencilModal config={{')
    expect(app).toContain('Authored modal trigger')
    expect(runtime).toContain("import { createPortal } from 'react-dom'")
    expect(runtime).toContain('<dialog')
    expect(runtime).toContain('dialog.showModal()')
    expect(runtime).toContain('role="dialog"')
    expect(runtime).toContain('aria-modal="true"')
    expect(runtime).toContain('aria-labelledby={config.title ? titleId : undefined}')
    expect(runtime).toContain('aria-describedby={config.content ? contentId : undefined}')
    expect(runtime).toContain('data-openpencil-modal-trigger-host=""')
    expect(runtime).toContain('data-openpencil-modal-trigger-authored="" inert')
    expect(runtime).toContain('data-openpencil-modal-close=""')
    expect(runtime).toContain('height: 44,')
    expect(runtime).toContain('d="M6 6L18 18M18 6L6 18"')
    expect(runtime).toContain('config.closeOnEscape && isTopModal(tokenRef.current)')
    expect(runtime).toContain('config.closeOnBackdrop &&')
    expect(runtime).toContain("if (event.key !== 'Tab') return")
    expect(runtime).toContain("document.body.style.overflow = 'hidden'")
    expect(runtime).toContain('entry.restoreFocus.focus({ preventScroll: true })')
    expect(runtime).toContain("window.matchMedia('(prefers-reduced-motion: reduce)')")
    expect(runtime).toContain("width: 'min(' + config.panelWidth + 'px, calc(100vw - 32px))'")
    expect(runtime).toContain('data-openpencil-modal-action="cancel"')
    expect(runtime).toContain('data-openpencil-modal-action="confirm"')
    expect(runtime).toContain('{config.content}')
    expect(runtime).not.toContain('dangerouslySetInnerHTML')
    expect(runtime).not.toContain('.innerHTML')
    expect(runtime).not.toContain('onConfirm')
    expect(runtime).not.toContain('onCancelButton')
    expect(pkg.dependencies['focus-trap-react']).toBeUndefined()
    expect(pkg.dependencies['@radix-ui/react-dialog']).toBeUndefined()
    expect(output.warnings).toEqual([expect.objectContaining({ code: 'button-no-events' })])
  })

  test('accepts only complete empty native trigger payloads', () => {
    const payload = { triggerLabel: 'Open details', showTriggerIcon: false, showTriggerLabel: true }
    expect(trustedNativeModalTrigger(nativeModalTriggerElement(payload))).toEqual({
      label: 'Open details',
      showIcon: false,
      showLabel: true
    })
    expect(
      trustedNativeModalTrigger(
        nativeModalTriggerElement({ triggerLabel: 'Incomplete', showTriggerIcon: true })
      )
    ).toBeUndefined()
    expect(
      trustedNativeModalTrigger(
        nativeModalTriggerElement(payload, [
          { kind: 'text', value: 'Authored trigger', sourceId: 'authored-trigger' }
        ])
      )
    ).toBeUndefined()
  })

  for (const target of ['expo', 'flutter'] as const) {
    test(`${target} emits all four static trigger visibility combinations and keeps the unsupported warning`, () => {
      for (const [showTriggerIcon, showTriggerLabel] of [
        [true, true],
        [true, false],
        [false, true],
        [false, false]
      ] as const) {
        const label = `Native ${target} modal ${showTriggerIcon}-${showTriggerLabel}`
        const graph = makeSceneGraph(`Native Modal ${target}`)
        const pageId = firstPageId(graph)
        graph.createNode('FRAME', pageId, {
          ...createModalModuleFrameOverrides({
            ...MODAL_CONFIG,
            triggerLabel: label,
            showTriggerIcon,
            showTriggerLabel
          })
        })
        const output = compile({
          graph,
          pageIds: [pageId],
          options: withDefaults({
            target,
            router: 'none',
            devMode: false,
            packageName: target === 'flutter' ? 'native_modal' : 'native-modal'
          })
        })
        const source = nativeSources(output, target)
        const hasWindowIcon =
          target === 'expo'
            ? source.includes(
                '"width":18,"height":16,"borderColor":"#FFFFFF","borderRadius":2,"borderWidth":2'
              )
            : source.includes('borderRadius: BorderRadius.circular(2.0)')

        expect(source.includes(label)).toBe(showTriggerLabel)
        expect(hasWindowIcon).toBe(showTriggerIcon)
        expect(source).not.toContain(MODAL_CONFIG.title)
        expect(source).not.toContain(MODAL_CONFIG.content)
        expect(source).not.toContain('WebView')
        if (target === 'expo') {
          expect(source).toContain('pointerEvents="none"')
          expect(output.warnings.map((warning) => warning.code)).toContain(
            'expo-module-unsupported'
          )
        } else {
          expect(source).not.toContain('GestureDetector(')
          expect(output.warnings.map((warning) => warning.code)).toContain(
            'flutter-element-feature-unsupported'
          )
        }
      }

      const authoredGraph = makeSceneGraph(`Authored Native Modal ${target}`)
      const authoredPageId = firstPageId(authoredGraph)
      const authoredFrame = authoredGraph.createNode('FRAME', authoredPageId, {
        ...createModalModuleFrameOverrides({
          ...MODAL_CONFIG,
          triggerLabel: 'module-only-trigger-must-not-leak'
        })
      })
      authoredGraph.createNode('TEXT', authoredFrame.id, { text: 'Authored Modal fallback' })
      const authoredOutput = compile({
        graph: authoredGraph,
        pageIds: [authoredPageId],
        options: withDefaults({
          target,
          router: 'none',
          devMode: false,
          packageName: target === 'flutter' ? 'authored_native_modal' : 'authored-native-modal'
        })
      })
      const authoredSource = nativeSources(authoredOutput, target)
      expect(authoredSource).toContain('Authored Modal fallback')
      expect(authoredSource).not.toContain('module-only-trigger-must-not-leak')
      expect(authoredSource).not.toContain(MODAL_CONFIG.content)
    })
  }

  test('bundles the Modal runtime into a static preview project', async () => {
    const graph = makeSceneGraph()
    const pageId = firstPageId(graph)
    graph.createNode('FRAME', pageId, createModalModuleFrameOverrides(MODAL_CONFIG))
    const output = compile({
      graph,
      pageIds: [pageId],
      options: withDefaults({ packageName: 'modal-module-static', devMode: false })
    })
    const buildDirectory = mkdtempSync(join(tmpdir(), 'openpencil-modal-module-build-'))
    try {
      const built = await buildPreviewProject({ files: output.files, outDir: buildDirectory })
      expect(built.files).toContain('index.html')
      expect(built.files.some((path) => path.endsWith('.js'))).toBe(true)
      expect(output.warnings).toEqual([])
    } finally {
      rmSync(buildDirectory, { recursive: true, force: true })
    }
  }, 15_000)
})
