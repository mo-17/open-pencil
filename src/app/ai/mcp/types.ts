export const REMOTE_MCP_SETTINGS_VERSION = 1 as const
export const MAX_REMOTE_MCP_SERVERS = 16
export const MAX_REMOTE_MCP_SERVERS_PER_MODEL = 8
export const MAX_REMOTE_MCP_SERVER_NAME_LENGTH = 64
export const MAX_REMOTE_MCP_URL_LENGTH = 2_048

const REMOTE_MCP_SERVER_ID_PATTERN = /^mcp-[a-f0-9]{16}$/
const CREDENTIAL_PROFILE_ID_PATTERN = /^[a-z0-9._-]{1,64}$/

export type RemoteMCPServerId = `mcp-${string}`

export type RemoteMCPServer = {
  id: RemoteMCPServerId
  name: string
  transport: {
    type: 'streamable-http'
    url: string
  }
  auth:
    | { type: 'none' }
    | {
        type: 'bearer'
        credentialProfileId: string
      }
}

export type RemoteMCPSettings = {
  version: typeof REMOTE_MCP_SETTINGS_VERSION
  servers: RemoteMCPServer[]
}

export type RemoteMCPServerInput = {
  name: string
  url: string
  authType: RemoteMCPServer['auth']['type']
}

export function normalizeRemoteMCPServerInput(input: {
  name: unknown
  url: unknown
  authType: unknown
}): RemoteMCPServerInput {
  if (input.authType !== 'none' && input.authType !== 'bearer') {
    throw new Error('Remote MCP authentication type is invalid')
  }
  return {
    name: normalizeRemoteMCPServerName(typeof input.name === 'string' ? input.name : ''),
    url: normalizeRemoteMCPURL(typeof input.url === 'string' ? input.url : ''),
    authType: input.authType
  }
}

export function isRemoteMCPServerId(value: unknown): value is RemoteMCPServerId {
  return typeof value === 'string' && REMOTE_MCP_SERVER_ID_PATTERN.test(value)
}

export function createRemoteMCPServerId(): RemoteMCPServerId {
  const bytes = crypto.getRandomValues(new Uint8Array(8))
  const suffix = [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('')
  return `mcp-${suffix}`
}

export function normalizeRemoteMCPServerName(value: string): string {
  const name = value.trim()
  if (!name || name.length > MAX_REMOTE_MCP_SERVER_NAME_LENGTH) {
    throw new Error(
      `Remote MCP server name must be between 1 and ${MAX_REMOTE_MCP_SERVER_NAME_LENGTH} characters`
    )
  }
  return name
}

function isLoopbackIPv4(hostname: string): boolean {
  const octets = hostname.split('.')
  if (octets.length !== 4 || octets[0] !== '127') return false
  return octets.every((octet) => {
    if (!/^\d{1,3}$/.test(octet)) return false
    const value = Number(octet)
    return value >= 0 && value <= 255
  })
}

function isLoopbackHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, '')
  return (
    normalized === 'localhost' ||
    normalized.endsWith('.localhost') ||
    normalized === '::1' ||
    isLoopbackIPv4(normalized)
  )
}

export function normalizeRemoteMCPURL(value: string): string {
  const input = value.trim()
  if (!input || input.length > MAX_REMOTE_MCP_URL_LENGTH) {
    throw new Error(`Remote MCP URL must be between 1 and ${MAX_REMOTE_MCP_URL_LENGTH} characters`)
  }

  let url: URL
  try {
    url = new URL(input)
  } catch {
    throw new Error('Remote MCP URL is invalid')
  }

  if (url.username || url.password) {
    throw new Error('Remote MCP URL must not contain embedded credentials')
  }
  if (url.hash) throw new Error('Remote MCP URL must not contain a fragment')
  if (
    url.protocol !== 'https:' &&
    !(url.protocol === 'http:' && isLoopbackHostname(url.hostname))
  ) {
    throw new Error('Remote MCP URL must use HTTPS; HTTP is allowed only for loopback hosts')
  }
  return url.toString()
}

export function validateRemoteMCPCredentialProfileId(value: string): string {
  if (!CREDENTIAL_PROFILE_ID_PATTERN.test(value)) {
    throw new Error('Remote MCP credential profile ID is invalid')
  }
  return value
}

export function cloneRemoteMCPServer(server: RemoteMCPServer): RemoteMCPServer {
  return {
    ...server,
    transport: { ...server.transport },
    auth: { ...server.auth }
  }
}
