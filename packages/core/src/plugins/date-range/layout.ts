export const DATE_RANGE_LAYOUT = Object.freeze({
  inset: 12,
  gap: 12,
  labelGap: 6,
  inputHeight: 44,
  clearWidth: 64,
  stackWidth: 300,
  lineHeight: 1.4
})
export const DATE_RANGE_MESSAGES = Object.freeze({
  en: {
    start: 'Start date',
    end: 'End date',
    clear: 'Clear',
    empty: 'Choose a start and end date.',
    partial: 'Choose both dates to complete the range.',
    ready: 'Date range selected.',
    order: 'Start date must not be after end date.',
    bounds: 'Choose dates within the allowed range.'
  },
  zh: {
    start: '开始日期',
    end: '结束日期',
    clear: '清空',
    empty: '请选择开始和结束日期。',
    partial: '请选择完整的起止日期。',
    ready: '已选择日期范围。',
    order: '开始日期不能晚于结束日期。',
    bounds: '请选择允许范围内的日期。'
  }
})
export function dateRangeLocale(language: string | undefined): keyof typeof DATE_RANGE_MESSAGES {
  return language?.toLowerCase().startsWith('zh') ? 'zh' : 'en'
}
/** Coordinates match generated CSS; short authored frames clip, runtime frames scroll. */
export function dateRangeGeometry(width: number, fontSize: number) {
  const line = fontSize * DATE_RANGE_LAYOUT.lineHeight
  const stacked = width < DATE_RANGE_LAYOUT.stackWidth
  const contentWidth = Math.max(0, width - DATE_RANGE_LAYOUT.inset * 2)
  const fieldWidth = stacked
    ? contentWidth
    : Math.max(0, (contentWidth - DATE_RANGE_LAYOUT.gap) / 2)
  const fieldTop = DATE_RANGE_LAYOUT.inset + line + DATE_RANGE_LAYOUT.gap
  const fieldHeight = line + DATE_RANGE_LAYOUT.labelGap + DATE_RANGE_LAYOUT.inputHeight
  const secondTop = stacked ? fieldTop + fieldHeight + DATE_RANGE_LAYOUT.gap : fieldTop
  return {
    line,
    stacked,
    fieldWidth,
    fieldTop,
    secondTop,
    fieldHeight,
    footerTop: secondTop + fieldHeight + DATE_RANGE_LAYOUT.gap,
    secondLeft: stacked
      ? DATE_RANGE_LAYOUT.inset
      : DATE_RANGE_LAYOUT.inset + fieldWidth + DATE_RANGE_LAYOUT.gap
  }
}
