import type {
  NewSessionResponse,
  PromptResponse,
  SessionConfigOption,
  SessionUpdate,
  Usage,
  UsageUpdate
} from '@agentclientprotocol/sdk'

import { findACPConfigOption } from './config-options'

export interface ACPDiagnosticsSnapshot {
  active: boolean
  agentName?: string
  modelId?: string
  thoughtLevel?: string
  usage?: Usage
  context?: Pick<UsageUpdate, 'used' | 'size' | 'cost'>
}

let snapshot: ACPDiagnosticsSnapshot = { active: false }

function modelIdFrom(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const modelId = value.trim()
  if (
    !modelId ||
    modelId.length > 256 ||
    modelId.includes('\0') ||
    modelId.includes('\r') ||
    modelId.includes('\n')
  ) {
    return undefined
  }
  return modelId
}

function normalizeModelId(modelId: string, thoughtLevel: string | undefined): string {
  if (!thoughtLevel) return modelId

  const legacySuffix = modelId.match(/\[([^\]]+)\]$/)
  if (legacySuffix?.[1].trim().toLowerCase() !== thoughtLevel.trim().toLowerCase()) {
    return modelId
  }

  return modelId.slice(0, legacySuffix.index).trim() || modelId
}

function promptModelId(result: PromptResponse): string | undefined {
  const quota = result._meta?.quota
  if (!quota || typeof quota !== 'object' || Array.isArray(quota) || !('model_usage' in quota)) {
    return undefined
  }

  const modelUsage = quota.model_usage
  if (!Array.isArray(modelUsage)) return undefined

  const modelIds = new Set<string>()
  for (const usage of modelUsage) {
    if (!usage || typeof usage !== 'object' || Array.isArray(usage) || !('model' in usage)) continue
    const modelId = modelIdFrom(usage.model)
    if (modelId) modelIds.add(modelId)
  }

  // A multi-model turn cannot be represented by the snapshot's singular model field.
  return modelIds.size === 1 ? modelIds.values().next().value : undefined
}

function selectedValue(
  options: SessionConfigOption[] | null | undefined,
  category: 'model' | 'thought_level'
): string | undefined {
  return options ? findACPConfigOption(options, category)?.currentValue : undefined
}

export function recordACPConfigOptions(options: SessionConfigOption[] | null | undefined): void {
  const selectedModelId = modelIdFrom(selectedValue(options, 'model'))
  const thoughtLevel = selectedValue(options, 'thought_level')
  const modelId = selectedModelId ? normalizeModelId(selectedModelId, thoughtLevel) : undefined
  const { modelId: _previousModelId, thoughtLevel: _previousThoughtLevel, ...rest } = snapshot
  snapshot = {
    ...rest,
    ...(modelId ? { modelId } : {}),
    ...(thoughtLevel ? { thoughtLevel } : {})
  }
}

export function beginACPDiagnostics(agentName: string): void {
  snapshot = { active: true, agentName }
}

export function recordACPNewSession(result: NewSessionResponse): void {
  const configModelId = modelIdFrom(selectedValue(result.configOptions, 'model'))
  recordACPConfigOptions(result.configOptions)
  const modelId = modelIdFrom(result.models?.currentModelId)
  if (!configModelId && modelId) {
    snapshot = { ...snapshot, modelId: normalizeModelId(modelId, snapshot.thoughtLevel) }
  }
}

export function recordACPPrompt(result: PromptResponse): void {
  const reportedModelId = promptModelId(result)
  const modelId = reportedModelId
    ? normalizeModelId(reportedModelId, snapshot.thoughtLevel)
    : snapshot.modelId
  // ACP implementations differ on whether usage is per-turn or cumulative. Keep the latest
  // protocol snapshot instead of producing a misleading sum.
  snapshot = {
    ...snapshot,
    active: true,
    ...(modelId ? { modelId } : {}),
    ...(result.usage ? { usage: { ...result.usage } } : {})
  }
}

export function recordACPSessionUpdate(update: SessionUpdate): void {
  if (update.sessionUpdate === 'usage_update') {
    snapshot = {
      ...snapshot,
      active: true,
      context: {
        used: update.used,
        size: update.size,
        ...(update.cost ? { cost: { ...update.cost } } : {})
      }
    }
  } else if (update.sessionUpdate === 'config_option_update') {
    recordACPConfigOptions(update.configOptions)
  }
}

export function getACPDiagnostics(): Readonly<ACPDiagnosticsSnapshot> {
  return snapshot
}

export function formatACPDiagnostics(value: Readonly<ACPDiagnosticsSnapshot>): string {
  const lines = [`Provider: ACP${value.agentName ? ` (${value.agentName})` : ''}`]

  lines.push(`Model: ${value.modelId ?? '(agent did not report model)'}`)
  if (value.thoughtLevel) lines.push(`Reasoning level: ${value.thoughtLevel}`)

  if (value.usage) {
    const cacheRead = value.usage.cachedReadTokens ?? 0
    const cacheWrite = value.usage.cachedWriteTokens ?? 0
    const thought = value.usage.thoughtTokens ?? 0
    lines.push(
      `Latest token snapshot (ACP experimental): in=${value.usage.inputTokens} out=${value.usage.outputTokens} reasoning=${thought} total=${value.usage.totalTokens}`,
      `Cache: read=${cacheRead} write=${cacheWrite}`
    )
  } else {
    lines.push('Token usage: (agent did not report it)')
  }

  if (value.context) {
    const percent = value.context.size > 0 ? (value.context.used / value.context.size) * 100 : 0
    lines.push(
      `Context window: ${value.context.used}/${value.context.size} tokens (${percent.toFixed(1)}%)`
    )
    if (value.context.cost) {
      lines.push(
        `Session cost reported by agent: ${value.context.cost.amount} ${value.context.cost.currency}`
      )
    }
  }

  return lines.join('\n')
}

export function formatACPRuntimeContext(value: Readonly<ACPDiagnosticsSnapshot>): string {
  if (!value.active || !value.modelId) return ''

  return [
    '# ACP runtime metadata',
    `The host application reports the current agent as ${JSON.stringify(value.agentName ?? 'unknown')}.`,
    `The current model ID is ${JSON.stringify(value.modelId)}.`,
    ...(value.thoughtLevel
      ? [`The current reasoning level is ${JSON.stringify(value.thoughtLevel)}.`]
      : []),
    'When asked about this session, report these host-provided values instead of guessing.'
  ].join('\n')
}

export function resetACPDiagnostics(): void {
  snapshot = { active: false }
}
