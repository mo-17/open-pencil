import { describe, expect, test } from 'bun:test'

import {
  commitTauriSourceExportTemporaryFile,
  writeTauriPluginFileAtomically,
  type TauriSourceExportAtomicWriteDependencies,
  type TauriSourceExportCommitInvoker
} from '@/app/plugins/host/source-exporter-runtime'

const UUID = '550e8400-e29b-41d4-a716-446655440000'
const TARGET = '/exports/project.zip'
const TEMPORARY = `${TARGET}.openpencil-${UUID}.tmp`

describe('Tauri source export atomic commit', () => {
  test('invokes the host-owned commit command with both exact paths', async () => {
    const calls: Array<{ command: string; args: unknown }> = []
    const invoke: TauriSourceExportCommitInvoker = async <T>(command, args) => {
      calls.push({ command, args })
      return undefined as T
    }

    await commitTauriSourceExportTemporaryFile(TEMPORARY, TARGET, invoke)

    expect(calls).toEqual([
      {
        command: 'commit_source_export_file',
        args: { temporaryPath: TEMPORARY, targetPath: TARGET }
      }
    ])
  })

  test('stages bytes before committing and does not use renderer-owned rename', async () => {
    const bytes = new Uint8Array([1, 2, 3, 4])
    const events: string[] = []
    const dependencies: TauriSourceExportAtomicWriteDependencies = {
      randomUUID: () => UUID,
      async writeFile(path, writtenBytes) {
        events.push(`write:${path}`)
        expect(writtenBytes).toBe(bytes)
      },
      async commit(temporaryPath, targetPath) {
        events.push(`commit:${temporaryPath}:${targetPath}`)
      },
      async remove(path) {
        events.push(`remove:${path}`)
      }
    }

    await writeTauriPluginFileAtomically(TARGET, bytes, undefined, dependencies)

    expect(events).toEqual([`write:${TEMPORARY}`, `commit:${TEMPORARY}:${TARGET}`])
  })

  test('cleans only the staging file when the host rejects the commit', async () => {
    const failure = new Error('native replace failed')
    const removed: string[] = []
    const dependencies: TauriSourceExportAtomicWriteDependencies = {
      randomUUID: () => UUID,
      async writeFile() {
        return undefined
      },
      async commit() {
        throw failure
      },
      async remove(path) {
        removed.push(path)
      }
    }

    await expect(
      writeTauriPluginFileAtomically(TARGET, new Uint8Array([9]), undefined, dependencies)
    ).rejects.toBe(failure)

    expect(removed).toEqual([TEMPORARY])
  })

  test('cancellation after staging prevents commit and removes the staging file', async () => {
    const controller = new AbortController()
    let commits = 0
    const removed: string[] = []
    const dependencies: TauriSourceExportAtomicWriteDependencies = {
      randomUUID: () => UUID,
      async writeFile() {
        controller.abort()
      },
      async commit() {
        commits += 1
      },
      async remove(path) {
        removed.push(path)
      }
    }

    await expect(
      writeTauriPluginFileAtomically(TARGET, new Uint8Array([9]), controller.signal, dependencies)
    ).rejects.toMatchObject({ name: 'AbortError' })

    expect(commits).toBe(0)
    expect(removed).toEqual([TEMPORARY])
  })
})
