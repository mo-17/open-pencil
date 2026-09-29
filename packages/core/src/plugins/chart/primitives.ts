import type { ChartLayout, ChartText } from './types'

export const CHART_PALETTE = Object.freeze([
  '#0D9488',
  '#D97706',
  '#9333EA',
  '#DB2777',
  '#0284C7',
  '#4D7C0F',
  '#DC2626'
])
export const CHART_TEXT_COLOR = '#334155'
export const CHART_AXIS_COLOR = '#CBD5E1'
export const CHART_FONT_SIZE = 12

export function chartNumber(value: number): number {
  return Math.round(value * 1000) / 1000
}

/** Conservative one-em character budget is independent of machine fonts; full copy is retained. */
export function chartLabel(text: string, width: number, fontSize: number): string {
  const normalized = text.replaceAll(/[\r\n\t]/g, ' ')
  const chars = Array.from(normalized)
  const capacity = Math.floor(width / fontSize)
  if (capacity <= 0) return ''
  return chars.length <= capacity ? normalized : chars.slice(0, capacity - 1).join('') + '…'
}

export function addChartText(
  model: ChartLayout,
  fullText: string,
  box: Pick<ChartText, 'x' | 'y' | 'width' | 'align'>,
  kind: ChartText['kind'] = 'category',
  count = 0
): void {
  const x = Math.max(0, box.x),
    y = Math.max(0, box.y)
  const width = Math.max(0, Math.min(box.width, model.width - x))
  const height = CHART_FONT_SIZE * 1.5
  if (width < CHART_FONT_SIZE || y + height > model.height) return
  const text = chartLabel(fullText, width, CHART_FONT_SIZE)
  model.texts.push({
    text,
    fullText,
    kind,
    count,
    x: chartNumber(x),
    y: chartNumber(y),
    width: chartNumber(width),
    height,
    fontSize: CHART_FONT_SIZE,
    align: box.align,
    color: CHART_TEXT_COLOR,
    fontWeight: 400
  })
}

export function addHiddenChartLabels(
  model: ChartLayout,
  x: number,
  y: number,
  width: number
): void {
  if (model.hiddenLabelCount > 0)
    addChartText(
      model,
      '+' + model.hiddenLabelCount,
      { x, y, width, align: 'right' },
      'overflow',
      model.hiddenLabelCount
    )
}
