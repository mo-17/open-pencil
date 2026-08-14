import type { Ref } from 'vue'

import type {
  CodePenSidecarDiagnostic,
  CodePenSidecarSuccessResult
} from '@open-pencil/compiler/codepen/sidecar-wire'

import type { EditorStore } from '@/app/editor/active-store'

import type {
  CodePenCompiledShowcase,
  CodePenShowcaseCommandOptions,
  CodePenShowcaseResult
} from './command'

export type CodePenShowcaseInput = Omit<CodePenShowcaseCommandOptions, 'packageName'>

export type CodePenShowcaseStatus =
  | { kind: 'idle' }
  | { kind: 'compiling' }
  | { kind: 'cancelling' }
  | { kind: 'ready'; result: CodePenShowcaseResult }
  | { kind: 'opening'; result: CodePenShowcaseResult }
  | { kind: 'done'; result: CodePenShowcaseResult }
  | {
      kind: 'error'
      message: string
      code?: string
      diagnostics?: readonly CodePenSidecarDiagnostic[]
    }

export interface UseCodePenShowcaseResult {
  status: Ref<CodePenShowcaseStatus>
  available: boolean
  unavailableReason: string | null
  prepare(input: CodePenShowcaseInput): Promise<void>
  openInCodePen(input: CodePenShowcaseInput): Promise<void>
  cancel(): void
  reset(): void
}

export interface CodePenShowcaseStore {
  readonly graph: EditorStore['graph']
  readonly state: Pick<EditorStore['state'], 'documentName' | 'currentPageId' | 'sceneVersion'>
  getSourceIdentity(): ReturnType<EditorStore['getSourceIdentity']>
  onEditorEvent(
    event: 'render:requested' | 'graph:replaced' | 'page:changed',
    listener: () => void
  ): () => void
  onSourceChanged(listener: () => void): () => void
}

export interface CodePenShowcaseDependencies {
  getActiveStore(): CodePenShowcaseStore
  compileProject(
    options: CodePenShowcaseCommandOptions,
    store: CodePenShowcaseStore,
    signal: AbortSignal
  ): Promise<CodePenCompiledShowcase>
  runSidecar(
    options: CodePenShowcaseCommandOptions,
    files: CodePenCompiledShowcase['files'],
    signal: AbortSignal
  ): Promise<CodePenSidecarSuccessResult>
  openPrefill(data: CodePenShowcaseResult['data']): Promise<void>
  digestInput(input: CodePenShowcaseInput): Promise<string>
}

export interface CodePenShowcaseAvailability {
  available: boolean
  unavailableReason: string | null
}

export interface CodePenDocumentBinding {
  store: CodePenShowcaseStore
  graph: CodePenShowcaseStore['graph']
  sourceIdentity: ReturnType<CodePenShowcaseStore['getSourceIdentity']>
  documentName: string
  pageId: string
  sceneVersion: number
}

export type CodePenCancellationReason = 'user' | 'stale' | 'disposed'

export interface CodePenShowcaseOperation extends CodePenDocumentBinding {
  input: CodePenShowcaseInput
  optionsDigest: string | null
  controller: AbortController | null
  cancellationReason: CodePenCancellationReason | null
  unbinds: Array<() => void>
}

export interface PreparedCodePenShowcase extends CodePenDocumentBinding {
  result: CodePenShowcaseResult
  optionsDigest: string
  unbinds: Array<() => void>
}

export function currentCodePenBinding(
  dependencies: CodePenShowcaseDependencies
): CodePenDocumentBinding {
  const store = dependencies.getActiveStore()
  return {
    store,
    graph: store.graph,
    sourceIdentity: store.getSourceIdentity(),
    documentName: store.state.documentName,
    pageId: store.state.currentPageId,
    sceneVersion: store.state.sceneVersion
  }
}

export function codePenBindingIsCurrent(
  binding: CodePenDocumentBinding,
  dependencies: CodePenShowcaseDependencies
): boolean {
  const store = dependencies.getActiveStore()
  return (
    store === binding.store &&
    store.graph === binding.graph &&
    store.getSourceIdentity() === binding.sourceIdentity &&
    store.state.documentName === binding.documentName &&
    store.state.currentPageId === binding.pageId &&
    store.state.sceneVersion === binding.sceneVersion
  )
}

export function clearCodePenListeners(unbinds: Array<() => void>): void {
  for (const unbind of unbinds.splice(0)) unbind()
}
