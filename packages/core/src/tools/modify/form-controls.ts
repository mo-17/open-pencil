import {
  FORM_VALUE_BINDING_MAX_REPAIRS,
  planValidatedFormValueBindings,
  type FormControlsAudit
} from '@open-pencil/lowcode'

import type { FigmaAPI } from '#core/figma-api'
import { defineTool } from '#core/tools/schema'

import { updateLowcodeNodes } from './lowcode'

type EnsureResult =
  | {
      ok: true
      data: {
        dryRun: boolean
        audit: FormControlsAudit
        createdStates: number
        boundNodeIds: string[]
      }
    }
  | { ok: false; error: string }

type UpdateResult = { ok: true; data: { updated: number } } | { ok: false; error: string }

function fail(error: string): EnsureResult {
  return { ok: false, error }
}

function scopeId(figma: FigmaAPI, requested?: string): string {
  return requested ?? figma.currentPage.id
}

export const ensureFormValueBindings = defineTool({
  name: 'ensure_form_value_bindings',
  mutates: true,
  description: `Create page-scoped state and bindings.value for validated form controls that currently have no value binding. scope_id may reference a CANVAS, FORM, or one supported control and defaults to the current page. Component-master subtrees are excluded and a scope inside a component master is rejected; bind component fields to document state instead. Existing state, valid/invalid authored bindings, other binding channels, validation, events, and interactiveProps are preserved. At most ${FORM_VALUE_BINDING_MAX_REPAIRS} controls are repaired per call; larger scopes fail before mutation and must be narrowed. All state declarations and bindings are validated before mutation and committed as one editor undo batch. dry_run returns a bounded audit and repair summary without mutation.`,
  params: {
    scope_id: {
      type: 'string',
      description: 'Optional CANVAS, FORM, or form-control node id; defaults to the current page'
    },
    dry_run: {
      type: 'boolean',
      description: 'Return the planned state/binding repairs without mutating (default false)'
    },
    expected_scene_version: {
      type: 'number',
      description: 'Optional optimistic-concurrency precondition for editor/MCP hosts'
    }
  },
  execute: (figma, { scope_id, dry_run, expected_scene_version }, ctx): EnsureResult => {
    if (expected_scene_version !== undefined) {
      if (!ctx?.editor) return fail('expected_scene_version requires an editor-backed MCP host')
      if (ctx.editor.state.sceneVersion !== expected_scene_version) {
        return fail(
          `Scene version conflict: expected ${expected_scene_version}, current ${ctx.editor.state.sceneVersion}`
        )
      }
    }

    const planned = planValidatedFormValueBindings(figma.graph, scopeId(figma, scope_id))
    if (!planned.ok) return planned
    const { audit, bindings, nextState, pageId } = planned.data
    const boundNodeIds = bindings.map((binding) => binding.nodeId)
    if (dry_run === true || bindings.length === 0) {
      return {
        ok: true,
        data: {
          dryRun: dry_run === true,
          audit,
          createdStates: bindings.length,
          boundNodeIds
        }
      }
    }
    const apply = (): UpdateResult =>
      updateLowcodeNodes.execute(
        figma,
        {
          operations: [
            { id: pageId, patch: { state: nextState } },
            ...bindings.map((binding) => ({
              id: binding.nodeId,
              patch: { bindings: binding.bindings }
            }))
          ],
          ...(expected_scene_version === undefined ? {} : { expected_scene_version })
        },
        ctx
      ) as UpdateResult
    const updated = ctx?.editor
      ? ctx.editor.undo.runBatch('AI: ensure_form_value_bindings', apply)
      : apply()
    if (!updated.ok) return updated
    return {
      ok: true,
      data: {
        dryRun: false,
        audit,
        createdStates: bindings.length,
        boundNodeIds
      }
    }
  }
})
