import { describe, expect, test } from 'bun:test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

import { vueAdapter } from '#compiler/adapters/vue'
import type { IRElement, IRTree } from '#compiler/ir/types'
import { compileScript, compileTemplate, parse as parseVueSfc } from 'vue/compiler-sfc'

import { compile, withDefaults } from '@open-pencil/compiler'
import {
  createDropdownMenuModuleFrameOverrides,
  createModalModuleFrameOverrides,
  createSlideMenuModuleFrameOverrides,
  createUploadButtonModuleFrameOverrides
} from '@open-pencil/core/plugins'

import { firstPageId, makeSceneGraph } from '#tests/helpers/scene'

function vueOptions() {
  return withDefaults({
    packageName: 'vue-module-demo',
    target: 'vue',
    router: 'none',
    devMode: true
  })
}

function textFile(files: ReadonlyMap<string, string | Uint8Array>, path: string): string {
  const value = files.get(path)
  if (typeof value !== 'string') throw new Error(`Missing text file: ${path}`)
  return value
}

function expectCompilableSfc(source: string, filename: string): void {
  const parsed = parseVueSfc(source, { filename })
  expect(parsed.errors).toEqual([])
  compileScript(parsed.descriptor, { id: filename })
  const template = parsed.descriptor.template
  if (!template) throw new Error(`${filename} is missing a template`)
  const compiled = compileTemplate({ source: template.content, filename, id: filename })
  expect(compiled.errors).toEqual([])
}

function minimalIr(children: IRTree['children']): IRTree {
  return {
    pageId: 'page',
    pageName: 'Page',
    usesRouteParams: false,
    children,
    states: [],
    docStates: [],
    docStateReads: [],
    docStateWrites: [],
    warnings: []
  }
}

function maybeWriteVerificationProject(files: ReadonlyMap<string, string | Uint8Array>): void {
  const directory = process.env.OPENPENCIL_VUE_MODULE_VERIFY_DIR
  if (!directory) return
  for (const [path, value] of files) {
    const destination = join(directory, path)
    mkdirSync(dirname(destination), { recursive: true })
    writeFileSync(destination, value)
  }
}

