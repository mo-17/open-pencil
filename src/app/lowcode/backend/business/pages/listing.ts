import type {
  ActionDef,
  BackendResourceDataSource,
  SceneNode,
  StateDef
} from '@open-pencil/scene-graph'

import { backendTemplateListProps } from '@/app/lowcode/backend/notes-template-style'

import type { BusinessListing } from '../types'
import { foodListPresentation, renderFoodListCard } from './food-ordering/cards'
import { renderFoodDetails } from './food-ordering/details'
import { foodButton } from './food-ordering/style'
import { BUSINESS_CONTENT_WIDTH, BUSINESS_CONTENT_X } from './layout'
import { renderBusinessDetails } from './presentation/details'
import { businessRecordPresentation, renderBusinessRecord } from './presentation/records'
import { businessButton } from './presentation/style'
import type { BusinessScreen } from './screen'
import { businessLiteral, businessSet } from './state'

interface BusinessListOptions {
  x?: number
  width?: number
  filters?: BackendResourceDataSource['filterEntries']
  searchExpr?: string
  condition?: string
  choose?: ActionDef[]
  chooseLabel?: string
  refreshable?: boolean
}

function listHeight(screen: BusinessScreen, definition: BusinessListing): number {
  return screen.ctx.definition.id === 'food-ordering'
    ? foodListPresentation(definition).listHeight
    : 310
}

function prepareBusinessListSource(
  screen: BusinessScreen,
  definition: BusinessListing,
  options: BusinessListOptions
) {
  const { ctx } = screen
  const resource = ctx.application.httpApi?.resources.find(
    (item) => item.id === definition.resourceId
  )
  if (!resource) throw new Error('Missing business resource: ' + definition.resourceId)
  const after = screen.field(definition.resourceId + 'After')
  const refresh = options.refreshable
    ? screen.field(definition.resourceId + 'Refresh', 'boolean', false)
    : undefined
  const cursor = ctx.doc(screen.definition.id + definition.resourceId + 'Cursor')
  const source: BackendResourceDataSource = {
    kind: 'backendResource',
    resourceId: definition.resourceId,
    limit: Math.min(20, resource.maxPageSize ?? 20),
    // Both branches keep the wire cursor unchanged. The local flag only restarts
    // the React/Vue query subscription, including when refreshing the first page.
    afterExpr: refresh ? `${refresh.name} ? ${after.name} : ${after.name}` : after.name,
    nextCursorTarget: cursor,
    errorTarget: screen.error,
    ...(options.filters ? { filterEntries: options.filters } : {}),
    ...(options.searchExpr ? { searchExpr: options.searchExpr } : {})
  }
  return { source, after, refresh, cursor }
}

function businessListPresentation(
  screen: BusinessScreen,
  definition: BusinessListing,
  options: BusinessListOptions
) {
  const x = options.x ?? BUSINESS_CONTENT_X
  const width = options.width ?? BUSINESS_CONTENT_WIDTH
  const food =
    screen.ctx.definition.id === 'food-ordering' ? foodListPresentation(definition) : undefined
  const height = listHeight(screen, definition)
  const record = businessRecordPresentation(screen, definition)
  const columns = food?.columns ?? record.columns
  const cardHeight = food?.cardHeight ?? record.contentHeight + (options.choose ? 72 : 20)
  const cardWidth = (width - (columns - 1) * 16) / columns
  const style: Partial<SceneNode> = {
    fills: [],
    gridTemplateColumns: Array.from({ length: columns }, () => ({
      sizing: 'FR' as const,
      value: 1
    })),
    gridColumnGap: 16,
    gridRowGap: 16
  }
  return { x, width, height, cardHeight, cardWidth, food, style, buttonHeight: 44 }
}

function renderBusinessListRow(
  screen: BusinessScreen,
  list: string,
  definition: BusinessListing,
  presentation: ReturnType<typeof businessListPresentation>,
  options: BusinessListOptions
): void {
  const { ctx } = screen
  const { food, width, cardHeight, cardWidth, buttonHeight } = presentation
  const card = ctx.layout.shape(
    'FRAME',
    definition.resourceId + ' row',
    list,
    0,
    0,
    cardWidth,
    cardHeight
  )
  if (food) renderFoodListCard(screen, card, definition, cardWidth)
  else renderBusinessRecord(screen, card, definition, cardWidth)
  const buttonX = food ? 16 : 24
  if (options.choose)
    ctx.layout.button(
      card,
      options.chooseLabel ?? ctx.copy.select,
      {
        x: food?.menu ? (width - 16) / 2 - 192 : buttonX,
        y: cardHeight - 56,
        width: food?.menu ? 172 : 250,
        height: buttonHeight
      },
      options.choose,
      food ? foodButton('secondary') : businessButton(ctx.presentation, 'secondary')
    )
}

