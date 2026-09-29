import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

import { TREE_CONFIG_SOURCE, TREE_STATE_SOURCE } from '#compiler/adapters/tree/source'

import type { TreeModuleConfigV1, TreeRow } from '@open-pencil/core/plugins'
export interface TreeRuntimeState {
  selected: string[]
  expanded: string[]
  query: string
  activeId: string
  open: boolean
}
interface TreeRuntime {
  initialTree: (config: TreeModuleConfigV1) => TreeRuntimeState
  visibleRows: (config: TreeModuleConfigV1, state: TreeRuntimeState) => TreeRow[]
  toggleBranch: (
    config: TreeModuleConfigV1,
    state: TreeRuntimeState,
    id: string
  ) => TreeRuntimeState
  chooseTree: (config: TreeModuleConfigV1, state: TreeRuntimeState, id: string) => TreeRuntimeState
  treeKeyboard: (
    config: TreeModuleConfigV1,
    state: TreeRuntimeState,
    key: string
  ) => { state: TreeRuntimeState; handled: boolean; focus: string }
}
export async function treeRuntime(): Promise<TreeRuntime> {
  const source = new Bun.Transpiler({ loader: 'ts' }).transformSync(
    TREE_CONFIG_SOURCE +
      TREE_STATE_SOURCE +
      '\nexport {initialTree,visibleRows,toggleBranch,chooseTree,treeKeyboard}'
  )
  const directory = mkdtempSync(join(tmpdir(), 'tree-runtime-'))
  try {
    const file = join(directory, 'runtime.mjs')
    writeFileSync(file, source)
    return (await import(pathToFileURL(file).href)) as TreeRuntime
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}
