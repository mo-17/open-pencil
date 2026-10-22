import { describe, expect, test } from 'bun:test'

import { createEditor } from '@open-pencil/core/editor'
import {
  createShaderPaint,
  SceneGraph,
  shaderOfPaint,
  shaderPresetKey,
  withShaderPaints,
  type ShaderPreset
} from '@open-pencil/scene-graph'

const AURORA: ShaderPreset = { components: [{ type: 'Aurora' }] }
const SWIRL: ShaderPreset = { components: [{ type: 'Swirl' }] }

function setup() {
  const graph = new SceneGraph()
  const node = graph.createNode('RECTANGLE', graph.getPages()[0].id, {
    width: 40,
    height: 20,
    fills: [{ type: 'SOLID', color: { r: 1, g: 0, b: 0, a: 1 }, opacity: 1, visible: true }]
  })
  const editor = createEditor({ graph })
  const drawn: { preset: ShaderPreset; width: number; height: number }[] = []
  editor.setShaderRasterizer({
    render: (preset, size) => {
      drawn.push({ preset, ...size })
      return Promise.resolve(new Uint8Array([drawn.length]))
    }
  })
  const read = () => {
    const current = editor.graph.getNode(node.id)
    if (!current) throw new Error('missing node')
    return current
  }
  return { editor, id: node.id, drawn, read }
}

describe('shader paints', () => {
  test('a fill becomes a shader as one undo step', () => {
    const { editor, id, read } = setup()
    const before = read().fills

    editor.setShaderPaint([id], 'fills', 0, AURORA)
    const [paint] = read().fills
    expect(paint.type).toBe('IMAGE')
    expect(shaderOfPaint(read(), paint)?.preset).toEqual(AURORA)

    editor.undoAction()
    expect(read().fills).toEqual(before)
    expect(shaderOfPaint(read(), paint)).toBeNull()
  })

  test('changing the preset keeps the paint’s image', () => {
    const { editor, id, read } = setup()
    editor.setShaderPaint([id], 'fills', 0, AURORA)
    const image = read().fills[0].imageHash

    editor.setShaderPaint([id], 'fills', 0, SWIRL)

    expect(read().fills[0].imageHash).toBe(image)
    expect(shaderOfPaint(read(), read().fills[0])?.preset).toEqual(SWIRL)
  })

  test('draws the frame at twice the layer’s size under the paint’s image', async () => {
    const { editor, id, drawn, read } = setup()
    editor.setShaderPaint([id], 'fills', 0, AURORA)
    await editor.settleShaderFrames()

    const [paint] = read().fills
    expect(drawn).toEqual([{ preset: AURORA, width: 80, height: 40 }])
    expect(editor.graph.images.get(paint.imageHash ?? '')).toEqual(new Uint8Array([1]))
    expect(shaderOfPaint(read(), paint)?.frame).toEqual({
      width: 40,
      height: 20,
      preset: shaderPresetKey(AURORA)
    })

    await editor.settleShaderFrames()
    expect(drawn).toHaveLength(1)
  })

  test('draws again after a resize and after undoing a preset change', async () => {
    const { editor, id, drawn } = setup()
    editor.setShaderPaint([id], 'fills', 0, AURORA)
    await editor.settleShaderFrames()

    editor.updateNodeWithUndo(id, { width: 60 })
    await editor.settleShaderFrames()
    editor.setShaderPaint([id], 'fills', 0, SWIRL)
    await editor.settleShaderFrames()
    editor.undoAction()
    await editor.settleShaderFrames()

    expect(drawn.map(({ preset, width }) => [preset, width])).toEqual([
      [AURORA, 80],
      [AURORA, 120],
      [SWIRL, 120],
      [AURORA, 120]
    ])
  })

  test('sets a shader on several layers as one undo step, each with its own image', () => {
    const { editor, id, read } = setup()
    const other = editor.graph.createNode('RECTANGLE', editor.graph.getPages()[0].id, {
      fills: [{ type: 'SOLID', color: { r: 0, g: 0, b: 1, a: 1 }, opacity: 1, visible: true }]
    })

    editor.setShaderPaint([id, other.id], 'fills', 0, AURORA)
    const images = [read().fills[0].imageHash, editor.graph.getNode(other.id)?.fills[0].imageHash]
    expect(new Set(images).size).toBe(2)

    editor.undoAction()
    expect(read().fills[0].type).toBe('SOLID')
    expect(editor.graph.getNode(other.id)?.fills[0].type).toBe('SOLID')
  })

  test('a stroke keeps its weight when it becomes a shader', () => {
    const { editor, id, read } = setup()
    editor.updateNodeWithUndo(id, {
      strokes: [
        {
          type: 'SOLID',
          color: { r: 0, g: 0, b: 0, a: 1 },
          opacity: 1,
          visible: true,
          weight: 3,
          align: 'CENTER'
        }
      ]
    })

    editor.setShaderPaint([id], 'strokes', 0, AURORA)

    expect(read().strokes[0]).toMatchObject({ type: 'IMAGE', weight: 3, align: 'CENTER' })
  })
})

describe('shader frames on page preparation', () => {
  test('a page is prepared only once its shaders have frames, without drawing in the background', async () => {
    const graph = new SceneGraph()
    const page = graph.getPages()[0]
    const node = graph.createNode('RECTANGLE', page.id, { width: 40, height: 20 })
    const { paint, shader } = createShaderPaint(AURORA)
    graph.updateNode(node.id, {
      fills: [paint],
      pluginData: withShaderPaints(node, [paint], [shader])
    })
    const drawn: string[] = []
    const editor = createEditor({
      shaderRasterizer: {
        render: (preset) => {
          drawn.push(preset.components[0]?.type ?? '')
          return Promise.resolve(new Uint8Array([1]))
        }
      }
    })
    editor.replaceGraph(graph)
    await editor.settleShaderFrames()
    expect(drawn).toEqual([])

    const phases: string[] = []
    await editor.preparePage(page.id, { onProgress: (progress) => phases.push(progress.phase) })

    expect(drawn).toEqual(['Aurora'])
    expect(phases).toContain('drawing-shaders')
    expect(editor.graph.images.get(shader.image)).toEqual(new Uint8Array([1]))
  })
})

