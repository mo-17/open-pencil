export type ConnectorSnapshotListener<T> = (snapshot: T) => void

/** Process-local bounded listeners whose failures cannot block the remaining observers. */
export class ConnectorSnapshotListenerRegistry<T> {
  readonly #listeners = new Set<ConnectorSnapshotListener<T>>()

  constructor(
    private readonly maximumListeners: number,
    private readonly capacityErrorMessage: string
  ) {}

  subscribe(listener: ConnectorSnapshotListener<T>): () => void {
    if (!this.#listeners.has(listener) && this.#listeners.size >= this.maximumListeners) {
      throw new Error(this.capacityErrorMessage)
    }
    this.#listeners.add(listener)
    return () => {
      this.#listeners.delete(listener)
    }
  }

  emit(snapshot: T): void {
    for (const listener of this.#listeners) {
      try {
        listener(snapshot)
      } catch (cause) {
        void cause
      }
    }
  }
}
