import type { ActionDef, BackendResourceDataSource } from '@open-pencil/scene-graph'

import { backendTemplateListProps } from '@/app/lowcode/backend/notes-template-style'

import type { BusinessListing } from '../types'
import { BUSINESS_CONTENT_WIDTH, BUSINESS_CONTENT_X } from './layout'
import type { BusinessScreen } from './screen'
import { businessSet } from './state'

export function renderBusinessList(
  screen: BusinessScreen,
  parent: string,
  definition: BusinessListing,
  y: number,
  options: {
    x?: number
    width?: number
    filters?: BackendResourceDataSource['filterEntries']
    searchExpr?: string
    condition?: string
    choose?: ActionDef[]
    chooseLabel?: string
  } = {}
): number {
  const { ctx } = screen
  const resource = ctx.application.httpApi?.resources.find(
    (item) => item.id === definition.resourceId
  )
  if (!resource) throw new Error('Missing business resource: ' + definition.resourceId)
  const after = screen.field(definition.resourceId + 'After')
  const cursor = ctx.doc(screen.definition.id + definition.resourceId + 'Cursor')
  const x = options.x ?? BUSINESS_CONTENT_X
  const width = options.width ?? BUSINESS_CONTENT_WIDTH
  const cardHeight = definition.columns.length * 34 + (options.choose ? 68 : 24)
  const source: BackendResourceDataSource = {
    kind: 'backendResource',
    resourceId: definition.resourceId,
    limit: Math.min(20, resource.maxPageSize ?? 20),
    afterExpr: after.name,
    nextCursorTarget: cursor,
    errorTarget: screen.error,
    ...(options.filters ? { filterEntries: options.filters } : {}),
    ...(options.searchExpr ? { searchExpr: options.searchExpr } : {})
  }
  const list = ctx.layout.shape('LIST', definition.resourceId, parent, x, y, width, 310, {
    ...backendTemplateListProps(source, cardHeight),
    ...(options.condition ? { renderCondition: options.condition } : {})
  })
  const card = ctx.layout.shape(
    'FRAME',
    definition.resourceId + ' row',
    list,
    0,
    0,
    width - 24,
    cardHeight
  )
  for (const [index, column] of definition.columns.entries())
    ctx.layout.text(
      card,
      '',
      { x: 16, y: 12 + index * 34, width: width - 64, height: 30 },
      {
        bindings: {
          text: {
            kind: 'expr',
            expr: `${JSON.stringify(ctx.label(column.label) + ': ')} + item.${column.field}`
          }
        }
      }
    )
  if (options.choose)
    ctx.layout.button(
      card,
      options.chooseLabel ?? ctx.copy.select,
      { x: 16, y: cardHeight - 54, width: 250, height: 42 },
      options.choose
    )
  ctx.layout.button(
    parent,
    ctx.copy.first,
    { x, y: y + 326, width: 180, height: 42 },
    [businessSet(after, '""')],
    options.condition ? { renderCondition: options.condition } : {}
  )
  ctx.layout.button(
    parent,
    ctx.copy.next,
    { x: x + 204, y: y + 326, width: 180, height: 42 },
    [businessSet(after, cursor)],
    {
      renderCondition: `${options.condition ? '(' + options.condition + ') && ' : ''}${cursor} !== ""`
    }
  )
  return 380
}

