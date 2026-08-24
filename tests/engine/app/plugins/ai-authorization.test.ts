import { describe, expect, test } from 'bun:test'

import type { PluginManifest, PluginManifestPayload } from '@open-pencil/plugin-contracts'

import {
  ThirdPartyPluginAIEligibilityError,
  createThirdPartyPluginAIGrantManager,
  inspectThirdPartyPluginAIEligibility,
  listThirdPartyPluginAIContributionReviews,
  reviewThirdPartyPluginAIContribution,
  type ThirdPartyPluginAIContributionRequest
} from '@/app/plugins/ai-authorization'
import { createBundledPluginCatalog } from '@/app/plugins/catalog'
import {
  AIRTABLE_LIST_RECORDS_OPERATION_ID,
  AIRTABLE_RECORDS_CONNECTOR_ID,
  AIRTABLE_RECORDS_PLUGIN_ID
} from '@/app/plugins/connectors/airtable-records'
import {
  STRIPE_BILLING_CONNECTOR_ID,
  STRIPE_BILLING_PLUGIN_ID,
  STRIPE_CREATE_CHECKOUT_SESSION_OPERATION_ID
} from '@/app/plugins/connectors/stripe-billing'
import {
  ACCESSIBILITY_AUDIT_COMMAND,
  ACCESSIBILITY_AUDIT_PLUGIN_ID,
  CLIPBOARD_TOOLKIT_PLUGIN_ID
} from '@/app/plugins/host/ids'
import { appPluginMCPConnectorContributionId } from '@/app/plugins/mcp'
import type { InstalledAppPlugin } from '@/app/plugins/types'

interface SignedFixtureOptions {
  digest?: string
  enabled?: boolean
  blockedReason?: string
  pluginVersion?: string
  publisherId?: string
  publisherKeyId?: string
  transform?: (payload: PluginManifestPayload) => PluginManifestPayload
}

function signedFixture(pluginId: string, options: SignedFixtureOptions = {}): InstalledAppPlugin {
  const entry = createBundledPluginCatalog().find(
    (candidate) => candidate.manifest.plugin.id === pluginId
  )
  if (!entry) throw new Error(`Missing bundled plugin fixture: ${pluginId}`)
  const publisherId = options.publisherId ?? 'acme.publisher'
  const publisherKeyId = options.publisherKeyId ?? 'acme.release'
  const digest = options.digest ?? 'publisher-digest-v1'
  const enabled = options.enabled ?? true
  const base = structuredClone(entry.manifest)
  const payload = options.transform?.(base) ?? base
  const version = options.pluginVersion ?? payload.plugin.version
  const manifest = {
    ...payload,
    plugin: { ...payload.plugin, version },
    publisher: {
      id: publisherId,
      name: 'Acme Publisher',
      keyId: publisherKeyId
    },
    integrity: {
      algorithm: 'SHA-256' as const,
      digest,
      signature: {
        algorithm: 'Ed25519' as const,
        keyId: publisherKeyId,
        value: 'test-signature'
      }
    }
  } as PluginManifest
  const accepted = {
    manifest,
    verifiedDigest: digest,
    verifiedKeyId: publisherKeyId
  }
  return {
    package: {
      trustSource: 'publisher-signature',
      manifest,
      digest,
      verifiedPackage: accepted
    },
    enabled,
    pinnedDigest: null,
    installedState: {
      version: 1,
      enabled,
      accepted,
      history: []
    },
    ...(options.blockedReason ? { blockedReason: options.blockedReason } : {})
  }
}

const ACCESSIBILITY_REQUEST: ThirdPartyPluginAIContributionRequest = Object.freeze({
  pluginId: ACCESSIBILITY_AUDIT_PLUGIN_ID,
  kind: 'command',
  contributionId: ACCESSIBILITY_AUDIT_COMMAND.commandId
})

function connectorRequest(
  pluginId: string,
  connectorId: string,
  operationId: string
): ThirdPartyPluginAIContributionRequest {
  return {
    pluginId,
    kind: 'connector',
    contributionId: appPluginMCPConnectorContributionId(connectorId, operationId)
  }
}

