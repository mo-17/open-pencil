import { sha256 } from '@noble/hashes/sha256'
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils'

import type { DeployEnvironment } from '@open-pencil/core/lowcode-deployment'
import { detectSupabaseSecretKey } from '@open-pencil/core/lowcode-validation'

import { readLocalStorageText, writeLocalStorageText } from '@/app/cache'

export type { DeployEnvironment }
export type DeployHistoryProvider = 'netlify' | 'vercel' | 'cloudflare'
export type DeployHistoryUIKit = 'none' | 'shadcn'

export interface DeployHistoryEntry {
  id: string
  provider: string
  environment: DeployEnvironment
  url: string
  deployId: string
  fileCount: number
  createdAt: string
  site?: string
  uiKit?: DeployHistoryUIKit
  i18nEnabled?: boolean
  locales?: string[]
  buildOptions?: DeployBuildOptions
  runtimeConfig?: DeployRuntimeConfig
  artifactLabel?: string
  compat?: DeployHistoryCompat
}

export interface DeployBuildOptions {
  uiKit: DeployHistoryUIKit
  i18nEnabled: boolean
  locales: string[]
}

/** Public runtime values that may differ between preview, staging, and
 * production. Supabase publishable/anon keys are intentionally allowed here;
 * provider access tokens and service-role/secret keys are not. */
export interface DeployRuntimeConfig {
  supabaseUrl?: string
  supabaseAnonKey?: string
  supabaseSchema?: string
}

export type DeployRuntimeConfigValidation =
  | { ok: true; value: DeployRuntimeConfig | undefined }
  | { ok: false; reason: string }

export interface DeployHistoryCompat {
  schema: 1
}

export interface DeployRollbackDraft {
  provider: DeployHistoryProvider
  environment: DeployEnvironment
  site?: string
  uiKit: DeployHistoryUIKit
  i18nEnabled: boolean
  locales: string[]
  runtimeConfig?: DeployRuntimeConfig
}

export type DeployDocumentIdentity =
  | { kind: 'path'; path: string }
  | {
      kind: 'storage'
      providerId: string
      profileId?: string
      accountId?: string
      documentId: string
    }
  | { kind: 'transient'; id: string }

export interface DeployTargetPreset {
  environment: DeployEnvironment
  provider: DeployHistoryProvider
  site?: string
  buildOptions: DeployBuildOptions
  runtimeConfig?: DeployRuntimeConfig
  updatedAt: string
}

export type DeployRollbackSupport = 'api-candidate' | 'dashboard-only' | 'unsupported'

export interface DeployRollbackContract {
  provider: string
  support: DeployRollbackSupport
  label: string
  requiredFields: string[]
  missingFields: string[]
  reason?: string
  dashboardUrl: string | null
}

export interface CloudflarePagesTargetMetadata {
  accountId?: string
  projectName?: string
  missingFields: string[]
  reason?: string
}

