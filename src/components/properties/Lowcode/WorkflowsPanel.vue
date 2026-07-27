<script setup lang="ts">
import { computed, nextTick, ref } from 'vue'
import type { ComponentPublicInstance } from 'vue'
import type { DocumentStateDef, SceneNode, StateDef, WorkflowDef } from '@open-pencil/scene-graph'
import { useI18n, useSceneComputed } from '@open-pencil/vue'
import { useSectionUI } from '@/components/ui/section'
import Tip from '@/components/ui/Tip.vue'

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
  graphMapEdgeBranchKind,
  graphMapEdgeMatchesSearch,
  graphMapEdgeSearchMatchId,
  graphMapNodeMatchesSearch,
  graphMapNodeSearchMatchId,
  graphMapSearchMatchPosition,
  isGraphMapTextInputTarget,
  nextGraphMapSearchMatchId,
  scrollGraphMapActiveMatchIntoView
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
const { panels } = useI18n()

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
    name: page.name || panels.value.lowcodeWorkflowUnnamedPage,
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
const graphMapRoot = ref<HTMLElement | null>(null)
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
  return graphMapBaseEdges.value.filter((edge) =>
    graphMapEdgeMatchesSearch(edge, term, localizedGraphMapEdgeBranchLabel(edge))
  )
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
      graphMapEdgeMatchesSearch(edge, term, localizedGraphMapEdgeBranchLabel(edge)) ||
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
      localizedWorkflowGraphIssue(issue).toLowerCase().includes(term) ||
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
    { kind: 'issues', title: panels.value.lowcodeWorkflowGraphNodeGroupIssues, nodes: [] },
    { kind: 'entries', title: panels.value.lowcodeWorkflowGraphNodeGroupEntries, nodes: [] },
    { kind: 'called', title: panels.value.lowcodeWorkflowGraphNodeGroupCalled, nodes: [] }
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
    { kind: 'calls', title: panels.value.lowcodeWorkflowGraphEdgeGroupCalls, edges: [] },
    { kind: 'missing', title: panels.value.lowcodeWorkflowGraphEdgeGroupMissing, edges: [] }
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
      name: panels.value.lowcodeWorkflowDefaultName,
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

async function jumpToWorkflow(workflowId: string | undefined, actionPath?: string): Promise<void> {
  if (!workflowId) return
  const row = workflowRowRefs.get(workflowId)
  if (!row) return
  if (actionPath && (await row.focusAction(actionPath))) return
  row.focusRow()
}

async function jumpToWorkflowAction(edge: WorkflowGraphEdge): Promise<void> {
  await jumpToWorkflow(edge.fromId, edge.actionPath)
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
  return count === 1
    ? panels.value.lowcodeWorkflowEntryCountOne({ count })
    : panels.value.lowcodeWorkflowEntryCountMany({ count })
}

function workflowCountLabel(count: number): string {
  return count === 1
    ? panels.value.lowcodeWorkflowCountOne({ count })
    : panels.value.lowcodeWorkflowCountMany({ count })
}

function actionCountLabel(count: number): string {
  return count === 1
    ? panels.value.lowcodeWorkflowActionCountOne({ count })
    : panels.value.lowcodeWorkflowActionCountMany({ count })
}

function callCountLabel(count: number): string {
  return count === 1
    ? panels.value.lowcodeWorkflowCallCountOne({ count })
    : panels.value.lowcodeWorkflowCallCountMany({ count })
}

function graphNodeCountLabel(count: number): string {
  return count === 1
    ? panels.value.lowcodeWorkflowGraphNodeCountOne({ count })
    : panels.value.lowcodeWorkflowGraphNodeCountMany({ count })
}

function graphEdgeCountLabel(count: number): string {
  return count === 1
    ? panels.value.lowcodeWorkflowGraphEdgeCountOne({ count })
    : panels.value.lowcodeWorkflowGraphEdgeCountMany({ count })
}

function graphIssueCountLabel(count: number): string {
  return count === 1
    ? panels.value.lowcodeWorkflowGraphIssueCountOne({ count })
    : panels.value.lowcodeWorkflowGraphIssueCountMany({ count })
}

function graphArgIssueCountLabel(count: number): string {
  return count === 1
    ? panels.value.lowcodeWorkflowGraphArgIssueCountOne({ count })
    : panels.value.lowcodeWorkflowGraphArgIssueCountMany({ count })
}

function graphCycleCountLabel(count: number): string {
  return count === 1
    ? panels.value.lowcodeWorkflowGraphCycleCountOne({ count })
    : panels.value.lowcodeWorkflowGraphCycleCountMany({ count })
}

function workflowGraphNodeName(workflowId: string): string {
  return workflowGraph.value.nodes.find((node) => node.id === workflowId)?.name ?? workflowId
}

function graphMapNodeJumpLabel(nodeName: string): string {
  return panels.value.lowcodeWorkflowGraphNodeJump({ name: nodeName })
}

