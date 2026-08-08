import {
  canonicalManifestValue,
  normalizeStableEngineRange,
  parseBoundedManifestArray as array,
  parseExactManifestRecord as record,
  parseSignedManifestIntegrity,
  parseStableSemver,
  validateModuleIdentity,
  validateModuleInstance
} from '@open-pencil/scene-graph'
import type { JsonObject } from '@open-pencil/scene-graph/primitives'

import type { ModulePropertyFieldKind } from './types'

export const PLUGIN_MANIFEST_FORMAT = 'openpencil-plugin' as const
export const PLUGIN_MANIFEST_SCHEMA_VERSION = 1 as const

export const PLUGIN_MANIFEST_LIMITS = Object.freeze({
  maxJsonBytes: 1024 * 1024,
  maxModules: 64,
  maxCommands: 64,
  maxExporters: 64,
  maxFieldsPerModule: 64,
  maxFieldPathDepth: 8,
  maxOptionsPerField: 128,
  maxNameLength: 128,
  maxDescriptionLength: 2_048,
  maxFileExtensionLength: 32,
  maxEngineRangeLength: 128,
  maxDimension: 100_000
})

export interface PluginManifestPublisherV1 {
  id: string
  name: string
  keyId: string
}

export interface DeclarativeModuleFieldV1 {
  path: readonly (string | number)[]
  kind: ModulePropertyFieldKind
  label: string
  min?: number
  max?: number
  step?: number
  options?: readonly string[]
}

export interface DeclarativeModuleContributionV1 {
  moduleType: string
  name: string
  description: string
  adapterId: string
  configVersion: number
  defaultSize: { width: number; height: number }
  defaultConfig: JsonObject
  fields: readonly DeclarativeModuleFieldV1[]
}

export interface DeclarativeCommandContributionV1 {
  commandId: string
  name: string
  description: string
  adapterId: string
}

export interface DeclarativeExporterContributionV1 {
  exporterId: string
  name: string
  description: string
  adapterId: string
  fileExtension: string
}

export interface PluginManifestPayloadV1 {
  format: typeof PLUGIN_MANIFEST_FORMAT
  schemaVersion: typeof PLUGIN_MANIFEST_SCHEMA_VERSION
  plugin: { id: string; name: string; version: string }
  publisher: PluginManifestPublisherV1
  engineRange: string
  capabilities: readonly []
  contributions: {
    modules: readonly DeclarativeModuleContributionV1[]
    commands?: readonly DeclarativeCommandContributionV1[]
    exporters?: readonly DeclarativeExporterContributionV1[]
  }
}

export interface PluginManifestSignatureV1 {
  algorithm: 'Ed25519'
  keyId: string
  value: string
}

export interface PluginManifestIntegrityV1 {
  algorithm: 'SHA-256'
  digest: string
  signature: PluginManifestSignatureV1
}

export interface PluginManifestV1 extends PluginManifestPayloadV1 {
  integrity: PluginManifestIntegrityV1
}

export type PluginManifestValidationResult =
  | { ok: true; value: PluginManifestV1 }
  | { ok: false; reason: string }

const PAYLOAD_KEYS = new Set([
  'format',
  'schemaVersion',
  'plugin',
  'publisher',
  'engineRange',
  'capabilities',
  'contributions'
])
const MANIFEST_KEYS = new Set([...PAYLOAD_KEYS, 'integrity'])
const PLUGIN_KEYS = new Set(['id', 'name', 'version'])
const PUBLISHER_KEYS = new Set(['id', 'name', 'keyId'])
const CONTRIBUTIONS_KEYS = new Set(['modules', 'commands', 'exporters'])
const REQUIRED_CONTRIBUTIONS_KEYS = new Set(['modules'])
const MODULE_KEYS = new Set([
  'moduleType',
  'name',
  'description',
  'adapterId',
  'configVersion',
  'defaultSize',
  'defaultConfig',
  'fields'
])
const COMMAND_KEYS = new Set(['commandId', 'name', 'description', 'adapterId'])
const EXPORTER_KEYS = new Set(['exporterId', 'name', 'description', 'adapterId', 'fileExtension'])
const SIZE_KEYS = new Set(['width', 'height'])
const FIELD_KEYS = new Set(['path', 'kind', 'label', 'min', 'max', 'step', 'options'])
const FIELD_KINDS = new Set<ModulePropertyFieldKind>([
  'number',
  'boolean',
  'select',
  'json',
  'text',
  'color'
])
const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype'])

