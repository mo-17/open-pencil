import { describe, expect, test } from 'bun:test'

import { deflateSync } from 'fflate'

import {
  decodeFigKiwiCanvas,
  deduplicateNodeChangePluginData,
  parseFigKiwiContainer,
  type NodeChange
} from '../src/fig/parse'
import { encodeBinarySchema, type Schema } from '../src/schema-runtime'

describe('Figma FIG parse helpers', () => {
  test('rejects non fig-kiwi containers', () => {
    expect(parseFigKiwiContainer(new TextEncoder().encode('not-fig-kiwi'))).toBeNull()
  })

  test('deduplicates plugin data entries by full triple', () => {
    const changes: NodeChange[] = [
      {
        pluginData: [
          { pluginID: 'plugin', key: 'a', value: '1' },
          { pluginID: 'plugin', key: 'a', value: '1' },
          { pluginID: 'plugin', key: 'a', value: '2' }
        ],
        pluginRelaunchData: [
          { pluginID: 'plugin', command: 'run', message: 'Run', isDeleted: false },
          { pluginID: 'plugin', command: 'run', message: 'Run', isDeleted: false },
          { pluginID: 'plugin', command: 'run', message: 'Gone', isDeleted: true }
        ]
      }
    ]

    deduplicateNodeChangePluginData(changes)

    expect(changes[0]?.pluginData).toHaveLength(2)
    expect(changes[0]?.pluginRelaunchData).toHaveLength(2)
  })

  test('bounds decompressed fig-kiwi data before allocating the full payload', () => {
    const header = new TextEncoder().encode('fig-kiwi')
    const schema = deflateSync(new Uint8Array([1]))
    const data = deflateSync(new Uint8Array(256))
    const container = new Uint8Array(12 + 4 + schema.byteLength + 4 + data.byteLength)
    container.set(header)
    const view = new DataView(container.buffer)
    view.setUint32(8, 1, true)
    let offset = 12
    view.setUint32(offset, schema.byteLength, true)
    offset += 4
    container.set(schema, offset)
    offset += schema.byteLength
    view.setUint32(offset, data.byteLength, true)
    offset += 4
    container.set(data, offset)

    expect(() => parseFigKiwiContainer(container, { maxDataBytes: 255 })).toThrow(
      'Decompressed fig-kiwi data exceeds the 255 byte limit'
    )
    expect(parseFigKiwiContainer(container, { maxDataBytes: 256 })?.dataRaw.byteLength).toBe(256)
  })

  test('preflights zstd frame content and window sizes before streaming decompression', () => {
    const schema = deflateSync(new Uint8Array([1]))
    const hugeSingleSegment = new Uint8Array([0x28, 0xb5, 0x2f, 0xfd, 0xa0, 0x00, 0x00, 0x00, 0x40])
    expect(() =>
      parseFigKiwiContainer(figKiwiContainer(schema, hugeSingleSegment), {
        maxDataBytes: 1024
      })
    ).toThrow('Zstandard frame content size exceeds the 1024 byte limit')

    const hugeUnknownContentWindow = new Uint8Array([0x28, 0xb5, 0x2f, 0xfd, 0x00, 0xff])
    expect(() =>
      parseFigKiwiContainer(figKiwiContainer(schema, hugeUnknownContentWindow), {
        maxDataBytes: 1024
      })
    ).toThrow('Zstandard frame window size exceeds the 1024 byte limit')

    const truncatedWindow = new Uint8Array([0x28, 0xb5, 0x2f, 0xfd, 0x00])
    expect(() =>
      parseFigKiwiContainer(figKiwiContainer(schema, truncatedWindow), {
        maxDataBytes: 1024
      })
    ).toThrow('contains a truncated Zstandard frame')

    const boundedUnknownContentWindow = new Uint8Array([
      0x28, 0xb5, 0x2f, 0xfd, 0x00, 0x00, 0x19, 0x00, 0x00, 1, 2, 3
    ])
    expect(
      parseFigKiwiContainer(figKiwiContainer(schema, boundedUnknownContentWindow), {
        maxDataBytes: 1024
      })?.dataRaw
    ).toEqual(new Uint8Array([1, 2, 3]))
  })

  test('bounds valid and concatenated zstd frames by declared content size', () => {
    const schema = deflateSync(new Uint8Array([1]))
    const raw = new Uint8Array(256)
    const compressed = Bun.zstdCompressSync(raw)
    const container = figKiwiContainer(schema, compressed)

    expect(() => parseFigKiwiContainer(container, { maxDataBytes: 255 })).toThrow(
      'Zstandard frame content size exceeds the 255 byte limit'
    )
    expect(parseFigKiwiContainer(container, { maxDataBytes: 256 })?.dataRaw).toEqual(raw)

    const frame = Bun.zstdCompressSync(new Uint8Array(600))
    const concatenated = new Uint8Array(frame.byteLength * 2)
    concatenated.set(frame)
    concatenated.set(frame, frame.byteLength)
    expect(() =>
      parseFigKiwiContainer(figKiwiContainer(schema, concatenated), {
        maxDataBytes: 1000
      })
    ).toThrow('declared Zstandard content exceeds the 1000 byte limit')
  })

  test('validates dynamic schemas only on the remote limits path', () => {
    const schema: Schema = {
      package: null,
      definitions: [
        {
          name: 'Message',
          line: 0,
          column: 0,
          kind: 'MESSAGE',
          fields: [messageField('__proto__', 'uint', false, 1)]
        }
      ]
    }
    const container = figKiwiContainer(deflateSync(encodeBinarySchema(schema)), new Uint8Array([0]))

    expect(() => decodeFigKiwiCanvas(container)).toThrow('No nodes found in .fig file')
    expect(() =>
      decodeFigKiwiCanvas(container, {
        maxSchemaBytes: 1024,
        maxDataBytes: 1024,
        maxNodeChanges: 10
      })
    ).toThrow('The field name "__proto__" is unsafe')
  })

  test('applies maxNodeChanges before generated code allocates the array', () => {
    const schema: Schema = {
      package: null,
      definitions: [
        {
          name: 'NodeChange',
          line: 0,
          column: 0,
          kind: 'MESSAGE',
          fields: []
        },
        {
          name: 'Message',
          line: 0,
          column: 0,
          kind: 'MESSAGE',
          fields: [messageField('nodeChanges', 'NodeChange', true, 1)]
        }
      ]
    }
    const container = figKiwiContainer(
      deflateSync(encodeBinarySchema(schema)),
      new Uint8Array([1, 2, 0, 0, 0])
    )

    expect(decodeFigKiwiCanvas(container).nodeChanges).toHaveLength(2)
    expect(() => decodeFigKiwiCanvas(container, { maxNodeChanges: 1 })).toThrow(
      'Kiwi array length limit exceeded (1 per array)'
    )
    expect(() =>
      decodeFigKiwiCanvas(container, {
        maxNodeChanges: 10,
        maxArrayLength: 1,
        maxArrayItems: 10
      })
    ).toThrow('Kiwi array length limit exceeded (1 per array)')
  })
})

function messageField(
  name: string,
  type: string,
  isArray: boolean,
  value: number
): Schema['definitions'][number]['fields'][number] {
  return {
    name,
    line: 0,
    column: 0,
    type,
    isArray,
    isDeprecated: false,
    value
  }
}

function figKiwiContainer(schema: Uint8Array, data: Uint8Array): Uint8Array {
  const container = new Uint8Array(12 + 4 + schema.byteLength + 4 + data.byteLength)
  container.set(new TextEncoder().encode('fig-kiwi'))
  const view = new DataView(container.buffer)
  view.setUint32(8, 1, true)
  let offset = 12
  view.setUint32(offset, schema.byteLength, true)
  offset += 4
  container.set(schema, offset)
  offset += schema.byteLength
  view.setUint32(offset, data.byteLength, true)
  offset += 4
  container.set(data, offset)
  return container
}
