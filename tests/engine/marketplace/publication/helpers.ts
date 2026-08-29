import {
  prepareMarketplacePublication,
  type MarketplaceArtifactStore,
  type MarketplaceRepository
} from '@open-pencil/marketplace'
import { verifyMarketplaceSnapshot } from '@open-pencil/plugin-contracts'

interface TestMarketplacePublicationOptions {
  repository: MarketplaceRepository
  artifacts: MarketplaceArtifactStore
  marketplaceId: string
  publicBaseUrl: string
  rootKeyId: string
  rootPrivateKey: CryptoKey
  rootPublicKey: CryptoKey
  generatedAt: string
  actor: string
}

/** Test-only fixture helper. Production publication must use the offline request/sign/import flow. */
export async function recordTestMarketplacePublication(options: TestMarketplacePublicationOptions) {
  const prepared = await prepareMarketplacePublication(
    await options.repository.snapshot(),
    options.artifacts,
    {
      marketplaceId: options.marketplaceId,
      publicBaseUrl: options.publicBaseUrl,
      rootKeyId: options.rootKeyId,
      rootPrivateKey: options.rootPrivateKey,
      now: () => new Date(options.generatedAt)
    }
  )
  await verifyMarketplaceSnapshot(prepared.snapshot, options.rootPublicKey, {
    expectedMarketplaceId: options.marketplaceId,
    expectedKeyId: options.rootKeyId,
    now: prepared.snapshot.generatedAt
  })
  const publication = await options.repository.transaction((transaction) =>
    transaction.recordPublication(prepared.record, {
      actor: options.actor,
      time: prepared.snapshot.generatedAt
    })
  )
  return { prepared, publication }
}
