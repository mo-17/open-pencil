import type {
  ActionDef,
  BackendResourceDataSource,
  SceneNode,
  StateDef
} from '@open-pencil/scene-graph'

import { commerceState, setCommerceState } from '../state'
import type { OperationsContext } from './context'

export const EMPTY_COMMERCE_ID = '00000000-0000-4000-8000-000000000000'
export function createOperationsScreen(
  ctx: OperationsContext,
  key: keyof OperationsContext['paths'],
  height: number,
  hint: string,
  requiresAuth = true
) {
  const { layout: l, copy: c } = ctx
  const states: StateDef[] = []
  const page = l.page(c[key], ctx.paths[key], [], requiresAuth, height)
  const canvas = ctx.editor.graph.getNode(page)?.parentId
  if (!canvas) throw new Error('Missing operations canvas.')
  const field = (name: string, type: StateDef['type'] = 'string', value: unknown = '') => {
    const entry = commerceState(key + name + states.length, type, value)
    states.push(entry)
    return entry
  }
  const generation = field('Generation')
  const error = ctx.doc(key + 'Error')
  const current = `${generation.name} === ("" + $currentUser.generation)`
  const select = (...values: [StateDef, string][]): ActionDef[] => [
    {
      id: crypto.randomUUID(),
      kind: 'condition',
      condExpr: `!(${current})`,
      consequent: states
        .filter(
          (entry) => entry !== generation && !values.some(([selected]) => selected.id === entry.id)
        )
        .map((entry) =>
          setCommerceState(
            entry,
            entry.type === 'boolean'
              ? '!' + Number(!entry.defaultValue)
              : JSON.stringify(entry.defaultValue)
          )
        )
    },
    setCommerceState(generation, '"" + $currentUser.generation'),
    ...values.map(([entry, expr]) => setCommerceState(entry, expr))
  ]
  l.text(page, c[key], 48, 28, 730, { fontSize: 30 })
  if (key !== 'login') {
    l.button(page, c.signIn, 790, 28, [l.navigate(ctx.paths.login)], {
      width: 160,
      renderCondition: '!$currentUser.signedIn'
    })
    l.button(
      page,
      c.signOut,
      790,
      28,
      [
        {
          id: crypto.randomUUID(),
          kind: 'backendAuth',
          operation: 'signOut',
          errorTarget: error
        }
      ],
      { width: 160, renderCondition: '!!$currentUser.signedIn' }
    )
  }
  l.text(page, hint, 48, 78, 890, { height: 62, fontSize: 14 })
  for (const [index, target] of (['shop', 'cart', 'purchases', 'myStore'] as const).entries())
    l.button(page, c[target], 48 + index * 222, 150, [l.navigate(ctx.paths[target])])
  const list = (
    resourceId: string,
    title: string,
    y: number,
    cardHeight: number,
    filterEntries?: BackendResourceDataSource['filterEntries'],
    query: Pick<BackendResourceDataSource, 'searchExpr' | 'sortField' | 'sortDirection'> = {},
    condition?: string
  ) => {
    const after = field(resourceId.replace(/-/gu, '') + 'After')
    const cursor = ctx.doc(key + resourceId.replace(/-/gu, '') + 'Cursor')
    const resource = ctx.application.httpApi?.resources.find((entry) => entry.id === resourceId)
    if (!resource) throw new Error('Missing commerce resource: ' + resourceId)
    const source: BackendResourceDataSource = {
      kind: 'backendResource',
      resourceId,
      limit: Math.min(20, resource.maxPageSize ?? 20),
      afterExpr: after.name,
      nextCursorTarget: cursor,
      errorTarget: error,
      ...query,
      ...(filterEntries ? { filterEntries } : {})
    }
    l.text(page, title, 48, y - 32, 880, {
      fontSize: 20,
      ...(condition ? { renderCondition: condition } : {})
    })
    const card = l.listing(
      page,
      title,
      y,
      source,
      cardHeight,
      condition ? { renderCondition: condition } : {}
    )
    l.pagination(page, after, cursor, y + 304, condition)
    return { card, after, source }
  }
  const bound = (parent: string, expr: string, y: number, height = 32) =>
    l.text(parent, '', parent === page ? 48 : 16, y, parent === page ? 884 : 820, {
      height,
      bindings: { text: { kind: 'expr', expr } }
    })
  const input = (
    parent: string,
    label: string,
    entry: StateDef,
    y: number,
    validation: NonNullable<SceneNode['interactiveProps']>['validation'] = {
      required: true,
      maxLength: 200,
      pattern: '\\S'
    }
  ) => {
    l.text(parent, label, 0, y, 850)
    return l.shape('INPUT', label, parent, 0, y + 34, 820, 42, {
      bindings: { value: { kind: 'ref', stateId: entry.id } },
      interactiveProps: { placeholder: label, validation }
    })
  }
  const finish = () => {
    l.text(page, '', 48, height - 76, 890, {
      height: 60,
      renderCondition: `!!${error}`,
      bindings: { text: { kind: 'docState', docStateName: error } }
    })
    ctx.editor.updateNodeWithUndo(canvas, { state: states }, 'Configure commerce page state')
  }
  const clearSelection = setCommerceState(generation, '""')
  return {
    ctx,
    page,
    states,
    field,
    current,
    select,
    error,
    list,
    bound,
    input,
    finish,
    clearSelection
  }
}
export type OperationsScreen = ReturnType<typeof createOperationsScreen>
export function selectedFilter(screen: OperationsScreen, field: StateDef): string {
  return `(${screen.current} && ${field.name} ? ${field.name} : "${EMPTY_COMMERCE_ID}")`
}
