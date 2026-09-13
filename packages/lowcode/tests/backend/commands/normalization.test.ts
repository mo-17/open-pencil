import { describe, expect, test } from 'bun:test'

import {
  canonicalBackendApplicationBytes,
  deriveBackendApplicationCapabilities,
  deriveBackendApplicationCapabilitiesV2,
  lowerBackendApplicationSpecV1ToV2,
  parseBackendApplicationSpecV1,
  parseBackendApplicationSpecV2
} from '@open-pencil/lowcode/backend'

import { httpApplication } from '../http-api/fixtures'
import { commandApplication, required } from './fixture'

describe('Backend command canonical and V2 compatibility', () => {
  test('omitted commands preserve prior normalized documents and canonical bytes', () => {
    const application = httpApplication()
    const bytes = canonicalBackendApplicationBytes(application)
    const parsed = parseBackendApplicationSpecV1(application)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) throw new Error('Expected application')
    expect(Object.hasOwn(parsed.value, 'commands')).toBe(false)
    expect(canonicalBackendApplicationBytes(parsed.value)).toEqual(bytes)
  })
  test('sorts declarations and projections but preserves command execution order', () => {
    const application = commandApplication()
    const reordered = structuredClone(application)
    required(reordered.commands).commands.reverse()
    for (const command of required(reordered.commands).commands) {
      command.parameters.reverse()
      command.return.fields.reverse()
      for (const step of command.steps)
        if (step.kind !== 'assert') {
          step.fields.reverse()
          if (step.kind === 'data.mutate') step.values.reverse()
        }
    }
    expect(canonicalBackendApplicationBytes(application)).toEqual(
      canonicalBackendApplicationBytes(reordered)
    )
    required(reordered.commands).commands[1].steps.reverse()
    expect(parseBackendApplicationSpecV1(reordered).ok).toBe(false)
  })
  test('preserves and validates commands through V1-to-V2 and derives required capabilities', () => {
    const application = commandApplication()
    const parsed = parseBackendApplicationSpecV1(application)
    const lowered = lowerBackendApplicationSpecV1ToV2(application)
    expect(parsed.ok && lowered.ok).toBe(true)
    if (!parsed.ok || !lowered.ok) throw new Error(JSON.stringify([parsed, lowered]))
    expect(lowered.value.commands).toEqual(parsed.value.commands)
    expect(lowered.value.transactions.transactions).toEqual([])
    expect(deriveBackendApplicationCapabilitiesV2(lowered.value)).toEqual(
      deriveBackendApplicationCapabilities(application)
    )
    expect(deriveBackendApplicationCapabilities(application)).toEqual(
      expect.arrayContaining([
        'server.functions',
        'transactions.atomic',
        'server.http',
        'data.read',
        'data.write',
        'auth.identity'
      ])
    )
    const invalid = structuredClone(lowered.value)
    required(invalid.commands).commands[0].return.fields.push('private')
    expect(parseBackendApplicationSpecV2(invalid).ok).toBe(false)
  })
})
