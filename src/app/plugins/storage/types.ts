export interface AppPluginStateStorage {
  revision(): Promise<number>
  list(): Promise<unknown[]>
  put(record: unknown): Promise<void>
  delete(pluginId: string): Promise<void>
}
