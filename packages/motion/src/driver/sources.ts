import type {
  DocumentStateDef,
  MotionDriverSpecV1,
  SceneNode,
  StateDef,
  Variable
} from '@open-pencil/scene-graph'

/** Minimal graph surface required to enumerate and validate continuous-driver sources. */
export interface MotionDriverSourceGraph {
  readonly rootId: string
  readonly variables?: ReadonlyMap<string, Variable>
  getNode(id: string): SceneNode | undefined
}

export type MotionDriverSourceBindingCode =
  | 'page-state-missing'
  | 'page-state-type-unsupported'
  | 'document-state-missing'
  | 'document-state-type-unsupported'
  | 'variable-missing'
  | 'variable-type-unsupported'

export interface MotionDriverSourceBindingIssue {
  readonly driverId: string
  readonly code: MotionDriverSourceBindingCode
  readonly path: string
  readonly message: string
}

function isContinuousInputType(type: StateDef['type']): boolean {
  return type === 'number' || type === 'boolean'
}

function ownerPage(graph: MotionDriverSourceGraph, owner: SceneNode): SceneNode | undefined {
  const visited = new Set<string>()
  let current: SceneNode | undefined = owner
  while (current && !visited.has(current.id)) {
    if (current.type === 'CANVAS') return current
    visited.add(current.id)
    current = current.parentId ? graph.getNode(current.parentId) : undefined
  }
  return undefined
}

export function motionDriverPageStates(
  graph: MotionDriverSourceGraph,
  owner: SceneNode
): StateDef[] {
  return (ownerPage(graph, owner)?.state ?? []).filter(({ type }) => isContinuousInputType(type))
}

export function motionDriverDocumentStates(graph: MotionDriverSourceGraph): DocumentStateDef[] {
  return (graph.getNode(graph.rootId)?.lowcodeDocumentState ?? []).filter(({ type }) =>
    isContinuousInputType(type)
  )
}

export function motionDriverVariables(graph: MotionDriverSourceGraph): Variable[] {
  return [...(graph.variables?.values() ?? [])].filter(
    (variable): variable is Variable => variable.type === 'FLOAT' || variable.type === 'BOOLEAN'
  )
}

function issue(
  driverId: string,
  index: number,
  code: MotionDriverSourceBindingCode,
  field: 'stateId' | 'variableId',
  message: string
): MotionDriverSourceBindingIssue {
  return {
    driverId,
    code,
    path: `motionDrivers.drivers[${index}].source.${field}`,
    message
  }
}

/** Resolve state/token identities and reject sources the runtime cannot map to a scalar progress. */
export function inspectMotionDriverSourceBindings(
  graph: MotionDriverSourceGraph,
  owner: SceneNode,
  spec: MotionDriverSpecV1
): MotionDriverSourceBindingIssue[] {
  const pageStates = ownerPage(graph, owner)?.state ?? []
  const documentStates = graph.getNode(graph.rootId)?.lowcodeDocumentState ?? []
  const issues: MotionDriverSourceBindingIssue[] = []
  spec.drivers.forEach((driver, index) => {
    const source = driver.source
    if (source.kind === 'pageState') {
      const state = pageStates.find(({ id }) => id === source.stateId)
      if (!state) {
        issues.push(
          issue(
            driver.id,
            index,
            'page-state-missing',
            'stateId',
            `Motion driver ${driver.id} references missing page state ${source.stateId}`
          )
        )
      } else if (!isContinuousInputType(state.type)) {
        issues.push(
          issue(
            driver.id,
            index,
            'page-state-type-unsupported',
            'stateId',
            `Motion driver ${driver.id} page state ${source.stateId} must be number or boolean`
          )
        )
      }
    } else if (source.kind === 'documentState') {
      const state = documentStates.find(({ id }) => id === source.stateId)
      if (!state) {
        issues.push(
          issue(
            driver.id,
            index,
            'document-state-missing',
            'stateId',
            `Motion driver ${driver.id} references missing document state ${source.stateId}`
          )
        )
      } else if (!isContinuousInputType(state.type)) {
        issues.push(
          issue(
            driver.id,
            index,
            'document-state-type-unsupported',
            'stateId',
            `Motion driver ${driver.id} document state ${source.stateId} must be number or boolean`
          )
        )
      }
    } else if (source.kind === 'variable') {
      const variable = graph.variables?.get(source.variableId)
      if (!variable) {
        issues.push(
          issue(
            driver.id,
            index,
            'variable-missing',
            'variableId',
            `Motion driver ${driver.id} references missing variable ${source.variableId}`
          )
        )
      } else if (variable.type !== 'FLOAT' && variable.type !== 'BOOLEAN') {
        issues.push(
          issue(
            driver.id,
            index,
            'variable-type-unsupported',
            'variableId',
            `Motion driver ${driver.id} variable ${source.variableId} must be FLOAT or BOOLEAN`
          )
        )
      }
    }
  })
  return issues
}
