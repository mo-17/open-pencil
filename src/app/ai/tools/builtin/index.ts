import { dynamicTool, jsonSchema } from 'ai'
import type { ToolExecutionOptions, ToolSet } from 'ai'

import type { JSONObject } from '@open-pencil/scene-graph/primitives'

import { makeFigmaFromStore } from '@/app/automation/bridge/figma-factory'
import { createAutomationPluginMCPHandlers } from '@/app/automation/bridge/plugin-mcp-handler'
import type { AutomationTarget } from '@/app/automation/bridge/target'
import { createAutomationToolHandler } from '@/app/automation/bridge/tool-handlers'
import type { EditorStore } from '@/app/editor/active-store'
import type {
  ThirdPartyPluginAIContributionGrant,
  ThirdPartyPluginAIContributionRequest,
  ThirdPartyPluginAIContributionReview
} from '@/app/plugins/ai-authorization'
import { appPluginAIAuthorization, appPluginStore, appPluginStoreReady } from '@/app/plugins/app'
import type {
  AppPluginMCPToolAuthority,
  AppPluginMCPToolCatalog,
  ResolvedAppPluginMCPTool
} from '@/app/plugins/mcp'
import type { AppPluginStoreSnapshot, InstalledAppPlugin } from '@/app/plugins/types'

import { boundedPluginAIString, BUILTIN_PLUGIN_AI_LIMITS, parsePluginAIPlainInput } from './input'
import { cloneBuiltinPluginJSON } from './json'
import {
  parseBuiltinPluginSearchInput,
  searchBuiltinPluginCapabilities,
  type BuiltinPluginAISearchInput,
  type BuiltinPluginAISearchMatch
} from './search'

export {
  searchBuiltinPluginCapabilities,
  searchBuiltinPluginCapabilities as searchPluginCapabilities,
  type BuiltinPluginAIAvailability,
  type BuiltinPluginAISearchMatch,
  type BuiltinPluginAISearchResult
} from './search'
export { BUILTIN_PLUGIN_AI_LIMITS, BUILTIN_PLUGIN_AI_LIMITS as PLUGIN_AI_LIMITS } from './input'

export const PLUGIN_AI_TOOL_NAMES = Object.freeze({
  search: 'search_plugins',
  use: 'use_plugin'
})

/** @deprecated Use PLUGIN_AI_TOOL_NAMES. */
export const BUILTIN_PLUGIN_AI_TOOL_NAMES = PLUGIN_AI_TOOL_NAMES

interface BuiltinPluginAIUseInput {
  pluginId: string
  toolName: string
  revision: string
  kind: BuiltinPluginAISearchMatch['kind']
  contributionId: string
  title: string
  trustSource: BuiltinPluginAISearchMatch['trustSource']
  packageDigest: string
  pluginVersion: string
  publisherId: string
  publisherKeyId: string
  adapterId: string
  grantId?: string
  args?: BuiltinPluginAIArguments
}

type BuiltinPluginAIArguments = JSONObject

export interface BuiltinPluginAIBridge {
  ready(): Promise<void>
  snapshot(): AppPluginStoreSnapshot
  listTools(): Promise<AppPluginMCPToolCatalog>
  callTool(
    store: EditorStore,
    request: { pluginId: string; name: string; args: BuiltinPluginAIArguments },
    signal?: AbortSignal,
    beforeDispatch?: (resolved: ResolvedAppPluginMCPTool) => void,
    executeModule?: (args: Record<string, unknown>) => Promise<unknown>
  ): Promise<unknown>
}

export interface CreateBuiltinPluginAIToolsOptions {
  bridge?: BuiltinPluginAIBridge
  executeModule?: (
    args: BuiltinPluginAIArguments,
    execution: ToolExecutionOptions<unknown>
  ) => Promise<unknown>
  beforeUse?: (
    input: BuiltinPluginAIUseInput,
    match: BuiltinPluginAISearchMatch
  ) => void | Promise<void>
  beforeDispatch?: (input: BuiltinPluginAIUseInput, resolved: ResolvedAppPluginMCPTool) => void
  authorization?: ThirdPartyPluginAIAuthorization
}

interface BuiltinPluginAIDiscoveryTicket {
  match: BuiltinPluginAISearchMatch
  revision: string
}

export interface ThirdPartyPluginAIAuthorization {
  snapshot(): readonly ThirdPartyPluginAIContributionGrant[]
  review(request: ThirdPartyPluginAIContributionRequest): ThirdPartyPluginAIContributionReview
  requireGrant(
    expectedReview: ThirdPartyPluginAIContributionReview,
    grantId: string
  ): ThirdPartyPluginAIContributionGrant
}

