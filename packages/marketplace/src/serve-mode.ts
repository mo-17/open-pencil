export interface MarketplaceServeMode {
  adminEnabled: boolean
  onlineSigning: boolean
}

export function positiveMarketplacePort(value: string): number {
  const port = Number(value)
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
    throw new Error('Marketplace port must be between 1 and 65535')
  }
  return port
}

export function isMarketplaceLoopbackHost(value: string): boolean {
  return value === '127.0.0.1' || value === '::1' || value === 'localhost'
}

export function resolveMarketplaceServeMode(
  host: string,
  adminEnabled: boolean,
  onlineSigning: boolean
): MarketplaceServeMode {
  if (adminEnabled && !isMarketplaceLoopbackHost(host)) {
    throw new Error('Admin HTTP routes are only allowed on an explicit loopback host')
  }
  if (onlineSigning && !adminEnabled) {
    throw new Error('Online signing requires explicit --enable-admin')
  }
  return { adminEnabled, onlineSigning }
}
