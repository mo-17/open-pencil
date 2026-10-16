import { afterEach, describe, expect, test } from 'bun:test'
import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { checkGuideMap, listedGuides } from '../src/guides'

const fixtures: string[] = []

afterEach(async () => {
  await Promise.all(fixtures.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

async function repo(rootGuide: string, guides: string[] = []) {
  const repoRoot = await mkdtemp(join(tmpdir(), 'open-pencil-guides-'))
  fixtures.push(repoRoot)
  await writeFile(join(repoRoot, 'AGENTS.md'), rootGuide, 'utf8')
  for (const guide of guides) {
    await mkdir(join(repoRoot, guide, '..'), { recursive: true })
    await writeFile(join(repoRoot, guide), '# Guide\n', 'utf8')
  }
  return repoRoot
}

function git(repoRoot: string, ...args: string[]): void {
  execFileSync('git', args, { cwd: repoRoot, stdio: 'pipe' })
}

describe('listedGuides', () => {
  test('collects unique nested guide paths written as inline code', () => {
    const markdown = [
      '| `packages/core` | Core | `packages/core/AGENTS.md`, `packages/vue/AGENTS.md` |',
      'See `packages/core/AGENTS.md` again and `AGENTS.md` at the root.',
      'Not a guide: `packages/core/README.md` or packages/vue/AGENTS.md without code spans.'
    ].join('\n')

    expect(listedGuides(markdown)).toEqual(['packages/core/AGENTS.md', 'packages/vue/AGENTS.md'])
  })
})

describe('checkGuideMap', () => {
  test('passes when every nested guide is listed and every listed guide exists', async () => {
    const repoRoot = await repo(
      '| `src` | App | `src/AGENTS.md` |\n| `tests` | Tests | `tests/AGENTS.md` |\n',
      [
        'src/AGENTS.md',
        'tests/AGENTS.md',
        'node_modules/dep/AGENTS.md',
        '.claude/worktrees/other/packages/core/AGENTS.md'
      ]
    )

    const result = checkGuideMap({ repoRoot })

    expect(result.errors).toEqual([])
    expect(result.guides).toEqual(['src/AGENTS.md', 'tests/AGENTS.md'])
    expect(result.listed).toEqual(['src/AGENTS.md', 'tests/AGENTS.md'])
  })

  test('reports unlisted guides on disk and listed guides that do not exist', async () => {
    const repoRoot = await repo('Guides: `packages/vue/AGENTS.md`.\n', ['packages/core/AGENTS.md'])

    const result = checkGuideMap({ repoRoot })

    expect(result.errors).toEqual([
      'packages/core/AGENTS.md is not listed in the root AGENTS.md map',
      'Root AGENTS.md references missing guide packages/vue/AGENTS.md'
    ])
  })

  test('fails without a root guide', async () => {
    const repoRoot = await mkdtemp(join(tmpdir(), 'open-pencil-guides-empty-'))
    fixtures.push(repoRoot)

    expect(checkGuideMap({ repoRoot }).errors).toEqual(['Missing root AGENTS.md'])
  })

  test('checks tracked and untracked source guides while excluding ignored backups', async () => {
    const guides = [
      'src/tracked/AGENTS.md',
      'src/new/AGENTS.md',
      'output/kept/AGENTS.md',
      'scratch/kept/AGENTS.md'
    ]
    const repoRoot = await repo(guides.map((guide) => `Guide: \`${guide}\`.`).join('\n'), [
      ...guides,
      'output/history/AGENTS.md',
      'scratch/history/AGENTS.md'
    ])
    await writeFile(join(repoRoot, '.gitignore'), '/output/\n/scratch/\n')
    git(repoRoot, 'init', '--quiet')
    git(repoRoot, 'add', 'AGENTS.md', 'src/tracked/AGENTS.md')
    git(repoRoot, 'add', '--force', 'output/kept/AGENTS.md', 'scratch/kept/AGENTS.md')

    const result = checkGuideMap({ repoRoot })

    expect(result.errors).toEqual([])
    expect(result.guides).toEqual([...guides].sort())
    expect(result.listed).toEqual([...guides].sort())
  })

  test('still rejects an unlisted untracked guide and a deleted tracked guide', async () => {
    const repoRoot = await repo('Guide: `src/AGENTS.md`.', ['src/AGENTS.md', 'tools/AGENTS.md'])
    git(repoRoot, 'init', '--quiet')
    git(repoRoot, 'add', 'AGENTS.md', 'src/AGENTS.md')
    await rm(join(repoRoot, 'src/AGENTS.md'))

    expect(checkGuideMap({ repoRoot }).errors).toEqual([
      'tools/AGENTS.md is not listed in the root AGENTS.md map',
      'Root AGENTS.md references missing guide src/AGENTS.md'
    ])
  })

  test('does not fall back to a disk walk when Git metadata is invalid', async () => {
    const repoRoot = await repo('Guide: `src/AGENTS.md`.', ['src/AGENTS.md'])
    await writeFile(join(repoRoot, '.git'), 'gitdir: ./missing-worktree-metadata\n')

    expect(() => checkGuideMap({ repoRoot })).toThrow()
  })

  test('normalizes guide paths from the repository root when launched in a subdirectory', async () => {
    const repoRoot = await repo('Guide: `src/AGENTS.md`.', ['src/AGENTS.md'])
    git(repoRoot, 'init', '--quiet')
    const output = execFileSync(
      process.execPath,
      [
        '--eval',
        `import { checkGuideMap } from ${JSON.stringify(import.meta.resolve('../src/guides'))}; console.log(checkGuideMap({ repoRoot: ${JSON.stringify(repoRoot)} }).guides.join(','));`
      ],
      { cwd: join(repoRoot, 'src'), encoding: 'utf8' }
    )

    expect(output.trim()).toBe('src/AGENTS.md')
  })
})
