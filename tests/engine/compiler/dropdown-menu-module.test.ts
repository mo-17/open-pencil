import { describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { trustedNativeDropdownMenuTrigger } from '#compiler/adapters/native-shared'
import type { IRElement } from '#compiler/ir/types'

import { compile, withDefaults, type CompilerOutput } from '@open-pencil/compiler'
import { buildPreviewProject } from '@open-pencil/compiler/build'
import { collectTree } from '@open-pencil/compiler/ir/collect/tree'
import {
  createDropdownMenuModuleFrameOverrides,
  DROPDOWN_MENU_MODULE_DEFAULT_CONFIG
} from '@open-pencil/core/plugins'

import { firstPageId, makeSceneGraph } from '#tests/helpers/scene'

const DROPDOWN_CONFIG = {
  ...DROPDOWN_MENU_MODULE_DEFAULT_CONFIG,
  triggerLabel: 'Account actions',
  triggerMode: 'hover' as const,
  placement: 'rightBottom' as const,
  menuWidth: 320,
  items: [
    {
      type: 'item' as const,
      label: 'Profile',
      href: '/profile',
      disabled: false,
      danger: false,
      shortcut: '⌘P'
    },
    { type: 'separator' as const },
    {
      type: 'item' as const,
      label: '<script>never execute</script>',
      href: '',
      disabled: false,
      danger: true,
      shortcut: ''
    }
  ]
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

function nativeDropdownTriggerElement(
  payload: Record<string, unknown>,
  children: IRElement['children'] = []
): IRElement {
  return {
    kind: 'element',
    sourceId: 'dropdown-trigger',
    tag: 'div',
    className: '',
    attrs: {},
    children,
    module: {
      pluginId: 'open-pencil.dropdown-menu',
      moduleType: 'dropdown-menu',
      configVersion: 1,
      payload
    }
  }
}

describe('compiler trusted Dropdown Menu module adapter', () => {
  test('lowers a detached config and emits the dependency-free accessible portal runtime', () => {
    const graph = makeSceneGraph()
    const pageId = firstPageId(graph)
    const frame = graph.createNode('FRAME', pageId, {
      ...createDropdownMenuModuleFrameOverrides(DROPDOWN_CONFIG),
      width: 220,
      height: 56
    })
    graph.createNode('BUTTON', frame.id, {
      width: 180,
      height: 44,
      interactiveProps: { text: 'Authored dropdown trigger' }
    })

    const ir = collectTree(graph, pageId)
    const element = ir.children[0] as IRElement
    expect(element.module).toEqual({
      pluginId: 'open-pencil.dropdown-menu',
      moduleType: 'dropdown-menu',
      configVersion: 1,
      payload: DROPDOWN_CONFIG
    })
    expect(element.module?.payload).not.toBe(DROPDOWN_CONFIG)
    expect(element.module?.payload.items).not.toBe(DROPDOWN_CONFIG.items)

    const output = compile({
      graph,
      pageIds: [pageId],
      options: withDefaults({ packageName: 'dropdown-module-demo', devMode: false })
    })
    const app = output.files.get('src/App.tsx') as string
    const runtime = output.files.get('src/__openpencil_dropdown_menu.tsx') as string
    const pkg = JSON.parse(output.files.get('package.json') as string) as {
      dependencies: Record<string, string>
    }

    expect(app).toContain("import OpenPencilDropdownMenu from './__openpencil_dropdown_menu'")
    expect(app).toContain('<OpenPencilDropdownMenu config={{')
    expect(app).toContain('Authored dropdown trigger')
    expect(runtime).toContain("import { createPortal } from 'react-dom'")
    expect(runtime).toContain('role="menu"')
    expect(runtime).toContain("role: 'menuitem' as const")
    expect(runtime).toContain('role="separator"')
    expect(runtime).toContain("event.key === 'ArrowDown'")
    expect(runtime).toContain("event.key === 'Home'")
    expect(runtime).toContain("event.key === 'End'")
    expect(runtime).toContain("event.key === 'Escape'")
    expect(runtime).toContain("event.key === 'Tab'")
    expect(runtime).toContain('closeMenuForTab(event.shiftKey)')
    expect(runtime).toContain('runtimeSafeHref')
    expect(runtime).toContain("url.protocol === 'https:'")
    expect(runtime).toContain("value.startsWith('/')")
    expect(runtime).not.toContain("url.protocol === 'http:'")
    expect(runtime).not.toContain("url.protocol === 'mailto:'")
    expect(runtime).toContain('config.closeOnOutsidePress')
    expect(runtime).toContain('config.closeOnSelect')
    expect(runtime).toContain('data-openpencil-dropdown-trigger-authored="" inert')
    expect(runtime).toContain("const ownerSelector = '[data-openpencil-dropdown-owner=\"' + menuId")
    expect(runtime).toContain("'data-openpencil-dropdown-owner': menuId")
    expect(runtime).toContain("window.addEventListener('scroll', refreshPosition, true)")
    expect(runtime).toContain("window.matchMedia('(prefers-reduced-motion: reduce)')")
    expect(runtime).not.toContain('dangerouslySetInnerHTML')
    expect(runtime).not.toContain('.innerHTML')
    expect(runtime).not.toContain('onSelectItem')
    expect(pkg.dependencies['@radix-ui/react-dropdown-menu']).toBeUndefined()
    expect(pkg.dependencies['@floating-ui/react']).toBeUndefined()
    expect(output.warnings).toEqual([expect.objectContaining({ code: 'button-no-events' })])
  })

  test('accepts only complete empty native trigger payloads', () => {
    const payload = {
      triggerLabel: 'Open actions',
      showTriggerLabel: true,
      showTriggerChevron: false
    }
    expect(trustedNativeDropdownMenuTrigger(nativeDropdownTriggerElement(payload))).toEqual({
      label: 'Open actions',
      showIcon: false,
      showLabel: true
    })
    expect(
      trustedNativeDropdownMenuTrigger(
        nativeDropdownTriggerElement({ triggerLabel: 'Incomplete', showTriggerChevron: true })
      )
    ).toBeUndefined()
    expect(
      trustedNativeDropdownMenuTrigger(
        nativeDropdownTriggerElement(payload, [
          { kind: 'text', value: 'Authored trigger', sourceId: 'authored-trigger' }
        ])
      )
    ).toBeUndefined()
  })

  for (const target of ['expo', 'flutter'] as const) {
    test(`${target} emits a static trigger only and preserves the unsupported warning`, () => {
      for (const [showTriggerLabel, showTriggerChevron] of [
        [true, true],
        [true, false],
        [false, true]
      ] as const) {
        const label = `Native ${target} dropdown ${showTriggerLabel}-${showTriggerChevron}`
        const graph = makeSceneGraph(`Native Dropdown ${target}`)
        const pageId = firstPageId(graph)
        graph.createNode('FRAME', pageId, {
          ...createDropdownMenuModuleFrameOverrides({
            ...DROPDOWN_CONFIG,
            triggerLabel: label,
            showTriggerLabel,
            showTriggerChevron
          })
        })
        const output = compile({
          graph,
          pageIds: [pageId],
          options: withDefaults({
            target,
            router: 'none',
            devMode: false,
            packageName: target === 'flutter' ? 'native_dropdown' : 'native-dropdown'
          })
        })
        const source = nativeSources(output, target)
        expect(source.includes(label)).toBe(showTriggerLabel)
        expect(
          source.includes(target === 'expo' ? '"rotate":"45deg"' : 'Icons.keyboard_arrow_down')
        ).toBe(showTriggerChevron)
        expect(source).not.toContain('Profile')
        expect(source).not.toContain('never execute')
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

      const authoredGraph = makeSceneGraph(`Authored Native Dropdown ${target}`)
      const pageId = firstPageId(authoredGraph)
      const frame = authoredGraph.createNode('FRAME', pageId, {
        ...createDropdownMenuModuleFrameOverrides({
          ...DROPDOWN_CONFIG,
          triggerLabel: 'module-only-trigger-must-not-leak'
        })
      })
      authoredGraph.createNode('TEXT', frame.id, { text: 'Authored Dropdown fallback' })
      const output = compile({
        graph: authoredGraph,
        pageIds: [pageId],
        options: withDefaults({
          target,
          router: 'none',
          devMode: false,
          packageName:
            target === 'flutter' ? 'authored_native_dropdown' : 'authored-native-dropdown'
        })
      })
      const source = nativeSources(output, target)
      expect(source).toContain('Authored Dropdown fallback')
      expect(source).not.toContain('module-only-trigger-must-not-leak')
      expect(source).not.toContain('Profile')
    })
  }

  test('bundles the Dropdown Menu runtime into a static preview project', async () => {
    const graph = makeSceneGraph()
    const pageId = firstPageId(graph)
    graph.createNode('FRAME', pageId, createDropdownMenuModuleFrameOverrides(DROPDOWN_CONFIG))
    const output = compile({
      graph,
      pageIds: [pageId],
      options: withDefaults({ packageName: 'dropdown-module-static', devMode: false })
    })
    const buildDirectory = mkdtempSync(join(tmpdir(), 'openpencil-dropdown-module-build-'))
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
