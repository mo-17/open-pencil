import { readShaderPaints, withoutContentShader } from '@open-pencil/scene-graph'

import { SHADER_PRESET_LIBRARY_KEY } from '@/app/editor/shaders/preset-library'

import { createShaderDocument } from './document'

function editor() {
  const store = window.openPencil?.getStore?.()
  if (!store) throw new Error('Shader preset editor missing')
  return store
}

/** Saved synthetic frames exercise inspector state and persistence without starting WebGPU. */
export async function createShaderPresetDocument() {
  const store = editor()
  for (const node of store.graph.getChildren(store.state.currentPageId))
    if (['Shader acceptance', 'Preset decoration', 'Preset text'].includes(node.name))
      store.graph.deleteNode(node.id)
  await createShaderDocument(true)
  const first = store.graph
    .getChildren(store.state.currentPageId)
    .find((node) => node.name === 'Shader acceptance')
  if (!first) throw new Error('First Shader preset layer missing')
  store.graph.updateNode(first.id, { name: 'Preset decoration' })
  const image = readShaderPaints(first)[0]?.image
  const saved = image && store.graph.images.get(image)
  if (!saved) throw new Error('Preset fixture saved frame missing')
  const second = store.graph.createNode('TEXT', store.state.currentPageId, {
    name: 'Preset text',
    text: 'Editable source text',
    x: 260,
    y: 80,
    width: 180,
    height: 40,
    fontSize: 20,
    fills: [{ type: 'SOLID', color: { r: 0.1, g: 0.2, b: 0.8, a: 1 }, visible: true, opacity: 1 }]
  })
  store.setContentShader([second.id], { components: [{ type: 'Twirl', props: { intensity: 1 } }] })
  const secondImage = readShaderPaints(second)[0]?.image
  if (!secondImage) throw new Error('Second Shader preset output missing')
  store.graph.images.set(secondImage, new Uint8Array(saved))
  await store.settleShaderFrames({ nodeIds: [first.id, second.id], requireFrames: true })
  store.select([first.id])
  store.markDocumentSaved()
  return shaderPresetObservation()
}

export function shaderPresetObservation() {
  const store = editor()
  return store.graph
    .getChildren(store.state.currentPageId)
    .filter((node) => node.name === 'Preset decoration' || node.name === 'Preset text')
    .map((node) => {
      const source = withoutContentShader(node)
      const shader = readShaderPaints(node).find((paint) => paint.input)
      if (!shader) throw new Error('Preset fixture own-content Shader missing')
      return {
        id: node.id,
        preset: shader.preset,
        source: {
          fills: source.fills,
          strokes: source.strokes,
          text: source.text,
          children: store.graph.getChildren(node.id).map((child) => ({
            id: child.id,
            type: child.type,
            fills: child.fills,
            text: child.text
          }))
        }
      }
    })
}

export function selectShaderPresetLayers() {
  editor().select(shaderPresetObservation().map((node) => node.id))
}

export function clearShaderPresetSelection() {
  editor().clearSelection()
}

export function markShaderPresetDocumentSaved() {
  editor().markDocumentSaved()
}

/** A test-owned, key-specific Storage failure; the returned handle restores the host method. */
export function shaderPresetStorageFailure(mode: 'read' | 'write') {
  const nativeSetItem = Storage.prototype.setItem
  const nativeGetItem = Storage.prototype.getItem
  Storage.prototype.setItem = function (key: string, value: string) {
    if (mode === 'write' && key === SHADER_PRESET_LIBRARY_KEY)
      throw new DOMException('Test preset quota failure', 'QuotaExceededError')
    nativeSetItem.call(this, key, value)
  }
  Storage.prototype.getItem = function (key: string) {
    if (mode === 'read' && key === SHADER_PRESET_LIBRARY_KEY)
      throw new DOMException('Test preset read failure', 'SecurityError')
    return nativeGetItem.call(this, key)
  }
  return {
    restore() {
      Storage.prototype.setItem = nativeSetItem
      Storage.prototype.getItem = nativeGetItem
    },
    stored() {
      // oxlint-disable-next-line open-pencil/no-direct-storage-access -- Reads only the test-owned preset key through the original host method.
      return nativeGetItem.call(window.localStorage, SHADER_PRESET_LIBRARY_KEY)
    }
  }
}
