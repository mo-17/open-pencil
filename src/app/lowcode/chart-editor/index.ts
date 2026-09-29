import { isEqual } from 'es-toolkit'

import type { Editor } from '@open-pencil/core/editor'
import {
  CHART_MODULE_LIMITS,
  createChartModuleInstance,
  resolveChartModule
} from '@open-pencil/core/plugins'
import type { JSONObject } from '@open-pencil/scene-graph/primitives'

import {
  currentModuleEditorOwner,
  type ModuleEditorCommit
} from '@/app/lowcode/module-editor/owner'

/** Numeric drafts remain strings so blank, partial and invalid input is never coerced to zero. */
export interface ChartDataRow {
  label: string
  value: string
}
export type ChartDataCommit = ModuleEditorCommit<ChartDataRow[]>
export type ChartDataError = 'count' | 'label' | 'value' | 'negative' | 'config'
type ChartDataResult =
  | { ok: true; labels: string[]; values: number[] }
  | { ok: false; error: ChartDataError }

export function chartDataRows(config: JSONObject): ChartDataRow[] {
  const labels = Array.isArray(config.labels) ? config.labels : []
  const values = Array.isArray(config.values) ? config.values : []
  return values.map((value, index) => ({
    label: typeof labels[index] === 'string' ? labels[index] : '',
    value: typeof value === 'number' ? String(value) : ''
  }))
}

export function parseChartData(config: JSONObject, rows: readonly ChartDataRow[]): ChartDataResult {
  if (rows.length < 1 || rows.length > CHART_MODULE_LIMITS.values)
    return { ok: false, error: 'count' }
  if (rows.some((row) => row.label.length > CHART_MODULE_LIMITS.label))
    return { ok: false, error: 'label' }
  const values: number[] = []
  for (const row of rows) {
    const source = row.value.trim()
    // Decimal/exponent notation is accepted; JS-specific hex/binary coercion is not.
    if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(source))
      return { ok: false, error: 'value' }
    const value = Number(source)
    if (!Number.isFinite(value) || Math.abs(value) > CHART_MODULE_LIMITS.value)
      return { ok: false, error: 'value' }
    values.push(value)
  }
  if (
    (config.chartType === 'pie' || config.chartType === 'donut') &&
    values.some((value) => value < 0)
  )
    return { ok: false, error: 'negative' }
  const labels = rows.map((row) => row.label)
  try {
    createChartModuleInstance({ ...config, labels, values })
    return { ok: true, labels, values }
  } catch {
    return { ok: false, error: 'config' }
  }
}

export function commitChartData(
  editor: Pick<Editor, 'graph' | 'state' | 'updateNodeWithUndo'>,
  request: ChartDataCommit
): boolean {
  const owner = currentModuleEditorOwner(editor, request)
  const resolution = resolveChartModule(request.previousModule)
  if (!owner || !resolution?.ok) return false
  const parsed = parseChartData(resolution.config, request.value)
  if (!parsed.ok) return false
  const module = createChartModuleInstance({
    ...resolution.config,
    labels: parsed.labels,
    values: parsed.values
  })
  if (isEqual(module, request.previousModule)) return true
  editor.updateNodeWithUndo(
    owner.id,
    { interactiveProps: { ...owner.interactiveProps, module } },
    'Edit chart data'
  )
  return true
}
