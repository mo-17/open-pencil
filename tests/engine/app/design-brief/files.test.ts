import { describe, expect, test, vi } from 'bun:test'

import { saveDesignBrief } from '@/app/design-brief/files'
import { saveExportedFile } from '@/app/document/export/files'
import * as capability from '@/app/document/io/capability'

async function withWindow<T>(browser: object, action: () => Promise<T>): Promise<T> {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'window')
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    writable: true,
    value: browser
  })
  const picker = Reflect.get(browser, 'showSaveFilePicker')
  const supports = vi
    .spyOn(capability, 'supportsFileSystemAccess')
    .mockImplementation(() => typeof picker === 'function')
  const pick = vi.spyOn(capability, 'pickBrowserSaveFile').mockImplementation(async (options) => {
    if (typeof picker !== 'function') return null
    return picker(options)
  })
  try {
    return await action()
  } finally {
    supports.mockRestore()
    pick.mockRestore()
    if (previous) Object.defineProperty(globalThis, 'window', previous)
    else Reflect.deleteProperty(globalThis, 'window')
  }
}

describe('design brief file delivery', () => {
  test('writes the reviewed UTF-8 bytes before reporting a successful save', async () => {
    const markdown = '# Design brief\n\n作者补充'
    const writes: Uint8Array[] = []
    let closed = false
    await withWindow(
      {
        showSaveFilePicker: async () => ({
          createWritable: async () => ({
            write: async (bytes: Uint8Array) => {
              writes.push(bytes)
            },
            close: async () => {
              closed = true
            }
          })
        })
      },
      async () => {
        expect(await saveDesignBrief(markdown)).toBe(true)
        expect(closed).toBe(true)
        expect(writes).toHaveLength(1)
        expect(new TextDecoder().decode(writes[0])).toBe(markdown)
      }
    )
  })

  for (const failingStage of ['picker', 'create', 'write', 'close'] as const) {
    test(`surfaces a ${failingStage} failure and allows a subsequent retry`, async () => {
      const failure = new Error('Chosen destination unavailable')
      let failing = true
      const failAt = (stage: typeof failingStage) => {
        if (failing && failingStage === stage) throw failure
      }
      await withWindow(
        {
          showSaveFilePicker: async () => {
            failAt('picker')
            return {
              createWritable: async () => {
                failAt('create')
                return {
                  write: async () => {
                    failAt('write')
                  },
                  close: async () => {
                    failAt('close')
                  }
                }
              }
            }
          }
        },
        async () => {
          // This must be the original filesystem error, not an attempted DOM download.
          await expect(saveDesignBrief('# Reviewed brief')).rejects.toBe(failure)
          failing = false
          expect(await saveDesignBrief('# Reviewed brief')).toBe(true)
        }
      )
    })
  }

  test('cancelling the picker is not an error or a completed save', async () => {
    await withWindow(
      {
        showSaveFilePicker: async () => {
          throw new DOMException('Cancelled', 'AbortError')
        }
      },
      async () => {
        expect(await saveDesignBrief('# Brief')).toBe(false)
      }
    )
  })

  test('strict mode keeps the download path when the browser has no file picker', async () => {
    const downloads: string[] = []
    await withWindow({}, async () => {
      const saved = await saveExportedFile(
        new TextEncoder().encode('# Brief'),
        'brief.md',
        'Markdown',
        '.md',
        'text/markdown',
        (bytes, fileName, mime) => {
          downloads.push(`${fileName}:${mime}:${new TextDecoder().decode(bytes)}`)
        },
        { browserPickerFailure: 'throw' }
      )
      expect(saved).toBe(true)
      expect(downloads).toEqual(['brief.md:text/markdown:# Brief'])
    })
  })

  test('other existing exports keep their default download fallback', async () => {
    let downloads = 0
    await withWindow(
      {
        showSaveFilePicker: async () => {
          throw new Error('Picker unavailable')
        }
      },
      async () => {
        expect(
          await saveExportedFile(
            new Uint8Array([1]),
            'file.bin',
            'Binary',
            '.bin',
            'application/octet-stream',
            () => {
              downloads++
            }
          )
        ).toBe(true)
        expect(downloads).toBe(1)
      }
    )
  })
})
