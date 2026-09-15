import { describe, expect, test } from 'bun:test'

import { businessTemplateDefinition } from '@/app/lowcode/backend/business/definitions'
import { createBusinessApplication } from '@/app/lowcode/backend/business/model'
import {
  createBackendLibraryCatalog,
  filterBackendLibraryCatalog,
  type BackendLibraryItem,
  type BackendLibraryProviderInput
} from '@/app/lowcode/backend/library/catalog'
import { backendLibraryCopy } from '@/app/lowcode/backend/library/copy'

function provider(
  providerId = 'nestjs',
  descriptorKey = 'plugin\u0000contribution\u0000nestjs\u0000adapter\u0000digest'
): BackendLibraryProviderInput {
  return {
    descriptorKey,
    descriptor: {
      providerId,
      pluginId: 'example.' + providerId,
      capabilities: ['auth.identity', 'data.read', 'server.http']
    }
  }
}
function ids(items: readonly BackendLibraryItem[]): string[] {
  return items.map((item) => item.id)
}

describe('inert backend library catalog', () => {
  test.each(['asset-management', 'quote-contracts', 'recruitment-hr'] as const)(
    'describes %s using its exact exported entities, pages and identity-service roles',
    (kind) => {
      const application = createBusinessApplication(
        'enterprise-catalog',
        {
          kind: 'oidc-pkce',
          issuer: 'https://identity.example.com',
          clientId: 'enterprise-public-client',
          scopes: ['openid', 'profile'],
          callbackPath: '/_openpencil/auth/callback'
        },
        kind
      )
      const definition = businessTemplateDefinition(kind)
      for (const locale of ['en', 'zh-CN']) {
        const item = createBackendLibraryCatalog([], locale).find((entry) => entry.id === kind)
        if (item?.kind !== 'template') throw new Error('Missing enterprise template')
        expect(item.entities).toEqual(application.dataModel.entities.map((entity) => entity.name))
        expect(item.roles).toEqual(application.auth.roles.map((role) => role.id))
        expect(item.pages).toHaveLength(definition.pages.length + 1)
        expect(item.name).toBe(locale === 'en' ? definition.title.en : definition.title.zh)
        expect(item.requirements.join(' ')).toContain(
          locale === 'en' ? 'does not grant roles' : '不会授予角色'
        )
        expect(
          ids(filterBackendLibraryCatalog([item], { category: 'templates', query: item.name }))
        ).toEqual([kind])
      }
    }
  )

  test('preserves legacy templates alongside distinct merchant modes and unavailable provider guides', () => {
    const catalog = createBackendLibraryCatalog([], 'en')
    const providers = catalog.filter((item) => item.kind === 'provider')
    const templates = catalog.filter((item) => item.kind === 'template')
    expect(ids(templates)).toEqual([
      'personal-notes',
      'single-sku-shop',
      'single-merchant-shop',
      'multi-merchant-marketplace',
      'single-merchant-commerce',
      'multi-merchant-commerce',
      'customer-crm',
      'service-desk',
      'content-knowledge-base',
      'booking-registration',
      'project-tasks',
      'rental-viewing',
      'food-ordering',
      'hospital-registration',
      'personal-blog',
      'automotive-news',
      'procurement-inventory',
      'enterprise-approvals',
      'survey-forms',
      'online-courses',
      'community-forum',
      'asset-management',
      'quote-contracts',
      'recruitment-hr',
      'video-live'
    ])
    expect(providers.map((item) => item.providerId)).toEqual([
      'supabase',
      'nestjs',
      'nestjs-prisma-crm'
    ])
    for (const item of providers) {
      expect(Object.hasOwn(item, 'descriptorKey')).toBe(false)
      expect(Object.hasOwn(item, 'descriptor')).toBe(false)
      expect(item.features).toEqual([])
      expect(item.requirements[0]).toBe(backendLibraryCopy('en').unavailableRequirement)
    }
    expect(templates.slice(0, 4)).toMatchObject([
      {
        id: 'personal-notes',
        providerId: 'nestjs',
        entities: ['notes'],
        pages: ['Sign-in page', 'Notes page']
      },
      {
        id: 'single-sku-shop',
        providerId: 'nestjs',
        entities: ['products', 'orders'],
        pages: ['Products', 'My orders', 'Shop sign in', 'Catalog manager']
      },
      {
        id: 'single-merchant-shop',
        providerId: 'nestjs',
        entities: ['products', 'orders'],
        pages: [
          'Single-merchant shop',
          'My orders',
          'Shop sign in',
          'Catalog manager',
          'Merchant orders'
        ]
      },
      {
        id: 'multi-merchant-marketplace',
        providerId: 'nestjs',
        entities: ['stores', 'products', 'orders'],
        pages: [
          'Marketplace',
          'My orders',
          'Shop sign in',
          'Catalog manager',
          'Merchant orders',
          'Store directory',
          'My store'
        ]
      }
    ])
    expect(templates[1].requirements).toContain(
      'This example does not collect payments or provide a multi-item cart.'
    )
    const single = templates[2]
    const multi = templates[3]
    expect(single.mode).not.toBe(multi.mode)
    expect(single.roles.join(' ')).toContain('catalog-manager:')
    expect(single.requirements.join(' ')).toContain('does not isolate stores')
    expect(multi.roles.join(' ')).toContain('merchant: open one store')
    expect(multi.requirements.join(' ')).toContain('stores.owner_id and stores.id')
    expect(multi.requirements.join(' ')).toContain(
      'installation does not create accounts, grant roles or create stores'
    )
    for (const item of [single, multi]) {
      expect(item.requirements.join(' ')).toContain('No payments, multi-item cart, shipping')
      expect(item.requirements.join(' ')).toContain('openpencil_roles')
    }
  })

  test('offers explicit operations editions with honest payment and settlement boundaries', () => {
    const catalog = createBackendLibraryCatalog([], 'en')
    for (const id of ['single-merchant-commerce', 'multi-merchant-commerce']) {
      const item = catalog.find((entry) => entry.id === id)
      if (item?.kind !== 'template') throw new Error('Missing operations edition')
      expect(item.pages).toHaveLength(12)
      expect(item.entities).toHaveLength(10)
      expect(item.requirements.join(' ')).toContain('no money is collected')
      expect(item.requirements.join(' ')).toContain('not a bank transfer')
      expect(item.roles.join(' ')).toContain('commerce-operator')
    }
    expect(
      ids(filterBackendLibraryCatalog(catalog, { category: 'templates', query: 'Cart Settlement' }))
    ).toEqual(['single-merchant-commerce', 'multi-merchant-commerce'])
  })

  test('preserves complete opaque keys and lists distinct descriptors sharing a provider ID', () => {
    const first = provider(
      'nestjs',
      'Plugin\u0000contribution\u0000nestjs\u0000adapter\u0000Digest:Ａ'
    )
    const second = provider(
      'nestjs',
      'Plugin\u0000contribution\u0000nestjs\u0000adapter\u0000Digest:A'
    )
    const catalog = createBackendLibraryCatalog([first, second, first], 'en')
    const nest = catalog.filter((item) => item.kind === 'provider' && item.providerId === 'nestjs')
    expect(nest).toHaveLength(2)
    expect(nest.map((item) => item.kind === 'provider' && item.descriptorKey)).toEqual([
      first.descriptorKey,
      second.descriptorKey
    ])
    expect(new Set(ids(nest)).size).toBe(2)
    expect(nest[0].id).toBe('provider:' + encodeURIComponent(first.descriptorKey))
    expect(ids(catalog)).not.toContain('provider:unavailable:nestjs')
    expect(ids(catalog)).toContain('provider:unavailable:supabase')
  })

  test('derives provider features only from descriptors and supports a future available provider', () => {
    const input = provider('custom-database')
    const item = createBackendLibraryCatalog([input], 'en')[0]
    expect(item).toMatchObject({
      kind: 'provider',
      name: 'custom-database',
      providerId: 'custom-database',
      descriptorKey: input.descriptorKey
    })
    expect(item.features).toEqual(['User identity', 'Read data', 'HTTP API'])
    expect(item.features).not.toContain('Atomic transactions')
    expect(item.features).not.toContain('Realtime subscriptions')
    expect(item.tags).toContain('example.custom-database')
    expect(item.requirements).toEqual([backendLibraryCopy('en').genericProviderRequirement])
  })

  test('distinguishes duplicate provider cards with real source metadata and preserves full identities', () => {
    const inputs = ['first', 'second'].map((suffix): BackendLibraryProviderInput => ({
      descriptorKey: 'opaque-selector-' + suffix,
      descriptor: {
        ...provider().descriptor,
        contributionId: 'nestjs.backend',
        adapterId: 'reviewed.adapter',
        adapterVersion: '2.0.0',
        packageAuthority: { packageDigest: 'app-bundle-sha256:AAAAAAAAAA-' + suffix }
      }
    }))
    const catalog = createBackendLibraryCatalog(inputs, 'en')
    const entries = catalog.filter(
      (item) => item.kind === 'provider' && item.providerId === 'nestjs'
    )
    expect(entries).toHaveLength(2)
    expect(new Set(entries.map((item) => item.name)).size).toBe(2)
    expect(entries[0].name).toContain('nestjs.backend · 2.0.0 · AAAAAAAAAA #1')
    expect(entries[1].name).toContain('nestjs.backend · 2.0.0 · AAAAAAAAAA #2')
    for (const [index, item] of entries.entries()) {
      if (item.kind !== 'provider') throw new Error('Expected provider metadata')
      expect(item.descriptorKey).toBe(inputs[index].descriptorKey)
      expect(item.identity).toContain('example.nestjs · nestjs.backend · reviewed.adapter@2.0.0')
      expect(item.identity).toContain(inputs[index].descriptor.packageAuthority?.packageDigest)
      expect(item.identity).not.toContain('opaque-selector')
    }
    expect(
      ids(
        filterBackendLibraryCatalog(catalog, {
          category: 'providers',
          query: 'reviewed.adapter AAAAAAAAAA-second'
        })
      )
    ).toEqual([entries[1].id])
    expect(
      filterBackendLibraryCatalog(catalog, { category: 'providers', query: 'opaque-selector' })
    ).toEqual([])
  })

  test('removes stale available cards when the caller supplies a changed descriptor snapshot', () => {
    const before = createBackendLibraryCatalog([provider()], 'en')
    const after = createBackendLibraryCatalog([], 'en')
    expect(before.some((item) => item.kind === 'provider' && item.descriptorKey)).toBe(true)
    expect(after.some((item) => item.kind === 'provider' && item.descriptorKey)).toBe(false)
    expect(ids(after)).toContain('provider:unavailable:nestjs')
    expect(createBackendLibraryCatalog([provider('nestjs', '')], 'en')).toEqual(after)
  })

  test('returns immutable detached data without mutating or freezing caller descriptors', () => {
    const input = provider()
    const original = structuredClone(input)
    const catalog = createBackendLibraryCatalog([input], 'zh-CN')
    expect(input).toEqual(original)
    expect(Object.isFrozen(input)).toBe(false)
    expect(Object.isFrozen(input.descriptor)).toBe(false)
    expect(Object.isFrozen(input.descriptor.capabilities)).toBe(false)
    expect(Object.isFrozen(catalog)).toBe(true)
    for (const item of catalog) {
      expect(Object.isFrozen(item)).toBe(true)
      for (const field of ['tags', 'features', 'requirements'] as const)
        expect(Object.isFrozen(item[field])).toBe(true)
      if (item.kind === 'template') {
        expect(Object.isFrozen(item.pages)).toBe(true)
        expect(Object.isFrozen(item.entities)).toBe(true)
        expect(Object.isFrozen(item.roles)).toBe(true)
      }
    }
    expect(catalog[0].features).not.toBe(input.descriptor.capabilities)
  })

  test('localizes metadata with deterministic English fallback and matching locale fields', () => {
    const en = createBackendLibraryCatalog([], 'en')
    const zh = createBackendLibraryCatalog([], 'zh-CN')
    expect(ids(en)).toEqual(ids(zh))
    expect(createBackendLibraryCatalog([], 'de')).toEqual(en)
    expect(createBackendLibraryCatalog([], 'ZH-TW')).toEqual(zh)
    expect(zh.find((item) => item.id === 'personal-notes')?.name).toBe('个人笔记')
    expect(zh.find((item) => item.id === 'personal-notes')).toMatchObject({
      pages: ['登录页', '笔记页']
    })
    expect(zh.find((item) => item.id === 'single-sku-shop')?.name).toBe('单商品下单')
    expect(zh.find((item) => item.id === 'single-merchant-shop')?.name).toBe('单商户商城')
    expect(zh.find((item) => item.id === 'multi-merchant-marketplace')?.name).toBe('多商户平台')
    expect(Object.keys(backendLibraryCopy('zh').capabilities)).toEqual(
      Object.keys(backendLibraryCopy('en').capabilities)
    )
    expect(Object.isFrozen(backendLibraryCopy('zh').templates['personal-notes'].features)).toBe(
      true
    )
  })
})

