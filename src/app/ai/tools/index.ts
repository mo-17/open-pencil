import { valibotSchema } from '@ai-sdk/valibot'
import { tool } from 'ai'
import * as v from 'valibot'

import { computeAllLayoutsAsync } from '@open-pencil/core/layout'
import { CORE_TOOLS, EXTENDED_TOOLS, toolsToAI } from '@open-pencil/core/tools'
import type { StepBudget, ToolLogEntry } from '@open-pencil/core/tools'

import { makeFigmaFromStore } from '@/app/automation/bridge/figma-factory'
import { createCodePenAITools, getCodePenAIManager } from '@/app/codepen/ai/tools'
import { saveMotionAnimationResult } from '@/app/document/export/motion/use-motion-animation-export'
import { getActiveEditorStore } from '@/app/editor/active-store'
import type { EditorStore } from '@/app/editor/active-store'
import { ensureGraphFonts } from '@/app/editor/fonts'
import { resolveEditorMutationScope } from '@/app/editor/mutation-scope'
import { canCreatePluginModule } from '@/app/plugins'

import { createVisualInspectionTool } from './vision'

export const MAX_AGENT_STEPS = 50
const MAX_TOOL_LOG_ENTRIES = 200
const MAX_STEP_USAGE_ENTRIES = 500
const DOCUMENT_SCOPE_TOOLS = new Set(['eval'])
const NON_GRAPH_MUTATION_TOOLS = new Set(['viewport_zoom_to_fit'])
const MODULE_CREATION_POLICY_TOOLS = new Set(['list_modules', 'create_module'])
const POSTPROCESS_FREE_TOOLS = new Set([
  'set_doc_states',
  'set_supabase_config',
  'set_translations',
  'set_workflows',
  'apply_motion_preset',
  'apply_motion_recipe',
  'apply_team_motion_library_entry',
  'apply_motion_spec',
  'update_motion',
  'clear_motion',
  'update_motion_scene',
  'clear_motion_scene',
  'update_motion_drivers',
  'clear_motion_drivers',
  'update_prototype',
  'clear_prototype',
  'set_motion_transition_key',
  'clear_motion_transition_key',
  'update_generated_effect',
  'clear_generated_effect'
])

type PageHistorySnapshot = ReturnType<EditorStore['snapshotPage']>
type DocumentHistorySnapshot = ReturnType<EditorStore['snapshotDocument']>
type MutationTransaction =
  | {
      before: PageHistorySnapshot
      coalesceKey: string
      pageId: string
      sceneVersionBefore: number
      scope: 'page'
      undoRevisionBefore: number
    }
  | {
      before: DocumentHistorySnapshot
      coalesceKey: string
      pageId: string
      sceneVersionBefore: number
      scope: 'document'
      undoRevisionBefore: number
    }

type SuccessfulSnapshot =
  | {
      coalesceKey: string
      pageId: string
      sceneVersion: number
      scope: 'page'
      snapshot: PageHistorySnapshot
      undoRevision: number
    }
  | {
      coalesceKey: string
      pageId: string
      sceneVersion: number
      scope: 'document'
      snapshot: DocumentHistorySnapshot
      undoRevision: number
    }

const VISUAL_INSPECTION_TOOL_NAMES = new Set(['export_image'])

export interface StepUsage {
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  timestamp: number
}

class RunState {
  toolLog: ToolLogEntry[] = []
  stepUsages: StepUsage[] = []
  currentSteps = 0
  undoTurn = 0

  get undoCoalesceKey(): string {
    return `ai-turn:${this.undoTurn}`
  }

  recordTool(entry: ToolLogEntry): void {
    this.toolLog.push(entry)
    if (this.toolLog.length > MAX_TOOL_LOG_ENTRIES) {
      this.toolLog.splice(0, this.toolLog.length - MAX_TOOL_LOG_ENTRIES)
    }
  }

  recordStep(usage: StepUsage): void {
    this.stepUsages.push(usage)
    if (this.stepUsages.length > MAX_STEP_USAGE_ENTRIES) {
      this.stepUsages.splice(0, this.stepUsages.length - MAX_STEP_USAGE_ENTRIES)
    }
    this.currentSteps++
  }

  resetSteps(): void {
    this.currentSteps = 0
    this.undoTurn++
  }

  hitLimit(): boolean {
    return this.currentSteps >= MAX_AGENT_STEPS
  }

  clear(): void {
    this.toolLog = []
    this.stepUsages = []
    this.currentSteps = 0
    this.undoTurn++
  }
}

const runStates = new WeakMap<EditorStore, RunState>()

