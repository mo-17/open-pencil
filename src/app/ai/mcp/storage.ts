import { StorageSerializers, useLocalStorage } from '@vueuse/core'

const REMOTE_MCP_SETTINGS_KEY = 'open-pencil:ai-mcp-settings'

const storedRemoteMcpSettings = useLocalStorage<unknown>(REMOTE_MCP_SETTINGS_KEY, null, {
  serializer: StorageSerializers.object,
  writeDefaults: false
})

export function readRemoteMcpSettingsStorage(): unknown {
  return storedRemoteMcpSettings.value
}

export function writeRemoteMcpSettingsStorage(value: unknown): void {
  storedRemoteMcpSettings.value = value
}
