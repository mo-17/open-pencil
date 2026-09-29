import type { BusinessActionDefinition } from '../types'
import { createBusinessCommand, renderBusinessCommandFeedback } from './commands'
import { businessActionConditionExpression } from './conditions'
import {
  FOOD_ORDERING_COLORS as colors,
  foodButton,
  foodSurface,
  foodText
} from './food-ordering/style'
import { prepareBusinessInputs, renderBusinessInputs } from './forms'
import { BUSINESS_CONTENT_WIDTH, BUSINESS_CONTENT_X } from './layout'
import { businessButton, businessSurface, businessText } from './presentation/style'
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
  const food = ctx.definition.id === 'food-ordering'
  const y = screen.reserve(92 + Math.ceil(actions.length / 3) * 56)
  ctx.layout.text(
    screen.page,
    food ? ctx.label({ en: 'Make it yours', zh: '接下来，你可以' }) : ctx.copy.actions,
    { x: BUSINESS_CONTENT_X, y, width: BUSINESS_CONTENT_WIDTH, height: 34 },
    food
      ? foodText(colors.text, 22, 600)
      : businessText(ctx.presentation, { size: 22, weight: 600 })
  )
  ctx.layout.text(
    screen.page,
    food
      ? ctx.label({
          en: 'Choose an option below. Review the details before confirming.',
          zh: '选择下方操作，核对信息后再确认。'
        })
      : ctx.copy.chooseAction,
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
      {
        ...(food ? foodButton('secondary') : businessButton(ctx.presentation, 'secondary')),
        ...(entry.available ? { renderCondition: entry.available } : {})
      }
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
        {
          ...(food ? foodButton('quiet') : businessButton(ctx.presentation, 'quiet')),
          renderCondition: `!(${entry.available})`
        }
      )
  }
  const panelY = screen.reserve(Math.max(...actions.map((entry) => entry.height)) + 48)
  for (const { definition, inputs, command, available, reviewOnly, height } of actions) {
    const panel = ctx.layout.shape(
      'FRAME',
      ctx.label(definition.label) + ' panel',
      screen.page,
      BUSINESS_CONTENT_X,
      panelY,
      BUSINESS_CONTENT_WIDTH,
      height + 48,
      {
        ...(food
          ? foodSurface({ stroke: colors.border, radius: 18 })
          : businessSurface(ctx.presentation, {
              stroke: ctx.presentation.colors.border,
              radius: 14
            })),
        renderCondition: `(${screen.current}) && ${screen.action.name} === ${JSON.stringify(definition.id)}`
      }
    )
    const body = ctx.layout.shape(
      'FRAME',
      food ? 'Restaurant action content' : 'Business action content',
      panel,
      24,
      24,
      832,
      height,
      food ? foodSurface({ radius: 0 }) : businessSurface(ctx.presentation, { radius: 0 })
    )
    ctx.layout.text(
      body,
      ctx.label(definition.description),
      { x: 0, y: 0, width: 820, height: 60 },
      { fontSize: 14 }
    )
    const form = ctx.layout.shape(
      'FORM',
      ctx.label(definition.label),
      body,
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
      {
        renderCondition: `(${command.allowed}) || (${command.running})`,
        bindings: {
          text: {
            kind: 'expr',
            expr: `${command.running} ? ${JSON.stringify(ctx.copy.busy)} : ${JSON.stringify(ctx.label(definition.label))}`
          }
        }
      }
    )
    if (available)
      ctx.layout.text(
        body,
        ctx.label({
          en: 'Select a record that supports this action to continue. You can still review any saved request below.',
          zh: '请重新选择适用于此操作的记录。下方仍可核对已保存的请求。'
        }),
        { x: 0, y: inputs.height + 84, width: 820, height: 60 },
        { renderCondition: `!(${available})`, fontSize: 14 }
      )
    renderBusinessCommandFeedback(screen, body, inputs.height + 172, definition, command)
  }
}
