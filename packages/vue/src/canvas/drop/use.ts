import { useEventListener } from '@vueuse/core'
import { ref, type Ref } from 'vue'

import type { Editor } from '@open-pencil/core/editor'
import { createSceneGeometry } from '@open-pencil/core/geometry'

import { cycleSafeTarget, findMoveDropTarget } from '#vue/shared/input/drop-target'

const RASTER_IMAGE_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
  'image/avif'
])
const COMPONENT_MIME = 'application/x-openpencil-component'

function hasComponentData(e: DragEvent): boolean {
  return e.dataTransfer?.types.includes(COMPONENT_MIME) ?? false
}

function dropPoint(e: DragEvent, canvas: HTMLCanvasElement, editor: Editor) {
  const rect = canvas.getBoundingClientRect()
  return editor.screenToCanvas(e.clientX - rect.left, e.clientY - rect.top)
}

function componentDropPlacement(componentId: string, cx: number, cy: number, editor: Editor) {
  const component = editor.graph.getNode(componentId)
  if (component?.type !== 'COMPONENT') return null

  const dragged = new Set([componentId])
  const target = cycleSafeTarget(findMoveDropTarget(cx, cy, editor, dragged), [componentId], editor)
  const parentId = target?.id ?? editor.getContentEditInsertionParent()
  if (!parentId) return null
  const parent = editor.graph.getNode(parentId)
  const local = parent ? createSceneGeometry(editor.graph).toLocal(parent, { x: cx, y: cy }) : null
  return {
    parentId,
    x: (local?.x ?? cx) - component.width / 2,
    y: (local?.y ?? cy) - component.height / 2
  }
}

export function useCanvasDrop(
  canvasRef: Ref<HTMLCanvasElement | null>,
  editor: Editor,
  onActivate?: () => void
) {
  const isDraggingOver = ref(false)

  useEventListener(canvasRef, 'dragover', (e: DragEvent) => {
    if (!hasComponentData(e) && !hasFileData(e)) return
    e.preventDefault()
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'
    isDraggingOver.value = true
  })

  useEventListener(canvasRef, 'dragenter', (e: DragEvent) => {
    if (!hasComponentData(e) && !hasFileData(e)) return
    onActivate?.()
    e.preventDefault()
    isDraggingOver.value = true
  })

  useEventListener(canvasRef, 'dragleave', () => {
    isDraggingOver.value = false
  })

  useEventListener(canvasRef, 'drop', (e: DragEvent) => {
    onActivate?.()
    e.preventDefault()
    isDraggingOver.value = false

    const canvas = canvasRef.value
    if (!canvas) return
    const point = dropPoint(e, canvas, editor)

    const componentId = e.dataTransfer?.getData(COMPONENT_MIME)
    if (componentId) {
      const placement = componentDropPlacement(componentId, point.x, point.y, editor)
      if (!placement) return
      editor.createInstanceFromComponent(componentId, placement.x, placement.y, placement.parentId)
      editor.requestRender()
      return
    }

    if (!editor.getContentEditInsertionParent()) return
    const files = filterCanvasFiles(e.dataTransfer?.files ?? null)
    if (!files.length) return
    void editor.placeFiles(files, point.x, point.y).catch((error: unknown) => {
      console.error('Failed to place dropped files', error)
    })
  })

  return { isDraggingOver }
}

function hasFileData(e: DragEvent): boolean {
  return e.dataTransfer?.types.includes('Files') ?? false
}

function isSVGFile(file: File): boolean {
  return (
    file.type === 'image/svg+xml' || (file.type === '' && file.name.toLowerCase().endsWith('.svg'))
  )
}

export function filterCanvasFiles(files: ArrayLike<File> | Iterable<File> | null): File[] {
  if (!files) return []
  return Array.from(files).filter((file) => RASTER_IMAGE_TYPES.has(file.type) || isSVGFile(file))
}

export function extractImageFilesFromClipboard(e: ClipboardEvent): File[] {
  const files = e.clipboardData?.files
  return files ? Array.from(files).filter((file) => RASTER_IMAGE_TYPES.has(file.type)) : []
}
