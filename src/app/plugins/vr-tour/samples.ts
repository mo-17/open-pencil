import type { Editor } from '@open-pencil/core/editor'
import {
  createVRTourModuleInstance,
  createVRTourSampleScenes,
  resolveVRTourModule
} from '@open-pencil/core/plugins'

import type { ensureVRTourSampleAssets } from './assets'
import { vrTourEditorCopy } from './copy'

/** Keep the document's scene configuration and embedded image bytes in one undo step. */
export function applyVRTourSamples(
  editor: Editor,
  nodeId: string,
  locale: string,
  assets: Awaited<ReturnType<typeof ensureVRTourSampleAssets>>
): void {
  const node = editor.graph.getNode(nodeId)
  const resolved = resolveVRTourModule(node?.interactiveProps?.module)
  if (!node || !resolved?.ok || node.bindings?.panoramaUrl)
    throw new Error(vrTourEditorCopy(locale).samplesChanged)
  const scenes = createVRTourSampleScenes(resolved.config.locale ?? 'en')
  const expected = new Set(scenes.map((scene) => scene.panoramaUrl))
  if (
    assets.length !== expected.size ||
    assets.some(({ asset }) => !expected.delete(asset.panoramaUrl))
  )
    throw new Error(vrTourEditorCopy(locale).samplesFailed)
  const instance = createVRTourModuleInstance({
    ...resolved.config,
    scenes,
    initialSceneId: scenes[0].id
  })
  const before = editor.snapshotDocument()
  const restore = editor.restoreDocumentFromSnapshot.bind(editor)
  try {
    for (const { asset, bytes } of assets) editor.graph.images.set(asset.graphImageHash, bytes)
    editor.graph.updateNode(nodeId, {
      interactiveProps: { ...node.interactiveProps, module: instance }
    })
    const after = editor.snapshotDocument()
    editor.pushUndoEntry({
      label: vrTourEditorCopy(locale).samplesUndo,
      forward: () => restore(after),
      inverse: () => restore(before)
    })
    editor.requestRender()
  } catch (error) {
    restore(before)
    throw error
  }
}
