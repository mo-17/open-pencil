import type { SceneGraph } from '@open-pencil/scene-graph'

/** Historical assignments with neither a definition nor a live field reference are inert.
 * Keep their original records in source metadata; they are not runtime transfer identities.
 * An active reference with a missing definition stays invalid and fails transfer preflight.
 */
export function retireUnusedFragmentAssignments(graph: SceneGraph) {
  const definitions = new Set<string>()
  const referenced = new Set<string>()
  for (const node of graph.getAllNodes()) {
    for (const definition of node.componentPropertyDefinitions) definitions.add(definition.id)
    for (const reference of node.componentPropertyReferences) referenced.add(reference.propertyId)
  }
  const retired: Array<{
    nodeId: string
    sourceId: string | null
    propertyId: string
    value: string
  }> = []
  for (const node of graph.getAllNodes()) {
    for (const [propertyId, value] of Object.entries(node.componentPropertyAssignments)) {
      if (definitions.has(propertyId) || referenced.has(propertyId)) continue
      retired.push({ nodeId: node.id, sourceId: node.source.id, propertyId, value })
      Reflect.deleteProperty(node.componentPropertyAssignments, propertyId)
    }
  }
  return retired
}
