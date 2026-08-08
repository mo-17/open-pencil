import { afterEach, describe, expect, it } from 'bun:test'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { generateLlmArtifacts } from '../.vitepress/llms/generate'

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true }))
  )
})

async function fixture() {
  const repoRoot = await mkdtemp(path.join(os.tmpdir(), 'open-pencil-llms-'))
  temporaryDirectories.push(repoRoot)
  const docsDir = path.join(repoRoot, 'packages/docs')
  const outDir = path.join(docsDir, '.vitepress/dist')
  await mkdir(path.join(docsDir, 'guide'), { recursive: true })
  await mkdir(path.join(docsDir, 'de'), { recursive: true })
  await mkdir(path.join(repoRoot, 'shared'), { recursive: true })
  await writeFile(path.join(docsDir, 'index.md'), '# Ignored root page\n')
  await writeFile(path.join(docsDir, 'de/ignored.md'), '# Ignored translation\n')
  await writeFile(path.join(repoRoot, 'shared/include.md'), 'Included content.\n')
  await writeFile(
    path.join(docsDir, 'guide/first.md'),
    `---
title: First page
description: First description
---

# First page

<!--@include: ../../../shared/include.md-->

<div>HTML only</div>

<llm-only>LLM-only content.</llm-only>

<llm-exclude>Excluded content.</llm-exclude>
`
  )
  await writeFile(path.join(docsDir, 'guide/second.md'), '# Second page\n\nSecond content.\n')
  return { repoRoot, docsDir, outDir }
}

describe('streaming LLMS documentation build', () => {
  it('bounds page processing and streams an ordered full bundle', async () => {
    const { repoRoot, docsDir, outDir } = await fixture()
    const result = await generateLlmArtifacts({
      repoRoot,
      docsDir,
      outDir,
      domain: 'https://docs.example.test',
      localePrefixes: ['de'],
      sidebar: [
        {
          text: 'Guide',
          items: [
            { text: 'Second', link: '/guide/second' },
            { text: 'First', link: '/guide/first' }
          ]
        }
      ],
      title: 'Fixture',
      description: 'Fixture docs.',
      details: 'Fixture details.',
      concurrency: 2
    })

    expect(result.pages).toBe(2)
    const first = await readFile(path.join(outDir, 'guide/first.md'), 'utf8')
    expect(first).toContain("url: 'https://docs.example.test/guide/first.md'")
    expect(first).toContain('Included content.')
    expect(first).toContain('LLM-only content.')
    expect(first).not.toContain('HTML only')
    expect(first).not.toContain('Excluded content.')

    const toc = await readFile(result.llmsTxtPath, 'utf8')
    expect(toc).toContain('### Guide')
    expect(toc.indexOf('[Second page]')).toBeLessThan(toc.indexOf('[First page]'))

    const full = await readFile(result.llmsFullTxtPath, 'utf8')
    expect(full.indexOf('# Second page')).toBeLessThan(full.indexOf('# First page'))
    expect(full).toContain("\n---\n\n---\nurl: 'https://docs.example.test/guide/first.md'")
  })

  it('rejects an invalid concurrency before writing output', async () => {
    const { repoRoot, docsDir, outDir } = await fixture()
    await expect(
      generateLlmArtifacts({
        repoRoot,
        docsDir,
        outDir,
        domain: 'https://docs.example.test',
        localePrefixes: [],
        title: 'Fixture',
        description: 'Fixture docs.',
        details: 'Fixture details.',
        concurrency: 0
      })
    ).rejects.toThrow('positive integer')
  })
})
