import { describe, expect, test } from 'bun:test'

import {
  PLUGIN_DOCUMENT_LOCK_FORMAT,
  PLUGIN_DOCUMENT_LOCK_SCHEMA_VERSION,
  parsePluginDocumentLock,
  serializePluginDocumentLock,
  validatePluginDocumentLock,
  type PluginDocumentLockV1
} from '@open-pencil/scene-graph'

const DIGEST_A = 'A'.repeat(43)
const DIGEST_B = `${'A'.repeat(42)}Q`

function lock(): PluginDocumentLockV1 {
  return {
    format: PLUGIN_DOCUMENT_LOCK_FORMAT,
    schemaVersion: PLUGIN_DOCUMENT_LOCK_SCHEMA_VERSION,
    plugins: [
      {
        pluginId: 'open-pencil.map',
        version: '1.2.0',
        manifestDigest: DIGEST_B,
        publisherKeyId: 'open-pencil.release'
      },
      {
        pluginId: 'open-pencil.chart',
        version: '1.0.0',
        manifestDigest: DIGEST_A,
        publisherKeyId: 'open-pencil.release'
      }
    ]
  }
}

describe('plugin document lock', () => {
  test('normalizes entries into deterministic plugin-id order', () => {
    const parsed = parsePluginDocumentLock(lock())
    expect(parsed.plugins.map(({ pluginId }) => pluginId)).toEqual([
      'open-pencil.chart',
      'open-pencil.map'
    ])
    expect(JSON.parse(serializePluginDocumentLock(lock()))).toEqual(parsed)
  })

  test('fails closed for duplicate, future, malformed, and extended locks', () => {
    const duplicate = lock()
    duplicate.plugins[1] = { ...duplicate.plugins[0] }
    expect(validatePluginDocumentLock(duplicate).ok).toBe(false)
    expect(() => parsePluginDocumentLock({ ...lock(), schemaVersion: 2 })).toThrow('schemaVersion')
    expect(() =>
      parsePluginDocumentLock({
        ...lock(),
        plugins: [{ ...lock().plugins[0], manifestDigest: 'not-a-digest' }]
      })
    ).toThrow('SHA-256')
    expect(() => parsePluginDocumentLock({ ...lock(), untrusted: true })).toThrow(
      'unsupported fields'
    )
    const sparse = lock()
    const sparsePlugins: PluginDocumentLockV1['plugins'] = []
    sparsePlugins.length = 1
    sparse.plugins = sparsePlugins
    expect(() => parsePluginDocumentLock(sparse)).toThrow('dense JSON array')
  })
})
