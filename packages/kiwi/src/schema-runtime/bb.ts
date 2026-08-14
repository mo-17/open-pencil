import { normalizeKiwiRuntimeLimits, type KiwiRuntimeLimits } from './limits'

let int32 = new Int32Array(1)
let float32 = new Float32Array(int32.buffer)
const textDecoder = new TextDecoder()

export class ByteBuffer {
  private _data: Uint8Array
  private _index: number
  private _limits: Readonly<KiwiRuntimeLimits> | undefined
  private _arrayItems: number
  private _decodeDepth: number
  length: number

  constructor(data?: Uint8Array, limits?: KiwiRuntimeLimits) {
    if (data && !(data instanceof Uint8Array)) {
      throw new Error('Must initialize a ByteBuffer with a Uint8Array')
    }
    this._data = data || new Uint8Array(256)
    this._index = 0
    this._limits = normalizeKiwiRuntimeLimits(limits)
    this._arrayItems = 0
    this._decodeDepth = 0
    this.length = data ? data.length : 0
  }

  /**
   * Returns a view into the internal buffer, not a copy.
   *
   * Consumers transferring this Uint8Array across thread boundaries (e.g. via
   * postMessage with transferables) MUST copy first: `new Uint8Array(buffer)`.
   * Otherwise, if multiple Uint8Arrays share the same underlying ArrayBuffer and
   * one is transferred, all views into that buffer become detached.
   */
  toUint8Array(): Uint8Array {
    return this._data.subarray(0, this.length)
  }

  readByte(): number {
    this._requireReadable(1, 'byte')
    return this._data[this._index++]
  }

  readByteArray(): Uint8Array {
    const length = this.readVarUint()
    const start = this._index
    this._requireReadable(length, 'byte array')
    this._index = start + length
    return this._data.slice(start, start + length)
  }

  readArrayLength(): number {
    const length = this.readVarUint()
    const maximum = this._limits?.maxArrayItems
    if (maximum !== undefined) {
      if (length > maximum - this._arrayItems) {
        throw new Error(`Kiwi array item limit exceeded (${maximum} per message)`)
      }
      this._arrayItems += length
    }
    return length
  }

  enterDecode(): void {
    const maximum = this._limits?.maxDecodeDepth
    if (maximum === undefined) return
    if (this._decodeDepth >= maximum) {
      throw new Error(`Kiwi decode nesting limit exceeded (${maximum})`)
    }
    this._decodeDepth += 1
  }

  leaveDecode(): void {
    if (this._limits?.maxDecodeDepth !== undefined && this._decodeDepth > 0) {
      this._decodeDepth -= 1
    }
  }

  readVarFloat(): number {
    const index = this._index
    const data = this._data
    this._requireReadable(1, 'varfloat')
    const first = data[index]
    if (first === 0) {
      this._index = index + 1
      return 0
    }

    this._requireReadable(4, 'varfloat')
    let bits = first | (data[index + 1] << 8) | (data[index + 2] << 16) | (data[index + 3] << 24)
    this._index = index + 4
    bits = (bits << 23) | (bits >>> 9)
    int32[0] = bits
    return float32[0]
  }

  readVarUint(): number {
    const data = this._data
    let index = this._index
    let value = 0

    for (let byteIndex = 0; byteIndex < 5; byteIndex++) {
      if (index >= this.length) {
        throw new Error('Unexpected end of ByteBuffer while reading varuint')
      }
      const byte = data[index++]
      if (byteIndex === 4 && (byte & 0xf0) !== 0) {
        throw new Error('Varuint exceeds the 32-bit range')
      }
      value += (byte & 0x7f) * 2 ** (byteIndex * 7)
      if ((byte & 0x80) === 0) {
        this._index = index
        return value >>> 0
      }
    }

    throw new Error('Varuint exceeds the 32-bit range')
  }

  readVarInt(): number {
    let value = this.readVarUint() | 0
    return value & 1 ? ~(value >>> 1) : value >>> 1
  }

  readVarUint64(): bigint {
    const data = this._data
    let index = this._index
    let value = 0n
    let shift = 0n

    // Kiwi's uint64 wire format uses up to eight 7-bit continuation bytes,
    // followed by one final byte containing all remaining eight bits.
    for (let byteIndex = 0; byteIndex < 8; byteIndex++) {
      if (index >= this.length) {
        throw new Error('Unexpected end of ByteBuffer while reading varuint64')
      }
      const byte = data[index++]
      if ((byte & 0x80) === 0) {
        this._index = index
        return value | (BigInt(byte) << shift)
      }
      value |= BigInt(byte & 0x7f) << shift
      shift += 7n
    }

    if (index >= this.length) {
      throw new Error('Unexpected end of ByteBuffer while reading varuint64')
    }
    value |= BigInt(data[index++]) << 56n
    this._index = index
    return value
  }

