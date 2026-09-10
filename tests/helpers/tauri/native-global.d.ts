export {}

type NativeTestNode = {
  childIds?: string[]
  id: string
  name?: string
  parentId?: string | null
  type: string
  text?: string
}

type NativeTestStore = {
  state: {
    currentPageId: string
    editingTextId: string | null
    selectedIds: Set<string>
    renderVersion: number
    sceneVersion: number
    snappingPreferences: { objects: boolean }
  }
  graph: {
    createNode: (type: string, parentId: string, changes: Record<string, unknown>) => NativeTestNode
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
    __TAURI__: {
      core: {
        invoke: <T>(command: string, args?: Record<string, unknown>) => Promise<T>
      }
    }
    openPencil?: {
      getStore?: () => NativeTestStore
    }
  }
}
