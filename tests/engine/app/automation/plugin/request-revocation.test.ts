import { expect, test } from 'bun:test'

import type { PluginMCPToolCallDescriptor } from '@open-pencil/mcp/plugin-contract'

import { PluginMCPRequestRevocationRegistry } from '@/app/automation/bridge/plugin-mcp-request-revocation'
import type { ThirdPartyPluginAIContributionGrant } from '@/app/plugins/ai-authorization'

function descriptor(
  trustSource: 'app-bundle' | 'publisher-signature' = 'publisher-signature'
): PluginMCPToolCallDescriptor {
  return Object.freeze({
    name: 'plugin_acme_lookup',
    pluginId: 'acme.analytics',
    kind: 'command',
    contributionId: 'lookup',
    authority: Object.freeze({
      trustSource,
      packageDigest: 'package-digest',
      pluginVersion: '1.0.0',
      publisherId: 'acme',
      publisherKeyId: 'acme.release',
      adapterId: 'acme.lookup'
    })
  })
}

function grant(overrides: Partial<ThirdPartyPluginAIContributionGrant> = {}) {
  return Object.freeze({
    pluginId: 'acme.analytics',
    kind: 'command' as const,
    contributionId: 'lookup',
    adapterId: 'acme.lookup',
    packageDigest: 'package-digest',
    pluginVersion: '1.0.0',
    publisherId: 'acme',
    publisherKeyId: 'acme.release',
    grantId: 'grant-acme-lookup',
    grantedAt: 1,
    ...overrides
  }) as ThirdPartyPluginAIContributionGrant
}

test('aborts an in-flight Publisher MCP request when its exact AI grant disappears', () => {
  const registry = new PluginMCPRequestRevocationRegistry()
  const controller = registry.start('request-1')
  registry.bind('request-1', controller, descriptor(), 'grant-acme-lookup')

  expect(registry.reconcilePublisherGrants([grant()])).toEqual([])
  expect(controller.signal.aborted).toBe(false)

  expect(registry.reconcilePublisherGrants([grant({ publisherKeyId: 'acme.rotated' })])).toEqual([
    'request-1'
  ])
  expect(controller.signal.aborted).toBe(true)
  expect(controller.signal.reason).toEqual(new Error('Third-party plugin AI grant was revoked'))
  expect(registry.reconcilePublisherGrants([])).toEqual([])
})

test('does not bind app-bundle tools to Publisher AI grant revocation', () => {
  const registry = new PluginMCPRequestRevocationRegistry()
  const controller = registry.start('request-1')
  registry.bind('request-1', controller, descriptor('app-bundle'), null)

  expect(registry.reconcilePublisherGrants([])).toEqual([])
  expect(controller.signal.aborted).toBe(false)
})

test('cannot bind or finish a replacement request through a stale controller', () => {
  const registry = new PluginMCPRequestRevocationRegistry()
  const stale = registry.start('request-1')
  const current = registry.start('request-1')
  expect(stale.signal.aborted).toBe(true)

  registry.bind('request-1', stale, descriptor(), 'grant-acme-lookup')
  registry.finish('request-1', stale)
  expect(registry.reconcilePublisherGrants([])).toEqual([])
  expect(current.signal.aborted).toBe(false)

  registry.bind('request-1', current, descriptor(), 'grant-acme-lookup')
  expect(registry.reconcilePublisherGrants([])).toEqual(['request-1'])
  expect(current.signal.aborted).toBe(true)
})

test('aborts an in-flight request when the same contribution is granted again', () => {
  const registry = new PluginMCPRequestRevocationRegistry()
  const controller = registry.start('request-1')
  registry.bind('request-1', controller, descriptor(), 'grant-acme-lookup')

  expect(
    registry.reconcilePublisherGrants([grant({ grantId: 'grant-acme-lookup-replacement' })])
  ).toEqual(['request-1'])
  expect(controller.signal.aborted).toBe(true)
})
