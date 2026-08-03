import type { AISessionStorageBackend } from '@/app/ai/sessions/types'

type StoredKeyRecord = {
  aliasKey?: unknown
  sessionKey?: unknown
}

function storedKeyRecord(value: unknown): value is StoredKeyRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** In-memory backend for tests and runtimes where IndexedDB is unavailable. */
export function createMemoryAISessionBackend(): AISessionStorageBackend {
  const aliases = new Map<string, unknown>()
  const sessions = new Map<string, unknown>()

  return {
    async resolveAlias(candidate) {
      const existing = aliases.get(candidate.aliasKey)
      if (existing !== undefined) return structuredClone(existing)
      aliases.set(candidate.aliasKey, structuredClone(candidate))
      return structuredClone(candidate)
    },
    async getAlias(aliasKey) {
      const value = aliases.get(aliasKey)
      return value === undefined ? null : structuredClone(value)
    },
    async putAlias(record) {
      if (!storedKeyRecord(record) || typeof record.aliasKey !== 'string') {
        throw new TypeError('Stored AI document alias is missing aliasKey.')
      }
      aliases.set(record.aliasKey, structuredClone(record))
    },
    async deleteAlias(aliasKey) {
      aliases.delete(aliasKey)
    },
    async listAliases() {
      return [...aliases.values()].map((value) => structuredClone(value))
    },
    async getSession(sessionKey) {
      const value = sessions.get(sessionKey)
      return value === undefined ? null : structuredClone(value)
    },
    async putSession(record) {
      if (!storedKeyRecord(record) || typeof record.sessionKey !== 'string') {
        throw new TypeError('Stored ACP session is missing sessionKey.')
      }
      sessions.set(record.sessionKey, structuredClone(record))
    },
    async deleteSession(sessionKey) {
      sessions.delete(sessionKey)
    },
    async listSessions() {
      return [...sessions.values()].map((value) => structuredClone(value))
    },
    async deleteSessions(sessionKeys) {
      for (const key of sessionKeys) sessions.delete(key)
    }
  }
}
