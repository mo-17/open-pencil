import type { SceneGraph } from '@open-pencil/scene-graph'

import {
  populateAllFigPages,
  populateFigPage,
  releaseReaderRecovery
} from '#core/kiwi/fig/session/document-state'

export function populateLazyFigImportRoots(graph: SceneGraph, rootIds: Iterable<string>): boolean {
  let changed = false
  for (const id of new Set(rootIds)) if (populateFigPage(graph, id)) changed = true
  return changed
}
export const populateAllLazyFigImportRoots = populateAllFigPages
export const clearLazyFigImportContext = releaseReaderRecovery
