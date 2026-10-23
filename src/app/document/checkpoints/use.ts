import { computed, onScopeDispose, ref, shallowRef, watch } from 'vue'

import { BUILTIN_IO_FORMATS, IORegistry } from '@open-pencil/core/io'

import type { EditorStore } from '@/app/editor/session'
import { storageDocumentKey } from '@/app/integrations/storage'
import { getTabForStore, openCheckpointInNewTab } from '@/app/tabs'

import { createCheckpointController } from './controller'
import type { CheckpointDifference } from './difference'
import { createCheckpointStore } from './store'
import { CheckpointError, type CheckpointMetadata } from './types'

function checkpointScope(editor: EditorStore): string {
  const storage = editor.getStorageBinding()
  if (storage) return `storage:${storageDocumentKey(storage)}`
  const source = editor.getSourceIdentity()
  return source.path ? `file:${source.path}` : `session:${editor.getRecoveryId()}`
}

export function useDocumentCheckpoints(editor: EditorStore) {
  const store = createCheckpointStore()
  const io = new IORegistry(BUILTIN_IO_FORMATS)
  const entries = shallowRef<CheckpointMetadata[]>([])
  const difference = shallowRef<CheckpointDifference | null>(null)
  const selected = ref('')
  const busy = ref(false)
  const error = ref('')
  const saved = ref(false)
  const allDocuments = ref(false)
  let disposed = false
  const originalGraph = editor.graph
  const scope = () => checkpointScope(editor)
  const current = () => !disposed && !!getTabForStore(editor) && editor.graph === originalGraph
  const controller = createCheckpointController(
    {
      scope,
      name: () => editor.state.documentName,
      current,
      revision: () => editor.state.sceneVersion,
      capture: async () => (await editor.buildFigFileSnapshot()).data
    },
    {
      store,
      readGraph: async (bytes) =>
        (
          await io.readDocumentAs(
            'fig',
            {
              name: 'checkpoint.fig',
              data: bytes
            },
            { populate: 'all' }
          )
        ).graph,
      releaseGraph: (graph) => editor.releaseGraphResources(graph),
      openDocument: openCheckpointInNewTab
    }
  )
  onScopeDispose(() => {
    disposed = true
  })
  watch(
    () => editor.state.sceneVersion,
    () => {
      if (difference.value) {
        difference.value = null
        selected.value = ''
        error.value = 'changed'
      }
    },
    { flush: 'sync' }
  )

  const visible = computed(() =>
    entries.value.filter((entry) => allDocuments.value || entry.scope === scope())
  )
  const selectedEntry = computed(() => entries.value.find((entry) => entry.id === selected.value))

  async function run(operation: () => Promise<void>) {
    if (busy.value) return false
    busy.value = true
    error.value = ''
    saved.value = false
    try {
      await operation()
      return current()
    } catch (cause) {
      if (current()) error.value = cause instanceof CheckpointError ? cause.code : 'unavailable'
      return false
    } finally {
      if (!disposed) busy.value = false
    }
  }
  async function refresh() {
    const rows = await store.list()
    if (current()) entries.value = rows
  }
  return {
    visible,
    selected,
    selectedEntry,
    difference,
    busy,
    error,
    saved,
    allDocuments,
    load: () => run(refresh),
    create: (name: string) =>
      run(async () => {
        await controller.create(name)
        await refresh()
        if (current()) saved.value = true
      }),
    inspect: (id: string) =>
      run(async () => {
        selected.value = id
        difference.value = null
        const result = await controller.compare(id)
        if (current() && selected.value === id) difference.value = result
      }),
    restore: (backupName: string) =>
      run(async () => {
        const id = selected.value
        if (!id) throw new CheckpointError('missing')
        await controller.restore(id, backupName)
      }),
    remove: (id: string) =>
      run(async () => {
        await store.remove(id)
        if (selected.value === id) {
          selected.value = ''
          difference.value = null
        }
        await refresh()
      })
  }
}
