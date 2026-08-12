import type { ArgsDef } from 'citty'

import type { CompilerOptions, UIKitName } from '@open-pencil/compiler'

export type CodegenWebTarget = Extract<CompilerOptions['target'], 'react' | 'vue'>

const CODEGEN_WEB_TARGETS = ['react', 'vue'] as const

export const codegenTargetArgs: ArgsDef = {
  target: {
    type: 'string',
    description: 'Generated web framework: react (default) or vue.',
    required: false
  }
}

export interface RawCodegenTargetArgs {
  target?: string
}

/** Resolve the public web codegen target without widening CLI access to the
 * source-only native adapters. Unknown values fail before compilation/build. */
export function resolveCodegenTarget(args: RawCodegenTargetArgs): CodegenWebTarget {
  const raw = args.target?.trim().toLowerCase() || 'react'
  if ((CODEGEN_WEB_TARGETS as readonly string[]).includes(raw)) {
    return raw as CodegenWebTarget
  }
  throw new Error(
    `Unknown --target "${raw}". Supported web targets: ${CODEGEN_WEB_TARGETS.join(', ')}.`
  )
}

export function routerForCodegenTarget(
  target: CodegenWebTarget,
  pageCount: number
): CompilerOptions['router'] {
  if (pageCount <= 1) return 'none'
  return target === 'vue' ? 'vue-router-v4' : 'react-router-v6'
}

/** Vue v1 intentionally does not pretend React-only i18n/UI-kit runtimes were
 * emitted. Reject those flags at the CLI boundary rather than returning a
 * project whose requested behavior is absent. */
export function validateCodegenTargetFeatures(input: {
  target: CodegenWebTarget
  i18n: boolean
  uiKit?: UIKitName
}): void {
  if (input.target !== 'vue') return
  if (input.i18n) {
    throw new Error(
      'Vue v1 does not support --i18n, --locale, or --source-locale; remove those flags or use --target react.'
    )
  }
  if (input.uiKit) {
    throw new Error(
      `Vue v1 does not support the React UI kit '${input.uiKit}'; remove --ui-kit or use --target react.`
    )
  }
}