export function renderBusinessPrimaryList(screen: BusinessScreen): void {
  const listing = screen.definition.listing
  if (!listing) return
  const { ctx } = screen
  const search = screen.field('Search')
  const query = screen.field('Query')
  const filter = screen.field('Filter')
  const choose: ActionDef[] = [
    screen.clearSelection,
    businessSet(screen.selectionReady, '!1'),
    ...screen.resetFields(),
    businessSet(screen.action, '""'),
    businessSet(screen.generation, '"" + $currentUser.generation'),
    {
      id: crypto.randomUUID(),
      kind: 'backendRequest',
      resourceId: listing.resourceId,
      operation: 'read',
      idExpr: 'item.id',
      resultTarget: screen.selected,
      errorTarget: screen.error,
      onSuccess: [businessSet(screen.selectionReady, '!0')]
    }
  ]
  if (listing.search || listing.filter) {
    const y = screen.reserve(100)
    if (listing.search)
      ctx.layout.shape('INPUT', ctx.copy.search, screen.page, BUSINESS_CONTENT_X, y, 390, 44, {
        bindings: { value: { kind: 'ref', stateId: search.id } },
        interactiveProps: { placeholder: ctx.copy.search }
      })
    if (listing.filter)
      ctx.layout.shape('SELECT', ctx.copy.all, screen.page, BUSINESS_CONTENT_X + 410, y, 320, 44, {
        bindings: { value: { kind: 'ref', stateId: filter.id } },
        interactiveProps: {
          options: [
            ctx.copy.all,
            ...listing.filter.choices.map((choice) => ctx.label(choice.label))
          ]
        }
      })
    ctx.layout.button(
      screen.page,
      ctx.copy.apply,
      { x: BUSINESS_CONTENT_X, y: y + 54, width: 190, height: 42 },
      [businessSet(query, search.name), screen.clearSelection]
    )
  }
  const y = screen.reserve(380)
  const common = { searchExpr: listing.search ? query.name : undefined, choose }
  if (!listing.filter) renderBusinessList(screen, screen.page, listing, y, common)
  else {
    const choice =
      listing.filter.choices
        .map(
          (entry) =>
            `${filter.name} === ${JSON.stringify(ctx.label(entry.label))} ? ${JSON.stringify(entry.value)} : `
        )
        .join('') + '""'
    renderBusinessList(screen, screen.page, listing, y, {
      ...common,
      condition: `(${choice}) === ""`
    })
    renderBusinessList(screen, screen.page, listing, y, {
      ...common,
      condition: `(${choice}) !== ""`,
      filters: [{ key: listing.filter.field, valueExpr: choice }]
    })
  }
  const details = screen.definition.details ?? listing.columns
  const detailsY = screen.reserve(
    74 + details.reduce((height, column) => height + (column.multiline ? 344 : 38), 0)
  )
  ctx.layout.text(
    screen.page,
    ctx.copy.details,
    { x: BUSINESS_CONTENT_X, y: detailsY, width: BUSINESS_CONTENT_WIDTH, height: 34 },
    { fontSize: 20 }
  )
  let detailOffset = 44
  for (const column of details) {
    ctx.layout.text(
      screen.page,
      '',
      {
        x: BUSINESS_CONTENT_X,
        y: detailsY + detailOffset,
        width: BUSINESS_CONTENT_WIDTH,
        height: column.multiline ? 320 : 34
      },
      {
        renderCondition: screen.selection,
        ...(column.multiline
          ? { interactiveProps: { layout: { overflowY: 'auto', whiteSpace: 'pre-wrap' } } }
          : {}),
        bindings: {
          text: {
            kind: 'expr',
            expr: `${JSON.stringify(ctx.label(column.label) + ': ')} + ${screen.selected}.${column.field}`
          }
        }
      }
    )
    detailOffset += column.multiline ? 344 : 38
  }
  ctx.layout.text(
    screen.page,
    ctx.copy.none,
    { x: BUSINESS_CONTENT_X, y: detailsY + 44, width: BUSINESS_CONTENT_WIDTH, height: 34 },
    { renderCondition: `!(${screen.selection})` }
  )
  for (const related of screen.definition.related ?? []) {
    const relatedY = screen.reserve(424)
    ctx.layout.text(screen.page, ctx.label(related.title), {
      x: BUSINESS_CONTENT_X,
      y: relatedY,
      width: BUSINESS_CONTENT_WIDTH,
      height: 34
    })
    renderBusinessList(screen, screen.page, related, relatedY + 44, {
      condition: screen.selection,
      filters: [
        {
          key: related.foreignKey,
          valueExpr: `(${screen.selected}.id || "00000000-0000-4000-8000-000000000000")`
        }
      ]
    })
  }
}
