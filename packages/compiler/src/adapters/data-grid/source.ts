/** Framework-neutral source shared by the reviewed local React and Vue runtimes. */
export const DATA_GRID_TYPES = `export type OpenPencilDataGridCell = string | number | boolean | null

export interface OpenPencilDataGridColumn {
  id: string
  label: string
  type: 'text' | 'number' | 'date' | 'boolean'
  align: 'start' | 'center' | 'end'
  width: number
  sortable: boolean
  filterable: boolean
}

export interface OpenPencilDataGridRow {
  id: string
  cells: readonly OpenPencilDataGridCell[]
}

export interface OpenPencilDataGridSort {
  columnId: string
  direction: 'ascending' | 'descending'
}

export interface OpenPencilDataGridFilter {
  columnId: string
  operator: 'contains' | 'equals' | 'greater-than' | 'less-than'
  value: OpenPencilDataGridCell
}

export interface OpenPencilDataGridConfig {
  data: {
    columns: readonly OpenPencilDataGridColumn[]
    rows: readonly OpenPencilDataGridRow[]
  }
  initialSort: OpenPencilDataGridSort | null
  filters: readonly OpenPencilDataGridFilter[]
  pageSize: number
  selectionMode: 'none' | 'single' | 'multiple'
  density: 'compact' | 'comfortable'
  showHeader: boolean
  showCsvTools?: boolean
  stickyHeader: boolean
  striped: boolean
  borderColor: string
  headerBackground: string
  textColor: string
  accentColor: string
  fontSize: number
}

`

export const DATA_GRID_CELL_RUNTIME = `function cellText(value: OpenPencilDataGridCell): string {
  if (value === null) return ''
  if (typeof value === 'boolean') return value ? 'True' : 'False'
  return String(value)
}

function compareCells(left: OpenPencilDataGridCell, right: OpenPencilDataGridCell): number {
  if (left === right) return 0
  if (left === null) return 1
  if (right === null) return -1
  if (typeof left === 'number' && typeof right === 'number') return left - right
  if (typeof left === 'boolean' && typeof right === 'boolean') return Number(left) - Number(right)
  return String(left).localeCompare(String(right), undefined, {
    numeric: true,
    sensitivity: 'base'
  })
}

function matchesFilter(
  value: OpenPencilDataGridCell,
  filter: OpenPencilDataGridFilter
): boolean {
  const comparison = compareCells(value, filter.value)
  if (filter.operator === 'equals') return comparison === 0
  if (filter.operator === 'greater-than') return comparison > 0
  if (filter.operator === 'less-than') return comparison < 0
  return cellText(value).toLocaleLowerCase().includes(cellText(filter.value).toLocaleLowerCase())
}

`

export const DATA_GRID_LAYOUT_RUNTIME = `function observeDataGridStickyHeader(
  viewport: HTMLElement,
  header: HTMLTableSectionElement,
  onChange: (fits: boolean) => void
): () => void {
  if (typeof ResizeObserver === 'undefined') {
    onChange(false)
    return () => {}
  }
  const body = header.parentElement?.querySelector('tbody')
  const update = () => {
    const rowHeight = body?.firstElementChild?.getBoundingClientRect().height ?? 0
    onChange(viewport.clientHeight >= header.getBoundingClientRect().height + Math.max(1, rowHeight))
  }
  const observer = new ResizeObserver(update)
  observer.observe(viewport)
  observer.observe(header)
  if (body) observer.observe(body)
  update()
  return () => observer.disconnect()
}

`
