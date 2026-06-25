import type { DeployEnvironment } from '@open-pencil/core'

export type { DeployEnvironment }
export type DeployHistoryProvider = 'netlify' | 'vercel' | 'cloudflare'
export type DeployHistoryUiKit = 'none' | 'shadcn'

export interface DeployHistoryEntry {
  id: string
  provider: string
  environment: DeployEnvironment
  url: string
  deployId: string
  fileCount: number
  createdAt: string
  site?: string
  uiKit?: DeployHistoryUiKit
  i18nEnabled?: boolean
  locales?: string[]
  buildOptions?: DeployBuildOptions
  artifactLabel?: string
  compat?: DeployHistoryCompat
}

export interface DeployBuildOptions {
  uiKit: DeployHistoryUiKit
  i18nEnabled: boolean
  locales: string[]
}

export interface DeployHistoryCompat {
  schema: 1
}

export interface DeployRollbackDraft {
  provider: DeployHistoryProvider
  environment: DeployEnvironment
  site?: string
  uiKit: DeployHistoryUiKit
  i18nEnabled: boolean
  locales: string[]
}

const DEPLOY_HISTORY_KEY = 'open-pencil:lowcode-deploy-history:v1'
const DEPLOY_HISTORY_LIMIT = 8
const DEPLOY_HISTORY_SCHEMA = 1

function storage(): Storage | null {
  if (typeof window === 'undefined') return null
  if (typeof window.localStorage?.getItem !== 'function') return null
  return window.localStorage
}

function isDeployHistoryEntry(value: unknown): value is DeployHistoryEntry {
  if (!value || typeof value !== 'object') return false
  const entry = value as Record<string, unknown>
  return (
    typeof entry.id === 'string' &&
    typeof entry.provider === 'string' &&
    typeof entry.url === 'string' &&
    typeof entry.deployId === 'string' &&
    typeof entry.fileCount === 'number' &&
    typeof entry.createdAt === 'string' &&
    (entry.environment === 'preview' ||
      entry.environment === 'staging' ||
      entry.environment === 'production') &&
    (entry.site === undefined || typeof entry.site === 'string') &&
    (entry.uiKit === undefined || entry.uiKit === 'none' || entry.uiKit === 'shadcn') &&
    (entry.i18nEnabled === undefined || typeof entry.i18nEnabled === 'boolean') &&
    (entry.locales === undefined ||
      (Array.isArray(entry.locales) && entry.locales.every((loc) => typeof loc === 'string'))) &&
    (entry.buildOptions === undefined || isDeployBuildOptions(entry.buildOptions)) &&
    (entry.artifactLabel === undefined || typeof entry.artifactLabel === 'string') &&
    (entry.compat === undefined || isDeployHistoryCompat(entry.compat))
  )
}

function isDeployBuildOptions(value: unknown): value is DeployBuildOptions {
  if (!value || typeof value !== 'object') return false
  const options = value as Record<string, unknown>
  return (
    (options.uiKit === 'none' || options.uiKit === 'shadcn') &&
    typeof options.i18nEnabled === 'boolean' &&
    Array.isArray(options.locales) &&
    options.locales.every((loc) => typeof loc === 'string')
  )
}

function isDeployHistoryCompat(value: unknown): value is DeployHistoryCompat {
  if (!value || typeof value !== 'object') return false
  return (value as Record<string, unknown>).schema === DEPLOY_HISTORY_SCHEMA
}

export function readDeployHistory(): DeployHistoryEntry[] {
  const s = storage()
  if (!s) return []
  const raw = s.getItem(DEPLOY_HISTORY_KEY)
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.filter(isDeployHistoryEntry)
  } catch {
    return []
  }
}

export function writeDeployHistory(entries: readonly DeployHistoryEntry[]): DeployHistoryEntry[] {
  const next = entries.slice(0, DEPLOY_HISTORY_LIMIT)
  const s = storage()
  if (s) s.setItem(DEPLOY_HISTORY_KEY, JSON.stringify(next))
  return next
}

export function recordDeployHistory(
  entry: Omit<DeployHistoryEntry, 'id' | 'createdAt'>
): DeployHistoryEntry[] {
  const createdAt = new Date().toISOString()
  const buildOptions = deployBuildOptionsSnapshot(entry)
  const nextEntry: DeployHistoryEntry = {
    ...entry,
    buildOptions,
    artifactLabel: entry.artifactLabel ?? deployArtifactLabel({ ...entry, buildOptions }),
    compat: { schema: DEPLOY_HISTORY_SCHEMA },
    id: `${createdAt}:${entry.provider}:${entry.environment}:${entry.deployId}`,
    createdAt
  }
  return writeDeployHistory([nextEntry, ...readDeployHistory()])
}

export function deployBuildOptionsSnapshot(entry: {
  uiKit?: DeployHistoryUiKit
  i18nEnabled?: boolean
  locales?: readonly string[]
  buildOptions?: DeployBuildOptions
}): DeployBuildOptions {
  return {
    uiKit: entry.buildOptions?.uiKit ?? entry.uiKit ?? 'none',
    i18nEnabled: entry.buildOptions?.i18nEnabled ?? entry.i18nEnabled ?? false,
    locales: [...(entry.buildOptions?.locales ?? entry.locales ?? [])]
  }
}

export function deployArtifactLabel(entry: {
  provider: string
  environment: DeployEnvironment
  site?: string
  buildOptions?: DeployBuildOptions
  uiKit?: DeployHistoryUiKit
  i18nEnabled?: boolean
  locales?: readonly string[]
}): string {
  const options = deployBuildOptionsSnapshot(entry)
  const parts = [entry.environment, entry.provider]
  if (entry.site) parts.push(entry.site)
  if (options.uiKit !== 'none') parts.push(options.uiKit)
  if (options.i18nEnabled) {
    parts.push(options.locales.length > 0 ? `i18n:${options.locales.join(',')}` : 'i18n')
  }
  return parts.join(' · ')
}

export function deployRollbackDraft(entry: DeployHistoryEntry): DeployRollbackDraft | null {
  if (
    entry.provider !== 'netlify' &&
    entry.provider !== 'vercel' &&
    entry.provider !== 'cloudflare'
  ) {
    return null
  }
  const buildOptions = deployBuildOptionsSnapshot(entry)
  return {
    provider: entry.provider,
    environment: entry.environment,
    site: entry.site,
    uiKit: buildOptions.uiKit,
    i18nEnabled: buildOptions.i18nEnabled,
    locales: buildOptions.locales
  }
}

export function deployDashboardUrl(
  entry: Pick<DeployHistoryEntry, 'provider' | 'deployId' | 'site'>
): string | null {
  if (entry.provider === 'netlify') {
    return `https://app.netlify.com/deploys/${encodeURIComponent(entry.deployId)}`
  }
  if (entry.provider === 'vercel') {
    return `https://vercel.com/deployments/${encodeURIComponent(entry.deployId)}`
  }
  if (entry.provider === 'cloudflare' && entry.site?.includes('/')) {
    const [accountId, projectName] = entry.site.split('/', 2)
    if (accountId && projectName) {
      return `https://dash.cloudflare.com/${encodeURIComponent(accountId)}/pages/view/${encodeURIComponent(projectName)}/${encodeURIComponent(entry.deployId)}`
    }
  }
  return null
}
