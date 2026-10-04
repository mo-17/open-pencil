import * as v from 'valibot'

import type { LowcodeApplicationPageV1, LowcodeApplicationV1 } from '@open-pencil/scene-graph'

import { applicationDataRecord } from './data'
import { applicationEnterGuardSchema, applicationLeaveConfirmSchema } from './guards'

export const LOWCODE_APPLICATION_PLUGIN_KEY = 'lowcode/application'
export const LOWCODE_APPLICATION_PAGE_PLUGIN_KEY = 'lowcode/applicationPage'
export const LOWCODE_APPLICATION_PAGE_ROLES = ['application', 'reference', 'components'] as const
export const LOWCODE_APPLICATION_STATE_RETENTIONS = ['reset', 'preserve'] as const
export const LOWCODE_APPLICATION_ID_MAX_LENGTH = 512

export type LowcodeApplicationValidation =
  | { ok: true; value: LowcodeApplicationV1 }
  | { ok: false; reason: string }
export type LowcodeApplicationPageValidation =
  | { ok: true; value: LowcodeApplicationPageV1 }
  | { ok: false; reason: string }

const referenceSchema = v.pipe(
  v.string(),
  v.minLength(1),
  v.maxLength(LOWCODE_APPLICATION_ID_MAX_LENGTH),
  v.check(
    (value) =>
      value.trim() === value &&
      Array.from(value).every((character) => {
        const code = character.charCodeAt(0)
        return code > 31 && (code < 127 || code > 159)
      })
  )
)
const applicationSchema = v.strictObject({
  version: v.literal(1),
  enabled: v.boolean(),
  startPageId: v.exactOptional(referenceSchema),
  shell: v.exactOptional(
    v.strictObject({
      frameNodeId: referenceSchema,
      slotNodeId: referenceSchema
    })
  )
})
const applicationPageSchema = v.strictObject({
  version: v.literal(1),
  role: v.picklist(LOWCODE_APPLICATION_PAGE_ROLES),
  entryNodeId: v.exactOptional(referenceSchema),
  stateRetention: v.exactOptional(v.picklist(LOWCODE_APPLICATION_STATE_RETENTIONS)),
  enterGuard: v.exactOptional(applicationEnterGuardSchema),
  leaveConfirm: v.exactOptional(applicationLeaveConfirmSchema)
})

/** Closed data-only contract; returns a detached canonical value without invoking accessors. */
export function validateLowcodeApplication(value: unknown): LowcodeApplicationValidation {
  const data = applicationDataRecord(value)
  if (data && Object.hasOwn(data, 'shell')) data.shell = applicationDataRecord(data.shell)
  const parsed = v.safeParse(applicationSchema, data)
  return parsed.success
    ? { ok: true, value: parsed.output }
    : {
        ok: false,
        reason: 'Expected a closed application version 1 policy with bounded identifiers.'
      }
}

export function validateLowcodeApplicationPage(value: unknown): LowcodeApplicationPageValidation {
  const data = applicationDataRecord(value)
  if (data) {
    for (const key of ['enterGuard', 'leaveConfirm'])
      if (Object.hasOwn(data, key)) data[key] = applicationDataRecord(data[key])
  }
  const parsed = v.safeParse(applicationPageSchema, data)
  return parsed.success
    ? { ok: true, value: parsed.output }
    : {
        ok: false,
        reason: 'Expected a closed application page version 1 policy with bounded identifiers.'
      }
}