export interface VercelProjectTargetMetadata {
  projectName?: string
  missingFields: string[]
  reason?: string
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
const VOLATILE_SCOPE_PREFIX = 'volatile:'
const volatileStorage = new Map<string, string>()

function storageIdentityValue(
  identity: Extract<DeployDocumentIdentity, { kind: 'storage' }>
): string | undefined {
  const providerId = identity.providerId.trim()
  const profileId = identity.profileId?.trim()
  const accountId = identity.accountId?.trim()
  const documentId = identity.documentId.trim()
  if (!providerId || !documentId) return undefined
  if (identity.profileId !== undefined && !profileId) return undefined
  if (identity.accountId !== undefined && !accountId) return undefined
  return profileId === undefined && accountId === undefined
    ? `storage\0${providerId}\0${documentId}`
    : `storage\0${providerId}\0${profileId ?? 'default'}\0${accountId ?? ''}\0${documentId}`
}

/** Scope deploy metadata without writing a local path or remote document id to
 * localStorage. Saved/remote identities use a collision-resistant SHA-256
 * digest. Unsaved tab identities are process-local and never persisted. */
export function deployDocumentScope(
  identity: string | DeployDocumentIdentity | null | undefined
): string | undefined {
  let normalizedIdentity: DeployDocumentIdentity | undefined
  if (typeof identity === 'string') {
    const path = identity.trim()
    normalizedIdentity = path ? { kind: 'path', path } : undefined
  } else {
    normalizedIdentity = identity ?? undefined
  }
  if (!normalizedIdentity) return undefined
  let value: string
  if (normalizedIdentity.kind === 'path') {
    const path = normalizedIdentity.path.trim()
    if (!path) return undefined
    value = `path\0${path}`
  } else if (normalizedIdentity.kind === 'storage') {
    const storageValue = storageIdentityValue(normalizedIdentity)
    if (!storageValue) return undefined
    value = storageValue
  } else {
    const id = normalizedIdentity.id.trim()
    if (!id) return undefined
    value = `transient\0${id}`
  }
  const digest = bytesToHex(sha256(utf8ToBytes(value)))
  return normalizedIdentity.kind === 'transient'
    ? `${VOLATILE_SCOPE_PREFIX}${digest}`
    : `doc-sha256-${digest}`
}

function scopedStorageKey(base: string, scope?: string): string {
  const normalized = scope?.trim()
  return normalized ? `${base}:${normalized}` : base
}

function readScopedText(base: string, scope?: string): string | null {
  const key = scopedStorageKey(base, scope)
  return scope?.startsWith(VOLATILE_SCOPE_PREFIX)
    ? (volatileStorage.get(key) ?? null)
    : readLocalStorageText(key)
}

function writeScopedText(base: string, scope: string | undefined, value: string): void {
  const key = scopedStorageKey(base, scope)
  if (scope?.startsWith(VOLATILE_SCOPE_PREFIX)) {
    volatileStorage.set(key, value)
    return
  }
  writeLocalStorageText(key, value)
}

interface UnknownFields {
  [key: string]: unknown
}

function objectFields(value: unknown): UnknownFields | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as UnknownFields
}

function isDeployHistoryEntry(value: unknown): value is DeployHistoryEntry {
  const entry = objectFields(value)
  if (!entry) return false
  if (!isDeployHistoryRequiredFields(entry)) return false
  if (!isDeployHistoryOptionalFields(entry)) return false
  return entry.compat === undefined || isDeployHistoryCompat(entry.compat)
}

function isDeployHistoryRequiredFields(entry: UnknownFields): boolean {
  return (
    typeof entry.id === 'string' &&
    typeof entry.provider === 'string' &&
    typeof entry.url === 'string' &&
    typeof entry.deployId === 'string' &&
    typeof entry.fileCount === 'number' &&
    typeof entry.createdAt === 'string' &&
    isDeployEnvironment(entry.environment)
  )
}

function isDeployHistoryOptionalFields(entry: UnknownFields): boolean {
  return (
    (entry.site === undefined || typeof entry.site === 'string') &&
    (entry.uiKit === undefined || entry.uiKit === 'none' || entry.uiKit === 'shadcn') &&
    (entry.i18nEnabled === undefined || typeof entry.i18nEnabled === 'boolean') &&
    (entry.locales === undefined ||
      (Array.isArray(entry.locales) && entry.locales.every((loc) => typeof loc === 'string'))) &&
    (entry.buildOptions === undefined || isDeployBuildOptions(entry.buildOptions)) &&
    (entry.runtimeConfig === undefined || isDeployRuntimeConfig(entry.runtimeConfig)) &&
    (entry.artifactLabel === undefined || typeof entry.artifactLabel === 'string')
  )
}

function isDeployBuildOptions(value: unknown): value is DeployBuildOptions {
  const options = objectFields(value)
  if (!options) return false
  return (
    (options.uiKit === 'none' || options.uiKit === 'shadcn') &&
    typeof options.i18nEnabled === 'boolean' &&
    Array.isArray(options.locales) &&
    options.locales.every((loc) => typeof loc === 'string')
  )
}

function isDeployHistoryCompat(value: unknown): value is DeployHistoryCompat {
  return objectFields(value)?.schema === DEPLOY_HISTORY_SCHEMA
}

