import { describe, expect, test } from 'bun:test'

import { exportEd25519PublicKeyPem } from '@open-pencil/scene-graph'

import { parseRemotePluginTrustConfig } from '@/app/plugins'

async function publicPem(): Promise<string> {
  const pair = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify'])
  return exportEd25519PublicKeyPem(pair.publicKey)
}

async function config() {
  return {
    schemaVersion: 1,
    catalog: {
      url: 'https://plugins.example/catalog.json',
      catalogId: 'open-pencil.catalog',
      keyId: 'catalog.root',
      publicKeyPem: await publicPem()
    },
    publisherKeys: [
      {
        keyId: 'acme.release',
        publisherId: 'acme',
        pluginIds: ['acme.analytics'],
        publicKeyPem: await publicPem(),
        notBefore: '2026-08-01T00:00:00.000Z',
        notAfter: '2027-08-01T00:00:00.000Z'
      }
    ]
  }
}

describe('remote plugin trust config', () => {
  test('imports only host-configured catalog and publisher public keys', async () => {
    const resolved = await parseRemotePluginTrustConfig(await config())

    expect(resolved.catalogUrl).toBe('https://plugins.example/catalog.json')
    expect(resolved.expectedCatalogId).toBe('open-pencil.catalog')
    expect(resolved.publisherKeyring.keys).toHaveLength(1)
    expect(resolved.publisherKeyring.keys[0]).toMatchObject({
      keyId: 'acme.release',
      publisherId: 'acme',
      pluginIds: ['acme.analytics']
    })
    expect(resolved.publisherKeyring.keys[0].publicKey.type).toBe('public')
  })

  test('rejects transport downgrade, unknown fields, and malformed key ownership', async () => {
    const insecure = await config()
    insecure.catalog.url = 'http://plugins.example/catalog.json'
    await expect(parseRemotePluginTrustConfig(insecure)).rejects.toThrow('HTTPS')

    const executable = { ...(await config()), executable: 'alert(1)' }
    await expect(parseRemotePluginTrustConfig(executable)).rejects.toThrow('unsupported')

    const unsorted = await config()
    unsorted.publisherKeys[0].pluginIds = ['z.plugin', 'a.plugin']
    await expect(parseRemotePluginTrustConfig(unsorted)).rejects.toThrow('sorted')
  })
})
