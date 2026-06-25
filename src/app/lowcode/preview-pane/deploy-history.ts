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

export interface DeployTargetPreset {
  environment: DeployEnvironment
  provider: DeployHistoryProvider
  site?: string
  buildOptions: DeployBuildOptions
  updatedAt: string
}

export type DeployRollbackSupport = 'api-candidate' | 'dashboard-only' | 'unsupported'

export interface DeployRollbackContract {
  provider: string
  support: DeployRollbackSupport
  label: string
  requiredFields: string[]
  reason?: string
  dashboardUrl: string | null
}

export interface NetlifyRollbackTarget {
  token: string
  siteId: string
  deployId: string
}

export interface DeployRollbackResult {
  provider: DeployHistoryProvider
  deployId: string
  url?: string
}

const DEPLOY_HISTORY_KEY = 'open-pencil:lowcode-deploy-history:v1'
const DEPLOY_TARGETS_KEY = 'open-pencil:lowcode-deploy-targets:v1'
const DEPLOY_HISTORY_LIMIT = 8
const DEPLOY_HISTORY_SCHEMA = 1
const NETLIFY_API = 'https://api.netlify.com/api/v1'

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

function isDeployTargetPreset(value: unknown): value is DeployTargetPreset {
  if (!value || typeof value !== 'object') return false
  const preset = value as Record<string, unknown>
  return (
    (preset.environment === 'preview' ||
      preset.environment === 'staging' ||
      preset.environment === 'production') &&
    (preset.provider === 'netlify' ||
      preset.provider === 'vercel' ||
      preset.provider === 'cloudflare') &&
    (preset.site === undefined || typeof preset.site === 'string') &&
    isDeployBuildOptions(preset.buildOptions) &&
    typeof preset.updatedAt === 'string'
  )
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

export function readDeployTargetPresets(): Record<DeployEnvironment, DeployTargetPreset | null> {
  const empty = { preview: null, staging: null, production: null }
  const s = storage()
  if (!s) return empty
  const raw = s.getItem(DEPLOY_TARGETS_KEY)
  if (!raw) return empty
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object') return empty
    const record = parsed as Record<string, unknown>
    return {
      preview: isDeployTargetPreset(record.preview) ? record.preview : null,
      staging: isDeployTargetPreset(record.staging) ? record.staging : null,
      production: isDeployTargetPreset(record.production) ? record.production : null
    }
  } catch {
    return empty
  }
}

export function writeDeployTargetPresets(
  presets: Record<DeployEnvironment, DeployTargetPreset | null>
): Record<DeployEnvironment, DeployTargetPreset | null> {
  const s = storage()
  if (s) s.setItem(DEPLOY_TARGETS_KEY, JSON.stringify(presets))
  return presets
}

export function saveDeployTargetPreset(
  draft: Omit<DeployTargetPreset, 'updatedAt'>
): Record<DeployEnvironment, DeployTargetPreset | null> {
  const presets = readDeployTargetPresets()
  const next: DeployTargetPreset = {
    ...draft,
    buildOptions: deployBuildOptionsSnapshot(draft.buildOptions),
    updatedAt: new Date().toISOString()
  }
  return writeDeployTargetPresets({ ...presets, [draft.environment]: next })
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

export function deployRollbackContract(
  entry: Pick<DeployHistoryEntry, 'provider' | 'deployId' | 'site'>
): DeployRollbackContract {
  const dashboardUrl = deployDashboardUrl(entry)
  if (entry.provider === 'netlify') {
    const hasTarget = typeof entry.site === 'string' && entry.site.trim() !== ''
    return {
      provider: 'netlify',
      support: hasTarget ? 'api-candidate' : 'dashboard-only',
      label: 'Restore deploy',
      requiredFields: ['token', 'site', 'deployId'],
      reason: hasTarget ? undefined : 'Netlify restore needs a site id or site slug.',
      dashboardUrl
    }
  }
  if (entry.provider === 'cloudflare') {
    const hasTarget = typeof entry.site === 'string' && entry.site.includes('/')
    return {
      provider: 'cloudflare',
      support: hasTarget ? 'api-candidate' : 'dashboard-only',
      label: 'Rollback Pages deployment',
      requiredFields: ['token', 'site', 'deployId'],
      reason: hasTarget ? undefined : 'Cloudflare rollback needs an account/project site target.',
      dashboardUrl
    }
  }
  if (entry.provider === 'vercel') {
    return {
      provider: 'vercel',
      support: 'dashboard-only',
      label: 'Promote deployment',
      requiredFields: ['token', 'deployId', 'productionAlias'],
      reason:
        'Vercel rollback needs production alias/project ownership metadata not stored locally yet.',
      dashboardUrl
    }
  }
  return {
    provider: entry.provider,
    support: 'unsupported',
    label: 'Provider rollback',
    requiredFields: [],
    reason: 'No rollback contract is defined for this provider.',
    dashboardUrl
  }
}

export async function restoreNetlifyDeploy(
  target: NetlifyRollbackTarget,
  fetcher: typeof fetch = fetch
): Promise<DeployRollbackResult> {
  const token = target.token.trim()
  const siteId = target.siteId.trim()
  const deployId = target.deployId.trim()
  if (!token) throw new Error('Netlify rollback requires a token.')
  if (!siteId) throw new Error('Netlify rollback requires a site id or site slug.')
  if (!deployId) throw new Error('Netlify rollback requires a deploy id.')

  const res = await fetcher(
    `${NETLIFY_API}/sites/${encodeURIComponent(siteId)}/deploys/${encodeURIComponent(deployId)}/restore`,
    { method: 'POST', headers: { Authorization: `Bearer ${token}` } }
  )
  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    const hint = res.status === 401 ? ' (check your token)' : ''
    throw new Error(`Netlify rollback failed: ${res.status}${hint}${detail ? ` — ${detail}` : ''}`)
  }
  const text = await res.text()
  const deploy = text ? (JSON.parse(text) as Record<string, unknown>) : {}
  const restoredId = typeof deploy.id === 'string' ? deploy.id : deployId
  const url =
    typeof deploy.ssl_url === 'string'
      ? deploy.ssl_url
      : typeof deploy.url === 'string'
        ? deploy.url
        : undefined
  return { provider: 'netlify', deployId: restoredId, url }
}