function identity(value: unknown, path: string): string {
  const reason = validateModuleIdentity(value, path)
  if (reason) throw new TypeError(reason)
  return value as string
}

function containsControlCharacter(value: string): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0
    if (codePoint <= 31 || codePoint === 127) return true
  }
  return false
}

function text(value: unknown, path: string, maximum: number, allowEmpty = false): string {
  if (typeof value !== 'string') throw new TypeError(`${path} must be a string`)
  if (value.length > maximum) {
    throw new TypeError(`${path} may not exceed ${maximum} characters`)
  }
  const normalized = value.normalize('NFC').trim()
  if ((!allowEmpty && normalized.length === 0) || normalized.length > maximum) {
    throw new TypeError(
      `${path} must contain between ${allowEmpty ? 0 : 1} and ${maximum} characters`
    )
  }
  if (containsControlCharacter(normalized)) {
    throw new TypeError(`${path} must not contain control characters`)
  }
  return normalized
}

function finiteNumber(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new TypeError(`${path} must be a finite number`)
  }
  return value
}

function positiveInteger(value: unknown, path: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) {
    throw new TypeError(`${path} must be a positive safe integer`)
  }
  return value as number
}

function jsonConfig(value: unknown, path: string): JsonObject {
  const result = validateModuleInstance({
    version: 1,
    pluginId: 'manifest',
    moduleType: 'config',
    configVersion: 1,
    config: value
  })
  if (!result.ok) throw new TypeError(`${path} is invalid: ${result.reason}`)
  return result.value.config
}

function propertyPath(value: unknown, path: string): (string | number)[] {
  const segments = array(value, path, PLUGIN_MANIFEST_LIMITS.maxFieldPathDepth)
  if (segments.length === 0) throw new TypeError(`${path} must not be empty`)
  return segments.map((segment, index) => {
    if (typeof segment === 'number') {
      if (!Number.isSafeInteger(segment) || segment < 0) {
        throw new TypeError(`${path}[${index}] must be a non-negative safe integer`)
      }
      return segment
    }
    if (
      typeof segment !== 'string' ||
      segment.length === 0 ||
      segment.length > 256 ||
      segment.normalize('NFC') !== segment ||
      containsControlCharacter(segment) ||
      UNSAFE_KEYS.has(segment)
    ) {
      throw new TypeError(`${path}[${index}] must be a safe property key`)
    }
    return segment
  })
}

