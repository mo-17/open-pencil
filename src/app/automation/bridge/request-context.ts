import type { ToolCtx } from '@open-pencil/core/tools'
import type { PluginMCPToolCallDescriptor } from '@open-pencil/mcp/plugin-contract'

export type AutomationRequestContext = Pick<ToolCtx, 'signal' | 'onProgress'> &
  Readonly<{
    onPluginMCPResolved?: (
      descriptor: PluginMCPToolCallDescriptor,
      publisherGrantId: string | null
    ) => void
  }>