  readVarInt64(): bigint {
    let value = this.readVarUint64()
    let one = BigInt(1)
    let sign = value & one
    value >>= one
    return sign ? ~value : value
  }

  readString(): string {
    const data = this._data
    const start = this._index
    const end = data.indexOf(0, start)
    if (end === -1 || end >= this.length) {
      throw new Error('Unexpected end of ByteBuffer while reading null-terminated string')
    }
    this._index = end + 1
    return textDecoder.decode(data.subarray(start, end))
  }

  private _requireReadable(amount: number, label: string): void {
    if (!Number.isSafeInteger(amount) || amount < 0 || amount > this.length - this._index) {
      throw new Error(`Unexpected end of ByteBuffer while reading ${label}`)
    }
  }

  private _growBy(amount: number): void {
    if (this.length + amount > this._data.length) {
      let data = new Uint8Array((this.length + amount) << 1)
      data.set(this._data)
      this._data = data
    }
    this.length += amount
  }

  writeByte(value: number): void {
    let index = this.length
    this._growBy(1)
    this._data[index] = value
  }

  writeByteArray(value: Uint8Array): void {
    this.writeVarUint(value.length)
    let index = this.length
    this._growBy(value.length)
    this._data.set(value, index)
  }

  writeVarFloat(value: number): void {
    let index = this.length

    // Reinterpret as an integer
    float32[0] = value
    let bits = int32[0]

    // Move the exponent to the first 8 bits
    bits = (bits >>> 23) | (bits << 9)

    // Optimization: use a single byte to store zero and denormals (check for an exponent of 0)
    if ((bits & 255) === 0) {
      this.writeByte(0)
      return
    }

    // Endian-independent 32-bit write
    this._growBy(4)
    let data = this._data
    data[index] = bits
    data[index + 1] = bits >> 8
    data[index + 2] = bits >> 16
    data[index + 3] = bits >> 24
  }

  writeVarUint(value: number): void {
    if (value < 0 || value > 0xffff_ffff) throw new Error('Outside uint range: ' + value)
    do {
      let byte = value & 127
      value >>>= 7
      this.writeByte(value ? byte | 128 : byte)
    } while (value)
  }

  writeVarInt(value: number): void {
    if (value < -0x8000_0000 || value > 0x7fff_ffff) throw new Error('Outside int range: ' + value)
    this.writeVarUint(((value << 1) ^ (value >> 31)) >>> 0)
  }

  writeVarUint64(value: bigint | string): void {
    if (typeof value === 'string') value = BigInt(value)
    else if (typeof value !== 'bigint')
      throw new Error(`Expected bigint but got ${typeof value}: ${String(value)}`)
    if (value < 0 || value > BigInt('0xFFFFFFFFFFFFFFFF'))
      throw new Error('Outside uint64 range: ' + value)
    let mask = BigInt(127)
    let seven = BigInt(7)
    for (let i = 0; value > mask && i < 8; i++) {
      this.writeByte(Number(value & mask) | 128)
      value >>= seven
    }
    this.writeByte(Number(value))
  }

  writeVarInt64(value: bigint | string): void {
    if (typeof value === 'string') value = BigInt(value)
    else if (typeof value !== 'bigint')
      throw new Error(`Expected bigint but got ${typeof value}: ${String(value)}`)
    if (value < -BigInt('0x8000000000000000') || value > BigInt('0x7FFFFFFFFFFFFFFF'))
      throw new Error('Outside int64 range: ' + value)
    let one = BigInt(1)
    this.writeVarUint64(value < 0 ? ~(value << one) : value << one)
  }

  writeString(value: string): void {
    let codePoint

    for (let i = 0; i < value.length; i++) {
      // Decode UTF-16
      let a = value.charCodeAt(i)
      if (i + 1 === value.length || a < 0xd800 || a >= 0xdc00) {
        codePoint = a
      } else {
        let b = value.charCodeAt(++i)
        codePoint = (a << 10) + b + (0x10000 - (0xd800 << 10) - 0xdc00)
      }

      // Strings are null-terminated
      if (codePoint === 0) {
        throw new Error('Cannot encode a string containing the null character')
      }

      // Encode UTF-8
      if (codePoint < 0x80) {
        this.writeByte(codePoint)
      } else {
        if (codePoint < 0x800) {
          this.writeByte(((codePoint >> 6) & 0x1f) | 0xc0)
        } else {
          if (codePoint < 0x10000) {
            this.writeByte(((codePoint >> 12) & 0x0f) | 0xe0)
          } else {
            this.writeByte(((codePoint >> 18) & 0x07) | 0xf0)
            this.writeByte(((codePoint >> 12) & 0x3f) | 0x80)
          }
          this.writeByte(((codePoint >> 6) & 0x3f) | 0x80)
        }
        this.writeByte((codePoint & 0x3f) | 0x80)
      }
    }

    // Strings are null-terminated
    this.writeByte(0)
  }
}