function field(value: unknown, path: string): DeclarativeModuleFieldV1 {
  const required = new Set(['path', 'kind', 'label'])
  const source = record(value, path, FIELD_KEYS, required)
  if (typeof source.kind !== 'string' || !FIELD_KINDS.has(source.kind as ModulePropertyFieldKind)) {
    throw new TypeError(`${path}.kind is not supported`)
  }
  const kind = source.kind as ModulePropertyFieldKind
  const parsed: DeclarativeModuleFieldV1 = {
    path: propertyPath(source.path, `${path}.path`),
    kind,
    label: text(source.label, `${path}.label`, PLUGIN_MANIFEST_LIMITS.maxNameLength)
  }
  for (const key of ['min', 'max', 'step'] as const) {
    if (Object.hasOwn(source, key)) parsed[key] = finiteNumber(source[key], `${path}.${key}`)
  }
  if (
    kind !== 'number' &&
    (parsed.min !== undefined || parsed.max !== undefined || parsed.step !== undefined)
  ) {
    throw new TypeError(`${path} numeric bounds are only valid for number fields`)
  }
  if (parsed.min !== undefined && parsed.max !== undefined && parsed.min > parsed.max) {
    throw new TypeError(`${path}.min may not exceed ${path}.max`)
  }
  if (parsed.step !== undefined && parsed.step <= 0) {
    throw new TypeError(`${path}.step must be greater than zero`)
  }
  if (Object.hasOwn(source, 'options')) {
    const options = array(
      source.options,
      `${path}.options`,
      PLUGIN_MANIFEST_LIMITS.maxOptionsPerField
    ).map((option, index) =>
      text(option, `${path}.options[${index}]`, PLUGIN_MANIFEST_LIMITS.maxNameLength)
    )
    if (kind !== 'select') throw new TypeError(`${path}.options are only valid for select fields`)
    if (options.length === 0 || new Set(options).size !== options.length) {
      throw new TypeError(`${path}.options must contain unique choices`)
    }
    parsed.options = options
  } else if (kind === 'select') {
    throw new TypeError(`${path}.options are required for select fields`)
  }
  return parsed
}

function resolvePath(config: JsonObject, path: readonly (string | number)[]): unknown {
  let current: unknown = config
  for (const segment of path) {
    if (typeof segment === 'number') {
      if (!Array.isArray(current) || !Object.hasOwn(current, segment)) return undefined
    } else if (
      current === null ||
      typeof current !== 'object' ||
      Array.isArray(current) ||
      !Object.hasOwn(current, segment)
    ) {
      return undefined
    }
    current = (current as Record<string | number, unknown>)[segment]
  }
  return current
}

function validateFieldDefault(
  value: unknown,
  parsedField: DeclarativeModuleFieldV1,
  path: string
): void {
  if (value === undefined) throw new TypeError(`${path}.path does not exist in defaultConfig`)
  if (parsedField.kind === 'number') {
    if (typeof value !== 'number') {
      throw new TypeError(`${path}.path must resolve to a number`)
    }
    if (
      (parsedField.min !== undefined && value < parsedField.min) ||
      (parsedField.max !== undefined && value > parsedField.max)
    ) {
      throw new TypeError(`${path}.path resolves to a number outside its declared bounds`)
    }
  }
  if (parsedField.kind === 'boolean' && typeof value !== 'boolean') {
    throw new TypeError(`${path}.path must resolve to a boolean`)
  }
  if ((parsedField.kind === 'text' || parsedField.kind === 'color') && typeof value !== 'string') {
    throw new TypeError(`${path}.path must resolve to a string`)
  }
  if (
    parsedField.kind === 'select' &&
    (typeof value !== 'string' || !parsedField.options?.includes(value))
  ) {
    throw new TypeError(`${path}.path must resolve to one of its declared options`)
  }
}

function contributionMetadata(source: Record<string, unknown>, path: string) {
  return {
    name: text(source.name, `${path}.name`, PLUGIN_MANIFEST_LIMITS.maxNameLength),
    description: text(
      source.description,
      `${path}.description`,
      PLUGIN_MANIFEST_LIMITS.maxDescriptionLength,
      true
    ),
    adapterId: identity(source.adapterId, `${path}.adapterId`)
  }
}

