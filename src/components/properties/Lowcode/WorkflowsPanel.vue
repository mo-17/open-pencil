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
  type WorkflowGraphEntrypoint,
  type WorkflowGraphIssue,
  type WorkflowGraphNode
} from '@/app/lowcode/workflow-graph'

import WorkflowRow from './WorkflowRow.vue'
import {
  graphMapEdgeBranchLabel,
  graphMapEdgeMatchesSearch,
  graphMapEdgeSearchMatchId,
  graphMapNodeMatchesSearch,
  graphMapNodeSearchMatchId,
  nextGraphMapSearchMatchId
} from './workflow-graph-map-search'

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
const graphMapSearchQuery = ref('')
const graphMapSearchInput = ref<HTMLInputElement | null>(null)
const activeGraphMapSearchMatchId = ref<string | null>(null)
const expandedGraphMapSourceIds = ref<Set<string>>(new Set())
const collapsedGraphMapNodeGroupKinds = ref<Set<GraphMapNodeGroupKind>>(new Set())
const collapsedGraphMapEdgeGroupKinds = ref<Set<GraphMapEdgeGroupKind>>(new Set())
const graphMapIssueIds = computed(
  () => new Set(workflowGraph.value.issues.flatMap((issue) => issue.workflowIds))
)
const graphMapEntryIds = computed(
  () =>
    new Set(
      workflowGraph.value.nodes.filter((node) => node.entrypoints.length > 0).map((node) => node.id)
    )
)
const graphMapSearchTerm = computed(() => graphMapSearchQuery.value.trim().toLowerCase())
const graphMapBaseNodes = computed(() => {
  switch (graphMapFilter.value) {
    case 'issues':
      return workflowGraph.value.nodes.filter((node) => node.issues.length > 0)
    case 'entries':
      return workflowGraph.value.nodes.filter((node) => node.entrypoints.length > 0)
    default:
      return workflowGraph.value.nodes
  }
})
const graphMapBaseEdges = computed(() => {
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
const graphMapMatchedEdges = computed(() => {
  const term = graphMapSearchTerm.value
  if (!term) return []
  return graphMapBaseEdges.value.filter((edge) => graphMapEdgeMatchesSearch(edge, term))
})
const graphMapMatchedNodeIds = computed(() => {
  const term = graphMapSearchTerm.value
  if (!term) return new Set<string>()
  return new Set(
    graphMapBaseNodes.value
      .filter((node) => graphMapNodeMatchesSearch(node, term))
      .map((node) => node.id)
  )
})
const graphMapNodes = computed(() => {
  const term = graphMapSearchTerm.value
  if (!term) return graphMapBaseNodes.value
  const edgeNodeIds = new Set<string>()
  for (const edge of graphMapMatchedEdges.value) {
    edgeNodeIds.add(edge.fromId)
    edgeNodeIds.add(edge.toId)
  }
  return graphMapBaseNodes.value.filter(
    (node) => graphMapMatchedNodeIds.value.has(node.id) || edgeNodeIds.has(node.id)
  )
})
const graphMapEdges = computed(() => {
  const term = graphMapSearchTerm.value
  if (!term) return graphMapBaseEdges.value
  return graphMapBaseEdges.value.filter(
    (edge) =>
      graphMapEdgeMatchesSearch(edge, term) ||
      graphMapMatchedNodeIds.value.has(edge.fromId) ||
      graphMapMatchedNodeIds.value.has(edge.toId)
  )
})
const graphMapBaseIssues = computed(() => {
  switch (graphMapFilter.value) {
    case 'entries':
      return workflowGraph.value.issues.filter((issue) =>
        issue.workflowIds.some((workflowId) => graphMapEntryIds.value.has(workflowId))
      )
    default:
      return workflowGraph.value.issues
  }
})
const graphMapIssues = computed(() => {
  const term = graphMapSearchTerm.value
  if (!term) return graphMapBaseIssues.value
  const nodeIds = new Set(graphMapNodes.value.map((node) => node.id))
  const hasDirectNodeMatch = graphMapMatchedNodeIds.value.size > 0
  return graphMapBaseIssues.value.filter(
    (issue) =>
      issue.message.toLowerCase().includes(term) ||
      issue.workflowIds.some((workflowId) => workflowId.toLowerCase().includes(term)) ||
      (hasDirectNodeMatch && issue.workflowIds.some((workflowId) => nodeIds.has(workflowId)))
  )
})
type GraphMapNodeGroupKind = 'issues' | 'entries' | 'called'
interface GraphMapNodeGroup {
  kind: GraphMapNodeGroupKind
  title: string
  nodes: WorkflowGraphNode[]
}
const graphMapNodeGroups = computed<GraphMapNodeGroup[]>(() => {
  const groups: GraphMapNodeGroup[] = [
    { kind: 'issues', title: 'Issues', nodes: [] },
    { kind: 'entries', title: 'Entries', nodes: [] },
    { kind: 'called', title: 'Called', nodes: [] }
  ]
  const byKind = new Map(groups.map((group) => [group.kind, group]))

  for (const node of graphMapNodes.value) {
    byKind.get(graphMapNodeGroupKind(node))?.nodes.push(node)
  }

  return groups.filter((group) => group.nodes.length > 0)
})
type GraphMapEdgeGroupKind = 'calls' | 'missing'
interface GraphMapEdgeGroup {
  kind: GraphMapEdgeGroupKind
  title: string
  edges: WorkflowGraphEdge[]
}
const graphMapEdgeGroups = computed<GraphMapEdgeGroup[]>(() => {
  const groups: GraphMapEdgeGroup[] = [
    { kind: 'calls', title: 'Calls', edges: [] },
    { kind: 'missing', title: 'Missing', edges: [] }
  ]
  const byKind = new Map(groups.map((group) => [group.kind, group]))

  for (const edge of graphMapEdges.value) {
    byKind.get(edge.toName ? 'calls' : 'missing')?.edges.push(edge)
  }

  return groups.filter((group) => group.edges.length > 0)
})
type WorkflowRowHandle = ComponentPublicInstance & {
  focusRow: () => void
  focusAction: (actionPath: string) => Promise<boolean>
}
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

async function jumpToWorkflowAction(edge: WorkflowGraphEdge): Promise<void> {
  const row = workflowRowRefs.get(edge.fromId)
  if (!row) return
  if (await row.focusAction(edge.actionPath)) return
  row.focusRow()
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

function graphMapMissingEdgeLabel(edge: WorkflowGraphEdge): string {
  return `Missing workflow ${edge.toId} called from ${edge.fromName}`
}

function graphMapMissingEdgeSourceJumpLabel(edge: WorkflowGraphEdge): string {
  return `Jump to ${edge.fromName} workflow to fix missing ${edge.toId}`
}

function graphMapEdgeSourceActionJumpLabel(edge: WorkflowGraphEdge): string {
  return `Jump to ${edge.fromName} workflow action ${edge.actionId} at ${edge.actionPath}`
}

function graphMapEdgeTargetLabel(edge: WorkflowGraphEdge): string {
  return edge.toName ?? edge.toId
}

function graphMapEdgePathLabel(edge: WorkflowGraphEdge): string {
  return `${edge.fromName} calls ${graphMapEdgeTargetLabel(edge)} from action ${edge.actionId}`
}

function graphMapEdgeActionLabel(edge: WorkflowGraphEdge): string {
  return `Action ${edge.actionId}`
}

function graphMapEdgeActionKindLabel(edge: WorkflowGraphEdge): string {
  return `Kind ${edge.actionKind}`
}

function graphMapEdgeBranchTitle(edge: WorkflowGraphEdge): string {
  return `${graphMapEdgeBranchLabel(edge)} branch at ${edge.actionPath}`
}

function graphMapIssueTypeLabel(issue: WorkflowGraphIssue): string {
  return issue.type === 'cycle' ? 'Cycle' : 'Missing'
}

function graphMapIssueJumpLabel(issue: WorkflowGraphIssue): string {
  const target = issue.targetWorkflowId ? workflowGraphNodeName(issue.targetWorkflowId) : 'target'
  return `Jump to ${target} workflow for issue: ${issue.message}`
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

function countLabel(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`
}

function graphMapSummaryLabel(): string {
  return `${countLabel(graphMapNodes.value.length, 'node')}, ${countLabel(
    graphMapEdges.value.length,
    'edge'
  )}`
}

function graphMapIssueSummaryLabel(): string {
  const issueCount = countLabel(graphMapIssues.value.length, 'issue')
  const typeSummary = graphMapIssueTypeSummaryLabel(graphMapIssues.value)
  const suffix = typeSummary ? ` · ${typeSummary}` : ''
  switch (graphMapFilter.value) {
    case 'issues':
      return `${issueCount} in issue filter${suffix}`
    case 'entries':
      return `${issueCount} touching entry workflows${suffix}`
    default:
      return `${issueCount} total${suffix}`
  }
}

function graphMapIssueTypeSummaryLabel(issues: readonly WorkflowGraphIssue[]): string {
  const missingCount = issues.filter((issue) => issue.type === 'missing-workflow').length
  const cycleCount = issues.filter((issue) => issue.type === 'cycle').length
  return [
    missingCount > 0 ? countLabel(missingCount, 'missing', 'missing') : '',
    cycleCount > 0 ? countLabel(cycleCount, 'cycle') : ''
  ]
    .filter(Boolean)
    .join(', ')
}

function graphMapNodeIssueLabel(count: number): string {
  return countLabel(count, 'issue')
}

function graphMapNodeIssueTitle(nodeName: string, count: number): string {
  return `${nodeName} has ${graphMapNodeIssueLabel(count)}`
}

function graphMapNodeGroupKind(node: WorkflowGraphNode): GraphMapNodeGroupKind {
  switch (graphMapFilter.value) {
    case 'issues':
      return 'issues'
    case 'entries':
      return 'entries'
    default:
      if (node.issues.length > 0) return 'issues'
      if (node.entrypoints.length > 0) return 'entries'
      return 'called'
  }
}

function isGraphMapNodeGroupCollapsed(kind: GraphMapNodeGroupKind): boolean {
  return collapsedGraphMapNodeGroupKinds.value.has(kind)
}

function toggleGraphMapNodeGroup(kind: GraphMapNodeGroupKind): void {
  const next = new Set(collapsedGraphMapNodeGroupKinds.value)
  if (next.has(kind)) next.delete(kind)
  else next.add(kind)
  collapsedGraphMapNodeGroupKinds.value = next
}

function graphMapNodeGroupToggleLabel(group: GraphMapNodeGroup): string {
  return `${isGraphMapNodeGroupCollapsed(group.kind) ? 'Show' : 'Hide'} ${group.title} workflow group`
}

function graphMapGroupCountLabel(count: number): string {
  return countLabel(count, 'workflow')
}

function isGraphMapEdgeGroupCollapsed(kind: GraphMapEdgeGroupKind): boolean {
  return collapsedGraphMapEdgeGroupKinds.value.has(kind)
}

function toggleGraphMapEdgeGroup(kind: GraphMapEdgeGroupKind): void {
  const next = new Set(collapsedGraphMapEdgeGroupKinds.value)
  if (next.has(kind)) next.delete(kind)
  else next.add(kind)
  collapsedGraphMapEdgeGroupKinds.value = next
}

function graphMapEdgeGroupToggleLabel(group: GraphMapEdgeGroup): string {
  return `${isGraphMapEdgeGroupCollapsed(group.kind) ? 'Show' : 'Hide'} ${group.title} edge group`
}

function graphMapEdgeGroupCountLabel(count: number): string {
  return countLabel(count, 'edge')
}

function clearGraphMapSearch(): void {
  graphMapSearchQuery.value = ''
  activeGraphMapSearchMatchId.value = null
}

function setGraphMapSearchQuery(value: string): void {
  graphMapSearchQuery.value = value
  activeGraphMapSearchMatchId.value = null
}

function focusGraphMapSearch(): void {
  graphMapSearchInput.value?.focus()
  graphMapSearchInput.value?.select()
}

function isTextInputTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  const tag = target.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable
}

function handleGraphMapKeydown(event: KeyboardEvent): void {
  if (event.key !== '/' || event.metaKey || event.ctrlKey || event.altKey) return
  if (isTextInputTarget(event.target)) return
  event.preventDefault()
  focusGraphMapSearch()
}

function handleGraphMapSearchEscape(event: KeyboardEvent): void {
  event.preventDefault()
  if (graphMapSearchQuery.value) {
    clearGraphMapSearch()
    return
  }
  graphMapSearchInput.value?.blur()
}

function handleGraphMapSearchEnter(event: KeyboardEvent): void {
  if (!graphMapSearchTerm.value) return
  event.preventDefault()
  activeGraphMapSearchMatchId.value = nextGraphMapSearchMatchId(
    graphMapNodes.value,
    graphMapEdges.value,
    activeGraphMapSearchMatchId.value,
    event.shiftKey
  )
}

function isActiveGraphMapNodeSearchMatch(node: WorkflowGraphNode): boolean {
  return activeGraphMapSearchMatchId.value === graphMapNodeSearchMatchId(node)
}

function isActiveGraphMapEdgeSearchMatch(edge: WorkflowGraphEdge): boolean {
  return activeGraphMapSearchMatchId.value === graphMapEdgeSearchMatchId(edge)
}

function graphMapSearchSummaryLabel(): string {
  if (!graphMapSearchTerm.value) return ''
  return `${countLabel(graphMapNodes.value.length, 'node')}, ${countLabel(
    graphMapEdges.value.length,
    'edge'
  )} matching "${graphMapSearchQuery.value.trim()}"`
}

function graphMapIssueCleanLabel(): string {
  switch (graphMapFilter.value) {
    case 'issues':
      return 'No workflows with issues in this map.'
    case 'entries':
      return 'No entry workflow issues in this map.'
    default:
      return 'No graph issues in this map.'
  }
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
        @keydown="handleGraphMapKeydown"
      >
        <div class="flex flex-wrap items-center justify-between gap-1">
          <div data-test-id="lowcode-workflow-graph-map-filter" class="flex flex-wrap gap-1">
            <button
              type="button"
              data-test-id="lowcode-workflow-graph-map-filter-all"
              class="rounded px-1 py-0.5 text-[10px] text-muted hover:bg-hover hover:text-surface"
              :class="graphMapFilter === 'all' ? 'bg-hover text-surface' : ''"
              :aria-pressed="graphMapFilter === 'all'"
              @click="graphMapFilter = 'all'"
            >
              All
            </button>
            <button
              type="button"
              data-test-id="lowcode-workflow-graph-map-filter-issues"
              class="rounded px-1 py-0.5 text-[10px] text-muted hover:bg-hover hover:text-surface"
              :class="graphMapFilter === 'issues' ? 'bg-hover text-surface' : ''"
              :aria-pressed="graphMapFilter === 'issues'"
              @click="graphMapFilter = 'issues'"
            >
              Issues
            </button>
            <button
              type="button"
              data-test-id="lowcode-workflow-graph-map-filter-entries"
              class="rounded px-1 py-0.5 text-[10px] text-muted hover:bg-hover hover:text-surface"
              :class="graphMapFilter === 'entries' ? 'bg-hover text-surface' : ''"
              :aria-pressed="graphMapFilter === 'entries'"
              @click="graphMapFilter = 'entries'"
            >
              Entries
            </button>
          </div>
          <div class="flex min-w-0 items-center justify-end gap-1">
            <input
              ref="graphMapSearchInput"
              :value="graphMapSearchQuery"
              aria-label="Search workflow graph map"
              data-test-id="lowcode-workflow-graph-map-search"
              placeholder="Search workflow/action (/)"
              spellcheck="false"
              class="w-40 min-w-0 rounded border border-border bg-input px-2 py-0.5 text-[10px] text-surface outline-none focus:border-accent"
              @input="setGraphMapSearchQuery(($event.target as HTMLInputElement).value)"
              @keydown.enter.stop="handleGraphMapSearchEnter"
              @keydown.escape.stop="handleGraphMapSearchEscape"
            />
            <button
              v-if="graphMapSearchTerm"
              type="button"
              data-test-id="lowcode-workflow-graph-map-search-clear"
              aria-label="Clear workflow graph map search"
              title="Clear workflow graph map search"
              class="shrink-0 rounded px-1 py-0.5 text-[10px] text-muted hover:bg-hover hover:text-surface focus:bg-hover focus:text-surface"
              @click="clearGraphMapSearch"
            >
              Clear
            </button>
          </div>
          <span data-test-id="lowcode-workflow-graph-map-summary" class="text-[9px] text-muted/80">
            {{ graphMapSummaryLabel() }}
          </span>
        </div>
        <p
          v-if="graphMapSearchTerm"
          data-test-id="lowcode-workflow-graph-map-search-summary"
          class="text-[9px] text-muted"
        >
          {{ graphMapSearchSummaryLabel() }}
        </p>
        <ul
          v-if="graphMapIssues.length > 0"
          data-test-id="lowcode-workflow-graph-map-issue-group"
          class="flex flex-col gap-0.5 rounded border border-red-500/30 bg-red-500/5 px-1 py-0.5 text-[10px]"
        >
          <li
            data-test-id="lowcode-workflow-graph-map-issue-summary"
            class="text-[9px] uppercase text-red-500/80"
          >
            {{ graphMapIssueSummaryLabel() }}
          </li>
          <li
            v-for="(issue, index) in graphMapIssues"
            :key="`${issue.type}-${index}`"
            data-test-id="lowcode-workflow-graph-map-issue-row"
            class="flex items-center justify-between gap-2"
          >
            <span class="min-w-0">
              <span
                data-test-id="lowcode-workflow-graph-map-issue-type"
                class="mr-1 rounded bg-red-500/10 px-1 text-red-500"
              >
                {{ graphMapIssueTypeLabel(issue) }}
              </span>
              <span data-test-id="lowcode-workflow-graph-map-issue-message">
                {{ issue.message }}
              </span>
            </span>
            <button
              v-if="issue.targetWorkflowId"
              type="button"
              data-test-id="lowcode-workflow-graph-map-issue-jump"
              :aria-label="graphMapIssueJumpLabel(issue)"
              :title="graphMapIssueJumpLabel(issue)"
              class="shrink-0 rounded px-1 py-0.5 text-[10px] text-muted hover:bg-hover hover:text-surface focus:bg-hover focus:text-surface"
              @click="jumpToWorkflow(issue.targetWorkflowId)"
              @keydown.enter.prevent="jumpToWorkflow(issue.targetWorkflowId)"
              @keydown.space.prevent="jumpToWorkflow(issue.targetWorkflowId)"
            >
              Jump
            </button>
          </li>
        </ul>
        <p
          v-else
          data-test-id="lowcode-workflow-graph-map-issue-clean"
          class="rounded border border-border bg-hover/30 px-1 py-0.5 text-[10px] text-muted"
        >
          {{ graphMapIssueCleanLabel() }}
        </p>
        <div
          v-if="graphMapNodeGroups.length > 0"
          data-test-id="lowcode-workflow-graph-map-node-groups"
          class="grid gap-1 sm:grid-cols-3"
        >
          <section
            v-for="group in graphMapNodeGroups"
            :key="group.kind"
            data-test-id="lowcode-workflow-graph-map-node-group"
            :data-graph-map-group="group.kind"
            class="flex min-w-0 flex-col gap-1 rounded border border-border/70 bg-hover/20 p-1"
          >
            <div class="flex items-center justify-between gap-2 text-[9px] uppercase text-muted">
              <span data-test-id="lowcode-workflow-graph-map-node-group-title">
                {{ group.title }}
              </span>
              <span class="flex items-center gap-1">
                <span data-test-id="lowcode-workflow-graph-map-node-group-count">
                  {{ graphMapGroupCountLabel(group.nodes.length) }}
                </span>
                <button
                  type="button"
                  data-test-id="lowcode-workflow-graph-map-node-group-toggle"
                  :aria-expanded="!isGraphMapNodeGroupCollapsed(group.kind)"
                  :aria-label="graphMapNodeGroupToggleLabel(group)"
                  :title="graphMapNodeGroupToggleLabel(group)"
                  class="rounded px-1 py-0.5 text-[9px] text-muted hover:bg-hover hover:text-surface focus:bg-hover focus:text-surface"
                  @click="toggleGraphMapNodeGroup(group.kind)"
                >
                  {{ isGraphMapNodeGroupCollapsed(group.kind) ? 'Show' : 'Hide' }}
                </button>
              </span>
            </div>
            <div v-if="!isGraphMapNodeGroupCollapsed(group.kind)" class="flex flex-wrap gap-1">
              <div
                v-for="node in group.nodes"
                :key="node.id"
                data-test-id="lowcode-workflow-graph-map-node"
                :data-graph-map-active-match="isActiveGraphMapNodeSearchMatch(node) ? 'true' : undefined"
                class="flex max-w-full flex-col gap-0.5 rounded border px-1.5 py-0.5 text-[10px]"
                :class="
                  isActiveGraphMapNodeSearchMatch(node)
                    ? 'border-accent bg-accent/10 text-surface'
                    : 'border-border'
                "
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
                      :aria-label="graphMapNodeIssueTitle(node.name, node.issues.length)"
                      :title="graphMapNodeIssueTitle(node.name, node.issues.length)"
                      class="shrink-0 text-red-500"
                    >
                      {{ graphMapNodeIssueLabel(node.issues.length) }}
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
          </section>
        </div>
        <p
          v-else
          data-test-id="lowcode-workflow-graph-map-node-empty"
          class="text-[10px] text-muted"
        >
          {{ graphMapNodeEmptyLabel() }}
        </p>
        <div
          v-if="graphMapEdgeGroups.length > 0"
          data-test-id="lowcode-workflow-graph-map-edge-groups"
          class="grid gap-1 sm:grid-cols-2"
        >
          <section
            v-for="group in graphMapEdgeGroups"
            :key="group.kind"
            data-test-id="lowcode-workflow-graph-map-edge-group"
            :data-graph-map-edge-group="group.kind"
            class="flex min-w-0 flex-col gap-1 rounded border border-border/70 bg-hover/20 p-1"
          >
            <div class="flex items-center justify-between gap-2 text-[9px] uppercase text-muted">
              <span data-test-id="lowcode-workflow-graph-map-edge-group-title">
                {{ group.title }}
              </span>
              <span class="flex items-center gap-1">
                <span data-test-id="lowcode-workflow-graph-map-edge-group-count">
                  {{ graphMapEdgeGroupCountLabel(group.edges.length) }}
                </span>
                <button
                  type="button"
                  data-test-id="lowcode-workflow-graph-map-edge-group-toggle"
                  :aria-expanded="!isGraphMapEdgeGroupCollapsed(group.kind)"
                  :aria-label="graphMapEdgeGroupToggleLabel(group)"
                  :title="graphMapEdgeGroupToggleLabel(group)"
                  class="rounded px-1 py-0.5 text-[9px] text-muted hover:bg-hover hover:text-surface focus:bg-hover focus:text-surface"
                  @click="toggleGraphMapEdgeGroup(group.kind)"
                >
                  {{ isGraphMapEdgeGroupCollapsed(group.kind) ? 'Show' : 'Hide' }}
                </button>
              </span>
            </div>
            <ul v-if="!isGraphMapEdgeGroupCollapsed(group.kind)" class="flex flex-col gap-0.5">
              <li
                v-for="edge in group.edges"
                :key="`${edge.fromId}-${edge.actionId}-${edge.toId}`"
                data-test-id="lowcode-workflow-graph-map-edge"
                :data-graph-map-active-match="isActiveGraphMapEdgeSearchMatch(edge) ? 'true' : undefined"
                :aria-label="graphMapEdgePathLabel(edge)"
                class="flex items-center justify-between gap-2 rounded border px-1 py-0.5"
                :class="
                  isActiveGraphMapEdgeSearchMatch(edge)
                    ? 'border-accent bg-accent/10 text-surface'
                    : 'border-transparent'
                "
              >
                <span class="flex min-w-0 items-center gap-1">
                  <span data-test-id="lowcode-workflow-graph-map-edge-from" class="min-w-0">
                    <span class="text-[9px] uppercase text-muted/80">From </span>
                    <span class="ml-1">{{ edge.fromName }}</span>
                  </span>
                  <span
                    data-test-id="lowcode-workflow-graph-map-edge-arrow"
                    class="shrink-0 text-muted/70"
                  >
                    ->
                  </span>
                  <span data-test-id="lowcode-workflow-graph-map-edge-to" class="min-w-0">
                    <span class="text-[9px] uppercase text-muted/80">To </span>
                    <span class="ml-1">{{ graphMapEdgeTargetLabel(edge) }}</span>
                    <span
                      v-if="!edge.toName"
                      data-test-id="lowcode-workflow-graph-map-edge-missing"
                      :aria-label="graphMapMissingEdgeLabel(edge)"
                      :title="graphMapMissingEdgeLabel(edge)"
                      class="ml-1 rounded bg-red-500/10 px-1 text-red-500"
                    >
                      missing
                    </span>
                  </span>
                  <button
                    type="button"
                    data-test-id="lowcode-workflow-graph-map-edge-action"
                    :aria-label="graphMapEdgeSourceActionJumpLabel(edge)"
                    :title="graphMapEdgeSourceActionJumpLabel(edge)"
                    class="shrink-0 rounded bg-hover px-1 text-[9px] text-muted hover:text-surface focus:bg-hover focus:text-surface"
                    @click="jumpToWorkflowAction(edge)"
                    @keydown.enter.prevent="jumpToWorkflowAction(edge)"
                    @keydown.space.prevent="jumpToWorkflowAction(edge)"
                  >
                    {{ graphMapEdgeActionLabel(edge) }}
                  </button>
                  <span
                    data-test-id="lowcode-workflow-graph-map-edge-action-kind"
                    :aria-label="graphMapEdgeActionKindLabel(edge)"
                    :title="graphMapEdgeActionKindLabel(edge)"
                    class="shrink-0 rounded bg-hover/70 px-1 text-[9px] text-muted"
                  >
                    {{ edge.actionKind }}
                  </span>
                  <span
                    data-test-id="lowcode-workflow-graph-map-edge-branch"
                    :aria-label="graphMapEdgeBranchTitle(edge)"
                    :title="graphMapEdgeBranchTitle(edge)"
                    class="shrink-0 rounded border border-border/70 px-1 text-[9px] text-muted"
                  >
                    {{ graphMapEdgeBranchLabel(edge) }}
                  </span>
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
                <button
                  v-else
                  type="button"
                  data-test-id="lowcode-workflow-graph-map-edge-source-jump"
                  :aria-label="graphMapMissingEdgeSourceJumpLabel(edge)"
                  :title="graphMapMissingEdgeSourceJumpLabel(edge)"
                  class="shrink-0 rounded px-1 py-0.5 text-[10px] text-muted hover:bg-hover hover:text-surface focus:bg-hover focus:text-surface"
                  @click="jumpToWorkflow(edge.fromId)"
                  @keydown.enter.prevent="jumpToWorkflow(edge.fromId)"
                  @keydown.space.prevent="jumpToWorkflow(edge.fromId)"
                >
                  Source
                </button>
              </li>
            </ul>
          </section>
        </div>
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
