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
  let revision = 0

  return {
    async revision() {
      return revision
    },
    async list() {
      return [...records.values()].map((value) => structuredClone(value))
    },
    async put(record) {
      if (revision === Number.MAX_SAFE_INTEGER) {
        throw new Error('Plugin state storage revision is exhausted')
      }
      records.set(pluginIdOf(record), structuredClone(record))
      revision += 1
    },
    async delete(pluginId) {
      if (revision === Number.MAX_SAFE_INTEGER) {
        throw new Error('Plugin state storage revision is exhausted')
      }
      records.delete(pluginId)
      revision += 1
    }
  }
}
