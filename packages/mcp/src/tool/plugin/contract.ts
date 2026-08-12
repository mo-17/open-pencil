export const PLUGIN_MCP_CATALOG_LIMITS = Object.freeze({
  maxTools: 256,
  maxCatalogBytes: 512 * 1024,
  maxSchemaBytes: 32 * 1024,
  maxSchemaDepth: 12,
  maxSchemaNodes: 512,
  maxNameLength: 128,
  maxIdentityLength: 128,
  maxTitleLength: 160,
  maxDescriptionLength: 2_000,
  maxRevisionLength: 256,
  maxSchemaStringLength: 4_096
})

export type PluginMCPToolKind = 'module' | 'command' | 'exporter' | 'connector'

export interface PluginMCPToolDescriptor {
  readonly name: string
  readonly title?: string
  readonly description: string
  readonly inputSchema: Readonly<Record<string, unknown>>
  readonly pluginId: string
  readonly kind: PluginMCPToolKind
  readonly contributionId: string
}

export interface PluginMCPCatalogSnapshot {
  readonly revision: string
  readonly tools: readonly PluginMCPToolDescriptor[]
}
