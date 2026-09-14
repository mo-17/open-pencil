import { describe, expect, test } from 'bun:test'

import type { SceneGraph, SceneNode } from '@open-pencil/scene-graph'

import { businessTemplateDefinition } from '@/app/lowcode/backend/business/definitions'
import { BUSINESS_TEMPLATE_IDS } from '@/app/lowcode/backend/business/model/types'
import { preflightBusinessPages } from '@/app/lowcode/backend/business/pages/preflight'
import { createBusinessPages } from '@/app/lowcode/backend/business/template'
import type {
  BusinessActionDefinition,
  BusinessTemplateDefinition
} from '@/app/lowcode/backend/business/types'
import { readBackendProviderDocumentRequest } from '@/app/lowcode/backend/document'

import { businessBrowserFixture } from './browser/helpers'

function rectangles(graph: SceneGraph, pageId: string) {
  const result: { node: SceneNode; left: number; top: number; right: number; bottom: number }[] = []
  const visit = (id: string, left: number, top: number) => {
    for (const child of graph.getChildren(id)) {
      const x = left + child.x
      const y = top + child.y
      result.push({
        node: child,
        left: x,
        top: y,
        right: x + child.width,
        bottom: y + child.height
      })
      visit(child.id, x, y)
    }
  }
  visit(pageId, 0, 0)
  return result
}

function replaceFirstAction(
  definition: BusinessTemplateDefinition,
  update: (action: BusinessActionDefinition) => BusinessActionDefinition
): BusinessTemplateDefinition {
  return {
    ...definition,
    pages: definition.pages.map((page, index) =>
      index === 0
        ? {
            ...page,
            actions: page.actions.map((action, actionIndex) =>
              actionIndex === 0 ? update(action) : action
            )
          }
        : page
    )
  }
}

