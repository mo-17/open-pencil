import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import { CHART_PLUGIN_ID, MAP_PLUGIN_ID } from '@open-pencil/core/plugins'

import { createAITools } from '@/app/ai/tools'
import {
  BUILTIN_PLUGIN_AI_LIMITS,
  BUILTIN_PLUGIN_AI_TOOL_NAMES,
  createBuiltinPluginAITools,
  searchBuiltinPluginCapabilities,
  type BuiltinPluginAIBridge,
  type BuiltinPluginAISearchResult
} from '@/app/ai/tools/builtin'
import { createEditorStore } from '@/app/editor/session'
import { createBundledPluginCatalog } from '@/app/plugins/catalog'
import type {
  AppPluginMCPToolCatalog,
  AppPluginMCPToolDescriptor,
  AppPluginMCPToolKind
} from '@/app/plugins/mcp'
import { appPluginMCPConnectorContributionId } from '@/app/plugins/mcp'
import type {
  AppPluginCatalogItem,
  AppPluginStoreSnapshot,
  AppPluginTrustSource,
  InstalledAppPlugin
} from '@/app/plugins/types'

type ExecutableTool = {
  title?: string
  needsApproval?: unknown
  execute(
    input: unknown,
    execution?: {
      abortSignal?: AbortSignal
      context?: unknown
      messages?: readonly unknown[]
      toolCallId?: string
    }
  ): Promise<unknown>
}
const bundledCatalog = createBundledPluginCatalog()
let previousWindow: typeof globalThis.window | undefined

beforeEach(() => {
  previousWindow = globalThis.window
  Object.assign(globalThis, { window: { innerWidth: 1200, innerHeight: 800 } })
})

afterEach(() => {
  if (previousWindow) Object.assign(globalThis, { window: previousWindow })
  else Reflect.deleteProperty(globalThis, 'window')
})

function manifest(pluginId: string) {
  const entry = bundledCatalog.find((candidate) => candidate.manifest.plugin.id === pluginId)
  if (!entry) throw new Error(`Missing bundled plugin fixture: ${pluginId}`)
  return structuredClone(entry.manifest)
}

function catalogItem(
  pluginId: string,
  trustSource: AppPluginTrustSource = 'app-bundle',
  installed = true
): AppPluginCatalogItem {
  return {
    package: {
      trustSource,
      manifest: manifest(pluginId),
      digest: `sha256-${pluginId}`
    },
    installed
  }
}

function installedPlugin(
  item: AppPluginCatalogItem,
  enabled: boolean,
  blockedReason?: string
): InstalledAppPlugin {
  return {
    package: item.package,
    enabled,
    pinnedDigest: null,
    ...(blockedReason ? { blockedReason } : {})
  }
}

function snapshot(
  catalog: readonly AppPluginCatalogItem[],
  installed: readonly InstalledAppPlugin[] = []
): AppPluginStoreSnapshot {
  return {
    ready: true,
    catalog,
    installed,
    pinnedDigestMismatches: [],
    recordIssues: [],
    error: null
  }
}

function descriptor(
  pluginId: string,
  contributionId: string,
  kind: AppPluginMCPToolKind = 'module',
  text = 'Shared capability',
  authorityOverrides: Partial<AppPluginMCPToolDescriptor['authority']> = {}
): AppPluginMCPToolDescriptor {
  const pluginManifest = manifest(pluginId)
  return {
    name: `plugin__${pluginId.replaceAll(/[^a-z0-9]+/g, '_')}__${contributionId}`,
    title: text,
    description: text,
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    pluginId,
    kind,
    contributionId,
    authority: {
      trustSource: 'app-bundle',
      packageDigest: `sha256-${pluginId}`,
      pluginVersion: pluginManifest.plugin.version,
      publisherId: pluginManifest.publisher.id,
      publisherKeyId: pluginManifest.publisher.keyId,
      adapterId: `test.${kind}.${contributionId}`,
      ...authorityOverrides
    }
  }
}

function toolCatalog(
  tools: readonly AppPluginMCPToolDescriptor[],
  revision = 'plugin-test-revision'
): AppPluginMCPToolCatalog {
  return { revision, tools }
}

function executable(
  tools: ReturnType<typeof createBuiltinPluginAITools> | ReturnType<typeof createAITools>,
  name: string
): ExecutableTool {
  const candidate = tools[name] as ExecutableTool | undefined
  if (!candidate?.execute) throw new Error(`Missing executable AI tool: ${name}`)
  return candidate
}

