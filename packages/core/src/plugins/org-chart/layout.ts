import type { OrgChartCard, OrgChartItem, OrgChartLayout, OrgChartModuleConfigV1 } from './types'

export const ORG_CHART_LAYOUT = Object.freeze({
  padding: 24,
  cardWidth: 200,
  cardPadding: 12,
  siblingGap: 20,
  levelGap: 40,
  labelLineHeight: 1.4,
  descriptionLineHeight: 1.5,
  toggleSize: 24,
  compactIndent: 12,
  compactGap: 16,
  minimumCardWidth: 160
})

/** Pure layout for validated bounded config; no text measurement or browser state. */
export function orgChartLayout(
  width: number,
  config: OrgChartModuleConfigV1,
  collapsedIds: readonly string[] = config.initialCollapsedIds
): OrgChartLayout {
  const style = ORG_CHART_LAYOUT
  const available = Number.isFinite(width) ? Math.max(0, width) : 0
  const cardHeight = Math.max(
    80,
    Math.ceil(
      style.cardPadding * 2 +
        config.fontSize * style.labelLineHeight * 2 +
        4 +
        Math.max(10, config.fontSize - 2) * style.descriptionLineHeight
    )
  )
  const horizontal = config.direction === 'horizontal'
  const breadth = horizontal ? cardHeight : style.cardWidth
  const depthSize = horizontal ? style.cardWidth : cardHeight
  const collapsed = new Set(config.collapsible ? collapsedIds : [])
  const children = new Map<string, OrgChartItem[]>()
  for (const item of config.items) {
    const siblings = children.get(item.parentId) ?? []
    siblings.push(item)
    children.set(item.parentId, siblings)
  }
  const spans = new Map<string, number>()
  const span = (item: OrgChartItem): number => {
    const descendants = collapsed.has(item.id) ? [] : (children.get(item.id) ?? [])
    const size = Math.max(
      breadth,
      descendants.reduce((sum, child) => sum + span(child), 0) +
        Math.max(0, descendants.length - 1) * style.siblingGap
    )
    spans.set(item.id, size)
    return size
  }
  const roots = children.get('') ?? []
  const totalBreadth =
    roots.reduce((sum, item) => sum + span(item), 0) +
    Math.max(0, roots.length - 1) * style.siblingGap
  const cards: OrgChartCard[] = []
  const place = (item: OrgChartItem, offset: number, depth: number): void => {
    const size = spans.get(item.id) ?? breadth
    const cross = offset + (size - breadth) / 2 + style.padding
    const along = depth * (depthSize + style.levelGap) + style.padding
    const descendants = children.get(item.id) ?? []
    cards.push({
      ...item,
      x: horizontal ? along : cross,
      y: horizontal ? cross : along,
      width: style.cardWidth,
      height: cardHeight,
      depth,
      hasChildren: descendants.length > 0,
      collapsed: descendants.length > 0 && collapsed.has(item.id)
    })
    if (collapsed.has(item.id)) return
    let childOffset = offset
    for (const child of descendants) {
      place(child, childOffset, depth + 1)
      childOffset += (spans.get(child.id) ?? breadth) + style.siblingGap
    }
  }
  let rootOffset = 0
  for (const root of roots) {
    place(root, rootOffset, 0)
    rootOffset += (spans.get(root.id) ?? breadth) + style.siblingGap
  }
  const maxDepth = Math.max(0, ...cards.map((card) => card.depth))
  let contentWidth =
    style.padding * 2 +
    (horizontal ? (maxDepth + 1) * depthSize + maxDepth * style.levelGap : totalBreadth)
  let contentHeight =
    style.padding * 2 +
    (horizontal ? totalBreadth : (maxDepth + 1) * depthSize + maxDepth * style.levelGap)
  const mode = contentWidth > available ? 'compact' : 'tree'
  if (mode === 'compact') {
    const cardWidth = Math.max(
      style.minimumCardWidth,
      available - style.padding * 2 - maxDepth * style.compactIndent
    )
    cards.forEach((card, index) => {
      card.x = style.padding + card.depth * style.compactIndent
      card.y = style.padding + index * (cardHeight + style.compactGap)
      card.width = cardWidth
    })
    contentWidth = Math.max(
      available,
      style.padding * 2 + cardWidth + maxDepth * style.compactIndent
    )
    contentHeight =
      style.padding * 2 +
      cards.length * cardHeight +
      Math.max(0, cards.length - 1) * style.compactGap
  } else {
    const offset = Math.max(0, (available - contentWidth) / 2)
    for (const card of cards) card.x += offset
    contentWidth = Math.max(available, contentWidth)
  }
  const byId = new Map(cards.map((card) => [card.id, card]))
  const connectors = cards.flatMap((card) => {
    const parent = byId.get(card.parentId)
    if (!parent) return []
    if (mode === 'compact') {
      const start = { x: parent.x, y: parent.y + parent.height / 2 }
      const end = { x: card.x, y: card.y + card.height / 2 }
      const elbow = parent.x - style.compactIndent / 2
      return [
        {
          fromId: parent.id,
          toId: card.id,
          points: [start, { x: elbow, y: start.y }, { x: elbow, y: end.y }, end]
        }
      ]
    }
    const start = horizontal
      ? { x: parent.x + parent.width, y: parent.y + parent.height / 2 }
      : { x: parent.x + parent.width / 2, y: parent.y + parent.height }
    const end = horizontal
      ? { x: card.x, y: card.y + card.height / 2 }
      : { x: card.x + card.width / 2, y: card.y }
    const middle = horizontal ? (start.x + end.x) / 2 : (start.y + end.y) / 2
    return [
      {
        fromId: parent.id,
        toId: card.id,
        points: [
          start,
          horizontal ? { x: middle, y: start.y } : { x: start.x, y: middle },
          horizontal ? { x: middle, y: end.y } : { x: end.x, y: middle },
          end
        ]
      }
    ]
  })
  return { cards, connectors, width: contentWidth, height: contentHeight, mode }
}