function isDeployTargetPreset(value: unknown): value is DeployTargetPreset {
  const preset = objectFields(value)
  if (!preset) return false
  return (
    isDeployEnvironment(preset.environment) &&
    (preset.provider === 'netlify' ||
      preset.provider === 'vercel' ||
      preset.provider === 'cloudflare') &&
    (preset.site === undefined || typeof preset.site === 'string') &&
    isDeployBuildOptions(preset.buildOptions) &&
    (preset.runtimeConfig === undefined || isDeployRuntimeConfig(preset.runtimeConfig)) &&
    typeof preset.updatedAt === 'string'
  )
}

function isDeployRuntimeConfig(value: unknown): value is DeployRuntimeConfig {
  const config = objectFields(value)
  if (!config) return false
  const fieldsValid =
    (config.supabaseUrl === undefined || typeof config.supabaseUrl === 'string') &&
    (config.supabaseAnonKey === undefined || typeof config.supabaseAnonKey === 'string') &&
    (config.supabaseSchema === undefined || typeof config.supabaseSchema === 'string')
  return fieldsValid && validateDeployRuntimeConfig(config as DeployRuntimeConfig).ok
}

function isDeployEnvironment(value: unknown): value is DeployEnvironment {
  return value === 'preview' || value === 'staging' || value === 'production'
}

export function readDeployHistory(scope?: string): DeployHistoryEntry[] {
  const raw = readScopedText(DEPLOY_HISTORY_KEY, scope)
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.filter(isDeployHistoryEntry)
  } catch {
    return []
  }
}

export function writeDeployHistory(
  entries: readonly DeployHistoryEntry[],
  scope?: string
): DeployHistoryEntry[] {
  const next = entries.slice(0, DEPLOY_HISTORY_LIMIT)
  writeScopedText(DEPLOY_HISTORY_KEY, scope, JSON.stringify(next))
  return next
}

export function recordDeployHistory(
  entry: Omit<DeployHistoryEntry, 'id' | 'createdAt'>,
  scope?: string
): DeployHistoryEntry[] {
  const createdAt = new Date().toISOString()
  const buildOptions = deployBuildOptionsSnapshot(entry)
  const nextEntry: DeployHistoryEntry = {
    ...entry,
    buildOptions,
    runtimeConfig: deployRuntimeConfigSnapshot(entry.runtimeConfig),
    artifactLabel: entry.artifactLabel ?? deployArtifactLabel({ ...entry, buildOptions }),
    compat: { schema: DEPLOY_HISTORY_SCHEMA },
    id: `${createdAt}:${entry.provider}:${entry.environment}:${entry.deployId}`,
    createdAt
  }
  return writeDeployHistory([nextEntry, ...readDeployHistory(scope)], scope)
}

