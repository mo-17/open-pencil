import { ref } from 'vue'

import {
  remoteMcpServer,
  remoteMcpSettings,
  removeRemoteMcpServerConfig,
  updateRemoteMcpServerConfig
} from '@/app/ai/mcp/store'
import type { RemoteMcpServer, RemoteMcpServerId, RemoteMcpServerInput } from '@/app/ai/mcp/types'
import { normalizeRemoteMcpServerInput } from '@/app/ai/mcp/types'
import { appCredentialServices } from '@/app/settings/credentials/app'
import { credentialRef } from '@/app/settings/credentials/reference'
import type { CredentialRef, CredentialStatus } from '@/app/settings/credentials/types'

const REMOTE_MCP_CREDENTIAL_INTEGRATION = 'remote-mcp'
const REMOTE_MCP_BEARER_FIELD = 'bearer-token'

export type RemoteMcpCredentialStatus = CredentialStatus | 'not-required'

export const remoteMcpCredentialRevision = ref(0)

export function remoteMcpBearerCredentialRef(server: RemoteMcpServer): CredentialRef {
  if (server.auth.type !== 'bearer') {
    throw new Error(`Remote MCP server "${server.name}" does not use bearer authentication`)
  }
  return credentialRef(
    REMOTE_MCP_CREDENTIAL_INTEGRATION,
    REMOTE_MCP_BEARER_FIELD,
    server.auth.credentialProfileId
  )
}

export function remoteMcpCredentialRefs(): CredentialRef[] {
  return remoteMcpSettings.value.servers
    .filter(
      (
        server
      ): server is RemoteMcpServer & { auth: { type: 'bearer'; credentialProfileId: string } } =>
        server.auth.type === 'bearer'
    )
    .map(remoteMcpBearerCredentialRef)
}

function requireBearerServer(id: RemoteMcpServerId): RemoteMcpServer {
  const server = remoteMcpServer(id)
  if (!server) throw new Error(`Unknown remote MCP server: ${id}`)
  if (server.auth.type !== 'bearer') {
    throw new Error(`Remote MCP server "${server.name}" does not use bearer authentication`)
  }
  return server
}

export async function remoteMcpBearerCredentialStatus(
  id: RemoteMcpServerId
): Promise<CredentialStatus> {
  const server = requireBearerServer(id)
  return appCredentialServices.manager.status(remoteMcpBearerCredentialRef(server))
}

export async function remoteMcpCredentialStatus(
  id: RemoteMcpServerId
): Promise<RemoteMcpCredentialStatus> {
  const server = remoteMcpServer(id)
  if (!server) throw new Error(`Unknown remote MCP server: ${id}`)
  if (server.auth.type === 'none') return 'not-required'
  return appCredentialServices.manager.status(remoteMcpBearerCredentialRef(server))
}

export async function clearRemoteMcpBearerToken(id: RemoteMcpServerId): Promise<void> {
  const server = requireBearerServer(id)
  await appCredentialServices.manager.clear(remoteMcpBearerCredentialRef(server))
  remoteMcpCredentialRevision.value += 1
}

export async function setRemoteMcpBearerToken(id: RemoteMcpServerId, value: string): Promise<void> {
  const server = requireBearerServer(id)
  const token = value.trim()
  if (!token) {
    await clearRemoteMcpBearerToken(id)
    return
  }
  await appCredentialServices.manager.set(remoteMcpBearerCredentialRef(server), token)
  remoteMcpCredentialRevision.value += 1
}

export async function resolveRemoteMcpBearerToken(server: RemoteMcpServer): Promise<string | null> {
  if (server.auth.type !== 'bearer') return null
  return appCredentialServices.resolver.resolve(remoteMcpBearerCredentialRef(server))
}

export async function removeRemoteMcpServer(id: RemoteMcpServerId): Promise<boolean> {
  const server = remoteMcpServer(id)
  if (!server) return false
  if (server.auth.type === 'bearer') {
    await appCredentialServices.manager.clear(remoteMcpBearerCredentialRef(server))
  }
  removeRemoteMcpServerConfig(id)
  remoteMcpCredentialRevision.value += 1
  return true
}

export async function updateRemoteMcpServer(
  id: RemoteMcpServerId,
  input: RemoteMcpServerInput
): Promise<RemoteMcpServer> {
  const existing = remoteMcpServer(id)
  if (!existing) throw new Error(`Unknown remote MCP server: ${id}`)
  // Validate every user-controlled field before mutating either the credential store or settings.
  const normalizedInput = normalizeRemoteMcpServerInput(input)
  const originChanged =
    new URL(existing.transport.url).origin !== new URL(normalizedInput.url).origin
  if (existing.auth.type === 'bearer' && (normalizedInput.authType !== 'bearer' || originChanged)) {
    await appCredentialServices.manager.clear(remoteMcpBearerCredentialRef(existing))
    remoteMcpCredentialRevision.value += 1
  }
  return updateRemoteMcpServerConfig(id, normalizedInput)
}
