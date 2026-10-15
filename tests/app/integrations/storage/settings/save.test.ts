import { expect, test } from 'bun:test'

import { saveS3SettingsDraft } from '@/app/integrations/storage/settings/s3-save'

function fixture() {
  let current = true
  let revision = 0
  const events: string[] = []
  const context = {
    fields: ['access-key-id', 'secret-access-key'] as const,
    validate: async () => true,
    isCurrent: () => current,
    persistenceRevision: () => revision,
    savePreferences: async () => {
      events.push('preferences')
      revision++
      return true
    },
    saveCredential: async (field: string) => {
      events.push(field)
      revision++
      return true
    }
  }
  return {
    context,
    events,
    leave: () => {
      current = false
    },
    persist: () => {
      revision++
    }
  }
}

test('invalid storage preferences never start any persistent mutation', async () => {
  const f = fixture()
  f.context.validate = async () => false
  expect(await saveS3SettingsDraft(f.context)).toBe('invalid')
  expect(f.events).toEqual([])
})

test('saving a captured S3 draft retains preference and credential order', async () => {
  const f = fixture()
  expect(await saveS3SettingsDraft(f.context)).toBe('saved')
  expect(f.events).toEqual(['preferences', 'access-key-id', 'secret-access-key'])
})

test('a rejected preference mutation before any persistence reports failure and skips secrets', async () => {
  const f = fixture()
  f.context.savePreferences = async () => false
  expect(await saveS3SettingsDraft(f.context)).toBe('failed')
  expect(f.events).toEqual([])
})

test('a credential failure after preferences committed reports partial and stops remaining writes', async () => {
  const f = fixture()
  f.context.saveCredential = async (field) => {
    f.events.push(field)
    throw new Error('Credential backend unavailable')
  }
  expect(await saveS3SettingsDraft(f.context)).toBe('partial')
  expect(f.events).toEqual(['preferences', 'access-key-id'])
})

test('an authority rotation before a failed secret write still reports a partial save', async () => {
  const f = fixture()
  f.context.savePreferences = async () => true
  f.context.saveCredential = async () => {
    f.persist()
    return false
  }
  expect(await saveS3SettingsDraft(f.context)).toBe('partial')
})

test('changing profiles while validation awaits rejects the old draft before all writes', async () => {
  const f = fixture()
  const validated = Promise.withResolvers<boolean>()
  f.context.validate = async () => validated.promise
  const saving = saveS3SettingsDraft(f.context)
  f.leave()
  validated.resolve(true)
  expect(await saving).toBe('stale')
  expect(f.events).toEqual([])
})

test('changing profiles after preferences committed does not start either old credential write', async () => {
  const f = fixture()
  f.context.savePreferences = async () => {
    f.events.push('preferences')
    f.persist()
    f.leave()
    return true
  }
  expect(await saveS3SettingsDraft(f.context)).toBe('stale')
  expect(f.events).toEqual(['preferences'])
})
