// Keep the embedded editor distinct from an agent's globally configured OpenPencil MCP.
export const BUILT_IN_EDITOR_MCP_SERVER_NAME = 'open-pencil-editor'

export function isReservedMCPServerName(name: string): boolean {
  const normalized = name.trim().toLowerCase()
  return normalized === 'open-pencil' || normalized === BUILT_IN_EDITOR_MCP_SERVER_NAME
}
