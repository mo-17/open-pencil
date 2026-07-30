import { ref, watch } from 'vue'

import { readRemoteMcpSettingsStorage, writeRemoteMcpSettingsStorage } from '@/app/ai/mcp/storage'
import {
  cloneRemoteMcpServer,
  createRemoteMcpServerId,
  isRemoteMcpServerId,
  MAX_REMOTE_MCP_SERVERS,
  normalizeRemoteMcpServerInput,
  normalizeRemoteMcpServerName,
  normalizeRemoteMcpUrl,
  REMOTE_MCP_SETTINGS_VERSION,
  validateRemoteMcpCredentialProfileId,
  type RemoteMcpServer,
  type RemoteMcpServerId,
  type RemoteMcpServerInput,
  type RemoteMcpSettings
} from '@/app/ai/mcp/types'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parseRemoteMcpServer(value: unknown): RemoteMcpServer | null {
  if (!isRecord(value) || !isRemoteMcpServerId(value.id)) return null
  if (!isRecord(value.transport) || value.transport.type !== 'streamable-http') return null
  if (!isRecord(value.auth) || (value.auth.type !== 'none' && value.auth.type !== 'bearer')) {
    return null
  }

  try {
    const server: RemoteMcpServer = {
      id: value.id,
      name: normalizeRemoteMcpServerName(typeof value.name === 'string' ? value.name : ''),
      transport: {
        type: 'streamable-http',
        url: normalizeRemoteMcpUrl(
          typeof value.transport.url === 'string' ? value.transport.url : ''
        )
      },
      auth: { type: 'none' }
    }
    if (value.auth.type === 'bearer') {
      const credentialProfileId = validateRemoteMcpCredentialProfileId(
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

export function parseRemoteMcpSettings(value: unknown): RemoteMcpSettings | null {
  if (!isRecord(value) || value.version !== REMOTE_MCP_SETTINGS_VERSION) return null
  const parsed = Array.isArray(value.servers)
    ? value.servers.map(parseRemoteMcpServer).filter((server) => server !== null)
    : []
  const unique = new Map<RemoteMcpServerId, RemoteMcpServer>()
  for (const server of parsed) {
    if (unique.size >= MAX_REMOTE_MCP_SERVERS) break
    if (!unique.has(server.id)) unique.set(server.id, server)
  }
  return { version: REMOTE_MCP_SETTINGS_VERSION, servers: [...unique.values()] }
}

function defaultRemoteMcpSettings(): RemoteMcpSettings {
  return { version: REMOTE_MCP_SETTINGS_VERSION, servers: [] }
}

function loadRemoteMcpSettings(): RemoteMcpSettings {
  return parseRemoteMcpSettings(readRemoteMcpSettingsStorage()) ?? defaultRemoteMcpSettings()
}

export const remoteMcpSettings = ref<RemoteMcpSettings>(loadRemoteMcpSettings())

watch(remoteMcpSettings, (settings) => writeRemoteMcpSettingsStorage(settings), { deep: true })

function nextRemoteMcpServerId(): RemoteMcpServerId {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const id = createRemoteMcpServerId()
    if (!remoteMcpSettings.value.servers.some((server) => server.id === id)) return id
  }
  throw new Error('Could not generate a unique remote MCP server ID')
}

function serverFromInput(id: RemoteMcpServerId, input: RemoteMcpServerInput): RemoteMcpServer {
  const normalized = normalizeRemoteMcpServerInput(input)
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

export function addRemoteMcpServer(input: RemoteMcpServerInput): RemoteMcpServer {
  if (remoteMcpSettings.value.servers.length >= MAX_REMOTE_MCP_SERVERS) {
    throw new Error(`At most ${MAX_REMOTE_MCP_SERVERS} remote MCP servers can be configured`)
  }
  const server = serverFromInput(nextRemoteMcpServerId(), input)
  remoteMcpSettings.value.servers.push(server)
  return cloneRemoteMcpServer(server)
}

export function updateRemoteMcpServerConfig(
  id: RemoteMcpServerId,
  input: RemoteMcpServerInput
): RemoteMcpServer {
  const index = remoteMcpSettings.value.servers.findIndex((server) => server.id === id)
  if (index === -1) throw new Error(`Unknown remote MCP server: ${id}`)
  const existing = remoteMcpSettings.value.servers[index]
  const updated = serverFromInput(id, input)
  if (updated.auth.type === 'bearer' && existing.auth.type === 'bearer') {
    updated.auth.credentialProfileId = existing.auth.credentialProfileId
  }
  remoteMcpSettings.value.servers[index] = updated
  return cloneRemoteMcpServer(updated)
}

export function removeRemoteMcpServerConfig(id: RemoteMcpServerId): RemoteMcpServer | null {
  const index = remoteMcpSettings.value.servers.findIndex((server) => server.id === id)
  if (index === -1) return null
  const [removed] = remoteMcpSettings.value.servers.splice(index, 1)
  return cloneRemoteMcpServer(removed)
}

export function remoteMcpServer(id: string): RemoteMcpServer | null {
  const server = remoteMcpSettings.value.servers.find((candidate) => candidate.id === id)
  return server ? cloneRemoteMcpServer(server) : null
}

export type RemoteMcpServerDisplayInfo = {
  id: RemoteMcpServerId
  name: string
  origin: string
}

export function remoteMcpServerDisplayInfo(id: string): RemoteMcpServerDisplayInfo | null {
  const server = remoteMcpServer(id)
  if (!server) return null
  return {
    id: server.id,
    name: server.name,
    origin: new URL(server.transport.url).origin
  }
}

export function remoteMcpToolServerDisplayInfo(
  namespacedToolName: string
): RemoteMcpServerDisplayInfo | null {
  const match = /^mcp__(mcp-[a-f0-9]{16})__/.exec(namespacedToolName)
  return match ? remoteMcpServerDisplayInfo(match[1]) : null
}

export function remoteMcpSettingsSnapshot(): RemoteMcpSettings {
  return {
    version: REMOTE_MCP_SETTINGS_VERSION,
    servers: remoteMcpSettings.value.servers.map(cloneRemoteMcpServer)
  }
}

export function replaceRemoteMcpSettings(value: RemoteMcpSettings): void {
  const parsed = parseRemoteMcpSettings(value)
  if (!parsed) throw new Error('Remote MCP settings are invalid')
  remoteMcpSettings.value = parsed
}
