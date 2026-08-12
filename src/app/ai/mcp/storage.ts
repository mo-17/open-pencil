import { StorageSerializers, useLocalStorage } from '@vueuse/core'

const REMOTE_MCP_SETTINGS_KEY = 'open-pencil:ai-mcp-settings'

const storedRemoteMCPSettings = useLocalStorage<unknown>(REMOTE_MCP_SETTINGS_KEY, null, {
  serializer: StorageSerializers.object,
  writeDefaults: false
})

export function readRemoteMCPSettingsStorage(): unknown {
  return storedRemoteMCPSettings.value
}

export function writeRemoteMCPSettingsStorage(value: unknown): void {
  storedRemoteMCPSettings.value = value
}
