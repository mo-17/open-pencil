#!/usr/bin/env bun
/**
 * End-to-end sanity test for `@open-pencil/compiler`.
 *
 *   bun scripts/compile-demo.ts [--output .compiler-output] [--demo basic|form|interactive]
 *
 * Builds a synthetic SceneGraph, runs `compile()`, dumps the file Map to disk,
 * and prints next-step commands. The output dir is a fully runnable Vite +
 * React + TS project:
 *
 *   cd <output> && bun install && bun run dev
 */

import { mkdir, rm, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { parseArgs } from 'node:util'

import { compile, withDefaults } from '@open-pencil/compiler'
import { SceneGraph } from '@open-pencil/scene-graph'

type DemoName = 'basic' | 'form' | 'interactive'

const { values } = parseArgs({
  options: {
    output: { type: 'string', default: '.compiler-output' },
    demo: { type: 'string', default: 'interactive' },
    help: { type: 'boolean', short: 'h', default: false }
  }
})

if (values.help) {
  console.log(`Usage: bun scripts/compile-demo.ts [options]

Options:
  --output <path>   Output directory (default: .compiler-output)
  --demo <name>     Scene to compile: basic | form | interactive (default: interactive)
  -h, --help        Show this help`)
  process.exit(0)
}

const outputDir = resolve(process.cwd(), values.output ?? '.compiler-output')
const demoName = (values.demo ?? 'interactive') as DemoName

const graph = buildDemo(demoName)
const pageId = graph.getPages()[0].id

const out = compile({
  graph,
  pageIds: [pageId],
  options: withDefaults({ packageName: `openpencil-${demoName}-demo` })
})

if (out.warnings.length > 0) {
  console.log('warnings:')
  for (const w of out.warnings) console.log(`  [${w.code}] ${w.message}`)
}

await rm(outputDir, { recursive: true, force: true })
await mkdir(outputDir, { recursive: true })

for (const [relPath, content] of out.files) {
  const absPath = join(outputDir, relPath)
  await mkdir(dirname(absPath), { recursive: true })
  if (typeof content === 'string') {
    await writeFile(absPath, content, 'utf8')
  } else {
    await writeFile(absPath, content)
  }
}

console.log(`Wrote ${out.files.size} files to ${outputDir}`)
console.log('')
console.log('Next:')
console.log(`  cd ${values.output}`)
console.log('  bun install')
console.log('  bun run dev')

// ────────────────────────────────────────────────────────────────────────────

function buildDemo(name: DemoName): SceneGraph {
  const graph = new SceneGraph()
  graph.addPage('Demo')
  const pageId = graph.getPages()[0].id

  if (name === 'basic') {
    const frame = graph.createNode('FRAME', pageId, {
      layoutMode: 'VERTICAL',
      primaryAxisSizing: 'FIXED',
      counterAxisSizing: 'FIXED',
      width: 320,
      height: 160,
      itemSpacing: 12,
      paddingTop: 16,
      paddingRight: 16,
      paddingBottom: 16,
      paddingLeft: 16,
      cornerRadius: 8
    })
    graph.createNode('TEXT', frame.id, { text: 'Hello, OpenPencil', fontSize: 18 })
    graph.createNode('BUTTON', frame.id, { interactiveProps: { text: 'Click me' } })
    return graph
  }

  if (name === 'form') {
    const form = graph.createNode('FORM', pageId)
    graph.createNode('INPUT', form.id, {
      interactiveProps: { placeholder: 'Your name', value: '' }
    })
    graph.createNode('INPUT', form.id, {
      interactiveProps: { placeholder: 'Email', value: '' }
    })
    graph.createNode('CHECKBOX', form.id, { interactiveProps: { checked: false } })
    graph.createNode('BUTTON', form.id, { interactiveProps: { text: 'Submit' } })
    return graph
  }

  // interactive: one frame with all 6 interactive nodes
  const frame = graph.createNode('FRAME', pageId, {
    layoutMode: 'VERTICAL',
    primaryAxisSizing: 'FIXED',
    counterAxisSizing: 'FIXED',
    width: 360,
    height: 420,
    itemSpacing: 12,
    paddingTop: 20,
    paddingRight: 20,
    paddingBottom: 20,
    paddingLeft: 20,
    cornerRadius: 12
  })
  graph.createNode('TEXT', frame.id, {
    text: 'All six interactive components',
    fontSize: 16,
    fontWeight: 600
  })
  graph.createNode('INPUT', frame.id, {
    interactiveProps: { placeholder: 'Type something…', value: '' }
  })
  graph.createNode('SELECT', frame.id, {
    interactiveProps: { options: ['One', 'Two', 'Three'], value: '' }
  })
  graph.createNode('CHECKBOX', frame.id, { interactiveProps: { checked: true } })
  graph.createNode('BUTTON', frame.id, { interactiveProps: { text: 'Action' } })
  graph.createNode('FORM', frame.id, { width: 320, height: 60 })
  graph.createNode('LIST', frame.id, { width: 320, height: 80 })
  return graph
}
