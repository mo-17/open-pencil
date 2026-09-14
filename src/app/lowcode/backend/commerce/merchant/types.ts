export type CommerceMerchantMode = 'single-merchant' | 'multi-merchant'

export function assertCommerceMerchantMode(mode: unknown): asserts mode is CommerceMerchantMode {
  if (mode !== 'single-merchant' && mode !== 'multi-merchant')
    throw new Error('Select a supported commerce merchant mode.')
}

export interface CommerceMerchantPaths {
  shop: string
  orders: string
  login: string
  admin: string
  merchantOrders: string
  stores?: string
  openStore?: string
}
