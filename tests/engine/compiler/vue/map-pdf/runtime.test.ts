import { expect, test } from 'bun:test'

import { MAP_VUE_MODULE_ADAPTER } from '#compiler/adapters/vue/modules/map'
import { buildOpenPencilVuePDFViewer } from '#compiler/adapters/vue/modules/pdf-viewer'

import { createMapModuleInstance, createPDFViewerModuleInstance } from '@open-pencil/core/plugins'

import {
  findModuleNodes,
  mountModuleRuntime,
  withModuleRuntime
} from '#tests/helpers/compiler/modules/map-pdf/runtime'

test('Vue Map shares its reviewed local runtime, fixed origin, marker text, and complete lifetime disposal', async () => {
  const base = createMapModuleInstance({
    style: 'dark',
    interactive: false,
    markers: [{ id: 'venue', lng: 121, lat: 31, label: '<img src=x onerror=alert(1)>' }]
  }).config
  await withModuleRuntime(MAP_VUE_MODULE_ADAPTER.buildRuntime(), async (component, state) => {
    const runtime = mountModuleRuntime(component, base)
    try {
      await runtime.settle()
      expect(state.maps).toHaveLength(1)
      const first = state.maps[0]
      expect(first.options.interactive).toBe(false)
      expect(first.disabled).toHaveLength(7)
      expect(first.options.maxZoom).toBe(19)
      expect(first.options.style).toMatchObject({
        sources: {
          openstreetmap: { tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'], maxzoom: 19 }
        }
      })
      expect(first.canvas.style.filter).toContain('invert')
      expect(state.markers[0].popup?.label.textContent).toBe('<img src=x onerror=alert(1)>')
      expect(findModuleNodes(runtime.root, 'span').map((node) => node.text)).toContain(
        'Authored overlay'
      )

      runtime.config.value = structuredClone(base)
      runtime.revision.value++
      await runtime.settle()
      expect(state.maps).toHaveLength(1)
      runtime.config.value = { ...base, zoom: 12, markers: [] }
      await runtime.settle()
      expect(first.removed).toBe(1)
      expect(state.markers[0].removed).toBe(1)
      expect(first.canvas.listeners.has('webglcontextlost')).toBe(false)
      expect(state.maps).toHaveLength(2)
      runtime.mounted.value = false
      await runtime.settle()
      expect(state.maps[1].removed).toBe(1)
      runtime.mounted.value = true
      await runtime.settle()
      expect(state.maps).toHaveLength(3)
    } finally {
      runtime.dispose()
    }
    expect(state.maps.map((map) => map.removed)).toEqual([1, 1, 1])
  })
})

test('Map invalid config and context loss preserve overlays, release partial markers, and never instantiate unsafe data', async () => {
  const base = createMapModuleInstance({ markers: [{ id: 'venue', lng: 0, lat: 0 }] }).config
  await withModuleRuntime(MAP_VUE_MODULE_ADAPTER.buildRuntime(), async (component, state) => {
    const runtime = mountModuleRuntime(component, { ...base, provider: 'unsafe' })
    try {
      await runtime.settle()
      expect(state.maps).toHaveLength(0)
      expect(
        findModuleNodes(runtime.root, 'div').some(
          (node) => node.props.role === 'status' && node.text === 'Map unavailable'
        )
      ).toBe(true)
      runtime.config.value = base
      await runtime.settle()
      const active = state.maps[0]
      const event = new Event('webglcontextlost', { cancelable: true })
      active.canvas.listeners.get('webglcontextlost')?.(event)
      await runtime.settle()
      expect(event.defaultPrevented).toBe(true)
      expect(active.removed).toBe(1)
      expect(state.markers[0].removed).toBe(1)
      expect(findModuleNodes(runtime.root, 'span').map((node) => node.text)).toContain(
        'Authored overlay'
      )
      state.throwMarker = true
      runtime.config.value = { ...base, zoom: 10 }
      await runtime.settle()
      expect(state.maps[1].removed).toBe(1)
      expect(state.markers[1].removed).toBe(1)
      runtime.config.value = {
        ...base,
        markers: [
          { id: 'same', lng: 0, lat: 0 },
          { id: 'same', lng: 0, lat: 0 }
        ]
      }
      await runtime.settle()
      expect(state.maps).toHaveLength(2)
    } finally {
      runtime.dispose()
    }
  })
})

test('Vue development PDF requires a user activation and revokes it on every source change and remount', async () => {
  const base = createPDFViewerModuleInstance({
    sourceUrl: '/fixtures/initial.pdf',
    title: '<b>Plain document</b>',
    initialPage: 2,
    pageCountHint: 4,
    allowDownload: true
  }).config
  await withModuleRuntime(buildOpenPencilVuePDFViewer({ devMode: true }), async (component) => {
    const runtime = mountModuleRuntime(component, base)
    const activate = async () => {
      const button = findModuleNodes(runtime.root, 'button')[0]
      const callback = button?.props.onClick
      if (typeof callback !== 'function') throw new Error('Missing PDF activation button')
      callback()
      await runtime.settle()
    }
    try {
      await runtime.settle()
      expect(findModuleNodes(runtime.root, 'iframe')).toHaveLength(0)
      expect(findModuleNodes(runtime.root, 'a')).toHaveLength(0)
      await activate()
      const frame = findModuleNodes(runtime.root, 'iframe')[0]
      expect(frame.props.src).toBe('/fixtures/initial.pdf#page=2&view=FitH&toolbar=1')
      expect(frame.props.sandbox).toBe('')
      expect(frame.props.referrerpolicy).toBe('no-referrer')
      expect(frame.props.title).toBe('<b>Plain document</b>')
      expect(findModuleNodes(runtime.root, 'a')[0].props).toMatchObject({
        href: '/fixtures/initial.pdf',
        target: '_blank',
        rel: 'noopener noreferrer'
      })
      runtime.config.value = structuredClone(base)
      runtime.revision.value++
      await runtime.settle()
      expect(findModuleNodes(runtime.root, 'iframe')).toHaveLength(1)
      runtime.config.value = { ...base, sourceUrl: '/fixtures/alternate.pdf' }
      await runtime.settle()
      expect(findModuleNodes(runtime.root, 'iframe')).toHaveLength(0)
      runtime.config.value = base
      await runtime.settle()
      expect(findModuleNodes(runtime.root, 'iframe')).toHaveLength(0)
      await activate()
      runtime.mounted.value = false
      await runtime.settle()
      runtime.mounted.value = true
      await runtime.settle()
      expect(findModuleNodes(runtime.root, 'iframe')).toHaveLength(0)
      expect(findModuleNodes(runtime.root, 'span').map((node) => node.text)).toContain(
        'Authored overlay'
      )
    } finally {
      runtime.dispose()
    }
  })
})

test('Vue production PDF projects page-fit and toolbar policy with empty-source and download gates', async () => {
  const base = createPDFViewerModuleInstance({
    sourceUrl: 'https://assets.example.com/document.pdf',
    fit: 'page',
    showToolbar: false
  }).config
  await withModuleRuntime(buildOpenPencilVuePDFViewer({ devMode: false }), async (component) => {
    const runtime = mountModuleRuntime(component, base)
    try {
      await runtime.settle()
      expect(findModuleNodes(runtime.root, 'iframe')[0].props.src).toBe(
        'https://assets.example.com/document.pdf#page=1&view=Fit&toolbar=0'
      )
      expect(findModuleNodes(runtime.root, 'button')).toHaveLength(0)
      expect(findModuleNodes(runtime.root, 'a')).toHaveLength(0)
      runtime.config.value = { ...base, sourceUrl: '' }
      await runtime.settle()
      expect(findModuleNodes(runtime.root, 'iframe')).toHaveLength(0)
      expect(findModuleNodes(runtime.root, 'span').map((node) => node.text)).toContain(
        'Choose a PDF source in OpenPencil.'
      )
    } finally {
      runtime.dispose()
    }
  })
})
