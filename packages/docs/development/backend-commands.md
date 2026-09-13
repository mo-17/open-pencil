# Atomic Backend commands

NestJS generates bounded, authenticated server commands from the optional
`BackendApplicationSpecV1.commands` contract. V2 applications retain this optional common
section; their existing `transactions` contract keeps its previous semantics. Other providers
reject commands until a reviewed implementation exists.

Commands cover operations such as single-SKU checkout, cancellation and stock additions that
need atomic reads and writes. Buyers can invoke a particular command without obtaining
resource CRUD access to inventory or order totals. The declared steps form the command's
explicit server authority. Review steps and return projections alongside resource policies.

## Create the example

Open **Services & Workflows → Backend → Browse backend library** and choose **Single-item checkout**.
Review its pages and requirements, choose **Local Keycloak** or enter **Custom OIDC** public settings,
then click **Use template**. The enabled NestJS provider is checked again at creation. The template
adds products, orders, checkout/cancellation/restocking commands, bindings, and four editable pages:
products, orders, login and catalog management. It opens the product page and supports undoing the entire
creation in one step, preserving existing pages and document state.

An existing Backend declaration, login flow, unreadable declaration or customized unsaved model
draft blocks template creation. Use a new document or continue editing the current model. Creating
the template neither starts services nor inserts database rows. Provider cards instead use
**Select provider** to change a draft, followed by an explicit **Save Backend model**; they do not
create pages or migrate a database. **Manage plugins** opens the existing Plugins settings. This
library contains installed provider declarations and built-in templates, with no new remote
marketplace protocol.

The built-in AI's Direct mode also exposes `create_single_sku_shop_app`. It creates the same
editable pages and command bindings before visual styling, with English or Chinese copy. For
the existing local identity setup, ask: “使用本地 Keycloak，创建一个中文单商品电商应用，保留下单、
取消订单和库存逻辑，导出 React 项目。” The tool changes the document only; export all four
returned pages together and configure the generated service as described below.

