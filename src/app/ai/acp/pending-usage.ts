import type { SessionUpdate } from '@agentclientprotocol/sdk'

type ACPUsageUpdate = Extract<SessionUpdate, { sessionUpdate: 'usage_update' }>

interface PendingACPUsage {
  sessionId: string
  update: ACPUsageUpdate
  receivedAt: number
}

/** Some agents send usage before the new/resumed session response establishes its identity. */
export function createPendingACPUsage() {
  let latest: PendingACPUsage | null = null
  return {
    record(sessionId: string, update: ACPUsageUpdate, receivedAt = Date.now()): void {
      latest = { sessionId, update, receivedAt }
    },
    take(sessionId: string): PendingACPUsage | null {
      const result = latest?.sessionId === sessionId ? latest : null
      latest = null
      return result
    },
    clear(): void {
      latest = null
    }
  }
}
