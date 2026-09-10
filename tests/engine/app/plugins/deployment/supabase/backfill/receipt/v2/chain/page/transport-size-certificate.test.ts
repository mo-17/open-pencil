import { describe, expect, test } from 'bun:test'

import {
  SUPABASE_BACKFILL_RECEIPT_V2_CHAIN_TRANSPORT_SIZE_CERTIFICATE_V1,
  SupabaseBackfillReceiptV2ChainTransportSizeError,
  certifySupabaseBackfillReceiptV2ChainDecodedAggregateSizeV1,
  certifySupabaseBackfillReceiptV2ChainResponseSizeV1,
  createSupabaseBackfillReceiptV2ChainRequestSizeCertificateV1,
  parseSupabaseBackfillReceiptV2ChainBoundedResponseJSONV1,
  verifySupabaseBackfillReceiptV2ChainRequestSizeCertificateV1,
  verifySupabaseBackfillReceiptV2ChainTransportSizeCertificateV1,
  type SupabaseBackfillReceiptV2ChainTransportSizeErrorCode
} from '@/app/plugins/host/deployment/supabase/backfill/receipt/v2/chain/page/transport-size-certificate'

const LIMITS = SUPABASE_BACKFILL_RECEIPT_V2_CHAIN_TRANSPORT_SIZE_CERTIFICATE_V1

function emptyParameters(): string[] {
  return Array.from({ length: LIMITS.parameterCount }, () => '')
}

function allocateASCIIBytes(byteLength: number, character = 'a'): string[] {
  const values = emptyParameters()
  let remaining = byteLength
  for (let index = 0; index < values.length && remaining > 0; index += 1) {
    const count = Math.min(remaining, LIMITS.maximumParameterStringBytes)
    values[index] = character.repeat(count)
    remaining -= count
  }
  if (remaining !== 0) throw new Error('Test payload exceeds the certified parameter vector.')
  return values
}

function appendASCIIByte(values: readonly string[], character = 'a'): string[] {
  const copy = [...values]
  const index = copy.findIndex(
    (value) => new TextEncoder().encode(value).byteLength < LIMITS.maximumParameterStringBytes
  )
  if (index === -1) throw new Error('Test parameter vector has no remaining byte.')
  copy[index] += character
  return copy
}

function expectTransportSizeError(
  operation: () => unknown,
  expected: SupabaseBackfillReceiptV2ChainTransportSizeErrorCode
): void {
  try {
    operation()
  } catch (cause) {
    expect(cause).toBeInstanceOf(SupabaseBackfillReceiptV2ChainTransportSizeError)
    expect((cause as SupabaseBackfillReceiptV2ChainTransportSizeError).code).toBe(expected)
    return
  }
  throw new TypeError(`Expected transport-size error ${expected}`)
}

async function expectAsyncTransportSizeError(
  operation: Promise<unknown>,
  expected: SupabaseBackfillReceiptV2ChainTransportSizeErrorCode
): Promise<void> {
  try {
    await operation
  } catch (cause) {
    expect(cause).toBeInstanceOf(SupabaseBackfillReceiptV2ChainTransportSizeError)
    expect((cause as SupabaseBackfillReceiptV2ChainTransportSizeError).code).toBe(expected)
    return
  }
  throw new TypeError(`Expected transport-size error ${expected}`)
}

