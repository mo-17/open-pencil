import { describe, expect, test } from 'bun:test'

import { withDefaults } from '@open-pencil/compiler'
import { createEditor } from '@open-pencil/core/editor'
import { parseExpression } from '@open-pencil/lowcode'
import {
  parseBackendResourceDataSource,
  validateBackendClientAction,
  validateBackendResourceDataSource
} from '@open-pencil/lowcode/backend'
import type { ActionDef } from '@open-pencil/scene-graph'

import { readBackendBindingApplication } from '@/app/lowcode/backend/bindings/context'
import {
  createBackendProviderDocumentRequest,
  readBackendProviderDocumentRequest,
  validateBackendApplicationDraft
} from '@/app/lowcode/backend/document'
import {
  addNestJSEntity,
  addNestJSField,
  createNestJSNotesApplication,
  removeNestJSFieldReferences,
  removeNestJSEntity,
  enableNestJSBrowserClient
} from '@/app/lowcode/backend/nestjs-draft'
import { createPersonalNotesPages } from '@/app/lowcode/backend/notes-template'
import {
  createAppPluginStore,
  createBundledPluginCatalog,
  createMemoryAppPluginStateStorage
} from '@/app/plugins'
import {
  compileAppBackendProviderDocument,
  listAppBackendProviderDescriptors
} from '@/app/plugins/host/backend-provider'

async function fixture() {
  const entry = createBundledPluginCatalog().find(
    ({ manifest }) => manifest.plugin.id === 'open-pencil.nestjs-backend'
  )
  if (!entry) throw new Error('Missing NestJS provider')
  const store = createAppPluginStore({
    catalog: [entry],
    storage: createMemoryAppPluginStateStorage(),
    activationCompatibilityPolicy: () => ({ ok: true }),
    engineVersion: '0.13.2'
  })
  await store.load()
  const descriptor = listAppBackendProviderDescriptors(store)[0]
  if (!descriptor) throw new Error('Missing active descriptor')
  const application = createNestJSNotesApplication('personal-notes')
  if (!application.httpApi?.browserClient) throw new Error('Missing browser client')
  application.httpApi.browserClient.authentication.issuer = 'https://identity.example.com'
  application.httpApi.browserClient.authentication.clientId = 'notes-public-client'
  return { application, httpAPI: application.httpApi, descriptor, editor: createEditor(), store }
}

function eachAction(actions: readonly ActionDef[], visit: (action: ActionDef) => void): void {
  for (const action of actions) {
    visit(action)
    if ('onSuccess' in action) eachAction(action.onSuccess ?? [], visit)
    if ('onError' in action) eachAction(action.onError ?? [], visit)
    if ('consequent' in action) eachAction(action.consequent, visit)
    if ('alternate' in action) eachAction(action.alternate ?? [], visit)
  }
}

