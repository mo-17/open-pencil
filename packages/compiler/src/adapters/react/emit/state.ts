import type { IRStateDecl } from '#compiler/ir/types'

/**
 * Emit a single `useState` declaration. The setter is conventionally named
 * `set<Capitalized>`.
 */
export function emitStateDecl(state: IRStateDecl, indent: number): string {
  const pad = '  '.repeat(indent)
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
