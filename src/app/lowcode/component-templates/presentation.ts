import { parseColor } from '@open-pencil/core/color'
import type { ActionDef, DocumentStateDef, NodeType, SceneNode } from '@open-pencil/scene-graph'
import type { JSONObject } from '@open-pencil/scene-graph/primitives'

import type { ComponentTemplateEditor } from './types'

export const TEMPLATE_COLORS = {
  ink: '#172B4D',
  muted: '#52657F',
  border: '#D9E2F0',
  fieldBorder: '#CBD5E1',
  fieldHover: '#94A3B8',
  placeholder: '#64748B',
  paper: '#FFFFFF',
  accent: '#2358D4',
  tint: '#F3F6FC'
} as const

export function templateSurface(color: string, border = false): Partial<SceneNode> {
  return {
    fills: [{ type: 'SOLID', color: parseColor(color), opacity: 1, visible: true }],
    strokes: border
      ? [
          {
            color: parseColor(TEMPLATE_COLORS.border),
            weight: 1,
            opacity: 1,
            visible: true,
            align: 'INSIDE'
          }
        ]
      : [],
    cornerRadius: 8
  }
}

function textFieldStyle(multiline: boolean): Partial<SceneNode> {
  const surface = templateSurface(TEMPLATE_COLORS.paper, true)
  const border = surface.strokes?.map((stroke) => ({
    ...stroke,
    color: parseColor(TEMPLATE_COLORS.fieldBorder)
  }))
  return {
    ...surface,
    strokes: border,
    height: multiline ? 128 : 44,
    fontSize: 16,
    lineHeight: 24,
    paddingLeft: 12,
    paddingRight: 12,
    paddingTop: multiline ? 12 : 9,
    paddingBottom: multiline ? 12 : 9,
    stateOverrides: {
      hover: {
        strokes: border?.map((stroke) => ({
          ...stroke,
          color: parseColor(TEMPLATE_COLORS.fieldHover)
        }))
      },
      focus: {
        strokes: border?.map((stroke) => ({
          ...stroke,
          color: parseColor(TEMPLATE_COLORS.accent)
        })),
        effects: [
          {
            type: 'DROP_SHADOW',
            color: { ...parseColor(TEMPLATE_COLORS.accent), a: 0.12 },
            offset: { x: 0, y: 0 },
            radius: 0,
            spread: 4,
            visible: true
          }
        ]
      },
      disabled: { fills: templateSurface(TEMPLATE_COLORS.tint).fills, opacity: 0.6 }
    }
  }
}

