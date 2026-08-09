import type { DataGridColumnV1, DataGridRowV1 } from './index'

export const DEFAULT_DATA_GRID_COLUMNS: DataGridColumnV1[] = [
  {
    id: 'name',
    label: 'Name',
    type: 'text',
    align: 'start',
    width: 240,
    sortable: true,
    filterable: true
  },
  {
    id: 'status',
    label: 'Status',
    type: 'text',
    align: 'start',
    width: 160,
    sortable: true,
    filterable: true
  },
  {
    id: 'score',
    label: 'Score',
    type: 'number',
    align: 'end',
    width: 120,
    sortable: true,
    filterable: false
  }
]

export const DEFAULT_DATA_GRID_ROWS: DataGridRowV1[] = [
  { id: 'landing', cells: ['Landing page', 'Ready', 98] },
  { id: 'mobile', cells: ['Mobile app', 'Review', 84] },
  { id: 'system', cells: ['Design system', 'Draft', 72] }
]

DEFAULT_DATA_GRID_COLUMNS.forEach(Object.freeze)
DEFAULT_DATA_GRID_ROWS.forEach((row) => {
  Object.freeze(row.cells)
  Object.freeze(row)
})
Object.freeze(DEFAULT_DATA_GRID_COLUMNS)
Object.freeze(DEFAULT_DATA_GRID_ROWS)
