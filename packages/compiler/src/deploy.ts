// Deploy a built static bundle to a hosting provider. Phase 3 §5: the
// "dist → live URL" hop after `buildPreviewProject` produces the static SPA.
// Provider-agnostic surface with a per-provider dispatch — Netlify (§5.2) and
// Vercel (§5.4); Cloudflare Pages is a follow-up.
//
// Browser-safe: only `fetch` + Web Crypto `crypto.subtle` — no vite / node
// built-ins — so the editor could call this directly in future (the first
// editor surface shells out to the CLI instead, keeping one deploy pipeline).

import { blake3 } from '@noble/hashes/blake3'

import type { JSONObject } from '@open-pencil/scene-graph/primitives'

export interface DeployTarget {
  provider: 'netlify' | 'vercel' | 'cloudflare'
  /** Personal access token. Never persisted (passed via --token / env). */
  token: string
  /**
   * Existing deploy target. Netlify: site id or `*.netlify.app` subdomain.
   * Vercel: project name. Cloudflare: project name, or `account/project`
   * when `accountId` is not passed. Omit to create a new Netlify site /
   * Vercel project automatically.
   */
  site?: string
  /** Cloudflare account id. CLI may also pass this via --account-id. */
  accountId?: string
}

export interface DeployResult {
  provider: string
  /** Public URL of the deploy. */
  url: string
  deployId: string
  /** Number of files in the deploy manifest. */
  fileCount: number
}

export interface DeployProgress {
  stage: 'digest' | 'create' | 'upload' | 'done'
  done?: number
  total?: number
}

export interface DeployOptions {
  onProgress?: (p: DeployProgress) => void
}

const NETLIFY_API = 'https://api.netlify.com/api/v1'
const VERCEL_API = 'https://api.vercel.com'
const CLOUDFLARE_API = 'https://api.cloudflare.com/client/v4'
// SPA fallback so client-side BrowserRouter routes resolve on hard refresh.
const SPA_REDIRECTS = '/* /index.html 200\n' // Netlify `_redirects`
const VERCEL_JSON = // Vercel `vercel.json` — equivalent SPA rewrite.
  JSON.stringify({ rewrites: [{ source: '/(.*)', destination: '/index.html' }] }, null, 2) + '\n'
const DEFAULT_VERCEL_NAME = 'open-pencil-app'

function tokenEnv(provider: DeployTarget['provider']): string {
  if (provider === 'vercel') return 'VERCEL_TOKEN'
  if (provider === 'cloudflare') return 'CLOUDFLARE_API_TOKEN'
  return 'NETLIFY_AUTH_TOKEN'
}

/** Lowercase hex SHA-1 of `bytes` (Web Crypto — works in Bun and browsers). */
async function sha1Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-1', bytes)
  const view = new Uint8Array(digest)
  let hex = ''
  for (const b of view) hex += b.toString(16).padStart(2, '0')
  return hex
}

function bytesToHex(bytes: Uint8Array): string {
  let hex = ''
  for (const b of bytes) hex += b.toString(16).padStart(2, '0')
  return hex
}

function bytesToBase64(bytes: Uint8Array): string {
  if (typeof Buffer !== 'undefined') return Buffer.from(bytes).toString('base64')
  let binary = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(binary)
}

function fileExtension(rel: string): string {
  const name = rel.split('/').pop() ?? rel
  const dot = name.lastIndexOf('.')
  return dot === -1 ? '' : name.slice(dot + 1)
}

/**
 * Cloudflare Pages hashes the base64 file contents plus the file extension,
 * then truncates the BLAKE3 digest to 128 bits. This mirrors Wrangler's direct
 * upload asset manifest.
 */
function cloudflareHash(rel: string, bytes: Uint8Array): string {
  return bytesToHex(blake3(bytesToBase64(bytes) + fileExtension(rel))).slice(0, 32)
}

/** `/index.html` → `/index.html`, `/a b/x.js` → `/a%20b/x.js` (leading slash kept). */
function encodeFilePath(path: string): string {
  return path
    .split('/')
    .map((seg) => encodeURIComponent(seg))
    .join('/')
}

