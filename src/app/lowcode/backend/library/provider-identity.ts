import type { AppBackendProviderDescriptor } from '@/app/plugins/host/backend-provider'

export function backendProviderDescriptorKey(descriptor: AppBackendProviderDescriptor): string {
  return [
    descriptor.pluginId,
    descriptor.contributionId,
    descriptor.providerId,
    descriptor.adapterId,
    descriptor.packageAuthority.packageDigest
  ].join('\u0000')
}

export function backendProviderDescriptorLabel(descriptor: AppBackendProviderDescriptor): string {
  return `${descriptor.providerId} · ${descriptor.pluginId}`
}
