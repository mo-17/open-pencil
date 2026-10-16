import { inferS3Region } from './region'
import type { S3CompatibleConfig } from './types'

export function resolveS3Region(config: S3CompatibleConfig): string {
  const explicit = config.region?.trim()
  if (explicit) return explicit
  return inferS3Region(config.endpoint)
}

export function normalizeEndpoint(endpoint: string): string {
  const trimmed = endpoint.trim().replace(/\/+$/, '')
  if (!trimmed) throw new Error('S3 endpoint is required')
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) return trimmed
  return `https://${trimmed}`
}
