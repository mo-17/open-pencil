import { computed, onScopeDispose, ref, watchEffect } from 'vue'

import {
  fontCandidateCoverageText,
  fontFaceDemand,
  fontManager,
  fontResolver,
  requiredNodeFontFaces
} from '@open-pencil/core/text'
import type { SceneNode } from '@open-pencil/scene-graph'

export interface UseNodeFontStatusOptions {
  /** Requests a repaint after a pending face reaches a terminal resolver state. */
  onResolutionSettled?: () => void
}

/**
 * Returns pending and confirmed-missing font information for a text node getter.
 *
 * This is useful for typography panels and warnings that need to surface fonts
 * that are referenced by a node but not yet loaded in the current runtime.
 */
export function useNodeFontStatus(
  node: () => SceneNode | null | undefined,
  options: UseNodeFontStatusOptions = {}
) {
  const resolutionRevision = ref(0)
  let active = true
  const onResolutionSettled = () => {
    if (!active) return
    resolutionRevision.value++
    options.onResolutionSettled?.()
  }

  watchEffect(() => {
    void resolutionRevision.value
    const n = node()
    if (n?.type !== 'TEXT') return
    for (const { family, style } of requiredNodeFontFaces(n)) {
      if (fontManager.isLoaded(family)) continue
      const demand = fontFaceDemand(family, style, n.text)
      const state = fontResolver.state(demand).state
      if (state === 'idle' || state === 'loading') {
        void fontResolver.demandForNode(demand, n.id, onResolutionSettled)
      }
    }
  })

  onScopeDispose(() => {
    active = false
  })

  function retryMissingFonts(): Promise<void> {
    const n = node()
    if (n?.type !== 'TEXT') return Promise.resolve()

    const retries: Array<Promise<unknown>> = []
    for (const { family, style } of requiredNodeFontFaces(n)) {
      if (fontManager.isLoaded(family)) continue
      const demand = fontFaceDemand(family, style, n.text)
      const state = fontResolver.state(demand).state
      if (state === 'failed' || state === 'exhausted') {
        const remoteFaces = new Map(
          demand.candidates
            .filter((candidate) => candidate.source === 'remote')
            .map((candidate) => [`${candidate.family}\0${candidate.style}`, candidate] as const)
        )
        for (const candidate of remoteFaces.values()) {
          fontManager.clearFontLoadFailure(
            candidate.family,
            candidate.style,
            fontCandidateCoverageText(demand, candidate)
          )
        }
        fontResolver.reset(demand)
      }
      const retryState = fontResolver.state(demand).state
      if (retryState === 'idle' || retryState === 'loading') {
        retries.push(fontResolver.demandForNode(demand, n.id, onResolutionSettled))
      }
    }
    resolutionRevision.value++
    return Promise.all(retries).then(() => undefined)
  }

  const status = computed(() => {
    void resolutionRevision.value
    const n = node()
    if (n?.type !== 'TEXT') return { missing: [], pending: [] }

    const faces = requiredNodeFontFaces(n)
    const loadedFamilies = new Set(
      faces.filter(({ family }) => fontManager.isLoaded(family)).map(({ family }) => family)
    )
    const families = new Map<string, { pending: boolean; terminal: boolean }>()
    for (const { family, style } of faces) {
      if (loadedFamilies.has(family)) continue
      const familyStatus = families.get(family) ?? { pending: false, terminal: false }
      const state = fontResolver.state(fontFaceDemand(family, style, n.text)).state
      if (state === 'failed' || state === 'exhausted') familyStatus.terminal = true
      else if (state === 'idle' || state === 'loading') familyStatus.pending = true
      families.set(family, familyStatus)
    }

    const missing: string[] = []
    const pending: string[] = []
    for (const [family, familyStatus] of families) {
      if (familyStatus.pending) pending.push(family)
      else if (familyStatus.terminal) missing.push(family)
    }
    return { missing, pending }
  })

  const missingFonts = computed(() => status.value.missing)
  const pendingFonts = computed(() => status.value.pending)
  const hasMissingFonts = computed(() => missingFonts.value.length > 0)
  const hasPendingFonts = computed(() => pendingFonts.value.length > 0)

  return {
    missingFonts,
    pendingFonts,
    hasMissingFonts,
    hasPendingFonts,
    retryMissingFonts
  }
}
