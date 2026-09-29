import { parseColor } from '@open-pencil/core/color'
import type { ActionDef, StateDef } from '@open-pencil/scene-graph'

import type { NotesTemplateEditor } from '../notes-template'

export interface TemplateMobileNavigationEntry {
  label: string
  path: string
  actions: ActionDef[]
}

function navigationOptions(
  entries: readonly TemplateMobileNavigationEntry[]
): TemplateMobileNavigationEntry[] {
  const unique = new Map(entries.map((entry) => [entry.label + '\u0000' + entry.path, entry]))
  const labels = new Map<string, number>()
  for (const entry of unique.values()) labels.set(entry.label, (labels.get(entry.label) ?? 0) + 1)
  const used = new Set<string>()
  return [...unique.values()].map((entry) => {
    const base = (labels.get(entry.label) ?? 0) > 1 ? `${entry.label} (${entry.path})` : entry.label
    let label = base
    for (let index = 2; used.has(label); index++) label = `${base} (${index})`
    used.add(label)
    return { ...entry, label }
  })
}

/** Native mobile navigation retains the authored route and cleanup action sequence. */
export function createTemplateMobileNavigation(
  editor: NotesTemplateEditor,
  parentId: string,
  canvasId: string,
  entries: readonly TemplateMobileNavigationEntry[],
  currentPath: string,
  label = '页面导航'
): { nodeId: string; state: StateDef } {
  const canvas = editor.graph.getNode(canvasId)
  if (canvas?.type !== 'CANVAS') throw new Error('Mobile navigation needs a page.')
  const current = entries.find((entry) => entry.path === currentPath)
  const options = navigationOptions([
    current ?? { label: canvas.name, path: currentPath, actions: [] },
    ...entries
  ])
  const currentLabel = options.find((entry) => entry.path === currentPath)?.label ?? canvas.name
  const names = new Set([
    ...(canvas.state ?? []).map((entry) => entry.name),
    ...(editor.graph.getNode(editor.graph.rootId)?.lowcodeDocumentState ?? []).map(
      (entry) => entry.name
    )
  ])
  let name = 'mobilePageNavigation'
  for (let index = 2; names.has(name); index++) name = 'mobilePageNavigation' + index
  const state: StateDef = {
    id: crypto.randomUUID(),
    name,
    type: 'string',
    defaultValue: currentLabel
  }
  const nodeId = editor.createShape('SELECT', 0, 0, 320, 44, parentId, label, {
    visible: false,
    fontSize: 16,
    cornerRadius: 10,
    fills: [{ type: 'SOLID', color: parseColor('#FFFFFF'), opacity: 1, visible: true }],
    strokes: [
      { color: parseColor('#DDE4ED'), weight: 1, opacity: 1, visible: true, align: 'INSIDE' }
    ],
    bindings: { value: { kind: 'ref', stateId: state.id } },
    interactiveProps: { options: options.map((entry) => entry.label), ariaLabel: label },
    events: {
      onChange: options
        .filter((entry) => entry.actions.length)
        .map((entry): ActionDef => ({
          id: crypto.randomUUID(),
          kind: 'condition',
          condExpr: `$value === ${JSON.stringify(entry.label)}`,
          consequent: structuredClone(entry.actions)
        }))
    },
    responsiveOverrides: {
      compact: {
        visible: true,
        layoutPositioning: 'AUTO',
        counterAxisSizing: 'FILL',
        minWidth: 0,
        height: 44,
        fontSize: 16
      }
    }
  })
  return { nodeId, state }
}
