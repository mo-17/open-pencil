import type { NodeChange } from '@open-pencil/kiwi/fig/codec'
import type { GUID } from '@open-pencil/scene-graph/primitives'

type MutableRecord = Record<string, unknown>

export type FigmaNodeReferencePath =
  | 'transitionNodeID'
  | 'prototypeStartNodeID'
  | 'messageObjectAnimation.targetNodeId'
  | 'action.transitionNodeID'
  | 'action.animationTargetId'
  | 'behavior.link.page'
  | 'behavior.appear.otherLayer'
  | 'behavior.scrollTransform.otherLayer'
  | 'behavior.cursor.cursorGuid'

export type ResolveFigmaNodeReference = (source: GUID, path: FigmaNodeReferencePath) => GUID | null

function asRecord(value: unknown): MutableRecord | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as MutableRecord)
    : null
}

function isGuid(value: unknown): value is GUID {
  const record = asRecord(value)
  return (
    record !== null && typeof record.sessionID === 'number' && typeof record.localID === 'number'
  )
}

function remapGuidField(
  record: MutableRecord,
  field: string,
  path: FigmaNodeReferencePath,
  resolve: ResolveFigmaNodeReference
): 'absent' | 'resolved' | 'missing' {
  const source = record[field]
  if (!isGuid(source)) return 'absent'
  const resolved = resolve(source, path)
  if (resolved) {
    record[field] = resolved
    return 'resolved'
  }
  Reflect.deleteProperty(record, field)
  return 'missing'
}

function remapConditionalActions(value: unknown, resolve: ResolveFigmaNodeReference): unknown[] {
  if (!Array.isArray(value)) return []
  const result: unknown[] = []
  for (const candidate of value) {
    const conditional = asRecord(candidate)
    if (!conditional) {
      result.push(candidate)
      continue
    }
    if (!Array.isArray(conditional.actions) || conditional.actions.length === 0) {
      result.push(conditional)
      continue
    }
    const actions = remapActions(conditional.actions, resolve)
    if (actions.length === 0) continue
    conditional.actions = actions
    result.push(conditional)
  }
  return result
}

function remapAction(candidate: unknown, resolve: ResolveFigmaNodeReference): unknown {
  const action = asRecord(candidate)
  if (!action) return candidate

  const transitionResult = remapGuidField(
    action,
    'transitionNodeID',
    'action.transitionNodeID',
    resolve
  )
  if (
    transitionResult === 'missing' &&
    (action.connectionType === undefined || action.connectionType === 'INTERNAL_NODE')
  ) {
    return null
  }

  if (
    remapGuidField(action, 'animationTargetId', 'action.animationTargetId', resolve) === 'missing'
  ) {
    return null
  }

  if (Array.isArray(action.conditionalActions) && action.conditionalActions.length > 0) {
    const conditionalActions = remapConditionalActions(action.conditionalActions, resolve)
    if (conditionalActions.length === 0 && action.connectionType === 'CONDITIONAL') return null
    action.conditionalActions = conditionalActions
  }

  return action
}

function remapActions(value: unknown, resolve: ResolveFigmaNodeReference): unknown[] {
  if (!Array.isArray(value)) return []
  const result: unknown[] = []
  for (const candidate of value) {
    const action = remapAction(candidate, resolve)
    if (action !== null) result.push(action)
  }
  return result
}

function remapInteractionArray(
  nodeChange: MutableRecord,
  field: 'prototypeInteractions' | 'objectAnimations',
  resolve: ResolveFigmaNodeReference
): void {
  const value = nodeChange[field]
  if (!Array.isArray(value)) return
  if (value.length === 0) return
  const result: unknown[] = []
  for (const candidate of value) {
    const interaction = asRecord(candidate)
    if (!interaction) {
      result.push(candidate)
      continue
    }
    if (!Array.isArray(interaction.actions) || interaction.actions.length === 0) {
      result.push(interaction)
      continue
    }
    const actions = remapActions(interaction.actions, resolve)
    if (actions.length === 0) continue
    interaction.actions = actions
    result.push(interaction)
  }
  if (result.length > 0) nodeChange[field] = result
  else Reflect.deleteProperty(nodeChange, field)
}

