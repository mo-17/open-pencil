import { sha256 } from '@noble/hashes/sha256'
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils'

import type { ModuleDefinition } from '@open-pencil/core/plugins'
import type { PluginMcpCatalogSnapshot } from '@open-pencil/mcp/plugin-contract'
import type { JsonObject } from '@open-pencil/scene-graph/primitives'

import { inspectPluginCommandCompatibility, inspectPluginExporterCompatibility } from './host'
import { inspectInstalledPluginModuleCompatibility } from './modules'
import type { createAppPluginStore } from './store'
import type {
  InstalledPluginCommand,
  InstalledPluginExporter,
  InstalledPluginModule
} from './types'

export const PLUGIN_MCP_LIMITS = Object.freeze({
  maxTools: 256,
  maxConfigBytes: 64 * 1024,
  maxCoordinate: 100_000,
  maxDimension: 100_000,
  maxNameLength: 128,
  maxParentIdLength: 256,
  maxToolNameLength: 128,
  maxTitleLength: 160,
  maxDescriptionLength: 2_000,
  maxSchemaDescriptionLength: 4_096,
  maxDescriptorBytes: 32 * 1024,
  maxCatalogBytes: 512 * 1024
})

export type AppPluginMcpToolKind = 'module' | 'command' | 'exporter'

export interface AppPluginMcpToolDescriptor {
  name: string
  title: string
  description: string
  inputSchema: JsonObject
  pluginId: string
  kind: AppPluginMcpToolKind
  contributionId: string
}

export type AppPluginMcpToolCatalog = PluginMcpCatalogSnapshot

export type AppPluginMcpStore = Pick<
  ReturnType<typeof createAppPluginStore>,
  'installedModules' | 'installedCommands' | 'installedExporters'
>

export type ResolvedAppPluginMcpTool =
  | Readonly<{
      descriptor: AppPluginMcpToolDescriptor
      kind: 'module'
      value: InstalledPluginModule
    }>
  | Readonly<{
      descriptor: AppPluginMcpToolDescriptor
      kind: 'command'
      value: InstalledPluginCommand
    }>
  | Readonly<{
      descriptor: AppPluginMcpToolDescriptor
      kind: 'exporter'
      value: InstalledPluginExporter
    }>

type PluginMcpCandidate =
  | Readonly<{
      baseName: string
      identity: string
      descriptor: Omit<AppPluginMcpToolDescriptor, 'name'>
      kind: 'module'
      value: InstalledPluginModule
    }>
  | Readonly<{
      baseName: string
      identity: string
      descriptor: Omit<AppPluginMcpToolDescriptor, 'name'>
      kind: 'command'
      value: InstalledPluginCommand
    }>
  | Readonly<{
      baseName: string
      identity: string
      descriptor: Omit<AppPluginMcpToolDescriptor, 'name'>
      kind: 'exporter'
      value: InstalledPluginExporter
    }>

interface NamedPluginMcpCandidate {
  descriptor: AppPluginMcpToolDescriptor
  kind: PluginMcpCandidate['kind']
  value: InstalledPluginModule | InstalledPluginCommand | InstalledPluginExporter
}

const EMPTY_INPUT_SCHEMA: JsonObject = Object.freeze({
  type: 'object',
  properties: Object.freeze({}),
  additionalProperties: false
})

function inputField(
  type: 'number' | 'string' | 'object',
  description: string,
  extra: JsonObject = {}
): JsonObject {
  return { type, description, ...extra }
}

function moduleConfigDescription(fields: ModuleDefinition['fields']): string {
  const fieldSummary = fields
    .map((field) => {
      const path = field.path.join('.')
      const bounds = [
        field.min === undefined ? '' : `min ${field.min}`,
        field.max === undefined ? '' : `max ${field.max}`,
        field.options?.length ? `options ${field.options.join('|')}` : ''
      ]
        .filter(Boolean)
        .join(', ')
      return `${path} (${field.kind}${bounds ? `; ${bounds}` : ''})`
    })
    .join('; ')
  const description = fieldSummary
    ? `Configuration values validated by the trusted host adapter. Supported fields: ${fieldSummary}`
    : 'Configuration values validated by the trusted host adapter.'
  return description.slice(0, PLUGIN_MCP_LIMITS.maxSchemaDescriptionLength)
}