const USE_INPUT_KEYS = new Set([
  'pluginId',
  'toolName',
  'revision',
  'kind',
  'contributionId',
  'title',
  'trustSource',
  'packageDigest',
  'pluginVersion',
  'publisherId',
  'publisherKeyId',
  'adapterId',
  'grantId',
  'args'
])
const TOOL_KINDS = new Set<BuiltinPluginAISearchMatch['kind']>([
  'module',
  'command',
  'exporter',
  'connector'
])

function parseUseInput(value: unknown): BuiltinPluginAIUseInput {
  const input = parsePluginAIPlainInput(value, 'Plugin use input', USE_INPUT_KEYS)
  const kind = input.kind
  if (typeof kind !== 'string' || !TOOL_KINDS.has(kind as never)) {
    throw new TypeError('Plugin kind is not supported')
  }
  const trustSource = input.trustSource
  if (trustSource !== 'app-bundle' && trustSource !== 'publisher-signature') {
    throw new TypeError('Plugin trust source is not supported')
  }
  const grantId = input.grantId
  if (grantId !== undefined && typeof grantId !== 'string') {
    throw new TypeError('Plugin AI grant ID must be a string')
  }
  const args = cloneBuiltinPluginJSON(input.args ?? {})
  if (args === null || typeof args !== 'object' || Array.isArray(args)) {
    throw new TypeError('Built-in plugin arguments must be a plain object')
  }
  return {
    pluginId: boundedPluginAIString(input.pluginId, 'Plugin id', 128),
    toolName: boundedPluginAIString(input.toolName, 'Plugin tool name', 128),
    revision: boundedPluginAIString(input.revision, 'Plugin catalog revision', 256),
    kind: kind as BuiltinPluginAISearchMatch['kind'],
    contributionId: boundedPluginAIString(input.contributionId, 'Plugin contribution id', 256),
    title: boundedPluginAIString(input.title, 'Plugin capability title', 160),
    trustSource,
    packageDigest: boundedPluginAIString(input.packageDigest, 'Plugin package digest', 256),
    pluginVersion: boundedPluginAIString(input.pluginVersion, 'Plugin version', 64),
    publisherId: boundedPluginAIString(input.publisherId, 'Plugin publisher id', 128),
    publisherKeyId: boundedPluginAIString(input.publisherKeyId, 'Plugin publisher key id', 128),
    adapterId: boundedPluginAIString(input.adapterId, 'Plugin adapter id', 128),
    ...(grantId === undefined
      ? {}
      : { grantId: boundedPluginAIString(grantId, 'Plugin AI grant ID', 128) }),
    args: args as JSONObject
  }
}

function activeTarget(store: EditorStore): AutomationTarget {
  const pageId = store.state.currentPageId
  const page = store.graph.getNode(pageId)
  if (page?.type !== 'CANVAS') throw new Error('The active OpenPencil page is unavailable')
  return {
    store,
    documentId: 'active-ai-document',
    documentName: store.state.documentName,
    pageId,
    pageName: page.name
  }
}

function installedAuthority(
  plugin: InstalledAppPlugin,
  adapterId: string
): AppPluginMCPToolAuthority {
  return {
    trustSource: plugin.package.trustSource,
    packageDigest: plugin.package.digest,
    pluginVersion: plugin.package.manifest.plugin.version,
    publisherId: plugin.package.manifest.publisher.id,
    publisherKeyId:
      plugin.package.verifiedPackage?.verifiedKeyId ?? plugin.package.manifest.publisher.keyId,
    adapterId
  }
}

function sameAuthority(
  match: BuiltinPluginAISearchMatch,
  authority: AppPluginMCPToolAuthority
): boolean {
  return (
    match.trustSource === authority.trustSource &&
    match.packageDigest === authority.packageDigest &&
    match.pluginVersion === authority.pluginVersion &&
    match.publisherId === authority.publisherId &&
    match.publisherKeyId === authority.publisherKeyId &&
    match.adapterId === authority.adapterId
  )
}

function livePluginForTicket(
  snapshot: AppPluginStoreSnapshot,
  ticket: BuiltinPluginAIDiscoveryTicket
): InstalledAppPlugin {
  if (!snapshot.ready) {
    throw new Error('Plugin state is refreshing. Search again before using it.')
  }
  const plugin = snapshot.installed.find(
    (candidate) => candidate.package.manifest.plugin.id === ticket.match.pluginId
  )
  if (
    !plugin ||
    !plugin.enabled ||
    plugin.blockedReason ||
    !sameAuthority(ticket.match, installedAuthority(plugin, ticket.match.adapterId))
  ) {
    throw new Error('Plugin authority changed after discovery. Search again before using it.')
  }
  return plugin
}

