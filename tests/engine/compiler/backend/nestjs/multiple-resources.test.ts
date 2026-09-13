import { describe, expect, test } from 'bun:test'

import { Transpiler } from 'bun'

import {
  NESTJS_BACKEND_PROVIDER_DESCRIPTOR,
  createBackendProviderPlan,
  createBuiltinBackendProviderRegistry,
  emitBackendProviderPlan
} from '@open-pencil/compiler/backend'

import { nestJSApplication } from './helpers'

describe('NestJS multiple-resource module assembly', () => {
  test.each(['react', 'vue'] as const)(
    'emits parseable %s sources and normalized resource imports',
    (target) => {
      const application = structuredClone(nestJSApplication())
      if (!application.httpApi) throw new Error('Expected explicit HTTP fixture')
      application.httpApi.resources.push({
        ...application.httpApi.resources[0],
        id: 'archive-notes',
        path: '/archives'
      })
      const registry = createBuiltinBackendProviderRegistry()
      const selection = {
        descriptor: NESTJS_BACKEND_PROVIDER_DESCRIPTOR,
        packageDigest: `sha256:${'A'.repeat(43)}`,
        enabled: true
      }
      const planned = createBackendProviderPlan(registry, {
        selection,
        application,
        target,
        mode: 'production'
      })
      expect(planned.ok, JSON.stringify(planned.diagnostics)).toBe(true)
      if (!planned.ok) throw new Error('Expected two-resource plan')
      const result = emitBackendProviderPlan(registry, { selection, plan: planned.plan })
      expect(result.ok, JSON.stringify(result.ok ? [] : result.diagnostics)).toBe(true)
      if (!result.ok) throw new Error('Expected two-resource artifacts')
      const module = result.emission.files.get('backend/nestjs/src/app.module.ts')
      if (typeof module !== 'string') throw new Error('Expected root module source')
      expect(module).toContain(
        "import { Resource0Module } from './resources/archive-notes.module.js'\n" +
          "import { Resource1Module } from './resources/notes-api.module.js'"
      )
      const transpiler = new Transpiler({ loader: 'ts', target: 'node' })
      for (const [path, content] of result.emission.files) {
        if (!path.endsWith('.ts')) continue
        if (typeof content !== 'string') throw new Error('Expected text TypeScript source')
        expect(() => transpiler.transformSync(content), path).not.toThrow()
      }
      for (const [index, id] of ['archive-notes', 'notes-api'].entries()) {
        const resource = result.emission.files.get(`backend/nestjs/src/resources/${id}.module.ts`)
        if (typeof resource !== 'string') throw new Error('Expected resource module source')
        expect(resource).toContain(`export class Resource${index}Module`)
      }
    }
  )
})
