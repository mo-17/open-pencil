import type { SceneGraph } from '@open-pencil/scene-graph'

import { applicationPageSessionSignature } from '../application-session/cache'
import type { PreviewFrameDescriptor } from './types'

/** Capture session and guard policy at the synchronous compile/Worker-snapshot boundary. */
export function capturePreviewPageSessionSource(
  graph: SceneGraph
): PreviewFrameDescriptor['pageSessionSource'] {
  const signature = applicationPageSessionSignature(graph)
  // Non-extensible metadata keeps Vue's preview-status refs from proxying graph identity.
  return signature === null ? undefined : Object.freeze({ graph, signature })
}