function remapBehaviorTarget(
  behaviors: MutableRecord,
  behaviorField: string,
  targetField: string,
  path: FigmaNodeReferencePath,
  resolve: ResolveFigmaNodeReference
): 'absent' | 'resolved' | 'missing' {
  const behavior = asRecord(behaviors[behaviorField])
  if (!behavior) return 'absent'
  return remapGuidField(behavior, targetField, path, resolve)
}

function remapBehaviors(nodeChange: MutableRecord, resolve: ResolveFigmaNodeReference): void {
  const behaviors = asRecord(nodeChange.behaviors)
  if (!behaviors) return
  const hadBehaviorBranches = Object.keys(behaviors).length > 0

  const link = asRecord(behaviors.link)
  if (link?.type === 'PAGE') {
    const result = remapBehaviorTarget(behaviors, 'link', 'page', 'behavior.link.page', resolve)
    if (result !== 'resolved') delete behaviors.link
  }

  const appear = asRecord(behaviors.appear)
  if (appear?.trigger === 'OTHER_LAYER_IN_VIEW') {
    const result = remapBehaviorTarget(
      behaviors,
      'appear',
      'otherLayer',
      'behavior.appear.otherLayer',
      resolve
    )
    if (result !== 'resolved') delete behaviors.appear
  }

  const scrollTransform = asRecord(behaviors.scrollTransform)
  if (scrollTransform?.trigger === 'OTHER_LAYER_IN_VIEW') {
    const result = remapBehaviorTarget(
      behaviors,
      'scrollTransform',
      'otherLayer',
      'behavior.scrollTransform.otherLayer',
      resolve
    )
    if (result !== 'resolved') delete behaviors.scrollTransform
  }

  if (asRecord(behaviors.cursor)) {
    const result = remapBehaviorTarget(
      behaviors,
      'cursor',
      'cursorGuid',
      'behavior.cursor.cursorGuid',
      resolve
    )
    if (result !== 'resolved') delete behaviors.cursor
  }

  if (hadBehaviorBranches && Object.keys(behaviors).length === 0) delete nodeChange.behaviors
}

/**
 * Remap only GUID paths whose Kiwi schema explicitly identifies another scene node.
 * Timeline, preset, interaction, variable, and style GUIDs intentionally remain opaque.
 * Missing targets are removed together with the action/behavior branch that requires them.
 */
export function remapFigmaNodeReferences(
  nodeChange: NodeChange & MutableRecord,
  resolve: ResolveFigmaNodeReference
): void {
  remapGuidField(nodeChange, 'transitionNodeID', 'transitionNodeID', resolve)
  remapGuidField(nodeChange, 'prototypeStartNodeID', 'prototypeStartNodeID', resolve)
  remapInteractionArray(nodeChange, 'prototypeInteractions', resolve)
  remapInteractionArray(nodeChange, 'objectAnimations', resolve)
  remapBehaviors(nodeChange, resolve)
}

/**
 * Remap the Message.objectAnimations list, whose targets live outside NodeChange.
 * Entries whose required target no longer exists are removed instead of emitting
 * a dangling GUID. Unknown shapes remain opaque and are preserved verbatim.
 */
export function remapFigmaMessageObjectAnimations(
  value: unknown,
  resolve: ResolveFigmaNodeReference
): unknown {
  const list = asRecord(value)
  if (!list || !Array.isArray(list.entries) || list.entries.length === 0) return value

  const entries: unknown[] = []
  for (const candidate of list.entries) {
    const entry = asRecord(candidate)
    if (!entry) {
      entries.push(candidate)
      continue
    }

    if (
      remapGuidField(entry, 'targetNodeId', 'messageObjectAnimation.targetNodeId', resolve) ===
      'missing'
    ) {
      continue
    }

    const animation = asRecord(entry.animation)
    if (animation) {
      const remappedAnimation = remapAction(animation, resolve)
      if (remappedAnimation === null) continue
      entry.animation = remappedAnimation
    }
    entries.push(entry)
  }

  if (entries.length === 0) return null
  list.entries = entries
  return list
}
