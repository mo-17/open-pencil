import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const source = readFileSync(
  resolve(
    import.meta.dir,
    '../../../../../../src/components/settings/storage/BaiduNetdiskStorageConnection.vue'
  ),
  'utf8'
)

function functionSource(start: string, end: string): string {
  const startIndex = source.indexOf(start)
  const endIndex = source.indexOf(end, startIndex)
  if (startIndex === -1 || endIndex === -1) throw new Error(`Expected ${start} before ${end}`)
  return source.slice(startIndex, endIndex)
}

describe('Baidu Netdisk storage connection lifecycle', () => {
  test('imports bounded strict AppKey credentials without retaining the secret in reactive state', () => {
    const imported = functionSource(
      'async function onCredentialsInputChange',
      'async function connect('
    )
    const parse = imported.indexOf('parseBaiduNetdiskSelfHostedCredentialsJSON(credentialsJSON)')
    const connect = imported.indexOf("await connect('self-hosted', credentialsJSON)")

    expect(source).toContain('accept=".json,application/json"')
    expect(imported).toContain('file.size > MAX_BAIDU_NETDISK_SELF_HOSTED_CREDENTIALS_BYTES')
    expect(imported).toContain('const credentialsJSON = await file.text()')
    expect(parse).toBeGreaterThan(-1)
    expect(connect).toBeGreaterThan(parse)
    expect(source).not.toMatch(/ref<[^>]*(?:Secret|OAuthClient|Credentials)/)
  })

  test('drains the profile, adopts same-account work, verifies access, and resumes sync', () => {
    const connect = functionSource('async function connect(', 'async function checkConnection()')
    const drain = connect.indexOf('withDurableStorageProfileMutationDrain(')
    const openTabs = connect.indexOf('profileHasOpenTabs(active.profileId)')
    const adopt = connect.indexOf('await adoptStorageAuthorizationWork({')
    const verify = connect.indexOf('await runtime.adapter.testConnection({')
    const resume = connect.indexOf('await resumeStorageSync()')

    expect(drain).toBeGreaterThan(-1)
    expect(openTabs).toBeGreaterThan(drain)
    expect(adopt).toBeGreaterThan(openTabs)
    expect(verify).toBeGreaterThan(adopt)
    expect(resume).toBeGreaterThan(verify)
  })

  test('keeps the managed Broker and self-hosted SecretKey modes isolated', () => {
    expect(source).toContain("type ConnectionMode = 'publisher-broker' | 'self-hosted'")
    expect(source).toContain("mode === 'self-hosted'")
    expect(source).toContain("mode === 'publisher-broker'")
    expect(source).toContain('storageBaiduNetdiskManagedConnection')
    expect(source).toContain('storageBaiduNetdiskSelfHostedConnection')
  })

  test('does not cancel a grant commit or partial durable repair', () => {
    const cancel = functionSource('function cancelOperation()', 'async function removeProfile(')
    expect(cancel).toContain(
      "if (operation.value === 'committing' || operation.value === 'repairing') return"
    )
  })
})
