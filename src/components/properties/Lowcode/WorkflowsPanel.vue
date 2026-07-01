<script setup lang="ts">
import { computed, ref } from 'vue'
import type { ComponentPublicInstance } from 'vue'
import type {
  DocumentStateDef,
  SceneNode,
  StateDef,
  WorkflowDef
} from '@open-pencil/core/scene-graph'
import { useSceneComputed } from '@open-pencil/vue'
import { useSectionUI } from '@/components/ui/section'

import { useEditorStore } from '@/app/editor/active-store'
import { requestLowcodeActionFocus } from '@/app/lowcode/action-focus'
import {
  analyzeWorkflowGraph,
  collectWorkflowEntrypoints,
  type WorkflowGraphEdge,
  type WorkflowGraphEntrypoint
} from '@/app/lowcode/workflow-graph'

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
const workflowEntrypoints = useSceneComputed(() =>
  collectWorkflowEntrypoints([...editor.graph.getAllNodes()], workflows.value)
)
const workflowGraph = computed(() =>
  analyzeWorkflowGraph(workflows.value, { entrypoints: workflowEntrypoints.value })
)
const graphDetailsOpen = ref(false)
type GraphMapFilter = 'all' | 'issues' | 'entries'
const graphMapFilter = ref<GraphMapFilter>('all')
const expandedGraphMapSourceIds = ref<Set<string>>(new Set())
const graphMapIssueIds = computed(
  () => new Set(workflowGraph.value.issues.flatMap((issue) => issue.workflowIds))
)
const graphMapEntryIds = computed(
  () =>
    new Set(
      workflowGraph.value.nodes.filter((node) => node.entrypoints.length > 0).map((node) => node.id)
    )
)
const graphMapNodes = computed(() => {
  switch (graphMapFilter.value) {
    case 'issues':
      return workflowGraph.value.nodes.filter((node) => node.issues.length > 0)
    case 'entries':
      return workflowGraph.value.nodes.filter((node) => node.entrypoints.length > 0)
    default:
      return workflowGraph.value.nodes
  }
})
const graphMapEdges = computed(() => {
  switch (graphMapFilter.value) {
    case 'issues':
      return workflowGraph.value.edges.filter(
        (edge) =>
          !edge.toName ||
          (graphMapIssueIds.value.has(edge.fromId) && graphMapIssueIds.value.has(edge.toId))
      )
    case 'entries':
      return workflowGraph.value.edges.filter(
        (edge) => graphMapEntryIds.value.has(edge.fromId) || graphMapEntryIds.value.has(edge.toId)
      )
    default:
      return workflowGraph.value.edges
  }
})
type WorkflowRowHandle = ComponentPublicInstance & { focusRow: () => void }
const workflowRowRefs = new Map<string, WorkflowRowHandle>()

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

function jumpToWorkflow(workflowId: string | undefined): void {
  if (!workflowId) return
  workflowRowRefs.get(workflowId)?.focusRow()
}

function jumpToEntrypointSource(entrypoint: WorkflowGraphEntrypoint): void {
  const node = editor.graph.getNode(entrypoint.nodeId)
  if (!node) return
  requestLowcodeActionFocus({
    nodeId: node.id,
    actionId: entrypoint.actionId,
    actionPath: entrypoint.actionPath
  })
  const pageId = containingPageId(node)
  if (pageId && pageId !== editor.state.currentPageId) editor.switchPage(pageId)
  editor.select([node.id])
  editor.requestRender()
}

function setWorkflowRowRef(
  workflowId: string,
  row: Element | ComponentPublicInstance | null
): void {
  if (row) workflowRowRefs.set(workflowId, row as WorkflowRowHandle)
  else workflowRowRefs.delete(workflowId)
}

function entrypointLabel(count: number): string {
  return count === 1 ? '1 entry' : `${count} entries`
}

function workflowGraphNodeName(workflowId: string): string {
  return workflowGraph.value.nodes.find((node) => node.id === workflowId)?.name ?? workflowId
}

function graphMapNodeJumpLabel(nodeName: string): string {
  return `Jump to ${nodeName} workflow`
}

function graphMapEdgeJumpLabel(edge: WorkflowGraphEdge): string {
  return `Jump to ${edge.toName ?? edge.toId} workflow from ${edge.fromName}`
}

function entrypointSourceLabel(entrypoint: WorkflowGraphEntrypoint): string {
  return `${entrypoint.nodeName} ${entrypoint.eventName}`
}