function requireThirdPartyGrant(
  authorization: ThirdPartyPluginAIAuthorization,
  match: BuiltinPluginAISearchMatch
): void {
  if (match.trustSource !== 'publisher-signature') return
  if ((match.kind !== 'command' && match.kind !== 'connector') || !match.grantId) {
    throw new Error('Third-party plugin capability has no valid AI grant')
  }
  const review = authorization.review({
    pluginId: match.pluginId,
    kind: match.kind,
    contributionId: match.contributionId
  })
  if (!sameAuthority(match, { trustSource: 'publisher-signature', ...review })) {
    throw new Error('Third-party plugin AI authority changed; review and grant it again')
  }
  authorization.requireGrant(review, match.grantId)
}

function discoveryTicketMatchesInput(
  ticket: BuiltinPluginAIDiscoveryTicket | undefined,
  input: BuiltinPluginAIUseInput
): ticket is BuiltinPluginAIDiscoveryTicket {
  return Boolean(
    ticket &&
    ticket.match.pluginId === input.pluginId &&
    ticket.revision === input.revision &&
    ticket.match.kind === input.kind &&
    ticket.match.contributionId === input.contributionId &&
    ticket.match.title === input.title &&
    ticket.match.trustSource === input.trustSource &&
    ticket.match.packageDigest === input.packageDigest &&
    ticket.match.pluginVersion === input.pluginVersion &&
    ticket.match.publisherId === input.publisherId &&
    ticket.match.publisherKeyId === input.publisherKeyId &&
    ticket.match.adapterId === input.adapterId &&
    ticket.match.grantId === input.grantId
  )
}

function createDefaultBridge(): BuiltinPluginAIBridge {
  const handleAutomationTool = createAutomationToolHandler(makeFigmaFromStore)
  const handlers = createAutomationPluginMCPHandlers(handleAutomationTool)
  return {
    ready: () => appPluginStoreReady.then(() => undefined),
    snapshot: () => appPluginStore.snapshot(),
    listTools: async () => (await handlers.handleList()).result,
    callTool: (store, request, signal, beforeDispatch, executeModule) =>
      handlers.handleCall(
        activeTarget(store),
        request,
        { signal },
        { beforeExecute: beforeDispatch, executeModule }
      )
  }
}

const SEARCH_INPUT_SCHEMA = jsonSchema<BuiltinPluginAISearchInput>({
  type: 'object',
  properties: {
    query: {
      type: 'string',
      minLength: 1,
      maxLength: BUILTIN_PLUGIN_AI_LIMITS.maxQueryLength,
      description: 'Concise feature or action to look for. English and Chinese are supported.'
    },
    kind: {
      type: 'string',
      enum: ['module', 'command', 'exporter', 'connector'],
      description: 'Optional capability type filter.'
    },
    limit: {
      type: 'integer',
      minimum: 1,
      maximum: BUILTIN_PLUGIN_AI_LIMITS.maxMatches,
      description: 'Maximum matches to return; defaults to 5.'
    }
  },
  required: ['query'],
  additionalProperties: false
})

const USE_INPUT_SCHEMA = jsonSchema<BuiltinPluginAIUseInput>({
  type: 'object',
  properties: {
    pluginId: {
      type: 'string',
      minLength: 1,
      maxLength: 128,
      description: 'Exact pluginId returned by the latest search.'
    },
    toolName: {
      type: 'string',
      minLength: 1,
      maxLength: 128,
      description: 'Exact opaque toolName returned by the latest search.'
    },
    revision: {
      type: 'string',
      minLength: 1,
      maxLength: 256,
      description: 'Exact catalog revision returned by the latest search.'
    },
    kind: {
      type: 'string',
      enum: ['module', 'command', 'exporter', 'connector'],
      description: 'Exact capability kind returned by the latest search.'
    },
    contributionId: {
      type: 'string',
      minLength: 1,
      maxLength: 256,
      description: 'Exact contributionId returned by the latest search.'
    },
    title: {
      type: 'string',
      minLength: 1,
      maxLength: 160,
      description: 'Human-readable capability title returned by the latest search.'
    },
    trustSource: {
      type: 'string',
      enum: ['app-bundle', 'publisher-signature'],
      description: 'Exact trust source returned by the latest search.'
    },
    packageDigest: {
      type: 'string',
      minLength: 1,
      maxLength: 256,
      description: 'Exact package digest returned by the latest search.'
    },
    pluginVersion: {
      type: 'string',
      minLength: 1,
      maxLength: 64,
      description: 'Exact plugin version returned by the latest search.'
    },
    publisherId: {
      type: 'string',
      minLength: 1,
      maxLength: 128,
      description: 'Exact publisher ID returned by the latest search.'
    },
    publisherKeyId: {
      type: 'string',
      minLength: 1,
      maxLength: 128,
      description: 'Exact publisher signing-key ID returned by the latest search.'
    },
    adapterId: {
      type: 'string',
      minLength: 1,
      maxLength: 128,
      description: 'Exact reviewed host adapter ID returned by the latest search.'
    },
    grantId: {
      type: 'string',
      minLength: 1,
      maxLength: 128,
      description: 'Session grant ID returned for an authorized publisher-signed contribution.'
    },
    args: {
      type: 'object',
      description: 'Arguments conforming exactly to the search result inputSchema.',
      additionalProperties: true
    }
  },
  required: [
    'pluginId',
    'toolName',
    'revision',
    'kind',
    'contributionId',
    'title',
    'trustSource',
    'packageDigest',
    'pluginVersion',
    'publisherId',
    'publisherKeyId',
    'adapterId'
  ],
  additionalProperties: false
})

