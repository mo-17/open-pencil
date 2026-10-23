import type { SceneGraph } from '@open-pencil/scene-graph'

import { compareCheckpointGraphs } from './difference'
import { CheckpointError, type CheckpointInput, type CheckpointStore } from './types'

export interface CheckpointTarget {
  scope(): string
  name(): string
  capture(): Promise<Uint8Array>
  current(): boolean
  revision(): number
}

export interface CheckpointServices {
  store: CheckpointStore
  readGraph(bytes: Uint8Array): Promise<SceneGraph>
  releaseGraph(graph: SceneGraph): void
  openDocument(bytes: Uint8Array, name: string): Promise<void>
}

/** A restore always opens a separate document and first persists the current version. */
export function createCheckpointController(target: CheckpointTarget, services: CheckpointServices) {
  let busy = false
  async function run<T>(operation: (check: () => void) => Promise<T>): Promise<T> {
    if (busy) throw new CheckpointError('changed')
    busy = true
    try {
      const scope = target.scope()
      const check = () => {
        if (!target.current() || target.scope() !== scope) throw new CheckpointError('changed')
      }
      check()
      return await operation(check)
    } finally {
      busy = false
    }
  }

  async function capture(name: string, kind: CheckpointInput['kind'], check: () => void) {
    const scope = target.scope()
    const documentName = target.name().slice(0, 256)
    const figBytes = await target.capture()
    check()
    const written = await services.store.write({ scope, documentName, name, kind, figBytes })
    check()
    return written
  }

  return {
    create: (name: string) => run((check) => capture(name, 'named', check)),
    compare: (id: string) =>
      run(async (check) => {
        const saved = await services.store.read(id)
        check()
        if (!saved) throw new CheckpointError('missing')
        const current = await target.capture()
        check()
        // Shader settlement belongs to capture; subsequent edits must not relabel old bytes
        // as the current document while either FIG is being decoded.
        const revision = target.revision()
        const checkRevision = () => {
          check()
          if (target.revision() !== revision) throw new CheckpointError('changed')
        }
        let before: SceneGraph | undefined
        let after: SceneGraph | undefined
        try {
          before = await services.readGraph(saved.figBytes)
          checkRevision()
          after = await services.readGraph(current)
          checkRevision()
          return compareCheckpointGraphs(before, after)
        } finally {
          if (before) services.releaseGraph(before)
          if (after) services.releaseGraph(after)
        }
      }),
    restore: (id: string, backupName: string) =>
      run(async (check) => {
        const saved = await services.store.read(id)
        check()
        if (!saved) throw new CheckpointError('missing')
        // A failed capacity/quota write prevents opening the old version. Never evict silently.
        await capture(backupName, 'before-restore', check)
        check()
        await services.openDocument(saved.figBytes, saved.documentName)
      })
  }
}
