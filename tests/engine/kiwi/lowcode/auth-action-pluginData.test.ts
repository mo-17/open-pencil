import { describe, expect, test } from 'bun:test'

import { OPEN_PENCIL_PLUGIN_ID } from '@open-pencil/fig/node-change'
import type { PluginData } from '@open-pencil/kiwi/fig/codec'
import type { PluginDataEntry, SceneNode, SupabaseAuthAction } from '@open-pencil/scene-graph'

import {
  extractLowcodeAndPluginData,
  LOWCODE_EVENTS_KEY,
  serializeLowcodeFields
} from '#core/kiwi/fig/node-change/lowcode-plugin-data'

/**
 * Phase 3 §2.v2 step 1 — `SupabaseAuthAction` persistence.
 * Phase 3 §2.v3 step 1 — adds the `signUp` operation (decision §2.v3.2 a:
 * extends the operation union, no Kiwi schema change — signUp is just more
 * JSON on the same `lowcode/events` channel).
 *
 * Decision §2.v2.2 (h): the 7th action kind rides the existing
 * `lowcode/events` pluginData channel (the events payload is schema-free
 * JSON, so a new `ActionDef` member serialises without a Kiwi schema
 * change). These pin that a signIn (with email/password exprs), a signUp,
 * and a signOut survive serialize → extract unchanged.
 */
function makeNode(fields: Partial<SceneNode> = {}): SceneNode {
  return {
    type: 'RECTANGLE',
    pluginData: [] as PluginDataEntry[],
    state: undefined,
    bindings: undefined,
    events: undefined,
    interactiveProps: undefined,
    renderCondition: undefined,
    lowcodeDocumentState: undefined,
    ...fields
  } as SceneNode
}

function makeNc(pluginData: PluginData[]): { pluginData: PluginData[] } {
  return { pluginData }
}

const SIGN_IN: SupabaseAuthAction = {
  id: 'a1',
  kind: 'supabaseAuth',
  operation: 'signIn',
  emailExpr: 'emailInput',
  passwordExpr: 'passwordInput',
  errorTarget: 'authError'
}

const SIGN_OUT: SupabaseAuthAction = {
  id: 'a2',
  kind: 'supabaseAuth',
  operation: 'signOut'
}

const SIGN_UP: SupabaseAuthAction = {
  id: 'a3',
  kind: 'supabaseAuth',
  operation: 'signUp',
  emailExpr: 'emailInput',
  passwordExpr: 'passwordInput',
  errorTarget: 'authError'
}

const RESET_PASSWORD: SupabaseAuthAction = {
  id: 'a4',
  kind: 'supabaseAuth',
  operation: 'resetPassword',
  emailExpr: 'emailInput',
  errorTarget: 'authError'
}

const UPDATE_PASSWORD: SupabaseAuthAction = {
  id: 'a5',
  kind: 'supabaseAuth',
  operation: 'updatePassword',
  passwordExpr: 'newPasswordInput'
}

describe('SupabaseAuthAction persistence (Phase 3 §2.v2)', () => {
  test('a signIn action serialises into a single lowcode/events entry', () => {
    const node = makeNode({ events: { onClick: [SIGN_IN] } })
    const entries = serializeLowcodeFields(node)
    expect(entries).toHaveLength(1)
    expect(entries[0].key).toBe(LOWCODE_EVENTS_KEY)
    expect(entries[0].pluginId).toBe(OPEN_PENCIL_PLUGIN_ID)
    expect(JSON.parse(entries[0].value)).toEqual({ onClick: [SIGN_IN] })
  })

  test('signIn + signOut round-trip through serialize → extract unchanged', () => {
    const events = { onClick: [SIGN_IN], onSubmit: [SIGN_OUT] }
    const [entry] = serializeLowcodeFields(makeNode({ events }))
    const result = extractLowcodeAndPluginData(
      makeNc([{ pluginID: OPEN_PENCIL_PLUGIN_ID, key: entry.key, value: entry.value }])
    )
    expect(result.events).toEqual(events)
  })

  test('signUp round-trips with its email/password exprs (Phase 3 §2.v3)', () => {
    const events = { onClick: [SIGN_UP, SIGN_OUT] }
    const [entry] = serializeLowcodeFields(makeNode({ events }))
    const result = extractLowcodeAndPluginData(
      makeNc([{ pluginID: OPEN_PENCIL_PLUGIN_ID, key: entry.key, value: entry.value }])
    )
    expect(result.events).toEqual(events)
  })

  test('resetPassword (email-only) + updatePassword (password-only) round-trip (Phase 3 §2.v4)', () => {
    const events = { onClick: [RESET_PASSWORD], onSubmit: [UPDATE_PASSWORD] }
    const [entry] = serializeLowcodeFields(makeNode({ events }))
    const result = extractLowcodeAndPluginData(
      makeNc([{ pluginID: OPEN_PENCIL_PLUGIN_ID, key: entry.key, value: entry.value }])
    )
    expect(result.events).toEqual(events)
  })
})