/** Bearer POST/PUT to a provider API; throws a structured error on non-2xx. */
async function apiFetch(
  url: string,
  init: {
    method: 'POST' | 'PUT'
    token: string
    jsonBody?: unknown
    rawBody?: Uint8Array
    extraHeaders?: Record<string, string>
  }
): Promise<Record<string, unknown>> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${init.token}`,
    ...init.extraHeaders
  }
  let body: BodyInit | undefined
  if (init.rawBody !== undefined) {
    headers['Content-Type'] = 'application/octet-stream'
    body = init.rawBody
  } else if (init.jsonBody !== undefined) {
    headers['Content-Type'] = 'application/json'
    body = JSON.stringify(init.jsonBody)
  }

  const res = await fetch(url, { method: init.method, headers, body })
  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    const hint = res.status === 401 ? ' (check your token)' : ''
    throw new Error(
      `API ${init.method} ${url} failed: ${res.status}${hint}${detail ? ` — ${detail}` : ''}`
    )
  }
  // These endpoints return JSON; tolerate an empty body.
  const text = await res.text()
  if (!text) return {}
  return JSON.parse(text) as JSONObject
}

type ProgressFn = ((p: DeployProgress) => void) | undefined

/** A digested file: dist-relative path (no leading slash), bytes, and SHA-1. */
interface DigestedFile {
  rel: string
  bytes: Uint8Array
  sha: string
}

/**
 * Copy the file map (never mutate the caller's), inject the provider's SPA
 * fallback config when absent, then digest every file. The result is neutral
 * (no leading slash, no provider shape) so each provider maps it to its own
 * manifest form.
 */
async function digestPayload(
  files: Map<string, string | Uint8Array>,
  spaFile: { name: string; content: string },
  onProgress: ProgressFn
): Promise<DigestedFile[]> {
  const payload = new Map(files)
  if (!payload.has(spaFile.name)) payload.set(spaFile.name, spaFile.content)

  const total = payload.size
  onProgress?.({ stage: 'digest', done: 0, total })
  const entries: DigestedFile[] = []
  let digested = 0
  for (const [rel, content] of payload) {
    const bytes = typeof content === 'string' ? new TextEncoder().encode(content) : content
    entries.push({ rel: rel.replace(/^\/+/, ''), bytes, sha: await sha1Hex(bytes) })
    onProgress?.({ stage: 'digest', done: ++digested, total })
  }
  return entries
}

/** Prefer the HTTPS deploy URL, fall back to the plain URL. */
function pickURL(obj: Record<string, unknown>): string | undefined {
  const ssl = obj.ssl_url
  if (typeof ssl === 'string') return ssl
  const url = obj.url
  return typeof url === 'string' ? url : undefined
}

/**
 * Deploy a built static bundle. The `files` map is the dist contents
 * (`index.html` + hashed assets); paths are dist-relative without a leading
 * slash. Dispatches to the provider's upload flow, injecting that provider's
 * SPA fallback config when absent, and returns the public URL.
 *
 * `target.token` is required and never logged/persisted. The real network
 * round-trip is the deploy ACK (经验 K); the manifest/upload shaping is
 * deterministically unit-tested with a mocked `fetch`.
 */
export async function deployFiles(
  files: Map<string, string | Uint8Array>,
  target: DeployTarget,
  opts: DeployOptions = {}
): Promise<DeployResult> {
  if (!target.token) {
    throw new Error(
      `A ${target.provider} auth token is required (pass --token or set ${tokenEnv(target.provider)}).`
    )
  }
  if (target.provider === 'cloudflare') return deployCloudflare(files, target, opts)
  if (target.provider === 'vercel') return deployVercel(files, target, opts)
  return deployNetlify(files, target, opts)
}

// ── Netlify ─────────────────────────────────────────────────────────────────

/** Resolve the target site, creating a new one when `target.site` is absent. */
async function resolveNetlifySite(
  target: DeployTarget,
  onProgress: ProgressFn
): Promise<{ siteId: string; createdSite?: Record<string, unknown> }> {
  onProgress?.({ stage: 'create' })
  if (target.site) return { siteId: target.site }
  const createdSite = await apiFetch(`${NETLIFY_API}/sites`, {
    method: 'POST',
    token: target.token,
    jsonBody: {}
  })
  const id = createdSite.id
  if (typeof id !== 'string') throw new Error('Netlify site creation returned no id')
  return { siteId: id, createdSite }
}

/** Create a deploy with the digest manifest; returns the deploy + required set. */
async function createNetlifyDeploy(
  siteId: string,
  entries: DigestedFile[],
  token: string
): Promise<{ deploy: Record<string, unknown>; deployId: string; required: Set<string> }> {
  const manifest: Record<string, string> = {}
  for (const e of entries) manifest['/' + e.rel] = e.sha
  const deploy = await apiFetch(`${NETLIFY_API}/sites/${encodeURIComponent(siteId)}/deploys`, {
    method: 'POST',
    token,
    jsonBody: { files: manifest }
  })
  const deployId = deploy.id
  if (typeof deployId !== 'string') throw new Error('Netlify deploy creation returned no id')
  const required = new Set<string>(
    Array.isArray(deploy.required)
      ? deploy.required.filter((s): s is string => typeof s === 'string')
      : []
  )
  return { deploy, deployId, required }
}

/** PUT only the files whose digest Netlify reported as missing (serial). */
async function uploadNetlifyRequired(
  entries: DigestedFile[],
  required: Set<string>,
  deployId: string,
  token: string,
  onProgress: ProgressFn
): Promise<void> {
  const toUpload = entries.filter((e) => required.has(e.sha))
  onProgress?.({ stage: 'upload', done: 0, total: toUpload.length })
  let uploaded = 0
  for (const e of toUpload) {
    await apiFetch(
      `${NETLIFY_API}/deploys/${encodeURIComponent(deployId)}/files${encodeFilePath('/' + e.rel)}`,
      {
        method: 'PUT',
        token,
        rawBody: e.bytes
      }
    )
    onProgress?.({ stage: 'upload', done: ++uploaded, total: toUpload.length })
  }
}

async function deployNetlify(
  files: Map<string, string | Uint8Array>,
  target: DeployTarget,
  opts: DeployOptions
): Promise<DeployResult> {
  const { onProgress } = opts
  const entries = await digestPayload(
    files,
    { name: '_redirects', content: SPA_REDIRECTS },
    onProgress
  )
  const { siteId, createdSite } = await resolveNetlifySite(target, onProgress)
  const { deploy, deployId, required } = await createNetlifyDeploy(siteId, entries, target.token)
  await uploadNetlifyRequired(entries, required, deployId, target.token, onProgress)
  onProgress?.({ stage: 'done' })

  const url =
    pickURL(deploy) ??
    (createdSite ? pickURL(createdSite) : undefined) ??
    `https://app.netlify.com/deploys/${deployId}`
  return { provider: 'netlify', url, deployId, fileCount: entries.length }
}

