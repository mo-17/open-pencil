import type { UIMessage } from 'ai'

import type { ToolDebugLog } from '@open-pencil/core/tools'
import type { JSONObject } from '@open-pencil/scene-graph/primitives'

import { formatACPDiagnostics, getACPDiagnostics } from '@/app/ai/acp/diagnostics'
import { diagnostics } from '@/app/diagnostics'

export function formatTokenUsage(): string {
  const acp = getACPDiagnostics()
  if (acp.active) return formatACPDiagnostics(acp)

  const events = diagnostics.recent().filter((event) => event.name === 'model.step.completed')
  if (events.length === 0) return '  (no usage data — provider may not report it)'

  let totalInput = 0
  let totalOutput = 0
  let totalCacheRead = 0
  let totalCacheWrite = 0
  const lines = events.map((event, index) => {
    const input = event.attributes.inputTokens
    const output = event.attributes.outputTokens
    const cacheRead = event.attributes.cacheReadTokens
    const cacheWrite = event.attributes.cacheWriteTokens
    if (typeof input === 'number') totalInput += input
    if (typeof output === 'number') totalOutput += output
    if (typeof cacheRead === 'number') totalCacheRead += cacheRead
    if (typeof cacheWrite === 'number') totalCacheWrite += cacheWrite
    return `  Step ${events.length - index}: in=${input ?? 'not reported'} out=${output ?? 'not reported'} cache_read=${cacheRead ?? 'not reported'} cache_write=${cacheWrite ?? 'not reported'}`
  })
  const cacheHitRate = totalInput > 0 ? ((totalCacheRead / totalInput) * 100).toFixed(1) : '0.0'
  lines.unshift(
    `Total: in=${totalInput} out=${totalOutput} cache_read=${totalCacheRead} cache_write=${totalCacheWrite}`,
    `Cache hit rate: ${cacheHitRate}%`,
    `Steps: ${events.length}`
  )
  return lines.join('\n')
}

export function formatDiagnostics(log: ToolDebugLog): string {
  const sections: string[] = []

  sections.push(`Direct/local tool executions: ${log.entries.length}`)
  sections.push(`Direct/local total result payload: ${(log.totalResultBytes / 1024).toFixed(1)} KB`)

  const mutatingCalls = log.entries.filter((e) => e.mutates)
  const errorCalls = log.entries.filter((e) => e.error)
  sections.push(`Direct/local mutating calls: ${mutatingCalls.length}`)
  if (errorCalls.length > 0) {
    sections.push(`Direct/local errors: ${errorCalls.length}`)
  }

  if (log.duplicates.length > 0) {
    sections.push('')
    sections.push('⚠ DUPLICATE CALLS (potential loops):')
    for (const dup of log.duplicates) {
      sections.push(`  ${dup.tool} ×${dup.count} — args: ${JSON.stringify(dup.args)}`)
    }
  }

  if (log.noopMutations.length > 0) {
    sections.push('')
    sections.push('⚠ NO-OP MUTATIONS (tool succeeded but node unchanged):')
    for (const entry of log.noopMutations) {
      sections.push(`  ${entry.tool} on ${String(entry.args.id)}`)
      sections.push(`    unchanged: ${entry.unchangedProps?.join(', ')}`)
      if (entry.nodeBefore && entry.unchangedProps) {
        for (const prop of entry.unchangedProps) {
          sections.push(`    ${prop} = ${JSON.stringify(entry.nodeBefore[prop])}`)
        }
      }
    }
  }

  const largeResults = log.entries
    .map((e, i) => ({ index: i, tool: e.tool, size: JSON.stringify(e.result ?? '').length }))
    .filter((r) => r.size > 2048)
    .sort((a, b) => b.size - a.size)
    .slice(0, 5)

  if (largeResults.length > 0) {
    sections.push('')
    sections.push('⚠ LARGE RESULTS (potential token waste):')
    for (const r of largeResults) {
      sections.push(`  #${r.index + 1} ${r.tool}: ${(r.size / 1024).toFixed(1)} KB`)
    }
  }

  return sections.join('\n')
}

function formatToolPart(part: Record<string, unknown>): string {
  const inv = part.toolInvocation as JSONObject | undefined
  if (inv) {
    const lines = [`  [tool] ${String(inv.toolName)} (${String(inv.state)})`]
    if (inv.args) lines.push(`    args: ${JSON.stringify(inv.args)}`)
    if (inv.result !== undefined) lines.push(`    result: ${JSON.stringify(inv.result)}`)
    return lines.join('\n')
  }

  const name = (typeof part.type === 'string' ? part.type : 'unknown').replace(/^tool-/, '')
  const state = typeof part.state === 'string' ? part.state : '?'
  const lines = [`  [tool] ${name} (${state})`]
  if (part.input) lines.push(`    input: ${JSON.stringify(part.input)}`)
  if (part.output !== undefined) lines.push(`    output: ${JSON.stringify(part.output)}`)
  if (part.errorText) lines.push(`    error: ${part.errorText as string}`)
  return lines.join('\n')
}

export function formatConversationMessage(message: UIMessage): string {
  const header = `--- ${message.role.toUpperCase()} (${message.id}) ---`
  const parts: string[] = []

  for (const part of message.parts) {
    const p = part as JSONObject
    if (p.type === 'text') {
      parts.push(`  ${p.text as string}`)
    } else if (p.type === 'file') {
      const filename = typeof p.filename === 'string' && p.filename ? p.filename : 'attachment'
      const mediaType = typeof p.mediaType === 'string' ? p.mediaType : 'unknown media type'
      parts.push(`  [file] ${filename} (${mediaType}; payload omitted)`)
    } else if (p.type === 'reasoning') {
      let reasoning = ''
      if (typeof p.text === 'string') reasoning = p.text
      else if (typeof p.content === 'string') reasoning = p.content
      parts.push(`  [reasoning] ${reasoning}`)
    } else if (
      p.type === 'tool-invocation' ||
      p.toolInvocation ||
      (typeof p.type === 'string' && p.type.startsWith('tool-'))
    ) {
      parts.push(formatToolPart(p))
    } else {
      parts.push(`  [${typeof p.type === 'string' ? p.type : 'unknown'}] ${JSON.stringify(p)}`)
    }
  }

  return `${header}\n${parts.join('\n')}`
}