describe('Supabase Receipt V2 chain transport-size certificate', () => {
  test('reverifies a serialized flat transport certificate without granting authority', () => {
    expect(verifySupabaseBackfillReceiptV2ChainTransportSizeCertificateV1(LIMITS)).toBe(true)
    const serialized = structuredClone(LIMITS)
    expect(verifySupabaseBackfillReceiptV2ChainTransportSizeCertificateV1(serialized)).toBe(true)
    expect(
      verifySupabaseBackfillReceiptV2ChainTransportSizeCertificateV1({
        ...serialized,
        maximumResponseBytes: LIMITS.maximumResponseBytes + 1
      })
    ).toBe(false)
    expect(LIMITS.maximumBase64CharactersPerPage + LIMITS.maximumResponseFramingBytes).toBe(
      LIMITS.maximumResponseBytes
    )
    expect(LIMITS.maximumReceiptCount * LIMITS.maximumCanonicalReceiptBytesEach).toBe(
      LIMITS.maximumDecodedReceiptBytesPerCollection
    )
  })

  test('certifies the exact canonical request boundary and rejects one extra byte', async () => {
    const baseline =
      await createSupabaseBackfillReceiptV2ChainRequestSizeCertificateV1(emptyParameters())
    const exactValues = allocateASCIIBytes(
      LIMITS.maximumCanonicalRequestBytes - baseline.requestFramingByteLength
    )
    const exact = await createSupabaseBackfillReceiptV2ChainRequestSizeCertificateV1(exactValues)

    expect(exact.canonicalRequestByteLength).toBe(LIMITS.maximumCanonicalRequestBytes)
    expect(exact.requestFramingByteLength).toBe(baseline.requestFramingByteLength)
    await expectAsyncTransportSizeError(
      createSupabaseBackfillReceiptV2ChainRequestSizeCertificateV1(appendASCIIByte(exactValues)),
      'supabase-backfill-receipt-v2-chain-request-too-large'
    )
  })

  test('measures UTF-8 bytes and reverifies a serialized request certificate without values', async () => {
    const values = emptyParameters()
    values[0] = '界😀'
    const baseline =
      await createSupabaseBackfillReceiptV2ChainRequestSizeCertificateV1(emptyParameters())
    const certificate = await createSupabaseBackfillReceiptV2ChainRequestSizeCertificateV1(values)
    const serialized = structuredClone(certificate)

    expect(certificate.parameterPayloadByteLength).toBe(7)
    expect(certificate.canonicalRequestByteLength).toBe(baseline.canonicalRequestByteLength + 7)
    expect(certificate).not.toHaveProperty('parameters')
    expect(
      await verifySupabaseBackfillReceiptV2ChainRequestSizeCertificateV1(values, serialized)
    ).toBe(true)
    expect(
      await verifySupabaseBackfillReceiptV2ChainRequestSizeCertificateV1(values, {
        ...serialized,
        canonicalRequestByteLength: certificate.canonicalRequestByteLength + 1
      })
    ).toBe(false)

    const invalid = emptyParameters()
    invalid[0] = '\ud800'
    await expectAsyncTransportSizeError(
      createSupabaseBackfillReceiptV2ChainRequestSizeCertificateV1(invalid),
      'supabase-backfill-receipt-v2-chain-request-invalid'
    )
  })

  test('certifies the exact request framing boundary and rejects one escaped byte beyond it', async () => {
    const baseline =
      await createSupabaseBackfillReceiptV2ChainRequestSizeCertificateV1(emptyParameters())
    const exactValues = allocateASCIIBytes(
      LIMITS.maximumRequestFramingBytes - baseline.requestFramingByteLength,
      '"'
    )
    const exact = await createSupabaseBackfillReceiptV2ChainRequestSizeCertificateV1(exactValues)

    expect(exact.requestFramingByteLength).toBe(LIMITS.maximumRequestFramingBytes)
    await expectAsyncTransportSizeError(
      createSupabaseBackfillReceiptV2ChainRequestSizeCertificateV1(
        appendASCIIByte(exactValues, '"')
      ),
      'supabase-backfill-receipt-v2-chain-request-framing-too-large'
    )
  })

  test('caps response bytes before parsing and requires fatal UTF-8 compact JSON', () => {
    const exactWire = new TextEncoder().encode(`"${'a'.repeat(LIMITS.maximumResponseBytes - 2)}"`)
    const exact = parseSupabaseBackfillReceiptV2ChainBoundedResponseJSONV1(exactWire)
    expect(exact.responseByteLength).toBe(LIMITS.maximumResponseBytes)

    expectTransportSizeError(
      () =>
        parseSupabaseBackfillReceiptV2ChainBoundedResponseJSONV1(
          new Uint8Array(LIMITS.maximumResponseBytes + 1)
        ),
      'supabase-backfill-receipt-v2-chain-response-too-large'
    )
    expectTransportSizeError(
      () => parseSupabaseBackfillReceiptV2ChainBoundedResponseJSONV1(Uint8Array.of(0xff)),
      'supabase-backfill-receipt-v2-chain-response-invalid'
    )
    expectTransportSizeError(
      () =>
        parseSupabaseBackfillReceiptV2ChainBoundedResponseJSONV1(
          Uint8Array.of(0xef, 0xbb, 0xbf, 0x5b, 0x5d)
        ),
      'supabase-backfill-receipt-v2-chain-response-invalid'
    )
    expectTransportSizeError(
      () =>
        parseSupabaseBackfillReceiptV2ChainBoundedResponseJSONV1(new TextEncoder().encode(' []')),
      'supabase-backfill-receipt-v2-chain-response-invalid'
    )
  })

  test('certifies response framing and total-wire exact boundaries', () => {
    const exactFraming = certifySupabaseBackfillReceiptV2ChainResponseSizeV1(
      LIMITS.maximumResponseFramingBytes + 4,
      4
    )
    expect(exactFraming.responseFramingByteLength).toBe(LIMITS.maximumResponseFramingBytes)
    expectTransportSizeError(
      () =>
        certifySupabaseBackfillReceiptV2ChainResponseSizeV1(
          LIMITS.maximumResponseFramingBytes + 5,
          4
        ),
      'supabase-backfill-receipt-v2-chain-response-framing-too-large'
    )

    const exactWire = certifySupabaseBackfillReceiptV2ChainResponseSizeV1(
      LIMITS.maximumResponseBytes,
      LIMITS.maximumBase64CharactersPerPage
    )
    expect(exactWire.responseFramingByteLength).toBe(LIMITS.maximumResponseFramingBytes)
    expectTransportSizeError(
      () =>
        certifySupabaseBackfillReceiptV2ChainResponseSizeV1(
          LIMITS.maximumResponseBytes + 1,
          LIMITS.maximumBase64CharactersPerPage
        ),
      'supabase-backfill-receipt-v2-chain-response-too-large'
    )
  })

  test('certifies the decoded collection boundary and rejects one extra byte', () => {
    const exact = certifySupabaseBackfillReceiptV2ChainDecodedAggregateSizeV1(
      LIMITS.maximumDecodedReceiptBytesPerCollection
    )
    expect(exact).toEqual({
      decodedReceiptByteLength: LIMITS.maximumDecodedReceiptBytesPerCollection,
      maximumDecodedReceiptBytes: LIMITS.maximumDecodedReceiptBytesPerCollection,
      decodedAggregateBoundCertified: true
    })
    expectTransportSizeError(
      () =>
        certifySupabaseBackfillReceiptV2ChainDecodedAggregateSizeV1(
          LIMITS.maximumDecodedReceiptBytesPerCollection + 1
        ),
      'supabase-backfill-receipt-v2-chain-decoded-aggregate-too-large'
    )
  })
})
