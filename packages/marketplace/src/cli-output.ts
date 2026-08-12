import { entity, info, list, ok, props } from 'agentfmt'

interface MarketplaceOutputRecord {
  [key: string]: unknown
}

function outputRecord(value: unknown): value is MarketplaceOutputRecord {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function compactValue(value: unknown): unknown {
  if (Array.isArray(value)) return `${value.length} item${value.length === 1 ? '' : 's'}`
  if (outputRecord(value)) return JSON.stringify(value)
  return value
}

function outputDetails(value: MarketplaceOutputRecord): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, compactValue(entry)]))
}

function outputId(value: MarketplaceOutputRecord): string | undefined {
  for (const key of ['id', 'keyId', 'pluginId', 'submissionId', 'sequence']) {
    const candidate = value[key]
    if (typeof candidate === 'string' || typeof candidate === 'number') return String(candidate)
  }
  return undefined
}

function outputName(value: MarketplaceOutputRecord, fallback: string): string {
  if (typeof value.displayName === 'string') return value.displayName
  if (typeof value.name === 'string') return value.name
  return fallback
}

function formattedOutput(value: unknown, label: string): string {
  if (Array.isArray(value)) {
    if (value.length === 0) return info(`No ${label.toLowerCase()}`)
    return list(
      value.map((entry, index) => {
        if (!outputRecord(entry)) return { header: entity('item', String(entry), String(index)) }
        return {
          header: entity(label, outputName(entry, label), outputId(entry)),
          details: outputDetails(entry)
        }
      })
    )
  }
  if (outputRecord(value)) return `${ok(label)}\n${props(outputDetails(value))}`
  return ok(`${label}: ${String(value)}`)
}

export function printMarketplaceCLIOutput(
  json: boolean,
  value: unknown,
  label = 'Marketplace operation'
): void {
  const output = json ? JSON.stringify(value, null, 2) : formattedOutput(value, label)
  process.stdout.write(`${output}\n`)
}