function graphMapEdgeJumpLabel(edge: WorkflowGraphEdge): string {
  return panels.value.lowcodeWorkflowGraphTargetJump({
    target: edge.toName ?? edge.toId,
    source: edge.fromName
  })
}

function graphMapMissingEdgeLabel(edge: WorkflowGraphEdge): string {
  return panels.value.lowcodeWorkflowGraphMissingCall({
    workflowId: edge.toId,
    source: edge.fromName
  })
}

function graphMapMissingEdgeSourceJumpLabel(edge: WorkflowGraphEdge): string {
  return panels.value.lowcodeWorkflowGraphMissingFixJump({
    source: edge.fromName,
    workflowId: edge.toId
  })
}

function graphMapEdgeSourceActionJumpLabel(edge: WorkflowGraphEdge): string {
  return panels.value.lowcodeWorkflowGraphEdgeActionJump({
    source: edge.fromName,
    actionId: edge.actionId,
    path: edge.actionPath
  })
}

function graphMapEdgeTargetLabel(edge: WorkflowGraphEdge): string {
  return edge.toName ?? edge.toId
}

function graphMapEdgePathLabel(edge: WorkflowGraphEdge): string {
  return panels.value.lowcodeWorkflowGraphEdgePath({
    source: edge.fromName,
    target: graphMapEdgeTargetLabel(edge),
    actionId: edge.actionId
  })
}

function graphMapEdgeActionLabel(edge: WorkflowGraphEdge): string {
  return panels.value.lowcodeWorkflowGraphAction({ actionId: edge.actionId })
}

function graphMapEdgeActionKindLabel(edge: WorkflowGraphEdge): string {
  return panels.value.lowcodeWorkflowGraphKind({ kind: edge.actionKind })
}

function graphMapEdgeBranchTitle(edge: WorkflowGraphEdge): string {
  return panels.value.lowcodeWorkflowGraphBranchAt({
    branch: localizedGraphMapEdgeBranchLabel(edge),
    path: edge.actionPath
  })
}

function localizedGraphMapEdgeBranchLabel(edge: WorkflowGraphEdge): string {
  switch (graphMapEdgeBranchKind(edge)) {
    case 'root':
      return panels.value.lowcodeWorkflowGraphBranchRoot
    case 'then':
      return panels.value.lowcodeWorkflowGraphBranchThen
    case 'else':
      return panels.value.lowcodeWorkflowGraphBranchElse
    case 'success':
      return panels.value.lowcodeWorkflowGraphBranchSuccess
    case 'error':
      return panels.value.lowcodeWorkflowGraphBranchError
    case 'nested':
      return panels.value.lowcodeWorkflowGraphBranchNested
    default:
      return graphMapEdgeBranchLabel(edge)
  }
}

function graphMapIssueTypeLabel(issue: WorkflowGraphIssue): string {
  if (issue.type === 'cycle') return panels.value.lowcodeWorkflowIssueTypeCycle
  return issue.type === 'call-args'
    ? panels.value.lowcodeWorkflowIssueTypeArgs
    : panels.value.lowcodeWorkflowIssueTypeMissing
}

function localizedWorkflowGraphIssue(issue: WorkflowGraphIssue): string {
  const copy = issue.i18n
  if (!copy) return issue.message
  switch (copy.code) {
    case 'missing-workflow-call':
      return panels.value.lowcodeWorkflowIssueMissingCall({
        source: copy.sourceName,
        workflowId: copy.workflowId
      })
    case 'missing-workflow-entrypoint':
      return panels.value.lowcodeWorkflowIssueMissingEntrypoint({
        node: copy.nodeName,
        event: copy.eventName,
        workflowId: copy.workflowId
      })
    case 'call-args': {
      const problems = copy.problems
        .map((problem) => {
          if (problem.kind === 'extra')
            return panels.value.lowcodeWorkflowIssueArgExtra({ param: problem.param })
          if (problem.kind === 'missing')
            return panels.value.lowcodeWorkflowIssueArgMissing({ param: problem.param })
          return panels.value.lowcodeWorkflowIssueArgInvalid({ param: problem.param })
        })
        .join(', ')
      return panels.value.lowcodeWorkflowIssueInvalidArgs({
        source: copy.sourceName,
        target: copy.targetName,
        problems
      })
    }
    case 'cycle':
      return panels.value.lowcodeWorkflowIssueCycle({ cycle: copy.names.join(' -> ') })
  }
}

function graphMapIssueJumpLabel(issue: WorkflowGraphIssue): string {
  const target = issue.targetWorkflowId
    ? workflowGraphNodeName(issue.targetWorkflowId)
    : graphMapEdgeTargetLabelFallback()
  if (issue.actionId)
    return panels.value.lowcodeWorkflowIssueJumpAction({ target, actionId: issue.actionId })
  return panels.value.lowcodeWorkflowIssueJump({
    target,
    message: localizedWorkflowGraphIssue(issue)
  })
}

