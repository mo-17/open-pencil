import { expect, test } from 'bun:test'
import { existsSync, mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import type { StateDef } from '@open-pencil/scene-graph'

import { browserApplication, browserGraph, compileBrowser } from './helpers'

test.each(['react', 'vue'] as const)(
  '%s generated project typechecks unknown document filters and Vue record-to-state assignments',
  async (target) => {
    const fixture = browserGraph()
    const application = browserApplication()
    if (!application.httpApi) throw new Error('Missing fixture API')
    application.httpApi.resources[0].query = {
      filterFields: ['title'],
      searchFields: ['title'],
      sortFields: ['id']
    }
    fixture.graph.updateNode(fixture.list.id, {
      interactiveProps: {
        ...fixture.list.interactiveProps,
        dataSourceRef: {
          kind: 'backendResource',
          resourceId: 'notes-api',
          filterEntries: [{ key: 'title', valueExpr: 'result.title || ""' }]
        }
      }
    })
    if (target === 'vue') {
      const states: StateDef[] = [
        { id: 'text', name: 'text', type: 'string', defaultValue: '' },
        { id: 'count', name: 'count', type: 'number', defaultValue: 0 },
        { id: 'active', name: 'active', type: 'boolean', defaultValue: false },
        { id: 'items', name: 'items', type: 'array', defaultValue: [] },
        { id: 'details', name: 'details', type: 'object', defaultValue: {} }
      ]
      fixture.graph.updateNode(fixture.notes.id, { state: states })
      fixture.graph.createNode('BUTTON', fixture.notes.id, {
        events: {
          onClick: [
            ...states.map((state) => ({
              id: 'copy-' + state.id,
              kind: 'setState' as const,
              targetStateId: state.id,
              valueExpr: 'result.' + state.name
            })),
            {
              id: 'functional-fallback',
              kind: 'setState',
              targetStateId: 'text',
              valueExpr: '$prev || result.text'
            }
          ]
        }
      })
    }
    const output = compileBrowser(target, fixture, application)
    const pages = [...output.files]
      .filter(([path]) => path.startsWith('src/pages/'))
      .map(([, source]) => String(source))
      .join('\n')
    expect(pages).toContain('filter: { "title":')
    if (target === 'vue') {
      expect(pages.match(/const __opNextState: unknown = /g)).toHaveLength(6)
      expect(pages).toContain('__opPrevious ||')
    }
    const directory = mkdtempSync(join(tmpdir(), 'openpencil-query-types-'))
    try {
      const dependencies = [
        'openid-client',
        'vite',
        ...(target === 'vue'
          ? ['vue', 'vue-router']
          : [
              'react',
              'react-dom',
              'react-router-dom',
              'zustand',
              '@types/react',
              '@types/react-dom'
            ])
      ]
      for (const dependency of dependencies) {
        const installed = ['packages/compiler', 'packages/cli', '.']
          .map((workspace) => resolve(workspace, 'node_modules', dependency))
          .find(existsSync)
        if (!installed) throw new Error('Missing workspace test dependency: ' + dependency)
        const destination = join(directory, 'node_modules', dependency)
        mkdirSync(dirname(destination), { recursive: true })
        symlinkSync(installed, destination, 'dir')
      }
      for (const [path, content] of output.files) {
        const destination = join(directory, path)
        mkdirSync(dirname(destination), { recursive: true })
        writeFileSync(destination, content)
      }
      const tool =
        target === 'vue'
          ? join(
              dirname(fileURLToPath(import.meta.resolve('vue-tsc/package.json'))),
              'bin/vue-tsc.js'
            )
          : join(dirname(fileURLToPath(import.meta.resolve('typescript/package.json'))), 'bin/tsc')
      const child = Bun.spawn(['node', tool, '--noEmit', '-p', join(directory, 'tsconfig.json')], {
        cwd: directory,
        stdout: 'inherit',
        stderr: 'inherit'
      })
      const timer = setTimeout(() => child.kill(), 30000)
      try {
        expect(await child.exited).toBe(0)
      } finally {
        clearTimeout(timer)
      }
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  },
  35000
)