describe('backend library search and categories', () => {
  test('normalizes NFKC, case and whitespace and ANDs tokens across presentation fields', () => {
    const catalog = createBackendLibraryCatalog([provider()], 'en')
    expect(
      filterBackendLibraryCatalog(catalog, {
        category: 'all',
        query: '  ＮＥＳＴＪＳ　ＰｏｓｔｇｒｅＳＱＬ  '
      }).map((item) => item.name)
    ).toEqual(['NestJS'])
    expect(
      ids(filterBackendLibraryCatalog(catalog, { category: 'templates', query: 'notes oidc' }))
    ).toEqual(['personal-notes'])
    expect(
      ids(
        filterBackendLibraryCatalog(catalog, { category: 'all', query: 'example.nestjs postgres' })
      )
    ).toEqual(['provider:' + encodeURIComponent(provider().descriptorKey)])
    expect(
      filterBackendLibraryCatalog(catalog, { category: 'all', query: 'notes inventory' })
    ).toEqual([])
  })

  test('filters categories independently, returns stable item references and supports Chinese terms', () => {
    const catalog = createBackendLibraryCatalog([], 'zh')
    expect(filterBackendLibraryCatalog(catalog, { category: 'all', query: ' \t\n' })).toEqual(
      catalog
    )
    expect(
      filterBackendLibraryCatalog(catalog, { category: 'providers', query: '' }).every(
        (item) => item.kind === 'provider'
      )
    ).toBe(true)
    const notes = filterBackendLibraryCatalog(catalog, {
      category: 'templates',
      query: '个人 笔记'
    })
    expect(ids(notes)).toEqual(['personal-notes'])
    expect(notes[0]).toBe(catalog.find((item) => item.id === 'personal-notes'))
    expect(Object.isFrozen(notes)).toBe(true)
    expect(
      filterBackendLibraryCatalog(catalog, { category: 'providers', query: '个人笔记' })
    ).toEqual([])
    expect(
      filterBackendLibraryCatalog(catalog, { category: 'templates', query: '不存在的功能' })
    ).toEqual([])
    expect(filterBackendLibraryCatalog([], { category: 'all', query: '' })).toEqual([])
  })

  test('does not decode opaque descriptor keys into searchable identity metadata', () => {
    const catalog = createBackendLibraryCatalog(
      [provider('nestjs', 'only-the-private-selector-digest')],
      'en'
    )
    expect(
      filterBackendLibraryCatalog(catalog, { category: 'all', query: 'private-selector-digest' })
    ).toEqual([])
  })

  test('finds merchant modes by business model and role without hiding the legacy starter', () => {
    const en = createBackendLibraryCatalog([], 'en')
    expect(
      ids(
        filterBackendLibraryCatalog(en, {
          category: 'templates',
          query: 'independent stores merchant'
        })
      )
    ).toEqual(['multi-merchant-marketplace'])
    expect(
      ids(
        filterBackendLibraryCatalog(en, {
          category: 'templates',
          query: 'shared catalog catalog-manager'
        })
      )
    ).toEqual(['single-merchant-shop'])
    expect(
      ids(filterBackendLibraryCatalog(en, { category: 'templates', query: 'single-item' }))
    ).toEqual(['single-sku-shop'])
    const zh = createBackendLibraryCatalog([], 'zh')
    expect(
      ids(filterBackendLibraryCatalog(zh, { category: 'templates', query: '多商户 店铺' }))
    ).toEqual(['multi-merchant-marketplace', 'multi-merchant-commerce'])
  })
})
