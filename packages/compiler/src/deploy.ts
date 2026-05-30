// Deploy a built static bundle to a hosting provider. Phase 3 §5 (second
// slice): the "dist → live URL" hop after `buildPreviewProject` produces the
// static SPA. Provider-agnostic surface, Netlify implementation first.
//
// Browser-safe: only `fetch` + Web Crypto `crypto.subtle` — no vite / node
// built-ins — so the editor could call this directly in future (the first
// editor surface shells out to the CLI instead, keeping one deploy pipeline).

export interface DeployTarget {
  provider: 'netlify'
  /** Personal access token. Never persisted (passed via --token / env). */
  token: string
  /** Existing site id (or its `*.netlify.app` subdomain). Omit to create a new site. */
  site?: string
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
// SPA fallback so client-side BrowserRouter routes resolve on hard refresh.
const SPA_REDIRECTS = '/* /index.html 200\n'

/** Lowercase hex SHA-1 of `bytes` (Web Crypto — works in Bun and browsers). */
async function sha1Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-1', bytes)
  const view = new Uint8Array(digest)
  let hex = ''
  for (const b of view) hex += b.toString(16).padStart(2, '0')
  return hex
}

/** `/index.html` → `/index.html`, `/a b/x.js` → `/a%20b/x.js` (leading slash kept). */
function encodeFilePath(path: string): string {
  return path
    .split('/')
    .map((seg) => encodeURIComponent(seg))
    .join('/')
}

/** POST/PUT to the Netlify API; throws a structured error on non-2xx. */
async function netlifyFetch(
  url: string,
  init: {
    method: 'POST' | 'PUT'
    token: string
    jsonBody?: unknown
    rawBody?: Uint8Array
  }
): Promise<Record<string, unknown>> {
  const headers: Record<string, string> = { Authorization: `Bearer ${init.token}` }
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
    const hint = res.status === 401 ? ' (check your Netlify token)' : ''
    throw new Error(`Netlify API ${init.method} ${url} failed: ${res.status}${hint}${detail ? ` — ${detail}` : ''}`)
  }
  // Netlify always returns JSON for these endpoints; tolerate an empty body.
  const text = await res.text()
  if (!text) return {}
  return JSON.parse(text) as Record<string, unknown>
}

type ProgressFn = ((p: DeployProgress) => void) | undefined

interface DigestedFiles {
  /** "/"-prefixed manifest path → SHA-1 hex. */
  shaByPath: Map<string, string>
  /** "/"-prefixed manifest path → raw bytes. */
  bytesByPath: Map<string, Uint8Array>
}

/** Digest every file, keying both the manifest sha and the raw bytes by path. */
async function digestFiles(
  payload: Map<string, string | Uint8Array>,
  onProgress: ProgressFn
): Promise<DigestedFiles> {
  const total = payload.size
  onProgress?.({ stage: 'digest', done: 0, total })
  const shaByPath = new Map<string, string>()
  const bytesByPath = new Map<string, Uint8Array>()
  let digested = 0
  for (const [rel, content] of payload) {
    const bytes = typeof content === 'string' ? new TextEncoder().encode(content) : content
    const path = '/' + rel.replace(/^\/+/, '')
    shaByPath.set(path, await sha1Hex(bytes))
    bytesByPath.set(path, bytes)
    onProgress?.({ stage: 'digest', done: ++digested, total })
  }
  return { shaByPath, bytesByPath }
}

/** Resolve the target site, creating a new one when `target.site` is absent. */
async function resolveSite(
  target: DeployTarget,
  onProgress: ProgressFn
): Promise<{ siteId: string; createdSite?: Record<string, unknown> }> {
  onProgress?.({ stage: 'create' })
  if (target.site) return { siteId: target.site }
  const createdSite = await netlifyFetch(`${NETLIFY_API}/sites`, {
    method: 'POST',
    token: target.token,
    jsonBody: {}
  })
  const id = createdSite.id
  if (typeof id !== 'string') throw new Error('Netlify site creation returned no id')
  return { siteId: id, createdSite }
}

/** Create a deploy with the digest manifest; returns the deploy + required set. */
async function createDeploy(
  siteId: string,
  shaByPath: Map<string, string>,
  token: string
): Promise<{ deploy: Record<string, unknown>; deployId: string; required: Set<string> }> {
  const manifest: Record<string, string> = {}
  for (const [path, sha] of shaByPath) manifest[path] = sha
  const deploy = await netlifyFetch(`${NETLIFY_API}/sites/${encodeURIComponent(siteId)}/deploys`, {
    method: 'POST',
    token,
    jsonBody: { files: manifest }
  })
  const deployId = deploy.id
  if (typeof deployId !== 'string') throw new Error('Netlify deploy creation returned no id')
  const required = new Set<string>(
    Array.isArray(deploy.required) ? deploy.required.filter((s): s is string => typeof s === 'string') : []
  )
  return { deploy, deployId, required }
}

/** PUT only the files whose digest Netlify reported as missing (serial). */
async function uploadRequired(
  digested: DigestedFiles,
  required: Set<string>,
  deployId: string,
  token: string,
  onProgress: ProgressFn
): Promise<void> {
  const toUpload = [...digested.shaByPath].filter(([, sha]) => required.has(sha))
  onProgress?.({ stage: 'upload', done: 0, total: toUpload.length })
  let uploaded = 0
  for (const [path] of toUpload) {
    const bytes = digested.bytesByPath.get(path)
    if (!bytes) continue
    await netlifyFetch(`${NETLIFY_API}/deploys/${encodeURIComponent(deployId)}/files${encodeFilePath(path)}`, {
      method: 'PUT',
      token,
      rawBody: bytes
    })
    onProgress?.({ stage: 'upload', done: ++uploaded, total: toUpload.length })
  }
}

/**
 * Deploy a built static bundle. The `files` map is the dist contents
 * (`index.html` + hashed assets); paths are dist-relative without a leading
 * slash. Injects a Netlify `_redirects` SPA fallback if absent, digests every
 * file, creates a deploy with the digest manifest, uploads only the files
 * Netlify reports as missing (`required`), and returns the public URL.
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
  // Only Netlify is implemented; `provider` stays in the type so a per-provider
  // dispatch returns here when CF Pages / Vercel land (deploy follow-up).
  const { onProgress } = opts
  if (!target.token) {
    throw new Error('A Netlify auth token is required (pass --token or set NETLIFY_AUTH_TOKEN).')
  }

  // Copy so we never mutate the caller's map; add the SPA fallback if missing.
  const payload = new Map(files)
  if (!payload.has('_redirects')) payload.set('_redirects', SPA_REDIRECTS)

  const digested = await digestFiles(payload, onProgress)
  const { siteId, createdSite } = await resolveSite(target, onProgress)
  const { deploy, deployId, required } = await createDeploy(siteId, digested.shaByPath, target.token)
  await uploadRequired(digested, required, deployId, target.token, onProgress)

  onProgress?.({ stage: 'done' })

  const url =
    pickUrl(deploy) ??
    (createdSite ? pickUrl(createdSite) : undefined) ??
    `https://app.netlify.com/deploys/${deployId}`
  return { provider: 'netlify', url, deployId, fileCount: digested.shaByPath.size }
}

/** Prefer the HTTPS deploy URL, fall back to the plain URL. */
function pickUrl(obj: Record<string, unknown>): string | undefined {
  const ssl = obj.ssl_url
  if (typeof ssl === 'string') return ssl
  const url = obj.url
  return typeof url === 'string' ? url : undefined
}