// ── Vercel ──────────────────────────────────────────────────────────────────

/** Upload every file by digest (idempotent — Vercel skips bytes it already has). */
async function uploadVercelFiles(
  entries: DigestedFile[],
  token: string,
  onProgress: ProgressFn
): Promise<void> {
  onProgress?.({ stage: 'upload', done: 0, total: entries.length })
  let uploaded = 0
  for (const e of entries) {
    await apiFetch(`${VERCEL_API}/v2/files`, {
      method: 'POST',
      token,
      rawBody: e.bytes,
      extraHeaders: { 'x-vercel-digest': e.sha }
    })
    onProgress?.({ stage: 'upload', done: ++uploaded, total: entries.length })
  }
}

/** Create a production deployment referencing the uploaded files by digest. */
async function createVercelDeploy(
  entries: DigestedFile[],
  target: DeployTarget,
  onProgress: ProgressFn
): Promise<{ deployId: string; url: string }> {
  onProgress?.({ stage: 'create' })
  const deploy = await apiFetch(`${VERCEL_API}/v13/deployments`, {
    method: 'POST',
    token: target.token,
    jsonBody: {
      name: target.site ?? DEFAULT_VERCEL_NAME,
      files: entries.map((e) => ({ file: e.rel, sha: e.sha, size: e.bytes.length })),
      projectSettings: { framework: null },
      target: 'production'
    }
  })
  const deployId = deploy.id
  if (typeof deployId !== 'string') throw new Error('Vercel deploy creation returned no id')
  // Vercel returns the hostname without a scheme.
  const host = typeof deploy.url === 'string' ? deploy.url : `vercel.com/deploys/${deployId}`
  return { deployId, url: host.startsWith('http') ? host : `https://${host}` }
}

