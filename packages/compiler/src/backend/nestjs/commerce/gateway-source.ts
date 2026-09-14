/** Integration contract only: no generated unverified callback or executable manifest hook. */
export const COMMERCE_GATEWAY_SOURCE = String.raw`/** Real gateways require a reviewed server adapter and durable attempt/inbox/outbox integration.
 * No implementation or public callback is registered by this generated project.
 * Never call provider I/O while a commerce database transaction is open.
 */
export interface PaymentAttempt {
  readonly environment: 'test' | 'live'
  readonly providerAccount: string
  readonly attemptId: string
  readonly purchaseId: string
  readonly amount: number
  readonly currency: 'CNY' | 'USD'
  readonly idempotencyKey: string
}
export interface VerifiedPaymentEvent {
  readonly environment: 'test' | 'live'
  readonly providerAccount: string
  readonly eventId: string
  readonly providerObjectId: string
  readonly attemptId: string
  readonly purchaseId: string
  readonly amount: number
  readonly currency: 'CNY' | 'USD'
  readonly outcome: 'succeeded' | 'failed'
}
export interface PaymentGateway {
  /** Must preserve provider uncertainty; an accepted request is not payment confirmation. */
  createPayment(attempt: PaymentAttempt): Promise<{ readonly state: 'pending' | 'unknown'; readonly providerObjectId?: string }>
  /** Verify the exact raw bytes and provider signature before normalizing any event. */
  verifyWebhook(rawBody: Uint8Array, headers: Readonly<Record<string, string>>): Promise<VerifiedPaymentEvent>
  queryPayment(attempt: PaymentAttempt): Promise<VerifiedPaymentEvent | { readonly outcome: 'unknown' }>
}
`

export const COMMERCE_GUIDE = `# Commerce runtime boundary

The generated NestJS runtime supports a database cart, bounded multi-SKU checkout, per-store orders,
stock reservations, explicit cancellation, manual shipment tracking, full unshipped-order refunds,
and an append-only commission and payout-record ledger. Amounts are integer minor units.
Prices, store bindings and commission snapshots are derived on the server. Cart revisions protect
checkout; an uncertain response must be retried with the same command key and parameters.

## Development payments

No real payment gateway or webhook endpoint is configured. Only a verified, signed-in buyer can
simulate their own purchase, and only with both NODE_ENV=development and
OPENPENCIL_COMMERCE_PAYMENT_MODE=simulator. Outcomes are succeeded, failed and unknown.
From the exported application root, start the local application with:

    NODE_ENV=development OPENPENCIL_COMMERCE_PAYMENT_MODE=simulator npm --prefix backend/nestjs run local:up

The editor managed preview keeps the simulator disabled; use the exported local application to
explicitly opt in. Production rejects this endpoint before looking up saved command responses. Simulator events have
a separate namespace and never issue a real charge, refund or transfer. Refund approval in this
version also requires these simulator gates. An operator reference records the simulation decision.

Reservations have an expiry timestamp; this version has no automatic expiry worker. Explicit buyer
cancellation releases pending inventory. A success after cancellation or expiry never restores a
reservation or permits shipment: it creates requested refunds for operator review. Inventory is
returned at most once. Duplicate success and failure-after-success never regress paid orders.

Refunds cover a complete child order before shipment and before payout recording. A request pauses
shipment; approval creates immutable reversal entries. Shipped or settled orders require a separately
implemented return and transfer-reversal process and are rejected here. Settlement recording requires
delivery, the configured delay, and no open or approved refund. Its reference records an external payment or, when the merchant net amount is zero, an audit
explanation that no transfer is needed. Free orders and 100% commission can have a zero net amount.
Recording never sends money or verifies a bank transfer.

## Real gateway integration

payment-gateway.ts is a TypeScript integration contract, not a plugin execution surface. A real adapter
still needs provider onboarding, raw-body signature verification, immutable environment/account/amount/
currency/attempt binding, durable inbox and outbox processing, query reconciliation for unknown
requests, provider event deduplication, and refund and transfer lifecycles. External I/O must occur
outside database transactions. Do not expose a client-supplied paid flag or a generic verified-event
HTTP route. The development simulator must remain disabled in production.
`
