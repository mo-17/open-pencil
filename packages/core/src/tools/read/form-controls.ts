import {
  FORM_CONTROLS_AUDIT_DEFAULT_LIMIT,
  FORM_CONTROLS_AUDIT_MAX_LIMIT,
  auditValidatedFormControls
} from '@open-pencil/lowcode'

import type { FigmaAPI } from '#core/figma-api'
import { defineTool } from '#core/tools/schema'

function scopeId(figma: FigmaAPI, requested?: string): string {
  return requested ?? figma.currentPage.id
}

export const auditFormControls = defineTool({
  name: 'audit_form_controls',
  description:
    'Audit validated INPUT/TEXTAREA/SELECT/RADIO/DATEPICKER/CHECKBOX/SWITCH controls in a page, FORM subtree, or single control. Reports missing, valid, and invalid bindings.value plus the exact page-state declaration that ensure_form_value_bindings would create. Component-master subtrees are excluded because their fields cannot use page state. Results default to 50 controls, are capped at 200, and include total/returned/truncated metadata. Defaults to the current page and never mutates.',
  params: {
    scope_id: {
      type: 'string',
      description: 'Optional CANVAS, FORM, or form-control node id; defaults to the current page'
    },
    limit: {
      type: 'number',
      description: `Maximum controls returned (default ${FORM_CONTROLS_AUDIT_DEFAULT_LIMIT}, max ${FORM_CONTROLS_AUDIT_MAX_LIMIT})`,
      default: FORM_CONTROLS_AUDIT_DEFAULT_LIMIT,
      min: 1,
      max: FORM_CONTROLS_AUDIT_MAX_LIMIT
    }
  },
  execute: (figma, { scope_id, limit }) =>
    auditValidatedFormControls(figma.graph, scopeId(figma, scope_id), { limit })
})
