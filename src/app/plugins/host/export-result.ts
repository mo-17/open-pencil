import type { JSONObject } from '@open-pencil/scene-graph/primitives'

import type { AppPluginExporterExecutionResult } from './exporter-types'

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
    code: code.value.slice(0, 256),
    message: message.value.replace(/\s+/g, ' ').trim().slice(0, 2_048),
    ...(nodeId && 'value' in nodeId ? { nodeId: nodeId.value.slice(0, 256) } : {})
  }
}

export function createPluginExportResultData(result: AppPluginExporterExecutionResult): JSONObject {
  const warnings = result.warnings
    .slice(0, 100)
    .flatMap((warning) => exportWarningData(warning) ?? [])
  return {
    kind: 'plugin-export',
    fileName: result.fileName.slice(0, 512),
    fileCount: result.fileCount,
    warningCount: result.warnings.length,
    warnings,
    warningsTruncated: result.warnings.length > warnings.length
  }
}
