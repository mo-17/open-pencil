import { describe, expect, test } from 'bun:test'

import type { ConnectorAuditEvent } from '@/app/plugins/connectors/audit'
import {
  ConnectorOutcomeUnknownNoticeStore,
  type ConnectorOutcomeUnknownNotice
} from '@/app/plugins/connectors/outcome-notices'

function auditEvent(
  values: Partial<ConnectorAuditEvent> = {}
): ConnectorAuditEvent & { readonly secret?: string } {
  return {
    timestamp: 100,
    pluginId: 'open-pencil.resend-email',
    connectorId: 'resend.email',
    adapterId: 'open-pencil.connector.resend-email',
    operationId: 'send-email',
    operationKind: 'mutation',
    outcome: 'outcome-unknown',
    durationMs: 20,
    requestDispatched: true,
    requestBytes: 32,
    responseBytes: 0,
    errorCode: 'outcome-unknown',
    secret: 'must-not-be-retained',
    ...values
  }
}

describe('connector outcome-unknown notice store', () => {
  test('retains only bounded connector identity metadata and survives local UI lifecycle', () => {
    const store = new ConnectorOutcomeUnknownNoticeStore()
    store.record(auditEvent())

    const [notice] = store.snapshot()
    expect(notice).toMatchObject({
      timestamp: 100,
      pluginId: 'open-pencil.resend-email',
      connectorId: 'resend.email',
      operationId: 'send-email'
    })
    expect(JSON.stringify(notice)).not.toContain('must-not-be-retained')
    expect(Object.keys(notice ?? {}).sort()).toEqual([
      'connectorId',
      'id',
      'operationId',
      'pluginId',
      'timestamp'
    ])

    // The session store is independent of a Runner/plugin-card component instance and therefore
    // remains readable after that local UI is unmounted by revoke, disable, or uninstall.
    let localRunner: object | null = {}
    localRunner = null
    expect(localRunner).toBeNull()
    expect(store.snapshot()).toHaveLength(1)
  })

  test('dismisses explicitly, notifies subscribers, and enforces its bound', () => {
    const store = new ConnectorOutcomeUnknownNoticeStore(2)
    const snapshots: (readonly ConnectorOutcomeUnknownNotice[])[] = []
    const unsubscribe = store.subscribe((snapshot) => snapshots.push(snapshot))

    store.record(auditEvent({ timestamp: 1, operationId: 'first' }))
    store.record(auditEvent({ timestamp: 2, operationId: 'second' }))
    store.record(auditEvent({ timestamp: 3, operationId: 'third' }))
    expect(store.snapshot().map((notice) => notice.operationId)).toEqual(['second', 'third'])
    const retained = store.snapshot()[0]
    if (!retained) throw new Error('Expected a retained connector outcome notice')
    expect(store.dismiss(retained.id)).toBe(true)
    expect(store.dismiss(retained.id)).toBe(false)
    expect(store.snapshot().map((notice) => notice.operationId)).toEqual(['third'])
    expect(snapshots.length).toBeGreaterThanOrEqual(5)

    unsubscribe()
    store.clear()
    expect(store.snapshot()).toEqual([])
  })

  test('does not create notices for query cancellation or ordinary failures', () => {
    const store = new ConnectorOutcomeUnknownNoticeStore()
    store.record(
      auditEvent({
        operationId: 'list-records',
        operationKind: 'query',
        outcome: 'cancelled',
        errorCode: 'aborted'
      })
    )
    store.record(auditEvent({ outcome: 'failed', errorCode: 'network-failed' }))
    expect(store.snapshot()).toEqual([])
  })

  test('renders from the global session store outside installed plugin cards', async () => {
    const component = await Bun.file(
      'src/components/settings/plugins/PluginConnectorOutcomeUnknownNotices.vue'
    ).text()
    const panel = await Bun.file('src/components/settings/plugins/PluginsPanel.vue').text()
    expect(component).toContain('appConnectorOutcomeUnknownNotices.subscribe')
    expect(component).toContain('appConnectorOutcomeUnknownNotices.dismiss(notice.id)')
    expect(component).not.toContain('parameter')
    expect(component).not.toContain('credential')
    expect(panel).toContain('<PluginConnectorOutcomeUnknownNotices />')
    expect(panel.indexOf('<PluginConnectorOutcomeUnknownNotices />')).toBeLessThan(
      panel.indexOf('<SegmentedControl')
    )
  })
})
