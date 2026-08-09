import { describe, expect, test } from 'bun:test'

import {
  clearGoogleDriveChangeCursor,
  parseGoogleDriveChangePageToken,
  readGoogleDriveChangeCursor,
  writeGoogleDriveChangeCursor
} from '@/app/integrations/storage/google-drive/change-cursor'

class MemoryStorage implements Storage {
  readonly #values = new Map<string, string>()

  get length(): number {
    return this.#values.size
  }

  clear(): void {
    this.#values.clear()
  }

  getItem(key: string): string | null {
    return this.#values.get(key) ?? null
  }

  key(index: number): string | null {
    return [...this.#values.keys()][index] ?? null
  }

  removeItem(key: string): void {
    this.#values.delete(key)
  }

  setItem(key: string, value: string): void {
    this.#values.set(key, value)
  }
}

const authority = {
  accountId: 'google-subject',
  authorizationVersion: '0123456789abcdef0123456789abcdef'
}

describe('Google Drive change cursor', () => {
  test('round-trips an authorization-scoped cursor and clears it', () => {
    const storage = new MemoryStorage()
    const identity = { profileId: 'default', authority }
    writeGoogleDriveChangeCursor(identity, 'token-1_ABC=', storage)
    expect(readGoogleDriveChangeCursor(identity, storage)).toBe('token-1_ABC=')
    clearGoogleDriveChangeCursor(identity, storage)
    expect(readGoogleDriveChangeCursor(identity, storage)).toBeNull()
  })

  test('does not reuse a cursor after authorization changes', () => {
    const storage = new MemoryStorage()
    writeGoogleDriveChangeCursor({ profileId: 'default', authority }, 'token-one', storage)
    expect(
      readGoogleDriveChangeCursor(
        {
          profileId: 'default',
          authority: { ...authority, authorizationVersion: 'f'.repeat(32) }
        },
        storage
      )
    ).toBeNull()
  })

  test('does not reuse a cursor for another account with the same grant version', () => {
    const storage = new MemoryStorage()
    writeGoogleDriveChangeCursor({ profileId: 'default', authority }, 'token-one', storage)
    expect(
      readGoogleDriveChangeCursor(
        {
          profileId: 'default',
          authority: { ...authority, accountId: 'another/google subject' }
        },
        storage
      )
    ).toBeNull()
  })

  test('removes corrupted storage and rejects unsafe tokens', () => {
    const storage = new MemoryStorage()
    const identity = { profileId: 'default', authority }
    writeGoogleDriveChangeCursor(identity, 'safe-token', storage)
    const key = storage.key(0)
    expect(key).not.toBeNull()
    if (key === null) throw new Error('Expected a stored cursor key')
    storage.setItem(key, 'bad\0token')
    expect(readGoogleDriveChangeCursor(identity, storage)).toBeNull()
    expect(storage.length).toBe(0)
    expect(() => parseGoogleDriveChangePageToken('')).toThrow()
    expect(() => parseGoogleDriveChangePageToken('x'.repeat(4097))).toThrow()
  })
})
