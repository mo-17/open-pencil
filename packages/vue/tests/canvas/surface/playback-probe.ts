import { effectScope, reactive } from 'vue'

import { createEditor, createDefaultEditorState } from '@open-pencil/core/editor'
import { SceneGraph } from '@open-pencil/scene-graph'

import { shaderFrames } from '#vue/canvas/surface/shader/frames'
import { useShaderPlayback } from '#vue/canvas/surface/shader/playback'

/** Scoped simulated renderer; this probe never claims real GPU rendering. */
export async function shaderPlaybackProbe(
  mode: 'initialization' | 'device-loss' | 'document-switch' | 'manual-retry' | 'canvas-remount'
) {
  const graph = new SceneGraph()
  const state = reactive(createDefaultEditorState(graph.getPages()[0].id))
  const editor = createEditor({ graph, state })
  const node = graph.createNode('RECTANGLE', state.currentPageId, { width: 32, height: 32 })
  graph.updateNode(node.id, {
    fills: [{ type: 'SOLID', color: { r: 1, g: 0, b: 0, a: 1 }, visible: true, opacity: 1 }]
  })
  editor.setShaderPaint([node.id], 'fills', 0, { components: [{ type: 'Aurora' }] })
  const image = node.fills[0].imageHash ?? ''
  editor.setShaderRasterizer({ render: async () => new Uint8Array([42]) })
  await editor.settleShaderFrames({ nodeIds: [node.id], requireFrames: true })
  const stats = { starts: 0, published: 0, restored: 0, disposed: 0 }
  let unavailable = false
  let release: () => void = () => {
    throw new Error('Deferred not initialized')
  }
  const waiting = new Promise<void>((resolve) => {
    release = resolve
  })
  const stopFrames = shaderFrames(editor).listen(image, (frame) => {
    if (frame) stats.published++
    else stats.restored++
  })
  const renderer = { setLiveImage: () => true }
  let scope = effectScope()
  editor.startPlay()
  function mount() {
    scope.run(() =>
      useShaderPlayback({
        editor,
        getRenderer: () => renderer,
        getView: () => state,
        getViewport: () => ({ width: 400, height: 400 }),
        markDirty() {
          /* This probe observes publication, without an editor canvas. */
        },
        createRenderer: async () => {
          stats.starts++
          return {
            initialize: async () => {
              if (
                mode === 'initialization' ||
                ((mode === 'manual-retry' || mode === 'canvas-remount') && stats.starts === 1)
              )
                throw new Error('fixture initialization failure')
              if (mode === 'document-switch') await waiting
            },
            renderFrame: async () => {
              if (mode === 'device-loss' && stats.published > 0) unavailable = true
            },
            getFailureReason: () => (unavailable ? 'no-device' : null),
            setOnUnavailable() {
              /* Polling failure is tested independently of callbacks. */
            },
            dispose: () => {
              stats.disposed++
            }
          }
        }
      })
    )
  }
  mount()
  return {
    stats,
    saved: () => Array.from(graph.images.get(image) ?? []),
    status: () => editor.getShaderFrameStatus(node.id, image),
    retry: () => editor.retryShaderFrames([node.id]),
    remount() {
      scope.stop()
      scope = effectScope()
      mount()
    },
    switchDocument() {
      editor.replaceGraph(new SceneGraph())
      release()
    },
    close() {
      stopFrames()
      scope.stop()
      editor.dispose()
    }
  }
}
