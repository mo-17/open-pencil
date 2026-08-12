import { ref, watch } from 'vue'

import { readRemoteMCPSettingsStorage, writeRemoteMCPSettingsStorage } from '@/app/ai/mcp/storage'
import {
  cloneRemoteMCPServer,
  createRemoteMCPServerId,
  isRemoteMCPServerId,
  MAX_REMOTE_MCP_SERVERS,
  normalizeRemoteMCPServerInput,
  normalizeRemoteMCPServerName,
  normalizeRemoteMCPURL,
  REMOTE_MCP_SETTINGS_VERSION,
  validateRemoteMCPCredentialProfileId,
  type RemoteMCPServer,
  type RemoteMCPServerId,
  type RemoteMCPServerInput,
  type RemoteMCPSettings
} from '@/app/ai/mcp/types'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parseRemoteMCPServer(value: unknown): RemoteMCPServer | null {
  if (!isRecord(value) || !isRemoteMCPServerId(value.id)) return null
  if (!isRecord(value.transport) || value.transport.type !== 'streamable-http') return null
  if (!isRecord(value.auth) || (value.auth.type !== 'none' && value.auth.type !== 'bearer')) {
    return null
  }

  try {
    const server: RemoteMCPServer = {
      id: value.id,
      name: normalizeRemoteMCPServerName(typeof value.name === 'string' ? value.name : ''),
      transport: {
        type: 'streamable-http',
        url: normalizeRemoteMCPURL(
          typeof value.transport.url === 'string' ? value.transport.url : ''
        )
      },
      auth: { type: 'none' }
    }
    if (value.auth.type === 'bearer') {
      const credentialProfileId = validateRemoteMCPCredentialProfileId(
        typeof value.auth.credentialProfileId === 'string' ? value.auth.credentialProfileId : ''
      )
      if (credentialProfileId !== value.id) return null
      server.auth = { type: 'bearer', credentialProfileId }
    }
    return server
  } catch {
    return null
  }
}

export function parseRemoteMCPSettings(value: unknown): RemoteMCPSettings | null {
  if (!isRecord(value) || value.version !== REMOTE_MCP_SETTINGS_VERSION) return null
  const parsed = Array.isArray(value.servers)
    ? value.servers.map(parseRemoteMCPServer).filter((server) => server !== null)
    : []
  const unique = new Map<RemoteMCPServerId, RemoteMCPServer>()
  for (const server of parsed) {
    if (unique.size >= MAX_REMOTE_MCP_SERVERS) break
    if (!unique.has(server.id)) unique.set(server.id, server)
  }
  return { version: REMOTE_MCP_SETTINGS_VERSION, servers: [...unique.values()] }
}

function defaultRemoteMCPSettings(): RemoteMCPSettings {
  return { version: REMOTE_MCP_SETTINGS_VERSION, servers: [] }
}

function loadRemoteMCPSettings(): RemoteMCPSettings {
  return parseRemoteMCPSettings(readRemoteMCPSettingsStorage()) ?? defaultRemoteMCPSettings()
}

export const remoteMCPSettings = ref<RemoteMCPSettings>(loadRemoteMCPSettings())

watch(remoteMCPSettings, (settings) => writeRemoteMCPSettingsStorage(settings), { deep: true })

function nextRemoteMCPServerId(): RemoteMCPServerId {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const id = createRemoteMCPServerId()
    if (!remoteMCPSettings.value.servers.some((server) => server.id === id)) return id
  }
  throw new Error('Could not generate a unique remote MCP server ID')
}

function serverFromInput(id: RemoteMCPServerId, input: RemoteMCPServerInput): RemoteMCPServer {
  const normalized = normalizeRemoteMCPServerInput(input)
  return {
    id,
    name: normalized.name,
    transport: { type: 'streamable-http', url: normalized.url },
    auth:
      normalized.authType === 'bearer'
        ? { type: 'bearer', credentialProfileId: id }
        : { type: 'none' }
  }
}

export function addRemoteMCPServer(input: RemoteMCPServerInput): RemoteMCPServer {
  if (remoteMCPSettings.value.servers.length >= MAX_REMOTE_MCP_SERVERS) {
    throw new Error(`At most ${MAX_REMOTE_MCP_SERVERS} remote MCP servers can be configured`)
  }
  const server = serverFromInput(nextRemoteMCPServerId(), input)
  remoteMCPSettings.value.servers.push(server)
  return cloneRemoteMCPServer(server)
}

export function updateRemoteMCPServerConfig(
  id: RemoteMCPServerId,
  input: RemoteMCPServerInput
): RemoteMCPServer {
  const index = remoteMCPSettings.value.servers.findIndex((server) => server.id === id)
  if (index === -1) throw new Error(`Unknown remote MCP server: ${id}`)
  const existing = remoteMCPSettings.value.servers[index]
  const updated = serverFromInput(id, input)
  if (updated.auth.type === 'bearer' && existing.auth.type === 'bearer') {
    updated.auth.credentialProfileId = existing.auth.credentialProfileId
  }
  remoteMCPSettings.value.servers[index] = updated
  return cloneRemoteMCPServer(updated)
}

export function removeRemoteMCPServerConfig(id: RemoteMCPServerId): RemoteMCPServer | null {
  const index = remoteMCPSettings.value.servers.findIndex((server) => server.id === id)
  if (index === -1) return null
  const [removed] = remoteMCPSettings.value.servers.splice(index, 1)
  return cloneRemoteMCPServer(removed)
}

export function remoteMCPServer(id: string): RemoteMCPServer | null {
  const server = remoteMCPSettings.value.servers.find((candidate) => candidate.id === id)
  return server ? cloneRemoteMCPServer(server) : null
}

export type RemoteMCPServerDisplayInfo = {
  id: RemoteMCPServerId
  name: string
  origin: string
}

export function remoteMCPServerDisplayInfo(id: string): RemoteMCPServerDisplayInfo | null {
  const server = remoteMCPServer(id)
  if (!server) return null
  return {
    id: server.id,
    name: server.name,
    origin: new URL(server.transport.url).origin
  }
}

export function remoteMCPToolServerDisplayInfo(
  namespacedToolName: string
): RemoteMCPServerDisplayInfo | null {
  const match = /^mcp__(mcp-[a-f0-9]{16})__/.exec(namespacedToolName)
  return match ? remoteMCPServerDisplayInfo(match[1]) : null
}

export function remoteMCPSettingsSnapshot(): RemoteMCPSettings {
  return {
    version: REMOTE_MCP_SETTINGS_VERSION,
    servers: remoteMCPSettings.value.servers.map(cloneRemoteMCPServer)
  }
}

export function replaceRemoteMCPSettings(value: RemoteMCPSettings): void {
  const parsed = parseRemoteMCPSettings(value)
  if (!parsed) throw new Error('Remote MCP settings are invalid')
  remoteMCPSettings.value = parsed
}