function execute(tool: ExecutableTool, input: unknown): Promise<unknown> {
  return tool.execute(input, { messages: [], toolCallId: 'builtin-plugin-test' })
}

function pluginUseInput(
  tool: AppPluginMCPToolDescriptor,
  revision: string,
  args: Record<string, unknown> = {}
) {
  return {
    pluginId: tool.pluginId,
    toolName: tool.name,
    revision,
    kind: tool.kind,
    contributionId: tool.contributionId,
    title: tool.title,
    ...tool.authority,
    args
  }
}

describe('built-in plugin AI tools', () => {
  test('searches reviewed app-bundle capabilities in English and Chinese and reports disabled state', () => {
    const map = catalogItem(MAP_PLUGIN_ID)
    const readyCatalog = toolCatalog([
      {
        ...descriptor(MAP_PLUGIN_ID, 'map'),
        title: 'Map',
        description:
          'Interactive OpenStreetMap module with bounded markers and declarative configuration.'
      }
    ])

    const english = searchBuiltinPluginCapabilities(
      snapshot([map], [installedPlugin(map, true)]),
      readyCatalog,
      { query: 'OpenStreetMap' }
    )
    expect(english.matches).toEqual([
      expect.objectContaining({
        pluginId: MAP_PLUGIN_ID,
        availability: 'ready',
        toolName: readyCatalog.tools[0].name
      })
    ])

    const chinese = searchBuiltinPluginCapabilities(
      snapshot([map], [installedPlugin(map, false)]),
      toolCatalog([]),
      { query: '可编辑地图' }
    )
    expect(chinese.matches).toEqual([
      expect.objectContaining({
        pluginId: MAP_PLUGIN_ID,
        availability: 'disabled',
        kind: 'module',
        contributionId: 'map'
      })
    ])
    expect(chinese.matches[0].toolName).toBeUndefined()
    expect(chinese.matches[0].inputSchema).toBeUndefined()

    const refreshing = searchBuiltinPluginCapabilities(
      { ...snapshot([map], [installedPlugin(map, true)]), ready: false },
      readyCatalog,
      { query: 'OpenStreetMap' }
    )
    expect(refreshing.matches.some((match) => match.availability === 'ready')).toBe(false)
  })

  test('filters publisher entries and applies kind, limit, and deterministic tie ordering', () => {
    const map = catalogItem(MAP_PLUGIN_ID)
    const publisherChart = catalogItem(CHART_PLUGIN_ID, 'publisher-signature')
    const capabilities = toolCatalog([
      descriptor(MAP_PLUGIN_ID, 'z-module', 'module'),
      descriptor(MAP_PLUGIN_ID, 'b-command', 'command'),
      descriptor(MAP_PLUGIN_ID, 'a-command', 'command'),
      descriptor(MAP_PLUGIN_ID, 'c-exporter', 'exporter'),
      descriptor(CHART_PLUGIN_ID, 'chart', 'module')
    ])
    const current = snapshot(
      [map, publisherChart],
      [installedPlugin(map, true), installedPlugin(publisherChart, true)]
    )

    expect(
      searchBuiltinPluginCapabilities(current, capabilities, {
        query: 'Shared capability',
        kind: 'command',
        limit: 1
      }).matches.map((match) => match.contributionId)
    ).toEqual(['a-command'])
    expect(
      searchBuiltinPluginCapabilities(current, capabilities, {
        query: 'Shared capability',
        limit: 2
      }).matches.map((match) => match.contributionId)
    ).toEqual(['a-command', 'b-command'])
    expect(
      searchBuiltinPluginCapabilities(current, capabilities, { query: 'chart' }).matches
    ).toEqual([])
  })

  test('reports unavailable sibling contributions and distinguishes connector setup from no authority', () => {
    const stripe = catalogItem('open-pencil.stripe')
    const getProductId = appPluginMCPConnectorContributionId('stripe.billing', 'get-product')
    const getPriceId = appPluginMCPConnectorContributionId('stripe.billing', 'get-price')
    const onlyLiveProduct = descriptor(
      'open-pencil.stripe',
      getProductId,
      'connector',
      'Get Stripe product'
    )

    const sibling = searchBuiltinPluginCapabilities(
      snapshot([stripe], [installedPlugin(stripe, true)]),
      toolCatalog([onlyLiveProduct]),
      { query: 'get price', kind: 'connector' }
    )
    expect(sibling.matches).toContainEqual(
      expect.objectContaining({
        contributionId: getPriceId,
        availability: 'setup-required'
      })
    )
    expect(
      sibling.matches.find((match) => match.contributionId === getPriceId)?.toolName
    ).toBeUndefined()

    const alteredLinear = catalogItem('open-pencil.linear')
    const linearManifest = alteredLinear.package.manifest
    if (linearManifest.schemaVersion !== 2) throw new Error('Expected a V2 connector fixture')
    const linearConnector = linearManifest.contributions.connectors?.[0]
    const linearOperation = linearConnector?.operations[0]
    if (!linearOperation?.request) throw new Error('Expected a connector request fixture')
    Object.assign(linearOperation.request, { pathTemplate: '/v1/unreviewed-issues' })
    const unreviewed = searchBuiltinPluginCapabilities(
      snapshot([alteredLinear], [installedPlugin(alteredLinear, true)]),
      toolCatalog([]),
      { query: 'list issues', kind: 'connector' }
    )
    expect(unreviewed.matches).toEqual([
      expect.objectContaining({ availability: 'not-ai-callable' })
    ])
  })

  test('rejects malformed search input before consulting plugin state', () => {
    const current = snapshot([])
    const catalog = toolCatalog([])
    const invalidInputs: unknown[] = [
      null,
      [],
      { query: '' },
      { query: 'x'.repeat(BUILTIN_PLUGIN_AI_LIMITS.maxQueryLength + 1) },
      { query: 'map', kind: 'mutation' },
      { query: 'map', limit: 0 },
      { query: 'map', limit: BUILTIN_PLUGIN_AI_LIMITS.maxMatches + 1 },
      { query: 'map', extra: true }
    ]

    for (const input of invalidInputs) {
      expect(() => searchBuiltinPluginCapabilities(current, catalog, input as never)).toThrow()
    }
  })

  test('keeps search read-only, requires approval for use, and binds use to the latest exact pair', async () => {
    const map = catalogItem(MAP_PLUGIN_ID)
    const mapTool = descriptor(MAP_PLUGIN_ID, 'map')
    const currentSnapshot = snapshot([map], [installedPlugin(map, true)])
    let currentCatalog = toolCatalog([mapTool], 'revision-ready')
    const calls: Array<{ pluginId: string; name: string; args: Record<string, unknown> }> = []
    let listCount = 0
    const bridge: BuiltinPluginAIBridge = {
      ready: () => Promise.resolve(),
      snapshot: () => currentSnapshot,
      listTools: () => {
        listCount++
        return Promise.resolve(currentCatalog)
      },
      callTool: (_store, request) => {
        const live = currentCatalog.tools.some(
          (candidate) => candidate.pluginId === request.pluginId && candidate.name === request.name
        )
        if (!live)
          return Promise.reject(new Error(`Plugin MCP tool is unavailable: ${request.name}`))
        calls.push(request)
        return Promise.resolve({ ok: true })
      }
    }
    const tools = createBuiltinPluginAITools(createEditorStore(), { bridge })
    const search = executable(tools, BUILTIN_PLUGIN_AI_TOOL_NAMES.search)
    const use = executable(tools, BUILTIN_PLUGIN_AI_TOOL_NAMES.use)

    expect(search.needsApproval).toBeUndefined()
    expect(use.needsApproval).toBe(true)
    await expect(execute(use, pluginUseInput(mapTool, 'revision-ready'))).rejects.toThrow(
      'latest search'
    )
    expect(listCount).toBe(0)
    expect(calls).toEqual([])

    await execute(search, { query: 'map' })
    expect(listCount).toBe(1)
    expect(calls).toEqual([])
    await expect(
      execute(use, {
        ...pluginUseInput(mapTool, 'revision-ready'),
        pluginId: CHART_PLUGIN_ID
      })
    ).rejects.toThrow('latest search')
    await expect(
      execute(use, {
        ...pluginUseInput(mapTool, 'revision-ready'),
        toolName: 'plugin__wrong'
      })
    ).rejects.toThrow('latest search')
    await expect(
      execute(use, {
        ...pluginUseInput(mapTool, 'revision-ready'),
        title: 'Misleading approval title'
      })
    ).rejects.toThrow('latest search')

    await expect(
      execute(use, pluginUseInput(mapTool, 'revision-ready', { zoom: 4 }))
    ).resolves.toEqual({ ok: true })
    expect(calls).toEqual([{ pluginId: MAP_PLUGIN_ID, name: mapTool.name, args: { zoom: 4 } }])

    await execute(search, { query: 'zzqxvv' })
    await expect(execute(use, pluginUseInput(mapTool, 'revision-ready'))).rejects.toThrow(
      'latest search'
    )
    expect(calls).toHaveLength(1)

    await execute(search, { query: 'map' })
    currentCatalog = toolCatalog([], 'revision-revoked')
    await expect(execute(use, pluginUseInput(mapTool, 'revision-ready'))).rejects.toThrow(
      'is unavailable'
    )
    expect(calls).toHaveLength(1)
  })

  test('clears discovery authority when a newer search fails, aborts, or finishes first', async () => {
    const map = catalogItem(MAP_PLUGIN_ID)
    const mapTool = descriptor(MAP_PLUGIN_ID, 'map')
    const currentSnapshot = snapshot([map], [installedPlugin(map, true)])
    const readyCatalog = toolCatalog([mapTool], 'revision-ready')
    let failure: Error | undefined
    const pending: Array<{
      promise: Promise<AppPluginMCPToolCatalog>
      resolve(value: AppPluginMCPToolCatalog): void
    }> = []
    let deferSearches = false
    const bridge: BuiltinPluginAIBridge = {
      ready: () => Promise.resolve(),
      snapshot: () => currentSnapshot,
      listTools: () => {
        if (failure) throw failure
        if (!deferSearches) return Promise.resolve(readyCatalog)
        let resolve!: (value: AppPluginMCPToolCatalog) => void
        const promise = new Promise<AppPluginMCPToolCatalog>((complete) => {
          resolve = complete
        })
        pending.push({ promise, resolve })
        return promise
      },
      callTool: () => Promise.resolve({ ok: true })
    }
    const tools = createBuiltinPluginAITools(createEditorStore(), { bridge })
    const search = executable(tools, BUILTIN_PLUGIN_AI_TOOL_NAMES.search)
    const use = executable(tools, BUILTIN_PLUGIN_AI_TOOL_NAMES.use)
    const useInput = pluginUseInput(mapTool, 'revision-ready')

    await execute(search, { query: 'map' })
    failure = new Error('catalog refresh failed')
    await expect(execute(search, { query: 'map' })).rejects.toThrow('catalog refresh failed')
    await expect(execute(use, useInput)).rejects.toThrow('latest search')

    failure = undefined
    await execute(search, { query: 'map' })
    const controller = new AbortController()
    controller.abort()
    await expect(
      search.execute(
        { query: 'map' },
        {
          abortSignal: controller.signal,
          messages: [],
          toolCallId: 'aborted-plugin-search'
        }
      )
    ).rejects.toThrow()
    await expect(execute(use, useInput)).rejects.toThrow('latest search')

    deferSearches = true
    const older = execute(search, { query: 'map' })
    const newer = execute(search, { query: 'no-such-capability' })
    await Promise.resolve()
    await Promise.resolve()
    expect(pending).toHaveLength(2)
    pending[1].resolve(readyCatalog)
    await newer
    pending[0].resolve(readyCatalog)
    await older
    await expect(execute(use, useInput)).rejects.toThrow('latest search')
  })

  test('binds discovery to the current app-bundle package digest', async () => {
    const map = catalogItem(MAP_PLUGIN_ID)
    const mapTool = descriptor(MAP_PLUGIN_ID, 'map')
    let currentSnapshot = snapshot([map], [installedPlugin(map, true)])
    let callCount = 0
    const bridge: BuiltinPluginAIBridge = {
      ready: () => Promise.resolve(),
      snapshot: () => currentSnapshot,
      listTools: () => Promise.resolve(toolCatalog([mapTool], 'revision-ready')),
      callTool: () => {
        callCount += 1
        return Promise.resolve({ ok: true })
      }
    }
    const tools = createBuiltinPluginAITools(createEditorStore(), { bridge })
    const search = executable(tools, BUILTIN_PLUGIN_AI_TOOL_NAMES.search)
    const use = executable(tools, BUILTIN_PLUGIN_AI_TOOL_NAMES.use)

    await execute(search, { query: 'map' })
    const replacement = structuredClone(map)
    replacement.package.digest = 'sha256-replaced-package'
    currentSnapshot = snapshot([replacement], [installedPlugin(replacement, true)])
    await expect(execute(use, pluginUseInput(mapTool, 'revision-ready'))).rejects.toThrow(
      'authority changed'
    )
    expect(callCount).toBe(0)
  })

  test('forwards the original approved execution context to the hidden module executor', async () => {
    const map = catalogItem(MAP_PLUGIN_ID)
    const mapTool = descriptor(MAP_PLUGIN_ID, 'map')
    const currentSnapshot = snapshot([map], [installedPlugin(map, true)])
    let receivedArgs: Record<string, unknown> | undefined
    let receivedExecution: unknown
    const bridge: BuiltinPluginAIBridge = {
      ready: () => Promise.resolve(),
      snapshot: () => currentSnapshot,
      listTools: () => Promise.resolve(toolCatalog([mapTool], 'revision-ready')),
      callTool: (_store, request, _signal, _beforeDispatch, executeModule) => {
        if (!executeModule) throw new Error('Missing approved module executor')
        return executeModule({
          ...request.args,
          plugin_id: request.pluginId,
          module_type: mapTool.contributionId
        })
      }
    }
    const tools = createBuiltinPluginAITools(createEditorStore(), {
      bridge,
      executeModule: async (args, execution) => {
        receivedArgs = args
        receivedExecution = execution
        return { ok: true, created: true }
      }
    })
    const search = executable(tools, BUILTIN_PLUGIN_AI_TOOL_NAMES.search)
    const use = executable(tools, BUILTIN_PLUGIN_AI_TOOL_NAMES.use)
    await execute(search, { query: 'map' })
    const execution = {
      context: { source: 'direct-ai' },
      messages: [{ role: 'user', content: 'add a map' }],
      toolCallId: 'approved-plugin-module'
    }
    let getterCalls = 0
    const forgedArgs = {}
    Object.defineProperty(forgedArgs, 'secret', {
      enumerable: true,
      get() {
        getterCalls += 1
        return 'must not be read'
      }
    })
    await expect(
      use.execute({ ...pluginUseInput(mapTool, 'revision-ready'), args: forgedArgs }, execution)
    ).rejects.toThrow('getters or setters')
    expect(getterCalls).toBe(0)
    expect(receivedArgs).toBeUndefined()

    await expect(
      use.execute(pluginUseInput(mapTool, 'revision-ready', { x: 24 }), execution)
    ).resolves.toEqual({ ok: true, created: true })
    expect(receivedArgs).toEqual({
      x: 24,
      plugin_id: MAP_PLUGIN_ID,
      module_type: 'map'
    })
    expect(receivedExecution).toBe(execution)
  })

  test('registers both plugin facade tools through createAITools', () => {
    const tools = createAITools(createEditorStore())
    const search = executable(tools, BUILTIN_PLUGIN_AI_TOOL_NAMES.search)
    const use = executable(tools, BUILTIN_PLUGIN_AI_TOOL_NAMES.use)

    expect(search.title).toBe('Search OpenPencil plugins')
    expect(search.needsApproval).toBeUndefined()
    expect(use.title).toBe('Use OpenPencil plugin')
    expect(use.needsApproval).toBe(true)
    expect(tools.create_module).toBeUndefined()
  })

  test('creates a ready module end-to-end only through the approved facade', async () => {
    const store = createEditorStore()
    const tools = createAITools(store)
    const search = executable(tools, BUILTIN_PLUGIN_AI_TOOL_NAMES.search)
    const use = executable(tools, BUILTIN_PLUGIN_AI_TOOL_NAMES.use)
    const result = (await execute(search, {
      query: 'OpenStreetMap',
      kind: 'module'
    })) as BuiltinPluginAISearchResult
    const match = result.matches.find(
      (candidate) => candidate.pluginId === MAP_PLUGIN_ID && candidate.availability === 'ready'
    )
    if (!match?.toolName) throw new Error('Expected the default-enabled Map capability')

    expect(tools.create_module).toBeUndefined()
    await expect(
      execute(use, {
        pluginId: match.pluginId,
        toolName: match.toolName,
        revision: result.revision,
        kind: match.kind,
        contributionId: match.contributionId,
        title: match.title,
        trustSource: match.trustSource,
        packageDigest: match.packageDigest,
        pluginVersion: match.pluginVersion,
        publisherId: match.publisherId,
        publisherKeyId: match.publisherKeyId,
        adapterId: match.adapterId,
        args: { x: 50, y: 60 }
      })
    ).resolves.toMatchObject({
      ok: true,
      data: {
        module: {
          pluginId: MAP_PLUGIN_ID,
          moduleType: 'map'
        }
      }
    })
    expect(store.graph.getNode(store.state.currentPageId)?.childIds).toHaveLength(1)
    expect(store.undo.undoLabel).toBe('AI: create_module')
    store.undo.undo()
    expect(store.graph.getNode(store.state.currentPageId)?.childIds).toEqual([])
  })
})
