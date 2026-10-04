import {
  validateLowcodeApplicationEnterGuard,
  validateLowcodeApplicationLeaveConfirm,
  validateLowcodeApplicationPage
} from '@open-pencil/lowcode'
import type { SceneNode } from '@open-pencil/scene-graph'

import { readApplicationMode } from '../model'
import { updateApplicationConfiguration } from '../mutation'
import type { ApplicationModeEditor } from '../types'
import { applicationGuardFallbackValid } from './model'

/** An optional rule is written/removed atomically; runtime decisions never mutate authored state. */
export function setApplicationPageGuard(
  editor: ApplicationModeEditor,
  page: SceneNode,
  kind: unknown,
  value: unknown,
  label: string
): boolean {
  if (kind !== 'enter' && kind !== 'leave') return false
  if (editor.graph.getNode(editor.state.currentPageId) !== page) return false
  if (readApplicationMode(editor).guardsDisabled) return false
  const current = validateLowcodeApplicationPage(page.lowcodeApplicationPage)
  if (!current.ok || current.value.role !== 'application') return false
  const next = structuredClone(current.value)
  if (kind === 'enter') {
    if (value === undefined) delete next.enterGuard
    else {
      const guard = validateLowcodeApplicationEnterGuard(value)
      if (!guard.ok || !applicationGuardFallbackValid(editor, page, guard.value.fallback))
        return false
      next.enterGuard = guard.value
    }
  } else {
    if (value === undefined) delete next.leaveConfirm
    else {
      const confirm = validateLowcodeApplicationLeaveConfirm(value)
      if (!confirm.ok) return false
      next.leaveConfirm = confirm.value
    }
  }
  return updateApplicationConfiguration(editor, page, { lowcodeApplicationPage: next }, true, label)
}