function graphMapEdgeTargetLabelFallback(): string {
  return panels.value.lowcodeWorkflowGraphTo
}

function entrypointSourceLabel(entrypoint: WorkflowGraphEntrypoint): string {
  return `${entrypoint.nodeName} ${entrypoint.eventName}`
}

function entrypointSourceJumpLabel(entrypoint: WorkflowGraphEntrypoint): string {
  return panels.value.lowcodeWorkflowGraphSourceJump({
    source: entrypointSourceLabel(entrypoint)
  })
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

function graphMapSummaryLabel(): string {
  return panels.value.lowcodeWorkflowGraphSummaryCounts({
    nodes: graphNodeCountLabel(graphMapNodes.value.length),
    edges: graphEdgeCountLabel(graphMapEdges.value.length)
  })
}

function graphMapIssueSummaryLabel(): string {
  const count = graphIssueCountLabel(graphMapIssues.value.length)
  const typeSummary = graphMapIssueTypeSummaryLabel(graphMapIssues.value)
  const types = typeSummary ? ` · ${typeSummary}` : ''
  switch (graphMapFilter.value) {
    case 'issues':
      return panels.value.lowcodeWorkflowGraphIssueSummaryIssues({ count, types })
    case 'entries':
      return panels.value.lowcodeWorkflowGraphIssueSummaryEntries({ count, types })
    default:
      return panels.value.lowcodeWorkflowGraphIssueSummaryAll({ count, types })
  }
}

function graphMapIssueTypeSummaryLabel(issues: readonly WorkflowGraphIssue[]): string {
  const missingCount = issues.filter((issue) => issue.type === 'missing-workflow').length
  const argCount = issues.filter((issue) => issue.type === 'call-args').length
  const cycleCount = issues.filter((issue) => issue.type === 'cycle').length
  return [
    missingCount > 0 ? panels.value.lowcodeWorkflowGraphMissingCount({ count: missingCount }) : '',
    argCount > 0 ? graphArgIssueCountLabel(argCount) : '',
    cycleCount > 0 ? graphCycleCountLabel(cycleCount) : ''
  ]
    .filter(Boolean)
    .join(', ')
}
function graphMapNodeIssueLabel(count: number): string {
  return graphIssueCountLabel(count)
}

function graphMapNodeIssueTitle(nodeName: string, count: number): string {
  return panels.value.lowcodeWorkflowGraphNodeIssues({
    name: nodeName,
    count: graphIssueCountLabel(count)
  })
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
  return isGraphMapNodeGroupCollapsed(group.kind)
    ? panels.value.lowcodeWorkflowGraphShowWorkflowGroup({ title: group.title })
    : panels.value.lowcodeWorkflowGraphHideWorkflowGroup({ title: group.title })
}

function graphMapGroupCountLabel(count: number): string {
  return workflowCountLabel(count)
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
  return isGraphMapEdgeGroupCollapsed(group.kind)
    ? panels.value.lowcodeWorkflowGraphShowEdgeGroup({ title: group.title })
    : panels.value.lowcodeWorkflowGraphHideEdgeGroup({ title: group.title })
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

function handleGraphMapKeydown(event: KeyboardEvent): void {
  if (event.key !== '/' || event.metaKey || event.ctrlKey || event.altKey) return
  if (isGraphMapTextInputTarget(event.target)) return
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
  if (event.metaKey || event.ctrlKey) {
    jumpToActiveGraphMapSearchMatch()
    return
  }
  activeGraphMapSearchMatchId.value = nextGraphMapSearchMatchId(
    graphMapNodes.value,
    graphMapEdges.value,
    activeGraphMapSearchMatchId.value,
    event.shiftKey
  )
  if (activeGraphMapSearchMatchId.value) {
    void nextTick(() => scrollGraphMapActiveMatchIntoView(graphMapRoot.value))
  }
}

async function jumpToActiveGraphMapSearchMatch(): Promise<void> {
  const activeId = activeGraphMapSearchMatchId.value
  if (!activeId) return
  const node = graphMapNodes.value.find(
    (candidate) => graphMapNodeSearchMatchId(candidate) === activeId
  )
  if (node) {
    jumpToWorkflow(node.id)
    return
  }
  const edge = graphMapEdges.value.find(
    (candidate) => graphMapEdgeSearchMatchId(candidate) === activeId
  )
  if (edge) await jumpToWorkflowAction(edge)
}

function isActiveGraphMapNodeSearchMatch(node: WorkflowGraphNode): boolean {
  return activeGraphMapSearchMatchId.value === graphMapNodeSearchMatchId(node)
}

function isActiveGraphMapEdgeSearchMatch(edge: WorkflowGraphEdge): boolean {
  return activeGraphMapSearchMatchId.value === graphMapEdgeSearchMatchId(edge)
}

function graphMapSearchSummaryLabel(): string {
  if (!graphMapSearchTerm.value) return ''
  const position = graphMapSearchMatchPosition(
    graphMapNodes.value,
    graphMapEdges.value,
    activeGraphMapSearchMatchId.value
  )
  const positionLabel = position
    ? panels.value.lowcodeWorkflowGraphSearchPosition({
        index: position.index,
        total: position.total,
        kind:
          position.kind === 'node'
            ? panels.value.lowcodeWorkflowGraphSearchKindNode
            : panels.value.lowcodeWorkflowGraphSearchKindEdge
      })
    : ''
  return panels.value.lowcodeWorkflowGraphSearchSummary({
    nodes: graphNodeCountLabel(graphMapNodes.value.length),
    edges: graphEdgeCountLabel(graphMapEdges.value.length),
    query: graphMapSearchQuery.value.trim(),
    position: positionLabel
  })
}

function graphMapIssueCleanLabel(): string {
  switch (graphMapFilter.value) {
    case 'issues':
      return panels.value.lowcodeWorkflowGraphNoIssuesIssues
    case 'entries':
      return panels.value.lowcodeWorkflowGraphNoIssuesEntries
    default:
      return panels.value.lowcodeWorkflowGraphNoIssuesAll
  }
}

function graphMapNodeEmptyLabel(): string {
  switch (graphMapFilter.value) {
    case 'issues':
      return panels.value.lowcodeWorkflowGraphNoNodesIssues
    case 'entries':
      return panels.value.lowcodeWorkflowGraphNoNodesEntries
    default:
      return panels.value.lowcodeWorkflowGraphNoNodesAll
  }
}

function graphMapEdgeEmptyLabel(): string {
  switch (graphMapFilter.value) {
    case 'issues':
      return panels.value.lowcodeWorkflowGraphNoEdgesIssues
    case 'entries':
      return panels.value.lowcodeWorkflowGraphNoEdgesEntries
    default:
      return panels.value.lowcodeWorkflowGraphNoEdgesAll
  }
}

function graphMapAdditionalSourcesToggleLabel(node: WorkflowGraphNode): string {
  return isGraphMapSourceExpanded(node.id)
    ? panels.value.lowcodeWorkflowGraphHideAdditionalSources({ name: node.name })
    : panels.value.lowcodeWorkflowGraphShowMoreSources({
        count: node.entrypoints.length - 1,
        name: node.name
      })
}

function graphMapAdditionalSourcesLabel(nodeName: string): string {
  return panels.value.lowcodeWorkflowGraphAdditionalSources({ name: nodeName })
}

function graphMapNodeStatsLabel(node: WorkflowGraphNode): string {
  return panels.value.lowcodeWorkflowGraphNodeStats({
    entries: node.entrypoints.length,
    incoming: node.incoming.length,
    outgoing: node.outgoing.length,
    actions: node.actionCount
  })
}

function graphNodeDetailLabel(node: WorkflowGraphNode): string {
  return panels.value.lowcodeWorkflowGraphNodeDetail({
    name: node.name,
    entries: entrypointLabel(node.entrypoints.length),
    incoming: node.incoming.length,
    outgoing: node.outgoing.length,
    actions: actionCountLabel(node.actionCount)
  })
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
      <label class="text-[11px] text-muted">{{ panels.lowcodeWorkflows }}</label>
      <button
        type="button"
        data-test-id="lowcode-workflow-add"
        class="rounded px-1.5 py-0.5 text-[11px] text-muted hover:bg-hover hover:text-surface"
        @click="addWorkflow"
      >
        {{ panels.lowcodeWorkflowAdd }}
      </button>
    </div>

    <p v-if="workflows.length === 0" class="text-[11px] text-muted">
      {{ panels.lowcodeWorkflowsEmpty }}
    </p>

    <div
      v-if="workflows.length > 0"
      data-test-id="lowcode-workflow-graph-summary"
      class="mb-1 flex flex-col gap-1 border-l border-border pl-2 text-[10px]"
    >
      <div class="flex items-center justify-between gap-2">
        <p class="text-muted">
          {{
            panels.lowcodeWorkflowGraphSummary({
              workflows: workflowCountLabel(workflowGraph.workflowCount),
              actions: actionCountLabel(workflowGraph.actionCount),
              calls: callCountLabel(workflowGraph.callCount),
              entries: entrypointLabel(workflowGraph.entrypointCount)
            })
          }}
        </p>
        <button
          type="button"
          data-test-id="lowcode-workflow-graph-toggle"
          class="shrink-0 rounded px-1 py-0.5 text-[10px] text-muted hover:bg-hover hover:text-surface"
          @click="graphDetailsOpen = !graphDetailsOpen"
        >
          {{
            graphDetailsOpen ? panels.lowcodeWorkflowHideDetails : panels.lowcodeWorkflowShowDetails
          }}
        </button>
      </div>
      <p v-if="workflowGraph.issues.length === 0" class="text-muted">
        {{ panels.lowcodeWorkflowGraphNoIssues }}
      </p>
      <ul v-else class="flex flex-col gap-0.5 text-red-500">
        <li
          v-for="(issue, index) in workflowGraph.issues"
          :key="`${issue.type}-${index}`"
          data-test-id="lowcode-workflow-graph-issue"
          class="flex items-center justify-between gap-2"
        >
          <span class="min-w-0">{{ localizedWorkflowGraphIssue(issue) }}</span>
          <button
            v-if="issue.targetWorkflowId"
            type="button"
            data-test-id="lowcode-workflow-graph-jump"
            class="shrink-0 rounded px-1 py-0.5 text-[10px] text-muted hover:bg-hover hover:text-surface"
            @click="jumpToWorkflow(issue.targetWorkflowId, issue.actionPath)"
          >
            {{ panels.lowcodeWorkflowJump }}
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
          <span class="min-w-0">
            {{ panels.lowcodeWorkflowNoEventEntry({ name: workflowGraphNodeName(workflowId) }) }}
          </span>
          <button
            type="button"
            data-test-id="lowcode-workflow-graph-entrypoint-jump"
            class="shrink-0 rounded px-1 py-0.5 text-[10px] text-muted hover:bg-hover hover:text-surface"
            @click="jumpToWorkflow(workflowId)"
          >
            {{ panels.lowcodeWorkflowJump }}
          </button>
        </li>
      </ul>
      <div
        v-if="graphDetailsOpen"
        ref="graphMapRoot"
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
              {{ panels.lowcodeWorkflowGraphFilterAll }}
            </button>
            <button
              type="button"
              data-test-id="lowcode-workflow-graph-map-filter-issues"
              class="rounded px-1 py-0.5 text-[10px] text-muted hover:bg-hover hover:text-surface"
              :class="graphMapFilter === 'issues' ? 'bg-hover text-surface' : ''"
              :aria-pressed="graphMapFilter === 'issues'"
              @click="graphMapFilter = 'issues'"
            >
              {{ panels.lowcodeWorkflowGraphFilterIssues }}
            </button>
            <button
              type="button"
              data-test-id="lowcode-workflow-graph-map-filter-entries"
              class="rounded px-1 py-0.5 text-[10px] text-muted hover:bg-hover hover:text-surface"
              :class="graphMapFilter === 'entries' ? 'bg-hover text-surface' : ''"
              :aria-pressed="graphMapFilter === 'entries'"
              @click="graphMapFilter = 'entries'"
            >
              {{ panels.lowcodeWorkflowGraphFilterEntries }}
            </button>
          </div>
          <div class="flex min-w-0 items-center justify-end gap-1">
            <input
              ref="graphMapSearchInput"
              :value="graphMapSearchQuery"
              :aria-label="panels.lowcodeWorkflowGraphSearch"
              data-test-id="lowcode-workflow-graph-map-search"
              :placeholder="panels.lowcodeWorkflowGraphSearchPlaceholder"
              spellcheck="false"
              class="w-40 min-w-0 rounded border border-border bg-input px-2 py-0.5 text-[10px] text-surface outline-none focus:border-accent"
              @input="setGraphMapSearchQuery(($event.target as HTMLInputElement).value)"
              @keydown.enter.stop="handleGraphMapSearchEnter"
              @keydown.escape.stop="handleGraphMapSearchEscape"
            />
            <Tip v-if="graphMapSearchTerm" :label="panels.lowcodeWorkflowGraphSearchClearAria">
              <button
                type="button"
                data-test-id="lowcode-workflow-graph-map-search-clear"
                :aria-label="panels.lowcodeWorkflowGraphSearchClearAria"
                class="shrink-0 rounded px-1 py-0.5 text-[10px] text-muted hover:bg-hover hover:text-surface focus:bg-hover focus:text-surface"
                @click="clearGraphMapSearch"
              >
                {{ panels.lowcodeWorkflowGraphSearchClear }}
              </button>
            </Tip>
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
                {{ localizedWorkflowGraphIssue(issue) }}
              </span>
            </span>
            <Tip v-if="issue.targetWorkflowId" :label="graphMapIssueJumpLabel(issue)">
              <button
                type="button"
                data-test-id="lowcode-workflow-graph-map-issue-jump"
                :aria-label="graphMapIssueJumpLabel(issue)"
                class="shrink-0 rounded px-1 py-0.5 text-[10px] text-muted hover:bg-hover hover:text-surface focus:bg-hover focus:text-surface"
                @click="jumpToWorkflow(issue.targetWorkflowId, issue.actionPath)"
                @keydown.enter.prevent="jumpToWorkflow(issue.targetWorkflowId, issue.actionPath)"
                @keydown.space.prevent="jumpToWorkflow(issue.targetWorkflowId, issue.actionPath)"
              >
                {{ panels.lowcodeWorkflowJump }}
              </button>
            </Tip>
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
                <Tip :label="graphMapNodeGroupToggleLabel(group)">
                  <button
                    type="button"
                    data-test-id="lowcode-workflow-graph-map-node-group-toggle"
                    :aria-expanded="!isGraphMapNodeGroupCollapsed(group.kind)"
                    :aria-label="graphMapNodeGroupToggleLabel(group)"
                    class="rounded px-1 py-0.5 text-[9px] text-muted hover:bg-hover hover:text-surface focus:bg-hover focus:text-surface"
                    @click="toggleGraphMapNodeGroup(group.kind)"
                  >
                    {{
                      isGraphMapNodeGroupCollapsed(group.kind)
                        ? panels.lowcodeWorkflowGraphShow
                        : panels.lowcodeWorkflowGraphHide
                    }}
                  </button>
                </Tip>
              </span>
            </div>
            <div v-if="!isGraphMapNodeGroupCollapsed(group.kind)" class="flex flex-wrap gap-1">
              <div
                v-for="node in group.nodes"
                :key="node.id"
                data-test-id="lowcode-workflow-graph-map-node"
                :data-graph-map-active-match="
                  isActiveGraphMapNodeSearchMatch(node) ? 'true' : undefined
                "
                class="flex max-w-full flex-col gap-0.5 rounded border px-1.5 py-0.5 text-[10px]"
                :class="
                  isActiveGraphMapNodeSearchMatch(node)
                    ? 'border-accent bg-accent/10 text-surface'
                    : 'border-border'
                "
              >
                <Tip :label="graphMapNodeJumpLabel(node.name)">
                  <button
                    type="button"
                    data-test-id="lowcode-workflow-graph-map-node-jump"
                    :aria-label="graphMapNodeJumpLabel(node.name)"
                    class="flex max-w-full flex-col gap-0.5 rounded text-left hover:text-surface focus:bg-hover focus:text-surface"
                    @click="jumpToWorkflow(node.id)"
                    @keydown.enter.prevent="jumpToWorkflow(node.id)"
                    @keydown.space.prevent="jumpToWorkflow(node.id)"
                  >
                    <span class="flex max-w-full items-center gap-1">
                      <span class="min-w-0 truncate">{{ node.name }}</span>
                      <Tip
                        v-if="node.issues.length > 0"
                        :label="graphMapNodeIssueTitle(node.name, node.issues.length)"
                      >
                        <span
                          data-test-id="lowcode-workflow-graph-map-node-issue"
                          :aria-label="graphMapNodeIssueTitle(node.name, node.issues.length)"
                          class="shrink-0 text-red-500"
                        >
                          {{ graphMapNodeIssueLabel(node.issues.length) }}
                        </span>
                      </Tip>
                    </span>
                    <span
                      data-test-id="lowcode-workflow-graph-map-node-stats"
                      class="text-[9px] text-muted"
                    >
                      {{ graphMapNodeStatsLabel(node) }}
                    </span>
                  </button>
                </Tip>
                <div
                  v-if="node.entrypoints.length > 0"
                  data-test-id="lowcode-workflow-graph-map-node-entrypoint"
                  class="flex items-center justify-between gap-1 text-[9px]"
                >
                  <span class="min-w-0 truncate">
                    {{ entrypointSourceLabel(node.entrypoints[0]) }}
                  </span>
                  <Tip :label="entrypointSourceJumpLabel(node.entrypoints[0])">
                    <button
                      type="button"
                      data-test-id="lowcode-workflow-graph-map-node-entrypoint-jump"
                      :aria-label="entrypointSourceJumpLabel(node.entrypoints[0])"
                      class="min-w-11 shrink-0 rounded px-1 py-0.5 text-center text-[9px] text-muted hover:bg-hover hover:text-surface focus:bg-hover focus:text-surface"
                      @click="jumpToEntrypointSource(node.entrypoints[0])"
                    >
                      {{ panels.lowcodeWorkflowGraphSource }}
                    </button>
                  </Tip>
                </div>
                <button
                  v-if="node.entrypoints.length > 1"
                  type="button"
                  data-test-id="lowcode-workflow-graph-map-node-entrypoint-more"
                  :aria-controls="graphMapSourceListId(node.id)"
                  :aria-expanded="isGraphMapSourceExpanded(node.id)"
                  :aria-label="graphMapAdditionalSourcesToggleLabel(node)"
                  class="self-start rounded border border-transparent px-1 py-0.5 text-[9px] text-muted hover:border-border hover:bg-hover hover:text-surface focus:border-border focus:bg-hover focus:text-surface"
                  @click="toggleGraphMapSources(node.id)"
                >
                  {{
                    isGraphMapSourceExpanded(node.id)
                      ? panels.lowcodeWorkflowGraphHideSources
                      : panels.lowcodeWorkflowGraphMoreSources({
                          count: node.entrypoints.length - 1
                        })
                  }}
                </button>
                <ul
                  v-if="node.entrypoints.length > 1 && isGraphMapSourceExpanded(node.id)"
                  :id="graphMapSourceListId(node.id)"
                  data-test-id="lowcode-workflow-graph-map-node-entrypoint-list"
                  :aria-label="graphMapAdditionalSourcesLabel(node.name)"
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
                    <Tip :label="entrypointSourceJumpLabel(entrypoint)">
                      <button
                        type="button"
                        data-test-id="lowcode-workflow-graph-map-node-entrypoint-extra-jump"
                        :aria-label="entrypointSourceJumpLabel(entrypoint)"
                        class="min-w-11 shrink-0 rounded px-1 py-0.5 text-center text-[9px] text-muted hover:bg-hover hover:text-surface focus:bg-hover focus:text-surface"
                        @click="jumpToEntrypointSource(entrypoint)"
                      >
                        {{ panels.lowcodeWorkflowGraphSource }}
                      </button>
                    </Tip>
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
                  {{ graphEdgeCountLabel(group.edges.length) }}
                </span>
                <Tip :label="graphMapEdgeGroupToggleLabel(group)">
                  <button
                    type="button"
                    data-test-id="lowcode-workflow-graph-map-edge-group-toggle"
                    :aria-expanded="!isGraphMapEdgeGroupCollapsed(group.kind)"
                    :aria-label="graphMapEdgeGroupToggleLabel(group)"
                    class="rounded px-1 py-0.5 text-[9px] text-muted hover:bg-hover hover:text-surface focus:bg-hover focus:text-surface"
                    @click="toggleGraphMapEdgeGroup(group.kind)"
                  >
                    {{
                      isGraphMapEdgeGroupCollapsed(group.kind)
                        ? panels.lowcodeWorkflowGraphShow
                        : panels.lowcodeWorkflowGraphHide
                    }}
                  </button>
                </Tip>
              </span>
            </div>
            <ul v-if="!isGraphMapEdgeGroupCollapsed(group.kind)" class="flex flex-col gap-0.5">
              <li
                v-for="edge in group.edges"
                :key="`${edge.fromId}-${edge.actionId}-${edge.toId}`"
                data-test-id="lowcode-workflow-graph-map-edge"
                :data-graph-map-active-match="
                  isActiveGraphMapEdgeSearchMatch(edge) ? 'true' : undefined
                "
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
                    <span class="text-[9px] uppercase text-muted/80">
                      {{ panels.lowcodeWorkflowGraphFrom + ' ' }}
                    </span>
                    <span class="ml-1">{{ edge.fromName }}</span>
                  </span>
                  <span
                    data-test-id="lowcode-workflow-graph-map-edge-arrow"
                    class="shrink-0 text-muted/70"
                  >
                    ->
                  </span>
                  <span data-test-id="lowcode-workflow-graph-map-edge-to" class="min-w-0">
                    <span class="text-[9px] uppercase text-muted/80">
                      {{ panels.lowcodeWorkflowGraphTo + ' ' }}
                    </span>
                    <span class="ml-1">{{ graphMapEdgeTargetLabel(edge) }}</span>
                    <Tip v-if="!edge.toName" :label="graphMapMissingEdgeLabel(edge)">
                      <span
                        data-test-id="lowcode-workflow-graph-map-edge-missing"
                        :aria-label="graphMapMissingEdgeLabel(edge)"
                        class="ml-1 rounded bg-red-500/10 px-1 text-red-500"
                      >
                        {{ ' ' + panels.lowcodeWorkflowGraphMissing }}
                      </span>
                    </Tip>
                  </span>
                  <Tip :label="graphMapEdgeSourceActionJumpLabel(edge)">
                    <button
                      type="button"
                      data-test-id="lowcode-workflow-graph-map-edge-action"
                      :aria-label="graphMapEdgeSourceActionJumpLabel(edge)"
                      class="shrink-0 rounded bg-hover px-1 text-[9px] text-muted hover:text-surface focus:bg-hover focus:text-surface"
                      @click="jumpToWorkflowAction(edge)"
                      @keydown.enter.prevent="jumpToWorkflowAction(edge)"
                      @keydown.space.prevent="jumpToWorkflowAction(edge)"
                    >
                      {{ graphMapEdgeActionLabel(edge) }}
                    </button>
                  </Tip>
                  <Tip :label="graphMapEdgeActionKindLabel(edge)">
                    <span
                      data-test-id="lowcode-workflow-graph-map-edge-action-kind"
                      :aria-label="graphMapEdgeActionKindLabel(edge)"
                      class="shrink-0 rounded bg-hover/70 px-1 text-[9px] text-muted"
                    >
                      {{ edge.actionKind }}
                    </span>
                  </Tip>
                  <Tip :label="graphMapEdgeBranchTitle(edge)">
                    <span
                      data-test-id="lowcode-workflow-graph-map-edge-branch"
                      :aria-label="graphMapEdgeBranchTitle(edge)"
                      class="shrink-0 rounded border border-border/70 px-1 text-[9px] text-muted"
                    >
                      {{ localizedGraphMapEdgeBranchLabel(edge) }}
                    </span>
                  </Tip>
                </span>
                <Tip v-if="edge.toName" :label="graphMapEdgeJumpLabel(edge)">
                  <button
                    type="button"
                    data-test-id="lowcode-workflow-graph-map-edge-jump"
                    :aria-label="graphMapEdgeJumpLabel(edge)"
                    class="shrink-0 rounded px-1 py-0.5 text-[10px] text-muted hover:bg-hover hover:text-surface focus:bg-hover focus:text-surface"
                    @click="jumpToWorkflow(edge.toId)"
                    @keydown.enter.prevent="jumpToWorkflow(edge.toId)"
                    @keydown.space.prevent="jumpToWorkflow(edge.toId)"
                  >
                    {{ panels.lowcodeWorkflowJump }}
                  </button>
                </Tip>
                <Tip v-else :label="graphMapMissingEdgeSourceJumpLabel(edge)">
                  <button
                    type="button"
                    data-test-id="lowcode-workflow-graph-map-edge-source-jump"
                    :aria-label="graphMapMissingEdgeSourceJumpLabel(edge)"
                    class="shrink-0 rounded px-1 py-0.5 text-[10px] text-muted hover:bg-hover hover:text-surface focus:bg-hover focus:text-surface"
                    @click="jumpToWorkflow(edge.fromId)"
                    @keydown.enter.prevent="jumpToWorkflow(edge.fromId)"
                    @keydown.space.prevent="jumpToWorkflow(edge.fromId)"
                  >
                    {{ panels.lowcodeWorkflowGraphSource }}
                  </button>
                </Tip>
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
              {{ graphNodeDetailLabel(node) }}
            </span>
            <button
              type="button"
              data-test-id="lowcode-workflow-graph-node-jump"
              class="shrink-0 rounded px-1 py-0.5 text-[10px] text-muted hover:bg-hover hover:text-surface"
              @click="jumpToWorkflow(node.id)"
            >
              {{ panels.lowcodeWorkflowJump }}
            </button>
          </div>
          <div class="flex flex-col gap-0.5 pl-1">
            <span class="text-[9px] uppercase text-muted/80">
              {{ panels.lowcodeWorkflowGraphEntries }}
            </span>
            <p
              v-if="node.entrypoints.length === 0"
              data-test-id="lowcode-workflow-graph-entry-empty"
              class="text-[10px] text-muted"
            >
              {{ panels.lowcodeWorkflowGraphNone }}
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
                  {{ panels.lowcodeWorkflowGraphSource }}
                </button>
              </li>
            </ul>
          </div>
          <div class="flex flex-col gap-0.5 pl-1">
            <span class="text-[9px] uppercase text-muted/80">
              {{ panels.lowcodeWorkflowGraphCallsOut }}
            </span>
            <p
              v-if="node.outgoing.length === 0"
              data-test-id="lowcode-workflow-graph-out-empty"
              class="text-[10px] text-muted"
            >
              {{ panels.lowcodeWorkflowGraphNone }}
            </p>
            <ul v-else class="flex flex-col gap-0.5">
              <li
                v-for="edge in node.outgoing"
                :key="`${edge.actionId}-${edge.toId}`"
                data-test-id="lowcode-workflow-graph-out-edge"
                class="flex items-center justify-between gap-2"
              >
                <span class="min-w-0">
                  {{ panels.lowcodeWorkflowGraphToTarget({ target: edge.toName ?? edge.toId }) }}
                </span>
                <button
                  v-if="edge.toName"
                  type="button"
                  data-test-id="lowcode-workflow-graph-edge-jump"
                  class="shrink-0 rounded px-1 py-0.5 text-[10px] text-muted hover:bg-hover hover:text-surface"
                  @click="jumpToWorkflow(edge.toId)"
                >
                  {{ panels.lowcodeWorkflowJump }}
                </button>
              </li>
            </ul>
          </div>
          <div class="flex flex-col gap-0.5 pl-1">
            <span class="text-[9px] uppercase text-muted/80">
              {{ panels.lowcodeWorkflowGraphCalledBy }}
            </span>
            <p
              v-if="node.incoming.length === 0"
              data-test-id="lowcode-workflow-graph-in-empty"
              class="text-[10px] text-muted"
            >
              {{ panels.lowcodeWorkflowGraphNone }}
            </p>
            <ul v-else class="flex flex-col gap-0.5">
              <li
                v-for="edge in node.incoming"
                :key="`${edge.fromId}-${edge.actionId}`"
                data-test-id="lowcode-workflow-graph-in-edge"
                class="flex items-center justify-between gap-2"
              >
                <span class="min-w-0">
                  {{ panels.lowcodeWorkflowGraphFromSource({ source: edge.fromName }) }}
                </span>
                <button
                  type="button"
                  data-test-id="lowcode-workflow-graph-edge-jump"
                  class="shrink-0 rounded px-1 py-0.5 text-[10px] text-muted hover:bg-hover hover:text-surface"
                  @click="jumpToWorkflow(edge.fromId)"
                >
                  {{ panels.lowcodeWorkflowJump }}
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
