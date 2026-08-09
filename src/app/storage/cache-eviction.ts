import {
  getLocalCanvasStore,
  localCanvasBinding,
  localCanvasKey,
  type LocalCanvasLocator
} from '@/app/storage/local-store'

/** Keep at most this much cached fig data on device (metas/thumbs are tiny and stay). */
export const FIG_CACHE_BUDGET_BYTES = 500 * 1024 * 1024

/**
 * Evict least-recently-opened fig blobs until the cache fits the budget.
 * Only fully synced, non-tombstoned, not-currently-open canvases qualify —
 * evicting never loses data, it just forces a re-download on next open.
 * Returns the number of evicted figs.
 */
export async function evictLocalFigCache(
  excludeKeys: ReadonlySet<string> = new Set(),
  budgetBytes = FIG_CACHE_BUDGET_BYTES
): Promise<number> {
  const local = getLocalCanvasStore()
  const metas = await local.listMetas(true)

  let totalBytes = 0
  const candidates: { binding: LocalCanvasLocator; size: number; lastUsed: string }[] = []
  for (const m of metas) {
    if (!m.hasFig) continue
    const binding = localCanvasBinding(m)
    const key = localCanvasKey(binding)
    let size = m.figSize
    if (size == null) {
      // Legacy row from before size tracking — measure once and persist
      const fig = await local.readFig(binding)
      size = fig?.byteLength ?? 0
      await local.updateMeta(binding, { figSize: size })
    }
    totalBytes += size
    // Raw document IDs remain accepted while older S3 callers migrate to full keys.
    if (
      m.tombstoned ||
      m.syncStatus !== 'synced' ||
      excludeKeys.has(key) ||
      excludeKeys.has(m.id)
    ) {
      continue
    }
    candidates.push({
      binding,
      size,
      lastUsed: m.lastOpenedAt ?? m.lastSyncedAt ?? m.updatedAt
    })
  }

  if (totalBytes <= budgetBytes) return 0

  candidates.sort((a, b) => a.lastUsed.localeCompare(b.lastUsed))
  let evicted = 0
  for (const candidate of candidates) {
    if (totalBytes <= budgetBytes) break
    await local.clearFig(candidate.binding)
    totalBytes -= candidate.size
    evicted += 1
  }
  if (evicted > 0) console.warn(`[Storage] Evicted ${evicted} cached fig(s) to fit cache budget`)
  return evicted
}
