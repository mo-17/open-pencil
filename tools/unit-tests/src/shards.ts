import { readdir } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')

export const UNIT_TEST_GROUPS = {
  app: [
    'tests/engine/acp',
    'tests/engine/ai',
    'tests/engine/app',
    'tests/engine/cli',
    'tests/engine/marketplace',
    'tests/engine/plugins',
    'tests/engine/tauri'
  ],
  compiler: ['tests/engine/compiler', 'packages/codepen-sidecar/tests'],
  'compiler-browser': ['tests/engine/compiler/preview'],
  dom: [
    'tests/engine/docs',
    'tests/engine/dom-css',
    'tests/engine/color',
    'tests/engine/icons',
    'tests/engine/pen'
  ],
  editor: [
    'tests/engine/clipboard',
    'tests/engine/editor',
    'tests/engine/hit-test',
    'tests/engine/snap'
  ],
  fig: ['tests/engine/figma', 'tests/engine/io', 'tests/engine/kiwi'],
  motion: ['tests/engine/collab', 'tests/engine/motion', 'packages/motion-runtime/tests'],
  render: ['tests/engine/geometry', 'tests/engine/layout', 'tests/engine/render'],
  scene: [
    'tests/engine/async-work',
    'tests/engine/bytes',
    'tests/engine/lint',
    'packages/lowcode/tests',
    'tests/engine/lowcode-validation',
    'tests/engine/random',
    'tests/engine/scene-graph',
    'tests/engine/text'
  ],
  vue: [
    'tests/engine/mcp',
    'tests/engine/profiler',
    'tests/engine/tools',
    'tests/engine/vector',
    'tests/engine/vue'
  ]
} as const

const UNIT_TEST_GROUP_EXCLUDES: Partial<Record<keyof typeof UNIT_TEST_GROUPS, readonly string[]>> =
  {
    compiler: ['tests/engine/compiler/preview']
  }

export type UnitTestGroup = keyof typeof UNIT_TEST_GROUPS | 'all'

export const HEAVY_UNIT_TEST_PATTERNS = [
  'tests/engine/cli/compile-i18n.test.ts',
  'tests/engine/cli/eval.test.ts',
  'tests/engine/cli/library.test.ts',
  'tests/engine/cli/motion/export.test.ts',
  'tests/engine/cli/motion/figma-adapter.test.ts',
  'tests/engine/cli/motion/lint.test.ts',
  'tests/engine/cli/overlaps.test.ts',
  'tests/engine/clipboard/fixtures/',
  'tests/engine/io/fig/heavy/',
  'tests/engine/io/fig/roundtrip/exhaustive.test.ts',
  'tests/engine/io/fig/roundtrip/glyph-blob.test.ts',
  'tests/engine/io/fig/roundtrip/variables.test.ts',
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
