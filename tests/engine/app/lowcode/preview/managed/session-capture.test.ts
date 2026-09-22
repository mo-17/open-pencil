import { describe, expect, test } from 'bun:test'

import { ref } from 'vue'

import { watchPreviewLoginRoute } from '@/app/lowcode/preview-pane/backend-provider-watch'
import { captureManagedBackendSnapshot } from '@/app/lowcode/preview-pane/managed-backend/capture'
import { managedPreviewCommandArgs } from '@/app/lowcode/preview-pane/managed-backend/process'
import { resolveManagedPreviewSession } from '@/app/lowcode/preview-pane/managed-backend/session'

import { connectedBackendFixture, PLUGIN_ID } from '../connected-backend/helpers'

const SESSION = 'c8f08a42-c2b8-4b7c-89dd-43bd648acf2f'

describe('managed preview persisted locator', () => {
  test.each(['notes', 'app:0:1', `app:${'a'.repeat(60)}`])(
    'reuses the saved UUID for %s without putting the application ID in command arguments',
    (applicationId) => {
      const values = new Map<string, string>()
      const storage = {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => {
          values.set(key, value)
        }
      }
      expect(resolveManagedPreviewSession(applicationId, storage, () => SESSION)).toBe(SESSION)
      expect(
        resolveManagedPreviewSession(applicationId, storage, () => {
          throw new Error('Must reuse')
        })
      ).toBe(SESSION)
      expect([...values.keys()]).toEqual([`openpencil:managed-nestjs-preview:v1:${applicationId}`])
      expect(managedPreviewCommandArgs(SESSION)).toEqual([
        'packages/compiler/src/managed-preview/cli.ts',
        '--session',
        SESSION
      ])
      expect(() => managedPreviewCommandArgs('../../other')).toThrow('valid session')
      expect(() => resolveManagedPreviewSession('../other', storage)).toThrow('application ID')
    }
  )

  test.each(['', '../other', 'app/0/1', 'app\\0\\1', 'app:0:1\n', ' app:0:1', 'a'.repeat(65)])(
    'rejects malformed or oversized application IDs before accessing session storage: %j',
    (applicationId) => {
      const storage = {
        getItem: () => {
          throw new Error('Session storage must not be read')
        },
        setItem: () => {
          throw new Error('Session storage must not be written')
        }
      }
      expect(() => resolveManagedPreviewSession(applicationId, storage)).toThrow('application ID')
    }
  )

  test('fails before spawning if saved data is invalid or persistence fails', () => {
    const malformed = {
      getItem: () => 'other/path',
      setItem: () => {
        throw new Error('Must preserve')
      }
    }
    expect(() => resolveManagedPreviewSession('notes', malformed)).toThrow(
      'Existing data was preserved'
    )
    const unavailable = { getItem: () => null, setItem: () => undefined }
    expect(() => resolveManagedPreviewSession('notes', unavailable, () => SESSION)).toThrow(
      'No database was created'
    )
  })
})

describe('managed preview live Provider snapshot', () => {
  test('login route visibility changes revoke the connection while ordinary canvas edits do not', async () => {
    const fixture = await connectedBackendFixture()
    const version = ref(0)
    let invalidated = 0
    const stop = watchPreviewLoginRoute({
      graph: () => fixture.graph,
      sceneVersion: () => version.value,
      invalidate() {
        invalidated += 1
      }
    })
    try {
      fixture.graph.updateNode(fixture.notes.id, { width: 1200 })
      version.value += 1
      expect(invalidated).toBe(0)
      fixture.graph.updateNode(fixture.login.id, { internalOnly: true })
      version.value += 1
      expect(invalidated).toBe(1)
      fixture.graph.updateNode(fixture.login.id, { internalOnly: false, lowcodeRequiresAuth: true })
      version.value += 1
      expect(invalidated).toBe(2)
    } finally {
      stop()
    }
  })

  test('captures the reviewed document and invalidates after Provider disable', async () => {
    const fixture = await connectedBackendFixture()
    const captured = await captureManagedBackendSnapshot(
      fixture.graph,
      'react',
      () => true,
      () => fixture.store
    )
    expect(captured.application.applicationId).toBe(fixture.application.applicationId)
    expect(captured.loginPath).toBe('/login')
    captured.assertCurrent()
    await fixture.store.setEnabled(PLUGIN_ID, false)
    expect(() => captured.assertCurrent()).toThrow()
  })

  test('cannot authorize a hidden login page and rechecks route availability after capture', async () => {
    const fixture = await connectedBackendFixture()
    const captured = await captureManagedBackendSnapshot(
      fixture.graph,
      'vue',
      () => true,
      () => fixture.store
    )
    fixture.graph.updateNode(fixture.login.id, { internalOnly: true })
    expect(() => captured.assertCurrent()).toThrow('document changed')
    expect(
      captureManagedBackendSnapshot(
        fixture.graph,
        'vue',
        () => true,
        () => fixture.store
      )
    ).rejects.toThrow('unprotected local login route')
  })

  test('fails before preparing a document whose owning UI epoch changed', async () => {
    const fixture = await connectedBackendFixture()
    expect(
      captureManagedBackendSnapshot(
        fixture.graph,
        'react',
        () => false,
        () => fixture.store
      )
    ).rejects.toThrow('changed during preparation')
  })
})
