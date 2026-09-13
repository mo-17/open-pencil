import { describe, expect, test } from 'bun:test'

import {
  canonicalBackendApplicationBytes,
  canonicalBackendApplicationV2Bytes,
  digestBackendApplication,
  digestBackendApplicationV2,
  lowerBackendApplicationSpecV1ToV2,
  parseBackendApplicationSpecV1,
  parseBackendApplicationSpecV2
} from '@open-pencil/lowcode/backend'

import { backendApplicationFixture } from '../fixture'
import { httpApplication, httpApplicationV2, httpResource } from './fixtures'

describe('Backend HTTP API normalization and version compatibility', () => {
  test('normalizes resource and set order without mutating the submitted contract', async () => {
    const left = httpApplication()
    left.httpApi.resources.push(httpResource('archived-api', '/api/archived-notes'))
    const before = structuredClone(left)
    const right = structuredClone(left)
    right.httpApi.resources.reverse()
    right.httpApi.authentication.algorithms.reverse()
    for (const resource of right.httpApi.resources) {
      resource.operations.reverse()
      resource.readFields.reverse()
      resource.createFields?.reverse()
      resource.updateFields?.reverse()
    }
    const parsed = parseBackendApplicationSpecV1(left)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok || !parsed.value.httpApi) throw new Error('valid HTTP API must be retained')
    expect(parsed.value.httpApi.authentication.algorithms).toEqual(['ES256', 'RS256'])
    expect(parsed.value.httpApi.resources.map((resource) => resource.id)).toEqual([
      'archived-api',
      'notes-api'
    ])
    expect(parsed.value.httpApi.resources[1]).toEqual({
      id: 'notes-api',
      path: '/api/notes',
      entityId: 'notes',
      operations: ['create', 'delete', 'list', 'read', 'update'],
      readFields: ['body', 'created_at', 'id', 'owner_id', 'title'],
      createFields: ['body', 'title'],
      updateFields: ['body', 'title'],
      maxPageSize: 25
    })
    expect(left).toEqual(before)
    expect(canonicalBackendApplicationBytes(left)).toEqual(canonicalBackendApplicationBytes(right))
    expect(await digestBackendApplication(left)).toBe(await digestBackendApplication(right))
  })

  test('preserves exact legacy V1/V2 digests when no HTTP API is authored', async () => {
    // Captured before N0: these existing fixture bytes must not gain default httpApi data.
    const legacy = backendApplicationFixture()
    expect(await digestBackendApplication(legacy)).toBe(
      'Yst9_quRKw5VHekNAhpOTD96aD82YZ-a5OPdKWEQ7Fs'
    )
    expect(canonicalBackendApplicationBytes(legacy).length).toBe(1136)
    const lowered = lowerBackendApplicationSpecV1ToV2(legacy)
    expect(lowered.ok).toBe(true)
    if (!lowered.ok) throw new Error('legacy fixture must lower')
    expect(Object.hasOwn(lowered.value, 'httpApi')).toBe(false)
    expect(await digestBackendApplicationV2(lowered.value)).toBe(
      'cesAVYY8tDg16wC-7vmRKKgYodi-hafT-sbYGHz5xzM'
    )
    expect(canonicalBackendApplicationV2Bytes(lowered.value).length).toBe(1567)
  })

  test('retains HTTP API through V1-to-V2 lowering and V2 canonical serialization', async () => {
    const source = httpApplication()
    const v1 = parseBackendApplicationSpecV1(source)
    const lowered = lowerBackendApplicationSpecV1ToV2(source)
    expect(v1.ok && lowered.ok).toBe(true)
    if (!v1.ok || !lowered.ok) throw new Error('valid HTTP API must lower')
    expect(lowered.value.httpApi).toEqual(v1.value.httpApi)
    const v2 = parseBackendApplicationSpecV2(lowered.value)
    expect(v2.ok).toBe(true)
    if (!v2.ok) throw new Error('lowered HTTP API must parse')
    expect(v2.value.httpApi).toEqual(v1.value.httpApi)
    const reordered = structuredClone(lowered.value)
    reordered.httpApi?.resources[0].operations.reverse()
    expect(await digestBackendApplicationV2(reordered)).toBe(
      await digestBackendApplicationV2(v2.value)
    )
  })

  test('binds authored paths and field projections into V1 and V2 digests', async () => {
    const original = httpApplication()
    const changedPath = structuredClone(original)
    changedPath.httpApi.resources[0].path = '/api/renamed-notes'
    const changedFields = structuredClone(original)
    changedFields.httpApi.resources[0].readFields = ['id', 'title']
    expect(await digestBackendApplication(changedPath)).not.toBe(
      await digestBackendApplication(original)
    )
    expect(await digestBackendApplication(changedFields)).not.toBe(
      await digestBackendApplication(original)
    )
    const v2 = httpApplicationV2()
    const changedV2 = structuredClone(v2)
    changedV2.httpApi.resources[0].path = '/api/renamed-notes'
    expect(await digestBackendApplicationV2(changedV2)).not.toBe(
      await digestBackendApplicationV2(v2)
    )
  })
})