function renderBusinessListPagination(
  screen: BusinessScreen,
  parent: string,
  y: number,
  presentation: ReturnType<typeof businessListPresentation>,
  query: ReturnType<typeof prepareBusinessListSource>,
  options: BusinessListOptions
): void {
  const { ctx } = screen
  const { x, height, food, buttonHeight } = presentation
  const { after, refresh, cursor } = query
  ctx.layout.button(
    parent,
    ctx.copy.first,
    { x, y: y + height + 16, width: 180, height: buttonHeight },
    [businessSet(after, '""')],
    {
      ...(food ? foodButton('quiet') : businessButton(ctx.presentation, 'quiet')),
      ...(options.condition ? { renderCondition: options.condition } : {})
    }
  )
  ctx.layout.button(
    parent,
    ctx.copy.next,
    { x: x + 204, y: y + height + 16, width: 180, height: buttonHeight },
    [businessSet(after, cursor)],
    {
      ...(food ? foodButton('quiet') : businessButton(ctx.presentation, 'quiet')),
      renderCondition: `${options.condition ? '(' + options.condition + ') && ' : ''}${cursor} !== ""`
    }
  )
  if (refresh)
    ctx.layout.button(
      parent,
      ctx.copy.refresh,
      { x: x + 408, y: y + height + 16, width: 190, height: buttonHeight },
      [
        screen.clearSelection,
        businessSet(screen.selectionReady, '!1'),
        businessSet(after, '""'),
        businessSet(refresh, `!${refresh.name}`)
      ],
      {
        ...(food ? foodButton('secondary') : businessButton(ctx.presentation, 'secondary')),
        ...(options.condition ? { renderCondition: options.condition } : {})
      }
    )
}

export function renderBusinessList(
  screen: BusinessScreen,
  parent: string,
  definition: BusinessListing,
  y: number,
  options: BusinessListOptions = {}
): number {
  const query = prepareBusinessListSource(screen, definition, options)
  const presentation = businessListPresentation(screen, definition, options)
  const { x, width, height, cardHeight, style } = presentation
  const list = screen.ctx.layout.shape('LIST', definition.resourceId, parent, x, y, width, height, {
    ...backendTemplateListProps(query.source, cardHeight),
    ...style,
    ...(options.condition ? { renderCondition: options.condition } : {})
  })
  renderBusinessListRow(screen, list, definition, presentation, options)
  renderBusinessListPagination(screen, parent, y, presentation, query, options)
  return height + 70
}

function renderBusinessSearch(
  screen: BusinessScreen,
  listing: BusinessListing,
  search: StateDef,
  query: StateDef,
  filter: StateDef
): void {
  const { ctx } = screen
  if (listing.search || listing.filter) {
    const food = ctx.definition.id === 'food-ordering'
    const y = screen.reserve(food ? 100 : 44)
    const pairedSearchWidth = listing.filter ? 344 : 672
    const searchWidth = food ? 390 : pairedSearchWidth
    const filterX = listing.search ? 360 : 0
    const filterWidth = listing.search ? 304 : 672
    if (listing.search)
      ctx.layout.shape(
        'INPUT',
        ctx.copy.search,
        screen.page,
        BUSINESS_CONTENT_X,
        y,
        searchWidth,
        44,
        {
          bindings: { value: { kind: 'ref', stateId: search.id } },
          interactiveProps: { placeholder: ctx.copy.search }
        }
      )
    if (listing.filter)
      ctx.layout.shape(
        'SELECT',
        ctx.copy.all,
        screen.page,
        BUSINESS_CONTENT_X + (food ? 410 : filterX),
        y,
        food ? 320 : filterWidth,
        44,
        {
          bindings: { value: { kind: 'ref', stateId: filter.id } },
          interactiveProps: {
            options: [
              ctx.copy.all,
              ...listing.filter.choices.map((choice) => ctx.label(choice.label))
            ]
          }
        }
      )
    ctx.layout.button(
      screen.page,
      ctx.copy.apply,
      {
        x: BUSINESS_CONTENT_X + (food ? 0 : 688),
        y: y + (food ? 54 : 0),
        width: 190,
        height: food ? 42 : 44
      },
      [businessSet(query, search.name), screen.clearSelection]
    )
  }
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
  renderBusinessSearch(screen, listing, search, query, filter)
  const y = screen.reserve(listHeight(screen, listing) + 70)
  const common = { searchExpr: listing.search ? query.name : undefined, choose, refreshable: true }
  if (!listing.filter) renderBusinessList(screen, screen.page, listing, y, common)
  else {
    const choice =
      listing.filter.choices
        .map(
          (entry) =>
            `${filter.name} === ${JSON.stringify(ctx.label(entry.label))} ? ${businessLiteral(entry.value)} : `
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
  if (ctx.definition.id === 'food-ordering') renderFoodDetails(screen, details)
  else renderBusinessDetails(screen, details)
  for (const related of screen.definition.related ?? []) {
    const relatedY = screen.reserve(listHeight(screen, related) + 114)
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
          valueExpr: `(${screen.selected}.${related.selectionField ?? 'id'} || "00000000-0000-4000-8000-000000000000")`
        }
      ]
    })
  }
}