function moduleContribution(value: unknown, index: number): DeclarativeModuleContributionV1 {
  const path = `manifest.contributions.modules[${index}]`
  const source = record(value, path, MODULE_KEYS)
  const size = record(source.defaultSize, `${path}.defaultSize`, SIZE_KEYS)
  const width = finiteNumber(size.width, `${path}.defaultSize.width`)
  const height = finiteNumber(size.height, `${path}.defaultSize.height`)
  if (
    width <= 0 ||
    height <= 0 ||
    width > PLUGIN_MANIFEST_LIMITS.maxDimension ||
    height > PLUGIN_MANIFEST_LIMITS.maxDimension
  ) {
    throw new TypeError(`${path}.defaultSize must contain positive bounded dimensions`)
  }
  const defaultConfig = jsonConfig(source.defaultConfig, `${path}.defaultConfig`)
  const fields = array(
    source.fields,
    `${path}.fields`,
    PLUGIN_MANIFEST_LIMITS.maxFieldsPerModule
  ).map((entry, fieldIndex) => field(entry, `${path}.fields[${fieldIndex}]`))
  const fieldKeys = fields.map((entry) => JSON.stringify(entry.path))
  if (new Set(fieldKeys).size !== fieldKeys.length) {
    throw new TypeError(`${path}.fields contains duplicate property paths`)
  }
  fields.forEach((entry, fieldIndex) =>
    validateFieldDefault(
      resolvePath(defaultConfig, entry.path),
      entry,
      `${path}.fields[${fieldIndex}]`
    )
  )
  return {
    moduleType: identity(source.moduleType, `${path}.moduleType`),
    ...contributionMetadata(source, path),
    configVersion: positiveInteger(source.configVersion, `${path}.configVersion`),
    defaultSize: { width, height },
    defaultConfig,
    fields
  }
}

function commandContribution(value: unknown, index: number): DeclarativeCommandContributionV1 {
  const path = `manifest.contributions.commands[${index}]`
  const source = record(value, path, COMMAND_KEYS)
  return {
    commandId: identity(source.commandId, `${path}.commandId`),
    ...contributionMetadata(source, path)
  }
}

