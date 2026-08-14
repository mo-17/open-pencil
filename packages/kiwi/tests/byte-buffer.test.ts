import { describe, expect, test } from 'bun:test'

import { ByteBuffer, KIWI_RUNTIME_LIMITS } from '../src/schema-runtime'

describe('Kiwi ByteBuffer read boundaries', () => {
  test('rejects reads at EOF instead of returning undefined-backed values', () => {
    expect(() => new ByteBuffer(new Uint8Array()).readByte()).toThrow(
      'Unexpected end of ByteBuffer while reading byte'
    )
    expect(() => new ByteBuffer(new Uint8Array()).readVarFloat()).toThrow(
      'Unexpected end of ByteBuffer while reading varfloat'
    )
    expect(() => new ByteBuffer(new Uint8Array([1, 2, 3])).readVarFloat()).toThrow(
      'Unexpected end of ByteBuffer while reading varfloat'
    )
  })

  test('rejects byte-array lengths larger than the remaining input', () => {
    expect(() => new ByteBuffer(new Uint8Array([3, 1, 2])).readByteArray()).toThrow(
      'Unexpected end of ByteBuffer while reading byte array'
    )
    expect(() =>
      new ByteBuffer(new Uint8Array([0xff, 0xff, 0xff, 0xff, 0x0f])).readByteArray()
    ).toThrow('Unexpected end of ByteBuffer while reading byte array')

    expect(new ByteBuffer(new Uint8Array([2, 7, 8])).readByteArray()).toEqual(
      new Uint8Array([7, 8])
    )
  })

  test('bounds uint32 varints and rejects truncation', () => {
    expect(() => new ByteBuffer(new Uint8Array([0x80])).readVarUint()).toThrow(
      'Unexpected end of ByteBuffer while reading varuint'
    )
    for (const malformed of [
      [0x80, 0x80, 0x80, 0x80, 0x80],
      [0xff, 0xff, 0xff, 0xff, 0x10]
    ]) {
      expect(() => new ByteBuffer(new Uint8Array(malformed)).readVarUint()).toThrow(
        'Varuint exceeds the 32-bit range'
      )
    }
    expect(new ByteBuffer(new Uint8Array([0xff, 0xff, 0xff, 0xff, 0x0f])).readVarUint()).toBe(
      0xffff_ffff
    )
  })

  test('bounds Kiwi uint64 varints and preserves the nine-byte maximum encoding', () => {
    expect(() => new ByteBuffer(new Uint8Array([0x80])).readVarUint64()).toThrow(
      'Unexpected end of ByteBuffer while reading varuint64'
    )
    expect(() =>
      new ByteBuffer(
        new Uint8Array([0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x80])
      ).readVarUint64()
    ).toThrow('Unexpected end of ByteBuffer while reading varuint64')

    const encoded = new ByteBuffer()
    encoded.writeVarUint64(0xffff_ffff_ffff_ffffn)
    expect(encoded.toUint8Array()).toHaveLength(9)
    expect(new ByteBuffer(encoded.toUint8Array()).readVarUint64()).toBe(0xffff_ffff_ffff_ffffn)
  })

  test('rejects a null-terminated string when the terminator is missing', () => {
    expect(() => new ByteBuffer(new Uint8Array([0x4f, 0x70, 0x65, 0x6e])).readString()).toThrow(
      'Unexpected end of ByteBuffer while reading null-terminated string'
    )
    expect(() => new ByteBuffer().readString()).toThrow(
      'Unexpected end of ByteBuffer while reading null-terminated string'
    )
    expect(new ByteBuffer(new Uint8Array([0x4f, 0x50, 0])).readString()).toBe('OP')
  })

  test('applies array budgets only when the ByteBuffer instance receives limits', () => {
    const encoded = new ByteBuffer()
    encoded.writeVarUint(KIWI_RUNTIME_LIMITS.maxArrayItems + 1)
    expect(new ByteBuffer(encoded.toUint8Array()).readArrayLength()).toBe(
      KIWI_RUNTIME_LIMITS.maxArrayItems + 1
    )
    expect(() =>
      new ByteBuffer(encoded.toUint8Array(), {
        maxArrayItems: KIWI_RUNTIME_LIMITS.maxArrayItems
      }).readArrayLength()
    ).toThrow(`Kiwi array item limit exceeded (${KIWI_RUNTIME_LIMITS.maxArrayItems} per message)`)
  })
})