function entrypointSourceJumpLabel(entrypoint: WorkflowGraphEntrypoint): string {
  return `Jump to ${entrypointSourceLabel(entrypoint)} source`
}

function isGraphMapSourceExpanded(workflowId: string): boolean {
  return expandedGraphMapSourceIds.value.has(workflowId)
}

function toggleGraphMapSources(workflowId: string): void {
  const next = new Set(expandedGraphMapSourceIds.value)
  if (next.has(workflowId)) next.delete(workflowId)
  else next.add(workflowId)
  expandedGraphMapSourceIds.value = next
}

function collapseGraphMapSources(workflowId: string, event?: KeyboardEvent): void {
  if (!expandedGraphMapSourceIds.value.has(workflowId)) return
  const focusTarget =
    event?.currentTarget instanceof HTMLElement ? event.currentTarget.previousElementSibling : null
  const next = new Set(expandedGraphMapSourceIds.value)
  next.delete(workflowId)
  expandedGraphMapSourceIds.value = next
  if (focusTarget instanceof HTMLElement) focusTarget.focus()
}

function graphMapSourceListId(workflowId: string): string {
  return `lowcode-workflow-graph-map-sources-${workflowId}`
}

function countLabel(count: number, singular: string): string {
  return `${count} ${count === 1 ? singular : `${singular}s`}`
}

function graphMapSummaryLabel(): string {
  return `${countLabel(graphMapNodes.value.length, 'node')}, ${countLabel(
    graphMapEdges.value.length,
    'edge'
  )}`
}

function graphMapNodeEmptyLabel(): string {
  switch (graphMapFilter.value) {
    case 'issues':
      return 'No workflows with issues.'
    case 'entries':
      return 'No workflows with entries.'
    default:
      return 'No workflows.'
  }
}

function graphMapEdgeEmptyLabel(): string {
  switch (graphMapFilter.value) {
    case 'issues':
      return 'No issue edges.'
    case 'entries':
      return 'No entry edges.'
    default:
      return 'No workflow calls.'
  }
}

