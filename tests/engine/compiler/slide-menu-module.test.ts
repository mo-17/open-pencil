import { describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { compile, withDefaults } from '@open-pencil/compiler'
import { buildPreviewProject } from '@open-pencil/compiler/build'
import { collectTree } from '@open-pencil/compiler/ir/collect/tree'
import type { IRElement } from '@open-pencil/compiler/ir/types'
import { createSlideMenuModuleInstance } from '@open-pencil/core/plugins'

import { firstPageId, makeSceneGraph } from '#tests/helpers/scene'

const SLIDE_MENU_CONFIG = {
  presentation: 'menu' as const,
  direction: 'right' as const,
  triggerLabel: 'Open navigation',
  title: 'Explore',
  description: 'Choose a safe destination.',
  items: [
    { label: 'Overview', href: '/overview' },
    { label: 'Documentation', href: 'https://example.com/docs' }
  ],
  closeOnBackdrop: true,
  showCloseButton: true,
  panelSize: 336,
  panelBackground: '#FFFFFF',
  textColor: '#111827',
  overlayOpacity: 0.48
}

function slideMenuFrameOverrides(config: Record<string, unknown>) {
  return {
    width: 220,
    height: 56,
    interactiveProps: {
      module: {
        version: 1 as const,
        pluginId: 'open-pencil.slide-menu',
        moduleType: 'slide-menu',
        configVersion: 1,
        config
      }
    }
  }
}

describe('compiler trusted slide-menu module adapter', () => {
  test('lowers the exact bounded config and emits a dependency-free accessible portal runtime', () => {
    const graph = makeSceneGraph()
    const pageId = firstPageId(graph)
    const frame = graph.createNode('FRAME', pageId, slideMenuFrameOverrides(SLIDE_MENU_CONFIG))
    graph.createNode('TEXT', frame.id, { text: 'Authored trigger' })

    const ir = collectTree(graph, pageId)
    const element = ir.children[0] as IRElement
    expect(element.module).toEqual({
      pluginId: 'open-pencil.slide-menu',
      moduleType: 'slide-menu',
      configVersion: 2,
      payload: {
        ...SLIDE_MENU_CONFIG,
        showTriggerIcon: true,
        showTriggerLabel: true
      }
    })
    expect(element.module?.payload).not.toBe(SLIDE_MENU_CONFIG)
    expect(element.module?.payload.items).not.toBe(SLIDE_MENU_CONFIG.items)

    const out = compile({
      graph,
      pageIds: [pageId],
      options: withDefaults({ packageName: 'slide-menu-module-demo', devMode: false })
    })
    const app = out.files.get('src/App.tsx') as string
    const runtime = out.files.get('src/__openpencil_slide_menu.tsx') as string
    const pkg = JSON.parse(out.files.get('package.json') as string) as {
      dependencies: Record<string, string>
    }

    expect(app).toContain("import OpenPencilSlideMenu from './__openpencil_slide_menu'")
    expect(app).toContain('<OpenPencilSlideMenu config={{')
    expect(app).toContain('Authored trigger')
    expect(app).toContain('</OpenPencilSlideMenu>')
    expect(runtime).toContain("import { createPortal } from 'react-dom'")
    expect(runtime).toContain('data-openpencil-slide-menu-trigger=""')
    expect(runtime).toContain('data-openpencil-slide-menu-overlay=""')
    expect(runtime).toContain('role="dialog"')
    expect(runtime).toContain('aria-modal="true"')
    expect(runtime).toContain("event.key === 'Escape'")
    expect(runtime).toContain("event.key !== 'Tab'")
    expect(runtime).toContain("document.body.style.overflow = 'hidden'")
    expect(runtime).toContain('bodyScrollLockCount += 1')
    expect(runtime).toContain("document.body.style.overflow = previousBodyOverflow ?? ''")
    expect(runtime).toContain('window.cancelAnimationFrame(openFrameRef.current)')
    expect(runtime).toContain('if (!isTopOpenSlideMenu(modalTokenRef.current)) return')
    expect(runtime).toContain('const { wasTop, nextTop } = removeOpenSlideMenu(entry.token)')
    expect(runtime).toContain("'min(' + size + ', calc(100vw - 16px))'")
    expect(runtime).toContain("'min(' + size + ', calc(100vh - 16px))'")
    expect(runtime).toContain('triggerRef.current?.focus')
    expect(runtime).toContain('if (config.closeOnBackdrop) closePanel()')
    expect(runtime).toContain('config.showCloseButton ?')
    expect(runtime).toContain('data-openpencil-slide-menu-close=""')
    expect(runtime).toContain('data-openpencil-slide-menu-close-icon=""')
    expect(runtime).toContain('height: 44,\n  padding: 10,\n  width: 44')
    expect(runtime).toContain('d="M6 6L18 18M18 6L6 18"')
    expect(runtime).toContain('slide-menu-close]:focus-visible{outline:2px solid currentColor}')
    expect(runtime).not.toContain('>Close</button>')
    expect(runtime).toContain('<a href={item.href} onClick={closePanel}>{item.label}</a>')
    expect(runtime).toContain("window.matchMedia('(prefers-reduced-motion: reduce)')")
    expect(runtime).toContain("transition: reducedMotion\n      ? 'none'")
    expect(runtime).not.toContain('dangerouslySetInnerHTML')
    expect(runtime).not.toContain('.innerHTML')
    expect(runtime).not.toContain('<iframe')
    expect(runtime).not.toContain('WebView')
    expect(pkg.dependencies['focus-trap-react']).toBeUndefined()
    expect(pkg.dependencies['@radix-ui/react-dialog']).toBeUndefined()
    expect(out.warnings).toEqual([])
  })

  test('lowers the two trigger visibility controls independently in v2', () => {
    const graph = makeSceneGraph()
    const pageId = firstPageId(graph)
    graph.createNode('FRAME', pageId, {
      width: 220,
      height: 56,
      interactiveProps: {
        module: createSlideMenuModuleInstance({
          ...SLIDE_MENU_CONFIG,
          showTriggerIcon: false,
          showTriggerLabel: true
        })
      }
    })

    const ir = collectTree(graph, pageId)
    const element = ir.children[0] as IRElement
    expect(element.module).toMatchObject({
      pluginId: 'open-pencil.slide-menu',
      moduleType: 'slide-menu',
      configVersion: 2,
      payload: {
        triggerLabel: 'Open navigation',
        showTriggerIcon: false,
        showTriggerLabel: true
      }
    })
    expect(ir.warnings).toEqual([])
  })

  test('keeps authored fallback content when a link URL is unsafe', () => {
    const graph = makeSceneGraph()
    const pageId = firstPageId(graph)
    const frame = graph.createNode(
      'FRAME',
      pageId,
      slideMenuFrameOverrides({
        ...SLIDE_MENU_CONFIG,
        items: [{ label: 'Unsafe', href: ['javascript', 'alert(1)'].join(':') }]
      })
    )
    graph.createNode('TEXT', frame.id, { text: 'Slide menu unavailable' })

    const ir = collectTree(graph, pageId)
    const element = ir.children[0] as IRElement
    expect(element.module).toBeUndefined()
    expect(JSON.stringify(element.children)).toContain('Slide menu unavailable')
    expect(ir.warnings.map((warning) => warning.code)).toContain('slide-menu-module-invalid')
  })

  test('bundles the local slide-menu runtime into a static preview project', async () => {
    const graph = makeSceneGraph()
    const pageId = firstPageId(graph)
    graph.createNode('FRAME', pageId, slideMenuFrameOverrides(SLIDE_MENU_CONFIG))
    const out = compile({
      graph,
      pageIds: [pageId],
      options: withDefaults({ packageName: 'slide-menu-module-static', devMode: false })
    })
    const buildDirectory = mkdtempSync(join(tmpdir(), 'openpencil-slide-menu-module-build-'))

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
