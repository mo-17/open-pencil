import { describe, expect, test } from 'bun:test'

import type { ActionDef } from '@open-pencil/scene-graph'

import { BUSINESS_TEMPLATE_IDS } from '@/app/lowcode/backend/business/model/types'

import { businessBrowserFixture } from './browser/helpers'

function actionsIn(actions: readonly ActionDef[]): ActionDef[] {
  return actions.flatMap((action) => [
    action,
    ...('consequent' in action ? actionsIn(action.consequent) : []),
    ...('alternate' in action ? actionsIn(action.alternate ?? []) : []),
    ...('onSuccess' in action ? actionsIn(action.onSuccess ?? []) : []),
    ...('onError' in action ? actionsIn(action.onError ?? []) : [])
  ])
}

describe('business template feedback boundaries', () => {
  for (const target of ['react', 'vue'] as const)
    test.each(BUSINESS_TEMPLATE_IDS)(
      `${target} %s confirms completed commands but keeps inspect, error and cancel silent`,
      async (kind) => {
        const fixture = await businessBrowserFixture(kind, target, [], 'zh-CN')
        const actions = [...fixture.graph.getAllNodes()].flatMap((node) =>
          Object.values(node.events ?? {}).flatMap((chain) => actionsIn(chain ?? []))
        )
        const commands = actions.filter((action) => action.kind === 'backendCommand')
        expect(commands.length).toBeGreaterThan(0)
        for (const action of actions) {
          if (
            action.kind === 'backendCommand' ||
            (action.kind === 'backendCommandRecovery' && action.operation === 'retry')
          ) {
            const notices = actionsIn(action.onSuccess ?? []).filter(
              (entry) => entry.kind === 'toast'
            )
            expect(notices).toHaveLength(1)
            expect(notices[0].messageExpr).toContain('请求已处理，请核对下方结果。')
            expect(notices[0].variant).toBe('success')
            expect(actionsIn(action.onError ?? []).some((entry) => entry.kind === 'toast')).toBe(
              false
            )
          }
          if (action.kind === 'backendCommandRecovery' && action.operation === 'inspect')
            expect(actionsIn(action.onSuccess ?? []).some((entry) => entry.kind === 'toast')).toBe(
              false
            )
          if (action.kind === 'confirm')
            expect(actionsIn(action.alternate ?? []).some((entry) => entry.kind === 'toast')).toBe(
              false
            )
        }
        const sources = [...fixture.output.files.values()]
          .filter((entry) => typeof entry === 'string')
          .join('\n')
        expect(sources).toContain('请求已处理，请核对下方结果。')
        expect(sources).toContain('ToastHost')
        expect(fixture.output.warnings).toHaveLength(0)
      }
    )
})
