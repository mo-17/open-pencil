export interface AppPluginStateStorage {
  list(): Promise<unknown[]>
  put(record: unknown): Promise<void>
  delete(pluginId: string): Promise<void>
}