describe('third-party plugin AI eligibility', () => {
  test('reviews an exact publisher-signed V2 read-only command', () => {
    const plugin = signedFixture(ACCESSIBILITY_AUDIT_PLUGIN_ID)
    const result = inspectThirdPartyPluginAIEligibility(plugin, ACCESSIBILITY_REQUEST)

    expect(result).toEqual({
      ok: true,
      review: {
        pluginId: ACCESSIBILITY_AUDIT_PLUGIN_ID,
        kind: 'command',
        contributionId: ACCESSIBILITY_AUDIT_COMMAND.commandId,
        adapterId: ACCESSIBILITY_AUDIT_COMMAND.adapterId,
        packageDigest: 'publisher-digest-v1',
        pluginVersion: '1.0.0',
        publisherId: 'acme.publisher',
        publisherKeyId: 'acme.release'
      }
    })
  })

  test('reviews only exact host-reviewed connector queries', () => {
    const request = connectorRequest(
      AIRTABLE_RECORDS_PLUGIN_ID,
      AIRTABLE_RECORDS_CONNECTOR_ID,
      AIRTABLE_LIST_RECORDS_OPERATION_ID
    )
    const review = reviewThirdPartyPluginAIContribution(
      signedFixture(AIRTABLE_RECORDS_PLUGIN_ID),
      request
    )

    expect(review).toMatchObject({
      ...request,
      connectorId: AIRTABLE_RECORDS_CONNECTOR_ID,
      operationId: AIRTABLE_LIST_RECORDS_OPERATION_ID,
      packageDigest: 'publisher-digest-v1',
      publisherId: 'acme.publisher',
      publisherKeyId: 'acme.release'
    })
  })

  test('lists only eligible reviews in stable kind and contribution order', () => {
    const plugin = signedFixture(STRIPE_BILLING_PLUGIN_ID)
    const reviews = listThirdPartyPluginAIContributionReviews(plugin)

    expect(reviews.length).toBe(2)
    expect(reviews.every((review) => review.kind === 'connector')).toBe(true)
    expect(reviews.map((review) => review.contributionId)).toEqual(
      reviews.map((review) => review.contributionId).toSorted()
    )
    expect(reviews.some((review) => review.kind !== 'connector')).toBe(false)
  })

  test('rejects write permissions, connector mutations, and every unsupported contribution kind', () => {
    const writeCommand = signedFixture(ACCESSIBILITY_AUDIT_PLUGIN_ID, {
      digest: 'publisher-write-command',
      transform(payload) {
        if (payload.schemaVersion !== 2) throw new Error('Expected V2 command fixture')
        return {
          ...payload,
          contributions: {
            ...payload.contributions,
            commands: payload.contributions.commands?.map((command) => ({
              ...command,
              permissions: ['file.save']
            }))
          }
        }
      }
    })
    expect(inspectThirdPartyPluginAIEligibility(writeCommand, ACCESSIBILITY_REQUEST)).toMatchObject(
      { ok: false, code: 'write-permission-denied' }
    )

    const mutationRequest = connectorRequest(
      STRIPE_BILLING_PLUGIN_ID,
      STRIPE_BILLING_CONNECTOR_ID,
      STRIPE_CREATE_CHECKOUT_SESSION_OPERATION_ID
    )
    expect(
      inspectThirdPartyPluginAIEligibility(signedFixture(STRIPE_BILLING_PLUGIN_ID), mutationRequest)
    ).toMatchObject({ ok: false, code: 'mutation-denied' })

    for (const kind of ['module', 'exporter', 'storage', 'runtime', 'mutation']) {
      expect(
        inspectThirdPartyPluginAIEligibility(signedFixture(ACCESSIBILITY_AUDIT_PLUGIN_ID), {
          ...ACCESSIBILITY_REQUEST,
          kind
        } as never)
      ).toMatchObject({ ok: false, code: 'contribution-kind-denied' })
    }
  })

  test('rejects app-bundled, V1, disabled, blocked, and incomplete signed packages', () => {
    const signed = signedFixture(ACCESSIBILITY_AUDIT_PLUGIN_ID)
    const appBundle: InstalledAppPlugin = {
      ...signed,
      package: { ...signed.package, trustSource: 'app-bundle' }
    }
    expect(inspectThirdPartyPluginAIEligibility(appBundle, ACCESSIBILITY_REQUEST)).toMatchObject({
      ok: false,
      code: 'not-publisher-signed'
    })

    const v1 = signedFixture(CLIPBOARD_TOOLKIT_PLUGIN_ID)
    expect(
      inspectThirdPartyPluginAIEligibility(v1, {
        pluginId: CLIPBOARD_TOOLKIT_PLUGIN_ID,
        kind: 'command',
        contributionId: 'copy-as-svg'
      })
    ).toMatchObject({ ok: false, code: 'manifest-version-denied' })

    expect(
      inspectThirdPartyPluginAIEligibility(
        signedFixture(ACCESSIBILITY_AUDIT_PLUGIN_ID, { enabled: false }),
        ACCESSIBILITY_REQUEST
      )
    ).toMatchObject({ ok: false, code: 'plugin-disabled' })
    expect(
      inspectThirdPartyPluginAIEligibility(
        signedFixture(ACCESSIBILITY_AUDIT_PLUGIN_ID, { blockedReason: 'publisher key revoked' }),
        ACCESSIBILITY_REQUEST
      )
    ).toMatchObject({ ok: false, code: 'plugin-blocked' })

    const { installedState: _installedState, ...incomplete } = signedFixture(
      ACCESSIBILITY_AUDIT_PLUGIN_ID
    )
    expect(inspectThirdPartyPluginAIEligibility(incomplete, ACCESSIBILITY_REQUEST)).toMatchObject({
      ok: false,
      code: 'signed-package-unavailable'
    })

    expect(
      inspectThirdPartyPluginAIEligibility(signed, {
        ...ACCESSIBILITY_REQUEST,
        pluginId: 'different.plugin'
      })
    ).toMatchObject({ ok: false, code: 'plugin-unavailable' })
  })
})