export function createBuiltinPluginAITools(
  store: EditorStore,
  options: CreateBuiltinPluginAIToolsOptions = {}
): ToolSet {
  const bridge = options.bridge ?? createDefaultBridge()
  const authorization = options.authorization ?? appPluginAIAuthorization
  const executeModule = options.executeModule
  const latestDiscovery = new Map<string, BuiltinPluginAIDiscoveryTicket>()
  let discoveryGeneration = 0

  return {
    [PLUGIN_AI_TOOL_NAMES.search]: dynamicTool({
      title: 'Search OpenPencil plugins',
      description:
        "Search OpenPencil's local plugin catalog. Publisher-signed entries are limited to exact host-reviewed read-only contributions and are reported as untrusted metadata.",
      inputSchema: SEARCH_INPUT_SCHEMA,
      execute: async (rawInput, execution) => {
        const generation = ++discoveryGeneration
        latestDiscovery.clear()
        execution.abortSignal?.throwIfAborted()
        const input = parseBuiltinPluginSearchInput(rawInput)
        await bridge.ready()
        execution.abortSignal?.throwIfAborted()
        const catalog = await bridge.listTools()
        execution.abortSignal?.throwIfAborted()
        const snapshot = bridge.snapshot()
        const result = searchBuiltinPluginCapabilities(snapshot, catalog, input, {
          thirdPartyGrants: authorization.snapshot()
        })
        if (generation !== discoveryGeneration) return result
        for (const match of result.matches) {
          if (match.availability === 'ready' && match.toolName) {
            livePluginForTicket(snapshot, { match, revision: result.revision })
            requireThirdPartyGrant(authorization, match)
            latestDiscovery.set(match.toolName, {
              match,
              revision: result.revision
            })
          }
        }
        return result
      }
    }),
    [PLUGIN_AI_TOOL_NAMES.use]: dynamicTool({
      title: 'Use OpenPencil plugin',
      description:
        'Invoke one exact reviewed plugin capability returned by the latest search. Publisher-signed contributions require a separate session grant and every call requires approval.',
      inputSchema: USE_INPUT_SCHEMA,
      needsApproval: true,
      execute: async (rawInput, execution) => {
        execution.abortSignal?.throwIfAborted()
        const input = parseUseInput(rawInput)
        const ticket = latestDiscovery.get(input.toolName)
        if (!discoveryTicketMatchesInput(ticket, input)) {
          throw new Error(
            'Plugin capability was not returned by the latest search. Search again before using it.'
          )
        }
        execution.abortSignal?.throwIfAborted()
        await options.beforeUse?.(input, ticket.match)
        execution.abortSignal?.throwIfAborted()
        await bridge.ready()
        execution.abortSignal?.throwIfAborted()
        livePluginForTicket(bridge.snapshot(), ticket)
        requireThirdPartyGrant(authorization, ticket.match)
        const result = await bridge.callTool(
          store,
          { pluginId: input.pluginId, name: input.toolName, args: input.args ?? {} },
          execution.abortSignal,
          (resolved) => {
            if (!sameAuthority(ticket.match, resolved.descriptor.authority)) {
              throw new Error(
                'Plugin authority changed after discovery. Search again before using it.'
              )
            }
            if (
              ticket.match.trustSource === 'publisher-signature' &&
              resolved.kind !== 'command' &&
              resolved.kind !== 'connector'
            ) {
              throw new Error('Third-party plugin contribution kind is not available to AI')
            }
            requireThirdPartyGrant(authorization, ticket.match)
            options.beforeDispatch?.(input, resolved)
          },
          executeModule
            ? (args) => executeModule(args as BuiltinPluginAIArguments, execution)
            : undefined
        )
        return cloneBuiltinPluginJSON(result)
      }
    })
  }
}

export const createPluginAITools = createBuiltinPluginAITools