export function readDeployTargetPresets(
  scope?: string
): Record<DeployEnvironment, DeployTargetPreset | null> {
  const empty = { preview: null, staging: null, production: null }
  const raw = readScopedText(DEPLOY_TARGETS_KEY, scope)
  if (!raw) return empty
  try {
    const parsed = JSON.parse(raw) as unknown
    const record = objectFields(parsed)
    if (!record) return empty
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
  presets: Record<DeployEnvironment, DeployTargetPreset | null>,
  scope?: string
): Record<DeployEnvironment, DeployTargetPreset | null> {
  writeScopedText(DEPLOY_TARGETS_KEY, scope, JSON.stringify(presets))
  return presets
}

export function saveDeployTargetPreset(
  draft: Omit<DeployTargetPreset, 'updatedAt'>,
  scope?: string
): Record<DeployEnvironment, DeployTargetPreset | null> {
  const presets = readDeployTargetPresets(scope)
  const next: DeployTargetPreset = {
    ...draft,
    buildOptions: deployBuildOptionsSnapshot(draft.buildOptions),
    runtimeConfig: deployRuntimeConfigSnapshot(draft.runtimeConfig),
    updatedAt: new Date().toISOString()
  }
  return writeDeployTargetPresets({ ...presets, [draft.environment]: next }, scope)
}

export function deployRuntimeConfigSnapshot(
  config: DeployRuntimeConfig | undefined
): DeployRuntimeConfig | undefined {
  const validated = validateDeployRuntimeConfig(config)
  if (!validated.ok) throw new TypeError(validated.reason)
  return validated.value
}

function validateRuntimeSupabaseURL(supabaseURL: string | undefined): string | undefined {
  if (!supabaseURL) return undefined
  try {
    const parsed = new URL(supabaseURL)
    if (
      (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') ||
      parsed.username ||
      parsed.password
    ) {
      return 'Supabase URL must be an HTTP(S) URL without credentials.'
    }
  } catch {
    return 'Supabase URL is invalid.'
  }
  return undefined
}

export function validateDeployRuntimeConfig(
  config: DeployRuntimeConfig | undefined
): DeployRuntimeConfigValidation {
  if (!config) return { ok: true, value: undefined }
  const supabaseURL = config.supabaseUrl?.trim()
  const supabaseAnonKey = config.supabaseAnonKey?.trim()
  const supabaseSchema = config.supabaseSchema?.trim()
  if (!supabaseURL && !supabaseAnonKey && !supabaseSchema) return { ok: true, value: undefined }
  if (!!supabaseURL !== !!supabaseAnonKey) {
    return {
      ok: false,
      reason: 'Supabase URL and publishable/anon key must be overridden together.'
    }
  }
  const urlError = validateRuntimeSupabaseURL(supabaseURL)
  if (urlError) return { ok: false, reason: urlError }
  if (supabaseAnonKey && detectSupabaseSecretKey(supabaseAnonKey)) {
    return {
      ok: false,
      reason: 'Supabase secret/service-role keys cannot be saved or sent to a browser build.'
    }
  }
  if (supabaseSchema && !/^[A-Za-z_][A-Za-z0-9_$]{0,62}$/.test(supabaseSchema)) {
    return {
      ok: false,
      reason: 'Supabase schema must be a plain PostgreSQL identifier (up to 63 characters).'
    }
  }
  const value: DeployRuntimeConfig = {
    ...(supabaseURL ? { supabaseUrl: supabaseURL } : {}),
    ...(supabaseAnonKey ? { supabaseAnonKey } : {}),
    ...(supabaseSchema ? { supabaseSchema } : {})
  }
  return { ok: true, value }
}

export function deployBuildOptionsSnapshot(entry: {
  uiKit?: DeployHistoryUIKit
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
  uiKit?: DeployHistoryUIKit
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
    locales: buildOptions.locales,
    runtimeConfig: deployRuntimeConfigSnapshot(entry.runtimeConfig)
  }
}

export function deployDashboardURL(
  entry: Pick<DeployHistoryEntry, 'provider' | 'deployId' | 'site'>
): string | null {
  if (entry.provider === 'netlify') {
    return `https://app.netlify.com/deploys/${encodeURIComponent(entry.deployId)}`
  }
  if (entry.provider === 'vercel') {
    return `https://vercel.com/deployments/${encodeURIComponent(entry.deployId)}`
  }
  if (entry.provider === 'cloudflare') {
    const target = parseCloudflarePagesTarget(entry.site)
    if (target.accountId && target.projectName) {
      return `https://dash.cloudflare.com/${encodeURIComponent(target.accountId)}/pages/view/${encodeURIComponent(target.projectName)}/${encodeURIComponent(entry.deployId)}`
    }
  }
  return null
}

export function parseCloudflarePagesTarget(site?: string): CloudflarePagesTargetMetadata {
  const raw = site?.trim()
  if (!raw) {
    return {
      missingFields: ['site'],
      reason: 'Cloudflare rollback needs a site target in account/project format.'
    }
  }
  const parts = raw.split('/')
  if (parts.length !== 2) {
    return {
      missingFields: ['accountId', 'projectName'],
      reason: 'Cloudflare rollback needs a site target in account/project format.'
    }
  }
  const [accountId, projectName] = parts.map((part) => part.trim())
  const missingFields = [
    ...(accountId ? [] : ['accountId']),
    ...(projectName ? [] : ['projectName'])
  ]
  if (missingFields.length > 0) {
    return {
      accountId: accountId || undefined,
      projectName: projectName || undefined,
      missingFields,
      reason: 'Cloudflare rollback needs both account id and project name.'
    }
  }
  return { accountId, projectName, missingFields: [] }
}

export function parseVercelProjectTarget(site?: string): VercelProjectTargetMetadata {
  const projectName = site?.trim()
  if (!projectName) {
    return {
      missingFields: ['projectName'],
      reason: 'Vercel rollback needs the project name used for the deployment.'
    }
  }
  return { projectName, missingFields: [] }
}

export function deployRollbackContract(
  entry: Pick<DeployHistoryEntry, 'provider' | 'deployId' | 'site'>
): DeployRollbackContract {
  const dashboardURL = deployDashboardURL(entry)
  if (entry.provider === 'netlify') {
    const hasTarget = typeof entry.site === 'string' && entry.site.trim() !== ''
    return {
      provider: 'netlify',
      support: hasTarget ? 'api-candidate' : 'dashboard-only',
      label: 'Restore deploy',
      requiredFields: ['token', 'site', 'deployId'],
      missingFields: hasTarget ? [] : ['site'],
      reason: hasTarget ? undefined : 'Netlify restore needs a site id or site slug.',
      dashboardUrl: dashboardURL
    }
  }
  if (entry.provider === 'cloudflare') {
    const target = parseCloudflarePagesTarget(entry.site)
    const hasTarget = target.missingFields.length === 0
    return {
      provider: 'cloudflare',
      support: hasTarget ? 'api-candidate' : 'dashboard-only',
      label: 'Rollback Pages deployment',
      requiredFields: ['token', 'accountId', 'projectName', 'deployId'],
      missingFields: target.missingFields,
      reason: hasTarget ? undefined : target.reason,
      dashboardUrl: dashboardURL
    }
  }
  if (entry.provider === 'vercel') {
    const target = parseVercelProjectTarget(entry.site)
    const missingFields = [...target.missingFields, 'productionAlias', 'projectOwner']
    return {
      provider: 'vercel',
      support: 'dashboard-only',
      label: 'Promote deployment',
      requiredFields: ['token', 'deployId', 'projectName', 'productionAlias', 'projectOwner'],
      missingFields,
      reason: `Vercel rollback needs ${missingFields.join(', ')} metadata not stored locally yet.`,
      dashboardUrl: dashboardURL
    }
  }
  return {
    provider: entry.provider,
    support: 'unsupported',
    label: 'Provider rollback',
    requiredFields: [],
    missingFields: [],
    reason: 'No rollback contract is defined for this provider.',
    dashboardUrl: dashboardURL
  }
}

export function deployRollbackContractLabel(contract: DeployRollbackContract): string {
  if (contract.support === 'api-candidate') return `${contract.label} API candidate`
  if (contract.support === 'dashboard-only') {
    const missing =
      contract.missingFields.length > 0 ? ` · missing ${contract.missingFields.join(', ')}` : ''
    return `${contract.label}: dashboard only${missing}`
  }
  return 'Rollback unsupported'
}

export function deployRollbackContractTitle(contract: DeployRollbackContract): string {
  const missing =
    contract.missingFields.length > 0 ? ` Missing: ${contract.missingFields.join(', ')}.` : ''
  return `${contract.reason ?? deployRollbackContractLabel(contract)}${missing}`
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
  const deploy = text ? objectFields(JSON.parse(text)) : null
  const restoredId = typeof deploy?.id === 'string' ? deploy.id : deployId
  const url = restoreDeployURL(deploy)
  return { provider: 'netlify', deployId: restoredId, url }
}

function restoreDeployURL(deploy: UnknownFields | null): string | undefined {
  if (typeof deploy?.ssl_url === 'string') return deploy.ssl_url
  if (typeof deploy?.url === 'string') return deploy.url
  return undefined
}
