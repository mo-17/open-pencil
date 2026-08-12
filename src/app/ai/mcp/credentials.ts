import { ref } from 'vue'

import {
  remoteMCPServer,
  remoteMCPSettings,
  removeRemoteMCPServerConfig,
  updateRemoteMCPServerConfig
} from '@/app/ai/mcp/store'
import type { RemoteMCPServer, RemoteMCPServerId, RemoteMCPServerInput } from '@/app/ai/mcp/types'
import { normalizeRemoteMCPServerInput } from '@/app/ai/mcp/types'
import { appCredentialServices } from '@/app/settings/credentials/app'
import { credentialRef } from '@/app/settings/credentials/reference'
import type { CredentialRef, CredentialStatus } from '@/app/settings/credentials/types'

const REMOTE_MCP_CREDENTIAL_INTEGRATION = 'remote-mcp'
const REMOTE_MCP_BEARER_FIELD = 'bearer-token'

export type RemoteMCPCredentialStatus = CredentialStatus | 'not-required'

export const remoteMCPCredentialRevision = ref(0)

export function remoteMCPBearerCredentialRef(server: RemoteMCPServer): CredentialRef {
  if (server.auth.type !== 'bearer') {
    throw new Error(`Remote MCP server "${server.name}" does not use bearer authentication`)
  }
  return credentialRef(
    REMOTE_MCP_CREDENTIAL_INTEGRATION,
    REMOTE_MCP_BEARER_FIELD,
    server.auth.credentialProfileId
  )
}

export function remoteMCPCredentialRefs(): CredentialRef[] {
  return remoteMCPSettings.value.servers
    .filter(
      (
        server
      ): server is RemoteMCPServer & { auth: { type: 'bearer'; credentialProfileId: string } } =>
        server.auth.type === 'bearer'
    )
    .map(remoteMCPBearerCredentialRef)
}

function requireBearerServer(id: RemoteMCPServerId): RemoteMCPServer {
  const server = remoteMCPServer(id)
  if (!server) throw new Error(`Unknown remote MCP server: ${id}`)
  if (server.auth.type !== 'bearer') {
    throw new Error(`Remote MCP server "${server.name}" does not use bearer authentication`)
  }
  return server
}

export async function remoteMCPBearerCredentialStatus(
  id: RemoteMCPServerId
): Promise<CredentialStatus> {
  const server = requireBearerServer(id)
  return appCredentialServices.manager.status(remoteMCPBearerCredentialRef(server))
}

export async function remoteMCPCredentialStatus(
  id: RemoteMCPServerId
): Promise<RemoteMCPCredentialStatus> {
  const server = remoteMCPServer(id)
  if (!server) throw new Error(`Unknown remote MCP server: ${id}`)
  if (server.auth.type === 'none') return 'not-required'
  return appCredentialServices.manager.status(remoteMCPBearerCredentialRef(server))
}

export async function clearRemoteMCPBearerToken(id: RemoteMCPServerId): Promise<void> {
  const server = requireBearerServer(id)
  await appCredentialServices.manager.clear(remoteMCPBearerCredentialRef(server))
  remoteMCPCredentialRevision.value += 1
}

export async function setRemoteMCPBearerToken(id: RemoteMCPServerId, value: string): Promise<void> {
  const server = requireBearerServer(id)
  const token = value.trim()
  if (!token) {
    await clearRemoteMCPBearerToken(id)
    return
  }
  await appCredentialServices.manager.set(remoteMCPBearerCredentialRef(server), token)
  remoteMCPCredentialRevision.value += 1
}

export async function resolveRemoteMCPBearerToken(server: RemoteMCPServer): Promise<string | null> {
  if (server.auth.type !== 'bearer') return null
  return appCredentialServices.resolver.resolve(remoteMCPBearerCredentialRef(server))
}

export async function removeRemoteMCPServer(id: RemoteMCPServerId): Promise<boolean> {
  const server = remoteMCPServer(id)
  if (!server) return false
  if (server.auth.type === 'bearer') {
    await appCredentialServices.manager.clear(remoteMCPBearerCredentialRef(server))
  }
  removeRemoteMCPServerConfig(id)
  remoteMCPCredentialRevision.value += 1
  return true
}

export async function updateRemoteMCPServer(
  id: RemoteMCPServerId,
  input: RemoteMCPServerInput
): Promise<RemoteMCPServer> {
  const existing = remoteMCPServer(id)
  if (!existing) throw new Error(`Unknown remote MCP server: ${id}`)
  // Validate every user-controlled field before mutating either the credential store or settings.
  const normalizedInput = normalizeRemoteMCPServerInput(input)
  const originChanged =
    new URL(existing.transport.url).origin !== new URL(normalizedInput.url).origin
  if (existing.auth.type === 'bearer' && (normalizedInput.authType !== 'bearer' || originChanged)) {
    await appCredentialServices.manager.clear(remoteMCPBearerCredentialRef(existing))
    remoteMCPCredentialRevision.value += 1
  }
  return updateRemoteMCPServerConfig(id, normalizedInput)
}
