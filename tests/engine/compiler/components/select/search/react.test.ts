import { describe, expect, test } from 'bun:test'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { compile, withDefaults } from '@open-pencil/compiler'
import { buildComponentModule } from '@open-pencil/compiler/adapters/react/emit/component'
import { collectTree } from '@open-pencil/compiler/ir/collect/tree'
import type { ComponentDef } from '@open-pencil/compiler/ir/types'
import { SceneGraph } from '@open-pencil/scene-graph'

import { typeCheckCompilerFiles } from '#tests/helpers/compiler/typecheck'

function scene(enhanced = true) {
  const graph = new SceneGraph()
  const pageId = graph.getPages()[0].id
  graph.updateNode(pageId, {
    state: [
      { id: 'choice', name: 'choice', type: 'string', defaultValue: '' },
      {
        id: 'options',
        name: 'options',
        type: 'array',
        defaultValue: [
          { id: '', name: 'All statuses' },
          { id: 'ready', name: 'Ready' }
        ]
      }
    ]
  })
  graph.createNode('SELECT', pageId, {
    name: 'Searchable status',
    width: 320,
    height: 40,
    bindings: { value: { kind: 'ref', stateId: 'choice' } },
    events: {
      onChange: [{ kind: 'setState', targetStateId: 'choice', valueExpr: '$value' }]
    },
    interactiveProps: {
      ariaLabel: 'Searchable status',
      showSearch: enhanced,
      virtual: enhanced,
      placeholder: 'Choose a status',
      allowClear: true,
      validation: { required: true },
      optionsSource: {
        kind: 'ref',
        stateId: 'options',
        itemName: 'entry',
        indexName: 'entryIndex',
        valueExpr: 'entry.id',
        labelExpr: 'entry.name + entryIndex'
      }
    }
  })
  graph.createNode('SELECT', pageId, {
    name: 'Static status',
    width: 320,
    height: 40,
    interactiveProps: {
      ariaLabel: 'Static status',
      showSearch: enhanced,
      value: 'ready',
      options: [
        { value: '', label: 'All statuses' },
        { value: 'ready', label: 'Ready' },
        { value: 'disabled', label: 'Unavailable', disabled: true }
      ]
    }
  })
  return { graph, pageId }
}

function output(enhanced = true, shadcn = false, i18n = false) {
  const { graph, pageId } = scene(enhanced)
  return compile({
    graph,
    pageIds: [pageId],
    options: withDefaults({
      target: 'react',
      devMode: false,
      router: 'none',
      i18n,
      ...(shadcn ? { uiKit: 'shadcn' } : {})
    })
  })
}

describe('React enhanced SELECT emission', () => {
  test('keeps the native path when search and virtualization are disabled', () => {
    const files = output(false).files
    expect(files.get('src/App.tsx')).toContain('<select ')
    expect(files.has('src/lib/open-pencil-select.ts')).toBe(false)
    expect(files.has('src/components/_open-pencil-select.tsx')).toBe(false)
  })

  test('emits data while preserving dynamic empty-value guards, index labels and writes', () => {
    const source = output().files.get('src/App.tsx') as string
    expect(source).toContain('<__OpenPencilSelect ')
    expect(source).not.toContain('<option ')
    expect(source).toContain('.flatMap((entry, entryIndex) =>')
    expect(source).toContain('.some((entry) => (entry.id) === "")')
    expect(source).toContain('setChoice(e.target.value)')
    expect(source).toContain('__validateFieldValue(')
    expect(source).toContain('disabled: Boolean(true)')
    expect(source).toContain('value: "", label: "All statuses"')
  })

  test('search labels are localized as strings and bring their own useIntl hook', () => {
    const source = output(true, false, true).files.get('src/App.tsx') as string
    expect(source).toContain('const intl = useIntl()')
    expect(source).toContain('label: intl.formatMessage(')
    expect(source).not.toContain('FormattedMessage')
  })

  test('shadcn does not emit an unused Radix Select alongside enhanced controls', () => {
    const compiled = output(true, true)
    expect(compiled.files.has('src/components/ui/select.tsx')).toBe(false)
    expect(compiled.files.get('package.json')).not.toContain('@radix-ui/react-select')
    expect(compiled.warnings.some(({ code }) => code === 'ui-kit-native-control-fallback')).toBe(
      false
    )
  })

  test('reusable component bodies import the enhanced control from their sibling path', () => {
    const { graph, pageId } = scene()
    const ir = collectTree(graph, pageId)
    const definition: ComponentDef = {
      componentId: 'picker',
      name: 'Picker',
      children: ir.children,
      props: [],
      docStateReads: []
    }
    const source = buildComponentModule(definition, false)
    expect(source).toContain("from './_open-pencil-select'")
    expect(source).toContain('<__OpenPencilSelect ')
  })

  test('server rendering has no DOM requirement and renders only the selected native option', () => {
    const directory = mkdtempSync(join(tmpdir(), 'openpencil-select-ssr-'))
    try {
      const files = output().files
      mkdirSync(join(directory, 'components'))
      mkdirSync(join(directory, 'lib'))
      symlinkSync(resolve('packages/compiler/node_modules'), join(directory, 'node_modules'), 'dir')
      writeFileSync(
        join(directory, 'components/select.tsx'),
        files.get('src/components/_open-pencil-select.tsx') as string
      )
      writeFileSync(
        join(directory, 'lib/open-pencil-select.ts'),
        files.get('src/lib/open-pencil-select.ts') as string
      )
      writeFileSync(
        join(directory, 'render.tsx'),
        `import { createElement } from 'react'
import { writeFileSync } from 'node:fs'
import { renderToStaticMarkup } from 'react-dom/server'
import { OpenPencilSelect } from './components/select'
const options = Array.from({ length: 10000 }, (_, index) => ({ value: String(index), label: 'Option ' + index }))
writeFileSync('render.html', renderToStaticMarkup(createElement(OpenPencilSelect, { options, value: '9000', showSearch: true, virtual: true, name: 'status' })))
writeFileSync('unmatched.html', renderToStaticMarkup(createElement(OpenPencilSelect, { options, value: 'missing', showSearch: true, virtual: true, name: 'status' })))
`
      )
      execFileSync(process.execPath, [join(directory, 'render.tsx')], {
        cwd: directory,
        timeout: 10000
      })
      const html = readFileSync(join(directory, 'render.html'), 'utf8')
      expect(html.match(/<option\b/g)).toHaveLength(1)
      expect(html).toContain('value="9000"')
      expect(html).toContain('Option 9000')
      expect(html).not.toContain('Option 1</option>')
      expect(readFileSync(join(directory, 'unmatched.html'), 'utf8')).not.toContain('<option')
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  test.each([false, true])(
    'generated React SELECT type-checks with shadcn=%s',
    (shadcn) => {
      const files = output(true, shadcn, true).files
      typeCheckCompilerFiles(
        new Map(
          [...files].filter((entry): entry is [string, string] => typeof entry[1] === 'string')
        ),
        'react'
      )
    },
    35000
  )
})
