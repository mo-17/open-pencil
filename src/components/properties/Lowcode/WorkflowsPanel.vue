<script setup lang="ts">
import type {
  DocumentStateDef,
  SceneNode,
  StateDef,
  WorkflowDef
} from '@open-pencil/core/scene-graph'
import { useSceneComputed } from '@open-pencil/vue'
import { useSectionUI } from '@/components/ui/section'

import { useEditorStore } from '@/app/editor/active-store'

import WorkflowRow from './WorkflowRow.vue'

/**
 * Phase 3 §10 v11 — document-level named-workflow manager. Workflows live on the
 * root node (`root.lowcodeWorkflows`), like Document State, and are invoked by id
 * from any node's event chain (or another workflow) via a `callWorkflow` action;
 * the compiler expands each chain inline at the call site. Mirrors
 * `DocumentStatePanel`'s root-node useSceneComputed + updateNodeWithUndo pattern.
 * Shown in the no-node-selected branch of the design panel. The recursive
 * `ActionList` editor (via `WorkflowRow`) makes each workflow body visible +
 * fine-tunable; MCP `set_workflows` stays the authoritative bulk backstop.
 */
const editor = useEditorStore()
const sectionCls = useSectionUI()

const workflows = useSceneComputed<WorkflowDef[]>(() => {
  const root = editor.graph.getNode(editor.graph.rootId)
  return root?.lowcodeWorkflows ?? []
})

interface WorkflowPage {
  id: string
  name: string
  state: StateDef[]
}

const pages = useSceneComputed<WorkflowPage[]>(() => {
  return editor.graph.getPages().map((page: SceneNode) => ({
    id: page.id,
    name: page.name || 'Page',
    state: page.state ?? []
  }))
})

const docStates = useSceneComputed<DocumentStateDef[]>(() => {
  const root = editor.graph.getNode(editor.graph.rootId)
  return root?.lowcodeDocumentState ?? []
})

const analyticsConfigured = useSceneComputed<boolean>(() => {
  const config = editor.graph.getNode(editor.graph.rootId)?.lowcodeAnalyticsConfig
  return config?.enabled !== false && !!config?.id?.trim()
})

function commit(next: WorkflowDef[]): void {
  editor.updateNodeWithUndo(
    editor.graph.rootId,
    { lowcodeWorkflows: next.length > 0 ? next : undefined },
    'Update workflows'
  )
}

function addWorkflow(): void {
  commit([
    ...workflows.value,
    {
      id: crypto.randomUUID(),
      name: 'Workflow',
      pageId: editor.state.currentPageId,
      actions: []
    }
  ])
}
function updateWorkflow(id: string, next: WorkflowDef): void {
  commit(workflows.value.map((w) => (w.id === id ? next : w)))
}
function removeWorkflow(id: string): void {
  commit(workflows.value.filter((w) => w.id !== id))
}

function pageStatesFor(workflow: WorkflowDef): StateDef[] {
  const pageId = workflow.pageId ?? editor.state.currentPageId
  return pages.value.find((page) => page.id === pageId)?.state ?? []
}
</script>

<template>
  <div data-test-id="lowcode-workflows-section" :class="sectionCls.wrapper">
    <div class="mb-1.5 flex items-center justify-between">
      <label class="text-[11px] text-muted">Workflows</label>
      <button
        type="button"
        data-test-id="lowcode-workflow-add"
        class="rounded px-1.5 py-0.5 text-[11px] text-muted hover:bg-hover hover:text-surface"
        @click="addWorkflow"
      >
        + Workflow
      </button>
    </div>

    <p v-if="workflows.length === 0" class="text-[11px] text-muted">
      No workflows yet. A workflow is a reusable action chain callable from any event.
    </p>

    <ul v-else class="flex flex-col gap-2">
      <WorkflowRow
        v-for="wf in workflows"
        :key="wf.id"
        :workflow="wf"
        :workflows="workflows"
        :pages="pages"
        :page-states="pageStatesFor(wf)"
        :doc-states="docStates"
        :analytics-configured="analyticsConfigured"
        @update:workflow="updateWorkflow(wf.id, $event)"
        @remove="removeWorkflow(wf.id)"
      />
    </ul>
  </div>
</template>
