export type DisposableStorageRuntimeEntry = Readonly<{
  oauth: Readonly<{ dispose(): void }>
}>

export function createStorageRuntimeRegistry<
  Manager extends object,
  Entry extends DisposableStorageRuntimeEntry
>() {
  let entriesByManager = new WeakMap<Manager, Map<string, Entry>>()
  const liveEntries = new Set<Entry>()

  return Object.freeze({
    getOrCreate(
      manager: Manager,
      profileId: string,
      matches: (entry: Entry) => boolean,
      create: () => Entry
    ): Entry {
      let entries = entriesByManager.get(manager)
      if (!entries) {
        entries = new Map()
        entriesByManager.set(manager, entries)
      }
      const existing = entries.get(profileId)
      if (existing && matches(existing)) return existing

      if (existing) {
        entries.delete(profileId)
        liveEntries.delete(existing)
        existing.oauth.dispose()
      }

      const entry = create()
      entries.set(profileId, entry)
      liveEntries.add(entry)
      return entry
    },

    dispose(manager: Manager, profileId: string): void {
      const entries = entriesByManager.get(manager)
      const entry = entries?.get(profileId)
      if (!entry) return
      entry.oauth.dispose()
      entries?.delete(profileId)
      liveEntries.delete(entry)
    },

    reset(): void {
      for (const entry of liveEntries) entry.oauth.dispose()
      liveEntries.clear()
      entriesByManager = new WeakMap()
    }
  })
}
