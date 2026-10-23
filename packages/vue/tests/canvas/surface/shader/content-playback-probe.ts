import { effectScope, reactive } from 'vue'

import { createEditor, createDefaultEditorState, type Editor } from '@open-pencil/core/editor'
import { SceneGraph, contentShader, shaderContentKey } from '@open-pencil/scene-graph'

import { shaderFrames } from '#vue/canvas/surface/shader/frames'
import { useShaderPlayback } from '#vue/canvas/surface/shader/playback'

/** Simulated GPU/texture ownership; pixels and actual WebGPU are tested separately. */
export function contentPlaybackProbe(
  delay: 'capture' | 'renderer' | 'frame' | 'initialization' | 'none',
  count = 1
) {
  const graph = new SceneGraph()
  const state = reactive(createDefaultEditorState(graph.getPages()[0].id))
  const editor = createEditor({ graph, state })
  const nodes = Array.from({ length: count }, (_, index) => {
    const node = graph.createNode('FRAME', state.currentPageId, {
      x: index * 40,
      width: 32,
      height: 32,
      fills: []
    })
    graph.createNode('RECTANGLE', node.id, { width: 20, height: 20 })
    editor.setContentShader([node.id])
    const image = contentShader(graph, node)?.shader.image
    if (!image) throw new Error('Content fixture missing')
    graph.images.set(image, new Uint8Array([42]))
    return { node, image }
  })
  const first = nodes.at(0)
  if (!first) throw new Error('Content fixture needs a layer')
  const stats = {
    captures: 0,
    textures: 0,
    closedTextures: 0,
    starts: 0,
    draws: 0,
    disposed: 0,
    published: 0,
    restored: 0,
    live: 0,
    statusChanges: 0,
    lastKey: ''
  }
  const stopStatus = editor.onEditorEvent('shader:status-changed', () => {
    stats.statusChanges++
  })
  let release = () => {
    /* Installed by the deferred promise. */
  }
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  let unavailable = false
  const host = {
    get graph() {
      return editor.graph
    },
    state,
    onEditorEvent: editor.onEditorEvent,
    reportShaderPlaybackFailure: editor.reportShaderPlaybackFailure,
    reportShaderPlaybackReady: editor.reportShaderPlaybackReady,
    reportShaderPlaybackState: editor.reportShaderPlaybackState,
    async captureShaderContent(id: string, _signal: AbortSignal) {
      const node = graph.getNode(id)
      const content = node && contentShader(graph, node)
      if (!node || !content) return null
      const key = shaderContentKey(graph, node)
      stats.captures++
      if (delay === 'capture' && stats.captures === 1) await gate
      stats.lastKey = key
      return { image: content.shader.image, key, bytes: new Uint8Array([42]) }
    }
  } satisfies Pick<
    Editor,
    | 'graph'
    | 'state'
    | 'onEditorEvent'
    | 'captureShaderContent'
    | 'reportShaderPlaybackFailure'
    | 'reportShaderPlaybackReady'
    | 'reportShaderPlaybackState'
  >
  const scope = effectScope()
  const stops = nodes.map(({ image }) =>
    shaderFrames(host).listen(image, (frame) => {
      if (frame) stats.published++
      else stats.restored++
    })
  )
  editor.startPlay()
  scope.run(() =>
    useShaderPlayback({
      editor: host,
      getRenderer: () => ({ setLiveImage: () => true }),
      getView: () => state,
      getViewport: () => ({ width: 400, height: 400 }),
      markDirty() {
        /* Publication is observed through the frame bus. */
      },
      prepareContent: async (preset) => {
        stats.textures++
        return {
          preset,
          validate: async () => undefined,
          close: () => {
            stats.closedTextures++
          }
        }
      },
      createRenderer: async () => {
        stats.starts++
        if (delay === 'renderer' && stats.starts === 1) await gate
        stats.live++
        return {
          initialize: async () => {
            if (delay === 'initialization') throw new Error('Simulated initialization failure')
          },
          renderFrame: async () => {
            stats.draws++
            // Two preparation draws precede the first frame published by an own-content player.
            if (delay === 'frame' && stats.draws === 3) await gate
          },
          getFailureReason: () => (unavailable ? 'no-device' : null),
          setOnUnavailable() {
            /* Polling loss is independent of callback delivery. */
          },
          dispose() {
            stats.disposed++
            stats.live--
          }
        }
      }
    })
  )
  return {
    stats,
    observation: () => ({
      starts: stats.starts,
      supported: Boolean(contentShader(editor.graph, first.node)),
      preview: state.play !== null,
      bindings: graph.getNode(first.node.childIds[0] ?? '')?.bindings
    }),
    statuses: () => nodes.map(({ node, image }) => editor.getShaderFrameStatus(node.id, image)),
    saved: () => Array.from(graph.images.get(first.image) ?? []),
    currentKey: () => shaderContentKey(graph, first.node),
    edit() {
      editor.updateNodeWithUndo(first.node.childIds[0] ?? '', { width: 12 })
    },
    unsupported() {
      editor.updateNodeWithUndo(first.node.childIds[0] ?? '', {
        bindings: { text: { kind: 'ref', stateId: 'value' } }
      })
    },
    pause: () => editor.stopPlay(),
    delete: () => graph.deleteNode(first.node.id),
    switch: () => editor.replaceGraph(new SceneGraph()),
    undo: () => editor.undoAction(),
    redo: () => editor.redoAction(),
    lose() {
      unavailable = true
    },
    retry() {
      unavailable = false
      editor.retryShaderFrames([first.node.id])
    },
    pan: (x: number) => editor.pan(x, 0),
    release: () => release(),
    close() {
      scope.stop()
      for (const stop of stops) stop()
      stopStatus()
      release()
      editor.dispose()
    }
  }
}
