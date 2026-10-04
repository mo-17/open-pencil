import { describe, expect, test } from 'bun:test'

import { createEditor } from '@open-pencil/core/editor'
import {
  LOWCODE_APPLICATION_PAGE_PLUGIN_KEY,
  LOWCODE_APPLICATION_PLUGIN_KEY
} from '@open-pencil/lowcode'

import { readApplicationMode } from '@/app/lowcode/application-mode/model'
import {
  setApplicationEnabled,
  setApplicationEntry,
  setApplicationRole,
  setApplicationRoute,
  setApplicationStart
} from '@/app/lowcode/application-mode/mutation'

function fixture() {
  const editor = createEditor()
  const page = editor.graph.getPages()[0]
  const root = editor.graph.getNode(editor.graph.rootId)
  if (!root) throw new Error('Missing document')
  const frame = editor.graph.createNode('FRAME', page.id, {
    name: 'Mobile page',
    width: 390,
    height: 844
  })
  const label = editor.graph.createNode('TEXT', frame.id, { text: 'Keep design content' })
  return { editor, root, page, frame, label }
}

function configured() {
  const data = fixture()
  setApplicationEnabled(data.editor, true, 'Application pages')
  setApplicationRole(data.editor, data.page, 'application', 'Page role')
  setApplicationEntry(data.editor, data.page, data.frame.id, 'Entry frame')
  return data
}

describe('application start page route UX', () => {
  test('dynamic page routes remain editable but cannot be selected as a supported start page', () => {
    const { editor, page, root } = configured()
    expect(setApplicationRoute(editor, page, '/products/:id', 'Route')).toBe(true)
    const before = structuredClone(root.lowcodeApplication)
    const view = readApplicationMode(editor)
    expect(view.starts).toEqual([{ value: page.id, label: page.name, disabled: true }])
    expect(view.startRouteInvalid).toBe(true)
    expect(setApplicationStart(editor, page.id, 'Start')).toBe(false)
    expect(root.lowcodeApplication).toEqual(before)
    expect(page.lowcodeRoutePattern).toBe('/products/:id')
  })

  test('an existing invalid homepage is read without mutation and can be repaired in one undo', () => {
    const { editor, page, root } = configured()
    editor.graph.updateNode(page.id, { lowcodeRoutePattern: '/products/:id' })
    editor.graph.updateNode(root.id, {
      lowcodeApplication: { version: 1, enabled: true, startPageId: page.id }
    })
    const home = editor.graph.createNode('CANVAS', root.id, { name: 'Static home' })
    const entry = editor.graph.createNode('FRAME', home.id, { width: 360, height: 740 })
    editor.graph.updateNode(home.id, {
      lowcodeApplicationPage: { version: 1, role: 'application', entryNodeId: entry.id },
      lowcodeRoutePattern: '/home'
    })
    const before = JSON.stringify([...editor.graph.getAllNodes()])
    const view = readApplicationMode(editor)
    expect(view.startId).toBe(page.id)
    expect(view.startRouteInvalid).toBe(true)
    expect(view.starts).toEqual([
      { value: page.id, label: page.name, disabled: true },
      { value: home.id, label: home.name }
    ])
    expect(JSON.stringify([...editor.graph.getAllNodes()])).toBe(before)
    expect(setApplicationStart(editor, home.id, 'Repair start')).toBe(true)
    expect(readApplicationMode(editor).startRouteInvalid).toBe(false)
    editor.undo.undo()
    expect(root.lowcodeApplication?.startPageId).toBe(page.id)
    expect(readApplicationMode(editor).startRouteInvalid).toBe(true)
  })

  test('unsupported start routes remain visible until their route is repaired or mode is disabled', () => {
    const { editor, page, root } = configured()
    for (const route of ['/files/*', '/home?tab=details', '/home#top']) {
      expect(setApplicationRoute(editor, page, route, 'Route')).toBe(true)
      expect(readApplicationMode(editor).startRouteInvalid).toBe(true)
      expect(setApplicationStart(editor, page.id, 'Start')).toBe(false)
    }
    expect(setApplicationRoute(editor, page, '/home', 'Repair route')).toBe(true)
    expect(readApplicationMode(editor).startRouteInvalid).toBe(false)
    expect(setApplicationStart(editor, page.id, 'Start')).toBe(true)
    expect(setApplicationRoute(editor, page, '/products/:id', 'Dynamic route')).toBe(true)
    expect(readApplicationMode(editor).startRouteInvalid).toBe(true)
    expect(setApplicationEnabled(editor, false, 'Design mode')).toBe(true)
    expect(readApplicationMode(editor).startRouteInvalid).toBe(false)
    expect(root.lowcodeApplication?.startPageId).toBe(page.id)
    expect(page.lowcodeRoutePattern).toBe('/products/:id')
  })

  test('selection rechecks an external route change and an unset page route remains static', () => {
    const { editor, page } = configured()
    expect(readApplicationMode(editor).startRouteInvalid).toBe(false)
    expect(readApplicationMode(editor).starts).toEqual([{ value: page.id, label: page.name }])
    editor.graph.updateNode(page.id, { lowcodeRoutePattern: '/products/:id' })
    expect(setApplicationStart(editor, page.id, 'Late start')).toBe(false)
    expect(setApplicationRoute(editor, page, '', 'Derived route')).toBe(true)
    expect(readApplicationMode(editor).startRouteInvalid).toBe(false)
    expect(setApplicationStart(editor, page.id, 'Start')).toBe(true)
  })
})