function moduleInputSchema(definition: ModuleDefinition): JsonObject {
  return {
    type: 'object',
    properties: {
      config: inputField('object', moduleConfigDescription(definition.fields), {
        additionalProperties: true
      }),
      x: inputField('number', 'X position on the target page', {
        minimum: -PLUGIN_MCP_LIMITS.maxCoordinate,
        maximum: PLUGIN_MCP_LIMITS.maxCoordinate
      }),
      y: inputField('number', 'Y position on the target page', {
        minimum: -PLUGIN_MCP_LIMITS.maxCoordinate,
        maximum: PLUGIN_MCP_LIMITS.maxCoordinate
      }),
      width: inputField('number', 'Optional width override', {
        minimum: 1,
        maximum: PLUGIN_MCP_LIMITS.maxDimension
      }),
      height: inputField('number', 'Optional height override', {
        minimum: 1,
        maximum: PLUGIN_MCP_LIMITS.maxDimension
      }),
      name: inputField('string', 'Optional layer name', {
        minLength: 1,
        maxLength: PLUGIN_MCP_LIMITS.maxNameLength
      }),
      parent_id: inputField('string', 'Optional container node id', {
        minLength: 1,
        maxLength: PLUGIN_MCP_LIMITS.maxParentIdLength
      })
    },
    additionalProperties: false
  }
}

function normalizedToolSegment(value: string): string {
  const normalized = value
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
  return normalized || 'tool'
}

function candidateIdentity(
  pluginId: string,
  kind: AppPluginMcpToolKind,
  contributionId: string
): string {
  return `${kind}\0${pluginId}\0${contributionId}`
}

function sha256Hex(value: string): string {
  return bytesToHex(sha256(utf8ToBytes(value)))
}

export function appPluginMcpToolName(
  pluginId: string,
  kind: AppPluginMcpToolKind,
  contributionId: string
): string {
  const action = { module: 'add', command: 'run', exporter: 'export' }[kind]
  const plugin = normalizedToolSegment(pluginId).slice(0, 24)
  const contribution = normalizedToolSegment(contributionId).slice(0, 24)
  const readable = `plugin__${plugin}__${action}_${contribution}`
  // The digest is permanently derived from the canonical contribution identity,
  // not from which other plugins happen to be installed. Keep the full SHA-256
  // so a readable-slug collision cannot transfer an old MCP name to new authority.
  const suffix = `_${sha256Hex(candidateIdentity(pluginId, kind, contributionId))}`
  return `${readable.slice(0, PLUGIN_MCP_LIMITS.maxToolNameLength - suffix.length)}${suffix}`
}

function pluginMetadata(
  pluginId: string,
  kind: AppPluginMcpToolKind,
  contributionId: string,
  contributionName: string,
  contributionDescription: string,
  inputSchema: JsonObject
): Omit<AppPluginMcpToolDescriptor, 'name'> {
  const description = `${contributionDescription} Available only while plugin ${pluginId} is installed and enabled.`
  return {
    title: contributionName.slice(0, PLUGIN_MCP_LIMITS.maxTitleLength),
    description: description.slice(0, PLUGIN_MCP_LIMITS.maxDescriptionLength),
    inputSchema,
    pluginId,
    kind,
    contributionId
  }
}

function activeCandidates(store: AppPluginMcpStore): PluginMcpCandidate[] {
  const candidates: PluginMcpCandidate[] = []
  for (const module of store.installedModules()) {
    const compatibility = inspectInstalledPluginModuleCompatibility(module)
    if (!compatibility.ok) continue
    const pluginId = module.plugin.package.manifest.plugin.id
    const contributionId = module.contribution.moduleType
    candidates.push({
      baseName: appPluginMcpToolName(pluginId, 'module', contributionId),
      identity: candidateIdentity(pluginId, 'module', contributionId),
      descriptor: pluginMetadata(
        pluginId,
        'module',
        contributionId,
        compatibility.definition.name,
        compatibility.definition.description,
        moduleInputSchema(compatibility.definition)
      ),
      kind: 'module',
      value: module
    })
  }
  for (const command of store.installedCommands()) {
    const pluginId = command.plugin.package.manifest.plugin.id
    if (!inspectPluginCommandCompatibility(pluginId, command.contribution).ok) continue
    const contributionId = command.contribution.commandId
    candidates.push({
      baseName: appPluginMcpToolName(pluginId, 'command', contributionId),
      identity: candidateIdentity(pluginId, 'command', contributionId),
      descriptor: pluginMetadata(
        pluginId,
        'command',
        contributionId,
        `Run ${contributionId}`,
        `Run trusted installed-plugin command ${contributionId}.`,
        EMPTY_INPUT_SCHEMA
      ),
      kind: 'command',
      value: command
    })
  }
  for (const exporter of store.installedExporters()) {
    const pluginId = exporter.plugin.package.manifest.plugin.id
    if (!inspectPluginExporterCompatibility(pluginId, exporter.contribution).ok) continue
    const contributionId = exporter.contribution.exporterId
    candidates.push({
      baseName: appPluginMcpToolName(pluginId, 'exporter', contributionId),
      identity: candidateIdentity(pluginId, 'exporter', contributionId),
      descriptor: pluginMetadata(
        pluginId,
        'exporter',
        contributionId,
        `Export with ${contributionId}`,
        `Run trusted installed-plugin exporter ${contributionId}.`,
        EMPTY_INPUT_SCHEMA
      ),
      kind: 'exporter',
      value: exporter
    })
  }
  candidates.sort((left, right) => left.identity.localeCompare(right.identity))
  if (candidates.length > PLUGIN_MCP_LIMITS.maxTools) {
    throw new Error(`Enabled plugin MCP tools exceed the ${PLUGIN_MCP_LIMITS.maxTools} tool limit`)
  }
  return candidates
}

