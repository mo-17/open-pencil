import type { StateDef } from '@open-pencil/scene-graph'

import type { BusinessInput } from '../types'
import { foodText, FOOD_ORDERING_COLORS } from './food-ordering/style'
import { renderBusinessList } from './listing'
import { businessText } from './presentation/style'
import type { BusinessScreen } from './screen'
import { businessLiteral, businessSet } from './state'

export function prepareBusinessInputs(screen: BusinessScreen, inputs: readonly BusinessInput[]) {
  const entries = inputs.map((input) => {
    const state = screen.formField(
      input.key,
      input.kind === 'number' ? 'number' : 'string',
      input.initial ?? (input.kind === 'number' ? (input.min ?? 0) : '')
    )
    const label = input.kind === 'relation' ? screen.formField(input.key + 'Label') : undefined
    const valueExpr =
      input.kind === 'select'
        ? (input.choices ?? [])
            .map(
              (choice) =>
                `${state.name} === ${JSON.stringify(screen.ctx.label(choice.label))} ? ${businessLiteral(choice.value)} : `
            )
            .join('') + '""'
        : state.name
    return { input, state, label, valueExpr }
  })
  const positions = inputPositions(inputs)
  const height = positions.reduce(
    (bottom, position) => Math.max(bottom, position.y + position.height),
    0
  )
  return { entries, height, positions }
}

function inputPositions(inputs: readonly BusinessInput[]) {
  let y = 0
  let column = 0
  return inputs.map((input) => {
    const wide = input.kind === 'relation' || input.kind === 'textarea'
    if (wide && column) {
      y += 100
      column = 0
    }
    const rect = { x: column * 420, y, width: wide ? 820 : 400, height: inputHeight(input) }
    if (wide || column) {
      y += inputHeight(input)
      column = 0
    } else column = 1
    return rect
  })
}

function inputHeight(input: BusinessInput): number {
  if (input.kind === 'relation') return 480
  return input.kind === 'textarea' ? 180 : 100
}

function inputControl(input: BusinessInput): 'TEXTAREA' | 'SELECT' | 'INPUT' {
  if (input.kind === 'textarea') return 'TEXTAREA'
  return input.kind === 'select' ? 'SELECT' : 'INPUT'
}

function renderBusinessRelation(
  screen: BusinessScreen,
  parent: string,
  y: number,
  entry: {
    input: BusinessInput
    state: StateDef
    label?: StateDef
  },
  prepared: ReturnType<typeof prepareBusinessInputs>
): void {
  const relation = entry.input.relation
  if (!relation || !entry.label) throw new Error('A relation input requires a reviewed source.')
  const { ctx } = screen
  const filters = Object.entries(relation.filters ?? {}).map(([key, source]) => {
    if (source.kind === 'literal') return { key, valueExpr: businessLiteral(source.value) }
    if (source.kind === 'selection')
      return {
        key,
        valueExpr: `(${screen.selected}.${source.field} || "00000000-0000-4000-8000-000000000000")`
      }
    const input = prepared.entries.find((item) => item.input.key === source.key)
    if (!input) throw new Error('Missing relation filter input: ' + source.key)
    return { key, valueExpr: `(${input.valueExpr} || "00000000-0000-4000-8000-000000000000")` }
  })
  const dependent = prepared.entries.filter((item) =>
    Object.values(item.input.relation?.filters ?? {}).some(
      (source) => source.kind === 'input' && source.key === entry.input.key
    )
  )
  renderBusinessList(
    screen,
    parent,
    {
      resourceId: relation.resourceId,
      columns: relation.columns ?? [{ field: relation.labelField, label: entry.input.label }]
    },
    y + 38,
    {
      x: 0,
      width: 820,
      ...(filters.length ? { filters } : {}),
      chooseLabel: ctx.copy.chooseRelation + ' · ' + ctx.label(entry.input.label),
      choose: [
        businessSet(entry.state, 'item.' + (relation.valueField ?? 'id')),
        businessSet(entry.label, 'item.' + relation.labelField),
        ...dependent.flatMap((item) => [
          businessSet(item.state, '""'),
          ...(item.label ? [businessSet(item.label, '""')] : [])
        ])
      ]
    }
  )
  ctx.layout.text(
    parent,
    '',
    { x: 0, y: y + 428, width: 820, height: 32 },
    {
      bindings: {
        text: {
          kind: 'expr',
          expr: `${JSON.stringify(ctx.copy.relationSelected + ': ')} + (${entry.label.name} || ${entry.state.name})`
        }
      }
    }
  )
}

export function renderBusinessInputs(
  screen: BusinessScreen,
  parent: string,
  prepared: ReturnType<typeof prepareBusinessInputs>
): void {
  const { ctx } = screen
  for (const [index, entry] of prepared.entries.entries()) {
    const { x, y, width, height } = prepared.positions[index]
    const { input, state } = entry
    const label = ctx.label(input.label)
    const group = ctx.layout.shape('FRAME', label + ' field', parent, x, y, width, height, {
      fills: [],
      strokes: [],
      cornerRadius: 0,
      layoutMode: 'NONE',
      responsiveOverrides: { compact: { itemSpacing: 8 } }
    })
    ctx.layout.text(
      group,
      label,
      { x: 0, y: 0, width, height: 30 },
      ctx.definition.id === 'food-ordering'
        ? foodText(FOOD_ORDERING_COLORS.muted, 14, 500)
        : businessText(ctx.presentation, {
            color: ctx.presentation.colors.muted,
            size: 14,
            weight: 500
          })
    )
    if (input.kind === 'relation') renderBusinessRelation(screen, group, 0, entry, prepared)
    else
      ctx.layout.shape(
        inputControl(input),
        label,
        group,
        0,
        36,
        width,
        input.kind === 'textarea' ? 120 : 44,
        {
          bindings: { value: { kind: 'ref', stateId: state.id } },
          interactiveProps: {
            placeholder: label,
            ...(input.choices
              ? { options: ['', ...input.choices.map((choice) => ctx.label(choice.label))] }
              : {}),
            validation: {
              required: input.required ?? true,
              ...(input.maxLength === undefined ? {} : { maxLength: input.maxLength }),
              ...(input.min === undefined ? {} : { min: input.min }),
              ...(input.max === undefined ? {} : { max: input.max }),
              ...(input.kind === 'text' || input.kind === 'textarea' ? { pattern: '\\S' } : {})
            }
          }
        }
      )
  }
}
