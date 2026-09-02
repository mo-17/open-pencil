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
  maxSchemaStringLength: 4_096,
  maxPackageDigestLength: 128,
  maxPluginVersionLength: 64
})

export type PluginMCPToolKind = 'module' | 'command' | 'exporter' | 'connector'

export interface PluginMCPToolAuthority {
  readonly trustSource: 'app-bundle' | 'publisher-signature'
  readonly packageDigest: string
  readonly pluginVersion: string
  readonly publisherId: string
  readonly publisherKeyId: string
  readonly adapterId: string
}

export interface PluginMCPToolDescriptor {
  readonly name: string
  readonly title?: string
  readonly description: string
  readonly inputSchema: Readonly<Record<string, unknown>>
  readonly outputSchema?: Readonly<Record<string, unknown>>
  readonly pluginId: string
  readonly kind: PluginMCPToolKind
  readonly contributionId: string
  readonly authority: PluginMCPToolAuthority
}

/**
 * The immutable portion of a catalog descriptor that a tools/call request is
 * authorized to invoke. The catalog revision binds the remaining advertised
 * metadata and schemas; these fields bind the live executable identity.
 */
export interface PluginMCPToolCallDescriptor {
  readonly name: string
  readonly title?: string
  readonly pluginId: string
  readonly kind: PluginMCPToolKind
  readonly contributionId: string
  readonly authority: PluginMCPToolAuthority
}

/** Cross-process plugin tools/call request sent from the MCP server to the app. */
export interface PluginMCPToolCallRequest<TArgs = unknown> {
  readonly name: string
  readonly pluginId: string
  readonly expectedCatalogRevision: string
  readonly expectedDescriptor: PluginMCPToolCallDescriptor
  readonly args: TArgs
}

export interface PluginMCPCatalogSnapshot {
  readonly revision: string
  readonly tools: readonly PluginMCPToolDescriptor[]
}