describe('shader frame settlement and fallback', () => {
  function deferred<T>() {
    let resolve: (value: T) => void = () => {
      throw new Error('Deferred not initialized')
    }
    const promise = new Promise<T>((done) => {
      resolve = done
    })
    return { promise, resolve }
  }

  test('waits for a frame already removed from the pending queue', async () => {
    const { editor, id, read } = setup()
    const started = deferred<undefined>()
    const frame = deferred<Uint8Array | null>()
    editor.setShaderRasterizer({
      render: () => {
        started.resolve(undefined)
        return frame.promise
      }
    })
    editor.setShaderPaint([id], 'fills', 0, AURORA)
    await started.promise
    let settled = false
    const saving = editor.settleShaderFrames().then(() => {
      settled = true
      return undefined
    })
    await Promise.resolve()
    expect(settled).toBe(false)
    frame.resolve(new Uint8Array([7]))
    await saving
    expect(editor.graph.images.get(read().fills[0].imageHash ?? '')).toEqual(new Uint8Array([7]))
    editor.dispose()
  })

  test('keeps saved bytes after failure, and does not retry on every export', async () => {
    const { editor, id, read } = setup()
    editor.setShaderPaint([id], 'fills', 0, AURORA)
    await editor.settleShaderFrames()
    const image = read().fills[0].imageHash ?? ''
    let attempts = 0
    editor.setShaderRasterizer({
      render: () => {
        attempts++
        return Promise.resolve(null)
      }
    })
    editor.setShaderPaint([id], 'fills', 0, SWIRL)
    await editor.settleShaderFrames({ nodeIds: [id], requireFrames: true })
    await editor.settleShaderFrames({ nodeIds: [id], requireFrames: true })
    expect(attempts).toBe(1)
    expect(editor.graph.images.get(image)).toEqual(new Uint8Array([1]))
    editor.setShaderRasterizer(null)
    await editor.settleShaderFrames({ nodeIds: [id], requireFrames: true })
    expect(editor.graph.images.get(image)).toEqual(new Uint8Array([1]))
    editor.dispose()
  })

  test('rejects a static export when there is no usable frame', async () => {
    const { editor, id } = setup()
    editor.setShaderRasterizer(null)
    editor.setShaderPaint([id], 'fills', 0, AURORA)
    await expect(editor.settleShaderFrames({ nodeIds: [id], requireFrames: true })).rejects.toThrow(
      'No usable saved Shader frame'
    )
    // Saving the editable document can preserve an unrendered preset for another GPU host.
    await editor.settleShaderFrames({ nodeIds: [id] })
    editor.dispose()
  })

  test('discards an obsolete size and waits for the concurrent edit', async () => {
    const { editor, id, read } = setup()
    const started = deferred<undefined>()
    const first = deferred<Uint8Array | null>()
    const sizes: number[] = []
    editor.setShaderRasterizer({
      render: (_preset, size) => {
        sizes.push(size.width)
        started.resolve(undefined)
        return sizes.length === 1 ? first.promise : Promise.resolve(new Uint8Array([2]))
      }
    })
    editor.setShaderPaint([id], 'fills', 0, AURORA)
    const saving = editor.settleShaderFrames()
    await started.promise
    editor.updateNodeWithUndo(id, { width: 80 })
    first.resolve(new Uint8Array([1]))
    await saving
    expect(sizes).toEqual([80, 160])
    expect(editor.graph.images.get(read().fills[0].imageHash ?? '')).toEqual(new Uint8Array([2]))
    expect(shaderOfPaint(read(), read().fills[0])?.frame?.width).toBe(80)
    editor.dispose()
  })

  test('document replacement cancels a hung rasterizer and prevents late writes', async () => {
    const { editor, id } = setup()
    const started = deferred<undefined>()
    const first = deferred<Uint8Array | null>()
    let signal: AbortSignal | undefined
    editor.setShaderRasterizer({
      render: (_preset, _size, options) => {
        signal = options?.signal
        started.resolve(undefined)
        return first.promise
      }
    })
    editor.setShaderPaint([id], 'fills', 0, AURORA)
    const saving = editor.settleShaderFrames()
    await started.promise
    editor.replaceGraph(new SceneGraph())
    await expect(saving).rejects.toThrow('superseded')
    expect(signal?.aborted).toBe(true)
    first.resolve(new Uint8Array([9]))
    await Promise.resolve()
    expect(editor.graph.images.size).toBe(0)
    editor.dispose()
  })

  test('deleting a layer prevents an in-flight frame from being saved', async () => {
    const { editor, id } = setup()
    const frame = deferred<Uint8Array | null>()
    const started = deferred<undefined>()
    editor.setShaderRasterizer({
      render: () => {
        started.resolve(undefined)
        return frame.promise
      }
    })
    editor.setShaderPaint([id], 'fills', 0, AURORA)
    const saving = editor.settleShaderFrames()
    await started.promise
    editor.graph.deleteNode(id)
    frame.resolve(new Uint8Array([9]))
    await saving
    expect(editor.graph.images.size).toBe(0)
    editor.dispose()
  })
})