function namedCandidates(store: AppPluginMcpStore): NamedPluginMcpCandidate[] {
  const candidates = activeCandidates(store)
  const identityCounts = new Map<string, number>()
  for (const candidate of candidates) {
    identityCounts.set(candidate.identity, (identityCounts.get(candidate.identity) ?? 0) + 1)
  }
  // Ambiguous duplicate declarations are omitted rather than letting list order select authority.
  const uniqueCandidates = candidates.filter(
    (candidate) => identityCounts.get(candidate.identity) === 1
  )
  const named = uniqueCandidates.map((candidate) => {
    return {
      descriptor: { name: candidate.baseName, ...candidate.descriptor },
      kind: candidate.kind,
      value: candidate.value
    }
  })
  const nameCounts = new Map<string, number>()
  for (const candidate of named) {
    nameCounts.set(candidate.descriptor.name, (nameCounts.get(candidate.descriptor.name) ?? 0) + 1)
  }
  return named.filter((candidate) => {
    if (nameCounts.get(candidate.descriptor.name) !== 1) return false
    const bytes = new TextEncoder().encode(JSON.stringify(candidate.descriptor)).byteLength
    return bytes <= PLUGIN_MCP_LIMITS.maxDescriptorBytes
  })
}

function catalogRevision(tools: readonly AppPluginMcpToolDescriptor[]): string {
  const serialized = JSON.stringify(tools)
  return `plugin-mcp-v2-${sha256Hex(serialized)}`
}

export function listAppPluginMcpTools(store: AppPluginMcpStore): AppPluginMcpToolCatalog {
  const tools = namedCandidates(store).map(({ descriptor }) => structuredClone(descriptor))
  const bytes = new TextEncoder().encode(JSON.stringify(tools)).byteLength
  if (bytes > PLUGIN_MCP_LIMITS.maxCatalogBytes) {
    throw new Error(
      `Plugin MCP catalog exceeds the ${PLUGIN_MCP_LIMITS.maxCatalogBytes} byte limit`
    )
  }
  return { revision: catalogRevision(tools), tools }
}

export function resolveAppPluginMcpTool(
  store: AppPluginMcpStore,
  name: string,
  pluginId: string
): ResolvedAppPluginMcpTool {
  const candidate = namedCandidates(store).find(({ descriptor }) => descriptor.name === name)
  if (!candidate) throw new Error(`Plugin MCP tool is unavailable: ${name}`)
  if (candidate.descriptor.pluginId !== pluginId) {
    throw new Error(`Plugin MCP tool ${name} does not belong to plugin ${pluginId}`)
  }
  if (candidate.kind === 'module') {
    return {
      descriptor: structuredClone(candidate.descriptor),
      kind: 'module',
      value: candidate.value as InstalledPluginModule
    }
  }
  if (candidate.kind === 'command') {
    return {
      descriptor: structuredClone(candidate.descriptor),
      kind: 'command',
      value: candidate.value as InstalledPluginCommand
    }
  }
  return {
    descriptor: structuredClone(candidate.descriptor),
    kind: 'exporter',
    value: candidate.value as InstalledPluginExporter
  }
}
