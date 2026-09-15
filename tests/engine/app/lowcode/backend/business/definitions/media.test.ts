import { describe, expect, test } from 'bun:test'

import { createEditor } from '@open-pencil/core/editor'
import { parseExpression } from '@open-pencil/lowcode'

import { videoLiveDefinition } from '@/app/lowcode/backend/business/definitions/media'
import { createMediaApplication } from '@/app/lowcode/backend/business/model/media/application'
import { MEDIA_ROLES } from '@/app/lowcode/backend/business/model/media/fields'
import { createBusinessPageContext } from '@/app/lowcode/backend/business/pages/context'
import { prepareBusinessInputs } from '@/app/lowcode/backend/business/pages/forms'
import {
  prepareBusinessModulePages,
  renderBusinessModulePages
} from '@/app/lowcode/backend/business/pages/module'
import { preflightBusinessPages } from '@/app/lowcode/backend/business/pages/preflight'
import { createBusinessScreen } from '@/app/lowcode/backend/business/pages/screen'
import type { BusinessText } from '@/app/lowcode/backend/business/types'

const authentication = {
  kind: 'oidc-pkce' as const,
  issuer: 'https://identity.example.com',
  clientId: 'media-definition-test',
  scopes: ['openid', 'profile'],
  callbackPath: '/_openpencil/auth/callback'
}
const application = () => createMediaApplication('media-definition-test', authentication)

function page(id: string) {
  const found = videoLiveDefinition().pages.find((entry) => entry.id === id)
  if (!found) throw new Error('Missing media page: ' + id)
  return found
}

function action(id: string) {
  const found = videoLiveDefinition()
    .pages.flatMap((entry) => entry.actions)
    .find((entry) => entry.id === id)
  if (!found) throw new Error('Missing media action: ' + id)
  return found
}

function localizedText(value: unknown): BusinessText[] {
  if (Array.isArray(value)) return value.flatMap(localizedText)
  if (!value || typeof value !== 'object') return []
  if (
    'en' in value &&
    'zh' in value &&
    typeof value.en === 'string' &&
    typeof value.zh === 'string'
  ) {
    return [{ en: value.en, zh: value.zh }]
  }
  return Object.values(value).flatMap(localizedText)
}