describe('business template generated pages', () => {
  for (const kind of BUSINESS_TEMPLATE_IDS)
    for (const locale of ['en', 'zh-CN'])
      test(`${kind} ${locale} keeps footer errors and controls within the real page geometry`, async () => {
        const value = await businessBrowserFixture(kind, 'react')
        value.editor.undo.undo()
        const result = createBusinessPages(
          value.editor,
          value.descriptor,
          value.application,
          kind,
          locale
        )
        for (const pageId of result.pageIds) {
          const page = value.graph.getNode(pageId)
          if (!page) throw new Error('Missing generated page')
          const entries = rectangles(value.graph, pageId)
          const errors = entries.filter(
            (entry) =>
              entry.node.bindings?.text?.kind === 'docState' &&
              entry.node.bindings.text.docStateName?.endsWith('Error')
          )
          expect(errors).toHaveLength(1)
          const error = errors[0]
          expect(error.node.renderCondition).toBeTruthy()
          expect(error.bottom).toBeLessThanOrEqual(page.height)
          const controls = entries.filter((entry) =>
            ['BUTTON', 'FORM', 'INPUT', 'TEXTAREA', 'SELECT'].includes(entry.node.type)
          )
          for (const control of controls) {
            expect(control.bottom).toBeLessThanOrEqual(page.height)
            const overlaps =
              error.left < control.right + 8 &&
              error.right > control.left - 8 &&
              error.top < control.bottom + 8 &&
              error.bottom > control.top - 8
            expect(overlaps).toBe(false)
          }
        }
        const sources = [...value.graph.getAllNodes()].filter((node) => node.type === 'LIST')
        expect(sources.length).toBeGreaterThan(0)
        expect(
          sources.every((node) => node.interactiveProps?.dataSourceRef?.kind === 'backendResource')
        ).toBe(true)
      })

  test('reads complete article bodies in a scrollable detail and coerces numeric fields in both targets', async () => {
    for (const target of ['react', 'vue'] as const) {
      const content = await businessBrowserFixture('content-knowledge-base', target)
      const body = [...content.graph.getAllNodes()].filter(
        (node) =>
          node.bindings?.text?.kind === 'expr' &&
          node.bindings.text.expr?.includes('SelectedRecord.body')
      )
      expect(body).toHaveLength(4)
      expect(
        body.every(
          (node) =>
            node.height === 320 &&
            node.interactiveProps?.layout?.overflowY === 'auto' &&
            node.interactiveProps.layout.whiteSpace === 'pre-wrap'
        )
      ).toBe(true)
      expect(
        [...content.output.files.values()].some((source) => source.includes('whitespace-pre-wrap'))
      ).toBe(true)
      const booking = await businessBrowserFixture('booking-registration', target)
      const inputLine = [...booking.output.files.values()]
        .flatMap((source) => source.split('\n'))
        .find(
          (line) =>
            line.includes('<input') &&
            line.includes('placeholder=') &&
            line.includes('Number of places')
        )
      expect(inputLine).toContain('type="number"')
    }
  })

  test('preflight rejects unknown commands, missing parameters and unsupported relation identities', async () => {
    const { application } = await businessBrowserFixture('customer-crm', 'react')
    const definition = businessTemplateDefinition('customer-crm')
    expect(() =>
      preflightBusinessPages(
        application,
        replaceFirstAction(definition, (action) => ({ ...action, commandId: 'unreviewed-command' }))
      )
    ).toThrow('unknown command')
    expect(() =>
      preflightBusinessPages(
        application,
        replaceFirstAction(definition, (action) => ({ ...action, parameters: {} }))
      )
    ).toThrow('parameters must match')
    const badRelation = {
      ...definition,
      pages: definition.pages.map((page) => ({
        ...page,
        actions: page.actions.map((action) => ({
          ...action,
          inputs: action.inputs.map((input) =>
            input.relation
              ? { ...input, relation: { ...input.relation, valueField: 'secret' } }
              : input
          )
        }))
      }))
    }
    expect(() => preflightBusinessPages(application, badRelation)).toThrow('relation identity')
    const badField = {
      ...definition,
      pages: definition.pages.map((page) =>
        page.listing
          ? {
              ...page,
              listing: { ...page.listing, columns: [{ field: 'unexposed', label: page.title }] }
            }
          : page
      )
    }
    expect(() => preflightBusinessPages(application, badField)).toThrow('unknown visible field')
  })

  test('a previous article selection stays hidden until this page reads it and navigation clears it', async () => {
    const value = await businessBrowserFixture('content-knowledge-base', 'react')
    const page = value.graph
      .getPages()
      .find((entry) => entry.lowcodeRoutePattern === value.paths.knowledge)
    if (!page) throw new Error('Missing public knowledge page')
    const ready = page.state?.find((state) => state.name.includes('SelectionReady'))
    if (!ready) throw new Error('Missing mounted-page selection state')
    expect(ready.defaultValue).toBe(false)
    const nodes = rectangles(value.graph, page.id).map((entry) => entry.node)
    const body = nodes.find(
      (node) =>
        node.bindings?.text?.kind === 'expr' &&
        node.bindings.text.expr?.endsWith('SelectedRecord.body')
    )
    expect(body?.renderCondition).toContain(ready.name)
    expect(body?.renderCondition).toContain('$currentUser.generation')
    const choose = nodes.find((node) => node.name === 'Select record')
    const read = choose?.events?.onClick?.find((action) => action.kind === 'backendRequest')
    if (read?.kind !== 'backendRequest') throw new Error('Missing explicit detail read')
    expect(read.onSuccess).toContainEqual(
      expect.objectContaining({ kind: 'setState', targetStateId: ready.id, valueExpr: '!0' })
    )
    const navigation = nodes.filter((node) =>
      node.events?.onClick?.some((action) => action.kind === 'navigate')
    )
    expect(navigation.length).toBeGreaterThan(1)
    for (const node of navigation) {
      const actions = node.events?.onClick ?? []
      expect(actions.at(-1)?.kind).toBe('navigate')
      expect(actions).toContainEqual(
        expect.objectContaining({ kind: 'setVariable', targetName: read.resultTarget })
      )
      expect(actions).toContainEqual(
        expect.objectContaining({ kind: 'setState', targetStateId: ready.id, valueExpr: '!1' })
      )
      expect(actions.some((action) => action.kind === 'backendCommandRecovery')).toBe(false)
    }
  })

  test('leaving the writing desk clears its draft fields without acknowledging requests', async () => {
    const value = await businessBrowserFixture('content-knowledge-base', 'react')
    const writing = value.graph
      .getPages()
      .find((entry) => entry.lowcodeRoutePattern === value.paths.articles)
    if (!writing) throw new Error('Missing writing page')
    const writingNodes = rectangles(value.graph, writing.id).map((entry) => entry.node)
    const panels = writingNodes.filter((node) => node.name.endsWith(' panel'))
    expect(panels.length).toBeGreaterThan(0)
    expect(panels.every((node) => node.renderCondition?.includes('$currentUser.generation'))).toBe(
      true
    )
    const form = writingNodes.find(
      (node) => node.type === 'INPUT' && node.interactiveProps?.placeholder === 'Article title'
    )
    if (form?.bindings?.value?.kind !== 'ref') throw new Error('Missing article title control')
    const leave = writingNodes.find((node) =>
      node.events?.onClick?.some((action) => action.kind === 'navigate')
    )
    expect(leave?.events?.onClick).toContainEqual(
      expect.objectContaining({
        kind: 'setState',
        targetStateId: form.bindings.value.stateId,
        valueExpr: '""'
      })
    )
  })

  test('invalid model and a graph write failure leave no nodes, Backend document or undo entry', async () => {
    const value = await businessBrowserFixture('customer-crm', 'react')
    value.editor.undo.undo()
    const before = value.editor.snapshotDocument()
    const invalid = structuredClone(value.application)
    if (!invalid.commands) throw new Error('Missing commands')
    invalid.commands.commands = invalid.commands.commands.filter(
      (command) => command.id !== 'create-customer'
    )
    expect(() =>
      createBusinessPages(value.editor, value.descriptor, invalid, 'customer-crm')
    ).toThrow('unknown command')
    expect(value.editor.documentSnapshotChanged(before)).toBe(false)
    let writes = 0
    const failingEditor = {
      ...value.editor,
      createShape: (...args: Parameters<typeof value.editor.createShape>) => {
        if (++writes === 8) throw new Error('Injected graph write failure')
        return value.editor.createShape(...args)
      }
    }
    expect(() =>
      createBusinessPages(failingEditor, value.descriptor, value.application, 'customer-crm')
    ).toThrow('Injected graph write failure')
    expect(value.editor.documentSnapshotChanged(before)).toBe(false)
    expect(readBackendProviderDocumentRequest(value.graph)).toBeNull()
    expect(value.editor.undo.canUndo).toBe(false)
  })
})
