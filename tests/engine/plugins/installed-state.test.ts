import { describe, expect, test } from 'bun:test'

import {
  acceptPluginUpdate,
  createInstalledPluginState,
  parseInstalledPluginState,
  PluginTrustError,
  rejectPluginUpdate,
  reviewPluginUpdate,
  rollbackPlugin,
  setPluginEnabled,
  signPluginManifest,
  TRUSTED_PLUGIN_KEYRING_SCHEMA_VERSION,
  verifyPluginPackage,
  type PluginManifestPayloadV1,
  type TrustedPluginKeyringV1,
  type VerifiedPluginPackage
} from '@open-pencil/core/plugins'

import { pluginPayload } from './helpers'

async function keys(): Promise<CryptoKeyPair> {
  return crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify'])
}

async function verified(
  keyPair: CryptoKeyPair,
  version: string,
  moduleName = 'Chart',
  configure?: (payload: PluginManifestPayloadV1) => void
): Promise<VerifiedPluginPackage> {
  const payload = pluginPayload(version, moduleName)
  configure?.(payload)
  const manifest = await signPluginManifest(payload, keyPair.privateKey)
  return verifyPluginPackage(manifest, keyPair.publicKey)
}

describe('installed plugin state', () => {
  test('reviews, accepts, disables, rejects, and explicitly rolls back verified snapshots', async () => {
    const keyPair = await keys()
    const initial = await verified(keyPair, '1.0.0')
    const update = await verified(keyPair, '1.1.0', 'Chart Pro')
    const created = createInstalledPluginState(initial)
    const reviewing = reviewPluginUpdate(created, update)
    expect(reviewing.pending?.diff).toEqual({
      fromVersion: '1.0.0',
      toVersion: '1.1.0',
      addedModules: [],
      removedModules: [],
      updatedModules: ['chart'],
      addedCommands: [],
      removedCommands: [],
      updatedCommands: [],
      addedExporters: [],
      removedExporters: [],
      updatedExporters: []
    })
    const accepted = acceptPluginUpdate(reviewing)
    expect(accepted.accepted.manifest.plugin.version).toBe('1.1.0')
    expect(accepted.history).toHaveLength(1)
    expect(setPluginEnabled(accepted, false).enabled).toBe(false)
    expect(
      rejectPluginUpdate(reviewPluginUpdate(accepted, await verified(keyPair, '1.2.0'))).pending
    ).toBeUndefined()
    const rolledBack = rollbackPlugin(accepted, '1.0.0')
    expect(rolledBack.accepted.verifiedDigest).toBe(initial.verifiedDigest)
    expect(rolledBack.history[0].verifiedDigest).toBe(update.verifiedDigest)
  })

  test('reviews added, removed, and changed command and exporter contributions', async () => {
    const keyPair = await keys()
    const initial = await verified(keyPair, '1.0.0', 'Chart', (payload) => {
      payload.contributions.commands = [
        {
          commandId: 'remove-command',
          name: 'Remove command',
          description: 'Removed in the update',
          adapterId: 'acme.remove-command'
        },
        {
          commandId: 'update-command-adapter',
          name: 'Adapter command',
          description: 'Same description',
          adapterId: 'acme.old-command-adapter'
        },
        {
          commandId: 'update-command-description',
          name: 'Description command',
          description: 'Old description',
          adapterId: 'acme.description-command'
        },
        {
          commandId: 'update-command-name',
          name: 'Old command name',
          description: 'Same description',
          adapterId: 'acme.name-command'
        }
      ]
      payload.contributions.exporters = [
        {
          exporterId: 'remove-exporter',
          name: 'Remove exporter',
          description: 'Removed in the update',
          adapterId: 'acme.remove-exporter',
          fileExtension: '.old'
        },
        {
          exporterId: 'update-exporter-adapter',
          name: 'Adapter exporter',
          description: 'Same description',
          adapterId: 'acme.old-exporter-adapter',
          fileExtension: '.zip'
        },
        {
          exporterId: 'update-exporter-description',
          name: 'Description exporter',
          description: 'Old description',
          adapterId: 'acme.description-exporter',
          fileExtension: '.zip'
        },
        {
          exporterId: 'update-exporter-extension',
          name: 'Extension exporter',
          description: 'Same description',
          adapterId: 'acme.extension-exporter',
          fileExtension: '.old'
        },
        {
          exporterId: 'update-exporter-name',
          name: 'Old exporter name',
          description: 'Same description',
          adapterId: 'acme.name-exporter',
          fileExtension: '.zip'
        }
      ]
    })
    const update = await verified(keyPair, '1.1.0', 'Chart', (payload) => {
      payload.contributions.commands = [
        {
          commandId: 'add-command',
          name: 'Add command',
          description: 'Added in the update',
          adapterId: 'acme.add-command'
        },
        {
          commandId: 'update-command-adapter',
          name: 'Adapter command',
          description: 'Same description',
          adapterId: 'acme.new-command-adapter'
        },
        {
          commandId: 'update-command-description',
          name: 'Description command',
          description: 'New description',
          adapterId: 'acme.description-command'
        },
        {
          commandId: 'update-command-name',
          name: 'New command name',
          description: 'Same description',
          adapterId: 'acme.name-command'
        }
      ]
      payload.contributions.exporters = [
        {
          exporterId: 'add-exporter',
          name: 'Add exporter',
          description: 'Added in the update',
          adapterId: 'acme.add-exporter',
          fileExtension: '.zip'
        },
        {
          exporterId: 'update-exporter-adapter',
          name: 'Adapter exporter',
          description: 'Same description',
          adapterId: 'acme.new-exporter-adapter',
          fileExtension: '.zip'
        },
        {
          exporterId: 'update-exporter-description',
          name: 'Description exporter',
          description: 'New description',
          adapterId: 'acme.description-exporter',
          fileExtension: '.zip'
        },
        {
          exporterId: 'update-exporter-extension',
          name: 'Extension exporter',
          description: 'Same description',
          adapterId: 'acme.extension-exporter',
          fileExtension: '.new'
        },
        {
          exporterId: 'update-exporter-name',
          name: 'New exporter name',
          description: 'Same description',
          adapterId: 'acme.name-exporter',
          fileExtension: '.zip'
        }
      ]
    })

    expect(reviewPluginUpdate(createInstalledPluginState(initial), update).pending?.diff).toEqual({
      fromVersion: '1.0.0',
      toVersion: '1.1.0',
      addedModules: [],
      removedModules: [],
      updatedModules: [],
      addedCommands: ['add-command'],
      removedCommands: ['remove-command'],
      updatedCommands: [
        'update-command-adapter',
        'update-command-description',
        'update-command-name'
      ],
      addedExporters: ['add-exporter'],
      removedExporters: ['remove-exporter'],
      updatedExporters: [
        'update-exporter-adapter',
        'update-exporter-description',
        'update-exporter-extension',
        'update-exporter-name'
      ]
    })
  })

  test('parses legacy pending diffs without command or exporter lists', async () => {
    const keyPair = await keys()
    const initial = await verified(keyPair, '1.0.0')
    const update = await verified(keyPair, '1.1.0', 'Chart Pro')
    const reviewed = reviewPluginUpdate(createInstalledPluginState(initial), update)
    if (!reviewed.pending) throw new Error('Expected a pending update')
    const { diff } = reviewed.pending
    const legacyState = {
      ...reviewed,
      pending: {
        ...reviewed.pending,
        diff: {
          fromVersion: diff.fromVersion,
          toVersion: diff.toVersion,
          addedModules: diff.addedModules,
          removedModules: diff.removedModules,
          updatedModules: diff.updatedModules
        }
      }
    }

    expect(parseInstalledPluginState(legacyState).pending?.diff).toEqual({
      fromVersion: '1.0.0',
      toVersion: '1.1.0',
      addedModules: [],
      removedModules: [],
      updatedModules: ['chart'],
      addedCommands: [],
      removedCommands: [],
      updatedCommands: [],
      addedExporters: [],
      removedExporters: [],
      updatedExporters: []
    })
  })

  test('rejects same-version changes, downgrades, key rotation, and forged persisted metadata', async () => {
    const keyPair = await keys()
    const initial = await verified(keyPair, '1.0.0')
    const state = createInstalledPluginState(initial)
    expect(() => reviewPluginUpdate(state, initial)).toThrow('strictly greater version')

    const changed = await verified(keyPair, '1.0.0', 'Changed')
    expect(() => reviewPluginUpdate(state, changed)).toThrow('without a version bump')

    const newer = acceptPluginUpdate(reviewPluginUpdate(state, await verified(keyPair, '2.0.0')))
    expect(() => reviewPluginUpdate(newer, initial)).toThrow('cannot downgrade')

    const rotatedKeys = await keys()
    const rotatedPayload = pluginPayload('1.1.0')
    rotatedPayload.publisher.keyId = 'acme.rotated'
    const rotatedManifest = await signPluginManifest(rotatedPayload, rotatedKeys.privateKey)
    const rotated = await verifyPluginPackage(rotatedManifest, rotatedKeys.publicKey)
    expect(() => reviewPluginUpdate(state, rotated)).toThrow('signing key changed')

    const forged = structuredClone(state)
    forged.accepted.verifiedDigest = 'A'.repeat(43)
    expect(() => parseInstalledPluginState(forged)).toThrow('does not match')

    const mismatchedDiff = reviewPluginUpdate(state, await verified(keyPair, '1.1.0', 'Changed'))
    if (!mismatchedDiff.pending) throw new Error('Expected a pending update')
    mismatchedDiff.pending.diff.updatedModules = []
    expect(() => parseInstalledPluginState(mismatchedDiff)).toThrow('does not match')
  })

  test('keeps history unique when a rolled-back release is accepted again', async () => {
    const keyPair = await keys()
    const version1 = await verified(keyPair, '1.0.0')
    const version2 = await verified(keyPair, '2.0.0', 'Chart Pro')
    const version2Accepted = acceptPluginUpdate(
      reviewPluginUpdate(createInstalledPluginState(version1), version2)
    )
    const rolledBack = rollbackPlugin(version2Accepted, '1.0.0')
    const acceptedAgain = acceptPluginUpdate(reviewPluginUpdate(rolledBack, version2))

    expect(acceptedAgain.accepted.verifiedDigest).toBe(version2.verifiedDigest)
    expect(acceptedAgain.history.map(({ manifest }) => manifest.plugin.version)).toEqual(['1.0.0'])
    expect(parseInstalledPluginState(acceptedAgain)).toEqual(acceptedAgain)

    const republishedVersion2 = await verified(keyPair, '2.0.0', 'Different Chart Pro')
    expect(() => reviewPluginUpdate(rolledBack, republishedVersion2)).toThrow(
      'previously verified version'
    )
  })

  test('accepts only explicit active publisher key rotations and keeps the default closed', async () => {
    const oldPair = await keys()
    const newPair = await keys()
    const oldPackage = await verified(oldPair, '1.0.0')
    const rotatedPayload = pluginPayload('2.0.0', 'Chart Rotated')
    rotatedPayload.publisher.keyId = 'acme.release.2026'
    const rotatedManifest = await signPluginManifest(rotatedPayload, newPair.privateKey)
    const rotatedPackage = await verifyPluginPackage(rotatedManifest, newPair.publicKey)
    const state = createInstalledPluginState(oldPackage)
    const trustedKeyring: TrustedPluginKeyringV1 = {
      schemaVersion: TRUSTED_PLUGIN_KEYRING_SCHEMA_VERSION,
      keys: [
        {
          keyId: 'acme.release',
          publisherId: 'acme',
          pluginIds: ['acme.analytics'],
          publicKey: oldPair.publicKey,
          notBefore: '2025-01-01T00:00:00.000Z',
          notAfter: '2027-01-01T00:00:00.000Z'
        },
        {
          keyId: 'acme.release.2026',
          publisherId: 'acme',
          pluginIds: ['acme.analytics'],
          publicKey: newPair.publicKey,
          notBefore: '2026-06-01T00:00:00.000Z',
          notAfter: '2028-01-01T00:00:00.000Z',
          predecessorKeyId: 'acme.release'
        }
      ]
    }
    const trustOptions = {
      trustedKeyring,
      now: '2026-08-06T00:00:00.000Z'
    }

    expect(() => reviewPluginUpdate(state, rotatedPackage)).toThrow('signing key changed')
    const reviewing = reviewPluginUpdate(state, rotatedPackage, trustOptions)
    const accepted = acceptPluginUpdate(reviewing, trustOptions)
    expect(accepted.accepted.verifiedKeyId).toBe('acme.release.2026')
    expect(parseInstalledPluginState(accepted, trustOptions)).toEqual(accepted)
    expect(() => parseInstalledPluginState(accepted)).toThrow('signing key changed')
    expect(setPluginEnabled(accepted, false, trustOptions).enabled).toBe(false)

    const revokedKeyring: TrustedPluginKeyringV1 = {
      ...trustedKeyring,
      keys: [
        trustedKeyring.keys[0],
        {
          ...trustedKeyring.keys[1],
          revokedAt: '2026-08-01T00:00:00.000Z',
          revocationReason: 'Compromised key'
        }
      ]
    }
    try {
      reviewPluginUpdate(state, rotatedPackage, { ...trustOptions, trustedKeyring: revokedKeyring })
      throw new Error('Expected revoked rotation to fail')
    } catch (error) {
      expect(error).toBeInstanceOf(PluginTrustError)
      expect((error as PluginTrustError).code).toBe('publisher-key-revoked')
    }
  })

  test('rechecks publisher key expiry and revocation when accepting or enabling', async () => {
    const keyPair = await keys()
    const initial = await verified(keyPair, '1.0.0')
    const update = await verified(keyPair, '1.1.0', 'Chart Update')
    const activeKeyring: TrustedPluginKeyringV1 = {
      schemaVersion: TRUSTED_PLUGIN_KEYRING_SCHEMA_VERSION,
      keys: [
        {
          keyId: 'acme.release',
          publisherId: 'acme',
          pluginIds: ['acme.analytics'],
          publicKey: keyPair.publicKey,
          notBefore: '2026-01-01T00:00:00.000Z',
          notAfter: '2026-08-06T00:00:00.000Z'
        }
      ]
    }
    const reviewed = reviewPluginUpdate(createInstalledPluginState(initial), update, {
      trustedKeyring: activeKeyring,
      now: '2026-08-05T00:00:00.000Z'
    })

    for (const [trustedKeyring, code] of [
      [activeKeyring, 'publisher-key-expired'],
      [
        {
          ...activeKeyring,
          keys: [
            {
              ...activeKeyring.keys[0],
              notAfter: '2027-01-01T00:00:00.000Z',
              revokedAt: '2026-08-06T00:00:00.000Z',
              revocationReason: 'Compromised key'
            }
          ]
        },
        'publisher-key-revoked'
      ]
    ] as const) {
      const options = {
        trustedKeyring,
        now: '2026-08-07T00:00:00.000Z'
      }
      for (const operation of [
        () => acceptPluginUpdate(reviewed, options),
        () => setPluginEnabled(createInstalledPluginState(initial), true, options)
      ]) {
        try {
          operation()
          throw new Error('Expected inactive publisher key to fail')
        } catch (error) {
          expect(error).toBeInstanceOf(PluginTrustError)
          expect((error as PluginTrustError).code).toBe(code)
        }
      }
    }
  })
})
