import type { AppBackendProviderDescriptor } from '@/app/plugins/host/backend-provider'

import { BUSINESS_TEMPLATE_IDS, type BusinessTemplateId } from '../business/model/types'
import { backendLibraryCopy } from './copy'

export type BackendLibraryCategory = 'all' | 'providers' | 'templates'
export type BackendLibraryTemplateId =
  | 'personal-notes'
  | 'single-sku-shop'
  | 'single-merchant-shop'
  | 'multi-merchant-marketplace'
  | 'single-merchant-commerce'
  | 'multi-merchant-commerce'
  | BusinessTemplateId

export function isBusinessTemplate(id: string): id is BusinessTemplateId {
  return BUSINESS_TEMPLATE_IDS.some((entry) => entry === id)
}

export function isBackendLibraryTemplateId(id: string): id is BackendLibraryTemplateId {
  return (
    [
      'personal-notes',
      'single-sku-shop',
      'single-merchant-shop',
      'multi-merchant-marketplace',
      'single-merchant-commerce',
      'multi-merchant-commerce'
    ].includes(id) || isBusinessTemplate(id)
  )
}

export function isCommerceOperationsTemplate(id: string): boolean {
  return id === 'single-merchant-commerce' || id === 'multi-merchant-commerce'
}

export interface BackendLibraryProviderInput {
  readonly descriptorKey: string
  readonly descriptor: Pick<
    AppBackendProviderDescriptor,
    'providerId' | 'pluginId' | 'capabilities'
  > &
    Partial<
      Pick<AppBackendProviderDescriptor, 'contributionId' | 'adapterId' | 'adapterVersion'>
    > & {
      readonly packageAuthority?: Pick<
        AppBackendProviderDescriptor['packageAuthority'],
        'packageDigest'
      >
    }
}
interface BackendLibraryEntry {
  readonly id: string
  readonly name: string
  readonly description: string
  readonly providerId: string
  readonly tags: readonly string[]
  readonly features: readonly string[]
  readonly requirements: readonly string[]
}
export interface BackendLibraryProvider extends BackendLibraryEntry {
  readonly kind: 'provider'
  /** Presentation metadata copied from the descriptor, never decoded from its opaque selector. */
  readonly identity?: string
  /** An opaque selector for re-resolving the live descriptor; never execution authority. */
  readonly descriptorKey?: string
}
export interface BackendLibraryTemplate extends BackendLibraryEntry {
  readonly kind: 'template'
  readonly id: BackendLibraryTemplateId
  readonly providerId: 'nestjs'
  readonly mode: string
  readonly roles: readonly string[]
  readonly pages: readonly string[]
  readonly entities: readonly string[]
}
export type BackendLibraryItem = BackendLibraryProvider | BackendLibraryTemplate
export interface BackendLibraryFilter {
  readonly category: BackendLibraryCategory
  readonly query: string
}

function immutableItem<T extends BackendLibraryItem>(item: T): T {
  Object.freeze(item.tags)
  Object.freeze(item.features)
  Object.freeze(item.requirements)
  if (item.kind === 'template') {
    Object.freeze(item.pages)
    Object.freeze(item.entities)
    Object.freeze(item.roles)
  }
  return Object.freeze(item)
}

function providerIdentity(descriptor: BackendLibraryProviderInput['descriptor']): string {
  return [
    descriptor.pluginId,
    descriptor.contributionId,
    descriptor.adapterId && descriptor.adapterVersion
      ? descriptor.adapterId + '@' + descriptor.adapterVersion
      : (descriptor.adapterId ?? descriptor.adapterVersion),
    descriptor.packageAuthority?.packageDigest
  ]
    .filter(Boolean)
    .join(' · ')
}

function shortProviderIdentity(descriptor: BackendLibraryProviderInput['descriptor']): string {
  const digest = descriptor.packageAuthority?.packageDigest
  const suffix = digest?.slice(digest.lastIndexOf(':') + 1).slice(0, 10)
  return [
    descriptor.contributionId ?? descriptor.adapterId ?? descriptor.pluginId,
    descriptor.adapterVersion,
    suffix
  ]
    .filter(Boolean)
    .join(' · ')
}

function distinguishProviders(
  providers: readonly BackendLibraryProvider[],
  descriptors: ReadonlyMap<string, BackendLibraryProviderInput['descriptor']>
): BackendLibraryProvider[] {
  return providers.map((provider) => {
    const peers = providers.filter((item) => item.name === provider.name)
    const descriptor = provider.descriptorKey && descriptors.get(provider.descriptorKey)
    if (peers.length < 2 || !descriptor) return provider
    const label = shortProviderIdentity(descriptor)
    const matching = peers.filter((item) => {
      const source = item.descriptorKey && descriptors.get(item.descriptorKey)
      return source && shortProviderIdentity(source) === label
    })
    const suffix = matching.length > 1 ? ' #' + (matching.indexOf(provider) + 1) : ''
    return immutableItem({ ...provider, name: provider.name + ' · ' + label + suffix })
  })
}