**Local Keycloak** uses the existing local service's public configuration; start that service
separately. **Custom OIDC** uses the public issuer and client ID you supply. Both remain editable in
**HTTP API & login**; configure the public browser client's exact callback and PKCE support as
described in [the NestJS login setup](./backend-nestjs.md#author-a-personal-notes-application).
Product creation, editing and restocking require the declared `catalog-manager` role ID in the
verified JWT's top-level `openpencil_roles` array. The generated API enforces this role; merely
visiting the page grants nothing. No administrator credentials or role grants are embedded in
the template.

The catalog page searches and pages through all products, including inactive ones. Creation
requires a non-whitespace title of at most 16,384 characters and nonnegative signed 32-bit integer
price and initial stock values (0–2,147,483,647). These form checks are not new database `CHECK`
constraints. Keep amounts in integer minor currency units. Managers can edit `title`, `price`
and `active`, including making products available or unavailable. The resource's `updateFields`
excludes `stock`: saving product details cannot replace inventory. Metadata edits overwrite the
submitted fields without comparing record versions, so a manager can overwrite a concurrent
change to those fields.

Stock additions use the separate, manager-only `restock-product` command with `{ skuId, quantity }`,
where `quantity` is an integer from 1–100,000. The server locks the product row and adds the quantity
with checked signed 32-bit arithmetic; overflow rolls back the transaction. A required
`Idempotency-Key` protects retries, and the template enables browser recovery for this command.
There is no product deletion or operation to set an absolute stock count.

Product creation and metadata saves remain ordinary resource CRUD requests. Among these manager
writes, only restocking has the command's idempotency ledger and persistent browser request
recovery. If a creation response is lost, query the product list and check whether the product
was created before deciding to retry; blindly submitting again can create a duplicate. Do not
treat all catalog writes as exactly-once operations.

The storefront searches product titles and fixes the product list to ascending price. Sold-out
products remain visible with a label but cannot be selected. Selecting an available product shows
its unit price, displayed stock and estimated total in integer minor currency units. The form
requires a whole-number quantity from 1–99, no greater than that displayed stock, and asks for
confirmation before **Place order**. These checks help users review an order; displayed stock
and estimates can become stale and do not reserve inventory.

Checkout still accepts only `{ skuId, quantity }`. It locks the product, checks current
availability/stock, reads its server price, deducts stock and creates a `pending` order with
`product_title`, `unit_price` and `total` snapshots and a server-generated `created_at` timestamp.
The server determines the final price and whether stock is available. Orders show newest first
with the saved product title, creation time and localized status, including Chinese status labels.
**Cancel order** also requires confirmation and displays feedback on success. Cancellation locks
the caller's pending order, releases its quantity and marks it `cancelled`. A different attempt
against an already cancelled order conflicts without releasing stock again.

The example has no payment collection, multi-item cart, delivery, refunds or reservation expiry.
Its declared product read fields are public, including inactive products: the storefront filter
is presentation, not authorization. Do not place private data in that public resource.

## Contract

The section is `{ version: 1, commands: [...] }`, with at most 16 commands. Omitting it preserves
older normalized documents. Each definition has a stable `id`, display `name`, static POST
`path`, authenticated or role-based `access`, required scalar `parameters`, at most 16 ordered
`steps`, and an explicit `return: { resultName, fields }`. Paths cannot collide with resource
routes. `idempotency` is always `{ kind: 'required', header: 'Idempotency-Key' }`.

Parameters are UUID, boolean, string with a bounded maximum length, or signed 32-bit integer
with explicit minimum/maximum. They cannot select tables, columns, operations or executable code.

| Step                     | Boundary                                                                                                                                                                                                      |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `data.read`              | Locks exactly one UUID-primary-key row with `FOR UPDATE`. `scope: 'owner'` adds the verified subject predicate; `scope: 'command'` explicitly grants this bounded read independently of resource CRUD policy. |
| `data.mutate` / `insert` | Inserts exactly one row. Owner comes from `caller-sub`; generated fields remain server-owned.                                                                                                                 |
| `data.mutate` / `update` | Updates the primary key of a prior locked read/update result for the same entity. Key, owner and generated fields are immutable.                                                                              |
| `assert`                 | Compares declared scalar values. Ordered comparisons require non-null integers. Failure aborts the transaction with a bounded not-found or conflict response.                                                 |

Values may reference parameters, selected fields of prior results, scalar literals or the verified
caller subject. Integer addition/subtraction/multiplication accept two scalar leaves and reject
signed 32-bit overflow. Arbitrary SQL/JavaScript, loops, external calls and recursive arithmetic
are unsupported. Internal result fields do not automatically appear in the HTTP response.

Commands require `server.functions`, `transactions.atomic`, `server.http` and their actual
data/auth capabilities. Capability declarations do not replace semantic validation or command
access checks. They do not alter the authorization rules of existing V2 transactions.

## Requests and retry state

Send exactly the declared parameters as JSON and one `Idempotency-Key` containing 16–128 ASCII
letters, digits, dots, underscores, colons or hyphens. A UUID is suitable. The generated SDK exposes:

```ts
const order = await client.commands.checkout({ skuId, quantity: 2 }, { idempotencyKey: attemptKey })
```

First successes and replays return 200. Invalid inputs return 400, authentication failures 401,
missing command roles 403, inaccessible/missing rows 404, and assertions, constraints or key
conflicts 409. Unavailability returns 503. Error messages are fixed; database internals are hidden.

The `backendCommand` action binds parameters and an `idempotencyKeyTarget` to a non-persistent
string document state. An empty target receives a UUID synchronously. Matching concurrent
attempts in one runtime share a request. Success, failure and uncertain responses retain the key.
The example retains the associated SKU/quantity/order selection across route changes. Identity
changes clear in-memory keys and sensitive results and suppress old replies.

The SDK has a 30-second request deadline and accepts an optional `AbortSignal`. Expiry releases
the pending UI state with an unavailable result while retaining the attempt key. Aborting a
request does not prove the server rolled back; identity changes suppress its old continuations.

There are no automatic mutation retries. After a timeout or lost response, retry with the same
key and parameters: the database may already have committed. Changed parameters or a changed
command definition under a committed key return 409. A replay returns the original operation's
snapshot; fetch the order resource to see later cancellation or other changes.

## Browser recovery

The command editor's **Allow recovery after refresh** option adds `recovery: 'browser'`.
The single-SKU example enables it for checkout, cancellation and restocking. The generated React/Vue runtime
stores the request key and canonical parameters in IndexedDB before sending the request. It
waits for the write transaction to complete; unavailable, blocked, full or failed storage prevents
the POST. An exclusive Web Lock covers each attempt through request completion. Another tab
cannot send, retry or acknowledge that attempt while the lock is held; it fails immediately
instead of queueing a later mutation.

The slot binds the frontend origin, application, API base, public OIDC configuration, verified
subject, command and key-state target. A command definition digest is stored separately so a
changed definition blocks retry instead of silently creating a second purchase. Records contain
parameters and a creation timestamp, not tokens, credentials or server results. Use this opt-in
only for parameters the application may retain on the user's device. Other scripts on the same
origin can access browser storage; account scoping is not a boundary against compromised code.

The **Recover backend command** action provides three explicit operations:

| Operation     | Behavior                                                                                                                                                                                                                                                           |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `inspect`     | Reads the current account's local attempt without sending a command. The non-persistent object `resultTarget` receives `status: 'empty'`, `'recorded'` or `'incompatible'`, with key/timestamp when present and saved parameters only for a compatible definition. |
| `retry`       | Requires `attemptKeyExpr` from the inspected record. Sends the saved key and parameters, regardless of subsequent form edits. It returns the normal command result.                                                                                                |
| `acknowledge` | Requires the inspected key. Deletes that exact record and clears its key after the user has checked the result. It returns `{ status: 'empty' }`. An incompatible definition can be acknowledged after checking the order through the resource API.                |

`inspect` forbids `attemptKeyExpr`; the other operations require it. All operations require a
verified signed-in session and a non-persistent string `idempotencyKeyTarget`. Optional result
and error targets are non-persistent object/string states. Success/error branches retain the
usual `data` and `error` locals and are suppressed if the identity changes.

After a reload, sign in to the same account and choose **View saved attempt**. Check the order
list, then explicitly retry with the original parameters if its outcome is uncertain. The example
shows those saved parameters separately from the current form. Choose **Start new order** only after resolving the old attempt; a confirmation precedes acknowledgment.
Managers use the same explicit inspection and saved-parameter retry flow for restocking. Current
stock alone does not prove whether a particular addition committed, since other orders or stock
additions may have changed it. Resolve the saved request's outcome before acknowledging it and
starting another stock addition.
There is no automatic POST on login, reload or inspection. Logging out preserves the journal
without exposing it to another account. Clearing a key state directly cannot bypass an existing
journal record, and a stale tab cannot recreate a key acknowledged by another tab.

The journal is capped at 256 records per origin and does not automatically expire or evict them.
IndexedDB durability is a browser capability, not a permanent backup: clearing site data, changing
origin/browser profile, or browser storage eviction can remove recovery information. Inspect
orders before a new purchase if the local record is lost. Devices without IndexedDB or Web Locks
cannot execute opted-in actions; ordinary in-memory command actions remain available.

Without the opt-in, attempt state survives route changes only. Direct SDK callers must retain
their own keys. This browser journal does not change the server's persistent idempotency ledger.

## Database and migration boundary

The runtime obtains one `node-postgres` connection for the idempotency claim, business steps and
serialized result. Any failure rolls back all of them. The stable database identity is
`(application, command, subject, key)`; definition and parameter digests are separate columns.
Changing a definition therefore cannot cause a retry of an old key to deduct inventory again.

`public.openpencil_command_requests` is generated with the initial schema and included in
Managed Preview's exact schema/authority checks. It is never a DataModel entity or HTTP resource.
Records survive API restarts. There is no automatic expiry or cleanup: deleting committed records
removes their replay protection.

Managed Preview supports fresh initialization and command-only runtime edits when the model and
ledger presence stay unchanged. Adding or removing commands for the first time changes the
internal schema and requires a reviewed migration or a fresh isolated example database. Existing
ledgers and business rows are never silently created, dropped or adopted.

Template updates do not rewrite existing documents or databases. To use the improved shop flow,
create a new template document with a fresh isolated database, or explicitly migrate the existing
model, command projections, page bindings and database. In particular, older orders lack the new
`product_title` snapshot and `created_at` field; review how to populate historical records rather
than treating the current product title as the title originally purchased. To adopt catalog
management, also remove `stock` from product `updateFields`, add the role-restricted
`restock-product` command, and update the manager page and recovery bindings. Updating only the
page does not remove an old API's permission to overwrite stock. Resolve saved command attempts
before changing their definition: an old attempt cannot be replayed under the new one.

Authorization is server-enforced; this preset does not install PostgreSQL RLS. Direct database
administration, changes to generated code, deployment and real payments need separate validation.
See [NestJS backend](./backend-nestjs.md) for setup and preview details.