describe('NestJS visual user flow', () => {
  test.each(['react', 'vue'] as const)(
    '%s export keeps repeated notes at their full height in a scrollable grid viewport',
    async (target) => {
      const { application, descriptor, editor, store } = await fixture()
      const pages = createPersonalNotesPages(editor, descriptor, application)
      const output = compileAppBackendProviderDocument(store, {
        graph: editor.graph,
        pageIds: [pages.loginPageId, pages.notesPageId],
        options: withDefaults({
          target,
          router: target === 'vue' ? 'vue-router-v4' : 'react-router-v6',
          devMode: false
        })
      })
      const source = output.files.get(
        `src/pages/personal-notes.${target === 'vue' ? 'vue' : 'tsx'}`
      )
      expect(typeof source).toBe('string')
      const classAttributes = [...String(source).matchAll(/class(?:Name)?="([^"]+)"/g)].map(
        (match) => match[1].split(/\s+/)
      )
      const viewport = classAttributes.find((classes) => classes.includes('overflow-y-auto'))
      expect(viewport).toBeDefined()
      expect(viewport).toContain('grid')
      expect(viewport).toContain('grid-cols-1')
      expect(viewport).toContain('grid-rows-[150px]')
      expect(viewport).toContain('h-[350px]')
      expect(viewport).toContain('overflow-x-hidden')
      expect(viewport).not.toContain('overflow-hidden')
      expect(viewport).not.toContain('flex-col')
      expect(classAttributes.some((classes) => classes.includes('h-[150px]'))).toBe(true)
      const formClasses = String(source)
        .match(/<form\b[^>]*\bclass(?:Name)?="([^"]+)"/)?.[1]
        ?.split(/\s+/)
      expect(formClasses).toContain('absolute')
      expect(formClasses).not.toContain('flex')
      expect(formClasses).not.toContain('flex-col')
      const textareaClasses = String(source)
        .match(/<textarea\b[^>]*\bclass(?:Name)?="([^"]+)"/)?.[1]
        ?.split(/\s+/)
      expect(textareaClasses).toContain('absolute')
      expect(textareaClasses).toContain('h-[126px]')
    }
  )

  test('creates legal owner models without changing existing field identities', async () => {
    const { application, descriptor } = await fixture()
    const first = application.dataModel.entities[0]
    const ids = first.fields.map((field) => field.id)
    expect(validateBackendApplicationDraft(application, descriptor).diagnostics).toEqual([])
    const second = addNestJSEntity(application)
    expect(second.name).toBe('notes_2')
    addNestJSField(application, first, 'title')
    expect(first.fields.slice(0, ids.length).map((field) => field.id)).toEqual(ids)
    expect(first.fields.at(-1)?.id).toBe('title_2')
    expect(validateBackendApplicationDraft(application, descriptor).ok).toBe(true)
  })

  test('provider validation refuses NestJS unsupported data and incomplete login before save', async () => {
    const { application, descriptor } = await fixture()
    application.dataModel.entities[0].fields[2].type = 'json'
    expect(validateBackendApplicationDraft(application, descriptor).ok).toBe(false)
    expect(() => createBackendProviderDocumentRequest(descriptor, application)).toThrow()
    expect(
      validateBackendApplicationDraft(createNestJSNotesApplication('incomplete'), descriptor).ok
    ).toBe(false)
  })

  test('field removal updates only matching resource projections', async () => {
    const { application } = await fixture()
    const entity = application.dataModel.entities[0]
    const second = addNestJSEntity(application)
    removeNestJSFieldReferences(application, entity.id, 'title')
    const resources = application.httpApi?.resources ?? []
    expect(resources[0].readFields).not.toContain('title')
    expect(resources.find((resource) => resource.entityId === second.id)?.readFields).toContain(
      'title'
    )
  })

  test('creates two pages and model in one undo batch while preserving existing page, state and plugin data', async () => {
    const { application, descriptor, editor } = await fixture()
    const originalPages = editor.graph.getPages().map((page) => page.id)
    editor.graph.updateNode(editor.graph.rootId, {
      pluginData: [{ pluginId: 'keep', key: 'keep', value: 'same' }],
      lowcodeDocumentState: [
        { id: 'existing', name: 'notesError', type: 'string', defaultValue: 'keep' }
      ]
    })
    const originalRoot = structuredClone(editor.graph.getNode(editor.graph.rootId))
    const result = createPersonalNotesPages(editor, descriptor, application)
    expect(editor.graph.getPages()).toHaveLength(originalPages.length + 2)
    expect(editor.graph.getNode(result.notesPageId)?.lowcodeRequiresAuth).toBe(true)
    expect(
      readBackendProviderDocumentRequest(editor.graph)?.application.httpApi?.browserClient
    ).toBeDefined()
    expect(editor.graph.getNode(editor.graph.rootId)?.pluginData[0]).toEqual(
      originalRoot?.pluginData[0]
    )
    expect(editor.graph.getNode(editor.graph.rootId)?.lowcodeDocumentState?.[0]).toEqual(
      originalRoot?.lowcodeDocumentState?.[0]
    )
    const childEdges = Object.fromEntries(
      [...editor.graph.getAllNodes()].map((node) => [node.id, [...node.childIds]])
    )
    editor.undo.undo()
    expect(editor.graph.getPages().map((page) => page.id)).toEqual(originalPages)
    expect(editor.graph.getNode(editor.graph.rootId)?.pluginData).toEqual(originalRoot?.pluginData)
    expect(editor.graph.getNode(editor.graph.rootId)?.lowcodeDocumentState).toEqual(
      originalRoot?.lowcodeDocumentState
    )
    editor.undo.redo()
    expect(editor.graph.getNode(result.notesPageId)).toBeDefined()
    expect(readBackendBindingApplication(editor.graph)).toBeDefined()
    expect(
      Object.fromEntries([...editor.graph.getAllNodes()].map((node) => [node.id, node.childIds]))
    ).toEqual(childEdges)
    editor.undo.undo()
    editor.undo.redo()
    expect(
      Object.fromEntries([...editor.graph.getAllNodes()].map((node) => [node.id, node.childIds]))
    ).toEqual(childEdges)
  })

  test('every generated request and list passes shared client validation with declared private state', async () => {
    const { application, httpAPI, descriptor, editor } = await fixture()
    httpAPI.resources[0].maxPageSize = 5
    const result = createPersonalNotesPages(editor, descriptor, application)
    const states = editor.graph.getNode(editor.graph.rootId)?.lowcodeDocumentState ?? []
    const afterState = editor.graph
      .getNode(result.notesPageId)
      ?.state?.find((state) => state.name === 'notesAfter')
    expect(afterState).toMatchObject({ type: 'string', defaultValue: '' })
    expect(states.map((state) => state.name)).not.toContain('notesAfter')
    const nextPage = [...editor.graph.getAllNodes()].find((node) => node.name === 'Next page')
    expect(nextPage?.events?.onClick?.[0]).toMatchObject({
      kind: 'setState',
      targetStateId: afterState?.id,
      valueExpr: 'notesCursor'
    })
    let requests = 0
    let lists = 0
    const verifyAction = (action: ActionDef): void => {
      if (action.kind === 'backendAuth' || action.kind === 'backendRequest') {
        expect(validateBackendClientAction(application, action, states)).toEqual([])
        requests++
      }
    }
    for (const node of editor.graph.getAllNodes()) {
      for (const actions of Object.values(node.events ?? {})) eachAction(actions, verifyAction)
      if (node.type === 'LIST') {
        const parsed = parseBackendResourceDataSource(node.interactiveProps?.dataSourceRef)
        if (!parsed.ok) throw new Error('Invalid generated data source')
        const source = parsed.value
        expect(validateBackendResourceDataSource(application, source, states)).toEqual([])
        expect(source.limit).toBe(5)
        lists++
      }
    }
    expect(requests).toBe(5)
    expect(lists).toBe(1)
  })

  test('invalid template prerequisites do not partially mutate documents', async () => {
    const { application, descriptor, editor } = await fixture()
    editor.graph.updateNode(editor.graph.rootId, { lowcodeAuthRedirect: '/existing-login' })
    const ids = [...editor.graph.getAllNodes()].map((node) => node.id)
    expect(() => createPersonalNotesPages(editor, descriptor, application)).toThrow(
      'existing authentication'
    )
    expect([...editor.graph.getAllNodes()].map((node) => node.id)).toEqual(ids)
    expect(readBackendProviderDocumentRequest(editor.graph)).toBeNull()
  })

  test('allocates distinct routes and accepts a renamed primary JSON field', async () => {
    const { application, descriptor, editor } = await fixture()
    editor.graph.updateNode(editor.graph.getPages()[0].id, { lowcodeRoutePattern: '/notes' })
    const entity = application.dataModel.entities[0]
    entity.fields[0].id = 'note_key'
    entity.primaryKey = { fields: ['note_key'] }
    if (!application.httpApi) throw new Error('Missing HTTP API')
    application.httpApi.resources[0].readFields[0] = 'note_key'
    const result = createPersonalNotesPages(editor, descriptor, application)
    expect(result.notesPath).toBe('/notes-2')
    const remove = [...editor.graph.getAllNodes()].find((node) => node.name === 'Delete')?.events
      ?.onClick?.[0]
    expect(remove).toMatchObject({ kind: 'backendRequest', idExpr: 'item.note_key' })
  })
  test('nullable inputs preserve null separately and all template expressions resolve to declared scope', async () => {
    const { application, descriptor, editor } = await fixture()
    const entity = application.dataModel.entities[0]
    entity.fields[2].nullable = true
    entity.fields[2].default = { kind: 'literal', value: null }
    entity.fields[3].type = 'boolean'
    entity.fields[3].nullable = true
    entity.fields[3].default = { kind: 'literal', value: false }
    const result = createPersonalNotesPages(editor, descriptor, application)
    const page = editor.graph.getNode(result.notesPageId)
    const allowed = new Set([
      'item',
      'index',
      'data',
      'error',
      'err',
      '$prev',
      ...(page?.state ?? []).map((state) => state.name),
      ...(editor.graph.getNode(editor.graph.rootId)?.lowcodeDocumentState ?? []).map(
        (state) => state.name
      )
    ])
    const verifyExpression = (expression: string): void => {
      const parsed = parseExpression(expression)
      if (!parsed.ok) throw new Error(parsed.error)
      expect([...parsed.references].filter((name) => !allowed.has(name))).toEqual([])
    }
    const verifyAction = (action: ActionDef): void => {
      if ('valueExpr' in action && action.valueExpr) verifyExpression(action.valueExpr)
      if ('condExpr' in action && action.condExpr) verifyExpression(action.condExpr)
      if (action.kind === 'backendRequest')
        for (const entry of action.payloadEntries ?? []) verifyExpression(entry.valueExpr)
    }
    for (const node of editor.graph.getAllNodes()) {
      for (const actions of Object.values(node.events ?? {})) eachAction(actions, verifyAction)
      for (const binding of Object.values(node.bindings ?? {}))
        if (binding.kind === 'expr' && binding.expr) verifyExpression(binding.expr)
      if (node.renderCondition) verifyExpression(node.renderCondition)
    }
    expect(page?.state).toContainEqual(
      expect.objectContaining({
        name: 'noteNullValue',
        type: 'object',
        defaultValue: { value: null }
      })
    )
    expect(page?.state).toContainEqual(
      expect.objectContaining({ name: 'nullable_title', type: 'boolean', defaultValue: true })
    )
    const form = [...editor.graph.getAllNodes()].find((node) => node.type === 'FORM')
    const condition = form?.events?.onSubmit?.[0]
    if (condition?.kind !== 'condition') throw new Error('Missing form action')
    expect(condition.consequent[0]).toMatchObject({
      payloadEntries: [
        { key: 'title', valueExpr: 'nullable_title ? noteNullValue.value : note_title' },
        { key: 'content', valueExpr: 'nullable_content ? noteNullValue.value : note_content' }
      ]
    })
  })
  test('removing a NestJS entity removes its owned declarations but preserves other models', async () => {
    const { application, descriptor } = await fixture()
    const previous = application.dataModel.entities[0]
    const second = addNestJSEntity(application)
    removeNestJSEntity(application, previous.id)
    expect(application.dataModel.entities.map((entity) => entity.id)).toEqual([second.id])
    expect(application.auth.ownership.every((rule) => rule.entityId === second.id)).toBe(true)
    expect(
      application.httpApi?.resources.every((resource) => resource.entityId === second.id)
    ).toBe(true)
    expect(validateBackendApplicationDraft(application, descriptor).ok).toBe(true)
  })

  test('existing server-only NestJS applications opt into login without replacing model identities', async () => {
    const { application, descriptor } = await fixture()
    if (!application.httpApi) throw new Error('Missing HTTP API')
    delete application.httpApi.browserClient
    const fields = structuredClone(application.dataModel)
    expect(validateBackendApplicationDraft(application, descriptor).ok).toBe(true)
    enableNestJSBrowserClient(application)
    expect(application.dataModel).toEqual(fields)
    expect(application.httpApi.browserClient?.authentication.clientId).toBe('')
    expect(validateBackendApplicationDraft(application, descriptor).ok).toBe(false)
  })
})