function fileExtension(value: unknown, path: string): string {
  const extension = text(value, path, PLUGIN_MANIFEST_LIMITS.maxFileExtensionLength)
  if (!/^\.[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$/.test(extension)) {
    throw new TypeError(`${path} must be a safe file extension beginning with a dot`)
  }
  return extension
}

function exporterContribution(value: unknown, index: number): DeclarativeExporterContributionV1 {
  const path = `manifest.contributions.exporters[${index}]`
  const source = record(value, path, EXPORTER_KEYS)
  return {
    exporterId: identity(source.exporterId, `${path}.exporterId`),
    ...contributionMetadata(source, path),
    fileExtension: fileExtension(source.fileExtension, `${path}.fileExtension`)
  }
}

function publisher(value: unknown): PluginManifestPublisherV1 {
  const source = record(value, 'manifest.publisher', PUBLISHER_KEYS)
  return {
    id: identity(source.id, 'manifest.publisher.id'),
    name: text(source.name, 'manifest.publisher.name', PLUGIN_MANIFEST_LIMITS.maxNameLength),
    keyId: identity(source.keyId, 'manifest.publisher.keyId')
  }
}

function parsePayloadRecord(source: Record<string, unknown>): PluginManifestPayloadV1 {
  if (source.format !== PLUGIN_MANIFEST_FORMAT) {
    throw new TypeError('manifest.format is not a supported plugin manifest format')
  }
  if (source.schemaVersion !== PLUGIN_MANIFEST_SCHEMA_VERSION) {
    throw new TypeError('manifest.schemaVersion is not supported')
  }
  const pluginSource = record(source.plugin, 'manifest.plugin', PLUGIN_KEYS)
  const plugin = {
    id: identity(pluginSource.id, 'manifest.plugin.id'),
    name: text(pluginSource.name, 'manifest.plugin.name', PLUGIN_MANIFEST_LIMITS.maxNameLength),
    version: parseStableSemver(pluginSource.version, 'manifest.plugin.version')
  }
  const capabilities = array(source.capabilities, 'manifest.capabilities', 0)
  if (capabilities.length !== 0) {
    throw new TypeError('manifest.capabilities must be empty for schema version 1')
  }
  const contributionSource = record(
    source.contributions,
    'manifest.contributions',
    CONTRIBUTIONS_KEYS,
    REQUIRED_CONTRIBUTIONS_KEYS
  )
  const modules = array(
    contributionSource.modules,
    'manifest.contributions.modules',
    PLUGIN_MANIFEST_LIMITS.maxModules
  ).map(moduleContribution)
  if (new Set(modules.map((entry) => entry.moduleType)).size !== modules.length) {
    throw new TypeError('manifest.contributions.modules contains duplicate module types')
  }
  const commands = Object.hasOwn(contributionSource, 'commands')
    ? array(
        contributionSource.commands,
        'manifest.contributions.commands',
        PLUGIN_MANIFEST_LIMITS.maxCommands
      ).map(commandContribution)
    : undefined
  if (commands && new Set(commands.map((entry) => entry.commandId)).size !== commands.length) {
    throw new TypeError('manifest.contributions.commands contains duplicate command IDs')
  }
  const exporters = Object.hasOwn(contributionSource, 'exporters')
    ? array(
        contributionSource.exporters,
        'manifest.contributions.exporters',
        PLUGIN_MANIFEST_LIMITS.maxExporters
      ).map(exporterContribution)
    : undefined
  if (exporters && new Set(exporters.map((entry) => entry.exporterId)).size !== exporters.length) {
    throw new TypeError('manifest.contributions.exporters contains duplicate exporter IDs')
  }
  if (modules.length + (commands?.length ?? 0) + (exporters?.length ?? 0) === 0) {
    throw new TypeError('manifest must declare at least one contribution')
  }
  return {
    format: PLUGIN_MANIFEST_FORMAT,
    schemaVersion: PLUGIN_MANIFEST_SCHEMA_VERSION,
    plugin,
    publisher: publisher(source.publisher),
    engineRange: normalizeStableEngineRange(source.engineRange, 'manifest.engineRange', {
      maxLength: PLUGIN_MANIFEST_LIMITS.maxEngineRangeLength
    }),
    capabilities: [],
    contributions: {
      modules,
      ...(commands ? { commands } : {}),
      ...(exporters ? { exporters } : {})
    }
  }
}

function assertManifestSize(value: unknown): void {
  const size = new TextEncoder().encode(JSON.stringify(canonicalManifestValue(value))).byteLength
  if (size > PLUGIN_MANIFEST_LIMITS.maxJsonBytes) {
    throw new TypeError(`manifest may not exceed ${PLUGIN_MANIFEST_LIMITS.maxJsonBytes} bytes`)
  }
}

function integrity(value: unknown, publisherKeyId: string): PluginManifestIntegrityV1 {
  return parseSignedManifestIntegrity(value, 'manifest.integrity', publisherKeyId)
}

export function parsePluginManifestPayload(value: unknown): PluginManifestPayloadV1 {
  const payload = parsePayloadRecord(record(value, 'manifest', PAYLOAD_KEYS))
  assertManifestSize(payload)
  return payload
}

export function parsePluginManifest(value: unknown): PluginManifestV1 {
  const source = record(value, 'manifest', MANIFEST_KEYS)
  const payloadSource = { ...source }
  Reflect.deleteProperty(payloadSource, 'integrity')
  const payload = parsePayloadRecord(payloadSource)
  const manifest = { ...payload, integrity: integrity(source.integrity, payload.publisher.keyId) }
  assertManifestSize(manifest)
  return manifest
}

export function validatePluginManifest(value: unknown): PluginManifestValidationResult {
  try {
    return { ok: true, value: parsePluginManifest(value) }
  } catch (error) {
    if (error instanceof TypeError) return { ok: false, reason: error.message }
    throw error
  }
}

export function serializePluginManifest(value: unknown): string {
  return `${JSON.stringify(canonicalManifestValue(parsePluginManifest(value)), null, 2)}\n`
}
