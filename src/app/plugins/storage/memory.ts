import type { AppPluginStateStorage } from './types'

function pluginIdOf(value: unknown): string {
  if (
    typeof value !== 'object' ||
    value === null ||
    Array.isArray(value) ||
    typeof Reflect.get(value, 'pluginId') !== 'string'
  ) {
    throw new TypeError('Stored plugin state is missing pluginId')
  }
  return Reflect.get(value, 'pluginId') as string
}

export function createMemoryAppPluginStateStorage(
  initial: readonly unknown[] = []
): AppPluginStateStorage {
  const records = new Map(initial.map((value) => [pluginIdOf(value), structuredClone(value)]))

  return {
    async list() {
      return [...records.values()].map((value) => structuredClone(value))
    },
    async put(record) {
      records.set(pluginIdOf(record), structuredClone(record))
    },
    async delete(pluginId) {
      records.delete(pluginId)
    }
  }
}
