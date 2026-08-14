export const COMPILER_PREVIEW_POPOUT_INTENT_TYPES = [
  'diagnostics',
  'exportMicrofrontend',
  'deploy'
] as const

export type CompilerPreviewPopoutIntentType = (typeof COMPILER_PREVIEW_POPOUT_INTENT_TYPES)[number]

export type CompilerPreviewPopoutIntent = Readonly<{
  type: CompilerPreviewPopoutIntentType
}>

const INTENT_TYPES = new Set<string>(COMPILER_PREVIEW_POPOUT_INTENT_TYPES)

export function parseCompilerPreviewPopoutIntent(value: unknown): CompilerPreviewPopoutIntent {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('Compiler preview window intent must be an object')
  }
  const keys = Reflect.ownKeys(value)
  const type = Reflect.get(value, 'type')
  if (
    keys.length !== 1 ||
    keys[0] !== 'type' ||
    typeof type !== 'string' ||
    !INTENT_TYPES.has(type)
  ) {
    throw new TypeError('Compiler preview window intent must contain one supported type')
  }
  return Object.freeze({ type: type as CompilerPreviewPopoutIntentType })
}
