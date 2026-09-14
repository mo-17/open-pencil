import { describe, expect, test } from 'bun:test'

import { withDefaults } from '@open-pencil/compiler'
import { exportFigFile } from '@open-pencil/core/io/formats/fig'
import { initCodec, parseFigFile } from '@open-pencil/core/kiwi'

import { prepareBusinessModuleInstallation } from '@/app/lowcode/backend/business/installation'
import { BUSINESS_TEMPLATE_IDS } from '@/app/lowcode/backend/business/model/types'
import { readBackendProviderDocumentRequest } from '@/app/lowcode/backend/document'
import { compileAppBackendProviderDocument } from '@/app/plugins/host/backend-provider'

import { moduleInstallationFixture } from './helpers'

describe('combined application persistence and export', () => {
  test('round-trips all five modules and exports every route to React and Vue', async () => {
    const fixture = await moduleInstallationFixture()
    for (const kind of BUSINESS_TEMPLATE_IDS.slice(1))
      prepareBusinessModuleInstallation({ ...fixture, kind }).apply()
    const request = readBackendProviderDocumentRequest(fixture.editor.graph)
    expect(request?.application.modules?.modules).toHaveLength(6)
    await initCodec()
    const bytes = await exportFigFile(fixture.editor.graph)
    const graph = await parseFigFile(bytes.buffer)
    expect(readBackendProviderDocumentRequest(graph)).toEqual(request)
    const pages = graph.getPages().filter((page) => !page.internalOnly && page.lowcodeRoutePattern)
    expect(new Set(pages.map((page) => page.lowcodeRoutePattern)).size).toBe(pages.length)
    expect(
      pages.filter((page) => page.lowcodeRoutePattern === fixture.pages.paths.login)
    ).toHaveLength(1)
    expect(
      pages.filter((page) => page.lowcodeRoutePattern === fixture.pages.paths.account)
    ).toHaveLength(1)
    for (const target of ['react', 'vue'] as const) {
      const output = compileAppBackendProviderDocument(fixture.store, {
        graph,
        pageIds: pages.map((page) => page.id),
        options: withDefaults({
          devMode: false,
          target,
          router: target === 'vue' ? 'vue-router-v4' : 'react-router-v6'
        })
      })
      expect(output.warnings).toEqual([])
      expect(output.files.has('backend/nestjs/module-manifest.json')).toBe(true)
      expect(output.files.has('backend/nestjs/src/command-kernel.module.ts')).toBe(true)
      expect(output.files.has('backend/nestjs/src/command.controller.ts')).toBe(false)
      for (const kind of BUSINESS_TEMPLATE_IDS)
        expect(output.files.has(`backend/nestjs/src/modules/${kind}/module.ts`)).toBe(true)
      expect(output.files.get('src/lowcode-backend-auth.ts')).toContain(
        'calculatePKCECodeChallenge'
      )
      const sources = [...output.files.entries()]
        .filter(([path]) => path.startsWith('src/'))
        .map(([, source]) => source)
        .join('\n')
      for (const page of pages) expect(sources).toContain(page.lowcodeRoutePattern ?? '')
    }
  }, 30000)
})