async function deployVercel(
  files: Map<string, string | Uint8Array>,
  target: DeployTarget,
  opts: DeployOptions
): Promise<DeployResult> {
  const { onProgress } = opts
  const entries = await digestPayload(
    files,
    { name: 'vercel.json', content: VERCEL_JSON },
    onProgress
  )
  await uploadVercelFiles(entries, target.token, onProgress)
  const { deployId, url } = await createVercelDeploy(entries, target, onProgress)
  onProgress?.({ stage: 'done' })
  return { provider: 'vercel', url, deployId, fileCount: entries.length }
}

// ── Cloudflare Pages ────────────────────────────────────────────────────────

interface CloudflareAsset extends DigestedFile {
  cfHash: string
  contentType: string
}

type CloudflareAPIResult = JSONObject | unknown[]

function isCloudflareAPIResult(value: unknown): value is CloudflareAPIResult {
  return Array.isArray(value) || (typeof value === 'object' && value !== null)
}

function resolveCloudflareTarget(target: DeployTarget): { accountId: string; projectName: string } {
  if (target.accountId && target.site) {
    return { accountId: target.accountId, projectName: target.site }
  }
  const site = target.site?.trim()
  const slash = site?.indexOf('/') ?? -1
  if (site && slash > 0 && slash < site.length - 1) {
    return {
      accountId: site.slice(0, slash),
      projectName: site.slice(slash + 1)
    }
  }
  throw new Error(
    'Cloudflare Pages requires an account id and project name ' +
      '(pass --account-id <id> --site <project>, or --site <account>/<project>).'
  )
}

function cloudflareContentType(rel: string): string {
  if (rel.endsWith('.html')) return 'text/html; charset=utf-8'
  if (rel.endsWith('.css')) return 'text/css; charset=utf-8'
  if (rel.endsWith('.js') || rel.endsWith('.mjs')) return 'text/javascript; charset=utf-8'
  if (rel.endsWith('.json')) return 'application/json; charset=utf-8'
  if (rel.endsWith('.svg')) return 'image/svg+xml'
  return 'application/octet-stream'
}

async function cloudflareFetch(
  path: string,
  init: {
    method?: 'GET' | 'POST'
    token: string
    jsonBody?: unknown
    formBody?: FormData
  }
): Promise<CloudflareAPIResult> {
  const headers: Record<string, string> = { Authorization: `Bearer ${init.token}` }
  let body: BodyInit | undefined
  if (init.jsonBody !== undefined) {
    headers['Content-Type'] = 'application/json'
    body = JSON.stringify(init.jsonBody)
  } else if (init.formBody !== undefined) {
    body = init.formBody
  }

  const res = await fetch(`${CLOUDFLARE_API}${path}`, {
    method: init.method ?? 'GET',
    headers,
    body
  })
  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    const hint = res.status === 401 ? ' (check your token)' : ''
    throw new Error(
      `Cloudflare API ${path} failed: ${res.status}${hint}${detail ? ` — ${detail}` : ''}`
    )
  }
  const parsed = (await res.json()) as JSONObject
  return 'result' in parsed && isCloudflareAPIResult(parsed.result) ? parsed.result : parsed
}