function getRunState(store?: EditorStore): RunState {
  const target = store ?? getActiveEditorStore()
  const existing = runStates.get(target)
  if (existing) return existing
  const created = new RunState()
  runStates.set(target, created)
  return created
}

export function getToolLogEntries(store?: EditorStore): ToolLogEntry[] {
  return getRunState(store).toolLog
}

export function getStepUsages(store?: EditorStore): StepUsage[] {
  return getRunState(store).stepUsages
}

export function recordStepUsage(usage: StepUsage, store?: EditorStore): void {
  getRunState(store).recordStep(usage)
}

export function resetRunSteps(store?: EditorStore): void {
  getRunState(store).resetSteps()
}

export function didHitStepLimit(store?: EditorStore): boolean {
  return getRunState(store).hitLimit()
}

export function clearToolLogEntries(store?: EditorStore): void {
  getRunState(store).clear()
}

function yieldToHost(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0)
  })
}

function mutationChanged(store: EditorStore, transaction: MutationTransaction): boolean {
  if (store.state.sceneVersion !== transaction.sceneVersionBefore) return true
  return transaction.scope === 'document' && store.documentSnapshotChanged(transaction.before)
}

function undoHistoryChanged(store: EditorStore, transaction: MutationTransaction): boolean {
  return store.undo.revision !== transaction.undoRevisionBefore
}

function restoreMutation(store: EditorStore, transaction: MutationTransaction): void {
  if (transaction.scope === 'document') {
    store.restoreDocumentFromSnapshot(transaction.before)
  } else {
    store.restorePageFromSnapshot(transaction.before, transaction.pageId)
  }
}

async function postprocessMutation(
  store: EditorStore,
  toolName: string,
  transaction: MutationTransaction,
  signal?: AbortSignal
): Promise<void> {
  if (POSTPROCESS_FREE_TOOLS.has(toolName)) return
  const transactionPage = store.graph.getNode(transaction.pageId)
  const targetPageId =
    transactionPage?.type === 'CANVAS'
      ? transaction.pageId
      : (store.graph.getPages()[0]?.id ?? store.state.currentPageId)
  const pageNode = store.graph.getNode(targetPageId)
  if (pageNode) {
    await ensureGraphFonts(store.graph, pageNode.childIds, store.renderer, signal)
  }
  throwIfAborted(signal)
  await yieldToHost()
  throwIfAborted(signal)
  await computeAllLayoutsAsync(store.graph, targetPageId, signal)
  await yieldToHost()
  throwIfAborted(signal)
}

function recordSuccessfulMutation(
  store: EditorStore,
  toolName: string,
  transaction: MutationTransaction,
  signal?: AbortSignal
): SuccessfulSnapshot {
  if (transaction.scope === 'document') {
    const after = store.snapshotDocument()
    throwIfAborted(signal)
    store.pushUndoEntry({
      label: `AI: ${toolName}`,
      coalesceKey: transaction.coalesceKey,
      forward: () => store.restoreDocumentFromSnapshot(after),
      inverse: () => store.restoreDocumentFromSnapshot(transaction.before)
    })
    return {
      pageId: transaction.pageId,
      coalesceKey: transaction.coalesceKey,
      sceneVersion: store.state.sceneVersion,
      scope: transaction.scope,
      snapshot: after,
      undoRevision: store.undo.revision
    }
  }

  const after = store.snapshotPage(transaction.pageId)
  throwIfAborted(signal)
  store.pushUndoEntry({
    label: `AI: ${toolName}`,
    coalesceKey: transaction.coalesceKey,
    forward: () => store.restorePageFromSnapshot(after, transaction.pageId),
    inverse: () => store.restorePageFromSnapshot(transaction.before, transaction.pageId)
  })
  return {
    pageId: transaction.pageId,
    coalesceKey: transaction.coalesceKey,
    sceneVersion: store.state.sceneVersion,
    scope: transaction.scope,
    snapshot: after,
    undoRevision: store.undo.revision
  }
}

async function finalizeSuccessfulMutation(
  store: EditorStore,
  toolName: string,
  transaction: MutationTransaction,
  signal?: AbortSignal
): Promise<SuccessfulSnapshot | undefined> {
  await postprocessMutation(store, toolName, transaction, signal)
  store.requestRender()
  if (undoHistoryChanged(store, transaction)) return undefined
  return recordSuccessfulMutation(store, toolName, transaction, signal)
}

