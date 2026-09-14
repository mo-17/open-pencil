# Commerce applications

The Backend library includes separate single-merchant and multi-merchant commerce templates with
a server-owned cart, split orders, development payment simulation, fulfillment, refunds and
settlement records. The earlier Single-item checkout and merchant-order starters remain available;
existing documents and databases are not upgraded automatically.

## Create and configure

Create a new document, open **Services & Workflows → Backend → Browse backend library**, and choose
the commerce template with cart and fulfillment. Select the local Keycloak configuration or enter
your OIDC provider's public issuer and client ID. Export every generated page together as React or
Vue, then follow the generated NestJS README to configure PostgreSQL, JWT verification and the
same-origin API mount. Creating the template does not start services or alter a database.
Open `/shop` for the storefront and `/shop-login` for sign-in on the generated frontend server.

In Direct AI chat, request the operations edition explicitly, for example:

> 使用本地 Keycloak，创建中文多商户电商应用，包含购物车、模拟支付、发货签收和结算记录，平台佣金为 5%，导出 Vue 项目。

The AI uses `create_commerce_app` with `edition: "operations"`. The default starter edition retains
the earlier behavior. Money uses integer minor currency units. A commission is configured in
basis points: `500` means 5%; the default is `0`. It must be an integer from 0 to 10,000.

The identity administrator grants roles through the verified JWT's top-level `openpencil_roles`
claim. `merchant` permits managing the account's store; `commerce-operator` permits refund decisions
and recording settlement payments. A visible page, client state or supplied store ID grants no
server authority. One account owns one store. The single-merchant template also has a database
constraint limiting the application to one store; the multi-merchant template permits separate
stores. Store ownership cannot be changed through the generated resource API.

## Cart and checkout

After signing in, add products to the server-owned cart. Cart updates are explicit quantity
replacements, not stock reservations. Removing an item leaves a private inactive record so a
previous request can still be safely replayed. Each cart mutation advances its revision and updates
the server's displayed subtotal. Different accounts never share cart state.

Checkout sends the displayed cart revision and recipient, phone and address. It does not accept
client totals, commission, price snapshots or merchant payout destinations. The server rejects a
changed or empty cart, unavailable stock, exceeded bounds or an overflowing amount. It locks the
cart, stores and products in a fixed order, rechecks prices, reserves stock and creates one payment
group with one child order per store and immutable product lines. Failure rolls back the whole
checkout. The current limits are 50 cart items and 10 stores per purchase (one store in single mode).

The cart revision is part of the idempotent request. A retry with the original key returns the
original purchase even after checkout has consumed the cart; a new checkout requires the current
revision. Recovery controls retain the original payload after an uncertain response. Do not clear
a pending key or recreate a purchase solely because the network timed out.

## Development payments

This edition includes an explicit payment simulator, not an installed live payment channel. The
generated server enables it only when both `NODE_ENV=development` and
`OPENPENCIL_COMMERCE_PAYMENT_MODE=simulator` are set. Production and unconfigured servers reject
simulated payment confirmation and simulated refunds. Tokens and payment secrets do not belong
in the document, browser state, template or source-control history.

After configuring the exported project's local dependencies, explicitly enable the simulator for
that development process from the export root:

```sh
NODE_ENV=development OPENPENCIL_COMMERCE_PAYMENT_MODE=simulator npm --prefix backend/nestjs run local:up
```

Follow the generated `backend/nestjs/COMMERCE.md` for setup.
The editor's managed preview does not forward these switches and keeps the simulator disabled.

Simulated success, failure and unknown outcomes exercise the server's payment state transitions.
Unknown leaves the payment pending; it is not evidence that no payment occurred. Duplicate or
out-of-order outcomes cannot downgrade a paid purchase or book the same financial effect twice.
Failure cancels an unpaid purchase and releases its inventory; another purchase requires checkout
again. A failure arriving after success cannot reverse the successful payment.
A success after cancellation or reservation expiry creates a refund-required state with refund
requests instead of reopening fulfillment. Released stock is not released again during refund.

The default reservation window is 30 minutes. Expiry is checked while processing the relevant
commands; this edition does not promise an autonomous reservation-expiry worker. Explicit
cancellation releases an unpaid purchase. A live gateway integration needs verified provider
events, durable inbox/outbox delivery, payment-query/close/refund reconciliation, and real account
tests before it can safely use the same business transitions. No browser action or unverified
webhook is a live payment receipt.

## Fulfillment and refunds

Paid child orders appear in their own merchant's order list. The merchant records a carrier and
tracking number and marks the order shipped. The buyer can inspect those records and confirm
receipt. This records fulfillment; it does not purchase a shipping label, query a carrier or prove
physical delivery. The merchant cannot confirm receipt on the buyer's behalf to unlock settlement.

The initial refund flow covers the entire unshipped child order, not arbitrary partial amounts.
The buyer supplies a reason; the platform operator approves or rejects the request. Simulated
approval refunds that order's captured amount, reverses its original commission and merchant
amount, and releases reserved inventory only once. Shipped or already settled orders require a
separate returns/financial-recovery workflow and are rejected by this initial approval path.
Free orders still require an explicit successful simulation. A purchase is fully refunded only
when every child order is refunded, including zero-price child orders.
Refund-required records caused by late payment cannot be rejected into a fulfillable order with
already released stock.

## Commission and settlement

Commission is calculated once per child order using integer arithmetic and rounding down:
`floor(orderTotal * commissionBasisPoints / 10000)`. Merchant proceeds are the remaining amount.
Payment and reversal events are append-only financial entries with business deduplication. A
refund reverses the stored original amounts; it does not recalculate with a newly configured rate.

Settlement becomes eligible only after payment and buyer-confirmed receipt, after the configured
delay and with no outstanding refund. The default delay is seven days. The operator records the
reference of an external payment that has already occurred; repeating the command cannot create
a second settlement or overwrite the original record.
If the merchant's net amount is zero, record an audit reference explaining that no transfer is
required instead of claiming an external payment occurred.

**Recording settlement does not transfer money.** This edition does not execute bank payouts,
payment-channel profit sharing, split settlements, tax calculations or cross-currency conversion.
Actual money movement requires a selected provider and its own reconciliation and account gates.
Merchant read projections are separated from the platform's refund and settlement projections.
The immutable `merchant_id` snapshot identifies the merchant payee. A settlement's `owner_id`
retains the buyer's referential ownership for private order foreign keys; it never chooses the
payee or grants the buyer permission to read settlement records.

## Generated backend boundary

The optional provider-neutral `commerce` contract names the ten model entities, role IDs, currency,
bounds, reservation duration and commission policy. Commerce commands use a closed
`commerceOperation` union with exact scalar parameter, access and result signatures. Their steps
are empty because the reviewed runtime owns these bounded operations. This adds no arbitrary
SQL, JavaScript, array iteration, endpoint or handler source to documents or plugin manifests.

The validator rejects ordinary HTTP/command/workflow writes that would bypass commerce-owned
amounts, statuses, cart revision or inventory rules. NestJS is the executing provider; unsupported
providers and V2 application contracts reject the feature instead of silently dropping it.
Generated HTTP authorization uses server predicates; it does not install database RLS or make
direct database administration safe. Changing entity bindings requires a separately reviewed
migration, and generation or local tests are not production release receipts.
