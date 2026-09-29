import type { ActionDef, StateDef } from '@open-pencil/scene-graph'

import { applyTemplateMobileLayout } from '@/app/lowcode/backend/responsive/layout'
import { createTemplateMobileNavigation } from '@/app/lowcode/backend/responsive/navigation'
import { groupTemplateNodes } from '@/app/lowcode/backend/responsive/structure'

import type { BusinessPageDefinition } from '../types'
import type { BusinessPageContext } from './context'
import { createFoodOrderingShell } from './food-ordering/shell'
import { FOOD_ORDERING_COLORS, foodButton, foodSurface } from './food-ordering/style'
import { BUSINESS_CONTENT_WIDTH, BUSINESS_CONTENT_X, BUSINESS_PAGE_WIDTH } from './layout'
import { businessMarkerData } from './markers'
import {
  BUSINESS_PRESENTATION_CONTENT_Y,
  createBusinessPresentationShell
} from './presentation/shell'
import { businessButton, businessSurface, businessText } from './presentation/style'
import { businessLiteral, businessSet, businessVariable } from './state'

export function createBusinessScreen(ctx: BusinessPageContext, definition: BusinessPageDefinition) {
  const { layout, copy } = ctx
  const restaurant = ctx.definition.id === 'food-ordering'
  const states: StateDef[] = []
  const mobilePreserve = new Set<string>()
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
    1000,
    restaurant
      ? foodSurface({ fill: FOOD_ORDERING_COLORS.background, radius: 0 })
      : businessSurface(ctx.presentation, { fill: ctx.presentation.colors.background, radius: 0 })
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
  const shell = restaurant
    ? createFoodOrderingShell(ctx, page, definition)
    : createBusinessPresentationShell(ctx, page, definition)
  const signOut = layout.button(
    page,
    copy.signOut,
    { x: 1000, y: 28, width: 152, height: 44 },
    [{ id: crypto.randomUUID(), kind: 'backendAuth', operation: 'signOut', errorTarget: error }],
    {
      ...(restaurant ? foodButton('secondary') : businessButton(ctx.presentation, 'secondary')),
      renderCondition: '!!$currentUser.signedIn'
    }
  )
  let cursor = restaurant ? 196 : BUSINESS_PRESENTATION_CONTENT_Y
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
    const navigationBottom = shell.navigation(leave)
    const mobileNavigation = createTemplateMobileNavigation(
      ctx.editor,
      page,
      canvas,
      ctx.navigation.map((entry) => ({
        label: ctx.label(entry.label),
        path: entry.path,
        actions: leave(entry.path)
      })),
      ctx.paths[definition.id],
      ctx.label({ en: 'Page navigation', zh: '页面导航' })
    )
    states.push(mobileNavigation.state)
    ctx.editor.updateNodeWithUndo(
      mobileNavigation.nodeId,
      {
        x: BUSINESS_CONTENT_X,
        y: 12,
        pluginData: businessMarkerData({
          version: 1,
          role: 'mobile-navigation',
          applicationId: ctx.application.applicationId,
          knownKeys: ctx.navigation.map((entry) => entry.key)
        })
      },
      'Configure mobile page navigation'
    )
    const signIn = layout.button(
      page,
      copy.signIn,
      { x: 1000, y: 28, width: 152, height: 44 },
      leave(ctx.paths.login),
      {
        ...(restaurant ? foodButton('secondary') : businessButton(ctx.presentation, 'secondary')),
        renderCondition: '!$currentUser.signedIn'
      }
    )
    const header = groupTemplateNodes(
      ctx.editor,
      page,
      [shell.eyebrow, signOut, signIn],
      'Page account controls'
    )
    ctx.editor.updateNodeWithUndo(
      header,
      {
        responsiveOverrides: {
          compact: {
            layoutMode: 'HORIZONTAL',
            primaryAxisSizing: 'FILL',
            counterAxisSizing: 'HUG',
            itemSpacing: 8,
            counterAxisAlign: 'CENTER'
          }
        }
      },
      'Arrange compact page header'
    )
    ctx.editor.updateNodeWithUndo(
      shell.eyebrow,
      {
        responsiveOverrides: { compact: { counterAxisSizing: 'HUG', layoutGrow: 1 } }
      },
      'Fit compact page identity'
    )
    for (const id of [signIn, signOut])
      ctx.editor.updateNodeWithUndo(
        id,
        {
          responsiveOverrides: { compact: { counterAxisSizing: 'FIXED', width: 112 } }
        },
        'Fit compact account action'
      )
    const y = reserve(72)
    layout.text(
      page,
      '',
      { x: BUSINESS_CONTENT_X, y, width: BUSINESS_CONTENT_WIDTH, height: 72 },
      {
        ...(!restaurant ? businessText(ctx.presentation, { color: '#A32936', size: 14 }) : {}),
        renderCondition: `!!${error}`,
        bindings: { text: { kind: 'docState', docStateName: error } }
      }
    )
    const height = Math.max(cursor + 24, navigationBottom + 24, restaurant ? 0 : 900)
    shell.finish(height)
    ctx.editor.updateNodeWithUndo(page, { height }, 'Size business page')
    ctx.editor.updateNodeWithUndo(
      canvas,
      { height, state: states },
      'Configure business page state'
    )
    applyTemplateMobileLayout(ctx.editor, page, {
      hidden: new Set([shell.sidebar]),
      preserve: mobilePreserve
    })
  }
  return {
    ctx,
    definition,
    page,
    canvas,
    field,
    formField,
    states,
    mobilePreserve,
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