export function createAITools(store: EditorStore) {
  let activeMutation: MutationTransaction | undefined
  let lastSuccessfulSnapshot: SuccessfulSnapshot | undefined
  const runState = getRunState(store)
  // CodePen shadow tools require the full app EditorStore lifecycle. Keeping
  // them out of deliberately minimal headless/test stores also prevents a
  // failed optional tool setup from blocking disposal of the model runtime.
  const codePenToolsEnabled =
    typeof store.onSourceChanged === 'function' && typeof store.onEditorEvent === 'function'
  const codePenManager = codePenToolsEnabled ? getCodePenAIManager(store) : null
  const toolDefinitions = [
    ...CORE_TOOLS,
    ...EXTENDED_TOOLS.filter((definition) => VISUAL_INSPECTION_TOOL_NAMES.has(definition.name)),
    ...(codePenToolsEnabled ? createCodePenAITools(store) : [])
  ]

  const applicationTools = toolsToAI(
    toolDefinitions,
    {
      mutationKey: store,
      getFigma: () => makeFigmaFromStore(store),
      getToolContext: (def) => {
        if (def.name === 'render') return { deferLayout: true }
        if (def.name === 'export_motion_animation') {
          return { saveMotionExport: saveMotionAnimationResult }
        }
        if (MODULE_CREATION_POLICY_TOOLS.has(def.name)) {
          return { canCreateModule: canCreatePluginModule }
        }
        return undefined
      },
      onBeforeExecute: (def, { args, signal }) => {
        if (def.mutates && codePenManager?.hasActiveReconstruction()) {
          throw new Error(
            'Live-document mutation tools are disabled while a CodePen shadow reconstruction is active. Seal, review, or discard the shadow draft first.'
          )
        }
        if (def.mutates && !NON_GRAPH_MUTATION_TOOLS.has(def.name) && !signal?.aborted) {
          const { pageId, scope } = resolveEditorMutationScope(store, args, {
            forceDocument: DOCUMENT_SCOPE_TOOLS.has(def.name)
          })
          const coalesceKey = `${runState.undoCoalesceKey}:${scope}:${pageId}`
          const reusableBefore =
            lastSuccessfulSnapshot?.scope === scope &&
            lastSuccessfulSnapshot.pageId === pageId &&
            lastSuccessfulSnapshot.coalesceKey === coalesceKey &&
            lastSuccessfulSnapshot.sceneVersion === store.state.sceneVersion &&
            lastSuccessfulSnapshot.undoRevision === store.undo.revision
              ? lastSuccessfulSnapshot.snapshot
              : undefined
          const common = {
            pageId,
            coalesceKey,
            sceneVersionBefore: store.state.sceneVersion,
            undoRevisionBefore: store.undo.revision
          }
          activeMutation =
            scope === 'document'
              ? {
                  ...common,
                  scope,
                  before:
                    (reusableBefore as DocumentHistorySnapshot | undefined) ??
                    store.snapshotDocument()
                }
              : {
                  ...common,
                  scope,
                  before:
                    (reusableBefore as PageHistorySnapshot | undefined) ??
                    store.snapshotPage(pageId)
                }
        }
      },
      onAfterExecute: async (def, context) => {
        if (!def.mutates) return
        const transaction = activeMutation
        activeMutation = undefined
        if (!transaction) return

        const graphChanged = mutationChanged(store, transaction)
        const historyChanged = undoHistoryChanged(store, transaction)
        if (historyChanged) lastSuccessfulSnapshot = undefined
        if (context.status !== 'success' || context.signal?.aborted) {
          // The JSX renderer owns its creation transaction and removes every
          // partial root on failure/abort. A page-wide restore here would also
          // erase unrelated user edits made while a large tree was yielding.
          if (!graphChanged) return
          lastSuccessfulSnapshot = undefined
          if (!historyChanged && def.name !== 'render') restoreMutation(store, transaction)
          return
        }
        if (!graphChanged) return

        try {
          const successfulSnapshot = await finalizeSuccessfulMutation(
            store,
            def.name,
            transaction,
            context.signal
          )
          lastSuccessfulSnapshot = successfulSnapshot
        } catch (error) {
          lastSuccessfulSnapshot = undefined
          if (!undoHistoryChanged(store, transaction)) restoreMutation(store, transaction)
          throw error
        }
      },
      onFlashNodes: (nodeIds) => {
        store.renderer?.aiClearActive()
        if (nodeIds.length > 0) {
          store.aiFlashDone(nodeIds)
        }
      },
      onToolLog: (entry) => {
        runState.recordTool(entry)
      },
      getStepBudget: (): StepBudget => ({
        current: runState.currentSteps,
        max: MAX_AGENT_STEPS
      })
    },
    { v, valibotSchema, tool }
  )

  return { ...applicationTools, inspect_visual: createVisualInspectionTool(store) }
}

function throwIfAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) return
  const error = new Error('AI tool transaction cancelled')
  error.name = 'AbortError'
  throw error
}

export type AITools = ReturnType<typeof createAITools>
