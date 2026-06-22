import type { IRStateDecl } from '#compiler/ir/types'

import { emitExpression } from '@open-pencil/core/lowcode-validation'

/**
 * Emit a single `useState` declaration. The setter is conventionally named
 * `set<Capitalized>`.
 */
export function emitStateDecl(state: IRStateDecl, indent: number): string {
  const pad = '  '.repeat(indent)
  if (state.computed) {
    const deps = computedDeps(state.computed.references)
    return `${pad}const ${state.name} = useMemo(() => ${emitExpression(state.computed.ast)}, [${deps.join(', ')}])`
  }
  if (state.computedInvalid === true) {
    return `${pad}const ${state.name} = ${formatDefault(state)}`
  }
  const setter = setterName(state.name)
  return `${pad}const [${state.name}, ${setter}] = useState(${formatDefault(state)})`
}

export function setterName(stateName: string): string {
  return `set${stateName.charAt(0).toUpperCase()}${stateName.slice(1)}`
}

function formatDefault(state: IRStateDecl): string {
  const value = state.defaultValue
  switch (state.type) {
    case 'string':
      return JSON.stringify(typeof value === 'string' ? value : '')
    case 'number':
      return String(typeof value === 'number' && Number.isFinite(value) ? value : 0)
    case 'boolean':
      return value === true ? 'true' : 'false'
    case 'array':
      return Array.isArray(value) ? safeStringify(value) : '[]'
    case 'object':
      return value && typeof value === 'object' ? safeStringify(value) : '{}'
    default:
      return 'null'
  }
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value)
  } catch {
    return 'null'
  }
}

function computedDeps(references: readonly string[]): string[] {
  const seen = new Set<string>()
  const deps: string[] = []
  for (const ref of references) {
    if (seen.has(ref)) continue
    seen.add(ref)
    deps.push(ref.startsWith('$') ? `JSON.stringify(${ref})` : ref)
  }
  return deps
}
