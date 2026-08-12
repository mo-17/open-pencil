import type { McpServer } from '@agentclientprotocol/sdk'

import { resolveRemoteMCPBearerToken } from '@/app/ai/mcp/credentials'
import { selectRemoteMCPServers } from '@/app/ai/mcp/runtime'
import { remoteMCPSettings } from '@/app/ai/mcp/store'

/** Resolve a model's selected servers into the ACP session/new envelope. */
export async function buildRemoteMCPACPServerConfigs(
  serverIds: readonly string[]
): Promise<McpServer[]> {
  const servers = selectRemoteMCPServers(serverIds, remoteMCPSettings.value.servers)
  return Promise.all(
    servers.map(async (server): Promise<McpServer> => {
      const bearerToken = await resolveRemoteMCPBearerToken(server)
      if (server.auth.type === 'bearer' && !bearerToken) {
        throw new Error(`Bearer credential is unavailable for remote MCP server "${server.name}"`)
      }
      return {
        type: 'http',
        // Keep the protocol identifier stable and free of user-controlled text.
        name: `remote-${server.id}`,
        url: server.transport.url,
        headers: bearerToken ? [{ name: 'Authorization', value: `Bearer ${bearerToken}` }] : []
      }
    })
  )
}
