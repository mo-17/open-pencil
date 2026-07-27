import type {
  SessionConfigOption,
  SessionConfigSelectGroup,
  SessionConfigSelectOption
} from '@agentclientprotocol/sdk'

export type ACPConfigCategory = 'model' | 'thought_level'

export interface ACPConfigOptionGroup {
  label?: string
  items: Array<{
    value: string
    label: string
    description?: string | null
  }>
}

const FALLBACK_CONFIG_IDS: Record<ACPConfigCategory, string[]> = {
  model: ['model'],
  thought_level: ['reasoning_effort', 'reasoning']
}

function isSelectGroup(
  value: SessionConfigSelectOption | SessionConfigSelectGroup
): value is SessionConfigSelectGroup {
  return 'group' in value && 'options' in value
}

export function findACPConfigOption(
  options: readonly SessionConfigOption[],
  category: ACPConfigCategory
): SessionConfigOption | undefined {
  return (
    options.find((option) => option.category === category) ??
    options.find((option) => FALLBACK_CONFIG_IDS[category].includes(option.id))
  )
}

export function groupACPConfigOptions(option: SessionConfigOption): ACPConfigOptionGroup[] {
  const entries = option.options as Array<SessionConfigSelectOption | SessionConfigSelectGroup>
  const groups: ACPConfigOptionGroup[] = []
  const ungrouped: ACPConfigOptionGroup['items'] = []

  for (const entry of entries) {
    if (isSelectGroup(entry)) {
      groups.push({
        label: entry.name,
        items: entry.options.map((item) => ({
          value: item.value,
          label: item.name,
          description: item.description
        }))
      })
    } else {
      ungrouped.push({
        value: entry.value,
        label: entry.name,
        description: entry.description
      })
    }
  }

  if (ungrouped.length > 0) groups.unshift({ items: ungrouped })
  return groups
}

export function selectedACPConfigLabel(option: SessionConfigOption): string {
  for (const group of groupACPConfigOptions(option)) {
    const selected = group.items.find((item) => item.value === option.currentValue)
    if (selected) return selected.label
  }
  return option.currentValue
}
