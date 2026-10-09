import { existsSync } from 'node:fs'
import { readdir } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'

import { resolveWorkspaceRoot } from '@open-pencil/package-artifacts-tools'

const REPO_ROOT = await resolveWorkspaceRoot(import.meta.dir)

const APPLICATION_BROWSER_TEST_ROOTS = [
  'tests/engine/app/lowcode/backend/business/browser',
  'tests/engine/app/lowcode/backend/commerce/operations/browser'
] as const

export const UNIT_TEST_GROUPS = {
  app: [
    'tests/app',
    'tests/engine/ai',
    'tests/engine/docs',
    'packages/docs/tests',
    'tests/engine/marketplace',
    'tests/engine/plugins',
    'packages/plugin-contracts/tests',
    'tests/integration',
    'tests/engine/acp',
    'tests/engine/app',
    'tests/engine/collab',
    'tests/engine/tauri'
  ],
  compiler: [
    'packages/compiler/tests',
    'tests/engine/compiler',
    'packages/backend-compiler-sidecar/tests',
    'packages/codepen-sidecar/tests'
  ],
  'compiler-browser': ['tests/engine/compiler/preview', ...APPLICATION_BROWSER_TEST_ROOTS],
  motion: [
    'tests/engine/motion',
    'packages/motion/tests',
    'packages/motion-runtime/tests',
    'packages/figma-motion-plugin/tests'
  ],
  lowcode: ['packages/lowcode/tests', 'tests/engine/lowcode-validation'],
  cli: ['packages/cli/tests', 'tests/engine/cli'],
  core: [
    'packages/core/tests',
    'tests/engine/clipboard',
    'tests/engine/color',
    'tests/engine/core',
    'tests/engine/editor',
    'tests/engine/icons',
    'tests/engine/layout',
    'tests/engine/library',
    'tests/engine/lint',
    'tests/engine/profiler',
    'tests/engine/text',
    'tests/engine/tools',
    'tests/engine/vector'
  ],
  dom: [
    'packages/emit/tests',
    'packages/design-jsx/tests',
    'packages/dom-css/tests',
    'packages/pen/tests',
    'tests/engine/dom-css',
    'tests/engine/pen'
  ],
  fig: [
    'packages/fig/tests',
    'packages/kiwi/tests',
    'tests/engine/figma',
    'tests/engine/io',
    'tests/engine/kiwi'
  ],
  mcp: ['packages/mcp/tests', 'tests/engine/mcp'],
  render: ['tests/engine/render'],
  'scene-graph': [
    'packages/scene-graph/tests',
    'tests/engine/geometry',
    'tests/engine/hit-test',
    'tests/engine/async-work',
    'tests/engine/random',
    'tests/engine/scene-graph',
    'tests/engine/snap'
  ],
  vue: ['packages/vue/tests', 'tests/engine/vue']
} as const

const UNIT_TEST_GROUP_EXCLUDES: Partial<Record<keyof typeof UNIT_TEST_GROUPS, readonly string[]>> =
  {
    compiler: ['tests/engine/compiler/preview'],
    app: APPLICATION_BROWSER_TEST_ROOTS
  }

export type UnitTestGroup = keyof typeof UNIT_TEST_GROUPS | 'all'

export const HEAVY_UNIT_TEST_PATTERNS = [
  'tests/engine/cli/compile-i18n.test.ts',
  'tests/engine/cli/eval.test.ts',
  'tests/engine/cli/fonts.test.ts',
  'tests/engine/cli/library.test.ts',
  'tests/engine/cli/motion/export.test.ts',
  'tests/engine/cli/motion/figma-adapter.test.ts',
  'tests/engine/cli/motion/lint.test.ts',
  'tests/engine/cli/overlaps.test.ts',
  'tests/engine/clipboard/fixtures/',
  'tests/engine/io/fig/heavy/',
  'packages/core/tests/io/formats/fig/heavy/',
  'packages/core/tests/io/formats/fig/roundtrip/exhaustive.test.ts',
  'packages/core/tests/io/formats/fig/roundtrip/glyph-blob.test.ts',
  'packages/core/tests/io/formats/fig/roundtrip/variables.test.ts',
  'tests/engine/io/fig/export/text.test.ts',
  'tests/engine/io/fig/export/worker.test.ts',
  'tests/engine/io/fig/import/group-reclassify.test.ts',
  'tests/engine/layout/auto-layout/text/measurement.test.ts',
  'tests/engine/render/canvas/cache.test.ts',
  'tests/engine/tools/cli.test.ts'
] as const

export function unitTestGroupNames(): UnitTestGroup[] {
  return [...Object.keys(UNIT_TEST_GROUPS), 'all'] as UnitTestGroup[]
}

export function pathsForUnitTestGroup(group: UnitTestGroup): string[] {
  if (group === 'all') return Object.values(UNIT_TEST_GROUPS).flat()
  return [...UNIT_TEST_GROUPS[group]]
}

export function isHeavyUnitTest(path: string): boolean {
  const normalized = normalizePath(path)
  return HEAVY_UNIT_TEST_PATTERNS.some(
    (pattern) => normalized.startsWith(pattern) || normalized === pattern
  )
}

export async function listUnitTests(
  group: UnitTestGroup,
  options: { includeHeavy?: boolean } = {}
): Promise<string[]> {
  const files = excludeFilesOutsideGroup(group, await listTestFiles(pathsForUnitTestGroup(group)))
  return options.includeHeavy ? files : files.filter((file) => !isHeavyUnitTest(file))
}

export async function listHeavyUnitTests(group: UnitTestGroup = 'all'): Promise<string[]> {
  const files = excludeFilesOutsideGroup(group, await listTestFiles(pathsForUnitTestGroup(group)))
  return files.filter(isHeavyUnitTest)
}

function excludeFilesOutsideGroup(group: UnitTestGroup, files: string[]): string[] {
  if (group === 'all') return files
  const excludedRoots = UNIT_TEST_GROUP_EXCLUDES[group] ?? []
  return files.filter((file) =>
    excludedRoots.every((root) => file !== root && !file.startsWith(`${root}/`))
  )
}

async function listTestFiles(paths: string[]): Promise<string[]> {
  const files = await Promise.all(paths.map((path) => listTestFilesInPath(path)))
  return [...new Set(files.flat())].sort()
}

async function listTestFilesInPath(path: string): Promise<string[]> {
  const absolutePath = resolve(REPO_ROOT, path)
  if (!existsSync(absolutePath)) return []
  const entries = await readdir(absolutePath, { withFileTypes: true })
  const files = await Promise.all(
    entries.map(async (entry) => {
      const childPath = join(path, entry.name)
      if (entry.isDirectory()) return listTestFilesInPath(childPath)
      if (entry.isFile() && entry.name.endsWith('.test.ts')) return [normalizePath(childPath)]
      return []
    })
  )
  return files.flat()
}

function normalizePath(path: string): string {
  if (!isAbsolute(path)) return path.split(sep).join('/')
  return relative(REPO_ROOT, path).split(sep).join('/') || path.split(sep).join('/')
}
