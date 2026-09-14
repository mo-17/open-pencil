import type { ActionDef, StateDef } from '@open-pencil/scene-graph'

import type { BusinessPageDefinition } from '../types'
import type { BusinessPageContext } from './context'
import { BUSINESS_CONTENT_WIDTH, BUSINESS_CONTENT_X, BUSINESS_PAGE_WIDTH } from './layout'
import { businessMarkerData } from './markers'
import { businessLiteral, businessSet, businessVariable } from './state'

export function createBusinessScreen(ctx: BusinessPageContext, definition: BusinessPageDefinition) {
  const { layout, copy } = ctx
  const states: StateDef[] = []
  const formStates: StateDef[] = []
  const field = (key: string, type: StateDef['type'] = 'string', defaultValue: unknown = '') => {
    const state: StateDef = {
      id: crypto.randomUUID(),
      name: 'business' + key.replace(/[^a-z0-9]/giu, '') + states.length,
      type,
      defaultValue
    }
    states.push(state)
    return state
  }
  const formField: typeof field = (...args) => {
    const state = field(...args)
    formStates.push(state)
    return state
  }
  const canvas = layout.shape(
    'CANVAS',
    ctx.label(definition.title),
    ctx.editor.graph.rootId,
    0,
    0,
    BUSINESS_PAGE_WIDTH,
    1000,
    {
      lowcodeRoutePattern: ctx.paths[definition.id],
      lowcodeRequiresAuth: !definition.public,
      pluginData: businessMarkerData({
        version: 1,
        role: 'page',
        applicationId: ctx.application.applicationId,
        kind: ctx.definition.id,
        pageKey: definition.id
      }),
      state: []
    }
  )
  ctx.pageIds.push(canvas)
  const page = layout.shape(
    'FRAME',
    ctx.label(definition.title),
    canvas,
    0,
    0,
    BUSINESS_PAGE_WIDTH,
    1000
  )
  const error = ctx.doc(definition.id + 'Error')
  const selected = ctx.doc(definition.id + 'SelectedRecord', 'object')
  const empty = field('EmptyRecord', 'object', {})
  const generation = field('Generation')
  const action = field('Action')
  const selectionReady = field('SelectionReady', 'boolean', false)
  const current = `${generation.name} === ("" + $currentUser.generation)`
  const selection = `(${current}) && ${selectionReady.name} && !!${selected}.id`
  const clearSelection = businessVariable(selected, empty.name)
  const resetFields = () =>
    formStates.map((state) => businessSet(state, businessLiteral(state.defaultValue)))
  const beginAction = (id: string): ActionDef[] => [
    {
      id: crypto.randomUUID(),
      kind: 'condition',
      condExpr: `!(${current})`,
      consequent: resetFields()
    },
    businessSet(generation, '"" + $currentUser.generation'),
    businessSet(action, JSON.stringify(id))
  ]
  const navigate = (to: string): ActionDef => ({ id: crypto.randomUUID(), kind: 'navigate', to })
  layout.text(
    page,
    ctx.label(ctx.definition.title),
    { x: 24, y: 28, width: 208, height: 64 },
    { fontSize: 22 }
  )
  layout.text(
    page,
    ctx.label(definition.title),
    { x: BUSINESS_CONTENT_X, y: 28, width: 650, height: 44 },
    { fontSize: 28 }
  )
  layout.text(
    page,
    ctx.label(definition.description),
    { x: BUSINESS_CONTENT_X, y: 90, width: BUSINESS_CONTENT_WIDTH, height: 72 },
    { fontSize: 14 }
  )
  layout.button(
    page,
    copy.signOut,
    { x: 1000, y: 28, width: 152, height: 44 },
    [{ id: crypto.randomUUID(), kind: 'backendAuth', operation: 'signOut', errorTarget: error }],
    { renderCondition: '!!$currentUser.signedIn' }
  )
  let cursor = 196
  const reserve = (height: number) => {
    const start = cursor
    cursor += height + 24
    return start
  }
  const finish = () => {
    const leave = (to: string): ActionDef[] => [
      clearSelection,
      businessSet(selectionReady, '!1'),
      ...resetFields(),
      businessSet(action, '""'),
      businessSet(generation, '""'),
      businessVariable(error, '""'),
      navigate(to)
    ]
    const navigation = layout.shape(
      'FRAME',
      'Business navigation',
      page,
      24,
      116,
      208,
      ctx.navigation.length * 56,
      {
        pluginData: businessMarkerData({
          version: 1,
          role: 'navigation',
          applicationId: ctx.application.applicationId,
          knownKeys: ctx.navigation.map((entry) => entry.key)
        })
      }
    )
    for (const [index, entry] of ctx.navigation.entries())
      layout.button(
        navigation,
        ctx.label(entry.label),
        { x: 0, y: index * 56, width: 208, height: 44 },
        leave(entry.path)
      )
    layout.button(
      page,
      copy.signIn,
      { x: 1000, y: 28, width: 152, height: 44 },
      leave(ctx.paths.login),
      { renderCondition: '!$currentUser.signedIn' }
    )
    const y = reserve(72)
    layout.text(
      page,
      '',
      { x: BUSINESS_CONTENT_X, y, width: BUSINESS_CONTENT_WIDTH, height: 72 },
      {
        renderCondition: `!!${error}`,
        bindings: { text: { kind: 'docState', docStateName: error } }
      }
    )
    const height = Math.max(cursor + 24, 180 + ctx.navigation.length * 56)
    ctx.editor.updateNodeWithUndo(page, { height }, 'Size business page')
    ctx.editor.updateNodeWithUndo(
      canvas,
      { height, state: states },
      'Configure business page state'
    )
  }
  return {
    ctx,
    definition,
    page,
    canvas,
    field,
    formField,
    states,
    error,
    selected,
    selection,
    selectionReady,
    current,
    action,
    generation,
    beginAction,
    clearSelection,
    resetFields,
    reserve,
    finish
  }
}

export type BusinessScreen = ReturnType<typeof createBusinessScreen>
