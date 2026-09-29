import type { ActionDef, SceneNode } from '@open-pencil/scene-graph'

import { businessLabel, type BusinessTemplateEditor } from '../types'
import { businessMarkerData, readBusinessPageMarker } from './markers'
import type { BusinessNavigationAddition } from './navigation'
import { updateBusinessNavigationNode } from './navigation-history'

/** Appending a module also appends choices to generated mobile navigation, preserving authored options. */
export function appendBusinessMobileNavigation(
  editor: BusinessTemplateEditor,
  applicationId: string,
  addition: BusinessNavigationAddition,
  locale: string
): boolean {
  let compactNavigationAvailable = false
  const visit = (node: SceneNode) => {
    const marker = readBusinessPageMarker(node)
    if (
      node.type === 'SELECT' &&
      marker?.role === 'mobile-navigation' &&
      marker.applicationId === applicationId
    ) {
      const options = node.interactiveProps?.options
      if (
        !Array.isArray(options) ||
        !options.every((value): value is string => typeof value === 'string')
      )
        return
      const labels = [...options]
      if (node.responsiveOverrides?.compact?.visible === true) compactNavigationAvailable = true
      const handlers = [...(node.events?.onChange ?? [])]
      const exemplar = handlers.find((handler) => handler.kind === 'condition')
      const cleanup =
        exemplar?.kind === 'condition'
          ? exemplar.consequent.filter((action) => action.kind !== 'navigate')
          : []
      const keys = [...marker.knownKeys]
      for (const entry of addition.entries) {
        if (keys.includes(entry.key)) continue
        const title = businessLabel(entry.label, locale)
        const label = labels.includes(title) ? `${title} (${entry.path})` : title
        labels.push(label)
        keys.push(entry.key)
        handlers.push({
          id: crypto.randomUUID(),
          kind: 'condition',
          condExpr: `$value === ${JSON.stringify(label)}`,
          consequent: [
            ...structuredClone(cleanup),
            { id: crypto.randomUUID(), kind: 'navigate', to: entry.path }
          ]
        } satisfies ActionDef)
      }
      updateBusinessNavigationNode(
        editor,
        node.id,
        {
          interactiveProps: { ...node.interactiveProps, options: labels },
          events: { ...node.events, onChange: handlers },
          pluginData: businessMarkerData({ ...marker, knownKeys: keys }, node.pluginData)
        },
        'Append mobile module navigation'
      )
    }
    for (const child of editor.graph.getChildren(node.id)) visit(child)
  }
  const page = editor.graph.getNode(addition.pageId)
  if (page) visit(page)
  return compactNavigationAvailable
}
