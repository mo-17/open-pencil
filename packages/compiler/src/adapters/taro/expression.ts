import type { ComponentDef } from '#compiler/ir/types'

import { emitExpression, substituteIdents, type ExprAst } from '@open-pencil/lowcode'

import { uniqueMiniProgramIdentifier } from '../miniprogram-shared'

export type TaroExpressionBindings = ReadonlyMap<string, ExprAst>

export function createTaroComponentPropAliases(
  definition: ComponentDef
): ReadonlyMap<string, string> {
  const aliases = new Map<string, string>()
  const used = new Set(['className'])
  for (const prop of definition.props) {
    if (prop.kind !== 'text' || prop.name === 'className') continue
    aliases.set(prop.name, uniqueMiniProgramIdentifier(prop.name, used, 'prop'))
  }
  return aliases
}

export function createTaroExpressionBindings(
  aliases: ReadonlyMap<string, string>
): TaroExpressionBindings {
  return new Map(
    [...aliases].map(([name, alias]) => [name, { kind: 'ident', name: alias } satisfies ExprAst])
  )
}

export function emitTaroExpression(ast: ExprAst, bindings: TaroExpressionBindings): string {
  return emitExpression(substituteIdents(ast, bindings))
}
