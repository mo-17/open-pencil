import { describe, expect, test } from 'bun:test'

import {
  modelPlan,
  modelRequired,
  normalizeModelApplication,
  relationalApplication
} from './helpers'

describe('NestJS public foreign-key target projection', () => {
  test('rejects probing a hidden target owner through a separately writable foreign-key field', () => {
    const application = relationalApplication()
    const child = application.dataModel.entities[0]
    child.fields.push({ id: 'seller_id', name: 'seller_id', type: 'uuid', nullable: true })
    modelRequired(child.foreignKeys)[0].fields = ['seller_id', 'folder_id']
    modelRequired(application.httpApi).resources[0].createFields?.push('seller_id', 'folder_id')
    modelRequired(application.httpApi).resources[0].updateFields?.push('seller_id', 'folder_id')
    modelRequired(application.httpApi).resources[1].readFields = ['id', 'title']
    application.auth.rowAccess.push({
      id: 'folders-public',
      entityId: 'folders',
      effect: 'allow',
      operations: ['select'],
      principal: { kind: 'anonymous' }
    })
    const parsed = normalizeModelApplication(application)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) throw new Error('Expected valid provider-neutral fixture')
    const result = modelPlan(parsed.value)
    expect(result.ok).toBe(false)
    expect(
      result.diagnostics.some((entry) =>
        entry.message.includes('explicitly exposed by a public-readable HTTP resource')
      )
    ).toBe(true)
  })

  test('keeps private matching-owner references valid without publicly exposing the owner', () => {
    const application = relationalApplication()
    modelRequired(application.httpApi).resources[1].readFields = ['id', 'title']
    const parsed = normalizeModelApplication(application)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) throw new Error('Expected valid provider-neutral fixture')
    expect(modelPlan(parsed.value).ok).toBe(true)
  })
})
