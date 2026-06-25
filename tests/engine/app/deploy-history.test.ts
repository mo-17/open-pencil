import { afterEach, describe, expect, test } from 'bun:test'

function installLocalStorage() {
  const data = new Map<string, string>()
  const storage = {
    get length() {
      return data.size
    },
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => data.set(key, value),
    removeItem: (key: string) => data.delete(key),
    key: (index: number) => [...data.keys()][index] ?? null
  } satisfies Pick<Storage, 'length' | 'getItem' | 'setItem' | 'removeItem' | 'key'>

  Object.assign(globalThis, { window: { localStorage: storage } })
  return data
}

afterEach(() => {
  Reflect.deleteProperty(globalThis, 'window')
})

describe('lowcode deploy history', () => {
  test('records recent deploy metadata without provider tokens', async () => {
    const storage = installLocalStorage()
    const { readDeployHistory, recordDeployHistory } =
      await import('@/app/lowcode/preview-pane/deploy-history')

    const history = recordDeployHistory({
      provider: 'netlify',
      environment: 'staging',
      url: 'https://example.netlify.app',
      deployId: 'dep_1',
      fileCount: 3,
      site: 'demo-site'
    })

    expect(history).toHaveLength(1)
    expect(history[0]).toMatchObject({
      provider: 'netlify',
      environment: 'staging',
      url: 'https://example.netlify.app',
      deployId: 'dep_1',
      fileCount: 3,
      site: 'demo-site'
    })
    expect(storage.values().next().value).not.toContain('token')
    expect(readDeployHistory()).toEqual(history)
  })

  test('keeps the newest deploy records first and caps history', async () => {
    installLocalStorage()
    const { readDeployHistory, recordDeployHistory } =
      await import('@/app/lowcode/preview-pane/deploy-history')

    for (let i = 0; i < 10; i++) {
      recordDeployHistory({
        provider: 'vercel',
        environment: 'preview',
        url: `https://preview-${i}.vercel.app`,
        deployId: `dep_${i}`,
        fileCount: i + 1
      })
    }

    const history = readDeployHistory()
    expect(history).toHaveLength(8)
    expect(history[0].deployId).toBe('dep_9')
    expect(history.at(-1)?.deployId).toBe('dep_2')
  })

  test('derives provider dashboard links for rollback guidance', async () => {
    installLocalStorage()
    const { deployDashboardUrl } = await import('@/app/lowcode/preview-pane/deploy-history')

    expect(deployDashboardUrl({ provider: 'netlify', deployId: 'dep 1' })).toBe(
      'https://app.netlify.com/deploys/dep%201'
    )
    expect(deployDashboardUrl({ provider: 'vercel', deployId: 'dep_2' })).toBe(
      'https://vercel.com/deployments/dep_2'
    )
    expect(
      deployDashboardUrl({
        provider: 'cloudflare',
        deployId: 'cf_3',
        site: 'account/project'
      })
    ).toBe('https://dash.cloudflare.com/account/pages/view/project/cf_3')
    expect(deployDashboardUrl({ provider: 'cloudflare', deployId: 'cf_4' })).toBeNull()
  })
})