describe('third-party plugin AI contribution grants', () => {
  test('reviews twice, binds exact authority, and never revives an old grant ID', () => {
    let active = signedFixture(ACCESSIBILITY_AUDIT_PLUGIN_ID)
    let resolveCount = 0
    const grantIds = ['grant-first', 'grant-first', 'grant-second']
    const manager = createThirdPartyPluginAIGrantManager({
      resolveInstalledPlugin(pluginId) {
        resolveCount += 1
        return active.package.manifest.plugin.id === pluginId ? active : undefined
      },
      createGrantId: () => grantIds.shift() ?? 'unexpected-grant',
      now: () => 1234
    })

    const review = manager.review(ACCESSIBILITY_REQUEST)
    const first = manager.grant(review)
    expect(resolveCount).toBe(2)
    expect(manager.listReviews(ACCESSIBILITY_AUDIT_PLUGIN_ID)).toEqual([review])
    expect(first).toMatchObject({
      ...review,
      grantId: 'grant-first',
      grantedAt: 1234
    })
    expect(manager.requireGrant(review, first.grantId)).toEqual(first)

    expect(manager.revoke(ACCESSIBILITY_REQUEST)).toBe(true)
    const secondReview = manager.review(ACCESSIBILITY_REQUEST)
    expect(() => manager.grant(secondReview)).toThrow('collision')
    const second = manager.grant(secondReview)
    expect(second.grantId).toBe('grant-second')
    expect(() => manager.requireGrant(review, first.grantId)).toThrow('unavailable')
    expect(manager.requireGrant(secondReview, second.grantId)).toEqual(second)

    active = signedFixture(ACCESSIBILITY_AUDIT_PLUGIN_ID, {
      digest: 'publisher-digest-v2',
      pluginVersion: '1.1.0'
    })
    expect(() => manager.requireGrant(secondReview, second.grantId)).toThrow('authority changed')
    expect(manager.snapshot()).toEqual([])
  })

  test('rejects grant-time TOCTOU changes to digest, publisher, key, version, or adapter', () => {
    let active = signedFixture(ACCESSIBILITY_AUDIT_PLUGIN_ID)
    const manager = createThirdPartyPluginAIGrantManager({
      resolveInstalledPlugin: () => active,
      createGrantId: () => 'grant-toctou'
    })
    const review = manager.review(ACCESSIBILITY_REQUEST)

    active = signedFixture(ACCESSIBILITY_AUDIT_PLUGIN_ID, {
      digest: 'replacement-digest',
      pluginVersion: '2.0.0',
      publisherId: 'replacement.publisher',
      publisherKeyId: 'replacement.key'
    })
    expect(() => manager.grant(review)).toThrow('changed after review')

    active = signedFixture(ACCESSIBILITY_AUDIT_PLUGIN_ID, {
      digest: 'adapter-replacement',
      transform(payload) {
        if (payload.schemaVersion !== 2) throw new Error('Expected V2 command fixture')
        return {
          ...payload,
          contributions: {
            ...payload.contributions,
            commands: payload.contributions.commands?.map((command) => ({
              ...command,
              adapterId: 'unreviewed.adapter'
            }))
          }
        }
      }
    })
    expect(() => manager.grant(review)).toThrow(ThirdPartyPluginAIEligibilityError)
  })

  test('reconcile revokes disabled, uninstalled, and changed contributions', () => {
    let active: InstalledAppPlugin | undefined = signedFixture(ACCESSIBILITY_AUDIT_PLUGIN_ID)
    let grantIndex = 0
    const manager = createThirdPartyPluginAIGrantManager({
      resolveInstalledPlugin: () => active,
      createGrantId: () => `grant-${++grantIndex}`
    })

    const grant = manager.grant(manager.review(ACCESSIBILITY_REQUEST))
    active = signedFixture(ACCESSIBILITY_AUDIT_PLUGIN_ID, { enabled: false })
    expect(manager.reconcile()).toEqual([grant.grantId])
    expect(manager.snapshot()).toEqual([])

    active = signedFixture(ACCESSIBILITY_AUDIT_PLUGIN_ID)
    const uninstalled = manager.grant(manager.review(ACCESSIBILITY_REQUEST))
    active = undefined
    expect(manager.reconcile()).toEqual([uninstalled.grantId])

    active = signedFixture(ACCESSIBILITY_AUDIT_PLUGIN_ID)
    const changed = manager.grant(manager.review(ACCESSIBILITY_REQUEST))
    active = signedFixture(ACCESSIBILITY_AUDIT_PLUGIN_ID, {
      digest: 'same-tool-new-package',
      publisherKeyId: 'rotated.key'
    })
    expect(manager.reconcile()).toEqual([changed.grantId])
    expect(manager.snapshot()).toEqual([])
  })

  test('keeps authority on the accepted package while a different update remains pending', () => {
    const acceptedPlugin = signedFixture(ACCESSIBILITY_AUDIT_PLUGIN_ID)
    const candidatePlugin = signedFixture(ACCESSIBILITY_AUDIT_PLUGIN_ID, {
      digest: 'pending-candidate-digest',
      pluginVersion: '1.1.0',
      publisherKeyId: 'rotated.pending.key'
    })
    const installedState = acceptedPlugin.installedState
    const candidate = candidatePlugin.installedState?.accepted
    if (!installedState || !candidate) throw new Error('Expected signed installed-state fixtures')
    const active: InstalledAppPlugin = {
      ...acceptedPlugin,
      installedState: {
        ...installedState,
        pending: {
          candidate,
          status: 'pending',
          diff: {
            fromVersion: '1.0.0',
            toVersion: '1.1.0',
            addedModules: [],
            removedModules: [],
            updatedModules: [],
            addedCommands: [],
            removedCommands: [],
            updatedCommands: [],
            addedExporters: [],
            removedExporters: [],
            updatedExporters: [],
            addedConnectors: [],
            removedConnectors: [],
            updatedConnectors: [],
            addedStorageProviders: [],
            removedStorageProviders: [],
            updatedStorageProviders: []
          }
        }
      }
    }
    const manager = createThirdPartyPluginAIGrantManager({
      resolveInstalledPlugin: () => active,
      createGrantId: () => 'accepted-package-grant'
    })

    const review = manager.review(ACCESSIBILITY_REQUEST)
    const grant = manager.grant(review)
    expect(review).toMatchObject({
      packageDigest: 'publisher-digest-v1',
      pluginVersion: '1.0.0',
      publisherKeyId: 'acme.release'
    })
    expect(manager.reconcile()).toEqual([])
    expect(manager.requireGrant(review, grant.grantId)).toEqual(grant)
  })

  test('emits immutable snapshots for state changes and supports unsubscribe', () => {
    let plugin = signedFixture(ACCESSIBILITY_AUDIT_PLUGIN_ID)
    let grantIndex = 0
    const manager = createThirdPartyPluginAIGrantManager({
      resolveInstalledPlugin: () => plugin,
      createGrantId: () => `listener-grant-${++grantIndex}`
    })
    const observed: ReturnType<typeof manager.snapshot>[] = []
    const unsubscribe = manager.subscribe((snapshot) => observed.push(snapshot))

    const review = manager.review(ACCESSIBILITY_REQUEST)
    manager.grant(review)
    manager.revoke(ACCESSIBILITY_REQUEST)
    manager.grant(manager.review(ACCESSIBILITY_REQUEST))
    manager.revokePlugin(ACCESSIBILITY_AUDIT_PLUGIN_ID)
    manager.grant(manager.review(ACCESSIBILITY_REQUEST))
    plugin = signedFixture(ACCESSIBILITY_AUDIT_PLUGIN_ID, { enabled: false })
    manager.reconcile()
    plugin = signedFixture(ACCESSIBILITY_AUDIT_PLUGIN_ID)
    manager.grant(manager.review(ACCESSIBILITY_REQUEST))
    manager.clear()

    expect(observed.map((snapshot) => snapshot.length)).toEqual([1, 0, 1, 0, 1, 0, 1, 0])
    expect(Object.isFrozen(observed[0])).toBe(true)
    expect(Object.isFrozen(observed[0][0])).toBe(true)

    unsubscribe()
    manager.grant(manager.review(ACCESSIBILITY_REQUEST))
    manager.clear()
    expect(observed.map((snapshot) => snapshot.length)).toEqual([1, 0, 1, 0, 1, 0, 1, 0])
  })
})
