import { describe, expect, test } from 'bun:test'

import { compile, withDefaults } from '@open-pencil/compiler'
import { exportFigFile } from '@open-pencil/core/io/formats/fig'
import { initCodec, parseFigFile } from '@open-pencil/core/kiwi'

import {
  componentStateGraph,
  richTextTypographyGraph
} from '#tests/helpers/compiler/components/states/fixture'
import { STATE_FAMILIES } from '#tests/helpers/compiler/components/states/types'

describe('authored component state matrix', () => {
  for (const locale of ['en', 'zh-CN'] as const)
    test(`${locale} rich-text preserves configured typography and content through FIG`, async () => {
      await initCodec()
      const { graph } = richTextTypographyGraph(locale)
      const bytes = await exportFigFile(graph)
      const restored = await parseFigFile(bytes.slice().buffer)
      const root = restored.getChildren(restored.getPages()[0].id)[0]
      expect(root.primaryAxisSizing).toBe('HUG')
      expect(root.height).toBeGreaterThan(700)
      const before = graph
        .getChildren(graph.getChildren(graph.getPages()[0].id)[0].id)
        .filter((node) => node.type === 'FRAME')
      const after = restored.getChildren(root.id).filter((node) => node.type === 'FRAME')
      expect(after).toHaveLength(2)
      expect(after.map((node) => node.interactiveProps)).toEqual(
        before.map((node) => node.interactiveProps)
      )
      expect(
        compile({
          graph: restored,
          pageIds: [restored.getPages()[0].id],
          options: withDefaults({ target: 'react', sourceLocale: locale })
        }).warnings
      ).toEqual([])
    })
  for (const locale of ['en', 'zh-CN'] as const)
    for (const family of STATE_FAMILIES)
      test(`${locale} ${family} preserves flags, module styling and auto-layout through FIG and both targets`, async () => {
        await initCodec()
        const { graph, controls, pageId } = componentStateGraph(family, locale)
        const bytes = await exportFigFile(graph)
        const restored = await parseFigFile(bytes.slice().buffer)
        const restoredRoot = restored.getChildren(restored.getPages()[0].id)[0]
        expect(restoredRoot.layoutMode).toBe('VERTICAL')
        expect(restoredRoot.primaryAxisSizing).toBe('HUG')
        const restoredControls = restored
          .getChildren(restoredRoot.id)
          .filter((node) => node.type === 'FRAME')
        expect(restoredControls).toHaveLength(3)
        expect(
          restored
            .getChildren(restoredRoot.id)
            .filter((node) => node.type === 'TEXT')
            .map((node) => node.fontFamily)
        ).toEqual(['R5 Missing Font', 'R5 Missing Font', 'R5 Missing Font'])
        for (const [index, item] of controls.entries()) {
          const before = graph.getNode(item.id)
          const after = restoredControls[index]
          expect(after.interactiveProps).toEqual(before?.interactiveProps)
          expect(after.cornerRadius).toBe(8)
          expect(after.width).toBeCloseTo(before?.width ?? -1, 3)
          expect(after.height).toBeCloseTo(before?.height ?? -1, 3)
        }
        for (const target of ['react', 'vue'] as const) {
          expect(
            compile({
              graph,
              pageIds: [pageId],
              options: withDefaults({ target, sourceLocale: locale })
            }).warnings
          ).toEqual([])
          expect(
            compile({
              graph: restored,
              pageIds: [restored.getPages()[0].id],
              options: withDefaults({ target, sourceLocale: locale })
            }).warnings
          ).toEqual([])
        }
      })
})
