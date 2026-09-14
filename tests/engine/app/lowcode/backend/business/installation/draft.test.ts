import { describe, expect, test } from 'bun:test'

import { reactive, toRaw } from 'vue'

import { parseBackendApplicationSpecV1 } from '@open-pencil/lowcode/backend'

import { composeBusinessModules } from '@/app/lowcode/backend/business/composition'
import { addBackendEntity, removeBackendEntity } from '@/app/lowcode/backend/draft'
import { addNestJSEntity, removeNestJSEntity } from '@/app/lowcode/backend/nestjs-draft'

import { moduleInstallationFixture } from './helpers'

describe('modular application draft edits', () => {
  test('deletes a custom module table through the reactive editor draft', async () => {
    const fixture = await moduleInstallationFixture()
    const composition = composeBusinessModules(fixture.application, ['service-desk'], {
      adoptExisting: ['customer-crm']
    })
    const application = reactive(composition.application)
    const before = structuredClone(toRaw(application))
    const entity = addNestJSEntity(application, 'notes', 'service-desk')
    expect(application.dataModel.entities.some((entry) => entry.id === entity.id)).toBe(true)
    removeNestJSEntity(application, entity.id)
    expect(toRaw(application)).toEqual(before)
  })
  test('requires an explicit module and preserves ownership when adding and removing a table', async () => {
    const fixture = await moduleInstallationFixture()
    const { application } = composeBusinessModules(fixture.application, ['service-desk'], {
      adoptExisting: ['customer-crm']
    })
    const before = structuredClone(application)
    expect(() => addNestJSEntity(application, 'notes')).toThrow('Select a business module')
    expect(() => addNestJSEntity(application, 'notes', 'missing')).toThrow(
      'Select a business module'
    )
    expect(() => addBackendEntity(application)).toThrow('module selector')
    expect(application).toEqual(before)
    const entity = addNestJSEntity(application, 'notes', 'service-desk')
    const module = application.modules?.modules.find((entry) => entry.id === 'service-desk')
    expect(module?.entityIds).toContain(entity.id)
    expect(module?.resourceIds).toContain('notes')
    expect(parseBackendApplicationSpecV1(application).ok).toBe(true)
    expect(() => removeBackendEntity(application, entity.id)).toThrow()
    removeNestJSEntity(application, entity.id)
    expect(application).toEqual(before)
  })

  test('cannot remove the shared account or a command-owned business entity', async () => {
    const fixture = await moduleInstallationFixture()
    const { application } = composeBusinessModules(fixture.application, ['service-desk'], {
      adoptExisting: ['customer-crm']
    })
    const before = structuredClone(application)
    expect(() => removeNestJSEntity(application, 'business-users')).toThrow()
    const business = application.modules?.modules.find((entry) => entry.id === 'service-desk')
    const entityId = business?.entityIds[0]
    if (!entityId) throw new Error('Missing service entity')
    expect(() => removeNestJSEntity(application, entityId)).toThrow()
    expect(application).toEqual(before)
  })
})
