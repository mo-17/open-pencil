import { S3Client } from '@aws-sdk/client-s3'
import { FetchHttpHandler } from '@smithy/fetch-http-handler'

import type { S3CompatibleConfig } from '@/app/integrations/storage/s3/types'

import { normalizeEndpoint, resolveS3Region } from './endpoint'

export {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3ServiceException,
  paginateListObjectsV2
} from '@aws-sdk/client-s3'

export function createS3Client(config: S3CompatibleConfig, customFetch: typeof fetch): S3Client {
  return new S3Client({
    endpoint: normalizeEndpoint(config.endpoint),
    region: resolveS3Region(config),
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey
    },
    // Path-style {endpoint}/{bucket}/{key} works with B2, MinIO, R2, rclone, and AWS.
    forcePathStyle: true,
    // Default CRC32 checksums are rejected by several S3-compatible providers.
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
    // storageFetch already bounds every attempt; retries would multiply its timeout.
    maxAttempts: 1,
    requestHandler: new FetchHttpHandler({
      customFetch,
      // Never send cookies; avoids credentialed CORS mode.
      credentials: 'omit',
      // Objects change under the same URL, and a ranged read answered with 200 would
      // otherwise be cached as the whole object and returned for the next full read.
      cache: 'no-store'
    })
  })
}
