import type { ActionDef } from '@open-pencil/scene-graph'

import type { BusinessPageDefinition } from '@/app/lowcode/backend/business/types'

import type { BusinessPageContext } from '../context'
import { BUSINESS_CONTENT_WIDTH, BUSINESS_CONTENT_X } from '../layout'
import { businessMarkerData } from '../markers'
import { businessButton, businessSurface, businessText } from './style'

export const BUSINESS_PRESENTATION_CONTENT_Y = 232

/** Page navigation uses the caller's original cleanup actions and append-only module markers. */
export function createBusinessPresentationShell(
  ctx: BusinessPageContext,
  page: string,
  definition: BusinessPageDefinition
) {
  const { layout, presentation: profile } = ctx
  const { colors } = profile
  const sidebar = layout.shape(
    'FRAME',
    'Business sidebar',
    page,
    0,
    0,
    248,
    1000,
    businessSurface(profile, { radius: 0, stroke: colors.border })
  )
  const mark = layout.shape(
    'FRAME',
    'Workspace mark',
    sidebar,
    24,
    28,
    68,
    36,
    businessSurface(profile, { fill: colors.primary, radius: 9 })
  )
  layout.text(
    mark,
    profile.mark,
    { x: 0, y: 10, width: 68, height: 18 },
    {
      ...businessText(profile, { color: colors.surface, size: 11, weight: 700 }),
      textAlignHorizontal: 'CENTER'
    }
  )
  layout.text(
    sidebar,
    ctx.label(ctx.definition.title),
    { x: 24, y: 84, width: 200, height: 64 },
    businessText(profile, { size: 20, weight: 600 })
  )
  layout.text(
    sidebar,
    ctx.label({ en: 'YOUR WORKSPACE', zh: '我的工作空间' }),
    { x: 24, y: 155, width: 200, height: 22 },
    businessText(profile, { color: colors.muted, size: 11, weight: 500 })
  )
  const eyebrow = layout.text(
    page,
    ctx.label(profile.eyebrow),
    { x: BUSINESS_CONTENT_X, y: 28, width: 670, height: 24 },
    businessText(profile, { color: colors.primary, size: 11, weight: 600 })
  )
  layout.text(
    page,
    ctx.label(definition.title),
    { x: BUSINESS_CONTENT_X, y: 64, width: BUSINESS_CONTENT_WIDTH, height: 42 },
    businessText(profile, { size: profile.mode === 'editorial' ? 32 : 30, weight: 600 })
  )
  layout.text(
    page,
    ctx.label(definition.description),
    { x: BUSINESS_CONTENT_X, y: 120, width: BUSINESS_CONTENT_WIDTH, height: 84 },
    businessText(profile, { color: colors.muted, size: 13 })
  )
  layout.shape(
    'FRAME',
    'Page heading divider',
    page,
    BUSINESS_CONTENT_X,
    214,
    BUSINESS_CONTENT_WIDTH,
    1,
    businessSurface(profile, { fill: colors.border, radius: 0 })
  )

  const navigation = (leave: (path: string) => ActionDef[]): number => {
    const container = layout.shape('FRAME', 'Business navigation', sidebar, 16, 198, 216, 600, {
      ...businessSurface(profile, { radius: 0 }),
      pluginData: businessMarkerData({
        version: 1,
        role: 'navigation',
        applicationId: ctx.application.applicationId,
        knownKeys: ctx.navigation.map((entry) => entry.key)
      })
    })
    const visited = new Set<string>()
    const groups = profile.groups.map((group) => ({
      title: group.title,
      entries: group.pageIds.flatMap((id) => {
        const entry = ctx.navigation.find((candidate) => candidate.path === ctx.paths[id])
        if (!entry || visited.has(entry.path)) return []
        visited.add(entry.path)
        return [entry]
      })
    }))
    groups.push({
      title: { en: 'ACCOUNT & OTHER MODULES', zh: '账号与更多模块' },
      entries: ctx.navigation.filter((entry) => !visited.has(entry.path))
    })
    let y = 0
    for (const group of groups) {
      if (!group.entries.length) continue
      layout.text(
        container,
        ctx.label(group.title),
        { x: 12, y, width: 192, height: 24 },
        businessText(profile, { color: colors.muted, size: 10, weight: 600 })
      )
      y += 32
      for (const entry of group.entries) {
        layout.button(
          container,
          ctx.label(entry.label),
          { x: 0, y, width: 216, height: 44 },
          leave(entry.path),
          businessButton(profile, entry.path === ctx.paths[definition.id] ? 'active' : 'quiet')
        )
        y += 52
      }
      y += 24
    }
    ctx.editor.updateNodeWithUndo(
      container,
      { height: Math.max(0, y - 24) },
      'Size business navigation'
    )
    return 198 + y
  }
  const finish = (height: number) =>
    ctx.editor.updateNodeWithUndo(sidebar, { height }, 'Size business sidebar')
  return { navigation, finish, sidebar, eyebrow }
}