/** Consumes a current, already-keyed descriptor list. This module neither loads nor activates plugins. */
export function createBackendLibraryCatalog(
  providers: readonly BackendLibraryProviderInput[],
  locale: string
): readonly BackendLibraryItem[] {
  const copy = backendLibraryCopy(locale)
  const keys = new Set<string>()
  const descriptors = new Map<string, BackendLibraryProviderInput['descriptor']>()
  const available: BackendLibraryProvider[] = []
  for (const { descriptor, descriptorKey } of providers) {
    if (!descriptorKey || keys.has(descriptorKey)) continue
    keys.add(descriptorKey)
    descriptors.set(descriptorKey, descriptor)
    const profile =
      descriptor.providerId === 'supabase' || descriptor.providerId === 'nestjs'
        ? copy.providers[descriptor.providerId]
        : undefined
    available.push(
      immutableItem({
        kind: 'provider',
        id: 'provider:' + encodeURIComponent(descriptorKey),
        name: profile?.name ?? descriptor.providerId,
        description: profile?.description ?? copy.genericProviderDescription,
        providerId: descriptor.providerId,
        descriptorKey,
        identity: providerIdentity(descriptor),
        tags: [...new Set([...(profile?.tags ?? []), descriptor.providerId, descriptor.pluginId])],
        features: [...new Set(descriptor.capabilities)].map(
          (capability) => copy.capabilities[capability]
        ),
        requirements: [...(profile?.requirements ?? [copy.genericProviderRequirement])]
      })
    )
  }
  const unavailable: BackendLibraryProvider[] = []
  for (const providerId of ['supabase', 'nestjs'] as const) {
    if (available.some((item) => item.providerId === providerId)) continue
    const profile = copy.providers[providerId]
    unavailable.push(
      immutableItem({
        kind: 'provider',
        id: 'provider:unavailable:' + providerId,
        name: profile.name,
        description: profile.description,
        providerId,
        tags: [...profile.tags],
        features: [],
        requirements: [copy.unavailableRequirement, ...profile.requirements]
      })
    )
  }
  const templateEntities = {
    'personal-notes': ['notes'],
    'single-sku-shop': ['products', 'orders'],
    'single-merchant-shop': ['products', 'orders'],
    'multi-merchant-marketplace': ['stores', 'products', 'orders'],
    'single-merchant-commerce': [
      'stores',
      'products',
      'carts',
      'cart_items',
      'purchases',
      'orders',
      'order_items',
      'refunds',
      'shipments',
      'settlements'
    ],
    'multi-merchant-commerce': [
      'stores',
      'products',
      'carts',
      'cart_items',
      'purchases',
      'orders',
      'order_items',
      'refunds',
      'shipments',
      'settlements'
    ],
    'customer-crm': ['users', 'customers', 'customer_history'],
    'service-desk': ['users', 'tickets', 'ticket_history'],
    'content-knowledge-base': ['users', 'articles', 'article_history'],
    'booking-registration': ['users', 'services', 'slots', 'bookings', 'booking_history'],
    'project-tasks': ['users', 'projects', 'project_members', 'tasks', 'task_history']
  } as const satisfies Record<BackendLibraryTemplateId, readonly string[]>
  const templates = (Object.keys(templateEntities) as BackendLibraryTemplateId[]).map((id) => {
    const profile = copy.templates[id]
    return immutableItem<BackendLibraryTemplate>({
      kind: 'template',
      id,
      name: profile.name,
      description: profile.description,
      providerId: 'nestjs',
      mode: profile.mode,
      roles: [...profile.roles],
      tags: [...profile.tags],
      features: [...profile.features],
      requirements: [...profile.requirements],
      pages: [...profile.pages],
      entities: [...templateEntities[id]]
    })
  })
  return Object.freeze([
    ...distinguishProviders(available, descriptors),
    ...unavailable,
    ...templates
  ])
}

function normalizedSearch(value: string): string {
  return value.normalize('NFKC').trim().toLowerCase()
}

/** Search tokens are ANDed across presentation fields, without altering opaque descriptor keys. */
export function filterBackendLibraryCatalog(
  items: readonly BackendLibraryItem[],
  filter: BackendLibraryFilter
): readonly BackendLibraryItem[] {
  const tokens = normalizedSearch(filter.query).split(/\s+/u).filter(Boolean)
  return Object.freeze(
    items.filter((item) => {
      if (filter.category === 'providers' && item.kind !== 'provider') return false
      if (filter.category === 'templates' && item.kind !== 'template') return false
      const text = normalizedSearch(
        [
          item.name,
          item.description,
          item.providerId,
          ...(item.kind === 'provider' && item.identity ? [item.identity] : []),
          ...(item.kind === 'template' ? [item.mode, ...item.roles] : []),
          ...item.tags
        ].join(' ')
      )
      return tokens.every((token) => text.includes(token))
    })
  )
}
