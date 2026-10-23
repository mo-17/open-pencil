import type { PluginContributionDataContractV2 } from '@open-pencil/plugin-contracts'
import type { JSONObject } from '@open-pencil/scene-graph/primitives'

import type { AppPluginExporterExecutionResult } from './exporter-types'

export const PLUGIN_EXPORT_RESULT_LIMITS = Object.freeze({
  maxBytes: 512 * 1024,
  maxWarnings: 100,
  maxFileNameLength: 512,
  maxWarningCodeLength: 256,
  maxWarningMessageLength: 2_048,
  maxWarningNodeIdLength: 256
})

export const PLUGIN_EXPORT_RESULT_CONTRACT: PluginContributionDataContractV2 = Object.freeze({
  schema: Object.freeze({
    type: 'object',
    properties: Object.freeze({
      kind: Object.freeze({ type: 'string', enum: Object.freeze(['plugin-export']) }),
      fileName: Object.freeze({
        type: 'string',
        maxLength: PLUGIN_EXPORT_RESULT_LIMITS.maxFileNameLength
      }),
      fileCount: Object.freeze({ type: 'integer', minimum: 0 }),
      warningCount: Object.freeze({ type: 'integer', minimum: 0 }),
      warnings: Object.freeze({
        type: 'array',
        maxItems: PLUGIN_EXPORT_RESULT_LIMITS.maxWarnings,
        items: Object.freeze({
          type: 'object',
          properties: Object.freeze({
            code: Object.freeze({
              type: 'string',
              maxLength: PLUGIN_EXPORT_RESULT_LIMITS.maxWarningCodeLength
            }),
            message: Object.freeze({
              type: 'string',
              maxLength: PLUGIN_EXPORT_RESULT_LIMITS.maxWarningMessageLength
            }),
            nodeId: Object.freeze({
              type: 'string',
              maxLength: PLUGIN_EXPORT_RESULT_LIMITS.maxWarningNodeIdLength
            })
          }),
          required: Object.freeze(['code', 'message']),
          additionalProperties: false,
          minProperties: 2,
          maxProperties: 3
        })
      }),
      warningsTruncated: Object.freeze({ type: 'boolean' })
    }),
    required: Object.freeze([
      'kind',
      'fileName',
      'fileCount',
      'warningCount',
      'warnings',
      'warningsTruncated'
    ]),
    additionalProperties: false,
    minProperties: 6,
    maxProperties: 6
  }),
  maxBytes: PLUGIN_EXPORT_RESULT_LIMITS.maxBytes
})

const encoder = new TextEncoder()

function exportWarningData(value: unknown): JSONObject | null {
  if (
    typeof value !== 'object' ||
    value === null ||
    Array.isArray(value) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value)) ||
    Object.getOwnPropertySymbols(value).length > 0
  ) {
    return null
  }
  const code = Object.getOwnPropertyDescriptor(value, 'code')
  const message = Object.getOwnPropertyDescriptor(value, 'message')
  const nodeId = Object.getOwnPropertyDescriptor(value, 'nodeId')
  if (
    !code ||
    !('value' in code) ||
    typeof code.value !== 'string' ||
    !message ||
    !('value' in message) ||
    typeof message.value !== 'string' ||
    (nodeId && (!('value' in nodeId) || typeof nodeId.value !== 'string'))
  ) {
    return null
  }
  return {
    code: code.value.slice(0, PLUGIN_EXPORT_RESULT_LIMITS.maxWarningCodeLength),
    message: message.value
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, PLUGIN_EXPORT_RESULT_LIMITS.maxWarningMessageLength),
    ...(nodeId && 'value' in nodeId
      ? { nodeId: nodeId.value.slice(0, PLUGIN_EXPORT_RESULT_LIMITS.maxWarningNodeIdLength) }
      : {})
  }
}

export function createPluginExportResultData(result: AppPluginExporterExecutionResult): JSONObject {
  const warnings: JSONObject[] = []
  const data = {
    kind: 'plugin-export',
    fileName: result.fileName.slice(0, PLUGIN_EXPORT_RESULT_LIMITS.maxFileNameLength),
    fileCount: result.fileCount,
    warningCount: result.warnings.length,
    warnings,
    warningsTruncated: false
  }
  let reportBytes = encoder.encode(JSON.stringify(data)).byteLength
  for (const candidate of result.warnings.slice(0, PLUGIN_EXPORT_RESULT_LIMITS.maxWarnings)) {
    const warning = exportWarningData(candidate)
    if (!warning) continue
    const additionalBytes =
      encoder.encode(JSON.stringify(warning)).byteLength + (warnings.length ? 1 : 0)
    if (reportBytes + additionalBytes > PLUGIN_EXPORT_RESULT_LIMITS.maxBytes) break
    warnings.push(warning)
    reportBytes += additionalBytes
  }
  data.warningsTruncated = result.warnings.length > warnings.length
  return data
}
