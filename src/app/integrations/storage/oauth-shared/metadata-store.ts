import { parseBoundedOAuthJSON, stringifyBoundedOAuthJSON } from './validation'

export interface OAuthPublicMetadataRecord {
  readonly profileId: string
}

export interface OAuthMetadataStoreConfig<T extends OAuthPublicMetadataRecord> {
  readonly key: (profileId: string) => string
  readonly maxBytes: number
  readonly parse: (value: unknown) => T
  readonly invalid: () => Error
  readonly unavailableMessage: string
}

/** Shared persistence mechanics; each provider still owns its exact parser, key, and errors. */
export class LocalOAuthMetadataStore<T extends OAuthPublicMetadataRecord> {
  constructor(
    private readonly storage: Storage | null,
    private readonly config: OAuthMetadataStoreConfig<T>
  ) {}

  async read(profileId: string): Promise<T | null> {
    const raw = this.storage?.getItem(this.config.key(profileId))
    if (!raw) return null
    return this.config.parse(parseBoundedOAuthJSON(raw, this.config.maxBytes, this.config.invalid))
  }

  async write(metadata: T): Promise<void> {
    if (!this.storage) throw new Error(this.config.unavailableMessage)
    const parsed = this.config.parse(metadata)
    const serialized = stringifyBoundedOAuthJSON(parsed, this.config.maxBytes, this.config.invalid)
    this.storage.setItem(this.config.key(parsed.profileId), serialized)
  }

  async remove(profileId: string): Promise<void> {
    this.storage?.removeItem(this.config.key(profileId))
  }
}

export class MemoryOAuthMetadataStore<T extends OAuthPublicMetadataRecord> {
  readonly #values = new Map<string, T>()

  constructor(private readonly config: OAuthMetadataStoreConfig<T>) {}

  async read(profileId: string): Promise<T | null> {
    const value = this.#values.get(this.config.key(profileId))
    return value ? this.config.parse(value) : null
  }

  async write(metadata: T): Promise<void> {
    const parsed = this.config.parse(metadata)
    this.#values.set(this.config.key(parsed.profileId), parsed)
  }

  async remove(profileId: string): Promise<void> {
    this.#values.delete(this.config.key(profileId))
  }
}