describe('Vue trusted module runtimes', () => {
  test('uses core-lowered payloads and emits the four supported local SFC runtimes', () => {
    const graph = makeSceneGraph('Modules')
    const pageId = firstPageId(graph)
    const frames = [
      graph.createNode('FRAME', pageId, createModalModuleFrameOverrides()),
      graph.createNode('FRAME', pageId, createDropdownMenuModuleFrameOverrides()),
      graph.createNode('FRAME', pageId, createSlideMenuModuleFrameOverrides()),
      graph.createNode('FRAME', pageId, createUploadButtonModuleFrameOverrides())
    ]
    for (const [index, frame] of frames.entries()) {
      graph.createNode('BUTTON', frame.id, {
        height: 44,
        interactiveProps: { text: `Authored trigger ${index + 1}` },
        width: 160
      })
    }

    const output = compile({ graph, pageIds: [pageId], options: vueOptions() })
    const page = textFile(output.files, 'src/pages/index.vue')
    const expectedRuntimes = [
      'src/__openpencil_modal.vue',
      'src/__openpencil_dropdown_menu.vue',
      'src/__openpencil_slide_menu.vue',
      'src/__openpencil_upload_button.vue'
    ]

    expect(output.warnings.map((warning) => warning.code)).not.toContain('vue-module-unsupported')
    expect(output.files.has('src/__openpencil_layer.ts')).toBe(true)
    for (const path of expectedRuntimes) {
      expect(output.files.has(path)).toBe(true)
      expectCompilableSfc(textFile(output.files, path), path)
    }
    expect(page.match(/import OpenPencilModal /g)).toHaveLength(1)
    expect(page.match(/import OpenPencilDropdownMenu /g)).toHaveLength(1)
    expect(page.match(/import OpenPencilSlideMenu /g)).toHaveLength(1)
    expect(page.match(/import OpenPencilUploadButton /g)).toHaveLength(1)
    expect(page).toContain('<OpenPencilModal :config="__opModuleConfig_')
    expect(page).toContain('<OpenPencilDropdownMenu :config="__opModuleConfig_')
    expect(page).toContain('<OpenPencilSlideMenu :config="__opModuleConfig_')
    expect(page).toContain('<OpenPencilUploadButton :config="__opModuleConfig_')
    expect(page).toContain('Authored trigger 1')
    expect(page).toContain('</OpenPencilModal>')
    expectCompilableSfc(page, 'src/pages/index.vue')
    maybeWriteVerificationProject(output.files)
  })

  test('emits accessible focus-managed overlays and a local-only upload boundary', () => {
    const graph = makeSceneGraph('Modules')
    const pageId = firstPageId(graph)
    graph.createNode('FRAME', pageId, createModalModuleFrameOverrides())
    graph.createNode('FRAME', pageId, createDropdownMenuModuleFrameOverrides())
    graph.createNode('FRAME', pageId, createSlideMenuModuleFrameOverrides())
    graph.createNode('FRAME', pageId, createUploadButtonModuleFrameOverrides())
    const files = compile({ graph, pageIds: [pageId], options: vueOptions() }).files
    const layer = textFile(files, 'src/__openpencil_layer.ts')
    const modal = textFile(files, 'src/__openpencil_modal.vue')
    const dropdown = textFile(files, 'src/__openpencil_dropdown_menu.vue')
    const slide = textFile(files, 'src/__openpencil_slide_menu.vue')
    const upload = textFile(files, 'src/__openpencil_upload_button.vue')

    expect(layer).toContain('registerOpenPencilLayer')
    expect(layer).toContain('trapOpenPencilLayerTab')
    expect(layer).toContain('restoreFocus')
    expect(layer).toContain("url.protocol === 'https:'")
    expect(layer).not.toContain("url.protocol === 'http:'")
    expect(modal).toContain('aria-modal="true"')
    expect(modal).toContain('role="dialog"')
    expect(modal).toContain("event.key === 'Escape'")
    expect(modal).toContain('trapOpenPencilLayerTab')
    expect(modal).toContain('data-openpencil-modal-authored-trigger=""')
    expect(modal).toContain("const authoredTriggerId = baseId + '-authored-trigger'")
    expect(modal).toContain("const triggerFallbackId = baseId + '-trigger-fallback'")
    expect(modal).toContain(
      ':aria-labelledby="$slots.default ? authoredTriggerLabelledBy : undefined"'
    )
    expect(slide).toContain('aria-modal="true"')
    expect(slide).toContain('data-openpencil-slide-menu-authored-trigger=""')
    expect(slide).toContain(':id="authoredTriggerId"')
    expect(slide).toContain(':id="triggerFallbackId"')
    expect(slide).toContain('safeOpenPencilHref')
    expect(dropdown).toContain('role="menu"')
    expect(dropdown).toContain('role="menuitem"')
    expect(dropdown).toContain("event.key === 'ArrowDown'")
    expect(dropdown).toContain("event.key === 'Tab'")
    expect(dropdown).toContain('safeOpenPencilHref')
    expect(dropdown).toContain(':id="authoredTriggerId"')
    expect(dropdown).toContain(':id="triggerFallbackId"')
    expect(upload).toContain('type="file"')
    expect(upload).toContain(':aria-label="$slots.default ? undefined : config.triggerLabel"')
    expect(upload).toContain(':id="authoredTriggerId"')
    expect(upload).toContain(':id="triggerFallbackId"')
    for (const runtime of [modal, dropdown, slide, upload]) {
      expect(runtime).toContain(
        "const authoredTriggerLabelledBy = authoredTriggerId + ' ' + triggerFallbackId"
      )
      expect(runtime).toContain('class="openpencil-trigger-fallback"')
      expect(runtime).toContain(':aria-label="$slots.default ? undefined : config.triggerLabel"')
      expect(runtime).toContain(
        ':aria-labelledby="$slots.default ? authoredTriggerLabelledBy : undefined"'
      )
      expect(runtime).not.toContain('innerHTML')
      expect(runtime).not.toContain('textContent')
    }
    expect(upload).toContain('Files have not been uploaded.')
    expect(upload).toContain('matchesAccept')
    expect(upload).toContain('Folders are not supported by this local file control.')
    expect(upload).not.toContain('fetch(')
    expect(upload).not.toContain('XMLHttpRequest')
    expect(upload).not.toContain('WebSocket')
    expect(upload).not.toContain('FileReader')
    expect(upload).not.toContain('createObjectURL')
    expect(upload).not.toContain('localStorage')
    expect(upload).not.toContain('indexedDB')
  })

  test('keeps unimplemented trusted modules fail-closed as static shells', () => {
    const unsupported: IRElement = {
      kind: 'element',
      sourceId: 'table-module',
      tag: 'div',
      className: 'w-40',
      attrs: {},
      children: [{ kind: 'text', sourceId: 'fallback-copy', value: 'Static table fallback' }],
      module: {
        pluginId: 'open-pencil.table',
        moduleType: 'table',
        configVersion: 1,
        payload: {}
      }
    }
    const output = vueAdapter.emit([minimalIr([unsupported])], vueOptions())
    const page = textFile(output.files, 'src/pages/index.vue')

    expect(output.warnings).toContainEqual(
      expect.objectContaining({ code: 'vue-module-unsupported', nodeId: 'table-module' })
    )
    expect(page).toContain('<div class="w-40"')
    expect(page).toContain('Static table fallback')
    expect([...output.files.keys()].some((path) => path.includes('table'))).toBe(false)
  })

  test('deduplicates runtimes while keeping instance state inside each SFC setup', () => {
    const modal = (sourceId: string): IRElement => ({
      kind: 'element',
      sourceId,
      tag: 'div',
      className: '',
      attrs: {},
      children: [],
      module: {
        pluginId: 'open-pencil.modal',
        moduleType: 'modal',
        configVersion: 1,
        payload: {
          triggerLabel: 'Open modal',
          showTriggerIcon: true,
          showTriggerLabel: true,
          title: 'Title',
          content: 'Content',
          showCloseButton: true,
          closeOnBackdrop: true,
          closeOnEscape: true,
          showCancelButton: true,
          cancelLabel: 'Cancel',
          showConfirmButton: true,
          confirmLabel: 'Confirm',
          panelWidth: 520,
          footerAlign: 'right',
          panelBackground: '#FFFFFF',
          textColor: '#111827',
          accentColor: '#2563EB',
          overlayOpacity: 0.45
        }
      }
    })
    const output = vueAdapter.emit([minimalIr([modal('one'), modal('two')])], vueOptions())
    const page = textFile(output.files, 'src/pages/index.vue')
    const runtime = textFile(output.files, 'src/__openpencil_modal.vue')

    expect(page.match(/import OpenPencilModal /g)).toHaveLength(1)
    expect(page.match(/<OpenPencilModal /g)).toHaveLength(2)
    expect(
      [...output.files.keys()].filter((path) => path === 'src/__openpencil_modal.vue')
    ).toHaveLength(1)
    expect(runtime).toContain('const open = ref(false)')
    expect(runtime).toContain("const token = Symbol('open-pencil-modal')")
  })
})
