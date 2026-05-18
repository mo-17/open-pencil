import {
  buildGitignore,
  buildHelloAppTsx,
  buildIndexHtml,
  buildMainTsx,
  buildPackageJson,
  buildTsConfig,
  buildViteConfig
} from './project'
import type { CompilerInput, CompilerOptions, CompilerOutput } from './types'

export type { CompileWarning, CompilerInput, CompilerOptions, CompilerOutput } from './types'

const DEFAULT_OPTIONS: CompilerOptions = {
  packageName: 'openpencil-output',
  reactVersion: '19',
  router: 'none',
  typescript: true
}

/**
 * Phase 0 hello-world compiler: returns a runnable Vite + React + TS project
 * regardless of input. Scene graph translation lands in week 3 once the page,
 * state, binding, and event emitters are in place.
 */
export function compile(input: CompilerInput): CompilerOutput {
  if (input.pageIds.length === 0) {
    return {
      files: new Map(),
      warnings: [{ code: 'no-pages', message: 'CompilerInput.pageIds is empty' }]
    }
  }

  const opts = input.options
  const files = new Map<string, string | Uint8Array>()
  files.set('package.json', buildPackageJson(opts))
  files.set('vite.config.ts', buildViteConfig())
  files.set('tsconfig.json', buildTsConfig())
  files.set('index.html', buildIndexHtml(opts.packageName))
  files.set('src/main.tsx', buildMainTsx())
  files.set('src/App.tsx', buildHelloAppTsx())
  files.set('.gitignore', buildGitignore())

  return {
    files,
    warnings: [
      {
        code: 'phase-0-stub',
        message:
          'Phase 0 stub: hello-world template emitted; scene graph translation arrives in week 3'
      }
    ]
  }
}

export function withDefaults(overrides: Partial<CompilerOptions> = {}): CompilerOptions {
  return { ...DEFAULT_OPTIONS, ...overrides }
}