function containingPageId(node: SceneNode): string | undefined {
  let current: SceneNode | undefined = node
  while (current) {
    if (current.type === 'CANVAS') return current.id
    current = current.parentId ? editor.graph.getNode(current.parentId) : undefined
  }
  return undefined
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

    <div
      v-if="workflows.length > 0"
      data-test-id="lowcode-workflow-graph-summary"
      class="mb-1 flex flex-col gap-1 border-l border-border pl-2 text-[10px]"
    >
      <div class="flex items-center justify-between gap-2">
        <p class="text-muted">
          {{ workflowGraph.workflowCount }} workflows, {{ workflowGraph.actionCount }} actions,
          {{ workflowGraph.callCount }} calls, {{ entrypointLabel(workflowGraph.entrypointCount) }}
        </p>
        <button
          type="button"
          data-test-id="lowcode-workflow-graph-toggle"
          class="shrink-0 rounded px-1 py-0.5 text-[10px] text-muted hover:bg-hover hover:text-surface"
          @click="graphDetailsOpen = !graphDetailsOpen"
        >
          {{ graphDetailsOpen ? 'Hide details' : 'Show details' }}
        </button>
      </div>
      <p v-if="workflowGraph.issues.length === 0" class="text-muted">No workflow graph issues.</p>
      <ul v-else class="flex flex-col gap-0.5 text-red-500">
        <li
          v-for="(issue, index) in workflowGraph.issues"
          :key="`${issue.type}-${index}`"
          data-test-id="lowcode-workflow-graph-issue"
          class="flex items-center justify-between gap-2"
        >
          <span class="min-w-0">{{ issue.message }}</span>
          <button
            v-if="issue.targetWorkflowId"
            type="button"
            data-test-id="lowcode-workflow-graph-jump"
            class="shrink-0 rounded px-1 py-0.5 text-[10px] text-muted hover:bg-hover hover:text-surface"
            @click="jumpToWorkflow(issue.targetWorkflowId)"
          >
            Jump
          </button>
        </li>
      </ul>
      <ul
        v-if="workflowGraph.workflowsWithoutEntrypoints.length > 0"
        class="flex flex-col gap-0.5 text-muted"
      >
        <li
          v-for="workflowId in workflowGraph.workflowsWithoutEntrypoints"
          :key="workflowId"
          data-test-id="lowcode-workflow-graph-entrypoint"
          class="flex items-center justify-between gap-2"
        >
          <span class="min-w-0">No event entry: {{ workflowGraphNodeName(workflowId) }}</span>
          <button
            type="button"
            data-test-id="lowcode-workflow-graph-entrypoint-jump"
            class="shrink-0 rounded px-1 py-0.5 text-[10px] text-muted hover:bg-hover hover:text-surface"
            @click="jumpToWorkflow(workflowId)"
          >
            Jump
          </button>
        </li>
      </ul>
      <div
        v-if="graphDetailsOpen"
        data-test-id="lowcode-workflow-graph-map"
        class="flex flex-col gap-1 border-l border-border pl-2 text-muted"
      >
        <div class="flex flex-wrap items-center justify-between gap-1">
          <div data-test-id="lowcode-workflow-graph-map-filter" class="flex flex-wrap gap-1">
            <button
              type="button"
              data-test-id="lowcode-workflow-graph-map-filter-all"
              class="rounded px-1 py-0.5 text-[10px] text-muted hover:bg-hover hover:text-surface"
              :class="graphMapFilter === 'all' ? 'bg-hover text-surface' : ''"
              @click="graphMapFilter = 'all'"
            >
              All
            </button>
            <button
              type="button"
              data-test-id="lowcode-workflow-graph-map-filter-issues"
              class="rounded px-1 py-0.5 text-[10px] text-muted hover:bg-hover hover:text-surface"
              :class="graphMapFilter === 'issues' ? 'bg-hover text-surface' : ''"
              @click="graphMapFilter = 'issues'"
            >
              Issues
            </button>
            <button
              type="button"
              data-test-id="lowcode-workflow-graph-map-filter-entries"
              class="rounded px-1 py-0.5 text-[10px] text-muted hover:bg-hover hover:text-surface"
              :class="graphMapFilter === 'entries' ? 'bg-hover text-surface' : ''"
              @click="graphMapFilter = 'entries'"
            >
              Entries
            </button>
          </div>
          <span data-test-id="lowcode-workflow-graph-map-summary" class="text-[9px] text-muted/80">
            {{ graphMapSummaryLabel() }}
          </span>
        </div>
        <div v-if="graphMapNodes.length > 0" class="flex flex-wrap gap-1">
          <div
            v-for="node in graphMapNodes"
            :key="node.id"
            data-test-id="lowcode-workflow-graph-map-node"
            class="flex max-w-full flex-col gap-0.5 rounded border border-border px-1.5 py-0.5 text-[10px]"
          >
            <button
              type="button"
              data-test-id="lowcode-workflow-graph-map-node-jump"
              :aria-label="graphMapNodeJumpLabel(node.name)"
              :title="graphMapNodeJumpLabel(node.name)"
              class="flex max-w-full flex-col gap-0.5 rounded text-left hover:text-surface focus:bg-hover focus:text-surface"
              @click="jumpToWorkflow(node.id)"
              @keydown.enter.prevent="jumpToWorkflow(node.id)"
              @keydown.space.prevent="jumpToWorkflow(node.id)"
            >
              <span class="flex max-w-full items-center gap-1">
                <span class="min-w-0 truncate">{{ node.name }}</span>
                <span
                  v-if="node.issues.length > 0"
                  data-test-id="lowcode-workflow-graph-map-node-issue"
                  class="shrink-0 text-red-500"
                >
                  issue
                </span>
              </span>
              <span
                data-test-id="lowcode-workflow-graph-map-node-stats"
                class="text-[9px] text-muted"
              >
                {{ node.entrypoints.length }}e / {{ node.incoming.length }}i /
                {{ node.outgoing.length }}o / {{ node.actionCount }}a
              </span>
            </button>
            <div
              v-if="node.entrypoints.length > 0"
              data-test-id="lowcode-workflow-graph-map-node-entrypoint"
              class="flex items-center justify-between gap-1 text-[9px]"
            >
              <span class="min-w-0 truncate">
                {{ entrypointSourceLabel(node.entrypoints[0]) }}
              </span>
              <button
                type="button"
                data-test-id="lowcode-workflow-graph-map-node-entrypoint-jump"
                :aria-label="entrypointSourceJumpLabel(node.entrypoints[0])"
                :title="entrypointSourceJumpLabel(node.entrypoints[0])"
                class="min-w-11 shrink-0 rounded px-1 py-0.5 text-center text-[9px] text-muted hover:bg-hover hover:text-surface focus:bg-hover focus:text-surface"
                @click="jumpToEntrypointSource(node.entrypoints[0])"
              >
                Source
              </button>
            </div>
            <button
              v-if="node.entrypoints.length > 1"
              type="button"
              data-test-id="lowcode-workflow-graph-map-node-entrypoint-more"
              :aria-controls="graphMapSourceListId(node.id)"
              :aria-expanded="isGraphMapSourceExpanded(node.id)"
              :aria-label="
                isGraphMapSourceExpanded(node.id)
                  ? `Hide additional sources for ${node.name}`
                  : `Show ${node.entrypoints.length - 1} more sources for ${node.name}`
              "
              class="self-start rounded border border-transparent px-1 py-0.5 text-[9px] text-muted hover:border-border hover:bg-hover hover:text-surface focus:border-border focus:bg-hover focus:text-surface"
              @click="toggleGraphMapSources(node.id)"
            >
              {{
                isGraphMapSourceExpanded(node.id)
                  ? 'Hide sources'
                  : `+${node.entrypoints.length - 1} more`
              }}
            </button>
            <ul
              v-if="node.entrypoints.length > 1 && isGraphMapSourceExpanded(node.id)"
              :id="graphMapSourceListId(node.id)"
              data-test-id="lowcode-workflow-graph-map-node-entrypoint-list"
              :aria-label="`Additional sources for ${node.name}`"
              class="ml-1 flex flex-col gap-0.5 border-l border-border pl-1"
              @keydown.escape.stop.prevent="collapseGraphMapSources(node.id, $event)"
            >
              <li
                v-for="entrypoint in node.entrypoints.slice(1)"
                :key="`${entrypoint.nodeId}-${entrypoint.eventName}-${entrypoint.actionId}`"
                data-test-id="lowcode-workflow-graph-map-node-entrypoint-extra"
                class="flex items-center justify-between gap-1 rounded bg-hover/40 px-1 py-0.5 text-[9px]"
              >
                <span class="min-w-0 truncate">
                  {{ entrypointSourceLabel(entrypoint) }}
                </span>
                <button
                  type="button"
                  data-test-id="lowcode-workflow-graph-map-node-entrypoint-extra-jump"
                  :aria-label="entrypointSourceJumpLabel(entrypoint)"
                  :title="entrypointSourceJumpLabel(entrypoint)"
                  class="min-w-11 shrink-0 rounded px-1 py-0.5 text-center text-[9px] text-muted hover:bg-hover hover:text-surface focus:bg-hover focus:text-surface"
                  @click="jumpToEntrypointSource(entrypoint)"
                >
                  Source
                </button>
              </li>
            </ul>
          </div>
        </div>
        <p
          v-else
          data-test-id="lowcode-workflow-graph-map-node-empty"
          class="text-[10px] text-muted"
        >
          {{ graphMapNodeEmptyLabel() }}
        </p>
        <ul v-if="graphMapEdges.length > 0" class="flex flex-col gap-0.5">
          <li
            v-for="edge in graphMapEdges"
            :key="`${edge.fromId}-${edge.actionId}-${edge.toId}`"
            data-test-id="lowcode-workflow-graph-map-edge"
            class="flex items-center justify-between gap-2"
          >
            <span class="min-w-0">
              {{ edge.fromName }} -> {{ edge.toName ?? edge.toId }}
              <span v-if="!edge.toName" class="text-red-500">missing</span>
            </span>
            <button
              v-if="edge.toName"
              type="button"
              data-test-id="lowcode-workflow-graph-map-edge-jump"
              :aria-label="graphMapEdgeJumpLabel(edge)"
              :title="graphMapEdgeJumpLabel(edge)"
              class="shrink-0 rounded px-1 py-0.5 text-[10px] text-muted hover:bg-hover hover:text-surface focus:bg-hover focus:text-surface"
              @click="jumpToWorkflow(edge.toId)"
              @keydown.enter.prevent="jumpToWorkflow(edge.toId)"
              @keydown.space.prevent="jumpToWorkflow(edge.toId)"
            >
              Jump
            </button>
          </li>
        </ul>
        <p
          v-else-if="graphMapNodes.length > 0"
          data-test-id="lowcode-workflow-graph-map-edge-empty"
          class="text-[10px] text-muted"
        >
          {{ graphMapEdgeEmptyLabel() }}
        </p>
      </div>
      <ul v-if="graphDetailsOpen" class="flex flex-col gap-1.5 text-muted">
        <li
          v-for="node in workflowGraph.nodes"
          :key="node.id"
          data-test-id="lowcode-workflow-graph-node"
          class="flex flex-col gap-1 border-l border-border pl-2"
        >
          <div class="flex items-center justify-between gap-2">
            <span class="min-w-0">
              {{ node.name }}: {{ entrypointLabel(node.entrypoints.length) }} /
              {{ node.incoming.length }} in / {{ node.outgoing.length }} out /
              {{ node.actionCount }} actions
            </span>
            <button
              type="button"
              data-test-id="lowcode-workflow-graph-node-jump"
              class="shrink-0 rounded px-1 py-0.5 text-[10px] text-muted hover:bg-hover hover:text-surface"
              @click="jumpToWorkflow(node.id)"
            >
              Jump
            </button>
          </div>
          <div class="flex flex-col gap-0.5 pl-1">
            <span class="text-[9px] uppercase text-muted/80">Entries</span>
            <p
              v-if="node.entrypoints.length === 0"
              data-test-id="lowcode-workflow-graph-entry-empty"
              class="text-[10px] text-muted"
            >
              none
            </p>
            <ul v-else class="flex flex-col gap-0.5">
              <li
                v-for="entrypoint in node.entrypoints"
                :key="`${entrypoint.nodeId}-${entrypoint.eventName}-${entrypoint.actionId}`"
                data-test-id="lowcode-workflow-graph-entrypoint-source"
                class="flex items-center justify-between gap-2"
              >
                <span class="min-w-0"> {{ entrypoint.nodeName }} {{ entrypoint.eventName }} </span>
                <button
                  type="button"
                  data-test-id="lowcode-workflow-graph-entrypoint-source-jump"
                  class="shrink-0 rounded px-1 py-0.5 text-[10px] text-muted hover:bg-hover hover:text-surface"
                  @click="jumpToEntrypointSource(entrypoint)"
                >
                  Source
                </button>
              </li>
            </ul>
          </div>
          <div class="flex flex-col gap-0.5 pl-1">
            <span class="text-[9px] uppercase text-muted/80">Calls out</span>
            <p
              v-if="node.outgoing.length === 0"
              data-test-id="lowcode-workflow-graph-out-empty"
              class="text-[10px] text-muted"
            >
              none
            </p>
            <ul v-else class="flex flex-col gap-0.5">
              <li
                v-for="edge in node.outgoing"
                :key="`${edge.actionId}-${edge.toId}`"
                data-test-id="lowcode-workflow-graph-out-edge"
                class="flex items-center justify-between gap-2"
              >
                <span class="min-w-0">to {{ edge.toName ?? edge.toId }}</span>
                <button
                  v-if="edge.toName"
                  type="button"
                  data-test-id="lowcode-workflow-graph-edge-jump"
                  class="shrink-0 rounded px-1 py-0.5 text-[10px] text-muted hover:bg-hover hover:text-surface"
                  @click="jumpToWorkflow(edge.toId)"
                >
                  Jump
                </button>
              </li>
            </ul>
          </div>
          <div class="flex flex-col gap-0.5 pl-1">
            <span class="text-[9px] uppercase text-muted/80">Called by</span>
            <p
              v-if="node.incoming.length === 0"
              data-test-id="lowcode-workflow-graph-in-empty"
              class="text-[10px] text-muted"
            >
              none
            </p>
            <ul v-else class="flex flex-col gap-0.5">
              <li
                v-for="edge in node.incoming"
                :key="`${edge.fromId}-${edge.actionId}`"
                data-test-id="lowcode-workflow-graph-in-edge"
                class="flex items-center justify-between gap-2"
              >
                <span class="min-w-0">from {{ edge.fromName }}</span>
                <button
                  type="button"
                  data-test-id="lowcode-workflow-graph-edge-jump"
                  class="shrink-0 rounded px-1 py-0.5 text-[10px] text-muted hover:bg-hover hover:text-surface"
                  @click="jumpToWorkflow(edge.fromId)"
                >
                  Jump
                </button>
              </li>
            </ul>
          </div>
        </li>
      </ul>
    </div>

    <ul v-if="workflows.length > 0" class="flex flex-col gap-2">
      <WorkflowRow
        v-for="wf in workflows"
        :key="wf.id"
        :workflow="wf"
        :workflows="workflows"
        :pages="pages"
        :page-states="pageStatesFor(wf)"
        :doc-states="docStates"
        :analytics-configured="analyticsConfigured"
        :ref="(row) => setWorkflowRowRef(wf.id, row)"
        @update:workflow="updateWorkflow(wf.id, $event)"
        @remove="removeWorkflow(wf.id)"
      />
    </ul>
  </div>
</template>
