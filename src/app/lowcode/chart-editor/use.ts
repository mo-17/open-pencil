import { isEqual } from 'es-toolkit'
import { computed, onScopeDispose, ref, shallowRef, watch, type Ref } from 'vue'

import { CHART_MODULE_LIMITS } from '@open-pencil/core/plugins'
import type { SceneNode } from '@open-pencil/scene-graph'
import type { JSONObject } from '@open-pencil/scene-graph/primitives'

import { useModuleScalarCommit } from '@/app/lowcode/module-editor/scalar'

import {
  chartDataRows,
  parseChartData,
  type ChartDataCommit,
  type ChartDataRow,
  type ChartDataError
} from './index'

interface DraftRow extends ChartDataRow {
  key: number
}

/** Manual paired edits use the same owner/config authority as scalar module properties. */
export function useChartDataDraft(
  owner: () => SceneNode | undefined,
  config: () => JSONObject,
  submit: (request: ChartDataCommit) => void,
  active?: Readonly<Ref<boolean>>
) {
  let nextKey = 0
  let inputKey: number | undefined
  let disposed = false
  let snapshot: Pick<ChartDataCommit, 'owner' | 'previousModule'> | undefined
  const generation = ref(0)
  const rows = shallowRef<DraftRow[]>([])
  const error = ref<ChartDataError>()
  const data = () => rows.value.map(({ label, value }) => ({ label, value }))
  const dirty = computed(() => !isEqual(data(), chartDataRows(config())))
  const authority = useModuleScalarCommit(
    owner,
    config,
    (request) => {
      if (
        snapshot &&
        snapshot.owner === request.owner &&
        isEqual(snapshot.previousModule, request.previousModule)
      )
        submit({ ...snapshot, value: data() })
    },
    active
  )

  function restore(): void {
    generation.value++
    inputKey = undefined
    snapshot = {
      owner: owner(),
      previousModule: structuredClone(owner()?.interactiveProps?.module)
    }
    error.value = undefined
    rows.value = chartDataRows(config()).map((row) => ({ ...row, key: nextKey++ }))
  }
  watch(() => [owner(), config(), active?.value], restore, { flush: 'sync', immediate: true })
  onScopeDispose(() => {
    disposed = true
    inputKey = undefined
  })

  function available(renderedGeneration: number): boolean {
    return (
      !disposed &&
      active?.value !== false &&
      !!snapshot?.owner &&
      owner() === snapshot.owner &&
      renderedGeneration === generation.value
    )
  }
  function beginInput(key: number, renderedGeneration: number): void {
    inputKey =
      available(renderedGeneration) && rows.value.some((row) => row.key === key) ? key : undefined
    if (inputKey !== undefined) authority.beginInput(authority.ownerGeneration.value)
  }
  function input(key: number, field: keyof ChartDataRow, value: string | number): void {
    if (disposed || active?.value === false || inputKey !== key) return
    rows.value = rows.value.map((row) =>
      row.key === key ? { ...row, [field]: String(value) } : row
    )
    error.value = undefined
  }
  function add(label: string, renderedGeneration: number): void {
    if (!available(renderedGeneration) || rows.value.length >= CHART_MODULE_LIMITS.values) return
    rows.value = [...rows.value, { key: nextKey++, label, value: '0' }]
    inputKey = undefined
    error.value = undefined
  }
  function remove(key: number, renderedGeneration: number): void {
    if (!available(renderedGeneration) || rows.value.length <= 1) return
    rows.value = rows.value.filter((row) => row.key !== key)
    inputKey = undefined
    error.value = undefined
  }
  function cancel(renderedGeneration: number): void {
    if (available(renderedGeneration)) restore()
  }
  function apply(renderedGeneration: number): void {
    if (!available(renderedGeneration) || !dirty.value) return
    const parsed = parseChartData(config(), data())
    error.value = parsed.ok ? undefined : parsed.error
    if (!parsed.ok) return
    authority.beginInput(authority.ownerGeneration.value)
    authority.submit({ kind: 'value', value: data() })
  }
  return { rows, dirty, error, generation, beginInput, input, add, remove, cancel, apply }
}
