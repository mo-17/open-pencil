/**
 * Phase 3 §4.5 — docState collaboration conflict detection.
 *
 * Lowcode collection fields (page `state`, `lowcodeDocumentState`) are stored
 * in Yjs as one opaque JSON blob per node Y.Map key (§4.1), so Yjs merges them
 * at field granularity only — concurrent edits to the same field are whole-field
 * last-write-wins and one peer's change is silently lost (probe-confirmed
 * 2026-05-30). We can't auto-merge without changing the storage encoding (that's
 * the deferred α slice), so §4.5 (γ) surfaces the conflict instead.
 *
 * This is the passive detector: when a remote update to one of these array
 * collections arrives, does applying it (which overwrites the whole field) drop
 * information the local user currently has? That is true exactly when the local
 * value is NOT a subset of the remote one — some local entry is missing from, or
 * differs in, the remote. A pure sequential append (local ⊆ remote) or an
 * identical value loses nothing and must not warn.
 */

/** Which array collection a passive conflict was detected on (drives the toast
 *  label). `supabaseConfig` is intentionally excluded — it has no entry
 *  granularity, so it relies on the active presence banner only (§4.5 dec d). */
export type DocStateConflictKind = 'state' | 'docState'

type Entry = Record<string, unknown>

function isEntryArray(value: unknown): value is Entry[] {
  return Array.isArray(value) && value.every((e) => typeof e === 'object' && e !== null)
}

/** Stable key for an entry: prefer `id`, fall back to `name`. */
function entryKey(entry: Entry, index: number): string {
  const id = entry.id
  if (typeof id === 'string' && id) return `id:${id}`
  const name = entry.name
  if (typeof name === 'string' && name) return `name:${name}`
  return `idx:${index}`
}

/**
 * True when applying `remote` over `local` (whole-field replace) would lose
 * local information — i.e. local is not a subset (by entry key + value) of
 * remote. Used for the two array collections (`state` / `lowcodeDocumentState`);
 * non-array fields return false (no reliable passive signal — see §4.5 dec d).
 */
export function docStateApplyLosesLocal(local: unknown, remote: unknown): boolean {
  if (!isEntryArray(local) || !isEntryArray(remote)) return false

  const remoteByKey = new Map<string, string>()
  remote.forEach((entry, i) => remoteByKey.set(entryKey(entry, i), JSON.stringify(entry)))

  return local.some((entry, i) => {
    const key = entryKey(entry, i)
    const remoteSerialized = remoteByKey.get(key)
    // Missing from remote → applying remote drops it; present but different →
    // applying remote overwrites the local edit. Either way local loses info.
    return remoteSerialized === undefined || remoteSerialized !== JSON.stringify(entry)
  })
}