export function createTemplateContext(
  editor: ComponentTemplateEditor,
  locale: string,
  prefix: string
) {
  const nodeIds: string[] = []
  const states: DocumentStateDef[] = []
  const localStates: DocumentStateDef[] = []
  let actionCount = 0
  const zh = locale.toLowerCase().startsWith('zh')
  const copy = (en: string, cn: string) => (zh ? cn : en)
  function node(type: NodeType, parent: string, name: string, props: Partial<SceneNode> = {}) {
    const { x = 0, y = 0, width = 320, height = 44, ...rest } = props
    const id = editor.createShape(type, x, y, width, height, parent, name, {
      layoutPositioning: 'AUTO',
      counterAxisSizing: 'FILL',
      primaryAxisSizing: 'FIXED',
      minWidth: 0,
      fontFamily: 'Inter',
      fontSize: 14,
      ...rest
    })
    nodeIds.push(id)
    return id
  }
  function text(parent: string, label: string, props: Partial<SceneNode> = {}) {
    return node('TEXT', parent, label, {
      ...templateSurface(TEMPLATE_COLORS.ink),
      cornerRadius: 0,
      text: label,
      height: props.lineHeight ?? 22,
      primaryAxisSizing: 'HUG',
      textAutoResize: 'HEIGHT',
      lineHeight: 22,
      responsiveOverrides: {
        compact: { primaryAxisSizing: 'HUG', counterAxisSizing: 'FILL', minWidth: 0 },
        xl: { primaryAxisSizing: 'HUG', counterAxisSizing: 'FILL', minWidth: 0 }
      },
      ...props
    })
  }
  function stack(parent: string, name: string, props: Partial<SceneNode> = {}) {
    return node('FRAME', parent, name, {
      fills: [],
      layoutMode: 'VERTICAL',
      primaryAxisSizing: 'HUG',
      itemSpacing: 12,
      counterAxisAlign: 'STRETCH',
      clipsContent: false,
      ...props
    })
  }
  function state(
    key: string,
    type: DocumentStateDef['type'],
    defaultValue: DocumentStateDef['defaultValue']
  ) {
    const name = `${prefix}_${key}`
    states.push({ id: name, name, type, defaultValue })
    return name
  }
  function set(targetName: string, valueExpr: string): ActionDef {
    if (localStates.some((state) => state.name === targetName))
      return {
        id: `${prefix}_action${++actionCount}`,
        kind: 'setState',
        targetStateId: targetName,
        valueExpr
      }
    return { id: `${prefix}_action${++actionCount}`, kind: 'setVariable', targetName, valueExpr }
  }
  function localState(key: string, type: DocumentStateDef['type'], defaultValue: unknown) {
    const name = `${prefix}_${key}`
    localStates.push({ id: name, name, type, defaultValue })
    return name
  }
  function feedback(parent: string, expression: string, label = copy('Current value', '当前值')) {
    return text(parent, label, {
      fontSize: 13,
      fills: templateSurface(TEMPLATE_COLORS.muted).fills,
      bindings: {
        text: { kind: 'expr', expr: `${JSON.stringify(label + ': ')} + (${expression})` }
      }
    })
  }
  function field(
    parent: string,
    type: NodeType,
    label: string,
    stateName: string,
    interactiveProps: JSONObject = {}
  ) {
    const textEntry = type === 'INPUT' || type === 'TEXTAREA'
    const container = textEntry ? stack(parent, label + ' field', { itemSpacing: 6 }) : parent
    text(container, label, { fontWeight: textEntry ? 500 : 600 })
    const toggle = type === 'CHECKBOX' || type === 'SWITCH'
    return node(type, container, label + ' control', {
      ...templateSurface(TEMPLATE_COLORS.paper, true),
      ...(toggle ? { width: 44, height: 44, counterAxisSizing: 'FIXED' as const } : {}),
      ...(textEntry ? textFieldStyle(type === 'TEXTAREA') : {}),
      ...(type === 'RADIO' ? { height: 88 } : {}),
      interactiveProps: {
        ariaLabel: label,
        textColor: TEMPLATE_COLORS.ink,
        ...(textEntry ? { placeholderColor: TEMPLATE_COLORS.placeholder } : {}),
        ...interactiveProps
      },
      bindings: {
        value: localStates.some((state) => state.name === stateName)
          ? { kind: 'ref', stateId: stateName }
          : { kind: 'docState', docStateName: stateName }
      }
    })
  }
  function button(
    parent: string,
    label: string,
    actions: ActionDef[] = [],
    secondary = false,
    submit = false
  ) {
    return node('BUTTON', parent, label, {
      ...templateSurface(secondary ? TEMPLATE_COLORS.paper : TEMPLATE_COLORS.accent, secondary),
      fontWeight: 600,
      interactiveProps: {
        text: label,
        ariaLabel: label,
        type: submit ? 'submit' : 'button',
        textColor: secondary ? TEMPLATE_COLORS.ink : TEMPLATE_COLORS.paper
      },
      ...(actions.length ? { events: { onClick: actions } } : {})
    })
  }
  return {
    editor,
    zh,
    copy,
    prefix,
    nodeIds,
    states,
    localStates,
    localState,
    node,
    text,
    stack,
    state,
    set,
    feedback,
    field,
    button
  }
}

export type TemplateContext = ReturnType<typeof createTemplateContext>
