/// <reference types="@wdio/globals/types" />

import type * as TauriAPI from '@tauri-apps/api'
import type * as TauriOS from '@tauri-apps/plugin-os'

import type { Editor } from '@open-pencil/core/editor'
import type { RasterExportFormat } from '@open-pencil/core/io'
import type { Fill } from '@open-pencil/scene-graph'

export {}

/** App-owned source metadata observed by native tests without importing the app type graph. */
type NativeDocumentSourceIdentity = Readonly<{
  handle: FileSystemFileHandle | null
  path: string | null
}>
type NativeStorageDocumentIdentity = Readonly<{ documentId: string }>

type NativeTestNode = {
  childIds?: string[]
  id: string
  name?: string
  parentId?: string | null
  type: string
  text?: string
  fills: Fill[]
  width: number
  height: number
}

type NativeTestStore = Pick<
  Editor,
  | 'setContentShader'
  | 'setShaderPaint'
  | 'setShaderRasterizer'
  | 'settleShaderFrames'
  | 'setBehaviour'
  | 'startPlay'
  | 'stopPlay'
> & {
  getSourceIdentity: () => NativeDocumentSourceIdentity
  getDocumentFilePath: () => string | null
  getStorageBinding: () => NativeStorageDocumentIdentity | null
  renderExportImage: (
    nodeIds: string[],
    scale: number,
    format: RasterExportFormat
  ) => Promise<Uint8Array | null>
  saveFigFileToPath: (path: string) => Promise<boolean>
  openFigFile: (file: File) => Promise<void>
  state: {
    currentPageId: string
    editingTextId: string | null
    selectedIds: Set<string>
    renderVersion: number
    sceneVersion: number
    snappingPreferences: { objects: boolean }
  }
  graph: {
    images: Map<string, Uint8Array>
    createNode: (type: string, parentId: string, changes: Record<string, unknown>) => NativeTestNode
    createInstance: Editor['graph']['createInstance']
    deleteNode: (id: string) => void
    getChildren: (id: string) => NativeTestNode[]
    getNode: (id: string) => NativeTestNode | undefined
    updateNode: (id: string, changes: Record<string, unknown>) => void
  }
  createShape: (type: string, x: number, y: number, width: number, height: number) => string
  requestRender: () => void
  select: (ids: string[]) => void
  startTextEditing: (id: string) => void
  textEditor?: { selectAll: () => void }
}

declare global {
  interface Window {
    __TAURI__?: Pick<typeof TauriAPI, 'core'> & { os?: typeof TauriOS }
    openPencil?: {
      getStore?: () => NativeTestStore
    }
  }
}
