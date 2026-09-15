import type { BusinessActionDefinition } from '../types'
import { createBusinessCommand, renderBusinessCommandFeedback } from './commands'
import { businessActionConditionExpression } from './conditions'
import { prepareBusinessInputs, renderBusinessInputs } from './forms'
import { BUSINESS_CONTENT_WIDTH, BUSINESS_CONTENT_X } from './layout'
import type { BusinessScreen } from './screen'
import { businessLiteral, businessSet } from './state'

function prepareAction(screen: BusinessScreen, definition: BusinessActionDefinition) {
  const inputs = prepareBusinessInputs(screen, definition.inputs)
  const payload = Object.entries(definition.parameters).map(([key, source]) => {
    if (source.kind === 'literal') return { key, valueExpr: businessLiteral(source.value) }
    if (source.kind === 'selection') return { key, valueExpr: `${screen.selected}.${source.field}` }
    const entry = inputs.entries.find((input) => input.input.key === source.key)
    if (!entry) throw new Error('Missing business form parameter: ' + source.key)
    return { key, valueExpr: entry.valueExpr }
  })
  const conditions = inputs.entries
    .filter((entry) => (entry.input.required ?? true) && entry.input.kind !== 'number')
    // SELECT state holds the chosen label; a valid mapped false value is not missing.
    .map((entry) => `!!(${entry.input.kind === 'select' ? entry.state.name : entry.valueExpr})`)
  const available = definition.when
    ? `(${screen.selection}) && ${businessActionConditionExpression(definition.when, screen.selected)}`
    : undefined
  const reviewOnly = available ? screen.field('ReviewOnly', 'boolean', false) : undefined
  if (available) conditions.push(available)
  else if (Object.values(definition.parameters).some((source) => source.kind === 'selection'))
    conditions.push(screen.selection)
  const command = createBusinessCommand(
    screen,
    definition,
    payload,
    conditions.join(' && ') || '!0'
  )
  return { definition, inputs, command, available, reviewOnly, height: inputs.height + 560 }
}

export function prepareBusinessActions(screen: BusinessScreen) {
  return screen.definition.actions.map((definition) => prepareAction(screen, definition))
}

export function renderBusinessActions(
  screen: BusinessScreen,
  actions: ReturnType<typeof prepareBusinessActions>
): void {
  if (!actions.length) return
  const { ctx } = screen
  const y = screen.reserve(92 + Math.ceil(actions.length / 3) * 56)
  ctx.layout.text(
    screen.page,
    ctx.copy.actions,
    { x: BUSINESS_CONTENT_X, y, width: BUSINESS_CONTENT_WIDTH, height: 34 },
    { fontSize: 22 }
  )
  ctx.layout.text(
    screen.page,
    ctx.copy.chooseAction,
    { x: BUSINESS_CONTENT_X, y: y + 42, width: BUSINESS_CONTENT_WIDTH, height: 42 },
    { fontSize: 14 }
  )
  for (const [index, entry] of actions.entries()) {
    const rect = {
      x: BUSINESS_CONTENT_X + (index % 3) * 294,
      y: y + 92 + Math.floor(index / 3) * 56,
      width: 276,
      height: 44
    }
    ctx.layout.button(
      screen.page,
      ctx.label(entry.definition.label),
      rect,
      [
        ...screen.beginAction(entry.definition.id),
        ...(entry.reviewOnly ? [businessSet(entry.reviewOnly, '!1')] : []),
        {
          id: crypto.randomUUID(),
          kind: 'condition',
          condExpr: screen.selection,
          consequent: entry.inputs.entries
            .filter((input) => input.input.fromSelection)
            .map((input) =>
              businessSet(
                input.state,
                input.input.kind === 'select'
                  ? (input.input.choices ?? [])
                      .map(
                        (choice) =>
                          `${screen.selected}.${input.input.fromSelection} === ${businessLiteral(choice.value)} ? ${JSON.stringify(ctx.label(choice.label))} : `
                      )
                      .join('') + '""'
                  : `${screen.selected}.${input.input.fromSelection}`
              )
            )
        }
      ],
      entry.available ? { renderCondition: entry.available } : {}
    )
    if (entry.available && entry.reviewOnly)
      ctx.layout.button(
        screen.page,
        ctx.copy.inspect + ' · ' + ctx.label(entry.definition.label),
        rect,
        [
          ...screen.beginAction(entry.definition.id),
          businessSet(entry.reviewOnly, '!0'),
          ...entry.command.recovery.startInspect
        ],
        { renderCondition: `!(${entry.available})` }
      )
  }
  const panelY = screen.reserve(Math.max(...actions.map((entry) => entry.height)))
  for (const { definition, inputs, command, available, reviewOnly, height } of actions) {
    const panel = ctx.layout.shape(
      'FRAME',
      ctx.label(definition.label) + ' panel',
      screen.page,
      BUSINESS_CONTENT_X,
      panelY,
      BUSINESS_CONTENT_WIDTH,
      height,
      {
        renderCondition: `(${screen.current}) && ${screen.action.name} === ${JSON.stringify(definition.id)}`
      }
    )
    ctx.layout.text(
      panel,
      ctx.label(definition.description),
      { x: 0, y: 0, width: 820, height: 60 },
      { fontSize: 14 }
    )
    const form = ctx.layout.shape(
      'FORM',
      ctx.label(definition.label),
      panel,
      0,
      76,
      820,
      inputs.height + 68,
      {
        layoutMode: 'NONE',
        events: { onSubmit: [command.submit] },
        ...(reviewOnly ? { renderCondition: `!${reviewOnly.name}` } : {})
      }
    )
    renderBusinessInputs(screen, form, inputs)
    ctx.layout.button(
      form,
      ctx.label(definition.label),
      { x: 0, y: inputs.height + 8, width: 300, height: 44 },
      [],
      { renderCondition: command.allowed }
    )
    if (available)
      ctx.layout.text(
        panel,
        ctx.label({
          en: 'Select a record that supports this action to continue. You can still review any saved request below.',
          zh: '请重新选择适用于此操作的记录。下方仍可核对已保存的请求。'
        }),
        { x: 0, y: inputs.height + 84, width: 820, height: 60 },
        { renderCondition: `!(${available})`, fontSize: 14 }
      )
    renderBusinessCommandFeedback(screen, panel, inputs.height + 172, definition, command)
  }
}