describe('video and live business page definition', () => {
  test('defines six bilingual business pages with a public entry and separate creator resources', () => {
    const definition = videoLiveDefinition()
    expect(definition.id).toBe('video-live')
    expect(definition.entryPage).toBe('media-videos')
    expect(definition.roles).toEqual(MEDIA_ROLES)
    expect(definition.pages.map((entry) => [entry.id, entry.path])).toEqual([
      ['account', '/account-setup'],
      ['media-videos', '/videos'],
      ['media-channels', '/live'],
      ['media-favorites', '/favorites'],
      ['media-management-videos', '/creator/videos'],
      ['media-management-channels', '/creator/channels']
    ])
    expect(definition.pages.filter((entry) => entry.public).map((entry) => entry.id)).toEqual([
      'media-videos',
      'media-channels'
    ])
    expect(page('media-videos').listing?.resourceId).toBe('media-videos')
    expect(page('media-channels').listing?.resourceId).toBe('media-channels')
    expect(page('media-management-videos').listing?.resourceId).toBe('media-management-videos')
    expect(page('media-management-channels').listing?.resourceId).toBe('media-management-channels')
    for (const text of localizedText(definition)) {
      expect(text.en.trim().length).toBeGreaterThan(0)
      expect(text.zh).toMatch(/[\u3400-\u9fff]/u)
    }
  })

  test('preflights against the real model and exposes every command with exact parameters', () => {
    const model = application()
    const definition = videoLiveDefinition()
    expect(() => preflightBusinessPages(model, definition)).not.toThrow()
    const actions = definition.pages.flatMap((entry) => entry.actions)
    expect(actions).toHaveLength(16)
    expect(actions.map((entry) => entry.commandId).sort()).toEqual(
      (model.commands?.commands ?? []).map((entry) => entry.id).sort()
    )
    expect(page('media-management-videos').related?.[0]).toMatchObject({
      resourceId: 'media-video-history',
      foreignKey: 'video_id'
    })
    expect(page('media-management-channels').related?.[0]).toMatchObject({
      resourceId: 'media-channel-history',
      foreignKey: 'channel_id'
    })
  })

  test('matches state transitions and describes live labels without pretending to start streams', () => {
    const transitions = {
      'update-media-video': ['draft', 'published'],
      'publish-media-video': ['draft'],
      'archive-media-video': ['draft', 'published'],
      'restore-media-video': ['archived'],
      'update-media-channel': ['draft', 'scheduled', 'live', 'ended'],
      'schedule-media-channel': ['draft'],
      'start-media-channel': ['scheduled'],
      'end-media-channel': ['live'],
      'archive-media-channel': ['draft', 'scheduled', 'ended'],
      'restore-media-channel': ['archived']
    }
    for (const [id, values] of Object.entries(transitions))
      expect(action(id).when).toEqual({ field: 'status', values })
    expect(action('start-media-channel').label).toEqual({ en: 'Mark live', zh: '标记开播' })
    expect(action('end-media-channel').label).toEqual({ en: 'Mark ended', zh: '标记结束' })
    expect(action('start-media-channel').description.zh).toContain('仅将记录标记')
    expect(action('end-media-channel').description.en).toContain('does not stop an encoder')
    expect(page('media-channels').description.zh).toContain('不代表直播流可用')
    expect(action('schedule-media-channel').description.en).toContain(
      'does not start a stream automatically'
    )
  })

  test('uses profile relations and preserves API field names when opening creator edit forms', () => {
    for (const kind of ['video', 'channel']) {
      const create = action('create-media-' + kind)
      expect(create.inputs[0]).toMatchObject({
        key: 'userId',
        kind: 'relation',
        relation: { resourceId: 'my-profile', labelField: 'title' }
      })
      const edit = action('update-media-' + kind)
      expect(edit.parameters[kind + 'Id']).toEqual({ kind: 'selection', field: 'id' })
      expect(edit.inputs.find((input) => input.key === 'playbackUrl')).toMatchObject({
        kind: 'text',
        required: false,
        maxLength: 2048,
        fromSelection: 'playback_url'
      })
      expect(edit.inputs.find((input) => input.key === 'posterUrl')).toMatchObject({
        kind: 'text',
        required: false,
        maxLength: 2048,
        fromSelection: 'poster_url'
      })
      expect(edit.inputs.find((input) => input.key === 'description')).toMatchObject({
        kind: 'textarea',
        maxLength: 2000,
        fromSelection: 'description'
      })
      expect(edit.inputs.find((input) => input.key === 'note')?.fromSelection).toBeUndefined()
    }
  })

  test('keeps favorites private, typed and unable to play stale saved URLs', () => {
    const favorites = page('media-favorites')
    expect(favorites.public).toBeUndefined()
    expect(favorites.videoPlayer).toBeUndefined()
    expect(favorites.listing?.columns.some((column) => column.field.endsWith('_url'))).toBe(false)
    expect(favorites.listing?.filter).toMatchObject({
      field: 'active',
      choices: [{ value: true }, { value: false }]
    })
    expect(action('cancel-media-favorite').when).toEqual({ field: 'active', values: [true] })
    expect(action('restore-media-favorite').when).toEqual({ field: 'active', values: [false] })
    expect(action('restore-media-favorite').parameters).toEqual({
      videoId: { kind: 'selection', field: 'video_id' },
      favoriteId: { kind: 'selection', field: 'id' }
    })
    expect(action('create-media-favorite').parameters).toEqual({
      videoId: { kind: 'selection', field: 'id' }
    })
    expect(action('restore-media-favorite').description.zh).toContain('当前仍已发布')
  })

  test('encodes boolean select values as constants in the restricted expression grammar', () => {
    const editor = createEditor()
    const root = editor.graph.getNode(editor.graph.rootId)
    if (!root) throw new Error('Missing test document root')
    const context = createBusinessPageContext(
      editor,
      root,
      application(),
      videoLiveDefinition(),
      'en'
    )
    const screen = createBusinessScreen(context, page('media-favorites'))
    const [input] = prepareBusinessInputs(screen, [
      {
        key: 'active',
        label: { en: 'Saved', zh: '已收藏' },
        kind: 'select',
        choices: [
          { label: { en: 'Saved', zh: '已收藏' }, value: true },
          { label: { en: 'Removed', zh: '已移除' }, value: false }
        ]
      }
    ]).entries
    const parsed = parseExpression(input.valueExpr)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) throw new Error('Invalid generated select expression')
    expect([...parsed.references]).toEqual([input.state.name])
    expect(parsed.ast).toMatchObject({
      kind: 'ternary',
      consequent: { kind: 'unary', op: '!', arg: { kind: 'number', value: 0 } },
      alternate: {
        kind: 'ternary',
        consequent: { kind: 'unary', op: '!', arg: { kind: 'number', value: 1 } },
        alternate: { kind: 'string', value: '' }
      }
    })
  })

  for (const locale of ['en', 'zh-CN']) {
    test(`renders ${locale} pages with four explicit selection-bound players and typed favorite conditions`, () => {
      const editor = createEditor()
      const plan = prepareBusinessModulePages(editor, application(), 'video-live', { locale })
      const result = editor.undo.runBatch('Test media pages', () =>
        renderBusinessModulePages(editor, plan)
      )
      expect(result.pageIds).toHaveLength(7)
      const nodes = [...editor.graph.getAllNodes()]
      const players = nodes.filter((node) => node.interactiveProps?.module?.moduleType === 'video')
      expect(players).toHaveLength(4)
      for (const player of players) {
        expect(player.interactiveProps?.lang).toBe(locale)
        expect(player.interactiveProps?.module?.config).toMatchObject({
          controls: true,
          autoplay: false
        })
        expect(player.bindings?.src).toMatchObject({
          kind: 'expr',
          expr: expect.stringMatching(/SelectedRecord\.playback_url$/u)
        })
        expect(player.bindings?.poster).toMatchObject({
          kind: 'expr',
          expr: expect.stringMatching(/SelectedRecord\.poster_url$/u)
        })
        expect(player.renderCondition).toContain('SelectionReady')
        expect(player.renderCondition).toContain('$currentUser.generation')
      }
      const guards = nodes.map((node) => node.renderCondition ?? '').join('\n')
      expect(guards).toContain('.active === !0')
      expect(guards).toContain('.active === !1')
      const filters = nodes.flatMap((node) => {
        const source = node.interactiveProps?.dataSourceRef
        return source?.kind === 'backendResource' && source.resourceId === 'media-favorites'
          ? (source.filterEntries ?? []).map((entry) => entry.valueExpr)
          : []
      })
      expect(filters).toHaveLength(1)
      for (const expression of [
        ...filters,
        ...nodes.flatMap((node) => node.renderCondition ?? [])
      ]) {
        const parsed = parseExpression(expression)
        expect(parsed.ok).toBe(true)
        if (parsed.ok) {
          expect(parsed.references.has('true')).toBe(false)
          expect(parsed.references.has('false')).toBe(false)
        }
      }
      for (const definition of videoLiveDefinition().pages) {
        expect(
          nodes.some(
            (node) =>
              node.type === 'TEXT' && node.text === definition.title[locale === 'en' ? 'en' : 'zh']
          )
        ).toBe(true)
      }
    })
  }
})
