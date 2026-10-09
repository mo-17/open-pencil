import { expect, test } from 'bun:test'

import { devAutomationRoute } from '@/app/automation/bridge/portless-route'

test('HTTP Portless routes preserve the protocol and isolated worktree hostname', () => {
  const route = devAutomationRoute('http://review.open-pencil.localhost:1355', 7600)
  expect(route).toEqual({
    browserURL: 'ws://review.mcp.open-pencil.localhost:1355',
    corsOrigin: 'http://review.open-pencil.localhost:1355',
    portlessServiceName: 'mcp.open-pencil',
    runtimeId: 'review.mcp.open-pencil.localhost'
  })
})
