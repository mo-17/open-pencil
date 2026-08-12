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

  const windowMock = {}
  Object.defineProperty(windowMock, 'localStorage', { value: storage })
  Object.assign(globalThis, { window: windowMock })
  return data
}

function legacyFNV1a32(value: string): number {
  let hash = 0x811c9dc5
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return hash >>> 0
}

afterEach(() => {
  Reflect.deleteProperty(globalThis, 'window')
})

describe('lowcode deploy history', () => {
  test('records recent deploy metadata without provider tokens', async () => {
    const storage = installLocalStorage()
    const { deployArtifactLabel, readDeployHistory, recordDeployHistory } =
      await import('@/app/lowcode/preview-pane/deploy/history')

    const history = recordDeployHistory({
      provider: 'netlify',
      environment: 'staging',
      url: 'https://example.netlify.app',
      deployId: 'dep_1',
      fileCount: 3,
      site: 'demo-site',
      uiKit: 'shadcn',
      i18nEnabled: true,
      locales: ['fr', 'ja']
    })
    const label = deployArtifactLabel(history[0])

    expect(history).toHaveLength(1)
    expect(history[0]).toMatchObject({
      provider: 'netlify',
      environment: 'staging',
      url: 'https://example.netlify.app',
      deployId: 'dep_1',
      fileCount: 3,
      site: 'demo-site',
      uiKit: 'shadcn',
      i18nEnabled: true,
      locales: ['fr', 'ja'],
      buildOptions: {
        uiKit: 'shadcn',
        i18nEnabled: true,
        locales: ['fr', 'ja']
      },
      artifactLabel: label,
      compat: { schema: 1 }
    })
    expect(label).toBe('staging · netlify · demo-site · shadcn · i18n:fr,ja')
    expect(storage.values().next().value).not.toContain('token')
    expect(readDeployHistory()).toEqual(history)
  })

  test('keeps the newest deploy records first and caps history', async () => {
    installLocalStorage()
    const { readDeployHistory, recordDeployHistory } =
      await import('@/app/lowcode/preview-pane/deploy/history')

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
    const { deployDashboardURL } = await import('@/app/lowcode/preview-pane/deploy/history')

    expect(deployDashboardURL({ provider: 'netlify', deployId: 'dep 1' })).toBe(
      'https://app.netlify.com/deploys/dep%201'
    )
    expect(deployDashboardURL({ provider: 'vercel', deployId: 'dep_2' })).toBe(
      'https://vercel.com/deployments/dep_2'
    )
    expect(
      deployDashboardURL({
        provider: 'cloudflare',
        deployId: 'cf_3',
        site: 'account/project'
      })
    ).toBe('https://dash.cloudflare.com/account/pages/view/project/cf_3')
    expect(deployDashboardURL({ provider: 'cloudflare', deployId: 'cf_4' })).toBeNull()
  })

  test('describes provider rollback contracts without calling provider APIs', async () => {
    installLocalStorage()
    const { deployRollbackContract, deployRollbackContractLabel, deployRollbackContractTitle } =
      await import('@/app/lowcode/preview-pane/deploy/history')

    expect(
      deployRollbackContract({ provider: 'netlify', deployId: 'dep_1', site: 'site_1' })
    ).toMatchObject({
      provider: 'netlify',
      support: 'api-candidate',
      label: 'Restore deploy',
      requiredFields: ['token', 'site', 'deployId']
    })
    expect(deployRollbackContract({ provider: 'netlify', deployId: 'dep_2' })).toMatchObject({
      provider: 'netlify',
      support: 'dashboard-only',
      reason: 'Netlify restore needs a site id or site slug.'
    })
    expect(
      deployRollbackContract({
        provider: 'cloudflare',
        deployId: 'cf_1',
        site: 'account/project'
      })
    ).toMatchObject({
      provider: 'cloudflare',
      support: 'api-candidate',
      requiredFields: ['token', 'accountId', 'projectName', 'deployId'],
      missingFields: []
    })
    const cloudflareMissing = deployRollbackContract({
      provider: 'cloudflare',
      deployId: 'cf_2'
    })
    expect(cloudflareMissing).toMatchObject({
      provider: 'cloudflare',
      support: 'dashboard-only',
      missingFields: ['site'],
      reason: 'Cloudflare rollback needs a site target in account/project format.'
    })
    expect(deployRollbackContractLabel(cloudflareMissing)).toBe(
      'Rollback Pages deployment: dashboard only · missing site'
    )
    expect(deployRollbackContractTitle(cloudflareMissing)).toBe(
      'Cloudflare rollback needs a site target in account/project format. Missing: site.'
    )
    expect(
      deployRollbackContract({ provider: 'cloudflare', deployId: 'cf_3', site: 'project-only' })
    ).toMatchObject({
      provider: 'cloudflare',
      support: 'dashboard-only',
      missingFields: ['accountId', 'projectName'],
      reason: 'Cloudflare rollback needs a site target in account/project format.'
    })
    const vercelMissing = deployRollbackContract({
      provider: 'vercel',
      deployId: 'ver_1',
      site: 'my-project'
    })
    expect(vercelMissing).toMatchObject({
      provider: 'vercel',
      support: 'dashboard-only',
      requiredFields: ['token', 'deployId', 'projectName', 'productionAlias', 'projectOwner'],
      missingFields: ['productionAlias', 'projectOwner'],
      reason: 'Vercel rollback needs productionAlias, projectOwner metadata not stored locally yet.'
    })
    expect(deployRollbackContractLabel(vercelMissing)).toBe(
      'Promote deployment: dashboard only · missing productionAlias, projectOwner'
    )
    expect(deployRollbackContractTitle(vercelMissing)).toBe(
      'Vercel rollback needs productionAlias, projectOwner metadata not stored locally yet. Missing: productionAlias, projectOwner.'
    )
    expect(deployRollbackContract({ provider: 'vercel', deployId: 'ver_2' })).toMatchObject({
      provider: 'vercel',
      support: 'dashboard-only',
      missingFields: ['projectName', 'productionAlias', 'projectOwner'],
      reason:
        'Vercel rollback needs projectName, productionAlias, projectOwner metadata not stored locally yet.'
    })
    expect(deployRollbackContract({ provider: 'custom', deployId: 'x' })).toMatchObject({
      provider: 'custom',
      support: 'unsupported'
    })
  })

  test('parses Cloudflare Pages account/project targets for rollback readiness', async () => {
    installLocalStorage()
    const { deployDashboardURL, parseCloudflarePagesTarget } =
      await import('@/app/lowcode/preview-pane/deploy/history')

    expect(parseCloudflarePagesTarget(' account / project ')).toEqual({
      accountId: 'account',
      projectName: 'project',
      missingFields: []
    })
    expect(parseCloudflarePagesTarget()).toEqual({
      missingFields: ['site'],
      reason: 'Cloudflare rollback needs a site target in account/project format.'
    })
    expect(parseCloudflarePagesTarget('project')).toEqual({
      missingFields: ['accountId', 'projectName'],
      reason: 'Cloudflare rollback needs a site target in account/project format.'
    })
    expect(parseCloudflarePagesTarget('account/')).toEqual({
      accountId: 'account',
      missingFields: ['projectName'],
      reason: 'Cloudflare rollback needs both account id and project name.'
    })
    expect(parseCloudflarePagesTarget('/project')).toEqual({
      projectName: 'project',
      missingFields: ['accountId'],
      reason: 'Cloudflare rollback needs both account id and project name.'
    })
    expect(parseCloudflarePagesTarget('account/project/extra')).toEqual({
      missingFields: ['accountId', 'projectName'],
      reason: 'Cloudflare rollback needs a site target in account/project format.'
    })
    expect(parseCloudflarePagesTarget('account//project')).toEqual({
      missingFields: ['accountId', 'projectName'],
      reason: 'Cloudflare rollback needs a site target in account/project format.'
    })
    expect(
      parseCloudflarePagesTarget('https://dash.cloudflare.com/account/pages/view/project/cf')
    ).toEqual({
      missingFields: ['accountId', 'projectName'],
      reason: 'Cloudflare rollback needs a site target in account/project format.'
    })
    expect(
      deployDashboardURL({ provider: 'cloudflare', deployId: 'cf_5', site: 'project' })
    ).toBeNull()
  })

  test('parses Vercel project targets without implying production rollback readiness', async () => {
    installLocalStorage()
    const { parseVercelProjectTarget } = await import('@/app/lowcode/preview-pane/deploy/history')

    expect(parseVercelProjectTarget(' my-project ')).toEqual({
      projectName: 'my-project',
      missingFields: []
    })
    expect(parseVercelProjectTarget()).toEqual({
      missingFields: ['projectName'],
      reason: 'Vercel rollback needs the project name used for the deployment.'
    })
    expect(parseVercelProjectTarget('   ')).toEqual({
      missingFields: ['projectName'],
      reason: 'Vercel rollback needs the project name used for the deployment.'
    })
  })

  test('restores a Netlify deploy through the site-scoped restore API', async () => {
    installLocalStorage()
    const { restoreNetlifyDeploy } = await import('@/app/lowcode/preview-pane/deploy/history')
    const calls: Array<{ url: string; init?: RequestInit }> = []
    const fetcher = (async (input: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(input), init })
      return new Response(
        JSON.stringify({ id: 'dep_restored', ssl_url: 'https://app.netlify.app' })
      )
    }) satisfies typeof fetch

    const result = await restoreNetlifyDeploy(
      { token: 'netlify-token', siteId: 'site 1', deployId: 'dep 1' },
      fetcher
    )

    expect(result).toEqual({
      provider: 'netlify',
      deployId: 'dep_restored',
      url: 'https://app.netlify.app'
    })
    expect(calls).toHaveLength(1)
    expect(calls[0].url).toBe(
      'https://api.netlify.com/api/v1/sites/site%201/deploys/dep%201/restore'
    )
    expect(calls[0].init?.method).toBe('POST')
    expect(calls[0].init?.headers).toEqual({ Authorization: 'Bearer netlify-token' })
  })

  test('surfaces Netlify rollback API errors without persisting tokens', async () => {
    const storage = installLocalStorage()
    const { restoreNetlifyDeploy } = await import('@/app/lowcode/preview-pane/deploy/history')
    const fetcher = (async () =>
      new Response('Unauthorized', { status: 401 })) satisfies typeof fetch

    await expect(
      restoreNetlifyDeploy({ token: 'bad-token', siteId: 'site_1', deployId: 'dep_1' }, fetcher)
    ).rejects.toThrow('Netlify rollback failed: 401 (check your token) — Unauthorized')
    expect([...storage.values()].join('\n')).not.toContain('bad-token')
  })

  test('builds a redeploy draft from history without restoring deploy artifacts or tokens', async () => {
    installLocalStorage()
    const {
      deployBuildOptionsSnapshot,
      deployRollbackDraft,
      readDeployHistory,
      recordDeployHistory
    } = await import('@/app/lowcode/preview-pane/deploy/history')

    const [entry] = recordDeployHistory({
      provider: 'cloudflare',
      environment: 'production',
      url: 'https://example.pages.dev',
      deployId: 'cf_1',
      fileCount: 12,
      site: 'account/project',
      uiKit: 'shadcn',
      i18nEnabled: true,
      locales: ['zh-CN', 'fr'],
      runtimeConfig: {
        supabaseUrl: ' https://rollback.supabase.co ',
        supabaseAnonKey: ' sb_publishable_rollback ',
        supabaseSchema: ' release '
      }
    })

    const runtimeConfig = {
      supabaseUrl: 'https://rollback.supabase.co',
      supabaseAnonKey: 'sb_publishable_rollback',
      supabaseSchema: 'release'
    }

    expect(deployBuildOptionsSnapshot(entry)).toEqual({
      uiKit: 'shadcn',
      i18nEnabled: true,
      locales: ['zh-CN', 'fr']
    })
    expect(entry.runtimeConfig).toEqual(runtimeConfig)
    expect(readDeployHistory()[0]?.runtimeConfig).toEqual(runtimeConfig)
    expect(deployRollbackDraft(entry)).toEqual({
      provider: 'cloudflare',
      environment: 'production',
      site: 'account/project',
      uiKit: 'shadcn',
      i18nEnabled: true,
      locales: ['zh-CN', 'fr'],
      runtimeConfig
    })
    expect(JSON.stringify(deployRollbackDraft(entry))).not.toContain('cf_1')
    expect(JSON.stringify(deployRollbackDraft(entry))).not.toContain('https://example.pages.dev')
    expect(deployRollbackDraft({ ...entry, provider: 'custom-host' })).toBeNull()
  })

  test('uses structured build options before legacy replay fields', async () => {
    installLocalStorage()
    const { deployArtifactLabel, deployRollbackDraft } =
      await import('@/app/lowcode/preview-pane/deploy/history')

    const entry = {
      id: 'mixed',
      provider: 'vercel',
      environment: 'staging' as const,
      url: 'https://mixed.vercel.app',
      deployId: 'dep_mixed',
      fileCount: 6,
      createdAt: '2026-06-25T00:00:00.000Z',
      uiKit: 'none' as const,
      i18nEnabled: false,
      locales: [],
      buildOptions: {
        uiKit: 'shadcn' as const,
        i18nEnabled: true,
        locales: ['de']
      }
    }

    expect(deployRollbackDraft(entry)).toMatchObject({
      uiKit: 'shadcn',
      i18nEnabled: true,
      locales: ['de']
    })
    expect(deployArtifactLabel(entry)).toBe('staging · vercel · shadcn · i18n:de')
  })

  test('defaults optional replay fields for legacy deploy history entries', async () => {
    const storage = installLocalStorage()
    storage.set(
      'open-pencil:lowcode-deploy-history:v1',
      JSON.stringify([
        {
          id: 'legacy',
          provider: 'netlify',
          environment: 'preview',
          url: 'https://legacy.netlify.app',
          deployId: 'dep_legacy',
          fileCount: 1,
          createdAt: '2026-06-25T00:00:00.000Z'
        }
      ])
    )
    const { deployRollbackDraft, readDeployHistory } =
      await import('@/app/lowcode/preview-pane/deploy/history')

    const [entry] = readDeployHistory()
    expect(entry.compat).toBeUndefined()
    expect(deployRollbackDraft(entry)).toEqual({
      provider: 'netlify',
      environment: 'preview',
      site: undefined,
      uiKit: 'none',
      i18nEnabled: false,
      locales: []
    })
  })

  test('saves environment target presets without provider tokens', async () => {
    const storage = installLocalStorage()
    const { readDeployTargetPresets, saveDeployTargetPreset } =
      await import('@/app/lowcode/preview-pane/deploy/history')

    const presets = saveDeployTargetPreset({
      environment: 'production',
      provider: 'cloudflare',
      site: 'account/project',
      buildOptions: {
        uiKit: 'shadcn',
        i18nEnabled: true,
        locales: ['fr', 'ja']
      }
    })

    expect(presets.production).toMatchObject({
      environment: 'production',
      provider: 'cloudflare',
      site: 'account/project',
      buildOptions: {
        uiKit: 'shadcn',
        i18nEnabled: true,
        locales: ['fr', 'ja']
      }
    })
    expect(presets.preview).toBeNull()
    expect(readDeployTargetPresets()).toEqual(presets)
    expect([...storage.values()].join('\n')).not.toContain('token')
  })

  test('isolates target presets by environment and skips invalid stored presets', async () => {
    const storage = installLocalStorage()
    const { readDeployTargetPresets, saveDeployTargetPreset } =
      await import('@/app/lowcode/preview-pane/deploy/history')

    saveDeployTargetPreset({
      environment: 'preview',
      provider: 'netlify',
      site: 'preview-site',
      buildOptions: { uiKit: 'none', i18nEnabled: false, locales: [] }
    })
    saveDeployTargetPreset({
      environment: 'staging',
      provider: 'vercel',
      site: 'staging-project',
      buildOptions: { uiKit: 'shadcn', i18nEnabled: false, locales: [] }
    })

    expect(readDeployTargetPresets()).toMatchObject({
      preview: { provider: 'netlify', site: 'preview-site' },
      staging: { provider: 'vercel', site: 'staging-project' },
      production: null
    })

    storage.set(
      'open-pencil:lowcode-deploy-targets:v1',
      JSON.stringify({
        preview: {
          environment: 'preview',
          provider: 'custom-host',
          buildOptions: { uiKit: 'none', i18nEnabled: false, locales: [] },
          updatedAt: '2026-06-25T00:00:00.000Z'
        },
        staging: readDeployTargetPresets().staging
      })
    )

    expect(readDeployTargetPresets()).toMatchObject({
      preview: null,
      staging: { provider: 'vercel', site: 'staging-project' },
      production: null
    })
  })

  test('isolates deploy metadata by saved document scope', async () => {
    const storage = installLocalStorage()
    const {
      deployDocumentScope,
      readDeployHistory,
      readDeployTargetPresets,
      recordDeployHistory,
      saveDeployTargetPreset
    } = await import('@/app/lowcode/preview-pane/deploy/history')
    const first = deployDocumentScope('/projects/first.fig')
    const second = deployDocumentScope('/projects/second.fig')
    const remote = deployDocumentScope({
      kind: 'storage',
      providerId: 'cloud-drive',
      documentId: '/projects/first.fig'
    })

    expect(first).toBeTruthy()
    expect(second).toBeTruthy()
    expect(remote).toBeTruthy()
    expect(first).not.toBe(second)
    expect(remote).not.toBe(first)
    expect([...storage.keys()].join('\n')).not.toContain('/projects/')

    saveDeployTargetPreset(
      {
        environment: 'staging',
        provider: 'netlify',
        site: 'first-site',
        buildOptions: { uiKit: 'none', i18nEnabled: false, locales: [] }
      },
      first
    )
    saveDeployTargetPreset(
      {
        environment: 'staging',
        provider: 'vercel',
        site: 'second-project',
        buildOptions: { uiKit: 'shadcn', i18nEnabled: false, locales: [] }
      },
      second
    )
    recordDeployHistory(
      {
        provider: 'netlify',
        environment: 'staging',
        url: 'https://first.example',
        deployId: 'first-deploy',
        fileCount: 2
      },
      first
    )
    recordDeployHistory(
      {
        provider: 'cloudflare',
        environment: 'staging',
        url: 'https://remote.example',
        deployId: 'remote-deploy',
        fileCount: 3
      },
      remote
    )

    expect(readDeployTargetPresets(first).staging?.site).toBe('first-site')
    expect(readDeployTargetPresets(second).staging?.site).toBe('second-project')
    expect(readDeployHistory(first).map((entry) => entry.deployId)).toEqual(['first-deploy'])
    expect(readDeployHistory(second)).toEqual([])
    expect(readDeployHistory(remote).map((entry) => entry.deployId)).toEqual(['remote-deploy'])
    expect([...storage.keys()].join('\n')).not.toContain('/projects/')
  })

  test('uses SHA-256 scopes to separate paths that collided under legacy FNV-1a', async () => {
    installLocalStorage()
    const { deployDocumentScope } = await import('@/app/lowcode/preview-pane/deploy/history')
    const firstPath = '/legacy/3pwu.fig'
    const secondPath = '/legacy/a5fa.fig'

    expect(legacyFNV1a32(`path\0${firstPath}`)).toBe(legacyFNV1a32(`path\0${secondPath}`))
    expect(deployDocumentScope(firstPath)).toMatch(/^doc-sha256-[a-f0-9]{64}$/)
    expect(deployDocumentScope(firstPath)).not.toBe(deployDocumentScope(secondPath))
  })

  test('rejects incomplete document identities and separates storage providers from paths', async () => {
    installLocalStorage()
    const { deployDocumentScope } = await import('@/app/lowcode/preview-pane/deploy/history')
    const path = deployDocumentScope({ kind: 'path', path: 'shared-document' })
    const firstStorage = deployDocumentScope({
      kind: 'storage',
      providerId: 'first-provider',
      documentId: 'shared-document'
    })
    const secondStorage = deployDocumentScope({
      kind: 'storage',
      providerId: 'second-provider',
      documentId: 'shared-document'
    })
    const firstAccount = deployDocumentScope({
      kind: 'storage',
      providerId: 'google-drive',
      profileId: 'default',
      accountId: 'google-sub-1',
      documentId: 'shared-document'
    })
    const secondAccount = deployDocumentScope({
      kind: 'storage',
      providerId: 'google-drive',
      profileId: 'default',
      accountId: 'google-sub-2',
      documentId: 'shared-document'
    })

    expect(new Set([path, firstStorage, secondStorage]).size).toBe(3)
    expect(firstAccount).not.toBe(secondAccount)
    expect(deployDocumentScope({ kind: 'path', path: '   ' })).toBeUndefined()
    expect(
      deployDocumentScope({ kind: 'storage', providerId: '   ', documentId: 'document' })
    ).toBeUndefined()
    expect(
      deployDocumentScope({ kind: 'storage', providerId: 'provider', documentId: '   ' })
    ).toBeUndefined()
    expect(deployDocumentScope({ kind: 'transient', id: '   ' })).toBeUndefined()
  })

  test('keeps transient deploy state in process memory instead of localStorage', async () => {
    const storage = installLocalStorage()
    const {
      deployDocumentScope,
      readDeployHistory,
      readDeployTargetPresets,
      recordDeployHistory,
      saveDeployTargetPreset
    } = await import('@/app/lowcode/preview-pane/deploy/history')
    const scope = deployDocumentScope({ kind: 'transient', id: 'unsaved-test-store' })

    recordDeployHistory(
      {
        provider: 'vercel',
        environment: 'preview',
        url: 'https://transient.example',
        deployId: 'transient-deploy',
        fileCount: 1
      },
      scope
    )
    saveDeployTargetPreset(
      {
        environment: 'preview',
        provider: 'vercel',
        site: 'transient-project',
        buildOptions: { uiKit: 'none', i18nEnabled: false, locales: [] }
      },
      scope
    )

    expect(readDeployHistory(scope).map((entry) => entry.deployId)).toEqual(['transient-deploy'])
    expect(readDeployTargetPresets(scope).preview?.site).toBe('transient-project')
    expect(storage.size).toBe(0)
  })

  test('assigns stable isolated transient scopes to unsaved editor stores', async () => {
    installLocalStorage()
    const { deployScopeForStore } = await import('@/app/lowcode/preview-pane/deploy/scope')
    type Store = Parameters<typeof deployScopeForStore>[0]
    const unsavedStore = () =>
      ({
        getStorageBinding: () => null,
        getSourceIdentity: () => ({ handle: null, path: null }),
        getDocumentPath: () => null
      }) as Store
    const first = unsavedStore()
    const second = unsavedStore()

    expect(deployScopeForStore(first)).toMatch(/^volatile:[a-f0-9]{64}$/)
    expect(deployScopeForStore(first)).toBe(deployScopeForStore(first))
    expect(deployScopeForStore(first)).not.toBe(deployScopeForStore(second))
  })

  test('normalizes public runtime overrides in environment presets', async () => {
    installLocalStorage()
    const { deployRuntimeConfigSnapshot, readDeployTargetPresets, saveDeployTargetPreset } =
      await import('@/app/lowcode/preview-pane/deploy/history')

    expect(deployRuntimeConfigSnapshot({})).toBeUndefined()
    expect(
      deployRuntimeConfigSnapshot({
        supabaseUrl: ' https://staging.supabase.co/ ',
        supabaseAnonKey: ' sb_publishable_example ',
        supabaseSchema: ' app '
      })
    ).toEqual({
      supabaseUrl: 'https://staging.supabase.co/',
      supabaseAnonKey: 'sb_publishable_example',
      supabaseSchema: 'app'
    })

    saveDeployTargetPreset({
      environment: 'staging',
      provider: 'cloudflare',
      site: 'account/project',
      buildOptions: { uiKit: 'none', i18nEnabled: false, locales: [] },
      runtimeConfig: {
        supabaseUrl: ' https://staging.supabase.co ',
        supabaseAnonKey: ' sb_publishable_example ',
        supabaseSchema: ' app '
      }
    })
    expect(readDeployTargetPresets().staging?.runtimeConfig).toEqual({
      supabaseUrl: 'https://staging.supabase.co',
      supabaseAnonKey: 'sb_publishable_example',
      supabaseSchema: 'app'
    })
  })

  test('rejects incomplete or elevated Supabase runtime overrides before persistence', async () => {
    const storage = installLocalStorage()
    const { deployRuntimeConfigSnapshot, saveDeployTargetPreset, validateDeployRuntimeConfig } =
      await import('@/app/lowcode/preview-pane/deploy/history')

    expect(validateDeployRuntimeConfig({ supabaseUrl: 'https://x.supabase.co' })).toMatchObject({
      ok: false
    })
    expect(
      validateDeployRuntimeConfig({
        supabaseUrl: 'https://x.supabase.co',
        supabaseAnonKey: 'sb_secret_do-not-persist'
      })
    ).toMatchObject({ ok: false })
    expect(
      validateDeployRuntimeConfig({
        supabaseUrl: 'https://user:password@x.supabase.co',
        supabaseAnonKey: 'sb_publishable_example'
      })
    ).toMatchObject({ ok: false })
    expect(validateDeployRuntimeConfig({ supabaseSchema: 'bad schema' })).toMatchObject({
      ok: false
    })
    expect(() =>
      deployRuntimeConfigSnapshot({
        supabaseUrl: 'https://x.supabase.co',
        supabaseAnonKey: 'sb_secret_do-not-persist'
      })
    ).toThrow('cannot be saved')
    expect(() =>
      saveDeployTargetPreset({
        environment: 'production',
        provider: 'netlify',
        buildOptions: { uiKit: 'none', i18nEnabled: false, locales: [] },
        runtimeConfig: {
          supabaseUrl: 'https://x.supabase.co',
          supabaseAnonKey: 'sb_secret_do-not-persist'
        }
      })
    ).toThrow('cannot be saved')
    expect([...storage.values()].join('\n')).not.toContain('sb_secret_do-not-persist')
  })
})
