import type { AppBackendProviderDescriptor } from '@/app/plugins/host/backend-provider'

import { backendLibraryCopy } from './copy'

export function backendProviderDescriptorKey(descriptor: AppBackendProviderDescriptor): string {
  return [
    descriptor.pluginId,
    descriptor.contributionId,
    descriptor.providerId,
    descriptor.adapterId,
    descriptor.packageAuthority.packageDigest
  ].join('\u0000')
}

export function backendProviderDescriptorLabel(
  descriptor: AppBackendProviderDescriptor,
  locale = 'en'
): string {
  const name =
    descriptor.providerId === 'nestjs-prisma-crm'
      ? backendLibraryCopy(locale).providers['nestjs-prisma-crm'].name
      : descriptor.providerId
  return `${name} · ${descriptor.pluginId}`
}
