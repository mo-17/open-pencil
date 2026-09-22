import { describe, expect, test } from 'bun:test'

import type { StorageLike } from '@vueuse/core'
import { effectScope, ref } from 'vue'

import type { ManagedBackendPresetDraft } from '@/app/lowcode/preview-pane/managed-backend/presets'
import {
  LOCAL_KEYCLOAK_ISSUER,
  LOCAL_KEYCLOAK_JWKS
} from '@/app/lowcode/preview-pane/managed-backend/presets/identity'
import {
  MANAGED_BACKEND_CA_PATHS_KEY,
  useManagedBackendCAPaths
} from '@/app/lowcode/preview-pane/managed-backend/settings/ca-paths'
import { useManagedBackendCAPath } from '@/app/lowcode/preview-pane/managed-backend/settings/use'

function localStorageFixture(): StorageLike {
  const data = new Map<string, string>()
  return {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => void data.set(key, value),
    removeItem: (key) => void data.delete(key)
  }
}

function settingsSession(storage: StorageLike, jwksURL = LOCAL_KEYCLOAK_JWKS) {
  const scope = effectScope()
  const issuer = ref(LOCAL_KEYCLOAK_ISSUER)
  const draft = ref<ManagedBackendPresetDraft>({ audience: 'notes-api', jwksURL, caFile: '' })
  scope.run(() =>
    useManagedBackendCAPath(draft, () => issuer.value, useManagedBackendCAPaths(storage))
  )
  return { issuer, draft, close: () => scope.stop() }
}

describe('device-local managed preview CA paths', () => {
  test('restores a selected path after closing and opening settings with the same local preferences', () => {
    const storage = localStorageFixture()
    const first = settingsSession(storage)
    first.draft.value.caFile = '/Users/example/local-ca.pem'
    first.close()
    const reopened = settingsSession(storage)
    expect(reopened.draft.value.caFile).toBe('/Users/example/local-ca.pem')
    reopened.close()
  })

  test('another computer with the same document authentication starts without a CA path', () => {
    const first = settingsSession(localStorageFixture())
    first.draft.value.caFile = '/Users/example/local-ca.pem'
    const otherComputer = settingsSession(localStorageFixture())
    expect(otherComputer.issuer.value).toBe(first.issuer.value)
    expect(otherComputer.draft.value.jwksURL).toBe(first.draft.value.jwksURL)
    expect(otherComputer.draft.value.caFile).toBe('')
    first.close()
    otherComputer.close()
  })

  test('clearing the field removes the saved path across reopening', () => {
    const storage = localStorageFixture()
    const first = settingsSession(storage)
    first.draft.value.caFile = '/tmp/public-ca.pem'
    first.draft.value.caFile = ''
    first.close()
    const reopened = settingsSession(storage)
    expect(reopened.draft.value.caFile).toBe('')
    expect(storage.getItem(MANAGED_BACKEND_CA_PATHS_KEY)).not.toContain('public-ca.pem')
    reopened.close()
  })

  test('switching issuer or JWKS restores only the matching scope and preserves other scopes', () => {
    const session = settingsSession(localStorageFixture())
    session.draft.value.caFile = '/tmp/first.pem'
    session.draft.value.jwksURL = 'https://other.example/certs'
    expect(session.draft.value.caFile).toBe('')
    session.draft.value.caFile = '/tmp/second.pem'
    session.issuer.value = 'https://other.example/realms/app'
    expect(session.draft.value.caFile).toBe('')
    session.issuer.value = LOCAL_KEYCLOAK_ISSUER
    expect(session.draft.value.caFile).toBe('/tmp/second.pem')
    session.draft.value.jwksURL = LOCAL_KEYCLOAK_JWKS
    expect(session.draft.value.caFile).toBe('/tmp/first.pem')
    session.close()
  })

  test('applying a preset after reopening or replacing the document draft restores its path', () => {
    const storage = localStorageFixture()
    const first = settingsSession(storage)
    first.draft.value.caFile = '/tmp/public-ca.pem'
    first.close()
    const reopened = settingsSession(storage, '')
    expect(reopened.draft.value.caFile).toBe('')
    reopened.draft.value.jwksURL = LOCAL_KEYCLOAK_JWKS
    expect(reopened.draft.value.caFile).toBe('/tmp/public-ca.pem')
    reopened.draft.value = { audience: 'another-api', jwksURL: '', caFile: '' }
    reopened.draft.value.jwksURL = LOCAL_KEYCLOAK_JWKS
    expect(reopened.draft.value.caFile).toBe('/tmp/public-ca.pem')
    reopened.close()
  })

  test('keeps a manually selected CA when the JWKS URL is filled in afterwards', () => {
    const storage = localStorageFixture()
    const first = settingsSession(storage, '')
    first.draft.value.caFile = '/tmp/selected-first.pem'
    first.draft.value.jwksURL = LOCAL_KEYCLOAK_JWKS
    expect(first.draft.value.caFile).toBe('/tmp/selected-first.pem')
    first.close()
    const reopened = settingsSession(storage)
    expect(reopened.draft.value.caFile).toBe('/tmp/selected-first.pem')
    reopened.close()
  })

  test('ignores corrupt, unknown-version and invalid path preferences', () => {
    for (const raw of [
      '{',
      JSON.stringify({ version: 2, paths: [] }),
      JSON.stringify({
        version: 1,
        paths: [
          { issuer: LOCAL_KEYCLOAK_ISSUER, jwksURL: LOCAL_KEYCLOAK_JWKS, caFile: 'relative.pem' }
        ]
      })
    ]) {
      const storage = localStorageFixture()
      storage.setItem(MANAGED_BACKEND_CA_PATHS_KEY, raw)
      const session = settingsSession(storage)
      expect(session.draft.value.caFile).toBe('')
      session.draft.value.caFile = '/tmp/valid.pem'
      session.close()
      const reopened = settingsSession(storage)
      expect(reopened.draft.value.caFile).toBe('/tmp/valid.pem')
      reopened.close()
    }
  })

  test('only saves valid absolute paths and bounded scopes', () => {
    const storage = localStorageFixture()
    const scope = effectScope()
    scope.run(() => {
      const preferences = useManagedBackendCAPaths(storage)
      preferences.write(LOCAL_KEYCLOAK_ISSUER, LOCAL_KEYCLOAK_JWKS, 'relative.pem')
      preferences.write(LOCAL_KEYCLOAK_ISSUER, LOCAL_KEYCLOAK_JWKS, '/tmp/ca\n.pem')
      expect(preferences.read(LOCAL_KEYCLOAK_ISSUER, LOCAL_KEYCLOAK_JWKS)).toBe('')
      for (let index = 0; index < 33; index++) {
        preferences.write(
          LOCAL_KEYCLOAK_ISSUER,
          `https://issuer.example/certs/${index}`,
          '/tmp/ca.pem'
        )
      }
      expect(preferences.read(LOCAL_KEYCLOAK_ISSUER, 'https://issuer.example/certs/0')).toBe('')
      expect(preferences.read(LOCAL_KEYCLOAK_ISSUER, 'https://issuer.example/certs/32')).toBe(
        '/tmp/ca.pem'
      )
    })
    scope.stop()
  })
})
