import type { McpServer } from '@agentclientprotocol/sdk'

import { MCP_AGENT_HEADER } from '@open-pencil/core/constants'

import { getMCPServerURL } from '@/app/automation/mcp/spawn'
import { describeDiagnosticError, recordMCPConnectionFailure } from '@/app/diagnostics'
import { appCredentialServices } from '@/app/settings/credentials/app'

import { BUILT_IN_EDITOR_MCP_SERVER_NAME, isReservedMCPServerName } from './names'
import { enabledMCPConnections } from './store'
import type { MCPConnection } from './types'
export type BuiltInMCPServerOptions = {
  authorizationToken: string | null
}

export function builtInMCPServer(options: BuiltInMCPServerOptions): McpServer {
  return {
    type: 'http',
    name: BUILT_IN_EDITOR_MCP_SERVER_NAME,
    url: getMCPServerURL(),
    headers: [
      { name: MCP_AGENT_HEADER, value: 'acp' },
      ...(options.authorizationToken
        ? [{ name: 'Authorization', value: `Bearer ${options.authorizationToken}` }]
        : [])
    ]
  }
}

async function externalMCPServer(connection: MCPConnection): Promise<McpServer> {
  const headers = []
  if (connection.authentication.type === 'bearer') {
    try {
      const token = await appCredentialServices.resolver.resolve(
        connection.authentication.credentialRef
      )
      if (!token) throw new Error('MCP connection needs a bearer token')
      headers.push({ name: 'Authorization', value: `Bearer ${token}` })
    } catch (error) {
      recordMCPConnectionFailure({ operation: 'connect', ...describeDiagnosticError(error) })
      throw error
    }
  }
  return {
    type: 'http',
    name: connection.name,
    url: connection.transport.url,
    headers
  }
}

export async function buildACPMCPServers(
  options: BuiltInMCPServerOptions,
  additionalServers: readonly McpServer[] = []
): Promise<McpServer[]> {
  if (additionalServers.some((server) => isReservedMCPServerName(server.name))) {
    throw new Error('The built-in editor MCP server name is reserved')
  }
  const external = await Promise.all(enabledMCPConnections.value.map(externalMCPServer))
  return [builtInMCPServer(options), ...external, ...additionalServers]
}