async function getCloudflareUploadToken(
  accountId: string,
  projectName: string,
  token: string
): Promise<string> {
  const result = await cloudflareFetch(
    `/accounts/${encodeURIComponent(accountId)}/pages/projects/${encodeURIComponent(projectName)}/upload-token`,
    { token }
  )
  if (Array.isArray(result) || typeof result.jwt !== 'string') {
    throw new TypeError('Cloudflare upload-token returned no jwt')
  }
  return result.jwt
}

async function uploadCloudflareAssets(
  assets: CloudflareAsset[],
  jwt: string,
  onProgress: ProgressFn
): Promise<void> {
  const missing = await cloudflareFetch('/pages/assets/check-missing', {
    method: 'POST',
    token: jwt,
    jsonBody: { hashes: assets.map((a) => a.cfHash) }
  })
  if (!Array.isArray(missing))
    throw new Error('Cloudflare check-missing returned an invalid result')
  const missingHashes = new Set(missing.filter((h): h is string => typeof h === 'string'))
  const toUpload = assets.filter((asset) => missingHashes.has(asset.cfHash))

  onProgress?.({ stage: 'upload', done: 0, total: toUpload.length })
  let uploaded = 0
  for (const asset of toUpload) {
    await cloudflareFetch('/pages/assets/upload', {
      method: 'POST',
      token: jwt,
      jsonBody: [
        {
          key: asset.cfHash,
          value: bytesToBase64(asset.bytes),
          metadata: { contentType: asset.contentType },
          base64: true
        }
      ]
    })
    onProgress?.({ stage: 'upload', done: ++uploaded, total: toUpload.length })
  }

  await cloudflareFetch('/pages/assets/upsert-hashes', {
    method: 'POST',
    token: jwt,
    jsonBody: { hashes: assets.map((a) => a.cfHash) }
  })
}

async function createCloudflareDeployment(
  assets: CloudflareAsset[],
  target: DeployTarget,
  resolved: { accountId: string; projectName: string },
  onProgress: ProgressFn
): Promise<{ deployId: string; url: string }> {
  onProgress?.({ stage: 'create' })
  const manifest: Record<string, string> = {}
  for (const asset of assets) manifest['/' + asset.rel] = asset.cfHash

  const form = new FormData()
  form.append('manifest', JSON.stringify(manifest))

  const deployment = await cloudflareFetch(
    `/accounts/${encodeURIComponent(resolved.accountId)}/pages/projects/${encodeURIComponent(
      resolved.projectName
    )}/deployments`,
    { method: 'POST', token: target.token, formBody: form }
  )
  if (Array.isArray(deployment)) throw new Error('Cloudflare deployment returned no result')
  const deployId = deployment.id
  if (typeof deployId !== 'string') throw new Error('Cloudflare deployment returned no id')
  const url =
    typeof deployment.url === 'string'
      ? deployment.url
      : `https://dash.cloudflare.com/${resolved.accountId}/pages/view/${resolved.projectName}/${deployId}`
  return { deployId, url }
}

async function deployCloudflare(
  files: Map<string, string | Uint8Array>,
  target: DeployTarget,
  opts: DeployOptions
): Promise<DeployResult> {
  const { onProgress } = opts
  const resolved = resolveCloudflareTarget(target)
  const entries = await digestPayload(
    files,
    { name: '_redirects', content: SPA_REDIRECTS },
    onProgress
  )
  const assets: CloudflareAsset[] = entries.map((entry) => ({
    ...entry,
    cfHash: cloudflareHash(entry.rel, entry.bytes),
    contentType: cloudflareContentType(entry.rel)
  }))

  const jwt = await getCloudflareUploadToken(resolved.accountId, resolved.projectName, target.token)
  await uploadCloudflareAssets(assets, jwt, onProgress)
  const { deployId, url } = await createCloudflareDeployment(assets, target, resolved, onProgress)
  onProgress?.({ stage: 'done' })
  return { provider: 'cloudflare', url, deployId, fileCount: assets.length }
}
