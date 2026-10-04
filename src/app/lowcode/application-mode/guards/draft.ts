import { computed, onScopeDispose, ref, watch } from 'vue'

import {
  LOWCODE_APPLICATION_GUARD_EXPRESSION_MAX_LENGTH,
  LOWCODE_APPLICATION_GUARD_FALLBACK_MAX_LENGTH,
  LOWCODE_APPLICATION_GUARD_MESSAGE_MAX_LENGTH,
  validateLowcodeApplicationGuardExpression
} from '@open-pencil/lowcode'

import type { ApplicationGuardPanelModel, ApplicationGuardSource } from './types'

/** Two-field drafts reset synchronously before a stale blur or retained callback can commit. */
export function useApplicationGuardDraft(source: () => ApplicationGuardSource) {
  const expression = ref(source().expression)
  const detail = ref(source().detail)
  const generation = ref(0)
  let disposed = false
  function reset() {
    generation.value++
    expression.value = source().expression
    detail.value = source().detail
  }
  watch(() => [source().version, source().disabled, source().expression, source().detail], reset, {
    flush: 'sync'
  })
  onScopeDispose(() => {
    disposed = true
    generation.value++
  })
  return computed<ApplicationGuardPanelModel>(() => {
    const current = source()
    const captured = generation.value
    const currentExpression = expression.value
    const currentDetail = detail.value
    const dirty = currentExpression !== current.expression || currentDetail !== current.detail
    const expressionValid = validateLowcodeApplicationGuardExpression(currentExpression)
    const detailValid = current.detailValid(currentDetail)
    function live() {
      return (
        !disposed &&
        !current.disabled &&
        !source().disabled &&
        source().version === current.version &&
        generation.value === captured
      )
    }
    function edit(value: unknown, field: 'expression' | 'detail'): boolean {
      const detailLimit =
        current.kind === 'enter'
          ? LOWCODE_APPLICATION_GUARD_FALLBACK_MAX_LENGTH
          : LOWCODE_APPLICATION_GUARD_MESSAGE_MAX_LENGTH
      const limit =
        field === 'expression' ? LOWCODE_APPLICATION_GUARD_EXPRESSION_MAX_LENGTH : detailLimit
      if (!live() || typeof value !== 'string' || value.length > limit) return false
      const target = field === 'expression' ? expression : detail
      if (target.value === value) return false
      target.value = value
      generation.value++
      return true
    }
    return {
      kind: current.kind,
      version: captured,
      disabled: current.disabled,
      configured: current.configured,
      expression: currentExpression,
      detail: currentDetail,
      dirty,
      expressionValid,
      detailValid,
      canApply: !current.disabled && dirty && expressionValid && detailValid,
      editExpression: (value) => edit(value, 'expression'),
      editDetail: (value) => edit(value, 'detail'),
      apply() {
        if (!live() || !dirty || !expressionValid || !detailValid) return false
        return current.commit({ expression: currentExpression, detail: currentDetail })
      },
      cancel() {
        if (live()) reset()
      },
      remove() {
        if (!live() || !current.configured) return false
        return current.commit(undefined)
      }
    }
  })
}
