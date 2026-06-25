import type { DeployEnvironment } from '@open-pencil/core'

export type { DeployEnvironment }

export interface DeployHistoryEntry {
  id: string
  provider: string
  environment: DeployEnvironment
  url: string
  deployId: string
  fileCount: number
  createdAt: string
  site?: string
}

const DEPLOY_HISTORY_KEY = 'open-pencil:lowcode-deploy-history:v1'
const DEPLOY_HISTORY_LIMIT = 8

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
    (entry.site === undefined || typeof entry.site === 'string')
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
  const nextEntry: DeployHistoryEntry = {
    ...entry,
    id: `${createdAt}:${entry.provider}:${entry.environment}:${entry.deployId}`,
    createdAt
  }
  return writeDeployHistory([nextEntry, ...readDeployHistory()])
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
