import type { PluginMCPToolCallDescriptor } from '@open-pencil/mcp/plugin-contract'

import type { ThirdPartyPluginAIContributionGrant } from '@/app/plugins/ai-authorization'

type PublisherPluginMCPAuthority = Readonly<{
  pluginId: string
  kind: 'command' | 'connector'
  contributionId: string
  adapterId: string
  packageDigest: string
  pluginVersion: string
  publisherId: string
  publisherKeyId: string
  grantId: string
}>

type ActiveRequest = {
  readonly controller: AbortController
  publisherAuthority: PublisherPluginMCPAuthority | null
}

function publisherAuthority(
  descriptor: PluginMCPToolCallDescriptor,
  grantId: string | null
): PublisherPluginMCPAuthority | null {
  if (
    descriptor.authority.trustSource !== 'publisher-signature' ||
    (descriptor.kind !== 'command' && descriptor.kind !== 'connector')
  ) {
    return null
  }
  if (!grantId) throw new Error('Third-party plugin AI grant identity is unavailable')
  return Object.freeze({
    pluginId: descriptor.pluginId,
    kind: descriptor.kind,
    contributionId: descriptor.contributionId,
    adapterId: descriptor.authority.adapterId,
    packageDigest: descriptor.authority.packageDigest,
    pluginVersion: descriptor.authority.pluginVersion,
    publisherId: descriptor.authority.publisherId,
    publisherKeyId: descriptor.authority.publisherKeyId,
    grantId
  })
}

function exactGrant(
  authority: PublisherPluginMCPAuthority,
  grant: ThirdPartyPluginAIContributionGrant
): boolean {
  return (
    authority.pluginId === grant.pluginId &&
    authority.kind === grant.kind &&
    authority.contributionId === grant.contributionId &&
    authority.adapterId === grant.adapterId &&
    authority.packageDigest === grant.packageDigest &&
    authority.pluginVersion === grant.pluginVersion &&
    authority.publisherId === grant.publisherId &&
    authority.publisherKeyId === grant.publisherKeyId &&
    authority.grantId === grant.grantId
  )
}

/** Tracks live bridge calls so Publisher AI grant changes can revoke in-flight authority. */
export class PluginMCPRequestRevocationRegistry {
  readonly #requests = new Map<string, ActiveRequest>()

  start(id: string): AbortController {
    this.cancel(id)
    const controller = new AbortController()
    this.#requests.set(id, { controller, publisherAuthority: null })
    return controller
  }

  bind(
    id: string,
    controller: AbortController,
    descriptor: PluginMCPToolCallDescriptor,
    publisherGrantId: string | null
  ): void {
    const request = this.#requests.get(id)
    if (request?.controller !== controller || controller.signal.aborted) return
    request.publisherAuthority = publisherAuthority(descriptor, publisherGrantId)
  }

  reconcilePublisherGrants(grants: readonly ThirdPartyPluginAIContributionGrant[]): readonly string[] {
    const revoked: string[] = []
    for (const [id, request] of this.#requests) {
      if (request.controller.signal.aborted) continue
      const authority = request.publisherAuthority
      if (!authority || grants.some((grant) => exactGrant(authority, grant))) continue
      request.controller.abort(new Error('Third-party plugin AI grant was revoked'))
      revoked.push(id)
    }
    return Object.freeze(revoked)
  }

  cancel(id: string): void {
    this.#requests.get(id)?.controller.abort()
  }

  finish(id: string, controller: AbortController): void {
    if (this.#requests.get(id)?.controller === controller) this.#requests.delete(id)
  }

  abortAll(): void {
    for (const request of this.#requests.values()) request.controller.abort()
    this.#requests.clear()
  }
}