describe('application mode workflows', () => {
  test('default reads are inert; enabling does not classify or reparent any page', () => {
    const { editor, root, page, frame, label } = fixture()
    const design = structuredClone([page, frame, label])
    expect(readApplicationMode(editor).enabled).toBe(false)
    expect(readApplicationMode(editor).role).toBe('')
    expect(root.lowcodeApplication).toBeUndefined()
    expect(setApplicationEnabled(editor, true, 'Application pages')).toBe(true)
    expect(root.lowcodeApplication).toEqual({ version: 1, enabled: true })
    expect([page, frame, label]).toEqual(design)
    expect(setApplicationEnabled(editor, true, 'Application pages')).toBe(false)
    editor.undo.undo()
    expect(root.lowcodeApplication).toBeUndefined()
    expect([page, frame, label]).toEqual(design)
    editor.undo.redo()
    expect(root.lowcodeApplication?.enabled).toBe(true)
  })

  test.each(['application', 'reference', 'components'] as const)(
    '%s role is an explicit reversible page-only edit',
    (role) => {
      const { editor, page, frame, label } = fixture()
      setApplicationEnabled(editor, true, 'Application pages')
      const design = structuredClone([frame, label])
      expect(setApplicationRole(editor, page, role, 'Page role')).toBe(true)
      expect(page.lowcodeApplicationPage).toEqual({ version: 1, role })
      expect([frame, label]).toEqual(design)
      editor.undo.undo()
      expect(page.lowcodeApplicationPage).toBeUndefined()
      editor.undo.redo()
      expect(page.lowcodeApplicationPage?.role).toBe(role)
    }
  )

  test('entry and start choices require explicit application classification and are reversible', () => {
    const { editor, page, frame } = fixture()
    expect(setApplicationEntry(editor, page, frame.id, 'Entry')).toBe(false)
    setApplicationEnabled(editor, true, 'Application pages')
    expect(setApplicationStart(editor, page.id, 'Start')).toBe(false)
    setApplicationRole(editor, page, 'application', 'Role')
    expect(setApplicationStart(editor, page.id, 'Start')).toBe(false)
    expect(setApplicationEntry(editor, page, frame.id, 'Entry')).toBe(true)
    expect(readApplicationMode(editor).starts).toEqual([{ value: page.id, label: page.name }])
    expect(setApplicationStart(editor, page.id, 'Start')).toBe(true)
    expect(readApplicationMode(editor).startId).toBe(page.id)
    editor.undo.undo()
    expect(readApplicationMode(editor).startId).toBe('')
    editor.undo.redo()
    expect(readApplicationMode(editor).startId).toBe(page.id)
    expect(setApplicationEntry(editor, page, '', 'Clear entry')).toBe(true)
    expect(page.lowcodeApplicationPage).toEqual({ version: 1, role: 'application' })
    expect(readApplicationMode(editor).invalid).toBe(true)
    expect(readApplicationMode(editor).starts).toEqual([])
    editor.undo.undo()
    expect(page.lowcodeApplicationPage?.entryNodeId).toBe(frame.id)
  })

  test('only direct, visible, writable page Frames are offered or accepted', () => {
    const { editor, page, frame } = configured()
    const nested = editor.graph.createNode('FRAME', frame.id)
    const component = editor.graph.createNode('COMPONENT', page.id)
    const componentFrame = editor.graph.createNode('FRAME', component.id)
    const second = editor.graph.createNode('CANVAS', editor.graph.rootId)
    const foreign = editor.graph.createNode('FRAME', second.id)
    const hidden = editor.graph.createNode('FRAME', page.id, { visible: false })
    const locked = editor.graph.createNode('FRAME', page.id, { locked: true })
    const internal = editor.graph.createNode('FRAME', page.id, { internalOnly: true })
    const library = editor.graph.createNode('FRAME', page.id, { libraryReadonly: true })
    const libraryLinked = editor.graph.createNode('FRAME', page.id, { libraryId: 'remote-library' })
    expect(readApplicationMode(editor).entries).toEqual([{ value: frame.id, label: frame.name }])
    for (const node of [
      nested,
      component,
      componentFrame,
      foreign,
      hidden,
      locked,
      internal,
      library,
      libraryLinked
    ]) {
      expect(setApplicationEntry(editor, page, node.id, 'Entry')).toBe(false)
    }
    expect(page.lowcodeApplicationPage?.entryNodeId).toBe(frame.id)
  })

  test('hidden pages cannot supply application entry or start choices', () => {
    const { editor, page, frame } = configured()
    editor.graph.updateNode(page.id, { visible: false })
    expect(readApplicationMode(editor).entries).toEqual([])
    expect(readApplicationMode(editor).starts).toEqual([])
    expect(setApplicationEntry(editor, page, frame.id, 'Entry')).toBe(false)
    expect(setApplicationStart(editor, page.id, 'Start')).toBe(false)
  })

  test.each(['locked', 'internalOnly', 'libraryReadonly'] as const)(
    '%s page/document guards reject mutations',
    (field) => {
      for (const owner of ['page', 'root']) {
        const { editor, root, page, frame } = configured()
        editor.graph.updateNode(owner === 'page' ? page.id : root.id, { [field]: true })
        expect(setApplicationRole(editor, page, 'reference', 'Role')).toBe(false)
        expect(setApplicationEntry(editor, page, frame.id, 'Entry')).toBe(false)
        expect(setApplicationRoute(editor, page, '/changed', 'Route')).toBe(false)
        expect(setApplicationStart(editor, page.id, 'Start')).toBe(false)
        if (owner === 'root') expect(setApplicationEnabled(editor, false, 'Mode')).toBe(false)
      }
    }
  )

  test('explicit document/page replacement clears only its reserved inert key in the same undo', () => {
    const { editor, root, page } = fixture()
    const other = { pluginId: 'other', key: 'keep', value: 'opaque' }
    const rawRoot = {
      pluginId: 'open-pencil',
      key: LOWCODE_APPLICATION_PLUGIN_KEY,
      value: '{"version":2}'
    }
    const rawPage = {
      pluginId: 'open-pencil',
      key: LOWCODE_APPLICATION_PAGE_PLUGIN_KEY,
      value: '{"version":2}'
    }
    editor.graph.updateNode(root.id, { pluginData: [other, rawRoot] })
    editor.graph.updateNode(page.id, { pluginData: [other, rawPage] })
    expect(readApplicationMode(editor).invalid).toBe(true)
    setApplicationEnabled(editor, true, 'Mode')
    expect(root.pluginData).toEqual([other])
    expect(page.pluginData).toEqual([other, rawPage])
    editor.undo.undo()
    expect(root.pluginData).toEqual([other, rawRoot])
    expect(root.lowcodeApplication).toBeUndefined()
    editor.undo.redo()
    setApplicationRole(editor, page, 'reference', 'Role')
    expect(page.pluginData).toEqual([other])
    editor.undo.undo()
    expect(page.pluginData).toEqual([other, rawPage])
    expect(page.lowcodeApplicationPage).toBeUndefined()
  })

  test('future configuration is inert until an explicit replacement; design mode preserves choices', () => {
    const { editor, root, page, frame } = fixture()
    const future = { version: 2, enabled: true }
    Reflect.set(root, 'lowcodeApplication', future)
    const view = readApplicationMode(editor)
    expect(view.enabled).toBe(false)
    expect(view.invalid).toBe(true)
    expect(root.lowcodeApplication).toBe(future)
    setApplicationEnabled(editor, true, 'Replace mode')
    setApplicationRole(editor, page, 'application', 'Role')
    setApplicationEntry(editor, page, frame.id, 'Entry')
    setApplicationStart(editor, page.id, 'Start')
    const savedPage = structuredClone(page.lowcodeApplicationPage)
    setApplicationEnabled(editor, false, 'Mode')
    expect(root.lowcodeApplication).toEqual({ version: 1, enabled: false, startPageId: page.id })
    expect(page.lowcodeApplicationPage).toEqual(savedPage)
    expect(readApplicationMode(editor).enabled).toBe(false)
  })

  test('routes reuse internal-route validation and empty input clears only the authored path', () => {
    const { editor, page } = configured()
    expect(setApplicationRoute(editor, page, '/products/:id', 'Route')).toBe(true)
    expect(page.lowcodeRoutePattern).toBe('/products/:id')
    for (const route of [
      'https://example.test',
      '//external.test',
      '/back\\slash',
      '/control\n',
      'x'.repeat(2049)
    ]) {
      expect(setApplicationRoute(editor, page, route, 'Route')).toBe(false)
    }
    expect(page.lowcodeRoutePattern).toBe('/products/:id')
    expect(setApplicationRoute(editor, page, '', 'Route')).toBe(true)
    expect(page.lowcodeRoutePattern).toBeUndefined()
    editor.undo.undo()
    expect(page.lowcodeRoutePattern).toBe('/products/:id')
    expect(setApplicationRoute(editor, page, '/products/:id', 'Route')).toBe(false)
  })

  test('explicit role/start reset removes only that configuration in one undo', () => {
    const { editor, root, page, frame } = configured()
    setApplicationStart(editor, page.id, 'Start')
    expect(setApplicationStart(editor, '', 'Default start')).toBe(true)
    expect(root.lowcodeApplication).toEqual({ version: 1, enabled: true })
    editor.undo.undo()
    expect(root.lowcodeApplication?.startPageId).toBe(page.id)
    expect(setApplicationRole(editor, page, '', 'Unassign page')).toBe(true)
    expect(page.lowcodeApplicationPage).toBeUndefined()
    expect(root.lowcodeApplication?.startPageId).toBe(page.id)
    editor.undo.undo()
    expect(page.lowcodeApplicationPage).toEqual({
      version: 1,
      role: 'application',
      entryNodeId: frame.id
    })
  })
})
